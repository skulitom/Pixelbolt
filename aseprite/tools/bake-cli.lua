-- Bakes one preset with the Lua port, outside Aseprite, and writes its frames as text for tools/parity.mjs.
--
--   aseprite/.tools/lua.exe aseprite/tools/bake-cli.lua --preset campfire [--strength 1.5] [--buoyancy 0.55]
--     [--vorticity 0.35] [--dissipation 0.085] [--seed 14] [--out frames.txt] [--time] [--repeat 3]
--     [--presets aseprite/dist/presets.lua] [--extension aseprite/extension]
--
-- Output: a header line "pixelbolt-fluids-frames 1", then "<width> <height> <frames> <loop 0|1>", then per frame
-- "frame <index> <duration>" and <height> rows of <width> characters: the palette key drawn there, or "." for none.
-- With --time, prints "seconds <s>" (os.clock around compile) for each repeat on stdout.
local args = {}
local i = 1
while i <= #arg do
  local a = arg[i]
  if a == "--time" then args.time = true; i = i + 1
  else
    local key = a:match("^%-%-(.+)$")
    if not key or arg[i + 1] == nil then io.stderr:write("bake-cli: bad argument " .. tostring(a) .. "\n"); os.exit(2) end
    args[key] = arg[i + 1]
    i = i + 2
  end
end

local here = (arg[0]:match("^(.*)[/\\][^/\\]*$") or ".")
local extension = args.extension or (here .. "/../extension")
local presetsFile = args.presets or (here .. "/../dist/presets.lua")
local use = dofile(here .. "/loader.lua")(extension, { presets = presetsFile })

local presets = use("presets")
local controls = use("controls")
local fluid = use("fluid/compile")

local preset
for _, p in ipairs(presets) do if p.name == args.preset then preset = p end end
if not preset then io.stderr:write("bake-cli: unknown preset " .. tostring(args.preset) .. "\n"); os.exit(2) end

local values, seed = controls.initial(preset.source)
for _, slider in ipairs(controls.SLIDERS) do
  if args[slider.key] then values[slider.key] = controls.sliderValue(slider, tonumber(args[slider.key])) end
end
if args.seed then seed = math.tointeger(tonumber(args.seed)) or tonumber(args.seed) end
local source = controls.edited(preset.source, values, seed)

local result
for _ = 1, tonumber(args["repeat"] or "1") do
  local t0 = os.clock()
  result = fluid.compile(source)
  local t1 = os.clock()
  if args.time then print(string.format("seconds %.3f", t1 - t0)) end
end

if args.out then
  local W, H = result.width, result.height
  local out = {}
  out[#out + 1] = "pixelbolt-fluids-frames 1"
  out[#out + 1] = string.format("%d %d %d %d", W, H, #result.frames, result.loop and 1 or 0)
  for f, cells in ipairs(result.frames) do
    out[#out + 1] = string.format("frame %d %d", f - 1, result.durations[f])
    for y = 0, H - 1 do
      local row = {}
      for x = 1, W do row[x] = cells[y * W + x] or "." end
      out[#out + 1] = table.concat(row)
    end
  end
  local file = assert(io.open(args.out, "wb"))
  file:write(table.concat(out, "\n"), "\n")
  file:close()
end
