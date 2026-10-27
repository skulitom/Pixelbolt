// Stylized combat and spell shapes for pixelforge-fx effects: shockwave rings, slash crescents, beams, lightning
// bolts, magic circles, impact stars and fire bursts. Each layer writes an intensity field over the canvas inside its
// own window of frames; the layers of one look combine (the larger value, or the sum) and the look cuts the result
// into hard bands of palette colours, optionally feathered through an ordered dither. Cleanup and a one-pixel outline
// follow, and the fx compiler bakes each frame into one grid operation under its particles, so the result stays an
// ordinary recipe. Browser-compatible and deterministic: + − × ÷ and sqrt, craft's polynomial trigonometry and seeded
// hashing, so every engine draws the same pixels.
import { PixelError } from './core.js';
import { fields } from './authoring.js';
import { patternProblem, ditherThreshold, cleanupIds, traceLine, hash, random, sinDeg, cosDeg, ease, EASINGS } from './craft.js';

export const SHAPE_KINDS = ['ring', 'slash', 'beam', 'bolt', 'glyph', 'star', 'burst', 'stream'];
const LIMITS = { layers: 16, looks: 8, colors: 8 };
const PI = 3.141592653589793;
const SPECIFIC = {
  ring: ['radius', 'width', 'fill', 'noise', 'scale'],
  slash: ['radius', 'width', 'arc', 'reveal', 'noise', 'scale'],
  beam: ['to', 'width', 'reveal', 'wobble', 'wavelength', 'waves', 'fade', 'noise', 'scale'],
  bolt: ['to', 'width', 'glow', 'jag', 'branches', 'reroll', 'segment', 'reveal', 'noise', 'scale'],
  glyph: ['radius', 'inner', 'points', 'step', 'runes', 'double', 'spin', 'reveal', 'glow', 'fill', 'noise', 'scale'],
  star: ['radius', 'points', 'ratio', 'width', 'core', 'angle', 'spin', 'jitter', 'noise', 'scale'],
  burst: ['radius', 'hole', 'noise', 'scale', 'boil'],
  stream: ['through', 'width', 'taper', 'head', 'tail', 'sway', 'wavelength', 'waves', 'noise', 'scale']
};
const COMMON = ['kind', 'look', 'at', 'frames', 'ease', 'power', 'flicker', 'blend', 'tilt', 'squash', 'drift', 'floor', 'seed', 'cue'];

const fail = (path, message) => { throw new PixelError(path, message); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const number = (value, path, min, max) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(path, `expected a number from ${min} to ${max}`);
  return value;
};
const integer = (value, path, min, max) => {
  if (!Number.isInteger(value) || value < min || value > max) fail(path, `expected an integer from ${min} to ${max}`);
  return value;
};
const pair = (value, path, min, max) => {
  if (!Array.isArray(value) || value.length !== 2) fail(path, 'expected [x, y]');
  return [number(value[0], `${path}[0]`, min, max), number(value[1], `${path}[1]`, min, max)];
};
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const round = x => Math.floor(x + 0.5);

// The angle of (x, y) in degrees clockwise from +x (y points down), in [0, 360). Two half-angle steps bring the
// tangent under 0.2, where the Taylor series to t^21 is exact to double precision: + − × ÷ and sqrt only.
export function atan2Deg(y, x) {
  if (x === 0 && y === 0) return 0;
  const ax = Math.abs(x), ay = Math.abs(y), small = ay <= ax;
  let t = small ? ay / ax : ax / ay;
  t = t / (1 + Math.sqrt(1 + t * t));
  t = t / (1 + Math.sqrt(1 + t * t));
  const t2 = t * t;
  const series = t * (1 + t2 * (-1 / 3 + t2 * (1 / 5 + t2 * (-1 / 7 + t2 * (1 / 9 + t2 * (-1 / 11 + t2 * (1 / 13 + t2 * (-1 / 15 + t2 * (1 / 17 + t2 * (-1 / 19 + t2 / 21))))))))));
  let a = 4 * series * 180 / PI;
  if (!small) a = 90 - a;
  if (x < 0) a = 180 - a;
  if (y < 0) a = 360 - a;
  return a >= 360 ? a - 360 : a;
}

// A number, or 2–8 keys spread evenly over the layer's frames (through its easing).
export function tween(value, path, min, max) {
  if (!Array.isArray(value)) return [number(value, path, min, max)];
  if (value.length < 2 || value.length > 8) fail(path, `expected a number from ${min} to ${max}, or 2–8 of them as keys spread over the layer's frames`);
  return value.map((v, i) => number(v, `${path}[${i}]`, min, max));
}
export function sample(keys, q) {
  if (keys.length === 1) return keys[0];
  const s = q * (keys.length - 1), i = Math.max(0, Math.min(keys.length - 2, Math.floor(s)));
  return keys[i] + (keys[i + 1] - keys[i]) * (s - i);
}
const maxKey = keys => Math.max(...keys);

// Rune glyphs: 3×3 pixel marks stamped upright around a magic circle, so they stay crisp and readable when the
// circle is squashed onto the ground or turns (only their places move, never their pixels).
const RUNES = [
  ['.x.', 'xxx', '.x.'], ['x.x', '.x.', 'x.x'], ['xxx', '.x.', '.x.'], ['x..', 'xx.', 'x..'],
  ['.x.', 'x.x', '.x.'], ['x.x', 'xxx', 'x.x'], ['x.x', 'x.x', '.x.'], ['xxx', '..x', '..x']
];

function paletteKey(key, path, palette) {
  if (typeof key !== 'string' || key.length !== 1 || key === '.' || key === ' ' || !Object.hasOwn(palette, key)) fail(path, 'expected a single-character key in the palette');
  return key;
}

