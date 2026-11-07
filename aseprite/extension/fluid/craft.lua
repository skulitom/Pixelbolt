local use = ...
-- Deterministic arithmetic, array helpers, dithering and pixel cleanup.
-- Used by compile, read, grid, emit, gas, look, sparks and obstacles.

local craft = {}
local floor, abs, fmod = math.floor, math.abs, math.fmod

-- src/fluid.js:769-780,1930-1936 (c915af9), createGrid / createGas (Lua array helper).
-- Allocates a flat, one-based filled array.
function craft.zeros(n, value)
  local a = {}
  if value == nil then
    -- Float zero matches Float64Array initialization, including signed-zero arithmetic.
    value = 0.0
  end
  for i = 1, n do
    a[i] = value
  end
  return a
end

-- src/fluid.js:4289-4297,4848-4850 (c915af9), handBack / simulate (Lua copy helper).
-- Copies a field or memory array without aliasing.
function craft.copy(a)
  local b = {}
  for i = 1, #a do
    b[i] = a[i]
  end
  return b
end

-- src/craft.js:98-101 (c915af9), sinDeg (Math.round adapter).
-- Rounds a quadrant with ties toward positive infinity.
function craft.round(x)
  -- Unlike floor(x + 0.5), this does not round the addition before testing the tie.
  local r = floor(x)
  if x - r >= 0.5 then
    r = r + 1
  end
  return r
end

-- src/fluid.js:93 (c915af9), smooth.
-- Evaluates the shared cubic smoothstep.
function craft.smooth(t)
  return t * t * (3 - 2 * t)
end

-- src/craft.js:52-60 (c915af9), hash.
-- Mixes integer inputs into an unsigned 32-bit hash.
function craft.hash(...)
  local h = 0x811c9dc5
  local n = select('#', ...)
  for i = 1, n do
    local value = select(i, ...)
    -- Truncate toward zero like JS value | 0, then retain only the low 32 bits.
    -- Mask after each multiply/rotate: Lua integers are 64-bit; JS imul is 32-bit.
    local k = (math.modf(value) & 0xFFFFFFFF) * 0xcc9e2d51 & 0xFFFFFFFF
    k = ((k << 15) | (k >> 17)) & 0xFFFFFFFF
    k = (k * 0x1b873593) & 0xFFFFFFFF
    h = h ~ k
    h = ((h << 13) | (h >> 19)) & 0xFFFFFFFF
    h = (h * 5 + 0xe6546b64) & 0xFFFFFFFF
  end
  -- Masked operands make Lua right shifts match JS unsigned >>> shifts.
  h = h ~ n
  h = h ~ (h >> 16)
  h = (h * 0x85ebca6b) & 0xFFFFFFFF
  h = h ~ (h >> 13)
  h = (h * 0xc2b2ae35) & 0xFFFFFFFF
  h = h ~ (h >> 16)
  return h
end

-- src/craft.js:61 (c915af9), random.
-- Maps the hash to a deterministic unit interval.
function craft.random(...)
  return craft.hash(...) / 4294967296
end

-- src/craft.js:90-93 (c915af9), sinCore.
-- Evaluates the sine polynomial on the reduced angle.
local function sinCore(x)
  local x2 = x * x
  -- KEEP POLYNOMIAL GROUPING: each nested multiply/add rounds in reference order.
  return x * (1 + x2 * (-1 / 6
    + x2 * (1 / 120
      + x2 * (-1 / 5040
        + x2 * (1 / 362880
          + x2 * (-1 / 39916800
            + x2 * (1 / 6227020800
              + x2 * (-1 / 1307674368000 + x2 / 355687428096000))))))))
end

-- src/craft.js:94-97 (c915af9), cosCore.
-- Evaluates the cosine polynomial on the reduced angle.
local function cosCore(x)
  local x2 = x * x
  -- The nested polynomial keeps the JavaScript evaluation order; do not reassociate.
  return 1 + x2 * (-1 / 2
    + x2 * (1 / 24
      + x2 * (-1 / 720
        + x2 * (1 / 40320
          + x2 * (-1 / 3628800
            + x2 * (1 / 479001600
              + x2 * (-1 / 87178291200 + x2 / 20922789888000)))))))
end

