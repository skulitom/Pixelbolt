import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, PixelError } from '../src/core.js';
import { animationGIF } from '../src/gif.js';
import { readExpect, checkDelivery } from '../src/check.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const spirit = JSON.parse(await readFile(path.join(root, 'examples', 'forest-spirit.json'), 'utf8'));
// A 4x2 recipe: frame "a" opaque in two colours, "b" with a transparent pixel, "c" empty.
const small = { version: 1, name: 'tile', width: 4, height: 2, palette: { r: '#ff0000', g: '#00ff00' },
  frames: [{ name: 'a', ops: [{ op: 'rect', x: 0, y: 0, w: 4, h: 2, color: 'r' }, { op: 'pixel', x: 0, y: 0, color: 'g' }] }, { name: 'b', from: 'a', ops: [{ op: 'clear', x: 3, y: 1, w: 1, h: 1 }] }, { name: 'c', ops: [] }],
  animations: { flash: { frames: ['a', 'b'], loop: false }, gone: { frames: ['c'] } } };

test('the render check reports what was delivered, and a hint, when nothing was asked for', () => {
  const check = checkDelivery(renderProject(spirit));
  assert.deepEqual(check.delivered, { size: [24, 24], animations: { idle: { frames: 7, loop: true }, bob: { frames: 4, loop: true }, blink: { frames: 3, loop: false } }, colors: 7, transparent: true });
  assert.equal(check.ok, undefined); assert.equal(check.problems, undefined); assert.match(check.hint, /Pass expect/);
  const project = renderProject(small), { delivered, notes } = checkDelivery(project, { gifs: [animationGIF(project, 'flash', { scale: 2 })] });
  // Fully transparent pixels are not colours; a frame with one clear pixel makes the delivery partly transparent.
  assert.deepEqual([delivered.colors, delivered.transparent, delivered.gifs], [2, 'some frames', [8, 4]]);
  assert.deepEqual(notes, ['Frame "c" is fully transparent; if that is not intended, draw it (pixel_patch) or take it out of the animation.']);
});

test('the render check passes a delivery that matches the request and names each mismatch with its fix', () => {
  const project = renderProject(spirit), native = Object.keys(project.animations).map(name => animationGIF(project, name, {}));
  const match = checkDelivery(project, { gifs: native, expect: { width: 24, height: 24, colors: 7, transparent: true } });
  assert.deepEqual([match.ok, match.problems], [true, undefined]);
  // One animation can be checked on its own: blink plays 3 frames once.
  assert.equal(checkDelivery(project, { expect: { frames: 3, loop: false }, animation: 'blink' }).ok, true);
  const miss = checkDelivery(project, { gifs: [animationGIF(project, 'idle', { scale: 8 })], expect: { width: 32, height: 32, frames: 7, colors: 4, transparent: false, loop: true }, animation: 'idle' });
  assert.equal(miss.ok, false);
  assert.deepEqual(miss.problems.map(problem => [problem.file, problem.asked, problem.got]), [
    ['forest-spirit.png, frames/ and animations/', [32, 32], [24, 24]],
    ['gifs/idle.gif', [24, 24], [192, 192]],
    ['forest-spirit.png, frames/ and animations/', 'at most 4 colours', 7],
    ['forest-spirit.png, frames/ and animations/', 'an opaque background', 'transparent pixels in "rest", "rise", "float", "blink", "fall", "settle"']
  ]);
  assert.match(miss.problems[0].fix, /"set": "width", "value": 32/);
  assert.match(miss.problems[1].fix, /"gif": \{ "scale": 1 \} or "gif": \{\}/);
  // A GIF scale the user asked for, and no GIF written at all.
  assert.deepEqual(checkDelivery(project, { expect: { gifScale: 4 } }).problems.map(problem => problem.got), ['no GIF']);
  assert.equal(checkDelivery(project, { gifs: [animationGIF(project, 'idle', { scale: 4 })], expect: { gifScale: 4 } }).ok, true);
});

test('the render check sees sheet.scale, frame counts, loops and an opaque background', () => {
  const scaled = renderProject({ ...spirit, sheet: { scale: 4 } });
  const big = checkDelivery(scaled, { expect: { width: 24, height: 24 } });
  assert.deepEqual([big.delivered.size, big.delivered.canvas, big.delivered.scale], [[96, 96], [24, 24], 4]);
  assert.match(big.problems[0].fix, /"set": "sheet.scale", "value": 1/);
  const project = renderProject(small), check = checkDelivery(project, { expect: { frames: 2, loop: true, transparent: true } });
  assert.deepEqual(check.problems.map(problem => [problem.file, problem.asked, problem.got]), [
    ['animations/gone.png', 2, 1],
    ['tile.png, frames/ and animations/', 'a transparent background', 'no transparent pixel in "a"'],
    ['animations/flash.png', 'a loop', 'one play']
  ]);
  assert.match(check.problems[2].fix, /"set": "animations.flash.loop", "value": true/);
  // With one animation named, only its frames count: "c" is not in flash.
  assert.equal(checkDelivery(project, { expect: { transparent: false }, animation: 'flash' }).problems[0].got, 'transparent pixels in "b"');
  assert.equal(checkDelivery(project, { expect: { transparent: false } }).problems[0].got, 'transparent pixels in "b", "c"');
  assert.deepEqual(checkDelivery(project, { animation: 'flash' }).notes, undefined);
});

test('expect is refused by name when it is malformed', () => {
  assert.equal(readExpect(undefined), undefined);
  for (const [expect, where] of [[null, 'expect'], [[], 'expect'], [{ size: 32 }, 'expect.size'], [{ width: 0 }, 'expect.width'], [{ frames: 1.5 }, 'expect.frames'], [{ gifScale: 17 }, 'expect.gifScale'], [{ loop: 'yes' }, 'expect.loop']]) {
    assert.throws(() => readExpect(expect), error => error instanceof PixelError && error.path === where, JSON.stringify(expect));
  }
});

test('MCP pixel_render and CLI render carry the check, and a bad expect writes nothing', async t => {
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
  const out = cli('--out', path.join(dir, 'cli'), '--expect', '{"frames":3,"loop":false,"transparent":true}');
  assert.equal(out.status, 0, out.stderr);
  const report = JSON.parse(out.stdout).check;
  assert.deepEqual([report.ok, report.problems.map(problem => problem.file)], [false, ['animations/idle.png', 'animations/bob.png', 'animations/idle.png', 'animations/bob.png']]);
  const bad = cli('--out', path.join(dir, 'bad'), '--expect', '{"width":');
  assert.deepEqual([bad.status, JSON.parse(bad.stderr).path], [1, 'expect']);
  await assert.rejects(readdir(path.join(dir, 'bad')));
});
