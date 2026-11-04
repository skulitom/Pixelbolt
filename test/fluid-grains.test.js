import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderProject } from '../src/core.js';
import { compileFluid, PixelError } from '../src/index.js';

// Grains (`granular`, docs/physics-model.md section 10a): sand that holds its repose, lands dead and comes to rest.
const example = async name => JSON.parse(await readFile(new URL(`../examples/${name}.fluid.json`, import.meta.url), 'utf8'));
const liquid = (effect, extra = {}) => ({ format: 'pixelforge-fluid', version: 1, name: 'grains', width: 48, height: 32, palette: { b: '#d1a457', g: '#333333' },
  symbols: { ground: ['g'.repeat(48), 'g'.repeat(48)] }, ...extra,
  effects: { grains: { kind: 'liquid', frames: 24, seed: 3, walls: ['left', 'right', 'bottom'], obstacles: [{ symbol: 'ground', x: 0, y: 30 }], emitters: [], fill: [{ x: 4, y: 20, w: 8, h: 10 }], look: [{ field: 'density', colors: ['b'], thresholds: [0.5], dither: 0 }], ...effect } } });
const refused = (source, path, pattern) => assert.throws(() => compileFluid(source), error => error instanceof PixelError && error.path === `fluid.${path}` && pattern.test(error.message), path);
const changed = (a, b) => { let n = 0; for (let i = 0; i < a.data.length; i += 4) if (a.data[i] !== b.data[i] || a.data[i + 3] !== b.data[i + 3]) n++; return n; };
// The height of what the effect drew in each column of a frame, above row `floor`.
const heights = (frame, width, floor) => Array.from({ length: width }, (_, x) => { for (let y = 0; y < floor; y++) if (frame.data[(y * width + x) * 4 + 3]) return floor - y; return 0; });

test('grains are a liquid\'s, with friction in place of a yield stress, heat or air', () => {
  refused(liquid({ kind: 'gas', granular: {}, fill: undefined, emitters: [{ at: [8, 8], radius: 2, rate: 1 }] }), 'effects.grains.granular', /applies to liquids/);
  refused(liquid({ granular: {}, yield: 2 }), 'effects.grains.yield', /friction/);
  refused(liquid({ granular: {}, heat: {} }), 'effects.grains.heat', /neither freeze nor boil/);
  refused(liquid({ granular: {}, air: { stiffness: 40 } }), 'effects.grains.air', /air passes through sand/);
  refused(liquid({ granular: {}, keys: [{ frame: 4, yield: 2 }] }), 'effects.grains.keys', /friction/);
  refused(liquid({ granular: { repose: 50 } }), 'effects.grains.granular.repose', /5.*45/);
  refused(liquid({ granular: { cohesion: -1 } }), 'effects.grains.granular.cohesion', /0.*8/);
  refused(liquid({ granular: { slope: 30 } }), 'effects.grains.granular.slope', /unknown/);
  assert.doesNotThrow(() => compileFluid(liquid({ granular: { repose: 20, cohesion: 1 } })));
});

