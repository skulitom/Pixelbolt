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
  assert.deepEqual(plain.delivered, { size: [24, 24], animations: { idle: { frames: 7, loop: true }, bob: { frames: 4, loop: true }, blink: { frames: 3, loop: false } }, colors: 7, transparent: true });
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
    ['forest-spirit.png, frames/ and animations/', 'an opaque background', 'transparent pixels in "rest", "rise", "float", "blink", "fall", "settle"']
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

test('expect is refused by name when it is malformed', () => {
  assert.equal(readExpect(undefined), undefined);
  for (const [expect, where] of [[null, 'expect'], [[], 'expect'], [{ size: 32 }, 'expect.size'], [{ width: 0 }, 'expect.width'], [{ frames: 1.5 }, 'expect.frames'], [{ gifScale: 17 }, 'expect.gifScale'], [{ loop: 'yes' }, 'expect.loop']]) {
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
