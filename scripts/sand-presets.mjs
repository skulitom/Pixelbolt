// Grain presets for examples/: sand (a liquid effect with `granular`), which holds a slope up to its repose, lands dead,
// avalanches and comes to rest. Each is an ordinary pixelforge-fluid source; scripts/generate-examples.js writes them as
// examples/<name>.fluid.json and showcase/fluid/build.mjs renders their GIFs.
const fluidSource = (name, width, height, palette, effect, symbols) => ({ format: 'pixelforge-fluid', version: 1, name, width, height, palette, symbols, effects: { [name]: effect } });
const shapeRows = (w, h, at) => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => at(x, y) ?? '.').join(''));

// Sand: a lit top band, the body, and a darker body deeper down, feathered in through seeded noise so the change reads as
// grain; the lit and shaded edges come from the light direction.
const sand = { a: '#f6dc9c', b: '#ddb46a', c: '#b8864a', d: '#8a5f34', o: '#5a3c22' };
const sandLook = [
  // A loose stream of falling grains is thinner than a full cell, so the body is drawn from a third of one.
  { field: 'density', colors: ['b'], thresholds: [0.35], dither: 0 },
  { field: 'depth', colors: ['c', 'd'], thresholds: [5, 11], dither: 0.9, pattern: 'noise' },
  { field: 'shadow', colors: ['c'], thresholds: [0.5], dither: 0 },
  { field: 'light', colors: ['a'], thresholds: [0.6], dither: 0 }
];

// Hourglass: a glass with two bulbs and a neck three pixels wide, its walls smooth so the sand slides down the funnel.
// The top bulb's surface sinks into a crater over the neck, a steady stream runs through it, and a heap builds in the
// bottom bulb. One-shot: it ends with the top bulb empty and the heap at rest.
const HW = 30, HH = 58, MID = 28;
const half = y => { // half the inside width of the glass at row y
  const t = Math.abs(y - MID);
  if (t <= 1) return 1.5;
  if (t <= 13) return 1.5 + (t - 1) * 0.88;
  return Math.min(12, 1.5 + 12 * 0.88 + (t - 13) * 0.5);
};
const glass = shapeRows(HW, HH, (x, y) => {
  if (y < 2 || y > HH - 3) return null;
  const h = half(y), d = Math.abs(x - (HW - 1) / 2);
  return d > h && d <= h + 1.2 ? 'g' : null;
});
const caps = shapeRows(HW, HH, (x, y) => (y < 2 || y > HH - 3 ? (y === 0 || y === HH - 1 ? 'W' : 'w') : null));
const topBulb = [];
for (let y = 6; y <= 20; y++) { const h = Math.floor(half(y)), c = Math.floor((HW - 1) / 2); topBulb.push({ x: c - h + 1, y, w: 2 * h, h: 1 }); }
const hourglass = fluidSource('hourglass', HW, HH, { ...sand, g: '#9fc2d8', w: '#7a4e2c', W: '#4f321c' }, {
  kind: 'liquid', frames: 120, duration: 60, seed: 4, walls: ['left', 'right', 'top', 'bottom'], granular: { repose: 33 },
  obstacles: [{ symbol: 'glass', x: 0, y: 0, surface: 'smooth' }, { symbol: 'caps', x: 0, y: 0 }],
  fill: topBulb, emitters: [], look: sandLook, outline: 'o', cleanup: { strays: true }
}, { glass, caps });

// Sand gate: a bin of dry sand held by a board that lifts. Water floods the floor (the dam-break preset); the grains
// slump into a ramp at their repose and stop within a few frames.
const GW = 64, GH = 40;
const sandGate = fluidSource('sand-gate', GW, GH, { ...sand, p: '#8a5a36', P: '#5a3825', G: '#4d4038', K: '#3a302a' }, {
  kind: 'liquid', frames: 64, duration: 60, seed: 5, walls: ['left', 'right', 'bottom'], granular: { repose: 33 },
  obstacles: [{ symbol: 'ground', x: 0, y: GH - 3 }, { symbol: 'board', x: 18, y: 9, keys: [{ frame: 6, y: -24, over: 8 }] }],
  fill: [{ x: 0, y: 11, w: 18, h: 26 }], emitters: [], look: sandLook, outline: 'o', cleanup: { strays: true }
}, { ground: shapeRows(GW, 3, (x, y) => (y ? 'K' : 'G')), board: shapeRows(2, 28, x => (x ? 'P' : 'p')) });

// Sand plough: a blade slides along the ground through a layer of sand and pushes it into a heap that grows in front of
// it, its face at the sand's repose; near the end the heap tops the blade and spills over behind it.
const LW = 72, LH = 40;
const sandPlough = fluidSource('sand-plough', LW, LH, { ...sand, p: '#9a9fa8', P: '#5d626b', h: '#3a3f47', G: '#4d4038', K: '#3a302a' }, {
  kind: 'liquid', frames: 80, duration: 60, seed: 7, walls: ['left', 'right', 'bottom'], granular: { repose: 33 },
  obstacles: [{ symbol: 'ground', x: 0, y: LH - 3 }, { symbol: 'blade', x: 2, y: LH - 19, keys: [{ frame: 4, x: 44, over: 52 }] }],
  fill: [{ x: 8, y: LH - 8, w: LW - 8, h: 5 }], emitters: [], look: sandLook, outline: 'o', cleanup: { strays: true }
}, { ground: shapeRows(LW, 3, (x, y) => (y ? 'K' : 'G')), blade: shapeRows(4, 16, (x, y) => (x === 3 ? 'P' : y < 2 ? 'h' : 'p')) });

export const sandPresets = { hourglass, 'sand-gate': sandGate, 'sand-plough': sandPlough };
