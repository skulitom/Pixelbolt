import test from 'node:test';
import assert from 'node:assert/strict';
import { renderProject, buildAtlas, parseColor, scalePixels } from '../src/core.js';

const make = (ops = [], extra = {}) => ({ version: 1, name: 'test', width: 4, height: 4, palette: { r: '#f00', b: '#00f', g: '#0f0' }, frames: [{ name: 'a', ops }], ...extra });
const pixel = (frame, x, y, width = 4) => [...frame.data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];
test('hex shorthand, alpha and named colors', () => {
  assert.deepEqual(parseColor('#0f08'), [0, 255, 0, 136]);
  assert.deepEqual(parseColor('blue', { blue: '#11223344' }), [17, 34, 51, 68]);
  assert.deepEqual(parseColor('transparent'), [0, 0, 0, 0]);
  assert.throws(() => parseColor('missing'), /unknown color/);
});
test('grid dots skip existing pixels, with exact palette colors', () => {
  const { frames: [f] } = renderProject(make([{ op: 'rect', w: 4, h: 4, color: 'b' }, { op: 'grid', rows: ['r.', '.g'] }]));
  assert.deepEqual(pixel(f, 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixel(f, 1, 0), [0, 0, 255, 255]);
  assert.deepEqual(pixel(f, 1, 1), [0, 255, 0, 255]);
});
test('grid shape and color errors include the exact source path', () => {
  assert.throws(() => renderProject(make([{ op: 'grid', rows: ['rr', 'r'] }])), /project.frames\[0\].ops\[0\].rows\[1\]: all rows must be 2/);
  assert.throws(() => renderProject(make([{ op: 'grid', rows: ['z'] }])), /unknown palette character "z"/);
});
test('non-square stamp rotates clockwise and flips before rotation', () => {
  const p = renderProject(make([{ op: 'stamp', symbol: 's', rotate: 90 }], { symbols: { s: ['rg', 'b.','r.'] } }));
  assert.deepEqual(pixel(p.frames[0], 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixel(p.frames[0], 1, 0), [0, 0, 255, 255]);
  assert.deepEqual(pixel(p.frames[0], 2, 1), [0, 255, 0, 255]);
  const q = renderProject(make([{ op: 'stamp', symbol: 's', flipX: true, rotate: 90 }], { symbols: { s: ['rg', 'b.','r.'] } }));
  assert.deepEqual(pixel(q.frames[0], 0, 1), [255, 0, 0, 255]);
  assert.deepEqual(pixel(q.frames[0], 2, 0), [0, 255, 0, 255]);
});
test('Bresenham line includes both endpoints in every direction', () => {
  for (const [x, y, x2, y2] of [[0,0,3,3], [3,3,0,0], [0,3,3,0], [3,0,0,3]]) {
    const f = renderProject(make([{ op: 'line', x, y, x2, y2, color: 'r' }])).frames[0];
    assert.equal(f.data.filter((_, i) => i % 4 === 3 && f.data[i] === 255).length, 4);
    assert.equal(pixel(f, x, y)[3], 255); assert.equal(pixel(f, x2, y2)[3], 255);
  }
});
test('outlined ellipse has a transparent center; rectangles can be outlined', () => {
  const f = renderProject(make([{ op: 'ellipse', w: 4, h: 4, filled: false, color: 'g' }])).frames[0];
  assert.equal(pixel(f, 1, 1)[3], 0); assert.equal(pixel(f, 1, 0)[3], 255); assert.equal(pixel(f, 0, 0)[3], 0);
  const r = renderProject(make([{ op: 'rect', w: 4, h: 4, filled: false, color: 'g' }])).frames[0];
  assert.equal(pixel(r, 1, 1)[3], 0); assert.equal(pixel(r, 0, 0)[3], 255);
});
test('flood fill respects boundaries and fills the target region exactly', () => {
  const f = renderProject(make([{ op: 'line', x: 2, x2: 2, y2: 3, color: 'b' }, { op: 'fill', color: 'r' }])).frames[0];
  assert.deepEqual(pixel(f, 1, 3), [255, 0, 0, 255]);
  assert.deepEqual(pixel(f, 2, 3), [0, 0, 255, 255]);
  assert.deepEqual(pixel(f, 3, 3), [0, 0, 0, 0]);
});
test('clear erases alpha and replace matches the full RGBA value', () => {
  const f = renderProject(make([{ op: 'rect', w: 4, h: 4, color: 'r' }, { op: 'clear', w: 1, h: 1 }, { op: 'replace', from: 'r', to: '#00f8' }])).frames[0];
  assert.deepEqual(pixel(f, 0, 0), [0, 0, 0, 0]); assert.deepEqual(pixel(f, 1, 1), [0, 0, 255, 136]);
});
test('layer opacity applies once after the layer is flattened', () => {
  const f = renderProject(make([{ op: 'rect', w: 4, h: 4, color: 'b' }], { frames: [{ name: 'a', ops: [{ op: 'rect', w: 4, h: 4, color: 'b' }], layers: [{ opacity: .5, ops: [{ op: 'pixel', color: 'r' }, { op: 'pixel', color: 'r' }] }] }] })).frames[0];
  assert.deepEqual(pixel(f, 0, 0), [128, 0, 128, 255]);
});
test('frame inheritance copies pixels without mutating the parent', () => {
  const frames = [{ name: 'a', ops: [{ op: 'pixel', color: 'r' }] }, { name: 'b', from: 'a', translate: [1, 1], ops: [{ op: 'pixel', color: 'b' }] }];
  const p = renderProject(make([], { frames }));
  assert.deepEqual(pixel(p.frames[0], 0, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixel(p.frames[1], 1, 1), [255, 0, 0, 255]);
  assert.deepEqual(pixel(p.frames[1], 0, 0), [0, 0, 255, 255]);
});
test('animation direction preserves timings and avoids duplicate pingpong endpoints', () => {
  const frames = [{ name: 'a', duration: 50 }, { name: 'b', duration: 70 }, { name: 'c', duration: 100 }];
  const p = renderProject(make([], { frames, animations: { bounce: { frames: ['a','b','c'], direction: 'pingpong' }, backwards: { frames: ['a','c'], direction: 'reverse', loop: false } } }));
  assert.deepEqual(p.animations.bounce.frames, [0,1,2,1]); assert.equal(p.animations.bounce.duration, 290);
  assert.deepEqual(p.animations.backwards.frames, [2,0]); assert.equal(p.animations.backwards.loop, false);
});
test('atlas positions include scaled padding and no color interpolation', () => {
  const p = renderProject(make([], { width: 1, height: 1, frames: [{ name: 'a', ops: [{ op: 'pixel', color: 'r' }] }, { name: 'b', ops: [{ op: 'pixel', color: 'b' }] }], sheet: { columns: 1, padding: 1, scale: 2 } }));
  const atlas = buildAtlas(p);
  assert.equal(atlas.width, 6); assert.equal(atlas.height, 12);
  assert.deepEqual(atlas.metadata.frames.a.frame, { x: 2, y: 2, w: 2, h: 2 });
  assert.deepEqual(atlas.metadata.frames.b.frame, { x: 2, y: 8, w: 2, h: 2 });
  assert.deepEqual(pixel(atlas, 2, 8, 6), [0, 0, 255, 255]); assert.equal(pixel(atlas, 1, 8, 6)[3], 0);
});
test('clipping warns once, and invalid fill seeds are rejected', () => {
  assert.equal(renderProject(make([{ op: 'rect', x: -2, w: 4, h: 4, color: 'r' }])).warnings.length, 1);
  assert.throws(() => renderProject(make([{ op: 'fill', x: -1, color: 'r' }])), /fill seed/);
});
test('invalid references, duplicate names, typos and resource limits fail early', () => {
  for (const spec of [make([], { width: 257, frames: [{ name: 'a' }, { name: 'b' }] }), make([], { width: 4097 }), make([], { width: 2049, height: 2049 }), make([], { frames: [{ name: 'a', from: 'later' }] }), make([], { frames: [{ name: 'a' }, { name: 'a' }] }), make([{ op: 'rect', w: 2, h: 2, color: 'r', widht: 3 }]), make([], { animations: { bad: { frames: ['absent'] } } }), make([], { sheet: { scale: 1.5 } }), make([], { sheet: { columns: 256, scale: 16 }, width: 256, height: 256 })]) assert.throws(() => renderProject(spec));
});
test('prototype-like palette keys are safe and are not inherited', () => {
  assert.throws(() => renderProject(make([{ op: 'pixel', color: 'toString' }])), /unknown color/);
  const p = renderProject(make([{ op: 'pixel', color: 'toString' }], { palette: { toString: '#f00' } }));
  assert.deepEqual(pixel(p.frames[0], 0, 0), [255, 0, 0, 255]);
});
test('integer scaling replicates pixels exactly', () => {
  assert.deepEqual([...scalePixels(new Uint8Array([1,2,3,4]), 1, 1, 2)], [1,2,3,4,1,2,3,4,1,2,3,4,1,2,3,4]);
});
test('portable output names reject devices, case collisions and null options', () => {
  for (const n of ['CON', 'nul', 'Lpt1']) assert.throws(() => renderProject(make([], { name: n })), /reserved filename/);
  assert.throws(() => renderProject(make([], { frames: [{ name: 'Idle' }, { name: 'idle' }] })), /ignoring case/);
  assert.throws(() => renderProject(make([], { animations: { Idle: { frames: ['a'] }, idle: { frames: ['a'] } } })), /ignoring case/);
  assert.throws(() => renderProject(make([], { sheet: null })), /null is not supported/);
});
