// Tiled tilesets (.tsx): the sheet as Tiled's grid, terrains as Wang sets whose Wang ids are the tiles' neighbour masks,
// and each tile's probability, collision objects, oneWay property and animation. scripts/verify-tiled.mjs checks the
// same files in a real Tiled, whose terrain filler must choose Pixelbolt's tiles; these tests pin the text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileAutotile } from '../src/authoring.js';
import { createBundle } from '../src/export.js';
import { createSceneBundle } from '../src/scene-export.js';
import { tiledTileset } from '../src/tiled.js';
import { GODOT_TILE_SOURCES, godotTileRecipe } from '../scripts/verify-godot.mjs';
import { tiledScene } from '../scripts/verify-tiled.mjs';
import { prepareScene, renderScene } from '../src/scene.js';
import { expandTilemap } from '../src/autotile.js';

const example = async name => JSON.parse(await readFile(new URL(`../examples/${name}.autotile.json`, import.meta.url), 'utf8'));
const tsx = async recipe => { const bundle = await createBundle(recipe); return { bundle, text: bundle.files.get(`${recipe.name}.tsx`)?.toString(), id: name => recipe.frames.findIndex(frame => frame.name === name) }; };
const wangOf = (text, id) => text.match(new RegExp(`<wangtile tileid="${id}" wangid="([^"]+)"/>`))?.[1];
const tileOf = (text, id) => text.match(new RegExp(`\\n <tile id="${id}"(?:[^>]*/>|[^>]*>[^]*?\\n </tile>)`))?.[0].trim();

