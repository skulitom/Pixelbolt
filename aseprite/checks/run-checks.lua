-- Checks of the extension against the stand-in Aseprite API (mock-aseprite.lua), in standalone Lua 5.4:
--   aseprite/.tools/lua.exe aseprite/checks/run-checks.lua [aseprite/dist/presets.lua]
-- Covers both targets in RGB, Indexed (with exact palette reuse, additions and the full-palette message), Grayscale's
-- message, one undo step per bake, the version gate, the controls' edit, pre-baked presets and the dialog's flow.
local here = (arg[0]:match("^(.*)[/\\][^/\\]*$") or ".")
local presetsFile = arg[1] or (here .. "/../dist/presets.lua")
local aseprite = dofile(here .. "/mock-aseprite.lua")

local passed, failed = 0, 0
local function check(name, fn)
  local ok, err = pcall(fn)
  if ok then passed = passed + 1; print("ok - " .. name)
  else failed = failed + 1; print("not ok - " .. name .. "\n    " .. tostring(err)) end
end
local function eq(a, b, what) if a ~= b then error(string.format("%s: expected %s, got %s", what or "value", tostring(b), tostring(a)), 2) end end
local function has(text, part, what) if not tostring(text):find(part, 1, true) then error(string.format("%s: %q does not contain %q", what or "text", tostring(text), part), 2) end end

-- A fresh set of modules (and a fresh mock) per check, so no state leaks between them.
local function fresh(options)
  local env = aseprite.new(options)
  env.install()
  local use = dofile(here .. "/../tools/loader.lua")(here .. "/../extension", { presets = presetsFile })
  return env, use
end

local function presetNamed(use, name)
  for _, p in ipairs(use("presets")) do if p.name == name then return p end end
  error("no preset " .. name)
end

-- A small made-up bake in a real preset's palette: 4x3, three frames, the second one empty.
local function sample(preset)
  local keys = preset.order
  local a, b = keys[1], keys[2]
  local function frame(pattern)
    local cells = {}
    for c = 1, 12 do local ch = pattern:sub(c, c); cells[c] = ch == "a" and a or ch == "b" and b or false end
    return cells
  end
  return { width = 4, height = 3, loop = true, durations = { 70, 70, 70 },
    frames = { frame("a..b.ab....a"), frame("............"), frame("bbbbaaaa....") } }
end

local function colourOf(env, preset, key)
  local hex = preset.source.palette[key]
  return env.app.pixelColor.rgba(tonumber(hex:sub(2, 3), 16), tonumber(hex:sub(4, 5), 16), tonumber(hex:sub(6, 7), 16), 255)
end

local function hostOf(env)
  return { app = env.app, Sprite = env.Sprite, Image = env.Image, ImageSpec = env.ImageSpec, Point = env.Point, ColorMode = env.ColorMode, Color = env.Color }
end

