import test from 'node:test';
import assert from 'node:assert/strict';
import { renderProject } from '../src/core.js';
import { prepareScene, renderScene } from '../src/scene.js';
import { compileAutotile } from '../src/authoring.js';
import { neighbourMask } from '../src/autotile.js';

// 1×1 tiles, so every scene pixel is one cell and a map reads back as letters.
const palette = { f: '#808080', w: '#ffffff', n: '#404040', c: '#202020', b: '#a05050', x: '#00ff00', y: '#0000ff' };
const tiles = { version: 1, name: 'tiles', width: 1, height: 1, palette, frames: Object.keys(palette).map(key => ({ name: key, ops: [{ op: 'pixel', color: key }] })) };
const byColour = new Map(Object.entries(palette).map(([key, hex]) => [renderProject({ version: 1, name: 'p', width: 1, height: 1, palette, frames: [{ name: 'a', ops: [{ op: 'pixel', color: hex }] }] }).frames[0].data.join(), key]));
const read = view => Array.from({ length: view.height }, (_, y) => Array.from({ length: view.width }, (_, x) => {
  const at = (y * view.width + x) * 4, rgba = [...view.data.subarray(at, at + 4)];
  return rgba[3] ? byColour.get(rgba.join()) ?? '?' : '.';
}).join(''));
const map = (rows, legend, extra = {}, below = 0) => read(renderScene(prepareScene({ format: 'pixelforge-scene', version: 1, name: 'map', width: rows[0].length, height: rows.length + below, background: 'transparent', assets: { tiles },
  instances: [{ asset: 'tiles', at: [0, 0], tilemap: { rows, legend, ...extra } }] })));

test('rule tiles choose by the characters around a cell and may draw into a neighbouring cell', () => {
  const legend = {
    F: { rules: [{ frame: 'f' }, { where: ['.W.', '...', '...'], frame: 'n' }] },
    W: { rules: [{ frame: 'w' }, { where: ['...', '...', '.~.'], frame: 'c', offset: [0, 1] }] }
  };
  // A wall casts a face (n) onto floor below it; a wall with nothing below hangs a cliff (c) into the empty cell.
  assert.deepEqual(map(['WWW', 'FFW', 'W.F'], legend, { empty: '~' }, 1), ['www', 'nnw', 'w.n', 'c..']);
  // Offset outputs draw over the tiles of the cell they land in, whatever order the cells were scanned in.
  assert.deepEqual(map(['F', 'W'], { F: 'f', W: { rules: [{ frame: 'w' }, { frame: 'c', offset: [0, -1] }] } }), ['c', 'w']);
  // stop ends a cell's list once a rule has drawn; classes match any of their members; outside "match" treats cells
  // beyond the map as matching every pattern character.
  const stopped = { F: { rules: [{ where: ['.#.', '...', '...'], frame: 'n', stop: true }, { frame: 'f' }] } };
  assert.deepEqual(map(['WF', 'FF'], { ...stopped, W: 'w' }, { classes: { '#': 'WV' } }), ['wf', 'nf']);
  assert.deepEqual(map(['F'], stopped, { classes: { '#': 'WV' }, outside: 'match' }), ['n']);
  // A class may include the empty character to match empty cells too.
  assert.deepEqual(map(['F.', 'FW'], { F: { rules: [{ where: ['...', '..#', '...'], frame: 'b', stop: true }, { frame: 'f' }] }, W: 'w' }, { empty: '~', classes: { '#': '~W' } }), ['b.', 'bw']);
});

test('variants without a seed show no pattern: no checkerboard, no short period, no fixed diagonal', () => {
  const rows = Array.from({ length: 32 }, () => 'F'.repeat(32));
  // Two variants used to come out as a perfect checkerboard, four as a 4×4 repeat, and every diagonal cell as the first.
  const two = map(rows, { F: { frames: ['x', 'y'] } }), four = map(rows, { F: { frames: ['x', 'y', 'b', 'c'] } });
  const checker = rows.map((row, y) => [...row].map((_, x) => ((x ^ y) & 1 ? 'y' : 'x')).join(''));
  assert.notDeepEqual(two, checker);
  const share = (text, letter) => (text.split(letter).length - 1) / text.length;
  assert.ok(Math.abs(share(two.join(''), 'x') - 0.5) < 0.1, String(share(two.join(''), 'x')));
  for (const period of [2, 4, 8]) {
    assert.ok(four.some(row => [...row].some((c, x) => x + period < row.length && c !== row[x + period])), `rows repeat every ${period}`);
    assert.ok(four.some((row, y) => y + period < four.length && row !== four[y + period]), `columns repeat every ${period}`);
  }
  assert.ok(new Set(four.map((row, i) => row[i])).size > 1, 'every diagonal cell is the same variant');
  // Variants stay a pure function of the position and the seed.
  assert.deepEqual(map(rows, { F: { frames: ['x', 'y'] } }), two);
  assert.notDeepEqual(map(rows, { F: { frames: ['x', 'y'] } }, { seed: 9 }), two);
});

