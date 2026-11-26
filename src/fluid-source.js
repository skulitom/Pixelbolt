// Source validation, obstacle tracks and layouts, solid-layer queries, emitter geometry and source warnings for
// pixelforge-fluid. Browser-compatible and deterministic; emits no pixels and performs no I/O.
import { fail, isObject } from './core.js';
import { fields, number, integer, boolean, pair, range } from './authoring.js';
import { patternProblem, ditherThreshold, random, sinDeg, cosDeg } from './craft.js';
import { readElectric, readElectrode, ELECTRODE_FIELDS } from './electric.js';
import { readBodies, startCells } from './bodies.js';
import { readLight } from './light.js';
import { FLUID_KINDS, FLUID_FIELDS, FLUID_WALLS, OBSTACLE_SURFACES, LIMITS, SALT, ADVECTION, MAX_VISCOSITY, smooth, NONE, ICE, EDGE } from './fluid-grid.js';

export const identifier = (value, path) => {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) fail(path, 'expected a name of letters, digits, hyphens or underscores, starting with a letter');
  return value;
};
// Grid rows name colours by character, so every colour a fluid draws is a one-character palette key.
export const paletteKey = (value, path, palette) => {
  if (typeof value !== 'string' || value.length !== 1 || value === '.' || value === ' ' || !Object.hasOwn(palette, value)) fail(path, 'expected a one-character palette key; grid rows name colours by character');
  return value;
};

// ---- Reading a source -----------------------------------------------------------------------------------------------
// A pulse (strength rising and falling) or an orbit (the emitter circling its point), repeating every `period` frames.
function readCycle(value, path, frames, loop, orbit) {
  fields(value, orbit ? ['radius', 'period', 'phase'] : ['amplitude', 'period', 'phase'], path);
  const period = integer(value.period ?? frames, `${path}.period`, orbit ? -256 : 1, 256);
  if (period === 0) fail(`${path}.period`, 'expected a whole number of frames per turn; negative turns anticlockwise');
  if (loop && frames % period !== 0) fail(`${path}.period`, `a looping effect repeats every ${frames} frames, so the period must divide ${frames}`);
  const phase = number(value.phase ?? 0, `${path}.phase`, -3600, 3600);
  if (!orbit) return { period, phase, amplitude: number(value.amplitude ?? 0.5, `${path}.amplitude`, 0, 1) };
  // A radius [x, y] makes the orbit an ellipse, so what the emitter leaves behind stretches and squeezes as it turns.
  const radius = Array.isArray(value.radius) ? pair(value.radius, `${path}.radius`, 0, 128) : [number(value.radius, `${path}.radius`, 0, 128), value.radius];
  return { period, phase, radius };
}

function readSparks(value, path, context, burst) {
  const { palette, liquid } = context;
  fields(value, ['count', 'life', 'colors', 'size', 'trail', 'angle', 'speed', 'gravity', 'drag', 'follow', 'pop', 'rise', 'wobble', 'lift'], path);
  if (!Array.isArray(value.colors) || !value.colors.length || value.colors.length > LIMITS.colors) fail(`${path}.colors`, `expected 1–${LIMITS.colors} palette keys, spread over each spark's life`);
  if (value.pop !== undefined && !liquid) fail(`${path}.pop`, 'pop bursts bubbles that reach the surface; it applies to liquids');
  if (value.rise !== undefined && !liquid) fail(`${path}.rise`, 'rise makes the spark a bubble that rises through a liquid; it applies to liquids');
  if (value.wobble !== undefined && value.rise === undefined) fail(`${path}.wobble`, 'wobble sways a bubble from side to side as it rises; set rise to make the spark a bubble');
  if (value.lift !== undefined && value.rise === undefined) fail(`${path}.lift`, 'lift lets a bubble push the water up around it; set rise to make the spark a bubble');
  const bubble = readBubble(value, path);
  return {
    count: number(value.count, `${path}.count`, 0.01, burst ? 256 : 16), life: range(value.life ?? [8, 16], `${path}.life`, 1, 256, true),
    colors: value.colors.map((key, i) => paletteKey(key, `${path}.colors[${i}]`, palette)),
    size: integer(value.size ?? 1, `${path}.size`, 1, 3), trail: value.trail === undefined ? false : boolean(value.trail, `${path}.trail`),
    angle: range(value.angle ?? [0, 360], `${path}.angle`, -3600, 3600), speed: range(value.speed ?? 0, `${path}.speed`, 0, 16),
    gravity: value.gravity === undefined ? [0, 0] : pair(value.gravity, `${path}.gravity`, -2, 2), drag: number(value.drag ?? 0.05, `${path}.drag`, 0, 1),
    follow: number(value.follow ?? 1, `${path}.follow`, 0, 2), pop: value.pop === undefined ? false : boolean(value.pop, `${path}.pop`), ...bubble,
    // In a liquid, a spark that rides the flow out of the water flies on as a droplet (see moveSparks), falling with the
    // liquid's gravity unless it has its own. A bubble ends where it leaves the water instead.
    fling: liquid && bubble.rise === null, inherit: liquid && bubble.rise === null && value.gravity === undefined
  };
}
// A bubble is air in the water (see moveBubble): `rise` is how fast it rises through still water, against the liquid's
// gravity, `wobble` how far it sways from side to side as it goes, and `lift` the share of its buoyancy it hands to the
// water around it (see stepLiquid). Sparks and whitewater without `rise` are not bubbles.
function readBubble(value, path) {
  return {
    rise: value.rise === undefined ? null : number(value.rise, `${path}.rise`, 0, 4), wobble: value.wobble === undefined ? 0 : number(value.wobble, `${path}.wobble`, 0, 2),
    lift: value.lift === undefined ? 0 : number(value.lift, `${path}.lift`, 0, 1)
  };
}

// Whitewater: spray and foam thrown off a liquid by its own motion. A particle at the surface throws a droplet where its
// velocity changes sharply within a frame (`impact`: a drop landing, a fall hitting a pool) or where it moves fast
// (`speed`: a stream shedding drops). Droplets are sparks; with follow 0 they are spray, otherwise foam on the flow. With
// `rise` the layer makes bubbles instead, under the surface: air a plunging stream or a landing drop drives into a pool.
function readWhitewater(layer, path, context, gravity) {
  const { palette } = context;
  fields(layer, ['impact', 'speed', 'chance', 'throw', 'spread', 'life', 'colors', 'size', 'trail', 'gravity', 'drag', 'follow', 'rise', 'wobble', 'lift', 'pop'], path);
  if ((layer.impact === undefined) === (layer.speed === undefined)) fail(path, 'use exactly one of impact (water whose speed changes sharply, such as where a drop lands) or speed (fast water, such as a stream shedding drops)');
  if (!Array.isArray(layer.colors) || !layer.colors.length || layer.colors.length > LIMITS.colors) fail(`${path}.colors`, `expected 1–${LIMITS.colors} palette keys, spread over each droplet's life`);
  const bubbles = layer.rise !== undefined;
  for (const key of ['wobble', 'lift', 'pop']) if (layer[key] !== undefined && !bubbles) fail(`${path}.${key}`, `${key} applies to bubbles; set rise to make this layer bubbles under the surface`);
  // Bubbles start at rest in the water, which carries them; throw, spread and gravity shape spray thrown into the air.
  for (const key of ['throw', 'spread', 'gravity']) if (layer[key] !== undefined && bubbles) fail(`${path}.${key}`, `${key} shapes spray thrown off the surface; bubbles start at rest under it, ride the flow and rise by rise`);
  return {
    impact: layer.impact === undefined ? null : number(layer.impact, `${path}.impact`, 0.05, 32), speed: layer.speed === undefined ? null : number(layer.speed, `${path}.speed`, 0.05, 32),
    chance: number(layer.chance ?? 0.1, `${path}.chance`, 0.001, 1), throw: number(layer.throw ?? 1, `${path}.throw`, 0, 4), spread: number(layer.spread ?? 20, `${path}.spread`, 0, 180),
    life: range(layer.life ?? [6, 12], `${path}.life`, 1, 256, true), colors: layer.colors.map((key, i) => paletteKey(key, `${path}.colors[${i}]`, palette)),
    size: integer(layer.size ?? 1, `${path}.size`, 1, 3), trail: layer.trail === undefined ? false : boolean(layer.trail, `${path}.trail`),
    gravity: bubbles ? [0, 0] : layer.gravity === undefined ? gravity : pair(layer.gravity, `${path}.gravity`, -2, 2), inherit: !bubbles && layer.gravity === undefined, drag: number(layer.drag ?? 0.02, `${path}.drag`, 0, 1),
    follow: number(layer.follow ?? (bubbles ? 1 : 0), `${path}.follow`, 0, 2), pop: layer.pop === undefined ? false : boolean(layer.pop, `${path}.pop`), ...readBubble(layer, path)
  };
}

