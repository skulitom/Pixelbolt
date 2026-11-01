import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderProject, PixelError } from '../src/core.js';
import { compileFluid, createLiveFluid } from '../src/fluid.js';

// Plasma drawn by ionization (i), current by c, a glow of current as v; obstacles stamp g (gas never draws them).
const palette = { i: '#4f7cff', c: '#ffffff', v: '#3b2a8c', s: '#888888', g: '#666666', k: '#222222' };
const look = [{ field: 'ionization', colors: ['i'], thresholds: [0.5], dither: 0 }, { field: 'current', colors: ['c'], thresholds: [0.3], dither: 0 }];
const plate = 'g'.repeat(10);
const source = (effect, symbols = {}) => ({ format: 'pixelforge-fluid', version: 1, name: 'arcs', width: 24, height: 24, palette, symbols: { plate: [plate], bar: ['gggg', 'gggg'], ...symbols }, effects: { arcs: { frames: 10, duration: 60, seed: 3, look, emitters: [], ...effect } } });
// Two plates, top and bottom, 18 pixels apart: 40 V across them is about 2.2 V a pixel, and the breakdown is 1.5.
const plates = (top = 40, bottom = 0, extra = []) => [{ symbol: 'plate', x: 7, y: 2, voltage: top, resistance: 20 }, { symbol: 'plate', x: 7, y: 21, voltage: bottom }, ...extra];
const electric = { breakdown: 1.5, focus: 2, growth: 12, recombine: 0.5 };
// Each frame's fluid pixels on the full canvas, from its grid operation.
const grids = recipe => recipe.frames.map(frame => {
  const rows = Array.from({ length: recipe.height }, () => Array(recipe.width).fill('.'));
  for (const op of frame.ops ?? []) if (op.op === 'grid') op.rows.forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== '.') rows[op.y + j][op.x + i] = ch; }));
  return rows;
});
const plasma = ch => ch === 'i' || ch === 'c';
// Whether plasma pixels (touching side to side or at corners) join a pixel beside the row `from` to one beside `to`.
function joins(rows, from, to) {
  const H = rows.length, W = rows[0].length, seen = new Set(), stack = [];
  for (let x = 0; x < W; x++) if (plasma(rows[from + 1][x])) { seen.add(`${x},${from + 1}`); stack.push([x, from + 1]); }
  while (stack.length) {
    const [x, y] = stack.pop();
    if (y === to - 1) return true;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen.has(`${nx},${ny}`) || !plasma(rows[ny][nx])) continue;
      seen.add(`${nx},${ny}`); stack.push([nx, ny]);
    }
  }
  return false;
}
const effectOf = compiled => Object.values(compiled.metadata.effects)[0];

test('an arc joins two electrodes at different voltages, and never forms toward an insulator or floating metal', () => {
  const arc = compileFluid(source({ obstacles: plates(), electric })), frames = grids(arc.recipe);
  assert.ok(frames.some(rows => joins(rows, 2, 21)), 'some frame has plasma from the top plate to the bottom one');
  assert.ok(effectOf(arc).peak.current > 0.3, 'and current runs through it');
  // The same top plate facing a plain obstacle, or metal at no set voltage, has nothing to arc to: no field, no plasma.
  for (const other of [{ symbol: 'plate', x: 7, y: 21 }, { symbol: 'plate', x: 7, y: 21, conductor: true }]) {
    const lone = compileFluid(source({ obstacles: [plates()[0], other], electric }));
    assert.equal(effectOf(lone).peak.ionization, 0, JSON.stringify(other));
    assert.deepEqual(effectOf(lone).pixels, Array(10).fill(0));
  }
});

test('metal between two electrodes carries the arc: the plasma reaches it from both sides', () => {
  const bar = { symbol: 'bar', x: 10, y: 11 };
  const withMetal = grids(compileFluid(source({ obstacles: plates(40, 0, [{ ...bar, conductor: true }]), electric })).recipe);
  const touches = (rows, y) => [10, 11, 12, 13].some(x => [-1, 0, 1].some(dx => plasma(rows[y][x + dx])));
  assert.ok(withMetal.some(rows => touches(rows, 10) && touches(rows, 13)), 'plasma above and below the metal bar in one frame');
});

