import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, analyzeProject, parseColor, PixelError } from '../src/core.js';
import { compileFluid, createLiveFluid, FLUID_FIELDS, FLUID_WALLS } from '../src/fluid.js';
import { startMCP } from '../src/mcp.js';
import { packageFiles } from '../scripts/build-studio.mjs';
import { FLUID_SHOWCASE, buildFluidGIFs } from '../showcase/fluid/build.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'));
// The same source must give the same recipe on every machine and engine: these hashes are checked on every CI system.
const GOLDEN = {
  campfire: '1a789c44e352be9623801b345b444127ef948fccdefd8dd480aea752ff64d4c4',
  explosion: 'cc5409a9598f810114ba3f51618802e08c280e46f9a0dd0758e331e74c7b941f',
  'smoke-puff': '4cec863e280296a4ab98ba271c60bb94c8b084049d780e8806d65eaf257013c7',
  'steam-vent': '00ff7b5fc9cb9a5afa1ec354d4da1d6995d57ca4bdf262503f397a0ade9c3757',
  'magic-swirl': '24cc577124e229aabecc9596a7e7de7b98011c9482a4d940e8cf4129b1f09221',
  torch: '39b5c8eac8d8d71228eef4732c4dcdc4def2e829c0210f827619b38c0b06858d',
  splash: '1b2a22fe73a5f818858199a0b5098c326395ba26ed5c5a9996dc178bb997f5f4',
  waterfall: '0ebd8edbb0bca1c4f3a0642dcb0bcf41b6289663eec4b4b38c999b5df49cd064',
  drip: 'c073b2539df02705578dfd6cc652703a8354e3b0bfeb9db2ddb57bb51ced4794',
  potion: 'b13996872f8758a39191c2745cac83b4196d0a23bb484f3d8c95e1ed171fb22c',
  honey: '2beb539dc3c98377a1c24af2ffe18fb0d74bc5aad56b1c70ec58d1613cf6ffa7',
  slime: '3da5a16ae70f2f9b529c40447b9d65b1cd9bbe96c761b8f1380874e76c7db25c'
};
const examples = new Map();
const example = async name => {
  if (!examples.has(name)) {
    const source = await read(`examples/${name}.fluid.json`), compiled = compileFluid(source);
    examples.set(name, { source, ...compiled, project: renderProject(compiled.recipe) });
  }
  return examples.get(name);
};
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const gas = (effect, extra = {}) => ({ format: 'pixelforge-fluid', version: 1, name: 'fluid', width: 16, height: 16, palette: { s: '#888', w: '#fff', r: '#c33', y: '#fd6', k: '#000' }, effects: { plume: effect }, ...extra });
const smoke = [{ field: 'density', colors: ['s', 'w'], thresholds: [0.2, 0.6] }];
const pixelsOf = frame => { let n = 0; for (let i = 3; i < frame.data.length; i += 4) if (frame.data[i]) n++; return n; };
const changed = (a, b) => { let n = 0; for (let i = 0; i < a.data.length; i += 4) if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2] || a.data[i + 3] !== b.data[i + 3]) n++; return n; };

test('every fluid example compiles to its golden recipe, using only its palette and grid operations', async () => {
  const sources = (await readFile(path.join(root, 'scripts/generate-examples.js'), 'utf8')).match(/\.fluid\b/g);
  assert.ok(sources.length >= 1);
  for (const name of FLUID_SHOWCASE) {
    const { source, recipe, project } = await example(name);
    assert.equal(sha(recipe), GOLDEN[name], `${name} compiled differently; if the change is intended, update GOLDEN and rebuild the GIFs`);
    const keys = new Set(Object.keys(source.palette)), colours = new Set(Object.values(source.palette).map(hex => hex.toLowerCase()));
    for (const frame of recipe.frames) for (const op of frame.ops ?? []) {
      assert.ok(['grid', 'stamp'].includes(op.op), `${name} ${frame.name}: ${op.op}`);
      if (op.op === 'grid') for (const row of op.rows) for (const char of row) assert.ok(char === '.' || keys.has(char), `${name} ${frame.name} draws ${char}`);
    }
    // No colour outside the palette, by construction: every opaque pixel is a palette colour.
    const hex = (data, at) => `#${[data[at], data[at + 1], data[at + 2]].map(v => v.toString(16).padStart(2, '0')).join('')}`;
    for (const frame of project.frames) for (let at = 0; at < frame.data.length; at += 4) if (frame.data[at + 3]) assert.ok(colours.has(hex(frame.data, at)), `${name} ${frame.name} has ${hex(frame.data, at)}`);
    assert.deepEqual(project.warnings, [], name);
  }
  // Compiling again gives the same recipe.
  assert.deepEqual(compileFluid(structuredClone((await example('campfire')).source)), { recipe: (await example('campfire')).recipe, metadata: (await example('campfire')).metadata });
});

test('looping examples close their loop and one-shot examples end empty or at rest', async () => {
  for (const name of FLUID_SHOWCASE) {
    const { project, metadata } = await example(name), [effect] = Object.values(metadata.effects), [animation] = Object.values(project.animations);
    if (effect.loop) {
      assert.deepEqual(analyzeProject(project).findings.filter(finding => finding.code === 'loop-jump'), [], `${name}: the inspector's loop-boundary check`);
      assert.equal(animation.loop, true);
    } else if (effect.kind === 'gas') {
      assert.equal(effect.residue, 0, `${name} should end fully dissipated`);
      assert.equal(pixelsOf(project.frames[animation.frames.at(-1)]), 0);
    } else {
      // A liquid one-shot settles: its last frames barely change.
      const [a, b] = animation.frames.slice(-2).map(index => project.frames[index]);
      assert.ok(changed(a, b) <= 12, `${name} still moves ${changed(a, b)} pixels a frame at the end`);
    }
  }
});

test('the committed fluid GIFs match the examples', async () => {
  const recipes = {};
  for (const name of FLUID_SHOWCASE) recipes[name] = (await example(name)).recipe;
  const { files } = await buildFluidGIFs(recipes);
  for (const [file, bytes] of files) assert.ok(bytes.equals(await readFile(path.join(root, file))), `${file} is stale; run node showcase/fluid/build.mjs --force`);
});

test('heat rises and curls, smoke thins, obstacles stay clear and a still pool stays still', () => {
  // A hot puff near the bottom rises: its centre of mass moves up frame by frame.
  const { recipe, metadata } = compileFluid(gas({ frames: 10, emitters: [{ at: [8, 12], radius: 2, burst: 1, density: 2, temperature: 2 }], buoyancy: 0.3, look: smoke }));
  const project = renderProject(recipe), height = frame => { let sum = 0, n = 0; for (let i = 3; i < frame.data.length; i += 4) if (frame.data[i]) { sum += Math.floor((i - 3) / 4 / 16); n++; } return n ? sum / n : NaN; };
  const heights = project.frames.map(height);
  assert.ok(heights[6] < heights[0] - 2, `rose from ${heights[0]} to ${heights[6]}`);
  assert.deepEqual(Object.keys(metadata.effects.plume), ['kind', 'frames', 'loop', 'seed', 'steps', 'peak', 'sparks', 'pixels', 'residue', 'figures']);
  // Without buoyancy and with dissipation the smoke thins until nothing is drawn.
  const fading = compileFluid(gas({ frames: 30, emitters: [{ at: [8, 8], radius: 2, burst: 1, density: 1 }], buoyancy: 0, dissipation: 0.3, look: smoke }));
  assert.equal(fading.metadata.effects.plume.residue, 0);
  assert.ok(fading.metadata.effects.plume.pixels[0] > 0);
  // Obstacle cells never hold fluid; the obstacle is stamped over the fluid by default.
  const wall = compileFluid(gas({ frames: 6, emitters: [{ at: [8, 12], radius: 2, rate: 1, density: 1, temperature: 1 }], obstacles: [{ symbol: 'lid', x: 4, y: 4 }], look: smoke }, { symbols: { lid: ['kkkkkkkk'] } }));
  for (const frame of wall.recipe.frames) {
    const grid = frame.ops.find(op => op.op === 'grid');
    if (grid) grid.rows.forEach((row, j) => [...row].forEach((char, i) => { if (grid.y + j === 4 && grid.x + i >= 4 && grid.x + i < 12) assert.equal(char, '.'); }));
    assert.deepEqual(frame.ops.at(-1), { op: 'stamp', symbol: 'lid', x: 4, y: 4 });
  }
  // A pool at rest in a closed box keeps every pixel, frame after frame.
  const pool = compileFluid({ ...gas(null), effects: { pool: { kind: 'liquid', frames: 12, walls: ['left', 'right', 'bottom'], fill: [{ x: 0, y: 10, w: 16, h: 6 }], emitters: [], look: [{ field: 'density', colors: ['s'], thresholds: [0.5] }, { field: 'depth', colors: ['w', 's'], thresholds: [1, 2], dither: 0 }] } } });
  assert.deepEqual(new Set(pool.metadata.effects.pool.pixels), new Set([96]));
  assert.deepEqual(pool.recipe.frames[11].ops, pool.recipe.frames[0].ops);
  assert.deepEqual(pool.recipe.frames[0].ops[0].rows.slice(0, 2), ['w'.repeat(16), 's'.repeat(16)]);
  // Cohesion keeps the surface particles trembling a little, never enough to move a pixel.
  assert.ok(pool.metadata.effects.pool.peak.speed < 0.25);
});

test('sparks draw as blocks of their size, with a streak back along their path', () => {
  const thrown = extra => compileFluid(gas({ frames: 4, buoyancy: 0, emitters: [{ at: [8, 8], radius: 0.5, burst: 1, sparks: { count: 1, life: 8, colors: ['w', 'y'], angle: 0, speed: 3, drag: 0, follow: 0, ...extra } }], look: smoke }));
  const pixels = recipe => recipe.frames.map(frame => { const grid = frame.ops?.find(op => op.op === 'grid'); return grid ? grid.rows.flatMap((row, j) => [...row].flatMap((char, i) => (char === '.' ? [] : [[grid.x + i, grid.y + j, char]]))) : []; });
  // One spark thrown right at 3 pixels a frame: a single pixel, a 2 × 2 block, or a pixel with a streak behind it.
  assert.deepEqual(pixels(thrown({}).recipe)[1], [[11, 8, 'w']]);
  assert.equal(pixels(thrown({ size: 2 }).recipe)[1].length, 4);
  assert.deepEqual(pixels(thrown({ trail: true }).recipe)[1], [[8, 8, 'y'], [9, 8, 'y'], [10, 8, 'y'], [11, 8, 'w']]);
});

test('in a liquid, spray ends where it falls back into the water and a bubble bursts in a ring, then two droplets', () => {
  // A still pool fills rows 10–15. One spark is thrown up from just above the surface; one bubble rises from inside it.
  const pool = sparks => compileFluid({ ...gas(null), effects: { pool: { kind: 'liquid', frames: 16, walls: ['left', 'right', 'bottom'], fill: [{ x: 0, y: 10, w: 16, h: 6 }],
    emitters: [{ at: sparks.at, radius: 0.5, burst: 1, density: 0, sparks: { count: 1, life: 40, colors: ['w'], drag: 0, follow: 0, angle: 270, ...sparks.extra } }], look: [{ field: 'density', colors: ['s'], thresholds: [0.5], dither: 0 }] } } });
  const whites = recipe => recipe.frames.map(frame => frame.ops[0].rows.flatMap((row, j) => [...row].flatMap((char, i) => (char === 'w' ? [[frame.ops[0].x + i, frame.ops[0].y + j]] : []))));
  // Spray rises, falls back and ends at the surface instead of being drawn on inside the water for the rest of its life.
  const spray = whites(pool({ at: [8, 9.5], extra: { speed: 1.5, gravity: [0, 0.3] } }).recipe);
  assert.ok(spray.slice(0, 4).every(list => list.length === 1 && list[0][1] < 10));
  assert.ok(spray.every(list => list.every(([, y]) => y < 10)), JSON.stringify(spray));
  assert.deepEqual(spray.slice(-4), [[], [], [], []]);
  // The bubble is drawn while it rises; where it leaves the water it is a ring for one frame, then two droplets, then gone.
  const bubble = whites(pool({ at: [8, 13], extra: { speed: 0.6, gravity: [0, -0.05], pop: true } }).recipe), burst = bubble.findIndex(list => list.length === 4);
  assert.ok(burst > 0 && bubble.slice(0, burst).every(list => list.length === 1), JSON.stringify(bubble));
  const [x, y] = bubble[burst].reduce(([a, b], [i, j]) => [a + i / 4, b + j / 4], [0, 0]);
  assert.deepEqual(bubble[burst].map(([i, j]) => [i - x, j - y]).sort(), [[-1, 0], [0, -1], [0, 1], [1, 0]]);
  assert.deepEqual(bubble[burst + 1].map(([i, j]) => [i - x, j - y]).sort(), [[-1, -1], [1, -1]]);
  assert.ok(bubble.slice(burst + 2).every(list => !list.length));
});

test('depth bands stay level under water standing on the surface', () => {
  // A pool fills rows 10–15 and a 3 × 4 block of water stands on it, a mound by the first frame. Under the mound the
  // bands below the highlight keep the pool's rows instead of starting again from the mound's top.
  const { recipe } = compileFluid({ ...gas(null), effects: { pool: { kind: 'liquid', frames: 1, walls: ['left', 'right', 'bottom'], fill: [{ x: 0, y: 10, w: 16, h: 6 }, { x: 6, y: 6, w: 3, h: 4 }],
    emitters: [], look: [{ field: 'density', colors: ['s'], thresholds: [0.5], dither: 0 }, { field: 'depth', colors: ['w', 's', 'r'], thresholds: [1, 2, 4], dither: 0 }] } } });
  const grid = recipe.frames[0].ops[0], row = y => grid.rows[y - grid.y];
  assert.equal(row(8).slice(6 - grid.x, 9 - grid.x), 'sss');
  assert.deepEqual([row(11), row(12), row(13), row(15)], ['s'.repeat(16), 's'.repeat(16), 'r'.repeat(16), 'r'.repeat(16)]);
});

