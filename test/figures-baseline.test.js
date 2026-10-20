import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject } from '../src/core.js';
import { compilePoses } from '../src/authoring.js';
import { resolveReferences } from '../src/resolve.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const baseline = JSON.parse(await readFile(new URL('./fixtures/figures-baseline.json', import.meta.url), 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');
// Small groups keep individual checks bounded on CI; together they cover the complete pre-M0 on-disk corpus.
const entries = Object.entries(baseline.recipes);
for (let start = 0; start < entries.length; start += 8) {
  test(`pre-M0 recipe pixels and pose metadata stay byte-identical (${start + 1}–${Math.min(start + 8, entries.length)})`, async () => {
    for (const [reference, expected] of entries.slice(start, start + 8)) {
      const boundary = reference.indexOf('.json') + 5, file = path.join(root, reference.slice(0, boundary));
      let source = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
      for (const key of reference.slice(boundary).split('/').filter(Boolean)) source = source[key];
      const { document } = await resolveReferences(source, { baseDir: path.dirname(file) });
      const compiled = document.format === 'pixelforge-poses' ? compilePoses(document) : null;
      const project = renderProject(compiled?.recipe ?? document);
      assert.deepEqual({
        width: project.width, height: project.height,
        frames: project.frames.map(frame => ({ name: frame.name, rgba: sha(frame.data) })),
        timing: sha(JSON.stringify(project.animations)),
        ...(compiled && { compiled: sha(JSON.stringify(compiled)) })
      }, expected, reference);
    }
  });
}
