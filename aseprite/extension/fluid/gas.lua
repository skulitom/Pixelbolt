local use = ...
-- Gas state, substep order and cell-centred output fields.
-- Used by compile; numerical fields retain the JavaScript names d, T, d1 and T1.

local craft = use("fluid/craft")
local grid = use("fluid/grid")
local emit = use("fluid/emit")
local gas = {}
local zeros, sqrt = craft.zeros, math.sqrt

-- src/fluid.js:1930-1937 (c915af9), createGas.
-- Allocates the gas state and optional carrier storage.
function gas.create(effect, W, H)
  local g = grid.create(W, H, effect.solid, effect.walls)
  local N = g.N
  local state = {
    g = g,
    d = zeros(N),
    T = zeros(N),
    source = zeros(N),
    d1 = zeros(N),
    T1 = zeros(N),
    curl = zeros(N),
    magnitude = zeros(N),
    open = {}
  }
  for c = 1, N do
    state.open[c] = not g.solid[c]
  end
  for _, e in ipairs(effect.emitters) do
    if e.carry then
      state.carriers = {}
      state.carriedD = zeros(N)
      state.carriedT = zeros(N)
      break
    end
  end
  return state
end

-- src/fluid.js:1940-1968 (c915af9), stepGas (supported gas branch).
-- Advances forces, flow, scalar fields and carriers in order.
function gas.step(state, effect, dt)
  local g, d, T, d1, T1 = state.g, state.d, state.T, state.d1, state.T1
  local W, H, u, v = g.W, g.H, g.u, g.v
  if effect.buoyancy ~= 0 or effect.weight ~= 0 then
    for j = 1, H - 1 do
      for i = 0, W - 1 do
        local k = j * W + i + 1
        local a = k - W
        -- The final + 0 is the supported wind default; retain it even for signed zero.
        v[k] = v[k] + dt * (-effect.buoyancy * (T[a] + T[k]) * 0.5 + effect.weight * (d[a] + d[k]) * 0.5 + 0)
      end
    end
  end
  if effect.vorticity ~= 0 then
    grid.confine(g, effect.vorticity, dt, state.curl, state.magnitude)
  end
  -- Keep force, enforcement, advection, drag and projection in this order.
  grid.enforce(g)
  grid.advectVelocity(g, dt)
  if effect.drag ~= 0 then
    local keep = 1 - effect.drag * dt
    for k = 1, #u do
      u[k] = u[k] * keep
    end
    for k = 1, #v do
      v[k] = v[k] * keep
    end
  end
  grid.enforce(g)
  grid.project(g, state.open, effect.iterations, state.source)
  for k = 1, #u do
    if u[k] > 32 then
      u[k] = 32.0
    elseif u[k] < -32 then
      u[k] = -32.0
    end
  end
  for k = 1, #v do
    if v[k] > 32 then
      v[k] = 32.0
    elseif v[k] < -32 then
      v[k] = -32.0
    end
  end
  grid.advectScalars(g, dt, d, d1, T, T1)
  local fade, cool = 1 - effect.dissipation * dt, 1 - effect.cooling * dt
  for c = 1, g.N do
    d[c] = d1[c] * fade
    T[c] = T1[c] * cool
  end
  if state.carriers then
    emit.moveCarriers(state, dt)
  end
end

-- src/fluid.js:4246-4264 (c915af9), solveFrame (gas branch).
-- Runs the fixed substeps of one frame.
function gas.solve(run)
  local effect = run.effect
  local dt = 1 / effect.substeps
  for i = 1, effect.substeps do
    gas.step(run.state, effect, dt)
  end
end

-- src/fluid.js:1969-1983 (c915af9), gasFields.
-- Collects density, temperature and speed including carried amounts.
function gas.fields(state, out)
  local g, d, T = state.g, state.d, state.T
  local W, H, u, v = g.W, g.H, g.u, g.v
  local density, temperature, speed = out[1], out[2], out[3]
  for j = 0, H - 1 do
    for i = 0, W - 1 do
      local c = j * W + i + 1
      local k = j * (W + 1) + i + 1
      local x, y = (u[k] + u[k + 1]) * 0.5, (v[c] + v[c + W]) * 0.5
      density[c] = d[c]
      temperature[c] = T[c]
      speed[c] = sqrt(x * x + y * y)
    end
  end
  if state.carriers then
    local carriedD, carriedT = state.carriedD, state.carriedT
    for c = 1, g.N do
      carriedD[c] = 0.0
      carriedT[c] = 0.0
    end
    for _, p in ipairs(state.carriers) do
      if p.d ~= 0 then
        emit.deposit(carriedD, g.pixels, W, H, p.x, p.y, p.d)
      end
      if p.T ~= 0 then
        emit.deposit(carriedT, g.pixels, W, H, p.x, p.y, p.T)
      end
    end
    for c = 1, g.N do
      density[c] = density[c] + carriedD[c]
      temperature[c] = temperature[c] + carriedT[c]
    end
  end
end

return gas
