import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile, readdir, mkdir } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMCP, MAX_ARGUMENT_DEPTH } from '../src/mcp.js';
import { MAX_REQUEST_BYTES } from '../src/core.js';
import { encodePNG } from '../src/png.js';
import { createOverlay } from '../src/overlays.js';
import { skinkRig, heroRig } from '../scripts/figure-rigs.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = async (t, label) => {
  const base = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(base, `pixelbolt-${label}-`));
  t.after(async () => { assert.ok(dir.startsWith(base + path.sep)); await rm(dir, { recursive: true, force: true }); });
  return dir;
};
function session(options) {
  const input = new PassThrough(), output = new PassThrough(), waiting = new Map(); let buffer = '', next = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)?.(message); } });
  const running = startMCP({ input, output, ...options });
  const request = (method, params) => new Promise(resolve => { waiting.set(++next, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n'); });
  const call = async (name, args) => { const result = (await request('tools/call', { name, arguments: args })).result; return { result, info: JSON.parse(result.content[0].text) }; };
  return { input, running, request, call, waiting, init: () => request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } }) };
}
const strip = { version: 1, name: 'strip', width: 4, height: 2, palette: { k: '#000' }, frames: [{ name: 'a', ops: [{ op: 'pixel', x: 3, y: 1, color: 'k' }] }, { name: 'b', duration: 90 }] };