// Lit and shade bands: palette keys cut from the share by which the look's field falls two pixels toward the light
// (or away from it): 1 on a rim that faces that way, 0 inside.
function readShading(value, path, palette) {
  if (!isObject(value)) fail(path, 'expected { colors, thresholds }: palette keys and the rising shares (0–1) where each begins');
  fields(value, ['colors', 'thresholds'], path);
  if (!Array.isArray(value.colors) || !value.colors.length || value.colors.length > LIMITS.colors) fail(`${path}.colors`, `expected 1–${LIMITS.colors} palette keys`);
  const codes = value.colors.map((key, i) => paletteKey(key, `${path}.colors[${i}]`, palette).charCodeAt(0));
  if (!Array.isArray(value.thresholds) || value.thresholds.length !== codes.length) fail(`${path}.thresholds`, `expected ${codes.length} thresholds, one per colour`);
  const thresholds = value.thresholds.map((t, i) => {
    number(t, `${path}.thresholds[${i}]`, 0.001, 1);
    if (i && t <= value.thresholds[i - 1]) fail(`${path}.thresholds[${i}]`, 'thresholds must rise from one colour to the next');
    return t;
  });
  return { codes, thresholds };
}

function readLook(look, path, palette, seed) {
  fields(look, ['colors', 'thresholds', 'dither', 'pattern', 'outline', 'light', 'lit', 'shade'], path);
  const lit = look.lit === undefined ? null : readShading(look.lit, `${path}.lit`, palette), shade = look.shade === undefined ? null : readShading(look.shade, `${path}.shade`, palette);
  if (look.light !== undefined && !lit && !shade) fail(`${path}.light`, 'light points the lit and shade bands; add lit or shade too');
  const toward = look.light === undefined ? [-1, -1] : pair(look.light, `${path}.light`, -1, 1), reach = Math.sqrt(toward[0] * toward[0] + toward[1] * toward[1]);
  if (!reach) fail(`${path}.light`, 'expected a direction toward the light, such as [-1, -1] for the upper left');
  if (!Array.isArray(look.colors) || !look.colors.length || look.colors.length > LIMITS.colors) fail(`${path}.colors`, `expected 1–${LIMITS.colors} palette keys, from the faintest band to the brightest`);
  const colors = look.colors.map((key, i) => paletteKey(key, `${path}.colors[${i}]`, palette));
  if (!Array.isArray(look.thresholds) || look.thresholds.length !== colors.length) fail(`${path}.thresholds`, `expected ${colors.length} thresholds, one per colour`);
  const thresholds = look.thresholds.map((t, i) => {
    number(t, `${path}.thresholds[${i}]`, 0.001, 16);
    if (i && t <= look.thresholds[i - 1]) fail(`${path}.thresholds[${i}]`, 'thresholds must rise from one colour to the next');
    return t;
  });
  const pattern = look.pattern ?? 'bayer4', problem = patternProblem(pattern);
  if (problem) fail(`${path}.pattern${problem[0]}`, problem[1]);
  if (look.pattern !== undefined && look.dither === undefined) fail(`${path}.pattern`, 'pattern shapes the dither; set dither too');
  return {
    codes: colors.map(key => key.charCodeAt(0)), thresholds, gaps: thresholds.map((t, i) => t - (i ? thresholds[i - 1] : 0)),
    dither: number(look.dither ?? 0, `${path}.dither`, 0, 1), threshold: ditherThreshold(pattern, [0, 0], seed),
    outline: look.outline === undefined ? 0 : paletteKey(look.outline, `${path}.outline`, palette).charCodeAt(0),
    lit, shade, light: [toward[0] / reach, toward[1] / reach]
  };
}

