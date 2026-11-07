-- Prints the Lua controls for build.mjs to compare with studio/fluid-controls.js: each slider (key, label, min, max,
-- step), the value at every slider position, then each preset's starting value for each slider, one tab-separated
-- line each.
--   aseprite/.tools/lua.exe aseprite/checks/controls-dump.lua aseprite/dist/presets.lua
local here = (arg[0]:match("^(.*)[/\\][^/\\]*$") or ".")
local use = dofile(here .. "/../tools/loader.lua")(here .. "/../extension", { presets = assert(arg[1], "usage: controls-dump.lua <presets.lua>") })
local controls, presets = use("controls"), use("presets")

-- Numbers as JavaScript's String() writes them for these values: whole numbers without ".0", others shortest.
local function js(v)
  if math.type(v) == "integer" or v == math.floor(v) then return string.format("%d", v) end
  for digits = 1, 17 do
    local text = string.format("%." .. digits .. "g", v)
    if tonumber(text) == v then return text end
  end
end

for _, s in ipairs(controls.SLIDERS) do
  print(table.concat({ "slider", s.key, s.label, js(s.min), js(s.max), js(s.step) }, "\t"))
end
for _, s in ipairs(controls.SLIDERS) do
  for position = 0, controls.positions(s) do print(table.concat({ "value", s.key, position, js(controls.valueAt(s, position)) }, "\t")) end
end
for _, p in ipairs(presets) do
  local effect = controls.effectOf(p.source)
  for _, s in ipairs(controls.SLIDERS) do print(table.concat({ "initial", p.name, s.key, js(s.initial(effect)) }, "\t")) end
end
