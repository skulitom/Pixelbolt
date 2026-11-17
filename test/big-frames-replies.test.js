import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileEffects } from '../src/fx.js';
import { renderProject } from '../src/core.js';
import { keepFrames } from '../src/resize.js';
import { compilePreset } from '../src/presets.js';
import { prepareScene } from '../src/scene.js';
import { startMCP } from '../src/mcp.js';

// What a screen-sized effect, a release, a dense effect and a scene of big assets reply when they pass a limit, and the
// route each reply names working.
const root = fileURLToPath(new URL('../', import.meta.url));
const frost = JSON.parse(await readFile(new URL('../examples/frost-nova.fx.json', import.meta.url), 'utf8'));
// 24 frames at 640x360 are 5,529,600 pixels; 18 frames of that size fit.
const frost640 = { ...frost, width: 640, height: 360 };
const refusal = (run, pattern) => assert.throws(run, error => { assert.equal(error.name, 'PixelError'); assert.match(error.message, pattern); return true; });
const temp = async t => {
  const base = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(base, 'pixelbolt-big-replies-'));
  t.after(async () => { assert.ok(dir.startsWith(base + path.sep)); await rm(dir, { recursive: true, force: true }); });
  return dir;
};

test('an effect made at a screen size compiles for the frames a compile keeps, and its refusal names that route', () => {
  // Before, the source's budget refused it whatever the compile kept: "use fewer frames or a smaller canvas" only.
  refusal(() => compileEffects(frost640), /^fx\.effects: the effects make 24 frames: .*18 frames of 640×360 fit: use fewer frames or a smaller canvas; or compile with frames 18 \(pixelbolt compile --frames 18\): it keeps that many of each animation's, evenly spaced, without cutting the effect short$/);
  // Now the pixels are counted against the frames kept: the recipe still has all 24, and keepFrames thins them.
  const { recipe, metadata } = compileEffects(frost640, { frames: 12 });
  assert.equal(recipe.frames.length, 24);
  const thinned = keepFrames(recipe, 12);
  assert.deepEqual(thinned.kept, { 'frost-nova': '12 of 24' });
  const project = renderProject(thinned.recipe);
  assert.deepEqual([project.width, project.height, project.frames.length], [640, 360, 12]);
  // The review read the frames a share at a time and still saw all of them: its residue is the last frame's pixels.
  const effect = metadata.effects['frost-nova'], last = renderProject({ ...recipe, frames: [recipe.frames[23]], animations: { last: { frames: [recipe.frames[23].name] } } }).frames[0].data;
  let drawn = 0;
  for (let i = 3; i < last.length; i += 4) if (last[i]) drawn++;
  assert.deepEqual([effect.light.length, effect.residue], [24, drawn]);
  // Kept frames that still don't fit say which do.
  refusal(() => compileEffects(frost640, { frames: 20 }), /^fx\.effects: the effects make 24 frames, 20 of them kept with frames 20: 20 frames of 640×360 are 4,608,000 pixels; .*: use fewer frames or a smaller canvas; frames 18 fits$/);
  assert.equal(compileEffects(frost640, { frames: 18 }).recipe.frames.length, 24);
});

test('a compile that keeps fewer frames of an effect that fits makes exactly what it made before', () => {
  assert.deepEqual(compileEffects(frost, { frames: 12 }), compileEffects(frost));
  assert.deepEqual(compilePreset(frost, { frames: 12 }), compileEffects(frost));
});

test('compile --frames and pixel_compile frames deliver a screen-sized effect', async t => {
  const dir = await temp(t), source = path.join(dir, 'frost640.fx.json'), out = path.join(dir, 'frost640.json');
  await writeFile(source, JSON.stringify(frost640));
  const run = (...args) => spawnSync(process.execPath, [path.join(root, 'bin', 'pixelbolt.js'), ...args], { cwd: dir, encoding: 'utf8' });
  const refused = run('compile', source, '--out', out);
  assert.equal(refused.status, 1);
  assert.match(JSON.parse(refused.stderr || refused.stdout).error, /or compile with frames 18 \(pixelbolt compile --frames 18\)/);
  const made = run('compile', source, '--out', out, '--frames', '12');
  assert.equal(made.status, 0, made.stdout + made.stderr);
  assert.deepEqual(Object.fromEntries(Object.entries(JSON.parse(made.stdout)).filter(([key]) => ['width', 'height', 'frames', 'kept'].includes(key))), { width: 640, height: 360, frames: 12, kept: { 'frost-nova': '12 of 24' } });
  assert.equal(JSON.parse(await readFile(out, 'utf8')).frames.length, 12);

  const input = new PassThrough(), output = new PassThrough(), waiting = new Map();
  let buffer = '', next = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)?.(message); } });
  const running = startMCP({ input, output, directory: dir });
  t.after(async () => { input.end(); await running; });
  const request = (method, params) => new Promise(resolve => { waiting.set(++next, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n'); });
  await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  const reply = JSON.parse((await request('tools/call', { name: 'pixel_compile', arguments: { source: frost640, frames: 12 } })).result.content[0].text);
  assert.deepEqual([reply.ok, reply.width, reply.height, reply.frames, reply.kept], [true, 640, 360, 12, { 'frost-nova': '12 of 24' }]);
});

test('too many drawing operations says how many the effect needs and the frames that fit', () => {
  // Slanted rain over a 320x180 screen: 69 frames fit under 20,000 operations, 70 do not.
  const rain = frames => ({ format: 'pixelforge-fx', version: 1, name: 'rain', width: 320, height: 180, palette: { d: '#9fb8d8', l: '#5d7397', s: '#cfe0f4' }, symbols: { drop: ['d'], splash: ['s'] },
    effects: { rain: { frames, duration: 60, loop: true, seed: 7, edges: ['top', 'left', 'right'], emitters: [
      { name: 'drop', at: [150, -8], area: [400, 1], rate: 7, angle: [100, 102], speed: [8, 9], life: [16, 21], shapes: ['drop'], trail: { color: 'l', length: 2 } },
      { from: 'drop', when: 'death', burst: 2, angle: [200, 340], speed: [0.5, 1.2], gravity: [0, 0.3], life: [2, 3], shapes: ['splash'] }] } } });
  // Before: "the effect needs more than 20000 drawing operations; lower counts or frames", and then "about 69 frames fit
  // at this density: lower burst, rate or trail, or frames", which compile --frames did not change.
  refusal(() => compileEffects(rain(70)), /^fx\.effects\.rain: the 70 frames the effect makes need about 20,251 drawing operations \(289 a frame\) and a recipe makes at most 20,000, so frames 35 fits \(pixelbolt compile --frames 35\): it keeps that many of each animation's, evenly spaced, without cutting the effect short; or lower burst, rate or trail$/);
  // 69 fit too, but would thin the 70-frame loop unevenly: 35 is the most that fit and divide it.
  assert.equal(keepFrames(compilePreset(rain(70), { frames: 35 }).recipe, 35).recipe.frames.length, 35);
  assert.equal(compileEffects(rain(69)).recipe.frames.length, 69);
});

test('a release past a particle limit is told to lower its share, by about how much, or to use a smaller sprite', () => {
  const still = { version: 1, name: 'still', width: 640, height: 360, palette: { d: '#9fb8d8' }, frames: [{ name: 'f0', ops: [{ op: 'rect', x: 0, y: 0, w: 640, h: 360, color: 'd' }] }] };
  const release = (share, life) => ({ format: 'pixelforge-fx', version: 1, name: 'r', width: 640, height: 360, palette: { d: '#9fb8d8' }, symbols: { pic: { recipe: still, frame: 'f0' } },
    effects: { e: { frames: 12, emitters: [{ at: [0, 0], sprite: { symbol: 'pic' }, release: { sweep: 270, ...(share !== undefined && { share }) }, start: 1, end: 10, life }] } } });
  // Before: "lower burst, rate or life", which a release has none of.
  refusal(() => compileEffects(release(undefined, [5, 8])), /^fx\.effects\.e: more than 1024 particles are alive at once; emitters\[0\] releases every one of its sprite's 230,400 pixels: lower its release\.share \(about 0\.0046 fits\) or use a smaller sprite$/);
  assert.equal(compileEffects(release(0.0046, [5, 8])).recipe.frames.length, 12);
  // Short lives keep fewer alive at once, and the share is then held by the particles spawned in all.
  refusal(() => compileEffects(release(0.02, [1, 1])), /^fx\.effects\.e\.emitters: more than 4096 particles; emitters\[0\] releases a 0\.02 share of its sprite's 230,400 pixels: lower its release\.share \(about 0\.017 fits\) or use a smaller sprite$/);
  assert.equal(compileEffects(release(0.017, [1, 1])).recipe.frames.length, 12);
});

test('a scene past its assets\' pixels says what each uses and which to give fewer frames', () => {
  const recipe = (width, height, frames) => ({ version: 1, name: 'a', width, height, palette: { d: '#123456' }, frames: Array.from({ length: frames }, (_, i) => ({ name: `f${i}`, ops: [{ op: 'pixel', x: 0, y: 0, color: 'd' }] })) });
  const scene = assets => ({ format: 'pixelforge-scene', version: 1, name: 's', width: 512, height: 512, assets, instances: [] });
  // Before: "combined scene source passes exceed 4,194,304 pixels or have invalid dimensions".
  assert.throws(() => prepareScene(scene({ big: recipe(512, 512, 16), small: recipe(64, 64, 8) })), { message: 'scene.assets.small: a scene\'s assets render at most 4,194,304 pixels in all, every frame of every pass; big uses 4,194,304, and small needs 32,768: big fits with 15 frames, so make it with 15 (in its source, rather than thinning its 16 frames unevenly) or give it a smaller canvas' });
  assert.ok(prepareScene(scene({ big: recipe(512, 512, 15), small: recipe(64, 64, 8) })));
  assert.throws(() => prepareScene(scene({ a: recipe(320, 180, 30), b: recipe(320, 180, 30), c: recipe(320, 180, 20) })), { message: 'scene.assets.c: a scene\'s assets render at most 4,194,304 pixels in all, every frame of every pass; the assets before it use 3,456,000 (a 1,728,000, b 1,728,000), and c needs 1,152,000: a fits with 22 frames, so make it with 22 (in its source, rather than thinning its 30 frames unevenly) or give it a smaller canvas' });
  assert.ok(prepareScene(scene({ a: recipe(320, 180, 22), b: recipe(320, 180, 30), c: recipe(320, 180, 20) })));
  // The overlay itself is the largest: a 480x270 backdrop and a 32-frame snow loop. Before, nothing said 31 fit.
  const winter = frames => ({ ...scene({ backdrop: recipe(480, 270, 1), snow: recipe(480, 270, frames) }), width: 480, height: 270 });
  assert.throws(() => prepareScene(winter(32)), { message: "scene.assets.snow: a scene's assets render at most 4,194,304 pixels in all, every frame of every pass; backdrop uses 129,600, and snow needs 4,147,200: snow fits with 31 frames, so make it with 31 (in its source, rather than thinning its 32 frames unevenly) or give it a smaller canvas" });
  assert.ok(prepareScene(winter(31)));
  // The count holds every pass of the asset and the assets listed after it, so following it once prepares.
  const lit = frames => ({ ...scene({ backdrop: recipe(480, 270, 1), snow: { recipe: recipe(480, 270, frames), normal: recipe(480, 270, frames) } }), width: 480, height: 270 });
  // What the asset needs is said for every pass of it: before, "snow needs 4,147,200", its colour pass's alone.
  assert.throws(() => prepareScene(lit(32)), { message: "scene.assets.snow: a scene's assets render at most 4,194,304 pixels in all, every frame of every pass; backdrop uses 129,600, and snow needs 8,294,400 with its normal pass: snow fits with 15 frames, so make it with 15 (in its source, rather than thinning its 32 frames unevenly) or give it a smaller canvas" });
  assert.ok(prepareScene(lit(15)));
  assert.throws(() => prepareScene(lit(16)));
  // Refused at its normal pass, whose colour pass fits: the need is still the whole asset's, and its own colour pass is
  // not among what the assets before it use. Before: "backdrop uses 129,600, and snow's normal pass needs 2,332,800".
  const glowing = frames => ({ ...scene({ backdrop: recipe(480, 270, 1), snow: { recipe: recipe(480, 270, frames), normal: recipe(480, 270, frames), emissive: recipe(480, 270, frames) } }), width: 480, height: 270 });
  assert.throws(() => prepareScene(glowing(18)), { message: "scene.assets.snow: a scene's assets render at most 4,194,304 pixels in all, every frame of every pass; backdrop uses 129,600, and snow needs 6,998,400 with its normal and emissive passes: snow fits with 10 frames, so make it with 10 (in its source, rather than thinning its 18 frames unevenly) or give it a smaller canvas" });
  assert.ok(prepareScene(glowing(10)));
  const layered = frames => ({ ...scene({ snow: recipe(480, 270, frames), backdrop: recipe(480, 270, 1), fg: recipe(480, 270, 1) }), width: 480, height: 270 });
  assert.throws(() => prepareScene(layered(32)), { message: "scene.assets.backdrop: a scene's assets render at most 4,194,304 pixels in all, every frame of every pass; snow uses 4,147,200, and backdrop needs 129,600: snow fits with 30 frames, so make it with 30 (in its source, rather than thinning its 32 frames unevenly) or give it a smaller canvas" });
  assert.ok(prepareScene(layered(30)));
  assert.throws(() => prepareScene(layered(31)));
});
