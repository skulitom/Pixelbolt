import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, PixelError } from '../src/core.js';
import { compileCrystals, CRYSTAL_HABITS } from '../src/crystal.js';
import { random } from '../src/craft.js';
import { startMCP } from '../src/mcp.js';
import { packageFiles } from '../scripts/build-studio.mjs';
import { crystalPresets } from '../scripts/crystal-presets.mjs';
import { CRYSTAL_SHOWCASE, buildCrystalGIFs } from '../showcase/crystals/build.mjs';
import { goldens } from '../scripts/goldens.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// The compiled recipe of every preset, in test/goldens/crystal.json. They change with any change to what the compiler
// draws: node scripts/goldens.mjs crystal draws them before and after, and --write updates them.
const golden = goldens(new URL('./goldens/crystal.json', import.meta.url));
const palette = { k: '#101018', a: '#40306a', b: '#7050b0', c: '#a080e0', d: '#e0d0ff', w: '#ffffff' };
const looks = { gem: { colors: ['a', 'b', 'c', 'd'], outline: 'k', glint: 'w' } };
const source = (crystals, effect = {}, extra = {}) => ({ format: 'pixelforge-crystal', version: 1, name: 'probe', width: 48, height: 40, palette, looks: structuredClone(looks), ...extra, effects: { e: { frames: 40, crystals, ...effect } } });
// The crystal layer of each frame, as rows of palette keys.
const grids = compiled => compiled.recipe.frames.map(frame => frame.layers.find(layer => layer.name === 'crystals').ops[0].rows);
const refused = (s, where, pattern) => assert.throws(() => compileCrystals(s), error => error instanceof PixelError && error.path === where && pattern.test(error.message), `${where} ${pattern}`);
const drawn = rows => { const set = new Set(); rows.forEach((row, y) => [...row].forEach((key, x) => { if (key !== '.') set.add(`${x},${y}`); })); return set; };

test('crystal sources are read strictly, with paths and the fix in each message', () => {
  const prism = { habit: 'prism', at: [24, 36], length: 20, width: 6 };
  refused({ ...source([prism]), version: 2 }, 'crystal', /version-1/);
  refused(source([{ ...prism, habit: 'needle' }]), 'crystal.effects.e.crystals[0].habit', /prism, cube, octahedron, snowflake/);
  refused(source([{ ...prism, size: 4 }]), 'crystal.effects.e.crystals[0].size', /unknown/);
  refused(source([{ habit: 'snowflake', at: [24, 20], radius: 10, angle: 30 }]), 'crystal.effects.e.crystals[0].angle', /snowflake lies flat/);
  refused(source([{ habit: 'snowflake', at: [24, 20], radius: 10, count: 2 }]), 'crystal.effects.e.crystals[0].count', /own entry/);
  refused(source([{ ...prism, angle: -90, toward: [0, 0] }]), 'crystal.effects.e.crystals[0].toward', /not both/);
  refused(source([{ ...prism, look: 'ice' }]), 'crystal.effects.e.crystals[0].look', /no look is named "ice"; the looks are gem/);
  refused(source([prism], {}, { looks: { gem: looks.gem, ice: looks.gem } }), 'crystal.effects.e.crystals[0].look', /name the look/);
  refused(source([{ ...prism, length: [20, 10] }]), 'crystal.effects.e.crystals[0].length[1]', /high at or above low/);
  refused(source([{ ...prism, start: 40 }]), 'crystal.effects.e.crystals[0].start', /0 to 39/);
  refused(source([{ ...prism, ease: 'hold' }]), 'crystal.effects.e.crystals[0].ease', /inOut/);
  refused(source([{ ...prism, at: [[1, 1]] }]), 'crystal.effects.e.crystals[0].at', /2–16 points/);
  refused(source([prism], { light: [0, 0] }), 'crystal.effects.e.light', /toward the light/);
  // A light too short to divide by (its square rounds to 0) is refused too; a short one that divides points as a long one.
  refused(source([prism], { light: [1e-200, 0] }), 'crystal.effects.e.light', /toward the light.*at least 0\.001 long/);
  assert.equal(sha(compileCrystals(source([prism], { light: [0.0625, 0] })).recipe), sha(compileCrystals(source([prism], { light: [1, 0] })).recipe));
  refused(source([prism], {}, { looks: { gem: { colors: ['a'] } } }), 'crystal.looks.gem.colors', /2–6 palette keys/);
  refused(source([prism], {}, { looks: { gem: { colors: ['a', 'z'] } } }), 'crystal.looks.gem.colors[1]', /palette/);
  refused(source([prism], { underlay: ['a'] }), 'crystal.effects.e.underlay', /full-canvas/);
  refused(source([{ ...prism, count: 64, at: [[0, 36], [47, 36]] }, { ...prism, count: 64 }, { ...prism, count: 64 }, { ...prism, count: 64 }, prism]), 'crystal.effects.e.crystals', /257 crystals; at most 256/);
  // Work is estimated before any is spent.
  refused(source(Array.from({ length: 32 }, () => ({ habit: 'prism', at: [[0, 36], [47, 36]], count: 8, length: 256, width: 64, grow: 39 }))), 'crystal.effects.e.crystals', /million pixel tests/);
  const late = compileCrystals(source([{ ...prism, start: 30, grow: 20 }, { ...prism, at: [80, 10] }]));
  assert.match(late.warnings.join('\n'), /still growing on the last frame/);
  assert.match(late.warnings.join('\n'), /crystal 2 \(prism\) grows from \[80, 10\], outside the canvas/);
});

