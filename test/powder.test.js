import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderProject } from '../src/core.js';
import { startMCP } from '../src/mcp.js';
import { createLivePowder, compilePowder, packStrokes, unpackStrokes, replayStrokes, sandboxSource, SANDBOX, POWDER_INPUTS } from '../src/powder.js';
import { packageFiles } from '../scripts/build-studio.mjs';
import { goldens } from '../scripts/goldens.mjs';
import { powderPresets } from '../scripts/powder-presets.mjs';
import { POWDER_SHOWCASE, buildPowderGIFs } from '../showcase/powder/build.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// The compiled recipe of every preset, in test/goldens/powder.json. They change with any change to what the grid does
// or draws: node scripts/goldens.mjs powder draws them before and after, and --write updates them.
const golden = goldens(new URL('./goldens/powder.json', import.meta.url));

const digest = live => createHash('sha256').update(live.render().rgba).digest('hex');
const column = (live, x) => Array.from({ length: live.height }, (_, y) => live.at(x, y).material);
const cellsOf = (live, name) => { const id = live.materials.indexOf(name) + 1, out = []; live.cells.mat.forEach((m, c) => { if (m === id) out.push(c); }); return out; };
// A wooden hut on stilts over a pool, by a lava pocket: most of the engine at once.
const hutScene = seed => sandboxSource(96, 64, [
  { material: 'stone', rect: [0, 60, 96, 4] }, { material: 'water', rect: [10, 44, 70, 16] }, { material: 'oil', rect: [20, 42, 20, 2] },
  { material: 'stone', rect: [80, 30, 16, 30] }, { material: 'lava', rect: [82, 22, 12, 8] },
  { material: 'wood', rect: [20, 30, 24, 3] }, { material: 'wood', rect: [20, 20, 24, 2] }, { material: 'wood', rect: [21, 33, 2, 27] }, { material: 'wood', rect: [41, 33, 2, 27] }
], seed);

test('the same source and the same inputs draw the same pixels; another seed differs', () => {
  const run = seed => {
    const live = createLivePowder(hutScene(seed));
    live.step(20).heat({ x: 22, y: 31, radius: 2.5, amount: 900 }).step(140);
    return digest(live);
  };
  assert.equal(run(3), run(3));
  assert.notEqual(run(3), run(4));
});

test('a recording past 65,536 strokes stops, and recordedUntil says how many frames a replay is exact for', () => {
  const source = sandboxSource(16, 16, [{ material: 'stone', rect: [0, 12, 16, 4] }]);
  const live = createLivePowder(source, { record: true }), heat = () => live.heat({ x: 8, y: 13, radius: 0.5, amount: 1 });
  for (let f = 0; f < 16; f++) { for (let k = 0; k < 4096; k++) heat(); live.step(); }
  assert.equal(live.recordedUntil, null, 'every stroke so far is recorded');
  const at16 = Int32Array.from(live.cells.temp);
  heat();
  assert.equal(live.recordedUntil, 16, 'the first stroke left out was on frame 16');
  live.step().wall({ x: 4, y: 4, radius: 2 }).step();
  assert.equal(live.strokes.length, 65536);
  assert.equal(live.recordedUntil, 16, 'and nothing more is recorded');
  assert.deepEqual(replayStrokes(createLivePowder(source), live.strokes, live.recordedUntil).cells.temp, at16, 'a replay is exact up to recordedUntil');
  assert.equal(createLivePowder(source).recordedUntil, null, 'without a recording it stays null');
});

test('recorded strokes replay exactly through the packed form', () => {
  const source = sandboxSource(64, 48, [{ material: 'stone', rect: [0, 44, 64, 4] }, { material: 'wood', rect: [40, 30, 10, 14] }]);
  const live = createLivePowder(source, { record: true });
  for (let f = 0; f < 90; f++) {
    if (f < 30) live.paint({ material: 'sand', x: 10.3 + f / 4, y: 4.7, x2: 10 + f / 5, y2: 5.2, radius: 2.25, fill: 0.4 });
    if (f === 10) live.wall({ x: 20, y: 30, x2: 34, y2: 34, radius: 1.5 });
    if (f >= 20 && f < 50) live.paint({ material: 'water', x: 30, y: 3, radius: 2, fill: 0.5 });
    if (f === 40) live.heat({ x: 45, y: 40, radius: 3, amount: 700 });
    if (f === 60) live.erase({ x: 20.5, y: 32, radius: 3 });
    if (f === 70) live.paint({ material: 'lava', x: 50, y: 5, radius: 3, replace: true });
    if (f === 75) live.push({ x: 30, y: 20, x2: 40, y2: 18, radius: 6, vx: 1.5, vy: -0.75 });
    if (f === 80) live.burst({ x: 15, y: 40, radius: 5, strength: 2.5 });
    live.step();
  }
  const bytes = packStrokes(live.strokes, live.frame), { frames, strokes } = unpackStrokes(bytes);
  assert.equal(frames, 90);
  assert.deepEqual(strokes, live.strokes);
  const again = replayStrokes(createLivePowder(source), strokes, frames);
  assert.equal(digest(again), digest(live));
  assert.deepEqual(again.cells.temp, live.cells.temp);
});

test('heavier sinks through lighter: sand under water under oil', () => {
  const live = createLivePowder(sandboxSource(8, 40, [
    { material: 'oil', rect: [0, 0, 8, 6] }, { material: 'water', rect: [0, 6, 8, 6] }, { material: 'sand', rect: [0, 12, 8, 6] }
  ]));
  // Upside down: oil on top falls first, then water, then sand; they must sort by density.
  const flipped = createLivePowder(sandboxSource(8, 40, [
    { material: 'sand', rect: [0, 0, 8, 6] }, { material: 'water', rect: [0, 6, 8, 6] }, { material: 'oil', rect: [0, 12, 8, 6] }
  ]));
  for (const run of [live, flipped]) {
    run.step(600);
    const order = column(run, 4).filter(name => name !== 'empty');
    const firstOf = name => order.indexOf(name), lastOf = name => order.lastIndexOf(name);
    assert.ok(lastOf('oil') < firstOf('water') + 2, `oil floats on water: ${order.join(' ')}`);
    assert.ok(lastOf('water') < firstOf('sand') + 2, `sand sinks under water: ${order.join(' ')}`);
  }
});

test('water meeting lava becomes steam and stone; fire spreads through wood and leaves ash or nothing', () => {
  const live = createLivePowder(sandboxSource(48, 40, [
    { material: 'stone', rect: [0, 36, 48, 4] }, { material: 'water', rect: [2, 26, 16, 10] }, { material: 'lava', rect: [6, 10, 6, 4] },
    { material: 'wood', rect: [30, 20, 6, 16] }, { material: 'wood', rect: [30, 33, 6, 3], burning: true }
  ]));
  const before = live.measure().counts;
  live.step(120);
  const mid = live.measure();
  // 18 cells were lit; by now about 38 burn (28 to 56 over seeds).
  assert.ok(mid.burning > 24, `the lit wood burns and lights more (${mid.burning} burning)`);
  assert.ok((mid.counts.fire ?? 0) > 0, 'burning wood gives off fire');
  live.step(480);
  const after = live.measure().counts;
  assert.ok(after.stone > before.stone, 'lava quenched by water leaves stone');
  assert.ok((after.lava ?? 0) < before.lava);
  assert.ok((after.wood ?? 0) < before.wood / 2, 'most of the wood burned');
  assert.ok((after.ash ?? 0) > 0, 'burnt wood leaves ash');
});