function readLayer(layer, path, context, index) {
  const { frames, lookNames, seed } = context;
  if (!isObject(layer)) fail(path, 'expected a layer object');
  if (!SHAPE_KINDS.includes(layer.kind)) fail(`${path}.kind`, `expected ${SHAPE_KINDS.join(', ')}`);
  const kind = layer.kind;
  fields(layer, [...COMMON, ...SPECIFIC[kind]], path);
  let look = layer.look;
  if (look === undefined) {
    if (lookNames.length !== 1) fail(`${path}.look`, `name the look that colours this layer: ${lookNames.join(', ')}`);
    look = lookNames[0];
  } else if (!lookNames.includes(look)) fail(`${path}.look`, `no look is named ${JSON.stringify(look)}`);
  const window = layer.frames === undefined ? [0, frames] : layer.frames;
  if (!Array.isArray(window) || window.length !== 2) fail(`${path}.frames`, 'expected [first, end]: the first frame drawn and the frame after the last');
  const t0 = integer(window[0], `${path}.frames[0]`, 0, frames - 1), t1 = integer(window[1], `${path}.frames[1]`, t0 + 1, frames);
  const name = layer.ease ?? 'out';
  if (!EASINGS.includes(name)) fail(`${path}.ease`, `expected one of ${EASINGS.join(', ')}`);
  const blend = layer.blend ?? 'max';
  if (!['max', 'add'].includes(blend)) fail(`${path}.blend`, 'expected max (the brighter layer wins) or add (layers sum)');
  let cue = null;
  if (layer.cue !== undefined) {
    if (typeof layer.cue !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(layer.cue) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(layer.cue)) fail(`${path}.cue`, 'expected a portable name of letters, digits, hyphens or underscores');
    cue = layer.cue;
  }
  const out = {
    kind, look, t0, t1, ease: name, blend, cue, path,
    at: pair(layer.at, `${path}.at`, -4096, 4096),
    power: tween(layer.power ?? 1, `${path}.power`, 0, 8),
    flicker: number(layer.flicker ?? 0, `${path}.flicker`, 0, 1),
    tilt: number(layer.tilt ?? 0, `${path}.tilt`, -3600, 3600),
    squash: pair(layer.squash ?? [1, 1], `${path}.squash`, 0.125, 8),
    drift: pair(layer.drift ?? [0, 0], `${path}.drift`, -4096, 4096),
    floor: layer.floor === undefined ? null : number(layer.floor, `${path}.floor`, -4096, 4096),
    seed: hash(seed, integer(layer.seed ?? index, `${path}.seed`, 0, 2147483647))
  };
  const t = (key, fallback, min, max) => tween(layer[key] ?? fallback, `${path}.${key}`, min, max);
  const required = key => { if (layer[key] === undefined) fail(`${path}.${key}`, `a ${kind} layer needs ${key}`); return layer[key]; };
  if (kind === 'ring') Object.assign(out, { radius: t('radius', required('radius'), 0, 512), width: t('width', 3, 0, 256), fill: t('fill', 0, 0, 2), noise: number(layer.noise ?? 0, `${path}.noise`, 0, 1), scale: number(layer.scale ?? 6, `${path}.scale`, 1, 64) });
  if (kind === 'slash') {
    const arc = pair(required('arc'), `${path}.arc`, -3600, 3600);
    if (arc[0] === arc[1] || Math.abs(arc[1] - arc[0]) > 360) fail(`${path}.arc`, 'expected [from, to] in degrees clockwise (0 right, 90 down), at most 360 apart; the slash sweeps from the first to the second');
    Object.assign(out, { radius: t('radius', required('radius'), 1, 512), width: t('width', 6, 0, 256), arc, reveal: number(layer.reveal ?? 0.35, `${path}.reveal`, 0, 0.95) });
  }
  if (kind === 'beam') Object.assign(out, { to: pair(required('to'), `${path}.to`, -4096, 4096), width: t('width', 5, 0, 256), reveal: number(layer.reveal ?? 0.15, `${path}.reveal`, 0, 0.95), wobble: number(layer.wobble ?? 0.15, `${path}.wobble`, 0, 1), wavelength: number(layer.wavelength ?? 12, `${path}.wavelength`, 2, 512), waves: number(layer.waves ?? 3, `${path}.waves`, -64, 64), fade: number(layer.fade ?? 0, `${path}.fade`, 0, 1) });
  if (kind === 'bolt') Object.assign(out, { to: pair(required('to'), `${path}.to`, -4096, 4096), width: t('width', 1, 1, 9), glow: t('glow', 1, 0, 4), jag: number(layer.jag ?? 0.35, `${path}.jag`, 0, 1), branches: integer(layer.branches ?? 2, `${path}.branches`, 0, 8), reroll: integer(layer.reroll ?? 2, `${path}.reroll`, 0, 256), segment: number(layer.segment ?? 4, `${path}.segment`, 2, 64), reveal: number(layer.reveal ?? 0, `${path}.reveal`, 0, 0.95) });
  if (kind === 'glyph') {
    const points = integer(layer.points ?? 5, `${path}.points`, 0, 12);
    if (points && points < 3) fail(`${path}.points`, 'expected 0 (no star) or 3–12 star points');
    const step = integer(layer.step ?? Math.max(1, Math.floor((points - 1) / 2)), `${path}.step`, 1, 6);
    Object.assign(out, { radius: t('radius', required('radius'), 2, 512), inner: number(layer.inner ?? 0.72, `${path}.inner`, 0.2, 0.95), points, step, runes: integer(layer.runes ?? 12, `${path}.runes`, 0, 48), double: layer.double === undefined ? false : (typeof layer.double === 'boolean' ? layer.double : fail(`${path}.double`, 'expected true or false')), spin: t('spin', 0, -3600, 3600), reveal: number(layer.reveal ?? 0.3, `${path}.reveal`, 0, 0.95), glow: t('glow', 1, 0, 4), fill: t('fill', 0, 0, 2) });
  }
  if (kind === 'star') Object.assign(out, { radius: t('radius', required('radius'), 0, 512), points: integer(layer.points ?? 8, `${path}.points`, 2, 16), ratio: number(layer.ratio ?? 0.55, `${path}.ratio`, 0.05, 1), width: t('width', 2.5, 0, 64), core: t('core', layer.width === undefined ? 3 : maxKey(tween(layer.width, `${path}.width`, 0, 64)) * 1.2, 0, 128), angle: number(layer.angle ?? 0, `${path}.angle`, -3600, 3600), spin: t('spin', 0, -3600, 3600), jitter: number(layer.jitter ?? 0, `${path}.jitter`, 0, 1) });
  if (kind === 'burst') {
    const radius = t('radius', required('radius'), 0, 512);
    Object.assign(out, { radius, hole: t('hole', 0, 0, 1), noise: number(layer.noise ?? 0.4, `${path}.noise`, 0, 1), scale: number(layer.scale ?? 4, `${path}.scale`, 1, 64), boil: number(layer.boil ?? maxKey(radius) * 0.5, `${path}.boil`, -512, 512) });
  }
  if (kind === 'stream') {
    if (!Array.isArray(layer.through) || !layer.through.length || layer.through.length > 7) fail(`${path}.through`, 'expected 1–7 more [x, y] points: the stream runs from at through each of them on a smooth curve');
    if (layer.taper !== undefined && !Array.isArray(layer.taper)) fail(`${path}.taper`, 'expected 2–8 width shares spread along the stream, from its tail to its head');
    const points = [out.at, ...layer.through.map((point, i) => pair(point, `${path}.through[${i}]`, -4096, 4096))];
    Object.assign(out, {
      curve: spline(points), width: t('width', 6, 0, 256), taper: tween(layer.taper ?? [0, 1, 0], `${path}.taper`, 0, 2), head: t('head', 1, 0, 1), tail: t('tail', 0, 0, 1),
      sway: number(layer.sway ?? 0, `${path}.sway`, -64, 64), wavelength: number(layer.wavelength ?? 16, `${path}.wavelength`, 2, 512), waves: number(layer.waves ?? 1, `${path}.waves`, -64, 64)
    });
  }
  if (kind === 'ring' || kind === 'burst') out.noiseAt = ditherThreshold('value', [0, 0], out.seed, out.scale);
  else {
    // The other kinds take noise in screen space, moving with the layer, so a falling power breaks them up.
    Object.assign(out, { noise: number(layer.noise ?? 0, `${path}.noise`, 0, 1), scale: number(layer.scale ?? 4, `${path}.scale`, 1, 64) });
    if (out.noise) out.grain = ditherThreshold('value', [0, 0], out.seed, out.scale);
  }
  return out;
}

