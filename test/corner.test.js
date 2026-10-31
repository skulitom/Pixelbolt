// Corner (dual-grid) autotile sets: 16 tiles that sit where four map cells meet, cut from the blob template. A corner
// map must draw exactly what a blob map of the same cells draws; the set compiles with an empty tile once, collision
// from its terrain quarters, a Godot terrain that matches corners, and works in recipe and scene tilemaps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderProject } from '../src/core.js';
import { compileAutotile } from '../src/authoring.js';
import { neighbourMask, tilePieces, expandTilemap, autotileFrames, CORNER_MASKS } from '../src/autotile.js';
import { JOINS, TEST_MAP } from '../src/terrain.js';
import { createBundle } from '../src/export.js';
import { prepareScene, renderScene } from '../src/scene.js';
import { checkDelivery } from '../src/check.js';
import { tileSets } from '../src/godot.js';

const meadow = JSON.parse(await readFile(new URL('../examples/meadow.autotile.json', import.meta.url), 'utf8'));
const ground = JSON.parse(await readFile(new URL('../examples/ground.autotile.json', import.meta.url), 'utf8'));
// One template, no variants, so a map's tiles depend only on its cells.
const single = (source, mode) => compileAutotile({ ...source, mode, variants: undefined, frame: `${source.name}-{mask}` }).recipe;
const fail = (where, message) => { throw new Error(`${where}: ${message}`); };
const expand = (rows, mode, extra = {}) => expandTilemap({ rows, legend: { '#': { frame: 't-{mask}', autotile: mode } }, ...extra }, { path: 'map', fail, kinds: ['frame'], text: 'frame', masked: () => true, exists: () => true }).cells;

test('a corner tile\'s mask names the four cells around its point, and its quarters are those cells\' inner quarters', () => {
  // The point is the top-left corner of the cell at offset [0, 0].
  const cells = new Set(['-1,-1', '0,0']);
  assert.equal(neighbourMask('corner', (dx, dy) => cells.has(`${dx},${dy}`)), 1 + 8);
  assert.deepEqual(Object.values(tilePieces('corner', 0)), [null, null, null, null]);
  assert.deepEqual(tilePieces('corner', 15), { tl: { from: 'br', piece: 'f' }, tr: { from: 'bl', piece: 'f' }, bl: { from: 'tr', piece: 'f' }, br: { from: 'tl', piece: 'f' } });
  // NW, NE and SW: the NW cell's quarter turns the inner corner, its neighbours' quarters are edges.
  assert.deepEqual(tilePieces('corner', 7), { tl: { from: 'br', piece: 'i' }, tr: { from: 'bl', piece: 'h' }, bl: { from: 'tr', piece: 'v' }, br: null });
  assert.deepEqual(tilePieces('corner', 6), { tl: null, tr: { from: 'bl', piece: 'o' }, bl: { from: 'tr', piece: 'o' }, br: null });
  // A map of 3 × 2 cells draws 4 × 3 points, half a cell up and left; the lone cell's four corners are its tiles.
  assert.deepEqual(expand(['#..', '...'], 'corner').map(cell => [cell.x, cell.y, cell.name]), [[-0.5, -0.5, 't-8'], [0.5, -0.5, 't-4'], [-0.5, 0.5, 't-2'], [0.5, 0.5, 't-1']]);
  // The test map holds every corner mask.
  assert.deepEqual([...new Set(expand(TEST_MAP, 'corner').map(cell => Number(cell.name.slice(2))))].sort((a, b) => a - b), CORNER_MASKS.filter(Boolean));
  // The joins a corner map makes are the blob joins, with the ones inside a tile and between tiles swapped.
  const key = (join, across) => `${join.axis}:${join.first}|${join.second}|${across}`;
  assert.deepEqual(JOINS.corner.map(join => key(join, !join.across)).sort(), JOINS.blob.map(join => key(join, join.across)).sort());
});

test('a corner map draws exactly what a blob map of the same cells draws', () => {
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (const source of [meadow, ground]) {
    const recipe = single(source, 'blob'), tile = recipe.width;
    for (let trial = 0; trial < 12; trial++) {
      const w = 3 + Math.floor(rand() * 7), h = 3 + Math.floor(rand() * 5), fill = 0.15 + rand() * 0.7;
      const rows = Array.from({ length: h }, () => Array.from({ length: w }, () => (rand() < fill ? '#' : '.')).join(''));
      const draw = mode => renderProject({ version: 1, name: 'map', width: w * tile, height: h * tile, palette: recipe.palette, symbols: recipe.symbols, frames: [{ name: 'map', ops: [{ op: 'tilemap', tile: [tile, tile], rows, legend: { '#': { template: 'template', autotile: mode } } }] }] }).frames[0].data;
      assert.deepEqual(draw('corner'), draw('blob'), `${source.name}: ${JSON.stringify(rows)}`);
    }
  }
});

