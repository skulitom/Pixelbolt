// Speed and memory benchmark for what users wait on: fluid, wave, fx and pose compiles, recipe renders, exports and the
// live fluid runner, over the shipped examples. Kept out of `node --test`; run it on an otherwise idle machine.
//
//   node scripts/bench.mjs                     time every case in this checkout
//   node scripts/bench.mjs --only fluid/,live  cases whose id starts with any of these
//   node scripts/bench.mjs --compare <root>    interleaved A/B: <root> (A, the base) against this checkout (B)
//   node scripts/bench.mjs --list              list the cases
// Options: --runs <n> timed runs per process (5), --warmup <n> untimed runs first (2), --rounds <n> processes per case
// and side (1, or 5 with --compare), --json <new file> to keep the report (an existing file is never overwritten).
//
// Each case runs in a fresh process, so its peak memory (the process's maximum resident set size, the median over its
// processes) is its own; a process that only loads the modules gives the baseline. Inputs always come from this checkout and code from the root being
// timed, so both sides of a comparison get the same inputs. Every case hashes its output, and a comparison says whether
// the outputs match: a speed-up must not change what the code makes.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const here = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const example = name => JSON.parse(readFileSync(path.join(here, 'examples', name), 'utf8'));
const hash = (...parts) => { const h = createHash('sha256'); for (const part of parts) h.update(typeof part === 'string' ? part : Buffer.from(part.buffer ?? part, part.byteOffset ?? 0, part.byteLength ?? part.length)); return h.digest('hex').slice(0, 16); };
const framesHash = project => hash(...project.frames.map(frame => frame.data));

// A case: setup (untimed, once per process) returns the state; run(state) is timed and returns { frames, hash }.
const shipped = suffix => readdirSync(path.join(here, 'examples')).filter(name => name.endsWith(suffix)).sort();
const fluids = shipped('.fluid.json');
const compiled = async (load, name) => (await load('src/fluid.js')).compileFluid(example(name)).recipe;
const CASES = [
  ...fluids.map(name => ({
    id: `fluid/${name.replace('.fluid.json', '')}`, what: 'compileFluid',
    setup: async load => ({ compileFluid: (await load('src/fluid.js')).compileFluid, source: example(name) }),
    run: ({ compileFluid, source }) => { const { recipe } = compileFluid(source); return { frames: recipe.frames.length, hash: hash(JSON.stringify(recipe)) }; }
  })),
  ...shipped('.wave.json').map(name => ({
    id: `wave/${name.replace('.wave.json', '')}`, what: 'compileWaves',
    setup: async load => ({ compileWaves: (await load('src/wave.js')).compileWaves, source: example(name) }),
    run: ({ compileWaves, source }) => { const { recipe } = compileWaves(source); return { frames: recipe.frames.length, hash: hash(JSON.stringify(recipe)) }; }
  })),
  { id: 'fx/effects', what: 'compileEffects',
    setup: async load => ({ compileEffects: (await load('src/fx.js')).compileEffects, source: example('effects.fx.json') }),
    run: ({ compileEffects, source }) => { const { recipe } = compileEffects(source); return { frames: recipe.frames.length, hash: hash(JSON.stringify(recipe)) }; } },
  { id: 'poses/skink', what: 'compilePoses',
    setup: async load => ({ compilePoses: (await load('src/authoring.js')).compilePoses, source: example('quality/skink.poses.json') }),
    run: ({ compilePoses, source }) => { const { recipe } = compilePoses(source); return { frames: recipe.frames.length, hash: hash(JSON.stringify(recipe)) }; } },
  { id: 'poses/hero', what: 'compilePoses (the hero rig)',
    setup: async load => ({ compilePoses: (await load('src/authoring.js')).compilePoses, source: (await import(pathToFileURL(path.join(here, 'scripts/figure-rigs.mjs')).href)).heroRig() }),
    run: ({ compilePoses, source }) => { const { recipe } = compilePoses(source); return { frames: recipe.frames.length, hash: hash(JSON.stringify(recipe)) }; } },
  { id: 'render/forest-spirit', what: 'renderProject',
    setup: async load => ({ renderProject: (await load('src/core.js')).renderProject, recipe: example('forest-spirit.json') }),
    run: ({ renderProject, recipe }) => { const project = renderProject(recipe); return { frames: project.frames.length, hash: framesHash(project) }; } },
  { id: 'render/waterfall', what: 'renderProject (compiled waterfall)',
    setup: async load => ({ renderProject: (await load('src/core.js')).renderProject, recipe: await compiled(load, 'waterfall.fluid.json') }),
    run: ({ renderProject, recipe }) => { const project = renderProject(recipe); return { frames: project.frames.length, hash: framesHash(project) }; } },
  { id: 'export/bundle-waterfall', what: 'createBundle: sheet, atlas, frames, APNG, CSS',
    setup: async load => ({ createBundle: (await load('src/export.js')).createBundle, recipe: await compiled(load, 'waterfall.fluid.json') }),
    run: async ({ createBundle, recipe }) => {
      const bundle = await createBundle(recipe), names = [...bundle.files.keys()].sort();
      return { frames: bundle.project.frames.length, hash: hash(names.join('\n'), ...names.map(name => bundle.files.get(name))) };
    } },
  { id: 'export/gif-waterfall', what: 'animationGIF at scale 4',
    setup: async load => {
      const project = (await load('src/core.js')).renderProject(await compiled(load, 'waterfall.fluid.json'));
      return { animationGIF: (await load('src/gif.js')).animationGIF, project };
    },
    run: ({ animationGIF, project }) => { const gif = animationGIF(project, undefined, { scale: 4 }); return { frames: gif.frames, hash: hash(gif.data) }; } },
  { id: 'live/waterfall', what: 'createLiveFluid: step and render 30 frames',
    setup: async load => ({ live: (await load('src/fluid.js')).createLiveFluid(example('waterfall.fluid.json')) }),
    run: ({ live }) => { let shown; for (let i = 0; i < 30; i++) { live.step(); shown = live.render(); } return { frames: 30, hash: hash(shown.rgba) }; } }
];

