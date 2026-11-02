// Corner (dual-grid) autotile sets: 16 tiles that sit where four map cells meet, cut from the blob template. A corner
// map must draw exactly what a blob map of the same cells draws; the set compiles with an empty tile once, collision
// from its terrain quarters, a Godot terrain that matches corners, and works in recipe and scene tilemaps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderProject } from '../src/core.js';
import { compileAutotile } from '../src/authoring.js';
import { neighbourMask, tilePieces, expandTilemap, autotileFrames, CORNER_MASKS } from '../src/autotile.js';
import { JOINS, TEST_MAP, layeredTestMap } from '../src/terrain.js';
import { createBundle } from '../src/export.js';
import { prepareScene, renderScene } from '../src/scene.js';
import { checkDelivery } from '../src/check.js';
import { tileSets } from '../src/godot.js';

const meadow = JSON.parse(await readFile(new URL('../examples/meadow.autotile.json', import.meta.url), 'utf8'));
const ground = JSON.parse(await readFile(new URL('../examples/ground.autotile.json', import.meta.url), 'utf8'));
// One template, no variants, so a map's tiles depend only on its cells.
const single = (source, mode) => compileAutotile({ ...source, mode, variants: undefined, slopes: undefined, frame: `${source.name}-{mask}` }).recipe;
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
  const { recipe, metadata, warnings } = compileAutotile({ ...ground, mode: 'corner', slopes: undefined });
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
  const recipe = compileAutotile({ ...ground, mode: 'corner', slopes: undefined }).recipe, bundle = await createBundle(recipe);
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
  const fills = [{ name: 'b', weight: 4 }, { name: 'c', weight: 4 }];
  assert.deepEqual(metadata.layers, [{ name: 'water', key: 'w', weight: 4, variants: [...fills, { name: 'lily', weight: 1 }], solid: true },
    { name: 'sand', key: 's', weight: 4, variants: [...fills, { name: 'shell', weight: 1 }] }, { name: 'grass', key: 'g', weight: 4, variants: [...fills, { name: 'daisies', weight: 1 }] }]);
  assert.deepEqual([metadata.mode, metadata.tiles, metadata.seams.shape, metadata.seams.texture], ['corner', 90, 0, 0]);
  assert.deepEqual(recipe.frames.slice(0, 3).map(frame => frame.name), ['shore-wwww', 'shore-swww', 'shore-gwww']);
  // Water at NW and SE, sand at NE, grass at SW: water fills the tile, sand covers its own corner and the grass's, grass its own.
  const wsgw = recipe.frames.find(frame => frame.name === 'shore-wsgw');
  assert.deepEqual(wsgw.tile.corners, ['water', 'sand', 'grass', 'water']);
  assert.deepEqual(wsgw.ops, [{ op: 'autotile', symbol: 'template-water', mask: 15, mode: 'corner' }, { op: 'autotile', symbol: 'template-sand', mask: 6, mode: 'corner' }, { op: 'autotile', symbol: 'template-grass', mask: 4, mode: 'corner' }]);
  // Grass straight on water draws no sand.
  assert.deepEqual(recipe.frames.find(frame => frame.name === 'shore-ggww').ops.map(op => [op.symbol, op.mask]), [['template-water', 15], ['template-grass', 3]]);
  // A layered tile is no single-terrain autotile frame.
  assert.deepEqual(autotileFrames(recipe), []);
  // The test map draws one map per terrain over the same rows, then the variants.
  const ops = preview.frames[0].ops, maps = ops.filter(op => op.op === 'tilemap');
  assert.deepEqual(maps.map(op => Object.entries(op.legend).filter(([, entry]) => entry).map(([key, entry]) => `${key}:${entry.match}`)), [['w:wsg'], ['s:sg'], ['g:g']]);
  assert.deepEqual([...new Set(ops.slice(maps.length).map(op => op.op))], ['autotile']);
  // Below the block and the shapes, a patch of the terrain between shows its plain tile and variants.
  assert.deepEqual(layeredTestMap(3).slice(-5).map(row => row.join('')), [...Array(4).fill(`0${'1'.repeat(20)}0`), '0'.repeat(22)]);
  const layers = shore.layers;
  for (const [change, message] of [
    [{ mode: 'blob' }, /autotile\.mode: layers are corner tiles/],
    [{ variants: [{ name: 'a' }] }, /autotile\.variants: a layered set's variants belong to its layers: give a layer variants of its plain tile/],
    [{ collision: true }, /autotile\.collision: a layered set's collision belongs to its layers: give each solid layer collision/],
    [{ frame: 'shore-{mask}' }, /autotile\.frame: expected a frame name template containing \{corners\}/],
    [{ layers: layers.slice(0, 1) }, /autotile\.layers: expected 2–4 layers, bottom first/],
    [{ layers: [layers[0], { ...layers[1], key: 'w' }] }, /autotile\.layers\[1\]\.key: expected one letter or digit, unique among the layers/],
    // Tile names must differ in more than letter case, and keys spell them; a digit key can't start one.
    [{ layers: [layers[0], { ...layers[1], key: 'W' }] }, /autotile\.layers\[1\]\.key: expected one letter or digit, unique among the layers ignoring letter case/],
    [{ frame: '{corners}', layers: [{ ...layers[0], key: '1' }, ...layers.slice(1)] }, /autotile\.frame: makes "1111" for corners 1111, which is no frame name: .*put a letter before \{corners\}, as in tiles-\{corners\}/],
    [{ layers: [layers[0], { name: 'sand', key: 's' }] }, /autotile\.layers\[1\]: give the layer a terrain, template rows or ops/]
  ]) assert.throws(() => compileAutotile({ ...shore, ...change }), message, JSON.stringify(change));
  // Four layers make 256 tiles, as many frames as a recipe holds, so they leave no room for variants.
  const fourth = { name: 'rock', key: 'r', terrain: { fill: 'g' } };
  assert.equal(compileAutotile({ ...shore, layers: [...layers.map(({ variants, weight, ...layer }) => layer), fourth] }).recipe.frames.length, 256);
  assert.throws(() => compileAutotile({ ...shore, layers: [...layers, fourth] }), /autotile\.layers\[\d\]\.variants: 4 layers make 256 tiles, as many frames as a recipe holds, so there is no room for \d+ variants?: use 3 layers \(81 tiles\), or leave the variants out/);
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
  assert.equal(text.match(/\/terrain = /g).length, 90 * 3);
  // Solid water: the tile but for the sand's corner and the grass's, from where each starts.
  assert.deepEqual(text.split('\n').filter(line => line.startsWith(`${cell}/`)), [`${cell}/next_alternative_id = 3`,
    ...[0, 1, 2].flatMap(k => [`${cell}/${k} = ${k}`, `${cell}/${k}/terrain_set = 0`, `${cell}/${k}/terrain = ${k}`, `${cell}/${k}/physics_layer_0/polygon_0/points = PackedVector2Array(-8, -8, 2, -8, 2, -2, 8, -2, 8, 8, -2, 8, -2, 3, -8, 3)`,
      `${cell}/${k}/terrains_peering_bit/bottom_left_corner = 2`, `${cell}/${k}/terrains_peering_bit/top_right_corner = 1`])]);
  assert.deepEqual(atlas.frames['shore-wsgw'].tile, { corners: ['water', 'sand', 'grass', 'water'], collision: [[[0, 0], [10, 0], [10, 6], [16, 6], [16, 16], [6, 16], [6, 11], [0, 11]].map(([x, y]) => ({ x, y }))] });
  // A variant's probability is its weight against the heaviest tile with its corners, so other tiles keep Godot's 1.
  const probability = frame => { const { x: fx, y: fy } = atlas.frames[frame].frame; return text.split('\n').find(line => line.startsWith(`${fx / 16}:${fy / 16}/0/probability = `))?.split(' = ')[1]; };
  assert.deepEqual(['shore-wwww', 'shore-wwww-b', 'shore-wwww-lily', 'shore-wsgw'].map(probability), [undefined, undefined, '0.25', undefined]);
  assert.match(text, /\nphysics_layer_0\/collision_layer = 1\n/);
  const readme = bundle.files.get('README.txt').toString();
  assert.match(readme, /the layered terrains water, sand and grass and their transitions/);
  assert.match(readme, /paint bottom-up, each terrain over its own cells and those of every terrain above it: water over the whole area, then sand over the sand and grass, then grass over the grass\./);
  for (const [tile, message] of [[{ corners: ['water', 'sand'] }, /tile\.corners: expected the terrains at the tile's four corners/], [{ corners: ['a', 'b', 'c', 'd'], terrain: 'a' }, /tile\.terrain: a tile with corners belongs to the terrains they name/]])
    assert.throws(() => renderProject({ version: 1, name: 't', width: 4, height: 4, frames: [{ name: 'a', tile }] }), message);
});

test('a layer\'s variants redraw its plain tile, after the other tiles, weighed against it', () => {
  const { recipe } = compileAutotile(shore), frame = name => recipe.frames.find(item => item.name === name);
  assert.deepEqual(recipe.frames.slice(81).map(item => item.name), ['shore-wwww-b', 'shore-wwww-c', 'shore-wwww-lily', 'shore-ssss-b', 'shore-ssss-c', 'shore-ssss-shell', 'shore-gggg-b', 'shore-gggg-c', 'shore-gggg-daisies']);
  assert.deepEqual(['shore-wwww', 'shore-wwww-b', 'shore-wwww-lily', 'shore-wsgw'].map(name => frame(name).tile.weight), [4, 4, undefined, undefined]);
  assert.deepEqual(frame('shore-wwww-lily'), { name: 'shore-wwww-lily', tile: { corners: ['water', 'water', 'water', 'water'], collision: [[0, 0], [16, 0], [16, 16], [0, 16]] }, ops: [{ op: 'autotile', symbol: 'template-water-lily', mask: 15, mode: 'corner' }] });
  // The lily is the plain tile with the lily stamped over it, kept in the template's plain-tile quarters (the middle of
  // its island), so the rest of the template is the water's.
  const project = renderProject(recipe), pixels = name => project.frames.find(item => item.name === name).data, plainTile = pixels('shore-wwww'), lily = pixels('shore-wwww-lily'), changed = [];
  for (let i = 0; i < plainTile.length; i += 4) if (plainTile.subarray(i, i + 4).join() !== lily.subarray(i, i + 4).join()) changed.push([(i / 4) % 16, Math.floor(i / 64)]);
  assert.ok(changed.length > 10 && changed.every(([x, y]) => x >= 6 && x <= 11 && y >= 5 && y <= 9), JSON.stringify(changed));
  recipe.symbols['template-water'].forEach((row, y) => [...row].forEach((char, x) => { if (recipe.symbols['template-water-lily'][y][x] !== char) assert.ok(x >= 8 && x < 24 && y >= 24 && y < 40, `${x}, ${y}`); }));
  // Another fill seed redraws the whole template; only its plain tile is used.
  assert.notDeepEqual(recipe.symbols['template-water-b'], recipe.symbols['template-water']);
  const water = shore.layers[0], withWater = change => ({ ...shore, layers: [{ ...water, ...change }, ...shore.layers.slice(1)] });
  for (const [change, message] of [
    [{ variants: undefined }, /autotile\.layers\[0\]\.weight: weighs the layer's plain tile against its variants; give the layer variants/],
    [{ variants: [] }, /autotile\.layers\[0\]\.variants: expected 1–16 variants of the layer's plain tile/],
    [{ variants: [{ name: 'b' }] }, /autotile\.layers\[0\]\.variants\[0\]: a variant redraws the layer's plain tile: give it a terrain \(merged into the layer's\) or ops drawn over the tile/],
    [{ variants: [{ name: 'b', ops: [] }, { name: 'b', ops: [] }] }, /autotile\.layers\[0\]\.variants\[1\]\.name: expected 1–16 letters, digits, hyphens or underscores, unique among the layer's variants/],
    [{ variants: [{ name: 'b', weight: 0, ops: [] }] }, /autotile\.layers\[0\]\.variants\[0\]\.weight: expected a whole number from 1 to 1000/],
    [{ terrain: undefined, ops: [{ op: 'rect', x: 0, y: 0, w: 32, h: 48, color: 'w' }], variants: [{ name: 'b', terrain: { seed: 2 } }] }, /autotile\.layers\[0\]\.variants\[0\]\.terrain: a variant's terrain changes the layer's terrain; give the layer \(or the set\) a terrain first/],
    [{ variants: [{ name: 'b', ops: [{ op: 'pixel', x: 3, y: 3, color: '#123456' }] }] }, /autotile\.layers\[0\]\.variants\[0\]\.ops: drew #123456ff at \[3, 3\], a colour no one-character palette key names/]
  ]) assert.throws(() => compileAutotile(withWater(change)), message, JSON.stringify(change));
  // A layer's template and a variant's never share a name.
  assert.throws(() => compileAutotile({ ...shore, layers: [water, { ...shore.layers[1], name: 'water-b' }, shore.layers[2]] }), /autotile\.layers\[1\]\.name: template-water-b would name two templates/);
  // Drawing on the tile's border, which the tiles beside it do not continue, is warned about.
  assert.deepEqual(compileAutotile(withWater({ variants: [{ name: 'rock', ops: [{ op: 'rect', x: 0, y: 6, w: 3, h: 2, color: 'S' }] }] })).warnings,
    ['Layer water, variant rock: its ops change 2 pixels on the left border, which the tiles beside it do not continue; keep a variant\'s drawing a pixel inside the tile']);
});

test('a map draws a layer\'s variants only where its plain tile goes, as the test map does', () => {
  const { recipe, preview } = compileAutotile(shore), names = new Set(recipe.frames.map(frame => frame.name)), keys = 'wsg';
  const legend = Object.fromEntries(shore.layers.map(layer => [layer.key, { frames: ['shore-{corners}', ...layer.variants.map(variant => `shore-{corners}-${variant.name}`)], weights: [layer.weight, ...layer.variants.map(variant => variant.weight)], autotile: 'corner' }]));
  const expand = (rows, legendUsed = legend) => expandTilemap({ rows, legend: legendUsed }, { path: 'map', fail, kinds: ['frame'], text: 'frame', masked: () => true, exists: (kind, name) => names.has(name) }).cells;
  // Over the test map: a variant only where four cells of its terrain meet, at the points and with the picks of the
  // test map's own variants.
  const cells = expand(layeredTestMap(3).map(row => row.map(i => keys[i]).join(''))), variants = cells.filter(cell => cell.name.split('-').length === 3);
  assert.ok(variants.every(cell => /^shore-(.)\1\1\1-/.test(cell.name)));
  assert.deepEqual(new Set(variants.map(cell => cell.name.split('-')[2])), new Set(['b', 'c', 'lily', 'shell', 'daisies']));
  const symbolOf = name => recipe.frames.find(frame => frame.name === name).ops[0].symbol;
  assert.deepEqual(variants.map(cell => [cell.x * 16, cell.y * 16, symbolOf(cell.name)]).sort(), preview.frames[0].ops.filter(op => op.op === 'autotile').map(op => [op.x, op.y, op.symbol]).sort());
  // A legend listing variants of one terrain draws its plain tile wherever another terrain is at a corner.
  const scene = renderScene(prepareScene({ format: 'pixelforge-scene', version: 1, name: 'coast', width: 96, height: 64, assets: { shore: recipe },
    instances: [{ asset: 'shore', at: [0, 0], tilemap: { rows: ['wwwwww', 'wwssww', 'wwssww', 'wwwwww'], legend: { w: legend.w, s: { frame: 'shore-{corners}', autotile: 'corner' } } } }] }), { lit: false });
  assert.equal(scene.width, 96);
  // A variant that is no tile for any corners of the map's keys is a mistake, not a variant never drawn.
  assert.throws(() => expand(['ws'], { w: { frames: ['shore-{corners}', 'shore-{corners}-lilly'], autotile: 'corner' }, s: { frame: 'shore-{corners}', autotile: 'corner' } }),
    /map\.legend\["w"\]\.frames\[1\]: "shore-\{corners\}-lilly" is no frame for any four of the map's layered keys \(w s\); a layered set names a layer's variants after its plain tile, such as shore-wwww-<variant>/);
});

test('a solid layer collides where it shows, up to where the terrains over it start', () => {
  const tiles = layers => { const { recipe } = compileAutotile({ ...shore, layers: shore.layers.map((layer, i) => ({ ...layer, collision: layers[i] })) }); return name => recipe.frames.find(frame => frame.name === name).tile; };
  // Solid water: all of a water tile, and its variants; not a sand tile; a tile with sand at NE and grass at SW but
  // for their corners, from where each starts (the depth of their edges).
  const water = tiles([true]);
  assert.deepEqual(water('shore-wwww').collision, [[0, 0], [16, 0], [16, 16], [0, 16]]);
  assert.deepEqual(water('shore-wwww-lily').collision, water('shore-wwww').collision);
  assert.deepEqual([water('shore-ssss').collision, water('shore-ssss-shell').collision], [undefined, undefined]);
  assert.deepEqual(water('shore-wsgw').collision, [[0, 0], [10, 0], [10, 6], [16, 6], [16, 16], [6, 16], [6, 11], [0, 11]]);
  // Solid grass instead: its own corners, kept from the terrains under it by its edges, as one-way platforms.
  const grass = tiles([undefined, undefined, { oneWay: true }]);
  assert.deepEqual(grass('shore-ggww'), { corners: ['grass', 'grass', 'water', 'water'], collision: [[0, 0], [16, 0], [16, 5], [0, 5]], oneWay: true });
  assert.equal(grass('shore-wwww').collision, undefined);
  // Water and grass both solid, grass at NW and sand at NE over water: the grass's edge is a pixel deeper than the
  // sand's, so a strip of sand shows between them and stays open.
  assert.deepEqual(tiles([true, undefined, true])('shore-gsww').collision, [[[0, 0], [6, 0], [6, 5], [0, 5]], [[0, 6], [16, 6], [16, 16], [0, 16]]]);
  assert.throws(() => tiles([true, undefined, { oneWay: true }]), /autotile\.layers\[2\]\.collision\.oneWay: engines keep one oneWay per tile: give every solid layer the same oneWay/);
  assert.throws(() => tiles([{ inset: 8 }]), /autotile\.layers\[0\]\.collision\.inset: expected a whole number of pixels from 0 to 7/);
  assert.throws(() => tiles(['yes']), /autotile\.layers\[0\]\.collision: expected true, or \{ inset, oneWay \}/);
});
