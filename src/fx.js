// Particle effects compiled to ordinary, editable recipes, after Pixel Composer's particle system. A pixelforge-fx
// source names effects; each simulates seeded emitters frame by frame and bakes every frame into stamp, grid and
// line operations on the source's own symbols. The result inspects, patches and exports like any other version-1
// recipe, and editing a symbol in it updates every particle drawn with it. Emitters spawn in a box, on a ring or arc,
// or along a line; a child emitter spawns where its parent's particles end, land or travel; particles can face their
// direction of travel and change colour over their life; cues mark frames for game code. Shape layers (src/shapes.js:
// shockwave rings, slashes, beams, lightning, magic circles, impact stars, fireballs) bake into one grid per frame
// between `behind` particles and the rest. Browser-compatible and deterministic: seeded hashing and polynomial
// trigonometry, no Math.random.
import { PixelError, parseColor, renderProject, FRAME_AREA } from './core.js';
import { fields, point } from './authoring.js';
import { patternProblem, ditherThreshold, traceLine, random, hash, sinDeg, cosDeg, ease, EASINGS } from './craft.js';
import { readShapes, renderShapes, tween, sample } from './shapes.js';

const fail = (path, message) => { throw new PixelError(path, message); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = (value, path) => {
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) fail(path, 'expected a name of letters, digits, hyphens or underscores, starting with a letter');
  return value;
};
const number = (value, path, min, max) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(path, `expected a number from ${min} to ${max}`);
  return value;
};
const integer = (value, path, min, max) => {
  if (!Number.isInteger(value) || value < min || value > max) fail(path, `expected an integer from ${min} to ${max}`);
  return value;
};
// A number, or [min, max] sampled per particle.
const range = (value, path, min, max, whole = false) => {
  const check = whole ? integer : number;
  if (Array.isArray(value)) {
    if (value.length !== 2) fail(path, 'expected a number or [min, max]');
    const [a, b] = [check(value[0], `${path}[0]`, min, max), check(value[1], `${path}[1]`, min, max)];
    if (a > b) fail(path, 'min must not exceed max');
    return [a, b];
  }
  const v = check(value, path, min, max);
  return [v, v];
};
const pair = (value, path, min, max) => {
  if (!Array.isArray(value) || value.length !== 2) fail(path, 'expected [x, y]');
  return [number(value[0], `${path}[0]`, min, max), number(value[1], `${path}[1]`, min, max)];
};
const pick = ([a, b], r) => a + (b - a) * r;
const pickWhole = ([a, b], r) => a + Math.min(b - a, Math.floor(r * (b - a + 1)));
// Salts keep each sampled property independent, so changing one range does not reshuffle the others.
const SALT = { x: 1, y: 2, angle: 3, speed: 4, life: 5, variant: 6, remap: 7, phase: 8, offset: 9, ring: 10, radius: 11, along: 12 };
const LIMITS = { effects: 64, emitters: 16, spawned: 4096, alive: 1024, operations: 20000 };
// When a child emitter spawns: where a parent particle ends, where it first lands on its floor, or every frame it lives.
export const FX_EVENTS = ['death', 'floor', 'life'];
const flag = (value, path) => {
  if (value !== undefined && typeof value !== 'boolean') fail(path, 'expected true or false');
  return value === true;
};
const readRemap = (remap, path, palette) => {
  if (!isObject(remap)) fail(path, 'expected a map of grid characters to colours');
  for (const [char, color] of Object.entries(remap)) {
    if (char.length !== 1 || char === '.' || char === ' ') fail(path, 'remap keys are single grid characters other than dot or space');
    parseColor(color, palette, `${path}.${char}`);
  }
  return remap;
};

