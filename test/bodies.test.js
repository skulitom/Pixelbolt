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
import { compileBodies, createBodyWorld, readBodies, drawBodies } from '../src/bodies.js';
import { cosDeg, sinDeg } from '../src/craft.js';
import { startMCP } from '../src/mcp.js';
import { packageFiles } from '../scripts/build-studio.mjs';
import { bodiesPresets } from '../scripts/bodies-presets.mjs';
import { BODIES_SHOWCASE, buildBodiesGIFs } from '../showcase/bodies/build.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const GOLDEN = {
  'ring-escape': '74e2c36fa2b6f1c05b931ebef0556342c970dd4192185632d5c4a69185fed3ea', 'bouncing-pixel': '444ad867ec4c01600cd5560353ba9e6fef9ad6a9fddd02464bf3124d2349f5bd', 'spinning-hoop': 'f8b94600b5e6a477c6146849bf738df1494adfad699c74d92ebd182a12a5ce73', 'crate-topple': '46fc517bbc175daea132767549d92a5076b8af580ce9c2e300098c1e4cbf427d', territory: '450d73ed85a146aa6f5363a98d0504cd8d620beaa44fafd3502fc79c9dfce857'
};
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
  const pixel = run(bodiesPresets['bouncing-pixel']).effect;
  assert.ok(pixel.rest !== null && pixel.hits >= 8, `the pixel bounced ${pixel.hits} times and rests from ${pixel.rest}`);
  const crates = run(bodiesPresets['crate-topple']).effect;
  assert.ok(crates.rest !== null, 'the crates come to rest');
  // The hoop's centre is [36, 30] and its radius 24: a ball past 27 from the centre is out.
  const hoop = run(bodiesPresets['spinning-hoop']).effect, out = name => hoop.paths[name].some(([x, y]) => (x - 36) ** 2 + (y - 30) ** 2 > 27 * 27);
  assert.ok(['red', 'yellow', 'green'].filter(out).length >= 2, 'at least two balls found the gap and fell out of the hoop');
});

test('every rigid-body example compiles to its golden recipe and draws only palette keys', async () => {
  for (const name of BODIES_SHOWCASE) {
    const source = await example(name);
    assert.deepEqual(source, JSON.parse(JSON.stringify(bodiesPresets[name])), `examples/${name}.bodies.json is stale; run node scripts/generate-examples.js`);
    const { recipe } = compileBodies(source);
    assert.equal(sha(recipe), GOLDEN[name], `${name} compiled differently; if the change is intended, update GOLDEN and rebuild the GIFs`);
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
  // Sliding at a fixed angle, it moves a fine pixel at a time and its picture never changes.
  const slide = crate(3), start = cells(slide.draw(10, 12, 20));
  for (let f = 1; f <= 30; f++) {
    const op = slide.draw(10 + f / 9, 12, 20), shift = Math.floor(f / 3), moved = new Map([...start].map(([key, ch]) => { const [x, y] = key.split(',').map(Number); return [`${x + shift},${y}`, ch]; }));
    assert.deepEqual(cells(op), moved, `frame ${f}: the same picture, ${shift} fine pixels on`);
  }
  // Spinning, it is drawn at its own angle every frame: evenly turned, never held back.
  const spin = crate(3, 4.5), turned = [];
  for (let f = 0; f < 8; f++) turned.push(JSON.stringify(spin.draw(16, 12, 4.5 * f)));
  assert.equal(new Set(turned).size, 8, 'a new picture every frame');
  for (let f = 0; f < 8; f++) assert.equal(turned[f], JSON.stringify(crate(3, 4.5).draw(16, 12, 4.5 * f)), `frame ${f} is drawn at exactly its angle, as a body first drawn there is`);
});
