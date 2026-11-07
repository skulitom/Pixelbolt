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
import { compileBodies, createBodyWorld, readBodies, drawBodies, bodiesFrames } from '../src/bodies.js';
import { cosDeg, sinDeg } from '../src/craft.js';
import { startMCP } from '../src/mcp.js';
import { packageFiles } from '../scripts/build-studio.mjs';
import { bodiesPresets } from '../scripts/bodies-presets.mjs';
import { BODIES_SHOWCASE, buildBodiesGIFs } from '../showcase/bodies/build.mjs';
import { goldens } from '../scripts/goldens.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// The compiled recipe of every example, in test/goldens/bodies.json: node scripts/goldens.mjs bodies draws any that
// change before and after, and --write updates them.
const golden = goldens(new URL('./goldens/bodies.json', import.meta.url));
const example = async name => JSON.parse(await readFile(path.join(root, 'examples', `${name}.bodies.json`), 'utf8'));
const palette = { k: '#111111', w: '#eeeeee', r: '#dd3344', s: '#555566' };
const scene = (effect, extra = {}) => ({ format: 'pixelforge-bodies', version: 1, name: 'bodies', width: 48, height: 32, palette, ...extra, effects: { e: { frames: 40, ...effect } } });
const run = source => { const { recipe, metadata } = compileBodies(source); return { recipe, effect: Object.values(metadata.effects)[0] }; };
const refused = (source, where, pattern) => assert.throws(() => compileBodies(source), error => error instanceof PixelError && error.path === where && pattern.test(error.message), where);
// The highest point (smallest y) a path reaches after `from`, between bounces.
const apexes = path => { const out = []; for (let i = 1; i + 1 < path.length; i++) if (path[i][1] < path[i - 1][1] && path[i][1] <= path[i + 1][1]) out.push(path[i][1]); return out; };

test('bodies sources are read strictly, with paths and the fix in each message', () => {
  refused({ format: 'pixelforge-bodies', version: 2 }, 'bodies', /version-1/);
  refused(scene({ bodies: [{ shape: 'star', at: [8, 8], fill: 'k' }] }), 'bodies.effects.e.bodies[0].shape', /circle, box, polygon, hoop/);
  refused(scene({ bodies: [{ shape: 'hoop', radius: 8, at: [8, 8], fill: 'k' }] }), 'bodies.effects.e.bodies[0].fixed', /container/);
  refused(scene({ bodies: [{ shape: 'box', size: [4, 4], at: [8, 8], fixed: true, density: 2, fill: 'k' }] }), 'bodies.effects.e.bodies[0].density', /moves freely/);
  refused(scene({ bodies: [{ shape: 'circle', radius: 2, at: [8, 8], fill: 'k', symbol: 'x' }] }), 'bodies.effects.e.bodies[0].symbol', /not both/);
  refused(scene({ bodies: [{ shape: 'circle', radius: 2, at: [8, 8] }] }), 'bodies.effects.e.bodies[0].fill', /palette key/);
  refused(scene({ bodies: [{ shape: 'circle', radius: 2, at: [8, 8], fill: 'z' }] }), 'bodies.effects.e.bodies[0].fill', /palette/);
  refused(scene({ bodies: [{ shape: 'polygon', points: [[0, 0], [4, 0], [1, 1], [0, 4]], at: [8, 8], fill: 'k' }] }), 'bodies.effects.e.bodies[0].points', /convex/);
  refused(scene({ bodies: [{ shape: 'box', size: [2, 2], at: [8, 8], fill: 'k', ring: { radius: 40, count: 300 } }] }), 'bodies.effects.e.bodies[0].ring.count', /256/);
  refused(scene({ bodies: [{ shape: 'circle', radius: 2, at: [8, 8], fill: 'k', bouncy: 1 }] }), 'bodies.effects.e.bodies[0].bouncy', /unknown/);
  refused(scene({ obstacles: [{ symbol: 'nope' }], bodies: [{ shape: 'circle', radius: 2, at: [8, 8], fill: 'k' }] }), 'bodies.effects.e.obstacles[0].symbol', /unknown symbol/);
  const warned = compileBodies(scene({ bodies: [{ shape: 'box', size: [6, 6], at: [10, 10], fill: 'k' }, { shape: 'box', size: [6, 6], at: [11, 10], fill: 'w' }] }));
  assert.match(warned.warnings.join('\n'), /starts inside/);
});

test('a ball with bounce 1 keeps its height, one with bounce 0 lands dead, and a damped one comes to rest', () => {
  const ball = (bounce, name) => ({ name, shape: 'circle', radius: 2, at: [name === 'dead' ? 8 : name === 'half' ? 20 : 32, 6], bounce, fill: 'k' });
  const { effect } = run(scene({ frames: 200, walls: ['bottom'], bodies: [ball(1, 'elastic'), ball(0, 'dead'), ball(0.6, 'half')] }));
  const elastic = apexes(effect.paths.elastic);
  assert.ok(elastic.length >= 3, `${elastic.length} bounces`);
  for (const y of elastic) assert.ok(Math.abs(y - 6) <= 1, `the elastic ball rose to ${y}, not 6`);
  // The floor is the canvas bottom: a radius-2 ball rests with its centre at 30.
  const dead = effect.paths.dead, landed = dead.findIndex(p => p[1] >= 29.9);
  assert.ok(landed > 0 && dead.slice(landed).every(p => p[1] >= 29.9), 'the dead ball never leaves the floor once it lands');
  const half = effect.paths.half.slice(-20);
  assert.ok(half.every(p => p[0] === half[0][0] && p[1] === half[0][1]), 'the damped ball has stopped');
});

test('a stack rests, a box slides along a pixel floor without catching, and a fast pixel never passes a thin wall', () => {
  const stack = run(scene({ frames: 60, walls: ['bottom'], bodies: [{ name: 'box', shape: 'box', size: [6, 6], at: [24, 29], fill: 'k', grid: { count: [1, 4], step: [0, -6] } }] })).effect;
  assert.ok(stack.rest !== null && stack.rest < 60, `the stack rests at ${stack.rest}`);
  [0, 1, 2, 3].forEach(k => { const p = stack.paths[`box-${k}`].at(-1); assert.ok(Math.abs(p[0] - 24) < 0.05 && Math.abs(p[1] - (29 - 6 * k)) < 0.1, `box ${k} at ${p}`); });
  // A floor of three symbols side by side: the box slides over every seam at the same height, slowing steadily.
  const floor = { f: ['ssssssssssssssss', 'ssssssssssssssss'] };
  const slide = run(scene({ frames: 50, obstacles: [0, 16, 32].map(x => ({ symbol: 'f', x, y: 28 })), bodies: [{ name: 'box', shape: 'box', size: [4, 4], at: [4, 26], velocity: [1.6, 0], friction: 0.15, fill: 'k' }] }, { symbols: floor })).effect.paths.box;
  for (let i = 1; i < slide.length; i++) {
    assert.ok(Math.abs(slide[i][1] - 26) < 0.05, `frame ${i}: the box rides at ${slide[i][1]}`);
    assert.ok(slide[i][0] >= slide[i - 1][0], `frame ${i}: the box caught on a seam`);
  }
  // A one-pixel wall and a pixel thrown at it at the speed limit.
  const wall = { w: Array.from({ length: 32 }, () => 's') };
  const thrown = run(scene({ frames: 30, gravity: [0, 0], walls: ['left'], obstacles: [{ symbol: 'w', x: 30, y: 0 }], bodies: [{ name: 'pixel', shape: 'circle', radius: 0.5, at: [4.5, 16.5], velocity: [8, 0], bounce: 1, fill: 'w' }] }, { symbols: wall })).effect.paths.pixel;
  assert.ok(thrown.every(p => p[0] < 30), 'the pixel stays on its side of the wall');
  assert.ok(thrown.at(-1)[0] < 20, 'and bounces back');
});