// `follow` ties an emitter to an obstacle: an index into the effect's obstacles, or the symbol one of them stamps. The
// emitter keeps its place beside the obstacle as the obstacle's keys move it, so a nozzle's flame leaves with its rocket
// and a spout pours from a moving kettle. Returns how far the obstacle is from its own x and y on every frame of the
// cycle, in the whole pixels it is drawn at, and whether it got there by a cut (no path to lay the emitter along), or
// null for an obstacle without keys, which never moves.
function readFollow(value, path, listed) {
  if (!listed.length) fail(path, 'this effect has no obstacles to follow');
  let index;
  if (typeof value === 'string') {
    const found = listed.flatMap((o, i) => (o.symbol === value ? [i] : []));
    if (!found.length) fail(path, `no obstacle stamps the symbol ${JSON.stringify(value)}; follow one of ${[...new Set(listed.map(o => o.symbol))].join(', ')}, or an obstacle's index`);
    if (found.length > 1) fail(path, `${found.map(i => `obstacles[${i}]`).join(' and ')} all stamp ${JSON.stringify(value)}; follow one by its index, such as ${found[0]}`);
    index = found[0];
  } else index = integer(value, path, 0, listed.length - 1);
  const o = listed[index];
  return { path: o.track ? o.track.map((place, f) => ({ x: place.x - o.x, y: place.y - o.y, cut: !f || place.jump })) : null };
}
function readEmitter(emitter, path, context, listed) {
  const { frames, loop, liquid } = context;
  fields(emitter, ['name', 'at', 'radius', 'area', 'burst', 'rate', 'start', 'end', 'repeat', 'density', 'temperature', 'falloff', 'velocity', 'expand', 'vortex', 'noise', 'flicker', 'pulse', 'orbit', 'follow', 'sparks', 'carry'], path);
  if (emitter.name !== undefined) identifier(emitter.name, `${path}.name`);
  if ((emitter.burst === undefined) === (emitter.rate === undefined)) fail(path, 'use exactly one of burst (added once, at start) or rate (added every frame from start until end)');
  const start = integer(emitter.start ?? 0, `${path}.start`, 0, frames - 1);
  if (emitter.end !== undefined && emitter.rate === undefined) fail(`${path}.end`, 'end applies to rate emitters');
  const end = integer(emitter.end ?? frames, `${path}.end`, start + 1, frames);
  const burst = emitter.burst !== undefined;
  let repeat = null;
  if (emitter.repeat !== undefined) {
    repeat = integer(emitter.repeat, `${path}.repeat`, 2, frames);
    if (loop && frames % repeat !== 0) fail(`${path}.repeat`, `a looping effect repeats every ${frames} frames, so repeat must divide ${frames}`);
    if (!burst) {
      if (emitter.end === undefined) fail(`${path}.repeat`, 'a repeating rate emitter needs end to bound each window');
      if (end - start >= repeat) fail(`${path}.repeat`, `the window (${start} to ${end}, ${end - start} frames) is at least repeat (${repeat}), so it never turns off`);
    }
  }
  if (emitter.radius !== undefined && emitter.area !== undefined) fail(path, 'use radius (a disc) or area (a box), not both');
  if (emitter.temperature !== undefined && liquid && !context.heat) fail(`${path}.temperature`, 'temperature drives gases; a liquid has a temperature only with heat (phase changes)');
  // A gas emitter may throw its smoke on heavy carriers instead of putting it in the air (dust, a skid's smoke).
  let carry = null;
  if (emitter.carry !== undefined) {
    if (liquid) fail(`${path}.carry`, 'carry throws gas on heavy carriers; liquid particles already carry their own speed');
    fields(emitter.carry, ['drag', 'release', 'gravity'], `${path}.carry`);
    if ((emitter.density ?? 0) < 0 || (emitter.temperature ?? 0) < 0) fail(`${path}.carry`, 'carry throws smoke and heat; a draining emitter (a negative density or temperature) has nothing to throw');
    if (!((emitter.density ?? 0) > 0) && !((emitter.temperature ?? 0) > 0)) fail(`${path}.carry`, 'carry throws this emitter\'s density and temperature, and a carrying emitter does not push the air; give it a positive density or temperature');
    carry = { drag: number(emitter.carry.drag ?? 0.1, `${path}.carry.drag`, 0, 1), release: number(emitter.carry.release ?? 0.2, `${path}.carry.release`, 0.01, 1), gravity: emitter.carry.gravity === undefined ? [0, 0] : pair(emitter.carry.gravity, `${path}.carry.gravity`, -2, 2) };
  }
  return {
    name: emitter.name, at: pair(emitter.at, `${path}.at`, -256, 512), start, end, repeat, loop, burst, carry,
    strength: burst ? number(emitter.burst, `${path}.burst`, 0.01, 64) : number(emitter.rate, `${path}.rate`, 0.01, 64),
    radius: emitter.area === undefined ? number(emitter.radius ?? 2, `${path}.radius`, 0.5, 64) : null,
    area: emitter.area === undefined ? null : pair(emitter.area, `${path}.area`, 1, 128),
    density: number(emitter.density ?? (liquid ? 1 : 0), `${path}.density`, liquid ? -1 : -16, liquid ? 1 : 16),
    temperature: number(emitter.temperature ?? 0, `${path}.temperature`, -16, 16), falloff: number(emitter.falloff ?? 0, `${path}.falloff`, 0, 1),
    velocity: emitter.velocity === undefined ? [0, 0] : pair(emitter.velocity, `${path}.velocity`, -16, 16), steer: emitter.velocity !== undefined || Boolean(emitter.vortex),
    expand: number(emitter.expand ?? 0, `${path}.expand`, -16, 16), vortex: number(emitter.vortex ?? 0, `${path}.vortex`, -16, 16),
    noise: number(emitter.noise ?? 0, `${path}.noise`, 0, 8), flicker: number(emitter.flicker ?? 0, `${path}.flicker`, 0, 1),
    pulse: emitter.pulse === undefined ? null : readCycle(emitter.pulse, `${path}.pulse`, frames, loop, false),
    orbit: emitter.orbit === undefined ? null : readCycle(emitter.orbit, `${path}.orbit`, frames, loop, true),
    ...(emitter.follow !== undefined && { follow: readFollow(emitter.follow, `${path}.follow`, listed) }),
    sparks: emitter.sparks === undefined ? null : readSparks(emitter.sparks, `${path}.sparks`, context, burst),
    // A liquid emitter's water starts at its temperature (the air's when unset).
    ...(liquid && context.heat && { warmth: emitter.temperature ?? null })
  };
}

function readLook(layer, path, context) {
  const { palette, liquid, seed } = context;
  fields(layer, ['field', 'colors', 'thresholds', 'dither', 'pattern', 'halo'], path);
  if (!FLUID_FIELDS.includes(layer.field)) fail(`${path}.field`, `expected ${FLUID_FIELDS.join(', ')}`);
  if (layer.field === 'temperature' && liquid && !context.heat) fail(`${path}.field`, 'liquids have no temperature without heat; use density, speed or depth');
  if (layer.field === 'strand' && !liquid) fail(`${path}.field`, 'strands are thin strings of liquid particles; a gas has density, temperature and speed');
  if ((layer.field === 'ionization' || layer.field === 'current') && !context.electric) fail(`${path}.field`, `${layer.field} is drawn from plasma; give the effect electric settings and an electrode (an obstacle with a voltage)`);
  if ((layer.field === 'ionization' || layer.field === 'current') && liquid) fail(`${path}.field`, `a liquid's plasma burns in the air over it; draw ${layer.field} in the vapour's look`);
  if (!Array.isArray(layer.colors) || !layer.colors.length || layer.colors.length > LIMITS.colors) fail(`${path}.colors`, `expected 1–${LIMITS.colors} palette keys, from the lowest level to the highest`);
  const colors = layer.colors.map((key, i) => paletteKey(key, `${path}.colors[${i}]`, palette));
  if (!Array.isArray(layer.thresholds) || layer.thresholds.length !== colors.length) fail(`${path}.thresholds`, `expected ${colors.length} thresholds, one per colour`);
  const thresholds = layer.thresholds.map((t, i) => {
    number(t, `${path}.thresholds[${i}]`, 0.001, 256);
    if (i && t <= layer.thresholds[i - 1]) fail(`${path}.thresholds[${i}]`, 'thresholds must rise from one colour to the next');
    return t;
  });
  const pattern = layer.pattern ?? 'bayer4', problem = patternProblem(pattern);
  if (problem) fail(`${path}.pattern${problem[0]}`, problem[1]);
  // A halo: a glow of one colour on the empty pixels within `width` steps of what the layer drew.
  let halo = null;
  if (layer.halo !== undefined) {
    if (!isObject(layer.halo)) fail(`${path}.halo`, 'expected { color, width }');
    fields(layer.halo, ['color', 'width'], `${path}.halo`);
    halo = { color: paletteKey(layer.halo.color, `${path}.halo.color`, palette).charCodeAt(0), width: integer(layer.halo.width ?? 1, `${path}.halo.width`, 1, 4) };
  }
  return { field: FLUID_FIELDS.indexOf(layer.field), colors: colors.map(key => key.charCodeAt(0)), thresholds, gaps: thresholds.map((t, i) => t - (i ? thresholds[i - 1] : 0)), dither: number(layer.dither ?? 0.5, `${path}.dither`, 0, 1), threshold: ditherThreshold(pattern, [0, 0], seed), halo };
}