test('the work estimate counts every frame each crystal is drawn in, grown or not, and nothing off the canvas', () => {
  const big = effects => ({ ...source([]), width: 256, height: 256, effects });
  const field = (at, grow = 5) => Array.from({ length: 4 }, () => ({ habit: 'cube', at, count: 64, size: 122, grow }));
  // 256 big cubes painted over 5 frames: about 190 million pixel tests, under the limit. Held on the canvas for the
  // rest of 64 frames, drawing their cells and outlines adds about 15 million more, so the field is refused at once.
  refused(big({ e: { frames: 64, crystals: field([[0, 200], [255, 200]]) } }), 'crystal.effects.e.crystals', /about 205 million pixel tests, more than 200 million/);
  // The same field seeded far above the canvas draws nothing, so it is accepted.
  const away = compileCrystals(big({ e: { frames: 64, crystals: field([[0, -1000], [255, -1000]]) } }));
  assert.ok(grids(away).every(rows => rows.every(row => /^\.+$/.test(row))));
  assert.equal(away.warnings.length, 256);
  // Painting crystals wholly off one side of the canvas counts nothing, never less than nothing, so it leaves the next
  // effect's allowance as it was.
  refused(big({ off: { frames: 32, crystals: field([[-1000, 0], [-1000, 255]]) }, heavy: { frames: 32, crystals: field([[0, 200], [255, 200]], 6) } }), 'crystal.effects.heavy.crystals', /million pixel tests/);
});

