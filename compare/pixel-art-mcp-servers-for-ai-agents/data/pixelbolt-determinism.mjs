// Renders every plain recipe in examples/ and examples/quality/ twice, and compiles every fluid preset twice, through
// Pixelbolt's CLI, timing each run and comparing SHA-256 hashes of all output files between the two runs.
// A plain recipe is a JSON file with frames and no "format" field (sources, scenes and overlays are skipped).
// Usage: node pixelbolt-determinism.mjs <pixelbolt-clone-or-unpacked-npm-package> <fresh-work-dir> <result.json>
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { cpus, release } from 'node:os';
import { join, relative } from 'node:path';

const [clone, work, resultPath] = process.argv.slice(2);
mkdirSync(work, { recursive: true });
const cli = join(clone, 'bin', 'pixelbolt.js');
function run(args) {
  const t0 = process.hrtime.bigint();
  execFileSync(process.execPath, [cli, ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
  return Number(process.hrtime.bigint() - t0) / 1e6;
}
function hashTree(dir) {
  const out = {};
  (function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else out[relative(dir, p).replaceAll('\\', '/')] = createHash('sha256').update(readFileSync(p)).digest('hex'); } })(dir);
  return out;
}
function hashFile(p) { return createHash('sha256').update(readFileSync(p)).digest('hex'); }
function sourceId(dir) {
  // A git clone is named by its commit; an unpacked npm package (no .git) by its name and version.
  if (existsSync(join(dir, '.git'))) return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  return `npm ${pkg.name}@${pkg.version}`;
}
function isPlainRecipe(p) {
  try { const j = JSON.parse(readFileSync(p, 'utf8')); return j && !j.format && Array.isArray(j.frames); } catch { return false; }
}

const folders = ['examples', join('examples', 'quality')];
const recipes = folders.flatMap((d) => readdirSync(join(clone, d)).filter((f) => f.endsWith('.json') && isPlainRecipe(join(clone, d, f))).map((f) => join(d, f)));
const fluids = readdirSync(join(clone, 'examples')).filter((f) => f.endsWith('.fluid.json'));
const commit = sourceId(clone);
const result = { commit, node: process.version, platform: `${process.platform} ${process.arch} ${release()}`, cpu: cpus()[0]?.model?.trim(), renders: [], fluids: [] };
for (const rel of recipes) {
  const name = rel.replaceAll('\\', '/').replace(/\.json$/, '').replaceAll('/', '__');
  const a = join(work, 'render-a', name), b = join(work, 'render-b', name);
  const msA = run(['render', join(clone, rel), '--out', a]);
  const msB = run(['render', join(clone, rel), '--out', b]);
  const ha = hashTree(a), hb = hashTree(b);
  const files = Object.keys(ha).length;
  const identical = files === Object.keys(hb).length && Object.keys(ha).every((k) => ha[k] === hb[k]);
  result.renders.push({ recipe: rel.replaceAll('\\', '/'), files, identical, msA: Math.round(msA), msB: Math.round(msB) });
}
for (const f of fluids) {
  const name = f.replace(/\.fluid\.json$/, '');
  mkdirSync(join(work, 'fluid-a'), { recursive: true }); mkdirSync(join(work, 'fluid-b'), { recursive: true });
  const a = join(work, 'fluid-a', `${name}.json`), b = join(work, 'fluid-b', `${name}.json`);
  const msA = run(['compile', join(clone, 'examples', f), '--out', a]);
  const msB = run(['compile', join(clone, 'examples', f), '--out', b]);
  const recipe = JSON.parse(readFileSync(a, 'utf8'));
  result.fluids.push({ source: `examples/${f}`, frames: recipe.frames?.length ?? null, size: `${recipe.width}x${recipe.height}`, identical: hashFile(a) === hashFile(b), msA: Math.round(msA), msB: Math.round(msB), recipeSha256: hashFile(a) });
}
writeFileSync(resultPath, JSON.stringify(result, null, 1));
console.log(`${commit}: renders ${result.renders.length}, all identical: ${result.renders.every((r) => r.identical)}; fluids ${result.fluids.length}, all identical: ${result.fluids.every((r) => r.identical)}`);
for (const r of result.renders) console.log(`render ${r.recipe}: ${r.files} files, ${r.msA}/${r.msB} ms, identical=${r.identical}`);
for (const r of result.fluids) console.log(`compile ${r.source}: ${r.frames} frames ${r.size}, ${r.msA}/${r.msB} ms, identical=${r.identical}`);