// `earlier` holds the effect's emitters read so far: a child names one of them as its parent.
function readEmitter(emitter, path, context, earlier) {
  fields(emitter, ['name', 'at', 'area', 'ring', 'line', 'burst', 'rate', 'start', 'end', 'life', 'angle', 'speed', 'gravity', 'drag', 'attract', 'sway', 'floor', 'bounce', 'shapes', 'face', 'play', 'remaps', 'tint', 'trail', 'dissolve', 'pattern', 'from', 'when', 'inherit', 'behind', 'cue', 'blob'], path);
  const { frames, symbols, palette, loop, seed, looks } = context;
  // A blob particle draws no symbol: it adds a soft disc to one of the effect's looks, so touching drops merge.
  let blob = null;
  if (emitter.blob !== undefined) {
    if (emitter.blob === null || typeof emitter.blob !== 'object' || Array.isArray(emitter.blob)) fail(`${path}.blob`, 'expected { look, radius }');
    fields(emitter.blob, ['look', 'radius'], `${path}.blob`);
    const look = emitter.blob.look ?? (looks.length === 1 ? looks[0] : undefined);
    if (!looks.includes(look)) fail(`${path}.blob.look`, emitter.blob.look === undefined ? `name the look this blob is drawn into: ${looks.join(', ')}` : `no look is named ${JSON.stringify(emitter.blob.look)}`);
    blob = { look, radius: tween(emitter.blob.radius ?? 3, `${path}.blob.radius`, 0, 64) };
    for (const key of ['shapes', 'face', 'play', 'remaps', 'tint', 'trail', 'dissolve', 'pattern', 'behind']) if (emitter[key] !== undefined) fail(`${path}.${key}`, `${key} applies to particles drawn as symbols; a blob particle is drawn into its look`);
  }
  if (emitter.name !== undefined) identifier(emitter.name, `${path}.name`);
  if ((emitter.burst === undefined) === (emitter.rate === undefined)) fail(path, 'use exactly one of burst (particles at start) or rate (particles per frame)');
  // A child spawns from the particles of an earlier emitter, at an event, instead of on a schedule of its own.
  let parent = null, when = null;
  if (emitter.from !== undefined) {
    identifier(emitter.from, `${path}.from`);
    const matches = earlier.flatMap((e, i) => (e.name === emitter.from ? [i] : []));
    if (!matches.length) fail(`${path}.from`, `no earlier emitter in this effect is named ${JSON.stringify(emitter.from)}; list the parent before its children`);
    if (matches.length > 1) fail(`${path}.from`, `${matches.length} earlier emitters are named ${JSON.stringify(emitter.from)}; give the parent a unique name`);
    parent = matches[0];
    when = emitter.when ?? 'death';
    if (!FX_EVENTS.includes(when)) fail(`${path}.when`, 'expected death (where a parent particle ends), floor (where it first lands) or life (every frame it lives)');
    if (when === 'life' && emitter.rate === undefined) fail(`${path}.burst`, 'a child spawning while its parent lives uses rate: particles per frame for each parent particle');
    if (when !== 'life' && emitter.burst === undefined) fail(`${path}.rate`, `a child spawning at its parent's ${when} uses burst: particles per event`);
    if (when === 'floor' && earlier[parent].floor === null) fail(`${path}.when`, `emitter ${JSON.stringify(emitter.from)} has no floor to land on`);
    for (const key of ['start', 'end']) if (emitter[key] !== undefined) fail(`${path}.${key}`, 'a child spawns when its parent particles do; start and end apply to emitters with their own schedule');
  } else {
    for (const key of ['when', 'inherit']) if (emitter[key] !== undefined) fail(`${path}.${key}`, `${key} applies to a child emitter; set from to the emitter it spawns from`);
  }
  const start = integer(emitter.start ?? 0, `${path}.start`, 0, frames - 1);
  if (emitter.end !== undefined && emitter.rate === undefined) fail(`${path}.end`, 'end applies to rate emitters');
  const end = integer(emitter.end ?? frames, `${path}.end`, start + 1, frames);
  // A child's at is an offset from its parent particle (default none); everyone else's is the spawn centre.
  const at = parent !== null && emitter.at === undefined ? [0, 0] : pair(emitter.at, `${path}.at`, -4096, 4096);
  const spawnShapes = ['area', 'ring', 'line'].filter(key => emitter[key] !== undefined);
  if (spawnShapes.length > 1) fail(`${path}.${spawnShapes[1]}`, `use one of area (a box), ring (a circle or arc) or line (a segment); this emitter already has ${spawnShapes[0]}`);
  let ring = null, line = null;
  if (emitter.ring !== undefined) {
    fields(emitter.ring, ['radius', 'arc', 'even', 'outward'], `${path}.ring`);
    const arc = emitter.ring.arc === undefined ? [0, 360] : pair(emitter.ring.arc, `${path}.ring.arc`, -3600, 3600);
    if (arc[1] < arc[0] || arc[1] - arc[0] > 360) fail(`${path}.ring.arc`, 'expected [from, to] in degrees clockwise (0 right, 90 down), from no more than to and at most 360 apart');
    ring = { radius: range(emitter.ring.radius, `${path}.ring.radius`, 0, 256), arc, even: flag(emitter.ring.even, `${path}.ring.even`), outward: flag(emitter.ring.outward, `${path}.ring.outward`) };
  }
  if (emitter.line !== undefined) {
    fields(emitter.line, ['to', 'even'], `${path}.line`);
    const to = pair(emitter.line.to, `${path}.line.to`, -4096, 4096);
    line = { dx: to[0] - at[0], dy: to[1] - at[1], even: flag(emitter.line.even, `${path}.line.even`) };
  }
  if (!blob && (!Array.isArray(emitter.shapes) || !emitter.shapes.length || emitter.shapes.length > 64)) fail(`${path}.shapes`, 'expected 1–64 symbol names (one sequence) or lists of them (variants picked per particle), or a blob drawn into a look');
  const nested = !blob && Array.isArray(emitter.shapes[0]);
  const variants = blob ? [] : (nested ? emitter.shapes : [emitter.shapes]).map((sequence, v) => {
    const sp = nested ? `${path}.shapes[${v}]` : `${path}.shapes`;
    if (!Array.isArray(sequence) || !sequence.length || sequence.length > 64) fail(sp, 'expected a list of 1–64 symbol names');
    return sequence.map((name, i) => {
      if (typeof name !== 'string' || !Object.hasOwn(symbols, name)) fail(`${sp}[${i}]`, `unknown symbol ${JSON.stringify(name)}`);
      return name;
    });
  });
  // With face, the sequences are directions of travel: the first faces right and the rest turn clockwise, evenly.
  const face = flag(emitter.face, `${path}.face`);
  if (face && (!nested || variants.length < 2 || variants.length > 16)) fail(`${path}.shapes`, 'face picks a sequence by direction of travel: give 2–16 sequences, the first facing right (0°) and the rest turning clockwise, evenly spaced');
  const play = emitter.play ?? 'life';
  if (!['life', 'loop', 'once'].includes(play)) fail(`${path}.play`, 'expected life (spread over the lifetime), loop (one per frame, cycling) or once (one per frame, holding the last)');
  const life = emitter.life === undefined ? null : range(emitter.life, `${path}.life`, 1, 256, true);
  if (loop && !life) fail(`${path}.life`, 'looping effects need a finite life so the loop can repeat seamlessly');
  if (emitter.dissolve !== undefined && !life) fail(`${path}.dissolve`, 'dissolve needs a finite life');
  const remaps = emitter.remaps === undefined ? [] : emitter.remaps;
  if (!Array.isArray(remaps) || remaps.length > 64) fail(`${path}.remaps`, 'expected at most 64 remaps, one picked per particle');
  remaps.forEach((remap, r) => readRemap(remap, `${path}.remaps[${r}]`, palette));
  let tint = null;
  if (emitter.tint !== undefined) {
    if (!Array.isArray(emitter.tint) || !emitter.tint.length || emitter.tint.length > 64) fail(`${path}.tint`, 'expected 1–64 remaps: colour stages spread over each life, the first at birth');
    tint = emitter.tint.map((stage, s) => readRemap(stage, `${path}.tint[${s}]`, palette));
  }
  let cue = null;
  if (emitter.cue !== undefined) {
    cue = identifier(emitter.cue, `${path}.cue`);
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cue)) fail(`${path}.cue`, 'reserved filename; choose a portable name');
  }
  let trail = null;
  if (emitter.trail !== undefined) {
    fields(emitter.trail, ['color', 'length'], `${path}.trail`);
    parseColor(emitter.trail.color, palette, `${path}.trail.color`);
    trail = { color: emitter.trail.color, length: integer(emitter.trail.length ?? 2, `${path}.trail.length`, 1, 16) };
  }
  let attract = null;
  if (emitter.attract !== undefined) {
    fields(emitter.attract, ['at', 'strength'], `${path}.attract`);
    attract = { at: pair(emitter.attract.at, `${path}.attract.at`, -4096, 4096), strength: number(emitter.attract.strength ?? 0.5, `${path}.attract.strength`, -8, 8) };
  }
  let sway = null;
  if (emitter.sway !== undefined) {
    fields(emitter.sway, ['amplitude', 'period'], `${path}.sway`);
    sway = { amplitude: pair(emitter.sway.amplitude, `${path}.sway.amplitude`, 0, 32), period: number(emitter.sway.period ?? 8, `${path}.sway.period`, 1, 256) };
  }
  if (emitter.bounce !== undefined && emitter.floor === undefined) fail(`${path}.bounce`, 'bounce applies at a floor');
  // The dissolve pattern takes the same forms as the dither operation: a Bayer name, noise (ordered by the effect's
  // seed) or a matrix of ranks.
  const pattern = emitter.pattern ?? 'bayer4', problem = patternProblem(pattern);
  if (problem) fail(`${path}.pattern${problem[0]}`, problem[1]);
  if (emitter.pattern !== undefined && emitter.dissolve === undefined) fail(`${path}.pattern`, 'pattern shapes the dissolve; set dissolve too');
  const area = emitter.area === undefined ? [1, 1] : point(emitter.area, `${path}.area`);
  if (area.some(n => n < 1 || n > 256)) fail(`${path}.area`, 'expected a spawn box from 1 to 256 pixels per side');
  return {
    name: emitter.name, at, area, ring, line, start, end, variants, face, play, life, remaps, tint, trail, attract, sway, parent, when, cue, blob,
    directions: face ? variants.map((_, k) => [cosDeg(360 * k / variants.length), sinDeg(360 * k / variants.length)]) : null,
    inherit: number(emitter.inherit ?? 0, `${path}.inherit`, 0, 2), behind: flag(emitter.behind, `${path}.behind`),
    burst: emitter.burst === undefined ? null : integer(emitter.burst, `${path}.burst`, 1, 1024),
    rate: emitter.rate === undefined ? null : number(emitter.rate, `${path}.rate`, 0.001, 64),
    // Measured from each particle's outward direction on an outward ring, where it defaults to straight out.
    angle: range(emitter.angle ?? (ring?.outward ? 0 : [0, 360]), `${path}.angle`, -3600, 3600),
    speed: range(emitter.speed ?? 0, `${path}.speed`, 0, 64),
    gravity: emitter.gravity === undefined ? [0, 0] : pair(emitter.gravity, `${path}.gravity`, -8, 8),
    drag: number(emitter.drag ?? 0, `${path}.drag`, 0, 1),
    floor: emitter.floor === undefined ? null : integer(emitter.floor, `${path}.floor`, -4096, 4096),
    bounce: number(emitter.bounce ?? 0, `${path}.bounce`, 0, 1),
    dissolve: emitter.dissolve === undefined ? 0 : number(emitter.dissolve, `${path}.dissolve`, 0, 1),
    threshold: ditherThreshold(pattern, [0, 0], seed)
  };
}

