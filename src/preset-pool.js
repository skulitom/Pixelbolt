// Node-side, one listing's bounded pool. Each lane has at most one job in flight; no worker-side queue can start
// work after the budget. A failed thread costs only its assigned preset, and is replaced for subsequent work.
import { Worker, resourceLimits } from 'node:worker_threads';

function spawn() {
  // Nested MCP workers must inherit the calling tool thread's limits, not Node's unrestricted defaults.
  // --input-type describes a caller's eval/stdin script and is invalid for this file entry point. Keep other
  // inherited flags (including preloads), and handle both --input-type=module and --input-type module.
  const hasInputType = process.execArgv.some(arg => arg === '--input-type' || arg.startsWith('--input-type='));
  const execArgv = hasInputType ? process.execArgv.filter((arg, index, args) => arg !== '--input-type' && !arg.startsWith('--input-type=') && args[index - 1] !== '--input-type') : undefined;
  const thread = new Worker(new URL('./presets-worker.js', import.meta.url), { resourceLimits, execArgv });
  let pending, failure, resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const fail = error => { failure = error; resolveReady(); pending?.reject(error); pending = undefined; };
  thread.on('error', fail).on('exit', code => fail(failure ?? new Error(`the preset worker exited with code ${code}`)));
  thread.on('message', message => {
    if (message === 'ready') { resolveReady(); return; }
    pending?.resolve(message); pending = undefined;
  });
  return {
    close: () => thread.terminate(),
    async measure(entry, source, deadline) {
      await ready;
      if (failure) throw failure;
      if (Date.now() > deadline) return null;
      return new Promise((resolve, reject) => {
        pending = { resolve, reject };
        try { thread.postMessage({ entry, source, deadline }); } catch (error) { fail(error); }
      });
    }
  };
}

export async function measurePresets(jobs, { concurrency, deadline }, measure) {
  const results = new Array(jobs.length).fill(null), workers = new Set();
  const measurable = jobs.filter(job => job.error === undefined).length;
  let next = 0, serial = measurable < 2 || concurrency === 1;
  const create = () => { const worker = spawn(); workers.add(worker); return worker; };
  const retire = async worker => { await worker.close(); workers.delete(worker); };
  const close = () => Promise.all([...workers].map(retire));
  async function lane(worker) {
    while (next < jobs.length && Date.now() <= deadline) {
      const index = next++, { entry, source, error } = jobs[index];
      if (error !== undefined) { results[index] = { error }; continue; }
      try {
        if (!serial && !worker) {
          try { worker = create(); } catch { serial = true; }
        }
        results[index] = serial
          ? (Date.now() <= deadline ? { facts: measure(entry, source) } : null)
          : await worker.measure(entry, source, deadline);
      } catch (error) {
        results[index] = { error: error.message };
        if (worker) { await retire(worker); worker = null; }
      }
    }
  }
  try {
    if (!jobs.length || Date.now() > deadline) return results;
    const lanes = [];
    if (!serial) {
      try { for (let i = 0; i < Math.min(concurrency, measurable); i++) lanes.push(create()); }
      catch { await close(); serial = true; } // Restricted runtimes still get the ordinary in-thread measurements.
    }
    if (serial) await lane();
    else await Promise.all(lanes.map(lane));
    return results;
  } finally { await close(); }
}
