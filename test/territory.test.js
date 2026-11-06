import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, PixelError, createSequence, createBodiesSequence } from '../src/index.js';
import { compileBodies } from '../src/bodies.js';
import { startMCP } from '../src/mcp.js';

// Territory, held speed and powers for pixelforge-bodies (docs/physics-model.md, section 13a).
const root = fileURLToPath(new URL('../', import.meta.url));
const palette = { n: '#1d3557', a: '#f4a259', w: '#ffffff', k: '#000000', p: '#e63973' };
const board = { cell: 4, split: 'columns', teams: [{ name: 'tide', color: 'n' }, { name: 'ember', color: 'a' }] };
const match = (effect, extra = {}) => ({ format: 'pixelforge-bodies', version: 1, name: 'match', width: 32, height: 32, palette, ...extra,
  effects: { m: { frames: 60, gravity: [0, 0], walls: ['left', 'right', 'top', 'bottom'], ...effect } } });
const ball = (name, at, velocity, extra = {}) => ({ name, shape: 'circle', radius: 1.5, at, velocity, speed: Math.hypot(...velocity), bounce: 1, friction: 0, fill: 'w', ...extra });
const figures = source => Object.values(compileBodies(source).metadata.effects)[0];
const refused = (source, where, pattern) => assert.throws(() => compileBodies(source), error => error instanceof PixelError && error.path === where && pattern.test(error.message), where);
const step = (p, k) => Math.hypot(p[k + 1][0] - p[k][0], p[k + 1][1] - p[k][1]);

