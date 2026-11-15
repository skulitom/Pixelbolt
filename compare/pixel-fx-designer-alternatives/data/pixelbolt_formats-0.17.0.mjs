// For the "Pixel FX Designer alternatives" page: compiles every shipped example of Pixelbolt's non-fluid simulation
// formats (rigid bodies, falling-sand powder, crystals, waves) and its particle and shape-layer effects (fx) twice, each in its own process, and records what the
// compiler reports, so the page's limits can say which kinds of simulation a release has. Fluid presets are measured
// by pixelfx_measure-0.17.0.mjs.
// Usage: node pixelbolt_formats-0.17.0.mjs <pixelbolt-package-or-clone> <fresh-work-dir> <result.json>
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, mkdirSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [root, work, resultPath] = process.argv.slice(2);
if (existsSync(work)) throw new Error(`work dir must be fresh: ${work}`);
mkdirSync(work, { recursive: true });
const cli = join(root, 'bin', 'pixelbolt.js');
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const kinds = ['bodies', 'powder', 'crystal', 'wave', 'fx'];
const SHAPES = ['aura', 'beam', 'bolt', 'burst', 'glyph', 'ring', 'slash', 'star', 'stream', 'trail'];
const result = { version: pkg.version, node: process.version, formats: {} };
for (const kind of kinds) {
  const files = readdirSync(join(root, 'examples')).filter((f) => f.endsWith(`.${kind}.json`)).sort();
  result.formats[kind] = [];
  for (const f of files) {
    const name = f.slice(0, -`.${kind}.json`.length);
    const source = JSON.parse(readFileSync(join(root, 'examples', f), 'utf8'));
    const runs = [];
    for (const r of ['a', 'b']) {
      const dir = join(work, r, kind); mkdirSync(dir, { recursive: true });
      const recipe = join(dir, `${name}.json`), meta = join(dir, `${name}.meta.json`);
      const t0 = process.hrtime.bigint();
      const out = JSON.parse(execFileSync(process.execPath, [cli, 'compile', join(root, 'examples', f), '--out', recipe, '--metadata', meta], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
      runs.push({ ms: Math.round(Number(process.hrtime.bigint() - t0) / 1e6), out, recipeSha256: sha(recipe), metadataSha256: sha(meta) });
    }
    const metadata = JSON.parse(readFileSync(join(work, 'a', kind, `${name}.meta.json`), 'utf8'));
    const effects = Object.entries(metadata.effects ?? {}).map(([k, v]) => ({
      effect: k, kind: v.kind ?? null, frames: v.frames ?? null,
      keys: Object.keys(v).sort(),
      bodies: Array.isArray(v.bodies) ? v.bodies.length : (v.bodies && typeof v.bodies === 'object' ? Object.keys(v.bodies).length : null),
    }));
    const srcEffects = Object.values(source.effects ?? {});
    result.formats[kind].push({
      example: `examples/${f}`, format: source.format, width: runs[0].out.width, height: runs[0].out.height, frames: runs[0].out.frames,
      sourceUses: {
        joints: srcEffects.some((e) => Array.isArray(e.joints) && e.joints.length),
        ropes: srcEffects.some((e) => Array.isArray(e.ropes) && e.ropes.length),
        cloths: srcEffects.some((e) => Array.isArray(e.cloths) && e.cloths.length),
        shapeLayers: kind === 'fx' ? SHAPES.filter((k) => JSON.stringify(source).includes(`"kind":"${k}"`)) : [],
      },
      compileMs: runs.map((r) => r.ms), identical: runs[0].recipeSha256 === runs[1].recipeSha256 && runs[0].metadataSha256 === runs[1].metadataSha256,
      recipeBytes: statSync(join(work, 'a', kind, `${name}.json`)).size, warnings: runs[0].out.warnings ?? [], effects,
    });
    const p = result.formats[kind].at(-1);
    console.log(`${kind} ${name}: ${p.width}x${p.height} ${p.frames} frames, ${p.compileMs.join('/')} ms, identical=${p.identical}, joints=${p.sourceUses.joints} ropes=${p.sourceUses.ropes} cloths=${p.sourceUses.cloths}`);
  }
}
writeFileSync(resultPath, JSON.stringify(result, null, 1) + '\n');
console.log(Object.entries(result.formats).map(([k, v]) => `${k}: ${v.length} examples, all identical ${v.every((p) => p.identical)}`).join('; '));