test('rule chances and variant weights are seeded by position, and equal weights pick as no weights do', () => {
  const rows = Array.from({ length: 16 }, () => 'F'.repeat(16));
  const weighted = map(rows, { F: { frames: ['x', 'y'], weights: [3, 1] } }).join('');
  const ratio = (weighted.split('x').length - 1) / 256;
  assert.ok(ratio > 0.65 && ratio < 0.85, String(ratio));
  assert.deepEqual(map(rows, { F: { frames: ['x', 'y'], weights: [1, 1] } }), map(rows, { F: { frames: ['x', 'y'] } }));
  const chancy = map(rows, { F: { rules: [{ frame: 'f' }, { frame: 'b', chance: 0.25 }] } }).join('');
  const share = (chancy.split('b').length - 1) / 256;
  assert.ok(share > 0.15 && share < 0.35, String(share));
  assert.deepEqual(map(rows, { F: { rules: [{ frame: 'f' }, { frame: 'b', chance: 0.25 }] } }).join(''), map(rows, { F: { rules: [{ frame: 'f' }, { frame: 'b', chance: 0.25 }] } }).join(''));
  assert.notDeepEqual(map(rows, { F: { rules: [{ frame: 'f' }, { frame: 'b', chance: 0.25 }] } }, { seed: 9 }), map(rows, { F: { rules: [{ frame: 'f' }, { frame: 'b', chance: 0.25 }] } }));
});

test('tilemap legends and rules fail with paths that name the entry', () => {
  const fails = (legend, extra, pattern) => assert.throws(() => map(['F'], legend, extra), pattern);
  fails({ F: { rules: [{ frame: 'f', where: ['...', '...'] }] } }, {}, /legend\["F"\]\.rules\[0\]\.where: expected three rows of three characters/);
  fails({ F: { rules: [{ frame: 'f', offset: [9, 0] }] } }, {}, /rules\[0\]\.offset: expected \[columns, rows\], each a whole number from -8 to 8/);
  fails({ F: { rules: [{ frame: 'f', wher: [] }] } }, {}, /rules\[0\]\.wher: unknown or null field/);
  fails({ F: { rules: [] } }, {}, /rules: expected 1–32 rules/);
  fails({ F: { frames: ['f', 'b'], weights: [1] } }, {}, /weights: expected 2 whole-number weights from 1 to 1000, one per name/);
  fails({ F: 'f' }, { empty: 'F' }, /empty: choose one character, not a dot, space or legend key/);
  fails({ F: 'f' }, { classes: { F: 'W' } }, /classes\["F"\]: class keys are single characters other than/);
  fails({ F: { rules: [{ frame: 'missing' }] } }, {}, /rows\[0\]\[0\]: frame "missing" does not exist/);
  fails({ F: { rules: [{ frame: 'f', frames: ['f'] }] } }, {}, /use exactly one of frame, frames, animation or animations/);
});

