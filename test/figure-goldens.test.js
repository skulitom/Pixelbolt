import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { figureSnapshot, figureSources } from '../scripts/check-figure-goldens.mjs';

const expected = JSON.parse(await readFile(new URL('./fixtures/figure-goldens.json', import.meta.url), 'utf8'));
for (const [name, source] of Object.entries(figureSources)) test(`${name} compiled JSON and every RGBA frame match the accepted figure golden`, () => {
  assert.deepEqual(figureSnapshot(source()), expected[name]);
});
// R1's 50 ms warmed compile budget is measured by `npm run bench -- --budgets` (poses/skink-rig), which reports a case
// over budget without failing CI; the goldens above already hold every byte the compile makes.
