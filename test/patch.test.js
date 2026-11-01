import test from 'node:test';
import assert from 'node:assert/strict';
import { renderProject, compareProjects } from '../src/core.js';
import { patchRecipe } from '../src/patch.js';

const recipe = () => ({ version: 1, name: 'probe', width: 4, height: 2, palette: { k: '#000', w: '#fff', 'dark.green': '#040' }, frames: [
  { name: 'a', duration: 100, layers: [{ name: 'body', ops: [{ op: 'pixel', color: 'k' }] }] },
  { name: 'b', from: 'a', ops: [{ op: 'pixel', x: 3, color: 'w' }] }
], animations: { idle: { frames: ['a', 'b', 'a'] } } });
test('patches address items by name, index or end and report what they replaced', () => {
  const base = recipe(), { recipe: next, edits } = patchRecipe(base, [
    { set: 'frames[a].layers[body].ops[0].x', value: 1 }, { set: 'project.frames[1].duration', value: 80 },
    { insert: 'frames[b].ops[-]', value: { op: 'pixel', y: 1, color: 'k' } }, { insert: 'frames[a].ops[0]', value: { op: 'pixel', x: 2, color: 'w' } },
    { set: 'palette["dark.green"]', value: '#050' }, { remove: 'animations.idle.frames[2]' }, { set: 'sheet', value: { padding: 1 } }
  ]);
  assert.deepEqual(edits, [
    { set: 'frames[a].layers[body].ops[0].x', at: 'frames[0].layers[0].ops[0].x', created: true }, { set: 'project.frames[1].duration', created: true },
    { insert: 'frames[b].ops[-]', at: 'frames[1].ops[1]' }, { insert: 'frames[a].ops[0]', at: 'frames[0].ops[0]' },
    { set: 'palette["dark.green"]', before: '#040' }, { remove: 'animations.idle.frames[2]', before: 'a' }, { set: 'sheet', created: true }
  ]);
  assert.deepEqual(next.frames[0].ops, [{ op: 'pixel', x: 2, color: 'w' }]);
  assert.deepEqual([next.frames[1].duration, next.frames[1].ops.length, next.animations.idle.frames], [80, 2, ['a', 'b']]);
  assert.deepEqual(base, recipe());
  assert.equal(renderProject(next).frames.length, 2);
});
test('patch errors name the change that failed', () => {
  for (const [change, message] of [
    [{ set: 'frames[missing].duration', value: 1 }, /changes\[0\]\.set: frames has no item named "missing"/],
    [{ set: 'animations.idle.frames[a]', value: 'b' }, /2 items in animations\.idle\.frames match "a"; use an index/],
    [{ set: 'frames[9].duration', value: 1 }, /frames has 2 items/], [{ set: 'frames.0.duration', value: 1 }, /frames is a list/],
    [{ set: 'frames[-]', value: {} }, /can only end an insert path/], [{ insert: 'palette.q', value: '#fff' }, /insert needs a list position/],
    [{ remove: 'frames[0].nope' }, /nothing to remove at frames\[0\]\.nope/], [{ set: 'frames[0].duration.x', value: 1 }, /frames\[0\]\.duration is 100/],
    [{ set: 'frames[a]].x', value: 1 }, /cannot read/], [{ set: 'frames[a].duration' }, /changes\[0\]\.value: set needs a value/],
    [{ remove: 'palette.k', value: 1 }, /remove takes no value/], [{ set: 'x', insert: 'y', value: 1 }, /exactly one of set, insert, remove/],
    [{ set: 'palette.k', value: null }, /null is not supported/], [{ set: 'palette.k', value: '#fff', why: 1 }, /changes\[0\]\.why: unknown field/]
  ]) assert.throws(() => patchRecipe(recipe(), [change]), message);
  assert.throws(() => patchRecipe(recipe(), []), /changes: expected a list/);
});

