import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import { MessageChannel, Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { presetEntries, loadPreset } from '../src/presets.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const small = ['coin', 'interference', 'smoke-puff', 'swing', 'swing-trail'];
const sameJSON = (actual, expected, message) => assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);

// Observe real workers in a temporary package, without adding hooks to the shipped implementation. A shared gate
// can hold the first job until the parent has received the second; completion order never depends on wall time.
const observer = `
import './test-cores.js';
import { Worker as NativeWorker, resourceLimits, workerData } from 'node:worker_threads';
export { resourceLimits };
export const state = { attempts: 0, workers: [], starts: [], completions: [], failAt: Infinity, onStart: null, release: null, probes: workerData?.probes ?? [] };
export const gate = new Int32Array(new SharedArrayBuffer(4));
export class ObservedWorker extends NativeWorker {
  constructor(url, options) {
    if (++state.attempts >= state.failAt) throw new Error('workers unavailable');
    const probe = state.probes.shift();
    super(url, { ...options, workerData: { gate: gate.buffer, attempt: state.attempts, probe }, transferList: probe ? [probe] : [] });
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

async function fixture(t, { broken = true, workerCode = '', workerInit = '', cores = 4 } = {}) {
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
  // Each importing isolate installs the mock, including module-eval children and limited parent workers.
  await writeFile(path.join(dir, 'src/test-cores.js'), `import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
os.availableParallelism = () => ${cores}; syncBuiltinESMExports();`);
  await writeFile(path.join(dir, 'src/observe-workers.js'), observer);
  const pool = path.join(dir, 'src/preset-pool.js');
  await writeFile(pool, (await readFile(pool, 'utf8')).replace("{ Worker, resourceLimits } from 'node:worker_threads'", "{ ObservedWorker as Worker, resourceLimits } from './observe-workers.js'"));
  if (workerCode || workerInit) {
    const worker = path.join(dir, 'src/presets-worker.js');
    await writeFile(worker, `import { workerData } from 'node:worker_threads';\n${workerInit}\n` + (await readFile(worker, 'utf8')).replace("  if (Date.now() > deadline)", `${workerCode}\n  if (Date.now() > deadline)`));
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
  sameJSON(parallel, serial);
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
  sameJSON(parallel, serial);
  stopped(state);
});

test('the budget stops new jobs but lets in-flight presets finish, with the unchanged unmeasured note', async t => {
  const { list, state, dir } = await fixture(t);
  await writeFile(path.join(dir, 'examples/zzz-unreadable.fx.json'), '{');
  const serial = await list({ concurrency: 1 });
  assert.match(serial.presets.at(-1).error, /could not be read/);
  sameJSON(await list({ concurrency: 2 }), serial, 'read errors also match before the budget');
  state.starts.length = 0;
  // A controlled clock, not an elapsed-time assertion: cross a 1 ms budget just after two jobs were dispatched.
  let now = Date.now() + 3600000;
  t.mock.method(Date, 'now', () => now);
  state.onStart = count => { if (count === 2) now += 2; };
  const listing = await list({ concurrency: 2, budget: 1 });
  assert.equal(state.starts.length, 2);
  assert.ok(state.starts.every(job => job.time <= job.deadline));
  sameJSON(listing.presets.slice(0, 2), serial.presets.slice(0, 2));
  sameJSON(listing.presets.slice(2), serial.presets.slice(2).map(({ name, kind, file }) => ({ name, kind, file, unmeasured: true })));
  assert.equal(listing.note, '5 presets were listed without measuring them, to keep this call short; pixel_compile one by name to see it.');
  stopped(state);
  state.attempts = 0;
  sameJSON(await list({ budget: -1 }), await list({ budget: -1, concurrency: 1 }));
  assert.equal(state.attempts, 0, 'an already exhausted budget creates no workers');
});

test('a zero budget follows the serial inclusive check before loading each preset', async t => {
  const { list, state } = await fixture(t);
  let readings = 0;
  // The first budget check shares start's millisecond; reading/loading the first preset crosses the boundary.
  t.mock.method(Date, 'now', () => 1000 + (readings++ < 2 ? 0 : 1));
  const serial = await list({ concurrency: 1, budget: 0 });
  assert.ok(serial.presets[0].frames);
  assert.ok(serial.presets.slice(1).every(entry => entry.unmeasured));
  readings = 0;
  sameJSON(await list({ concurrency: 2, budget: 0 }), serial);
  assert.equal(state.attempts, 0, 'a zero budget does not spend time starting a pool');
  // If the clock already advanced at the first check, neither path may measure anything.
  t.mock.method(Date, 'now', () => readings++);
  const expired = await list({ concurrency: 1, budget: 0 });
  assert.ok(expired.presets.every(entry => entry.unmeasured));
  sameJSON(await list({ concurrency: 2, budget: 0 }), expired);
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
  sameJSON(await list({ concurrency: 2, cache: parallelCache }), serial);
  const file = await cacheFile(parallelCache);
  assert.deepEqual(file, await cacheFile(serialCache));
  stopped(state);
  state.attempts = 0;
  sameJSON(await list({ cache: parallelCache }), serial);
  sameJSON(await list({ cache: parallelCache, budget: -1 }), serial, 'cache hits survive the budget');
  assert.equal(state.attempts, 0, 'fully cached facts create no pool');
  const cached = JSON.parse(file.text);
  delete cached[Object.keys(cached)[0]];
  await writeFile(path.join(parallelCache, file.name), JSON.stringify(cached));
  sameJSON(await list({ cache: parallelCache }), serial);
  assert.equal(state.attempts, 0, 'one uncached preset measures in thread');
  assert.deepEqual(await cacheFile(parallelCache), file);
});

test('an empty or single-preset package creates no pool', async t => {
  const { list, state, dir } = await fixture(t, { broken: false });
  for (const name of await readdir(path.join(dir, 'examples'))) if (name !== 'coin.json') await rm(path.join(dir, 'examples', name));
  sameJSON(await list(), await list({ concurrency: 1 }));
  await rm(path.join(dir, 'examples/coin.json'));
  assert.deepEqual((await list()).presets, []);
  assert.equal(state.attempts, 0);
});

test('worker construction failure silently falls back to serial and terminates a partially created pool', async t => {
  const { list, state } = await fixture(t);
  const serial = await list({ concurrency: 1 });
  for (const failAt of [1, 2]) {
    state.attempts = 0; state.failAt = failAt;
    sameJSON(await list({ concurrency: 3 }), serial);
    assert.equal(state.attempts, failAt);
    stopped(state);
  }
});

for (const failure of ['is missing', 'throws', 'exits']) test(`a worker that ${failure} before ready retires the pool and lists in thread`, async t => {
  const { list, state, dir } = await fixture(t);
  const serial = await list({ concurrency: 1 });
  const worker = path.join(dir, 'src/presets-worker.js');
  if (failure === 'is missing') await rm(worker);
  else await writeFile(worker, failure === 'throws' ? "throw new Error('failed module load');" : 'process.exit(19);');
  sameJSON(await list({ concurrency: 2 }), serial);
  assert.equal(state.attempts, 2, 'only the initial pool was created');
  assert.equal(state.starts.length, 0, 'no preset dispatched until the whole pool starts');
  stopped(state);
});

test('a listing invoked from module eval does not pass --input-type to worker files', async t => {
  const { list, dir } = await fixture(t), serial = await list({ concurrency: 1 });
  const code = `import { listPresets } from ${JSON.stringify(pathToFileURL(path.join(dir, 'src/presets.js')).href)};
