// P-044: a pose whose two-bone `reach` target is out of range compiles to its closest pose with a warning. The warning
// used to live only in the compile metadata, so MCP pixel_compile (without metadata: true), pixel_inspect of a pose
// source and `compile --metadata <file>` all answered with no warnings at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { startMCP } from '../src/mcp.js';
import { compilePoses } from '../src/authoring.js';

const temp = async t => {
  const base = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(base, 'pixelbolt-pose-warnings-'));
  t.after(async () => { assert.ok(dir.startsWith(base + path.sep)); await rm(dir, { recursive: true, force: true }); });
  return dir;
};
async function session(t) {
  const directory = await temp(t), input = new PassThrough(), output = new PassThrough(), waiting = new Map();
  let buffer = '', next = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)?.(message); } });
  const running = startMCP({ directory, root: directory, input, output });
  const request = (method, params) => new Promise(resolve => { waiting.set(++next, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n'); });
  const call = async (name, args) => JSON.parse((await request('tools/call', { name, arguments: args })).result.content[0].text);
  t.after(async () => { input.end(); await running; });
  await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  return { directory, call };
}
const bone = length => ({ length, width: [3, 3], ramp: 0, base: 1, outline: 'k' });
// An arm of 6 + 5 px reaching for a point about 112 px beyond its reach.
const arm = reach => ({
  format: 'pixelforge-poses', version: 1, name: 'arm', width: 32, height: 32,
  palette: { a: '#543', b: '#975', c: '#edb', k: '#123' }, ramps: [['a', 'b', 'c']],
  parts: { upper: { bone: bone(6), points: { end: 'end' } }, lower: { bone: bone(5), points: { hand: 'end' } } },
  poses: [{ name: 'stand', origin: [16, 10], parts: [
    { name: 'lower', part: 'lower', attach: { part: 'upper', point: 'end' }, reach },
    { name: 'upper', part: 'upper', angle: 90 }
  ] }],
  animations: { hold: { frames: ['stand'] } }
});
const expected = 'poses.poses[0].parts[0].reach: Target is out of reach by 111.759 px; the chain uses its closest straight pose.';

test('compilePoses gives an out-of-reach warning as text beside the recipe, as the other compilers do', () => {
  const far = compilePoses(arm([100, 100]));
  assert.deepEqual(far.warnings, [expected]);
  assert.deepEqual(far.metadata.warnings.map(warning => `${warning.path}: ${warning.message}`), far.warnings);
  // A pose that reaches its target compiles exactly as before: no warnings key at all.
  const near = compilePoses(arm([18, 18]));
  assert.equal(near.metadata.poses.stand.parts.lower.reach.unreachable, false);
  assert.deepEqual(Object.keys(near), ['recipe', 'metadata']);
});

test('MCP pixel_compile and pixel_inspect report an out-of-reach target without asking for metadata', async t => {
  const mcp = await session(t), source = arm([100, 100]);
  const compiled = await mcp.call('pixel_compile', { source });
  assert.equal(compiled.ok, true); assert.deepEqual(compiled.warnings, [expected]); assert.equal(compiled.metadata, undefined);
  // With the metadata too, the warning is listed once.
  const detailed = await mcp.call('pixel_compile', { source, metadata: true });
  assert.deepEqual(detailed.warnings, [expected]); assert.equal(detailed.metadata.warnings.length, 1);
  for (const view of [{}, { view: 'motion', animation: 'hold' }]) assert.deepEqual((await mcp.call('pixel_inspect', { source, ...view })).warnings, [expected], JSON.stringify(view));
  assert.deepEqual((await mcp.call('pixel_compile', { source: arm([18, 18]) })).warnings, []);
});

test('CLI compile lists an out-of-reach target in its result when the metadata goes to a file', async t => {
  const dir = await temp(t), cli = fileURLToPath(new URL('../bin/pixelbolt.js', import.meta.url));
  await writeFile(path.join(dir, 'arm.poses.json'), JSON.stringify(arm([100, 100])));
  const { stdout } = await promisify(execFile)(process.execPath, [cli, 'compile', 'arm.poses.json', '--out', 'arm.json', '--metadata', 'arm.metadata.json'], { cwd: dir });
  const result = JSON.parse(stdout);
  assert.deepEqual(result.warnings, [expected]); assert.equal(path.basename(result.metadata), 'arm.metadata.json');
  assert.equal(JSON.parse(await readFile(path.join(dir, 'arm.metadata.json'), 'utf8')).warnings[0].path, 'poses.poses[0].parts[0].reach');
});
