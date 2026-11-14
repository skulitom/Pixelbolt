import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, PixelError, createSequence, createBodiesSequence } from '../src/index.js';
import { compileBodies, bodiesFrames } from '../src/bodies.js';
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
  // At the match's own size: enlarged, the ball is drawn at the larger pixels (test/bodies-frames.test.js).
  const direct = createBodiesSequence(short, { fps: 25 }), recipe = createSequence(renderProject(compileBodies(short).recipe), { fps: 25 });
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
  // The command line writes each frame as it is made; what it writes is what MCP, making them all first, writes.
  for (const name of await readdir(path.join(dir, 'frames'))) assert.ok((await readFile(path.join(dir, 'frames', name))).equals(await readFile(path.join(written.directory, 'sequence', name))), name);
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
  assert.throws(() => createBodiesSequence(long, { fps: 30, size: 'vertical' }), error => error instanceof PixelError && /holds at most 2071 at that size.*pixelbolt sequence/.test(error.message));
  // Streamed, as the command line writes it, nothing is made until it is written, a frame at a time, and nothing caps it:
  // every frame's PNG kept, this match passed the 4,294,967,296 pixels a sequence held.
  const streamed = createBodiesSequence(long, { fps: 30, size: 'vertical' }, { stream: true }), files = [...streamed.files];
  assert.equal(streamed.info.frames, 2244);
  assert.ok(files.every(([, bytes]) => typeof bytes === 'function') && files.length === 2246);
  assert.equal(streamed.info.figures, undefined, 'the match has not run');
  // Video frames 0 and 1 show the match's frame 0 (34 ms at 30 frames a second), made once; the ball has moved by frame 60.
  const first = files[0][1](), again = files[1][1](), later = files[60][1]();
  assert.ok(first.subarray(1, 4).equals(Buffer.from('PNG')));
  assert.equal(again, first);
  assert.ok(!later.equals(first));
});

// The pieces of colour `key` in a frame's grid (8-connected), as their centres.
const blobs = (frame, key) => {
  const grid = frame.ops.find(op => op.op === 'grid'), on = new Set();
  grid.rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === key) on.add(`${grid.x + i},${grid.y + j}`); });
  const out = [];
  for (const start of on) {
    if (!on.has(start)) continue;
    const stack = [start], cells = [];
    on.delete(start);
    while (stack.length) {
      const [x, y] = stack.pop().split(',').map(Number);
      cells.push([x, y]);
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (on.has(`${x + i},${y + j}`)) { on.delete(`${x + i},${y + j}`); stack.push(`${x + i},${y + j}`); }
    }
    out.push([cells.reduce((s, [x]) => s + x + 0.5, 0) / cells.length, cells.reduce((s, [, y]) => s + y + 0.5, 0) / cells.length]);
  }
  return out;
};

test('a split\'s copies fly off along their own headings, a warped ball takes the ground it lands on, and a ball meeting a wall at a glance bounces off it', () => {
  // Made on their taker, the copies were pushed apart along y, whatever their headings: a ball falling down the board
  // split into balls that kept falling one behind another.
  const source = match({ walls: [], bodies: [ball('ball', [32, 6], [0, 1.5])], pickups: [{ at: [32, 12], power: 'split', count: 5, spread: 20 }], frames: 24 }, { width: 64, height: 64 });
  const { recipe, metadata } = compileBodies(source), split = Object.values(metadata.effects)[0], taken = split.powers[0].frame, [sx, sy] = split.paths.ball[taken];
  const headings = blobs(recipe.frames.at(-1), 'w').map(([x, y]) => Math.atan2(y - sy, x - sx) * 180 / Math.PI).sort((a, b) => a - b);
  assert.equal(headings.length, 5, `five balls: ${headings.map(h => h.toFixed(1)).join(', ')}`);
  headings.forEach((a, k) => assert.ok(Math.abs(a - (90 + (k - 2) * 20)) < 3, `headings ${headings.map(h => h.toFixed(1)).join(', ')}`));
  // Warped into ember ground, a tide ball takes the cells it lands on, and its trail doesn't streak across the board (it
  // flew on through the ember ground unmet, walls all round it, until it burst out from behind a face).
  const warpSource = match({ territory: board, bodies: [ball('tide', [6, 16], [1, 0.4], { team: 'tide', trail: { color: 'p', length: 3 } })], events: [{ frame: 4, body: 'tide', power: 'warp', to: [26, 16] }], frames: 8 });
  const warped = compileBodies(warpSource), counts = Object.values(warped.metadata.effects)[0].territory.counts;
  assert.ok(counts[4][0] >= counts[3][0] + 2, `the landing's cells change hands: ${counts[3]} → ${counts[4]}`);
  for (const frame of warped.recipe.frames.slice(5)) for (const [x] of blobs(frame, 'p')) assert.ok(x > 20, `${frame.name}: no trail back where it was (${x})`);
  // Met at a glance, too slowly across to count as a hit, a wall left a held-speed ball sliding along it for good.
  const glance = figures(match({ walls: ['top', 'bottom'], bodies: [ball('ball', [4, 3], [3, -0.1])], frames: 60 }, { width: 256, height: 32 })).paths.ball;
  assert.ok(glance.at(-1)[1] > 2.5, `it leaves the wall: ${glance.slice(-3).map(p => p[1]).join(' ')}`);
});