test('a prism seeds as one bright pixel, grows only outward, glints once grown and then holds still', () => {
  const compiled = compileCrystals(source([{ habit: 'prism', at: [24, 36], length: 24, width: 7, start: 2, grow: 20 }]));
  const frames = grids(compiled);
  assert.ok(frames.slice(0, 2).every(rows => rows.every(row => /^\.+$/.test(row))), 'nothing before the start');
  // The seed: one glint pixel at the seed, no outline.
  assert.deepEqual([...drawn(frames[2])], ['24,36']);
  assert.equal(frames[2][36][24], 'w');
  // Then a nub a few pixels long, outlined, and growth only adds pixels: each frame covers everything the one before did.
  assert.ok(drawn(frames[3]).size >= 6 && drawn(frames[3]).size <= 24, `the nub draws ${drawn(frames[3]).size} pixels`);
  for (let f = 4; f <= 22; f++) for (const pixel of drawn(frames[f - 1])) assert.ok(drawn(frames[f]).has(pixel), `frame ${f} lost ${pixel}`);
  // Grown at frame 22, grow frames after it seeded; frames 23–28 carry the glint (four up the ridge, then a star that
  // shrinks), then it holds still.
  const glints = frames.map(rows => rows.join('').split('w').length - 1);
  assert.deepEqual(glints.slice(22, 30), [0, 1, 1, 1, 1, 9, 5, 0]);
  for (let f = 29; f < 40; f++) assert.deepEqual(frames[f], frames[22], `frame ${f} differs from the grown crystal`);
  assert.equal(compiled.metadata.effects.e.grown, 22);
  assert.equal(compiled.metadata.effects.e.settled, 29);
  assert.deepEqual(compiled.warnings, []);
  // The glint climbs to the tip, where the star shines.
  const spark = f => { const y = frames[f].findIndex(row => row.includes('w')); return [frames[f][y].indexOf('w'), y]; };
  for (let f = 24; f <= 26; f++) assert.ok(spark(f)[1] <= spark(f - 1)[1], `the spark climbs at frame ${f}`);
  assert.deepEqual(spark(27), [24, 12 - 2], 'the star stands on the tip, 24 pixels above the seed');
  // Upright and lit from the upper left: its left face is brighter than its front, and its front than its right.
  const middle = frames[39][24], body = [...middle].map((key, x) => [x, key]).filter(([, key]) => key !== '.' && key !== 'k');
  assert.deepEqual(body.map(([, key]) => key).join(''), 'ddcccaa');
});

// What the last frame cuts off is read from each crystal's timeline (its start and grow, then its glint), never from
// comparing pictures: slow growth can draw one picture twice, and a glint changes the picture after growth has ended.
const ice = { colors: ['a', 'b', 'c'], outline: 'k', glint: 'w' };
const timed = (crystals, frames, look = ice, seed = 0) => {
  const compiled = compileCrystals(source(crystals, { frames, seed }, { height: 48, looks: { ice: look } }));
  const { grown, settled, visiblePixels } = compiled.metadata.effects.e;
  return { warnings: compiled.warnings, frames: grids(compiled), grown, settled, shown: visiblePixels.at(-1) };
};
const spike = { habit: 'prism', at: [24, 40], angle: 270, length: 24, width: 8, start: 0 };
const growing = (who, slowest, grown, fix) => `crystal.effects.e: ${who} still growing on the last frame (${slowest} would be full grown on frame ${grown}); ${fix}.`;
const glinting = (whose, frames) => `crystal.effects.e: ${whose === 'its glint' ? 'the crystal' : 'every crystal'} is full grown, but the effect ends before ${whose} has played out; use at least ${frames} frames so the last glint goes out, or lower start or grow.`;

