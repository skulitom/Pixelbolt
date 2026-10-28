// Speed and memory benchmark for what users wait on: fluid, wave, fx and pose compiles, recipe renders, exports and the
// live fluid runner, over the shipped examples. Kept out of `node --test`; run it on an otherwise idle machine.
//
//   node scripts/bench.mjs                     time every case in this checkout
//   node scripts/bench.mjs --only fluid/,live  cases whose id starts with any of these
//   node scripts/bench.mjs --compare <root>    interleaved A/B: <root> (A, the base) against this checkout (B)
//   node scripts/bench.mjs --list              list the cases
// Options: --runs <n> timed runs per process (5), --warmup <n> untimed runs first (2; 0 also times cold caches such as
// craft.js's drawing cache), --rounds <n> processes per case and side (1, or 5 with --compare, the fewest that gives a
// verdict), --json <new file> to keep the report (an existing file is never overwritten).
//
// Each case runs in a fresh process, so its peak memory (the process's maximum resident set size, the median over its
// processes) is its own; a process that only loads the modules gives the baseline. Inputs come from this checkout and
// code from the root being timed, so both sides of a comparison get the same inputs: the examples, the hero rig, and
// the waterfall recipe the render and export cases start from (compiled once, by this checkout, before any timing).
// Every case hashes all it returns, and a comparison says whether the outputs match: a speed-up must not change what
// the code makes. The exit code is 1 when a case fails or the outputs differ.
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const here = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const example = name => JSON.parse(readFileSync(path.join(here, 'examples', name), 'utf8'));
const hash = (...parts) => { const h = createHash('sha256'); for (const part of parts) h.update(typeof part === 'string' ? part : Buffer.from(part.buffer ?? part, part.byteOffset ?? 0, part.byteLength ?? part.length)); return h.digest('hex').slice(0, 16); };
// A rendered project: every frame's name, duration and pixels, its animations and warnings.
const projectHash = project => hash(JSON.stringify({ width: project.width, height: project.height, frames: project.frames.map(({ name, duration }) => ({ name, duration })), animations: project.animations, warnings: project.warnings }), ...project.frames.map(frame => frame.data));
// A compiler's whole result: the recipe, its metadata (pose joints, fluid peaks, particle counts) and any warnings.
const compiledCase = (id, what, module, compiler, source) => ({
  id, what,
  setup: async (load) => ({ compile: (await load(module))[compiler], source: source() }),
  run: ({ compile, source }) => { const result = compile(source); return { frames: result.recipe.frames.length, hash: hash(JSON.stringify(result)) }; }
});

// Inputs made by this checkout's own code, once, so the code under test on either side never builds its own input.
const PREPARED = {
  hero: async () => (await import(pathToFileURL(path.join(here, 'scripts/figure-rigs.mjs')).href)).heroRig(),
  waterfall: async () => (await import(pathToFileURL(path.join(here, 'src/fluid.js')).href)).compileFluid(example('waterfall.fluid.json')).recipe
};
let inputs = null;
const prepared = name => JSON.parse(readFileSync(path.join(inputs, `${name}.json`), 'utf8'));