test('an asleep body holds still until hit, a weightless one floats, and a moving fixed body pushes', () => {
  const held = run(scene({ frames: 60, walls: ['bottom'], bodies: [
    { name: 'hanging', shape: 'box', size: [4, 4], at: [24, 8], asleep: true, fill: 'k' },
    { name: 'floating', shape: 'box', size: [4, 4], at: [40, 8], weightless: true, fill: 'k' },
    { name: 'ball', shape: 'circle', radius: 2, at: [24, 1], velocity: [0, 1.5], gravity: undefined, bounce: 0, fill: 'r' }
  ].map(b => { delete b.gravity; return b; }) })).effect;
  assert.deepEqual(held.paths.floating.at(-1), [40, 8, 0], 'the weightless box never moved or turned');
  assert.ok(held.paths.hanging[2][1] === 8 || held.paths.hanging.at(-1)[1] > 20, 'the hit box falls once the ball strikes it');
  assert.ok(held.paths.hanging.at(-1)[1] > 25, 'and lands');
  const untouched = run(scene({ frames: 30, bodies: [{ name: 'hanging', shape: 'box', size: [4, 4], at: [24, 8], asleep: true, fill: 'k' }] })).effect;
  assert.ok(untouched.paths.hanging.every(p => p[0] === 24 && p[1] === 8), 'with nothing to wake it, it hangs in the air');
  // A fixed paddle moving along the floor pushes a box ahead of it and never gives way.
  const pushed = run(scene({ frames: 50, walls: ['bottom'], bodies: [
    { name: 'paddle', shape: 'box', size: [2, 8], at: [4, 28], fixed: true, velocity: [0.5, 0], fill: 'w' },
    { name: 'box', shape: 'box', size: [4, 4], at: [12, 30], friction: 0.3, fill: 'k' }] })).effect;
  const box = pushed.paths.box.at(-1);
  assert.ok(box[0] >= 4 + 0.5 * 49 + 1 + 2 - 0.2, `the box was pushed to ${box}`);
  assert.ok(Math.abs(box[1] - 30) < 0.1, 'along the floor');
});

test('the presets do what they show: the ball escapes the ring, the pixel and the crates come to rest, the balls leave the hoop', () => {
  const ring = run(bodiesPresets['ring-escape']).effect;
  assert.equal(ring.escaped.length, 1);
  assert.equal(ring.escaped[0].body, 'ball');
  assert.ok(ring.escaped[0].frame > 120 && ring.rest !== null, `escaped at ${ring.escaped[0].frame}, at rest from ${ring.rest}`);
  assert.ok(ring.hits > 40, `${ring.hits} hits`);
  // A body that has left keeps a place in its path for every frame: null from the frame it left.
  assert.equal(ring.paths.ball.length, ring.frames);
  assert.equal(ring.paths.ball.findIndex(p => p === null), ring.escaped[0].frame);
  assert.ok(ring.paths.ball.slice(ring.escaped[0].frame).every(p => p === null));
  const pixel = run(bodiesPresets['bouncing-pixel']).effect;
  assert.ok(pixel.rest !== null && pixel.hits >= 8, `the pixel bounced ${pixel.hits} times and rests from ${pixel.rest}`);
  const crates = run(bodiesPresets['crate-topple']).effect;
  assert.ok(crates.rest !== null, 'the crates come to rest');
  // The hoop's centre is [36, 30] and its radius 24: a ball past 27 from the centre is out.
  const hoop = run(bodiesPresets['spinning-hoop']).effect, out = name => hoop.paths[name].some(([x, y]) => (x - 36) ** 2 + (y - 30) ** 2 > 27 * 27);
  assert.ok(['red', 'yellow', 'green'].filter(out).length >= 2, 'at least two balls found the gap and fell out of the hoop');
});

test('the work estimate counts the obstacle faces near each body and the pixels drawn finer, so a heavy source is refused before it runs', () => {
  // A checkerboard has a face on every pixel edge, and a box over one meets a face a pixel. Counting bodies alone, these
  // 8 boxes kept moving over one were 2.7 million updates of the 400 million allowed, and took 10 seconds where the same
  // boxes without it take a third of one.
  const checker = Array.from({ length: 112 }, (_, y) => Array.from({ length: 112 }, (_, x) => ((x + y) % 2 ? 's' : '.')).join(''));
  const board = (obstacles, frames = 256) => ({ format: 'pixelforge-bodies', version: 1, name: 'checker', width: 128, height: 128, palette, symbols: { checker },
    effects: { e: { frames, gravity: [0, 0], walls: ['left', 'right', 'top', 'bottom'], obstacles, bodies: [{ shape: 'box', size: [24, 24], at: [20, 20], grid: { count: [4, 2], step: [28, 28] }, fill: 'r', weightless: true, tireless: true, velocity: [1, 0.5] }] } } });
  const faces = [{ symbol: 'checker', x: 8, y: 8, draw: 'none' }];
  refused(board(faces), 'bodies.effects.e', /need about \d+ million updates, more than 400 million; .*the obstacle faces near them \(a checkerboard has one on every pixel edge\)/);
  assert.throws(() => bodiesFrames(board(faces, 18000)), error => error instanceof PixelError && /the match needs about \d+ million updates, more than 4000 million/.test(error.message));
  assert.equal(bodiesFrames(board([], 18000)).frames, 18000);
  // Drawn 8 times finer, each of 256 boxes visits the whole fine canvas every frame: as a long match that ran for an
  // hour. The same match at whole pixels is within the limit (bodiesFrames simulates nothing until asked for a frame).
  const fine = subpixels => ({ format: 'pixelforge-bodies', version: 1, name: 'heavy', width: 32, height: 32, ...(subpixels > 1 && { subpixels }), palette,
    effects: { e: { frames: 18000, substeps: 1, iterations: 1, gravity: [0, 0], bodies: [{ shape: 'box', size: [40, 40], at: [16, 16], angle: 30, grid: { count: [16, 16], step: [0.001, 0.001] }, asleep: true, fill: 'r', outline: 'k' }] } } });
  assert.equal(bodiesFrames(fine(1)).frames, 18000);
  assert.throws(() => bodiesFrames(fine(8)), error => error instanceof PixelError && error.path === 'bodies.effects.e' && /the match needs about \d+ million updates, more than 4000 million; .*or subpixels/.test(error.message));
});

golden.test('every rigid-body example compiles to its golden recipe and draws only palette keys', async () => {
  for (const name of BODIES_SHOWCASE) {
    const source = await example(name);
    assert.deepEqual(source, JSON.parse(JSON.stringify(bodiesPresets[name])), `examples/${name}.bodies.json is stale; run node scripts/generate-examples.js`);
    const { recipe } = compileBodies(source);
    golden.equal(name, sha(recipe), { recipe, note: 'Rebuild the GIFs too: npm run art:bodies -- --force.' });
    const keys = new Set(Object.keys(source.palette));
    for (const frame of recipe.frames) for (const op of frame.ops ?? []) {
      // A territory's heads-up display adds text and its boxes and bars.
      assert.ok(['grid', 'stamp', 'rect', 'text'].includes(op.op), `${name} ${frame.name}: ${op.op}`);
      if (op.op === 'grid') for (const row of op.rows) for (const char of row) assert.ok(char === '.' || keys.has(char), `${name} ${frame.name} draws ${char}`);
    }
    renderProject(recipe);
  }
  const { files } = await buildBodiesGIFs();
  for (const [file, bytes] of files) assert.ok(bytes.equals(await readFile(path.join(root, file))), `${file} is stale; run node showcase/bodies/build.mjs --force`);
});

