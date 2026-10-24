import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, PixelError } from '../src/core.js';
import { animationGIF } from '../src/gif.js';
import { patchRecipe } from '../src/patch.js';
import { readExpect, checkDelivery } from '../src/check.js';

const root = fileURLToPath(new URL('../', import.meta.url));
// forest-spirit: 24x24, frames rest, rise, float, blink, fall, settle; idle plays 7 (blink among them), bob is a
// 3-name pingpong (4 played), blink plays 3 once.
const spirit = JSON.parse(await readFile(path.join(root, 'examples', 'forest-spirit.json'), 'utf8'));
// A 4x2 recipe: frame "a" opaque in two colours, "b" with a transparent pixel, "c" empty.
const small = { version: 1, name: 'tile', width: 4, height: 2, palette: { r: '#ff0000', g: '#00ff00' },
  frames: [{ name: 'a', ops: [{ op: 'rect', x: 0, y: 0, w: 4, h: 2, color: 'r' }, { op: 'pixel', x: 0, y: 0, color: 'g' }] }, { name: 'b', from: 'a', ops: [{ op: 'clear', x: 3, y: 1, w: 1, h: 1 }] }, { name: 'c', ops: [] }],
  animations: { flash: { frames: ['a', 'b'], loop: false }, gone: { frames: ['c'] } } };
const check = (recipe, options = {}) => checkDelivery(renderProject(recipe), { recipe, ...options });
// The fixes quote a pixel_patch change; this reads it back, to prove it is a change patchRecipe accepts.
const quoted = fix => JSON.parse(fix.slice(fix.indexOf('pixel_patch ') + 12, fix.lastIndexOf(', then render again')));

test('the render check reports what was delivered, and a hint, when nothing was asked for', () => {
  const plain = check(spirit, { gifs: [] });
  assert.deepEqual(plain.delivered, { size: [24, 24], animations: { idle: { frames: 7, loop: true }, bob: { frames: 4, loop: true }, blink: { frames: 3, loop: false } }, colors: 7, transparent: true, partlyTransparent: true });
  assert.equal(plain.ok, undefined); assert.equal(plain.problems, undefined); assert.match(plain.hint, /Pass expect .*gifScale/);
  // A command that writes no GIFs (the CLI's render) doesn't offer gifScale.
  assert.doesNotMatch(check(spirit).hint, /gifScale/);
  const project = renderProject(small), { delivered, notes } = checkDelivery(project, { recipe: small, gifs: [animationGIF(project, 'flash', { scale: 2 })] });
  // Fully transparent pixels are not colours; a frame with one clear pixel makes the delivery partly transparent.
  assert.deepEqual([delivered.colors, delivered.transparent, delivered.gifs], [2, 'some frames', [8, 4]]);
  assert.deepEqual(notes, ['Frame "c" is fully transparent; if that is not intended, draw it (pixel_patch) or take it out of the animation.']);
  assert.throws(() => check(small, { animation: 'nope' }), error => error instanceof PixelError && error.path === 'animation');
});

