// The parity gate: each live preset, baked by the standalone Lua port, against Pixelbolt's own frames from this
// checkout, at the defaults, at one setting that moves every control, and at another seed.
//
//   node aseprite/tools/parity.mjs [--preset campfire] [--setting default|custom|seed] [--min 99] [--json out.json]
//     [--lua aseprite/.tools/lua.exe] [--live campfire,torch,...] [--sweep 20 [--sweep-seed 1]]
//
// --sweep N adds N more settings per preset: every slider at a random position on its own step grid and a random
// seed, from a seeded generator, so a run can be repeated exactly.
//
// Passes when every frame of every bake matches on at least --min percent of pixels (default 99) and the size, frame
// count, loop flag and durations are equal. Prints the exact figures, and the first differing pixels of a failure.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, loadPresets, presetsModule } from './presets.mjs';
import { initialSettings, customSettings, referenceFrames, controls } from './reference.mjs';

export const SETTINGS = {
  default: source => initialSettings(source),
  custom: source => customSettings(source),
  seed: source => { const s = initialSettings(source); return { values: s.values, seed: s.seed + 1 }; }
};

// Random settings on the sliders' own grids (mulberry32, seeded).
export function sweepSettings(source, count, seed = 1) {
  let state = seed >>> 0;
  const next = () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const { values } = initialSettings(source), sliders = Object.keys(values);
  return Array.from({ length: count }, () => {
    const picked = {};
    for (const key of sliders) {
      const s = controls.FLUID_SLIDERS.gas.find(x => x.key === key), steps = Math.round((s.max - s.min) / s.step);
      picked[key] = controls.sliderValue(s, s.min + Math.floor(next() * (steps + 1)) * s.step);
    }
    return { values: picked, seed: Math.floor(next() * 2147483648) };
  });
}

const hex = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));

export function parseFrames(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== 'pixelbolt-fluids-frames 1') throw new Error('not a frames file');
  const [width, height, count, loop] = lines[1].split(' ').map(Number);
  const frames = [], durations = [];
  let at = 2;
  for (let f = 0; f < count; f++) {
    const [word, index, duration] = lines[at++].split(' ');
    if (word !== 'frame' || Number(index) !== f) throw new Error(`frame ${f}: bad header`);
    durations.push(Number(duration));
    const rows = lines.slice(at, at + height);
    at += height;
    if (rows.some(r => r.length !== width)) throw new Error(`frame ${f}: rows are not ${width} wide`);
    frames.push(rows.join(''));
  }
  return { width, height, loop: loop === 1, durations, frames };
}

// Compares Lua frames (palette keys) with reference RGBA. Returns figures and the first differences.
export function compare(reference, baked, palette) {
  const facts = [];
  for (const key of ['width', 'height', 'loop']) if (reference[key] !== baked[key]) facts.push(`${key}: Pixelbolt ${reference[key]}, port ${baked[key]}`);
  if (reference.frames.length !== baked.frames.length) facts.push(`frames: Pixelbolt ${reference.frames.length}, port ${baked.frames.length}`);
  else if (reference.durations.join() !== baked.durations.join()) facts.push(`durations: Pixelbolt ${reference.durations.join()}, port ${baked.durations.join()}`);
  const colours = Object.fromEntries(Object.entries(palette).map(([k, v]) => [k, hex(v)]));
  const keyOf = (data, i) => { if (data[i + 3] === 0) return '.'; const found = Object.entries(colours).find(([, c]) => c[0] === data[i] && c[1] === data[i + 1] && c[2] === data[i + 2]); return found ? found[0] : '?'; };
  const perFrame = [], diffs = [];
  let drawn = 0, drawnSame = 0;
  if (!facts.length) {
    const N = reference.width * reference.height;
    reference.frames.forEach((data, f) => {
      let same = 0;
      const cells = baked.frames[f];
      for (let c = 0; c < N; c++) {
        const ch = cells[c], i = c * 4;
        const ok = ch === '.' ? data[i + 3] === 0 : data[i + 3] === 255 && colours[ch] && colours[ch][0] === data[i] && colours[ch][1] === data[i + 1] && colours[ch][2] === data[i + 2];
        if (ch !== '.' || data[i + 3] !== 0) { drawn++; if (ok) drawnSame++; }
        if (ok) same++;
        else if (diffs.length < 12) diffs.push(`frame ${f} x ${c % reference.width} y ${Math.floor(c / reference.width)}: Pixelbolt ${keyOf(data, i)}, port ${ch}`);
      }
      perFrame.push((100 * same) / N);
    });
  }
  const min = perFrame.length ? Math.min(...perFrame) : 0, mean = perFrame.length ? perFrame.reduce((a, b) => a + b, 0) / perFrame.length : 0;
  // The share of pixels either side draws that match: blank canvas doesn't count toward it.
  const drawnPercent = drawn ? (100 * drawnSame) / drawn : 100;
  return { facts, perFrame, min, mean, drawn: drawnPercent, diffs };
}