test('the bodies schema lists exactly the fields the compiler reads, and the package ships it', async () => {
  const schema = JSON.parse(await readFile(path.join(root, 'bodies.schema.json'), 'utf8')), effect = schema.properties.effects.additionalProperties, body = effect.properties.bodies.items;
  const unknown = (source, where) => { try { compileBodies(source); return false; } catch (error) { return error.path === where && /unknown or null field/.test(error.message); } };
  const base = () => scene({ bodies: [{ shape: 'circle', radius: 2, at: [8, 8], fill: 'k' }], obstacles: [{ symbol: 'lid' }] }, { symbols: { lid: ['k'] } });
  const levels = [
    [schema.properties, (s, key) => { s[key] = s[key] ?? 0; }, 'bodies'],
    [effect.properties, (s, key) => { s.effects.e[key] = 0; }, 'bodies.effects.e'],
    [body.properties, (s, key) => { s.effects.e.bodies[0][key] = 0; }, 'bodies.effects.e.bodies[0]'],
    [effect.properties.obstacles.items.properties, (s, key) => { s.effects.e.obstacles[0][key] = 0; }, 'bodies.effects.e.obstacles[0]'],
    [body.properties.trail.properties, (s, key) => { s.effects.e.bodies[0].trail = { color: 'k', [key]: 0 }; }, 'bodies.effects.e.bodies[0].trail'],
    [body.properties.ring.properties, (s, key) => { s.effects.e.bodies[0].ring = { radius: 4, count: 2, [key]: 0 }; }, 'bodies.effects.e.bodies[0].ring'],
    [body.properties.grid.properties, (s, key) => { s.effects.e.bodies[0].grid = { count: [1, 1], step: [1, 1], [key]: 0 }; }, 'bodies.effects.e.bodies[0].grid']
  ];
  for (const [properties, set, where] of levels) {
    for (const key of Object.keys(properties)) { const source = base(); set(source, key); assert.ok(!unknown(source, `${where}.${key}`), `${where}.${key} is in the schema but the compiler refuses it`); }
    const source = base(); set(source, 'notAField'); assert.ok(unknown(source, `${where}.notAField`), `${where} accepts a field the schema doesn't list`);
  }
  const files = await packageFiles();
  assert.ok(files.includes('bodies.schema.json') && files.includes('src/bodies.js'));
  for (const name of BODIES_SHOWCASE) assert.ok(files.includes(`examples/${name}.bodies.json`), name);
});

test('MCP and the CLI compile bodies sources and presets', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-bodies-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const input = new PassThrough(), output = new PassThrough(), waiting = new Map();
  let buffer = '', id = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)?.(message); } });
  startMCP({ input, output, root: dir, directory: dir }); t.after(() => input.end());
  const call = (method, params) => new Promise(resolve => { waiting.set(++id, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'bodies-test', version: '1' } });
  const help = await call('tools/call', { name: 'pixel_help', arguments: { topic: 'bodies' } });
  assert.equal(JSON.parse(help.result.content[0].text).title, 'Pixelbolt rigid bodies');
  const source = scene({ frames: 12, walls: ['bottom'], bodies: [{ name: 'ball', shape: 'circle', radius: 2, at: [24, 8], fill: 'r' }] });
  const compiled = JSON.parse((await call('tools/call', { name: 'pixel_compile', arguments: { source, metadata: true } })).result.content[0].text);
  assert.deepEqual([compiled.ok, compiled.frames, compiled.metadata.format], [true, 12, 'pixelforge-bodies-metadata']);
  const preset = JSON.parse((await call('tools/call', { name: 'pixel_compile', arguments: { preset: 'ring-escape' } })).result.content[0].text);
  assert.equal(preset.ok, true);
  const file = path.join(dir, 'drop.bodies.json'), out = path.join(dir, 'drop.json');
  await writeFile(file, JSON.stringify(source));
  const cli = spawnSync(process.execPath, [path.join(root, 'bin/pixelbolt.js'), 'compile', file, '--out', out], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(await readFile(out, 'utf8')).frames.length, 12);
});

test('bodies drawn finer than the world turn as rigid pictures, within the canvas limits', () => {
  const source = (subpixels, extra = {}) => ({ format: 'pixelforge-bodies', version: 1, name: 'fine', width: 32, height: 24, subpixels, palette, symbols: { post: ['ss', 'ss'] },
    effects: { e: { frames: 24, gravity: [0, 0], obstacles: [{ symbol: 'post', x: 2, y: 2 }], bodies: [{ shape: 'box', size: [8, 8], at: [16, 12], fixed: true, spin: 3.75, fill: 'w', outline: 'k' }], ...extra } } });
  const { recipe } = compileBodies(source(4)), fill = { w: 0, k: 0 };
  assert.deepEqual([recipe.width, recipe.height], [128, 96]);
  // The world is drawn in blocks of four: the post's stamp is enlarged and placed four times further out.
  assert.deepEqual(recipe.frames[0].ops.find(op => op.op === 'stamp'), { op: 'stamp', symbol: 'post', x: 8, y: 8, scale: 4 });
  // Every frame draws the same picture turned: 8 × 8 pixels of 4 × 4, the outline a ring 4 fine pixels wide.
  for (const frame of recipe.frames) {
    const grid = frame.ops.find(op => op.op === 'grid'), count = { w: 0, k: 0 };
    for (const row of grid.rows) for (const ch of row) if (ch in count) count[ch]++;
    assert.ok(Math.abs(count.w + count.k - 1024) <= 40, `${frame.name}: ${count.w + count.k} fine pixels for 1024`);
    assert.ok(Math.abs(count.w - 576) <= 40 && Math.abs(count.k - 448) <= 40, `${frame.name}: fill ${count.w} and outline ${count.k}, for 576 and 448`);
    fill.w += count.w; fill.k += count.k;
  }
  assert.equal(renderProject(recipe).frames.length, 24);
  refused({ ...source(9) }, 'bodies.subpixels', /from 1 to 8/);
  refused({ ...source(4), width: 72 }, 'bodies.subpixels', /at most 256 a side, so use subpixels of at most 3/);
  refused({ ...source(4, { frames: 100 }), width: 64, height: 48 }, 'bodies.subpixels', /4,194,304.*lower subpixels to 3/);
});