test('the render check passes a delivery that matches the request and names each mismatch with its fix', () => {
  const project = renderProject(spirit), gifs = Object.keys(project.animations).map(name => animationGIF(project, name, {}));
  const match = check(spirit, { gifs, expect: { width: 24, height: 24, colors: 7, transparent: true } });
  assert.deepEqual([match.ok, match.problems], [true, undefined]);
  assert.equal(check(spirit, { expect: { frames: 3, loop: false }, animation: 'blink' }).ok, true);
  const miss = check(spirit, { gifs: [animationGIF(project, 'idle', { scale: 8 })], expect: { width: 32, height: 32, frames: 7, colors: 4, transparent: false, loop: true }, animation: 'idle' });
  assert.equal(miss.ok, false);
  assert.deepEqual(miss.problems.map(problem => [problem.file, problem.asked, problem.got]), [
    ['forest-spirit.png, frames/ and animations/', { width: 32, height: 32 }, { width: 24, height: 24 }],
    ['gifs/idle.gif', { width: 32, height: 32 }, { width: 192, height: 192 }],
    ['forest-spirit.png, frames/ and animations/', 'at most 4 colours', 7],
    ['forest-spirit.png, frames/ and animations/', 'an opaque background', 'transparent or partly transparent pixels in "rest", "rise", "float", "blink", "fall", "settle"']
  ]);
  assert.match(miss.problems[0].fix, /pixel_patch \{ "set": "width", "value": 32 \}/);
  // 32 is no whole multiple of 24, so the GIF waits for the frame size; an asked 24 needs scale 1.
  assert.match(miss.problems[1].fix, /fix the frame size first/);
  const native = check(spirit, { gifs: [animationGIF(project, 'idle', { scale: 8 })], expect: { width: 24 } });
  assert.match(native.problems[0].fix, /"gif": \{ "scale": 1 \} or "gif": \{\}/);
  // A GIF scale chosen on purpose is not a problem when the request names no size.
  assert.equal(check(spirit, { gifs: [animationGIF(project, 'idle', { scale: 8 })], expect: { frames: 7 }, animation: 'idle' }).ok, true);
  // gifScale: GIFs at that multiple of the asked frame size, and a missing GIF when the command makes GIFs at all.
  assert.equal(check(spirit, { gifs: [animationGIF(project, 'idle', { scale: 4 })], expect: { gifScale: 4 } }).ok, true);
  assert.deepEqual(check(spirit, { gifs: [], expect: { gifScale: 4 } }).problems.map(problem => [problem.got, problem.fix]), [['no GIF', 'render again with "gif": { "scale": 4 }']]);
  assert.equal(check(spirit, { expect: { gifScale: 4 } }).ok, true);
  // A GIF background makes an opaque GIF with one more colour, though the frames meet the request.
  const dot = { version: 1, name: 'dot', width: 2, height: 2, palette: { r: '#ff0000' }, frames: [{ name: 'a', ops: [{ op: 'pixel', x: 0, y: 0, color: 'r' }] }] }, dotProject = renderProject(dot);
  const matte = check(dot, { gifs: [animationGIF(dotProject, undefined, { background: '#ffffff' })], expect: { transparent: true, colors: 1 } });
  assert.deepEqual(matte.problems.map(problem => [problem.file, problem.asked, problem.got]), [['gifs/default.gif', 'a transparent background', 'an opaque GIF'], ['gifs/default.gif', 'at most 1 colours', 2]]);
  assert.equal(check(dot, { gifs: [animationGIF(dotProject, undefined, {})], expect: { transparent: true, colors: 1 } }).ok, true);
  // With one animation named, only its GIF is checked: an opaque, three-colour "sky" doesn't fail the "sprite".
  const two = { ...dot, palette: { r: '#ff0000', b: '#0000ff', w: '#ffffff' }, frames: [...dot.frames, { name: 'sky', ops: [{ op: 'rect', x: 0, y: 0, w: 2, h: 2, color: 'b' }, { op: 'pixel', x: 1, y: 1, color: 'w' }, { op: 'pixel', x: 0, y: 1, color: 'r' }] }], animations: { sprite: { frames: ['a'] }, sky: { frames: ['sky'] } } }, twoProject = renderProject(two);
  const both = ['sprite', 'sky'].map(name => animationGIF(twoProject, name, {}));
  assert.equal(check(two, { gifs: both, expect: { transparent: true, colors: 1 }, animation: 'sprite' }).ok, true);
  assert.equal(check(two, { gifs: both, expect: { transparent: true, colors: 1 } }).ok, false);
  const solid = { ...dot, background: 'r' }, solidProject = renderProject(solid);
  assert.equal(check(solid, { gifs: [animationGIF(solidProject, undefined, {})], expect: { transparent: false } }).ok, true);
});