test('a compile warns whenever the last frame cuts growth off, with the frames that finish it', () => {
  // A spike that takes 40 frames to grow and 7 more to glint: 245 pixels, at rest from frame 47.
  const whole = timed([{ ...spike, grow: 40 }], 48);
  assert.deepEqual([whole.warnings, whole.grown, whole.settled, whole.shown], [[], 40, 47, 245]);
  // Cut off anywhere before, it warns. At 3–8, 10, 11, 13, 29, 31 and 33–40 frames the last two frames draw the same
  // picture, which once passed for rest.
  const same = [];
  for (let frames = 2; frames <= 40; frames++) {
    const cut = timed([{ ...spike, grow: 40 }], frames);
    assert.ok(cut.shown < 245, `${frames} frames end on ${cut.shown} pixels`);
    assert.deepEqual(cut.warnings, [growing('the crystal is', 'it', 40, 'use at least 48 frames (41 for the growth, the rest for the glint after it), or lower start or grow')], `${frames} frames`);
    assert.equal(cut.grown, 40);
    if (frames > 2 && cut.settled < frames - 1) same.push(frames);
  }
  assert.deepEqual(same, [3, 4, 5, 6, 7, 8, 10, 11, 13, 29, 31, 33, 34, 35, 36, 37, 38, 39, 40]);
  // Growth longer than an effect can be (256 frames) says to shorten it; a cube and a snowflake are timed as a prism.
  const tooSlow = frames => growing('the crystal is', 'it', 256, `lower start or grow: finishing takes ${frames} frames, and an effect has at most 256`);
  const slow = timed([{ ...spike, grow: 256 }], 12);
  assert.deepEqual([slow.warnings, slow.grown, slow.settled], [[tooSlow(264)], 256, 1]);
  assert.deepEqual(timed([{ habit: 'cube', at: [24, 24], size: 6, grow: 256 }], 10).warnings, [tooSlow(264)]);
  // A snowflake's newest pixels shine for the frame they grow in, so it rests a frame after it is grown.
  const flake = { habit: 'snowflake', at: [24, 24], radius: 8 };
  assert.deepEqual(timed([{ ...flake, grow: 256 }], 10).warnings, [tooSlow(258)]);
  for (let frames = 2; frames <= 24; frames++) assert.deepEqual(timed([{ ...flake, grow: 24 }], frames).warnings, [growing('the crystal is', 'it', 24, 'use at least 26 frames (25 for the growth, the rest for the glint after it), or lower start or grow')], `${frames} frames`);
  assert.deepEqual(timed([{ ...flake, grow: 24 }], 25).warnings, [glinting('its glint', 26)]);
  assert.deepEqual(timed([{ ...flake, grow: 24 }], 26).warnings, []);
  // A flake's growth is followed to its end past the effect's, and what the effect draws is the same either way.
  assert.deepEqual(timed([{ ...flake, grow: 24 }], 12).frames, timed([{ ...flake, grow: 24 }], 26).frames.slice(0, 12));
  // Without a glint in the look, the frame a crystal is full grown is the frame it rests.
  const plain = { colors: ['a', 'b', 'c'] };
  assert.deepEqual(timed([{ ...flake, grow: 24 }], 24, plain).warnings, [growing('the crystal is', 'it', 24, 'use at least 25 frames, or lower start or grow')]);
  assert.deepEqual(timed([{ ...flake, grow: 24 }], 25, plain).warnings, []);
});

test('a glint the last frame cuts off is called a glint, not growth, and a crystal that rests on the last frame is left alone', () => {
  // Grown at frame 6, glinting on frames 7–12, at rest from frame 13. An effect that ends on frames 6–12 shows no
  // glint, or holds one part-way.
  const quick = { ...spike, grow: 6, ease: 'linear' };
  for (let frames = 7; frames <= 13; frames++) {
    const cut = timed([quick], frames);
    assert.deepEqual(cut.warnings, [glinting('its glint', 14)], `${frames} frames`);
    assert.equal(cut.grown, 6);
    assert.equal(cut.frames.at(-1).join('').includes('w'), frames > 7, `a glint on the last of ${frames} frames`);
  }
  // In 14 frames the last one is the first at rest: nothing is cut off, though the picture changed on it (the star
  // went out).
  const rested = timed([quick], 14);
  assert.deepEqual([rested.warnings, rested.grown, rested.settled], [[], 6, 13]);
  assert.deepEqual(rested.frames[13], rested.frames[6]);
  assert.deepEqual(timed([quick], 6).warnings, [growing('the crystal is', 'it', 6, 'use at least 14 frames (7 for the growth, the rest for the glint after it), or lower start or grow')]);
  // A look without a glint has none to cut off: full grown on the last frame is at rest.
  const plain = { colors: ['a', 'b', 'c'], outline: 'k' };
  for (let frames = 7; frames <= 14; frames++) assert.deepEqual(timed([quick], frames, plain).warnings, [], `${frames} frames, no glint`);
  assert.deepEqual(timed([quick], 6, plain).warnings, [growing('the crystal is', 'it', 6, 'use at least 7 frames, or lower start or grow')]);
  // Nor has a crystal with no ridge for one to run up: a cube seen square on shows one face.
  const square = { habit: 'cube', at: [24, 30], size: 10, tilt: 0, turn: 0, grow: 6 };
  const flat = timed([square], 16);
  assert.ok(flat.frames.slice(1).every(rows => !rows.join('').includes('w')), 'a cube seen square on never glints');
  assert.deepEqual([flat.grown, flat.settled], [6, 6]);
  for (let frames = 7; frames <= 14; frames++) assert.deepEqual(timed([square], frames).warnings, [], `${frames} frames, no ridge`);
});

