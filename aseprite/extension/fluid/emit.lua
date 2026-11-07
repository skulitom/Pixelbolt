local use = ...
-- Gas emitters, coherent noise and the carriers that release smoke and heat.
-- Used by compile, gas and sparks.

local craft = use("fluid/craft")
local grid = use("fluid/grid")
local emit = {}
local floor, ceil, sqrt, min, max, abs = math.floor, math.ceil, math.sqrt, math.min, math.max, math.abs
local random, sinDeg, cosDeg, smooth = craft.random, craft.sinDeg, craft.cosDeg, craft.smooth

-- src/fluid.js:1776-1780 (c915af9), valueNoise.
-- Interpolates seeded noise on a three-cell lattice.
local function valueNoise(seed, emitter, frame, salt, x, y)
  local fx, fy = x / 3, y / 3
  local ix, iy = floor(fx), floor(fy)
  local sx, sy = smooth(fx - ix), smooth(fy - iy)
  return (random(seed, emitter, frame, salt, ix, iy) * (1 - sx) + random(seed, emitter, frame, salt, ix + 1, iy) * sx) * (1 - sy)
    + (random(seed, emitter, frame, salt, ix, iy + 1) * (1 - sx) + random(seed, emitter, frame, salt, ix + 1, iy + 1) * sx) * sy
end

-- src/fluid.js:1785-1792 (c915af9), emitterState.
-- Places the emitter and applies its pulse.
local function emitterState(e, index, cycle, seed, along)
  local x, y = e.at[1], e.at[2]
  if e.orbit then
    local angle = 360 * along / e.orbit.period + e.orbit.phase
    x = x + e.orbit.radius[1] * cosDeg(angle)
    y = y + e.orbit.radius[2] * sinDeg(angle)
  end
  local strength = e.strength * 1
  if e.pulse then
    strength = strength * (1 + e.pulse.amplitude * sinDeg(360 * cycle / e.pulse.period + e.pulse.phase))
  end
  return {x = x, y = y, strength = strength, e = e, index = index, cycle = cycle, seed = seed}
end

-- src/fluid.js:1790 (c915af9), emitterState.flicker.
-- Applies spatial noise to the emitter strength.
function emit.flicker(here, x, y)
  if here.e.flicker ~= 0 then
    return here.strength * (1 + here.e.flicker * (2 * valueNoise(here.seed, here.index, here.cycle, 1, x, y) - 1))
  end
  return here.strength
end
local flicker = emit.flicker

-- src/fluid.js:1795-1799 (c915af9), coverage.
-- Weights an emitter disc or box with its one-cell rim.
local function coverage(e, dx, dy)
  if e.radius then
    local d = sqrt(dx * dx + dy * dy)
    local w = e.radius + 0.5 - d
    return w <= 0 and 0 or w >= 1 and 1 or w
  end
  local wx, wy = e.area[1] / 2 + 0.5 - abs(dx), e.area[2] / 2 + 0.5 - abs(dy)
  if wx <= 0 or wy <= 0 then
    return 0
  end
  return (wx >= 1 and 1 or wx) * (wy >= 1 and 1 or wy)
end

-- src/fluid.js:1800 (c915af9), reach.
-- Bounds the emitter including its soft rim.
local function reach(e)
  return (e.radius or max(e.area[1], e.area[2]) / 2) + 1
end

-- src/fluid.js:1803-1807 (c915af9), profile.
-- Applies the emitter falloff across its coverage.
local function profile(e, dx, dy)
  if e.falloff == 0 then
    return 1
  end
  local share
  if e.radius then
    share = (dx * dx + dy * dy) / (e.radius * e.radius)
  else
    share = (4 * dx * dx) / (e.area[1] * e.area[1]) + (4 * dy * dy) / (e.area[2] * e.area[2])
  end
  return share >= 1 and 1 - e.falloff or 1 - e.falloff * share
end

-- src/fluid.js:1810-1815 (c915af9), push.
-- Combines directed, expanding and swirling velocities.
local function push(e, dx, dy, axis, expand)
  local value = e.velocity[axis]
  local d = sqrt(dx * dx + dy * dy)
  if d > 0.5 and (expand ~= 0 or e.vortex ~= 0) then
    value = value + (axis == 1 and (expand * dx - e.vortex * dy) / d or (expand * dy + e.vortex * dx) / d)
  end
  return value