test('bodies drawn finer than the world hold still while they bob or rock, keep straight sides at rest and turn evenly', () => {
  // One crate, placed and turned by hand frame after frame, drawn 2 (or 3) times finer as compileBodies draws it.
  const symbols = { crate: ['kkkkkkkk', 'kwwwwwwk', 'kwkwwwwk', 'kwwkwwwk', 'kwwwkwwk', 'kwwwwkwk', 'kwwwwwwk', 'kkkkkkkk'] };
  const crate = (n, spin = 0) => {
    const [b] = createBodyWorld({ substeps: 8, iterations: 6, gravity: [0, 0], walls: { left: false, right: false, top: false, bottom: false }, obstacles: [],
      bodies: readBodies([{ shape: 'box', size: [8, 8], at: [16, 12], symbol: 'crate', ...(spin && { fixed: true, spin }) }], 'bodies', { palette, symbols, width: 32, height: 24 }) }, { width: 32, height: 24 }).bodies;
    return { b, draw: (x, y, degrees) => { b.x = x; b.y = y; b.c = cosDeg(degrees); b.s = sinDeg(degrees); const { op } = drawBodies([b], 32, 24, symbols, n); return op; } };
  };
  const cells = op => { const out = new Map(); op.rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] !== '.') out.set(`${op.x + i},${op.y + j}`, row[i]); }); return out; };
  // At rest a hundredth of a degree off square, with its sides where the fine pixels' centres are, it is drawn square:
  // each row of it spans the same fine pixels (sampled on its pixel edges, half of each side was a fine pixel out).
  const rest = crate(2).draw(16.75, 12, 0.06);
  assert.equal(rest.rows.length, 16);
  assert.deepEqual(new Set(rest.rows.map(row => `${row.search(/[^.]/)}:${row.replace(/\./g, '').length}`)), new Set(['0:16']), `a straight-sided crate: ${rest.rows.join('/')}`);
  // Bobbing a tenth of a pixel and rocking a third of a degree, it draws the same pixels every frame.
  const bob = crate(3), first = JSON.stringify(bob.draw(16.4, 12.3, 8.9));
  for (let f = 1; f < 24; f++) assert.equal(JSON.stringify(bob.draw(16.4 + 0.1 * Math.sin(f), 12.3 + 0.1 * Math.cos(f * 1.3), 8.9 + 0.3 * Math.sin(f * 0.7))), first, `frame ${f} holds still`);
  // Sliding at a fixed angle, it moves on a fine pixel at a time, never back, and its picture never changes.
  const slide = crate(3), start = cells(slide.draw(10, 12, 20)), shifted = by => new Map([...start].map(([key, ch]) => { const [x, y] = key.split(',').map(Number); return [`${x + by},${y}`, ch]; }));
  let shift = 0;
  for (let f = 1; f <= 30; f++) {
    const now = cells(slide.draw(10 + f / 9, 12, 20)), next = [shift, shift + 1].find(by => JSON.stringify([...shifted(by)]) === JSON.stringify([...now]));
    assert.ok(next !== undefined, `frame ${f}: the same picture, ${shift} or ${shift + 1} fine pixels on`);
    shift = next;
  }
  assert.ok(Math.abs(shift - 10) <= 1, `it slid 10 fine pixels: ${shift}`);
  // Spinning, it is drawn at its own angle every frame: evenly turned, never held back.
  const spin = crate(3, 4.5), turned = [];
  for (let f = 0; f < 8; f++) turned.push(JSON.stringify(spin.draw(16, 12, 4.5 * f)));
  assert.equal(new Set(turned).size, 8, 'a new picture every frame');
  for (let f = 0; f < 8; f++) assert.equal(turned[f], JSON.stringify(crate(3, 4.5).draw(16, 12, 4.5 * f)), `frame ${f} is drawn at exactly its angle, as a body first drawn there is`);
});

// One body, or several, read and placed as a world places them, for drawing by hand.
const placed = (entries, width = 64, height = 48, symbols = {}) => createBodyWorld({ substeps: 8, iterations: 6, gravity: [0, 0], walls: {}, obstacles: [],
  bodies: readBodies(entries, 'bodies', { palette, symbols, width, height }) }, { width, height }).bodies;
const drawnCells = (bodies, width = 64, height = 48, symbols = {}, n = 1) => {
  const { op } = drawBodies(bodies, width, height, symbols, n), out = [];
  if (op) op.rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] !== '.') out.push([op.x + i, op.y + j, row[i]]); });
  return out;
};

test('a thin ring is one closed line at every size: no pixel missing at its diagonals, no step doubled', () => {
  for (const off of [0, 0.5]) for (let r = 2; r <= 28; r += 0.25) {
    const on = new Set(drawnCells(placed([{ shape: 'hoop', fixed: true, radius: r, at: [32 + off, 32 + off], fill: 'k' }], 64, 64), 64, 64).map(([x, y]) => `${x},${y}`));
    const around = key => { const [x, y] = key.split(',').map(Number), out = []; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if ((i || j) && on.has(`${x + i},${y + j}`)) out.push(`${x + i},${y + j}`); return out; };
    for (const key of on) assert.equal(around(key).length, 2, `radius ${r} at +${off}: pixel ${key} has ${around(key).length} neighbours`);
    const seen = new Set([[...on][0]]), stack = [...seen];
    while (stack.length) for (const next of around(stack.pop())) if (!seen.has(next)) { seen.add(next); stack.push(next); }
    assert.equal(seen.size, on.size, `radius ${r} at +${off}: one piece`);
  }
});

test('drawn at whole pixels, a body moving steadily steps evenly, one rocking on a pixel boundary holds still, and turned pictures sit where the body is', () => {
  const [box] = placed([{ shape: 'box', size: [8, 8], at: [10, 12], fill: 'w', outline: 'k' }]);
  const left = b => Math.min(...drawnCells([b]).map(([x]) => x));
  // A pixel a frame, half a pixel off the grid: held both ways, it was drawn 0, 2, 0, 2 pixels on.
  const xs = [];
  for (let f = 0; f < 30; f++) { box.x = 10.55 + f; xs.push(left(box)); }
  for (let f = 3; f < 30; f++) assert.equal(xs[f] - xs[f - 1], 1, `frame ${f}: ${xs.join(' ')}`);
  const [rocking] = placed([{ shape: 'box', size: [8, 8], at: [10.5, 12], fill: 'w', outline: 'k' }]), still = new Set();
  for (let f = 0; f < 40; f++) { rocking.x = 10.5 + 0.25 * Math.sin(f); still.add(left(rocking)); }
  assert.equal(still.size, 1, 'rocking a quarter pixel about a boundary, it holds still');
  // Turned, at any place, a picture's middle is within half a pixel of the body (it sat a quarter pixel down and right on
  // average, and up to a pixel off).
  for (const angle of [5, 17, 30, 37, 52, 71]) for (let k = 0; k < 10; k++) {
    const [b] = placed([{ shape: 'box', size: [8, 8], at: [20 + k / 10, 15 + k / 7], angle, fill: 'w', outline: 'k' }]), cells = drawnCells([b]);
    const mx = cells.reduce((sum, [x]) => sum + x + 0.5, 0) / cells.length, my = cells.reduce((sum, [, y]) => sum + y + 0.5, 0) / cells.length;
    assert.ok(Math.abs(mx - b.x) <= 0.5 + 1e-9 && Math.abs(my - b.y) <= 0.5 + 1e-9, `at ${angle}°, [${b.x}, ${b.y}] is drawn about [${mx}, ${my}]`);
  }
});

test('a small brick on its side, a right triangle and a resting ball\'s trail are drawn as they are', () => {
  const count = entry => drawnCells(placed([entry])).length;
  // Snapped by its upright sides, a 5 × 4 brick on its side sat on half pixels and was drawn a 26-pixel blob.
  assert.equal(count({ shape: 'box', size: [5, 4], at: [20.3, 15.6], angle: 90, fill: 'w' }), 20);
  assert.equal(count({ shape: 'box', size: [3, 2], at: [20.3, 15.6], angle: 270, fill: 'w' }), 6);
  // A right triangle's centre isn't the middle of its bounds: cut to them, it lost its tips.
  assert.equal(count({ shape: 'polygon', points: [[0, 0], [12, 0], [0, 12]], at: [20, 15], fill: 'w', outline: 'k' }), 78);
  // A ball at rest shows no trail beside it; moving, it leaves one.
  const trail = velocity => run(scene({ frames: 12, gravity: [0, 0], bodies: [{ shape: 'circle', radius: 2, at: [20.3, 15.6], velocity, weightless: true, fill: 'w', trail: { color: 'r', length: 3 } }] }))
    .recipe.frames.map(frame => frame.ops.find(op => op.op === 'grid').rows.join('').split('r').length - 1);
  assert.ok(trail([0, 0]).every(n => n === 0), `resting: ${trail([0, 0]).join(' ')}`);
  assert.ok(trail([1.5, 0]).slice(3).every(n => n > 0), 'moving');
});

