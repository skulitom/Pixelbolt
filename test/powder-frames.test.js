import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, createSequence, createPowderSequence } from '../src/index.js';
import { compilePowder, createLivePowder, powderFrames, sandboxSource, CLIP_FRAMES } from '../src/powder.js';
import { decodePNG } from '../src/import.js';
import { startMCP } from '../src/mcp.js';

// powderFrames steps one clip of a falling-sand source as its frames are shown, for video frames (src/sequence.js):
// every frame must be the one compilePowder draws, and a clip may run past the 256 frames and pixels a recipe holds.
const root = fileURLToPath(new URL('../', import.meta.url));
const example = async name => JSON.parse(await readFile(path.join(root, 'examples', `${name}.powder.json`), 'utf8'));
const same = (a, b) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
// A sequence's files as bytes, in the order they are written: a streamed one makes each as it is asked for.
const written = files => [...files].map(([name, bytes]) => [name, (typeof bytes === 'function' ? bytes() : bytes).toString('base64')]);
const pngs = files => written(files).filter(([name]) => name.endsWith('.png'));
const temp = async (t, label) => {
  const base = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(base, `pixelbolt-${label}-`));
  t.after(async () => { assert.ok(dir.startsWith(base + path.sep)); await rm(dir, { recursive: true, force: true }); });
  return dir;
};
// Sand poured onto a stone floor for 300 drawn frames: more than a recipe holds.
const pour = (frames = 300) => ({ ...sandboxSource(24, 24, [{ material: 'stone', rect: [0, 22, 24, 2] }, { material: 'sand', rect: [8, 0, 8, 6] }]), name: 'pour', inputs: [{ frames: [0, 280], every: 7, paint: { material: 'sand', x: 12, y: 1, radius: 1 } }], clips: { fall: { frames, every: 1, duration: 20 }, start: { frames: 4 } } });

test('a falling-sand clip stepped for video frames shows the frames its recipe draws, whatever the options', async () => {
  for (const preset of ['quarry-blast', 'rain-on-fire']) {
    const source = await example(preset), recipe = renderProject(compilePowder(source).recipe);
    // Frame by frame, skipping some, and back again: a grid only steps forward, so an earlier frame runs it afresh.
    const clip = powderFrames(source);
    assert.deepEqual([clip.name, clip.width, clip.height, clip.frames, clip.duration], [recipe.name, recipe.width, recipe.height, recipe.frames.length, recipe.frames[0].duration]);
    for (const n of [0, 1, 5, clip.frames - 1, 3, 0]) assert.ok(same(clip.image(n), recipe.frames[n].data), `${preset}: frame ${n}`);
    // The same through the sequence a video editor gets: the PNG files, their names and their bytes. Both sides enlarge
    // a frame in the same code (build's compose), so the shorter clip shows 720p and the longer runs at its rate unenlarged.
    const enlarged = preset === 'quarry-blast' ? { size: '720p', align: 'bottom' } : {};
    for (const options of [{ fps: 30 }, { fps: 12, loops: 2 }, { fps: 30, step: 2 }, { fps: 60, seconds: 1.5, background: '#102030' }, { fps: 25, ...enlarged }]) {
      assert.deepEqual(pngs(createPowderSequence(source, options).files), pngs(createSequence(recipe, options).files), `${preset} ${JSON.stringify(options)}`);
    }
  }
  // It says what it is, which clip it played and where the grid stood after the last frame.
  const source = await example('quarry-blast'), { info } = createPowderSequence(source, { fps: 30 }), compiled = compilePowder(source).metadata;
  const [name, summary] = Object.entries(compiled.clips)[0];
  assert.deepEqual([info.source, info.powder, info.clip, info.loop.plays, info.loop.loops], ['powder', source.name, name, 'once', 1]);
  assert.deepEqual(info.ended, { step: summary.steps, counts: summary.counts, settled: summary.settled });
});