import { state } from ${JSON.stringify(pathToFileURL(path.join(dir, 'src/observe-workers.js')).href)};
const listing = await listPresets({ concurrency: 2, budget: Infinity }); console.log(JSON.stringify({ listing, workers: state.workers }));`;
  for (const flags of [['--input-type=module'], ['--input-type', 'module']]) {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [...flags, '-e', code]);
    const result = JSON.parse(stdout);
    sameJSON(result.listing, serial);
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
  sameJSON(parallel.presets.slice(1), serial.presets.slice(1));
  assert.match(parallel.presets[0].error, error);
  assert.equal(parallel.note, undefined);
  stopped(state);
});

test('a replacement that fails before ready retires the pool and retries interrupted presets in thread', async t => {
  const { list, state } = await fixture(t, {
    workerInit: "if (workerData.attempt === 3) throw new Error('replacement failed to load');",
    workerCode: "  if (entry.name === 'coin') process.exit(19);\n  if (entry.name === 'interference') Atomics.wait(new Int32Array(workerData.gate), 0, 0);"
  });
  const serial = await list({ concurrency: 1 }), parallel = await list({ concurrency: 2 });
  assert.match(parallel.presets[0].error, /exited with code 19/);
  sameJSON(parallel.presets.slice(1), serial.presets.slice(1));
  assert.equal(parallel.note, undefined);
  assert.equal(state.attempts, 3);
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
  sameJSON(result.listing.presets.slice(1), serial.presets.slice(1));
  assert.equal(result.listing.note, undefined);
  stopped({ workers: result.workers });
});

test('terminating a listing worker also closes every running pool thread', { timeout: 30000 }, async t => {
  const { dir } = await fixture(t, {
    workerCode: `  workerData.probe.postMessage(entry.name);
  Atomics.wait(new Int32Array(workerData.gate), 0, 0);
  throw new Error('held preset unexpectedly resumed');`
  });
  // Transfer each port all the way to its pool thread. No port remains in the listing worker, so these close
  // events witness the nested threads' own teardown, independent of CPU usage or how busy the CI runner is.
  const channels = [new MessageChannel(), new MessageChannel()];
  const started = channels.map(({ port1 }) => once(port1, 'message'));
  let closed = 0;
  const stopped = channels.map(({ port1 }) => once(port1, 'close').then(() => { closed++; }));
  t.after(() => { for (const { port1, port2 } of channels) { port1.close(); port2.close(); } });
  const parentFile = path.join(dir, 'cancelled-parent.mjs');
  await writeFile(parentFile, `import { listPresets } from './src/presets.js';
await listPresets({ concurrency: 2, budget: Infinity });
throw new Error('listing unexpectedly finished');`);
  const probes = channels.map(({ port2 }) => port2);
  const parent = new Worker(parentFile, { workerData: { probes }, transferList: probes });
  t.after(() => parent.terminate());
  const failed = new Promise((_, reject) => {
    parent.once('error', reject).once('exit', code => reject(new Error(`listing exited before cancellation: ${code}`)));
  });
  const jobs = await Promise.race([Promise.all(started), failed]);
  assert.deepEqual(jobs.flat().sort(), ['coin', 'interference']);
  assert.equal(closed, 0, 'both nested threads are still holding their presets');
  await parent.terminate();
  await Promise.all(stopped);
  assert.equal(closed, 2, 'both pool threads were torn down with their caller');
});