test('conduction moves heat exactly: with no cooling and no sources, total heat never changes', () => {
  const source = { format: 'pixelforge-powder', width: 24, height: 16, air: { conduct: 0.3, cool: 0 }, materials: { stone: { state: 'solid', conduct: 1, colors: ['#666666'] }, wool: { state: 'solid', conduct: 0.05, colors: ['#ffffff'] } },
    scene: [{ material: 'stone', rect: [0, 8, 24, 8] }, { material: 'wool', rect: [4, 2, 6, 6] }, { material: 'stone', disc: [12, 12, 3], temperature: 900 }] };
  const live = createLivePowder(source), total = () => live.cells.temp.reduce((sum, v) => sum + v, 0), start = total();
  const hot = live.at(12, 12).temperature;
  live.step(200);
  assert.equal(total(), start);
  assert.ok(live.at(12, 12).temperature < hot, 'the hot spot spread out');
  assert.ok(live.at(0, 15).temperature > 20, 'and warmed the far corner');
});

test('latent heat: a hot stone boils only a few cells of water', () => {
  const live = createLivePowder(sandboxSource(16, 20, [{ material: 'water', rect: [0, 8, 16, 12] }, { material: 'stone', rect: [6, 14, 4, 4], temperature: 1000 }]));
  const water = live.measure().counts.water;
  live.step(400);
  assert.ok(live.measure().counts.water > water - 30, `boiled ${water - live.measure().counts.water} cells`);
});

test('mistakes in the table are named by path', () => {
  const bad = (change, pattern) => {
    const source = sandboxSource(16, 16);
    change(source);
    assert.throws(() => createLivePowder(source), pattern);
  };
  bad(s => { s.materials.sand.state = 'goo'; }, /materials\.sand\.state: expected one of powder/);
  bad(s => { s.reactions.push({ a: 'water', b: 'mud' }); }, /reactions\[8\]\.b: no material named "mud"/);
  bad(s => { s.materials.water.above.into = 'water'; }, /water\.above\.into: a material cannot change into itself/);
  bad(s => { s.materials.stone.density = 20; }, /stone\.density: fixed solids do not move/);
  bad(s => { s.materials.sand.falls = true; }, /sand\.falls: only solids fall as pieces/);
  bad(s => { s.wall = 'wood'; }, /powder\.wall: the wall material must be a fixed solid/);
  bad(s => { s.materials.water.colorBy = 'density'; }, /water\.colorBy: "density" draws a gas or flame/);
  bad(s => { s.materials.smoke.haze = '#000000'; }, /smoke\.haze: a gas drawn by density makes its own haze/);
  bad(s => { s.materials.stone.streak = '#ffffff'; }, /stone\.streak: a streak trails falling powders and liquids/);
  bad(s => { s.gravity = 2; }, /powder\.gravity: expected a number from 0\.02 to 1/);
  bad(s => { s.air.flow.cell = 1; }, /powder\.air\.flow\.cell: expected a whole number from 2 to 16/);
  bad(s => { s.air.flow.wind = [3, 0]; }, /powder\.air\.flow\.wind\[0\]: expected a number from -2 to 2/);
  bad(s => { s.air.flow.gusts = 1; }, /powder\.air\.flow\.gusts: unknown field/);
  assert.throws(() => createLivePowder({ ...sandboxSource(16, 16), air: {} }).push({ x: 4, y: 4, vx: 1 }), /push: the source has no moving air; set air\.flow/);
  bad(s => { s.reactions.push({ a: 'lava', b: 'water' }); }, /lava and water already react/);
  bad(s => { s.materials.sand.colors = ['#ff000080']; }, /sand\.colors\[0\]: materials are drawn opaque/);
});

test('the engine draws no random numbers or trigonometry of its own', async () => {
  const code = await readFile(new URL('../src/powder.js', import.meta.url), 'utf8');
  assert.doesNotMatch(code, /Math\.(random|sin|cos|tan|atan2?|exp|log|pow)\s*\(/);
});

test('render keys name a palette colour per pixel, "." where nothing is', () => {
  const live = createLivePowder(sandboxSource(12, 8, [{ material: 'sand', rect: [0, 6, 12, 2] }]));
  const { keys } = live.render();
  assert.equal(keys.length, 8);
  assert.equal(keys[0], '.'.repeat(12));
  for (const key of keys[7]) assert.ok(Object.hasOwn(live.palette, key));
  assert.ok(SANDBOX.materials.sand.colors.includes(live.palette[keys[7][0]]));
});

test('falls speed up: a dropped grain covers more ground each frame, up to a top speed', () => {
  const live = createLivePowder(sandboxSource(8, 200, [{ material: 'sand', rect: [3, 0, 1, 1] }]));
  const depth = () => Math.floor(cellsOf(live, 'sand')[0] / 8);
  live.step(10);
  const early = depth();
  live.step(10);
  const later = depth() - early;
  assert.ok(early >= 10 && later > early + 5, `fell ${early} pixels in the first 10 frames and ${later} in the next 10`);
  live.step(10);
  assert.ok(live.at(3, depth()).velocity[1] <= 6, 'never faster than 6 pixels a frame');
});

test('a block of water dropped on a floor splashes up and surges sideways, then comes to rest', () => {
  const live = createLivePowder(sandboxSource(96, 48, [{ material: 'stone', rect: [0, 44, 96, 4] }, { material: 'water', rect: [40, 2, 16, 8] }]));
  let rose = 0, widest = 0;
  for (let f = 0; f < 90; f++) {
    live.step();
    rose += live.cells.vy.filter((v, c) => v < 0 && live.cells.mat[c]).length;
    const xs = cellsOf(live, 'water').map(c => c % 96);
    widest = Math.max(widest, Math.max(...xs) - Math.min(...xs));
  }
  assert.ok(rose > 0, 'some water was thrown back up');
  assert.ok(widest > 60, `the landing spread the water ${widest} pixels wide`);
  live.step(600);
  const before = Uint8Array.from(live.cells.mat);
  live.step(60);
  assert.deepEqual(live.cells.mat, before, 'a puddle comes to rest');
});

test('a pool levels to rest: water poured in stops moving', () => {
  const live = createLivePowder(sandboxSource(64, 40, [{ material: 'stone', rect: [0, 36, 64, 4] }, { material: 'stone', rect: [0, 16, 2, 20] }, { material: 'stone', rect: [62, 16, 2, 20] }]));
  for (let f = 0; f < 120; f++) live.paint({ material: 'water', x: 20.5, y: 2.5, radius: 1.5, fill: 0.6 }).step();
  live.step(900);
  const before = Uint8Array.from(live.cells.mat);
  live.step(60);
  assert.deepEqual(live.cells.mat, before);
  // The surface is flat but for a strip against each bank: no column of water is two or more pixels higher than another.
  const tops = [];
  for (let x = 2; x < 62; x++) tops.push(column(live, x).indexOf('water'));
  assert.ok(Math.max(...tops) - Math.min(...tops) <= 1, `surface rows ${[...new Set(tops)].join(', ')}`);
});

test('left and right are alike: a source drawn mirrored runs the mirrored way as often', () => {
  // Each scene is run as drawn and mirrored, over the same seeds; `left` and `right` count the water that ends beyond
  // x0 and x1 (and their mirror images), so [far, near] is the far side and the near side of whatever is off centre.
  const W = 96, H = 48, SEEDS = 16;
  const mirrored = scene => scene.map(entry => ({ ...entry, rect: [W - entry.rect[0] - entry.rect[2], ...entry.rect.slice(1)] }));
  const tally = (scene, frames, tap, x0, x1) => [false, true].map(flip => {
    const total = [0, 0];
    let wins = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const live = createLivePowder(sandboxSource(W, H, flip ? mirrored(scene) : scene, seed));
      for (let f = 0; f < frames; f++) {
        if (tap) live.paint({ material: 'water', x: (flip ? W - tap : tap) - 2, x2: (flip ? W - tap : tap) + 2, y: 4.5, radius: 0.5, fill: 0.1 });
        live.step();
      }
      const xs = cellsOf(live, 'water').map(c => (flip ? W - 1 - (c % W) : c % W)), left = xs.filter(x => x < x0).length, right = xs.filter(x => x >= x1).length;
      total[0] += left; total[1] += right;
      if (left > right) wins++;
    }
    return { share: total[0] / (total[0] + total[1]), wins };
  });
  // A block of water on a table that stands nearer the grid's left edge: as much runs off each end, whichever end faces
  // the nearer edge, and neither end gets more every time. (With every row one way, and rows read by turns, a third
  // ran off the left end and two thirds off the right, as drawn and mirrored alike, the same end ahead on every seed.)
  const table = tally([{ material: 'stone', rect: [0, 44, W, 4] }, { material: 'stone', rect: [12, 28, 32, 16] }, { material: 'water', rect: [20, 12, 16, 16] }], 160, 0, 12, 44);
  for (const [run, name] of [[table[0], 'as drawn'], [table[1], 'mirrored']]) {
    assert.ok(run.share > 0.4 && run.share < 0.6, `off the table ${name}: ${run.share.toFixed(3)} of the water ran off the end nearer the grid's edge`);
    assert.ok(run.wins >= 3 && run.wins <= SEEDS - 3, `off the table ${name}: that end got more on ${run.wins} of ${SEEDS} seeds`);
  }
  // A pool between two rims, a tap over it nearer the left rim: the nearer rim spills more, by the same share when the
  // whole source is mirrored. (It was 0.44 as drawn and 0.64 mirrored: the right rim spilled more either way round.)
  const [drawn, flipped] = tally([{ material: 'stone', rect: [0, 44, W, 4] }, { material: 'stone', rect: [16, 30, 48, 14] }, { material: 'stone', rect: [16, 24, 3, 6] }, { material: 'stone', rect: [61, 24, 3, 6] }, { material: 'water', rect: [19, 26, 42, 4] }], 500, 36.5, 16, 64);
  assert.ok(drawn.share > 0.5 && flipped.share > 0.5, `the rim nearer the tap spills more: ${drawn.share.toFixed(3)} as drawn, ${flipped.share.toFixed(3)} mirrored`);
  assert.ok(Math.abs(drawn.share - flipped.share) < 0.08, `and the same share mirrored: ${drawn.share.toFixed(3)} as drawn, ${flipped.share.toFixed(3)} mirrored`);
});

