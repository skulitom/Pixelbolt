import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderProject } from '../src/core.js';
import { prepareScene, renderScene } from '../src/scene.js';
import { isoLayout } from '../src/autotile.js';

const schema = name => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));
const FACES = { t: '#ff0000', l: '#00ff00', r: '#0000ff', e: '#ffffff', k: '#202020' };
const boxes = (ops, width = 32, height = 32) => renderProject({ version: 1, name: 'boxes', width, height, palette: FACES, frames: [{ name: 'a', ops }] }).frames[0];
// Opaque pixels of each colour, and each row of a frame as a string of palette keys.
const counts = frame => {
  const byColour = {};
  for (let i = 0; i < frame.data.length; i += 4) if (frame.data[i + 3]) { const hex = `#${[0, 1, 2].map(c => frame.data[i + c].toString(16).padStart(2, '0')).join('')}`; byColour[hex] = (byColour[hex] ?? 0) + 1; }
  return Object.fromEntries(Object.entries(FACES).map(([key, hex]) => [key, byColour[hex] ?? 0]));
};
const rows = (frame, width) => Array.from({ length: frame.data.length / 4 / width }, (_, y) => Array.from({ length: width }, (_, x) => {
  const at = (y * width + x) * 4;
  return frame.data[at + 3] ? Object.keys(FACES).find(key => FACES[key] === `#${[0, 1, 2].map(c => frame.data[at + c].toString(16).padStart(2, '0')).join('')}`) : '.';
}).join(''));

test('a flat box is the 2:1 diamond of its grid, two pixels wider each row', () => {
  const diamond = rows(boxes([{ op: 'box', w: 16, d: 16, top: 't' }], 32, 16), 32);
  const widths = diamond.map(row => row.replaceAll('.', '').length);
  assert.deepEqual(widths, [2, 6, 10, 14, 18, 22, 26, 30, 30, 26, 22, 18, 14, 10, 6, 2]);
  for (const row of diamond) assert.equal(row, [...row].reverse().join(''), 'each row is centred');
  // Diamonds on the grid's lattice ([16, 8] apart) cover the plane once: no gaps, no overlaps.
  const coverage = new Uint8Array(32 * 16);
  for (const [x, y] of [[0, 0], [16, 8], [-16, 8], [16, -8], [-16, -8], [0, 16], [0, -16]]) {
    const frame = boxes([{ op: 'box', x, y, w: 16, d: 16, top: 't' }], 32, 16);
    for (let i = 0; i < coverage.length; i++) coverage[i] += frame.data[i * 4 + 3] ? 1 : 0;
  }
  assert.ok(coverage.every(n => n === 1), 'every pixel belongs to exactly one diamond');
});

test('box faces each cover exactly their area, meet without overlap, and edges mark the front lines', () => {
  for (const [w, d, h] of [[16, 16, 16], [20, 12, 10], [2, 2, 1], [30, 6, 7]]) {
    const frame = boxes([{ op: 'box', w, d, h, top: 't', left: 'l', right: 'r' }], w + d, (w + d) / 2 + h);
    assert.deepEqual(counts(frame), { t: w * d, l: w * h, r: d * h, e: 0, k: 0 }, `${w}/${d}/${h}`);
  }
  const block = rows(boxes([{ op: 'box', w: 16, d: 16, h: 16, top: 't', left: 'l', right: 'r', edge: 'e' }]), 32);
  assert.equal(block[0], '...............tt...............');
  assert.equal(block[12], 'lllllllll' + 'ee' + 'tttttttttt' + 'ee' + 'rrrrrrrrr', 'the top face meets each side along a 2:1 edge line');
  assert.equal(block[15], 'lllllllllllllll' + 'ee' + 'rrrrrrrrrrrrrrr', 'the top face ends in a two-pixel point');
  assert.equal(block[31], '...............er...............', 'the corner between the sides runs to a two-pixel point');
  // The top's front edges have one pixel in each of its 30 columns (a diamond's corner columns belong to its
  // neighbours), and the corner between the sides runs 16 rows.
  assert.equal(counts(boxes([{ op: 'box', w: 16, d: 16, h: 16, top: 't', left: 'l', right: 'r', edge: 'e' }])).e, 30 + 16);
  // A face without a colour is left out, and the box sits at x, y.
  const open = rows(boxes([{ op: 'box', x: 2, y: 3, w: 8, d: 8, h: 4, left: 'l', right: 'r' }], 20, 16), 20);
  assert.equal(open.join('').replaceAll(/[lr.]/g, ''), '');
  assert.equal(open.findIndex(row => row !== '.'.repeat(20)), 3 + 8 / 2, "the left face starts at the top face's left corner, d / 2 rows down");
});