test('a box dropped flat lands flat, a tireless box never climbs, and bodies wake when what holds them moves', () => {
  // Bounced one corner at a time, a box dropped flat set itself spinning: most drops with bounce turned, some flipped.
  const flat = run(scene({ frames: 120, walls: ['bottom'], bodies: [0.5, 0.9, 1].map((bounce, k) => ({ name: `b${k}`, shape: 'box', size: [8, 8], at: [8 + 16 * k + 0.3 * k, 8], bounce, fill: 'k' })) })).effect.paths;
  for (const [name, path] of Object.entries(flat)) assert.ok(path.every(([, , a]) => Math.min(a, 360 - a) < 0.5), `${name} stays flat: ${Math.max(...path.map(([, , a]) => Math.min(a, 360 - a)))}°`);
  // Its spin left out of the energy it keeps, a tireless box gained height at every bounce that set it spinning.
  const tireless = run(scene({ frames: 240, walls: ['left', 'right', 'bottom'], bodies: [0, 12, 25, 40].map((angle, k) => ({ name: `t${k}`, shape: 'box', size: [12, 3], at: [6 + 12 * k, 8], angle, bounce: 1, friction: 0.4, tireless: true, fill: 'k' })) }, { width: 64, height: 48 })).effect.paths;
  for (const [name, path] of Object.entries(tireless)) assert.ok(path.every(p => p && p[1] > 6.5), `${name} never rises past where it was dropped: ${Math.min(...path.map(p => (p ? p[1] : -99)))}`);
  // A box asleep on a deck sinking slower than it sleeps follows it down (left asleep, it hung in the air).
  const sinking = run(scene({ frames: 200, bodies: [{ name: 'deck', shape: 'box', size: [20, 2], at: [24, 20], fixed: true, velocity: [0, 0.02], fill: 'w' }, { name: 'box', shape: 'box', size: [4, 4], at: [24, 17], fill: 'k' }] })).effect.paths.box;
  assert.ok(sinking.at(-1)[1] > 17 + 0.02 * 199 - 0.5, `the box rides the deck down to ${sinking.at(-1)[1]}`);
});

test('a plank lying onto a low step rests on it, a bouncy floor beside a dead one keeps its bounce, and few substeps don\'t count rest as hits', () => {
  const ground = { floor: Array.from({ length: 4 }, () => 's'.repeat(64)), step: ['s'.repeat(24), 's'.repeat(24)] };
  // Its centre below the step's top, past the step's end, the plank lost the step's faces and sank into it.
  const plank = run(scene({ frames: 80, obstacles: [{ symbol: 'floor', x: 0, y: 44 }, { symbol: 'step', x: 40, y: 42 }], bodies: [{ name: 'plank', shape: 'box', size: [48, 1], at: [24, 38], fill: 'k' }] }, { width: 64, height: 48, symbols: ground })).effect.paths.plank;
  const [x, y, a] = plank.at(-1), right = x + 24 * cosDeg(a) - 0.5 * sinDeg(a), low = y + 24 * sinDeg(a) + 0.5 * cosDeg(a);
  assert.ok(right > 40 && low <= 42.1, `the plank's end rests on the step: [${right}, ${low}]`);
  // A run of faces took the material of the cell it started on: the bouncy half of the floor didn't bounce.
  const floors = { dead: ['s'.repeat(24)], live: ['s'.repeat(24)] };
  const bounced = run(scene({ frames: 60, obstacles: [{ symbol: 'dead', x: 0, y: 30, bounce: 0 }, { symbol: 'live', x: 24, y: 30, bounce: 1 }], bodies: [{ name: 'ball', shape: 'circle', radius: 2, at: [36, 10], bounce: 0, fill: 'k' }] }, { symbols: floors })).effect.paths.ball;
  const landed = bounced.findIndex(p => p[1] > 26.5);
  assert.ok(landed > 0 && Math.min(...bounced.slice(landed).map(p => p[1])) < 20, 'the ball on the bouncy half bounces high');
  // With one substep, a substep's gravity is past REST_SPEED: a resting box counted a hit every frame and never slept.
  const resting = run(scene({ frames: 60, substeps: 1, gravity: [0, 0.5], walls: ['bottom'], bodies: [{ shape: 'box', size: [4, 4], at: [24, 20], bounce: 0.5, fill: ['k', 'w'] }] })).effect;
  assert.ok(resting.hits <= 3 && resting.rest !== null, `${resting.hits} hits, at rest from ${resting.rest}`);
});

// The cells of colour `key` a frame's grid draws, as [x, y].
const keyCells = (frame, key) => {
  const grid = frame.ops.find(op => op.op === 'grid'), out = [];
  if (grid) grid.rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === key) out.push([grid.x + i, grid.y + j]); });
  return out;
};

test('pivots, strikes, fills that step with time, vanishing and smears are read strictly', () => {
  const blade = { name: 'blade', shape: 'box', size: [20, 2], at: [24, 16], fixed: true, spin: 6, fill: 'w' }, ball = { name: 'ball', shape: 'circle', radius: 1, at: [24, 4], fill: ['k', 'w'] };
  refused(scene({ bodies: [{ ...ball, pivot: [1, 0] }] }), 'bodies.effects.e.bodies[0].pivot', /fixed body/);
  refused(scene({ bodies: [{ ...ball, fill: 'k', fillEvery: 4 }] }), 'bodies.effects.e.bodies[0].fillEvery', /list of fills/);
  refused(scene({ bodies: [{ shape: 'hoop', fixed: true, radius: 8, at: [24, 16], fill: 'w', smear: { colors: ['r'] } }] }), 'bodies.effects.e.bodies[0].smear', /hoop/);
  refused(scene({ bodies: [blade, ball], strikes: [{ by: 'nobody', power: 'split' }] }), 'bodies.effects.e.strikes[0].by', /no body is named "nobody"/);
  refused(scene({ bodies: [blade, ball], events: [{ frame: 3, body: 'blade', power: 'split' }] }), 'bodies.effects.e.events[0].body', /can only vanish/);
  refused(scene({ bodies: [blade, ball], most: 5000 }), 'bodies.effects.e.most', /from 2 to 4096/);
  refused(scene({ bodies: [blade, ball], strikes: [{ by: 'blade', power: 'split', cut: 0 }] }), 'bodies.effects.e.strikes[0].cut', /from 0.1 to 8/);
  assert.equal(compileBodies(scene({ bodies: [blade, ball], events: [{ frame: 3, body: 'blade', power: 'vanish' }] })).recipe.frames.length, 40);
});

