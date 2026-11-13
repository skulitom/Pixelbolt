import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { renderProject, inspectProject, animationFps } from '../src/core.js';
import { createBundle, describeAnimations } from '../src/export.js';
// The rates a reply carries: each animation's fps, where it has one.
const rates = (project, spec) => Object.fromEntries(Object.entries(describeAnimations(project, spec).animations ?? {}).filter(([, entry]) => entry.fps !== undefined).map(([key, entry]) => [key, entry.fps]));
import { compileAutotile } from '../src/authoring.js';
import { startMCP } from '../src/mcp.js';
import { GODOT_TILE_SOURCES } from '../scripts/verify-godot.mjs';

// Engines and editors ask for frames per second (P-051): a torch of 24 frames at 70 ms each plays at 14.29 fps.
const frames = (count, duration) => Array.from({ length: count }, (_, i) => ({ name: `f${i}`, duration, ops: [{ op: 'pixel', x: i % 4, y: 0, color: 'k' }] }));
const torch = { version: 1, name: 'torch', width: 4, height: 2, palette: { k: '#000' }, frames: frames(24, 70), animations: { burn: { frames: frames(24, 70).map(f => f.name) } } };
const mixed = {
  version: 1, name: 'mixed', width: 4, height: 2, palette: { k: '#000' },
  frames: [...frames(3, 100), { name: 'hold', duration: 240, ops: [{ op: 'pixel', x: 0, y: 1, color: 'k' }] }],
  animations: { idle: { frames: ['f0', 'f1', 'f2', 'hold'] }, bounce: { frames: ['f0', 'f1', 'f2'], direction: 'pingpong', loop: false }, still: { frames: ['hold'] } }
};

test('animationFps gives an evenly timed animation its frames per second, and nothing for mixed timing or one frame', () => {
  const project = renderProject(torch), varied = renderProject(mixed);
  assert.equal(animationFps(project, 'burn'), 14.29);
  assert.equal(animationFps(varied, 'idle'), undefined);
  assert.equal(animationFps(varied, 'bounce'), 10, 'pingpong repeats frames of the same duration');
  assert.equal(animationFps(varied, 'still'), undefined, 'a rate means nothing for a single frame');
  assert.deepEqual(describeAnimations(project, torch), { animations: { burn: { frames: 24, duration: 1680, loop: true, fps: 14.29 } } });
  assert.deepEqual(rates(varied, mixed), { bounce: 10 });
  const idleOnly = { ...mixed, animations: { idle: mixed.animations.idle } };
  assert.deepEqual(Object.keys(describeAnimations(renderProject(idleOnly), idleOnly).animations.idle), ['frames', 'duration', 'loop'], 'no rate where the frames differ in length');
});

test('a slow animation keeps three significant figures, and a still tile set has no rate or timing', async () => {
  const slow = { ...torch, frames: frames(2, 60000), animations: { glow: { frames: ['f0', 'f1'] } } };
  assert.equal(animationFps(renderProject(slow), 'glow'), 0.0167);
  assert.equal(animationFps(renderProject({ ...slow, frames: frames(2, 40000) }), 'glow'), 0.025);
  // A tile set with no animations of its own has only the flipbook of every tile, which createBundle doesn't animate.
  const meadow = compileAutotile(JSON.parse(await readFile(new URL('../examples/meadow.autotile.json', import.meta.url), 'utf8'))).recipe;
  assert.equal(meadow.animations, undefined);
  assert.deepEqual(rates(renderProject(meadow), meadow), {});
  assert.doesNotMatch((await createBundle(meadow)).files.get('README.txt').toString(), /Timing|fps/);
  // One terrain mixing mask modes gets no Godot TileSet, so its frames export as an animation, and are timed as one.
  const mixedModes = structuredClone(meadow), tile = mixedModes.frames.find(frame => frame.ops?.some(op => op.op === 'autotile'));
  for (const op of tile.ops) if (op.op === 'autotile') op.mode = op.mode === 'cardinal' ? 'blob' : 'cardinal';
  const broken = await createBundle(mixedModes);
  assert.ok(broken.files.has('meadow.tres') && !broken.files.has('meadow.tileset.tres'), 'the bundle is not a still tile set');
  assert.deepEqual(rates(renderProject(mixedModes), mixedModes), { default: 10 });
  assert.match(broken.files.get('README.txt').toString(), /\nTiming:\ndefault: \d+ frames of 100 ms \(10 fps\)\n/);
  // Animated tiles keep theirs.
  const surf = compileAutotile(GODOT_TILE_SOURCES[2]).recipe, readme = (await createBundle(surf)).files.get('README.txt').toString();
  assert.match(readme, /\nTiming:\nsurf-\d+: 3 frames of 90 to 250 ms, 460 ms in all\n/);
});