test('a layered set exports a Tiled tileset on its sheet\'s grid, one corner Wang set whose colours are its terrains', async () => {
  const { recipe } = compileAutotile(await example('shore')), { bundle, text, id } = await tsx(recipe);
  assert.deepEqual(text.split('\n').slice(0, 3), ['<?xml version="1.0" encoding="UTF-8"?>', '<tileset version="1.10" name="shore" tilewidth="16" tileheight="16" tilecount="90" columns="9">', ' <image source="shore.png" width="144" height="160"/>']);
  assert.match(text, /<wangset name="shore" type="corner" tile="-1">\n   <wangcolor name="water" color="#2f6aa0" tile="0" probability="1"\/>\n   <wangcolor name="sand" color="#d9b97a" tile="40" probability="1"\/>\n   <wangcolor name="grass" color="#4f8a3f" tile="80" probability="1"\/>\n/);
  // Corners NW, NE, SW, SE at top-left, top-right, bottom-left and bottom-right of a Wang id (top, top-right, … top-left).
  assert.equal(wangOf(text, id('shore-wsgw')), '0,2,0,1,0,3,0,1');
  assert.equal(text.match(/<wangtile /g).length, 90);
  // A variant shares its plain tile's Wang id, at its weight against it.
  assert.deepEqual(['shore-wwww', 'shore-wwww-b', 'shore-wwww-lily'].map(name => wangOf(text, id(name))), Array(3).fill('0,1,0,1,0,1,0,1'));
  assert.match(tileOf(text, id('shore-wwww-lily')), /^<tile id="83" probability="0\.25">/);
  // Solid water: the tile's collision objects, in exported pixels.
  assert.equal(tileOf(text, id('shore-wsgw')), `<tile id="${id('shore-wsgw')}">\n  <objectgroup draworder="index" id="2">\n   <object id="1" x="0" y="0">\n    <polygon points="0,0 10,0 10,6 16,6 16,16 6,16 6,11 0,11"/>\n   </object>\n  </objectgroup>\n </tile>`);
  assert.match(bundle.files.get('README.txt').toString(), /\nshore\.tsx: Tiled tileset with the layered terrains water, sand and grass and their transitions, and collision shapes in each tile's collision group; it finds shore\.png in its own folder\n/);
  assert.match(bundle.files.get('README.txt').toString(), /\nTiled: in a map of 16×16 tiles, Map > Add External Tileset and pick shore\.tsx\. .* The layered terrains water, sand and grass are painted on the points where four cells meet/);
  assert.deepEqual(bundle.project.warnings, []);
});

test('blob, cardinal and corner sets become mixed, edge and corner Wang sets, their masks the Wang ids', async () => {
  const meadow = await example('meadow'), single = mode => compileAutotile({ ...meadow, mode, variants: undefined, frame: `meadow-${mode}-{mask}` }).recipe;
  const blob = await tsx(compileAutotile(meadow).recipe);
  assert.match(blob.text, /<wangset name="meadow" type="mixed" tile="184">\n   <wangcolor name="meadow" color="#4f8a3f" tile="184" probability="1"\/>/);
  // 46 masks × 4 variants: the lone cell's tile (mask 0) is no Wang tile, since Tiled's brush paints sides and corners.
  assert.equal(blob.text.match(/<wangtile /g).length, 184);
  assert.equal(wangOf(blob.text, blob.id('meadow-0-a')), undefined);
  assert.equal(wangOf(blob.text, blob.id('meadow-255-b')), '1,1,1,1,1,1,1,1');
  // N, E and S with the corner between N and E: top, top-right, right, bottom.
  assert.equal(wangOf(blob.text, blob.id('meadow-23-a')), '1,1,1,0,1,0,0,0');
  assert.match(tileOf(blob.text, blob.id('meadow-23-flowers')), /probability="0\.25"/);
  const cardinal = await tsx(single('cardinal'));
  assert.match(cardinal.text, /type="edge"/);
  assert.equal(wangOf(cardinal.text, cardinal.id('meadow-cardinal-5')), '1,0,0,0,1,0,0,0');
  const corner = await tsx(single('corner'));
  assert.match(corner.text, /type="corner"/);
  // NW and SE: top-left and bottom-right; the empty tile is none.
  assert.equal(wangOf(corner.text, corner.id('meadow-corner-9')), '0,0,0,1,0,0,0,1');
  assert.equal(wangOf(corner.text, corner.id('meadow-corner-0')), undefined);
  assert.equal(corner.text.match(/<wangtile /g).length, 15);
});

test('a looping animation animates its first tile, and one-way platforms, plain tiles and weights travel with the tiles', async () => {
  // The surf set animates each mask over its three variants, at their own durations, on a 4-pixel padded sheet.
  const surf = await tsx(godotTileRecipe(GODOT_TILE_SOURCES[2]));
  assert.equal(tileOf(surf.text, 0), '<tile id="0">\n  <animation>\n   <frame tileid="0" duration="120"/>\n   <frame tileid="1" duration="250"/>\n   <frame tileid="2" duration="90"/>\n  </animation>\n </tile>');
  // Its later frames are no Wang tiles, so the brush never places a still frame of it.
  assert.deepEqual([0, 1, 2, 3].map(id => wangOf(surf.text, id) !== undefined), [false, false, false, true]);
  assert.equal(wangOf(surf.text, surf.id('surf-1-a')), '1,0,0,0,0,0,0,0');
  const ledge = await tsx(godotTileRecipe(GODOT_TILE_SOURCES[3]));
  assert.match(ledge.text, /<tileset version="1\.10" name="ledge" tilewidth="12" tileheight="12" spacing="6" margin="3" tilecount="144" columns="9">/);
  assert.equal(tileOf(ledge.text, 0), '<tile id="0">\n  <properties>\n   <property name="oneWay" type="bool" value="true"/>\n  </properties>\n  <objectgroup draworder="index" id="2">\n   <object id="1" x="0" y="0">\n    <polygon points="3,3 9,3 9,12 3,12"/>\n   </object>\n  </objectgroup>\n </tile>');
  assert.match(tileOf(ledge.text, ledge.id('ledge-0-b')), /^<tile id="1" probability="0\.333333">/);
  // Plain tiles against the heaviest plain tile: the weighted rock and the sprout; an empty frame is no tile.
  assert.match(tileOf(ledge.text, ledge.id('rock')), /^<tile id="141">\n  <objectgroup draworder="index" id="2">\n   <object id="1" x="0" y="0">\n    <polygon points="0,6 6,0 12,6 6,12"\/>/);
  assert.equal(tileOf(ledge.text, ledge.id('sprout')), '<tile id="142" probability="0.333333"/>');
  assert.equal(tileOf(ledge.text, ledge.id('blank')), undefined);
});

test('a sheet without a grid, or a terrain matching two ways, is reported instead of guessed', async () => {
  const { recipe } = compileAutotile(GODOT_TILE_SOURCES[0]);
  const trimmed = await createBundle({ ...recipe, sheet: { ...recipe.sheet, trim: true } });
  assert.equal(trimmed.files.has('turf.tsx'), false);
  // A blob frame and a corner frame of one terrain: Tiled's Wang set matches one way, so there is none.
  const { atlas } = await createBundle(recipe), first = Object.keys(atlas.metadata.frames);
  const mixed = tiledTileset({ atlas: atlas.metadata, margin: 2, separation: 4, name: 'turf', tiles: [{ frame: first[1], mask: 1, mode: 'blob' }, { frame: first[2], mask: 1, mode: 'corner' }], layered: [], plain: [], colors: {} });
  assert.deepEqual(mixed.warnings, ['terrain turf: no Wang set: it mixes blob and corner masks, and a Tiled Wang set matches one way; give one set\'s frames another tile.terrain']);
  assert.doesNotMatch(mixed.text, /<wangset/);
  const moved = { ...atlas.metadata, frames: { ...atlas.metadata.frames, [first[0]]: { ...atlas.metadata.frames[first[0]], frame: { ...atlas.metadata.frames[first[0]].frame, x: 1 } } } };
  assert.deepEqual(tiledTileset({ atlas: moved, name: 'turf', tiles: [], layered: [], plain: [], colors: {} }), { text: null, warnings: ['not written: a Tiled tileset cuts its image into a grid, and this sheet has none (a trimmed sheet packs frames without one)'] });
});

test('a scene export writes a Tiled tileset beside each tile-set asset\'s colour pass', async () => {
  const [fence, moss] = [{ ...GODOT_TILE_SOURCES[1], sheet: { scale: 3 } }, GODOT_TILE_SOURCES[4]].map(godotTileRecipe);
  const { files, warnings } = await createSceneBundle({ format: 'pixelforge-scene', version: 1, name: 'tiles', width: 16, height: 16, assets: { fence, moss }, instances: [] });
  assert.deepEqual(warnings, []);
  const alignment = JSON.parse(files.get('alignment.json'));
  assert.deepEqual([alignment.assets.fence.tiled, alignment.assets.moss.tiled], ['assets/0/tileset.tsx', 'assets/1/tileset.tsx']);
  assert.match(files.get('assets/0/tileset.tsx').toString(), /<tileset version="1\.10" name="fence" [^>]*>\n <image source="color\.png" /);
  assert.match(files.get('assets/1/tileset.tsx').toString(), /<wangset name="moss" type="corner"/);
});

// ---- Scenes as Tiled maps ----
const fail = (where, message) => { throw new Error(`${where}: ${message}`); };

test('a scene export maps the scene at its start into Tiled: tile layers where the grid holds a tilemap, tile objects in drawing order', async () => {
  const { files, warnings } = await createSceneBundle(await tiledScene()), tmx = files.get('scene.tmx').toString();
  assert.deepEqual(warnings.filter(warning => warning.startsWith('scene.tmx')), []);
  assert.equal(JSON.parse(files.get('alignment.json')).tiled, 'scene.tmx');
  assert.match(tmx, /<map version="1\.10" orientation="orthogonal" renderorder="right-down" width="25" height="18" tilewidth="4" tileheight="4" infinite="0" backgroundcolor="#203040" nextlayerid="7" nextobjectid="17">/);
  assert.deepEqual(tmx.split('\n').filter(line => / <tileset /.test(line)), [1, 49, 81, 171, 203, 205].map((first, i) => ` <tileset firstgid="${first}" source="assets/${i}/tileset.tsx"/>`));
  // The corner maps half a cell up and left; the posts, 8 pixels tall on 4-pixel cells at y 34, a cell lower and up
  // the 2 pixels left over. The fence's sheet is exported at 3× and the grove sorts among the walker: objects.
  assert.deepEqual(tmx.split('\n').filter(line => /^ <(layer|objectgroup) /.test(line)), [
    ' <layer id="1" name="sea" width="25" height="18" offsetx="-2" offsety="-2">', ' <layer id="2" name="moss" width="25" height="18" offsetx="-2" offsety="-2">',
    ' <layer id="3" name="turf" width="25" height="18">', ' <objectgroup draworder="index" id="4" name="fence">', ' <layer id="5" name="posts" width="25" height="18" offsetx="0" offsety="-2">',
    ' <objectgroup draworder="index" id="6" name="grove, walker, spirit, wisps">']);
  const data = name => tmx.split(`name="${name}"`)[1].split('<data encoding="csv">\n')[1].split('\n</data>')[0].split(',\n').map(row => row.split(',').map(Number));
  // The sea's top row of points is plain water or its glint (gids 81 and 162); the posts' cells moved by whole cells.
  assert.ok(data('sea')[0].length === 25 && data('sea')[0].every(gid => gid === 81 || gid === 162));
  assert.ok(data('sea')[0].includes(162));
  assert.deepEqual([data('posts')[10].slice(9, 12), data('posts')[12].slice(9, 12), data('posts')[11].slice(9, 12)], [[203, 0, 203], [203, 204, 203], [0, 0, 0]]);
  // A tile object stands on its bottom-left corner, at the size it is drawn: the walker anchored at its feet, the 2×
  // spirit, sorted grove cells round the walker by their ground lines.
  const objects = tmx.split('\n').filter(line => line.startsWith('  <object '));
  assert.deepEqual(objects.slice(6, 11), ['  <object id="7" name="grove" gid="203" x="70" y="58" width="4" height="8"/>', '  <object id="8" name="grove" gid="203" x="78" y="58" width="4" height="8"/>',
    '  <object id="9" name="walker" gid="205" x="60" y="61" width="24" height="24"/>', '  <object id="10" name="grove" gid="203" x="74" y="62" width="4" height="8"/>', '  <object id="11" name="grove" gid="203" x="82" y="62" width="4" height="8"/>']);
  assert.equal(objects[13], '  <object id="14" name="spirit" gid="205" x="44" y="50" width="48" height="48"/>');
  // A sprite's tileset: its frames as tiles, a looping animation on its first frame, no terrain.
  const spirit = files.get('assets/5/tileset.tsx').toString();
  assert.match(spirit, /<tileset version="1\.10" name="spirit" tilewidth="24" tileheight="24" spacing="2" margin="1" tilecount="6" columns="6">\n <image source="color\.png" width="156" height="26"\/>\n <tile id="0">\n  <animation>\n   <frame tileid="0" duration="240"\/>/);
  assert.doesNotMatch(spirit, /<wangsets>/);
});

test('shade and haze have nothing in a Tiled map to become, and the export says so', async () => {
  const block = { version: 1, name: 'block', width: 4, height: 4, palette: { a: '#204020', b: '#408040', c: '#80c080' }, ramps: [['a', 'b', 'c']], frames: [{ name: 'f', ops: [{ op: 'rect', x: 0, y: 0, w: 4, h: 4, color: 'b' }] }] };
  const { files, warnings } = await createSceneBundle({ format: 'pixelforge-scene', version: 1, name: 'shaded', width: 12, height: 12, haze: { color: '#8090a0' }, assets: { block },
    instances: [{ name: 'floor', asset: 'block', at: [0, 0], repeat: [3, 3] }, { name: 'shadow', asset: 'block', at: [2, 2], shade: -1 }, { name: 'far', asset: 'block', at: [6, 6], haze: 0.5 }] });
  assert.deepEqual(warnings.filter(warning => warning.startsWith('scene.tmx')), ['scene.tmx: shadow: left out: a shade placement darkens what is drawn under it, which a Tiled map can\'t', 'scene.tmx: far: drawn without haze, which a Tiled map has no way to give']);
  assert.deepEqual(files.get('scene.tmx').toString().split('\n').filter(line => line.startsWith('  <object ')).map(line => line.match(/name="(\w+)"/)[1]), [...Array(9).fill('floor'), 'far']);
});

test('names are written as XML can hold them: markup escaped, tabs and line breaks as references, other control characters replaced', async () => {
  const block = { version: 1, name: 'block', width: 4, height: 4, frames: [{ name: 'f', ops: [{ op: 'rect', x: 0, y: 0, w: 4, h: 4, color: '#408040' }] }] };
  const { files } = await createSceneBundle({ format: 'pixelforge-scene', version: 1, name: 'named', width: 8, height: 8, assets: { 'a&b "<c>"': block },
    instances: [{ name: 'bell\u0007 \ud800', asset: 'a&b "<c>"', at: [0, 0] }, { name: 'two\tlines\nhere', asset: 'a&b "<c>"', at: [4, 4] }] });
  const map = files.get('scene.tmx').toString(), tsx = files.get('assets/0/tileset.tsx').toString();
  assert.match(map, /<objectgroup draworder="index" id="1" name="bell\ufffd \ufffd, two&#9;lines&#10;here">/);
  assert.match(map, /<object id="1" name="bell\ufffd \ufffd" gid="1" x="0" y="4" width="4" height="4"\/>/);
  assert.match(tsx, /<tileset version="1\.10" name="a&amp;b &quot;&lt;c&gt;&quot;" /);
  assert.doesNotMatch(map + tsx, /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/);
});

test('renderScene lists what it drew, in drawing order, for the Tiled map', async () => {
  const scene = prepareScene(await tiledScene()), view = renderScene(scene, { lit: false, draws: true }), name = draw => scene.instances[draw.instance].name;
  assert.equal(renderScene(scene).draws, undefined);
  assert.deepEqual(view.draws.find(draw => name(draw) === 'spirit'), { instance: 7, asset: 'spirit', frame: 0, x: 44, y: 2, scale: 2, shift: [0, 0] });
  assert.deepEqual(view.draws.find(draw => name(draw) === 'moss'), { instance: 1, cell: 0, asset: 'moss', frame: view.draws.find(draw => name(draw) === 'moss').frame, x: 10, y: 34, scale: 1, shift: [0, 0] });
  // The sorted grove and walker draw by their ground lines.
  assert.deepEqual(view.draws.filter(draw => ['grove', 'walker'].includes(name(draw))).map(name), ['grove', 'grove', 'walker', 'grove', 'grove', 'grove', 'grove']);
  assert.throws(() => renderScene(scene, { draws: 'yes' }), /scene\.draws: expected a boolean/);
});

test('a layered map draws the tile at each point once, whichever terrains\' entries find it', () => {
  const legend = { w: { frame: 'shore-{corners}', autotile: 'corner' }, s: { frame: 'shore-{corners}', autotile: 'corner' } };
  const cells = expandTilemap({ rows: ['ws', 'sw'], legend }, { path: 'map', fail, kinds: ['frame'], text: 'frame', masked: () => true, exists: () => true }).cells;
  // One tile per point, named by the cells around it (past the edge, the nearest cell).
  const rows = ['ws', 'sw'], at = (x, y) => rows[Math.min(Math.max(y, 0), 1)][Math.min(Math.max(x, 0), 1)];
  const want = [0, 1, 2].flatMap(y => [0, 1, 2].map(x => `${x - 0.5},${y - 0.5} shore-${at(x - 1, y - 1)}${at(x, y - 1)}${at(x - 1, y)}${at(x, y)}`));
  assert.deepEqual(cells.map(cell => `${cell.x},${cell.y} ${cell.name}`), want);
});
