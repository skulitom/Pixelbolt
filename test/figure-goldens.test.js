import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { figureSnapshot, figureSources } from '../scripts/check-figure-goldens.mjs';
import { compilePoses } from '../src/authoring.js';
import { skinkRig } from '../scripts/figure-rigs.mjs';

const expected = JSON.parse(await readFile(new URL('./fixtures/figure-goldens.json', import.meta.url), 'utf8'));
for (const [name, source] of Object.entries(figureSources)) test(`${name} compiled JSON and every RGBA frame match the accepted figure golden`, () => {
  assert.deepEqual(figureSnapshot(source()), expected[name]);
});
test('R1 warmed compilation stays within its 50 ms CI budget', () => {
  const source = skinkRig(), times = [];
  compilePoses(source);
  for (let i = 0; i < 5; i++) { const start = performance.now(); compilePoses(source); times.push(performance.now() - start); }
  assert.ok(times.sort((a, b) => a - b)[2] <= 50);
});
