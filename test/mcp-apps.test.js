import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { inflateSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { startMCP } from '../src/mcp.js';
import { renderProject } from '../src/core.js';
import { encodePNG } from '../src/png.js';
import { findPreset, loadPreset, compilePreset } from '../src/presets.js';
import { previewMeta } from '../src/mcp-preview.js';
import { PREVIEW_KEY, MAX_PREVIEW_BYTES, MAX_PREVIEW_FRAMES, MAX_PREVIEW_FILES, MAX_PREVIEW_PATH_LENGTH, createViewModel } from '../src/mcp-app-model.js';

const UI_URI = 'ui://pixelbolt/viewer', UI_MIME = 'text/html;profile=mcp-app';
const capabilities = { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: [UI_MIME] } } };
const strip = { version: 1, name: 'strip', width: 4, height: 2, palette: { k: '#abcdef' }, frames: [
  { name: 'a', duration: 70, ops: [{ op: 'pixel', x: 1, y: 1, color: 'k' }] }, { name: 'b', duration: 130 }, { name: 'c', duration: 200 }
], animations: { bounce: { frames: ['a', 'b', 'c'], direction: 'pingpong' }, once: { frames: ['c', 'a'], loop: false } } };
const previewOf = reply => reply._meta[PREVIEW_KEY].preview;
const info = reply => JSON.parse(reply.content[0].text);
async function session(t, caps) {
  const base = path.resolve(os.tmpdir()), directory = await mkdtemp(path.join(base, 'pixelbolt-mcp-apps-'));
  const input = new PassThrough(), output = new PassThrough(), lines = [], waiting = new Map(); let buffer = '', next = 0;
  output.on('data', chunk => {
    buffer += chunk;
    for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) {
      const line = buffer.slice(0, end + 1), message = JSON.parse(line); lines.push(line); waiting.get(message.id)?.(message); waiting.delete(message.id);
    }
  });
  const running = startMCP({ input, output, directory, root: directory });
  const close = async () => { input.end(); await running; };
  t.after(async () => { await close(); assert.ok(directory.startsWith(base + path.sep)); await rm(directory, { recursive: true, force: true }); });
  const request = (method, params) => new Promise(resolve => { waiting.set(++next, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n'); });
  const call = async (name, args) => (await request('tools/call', { name, arguments: args })).result;
  const initialized = await request('initialize', { protocolVersion: '2025-11-25', ...(caps !== undefined && { capabilities: caps }) });
  return { initialized, request, call, lines, directory, close };
}
// An independent decoder for the encoder's RGBA8, unfiltered PNGs: no renderer/import/PNG module is used to read them.
function readPNG(base64) {
  const bytes = Buffer.from(base64, 'base64'), chunks = [];
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let width, height;
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at), type = bytes.toString('ascii', at + 4, at + 8), data = bytes.subarray(at + 8, at + 8 + length); at += length + 12;
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); assert.deepEqual([...data.subarray(8)], [8, 6, 0, 0, 0]); }
    if (type === 'IDAT') chunks.push(data);
  }
  const raw = inflateSync(Buffer.concat(chunks)), data = Buffer.alloc(width * height * 4), stride = width * 4;
  assert.equal(raw.length, (stride + 1) * height);
  for (let y = 0; y < height; y++) { assert.equal(raw[y * (stride + 1)], 0); data.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride); }
  return { width, height, data };
}

