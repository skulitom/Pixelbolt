-- Puts a bake into Aseprite: a new sprite at the effect's own size, or a new layer in the active sprite. Everything
-- happens in one app.transaction, so one undo removes the whole bake.
--
-- `host` carries Aseprite's globals (app, Sprite, Image, ImageSpec, Point, ColorMode, Color), so the checks can run this
-- module against a stand-in API outside Aseprite.
local use = ...
local engine = use("engine")

local M = {}

M.MESSAGES = {
  grayscale = "This sprite is in Grayscale mode. Convert it to RGB first (Sprite > Color Mode > RGB Color), "
    .. "or bake into a new sprite.",
  noSprite = "There is no open sprite to add a layer to. Open one, or bake into a new sprite.",
  palettes = "This sprite changes palettes between frames, and the effect's colours can't be added to all of them. "
    .. "Convert it to RGB first, or bake into a new sprite.",
}

local function rgb(hex)
  return tonumber(hex:sub(2, 3), 16), tonumber(hex:sub(4, 5), 16), tonumber(hex:sub(6, 7), 16)
end
M.rgb = rgb

-- For an Indexed sprite: the palette entry for each key the bake draws, reusing an exact match (never the
-- transparent entry) and adding the rest at the end. Returns nil and a message when they don't fit in 256.
function M.indexedPlan(sprite, preset, result)
  local palette = sprite.palettes[1]
  local size, transparent = #palette, sprite.transparentColor
  local index, additions, nextIndex = {}, {}, size
  for _, key in ipairs(engine.usedKeys(preset, result)) do
    local r, g, b = rgb(preset.source.palette[key])
    for i = 0, size - 1 do
      if i ~= transparent then
        local c = palette:getColor(i)
        if c.red == r and c.green == g and c.blue == b and c.alpha == 255 then index[key] = i; break end
      end
    end
    if index[key] == nil then
      -- An added colour may repeat an earlier addition's: reuse it.
      for _, add in ipairs(additions) do if add.hex == preset.source.palette[key] then index[key] = add.index end end
      if index[key] == nil then
        if nextIndex == transparent then nextIndex = nextIndex + 1 end
        additions[#additions + 1] = { index = nextIndex, hex = preset.source.palette[key], r = r, g = g, b = b }
        index[key] = nextIndex
        nextIndex = nextIndex + 1
      end
    end
  end
  local last = size - 1
  for _, add in ipairs(additions) do if add.index > last then last = add.index end end
  if last >= 256 then
    return nil, string.format("The sprite's palette is full: it has %d entries, this effect needs %d more colours, "
      .. "and an Indexed palette holds 256 (the transparent entry can't hold a colour). Free some palette entries, "
      .. "convert the sprite to RGB, or bake into a new sprite.", size, #additions)
  end
  -- Aseprite moves a transparent entry that sits past the palette's end onto its new last entry when the palette
  -- changes size, so a palette that grows reaches it, and the transparent entry stays where the images expect it.
  local planned = last + 1
  if #additions > 0 and transparent >= planned then planned = transparent + 1 end
  return { index = index, additions = additions, size = planned }
end

-- One frame's cells as an image, or nil when the frame draws nothing.
local function frameImage(host, cells, W, H, mode, pixelOf, transparent)
  local image
  for c = 1, W * H do
    local key = cells[c]
    if key then
      if not image then
        image = host.Image(host.ImageSpec{ width = W, height = H, colorMode = mode, transparentColor = transparent })
        image:clear(transparent)
      end
      local i = c - 1
      image:drawPixel(i % W, i // W, pixelOf[key])
    end
  end
  return image
end

-- Puts `result` (engine.run) into Aseprite. options: { target = "sprite" | "layer", x, y, title }.
-- Returns the sprite, or nil and a message when nothing was changed.
function M.apply(host, preset, result, options)
  local app, ColorMode = host.app, host.ColorMode
  local W, H, n = result.width, result.height, #result.frames
  local title = options.title or preset.title
  if options.target == "layer" then
    local sprite = app.activeSprite
    if not sprite then return nil, M.MESSAGES.noSprite end
    local mode = sprite.colorMode
    if mode == ColorMode.GRAYSCALE then return nil, M.MESSAGES.grayscale end
    if mode == ColorMode.INDEXED and #sprite.palettes > 1 then return nil, M.MESSAGES.palettes end
    local pixelOf, plan, transparent = {}, nil, 0
    if mode == ColorMode.INDEXED then
      local message
      plan, message = M.indexedPlan(sprite, preset, result)
      if not plan then return nil, message end
      pixelOf, transparent = plan.index, sprite.transparentColor
    else
      for key, hex in pairs(preset.source.palette) do
        local r, g, b = rgb(hex)
        pixelOf[key] = app.pixelColor.rgba(r, g, b, 255)
      end
    end
    local start = app.activeFrame and app.activeFrame.frameNumber or 1
    local x, y = options.x or (sprite.width - W) // 2, options.y or (sprite.height - H) // 2
    app.transaction("Pixelbolt Fluids: " .. title, function()
      if plan and #plan.additions > 0 then
        local palette = sprite.palettes[1]
        if #palette < plan.size then palette:resize(plan.size) end
        -- A Color, not a pixel value: in an Indexed sprite Aseprite reads a bare integer as a palette index.
        for _, add in ipairs(plan.additions) do palette:setColor(add.index, host.Color{ r = add.r, g = add.g, b = add.b, a = 255 }) end
      end
      -- Aseprite stretches a tag that ends on the last frame over frames added after it; the user's tags keep
      -- their length, so note them now and put them back below.
      local lastBefore, stretched = #sprite.frames, {}
      for _, tag in ipairs(sprite.tags) do
        if tag.toFrame and tag.toFrame.frameNumber == lastBefore then stretched[#stretched + 1] = tag end
      end
      local layer = sprite:newLayer()
      layer.name = title
      for k = 1, n do
        local number = start + k - 1
        if number > #sprite.frames then
          local frame = sprite:newEmptyFrame(number)
          frame.duration = M.seconds(result.durations[k])
        end
        local image = frameImage(host, result.frames[k], W, H, mode, pixelOf, transparent)
        if image then sprite:newCel(layer, number, image, host.Point(x, y)) end
      end
      if #sprite.frames > lastBefore then
        for _, tag in ipairs(stretched) do tag.toFrame = lastBefore end
      end
      local tag = sprite:newTag(start, start + n - 1)
      tag.name = title
    end)
    return sprite
  end
  -- A new sprite at the effect's size, RGB, with the effect's frame durations.
  local sprite = host.Sprite(W, H, ColorMode.RGB)
  local pixelOf = {}
  for key, hex in pairs(preset.source.palette) do
    local r, g, b = rgb(hex)
    pixelOf[key] = app.pixelColor.rgba(r, g, b, 255)
  end
  app.transaction("Pixelbolt Fluids: " .. title, function()
    local layer = sprite.layers[1]
    layer.name = title
    sprite.frames[1].duration = M.seconds(result.durations[1])
    for k = 2, n do
      local frame = sprite:newEmptyFrame(k)
      frame.duration = M.seconds(result.durations[k])
    end
    for k = 1, n do
      local image = frameImage(host, result.frames[k], W, H, ColorMode.RGB, pixelOf, 0)
      if image then sprite:newCel(layer, k, image, host.Point(0, 0)) end
    end
    local tag = sprite:newTag(1, n)
    tag.name = title
  end)
  return sprite
end

-- A frame duration for Aseprite, which keeps whole milliseconds and truncates: half a millisecond more lands on `ms`.
function M.seconds(ms) return (ms + 0.5) / 1000 end

-- Where a layer bake goes by default: the effect centred on the sprite.
function M.centre(sprite, W, H)
  return (sprite.width - W) // 2, (sprite.height - H) // 2
end

return M
