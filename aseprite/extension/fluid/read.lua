local use = ...
-- Validation and defaults for the supported gas source, looks and obstacle tracks.
-- Used by compile and obstacles; unsupported fields retain the existing validation.

local craft = use("fluid/craft")
local reader = {}
local floor, min, max, sqrt = math.floor, math.min, math.max, math.sqrt

-- src/fluid.js:55 (c915af9), fail.
-- Reports a validation error at its source path.
local function fail(path, message)
  error(path .. ': ' .. message, 0)
end

-- src/fluid.js:61-64 (c915af9), number.
-- Validates a finite scalar and keeps solver inputs as doubles.
local function number(value, path, min, max)
  if type(value) ~= 'number' or value ~= value or value < min or value > max then
    fail(path, 'expected number from ' .. min .. ' to ' .. max)
  end
  -- Force floating-point arithmetic for JS Number values; integer settings stay separate.
  return value * 1.0
end

-- src/fluid.js:65-68 (c915af9), integer.
-- Validates and stores an integer setting.
local function integer(value, path, min, max)
  number(value, path, min, max)
  if value ~= floor(value) then
    fail(path, 'expected integer')
  end
  return math.tointeger(value)
end

-- src/fluid.js:69 (c915af9), boolean.
-- Validates an explicit Boolean setting.
local function boolean(value, path)
  if type(value) ~= 'boolean' then
    fail(path, 'expected boolean')
  end
  return value
end

-- src/fluid.js:56 (c915af9), isObject (Lua table adapter).
-- Checks the table used for an object or array.
local function object(value, path)
  if type(value) ~= 'table' then
    fail(path, 'expected table')
  end
  return value
end

-- src/fluid.js:98,165,203,474 (c915af9), fields calls (Lua adapter).
-- Checks the existing gas-subset field allowlist.
local function fields(value, path, names)
  object(value, path)
  local allowed = {}
  for name in names:gmatch('%S+') do
    allowed[name] = true
  end
  for k in pairs(value) do
    if not allowed[k] then
      fail(path .. '.' .. tostring(k), 'unsupported field')
    end
  end
end

-- src/fluid.js:57-60 (c915af9), identifier.
-- Validates a source or effect identifier.
local function identifier(value, path)
  if type(value) ~= 'string' or #value > 64 or not value:match('^[A-Za-z][A-Za-z0-9_-]*$') then
    fail(path, 'expected identifier')
  end
end

-- src/fluid.js:70-84,112,209-211 (c915af9), pair / range / readSparks / readLook (Lua helper).
-- Validates an array length.
local function list(value, path, min, max)
  object(value, path)
  if #value < min or #value > max then
    fail(path, 'invalid list length')
  end
  return value
end

-- src/fluid.js:70-73 (c915af9), pair.
-- Reads a two-number vector.
local function pair(value, path, min, max)
  list(value, path, 2, 2)
  return {number(value[1], path .. '[0]', min, max), number(value[2], path .. '[1]', min, max)}
end

-- src/fluid.js:97-106,183-195 (c915af9), readCycle / readEmitter (nullish-default adapter).
-- Defaults only absent values, preserving false and zero.
local function defaultValue(value, fallback)
  if value == nil then
    return fallback
  else
    return value
  end
end

-- src/fluid.js:75-85 (c915af9), range.
-- Reads a scalar or an ordered pair of bounds.
local function range(value, path, min, max, whole)
  local check = whole and integer or number
  if type(value) ~= 'table' then
    local n = check(value, path, min, max)
    return {n, n}
  end
  list(value, path, 2, 2)
  local a, b = check(value[1], path .. '[0]', min, max), check(value[2], path .. '[1]', min, max)
  if a > b then
    fail(path, 'min exceeds max')
  end
  return {a, b}
end

-- src/fluid.js:89-92,226 (c915af9), paletteKey / readLook.
-- Validates a palette key and stores its numeric code.
local function paletteKey(value, path, palette)
  if type(value) ~= 'string' or utf8.len(value) ~= 1 or value == '.' or value == ' ' or not palette[value] then
    fail(path, 'expected palette key')
  end
  -- The source palette is restricted to BMP keys below: Uint16 writes cannot wrap.
  return utf8.codepoint(value)
end

