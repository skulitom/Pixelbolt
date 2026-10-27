import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderProject } from '../src/core.js';

// A layer with sort "ground" draws far to near by the row each operation stands on; list order breaks ties.
const NEAR = [255, 0, 0, 255], FAR = [0, 255, 0, 255], THIRD = [0, 0, 255, 255];
const recipe = (layer, extra = {}) => ({
  version: 1, name: 'ground', width: 16, height: 16, palette: { n: '#ff0000', f: '#00ff00', t: '#0000ff' },
  symbols: { tall: ['f', 'f', 'f', 'f', 'f'], short: ['n', 'n'], wide: ['ff', 'ff', 'ff'], tiles: ['tttt', 'tttt', 'tttt', 'tttt', 'tttt', 'tttt'] },
  frames: [{ name: 'still', layers: [layer] }], ...extra
});
const at = (recipe, x, y) => [...renderProject(recipe).frames[0].data.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)];

test('a sorted layer draws what stands nearer over what stands farther, whatever the list order', () => {
  // The near stamp (rows 5–6) is listed first and the far one (rows 1–5) second; they share row 5.
  const ops = [{ op: 'stamp', x: 2, y: 5, symbol: 'short' }, { op: 'stamp', x: 2, y: 1, symbol: 'tall' }];
  assert.deepEqual(at(recipe({ ops }), 2, 5), FAR, 'list order draws the far stamp last');
  assert.deepEqual(at(recipe({ sort: 'ground', ops }), 2, 5), NEAR);
  assert.deepEqual(at(recipe({ sort: 'ground', ops: [...ops].reverse() }), 2, 5), NEAR);
  // Operations on the same row keep list order.
  const level = [{ op: 'pixel', x: 3, y: 3, color: 'n' }, { op: 'pixel', x: 3, y: 3, color: 'f' }];
  assert.deepEqual(at(recipe({ sort: 'ground', ops: level }), 3, 3), FAR);
  assert.deepEqual(at(recipe({ sort: 'ground', ops: [...level].reverse() }), 3, 3), NEAR);
});

test('each operation stands on its lowest drawn row unless it gives ground', () => {
  // Every case draws `far` (green) listed last and `near` (red) listed first; near must win where they meet.
  const meet = (near, far, x, y) => assert.deepEqual(at(recipe({ sort: 'ground', ops: [near, far] }), x, y), NEAR, JSON.stringify(far));
  // A line stands on its lower end, whichever end that is.
  meet({ op: 'rect', x: 0, y: 4, w: 16, h: 3, color: 'n' }, { op: 'line', x: 5, y: 5, x2: 5, y2: 0, color: 'f' }, 5, 5);
  // A line from row 0 down to row 5 stands on row 5, nearer than a rectangle on row 4, so it is drawn over it.
  assert.deepEqual(at(recipe({ sort: 'ground', ops: [{ op: 'line', x: 5, y: 0, x2: 5, y2: 5, color: 'f' }, { op: 'rect', x: 0, y: 3, w: 16, h: 2, color: 'n' }] }), 5, 4), FAR);
  // A rectangle and an ellipse stand on their bottom edge.
  meet({ op: 'rect', x: 0, y: 4, w: 16, h: 3, color: 'n' }, { op: 'rect', x: 0, y: 0, w: 16, h: 6, color: 'f' }, 4, 5);
  meet({ op: 'rect', x: 0, y: 4, w: 16, h: 3, color: 'n' }, { op: 'ellipse', x: 0, y: 0, w: 16, h: 6, color: 'f' }, 8, 5);
  // A grid stands on its bottom row after scale and rotation: 2 × 3 rows scaled by 2 and turned 90° is 4 rows tall.
  meet({ op: 'rect', x: 0, y: 3, w: 16, h: 2, color: 'n' }, { op: 'grid', x: 0, y: 0, rows: ['ff', 'ff', 'ff'], scale: 2, rotate: 90 }, 1, 3);
  meet({ op: 'rect', x: 0, y: 3, w: 16, h: 2, color: 'n' }, { op: 'stamp', x: 0, y: 0, symbol: 'wide', scale: 2, rotate: 270 }, 1, 3);
  // A copy stands on the bottom of the copied rectangle; an autotile on the bottom of its tile (template 4 × 6: tile 2).
  meet({ op: 'rect', x: 0, y: 2, w: 16, h: 2, color: 'n' }, { op: 'copy', x: 0, y: 0, symbol: 'tall', h: 3 }, 0, 2);
  assert.deepEqual(at(recipe({ sort: 'ground', ops: [{ op: 'rect', x: 0, y: 1, w: 16, h: 2, color: 'n' }, { op: 'autotile', x: 0, y: 0, symbol: 'tiles', mask: 0 }] }), 1, 1), NEAR);
  // ground overrides the drawn rows: a tall stamp said to stand on row 0 is drawn first, behind everything.
  meet({ op: 'pixel', x: 2, y: 3, color: 'n' }, { op: 'stamp', x: 2, y: 1, symbol: 'tall', ground: 0 }, 2, 3);
  // Text needs ground and is ordered by it.
  meet({ op: 'rect', x: 0, y: 0, w: 16, h: 16, color: 'n' }, { op: 'text', x: 1, y: 2, text: 'H', color: 'f', ground: -1 }, 1, 3);
  assert.deepEqual(at(recipe({ sort: 'ground', ops: [{ op: 'rect', x: 0, y: 0, w: 16, h: 16, color: 'n' }, { op: 'text', x: 1, y: 2, text: 'H', color: 't', ground: 99 }] }), 1, 3), THIRD);
});