/** Reads an effect's looks, layers and cleanup; null when it has no layers. */
export function readShapes(effect, path, context) {
  const blobs = Array.isArray(effect.emitters) && effect.emitters.some(emitter => isObject(emitter) && emitter.blob !== undefined);
  if (effect.layers === undefined && !blobs) {
    for (const key of ['looks', 'cleanup']) if (effect[key] !== undefined) fail(`${path}.${key}`, `${key} colours shape layers and blob particles; add layers too`);
    return null;
  }
  const { palette, seed, frames } = context;
  if (effect.looks === undefined && effect.layers === undefined) fail(`${path}.looks`, 'blob particles are drawn into the effect\'s looks; add looks: named colour ramps');
  if (!isObject(effect.looks) || !Object.keys(effect.looks).length || Object.keys(effect.looks).length > LIMITS.looks) fail(`${path}.looks`, `expected 1–${LIMITS.looks} named looks: colour ramps that cut the layers' fields into bands, drawn in order`);
  const looks = Object.entries(effect.looks).map(([name, look]) => {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) fail(`${path}.looks.${name}`, 'expected a name of letters, digits, hyphens or underscores, starting with a letter');
    return { name, ...readLook(look, `${path}.looks.${name}`, palette, seed) };
  });
  if (effect.layers !== undefined && (!Array.isArray(effect.layers) || !effect.layers.length || effect.layers.length > LIMITS.layers)) fail(`${path}.layers`, `expected 1–${LIMITS.layers} shape layers`);
  const layers = (effect.layers ?? []).map((layer, i) => readLayer(layer, `${path}.layers[${i}]`, { frames, seed, lookNames: looks.map(l => l.name) }, i));
  let cleanup = { strays: false, corners: false };
  if (effect.cleanup !== undefined) {
    fields(effect.cleanup, ['strays', 'corners'], `${path}.cleanup`);
    for (const key of ['strays', 'corners']) if (effect.cleanup[key] !== undefined && typeof effect.cleanup[key] !== 'boolean') fail(`${path}.cleanup.${key}`, 'expected true or false');
    cleanup = { strays: effect.cleanup.strays === true, corners: effect.cleanup.corners === true };
  }
  return { looks, layers, cleanup };
}

// ---- Painting ------------------------------------------------------------------------------------------------------
// The layer's own frame: local (u, v) undoes its tilt and squash around its centre, so a squashed ring lies on the
// ground and a tilted slash cuts on a diagonal.
function frameOf(layer, cx, cy) {
  const c = cosDeg(layer.tilt), s = sinDeg(layer.tilt), [sx, sy] = layer.squash;
  return {
    local: (x, y) => { const dx = x - cx, dy = y - cy; return [(dx * c + dy * s) / sx, (-dx * s + dy * c) / sy]; },
    screen: (u, v) => { const X = u * sx, Y = v * sy; return [cx + X * c - Y * s, cy + X * s + Y * c]; },
    reach: Math.max(sx, sy)
  };
}

// Area shapes: value(u, v) at every pixel within `bound` screen pixels of the centre.
function paintArea(put, width, height, cx, cy, bound, frame, value) {
  const y0 = Math.max(0, Math.floor(cy - bound)), y1 = Math.min(height - 1, Math.ceil(cy + bound));
  const x0 = Math.max(0, Math.floor(cx - bound)), x1 = Math.min(width - 1, Math.ceil(cx + bound));
  for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
    const [u, v] = frame.local(i, j), amount = value(u, v, i, j);
    if (amount > 0) put(i, j, amount);
  }
}

// One ink pixel: a core disc of `core` pixels radius at `value` and a glow `glow` pixels beyond it at a fraction of
// it. `keep(x, y)` may hide pixels (a reveal).
function dab(put, x, y, value, core, glow, keep) {
  if (!keep(x, y)) return;
  const reach = Math.ceil(core + glow);
  for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
    const d2 = dx * dx + dy * dy;
    if (d2 <= core * core + 0.5) put(x + dx, y + dy, value);
    else if (glow > 0) {
      const d = Math.sqrt(d2) - core;
      if (d <= glow + 0.5) put(x + dx, y + dy, value * 0.45 * (1 - d / (glow + 1.5)));
    }
  }
}
// Ink: a polyline one pixel wide (Bresenham between rounded points), every pixel dabbed.
function ink(put, points, value, core, glow, keep = () => true) {
  const stamp = (x, y) => dab(put, x, y, value, core, glow, keep);
  for (let k = 0; k + 1 < points.length; k++) traceLine(round(points[k][0]), round(points[k][1]), round(points[k + 1][0]), round(points[k + 1][1]), stamp);
  if (points.length === 1) stamp(round(points[0][0]), round(points[0][1]));
}

