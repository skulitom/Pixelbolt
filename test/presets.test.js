import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMCP } from '../src/mcp.js';
import { renderProject } from '../src/core.js';
import { resolveReferences } from '../src/resolve.js';
import { compilePoses } from '../src/authoring.js';
import { compileEffects } from '../src/fx.js';
import { compileFluid } from '../src/fluid.js';
import { compileWaves } from '../src/wave.js';
import { formatJSON } from '../src/index.js';
import { decodePNG } from '../src/import.js';
import { skillFiles } from '../src/skill.js';
import { presetEntries } from '../src/presets.js';
import { decodeGIF } from './fixtures/decode-gif.js';

const root = fileURLToPath(new URL('../', import.meta.url)), examples = path.join(root, 'examples'), cli = path.join(root, 'bin', 'pixelbolt.js');
const run = promisify(execFile);
const COMPILE = { 'pixelforge-poses': compilePoses, 'pixelforge-fx': compileEffects, 'pixelforge-fluid': compileFluid, 'pixelforge-wave': compileWaves };
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
  const call = async (name, args) => (await request('tools/call', { name, arguments: args })).result;
  const close = async () => { input.end(); await running; };
  return { call, close, init: () => request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } }) };
}
const reply = result => JSON.parse(result.content[0].text);
// Each example file as the CLI reads it: references resolved beside it, then compiled by its own format.
const readExample = async file => JSON.parse(await readFile(path.join(examples, file), 'utf8'));
async function compileExample(file) {
  const { document } = await resolveReferences(await readExample(file), { baseDir: examples });
  return COMPILE[document.format] ? COMPILE[document.format](document).recipe : document;
}
const pool = async (items, limit, work) => { const queue = [...items]; await Promise.all(Array.from({ length: limit }, async () => { while (queue.length) await work(queue.shift()); })); };

test('the presets listing covers every source and looping recipe in examples/, measured from the files themselves', async t => {
  const files = (await readdir(examples, { withFileTypes: true })).filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => entry.name);
  const sources = files.filter(file => /\.(fluid|fx|wave|poses)\.json$/.test(file)), bases = new Set(sources.map(file => file.replace(/\.(fluid|fx|wave|poses)\.json$/, '')));
  // A plain recipe is a preset when every animation loops and no source in the folder compiles to it.
  const recipes = [];
  for (const file of files.filter(file => !sources.includes(file))) {
    const document = await readExample(file), animations = Object.values(document.animations ?? {});
    if (document.format === undefined && !bases.has(file.slice(0, -5)) && document.frames.length > 1 && animations.length && animations.every(item => item.loop !== false && item.frames.length > 1)) recipes.push(file);
  }
  const mcp = session({ directory: await temp(t, 'presets-list'), root: examples });
  await mcp.init();
  const { guide, presets } = reply(await mcp.call('pixel_help', { topic: 'presets' }));
  await mcp.close();
  assert.match(guide, /pixel_compile \{"preset": "<name>"\}/);
  assert.deepEqual(presets.map(entry => entry.file.slice('examples/'.length)).sort(), [...sources, ...recipes].sort());
  assert.equal(new Set(presets.map(entry => entry.name.toLowerCase())).size, presets.length, 'names are unique');
  for (const entry of presets) {
    assert.equal(entry.error, undefined, `${entry.name} compiles`);
    const project = renderProject(await compileExample(entry.file.slice('examples/'.length))), colors = new Set();
    for (const frame of project.frames) for (let i = 0; i < frame.data.length; i += 4) if (frame.data[i + 3]) colors.add(frame.data.slice(i, i + 4).join());
    const loops = Object.values(project.animations).map(item => item.loop);
    assert.deepEqual([entry.size, entry.frames, entry.colors, entry.plays], [`${project.width}x${project.height}`, project.frames.length, colors.size, loops.every(Boolean) ? 'loop' : loops.some(Boolean) ? 'loops and one-shots' : 'one-shot'], entry.name);
    assert.ok(typeof entry.for === 'string' && entry.for.length > 3, `${entry.name} says what it is for`);
    for (const [name, item] of Object.entries(project.animations).slice(0, 12)) assert.equal(entry.animations[name], `${item.frames.length} frames, ${item.loop ? 'loop' : 'one-shot'}`);
    // A liquid simulation reads as an effect, never as a character's idle.
    if (entry.kind === 'fluid' && Object.values((await readExample(entry.file.slice(9))).effects).some(effect => effect.kind === 'liquid')) assert.match(entry.for, /liquid, not a character/);
  }
});

