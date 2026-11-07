-- Runs a preset at given settings and keeps the last few results, so Preview and Bake share one simulation.
-- A live preset is simulated by the Lua port of Pixelbolt's fluid compiler (fluid/compile.lua); a pre-baked preset
-- carries Pixelbolt's own frames for a fixed list of seeds.
local use = ...
local controls = use("controls")

local M = {}

local cache, order, KEEP = {}, {}, 4

-- The settings as text, the cache key.
local function keyOf(preset, values, seed)
  local parts = { preset.name, tostring(seed) }
  for _, slider in ipairs(controls.SLIDERS) do parts[#parts + 1] = string.format("%.4f", values[slider.key]) end
  return table.concat(parts, "|")
end

-- A pre-baked bake's frames are rows of palette keys, "." where nothing is drawn.
local function unpackBake(bake)
  local frames = {}
  for f, text in ipairs(bake.frames) do
    local cells = {}
    for c = 1, #text do
      local ch = text:sub(c, c)
      cells[c] = ch ~= "." and ch or false
    end
    frames[f] = cells
  end
  return { width = bake.width, height = bake.height, loop = bake.loop, durations = bake.durations, frames = frames }
end

function M.isPrebaked(preset) return preset.prebaked ~= nil end

-- The seeds a pre-baked preset offers, in order.
function M.seeds(preset) return preset.prebaked and preset.prebaked.seeds or nil end

function M.cached(preset, values, seed) return cache[keyOf(preset, values, seed)] end

-- The frames for these settings: { width, height, loop, durations (ms), frames = { cells... } }.
function M.run(preset, values, seed)
  local key = keyOf(preset, values, seed)
  local hit = cache[key]
  if hit then return hit end
  local result
  if preset.prebaked then
    local bake = preset.prebaked.bakes[seed]
    if not bake then error("pre-baked preset " .. preset.name .. " has no seed " .. tostring(seed), 0) end
    result = unpackBake(bake)
  else
    result = use("fluid/compile").compile(controls.edited(preset.source, values, seed))
  end
  cache[key] = result
  order[#order + 1] = key
  if #order > KEEP then cache[table.remove(order, 1)] = nil end
  return result
end

-- The palette keys a result draws, in the preset's palette order.
function M.usedKeys(preset, result)
  local used = {}
  for _, cells in ipairs(result.frames) do
    for c = 1, #cells do local ch = cells[c]; if ch then used[ch] = true end end
  end
  local keys = {}
  for _, key in ipairs(preset.order) do if used[key] then keys[#keys + 1] = key end end
  return keys
end

return M
