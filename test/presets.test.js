import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
import { decodePNG } from '../src/import.js';
import { skillFiles } from '../src/skill.js';
import { presetEntries, listPresets } from '../src/presets.js';
import { decodeGIF } from './fixtures/decode-gif.js';

const root = fileURLToPath(new URL('../', import.meta.url)), examples = path.join(root, 'examples');
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
const readExample = async file => JSON.parse((await readFile(path.join(examples, file), 'utf8')).replace(/^﻿/, ''));
// A revision id is the start of the SHA-256 of the recipe's JSON, so equal ids mean byte-identical recipes.
const revisionOf = recipe => createHash('sha256').update(JSON.stringify(recipe)).digest('hex').slice(0, 12);

// Every top-level example, compiled once the way the CLI compiles a file (references resolved beside it).
const compiled = new Map();
let files, sources, recipes;
before(async () => {
  files = (await readdir(examples, { withFileTypes: true })).filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => entry.name);
  sources = files.filter(file => /\.(fluid|fx|wave|poses)\.json$/.test(file));
  const bases = new Set(sources.map(file => file.replace(/\.(fluid|fx|wave|poses)\.json$/, '')));
  // A plain recipe is a preset when every animation loops and no source in the folder compiles to it. Anything else
  // in the folder (a shared palette, a scene, a normals source) is not one.
  recipes = [];
  for (const file of files.filter(file => !sources.includes(file))) {
    let document;
    try { document = await readExample(file); } catch { continue; }
    const animations = document && typeof document === 'object' && document.animations && typeof document.animations === 'object' ? Object.values(document.animations) : [];
    if (document?.format === undefined && Array.isArray(document?.frames) && document.frames.length > 1 && !bases.has(file.slice(0, -5))
      && animations.length && animations.every(item => item?.loop !== false && Array.isArray(item?.frames) && item.frames.length > 1)) recipes.push(file);
  }
  for (const file of [...sources, ...recipes]) {
    const { document } = await resolveReferences(await readExample(file), { baseDir: examples });
    const recipe = COMPILE[document.format] ? COMPILE[document.format](document).recipe : document, project = renderProject(recipe), colors = new Set();
    for (const frame of project.frames) for (let i = 0; i < frame.data.length; i += 4) if (frame.data[i + 3]) colors.add(frame.data.slice(i, i + 4).join());
    compiled.set(file, { recipe, project, colors: colors.size, liquid: Object.values(document.effects ?? {}).some(effect => effect?.kind === 'liquid') });
  }
});

test('the presets listing covers every source and looping recipe in examples/, measured from the files themselves', async t => {
  const mcp = session({ directory: await temp(t, 'presets-list'), root: examples });
  await mcp.init();
  const { guide, presets } = reply(await mcp.call('pixel_help', { topic: 'presets' }));
  await mcp.close();
  assert.match(guide, /pixel_compile \{"preset": "<name>"\}/);
  assert.deepEqual(presets.map(entry => entry.file.slice('examples/'.length)).sort(), [...sources, ...recipes].sort());
  assert.equal(new Set(presets.map(entry => entry.name.toLowerCase())).size, presets.length, 'names are unique');
  // A busy machine may pass the listing's time budget: the presets after that are named, not measured (the command
  // line, with no budget, measures all of them; see presets-cli.test.js).
  const measured = presets.filter(entry => !entry.unmeasured), skipped = presets.slice(measured.length);
  assert.ok(measured.length > 0 && skipped.every(entry => entry.unmeasured && Object.keys(entry).join() === 'name,kind,file,unmeasured'));
  if (skipped.length) t.diagnostic(`${skipped.length} presets listed past the time budget`);
  for (const entry of measured) {
    assert.equal(entry.error, undefined, `${entry.name} compiles`);
    const { project, colors, liquid } = compiled.get(entry.file.slice('examples/'.length)), loops = Object.values(project.animations).map(item => item.loop);
    assert.deepEqual([entry.size, entry.frames, entry.colors, entry.plays], [`${project.width}x${project.height}`, project.frames.length, colors, loops.every(Boolean) ? 'loop' : loops.some(Boolean) ? 'loops and one-shots' : 'one-shot'], entry.name);
    assert.ok(typeof entry.for === 'string' && entry.for.length > 3, `${entry.name} says what it is for`);
    for (const [name, item] of Object.entries(project.animations).slice(0, 12)) assert.equal(entry.animations[name], `${item.frames.length} frames, ${item.loop ? 'loop' : 'one-shot'}`);
    // A liquid simulation reads as an effect, never as a character's idle.
    if (entry.kind === 'fluid' && liquid) assert.match(entry.for, /liquid, not a character/);
  }
});

