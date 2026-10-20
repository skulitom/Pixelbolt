import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { readFile, writeFile, readdir, mkdtemp, rm, access, realpath } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMCP } from '../src/mcp.js';
import { startStudio, STUDIO_PATHS } from '../src/server.js';
import { renderProject, inspectProject } from '../src/core.js';
import { encodePNG } from '../src/png.js';
import { createSequence } from '../src/sequence.js';
import { readZip } from '../scripts/build-studio.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const tiny = { version: 1, name: 'dot', width: 1, height: 1, frames: [{ name: 'idle', ops: [{ op: 'pixel', color: '#fff' }] }] };
const strip = { version: 1, name: 'strip', width: 12, height: 2, palette: { k: '#000' }, frames: [{ name: 'a', ops: [{ op: 'pixel', x: 11, y: 1, color: 'k' }] }, { name: 'b' }] };
function exchangeMCP(directory, messages, bin = 'pixelbolt') {
  const result = spawnSync(process.execPath, [`bin/${bin}.js`, 'mcp', '--out', directory], { cwd: root, input: messages.map(m => JSON.stringify(m)).join('\n') + '\n', encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return result.stdout.trim().split('\n').map(line => JSON.parse(line));
}
function runMCP(directory, calls) {
  const messages = [{ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25' } }, ...calls.map(([name, args], i) => ({ jsonrpc: '2.0', id: i + 1, method: 'tools/call', params: { name, arguments: args } }))];
  return exchangeMCP(directory, messages).slice(1).map(message => message.result);
}

test('the legacy CLI agrees on help, stdin validation, errors and every rendered byte', async t => {
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelbolt-alias-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const run = (bin, args, input) => {
    const result = spawnSync(process.execPath, [path.join(root, 'bin', `${bin}.js`), ...args], { cwd: dir, input, encoding: 'utf8' });
    assert.equal(result.error, undefined); return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  for (const [args, input, status] of [[[], undefined, 0], [['help'], undefined, 0], [['--help'], undefined, 0], [['validate', '-'], JSON.stringify(tiny), 0], [['validate', '-'], '{', 1], [['unknown'], undefined, 1]]) {
    const current = run('pixelbolt', args, input);
    assert.equal(current.status, status, current.stderr);
    assert.deepEqual(run('pixelforge', args, input), current);
  }
  const args = ['render', '-', '--out', 'rendered'], input = JSON.stringify(tiny);
  const first = run('pixelbolt', args, input); assert.equal(first.status, 0, first.stderr);
  const files = (await readdir(path.join(dir, 'rendered'), { recursive: true, withFileTypes: true })).filter(entry => entry.isFile());
  const bytes = new Map();
  for (const entry of files) { const file = path.join(entry.parentPath ?? entry.path, entry.name); bytes.set(file, await readFile(file)); }
  assert.ok(bytes.size > 5);
  assert.deepEqual(run('pixelforge', [...args, '--force'], input), first);
  for (const [file, expected] of bytes) assert.deepEqual(await readFile(file), expected, file);
});

test('both CLI names initialize Pixelbolt and expose the same eight MCP tools and schemas', async t => {
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelbolt-alias-mcp-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const messages = [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }];
  const current = exchangeMCP(dir, messages);
  assert.deepEqual(exchangeMCP(dir, messages, 'pixelforge'), current);
  assert.deepEqual(current[0].result.serverInfo, { name: 'pixelbolt', version: JSON.parse(await readFile(path.join(root, 'package.json'))).version });
  assert.deepEqual(current[1].result.tools.map(tool => tool.name), ['pixel_help', 'pixel_validate', 'pixel_inspect', 'pixel_patch', 'pixel_render', 'pixel_compile', 'pixel_scene', 'pixel_import']);
});
test('CLI motion inspection reads sources and explicit metadata without overwriting output files', async t => {
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelbolt-motion-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const run = args => spawnSync(process.execPath, [path.join(root, 'bin/pixelbolt.js'), 'inspect', ...args], { cwd: root, encoding: 'utf8' });
  const out = path.join(dir, 'motion.png'), args = ['examples/quality/skink-bones.poses.json', '--motion', 'run', '--speed', '48', '--scale', '1'];
  const direct = run([...args, '--out', out]); assert.equal(direct.status, 0, direct.stderr);
  const view = JSON.parse(direct.stdout);
  assert.deepEqual(view.motion.checks, { slide: true, ground: true, poseSpread: true, loopSeam: true });
  assert.ok((await readFile(out)).length > 100); assert.ok((await readFile(out.replace('.png', '.native.png'))).length > 100);
  const saved = run(['examples/quality/skink-bones.json', '--metadata', 'examples/quality/skink-bones.meta.json', '--motion', 'run', '--speed', '48', '--scale', '1']);
  assert.equal(saved.status, 0, saved.stderr); assert.deepEqual(JSON.parse(saved.stdout).motion, view.motion);
  const refused = run([...args, '--out', out]); assert.equal(refused.status, 1); assert.match(refused.stderr, /already exists/);
  const bad = run([...args, '--frames', 'idle']); assert.equal(bad.status, 1); assert.match(bad.stderr, /cannot be combined/);
});

test('CLI help describes its text output and commands for checkout and portable builds', () => {
  const result = spawnSync(process.execPath, ['bin/pixelbolt.js', 'help'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.ok(result.stdout.includes('Command results except help and the preview server are JSON. Errors exit with code 1.\n'));
  assert.ok(result.stdout.includes('Checkout: node bin/pixelbolt.js <command>. Portable build folder: .\\pixelbolt (Windows) or ./pixelbolt (macOS/Linux).\n'));
  assert.doesNotMatch(result.stdout, /All command results except the preview server are JSON|No installation needed:/);
});

test('CLI consumes stdin, emits machine-readable diagnostics and handles unknown flags', () => {
  const result = spawnSync(process.execPath, ['bin/pixelbolt.js','validate','-'], { cwd: root, input: JSON.stringify(tiny), encoding: 'utf8' });
  assert.equal(result.status, 0); assert.equal(JSON.parse(result.stdout).frames, 1);
  const bad = spawnSync(process.execPath, ['bin/pixelbolt.js','validate','-'], { cwd: root, input: '{', encoding: 'utf8' });
  assert.equal(bad.status, 1); assert.equal(JSON.parse(bad.stderr).ok, false);
  const flags = spawnSync(process.execPath, ['bin/pixelbolt.js','validate','-','--typo'], { cwd: root, encoding: 'utf8' });
  assert.equal(flags.status, 1); assert.match(JSON.parse(flags.stderr).error, /Unknown option/);
});

test('CLI init protects an existing recipe with an actionable JSON error and honours --force', async t => {
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelbolt-init-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const file = path.join(dir, 'hero.json');
  const run = (...args) => spawnSync(process.execPath, [path.join(root, 'bin', 'pixelbolt.js'), 'init', 'hero.json', ...args], { cwd: dir, encoding: 'utf8' });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const original = await readFile(file), edited = Buffer.from(JSON.stringify({ ...JSON.parse(original), name: 'my-hero' }) + '\n');
  await writeFile(file, edited);
  const again = run();
  assert.equal(again.status, 1);
  const refused = JSON.parse(again.stderr), shown = /^Output already exists: (.+)\. Choose a new file or pass --force\.$/.exec(refused.error);
  // The CLI names the file from its working folder, which macOS reports through /private/var, not /var.
  assert.equal(refused.ok, false); assert.ok(shown, refused.error); assert.equal(await realpath(shown[1]), await realpath(file));
  assert.deepEqual(await readFile(file), edited);
  const forced = run('--force');
  assert.equal(forced.status, 0, forced.stderr);
  assert.deepEqual(JSON.parse(forced.stdout), { ok: true, file: 'hero.json' });
  assert.deepEqual(await readFile(file), original);
});

test('MCP handshake, discovery, help, errors and render work over stdio', async t => {
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelbolt-mcp-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const input = new PassThrough(), output = new PassThrough(); let text = '';
  output.on('data', chunk => { text += chunk; });
  const running = startMCP({ input, output, directory: dir });
  const messages = [
    { id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
    { method: 'notifications/initialized' },
    { id: 2, method: 'tools/list' },
    { id: 3, method: 'tools/call', params: { name: 'pixel_validate', arguments: { project: tiny } } },
    { id: 4, method: 'tools/call', params: { name: 'pixel_render', arguments: { project: tiny } } },
    { id: 5, method: 'tools/call', params: { name: 'pixel_validate', arguments: { project: {} } } },
    { id: 6, method: 'tools/call', params: { name: 'pixel_help' } },
    { id: 7, method: 'bogus' }
  ];
  for (const message of messages) input.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  input.end('not json\n'); await running;
  const results = text.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(results.length, 8); assert.equal(results[0].result.protocolVersion, '2025-11-25');
  assert.equal(results[0].result.serverInfo.version, JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version);
  assert.equal(results[1].result.tools.length, 8); assert.equal(JSON.parse(results[2].result.content[0].text).ok, true);
  const render = results[3].result;
  assert.equal(render.content[1].mimeType, 'image/png');
  const written = JSON.parse(render.content[0].text); assert.ok(written.directory.startsWith(dir + path.sep));
  assert.ok((await readFile(path.join(written.directory, written.files[0]))).length > 0);
  assert.equal(written.frames.count, 1); assert.ok(!written.files.some(file => file.startsWith('frames/')));
  assert.equal(results[4].result.isError, true); assert.match(results[5].result.content[0].text, /Pixelbolt/);
  assert.equal(results[6].error.code, -32601); assert.equal(results[7].error.code, -32700);
});
test('MCP pixel_inspect returns a contact sheet and ruled grids, saving only its revision', async t => {
  const tempRoot = path.resolve(os.tmpdir()), parent = await mkdtemp(path.join(tempRoot, 'pixelbolt-inspect-')), dir = path.join(parent, 'renders');
  t.after(async () => { assert.ok(parent.startsWith(tempRoot + path.sep)); await rm(parent, { recursive: true, force: true }); });
  const input = new PassThrough(), output = new PassThrough(); let text = '';
  output.on('data', chunk => { text += chunk; });
  const running = startMCP({ input, output, directory: dir });
  const call = (id, args) => ({ id, method: 'tools/call', params: { name: 'pixel_inspect', arguments: args } });
  for (const message of [
    { id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
    call(2, { project: strip, grid: true }), call(3, { project: strip, zoom: 2 }), call(4, { project: strip, frames: ['missing'] })
  ]) input.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  input.end(); await running;
  const [, inspect, extra, missing] = text.trim().split('\n').map(line => JSON.parse(line));
  const [summary, image, grids] = inspect.result.content, info = JSON.parse(summary.text);
  assert.deepEqual(info.cells, [{ frame: 'a', duration: 100 }, { frame: 'b', duration: 100 }]);
  assert.equal(image.mimeType, 'image/png');
  assert.equal(Buffer.from(image.data, 'base64').readUInt32BE(16), info.sheet.width);
  assert.match(grids.text, /^ {13}11$/m); assert.match(grids.text, /^ {3}012345678901$/m); assert.match(grids.text, /^1 {2}\.{11}k$/m);
  assert.equal(extra.error.code, -32602);
  assert.equal(missing.result.isError, true); assert.equal(JSON.parse(missing.result.content[0].text).path, 'inspect.frames[0]');
  assert.deepEqual(await readdir(dir), ['.revisions']);
  assert.deepEqual(await readdir(path.join(dir, '.revisions')), [`${info.revision}.json`]);
});
test('MCP revisions let pixel_patch edit, compare and export without resending the recipe', async t => {
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelbolt-patch-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const input = new PassThrough(), output = new PassThrough(), waiting = new Map();
  let buffer = '', next = 0;
  output.on('data', chunk => {
    buffer += chunk;
    for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)(message); }
  });
  const running = startMCP({ input, output, directory: dir });
  const request = (method, params) => new Promise(resolve => { waiting.set(++next, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n'); });
  const call = async (name, args) => (await request('tools/call', { name, arguments: args })).result;
  const failure = async (name, args) => { const result = await call(name, args); assert.equal(result.isError, true); return JSON.parse(result.content[0].text); };
  await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  const { revision: base } = JSON.parse((await call('pixel_validate', { project: strip })).content[0].text);
  const patched = await call('pixel_patch', { revision: base, changes: [{ set: 'frames[a].ops[0].x', value: 10 }, { set: 'frames[b].duration', value: 150 }] });
  const report = JSON.parse(patched.content[0].text);
  assert.equal(report.base, base); assert.notEqual(report.revision, base);
  assert.deepEqual(report.edits, [{ set: 'frames[a].ops[0].x', at: 'frames[0].ops[0].x', before: 11 }, { set: 'frames[b].duration', at: 'frames[1].duration', created: true }]);
  assert.deepEqual(report.frames, { changed: [{ frame: 'a', pixels: 2, box: { x: 10, y: 1, w: 2, h: 1 }, changes: [{ x: 10, y: 1, from: '.', to: 'k' }, { x: 11, y: 1, from: 'k', to: '.' }] }], unchanged: ['b'], durations: [{ frame: 'b', from: 100, to: 150 }] });
  assert.equal(patched.content[1].mimeType, 'image/png');
  const rendered = JSON.parse((await call('pixel_render', { revision: report.revision })).content[0].text);
  const saved = JSON.parse(await readFile(path.join(rendered.directory, rendered.files.find(file => file.endsWith('.pixel.json'))), 'utf8'));
  assert.deepEqual([rendered.revision, saved.frames[0].ops[0].x], [report.revision, 10]);
  assert.equal(JSON.parse((await call('pixel_inspect', { revision: base })).content[0].text).revision, base);
  const review = await call('pixel_inspect', { revision: report.revision, reference: base, native: true, view: 'silhouette', diagnostics: true });
  assert.ok(!review.isError); assert.equal(review.content.filter(c => c.type === 'image').length, 3);
  assert.deepEqual(JSON.parse(review.content.find(c => c.type === 'text' && c.text.includes('comparison')).text).comparison.frames.changed.map(f => f.frame), ['a']);
  assert.equal((await failure('pixel_patch', { revision: 'missing', changes: [{ remove: 'frames[b]' }] })).path, 'revision');
  assert.equal((await failure('pixel_validate', { project: strip, revision: base })).path, 'arguments');
  assert.equal((await failure('pixel_patch', { revision: base, changes: [{ set: 'frames[a].duration', value: 0 }] })).path, 'project.frames[0].duration');
  assert.equal((await failure('pixel_patch', { revision: base, changes: [{ set: 'frames[zzz].duration', value: 1 }] })).path, 'changes[0].set');
  input.end(); await running;
});

test('MCP revisions from validate, inspect and paint survive process restarts before export', async t => {
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelbolt-restart-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const changes = [{ paint: 'frames[a]', value: [{ x: 11, y: 1, color: 'transparent' }, { x: 10, y: 1, color: 'k' }] }];
  const initial = runMCP(dir, [['pixel_validate', { project: tiny }], ['pixel_inspect', { project: strip }], ['pixel_patch', { project: strip, changes }]]);
  const summaries = initial.map(response => { assert.ok(!response.isError); return JSON.parse(response.content[0].text); });
  const ids = summaries.map(summary => summary.revision);
  assert.deepEqual(await readdir(dir), ['.revisions']);
  const restarted = runMCP(dir, [...ids.map(revision => ['pixel_inspect', { revision, grid: true }]), ['pixel_render', { revision: ids[2] }]]);
  restarted.forEach((result, i) => { assert.ok(!result.isError, JSON.stringify(result)); assert.equal(JSON.parse(result.content[0].text).revision, ids[Math.min(i, 2)]); });
  const rendered = JSON.parse(restarted[3].content[0].text), saved = JSON.parse(await readFile(path.join(rendered.directory, rendered.files.find(file => file.endsWith('.pixel.json'))), 'utf8'));
  assert.deepEqual(saved.frames[0].pixels, changes[0].value);
  assert.deepEqual(rendered.preview.cells, [{ frame: 'a', duration: 100 }, { frame: 'b', duration: 100 }]);
  assert.match(restarted[2].content[2].text, /k\.$/m);
  const third = runMCP(dir, [['pixel_validate', { revision: rendered.revision }], ['pixel_validate', { revision: ids[1] }]]);
  assert.ok(third.every(result => !result.isError));
});

test('MCP render previews every frame or an animation in playback order, with exact timing and cells', async t => {
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelbolt-preview-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const project = { ...tiny, name: 'sequence', frames: ['#f00', '#0f0', '#00f'].map((color, i) => ({ name: `pose${i}`, duration: 70 + i * 30, ops: [{ op: 'pixel', color }] })), animations: { idle: { frames: ['pose0', 'pose1', 'pose2'], direction: 'pingpong', loop: false } } };
  const results = runMCP(dir, [['pixel_render', { project }], ['pixel_render', { project, animation: 'idle' }]]);
  for (const [i, result] of results.entries()) {
    assert.ok(!result.isError, JSON.stringify(result));
    const info = JSON.parse(result.content[0].text), view = inspectProject(renderProject(project), i ? { animation: 'idle' } : {});
    assert.deepEqual(info.preview.cells.map(c => c.frame), i ? ['pose0', 'pose1', 'pose2', 'pose1'] : ['pose0', 'pose1', 'pose2']);
    assert.deepEqual(info.preview.cells.map(c => c.duration), i ? [70, 100, 130, 100] : [70, 100, 130]);
    assert.deepEqual(Buffer.from(result.content[1].data, 'base64'), encodePNG(view.sheet.data, view.sheet.width, view.sheet.height));
    assert.equal(info.preview.sheet.width, view.sheet.width);
    assert.ok(info.files.includes('animations/idle.png'));
  }
  assert.notEqual(JSON.parse(results[0].content[0].text).directory, JSON.parse(results[1].content[0].text).directory);
  const invalidDir = path.join(dir, 'invalid');
  assert.equal(runMCP(invalidDir, [['pixel_render', { project, animation: 'missing' }]])[0].isError, true);
  await assert.rejects(access(invalidDir), { code: 'ENOENT' });
});
test('CLI patch previews by default and writes only the requested recipe and image', async t => {
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelbolt-patch-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const source = path.join(dir, 'strip.json'), out = path.join(dir, 'strip-v2.json'), image = path.join(dir, 'diff.png');
  await writeFile(source, JSON.stringify(strip));
  const run = (...args) => spawnSync(process.execPath, ['bin/pixelbolt.js', 'patch', source, '--changes', '-', ...args], { cwd: root, input: JSON.stringify([{ set: 'frames[a].ops[0].x', value: 10 }]), encoding: 'utf8' });
  const preview = run();
  assert.equal(preview.status, 0); assert.equal(JSON.parse(preview.stdout).frames.changed[0].pixels, 2);
  assert.deepEqual(await readdir(dir), ['strip.json']);
  const written = JSON.parse(run('--out', out, '--image', image).stdout);
  assert.deepEqual([written.recipe, written.image.file], [out, image]);
  assert.equal(JSON.parse(await readFile(out, 'utf8')).frames[0].ops[0].x, 10);
  assert.equal((await readFile(image)).toString('latin1', 1, 4), 'PNG');
  assert.match(JSON.parse(run('--out', out).stderr).error, /already exists/);
  assert.match(JSON.parse(run('--out', path.join(dir, 'next.txt')).stderr).error, /\.json/);
  const both = spawnSync(process.execPath, ['bin/pixelbolt.js', 'patch', '-', '--changes', '-'], { cwd: root, input: '[]', encoding: 'utf8' });
  assert.match(JSON.parse(both.stderr).error, /stdin/);
});
test('MCP exports a maximum-length animation with a bounded, explicit sampled preview', async t => {
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelbolt-long-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const project = { ...tiny, width: 128, height: 128, animations: { hold: { frames: Array(1024).fill('idle') } } };
  const [result] = runMCP(dir, [['pixel_render', { project, animation: 'hold' }]]);
  assert.ok(!result.isError, JSON.stringify(result));
  const info = JSON.parse(result.content[0].text);
  assert.equal(info.preview.sampling.omitted, 768); assert.equal(info.preview.sampling.positions.at(-1), 1023);
  const atlas = JSON.parse(await readFile(path.join(info.directory, info.files.find(file => file.endsWith('.atlas.json'))), 'utf8'));
  assert.equal(atlas.animations.hold.frames.length, 1024); await access(info.playback);
});
test('CLI inspect prints cells and grids, and writes a PNG only when asked', async t => {
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelbolt-inspect-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const run = (...args) => spawnSync(process.execPath, ['bin/pixelbolt.js', 'inspect', '-', ...args], { cwd: root, input: JSON.stringify(strip), encoding: 'utf8' });
  const read = run('--grid', '--region', '10,0,2,2', '--frames', 'a');
  assert.equal(read.status, 0);
  const result = JSON.parse(read.stdout);
  assert.deepEqual(result.grids, [{ frame: 'a', rows: ['..', '.k'] }]); assert.equal(result.image, undefined);
  const file = path.join(dir, 'nested', 'sheet.png'), written = run('--out', file);
  assert.equal(written.status, 0); assert.equal(JSON.parse(written.stdout).image, file);
  assert.equal((await readFile(file)).readUInt32BE(16), JSON.parse(written.stdout).sheet.width);
  assert.match(JSON.parse(run('--out', file).stderr).error, /already exists/);
  assert.equal(run('--out', file, '--force').status, 0);
  assert.match(JSON.parse(run('--out', path.join(dir, 'sheet.txt')).stderr).error, /\.png/);
  assert.match(JSON.parse(run('--region', '1,2').stderr).error, /x,y,w,h/);
  assert.equal(JSON.parse(run('--frames', 'missing').stderr).path, 'inspect.frames[0]');
});
test('studio serves only its assets and exports ZIP over same-origin requests', async t => {
  const server = await startStudio({ port: 0, quiet: true });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base)).status, 200);
  for (const route of STUDIO_PATHS) assert.equal((await fetch(base + route)).status, 200, route);
  assert.equal((await fetch(base + '/package.json')).status, 404);
  const foreignHost = await new Promise((resolve, reject) => {
    const req = http.get(base, { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject);
  });
  assert.equal(foreignHost, 403);
  assert.equal((await fetch(base + '/api/export', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: JSON.stringify(tiny) })).status, 403);
  const res = await fetch(base + '/api/export', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(tiny) });
  assert.equal(res.status, 200); assert.equal(res.headers.get('content-type'), 'application/zip');
  assert.equal(Buffer.from(await res.arrayBuffer()).readUInt32LE(0), 0x04034b50);
  const bad = await fetch(base + '/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(bad.status, 400); assert.match((await bad.json()).error, /version/);
});
test('studio returns frames for a video editor as one ZIP, built as the sequence command builds them', async t => {
  const server = await startStudio({ port: 0, quiet: true });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = {}) => fetch(base + '/api/sequence', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const response = await post({ project: strip, sequence: { fps: 10, scale: 2 } });
  assert.deepEqual([response.status, response.headers.get('content-type'), response.headers.get('content-disposition')], [200, 'application/zip', 'attachment; filename="strip-default-frames.zip"']);
  assert.deepEqual(JSON.parse(response.headers.get('x-pixelforge-sequence')), { frames: 2, width: 24, height: 4, fps: '10', notes: 0 });
  // The ZIP holds one folder with exactly the files the command would write.
  const entries = readZip(Buffer.from(await response.arrayBuffer())), expected = createSequence(renderProject(strip), { fps: 10, scale: 2 });
  assert.deepEqual([...entries.keys()], [...expected.files.keys()].map(name => `strip-default/${name}`));
  for (const [name, bytes] of expected.files) assert.ok(entries.get(`strip-default/${name}`).read().equals(bytes), name);
  // Refusals are JSON with the path of what was wrong, and nothing is ever written by the server.
  for (const [body, message] of [[{ project: strip }, /sequence\.fps/], [{ project: strip, sequence: { fps: 30, size: '8k' } }, /sequence\.size/], [{ project: {}, sequence: { fps: 30 } }, /project/], [{ project: strip, sequence: { fps: 30 }, out: 'C:/x' }, /request/], [[strip], /request/]]) {
    const refused = await post(body); assert.equal(refused.status, 400); assert.match((await refused.json()).error, message);
  }
  assert.equal((await post({ project: strip, sequence: { fps: 10 } }, { Origin: 'https://evil.example' })).status, 403);
  // The address only answers a POST: reading it finds nothing, and other methods are refused.
  assert.deepEqual([(await fetch(base + '/api/sequence')).status, (await fetch(base + '/api/sequence', { method: 'PUT', headers: { Origin: base } })).status], [404, 405]);
});
test('every sample the studio lists is served, and the sidebar counts the list itself', async () => {
  const script = await readFile(path.join(root, 'studio', 'studio.js'), 'utf8'), page = await readFile(path.join(root, 'studio', 'index.html'), 'utf8');
  const samples = [...script.match(/const examples = \[.*\];/)[0].matchAll(/file: '([^']+)'/g)].map(match => match[1]);
  assert.ok(samples.length >= 7);
  for (const sample of samples) assert.ok(STUDIO_PATHS.includes(`/examples/${sample}.json`), sample);
  // A number typed into the page went stale when samples were added, so the heading is filled in from the list.
  assert.match(page, /<h2>Projects<\/h2><span id="example-count"><\/span>/); assert.match(script, /\$\('example-count'\)\.textContent = String\(\$\('examples'\)\.children\.length\)/);
});
