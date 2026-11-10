import test from 'node:test';
import assert from 'node:assert/strict';
import { PixelError } from '../src/core.js';
import { expandPoses, compilePoses } from '../src/authoring.js';
import { patchRecipe } from '../src/patch.js';
import { heroRig } from '../scripts/figure-rigs.mjs';

// Values a source may hold by mistake, read before anything checked them: accepted in silence, or a raw TypeError.
const recipe = () => ({ version: 1, name: 'unchecked', width: 8, height: 8, palette: { w: '#ffffff' },
  frames: [{ name: 'idle', pixels: [{ x: 2, y: 2, color: 'w' }] }], animations: { still: { frames: ['idle'] } } });
const refused = (run, path, pattern) => assert.throws(run, error => error instanceof PixelError && error.path === path && pattern.test(error.message));

test('a rig source checks animations before the motions are added to them', () => {
  // With motions, the generated animations were spread over whatever was written: 42, a list, null and false vanished
  // without a word, and "bad" was refused as an animation named "0".
  for (const animations of [42, [], 'bad', null, false]) {
    refused(() => expandPoses({ ...heroRig(), animations }), 'poses.animations', /expected an object/);
    refused(() => compilePoses({ ...heroRig(), animations }), 'poses.animations', /expected an object/);
  }
  // Written animations still join the generated ones.
  const animations = { still: { frames: ['stand'], loop: false } }, expanded = expandPoses({ ...heroRig(), animations });
  assert.deepEqual(expanded.animations.still, animations.still);
  assert.ok(Object.keys(expanded.animations).length > 1);
});

test('painting checks that the pixels already in a frame are objects before reading their coordinates', () => {
  const changes = [{ paint: 'frames[idle]', value: [{ x: 0, y: 0, color: 'w' }] }];
  // null threw "Cannot read properties of null"; a number, a text or a list was kept as a pixel.
  for (const pixels of [[null], [42], ['bad'], [[]], 42, {}, 'bad']) {
    const source = recipe(); source.frames[0].pixels = pixels;
    refused(() => patchRecipe(source, changes), 'changes[0].paint', /pixels must be a list/);
  }
  const source = recipe(), before = structuredClone(source), patched = patchRecipe(source, changes).recipe;
  assert.deepEqual(patched.frames[0].pixels, [...source.frames[0].pixels, ...changes[0].value]);
  assert.deepEqual(source, before);
});
