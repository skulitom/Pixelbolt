import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareScene, renderScene } from '../src/scene.js';
import { compileAutotile } from '../src/authoring.js';
import { templatePiece } from '../src/autotile.js';

const tiles = { version: 1, name: 'tiles', width: 2, height: 2, palette: { a: '#f00', b: '#0f0', c: '#00f' }, frames: [
  { name: 'red', ops: [{ op: 'rect', w: 2, h: 2, color: 'a' }] }, { name: 'green', ops: [{ op: 'rect', w: 2, h: 2, color: 'b' }] },
  { name: 'blue', duration: 100, ops: [{ op: 'rect', w: 2, h: 2, color: 'c' }] }, { name: 'blue2', duration: 100, ops: [{ op: 'rect', w: 1, h: 2, color: 'c' }] }
], animations: { pulse: { frames: ['blue', 'blue2'] } } };
const scene = (instances, extra = {}) => ({ format: 'pixelforge-scene', version: 1, name: 'map', width: 8, height: 6, background: '#000', assets: { tiles }, instances, ...extra });
const at = (view, x, y) => [...view.data.subarray((y * view.width + x) * 4, (y * view.width + x) * 4 + 4)];

test('tilemap placements expand a character map into frames, variants and animations as one declaration', () => {
  const prepared = prepareScene(scene([{ name: 'ground', asset: 'tiles', at: [0, 0], tilemap: { rows: ['rg.p', 'vvvv'], legend: { r: 'red', g: { frame: 'green' }, p: { animation: 'pulse' }, v: { frames: ['red', 'green'] } } } }]));
  const first = renderScene(prepared, { time: 0 }), later = renderScene(prepared, { time: 150 });
  assert.deepEqual([at(first, 0, 0), at(first, 2, 0), at(first, 4, 0)], [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 0, 255]]);
  assert.deepEqual([at(first, 7, 0), at(later, 7, 0)], [[0, 0, 255, 255], [0, 0, 0, 255]]);
  const variants = new Set([0, 2, 4, 6].map(x => at(first, x, 2).join()));
  assert.equal(variants.size, 2); // Deterministic, position-based variants mix both frames.
  assert.deepEqual(renderScene(prepared, { time: 0 }).data, first.data);
  assert.deepEqual(first.placements, [{ name: 'ground', tilemap: true, x: 0, y: 0, w: 8, h: 4, tiles: 7, scale: 1 }]);
  assert.throws(() => prepareScene(scene([{ asset: 'tiles', at: [0, 0], tilemap: { rows: ['rx'], legend: { r: 'red' } } }])), /tilemap\.rows\[0\]\[1\]: character "x" is not in the legend/);
  assert.throws(() => prepareScene(scene([{ asset: 'tiles', at: [0, 0], frame: 'red', tilemap: { rows: ['r'], legend: { r: 'red' } } }])), /choose frames through their legend/);
  assert.throws(() => prepareScene(scene([{ asset: 'tiles', at: [0, 0], tilemap: { rows: ['r'], legend: { r: 'missing' } } }])), /frame "missing" does not exist/);
});

test('autotile legends pick compiled blob tiles from each cell\'s neighbours', () => {
  // A 2px template where every piece is solid, so any mask renders; the check is that names resolve per cell.
  const rows = Array.from({ length: 6 }, () => 's'.repeat(4));
  const { recipe } = compileAutotile({ format: 'pixelforge-autotile', version: 1, name: 'sand', tile: 2, palette: { s: '#ccaa66' }, template: rows, frame: 'sand-{mask}' });
  const source = { format: 'pixelforge-scene', version: 1, name: 'isle', width: 8, height: 6, assets: { sand: recipe }, instances: [{ asset: 'sand', at: [0, 0], tilemap: { rows: ['.ss.', 'ssss', '.ss.'], legend: { s: { frame: 'sand-{mask}', autotile: 'blob' } } } }] };
  const view = renderScene(prepareScene(source));
  assert.deepEqual(at(view, 2, 2), [0xcc, 0xaa, 0x66, 255]);
  assert.equal(view.placements[0].tiles, 8);
  assert.throws(() => prepareScene({ ...source, instances: [{ ...source.instances[0], tilemap: { ...source.instances[0].tilemap, legend: { s: { frame: 'sand-0', autotile: 'blob' } } } }] }), /must contain \{mask\}/);
  assert.ok(templatePiece(2, 'br', 'i').every(Number.isInteger));
});

