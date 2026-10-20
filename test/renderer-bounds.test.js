import test from 'node:test';
import assert from 'node:assert/strict';
import { renderProject, describeStampRecipe } from '../src/core.js';
import { compilePoses } from '../src/authoring.js';
import { stampRig, mergedStamps } from '../scripts/pose-fixtures.mjs';

test('layer work scales with stamp area while names remain independently inspectable', () => {
  const small = compilePoses(stampRig(64, 16, 24)).recipe;
  const large = { ...small, width: 256, height: 256 };
  const a = renderProject(small, { stats: true }), b = renderProject(large, { stats: true });
  assert.deepEqual(a.work, b.work);
  assert.equal(a.work.layerPixels, 24 * 16 * 6 * 5);
  const merged = renderProject(mergedStamps(small));
  a.frames.forEach((frame, i) => assert.deepEqual(frame.data, merged.frames[i].data));
  const isolated = renderProject(small, { layers: ['part-0'] });
  const only = { ...small, frames: small.frames.map(frame => ({ ...frame, layers: frame.layers.slice(0, 1) })) };
  assert.deepEqual(isolated.frames, renderProject(only).frames);
});

test('the formerly over-budget 256px rig retains all 64 named parts', () => {
  const { recipe } = compilePoses(stampRig(256, 64, 32));
  const project = renderProject(recipe, { stats: true });
  assert.equal(recipe.frames[0].layers.length, 64);
  assert.equal(project.frames.length, 32);
  assert.ok(project.work.pixels < 67108864 / 10);
  assert.equal(project.work.layerPixels, 32 * 64 * 6 * 5);
});

// Independent, full-canvas compositing oracle: frame drawing does not use dirty bounds or the reused layer buffer.
function fullCanvas(recipe) {
  const result = new Uint8ClampedArray(recipe.width * recipe.height * 4);
  for (const layer of recipe.frames[0].layers) {
    const frame = renderProject({ ...recipe, frames: [{ name: 'raw', ops: layer.ops }] }).frames[0].data;
    if (layer.visible === false || layer.opacity === 0) continue;
    for (let y = 0; y < recipe.height; y++) for (let x = 0; x < recipe.width; x++) {
      const tx = x + (layer.x ?? 0), ty = y + (layer.y ?? 0), i = (y * recipe.width + x) * 4;
      if (tx < 0 || ty < 0 || tx >= recipe.width || ty >= recipe.height) continue;
      const to = (ty * recipe.width + tx) * 4, a = frame[i + 3] / 255 * (layer.opacity ?? 1);
      if (!a) continue;
      const old = result[to + 3] / 255, out = a + old * (1 - a);
      for (let c = 0; c < 3; c++) result[to + c] = Math.round((frame[i + c] * a + result[to + c] * old * (1 - a)) / out);
      result[to + 3] = Math.round(out * 255);
    }
  }
  return result;
}

test('dirty layer bounds retain global writes, hidden RGB, opacity, offsets, and clipping', () => {
  const seed = { op: 'rect', x: 3, y: 2, w: 3, h: 3, color: 'a' };
  const cases = [
    [seed, { op: 'outline', color: 'b', width: 2 }],
    [{ op: 'fill', color: 'a' }, { op: 'clear', x: 2, y: 1, w: 5, h: 4 }],
    [{ op: 'replace', from: 'transparent', to: 'b' }],
    [{ op: 'fill', color: '#12345600' }, { op: 'replace', from: '#12345600', to: 'a' }],
    [{ op: 'rewrite', empty: '-', rules: [{ match: ['-'], replace: ['b'] }], limit: 4 }],
    [seed, { op: 'dither', x: 1, y: 1, w: 8, h: 6, color: 'b', density: .5 }],
    [seed, { op: 'shade', steps: 1 }],
    [seed, { op: 'copy', symbol: 'patch', x: 5, y: 3, sx: 0, sy: 0, w: 2, h: 2 }],
    [{ op: 'fill', color: '#12345600' }],
    [{ op: 'grid', x: -1, y: 0, rows: ['aa', 'ba'] }]
  ];
  for (const [i, ops] of cases.entries()) {
    const recipe = {
      version: 1, name: 'bounds', width: 10, height: 8,
      palette: { a: '#df8a5280', b: '#24192f' }, ramps: [['b', 'a']], symbols: { patch: ['ab', '.a'] },
      frames: [{ name: 'frame', layers: [
        { ops: [{ op: 'rect', x: 0, y: 0, w: 2, h: 2, color: 'b' }] },
        { name: 'global', ops, x: -1, y: 2, opacity: .6 },
        { ops: [{ op: 'fill', color: '#fff' }], visible: false },
        { ops: [{ op: 'fill', color: '#12345600' }], opacity: 0 },
        { ops: [{ op: 'replace', from: '#12345600', to: '#f00' }, { op: 'pixel', x: 8, y: 1, color: 'a' }] }
      ] }]
    };
    assert.deepEqual(renderProject(recipe).frames[0].data, fullCanvas(recipe), `operation case ${i}`);
  }
});