test('water under an overhang is as deep as the pool beside it, and a hanging drop keeps its highlight', () => {
  // A pool fills rows 6–15, and a shelf four pixels long juts from the left wall into it at row 9. The water under the
  // shelf has no surface above it, so it takes the pool's bands, not a highlight of its own.
  const look = [{ field: 'density', colors: ['s'], thresholds: [0.5], dither: 0 }, { field: 'depth', colors: ['w', 's', 'r'], thresholds: [1, 2, 4], dither: 0 }];
  const { recipe } = compileFluid({ ...gas(null), symbols: { shelf: ['kkkk'] }, effects: { pool: { kind: 'liquid', frames: 1, walls: ['left', 'right', 'bottom'], obstacles: [{ symbol: 'shelf', x: 0, y: 9, draw: 'none' }], fill: [{ x: 0, y: 6, w: 16, h: 10 }], emitters: [], look } } });
  const grid = recipe.frames[0].ops[0], at = (x, y) => grid.rows[y - grid.y][x - grid.x];
  for (let y = 10; y < 16; y++) for (let x = 0; x < 4; x++) assert.equal(at(x, y), 'r', `under the shelf at ${x}, ${y}`);
  assert.equal(at(8, 6), 'w');
  // A drop hanging under a rock has no open water beside it, so it keeps its own highlight on top.
  const drop = compileFluid({ ...gas(null), symbols: { rock: ['kkkkkk'] }, effects: { drop: { kind: 'liquid', frames: 1, gravity: [0, 0], walls: FLUID_WALLS, obstacles: [{ symbol: 'rock', x: 5, y: 3, draw: 'none' }], fill: [{ x: 6, y: 4, w: 4, h: 4 }], emitters: [], look } } });
  const dropGrid = drop.recipe.frames[0].ops[0];
  assert.match(dropGrid.rows[4 - dropGrid.y], /w/);
});

test('whitewater throws spray where water lands and sheds drops off a fast stream', () => {
  // The water is drawn in s, so every w pixel is a whitewater droplet.
  const body = [{ field: 'density', colors: ['s'], thresholds: [0.5], dither: 0 }];
  const whites = recipe => recipe.frames.map(frame => (frame.ops ?? []).filter(op => op.op === 'grid').reduce((n, op) => n + op.rows.join('').split('w').length - 1, 0));
  // A drop falls onto a still pool: no spray while it falls, then droplets thrown up where it lands.
  const drop = whitewater => compileFluid({ ...gas(null), effects: { pool: { kind: 'liquid', frames: 12, walls: ['left', 'right', 'bottom'], fill: [{ x: 0, y: 11, w: 16, h: 5 }, { at: [8, 3], radius: 2, velocity: [0, 1] }],
    emitters: [], whitewater, look: body } } });
  const landing = whites(drop([{ impact: 1, chance: 1, colors: ['w'] }]).recipe);
  assert.deepEqual(landing.slice(0, 2), [0, 0]);
  assert.ok(Math.max(...landing) >= 3, JSON.stringify(landing));
  assert.ok(whites(drop([{ impact: 32, chance: 1, colors: ['w'] }]).recipe).every(n => n === 0));
  // A fast sheet of water crossing an open box sheds drops; a threshold above its speed sheds none.
  const stream = speed => compileFluid({ ...gas(null), effects: { pool: { kind: 'liquid', frames: 6, gravity: [0, 0], fill: [{ x: 0, y: 6, w: 8, h: 3, velocity: [2.5, 0] }],
    emitters: [], whitewater: [{ speed, chance: 0.5, colors: ['w'] }], look: body } } });
  assert.ok(whites(stream(2).recipe).some(n => n > 0));
  assert.ok(whites(stream(8).recipe).every(n => n === 0));
  // Foam rides the surface: a jet pushes surface water down into a pool, and foam carried under ends there, so no foam
  // pixel ever has water on all four sides.
  const { recipe: dive } = compileFluid({ ...gas(null), effects: { pool: { kind: 'liquid', frames: 10, walls: ['left', 'right', 'bottom'], fill: [{ x: 0, y: 6, w: 16, h: 10 }],
    emitters: [{ at: [8, 7], area: [4, 2], rate: 1, density: 0, velocity: [0, 2.5] }], whitewater: [{ speed: 1.5, chance: 1, colors: ['w'], follow: 1 }], look: body } } });
  let foam = 0;
  for (const frame of dive.frames) for (const op of (frame.ops ?? []).filter(o => o.op === 'grid')) op.rows.forEach((row, j) => [...row].forEach((char, i) => {
    if (char !== 'w') return;
    foam++;
    const at = (x, y) => op.rows[y]?.[x] ?? '.';
    assert.ok([at(i - 1, j), at(i + 1, j), at(i, j - 1), at(i, j + 1)].some(n => n !== 's'), `foam under water at ${op.x + i},${op.y + j}`);
  }));
  assert.ok(foam > 0);
  // Whitewater is a liquid setting, and a layer picks exactly one trigger.
  const bad = (effect, where, message) => assert.throws(() => compileFluid({ ...gas(null), effects: { pool: effect } }), error => error.path === where && message.test(error.message));
  bad({ frames: 2, emitters: [{ at: [8, 8], rate: 1, density: 1 }], whitewater: [], look: body }, 'fluid.effects.pool.whitewater', /applies to liquids/);
  bad({ kind: 'liquid', frames: 2, emitters: [], fill: [{ x: 0, y: 8, w: 16, h: 8 }], whitewater: [{ impact: 1, speed: 2, colors: ['w'] }], look: body }, 'fluid.effects.pool.whitewater[0]', /exactly one of impact/);
});

test('emitters can fall off toward their rim, orbit on an ellipse and lay a smooth trail', () => {
  const field = (effect, look) => compileFluid({ ...gas(null), width: 24, height: 24, effects: { plume: { buoyancy: 0, ...effect, look } } }).recipe;
  const count = (recipe, char) => recipe.frames.map(frame => (frame.ops ?? []).filter(op => op.op === 'grid').reduce((n, op) => n + op.rows.join('').split(char).length - 1, 0));
  // A puff with falloff is dense only in the middle: fewer w (dense) pixels and more s (thin) ones than a flat disc.
  const ramp = [{ field: 'density', colors: ['s', 'w'], thresholds: [0.2, 0.8], dither: 0 }];
  const [flat, soft] = [0, 1].map(falloff => field({ frames: 1, dissipation: 0, emitters: [{ at: [12, 12], radius: 5, burst: 1, density: 1, falloff }] }, ramp));
  assert.ok(count(soft, 'w')[0] < count(flat, 'w')[0] / 2 && count(soft, 's')[0] > count(flat, 's')[0], `${count(flat, 'w')} ${count(soft, 'w')}`);
  // An orbit with radius [8, 3] covers a wide, low ellipse.
  const thin = [{ field: 'density', colors: ['s'], thresholds: [0.3], dither: 0 }];
  let [x0, x1, y0, y1] = [99, -1, 99, -1];
  for (const frame of field({ frames: 8, dissipation: 0.9, emitters: [{ at: [12, 12], radius: 0.6, rate: 1, density: 2, orbit: { radius: [8, 3], period: 8 } }] }, thin).frames) {
    for (const op of (frame.ops ?? []).filter(o => o.op === 'grid')) op.rows.forEach((row, j) => [...row].forEach((char, i) => { if (char !== '.') { x0 = Math.min(x0, op.x + i); x1 = Math.max(x1, op.x + i); y0 = Math.min(y0, op.y + j); y1 = Math.max(y1, op.y + j); } }));
  }
  assert.ok(x1 - x0 + 1 >= 2 * (y1 - y0 + 1), `${x1 - x0 + 1} × ${y1 - y0 + 1}`);
  // A small emitter racing round a wide orbit is laid along its path, so its trail is one piece rather than a string of beads.
  const pieces = frame => {
    const grid = (frame.ops ?? []).find(op => op.op === 'grid'), seen = new Set(), H = grid.rows.length, W = grid.rows[0].length;
    let n = 0;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      if (grid.rows[j][i] === '.' || seen.has(j * W + i)) continue;
      n++; seen.add(j * W + i);
      for (const stack = [[i, j]]; stack.length;) {
        const [x, y] = stack.pop();
        for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + a, Y = y + b; if (X >= 0 && Y >= 0 && X < W && Y < H && grid.rows[Y][X] !== '.' && !seen.has(Y * W + X)) { seen.add(Y * W + X); stack.push([X, Y]); } }
      }
    }
    return n;
  };
  const trail = field({ frames: 6, dissipation: 0.25, substeps: 1, emitters: [{ at: [12, 12], radius: 0.6, rate: 1, density: 2, orbit: { radius: 8, period: 6 } }] }, thin);
  assert.deepEqual(trail.frames.slice(1, 4).map(pieces), [1, 1, 1]);
});

test('loops repeat their forcing, blend their seam and wrap sparks round', () => {
  const effect = { frames: 12, loop: true, seed: 4, emitters: [{ at: [8, 13], area: [6, 2], rate: 1, density: 0.6, temperature: 1, velocity: [0, -1], noise: 0.5, flicker: 0.4, pulse: { amplitude: 0.5, period: 6 },
    sparks: { count: 0.5, life: [6, 10], colors: ['y', 'r'], angle: [260, 280], speed: 0.3 } }], look: [...smoke, { field: 'temperature', colors: ['r', 'y'], thresholds: [0.3, 0.7] }] };
  const { recipe, metadata } = compileFluid(gas(effect)), project = renderProject(recipe);
  assert.equal(recipe.animations.plume.loop, undefined);
  assert.deepEqual([metadata.effects.plume.warmup, metadata.effects.plume.blend, metadata.effects.plume.steps], [2, 4, 2 * (36 + 10)]);
  assert.ok(metadata.effects.plume.sparks.spawned > 0);
  assert.deepEqual(analyzeProject(project).findings.filter(finding => finding.code === 'loop-jump'), []);
  // The seam is no larger a step than an ordinary one.
  const steps = project.frames.map((frame, i) => changed(project.frames[(i + project.frames.length - 1) % project.frames.length], frame));
  assert.ok(steps[0] <= Math.max(...steps.slice(1)), `seam ${steps[0]}, steps ${steps.slice(1)}`);
  // Another seed changes the noise, flicker and sparks; the same seed is the same recipe.
  assert.notDeepEqual(compileFluid(gas({ ...effect, seed: 5 })).recipe, recipe);
  assert.deepEqual(compileFluid(gas(effect)).recipe, recipe);
});

// ---- Thick fluids -----------------------------------------------------------------------------------------------------
// The drawn pixels of a compiled frame, as [x, y].
const drawn = (recipe, frame) => {
  const op = recipe.frames[frame].ops?.find(o => o.op === 'grid'), cells = [];
  if (op) op.rows.forEach((row, j) => [...row].forEach((char, i) => { if (char !== '.') cells.push([op.x + i, op.y + j]); }));
  return cells;
};
const lowest = cells => Math.max(...cells.map(([, y]) => y)), highest = cells => Math.min(...cells.map(([, y]) => y)), widest = cells => Math.max(...cells.map(([x]) => x)) - Math.min(...cells.map(([x]) => x)) + 1;
const goo = (settings, fill, extra = {}) => ({ ...gas(null), width: 48, height: 32, ...extra, effects: { goo: { kind: 'liquid', frames: 40, walls: ['left', 'right', 'bottom'], ...settings, fill, emitters: settings.emitters ?? [], look: [{ field: 'density', colors: ['s'], thresholds: [0.5], dither: 0 }] } } });

test('viscosity slows spreading but never falling, and walls hold a viscous liquid unless it slips', () => {
  // A drop falls as fast at any viscosity: viscosity resists shearing, not motion as a whole.
  const fall = settings => { const { recipe } = compileFluid(goo(settings, [{ at: [24, 5], radius: 3 }])); return recipe.frames.findIndex((_, f) => lowest(drawn(recipe, f)) >= 26); };
  assert.equal(fall({ viscosity: 16 }), fall({}));
  assert.ok(fall({ drag: 0.3 }) > fall({}) + 3, 'drag, by contrast, slows the fall');
  // A column released against the left wall runs out along the floor more slowly the thicker it is.
  const front = settings => { const { recipe } = compileFluid(goo(settings, [{ x: 0, y: 14, w: 10, h: 18 }])); return Math.max(...drawn(recipe, 20).filter(([, y]) => y === 31).map(([x]) => x)); };
  const runs = [front({}), front({ viscosity: 2 }), front({ viscosity: 16 })];
  assert.ok(runs[0] > runs[1] + 8 && runs[1] > runs[2] + 8, `fronts ${runs}`);
  // The floor holds a viscous liquid back; with slip it slides along it.
  assert.ok(front({ viscosity: 16, slip: true }) > runs[2] + 4);
  // Thick liquids stay calm: a pool at rest keeps every pixel.
  const pool = compileFluid(goo({ viscosity: 8, apic: true }, [{ x: 0, y: 24, w: 48, h: 8 }]));
  assert.deepEqual(new Set(pool.metadata.effects.goo.pixels), new Set([384]));
});

test('a yield stress holds a heap up, squashes and springs back, and flows once pushed past it', () => {
  const heap = settings => { const { recipe } = compileFluid(goo(settings, [{ x: 18, y: 20, w: 12, h: 12 }])); const last = drawn(recipe, 39); return [32 - highest(last), widest(last)]; };
  // A 12-pixel heap needs a yield of about gravity × 12 / 2 = 1.8 to hold itself up.
  const [held, water, soft] = [heap({ yield: 4 }), heap({}), heap({ yield: 0.5 })];
  assert.ok(held[0] >= 11 && held[1] <= 14, `held ${held}`);
  assert.ok(water[0] < held[0] - 4 && water[1] >= 40, `water ${water}`);
  assert.ok(soft[0] < held[0] - 3 && soft[1] > held[1] + 8, `soft ${soft}`);
  // A dropped blob squashes where it lands, then springs back up into a dome.
  const { recipe } = compileFluid(goo({ yield: 6, gravity: [0, 0.5] }, [{ at: [24, 6], radius: 5 }]));
  const heights = recipe.frames.map((_, f) => 32 - highest(drawn(recipe, f))), landed = heights.findIndex((h, f) => f > 2 && lowest(drawn(recipe, f)) === 31);
  const squash = Math.min(...heights.slice(landed, landed + 4));
  assert.ok(heights.at(-1) > squash, `squashed to ${squash}, settled at ${heights.at(-1)}`);
});

test('adhesion keeps a film under a ledge, APIC keeps a thick liquid turning', () => {
  // Liquid under a slab: water falls away; with adhesion a film stays on the slab's underside.
  const film = settings => { const { recipe } = compileFluid(goo({ ...settings, obstacles: [{ symbol: 'slab', x: 14, y: 6 }] }, [{ x: 14, y: 7, w: 20, h: 3 }], { symbols: { slab: ['k'.repeat(20)] } })); return drawn(recipe, 30).filter(([, y]) => y === 7).length; };
  assert.equal(film({}), 0);
  assert.ok(film({ adhesion: 4 }) >= 8, `film ${film({ adhesion: 4 })}`);
  // A spinning blob of syrup in still air: the grid share (PIC) smears its spin away, APIC keeps it turning.
  const spin = apic => {
    const source = goo({ viscosity: 2, flip: 0, apic, gravity: [0, 0], tension: 0, walls: FLUID_WALLS, emitters: [{ at: [24, 16], radius: 9, burst: 1, density: 0, vortex: 1 }] }, [{ at: [24, 16], radius: 9 }]);
    source.effects.goo.look = [{ field: 'speed', colors: ['s'], thresholds: [0.6], dither: 0 }];
    return drawn(compileFluid(source).recipe, 39).length;
  };
  const [pic, affine] = [spin(false), spin(true)];
  assert.ok(affine > pic * 1.5, `APIC ${affine} vs PIC ${pic} pixels still turning`);
});