test('a clip longer than a recipe holds is written as video frames; compile says so', async () => {
  const source = pour();
  assert.throws(() => compilePowder(source), error => error.path === 'powder.clips.fall.frames' && /a recipe holds at most 256 frames; write a longer clip as numbered video frames: pixelbolt sequence <source> --out <folder> --fps 30, or pixel_compile with sequence/.test(error.message));
  assert.throws(() => compilePowder(pour(CLIP_FRAMES + 1)), error => error.path === 'powder.clips.fall.frames' && /whole number from 1 to 256/.test(error.message));
  assert.throws(() => createPowderSequence(pour(CLIP_FRAMES + 1), { fps: 50 }), error => error.path === 'powder.clips.fall.frames' && /whole number from 1 to 18000/.test(error.message));
  // 300 frames of 20 ms at 50 frames a second: one video frame each, every one made, none kept as a recipe.
  const made = createPowderSequence(source, { fps: 50 }), { info } = made;
  assert.deepEqual([info.frames, info.differentFrames, info.seconds, info.width, info.height, info.clip, info.notes], [300, 300, 6, 24, 24, 'fall', []]);
  assert.deepEqual(info.ended.step, 299);
  // Each is the grid at its step, drawn as a page would draw it live.
  const live = createLivePowder(source);
  for (const frame of [1, 150, 300]) {
    live.step(frame - 1 - live.frame);
    assert.ok(same(decodePNG(made.files.get(`pour-fall_${String(frame).padStart(4, '0')}.png`)).data, live.render().rgba), `video frame ${frame}`);
  }
  assert.equal(info.ended.counts.sand, live.measure().counts.sand);
  // The command line's way: each frame made as it is written, one held at a time, and the same files.
  const streamed = createPowderSequence(source, { fps: 50 }, { stream: true });
  assert.ok([...streamed.files.values()].every(file => typeof file === 'function'));
  assert.deepEqual([streamed.info.differentFrames, streamed.info.ended], [0, undefined]);
  assert.deepEqual(written(streamed.files), written(made.files));
  assert.deepEqual([streamed.info.differentFrames, streamed.info.ended], [300, info.ended]);
  // Another clip by name; one that isn't there is named with those that are.
  assert.deepEqual(createPowderSequence(source, { fps: 30, animation: 'start' }).info.clip, 'start');
  assert.throws(() => createPowderSequence(source, { fps: 30, animation: 'end' }), error => error.path === 'sequence.animation' && /no clip named "end"; choose one of: fall, start/.test(error.message));
});

test('a grid larger than a recipe\'s canvas is written as video frames; compile says so', () => {
  const wide = { ...sandboxSource(300, 40, [{ material: 'stone', rect: [0, 36, 300, 4] }, { material: 'water', rect: [100, 0, 100, 8] }]), name: 'wide', clips: { spill: { frames: 12, every: 4, duration: 200 } } };
  assert.throws(() => compilePowder(wide), error => error.path === 'powder.width' && /at most 256 pixels a side; use a smaller grid, write a larger one as numbered video frames \(pixelbolt sequence\), or run it live/.test(error.message));
  const made = createPowderSequence(wide, { fps: 5, scale: 2 }), live = createLivePowder(wide);
  assert.deepEqual([made.info.width, made.info.height, made.info.frames, made.info.placement.source], [600, 80, 12, [300, 40]]);
  live.step(44);
  const last = decodePNG(made.files.get('wide-spill_0012.png')), drawn = live.render().rgba;
  for (const [x, y] of [[0, 0], [150, 20], [299, 39], [120, 37]]) assert.deepEqual([...last.data.subarray((y * 2 * 600 + x * 2) * 4, (y * 2 * 600 + x * 2) * 4 + 4)], [...drawn.subarray((y * 300 + x) * 4, (y * 300 + x) * 4 + 4)], `pixel ${x},${y}`);
});

test('a clip that will not fit is refused before it is simulated, naming the command line, and frames that fall between video frames are counted', () => {
  const source = pour(), told = command => error => error.path === 'sequence' && error.message.includes(`${command} sequence <source.json> --out <new folder> --fps 50`);
  // One call keeps every different frame: 256 at 4096×4096. The command line writes each as it is made.
  assert.throws(() => createPowderSequence(source, { fps: 50, size: '4096x4096' }, { command: 'npx -y pixelbolt@1.2.3' }), told('npx -y pixelbolt@1.2.3'));
  assert.equal(createPowderSequence(source, { fps: 50, size: '4096x4096' }, { stream: true }).info.frames, 300);
  // A repeated clip's frames come back, so it is held as one call's are, and says to leave loops out.
  assert.throws(() => createPowderSequence(source, { fps: 50, size: '4096x4096', loops: 2 }, { stream: true }), error => error.path === 'sequence' && /the clip shows 300 different frames at 4096×4096; a sequence made in one call, or one that repeats, holds at most 256 at that size .*Leave loops out/.test(error.message));
  // A caller with a time limit (MCP) gives a budget of pixels.
  assert.throws(() => createPowderSequence(source, { fps: 50 }, { budget: 1, command: 'npx -y pixelbolt@1.2.3' }), told('npx -y pixelbolt@1.2.3'));
  assert.throws(() => createPowderSequence(source, { fps: 50 }, { budget: 1 }), told('npx -y pixelbolt'));
  assert.throws(() => createPowderSequence(source, null), error => error.path === 'sequence' && /expected an object/.test(error.message));
  assert.throws(() => createPowderSequence(source, {}), error => error.path === 'sequence.fps');
  // 20 ms frames at 25 frames a second: every other one falls between video frames.
  assert.deepEqual(createPowderSequence(source, { fps: 25 }).info.notes, ['150 of the clip\'s 300 frames (20 ms each) fall between video frames at 25 frames per second and are not shown; give the clip a duration of at least one video frame (40 ms at this rate).']);
  // Cut short by seconds, only the frames up to the last one shown are counted.
  assert.deepEqual(createPowderSequence(source, { fps: 25, seconds: 1 }).info.notes, ['24 of the clip\'s first 49 frames (20 ms each) fall between video frames at 25 frames per second and are not shown; give the clip a duration of at least one video frame (40 ms at this rate).']);
});