// What shines and how its light looks (`shine`): light spreads from the cells of a gas whose `field` is at least `from`,
// in full from `full` up, by the flood in light.js (see stepShine). `thresholds` are rising shares of full light, and
// three lists give each level its colour, feathered in below its threshold as a look layer's are: `colors` on the
// obstacles, `smoke` on what the gas itself drew that does not shine, and `wall` on the empty pixels, for a wall or a
// floor behind the effect. `dark`, if given, lies on the obstacles wherever the light is below the first threshold:
// then they are drawn as they look fully lit, and the light is seen by what it leaves dark. A colour that is fully
// clear draws nothing: at that level what is drawn shows as it is. `own` holds the colours the shining field is itself
// drawn in, halos included: light is never laid over what gives it.
const SHINE_FIELDS = { temperature: 1, density: 0, ionization: 4, current: 5 };
function readShine(value, path, context, look) {
  if (!isObject(value)) fail(path, 'expected { from, reach, thresholds } and colors, smoke or wall for the light of what shines');
  if (context.liquid) fail(path, 'shine is the light of a gas (a fire, an explosion, an arc); a liquid has none');
  const light = readLight(value, path, { palette: context.palette, seed: context.seed, key: paletteKey }, ['field', 'from', 'full'], { colors: 'obstacles', smoke: 'the smoke' });
  const name = value.field ?? 'temperature';
  if (!Object.hasOwn(SHINE_FIELDS, name)) fail(`${path}.field`, `expected ${Object.keys(SHINE_FIELDS).join(', ')}: the field whose high values shine`);
  if ((name === 'ionization' || name === 'current') && !context.electric) fail(`${path}.field`, `${name} is a plasma's; give the effect electric settings and an electrode (an obstacle with a voltage)`);
  const from = number(value.from, `${path}.from`, 0.001, 256), full = number(value.full ?? from * 2, `${path}.full`, 0.001, 512), drawn = FLUID_FIELDS.indexOf(name);
  if (full <= from) fail(`${path}.full`, 'expected more than from: the level at which a pixel shines in full');
  return { ...light, name, source: SHINE_FIELDS[name], from, full, own: new Set(look.filter(other => other.field === drawn).flatMap(other => [...other.colors, ...(other.halo ? [other.halo.color] : [])])) };
}

// A disc (at, radius), an ellipse (at, radius [x, y]), a box (x, y, w, h), or both: their overlap, such as the lower
// half of a round flask.
function readShape(value, path, width, height) {
  const disc = value.at !== undefined || value.radius !== undefined, box = ['x', 'y', 'w', 'h'].some(key => value[key] !== undefined);
  if (!disc && !box) fail(path, 'expected at and radius (a disc, or an ellipse with radius [x, y]), x, y, w and h (a box), or both (their overlap)');
  let inDisc = () => true, inBox = () => true;
  if (disc) {
    const at = pair(value.at, `${path}.at`, -256, 512);
    if (Array.isArray(value.radius)) {
      // An ellipse with radii [rx, ry]: (dx / rx)² + (dy / ry)² ≤ 1, multiplied out so it needs no division.
      const [rx, ry] = pair(value.radius, `${path}.radius`, 0.5, 128), rx2 = rx * rx, ry2 = ry * ry;
      inDisc = (x, y) => { const dx = x - at[0], dy = y - at[1]; return dx * dx * ry2 + dy * dy * rx2 <= rx2 * ry2; };
    } else {
      const radius = number(value.radius, `${path}.radius`, 0.5, 128);
      inDisc = (x, y) => { const dx = x - at[0], dy = y - at[1]; return dx * dx + dy * dy <= radius * radius; };
    }
  }
  if (box) {
    const x = integer(value.x, `${path}.x`, 0, width - 1), y = integer(value.y, `${path}.y`, 0, height - 1);
    const w = integer(value.w, `${path}.w`, 1, width - x), h = integer(value.h, `${path}.h`, 1, height - y);
    inBox = (px, py) => px >= x && py >= y && px < x + w && py < y + h;
  }
  return (x, y) => inDisc(x, y) && inBox(x, y);
}

// Obstacle keys move an obstacle or take it away on cue: from a key's frame on it goes to the key's x and y (in a
// straight line over `over` frames, in whole pixels) and shows or not as `show` says, starting from where it was. A key
// may take it partly or wholly off the canvas, as far as its own size past any edge: what hangs off is clipped, as the
// canvas edge clips the fluid, so a rod can reach in from outside and a gate or a conveyor's load can leave.
// Returns its place on every frame of the cycle: { x, y, show }.
function readTrack(value, path, frames, home, rows, width, height) {
  if (!Array.isArray(value) || !value.length || value.length > 16) fail(path, 'expected 1–16 keys, each { frame, over, and any of x, y, show }');
  let last = -1;
  const keys = value.map((key, i) => {
    const kp = `${path}[${i}]`;
    fields(key, ['frame', 'over', 'x', 'y', 'show'], kp);
    const frame = integer(key.frame, `${kp}.frame`, 0, frames - 1);
    if (frame < last) fail(`${kp}.frame`, 'keys go in frame order');
    last = frame;
    if (key.x === undefined && key.y === undefined && key.show === undefined) fail(kp, 'a key moves the obstacle (x, y) or shows or hides it (show)');
    return {
      frame, over: integer(key.over ?? 0, `${kp}.over`, 0, 256), ...(key.x !== undefined && { x: integer(key.x, `${kp}.x`, -rows[0].length, width) }),
      ...(key.y !== undefined && { y: integer(key.y, `${kp}.y`, -rows.length, height) }), ...(key.show !== undefined && { show: boolean(key.show, `${kp}.show`) })
    };
  });
  // Where the obstacle is along each axis, before rounding to whole pixels, and the frames it jumps on (a key with no
  // `over` that moves it).
  const along = name => {
    const raw = Array(frames).fill(home[name]), jumps = Array(frames).fill(false);
    for (const key of keys) {
      if (key[name] === undefined) continue;
      const from = raw[key.frame];
      if (!key.over && key[name] !== from) jumps[key.frame] = true;
      for (let f = key.frame; f < frames; f++) raw[f] = key.over && f < key.frame + key.over ? from + (key[name] - from) * (f - key.frame) / key.over : key[name];
    }
    return { raw, jumps };
  };
  const ax = along('x'), ay = along('y'), shows = Array(frames).fill(true);
  for (const key of keys) if (key.show !== undefined) for (let f = key.frame; f < frames; f++) shows[f] = key.show;
  return ax.raw.map((rx, f) => {
    const jump = ax.jumps[f] || ay.jumps[f] || (f > 0 && shows[f] !== shows[f - 1]), still = !f || jump;
    // `dx`, `dy`: how far the whole-pixel place is ahead of where the obstacle really is on this frame.
    const x = Math.floor(rx + 0.5), y = Math.floor(ay.raw[f] + 0.5);
    return { x, y, show: shows[f], jump, vx: still ? 0 : rx - ax.raw[f - 1], vy: still ? 0 : ay.raw[f] - ay.raw[f - 1], dx: x - rx, dy: y - ay.raw[f] };
  });
}
// The part of an obstacle's symbol at (x, y) that lies on the canvas, as a rectangle of the symbol (sx, sy, w, h), or
// null when none of it does.
export function onCanvas(rows, x, y, width, height) {
  const sx = Math.max(0, -x), sy = Math.max(0, -y), w = Math.min(rows[0].length, width - x) - sx, h = Math.min(rows.length, height - y) - sy;
  return w > 0 && h > 0 ? { sx, sy, w, h } : null;
}
// Whether any visible pixel of the symbol at (x, y) lies on the canvas.
function showsOnCanvas(rows, x, y, width, height) {
  const part = onCanvas(rows, x, y, width, height);
  return !!part && rows.slice(part.sy, part.sy + part.h).some(row => /[^. ]/.test(row.slice(part.sx, part.sx + part.w)));
}
// Where every obstacle is on frame `cycle` of the effect's cycle.
export const placementsAt = (obstacles, cycle) => obstacles.map(o => o.live ?? (o.track ? o.track[cycle] : { x: o.x, y: o.y, show: true }));
// A body's cells change as it turns, so its shape is part of the key.
export const layoutKey = places => places.map(p => (p.show ? `${p.x},${p.y}${p.shape ?? ''}` : '-')).join(';');
// A body as an obstacle of the liquid (docs/physics-model.md, section 13): the cells it draws, as a symbol at its place,
// moving at its velocity. `cx`, `cy` is its centre, which liquid it lands on while only turning is shoved straight out from.
// A body's turning is given to a liquid (a paddle stirs water) but not to sand: dragged round with it, sand turned at the
// body's own rate, nothing damped the turning, and a crate rolled down a heap.
// `mass` is a free, awake body's inverse mass and inertia, for a liquid's pressure solve to move it (see couplingOf).
export function bodyPlace(cells, b, turns) {
  if (!cells.length) return { rows: ['.'], live: { x: 0, y: 0, show: false, jump: false, vx: 0, vy: 0, w: 0, dx: 0, dy: 0, shape: '', cx: b.x, cy: b.y, mass: null } };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of cells) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const grid = Array.from({ length: y1 - y0 + 1 }, () => Array(x1 - x0 + 1).fill('.'));
  for (const [x, y] of cells) grid[y - y0][x - x0] = 'x';
  const rows = grid.map(row => row.join(''));
  const moves = b.fixed || !b.asleep, mass = !b.fixed && !b.asleep && turns && b.invMass > 0 ? { im: b.invMass, ii: b.invInertia } : null;
  return { rows, live: { x: x0, y: y0, show: true, jump: false, vx: moves ? b.vx : 0, vy: moves ? b.vy : 0, w: moves && turns ? b.w : 0, dx: 0, dy: 0, shape: rows.join('/'), cx: b.x, cy: b.y, mass } };
}
// The obstacles at these places as cell masks: what is solid, what is drawn over the fluid, which solid cells are smooth,
// and which obstacle (the first listed) covers each cell. Decorations are only drawn. What hangs off the canvas is left out.
export function buildLayout(obstacles, width, height, places) {
  const N = width * height, solid = new Uint8Array(N), front = new Uint8Array(N), rounded = new Uint8Array(N), stepped = new Uint8Array(N), owner = new Int16Array(N).fill(-1);
  obstacles.forEach((o, i) => {
    const at = places[i];
    if (!at.show) return;
    o.rows.forEach((row, j) => {
      if (at.y + j < 0 || at.y + j >= height) return;
      for (let k = Math.max(0, -at.x); k < Math.min(row.length, width - at.x); k++) if (row[k] !== '.' && row[k] !== ' ') {
        const c = (at.y + j) * width + at.x + k;
        if (o.blocks) { solid[c] = 1; (o.smooth ? rounded : stepped)[c] = 1; if (owner[c] < 0) owner[c] = i; }
        if (o.draw === 'over') front[c] = 1;
      }
    });
  });
  let smooth = null;
  for (let c = 0; c < N; c++) if (rounded[c] && !stepped[c]) { smooth ??= new Uint8Array(N); smooth[c] = 1; }
  // The cells bodies fill: the look sees through them, so water under a body is as deep as the pool around it.
  let see = null;
  obstacles.forEach((o, i) => {
    if (o.body === undefined || !places[i].show) return;
    const at = places[i];
    o.rows.forEach((row, j) => { for (let k = 0; k < row.length; k++) if (row[k] !== '.') { const x = at.x + k, y = at.y + j; if (x >= 0 && y >= 0 && x < width && y < height) (see ??= new Uint8Array(N))[y * width + x] = 1; } });
  });
  return { key: layoutKey(places), places, solid, front, smooth, owner, see };
}

