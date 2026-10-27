import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareScene, renderScene, withLightSettings } from '../src/scene.js';
import { startMCP } from '../src/mcp.js';

const root = fileURLToPath(new URL('../', import.meta.url));

// A lamp 10 pixels left of a post, 8 pixels up, so strong that every floor pixel it reaches is lit to the top of the
// stone ramp ('e') and every pixel it does not reach keeps only the ambient light ('a'). The post is one pixel wide and
// four tall, standing on row 20 at x 20; a pixel of its height k casts to t = 10k / (8 - k) pixels beyond its foot.
const stone = { a: '#101010', b: '#303030', c: '#505050', d: '#707070', e: '#909090' };
const floor = { version: 1, name: 'floor', width: 40, height: 32, palette: stone, ramps: [['a', 'b', 'c', 'd', 'e']], frames: [{ name: 'a', ops: [{ op: 'rect', w: 40, h: 32, color: 'c' }] }] };
const post = { version: 1, name: 'post', width: 1, height: 4, palette: { p: '#c03030' }, frames: [{ name: 'a', ops: [{ op: 'rect', w: 1, h: 4, color: 'p' }] }] };
// A post whose left column is four pixels tall and right column one: which way round its shadow falls.
const ell = { version: 1, name: 'ell', width: 2, height: 4, palette: { p: '#c03030' }, frames: [{ name: 'a', ops: [{ op: 'rect', w: 1, h: 4, color: 'p' }, { op: 'pixel', x: 1, y: 3, color: 'p' }] }] };
// A stone post on the floor's ramp, which shows whether it is lit.
const stele = { ...floor, name: 'stele', width: 1, height: 4, frames: [{ name: 'a', ops: [{ op: 'rect', w: 1, h: 4, color: 'c' }] }] };
// Two stone pixels, the left facing left and the right facing right, by their normal pass.
const slab = { recipe: { ...floor, name: 'slab', width: 2, height: 1, frames: [{ name: 'a', ops: [{ op: 'rect', w: 2, h: 1, color: 'c' }] }] },
  normal: { version: 1, name: 'slab-normal', width: 2, height: 1, palette: { l: '#008080', r: '#ff8080' }, frames: [{ name: 'a', ops: [{ op: 'pixel', x: 0, y: 0, color: 'l' }, { op: 'pixel', x: 1, y: 0, color: 'r' }] }] } };
const lamp = (instances, { light = {}, lighting = {}, ...scene } = {}) => ({
  format: 'pixelforge-scene', version: 1, name: 'lamp', width: 40, height: 32, background: '#000000',
  assets: { floor, post, ell, stele, slab },
  lighting: { mode: 'ramp', scope: 'all', ambient: 0.2, bands: 16, steps: 2, lights: [{ at: [10, 20], height: 8, radius: 96, strength: 8, ...light }], ...lighting },
  instances: [{ name: 'floor', asset: 'floor', at: [0, 0] }, ...instances], ...scene
});
const standing = (extra = {}) => ({ name: 'post', asset: 'post', at: [20, 20], anchor: [0, 3], shadow: true, ...extra });
// A row of the render as palette keys: stone keys, p for the post, . for anything else.
const keys = Object.fromEntries([...Object.entries(stone), ['p', '#c03030']].map(([key, hex]) => [hex.slice(1), key]));
const row = (view, y, x0 = 0, x1 = view.width) => Array.from({ length: x1 - x0 }, (_, i) => {
  const at = (y * view.width + x0 + i) * 4;
  return keys[[0, 1, 2].map(c => view.data[at + c].toString(16).padStart(2, '0')).join('')] ?? '.';
}).join('');
const column = (view, x, y0, y1) => Array.from({ length: y1 - y0 }, (_, i) => row(view, y0 + i, x, x + 1)).join('');
const render = (scene, options) => renderScene(prepareScene(scene), options);

