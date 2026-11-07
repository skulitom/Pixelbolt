local use = ...
-- Gas spark spawning, movement, held pixels and trails.
-- Used by compile; list order determines overlap order.

local craft = use("fluid/craft")
local grid = use("fluid/grid")
local emit = use("fluid/emit")
local sparks = {}
local floor, min, sqrt = math.floor, math.min, math.sqrt
local random, sinDeg, cosDeg = craft.random, craft.sinDeg, craft.cosDeg

-- src/fluid.js:86 (c915af9), pick.
-- Samples a continuous interval.
local function pick(a, r)
  return a[1] + (a[2] - a[1]) * r
end

-- src/fluid.js:87 (c915af9), pickWhole.
-- Samples an inclusive integer interval.
local function pickWhole(a, r)
  return a[1] + min(a[2] - a[1], floor(r * (a[2] - a[1] + 1)))
end

-- src/fluid.js:3370-3431,4304-4318 (c915af9), spawnSparks / moveSparks / sparkFrame (gas).
-- Moves existing sparks before spawning new ones.
function sparks.frame(run, here, cycle, spawning)
  local g, list = run.state.g, run.sparks
  local W, H, u, v, solid = g.W, g.H, g.u, g.v, g.pixels
  -- Remove from the end to preserve the surviving sparks' order for later overlaps.
  for k = #list, 1, -1 do
    local p = list[k]
    local s = p.s
    p.age = p.age + 1
    local fx, fy =
      s.follow ~= 0 and grid.sampleU(g, u, p.x, p.y) * s.follow or 0,
      s.follow ~= 0 and grid.sampleV(g, v, p.x, p.y) * s.follow or 0
    p.vx = (p.vx + s.gravity[1]) * (1 - s.drag)
    p.vy = (p.vy + s.gravity[2]) * (1 - s.drag)
    p.px = p.x
    p.py = p.y
    -- Preserve the complete JS += RHS before adding it to the old position.
    p.x = p.x + (fx + p.vx)
    p.y = p.y + (fy + p.vy)
    local finite = p.x + p.y == p.x + p.y and math.abs(p.x + p.y) < math.huge
    local hit = finite and grid.crossesSolid(solid, W, H, p.px, p.py, p.x, p.y)
    if p.age >= p.life or not finite or hit or p.x < -16 or p.y < -16 or p.x > W + 16 or p.y > H + 16 then
      table.remove(list, k)
    end
  end
  if not spawning then
    return
  end
  for index, e in ipairs(run.effect.emitters) do
    if here[index] and e.sparks then
      local hereEmitter, s, seed = here[index], e.sparks, run.effect.seed
      local n = floor(s.count * emit.flicker(hereEmitter, hereEmitter.x, hereEmitter.y) / e.strength + random(seed, index - 1, cycle, 8))
      for k = 0, n - 1 do
        if #list >= 4096 then
          error(run.effect.path .. '.emitters.sparks: more than 4096 sparks', 0)
        end
        local x, y = hereEmitter.x, hereEmitter.y
        if e.radius then
          local d = e.radius * sqrt(random(seed, index - 1, cycle, k, 9))
          local a = 360 * random(seed, index - 1, cycle, k, 10)
          x = x + d * cosDeg(a)
          y = y + d * sinDeg(a)
        else
          x = x + (random(seed, index - 1, cycle, k, 9) - 0.5) * e.area[1]
          y = y + (random(seed, index - 1, cycle, k, 10) - 0.5) * e.area[2]
        end
        local angle, speed = pick(s.angle, random(seed, index - 1, cycle, k, 11)), pick(s.speed, random(seed, index - 1, cycle, k, 12))
        list[#list + 1] = {
          s = s,
          x = x,
          y = y,
          vx = cosDeg(angle) * speed,
          vy = sinDeg(angle) * speed,
          age = 0,
          life = pickWhole(s.life, random(seed, index - 1, cycle, k, 13))
        }
      end
    end
  end
end

-- src/fluid.js:4410-4414 (c915af9), heldPixel.
-- Holds a pixel until its position clearly crosses the margin.
local function heldPixel(drawn, settled, at)
  local pixel = floor(at)
  if drawn ~= nil and pixel ~= drawn and not settled and at >= drawn - 0.25 and at < drawn + 1 + 0.25 then
    pixel = drawn
  end
  return pixel, (pixel == drawn and settled) or (at >= pixel + 0.25 and at < pixel + 1 - 0.25)
end

-- src/fluid.js:4415-4435 (c915af9), drawSparks (gas subset).
-- Writes spark heads and trails in their overlap order.
function sparks.draw(run, list)
  local g = run.state.g
  local W, H, solid, front = g.W, g.H, g.pixels, run.view.front

  -- src/fluid.js:4866-4867 (c915af9), simulate (drawSparks callback).
  -- Appends an in-bounds pixel unless a front obstacle hides it.
  local function put(x, y, code)
    if x >= 0 and y >= 0 and x < W and y < H and not front[y * W + x + 1] then
      list[#list + 1] = y * W + x + 1
      list[#list + 1] = code
    end
  end
  for _, p in ipairs(run.sparks) do
    local s = p.s
    local step = min(#s.colors - 1, floor(p.age * #s.colors / p.life))
    local head = s.colors[step + 1]
    local cx, cy = p.x, p.y
    local x0, sx = heldPixel(p.hx, p.sx, cx)
    local y0, sy = heldPixel(p.hy, p.sy, cy)
    if (x0 ~= floor(cx) or y0 ~= floor(cy)) and x0 >= 0 and y0 >= 0 and x0 < W and y0 < H and solid[y0 * W + x0 + 1] then
      x0, sx = heldPixel(nil, false, cx)
      y0, sy = heldPixel(nil, false, cy)
    end
    if s.trail and p.px ~= nil then
      local tail = s.colors[min(#s.colors - 1, step + 1) + 1]
      craft.traceLine(
        p.hx or floor(p.px), p.hy or floor(p.py), x0, y0,
        -- src/fluid.js:4429-4431 (c915af9), drawSparks trail callback.
        -- Writes the trail before the head so the head wins their overlap.
        function(x, y)
          put(x, y, tail)
        end
      )
    end
    p.hx = x0
    p.hy = y0
    p.sx = sx
    p.sy = sy
    put(x0, y0, head)
  end
end

return sparks