// ---- The solid layer -------------------------------------------------------------------------------------------------
// What every fluid feature asks of the solids, answered in one place (docs/physics-model.md, section 6): which cells are
// solid, who owns each one, how fast each solid cell moves, and what each solid does to the fluid touching it. An owner
// is an obstacle's index, ICE (frozen liquid: a cell holding ICE_CELL ice particles or more) or, beyond the canvas, EDGE
// (a closed edge); NONE is open. Features read solids through it, never through obstacles, so whatever they do at a
// solid they do at every kind of solid: liquid clings to ice and closed edges with the effect's adhesion; closed edges
// stand still, and ice moves as it settles or floats.
// Surface properties: what a solid does to the fluid touching it, read for each obstacle here, into one object. One it
// leaves unset is null and takes the effect's value, as ice and closed edges always do. A new property (a hot plate's
// temperature, an electrode's voltage) is read here and looked up through the layer's `props`, leaving the features that
// read the others alone.
const SURFACE_FIELDS = ['adhesion', 'temperature'];
function readSurface(obstacle, op, { liquid, heat }, blocks) {
  // Its own adhesion, in place of the effect's, for liquid touching it: a sticky spoon beside a non-stick pan.
  if (obstacle.adhesion !== undefined && !liquid) fail(`${op}.adhesion`, 'adhesion holds a liquid to what it touches; it applies to liquids');
  // A hot plate or a cold window: it keeps its temperature and warms or chills what touches it (a gas's air, a liquid's
  // water and ice and the air over them).
  if (obstacle.temperature !== undefined && liquid && !heat) fail(`${op}.temperature`, 'a hot or cold obstacle warms or chills a liquid that has heat; give the liquid heat');
  for (const key of SURFACE_FIELDS) if (obstacle[key] !== undefined && !blocks) fail(`${op}.${key}`, 'the fluid never meets a decoration (solid: false), so it has no surface');
  return { adhesion: obstacle.adhesion === undefined ? null : number(obstacle.adhesion, `${op}.adhesion`, 0, 4), temperature: obstacle.temperature === undefined ? null : number(obstacle.temperature, `${op}.temperature`, -16, 16) };
}
// The solid layer of a W × H layout with the obstacles at `places` on one frame. `solid` and `owner` are per cell, and
// `ownerAt(x, y)` answers beyond the canvas too. `velocity(c)` is a solid cell's [vx, vy] in pixels per frame, or null
// where it stands still (a still obstacle, one that jumped this frame, resting ice); `speed` holds each obstacle's.
// `ahead(c)` is how far a moving cell's whole-pixel place is ahead of where it really is, [dx, dy]. `props(owner)` is an
// owner's surface properties, or null (the effect's, for ice and closed edges). Ice that settles or floats is a moving
// solid too: `ice`, when given, is { moving, velocity(c) } for the ICE cells, whole cells with nothing ahead.
export function solidLayer(effect, layout, places, W, H, ice = null) {
  const { solid, owner } = layout, { walls, obstacles } = effect;
  const speed = obstacles.map((o, i) => { const at = places[i]; return o.blocks && at.show && (at.vx || at.vy || at.w) ? [at.vx, at.vy] : null; });
  const beyond = closed => (closed ? EDGE : NONE), still = [0, 0];
  // A turning body's cells move at its velocity plus its turning there (docs/physics-model.md, section 13).
  const turning = c => { const at = places[owner[c]], i = c % W, j = (c - i) / W; return [at.vx - at.w * (j + 0.5 - at.cy), at.vy + at.w * (i + 0.5 - at.cx)]; };
  return {
    W, H, N: W * H, solid, owner, speed, moving: speed.some(Boolean) || !!ice?.moving,
    ownerAt: (x, y) => (x < 0 ? beyond(walls.left) : x >= W ? beyond(walls.right) : y < 0 ? beyond(walls.top) : y >= H ? beyond(walls.bottom) : owner[y * W + x]),
    velocity: c => (owner[c] >= 0 ? (speed[owner[c]] && places[owner[c]].w ? turning(c) : speed[owner[c]]) : owner[c] === ICE && ice ? ice.velocity(c) : null),
    ahead: c => { if (owner[c] < 0) return still; const at = places[owner[c]]; return [at.dx, at.dy]; },
    props: o => (o >= 0 ? obstacles[o].props : null)
  };
}

// Keys change a liquid over time: from a key's frame on it takes the key's yield, viscosity, adhesion, gravity or drag,
// moving there in a straight line over `over` frames (0: at once). Each setting starts from the effect's own value and
// follows the keys that name it, in order. Returns each frame's settings; a loop follows them every cycle.
const KEYED = ['yield', 'viscosity', 'adhesion', 'gravity', 'drag'];
function readKeys(value, path, frames, base) {
  if (!Array.isArray(value) || !value.length || value.length > 16) fail(path, 'expected 1–16 keys, each { frame, over, and any of yield, viscosity, adhesion, gravity, drag }');
  let last = -1;
  const keys = value.map((key, i) => {
    const kp = `${path}[${i}]`;
    fields(key, ['frame', 'over', ...KEYED], kp);
    const frame = integer(key.frame, `${kp}.frame`, 0, frames - 1);
    if (frame < last) fail(`${kp}.frame`, 'keys go in frame order');
    last = frame;
    if (!KEYED.some(name => key[name] !== undefined)) fail(kp, `a key changes at least one of ${KEYED.join(', ')}`);
    return {
      frame, over: integer(key.over ?? 0, `${kp}.over`, 0, 256),
      ...(key.yield !== undefined && { yield: number(key.yield, `${kp}.yield`, 0, 16) }), ...(key.viscosity !== undefined && { viscosity: number(key.viscosity, `${kp}.viscosity`, 0, MAX_VISCOSITY) }),
      ...(key.adhesion !== undefined && { adhesion: number(key.adhesion, `${kp}.adhesion`, 0, 4) }), ...(key.gravity !== undefined && { gravity: pair(key.gravity, `${kp}.gravity`, -2, 2) }),
      ...(key.drag !== undefined && { drag: number(key.drag, `${kp}.drag`, 0, 1) })
    };
  });
  const blend = (from, to, t) => (Array.isArray(from) ? [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t] : from + (to - from) * t);
  const schedule = Array.from({ length: frames }, () => ({}));
  for (const name of KEYED) {
    // Each key rewrites its setting from its frame on, starting from the value it finds there, so a key that starts
    // during another's ramp carries on from where that ramp had got to.
    const values = Array(frames).fill(base[name]);
    for (const key of keys) {
      if (key[name] === undefined) continue;
      const from = values[key.frame];
      for (let f = key.frame; f < frames; f++) values[f] = key.over && f < key.frame + key.over ? blend(from, key[name], (f - key.frame) / key.over) : key[name];
    }
    values.forEach((value, f) => { schedule[f][name] = value; });
  }
  return schedule;
}

