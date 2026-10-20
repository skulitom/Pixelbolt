import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile, readdir, mkdir } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMCP } from '../src/mcp.js';
import { MAX_REQUEST_BYTES } from '../src/core.js';
import { encodePNG } from '../src/png.js';
import { createOverlay } from '../src/overlays.js';
import { skinkRig } from '../scripts/figure-rigs.mjs';

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