test('lighting scope "all" darkens plain assets too, and clipping names the placements', () => {
  const lit = { ambient: 0.25, bands: 4, lights: [] };
  const plain = renderScene(prepareScene(scene([{ asset: 'tiles', at: [0, 0], frame: 'red' }], { lighting: lit })));
  const all = renderScene(prepareScene(scene([{ asset: 'tiles', at: [0, 0], frame: 'red' }], { lighting: { ...lit, scope: 'all' } })));
  // Ambient is not banded: 0.25 of full red, not the nearest of four bands.
  assert.deepEqual([at(plain, 0, 0)[0], at(all, 0, 0)[0]], [255, 64]);
  assert.throws(() => prepareScene(scene([], { lighting: { scope: 'some' } })), /passes or all/);
  const clipped = renderScene(prepareScene(scene([{ name: 'edge', asset: 'tiles', at: [7, 5], frame: 'red' }, { asset: 'tiles', at: [-1, 0], frame: 'green' }])));
  assert.deepEqual(clipped.clipped, { edge: 3, 'tiles#1': 2 });
  assert.match(clipped.warnings.at(-1), /5 drawn pixels clipped at scene bounds \(edge 3, tiles#1 2\)/);
});

test('banded lighting keeps a coloured light\'s hue: channels change band together', () => {
  // A warm light over a flat grey floor. Each ring must be one colour (ambient + band x light colour); banding each
  // channel separately used to produce more distinct colours than bands, visible as rainbow rings.
  const floor = { version: 1, name: 'floor', width: 64, height: 1, palette: { g: '#c0c0c0' }, frames: [{ name: 'f', ops: [{ op: 'rect', w: 64, h: 1, color: 'g' }] }] };
  const view = renderScene(prepareScene({ format: 'pixelforge-scene', version: 1, name: 'ring', width: 64, height: 1, assets: { floor }, instances: [{ asset: 'floor', at: [0, 0], frame: 'f' }],
    lighting: { ambient: 0.2, bands: 4, scope: 'all', lights: [{ at: [0, 0], height: 8, radius: 64, color: '#ffb060' }] } }));
  const colours = new Set(Array.from({ length: 64 }, (_, x) => at(view, x, 0).join()));
  assert.ok(colours.size <= 4, `${colours.size} colours for 4 bands`);
  for (const colour of colours) { const [r, g, b] = colour.split(',').map(Number); assert.ok(r >= g && g >= b, colour); }
});

test('null legend entries are context cells: matched by neighbours, never drawn', () => {
  const rows = Array.from({ length: 6 }, () => 's'.repeat(4));
  const { recipe } = compileAutotile({ format: 'pixelforge-autotile', version: 1, name: 'sand', tile: 2, palette: { s: '#ccaa66' }, template: rows, frame: 'sand-{mask}' });
  const source = legend => ({ format: 'pixelforge-scene', version: 1, name: 'window', width: 4, height: 2, assets: { sand: recipe }, instances: [{ asset: 'sand', at: [-2, 0], tilemap: { rows: ['Sss'], legend } }] });
  const withContext = prepareScene(source({ s: { frame: 'sand-{mask}', autotile: 'blob', match: 'sS' }, S: null }));
  assert.deepEqual(withContext.instances[0].tilemap.cells.map(cell => cell.frame), ['sand-68', 'sand-64']);
  assert.equal(renderScene(withContext).clipped, undefined); // The context cell sits off-canvas but is never drawn.
  assert.throws(() => prepareScene(source({ s: { frame: 'sand-{mask}', autotile: 'blob' } })), /character "S" is not in the legend/);
});

test('scene file and revision references must be resolved before rendering', () => {
  assert.throws(() => prepareScene(scene([], { assets: { tiles: 'tiles.json' } })), /resolved by the CLI and MCP/);
  assert.throws(() => prepareScene(scene([], { assets: { tiles: { revision: 'abc123abc123' } } })), /resolved by the CLI and MCP/);
});

test('anchor "frame" places each drawn frame by its own anchor, so animated placements follow per-frame anchors', () => {
  const hopper = { version: 1, name: 'hopper', width: 4, height: 4, palette: { a: '#f00' }, anchor: [1, 3], frames: [
    { name: 'stand', duration: 100, ops: [{ op: 'pixel', x: 1, y: 3, color: 'a' }] },
    { name: 'lean', duration: 100, anchor: [2, 3], ops: [{ op: 'pixel', x: 2, y: 3, color: 'a' }] }
  ], animations: { step: { frames: ['stand', 'lean'] } } };
  const placed = (anchor, time) => renderScene(prepareScene({ format: 'pixelforge-scene', version: 1, name: 'anchors', width: 8, height: 6, background: '#000', assets: { hopper },
    instances: [{ asset: 'hopper', at: [4, 4], animation: 'step', ...(anchor !== undefined && { anchor }) }] }), { time }).placements[0];
  // Each frame's anchor pixel lands on `at`, even though the anchor moves between frames.
  assert.deepEqual([placed('frame', 0).x, placed('frame', 150).x], [3, 2]);
  assert.deepEqual([placed([1, 3], 0).x, placed([1, 3], 150).x], [3, 3]);
  assert.deepEqual([placed(undefined, 0).x, placed(undefined, 0).y], [4, 4]);
  const plain = prepareScene(scene([{ name: 'loose', asset: 'tiles', at: [2, 2], frame: 'red', anchor: 'frame' }]));
  assert.match(plain.warnings.join(), /declares no anchors/);
  assert.throws(() => prepareScene(scene([{ asset: 'tiles', at: [0, 0], anchor: 'frame', tilemap: { rows: ['r'], legend: { r: 'red' } } }])), /tilemap is placed by one \[x, y\] anchor/);
});

// A 32 x 1 grey floor lit as a flat surface, and a lamp whose frame "a" names a wick and frame "b" does not.
const floor = { version: 1, name: 'floor', width: 32, height: 1, palette: { g: '#808080' }, frames: [{ name: 'f', ops: [{ op: 'rect', w: 32, h: 1, color: 'g' }] }] };
const lamp = { version: 1, name: 'lamp', width: 2, height: 1, palette: { y: '#ffff00' }, frames: [
  { name: 'a', points: { wick: [1, 0] }, ops: [{ op: 'pixel', x: 0, y: 0, color: 'y' }] }, { name: 'b', ops: [{ op: 'pixel', x: 0, y: 0, color: 'y' }] }],
  animations: { flicker: { frames: ['a', 'b'] } } };
const room = (lights, lampExtra = {}, extra = {}) => ({ format: 'pixelforge-scene', version: 1, name: 'room', width: 32, height: 1, duration: 400, background: '#000', assets: { floor, lamp },
  instances: [{ asset: 'floor', at: [0, 0], frame: 'f' }, { name: 'lamp', asset: 'lamp', at: [4, 0], frame: 'a', lit: false, trajectory: [{ time: 0, at: [4, 0] }, { time: 200, at: [24, 0] }], ...lampExtra }],
  lighting: { ambient: 0.2, bands: 4, scope: 'all', lights }, ...extra });
const red = (view, x) => at(view, x, 0)[0];

test('lights follow a placement or one of its frame points, and go out while it is hidden or lacks the point', () => {
  const following = prepareScene(room([{ follow: { instance: 'lamp' }, at: [0, -3], height: 6, radius: 12 }]));
  const views = [0, 100, 200].map(time => renderScene(following, { time }));
  assert.deepEqual(views.map(view => view.lights[0].at), [[4, -3], [14, -3], [24, -3]]);
  // The floor near the light is lit; the floor the lamp has left is back to ambient.
  assert.ok(red(views[1], 15) > red(views[1], 4));
  assert.equal(red(views[1], 4), Math.round(128 * 0.2));
  // lit: false keeps the lamp's own yellow, while the lit floor beside it is darkened.
  assert.deepEqual(at(views[1], 14, 0), [255, 255, 0, 255]);
  // A frame point: the wick of frame "a", plus the offset. Frame "b" has no wick, so the light is off.
  const wick = prepareScene(room([{ follow: { instance: 'lamp', point: 'wick' }, at: [0, -2] }], { trajectory: undefined, frame: undefined, animation: 'flicker' }));
  const on = renderScene(wick, { time: 0 }), off = renderScene(wick, { time: 100 });
  assert.deepEqual([on.lights[0].at, on.lights[0].strength, off.lights[0].strength], [[5, -2], 1, 0]);
  assert.equal(red(off, 20), Math.round(128 * 0.2));
  assert.equal(renderScene(prepareScene(room([{ follow: { instance: 'lamp' } }], { hidden: true }))).lights[0].strength, 0);
  // Without lighting in the preview there are no lights to report.
  assert.equal(renderScene(following, { lit: false }).lights, undefined);
});

test('flicker is seeded, swings both ways within its amount, differs per light and repeats once per scene duration', () => {
  const lights = [{ at: [8, -4], radius: 20, flicker: { amount: 0.4, every: 50 } }, { at: [24, -4], radius: 20, flicker: { amount: 0.4, every: 50 } }];
  const prepared = prepareScene(room(lights)), sample = time => renderScene(prepared, { time }).lights;
  const samples = Array.from({ length: 40 }, (_, k) => sample(k * 10)), first = samples.map(s => s[0].strength);
  // Strength stays within 1 ± 0.4 and reach within 20 ± 4, on both sides of the light's own values.
  assert.ok(samples.every(s => s.every(light => light.strength >= 0.6 && light.strength <= 1.4 && light.radius >= 16 && light.radius <= 24)), JSON.stringify(samples));
  assert.ok(first.some(s => s > 1.1) && first.some(s => s < 0.9), JSON.stringify(first));
  assert.ok(new Set(first).size > 5, 'the light changes over time');
  assert.notDeepEqual(first, samples.map(s => s[1].strength), 'each light flickers on its own');
  // The same time gives the same light, and the scene's end continues its start.
  assert.deepEqual(sample(130), sample(130));
  assert.deepEqual(sample(400), sample(0));
  const still = prepareScene(room(lights, { trajectory: undefined }));
  assert.deepEqual(renderScene(still, { time: 400 }).data, renderScene(still, { time: 0 }).data);
  assert.notDeepEqual(renderScene(still, { time: 60 }).data, renderScene(still, { time: 0 }).data);
  const reseeded = prepareScene(room([{ ...lights[0], flicker: { ...lights[0].flicker, seed: 9 } }]));
  assert.notDeepEqual(Array.from({ length: 40 }, (_, k) => renderScene(reseeded, { time: k * 10 }).lights[0].strength), first);
});

test('keyed strength and radius flash on cues, and strength above 1 lifts ramp-lit colours further', () => {
  const flash = { at: [16, -4], radius: 4, strength: 0, keys: [{ time: 'strike', strength: 0 }, { time: 'strike+40', strength: 3, radius: 20, ease: 'out' }, { time: 'strike+200' }] };
  const prepared = prepareScene(room([flash], {}, { cues: { strike: 150 } })), now = time => renderScene(prepared, { time }).lights[0];
  assert.deepEqual([0, 150, 190, 350, 399].map(time => [now(time).strength, now(time).radius]), [[0, 4], [0, 4], [3, 20], [0, 4], [0, 4]]);
  // From strike+40 to strike+200 the out ease falls fast, then settles: at the midpoint it is 7/8 of the way.
  assert.deepEqual([now(270).strength, now(270).radius], [0.38, 6]);
  // A light at strength 0 draws exactly what no light draws.
  assert.deepEqual(renderScene(prepared, { time: 100 }).data, renderScene(prepareScene(room([])), { time: 100 }).data);
  // Ramp lighting: ambient 0.5 is one step darker; strength 1 under the light one step lighter; strength 2 two.
  const stone = { version: 1, name: 'stone', width: 1, height: 1, palette: { a: '#101010', b: '#404040', c: '#808080', d: '#c0c0c0' }, ramps: [['a', 'b', 'c', 'd']], frames: [{ name: 'f', ops: [{ op: 'pixel', color: 'b' }] }] };
  const lift = strength => at(renderScene(prepareScene({ format: 'pixelforge-scene', version: 1, name: 'lift', width: 1, height: 1, assets: { stone }, instances: [{ asset: 'stone', at: [0, 0], frame: 'f' }],
    lighting: { mode: 'ramp', scope: 'all', ambient: 0.5, steps: 2, lights: [{ at: [0, 0], height: 4, radius: 8, strength }] } })), 0, 0)[0];
  assert.deepEqual([lift(0), lift(1), lift(2)], [0x10, 0x80, 0xc0]);
});

test('new light and placement fields fail early with paths', () => {
  const bad = (lights, path, message, lampExtra = {}) => assert.throws(() => prepareScene(room(lights, lampExtra)), error => error.path === path && (!message || message.test(error.message)), path);
  bad([{ follow: { instance: 'nobody' } }], 'scene.lighting.lights[0].follow.instance', /uniquely named/);
  bad([{ follow: { instance: 'lamp', point: 'tip' } }], 'scene.lighting.lights[0].follow.point', /no frame of lamp has a point named "tip"/);
  bad([{ radius: 8 }], 'scene.lighting.lights[0].at');
  bad([{ at: [0, 0], strength: 9 }], 'scene.lighting.lights[0].strength');
  bad([{ at: [0, 0], flicker: { every: 50 } }], 'scene.lighting.lights[0].flicker.amount');
  bad([{ at: [0, 0], flicker: { amount: 0.2, wobble: 1 } }], 'scene.lighting.lights[0].flicker.wobble');
  bad([{ at: [0, 0], keys: [] }], 'scene.lighting.lights[0].keys');
  bad([{ at: [0, 0], keys: [{ time: 100 }, { time: 100 }] }], 'scene.lighting.lights[0].keys', /increase strictly/);
  bad([{ at: [0, 0], keys: [{ time: 'boom' }] }], 'scene.lighting.lights[0].keys[0].time', /not in scene.cues/);
  bad([{ at: [0, 0], keys: [{ time: 0, ease: 'wobble' }] }], 'scene.lighting.lights[0].keys[0].ease');
  bad([{ at: [0, 0], color: 'glow' }], 'scene.lighting.lights[0].color');
  bad([], 'scene.instances[1].lit', /boolean/, { lit: 'no' });
  // A name two placements share cannot be followed.
  const twice = room([{ follow: { instance: 'lamp' } }]); twice.instances.push({ ...twice.instances[1] });
  assert.throws(() => prepareScene(twice), error => error.path === 'scene.lighting.lights[0].follow.instance');
});