check("new sprite, RGB: size, frames, durations, layer, cels, pixels, tag, one undo step", function()
  local env, use = fresh()
  local bake, preset = use("bake"), presetNamed(use, "torch")
  local result = sample(preset)
  local sprite = assert(use("bake").apply(hostOf(env), preset, result, { target = "sprite" }))
  eq(sprite.width, 4, "width"); eq(sprite.height, 3, "height"); eq(sprite.colorMode, env.ColorMode.RGB, "colour mode")
  eq(#sprite.frames, 3, "frames")
  for i = 1, 3 do eq(sprite.frames[i].duration, 0.07, "duration of frame " .. i) end
  eq(#sprite.layers, 1, "layers"); eq(sprite.layers[1].name, "Torch", "layer name")
  eq(#sprite.cels, 2, "cels (the empty frame has none)")
  local cel = sprite:celAt(sprite.layers[1], 1)
  eq(cel.image:getPixel(0, 0), colourOf(env, preset, preset.order[1]), "pixel 0,0")
  eq(cel.image:getPixel(1, 0), 0, "transparent pixel")
  eq(cel.image:getPixel(3, 0), colourOf(env, preset, preset.order[2]), "pixel 3,0")
  eq(#sprite.tags, 1, "tags"); eq(sprite.tags[1].fromFrame.frameNumber, 1, "tag start"); eq(sprite.tags[1].toFrame.frameNumber, 3, "tag end"); eq(sprite.tags[1].name, "Torch", "tag name")
  eq(sprite.undoHistory.undoSteps, 1, "undo steps")
  local _ = bake
end)


check("new layer, RGB: placed at x,y from the active frame, frames added, old durations kept, one undo step", function()
  local env, use = fresh()
  local preset = presetNamed(use, "campfire")
  local sprite = env.newSprite(16, 16, env.ColorMode.RGB)
  sprite:newEmptyFrame(2)
  sprite.frames[1].duration, sprite.frames[2].duration = 0.25, 0.25
  sprite.undoHistory.undoSteps = 0
  env.app.activeFrame = sprite.frames[2]
  local result = sample(preset)
  assert(use("bake").apply(hostOf(env), preset, result, { target = "layer", x = 5, y = 6 }))
  eq(#sprite.layers, 2, "layers"); eq(sprite.layers[2].name, "Campfire", "new layer name")
  eq(#sprite.frames, 4, "frames")
  eq(sprite.frames[1].duration, 0.25, "kept duration 1"); eq(sprite.frames[2].duration, 0.25, "kept duration 2")
  eq(sprite.frames[3].duration, 0.07, "new duration 3"); eq(sprite.frames[4].duration, 0.07, "new duration 4")
  local cel = assert(sprite:celAt(sprite.layers[2], 2), "cel on frame 2")
  eq(cel.position.x, 5, "x"); eq(cel.position.y, 6, "y")
  eq(sprite:celAt(sprite.layers[2], 3), nil, "no cel for the empty frame")
  assert(sprite:celAt(sprite.layers[2], 4), "cel on frame 4")
  eq(sprite:celAt(sprite.layers[1], 2), nil, "the old layer is untouched")
  eq(sprite.tags[1].fromFrame.frameNumber, 2, "tag start"); eq(sprite.tags[1].toFrame.frameNumber, 4, "tag end")
  eq(sprite.undoHistory.undoSteps, 1, "undo steps")
end)

check("new layer: centred when no position is given", function()
  local env, use = fresh()
  local preset = presetNamed(use, "torch")
  local sprite = env.newSprite(21, 10, env.ColorMode.RGB)
  assert(use("bake").apply(hostOf(env), preset, sample(preset), { target = "layer" }))
  local cel = sprite:celAt(sprite.layers[2], 1)
  eq(cel.position.x, 8, "x"); eq(cel.position.y, 3, "y")
  local x, y = use("bake").centre(sprite, 4, 3)
  eq(x, 8, "centre x"); eq(y, 3, "centre y")
end)

check("Indexed: exact colours reused (never the transparent entry), the rest added, one undo step", function()
  local env, use = fresh()
  local preset = presetNamed(use, "torch")
  local result = sample(preset)
  local a, b = preset.order[1], preset.order[2]
  local sprite = env.newSprite(8, 8, env.ColorMode.INDEXED, 8)
  local palette = sprite.palettes[1]
  palette.colors[1] = colourOf(env, preset, b) -- index 0 is the transparent entry: must not be reused
  palette.colors[4] = colourOf(env, preset, b) -- index 3 matches b exactly
  sprite.undoHistory.undoSteps = 0
  assert(use("bake").apply(hostOf(env), preset, result, { target = "layer", x = 0, y = 0 }))
  eq(#palette, 9, "palette size (one colour added)")
  eq(palette.colors[9], colourOf(env, preset, a), "added colour")
  local cel = sprite:celAt(sprite.layers[2], 1)
  eq(cel.image.colorMode, env.ColorMode.INDEXED, "cel colour mode")
  eq(cel.image:getPixel(0, 0), 8, "a drawn with the added entry")
  eq(cel.image:getPixel(3, 0), 3, "b drawn with the matching entry")
  eq(cel.image:getPixel(1, 0), 0, "transparent stays the transparent entry")
  eq(sprite.undoHistory.undoSteps, 1, "undo steps")
end)

check("Indexed: a full palette stops with a clear message and changes nothing", function()
  local env, use = fresh()
  local preset = presetNamed(use, "torch")
  local sprite = env.newSprite(8, 8, env.ColorMode.INDEXED, 256)
  for i = 1, 256 do sprite.palettes[1].colors[i] = env.app.pixelColor.rgba(i - 1, 1, 2, 255) end
  sprite.undoHistory.undoSteps = 0
  local done, message = use("bake").apply(hostOf(env), preset, sample(preset), { target = "layer", x = 0, y = 0 })
  eq(done, nil, "result"); has(message, "palette is full", "message"); has(message, "256", "message")
  eq(#sprite.layers, 1, "layers"); eq(#sprite.palettes[1], 256, "palette size"); eq(sprite.undoHistory.undoSteps, 0, "undo steps")
end)

check("Grayscale: asks to convert to RGB first and changes nothing", function()
  local env, use = fresh()
  local preset = presetNamed(use, "torch")
  local sprite = env.newSprite(8, 8, env.ColorMode.GRAYSCALE)
  local done, message = use("bake").apply(hostOf(env), preset, sample(preset), { target = "layer" })
  eq(done, nil, "result"); has(message, "Convert it to RGB first", "message")
  eq(#sprite.layers, 1, "layers"); eq(sprite.undoHistory.undoSteps, 0, "undo steps")
end)

check("new layer without an open sprite: a clear message", function()
  local env, use = fresh()
  local preset = presetNamed(use, "torch")
  local done, message = use("bake").apply(hostOf(env), preset, sample(preset), { target = "layer" })
  eq(done, nil, "result"); has(message, "no open sprite", "message")
end)

check("version gate: below Aseprite 1.3 (API 21) gets a clear message", function()
  local _, use = fresh()
  local plugin = use("plugin")
  has(plugin.versionProblem({ apiVersion = 20, version = "1.2.40" }), "needs Aseprite 1.3 or newer", "API 20")
  has(plugin.versionProblem({ apiVersion = nil, version = "1.2.10-beta2" }), "needs Aseprite 1.3", "no API version")
  eq(plugin.versionProblem({ apiVersion = 21, version = "1.3-rc1" }), nil, "API 21")
  eq(plugin.versionProblem({ apiVersion = 39, version = "1.3.17" }), nil, "API 39")
end)

check("controls: Fluid lab's ranges, snapping and edit", function()
  local _, use = fresh()
  local controls = use("controls")
  local by = {}
  for _, s in ipairs(controls.SLIDERS) do by[s.key] = s end
  eq(controls.sliderValue(by.strength, 1.52), 1.5, "strength snaps to 0.05")
  eq(controls.sliderValue(by.strength, 9), 2, "strength clamps")
  eq(controls.sliderValue(by.dissipation, 0.0651), 0.065, "dissipation snaps to 0.0025")
  eq(controls.valueAt(by.buoyancy, 45), 0.45, "position 45")
  eq(controls.positionOf(by.dissipation, 0.1375), 55, "position of 0.1375")
  local steam = presetNamed(use, "steam-vent")
  local values, seed = controls.initial(steam.source)
  eq(values.strength, 1, "initial strength"); eq(seed, 2, "preset seed")
  local same = controls.edited(steam.source, values, seed)
  local effect = controls.effectOf(same)
  eq(effect.emitters[1].rate, 0.2, "untouched rate"); eq(effect.seed, 2, "seed kept")
  values.strength = 1.5
  local edited = controls.effectOf(controls.edited(steam.source, values, 99))
  eq(edited.emitters[1].rate, 0.3, "0.2 x 1.5 rounds to 0.3"); eq(edited.seed, 99, "seed written")
  eq(controls.effectOf(steam.source).emitters[1].rate, 0.2, "the preset itself is unchanged")
end)

check("pre-baked preset: seeds only, frames unpacked", function()
  local _, use = fresh()
  local engine = use("engine")
  local preset = { name = "x", title = "X", order = { "a" }, source = { palette = { a = "#102030" }, effects = { x = {} } },
    prebaked = { seeds = { 4, 5 }, bakes = { [4] = { width = 2, height = 1, loop = false, durations = { 60 }, frames = { "a." } } } } }
  eq(engine.isPrebaked(preset), true, "pre-baked")
  local result = engine.run(preset, { strength = 1, buoyancy = 0, vorticity = 0, dissipation = 0 }, 4)
  eq(result.frames[1][1], "a", "cell 1"); eq(result.frames[1][2], false, "cell 2")
  eq(select(1, pcall(engine.run, preset, { strength = 1, buoyancy = 0, vorticity = 0, dissipation = 0 }, 6)), false, "unknown seed fails")
end)

check("dialog: menu command, credit and link, preview with 'baking...', bake into a new sprite in one undo step", function()
  local env, use = fresh()
  local plugin = use("plugin")
  local commands = {}
  plugin.init({ newCommand = function(_, c) commands[#commands + 1] = c end, preferences = {} })
  eq(#commands, 1, "commands"); eq(commands[1].group, "edit_fx", "menu group")
  commands[1].onclick()
  local dlg = assert(env.dialogs[#env.dialogs], "dialog opened")
  eq(dlg.shown, true, "shown")
  eq(dlg.widgets.link.label, "Made with Pixelbolt (MIT)", "credit beside the link")
  dlg.widgets.link.onclick()
  eq(env.launched[1].command, "Launch", "link command"); eq(env.launched[1].params.type, "url", "link type")
  eq(env.launched[1].params.path, "https://github.com/skulitom/Pixelbolt", "link url")
  -- Pick the torch, move Strength, preview.
  dlg.widgets.preset.option = "Torch"; dlg.widgets.preset.onchange()
  eq(dlg.widgets.note.text, "Gas, loop, simulated live", "note")
  dlg.widgets.strength.value = 25; dlg.widgets.strength.onchange()
  eq(dlg.widgets.strength.label, "Strength  x 1.50", "strength label")
  dlg.widgets.preview.onclick()
  eq(dlg.widgets.status.text, "baking...", "status while baking")
  env.tick()
  has(dlg.widgets.status.text, "16 frames", "status after preview")
  -- Bake into a new sprite: the cached frames, no second simulation.
  dlg.widgets.bake.onclick()
  local sprite = env.app.activeSprite
  eq(#sprite.frames, 16, "frames"); eq(sprite.width, 16, "width"); eq(sprite.height, 32, "height")
  eq(sprite.undoHistory.undoSteps, 1, "undo steps")
  has(dlg.widgets.status.text, "Baked 16 frames", "status after bake")
  -- Randomize changes the seed within range; Reset restores the preset.
  dlg.widgets.randomize.onclick()
  local seed = tonumber(dlg.widgets.seed.text)
  assert(seed >= 0 and seed <= 2147483647, "seed in range")
  dlg.widgets.reset.onclick()
  eq(dlg.widgets.seed.text, "4", "reset seed"); eq(dlg.widgets.strength.label, "Strength  x 1.00", "reset strength")
  dlg:close()
  eq(plugin.dialog, nil, "closed")
end)

check("dialog: Grayscale active sprite shows the message as an alert", function()
  local env, use = fresh()
  local plugin = use("plugin")
  env.newSprite(32, 32, env.ColorMode.GRAYSCALE)
  local dlg = plugin.open()
  dlg.widgets.preset.option = "Torch"; dlg.widgets.preset.onchange()
  dlg:modify{ id = "to_layer", selected = true }
  dlg.widgets.bake.onclick(); env.tick()
  has(env.alerts[#env.alerts], "Convert it to RGB first", "alert")
end)

check("dialog: Centre places a layer bake in the middle; unticked, X and Y apply", function()
  local env, use = fresh()
  local plugin = use("plugin")
  local sprite = env.newSprite(40, 60, env.ColorMode.RGB)
  local dlg = plugin.open()
  dlg.widgets.preset.option = "Torch"; dlg.widgets.preset.onchange()
  dlg:modify{ id = "to_layer", selected = true }
  eq(dlg.widgets.centred.selected, true, "Centre is the default")
  eq(dlg.widgets.x.enabled, false, "X is off while centred")
  dlg:modify{ id = "x", text = "" } -- reads as 0 in Aseprite, which Centre ignores
  dlg.widgets.bake.onclick(); env.tick()
  eq(#env.alerts, 0, "alerts")
  local cel = assert(sprite:celAt(sprite.layers[2], 1), "a cel on the new layer")
  eq(cel.position.x, 12, "x centred (40 - 16) / 2"); eq(cel.position.y, 14, "y centred (60 - 32) / 2")
  eq(#sprite.frames, 16, "frames added"); eq(sprite.undoHistory.undoSteps, 1, "undo steps")
  -- Untick Centre: the fields start at the centred place and then apply as typed.
  dlg:modify{ id = "centred", selected = false }; dlg.widgets.centred.onclick()
  eq(dlg.widgets.x.text, "12", "x starts centred"); eq(dlg.widgets.x.enabled, true, "X is on")
  dlg:modify{ id = "x", text = "5" }; dlg:modify{ id = "y", text = "3" }
  env.app.activeFrame = sprite.frames[1]
  dlg.widgets.bake.onclick()
  local placed = assert(sprite:celAt(sprite.layers[3], 1), "a cel on the second layer")
  eq(placed.position.x, 5, "x as typed"); eq(placed.position.y, 3, "y as typed")
end)

check("Indexed: a transparent entry past the palette's end stays where it is", function()
  local env, use = fresh()
  local preset = presetNamed(use, "torch")
  local sprite = env.newSprite(8, 8, env.ColorMode.INDEXED, 8)
  sprite.transparentColor = 250
  assert(use("bake").apply(hostOf(env), preset, sample(preset), { target = "layer", x = 0, y = 0 }))
  eq(sprite.transparentColor, 250, "transparent entry")
  eq(#sprite.palettes[1], 251, "the palette reaches it")
  local cel = sprite:celAt(sprite.layers[2], 1)
  eq(cel.image:getPixel(1, 0), 250, "transparent pixels use it")
  eq(sprite.palettes[1].colors[cel.image:getPixel(0, 0) + 1], colourOf(env, preset, preset.order[1]), "added colour")
end)

check("Indexed: a sprite with several palettes stops with a clear message and changes nothing", function()
  local env, use = fresh()
  local preset = presetNamed(use, "torch")
  local sprite = env.newSprite(8, 8, env.ColorMode.INDEXED, 8)
  sprite.palettes[2] = sprite.palettes[1]
  local done, message = use("bake").apply(hostOf(env), preset, sample(preset), { target = "layer", x = 0, y = 0 })
  eq(done, nil, "result"); has(message, "changes palettes", "message")
  eq(#sprite.layers, 1, "layers"); eq(sprite.undoHistory.undoSteps, 0, "undo steps")
end)

check("dialog: closing it while a bake waits does nothing", function()
  local env, use = fresh()
  local plugin = use("plugin")
  local dlg = plugin.open()
  dlg.widgets.preset.option = "Smoke puff"; dlg.widgets.preset.onchange()
  dlg.widgets.bake.onclick()
  eq(dlg.widgets.status.text, "baking...", "waiting")
  dlg:close()
  env.tick()
  eq(#env.alerts, 0, "alerts"); eq(#env.sprites, 0, "no sprite made")
end)

check("new layer: tags that end on the last frame keep their length when frames are added", function()
  local env, use = fresh()
  local preset = presetNamed(use, "torch")
  local sprite = env.newSprite(16, 16, env.ColorMode.RGB)
  sprite:newEmptyFrame(2)
  local walk = sprite:newTag(1, 2); walk.name = "walk"
  sprite.undoHistory.undoSteps = 0
  env.app.activeFrame = sprite.frames[2]
  assert(use("bake").apply(hostOf(env), preset, sample(preset), { target = "layer", x = 0, y = 0 }))
  eq(#sprite.frames, 4, "frames")
  eq(walk.toFrame.frameNumber, 2, "the user's tag still ends on frame 2")
  eq(sprite.tags[2].fromFrame.frameNumber, 2, "effect tag start"); eq(sprite.tags[2].toFrame.frameNumber, 4, "effect tag end")
  eq(sprite.undoHistory.undoSteps, 1, "undo steps")
end)

check("Indexed: new colours get distinct entries when the transparent entry sits past the palette's end", function()
  local env, use = fresh()
  local preset = presetNamed(use, "torch")
  local sprite = env.newSprite(8, 8, env.ColorMode.INDEXED, 8)
  sprite.transparentColor = 8
  assert(use("bake").apply(hostOf(env), preset, sample(preset), { target = "layer", x = 0, y = 0 }))
  local palette, cel = sprite.palettes[1], sprite:celAt(sprite.layers[2], 1)
  local ia, ib = cel.image:getPixel(0, 0), cel.image:getPixel(3, 0)
  assert(ia ~= ib, "two colours share entry " .. tostring(ia))
  assert(ia ~= 8 and ib ~= 8, "a colour landed on the transparent entry")
  eq(palette.colors[ia + 1], colourOf(env, preset, preset.order[1]), "colour a")
  eq(palette.colors[ib + 1], colourOf(env, preset, preset.order[2]), "colour b")
end)

check("alerts: the long palette message comes as short lines that fit a small screen", function()
  local env, use = fresh()
  local plugin = use("plugin")
  local sprite = env.newSprite(8, 8, env.ColorMode.INDEXED, 256)
  for i = 1, 256 do sprite.palettes[1].colors[i] = env.app.pixelColor.rgba(i - 1, 1, 2, 255) end
  local dlg = plugin.open()
  dlg.widgets.preset.option = "Torch"; dlg.widgets.preset.onchange()
  dlg:modify{ id = "to_layer", selected = true }
  dlg.widgets.bake.onclick(); env.tick()
  local lines = assert(env.alertLines[#env.alertLines], "the alert came as lines")
  assert(#lines >= 2, "more than one line")
  for _, line in ipairs(lines) do assert(#line <= 72, "line too long: " .. line) end
  has(env.alerts[#env.alerts], "palette is full", "message")
end)

print(string.format("%d passed, %d failed", passed, failed))
os.exit(failed == 0 and 0 or 1)
