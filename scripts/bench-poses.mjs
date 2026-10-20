// Run separately from the test suite for uncontended reference-machine measurements.
// Optional --out <new.json> preserves a run; existing evidence is never overwritten.
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compilePoses, expandPoses } from '../src/authoring.js';
import { renderProject } from '../src/core.js';
import { rasterizeBone, rasterizeMass } from '../src/craft.js';
import { stampRig, mergedStamps, structuralFixture } from './pose-fixtures.mjs';
import { skinkRig, heroRig, bossRig } from './figure-rigs.mjs';
import { solveReach } from '../src/pose-geometry.js';
import { inspectMotion } from '../src/motion.js';

const root = fileURLToPath(new URL('../', import.meta.url));
export function measure(run, count = 15) {
  for (let i = 0; i < 3; i++) run();
  const times = [];
  for (let i = 0; i < count; i++) { const start = performance.now(); run(); times.push(performance.now() - start); }
  times.sort((a, b) => a - b);
  const round = n => Math.round(n * 1000) / 1000;
  return { medianMs: round(times[Math.floor(count / 2)]), p95Ms: round(times[Math.ceil(count * .95) - 1]) };
}

async function main() {
  const skink = JSON.parse(await readFile(new URL('../examples/quality/skink.poses.json', import.meta.url), 'utf8'));
  const cases = [['stamp-skink', skink], ['stamp-64', stampRig(64, 16, 24)],
    ['stamp-128', stampRig(128, 32, 96)], ['stamp-256', stampRig(256, 64, 32)],
    ['structural-parts-M1', structuralFixture()], ['R1-skink', skinkRig()], ['R2-hero', heroRig()], ['R3-boss', bossRig()]];
  const bone = { length: 64, width: [16, 16], base: 2, outline: 'k' }, rasterOptions = { ramp: ['a', 'b', 'c', 'd'] };
  const coldStart = performance.now(); rasterizeBone(bone, rasterOptions); const coldBoneMs = performance.now() - coldStart;
  const report = {
    node: process.version, platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0].model, memoryGB: Math.round(os.totalmem() / 1024 ** 3),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty: Boolean(execFileSync('git', ['diff', '--name-only'], { cwd: root, encoding: 'utf8' }).trim()),
    warmups: 3, runs: 15, boneFirstCallMs: Math.round(coldBoneMs * 1000) / 1000,
    boneCache: 'Warm repeated calls copy an immutable cached drawing. The cache is bounded to 128 entries / 1 MiB; first-call time is reported separately.',
    boneBeforeWorkflow: measure(() => rasterizeBone(bone, rasterOptions)), cases: {}
  };
  for (const [name, source] of cases) {
    try {
      const { recipe, metadata } = compilePoses(source), merged = mergedStamps(recipe);
      const project = renderProject(recipe, { stats: true });
      const expected = renderProject(merged);
      if (project.frames.some((frame, i) => !Buffer.from(frame.data).equals(Buffer.from(expected.frames[i].data)))) throw new Error('merged-op reference pixels differ');
      report.cases[name] = {
        canvas: [source.width, source.height], instances: source.poses[0].parts.length, frames: recipe.frames.length,
        compile: measure(() => compilePoses(source)), render: measure(() => renderProject(recipe)),
        merged: measure(() => renderProject(merged)), recipeBytes: Buffer.byteLength(JSON.stringify(recipe)),
        ...(project.work && { work: project.work }), mergedPixelsIdentical: true
      };
      if (name.startsWith('R')) report.cases[name].motionReview = measure(() => inspectMotion(project, { animation: 'run', metadata, ...(source.motions ? {} : { speed: 48 }) }));
      if (source.motions) report.cases[name].expansion = measure(() => expandPoses(source));
    } catch (error) { report.cases[name] = { error: error.message }; }
  }
  report.primitives = {
    bone: measure(() => rasterizeBone(bone, rasterOptions)),
    boneOblique: measure(() => rasterizeBone(bone, { ...rasterOptions, angle: 37 })),
    mass: measure(() => rasterizeMass({ size: [12, 7], base: 2, outline: 'k' }, { ...rasterOptions, squash: .5 })),
    reach: measure(() => solveReach({ length: 16 }, { length: 12 }, [14, 16], { rest: [90, 40] }))
  };
  report.R3Heap = JSON.parse(execFileSync(process.execPath, ['--max-old-space-size=48', '--max-semi-space-size=4', 'scripts/bench-figure-memory.mjs'], { cwd: root, encoding: 'utf8' }));
  const text = JSON.stringify(report, null, 2) + '\n', at = process.argv.indexOf('--out');
  if (at >= 0) {
    if (!process.argv[at + 1]) throw new Error('--out needs a new JSON path');
    await writeFile(process.argv[at + 1], text, { flag: 'wx' });
  }
  process.stdout.write(text);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