// The direction a facing particle draws: the sequence whose direction is closest to its velocity (largest dot
// product, comparisons only, so the choice is the same in every engine); a particle at rest keeps its last one.
function facing(e, vx, vy, previous) {
  if (vx * vx + vy * vy < 1e-6) return previous;
  let best = 0, most = -Infinity;
  e.directions.forEach(([dx, dy], k) => { const dot = vx * dx + vy * dy; if (dot > most + 1e-9) { most = dot; best = k; } });
  return best;
}
// The k-th of `count` angles spread evenly over an arc: a full circle has no repeat at its end; a shorter arc reaches
// both ends (a single particle takes the middle).
const evenAngle = ([from, to], k, count) => (to - from >= 360 ? from + 360 * k / count : count === 1 ? (from + to) / 2 : from + (to - from) * k / (count - 1));

// Simulates one effect and returns its frames' operations plus counts for the metadata.
function simulate(effect, context) {
  const { frames, loop, seed, emitters } = effect, { width, height, symbols } = context;
  // A loop warms up for as many whole cycles as the longest chain of lives (a child's particles can outlive their parent's
  // by their own life), with spawns keyed by their frame within the cycle and children by their parent, so the particles
  // in flight at frame 0 are exactly those still alive at the end.
  const chain = [];
  emitters.forEach((e, i) => { chain[i] = (e.life ? e.life[1] : Infinity) + (e.parent === null ? 0 : chain[e.parent]); });
  const warmup = loop ? Math.ceil(Math.max(...chain) / frames) : 0, total = (warmup + 1) * frames, first = warmup * frames;
  // The child emitters of each emitter, by the event they spawn at.
  const children = emitters.map((_, i) => Object.fromEntries(['death', 'floor'].map(when => [when, emitters.flatMap((e, j) => (e.parent === i && e.when === when ? [j] : []))])));
  const alive = [], output = Array.from({ length: frames }, () => []), behind = Array.from({ length: frames }, () => []), blobs = Array.from({ length: frames }, () => []), cues = Array.from({ length: frames }, () => ({}));
  const stats = emitters.map(e => ({ ...(e.name && { name: e.name }), spawned: 0, maxAlive: 0 }));
  let operations = 0, culled = 0;
  const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height;
  // A cue names the spawn centre in the first frame its emitter spawns at; one point per name and frame.
  const mark = (e, t, x, y) => {
    const f = t - first;
    if (e.cue && f >= 0 && f < frames && !Object.hasOwn(cues[f], e.cue)) cues[f][e.cue] = [Math.floor(x + 0.5), Math.floor(y + 0.5)];
  };
  // One new particle around (cx, cy), the k-th of `count` spawned together; `r` draws its seeded values and `tag`
  // identifies it to its own children. A child adds `inherit` times its parent's velocity.
  const launch = (e, index, cx, cy, k, count, r, tag, born, parent) => {
    let x, y, out = null;
    if (e.ring) {
      const { radius, arc, even, outward } = e.ring, theta = even ? evenAngle(arc, k, count) : pick(arc, r(SALT.ring)), d = pick(radius, r(SALT.radius));
      x = cx + cosDeg(theta) * d; y = cy + sinDeg(theta) * d;
      if (outward) out = theta;
    } else if (e.line) {
      const s = e.line.even ? (count === 1 ? 0.5 : k / (count - 1)) : r(SALT.along);
      x = cx + e.line.dx * s; y = cy + e.line.dy * s;
    } else { x = cx + (r(SALT.x) - 0.5) * (e.area[0] - 1); y = cy + (r(SALT.y) - 0.5) * (e.area[1] - 1); }
    const angle = out === null ? pick(e.angle, r(SALT.angle)) : out + pick(e.angle, r(SALT.angle)), speed = pick(e.speed, r(SALT.speed));
    const life = e.life ? pickWhole(e.life, r(SALT.life)) : Infinity, variant = e.face ? null : e.variants[Math.min(e.variants.length - 1, Math.floor(r(SALT.variant) * e.variants.length))];
    let vx = cosDeg(angle) * speed, vy = sinDeg(angle) * speed;
    if (parent && e.inherit) { vx += parent.vx * e.inherit; vy += parent.vy * e.inherit; }
    return {
      emitter: e, index, born, life, variant, age: 0, x, y, vx, vy, tag,
      remap: e.remaps.length ? e.remaps[Math.min(e.remaps.length - 1, Math.floor(r(SALT.remap) * e.remaps.length))] : null,
      phase: r(SALT.phase) * 360, offset: Math.floor(r(SALT.offset) * 64), trail: [], landed: false, facing: 0
    };
  };
  // Every new particle comes through here, so child emitters that multiply within one frame fail at the limit instead
  // of piling up millions of particles first.
  const add = particle => {
    alive.push(particle);
    if (alive.length > LIMITS.alive) fail(context.path, `more than ${LIMITS.alive} particles are alive at once; lower burst, rate or life`);
  };
  // Children of particle q, born in frame `born`: keyed by the parent's tag and age, so a looping parent has the same
  // children every cycle.
  const spawnChildren = (index, q, count, born) => {
    const e = emitters[index];
    for (let k = 0; k < count; k++) {
      const r = salt => random(q.tag, index, q.age, k, salt);
      add(launch(e, index, q.x + e.at[0], q.y + e.at[1], k, count, r, hash(q.tag, index, q.age, k), born, q));
      if (born >= first) stats[index].spawned++;
    }
    if (count) mark(e, born, q.x + e.at[0], q.y + e.at[1]);
  };
  const layered = emitters.some(e => e.behind);
  for (let t = 0; t < total; t++) {
    const cycle = t % frames, drawing = t >= first;
    emitters.forEach((e, index) => {
      if (e.parent !== null) return;
      let count = 0;
      if (e.burst !== null) count = cycle === e.start ? e.burst : 0;
      else if (cycle >= e.start && cycle < e.end) { const c = cycle - e.start; count = Math.floor((c + 1) * e.rate + 1e-9) - Math.floor(c * e.rate + 1e-9); }
      const key = loop ? cycle : t;
      for (let k = 0; k < count; k++) {
        add(launch(e, index, e.at[0], e.at[1], k, count, salt => random(seed, index, key, k, salt), hash(seed, index, key, k), t, null));
        if (drawing) stats[index].spawned++;
      }
      if (count) mark(e, t, e.at[0], e.at[1]);
    });
    // Children that spawn while their parents live: `rate` per frame for each parent particle, from where it is.
    emitters.forEach((e, index) => {
      if (e.when !== 'life') return;
      for (let i = 0, parents = alive.length; i < parents; i++) {
        const q = alive[i];
        if (q.index === e.parent) spawnChildren(index, q, Math.floor((q.age + 1) * e.rate + 1e-9) - Math.floor(q.age * e.rate + 1e-9), t);
      }
    });
    if (drawing) emitters.forEach((e, index) => { stats[index].maxAlive = Math.max(stats[index].maxAlive, alive.filter(p => p.index === index).length); });
    // Every live particle's rounded (and swayed) position. Sway never carries a particle below its floor. A facing
    // particle turns with its velocity in every frame, warm-up included, so a loop's frame 0 continues its last frame.
    const places = alive.map(p => {
      const e = p.emitter, sway = e.sway;
      const sx = sway ? sway.amplitude[0] * sinDeg(360 * p.age / sway.period + p.phase) : 0, sy = sway ? sway.amplitude[1] * cosDeg(360 * p.age / sway.period + p.phase) : 0;
      const x = p.x + sx, y = e.floor !== null && p.y + sy > e.floor ? e.floor : p.y + sy, X = Math.floor(x + 0.5), Y = Math.floor(y + 0.5);
      p.trail.push([X, Y]);
      if (p.trail.length > 17) p.trail.shift();
      if (e.face) p.facing = facing(e, p.vx, p.vy, p.facing);
      return [X, Y, x, y];
    });
    // Draw oldest first, with `behind` emitters' particles under everyone else's. Particles partly off the canvas are
    // cropped into grid operations and trails keep only their on-canvas pixels, so nothing clips.
    if (drawing) for (const pass of layered ? [true, false] : [null]) alive.forEach((p, i) => {
      const e = p.emitter;
      if (pass !== null && e.behind !== pass) return;
      const [X, Y] = places[i], ops = (pass === true ? behind : output)[t - first], span = Number.isFinite(p.life) ? p.life : frames - (p.born - first);
      if (e.blob) {
        // Its radius moves through the keys over its life; the shape layers' grid draws it.
        const radius = sample(e.blob.radius, Math.min(1, p.age / Math.max(1, span - 1))), [, , x, y] = places[i];
        if (radius > 0 && x + radius > 0 && y + radius > 0 && x - radius < width && y - radius < height) blobs[t - first].push({ look: e.blob.look, x, y, radius });
        else culled++;
        return;
      }
      const sequence = e.face ? e.variants[p.facing] : p.variant, share = stages => Math.min(stages - 1, Math.floor(p.age / span * stages));
      const step = e.play === 'loop' ? (p.age + p.offset) % sequence.length : e.play === 'once' ? Math.min(p.age, sequence.length - 1) : share(sequence.length);
      const symbol = sequence[step], rows = symbols[symbol], w = rows[0].length, h = rows.length, left = X - Math.floor(w / 2), top = Y - Math.floor(h / 2);
      if (e.trail) {
        const [fromX, fromY] = p.trail[Math.max(0, p.trail.length - 1 - e.trail.length)];
        const pixels = [];
        if (fromX !== X || fromY !== Y) traceLine(fromX, fromY, X, Y, (x, y) => pixels.push([x, y]));
        const visible = pixels.filter(([x, y]) => inside(x, y));
        if (visible.length === pixels.length && pixels.length) ops.push({ op: 'line', x: fromX, y: fromY, x2: X, y2: Y, color: e.trail.color });
        else ops.push(...visible.map(([x, y]) => ({ op: 'pixel', x, y, color: e.trail.color })));
        operations += visible.length === pixels.length ? Math.min(1, pixels.length) : visible.length;
      }
      if (left >= width || top >= height || left + w <= 0 || top + h <= 0) { culled++; return; }
      // Tint stages spread over the life like `play: life`, over the particle's own remap.
      const colours = e.tint ? { ...p.remap, ...e.tint[share(e.tint.length)] } : p.remap;
      const remap = colours && Object.keys(colours).length ? { remap: colours } : {};
      // The last `dissolve` share of a life thins out through an ordered-dither pattern anchored to the canvas.
      const fading = e.dissolve ? Math.ceil(e.dissolve * p.life) : 0, into = p.age - (p.life - fading);
      const progress = fading && into >= 0 ? (into + 1) / (fading + 1) : 0;
      const x0 = Math.max(0, -left), y0 = Math.max(0, -top), x1 = Math.min(w, width - left), y1 = Math.min(h, height - top);
      if (!progress && x0 === 0 && y0 === 0 && x1 === w && y1 === h) { ops.push({ op: 'stamp', symbol, x: left, y: top, ...remap }); operations++; return; }
      const kept = rows.slice(y0, y1).map((row, j) => [...row.slice(x0, x1)].map((char, i) => (char === ' ' || e.threshold(left + x0 + i, top + y0 + j) < progress ? '.' : char)).join(''));
      if (kept.some(row => /[^.]/.test(row))) { ops.push({ op: 'grid', x: left + x0, y: top + y0, rows: kept, ...remap }); operations++; }
    });
    // Advance: velocity gains gravity and attraction, loses drag, moves the particle, then meets the floor. A particle
    // that ends or first lands hands the event to its children, which appear there in the next frame.
    const events = [];
    for (let i = alive.length - 1; i >= 0; i--) {
      const p = alive[i], e = p.emitter;
      p.age++;
      if (p.age >= p.life) { if (children[p.index].death.length) events.push([p, 'death']); alive.splice(i, 1); continue; }
      p.vx += e.gravity[0]; p.vy += e.gravity[1];
      if (e.attract) {
        const dx = e.attract.at[0] - p.x, dy = e.attract.at[1] - p.y, distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > 0.5) { p.vx += dx / distance * e.attract.strength; p.vy += dy / distance * e.attract.strength; }
      }
      p.vx *= 1 - e.drag; p.vy *= 1 - e.drag;
      p.x += p.vx; p.y += p.vy;
      if (e.floor !== null && p.y > e.floor) {
        p.y = e.floor;
        if (p.vy > 0) p.vy = -p.vy * e.bounce;
        if (!p.landed) { p.landed = true; if (children[p.index].floor.length) events.push([p, 'floor']); }
      }
    }
    // In the parents' drawing order.
    for (let k = events.length - 1; k >= 0; k--) { const [q, when] = events[k]; for (const index of children[q.index][when]) spawnChildren(index, q, emitters[index].burst, t + 1); }
    if (operations > LIMITS.operations) fail(context.path, `the effect needs more than ${LIMITS.operations} drawing operations; lower counts or frames`);
  }
  return { output, behind, blobs, operations, culled, stats, cues };
}