-- src/craft.js:98-102 (c915af9), sinDeg.
-- Reduces degrees to a quadrant and evaluates its polynomial.
function craft.sinDeg(degrees)
  -- math.fmod has JavaScript % semantics for negative degrees; Lua % does not.
  local d = fmod(degrees, 360)
  if d < 0 then
    d = d + 360
  end
  local quadrant = craft.round(d / 90)
  local x = (d - quadrant * 90) * 3.141592653589793 / 180
  local q = quadrant % 4
  if q == 0 then
    return sinCore(x)
  elseif q == 1 then
    return cosCore(x)
  elseif q == 2 then
    return -sinCore(x)
  else
    return -cosCore(x)
  end
end

-- src/craft.js:103 (c915af9), cosDeg.
-- Shifts the deterministic sine by one quarter turn.
function craft.cosDeg(degrees)
  return craft.sinDeg(degrees + 90)
end
local random, hash = craft.random, craft.hash

-- src/craft.js:68-73 (c915af9), lattice.
-- Interpolates four seeded lattice values.
local function lattice(seed, salt, size, x, y)
  local fx, fy = (x + 0.5) / size, (y + 0.5) / size
  local ix, iy = floor(fx), floor(fy)
  local tx, ty = fx - ix, fy - iy
  local u, v = tx * tx * (3 - 2 * tx), ty * ty * (3 - 2 * ty)
  return (random(seed, salt, ix, iy) * (1 - u) + random(seed, salt, ix + 1, iy) * u) * (1 - v)
    + (random(seed, salt, ix, iy + 1) * (1 - u) + random(seed, salt, ix + 1, iy + 1) * u) * v
end

-- src/craft.js:74 (c915af9), smoothField.
-- Blends the two octaves at the supported scale of four.
local function smoothField(seed, x, y)
  return lattice(seed, 1, 4, x, y) * 0.7 + lattice(seed, 2, 2, x, y) * 0.3
end
local samples
local bayer = {0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5}

-- src/craft.js:42-48,76-86 (c915af9), ditherThreshold / valueThreshold.
-- Returns an ordered, noise or value-noise threshold.
function craft.threshold(pattern, seed, x, y)
  if pattern == 'noise' then
    return ((hash(seed, x, y) >> 8) + 0.5) / 16777216
  end
  if pattern == 'value' then
    if not samples then
      samples = {}
      for k = 0, 16383 do
        samples[k + 1] = smoothField(1, hash(k, 1) % 1048576, hash(k, 2) % 1048576)
      end
      -- Numeric order matches Float64Array.sort; this is the same 16,384-sample CDF.
      table.sort(samples)
    end
    local value, low, high = smoothField(seed, x, y), 0, #samples
    while low < high do
      local mid = (low + high) >> 1
      if samples[mid + 1] <= value then
        low = mid + 1
      else
        high = mid
      end
    end
    return (low + 0.5) / (#samples + 1)
  end
  -- Here Lua % gives the positive wrap of JS ((n % 4) + 4) % 4.
  return (bayer[(y % 4) * 4 + x % 4 + 1] + 0.5) / 16
end

-- src/craft.js:127-137 (c915af9), traceLine.
-- Visits each whole pixel of the line in reference order.
function craft.traceLine(x, y, x2, y2, visit)
  local dx, sx, dy, sy = abs(x2 - x), x < x2 and 1 or -1, -abs(y2 - y), y < y2 and 1 or -1
  local error = dx + dy
  while true do
    visit(x, y)
    if x == x2 and y == y2 then
      return
    end
    local e = 2 * error
    if e >= dy then
      error = error + dy
      x = x + sx
    end
    if e <= dx then
      error = error + dx
      y = y + sy
    end
  end
end

-- src/craft.js:174-187 (c915af9), cleanupIds (strays branch).
-- Replaces a pixel whose neighbours all agree.
function craft.strays(chars, W, H, solid)
  -- Cleanup reads earlier edits in row-major order; a second buffer would change it.
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      local c = y * W + x + 1
      if not solid[c] then
        local shared, uniform = nil, true
        for dy = -1, 1 do
          if not uniform then
            break
          end
          for dx = -1, 1 do
            local px, py = x + dx, y + dy
            if (dx ~= 0 or dy ~= 0) and px >= 0 and py >= 0 and px < W and py < H then
              local n = chars[py * W + px + 1]
              if shared == nil then
                shared = n
              elseif n ~= shared then
                uniform = false
                break
              end
            end
          end
        end
        if uniform and shared ~= nil then
          chars[c] = shared
        end
      end
    end
  end
end

return craft