test('sharp advection keeps a puff crisp, and a viscous gas calms swirls but not drift', () => {
  const drift = settings => compileFluid(gas({ frames: 30, buoyancy: 0, dissipation: 0, cooling: 0, drag: 0, vorticity: 0, wind: [0.08, 0], ...settings, emitters: [{ at: [8, 16], radius: 4, burst: 1, density: 1 }], look: [{ field: 'density', colors: ['s', 'w'], thresholds: [0.2, 0.7], dither: 0 }] }, { width: 48, height: 32 }));
  const core = ({ recipe }) => recipe.frames[29].ops[0].rows.join('').split('w').length - 1;
  const smooth = drift({}), sharp = drift({ advection: 'sharp' });
  assert.ok(core(sharp) > core(smooth) * 1.5, `core ${core(sharp)} sharp vs ${core(smooth)} smooth`);
  assert.ok(sharp.metadata.effects.plume.peak.density <= 1, 'the limiter makes no new peaks');
  // Drifting as a whole has no shear, so viscosity leaves it exactly as it was.
  assert.deepEqual(drift({ viscosity: 4 }).recipe, smooth.recipe);
  // A swirl, though, dies away.
  const swirl = settings => compileFluid(gas({ frames: 16, buoyancy: 0, dissipation: 0, drag: 0, vorticity: 0, ...settings, emitters: [{ at: [16, 16], radius: 8, burst: 1, density: 1, vortex: 2 }], look: [{ field: 'speed', colors: ['s'], thresholds: [0.3], dither: 0 }] }, { width: 32, height: 32 }));
  const turning = ({ recipe }) => drawn(recipe, 15).length;
  assert.ok(turning(swirl({})) > 50 && turning(swirl({ viscosity: 1 })) < turning(swirl({})) / 4);
});

test('nothing passes through a wall one pixel thick, however fast it moves', () => {
  // A jar's sides and floor are one pixel thick: columns 8 and 23 from row 10 down, and row 29.
  const jar = Array.from({ length: 32 }, (_, y) => Array.from({ length: 32 }, (_, x) => ((y >= 10 && y <= 29 && (x === 8 || x === 23)) || (y === 29 && x >= 8 && x <= 23) ? 'k' : '.')).join(''));
  const walled = (effect, symbol = 'wall') => ({ ...gas(null), width: 32, height: 32, symbols: { wall: Array(32).fill('k'), stairs: Array.from({ length: 32 }, (_, y) => '.'.repeat(y % 32) + 'k' + '.'.repeat(31 - (y % 32))), jar }, effects: { e: { ...effect, obstacles: [{ symbol, x: symbol === 'wall' ? 16 : 0, y: 0, draw: 'none' }] } } });
  const beyond = (recipe, past) => { let n = 0; for (const frame of recipe.frames) for (const op of frame.ops ?? []) if (op.op === 'grid') op.rows.forEach((row, j) => [...row].forEach((char, i) => { if (char !== '.' && past(op.x + i, op.y + j)) n++; })); return n; };
  // Sparks fired at the wall, straight and at an angle, at up to 9 pixels a frame.
  const sparks = walled({ frames: 12, buoyancy: 0, emitters: [{ at: [6, 16], radius: 2, burst: 1, density: 0, sparks: { count: 40, life: 12, colors: ['w'], angle: [-30, 30], speed: [6, 9], follow: 0, drag: 0 } }], look: smoke });
  assert.equal(beyond(compileFluid(sparks).recipe, x => x > 16), 0);
  // Nor through a diagonal wall of single pixels touching only at their corners.
  const diagonal = walled({ frames: 12, buoyancy: 0, emitters: [{ at: [6, 26], radius: 2, burst: 1, density: 0, sparks: { count: 40, life: 12, colors: ['w'], angle: [-60, -30], speed: [3, 9], follow: 0, drag: 0 } }], look: smoke }, 'stairs');
  assert.equal(beyond(compileFluid(diagonal).recipe, (x, y) => x > y), 0);
  // A jet of water at 16 pixels a frame, with a single substep.
  for (const substeps of [1, 2]) {
    const jet = walled({ kind: 'liquid', frames: 10, substeps, gravity: [0, 0], walls: FLUID_WALLS, fill: [{ x: 2, y: 10, w: 8, h: 12, velocity: [16, 0] }], emitters: [], look: [{ field: 'density', colors: ['s'], thresholds: [0.25], dither: 0 }] });
    assert.equal(beyond(compileFluid(jet).recipe, x => x > 16), 0, `substeps ${substeps}`);
  }
  // Water resting against the wall leaves no trace beyond it, even at the faintest density a look draws.
  const pool = walled({ kind: 'liquid', frames: 20, gravity: [1, 0.3], walls: FLUID_WALLS, fill: [{ x: 0, y: 12, w: 16, h: 20 }], emitters: [], look: [{ field: 'density', colors: ['s'], thresholds: [0.02], dither: 0 }] });
  assert.equal(beyond(compileFluid(pool).recipe, x => x > 16), 0);
  // Bubbles that drift into a jar's side end there; only those that reach the open top burst.
  const bubbles = walled({ kind: 'liquid', frames: 30, fill: [{ x: 9, y: 14, w: 14, h: 15 }], emitters: [{ at: [16, 26], radius: 1, rate: 1, density: 0.01, sparks: { count: 1, life: [20, 30], colors: ['w'], angle: [150, 210], speed: [0.6, 1.2], drag: 0, gravity: [0, -0.05], pop: true } }], look: [{ field: 'density', colors: ['s'], thresholds: [0.5], dither: 0 }] }, 'jar');
  assert.equal(beyond(compileFluid(bubbles).recipe, (x, y) => x < 8 || x > 23 || y > 29), 0);
});

test('smooth obstacles let thick liquids slide down drawn slopes and fall away from them, and keep everything out', () => {
  const W = 72, H = 56, art = f => Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => (f(x, y) ? 'k' : '.')).join(''));
  const scene = (symbol, rows, effect) => ({ ...gas(null), width: W, height: H, symbols: { [symbol]: rows }, effects: { e: { kind: 'liquid', frames: 60, seed: 3, look: [{ field: 'density', colors: ['s'], thresholds: [0.5], dither: 0 }], emitters: [], ...effect } } });
  // Wet snow and slime dropped on a drawn 45° roof (a staircase of single pixels) and a 63° one (two down, one across):
  // they catch on the steps and most of them stays; on a smooth roof they slide off the open right edge.
  for (const [run, settings] of [[1, { yield: 3, slip: true, tension: 1 }], [0.5, { yield: 1, slip: true }]]) {
    const roof = art((x, y) => y >= 14 + Math.floor(x / run));
    const left = surface => drawn(compileFluid(scene('roof', roof, { walls: ['left'], apic: true, ...settings, obstacles: [{ symbol: 'roof', draw: 'none', surface }], fill: [{ at: [12, 6], radius: 5 }] })).recipe, 59).length;
    const [stepped, smooth] = [left('pixels'), left('smooth')];
    assert.ok(stepped >= 25 && smooth === 0, `roof ${run}, yield ${settings.yield}: ${stepped} pixels stay on the stepped roof, ${smooth} on the smooth one`);
  }
  // Slime pressed against the underside of a stepped branch two pixels thick hangs from it; from a smooth one it falls.
  const branch = art((x, y) => { const top = 12 - Math.floor((x - 9) / 3.5); return x >= 9 && x < 39 && (y === top || y === top + 1); });
  const below = art((x, y) => { const top = 12 - Math.floor((x - 9) / 3.5); return x >= 9 && x < 39 && (y === top + 2 || y === top + 3); });
  const hanging = surface => drawn(compileFluid(scene('branch', branch, { frames: 31, yield: 3, slip: true, walls: ['left', 'right', 'bottom'], obstacles: [{ symbol: 'branch', draw: 'none', surface }], fill: [{ at: [24, 12.6], radius: 6 }] })).recipe, 30).filter(([x, y]) => below[y][x] === 'k').length;
  assert.ok(hanging('pixels') >= 10 && hanging('smooth') === 0, `${hanging('pixels')} pixels hang under the stepped branch, ${hanging('smooth')} under the smooth one`);
  // Water poured into a smooth V-shaped bowl settles there, keeping its volume, as in a stepped one.
  const bowl = art((x, y) => y >= 55 - Math.abs(x - 36));
  const pool = compileFluid(scene('bowl', bowl, { frames: 90, walls: FLUID_WALLS, obstacles: [{ symbol: 'bowl', draw: 'none', surface: 'smooth' }], fill: [{ x: 24, y: 30, w: 24, h: 10 }] })).recipe;
  const at = f => new Set(drawn(pool, f).map(([x, y]) => y * W + x)), [early, a, b] = [at(30), at(70), at(89)], moved = [...a].filter(c => !b.has(c)).length + [...b].filter(c => !a.has(c)).length;
  assert.ok(moved <= 16 && Math.abs(a.size - b.size) <= 4 && b.size >= 0.95 * early.size, `the pool: ${early.size}, ${a.size} and ${b.size} pixels at frames 30, 70 and 89, ${moved} changed`);
  // Nothing gets through a smooth diagonal wall one or two pixels thick, nor one that is smooth above and pixels below:
  // not a jet at 16 pixels a frame, not the spray it throws, not gas, not even the faintest density a look draws.
  for (const thick of [1, 2]) {
    const on = (x, y) => x - y - 4 >= 0 && x - y - 4 < thick, wall = art(on), past = ([x, y]) => x - y - 4 >= thick;
    const walls = { smooth: [{ wall }, [{ symbol: 'wall', draw: 'none', surface: 'smooth' }]], mixed: [{ upper: art((x, y) => on(x, y) && y < 26), lower: art((x, y) => on(x, y) && y >= 26) }, [{ symbol: 'upper', draw: 'none', surface: 'smooth' }, { symbol: 'lower', draw: 'none' }]] };
    for (const [name, [symbols, obstacles]] of Object.entries(walls)) for (const substeps of [1, 2]) {
      const jet = { ...scene('wall', wall, { frames: 14, substeps, gravity: [0, 0], walls: FLUID_WALLS, obstacles, fill: [{ x: 1, y: 18, w: 8, h: 14, velocity: [16, -4] }], whitewater: [{ impact: 0.3, chance: 1, throw: 1.5, spread: 60, colors: ['w'], life: 8 }], look: [{ field: 'density', colors: ['s'], thresholds: [0.02], dither: 0 }] }), symbols };
      const { recipe } = compileFluid(jet);
      assert.equal(recipe.frames.reduce((n, _, f) => n + drawn(recipe, f).filter(past).length, 0), 0, `${name} ${thick}-pixel wall, substeps ${substeps}`);
    }
    const smoke = compileFluid({ ...gas({ frames: 24, buoyancy: 0, wind: [0.3, 0], obstacles: [{ symbol: 'wall', draw: 'none', surface: 'smooth' }], emitters: [{ at: [6, 30], radius: 3, rate: 1, density: 1, velocity: [3, 0] }], look: [{ field: 'density', colors: ['s'], thresholds: [0.05], dither: 0 }] }), width: W, height: H, symbols: { wall } }).recipe;
    assert.equal(smoke.frames.reduce((n, _, f) => n + drawn(smoke, f).filter(([x, y]) => x - y - 4 >= thick + 1).length, 0), 0, `gas past a ${thick}-pixel wall`);
  }
  // A live runner steps the same simulation, frame for frame.
  const roof = art((x, y) => y >= 14 + x), slide = scene('roof', roof, { frames: 30, walls: ['left'], yield: 1, slip: true, obstacles: [{ symbol: 'roof', draw: 'none', surface: 'smooth' }], fill: [{ at: [12, 6], radius: 5 }] });
  const { recipe } = compileFluid(slide), live = createLiveFluid(slide, { warmup: 0 });
  for (let f = 0; f < 30; f++) {
    live.step();
    const cells = new Set(drawn(recipe, f).map(([x, y]) => y * W + x)), keys = live.render().keys, seen = new Set();
    keys.forEach((row, y) => [...row].forEach((char, x) => { if (char !== '.') seen.add(y * W + x); }));
    assert.deepEqual(seen, cells, `frame ${f}`);
  }
});

test('decorations are drawn over or under the fluid but never met by it', () => {
  // Water falls through a net drawn over it; the same net as an obstacle catches it.
  const net = ['k.k.k.k.k.k.k.k', '.k.k.k.k.k.k.k.', 'k.k.k.k.k.k.k.k'];
  const drop = obstacle => compileFluid(goo({ walls: FLUID_WALLS, obstacles: [obstacle] }, [{ at: [24, 5], radius: 3 }], { symbols: { net } })).recipe;
  const below = recipe => drawn(recipe, 39).filter(([, y]) => y > 14).length, held = drop({ symbol: 'net', x: 17, y: 12 }), through = drop({ symbol: 'net', x: 17, y: 12, solid: false });
  assert.ok(below(through) > 12 && below(held) < below(through) / 3, `${below(through)} pixels fell through the decoration, ${below(held)} past the obstacle`);
  // It is still stamped in front of the water, and a decoration drawn under shows through wherever the water is not.
  assert.ok(through.frames.every(frame => frame.ops.at(-1).op === 'stamp' && frame.ops.at(-1).symbol === 'net'));
  const under = drop({ symbol: 'net', x: 17, y: 12, solid: false, draw: 'under' });
  assert.ok(under.frames.every(frame => frame.ops[0].op === 'stamp'));
  // Gas rises through a decoration too.
  const plume = solidity => compileFluid(gas({ frames: 12, emitters: [{ at: [8, 13], radius: 2, rate: 1, density: 1, temperature: 1 }], obstacles: [{ symbol: 'lid', x: 2, y: 8, solid: solidity }], look: smoke }, { symbols: { lid: ['kkkkkkkkkkkk'] } })).recipe;
  const above = recipe => drawn(recipe, 11).filter(([, y]) => y < 8).length;
  assert.ok(above(plume(false)) >= 3 && above(plume(true)) === 0, `${above(plume(false))} pixels of smoke rose past the decoration, ${above(plume(true))} past the lid`);
});

