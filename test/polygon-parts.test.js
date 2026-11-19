import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderProject } from '../src/core.js';
import { keepAnimations, keepFrames, resizeRecipe } from '../src/resize.js';
import { patchRecipe } from '../src/patch.js';

const part = { pivot: [2, -1], ops: [
  { op: 'polygon', points: [[-4, -3], [2, -1], [-2, 2], [-4, 0]], color: 'a' },
  { op: 'line', x: -3, y: -2, x2: 2, y2: -1, color: 'b' },
  { op: 'pixel', x: 2, y: -1, color: 'a' }
] };
const recipe = frames => ({ version: 1, name: 'wings', width: 17, height: 11,
  palette: { a: '#f008', b: '#ff0' }, parts: { wing: part }, frames });
const place = { name: 'wing', part: 'wing', x: 7, y: 4, group: 'fly' };
const frame = layer => ({ name: 'flight', layers: [layer], groups: { fly: [1, 1] } });
const pixel = (f, x, y) => [...f.data.slice((y * 17 + x) * 4, (y * 17 + x) * 4 + 4)];

test('a pivot in negative local space places and mirrors the complete raster, including line ties and alpha', () => {
  const draw = layer => renderProject(recipe([frame(layer)]), { owners: true });
  for (const scale of [1, [.75, 1.5], [0, 0]]) {
    const original = draw({ ...place, scale, opacity: .5, palette: { b: '#0f0' } });
    assert.equal(original.clipping, undefined);
    for (const [flipX, flipY] of [[true, false], [false, true], [true, true]]) {
      const mirror = draw({ ...place, scale, flipX, flipY, opacity: .5, palette: { b: '#0f0' } });
      assert.equal(mirror.clipping, undefined);
      for (let y = 0; y < 11; y++) for (let x = 0; x < 17; x++) {
        const a = original.frames[0], b = mirror.frames[0], mx = flipX ? 16 - x : x, my = flipY ? 10 - y : y;
        assert.deepEqual(pixel(a, x, y), pixel(b, mx, my));
        assert.equal(a.owners[y * 17 + x], b.owners[my * 17 + mx]);
      }
    }
  }
});

test('only the final canvas clips a part, and canvas-space touchups and resize respect that cut', () => {
  const r = recipe([frame({ ...place, x: 0, ops: [{ op: 'pixel', x: 0, y: 1, color: 'b' }] })]);
  const full = renderProject(r);
  assert.equal(full.clipping[0].path, 'project.frames[0].layers[0].part');
  assert.ok(full.clipping[0].pixels > 0);
  for (const size of [[21, 15], [8, 9]]) {
    const { recipe: resized, resized: { offset: [dx, dy] } } = resizeRecipe(r, size);
    const result = renderProject(resized).frames[0];
    for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
      const sx = x + dx, sy = y + dy, at = (y * size[0] + x) * 4;
      const expected = sx >= 0 && sx < 17 && sy >= 0 && sy < 11 ? pixel(full.frames[0], sx, sy) : [0, 0, 0, 0];
      assert.deepEqual([...result.data.slice(at, at + 4)], expected);
    }
  }
});

test('keyframes use source milliseconds, easing, ordered endpoints, phase delay and stable samples when sliced', () => {
  const drawing = recipe([40, 60, 50, 50, 50].map((duration, i) => ({
    ...frame({ ...place, scale: 'beat' }), name: 'f' + i, duration
  })));
  drawing.scaleTracks = { beat: { keys: [{ at: 0, scale: [1, 1] }, { at: 100, scale: [0, 2] }, { at: 200, scale: [1, 1] }] } };
  const still = scale => renderProject(recipe([frame({ ...place, scale })])).frames[0].data;
  const check = (r, scales) => renderProject(r).frames.forEach((f, i) => assert.deepEqual(f.data, still(scales[i])));
  check(drawing, [1, [.6, 1.4], [0, 2], [.5, 1.5], 1]);
  drawing.scaleTracks.beat.loop = true;
  drawing.scaleTracks.beat.ease = 'hold';
  for (const f of drawing.frames) f.layers[0].delay = 50;
  check(drawing, [[0, 2], [0, 2], 1, [0, 2], [0, 2]]);
  drawing.scaleTracks.beat.ease = 'in';
  drawing.frames[0].time = 100;
  assert.deepEqual(renderProject(drawing).frames[0].data, still([.875, 1.125]));
  drawing.animations = { flight: { frames: drawing.frames.map(f => f.name) }, last: { frames: ['f3', 'f4'] } };
  const original = renderProject(drawing);
  for (const cropped of [keepFrames(drawing, 2).recipe, keepAnimations(drawing, 'last').recipe]) {
    for (const f of renderProject(cropped).frames) assert.deepEqual(f.data, original.frames.find(old => old.name === f.name).data);
  }
});

