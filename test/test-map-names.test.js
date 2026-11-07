import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderProject } from '../src/core.js';
import { compileAutotile } from '../src/authoring.js';

// Every compiled tile set comes with a test map, which MCP pixel_compile always draws. Its name was the set's with
// "-test-map" added, so a set named with 56 to 64 characters (a valid name) drew no test map, and pixel_compile failed.
const example = async name => JSON.parse(await readFile(new URL(`../examples/${name}.autotile.json`, import.meta.url), 'utf8'));

test('a tile set with a name of up to 64 characters draws its test map, plain or layered', async () => {
  for (const base of [await example('ground'), await example('shore')]) {
    for (const length of [base.name.length, 55, 56, 60, 64]) {
      const name = length === base.name.length ? base.name : `t${'x'.repeat(length - 1)}`, { recipe, preview } = compileAutotile({ ...base, name });
      assert.equal(recipe.name, name);
      // Names that fit keep the name they always had; longer ones are cut to fit.
      assert.equal(preview.name, `${name.slice(0, 55)}-test-map`, `${base.name} at ${length}`);
      assert.equal(renderProject(preview).frames.length, 1, `${base.name} at ${length}`);
    }
  }
});
