// Heat, phase changes and electricity over a liquid: frost under gravity, smooth obstacles that vanish with heat, a pool
// heated from below, hot obstacles beside arcs, and settings that would do nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compileFluid } from '../src/fluid.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const example = async name => JSON.parse(await readFile(`${root}examples/${name}.fluid.json`, 'utf8'));
// A 24 × 24 tank drawing water 'b', ice 'i', steam 's', plasma 'v' and current 'c'.
const tank = (effect, symbols = {}) => ({ format: 'pixelforge-fluid', version: 1, name: 'heat', width: 24, height: 24,
  palette: { b: '#2f6fc0', i: '#b9e2f5', s: '#a9b3c6', v: '#3b2a8c', c: '#8fe9ff', w: '#ffffff', k: '#222222', r: '#cc3333' },
  symbols: { plate: ['r'.repeat(24)], shelf: ['k'.repeat(16), 'k'.repeat(16)], rod: ['kk', 'kk', 'kk'], ...symbols },
  effects: { e: { kind: 'liquid', frames: 24, walls: ['left', 'right', 'bottom'], emitters: [], look: [{ field: 'density', colors: ['b'], thresholds: [0.5], dither: 0 }], ...effect } } });
// Each frame's drawn pixels on the full canvas.
const grids = recipe => recipe.frames.map(frame => {
  const rows = Array.from({ length: recipe.height }, () => Array(recipe.width).fill('.'));
  for (const op of frame.ops ?? []) if (op.op === 'grid') op.rows.forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== '.') rows[op.y + j][op.x + i] = ch; }));
  return rows;
});
const effectOf = compiled => Object.values(compiled.metadata.effects)[0];

test('frost under gravity stays on the cold surface it grew from: fingers at 45 degrees hold together', async () => {
  // The frost window with the liquid's usual gravity. Its fingers grow at 45 degrees from the frame's corners, their cells
  // touching only at a corner; taken as separate pieces they broke off, fell onto the sills and grew again in mid-air.
  const source = await example('frost-window'), effect = Object.values(source.effects)[0], frame = source.symbols.frame;
  const still = effectOf(compileFluid(source)).figures.ice.at(-1);
  effect.gravity = [0, 0.3];
  const compiled = compileFluid(source), { width: W, height: H } = source;
  grids(compiled.recipe).forEach((rows, f) => {
    // Every frost pixel ('f' or 'W') joins the cold frame through frost, eight ways round.
    const frost = (x, y) => x >= 0 && y >= 0 && x < W && y < H && (rows[y][x] === 'f' || rows[y][x] === 'W');
    const cold = (x, y) => x >= 0 && y >= 0 && x < W && y < H && frame[y][x] !== '.';
    const seen = new Set(), stack = [];
    let all = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!frost(x, y)) continue;
      all++;
      let touches = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (cold(x + dx, y + dy)) touches = true;
      if (touches) { seen.add(y * W + x); stack.push([x, y]); }
    }
    while (stack.length) {
      const [x, y] = stack.pop();
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (frost(x + dx, y + dy) && !seen.has((y + dy) * W + x + dx)) { seen.add((y + dy) * W + x + dx); stack.push([x + dx, y + dy]); }
    }
    assert.equal(seen.size, all, `frame ${f}: ${all - seen.size} frost pixels in mid-air`);
  });
  // Nothing fell, so nothing grew again where it had been: as much frost as without gravity.
  assert.ok(effectOf(compiled).figures.ice.at(-1) <= still * 1.05, `ice ${effectOf(compiled).figures.ice.at(-1)} with gravity, ${still} without`);
});

test('a smooth obstacle that vanishes with heat on lets its water fall, as it does without heat', () => {
  // A smooth shelf holding water vanishes on frame 6. With heat its traced outline stayed behind and held the water up.
  const shelf = heat => compileFluid(tank({ ...(heat && { heat: {} }), obstacles: [{ symbol: 'shelf', x: 4, y: 10, surface: 'smooth', keys: [{ frame: 6, show: false }] }], fill: [{ x: 4, y: 4, w: 16, h: 6 }] })).recipe;
  const [cold, warm] = [shelf(false), shelf(true)].map(recipe => grids(recipe).at(-1));
  assert.equal(warm.slice(0, 12).flat().filter(ch => ch === 'b').length, 0, warm.map(row => row.join('')).join('\n'));
  assert.deepEqual(warm, cold);
});