test('drawn finer, the share bar ends each team\'s part on a world pixel', () => {
  const { recipe } = compileBodies(match({ territory: board, frames: 60, bodies: [ball('tide', [8, 13], [2, 0.7], { team: 'tide' })], hud: [{ bar: { at: [0, 30], size: [32, 2] } }] }, { subpixels: 2 }));
  for (const frame of recipe.frames) for (const op of frame.ops.filter(op => op.op === 'rect')) assert.ok(op.x % 2 === 0 && op.w % 2 === 0, `${frame.name}: a part from ${op.x / 2} across ${op.w / 2} world pixels`);
});

test('a power wakes the sleeping body it moves or reshapes, and what rests on it', () => {
  // Bodies under gravity that have come to rest and fallen asleep by frame 60, when the event fires. Asleep, the taker
  // took the power and nothing else happened: it hung where it was warped to, stayed sunk in the floor it grew into,
  // and its copies sat on it.
  const rest = (bodies, events, frames = 140) => figures(match({ gravity: [0, 0.3], walls: ['left', 'right', 'bottom'], frames, bodies, events }, { width: 48 }));
  const box = (name, size, at) => ({ name, shape: 'box', size, at, bounce: 0, fill: 'w' });
  const round = (name, at, extra = {}) => ({ name, shape: 'circle', radius: 2, at, bounce: 0, fill: 'w', ...extra });
  // Warp: the box under a stack is taken away. It falls where it lands, and the box it held up falls too, as it does
  // when the lower one vanishes.
  const stack = [box('lower', [8, 6], [16, 29]), box('upper', [6, 6], [16, 23])];
  const warped = rest(stack, [{ frame: 60, body: 'lower', power: 'warp', to: [38, 10] }]).paths, gone = rest(stack, [{ frame: 60, body: 'lower', power: 'vanish' }]).paths;
  assert.deepEqual(warped.upper[59].slice(0, 2), [16, 23]);
  assert.deepEqual(warped.lower[60].slice(0, 2), [38, 10]);
  assert.ok(Math.abs(warped.lower.at(-1)[1] - 29) < 0.1, `the warped box falls to the floor: ${warped.lower.at(-1)}`);
  assert.ok(Math.abs(warped.upper.at(-1)[1] - 29) < 0.1, `the box it held up falls: ${warped.upper.at(-1)}`);
  assert.deepEqual(warped.upper, gone.upper, 'as when the lower box vanishes');
  // Grow: a ball asleep on the floor beside another grows into both. They part, and it stands on the floor at its new
  // size, then on the floor again when it shrinks back.
  const grown = rest([round('a', [20, 28]), round('b', [25, 28])], [{ frame: 60, body: 'a', power: 'grow', scale: 2, frames: 40 }]).paths;
  assert.ok(Math.abs(grown.a[95][1] - 28) < 0.1 && grown.b[95][0] - grown.a[95][0] > 5.5, `grown, it stands on the floor clear of its neighbour: ${grown.a[95]} ${grown.b[95]}`);
  assert.ok(Math.abs(grown.a.at(-1)[1] - 30) < 0.1, `and comes back down when it shrinks: ${grown.a.at(-1)}`);
  // A ball that fell asleep while grown is on the floor again once it shrinks: it hung 2 pixels over it.
  const shrunk = rest([round('ball', [24, 20])], [{ frame: 2, body: 'ball', power: 'grow', scale: 2, frames: 60 }]).paths.ball;
  assert.ok(Math.abs(shrunk[50][1] - 28) < 0.1 && Math.abs(shrunk.at(-1)[1] - 30) < 0.1, `${shrunk[50]} then ${shrunk.at(-1)}`);
  // Split: the copies of a ball asleep on the floor come apart.
  const split = rest([round('ball', [24, 28])], [{ frame: 60, body: 'ball', power: 'split', count: 3 }]);
  assert.equal(split.pixels.at(-1), 3 * split.pixels[59], `three balls show: ${split.pixels[59]} to ${split.pixels.at(-1)} pixels`);
  // Magnet: one over a ball asleep on the floor lifts it, and lets it fall when it stops.
  const lifted = rest([round('ball', [24, 28]), round('other', [4, 28])], [{ frame: 60, body: 'other', power: 'magnet', to: [24, 4], strength: 1, frames: 40 }], 180).paths.ball;
  const highest = Math.min(...lifted.slice(60, 100).map(q => q[1]));
  assert.ok(Math.abs(lifted[59][1] - 30) < 0.1 && highest < 12, `lifted from ${lifted[59]} to ${highest}`);
  assert.ok(Math.abs(lifted.at(-1)[1] - 30) < 0.1, `and back on the floor after it: ${lifted.at(-1)}`);
});