test('a fixed body turns about its pivot, and a smear sweeps behind it', () => {
  // A 20-pixel blade turning 6 degrees a frame about its left end at [32, 24]: its far end is 20 pixels out at its angle.
  const { recipe } = run(scene({ frames: 30, gravity: [0, 0], bodies: [{ name: 'blade', shape: 'box', size: [20, 2], pivot: [-10, 0], at: [32, 24], fixed: true, spin: 6, fill: 'w', smear: { colors: ['r', 's'], frames: 2 } }] }, { width: 64, height: 48 }));
  recipe.frames.forEach((frame, f) => {
    const cells = keyCells(frame, 'w'), far = cells.reduce((best, [x, y]) => (Math.hypot(x + 0.5 - 32, y + 0.5 - 24) > Math.hypot(best[0] + 0.5 - 32, best[1] + 0.5 - 24) ? [x, y] : best), cells[0]);
    assert.ok(cells.some(([x, y]) => Math.abs(x + 0.5 - 32) <= 1.5 && Math.abs(y + 0.5 - 24) <= 1.5), `${frame.name}: the blade stays on its pivot`);
    const a = 6 * f * Math.PI / 180, reach = Math.hypot(far[0] + 0.5 - 32, far[1] + 0.5 - 24);
    assert.ok(Math.abs(reach - 20) < 1.6 && Math.hypot(far[0] + 0.5 - 32 - 20 * Math.cos(a), far[1] + 0.5 - 24 - 20 * Math.sin(a)) < 2.5, `${frame.name}: its far end ${far} at ${6 * f}°`);
    // The smear needs a frame behind it, and then lies behind the blade: turned back from it, not ahead.
    const smear = [...keyCells(frame, 'r'), ...keyCells(frame, 's')];
    if (f === 0) assert.equal(smear.length, 0);
    else {
      assert.ok(smear.length > 10, `${frame.name}: ${smear.length} smear pixels`);
      // (Within a few pixels of the pivot a pixel spans many degrees; past them, the angle tells.)
      for (const [x, y] of smear.filter(([x, y]) => Math.hypot(x + 0.5 - 32, y + 0.5 - 24) > 6)) {
        const behind = ((6 * f - Math.atan2(y + 0.5 - 24, x + 0.5 - 32) * 180 / Math.PI) % 360 + 540) % 360 - 180;
        assert.ok(behind > -8 && behind < 6 * Math.min(f, 2) + 12, `${frame.name}: a smear pixel ${behind.toFixed(1)}° behind the blade`);
      }
    }
  });
});

test('a strike splits what its body pushes, up to most, and copies take the fill of their frame', () => {
  // A blade turning about the centre of a ring with one ball in it: each ball it touches splits in three, at most once
  // every 6 frames, up to 120 bodies; the copies take the colour of the frame they are made in, a step every 20 frames.
  const ring = { name: 'ring', shape: 'hoop', fixed: true, radius: 15, thickness: 2, at: [24, 16], fill: 'w' };
  const blade = { name: 'blade', shape: 'box', size: [14, 2], pivot: [-6, 0], at: [24, 16], fixed: true, spin: 10, fill: 'w' };
  const ball = { name: 'seed', shape: 'circle', radius: 0.5, at: [24, 6], fill: ['k', 'r', 's'], fillEvery: 20 };
  const source = most => scene({ frames: 120, gravity: [0, 0.2], bodies: [ring, blade, ball], most, strikes: [{ by: 'blade', power: 'split', count: 3, spread: 60, rest: 6 }] });
  const { recipe, effect } = run(source(120));
  assert.ok(effect.copies === 117 && effect.strikes >= 39, `${effect.copies} copies from ${effect.strikes} strikes`);
  assert.equal(effect.escaped.length, 0, 'the ring holds them');
  assert.equal(effect.paths.seed.at(-1) !== null, true);
  // Splits stop at most bodies (256 without it).
  assert.equal(run(source(40)).effect.copies, 37);
  assert.ok(run(source(undefined)).effect.copies <= 253);
  const colours = new Set(recipe.frames.at(-1).ops.find(op => op.op === 'grid').rows.join('').replace(/[.w]/g, ''));
  assert.ok(colours.size >= 2, `copies in more than one colour: ${[...colours].join('')}`);
  // A ring that vanishes lets what it held fall out: everything has left the canvas a few seconds later.
  const burst = run(scene({ frames: 120, gravity: [0, 0.2], bodies: [ring, { ...ball, fill: 'k', fillEvery: undefined }], events: [{ frame: 40, body: 'ring', power: 'vanish' }] })).effect;
  assert.ok(burst.paths.seed.slice(0, 40).every(p => p !== null) && burst.escaped.length === 1 && burst.escaped[0].frame > 40, `escaped ${JSON.stringify(burst.escaped)}`);
});

test('a strike that cuts passes through what it strikes and leaves the pieces behind the blade, drawn over them', () => {
  // A blade turning 6 degrees a frame about [32, 24] meets a sleeping ball 15 pixels out at 30 degrees, which splits in
  // two. Pushed, the ball was swept along ahead of the blade (past 40 degrees by frame 6) and the pieces with it; cut,
  // the blade passes through, and the pieces drift back behind it, apart, in the colour of the frame they split in.
  const blade = { name: 'blade', shape: 'box', size: [20, 2], pivot: [-10, 0], at: [32, 24], fixed: true, spin: 6, fill: 'w' };
  const ball = { name: 'seed', shape: 'circle', radius: 1, at: [32 + 15 * cosDeg(30), 24 + 15 * sinDeg(30)], fill: ['k', 'r', 's'], fillEvery: 4, asleep: true };
  const source = cut => scene({ frames: 24, gravity: [0, 0], bodies: [blade, ball], strikes: [{ by: 'blade', power: 'split', count: 2, spread: 40, rest: 30, ...(cut && { cut }) }] }, { width: 64, height: 48 });
  const angle = ([x, y]) => Math.atan2(y + 0.5 - 24, x + 0.5 - 32) * 180 / Math.PI, radius = ([x, y]) => Math.hypot(x + 0.5 - 32, y + 0.5 - 24);
  const balls = frame => ['k', 'r', 's'].flatMap(key => keyCells(frame, key));
  const pushed = run(source());
  assert.ok(Math.max(...balls(pushed.recipe.frames[6]).map(angle)) > 40, 'pushed, the ball is swept ahead of the blade');
  const { recipe, effect } = run(source(0.5));
  assert.ok(effect.copies === 1 && effect.strikes === 1, `${effect.copies} copy from ${effect.strikes} strike`);
  assert.notDeepEqual(effect.paths.seed.at(-1).slice(0, 2), effect.paths.seed[0].slice(0, 2), 'the sleeping ball woke and moved off');
  for (let f = 6; f < 24; f++) {
    const cells = balls(recipe.frames[f]);
    assert.ok(cells.length && cells.every(c => angle(c) < 6 * f - 4 && angle(c) > -15), `frame ${f}: every piece behind the blade (${cells.map(c => angle(c).toFixed(0))} at ${6 * f}°)`);
    assert.ok(keyCells(recipe.frames[f], 'k').length === 0, `frame ${f}: the taker took its frame's colour with its copy`);
  }
  const last = balls(recipe.frames[23]).map(radius);
  assert.ok(Math.max(...last) - Math.min(...last) > 4, `the two pieces drift apart: ${Math.min(...last).toFixed(1)} to ${Math.max(...last).toFixed(1)} pixels out`);
  // The cutter is drawn over what it passes through: the blade's pixels are those it has alone.
  const alone = run(scene({ frames: 8, gravity: [0, 0], bodies: [blade] }, { width: 64, height: 48 })).recipe;
  for (let f = 3; f < 8; f++) assert.deepEqual(keyCells(recipe.frames[f], 'w'), keyCells(alone.frames[f], 'w'), `frame ${f}: the blade drawn whole`);
});