test('a pool levels under what floats on it: a river skinned with ash, or under oil, while water runs down both banks', () => {
  // A gorge holding a river, water poured down both walls. The water sinks through the skin where it lands; it must
  // then run on under the skin, not stand against the walls. (It stood in a V, 20 rows deep under ash and 10 under oil,
  // and stayed so when the pouring stopped.)
  const W = 64, H = 72;
  for (const [skin, deep] of [['ash', 1], ['oil', 2]]) for (const seed of [1, 2]) {
    const live = createLivePowder(sandboxSource(W, H, [
      { material: 'stone', rect: [0, 68, W, 4] }, { material: 'stone', rect: [0, 20, 8, 48] }, { material: 'stone', rect: [56, 20, 8, 48] },
      { material: 'water', rect: [8, 52, 48, 16] }, { material: skin, rect: [8, 52 - deep, 48, deep] }
    ], seed));
    // The top of the water standing on the floor, column by column: how many rows its highest is over its lowest.
    const apart = () => {
      const tops = [];
      for (let x = 8; x < 56; x++) { const rows = column(live, x); let y = 67; while (rows[y - 1] === 'water') y--; tops.push(y); }
      return Math.max(...tops) - Math.min(...tops);
    };
    for (let f = 0; f < 300; f++) live.paint({ material: 'water', x: 8.5, x2: 10.5, y: 4.5, radius: 0.5, fill: 0.3 }).paint({ material: 'water', x: 53.5, x2: 55.5, y: 4.5, radius: 0.5, fill: 0.3 }).step();
    assert.ok(apart() <= 8, `under ${skin}, seed ${seed}: the river is ${apart()} rows higher by the walls while it pours`);
    live.step(500);
    const before = Uint8Array.from(live.cells.mat);
    live.step(60);
    assert.deepEqual(live.cells.mat, before, `under ${skin}, seed ${seed}: it comes to rest`);
    assert.ok(apart() <= 1, `under ${skin}, seed ${seed}: and lies level (${apart()} rows apart)`);
    assert.ok(cellsOf(live, skin).every(c => Math.floor(c / W) < 52), `the ${skin} still floats on it`);
  }
});

test('solids that fall: a loose piece drops as one, floats on water if lighter, and a fixed solid stays put', () => {
  const live = createLivePowder(sandboxSource(48, 48, [
    { material: 'stone', rect: [0, 44, 48, 4] }, { material: 'water', rect: [0, 30, 48, 14] },
    { material: 'wood', rect: [10, 4, 8, 3] }, { material: 'stone', rect: [30, 4, 8, 3] },
    // A beam held by a post that stands on the floor.
    { material: 'wood', rect: [26, 12, 16, 2] }, { material: 'wood', rect: [40, 14, 2, 30] }
  ]));
  const raft = () => cellsOf(live, 'wood').filter(c => c % 48 < 20);
  const shape = cells => cells.map(c => c - cells[0]).join();
  const start = shape(raft());
  live.step(60);
  assert.equal(shape(raft()), start, 'the raft kept its shape');
  const rows = raft().map(c => Math.floor(c / 48));
  assert.ok(Math.max(...rows) <= 30 && Math.max(...rows) >= 28, `the raft floats on the water (rows ${Math.min(...rows)} to ${Math.max(...rows)})`);
  assert.equal(live.at(30, 4).material, 'stone', 'fixed stone stays where it is drawn');
  assert.equal(live.at(26, 12).material, 'wood', 'the beam is held by its post');
  // Take the post away: the beam falls to the water. (Cut only partway, it would settle on the stub.)
  live.erase({ x: 41, y: 14, x2: 41, y2: 44, radius: 1.5 }).step(40);
  assert.notEqual(live.at(26, 12).material, 'wood');
  assert.ok(cellsOf(live, 'wood').some(c => c % 48 === 26 && Math.floor(c / 48) >= 27), 'the beam fell to the water');
});

test('drawing: fast drops trail streaks, gases draw as clouds and a lone gas cell is not drawn', () => {
  const live = createLivePowder(sandboxSource(16, 80, [{ material: 'water', rect: [8, 0, 1, 1] }]));
  live.step(24);
  const drop = cellsOf(live, 'water')[0], keys = live.render().keys, { palette } = live, x = drop % 16, y = Math.floor(drop / 16);
  assert.ok(live.at(x, y).velocity[1] >= 2);
  assert.equal(palette[keys[y - 1][x]], SANDBOX.materials.water.streak, 'a streak above the falling drop');
  const still = createLivePowder(sandboxSource(16, 80, [{ material: 'smoke', rect: [0, 70, 6, 6] }, { material: 'steam', rect: [12, 74, 1, 1] }]));
  const fresh = still.render().keys, smoke = SANDBOX.materials.smoke.colors;
  assert.equal(still.palette[fresh[73][2]], smoke.at(-1), 'the middle of a full cloud is its thickest colour');
  assert.ok(smoke.includes(still.palette[fresh[69][2]]), 'the pixel above the cloud is hazed');
  assert.equal(fresh[74][12], '.', 'the lone steam cell is not drawn');
});