test('a shadow stops the light where the post casts it, away from the light and as long as its height allows', () => {
  const view = render(lamp([standing()]));
  // Heights 0, 1, 1, 2, 2, 3, 3, 3 land at t = 0 to 7; height 4 would be past the post's top.
  assert.equal(row(view, 20), 'e'.repeat(20) + 'p' + 'a'.repeat(7) + 'e'.repeat(12));
  assert.equal(row(view, 19), 'e'.repeat(20) + 'p' + 'e'.repeat(19), 'a one-pixel cutout casts a one-pixel-wide shadow');
  assert.equal(row(view, 21), 'e'.repeat(40));
  assert.deepEqual(view.shadows, [{ name: 'post', light: 0, pixels: 8, length: 7, toward: [1, 0] }]);
  // Two posts sharing a name are told apart by their place in instances.
  assert.deepEqual(render(lamp([standing(), standing({ at: [20, 8] })])).shadows.map(s => s.name), ['post#1', 'post#2']);
  // Without the shadow, or unlit, the floor is as it was.
  assert.equal(row(render(lamp([standing({ shadow: false })])), 20), 'e'.repeat(20) + 'p' + 'e'.repeat(19));
  const unlit = render(lamp([standing()]), { lit: false });
  assert.equal(unlit.shadows, undefined);
  assert.equal(row(unlit, 20), 'c'.repeat(20) + 'p' + 'c'.repeat(19));
});

test('a shadow keeps the cutout the right way round whether the light is behind it or in front of it', () => {
  const ell2 = (light) => render(lamp([{ name: 'ell', asset: 'ell', at: [20, 20], anchor: [0, 3], shadow: true }], { light }));
  // Light behind (up the screen): the shadow falls down the screen, the tall left column's shadow on the left.
  const behind = ell2({ at: [20, 10] });
  assert.equal(column(behind, 20, 18, 30), 'ppp' + 'a'.repeat(7) + 'ee');
  assert.equal(column(behind, 21, 18, 30), 'eep' + 'e'.repeat(9), 'the one-pixel column casts only at its foot, under itself');
  assert.equal(row(behind, 21, 18, 24), 'eeaeee');
  assert.deepEqual(behind.shadows[0].toward, [0, 1]);
  // Light in front (down the screen): it falls up the screen behind the post, still with the tall column on the left.
  const front = ell2({ at: [20, 30] });
  assert.equal(column(front, 20, 10, 22), 'eee' + 'aaaa' + 'pppp' + 'e', 'heights 0 to 3 cast up to row 13');
  assert.equal(row(front, 18, 18, 24), 'eepeee');
  assert.equal(row(front, 15, 18, 24), 'eeaeee');
  assert.deepEqual(front.shadows[0].toward, [0, -1]);
});

test('a shadow falls only on what is drawn before its caster or its sorted group', () => {
  // A floor listed after the post draws over it, unshadowed.
  const after = render({ ...lamp([]), instances: [standing(), { name: 'floor', asset: 'floor', at: [0, 0] }] });
  assert.equal(row(after, 20), 'e'.repeat(40));
  // A stone post standing in the shadow: in the same sorted group it is not shadowed; listed before the caster and
  // unsorted, it is.
  const stone = sort => ({ name: 'stele', asset: 'stele', at: [24, 20], anchor: [0, 3], ...(sort && { sort: 'ground' }) });
  const together = render(lamp([standing({ sort: 'ground' }), stone(true)]));
  assert.equal(row(together, 20, 20, 28), 'paaaeaaa');
  assert.equal(row(together, 19, 24, 25), 'e', 'the stone post is lit above its foot, too');
  const before = render(lamp([stone(false), standing()]));
  assert.equal(row(before, 20, 20, 28), 'paaaaaaa');
  assert.equal(row(before, 19, 24, 25), 'e', 'only its foot stands in the shadow, which lies flat on the ground');
  // A sorted caster's shadow falls on what was drawn before the group, so the floor under it is shadowed as usual.
  assert.equal(row(render(lamp([standing({ sort: 'ground' })])), 20), 'e'.repeat(20) + 'p' + 'a'.repeat(7) + 'e'.repeat(12));
});