// A case: setup (untimed, once per process) returns the state; fresh(state), if given, makes each run's own state
// untimed; run(state) is timed and returns { frames, hash }.
const shipped = suffix => readdirSync(path.join(here, 'examples')).filter(name => name.endsWith(suffix)).sort();
const CASES = [
  ...shipped('.fluid.json').map(name => compiledCase(`fluid/${name.replace('.fluid.json', '')}`, 'compileFluid', 'src/fluid.js', 'compileFluid', () => example(name))),
  ...shipped('.wave.json').map(name => compiledCase(`wave/${name.replace('.wave.json', '')}`, 'compileWaves', 'src/wave.js', 'compileWaves', () => example(name))),
  compiledCase('fx/effects', 'compileEffects', 'src/fx.js', 'compileEffects', () => example('effects.fx.json')),
  compiledCase('poses/skink', 'compilePoses', 'src/authoring.js', 'compilePoses', () => example('quality/skink.poses.json')),
  { ...compiledCase('poses/hero', 'compilePoses (the hero rig)', 'src/authoring.js', 'compilePoses', () => prepared('hero')), inputs: ['hero'] },
  { id: 'render/forest-spirit', what: 'renderProject',
    setup: async load => ({ renderProject: (await load('src/core.js')).renderProject, recipe: example('forest-spirit.json') }),
    run: ({ renderProject, recipe }) => { const project = renderProject(recipe); return { frames: project.frames.length, hash: projectHash(project) }; } },
  { id: 'render/waterfall', what: 'renderProject (compiled waterfall)', inputs: ['waterfall'],
    setup: async load => ({ renderProject: (await load('src/core.js')).renderProject, recipe: prepared('waterfall') }),
    run: ({ renderProject, recipe }) => { const project = renderProject(recipe); return { frames: project.frames.length, hash: projectHash(project) }; } },
  { id: 'export/bundle-waterfall', what: 'createBundle: sheet, atlas, frames, APNG, CSS', inputs: ['waterfall'],
    setup: async load => ({ createBundle: (await load('src/export.js')).createBundle, recipe: prepared('waterfall') }),
    run: async ({ createBundle, recipe }) => {
      const bundle = await createBundle(recipe), names = [...bundle.files.keys()].sort();
      return { frames: bundle.project.frames.length, hash: hash(names.map(name => `${name} ${bundle.files.get(name).length}`).join('\n'), ...names.map(name => bundle.files.get(name))) };
    } },
  { id: 'export/gif-waterfall', what: 'animationGIF at scale 4', inputs: ['waterfall'],
    setup: async load => ({ animationGIF: (await load('src/gif.js')).animationGIF, project: (await load('src/core.js')).renderProject(prepared('waterfall')) }),
    run: ({ animationGIF, project }) => { const { data, ...gif } = animationGIF(project, undefined, { scale: 4 }); return { frames: gif.frames, hash: hash(JSON.stringify(gif), data) }; } },
  { id: 'live/waterfall', what: 'createLiveFluid: step and render 30 frames',
    setup: async load => ({ createLiveFluid: (await load('src/fluid.js')).createLiveFluid, source: example('waterfall.fluid.json') }),
    // Each run starts a new runner (its warm-up untimed), so the hash doesn't depend on --runs or --warmup.
    fresh: ({ createLiveFluid, source }) => createLiveFluid(source),
    run: live => { let shown; for (let i = 0; i < 30; i++) { live.step(); shown = live.render(); } return { frames: 30, hash: hash(JSON.stringify(shown.keys), shown.rgba) }; } }
];

const args = process.argv.slice(2);
const VALUED = ['--only', '--compare', '--json', '--runs', '--warmup', '--rounds', '--child', '--root', '--inputs'];
const stop = message => { console.error(message); process.exit(2); };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--list') continue;
  if (!VALUED.includes(args[i])) stop(`unknown argument ${args[i]}; options: --list, ${VALUED.slice(0, 6).join(', ')} (each followed by its value)`);
  if (args[i + 1] === undefined || args[i + 1].startsWith('--')) stop(`${args[i]} needs a value`);
  i++;
}
const option = (name, fallback) => { const at = args.indexOf(name); return at === -1 ? fallback : args[at + 1]; };
const count = (name, fallback, min = 1) => {
  const value = Number(option(name, fallback));
  if (!Number.isInteger(value) || value < min) stop(`${name} expects a whole number of at least ${min}`);
  return value;
};

// One case in this process: warm up, time the runs, report one JSON line.
async function child(id, root, runs, warmup) {
  const load = rel => import(pathToFileURL(path.join(root, rel)).href);
  const report = { id, root };
  if (id === 'baseline') {
    // A checkout from before a module existed loads the rest.
    for (const rel of ['src/core.js', 'src/fluid.js', 'src/wave.js', 'src/fx.js', 'src/authoring.js', 'src/export.js', 'src/gif.js']) await load(rel).catch(() => {});
  } else {
    const spec = CASES.find(item => item.id === id), state = await spec.setup(load), times = [];
    const once = async () => {
      const input = spec.fresh ? await spec.fresh(state) : state, start = performance.now(), result = await spec.run(input);
      return { result, ms: performance.now() - start };
    };
    let result;
    for (let i = 0; i < warmup; i++) await once();
    for (let i = 0; i < runs; i++) { const timed = await once(); result = timed.result; times.push(timed.ms); }
    times.sort((a, b) => a - b);
    Object.assign(report, { frames: result.frames, hash: result.hash, ms: times.map(t => Math.round(t * 1000) / 1000) });
  }
  report.peakRssMB = Math.round(process.resourceUsage().maxRSS / 1024 * 10) / 10;
  console.log(JSON.stringify(report));
}