// Heat for a liquid's phase changes, on the gas temperature scale (docs/physics-model.md, section 3): 0 is the room's air,
// water freezes at −0.5 and boils at 0.5, and steam beads below 0.4. See the phase section below for each setting.
function readHeat(value, path, vapour) {
  fields(value, ['ambient', 'air', 'conduct', 'contact', 'freeze', 'boil', 'latent', 'vaporize', 'evaporation', 'sublimate', 'dew', 'condense', 'frost', 'deposit', 'branch', 'grain'], path);
  const freeze = number(value.freeze ?? -0.5, `${path}.freeze`, -8, 8), boil = number(value.boil ?? 0.5, `${path}.boil`, -8, 16);
  if (boil <= freeze) fail(`${path}.boil`, 'the boiling point must lie above the freezing point');
  for (const key of ['evaporation', 'sublimate', 'dew', 'frost', 'branch']) if (value[key] !== undefined && !vapour) fail(`${path}.${key}`, `${key} turns water or ice into vapour or back; give the effect a vapour`);
  if (value.condense !== undefined && !vapour) fail(`${path}.condense`, 'condense is how fast vapour beads up as dew on what is colder than dew; give the effect a vapour');
  for (const [key, what] of [['deposit', 'how fast vapour grows into frost'], ['branch', 'how often a frost finger forks']]) if (value[key] !== undefined && value.frost === undefined) fail(`${path}.${key}`, `${key} is ${what}; set frost (at or below freeze) for vapour to frost over what is colder`);
  const frost = value.frost === undefined ? null : number(value.frost, `${path}.frost`, -16, 16), dew = number(value.dew ?? boil - 0.1, `${path}.dew`, -16, 16);
  if (dew > boil) fail(`${path}.dew`, 'vapour condenses below the boiling point; keep dew at or under boil');
  if (frost !== null && frost > freeze) fail(`${path}.frost`, 'vapour turns straight to ice below the freezing point; keep frost at or under freeze');
  return {
    ambient: number(value.ambient ?? 0, `${path}.ambient`, -16, 16), air: number(value.air ?? 0.04, `${path}.air`, 0, 0.2),
    conduct: number(value.conduct ?? 0.12, `${path}.conduct`, 0, 0.2), contact: number(value.contact ?? 0.15, `${path}.contact`, 0, 0.2), freeze, boil,
    latent: number(value.latent ?? 0.5, `${path}.latent`, 0.02, 8), vaporize: number(value.vaporize ?? 1, `${path}.vaporize`, 0.02, 16),
    evaporation: number(value.evaporation ?? 0, `${path}.evaporation`, 0, 1), sublimate: value.sublimate === undefined ? false : boolean(value.sublimate, `${path}.sublimate`),
    dew: vapour ? dew : null, condense: number(value.condense ?? 0.2, `${path}.condense`, 0, 1),
    frost, deposit: number(value.deposit ?? 0.1, `${path}.deposit`, 0, 1), branch: number(value.branch ?? 0.5, `${path}.branch`, 0, 1), grain: number(value.grain ?? 0, `${path}.grain`, 0, 1)
  };
}
// Vapour: a gas on the same grid that moves through the cells holding neither liquid nor ice. `bubbles` are the bubbles a
// boil makes inside the water: bubble sparks (see readSparks) that carry their vapour up and let it out at the surface.
function readVapour(value, path, context) {
  fields(value, ['expansion', 'buoyancy', 'weight', 'vorticity', 'dissipation', 'cooling', 'drag', 'spread', 'iterations', 'bubbles', 'look'], path);
  const look = value.look === undefined ? [] : Array.isArray(value.look) && value.look.length <= LIMITS.looks ? value.look.map((layer, i) => readLook(layer, `${path}.look[${i}]`, { ...context, liquid: false })) : fail(`${path}.look`, `expected 0–${LIMITS.looks} layers`);
  let bubbles = null;
  if (value.bubbles !== undefined) {
    fields(value.bubbles, ['colors', 'size', 'life', 'rise', 'wobble', 'lift', 'pop', 'follow', 'drag'], `${path}.bubbles`);
    bubbles = readSparks({ count: 1, life: 256, rise: 0.8, ...value.bubbles }, `${path}.bubbles`, context, false);
  }
  return {
    expansion: number(value.expansion ?? 8, `${path}.expansion`, 1, 64), buoyancy: number(value.buoyancy ?? 0.2, `${path}.buoyancy`, -2, 2), weight: number(value.weight ?? 0, `${path}.weight`, -2, 2),
    vorticity: number(value.vorticity ?? 0.2, `${path}.vorticity`, 0, 2), dissipation: number(value.dissipation ?? 0, `${path}.dissipation`, 0, 1), cooling: number(value.cooling ?? 0.05, `${path}.cooling`, 0, 1),
    drag: number(value.drag ?? 0.02, `${path}.drag`, 0, 1), spread: number(value.spread ?? 0, `${path}.spread`, 0, 0.25), iterations: integer(value.iterations ?? 20, `${path}.iterations`, 1, 200),
    bubbles, look, viscosity: 0, sharp: false
  };
}