test('a corner set compiles 16 masks with the empty tile once, collision from its terrain quarters, and no seams', () => {
  const { recipe, metadata, warnings } = compileAutotile({ ...ground, mode: 'corner' });
  assert.equal(warnings, undefined);
  assert.deepEqual(metadata.masks, [...CORNER_MASKS]);
  assert.deepEqual(metadata.bits, { nw: 1, ne: 2, sw: 4, se: 8 });
  assert.equal(metadata.seams.shape + metadata.seams.texture, 0);
  // 15 masks for each of the three variants, and the empty tile once.
  assert.equal(recipe.frames.length, 15 * 3 + 1);
  assert.deepEqual(recipe.frames.filter(frame => frame.ops[0].mask === 0).map(frame => frame.name), ['ground-0-a']);
  assert.ok(recipe.frames.every(frame => frame.ops[0].mode === 'corner'));
  const tile = name => recipe.frames.find(frame => frame.name === name).tile;
  // Insets: n 3, e 1, s 2, w 1 (each edge's depth). A full tile, an inner corner, and two cells touching at the middle.
  assert.deepEqual(tile('ground-15-a').collision, [[0, 0], [16, 0], [16, 16], [0, 16]]);
  assert.deepEqual(tile('ground-7-a').collision, [[0, 0], [16, 0], [16, 6], [8, 6], [8, 8], [7, 8], [7, 16], [0, 16]]);
  assert.deepEqual(tile('ground-6-a').collision, [[[9, 0], [16, 0], [16, 6], [9, 6]], [[0, 11], [7, 11], [7, 16], [0, 16]]]);
  assert.deepEqual(tile('ground-0-a'), { weight: 3 });
  // The empty tile is no surprise to the delivery check.
  const check = checkDelivery(renderProject(recipe), { recipe, expect: { transparent: true } });
  assert.equal(check.ok, true);
  assert.equal(check.notes, undefined);
  assert.throws(() => compileAutotile({ ...ground, mode: 'dual' }), /autotile\.mode: expected blob \(47 tiles\), cardinal \(16, no inner corners\) or corner/);
});

test('a corner set exports a Godot terrain that matches corners, with two polygons where cells touch at a corner', async () => {
  const recipe = compileAutotile({ ...ground, mode: 'corner' }).recipe, bundle = await createBundle(recipe);
  const text = bundle.files.get('ground.tileset.tres').toString(), atlas = JSON.parse(bundle.files.get('ground.atlas.json'));
  assert.match(text, /terrain_set_0\/mode = 1\n/);
  const cell = name => { const { x, y } = atlas.frames[name].frame; return `${x / 16}:${y / 16}`; };
  const lines = name => text.split('\n').filter(line => line.startsWith(`${cell(name)}/`)).map(line => line.slice(cell(name).length + 1));
  assert.deepEqual(lines('ground-7-a').filter(line => line.includes('peering')), ['0/terrains_peering_bit/bottom_left_corner = 0', '0/terrains_peering_bit/top_left_corner = 0', '0/terrains_peering_bit/top_right_corner = 0']);
  assert.deepEqual(lines('ground-6-a').filter(line => line.includes('polygon')), ['0/physics_layer_0/polygon_0/points = PackedVector2Array(1, -8, 8, -8, 8, -2, 1, -2)', '0/physics_layer_0/polygon_1/points = PackedVector2Array(-8, 3, -1, 3, -1, 8, -8, 8)']);
  // The empty tile belongs to the terrain, with no corner of it.
  assert.deepEqual(lines('ground-0-a'), ['0 = 0', '0/terrain_set = 0', '0/terrain = 0']);
  assert.match(bundle.files.get('README.txt').toString(), /A corner terrain is drawn where four painted cells meet/);
  // A terrain can't be blob and corner at once.
  const blob = compileAutotile(ground).recipe, both = renderProject({ ...blob, frames: [...blob.frames, ...recipe.frames.map(frame => ({ ...frame, name: `c-${frame.name}` }))] });
  const tiles = [...blob.frames.map(frame => ({ frame: frame.name, mask: frame.ops[0].mask, mode: 'blob' })), ...recipe.frames.map(frame => ({ frame: `c-${frame.name}`, mask: frame.ops[0].mask, mode: 'corner' }))];
  const { buildAtlas } = await import('../src/core.js');
  assert.deepEqual(tileSets([{ atlas: buildAtlas(both).metadata, tiles, plain: [], name: 'ground' }]), { text: null, warnings: ['not written: terrain ground mixes blob and corner masks, and a Godot terrain matches one way; give one set\'s frames another tile.terrain, or export each set from its own recipe'] });
});

