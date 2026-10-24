import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBundle, formatJSON } from '../src/export.js';
import { createSceneBundle } from '../src/scene-export.js';
import { decodePNG, importPNG } from '../src/import.js';
import { resolveReferences } from '../src/resolve.js';
import { startMCP } from '../src/mcp.js';
import { LINK_LIMIT, PLAYGROUND_URL, RECIPE_KEYWORD, embedRecipe, readEmbeddedRecipe, readShareLink, shareLink } from '../src/share.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const blink = { version: 1, name: 'blink', width: 3, height: 2, palette: { a: '#f008', b: '#00f' }, frames: [{ name: 'on', duration: 80, ops: [{ op: 'grid', rows: ['a.b', 'ba.'] }] }, { name: 'off', duration: 120, ops: [{ op: 'grid', rows: ['.b.', 'a.b'] }] }], animations: { blink: { frames: ['on', 'off'], direction: 'pingpong', loop: false } }, sheet: { scale: 2, padding: 1 } };
const hash = text => createHash('sha256').update(text).digest('hex');
// Unused, valid symbol data makes a long link without making rendering expensive.
const oversized = { ...blink, palette: { ...blink.palette, ...Object.fromEntries([...'0123456789abcdef'].map(key => [key, '#123'])) }, symbols: { noise: Array.from({ length: 192 }, (_, y) => [0, 1, 2].map(x => hash(`${x},${y}`)).join('')) } };
const temp = async t => {
  const base = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(base, 'pixelbolt-share-'));
  t.after(async () => { assert.ok(dir.startsWith(base + path.sep)); await rm(dir, { recursive: true, force: true }); });
  return dir;
};
function cli(args, { input, cwd = root, status = 0 } = {}) {
  const result = spawnSync(process.execPath, [path.join(root, 'bin/pixelbolt.js'), ...args], { cwd, input, encoding: 'utf8' });
  assert.equal(result.error, undefined);
  assert.equal(result.status, status, result.stderr);
  assert.equal(status ? result.stdout : result.stderr, '');
  return result;
}
const summary = project => ({ name: project.name, width: project.width, height: project.height, frames: project.frames.length, animations: Object.keys(project.animations), warnings: project.warnings, ...(project.clipping && { clipping: project.clipping }) });
function chunks(png) {
  const found = [];
  for (let at = 8; at < png.length;) {
    const end = at + 12 + png.readUInt32BE(at);
    found.push({ type: png.toString('ascii', at + 4, at + 8), bytes: png.subarray(at, end), data: png.subarray(at + 8, end - 4) });
    at = end;
  }
  return found;
}
const filterPNG = (png, keep) => Buffer.concat([png.subarray(0, 8), ...chunks(png).filter(keep).map(chunk => chunk.bytes)]);
async function checkEmbedded(png, original, recipe, kind = 'project') {
  const embedded = await readEmbeddedRecipe(png);
  assert.equal(embedded.version, version); assert.equal(embedded.kind, kind);
  assert.equal(JSON.stringify(embedded.recipe), JSON.stringify(recipe));
  const isRecipe = chunk => chunk.type === 'iTXt' && chunk.data.subarray(0, RECIPE_KEYWORD.length + 1).equals(Buffer.from(RECIPE_KEYWORD + '\0'));
  assert.equal(chunks(png).filter(isRecipe).length, 1);
  // All original bytes, including APNG frame controls and compressed animation data, must survive.
  assert.deepEqual(filterPNG(png, chunk => !isRecipe(chunk)), original);
  // decodePNG rejects APNG; removing its animation chunks exposes the unchanged default PNG image.
  const still = bytes => filterPNG(bytes, chunk => !['acTL', 'fcTL', 'fdAT'].includes(chunk.type));
  assert.deepEqual(decodePNG(still(png)), decodePNG(still(original)));
}
async function checkBundle(directory, bundle, recipe, selected = name => name.endsWith('.png')) {
  const files = (await readdir(directory, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile()).map(entry => path.relative(directory, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join('/'));
  assert.deepEqual(files.sort(), [...bundle.files.keys()].sort());
  for (const [name, original] of bundle.files) {
    const bytes = await readFile(path.join(directory, name));
    if (recipe && selected(name)) await checkEmbedded(bytes, original, recipe, recipe.format === 'pixelforge-scene' ? 'scene' : 'project');
    else {
      assert.deepEqual(bytes, original, name);
      if (name.endsWith('.png')) assert.equal(await readEmbeddedRecipe(bytes), null, name);
    }
  }
}
function session(t, directory, baseDir = directory) {
  const input = new PassThrough(), output = new PassThrough(), waiting = new Map(); let text = '', next = 0;
  output.on('data', chunk => {
    text += chunk;
    for (let end; (end = text.indexOf('\n')) !== -1; text = text.slice(end + 1)) {
      const message = JSON.parse(text.slice(0, end)); waiting.get(message.id)(message); waiting.delete(message.id);
    }
  });
  const running = startMCP({ input, output, directory, root: baseDir });
  t.after(async () => { input.end(); await running; });
  const request = (method, params) => new Promise(resolve => { waiting.set(++next, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n'); });
  const call = async args => {
    const response = await request('tools/call', { name: 'pixel_render', arguments: args });
    assert.equal(response.error, undefined);
    assert.ok(!response.result.isError, JSON.stringify(response.result));
    return { result: response.result, info: JSON.parse(response.result.content[0].text) };
  };
  return { request, call, init: () => request('initialize', { protocolVersion: '2025-11-25' }) };
}

test('CLI render embeds source in every PNG only on request, preserving every other byte and plain stdout', async t => {
  const dir = await temp(t), coinFile = path.join(root, 'examples/coin.json'), coin = JSON.parse(await readFile(coinFile, 'utf8'));
  for (const [recipe, source] of [[coin, coinFile], [blink, '-']]) {
    const bundle = await createBundle(recipe), plain = path.join(dir, recipe.name), embedded = path.join(dir, recipe.name + '-embedded');
    const input = source === '-' ? JSON.stringify(recipe) : undefined;
    const old = cli(['render', source, '--out', plain], { input });
    assert.equal(old.stdout, JSON.stringify({ ok: true, ...summary(bundle.project), files: [...bundle.files.keys()].map(name => path.join(plain, name)) }) + '\n');
    await checkBundle(plain, bundle);
    const carried = cli(['render', source, '--out', embedded, '--embed-recipe'], { input });
    assert.equal(carried.stdout.replaceAll(JSON.stringify(embedded).slice(1, -1), JSON.stringify(plain).slice(1, -1)), old.stdout);
    await checkBundle(embedded, bundle, recipe);
  }
});

test('CLI scene embeds its resolved source only in scene.png and unlit.png; default files and stdout are unchanged', async t => {
  const dir = await temp(t), source = path.join(root, 'examples/forest-spirit-lit.scene.json');
  const { document, files } = await resolveReferences(JSON.parse(await readFile(source, 'utf8')), { baseDir: path.dirname(source) });
  assert.equal(typeof document.assets.spirit.recipe, 'object');
  assert.deepEqual(document.assets.spirit.recipe, JSON.parse(await readFile(path.join(root, 'examples/forest-spirit.json'), 'utf8')));
  const bundle = await createSceneBundle(document), plain = path.join(dir, 'plain'), embedded = path.join(dir, 'embedded');
  const old = cli(['scene', source, '--out', plain]);
  assert.equal(old.stdout, JSON.stringify({ ok: true, files: [...bundle.files.keys()].map(name => path.join(plain, name)), warnings: bundle.warnings, resolved: files }) + '\n');
  await checkBundle(plain, bundle);
  const carried = cli(['scene', source, '--out', embedded, '--embed-recipe']);
  assert.equal(carried.stdout.replaceAll(JSON.stringify(embedded).slice(1, -1), JSON.stringify(plain).slice(1, -1)), old.stdout);
  await checkBundle(embedded, bundle, document, name => ['scene.png', 'unlit.png'].includes(name));
});

test('CLI share resolves file and stdin references, uses the playground URL and refuses long links and options', async t => {
  const dir = await temp(t), linked = { ...blink, palette: { $ref: 'palette.json' } }, source = path.join(dir, 'linked.json');
  await writeFile(path.join(dir, 'palette.json'), JSON.stringify(blink.palette));
  await writeFile(source, JSON.stringify(linked));
  const shared = cli(['share', source]), info = JSON.parse(shared.stdout);
  assert.equal(shared.stdout, JSON.stringify({ ok: true, link: info.link, characters: info.link.length, version, kind: 'project' }) + '\n');
  assert.ok(info.link.startsWith(PLAYGROUND_URL + '#'));
  assert.deepEqual(await readShareLink(info.link), { recipe: blink, version, kind: 'project' });
  assert.equal(cli(['share', '-'], { cwd: dir, input: JSON.stringify(linked) }).stdout, shared.stdout);
  let limitError;
  await assert.rejects(shareLink(oversized, version), error => { limitError = error.message; return error.message.includes(`${LINK_LIMIT.toLocaleString('en')}-character limit`); });
  const refused = cli(['share', '-'], { input: JSON.stringify(oversized), status: 1 });
  assert.equal(refused.stderr, JSON.stringify({ ok: false, error: limitError }) + '\n');
  assert.match(cli(['share', source, '--out', 'unused'], { status: 1 }).stderr, /--out is not supported by share/);
  const out = path.join(dir, 'resolved');
  cli(['render', source, '--embed-recipe', '--out', out]);
  await checkBundle(out, await createBundle(blink), blink);
});

test('CLI import --embedded recovers source, protects output and reports missing/damaged chunks; plain import is unchanged', async t => {
  const dir = await temp(t), bundle = await createBundle(blink), original = bundle.files.get('frames/on.png');
  const plain = path.join(dir, 'plain.png'), carried = path.join(dir, 'carried.png'), out = path.join(dir, 'recovered.json');
  await writeFile(plain, original); await writeFile(carried, await embedRecipe(original, blink, version));
  const result = cli(['import', carried, '--embedded', '--out', out]);
  assert.equal(result.stdout, JSON.stringify({ ok: true, recipe: out, embedded: { version, kind: 'project' } }) + '\n');
  assert.equal(await readFile(out, 'utf8'), formatJSON(blink));
  assert.match(cli(['import', carried, '--embedded', '--out', out], { status: 1 }).stderr, /already exists/);
  assert.equal(await readFile(out, 'utf8'), formatJSON(blink));
  const absent = path.join(dir, 'absent.json');
  assert.equal(cli(['import', plain, '--embedded', '--out', absent], { status: 1 }).stderr, JSON.stringify({ ok: false, error: 'This PNG carries no Pixelbolt recipe; drop --embedded to import its pixels.' }) + '\n');
  const damaged = await readFile(carried), chunk = chunks(damaged).find(chunk => chunk.type === 'iTXt');
  chunk.bytes[chunk.bytes.length - 1] ^= 1;
  await writeFile(carried, damaged);
  let damageError;
  await assert.rejects(readEmbeddedRecipe(damaged), error => { damageError = error.message; return /damaged/.test(error.message); });
  assert.equal(cli(['import', carried, '--embedded', '--out', absent], { status: 1 }).stderr, JSON.stringify({ ok: false, error: damageError }) + '\n');
  await assert.rejects(readFile(absent), { code: 'ENOENT' });
  const imported = importPNG(original), pixels = path.join(dir, 'pixels.json');
  const old = cli(['import', plain, '--out', pixels]);
  assert.equal(old.stdout, JSON.stringify({ ok: true, recipe: pixels, metadata: imported.provenance }, null, 2) + '\n');
  assert.equal(await readFile(pixels, 'utf8'), formatJSON(imported.recipe));
  // Even a recipe-carrying PNG still takes the pixel-import path unless --embedded is supplied.
  const embeddedBytes = Buffer.from(await embedRecipe(original, blink, version)); await writeFile(carried, embeddedBytes);
  const traced = importPNG(embeddedBytes), tracedOut = path.join(dir, 'traced.json');
  assert.equal(cli(['import', carried, '--out', tracedOut]).stdout, JSON.stringify({ ok: true, recipe: tracedOut, metadata: traced.provenance }, null, 2) + '\n');
  assert.equal(await readFile(tracedOut, 'utf8'), formatJSON(traced.recipe));
});

test('MCP render shares resolved recipes and revisions, embeds PNGs, survives long links and keeps default replies identical', async t => {
  const dir = await temp(t), mcp = session(t, path.join(dir, 'out'), dir); await mcp.init();
  const bundle = await createBundle(blink), plain = await mcp.call({ project: blink }), off = await mcp.call({ project: blink, share: false, embedRecipe: false });
  const normalize = ({ info, result }) => result.content[0].text.replaceAll(JSON.stringify(info.directory).slice(1, -1), '<output>').replaceAll('\\\\', '/');
  assert.equal(normalize(off), normalize(plain));
  assert.equal(plain.info.share, undefined);
  assert.deepEqual(off.result.content.slice(1), plain.result.content.slice(1));
  await checkBundle(plain.info.directory, bundle); await checkBundle(off.info.directory, bundle);
  await writeFile(path.join(dir, 'palette.json'), JSON.stringify(blink.palette));
  const linked = { ...blink, palette: { $ref: 'palette.json' } };
  const shared = await mcp.call({ project: linked, share: true });
  assert.deepEqual(await readShareLink(shared.info.share.link), { recipe: blink, version, kind: 'project' });
  assert.equal(shared.info.share.characters, shared.info.share.link.length);
  assert.deepEqual(shared.info.resolved, ['palette.json']);
  await checkBundle(shared.info.directory, bundle);
  const embedded = await mcp.call({ revision: shared.info.revision, embedRecipe: true, share: true });
  assert.deepEqual(embedded.info.share, shared.info.share);
  await checkBundle(embedded.info.directory, bundle, blink);
  assert.equal(await readEmbeddedRecipe(Buffer.from(embedded.result.content[1].data, 'base64')), null);
  const long = await mcp.call({ project: oversized, share: true, embedRecipe: true });
  assert.equal(long.info.ok, true); assert.match(long.info.share.error, /over the 16,384-character limit/);
  assert.deepEqual(Object.keys(long.info.share), ['error']);
  await checkBundle(long.info.directory, await createBundle(oversized), oversized);
});

test('MCP discovery adds only two opt-in booleans to pixel_render', async t => {
  const dir = await temp(t), mcp = session(t, dir); await mcp.init();
  const listed = (await mcp.request('tools/list')).result.tools;
  assert.deepEqual(listed.map(tool => tool.name), ['pixel_help', 'pixel_validate', 'pixel_inspect', 'pixel_patch', 'pixel_render', 'pixel_compile', 'pixel_scene', 'pixel_import']);
  const render = listed.find(tool => tool.name === 'pixel_render');
  for (const [key, sentence] of [['share', 'Also return a playground link that reopens this recipe in a browser.'], ['embedRecipe', 'Embed the recipe in the exported PNGs so they reopen in the playground.']]) {
    assert.deepEqual(render.inputSchema.properties[key], { type: 'boolean', description: sentence });
    assert.ok(!render.inputSchema.required?.includes(key));
  }
  for (const tool of listed.filter(tool => tool.name !== 'pixel_render')) {
    assert.ok(!('share' in tool.inputSchema.properties) && !('embedRecipe' in tool.inputSchema.properties), tool.name);
  }
});
