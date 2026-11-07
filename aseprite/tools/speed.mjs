// Bake times: each live preset baked by the standalone Lua port at its defaults, three separate runs, median.
// The budgets are 15 s for the explosion and 5 s for every other preset. They are advisory, as Pixelbolt's speed
// budgets are: an overrun is reported and the exit code stays 0, unless --strict (for the release check on a quiet
// machine) makes it 1.
//
//   node aseprite/tools/speed.mjs [--preset explosion] [--runs 3] [--lua aseprite/.tools/lua.exe] [--live a,b] [--strict]
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, loadPresets, presetsModule } from './presets.mjs';

export const LIMITS = { explosion: 15 };
export const LIMIT = 5;

export function timeLua({ lua, name, presetsFile, runs = 3 }) {
  const times = [];
  for (let r = 0; r < runs; r++) {
    const out = execFileSync(lua, [join(ROOT, 'aseprite', 'tools', 'bake-cli.lua'), '--preset', name, '--presets', presetsFile, '--time'], { encoding: 'utf8', timeout: 10 * 60 * 1000 });
    times.push(Number(out.match(/seconds ([0-9.]+)/)[1]));
  }
  const sorted = [...times].sort((a, b) => a - b);
  return { times, median: sorted[Math.floor(sorted.length / 2)] };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opt = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
  const lua = resolve(opt('lua', join(ROOT, 'aseprite', '.tools', process.platform === 'win32' ? 'lua.exe' : 'lua')));
  const only = opt('preset', null), runs = Number(opt('runs', '3')), live = opt('live', null)?.split(',');
  const dir = join(ROOT, 'aseprite', 'dist', 'parity');
  mkdirSync(dir, { recursive: true });
  const presets = await loadPresets();
  const presetsFile = join(dir, 'presets.lua');
  writeFileSync(presetsFile, presetsModule(presets));
  let failed = false;
  for (const preset of presets) {
    if ((only && preset.name !== only) || (live && !live.includes(preset.name))) continue;
    const limit = LIMITS[preset.name] ?? LIMIT;
    const { times, median } = timeLua({ lua, name: preset.name, presetsFile, runs });
    const ok = median <= limit;
    if (!ok) failed = true;
    console.log(`${ok ? 'PASS' : 'OVER'} ${preset.name}: median ${median.toFixed(2)} s (runs ${times.map(t => t.toFixed(2)).join(', ')}; limit ${limit} s)`);
  }
  process.exit(failed && process.argv.includes('--strict') ? 1 : 0);
}
