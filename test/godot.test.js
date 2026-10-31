import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderProject, buildAtlas, frameTag } from '../src/core.js';
import { createBundle } from '../src/export.js';
import { createSceneBundle } from '../src/scene-export.js';
import { spriteFrames, godotTiming, GODOT_MAX_FPS, tileSet, retexture, canvasTexture, normalsYUp, resourceIds } from '../src/godot.js';
import { compileAutotile } from '../src/authoring.js';
import { autotileFrames } from '../src/autotile.js';
import { decodePNG } from '../src/import.js';
import { GODOT_FIXTURE, GODOT_TILE_SOURCES, GODOT_LIT_SCENE, replaySprite } from '../scripts/verify-godot.mjs';

const spirit = JSON.parse(await readFile(new URL('../examples/forest-spirit.json', import.meta.url), 'utf8'));
const tiny = { version: 1, name: 'tiny', width: 2, height: 1, frames: [{ name: 'a', duration: 80, ops: [{ op: 'pixel', color: '#f00' }] }, { name: 'b', duration: 120, ops: [{ op: 'pixel', x: 1, color: '#00f8' }] }], animations: { once: { frames: ['a', 'b'], loop: false } }, sheet: { columns: 1, padding: 1 } };

// Reads a SpriteFrames .tres back: its header, ext_resources, each AtlasTexture's properties and the animations array
// (Godot's syntax turned into JSON: &"name" is a StringName, SubResource("id") a reference).
function readTres(text) {
  const header = /^\[gd_resource type="SpriteFrames" format=3\]\n\n/.exec(text);
  assert.ok(header, text.slice(0, 80));
  const attrs = tag => Object.fromEntries([...tag.matchAll(/(\w+)=("(?:[^"\\]|\\.)*"|[^\s\]]+)/g)].map(([, key, value]) => [key, value.startsWith('"') ? JSON.parse(value) : value]));
  const ext = [...text.matchAll(/^\[ext_resource ([^\n]*)\]$/gm)].map(([, tag]) => attrs(tag));
  const subs = Object.fromEntries([...text.matchAll(/^\[sub_resource ([^\n]*)\]\n((?:[a-z_]+ = [^\n]*\n)*)/gm)].map(([, tag, body]) => {
    const { type, id } = attrs(tag), props = Object.fromEntries(body.trim().split('\n').map(line => line.split(' = ')));
    const rect = value => value && /^Rect2\(([-\d, ]+)\)$/.exec(value)[1].split(', ').map(Number);
    return [id, { type, atlas: props.atlas, region: rect(props.region), margin: rect(props.margin), filter_clip: props.filter_clip }];
  }));
  const resource = /\n\[resource\]\nanimations = (\[[\s\S]*\])\n$/.exec(text);
  assert.ok(resource, 'a [resource] section with animations, last');
  const animations = JSON.parse(resource[1].replace(/SubResource\(("[^"]*")\)/g, '$1').replace(/&"/g, '"'));
  return { ext, subs, animations };
}

test('the atlas carries Aseprite-style frame tags for animations that play one run of frames, next to the unchanged animations', () => {
  const { metadata } = buildAtlas(renderProject(spirit));
  // Existing fields keep their names, order and values; frameTags is added last in meta.
  assert.deepEqual(Object.keys(metadata), ['frames', 'animations', 'meta']);
  assert.deepEqual(Object.keys(metadata.meta), ['app', 'version', 'image', 'format', 'size', 'scale', 'frameTags']);
  assert.deepEqual(metadata.animations.bob, { frames: ['rest', 'rise', 'float', 'rise'], loop: true, duration: 740 });
  assert.deepEqual(Object.keys(metadata.frames.rest), ['frame', 'rotated', 'trimmed', 'spriteSourceSize', 'sourceSize', 'duration']);
  // bob is rest, rise, float as a ping-pong; idle and blink hold and skip frames, which a from/to range can't say.
  assert.deepEqual(metadata.meta.frameTags, [{ name: 'bob', from: 0, to: 2, direction: 'pingpong' }]);
  assert.deepEqual(buildAtlas(renderProject(GODOT_FIXTURE)).metadata.meta.frameTags, [
    { name: 'walk', from: 0, to: 2, direction: 'forward' },
    { name: 'flicker', from: 3, to: 4, direction: 'forward' },
    { name: 'back', from: 0, to: 2, direction: 'reverse' },
    { name: 'sway', from: 0, to: 2, direction: 'pingpong' }
  ]);
  // A recipe without animations gets its default animation over every frame.
  assert.deepEqual(buildAtlas(renderProject({ ...tiny, animations: undefined })).metadata.meta.frameTags, [{ name: 'default', from: 0, to: 1, direction: 'forward' }]);
});

test('frame tags name a run forward, backward or ping-pong, and nothing else', () => {
  assert.deepEqual(frameTag('one', [3]), { name: 'one', from: 3, to: 3, direction: 'forward' });
  assert.deepEqual(frameTag('two', [4, 5]), { name: 'two', from: 4, to: 5, direction: 'forward' });
  assert.deepEqual(frameTag('down', [5, 4, 3]), { name: 'down', from: 3, to: 5, direction: 'reverse' });
  assert.deepEqual(frameTag('pp', [1, 2, 3, 4, 3, 2]), { name: 'pp', from: 1, to: 4, direction: 'pingpong' });
  for (const sequence of [[0, 0], [0, 2], [0, 1, 0], [0, 1, 2, 1, 0], [0, 1, 2, 2, 1], [2, 1, 2, 3], [0, 1, 3, 2]]) assert.equal(frameTag('x', sequence), null, JSON.stringify(sequence));
});

test('Godot timing: whole-number durations at 1000 ÷ the shared step, the shortest frame when that passes 120 FPS', () => {
  assert.deepEqual(godotTiming([100, 100, 100]), { speed: 10, durations: [1, 1, 1], exact: true });
  assert.deepEqual(godotTiming([100, 100, 200]), { speed: 10, durations: [1, 1, 2], exact: true });
  assert.deepEqual(godotTiming([240, 140, 220, 140]), { speed: 50, durations: [12, 7, 11, 7], exact: true });
  assert.deepEqual(godotTiming([30, 30, 60]), { speed: 1000 / 30, durations: [1, 1, 2], exact: true });
  assert.deepEqual(godotTiming([60000]), { speed: 1000 / 60000, durations: [1], exact: true });
  // Steps under 9 ms would need more than 120 FPS.
  assert.deepEqual(godotTiming([10, 15]), { speed: 100, durations: [1, 1.5], exact: true });
  assert.deepEqual(godotTiming([33, 34]), { speed: 1000 / 33, durations: [1, 34 / 33], exact: false });
  assert.deepEqual(godotTiming([5, 100]), { speed: GODOT_MAX_FPS, durations: [0.6, 12], exact: false });
  // Every frame lasts its milliseconds: exactly when `exact`, otherwise within Godot's 32-bit float of the duration.
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let n = 0; n < 2000; n++) {
    const ms = Array.from({ length: 1 + Math.floor(random() * 6) }, () => 1 + Math.floor(random() ** 3 * (random() < 0.2 ? 60000 : 400)));
    const { speed, durations, exact } = godotTiming(ms);
    assert.ok(speed > 0 && speed <= GODOT_MAX_FPS, `${ms}: ${speed} FPS`);
    durations.forEach((duration, i) => {
      assert.ok(duration >= 0.01, `${ms}: Godot raises durations under 0.01`);
      const played = Math.fround(duration) / speed * 1000;
      assert.ok(Math.abs(played - ms[i]) <= ms[i] * (exact ? 1e-12 : 1e-7), `${ms}: frame ${i} plays ${played} ms`);
    });
  }
});

test('a SpriteFrames .tres is written as Godot 4 writes one: the sheet beside it, one AtlasTexture per frame, timing per animation', async () => {
  const bundle = await createBundle(tiny);
  assert.deepEqual([...bundle.files.keys()].slice(0, 3), ['tiny.png', 'tiny.atlas.json', 'tiny.tres']);
  assert.equal(bundle.files.get('tiny.tres').toString(), `[gd_resource type="SpriteFrames" format=3]

[ext_resource type="Texture2D" path="tiny.png" id="1_sheet"]

[sub_resource type="AtlasTexture" id="AtlasTexture_a"]
atlas = ExtResource("1_sheet")
region = Rect2(1, 1, 2, 1)
filter_clip = true

[sub_resource type="AtlasTexture" id="AtlasTexture_b"]
atlas = ExtResource("1_sheet")
region = Rect2(1, 4, 2, 1)
filter_clip = true

[resource]
animations = [{
"frames": [{
"duration": 2.0,
"texture": SubResource("AtlasTexture_a")
}, {
"duration": 3.0,
"texture": SubResource("AtlasTexture_b")
}],
"loop": false,
"name": &"once",
"speed": 25.0
}]
`);
  assert.deepEqual(bundle.project.warnings, []);
  const readme = bundle.files.get('README.txt').toString();
  assert.match(readme, /tiny\.tres: Godot 4 SpriteFrames; it finds tiny\.png in its own folder/);
  assert.match(readme, /Godot 4: copy tiny\.png and tiny\.tres into one folder of your project/);
});

test('the forest spirit .tres has every animation in recipe order with its frames, loop and exact timing', async () => {
  const bundle = await createBundle(spirit), atlas = JSON.parse(bundle.files.get('forest-spirit.atlas.json'));
  const { ext, subs, animations } = readTres(bundle.files.get('forest-spirit.tres').toString());
  assert.deepEqual(ext, [{ type: 'Texture2D', path: 'forest-spirit.png', id: '1_sheet' }]);
  // Each frame an animation plays, once, in recipe order, cut from its atlas rectangle; untrimmed frames need no margin.
  assert.deepEqual(Object.keys(subs), Object.keys(atlas.frames).map(name => `AtlasTexture_${name}`));
  for (const [name, { frame }] of Object.entries(atlas.frames)) assert.deepEqual(subs[`AtlasTexture_${name}`], { type: 'AtlasTexture', atlas: 'ExtResource("1_sheet")', region: [frame.x, frame.y, frame.w, frame.h], margin: undefined, filter_clip: 'true' });
  assert.deepEqual(animations.map(animation => animation.name), ['idle', 'bob', 'blink']);
  for (const animation of animations) {
    const source = atlas.animations[animation.name];
    assert.equal(animation.loop, source.loop);
    assert.deepEqual(animation.frames.map(frame => frame.texture), source.frames.map(name => `AtlasTexture_${name}`));
    animation.frames.forEach((frame, i) => assert.equal(frame.duration / animation.speed * 1000, atlas.frames[source.frames[i]].duration));
    assert.ok(animation.frames.every(frame => Number.isInteger(frame.duration)));
  }
  assert.deepEqual(animations.map(animation => animation.speed), [50, 50, 50]);
});

test('a trimmed sheet keeps every frame the canvas size: margins put the visible pixels back where they were', async () => {
  const bundle = await createBundle(GODOT_FIXTURE), atlas = JSON.parse(bundle.files.get('godot-trim.atlas.json'));
  const { subs, animations } = readTres(bundle.files.get('godot-trim.tres').toString());
  assert.deepEqual(subs.AtlasTexture_dot, { type: 'AtlasTexture', atlas: 'ExtResource("1_sheet")', region: [atlas.frames.dot.frame.x, atlas.frames.dot.frame.y, 4, 6], margin: [2, 4, 20, 14], filter_clip: 'true' });
  // An empty frame is a 1×1 cell (2×2 at scale 2) inside a margin the size of the canvas.
  assert.deepEqual(subs.AtlasTexture_gap.margin, [0, 0, 22, 18]);
  assert.deepEqual(subs.AtlasTexture_gap.region.slice(2), [2, 2]);
  // A frame that fills the canvas is trimmed to nothing and needs no margin.
  assert.equal(subs.AtlasTexture_full.margin, undefined);
  for (const [name, frame] of Object.entries(atlas.frames)) {
    const { region, margin = [0, 0, 0, 0] } = subs[`AtlasTexture_${name.replace(/-/g, '_')}`];
    assert.equal(frame.trimmed, true);
    assert.deepEqual(region, [frame.frame.x, frame.frame.y, frame.frame.w, frame.frame.h], name);
    assert.deepEqual([margin[0], margin[1]], [frame.spriteSourceSize.x, frame.spriteSourceSize.y], name);
    assert.deepEqual([region[2] + margin[2], region[3] + margin[3]], [24, 20], `${name}: AtlasTexture size is region + margin size`);
  }
  // Unequal durations: 100, 150 and 250 ms at 20 FPS; 33 and 34 ms at 1000/33 FPS; a 5 ms flash at 120 FPS.
  const byName = Object.fromEntries(animations.map(animation => [animation.name, animation]));
  assert.deepEqual([byName.walk.speed, byName.walk.frames.map(frame => frame.duration)], [20, [2, 3, 5]]);
  assert.deepEqual([byName.back.speed, byName.back.frames.map(frame => frame.duration)], [20, [5, 3, 2]]);
  assert.deepEqual([byName.sway.speed, byName.sway.frames.map(frame => frame.texture)], [20, ['AtlasTexture_dot', 'AtlasTexture_bar', 'AtlasTexture_gap', 'AtlasTexture_bar']]);
  assert.deepEqual([byName.flicker.speed, byName.flicker.frames.map(frame => frame.duration)], [1000 / 33, [1, 34 / 33]]);
  assert.deepEqual([byName.strobe.speed, byName.strobe.loop, byName.strobe.frames.map(frame => frame.duration)], [120, false, [0.6, 12]]);
  // The fractional durations are reported once, naming the animations.
  assert.deepEqual(bundle.project.warnings.filter(text => text.startsWith('godot-trim.tres')), ['godot-trim.tres: the frame times of animations flicker, strobe, hold share no step of 9 ms or more, so Godot gets fractional frame durations, kept as 32-bit floats: each frame plays within a ten-millionth of its length. Frame times in multiples of 10 ms are exact.']);
});

test('sub-resource ids are what Godot accepts: hyphens become underscores, a clash gets a number, valid names keep theirs', async () => {
  assert.deepEqual(Object.fromEntries(resourceIds(['rest', 'fireball-0-1', 'a-b', 'a_b', 'a_b_2', 'A-b'], 'AtlasTexture')), {
    rest: 'AtlasTexture_rest', 'fireball-0-1': 'AtlasTexture_fireball_0_1', 'a-b': 'AtlasTexture_a_b_3',
    a_b: 'AtlasTexture_a_b', a_b_2: 'AtlasTexture_a_b_2', 'A-b': 'AtlasTexture_A_b'
  });
  // A recipe whose frames clash once hyphens are underscores: every id is valid and unique, and every animation frame
  // still names its own frame's rectangle.
  const clash = { version: 1, name: 'clash', width: 2, height: 2, palette: { r: '#f00', b: '#00f' },
    frames: [{ name: 'hit-1', duration: 50, ops: [{ op: 'pixel', color: 'r' }] }, { name: 'hit_1', duration: 50, ops: [{ op: 'pixel', x: 1, color: 'b' }] }, { name: 'hit-2', duration: 100, ops: [{ op: 'pixel', y: 1, color: 'r' }] }],
    animations: { hit: { frames: ['hit-1', 'hit_1', 'hit-2', 'hit-1'] } } };
  const bundle = await createBundle(clash), atlas = JSON.parse(bundle.files.get('clash.atlas.json'));
  const { subs, animations } = readTres(bundle.files.get('clash.tres').toString());
  assert.deepEqual(Object.keys(subs), ['AtlasTexture_hit_1_2', 'AtlasTexture_hit_1', 'AtlasTexture_hit_2']);
  assert.ok(Object.keys(subs).every(id => /^[A-Za-z0-9_]+$/.test(id)));
  const regionOf = name => { const { x, y, w, h } = atlas.frames[name].frame; return [x, y, w, h]; };
  assert.deepEqual(animations[0].frames.map(frame => subs[frame.texture].region), clash.animations.hit.frames.map(regionOf));
  // The effects and autotile sets Pixelbolt compiles name frames with hyphens.
  for (const recipe of [GODOT_FIXTURE, spirit]) {
    const text = (await createBundle(recipe)).files.get(`${recipe.name}.tres`).toString();
    assert.deepEqual([...text.matchAll(/ id="([^"]*)"/g)].map(([, id]) => id).filter(id => !/^[A-Za-z0-9_]+$/.test(id)), [], recipe.name);
  }
});

test('the sheet path is quoted for Godot, and the same atlas always gives the same bytes', async () => {
  const { metadata } = buildAtlas(renderProject(tiny));
  assert.match(spriteFrames(metadata, { image: '../art/a "b"\\c.png' }).text, /\[ext_resource type="Texture2D" path="\.\.\/art\/a \\"b\\"\\\\c\.png" id="1_sheet"\]/);
  const [a, b] = await Promise.all([createBundle(GODOT_FIXTURE), createBundle(GODOT_FIXTURE)]);
  assert.deepEqual(a.files.get('godot-trim.tres'), b.files.get('godot-trim.tres'));
  assert.deepEqual(a.files.get('godot-trim.atlas.json'), b.files.get('godot-trim.atlas.json'));
});

test('a scene export gives each asset a SpriteFrames over its colour pass, named in alignment.json', async () => {
  const scene = { format: 'pixelforge-scene', version: 1, name: 'pair', width: 8, height: 4, assets: { hero: tiny }, instances: [{ asset: 'hero', at: [1, 1], animation: 'once' }] };
  const bundle = await createSceneBundle(scene), alignment = JSON.parse(bundle.files.get('alignment.json'));
  assert.equal(alignment.assets.hero.godot, 'assets/0/sprite_frames.tres');
  const atlas = JSON.parse(bundle.files.get('assets/0/atlas.json')), { ext, animations } = readTres(bundle.files.get('assets/0/sprite_frames.tres').toString());
  assert.deepEqual(ext, [{ type: 'Texture2D', path: 'color.png', id: '1_sheet' }]);
  assert.deepEqual(animations.map(animation => animation.name), Object.keys(atlas.animations));
  // Without a normal pass there is nothing for a CanvasTexture to add.
  assert.equal([...bundle.files.keys()].some(file => /canvas_texture|normal_y_up/.test(file)), false);
  assert.equal(alignment.assets.hero.canvasTexture, undefined);
});

test('a lit scene asset gets its normal pass flipped to +Y up and a CanvasTexture its SpriteFrames draws through', async () => {
  const bundle = await createSceneBundle(GODOT_LIT_SCENE), alignment = JSON.parse(bundle.files.get('alignment.json'));
  assert.deepEqual(alignment.assets.orb, {
    directory: 'assets/0', metadata: 'assets/0/atlas.json', godot: 'assets/0/sprite_frames.tres',
    passes: { color: 'assets/0/color.png', normal: 'assets/0/normal.png', normalYUp: 'assets/0/normal_y_up.png' }, canvasTexture: 'assets/0/canvas_texture.tres'
  });
  assert.match(alignment.coordinates, /normalYUp flips green to \+Y up/);
  // Laid out as Godot 4.6 saves a CanvasTexture, with nearest filtering.
  assert.equal(bundle.files.get('assets/0/canvas_texture.tres').toString(), '[gd_resource type="CanvasTexture" format=3]\n\n[ext_resource type="Texture2D" path="color.png" id="1_diffuse"]\n[ext_resource type="Texture2D" path="normal_y_up.png" id="2_normal"]\n\n[resource]\ndiffuse_texture = ExtResource("1_diffuse")\nnormal_texture = ExtResource("2_normal")\ntexture_filter = 1\n');
  assert.equal(bundle.files.get('assets/0/canvas_texture.tres').toString(), canvasTexture({ diffuse: 'color.png', normal: 'normal_y_up.png' }));
  // The SpriteFrames names the CanvasTexture as its sheet; its frames and timing are unchanged.
  const { ext, subs, animations } = readTres(bundle.files.get('assets/0/sprite_frames.tres').toString());
  assert.deepEqual(ext, [{ type: 'Texture2D', path: 'canvas_texture.tres', id: '1_sheet' }]);
  const atlas = JSON.parse(bundle.files.get('assets/0/atlas.json'));
  assert.deepEqual(Object.values(subs).map(sub => sub.region), Object.values(atlas.frames).map(({ frame: { x, y, w, h } }) => [x, y, w, h]));
  assert.deepEqual(animations, readTres(spriteFrames(atlas).text).animations);
  // Every visible pixel keeps red, blue and alpha and flips green; transparent pixels are untouched.
  const down = decodePNG(bundle.files.get('assets/0/normal.png')), up = decodePNG(bundle.files.get('assets/0/normal_y_up.png'));
  assert.deepEqual([up.width, up.height], [down.width, down.height]);
  let visible = 0;
  for (let i = 0; i < down.data.length; i += 4) {
    const want = down.data[i + 3] ? [down.data[i], 255 - down.data[i + 1], down.data[i + 2], down.data[i + 3]] : [...down.data.subarray(i, i + 4)];
    assert.deepEqual([...up.data.subarray(i, i + 4)], want, `pixel ${i / 4}`);
    if (down.data[i + 3]) visible++;
  }
  assert.ok(visible > 0);
  // A pixel facing up (+Y down: y = −1, green 0) faces up in Godot's reading (green 255), and one facing the viewer stays.
  assert.deepEqual([...normalsYUp(new Uint8ClampedArray([128, 0, 221, 255, 128, 128, 255, 255, 9, 9, 9, 0]))], [128, 255, 221, 255, 128, 127, 255, 255, 9, 9, 9, 0]);
});

test('the Godot playback replay matches Godot 4.6, which runs the rest of a step after a frame change at the old speed', () => {
  // A 5 ms flash then a 100 ms frame, at 120 FPS, in 1 ms steps: Godot 4.6 plays the first millisecond of the long frame
  // at the flash's rate, so it ends 19 ms early (godotengine/godot#123572); with the fix it ends on time.
  const steps = Array(120).fill(1);
  assert.deepEqual(replaySprite(120, [0.6, 12], false, steps), [[5, 1], [86, -1]]);
  assert.deepEqual(replaySprite(120, [0.6, 12], false, steps, { stale: false }), [[5, 1], [105, -1]]);
});

// ---- Tile sets ----------------------------------------------------------------------------------------------------
// Reads a TileSet .tres back: the atlas source's properties, each tile's lines by cell, and the [resource] lines.
function readTileSet(text) {
  assert.match(text, /^\[gd_resource type="TileSet" format=3\]\n\n\[ext_resource type="Texture2D" path="[^"]+" id="1_sheet"\]\n\n\[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_tiles"\]\n/);
  const [source, resource] = text.split('\n\n[resource]\n'), props = {}, tiles = {};
  for (const line of source.split('\n').slice(5)) {
    const [key, value] = line.split(' = '), cell = /^(\d+:\d+)\/(.*)$/.exec(key);
    if (!cell) { props[key] = value; continue; }
    (tiles[cell[1]] ??= {})[cell[2]] = value;
  }
  return { props, tiles, resource: Object.fromEntries(resource.trim().split('\n').map(line => line.split(' = '))) };
}
const peersOf = tile => Object.keys(tile).filter(key => key.startsWith('0/terrains_peering_bit/')).map(key => key.slice(23)).sort();
const [turfSource, fenceSource, surfSource] = GODOT_TILE_SOURCES;

test('an autotile set exports a Godot TileSet whose peering bits are each tile\'s neighbour mask', async () => {
  const { recipe } = compileAutotile(turfSource), bundle = await createBundle(recipe), atlas = JSON.parse(bundle.files.get('turf.atlas.json'));
  const { props, tiles, resource } = readTileSet(bundle.files.get('turf.tileset.tres').toString());
  // Padding 1 at scale 2: 2 px margins, 4 px between 8 px tiles. The sheet beside it, one terrain matching corners and sides.
  assert.deepEqual(props, { resource_name: '"turf"', texture: 'ExtResource("1_sheet")', margins: 'Vector2i(2, 2)', separation: 'Vector2i(4, 4)', texture_region_size: 'Vector2i(8, 8)' });
  // The terrain's editor colour is the fill tile's commonest colour, d #3c7830.
  assert.deepEqual(resource, { tile_size: 'Vector2i(8, 8)', 'terrain_set_0/mode': '0', 'terrain_set_0/terrain_0/name': '"turf"', 'terrain_set_0/terrain_0/color': 'Color(0.235294, 0.470588, 0.188235, 1)', 'sources/0': 'SubResource("TileSetAtlasSource_tiles")' });
  assert.match(bundle.files.get('turf.tileset.tres').toString(), /\[ext_resource type="Texture2D" path="turf\.png" id="1_sheet"\]/);
  // Every one of the 47 frames is a tile in its sheet cell, with a bit for each side and corner its mask has.
  assert.equal(Object.keys(tiles).length, 47);
  const names = { 1: 'top_side', 2: 'top_right_corner', 4: 'right_side', 8: 'bottom_right_corner', 16: 'bottom_side', 32: 'bottom_left_corner', 64: 'left_side', 128: 'top_left_corner' };
  for (const frame of recipe.frames) {
    const { x, y } = atlas.frames[frame.name].frame, tile = tiles[`${(x - 2) / 12}:${(y - 2) / 12}`], mask = frame.ops[0].mask;
    assert.deepEqual([tile['0'], tile['0/terrain_set'], tile['0/terrain']], ['0', '0', '0'], frame.name);
    assert.deepEqual(peersOf(tile), Object.entries(names).filter(([bit]) => mask & bit).map(([, name]) => name).sort(), frame.name);
  }
  assert.deepEqual(bundle.project.warnings, []);
  assert.match(bundle.files.get('README.txt').toString(), /turf\.tileset\.tres: Godot 4 TileSet/);
  // The same recipe always gives the same bytes.
  assert.deepEqual((await createBundle(recipe)).files.get('turf.tileset.tres'), bundle.files.get('turf.tileset.tres'));
});

test('a cardinal set matches sides only, and every variant of a mask is a tile of its own', async () => {
  const { recipe } = compileAutotile(fenceSource), bundle = await createBundle(recipe);
  const { props, tiles, resource } = readTileSet(bundle.files.get('fence.tileset.tres').toString());
  assert.equal(resource['terrain_set_0/mode'], '2');
  assert.equal(props.margins, undefined, 'no padding, no margins');
  assert.equal(Object.keys(tiles).length, 32);
  // fence-5-plain (N and S) and fence-5-mossy: two tiles with the same bits, which Godot picks between at random.
  const atlas = JSON.parse(bundle.files.get('fence.atlas.json')), cell = name => { const { x, y } = atlas.frames[name].frame; return `${x / 4}:${y / 4}`; };
  for (const name of ['fence-5-plain', 'fence-5-mossy']) assert.deepEqual(peersOf(tiles[cell(name)]), ['bottom_side', 'top_side']);
  assert.deepEqual(peersOf(tiles[cell('fence-15-plain')]), ['bottom_side', 'left_side', 'right_side', 'top_side']);
});

test('an animation over one mask\'s frames side by side in a row becomes an animated tile, and one that wraps keeps its first frame', async () => {
  const { recipe } = compileAutotile(surfSource), bundle = await createBundle(recipe), text = bundle.files.get('surf.tileset.tres').toString(), { tiles } = readTileSet(text);
  // Six columns: each mask's three frames share a row, so 47 animated tiles and no tiles at their later frames. Godot
  // writes a tile's frame times before the tile.
  assert.equal(Object.keys(tiles).length, 47);
  assert.ok(Object.values(tiles).every(tile => tile['animation_frame_2/duration'] === '0.09'));
  assert.match(text, /\n3:0\/animation_frame_0\/duration = 0\.12\n3:0\/animation_frame_1\/duration = 0\.25\n3:0\/animation_frame_2\/duration = 0\.09\n3:0\/0 = 0\n/);
  assert.deepEqual(bundle.project.warnings, []);
  // At the default eight columns a mask's frames can wrap onto the next row: those tiles keep their first frame, warned.
  const wrapped = await createBundle({ ...recipe, sheet: undefined }), still = readTileSet(wrapped.files.get('surf.tileset.tres').toString()).tiles;
  assert.equal(Object.keys(still).length, 47);
  const animated = Object.values(still).filter(tile => tile['animation_frame_0/duration']).length;
  assert.ok(animated > 0 && animated < 47, `${animated} animated tiles`);
  assert.equal(wrapped.project.warnings.length, 1);
  assert.match(wrapped.project.warnings[0], /^surf\.tileset\.tres: animations surf-\d+, .* became still tiles of their first frame: their frames run onto the next row of the sheet, and Godot animates a tile only through frames side by side in one row\. Set sheet\.columns to a multiple of 3$/);
  // A ping-pong or a one-shot can't animate a tile at any width.
  const { animations } = recipe, first = Object.keys(animations)[0];
  for (const change of [{ direction: 'pingpong' }, { loop: false }]) {
    const other = await createBundle({ ...recipe, animations: { ...animations, [first]: { ...animations[first], ...change } } });
    assert.deepEqual(other.project.warnings, [`surf.tileset.tres: animation ${first} became still tiles of its first frame: Godot animates a tile by playing the frames after it in the sheet once each, in order, looping`], JSON.stringify(change));
  }
});

test('only an autotile set on a grid gets a TileSet, and what can\'t be one is said', async () => {
  const { recipe } = compileAutotile(turfSource);
  // A sprite, a single tile and a set of one mask's variants have no TileSet and no warning about one.
  for (const project of [spirit, { ...recipe, frames: recipe.frames.slice(0, 1) }, { ...recipe, frames: [recipe.frames[3], { ...recipe.frames[3], name: 'again' }] }]) {
    const bundle = await createBundle(project);
    assert.equal([...bundle.files.keys()].some(file => file.endsWith('.tileset.tres')), false, project.name);
    assert.equal(bundle.project.warnings.some(text => text.includes('tileset')), false);
  }
  // A trimmed sheet has no grid.
  let bundle = await createBundle({ ...recipe, sheet: { trim: true } });
  assert.equal(bundle.files.has('turf.tileset.tres'), false);
  assert.deepEqual(bundle.project.warnings, ['turf.tileset.tres: not written: a Godot TileSet needs the sheet\'s grid, and sheet.trim packs frames without one. Remove sheet.trim to get it']);
  // Blob and cardinal tiles can't share one terrain; named apart, each is a terrain set of its own.
  const fence = compileAutotile(fenceSource).recipe;
  bundle = await createBundle({ ...recipe, frames: [...recipe.frames.slice(0, 3), ...fence.frames.slice(0, 3).map(frame => ({ ...frame, name: `c${frame.name}` }))] });
  assert.equal(bundle.files.has('turf.tileset.tres'), false);
  assert.deepEqual(bundle.project.warnings, ["turf.tileset.tres: not written: terrain turf mixes blob and cardinal masks, and a Godot terrain matches one way; give one set's frames another tile.terrain, or export each set from its own recipe"]);
  bundle = await createBundle({ ...recipe, frames: [...recipe.frames, ...fence.frames.filter(frame => frame.name.endsWith('-plain')).map(frame => ({ ...frame, name: `c${frame.name}`, tile: { terrain: 'fence' } }))] });
  const two = readTileSet(bundle.files.get('turf.tileset.tres').toString());
  assert.deepEqual(Object.entries(two.resource).filter(([key]) => key.startsWith('terrain_set_')), [['terrain_set_0/mode', '0'], ['terrain_set_0/terrain_0/name', '"turf"'], ['terrain_set_0/terrain_0/color', 'Color(0.235294, 0.470588, 0.188235, 1)'], ['terrain_set_1/mode', '2'], ['terrain_set_1/terrain_0/name', '"fence"'], ['terrain_set_1/terrain_0/color', 'Color(0.235294, 0.470588, 0.188235, 1)']]);
  assert.deepEqual([...new Set(Object.values(two.tiles).map(tile => tile['0/terrain_set']))], ['0', '1']);
  assert.equal(Object.keys(two.tiles).length, 47 + 16);
  assert.deepEqual(bundle.project.warnings, []);
  // A partial set is written, with the masks it lacks counted.
  bundle = await createBundle({ ...recipe, frames: recipe.frames.slice(0, 40) });
  assert.equal(readTileSet(bundle.files.get('turf.tileset.tres').toString()).tiles['0:0']['0'], '0');
  assert.deepEqual(bundle.project.warnings, ['turf.tileset.tres: 7 of the 47 blob masks have no tile, so Godot draws its nearest match where one is needed']);
});

test('autotileFrames finds frames drawn by one autotile mask at the corner, with blob masks reduced', () => {
  const op = (mask, extra) => ({ op: 'autotile', symbol: 't', mask, ...extra });
  const recipe = { frames: [
    { name: 'a', ops: [op(255)] },
    { name: 'raw', ops: [op(2 | 4), { op: 'pixel', x: 1, y: 1, color: '#fff' }] }, // NE without N counts as E only
    { name: 'card', ops: [op(9, { mode: 'cardinal' })] },
    { name: 'moved', ops: [op(255, { x: 4 })] },
    { name: 'two', ops: [op(1), op(4)] },
    { name: 'same', ops: [op(1), op(1 | 2)] }, // both reduce to N
    { name: 'drawn', ops: [{ op: 'rect', x: 0, y: 0, w: 2, h: 2, color: '#fff' }] },
    { name: 'empty' }
  ] };
  assert.deepEqual(autotileFrames(recipe), [{ frame: 'a', mask: 255, mode: 'blob' }, { frame: 'raw', mask: 4, mode: 'blob' }, { frame: 'card', mask: 9, mode: 'cardinal' }, { frame: 'same', mask: 1, mode: 'blob' }]);
});

test('retexture renames only the sheet a resource names', () => {
  const atlas = { frames: { a: { frame: { x: 0, y: 0, w: 4, h: 4 } }, b: { frame: { x: 4, y: 0, w: 4, h: 4 } } }, animations: {}, meta: { image: 'set.png' } };
  const { text } = tileSet(atlas, [{ frame: 'a', mask: 0, mode: 'cardinal' }, { frame: 'b', mask: 2, mode: 'cardinal' }], { name: 'set' });
  const moved = retexture(text, '../art/a "b".png');
  assert.match(moved, /\[ext_resource type="Texture2D" path="\.\.\/art\/a \\"b\\"\.png" id="1_sheet"\]/);
  assert.equal(moved.replace('path="../art/a \\"b\\".png"', 'path="set.png"'), text);
});