test('a smoke preset cut to 8 frames with the quick start\'s pixel_patch call passes the effect checks', async t => {
  const quick = await readFile(path.join(root, 'docs/agent-quick-start.md'), 'utf8');
  const call = JSON.parse(/`(\{"revision": "[^`]*smoke-puff-1\][^`]*\})`/.exec(quick)[1]);
  const dir = await temp(t, 'smoke-cut'), mcp = session({ directory: dir, root: dir });
  await mcp.init();
  const compiled = reply(await mcp.call('pixel_compile', { preset: 'smoke-puff' }));
  const patched = await mcp.call('pixel_patch', { ...call, revision: compiled.revision });
  assert.notEqual(patched.isError, true, patched.content[0].text);
  const rendered = reply(await mcp.call('pixel_render', { revision: reply(patched).revision, gif: {}, expect: { width: 32, height: 32, frames: 8, colors: 6, transparent: true } }));
  await mcp.close();
  assert.equal(rendered.check.ok, true, JSON.stringify(rendered.check.problems));
  // The checks of a one-shot 32x32, 8-frame, 6-colour effect task, on the files as written.
  const atlas = JSON.parse(await readFile(path.join(rendered.directory, `${compiled.name}.atlas.json`), 'utf8'));
  const sheet = decodePNG(await readFile(path.join(rendered.directory, `${compiled.name}.png`)));
  const order = atlas.animations[compiled.name].frames ?? atlas.animations[compiled.name];
  const names = order.map(item => typeof item === 'string' ? item : item.name ?? item.frame);
  const cells = names.map(name => {
    const { x, y, w, h } = atlas.frames[name].frame;
    const data = new Uint8Array(w * h * 4);
    for (let row = 0; row < h; row++) data.set(sheet.data.subarray(((y + row) * sheet.width + x) * 4, ((y + row) * sheet.width + x + w) * 4), row * w * 4);
    return { w, h, data };
  });
  assert.equal(cells.length, 8);
  for (const cell of cells) assert.deepEqual([cell.w, cell.h], [32, 32]);
  const colours = new Set(), shares = [];
  for (const { data } of cells) {
    let opaque = 0;
    for (let i = 0; i < data.length; i += 4) {
      assert.ok(data[i + 3] === 0 || data[i + 3] === 255, 'crisp alpha');
      if (data[i + 3] === 255) { opaque++; colours.add(data.slice(i, i + 3).join()); }
    }
    for (const at of [0, 31, 31 * 32, 32 * 32 - 1]) assert.equal(data[at * 4 + 3], 0, 'transparent corners');
    shares.push(opaque / 1024);
    assert.ok(1 - opaque / 1024 >= 0.2, 'at least a fifth of each frame is background');
  }
  assert.ok(colours.size <= 6, `${colours.size} colours`);
  assert.ok(Math.max(...shares) >= 0.1 && shares.every(share => share > 0), `content in every frame, the last included: ${shares}`);
  const shown = data => Array.from({ length: data.length / 4 }, (_, i) => (data[i * 4 + 3] ? data.slice(i * 4, i * 4 + 4).join() : 'clear'));
  for (let i = 1; i < cells.length; i++) assert.notDeepEqual(shown(cells[i].data), shown(cells[i - 1].data), `frame ${i} moves`);
  const gif = decodeGIF(await readFile(path.join(rendered.directory, 'gifs', `${compiled.name}.gif`)));
  assert.deepEqual([gif.width, gif.height, gif.frames.length], [32, 32, 8]);
  const hex = data => Array.from({ length: data.length / 4 }, (_, i) => (data[i * 4 + 3] ? Buffer.from(data.slice(i * 4, i * 4 + 3)).toString('hex') : 'clear'));
  gif.frames.forEach((frame, i) => assert.deepEqual(frame.pixels, hex(cells[i].data), `GIF frame ${i} equals the sheet`));
});

test('pixel_help returns one preset\'s source with its files inlined, and names its mistakes', async t => {
  const dir = await temp(t, 'preset-help'), mcp = session({ directory: dir, root: dir });
  await mcp.init();
  // A preset that names another file comes back whole, so its source compiles from any root.
  for (const entry of (await presetEntries()).filter(item => item.kind !== 'recipe')) {
    const help = reply(await mcp.call('pixel_help', { topic: 'preset', name: entry.name }));
    if (!help.inlined) continue;
    assert.equal(help.name, entry.name);
    assert.deepEqual((await mcp.call('pixel_compile', { source: help.source })).content, (await mcp.call('pixel_compile', { preset: entry.name })).content);
    break;
  }
  const error = async args => { const result = await mcp.call(args.tool ?? 'pixel_help', { ...args, tool: undefined }); assert.equal(result.isError, true, JSON.stringify(args)); return reply(result); };
  assert.match((await error({ topic: 'preset', name: 'smoke-puf' })).error, /no preset named "smoke-puf"; did you mean "smoke-puff"/);
  assert.equal((await error({ topic: 'preset' })).path, 'name');
  assert.equal((await error({ topic: 'guide', name: 'smoke-puff' })).path, 'name');
  assert.match((await error({ tool: 'pixel_compile', preset: 'smoke-puff', source: { format: 'pixelforge-fluid' } })).error, /either source or preset/);
  assert.match((await error({ tool: 'pixel_compile' })).error, /either source or preset/);
  assert.equal((await error({ tool: 'pixel_compile', preset: '../package' })).path, 'preset');
  await mcp.close();
  // The command line prints the same source.
  const one = JSON.parse((await run(process.execPath, [cli, 'presets', 'smoke-puff'])).stdout);
  assert.deepEqual(one.source, await readExample('smoke-puff.fluid.json'));
});

test('the standalone skill reaches the presets through the command line and its copied examples', async () => {
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')), files = await skillFiles(version), command = `npx -y pixelbolt@${version}`;
  const quick = files.get('docs/agent-quick-start.md').toString('utf8'), skill = files.get('SKILL.md').toString('utf8');
  assert.ok(quick.includes(`${command} compile --preset smoke-puff --out smoke.json`) && quick.includes(`${command} presets`));
  assert.ok(skill.includes('`compile --preset <name> --out <recipe.json>`') && skill.includes('`presets <name>`'));
  for (const entry of await presetEntries()) assert.ok(files.has(`examples/${entry.file}`), entry.file);
});