test('MCP keeps what an agent reads small: brief tool schemas, a quick start, and the long documents as topics', async t => {
  const dir = await temp(t, 'help'), mcp = session({ directory: dir }); await mcp.init();
  try {
    // With the recipe schema embedded in four tools the listing was 133 KB, about 36,000 tokens on every connect.
    const listed = (await mcp.request('tools/list', {})).result.tools, bytes = Buffer.byteLength(JSON.stringify(listed));
    assert.ok(bytes < 24576, `${bytes} bytes of tool listings`);
    assert.ok(listed.every(tool => !JSON.stringify(tool.inputSchema).includes('$defs')));
    const help = async topic => (await mcp.request('tools/call', { name: 'pixel_help', arguments: topic ? { topic } : {} })).result.content.map(block => block.text);
    const [quick, ...more] = await help();
    assert.equal(more.length, 0);
    assert.match(quick, /^# Pixelbolt quick start/);
    assert.ok(Buffer.byteLength(quick) < 12288, `${Buffer.byteLength(quick)} bytes of quick start`);
    // Every topic the tool offers is named in the quick start and serves its document.
    const topics = listed.find(tool => tool.name === 'pixel_help').inputSchema.properties.topic.enum;
    assert.deepEqual(topics, ['guide', 'workflow', 'schema', 'example', 'poses', 'scenes', 'autotile', 'fx', 'fluid', 'wave', 'normals', 'presets', 'preset']);
    for (const topic of topics) assert.ok(quick.includes(`\`${topic}\``), `the quick start names topic ${topic}`);
    assert.match((await help('guide'))[0], /^# Pixelbolt agent authoring guide/);
    assert.match((await help('workflow'))[0], /^# Deliberate pixel art/);
    assert.equal(JSON.parse((await help('schema'))[0]).title, 'Pixelbolt project');
    // The quick start's recipe and the example topic are valid recipes that draw without warnings.
    const recipe = JSON.parse(quick.match(/```json\n([\s\S]*?)\n```/)[1]), example = JSON.parse((await help('example'))[0]);
    for (const project of [recipe, example]) {
      const checked = await mcp.call('pixel_validate', { project });
      assert.equal(checked.info.ok, true, JSON.stringify(checked.info)); assert.deepEqual(checked.info.warnings, []);
    }
    // The tool schemas no longer describe the recipe in detail; the server still rejects a mistake with its path.
    const wrong = await mcp.call('pixel_validate', { project: { ...recipe, animations: undefined, frames: [{ name: 'a', ops: [{ op: 'circle' }] }] } });
    assert.equal(wrong.result.isError, true); assert.equal(wrong.info.path, 'project.frames[0].ops[0].op'); assert.equal(wrong.info.errors, undefined);
    // Every broken operation in one reply.
    const twice = await mcp.call('pixel_validate', { project: { ...recipe, animations: undefined, frames: [{ name: 'a', ops: [{ op: 'circle' }, { op: 'rect', x: 0, y: 0, w: 0, h: 1, color: 'k' }] }] } });
    assert.deepEqual(twice.info.errors.map(item => item.path), ['project.frames[0].ops[0].op', 'project.frames[0].ops[1].w']);
  } finally { mcp.input.end(); await mcp.running; }
});

test('MCP compiles the full 40-frame hero with metadata and images below one MiB', async t => {
  const dir = await temp(t, 'hero-response'), mcp = session({ directory: dir }); await mcp.init();
  try {
    const response = await mcp.call('pixel_compile', { source: heroRig(), metadata: true });
    assert.ok(!response.result.isError, JSON.stringify(response.info));
    assert.equal(response.info.frames, 40);
    const bytes = Buffer.byteLength(JSON.stringify(response.result));
    assert.ok(bytes <= 1048576, `${bytes} response bytes`);
    t.diagnostic(`R2 pixel_compile response with metadata: ${bytes} bytes`);
  } finally { mcp.input.end(); await mcp.running; }
});

test('MCP motion review accepts a pose source or a revision with explicit compile metadata', async t => {
  const dir = await temp(t, 'motion'), mcp = session({ directory: dir, root: dir }); await mcp.init();
  try {
    const source = skinkRig(), compiled = await mcp.call('pixel_compile', { source, metadata: true });
    const options = { view: 'motion', animation: 'run', speed: 48, scale: 1 };
    const direct = await mcp.call('pixel_inspect', { source, ...options });
    const saved = await mcp.call('pixel_inspect', { revision: compiled.info.revision, metadata: compiled.info.metadata, ...options });
    assert.ok(!direct.result.isError, JSON.stringify(direct.info));
    assert.deepEqual(direct.result, saved.result);
    assert.deepEqual(direct.info.motion.checks, { slide: true, ground: true, poseSpread: true, loopSeam: true });
    assert.equal(direct.result.content.filter(c => c.type === 'image').length, 2);
    const unknown = await mcp.call('pixel_inspect', { revision: compiled.info.revision, ...options });
    assert.equal(unknown.info.motion.checks.slide, null);
    const conflicting = await mcp.call('pixel_inspect', { source, revision: compiled.info.revision, ...options });
    assert.equal(conflicting.result.isError, true);
    const invalid = await mcp.call('pixel_inspect', { source, frames: ['idle'], ...options });
    assert.equal(invalid.result.isError, true);
  } finally { mcp.input.end(); await mcp.running; }
});

test('MCP answers an oversized request with an error, recovers its id and keeps serving', async t => {
  const dir = await temp(t, 'oversize'), { input, running, request, init, waiting } = session({ directory: dir });
  await init();
  const errored = new Promise(resolve => waiting.set(7, resolve));
  // No newline for well over the limit: the server discards it chunk by chunk, then answers once the line ends.
  input.write('{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"pixel_validate","arguments":{"project":"');
  const chunk = 'x'.repeat(4 * 1024 * 1024);
  for (let sent = 0; sent <= MAX_REQUEST_BYTES; sent += chunk.length) input.write(chunk);
  input.write('"}}}\n');
  const reply = await errored;
  assert.equal(reply.id, 7); assert.equal(reply.error.code, -32600); assert.match(reply.error.message, /exceeds/);
  assert.deepEqual((await request('ping')).result, {});
  input.end(); await running;
});

test('MCP answers a deeply nested request with an error and keeps serving', async t => {
  const dir = await temp(t, 'deep'), { input, running, request, call, init, waiting } = session({ directory: dir });
  await init();
  try {
    // About 12 KB nested 6,000 deep: copying it to the tool worker overflowed the stack, and the server exited.
    const answered = new Promise(resolve => waiting.set(90, resolve)), nested = depth => '['.repeat(depth) + ']'.repeat(depth);
    input.write(`{"jsonrpc":"2.0","id":90,"method":"tools/call","params":{"name":"pixel_validate","arguments":{"project":${nested(6000)}}}}\n`);
    const reply = await answered;
    assert.equal(reply.id, 90); assert.equal(reply.error.code, -32602);
    assert.equal(reply.error.message, `Invalid tool arguments: nested more than ${MAX_ARGUMENT_DEPTH} levels deep`);
    // One level inside the limit reaches the tool, which names the mistake as usual.
    const inside = await call('pixel_validate', { project: JSON.parse(nested(MAX_ARGUMENT_DEPTH - 1)) });
    assert.equal(inside.result.isError, true); assert.match(inside.info.error, /^project/);
    assert.deepEqual((await request('ping')).result, {});
    assert.equal((await call('pixel_validate', { project: strip })).info.ok, true);
  } finally { input.end(); await running; }
});

test('MCP stops a tool call that runs past its time limit or out of memory, and keeps serving', async t => {
  // The time limit is a timer in this process, so the test moves a mocked clock: the slow call is stopped when the
  // clock passes 0.3 s, and the calls after it take as long as the machine needs. On a real clock the next call, in a
  // fresh worker, was held to 0.3 s too, and a busy Windows runner once took longer (P-048).
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dir = await temp(t, 'limits'), slow = session({ directory: dir, timeLimit: 300 }); await slow.init();
  try {
    // A thick liquid this size takes most of a minute to simulate, well inside the compiler's own work budget.
    const goo = { kind: 'liquid', frames: 256, loop: true, warmup: 8, substeps: 4, iterations: 1, viscosity: 64, yield: 16, apic: true, walls: ['left', 'right', 'bottom', 'top'],
      fill: [{ x: 0, y: 0, w: 64, h: 52 }], emitters: [], look: [{ field: 'density', colors: ['a', 'b'], thresholds: [0.3, 0.6] }] };
    const source = { format: 'pixelforge-fluid', version: 1, name: 'slow', width: 64, height: 52, palette: { a: '#123', b: '#456' }, effects: { goo } };
    // The limit's timer starts once the worker has loaded. A first call loads it, so the slow call's timer starts at
    // once, and the clock moves on until the slow call is answered.
    assert.equal((await slow.call('pixel_validate', { project: strip })).info.ok, true);
    let stopped;
    const answered = slow.call('pixel_compile', { source }).then(reply => { stopped = reply; });
    while (!stopped) { t.mock.timers.tick(300); await new Promise(resolve => setImmediate(resolve)); }
    await answered;
    assert.equal(stopped.result.isError, true);
    assert.match(stopped.info.error, /^pixel_compile took longer than 0\.3 s and was stopped\. Make the work smaller/);
    // The protocol kept answering, and the next call runs in a fresh worker.
    assert.deepEqual((await slow.request('ping')).result, {});
    const next = await slow.call('pixel_validate', { project: strip });
    assert.equal(next.info.error, undefined); assert.equal(next.info.ok, true);
  } finally { slow.input.end(); await slow.running; t.mock.timers.reset(); }
  // A call that needs more JavaScript objects than the memory limit allows is stopped the same way. The worker starts
  // in about 11 MB; this recipe's 400,000 operations take about 24 MB more before any drawing.
  const small = session({ directory: dir, memoryLimit: 24 }); await small.init();
  try {
    const ops = Array.from({ length: 400000 }, (_, i) => ({ op: 'pixel', x: i % 4, y: i % 2, color: 'k' }));
    const stopped = await small.call('pixel_validate', { project: { ...strip, frames: [{ name: 'a', ops }] } });
    assert.equal(stopped.result.isError, true);
    assert.match(stopped.info.error, /^pixel_validate ran out of memory \(24 MB\) and was stopped/);
    assert.equal((await small.call('pixel_validate', { project: strip })).info.ok, true);
  } finally { small.input.end(); await small.running; }
});

test('MCP refuses a video sequence over 512 MB before writing anything', async t => {
  const dir = await temp(t, 'sequence-cap'), mcp = session({ directory: dir }); await mcp.init();
  try {
    // Five minutes of 4K at 60 fps: 18,000 PNGs, about 660 MB, which one call used to write without a question.
    const refused = await mcp.call('pixel_render', { project: strip, sequence: { fps: 60, seconds: 300, size: '4k' } });
    assert.equal(refused.result.isError, true);
    assert.equal(refused.info.path, 'sequence');
    assert.match(refused.info.error, /these 18000 frames come to \d+ MB, more than one call writes \(512 MB\).*pixelbolt sequence/);
    assert.deepEqual(await readdir(dir), []);
  } finally { mcp.input.end(); await mcp.running; }
});

test('MCP compiles pose sources and autotile templates into revisions it can render and review in scenes', async t => {
  const dir = await temp(t, 'compile'), mcp = session({ directory: dir, root: dir });
  await mcp.init();
  const poses = { format: 'pixelforge-poses', version: 1, name: 'actor', width: 6, height: 4, palette: { a: '#f00' }, parts: { body: { rows: ['aa', 'a.'], points: { hand: [1, 0] } } },
    poses: [{ name: 'right', origin: [2, 3], parts: [{ name: 'body', part: 'body' }], markers: [{ name: 'hand', part: 'body', point: 'hand' }] }, { name: 'left', mirror: 'right' }] };
  const compiled = await mcp.call('pixel_compile', { source: poses, metadata: true });
  assert.ok(!compiled.result.isError, JSON.stringify(compiled.info)); assert.equal(compiled.result.content[1].mimeType, 'image/png');
  assert.equal(compiled.info.frames, 2); assert.deepEqual(compiled.info.metadata.poses.left.markers[0].at, [0, 3]); // hand (3, 3) reflected around the origin corner x = 2
  const template = Array.from({ length: 6 }, () => 'gggg');
  const tiles = await mcp.call('pixel_compile', { source: { format: 'pixelforge-autotile', version: 1, name: 'turf', tile: 2, palette: { g: '#0a0' }, template, frame: 'turf-{mask}' } });
  assert.equal(tiles.info.frames, 47);
  const scene = { format: 'pixelforge-scene', version: 1, name: 'field', width: 8, height: 6, assets: { turf: { revision: tiles.info.revision }, actor: { revision: compiled.info.revision } },
    instances: [{ name: 'ground', asset: 'turf', at: [0, 0], tilemap: { rows: ['tttt', 'tttt'], legend: { t: { frame: 'turf-{mask}', autotile: 'blob' } } } }, { name: 'hero', asset: 'actor', at: [4, 5], anchor: [2, 3], frame: 'left' }] };
  const view = await mcp.call('pixel_scene', { scene, scale: 2, export: true });
  assert.ok(!view.result.isError, JSON.stringify(view.info));
  assert.deepEqual(view.info.tilemaps, [{ name: 'ground', tiles: 8 }]);
  assert.ok(view.info.directory.startsWith(dir + path.sep)); assert.ok(view.info.files.includes('scene.png'));
  assert.equal(Buffer.from(view.result.content[1].data, 'base64').readUInt32BE(16), 16);
  const bad = await mcp.call('pixel_compile', { source: { format: 'other' } });
  assert.equal(bad.result.isError, true); assert.equal(bad.info.path, 'source.format');
  mcp.input.end(); await mcp.running;
});

test('MCP imports PNGs, applies overlays, explains topics and resolves palettes only inside its root', async t => {
  const dir = await temp(t, 'imports'), mcp = session({ directory: path.join(dir, 'out'), root: dir });
  await mcp.init();
  const png = encodePNG(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]), 2, 1);
  const imported = await mcp.call('pixel_import', { data: png.toString('base64'), name: 'pair' });
  assert.equal(imported.info.provenance.lossless, true); assert.match(imported.info.revision, /^[a-f0-9]{12}$/);
  await writeFile(path.join(dir, 'pair.png'), png);
  assert.equal((await mcp.call('pixel_import', { path: 'pair.png' })).info.revision.length, 12);
  assert.equal((await mcp.call('pixel_import', { path: '../outside.png' })).info.path, 'path');
  const overlay = createOverlay(strip, [{ paint: 'frames[a]', value: [{ x: 0, y: 0, color: 'k' }] }]);
  const edited = structuredClone(strip); edited.frames[1].duration = 120;
  const patched = await mcp.call('pixel_patch', { project: edited, overlay });
  assert.equal(patched.info.rebased, true); assert.deepEqual(patched.info.frames.changed.map(f => f.frame), ['a']);
  assert.equal((await mcp.call('pixel_patch', { project: strip })).info.path, 'arguments');
  const topic = (await mcp.request('tools/call', { name: 'pixel_help', arguments: { topic: 'autotile' } })).result;
  assert.equal(JSON.parse(topic.content[0].text).title, 'Pixelbolt autotile template');
  await writeFile(path.join(dir, 'shared.json'), JSON.stringify({ palette: { k: '#123456', w: '#fff' } }));
  const linked = await mcp.call('pixel_validate', { project: { ...strip, palette: { $ref: 'shared.json', x: '#f0f' } } });
  assert.deepEqual(linked.info.resolved, ['shared.json']);
  const escaped = await mcp.call('pixel_validate', { project: { ...strip, palette: { $ref: '../elsewhere.json' } } });
  assert.equal(escaped.result.isError, true); assert.match(escaped.info.error, /must stay inside/);
  const tile = await mcp.call('pixel_inspect', { revision: linked.info.revision, view: 'tile', frames: ['a'] });
  assert.equal(tile.info.mode, 'tile'); assert.equal(tile.info.tiles[0].frame, 'a');
  mcp.input.end(); await mcp.running;
});

test('CLI resolves shared palettes, keeps the link when writing edits, builds autotiles and reports clipping', async t => {
  const dir = await temp(t, 'cli');
  const run = (...args) => spawnSync(process.execPath, ['bin/pixelbolt.js', ...args], { cwd: root, encoding: 'utf8' });
  await mkdir(path.join(dir, 'art'), { recursive: true });
  await writeFile(path.join(dir, 'palette.json'), JSON.stringify({ k: '#000000', r: '#ff0000' }));
  const recipe = { version: 1, name: 'linked', width: 3, height: 1, palette: { $ref: '../palette.json', g: '#00ff00' }, frames: [{ name: 'a', ops: [{ op: 'grid', rows: ['krg'] }, { op: 'pixel', x: 5, color: 'k' }] }] };
  await writeFile(path.join(dir, 'art', 'linked.json'), JSON.stringify(recipe));
  const validated = JSON.parse(run('validate', path.join(dir, 'art', 'linked.json')).stdout);
  assert.deepEqual(validated.clipping, [{ path: 'project.frames[0].ops[1]', pixels: 1 }]);
  assert.deepEqual(validated.resolved, [path.join(dir, 'palette.json')]);
  await writeFile(path.join(dir, 'fix.json'), JSON.stringify([{ set: 'palette.b', value: '#0000ff' }, { remove: 'frames[a].ops[1]' }]));
  const patched = run('patch', path.join(dir, 'art', 'linked.json'), '--changes', path.join(dir, 'fix.json'), '--out', path.join(dir, 'art', 'fixed.json'));
  assert.equal(patched.status, 0, patched.stderr);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'art', 'fixed.json'), 'utf8')).palette, { $ref: '../palette.json', g: '#00ff00', b: '#0000ff' });
  const template = { format: 'pixelforge-autotile', version: 1, name: 'rock', tile: 2, mode: 'cardinal', palette: { $ref: 'palette.json' }, template: Array.from({ length: 6 }, () => 'kkrr'), frame: 'rock-{mask}' };
  await writeFile(path.join(dir, 'rock.autotile.json'), JSON.stringify(template));
  const built = run('autotile', path.join(dir, 'rock.autotile.json'), '--out', path.join(dir, 'art', 'rock.json'));
  assert.equal(built.status, 0, built.stderr);
  const rock = JSON.parse(await readFile(path.join(dir, 'art', 'rock.json'), 'utf8'));
  assert.equal(rock.frames.length, 16); assert.deepEqual(rock.palette, { $ref: '../palette.json' });
  const tiled = JSON.parse(run('inspect', path.join(dir, 'art', 'rock.json'), '--view', 'tile', '--frames', 'rock-15', '--out', path.join(dir, 'tile.png')).stdout);
  assert.equal(tiled.tiles[0].frame, 'rock-15'); assert.deepEqual(await readdir(dir).then(files => files.includes('tile.png')), true);
});