// A jagged path from a to b: midpoint displacement across the straight line, `jag` times each piece's length at most.
function zigzag(ax, ay, bx, by, segment, jag, salt) {
  const dx = bx - ax, dy = by - ay, length = Math.sqrt(dx * dx + dy * dy) || 1, px = -dy / length, py = dx / length;
  let n = 1;
  while (length / n > segment && n < 64) n *= 2;
  const offset = new Float64Array(n + 1);
  for (let step = n; step > 1; step /= 2) for (let i = step / 2; i < n; i += step) {
    offset[i] = (offset[i - step / 2] + offset[i + step / 2]) / 2 + (random(salt, step, i) - 0.5) * jag * length * step / n;
  }
  return Array.from({ length: n + 1 }, (_, i) => [ax + dx * i / n + px * offset[i], ay + dy * i / n + py * offset[i]]);
}

// A smooth curve through 2–8 points (uniform Catmull-Rom, its ends continued straight), as a polyline of about
// one-pixel steps with the distance along it at every point.
function spline(points) {
  const n = points.length - 1, out = [points[0]], beyond = (a, b) => [2 * a[0] - b[0], 2 * a[1] - b[1]];
  for (let i = 0; i < n; i++) {
    const p0 = i ? points[i - 1] : beyond(points[0], points[1]), p1 = points[i], p2 = points[i + 1], p3 = i + 2 <= n ? points[i + 2] : beyond(points[n], points[n - 1]);
    const chord = Math.sqrt((p2[0] - p1[0]) * (p2[0] - p1[0]) + (p2[1] - p1[1]) * (p2[1] - p1[1])), steps = Math.max(2, Math.ceil(chord));
    const f = (a, b, c, d, t) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
    for (let k = 1; k <= steps; k++) { const t = k / steps; out.push([f(p0[0], p1[0], p2[0], p3[0], t), f(p0[1], p1[1], p2[1], p3[1], t)]); }
  }
  const lengths = [0];
  for (let k = 1; k < out.length; k++) { const dx = out[k][0] - out[k - 1][0], dy = out[k][1] - out[k - 1][1]; lengths.push(lengths[k - 1] + Math.sqrt(dx * dx + dy * dy)); }
  return { points: out, lengths };
}

