local use = ...
-- Gas field-to-band mapping, held bands, cleanup and loop memory handback.
-- Used by compile; produces palette codes without changing the supplied look.

local craft = use("fluid/craft")
local grid = use("fluid/grid")
local look = {}
local zeros, max = craft.zeros, math.max

-- src/fluid.js:3884-3886 (c915af9), renderFields.cut.
-- Offsets a threshold by this pixel's feather.
local function cut(thresholds, gaps, k, f)
  return thresholds[k] - f * gaps[k]
end

-- src/fluid.js:3884-3886 (c915af9), renderFields.margin.
-- Computes the band margin for hysteresis.
local function margin(gaps, k, f)
  return 0.25 * ((1 - f) * gaps[k] + (k > 1 and f * gaps[k - 1] or 0))
end

-- src/fluid.js:3714-3959 (c915af9), renderFields (gas branch).
-- Maps fields to held palette bands, then cleans and outlines.
function look.render(effect, base, W, H, before)
  local N = W * H
  local solid, front = effect.solid, effect.front
  local chars, after = zeros(N, 0), {wet = zeros(N, 0), levels = {}}
  local density = base[1]
  local lit, shade
  for _, layer in ipairs(effect.look) do
    if layer.field == 'light' or layer.field == 'shadow' then
      lit, shade = zeros(N), zeros(N)
      local lx, ly = effect.light[1], effect.light[2]
      for j = 0, H - 1 do
        for i = 0, W - 1 do
          local c = j * W + i + 1
          local here = density[c]
          local x, y = i + 0.5, j + 0.5
          if here > 0 then
            lit[c] = max(0, 1 - grid.bilinearZero(density, W, H, x + 2 * lx - 0.5, y + 2 * ly - 0.5) / here)
            shade[c] = max(0, 1 - grid.bilinearZero(density, W, H, x - 2 * lx - 0.5, y - 2 * ly - 0.5) / here)
          end
        end
      end
      break
    end
  end
  for index, layer in ipairs(effect.look) do
    local field = layer.field == 'density' and density
      or layer.field == 'temperature' and base[2]
      or layer.field == 'light' and lit
      or shade
    local thresholds, gaps, colors, dither = layer.thresholds, layer.gaps, layer.colors, layer.dither
    local shading = layer.field == 'light' or layer.field == 'shadow'
    local n = #thresholds
    local held = before and before.levels[index]
    local keep = zeros(N, 0)
    after.levels[index] = keep
    local none = cut(thresholds, gaps, 1, dither) - margin(gaps, 1, dither)
    local feathers = layer.feathers
    for c = 1, N do
      local value = field[c]
      if value < none then
        keep[c] = 128
      else
        local hidden = solid[c] or (shading and chars[c] == 0)
        local feather = feathers[c]
        local level = 0
        while level < n and value >= thresholds[level + 1] - feather * gaps[level + 1] do
          level = level + 1
        end
        -- The reference Uint8 memory packs HELD = 63, WAITING = 64, SETTLED = 128.
        -- Levels are at most 16, so these writes already fit a byte without extra wrapping.
        local was = held and (held[c] & 63) or level
        local settled = held and (held[c] & 128) ~= 0 or false
        local waiting = 0
        if level ~= was and (level ~= 0 or not settled) then
          local up, down = 0, 0
          while up < n and value >= cut(thresholds, gaps, up + 1, feather) + margin(gaps, up + 1, feather) do
            up = up + 1
          end
          while down < n and value >= cut(thresholds, gaps, down + 1, feather) - margin(gaps, down + 1, feather) do
            down = down + 1
          end
          local clear = was < up and up or was > down and down or was
          if clear ~= was then
            if not settled then
              level = clear
            end
          elseif not settled or (held[c] & 64) == 0 then
            level = was
            waiting = settled and 64 or 0
          end
        end
        local inside = (level == 0 or value >= cut(thresholds, gaps, level, feather) + margin(gaps, level, feather))
          and (level == n or value < cut(thresholds, gaps, level + 1, feather) - margin(gaps, level + 1, feather))
        keep[c] = level | waiting | (((level == was and settled) or inside) and 128 or 0)
        if not hidden and level ~= 0 then
          chars[c] = colors[level]
        end
      end
    end
  end
  if effect.strays then
    craft.strays(chars, W, H, solid)
  end
  if effect.outline ~= 0 then
    -- Outline reads a snapshot, unlike the in-place stray cleanup.
    local filled = craft.copy(chars)
    for j = 0, H - 1 do
      for i = 0, W - 1 do
        local c = j * W + i + 1
        if filled[c] == 0 and not front[c] and (
          (i > 0 and filled[c - 1] ~= 0)
          or (i < W - 1 and filled[c + 1] ~= 0)
          or (j > 0 and filled[c - W] ~= 0)
          or (j < H - 1 and filled[c + W] ~= 0)
        ) then
          chars[c] = effect.outline
        end
      end
    end
  end
  return chars, after
end

-- src/fluid.js:4278-4284 (c915af9), drawFrame.
-- Draws the current fields and advances band memory.
function look.draw(run, W, H)
  local chars, after = look.render(run.view, run.base, W, H, run.hold)
  run.hold = after
  return chars
end

-- src/fluid.js:4289-4299 (c915af9), handBack.
-- Restores warmup band memory by seeded cell selection.
function look.handBack(run, to, w, seed)
  local own = run.hold
  local levels = {}
  for i, level in ipairs(own.levels) do
    levels[i] = craft.copy(level)
  end
  local wet = craft.copy(own.wet)
  for c = 1, #wet do
    -- Random hashing uses the JS zero-based cell number, not the Lua array index.
    if craft.random(seed, 5000, c - 1) < w then
      wet[c] = to.wet[c]
      for k = 1, #levels do
        levels[k][c] = to.levels[k][c]
      end
    end
  end
  run.hold = {wet = wet, levels = levels}
end

return look
