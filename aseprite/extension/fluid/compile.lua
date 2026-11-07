local use = ...
-- Gas bake orchestration: warmup, seam memory, sparks and obstacle stamps.
-- Entry point used by the extension and standalone harness; compile(source) is unchanged.

local craft = use("fluid/craft")
local reader = use("fluid/read")
local gas = use("fluid/gas")
local emit = use("fluid/emit")
local look = use("fluid/look")
local sparks = use("fluid/sparks")
local compiler = {}

-- src/fluid.js:4218-4225,4910-4924 (c915af9), stampsOf / simulate.
-- Composites clipped obstacle rows into the baked frame.
local function stamp(cells, effect, layout, mode, W, H, under)
  -- Under-stamps fill empty cells behind the baked fields in reverse source order.
  -- That retains the reference composition: the last overlapping under-stamp wins.
  local first, last, step = 1, #effect.obstacles, 1
  if under then
    first, last, step = #effect.obstacles, 1, -1
  end
  for index = first, last, step do
    local o = effect.obstacles[index]
    local at = layout.places[index]
    if o.draw == mode and at.show then
      for j, row in ipairs(o.rows) do
        local y = at.y + j - 1
        if y >= 0 and y < H then
          for k = math.max(1, 1 - at.x), math.min(#row, W - at.x) do
            local c = y * W + at.x + k
            if row[k] ~= 0 and (not under or cells[c] == 0) then
              cells[c] = row[k]
            end
          end
        end
      end
    end
  end
end

-- src/fluid.js:3965-3981,3990-4003,4807-4924,4980-4988 (c915af9), compileFluid / simulate.
-- Bakes one gas effect into the standalone frame contract.
function compiler.compile(source)
  local effect, W, H = reader.read(source)
  local N = W * H
  local run = {
    effect = effect,
    view = effect,
    layout = effect.layout,
    state = gas.create(effect, W, H),
    base = {craft.zeros(N), craft.zeros(N), craft.zeros(N), craft.zeros(N)},
    sparks = {}
  }
  local frames, loop = effect.frames, effect.loop
  local begin, blend = effect.warmup * frames, effect.blend
  local sparkTail = 0
  for _, e in ipairs(effect.emitters) do
    if e.sparks then
      sparkTail = math.max(sparkTail, e.sparks.life[2])
    end
  end
  local total = loop and (effect.warmup + 1) * frames + sparkTail or frames
  if N * total * effect.substeps * (effect.iterations + 10) > 400000000 then
    error(effect.path .. ': simulations exceed 400 million cell updates', 0)
  end
  local tail, seam, chars, drawn, layouts = {}, {}, {}, {}, {}
  for i = 1, frames do
    drawn[i] = {}
  end
  for t = 0, total - 1 do
    local cycle = loop and t % frames or t
    local out = t - begin
    local recording = not loop or (out >= 0 and out < frames)
    if effect.moving then
      use("fluid/obstacles").move(run, cycle)
    end
    local here = emit.frame(run, t, cycle)
    gas.solve(run)
    gas.fields(run.state, run.base)
    if loop and out < 0 then
      if out >= -blend then
        local fields = {}
        for f = 1, #run.base do
          fields[f] = craft.copy(run.base[f])
        end
        tail[out + blend + 1] = fields
      end
      if #run.sparks > 0 then
        sparks.frame(run, here, cycle, false)
      end
      -- Warmup advances band memory even though these frames are not returned.
      look.draw(run, W, H)
      if out >= -blend - 1 then
        seam[out + blend + 2] = run.hold
      end
    else
      sparks.frame(run, here, cycle, recording)
      -- Recorded sparks outlive their cycle and wrap onto its beginning in this order.
      sparks.draw(run, drawn[(loop and out or t) % frames + 1])
      if recording then
        local frame = loop and out or t
        local k = frame - (frames - blend)
        if loop and k >= 0 then
          local w = craft.smooth((k + 1) / blend)
          for f = 1, #run.base do
            local a, b = run.base[f], tail[k + 1][f]
            for c = 1, N do
              a[c] = a[c] * (1 - w) + b[c] * w
            end
          end
          -- Restore the memory BEFORE the warmup frame being blended toward, then draw it.
          look.handBack(run, seam[k + 1], w, effect.seed)
        end
        chars[frame + 1] = look.draw(run, W, H)
        layouts[frame + 1] = run.layout
      end
    end
  end
  for i, cells in ipairs(chars) do
    local list = drawn[i]
    for k = 1, #list, 2 do
      cells[list[k]] = list[k + 1]
    end
    stamp(cells, effect, layouts[i], 'under', W, H, true)
    stamp(cells, effect, layouts[i], 'over', W, H, false)
    for c = 1, N do
      cells[c] = cells[c] ~= 0 and utf8.char(cells[c]) or false
    end
  end
  return {width = W, height = H, loop = loop, durations = effect.durations, frames = chars}
end

return compiler