test('a placement casts no shadow from a light that rides it or what is attached to it', () => {
  const carried = render(lamp([standing()], { light: { at: [-10, 0], follow: { instance: 'post' } } }));
  assert.equal(row(carried, 20), 'e'.repeat(20) + 'p' + 'e'.repeat(19));
  assert.equal(carried.shadows, undefined);
  // A lantern attached to the post: its light casts no shadow of the post either.
  const lantern = { name: 'lantern', asset: 'post', at: [-10, 0], attach: { instance: 'post' } };
  const held = render(lamp([standing(), lantern], { light: { at: [0, 0], follow: { instance: 'lantern' } } }));
  assert.equal(held.shadows, undefined);
  // Another light still casts it.
  const two = render(lamp([standing()], { lighting: { lights: [{ at: [10, 20], height: 8, radius: 96, strength: 8 }, { at: [-10, 0], height: 8, radius: 4, follow: { instance: 'post' } }] } }));
  assert.deepEqual(two.shadows.map(s => s.light), [0]);
});

test('a lifted placement casts a shadow that leaves its feet, and a tilemap casts from every tile', () => {
  // Lifted 2, the post's heights are 2 to 5: the shadow starts where height 2 lands (t = 3) and runs on past the edge.
  const lifted = render(lamp([standing({ lift: 2 })]));
  assert.equal(row(lifted, 20), 'e'.repeat(23) + 'a'.repeat(17));
  // Two posts in a tilemap, each casting from the middle of its frame on the row it stands on.
  const posts = { name: 'posts', asset: 'post', at: [20, 17], shadow: true, tilemap: { tile: [2, 4], rows: ['PP'], legend: { P: { frame: 'a' } } } };
  const map = render(lamp([posts]));
  assert.equal(row(map, 20, 18, 34), 'eepapaaaaaaaaaee');
  assert.deepEqual(map.shadows, [{ name: 'posts', light: 0, pixels: 18, length: 9, casts: 2 }]);
  // Under a camera the shadow moves with what casts it and the light.
  const panned = render(lamp([standing()], { camera: [2, 0] }));
  assert.equal(row(panned, 20, 16, 30), 'eep' + 'a'.repeat(7) + 'eeee');
});

// A sun with the floor's light and shade: flat ground facing a sun [x, y] gets 1 / sqrt(1 + x² + y²) of it.
const sunny = (sun, instances = [], extra = {}) => lamp(instances, { lighting: { lights: [{ sun, strength: 8, ...extra }] } });

test('a sun lights everything from one way, with no falloff, and casts parallel shadows', () => {
  // At strength 1 the floor gets 0.2 + 7/15 (sun [2, 0]): one step under its colour, from corner to corner.
  const plain = render(sunny([2, 0], [], { strength: 1 }));
  assert.equal([0, 10, 20, 31].map(y => row(plain, y)).join(''), 'b'.repeat(160));
  assert.deepEqual(plain.lights, [{ sun: [2, 0], strength: 1 }]);
  // Sun [2, 0]: each pixel of height falls 2 pixels right, so heights 0 to 3 land at t = 0 to 6, for both posts alike.
  const two = render(sunny([2, 0], [standing(), standing({ at: [8, 10] })]));
  assert.equal(row(two, 20, 18, 30), 'eep' + 'a'.repeat(6) + 'eee');
  assert.equal(row(two, 10, 6, 18), 'eep' + 'a'.repeat(6) + 'eee');
  assert.deepEqual(two.shadows, [{ name: 'post#1', light: 0, pixels: 7, length: 6, toward: [1, 0] }, { name: 'post#2', light: 0, pixels: 7, length: 6, toward: [1, 0] }]);
  // Lifted 2 under sun [1, 0], the post's heights 2 to 5 fall 2 to 5 pixels from its foot.
  assert.equal(row(render(sunny([1, 0], [standing({ lift: 2 })])), 20, 18, 30), 'eeee' + 'aaaa' + 'eeee');
  // Straight overhead, a sun casts no shadow; a diagonal sun casts the same way everywhere.
  assert.equal(render(sunny([0, 0], [standing()])).shadows, undefined);
  assert.deepEqual(render(sunny([-1, 1], [standing(), standing({ at: [30, 6] })])).shadows.map(s => s.toward), [[-0.71, 0.71], [-0.71, 0.71]]);
  // A surface turned toward the sun is lit, one turned away keeps the ambient light: sun [1, 0] shines from the left.
  const slabs = render(sunny([1, 0], [{ name: 'slab', asset: 'slab', at: [4, 4] }], { strength: 1 }));
  assert.equal(row(slabs, 4, 4, 6), 'ca');
});

