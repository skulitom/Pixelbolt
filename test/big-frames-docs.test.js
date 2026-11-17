import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderProject } from '../src/core.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectProject } from '../src/core.js';
import { createBundle } from '../src/export.js';
import { createSceneBundle } from '../src/scene-export.js';
import { compileEffects } from '../src/fx.js';
import { helpText } from '../src/help.js';
import { compilePreset } from '../src/presets.js';
import { keepFrames } from '../src/resize.js';
import { prepareScene } from '../src/scene.js';

// What the docs and the generated schema tell an agent making a full-screen overlay, followed as written.
const read = async file => (await readFile(new URL(`../${file}`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const recipe = (name, width, height, frames) => ({ version: 1, name, width, height, palette: { d: '#9fb8d8' }, frames: Array.from({ length: frames }, (_, i) => ({ name: `${name}-${i}`, ops: [{ op: 'pixel', x: i % width, y: 0, color: 'd' }] })) });
const overScene = (width, height, frames) => prepareScene({ format: 'pixelforge-scene', version: 1, name: 's', width, height, assets: { bg: recipe('bg', width, height, 1), rain: recipe('rain', width, height, frames) }, instances: [{ name: 'bg', asset: 'bg', at: [0, 0] }, { name: 'rain', asset: 'rain', at: [0, 0] }] });

test('an overlay over a still backdrop in a scene gets one frame fewer: 71 of 320x180, 31 of 480x270', async () => {
  const craft = await read('docs/agent-craft.md'), scene = JSON.parse(await read('scene.schema.json'));
  for (const text of [craft, await read('docs/art-workflow.md'), scene.properties.assets.description]) assert.match(text, /one frame fewer[^.]*71 of 320 ?× ?180, 31 of 480 ?× ?270/);
  for (const [width, height, fits] of [[320, 180, 71], [480, 270, 31]]) {
    assert.ok(overScene(width, height, fits), `${fits} frames of ${width}x${height} sit over the backdrop`);
    assert.throws(() => overScene(width, height, fits + 1), { message: /^scene\.assets\.rain: a scene's assets render at most 4,194,304 pixels in all/ });
  }
});

test('the fx canvas size says a source with more frames than fit compiles with frames, and it does', async () => {
  const width = JSON.parse(await read('fx.schema.json')).properties.width.description;
  assert.match(width, /\(72 of 320×180\); a source with more compiles with frames \(--frames\), and a count that divides a loop's frames keeps an even step\.$/);
  // help fx and MCP pixel_help fx shorten a description past 220 characters, which hid the --frames route.
  assert.ok(width.length <= 220, `${width.length} characters`);
  assert.ok((await helpText('fx')).includes(width) && (await helpText('fx', undefined, 'cli')).includes(width));
  const rain = frames => ({ format: 'pixelforge-fx', version: 1, name: 'rain', width: 320, height: 180, palette: { d: '#9fb8d8' }, symbols: { drop: ['d'] },
    effects: { rain: { frames, duration: 60, loop: true, seed: 7, edges: ['top', 'left', 'right'], emitters: [{ at: [150, -8], area: [400, 1], rate: 2, angle: [100, 102], speed: [8, 9], life: [16, 21], shapes: ['drop'] }] } } });
  assert.throws(() => compileEffects(rain(96)), /72 frames of 320×180 fit/);
  const thinned = keepFrames(compilePreset(rain(96), { frames: 72 }).recipe, 72);
  assert.equal(renderProject(thinned.recipe).frames.length, 72);
  // A count that divides the loop's 96 frames keeps an even step; 72 does not, and the compile says so.
  const uneven = warnings => (warnings ?? []).filter(warning => /thins its 96-frame loop unevenly/.test(warning));
  assert.match(uneven(compilePreset(rain(96), { frames: 72 }).warnings)[0], /frames 48, 32 or 24 keep an even step/);
  for (const frames of [48, 32]) {
    const even = compilePreset(rain(96), { frames });
    assert.deepEqual(uneven(even.warnings), []);
    assert.equal(new Set(even.recipe.frames.map(frame => frame.duration)).size, 1, `${frames} frames last alike`);
  }
});

test('every doc that says --frames thins a loop says when it is even: a count that divides its frames', async () => {
  const said = { 'docs/art-workflow.md': /A loop keeps an even step only when the count divides its frames \(a 96-frame loop to 48 or 32, not 72\); otherwise the compile warns/,
    'docs/agent-quick-start.md': /a loop at an even step if 8 divides its frames \(fx warns otherwise\)/, 'docs/agent-craft.md': /a loop at an even step when 8 divides its frames \(an fx source warns otherwise\)/,
    'skills/pixel-art/SKILL.md': /`--frames 8` down to 8 frames \(an even step when 8 divides a loop's frames\)/ };
  for (const [file, sentence] of Object.entries(said)) {
    const text = await read(file);
    assert.match(text, sentence, file);
    assert.doesNotMatch(text, /keeps? (?:that many|8) evenly spaced frames|down to 8 evenly spaced/, file);
  }
  // The quick start an MCP client reads on connect stays within its cap.
  assert.ok(Buffer.byteLength(await helpText()) < 12288);
});

test('an overlay delivered for Godot: the scene exported without it, and its own render\'s .tres, which plays every frame', async () => {
  assert.match(await read('docs/agent-craft.md'), /bakes an animated placement in as its frame 0, so for Godot export the scene without the overlay \(left out, or `"hidden": true`\) and deliver the overlay's own `\.tres` from `render --out` to play over it; Tiled's `scene\.tmx` animates it\./);
  const rain = { ...recipe('rain', 320, 180, 12), animations: { rain: { frames: Array.from({ length: 12 }, (_, i) => `rain-${i}`) } } };
  const backdrop = { version: 1, name: 'bg', width: 320, height: 180, palette: { g: '#30402a' }, frames: [{ name: 'bg', ops: [{ op: 'rect', x: 0, y: 0, w: 320, h: 180, color: 'g', filled: true }] }] };
  const scene = placed => ({ format: 'pixelforge-scene', version: 1, name: 's', width: 320, height: 180, assets: { bg: backdrop, ...(placed && { rain }) },
    instances: [{ name: 'bg', asset: 'bg', at: [0, 0] }, ...(placed ? [{ name: 'rain', asset: 'rain', at: [0, 0], animation: 'rain', ...placed }] : [])] });
  const exported = async placed => { const files = (await createSceneBundle(scene(placed))).files; return { files, planes: JSON.parse(files.get('alignment.json')).planes.map(plane => plane.placements) }; };
  // As placed, the overlay's first frame is baked into the backdrop's plane, and Tiled's map animates it.
  const shown = await exported({});
  assert.deepEqual(shown.planes, [['bg', 'rain']]);
  assert.match(shown.files.get('scene.tmx').toString(), /name="rain"/);
  assert.match(shown.files.get('assets/1/tileset.tsx').toString(), /<animation>/);
  // Hidden or left out, the plane is the backdrop alone, so the delivered .tres plays over clean ground.
  const alone = await exported(null);
  for (const without of [await exported({ hidden: true }), alone]) {
    assert.deepEqual(without.planes, [['bg']]);
    assert.equal(Buffer.compare(without.files.get('planes/0.png'), alone.files.get('planes/0.png')), 0);
  }
  const bundle = await createBundle(rain);
  const tres = bundle.files.get('rain.tres')?.toString();
  assert.ok(tres, 'render --out writes the overlay\'s SpriteFrames');
  assert.equal(tres.match(/"texture": /g)?.length, 12);
});

test('a small region of a few frames is enlarged by itself, and --scale zooms the rest, as the docs say', async () => {
  // Before: "up to about 128 px a side by itself", which held for a few frames only: the sheet stays within 1024
  // pixels, so a 64-pixel region of 64 frames shows at scale 1.
  const said = /by itself for a small region of a few frames[^.;]*`--scale 4`/;
  assert.match(await read('skills/pixel-art/SKILL.md'), said);
  assert.match(await read('docs/agent-quick-start.md'), said);
  assert.match(await read('docs/agent-guide.md'), /A small region of a few frames is enlarged by itself, each cell up to 256 pixels within a sheet of 1024 \(a 64-pixel region of 4 frames at scale 4, of 64 frames at scale 1\); otherwise pass `scale` \(CLI `--scale`\)\./);
  for (const file of ['skills/pixel-art/SKILL.md', 'docs/agent-quick-start.md', 'docs/agent-guide.md']) assert.doesNotMatch(await read(file), /about 128/, file);
  const at = (frames, w, h, scale) => inspectProject(renderProject(recipe('rain', 320, 180, frames)), { region: { x: 0, y: 0, w, h }, scale }).sheet.scale;
  assert.deepEqual([at(4, 120, 80), at(4, 128, 72), at(4, 160, 80), at(4, 160, 80, 4)], [2, 2, 1, 4]);
  assert.deepEqual([at(4, 64, 64), at(64, 64, 64), at(64, 64, 64, 4)], [4, 1, 4]);
});

test('help on a command name says where its options are, and they are there', () => {
  const run = args => spawnSync(process.execPath, [fileURLToPath(new URL('../bin/pixelbolt.js', import.meta.url)), ...args], { encoding: 'utf8' });
  const asked = JSON.parse(run(['help', 'inspect']).stderr);
  assert.match(asked.error, /^Unknown help topic "inspect"; topics: quickstart, .*; for a command's options run pixelbolt inspect --help$/);
  const options = run(['inspect', '--help']);
  assert.equal(options.status, 0);
  assert.match(options.stdout, /pixelbolt inspect .*--region/s);
  assert.doesNotMatch(JSON.parse(run(['help', 'nope']).stderr).error, /--help/);
});

test('the guide\'s sentence on text in a sorted layer reads right on its own', async () => {
  const guide = await read('docs/agent-guide.md');
  // Before: "Text needs `ground`.", which a word search for text showed alone, though text outside a sorted layer needs none.
  assert.doesNotMatch(guide, /Text needs `ground`\./);
  const sentence = guide.match(/[^.]*text`? operation in a sorted layer[^.]*\./)?.[0];
  assert.match(sentence, /A `text` operation in a sorted layer has no lowest row of its own, so it needs `ground` there\./);
  // Following it: text with ground in a sorted layer renders, as the core's refusal without it asks.
  const sorted = ground => ({ version: 1, name: 't', width: 32, height: 16, palette: { d: '#123456' }, frames: [{ name: 'f', layers: [{ name: 'l', sort: 'ground', ops: [{ op: 'text', x: 1, y: 1, text: 'HI', color: 'd', ...(ground !== undefined && { ground }) }] }] }] });
  assert.throws(() => renderProject(sorted()), /needs ground/);
  assert.equal(renderProject(sorted(6)).frames.length, 1);
  assert.ok((await helpText('guide', 'text')).includes('has no lowest row of its own'));
});
