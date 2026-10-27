import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderProject, buildAtlas, frameTag } from '../src/core.js';
import { createBundle } from '../src/export.js';
import { createSceneBundle } from '../src/scene-export.js';
import { spriteFrames, godotTiming, GODOT_MAX_FPS } from '../src/godot.js';
import { GODOT_FIXTURE, replaySprite } from '../scripts/verify-godot.mjs';

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
    const { region, margin = [0, 0, 0, 0] } = subs[`AtlasTexture_${name}`];
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
});

test('the Godot playback replay matches Godot 4.6, which runs the rest of a step after a frame change at the old speed', () => {
  // A 5 ms flash then a 100 ms frame, at 120 FPS, in 1 ms steps: Godot 4.6 plays the first millisecond of the long frame
  // at the flash's rate, so it ends 19 ms early (godotengine/godot#123572); with the fix it ends on time.
  const steps = Array(120).fill(1);
  assert.deepEqual(replaySprite(120, [0.6, 12], false, steps), [[5, 1], [86, -1]]);
  assert.deepEqual(replaySprite(120, [0.6, 12], false, steps, { stale: false }), [[5, 1], [105, -1]]);
});