test('unused definitions, hidden instances and invalid keyframes report their source path', () => {
  for (const [change, path] of [
    [r => { r.parts.wing.ops[0].op = 'rect'; }, 'parts.wing.ops[0].op'],
    [r => { r.parts.wing.pivot = [1, .5]; }, 'parts.wing.pivot[1]'],
    [r => { r.parts.wing.ops[0].color = 'missing'; }, 'parts.wing.ops[0].color'],
    [r => { r.frames[0].layers = [{ part: 'missing', visible: false }]; }, 'layers[0].part'],
    [r => { r.frames[0].layers = [{ part: 'wing', scale: 'absent' }]; }, 'layers[0].scale'],
    [r => { r.frames[0].layers = [{ part: 'wing', scale: [1, -1] }]; }, 'layers[0].scale[1]'],
    [r => { r.frames[0].layers = [{ part: 'wing', delay: 10 }]; }, 'layers[0].delay'],
    [r => { r.frames[0].layers = [{ flipX: true }]; }, 'layers[0].flipX'],
    [r => { r.scaleTracks = { beat: { loop: true, keys: [{ at: 0, scale: 1 }] } }; }, 'scaleTracks.beat.keys'],
    [r => { r.scaleTracks = { beat: { keys: [{ at: 2, scale: 1 }, { at: 2, scale: 1 }] } }; }, 'scaleTracks.beat.keys[1].at']
  ]) {
    const r = structuredClone(recipe([frame({})]));
    change(r);
    assert.throws(() => renderProject(r), e => e.path.endsWith(path), path);
  }
});

test('the Eclipse Moth shoulder preserves its 3,825 pixels and a single key retimes both decorated pairs', () => {
  const source = JSON.parse(readFileSync(new URL('../showcase/eclipse-moth/eclipse-moth.json', import.meta.url)));
  const layers = source.frames[0].layers.filter(l => l.part);
  const sample = (r, layer, time) => renderProject({ ...r, frames: [{ name: 'pose', time, groups: { hover: [0, 0] }, layers: [layer] }], animations: {} }).frames[0];
  const left = layers.find(l => l.name === 'left-forewing'), open = sample(source, left, 0);
  const wing = source.parts.forewing;
  const shift = (x, y) => wing.ops.map(op => op.op === 'polygon'
    ? { ...op, x, y }
    : { ...op, x: op.x + x, y: op.y + y, x2: op.x2 + x, y2: op.y2 + y });
  const baked = sample(source, { ops: shift(left.x - wing.pivot[0], left.y - wing.pivot[1]) }, 0);
  assert.deepEqual(open.data, baked.data);
  assert.equal(open.data.reduce((count, c, i) => count + (i % 4 === 3 && c !== 0), 0), 3825);
  const clipped = sample(source, { ops: shift(-wing.pivot[0], -wing.pivot[1]), x: left.x, y: left.y }, 0);
  assert.equal(clipped.data.reduce((count, c, i) => count + (i % 4 === 3 && c !== 0), 0), 2);
  const edit = patchRecipe(source, [{ set: 'scaleTracks.wingbeat.keys[2].at', value: 1280 }]).recipe;
  for (const layer of layers) {
    const delay = layer.delay ?? 0;
    assert.deepEqual(sample(source, layer, 1040 + delay).data, sample(edit, layer, 1280 + delay).data);
    assert.notDeepEqual(sample(source, layer, 1040 + delay).data, sample(edit, layer, 1040 + delay).data);
  }
});
