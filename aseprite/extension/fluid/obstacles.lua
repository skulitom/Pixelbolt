local use = ...
-- Moving pixel obstacles, wall velocities and displaced gas fields.
-- Used by compile; read builds layouts and grid rebuilds the solver masks.

local craft = use("fluid/craft")
local reader = use("fluid/read")
local grid = use("fluid/grid")
local obstacles = {}
local floor, ceil, sqrt = math.floor, math.ceil, math.sqrt

-- src/fluid.js:309,4013-4015 (c915af9), layoutKey / moveObstacles (Lua comparison).
-- Detects a change in visible pixel placements.
local function changedPlaces(a, b)
  for i, p in ipairs(a) do
    local q = b[i]
    if p.show ~= q.show or (p.show and (p.x ~= q.x or p.y ~= q.y)) then
      return true
    end
  end
  return false
end

-- src/fluid.js:381-394,4012-4215 (c915af9), solidLayer / moveObstacles (gas branch).
-- Rebuilds masks, moves walls and displaces covered gas.
function obstacles.move(run, cycle)
  local effect, state = run.effect, run.state
  local places = reader.places(effect.obstacles, cycle)
  local before = run.layout
  local g = state.g
  local W, H = g.W, g.H
  local X = W + 1
  local changed = changedPlaces(places, before.places)
  if changed then
    local layout = reader.layout(effect.obstacles, W, H, places)
    run.layout = layout
    local view = {}
    for k, v in pairs(effect) do
      view[k] = v
    end
    view.solid = layout.solid
    view.front = layout.front
    run.view = view
    local nextGrid = grid.create(W, H, view.solid, effect.walls)
    for i = 1, #g.u do
      nextGrid.u[i] = g.u[i]
    end
    for i = 1, #g.v do
      nextGrid.v[i] = g.v[i]
    end
    for i = 1, #g.p do
      nextGrid.p[i] = g.p[i]
    end
    state.g = nextGrid
    g = nextGrid
    for c = 1, g.N do
      state.open[c] = not g.solid[c]
    end
  end
  local layout = run.layout
  local owner = layout.owner
  local speed, moving = {}, false
  for i, at in ipairs(places) do
    if at.show and ((at.vx or 0) ~= 0 or (at.vy or 0) ~= 0) then
      speed[i] = {at.vx, at.vy}
      moving = true
    end
  end

  -- src/fluid.js:390,4053 (c915af9), solidLayer.velocity / moveObstacles.of.
  -- Finds the moving obstacle velocity at a cell.
  local function of(c)
    return c and owner[c] and speed[owner[c]]
  end
  if moving or g.moved or changed then
    if not g.uWall then
      g.uWall = craft.zeros(#g.u)
      g.vWall = craft.zeros(#g.v)
    else
      for k = 1, #g.uWall do
        g.uWall[k] = 0.0
      end
      for k = 1, #g.vWall do
        g.vWall[k] = 0.0
      end
    end
    g.moved = false
    for j = 0, H - 1 do
      for i = 0, W do
        local s = of(i > 0 and j * W + i) or of(i < W and j * W + i + 1)
        if s then
          g.uWall[j * X + i + 1] = s[1]
          g.moved = true
        end
      end
    end
    for j = 0, H do
      for i = 0, W - 1 do
        local k = j * W + i + 1
        local s = of(j > 0 and k - W) or of(j < H and k)
        if s then
          g.vWall[k] = s[2]
          g.moved = true
        end
      end
    end
    grid.enforce(g)
  end
  if not changed then
    return
  end
  local shift = {}
  for i, o in ipairs(effect.obstacles) do
    local at, was = places[i], before.places[i]
    if at.show and was.show and not at.jump and cycle > 0 and (at.x ~= was.x or at.y ~= was.y) then
      shift[i] = {at.x - was.x + 0.0, at.y - was.y + 0.0}
    end
  end
  -- Like owner, swept uses one-based obstacle indices and 0 instead of JS -1.
  local swept = craft.zeros(g.N, 0)
  for i, o in ipairs(effect.obstacles) do
    local s = shift[i]
    if s then
      local was = before.places[i]
      local steps = ceil(2 * sqrt(s[1] * s[1] + s[2] * s[2]))
      for j, row in ipairs(o.rows) do
        for k, code in ipairs(row) do
          if code ~= 0 then
            for step = 1, steps - 1 do
              local px, py = floor(was.x + k - 1 + 0.5 + s[1] * step / steps), floor(was.y + j - 1 + 0.5 + s[2] * step / steps)
              if px >= 0 and py >= 0 and px < W and py < H then
                local c = py * W + px + 1
                if swept[c] == 0 then
                  swept[c] = i
                end
              end
            end
          end
        end
      end
    end
  end
  local solid = layout.solid

  -- src/fluid.js:4064 (c915af9), moveObstacles.covered.
  -- Tests whether a formerly open cell is now solid.
  local function covered(c)
    return solid[c] and not before.solid[c]
  end

  -- src/fluid.js:4093 (c915af9), moveObstacles.passed.
  -- Tests whether an obstacle swept through an open cell.
  local function passed(c)
    return swept[c] ~= 0 and not solid[c] and not before.solid[c]
  end

  -- src/fluid.js:4118-4129 (c915af9), moveObstacles.landing.
  -- Finds the first reachable open cell along the obstacle move.
  local function landing(x, y, o, s)
    local length = sqrt(s[1] * s[1] + s[2] * s[2])
    local ux, uy = s[1] / length, s[2] / length
    for step = 1, 2 * length + 4 do
      local px, py = x + 0.5 * step * ux, y + 0.5 * step * uy
      if px < 0 or py < 0 or px >= W or py >= H then
        return nil
      end
      local c = floor(py) * W + floor(px) + 1
      if not solid[c] then
        if not (passed(c) and swept[c] == o) then
          return c
        end
      elseif owner[c] ~= o or not covered(c) then
        return nil
      end
    end
    return nil
  end
  local d, T = state.d, state.T
  -- Displace cells in reference scan order: later cells can receive earlier deposits.
  for c = 1, g.N do
    if (covered(c) or passed(c)) and (d[c] ~= 0 or T[c] ~= 0) then
      local o = covered(c) and owner[c] or swept[c]
      local s = shift[o]
      local to = s and landing((c - 1) % W + 0.5, floor((c - 1) / W) + 0.5, o, s)
      if to then
        d[to] = d[to] + d[c]
        T[to] = T[to] + T[c]
      end
      d[c] = 0.0
      T[c] = 0.0
    end
  end
end

return obstacles
