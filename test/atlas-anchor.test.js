// P-086: the atlas is TexturePacker-style JSON, where `anchor` is a 0-1 origin. Phaser 3's JSONHash parser reads
// `src.anchor || src.pivot` as a frame's pivot, and PixiJS's Spritesheet takes `data.anchor` as a texture's default
// anchor, so `anchor` must be the same 0-1 share as `pivot`; the anchor's pixel lives in `anchorPx`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBundle } from '../src/export.js';
import { drawFrame } from '../src/runtime.js';

const recipe = { version: 1, name: 'spark', width: 64, height: 48, anchor: [32, 40], palette: { y: '#ffdb85' },
  frames: [
    { name: 'a', ops: [{ op: 'rect', x: 28, y: 30, w: 8, h: 10, color: 'y' }] },
    { name: 'b', anchor: [10, 6], ops: [{ op: 'pixel', x: 10, y: 6, color: 'y' }] }
  ],
  animations: { burst: { frames: ['a', 'b'] } }, sheet: { scale: 2, trim: true } };

// What each engine's loader keeps from a frame entry.
const phaserPivot = src => src.anchor || src.pivot;
const pixiAnchor = data => data.anchor;

test('P-086: Phaser and PixiJS read an exported atlas anchor as the 0-1 origin', async () => {
  const atlas = JSON.parse((await createBundle(recipe)).files.get('spark.atlas.json').toString('utf8'));
  for (const [name, [x, y]] of [['a', [32, 40]], ['b', [10, 6]]]) {
    const entry = atlas.frames[name], share = { x: x / 64, y: y / 48 };
    for (const origin of [phaserPivot(entry), pixiAnchor(entry)]) {
      assert.ok(Math.abs(origin.x - share.x) < 1e-6 && Math.abs(origin.y - share.y) < 1e-6, `${name}: ${JSON.stringify(origin)}`);
    }
    assert.deepEqual(entry.anchor, entry.pivot);
    assert.deepEqual(entry.anchorPx, { x: x * 2, y: y * 2 });
    // The origin times the untrimmed source size is the anchor pixel, as an engine places it.
    assert.deepEqual([Math.round(entry.anchor.x * entry.sourceSize.w), Math.round(entry.anchor.y * entry.sourceSize.h)], [x * 2, y * 2]);
  }
  assert.equal(atlas.frames.a.trimmed, true);
});

test('P-086: drawFrame lands the anchor pixel on (x, y) from new atlases, and reads older and hand-written atlases as before', async () => {
  const atlas = (await createBundle(recipe)).atlas.metadata;
  const draws = [];
  const context = { set imageSmoothingEnabled(value) {}, drawImage: (...args) => draws.push(args.slice(5)), save() {}, restore() {}, translate() {}, scale() {} };
  const place = frames => { draws.length = 0; drawFrame(context, { image: {}, atlas: { ...atlas, frames } }, 'a', 100, 100); return draws[0]; };
  const entry = atlas.frames.a, expected = place(atlas.frames);
  // The frame's visible pixels start at the trim offset, so the anchor pixel (64, 80) lands on (100, 100).
  assert.deepEqual(expected.slice(0, 2), [100 - 64 + entry.spriteSourceSize.x, 100 - 80 + entry.spriteSourceSize.y]);
  const { anchorPx, ...rest } = entry;
  // An atlas written before anchorPx kept the pixel point under `anchor`, beside the 0-1 `pivot`.
  assert.deepEqual(place({ a: { ...rest, anchor: anchorPx } }), expected);
  // A hand-written atlas with no anchorPx keeps its anchor in pixels, small and negative ones included.
  const { pivot, anchor, ...bare } = rest, { x: left, y: top } = entry.spriteSourceSize;
  for (const pixel of [{ x: 1, y: 1 }, { x: 0, y: 1 }, { x: -2, y: -3 }, { x: 4, y: 6 }]) {
    assert.deepEqual(place({ a: { ...bare, anchor: pixel } }).slice(0, 2), [100 - pixel.x + left, 100 - pixel.y + top], JSON.stringify(pixel));
  }
  // With no anchor at all, a pivot alone places nothing, as before: the source canvas's top-left is at (x, y).
  assert.deepEqual(place({ a: { ...bare, pivot } }).slice(0, 2), [100 + left, 100 + top]);
  // anchor: false still draws the source canvas's top-left at (x, y).
  draws.length = 0; drawFrame(context, { image: {}, atlas }, 'a', 100, 100, { anchor: false });
  assert.deepEqual(draws[0].slice(0, 2), [100 + entry.spriteSourceSize.x, 100 + entry.spriteSourceSize.y]);
});