test('a pixel two bodies\' pictures claim is drawn for the body whose shape covers it, not the one drawn last', () => {
  // Two touching balls of radius 1.5 (3 × 3 pictures, which reach past their round shapes): the pixel both pictures
  // claim lies inside the first. Drawn later, the second was drawn over it.
  const grid = frame => frame.ops.find(op => op.op === 'grid'), at = (frame, x, y) => { const g = grid(frame); return g.rows[y - g.y][x - g.x]; };
  const two = run(scene({ frames: 2, gravity: [0, 0], bodies: [{ shape: 'circle', radius: 1.5, at: [12.4, 12.1], fill: 'r' }, { shape: 'circle', radius: 1.5, at: [10.2, 10], fill: 's' }] })).recipe;
  assert.equal(at(two.frames[0], 11, 11), 'r');
  // A pile of four rows of balls in four colours: no pixel is drawn in one colour where a ball of another lies deeper.
  // (Ten were, each row drawn over the bottoms of the row before.)
  const colours = ['k', 'r', 's', 'w'], f = 89;
  const { recipe, effect } = run(scene({ frames: 90, gravity: [0, 0.3], walls: ['left', 'right', 'top', 'bottom'], bodies: colours.map((fill, i) => ({ name: `row${i}`, shape: 'circle', radius: 1.5, at: [4 + i * 0.66, 4 + i * 3.3], grid: { count: [12, 1], step: [3.3, 0] }, fill, bounce: 0.2, friction: 0.3 })) }, { width: 44, height: 32 }));
  const balls = Object.entries(effect.paths).map(([name, p]) => ({ colour: colours[Number(name.match(/row(\d)/)[1])], x: p[f][0], y: p[f][1] }));
  const g = grid(recipe.frames[f]), wrong = [];
  g.rows.forEach((row, j) => [...row].forEach((c, i) => {
    if (c === '.') return;
    const px = g.x + i + 0.5, py = g.y + j + 0.5, depth = b => 1.5 - Math.hypot(px - b.x, py - b.y);
    const own = Math.max(...balls.filter(b => b.colour === c).map(depth)), other = Math.max(...balls.filter(b => b.colour !== c).map(depth));
    if (other > Math.max(own, 0) + 0.25) wrong.push([g.x + i, g.y + j]);
  }));
  assert.deepEqual(wrong, []);
});

test('a heavy body rests on light ones without sinking, and still ploughs through them', () => {
  const tall = { width: 48, height: 64 }, walls = ['left', 'right', 'bottom'];
  // A plank 50 times as dense as the three balls under it sank into them, was pushed out fast enough to bounce, and
  // hopped 6 pixels for ever; it now settles at once.
  const plank = run(scene({ frames: 200, gravity: [0, 0.3], walls, bodies: [{ shape: 'circle', radius: 2, at: [14, 62], grid: { count: [3, 1], step: [10, 0] }, fill: 'k' }, { name: 'plank', shape: 'box', size: [30, 3], at: [24, 58.5], density: 50, fill: 'w' }] }, tall)).effect;
  const heights = plank.paths.plank.slice(20).map(p => p[1]);
  assert.ok(plank.rest !== null && plank.rest < 30 && Math.max(...heights) - Math.min(...heights) < 0.05, `rest ${plank.rest}, heights ${Math.min(...heights)}–${Math.max(...heights)}`);
  // A box 100 times as dense as the box under it slid off it and fell; it stays on top.
  const boxes = run(scene({ frames: 200, gravity: [0, 0.3], walls, bodies: [{ name: 'light', shape: 'box', size: [8, 8], at: [24, 60], fill: 'k' }, { name: 'heavy', shape: 'box', size: [16, 6], at: [24, 53], density: 100, fill: 'w' }] }, tall)).effect;
  const [hx, hy] = boxes.paths.heavy.at(-1), [lx, ly] = boxes.paths.light.at(-1);
  assert.ok(Math.abs(hx - 24) < 0.5 && Math.abs(hy - 53) < 0.1 && Math.abs(lx - 24) < 0.5 && Math.abs(ly - 60) < 0.1 && boxes.rest !== null, `heavy at [${hx}, ${hy}], light at [${lx}, ${ly}], rest ${boxes.rest}`);
  // A heavy ball thrown into a pile of light balls shoves through it as before (it would be stopped and pushed back if
  // it were solved as lighter while it shoves).
  const plough = run(scene({ frames: 80, gravity: [0, 0.3], walls, bodies: [{ name: 'heavy', shape: 'circle', radius: 3, at: [8, 44], velocity: [3, 0], density: 50, friction: 0.2, fill: 'w' }, { shape: 'circle', radius: 1.5, at: [40, 46.5], grid: { count: [10, 3], step: [3, -3], stagger: 1.5 }, friction: 0.2, fill: 'k' }] }, { width: 96, height: 48 })).effect;
  assert.ok(plough.paths.heavy.at(-1)[0] > 70, `the heavy ball ends at ${plough.paths.heavy.at(-1)[0]}`);
});

test('a body knocked hard enough breaks into convex pieces that carry its whole picture, and they settle', () => {
  // A picture of 8 × 8 pixels, every one drawn, on a box dropped 30 pixels onto the floor.
  const checks = ['kwkwkwkw', 'wkwkwkwk', 'kwkwkwkw', 'wkwkwkwk', 'kwkwkwkw', 'wkwkwkwk', 'kwkwkwkw', 'wkwkwkwk'];
  const effect = { substeps: 8, iterations: 6, gravity: [0, 0.3], walls: { left: true, right: true, top: false, bottom: true }, obstacles: [], most: 256,
    bodies: readBodies([{ name: 'box', shape: 'box', size: [8, 8], at: [24, 10], angle: 20, density: 2, symbol: 'checks', breaks: { at: 2, pieces: 5 } }], 'bodies', { palette, symbols: { checks }, width: 48, height: 48, breakable: true }) };
  const world = createBodyWorld(effect, { width: 48, height: 48, symbols: { checks } });
  let f = 0;
  while (!world.stats.broken.length && f < 60) world.advance(++f);
  const [entry] = world.stats.broken, pieces = world.bodies.slice(1);
  assert.ok(entry && entry.body === 'box' && entry.pieces === pieces.length && pieces.length >= 3 && pieces.length <= 5 && world.bodies[0].gone, JSON.stringify(entry));
  // The pieces share out the box's area and mass, each is convex, and between them they carry every pixel of the picture.
  const area = part => { let a = 0; for (let i = 0; i < part.n; i++) { const j = (i + 1) % part.n; a += part.vx[i] * part.vy[j] - part.vy[i] * part.vx[j]; } return a / 2; };
  assert.ok(Math.abs(pieces.reduce((sum, p) => sum + area(p.parts[0]), 0) - 64) < 0.01, 'the pieces cover the box');
  assert.ok(Math.abs(pieces.reduce((sum, p) => sum + 1 / p.invMass, 0) - 128) < 0.01, 'and weigh what it did');
  for (const p of pieces) {
    const part = p.parts[0];
    for (let i = 0; i < part.n; i++) { const j = (i + 1) % part.n, k = (i + 2) % part.n; assert.ok((part.vx[j] - part.vx[i]) * (part.vy[k] - part.vy[j]) - (part.vy[j] - part.vy[i]) * (part.vx[k] - part.vx[j]) > 0, `${p.path} turns one way at every corner`); }
  }
  assert.equal(pieces.reduce((sum, p) => sum + p.rows.join('').replace(/\./g, '').length, 0), 64);
  for (; f < 200 && world.stats.rest === null; f++) world.advance(f + 1);
  assert.ok(world.stats.rest !== null, 'the pieces come to rest');
});

test('a knock breaks what it hits, as hard as it is hit, and not the row behind it', () => {
  const crates = extra => ({ name: 'crate', shape: 'box', size: [8, 8], at: [30, 44], grid: { count: [4, 1], step: [8, 0] }, asleep: true, density: 0.6, fill: 'w', outline: 'k', breaks: { at: 1.5, pieces: 4 }, ...extra });
  const throwAt = (density, speed) => run(scene({ frames: 40, gravity: [0, 0.2], walls: ['left', 'right', 'bottom'], bodies: [{ name: 'ball', shape: 'circle', radius: 3, at: [8, 44.9], velocity: [speed, 0], density, fill: 'r' }, crates()] }, { width: 72, height: 48 })).effect;
  // A heavy ball breaks the first crate. Measured by the pushes the solve passed on, all four broke in that frame.
  const heavy = throwAt(20, 4);
  assert.equal(heavy.broken[0].body, 'crate-0');
  assert.ok(heavy.broken.filter(entry => entry.frame === heavy.broken[0].frame).length < 4, JSON.stringify(heavy.broken));
  // A pebble as fast barely knocks a crate, and a slow ball not hard enough: none breaks.
  assert.equal(throwAt(0.05, 4).broken, undefined);
  assert.equal(throwAt(20, 0.8).broken, undefined);
});