test('stamp description preserves expanded timings and validates trimmed atlas bounds', () => {
  const source = stampRig(12, 3, 4);
  source.parts.segment.rows = ['......', '....h.', '..b...', '.s....', '......'];
  source.poses[0].parts[0].at = [-1, -1];
  source.animations = { ping: { frames: ['pose-3', 'pose-1', 'pose-0'], direction: 'pingpong', loop: false } };
  source.sheet = { trim: true, scale: 4, padding: 2 };
  const { recipe, metadata } = compilePoses(source);
  const described = describeStampRecipe(recipe), rendered = renderProject(recipe);
  assert.deepEqual(described.animations, rendered.animations);
  assert.deepEqual(described.sheet, rendered.sheet);
  assert.deepEqual(described.frames.map(({ name, duration }) => [name, duration]), rendered.frames.map(({ name, duration }) => [name, duration]));
  assert.deepEqual(metadata.animations.ping.entries.map(e => e.frame), ['pose-3', 'pose-1', 'pose-0', 'pose-1']);
  assert.equal(metadata.animations.ping.duration, 320);
  for (const x of [-12, -2, 0, 9, 12]) for (const y of [-12, -2, 0, 9, 12]) {
    const clipped = structuredClone(recipe);
    clipped.frames[0].layers.forEach(layer => { layer.ops[0].x = x; layer.ops[0].y = y; });
    assert.deepEqual(describeStampRecipe(clipped).sheet, renderProject(clipped).sheet, `crop at ${x},${y}`);
  }
});

test('pose compilation retains recipe validation without rasterizing frames', () => {
  const cases = [
    [s => { s.width = 257; }, /project.width/],
    [s => { s.name = 'con'; }, /project.name/],
    [s => { s.palette.h = 'unknown'; }, /project.palette.h/],
    [s => { s.parts.segment.rows[0] = 'q.....'; }, /symbols.segment/],
    [s => { s.parts.segment.rows[0] = 'h'; }, /symbols.segment/],
    [s => { s.poses[0].duration = 0; }, /frames\[0\].duration/],
    [s => { s.poses[1].name = 'POSE-0'; }, /frames\[1\].name/],
    [s => { s.poses[0].parts[0].name = 'nul'; }, /layers\[0\].name/],
    [s => { s.poses[0].origin = [4096, 4096]; s.poses[0].parts[0].at = [4096, 4096]; }, /ops\[0\].x/],
    [s => { s.animations = { walk: { frames: ['missing'] } }; }, /animations.walk.frames/],
    [s => { s.animations = {}; }, /at least one animation/],
    [s => { s.animations = { walk: { frames: ['pose-0'], loop: 1 } }; }, /animations.walk.loop/],
    [s => { s.sheet = { scale: 17 }; }, /sheet.scale/],
    [s => { s.sheet = { columns: 256, scale: 16 }; s.width = 256; s.height = 256; }, /atlas exceeds/]
  ];
  for (const [change, expected] of cases) {
    const source = stampRig(16, 2, 2); change(source);
    assert.throws(() => compilePoses(source), expected);
  }
});