export function bakeLua({ lua, name, settings, out, presetsFile }) {
  const args = [join(ROOT, 'aseprite', 'tools', 'bake-cli.lua'), '--preset', name, '--presets', presetsFile, '--out', out];
  for (const [k, v] of Object.entries(settings.values)) args.push(`--${k}`, String(v));
  args.push('--seed', String(settings.seed));
  execFileSync(lua, args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60 * 1000 });
  return parseFrames(readFileSync(out, 'utf8'));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opt = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
  const lua = resolve(opt('lua', join(ROOT, 'aseprite', '.tools', process.platform === 'win32' ? 'lua.exe' : 'lua')));
  const minimum = Number(opt('min', '99'));
  const only = opt('preset', null), settingNames = opt('setting', null) ? [opt('setting')] : Object.keys(SETTINGS);
  const live = opt('live', null)?.split(',');
  const dir = join(ROOT, 'aseprite', 'dist', 'parity');
  mkdirSync(dir, { recursive: true });
  const presets = await loadPresets();
  const presetsFile = join(dir, 'presets.lua');
  writeFileSync(presetsFile, presetsModule(presets));
  const report = [];
  let failed = false;
  for (const preset of presets) {
    if (only && preset.name !== only) continue;
    if (live && !live.includes(preset.name)) continue;
    const sweep = Number(opt('sweep', '0')), swept = sweep ? sweepSettings(preset.source, sweep, Number(opt('sweep-seed', '1'))) : [];
    const names = [...settingNames, ...swept.map((_, i) => `sweep-${i + 1}`)];
    for (const setting of names) {
      const settings = setting.startsWith('sweep-') ? swept[Number(setting.slice(6)) - 1] : SETTINGS[setting](preset.source);
      const reference = referenceFrames(preset.source, settings);
      const started = Date.now();
      let result;
      try {
        const baked = bakeLua({ lua, name: preset.name, settings, out: join(dir, `${preset.name}-${setting}.txt`), presetsFile });
        result = compare(reference, baked, preset.source.palette);
      } catch (error) {
        result = { facts: [`the Lua bake failed: ${String(error.stderr || error.message).trim().split('\n').slice(-6).join(' | ')}`], perFrame: [], min: 0, mean: 0, drawn: 0, diffs: [] };
      }
      const ok = !result.facts.length && result.min >= minimum;
      if (!ok) failed = true;
      const shown = setting.startsWith('sweep-') ? `${setting} ${JSON.stringify(settings.values)} seed ${settings.seed}` : setting;
      const line = `${ok ? 'PASS' : 'FAIL'} ${preset.name} ${shown}: min ${result.min.toFixed(3)}% mean ${result.mean.toFixed(3)}% drawn ${result.drawn.toFixed(3)}% over ${result.perFrame.length} frames (${((Date.now() - started) / 1000).toFixed(1)} s)`;
      console.log(line);
      for (const f of result.facts) console.log(`    ${f}`);
      if (!ok) for (const d of result.diffs) console.log(`    ${d}`);
      report.push({ preset: preset.name, setting, settings, ok, ...result });
    }
  }
  const json = opt('json', null);
  if (json) writeFileSync(json, JSON.stringify(report, null, 1));
  process.exit(failed ? 1 : 0);
}