test('a repeated clip whose passes fall differently on the frame grid runs its grid once', () => {
  // 40 frames of 17 ms at 6 frames a second, twice: the second pass shows frames 18, 28 and 38, which the first passed
  // over on its way to 19, 29 and 39. Asked for in that order, each made the grid run again from its start, so the
  // work grew with the loops and passed the limit the clip was checked against.
  const source = { ...pour(40), clips: { fall: { frames: 40, every: 2, duration: 17 } } }, options = { fps: 6, loops: 2 };
  const made = createPowderSequence(source, options), recipe = renderProject(compilePowder(source).recipe);
  assert.deepEqual(pngs(made.files), pngs(createSequence(recipe, options).files));
  assert.deepEqual([made.info.frames, made.info.differentFrames, made.info.loop.loops], [9, 8, 2]);
  // The grid stands at the latest frame shown (39, step 78), not at the last one asked for (38).
  assert.equal(made.info.ended.step, 78);
  // Frames kept for a later pass are bounded: 800 of 300×300 are more than a repeated clip keeps.
  const large = { ...sandboxSource(300, 300, [{ material: 'sand', rect: [100, 0, 100, 20] }]), name: 'large', clips: { fall: { frames: 800, every: 1, duration: 20 } } };
  assert.throws(() => createPowderSequence(large, { fps: 50, loops: 2 }), error => error.path === 'sequence.loops' && /a repeated clip keeps the frames a later pass shows, at most 67,108,864 grid pixels of different frames; this one shows 800 of 300×300\. Leave loops out/.test(error.message));
});

test('pixelbolt sequence writes a long falling-sand clip from its source, a frame at a time', async t => {
  const dir = await temp(t, 'powder-sequence'), file = path.join(dir, 'pour.powder.json'), out = path.join(dir, 'frames');
  await writeFile(file, JSON.stringify(pour()));
  const run = spawnSync(process.execPath, [path.join(root, 'bin', 'pixelbolt.js'), 'sequence', file, '--out', out, '--fps', '50', '--scale', '2'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const reply = JSON.parse(run.stdout), names = await readdir(out);
  assert.deepEqual([reply.ok, reply.source, reply.powder, reply.clip, reply.frames, reply.differentFrames, reply.width, reply.files, reply.ended.step], [true, 'powder', 'pour', 'fall', 300, 300, 48, 302, 299]);
  assert.equal(names.filter(name => /^pour-fall_\d{4}\.png$/.test(name)).length, 300);
  assert.deepEqual(JSON.parse(await readFile(path.join(out, 'sequence.json'), 'utf8')).ended, reply.ended);
  // The same clip as a recipe is refused, naming this command.
  const compiled = spawnSync(process.execPath, [path.join(root, 'bin', 'pixelbolt.js'), 'compile', file, '--out', path.join(dir, 'pour.json')], { encoding: 'utf8' });
  assert.equal(compiled.status, 1);
  assert.match(JSON.parse(compiled.stderr).error, /write a longer clip as numbered video frames: pixelbolt sequence/);
});

test('MCP pixel_compile writes a falling-sand clip as video frames, and still refuses other sources', async t => {
  const dir = await temp(t, 'powder-mcp'), input = new PassThrough(), output = new PassThrough(), waiting = new Map(); let buffer = '', next = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)?.(message); } });
  const running = startMCP({ input, output, directory: dir });
  t.after(async () => { input.end(); await running; });
  const request = (method, params) => new Promise(resolve => { waiting.set(++next, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n'); });
  const call = async (name, args) => { const result = (await request('tools/call', { name, arguments: args })).result; return { result, info: JSON.parse(result.content[0].text) }; };
  await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  const made = await call('pixel_compile', { source: pour(), sequence: { fps: 50, animation: 'fall' } });
  assert.ok(!made.result.isError, made.result.content[0].text);
  assert.deepEqual([made.info.ok, made.info.name, made.info.sequence.frames, made.info.sequence.loop.plays, made.info.ended.step, made.info.figures], [true, 'pour', 300, 'once', 299, undefined]);
  assert.equal((await readdir(path.join(made.info.directory, 'sequence'))).filter(name => name.endsWith('.png')).length, 300);
  // A clip too large for one call names the command line, with this release's version.
  const refused = await call('pixel_compile', { source: pour(), sequence: { fps: 50, size: '4k' } });
  assert.ok(refused.result.isError);
  assert.match(refused.info.error, /the clip shows 300 different frames at 3840×2160, more than one call draws in its time .*Run it on the command line, which has no time limit: npx -y pixelbolt@\d+\.\d+\.\d+ sequence <source\.json> --out <new folder> --fps 50 --size 4k/);
  // Sources that compile to a recipe keep the two-step way.
  const other = await call('pixel_compile', { source: { format: 'pixelforge-fx', version: 1, name: 'x', width: 8, height: 8, effects: {} }, sequence: { fps: 30 } });
  assert.match(other.info.error, /pixel_compile writes video frames for a pixelforge-bodies match or a pixelforge-powder clip; for other sources compile, then pixel_render with sequence/);
});