test('the render check fixes sheet.scale with whole multiples, from either side alone', () => {
  const scaled = { ...spirit, sheet: { scale: 4 } }, big = check(scaled, { expect: { width: 24 } });
  assert.deepEqual([big.delivered.size, big.delivered.canvas, big.delivered.scale, big.problems[0].asked], [[96, 96], [24, 24], 4, { width: 24 }]);
  assert.deepEqual(quoted(big.problems[0].fix.replace(/^.*?: (?=pixel_patch)/, '')), { set: 'sheet.scale', value: 1 });
  assert.deepEqual(quoted(check(scaled, { expect: { height: 48 } }).problems[0].fix), { set: 'sheet.scale', value: 2 });
  assert.equal(check(scaled, { expect: { width: 96 } }).ok, true);
  // GIFs ignore sheet.scale: at sheet.scale 2 an asked 48x48 GIF is gif scale 2 of the 24 canvas.
  const twice = { ...spirit, sheet: { scale: 2 } }, project = renderProject(twice);
  assert.equal(check(twice, { gifs: [animationGIF(project, 'idle', { scale: 2 })], expect: { width: 48, height: 48 }, animation: 'idle' }).ok, true);
  const tiny = check(twice, { gifs: [animationGIF(project, 'idle', {})], expect: { width: 48, height: 48 }, animation: 'idle' });
  assert.deepEqual(tiny.problems.map(problem => [problem.got, problem.fix]), [[{ width: 24, height: 24 }, 'render again with "gif": { "scale": 2 }']]);
  // A GIF scale above 16 can't be made: say so rather than blame the frame size.
  assert.match(check(scaled, { gifs: [animationGIF(renderProject(scaled), 'idle', {})], expect: { gifScale: 8 }, animation: 'idle' }).problems[0].fix, /needs scale 32, above the limit of 16/);
  // A recipe with no sheet field gets a change that creates it, which patchRecipe accepts.
  const fix = check(small, { expect: { width: 8, height: 4 } }).problems[0].fix;
  assert.deepEqual(quoted(fix), { set: 'sheet', value: { scale: 2 } });
  assert.equal(check(patchRecipe(small, [quoted(fix)]).recipe, { expect: { width: 8, height: 4 } }).ok, true);
});

test('the render check sees frame counts, pingpong, loops, recipes without animations and backgrounds', () => {
  const tile = check(small, { expect: { frames: 2, loop: true, transparent: true } });
  assert.deepEqual(tile.problems.map(problem => [problem.file, problem.asked, problem.got]), [
    ['animations/gone.png', 2, 1],
    ['tile.png, frames/ and animations/', 'a transparent background', 'no transparent pixel in "a"'],
    ['animations/flash.png', 'a loop', 'one play']
  ]);
  assert.deepEqual(quoted(tile.problems[2].fix), { set: 'animations.flash.loop', value: true });
  // With one animation named, only its frames count: "c" is not in flash.
  assert.equal(check(small, { expect: { transparent: false }, animation: 'flash' }).problems[0].got, 'transparent pixels in "b"');
  assert.equal(check(small, { expect: { transparent: false } }).problems[0].got, 'transparent pixels in "b", "c"');
  assert.equal(check(small, { animation: 'flash' }).notes, undefined);
  // bob is pingpong: 3 names play 4 frames, so 6 played frames need 4 names (or forward).
  assert.match(check(spirit, { expect: { frames: 6 }, animation: 'bob' }).problems[0].fix, /pingpong.*list 4 names in animations\.bob\.frames, or set animations\.bob\.direction to "forward" and list 6 names/);
  assert.equal(check(spirit, { expect: { frames: 4 }, animation: 'bob' }).ok, true);
  // Without an animations field every frame plays once, and the fixes create the field instead of patching a missing one.
  const { animations, ...bare } = small, loose = check(bare, { expect: { loop: false, frames: 2 } });
  assert.match(loose.problems[0].fix, /no animations field, so every frame plays once/);
  const change = quoted(loose.problems[1].fix.replace('the recipe has no animations field: ', ''));
  assert.deepEqual(change, { set: 'animations', value: { default: { frames: ['a', 'b', 'c'], loop: false } } });
  assert.equal(check(patchRecipe(bare, [change]).recipe, { expect: { loop: false } }).ok, true);
});