// A settled bed's gravity is tilted 55 degrees, so its surface stands 55 degrees off level: it avalanches down to its
// repose, and the angle its surface keeps to the new level is the angle the grains hold.
test('a tilted bed avalanches down to its repose and holds it', () => {
  const tilt = 55, rad = tilt * Math.PI / 180, width = 64, height = 48;
  for (const repose of [20, 33]) {
    const source = { format: 'pixelforge-fluid', version: 1, name: 'tilt', width, height, palette: { b: '#d1a457' },
      effects: { tilt: { kind: 'liquid', frames: 90, seed: 5, walls: ['left', 'right', 'bottom'], apic: true, granular: { repose }, gravity: [0, 0.3],
        keys: [{ frame: 8, gravity: [Number((0.3 * Math.sin(rad)).toFixed(4)), Number((0.3 * Math.cos(rad)).toFixed(4))], over: 12 }],
        fill: [{ x: 0, y: height - 16, w: width, h: 16 }], emitters: [], look: [{ field: 'density', colors: ['b'], thresholds: [0.5], dither: 0 }] } } };
    const frames = renderProject(compileFluid(source).recipe).frames, h = heights(frames[frames.length - 1], width, height);
    const xs = h.map((_, x) => x).filter(x => x > 4 && x < width - 5), mx = xs.reduce((a, b) => a + b) / xs.length, my = xs.reduce((a, x) => a + h[x], 0) / xs.length;
    const slope = xs.reduce((a, x) => a + (x - mx) * (h[x] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0), held = tilt - Math.atan(slope) * 180 / Math.PI;
    assert.ok(Math.abs(held - repose) <= 4, `repose ${repose}: the surface holds ${held.toFixed(1)} degrees`);
    let still = 0;
    for (let k = frames.length - 8; k < frames.length; k++) still += changed(frames[k - 1], frames[k]);
    assert.ok(still <= 12, `repose ${repose}: ${still} pixels still changing over the last 8 frames`);
  }
});

test('a stream of grains lands dead and builds a heap where water spreads thin', () => {
  const pour = granular => { const width = 48, floor = 30, source = liquid({ frames: 48, tension: 0, fill: undefined, ...(granular && { granular }), emitters: [{ at: [24, 6], radius: 1.5, rate: 1, velocity: [0, 0.5], end: 36 }] });
    const frames = renderProject(compileFluid(source).recipe).frames, h = heights(frames[frames.length - 1], width, floor);
    return { peak: Math.max(...h), width: h.filter(Boolean).length }; };
  const water = pour(null), sand = pour({ repose: 33 });
  assert.ok(sand.peak >= water.peak + 2 && sand.width * 3 <= water.width * 2, `sand ${JSON.stringify(sand)}, water ${JSON.stringify(water)}`);
});

test('the sand presets: the hourglass drains into its bottom bulb, the gate\'s heap stops, the plough banks sand ahead', async () => {
  const hourglass = await example('hourglass'), frames = renderProject(compileFluid(hourglass).recipe).frames, last = frames[frames.length - 1], W = hourglass.width;
  const glass = new Set(['g', 'w', 'W'].map(key => hourglass.palette[key].toLowerCase())), hex = (d, i) => '#' + [d[i], d[i + 1], d[i + 2]].map(v => v.toString(16).padStart(2, '0')).join('');
  let top = 0, bottom = 0;
  for (let y = 2; y < hourglass.height - 2; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (last.data[i + 3] && !glass.has(hex(last.data, i))) { if (y < 28) top++; else bottom++; } }
  assert.ok(bottom > 300 && top <= 4, `the hourglass ends with ${top} sand pixels above the neck and ${bottom} below`);

  const gate = renderProject(compileFluid(await example('sand-gate')).recipe).frames;
  let moving = 0;
  for (let k = gate.length - 16; k < gate.length; k++) moving += changed(gate[k - 1], gate[k]);
  assert.ok(moving <= 16, `the gate's heap still changes ${moving} pixels over its last 16 frames`);
  const ramp = heights(gate[gate.length - 1], 64, 37);
  assert.ok(ramp[2] >= 20 && ramp[2] > ramp[12] && ramp[12] > ramp[22] && ramp[40] === 0, `the ramp is ${ramp.join(' ')}`);

  const plough = await example('sand-plough'), ploughed = renderProject(compileFluid(plough).recipe).frames, end = heights(ploughed[ploughed.length - 1], plough.width, plough.height - 3);
  const ahead = Math.max(...end.slice(50)), behind = Math.max(...end.slice(0, 40));
  assert.ok(ahead >= 10 && ahead > 2 * behind, `ahead of the blade ${ahead}, behind it ${behind}`);
});

test('grains leave every other liquid as it was: tension still defaults to 0.5 without them', () => {
  const plain = liquid({}), grains = liquid({ granular: {} });
  assert.notDeepEqual(compileFluid(plain).recipe, compileFluid(liquid({ tension: 0 })).recipe);
  assert.deepEqual(compileFluid(grains).recipe, compileFluid(liquid({ granular: {}, tension: 0 })).recipe);
});