test('without MCP Apps every client gets the same plain bytes, with no UI resource, metadata or capability', async t => {
  // No frozen hashes: tool descriptions change often, so each run compares the clients that don't negotiate MCP Apps
  // with each other, and checks the plain reply carries nothing of the extension. (Review of C-126 compared these
  // bytes with main's once, outside the suite.)
  let reference;
  for (const caps of [undefined, {}, { extensions: {} }, { extensions: { 'io.modelcontextprotocol/ui': {} } },
    { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html'] } } }, { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: UI_MIME } } }]) {
    const mcp = await session(t, caps);
    await mcp.request('tools/list', {}); await mcp.call('pixel_compile', { preset: 'smoke-puff' });
    const lines = [...mcp.lines];
    reference ??= lines;
    assert.deepEqual(lines, reference, JSON.stringify(caps));
    for (const method of ['resources/list', 'resources/read', 'resources/templates/list']) assert.equal((await mcp.request(method, { uri: UI_URI })).error.code, -32601);
    await mcp.close();
  }
  const [init, list, call] = reference.map(line => JSON.parse(line));
  assert.deepEqual(init.result.capabilities, { tools: {} });
  assert.ok(list.result.tools.every(tool => !('_meta' in tool)));
  assert.equal(call.result._meta, undefined);
  assert.ok(reference.every(line => !line.includes('ui://pixelbolt') && !line.includes(PREVIEW_KEY)));
});

test('MCP Apps negotiates resource discovery and metadata on exactly six tools', async t => {
  const mcp = await session(t, capabilities);
  assert.deepEqual(mcp.initialized.result.capabilities, { tools: {}, resources: {} });
  const tools = (await mcp.request('tools/list')).result.tools;
  assert.deepEqual(tools.filter(t => t._meta).map(t => t.name).sort(), ['pixel_compile', 'pixel_import', 'pixel_inspect', 'pixel_patch', 'pixel_render', 'pixel_scene']);
  for (const tool of tools.filter(t => t._meta)) assert.deepEqual(tool._meta, { ui: { resourceUri: UI_URI }, 'ui/resourceUri': UI_URI });
  const resources = (await mcp.request('resources/list')).result.resources;
  assert.equal(resources.length, 1); assert.equal(resources[0].uri, UI_URI); assert.equal(resources[0].mimeType, UI_MIME);
  assert.ok(resources[0].name && resources[0].description);
  assert.deepEqual((await mcp.request('resources/templates/list')).result, { resourceTemplates: [] });
  const { contents } = (await mcp.request('resources/read', { uri: UI_URI })).result;
  assert.equal(contents.length, 1);
  const resource = contents[0]; assert.equal(resource.uri, UI_URI); assert.equal(resource.mimeType, UI_MIME);
  assert.deepEqual(resource._meta, { ui: { prefersBorder: true } });
  assert.match(resource.text, /^<!DOCTYPE html>/); assert.match(resource.text, /function createViewModel/); assert.match(resource.text, /function mountViewer/);
  assert.doesNotMatch(resource.text, /(?:\b(?:src|href)\s*=\s*["']?|\burl\(\s*["']?)(?:https?:|\/\/)/i);
  assert.doesNotMatch(resource.text, /<script[^>]+src=|<link|@import|\bimport\s|\bfetch\(/);
  assert.equal((await mcp.request('resources/read', { uri: 'ui://pixelbolt/missing' })).error.code, -32002);
});

test('a negotiated smoke-puff preview keeps content identical and decodes to the compiled native pixels and timing', async t => {
  const plain = await session(t, {}), app = await session(t, capabilities);
  const original = await plain.call('pixel_compile', { preset: 'smoke-puff' }), reply = await app.call('pixel_compile', { preset: 'smoke-puff' });
  assert.deepEqual(reply.content, original.content); assert.equal(reply.structuredContent, undefined);
  assert.deepEqual(Object.keys(reply._meta), [PREVIEW_KEY]);
  const p = previewOf(reply), { source } = await loadPreset(await findPreset('smoke-puff')), project = renderProject(compilePreset(source).recipe);
  assert.equal(p.frames.length, project.frames.length); assert.equal(p.truncated, 0); assert.equal(p.width, project.width); assert.equal(p.height, project.height);
  for (const [i, frame] of p.frames.entries()) {
    assert.equal(frame.name, project.frames[i].name); assert.equal(frame.duration, project.frames[i].duration);
    const decoded = readPNG(frame.png); assert.equal(decoded.width, p.width); assert.equal(decoded.height, p.height);
    assert.deepEqual(decoded.data, Buffer.from(project.frames[i].data));
  }
  assert.deepEqual(p.animations, Object.entries(project.animations).map(([name, a]) => ({ name, frames: a.frames, loop: a.loop })));
  assert.ok(createViewModel().decodeResult(reply).preview);
});

test('all picture tools return previews, render includes written paths/check/share, and other results keep their content', async t => {
  const app = await session(t, capabilities), plain = await session(t, {});
  const scene = { format: 'pixelforge-scene', version: 1, name: 'room', width: 8, height: 4, assets: { sprite: strip }, instances: [{ name: 'sprite', asset: 'sprite', at: [0, 0], frame: 'a' }] };
  const png = encodePNG(renderProject(strip).frames[0].data, 4, 2).toString('base64');
  for (const [name, args, count] of [
    ['pixel_inspect', { project: strip, animation: 'once' }, 3],
    ['pixel_patch', { project: strip, changes: [{ set: 'frames[a].duration', value: 80 }] }, 3],
    ['pixel_scene', { scene, scale: 2 }, 1], ['pixel_import', { data: png }, 1]
  ]) {
    const reply = await app.call(name, args), original = await plain.call(name, args);
    assert.equal(reply.isError, undefined, JSON.stringify(reply)); assert.deepEqual(reply.content, original.content, name);
    const p = previewOf(reply); assert.equal(p.frames.length, count, name);
    const image = readPNG(p.frames[0].png); assert.equal(image.width, p.width); assert.equal(image.height, p.height);
  }
  for (const [name, args] of [['pixel_help', {}], ['pixel_validate', { project: strip }], ['pixel_compile', {}]]) {
    const reply = await app.call(name, args); assert.equal(reply._meta, undefined); assert.deepEqual(reply, await plain.call(name, args));
  }
  const reply = await app.call('pixel_render', { project: strip, animation: 'once', gif: {}, sequence: { fps: 10, seconds: 0.2 }, share: true, expect: { width: 4 }, saveAs: { sheet: 'saved.png' } });
  assert.equal(reply.isError, undefined, JSON.stringify(reply));
  const p = previewOf(reply), summary = info(reply); assert.equal(p.verdict, 'passed'); assert.equal(p.animation, 'once'); assert.equal(p.shareLink, summary.share.link);
  assert.ok(createViewModel().decodeResult(reply).preview.shareLink);
  assert.ok(p.files.includes(path.join(app.directory, 'saved.png')));
  assert.ok(p.files.some(f => f.endsWith('once.gif'))); assert.ok(p.files.some(f => f.includes(`${path.sep}sequence${path.sep}`)));
  for (const file of p.files) { assert.ok(path.isAbsolute(file)); assert.ok((await stat(file)).isFile()); }
  const saved = renderProject(JSON.parse(await readFile(path.join(summary.directory, 'strip.pixel.json'), 'utf8')));
  assert.deepEqual(readPNG(p.frames[0].png).data, Buffer.from(saved.frames[0].data));
  const failed = await app.call('pixel_render', { project: strip, expect: { width: 5 } }); assert.equal(previewOf(failed).verdict, 'failed');
  const unchecked = await app.call('pixel_render', { project: strip }); assert.equal(previewOf(unchecked).verdict, 'not-checked');
});

test('preview caps keep a frame prefix, report omitted frames, and remove unavailable animation references', () => {
  const project = renderProject(strip), one = previewOf(previewMeta(project, {}, { maxFrames: 1 }));
  assert.equal(one.frames.length, 1); assert.equal(one.truncated, 2);
  assert.deepEqual(one.animations, [{ name: 'bounce', frames: [0], loop: true }, { name: 'once', frames: [0], loop: false }]);
  const bytes = one.frames[0].png.length, exact = previewOf(previewMeta(project, {}, { maxBytes: bytes }));
  assert.equal(exact.frames.length, 1); assert.equal(exact.truncated, 2);
  const empty = previewOf(previewMeta(project, {}, { maxBytes: bytes - 1 }));
  assert.deepEqual(empty.frames, []); assert.deepEqual(empty.animations, []); assert.equal(empty.truncated, 3);
  const many = { ...project, frames: Array.from({ length: 250 }, (_, i) => ({ ...project.frames[0], name: `frame-${i}` })), animations: { all: { frames: Array.from({ length: 250 }, (_, i) => i), loop: true } } };
  const capped = previewOf(previewMeta(many)); assert.equal(capped.frames.length, MAX_PREVIEW_FRAMES); assert.equal(capped.truncated, 10);
  // Incompressible seeded pixels hit the real byte cap, without enormous fixtures or timing assertions.
  let seed = 123;
  const data = Uint8Array.from({ length: 128 * 128 * 4 }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 24; });
  const large = { ...many, width: 128, height: 128, frames: many.frames.map(f => ({ ...f, data })) };
  const limited = previewOf(previewMeta(large)), total = limited.frames.reduce((sum, f) => sum + f.png.length, 0);
  assert.ok(total <= MAX_PREVIEW_BYTES); assert.ok(total + limited.frames[0].png.length > MAX_PREVIEW_BYTES);
  assert.equal(limited.truncated, 250 - limited.frames.length); assert.ok(limited.frames.length < MAX_PREVIEW_FRAMES);
});

test('full render content is identical across clients and preview files prioritize key exports within a fixed cap', async t => {
  const app = await session(t, capabilities), plain = await session(t, {});
  const project = { ...strip, frames: strip.frames.map((frame, i) => i ? frame : { ...frame, tile: { weight: 1 } }) };
  const args = { project, animation: 'once', gif: {}, sequence: { fps: 10, seconds: 8 }, share: true, expect: { width: 4 }, saveAs: { sheet: 'saved.png' } };
  const reply = await app.call('pixel_render', args), original = await plain.call('pixel_render', args);
  assert.equal(reply.isError, undefined, JSON.stringify(reply)); assert.equal(original.isError, undefined, JSON.stringify(original));
  assert.equal(Object.hasOwn(original, '_meta'), false); assert.equal(reply.structuredContent, undefined);
  assert.notEqual(info(reply).directory, info(original).directory, 'each render has its own directory');
  // Compare the exact content bytes, normalizing only each render directory and its session root (saveAs destination).
  const normalized = (value, session) => JSON.stringify(value.content.map(item => item.type === 'text' ? { ...item, text: item.text
    .split(JSON.stringify(info(value).directory).slice(1, -1)).join('<OUTPUT>')
    .split(JSON.stringify(session.directory).slice(1, -1)).join('<ROOT>') } : item));
  assert.equal(normalized(reply, app), normalized(original, plain));
  const p = previewOf(reply), out = info(reply).directory;
  assert.equal(p.files.length, MAX_PREVIEW_FILES); assert.ok(p.filesOmitted > 0); assert.ok(createViewModel().decodeResult(reply).preview);
  const firstFrame = p.files.findIndex(file => file.includes(`${path.sep}frames${path.sep}`)); assert.ok(firstFrame > 0);
  const priority = ['strip.png', 'strip.atlas.json', 'strip.pixel.json', 'strip.tres', 'strip.tileset.tres', 'strip.tsx', 'gifs/once.gif', 'gifs/bounce.gif'].map(file => path.join(out, file));
  priority.push(path.join(app.directory, 'saved.png'));
  for (const file of priority) assert.ok(p.files.indexOf(file) >= 0 && p.files.indexOf(file) < firstFrame, file);
  for (const file of p.files) { assert.ok(path.isAbsolute(file)); assert.ok(file.length <= MAX_PREVIEW_PATH_LENGTH); assert.ok((await stat(file)).isFile()); }
  async function countFiles(directory) {
    let count = 0;
    for (const entry of await readdir(directory, { withFileTypes: true })) count += entry.isDirectory() ? await countFiles(path.join(directory, entry.name)) : 1;
    return count;
  }
  assert.equal(p.files.length + p.filesOmitted, await countFiles(out) + 1, 'omissions count every written file, including saveAs');
});

test('preview paths have independent count and length bounds and omitted paths are counted exactly', () => {
  const project = renderProject(strip), long = 'a'.repeat(MAX_PREVIEW_PATH_LENGTH + 1), boundary = 'b'.repeat(MAX_PREVIEW_PATH_LENGTH);
  const short = previewOf(previewMeta(project, { files: [long, boundary, 'c.png'] }));
  assert.deepEqual(short.files, [boundary, 'c.png']); assert.equal(short.filesOmitted, 1);
  const many = previewOf(previewMeta(project, { files: [long, ...Array.from({ length: 18013 }, (_, i) => `${i}.png`)] }));
  assert.equal(many.files.length, MAX_PREVIEW_FILES); assert.equal(many.filesOmitted, 18014 - MAX_PREVIEW_FILES);
  const small = previewOf(previewMeta(project, { files: ['a.png'] })); assert.equal(Object.hasOwn(small, 'filesOmitted'), false);
  assert.ok(createViewModel().decodeResult(previewMeta(project, { files: [boundary] })).preview);
});

test('an inspection that selects frames, a region or a review mode previews the inspection image, not the whole project', async t => {
  const app = await session(t, capabilities);
  for (const args of [{ project: strip, frames: ['c'] }, { project: strip, view: 'silhouette' }, { project: strip, region: { x: 0, y: 0, w: 2, h: 2 } }, { project: strip, grid: true }]) {
    const reply = await app.call('pixel_inspect', args); assert.equal(reply.isError, undefined, JSON.stringify(reply));
    const p = previewOf(reply), sheet = reply.content.find(c => c.type === 'image');
    assert.equal(p.frames.length, 1, JSON.stringify(args)); assert.deepEqual(p.animations, []);
    // The player's one frame is exactly the contact sheet the model received.
    assert.deepEqual(readPNG(p.frames[0].png), readPNG(sheet.data), JSON.stringify(args));
  }
  // A plain look at one animation still plays it.
  const plain = previewOf(await app.call('pixel_inspect', { project: strip, animation: 'bounce', scale: 4 }));
  assert.equal(plain.animation, 'bounce'); assert.equal(plain.frames.length, 3);
});
