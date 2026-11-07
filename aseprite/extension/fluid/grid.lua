local use = ...
-- Staggered velocity grid, pressure projection, advection and cell traversal.
-- Used by gas, emit, look, sparks and obstacles.

local craft = use("fluid/craft")
local grid = {}
local floor, sqrt, abs = math.floor, math.sqrt, math.abs
-- Physical coordinates stay zero-based; every flat array address adds one.
-- Keep field aliases outside the cell loops and reuse the scratch arrays.
local zeros = craft.zeros

-- src/fluid.js:739-748 (c915af9), bilinear.
-- Samples a field with its boundary values extended.
function grid.bilinear(a, nx, ny, fx, fy)
  if fx < 0 then
    fx = 0
  elseif fx > nx - 1 then
    fx = nx - 1
  end
  if fy < 0 then
    fy = 0
  elseif fy > ny - 1 then
    fy = ny - 1
  end
  local i, j = floor(fx), floor(fy)
  if i > nx - 2 then
    i = nx - 2
  end
  if j > ny - 2 then
    j = ny - 2
  end
  local s, t, k = fx - i, fy - j, j * nx + i + 1
  return (a[k] * (1 - s) + a[k + 1] * s) * (1 - t) + (a[k + nx] * (1 - s) + a[k + nx + 1] * s) * t
end

-- src/fluid.js:749-756 (c915af9), bilinearZero.
-- Samples a field with zero outside the grid.
function grid.bilinearZero(a, nx, ny, fx, fy)
  if fx <= -1 or fy <= -1 or fx >= nx or fy >= ny then
    return 0.0
  end
  local i, j = floor(fx), floor(fy)
  local s, t, k = fx - i, fy - j, j * nx + i + 1
  if i >= 0 and j >= 0 and i < nx - 1 and j < ny - 1 then
    return (a[k] * (1 - s) + a[k + 1] * s) * (1 - t) + (a[k + nx] * (1 - s) + a[k + nx + 1] * s) * t
  end
  local left, right, top, bottom = i >= 0, i + 1 < nx, j >= 0, j + 1 < ny
  local a00, a10, a01, a11 =
    left and top and a[k] or 0.0,
    right and top and a[k + 1] or 0.0,
    left and bottom and a[k + nx] or 0.0,
    right and bottom and a[k + nx + 1] or 0.0
  return (a00 * (1 - s) + a10 * s) * (1 - t) + (a01 * (1 - s) + a11 * s) * t
end
local bilinear, bilinearZero = grid.bilinear, grid.bilinearZero

-- src/fluid.js:980 (c915af9), sampleU.
-- Samples the staggered horizontal velocity.
function grid.sampleU(g, a, x, y)
  return bilinear(a, g.W + 1, g.H, x, y - 0.5)
end

-- src/fluid.js:981 (c915af9), sampleV.
-- Samples the staggered vertical velocity.
function grid.sampleV(g, a, x, y)
  return bilinear(a, g.W, g.H + 1, x - 0.5, y)
end
local sampleU, sampleV = grid.sampleU, grid.sampleV

-- src/fluid.js:761-781 (c915af9), fixFaces / createGrid.
-- Builds fixed-face masks and reusable solver arrays.
function grid.create(W, H, solid, walls)
  local N, U, V = W * H, (W + 1) * H, W * (H + 1)
  local uFixed, vFixed = {}, {}
  for j = 0, H - 1 do
    for i = 0, W do
      local fixed
      if i == 0 then
        fixed = walls.left or solid[j * W + 1]
      elseif i == W then
        fixed = walls.right or solid[j * W + W]
      else
        fixed = solid[j * W + i] or solid[j * W + i + 1]
      end
      uFixed[j * (W + 1) + i + 1] = fixed or false
    end
  end
  for j = 0, H do
    for i = 0, W - 1 do
      local fixed
      if j == 0 then
        fixed = walls.top or solid[i + 1]
      elseif j == H then
        fixed = walls.bottom or solid[(H - 1) * W + i + 1]
      else
        fixed = solid[(j - 1) * W + i + 1] or solid[j * W + i + 1]
      end
      vFixed[j * W + i + 1] = fixed or false
    end
  end
  return {
    W = W,
    H = H,
    N = N,
    solid = solid,
    pixels = solid,
    walls = walls,
    uFixed = uFixed,
    vFixed = vFixed,
    u = zeros(U),
    v = zeros(V),
    u0 = zeros(U),
    v0 = zeros(V),
    p = zeros(N),
    div = zeros(N),
    count = zeros(N)
  }
