import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeProject, inspectProject, renderProject } from '../src/core.js';
import { resizeRecipe } from '../src/resize.js';

const recipe = frames => ({ version: 1, name: 'probe', width: 8, height: 6, palette: { a: '#f008', b: '#00f' }, frames });
const polygon = { op: 'polygon', x: 1, y: 1, points: [[0, 0], [5, 0], [5, 3], [3, 3], [3, 1], [1, 1], [1, 3], [0, 3]], color: 'a' };
const grid = project => inspectProject(project, { grid: true }).grids[0].rows;

test('a concave polygon includes its pixel boundary, fills only its interior and blends each pixel once', () => {
  const draw = op => renderProject(recipe([{ name: 'f', ops: [op] }]));
  const forward = draw(polygon);
  assert.deepEqual(grid(forward), ['........', '.aaaaaa.', '.aaaaaa.', '.aa.aaa.', '.aa.aaa.', '........']);
  assert.deepEqual(draw({ ...polygon, points: polygon.points.toReversed() }).frames[0].data, forward.frames[0].data);
  const rect = { ...polygon, points: [[0, 0], [3, 0], [3, 3], [0, 3]], x: -1 };
  const clipped = draw({ ...rect, filled: false });
  assert.deepEqual(grid(clipped), ['........', 'aaa.....', '..a.....', '..a.....', 'aaa.....', '........']);
  assert.equal(clipped.clipping[0].pixels, 4);
  assert.equal(draw(rect).clipping[0].pixels, 4);
  for (const points of [undefined, [[0, 0]], Array(257).fill([0, 0]), [[0, 0], [1, .5], [2, 0]]])
    assert.throws(() => draw({ ...rect, points }), /ops\[0\]\.points/);
  assert.throws(() => draw({ ...rect, filled: 1 }), /ops\[0\]\.filled/);
});

test('a filled polygon is its outline plus every pixel centre inside it, for edges sloping either way', () => {
  // Even-odd at a pixel centre; a centre on an edge may land either way, and the outline holds it.
  const inside = (points, px, py) => points.reduce((odd, [ax, ay], i) => {
    const [bx, by] = points[(i + 1) % points.length];
    return (ay > py) !== (by > py) && px < ax + (py - ay) * (bx - ax) / (by - ay) ? !odd : odd;
  }, false);
  const shapes = {
    // Right edges sloping down-left once left a pinhole on every row (x + y = 84 here), and left edges sloping
    // the same way a stray pixel outside.
    triangle: [[45, 9], [76, 9], [45, 40]],
    hexagon: [[124, 47], [141, 47], [150, 58], [150, 59], [141, 70], [124, 70], [115, 59], [115, 58]],
    plate: [[12, 45], [39, 45], [42, 48], [42, 68], [39, 71], [12, 71], [9, 68], [9, 48]]
  };
  const draw = (points, filled) => renderProject({ ...recipe([{ name: 'f', ops: [{ op: 'polygon', points, color: 'b', filled }] }]),
    width: 160, height: 80 }).frames[0].data;
  for (const [name, points] of Object.entries(shapes)) {
    const fill = draw(points, true), outline = draw(points, false), wrong = [];
    for (let y = 0; y < 80; y++) for (let x = 0; x < 160; x++) {
      const at = (y * 160 + x) * 4 + 3;
      if (!fill[at] !== !(outline[at] || inside(points, x, y))) wrong.push([x, y]);
    }
    assert.deepEqual(wrong, [], name);
    assert.deepEqual(draw(points.toReversed(), true), fill, `${name} reversed`);
  }
});

test('sloping polygon outlines use the line rasterizer’s pixel steps in either winding', () => {
  for (let x = 0; x < 8; x++) for (let y = 0; y < 6; y++) {
    const line = { op: 'line', x: 4, y: 0, x2: x, y2: y, color: 'b' };
    const op = { op: 'polygon', points: [[4, 0], [x, y], [4, 0]], color: 'b', filled: false };
    const draw = operation => renderProject(recipe([{ name: 'f', ops: [operation] }])).frames[0].data;
    assert.deepEqual(draw(op), draw(line), `end [${x}, ${y}]`);
  }
});