// The changes a size fix quotes as a JSON array, after `pixel_patch ` or `(or `.
const changesAfter = (fix, marker) => { const start = fix.indexOf(marker) + marker.length - 1; return JSON.parse(fix.slice(start, fix.indexOf(']', start) + 1)); };

test('the render check\'s fixes stay inside the format\'s limits, and applying them passes the check', () => {
  // Over 256 px a side: a smaller canvas at a whole sheet.scale, the one nearest the drawing and the most detailed.
  const big = check(spirit, { expect: { width: 512, height: 512 } }).problems[0].fix;
  assert.match(big, /^canvases stop at 256 px a side, so 512x512 is a 32x32 canvas at sheet\.scale 16, the nearest to the current 24x24: .*a 256x256 canvas at sheet\.scale 2, for the most detail\)/);
  for (const changes of [changesAfter(big, 'pixel_patch ['), changesAfter(big, '(or [')]) {
    assert.equal(check(patchRecipe(spirit, changes).recipe, { expect: { width: 512, height: 512 } }).ok, true, JSON.stringify(changes));
  }
  // One side asked: the other keeps its canvas size. 300 = 25 x 12 is nearest 24.
  const wide = check(spirit, { expect: { width: 300 } }).problems[0].fix;
  assert.deepEqual(changesAfter(wide, 'pixel_patch ['), [{ set: 'width', value: 25 }, { set: 'sheet.scale', value: 12 }]);
  assert.equal(check(patchRecipe(spirit, changesAfter(wide, 'pixel_patch [')).recipe, { expect: { width: 300 } }).ok, true);
  // An atlas the renderer refuses is never offered: 100 frames of 512x512 pass 16,777,216 pixels at any scale.
  const dots = { version: 1, name: 'dots', width: 2, height: 2, palette: { r: '#ff0000' }, frames: Array.from({ length: 100 }, (_, i) => ({ name: `f${i}`, ops: [{ op: 'pixel', x: 0, y: 0, color: 'r' }] })) };
  assert.equal(check(dots, { expect: { width: 512, height: 512 } }).problems[0].fix, 'at every whole scale that makes 512x512, an atlas of 100 frames at 512x512 passes 16,777,216 pixels: ask for fewer frames or a smaller size, or set sheet.trim if the frames have empty margins');
  // The same budgets hold a whole-scale fix: 100 frames of 64x64 at sheet.scale 8 would make that atlas too.
  const tiles = { ...dots, width: 64, height: 64 };
  assert.equal(check(tiles, { expect: { width: 512, height: 512 } }).problems[0].fix, 'an atlas of 100 frames at 512x512 passes 16,777,216 pixels: ask for fewer frames or a smaller size, or set sheet.trim if the frames have empty margins');
  // A GIF scale is held to the 67,108,864 pixels one render's GIFs hold: 300 frames at 32x32, scale 16.
  const reel = { version: 1, name: 'reel', width: 32, height: 32, palette: { r: '#ff0000' }, frames: [{ name: 'a', ops: [{ op: 'pixel', x: 0, y: 0, color: 'r' }] }], animations: { default: { frames: Array(300).fill('a') } } }, reelProject = renderProject(reel);
  assert.match(check(reel, { gifs: [animationGIF(reelProject, 'default', {})], expect: { gifScale: 16 } }).problems[0].fix, /^the GIFs of every animation at scale 16 pass the 67,108,864 pixels/);
  // Partly transparent pixels are reported as such, and don't count as an opaque delivery.
  const glass = { version: 1, name: 'glass', width: 2, height: 2, palette: { g: '#ff000080' }, frames: [{ name: 'a', ops: [{ op: 'rect', x: 0, y: 0, w: 2, h: 2, color: 'g' }] }] };
  const glassy = check(glass, { expect: { transparent: false } });
  assert.deepEqual([glassy.delivered.transparent, glassy.delivered.partlyTransparent, glassy.problems[0].got], [false, true, 'transparent or partly transparent pixels in "a"']);
  const forty = { ...dots, frames: dots.frames.slice(0, 40) }, roomy = check(forty, { expect: { width: 512, height: 512 } }).problems[0].fix;
  assert.equal(check(patchRecipe(forty, changesAfter(roomy, '(or [')).recipe, { expect: { width: 512, height: 512 } }).ok, true);
  // No whole scale: say so and offer the nearest size that exists.
  assert.match(check(spirit, { expect: { width: 4093 } }).problems[0].fix, /no whole scale exports a width of 4093 exactly from 6 frames: tell the user, and offer 4096x384 \(a 256x24 canvas at sheet\.scale 16\) instead$/);

  // An opaque background asked for, with pixels erased after the background: name what erases them.
  const cleared = { version: 1, name: 'cleared', width: 4, height: 2, background: 'r', palette: { r: '#ff0000' }, frames: [{ name: 'a', ops: [{ op: 'clear', x: 0, y: 0, w: 1, h: 1 }] }, { name: 'b', from: 'a' }] };
  assert.equal(check(cleared, { expect: { transparent: false } }).problems[0].fix, 'the background is already opaque, but frame drawing erases it (clear in "a"): remove those or paint over what they clear, then render again');
  assert.equal(check(patchRecipe(cleared, [{ remove: 'frames[a].ops[0]' }]).recipe, { expect: { transparent: false } }).ok, true);
  const shifted = { ...cleared, frames: [{ name: 'a', translate: [1, 0], ops: [{ op: 'dither', erase: true, density: 0.5 }] }] };
  assert.match(check(shifted, { expect: { transparent: false } }).problems[0].fix, /\(dither with erase, translate in "a"\)/);
  assert.equal(check({ ...shifted, frames: [{ name: 'a', translate: [1, 0], wrap: true }] }, { expect: { transparent: false } }).ok, true);
  assert.equal(check(small, { expect: { transparent: false } }).problems[0].fix, 'pixel_patch { "set": "background", "value": "<palette key>" }, and remove or paint over what erases it (clear in "b"), then render again');
  assert.match(check({ ...cleared, background: '#ff000080', frames: [{ name: 'a' }] }, { expect: { transparent: false } }).problems[0].fix, /an opaque one: the current background is see-through/);

  // Frame counts: a recipe holds 256 frames and an animation lists 1,024 names, which may repeat.
  const bare = { version: 1, name: 'bare', width: 2, height: 2, palette: { r: '#ff0000' }, frames: [{ name: 'a', ops: [{ op: 'pixel', x: 0, y: 0, color: 'r' }] }] };
  assert.match(check(bare, { expect: { frames: 300 } }).problems[0].fix, /a recipe holds at most 256 frames: add an animation that lists 300 frame names/);
  assert.equal(check({ ...bare, animations: { default: { frames: Array(300).fill('a') } } }, { expect: { frames: 300 } }).ok, true);
  assert.match(check({ ...bare, width: 256, height: 256 }, { expect: { frames: 100 } }).problems[0].fix, /100 frames of 256x256 pass the limit of 4,194,304 pixels of frames: add an animation/);
  // Above 1,024 only a pingpong plays it, 2n - 2 frames for n names, so an odd count can't be played.
  assert.match(check(bare, { expect: { frames: 2046 } }).problems[0].fix, /a pingpong animation of 1024 frame names, which plays 2046/);
  assert.equal(check({ ...bare, animations: { default: { frames: Array(1024).fill('a'), direction: 'pingpong' } } }, { expect: { frames: 2046 } }).ok, true);
  assert.match(check(bare, { expect: { frames: 1025 } }).problems[0].fix, /^no animation plays 1025 frames: .*play 1024 or 1026$/);
  assert.match(check(spirit, { expect: { frames: 1500 }, animation: 'idle' }).problems[0].fix, /set animations\.idle\.direction to "pingpong" and list 751 names, which play 1500$/);
  assert.equal(check(spirit, { expect: { frames: 2046 }, animation: 'bob' }).problems[0].fix, '"bob" is pingpong, which plays 2n-2 frames for n names: list 1024 names in animations.bob.frames');
  assert.match(check(spirit, { expect: { frames: 9 }, animation: 'idle' }).problems[0].fix, /^make "idle" play 9 frames: list 9 names in animations\.idle\.frames \(a name may repeat/);
  // expect.frames reaches the longest pingpong: 514 names play 1,026 frames.
  assert.equal(check({ ...bare, animations: { default: { frames: Array(514).fill('a'), direction: 'pingpong' } } }, { expect: { frames: 1026 } }).ok, true);
  assert.deepEqual(readExpect({ frames: 2046 }), { frames: 2046 });
});

