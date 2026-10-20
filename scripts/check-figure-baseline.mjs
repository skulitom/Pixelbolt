// Pin every existing on-disk recipe, including recipes embedded in scene/source JSON.
// Snapshot mode writes a NEW manifest; checking never updates expected hashes.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject } from '../src/core.js';
import { compilePoses } from '../src/authoring.js';
import { resolveReferences } from '../src/resolve.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
async function files(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await files(file));
    else if (entry.name.endsWith('.json') && !entry.name.startsWith('figures-baseline')) found.push(file);
  }
  return found.sort();
}
async function snapshot() {
  const recipes = {};
  const walk = async (value, file, suffix = '') => {
    if (!value || typeof value !== 'object') return;
    const isPose = value.format === 'pixelforge-poses';
    if (isPose || (!value.format && value.version === 1 && value.width && value.height && Array.isArray(value.frames))) {
      const { document } = await resolveReferences(value, { baseDir: path.dirname(file) });
      const compiled = isPose ? compilePoses(document) : null, recipe = compiled?.recipe ?? document;
      const project = renderProject(recipe);
      recipes[path.relative(root, file).replaceAll('\\', '/') + suffix] = {
        width: project.width, height: project.height,
        frames: project.frames.map(frame => ({ name: frame.name, rgba: sha(frame.data) })),
        timing: sha(JSON.stringify(project.animations)),
        ...(compiled && { compiled: sha(JSON.stringify(compiled)) })
      };
      return;
    }
    for (const [key, child] of Object.entries(value)) await walk(child, file, `${suffix}/${key}`);
  };
  for (const dir of ['examples', 'showcase', 'test/fixtures']) {
    for (const file of await files(path.join(root, dir))) await walk(JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')), file);
  }
  return recipes;
}
const at = process.argv.indexOf('--snapshot');
if (at >= 0) {
  if (!process.argv[at + 1]) throw new Error('--snapshot needs a new manifest path');
  const recipes = await snapshot();
  await writeFile(process.argv[at + 1], JSON.stringify({
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), recipes
  }, null, 2) + '\n', { flag: 'wx' });
  console.log(`Recorded ${Object.keys(recipes).length} recipes before renderer changes.`);
} else {
  const baseline = JSON.parse(await readFile(new URL('../test/fixtures/figures-baseline.json', import.meta.url), 'utf8'));
  const actual = await snapshot(), failures = [];
  for (const [file, expected] of Object.entries(baseline.recipes)) {
    if (JSON.stringify(actual[file]) !== JSON.stringify(expected)) failures.push(file);
  }
  if (failures.length) throw new Error(`Baseline changed:\n${failures.join('\n')}`);
  console.log(`Unchanged: ${Object.keys(baseline.recipes).length} recipes, ${Object.values(baseline.recipes).reduce((n, r) => n + r.frames.length, 0)} RGBA frame hashes and all pose compiler metadata.`);
}