-- src/fluid.js:97-107 (c915af9), readCycle.
-- Reads an emitter pulse or orbit.
local function readCycle(value, path, frames, loop, orbit)
  fields(value, path, orbit and 'radius period phase' or 'amplitude period')
  local period = integer(defaultValue(value.period, frames), path .. '.period', orbit and -256 or 1, 256)
  -- Use JS remainder for negative orbit periods, as in readCycle.
  if period == 0 or (loop and math.fmod(frames, period) ~= 0) then
    fail(path .. '.period', 'invalid cycle period')
  end
  local r = {period = period, phase = number(defaultValue(value.phase, 0), path .. '.phase', -3600, 3600)}
  if orbit then
    if type(value.radius) == 'table' then
      r.radius = pair(value.radius, path .. '.radius', 0, 128)
    else
      local n = number(value.radius, path .. '.radius', 0, 128)
      r.radius = {n, n}
    end
  else
    r.amplitude = number(defaultValue(value.amplitude, 0.5), path .. '.amplitude', 0, 1)
  end
  return r
end

-- src/fluid.js:109-129 (c915af9), readSparks (gas subset).
-- Reads spark counts, lifetime, motion and supplied colours.
local function readSparks(value, path, palette, burst)
  fields(value, path, 'count life colors trail angle speed drag follow gravity')
  local colors = {}
  for i, k in ipairs(list(value.colors, path .. '.colors', 1, 16)) do
    colors[i] = paletteKey(k, path .. '.colors[' .. (i - 1) .. ']', palette)
  end
  return {
    count = number(value.count, path .. '.count', 0.01, burst and 256 or 16),
    life = range(defaultValue(value.life, {8, 16}), path .. '.life', 1, 256, true),
    colors = colors,
    trail = boolean(defaultValue(value.trail, false), path .. '.trail'),
    size = 1,
    angle = range(defaultValue(value.angle, {0, 360}), path .. '.angle', -3600, 3600),
    speed = range(defaultValue(value.speed, 0), path .. '.speed', 0, 16),
    gravity = pair(defaultValue(value.gravity, {0, 0}), path .. '.gravity', -2, 2),
    drag = number(defaultValue(value.drag, 0.05), path .. '.drag', 0, 1),
    follow = number(defaultValue(value.follow, 1), path .. '.follow', 0, 2)
  }
end

-- src/fluid.js:163-199 (c915af9), readEmitter (gas subset).
-- Reads an emitter and its optional carrying behaviour.
local function readEmitter(emitter, path, frames, loop, palette)
  fields(emitter, path,
    'name at area radius rate burst start end temperature density velocity noise flicker expand vortex falloff pulse orbit sparks carry'
  )
  if emitter.name ~= nil then
    identifier(emitter.name, path .. '.name')
  end
  if (emitter.burst == nil) == (emitter.rate == nil) then
    fail(path, 'use exactly one of rate and burst')
  end
  local burst = emitter.burst ~= nil
  local start = integer(defaultValue(emitter.start, 0), path .. '.start', 0, frames - 1)
  if burst and emitter['end'] ~= nil then
    fail(path .. '.end', 'end applies to rate emitters')
  end
  if emitter.radius ~= nil and emitter.area ~= nil then
    fail(path, 'use radius or area')
  end
  local parsed = {
    at = pair(emitter.at, path .. '.at', -256, 512),
    start = start,
    -- finish is JS end; end is a Lua keyword.
    finish = integer(defaultValue(emitter['end'], frames), path .. '.end', start + 1, frames),
    burst = burst,
    strength = number(burst and emitter.burst or emitter.rate, path .. (burst and '.burst' or '.rate'), 0.01, 64),
    density = number(defaultValue(emitter.density, 0), path .. '.density', -16, 16),
    temperature = number(defaultValue(emitter.temperature, 0), path .. '.temperature', -16, 16),
    falloff = number(defaultValue(emitter.falloff, 0), path .. '.falloff', 0, 1),
    velocity = pair(defaultValue(emitter.velocity, {0, 0}), path .. '.velocity', -16, 16),
    expand = number(defaultValue(emitter.expand, 0), path .. '.expand', -16, 16),
    vortex = number(defaultValue(emitter.vortex, 0), path .. '.vortex', -16, 16),
    noise = number(defaultValue(emitter.noise, 0), path .. '.noise', 0, 8),
    flicker = number(defaultValue(emitter.flicker, 0), path .. '.flicker', 0, 1)
  }
  parsed.steer = emitter.velocity ~= nil or parsed.vortex ~= 0
  if emitter.area ~= nil then
    parsed.area = pair(emitter.area, path .. '.area', 1, 128)
  else
    parsed.radius = number(defaultValue(emitter.radius, 2), path .. '.radius', 0.5, 64)
  end
  if emitter.pulse ~= nil then
    parsed.pulse = readCycle(emitter.pulse, path .. '.pulse', frames, loop, false)
  end
  if emitter.orbit ~= nil then
    parsed.orbit = readCycle(emitter.orbit, path .. '.orbit', frames, loop, true)
  end
  if emitter.sparks ~= nil then
    parsed.sparks = readSparks(emitter.sparks, path .. '.sparks', palette, burst)
  end
  if emitter.carry ~= nil then
    fields(emitter.carry, path .. '.carry', 'drag release gravity')
    if parsed.density < 0 or parsed.temperature < 0 or (parsed.density <= 0 and parsed.temperature <= 0) then
      fail(path .. '.carry', 'expected positive density or temperature')
    end
    parsed.carry = {
      drag = number(defaultValue(emitter.carry.drag, 0.1), path .. '.carry.drag', 0, 1),
      release = number(defaultValue(emitter.carry.release, 0.2), path .. '.carry.release', 0.01, 1),
      gravity = pair(defaultValue(emitter.carry.gravity, {0, 0}), path .. '.carry.gravity', -2, 2)
    }
  end
  return parsed
