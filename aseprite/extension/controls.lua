-- The Fluid lab's gas controls and how their values become an edited fluid source: a port of
-- studio/fluid-controls.js (FLUID_SLIDERS.gas, sliderValue, editedSource). Same ranges, steps and edit, so the
-- extension bakes exactly what the Fluid lab compiles for the same settings.
local use = ...

local M = {}

-- JavaScript's Math.round: the nearest whole number, halves toward +infinity.
local function jsRound(x)
  local r = math.floor(x)
  if x - r >= 0.5 then r = r + 1 end
  return r
end
M.jsRound = jsRound

-- Each slider sets one setting of the preset's effect; Strength scales every emitter's rate or burst.
M.SLIDERS = {
  { key = "strength", label = "Strength", min = 0.25, max = 2, step = 0.05, decimals = 2, initial = function() return 1 end },
  { key = "buoyancy", label = "Rise (buoyancy)", min = 0, max = 1, step = 0.01, decimals = 2,
    initial = function(e) if e.buoyancy == nil then return 0.15 end return e.buoyancy end },
  { key = "vorticity", label = "Curl (vorticity)", min = 0, max = 1, step = 0.01, decimals = 2,
    initial = function(e) if e.vorticity == nil then return 0.25 end return e.vorticity end },
  { key = "dissipation", label = "Fade (dissipation)", min = 0, max = 0.4, step = 0.0025, decimals = 4,
    initial = function(e) if e.dissipation == nil then return 0.03 end return e.dissipation end },
}
M.SEED_MIN, M.SEED_MAX = 0, 2147483647

-- The value a range input holds after being set to `value`: clamped to the range and snapped to the nearest step from
-- the minimum (the larger one on a tie), without binary rounding noise. `decimals` is the longest decimal part of the
-- slider's min and step, as fluid-controls.js computes it from their text.
function M.sliderValue(slider, value)
  local clamped = math.min(slider.max, math.max(slider.min, value))
  local steps = math.floor((clamped - slider.min) / slider.step + 0.5 + 1e-9)
  local snapped = tonumber(string.format("%." .. slider.decimals .. "f", slider.min + steps * slider.step))
  return math.min(slider.max, snapped)
end

-- A slider's whole-number position (for Aseprite's integer sliders) and the value it stands for.
function M.positions(slider)
  return math.floor((slider.max - slider.min) / slider.step + 0.5)
end
function M.positionOf(slider, value)
  return math.floor((M.sliderValue(slider, value) - slider.min) / slider.step + 0.5)
end
function M.valueAt(slider, position)
  return M.sliderValue(slider, slider.min + position * slider.step)
end

-- A deep copy of a source table (structuredClone).
local function clone(v)
  if type(v) ~= "table" then return v end
  local out = {}
  for k, x in pairs(v) do out[k] = clone(x) end
  return out
end
M.clone = clone

function M.effectOf(source)
  local name = next(source.effects)
  return source.effects[name], name
end

-- The defaults the sliders start from, and the preset's seed.
function M.initial(source)
  local effect = M.effectOf(source)
  local values = {}
  for _, slider in ipairs(M.SLIDERS) do values[slider.key] = slider.initial(effect) end
  local seed = effect.seed
  if seed == nil then seed = 1 end
  return values, seed
end

local function round3(value) return jsRound(value * 1000) / 1000 end

-- The preset with the sliders and seed applied; settings left where the preset had them are not written.
function M.edited(original, values, seed)
  local source = clone(original)
  local effect = M.effectOf(source)
  local before = M.effectOf(original)
  for _, slider in ipairs(M.SLIDERS) do
    local value = values[slider.key]
    if value ~= slider.initial(before) then
      if slider.key == "strength" then
        for _, emitter in ipairs(effect.emitters or {}) do
          for _, field in ipairs({ "rate", "burst" }) do
            if emitter[field] ~= nil then emitter[field] = round3(math.min(64, math.max(0.01, emitter[field] * value))) end
          end
        end
      else
        effect[slider.key] = value
      end
    end
  end
  local presetSeed = before.seed
  if presetSeed == nil then presetSeed = 1 end
  if seed ~= presetSeed then effect.seed = seed end
  return source
end

return M