test('pixel_compile with a preset is byte-identical to compiling its file', async t => {
  const mcp = session({ directory: await temp(t, 'presets-compile'), root: examples });
  await mcp.init();
  const entries = await presetEntries();
  for (const entry of entries) {
    const result = await mcp.call('pixel_compile', { preset: entry.name });
    assert.notEqual(result.isError, true, `${entry.name}: ${result.content[0].text}`);
    assert.equal(reply(result).revision, revisionOf(compiled.get(entry.file).recipe), entry.name);
  }
  // The whole reply, contact sheet included, equals sending the file as source: one source of each kind.
  for (const kind of ['fluid', 'fx', 'wave', 'poses']) {
    const entry = entries.find(item => item.kind === kind);
    if (entry) assert.deepEqual((await mcp.call('pixel_compile', { preset: entry.name })).content, (await mcp.call('pixel_compile', { source: await readExample(entry.file) })).content, entry.name);
  }
  // Also by file name, as the listing gives it, and by kind, ignoring case.
  const smoke = entries.find(entry => entry.file === 'smoke-puff.fluid.json');
  if (smoke) for (const alias of ['smoke-puff.fluid.json', 'examples/smoke-puff.fluid.json', 'SMOKE-PUFF.fluid', 'Smoke-Puff']) assert.equal(reply(await mcp.call('pixel_compile', { preset: alias })).revision, revisionOf(compiled.get(smoke.file).recipe), alias);
  await mcp.close();
});

test('a preset cut with the quick start\'s pixel_patch call keeps the documented frames and passes the effect checks', async t => {
  if (!compiled.has('smoke-puff.fluid.json')) { t.skip('no smoke-puff preset'); return; }
  const quick = await readFile(path.join(root, 'docs/agent-quick-start.md'), 'utf8');
  const call = JSON.parse(/`(\{"revision": "[^`]*smoke-puff-1\][^`]*\})`/.exec(quick)[1]);
  // The call is the documented rule for the preset as it is now: of F frames keep floor(i × F / N).
  const { recipe, project, colors } = compiled.get('smoke-puff.fluid.json'), order = recipe.animations['smoke-puff'].frames, F = order.length, N = 8;
  const kept = Array.from({ length: N }, (_, i) => order[Math.floor(i * F / N)]);
  assert.deepEqual(call.changes, [...order.filter(name => !kept.includes(name)).map(name => ({ remove: `frames[${name}]` })), { set: 'animations.smoke-puff.frames', value: kept }]);
  const dir = await temp(t, 'smoke-cut'), mcp = session({ directory: dir, root: dir });
  await mcp.init();
  const start = reply(await mcp.call('pixel_compile', { preset: 'smoke-puff' }));
  const patched = await mcp.call('pixel_patch', { ...call, revision: start.revision });
  assert.notEqual(patched.isError, true, patched.content[0].text);
  const { width, height } = project, rendered = reply(await mcp.call('pixel_render', { revision: reply(patched).revision, gif: {}, expect: { width, height, frames: N, colors, transparent: true } }));
  await mcp.close();
  assert.equal(rendered.check.ok, true, JSON.stringify(rendered.check.problems));
  // The checks of a one-shot effect task, on the files as written. Today's preset is the task's own size: 32x32, at
  // most 6 colours.
  if (width === 32 && height === 32 && colors <= 6) t.diagnostic('smoke-puff meets a 32x32, 6-colour, 8-frame effect task');
  const atlas = JSON.parse(await readFile(path.join(rendered.directory, `${start.name}.atlas.json`), 'utf8'));
  const sheet = decodePNG(await readFile(path.join(rendered.directory, `${start.name}.png`)));
  const cells = kept.map(name => {
    const { x, y, w, h } = atlas.frames[name].frame, data = new Uint8Array(w * h * 4);
    for (let row = 0; row < h; row++) data.set(sheet.data.subarray(((y + row) * sheet.width + x) * 4, ((y + row) * sheet.width + x + w) * 4), row * w * 4);
    return { w, h, data };
  });
  for (const cell of cells) assert.deepEqual([cell.w, cell.h], [width, height]);
  const colours = new Set(), shares = [];
  for (const { data } of cells) {
    let opaque = 0;
    for (let i = 0; i < data.length; i += 4) {
      assert.ok(data[i + 3] === 0 || data[i + 3] === 255, 'crisp alpha');
      if (data[i + 3] === 255) { opaque++; colours.add(data.slice(i, i + 3).join()); }
    }
    for (const at of [0, width - 1, (height - 1) * width, width * height - 1]) assert.equal(data[at * 4 + 3], 0, 'transparent corners');
    shares.push(opaque / (width * height));
    assert.ok(1 - opaque / (width * height) >= 0.2, 'at least a fifth of each frame is background');
  }
  assert.ok(colours.size <= colors, `${colours.size} colours`);
  assert.ok(Math.max(...shares) >= 0.1 && shares.every(share => share > 0), `content in every frame, the last included: ${shares}`);
  const shown = data => Array.from({ length: data.length / 4 }, (_, i) => (data[i * 4 + 3] ? data.slice(i * 4, i * 4 + 4).join() : 'clear'));
  for (let i = 1; i < cells.length; i++) assert.notDeepEqual(shown(cells[i].data), shown(cells[i - 1].data), `frame ${i} moves`);
  const gif = decodeGIF(await readFile(path.join(rendered.directory, 'gifs', `${start.name}.gif`)));
  assert.deepEqual([gif.width, gif.height, gif.frames.length], [width, height, N]);
  const hex = data => Array.from({ length: data.length / 4 }, (_, i) => (data[i * 4 + 3] ? Buffer.from(data.slice(i * 4, i * 4 + 3)).toString('hex') : 'clear'));
  gif.frames.forEach((frame, i) => assert.deepEqual(frame.pixels, hex(cells[i].data), `GIF frame ${i} equals the sheet`));
});