end

-- src/fluid.js:1817 (c915af9), spread.
-- Converts expansion into divergence per covered cell.
local function spread(e)
  return e.expand * (e.radius and 2 / e.radius or 2 * (e.area[1] + e.area[2]) / (e.area[1] * e.area[2]))
end

-- src/fluid.js:1825-1830 (c915af9), emitGas.feed.
-- Adds a burst, approaches a rate target or drains a scalar.
local function feed(a, c, amount, w, strength, burst)
  if burst then
    a[c] = a[c] + amount * w * strength
  elseif amount >= 0 then
    local target = amount * strength
    if a[c] < target then
      a[c] = a[c] + (target - a[c]) * w
    end
  else
    a[c] = a[c] * (1 - w * min(1, -amount * strength))
  end
  if a[c] < 0 then
    a[c] = 0.0
  end
end

-- src/fluid.js:1858-1872 (c915af9), throwCarriers.
-- Launches one carrying particle per covered open cell.
local function throwCarriers(g, state, e, index, cycle, seed, here, x0, x1, y0, y1)
  local W, solid, list = g.W, g.pixels, state.carriers
  local x, y = here.x, here.y
  for j = y0, y1 do
    for i = x0, x1 do
      local c, px, py = j * W + i + 1, i + 0.5, j + 0.5
      local w = coverage(e, px - x, py - y)
      if w ~= 0 and not solid[c] then
        local amount = flicker(here, px, py) * profile(e, px - x, py - y) * w
        local d, t = e.density * amount, e.temperature * amount
        if d > 0 or t > 0 then
          if #list >= 8192 then
            error('fluid.emitters.carry: more than 8192 carriers', 0)
          end
          local vx, vy = push(e, px - x, py - y, 1, e.expand), push(e, px - x, py - y, 2, e.expand)
          if e.noise ~= 0 then
            vx = vx + e.noise * (2 * valueNoise(seed, index, cycle, 2, px, py) - 1)
            vy = vy + e.noise * (2 * valueNoise(seed, index, cycle, 3, px, py) - 1)
          end
          list[#list + 1] = {x = px, y = py, vx = vx, vy = vy, d = d > 0 and d or 0, T = t > 0 and t or 0, carry = e.carry}
        end
      end
    end
  end
end

-- src/fluid.js:1818-1849 (c915af9), emitGas.
-- Feeds the scalar fields and drives staggered velocity faces.
local function emitGas(g, state, e, index, cycle, seed, along, share)
  local W, H, u, v, solid = g.W, g.H, g.u, g.v, g.pixels
  local d, T, source = state.d, state.T, state.source
  local here = emitterState(e, index, cycle, seed, along)
  local x, y, r = here.x, here.y, reach(e)
  local x0, x1, y0, y1 = max(0, floor(x - r)), min(W - 1, ceil(x + r)), max(0, floor(y - r)), min(H - 1, ceil(y + r))
  if x0 > x1 or y0 > y1 then
    return here
  end
  if e.carry then
    throwCarriers(g, state, e, index, cycle, seed, here, x0, x1, y0, y1)
    return here
  end
  for j = y0, y1 do
    for i = x0, x1 do
      local c = j * W + i + 1
      local w = coverage(e, i + 0.5 - x, j + 0.5 - y)
      if w ~= 0 and not solid[c] then
        local strength = flicker(here, i + 0.5, j + 0.5)
        local amounts = strength * profile(e, i + 0.5 - x, j + 0.5 - y)
        if e.density ~= 0 then
          feed(d, c, e.density, w, amounts, e.burst)
        end
        if e.temperature ~= 0 then
          feed(T, c, e.temperature, w, amounts, e.burst)
        end
        if e.expand ~= 0 then
          source[c] = source[c] + spread(e) * w * strength * share
        end
      end
    end
  end

  -- src/fluid.js:1840-1845 (c915af9), emitGas.drive.
  -- Steers one velocity face and adds seeded turbulence.
  local function drive(a, k, px, py, axis)
    local w, strength = coverage(e, px - x, py - y), flicker(here, px, py)
    if w == 0 then
      return
    end
    if e.steer then
      local target = push(e, px - x, py - y, axis, 0)
      a[k] = a[k] + (e.burst and target * w * strength or (target - a[k]) * min(1, w * strength))
    end
    if e.noise ~= 0 then
      a[k] = a[k] + e.noise * w * strength * (2 * valueNoise(seed, index, cycle, axis == 2 and 3 or 2, px, py) - 1)
    end
  end
  for j = y0, y1 do
    for i = x0, x1 + 1 do
      local k = j * (W + 1) + i + 1
      if not g.uFixed[k] then
        drive(u, k, i + 0.0, j + 0.5, 1)
      end
    end
  end
  for j = y0, y1 + 1 do
    for i = x0, x1 do
      local k = j * W + i + 1
      if not g.vFixed[k] then
        drive(v, k, i + 0.5, j + 0.0, 2)
      end
    end
  end
  return here
end

-- src/fluid.js:1793 (c915af9), active.
-- Tests whether this cycle lies in the emission window.
local function active(e, cycle)
  if e.burst then
    return cycle == e.start
  end
  return cycle >= e.start and cycle < e.finish
end

-- src/fluid.js:4228-4244 (c915af9), emitFrame (gas branch).
-- Emits in source order, sampling moving orbits along their path.
function emit.frame(run, t, cycle)
  local effect, state = run.effect, run.state
  local here = {}
  for c = 1, #state.source do
    state.source[c] = 0.0
  end
  -- Source order and the zero-based random index (index - 1) are part of the bake.
  for index, e in ipairs(effect.emitters) do
    if active(e, cycle) then
      local steps = 1
      if e.orbit and not e.burst and not e.carry and t ~= 0
        and active(e, effect.loop and (cycle + effect.frames - 1) % effect.frames or cycle - 1) then
        steps = max(1, ceil(2 * 3.141592653589793 * max(e.orbit.radius[1], e.orbit.radius[2]) / abs(e.orbit.period)))
      end
      for k = 1, steps - 1 do
        emitGas(state.g, state, e, index - 1, cycle, effect.seed, cycle - 1 + k / steps, 1 / steps)
      end
      here[index] = emitGas(state.g, state, e, index - 1, cycle, effect.seed, cycle, 1 / steps)
    else
      here[index] = false
    end
  end
  return here
end

-- src/fluid.js:1875-1884 (c915af9), deposit.
-- Distributes an amount among surrounding open cells.
function emit.deposit(a, solid, W, H, x, y, value)
  local fx, fy = x - 0.5, y - 0.5
  local i, j = floor(fx), floor(fy)
  local s, t = fx - i, fy - j
  local w00 = (i >= 0 and j >= 0 and i < W and j < H and not solid[j * W + i + 1]) and (1 - s) * (1 - t) or 0.0
  local w10 = (i + 1 >= 0 and j >= 0 and i + 1 < W and j < H and not solid[j * W + i + 2]) and s * (1 - t) or 0.0
  local w01 = (i >= 0 and j + 1 >= 0 and i < W and j + 1 < H and not solid[(j + 1) * W + i + 1]) and (1 - s) * t or 0.0
  local w11 = (i + 1 >= 0 and j + 1 >= 0 and i + 1 < W and j + 1 < H and not solid[(j + 1) * W + i + 2]) and s * t or 0.0
  -- Accumulate and deposit in 00, 10, 01, 11 order to retain the reference rounding.
  local sum = w00 + w10 + w01 + w11
  if sum <= 0 then
    return
  end
  if w00 ~= 0 then
    local c = j * W + i + 1
    a[c] = a[c] + w00 / sum * value
  end
  if w10 ~= 0 then
    local c = j * W + i + 2
    a[c] = a[c] + w10 / sum * value
  end
  if w01 ~= 0 then
    local c = (j + 1) * W + i + 1
    a[c] = a[c] + w01 / sum * value
  end
  if w11 ~= 0 then
    local c = (j + 1) * W + i + 2
    a[c] = a[c] + w11 / sum * value
  end
end

-- src/fluid.js:1888-1902 (c915af9), stopShort.
-- Stops a carrier just inside its last open cell.
local function stopShort(solid, W, H, p, x1, y1)
  local x0, y0 = p.x, p.y
  local dx, dy = x1 - x0, y1 - y0
  local si, sj = dx > 0 and 1 or dx < 0 and -1 or 0, dy > 0 and 1 or dy < 0 and -1 or 0
  local i, j = floor(x0), floor(y0)
  local li, lj, t = i, j, 1
  local tx, ty = si ~= 0 and ((si > 0 and i + 1 or i) - x0) / dx or 2, sj ~= 0 and ((sj > 0 and j + 1 or j) - y0) / dy or 2
  local stepX, stepY = si ~= 0 and si / dx or 0, sj ~= 0 and sj / dy or 0
  for n = abs(floor(x1) - i) + abs(floor(y1) - j), 1, -1 do
    local enter
    if tx < ty then
      enter = tx
      i = i + si
      tx = tx + stepX
    else
      enter = ty
      j = j + sj
      ty = ty + stepY
    end
    if i < 0 or j < 0 or i >= W or j >= H or solid[j * W + i + 1] then
      t = enter
      break
    end
    li, lj = i, j
  end
  local x, y = x0 + dx * t, y0 + dy * t
  p.x = x < li + 0.01 and li + 0.01 or x > li + 0.99 and li + 0.99 or x
  p.y = y < lj + 0.01 and lj + 0.01 or y > lj + 0.99 and lj + 0.99 or y
end

-- src/fluid.js:1903-1927 (c915af9), moveCarriers.
-- Moves carriers and deposits their released smoke and heat.
function emit.moveCarriers(state, dt)
  local g, d, T, list = state.g, state.d, state.T, state.carriers
  local W, H, u, v, solid = g.W, g.H, g.u, g.v, g.pixels
  local kept = 0
  local count = #list
  for k = 1, count do
    local p = list[k]
    local drag, release, gravity = p.carry.drag, p.carry.release, p.carry.gravity
    -- JS += evaluates the entire RHS before adding it to the old velocity.
    -- Keep the drag and gravity terms grouped together, including their final addition.
    p.vx = p.vx + ((grid.sampleU(g, u, p.x, p.y) - p.vx) * drag * dt + gravity[1] * dt)
    p.vy = p.vy + ((grid.sampleV(g, v, p.x, p.y) - p.vy) * drag * dt + gravity[2] * dt)
    if p.vx > 32 then
      p.vx = 32
    elseif p.vx < -32 then
      p.vx = -32
    end
    if p.vy > 32 then
      p.vy = 32
    elseif p.vy < -32 then
      p.vy = -32
    end
    local nx, ny = p.x + p.vx * dt, p.y + p.vy * dt
    local walls = g.walls
    local closed = (nx < 0 and walls.left) or (nx >= W and walls.right) or (ny < 0 and walls.top) or (ny >= H and walls.bottom)
    if closed or not (nx < 0 or ny < 0 or nx >= W or ny >= H) then
      local hit = closed or grid.crossesSolid(solid, W, H, p.x, p.y, nx, ny) or solid[floor(ny) * W + floor(nx) + 1]
      if not hit then
        p.x = nx
        p.y = ny
      else
        stopShort(solid, W, H, p, nx, ny)
      end
      local part = hit and 1 or release * dt
      local dd, tt = p.d * part, p.T * part
      if dd ~= 0 then
        emit.deposit(d, solid, W, H, p.x, p.y, dd)
      end
      if tt ~= 0 then
        emit.deposit(T, solid, W, H, p.x, p.y, tt)
      end
      p.d = p.d - dd
      p.T = p.T - tt
      if not hit and not (p.d < 0.002 and p.T < 0.002) then
        kept = kept + 1
        list[kept] = p
      end
    end
  end
  -- Stable compaction preserves deposit order; clear stale entries so #list stays exact.
  for k = kept + 1, count do
    list[k] = nil
  end
end

return emit