const args = process.argv.slice(2);
const option = (name, fallback) => { const at = args.indexOf(name); return at === -1 ? fallback : args[at + 1]; };
const count = (name, fallback, min = 1) => {
  const value = Number(option(name, fallback));
  if (!Number.isInteger(value) || value < min) { console.error(`${name} expects a whole number of at least ${min}`); process.exit(2); }
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
    let result;
    for (let i = 0; i < warmup; i++) result = await spec.run(state);
    for (let i = 0; i < runs; i++) { const start = performance.now(); result = await spec.run(state); times.push(performance.now() - start); }
    times.sort((a, b) => a - b);
    Object.assign(report, { frames: result.frames, hash: result.hash, ms: times.map(t => Math.round(t * 1000) / 1000) });
  }
  report.peakRssMB = Math.round(process.resourceUsage().maxRSS / 1024 * 10) / 10;
  console.log(JSON.stringify(report));
}

const median = list => { const sorted = [...list].sort((a, b) => a - b), mid = sorted.length >> 1; return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2; };
const round = (n, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
function spawnCase(id, root, runs, warmup) {
  const done = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', id, '--root', root, '--runs', String(runs), '--warmup', String(warmup)], { encoding: 'utf8', timeout: 300_000, maxBuffer: 1 << 24 });
  const line = done.stdout?.trim().split('\n').at(-1);
  try { return JSON.parse(line); } catch { return { id, root, error: (done.stderr || done.error?.message || `exit ${done.status}`).trim().split('\n').slice(0, 3).join(' ') }; }
}
const describe = root => {
  const git = (...command) => { try { return execFileSync('git', command, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
  return { root, commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain', '--untracked-files=no') ? true : false };
};

async function main() {
  if (args[0] === '--child') return child(option('--child'), option('--root'), count('--runs', 5), count('--warmup', 2, 0));
  const only = option('--only', null)?.split(',').filter(Boolean), base = option('--compare', null), out = option('--json', null);
  const cases = CASES.filter(item => !only || only.some(prefix => item.id.startsWith(prefix)));
  if (args.includes('--list')) { for (const item of CASES) console.log(`${item.id.padEnd(26)} ${item.what}`); return; }
  if (!cases.length) { console.error(`no case starts with ${only.join(' or ')}; --list shows them`); process.exit(2); }
  const runs = count('--runs', 5), warmup = count('--warmup', 2, 0), rounds = count('--rounds', base ? 5 : 1);
  const sides = base ? [{ label: 'A', ...describe(path.resolve(base)) }, { label: 'B', ...describe(here) }] : [{ label: 'B', ...describe(here) }];
  const report = {
    node: process.version, platform: `${os.platform()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model.trim(), cpus: os.cpus().length,
    memoryGB: Math.round(os.totalmem() / 1024 ** 3), runs, warmup, rounds, sides, baseline: {}, cases: {}
  };
  for (const side of sides) report.baseline[side.label] = spawnCase('baseline', side.root, 1, 0).peakRssMB ?? null;
  console.log(`Node ${process.version}, ${report.cpu}; ${runs} timed runs after ${warmup} warm-up runs, ${rounds} process${rounds === 1 ? '' : 'es'} per case${base ? ' and side, A and B interleaved' : ''}.`);
  for (const side of sides) console.log(`${side.label}: ${side.root} at ${side.commit?.slice(0, 12) ?? 'unknown'}${side.dirty ? ' (uncommitted changes)' : ''}; baseline ${report.baseline[side.label]} MB`);
  console.log(base ? `\n${'case'.padEnd(26)} ${'frames'.padStart(6)} ${'A ms'.padStart(9)} ${'B ms'.padStart(9)} ${'change'.padStart(7)}  ${'A MB'.padStart(6)} ${'B MB'.padStart(6)}  verdict`
    : `\n${'case'.padEnd(26)} ${'frames'.padStart(6)} ${'median ms'.padStart(10)} ${'ms/frame'.padStart(9)} ${'range ms'.padStart(17)} ${'peak MB'.padStart(8)}  output`);
  for (const item of cases) {
    const results = Object.fromEntries(sides.map(side => [side.label, []]));
    // Alternate which side goes first in each round, so drift (heat, background work) falls on both alike.
    for (let r = 0; r < rounds; r++) for (const side of (r % 2 ? [...sides].reverse() : sides)) results[side.label].push(spawnCase(item.id, side.root, runs, warmup));
    const summary = {};
    for (const [label, list] of Object.entries(results)) {
      const failed = list.find(entry => entry.error);
      if (failed) { summary[label] = { error: failed.error }; continue; }
      const medians = list.map(entry => median(entry.ms)), hashes = [...new Set(list.map(entry => entry.hash))];
      summary[label] = { frames: list[0].frames, medianMs: round(median(medians), 3), minMs: round(Math.min(...medians), 3), maxMs: round(Math.max(...medians), 3), peakRssMB: median(list.map(entry => entry.peakRssMB)), hash: hashes.length === 1 ? hashes[0] : hashes, runsMs: list.map(entry => entry.ms) };
    }
    report.cases[item.id] = summary;
    const b = summary.B, a = summary.A;
    if (!base) {
      console.log(b.error ? `${item.id.padEnd(26)} error: ${b.error}` : `${item.id.padEnd(26)} ${String(b.frames).padStart(6)} ${b.medianMs.toFixed(1).padStart(10)} ${(b.medianMs / b.frames).toFixed(2).padStart(9)} ${`${b.minMs.toFixed(1)}-${b.maxMs.toFixed(1)}`.padStart(17)} ${b.peakRssMB.toFixed(1).padStart(8)}  ${Array.isArray(b.hash) ? 'differs between runs' : b.hash}`);
      continue;
    }
    if (a.error || b.error) { console.log(`${item.id.padEnd(26)} error: ${a.error ? `A: ${a.error}` : ''}${a.error && b.error ? '; ' : ''}${b.error ? `B: ${b.error}` : ''}`); continue; }
    const change = b.medianMs / a.medianMs - 1;
    // A side whose slowest process beat the other's fastest is a measured difference; anything else is within noise.
    // For identical code that happens by chance with probability 2 / C(2n, n) per case: 1 in 10 at 3 processes a side,
    // 1 in 126 at 5 (the default), 1 in 462 at 6.
    const speed = b.maxMs < a.minMs ? 'faster' : b.minMs > a.maxMs ? 'slower' : 'within noise';
    const same = !Array.isArray(a.hash) && !Array.isArray(b.hash) && a.hash === b.hash;
    summary.change = round(change, 4); summary.verdict = speed; summary.sameOutput = same;
    console.log(`${item.id.padEnd(26)} ${String(b.frames).padStart(6)} ${a.medianMs.toFixed(1).padStart(9)} ${b.medianMs.toFixed(1).padStart(9)} ${`${change >= 0 ? '+' : ''}${(change * 100).toFixed(1)}%`.padStart(7)}  ${a.peakRssMB.toFixed(1).padStart(6)} ${b.peakRssMB.toFixed(1).padStart(6)}  ${speed}${same ? '' : '; OUTPUT DIFFERS'}`);
  }
  if (out) { writeFileSync(out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); console.log(`\nSaved ${out}`); }
}
await main();