test('canvas painting replaces exact pixels after translated layers, and inherited frames keep the corrections', () => {
  const base = { version: 1, name: 'layered', width: 8, height: 4, background: '#123', palette: { w: '#fff' }, frames: [
    { name: 'a', layers: [
      { name: 'body', x: 2, y: 1, opacity: 0.5, ops: [{ op: 'rect', w: 3, h: 2, color: 'w' }] },
      { name: 'front', x: -1, ops: [{ op: 'pixel', x: 4, y: 1, color: '#f00' }] },
      { visible: false, ops: [{ op: 'rect', w: 8, h: 4, color: '#000' }] }
    ] },
    { name: 'b', from: 'a', flipX: true, translate: [0, 1] }, { name: 'c' }
  ] };
  const original = structuredClone(base), before = renderProject(base);
  const corrections = [{ x: 3, y: 1, color: 'w' }, { x: 2, y: 1, color: 'transparent' }, { x: 4, y: 2, color: '#0f08' }, { x: 0, y: 0, color: '#000' }];
  const { recipe: next, edits } = patchRecipe(base, [{ paint: 'frames[a]', value: corrections }]);
  const after = renderProject(next), pixel = (frame, x, y) => [...frame.data.slice((y * 8 + x) * 4, (y * 8 + x) * 4 + 4)];
  assert.deepEqual(edits, [{ paint: 'frames[a]', at: 'frames[0]', pixels: 4 }]);
  assert.deepEqual(next.frames[0].layers, base.frames[0].layers);
  assert.deepEqual(pixel(after.frames[0], 3, 1), [255, 255, 255, 255]);
  assert.deepEqual(pixel(after.frames[0], 2, 1), [0, 0, 0, 0]);
  assert.deepEqual(pixel(after.frames[0], 4, 2), [0, 255, 0, 136]);
  assert.deepEqual(pixel(after.frames[0], 0, 0), [0, 0, 0, 255]);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) {
    if (!corrections.some(p => p.x === x && p.y === y)) assert.deepEqual(pixel(after.frames[0], x, y), pixel(before.frames[0], x, y));
    if (y < 3) assert.deepEqual(pixel(after.frames[1], 7 - x, y + 1), pixel(after.frames[0], x, y));
  }
  const report = compareProjects(before, after);
  assert.deepEqual(report.frames.changed.map(f => [f.frame, f.pixels]), [['a', 4], ['b', 4]]);
  assert.deepEqual(report.frames.unchanged, ['c']);
  assert.deepEqual(base, original);
  const repainted = patchRecipe(next, [{ paint: 'project.frames[0]', value: [{ x: 3, y: 1, color: '#f00' }, { x: 3, y: 1, color: '#00f' }] }]).recipe;
  assert.equal(repainted.frames[0].pixels.length, 4);
  assert.deepEqual(pixel(renderProject(repainted).frames[0], 3, 1), [0, 0, 255, 255]);
  const undo = patchRecipe(next, [{ remove: 'frames[a].pixels' }]).recipe;
  assert.deepEqual(renderProject(undo).frames, before.frames);
});

test('recolor reads keys as the frame draws them, and frame scope protects dependents with palette keys', () => {
  const recipe = { version: 1, name: 'swap', width: 4, height: 1, palette: { r: '#ff0000', b: '#0000ff' }, frames: [
    { name: 'a', ops: [{ op: 'rect', x: 0, y: 0, w: 4, h: 1, color: 'r' }] },
    { name: 'green', palette: { r: '#00ff00' }, ops: [{ op: 'rect', x: 0, y: 0, w: 4, h: 1, color: 'r' }] },
    { name: 'next', from: 'a' }] };
  // The green frame draws r in its own palette's green; recolor from r finds those pixels.
  const recolored = patchRecipe(recipe, [{ recolor: 'frames[green]', value: { from: 'r', to: 'b', x: 0, y: 0, w: 2, h: 1 } }]).recipe;
  assert.deepEqual(recolored.frames[1].pixels, [{ x: 0, y: 0, color: 'b' }, { x: 1, y: 0, color: 'b' }]);
  // Frame scope keeps `next` as it was, with corrections named by key, so a later palette edit still reaches them.
  const { recipe: scoped, edits } = patchRecipe(recipe, [{ paint: 'frames[a]', value: [{ x: 3, y: 0, color: 'b' }], scope: 'frame' }]);
  assert.deepEqual(edits[0].protected, [{ frame: 'next', pixels: 1 }]);
  assert.deepEqual(scoped.frames[2].pixels, [{ x: 3, y: 0, color: 'r' }]);
});