test('pixel_help returns one preset\'s source with its files inlined, says what to do with it, and names its mistakes', async t => {
  const dir = await temp(t, 'preset-help'), mcp = session({ directory: dir, root: dir });
  await mcp.init();
  const entries = await presetEntries();
  // A preset that names another file comes back whole, so its source compiles from any root.
  for (const entry of entries.filter(item => item.kind !== 'recipe')) {
    const help = reply(await mcp.call('pixel_help', { topic: 'preset', name: entry.name }));
    if (!help.inlined) continue;
    assert.equal(help.name, entry.name);
    assert.match(help.next, /pixel_compile's source/);
    assert.equal(reply(await mcp.call('pixel_compile', { source: help.source })).revision, revisionOf(compiled.get(entry.file).recipe));
    break;
  }
  // A plain recipe is sent as a project; following the reply's advice works.
  const recipe = entries.find(item => item.kind === 'recipe');
  if (recipe) {
    const help = reply(await mcp.call('pixel_help', { topic: 'preset', name: recipe.name }));
    assert.match(help.next, /send it as project to pixel_validate, pixel_inspect or pixel_render/);
    assert.equal(reply(await mcp.call('pixel_validate', { project: help.source })).revision, revisionOf(compiled.get(recipe.file).recipe));
  }
  const error = async args => { const result = await mcp.call(args.tool ?? 'pixel_help', { ...args, tool: undefined }); assert.equal(result.isError, true, JSON.stringify(args)); return reply(result); };
  if (entries.some(entry => entry.name === 'smoke-puff')) assert.match((await error({ topic: 'preset', name: 'smoke-puf' })).error, /no preset named "smoke-puf"; did you mean "smoke-puff"/);
  assert.equal((await error({ topic: 'preset' })).path, 'name');
  assert.equal((await error({ topic: 'guide', name: 'smoke-puff' })).path, 'name');
  assert.match((await error({ tool: 'pixel_compile', preset: 'smoke-puff', source: { format: 'pixelforge-fluid' } })).error, /either source or preset/);
  assert.match((await error({ tool: 'pixel_compile' })).error, /either source or preset/);
  for (const name of ['../package', '../package.json', 'forest-spirit', 'caption.json']) assert.equal((await error({ tool: 'pixel_compile', preset: name })).path, 'preset', name);
  await mcp.close();
});

test('past its time budget the listing names the remaining presets without measuring them', async () => {
  const { presets, note } = await listPresets({ budget: -1 }), entries = await presetEntries();
  assert.deepEqual(presets, entries.map(entry => ({ name: entry.name, kind: entry.kind, file: `examples/${entry.file}`, unmeasured: true })));
  assert.match(note, new RegExp(`^${entries.length} presets were listed without measuring them`));
});

test('the standalone skill reaches the presets through the command line and its copied examples', async () => {
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')), copies = await skillFiles(version), command = `npx -y pixelbolt@${version}`;
  const quick = copies.get('docs/agent-quick-start.md').toString('utf8'), skill = copies.get('SKILL.md').toString('utf8');
  assert.ok(quick.includes(`${command} compile --preset smoke-puff --out smoke.json`) && quick.includes(`${command} presets`));
  assert.ok(skill.includes('`compile --preset <name> --out <recipe.json>`') && skill.includes('`presets <name>`'));
  for (const entry of await presetEntries()) assert.ok(copies.has(`examples/${entry.file}`), entry.file);
});