end

-- src/fluid.js:983-987 (c915af9), enforce.
-- Sets fixed faces to their wall velocities.
function grid.enforce(g)
  local u, v, uFixed, vFixed, uWall, vWall = g.u, g.v, g.uFixed, g.vFixed, g.uWall, g.vWall
  for k = 1, #u do
    if uFixed[k] then
      u[k] = uWall and uWall[k] or 0.0
    end
  end
  for k = 1, #v do
    if vFixed[k] then
      v[k] = vWall and vWall[k] or 0.0
    end
  end
end

-- src/fluid.js:993-1028 (c915af9), project (pixel gas branch).
-- Solves pressure and subtracts its face gradients.
function grid.project(g, active, iterations, target)
  local W, H, u, v, p, div, solid, walls, count = g.W, g.H, g.u, g.v, g.p, g.div, g.solid, g.walls, g.count
  local X = W + 1
  for j = 0, H - 1 do
    for i = 0, W - 1 do
      local c = j * W + i + 1
      if not active[c] then
        p[c] = 0.0
        count[c] = 0
      else
        div[c] = u[j * X + i + 2] - u[j * X + i + 1] + v[(j + 1) * W + i + 1] - v[j * W + i + 1] - target[c]
        local a, b, d, e
        if i > 0 then
          a = solid[c - 1] and 0 or 1
        else
          a = walls.left and 0 or 1
        end
        if i < W - 1 then
          b = solid[c + 1] and 0 or 1
        else
          b = walls.right and 0 or 1
        end
        if j > 0 then
          d = solid[c - W] and 0 or 1
        else
          d = walls.top and 0 or 1
        end
        if j < H - 1 then
          e = solid[c + W] and 0 or 1
        else
          e = walls.bottom and 0 or 1
        end
        count[c] = a + b + d + e
      end
    end
  end
  -- In-place Gauss-Seidel: row-major cells and left/right/up/down summation are exact.
  -- Preserve both the traversal and the grouped RHS of the pressure update.
  for it = 1, iterations do
    for j = 0, H - 1 do
      for i = 0, W - 1 do
        local c = j * W + i + 1
        local n = count[c]
        if n ~= 0 then
          local sum = 0.0
          if i > 0 and active[c - 1] then
            sum = sum + p[c - 1]
          end
          if i < W - 1 and active[c + 1] then
            sum = sum + p[c + 1]
          end
          if j > 0 and active[c - W] then
            sum = sum + p[c - W]
          end
          if j < H - 1 and active[c + W] then
            sum = sum + p[c + W]
          end
          p[c] = p[c] + 1.6 * ((sum - div[c]) / n - p[c])
        end
      end
    end
  end
  local uFixed, vFixed = g.uFixed, g.vFixed
  for j = 0, H - 1 do
    for i = 0, W do
      local k = j * X + i + 1
      if not uFixed[k] then
        local l, r = i > 0 and active[j * W + i], i < W and active[j * W + i + 1]
        if l or r then
          u[k] = u[k] - ((r and p[j * W + i + 1] or 0.0) - (l and p[j * W + i] or 0.0))
        end
      end
    end
  end
  for j = 0, H do
    for i = 0, W - 1 do
      local k = j * W + i + 1
      if not vFixed[k] then
        local t, b = j > 0 and active[(j - 1) * W + i + 1], j < H and active[j * W + i + 1]
        if t or b then
          v[k] = v[k] - ((b and p[j * W + i + 1] or 0.0) - (t and p[(j - 1) * W + i + 1] or 0.0))
        end
      end
    end
  end
end

-- src/fluid.js:1329-1344 (c915af9), advectVelocity.
-- Back-traces each velocity face through the old flow.
function grid.advectVelocity(g, dt)
  local W, H, u, v, u0, v0, uFixed, vFixed = g.W, g.H, g.u, g.v, g.u0, g.v0, g.uFixed, g.vFixed
  for k = 1, #u do
    u0[k] = u[k]
  end
  for k = 1, #v do
    v0[k] = v[k]
  end
  for j = 0, H - 1 do
    for i = 0, W do
      local k = j * (W + 1) + i + 1
      if not uFixed[k] then
        -- The float coordinate preserves JS Number arithmetic at integer face positions.
        local x, y, ax, ay = i + 0.0, j + 0.5, u0[k], sampleV(g, v0, i, j + 0.5)
        local mx, my = x - 0.5 * dt * ax, y - 0.5 * dt * ay
        u[k] = sampleU(g, u0, x - dt * sampleU(g, u0, mx, my), y - dt * sampleV(g, v0, mx, my))
      end
    end
  end
  for j = 0, H do
    for i = 0, W - 1 do
      local k = j * W + i + 1
      if not vFixed[k] then
        local x, y, ax, ay = i + 0.5, j + 0.0, sampleU(g, u0, i + 0.5, j), v0[k]
        local mx, my = x - 0.5 * dt * ax, y - 0.5 * dt * ay
        v[k] = sampleV(g, v0, x - dt * sampleU(g, u0, mx, my), y - dt * sampleV(g, v0, mx, my))
      end
    end
  end