test('paint rejects wrong targets and invalid pixels without mutating the source', () => {
  const base = recipe();
  for (const [change, message] of [
    [{ paint: 'frames[a].layers[body]', value: [{ x: 0, y: 0, color: 'w' }] }, /paint needs a frame path/],
    [{ paint: 'frames[a]', value: [] }, /paint needs 1/],
    [{ paint: 'frames[a]', value: [null] }, /changes\[0\]\.value\[0\]: expected a pixel/],
    [{ paint: 'frames[a]', value: [{ x: 4, y: 0, color: 'w' }] }, /value\[0\]\.x/],
    [{ paint: 'frames[a]', value: [{ x: 0, y: -1, color: 'w' }] }, /value\[0\]\.y/],
    [{ paint: 'frames[a]', value: [{ x: 0.5, y: 0, color: 'w' }] }, /value\[0\]\.x/],
    [{ paint: 'frames[a]', value: [{ x: 0, y: 0, color: 'unknown' }] }, /value\[0\]\.color/],
    [{ paint: 'frames[a]', value: [{ x: 0, y: 0 }] }, /value\[0\]\.color/],
    [{ paint: 'frames[a]', value: [{ x: 0, y: 0, color: 'w', opacity: 0.5 }] }, /value\[0\]\.opacity: unknown field/]
  ]) assert.throws(() => patchRecipe(base, [change]), message);
  assert.throws(() => patchRecipe(base, [{ paint: 'frames[a]', value: [{ x: 1, y: 1, color: 'w' }] }, { remove: 'frames[missing]' }]), /changes\[1\]/);
  assert.deepEqual(base, recipe());
  for (const pixels of [null, {}, [null], [{ x: 0, y: 0, color: null }], [{ x: 4, y: 0, color: 'w' }], [{ x: 0, y: 0, color: 'w', opacity: 1 }]]) {
    assert.throws(() => renderProject({ ...base, frames: [{ name: 'a', pixels }] }), /project\.frames\[0\]\.pixels/);
  }
});
test('comparison reports changed, inherited, added and retimed frames with exact pixels', () => {
  const { recipe: next } = patchRecipe(recipe(), [
    { set: 'frames[a].layers[body].ops[0].color', value: 'w' }, { set: 'frames[b].duration', value: 150 },
    { insert: 'frames[-]', value: { name: 'c', ops: [{ op: 'pixel', color: '#f00' }] } }, { set: 'animations.idle.loop', value: false }
  ]);
  const report = compareProjects(renderProject(recipe()), renderProject(next)), change = { pixels: 1, box: { x: 0, y: 0, w: 1, h: 1 }, changes: [{ x: 0, y: 0, from: 'k', to: 'w' }] };
  assert.deepEqual(report.frames, { changed: [{ frame: 'a', ...change }, { frame: 'b', ...change }], unchanged: [], added: ['c'], durations: [{ frame: 'b', from: 100, to: 150 }] });
  assert.deepEqual(report.animations, { changed: [{ animation: 'idle', loop: { from: true, to: false } }] });
  assert.deepEqual(report.image.frames, [{ frame: 'a', status: 'changed' }, { frame: 'b', status: 'changed' }, { frame: 'c', status: 'added' }]);
  assert.deepEqual([report.image.region, report.image.sheet.columns, report.image.sheet.rows], [{ x: 0, y: 0, w: 4, h: 2 }, 2, 3]);
});
test('comparison crops to the change, summarizes recolors and reports resized canvases', () => {
  const big = { version: 1, name: 'big', width: 32, height: 32, palette: { k: '#000', w: '#fff' }, frames: [{ name: 'a', ops: [{ op: 'rect', x: 4, y: 4, w: 20, h: 10, color: 'k' }] }, { name: 'b', ops: [{ op: 'pixel', color: 'w' }] }] };
  const recolor = compareProjects(renderProject(big), renderProject(patchRecipe(big, [{ set: 'palette.k', value: '#123456' }]).recipe));
  assert.deepEqual(recolor.frames, { changed: [{ frame: 'a', pixels: 200, box: { x: 4, y: 4, w: 20, h: 10 }, transitions: [{ from: '0', to: 'k', pixels: 200 }] }], unchanged: ['b'] });
  assert.deepEqual(recolor.legend, { 0: { color: '#000000' } });
  assert.deepEqual(recolor.image.region, { x: 2, y: 2, w: 24, h: 14 });
  const resized = compareProjects(renderProject(big), renderProject(patchRecipe(big, [{ set: 'width', value: 16 }]).recipe));
  assert.deepEqual(resized.canvas, { from: { w: 32, h: 32 }, to: { w: 16, h: 32 } });
  assert.deepEqual(resized.frames.changed, [{ frame: 'a' }, { frame: 'b' }]); assert.equal(resized.image, undefined);
});