test('box is checked where it is written and stands on its bottom row in a sorted layer', () => {
  const fails = (op, message) => assert.throws(() => boxes([{ op: 'box', ...op }]), message);
  fails({ w: 15, d: 16, top: 't' }, /ops\[0\]\.w: expected an even number/);
  fails({ w: 16, d: 3, top: 't' }, /ops\[0\]\.d: expected an even number/);
  fails({ w: 16, d: 16 }, /give at least one face a colour/);
  fails({ w: 16, d: 16, top: 't', depth: 2 }, /depth/);
  fails({ w: 16, d: 16, h: -1, top: 't' }, /ops\[0\]\.h/);
  // In a sorted layer, a tall box behind a short one is drawn first, whatever the list says.
  const layer = sorted => renderProject({ version: 1, name: 'stack', width: 32, height: 40, palette: FACES, frames: [{ name: 'a', layers: [{ ...(sorted && { sort: 'ground' }), ops: [
    { op: 'box', x: 0, y: 8, w: 16, d: 16, h: 16, top: 'k', left: 'k', right: 'k' },
    { op: 'box', x: 0, y: 0, w: 16, d: 16, h: 16, top: 't', left: 'l', right: 'r' }] }] }] }).frames[0].data;
  const at = (data, x, y) => [...data.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 3)];
  assert.deepEqual(at(layer(false), 16, 20), [0, 0, 255], 'in list order the box behind covers the one in front');
  assert.deepEqual(at(layer(true), 16, 20), [32, 32, 32], 'sorted, the box in front (bottom row 39) is drawn last');
});

test('iso layout lays cells on a 2:1 grid, back to front, and recipe tilemaps stand symbols on their diamonds', () => {
  const cells = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }];
  assert.deepEqual(isoLayout(cells, 2, [4, 2]).map(c => [c.x, c.y, c.left, c.top]), [[0, 0, 2, 0], [0, 1, 0, 1], [1, 0, 4, 1], [1, 1, 2, 2]]);
  // A 2x2 map of 4x2 tiles: a flat symbol fills its diamond, a taller one rises above its cell, centred.
  const project = renderProject({ version: 1, name: 'map', width: 8, height: 8, palette: FACES,
    symbols: { f: ['.tt.', 'tttt'], b: ['ll', 'll', 'll'] },
    frames: [{ name: 'a', ops: [{ op: 'tilemap', y: 4, tile: [4, 2], layout: 'iso', rows: ['ff', 'fb'], legend: { f: 'f', b: 'b' } }] }] });
  // Cells [0, 0], [0, 1], [1, 0] are floor diamonds at map [2, 0], [0, 1], [4, 1]; the block stands on cell [1, 1]
  // (diamond at [2, 2]), centred across it, its bottom on the diamond's bottom row, and drawn last.
  assert.deepEqual(rows(project.frames[0], 8), ['........', '........', '........', '........', '...tt...', '.ttlltt.', 'tttllttt', '...ll...']);
  const draw = (layout, extra = {}) => () => renderProject({ version: 1, name: 'map', width: 8, height: 8, palette: FACES, symbols: { f: ['tt'] }, frames: [{ name: 'a', ops: [{ op: 'tilemap', tile: [3, 2], layout, rows: ['f'], legend: { f: 'f' }, ...extra }] }] });
  assert.throws(draw('iso'), /an iso tile has an even width and height/);
  assert.throws(draw('hex'), /layout: expected square or iso/);
  assert.doesNotThrow(draw('square'));
  assert.throws(() => renderProject({ version: 1, name: 'map', width: 8, height: 8, palette: FACES, symbols: { t: Array(12).fill('tttttttt') }, frames: [{ name: 'a', ops: [{ op: 'tilemap', tile: [4, 2], layout: 'iso', rows: ['w'], legend: { w: { template: 't', autotile: 'blob' } } }] }] }), /draws square tiles; an iso map takes symbols/);
});

