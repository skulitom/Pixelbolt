-- Loads the packaged one-file script the way Aseprite does (a plain chunk that defines init and exit), against the
-- stand-in API, registers its command, opens the dialog and bakes the smallest preset into a new sprite.
--   aseprite/.tools/lua.exe aseprite/checks/bundle-smoke.lua aseprite/dist/pixelbolt-fluids.lua
local here = (arg[0]:match("^(.*)[/\\][^/\\]*$") or ".")
local env = dofile(here .. "/mock-aseprite.lua").new{ apiVersion = 39 }
env.install()
local chunk = assert(loadfile(assert(arg[1], "usage: bundle-smoke.lua <bundle.lua>"), "t", _G))
chunk()
assert(type(init) == "function" and type(exit) == "function", "the bundle must define init and exit")
local commands = {}
init({ newCommand = function(_, c) commands[#commands + 1] = c end, preferences = {} })
assert(#commands == 1 and commands[1].group == "edit_fx", "one command in Edit > FX")
commands[1].onclick()
local dlg = assert(env.dialogs[#env.dialogs], "the dialog opened")
local titles = dlg.widgets.preset.options
assert(#titles == 7, "seven presets, got " .. #titles)
dlg.widgets.preset.option = "Torch"; dlg.widgets.preset.onchange()
dlg.widgets.bake.onclick(); env.tick()
local sprite = assert(env.app.activeSprite, "a new sprite")
assert(#sprite.frames == 16 and sprite.undoHistory.undoSteps == 1, "the torch baked in one undo step")
exit({})
print("bundle smoke check passed: " .. table.concat(titles, ", "))