test('territory sources are read strictly, with the fix in each message', () => {
  const base = (effect, bodies = [ball('b', [8, 16], [1, 0], { team: 'tide' })]) => match({ territory: board, bodies, ...effect });
  refused(match({ bodies: [ball('b', [8, 8], [1, 0], { team: 'tide' })] }), 'bodies.effects.m.bodies[0].team', /goes with a territory/);
  refused(base({}, [ball('b', [8, 16], [1, 0], { team: 'moss' })]), 'bodies.effects.m.bodies[0].team', /no team is named "moss"/);
  refused(base({}, [{ shape: 'box', size: [4, 4], at: [8, 8], fixed: true, speed: 2, fill: 'w' }]), 'bodies.effects.m.bodies[0].speed', /fixed/);
  refused(base({ territory: { ...board, teams: [{ name: 'tide', color: 'n' }, { name: 'ember', color: 'n' }] } }), 'bodies.effects.m.territory.teams[1].color', /share the colour/);
  refused(base({ territory: { cell: 4, teams: board.teams, rows: ['nnx'] } }), 'bodies.effects.m.territory.rows[0]', /no team's colour/);
  refused(base({ territory: { cell: 4, teams: board.teams } }), 'bodies.effects.m.territory', /rows .* or split/);
  refused(base({ territory: { ...board, cell: 8, size: [8, 8] } }), 'bodies.effects.m.territory', /reach past/);
  refused(base({ hud: [{ text: '{moss}', at: [0, 0], color: 'w' }] }), 'bodies.effects.m.hud[0].text', /isn't a heads-up word/);
  refused(match({ bodies: [ball('b', [8, 8], [1, 0])], hud: [{ text: 'x', at: [0, 0], color: 'w' }] }), 'bodies.effects.m.hud', /give the effect a territory/);
  refused(base({ pickups: [{ at: [4, 4], power: 'warp' }] }), 'bodies.effects.m.pickups[0].to', /needs a place/);
  refused(base({ pickups: [{ at: [4, 4], power: 'split', scale: 2 }] }), 'bodies.effects.m.pickups[0].scale', /goes with grow/);
  refused(base({ events: [{ frame: 3, body: 'nobody', power: 'grow' }] }), 'bodies.effects.m.events[0].body', /no body is named/);
  refused(base({ frames: 300 }), 'bodies.effects.m.frames', /pixelbolt sequence/);
});

test('a team\'s ball passes its own cells and claims each of the others\' it hits; a ball with no team stays in the open', () => {
  const run = figures(match({ territory: board, bodies: [ball('tide', [8, 13], [2, 0.7], { team: 'tide' })] }));
  const { counts, flips } = run.territory, [first] = counts;
  assert.deepEqual(first, [32, 32]);
  assert.ok(counts.every(([t, e]) => t + e === 64), 'cells change hands, never vanish');
  assert.ok(counts.every(([t], k) => !k || t >= counts[k - 1][0]), 'only tide claims cells');
  assert.ok(flips >= 2 && counts.at(-1)[0] === 32 + flips, `the tide ball claims a cell at every hit: ${flips}`);
  // A ball with no team meets every owned cell: in a hole of four by four cells it stays inside and claims nothing.
  const rows = ['nnnnnnnn', 'nnnnnnnn', 'nn....aa', 'nn....aa', 'nn....aa', 'nn....aa', 'aaaaaaaa', 'aaaaaaaa'];
  const hole = figures(match({ territory: { cell: 4, teams: board.teams, rows }, bodies: [ball('free', [16, 16], [1.6, 1.1])] }));
  assert.equal(hole.territory.flips, 0);
  assert.ok(hole.paths.free.every(([x, y]) => x > 9 && x < 23 && y > 9 && y < 23), 'it bounces about inside the hole');
});

test('a held speed keeps a body at it, under gravity and through every bounce', () => {
  const p = figures(match({ gravity: [0, 0.1], walls: ['left', 'right', 'top', 'bottom'], bodies: [ball('ball', [16, 16], [1.2, -0.9])] }, { width: 64, height: 48 })).paths.ball;
  const free = Array.from({ length: 12 }, (_, k) => step(p, k + 1));
  assert.ok(free.every(d => Math.abs(d - 1.5) < 0.03), `1.5 pixels a frame in flight: ${free.map(d => d.toFixed(2)).join(' ')}`);
  const late = Array.from({ length: 10 }, (_, k) => step(p, 48 + k));
  assert.ok(Math.max(...late) < 1.53 && late.filter(d => d > 1.45).length >= 7, `and after many bounces: ${late.map(d => d.toFixed(2)).join(' ')}`);
});

test('powers: split, grow, speed, warp and magnet, from pickups and events', () => {
  const pixels = source => figures(source).pixels;
  // Split: the first ball to reach the pickup becomes three, turned apart.
  const split = figures(match({ bodies: [ball('ball', [6, 16], [1.5, 0])], pickups: [{ at: [16, 16], power: 'split' }], frames: 40 }));
  assert.deepEqual(split.powers.map(p => [p.body, p.power, p.copies]), [['ball', 'split', 2]]);
  assert.ok(split.pixels.at(-1) === 3 * split.pixels[0], `three balls by the end: ${split.pixels[0]} → ${split.pixels.at(-1)} pixels`);
  // Grow: a ball four pixels across is drawn about twice as wide for ten frames, then shrinks back.
  const grown = pixels(match({ bodies: [ball('ball', [16, 16], [0.2, 0], { radius: 2 })], events: [{ frame: 4, body: 'ball', power: 'grow', frames: 10 }], frames: 24 }));
  assert.ok(grown[8] >= 3 * grown[2] && grown[20] === grown[2], `grown ${grown[2]} → ${grown[8]} → ${grown[20]}`);
  // Speed: a held speed doubled for ten frames, then back.
  const fast = figures(match({ bodies: [ball('ball', [4, 4], [1, 0.5])], events: [{ frame: 3, body: 'ball', power: 'speed', factor: 2, frames: 10 }], frames: 20, walls: [] }, { width: 96, height: 96 })).paths.ball;
  assert.ok(Math.abs(step(fast, 1) - Math.hypot(1, 0.5)) < 0.02 && Math.abs(step(fast, 6) - 2 * Math.hypot(1, 0.5)) < 0.02 && Math.abs(step(fast, 16) - Math.hypot(1, 0.5)) < 0.02, 'held speed ×2 and back');
  // Warp: moved at the end of the event's frame.
  const warped = figures(match({ bodies: [ball('ball', [6, 6], [0.5, 0])], events: [{ frame: 5, body: 'ball', power: 'warp', to: [24, 24] }], frames: 8 })).paths.ball;
  assert.deepEqual(warped[5].slice(0, 2), [24, 24]);
  // Magnet: a tide ball's magnet pulls the ember ball toward its point, not the tide ball.
  const pull = magnet => figures(match({ territory: { ...board, rows: ['........'].concat(Array(7).fill('........')), split: undefined }, walls: [], frames: 30,
    bodies: [ball('tide', [4, 4], [0.5, 0], { team: 'tide' }), ball('ember', [4, 28], [1, 0], { team: 'ember' })],
    events: magnet ? [{ frame: 1, body: 'tide', power: 'magnet', to: [28, 4], strength: 0.1, frames: 40 }] : [] }, { width: 96, height: 64 })).paths;
  const near = paths => Math.hypot(paths.ember.at(-1)[0] - 28, paths.ember.at(-1)[1] - 4);
  assert.ok(near(pull(true)) < near(pull(false)) - 8, `drawn toward the point: ${near(pull(true)).toFixed(1)} against ${near(pull(false)).toFixed(1)}`);
  assert.deepEqual(pull(true).tide, pull(false).tide, 'the taker\'s own team is left alone');
});

test('the heads-up display draws the score, a share bar, the latest power and the leader', () => {
  const { recipe } = compileBodies(match({ territory: board, frames: 40, bodies: [ball('tide', [8, 13], [2, 0.7], { team: 'tide' })],
    pickups: [{ at: [13, 16], power: 'speed', label: 'RUSH', color: 'p', factor: 1.2, frames: 5 }],
    hud: [{ bar: { at: [0, 30], size: [32, 2] } }, { text: '{tide}:{ember} {tide%}', at: [1, 1], color: 'w' }, { text: '{news}', at: [16, 10], color: 'w', align: 'center', back: 'k', news: 6 }, { text: '{leader}', at: [16, 20], color: 'w', align: 'center', from: 38 }] }));
  const ops = name => recipe.frames.find(frame => frame.name === name).ops;
  const texts = name => ops(name).filter(op => op.op === 'text').map(op => op.text);
  assert.deepEqual(texts('m-0'), ['32:32 50%']);
  const bars = ops('m-0').filter(op => op.op === 'rect' && op.y === 30);
  assert.deepEqual(bars.map(op => [op.x, op.w, op.color]), [[0, 16, 'n'], [16, 16, 'a']]);
  const taken = recipe.frames.findIndex(frame => frame.ops.some(op => op.text === 'RUSH'));
  assert.ok(taken > 0 && recipe.frames.slice(taken, taken + 6).every(frame => frame.ops.some(op => op.text === 'RUSH')) && !recipe.frames[taken + 6].ops.some(op => op.text === 'RUSH'), 'the news shows for its frames');
  assert.ok(ops('m-39').some(op => op.text === 'TIDE') && !ops('m-37').some(op => op.text === 'TIDE'), 'the leader from frame 38');
  renderProject(recipe);
});

test('a long match goes out as numbered video frames, and a short one matches its recipe frame for frame', async t => {
  const long = match({ territory: board, frames: 300, duration: 40, bodies: [ball('tide', [8, 13], [2, 0.7], { team: 'tide' })] });
  const sequence = createBodiesSequence(long, { fps: 25 });
  assert.deepEqual([sequence.info.frames, sequence.info.figures.frames, sequence.info.loop.plays], [300, 300, 'once']);
  assert.ok(sequence.info.figures.territory.flips > 0 && sequence.info.figures.territory.counts.length === 300);
  const short = match({ territory: board, frames: 30, duration: 40, bodies: [ball('tide', [8, 13], [2, 0.7], { team: 'tide' })] });
  const direct = createBodiesSequence(short, { fps: 25, scale: 2 }), recipe = createSequence(renderProject(compileBodies(short).recipe), { fps: 25, scale: 2 });
  const pngs = files => [...files].filter(([name]) => name.endsWith('.png'));
  assert.deepEqual(pngs(direct.files).map(([name, bytes]) => [name, bytes.toString('base64')]), pngs(recipe.files).map(([name, bytes]) => [name, bytes.toString('base64')]));
  // From the CLI and MCP.
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-territory-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'long.bodies.json');
  await writeFile(file, JSON.stringify(long));
  const cli = spawnSync(process.execPath, [path.join(root, 'bin/pixelbolt.js'), 'sequence', file, '--out', path.join(dir, 'frames'), '--fps', '25'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal((await readdir(path.join(dir, 'frames'))).filter(name => name.endsWith('.png')).length, 300);
  const input = new PassThrough(), output = new PassThrough(), waiting = new Map();
  let id = 0, buffered = '';
  output.on('data', chunk => { buffered += chunk; let at; while ((at = buffered.indexOf('\n')) >= 0) { const line = buffered.slice(0, at); buffered = buffered.slice(at + 1); if (line.trim()) { const message = JSON.parse(line); waiting.get(message.id)?.(message); } } });
  startMCP({ input, output, root: dir, directory: dir }); t.after(() => input.end());
  const call = (method, params) => new Promise(resolve => { waiting.set(++id, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'territory-test', version: '1' } });
  const written = JSON.parse((await call('tools/call', { name: 'pixel_compile', arguments: { source: long, sequence: { fps: 25 } } })).result.content[0].text);
  assert.deepEqual([written.ok, written.sequence.frames, written.figures.frames], [true, 300, 300]);
  assert.equal((await readdir(path.join(written.directory, 'sequence'))).filter(name => name.endsWith('.png')).length, 300);
  const wrong = await call('tools/call', { name: 'pixel_compile', arguments: { preset: 'smoke-puff', sequence: { fps: 25 } } });
  assert.match(wrong.result.content[0].text, /pixelforge-bodies match/);
});

test('drawn finer (subpixels), the cells, pickups and score are drawn in blocks that size', () => {
  // A body off the canvas, so only the territory, a waiting pickup and the heads-up display are drawn.
  const source = n => ({ ...match({ territory: board, frames: 2, walls: [], bodies: [ball('away', [-200, -200], [0, 0.5])],
    pickups: [{ at: [10, 10], power: 'grow', color: 'p' }], hud: [{ bar: { at: [2, 28], size: [28, 2] } }, { text: '{tide}', at: [16, 8], color: 'w', align: 'center', back: 'k' }] }), ...(n > 1 && { subpixels: n }) });
  const frame = n => { const project = renderProject(compileBodies(source(n)).recipe); return { data: project.frames[0].data, width: project.width, height: project.height }; };
  const whole = frame(1), fine = frame(2);
  assert.deepEqual([fine.width, fine.height], [64, 64]);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const a = ((y >> 1) * 32 + (x >> 1)) * 4, b = (y * 64 + x) * 4;
    assert.deepEqual([...fine.data.subarray(b, b + 4)], [...whole.data.subarray(a, a + 4)], `pixel ${x},${y}`);
  }
});

test('what the renderer or a sequence would refuse is refused before simulating, and a tall board warps into its lower half', () => {
  // A warp or magnet target: x within the width, y within the height.
  const tall = { ...match({ territory: board, bodies: [ball('b', [8, 16], [1, 0], { team: 'tide' })], events: [{ frame: 5, body: 'b', power: 'warp', to: [16, 80] }] }), height: 96 };
  assert.equal(figures(tall).frames, 60);
  refused({ ...tall, effects: { m: { ...tall.effects.m, events: [{ frame: 5, body: 'b', power: 'warp', to: [16, 200] }] } } }, 'bodies.effects.m.events[0].to[1]', /from -96 to 192/);
  // The heads-up display fits the renderer drawn finer: its scale times subpixels at most 16, its bar at most 512 wide.
  const hud = (entry, subpixels) => match({ territory: board, bodies: [ball('b', [8, 16], [1, 0], { team: 'tide' })], hud: [entry] }, { subpixels });
  refused(hud({ text: '{tide}', at: [1, 1], color: 'w', scale: 3 }, 8), 'bodies.effects.m.hud[0].scale', /from 1 to 2/);
  refused(hud({ bar: { at: [0, 0], size: [100, 2] } }, 8), 'bodies.effects.m.hud[0].bar.size[0]', /from 1 to 64/);
  assert.equal(figures(hud({ text: '{tide}', at: [1, 1], color: 'w', scale: 2 }, 8)).frames, 60);
  // Too many frames' pixels for a recipe, at whole pixels too.
  refused({ ...match({ bodies: [ball('b', [8, 16], [1, 0])] }), width: 256, height: 256, effects: { m: { frames: 65, gravity: [0, 0], bodies: [ball('b', [8, 16], [1, 0])] } } }, 'bodies.effects', /4,194,304.*fewer frames or a smaller canvas/);
  // A match longer than a sequence holds at its size is refused before it is simulated.
  const long = match({ frames: 2200, duration: 34, territory: board, bodies: [ball('b', [8, 16], [1, 0], { team: 'tide' })] });
  assert.throws(() => createBodiesSequence(long, { fps: 30, size: 'vertical' }), error => error instanceof PixelError && /holds at most 2071 at that size/.test(error.message));
});