test('a sun takes no position, height or reach, and the studio saves its direction', () => {
  const refuse = (scene, at, pattern) => assert.throws(() => prepareScene(scene), error => error.path === at && pattern.test(error.message));
  refuse(sunny([1, 0], [], { at: [0, 0] }), 'scene.lighting.lights[0].at', /a sun has no position/);
  refuse(sunny([1, 0], [], { radius: 40 }), 'scene.lighting.lights[0].radius', /a sun has no position/);
  refuse(sunny([9, 0]), 'scene.lighting.lights[0].sun[0]', /-8 to 8/);
  refuse(sunny('east'), 'scene.lighting.lights[0].sun', /\[x, y\]/);
  refuse(sunny([1, 0], [], { keys: [{ time: 0, radius: 20 }] }), 'scene.lighting.lights[0].keys[0].radius', /reaches everywhere/);
  // Keys and flicker change a sun's strength.
  const keyed = sunny([1, 0], [], { strength: 1, keys: [{ time: 0, strength: 0 }, { time: 500, strength: 2 }] });
  assert.equal(render(keyed, { time: 250 }).lights[0].strength, 1);
  // The studio's sliders change the prepared sun; saving writes it into the scene as written, and nothing else.
  const written = sunny([1, 0.5]), scene = prepareScene(written);
  scene.lighting.lights[0].sun[1] = -0.25;
  const saved = withLightSettings(written, scene, new Set(['0.sun']));
  assert.deepEqual(saved.lighting.lights[0], { sun: [1, -0.25], strength: 8 });
  assert.deepEqual(written.lighting.lights[0].sun, [1, 0.5]);
  const schema = JSON.parse(readFileSync(path.join(root, 'scene.schema.json'), 'utf8')).properties.lighting.properties.lights.items;
  assert.equal(schema.properties.sun.maxItems, 2);
  assert.ok(schema.anyOf.some(choice => choice.required?.includes('sun')));
});

test('shadows are refused without lights, on shade placements and past their bound, and warn when nothing is lit', () => {
  const refuse = (scene, at, pattern) => assert.throws(() => prepareScene(scene), error => error.path === at && pattern.test(error.message));
  const { lighting, ...dark } = lamp([standing()]);
  refuse(dark, 'scene.instances[1].shadow', /cast by scene lights/);
  refuse(lamp([standing()], { lighting: { lights: [] } }), 'scene.instances[1].shadow', /cast by scene lights/);
  refuse(lamp([standing({ shadow: 'yes' })]), 'scene.instances[1].shadow', /boolean/);
  refuse(lamp([standing({ asset: 'stele', shade: -1 })]), 'scene.instances[1].shadow', /draws nothing/);
  const many = Array.from({ length: 3 }, () => ({ at: [10, 20] }));
  refuse(lamp([standing({ repeat: [32, 32], step: [1, 1] })], { lighting: { lights: many } }), 'scene.instances[1].shadow', /1024 casting draws under 3 lights exceed 2,048/);
  assert.match(prepareScene(lamp([standing()], { lighting: { scope: 'passes', mode: 'multiply', steps: undefined } })).warnings.join('\n'), /Shadows fall only on lit placements/);
  assert.deepEqual(prepareScene(lamp([standing()])).warnings, []);
});

test('the scene schema declares shadow, and MCP pixel_scene reports shadows', async t => {
  const schema = JSON.parse(readFileSync(path.join(root, 'scene.schema.json'), 'utf8'));
  assert.equal(schema.properties.instances.items.properties.shadow.type, 'boolean');
  const base = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(base, 'pixelbolt-shadow-'));
  t.after(async () => { assert.ok(dir.startsWith(base + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const input = new PassThrough(), output = new PassThrough(), waiting = new Map();
  let buffer = '', next = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)?.(message); } });
  startMCP({ input, output, directory: dir, root: dir });
  const request = (method, params) => new Promise(resolve => { waiting.set(++next, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n'); });
  t.after(() => input.end());
  await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  const result = (await request('tools/call', { name: 'pixel_scene', arguments: { scene: lamp([standing()]) } })).result;
  assert.equal(result.isError, undefined, result.content[0].text);
  assert.deepEqual(JSON.parse(result.content[0].text).shadows, [{ name: 'post', light: 0, pixels: 8, length: 7, toward: [1, 0] }]);
});