test('each crystal of a cluster is timed by its own seeded start and grow', () => {
  const cluster = { habit: 'prism', at: [[6, 36], [42, 36]], count: 5, angle: [-150, -30], length: [8, 16], width: 4, start: [0, 10], grow: [10, 14] };
  // The members' draws, as the compiler makes them: full grown on frames 10, 17, 23, 14 and 17, each glinting for six
  // frames after.
  const grown = Array.from({ length: 5 }, (_, i) => Math.floor(random(0, 0, i, 2) * 11) + 10 + Math.floor(random(0, 0, i, 3) * 5));
  assert.deepEqual(grown, [10, 17, 23, 14, 17]);
  const fix = 'use at least 31 frames (24 for the growth, the rest for the glint after it), or lower start or grow';
  const expected = frames => {
    const late = grown.filter(g => g > frames - 1).length, lit = grown.filter(g => g + 7 > frames - 1).length;
    if (late) return [growing(late === 5 ? 'all 5 crystals are' : `${late} of 5 crystals ${late === 1 ? 'is' : 'are'}`, 'the slowest, in crystals[0],', 23, fix)];
    return lit ? [glinting(`the glint of ${lit} of 5`, 31)] : [];
  };
  for (let frames = 11; frames <= 34; frames++) assert.deepEqual(timed([cluster], frames).warnings, expected(frames), `${frames} frames`);
  assert.deepEqual(expected(11), [growing('4 of 5 crystals are', 'the slowest, in crystals[0],', 23, fix)]);
  assert.deepEqual(expected(23), [growing('1 of 5 crystals is', 'the slowest, in crystals[0],', 23, fix)]);
  assert.deepEqual(expected(24), [glinting('the glint of 3 of 5', 31)]);
  assert.deepEqual(expected(31), []);
  assert.match(timed([{ ...cluster, start: [1, 10] }], 11).warnings.join('\n'), /^crystal\.effects\.e: all 5 crystals are still growing on the last frame \(the slowest, in crystals\[0\], would be full grown on frame \d+\)/);
  // A late crystal among finished ones is named by its entry. In 32 frames its last two frames draw the same picture.
  const late = { habit: 'prism', at: [24, 36], length: 20, width: 6, start: 20, grow: 12 };
  const mixed = timed([cluster, late], 32);
  assert.deepEqual(mixed.warnings, [growing('1 of 6 crystals is', 'the slowest, in crystals[1],', 32, 'use at least 40 frames (33 for the growth, the rest for the glint after it), or lower start or grow')]);
  assert.deepEqual([mixed.grown, mixed.settled], [32, 30]);
  assert.deepEqual(timed([cluster, late], 39).warnings, [glinting('the glint of 1 of 6', 40)]);
  assert.deepEqual(timed([cluster, late], 40).warnings, []);
});

test('mirroring the light mirrors an upright crystal exactly', () => {
  for (const crystal of [{ habit: 'prism', at: [24, 36], length: 26, width: 9, tip: 0.8 }, { habit: 'octahedron', at: [24, 36], size: 16, turn: 0 }, { habit: 'prism', at: [24, 36], length: 18, width: 7, tip: 0, tilt: 30 }]) {
    const left = grids(compileCrystals(source([crystal], { light: [-1, -1] }))).at(-1), right = grids(compileCrystals(source([crystal], { light: [1, -1] }))).at(-1);
    assert.deepEqual(right.map(row => '.' + [...row].reverse().join('').slice(0, -1)), left, crystal.habit);
  }
});