test('carried gas is thrown like dust, drops at obstacles and runs live as compiled', () => {
  const ground = Array(4).fill('k'.repeat(128));
  const wave = (carry, extra = {}) => compileFluid({ ...gas(null), width: 128, height: 48, symbols: { ground, wall: Array(48).fill('kk') }, effects: { e: { frames: 12, buoyancy: 0.02, dissipation: 0.04, obstacles: [{ symbol: 'ground', x: 0, y: 44 }], emitters: [-1, 1].map(dir => ({ at: [64 + 4 * dir, 41], radius: 3, burst: 1, density: 0.8, velocity: [8 * dir, -0.3], ...(carry && { carry }) })), look: [{ field: 'density', colors: ['s'], thresholds: [0.1] }], ...extra } } }).recipe;
  const span = (recipe, f) => { const xs = drawn(recipe, f).map(([x]) => x); return Math.max(...xs) - Math.min(...xs) + 1; };
  // Thrown sideways at 8 pixels a frame, plain gas hardly travels; carried, it rolls out as a dust wave.
  const [plain, thrown] = [wave(null), wave({ drag: 0.2, release: 0.3 })];
  assert.ok(span(plain, 6) < 40 && span(thrown, 6) > 2 * span(plain, 6), `spans ${span(plain, 6)} and ${span(thrown, 6)} at frame 6`);
  // Carriers thrown at a wall drop their smoke against it and none passes.
  const walled = wave({ drag: 0, release: 0.05 }, { obstacles: [{ symbol: 'ground', x: 0, y: 44 }, { symbol: 'wall', x: 84, y: 0 }] });
  assert.equal(walled.frames.reduce((n, _, f) => n + drawn(walled, f).filter(([x]) => x >= 86).length, 0), 0);
  assert.ok(drawn(walled, 6).some(([x]) => x === 83), 'smoke piles against the wall');
  // Dust settles on a closed floor as it does on an obstacle; through an open edge it leaves.
  const settle = walls => compileFluid({ ...gas(null), width: 32, height: 32, effects: { e: { frames: 24, buoyancy: 0, dissipation: 0, walls, emitters: [{ at: [16, 10], radius: 3, burst: 1, density: 1, carry: { gravity: [0, 0.3], release: 0.02 } }], look: [{ field: 'density', colors: ['s'], thresholds: [0.3], dither: 0 }] } } }).recipe;
  const piled = walls => drawn(settle(walls), 23).filter(([, y]) => y >= 28).length;
  assert.ok(piled(['bottom']) >= 8 && piled([]) === 0, `${piled(['bottom'])} dense pixels on a closed floor, ${piled([])} on an open one`);
  // An orbiting carry emitter throws once a frame, so it stays well inside the carrier limit.
  assert.doesNotThrow(() => compileFluid({ ...gas(null), width: 64, height: 32, effects: { e: { frames: 24, emitters: [{ at: [32, 16], radius: 4, rate: 1, density: 1, carry: {}, orbit: { radius: 8, period: 4 } }], look: smoke } } }));
  // The same source gives the same frames, compiled or live.
  const source = { ...gas(null), width: 64, height: 32, effects: { e: { frames: 10, emitters: [{ at: [10, 20], radius: 2, rate: 1, end: 4, density: 1, temperature: 0.5, velocity: [6, -1], noise: 0.5, carry: { gravity: [0, 0.05] } }], look: [{ field: 'density', colors: ['s'], thresholds: [0.1], dither: 0 }] } } };
  const { recipe } = compileFluid(source), live = createLiveFluid(source, { warmup: 0 });
  for (let f = 0; f < 10; f++) {
    live.step();
    const cells = new Set(drawn(recipe, f).map(([x, y]) => y * 64 + x)), seen = new Set();
    live.render().keys.forEach((row, y) => [...row].forEach((char, x) => { if (char !== '.') seen.add(y * 64 + x); }));
    assert.deepEqual(seen, cells, `frame ${f}`);
  }
});

test('keys change a liquid on cue: a held heap gives way, a clinging film drops', () => {
  const heap = keys => compileFluid(goo({ frames: 60, yield: 4, apic: true, ...(keys && { keys }) }, [{ x: 18, y: 8, w: 12, h: 24 }])).recipe;
  const height = (recipe, f) => 32 - highest(drawn(recipe, f));
  // Held up by its yield, the heap stands until the key drops it, then slumps within ten frames.
  const [held, cued, ramped] = [heap(null), heap([{ frame: 40, yield: 0.3 }]), heap([{ frame: 40, yield: 0.3, over: 15 }])];
  assert.deepEqual(cued.frames.slice(0, 40), held.frames.slice(0, 40), 'nothing changes before the key');
  assert.ok(height(held, 59) >= 19 && height(cued, 39) >= 19 && height(cued, 50) <= height(cued, 39) - 6, `held ${height(held, 59)}, cued ${height(cued, 39)} then ${height(cued, 50)}`);
  assert.ok(height(ramped, 45) > height(cued, 45), 'a key with over eases in');
  // A film that adhesion holds under a ledge drops once a key sets adhesion to 0.
  const film = compileFluid(goo({ frames: 40, adhesion: 4, obstacles: [{ symbol: 'slab', x: 14, y: 6 }], keys: [{ frame: 20, adhesion: 0 }] }, [{ x: 14, y: 7, w: 20, h: 3 }], { symbols: { slab: ['k'.repeat(20)] } })).recipe;
  const under = f => drawn(film, f).filter(([, y]) => y === 7).length;
  assert.ok(under(19) >= 8 && under(39) === 0, `${under(19)} pixels under the ledge at frame 19, ${under(39)} at 39`);
  // A key at frame 0 is the same as the setting itself, spray that falls by the effect's gravity included.
  const sideways = extra => compileFluid(goo({ frames: 24, walls: FLUID_WALLS, whitewater: [{ impact: 0.5, chance: 0.5, colors: ['w'], life: 10 }], ...extra }, [{ at: [24, 8], radius: 4, velocity: [0, 3] }])).recipe;
  assert.deepEqual(sideways({ gravity: [0, 0.3], keys: [{ frame: 0, gravity: [0.3, 0.1] }] }), sideways({ gravity: [0.3, 0.1] }));
  // A thick liquid may get its viscosity from a key alone, and slip with it; a live runner follows the keys.
  const source = goo({ frames: 30, slip: true, keys: [{ frame: 10, viscosity: 16 }, { frame: 20, gravity: [0.3, 0] }] }, [{ x: 18, y: 14, w: 12, h: 12 }]);
  const { recipe } = compileFluid(source), live = createLiveFluid(source, { warmup: 0 });
  for (let f = 0; f < 30; f++) {
    live.step();
    const cells = new Set(drawn(recipe, f).map(([x, y]) => y * 48 + x)), seen = new Set();
    live.render().keys.forEach((row, y) => [...row].forEach((char, x) => { if (char !== '.') seen.add(y * 48 + x); }));
    assert.deepEqual(seen, cells, `frame ${f}`);
  }
});

test('obstacles move and vanish on cue, pushing the fluid ahead of them', () => {
  const wall = Array(20).fill('kk'), tank = (obstacle, extra = {}) => compileFluid({ ...gas(null), width: 64, height: 32, symbols: { wall }, effects: { e: { kind: 'liquid', frames: 40, walls: ['left', 'right', 'bottom'], emitters: [], fill: [{ x: 0, y: 12, w: 20, h: 20 }], obstacles: [{ symbol: 'wall', x: 20, y: 12, ...obstacle }], look: [{ field: 'density', colors: ['s'], thresholds: [0.5], dither: 0 }], ...extra } } });
  const right = (figures, f) => figures.box[f][2];
  // A dam holds the water until it vanishes at frame 15, then the water floods out; it is stamped only while it stands.
  const held = tank({}), dam = tank({ keys: [{ frame: 15, show: false }] }), damFigures = dam.metadata.effects.e.figures;
  assert.deepEqual(dam.recipe.frames.slice(0, 15), held.recipe.frames.slice(0, 15), 'nothing changes before the first key');
  assert.ok(right(damFigures, 14) === 19 && right(damFigures, 30) >= 50, `right edge ${right(damFigures, 14)} → ${right(damFigures, 30)}`);
  assert.ok(dam.recipe.frames[14].ops.some(op => op.op === 'stamp') && !dam.recipe.frames[16].ops.some(op => op.op === 'stamp'));
  // A gate lifts in whole pixels over ten frames, stamped where it is, and the water runs out under it.
  const gate = tank({ keys: [{ frame: 15, y: 0, over: 10 }] });
  assert.deepEqual([15, 20, 25].map(f => gate.recipe.frames[f].ops.find(op => op.op === 'stamp').y), [12, 6, 0]);
  assert.ok(right(gate.metadata.effects.e.figures, 30) > 40);
  // A plunger carries the water with it and keeps almost all of it.
  const plunger = compileFluid({ ...gas(null), width: 64, height: 32, symbols: { wall }, effects: { e: { kind: 'liquid', frames: 40, walls: ['left', 'right', 'bottom'], emitters: [], fill: [{ x: 8, y: 16, w: 20, h: 16 }], obstacles: [{ symbol: 'wall', x: 4, y: 12, keys: [{ frame: 5, x: 40, over: 30 }] }], look: [{ field: 'density', colors: ['s'], thresholds: [0.5], dither: 0 }] } } }).metadata.effects.e.figures;
  assert.ok(plunger.middle[35][0] > plunger.middle[0][0] + 25 && plunger.particles[39] >= 0.98 * plunger.particles[0], `middle ${plunger.middle[0][0]} → ${plunger.middle[35][0]}, particles ${plunger.particles[0]} → ${plunger.particles[39]}`);
  // A paddle sweeps smoke along.
  const paddle = compileFluid(gas({ frames: 30, buoyancy: 0, dissipation: 0.01, emitters: [{ at: [20, 20], radius: 6, burst: 1, density: 1 }], obstacles: [{ symbol: 'paddle', x: 6, y: 12, keys: [{ frame: 4, x: 50, over: 22 }] }], look: smoke }, { width: 64, height: 32, symbols: { paddle: Array(14).fill('kk') } })).metadata.effects.plume.figures;
  assert.ok(paddle.middle[24][0] > paddle.middle[0][0] + 15, `smoke middle ${paddle.middle[0][0]} → ${paddle.middle[24][0]}`);
  // A loop repeats the keys every cycle; a live runner moves obstacles as a compile does.
  assert.doesNotThrow(() => tank({ draw: 'under', keys: [{ frame: 4, y: 4, over: 6 }, { frame: 12, y: 12, over: 6 }] }, { frames: 20, loop: true, fill: [{ x: 0, y: 24, w: 64, h: 8 }] }));
  const source = { ...gas(null), width: 64, height: 32, symbols: { wall }, effects: { e: { kind: 'liquid', frames: 24, walls: ['left', 'right', 'bottom'], emitters: [], fill: [{ x: 8, y: 16, w: 20, h: 16 }], obstacles: [{ symbol: 'wall', x: 4, y: 12, draw: 'none', keys: [{ frame: 3, x: 40, over: 18 }] }], look: [{ field: 'density', colors: ['s'], thresholds: [0.5], dither: 0 }] } } };
  const { recipe } = compileFluid(source), live = createLiveFluid(source, { warmup: 0 });
  for (let f = 0; f < 24; f++) {
    live.step();
    const cells = new Set(drawn(recipe, f).map(([x, y]) => y * 64 + x)), seen = new Set();
    live.render().keys.forEach((row, y) => [...row].forEach((char, x) => { if (char !== '.') seen.add(y * 64 + x); }));
    assert.deepEqual(seen, cells, `frame ${f}`);
  }
  // A piston never shoves water or smoke through a thin wall in its way (before the fix, water showed at x 22 to 27).
  const thin = { piston16: Array(16).fill('kk'), piston24: Array(24).fill('kk'), wall: Array(24).fill('k') };
  const past = effect => { const { recipe } = compileFluid({ ...gas(null), width: 40, height: 24, symbols: thin, effects: { e: { frames: 30, ...effect } } }); return recipe.frames.reduce((n, _, f) => n + drawn(recipe, f).filter(([x]) => x > 20).length, 0); };
  assert.equal(past({ kind: 'liquid', walls: ['left', 'bottom', 'top'], emitters: [], fill: [{ x: 12, y: 8, w: 8, h: 16 }], obstacles: [{ symbol: 'wall', x: 20, y: 0 }, { symbol: 'piston16', x: 10, y: 8, keys: [{ frame: 4, x: 18, over: 16 }] }], look: [{ field: 'density', colors: ['s'], thresholds: [0.25], dither: 0 }] }), 0, 'water past the wall');
  assert.equal(past({ buoyancy: 0, dissipation: 0, walls: ['left', 'top', 'bottom'], emitters: [{ at: [16, 12], area: [8, 24], burst: 1, density: 1 }], obstacles: [{ symbol: 'wall', x: 20, y: 0 }, { symbol: 'piston24', x: 10, y: 0, keys: [{ frame: 4, x: 18, over: 16 }] }], look: [{ field: 'density', colors: ['s'], thresholds: [0.05], dither: 0 }] }), 0, 'smoke past the wall');
  // A jump is a cut: a block jumping 40 pixels through still smoke blasts nothing (before the fix, 39.6 pixels a frame).
  const cut = compileFluid({ ...gas(null), width: 64, height: 24, symbols: { block: Array(8).fill('kk') }, effects: { e: { frames: 12, buoyancy: 0, vorticity: 0, dissipation: 0, walls: FLUID_WALLS, emitters: [{ at: [32, 12], area: [64, 24], burst: 1, density: 1 }], obstacles: [{ symbol: 'block', x: 4, y: 8, keys: [{ frame: 3, x: 44 }] }], look: [{ field: 'density', colors: ['s'], thresholds: [0.05], dither: 0 }] } } }).metadata.effects.e.figures;
  assert.ok(Math.max(...cut.speed) < 1, `top speed ${Math.max(...cut.speed)} after a jump`);
  // A thick liquid on a smooth ramp falls once the ramp vanishes, without the ramp's drag.
  const ramp = compileFluid({ ...gas(null), width: 32, height: 32, symbols: { ramp: ['kk..............', 'kkkk............', '..kkkk..........', '....kkkk........', '......kkkk......', '........kkkk....', '..........kkkk..', '............kkkk'] }, effects: { e: { kind: 'liquid', frames: 26, viscosity: 8, apic: true, walls: ['left', 'right', 'bottom'], emitters: [], fill: [{ x: 2, y: 2, w: 10, h: 8 }], obstacles: [{ symbol: 'ramp', x: 0, y: 10, surface: 'smooth', keys: [{ frame: 12, show: false }] }], look: [{ field: 'density', colors: ['s'], thresholds: [0.5], dither: 0 }] } } }).metadata.effects.e.figures;
  assert.ok(ramp.middle[25][1] > 28, `middle at y ${ramp.middle[25][1]} on frame 25`);
  // An emitter under an obstacle that moves off it is not buried.
  const lid = compileFluid(gas({ frames: 8, obstacles: [{ symbol: 'lid', x: 6, y: 10, keys: [{ frame: 3, x: 0 }] }], emitters: [{ at: [8, 11], radius: 1, rate: 1, density: 1 }], look: smoke }, { symbols: { lid: ['kkkkk', 'kkkkk', 'kkkkk'] } }));
  assert.equal(lid.warnings, undefined);
});

