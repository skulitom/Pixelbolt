// Tiled tilesets (.tsx): the sheet as Tiled's grid, terrains as Wang sets whose Wang ids are the tiles' neighbour masks,
// and each tile's probability, collision objects, oneWay property and animation. scripts/verify-tiled.mjs checks the
// same files in a real Tiled, whose terrain filler must choose Pixelbolt's tiles; these tests pin the text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compileAutotile } from '../src/authoring.js';
import { createBundle } from '../src/export.js';
import { createSceneBundle } from '../src/scene-export.js';
import { tiledTileset } from '../src/tiled.js';
import { tileSets } from '../src/godot.js';
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

// What the two engines' files offer from one sheet, as Tiled's tile ids: the tiles a terrain brush picks between (a
// Godot tile with a peering bit, a Tiled Wang tile; the lone cell's tile, mask 0, is neither) and the tiles that play.
const offered = (tres, tsx) => {
  const columns = Number(tsx.match(/ columns="(\d+)"/)[1]), count = Number(tsx.match(/ tilecount="(\d+)"/)[1]);
  const cells = pattern => [...new Set([...tres.matchAll(pattern)].map(match => match[1]))].map(cell => cell.split(':').map(Number)).map(([c, r]) => r * columns + c).sort((a, b) => a - b);
  return {
    godot: { brush: cells(/^(\d+:\d+)\/0\/terrains_peering_bit\//gm), plays: cells(/^(\d+:\d+)\/animation_frame_0\//gm) },
    tiled: { brush: [...tsx.matchAll(/<wangtile tileid="(\d+)"/g)].map(match => Number(match[1])).sort((a, b) => a - b), plays: Array.from({ length: count }, (_, id) => id).filter(id => tileOf(tsx, id)?.includes('<animation>')) }
  };
};
// An untrimmed atlas of 4×4 frames, four to a row.
const stripAtlas = (names, animations = {}) => ({ frames: Object.fromEntries(names.map((name, i) => [name, { frame: { x: (i % 4) * 4, y: Math.floor(i / 4) * 4, w: 4, h: 4 }, duration: 100 }])), animations, meta: { image: 'strip.png', size: { w: 16, h: Math.ceil(names.length / 4) * 4 } } });

test('a Tiled tileset offers its terrain brush the tiles the Godot TileSet offers its painter: one rule says which frames an animation takes', async () => {
  // An animation that plays once can't play in a tile of either: it is its first frame's tile, still, and its later
  // frames are no tiles (the .tsx had them as Wang tiles of their mask, three stills the brush picked between).
  const recipe = godotTileRecipe(GODOT_TILE_SOURCES[2]), once = { ...recipe, animations: { ...recipe.animations, 'surf-1': { ...recipe.animations['surf-1'], loop: false } } };
  const bundle = await createBundle(once), id = name => once.frames.findIndex(frame => frame.name === name);
  const surf = offered(bundle.files.get('surf.tileset.tres').toString(), bundle.files.get('surf.tsx').toString());
  assert.deepEqual(surf.tiled, surf.godot);
  assert.equal(surf.tiled.brush.length, 46);
  assert.deepEqual(['surf-1-a', 'surf-1-b', 'surf-1-c', 'surf-5-a'].map(name => [surf.tiled.brush.includes(id(name)), surf.tiled.plays.includes(id(name))]), [[true, false], [false, false], [false, false], [true, true]]);
  assert.deepEqual(bundle.project.warnings, ['surf.tileset.tres: animation surf-1 became still tiles of its first frame: Godot animates a tile by playing the frames after it in the sheet once each, in order, looping',
    'surf.tsx: animation surf-1 became still tiles of its first frame: Tiled loops every tile animation']);
  // Three frames of one mask and one of another. A frame that starts one animation and comes later in a second stays
  // the first one's tile, and the second is left out (in the .tsx, `a` played a, b and `b` was no Wang tile).
  const strip = animations => {
    const names = ['a', 'b', 'c', 'd'], source = { atlas: stripAtlas(names, animations), tiles: names.map(frame => ({ frame, mask: frame === 'd' ? 1 : 255, mode: 'blob' })), layered: [], plain: [], colors: {}, name: 'strip' };
    const godot = tileSets([source]), tiled = tiledTileset(source);
    return { ...offered(godot.text, tiled.text), text: tiled.text, warnings: [godot.warnings, tiled.warnings] };
  };
  const shared = strip({ one: { frames: ['b', 'c'], loop: true }, two: { frames: ['a', 'b'], loop: true } });
  assert.deepEqual([shared.godot, shared.tiled], Array(2).fill({ brush: [0, 1, 3], plays: [1] }));
  assert.deepEqual(shared.warnings.map(list => list.filter(warning => warning.startsWith('animation'))), [[], []]);
  // Two animations from one frame take the later frames of both. Godot plays the one in sheet order, and a Tiled tile
  // the first that loops, since it plays frames in any order; each says which it left still.
  const twice = strip({ one: { frames: ['a', 'c'], loop: true }, two: { frames: ['a', 'b'], loop: true } });
  assert.deepEqual([twice.godot, twice.tiled], Array(2).fill({ brush: [0, 3], plays: [0] }));
  assert.equal(tileOf(twice.text, 0), '<tile id="0">\n  <animation>\n   <frame tileid="0" duration="100"/>\n   <frame tileid="2" duration="100"/>\n  </animation>\n </tile>');
  assert.deepEqual(twice.warnings.map(list => list.filter(warning => warning.startsWith('animation'))), [['animation one became still tiles of its first frame: Godot animates a tile by playing the frames after it in the sheet once each, in order, looping'],
    ['animation two became still tiles of its first frame: its first frame already plays an earlier animation, and a Tiled tile plays one']]);
});

test('a warning names its terrain when the tileset has more than one, in whichever order they come', () => {
  // Two terrains, one mixing blob and cardinal masks, which gets no Wang set: the other's warning named its terrain
  // only when it came first.
  const tiles = { mix: [{ frame: 'm1', mask: 1, mode: 'blob', terrain: 'mix' }, { frame: 'm2', mask: 2, mode: 'cardinal', terrain: 'mix' }], ok: [{ frame: 'k1', mask: 1, mode: 'blob', terrain: 'ok' }, { frame: 'k2', mask: 255, mode: 'blob', terrain: 'ok' }] };
  for (const order of [['mix', 'ok'], ['ok', 'mix']]) {
    const list = order.flatMap(name => tiles[name]), { warnings } = tiledTileset({ atlas: stripAtlas(list.map(tile => tile.frame)), tiles: list, layered: [], plain: [], colors: {}, name: 'two' });
    assert.deepEqual(warnings.sort(), ['terrain mix: no Wang set: it mixes blob and cardinal masks, and a Tiled Wang set matches one way; give one set\'s frames another tile.terrain',
      'terrain ok: 44 of the 46 blob Wang tiles are missing, so Tiled draws its nearest match where one is needed'], order.join());
  }
  // One terrain needs no name.
  assert.deepEqual(tiledTileset({ atlas: stripAtlas(['k1', 'k2']), tiles: tiles.ok, layered: [], plain: [], colors: {}, name: 'one' }).warnings, ['44 of the 46 blob Wang tiles are missing, so Tiled draws its nearest match where one is needed']);
});

test('a sheet with no terrain plays every looping animation from its first frame, whatever else its frames are in', () => {
  // A sprite's tileset in a scene: no brush picks between its frames, so the rule that keeps an animation's frames off
  // the terrain brush does not hold a walk back for passing through the frame its idle starts on.
  const names = ['stand', 'blink', 'step', 'stride'], animations = { idle: { frames: ['stand', 'blink'], loop: true }, walk: { frames: ['step', 'stand', 'stride'], loop: true }, wave: { frames: ['stride', 'blink'], loop: false } };
  const { text, warnings } = tiledTileset({ atlas: stripAtlas(names, animations), tiles: [], layered: [], plain: names, colors: {}, name: 'sprite' }, { oneShots: false });
  const plays = id => [...(tileOf(text, id) ?? '').matchAll(/<frame tileid="(\d+)"/g)].map(match => Number(match[1]));
  assert.deepEqual([0, 1, 2, 3].map(plays), [[0, 1], [], [2, 0, 3], []]);
  assert.deepEqual(warnings, []);
  assert.doesNotMatch(text, /<wangsets>/);
});

test('a sheet with no terrain plays a looping animation that starts on, or passes through, an earlier one\'s later frame', () => {
  // P-132: an animation with any frame an earlier one passed through was left out, and said nothing.
  const names = ['f0', 'f1', 'f2', 'f3', 'f4'];
  const sheet = (animations, options) => tiledTileset({ atlas: stripAtlas(names, animations), tiles: [], layered: [], plain: names, colors: {}, name: 'sprite' }, options);
  const plays = text => names.map((_, id) => [...(tileOf(text, id) ?? '').matchAll(/<frame tileid="(\d+)"/g)].map(match => Number(match[1])));
  // An idle that starts on a walk's last frame: both play, whichever is listed first.
  const walk = { frames: ['f0', 'f1', 'f2'], loop: true }, idle = { frames: ['f2', 'f3'], loop: true };
  for (const animations of [{ walk, idle }, { idle, walk }]) assert.deepEqual(plays(sheet(animations, { oneShots: false }).text), [[0, 1, 2], [], [2, 3], [], []]);
  // One that starts on a fresh frame and passes through a frame of the walk.
  assert.deepEqual(plays(sheet({ step: { frames: ['f0', 'f1'], loop: true }, blink: { frames: ['f3', 'f1'], loop: true } }, { oneShots: false }).text), [[0, 1], [], [], [3, 1], []]);
  // What still can't play in a tile is named when the sheet asks for warnings (a tile set's plain tiles): a loop from a
  // frame that already plays one, and an animation that stops, though its frames are another's.
  const { text, warnings } = sheet({ walk, again: { frames: ['f0', 'f4'], loop: true }, hit: { frames: ['f4', 'f1'], loop: false } });
  assert.deepEqual(plays(text), [[0, 1, 2], [], [], [], []]);
  assert.deepEqual(warnings, ['animation hit became still tiles of its first frame: Tiled loops every tile animation', 'animation again became still tiles of its first frame: its first frame already plays an earlier animation, and a Tiled tile plays one']);
  // A frame that plays an animation is a tile of its own, so its weight counts, though another animation passes through it.
  const weighted = stripAtlas(names, { walk, idle });
  weighted.frames.f0.tile = { weight: 2 }; weighted.frames.f2.tile = { weight: 4 };
  const odds = tiledTileset({ atlas: weighted, tiles: [], layered: [], plain: names, colors: {}, name: 'sprite' }, { oneShots: false }).text;
  assert.deepEqual([0, 2].map(id => tileOf(odds, id).match(/probability="([\d.]+)"/)?.[1]), ['0.5', undefined]);
});

test('the iso glade\'s Tiled tileset plays both of its waters, the second four frames out of step', async () => {
  const { resolveReferences } = await import('../src/resolve.js');
  const source = JSON.parse(await readFile(new URL('../examples/iso-glade.scene.json', import.meta.url), 'utf8'));
  const { files } = await createSceneBundle((await resolveReferences(source, { baseDir: fileURLToPath(new URL('../examples/', import.meta.url)) })).document);
  const tsx = [...files].find(([name, data]) => name.endsWith('/tileset.tsx') && !name.includes('/haze-') && data.toString().includes('name="tiles"'))[1].toString();
  const plays = id => [...(tileOf(tsx, id) ?? '').matchAll(/<frame tileid="(\d+)"/g)].map(match => Number(match[1]));
  assert.deepEqual([plays(6), plays(8)], [[6, 7, 8, 9], [8, 9, 6, 7]]);
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

test('a shade placement has nothing in a Tiled map to become, and the export says so; a hazed one draws from a hazed tileset', async () => {
  const block = { version: 1, name: 'block', width: 4, height: 4, palette: { a: '#204020', b: '#408040', c: '#80c080' }, ramps: [['a', 'b', 'c']], frames: [{ name: 'f', ops: [{ op: 'rect', x: 0, y: 0, w: 4, h: 4, color: 'b' }] }] };
  const { files, warnings } = await createSceneBundle({ format: 'pixelforge-scene', version: 1, name: 'shaded', width: 12, height: 12, haze: { color: '#8090a0' }, assets: { block },
    instances: [{ name: 'floor', asset: 'block', at: [0, 0], repeat: [3, 3] }, { name: 'shadow', asset: 'block', at: [2, 2], shade: -1 }, { name: 'far', asset: 'block', at: [6, 6], haze: 0.5 }] });
  assert.deepEqual(warnings.filter(warning => warning.startsWith('scene.tmx')), ['scene.tmx: shadow: left out: a shade placement darkens what is drawn under it, which a Tiled map can\'t']);
  const map = files.get('scene.tmx').toString();
  assert.deepEqual(map.split('\n').filter(line => line.startsWith('  <object ')).map(line => line.match(/name="(\w+)" gid="(\d+)"/).slice(1).join(' ')), [...Array(9).fill('floor 1'), 'far 2']);
  assert.deepEqual(map.split('\n').filter(line => / <tileset /.test(line)), [' <tileset firstgid="1" source="assets/0/tileset.tsx"/>', ' <tileset firstgid="2" source="assets/0/haze-0.5/tileset.tsx"/>']);
  assert.match(files.get('assets/0/haze-0.5/tileset.tsx').toString(), /<tileset version="1\.10" name="block haze 0\.5" tilewidth="4" tileheight="4" tilecount="1" columns="1">\n <image source="color\.png" /);
});

test('a tilemap whose rule draws above or left of its first cell keeps every tile, the layer moved back by its offset', async () => {
  // At the scene's origin, a rule's offset of a row up put a cap at row -1, which threw a TypeError and stopped the
  // whole export; a column left lost the cap from the layer.
  const tile = { version: 1, name: 'tile', width: 4, height: 4, palette: { a: '#a07040', b: '#40a070' },
    frames: [{ name: 'post', ops: [{ op: 'rect', x: 0, y: 0, w: 4, h: 4, color: 'a' }] }, { name: 'cap', ops: [{ op: 'rect', x: 1, y: 1, w: 2, h: 2, color: 'b' }] }] };
  const layer = async offset => {
    const { files } = await createSceneBundle({ format: 'pixelforge-scene', version: 1, name: 'edge', width: 16, height: 16, assets: { tile },
      instances: [{ name: 'posts', asset: 'tile', at: [0, 0], tilemap: { tile: [4, 4], rows: ['#.#', '...'], legend: { '#': { rules: [{ frame: 'post' }, { frame: 'cap', offset }] } } } }] });
    const tmx = files.get('scene.tmx').toString();
    return [tmx.split('\n').find(line => line.startsWith(' <layer ')), tmx.split('<data encoding="csv">\n')[1].split('\n</data>')[0].split(',\n').slice(0, 2).map(row => row.split(',').map(Number))];
  };
  // Posts are gid 1, caps gid 2; a post at x 0 and 8 either way.
  assert.deepEqual(await layer([0, 1]), [' <layer id="1" name="posts" width="4" height="4">', [[1, 0, 1, 0], [2, 0, 2, 0]]]);
  assert.deepEqual(await layer([0, -1]), [' <layer id="1" name="posts" width="4" height="4" offsetx="0" offsety="-4">', [[2, 0, 2, 0], [1, 0, 1, 0]]]);
  assert.deepEqual(await layer([-1, 0]), [' <layer id="1" name="posts" width="4" height="4" offsetx="-4" offsety="0">', [[2, 1, 2, 1], [0, 0, 0, 0]]]);
  assert.deepEqual(await layer([-1, -1]), [' <layer id="1" name="posts" width="4" height="4" offsetx="-4" offsety="-4">', [[2, 0, 2, 0], [0, 1, 0, 1]]]);
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
