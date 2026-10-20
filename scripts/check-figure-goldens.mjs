// New figure goldens are separate from the immutable M0 legacy baseline.
// --snapshot <new.json> writes a new file; it never replaces an accepted golden.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { compilePoses } from '../src/authoring.js';
import { renderProject } from '../src/core.js';
import { skinkRig, heroRig, bossRig, plainRig } from './figure-rigs.mjs';
import assert from 'node:assert/strict';

const hash = data => createHash('sha256').update(data).digest('hex');
export function figureSnapshot(source) {
  const compiled = compilePoses(source), project = renderProject(compiled.recipe);
  return {
    compiled: hash(JSON.stringify(compiled)),
    frames: project.frames.map(frame => ({ name: frame.name, rgba: hash(frame.data) }))
  };
}
export const figureSources = { R1: skinkRig, R2: heroRig, R3: bossRig, plain: plainRig };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const actual = Object.fromEntries(Object.entries(figureSources).map(([name, source]) => [name, figureSnapshot(source())]));
  const at = process.argv.indexOf('--snapshot');
  if (at >= 0) {
    if (!process.argv[at + 1]) throw new Error('--snapshot needs a new JSON path');
    await writeFile(process.argv[at + 1], JSON.stringify(actual, null, 2) + '\n', { flag: 'wx' });
  } else {
    const expected = JSON.parse(await readFile(new URL('../test/fixtures/figure-goldens.json', import.meta.url), 'utf8'));
    assert.deepEqual(actual, expected);
    console.log(`Unchanged new figures: ${Object.keys(actual).join(', ')} (compiled JSON and every RGBA frame).`);
  }
}