test('a pool heated from below by an obstacle hotter than the boil steams through bubbles or evaporation, and is warned about without either', () => {
  // Heat moves by temperature, which holds at the boil, so water that boils at the bottom waits there unless bubbles
  // carry it up: without bubbles or evaporation the pool never steams, and the source says so.
  const pool = (heat = {}, vapour = {}) => compileFluid(tank({ frames: 60, heat, vapour, obstacles: [{ symbol: 'plate', x: 0, y: 23, temperature: 4 }], fill: [{ x: 0, y: 16, w: 24, h: 7, temperature: 0.45 }] }));
  const still = pool();
  assert.equal(still.warnings.length, 1);
  assert.match(still.warnings[0], /^fluid\.effects\.e\.obstacles\[0\] is hotter than heat\.boil.*never steams; give vapour\.bubbles .* or heat\.evaporation$/);
  assert.equal(Math.max(...effectOf(still).figures.vapour), 0);
  for (const steaming of [pool({}, { bubbles: { colors: ['w'] } }), pool({ evaporation: 0.05 })]) {
    assert.equal(steaming.warnings, undefined);
    assert.ok(Math.max(...effectOf(steaming).figures.vapour) > 10, 'it steams');
  }
  // An obstacle under the boil, or a liquid with no vapour, is not warned about.
  assert.equal(compileFluid(tank({ heat: {}, vapour: {}, obstacles: [{ symbol: 'plate', x: 0, y: 23, temperature: 0.4 }], fill: [{ x: 0, y: 16, w: 24, h: 7 }] })).warnings, undefined);
  assert.equal(compileFluid(tank({ heat: {}, obstacles: [{ symbol: 'plate', x: 0, y: 23, temperature: 4 }], fill: [{ x: 0, y: 16, w: 24, h: 7 }] })).warnings, undefined);
});

test('a hot plain obstacle over a liquid is never plasma: only gas ionizes', () => {
  // A shelf at 3 (above ionize 2) that warms no air (contact 0): no field anywhere (every electrode at 0 V), so nothing
  // may ionize; it used to count as plasma inside the shelf, and to grow arcs as if it were grounded metal.
  const vapour = { look: [{ field: 'density', colors: ['s'], thresholds: [0.3] }, { field: 'ionization', colors: ['v'], thresholds: [0.1] }, { field: 'current', colors: ['c'], thresholds: [0.25] }] };
  const run = (temperature, voltage) => compileFluid(tank({ frames: 20, heat: { contact: 0, air: 0 }, vapour, obstacles: [{ symbol: 'shelf', x: 4, y: 14, temperature }, { symbol: 'rod', x: 11, y: 6, voltage }], electric: { ground: ['top'] }, fill: [{ x: 0, y: 20, w: 24, h: 4 }] }));
  assert.equal(effectOf(run(3, 0)).peak.ionization, 0);
  // With an electrode at -100 V above it, the hot shelf grows no arcs up off itself: plasma just over it stays as rare as
  // over a shelf at 1.
  const over = recipe => grids(recipe).reduce((n, rows) => n + rows.slice(12, 14).flat().filter(ch => ch === 'v' || ch === 'c').length, 0);
  assert.ok(over(run(3, -100).recipe) <= over(run(1, -100).recipe) + 8, `${over(run(3, -100).recipe)} plasma pixels over the hot shelf, ${over(run(1, -100).recipe)} over the cool one`);
});

test('heat settings that would do nothing are refused, each naming what it needs', () => {
  const rejects = (effect, where, pattern) => assert.throws(() => compileFluid(tank({ fill: [{ x: 0, y: 16, w: 24, h: 8 }], ...effect })), error => error.path === where && pattern.test(error.message), where);
  rejects({ heat: { condense: 0.5 } }, 'fluid.effects.e.heat.condense', /beads up as dew.*give the effect a vapour/);
  rejects({ heat: { deposit: 0.5 }, vapour: {} }, 'fluid.effects.e.heat.deposit', /grows into frost; set frost/);
  rejects({ heat: { branch: 0.5 }, vapour: {} }, 'fluid.effects.e.heat.branch', /frost finger forks; set frost/);
  rejects({ heat: { branch: 0.5 } }, 'fluid.effects.e.heat.branch', /give the effect a vapour/);
  // Plasma never enters ice: the ice's look may not draw it, even with electricity on.
  rejects({ heat: {}, vapour: {}, ice: { look: [{ field: 'ionization', colors: ['v'], thresholds: [0.1] }] }, obstacles: [{ symbol: 'rod', x: 11, y: 2, voltage: -60 }], electric: { ground: ['bottom'] } }, 'fluid.effects.e.ice.look[0].field', /plasma never enters ice.*vapour's look/);
  // With what they need, they compile.
  assert.doesNotThrow(() => compileFluid(tank({ fill: [{ x: 0, y: 16, w: 24, h: 8 }], heat: { condense: 0.5, frost: -0.8, deposit: 0.5, branch: 0.5 }, vapour: {} })));
});