test('settled regions: a quiet scene stops costing steps, a poke wakes what it reaches, and heat crosses into sleeping chunks', () => {
  const live = createLivePowder(sandboxSource(128, 96, [
    { material: 'stone', rect: [0, 88, 128, 8] }, { material: 'sand', rect: [4, 60, 40, 28] },
    { material: 'stone', rect: [60, 56, 4, 32] }, { material: 'stone', rect: [124, 56, 4, 32] }, { material: 'water', rect: [64, 64, 60, 24] }
  ]));
  live.step(300);
  assert.deepEqual(live.measure().chunks, { stepped: 0, of: 48 }, 'everything has settled');
  live.paint({ material: 'sand', x: 100.5, y: 8.5, radius: 2 }).step();
  const woken = live.measure().chunks.stepped;
  assert.ok(woken >= 1 && woken <= 4, `the poke woke ${woken} chunks`);
  live.step(300);
  assert.equal(live.measure().chunks.stepped, 0, 'and the sand sank into the pool and settled again');
  // A hot spot in a settled slab: the heat spreads over chunk edges, exactly.
  const slab = createLivePowder({ format: 'pixelforge-powder', width: 64, height: 48, air: { conduct: 0, cool: 0 }, materials: { stone: { state: 'solid', conduct: 1, colors: ['#666666'] } }, scene: [{ material: 'stone', rect: [0, 0, 64, 48] }] });
  slab.step(2);
  assert.equal(slab.measure().chunks.stepped, 0);
  const total = () => slab.cells.temp.reduce((sum, v) => sum + v, 0);
  slab.heat({ x: 8, y: 8, radius: 3, amount: 1500 }).step();
  const start = total();
  slab.step(400);
  assert.equal(total(), start);
  assert.ok(slab.at(34, 8).temperature > 20 && slab.at(30, 30).temperature > 20, 'two chunks away warmed');
});

test('settled regions: a cell that stops without moving still sinks or drifts, held back by drag or landing on a pool', () => {
  // A grain dropped into a deep still pool reaches the floor: each failed chance to sink through the water keeps its
  // chunk awake, and so does a fall that ends without a move.
  for (const seed of [1, 2, 3]) {
    const live = createLivePowder(sandboxSource(64, 64, [{ material: 'stone', rect: [0, 60, 64, 4] }, { material: 'water', rect: [0, 16, 64, 44] }], seed));
    live.step(5).paint({ material: 'sand', x: 32.5, y: 4.5, radius: 0.5 }).step(400);
    const [grain] = cellsOf(live, 'sand');
    assert.equal(Math.floor(grain / 64), 59, `seed ${seed}: the grain sank to the floor (row ${Math.floor(grain / 64)})`);
  }
  // A drop landing on a still pool drifts along its surface as a lone cell does, rather than freezing where it landed.
  for (const seed of [1, 2, 3]) {
    const live = createLivePowder(sandboxSource(64, 48, [{ material: 'stone', rect: [0, 44, 64, 4] }, { material: 'water', rect: [0, 30, 64, 14] }], seed));
    live.step(5).paint({ material: 'water', x: 20.5 + seed, y: 27.5, radius: 0.5 }).step(400);
    const above = cellsOf(live, 'water').filter(c => c < 64 * 30).map(c => c % 64);
    assert.ok(above.every(x => x === 0 || x === 63), `seed ${seed}: the drop drifted to the side (x ${above.join(', ')})`);
  }
});

test('settled regions: a liquid that sees a drop up to FAR along its row wakes when one opens in a sleeping chunk', () => {
  const live = createLivePowder(sandboxSource(64, 32, [{ material: 'stone', rect: [0, 20, 64, 2] }, { material: 'water', rect: [2, 19, 1, 1] }]));
  live.step(30);
  assert.equal(live.measure().chunks.stepped, 0);
  assert.deepEqual(cellsOf(live, 'water'), [19 * 64 + 2], 'the drop rests on the shelf');
  // A hole 33 pixels away, two chunks over: the drop runs to it and falls in.
  live.erase({ x: 35.5, y: 20.5, radius: 0.5 }).step(60);
  assert.deepEqual(cellsOf(live, 'water'), [20 * 64 + 35], 'the drop drained into the hole');
});

test('settled regions: pools of viscous liquids come to rest', () => {
  for (const liquid of ['oil', 'lava']) {
    const source = sandboxSource(64, 40, [{ material: 'stone', rect: [0, 36, 64, 4] }, { material: 'stone', rect: [0, 0, 2, 40] }, { material: 'stone', rect: [62, 0, 2, 40] }, { material: liquid, rect: [2, 8, 60, 10] }]);
    // Lava kept molten: no cooling into stone, as hot as the air.
    if (liquid === 'lava') { delete source.materials.lava.below; delete source.materials.stone.above; source.ambient = 1200; }
    const live = createLivePowder(source).step(300);
    assert.equal(live.measure().chunks.stepped, 0, `the ${liquid} pool sleeps`);
  }
});

test('moving air: heat lifts it, the wind carries smoke and ash, a push stirs it and gases leave through the open top', () => {
  const windy = wind => { const source = sandboxSource(96, 64, [{ material: 'stone', rect: [0, 60, 96, 4] }, { material: 'smoke', rect: [20, 30, 8, 8] }]); source.air.flow.wind = wind; return createLivePowder(source); };
  const meanX = live => { const xs = cellsOf(live, 'smoke').map(c => c % 96); return xs.reduce((a, b) => a + b, 0) / xs.length; };
  const calm = windy([0, 0]), breezy = windy([1, 0]);
  calm.step(40); breezy.step(40);
  assert.ok(meanX(breezy) > meanX(calm) + 12, `the wind carried the smoke (${meanX(calm).toFixed(1)} still, ${meanX(breezy).toFixed(1)} in the wind)`);
  // A fire under open air makes an updraft above it, and none inside the stone floor.
  const fire = createLivePowder(sandboxSource(64, 64, [{ material: 'stone', rect: [0, 56, 64, 8] }, { material: 'wood', rect: [24, 48, 16, 8], burning: true }]));
  fire.step(60);
  assert.ok(fire.at(32, 36).air[1] < -0.2, `air above the fire rises (${fire.at(32, 36).air[1].toFixed(2)} pixels a frame)`);
  assert.deepEqual(fire.at(10, 61).air, [0, 0], 'no air moves inside the floor');
  // A push sweeps smoke along.
  const pushed = windy([0, 0]), before = meanX(pushed);
  for (let f = 0; f < 10; f++) pushed.push({ x: 24, y: 34, radius: 10, vx: 2, vy: 0 }).step();
  assert.ok(meanX(pushed) > before + 6, 'the push moved the smoke');
  // Smoke that reaches the open top leaves.
  const rising = createLivePowder(sandboxSource(32, 24, [{ material: 'smoke', rect: [8, 2, 16, 4] }]));
  rising.step(60);
  assert.ok((rising.measure().counts.smoke ?? 0) < 20, 'the smoke rose out of the top');
});

test('a burst blows loose powders and liquids outward and leaves solids where they are', () => {
  const live = createLivePowder(sandboxSource(96, 64, [{ material: 'stone', rect: [0, 56, 96, 8] }, { material: 'sand', rect: [36, 44, 24, 12] }, { material: 'stone', rect: [46, 40, 4, 4] }]));
  const sand = () => cellsOf(live, 'sand').map(c => c % 96);
  const before = sand(), spread = xs => Math.max(...xs) - Math.min(...xs);
  live.burst({ x: 48, y: 52, radius: 10, strength: 4 }).step(40);
  assert.ok(spread(sand()) > spread(before) + 16, `the heap was thrown wider (${spread(before)} to ${spread(sand())} pixels)`);
  assert.equal(live.at(47, 41).material, 'stone');
});

test('air sealed in a pocket of stone stays still and finite', () => {
  const live = createLivePowder(sandboxSource(48, 48, [{ material: 'stone', rect: [0, 0, 48, 48] }, { material: 'smoke', rect: [20, 20, 4, 4] }, { material: 'fire', rect: [24, 20, 2, 2] }]));
  live.step(30);
  for (const value of live.at(22, 22).air ?? [0, 0]) assert.ok(Number.isFinite(value));
  live.erase({ x: 22, y: 22, radius: 10 }).step(30);
  for (const value of live.at(22, 22).air) assert.ok(Number.isFinite(value));
});

// ---- Compiling ----------------------------------------------------------------------------------------------------
const tiny = (fields = {}) => ({ format: 'pixelforge-powder', version: 1, name: 'pile', base: 'sandbox', width: 48, height: 32, scene: [{ material: 'stone', rect: [0, 28, 48, 4] }], ...fields });

