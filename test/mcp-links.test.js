import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { startMCP } from '../src/mcp.js';
import { resolveReferences } from '../src/resolve.js';
import { encodePNG } from '../src/png.js';

const strip = { version: 1, name: 'strip', width: 4, height: 2, palette: { k: '#000' }, frames: [{ name: 'a', ops: [{ op: 'pixel', x: 3, y: 1, color: 'k' }] }] };
// A folder link: a junction on Windows, which needs no special rights, and a symbolic link elsewhere.
const linkFolder = (target, link) => symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');

// root/escape leads to a folder beside the root; root/alias leads to root/real; rootlink leads to root itself.
async function layout(t) {
  const base = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(base, 'pixelbolt-links-'));
  t.after(async () => { assert.ok(dir.startsWith(base + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const root = path.join(dir, 'root'), outside = path.join(dir, 'outside');
  await mkdir(path.join(root, 'real'), { recursive: true }); await mkdir(outside);
  const palette = JSON.stringify({ palette: { k: '#123456' } });
  await writeFile(path.join(outside, 'secret.json'), palette); await writeFile(path.join(outside, 'hero.json'), JSON.stringify(strip));
  await writeFile(path.join(outside, 'pic.png'), encodePNG(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1));
  await writeFile(path.join(root, 'real', 'shared.json'), palette); await writeFile(path.join(root, '..notes.json'), palette);
  await linkFolder(outside, path.join(root, 'escape')); await linkFolder(path.join(root, 'real'), path.join(root, 'alias'));
  await linkFolder(root, path.join(dir, 'rootlink'));
  return { root, rootLink: path.join(dir, 'rootlink') };
}
const linked = reference => ({ ...strip, palette: { $ref: reference } });

test('references under the server root may not follow a link out of it', async t => {
  const { root, rootLink } = await layout(t);
  const refused = async (document, where) => {
    await assert.rejects(resolveReferences(document, { baseDir: root, root }), error => {
      assert.equal(error.path, where); assert.match(error.message, /must stay inside .*is a link that leads out of it/); return true;
    });
  };
  // Inside by name, outside once the junction or link is followed: a palette, a scene asset and a normals recipe.
  await refused(linked('escape/secret.json'), 'project.palette.$ref');
  await refused({ format: 'pixelforge-scene', version: 1, name: 's', width: 4, height: 2, assets: { hero: 'escape/hero.json' }, instances: [] }, 'scene.assets.hero');
  await refused({ format: 'pixelforge-normals', version: 1, recipe: 'escape/hero.json' }, 'normals.recipe');
  // Links that stay inside, a root reached through a link, and names that only start with two dots still resolve.
  assert.deepEqual((await resolveReferences(linked('alias/shared.json'), { baseDir: root, root })).document.palette, { k: '#123456' });
  assert.deepEqual((await resolveReferences(linked('real/shared.json'), { baseDir: rootLink, root: rootLink })).document.palette, { k: '#123456' });
  assert.deepEqual((await resolveReferences(linked('..notes.json'), { baseDir: root, root })).document.palette, { k: '#123456' });
  // Outside by name is refused as before, and a missing file is reported by its read.
  await assert.rejects(resolveReferences(linked('../outside/secret.json'), { baseDir: root, root }), /must stay inside [^;]*$/);
  await assert.rejects(resolveReferences(linked('real/missing.json'), { baseDir: root, root }), /could not read/);
});

test('MCP pixel_import refuses a PNG reached through a link out of its root', async t => {
  const { root } = await layout(t), input = new PassThrough(), output = new PassThrough(), waiting = new Map(); let buffer = '';
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)?.(message); } });
  const running = startMCP({ input, output, directory: path.join(root, 'out'), root });
  const request = (id, method, params) => new Promise(resolve => { waiting.set(id, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  try {
    await request(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    const reply = JSON.parse((await request(2, 'tools/call', { name: 'pixel_import', arguments: { path: 'escape/pic.png' } })).result.content[0].text);
    assert.equal(reply.path, 'path'); assert.match(reply.error, /must stay inside .*is a link that leads out of it/);
  } finally { input.end(); await running; }
});
