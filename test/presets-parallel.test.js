import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import { Worker } from 'node:worker_threads';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { presetEntries, loadPreset } from '../src/presets.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const small = ['coin', 'interference', 'smoke-puff', 'swing', 'swing-trail'];

// Observe real workers in a temporary package, without adding hooks to the shipped implementation. A shared gate
// can hold the first job until the parent has received the second; completion order never depends on wall time.
const observer = `
import { Worker as NativeWorker, resourceLimits } from 'node:worker_threads';
export { resourceLimits };
export const state = { attempts: 0, workers: [], starts: [], completions: [], failAt: Infinity, onStart: null, release: null };
export const gate = new Int32Array(new SharedArrayBuffer(4));
export class ObservedWorker extends NativeWorker {
  constructor(url, options) {
    if (++state.attempts >= state.failAt) throw new Error('workers unavailable');
    super(url, { ...options, workerData: { gate: gate.buffer } });
    const record = { options: options.resourceLimits, limits: this.resourceLimits, exited: false, terminated: false };
    state.workers.push(record);
    this.on('exit', () => { record.exited = true; });
    this.on('message', message => {
      if (message === 'ready') return;
      state.completions.push(this.job);
      if (this.job === state.release) { Atomics.store(gate, 0, 1); Atomics.notify(gate, 0); }
    });
    this.record = record;
  }
  postMessage(message) {
    this.job = message.entry.name;
    state.starts.push({ name: this.job, time: Date.now(), deadline: message.deadline });
    super.postMessage(message);
    state.onStart?.(state.starts.length);
  }
  terminate() { this.record.terminated = true; return super.terminate(); }
}
`;