test('per-frame figures measure where the fluid is, how much there is and in how many pieces', async () => {
  // A ball dropped in a closed box: its middle falls, it stays one piece with every particle, and it lands.
  const drop = compileFluid(goo({ frames: 30, walls: FLUID_WALLS }, [{ at: [24, 6], radius: 4 }]));
  const { figures } = drop.metadata.effects.goo;
  assert.deepEqual(Object.keys(figures), ['box', 'middle', 'amount', 'pieces', 'speed', 'particles']);
  assert.ok(figures.box.every(Boolean) && figures.box.length === 30);
  assert.ok(figures.middle[10][1] > figures.middle[0][1] + 5 && figures.box[29][3] === 31, `middle ${figures.middle[0]} → ${figures.middle[10]}, bottom ${figures.box[29][3]}`);
  assert.ok(figures.pieces.slice(0, 8).every(n => n === 1) && new Set(figures.particles).size === 1);
  assert.ok(Math.max(...figures.speed.slice(0, 12)) > 2, 'it falls fast before it lands');
  // A burst shows its pieces; smoke thins as it dissipates.
  const burst = compileFluid(goo({ frames: 9, gravity: [0, 0], walls: [] }, [{ at: [24, 16], radius: 6, burst: { speed: 2 } }])).metadata.effects.goo.figures;
  assert.ok(burst.pieces[8] >= 4, `${burst.pieces[8]} pieces`);
  const puff = compileFluid(gas({ frames: 12, buoyancy: 0, dissipation: 0.2, emitters: [{ at: [8, 8], radius: 3, burst: 1, density: 1 }], look: smoke })).metadata.effects.plume.figures;
  assert.ok(puff.amount[11] < puff.amount[0] / 2 && puff.particles === undefined, `${puff.amount[0]} → ${puff.amount[11]}`);
  // A live runner measures the same, frame for frame.
  const source = goo({ frames: 12, walls: FLUID_WALLS }, [{ at: [24, 6], radius: 4 }]), live = createLiveFluid(source, { warmup: 0 }), compiled = compileFluid(source).metadata.effects.goo.figures;
  for (let f = 0; f < 12; f++) { live.step(); assert.deepEqual(live.measure(), Object.fromEntries(Object.keys(compiled).map(key => [key, compiled[key][f]])), `frame ${f}`); }
});

test('a bursting fill flies apart in mid-air in pieces, keeping its volume', () => {
  const ball = burst => compileFluid({ ...gas(null), width: 64, height: 64, effects: { e: { kind: 'liquid', frames: 9, seed: 2, gravity: [0, 0.05], fill: [{ at: [32, 30], radius: 8, ...(burst && { burst }) }], emitters: [], look: [{ field: 'density', colors: ['s'], thresholds: [0.5], dither: 0 }] } } }).recipe;
  const blobs = cells => { const set = new Set(cells.map(([x, y]) => y * 64 + x)), seen = new Set(); let n = 0; for (const c of set) { if (seen.has(c)) continue; n++; const stack = [c]; seen.add(c); while (stack.length) { const d = stack.pop(); for (const e of [d - 1, d + 1, d - 64, d + 64]) if (set.has(e) && !seen.has(e) && Math.abs((e % 64) - (d % 64)) <= 1) { seen.add(e); stack.push(e); } } } return n; };
  const width = cells => Math.max(...cells.map(([x]) => x)) - Math.min(...cells.map(([x]) => x)) + 1;
  const [still, burst] = [ball(null), ball({ speed: 2.5 })];
  // A plain ball stays one ball; a burst one is in pieces three times as wide by frame 8, with about the same water.
  assert.equal(blobs(drawn(still, 8)), 1);
  assert.ok(blobs(drawn(burst, 8)) >= 6 && width(drawn(burst, 8)) >= 3 * width(drawn(still, 8)), `${blobs(drawn(burst, 8))} pieces, ${width(drawn(burst, 8))} pixels wide`);
  assert.ok(drawn(burst, 1).length >= 0.85 * drawn(still, 1).length, `${drawn(burst, 1).length} pixels against ${drawn(still, 1).length}`);
  // Every particle is kept, even when a small fill breaks into more pieces than it has room for.
  const particles = (radius, burst) => compileFluid({ ...gas(null), width: 32, height: 32, effects: { e: { kind: 'liquid', frames: 1, gravity: [0, 0], fill: [{ at: [16, 16], radius, ...(burst && { burst }) }], emitters: [], look: [{ field: 'density', colors: ['s'], thresholds: [0.5] }] } } }).metadata.effects.e.particles;
  for (const [radius, pieces] of [[1, 8], [2, 8], [3, 8], [8, 64]]) assert.equal(particles(radius, { speed: 2, pieces }), particles(radius, null), `radius ${radius}, ${pieces} pieces`);
  // Speeds picked per piece spread the pieces unevenly; the same source bursts the same way every time.
  assert.deepEqual(ball({ speed: [1.5, 3.5], pieces: 12 }), ball({ speed: [1.5, 3.5], pieces: 12 }));
  assert.notDeepEqual(ball({ speed: [1.5, 3.5], pieces: 12 }), ball({ speed: 2.5, pieces: 12 }));
});

test('setups that compile but make nothing, or start stuck, are warned about with the field to change', async () => {
  // No preset sets off a warning.
  for (const name of FLUID_SHOWCASE) assert.equal((await example(name)).warnings, undefined, name);
  const warned = (effect, extra = {}) => { const result = compileFluid({ ...gas(null), width: 32, height: 32, symbols: { rock: Array(4).fill('kkkkkkkk'), bar: ['k'.repeat(20)] }, ...extra, effects: { e: { frames: 6, look: smoke, ...effect } } }); assert.deepEqual(result.metadata.effects.e.warnings, result.warnings); return result.warnings ?? []; };
  // An emitter buried in an obstacle, or off the canvas, adds nothing; one partly clear is fine.
  assert.match(warned({ obstacles: [{ symbol: 'rock', x: 10, y: 20 }], emitters: [{ at: [14, 21.5], radius: 1, rate: 1, density: 1, sparks: { count: 1, colors: ['s'] } }] })[0], /^fluid\.effects\.e\.emitters\[0\] lies inside obstacles\[0\] whenever it emits, so it adds no gas \(its sparks still show\)/);
  assert.match(warned({ kind: 'liquid', obstacles: [{ symbol: 'rock', x: 10, y: 20 }], emitters: [{ at: [14, 22], radius: 1, rate: 1 }] })[0], /adds no water/);
  assert.match(warned({ emitters: [{ at: [-20, 10], radius: 2, rate: 1, density: 1 }] })[0], /lies outside the canvas/);
  assert.deepEqual(warned({ obstacles: [{ symbol: 'rock', x: 10, y: 20 }], emitters: [{ at: [14, 19.5], radius: 2, rate: 1, density: 1 }] }), []);
  // An orbiting emitter that clears the obstacle on some frames is fine.
  assert.deepEqual(warned({ obstacles: [{ symbol: 'rock', x: 10, y: 20 }], emitters: [{ at: [14, 22], radius: 1, rate: 1, density: 1, orbit: { radius: 6, period: 6 } }] }), []);
  // A liquid fill hanging under a pixel obstacle is warned about; under a smooth one, or resting on a floor, it is not.
  const hanging = surface => warned({ kind: 'liquid', obstacles: [{ symbol: 'bar', x: 6, y: 5, ...(surface && { surface }) }], fill: [{ at: [16, 12], radius: 6 }], emitters: [] });
  assert.match(hanging()[0], /^fluid\.effects\.e\.fill\[0\] starts against the underside of obstacles\[0\] along 4 pixels.*surface: "smooth"/);
  assert.deepEqual(hanging('smooth'), []);
  assert.deepEqual(warned({ kind: 'liquid', walls: ['left', 'right', 'bottom'], obstacles: [{ symbol: 'bar', x: 6, y: 20 }], fill: [{ x: 0, y: 21, w: 32, h: 11 }], emitters: [] }), []);
  assert.match(warned({ kind: 'liquid', walls: ['top', 'bottom'], fill: [{ x: 4, y: 0, w: 8, h: 4 }], emitters: [] })[0], /closed top edge/);
  // Water resting on other water, a round fill standing on a floor, and fills thrown down or bursting are not stuck.
  assert.deepEqual(warned({ kind: 'liquid', walls: FLUID_WALLS, fill: [{ x: 4, y: 26, w: 8, h: 6 }, { x: 4, y: 0, w: 8, h: 26 }], emitters: [] }), []);
  assert.deepEqual(warned({ kind: 'liquid', walls: ['left', 'right', 'bottom'], obstacles: [{ symbol: 'bar', x: 6, y: 15 }], fill: [{ at: [16, 24], radius: 8 }], emitters: [] }), []);
  assert.deepEqual(warned({ kind: 'liquid', obstacles: [{ symbol: 'bar', x: 6, y: 5 }], fill: [{ at: [16, 12], radius: 6, velocity: [0, 4] }], emitters: [] }), []);
  assert.deepEqual(warned({ kind: 'liquid', obstacles: [{ symbol: 'bar', x: 6, y: 5 }], fill: [{ at: [16, 12], radius: 6, burst: { speed: 2 } }], emitters: [] }), []);
  // Gravity a key turns on counts.
  assert.match(warned({ kind: 'liquid', gravity: [0, 0], keys: [{ frame: 2, gravity: [0, 0.3] }], obstacles: [{ symbol: 'bar', x: 6, y: 5 }], fill: [{ at: [16, 12], radius: 6 }], emitters: [] })[0], /underside of obstacles\[0\]/);
  // An orbiting emitter buried on every whole frame but clear on the path between them still makes gas.
  const rocks = { symbols: { rock: ['kkk', 'kkk', 'kkk'] } }, spots = [[22, 16], [16, 22], [10, 16], [16, 10]].map(([x, y]) => ({ symbol: 'rock', x: x - 1, y: y - 1 }));
  assert.deepEqual(warned({ frames: 8, obstacles: spots, emitters: [{ at: [16, 16], radius: 0.5, rate: 1, density: 1, orbit: { radius: 6, period: 4 } }] }, rocks), []);
  // A live runner carries the same warnings.
  assert.equal(createLiveFluid({ ...gas(null), width: 32, height: 32, effects: { e: { frames: 6, look: smoke, emitters: [{ at: [-20, 10], radius: 2, rate: 1, density: 1 }] } } }, { warmup: 0 }).warnings.length, 1);
});

