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
import { startMCP } from '../src/mcp.js';
import { packageFiles } from '../scripts/build-studio.mjs';
import { crystalPresets } from '../scripts/crystal-presets.mjs';
import { CRYSTAL_SHOWCASE, buildCrystalGIFs } from '../showcase/crystals/build.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// The compiled recipe of every preset. They change with any change to what the compiler draws: if a change is
// intended, look at the GIFs (node showcase/crystals/build.mjs --force) and update these.
const GOLDEN = {
  geode: 'f108ba750018926e0c3661b74de1b5fe8cf82daa87fb0648188c1cc82857d310', 'quartz-cluster': '118077f7f357e4573fef2f47a7757968166d6e40ddb97c9caa63a83028abf7ba',
  pyrite: '0be93adb0c7e350a7217b95e35e9e093d7f1cb60c45649b8c2a2f97c208a3505', snowflakes: '8bbb7824f44fdb6370c59870d4ea73385b43a1830af9728c51ca083d65960751'
};
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

test('every crystal example compiles to its golden recipe, draws only palette keys and comes to rest', async () => {
  for (const name of CRYSTAL_SHOWCASE) {
    const example = JSON.parse(await readFile(path.join(root, 'examples', `${name}.crystal.json`), 'utf8'));
    assert.deepEqual(example, JSON.parse(JSON.stringify(crystalPresets[name])), `examples/${name}.crystal.json is stale; run node scripts/generate-examples.js`);
    const { recipe, metadata, warnings } = compileCrystals(example);
    assert.equal(sha(recipe), GOLDEN[name], `${name} compiled differently; if the change is intended, update GOLDEN and rebuild the GIFs`);
    assert.deepEqual(warnings, [], name);
    const keys = new Set(Object.keys(example.palette));
    for (const frame of recipe.frames) for (const layer of frame.layers) for (const row of layer.ops[0].rows) for (const key of row) assert.ok(key === '.' || keys.has(key), `${name} draws ${key}`);
    // A clear rest at the end: at least six still frames.
    const [effect] = Object.values(metadata.effects);
    assert.ok(effect.settled <= effect.frames - 7, `${name} settles at ${effect.settled} of ${effect.frames}`);
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
  const help = await call('tools/call', { name: 'pixel_help', arguments: { topic: 'crystal' } });
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
});
