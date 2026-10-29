// Drives Pixelbolt's MCP server over stdio for the comparison page:
// tools/list, then validate -> inspect -> patch one pixel -> render the base and the patched revision, timing each
// call. It then decodes every frame PNG of both renders with its own small PNG reader (not Pixelbolt's) and counts the
// pixels that differ, so the patch's own report can be checked against the files.
// Usage: node pixelbolt-probe.mjs <pixelbolt-clone-or-unpacked-npm-package> <fresh-out-dir> <result.json>
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { cpus, release } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

const [clone, outDir, resultPath] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const child = spawn(process.execPath, [join(clone, 'bin', 'pixelbolt.js'), 'mcp', '--out', outDir, '--root', join(clone, 'examples')], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const waiting = new Map();
child.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.id != null && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  }
});
let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });
let nextId = 1;
function call(method, params) {
  const id = nextId++;
  const t0 = process.hrtime.bigint();
  return new Promise((resolve) => {
    waiting.set(id, (msg) => resolve({ msg, ms: Number(process.hrtime.bigint() - t0) / 1e6 }));
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
function textOf(msg) {
  const content = msg.result?.content ?? [];
  const texts = content.filter((c) => c.type === 'text').map((c) => c.text);
  const images = content.filter((c) => c.type === 'image').map((c) => ({ mimeType: c.mimeType, base64Length: c.data.length }));
  let json = null;
  try { json = JSON.parse(texts[0]); } catch { json = texts[0]; }
  return { json, images, isError: !!msg.result?.isError, error: msg.error ?? null };
}
function sourceId(dir) {
  // A git clone is named by its commit; an unpacked npm package (no .git) by its name and version.
  if (existsSync(join(dir, '.git'))) return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  return `npm ${pkg.name}@${pkg.version}`;
}
function countFiles(dir) { let n = 0; for (const f of readdirSync(dir)) { const p = join(dir, f); n += statSync(p).isDirectory() ? countFiles(p) : 1; } return n; }

// A small, independent PNG reader: 8-bit greyscale, RGB, RGBA, grey+alpha and palette (1-8 bit), non-interlaced.
function decodePNG(bytes) {
  let pos = 8, width, height, depth, type, palette = null, trns = null; const idat = [];
  while (pos < bytes.length) {
    const len = bytes.readUInt32BE(pos), kind = bytes.toString('latin1', pos + 4, pos + 8), data = bytes.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; type = data[9]; if (data[12]) throw new Error('interlaced PNG'); }
    else if (kind === 'PLTE') palette = data; else if (kind === 'tRNS') trns = data; else if (kind === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  const bitsPerPixel = channels * depth, stride = Math.ceil(width * bitsPerPixel / 8), bpp = Math.max(1, bitsPerPixel >> 3);
  const raw = inflateSync(Buffer.concat(idat)), rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? rows[y * stride + x - bpp] : 0, b = y ? rows[(y - 1) * stride + x] : 0, c = x >= bpp && y ? rows[(y - 1) * stride + x - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      rows[y * stride + x] = (line[x] + pred) & 255;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const o = (y * width + x) * 4;
    if (type === 3) {
      const bit = x * depth, idx = (rows[y * stride + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
      rgba[o] = palette[idx * 3]; rgba[o + 1] = palette[idx * 3 + 1]; rgba[o + 2] = palette[idx * 3 + 2]; rgba[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
    } else {
      if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);
      const s = y * stride + x * channels, v = rows.subarray(s, s + channels);
      if (type === 6) v.copy(rgba, o); else if (type === 2) { v.copy(rgba, o); rgba[o + 3] = 255; }
      else if (type === 0) { rgba[o] = rgba[o + 1] = rgba[o + 2] = v[0]; rgba[o + 3] = 255; } else { rgba[o] = rgba[o + 1] = rgba[o + 2] = v[0]; rgba[o + 3] = v[1]; }
    }
  }
  return { width, height, rgba };
}
function diffFrames(dirA, dirB) {
  const out = [];
  for (const f of readdirSync(join(dirA, 'frames')).sort()) {
    const a = decodePNG(readFileSync(join(dirA, 'frames', f))), b = decodePNG(readFileSync(join(dirB, 'frames', f)));
    const changed = [];
    for (let i = 0; i < a.width * a.height; i++) if (a.rgba.readUInt32BE(i * 4) !== b.rgba.readUInt32BE(i * 4)) changed.push({ x: i % a.width, y: Math.floor(i / a.width), from: a.rgba.subarray(i * 4, i * 4 + 4).toString('hex'), to: b.rgba.subarray(i * 4, i * 4 + 4).toString('hex') });
    out.push({ frame: f, size: `${a.width}x${a.height}`, changedPixels: changed.length, changes: changed.slice(0, 10) });
  }
  return out;
}

const result = { commit: sourceId(clone), node: process.version, platform: `${process.platform} ${process.arch} ${release()}`, cpu: cpus()[0]?.model?.trim(), startedAt: new Date().toISOString() };
const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'compare-probe', version: '1' } });
result.serverInfo = init.msg.result?.serverInfo; result.protocolVersion = init.msg.result?.protocolVersion;
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
const list = await call('tools/list', {});
const tools = list.msg.result.tools;
result.tools = tools.map((t) => ({ name: t.name, descriptionChars: t.description.length, inputSchemaUtf8Bytes: Buffer.byteLength(JSON.stringify(t.inputSchema)), annotations: t.annotations }));
result.toolsListMs = list.ms;
result.toolsListUtf8Bytes = Buffer.byteLength(JSON.stringify(list.msg.result));

const coin = JSON.parse(readFileSync(join(clone, 'examples', 'coin.json'), 'utf8'));
const v = await call('tools/call', { name: 'pixel_validate', arguments: { project: coin } });
const vj = textOf(v.msg);
result.validate = { ms: v.ms, isError: vj.isError, revision: vj.json?.revision, summary: vj.json && typeof vj.json === 'object' ? { width: vj.json.width, height: vj.json.height, frames: vj.json.frames?.length ?? vj.json.frameCount, animations: vj.json.animations } : vj.json };

const ins = await call('tools/call', { name: 'pixel_inspect', arguments: { revision: result.validate.revision, grid: true, frames: ['turn-0'] } });
const ij = textOf(ins.msg);
result.inspect = { ms: ins.ms, isError: ij.isError, images: ij.images, keys: ij.json && typeof ij.json === 'object' ? Object.keys(ij.json) : null };

const p = await call('tools/call', { name: 'pixel_patch', arguments: { revision: result.validate.revision, changes: [{ paint: 'frames[turn-0]', value: [{ x: 12, y: 12, color: 'light' }] }] } });
const pj = textOf(p.msg);
result.patch = { ms: p.ms, isError: pj.isError, images: pj.images, response: pj.json };

const r = await call('tools/call', { name: 'pixel_render', arguments: { revision: pj.json?.revision, listFiles: true } });
const rj = textOf(r.msg);
result.render = { ms: r.ms, isError: rj.isError, images: rj.images, response: rj.json };

const r0 = await call('tools/call', { name: 'pixel_render', arguments: { revision: result.validate.revision } });
const r0j = textOf(r0.msg);
result.renderBase = { ms: r0.ms, isError: r0j.isError, directory: r0j.json?.directory };
result.frameDiff = diffFrames(r0j.json.directory, rj.json.directory);
result.outFiles = countFiles(outDir);
result.stderr = stderr.slice(0, 2000);
child.stdin.end();
child.kill();
writeFileSync(resultPath, JSON.stringify(result, null, 1));
console.log(JSON.stringify({ commit: result.commit, tools: result.tools.map((t) => t.name), toolsListUtf8Bytes: result.toolsListUtf8Bytes, validate: result.validate.ms, inspect: result.inspect.ms, patch: result.patch.ms, render: result.render.ms, files: rj.json?.files?.length, frameDiff: result.frameDiff.map((f) => `${f.frame}:${f.changedPixels}`), changes: result.frameDiff.flatMap((f) => f.changes) }, null, 1));