test('a tireless body keeps what a power gives it', () => {
  // What a tireless body keeps was set once, when it was made, and every hit set it back: a speed power lasted until the
  // next bounce, and a warped ball went on bouncing to the height it was dropped from.
  const free = (name, at, velocity, extra = {}) => ({ name, shape: 'circle', radius: 1.5, at, velocity, bounce: 1, friction: 0, fill: 'w', ...extra });
  const speeds = tireless => { const { ball: p } = figures(match({ frames: 60, bodies: [free('ball', [6, 16], [1, 0], { tireless })], events: [{ frame: 5, body: 'ball', power: 'speed', factor: 2 }] })).paths; return [step(p, 2), step(p, 8), step(p, 50)]; };
  assert.deepEqual(speeds(true).map(v => Math.round(v * 100) / 100), [1, 2, 2], 'twice as fast after the walls as before them');
  assert.deepEqual(speeds(true), speeds(false));
  // Dropped from y = 14 and warped at frame 60: the bounces after it reach the height the warp left it able to reach
  // (about where it was put), every time, not the height it was dropped from.
  const apex = to => {
    const p = figures(match({ gravity: [0, 0.3], frames: 220, bodies: [free('ball', [16, 14], [0, 0], { tireless: true })], events: [{ frame: 60, body: 'ball', power: 'warp', to }] })).paths.ball;
    const top = (from, until) => Math.min(...p.slice(from, until).map(q => q[1]));
    return [top(0, 60), top(100, 160), top(160, 220)];
  };
  for (const y of [5, 24]) {
    const [before, after, later] = apex([16, y]);
    assert.ok(Math.abs(before - 14) < 0.3 && Math.abs(after - y) < 2 && Math.abs(later - after) < 0.3, `warped to ${y}: bounces to ${before}, then to ${after} and ${later}`);
  }
});

test('a split that leaves teams unequal shares of the board says so', () => {
  // 28 px of 4-px cells is 7 rows: the top team starts on 4 of them. The board looks even, and 30 test matches were
  // needed to find that it was not.
  const bodies = [ball('tide', [8, 8], [1, 0.5], { team: 'tide' }), ball('ember', [24, 24], [-1, -0.5], { team: 'ember' })];
  const uneven = compileBodies(match({ territory: { ...board, split: 'rows', size: [8, 7] }, bodies }));
  assert.deepEqual(uneven.warnings.filter(text => /split/.test(text)), ["bodies.effects.m.territory.split: 7 rows don't share out evenly among 2 teams, which start with 32, 24 cells; give size a height that divides by 2"]);
  const live = bodiesFrames(match({ territory: { ...board, split: 'rows', size: [8, 7] }, bodies }));
  live.image(0);
  assert.deepEqual(live.figures().warnings, uneven.warnings.filter(text => /split/.test(text)));
  assert.deepEqual((compileBodies(match({ territory: { ...board, split: 'rows', size: [8, 8] }, bodies })).warnings ?? []).filter(text => /split/.test(text)), []);
});
