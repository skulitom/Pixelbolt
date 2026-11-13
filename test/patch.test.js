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
  assert.deepEqual(recolor.frames, { changed: [{ frame: 'a', pixels: 200, box: { x: 4, y: 4, w: 20, h: 10 }, transitions: [{ from: '#000000', to: '#123456 (k)', pixels: 200 }] }], unchanged: ['b'] });
  // A colour the palette no longer names is written as its hex, so the report needs no legend.
  // Four or more pixels that all make one change are summed up; fewer, or a mix, are listed one by one.
  const few = { ...big, frames: [{ name: 'a', ops: [{ op: 'rect', x: 0, y: 0, w: 4, h: 1, color: 'k' }, { op: 'pixel', x: 0, y: 2, color: 'k' }] }] };
  const row = compareProjects(renderProject(few), renderProject(patchRecipe(few, [{ set: 'frames[a].ops[0].color', value: 'w' }]).recipe)).frames.changed[0];
  assert.deepEqual([row.pixels, row.changes, row.transitions], [4, undefined, [{ from: 'k', to: 'w', pixels: 4 }]]);
  const mixed = compareProjects(renderProject(few), renderProject(patchRecipe(few, [{ set: 'frames[a].ops[0].color', value: 'w' }, { remove: 'frames[a].ops[1]' }]).recipe)).frames.changed[0];
  assert.deepEqual([mixed.pixels, mixed.changes.length, mixed.transitions], [5, 5, undefined]);
  assert.equal(recolor.legend, undefined);
  assert.deepEqual(recolor.image.region, { x: 2, y: 2, w: 24, h: 14 });
  const resized = compareProjects(renderProject(big), renderProject(patchRecipe(big, [{ set: 'width', value: 16 }]).recipe));
  assert.deepEqual(resized.canvas, { from: { w: 32, h: 32 }, to: { w: 16, h: 32 } });
  assert.deepEqual(resized.frames.changed, [{ frame: 'a' }, { frame: 'b' }]); assert.equal(resized.image, undefined);
});

test('a change to many frames is one summary in a reply, and a change to a few stays a list', async () => {
  const { briefComparison, compareProjects, renderProject } = await import('../src/index.js');
  const strip = (count, color) => ({ version: 1, name: 'strip', width: 8, height: 8, palette: { a: color, b: '#102030' }, frames: Array.from({ length: count }, (_, i) => ({ name: `f-${i}`, ops: [{ op: 'rect', x: 0, y: 0, w: 4 + (i % 4), h: 6, color: 'a' }, { op: 'pixel', x: 7, y: 7, color: 'b' }] })) });
  const few = compareProjects(renderProject(strip(8, '#ff0000')), renderProject(strip(8, '#00ff00')));
  assert.equal(briefComparison(few), few);
  const { image, ...full } = compareProjects(renderProject(strip(20, '#ff0000')), renderProject(strip(20, '#00ff00'))), brief = briefComparison(full);
  assert.equal(full.frames.changed.length, 20);
  const pixels = full.frames.changed.reduce((sum, entry) => sum + entry.pixels, 0);
  assert.deepEqual(brief.frames.changed, { count: 20, frames: 'every frame', pixels, box: { x: 0, y: 0, w: 7, h: 6 }, transitions: [{ from: '#ff0000', to: '#00ff00 (a)', pixels }],
    most: [{ frame: 'f-3', pixels: 42, box: { x: 0, y: 0, w: 7, h: 6 } }, { frame: 'f-7', pixels: 42, box: { x: 0, y: 0, w: 7, h: 6 } }, { frame: 'f-11', pixels: 42, box: { x: 0, y: 0, w: 7, h: 6 } }] });
  assert.ok(JSON.stringify(brief).length * 4 < JSON.stringify(full).length);
  // Frames with few changed pixels list each one; the summary's colour changes count those pixels too.
  const dots = (count, color) => ({ ...strip(count, '#ff0000'), frames: strip(count, '#ff0000').frames.map(frame => ({ ...frame, ops: [...frame.ops, { op: 'pixel', x: 0, y: 7, color }] })) });
  const few_ = briefComparison((({ image: _, ...rest }) => rest)(compareProjects(renderProject(dots(12, 'a')), renderProject(dots(12, 'b')))));
  assert.deepEqual([few_.frames.changed.pixels, few_.frames.changed.transitions], [12, [{ from: 'a', to: 'b', pixels: 12 }]]);
  // Some frames changed and some did not: both are named, numbered runs written as runs.
  const before = strip(30, '#ff0000'), after = { ...before, frames: before.frames.map((frame, i) => (i < 12 ? { ...frame, ops: [...frame.ops, { op: 'pixel', x: 0, y: 7, color: 'b' }] } : frame)) };
  const partly = briefComparison(compareProjects(renderProject(before), renderProject(after)));
  assert.deepEqual([partly.frames.changed.count, partly.frames.changed.frames, partly.frames.changed.pixels, partly.frames.unchanged], [12, 'f-0 … f-11', 12, { count: 18, frames: 'f-12 … f-29' }]);
});

