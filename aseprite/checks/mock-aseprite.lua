-- A stand-in for the parts of Aseprite's Lua API the extension uses, for checks in standalone Lua 5.4.
-- It records undo steps the way Aseprite's undo history counts them: one per app.transaction that changed a sprite,
-- and one per change made outside any transaction.
--
--   local aseprite = dofile("aseprite/checks/mock-aseprite.lua")
--   local env = aseprite.new{ apiVersion = 39 }   -- env.app, env.Sprite, env.Dialog, ... ; env.install() sets globals
local M = {}

function M.new(options)
  options = options or {}
  local env = { alerts = {}, alertLines = {}, launched = {}, timers = {}, dialogs = {} }
  local open = {}         -- sprites, in creation order
  local transaction = nil -- the set of sprites changed by the running transaction

  local ColorMode = { RGB = 0, GRAYSCALE = 1, INDEXED = 2, TILEMAP = 4 }
  env.ColorMode = ColorMode

  local function touch(sprite)
    if transaction then transaction[sprite] = true
    else sprite.undoHistory.undoSteps = sprite.undoHistory.undoSteps + 1 end
  end

  -- Pixel values as Aseprite packs them: RGBA as 0xAABBGGRR, indexed as the index.
  local pixelColor = {
    rgba = function(r, g, b, a) return (a or 255) << 24 | b << 16 | g << 8 | r end,
    rgbaR = function(v) return v & 255 end, rgbaG = function(v) return (v >> 8) & 255 end,
    rgbaB = function(v) return (v >> 16) & 255 end, rgbaA = function(v) return (v >> 24) & 255 end,
  }

  local function Color(t, g, b, a)
    if type(t) == "table" then return { red = t.r or t.red or 0, green = t.g or t.green or 0, blue = t.b or t.blue or 0, alpha = t.a or t.alpha or 255 } end
    if g ~= nil then return { red = t, green = g, blue = b, alpha = a or 255 } end
    return { red = pixelColor.rgbaR(t), green = pixelColor.rgbaG(t), blue = pixelColor.rgbaB(t), alpha = pixelColor.rgbaA(t) }
  end
  env.Color = Color

  local function Point(x, y) return { x = x, y = y } end
  env.Point = Point
  env.Rectangle = function(x, y, w, h) return { x = x, y = y, width = w, height = h } end

  local Image = {}
  Image.__index = Image
  local function newImage(w, h, mode, transparent)
    local image = setmetatable({ width = w, height = h, colorMode = mode or ColorMode.RGB, pixels = {} }, Image)
    image.spec = { width = w, height = h, colorMode = image.colorMode, transparentColor = transparent or 0 }
    image:clear()
    return image
  end
  function Image:clear(color)
    local v = color
    if v == nil then v = self.colorMode == ColorMode.INDEXED and self.spec.transparentColor or 0 end
    for i = 1, self.width * self.height do self.pixels[i] = v end
  end
  function Image:drawPixel(x, y, v)
    assert(math.type(x) == "integer" and math.type(y) == "integer", "drawPixel needs whole coordinates")
    assert(x >= 0 and y >= 0 and x < self.width and y < self.height, "drawPixel outside the image")
    assert(math.type(v) == "integer", "drawPixel needs an integer pixel value")
    self.pixels[y * self.width + x + 1] = v
  end
  function Image:getPixel(x, y) return self.pixels[y * self.width + x + 1] end
  env.Image = function(a, b, c)
    if type(a) == "table" then return newImage(a.width, a.height, a.colorMode, a.transparentColor) end
    return newImage(a, b, c)
  end
  env.ImageSpec = function(t) return { width = t.width, height = t.height, colorMode = t.colorMode or ColorMode.RGB, transparentColor = t.transparentColor or 0 } end

  -- Objects whose property writes count as changes.
  local function tracked(sprite, fields)
    local data = fields
    return setmetatable({}, {
      __index = data,
      __newindex = function(_, k, v) touch(sprite); data[k] = v end,
      __pairs = function() return next, data, nil end,
    })
  end

  local Palette = {}
  Palette.__index = Palette
  function Palette.__len(self) return #self.colors end
  function Palette:getColor(i) assert(i >= 0 and i < #self.colors, "palette index out of range"); return Color(self.colors[i + 1]) end
  -- As in Aseprite (color_class.cpp), a bare integer is read by the sprite's colour mode: in an Indexed sprite it is a
  -- palette index (out of range reads as transparent black), not an RGBA value.
  function Palette:setColor(i, v)
    assert(i >= 0 and i < #self.colors, "palette index out of range")
    touch(self.sprite)
    if type(v) == "table" then self.colors[i + 1] = pixelColor.rgba(v.red, v.green, v.blue, v.alpha)
    elseif self.sprite.colorMode == ColorMode.INDEXED then self.colors[i + 1] = self.colors[v + 1] or pixelColor.rgba(0, 0, 0, 0)
    else self.colors[i + 1] = v end
  end
  function Palette:resize(n)
    touch(self.sprite)
    -- As Aseprite's SetPalette does: a transparent index past the new end moves onto the last entry.
    if self.sprite.colorMode == ColorMode.INDEXED and self.sprite.transparentColor >= n then self.sprite.transparentColor = n - 1 end
    for i = #self.colors + 1, n do self.colors[i] = pixelColor.rgba(0, 0, 0, 255) end
    for i = #self.colors, n + 1, -1 do self.colors[i] = nil end
  end

  local Sprite = {}
  Sprite.__index = Sprite
  local function frameList(sprite)
    for i, f in ipairs(sprite.frames) do rawget(f, "_data").frameNumber = i end
  end
  -- Durations are kept in whole milliseconds, truncated, as Aseprite keeps them.
  local function newFrame(sprite, duration)
    local data = { ms = math.floor((duration or 0.1) * 1000), frameNumber = 0 }
    local frame = setmetatable({ _data = data }, {
      __index = function(t, k) if k == "duration" then return data.ms / 1000 end return data[k] end,
      __newindex = function(_, k, v)
        touch(sprite)
        if k == "duration" then data.ms = math.floor(v * 1000) else data[k] = v end
      end,
    })
    return frame
  end
  function Sprite:newLayer()
    touch(self)
    local layer = tracked(self, { name = "Layer " .. (#self.layers + 1), sprite = self, isTilemap = false })
    self.layers[#self.layers + 1] = layer
    return layer
  end
  function Sprite:newEmptyFrame(n)
    touch(self)
    n = n or (#self.frames + 1)
    assert(n >= 1 and n <= #self.frames + 1, "newEmptyFrame: frame number out of range")
    local frame = newFrame(self, 0.1)
    local last = #self.frames
    table.insert(self.frames, n, frame)
    -- As in Aseprite (doc_api.cpp), a tag that ends on the last frame grows over a frame added after it, and tags
    -- after the insertion point move on.
    for _, tag in ipairs(self.tags) do
      local t = rawget(tag, "_data")
      if t.to >= n or (t.to == last and n == last + 1) then t.to = t.to + 1 end
      if t.from >= n and n <= last then t.from = t.from + 1 end
    end
    -- Cels and tags after the insertion point move on by one frame.
    for _, cel in ipairs(self.cels) do if cel.frameNumber >= n then cel.frameNumber = cel.frameNumber + 1 end end
    frameList(self)
    return frame
  end
  function Sprite:newCel(layer, frameNumber, image, position)
    touch(self)
    if type(frameNumber) == "table" then frameNumber = frameNumber.frameNumber end
    assert(frameNumber >= 1 and frameNumber <= #self.frames, "newCel: no such frame")
    assert(image.colorMode == self.colorMode, "newCel: the image's colour mode differs from the sprite's")
    for i = #self.cels, 1, -1 do
      if self.cels[i].layer == layer and self.cels[i].frameNumber == frameNumber then table.remove(self.cels, i) end
    end
    local cel = { layer = layer, frameNumber = frameNumber, image = image, position = position or Point(0, 0) }
    self.cels[#self.cels + 1] = cel
    return cel
  end
  function Sprite:newTag(from, to)
    touch(self)
    assert(from >= 1 and to <= #self.frames and from <= to, "newTag: frames out of range")
    local sprite, data = self, { name = "Tag", from = from, to = to }
    -- Like Aseprite's Tag: fromFrame and toFrame are Frame objects; setting them takes a number or a Frame.
    local tag = setmetatable({ _data = data }, {
      __index = function(_, k)
        if k == "fromFrame" then return sprite.frames[data.from] end
        if k == "toFrame" then return sprite.frames[data.to] end
        return data[k]
      end,
      __newindex = function(_, k, v)
        touch(sprite)
        local number = type(v) == "table" and v.frameNumber or v
        if k == "fromFrame" then data.from = number elseif k == "toFrame" then data.to = number else data[k] = v end
      end,
    })
    self.tags[#self.tags + 1] = tag
    return tag
  end
  function Sprite:celAt(layer, frameNumber)
    for _, cel in ipairs(self.cels) do if cel.layer == layer and cel.frameNumber == frameNumber then return cel end end
    return nil
  end

  local function newSprite(w, h, mode, paletteSize)
    local sprite = setmetatable({ width = w, height = h, colorMode = mode or ColorMode.RGB, transparentColor = 0,
      layers = {}, frames = {}, cels = {}, tags = {}, undoHistory = { undoSteps = 0, redoSteps = 0 } }, Sprite)
    local colors = {}
    for i = 1, paletteSize or 32 do colors[i] = pixelColor.rgba((i * 37) % 256, (i * 91) % 256, (i * 53) % 256, 255) end
    sprite.palettes = { setmetatable({ colors = colors, sprite = sprite }, Palette) }
    sprite.layers[1] = tracked(sprite, { name = "Layer 1", sprite = sprite, isTilemap = false })
    sprite.frames[1] = newFrame(sprite, 0.1)
    frameList(sprite)
    open[#open + 1] = sprite
    env.app.activeSprite = sprite
    env.app.activeFrame = sprite.frames[1]
    return sprite
  end
  env.Sprite = function(w, h, mode) return newSprite(w, h, mode) end
  env.newSprite = newSprite
  env.sprites = open

  env.app = {
    apiVersion = options.apiVersion or 39,
    version = options.version or "1.3.17",
    pixelColor = pixelColor,
    activeSprite = nil, activeFrame = nil, -- API 21 names only: app.sprite and app.frame came in API 23
    alert = function(t)
      local text = type(t) == "table" and t.text or t
      if type(text) == "table" then env.alertLines[#env.alertLines + 1] = text; text = table.concat(text, " ") end
      env.alerts[#env.alerts + 1] = text
    end,
    refresh = function() end,
    transaction = function(label, fn)
      if fn == nil then fn = label end
      assert(transaction == nil, "nested app.transaction")
      transaction = {}
      local ok, err = pcall(fn)
      local changed = transaction
      transaction = nil
      for sprite in pairs(changed) do sprite.undoHistory.undoSteps = sprite.undoHistory.undoSteps + 1 end
      if not ok then error(err, 0) end
    end,
    command = setmetatable({}, { __index = function(_, name)
      return function(params) env.launched[#env.launched + 1] = { command = name, params = params } end
    end }),
  }

  -- Timers run when a check calls env.tick().
  env.Timer = function(t)
    local timer = { interval = t.interval, ontick = t.ontick, isRunning = false }
    function timer:start() self.isRunning = true; env.timers[#env.timers + 1] = self end
    function timer:stop() self.isRunning = false end
    return timer
  end
  function env.tick(times)
    for _ = 1, times or 1 do
      local due = {}
      for _, timer in ipairs(env.timers) do if timer.isRunning then due[#due + 1] = timer end end
      for _, timer in ipairs(due) do if timer.isRunning then timer.ontick() end end
    end
  end

  -- Dialogs keep their widgets by id; a check sets values and presses buttons through env.press/env.set.
  env.Dialog = function(t)
    local dlg = { widgets = {}, order = {}, title = type(t) == "table" and t.title or t, onclose = type(t) == "table" and t.onclose or nil, shown = false }
    local function add(kind) return function(self, w)
      w = w or {}
      w.kind = kind
      if w.id then self.widgets[w.id] = w end
      self.order[#self.order + 1] = w
      return self
    end end
    for _, kind in ipairs({ "button", "check", "combobox", "label", "number", "radio", "slider", "canvas", "separator", "entry" }) do dlg[kind] = add(kind) end
    function dlg:newrow() return self end
    function dlg:modify(m)
      local w = assert(self.widgets[m.id], "modify: no widget " .. tostring(m.id))
      for k, v in pairs(m) do if k ~= "id" then w[k] = v end end
      if w.kind == "radio" and m.selected then
        for _, other in ipairs(self.order) do if other.kind == "radio" and other ~= w then other.selected = false end end
      end
    end
    function dlg:repaint()
      for _, w in ipairs(self.order) do if w.kind == "canvas" and w.onpaint then
        local ctx = setmetatable({ draws = 0 }, { __index = function(c, k)
          if k == "drawImage" or k == "fillRect" then return function() rawset(c, "draws", c.draws + 1) end end
        end })
        w.onpaint({ context = ctx })
        w.lastDraws = ctx.draws
      end end
    end
    function dlg:show() self.shown = true end
    function dlg:close() self.shown = false; if self.onclose then self.onclose() end end
    setmetatable(dlg, { __index = function(self, k)
      if k == "data" then
        local data = {}
        for id, w in pairs(self.widgets) do
          if w.kind == "slider" then data[id] = w.value
          elseif w.kind == "number" then data[id] = math.tointeger(math.floor(tonumber(w.text) or 0)) -- textInt(): empty reads as 0
          elseif w.kind == "combobox" then data[id] = w.option
          elseif w.kind == "radio" or w.kind == "check" then data[id] = w.selected or false
          else data[id] = w.text end
        end
        return data
      end
    end })
    env.dialogs[#env.dialogs + 1] = dlg
    return dlg
  end

  function env.install()
    for _, name in ipairs({ "app", "Sprite", "Image", "ImageSpec", "Point", "Rectangle", "Color", "ColorMode", "Timer", "Dialog" }) do
      _G[name] = env[name]
    end
  end

  return env
end

return M