test('a sorted iso scene map covers what stands behind a block and stays under what stands on top of it', () => {
  // 8x8 frames on an 8x4 grid: a floor diamond and a block rising 4 pixels.
  const tiles = { version: 1, name: 'tiles', width: 8, height: 8, palette: FACES, frames: [
    { name: 'floor', ops: [{ op: 'box', y: 4, w: 4, d: 4, top: 'k' }] },
    { name: 'block', ops: [{ op: 'box', w: 4, d: 4, h: 4, top: 't', left: 'l', right: 'r' }] }] };
  const figure = { version: 1, name: 'figure', width: 2, height: 4, palette: { e: '#ffffff' }, anchor: [1, 3], frames: [{ name: 'a', ops: [{ op: 'rect', w: 2, h: 4, color: 'e' }] }] };
  // Cell [x, y] of a 3-row map at [0, 0] has its centre at [(x - y + 3) * 4, (x + y + 1) * 2].
  const centre = (x, y) => [(x - y + 3) * 4, (x + y + 1) * 2];
  const scene = (at, extra = {}) => prepareScene({ format: 'pixelforge-scene', version: 1, name: 'iso', width: 24, height: 16, background: '#000000', assets: { tiles, figure },
    instances: [
      { name: 'floor', asset: 'tiles', at: [0, 2], tilemap: { layout: 'iso', tile: [8, 4], rows: ['fff', 'fff', 'fff'], legend: { f: 'floor' } } },
      { name: 'blocks', asset: 'tiles', at: [0, 2], sort: 'ground', tilemap: { layout: 'iso', tile: [8, 4], rows: ['...', '.b.', '...'], legend: { b: 'block' } } },
      { name: 'figure', asset: 'figure', at: [at[0], at[1] + 2], anchor: 'frame', sort: 'ground', ...extra }] });
  const depth = view => view.depth.sorted.map(s => s.name);
  const behind = renderScene(scene(centre(1, 0)), { depth: true }), front = renderScene(scene(centre(1, 2)), { depth: true }), top = renderScene(scene(centre(1, 1), { lift: 4 }), { depth: true });
  assert.deepEqual(depth(behind), ['figure', 'blocks']);
  assert.deepEqual(depth(front), ['blocks', 'figure']);
  assert.deepEqual(depth(top), ['blocks', 'figure'], 'standing on the block, in its cell, the figure is drawn over it');
  // The block's tile row stands just above its diamond's centre: map row (1 + 1) * 2 + 2, less one, plus the map's 2.
  assert.deepEqual(behind.depth.sorted[1], { name: 'blocks', ground: 2 + 4 + 2 - 1, tiles: 1 });
  assert.ok(behind.depth.overlaps.some(o => o.front === 'blocks' && o.behind === 'figure'));
  // The map's bounds are its diamonds: (columns + rows) * 4 wide and * 2 tall.
  assert.deepEqual(behind.placements.find(p => p.name === 'floor'), { name: 'floor', tilemap: true, x: 0, y: 2, w: 24, h: 12, tiles: 9, scale: 1 });
  // The floor fills the grid with no gaps: every pixel across the map's widest row is drawn, but for its corner
  // columns, which would belong to diamonds beyond the map.
  const row = 2 + 6, data = renderScene(scene([100, 100])).data;
  for (let x = 1; x < 23; x++) assert.notDeepEqual([...data.subarray((row * 24 + x) * 4, (row * 24 + x) * 4 + 3)], [0, 0, 0], `pixel ${x}`);
});

test('the schemas offer box and the iso layout', () => {
  const recipe = schema('schema.json'), box = recipe.$defs.op.oneOf.find(op => op.properties.op.const === 'box');
  assert.deepEqual(box.required, ['op', 'w', 'd']);
  assert.equal(box.properties.w.multipleOf, 2);
  assert.deepEqual(recipe.$defs.op.oneOf.find(op => op.properties.op.const === 'tilemap').properties.layout.enum, ['square', 'iso']);
  assert.deepEqual(schema('scene.schema.json').properties.instances.items.properties.tilemap.properties.layout.enum, ['square', 'iso']);
});
