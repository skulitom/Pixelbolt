// A tile set's own preview map (preview.rows) holds at most 256 tiles a row, as a scene's tilemap does. A wider row
// used to pass compile's checks whenever its pixels fit 4096 a side (a tile under 16 pixels), and then the preview's
// render failed with an error naming project.frames[0].ops[0].rows, a path the source never wrote (P-189).
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderProject, compileAutotile } from '../src/index.js';

const blob = { format: 'pixelforge-autotile', version: 1, name: 'wide', tile: 4, frame: 'wide-{mask}', palette: { g: '#33aa33' }, terrain: { fill: { color: 'g' } } };
const layered = { format: 'pixelforge-autotile', version: 1, name: 'wide', tile: 4, frame: 'wide-{corners}', palette: { g: '#33aa33', b: '#885533' },
  layers: [{ name: 'grass', key: 'g', terrain: { fill: { color: 'g' } } }, { name: 'dirt', key: 'd', terrain: { fill: { color: 'b' } } }] };
const refused = width => error => error.path === 'autotile.preview.rows' && error.message === `autotile.preview.rows: rows are ${width} characters wide; a preview map holds at most 256 tiles a row (and 256 rows), as a scene's tilemap does`;

test('a preview map 256 tiles wide compiles and its preview renders, for a plain and a layered set', () => {
  for (const [source, rows] of [[blob, ['#'.repeat(256), '.'.repeat(256)]], [layered, ['g'.repeat(256), 'd'.repeat(256)]]]) {
    const made = compileAutotile({ ...source, preview: { rows } });
    assert.deepEqual([made.preview.width, made.preview.height], [1024, 8]);
    const drawn = renderProject(made.preview).frames[0];
    assert.equal(drawn.data.length, 1024 * 8 * 4);
  }
});

test('a preview row wider than 256 tiles is refused at compile, by the path the source wrote', () => {
  for (const width of [257, 1024]) {
    assert.throws(() => compileAutotile({ ...blob, preview: { rows: ['#'.repeat(width)] } }), refused(width));
    assert.throws(() => compileAutotile({ ...layered, preview: { rows: ['g'.repeat(width), 'd'.repeat(width)] } }), refused(width));
  }
  // Rows of different widths keep their own message, and a wide row with a character the set doesn't draw is refused for its width first.
  assert.throws(() => compileAutotile({ ...blob, preview: { rows: ['#'.repeat(257), '#'.repeat(256)] } }), /autotile\.preview\.rows\[1\]: all rows must be 257 characters wide/);
  assert.throws(() => compileAutotile({ ...blob, preview: { rows: ['x'.repeat(300)] } }), refused(300));
  // At 16 pixels a tile the picture's own cap (4096 a side) and the row cap meet: 256 tiles fit, 257 are refused for the row.
  assert.equal(compileAutotile({ ...blob, tile: 16, preview: { rows: ['#'.repeat(256)] } }).preview.width, 4096);
  assert.throws(() => compileAutotile({ ...blob, tile: 16, preview: { rows: ['#'.repeat(257)] } }), refused(257));
});