test('sorted layers refuse what does not stand, and ground needs a sorted layer', () => {
  const fails = (layer, message) => assert.throws(() => renderProject(recipe(layer)), { message });
  fails({ sort: 'ground', ops: [{ op: 'pixel', x: 0, y: 0, color: 'n' }, { op: 'dither', color: 'n' }] }, 'project.frames[0].layers[0].ops[1].op: dither works on an area rather than standing on the ground; draw it in a layer without sort');
  for (const op of ['clear', 'fill', 'replace', 'tilemap', 'outline', 'shade', 'rewrite']) assert.throws(() => renderProject(recipe({ sort: 'ground', ops: [{ op }] })), new RegExp(`ops\\[0\\]\\.op: ${op} works on an area`));
  fails({ sort: 'ground', ops: [{ op: 'text', text: 'A', color: 'n' }] }, 'project.frames[0].layers[0].ops[0].ground: text in a layer with sort "ground" needs ground: the row it stands on');
  fails({ ops: [{ op: 'pixel', color: 'n', ground: 3 }] }, 'project.frames[0].layers[0].ops[0].ground: ground orders a layer with sort "ground"; set sort on this layer, or remove ground');
  assert.throws(() => renderProject({ ...recipe({ ops: [] }), frames: [{ name: 'still', ops: [{ op: 'pixel', color: 'n', ground: 3 }] }] }), /frames\[0\]\.ops\[0\]\.ground: ground orders a layer/);
  fails({ sort: 'depth', ops: [] }, 'project.frames[0].layers[0].sort: expected "ground": draw this layer\'s operations far to near by the row each stands on');
  fails({ sort: 'ground', ops: [{ op: 'pixel', color: 'n', ground: 1.5 }] }, 'project.frames[0].layers[0].ops[0].ground: expected an integer from -4096 to 4096');
});

test('paths keep list positions when a sorted layer draws out of order', () => {
  // The first-listed stamp stands lowest, so it is drawn last; its clipping and its errors still name ops[0].
  const clipped = renderProject(recipe({ sort: 'ground', ops: [{ op: 'stamp', x: 2, y: 15, symbol: 'short' }, { op: 'stamp', x: 2, y: 1, symbol: 'tall' }] }));
  assert.deepEqual(clipped.clipping, [{ path: 'project.frames[0].layers[0].ops[0]', pixels: 1 }]);
  assert.throws(() => renderProject(recipe({ sort: 'ground', ops: [{ op: 'pixel', x: 0, y: 9, color: 'missing' }, { op: 'pixel', x: 0, y: 1, color: 'n' }] })), /ops\[0\]\.color: unknown color/);
  // A layer can still be hidden, faded and moved; sort only orders its own drawing.
  const moved = recipe({ sort: 'ground', x: 3, opacity: 1, ops: [{ op: 'stamp', x: 2, y: 5, symbol: 'short' }, { op: 'stamp', x: 2, y: 1, symbol: 'tall' }] });
  assert.deepEqual(at(moved, 5, 5), NEAR);
});

test('the schema offers sort on layers and ground on the operations that can stand', async () => {
  const schema = JSON.parse(await readFile(new URL('../schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(schema.$defs.layer.properties.sort.enum, ['ground']);
  const standing = schema.$defs.op.oneOf.filter(op => op.properties.ground).map(op => op.properties.op.const).sort();
  assert.deepEqual(standing, ['autotile', 'box', 'copy', 'ellipse', 'grid', 'line', 'pixel', 'rect', 'stamp', 'text']);
});