test('a source compiles to an ordinary recipe that draws what the live grid draws, frame for frame', () => {
  const source = tiny({ inputs: [{ frames: [0, 30], every: 2, paint: { material: 'sand', x: 20.5, y: 2.5, radius: 1.5 } }, { frame: 10, paint: { material: 'water', x: 34, y: 4, radius: 3 } }],
    clips: { pour: { frames: 12, every: 3 }, settle: { start: 60, frames: 4, every: 10, duration: 200 } } });
  const { recipe, metadata } = compilePowder(source), project = renderProject(recipe);
  assert.deepEqual(Object.keys(recipe.animations), ['pour', 'settle']);
  assert.deepEqual(recipe.animations.settle, { frames: ['settle-0', 'settle-1', 'settle-2', 'settle-3'], loop: false });
  assert.deepEqual([recipe.frames[0].duration, recipe.frames.at(-1).duration], [50, 200]);
  assert.equal(recipe.background, SANDBOX.background);
  assert.ok(recipe.symbols.still, 'the floor that never changes is drawn once');
  assert.deepEqual(metadata.clips.settle.start, 60);
  assert.equal(metadata.steps, 90);
  // The live runner plays the source's inputs too, so it draws the same frames.
  const live = createLivePowder(source), times = [...Array.from({ length: 12 }, (_, k) => k * 3), 60, 70, 80, 90];
  times.forEach((time, k) => { live.step(time - live.frame); assert.ok(Buffer.from(project.frames[k].data).equals(Buffer.from(live.render().rgba)), `frame ${k} at ${time}`); });
});

test('base "sandbox": the source adds or replaces materials and reactions, and merges its air', () => {
  const source = tiny({
    materials: { mud: { state: 'powder', density: 18, colors: ['#4a3626'] }, sand: { state: 'powder', density: 15, colors: ['#ffffff'] } },
    reactions: [{ a: 'water', b: 'sand', into: ['empty', 'mud'], chance: 1 }, { a: 'lava', b: 'water', into: ['stone', 'steam'], chance: 1 }],
    air: { flow: { wind: [0.5, 0] } }, scene: [{ material: 'sand', rect: [10, 20, 4, 4] }, { material: 'water', rect: [14, 20, 4, 4] }]
  });
  const live = createLivePowder(source);
  assert.ok(live.materials.includes('mud') && live.materials.includes('moss'));
  assert.equal(live.palette[live.render().keys[21][11]], '#ffffff', 'the source\'s sand replaced the base\'s');
  live.step(3);
  assert.ok((live.measure().counts.mud ?? 0) > 0, 'its own reaction runs');
  assert.ok(live.at(30, 4).air[0] > 0.3, 'its wind blows');
  // The base's water and lava pair was replaced, not refused as a second reaction for the pair.
  assert.doesNotThrow(() => createLivePowder(source));
});

test('compile mistakes are named by path', () => {
  const bad = (fields, where, pattern) => assert.throws(() => compilePowder(tiny(fields)), error => error.path === where && pattern.test(error.message), `${where} ${pattern}`);
  bad({ version: 2 }, 'powder.version', /expected 1/);
  bad({ name: 'con' }, 'powder.name', /portable name/);
  bad({ width: 300 }, 'powder.width', /at most 256 pixels a side/);
  bad({ clips: { a: { frames: 200 }, b: { frames: 100 } } }, 'powder.clips', /300 frames in all/);
  bad({ clips: { a: { start: 30000 } } }, 'powder.clips.a.start', /expected a whole number from 0 to 20000/);
  bad({ clips: { a: { tempo: 1 } } }, 'powder.clips.a.tempo', /unknown field/);
  bad({ base: 'desert' }, 'powder.base', /expected "sandbox"/);
  bad({ inputs: [{ frame: 1, paint: { material: 'sand', x: 1, y: 1 }, erase: { x: 1, y: 1 } }] }, 'powder.inputs[0]', /exactly one of paint/);
  bad({ inputs: [{ frames: [1], heat: { x: 1, y: 1 } }] }, 'powder.inputs[0].frames', /expected \[first, last\]/);
  bad({ inputs: [{ frame: 1, paint: { material: 'gold', x: 1, y: 1 } }] }, 'powder.inputs[0].paint.material', /no material named "gold"/);
  bad({ air: { flow: false }, inputs: [{ frame: 1, push: { x: 1, y: 1, vx: 1 } }] }, 'powder.inputs[0].push', /no moving air/);
  assert.throws(() => compilePowder({ ...tiny(), width: 256, height: 256, clips: { long: { frames: 2, every: 60 }, longer: { start: 3000, frames: 2, every: 60 } } }), /million cell steps/);
});

test('the work limit counts scripted inputs and tumbling pieces, refused up front by path', () => {
  const late = { clips: { late: { start: 19940, frames: 2, every: 60 } } };
  // A burst over the whole grid every step costs far more than the grid's own 31 million cell steps.
  const inputs = [{ frames: [0, 40], paint: { material: 'sand', x: 20, y: 2 } }, { frames: [0, 20000], erase: { x: 24, y: 16, radius: 64 } }, { frames: [0, 20000], burst: { x: 24, y: 16, radius: 64, strength: 0 } }];
  assert.throws(() => compilePowder(tiny({ inputs, ...late })), error => error.path === 'powder.inputs[2]' && /scripted inputs need about .* million cell steps .* fewer steps \(frames, every\) or over fewer cells/.test(error.message));
  assert.throws(() => compilePowder(tiny({ inputs: inputs.slice(0, 2), ...late, pieces: 'tumble', scene: [{ material: 'stone', rect: [0, 28, 48, 4] }, { material: 'wood', rect: [4, 4, 40, 24] }] })),
    error => error.path === 'powder.clips' && /pieces "tumble" \(solids that fall fill 63% of the grid\) weigh as about .* or pieces "drop"/.test(error.message));
  // Painted solids that fall count toward the share, and weigh a tumbling grid more.
  assert.throws(() => compilePowder(tiny({ ...late, clips: { c: { start: 11940, frames: 2, every: 60 } }, pieces: 'tumble', inputs: [{ frame: 0, paint: { material: 'wood', x: 24, y: 12, radius: 16 } }] })), /solids that fall fill 62% of the grid/);
  assert.doesNotThrow(() => compilePowder(tiny({ inputs: inputs.slice(0, 1), clips: { c: { start: 1940, frames: 2, every: 60 } }, pieces: 'tumble', scene: [{ material: 'stone', rect: [0, 28, 48, 4] }, { material: 'wood', rect: [4, 24, 4, 4] }] })), 'a lightly tumbling grid compiles');
});

