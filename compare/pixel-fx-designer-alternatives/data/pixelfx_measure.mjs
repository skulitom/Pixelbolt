// For the "Pixel FX Designer alternative" comparison page.
// Compiles every fluid preset in <clone>/examples through Pixelbolt's CLI, each run in its own process, timing each
// and hashing each compiled recipe. Then renders the first run's recipe twice (sprite sheet, numbered frames, atlas)
// and writes a 1x GIF twice, hashing every file, so repeatability covers the exports too. Records size, frames,
// palette and the compiler's own metadata. pixelfx_check.py then decodes the files independently with Pillow.
// Usage: node pixelfx_measure.mjs <pixelbolt-clone> <fresh-work-dir> <result.json> [compile-runs=3]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { cpus, release, totalmem } from 'node:os';
import { join, relative } from 'node:path';

const [clone, work, resultPath, runsArg] = process.argv.slice(2);
const runs = Number(runsArg ?? 3);
if (existsSync(work)) throw new Error(`work dir must be fresh: ${work}`);
mkdirSync(work, { recursive: true });
const cli = join(clone, 'bin', 'pixelbolt.js');
function run(args) {
  const t0 = process.hrtime.bigint();
  const out = execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { ms: Number(process.hrtime.bigint() - t0) / 1e6, out: JSON.parse(out) };
}
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
function hashTree(dir) {
  const out = {};
  (function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else out[relative(dir, p).replaceAll('\\', '/')] = sha(p); } })(dir);
  return out;
}
const sameTree = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => a[k] === b[k]);

const commit = execFileSync('git', ['-C', clone, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const describe = execFileSync('git', ['-C', clone, 'describe', '--tags', '--always'], { encoding: 'utf8' }).trim();
const pkg = JSON.parse(readFileSync(join(clone, 'package.json'), 'utf8'));
const result = {
  commit, describe, version: pkg.version, node: process.version, platform: `${process.platform} ${process.arch} ${release()}`,
  cpu: cpus()[0]?.model?.trim(), cores: cpus().length, memGiB: Math.round(totalmem() / 2 ** 30), runs, work, presets: [],
};
const presets = readdirSync(join(clone, 'examples')).filter((f) => f.endsWith('.fluid.json')).sort();
for (const f of presets) {
  const name = f.replace(/\.fluid\.json$/, '');
  const source = JSON.parse(readFileSync(join(clone, 'examples', f), 'utf8'));
  const compiles = [];
  for (let i = 1; i <= runs; i++) {
    const dir = join(work, `compile-${i}`); mkdirSync(dir, { recursive: true });
    const recipe = join(dir, `${name}.json`), meta = join(dir, `${name}.meta.json`);
    const { ms } = run(['compile', join(clone, 'examples', f), '--out', recipe, '--metadata', meta]);
    compiles.push({ ms: Math.round(ms), recipeSha256: sha(recipe), metadataSha256: sha(meta), bytes: statSync(recipe).size });
  }
  const recipePath = join(work, 'compile-1', `${name}.json`);
  const recipe = JSON.parse(readFileSync(recipePath, 'utf8'));
  const metadata = JSON.parse(readFileSync(join(work, 'compile-1', `${name}.meta.json`), 'utf8'));
  const renderA = join(work, 'render-a', name), renderB = join(work, 'render-b', name);
  const ra = run(['render', recipePath, '--out', renderA]);
  const rb = run(['render', recipePath, '--out', renderB]);
  mkdirSync(join(work, 'gif-a'), { recursive: true }); mkdirSync(join(work, 'gif-b'), { recursive: true });
  const gifA = join(work, 'gif-a', `${name}.gif`), gifB = join(work, 'gif-b', `${name}.gif`);
  const ga = run(['gif', recipePath, '--out', gifA, '--scale', '1']);
  const gb = run(['gif', recipePath, '--out', gifB, '--scale', '1']);
  const ha = hashTree(renderA), hb = hashTree(renderB);
  const effects = Object.entries(metadata.effects ?? {}).map(([k, v]) => ({ effect: k, kind: v.kind, frames: v.frames, loop: v.loop, seed: v.seed, steps: v.steps, sparks: v.sparks ?? null, particles: v.particles ?? null }));
  result.presets.push({
    preset: `examples/${f}`, name, width: recipe.width, height: recipe.height, frames: recipe.frames.length,
    animations: Object.fromEntries(Object.entries(recipe.animations ?? {}).map(([k, v]) => [k, { frames: v.frames, loop: v.loop }])),
    durationsMs: recipe.frames.map((fr) => fr.duration), palette: recipe.palette,
    sourceEffects: Object.keys(source.effects ?? {}).length, effects,
    compiles, compileIdentical: compiles.every((c) => c.recipeSha256 === compiles[0].recipeSha256 && c.metadataSha256 === compiles[0].metadataSha256),
    render: { msA: Math.round(ra.ms), msB: Math.round(rb.ms), files: Object.keys(ha).length, identical: sameTree(ha, hb), dir: renderA, sheetSha256: ha[`${name}.png`] ?? null },
    gif: { msA: Math.round(ga.ms), msB: Math.round(gb.ms), bytes: statSync(gifA).size, identical: sha(gifA) === sha(gifB), path: gifA, colors: ga.out.colors, partialAlpha: ga.out.partialAlpha, notes: ga.out.notes, warnings: ga.out.warnings, frames: ga.out.frames, duration: ga.out.duration, loop: ga.out.loop },
    recipePath,
  });
  const p = result.presets.at(-1);
  console.log(`${name}: ${p.width}x${p.height} ${p.frames} frames; compile ${compiles.map((c) => c.ms).join('/')} ms identical=${p.compileIdentical}; render ${p.render.files} files identical=${p.render.identical}; gif ${p.gif.bytes} B identical=${p.gif.identical}`);
}
writeFileSync(resultPath, JSON.stringify(result, null, 1));
console.log(`${describe} (${commit.slice(0, 7)}): ${result.presets.length} presets, all compiles identical: ${result.presets.every((p) => p.compileIdentical)}, all renders identical: ${result.presets.every((p) => p.render.identical && p.gif.identical)}`);