const PAINTERS = {
  // A shockwave: a crisp leading edge at `radius` that fades inward over `width`, an optional glow filling the inside,
  // and seeded angular noise that breaks the band up.
  ring(layer, s, put, W, H) {
    const R = sample(layer.radius, s.q), w = Math.max(0.5, sample(layer.width, s.q)), fill = sample(layer.fill, s.q), rn = maxKey(layer.radius);
    paintArea(put, W, H, s.cx, s.cy, R * s.frame.reach + 2, s.frame, (u, v) => {
      const d = Math.sqrt(u * u + v * v);
      let value = 0;
      if (d >= R) value = 1 - (d - R) / 0.75;
      else {
        const k = (R - d) / w;
        if (k <= 1) value = 1 - 0.85 * k;
        if (fill > 0 && R > w) value = Math.max(value, fill * (0.5 + 0.5 * d / (R - w)));
      }
      if (layer.noise > 0 && value > 0 && d > 0) value *= 1 - layer.noise * layer.noiseAt(256 + u / d * rn, 256 + v / d * rn);
      return value;
    });
  },
  // A crescent whose outer edge is a crisp arc at `radius`: the head sweeps `arc` over the first `reveal` share of the
  // frames and the tail chases it over the rest, the band thickest mid-arc and pointed at both ends, brightest at the
  // outer edge and dimming toward the tail.
  slash(layer, s, put, W, H) {
    const R = sample(layer.radius, s.q), w = sample(layer.width, s.q), [from, to] = layer.arc, span = Math.abs(to - from), clockwise = to > from;
    const head = layer.reveal ? ease('out', clamp01(s.end / layer.reveal)) : 1, tail = layer.reveal < 1 ? clamp01((s.p - layer.reveal) / (1 - layer.reveal)) : 0;
    paintArea(put, W, H, s.cx, s.cy, R * s.frame.reach + 2, s.frame, (u, v) => {
      const d = Math.sqrt(u * u + v * v), inside = R - d;
      if (inside < -0.5 || inside > w + 0.5) return 0;
      const theta = atan2Deg(v, u);
      let a = (clockwise ? theta - from : from - theta) % 360;
      if (a < 0) a += 360;
      const along = a / span;
      if (along > head || along < tail || along > 1) return 0;
      const thickness = w * Math.sqrt(4 * along * (1 - along)) * clamp01((head - along) / 0.12) * clamp01((along - tail) / 0.25);
      // Brightest at the head, dimmer toward the tail; brightest on the outer edge, dimmer toward the inner one.
      const lead = head > tail ? 0.5 + 0.5 * (along - tail) / (head - tail) : 1;
      if (inside <= 0.5) return lead;
      return inside <= thickness ? lead * (1 - 0.6 * inside / Math.max(thickness, 1)) : 0;
    });
  },
  // A straight beam from `at` to `to`: the head shoots out over the first `reveal` share, the width ripples with
  // travelling waves, and the value falls from 1 on the axis to 0 at the edge, with round caps, and by `fade` from the
  // origin to the far end (a pillar of light that thins out upward). `squash` and `tilt` shape the caps alone, so a
  // pillar given its circle's squash stands on a foot that lies on the same ground.
  beam(layer, s, put, W, H) {
    const ax = s.cx, ay = s.cy, bx = layer.to[0] + s.dx, by = layer.to[1] + s.dy, ex = bx - ax, ey = by - ay, L = Math.sqrt(ex * ex + ey * ey) || 1;
    const ux = ex / L, uy = ey / L, w = sample(layer.width, s.q) / 2, head = (layer.reveal ? ease('out', clamp01(s.end / layer.reveal)) : 1) * L;
    if (w <= 0) return;
    const half = along => Math.max(0.6, w * (1 + layer.wobble * sinDeg(360 * (along / layer.wavelength - layer.waves * s.p))));
    const [sx, sy] = layer.squash, c = cosDeg(layer.tilt), sn = sinDeg(layer.tilt);
    const cap = (px, py) => { const u = (px * c + py * sn) / sx, v = (-px * sn + py * c) / sy; return Math.sqrt(u * u + v * v); };
    const margin = w * (1 + layer.wobble) * s.frame.reach + 2;
    const x0 = Math.max(0, Math.floor(Math.min(ax, ax + ux * head) - margin)), x1 = Math.min(W - 1, Math.ceil(Math.max(ax, ax + ux * head) + margin));
    const y0 = Math.max(0, Math.floor(Math.min(ay, ay + uy * head) - margin)), y1 = Math.min(H - 1, Math.ceil(Math.max(ay, ay + uy * head) + margin));
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
      const dx = i - ax, dy = j - ay, along = dx * ux + dy * uy;
      let distance, hw;
      if (along < 0) { distance = cap(dx, dy); hw = half(0); }
      else if (along > head) { distance = cap(i - (ax + ux * head), j - (ay + uy * head)); hw = half(head); }
      else { distance = Math.abs(dx * uy - dy * ux); hw = half(along); }
      if (distance < hw) put(i, j, (1 - distance / hw) * (1 - layer.fade * clamp01(along / L)));
    }
  },
  // Lightning: a jagged one-pixel core from `at` to `to` with a glow, seeded branches that dim toward their ends, and
  // a new path every `reroll` frames.
  bolt(layer, s, put) {
    const roll = layer.reroll ? Math.floor(s.k / layer.reroll) : 0, ax = s.cx, ay = s.cy, bx = layer.to[0] + s.dx, by = layer.to[1] + s.dy;
    const core = (Math.max(1, sample(layer.width, s.q)) - 1) / 2, glow = sample(layer.glow, s.q);
    const main = zigzag(ax, ay, bx, by, layer.segment, layer.jag, hash(layer.seed, roll, 1));
    const shown = layer.reveal ? Math.max(1, Math.ceil(ease('out', clamp01(s.end / layer.reveal)) * (main.length - 1))) : main.length - 1;
    ink(put, main.slice(0, shown + 1), 1, core, glow);
    const heading = atan2Deg(by - ay, bx - ax), length = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
    // Branch roots spread evenly down the bolt with seeded jitter, turning to alternate sides, so they never bunch.
    const side = random(layer.seed, roll, 0) < 0.5 ? -1 : 1;
    for (let b = 0; b < layer.branches; b++) {
      const r = salt => random(layer.seed, roll, b, salt), root = Math.floor((main.length - 1) * (0.12 + 0.66 * (b + r(1)) / layer.branches));
      if (root > shown) continue;
      const turn = (32 + 33 * r(2)) * (b % 2 ? -side : side), reach = length * (0.18 + 0.22 * r(4)), [rx, ry] = main[root];
      const path = zigzag(rx, ry, rx + cosDeg(heading + turn) * reach, ry + sinDeg(heading + turn) * reach, layer.segment * 0.75, layer.jag * 1.2, hash(layer.seed, roll, b, 2));
      for (let k = 0; k + 1 < path.length; k++) ink(put, [path[k], path[k + 1]], 0.85 - 0.35 * k / path.length, Math.max(0, core - 0.5), glow * 0.75);
    }
  },
  // A magic circle drawn in one-pixel ink: an outer ring (doubled on request), an inner ring, seeded upright runes
  // between them that travel round with `spin`, and an optional star polygon inside that turns the other way. It draws
  // on clockwise from the top over the first `reveal` share of the frames.
  glyph(layer, s, put, W, H) {
    const R = sample(layer.radius, s.q), Ri = R * layer.inner, spin = sample(layer.spin, s.q), glow = sample(layer.glow, s.q), fill = sample(layer.fill, s.q);
    const sweep = layer.reveal ? 360 * clamp01(s.end / layer.reveal) : 360;
    const keep = sweep >= 360 ? () => true : (x, y) => { const [u, v] = s.frame.local(x, y); let a = atan2Deg(v, u) + 90; if (a >= 360) a -= 360; return a <= sweep; };
    const toScreen = ([u, v]) => s.frame.screen(u, v);
    // A circle of local radius r, drawn `inset` screen pixels inside itself along its screen normal, so a doubled ring
    // stays two pixels apart all round even when squashed.
    const [sx, sy] = layer.squash, c = cosDeg(layer.tilt), sn = sinDeg(layer.tilt);
    const circle = (r, inset = 0) => {
      const n = Math.max(16, Math.ceil(2 * PI * r * s.frame.reach / 2.5));
      return Array.from({ length: n + 1 }, (_, i) => {
        const cos = cosDeg(360 * i / n), sin = sinDeg(360 * i / n), [x, y] = toScreen([cos * r, sin * r]);
        if (!inset) return [x, y];
        const nx = cos / sx, ny = sin / sy, length = Math.sqrt(nx * nx + ny * ny);
        return [x - inset * (nx * c - ny * sn) / length, y - inset * (nx * sn + ny * c) / length];
      });
    };
    if (fill > 0) paintArea(put, W, H, s.cx, s.cy, R * s.frame.reach + 1, s.frame, (u, v, i, j) => (u * u + v * v < (R - 0.5) * (R - 0.5) && keep(i, j) ? fill : 0));
    ink(put, circle(R), 1, 0, glow, keep);
    if (layer.double) ink(put, circle(R, 2), 0.85, 0, glow, keep);
    ink(put, circle(Ri), 0.9, 0, glow, keep);
    // Runes sit halfway across the band between the rings, upright, each a seeded mark.
    const middle = (R + Ri) / 2;
    for (let k = 0; k < layer.runes; k++) {
      const theta = spin + 360 * k / layer.runes - 90, [x, y] = toScreen([cosDeg(theta) * middle, sinDeg(theta) * middle]), X = round(x), Y = round(y);
      RUNES[hash(layer.seed, k) % RUNES.length].forEach((row, j) => { for (let i = 0; i < 3; i++) if (row[i] === 'x') dab(put, X + i - 1, Y + j - 1, 0.8, 0, glow, keep); });
    }
    if (layer.points) {
      const corner = i => { const theta = -spin + 360 * i / layer.points - 90; return toScreen([cosDeg(theta) * Ri, sinDeg(theta) * Ri]); };
      for (let i = 0; i < layer.points; i++) ink(put, [corner(i), corner((i + layer.step) % layer.points)], 0.7, 0, glow, keep);
    }
  },

  // An impact star: `points` spikes, every other one `ratio` as long, tapering from `width` to a one-pixel point and
  // dimming toward their tips, around a bright core disc.
  star(layer, s, put, W, H) {
    const R = sample(layer.radius, s.q), w = sample(layer.width, s.q), C = sample(layer.core, s.q), turn = layer.angle + sample(layer.spin, s.q);
    const spikes = Array.from({ length: layer.points }, (_, k) => {
      const theta = turn + 360 * k / layer.points;
      return [cosDeg(theta), sinDeg(theta), R * (k % 2 ? layer.ratio : 1) * (1 - layer.jitter * random(layer.seed, k))];
    });
    paintArea(put, W, H, s.cx, s.cy, R * s.frame.reach + 2, s.frame, (u, v) => {
      const d = Math.sqrt(u * u + v * v);
      let value = C > 0 && d <= C ? 1 - 0.25 * d / C : 0;
      for (const [cx, cy, L] of spikes) {
        const along = u * cx + v * cy;
        if (along <= 0 || along >= L) continue;
        const across = Math.abs(u * cy - v * cx), half = Math.max(0.5, w * (1 - along / L));
        if (across <= half) value = Math.max(value, (1 - 0.7 * along / L) * (1 - 0.5 * across / half));
      }
      return value;
    });
  },
  // A fireball: a disc whose edge and inside are broken by seeded smooth noise that boils outward over the frames, hot
  // in the middle, with a hole that can open from the centre (`hole`, a share of the radius) as it burns out.
  burst(layer, s, put, W, H) {
    const R = sample(layer.radius, s.q), hole = sample(layer.hole, s.q) * R, shift = layer.boil * s.q, n = layer.noise;
    if (R <= 0) return;
    paintArea(put, W, H, s.cx, s.cy, R * (1 + n / 2) * s.frame.reach + 2, s.frame, (u, v) => {
      const d = Math.sqrt(u * u + v * v), pull = d > 0 ? Math.max(0, d - shift) / d : 0;
      const noise = n > 0 ? layer.noiseAt(256 + u * pull, 256 + v * pull) - 0.5 : 0;
      let value = 1 - d / (R * (1 + n * noise)) + n * 0.35 * noise;
      if (hole > 0) value *= clamp01((d - hole * (1 + n * noise)) / Math.max(1, 0.35 * R));
      return value;
    });
  },
  // A tapered body of water (or anything that flows): the part of a smooth curve between `tail` and `head` (shares of
  // its length), `width` across at most, narrowing by `taper` from tail to head, brightest on its centre line, and
  // swaying sideways in travelling waves that grow toward the far end. Head and tail count to the end of each frame,
  // as reveals do.
  stream(layer, s, put) {
    const { points, lengths } = layer.curve, L = lengths[lengths.length - 1], at = ease(layer.ease, s.end);
    const tail = clamp01(sample(layer.tail, at)) * L, head = clamp01(sample(layer.head, at)) * L, span = head - tail, w = sample(layer.width, s.q) / 2;
    if (span < 0.5 || w <= 0) return;
    let k = 0;
    for (let d = tail; d <= head + 1e-9; d += 0.5) {
      while (k < lengths.length - 2 && lengths[k + 1] < d) k++;
      const a = points[k], b = points[k + 1], piece = lengths[k + 1] - lengths[k] || 1, f = (d - lengths[k]) / piece, tx = (b[0] - a[0]) / piece, ty = (b[1] - a[1]) / piece;
      let x = a[0] + (b[0] - a[0]) * f + s.dx, y = a[1] + (b[1] - a[1]) * f + s.dy;
      if (layer.sway) { const off = layer.sway * (d / L) * sinDeg(360 * (d / layer.wavelength - layer.waves * s.p)); x -= ty * off; y += tx * off; }
      // Each step stamps a cone a little wider than its half width, so even a one-pixel tip keeps its pixels.
      const hw = Math.max(0.6, w * sample(layer.taper, (d - tail) / span)) + 0.5, reach = Math.ceil(hw);
      const X = round(x), Y = round(y);
      for (let j = Y - reach; j <= Y + reach; j++) for (let i = X - reach; i <= X + reach; i++) {
        const dx = i - x, dy = j - y, dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < hw) put(i, j, 1 - dist / hw);
      }
    }
  }
};