test('expect is refused by name when it is malformed', () => {
  assert.equal(readExpect(undefined), undefined);
  for (const [expect, where] of [[null, 'expect'], [[], 'expect'], [{ size: 32 }, 'expect.size'], [{ width: 0 }, 'expect.width'], [{ frames: 1.5 }, 'expect.frames'], [{ frames: 2047 }, 'expect.frames'], [{ width: 4097 }, 'expect.width'], [{ gifScale: 17 }, 'expect.gifScale'], [{ loop: 'yes' }, 'expect.loop']]) {
    assert.throws(() => readExpect(expect), error => error instanceof PixelError && error.path === where, JSON.stringify(expect));
  }
});

test('MCP pixel_render and CLI render carry the check, and a bad expect or animation writes nothing', async t => {
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelbolt-check-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const messages = [{ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'pixel_render', arguments: { project: spirit, gif: { scale: 8 }, expect: { width: 24, height: 24 } } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'pixel_render', arguments: { project: spirit, expect: { width: '24' } } } }];
  const result = spawnSync(process.execPath, ['bin/pixelbolt.js', 'mcp', '--out', path.join(dir, 'mcp')], { cwd: root, input: messages.map(message => JSON.stringify(message)).join('\n') + '\n', encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  const [, rendered, refused] = result.stdout.trim().split('\n').map(line => JSON.parse(line).result);
  const info = JSON.parse(rendered.content[0].text);
  assert.deepEqual([info.check.ok, info.check.delivered.gifs, info.check.problems.map(problem => problem.file)], [false, [192, 192], ['gifs/idle.gif, gifs/bob.gif, gifs/blink.gif']]);
  assert.deepEqual([refused.isError, JSON.parse(refused.content[0].text).path], [true, 'expect.width']);
  // Only the first render wrote a folder.
  assert.equal((await readdir(path.join(dir, 'mcp'))).filter(name => !name.startsWith('.')).length, 1);
  const cli = (...args) => spawnSync(process.execPath, ['bin/pixelbolt.js', 'render', 'examples/forest-spirit.json', ...args], { cwd: root, encoding: 'utf8' });
  const out = cli('--out', path.join(dir, 'cli'), '--expect', '{"frames":3,"loop":false,"gifScale":2}', '--animation', 'blink');
  assert.equal(out.status, 0, out.stderr);
  // render writes no GIFs, so gifScale asks nothing of it; blink plays 3 frames once.
  const report = JSON.parse(out.stdout).check;
  assert.deepEqual([report.ok, report.delivered.animations], [true, { blink: { frames: 3, loop: false } }]);
  for (const [args, where] of [[['--expect', '{"width":'], 'expect'], [['--animation', 'nope'], 'animation']]) {
    const bad = cli('--out', path.join(dir, 'bad'), ...args);
    assert.deepEqual([bad.status, JSON.parse(bad.stderr).path], [1, where]);
  }
  await assert.rejects(readdir(path.join(dir, 'bad')));
});
