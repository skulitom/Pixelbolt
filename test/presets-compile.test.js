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

test('pixel_compile with a preset, and compile --preset, are byte-identical to compiling each file', async t => {
  const dir = await temp(t, 'presets'), mcp = session({ directory: path.join(dir, 'out'), root: examples });
  await mcp.init();
  const entries = await presetEntries();
  for (const entry of entries) {
    const byName = await mcp.call('pixel_compile', { preset: entry.name });
    assert.notEqual(byName.isError, true, `${entry.name}: ${byName.content[0].text}`);
    if (entry.kind === 'recipe') {
      // A plain recipe compiles to itself: the same revision as the file sent as a project.
      const sent = await mcp.call('pixel_validate', { project: await readExample(entry.file) });
      assert.equal(reply(byName).revision, reply(sent).revision, entry.name);
    } else assert.deepEqual(byName.content, (await mcp.call('pixel_compile', { source: await readExample(entry.file) })).content, entry.name);
  }
  // Also by file name and by kind, ignoring case.
  const smoke = entries.find(entry => entry.file === 'smoke-puff.fluid.json');
  if (smoke) for (const alias of ['smoke-puff.fluid.json', 'SMOKE-PUFF.fluid', 'Smoke-Puff']) assert.equal(reply(await mcp.call('pixel_compile', { preset: alias })).revision, reply(await mcp.call('pixel_compile', { preset: smoke.name })).revision, alias);
  await mcp.close();
  // The command line writes the bytes compiling the file writes (each example's own formatting).
  // compile --preset reads the preset's own file, so one preset of each kind (one naming another file, if any) shows it.
  const inlining = new Set();
  for (const entry of entries) if ((await resolveReferences(await readExample(entry.file), { baseDir: examples })).files.length) inlining.add(entry.name);
  const picked = [...new Set(['fluid', 'fx', 'wave', 'poses', 'recipe'].map(kind => entries.find(entry => entry.kind === kind && (kind !== 'fx' || !inlining.size || inlining.has(entry.name)))).filter(Boolean))];
  await pool(picked, 4, async entry => {
    const out = path.join(dir, `${entry.name}.json`), file = path.join(dir, `${entry.name}.file.json`);
    await run(process.execPath, [cli, 'compile', '--preset', entry.name, '--out', out]);
    if (entry.kind === 'recipe') assert.equal(await readFile(out, 'utf8'), await readFile(path.join(examples, entry.file), 'utf8'), entry.name);
    else {
      await run(process.execPath, [cli, 'compile', path.join(examples, entry.file), '--out', file]);
      assert.equal(await readFile(out, 'utf8'), await readFile(file, 'utf8'), entry.name);
    }
  });
});