end

-- src/fluid.js:201-227,3692-3701 (c915af9), readLook / feathersOf.
-- Reads a look layer and caches its per-cell feathers.
local function readLook(layer, path, palette, seed, W, H)
  fields(layer, path, 'field colors thresholds dither pattern')
  if layer.field ~= 'density' and layer.field ~= 'temperature' and layer.field ~= 'light' and layer.field ~= 'shadow' then
    fail(path .. '.field', 'unsupported gas field')
  end
  local colors, thresholds, gaps = {}, {}, {}
  list(layer.colors, path .. '.colors', 1, 16)
  list(layer.thresholds, path .. '.thresholds', #layer.colors, #layer.colors)
  for i, k in ipairs(layer.colors) do
    colors[i] = paletteKey(k, path .. '.colors[' .. (i - 1) .. ']', palette)
    thresholds[i] = number(layer.thresholds[i], path .. '.thresholds[' .. (i - 1) .. ']', 0.001, 256)
    if i > 1 and thresholds[i] <= thresholds[i - 1] then
      fail(path .. '.thresholds', 'thresholds must rise')
    end
    gaps[i] = thresholds[i] - (i > 1 and thresholds[i - 1] or 0)
  end
  local pattern = defaultValue(layer.pattern, 'bayer4')
  if pattern ~= 'bayer4' and pattern ~= 'noise' and pattern ~= 'value' then
    fail(path .. '.pattern', 'unsupported pattern')
  end
  local dither = number(defaultValue(layer.dither, 0.5), path .. '.dither', 0, 1)
  local feathers = {}
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      feathers[y * W + x + 1] = (1 - craft.threshold(pattern, seed, x, y)) * dither
    end
  end
  return {
    field = layer.field,
    colors = colors,
    thresholds = thresholds,
    gaps = gaps,
    dither = dither,
    feathers = feathers
  }
end

-- src/fluid.js:259-294 (c915af9), readTrack.
-- Expands obstacle keys into per-frame positions and velocities.
local function readTrack(value, path, frames, home, rows, W, H)
  list(value, path, 1, 16)
  local last = -1
  local keys = {}
  for i, key in ipairs(value) do
    local kp = path .. '[' .. (i - 1) .. ']'
    fields(key, kp, 'frame over y')
    local f = integer(key.frame, kp .. '.frame', 0, frames - 1)
    if f < last then
      fail(kp .. '.frame', 'keys go in frame order')
    end
    last = f
    if key.x == nil and key.y == nil and key.show == nil then
      fail(kp, 'key must move or show obstacle')
    end
    local a = {frame = f, over = integer(defaultValue(key.over, 0), kp .. '.over', 0, 256)}
    if key.x ~= nil then
      a.x = integer(key.x, kp .. '.x', -#rows[1], W)
    end
    if key.y ~= nil then
      a.y = integer(key.y, kp .. '.y', -#rows, H)
    end
    if key.show ~= nil then
      a.show = boolean(key.show, kp .. '.show')
    end
    keys[i] = a
  end

  -- src/fluid.js:276-285 (c915af9), readTrack.along.
  -- Interpolates one axis and records discontinuous jumps.
  local function along(name)
    -- Keep interpolation in doubles even when a key begins at an integer coordinate.
    local raw, jumps = craft.zeros(frames, home[name] + 0.0), craft.zeros(frames, false)
    for _, key in ipairs(keys) do
      if key[name] ~= nil then
        local from = raw[key.frame + 1]
        if key.over == 0 and key[name] ~= from then
          jumps[key.frame + 1] = true
        end
        for f = key.frame, frames - 1 do
          raw[f + 1] = key.over ~= 0 and f < key.frame + key.over
            and from + (key[name] - from) * (f - key.frame) / key.over
            or key[name] + 0.0
        end
      end
    end
    return raw, jumps
  end
  local ax, jx = along('x')
  local ay, jy = along('y')
  local shows = craft.zeros(frames, true)
  local out = {}
  for _, key in ipairs(keys) do
    if key.show ~= nil then
      for f = key.frame, frames - 1 do
        shows[f + 1] = key.show
      end
    end
  end
  for f = 1, frames do
    local jump = jx[f] or jy[f] or (f > 1 and shows[f] ~= shows[f - 1])
    local still = f == 1 or jump
    -- This is explicitly floor(value + 0.5) in readTrack, not the quadrant round helper.
    local x, y = floor(ax[f] + 0.5), floor(ay[f] + 0.5)
    out[f] = {
      x = x,
      y = y,
      show = shows[f],
      jump = jump,
      vx = still and 0.0 or ax[f] - ax[f - 1],
      vy = still and 0.0 or ay[f] - ay[f - 1],
      dx = x - ax[f],
      dy = y - ay[f]
    }
  end
  return out
end

-- src/fluid.js:307 (c915af9), placementsAt.
-- Selects each obstacle placement for this cycle.
function reader.places(obstacles, cycle)
  local places = {}
  for i, o in ipairs(obstacles) do
    places[i] = o.track and o.track[cycle + 1] or {x = o.x, y = o.y, show = true}
  end
  return places
end

-- src/fluid.js:327-350 (c915af9), buildLayout (pixel obstacles).
-- Builds solid, front and owner masks in obstacle order.
function reader.layout(obstacles, W, H, places)
  -- Masks use Booleans (Lua zero is truthy); owners are one-based with 0 for none.
  -- The bounded owner indices never need the reference Int16Array wrapping.
  local solid, front, owner = craft.zeros(W * H, false), craft.zeros(W * H, false), craft.zeros(W * H, 0)
  for i, o in ipairs(obstacles) do
    local at = places[i]
    if at.show then
      for j, row in ipairs(o.rows) do
        local y = at.y + j - 1
        if y >= 0 and y < H then
          for k = max(1, 1 - at.x), min(#row, W - at.x) do
            if row[k] ~= 0 then
              local c = y * W + at.x + k
              solid[c] = true
              if owner[c] == 0 then
                owner[c] = i
              end
              if o.draw == 'over' then
                front[c] = true
              end
            end
          end
        end
      end
    end
  end
  return {solid = solid, front = front, owner = owner, places = places}
end

-- src/fluid.js:472-639,4942-4964 (c915af9), readEffect / buildRecipe (gas subset).
-- Validates the standalone source and builds its effect.
function reader.read(source)
  fields(source, 'fluid', 'format version name width height palette symbols effects')
  if source.format ~= 'pixelforge-fluid' or source.version ~= 1 then
    fail('fluid', 'expected version-1 pixelforge-fluid')
  end
  identifier(source.name, 'fluid.name')
  local W, H = integer(source.width, 'fluid.width', 4, 128), integer(source.height, 'fluid.height', 4, 128)
  local palette = object(defaultValue(source.palette, {}), 'fluid.palette')
  local symbols = {}
  for k, value in pairs(palette) do
    if type(k) ~= 'string' or utf8.len(k) ~= 1 or utf8.codepoint(k) > 65535 or k == '.' or k == ' ' then
      fail('fluid.palette.' .. tostring(k), 'expected one-character palette key')
    end
    if type(value) ~= 'string' or not value:match('^#%x%x%x%x%x%x$') then
      fail('fluid.palette.' .. k, 'expected opaque #rrggbb colour')
    end
  end
  for name, rows in pairs(object(defaultValue(source.symbols, {}), 'fluid.symbols')) do
    local path = 'fluid.symbols.' .. tostring(name)
    identifier(name, path)
    list(rows, path, 1, 128)
    local out = {}
    local width
    for j, row in ipairs(rows) do
      if type(row) ~= 'string' then
        fail(path, 'expected string rows')
      end
      local line = {}
      for _, code in utf8.codes(row) do
        local k = utf8.char(code)
        line[#line + 1] = (k == '.' or k == ' ') and 0 or paletteKey(k, path, palette)
      end
      width = width or #line
      if #line ~= width or width == 0 then
        fail(path, 'expected equal nonempty row widths')
      end
      out[j] = line
    end
    symbols[name] = out
  end
  object(source.effects, 'fluid.effects')
  local name, value = next(source.effects)
  if name == nil or next(source.effects, name) ~= nil then
    fail('fluid.effects', 'expected exactly one effect')
  end
  local path = 'fluid.effects.' .. tostring(name)
  identifier(name, path)
  fields(value, path,
    'kind frames duration loop seed walls buoyancy vorticity dissipation cooling drag weight substeps obstacles emitters look cleanup outline'
  )
  if defaultValue(value.kind, 'gas') ~= 'gas' then
    fail(path .. '.kind', 'expected gas')
  end
  local frames = integer(value.frames, path .. '.frames', 1, 256)
  local loop = boolean(defaultValue(value.loop, false), path .. '.loop')
  if loop and frames < 4 then
    fail(path .. '.frames', 'loop requires at least four frames')
  end
  local seed = integer(defaultValue(value.seed, 1), path .. '.seed', 0, 2147483647)
  local effect = {
    frames = frames,
    loop = loop,
    seed = seed,
    durations = {},
    emitters = {},
    look = {},
    obstacles = {},
    walls = {},
    moving = false,
    warmup = loop and 2 or 0,
    blend = loop and max(1, min(8, floor(frames / 3))) or 0,
    substeps = integer(defaultValue(value.substeps, 2), path .. '.substeps', 1, 16),
    iterations = 30,
    buoyancy = number(defaultValue(value.buoyancy, 0.15), path .. '.buoyancy', -2, 2),
    weight = number(defaultValue(value.weight, 0), path .. '.weight', -2, 2),
    vorticity = number(defaultValue(value.vorticity, 0.25), path .. '.vorticity', 0, 2),
    dissipation = number(defaultValue(value.dissipation, 0.03), path .. '.dissipation', 0, 1),
    cooling = number(defaultValue(value.cooling, 0.08), path .. '.cooling', 0, 1),
    drag = number(defaultValue(value.drag, 0.02), path .. '.drag', 0, 1),
    light = {-1 / sqrt(2), -1 / sqrt(2)},
    strays = false,
    outline = 0,
    path = path
  }
  if type(value.duration) == 'table' then
    list(value.duration, path .. '.duration', frames, frames)
  end
  for f = 1, frames do
    effect.durations[f] = integer(
      type(value.duration) == 'table' and value.duration[f] or defaultValue(value.duration, 80),
      path .. '.duration', 1, 60000
    )
  end
  for i, wall in ipairs(list(defaultValue(value.walls, {}), path .. '.walls', 0, 4)) do
    if wall ~= 'bottom' then
      fail(path .. '.walls[' .. (i - 1) .. ']', 'unsupported wall')
    end
    if effect.walls[wall] then
      fail(path .. '.walls', 'repeated wall')
    end
    effect.walls[wall] = true
  end
  for i, o in ipairs(list(defaultValue(value.obstacles, {}), path .. '.obstacles', 0, 32)) do
    local op = path .. '.obstacles[' .. (i - 1) .. ']'
    fields(o, op, 'symbol x y draw keys')
    local rows = symbols[o.symbol]
    if not rows then
      fail(op .. '.symbol', 'unknown symbol')
    end
    local a = {
      rows = rows,
      x = integer(defaultValue(o.x, 0), op .. '.x', -#rows[1], W),
      y = integer(defaultValue(o.y, 0), op .. '.y', -#rows, H),
      draw = defaultValue(o.draw, 'over')
    }
    if a.draw ~= 'over' and a.draw ~= 'under' and a.draw ~= 'none' then
      fail(op .. '.draw', 'invalid draw mode')
    end
    if o.keys ~= nil then
      a.track = readTrack(o.keys, op .. '.keys', frames, a, rows, W, H)
      effect.moving = true
    end
    effect.obstacles[i] = a
  end
  for i, a in ipairs(list(value.emitters, path .. '.emitters', 1, 16)) do
    effect.emitters[i] = readEmitter(a, path .. '.emitters[' .. (i - 1) .. ']', frames, loop, palette)
  end
  for i, a in ipairs(list(value.look, path .. '.look', 1, 8)) do
    effect.look[i] = readLook(a, path .. '.look[' .. (i - 1) .. ']', palette, seed, W, H)
  end
  if value.cleanup ~= nil then
    fields(value.cleanup, path .. '.cleanup', 'strays')
    effect.strays = boolean(defaultValue(value.cleanup.strays, false), path .. '.cleanup.strays')
  end
  if value.outline ~= nil then
    effect.outline = paletteKey(value.outline, path .. '.outline', palette)
  end
  effect.layout = reader.layout(effect.obstacles, W, H, reader.places(effect.obstacles, 0))
  effect.solid = effect.layout.solid
  effect.front = effect.layout.front
  return effect, W, H
end

return reader