const median = list => { const sorted = [...list].sort((a, b) => a - b), mid = sorted.length >> 1; return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; };
const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;
function spawnCase(id, root, runs, warmup) {
  const done = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', id, '--root', root, '--runs', String(runs), '--warmup', String(warmup), ...(inputs ? ['--inputs', inputs] : [])], { encoding: 'utf8', timeout: 300_000, maxBuffer: 1 << 24 });
  const line = done.stdout?.trim().split('\n').at(-1);
  try { return JSON.parse(line); } catch { return { id, root, error: (done.stderr || done.error?.message || `exit ${done.status}`).trim().split('\n').slice(0, 3).join(' ') }; }
}
const describe = root => {
  const git = (...command) => { try { return execFileSync('git', command, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
  // A folder inside some other checkout has no commit of its own.
  const top = git('rev-parse', '--show-toplevel'), same = top !== null && path.relative(path.resolve(top), root) === '';
  // Changed tracked files anywhere, or new files under src/ (a new module a speed-up adds), make a checkout dirty.
  const status = same ? git('status', '--porcelain') ?? '' : '';
  return { root, commit: same ? git('rev-parse', 'HEAD') : null, dirty: status.split('\n').some(line => line && (!line.startsWith('??') || line.slice(3).startsWith('src/'))) };
};

async function main() {
  if (args[0] === '--child') { inputs = option('--inputs', null); return child(option('--child'), option('--root'), count('--runs', 5), count('--warmup', 2, 0)); }
  const only = option('--only', null)?.split(',').filter(Boolean), base = option('--compare', null), out = option('--json', null);
  if (args.includes('--list')) { for (const item of CASES) console.log(`${item.id.padEnd(26)} ${item.what}`); return; }
  const cases = CASES.filter(item => !only || only.some(prefix => item.id.startsWith(prefix)));
  if (!cases.length) stop(`no case starts with ${only.join(' or ')}; --list shows them`);
  // Checked before any timing, so a long run never ends without its report.
  if (out && existsSync(out)) stop(`${out} already exists; name a new file`);
  if (out && !statSync(path.dirname(path.resolve(out)), { throwIfNoEntry: false })?.isDirectory()) stop(`${path.dirname(path.resolve(out))} is not a folder`);
  if (base && !statSync(path.join(path.resolve(base), 'src', 'core.js'), { throwIfNoEntry: false })) stop(`${path.resolve(base)} is not a Pixelbolt checkout (no src/core.js)`);
  const runs = count('--runs', 5), warmup = count('--warmup', 2, 0), rounds = count('--rounds', base ? 5 : 1);
  // Below 5 processes a side, identical code shows a difference by chance too often (1 in 3 at 2) to call one.
  const judged = rounds >= 5;
  const sides = base ? [{ label: 'A', ...describe(path.resolve(base)) }, { label: 'B', ...describe(here) }] : [{ label: 'B', ...describe(here) }];
  const needed = [...new Set(cases.flatMap(item => item.inputs ?? []))];
  const report = {
    node: process.version, platform: `${os.platform()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model.trim(), cpus: os.cpus().length,
    memoryGB: Math.round(os.totalmem() / 1024 ** 3), runs, warmup, rounds, sides, baseline: {}, cases: {}
  };
  let failed = false;
  try {
    if (needed.length) {
      inputs = mkdtempSync(path.join(os.tmpdir(), 'pixelbolt-bench-'));
      for (const name of needed) writeFileSync(path.join(inputs, `${name}.json`), JSON.stringify(await PREPARED[name]()));
    }
    for (const side of sides) report.baseline[side.label] = spawnCase('baseline', side.root, 1, 0).peakRssMB ?? null;
    console.log(`Node ${process.version}, ${report.cpu}; ${runs} timed runs after ${warmup} warm-up runs, ${rounds} process${rounds === 1 ? '' : 'es'} per case${base ? ' and side, A and B interleaved' : ''}.`);
    for (const side of sides) console.log(`${side.label}: ${side.root} at ${side.commit?.slice(0, 12) ?? 'unknown'}${side.dirty ? ' (uncommitted changes)' : ''}; baseline ${report.baseline[side.label]} MB`);
    if (base && !judged) console.log(`With ${rounds} process${rounds === 1 ? '' : 'es'} a side there is no verdict; use --rounds 5 or more.`);
    console.log(base ? `\n${'case'.padEnd(26)} ${'frames'.padStart(6)} ${'A ms'.padStart(9)} ${'B ms'.padStart(9)} ${'change'.padStart(7)}  ${'A MB'.padStart(6)} ${'B MB'.padStart(6)}  verdict`
      : `\n${'case'.padEnd(26)} ${'frames'.padStart(6)} ${'median ms'.padStart(10)} ${'ms/frame'.padStart(9)} ${'run range ms'.padStart(17)} ${'peak MB'.padStart(8)}  output`);
    for (const item of cases) {
      const results = Object.fromEntries(sides.map(side => [side.label, []]));
      // Alternate which side goes first in each round, so drift (heat, background work) falls on both alike.
      for (let r = 0; r < rounds; r++) for (const side of (r % 2 ? [...sides].reverse() : sides)) results[side.label].push(spawnCase(item.id, side.root, runs, warmup));
      const summary = {};
      for (const [label, list] of Object.entries(results)) {
        const error = list.find(entry => entry.error)?.error;
        if (error) { summary[label] = { error }; failed = true; continue; }
        const medians = list.map(entry => median(entry.ms)), all = list.flatMap(entry => entry.ms), hashes = [...new Set(list.map(entry => entry.hash))];
        summary[label] = { frames: list[0].frames, medianMs: round(median(medians), 3), minMs: round(Math.min(...medians), 3), maxMs: round(Math.max(...medians), 3), runMinMs: round(Math.min(...all), 3), runMaxMs: round(Math.max(...all), 3), peakRssMB: median(list.map(entry => entry.peakRssMB)), hash: hashes.length === 1 ? hashes[0] : hashes, runsMs: list.map(entry => entry.ms) };
        if (hashes.length > 1) failed = true;
      }
      report.cases[item.id] = summary;
      const b = summary.B, a = summary.A;
      if (!base) {
        console.log(b.error ? `${item.id.padEnd(26)} error: ${b.error}` : `${item.id.padEnd(26)} ${String(b.frames).padStart(6)} ${b.medianMs.toFixed(1).padStart(10)} ${(b.medianMs / b.frames).toFixed(2).padStart(9)} ${`${b.runMinMs.toFixed(1)}-${b.runMaxMs.toFixed(1)}`.padStart(17)} ${b.peakRssMB.toFixed(1).padStart(8)}  ${Array.isArray(b.hash) ? 'DIFFERS BETWEEN RUNS' : b.hash}`);
        continue;
      }
      if (a.error || b.error) { console.log(`${item.id.padEnd(26)} error: ${a.error ? `A: ${a.error}` : ''}${a.error && b.error ? '; ' : ''}${b.error ? `B: ${b.error}` : ''}`); continue; }
      const change = b.medianMs / a.medianMs - 1;
      // A side whose slowest process beat the other's fastest is a measured difference; anything else is within noise.
      // For identical code that happens by chance with probability 2 / C(2n, n) per case: 1 in 126 at 5 processes a
      // side (the default), 1 in 462 at 6.
      const speed = !judged ? 'no verdict' : b.maxMs < a.minMs ? 'faster' : b.minMs > a.maxMs ? 'slower' : 'within noise';
      const same = !Array.isArray(a.hash) && !Array.isArray(b.hash) && a.hash === b.hash;
      if (!same) failed = true;
      summary.change = round(change, 4); summary.verdict = speed; summary.sameOutput = same;
      console.log(`${item.id.padEnd(26)} ${String(b.frames).padStart(6)} ${a.medianMs.toFixed(1).padStart(9)} ${b.medianMs.toFixed(1).padStart(9)} ${`${change >= 0 ? '+' : ''}${(change * 100).toFixed(1)}%`.padStart(7)}  ${a.peakRssMB.toFixed(1).padStart(6)} ${b.peakRssMB.toFixed(1).padStart(6)}  ${speed}${same ? '' : '; OUTPUT DIFFERS'}`);
    }
    if (base && judged) {
      // Chance that identical code reads faster or slower: 2 / C(2n, n) per case at n processes a side.
      let ways = 1;
      for (let k = 1; k <= rounds; k++) ways = ways * (rounds + k) / k;
      const each = 2 / ways, table = 1 - (1 - each) ** cases.length;
      console.log(`\nIdentical code reads faster or slower on about 1 case in ${Math.round(1 / each)}${cases.length > 1 ? `, so a table of ${cases.length} shows one about 1 time in ${Math.round(1 / table)}` : ''}; re-run a lone verdict with --only <case> before believing it.`);
    }
    if (out) { writeFileSync(out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); console.log(`\nSaved ${out}`); }
  } finally {
    if (inputs) rmSync(inputs, { recursive: true, force: true });
  }
  if (failed) process.exitCode = 1;
}
await main();