test('fluid sources fail early with paths an agent can act on', async () => {
  const emitter = { at: [8, 8], rate: 1, density: 1 }, ok = { frames: 6, emitters: [emitter], look: smoke };
  const bad = (change, where, message) => {
    const source = gas({ ...ok }), effect = source.effects.plume;
    change(effect, source);
    assert.throws(() => compileFluid(source), error => error instanceof PixelError && error.path === where && (!message || message.test(error.message)), `${where}`);
  };
  bad(e => { e.emitters = [{ ...emitter, rate: 0 }]; }, 'fluid.effects.plume.emitters[0].rate', /0\.01 to 64/);
  bad(e => { e.emitters = [{ ...emitter, burst: 1 }]; }, 'fluid.effects.plume.emitters[0]', /exactly one of burst/);
  bad(e => { e.emitters = [{ ...emitter, radius: 2, area: [2, 2] }]; }, 'fluid.effects.plume.emitters[0]', /radius .* or area/);
  bad(e => { e.emitters = [{ ...emitter, wobble: 1 }]; }, 'fluid.effects.plume.emitters[0].wobble', /unknown/);
  bad(e => { e.look = [{ field: 'density', colors: ['sw'], thresholds: [0.2] }]; }, 'fluid.effects.plume.look[0].colors[0]', /one-character palette key/);
  bad(e => { e.look = [{ field: 'density', colors: ['q'], thresholds: [0.2] }]; }, 'fluid.effects.plume.look[0].colors[0]', /palette key/);
  bad(e => { e.look = [{ field: 'density', colors: ['s', 'w'], thresholds: [0.5, 0.2] }]; }, 'fluid.effects.plume.look[0].thresholds[1]', /rise/);
  bad(e => { e.look = [{ field: 'smoke', colors: ['s'], thresholds: [0.5] }]; }, 'fluid.effects.plume.look[0].field', /density, temperature, speed, depth, light, shadow/);
  bad(e => { e.look = []; }, 'fluid.effects.plume.look', /1–8 layers/);
  bad(e => { e.gravity = [0, 1]; }, 'fluid.effects.plume.gravity', /applies to liquids/);
  bad(e => { e.kind = 'liquid'; e.buoyancy = 1; }, 'fluid.effects.plume.buoyancy', /applies to gases/);
  bad(e => { e.kind = 'liquid'; e.emitters = [{ ...emitter, temperature: 1 }]; }, 'fluid.effects.plume.emitters[0].temperature', /gases/);
  bad(e => { e.kind = 'liquid'; e.look = [{ field: 'temperature', colors: ['s'], thresholds: [1] }]; }, 'fluid.effects.plume.look[0].field', /no temperature/);
  bad(e => { e.loop = true; e.emitters = [{ ...emitter, pulse: { period: 4 } }]; }, 'fluid.effects.plume.emitters[0].pulse.period', /must divide 6/);
  bad(e => { e.emitters = [{ ...emitter, orbit: { radius: 2, period: 0 } }]; }, 'fluid.effects.plume.emitters[0].orbit.period', /anticlockwise/);
  bad(e => { e.blend = 2; }, 'fluid.effects.plume.blend', /loop: true/);
  bad(e => { e.emitters = [{ ...emitter, sparks: { count: 1, colors: ['s'], pop: true } }]; }, 'fluid.effects.plume.emitters[0].sparks.pop', /liquids/);
  bad(e => { e.yield = 1; }, 'fluid.effects.plume.yield', /applies to liquids/);
  bad(e => { e.apic = true; }, 'fluid.effects.plume.apic', /applies to liquids/);
  bad(e => { e.adhesion = 1; }, 'fluid.effects.plume.adhesion', /applies to liquids/);
  bad(e => { e.kind = 'liquid'; e.advection = 'sharp'; }, 'fluid.effects.plume.advection', /applies to gases/);
  bad(e => { e.advection = 'crisp'; }, 'fluid.effects.plume.advection', /smooth .* sharp/);
  bad(e => { e.slip = true; }, 'fluid.effects.plume.slip', /set viscosity$/);
  bad(e => { e.kind = 'liquid'; e.slip = true; }, 'fluid.effects.plume.slip', /set viscosity or yield/);
  bad(e => { e.viscosity = 65; }, 'fluid.effects.plume.viscosity', /0 to 64/);
  bad(e => { e.kind = 'liquid'; e.yield = 17; }, 'fluid.effects.plume.yield', /0 to 16/);
  bad(e => { e.kind = 'liquid'; e.viscosity = 1; e.slip = 'yes'; }, 'fluid.effects.plume.slip', /true or false/);
  bad(e => { e.walls = ['top', 'top']; }, 'fluid.effects.plume.walls', /once/);
  bad(e => { e.walls = ['up']; }, 'fluid.effects.plume.walls[0]', /left, right, top, bottom/);
  bad(e => { e.obstacles = [{ symbol: 'nope' }]; }, 'fluid.effects.plume.obstacles[0].symbol', /unknown symbol/);
  bad((e, s) => { s.symbols = { slab: ['kkkk'] }; e.obstacles = [{ symbol: 'slab', x: 14 }]; }, 'fluid.effects.plume.obstacles[0]', /must fit inside the 16 × 16 canvas/);
  bad((e, s) => { s.symbols = { slab: ['kkkk'] }; e.obstacles = [{ symbol: 'slab', surface: 'round' }]; }, 'fluid.effects.plume.obstacles[0].surface', /pixels .* smooth/);
  bad((e, s) => { s.symbols = { slab: ['kkkk'] }; e.obstacles = [{ symbol: 'slab', solid: false, draw: 'none' }]; }, 'fluid.effects.plume.obstacles[0].draw', /decoration .* over or under/);
  bad((e, s) => { s.symbols = { slab: ['kkkk'] }; e.obstacles = [{ symbol: 'slab', solid: false, surface: 'smooth' }]; }, 'fluid.effects.plume.obstacles[0].surface', /never meets a decoration/);
  assert.doesNotThrow(() => compileFluid(gas({ ...ok, obstacles: [{ symbol: 'slab', solid: false, surface: 'pixels' }] }, { symbols: { slab: ['kkkk'] } })));
  bad((e, s) => { s.symbols = { slab: ['kkkk'] }; e.obstacles = [{ symbol: 'slab', solid: 'no' }]; }, 'fluid.effects.plume.obstacles[0].solid', /true or false/);
  bad(e => { Object.assign(e, { kind: 'liquid', fill: [{ at: [8, 8], radius: 3, burst: { pieces: 4 } }] }); }, 'fluid.effects.plume.fill[0].burst.speed', /pixels per frame/);
  bad(e => { Object.assign(e, { kind: 'liquid', emitters: [{ at: [8, 8], rate: 1, carry: {} }] }); }, 'fluid.effects.plume.emitters[0].carry', /liquid particles/);
  bad(e => { e.keys = [{ frame: 2, yield: 1 }]; }, 'fluid.effects.plume.keys', /applies to liquids/);
  bad(e => { Object.assign(e, { kind: 'liquid', keys: [{ frame: 6, yield: 1 }] }); }, 'fluid.effects.plume.keys[0].frame', /0 to 5/);
  bad(e => { Object.assign(e, { kind: 'liquid', keys: [{ frame: 3, yield: 1 }, { frame: 2, yield: 0 }] }); }, 'fluid.effects.plume.keys[1].frame', /frame order/);
  bad(e => { Object.assign(e, { kind: 'liquid', keys: [{ frame: 3 }] }); }, 'fluid.effects.plume.keys[0]', /at least one of yield, viscosity, adhesion, gravity/);
  bad((e, s) => { s.symbols = { slab: ['kkkk'] }; e.obstacles = [{ symbol: 'slab', keys: [{ frame: 2 }] }]; }, 'fluid.effects.plume.obstacles[0].keys[0]', /moves the obstacle/);
  bad((e, s) => { s.symbols = { slab: ['kkkk'] }; e.obstacles = [{ symbol: 'slab', keys: [{ frame: 3, x: 2 }, { frame: 1, x: 4 }] }]; }, 'fluid.effects.plume.obstacles[0].keys[1].frame', /frame order/);
  bad((e, s) => { s.symbols = { slab: ['kkkk'] }; e.obstacles = [{ symbol: 'slab', keys: [{ frame: 2, x: 14 }] }]; }, 'fluid.effects.plume.obstacles[0].keys[0]', /must fit inside the 16 × 16 canvas/);
  bad((e, s) => { s.symbols = { slab: ['kkkk'] }; e.obstacles = [{ symbol: 'slab', keys: [{ frame: 1, x: 14, over: 2 }] }]; }, 'fluid.effects.plume.obstacles[0].keys[0]', /on every frame it shows/);
  bad(e => { e.emitters = [{ ...emitter, density: -1, carry: {} }]; }, 'fluid.effects.plume.emitters[0].carry', /draining emitter/);
  bad(e => { e.emitters = [{ ...emitter, carry: { drag: 2 } }]; }, 'fluid.effects.plume.emitters[0].carry.drag', /0 to 1/);
  bad(e => { e.emitters = [{ at: [8, 8], burst: 1, velocity: [8, 0], carry: {} }]; }, 'fluid.effects.plume.emitters[0].carry', /positive density or temperature/);
  bad(e => { Object.assign(e, { kind: 'liquid', fill: [{ at: [8, 8], radius: 3, burst: { speed: 2, pieces: 1 } }] }); }, 'fluid.effects.plume.fill[0].burst.pieces', /2 to 64/);
  bad(e => { e.light = [0, 0]; }, 'fluid.effects.plume.light', /toward the light/);
  bad(e => { e.outline = 'z'; }, 'fluid.effects.plume.outline', /palette key/);
  bad(e => { e.kind = 'liquid'; e.emitters = []; e.fill = [{ x: 0, y: 0 }]; }, 'fluid.effects.plume.fill[0].w', /integer from 1 to 16/);
  bad(e => { e.emitters = []; }, 'fluid.effects.plume.emitters', /1–16 emitters/);
  bad((e, s) => { s.width = 129; }, 'fluid.width', /4 to 128/);
  bad((e, s) => { s.effects.Plume = e; }, 'fluid.effects.Plume', /ignoring case/);
  bad((e, s) => { s.effects = { a: { ...ok, frames: 200 }, b: { ...ok, frames: 100 } }; }, 'fluid.effects', /at most 256/);
  assert.throws(() => compileFluid({ ...gas(ok), format: 'pixelforge-fx' }), error => error.path === 'fluid');
  // The same paths on a real preset: the agent can patch exactly the field that is wrong.
  const campfire = await read('examples/campfire.fluid.json');
  campfire.effects.campfire.emitters[0].rate = 99;
  assert.throws(() => compileFluid(campfire), error => error.path === 'fluid.effects.campfire.emitters[0].rate' && /0\.01 to 64/.test(error.message));
  // A liquid that grows without bound is stopped with the effect's path.
  assert.throws(() => compileFluid({ ...gas(null), width: 128, height: 128, effects: { flood: { kind: 'liquid', frames: 60, substeps: 1, iterations: 1, fill: [{ x: 0, y: 0, w: 128, h: 64 }], emitters: [{ at: [64, 96], area: [128, 64], rate: 1 }], look: smoke } } }), error => error.path === 'fluid.effects.flood' && /32768 liquid particles/.test(error.message));
});

test('limits are reported with the effect path, extreme settings stay finite, and any palette key draws its own colour', () => {
  const liquidBox = (emitters, fill) => ({ ...gas(null), width: 128, height: 128, effects: { flood: { kind: 'liquid', frames: 2, substeps: 1, iterations: 1, walls: ['left', 'right', 'bottom'], fill, emitters, look: smoke } } });
  // A drain in the same frame must not hide water the particle limit refused.
  assert.throws(() => compileFluid(liquidBox([{ at: [64, 64], area: [128, 128], rate: 1, density: -0.5 }], [{ x: 0, y: 0, w: 128, h: 128 }])), error => error.path === 'fluid.effects.flood' && /32768 liquid particles/.test(error.message));
  const sparks = gas({ frames: 40, emitters: [{ at: [8, 8], rate: 1, sparks: { count: 16, life: 256, colors: ['w'] } }, { at: [8, 8], rate: 1, sparks: { count: 16, life: 256, colors: ['w'] } }], look: smoke });
  assert.throws(() => compileFluid({ ...sparks, effects: { plume: { ...sparks.effects.plume, frames: 200 } } }), error => error.path === 'fluid.effects.plume' && /4096 sparks/.test(error.message));
  // The work budget refuses the most expensive source the schema allows before simulating anything.
  const started = performance.now();
  assert.throws(() => compileFluid({ ...gas({ frames: 256, loop: true, warmup: 8, substeps: 4, iterations: 200, emitters: [{ at: [8, 8], rate: 1, density: 1 }], look: smoke }), width: 128, height: 128 }), error => error.path === 'fluid.effects.plume' && /million cell updates/.test(error.message));
  assert.ok(performance.now() - started < 1000);
  // A viscosity solve costs about three times a plain step, and the budget counts it.
  const plain = { ...gas({ frames: 20, substeps: 4, iterations: 200, emitters: [{ at: [8, 8], rate: 1, density: 1 }], look: smoke }), width: 128, height: 128 };
  assert.throws(() => compileFluid({ ...plain, effects: { plume: { ...plain.effects.plume, viscosity: 1 } } }), error => error.path === 'fluid.effects.plume' && /million cell updates/.test(error.message));
  // The strongest in-range forcing stays finite: flows are capped at 32 pixels per frame.
  const wild = compileFluid({ ...gas({ frames: 48, walls: ['left', 'right', 'top', 'bottom'], substeps: 1, vorticity: 2, buoyancy: 2, dissipation: 0, cooling: 0, drag: 0,
    emitters: [{ at: [8, 8], radius: 6, rate: 64, density: 16, temperature: 16, vortex: 16, noise: 8, flicker: 1, sparks: { count: 4, life: 20, colors: ['w'], trail: true } }], look: smoke }), width: 32, height: 32 });
  assert.ok(Number.isFinite(wild.metadata.effects.plume.peak.speed) && wild.metadata.effects.plume.peak.speed <= 46);
  // Liquid particles keep to the cap too, cohesion included: 32 pixels a frame along each axis.
  const flung = compileFluid({ ...gas(null), width: 32, height: 32, effects: { flood: { kind: 'liquid', frames: 10, substeps: 1, tension: 4, gravity: [2, 2], walls: FLUID_WALLS, fill: [{ x: 2, y: 2, w: 28, h: 28, velocity: [16, -16] }], emitters: [{ at: [16, 16], radius: 8, rate: 64, density: 1, velocity: [16, 16], vortex: 16, noise: 8 }], look: smoke } } });
  // (Peaks in the metadata are rounded to thousandths, so 32√2 = 45.2548… reads as 45.255.)
  assert.ok(flung.metadata.effects.flood.peak.speed <= 45.255, `liquid peak speed ${flung.metadata.effects.flood.peak.speed}`);
  // Palette keys beyond Latin-1 keep their own colour in the grid rows.
  const accented = compileFluid({ ...gas({ frames: 2, emitters: [{ at: [8, 8], radius: 3, burst: 1, density: 2 }], look: [{ field: 'density', colors: ['ŧ'], thresholds: [0.5] }] }), palette: { 'ŧ': '#f00', g: '#0f0' } });
  assert.ok(accented.recipe.frames[0].ops[0].rows.join('').includes('ŧ'));
  assert.ok(renderProject(accented.recipe).frames[0].data.some((value, i) => i % 4 === 0 && value === 255));
  // An outline may cover an obstacle drawn under the fluid but never one drawn over it.
  const outlined = draw => { const source = gas({ frames: 3, outline: 'o', emitters: [{ at: [8, 11], radius: 2.5, burst: 1, density: 3 }], obstacles: [{ symbol: 'lid', x: 4, y: 8, draw }], look: smoke }, { symbols: { lid: ['kkkkkkkk'] }, palette: { s: '#888', w: '#fff', r: '#c33', y: '#fd6', k: '#000', o: '#00f' } }); return compileFluid(source).recipe.frames[0].ops.find(op => op.op === 'grid'); };
  const rowAt = (grid, y) => (grid.y <= y && y < grid.y + grid.rows.length ? grid.rows[y - grid.y] : '');
  assert.match(rowAt(outlined('under'), 8), /o/);
  assert.doesNotMatch(rowAt(outlined('over'), 8), /o/);
});

test('the fluid schema lists exactly the fields the compiler reads', async () => {
  const schema = await read('fluid.schema.json'), effect = schema.properties.effects.additionalProperties, emitter = effect.properties.emitters.items;
  const unknown = (source, where) => { try { compileFluid(source); return false; } catch (error) { assert.ok(error instanceof PixelError, String(error)); return error.path === where && /unknown or null field/.test(error.message); } };
  const base = () => gas({ frames: 4, emitters: [{ at: [8, 8], rate: 1, density: 1 }], look: smoke }, { symbols: { lid: ['k'] } });
  const levels = [
    [schema.properties, (s, key) => { s[key] = s[key] ?? 0; }, 'fluid'],
    [effect.properties, (s, key) => { s.effects.plume[key] = 0; }, 'fluid.effects.plume'],
    [emitter.properties, (s, key) => { s.effects.plume.emitters[0][key] = 0; }, 'fluid.effects.plume.emitters[0]'],
    [emitter.properties.sparks.properties, (s, key) => { s.effects.plume.emitters[0].sparks = { count: 1, colors: ['s'], [key]: 0 }; }, 'fluid.effects.plume.emitters[0].sparks'],
    [emitter.properties.pulse.properties, (s, key) => { s.effects.plume.emitters[0].pulse = { [key]: 0 }; }, 'fluid.effects.plume.emitters[0].pulse'],
    [emitter.properties.orbit.properties, (s, key) => { s.effects.plume.emitters[0].orbit = { radius: 1, [key]: 0 }; }, 'fluid.effects.plume.emitters[0].orbit'],
    [effect.properties.look.items.properties, (s, key) => { s.effects.plume.look = [{ field: 'density', colors: ['s'], thresholds: [0.5], [key]: 0 }]; }, 'fluid.effects.plume.look[0]'],
    [effect.properties.fill.items.properties, (s, key) => { Object.assign(s.effects.plume, { kind: 'liquid', fill: [{ x: 0, y: 0, w: 2, h: 2, [key]: 0 }] }); }, 'fluid.effects.plume.fill[0]'],
    [effect.properties.obstacles.items.properties, (s, key) => { s.effects.plume.obstacles = [{ symbol: 'lid', [key]: 0 }]; }, 'fluid.effects.plume.obstacles[0]'],
    [effect.properties.cleanup.properties, (s, key) => { s.effects.plume.cleanup = { [key]: 0 }; }, 'fluid.effects.plume.cleanup'],
    [effect.properties.whitewater.items.properties, (s, key) => { Object.assign(s.effects.plume, { kind: 'liquid', whitewater: [{ impact: 1, colors: ['s'], [key]: 0 }] }); }, 'fluid.effects.plume.whitewater[0]'],
    [emitter.properties.carry.properties, (s, key) => { s.effects.plume.emitters[0].carry = { [key]: 0 }; }, 'fluid.effects.plume.emitters[0].carry'],
    [effect.properties.keys.items.properties, (s, key) => { Object.assign(s.effects.plume, { kind: 'liquid', keys: [{ frame: 0, yield: 1, [key]: 0 }] }); }, 'fluid.effects.plume.keys[0]'],
    [effect.properties.obstacles.items.properties.keys.items.properties, (s, key) => { s.effects.plume.obstacles = [{ symbol: 'lid', keys: [{ frame: 0, x: 0, [key]: 0 }] }]; }, 'fluid.effects.plume.obstacles[0].keys[0]'],
    [effect.properties.fill.items.properties.burst.properties, (s, key) => { Object.assign(s.effects.plume, { kind: 'liquid', fill: [{ x: 0, y: 0, w: 2, h: 2, burst: { speed: 1, [key]: 0 } }] }); }, 'fluid.effects.plume.fill[0].burst']
  ];
  for (const [properties, put, where] of levels) {
    for (const key of Object.keys(properties)) { const source = base(); put(source, key); assert.equal(unknown(source, `${where}.${key}`), false, `${where}.${key} is in the schema but the compiler rejects it`); }
    const source = base(); put(source, 'notAField');
    assert.equal(unknown(source, `${where}.notAField`), true, `${where} accepts a field the schema does not list`);
  }
  assert.deepEqual(effect.properties.look.items.properties.field.enum, FLUID_FIELDS);
});

