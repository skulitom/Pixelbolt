-- The extension's command and dialog: pick one of Pixelbolt's gas presets, set the Fluid lab's controls, preview it,
-- and bake it into a new sprite or a new layer of the active sprite.
local use = ...
local controls = use("controls")
local engine = use("engine")
local bake = use("bake")
local presets = use("presets")

local M = {}
M.VERSION = "1.0.0"
M.URL = "https://github.com/skulitom/Pixelbolt"
M.CREDIT = "Made with Pixelbolt (MIT)"
-- Aseprite 1.3-rc1 (API 21) added the canvas widget, GraphicsContext and Timer this dialog uses; 1.2 has API 20 or less.
M.MIN_API = 21
local PREVIEW = 128

-- Why this Aseprite can't run the extension, or nil.
function M.versionProblem(theApp)
  if theApp.apiVersion == nil or theApp.apiVersion < M.MIN_API then
    return "Pixelbolt Fluids needs Aseprite 1.3 or newer. This is Aseprite " .. tostring(theApp.version) .. "."
  end
  return nil
end

local function host()
  return { app = app, Sprite = Sprite, Image = Image, ImageSpec = ImageSpec, Point = Point, ColorMode = ColorMode, Color = Color }
end

-- An alert's text doesn't wrap in Aseprite, so a long message goes as short lines.
local function lines(text)
  local out, line = {}, ""
  for word in tostring(text):gmatch("%S+") do
    if line ~= "" and #line + #word + 1 > 64 then out[#out + 1] = line; line = word
    else line = line == "" and word or line .. " " .. word end
  end
  if line ~= "" then out[#out + 1] = line end
  return out
end
M.lines = lines

local function alert(text) app.alert{ title = "Pixelbolt Fluids", text = lines(text) } end

-- Runs `work` on the next tick of a one-shot timer, so a status set just before is painted first.
local function later(work)
  local timer
  timer = Timer{ interval = 0.02, ontick = function() timer:stop(); work() end }
  timer:start()
end

local function format(slider, value)
  if slider.key == "strength" then return string.format("x %.2f", value) end
  return string.format("%." .. slider.decimals .. "f", value)
end

function M.open()
  if M.dialog then M.dialog:close() end
  local titles = {}
  for i, p in ipairs(presets) do titles[i] = p.title end
  local state = { preset = presets[1], values = nil, seed = nil, preview = nil, images = nil, frame = 1, timer = nil, busy = false }
  local dlg

  local function stopPlayback()
    if state.timer then state.timer:stop(); state.timer = nil end
  end

  local function noteOf(preset)
    local note = preset.note:gsub("%s*\u{b7}%s*", ", ")
    if engine.isPrebaked(preset) then return note .. ", pre-baked (Seed picks one of " .. #engine.seeds(preset) .. " takes)" end
    return note .. ", simulated live"
  end

  local function sliderLabel(slider) return slider.label .. "  " .. format(slider, state.values[slider.key]) end

  local function showValues()
    for _, slider in ipairs(controls.SLIDERS) do
      dlg:modify{ id = slider.key, label = sliderLabel(slider) }
    end
    dlg:modify{ id = "seed", text = tostring(state.seed) }
  end

  local function stale(text)
    stopPlayback()
    state.preview, state.images, state.frame = nil, nil, 1
    dlg:modify{ id = "status", text = text or "Press Preview to see these settings." }
    dlg:repaint()
  end

  local function selectPreset(preset)
    state.preset = preset
    state.values, state.seed = controls.initial(preset.source)
    local prebaked = engine.isPrebaked(preset)
    if prebaked then state.seed = engine.seeds(preset)[1] end
    for _, slider in ipairs(controls.SLIDERS) do
      dlg:modify{ id = slider.key, value = controls.positionOf(slider, state.values[slider.key]), enabled = not prebaked }
    end
    dlg:modify{ id = "seed", enabled = not prebaked }
    dlg:modify{ id = "note", text = noteOf(preset) }
    showValues()
    stale()
  end

  local function previewImages(result)
    local images = {}
    for f, cells in ipairs(result.frames) do
      local image = Image(result.width, result.height, ColorMode.RGB)
      for c = 1, #cells do
        local key = cells[c]
        if key then
          local r, g, b = bake.rgb(state.preset.source.palette[key])
          local i = c - 1
          image:drawPixel(i % result.width, i // result.width, app.pixelColor.rgba(r, g, b, 255))
        end
      end
      images[f] = image
    end
    return images
  end

  local function play()
    stopPlayback()
    if not state.preview then return end
    local duration = state.preview.durations[state.frame] / 1000
    state.timer = Timer{ interval = duration, ontick = function()
      state.frame = state.frame % #state.images + 1
      dlg:repaint()
      local next = state.preview.durations[state.frame] / 1000
      if next ~= duration then play() end
    end }
    state.timer:start()
  end

  -- The settings' frames, from the cache or simulated now (showing "baking..." first).
  local function withResult(then_)
    local preset, values, seed = state.preset, state.values, state.seed
    local hit = engine.cached(preset, values, seed)
    if hit then return then_(hit) end
    if state.busy then return end
    state.busy = true
    dlg:modify{ id = "status", text = "baking..." }
    dlg:modify{ id = "bake", enabled = false }
    dlg:modify{ id = "preview", enabled = false }
    later(function()
      if M.dialog ~= dlg then state.busy = false; return end -- closed meanwhile
      local ok, result = pcall(engine.run, preset, values, seed)
      state.busy = false
      if M.dialog ~= dlg then return end
      dlg:modify{ id = "bake", enabled = true }
      dlg:modify{ id = "preview", enabled = true }
      if not ok then
        dlg:modify{ id = "status", text = "The simulation failed." }
        alert("The simulation failed: " .. tostring(result))
        return
      end
      then_(result)
    end)
  end

  -- True when `result` is still what the dialog's settings ask for (they can change while a bake waits its turn).
  local function current(result)
    return engine.cached(state.preset, state.values, state.seed) == result
  end

  local function onPreview()
    withResult(function(result)
      if not current(result) then return end
      state.preview, state.images, state.frame = result, previewImages(result), 1
      dlg:modify{ id = "status", text = string.format("%d frames, %d ms each%s", #result.frames, result.durations[1], result.loop and ", loops" or "") }
      dlg:repaint()
      play()
    end)
  end

  local function onBake()
    withResult(function(result)
      if not current(result) then return end
      local data = dlg.data
      local options = { target = data.to_layer and "layer" or "sprite", title = state.preset.title }
      if options.target == "layer" and not data.centred then
        options.x, options.y = math.floor(tonumber(data.x) or 0), math.floor(tonumber(data.y) or 0)
      end
      local ok, sprite, message = pcall(bake.apply, host(), state.preset, result, options)
      if not ok then alert("The bake failed: " .. tostring(sprite)); return end
      if not sprite then alert(message); return end
      if options.target == "layer" then
        dlg:modify{ id = "status", text = string.format("Baked %d frames. Undo removes them.", #result.frames) }
      else
        dlg:modify{ id = "status", text = string.format("Baked %d frames into a new sprite.", #result.frames) }
      end
      app.refresh()
    end)
  end

  -- Centre (the default) places a layer bake in the middle of the sprite at bake time. Unticked, X and Y apply,
  -- starting from the centred position.
  local function onCentre()
    local centred = dlg.data.centred
    if not centred then
      local sprite = app.activeSprite
      local x, y = 0, 0
      if sprite then x, y = bake.centre(sprite, state.preset.source.width, state.preset.source.height) end
      dlg:modify{ id = "x", text = tostring(x) }
      dlg:modify{ id = "y", text = tostring(y) }
    end
    dlg:modify{ id = "x", enabled = not centred }
    dlg:modify{ id = "y", enabled = not centred }
  end

  local function paint(ev)
    local gc = ev.context
    local cell = 8
    for y = 0, PREVIEW - 1, cell do
      for x = 0, PREVIEW - 1, cell do
        gc.color = ((x + y) // cell) % 2 == 0 and Color{ r = 60, g = 60, b = 66 } or Color{ r = 76, g = 76, b = 84 }
        gc:fillRect(Rectangle(x, y, cell, cell))
      end
    end
    if state.images and state.images[state.frame] then
      local image = state.images[state.frame]
      local scale = math.max(1, math.min(PREVIEW // image.width, PREVIEW // image.height))
      local w, h = image.width * scale, image.height * scale
      gc:drawImage(image, 0, 0, image.width, image.height, (PREVIEW - w) // 2, (PREVIEW - h) // 2, w, h)
    end
  end

  -- Compact: at 200% screen scaling a 1080p screen is 540 interface pixels tall, and the whole dialog fits in that.
  dlg = Dialog{ title = "Pixelbolt Fluids " .. M.VERSION, onclose = function() stopPlayback(); M.dialog = nil end }
  dlg:combobox{ id = "preset", label = "Preset", option = titles[1], options = titles, onchange = function()
    for _, p in ipairs(presets) do if p.title == dlg.data.preset then selectPreset(p) end end
  end }
  dlg:newrow()
  dlg:label{ id = "note", text = "" }
  for _, slider in ipairs(controls.SLIDERS) do
    dlg:slider{ id = slider.key, label = slider.label, min = 0, max = controls.positions(slider), value = 0, onchange = function()
      state.values[slider.key] = controls.valueAt(slider, dlg.data[slider.key])
      dlg:modify{ id = slider.key, label = sliderLabel(slider) }
      stale()
    end }
  end
  dlg:number{ id = "seed", label = "Seed", text = "1", decimals = 0, onchange = function()
    local value = math.tointeger(math.floor(tonumber(dlg.data.seed) or 0))
    if value and value >= controls.SEED_MIN and value <= controls.SEED_MAX then state.seed = value; stale()
    else dlg:modify{ id = "seed", text = tostring(state.seed) } end
  end }
  dlg:button{ id = "randomize", text = "Randomize", onclick = function()
    if engine.isPrebaked(state.preset) then
      local seeds = engine.seeds(state.preset)
      local at = 1
      for i, s in ipairs(seeds) do if s == state.seed then at = i end end
      state.seed = seeds[at % #seeds + 1]
    else
      state.seed = math.random(controls.SEED_MIN, controls.SEED_MAX)
    end
    dlg:modify{ id = "seed", text = tostring(state.seed) }
    stale()
  end }
  dlg:button{ id = "reset", text = "Reset", onclick = function() selectPreset(state.preset) end }
  dlg:radio{ id = "to_sprite", label = "Bake into", text = "New sprite", selected = true }
  dlg:radio{ id = "to_layer", text = "New layer" }
  dlg:check{ id = "centred", label = "Layer position", text = "Centre", selected = true, onclick = onCentre }
  dlg:number{ id = "x", label = "X, Y", text = "0", decimals = 0 }
  dlg:number{ id = "y", text = "0", decimals = 0 }
  -- Both expand flags, or 1.3-rc1's reading of them stretches the canvas.
  dlg:canvas{ id = "canvas", label = "Preview", width = PREVIEW, height = PREVIEW, hexpand = false, vexpand = false, onpaint = paint }
  dlg:newrow()
  dlg:label{ id = "status", text = "" }
  dlg:newrow()
  -- Enter presses the focused button, so Preview (harmless) is the default rather than Bake.
  dlg:button{ id = "preview", text = "Preview", focus = true, onclick = onPreview }
  dlg:button{ id = "bake", text = "Bake", onclick = onBake }
  dlg:button{ id = "close", text = "Close", onclick = function() dlg:close() end }
  dlg:button{ id = "link", label = M.CREDIT, text = "Pixelbolt on GitHub", onclick = function()
    app.command.Launch{ type = "url", path = M.URL }
  end }
  M.dialog = dlg
  selectPreset(presets[1])
  onCentre()
  dlg:show{ wait = false, autoscrollbars = true }
  return dlg
end

function M.init(plugin)
  plugin:newCommand{
    id = "PixelboltFluids",
    title = "Pixelbolt Fluids...",
    group = "edit_fx",
    onclick = function()
      local problem = M.versionProblem(app)
      if problem then alert(problem); return end
      M.open()
    end,
  }
end

function M.exit(plugin)
  if M.dialog then M.dialog:close() end
end

return M