test('errors an agent meets name what to do, and a late scripted input is warned of', () => {
  const bad = (source, where, pattern) => assert.throws(() => compilePowder(source), error => error.path === where && pattern.test(error.message), `${where} ${pattern}`);
  const colours = n => Object.fromEntries(Array.from({ length: n }, (_, k) => [`m${k}`, { state: 'powder', colors: Array.from({ length: 8 }, (_, j) => `#${(k * 8 + j).toString(16).padStart(2, '0')}2040`) }]));
  bad(tiny({ materials: colours(2) }), 'powder.materials', /92 different colours in all: the sandbox base uses 76 and this source adds 16, and a grid draws at most 89; share colours .* or replace base materials/);
  bad({ ...tiny({ materials: colours(12) }), base: undefined }, 'powder.materials', /^powder\.materials: 97 different colours in all, and a grid draws at most 89; share colours between materials$/);
  bad(tiny({ width: 300 }), 'powder.width', /at most 256 pixels a side; use a smaller grid, or run a larger one live .*createLivePowder/);
  bad(tiny({ scene: [{ rows: ['ss'], at: [1.5, 2], legend: { s: 'stone' } }] }), 'powder.scene[0].at', /expected 2 whole numbers/);
  bad(tiny({ scene: [{ rows: ['ss'], at: [1], legend: { s: 'stone' } }] }), 'powder.scene[0].at', /expected 2 whole numbers/);
  bad(tiny({ scene: [{ rows: ['ss'], at: ['x', 'y'], legend: { s: 'stone' } }] }), 'powder.scene[0].at', /expected 2 whole numbers/);
  bad(tiny({ scene: [{ rows: ['ss'], at: [1, 1], legend: { ss: 'stone' } }] }), 'powder.scene[0].legend.ss', /single characters/);
  bad(tiny({ inputs: [{ frame: 1, paint: { material: 'empty', x: 1, y: 1 } }] }), 'powder.inputs[0].paint.material', /erase clears cells/);
  assert.throws(() => createLivePowder(sandboxSource(16, 16)).paint({ material: 'empty', x: 1, y: 1 }), /paint\.material: "empty" is not a material to paint; erase/);
  assert.equal(compilePowder(sandboxSource(16, 16)).recipe.name, 'sandbox', 'sandboxSource is a whole source');
  const { warnings } = compilePowder(tiny({ clips: { a: { frames: 10 } }, inputs: [{ frame: 17, heat: { x: 1, y: 1 } }, { frame: 9000, heat: { x: 1, y: 1 } }, { frames: [18, 400], heat: { x: 1, y: 1 } }] }));
  assert.deepEqual(warnings, [
    'powder.inputs[1] is played on step 9000, so it first shows on step 9001, after the last step a clip samples (18): no frame shows it; play it earlier, or sample later (a clip\'s start, frames and every)',
    'powder.inputs[2] is played from step 18, so it first shows on step 19, after the last step a clip samples (18): no frame shows it; play it earlier, or sample later (a clip\'s start, frames and every)'
  ]);
  assert.equal(compilePowder(tiny({ clips: { a: { frames: 10 } } })).warnings, undefined, 'warnings only when there are any');
});

test('the powder schema lists exactly the fields the reader takes, and the package ships it', async () => {
  const schema = JSON.parse(await readFile(path.join(root, 'powder.schema.json'), 'utf8')), material = schema.properties.materials.additionalProperties;
  // A phase change says what it is (the generator took the text and dropped it).
  assert.match(material.properties.above.description, /melting, boiling/); assert.match(material.properties.below.description, /freezing/);
  const unknown = (source, where) => { try { createLivePowder(source); return false; } catch (error) { return error.path === where && /unknown field/.test(error.message); } };
  const base = () => tiny({ inputs: [{ frame: 0, paint: { material: 'sand', x: 1, y: 1 } }] });
  const levels = [
    [schema.properties, (s, key) => { if (s[key] === undefined) s[key] = 0; }, 'powder'],
    [material.properties, (s, key) => { s.materials = { probe: { state: 'solid', colors: ['#000000'], [key]: 0 } }; }, 'powder.materials.probe'],
    [schema.properties.air.properties, (s, key) => { s.air = { [key]: 0 }; }, 'powder.air'],
    [schema.properties.air.properties.flow.oneOf[1].properties, (s, key) => { s.air = { flow: { [key]: 0 } }; }, 'powder.air.flow'],
    [schema.properties.reactions.items.properties, (s, key) => { s.reactions = [{ a: 'sand', b: 'oil', [key]: 0 }]; }, 'powder.reactions[0]'],
    [schema.properties.scene.items.properties, (s, key) => { s.scene = [{ material: 'sand', rect: [0, 0, 1, 1], [key]: 0 }]; }, 'powder.scene[0]'],
    [schema.properties.inputs.items.properties, (s, key) => { s.inputs = [{ frame: 0, [key]: 0 }]; }, 'powder.inputs[0]'],
    ...Object.keys(POWDER_INPUTS).map(action => [schema.properties.inputs.items.properties[action].properties, (s, key) => { s.inputs = [{ frame: 0, [action]: { x: 1, y: 1, [key]: 0 } }]; }, `powder.inputs[0].${action}`])
  ];
  for (const [properties, set, where] of levels) {
    for (const key of Object.keys(properties)) { const source = base(); set(source, key); assert.ok(!unknown(source, `${where}.${key}`), `${where}.${key} is in the schema but the reader refuses it`); }
    const source = base(); set(source, 'notAField'); assert.ok(unknown(source, `${where}.notAField`), `${where} accepts a field the schema doesn't list`);
  }
  for (const key of Object.keys(schema.properties.clips.additionalProperties.properties)) assert.doesNotThrow(() => compilePowder(tiny({ clips: { c: { [key]: 20 } } })), key);
  assert.throws(() => compilePowder(tiny({ clips: { c: { notAField: 1 } } })), /powder\.clips\.c\.notAField: unknown field/);
  for (const action of Object.keys(POWDER_INPUTS)) assert.deepEqual(Object.keys(schema.properties.inputs.items.properties[action].properties), POWDER_INPUTS[action], action);
  const files = await packageFiles();
  assert.ok(files.includes('powder.schema.json') && files.includes('src/powder.js'));
  for (const name of POWDER_SHOWCASE) assert.ok(files.includes(`examples/${name}.powder.json`), name);
});

test('MCP and the CLI compile powder sources and presets', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-powder-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const input = new PassThrough(), output = new PassThrough(), waiting = new Map();
  let buffer = '', id = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)?.(message); } });
  startMCP({ input, output, root: dir, directory: dir }); t.after(() => input.end());
  const call = (method, params) => new Promise(resolve => { waiting.set(++id, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'powder-test', version: '1' } });
  const help = await call('tools/call', { name: 'pixel_help', arguments: { topic: 'powder', name: 'all' } });
  assert.equal(JSON.parse(help.result.content[0].text).title, 'Pixelbolt falling sand');
  const s = tiny({ inputs: [{ frames: [0, 20], paint: { material: 'sand', x: 20, y: 2, radius: 1.5 } }], clips: { pour: { frames: 10 } } });
  const compiled = JSON.parse((await call('tools/call', { name: 'pixel_compile', arguments: { source: s, metadata: true } })).result.content[0].text);
  assert.deepEqual([compiled.ok, compiled.frames, compiled.metadata.format], [true, 10, 'pixelforge-powder-metadata']);
  const preset = JSON.parse((await call('tools/call', { name: 'pixel_compile', arguments: { preset: 'quarry-blast' } })).result.content[0].text);
  assert.equal(preset.ok, true);
  const file = path.join(dir, 'pile.powder.json'), out = path.join(dir, 'pile.json');
  await writeFile(file, JSON.stringify(s));
  const cli = spawnSync(process.execPath, [path.join(root, 'bin/pixelbolt.js'), 'compile', file, '--out', out], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(await readFile(out, 'utf8')).frames.length, 10);
  const listed = spawnSync(process.execPath, [path.join(root, 'bin/pixelbolt.js'), 'presets', 'lava-falls'], { encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /pixelforge-powder/);
});

golden.test('every powder example compiles to its golden recipe, as its preset writes it, and its GIF is current', async () => {
  const recipes = {};
  for (const name of POWDER_SHOWCASE) {
    const example = JSON.parse(await readFile(path.join(root, 'examples', `${name}.powder.json`), 'utf8'));
    assert.deepEqual(example, JSON.parse(JSON.stringify(powderPresets[name])), `examples/${name}.powder.json is stale; run node scripts/generate-examples.js`);
    const { recipe } = compilePowder(example);
    golden.equal(name, sha(recipe), { recipe, note: 'Rebuild the GIFs too: node showcase/powder/build.mjs --force.' });
    recipes[name] = recipe;
  }
  assert.deepEqual(Object.keys(powderPresets).sort(), [...POWDER_SHOWCASE].sort());
  const { files } = await buildPowderGIFs(recipes);
  for (const [file, bytes] of files) assert.ok(bytes.equals(await readFile(path.join(root, file))), `${file} is stale; run node showcase/powder/build.mjs --force`);
});

