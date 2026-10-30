import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EFFECT_PRESETS, EFFECT_SLIDERS, effectOf, editedEffects } from '../studio/effects-controls.js';
import { compileEffects } from '../src/fx.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = async file => JSON.parse(await readFile(path.join(root, 'examples', `${file}.fx.json`), 'utf8'));
const extreme = (key, end) => EFFECT_SLIDERS.find(slider => slider.key === key)[end];

test('every Effects lab preset compiles on its own and comes back unchanged with the controls at rest', async () => {
  for (const { file } of EFFECT_PRESETS) {
    const source = await load(file), { metadata } = compileEffects(source);
    for (const name of Object.keys(source.effects)) {
      assert.deepEqual(editedEffects(source, name, { strength: 1, speed: 1 }, source.effects[name].seed ?? 1), source, `${file} ${name}`);
      // Every animation maps back to an effect of the source, turned copies included.
      for (const animation of Object.keys(metadata.effects).filter(a => effectOf(metadata, a) === name)) assert.ok(source.effects[effectOf(metadata, animation)], animation);
    }
  }
});

test('every Effects lab preset still compiles with the controls at their extremes', async () => {
  for (const { file } of EFFECT_PRESETS) {
    const source = await load(file);
    for (const name of Object.keys(source.effects)) for (const end of ['min', 'max']) {
      const values = { strength: extreme('strength', end), speed: extreme('speed', end) };
      assert.doesNotThrow(() => compileEffects(editedEffects(source, name, values, 7)), `${file} ${name} at ${end}`);
    }
  }
});

test('Strength scales an effect\'s rates and bursts, Speed its timing, and only that effect changes', async () => {
  const source = await load('effects'), edited = editedEffects(source, 'sparks', { strength: 2, speed: 2 }, 9);
  const before = source.effects.sparks, after = edited.effects.sparks;
  after.emitters.forEach((emitter, i) => {
    if (before.emitters[i].burst !== undefined) assert.equal(emitter.burst, Math.min(1024, Math.round(before.emitters[i].burst * 2)));
    if (typeof before.emitters[i].rate === 'number') assert.equal(emitter.rate, Math.min(64, before.emitters[i].rate * 2));
  });
  assert.equal(after.duration, Math.round(before.duration / 2));
  assert.equal(after.seed, 9);
  for (const name of Object.keys(source.effects).filter(name => name !== 'sparks')) assert.deepEqual(edited.effects[name], source.effects[name], name);
  // A duration curve speeds up at both ends.
  const slash = await load('slash-hit'), curve = editedEffects(slash, 'slash-hit', { speed: 2 }, slash.effects['slash-hit'].seed ?? 1).effects['slash-hit'].duration;
  assert.deepEqual(curve, { ...slash.effects['slash-hit'].duration, from: Math.round(slash.effects['slash-hit'].duration.from / 2), to: Math.round(slash.effects['slash-hit'].duration.to / 2) });
});
