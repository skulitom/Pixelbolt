import test from 'node:test';
import assert from 'node:assert/strict';
import { compileEffects } from '../src/fx.js';
import { readShapes, renderShapes, SHAPE_WORK } from '../src/shapes.js';

const palette = { a: '#223344', b: '#88aacc' }, look = { colors: ['a', 'b'], thresholds: [0.2, 0.6] };
const effect = (layers, { frames = 4, width = 32, height = 32 } = {}) => ({ format: 'pixelforge-fx', version: 1, name: 'fx', width, height, palette, effects: { e: { frames, looks: { l: look }, layers } } });
const refused = (source, path, pattern) => assert.throws(() => compileEffects(source), error => error.name === 'PixelError' && error.path === path && pattern.test(error.message));

test('shapes visit only the canvas, so a stream drawn mostly off it costs little', () => {
  // A schema-valid stream thousands of pixels across, on an 8×8 canvas: it used to run for hours.
  const layer = { kind: 'stream', at: [-4096, -4096], through: [[4096, 4096], [-4096, 4096], [4096, -4096]], width: 256, taper: [2, 2] };
  const shapes = readShapes({ looks: { l: look }, layers: [layer] }, 'fx.effects.e', { palette, seed: 1, frames: 256 }), work = { spent: 0 };
  for (let f = 0; f < 256; f += 51) renderShapes(shapes, f, 8, 8, [], work);
  assert.ok(work.spent < 1_000_000, `${work.spent} pixels visited`);
  assert.ok(compileEffects(effect([layer], { frames: 256, width: 8, height: 8 })).recipe.frames.length === 256);
});

test('shape painting has a work budget, refused at the layer that crosses it', () => {
  const through = [[240, 30], [20, 120], [230, 140], [15, 200], [245, 230], [128, 250]];
  const wide = Array.from({ length: 4 }, () => ({ kind: 'stream', at: [5, 5], through, width: 256, taper: [2, 2] }));
  refused(effect(wide, { frames: 64, width: 256, height: 256 }), 'fx.effects.e.layers[2]', new RegExp(`would visit more than ${SHAPE_WORK.toLocaleString('en-US')} pixels`));
  // Too many frames for one recipe is refused before anything is simulated or painted.
  refused(effect([{ kind: 'ring', at: [128, 128], radius: 400, noise: 1 }], { frames: 256, width: 256, height: 256 }), 'fx.effects', /256 frames of 256×256, more than the 4,194,304 pixels/);
});

test('shape layers refuse settings that would do nothing or leak', () => {
  // Bolts and streams run between points: tilt and squash never applied to them.
  refused(effect([{ kind: 'bolt', at: [2, 2], to: [30, 30], tilt: 45 }]), 'fx.effects.e.layers[0].tilt', /unknown or null field/);
  refused(effect([{ kind: 'stream', at: [2, 2], through: [[30, 30]], squash: [1, 0.5] }]), 'fx.effects.e.layers[0].squash', /unknown or null field/);
  // Noise scales are whole pixels (each distinct scale keeps a noise table for the life of the process).
  for (const kind of ['ring', 'burst', 'slash']) {
    const layer = { kind, at: [16, 16], radius: 8, scale: 4.5, ...(kind === 'slash' && { arc: [0, 90] }) };
    refused(effect([layer]), 'fx.effects.e.layers[0].scale', /expected an integer from 1 to 64/);
  }
  // A star step of the corner count or more joins each corner to itself.
  refused(effect([{ kind: 'glyph', at: [16, 16], radius: 12, points: 3, step: 3 }]), 'fx.effects.e.layers[0].step', /fewer than the 3 points/);
  assert.ok(compileEffects(effect([{ kind: 'glyph', at: [16, 16], radius: 12, points: 5, step: 2 }])));
});

test('a beam whose far end is its start draws its round cap, not a filled box', () => {
  const grid = to => compileEffects(effect([{ kind: 'beam', at: [16, 16], to, width: 8, reveal: 0 }], { frames: 1 })).recipe.frames[0].ops[0];
  const zero = grid([16, 16]), rows = zero.rows, last = rows.length - 1, right = rows[0].length - 1;
  // It used to fill its whole 13×13 margin box; now it is the round blob a one-pixel beam draws.
  assert.deepEqual(zero, grid([17, 16]));
  for (const [x, y] of [[0, 0], [right, 0], [0, last], [right, last]]) assert.equal(rows[y][x], '.');
});