// ---- Tumbling pieces (pieces: "tumble") ----
// A hut on stilts over a pool, its left stilt burning just above the water. How the stilt burns through goes by the
// seed: on about one seed in four the falling hut catches on the stilt's stub and is still propped there at frame 400
// (seed 4 now, 18 of seeds 1 to 64 before any change to what a seed draws), so the seed is one where it falls clear.
const STILT_HUT = ['.......rrrrrrrr.......', '.....rrrrrrrrrrrr.....', '...rrrrrrrrrrrrrrrr...', '.rrrrrrrrrrrrrrrrrrrr.', 'rrrrrrrrrrrrrrrrrrrrrr', '.ww................ww.', '.ww....wwww........ww.', '.ww....w..w........ww.', '.ww....wwww........ww.', '.ww................ww.', 'wwwwwwwwwwwwwwwwwwwwww', 'wwwwwwwwwwwwwwwwwwwwww'];
const stiltHut = pieces => ({ ...sandboxSource(96, 64, [
  { material: 'stone', rect: [0, 60, 96, 4] }, { material: 'stone', rect: [0, 38, 4, 22] }, { material: 'stone', rect: [92, 38, 4, 22] },
  { material: 'water', rect: [4, 44, 88, 16] },
  { rows: STILT_HUT, at: [36, 18], legend: { r: 'wood', w: 'wood' } },
  { material: 'wood', rect: [37, 30, 2, 30] }, { material: 'wood', rect: [55, 30, 2, 30] },
  { material: 'wood', rect: [37, 38, 2, 6], burning: true }
], 3), ...(pieces && { pieces }) });
const topOf = (live, name) => { for (let y = 0; y < live.height; y++) for (let x = 0; x < live.width; x++) if (live.at(x, y).material === name) return y; return -1; };
const countIn = (live, name, x0, y0, x1, y1) => { let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (live.at(x, y).material === name) n++; return n; };
// The angle of the piece with the most cells.
const mainAngle = live => {
  const cells = new Map();
  let best = null;
  for (let y = 0; y < live.height; y++) for (let x = 0; x < live.width; x++) {
    const { piece } = live.at(x, y);
    if (!piece) continue;
    cells.set(piece.id, (cells.get(piece.id) ?? 0) + 1);
    if (!best || cells.get(piece.id) > best.n) best = { n: cells.get(piece.id), angle: piece.angle };
  }
  return best && best.angle;
};

test('tumbling: a hut on stilts topples into its pool when one side\'s stilts burn', () => {
  // Dropping straight, the burnt stilt changes nothing: the other stilt stands on the stone and holds the hut up.
  const drop = createLivePowder(stiltHut());
  drop.step(400);
  assert.equal(topOf(drop, 'wood'), 18, 'dropping straight, the hut stays up on one stilt');
  const live = createLivePowder(stiltHut('tumble'));
  const wet = countIn(live, 'wood', 4, 44, 92, 60);
  live.step(150);
  assert.equal(topOf(live, 'wood'), 18, 'it stands while the stilt burns');
  assert.ok(live.measure().pieces.resting >= 1, 'standing on its stilts, the hut is a piece at rest');
  live.step(250);
  const angle = mainAngle(live);
  assert.ok(topOf(live, 'wood') >= 26, `the roof fell (top row ${topOf(live, 'wood')})`);
  assert.ok(angle <= -25 && angle >= -80, `it tipped toward the burnt side (${angle}°)`);
  assert.ok(countIn(live, 'wood', 4, 44, 92, 60) >= wet + 20, 'and lies in the pool');
});

test('tumbling: pieces turn off ledges and stubs, float, keep every cell and come to rest', () => {
  const live = createLivePowder({ ...sandboxSource(128, 72, [
    { material: 'stone', rect: [0, 68, 128, 4] },
    // A plank lying mostly over a ledge, a box dropped off-centre onto a stub, and a crate dropped into a pool.
    { material: 'stone', rect: [0, 30, 20, 38] }, { material: 'wood', rect: [10, 28, 26, 2] },
    { material: 'stone', rect: [60, 58, 3, 10] }, { material: 'wood', rect: [52, 20, 12, 10] },
    { material: 'stone', rect: [84, 50, 2, 18] }, { material: 'stone', rect: [126, 50, 2, 18] }, { material: 'water', rect: [86, 54, 40, 14] },
    { material: 'wood', rect: [98, 10, 10, 8] }
  ], 3), pieces: 'tumble' });
  const wood = live.measure().counts.wood, water = live.measure().counts.water;
  let turned = 0;
  for (let f = 0; f < 300; f++) {
    live.step();
    assert.equal(live.measure().counts.wood, wood, `frame ${f}: a moving piece keeps every cell`);
    for (let x = 0; x < 84; x++) { const { piece } = live.at(x, 60); if (piece && Math.abs(piece.angle) > turned) turned = Math.abs(piece.angle); }
  }
  assert.equal(live.measure().counts.water, water, 'what a piece pushes aside is moved, never lost');
  assert.ok(turned > 20, `pieces turned as they fell (${turned}°)`);
  assert.ok(countIn(live, 'wood', 0, 30, 20, 68) === 0 && topOf(live, 'wood') >= 50, 'the plank tipped off the ledge and the box off its stub');
  const crateTop = topOf({ ...live, at: (x, y) => live.at(x + 86, y), width: 40 }, 'wood'), waterTop = topOf({ ...live, at: (x, y) => live.at(x + 87, y), width: 1 }, 'water');
  assert.ok(crateTop < waterTop && crateTop + 8 > waterTop + 2, `the crate floats, its top out of the water (crate ${crateTop}, water ${waterTop})`);
  assert.deepEqual(live.measure().chunks, { stepped: 0, of: 40 }, 'and everything has come to rest');
  assert.equal(live.measure().pieces.moving, 0);
});

test('tumbling: pieces that turn against each other are not left hanging where their cells stopped', () => {
  // A well of wood blocks that fall onto stubs and each other. Two of the pieces, turning one against the other, were
  // each drawn a little into the other, and each then waited for the other's cells to get out of its way: their bodies
  // fell on and came to rest while their cells stayed where they were, 17 rows of air under one of them.
  const rects = (material, list) => list.map(rect => ({ material, rect }));
  const live = createLivePowder({ ...sandboxSource(96, 80, [
    ...rects('stone', [[0, 76, 96, 4], [20, 20, 3, 56], [70, 20, 3, 56], [35, 58, 3, 5], [28, 58, 4, 5], [26, 64, 2, 4], [49, 68, 2, 6]]),
    ...rects('wood', [[43, 22, 15, 4], [26, 13, 6, 2], [47, 16, 4, 7], [59, 8, 6, 8], [38, 22, 7, 9], [54, 29, 9, 9], [28, 15, 16, 9], [39, 7, 12, 3], [34, 1, 11, 8], [47, 2, 16, 3], [36, 6, 8, 2], [28, 25, 14, 5], [24, 2, 14, 9], [36, 16, 16, 8]])
  ], 1), pieces: 'tumble' });
  // By frame 30 the two had stopped being drawn while their bodies fell on: the wood lay then as it did at rest.
  const wood = live.measure().counts.wood, lie = () => { let rows = 0; for (let y = 0; y < 80; y++) rows += y * countIn(live, 'wood', 0, y, 96, y + 1); return rows / wood; };
  live.step(30);
  const early = lie();
  live.step(470);
  assert.equal(live.measure().counts.wood, wood, 'every cell is kept');
  assert.deepEqual([live.measure().pieces.moving, live.measure().chunks.stepped], [0, 0], 'everything has come to rest');
  assert.ok(lie() > early + 3, `the wood went on down the well: it lay ${early.toFixed(1)} rows down on average at frame 30 and ${lie().toFixed(1)} at rest`);
});