async function fixture(t, { broken = true, workerCode = '', cores = 4 } = {}) {
  const base = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(base, 'pixelbolt-preset-pool-'));
  t.after(async () => { assert.ok(dir.startsWith(base + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const original = os.availableParallelism;
  os.availableParallelism = () => cores;
  syncBuiltinESMExports();
  t.after(() => { os.availableParallelism = original; syncBuiltinESMExports(); });
  await Promise.all(['src', 'package.json', 'studio/effects-controls.js', 'studio/fluid-controls.js'].map(part => cp(path.join(root, part), path.join(dir, part), { recursive: true })));
  const entries = (await presetEntries()).filter(entry => small.includes(entry.name));
  assert.deepEqual(new Set(entries.map(entry => entry.kind)), new Set(['recipe', 'wave', 'fluid', 'poses', 'fx']));
  for (const entry of entries) for (const file of [`examples/${entry.file}`, ...(await loadPreset(entry)).inlined]) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await cp(path.join(root, file), path.join(dir, file));
  }
  if (broken) await writeFile(path.join(dir, 'examples/zz-broken.fx.json'), '{"format":"pixelforge-fx","version":999}');
  await writeFile(path.join(dir, 'src/observe-workers.js'), observer);
  const pool = path.join(dir, 'src/preset-pool.js');
  await writeFile(pool, (await readFile(pool, 'utf8')).replace("{ Worker, resourceLimits } from 'node:worker_threads'", "{ ObservedWorker as Worker, resourceLimits } from './observe-workers.js'"));
  if (workerCode) {
    const worker = path.join(dir, 'src/presets-worker.js');
    await writeFile(worker, "import { workerData } from 'node:worker_threads';\n" + (await readFile(worker, 'utf8')).replace("  if (Date.now() > deadline)", `${workerCode}\n  if (Date.now() > deadline)`));
  }
  const { state, gate } = await import(pathToFileURL(path.join(dir, 'src/observe-workers.js')));
  const { listPresets } = await import(pathToFileURL(path.join(dir, 'src/presets.js')));
  const list = options => listPresets({ budget: Infinity, ...options });
  return { dir, list, state, gate };
}
const stopped = state => assert.ok(state.workers.every(worker => worker.terminated && worker.exited), 'every pool worker was terminated and exited before the listing returned');
async function cacheFile(directory) {
  const names = await readdir(directory);
  assert.equal(names.length, 1, 'one engine cache file and no temporary files');
  return { name: names[0], text: await readFile(path.join(directory, names[0]), 'utf8') };
}

test('parallel and serial listings agree for every preset kind and a compile error, and obey the pool cap', async t => {
  const { list, state } = await fixture(t, { cores: 32 });
  const serial = await list({ concurrency: 1 });
  assert.equal(state.attempts, 0);
  const parallel = await list({ concurrency: 99 });
  assert.deepEqual(parallel, serial);
  assert.ok(parallel.presets.find(entry => entry.name === 'zz-broken').error);
  assert.equal(state.workers.length, 6, 'no more workers than jobs, even when concurrency exceeds eight');
  stopped(state);
});

test('default pool size leaves a core free and limits larger machines to eight', async t => {
  const { list, state, dir } = await fixture(t, { cores: 4 });
  await list();
  assert.equal(state.workers.length, 3);
  stopped(state);
  os.availableParallelism = () => 32; syncBuiltinESMExports();
  // Copies exist only in the fixture, to supply more jobs than the cap.
  for (let i = 0; i < 5; i++) await cp(path.join(dir, 'examples/coin.json'), path.join(dir, `examples/coin-${i}.json`));
  state.workers.length = 0;
  await list();
  assert.equal(state.workers.length, 8);
  stopped(state);
  state.attempts = 0;
  os.availableParallelism = () => 1; syncBuiltinESMExports();
  await list();
  assert.equal(state.attempts, 0, 'a one-core runtime uses the in-thread serial path');
});

test('out-of-order worker completion preserves listing order and facts', async t => {
  const { list, state } = await fixture(t, { workerCode: "  if (entry.name === 'coin') Atomics.wait(new Int32Array(workerData.gate), 0, 0, 10000);" });
  const serial = await list({ concurrency: 1 });
  state.release = 'interference';
  const parallel = await list({ concurrency: 2 });
  assert.ok(state.completions.indexOf('interference') < state.completions.indexOf('coin'));
  assert.deepEqual(parallel, serial);
  stopped(state);
});

test('the budget stops new jobs but lets in-flight presets finish, with the unchanged unmeasured note', async t => {
  const { list, state, dir } = await fixture(t);
  await writeFile(path.join(dir, 'examples/zzz-unreadable.fx.json'), '{');
  const serial = await list({ concurrency: 1 });
  assert.match(serial.presets.at(-1).error, /could not be read/);
  assert.deepEqual(await list({ concurrency: 2 }), serial, 'read errors also match before the budget');
  state.starts.length = 0;
  // A controlled clock, not an elapsed-time assertion: cross a 1 ms budget just after two jobs were dispatched.
  let now = Date.now() + 3600000;
  t.mock.method(Date, 'now', () => now);
  state.onStart = count => { if (count === 2) now += 2; };
  const listing = await list({ concurrency: 2, budget: 1 });
  assert.equal(state.starts.length, 2);
  assert.ok(state.starts.every(job => job.time <= job.deadline));
  assert.deepEqual(listing.presets.slice(0, 2), serial.presets.slice(0, 2));
  assert.deepEqual(listing.presets.slice(2), serial.presets.slice(2).map(({ name, kind, file }) => ({ name, kind, file, unmeasured: true })));
  assert.equal(listing.note, '5 presets were listed without measuring them, to keep this call short; pixel_compile one by name to see it.');
  stopped(state);
  state.attempts = 0;
  assert.deepEqual(await list({ budget: -1 }), await list({ budget: -1, concurrency: 1 }));
  assert.equal(state.attempts, 0, 'an already exhausted budget creates no workers');
});

test('a worker checks the budget again before compiling a dispatched preset', async t => {
  const { list, state } = await fixture(t, { workerCode: '  Date.now = () => deadline + 1;' });
  const listing = await list({ budget: 3600000, concurrency: 2 });
  assert.ok(listing.presets.every(entry => entry.unmeasured));
  assert.ok(state.starts.length > 0, 'jobs were dispatched before their worker clock passed the deadline');
  stopped(state);
});

test('parallel cold cache bytes equal serial, and warm or single-miss listings create no pool', async t => {
  const { list, state, dir } = await fixture(t, { broken: false });
  const serialCache = path.join(dir, 'serial'), parallelCache = path.join(dir, 'parallel');
  const serial = await list({ concurrency: 1, cache: serialCache });
  assert.deepEqual(await list({ concurrency: 2, cache: parallelCache }), serial);
  const file = await cacheFile(parallelCache);
  assert.deepEqual(file, await cacheFile(serialCache));
  stopped(state);
  state.attempts = 0;
  assert.deepEqual(await list({ cache: parallelCache }), serial);
  assert.deepEqual(await list({ cache: parallelCache, budget: -1 }), serial, 'cache hits survive the budget');
  assert.equal(state.attempts, 0, 'fully cached facts create no pool');
  const cached = JSON.parse(file.text);
  delete cached[Object.keys(cached)[0]];
  await writeFile(path.join(parallelCache, file.name), JSON.stringify(cached));
  assert.deepEqual(await list({ cache: parallelCache }), serial);
  assert.equal(state.attempts, 0, 'one uncached preset measures in thread');
  assert.deepEqual(await cacheFile(parallelCache), file);
});

test('an empty or single-preset package creates no pool', async t => {
  const { list, state, dir } = await fixture(t, { broken: false });
  for (const name of await readdir(path.join(dir, 'examples'))) if (name !== 'coin.json') await rm(path.join(dir, 'examples', name));
  assert.deepEqual(await list(), await list({ concurrency: 1 }));
  await rm(path.join(dir, 'examples/coin.json'));
  assert.deepEqual((await list()).presets, []);
  assert.equal(state.attempts, 0);
});

test('worker construction failure silently falls back to serial and terminates a partially created pool', async t => {
  const { list, state } = await fixture(t);
  const serial = await list({ concurrency: 1 });
  for (const failAt of [1, 2]) {
    state.attempts = 0; state.failAt = failAt;
    assert.deepEqual(await list({ concurrency: 3 }), serial);
    assert.equal(state.attempts, failAt);
    stopped(state);
  }
});

test('a listing invoked from module eval does not pass --input-type to worker files', async t => {
  const { list, dir } = await fixture(t), serial = await list({ concurrency: 1 });
  const code = `import { listPresets } from ${JSON.stringify(pathToFileURL(path.join(dir, 'src/presets.js')).href)};
import { state } from ${JSON.stringify(pathToFileURL(path.join(dir, 'src/observe-workers.js')).href)};
const listing = await listPresets({ concurrency: 2, budget: Infinity }); console.log(JSON.stringify({ listing, workers: state.workers }));`;
  for (const flags of [['--input-type=module'], ['--input-type', 'module']]) {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [...flags, '-e', code]);
    const result = JSON.parse(stdout);
    assert.deepEqual(result.listing, serial);
    assert.equal(result.workers.length, 2);
    stopped({ workers: result.workers });
    assert.equal(stderr, '');
  }
});

for (const [name, workerCode, error] of [
  ['exit', "  if (entry.name === 'coin') process.exit(19);", /exited with code 19/],
  ['error', "  if (entry.name === 'coin') throw new Error('preset worker test failure');", /preset worker test failure/]
]) test(`a worker ${name} fails only its preset and later jobs still finish`, async t => {
  const { list, state } = await fixture(t, { workerCode });
  const serial = await list({ concurrency: 1 }), parallel = await list({ concurrency: 2 });
  assert.deepEqual(parallel.presets.slice(1), serial.presets.slice(1));
  assert.match(parallel.presets[0].error, error);
  assert.equal(parallel.note, undefined);
  stopped(state);
});

async function limitedListing(t, dir) {
  const parentFile = path.join(dir, 'limited-parent.mjs');
  await writeFile(parentFile, `
import { parentPort, resourceLimits } from 'node:worker_threads';
import { state } from './src/observe-workers.js';
import { listPresets } from './src/presets.js';
const listing = await listPresets({ concurrency: 2, budget: Infinity });
parentPort.postMessage({ listing, limits: resourceLimits, workers: state.workers });
`);
  const parent = new Worker(parentFile, { resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 8, codeRangeSizeMb: 16, stackSizeMb: 2 } });
  t.after(() => parent.terminate());
  return new Promise((resolve, reject) => { parent.once('message', resolve).once('error', reject).once('exit', code => reject(new Error(`parent exited: ${code}`))); });
}

test('pool workers inherit the actual resourceLimits of a limited parent worker', async t => {
  const { dir } = await fixture(t, { broken: false }), result = await limitedListing(t, dir);
  assert.ok(result.listing.presets.every(entry => entry.frames && !entry.error));
  assert.equal(result.workers.length, 2);
  for (const worker of result.workers) {
    assert.deepEqual(worker.options, result.limits, 'constructor receives the calling thread limits');
    assert.deepEqual(worker.limits, result.limits, 'the nested thread actually has those limits');
  }
  stopped({ workers: result.workers });
});

test('a nested worker that runs out of memory fails only its preset', async t => {
  const { dir, list } = await fixture(t, {
    broken: false,
    workerCode: "  if (entry.name === 'coin') { const held = []; while (true) held.push(new Array(100000).fill(entry.name)); }"
  });
  const serial = await list({ concurrency: 1 }), result = await limitedListing(t, dir);
  assert.match(result.listing.presets[0].error, /memory/i);
  assert.deepEqual(result.listing.presets.slice(1), serial.presets.slice(1));
  assert.equal(result.listing.note, undefined);
  stopped({ workers: result.workers });
});