test('[*] in a set, remove or insert reaches every item of a list, and passes over items that lack the rest of the path', () => {
  const layer = (name, color) => ({ name, ops: [{ op: 'rect', x: name === 'coat' ? 0 : 2, y: 0, w: 2, h: 2, color }] });
  const recipe = { version: 1, name: 'pair', width: 4, height: 2, palette: { r: '#ff0000', p: '#8000ff' },
    frames: [{ name: 'a', layers: [layer('coat', 'r'), layer('plume', 'r')] }, { name: 'b', duration: 80, layers: [layer('coat', 'r')] }, { name: 'c', layers: [layer('plume', 'r'), layer('coat', 'r')] }] };
  const { recipe: next, edits } = patchRecipe(recipe, [{ set: 'frames[*].layers[plume].palette', value: { r: 'p' } }, { set: 'frames[*].duration', value: 120 }]);
  // The plume alone changes colour, in the two frames that have one; every frame takes the duration.
  assert.deepEqual(edits, [{ set: 'frames[*].layers[plume].palette', matched: 2 }, { set: 'frames[*].duration', matched: 3 }]);
  assert.deepEqual(next.frames.map(frame => [frame.duration, frame.layers.map(each => each.palette ?? null)]), [[120, [null, { r: 'p' }]], [120, [null]], [120, [{ r: 'p' }, null]]]);
  const drawn = renderProject(next).frames.map(frame => [[...frame.data.subarray(0, 4)], [...frame.data.subarray(8, 12)]]);
  assert.deepEqual(drawn, [[[255, 0, 0, 255], [128, 0, 255, 255]], [[255, 0, 0, 255], [0, 0, 0, 0]], [[255, 0, 0, 255], [128, 0, 255, 255]]]);
  // remove: only where the field is; then nothing is left to match.
  const cleared = patchRecipe(next, [{ remove: 'frames[*].layers[*].palette' }]);
  assert.deepEqual([cleared.edits, cleared.recipe.frames.flatMap(frame => frame.layers.map(each => each.palette))], [[{ remove: 'frames[*].layers[*].palette', matched: 2 }], [undefined, undefined, undefined, undefined, undefined]]);
  assert.throws(() => patchRecipe(cleared.recipe, [{ remove: 'frames[*].layers[*].palette' }]), /changes\[0\]\.remove: no item has what this path names/);
  assert.throws(() => patchRecipe(recipe, [{ set: 'frames[*].layers[cape].palette', value: {} }]), /no item has what this path names/);
  assert.throws(() => patchRecipe(recipe, [{ set: 'frames[*]', value: {} }]), /\[\*\] is followed by what to change in each item/);
  assert.throws(() => patchRecipe(recipe, [{ set: 'palette[*].x', value: 1 }]), /\[\*\] needs a list, and palette is not one/);
  // An insert's path ends at a place in each item's list: a layer on top of every frame, or one beneath them all.
  const hatted = patchRecipe(recipe, [{ insert: 'frames[*].layers[-]', value: layer('hat', 'p') }, { insert: 'frames[*].layers[0]', value: layer('shadow', 'p') }]);
  assert.deepEqual(hatted.edits, [{ insert: 'frames[*].layers[-]', matched: 3 }, { insert: 'frames[*].layers[0]', matched: 3 }]);
  assert.deepEqual(hatted.recipe.frames.map(frame => frame.layers.map(each => each.name).join(' ')), ['shadow coat plume hat', 'shadow coat hat', 'shadow plume coat hat']);
  // A frame without the list gets one from [0] or [-], as a plain insert makes it; a place further in passes it over.
  const bare = { ...recipe, frames: [{ name: 'a', ops: [{ op: 'pixel', x: 0, y: 0, color: 'r' }] }, { name: 'b' }] };
  const behind = patchRecipe(bare, [{ insert: 'frames[*].ops[0]', value: { op: 'rect', x: 0, y: 0, w: 4, h: 2, color: 'p' } }]);
  assert.deepEqual([behind.edits, behind.recipe.frames.map(frame => frame.ops.map(op => op.op).join(' '))], [[{ insert: 'frames[*].ops[0]', matched: 2 }], ['rect pixel', 'rect']]);
  assert.deepEqual(patchRecipe(bare, [{ insert: 'frames[*].ops[1]', value: { op: 'pixel', x: 1, y: 1, color: 'p' } }]).edits, [{ insert: 'frames[*].ops[1]', matched: 1 }]);
  assert.throws(() => patchRecipe(bare, [{ insert: 'frames[*].ops[3]', value: { op: 'pixel', x: 1, y: 1, color: 'p' } }]), /frames\[0\]\.ops has 1 item/);
  assert.throws(() => patchRecipe(recipe, [{ paint: 'frames[*]', value: [{ x: 0, y: 0, color: 'p' }] }]), /\[\*\] is every item of a list, for set, remove and insert/);
  // A change in another tool's shape is answered with a patch's.
  assert.throws(() => patchRecipe(recipe, [{ op: 'set', path: 'frames[0].duration', value: 120 }]), /changes\[0\]\.op: unknown field in patch: a change is \{"set": "<path>", "value": …\}/);
});
