import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

// The renderer, compilers and exports must give the same pixels in every JavaScript engine (the studio and the
// playground draw in browsers), so pixel code uses only + − × ÷, sqrt and squares, the polynomial trigonometry in
// craft.js and shapes.js, and seeded hashing. ECMAScript lets engines round the functions below and other powers
// differently (`x ** 2` is x * x everywhere), and Math.random is unseeded.
const ENGINE_DEPENDENT = /Math\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log2|log10|log1p|pow|cbrt|hypot|random)\s*\(|[\w)\]]\s*\*\*\s*(?!2(?![\w.]))[\w(.]/;

test('no source module uses maths that engines may round differently', async () => {
  const folder = new URL('../src/', import.meta.url), files = (await readdir(folder)).filter(name => name.endsWith('.js'));
  assert.ok(files.length > 20);
  for (const file of files) {
    const lines = (await readFile(new URL(file, folder), 'utf8')).split('\n');
    const found = lines.map((line, index) => ({ line: line.replace(/\/\/.*$/, ''), at: index + 1 })).filter(({ line }) => ENGINE_DEPENDENT.test(line));
    assert.deepEqual(found.map(({ at }) => `${file}:${at}`), [], `${file} uses engine-dependent maths`);
  }
});