test('scene tilemaps place corner frames where four cells meet', () => {
  const recipe = single(meadow, 'corner');
  const scene = (tilemap, asset = recipe) => ({ format: 'pixelforge-scene', version: 1, name: 'field', width: 64, height: 48, background: '#000000', assets: { grass: asset }, instances: [{ asset: 'grass', at: [16, 16], tilemap }] });
  const rendered = renderScene(prepareScene(scene({ rows: ['#.', '##'], legend: { '#': { frame: 'meadow-{mask}', autotile: 'corner' } } })), { lit: false });
  // A blob map of the same cells, from the blob set of the same terrain, draws the same pixels.
  const blob = renderScene(prepareScene(scene({ rows: ['#.', '##'], legend: { '#': { frame: 'meadow-{mask}', autotile: 'blob' } } }, single(meadow, 'blob'))), { lit: false });
  assert.deepEqual(rendered.data, blob.data);
  assert.throws(() => prepareScene(scene({ tile: [15, 16], rows: ['#'], legend: { '#': { frame: 'meadow-{mask}', autotile: 'corner' } } })), /tilemap\.tile: corner tiles sit where four cells meet/);
  assert.throws(() => prepareScene(scene({ layout: 'iso', rows: ['#'], legend: { '#': { frame: 'meadow-{mask}', autotile: 'corner' } } })), /corner tiles sit where four square cells meet/);
  assert.throws(() => renderProject({ ...recipe, frames: [{ name: 'map', ops: [{ op: 'tilemap', tile: [15, 15], rows: ['#'], legend: { '#': { template: 'template', autotile: 'corner' } } }] }] }), /tile: corner tiles sit where four cells meet/);
});

// ---- Layered sets: transitions between terrains ----
const shore = JSON.parse(await readFile(new URL('../examples/shore.autotile.json', import.meta.url), 'utf8'));

test('a layered set has a tile for every mix of its terrains at the four corners, each lower one running on under the higher', () => {
  const { recipe, metadata, warnings, preview } = compileAutotile(shore);
  assert.equal(warnings, undefined);
  assert.deepEqual(metadata.layers, [{ name: 'water', key: 'w' }, { name: 'sand', key: 's' }, { name: 'grass', key: 'g' }]);
  assert.deepEqual([metadata.mode, metadata.tiles, metadata.seams.shape, metadata.seams.texture], ['corner', 81, 0, 0]);
  assert.deepEqual(recipe.frames.slice(0, 3).map(frame => frame.name), ['shore-wwww', 'shore-swww', 'shore-gwww']);
  // Water at NW and SE, sand at NE, grass at SW: water fills the tile, sand covers its own corner and the grass's, grass its own.
  assert.deepEqual(recipe.frames.find(frame => frame.name === 'shore-wsgw'), { name: 'shore-wsgw', tile: { corners: ['water', 'sand', 'grass', 'water'] }, ops: [
    { op: 'autotile', symbol: 'template-water', mask: 15, mode: 'corner' }, { op: 'autotile', symbol: 'template-sand', mask: 6, mode: 'corner' }, { op: 'autotile', symbol: 'template-grass', mask: 4, mode: 'corner' }] });
  // Grass straight on water draws no sand.
  assert.deepEqual(recipe.frames.find(frame => frame.name === 'shore-ggww').ops.map(op => [op.symbol, op.mask]), [['template-water', 15], ['template-grass', 3]]);
  // A layered tile is no single-terrain autotile frame.
  assert.deepEqual(autotileFrames(recipe), []);
  // The test map draws one map per terrain over the same rows.
  assert.deepEqual(preview.frames[0].ops.map(op => [op.op, Object.entries(op.legend).filter(([, entry]) => entry).map(([key, entry]) => `${key}:${entry.match}`)]), [['tilemap', ['w:wsg']], ['tilemap', ['s:sg']], ['tilemap', ['g:g']]]);
  const layers = shore.layers;
  for (const [change, message] of [
    [{ mode: 'blob' }, /autotile\.mode: layers are corner tiles/],
    [{ variants: [{ name: 'a' }] }, /autotile\.variants: a layered set has no variants yet/],
    [{ collision: true }, /autotile\.collision: a layered set has no collision boxes yet/],
    [{ frame: 'shore-{mask}' }, /autotile\.frame: expected a frame name template containing \{corners\}/],
    [{ layers: layers.slice(0, 1) }, /autotile\.layers: expected 2–4 layers, bottom first/],
    [{ layers: [layers[0], { ...layers[1], key: 'w' }] }, /autotile\.layers\[1\]\.key: expected one letter or digit, unique among the layers/],
    [{ layers: [layers[0], { name: 'sand', key: 's' }] }, /autotile\.layers\[1\]: give the layer a terrain, template rows or ops/]
  ]) assert.throws(() => compileAutotile({ ...shore, ...change }), message, JSON.stringify(change));
});