test('MCP compiles particle effects, explains the fx topic and previews cleanup patches', async t => {
  const dir = await temp(t, 'fx'), mcp = session({ directory: dir, root: dir });
  await mcp.init();
  const source = { format: 'pixelforge-fx', version: 1, name: 'sparks', width: 16, height: 16, palette: { w: '#fff', o: '#e83' }, symbols: { hot: ['w'], cool: ['o'] },
    effects: { pop: { frames: 4, seed: 5, emitters: [{ at: [8, 8], burst: 5, speed: [1, 2], life: 4, shapes: ['hot', 'cool'], trail: { color: 'o', length: 1 } }] } } };
  const compiled = await mcp.call('pixel_compile', { source, metadata: true });
  assert.ok(!compiled.result.isError, JSON.stringify(compiled.info));
  assert.deepEqual([compiled.info.frames, compiled.info.animations, compiled.info.metadata.effects.pop.emitters[0].spawned], [4, ['pop'], 5]);
  assert.equal(compiled.result.content[1].mimeType, 'image/png');
  const topic = (await mcp.request('tools/call', { name: 'pixel_help', arguments: { topic: 'fx' } })).result;
  assert.equal(JSON.parse(topic.content[0].text).title, 'Pixelbolt particle effects');
  const stair = { version: 1, name: 'stair', width: 5, height: 4, palette: { k: '#000' }, frames: [{ name: 'a', ops: [{ op: 'grid', rows: ['k....', 'kk...', '.kk..', '..k..'] }] }] };
  const inspected = await mcp.call('pixel_inspect', { project: stair, diagnostics: true });
  assert.deepEqual(inspected.info.diagnostics.frames[0], { frame: 'a', visible: 6, colors: 1, corners: 2, strays: 0 });
  const fixed = await mcp.call('pixel_patch', { revision: inspected.info.revision, changes: [{ cleanup: 'frames[a]', value: { corners: true } }] });
  assert.deepEqual(fixed.info.edits, [{ cleanup: 'frames[a]', at: 'frames[0]', pixels: 2, corners: 2, strays: 0 }]);
  assert.equal(fixed.info.frames.changed[0].pixels, 2);
  mcp.input.end(); await mcp.running;
});