test('fluid sources compile from the CLI with a shared palette, and preview and sequence accept them', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-fluid-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'palette.json'), JSON.stringify({ s: '#888', w: '#fff', r: '#c33', y: '#fd6', k: '#000' }));
  const source = { ...gas({ frames: 4, emitters: [{ at: [8, 12], radius: 2, rate: 1, density: 1, temperature: 1 }], look: smoke }), palette: { $ref: 'palette.json' } };
  await writeFile(path.join(dir, 'puff.fluid.json'), JSON.stringify(source));
  const cli = (...args) => spawnSync(process.execPath, [path.join(root, 'bin/pixelbolt.js'), ...args], { encoding: 'utf8' });
  const run = cli('compile', path.join(dir, 'puff.fluid.json'), '--out', path.join(dir, 'out/puff.json'), '--metadata', path.join(dir, 'out/puff.meta.json'));
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'out/puff.json'), 'utf8')).palette, { $ref: '../palette.json' });
  assert.equal(JSON.parse(await readFile(path.join(dir, 'out/puff.meta.json'), 'utf8')).format, 'pixelforge-fluid-metadata');
  assert.equal(JSON.parse(cli('validate', path.join(dir, 'out/puff.json')).stdout).frames, 4);
  // Refuses to overwrite, and reports the source error path.
  assert.match(cli('compile', path.join(dir, 'puff.fluid.json'), '--out', path.join(dir, 'out/puff.json')).stderr, /already exists/);
  await writeFile(path.join(dir, 'bad.fluid.json'), JSON.stringify({ ...source, effects: { plume: { ...source.effects.plume, emitters: [{ at: [8, 8], rate: 99 }] } } }));
  assert.match(cli('compile', path.join(dir, 'bad.fluid.json'), '--out', path.join(dir, 'bad.json')).stderr, /fluid\.effects\.plume\.emitters\[0\]\.rate/);
  // A setup that compiles but makes nothing says so.
  await writeFile(path.join(dir, 'buried.fluid.json'), JSON.stringify({ ...source, symbols: { lid: ['kkkkk', 'kkkkk', 'kkkkk', 'kkkkk', 'kkkkk'] }, effects: { plume: { ...source.effects.plume, obstacles: [{ symbol: 'lid', x: 6, y: 10 }] } } }));
  const buried = cli('compile', path.join(dir, 'buried.fluid.json'), '--out', path.join(dir, 'buried.json'));
  assert.equal(buried.status, 0, buried.stderr);
  assert.match(JSON.parse(buried.stdout).warnings[0], /emitters\[0\] lies inside obstacles\[0\]/);
  const frames = cli('sequence', path.join(dir, 'puff.fluid.json'), '--out', path.join(dir, 'frames'), '--fps', '25');
  assert.equal(frames.status, 0, frames.stderr);
  assert.equal(JSON.parse(frames.stdout).frames, 8);
  assert.match(cli('help').stdout, /fluid source/);
});