end

-- src/fluid.js:1347-1360 (c915af9), advectScalars (smooth branch).
-- Back-traces density and temperature together.
function grid.advectScalars(g, dt, d, d1, T, T1)
  local W, H, u, v, solid = g.W, g.H, g.u, g.v, g.solid
  for j = 0, H - 1 do
    for i = 0, W - 1 do
      local c = j * W + i + 1
      if solid[c] then
        d1[c] = 0.0
        T1[c] = 0.0
      else
        local x, y = i + 0.5, j + 0.5
        local ax, ay = sampleU(g, u, x, y), sampleV(g, v, x, y)
        local mx, my = x - 0.5 * dt * ax, y - 0.5 * dt * ay
        local bx, by = x - dt * sampleU(g, u, mx, my) - 0.5, y - dt * sampleV(g, v, mx, my) - 0.5
        d1[c] = bilinearZero(d, W, H, bx, by)
        T1[c] = bilinearZero(T, W, H, bx, by)
      end
    end
  end
end

-- src/fluid.js:1740-1755 (c915af9), confine.
-- Adds vorticity confinement from the curl gradient.
function grid.confine(g, strength, dt, curl, magnitude)
  local W, H, u, v, solid = g.W, g.H, g.u, g.v, g.solid
  local X = W + 1
  for j = 1, H - 2 do
    for i = 1, W - 2 do
      local k = j * W + i + 1
      local a = (j + 1) * X + i + 1
      local b = (j - 1) * X + i + 1
      local w = ((v[k + 1] + v[k + W + 1]) * 0.5 - (v[k - 1] + v[k + W - 1]) * 0.5) * 0.5
        - ((u[a] + u[a + 1]) * 0.5 - (u[b] + u[b + 1]) * 0.5) * 0.5
      curl[k] = w
      magnitude[k] = w < 0 and -w or w
    end
  end
  for j = 2, H - 3 do
    for i = 2, W - 3 do
      local c = j * W + i + 1
      if not solid[c] then
        local nx, ny = (magnitude[c + 1] - magnitude[c - 1]) * 0.5, (magnitude[c + W] - magnitude[c - W]) * 0.5
        local length = sqrt(nx * nx + ny * ny) + 1e-6
        local fx, fy = strength * (ny / length) * curl[c] * dt, -strength * (nx / length) * curl[c] * dt
        local k = j * X + i + 1
        u[k] = u[k] + fx * 0.5
        u[k + 1] = u[k + 1] + fx * 0.5
        v[c] = v[c] + fy * 0.5
        v[c + W] = v[c + W] + fy * 0.5
      end
    end
  end
end

-- src/fluid.js:1761-1772 (c915af9), crossesSolid.
-- Walks every crossed cell to detect a solid.
function grid.crossesSolid(solid, W, H, x0, y0, x1, y1)
  local i, j = floor(x0), floor(y0)
  local dx, dy = x1 - x0, y1 - y0
  local si, sj = dx > 0 and 1 or dx < 0 and -1 or 0, dy > 0 and 1 or dy < 0 and -1 or 0
  local tx, ty = si ~= 0 and ((si > 0 and i + 1 or i) - x0) / dx or 2, sj ~= 0 and ((sj > 0 and j + 1 or j) - y0) / dy or 2
  local stepX, stepY = si ~= 0 and si / dx or 0, sj ~= 0 and sj / dy or 0
  -- Equal crossing times take y first; changing this can skip a corner-touching solid.
  for n = abs(floor(x1) - i) + abs(floor(y1) - j), 1, -1 do
    if tx < ty then
      i = i + si
      tx = tx + stepX
    else
      j = j + sj
      ty = ty + stepY
    end
    if i >= 0 and j >= 0 and i < W and j < H and solid[j * W + i + 1] then
      return true
    end
  end
  return false
end

return grid