test('a reply describes at most 16 animations and names the rest; README.txt still times every animation', async () => {
  // Twenty animations that each say something else: a different number of frames.
  const many = { ...torch, frames: frames(21, 50), animations: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`a${i}`, { frames: Array.from({ length: i + 2 }, (_, f) => `f${f}`) }])) };
  const described = describeAnimations(renderProject(many), many);
  assert.equal(Object.keys(described.animations).length, 16);
  assert.deepEqual([Object.keys(described.animations).slice(0, 2), described.moreAnimations], [['a0', 'a1'], ['a16', 'a17', 'a18', 'a19']]);
  // Four or more that differ only in a number and are alike in every fact are one entry, counted; fewer stay apart.
  const alike = { ...torch, frames: frames(2, 50), animations: { ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`tile-${i * 3}`, { frames: ['f0', 'f1'] }])), 'tile-900': { frames: ['f0'] }, 'door-1': { frames: ['f0', 'f1'] }, 'door-2': { frames: ['f0', 'f1'] } } };
  assert.deepEqual(describeAnimations(renderProject(alike), alike), { animations: { 'tile-{n}': { count: 20, frames: 2, duration: 100, loop: true, fps: 20 }, 'tile-900': { frames: 1, duration: 50, loop: true }, 'door-1': { frames: 2, duration: 100, loop: true, fps: 20 }, 'door-2': { frames: 2, duration: 100, loop: true, fps: 20 } } });
  const readme = (await createBundle(many)).files.get('README.txt').toString();
  assert.match(readme, /\na19: 21 frames of 50 ms \(20 fps\)\n/);
});

test('README.txt states each animation\'s timing, with its frame rate when every frame lasts the same', async () => {
  const readme = (await createBundle(torch)).files.get('README.txt').toString();
  assert.ok(readme.endsWith('\nTiming:\nburn: 24 frames of 70 ms (14.29 fps)\n'), readme.slice(-200));
  const varied = (await createBundle(mixed)).files.get('README.txt').toString();
  assert.match(varied, /\nTiming:\nidle: 4 frames of 100 to 240 ms, 540 ms in all\nbounce: 4 frames of 100 ms \(10 fps\), plays once\n$/);
  assert.doesNotMatch(varied, /still:/, 'a one-frame animation has no timing line');
  const icon = { version: 1, name: 'icon', width: 2, height: 2, palette: { k: '#000' }, frames: [{ name: 'a', ops: [{ op: 'pixel', x: 0, y: 0, color: 'k' }] }] };
  assert.doesNotMatch((await createBundle(icon)).files.get('README.txt').toString(), /Timing/, 'a still has no timing section');
});

test('inspect\'s timing names the frame rate of an evenly timed animation', () => {
  const view = inspectProject(renderProject(torch), { animation: 'burn', diagnostics: true });
  assert.equal(view.timing.fps, 14.29);
  const varied = inspectProject(renderProject(mixed), { animation: 'idle', diagnostics: true });
  assert.equal('fps' in varied.timing, false);
});

test('MCP validate, inspect and render replies carry fps beside the animations', async t => {
  const base = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(base, 'pixelbolt-fps-'));
  t.after(async () => { assert.ok(dir.startsWith(base + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const input = new PassThrough(), output = new PassThrough(), waiting = new Map(); let buffer = '', next = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)?.(message); } });
  const running = startMCP({ input, output, directory: dir });
  const request = (method, params) => new Promise(resolve => { waiting.set(++next, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n'); });
  const call = async (name, args) => JSON.parse((await request('tools/call', { name, arguments: args })).result.content[0].text);
  try {
    await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    const validated = await call('pixel_validate', { project: torch });
    // Every reply describes the animations one way.
    const burn = { burn: { frames: 24, duration: 1680, loop: true, fps: 14.29 } };
    assert.deepEqual([validated.frames, validated.animations], [24, burn]);
    assert.deepEqual((await call('pixel_inspect', { revision: validated.revision })).animations, burn);
    const rendered = await call('pixel_render', { revision: validated.revision });
    assert.deepEqual([rendered.frames, rendered.animations, rendered.folders], [24, burn, { frames: 24, animations: 1 }]);
    assert.match(await readFile(path.join(rendered.directory, 'README.txt'), 'utf8'), /burn: 24 frames of 70 ms \(14\.29 fps\)/);
    assert.equal('fps' in (await call('pixel_validate', { project: { ...mixed, animations: { idle: mixed.animations.idle } } })).animations.idle, false);
  } finally { input.end(); await running; }
});
