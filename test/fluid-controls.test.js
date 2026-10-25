import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLUID_PRESETS, FLUID_SLIDERS, fluidEffect, fluidSliders, sliderValue, editedSource } from '../studio/fluid-controls.js';
import { compileFluid } from '../src/fluid.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const presets = async () => {
  const files = (await readdir(path.join(root, 'examples'))).filter(file => file.endsWith('.fluid.json')).sort();
  return Promise.all(files.map(async file => ({ file, source: JSON.parse(await readFile(path.join(root, 'examples', file), 'utf8')) })));
};

test('the Fluid lab lists every shipped fluid preset', async () => {
  const shipped = (await presets()).map(({ file }) => file.replace(/\.fluid\.json$/, '')).sort();
  assert.deepEqual(FLUID_PRESETS.map(entry => entry.file).sort(), shipped);
});

// P-003: a slider that can't hold a preset's value shows the wrong setting and can never restore the preset's own.
test('every shipped preset fits the Fluid lab sliders exactly and round-trips through them unchanged', async () => {
  for (const { file, source } of await presets()) {
    const effect = fluidEffect(source), values = {};
    for (const slider of fluidSliders(source)) {
      const value = slider.initial(effect), where = `${file} ${slider.key} = ${value}`;
      assert.ok(value >= slider.min && value <= slider.max, `${where} is outside the slider's ${slider.min} to ${slider.max}`);
      assert.equal(sliderValue(slider, value), value, `${where} is not on the slider's ${slider.step} steps`);
      values[slider.key] = sliderValue(slider, value);
    }
    assert.deepEqual(editedSource(source, values, effect.seed ?? 1), source, `${file} changes when its own values come back from the sliders`);
  }
});

test('slider ranges stay inside what the fluid compiler accepts', async () => {
  const { source } = (await presets()).find(({ file }) => file === 'drip.fluid.json');
  for (const slider of FLUID_SLIDERS.liquid.filter(slider => ['viscosity', 'yield', 'drag', 'flip'].includes(slider.key))) {
    const edited = structuredClone(source);
    fluidEffect(edited)[slider.key] = slider.max;
    assert.doesNotThrow(() => compileFluid(edited), `${slider.key} at the slider's maximum ${slider.max}`);
  }
});

test('sliderValue clamps and snaps as a range input does', () => {
  const slider = { min: 0, max: 0.4, step: 0.0025 };
  assert.equal(sliderValue(slider, 0.1375), 0.1375);
  assert.equal(sliderValue(slider, 0.13751), 0.1375);
  assert.equal(sliderValue(slider, 0.13875), 0.14);
  assert.equal(sliderValue(slider, 1), 0.4);
  assert.equal(sliderValue(slider, -1), 0);
  assert.equal(sliderValue({ min: 0, max: 8, step: 0.1 }, 16), 8);
  assert.equal(sliderValue({ min: 0.25, max: 2, step: 0.05 }, 1), 1);
});

test('a slider moved away from the preset writes its value into the edited source', async () => {
  const { source } = (await presets()).find(({ file }) => file === 'slime.fluid.json');
  const effect = fluidEffect(source), values = Object.fromEntries(fluidSliders(source).map(slider => [slider.key, slider.initial(effect)]));
  const edited = editedSource(source, { ...values, yield: 12.5, gravity: 0.2 }, 9);
  assert.equal(fluidEffect(edited).yield, 12.5);
  assert.deepEqual(fluidEffect(edited).gravity, [effect.gravity?.[0] ?? 0, 0.2]);
  assert.equal(fluidEffect(edited).seed, 9);
  assert.equal(fluidEffect(source).yield, 16, 'the preset itself is untouched');
});