test('a recipe tilemap composes symbols and autotile templates, and later operations see the composed result', () => {
  // A 2px autotile template: outer corners o, edges e, fill i, inner corners n (each quarter is one pixel).
  const template = ['..nn', '..nn', 'oeeo', 'eiie', 'eiie', 'oeeo'];
  const recipe = (ops, width = 8, height = 6) => renderProject({ version: 1, name: 'room', width, height, palette: { o: '#ff0000', e: '#00ff00', i: '#0000ff', n: '#ffff00', g: '#808080', m: '#008000' },
    symbols: { wall: template, floor: ['gg', 'gg'] }, frames: [{ name: 'a', ops }] });
  const rows = ['WWWW', 'WFFW', 'WWWW'];
  const composed = recipe([{ op: 'tilemap', tile: [2, 2], rows, legend: { W: { template: 'wall', autotile: 'blob' }, F: 'floor' } }]);
  // The same picture drawn cell by cell with explicit autotile operations and the masks a scene would compute.
  const explicit = recipe(rows.flatMap((row, y) => [...row].map((char, x) => char === 'F' ? { op: 'stamp', symbol: 'floor', x: x * 2, y: y * 2 }
    : { op: 'autotile', symbol: 'wall', x: x * 2, y: y * 2, mask: neighbourMask('blob', (dx, dy) => rows[y + dy]?.[x + dx] === 'W') })));
  assert.deepEqual(composed.frames[0].data, explicit.frames[0].data);
  // A dither over the floor colour now follows the composed floor exactly.
  const mossy = recipe([{ op: 'tilemap', tile: [2, 2], rows, legend: { W: { template: 'wall', autotile: 'blob' }, F: 'floor' } }, { op: 'dither', color: 'm', density: 1, over: 'g' }]);
  const pixel = (project, x, y) => [...project.frames[0].data.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 4)];
  assert.deepEqual([pixel(mossy, 2, 2), pixel(mossy, 0, 0)], [[0, 128, 0, 255], pixel(composed, 0, 0)]);
  // x/y move the whole map; rules and offsets work as in scenes.
  const moved = recipe([{ op: 'tilemap', x: 1, y: 1, tile: [2, 2], rows: ['F'], legend: { F: { rules: [{ symbol: 'floor' }, { symbol: 'floor', offset: [1, 0] }] } } }]);
  assert.deepEqual([pixel(moved, 1, 1)[3], pixel(moved, 4, 2)[3], pixel(moved, 5, 2)[3]], [255, 255, 0]);
  assert.throws(() => recipe([{ op: 'tilemap', rows, legend: { W: 'floor', F: 'floor' } }]), /ops\[0\]\.tile: expected \[width, height\]/);
  assert.throws(() => recipe([{ op: 'tilemap', tile: [2, 2], rows, legend: { W: { template: 'wall' }, F: 'floor' } }]), /a template draws the tile its neighbour mask selects; set autotile to blob or cardinal/);
  assert.throws(() => recipe([{ op: 'tilemap', tile: [2, 2], rows, legend: { W: { template: 'floor', autotile: 'blob' }, F: 'floor' } }]), /template "floor": an autotile template is two tiles wide and three tall/);
  assert.throws(() => recipe([{ op: 'tilemap', tile: [2, 2], rows, legend: { W: 'stone', F: 'floor' } }]), /ops\[0\]\.rows\[0\]\[0\]: symbol "stone" does not exist/);
});

test('autotile variants may redraw the set from their own template', () => {
  const base = ['..nn', '..nn', 'oeeo', 'eiie', 'eiie', 'oeeo'], cracked = base.map(row => row.replaceAll('i', 'k'));
  const source = { format: 'pixelforge-autotile', version: 1, name: 'wall', tile: 2, palette: { o: '#f00', e: '#0f0', i: '#00f', n: '#ff0', k: '#000' }, template: base, frame: 'wall-{mask}-{variant}', variants: [{ name: 'plain' }, { name: 'cracked', template: cracked }] };
  const { recipe } = compileAutotile(source);
  assert.deepEqual(Object.keys(recipe.symbols), ['template', 'template-cracked']);
  assert.deepEqual(recipe.frames.find(f => f.name === 'wall-255-cracked').ops, [{ op: 'autotile', symbol: 'template-cracked', mask: 255 }]);
  assert.equal(recipe.frames.find(f => f.name === 'wall-255-plain').ops[0].symbol, 'template');
  const project = renderProject(recipe), fill = name => [...project.frames.find(f => f.name === name).data.subarray(0, 4)];
  assert.deepEqual([fill('wall-255-plain'), fill('wall-255-cracked')], [[0, 0, 255, 255], [0, 0, 0, 255]]);
  assert.throws(() => compileAutotile({ ...source, variants: [{ name: 'small', template: ['..'] }] }), /variants\[0\]\.template: expected 6 rows of 4 characters/);
});
