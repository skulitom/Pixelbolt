// Pixelbolt's own frames for a preset at given control settings: the Fluid lab's edit (editedSource), compileFluid and
// the core renderer, all from this checkout. The parity gate compares the Lua port against these.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, loadPresets } from './presets.mjs';

const load = file => import(pathToFileURL(join(ROOT, file)).href);
const [{ compileFluid }, { renderProject }, controls] = await Promise.all([load('src/fluid.js'), load('src/core.js'), load('studio/fluid-controls.js')]);

export { controls };

// The slider values and seed a preset starts from, as the Fluid lab sets them.
export function initialSettings(source) {
  const effect = controls.fluidEffect(source), values = {};
  for (const slider of controls.FLUID_SLIDERS.gas) values[slider.key] = slider.initial(effect);
  return { values, seed: effect.seed ?? 1 };
}

// One non-default setting per preset: every slider moved by a step-aligned amount, and another seed.
export function customSettings(source) {
  const { values, seed } = initialSettings(source), sliders = controls.FLUID_SLIDERS.gas, by = Object.fromEntries(sliders.map(s => [s.key, s]));
  const move = (key, delta) => {
    const s = by[key], v = values[key] + delta;
    return controls.sliderValue(s, v > s.max || v < s.min ? values[key] - delta : v);
  };
  return { values: { strength: move('strength', 0.5), buoyancy: move('buoyancy', 0.1), vorticity: move('vorticity', -0.1), dissipation: move('dissipation', 0.02) }, seed: seed + 11 };
}

// Frames as palette-independent RGBA, with the facts a bake must reproduce.
export function referenceFrames(source, { values, seed }) {
  const edited = controls.editedSource(source, values, seed);
  const { recipe } = compileFluid(edited);
  const rendered = renderProject(recipe);
  const effect = controls.fluidEffect(edited);
  return {
    width: rendered.width, height: rendered.height, loop: effect.loop === true,
    durations: rendered.frames.map(f => f.duration), frames: rendered.frames.map(f => f.data)
  };
}

export async function referencePresets() { return loadPresets(); }