test('a break power breaks a body on cue, a fixed one too, and a blade that cuts breaks what it touches', () => {
  // A fixed slab broken by an event at frame 10: its pieces fall to the floor.
  const slab = run(scene({ frames: 60, gravity: [0, 0.3], walls: ['bottom'], bodies: [{ name: 'slab', shape: 'box', size: [16, 6], at: [24, 10], fixed: true, fill: 'w', outline: 'k' }], events: [{ frame: 10, body: 'slab', power: 'break', count: 5 }] })).effect;
  assert.ok(slab.broken.length === 1 && slab.broken[0].frame === 10 && slab.broken[0].pieces >= 3, JSON.stringify(slab.broken));
  const grid = frame => frame.ops.find(op => op.op === 'grid');
  const { recipe } = run(scene({ frames: 60, gravity: [0, 0.3], walls: ['bottom'], bodies: [{ name: 'slab', shape: 'box', size: [16, 6], at: [24, 10], fixed: true, fill: 'w', outline: 'k' }], events: [{ frame: 10, body: 'slab', power: 'break', count: 5 }] }));
  assert.ok(grid(recipe.frames[59]).y > 20 && grid(recipe.frames[5]).y < 10, 'the pieces fell');
  // A turning blade whose strike is break (and cuts) breaks the balls it passes through.
  const blade = run(scene({ frames: 40, gravity: [0, 0], bodies: [{ name: 'blade', shape: 'box', size: [20, 2], pivot: [-10, 0], at: [24, 16], fixed: true, spin: 9, fill: 'w' }, { shape: 'box', size: [5, 5], at: [34, 22], grid: { count: [2, 1], step: [-6, 6] }, fill: 'r', outline: 'k' }], strikes: [{ by: 'blade', power: 'break', count: 4, cut: 0.5 }] })).effect;
  assert.equal(blade.broken.length, 2, JSON.stringify(blade.broken));
});

test('a match drawn frame by frame breaks a symbol body as the compiled recipe does', async () => {
  // bodiesFrames (pixelbolt sequence, pixel_compile's sequence) once built its world without the symbols, so the
  // crate-smash preset crashed when a crate broke.
  const source = JSON.parse(await readFile(path.join(root, 'examples', 'crate-smash.bodies.json'), 'utf8'));
  const frames = bodiesFrames(source), { recipe, metadata } = compileBodies(source), project = renderProject(recipe);
  assert.ok(metadata.effects['crate-smash'].broken.length > 1, 'crates break in the preset');
  for (let f = 0; f < frames.frames; f++) assert.ok(Buffer.from(frames.image(f)).equals(Buffer.from(project.frames[f].data)), `frame ${f}`);
});

test('breaking is read strictly', () => {
  const box = { name: 'box', shape: 'box', size: [8, 8], at: [24, 16], fill: 'w' };
  refused(scene({ bodies: [{ ...box, fixed: true, breaks: {} }] }), 'bodies.effects.e.bodies[0].breaks', /event whose power is break/);
  refused(scene({ bodies: [{ shape: 'hoop', fixed: true, radius: 10, at: [24, 16], fill: 'w', breaks: {} }] }), 'bodies.effects.e.bodies[0].breaks', /does not break/);
  refused(scene({ bodies: [{ name: 'ring', shape: 'hoop', fixed: true, radius: 10, at: [24, 16], fill: 'w' }], events: [{ frame: 3, body: 'ring', power: 'break' }] }), 'bodies.effects.e.events[0].power', /hoop.*does not break/);
  refused(scene({ bodies: [{ ...box, size: [1, 2], breaks: {} }] }), 'bodies.effects.e.bodies[0].breaks', /too small/);
  refused(scene({ bodies: [{ ...box, breaks: { pieces: 1 } }] }), 'bodies.effects.e.bodies[0].breaks.pieces', /from 2 to 16/);
  refused(scene({ bodies: [{ ...box, breaks: { at: 3, chips: 4 } }] }), 'bodies.effects.e.bodies[0].breaks.chips', /unknown/);
  refused(scene({ bodies: [box], events: [{ frame: 3, body: 'box', power: 'break', count: 9 }] }), 'bodies.effects.e.events[0].count', /from 2 to 8/);
});

test('by default every body that breaks has room for its pieces, and a crowd at most says what it cut short', () => {
  const rain = most => ({ format: 'pixelforge-bodies', version: 1, name: 'b', width: 128, height: 64, palette: { w: '#ffffff', k: '#000000' }, effects: { e: { frames: 40, gravity: [0, 0.6], walls: ['left', 'right', 'bottom'], ...(most && { most }), bodies: [{ shape: 'box', size: [6, 6], at: [8, 4], velocity: [0, 4], fill: 'w', outline: 'k', grid: { count: [16, 4], step: [7, 8] }, breaks: { at: 0.5, pieces: 6 } }] } } });
  const free = compileBodies(rain());
  assert.equal(free.metadata.effects.e.broken.length, 64);
  assert.equal(free.warnings, undefined);
  const capped = compileBodies(rain(200));
  assert.ok(capped.metadata.effects.e.broken.length < 64);
  assert.ok(capped.warnings.some(warning => /^bodies\.effects\.e\.most: \d+ bodies broke into fewer pieces than asked, or not at all, because the effect holds at most 200 bodies; raise most$/.test(warning)), capped.warnings.join('\n'));
});

test('the work estimate charges fixed bodies that events break as the free pieces they become', () => {
  // 64 fixed slabs, each broken by an event into 8 pieces that bounce for 255 frames: the pieces were free of charge,
  // so this ran for a minute, past MCP's time limit, instead of being refused up front.
  const bodies = [], events = [];
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
    bodies.push({ name: `s${i}_${j}`, shape: 'box', size: [15, 15], at: [8 + i * 16, 8 + j * 16], fixed: true, fill: 'w', outline: 'k', bounce: 1, friction: 0 });
    events.push({ frame: 1, body: `s${i}_${j}`, power: 'break', count: 8 });
  }
  const source = { format: 'pixelforge-bodies', version: 1, name: 'fb', width: 128, height: 128, palette: { k: '#000000', w: '#ffffff' }, effects: { e: { frames: 256, substeps: 16, iterations: 16, gravity: [0, 0], walls: ['left', 'right', 'top', 'bottom'], most: 4096, bodies, events } } };
  assert.throws(() => compileBodies(source), error => error instanceof PixelError && /the simulations need about \d+ million updates, more than 400 million/.test(error.message));
});

test('the work estimate charges the crowd a strike can make and a smear\'s sweep', () => {
  // 4,096 balls of radius 0.5 over 256 frames would run for minutes; the same source left at the default 256 runs.
  const crowd = most => scene({ frames: 256, bodies: [{ name: 'blade', shape: 'box', size: [40, 2], at: [24, 16], fixed: true, spin: 6, fill: 'w' }, { shape: 'circle', radius: 0.5, at: [24, 4], fill: 'k' }],
    walls: ['left', 'right', 'top', 'bottom'], ...(most && { most }), strikes: [{ by: 'blade', power: 'split', count: 8 }] }, { width: 48, height: 32 });
  refused(crowd(4096), 'bodies.effects.e', /need about \d+ million updates, more than 400 million/);
  assert.ok(run(crowd()).effect.frames === 256);
});