// The look's field at (x, y), between pixels, zero off the canvas.
function between(field, width, height, x, y) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const v = (a, b) => (a >= 0 && b >= 0 && a < width && b < height ? field[b * width + a] : 0);
  return (v(i, j) * (1 - fx) + v(i + 1, j) * fx) * (1 - fy) + (v(i, j + 1) * (1 - fx) + v(i + 1, j + 1) * fx) * fy;
}
function band(value, thresholds) {
  let level = 0;
  while (level < thresholds.length && value >= thresholds[level]) level++;
  return level;
}

/**
 * The shape grid for frame `f`: { x, y, rows } cropped to its drawn pixels, or null. `blobs` are this frame's blob
 * particles, { look, x, y, radius }: each adds a soft disc, (1 − d²/r²)², to its look's field, so drops that touch merge
 * into one body.
 */
export function renderShapes(shapes, f, width, height, blobs = []) {
  const N = width * height, chars = new Uint16Array(N), owner = new Uint8Array(N);
  let drawn = false;
  shapes.looks.forEach((look, lookIndex) => {
    const field = new Float64Array(N), scratch = new Float64Array(N);
    let any = false;
    for (const layer of shapes.layers) {
      if (layer.look !== look.name || f < layer.t0 || f >= layer.t1) continue;
      const k = f - layer.t0, p = k / (layer.t1 - layer.t0), q = ease(layer.ease, p);
      const power = sample(layer.power, q) * (layer.flicker && k % 2 ? 1 - layer.flicker : 1);
      if (power <= 0) continue;
      const dx = layer.drift[0] * q, dy = layer.drift[1] * q, cx = layer.at[0] + dx, cy = layer.at[1] + dy;
      scratch.fill(0);
      // A floor cuts the layer off below its row: a disc becomes a dome, a ring an arch.
      const bottom = layer.floor === null ? height - 1 : Math.min(height - 1, Math.floor(layer.floor));
      const put = (i, j, value) => { if (i >= 0 && j >= 0 && i < width && j <= bottom) { const c = j * width + i; if (value > scratch[c]) scratch[c] = value; } };
      // Reveals measure to the end of the frame, so the first frame of a window already shows the shape under way.
      PAINTERS[layer.kind](layer, { k, p, end: (k + 1) / (layer.t1 - layer.t0), q, cx, cy, dx, dy, frame: frameOf(layer, cx, cy) }, put, width, height);
      for (let c = 0; c < N; c++) {
        let value = scratch[c] * power;
        if (value <= 0) continue;
        if (layer.grain) value *= 1 - layer.noise * layer.grain(256 + (c % width) - round(dx), 256 + Math.floor(c / width) - round(dy));
        field[c] = layer.blend === 'add' ? field[c] + value : Math.max(field[c], value);
        any = true;
      }
    }
    for (const blob of blobs) {
      if (blob.look !== look.name) continue;
      const r = blob.radius, r2 = r * r;
      const x0 = Math.max(0, Math.ceil(blob.x - r)), x1 = Math.min(width - 1, Math.floor(blob.x + r)), y0 = Math.max(0, Math.ceil(blob.y - r)), y1 = Math.min(height - 1, Math.floor(blob.y + r));
      for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
        const dx = i - blob.x, dy = j - blob.y, d2 = dx * dx + dy * dy;
        if (d2 >= r2) continue;
        const k = 1 - d2 / r2;
        field[j * width + i] += k * k;
        any = true;
      }
    }
    if (!any) return;
    const { thresholds, gaps, codes, dither, threshold, lit, shade, light: [lx, ly] } = look;
    for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
      const c = j * width + i, value = field[c];
      if (value < thresholds[0] - dither * gaps[0]) continue;
      const feather = (1 - threshold(i, j)) * dither;
      let level = 0;
      while (level < thresholds.length && value >= thresholds[level] - feather * gaps[level]) level++;
      if (!level) continue;
      let code = codes[level - 1];
      // Lit and shade bands recolour the look's own pixels by how far its field falls two pixels toward the light
      // (and away from it): a highlight on the rim that faces the light, a shadow side opposite.
      if (shade) { const s = band(1 - between(field, width, height, i - 2 * lx, j - 2 * ly) / value, shade.thresholds); if (s) code = shade.codes[s - 1]; }
      if (lit) { const s = band(1 - between(field, width, height, i + 2 * lx, j + 2 * ly) / value, lit.thresholds); if (s) code = lit.codes[s - 1]; }
      chars[c] = code; owner[c] = lookIndex + 1; drawn = true;
    }
  });
  if (!drawn) return null;
  if (shapes.cleanup.strays || shapes.cleanup.corners) for (const change of cleanupIds(chars, width, height, shapes.cleanup)) chars[change.index] = change.id;
  // Each look's outline takes the empty pixels beside its own, in look order.
  const filled = Uint8Array.from(owner);
  shapes.looks.forEach((look, lookIndex) => {
    if (!look.outline) return;
    const mine = lookIndex + 1;
    for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
      const c = j * width + i;
      if (chars[c]) continue;
      if ((i > 0 && filled[c - 1] === mine) || (i < width - 1 && filled[c + 1] === mine) || (j > 0 && filled[c - width] === mine) || (j < height - 1 && filled[c + width] === mine)) chars[c] = look.outline;
    }
  });
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) if (chars[j * width + i]) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
  if (x1 < 0) return null;
  const rows = [];
  for (let j = y0; j <= y1; j++) {
    let row = '';
    for (let i = x0; i <= x1; i++) { const code = chars[j * width + i]; row += code ? String.fromCharCode(code) : '.'; }
    rows.push(row);
  }
  return { x: x0, y: y0, rows };
}