test('with no voltage, or a field below breakdown, nothing ionizes', () => {
  for (const [top, label] of [[0, 'no voltage'], [12, 'below breakdown']]) {
    const effect = effectOf(compileFluid(source({ obstacles: plates(top), electric })));
    assert.equal(effect.peak.ionization, 0, label);
    assert.equal(effect.peak.current, 0, label);
  }
  // An electric effect with only an ideal electrode at 0 V still compiles, and stays dark.
  assert.equal(effectOf(compileFluid(source({ obstacles: [{ symbol: 'plate', x: 7, y: 2, voltage: 0 }] }))).peak.ionization, 0);
});

test('electricity adds no smoke and no heat but its own: the same smoke with arcs and heating 0 matches the smoke without', () => {
  // Smoke in a closed box between the plates. With heating 0 the arcs leave the gas alone, so density and temperature
  // follow exactly the run with no voltage; with heating, current warms the gas.
  const run = (top, heating) => effectOf(compileFluid(source({
    walls: ['left', 'right', 'top', 'bottom'], obstacles: plates(top), electric: { ...electric, heating },
    emitters: [{ at: [12, 12], radius: 4, burst: 1, density: 1 }], look: [{ field: 'density', colors: ['s'], thresholds: [0.2] }, ...look]
  })));
  const still = run(0, 0), arcs = run(40, 0), hot = run(40, 1);
  assert.ok(arcs.peak.current > 0.3, 'the arcs ran');
  assert.deepEqual(arcs.figures.amount, still.figures.amount);
  assert.equal(arcs.peak.temperature, still.peak.temperature);
  assert.equal(still.peak.temperature, 0);
  assert.ok(hot.peak.temperature > 0.1, `current heats the gas (${hot.peak.temperature})`);
});

test('a second strike runs down the channel the first one left, unless memory is 0', () => {
  // A charge strikes twice, frames 0–5 and 12–16; the plasma of the second stroke as it lands is compared with the first's.
  const strokes = [{ frame: 0, voltage: 40 }, { frame: 6, voltage: 0 }, { frame: 12, voltage: 40 }, { frame: 17, voltage: 0 }];
  const overlap = memory => {
    const frames = grids(compileFluid(source({ frames: 20, obstacles: [{ ...plates()[0], voltage: strokes }, plates()[1]], electric: { ...electric, focus: 1.5, memory } })).recipe);
    const first = new Set(), second = [];
    frames[5].forEach((row, y) => row.forEach((ch, x) => { if (plasma(ch)) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) first.add(`${x + dx},${y + dy}`); }));
    frames[15].forEach((row, y) => row.forEach((ch, x) => { if (plasma(ch)) second.push(`${x},${y}`); }));
    assert.ok(second.length > 10, `the second stroke strikes (${second.length} pixels)`);
    return second.filter(at => first.has(at)).length / second.length;
  };
  const kept = overlap(12), fresh = overlap(0);
  assert.ok(kept > 0.8, `the restrike follows the old channel (${kept.toFixed(2)})`);
  assert.ok(kept > fresh + 0.15, `more than a fresh strike does (${kept.toFixed(2)} against ${fresh.toFixed(2)})`);
});

test('hot gas is plasma with ionize, with no electrode and no current', () => {
  const effect = effectOf(compileFluid(source({ obstacles: [], electric: { ionize: 1 }, emitters: [{ at: [12, 12], radius: 3, burst: 1, temperature: 2 }] })));
  assert.equal(effect.peak.ionization, 1);
  assert.equal(effect.peak.current, 0);
});