test('MCP pixel_compile builds fluid sources and pixel_help serves their schema', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-fluid-mcp-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = new PassThrough(), output = new PassThrough(), waiting = new Map(); let buffer = '', next = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)?.(message); } });
  startMCP({ input, output, directory: dir, root: dir });
  const request = (method, params) => new Promise(resolve => { waiting.set(++next, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n'); });
  await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  const tools = (await request('tools/list')).result.tools, compile = tools.find(tool => tool.name === 'pixel_compile');
  assert.match(compile.description, /smoke, fire, explosions/);
  assert.ok(tools.find(tool => tool.name === 'pixel_help').inputSchema.properties.topic.enum.includes('fluid'));
  const help = await request('tools/call', { name: 'pixel_help', arguments: { topic: 'fluid' } });
  assert.equal(JSON.parse(help.result.content[0].text).title, 'Pixelbolt fluid effects');
  const source = (await example('torch')).source, compiled = await request('tools/call', { name: 'pixel_compile', arguments: { source, metadata: true } });
  const info = JSON.parse(compiled.result.content[0].text);
  assert.deepEqual([info.ok, info.frames, info.animations, info.metadata.format], [true, 16, ['torch'], 'pixelforge-fluid-metadata']);
  assert.match(info.revision, /^[a-f0-9]{12}$/);
  assert.equal(compiled.result.content[1].type, 'image');
  assert.deepEqual(info.warnings, []);
  const buried = await request('tools/call', { name: 'pixel_compile', arguments: { source: { ...source, effects: { torch: { ...source.effects.torch, emitters: [{ ...source.effects.torch.emitters[0], at: [-40, -40] }] } } } } });
  assert.match(JSON.parse(buried.result.content[0].text).warnings[0], /emitters\[0\] lies outside the canvas/);
  const broken = await request('tools/call', { name: 'pixel_compile', arguments: { source: { ...source, effects: { torch: { ...source.effects.torch, emitters: [{ ...source.effects.torch.emitters[0], rate: 0 }] } } } } });
  assert.equal(broken.result.isError, true);
  assert.equal(JSON.parse(broken.result.content[0].text).path, 'fluid.effects.torch.emitters[0].rate');
  input.end();
});

test('the documented fluid example compiles as written', async () => {
  const guide = await readFile(path.join(root, 'docs/art-workflow.md'), 'utf8'), block = guide.split('## Fluid effects')[1].split('```json')[1].split('```')[0];
  const { recipe, metadata } = compileFluid(JSON.parse(block));
  assert.deepEqual([recipe.frames.length, metadata.effects.torch.loop, renderProject(recipe).warnings], [16, true, []]);
  assert.ok(metadata.effects.torch.pixels.every(count => count > 20));
});

test('the documented live example runs as written', async () => {
  const guide = await readFile(path.join(root, 'docs/art-workflow.md'), 'utf8'), block = guide.split('### Live fluids')[1].split('```js')[1].split('```')[0];
  const body = block.split('\n').filter(line => !line.startsWith('import ')).join('\n');
  const { live, rgba, keys } = new Function('createLiveFluid', 'source', `${body}\nreturn { live, rgba, keys };`)(createLiveFluid, (await example('torch')).source);
  assert.deepEqual([live.frame, rgba.length, keys.length], [17, 16 * 32 * 4, 32]);
  assert.ok(keysCount(keys, key => key !== '.') > 20);
});

test('the package ships the fluid schema and example sources', async () => {
  const files = await packageFiles();
  assert.ok(files.includes('fluid.schema.json'));
  assert.ok(files.includes('src/fluid.js'));
  for (const name of FLUID_SHOWCASE) assert.ok(files.includes(`examples/${name}.fluid.json`), name);
  assert.ok(!files.some(file => file.startsWith('showcase/')));
});

// ---- Live runner ------------------------------------------------------------------------------------------------------
const sameData = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
const keysCount = (keys, test) => keys.reduce((n, row) => n + [...row].filter(test).length, 0);
// A scripted session: pushes, puffs and a boost between steps, hashed frame by frame.
const session = (source, script) => {
  const live = createLiveFluid(source, { warmup: 8 }), hash = createHash('sha256');
  for (let k = 0; k < 24; k++) {
    script(live, k);
    const { rgba, keys } = live.step().render();
    hash.update(keys.join('\n')).update(rgba);
  }
  return hash.digest('hex');
};
// The same source and the same calls must give the same pixels on every machine and engine (these match Chromium,
// Firefox and WebKit as well as Node).
const LIVE_GOLDEN = { torch: '315dd7110cc85103c684d52ff485cf3258a4bbe5f93163ac40ece0eefc5a478b', potion: '41aedcb953cf977211b0cc29cfb551c7975318b6ed1965bf0ba0d9173ba52dfe' };
const scripts = {
  torch: (live, k) => { if (k === 2) live.push({ x: 8, y: 18, vx: 2, vy: -1, radius: 5 }); if (k === 5) live.puff({ x: 6, y: 14, radius: 3, density: 1.5, temperature: 1 }); if (k === 9) live.boost('flame', 2.5, 6); },
  potion: (live, k) => { if (k === 2) live.push({ x: 16, y: 28, vx: 2.5, vy: -1.5, radius: 8 }); if (k === 5) live.puff({ x: 12, y: 18, radius: 3 }); if (k === 9) live.boost('bubbles', 4, 8).boost('heat', 3, 8); }
};

test('a live runner steps the simulation compileFluid bakes, frame for frame', async () => {
  // One-shot effects match from frame 0, sparks and whitewater included.
  for (const name of ['explosion', 'splash', 'slime']) {
    const { source, project } = await example(name), live = createLiveFluid(source, { warmup: 0 });
    assert.deepEqual([live.width, live.height, live.kind, live.frames, live.frame], [source.width, source.height, source.effects[name].kind ?? 'gas', source.effects[name].frames, 0]);
    project.frames.forEach((frame, f) => assert.ok(sameData(live.step().render().rgba, frame.data), `${name} frame ${f}`));
  }
  // A loop without sparks matches once it has warmed up for the compiler's cycles, until the compiler blends its seam
  // (the compiler adds sparks during the recorded cycle only; a live run adds them on every frame).
  const potion = structuredClone((await example('potion')).source);
  for (const emitter of potion.effects.potion.emitters) delete emitter.sparks;
  for (const [name, source] of [['steam-vent', (await example('steam-vent')).source], ['potion', potion]]) {
    const { recipe, metadata } = compileFluid(source), project = renderProject(recipe), { warmup, blend, frames } = metadata.effects[name];
    const live = createLiveFluid(source, { warmup: warmup * frames });
    for (let f = 0; f < frames - blend; f++) assert.ok(sameData(live.step().render().rgba, project.frames[f].data), `${name} frame ${f}`);
    assert.equal(live.frame, (warmup + 1) * frames - blend);
  }
  // Obstacles stamped under and over the fluid, an outline and translucent colours composite as the renderer draws them.
  // A translucent outline lands on a translucent glass bar stamped under the fluid: two translucent colours composite.
  const glass = gas({ frames: 6, outline: 'o', emitters: [{ at: [8, 12], radius: 2.5, rate: 1, density: 2, temperature: 1, sparks: { count: 0.5, life: 4, colors: ['y'] } }], obstacles: [{ symbol: 'bar', x: 11, y: 8, draw: 'under' }, { symbol: 'lid', x: 4, y: 6 }],
    look: [{ field: 'density', colors: ['h', 'w'], thresholds: [0.2, 0.6] }] }, { symbols: { bar: Array(8).fill('hh'), lid: ['kkkkkkkk'] }, palette: { s: '#888', w: '#fff', y: '#fd6', k: '#000', o: '#00f8', h: '#8cf8' } });
  const stamped = renderProject(compileFluid(glass).recipe), runner = createLiveFluid(glass, { warmup: 0 });
  let layered = 0;
  stamped.frames.forEach((frame, f) => {
    const { rgba, keys } = runner.step().render();
    assert.ok(sameData(rgba, frame.data), `glass frame ${f}`);
    assert.equal(keys[6].slice(4, 12), 'kkkkkkkk');
    for (let y = 8; y < 16; y++) {
      assert.match(keys[y].slice(11, 13), /^[ho]h$/);
      // 0x88 over 0x88 composites to an alpha of 199.
      if (keys[y][11] === 'o') { assert.equal(rgba[(y * 16 + 11) * 4 + 3], 199); layered++; }
    }
  });
  assert.ok(layered > 0, 'the outline reaches the glass');
  assert.deepEqual(runner.palette, { s: '#888888', w: '#ffffff', y: '#ffdd66', k: '#000000', o: '#0000ff88', h: '#88ccff88' });
});

test('live runs are deterministic: the same calls give the same pixels everywhere', async () => {
  for (const name of ['torch', 'potion']) {
    const source = (await example(name)).source, first = session(source, scripts[name]);
    assert.equal(session(source, scripts[name]), first, `${name} repeats`);
    assert.equal(first, LIVE_GOLDEN[name], `${name} ran differently; if the change is intended, update LIVE_GOLDEN`);
    // The same calls a frame later make a different session.
    assert.notEqual(session(source, (live, k) => scripts[name](live, k - 1)), first);
  }
});

test('a live push stirs the gas and moves the water from the next step on', () => {
  // A still blob of smoke: pushed right, its middle ends up right of an unpushed twin's.
  const blob = gas({ frames: 64, buoyancy: 0, dissipation: 0, emitters: [{ at: [10, 16], radius: 3, burst: 1, density: 1 }], look: smoke }, { width: 32, height: 32 });
  const middle = keys => { let sum = 0, n = 0; keys.forEach(row => [...row].forEach((char, x) => { if (char !== '.') { sum += x; n++; } })); return sum / n; };
  const still = createLiveFluid(blob, { warmup: 1 }), stirred = createLiveFluid(blob, { warmup: 1 });
  stirred.push({ x: 10, y: 16, vx: 3, radius: 6 });
  assert.deepEqual(stirred.render(), still.render(), 'a push waits for the next step');
  still.step(6); stirred.step(6);
  assert.ok(middle(stirred.render().keys) > middle(still.render().keys) + 1, `${middle(stirred.render().keys)} vs ${middle(still.render().keys)}`);
  // A pool pushed right heaps its water up against the right wall.
  const pool = { ...gas(null), width: 32, height: 24, effects: { pool: { kind: 'liquid', frames: 64, walls: ['left', 'right', 'bottom'], fill: [{ x: 0, y: 18, w: 32, h: 6 }], emitters: [], look: [{ field: 'density', colors: ['s'], thresholds: [0.5], dither: 0 }] } } };
  const tilt = keys => keysCount(keys.map(row => row.slice(16)), char => char === 's') - keysCount(keys.map(row => row.slice(0, 16)), char => char === 's');
  const calm = createLiveFluid(pool, { warmup: 4 }), sloshed = createLiveFluid(pool, { warmup: 4 });
  sloshed.push({ x: 16, y: 21, vx: 4, radius: 10 });
  calm.step(6); sloshed.step(6);
  assert.ok(tilt(sloshed.render().keys) > tilt(calm.render().keys) + 6, `${tilt(sloshed.render().keys)} vs ${tilt(calm.render().keys)}`);
  assert.equal(sloshed.particles, calm.particles);
});

test('a live puff adds or takes away smoke and water, and a boost scales an emitter for a while', () => {
  const air = gas({ frames: 64, buoyancy: 0.2, emitters: [{ name: 'vent', at: [12, 20], radius: 2, rate: 1, density: 0.4, temperature: 0.4, sparks: { count: 0.5, life: 8, colors: ['y'] } }], look: smoke }, { width: 24, height: 24 });
  const corner = keys => keysCount(keys.slice(1, 9).map(row => row.slice(1, 9)), char => char !== '.');
  const runner = createLiveFluid(air, { warmup: 8 });
  assert.equal(corner(runner.render().keys), 0);
  runner.puff({ x: 5, y: 5, radius: 3, density: 2 }).step();
  assert.ok(corner(runner.render().keys) > 10);
  runner.puff({ x: 5, y: 5, radius: 5, density: -16 }).step();
  assert.equal(corner(runner.render().keys), 0);
  // Boosted, the vent holds denser smoke and throws more sparks; at strength 0 it stops.
  const dense = keys => keysCount(keys, char => char === 'w'), smoky = keys => keysCount(keys, char => char !== '.');
  const [plain, boosted, off] = [null, 4, 0].map(strength => { const live = createLiveFluid(air, { warmup: 8 }); if (strength !== null) live.boost('vent', strength, 12); return live.step(10); });
  assert.ok(dense(boosted.render().keys) > dense(plain.render().keys), `${dense(boosted.render().keys)} vs ${dense(plain.render().keys)}`);
  assert.ok(boosted.sparks > plain.sparks, `${boosted.sparks} vs ${plain.sparks}`);
  assert.ok(smoky(off.render().keys) < smoky(plain.render().keys), `${smoky(off.render().keys)} vs ${smoky(plain.render().keys)}`);
  // A liquid puff fills its cells with water, and a negative one drains them.
  const pool = { ...gas(null), width: 24, height: 24, effects: { pool: { kind: 'liquid', frames: 64, walls: ['left', 'right', 'bottom'], fill: [{ x: 0, y: 18, w: 24, h: 6 }], emitters: [], look: [{ field: 'density', colors: ['s'], thresholds: [0.5], dither: 0 }] } } };
  const water = createLiveFluid(pool, { warmup: 2 }), before = water.particles;
  water.puff({ x: 12, y: 6, radius: 3 }).step();
  // A radius-3 puff fills a disc of about 30 cells, four particles each, as a liquid emitter's disc does.
  assert.ok(water.particles >= before + 100, `${water.particles} after ${before}`);
  assert.ok(keysCount(water.render().keys.slice(2, 11), char => char === 's') >= 20, water.render().keys.join('\n'));
  water.puff({ x: 12, y: 21, radius: 4, density: -1 }).step();
  assert.ok(water.particles < before, `${water.particles} after ${before}`);
});

test('live frames use only palette colours, and keys name each pixel\'s colour', async () => {
  for (const name of FLUID_SHOWCASE) {
    const { source } = await example(name), live = createLiveFluid(source, { warmup: 6 }), { width, height } = live, colours = new Map();
    for (const [key, value] of Object.entries(source.palette)) colours.set(key, parseColor(value).join());
    live.push({ x: width / 2, y: height / 2, vx: 1.5, vy: -1, radius: 6 }).step(2).puff({ x: width / 3, y: height / 3, radius: 3 }).step(3);
    const { rgba, keys } = live.render();
    assert.equal(rgba.length, width * height * 4);
    assert.deepEqual(keys.map(row => row.length), Array(height).fill(width));
    keys.forEach((row, y) => [...row].forEach((key, x) => {
      const at = (y * width + x) * 4, pixel = [...rgba.subarray(at, at + 4)].join();
      if (key === '.') assert.equal(rgba[at + 3], 0, `${name} ${x},${y}`);
      else assert.equal(pixel, colours.get(key), `${name} ${x},${y} draws ${key}`);
    }));
    assert.ok(keysCount(keys, key => key !== '.') > 0, name);
  }
});

test('live runs stay inside the limits instead of stopping at them', () => {
  // A canvas flooded by puffs holds at most 32,768 particles.
  const tank = { ...gas(null), width: 128, height: 128, effects: { tank: { kind: 'liquid', frames: 8, substeps: 1, iterations: 1, walls: ['left', 'right', 'bottom'], emitters: [{ at: [2, 2], radius: 1, rate: 1, density: 0 }], look: smoke } } };
  const flood = createLiveFluid(tank, { warmup: 0 });
  for (const [x, y] of [[32, 32], [96, 32], [32, 96], [96, 96], [64, 64]]) flood.puff({ x, y, radius: 64 });
  assert.equal(flood.step().particles, 32768);
  assert.ok(flood.step(2).particles <= 32768);
  // A boosted spark emitter keeps at most 4,096 sparks alive.
  const fountain = gas({ frames: 64, buoyancy: 0, emitters: [{ name: 'fountain', at: [8, 8], radius: 2, rate: 1, sparks: { count: 16, life: 256, colors: ['w'] } }], look: smoke });
  assert.equal(createLiveFluid(fountain, { warmup: 0 }).boost('fountain', 16, 64).step(20).sparks, 4096);
  // Up to 1,024 pushes and puffs wait for the next step; beyond that the oldest are dropped.
  const smoked = queued => { const runner = createLiveFluid(fountain, { warmup: 0 }).puff({ x: 3, y: 3, radius: 2, density: 2 }); for (let k = 0; k < queued; k++) runner.push({ x: 12, y: 12, vx: 0.001 }); return keysCount(runner.step().render().keys.slice(1, 6).map(row => row.slice(1, 6)), char => char !== '.'); };
  assert.ok(smoked(1023) > 0);
  assert.equal(smoked(1024), 0);
});

test('live runners check sources like compileFluid, and their own inputs with paths', async () => {
  // A broken source fails exactly as it fails to compile, including the checks the renderer makes on the recipe.
  const torch = (await example('torch')).source;
  const broken = [
    s => { s.effects.torch.emitters[0].rate = 99; },
    s => { s.effects.torch.wobble = 1; },
    s => { s.name = 'con'; },
    s => { s.symbols.torch[0] = 'Q' + s.symbols.torch[0].slice(1); },
    s => { s.palette = { $ref: 'palette.json' }; },
    s => { s.effects.torch.frames = 200; s.effects.extra = { ...s.effects.torch }; },
    s => { s.width = 128; s.height = 128; Object.assign(s.effects.torch, { frames: 256, warmup: 8, substeps: 4, iterations: 200 }); s.effects.torch.emitters.forEach(e => { delete e.pulse; delete e.orbit; }); }
  ];
  for (const breakIt of broken) {
    const source = structuredClone(torch);
    breakIt(source);
    let expected = null;
    try { compileFluid(source); } catch (error) { expected = error; }
    assert.ok(expected instanceof PixelError, String(breakIt));
    assert.throws(() => createLiveFluid(source), error => error instanceof PixelError && error.path === expected.path && error.message === expected.message, String(breakIt));
  }
  const fails = (run, where, message) => assert.throws(run, error => error instanceof PixelError && error.path === where && (!message || message.test(error.message)), where);
  fails(() => createLiveFluid(torch, { effect: 'smoke' }), 'live.effect', /no effect named "smoke"; the source has torch/);
  fails(() => createLiveFluid(torch, { speed: 2 }), 'live.speed', /unknown/);
  fails(() => createLiveFluid(torch, { warmup: -1 }), 'live.warmup', /0 to 2048/);
  fails(() => createLiveFluid({ ...gas({ frames: 4, iterations: 200, substeps: 4, emitters: [{ at: [8, 8], rate: 1, density: 1 }], look: smoke }), width: 128, height: 128 }, { warmup: 2048 }), 'live.warmup', /million cell updates/);
  const live = createLiveFluid(torch, { warmup: 0 }), pool = createLiveFluid((await example('potion')).source, { warmup: 0 });
  fails(() => live.push({ y: 3 }), 'push.x', /expected a number/);
  fails(() => live.push({ x: 1, y: 1, vx: NaN }), 'push.vx', /expected a number/);
  fails(() => live.push({ x: 1, y: 1, vy: '2' }), 'push.vy', /expected a number/);
  // Values out of range, as a fast flick sends them, are clamped rather than refused: each call beyond a bound draws the
  // same frame as the call at the bound, which itself changes the frame.
  const after = (source, call) => { const runner = createLiveFluid(source, { warmup: 2 }); call(runner); return runner.step(2).render(); };
  const potion = (await example('potion')).source, plume = gas({ frames: 64, buoyancy: 0.2, emitters: [{ at: [8, 13], radius: 2, rate: 1, density: 0.6, temperature: 0.4 }], look: smoke });
  const untouched = new Map([torch, potion, plume].map(source => [source, after(source, () => {})]));
  const clamps = (what, source, beyond, bound) => {
    const clamped = after(source, beyond);
    assert.deepEqual(clamped, after(source, bound), `${what} is clamped`);
    assert.notDeepEqual(clamped, untouched.get(source), `${what} changes the frame`);
  };
  clamps('push vx and radius', torch, live => live.push({ x: 8, y: 20, vx: 99, radius: 99 }), live => live.push({ x: 8, y: 20, vx: 16, radius: 64 }));
  clamps('push vy', torch, live => live.push({ x: 8, y: 20, vy: 99 }), live => live.push({ x: 8, y: 20, vy: 16 }));
  clamps('negative push', torch, live => live.push({ x: 8, y: 20, vx: -99, vy: -99 }), live => live.push({ x: 8, y: 20, vx: -16, vy: -16 }));
  clamps('gas puff density', plume, live => live.puff({ x: 8, y: 5, radius: 3, density: 99 }), live => live.puff({ x: 8, y: 5, radius: 3, density: 16 }));
  clamps('gas puff temperature', torch, live => live.puff({ x: 8, y: 10, radius: 3, temperature: 99 }), live => live.puff({ x: 8, y: 10, radius: 3, temperature: 16 }));
  // Four puffs stack smoke denser than 16, so taking 99 away clears what taking 16 away leaves.
  const stacked = take => live => [16, 16, 16, 16, take].forEach(density => live.puff({ x: 8, y: 5, radius: 3, density }));
  clamps('negative gas puff', plume, stacked(-99), stacked(-16));
  clamps('negative temperature', torch, live => live.puff({ x: 8, y: 24, radius: 4, temperature: -99 }), live => live.puff({ x: 8, y: 24, radius: 4, temperature: -16 }));
  clamps('puff radius', plume, live => live.puff({ x: 8.5, y: 4.5, radius: 0, density: 16 }), live => live.puff({ x: 8.5, y: 4.5, radius: 0.5, density: 16 }));
  clamps('liquid puff', potion, live => live.puff({ x: 16, y: 10, radius: 3, density: 2 }), live => live.puff({ x: 16, y: 10, radius: 3, density: 1 }));
  clamps('liquid drain', potion, live => live.puff({ x: 16, y: 30, radius: 4, density: -5 }), live => live.puff({ x: 16, y: 30, radius: 4, density: -1 }));
  // A push far off the canvas stays off it and changes nothing.
  assert.deepEqual(after(torch, live => live.push({ x: -9999, y: 9999, vx: 2 })), untouched.get(torch));
  fails(() => live.push({ x: 1, y: 1, spin: 2 }), 'push.spin', /unknown/);
  fails(() => live.push(null), 'push', /object/);
  fails(() => pool.puff({ x: 1, y: 1, temperature: 1 }), 'puff.temperature', /gases/);
  fails(() => live.boost('fire', 2, 4), 'boost.name', /no emitter named "fire"; this effect's emitters are named flame, embers/);
  const unnamed = createLiveFluid((await example('smoke-puff')).source, { warmup: 0 });
  fails(() => unnamed.boost('puff', 2, 4), 'boost.name', /give the emitter a name/);
  fails(() => live.boost('flame', 99, 4), 'boost.strength', /0 to 16/);
  fails(() => live.boost('flame', 2, -1), 'boost.frames', /0 to 65536/);
  fails(() => live.step(-1), 'step', /0 to 2048/);
  fails(() => live.step(1.5), 'step', /integer/);
});

test('a live runner steps a hero-sized steam plume in milliseconds', t => {
  // 128 × 60, the size of the portfolio hero's steam: a breathing source, wind and a draining band near the top.
  const steam = { ...gas(null), width: 128, height: 60, effects: { steam: { frames: 48, loop: true, buoyancy: 0.2, vorticity: 0.35, dissipation: 0.04, cooling: 0, drag: 0.09, wind: [-0.035, 0],
    emitters: [{ name: 'breath', at: [86, 54], radius: 2, rate: 1, density: 0.6, temperature: 0.5, velocity: [0, -1.1], noise: 0.15, flicker: 0.2, pulse: { amplitude: 0.6, period: 16 } }, { at: [64, 0], area: [128, 12], rate: 1, density: -0.3 }],
    look: [{ field: 'density', colors: ['s', 'w'], thresholds: [0.16, 0.5] }, { field: 'shadow', colors: ['k'], thresholds: [0.5], dither: 0 }], cleanup: { strays: true, corners: true } } } };
  const live = createLiveFluid(steam, { warmup: 24 }), frames = 48, timed = [0, 0];
  for (let k = 0; k < frames; k++) {
    if (k % 8 === 0) live.push({ x: 60 + k, y: 30, vx: 1.5, vy: -0.5, radius: 6 });
    let started = performance.now();
    live.step();
    timed[0] += performance.now() - started;
    started = performance.now();
    live.render();
    timed[1] += performance.now() - started;
  }
  const [step, render] = timed.map(ms => ms / frames);
  t.diagnostic(`128 × 60 steam: ${step.toFixed(2)} ms a step, ${render.toFixed(2)} ms a render, ${Math.round(1000 / (step + render))} frames per second`);
  assert.ok(step + render < 250, `${step + render} ms a frame`);
});