test('a layered map draws the same from the compiled tiles as from one map per terrain', () => {
  const { recipe } = compileAutotile(shore), tile = 16, keys = 'wsg';
  const rows = ['wwwwwwww', 'wssgggsw', 'wsgggssw', 'wwgsswww', 'wwwgwwsw', 'wwwwwwww'], width = rows[0].length * tile, height = rows.length * tile;
  const scene = renderScene(prepareScene({ format: 'pixelforge-scene', version: 1, name: 'coast', width, height, assets: { shore: recipe },
    instances: [{ asset: 'shore', at: [0, 0], tilemap: { rows, legend: Object.fromEntries([...keys].map(key => [key, { frame: 'shore-{corners}', autotile: 'corner' }])) } }] }), { lit: false });
  const maps = [...keys].map((key, i) => ({ op: 'tilemap', tile: [tile, tile], rows, outside: 'match', legend: Object.fromEntries([...keys].map((other, j) => [other, j === i ? { template: `template-${shore.layers[i].name}`, autotile: 'corner', match: keys.slice(i) } : null])) }));
  const drawn = renderProject({ version: 1, name: 'coast', width, height, palette: recipe.palette, symbols: recipe.symbols, frames: [{ name: 'map', ops: maps }] }).frames[0].data;
  assert.deepEqual(scene.data, drawn);
  // {corners} needs a terrain in every cell around a tile, and a tile for what it finds there.
  const place = tilemap => () => prepareScene({ format: 'pixelforge-scene', version: 1, name: 'coast', width: 64, height: 64, assets: { shore: recipe }, instances: [{ asset: 'shore', at: [0, 0], tilemap }] });
  assert.throws(place({ rows: ['ws', 'w.'], legend: { w: { frame: 'shore-{corners}', autotile: 'corner' }, s: { frame: 'shore-{corners}', autotile: 'corner' } } }), /tilemap\.rows\[1\]\[1\]: is empty, but \{corners\} names a layered tile/);
  assert.throws(place({ rows: ['wx'], legend: { w: { frame: 'shore-{corners}', autotile: 'corner' }, x: 'shore-wwww' } }), /frame "shore-wxwx" does not exist \(corners w x w x: every cell around a layered tile is one of the set's keys\)/);
  assert.throws(place({ rows: ['w'], legend: { w: { frame: 'shore-{corners}', autotile: 'blob' } } }), /\{corners\} names a layered set's tile by the characters of the four cells around it; it goes with autotile corner/);
});

test('a layered set exports one Godot corner terrain set, the ground unset, every tile once per centre terrain', async () => {
  const bundle = await createBundle(compileAutotile(shore).recipe), text = bundle.files.get('shore.tileset.tres').toString();
  const atlas = JSON.parse(bundle.files.get('shore.atlas.json')), { x, y } = atlas.frames['shore-wsgw'].frame, cell = `${x / 16}:${y / 16}`;
  assert.match(text, /terrain_set_0\/mode = 1\nterrain_set_0\/terrain_0\/name = "water"\n.*\nterrain_set_0\/terrain_1\/name = "sand"\n.*\nterrain_set_0\/terrain_2\/name = "grass"\n/);
  assert.equal(text.match(/\/terrain = /g).length, 81 * 3);
  assert.deepEqual(text.split('\n').filter(line => line.startsWith(`${cell}/`)), [`${cell}/next_alternative_id = 3`,
    ...[0, 1, 2].flatMap(k => [`${cell}/${k} = ${k}`, `${cell}/${k}/terrain_set = 0`, `${cell}/${k}/terrain = ${k}`, `${cell}/${k}/terrains_peering_bit/bottom_left_corner = 2`, `${cell}/${k}/terrains_peering_bit/top_right_corner = 1`])]);
  assert.deepEqual(atlas.frames['shore-wsgw'].tile, { corners: ['water', 'sand', 'grass', 'water'] });
  const readme = bundle.files.get('README.txt').toString();
  assert.match(readme, /the layered terrains water, sand and grass and their transitions/);
  assert.match(readme, /paint bottom-up, each terrain over its own cells and those of every terrain above it: water over the whole area, then sand over the sand and grass, then grass over the grass\./);
  for (const [tile, message] of [[{ corners: ['water', 'sand'] }, /tile\.corners: expected the terrains at the tile's four corners/], [{ corners: ['a', 'b', 'c', 'd'], terrain: 'a' }, /tile\.terrain: a tile with corners belongs to the terrains they name/]])
    assert.throws(() => renderProject({ version: 1, name: 't', width: 4, height: 4, frames: [{ name: 'a', tile }] }), message);
});