test('faceted habits show their faces: a cube a lit top and two sides, clusters spread along their line in a fan', () => {
  const cube = grids(compileCrystals(source([{ habit: 'cube', at: [24, 30], size: 14, grow: 10 }]))).at(-1);
  const keys = new Set(cube.join('').replace(/[.k]/g, ''));
  assert.deepEqual([...keys].sort(), ['a', 'c', 'd'], 'a lit top (d), a lit side (c) and a shaded side (a)');
  // The top face's edges are clean 2:1 stairs: each run of top pixels in a row is two longer than the row above.
  const top = cube.map(row => (row.match(/d+/) ?? [''])[0].length).filter(n => n);
  assert.ok(top.slice(1, 4).every((n, i) => n - top[i] === 4), `top rows ${top}`);
  // A cluster: count seeds spread along the line, angles fanned from the first end to the last, longest drawn first.
  const s = source([{ habit: 'prism', at: [[6, 36], [42, 36]], count: 5, angle: [-150, -30], length: [8, 16], width: 4, start: [0, 10], grow: [10, 14] }]);
  const a = compileCrystals(s), b = compileCrystals(s);
  assert.equal(sha(a.recipe), sha(b.recipe), 'the same seed draws the same cluster');
  s.effects.e.seed = 7;
  assert.notEqual(sha(compileCrystals(s).recipe), sha(a.recipe), 'another seed draws another cluster');
});

test('a snowflake grows six matching arms with branches that never touch, mirrored across both axes', () => {
  for (const flake of [{ radius: 20, spacing: 4, branches: 1, twigs: 0.6 }, { radius: 14, spacing: 3, branches: 0.6, plate: 4 }, { radius: 12, spacing: 5, branches: 0.8, arms: 'horizontal' }]) {
    const compiled = compileCrystals(source([{ habit: 'snowflake', at: [24, 22], grow: 30, ...flake }], { frames: 36 }, { width: 49, height: 45, looks: { ice: { colors: ['a', 'b', 'c'], glint: 'w' } } }));
    const frames = grids(compiled), last = frames.at(-1);
    // Symmetric across the vertical and the horizontal line through the centre.
    for (let y = 0; y < 45; y++) for (let x = 0; x < 49; x++) {
      assert.equal(last[y][x], last[y][48 - x], `left-right at ${x},${y}`);
      assert.equal(last[y][x], last[44 - y][x], `up-down at ${x},${y}`);
    }
    // The arms reach the radius: two straight ones, and four two-to-one ones.
    const [ax, ay] = flake.arms === 'horizontal' ? [1, 0] : [0, 1];
    assert.notEqual(last[22 + ay * flake.radius][24 + ax * flake.radius], '.');
    assert.equal(last[22 + ay * (flake.radius + 1)][24 + ax * (flake.radius + 1)], '.');
    // Thin lines: without a plate, no 2×2 square of ice anywhere (branches stop a pixel short of each other).
    if (!flake.plate) for (let y = 0; y < 44; y++) for (let x = 0; x < 48; x++) assert.ok([last[y][x], last[y][x + 1], last[y + 1][x], last[y + 1][x + 1]].includes('.'), `a square at ${x},${y}`);
    // It grows only outward and comes to rest.
    for (let f = 1; f < frames.length; f++) for (const pixel of drawn(frames[f - 1])) assert.ok(drawn(frames[f]).has(pixel), `frame ${f} lost ${pixel}`);
    assert.ok(compiled.metadata.effects.e.settled <= 31, `settled at ${compiled.metadata.effects.e.settled}`);
  }
});