export function readEffect(effect, path, source) {
  const { width, height, palette, symbols } = source;
  fields(effect, ['kind', 'frames', 'duration', 'loop', 'seed', 'warmup', 'blend', 'substeps', 'iterations', 'buoyancy', 'weight', 'vorticity', 'dissipation', 'cooling', 'drag', 'wind', 'advection', 'viscosity', 'yield', 'slip', 'gravity', 'flip', 'apic', 'tension', 'adhesion', 'fill', 'walls', 'obstacles', 'emitters', 'look', 'whitewater', 'air', 'light', 'outline', 'cleanup', 'keys', 'electric', 'heat', 'vapour', 'ice', 'granular', 'bodies', 'shine'], path);
  const kind = effect.kind ?? 'gas';
  if (!FLUID_KINDS.includes(kind)) fail(`${path}.kind`, 'expected gas (smoke, fire, steam, magic) or liquid (water, potions)');
  const liquid = kind === 'liquid';
  for (const key of ['heat', 'vapour', 'ice']) if (effect[key] !== undefined && !liquid) fail(`${path}.${key}`, `${key} gives a liquid phase changes; a gas already has a temperature`);
  if ((effect.vapour !== undefined || effect.ice !== undefined) && effect.heat === undefined) fail(`${path}.heat`, 'vapour and ice come from phase changes; give the liquid heat');
  const heat = effect.heat === undefined ? null : readHeat(effect.heat, `${path}.heat`, effect.vapour !== undefined);
  if (liquid && effect.advection !== undefined) fail(`${path}.advection`, 'advection applies to gases; a liquid\'s particles carry it');
  // A gas has no gravity of its own (hot gas rises along up); with bodies, `gravity` pulls them.
  for (const key of liquid ? ['buoyancy', 'weight', 'vorticity', 'dissipation', 'cooling', 'wind'] : [...(effect.bodies === undefined ? ['gravity'] : []), 'flip', 'apic', 'tension', 'adhesion', 'yield', 'fill', 'keys', 'air', 'granular']) {
    if (effect[key] !== undefined) fail(`${path}.${key}`, liquid ? `${key} applies to gases; liquids fall by gravity and keep their volume` : `${key} applies to liquids; gases rise by buoyancy`);
  }
  // Grains (sand): friction in place of elasticity, with no heat or air of their own (docs/physics-model.md, 10a).
  const granular = liquid && effect.granular !== undefined ? readGranular(effect.granular, `${path}.granular`) : null;
  if (granular) for (const [key, why] of [['yield', 'grains hold their shape by friction (granular.repose, granular.cohesion), not by a yield stress, which would make them spring back like slime'], ['heat', 'grains neither freeze nor boil on the water scale; heat applies to a liquid that is not granular'], ['air', 'air passes through sand, so grains keep no air pockets']]) {
    if (effect[key] !== undefined) fail(`${path}.${key}`, why);
  }
  const advection = effect.advection ?? 'smooth';
  if (!ADVECTION.includes(advection)) fail(`${path}.advection`, 'expected smooth (plain semi-Lagrangian, the default) or sharp (MacCormack with a limiter: crisper edges and swirls)');
  const viscosity = number(effect.viscosity ?? 0, `${path}.viscosity`, 0, MAX_VISCOSITY), yieldStress = liquid ? number(effect.yield ?? 0, `${path}.yield`, 0, 16) : 0;
  if (!liquid && effect.whitewater !== undefined) fail(`${path}.whitewater`, 'whitewater is spray and foam thrown off a liquid; it applies to liquids');
  // Over a liquid an arc runs through the air (the vapour's gas) and the water, and heats both, so it needs heat and vapour.
  const unwired = liquid && !(effect.heat !== undefined && effect.vapour !== undefined), WETS = 'an arc over a liquid runs through the air over it (the vapour gas) and boils the water it strikes; give the liquid heat and vapour';
  if (unwired && effect.electric !== undefined) fail(`${path}.electric`, WETS);
  const frames = integer(effect.frames, `${path}.frames`, 1, 256), loop = effect.loop === undefined ? false : boolean(effect.loop, `${path}.loop`);
  const durations = Array.isArray(effect.duration)
    ? (effect.duration.length === frames ? effect.duration.map((d, i) => integer(d, `${path}.duration[${i}]`, 1, 60000)) : fail(`${path}.duration`, `expected one duration or ${frames}`))
    : Array(frames).fill(integer(effect.duration ?? 80, `${path}.duration`, 1, 60000));
  if (!loop) for (const key of ['warmup', 'blend']) if (effect[key] !== undefined) fail(`${path}.${key}`, `${key} shapes the seam of a looping effect; set loop: true`);
  if (loop && frames < 4) fail(`${path}.frames`, 'a looping effect needs at least 4 frames');
  const seed = integer(effect.seed ?? 1, `${path}.seed`, 0, 2147483647);
  const context = { frames, loop, liquid, palette, seed, electric: false, heat };
  let iceLook = null;
  if (effect.ice !== undefined) {
    fields(effect.ice, ['look'], `${path}.ice`);
    if (!Array.isArray(effect.ice.look) || !effect.ice.look.length || effect.ice.look.length > LIMITS.looks) fail(`${path}.ice.look`, `expected 1–${LIMITS.looks} layers that map the ice's fields to palette colours`);
    // Plasma never enters ice: it burns in the air over the liquid.
    effect.ice.look.forEach((layer, i) => { if (isObject(layer) && (layer.field === 'ionization' || layer.field === 'current')) fail(`${path}.ice.look[${i}].field`, `plasma never enters ice; it burns in the air over the liquid, so draw ${layer.field} in the vapour's look`); });
    iceLook = effect.ice.look.map((layer, i) => readLook(layer, `${path}.ice.look[${i}]`, { ...context, liquid: false }));
  }
  const obstacles = [];
  const listed = (value, key, max) => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > max) fail(`${path}.${key}`, `expected a list of at most ${max} entries`);
    return value;
  };
  listed(effect.obstacles, 'obstacles', LIMITS.obstacles).forEach((obstacle, i) => {
    const op = `${path}.obstacles[${i}]`;
    fields(obstacle, ['symbol', 'x', 'y', 'draw', 'surface', 'solid', 'keys', ...SURFACE_FIELDS, ...ELECTRODE_FIELDS], op);
    if (typeof obstacle.symbol !== 'string' || !Object.hasOwn(symbols, obstacle.symbol)) fail(`${op}.symbol`, `unknown symbol ${JSON.stringify(obstacle.symbol)}`);
    // It may hang off any edge by up to its own size; what hangs off is clipped.
    const rows = symbols[obstacle.symbol], x = integer(obstacle.x ?? 0, `${op}.x`, -rows[0].length, width), y = integer(obstacle.y ?? 0, `${op}.y`, -rows.length, height);
    const draw = obstacle.draw ?? 'over';
    if (!['over', 'under', 'none'].includes(draw)) fail(`${op}.draw`, 'expected over (drawn in front of the fluid), under or none (an invisible wall)');
    const surface = obstacle.surface ?? 'pixels';
    if (!OBSTACLE_SURFACES.includes(surface)) fail(`${op}.surface`, 'expected pixels (the default: the fluid meets every pixel step) or smooth (the fluid meets a smooth outline through the steps, so it slides down a drawn slope)');
    // A decoration (solid: false) is drawn like an obstacle, but the fluid never meets it: a net, a flame, a label.
    const blocks = obstacle.solid === undefined ? true : boolean(obstacle.solid, `${op}.solid`);
    if (!blocks && draw === 'none' && obstacle.voltage === undefined) fail(`${op}.draw`, 'a decoration (solid: false) is only drawn; draw it over or under the fluid, or give it a voltage (an unseen charge)');
    if (!blocks && surface === 'smooth') fail(`${op}.surface`, 'surface shapes how the fluid meets an obstacle; the fluid never meets a decoration (solid: false)');
    const track = obstacle.keys === undefined ? null : readTrack(obstacle.keys, `${op}.keys`, frames, { x, y }, rows, width, height);
    // An electrode or metal (electric.js): solid, or for an electrode a decoration the gas flows through.
    const electric = readElectrode(obstacle, op, frames);
    if (electric && unwired) fail(`${op}.${electric.conductor ? 'conductor' : 'voltage'}`, WETS);
    obstacles.push({ symbol: obstacle.symbol, x, y, draw, blocks, smooth: surface === 'smooth', rows, track, props: { ...readSurface(obstacle, op, context, blocks), voltage: electric ? electric.voltage : null, conductor: electric ? electric.conductor : null }, ...(electric && { electric }) });
  });
  // Bodies (bodies.js) in the liquid: each is a moving solid in the solid layer, an obstacle of its own after those
  // listed, placed each frame where the bodies' solver put it (docs/physics-model.md, section 13).
  let bodies = null;
  const bodyWarnings = [];
  if (effect.bodies !== undefined) {
    const list = readBodies(effect.bodies, `${path}.bodies`, { palette, symbols, heat: !!heat || !liquid }), first = obstacles.length;
    const statics = obstacles.map(o => ({ rows: o.rows, x: o.x, y: o.y, solid: o.blocks, track: o.track, bounce: 0, friction: 0.5 }));
    list.forEach((b, k) => obstacles.push({ symbol: null, x: 0, y: 0, draw: 'none', blocks: true, smooth: false, track: null, body: k, props: { adhesion: null, temperature: b.temperature, voltage: null, conductor: null }, ...bodyPlace(startCells(b), b, !granular) }));
    // A fixed body that turns other than a whole number of its own symmetric turns a cycle shows where the loop repeats.
    if (loop) list.forEach((b, k) => {
      const turn = b.shape === 'circle' ? 0 : b.shape === 'box' ? (b.size[0] === b.size[1] ? 90 : 180) : b.shape === 'hoop' && !b.parts.hoop.gap ? 360 / b.parts.hoop.sides : 360;
      const turned = Math.abs(b.spin * frames), left = turn ? turned % turn : 0;
      if (b.fixed && turn && left > 1e-6 && turn - left > 1e-6) bodyWarnings.push(`${b.path} turns ${Number(turned.toFixed(3))} degrees a cycle, not a whole number of ${turn}-degree turns, so it jumps where the loop repeats: set its spin to a multiple of ${Number((turn / frames).toFixed(4))}`);
    });
    bodies = { list, first, statics, symbols };
  }
  // Electricity: settings of its own, defaults when only an obstacle has a voltage or conducts. Over a liquid its plasma
  // burns in the vapour's gas, which the vapour's look draws.
  const electric = effect.electric === undefined && !obstacles.some(o => o.electric) ? null : readElectric(effect.electric ?? {}, `${path}.electric`, obstacles, liquid);
  context.electric = !!electric;
  const vapour = effect.vapour === undefined ? null : readVapour(effect.vapour, `${path}.vapour`, context);
  const moving = obstacles.some(o => o.track) || !!bodies, layout = buildLayout(obstacles, width, height, placementsAt(obstacles, 0));
  const { solid, front, smooth, owner } = layout;
  const walls = listed(effect.walls, 'walls', 4).map((edge, i) => {
    if (!FLUID_WALLS.includes(edge)) fail(`${path}.walls[${i}]`, `expected ${FLUID_WALLS.join(', ')}`);
    return edge;
  });
  if (new Set(walls).size !== walls.length) fail(`${path}.walls`, 'each edge is listed once');
  const fills = listed(effect.fill, 'fill', LIMITS.fills).map((entry, i) => {
    const fp = `${path}.fill[${i}]`;
    fields(entry, ['x', 'y', 'w', 'h', 'at', 'radius', 'velocity', 'burst', 'temperature', 'frozen', 'vapour'], fp);
    for (const key of ['temperature', 'frozen']) if (entry[key] !== undefined && !heat) fail(`${fp}.${key}`, `${key} applies to a liquid with heat (phase changes)`);
    if (entry.vapour !== undefined && !vapour) fail(`${fp}.vapour`, 'a vapour fill needs the effect\'s vapour');
    if (entry.vapour !== undefined && (entry.frozen !== undefined || entry.burst !== undefined || entry.velocity !== undefined)) fail(`${fp}.vapour`, 'a vapour fill holds still vapour; it is neither frozen nor thrown');
    const phase = heat ? { temperature: entry.temperature === undefined ? null : number(entry.temperature, `${fp}.temperature`, -16, 16), frozen: entry.frozen === undefined ? false : boolean(entry.frozen, `${fp}.frozen`), vapour: entry.vapour === undefined ? 0 : number(entry.vapour, `${fp}.vapour`, 0.01, 4) } : null;
    let burst = null;
    if (entry.burst !== undefined) {
      fields(entry.burst, ['speed', 'pieces'], `${fp}.burst`);
      if (entry.burst.speed === undefined) fail(`${fp}.burst.speed`, 'expected how fast the pieces fly apart, in pixels per frame: a number or [min, max]');
      burst = { speed: range(entry.burst.speed, `${fp}.burst.speed`, 0, 16), pieces: integer(entry.burst.pieces ?? 8, `${fp}.burst.pieces`, 2, 64) };
    }
    return { inside: readShape(entry, fp, width, height), velocity: entry.velocity === undefined ? [0, 0] : pair(entry.velocity, `${fp}.velocity`, -16, 16), burst, ...(phase && { phase }) };
  });
  // A gas with electrodes needs no emitter: its arcs are its source.
  const listedEmitters = effect.emitters ?? (electric ? [] : undefined);
  if (!Array.isArray(listedEmitters) || listedEmitters.length > LIMITS.emitters || (!listedEmitters.length && !fills.length && !electric)) fail(`${path}.emitters`, `expected 1–${LIMITS.emitters} emitters${liquid ? ' (or none, with a fill)' : ' (or none, with electrodes)'}`);
  const followable = obstacles.slice(0, Array.isArray(effect.obstacles) ? effect.obstacles.length : 0);
  const emitters = listedEmitters.map((emitter, i) => readEmitter(emitter, `${path}.emitters[${i}]`, context, followable));
  if (!Array.isArray(effect.look) || !effect.look.length || effect.look.length > LIMITS.looks) fail(`${path}.look`, `expected 1–${LIMITS.looks} layers that map a field to palette colours`);
  const look = effect.look.map((layer, i) => readLook(layer, `${path}.look[${i}]`, context));
  const shine = effect.shine === undefined ? null : readShine(effect.shine, `${path}.shine`, context, look);
  const gravity = effect.gravity === undefined ? [0, 0.3] : pair(effect.gravity, `${path}.gravity`, -2, 2);
  const adhesion = liquid ? number(effect.adhesion ?? 0, `${path}.adhesion`, 0, 4) : 0;
  const drag = number(effect.drag ?? (liquid ? 0 : 0.02), `${path}.drag`, 0, 1);
  const schedule = effect.keys === undefined ? null : readKeys(effect.keys, `${path}.keys`, frames, { yield: yieldStress, viscosity, adhesion, gravity, drag });
  const most = { yield: yieldStress, viscosity, adhesion };
  if (schedule) for (const now of schedule) for (const key of Object.keys(most)) if (now[key] > most[key]) most[key] = now[key];
  if (granular && most.yield) fail(`${path}.keys`, 'grains hold their shape by friction, not by a yield stress; key no yield on a granular liquid');
  for (const o of obstacles) if (o.props.adhesion > most.adhesion) most.adhesion = o.props.adhesion;
  if (effect.slip !== undefined && !most.viscosity && !most.yield) fail(`${path}.slip`, `slip lets a thick fluid slide along walls and obstacles instead of being held by them; set viscosity${liquid ? ' or yield' : ''}`);
  const whitewater = listed(effect.whitewater, 'whitewater', LIMITS.whitewater).map((layer, i) => readWhitewater(layer, `${path}.whitewater[${i}]`, context, gravity));
  let cleanup = { strays: false, corners: false };
  if (effect.cleanup !== undefined) {
    fields(effect.cleanup, ['strays', 'corners'], `${path}.cleanup`);
    cleanup = { strays: effect.cleanup.strays === undefined ? false : boolean(effect.cleanup.strays, `${path}.cleanup.strays`), corners: effect.cleanup.corners === undefined ? false : boolean(effect.cleanup.corners, `${path}.cleanup.corners`) };
  }
  const light = effect.light === undefined ? [-1, -1] : pair(effect.light, `${path}.light`, -1, 1), reachLight = Math.sqrt(light[0] * light[0] + light[1] * light[1]);
  if (!reachLight) fail(`${path}.light`, 'expected a direction toward the light, such as [-1, -1] for the upper left');
  const pull = schedule ? (schedule.find(now => now.gravity[0] || now.gravity[1])?.gravity ?? gravity) : gravity;
  const layouts = new Map(), layoutAt = moving ? cycle => { const places = placementsAt(obstacles, cycle), key = layoutKey(places); if (!layouts.has(key)) layouts.set(key, buildLayout(obstacles, width, height, places)); return layouts.get(key); } : null;
  const warnings = [...bodyWarnings, ...sourceWarnings({ path, width, height, frames, liquid, seed, emitters, fills, gravity: pull, solid, smooth, owner, walls: Object.fromEntries(FLUID_WALLS.map(edge => [edge, walls.includes(edge)])), layoutAt, adhesive: most.adhesion > 0 })];
  // An obstacle that shows but has no visible pixel on the canvas whenever it does blocks and draws nothing.
  obstacles.forEach((o, i) => {
    if (o.body !== undefined) return;
    const shown = (o.track ?? [{ x: o.x, y: o.y, show: true }]).filter(at => at.show);
    if (shown.length && !shown.some(at => showsOnCanvas(o.rows, at.x, at.y, width, height))) warnings.push(`${path}.obstacles[${i}] has no visible pixel on the canvas whenever it shows, so it ${!o.blocks ? 'draws' : o.draw === 'none' ? 'blocks' : 'blocks and draws'} nothing: move its x and y (or its keys) onto the ${width} × ${height} canvas`);
  });
  // Heat moves by temperature, which holds at the boil, so water that boils under the surface stays there: only bubbles
  // carry it up. Without them or evaporation, water heated from below by an obstacle hotter than the boil never steams.
  if (vapour && !vapour.bubbles && !heat.evaporation) obstacles.forEach((o, i) => {
    if (o.props.temperature !== null && o.props.temperature > heat.boil) warnings.push(`${path}.obstacles[${i}] is hotter than heat.boil, but water turns to vapour only at its surface: water it heats under the surface waits at the boil, so a pool heated from below never steams; give vapour.bubbles (bubbles carry the boil up and let it out) or heat.evaporation`);
  });
  return {
    warnings,
    kind, liquid, frames, durations, light: [light[0] / reachLight, light[1] / reachLight], loop, seed, emitters, look, whitewater, obstacles, moving, layout, solid, front, smooth, see: layout.see, walls: Object.fromEntries(FLUID_WALLS.map(edge => [edge, walls.includes(edge)])), fills, cleanup,
    warmup: loop ? integer(effect.warmup ?? 2, `${path}.warmup`, 1, 8) : 0,
    blend: loop ? integer(effect.blend ?? Math.max(1, Math.min(8, Math.floor(frames / 3))), `${path}.blend`, 1, Math.floor(frames / 2)) : 0,
    substeps: integer(effect.substeps ?? 2, `${path}.substeps`, 1, 16), iterations: integer(effect.iterations ?? (liquid ? 40 : 30), `${path}.iterations`, 1, 200),
    buoyancy: number(effect.buoyancy ?? 0.15, `${path}.buoyancy`, -2, 2), weight: number(effect.weight ?? 0, `${path}.weight`, -2, 2),
    vorticity: number(effect.vorticity ?? 0.25, `${path}.vorticity`, 0, 2), dissipation: number(effect.dissipation ?? 0.03, `${path}.dissipation`, 0, 1),
    cooling: number(effect.cooling ?? 0.08, `${path}.cooling`, 0, 1), drag,
    wind: effect.wind === undefined ? [0, 0] : pair(effect.wind, `${path}.wind`, -2, 2), gravity, sharp: advection === 'sharp',
    viscosity, yield: yieldStress, slip: effect.slip === undefined ? false : boolean(effect.slip, `${path}.slip`),
    flip: number(effect.flip ?? 0.9, `${path}.flip`, 0, 1), apic: effect.apic === undefined ? false : boolean(effect.apic, `${path}.apic`),
    tension: number(effect.tension ?? (granular ? 0 : 0.5), `${path}.tension`, 0, 4), adhesion, schedule, most, electric, granular,
    outline: effect.outline === undefined ? 0 : paletteKey(effect.outline, `${path}.outline`, palette).charCodeAt(0),
    air: liquid && effect.air !== undefined ? readAir(effect.air, `${path}.air`, context) : null,
    heat, vapour, iceLook, warm: !liquid && obstacles.some(o => o.props.temperature !== null), bodies, shine
  };
}
// Grains (see grainFriction): `repose` is the steepest slope, in degrees, a heap of them holds, at any height, and
// `cohesion` makes them damp: they hold as dry grains do that many pixels down, so they stand steeper and keep small
// overhangs. The solver's friction is tan(repose) ÷ GRAIN_FRICTION, so a slope stands at `repose` (measured by tilting a
// settled bed's gravity: 15 to 45 degrees hold to within two). Past about 47 degrees it passes 1 and a dry column no
// longer falls at all, so steeper sand is damp sand: `cohesion`.
const GRAIN_FRICTION = 1.07;
function readGranular(value, path) {
  if (!isObject(value)) fail(path, 'expected { repose, cohesion }: grains such as sand, holding a slope of up to repose degrees');
  fields(value, ['repose', 'cohesion'], path);
  const repose = number(value.repose ?? 33, `${path}.repose`, 5, 45), cohesion = number(value.cohesion ?? 0, `${path}.cohesion`, 0, 8);
  return { repose, cohesion, friction: sinDeg(repose) / (GRAIN_FRICTION * cosDeg(repose)) };
}
// Air pockets (see sealAir): `stiffness` is the head, in pixels of liquid, that squeezes a pocket to half its size, and
// `bubbles` how the air of a pocket that shrinks too small to show is drawn as it escapes: bubbles, as a whitewater bubble
// layer draws them. Without `bubbles` that air leaves unseen.
function readAir(value, path, context) {
  if (!isObject(value)) fail(path, 'expected { stiffness, bubbles }: air pockets that keep their air, squeezed to half their size under stiffness pixels of liquid');
  fields(value, ['stiffness', 'bubbles'], path);
  let bubbles = null;
  if (value.bubbles !== undefined) {
    const bp = `${path}.bubbles`, b = value.bubbles;
    if (!isObject(b)) fail(bp, 'expected { colors, life, rise, wobble, lift, pop }: how the air of a pocket too small to show rises as bubbles');
    fields(b, ['colors', 'life', 'rise', 'wobble', 'lift', 'pop'], bp);
    if (!Array.isArray(b.colors) || !b.colors.length || b.colors.length > LIMITS.colors) fail(`${bp}.colors`, `expected 1–${LIMITS.colors} palette keys, spread over each bubble's life`);
    bubbles = {
      colors: b.colors.map((key, i) => paletteKey(key, `${bp}.colors[${i}]`, context.palette)), life: range(b.life ?? [30, 60], `${bp}.life`, 1, 256, true),
      size: 1, trail: false, gravity: [0, 0], inherit: false, drag: 0.02, follow: 1, pop: b.pop === undefined ? false : boolean(b.pop, `${bp}.pop`),
      ...readBubble({ ...b, rise: b.rise ?? 0.5 }, bp)
    };
  }
  return { stiffness: number(value.stiffness ?? 40, `${path}.stiffness`, 2, 1000), bubbles };
}

