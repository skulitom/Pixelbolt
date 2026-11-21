import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const bench = fileURLToPath(new URL('../scripts/bench.mjs', import.meta.url));

test('presets/cold allows all budgeted repetitions to finish and reports slow runs without failing', async t => {
  const base = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(base, 'pixelbolt-bench-test-'));
  t.after(async () => { assert.ok(dir.startsWith(base + path.sep)); await rm(dir, { recursive: true, force: true }); });
  // Observe the actual scheduler without waiting minutes. The fake child fails if its allotted timeout could not
  // fit its work; times on either side of the budget exercise both advisory outcomes with no elapsed-time checks.
  const preload = path.join(dir, 'observe-spawns.mjs');
  await writeFile(preload, `import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
cp.spawnSync = (command, args, options) => {
  const value = name => args[args.indexOf(name) + 1];
  const id = value('--child'), root = value('--root');
  if (id === 'baseline') return { stdout: JSON.stringify({ id, root, peakRssMB: 1 }) };
  const runs = Number(value('--runs')), warmup = Number(value('--warmup')), ms = Number(process.env.PRESET_BENCH_TEST_MS);
  if (options.timeout <= ms * (runs + warmup)) return { error: new Error('timeout would kill a completed budgeted run') };
  return { stdout: JSON.stringify({ id, root, frames: 61, hash: 'identical-listing', ms: Array(runs).fill(ms), peakRssMB: 1 }) };
};
syncBuiltinESMExports();`);
  // 45 s: CI's runners list at 30 to 40 s, and at fifteen runs after three warm-ups 40 s filled the whole guard (P-196).
  // The case names its own counts; --runs and --warmup on the command line still win.
  for (const [ms, counts, runs, warmup] of [[17000, [], 3, 1], [20000, [], 3, 1], [21000, [], 3, 1], [45000, [], 3, 1], [21000, ['--runs', '2', '--warmup', '0'], 2, 0]]) {
    const reportFile = path.join(dir, `report-${ms}-${runs}.json`);
    const { stdout } = await promisify(execFile)(process.execPath, ['--import', pathToFileURL(preload).href, bench, '--budgets', '--only', 'presets/cold', ...counts, '--json', reportFile], {
      env: { ...process.env, PRESET_BENCH_TEST_MS: String(ms), GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: '' }
    });
    const report = JSON.parse(await readFile(reportFile, 'utf8')), result = report.cases['presets/cold'].B;
    assert.equal(report.runs, counts.length ? runs : 15);
    assert.equal(report.warmup, counts.length ? warmup : 3);
    assert.equal(report.cases['presets/cold'].runs, runs);
    assert.equal(report.cases['presets/cold'].warmup, warmup);
    assert.equal(result.runsMs[0].length, runs);
    assert.equal(result.medianMs, ms);
    assert.equal(result.budgetMs, 20000);
    assert.equal(result.withinBudget, ms <= 20000);
    if (ms > 20000) assert.match(stdout, new RegExp(`::warning title=Speed budget of presets/cold::.*\\(median of ${runs} runs\\), over its 20000 ms budget`));
  }
});