test('tumbling: held where nailed to a wall or hung, moss clings, and a piece standing on stone rests as one', () => {
  const live = createLivePowder({ ...sandboxSource(64, 40, [
    { material: 'stone', rect: [0, 36, 64, 4] }, { material: 'stone', rect: [0, 10, 6, 26] }, { material: 'wood', rect: [6, 14, 20, 2] },
    { material: 'stone', rect: [20, 0, 4, 4] }, { material: 'wood', rect: [18, 4, 8, 2] },
    { material: 'moss', rect: [30, 34, 10, 2] }, { material: 'wood', rect: [44, 32, 12, 4] }
  ], 1), pieces: 'tumble' });
  live.step(60);
  assert.equal(countIn(live, 'wood', 6, 14, 26, 16), 40, 'a beam nailed into a wall stays');
  assert.equal(countIn(live, 'wood', 18, 4, 26, 6), 16, 'a board hung from stone stays');
  assert.equal(countIn(live, 'moss', 30, 34, 40, 36), 20, 'moss holds on to the stone under it');
  assert.equal(countIn(live, 'wood', 44, 32, 56, 36), 48, 'the block stands where it was');
  assert.deepEqual(live.measure().pieces, { moving: 0, resting: 1 }, 'standing, the block is a piece at rest; held ones are not pieces');
  assert.throws(() => createLivePowder({ ...sandboxSource(16, 16), pieces: 'roll' }), /powder\.pieces: expected "drop" .* or "tumble"/);
  const clinging = sandboxSource(16, 16);
  clinging.materials.stone.clings = true;
  assert.throws(() => createLivePowder(clinging), /stone\.clings: only a solid that falls clings/);
});

test('tumbling: a piece thrown out of the top keeps its cells and comes back down', () => {
  const materials = { sand: { state: 'powder', density: 16, colors: ['#d8b06a'] }, water: { state: 'liquid', density: 10, spread: 6, colors: ['#2e6db0'] }, wood: { state: 'solid', falls: true, density: 6, colors: ['#6a3f23'] } };
  const live = createLivePowder({ format: 'pixelforge-powder', width: 48, height: 40, seed: 2, materials, pieces: 'tumble', inputs: [{ frame: 3, burst: { x: 16, y: 9, radius: 6, strength: 8 } }],
    scene: [{ material: 'sand', rect: [0, 14, 48, 26] }, { material: 'water', rect: [0, 10, 48, 4] }, { material: 'wood', rect: [12, 4, 10, 3] }] });
  let above = 0;
  for (let f = 0; f < 300; f++) { live.step(); if (!live.measure().counts.wood) above++; }
  assert.ok(above > 16, `the plank flew wholly above the grid for ${above} frames`);
  assert.equal(live.measure().counts.wood, 30, 'and landed again with every cell');
  assert.deepEqual(live.measure().pieces, { moving: 0, resting: 1 });
});

test('tumbling: at most 128 pieces have bodies; past that, cut parts drop straight as blocks', () => {
  const rows = ['w'.repeat(320), ...Array.from({ length: 3 }, () => 'w.'.repeat(160))];
  const live = createLivePowder({ ...sandboxSource(340, 24, [{ rows, at: [10, 4], legend: { w: 'wood' } }, { material: 'wall', rect: [0, 20, 340, 4] }]), pieces: 'tumble' }).step(2);
  assert.deepEqual(live.measure().pieces, { moving: 1, resting: 0 }, 'the comb falls as one piece');
  // Cutting its back leaves 160 teeth.
  live.erase({ x: 10, y: 4.5, x2: 330, y2: 4.5, radius: 0.5 }).step();
  let most = 0;
  for (let f = 0; f < 80; f++) {
    const { pieces, counts } = live.step().measure();
    most = Math.max(most, pieces.moving + pieces.resting);
    assert.equal(counts.wood, 480, `frame ${f}: every tooth keeps its cells`);
  }
  assert.equal(most, 128);
  assert.ok(cellsOf(live, 'wood').every(c => Math.floor(c / 340) >= 17), 'every tooth fell to the floor');
});

test('tumbling: a piece carries its burning and its heat, a blast throws it, and runs replay exactly', () => {
  const source = { ...sandboxSource(64, 48, [
    { material: 'stone', rect: [0, 44, 96, 4] }, { material: 'stone', rect: [0, 20, 16, 24] },
    { material: 'wood', rect: [13, 12, 10, 8] }, { material: 'wood', rect: [13, 12, 4, 3], burning: true, temperature: 600 },
    { material: 'wood', rect: [64, 36, 8, 8] }
  ], 1), width: 96, pieces: 'tumble', inputs: [{ frame: 60, burst: { x: 62, y: 43, radius: 8, strength: 4 } }] };
  const live = createLivePowder(source, { record: true });
  live.step(30);
  const burning = [];
  live.cells.flag.forEach((f, c) => { if (f) burning.push(c); });
  assert.ok(burning.length >= 10 && topOf(live, 'wood') > 12, `the burning crate tipped off the ledge (${burning.length} burning)`);
  assert.ok(burning.every(c => live.cells.mat[c] === live.materials.indexOf('wood') + 1 && live.cells.temp[c] >= 600 * 16), 'its burning cells moved with it, hot');
  const left = () => { let l = 96; for (let y = 0; y < 44; y++) for (let x = 50; x < 96; x++) if (live.at(x, y).material === 'wood') l = Math.min(l, x); return l; };
  assert.equal(left(), 64);
  live.step(40);
  assert.ok(left() > 70, `the blast threw the block (now from x ${left()})`);
  live.paint({ material: 'wood', x: 30, y: 4, x2: 34, y2: 4, radius: 1 });
  live.step(60);
  const again = replayStrokes(createLivePowder(source), live.strokes, live.frame);
  assert.equal(digest(again), digest(live), 'a tumbling run replays exactly');
});

test('a replay carries on from a runner part of the way there', () => {
  // replayStrokes once waited for a stroke of exactly the frame it was on: on a runner past the first stroke's frame it
  // waited for ever, and every later stroke was left out.
  const source = sandboxSource(16, 16, [{ material: 'stone', rect: [0, 12, 16, 4] }]), recorded = createLivePowder(source, { record: true });
  for (let f = 0; f < 12; f++) { if (f % 3 === 0) recorded.paint({ material: 'sand', x: 4 + f, y: 2, radius: 1 }); recorded.step(); }
  const whole = replayStrokes(createLivePowder(source), recorded.strokes, 12), parts = createLivePowder(source);
  replayStrokes(parts, recorded.strokes, 5);
  assert.equal(parts.frame, 5);
  replayStrokes(parts, recorded.strokes, 12);
  assert.ok(cellsOf(whole, 'sand').length > 8);
  assert.deepEqual(parts.cells.mat, whole.cells.mat, 'in two parts as in one');
  assert.deepEqual(parts.cells.mat, recorded.cells.mat);
});

test('a cell is not taken for moved because it last moved 65,535 frames ago', () => {
  // A cell is stamped with the frame's 16-bit tick when it moves, and passed over for the rest of that frame. The tick
  // came round again to a resting grain's stamp, and on that one frame the grain hung over the hole opened under it.
  const live = createLivePowder(sandboxSource(16, 16, [{ material: 'stone', rect: [0, 8, 16, 1] }, { material: 'sand', rect: [8, 4, 1, 1] }]));
  const row = () => Math.floor(cellsOf(live, 'sand')[0] / 16);
  let landed = 0;
  for (let f = 1, at = row(); f <= 20; f++) { live.step(); if (row() !== at) { at = row(); landed = f; } }
  assert.equal(row(), 7, 'the grain rests on the stone');
  live.step(landed + 65535 - 1 - live.frame);
  live.erase({ x: 8.5, y: 8.5, radius: 0.5 });
  live.step();
  assert.equal(row(), 8, 'and falls on the frame the stone under it goes');
});