test('a look layer\'s halo glows round what it drew, on empty pixels only', () => {
  const glow = [look[0], { ...look[1], halo: { color: 'v', width: 1 } }];
  const frames = grids(compileFluid(source({ obstacles: plates(), electric, look: glow })).recipe);
  let halo = 0;
  for (const rows of frames) rows.forEach((row, y) => row.forEach((ch, x) => {
    if (ch !== 'v') return;
    halo++;
    assert.ok([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => rows[y + dy]?.[x + dx] === 'c'), `halo pixel ${x},${y} beside the current`);
  }));
  assert.ok(halo > 0);
});

test('electric effects are deterministic, and a live run from warmup 0 reproduces a one-shot compile', async () => {
  const lightning = JSON.parse(await readFile(new URL('../examples/lightning.fluid.json', import.meta.url), 'utf8'));
  const short = structuredClone(lightning), [effect] = Object.values(short.effects);
  effect.frames = 10;
  effect.obstacles[1].voltage = [{ frame: 0, voltage: -240 }, { frame: 7, voltage: 0 }];
  const compiled = compileFluid(short);
  assert.deepEqual(compileFluid(structuredClone(short)), compiled);
  const project = renderProject(compiled.recipe), live = createLiveFluid(short, { warmup: 0 });
  project.animations.lightning.frames.forEach((index, f) => {
    live.step();
    assert.deepEqual(Array.from(live.render().rgba), Array.from(project.frames[index].data), `frame ${f}`);
  });
});

test('electric settings are checked, each error naming its field', () => {
  const fails = (effect, path, extra = {}) => assert.throws(() => compileFluid(source(effect, extra)), error => error instanceof PixelError && error.path === path, path);
  fails({ kind: 'liquid', fill: [{ x: 2, y: 4, w: 4, h: 4 }], obstacles: plates() }, 'fluid.effects.arcs.obstacles[0].voltage');
  fails({ kind: 'liquid', fill: [{ x: 2, y: 4, w: 4, h: 4 }], electric: {} }, 'fluid.effects.arcs.electric');
  fails({ obstacles: [{ symbol: 'plate', x: 7, y: 2, resistance: 4 }], emitters: [{ at: [4, 4], rate: 1, density: 1 }] }, 'fluid.effects.arcs.obstacles[0].resistance');
  fails({ obstacles: [{ symbol: 'plate', x: 7, y: 2, voltage: 10, charge: 1 }] }, 'fluid.effects.arcs.obstacles[0].charge');
  fails({ obstacles: [{ symbol: 'plate', x: 7, y: 2, voltage: 10, conductor: true }] }, 'fluid.effects.arcs.obstacles[0].conductor');
  fails({ obstacles: [{ symbol: 'plate', x: 7, y: 2, voltage: [{ frame: 4, voltage: 1 }, { frame: 2, voltage: 0 }] }] }, 'fluid.effects.arcs.obstacles[0].voltage[1].frame');
  fails({ obstacles: plates(), electric: { ground: ['up'] } }, 'fluid.effects.arcs.electric.ground');
  fails({ obstacles: plates(), electric: { focus: 0 } }, 'fluid.effects.arcs.electric.focus');
  fails({ obstacles: plates(), electric: { spark: 1 } }, 'fluid.effects.arcs.electric.spark');
  fails({ obstacles: Array.from({ length: 9 }, (_, i) => ({ symbol: 'plate', x: 0, y: i * 2, voltage: i })) }, 'fluid.effects.arcs.electric');
  fails({ obstacles: plates(), look: [{ ...look[1], halo: { width: 1 } }] }, 'fluid.effects.arcs.look[0].halo.color');
  // Without electricity, an ionization or current layer has nothing to draw, and a gas still needs an emitter.
  fails({ emitters: [{ at: [4, 4], rate: 1, density: 1 }] }, 'fluid.effects.arcs.look[0].field');
  fails({ look: [{ field: 'density', colors: ['s'], thresholds: [0.5] }] }, 'fluid.effects.arcs.emitters');
  // An unseen charge: a decoration with a voltage may be drawn not at all.
  assert.doesNotThrow(() => compileFluid(source({ obstacles: [{ symbol: 'plate', x: 7, y: 2, solid: false, draw: 'none', voltage: 40 }, plates()[1]], electric })));
});