// Setups that compile but make nothing, or look stuck, said in words: an emitter whose disc or box lies inside
// obstacles (or off the canvas) on every frame it works, and a liquid fill that starts against the underside of a pixel
// obstacle (or a closed edge above it), where the pressure holds it on, with open space below it to fall into. A fill
// that rests on something (along a quarter or more of its lowest cells), as water in a flask does, or on other water,
// needs no warning, whatever it touches; nor does one thrown away from what is above it, or bursting apart, nor any in a
// liquid with adhesion, which clings on purpose. Gravity is the first the effect has, its keys included.
function sourceWarnings({ path, width, height, frames, liquid, seed, emitters, fills, gravity, solid, smooth, owner, walls, layoutAt, adhesive }) {
  const warnings = [], W = width, H = height;
  const solidBase = solid, ownerBase = owner;
  emitters.forEach((e, index) => {
    if (!(e.density > 0 || (!liquid && (e.temperature > 0 || e.expand > 0)))) return;
    let open = false, buried = -1, seen = false;
    for (let cycle = 0; cycle < frames && !open; cycle++) {
      if (!active(e, cycle)) continue;
      // A rate emitter that orbits or follows an obstacle also works along the path between frames, as emitFrame lays it.
      const steps = e.burst || e.carry ? 1 : laidSteps(e, cycle);
      // Obstacles that move are where they are on that frame.
      const here = layoutAt ? layoutAt(cycle) : null, solid = here ? here.solid : solidBase, owner = here ? here.owner : ownerBase;
      for (let k = 1; k <= steps && !open; k++) {
        const { x, y } = emitterState(e, index, cycle, seed, cycle - 1 + k / steps), r = reach(e);
        for (let j = Math.max(0, Math.floor(y - r)); j <= Math.min(H - 1, Math.ceil(y + r)) && !open; j++) for (let i = Math.max(0, Math.floor(x - r)); i <= Math.min(W - 1, Math.ceil(x + r)); i++) {
          if (!coverage(e, i + 0.5 - x, j + 0.5 - y)) continue;
          seen = true;
          if (!solid[j * W + i]) { open = true; break; }
          if (buried < 0) buried = owner[j * W + i];
        }
      }
    }
    if (open) return;
    const what = liquid ? 'water' : 'gas', sparks = e.sparks ? ' (its sparks still show)' : '';
    if (seen) warnings.push(`${path}.emitters[${index}] lies inside obstacles[${buried}] whenever it emits, so it adds no ${what}${sparks}: move it just outside the obstacle's pixels`);
    else warnings.push(`${path}.emitters[${index}] lies outside the canvas whenever it emits, so it adds no ${what}${sparks}: move its at inside the ${W} × ${H} canvas`);
  });
  // A liquid with adhesion is meant to cling to what it starts against.
  if (!liquid || adhesive) return warnings;
  // "Above" is against gravity, along its stronger axis.
  const [gx, gy] = gravity, vertical = Math.abs(gy) >= Math.abs(gx), di = vertical ? 0 : gx > 0 ? -1 : 1, dj = vertical ? (gy > 0 ? -1 : 1) : 0;
  const edge = vertical ? (gy > 0 ? 'top' : 'bottom') : gx > 0 ? 'left' : 'right', pixel = c => solid[c] && !(smooth && smooth[c]);
  // Water from every fill, since a fill may rest on another's.
  const water = new Uint8Array(W * H);
  for (const fill of fills) for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (!solid[j * W + i] && fill.inside(i + 0.5, j + 0.5)) water[j * W + i] = 1;
  const wet = (i, j) => i >= 0 && j >= 0 && i < W && j < H && water[j * W + i];
  fills.forEach((fill, f) => {
    let under = 0, against = 0, which = -1, bottom = 0, resting = 0;
    if (!gx && !gy) return;
    // A fill thrown away from what is above it, or bursting apart, does not start stuck.
    if (fill.burst || -(fill.velocity[0] * di + fill.velocity[1] * dj) > 0.25) return;
    const filled = (i, j) => i >= 0 && j >= 0 && i < W && j < H && !solid[j * W + i] && fill.inside(i + 0.5, j + 0.5);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      if (!filled(i, j)) continue;
      // Its lowest cells (along gravity, under no water), and how many of them rest on an obstacle or a closed edge.
      const bi = i - di, bj = j - dj;
      if (!wet(bi, bj)) { bottom++; if (bi < 0 || bj < 0 || bi >= W || bj >= H ? walls[{ top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[edge]] : solid[bj * W + bi]) resting++; }
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) { if (walls[edge]) against++; continue; }
      if (pixel(nj * W + ni)) { under++; if (which < 0) which = owner[nj * W + ni]; }
    }
    if (4 * resting >= bottom) return;
    const fix = 'give that obstacle surface: "smooth" to let the liquid fall away (adhesion still holds it on), or move the fill a pixel away from it';
    if (under) warnings.push(`${path}.fill[${f}] starts against the underside of obstacles[${which}] along ${under} pixel${under === 1 ? '' : 's'}, where the pressure holds it on: ${fix}`);
    if (against) warnings.push(`${path}.fill[${f}] starts against the closed ${edge} edge along ${against} pixel${against === 1 ? '' : 's'}, where the pressure holds it on: move the fill a pixel away from the edge`);
  });
  return warnings;
}