golden.test('every crystal example compiles to its golden recipe, draws only palette keys and comes to rest', async () => {
  for (const name of CRYSTAL_SHOWCASE) {
    const example = JSON.parse(await readFile(path.join(root, 'examples', `${name}.crystal.json`), 'utf8'));
    assert.deepEqual(example, JSON.parse(JSON.stringify(crystalPresets[name])), `examples/${name}.crystal.json is stale; run node scripts/generate-examples.js`);
    const { recipe, metadata, warnings } = compileCrystals(example);
    golden.equal(name, sha(recipe), { recipe, note: 'Rebuild the GIFs too: node showcase/crystals/build.mjs --force.' });
    assert.deepEqual(warnings, [], name);
    const keys = new Set(Object.keys(example.palette));
    for (const frame of recipe.frames) for (const layer of frame.layers) for (const row of layer.ops[0].rows) for (const key of row) assert.ok(key === '.' || keys.has(key), `${name} draws ${key}`);
    // A clear rest at the end: at least six still frames.
    const [effect] = Object.values(metadata.effects);
    assert.ok(effect.settled <= effect.frames - 7, `${name} settles at ${effect.settled} of ${effect.frames}`);
    // Its last crystal is full grown before that, and the frames between are its glint.
    assert.ok(effect.grown < effect.settled && effect.settled <= effect.grown + 7, `${name} is grown at ${effect.grown} and settles at ${effect.settled}`);
    renderProject(recipe);
  }
  assert.deepEqual(Object.keys(crystalPresets).sort(), [...CRYSTAL_SHOWCASE].sort());
  const { files } = await buildCrystalGIFs();
  for (const [file, bytes] of files) assert.ok(bytes.equals(await readFile(path.join(root, file))), `${file} is stale; run node showcase/crystals/build.mjs --force`);
});

test('the crystal schema lists exactly the fields the compiler reads, and the package ships it', async () => {
  const schema = JSON.parse(await readFile(path.join(root, 'crystal.schema.json'), 'utf8')), effect = schema.properties.effects.additionalProperties;
  const habits = effect.properties.crystals.items.oneOf;
  assert.deepEqual(habits.flatMap(h => h.properties.habit.const ?? h.properties.habit.enum), CRYSTAL_HABITS);
  const unknown = (s, where) => { try { compileCrystals(s); return false; } catch (error) { return error.path === where && /unknown or null field/.test(error.message); } };
  const entries = { prism: { habit: 'prism', at: [24, 36], length: 10, width: 4 }, cube: { habit: 'cube', at: [24, 36], size: 6 }, snowflake: { habit: 'snowflake', at: [24, 20], radius: 6 } };
  const values = { look: 'gem', at: [24, 30], angle: -90, toward: [24, 0], habit: undefined, ease: 'in', arms: 'vertical', double: true, count: 1 };
  const levels = [
    [schema.properties, (s, key) => { s[key] = s[key] ?? 0; }, 'crystal', () => source([entries.prism])],
    [effect.properties, (s, key) => { s.effects.e[key] = s.effects.e[key] ?? 0; }, 'crystal.effects.e', () => source([entries.prism])],
    [schema.properties.looks.additionalProperties.properties, (s, key) => { s.looks.gem[key] = s.looks.gem[key] ?? 'k'; }, 'crystal.looks.gem', () => source([entries.prism])],
    ...habits.map((h, i) => [h.properties, (s, key) => {
      const crystal = s.effects.e.crystals[0];
      if (key === 'toward') delete crystal.angle;
      crystal[key] = crystal[key] ?? (key in values ? values[key] : 1);
    }, 'crystal.effects.e.crystals[0]', () => source([structuredClone(Object.values(entries)[i])])])
  ];
  for (const [properties, set, where, base] of levels) {
    for (const key of Object.keys(properties)) { const s = base(); set(s, key); assert.ok(!unknown(s, `${where}.${key}`), `${where}.${key} is in the schema but the compiler refuses it`); }
    const s = base(); set(s, 'notAField'); assert.ok(unknown(s, `${where}.notAField`), `${where} accepts a field the schema doesn't list`);
  }
  const files = await packageFiles();
  assert.ok(files.includes('crystal.schema.json') && files.includes('src/crystal.js'));
  for (const name of CRYSTAL_SHOWCASE) assert.ok(files.includes(`examples/${name}.crystal.json`), name);
});

test('the guide\'s crystal example compiles and comes to rest', async () => {
  const guide = await readFile(path.join(root, 'docs/art-workflow.md'), 'utf8'), section = guide.slice(guide.indexOf('## Crystal growth'));
  const example = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(section)[1]);
  const { metadata, warnings } = compileCrystals(example);
  assert.deepEqual(warnings, []);
  assert.ok(metadata.effects.grow.settled < 39);
});