// Frame durations eased from `from` to `to` milliseconds across the effect: `in` stays quick and slows at the end,
// the usual shape of an impact (fast flash and burst, lingering settle).
function curve(value, path, count) {
  fields(value, ['from', 'to', 'ease'], path);
  const from = integer(value.from, `${path}.from`, 1, 60000), to = integer(value.to, `${path}.to`, 1, 60000), name = value.ease ?? 'linear';
  if (!EASINGS.includes(name)) fail(`${path}.ease`, `expected one of ${EASINGS.join(', ')}`);
  return Array.from({ length: count }, (_, i) => Math.min(60000, Math.max(1, Math.round(from + (to - from) * ease(name, count === 1 ? 0 : i / (count - 1))))));
}

export function compileEffects(source) {
  fields(source, ['format', 'version', 'name', 'width', 'height', 'palette', 'symbols', 'anchor', 'effects', 'sheet'], 'fx');
  if (source.format !== 'pixelforge-fx' || source.version !== 1) fail('fx', 'expected version-1 pixelforge-fx');
  const palette = source.palette ?? {};
  if (!isObject(palette)) fail('fx.palette', 'expected a palette object');
  const width = integer(source.width, 'fx.width', 1, 256), height = integer(source.height, 'fx.height', 1, 256);
  const symbols = source.symbols ?? {};
  if (!isObject(symbols) || (source.symbols !== undefined && !Object.keys(symbols).length)) fail('fx.symbols', 'expected named symbols for the particles to draw');
  for (const [name, rows] of Object.entries(symbols)) {
    identifier(name, `fx.symbols.${name}`);
    if (!Array.isArray(rows) || !rows.length || rows.length > 256 || typeof rows[0] !== 'string' || !rows[0].length || rows.some(row => typeof row !== 'string' || row.length !== rows[0].length)) fail(`fx.symbols.${name}`, 'expected 1–256 equal-width text rows');
  }
  if (!isObject(source.effects) || !Object.keys(source.effects).length || Object.keys(source.effects).length > LIMITS.effects) fail('fx.effects', `expected 1–${LIMITS.effects} named effects`);
  const frames = [], animations = {}, metadata = { format: 'pixelforge-fx-metadata', version: 1, effects: {} }, seen = new Set();
  // Shape painting shares one work budget across every effect and frame (shapes.js SHAPE_WORK).
  const shapeWork = { spent: 0 };
  let totalFrames = 0;
  for (const [name, effect] of Object.entries(source.effects)) {
    const path = `fx.effects.${name}`;
    identifier(name, path);
    // Effect names become animation and frame names, which must be unique ignoring case for portable bundles.
    if (seen.has(name.toLowerCase())) fail(path, 'effect names must be unique ignoring case; they name animations and frames');
    seen.add(name.toLowerCase());
    fields(effect, ['frames', 'duration', 'loop', 'seed', 'emitters', 'layers', 'looks', 'cleanup'], path);
    const count = integer(effect.frames, `${path}.frames`, 1, 256), loop = effect.loop ?? false;
    // The recipe's limits on frames, checked before anything is simulated or painted rather than after.
    totalFrames += count;
    if (totalFrames > 256) fail('fx.effects', `the effects make ${totalFrames} frames; a recipe holds at most 256`);
    if (totalFrames * width * height > FRAME_AREA) fail('fx.effects', `the effects make ${totalFrames} frames of ${width}×${height}, more than the 4,194,304 pixels a recipe's frames share; use fewer frames or a smaller canvas`);
    if (typeof loop !== 'boolean') fail(`${path}.loop`, 'expected a boolean');
    const durations = Array.isArray(effect.duration)
      ? (effect.duration.length === count ? effect.duration.map((d, i) => integer(d, `${path}.duration[${i}]`, 1, 60000)) : fail(`${path}.duration`, `expected one duration or ${count}`))
      : isObject(effect.duration) ? curve(effect.duration, `${path}.duration`, count)
        : Array(count).fill(integer(effect.duration ?? 100, `${path}.duration`, 1, 60000));
    const seed = integer(effect.seed ?? 1, `${path}.seed`, 0, 2147483647), context = { frames: count, loop, seed, symbols, palette, width, height, path };
    // Shape layers (rings, slashes, beams, bolts, glyphs, stars, bursts) draw between `behind` particles and the rest.
    const shapes = readShapes(effect, path, context);
    context.looks = shapes ? shapes.looks.map(look => look.name) : [];
    const list = effect.emitters ?? (shapes ? [] : undefined);
    if (!Array.isArray(list) || (!list.length && (!shapes || effect.emitters !== undefined)) || list.length > LIMITS.emitters) fail(`${path}.emitters`, `expected 1–${LIMITS.emitters} emitters; leave emitters out for an effect of shape layers only`);
    const emitters = [];
    list.forEach((emitter, i) => emitters.push(readEmitter(emitter, `${path}.emitters[${i}]`, context, emitters)));
    const run = emitters.length ? simulate({ frames: count, loop, seed, emitters }, context)
      : { output: Array.from({ length: count }, () => []), behind: Array.from({ length: count }, () => []), blobs: Array.from({ length: count }, () => []), operations: 0, culled: 0, stats: [], cues: Array.from({ length: count }, () => ({})) };
    if (shapes) for (const layer of shapes.layers) if (layer.cue && !Object.hasOwn(run.cues[layer.t0], layer.cue)) run.cues[layer.t0][layer.cue] = [Math.floor(layer.at[0] + 0.5), Math.floor(layer.at[1] + 0.5)];
    const spawned = run.stats.reduce((sum, s) => sum + s.spawned, 0);
    if (spawned > LIMITS.spawned) fail(`${path}.emitters`, `more than ${LIMITS.spawned} particles; lower burst, rate or frames`);
    // Cues become named frame points, which atlases export for game code (a shake or a pause on the impact frame).
    const cues = [];
    const names = run.output.map((front, i) => {
      const grid = shapes && renderShapes(shapes, i, width, height, run.blobs[i], shapeWork);
      const ops = [...run.behind[i], ...(grid ? [{ op: 'grid', x: grid.x, y: grid.y, rows: grid.rows }] : []), ...front];
      const points = Object.keys(run.cues[i]).length ? run.cues[i] : null;
      if (points) for (const [cue, at] of Object.entries(points)) cues.push({ name: cue, frame: i, at });
      frames.push({ name: `${name}-${i}`, duration: durations[i], ...(points && { points }), ...(ops.length && { ops }) });
      return `${name}-${i}`;
    });
    animations[name] = { frames: names, ...(!loop && { loop: false }) };
    metadata.effects[name] = { frames: count, loop, seed: effect.seed ?? 1, operations: run.operations, culled: run.culled, emitters: run.stats, ...(shapes?.layers.length ? { layers: shapes.layers.map(l => ({ kind: l.kind, look: l.look, frames: [l.t0, l.t1] })) } : {}), ...(cues.length && { cues }) };
  }
  if (frames.length > 256) fail('fx.effects', `the effects make ${frames.length} frames; a recipe holds at most 256`);
  const recipe = { version: 1, name: source.name, width, height, palette, ...(Object.keys(symbols).length && { symbols }), ...(source.anchor !== undefined && { anchor: source.anchor }), frames, animations, ...(source.sheet !== undefined && { sheet: source.sheet }) };
  renderProject(recipe);
  return JSON.parse(JSON.stringify({ recipe, metadata }));
}
