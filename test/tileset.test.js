// Tile facts in recipes (terrain, weight, collision) and what the Godot TileSet export makes of them: probabilities,
// collision polygons, plain tiles, several terrains and sheets in one TileSet, and a tile set's export without the
// flipbook of every tile. scripts/verify-godot.mjs loads the same fixtures in a real Godot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderProject, buildAtlas } from '../src/core.js';
import { createBundle } from '../src/export.js';
import { createSceneBundle } from '../src/scene-export.js';
import { compileAutotile } from '../src/authoring.js';
import { checkDelivery } from '../src/check.js';
import { GODOT_TILE_SOURCES, godotTileRecipe } from '../scripts/verify-godot.mjs';

// A TileSet .tres as its ext_resources, each atlas source's properties and tiles by cell, and the [resource] lines.
function readTileSet(text) {
  const sections = text.split('\n\n'), ext = [], sources = [];
  let resource = {};
  for (const section of sections) {
    const lines = section.split('\n').filter(Boolean);
    if (!lines.length || lines[0].startsWith('[gd_resource')) continue;
    if (lines[0].startsWith('[ext_resource')) { ext.push(...lines.map(line => /path="([^"]+)"/.exec(line)[1])); continue; }
    const pairs = lines.slice(1).map(line => line.split(' = '));
    if (lines[0].startsWith('[sub_resource type="TileSetAtlasSource"')) {
      const props = {}, tiles = {};
      for (const [key, value] of pairs) { const cell = /^(\d+:\d+)\/(.*)$/.exec(key); if (cell) (tiles[cell[1]] ??= {})[cell[2]] = value; else props[key] = value; }
      sources.push({ props, tiles });
    } else if (lines[0] === '[resource]') resource = Object.fromEntries(pairs);
  }
  return { ext, sources, resource };
}
const [, fenceSource, , ledgeSource] = GODOT_TILE_SOURCES;
const meadowSource = JSON.parse(await readFile(new URL('../examples/meadow.autotile.json', import.meta.url), 'utf8'));
const groundSource = JSON.parse(await readFile(new URL('../examples/ground.autotile.json', import.meta.url), 'utf8'));
// A frame's sheet cell, as Godot names it, from the atlas.
const cellOf = (atlas, sheet, name) => { const { x, y, w } = atlas.frames[name].frame, margin = sheet.padding * sheet.scale, step = w + margin * 2; return `${(x - margin) / step}:${(y - margin) / step}`; };

test('a frame\'s tile facts are checked and travel to the atlas in exported pixels', () => {
  const make = tile => ({ version: 1, name: 't', width: 4, height: 4, sheet: { scale: 2 }, frames: [{ name: 'a', tile, ops: [{ op: 'rect', x: 0, y: 0, w: 4, h: 4, color: '#fff' }] }] });
  const project = renderProject(make({ terrain: 'stone', weight: 5, collision: [[0, 1], [4, 1], [4, 4], [0, 4]], oneWay: true }));
  // One polygon is kept as a list of one; a list holds a tile's separate solid parts.
  assert.deepEqual(project.frames[0].tile, { terrain: 'stone', weight: 5, collision: [[[0, 1], [4, 1], [4, 4], [0, 4]]], oneWay: true });
  assert.deepEqual(buildAtlas(project).metadata.frames.a.tile, { terrain: 'stone', weight: 5, collision: [[{ x: 0, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 8 }, { x: 0, y: 8 }]], oneWay: true });
  const parts = renderProject(make({ collision: [[[0, 0], [2, 0], [2, 2]], [[2, 2], [4, 2], [4, 4], [2, 4]]] }));
  assert.deepEqual(buildAtlas(parts).metadata.frames.a.tile.collision, [[{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }], [{ x: 4, y: 4 }, { x: 8, y: 4 }, { x: 8, y: 8 }, { x: 4, y: 8 }]]);
  for (const [tile, message] of [
    [{ weight: 0 }, /tile\.weight: expected an integer from 1 to 1000/],
    [{ weight: 2.5 }, /tile\.weight: expected an integer from 1 to 1000/],
    [{ terrain: 'two words' }, /tile\.terrain: use 1–64 letters/],
    [{ collision: [[0, 0], [4, 0]] }, /tile\.collision: expected 3–32 points/],
    [{ collision: [[0, 0], [5, 0], [4, 4]] }, /tile\.collision\[1\]: \[5, 0\] is outside the 4×4 canvas/],
    [{ collision: [[0, 0], [0, 0], [4, 4]] }, /tile\.collision\[1\]: repeats the point before it/],
    [{ collision: [[0, 0], [4, 4], [4, 0], [0, 4]] }, /tile\.collision: the edge from point 0 to 1 crosses or touches the edge from point 2 to 3/],
    [{ collision: [[0, 0], [2, 2], [4, 4]] }, /tile\.collision: the points enclose no area/],
    [{ collision: [[[0, 0], [4, 0], [4, 4]], [[0, 0], [5, 0], [0, 4]]] }, /tile\.collision\[1\]\[1\]: \[5, 0\] is outside the 4×4 canvas/],
    [{ collision: Array.from({ length: 9 }, () => [[0, 0], [4, 0], [4, 4]]) }, /tile\.collision: expected up to 8 polygons/],
    [{ oneWay: true }, /tile\.oneWay: oneWay makes the collision polygon one-way; give the tile a collision polygon/],
    [{ solid: true }, /tile\.solid: unknown field/]
  ]) assert.throws(() => renderProject(make(tile)), message, JSON.stringify(tile));
});

test('variant weights become probabilities, collision boxes one-way polygons, and other drawn frames plain tiles', async () => {
  const recipe = godotTileRecipe(ledgeSource), bundle = await createBundle(recipe), project = bundle.project;
  const atlas = JSON.parse(bundle.files.get('ledge.atlas.json')), { sources, resource } = readTileSet(bundle.files.get('ledge.tileset.tres').toString());
  const { tiles } = sources[0], tile = name => tiles[cellOf(atlas, project.sheet, name)];
  assert.equal(resource['physics_layer_0/collision_layer'], '1');
  // Weights 6, 2 and 1: probabilities against the heaviest, which keeps Godot's default of 1.
  assert.equal(tile('ledge-0-a')['0/probability'], undefined);
  assert.equal(tile('ledge-0-b')['0/probability'], '0.333333');
  assert.equal(tile('ledge-0-c')['0/probability'], '0.166667');
  // A lone tile keeps 1 pixel from its top and sides and none from its bottom, at scale 3 around the tile's centre.
  assert.equal(tile('ledge-0-a')['0/physics_layer_0/polygon_0/points'], 'PackedVector2Array(-3, -3, 3, -3, 3, 6, -3, 6)');
  assert.equal(tile('ledge-255-c')['0/physics_layer_0/polygon_0/points'], 'PackedVector2Array(-6, -6, 6, -6, 6, 6, -6, 6)');
  assert.equal(tile('ledge-17-a')['0/physics_layer_0/polygon_0/points'], 'PackedVector2Array(-3, -6, 3, -6, 3, 6, -3, 6)', 'N and S: open sides only');
  assert.ok(Object.values(tiles).filter(t => t['0/terrain_set']).every(t => t['0/physics_layer_0/polygon_0/one_way'] === 'true'));
  // The compiled frames carry the facts.
  assert.deepEqual(recipe.frames.find(frame => frame.name === 'ledge-0-b').tile, { weight: 2, collision: [[1, 1], [3, 1], [3, 4], [1, 4]], oneWay: true });
  assert.deepEqual(recipe.frames.find(frame => frame.name === 'ledge-0-c').tile, { collision: [[1, 1], [3, 1], [3, 4], [1, 4]], oneWay: true });
  // Plain tiles: no terrain, weighted against each other, the rock with its own polygon; the empty frame is no tile.
  assert.deepEqual(tile('rock'), { 0: '0', '0/physics_layer_0/polygon_0/points': 'PackedVector2Array(-6, 0, 0, -6, 6, 0, 0, 6)' });
  assert.deepEqual(tile('sprout'), { 0: '0', '0/probability': '0.333333' });
  assert.equal(tile('blank'), undefined);
  assert.equal(Object.keys(tiles).length, 47 * 3 + 2);
  assert.deepEqual(project.warnings, []);
});

test('a tile set without animations of its own exports no flipbook of its tiles; one with animations keeps them', async () => {
  const { recipe } = compileAutotile(meadowSource), bundle = await createBundle(recipe);
  assert.deepEqual([...bundle.files.keys()].filter(file => !file.startsWith('frames/')), ['meadow.png', 'meadow.atlas.json', 'meadow.tileset.tres', 'meadow.tsx', 'meadow.pixel.json', 'preview.html', 'README.txt']);
  const readme = bundle.files.get('README.txt').toString();
  assert.match(readme, /^meadow — Pixelbolt tile set\n/);
  assert.match(readme, /meadow\.tileset\.tres: Godot 4 TileSet with the terrain meadow; it finds meadow\.png/);
  assert.match(readme, /Add a TileMapLayer and set its Tile Set to meadow\.tileset\.tres\. In the TileMap panel's Terrains tab, pick meadow and paint/);
  assert.doesNotMatch(readme, /AnimatedSprite2D|SpritePlayer|play\(/);
  assert.match(bundle.files.get('preview.html').toString(), /<img src="meadow\.png"/);
  // The flowers are a quarter as common as each plain fill.
  const atlas = JSON.parse(bundle.files.get('meadow.atlas.json')), { tiles } = readTileSet(bundle.files.get('meadow.tileset.tres').toString()).sources[0];
  assert.equal(tiles[cellOf(atlas, bundle.project.sheet, 'meadow-255-flowers')]['0/probability'], '0.25');
  assert.equal(tiles[cellOf(atlas, bundle.project.sheet, 'meadow-255-b')]['0/probability'], undefined);
  // The ground set's collision is its README's too.
  const ground = await createBundle(compileAutotile(groundSource).recipe);
  assert.match(ground.files.get('README.txt').toString(), /with the terrain ground and 10 plain tiles, and collision shapes on physics layer 0;/);
  // Animated tiles keep their SpriteFrames, APNGs, CSS and player.
  const surf = await createBundle(compileAutotile(GODOT_TILE_SOURCES[2]).recipe), files = [...surf.files.keys()];
  for (const file of ['surf.tres', 'surf.css', 'player.js', 'surf.tileset.tres']) assert.ok(files.includes(file), file);
  assert.ok(files.some(file => file.startsWith('animations/')));
  assert.match(surf.files.get('README.txt').toString(), /Animations: give an AnimatedSprite2D the Sprite Frames surf\.tres/);
});

test('a scene export puts every tile set in one TileSet, each a source and a terrain set of its own', async () => {
  const fence = godotTileRecipe({ ...fenceSource, sheet: { scale: 3 } }), ledge = godotTileRecipe(ledgeSource);
  const scene = await createSceneBundle({ format: 'pixelforge-scene', version: 1, name: 'tiles', width: 16, height: 16, assets: { fence, ledge }, instances: [] });
  assert.deepEqual(scene.warnings, []);
  const { ext, sources, resource } = readTileSet(scene.files.get('tileset.tres').toString());
  assert.deepEqual(ext, ['assets/0/color.png', 'assets/1/color.png']);
  assert.deepEqual(sources.map(source => [source.props.resource_name, source.props.texture]), [['"fence"', 'ExtResource("1_sheet")'], ['"ledge"', 'ExtResource("2_sheet")']]);
  assert.deepEqual(Object.entries(resource).filter(([key]) => /^terrain_set_\d+\/(mode|terrain_0\/name)$/.test(key)), [['terrain_set_0/mode', '2'], ['terrain_set_0/terrain_0/name', '"fence"'], ['terrain_set_1/mode', '0'], ['terrain_set_1/terrain_0/name', '"ledge"']]);
  assert.deepEqual([resource['sources/0'], resource['sources/1']], ['SubResource("TileSetAtlasSource_tiles")', 'SubResource("TileSetAtlasSource_tiles2")']);
  assert.deepEqual(new Set(Object.values(sources[0].tiles).map(tile => tile['0/terrain_set'])), new Set(['0']));
  assert.deepEqual(new Set(Object.values(sources[1].tiles).map(tile => tile['0/terrain_set'])), new Set(['1', undefined]));
  assert.deepEqual(JSON.parse(scene.files.get('alignment.json')).tileset, { file: 'tileset.tres', assets: ['fence', 'ledge'] });
  // One TileSet has one tile size: a set of another size is left out, and said.
  const mixed = await createSceneBundle({ format: 'pixelforge-scene', version: 1, name: 'tiles', width: 16, height: 16, assets: { fence: godotTileRecipe(fenceSource), ledge }, instances: [] });
  assert.deepEqual(mixed.warnings, ['tileset.tres: ledge: left out: its tiles are 12×12 and the TileSet\'s are 4×4; export it on its own']);
  assert.deepEqual(readTileSet(mixed.files.get('tileset.tres').toString()).ext, ['assets/0/color.png']);
  // A scene without tile sets has none.
  const sprite = { version: 1, name: 'dot', width: 2, height: 2, frames: [{ name: 'a', ops: [{ op: 'pixel', x: 0, y: 0, color: '#fff' }] }] };
  assert.equal((await createSceneBundle({ format: 'pixelforge-scene', version: 1, name: 'one', width: 8, height: 8, assets: { sprite }, instances: [] })).files.has('tileset.tres'), false);
});

test('expect.transparent judges a tile set by its tiles with an open side, since inner tiles are solid by design', () => {
  const { recipe } = compileAutotile(meadowSource), check = spec => checkDelivery(renderProject(spec), { recipe: spec, expect: { transparent: true } });
  assert.equal(check(recipe).ok, true);
  assert.equal(check(recipe).delivered.transparent, true);
  // An edge tile drawn solid is still a miss.
  const filled = { ...recipe, frames: recipe.frames.map(frame => (frame.name === 'meadow-1-a' ? { ...frame, ops: [...frame.ops, { op: 'rect', x: 0, y: 0, w: 16, h: 16, color: 'g' }] } : frame)) };
  const result = check(filled);
  assert.equal(result.ok, false);
  assert.match(result.problems[0].got, /^no transparent pixel in "meadow-1-a"$/);
});

test('autotile collision and weights are checked, and the test map mixes variants by weight', () => {
  const base = { ...ledgeSource, collision: undefined, variants: undefined, frame: 'ledge-{mask}' };
  for (const [change, message] of [
    [{ collision: 'yes' }, /autotile\.collision: expected true, or \{ inset, oneWay \}/],
    [{ collision: { inset: 2 } }, /autotile\.collision\.inset: expected a whole number of pixels from 0 to 1 \(under half the 4-pixel tile\)/],
    [{ collision: { inset: { top: 1 } } }, /autotile\.collision\.inset\.top: unknown or null field/],
    [{ collision: { oneWay: 1 } }, /autotile\.collision\.oneWay: expected true or false/],
    [{ frame: 'ledge-{mask}-{variant}', variants: [{ name: 'a', weight: 0.5 }] }, /autotile\.variants\[0\]\.weight: expected a whole number from 1 to 1000; weights are relative, so give common variants 10 and a rare one 1/]
  ]) assert.throws(() => compileAutotile({ ...base, ...change }), message, JSON.stringify(change));
  assert.equal(compileAutotile({ ...base, collision: false }).recipe.frames.some(frame => frame.tile), false);
  // Ground's insets are its edges' depths: 3 under the grass top, 1 at the sides, 2 above the roots.
  const ground = compileAutotile(groundSource);
  assert.deepEqual(ground.recipe.frames.find(frame => frame.name === 'ground-0-a').tile, { weight: 3, collision: [[1, 3], [15, 3], [15, 14], [1, 14]] });
  // Variants that draw one template share its weight in the test map.
  assert.deepEqual(ground.preview.frames[0].ops.find(op => op.op === 'tilemap').legend['#'], { templates: ['template', 'template-b', 'template-stones'], weights: [3, 3, 1], autotile: 'blob' });
  const shared = compileAutotile({ ...ledgeSource }).preview.frames[0].ops.at(-1).legend['#'];
  assert.deepEqual(shared, { template: 'template', autotile: 'blob' }, 'palette variants all draw the one template');
});