test('MCP and the CLI compile crystal sources and presets', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-crystal-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const input = new PassThrough(), output = new PassThrough(), waiting = new Map();
  let buffer = '', id = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)?.(message); } });
  startMCP({ input, output, root: dir, directory: dir }); t.after(() => input.end());
  const call = (method, params) => new Promise(resolve => { waiting.set(++id, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'crystal-test', version: '1' } });
  const help = await call('tools/call', { name: 'pixel_help', arguments: { topic: 'crystal', name: 'all' } });
  assert.equal(JSON.parse(help.result.content[0].text).title, 'Pixelbolt crystal growth');
  const s = source([{ habit: 'prism', at: [24, 36], length: 20, width: 6, grow: 20 }], { frames: 30 });
  const compiled = JSON.parse((await call('tools/call', { name: 'pixel_compile', arguments: { source: s, metadata: true } })).result.content[0].text);
  assert.deepEqual([compiled.ok, compiled.frames, compiled.metadata.format], [true, 30, 'pixelforge-crystal-metadata']);
  const preset = JSON.parse((await call('tools/call', { name: 'pixel_compile', arguments: { preset: 'geode' } })).result.content[0].text);
  assert.equal(preset.ok, true);
  const file = path.join(dir, 'point.crystal.json'), out = path.join(dir, 'point.json');
  await writeFile(file, JSON.stringify(s));
  const cli = spawnSync(process.execPath, [path.join(root, 'bin/pixelbolt.js'), 'compile', file, '--out', out], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(JSON.parse(await readFile(out, 'utf8')).frames.length, 30);
  const listed = spawnSync(process.execPath, [path.join(root, 'bin/pixelbolt.js'), 'presets', 'snowflakes'], { encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /pixelforge-crystal/);
  // --out saves the source alone, ready to edit and compile; an earlier file is kept, and it goes with one name.
  const saved = path.join(dir, 'snow.crystal.json'), keep = (...args) => spawnSync(process.execPath, [path.join(root, 'bin/pixelbolt.js'), 'presets', ...args], { encoding: 'utf8' });
  const kept = keep('snowflakes', '--out', saved);
  assert.equal(kept.status, 0, kept.stderr + kept.stdout);
  assert.deepEqual(JSON.parse(await readFile(saved, 'utf8')), JSON.parse(await readFile(path.join(root, 'examples/snowflakes.crystal.json'), 'utf8')));
  assert.deepEqual(Object.keys(JSON.parse(kept.stdout)), ['name', 'source', 'next']);
  assert.match(JSON.parse(kept.stdout).next, /snow\.crystal\.json --out <new recipe\.json>\.$/);
  const said = result => result.stdout + result.stderr;
  assert.match(said(keep('snowflakes', '--out', saved)), /Output already exists/);
  assert.match(said(keep('--find', 'snow', '--out', path.join(dir, 'found.json'))), /--out saves one preset's source: pixelbolt presets <name> --out <new\.json>/);
});

test('pixelbolt share preserves crystal and bodies sources for the playground compiler', async () => {
  const { readShareLink } = await import('../src/share.js');
  const cli = (...args) => spawnSync(process.execPath, ['bin/pixelbolt.js', ...args], { cwd: root, encoding: 'utf8' });
  const snow = cli('share', 'examples/snowflakes.crystal.json');
  assert.equal(snow.status, 0, snow.stderr);
  const info = JSON.parse(snow.stdout), decoded = await readShareLink(info.link);
  assert.equal(info.kind, 'crystal'); assert.equal(info.compiledFrom, undefined);
  assert.deepEqual(decoded.recipe, JSON.parse(await readFile(new URL('../examples/snowflakes.crystal.json', import.meta.url), 'utf8')));
  const bodies = cli('share', 'examples/crate-topple.bodies.json');
  assert.equal(bodies.status, 0, bodies.stderr);
  assert.deepEqual((await readShareLink(JSON.parse(bodies.stdout).link)).recipe, JSON.parse(await readFile(new URL('../examples/crate-topple.bodies.json', import.meta.url), 'utf8')));
});