// ---- Emitters ---------------------------------------------------------------------------------------------------------
// Seeded value noise on a lattice three cells apart, smoothstep-blended: coherent eddies instead of per-cell static.
export function valueNoise(seed, emitter, frame, salt, x, y) {
  const fx = x / 3, fy = y / 3, ix = Math.floor(fx), iy = Math.floor(fy), sx = smooth(fx - ix), sy = smooth(fy - iy);
  const at = (i, j) => random(seed, emitter, frame, salt, ix + i, iy + j);
  return (at(0, 0) * (1 - sx) + at(1, 0) * sx) * (1 - sy) + (at(0, 1) * (1 - sx) + at(1, 1) * sx) * sy;
}
// Where an emitter is this frame, and how strongly it emits: rate or burst, times its pulse. Flicker varies the
// strength from cell to cell and frame to frame (seeded value noise), so a flame's base breaks into tongues.
// `along` places an emitter that orbits or follows an obstacle between frames (it defaults to the frame itself); pulse
// and flicker keep the frame's.
// `factor` scales the strength, as a live runner's boost does.
export function emitterState(e, index, cycle, seed, along = cycle, factor = 1) {
  let [x, y] = e.at;
  if (e.orbit) { const angle = 360 * along / e.orbit.period + e.orbit.phase; x += e.orbit.radius[0] * cosDeg(angle); y += e.orbit.radius[1] * sinDeg(angle); }
  // Beside the obstacle it follows: where the obstacle is drawn on this frame, and on the way there from the frame before.
  if (e.follow && e.follow.path) {
    const now = e.follow.path[cycle], back = now.cut ? 0 : cycle - along, was = back ? e.follow.path[cycle - 1] : now;
    x += now.x + (was.x - now.x) * back; y += now.y + (was.y - now.y) * back;
  }
  let strength = e.strength * factor;
  if (e.pulse) strength *= 1 + e.pulse.amplitude * sinDeg(360 * cycle / e.pulse.period + e.pulse.phase);
  const flicker = (px, py) => (e.flicker ? strength * (1 + e.flicker * (2 * valueNoise(seed, index, cycle, SALT.flicker, px, py) - 1)) : strength);
  return { x, y, flicker };
}
export const active = (e, cycle) => {
  if (e.repeat) {
    if (!e.loop && cycle < e.start) return false;
    const offset = ((cycle - e.start) % e.repeat + e.repeat) % e.repeat;
    return e.burst ? offset === 0 : offset < e.end - e.start;
  }
  return e.burst ? cycle === e.start : cycle >= e.start && cycle < e.end;
};
// How many places, about a pixel apart, a moving rate emitter is laid at over the frame that ends on `cycle`: along its
// orbit, and along the way of the obstacle it follows (none across a cut).
export function laidSteps(e, cycle) {
  let steps = e.orbit ? Math.max(1, Math.ceil(2 * Math.PI * Math.max(e.orbit.radius[0], e.orbit.radius[1]) / Math.abs(e.orbit.period))) : 1;
  if (e.follow && e.follow.path && !e.follow.path[cycle].cut) {
    const now = e.follow.path[cycle], was = e.follow.path[cycle - 1];
    steps = Math.max(steps, Math.abs(now.x - was.x), Math.abs(now.y - was.y));
  }
  return steps;
}
// Coverage of a point by the emitter's disc or box, with a soft one-cell rim.
export function coverage(e, dx, dy) {
  if (e.radius !== null) { const d = Math.sqrt(dx * dx + dy * dy), w = e.radius + 0.5 - d; return w <= 0 ? 0 : w >= 1 ? 1 : w; }
  const wx = e.area[0] / 2 + 0.5 - (dx < 0 ? -dx : dx), wy = e.area[1] / 2 + 0.5 - (dy < 0 ? -dy : dy);
  return wx <= 0 || wy <= 0 ? 0 : (wx >= 1 ? 1 : wx) * (wy >= 1 ? 1 : wy);
}
export const reach = e => (e.radius !== null ? e.radius : Math.max(e.area[0], e.area[1]) / 2) + 1;
// With `falloff`, an emitter's amounts fall off from its centre toward its rim: 1 at the centre, 1 - falloff at the
// edge of the disc (or the ellipse inside the box), so a puff is densest in the middle instead of a flat plateau.
export function profile(e, dx, dy) {
  if (!e.falloff) return 1;
  const share = e.radius !== null ? (dx * dx + dy * dy) / (e.radius * e.radius) : (4 * dx * dx) / (e.area[0] * e.area[0]) + (4 * dy * dy) / (e.area[1] * e.area[1]);
  return share >= 1 ? 1 - e.falloff : 1 - e.falloff * share;
}
// The flow an emitter pushes toward at a point: its velocity plus clockwise swirl, and for liquids outward expansion.
// A gas cannot be pushed outward everywhere (the pressure solve would undo it), so it expands through `spread`.
export function push(e, dx, dy, axis, expand) {
  let value = e.velocity[axis];
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > 0.5 && (expand || e.vortex)) value += axis === 0 ? (expand * dx - e.vortex * dy) / d : (expand * dy + e.vortex * dx) / d;
  return value;
}
// Divergence per covered cell that sends `expand` pixels per frame out through the emitter's rim.
export const spread = e => e.expand * (e.radius !== null ? 2 / e.radius : 2 * (e.area[0] + e.area[1]) / (e.area[0] * e.area[1]));