test('group offsets compose with local offsets, preserve draw order, isolation and the resize window', () => {
  const speck = { op: 'pixel', x: 3, y: 2, color: 'b' };
  const layers = [{ name: 'back', group: 'ride', ops: [polygon] }, { name: 'water', ops: [speck] },
    { name: 'front', group: 'ride', x: -1, y: 1, ops: [speck] }];
  const source = recipe([{ name: 'f', groups: { ride: [1, -1] }, layers }]);
  const flat = recipe([{ name: 'f', layers: layers.map(({ group, x = 0, y = 0, ...layer }) =>
    ({ ...layer, x: x + (group ? 1 : 0), y: y - (group ? 1 : 0) })) }]);
  for (const options of [{ owners: true }, { layers: ['front', 'back'] }])
    assert.deepEqual(renderProject(source, options).frames, renderProject(flat, options).frames);
  for (const size of [[6, 5], [10, 8]]) {
    const resize = r => renderProject(resizeRecipe(r, size).recipe).frames[0].data;
    assert.deepEqual(resize(source), resize(flat));
  }
  assert.throws(() => renderProject(recipe([{ name: 'f', layers }])), /layers\[0\]\.group: unknown layer group/);
  assert.throws(() => renderProject(recipe([{ name: 'f', groups: { ride: [true, 2] } }])), /groups\.ride\[0\]/);
  const ground = renderProject(recipe([{ name: 'f', layers: [{ sort: 'ground', ops: [polygon, { ...speck, x: 3, y: 1 }] }] }]));
  assert.ok(ground.frames[0].blendMask[1 * 8 + 3], 'polygon stands on its translated lowest vertex');
});

test('palette diagnostics keep identical literal and blended RGBA distinct through exact writes, copies and transforms', () => {
  const literal = '#880077', direct = { op: 'pixel', color: literal };
  const result = renderProject(recipe([
    { name: 'source', layers: [{ ops: [{ op: 'rect', w: 2, h: 1, color: 'b' }, { op: 'rect', w: 2, h: 1, color: 'a' }] }],
      pixels: [{ x: 1, y: 0, color: literal }] },
    { name: 'shift', from: 'source', translate: [1, 1] },
    { name: 'copy', ops: [{ op: 'copy', from: 'shift', sx: 1, sy: 1, w: 2, h: 1, flipX: true }] },
    { name: 'remap', ops: [{ op: 'copy', from: 'copy', remap: { [literal]: literal } }] },
    { name: 'replace', from: 'source', ops: [{ op: 'replace', from: literal, to: literal }] },
    { name: 'wash', layers: [{ opacity: .5, ops: [{ op: 'pixel', color: 'b' }] }, { ops: [{ ...direct, x: 1 }] }] },
    { name: 'plain', ops: [{ op: 'pixel', color: 'a' }] }
  ]));
  const findings = analyzeProject(result).findings;
  const samples = (name, code) => findings.find(f => f.frame === name && f.code === code)?.coordinates;
  for (const [name, x, y, literalX] of [['source', 0, 0, 1], ['shift', 1, 1, 2], ['copy', 1, 0, 0]]) {
    assert.deepEqual(samples(name, 'alpha-blend'), [{ x, y, color: literal }]);
    assert.deepEqual(samples(name, 'palette'), [{ x: literalX, y, color: literal }]);
  }
  for (const name of ['remap', 'replace', 'plain']) assert.equal(samples(name, 'alpha-blend'), undefined);
  assert.deepEqual(samples('wash', 'alpha-blend'), [{ x: 0, y: 0, color: '#0000ff80' }]);
  const stack = inspectProject(result, { stack: [['plain', 'wash']], diagnostics: true });
  assert.ok(stack.diagnostics.findings.some(f => f.code === 'alpha-blend'));
});
