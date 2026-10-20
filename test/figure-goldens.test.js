import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { figureSnapshot, figureSources } from '../scripts/check-figure-goldens.mjs';

const expected = JSON.parse(await readFile(new URL('./fixtures/figure-goldens.json', import.meta.url), 'utf8'));
for (const [name, source] of Object.entries(figureSources)) test(`${name} compiled JSON and every RGBA frame match the accepted figure golden`, () => {
  assert.deepEqual(figureSnapshot(source()), expected[name]);
});
