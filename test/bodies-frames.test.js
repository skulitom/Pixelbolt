import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, createSequence, createBodiesSequence, figuresSummary } from '../src/index.js';
import { rollRows } from '../src/craft.js';
import { compileBodies, bodiesFrames } from '../src/bodies.js';

// bodiesFrames steps a match frame after frame for video frames (src/sequence.js); every frame it shows must be the
// frame compileBodies draws, whatever the frame rate, the pictures and the names.
const root = fileURLToPath(new URL('../', import.meta.url));
const example = async name => JSON.parse(await readFile(path.join(root, 'examples', `${name}.bodies.json`), 'utf8'));
const same = (a, b) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
const pngs = files => [...files].filter(([name]) => name.endsWith('.png')).map(([name, bytes]) => [name, bytes.toString('base64')]);

test('a match sampled below its frame rate shows the frames its recipe draws', async () => {
  // A body's drawn place and angle hold from frame to frame. Drawn only on the frames shown, crate-topple's turning
  // crates came out different in three of every second frame; crate-smash's pieces are held the same way.
  for (const preset of ['crate-topple', 'crate-smash']) {
    const source = await example(preset), frames = renderProject(compileBodies(source).recipe).frames;
    for (const step of [2, 3]) {
      const match = bodiesFrames(source);
      for (let f = 0; f < match.frames; f += step) assert.ok(same(match.image(f), frames[f].data), `${preset} every ${step}: frame ${f}`);
    }
  }
  // The same through the sequence a video editor gets: 10 frames a second from a 25-frame match.
  const source = await example('crate-topple');
  assert.deepEqual(pngs(createBodiesSequence(source, { fps: 10 }).files), pngs(createSequence(renderProject(compileBodies(source).recipe), { fps: 10 }).files));
});

test('a match with a 60-character effect name draws past frame 999', () => {
  // Each shown frame was rendered as a one-frame recipe named after the effect and the frame number, over the
  // renderer's 64 characters from frame 1000 of a 60-character name.
  const name = `e${'x'.repeat(59)}`, source = {
    format: 'pixelforge-bodies', version: 1, name: 'long', width: 16, height: 16, palette: { w: '#eeeeee' },
    effects: { [name]: { frames: 1001, duration: 40, bodies: [{ shape: 'circle', radius: 2, at: [8, 4], fill: 'w', bounce: 0.9 }] } }
  };
  const match = bodiesFrames(source, name);
  assert.equal(match.image(1000).length, 16 * 16 * 4);
  assert.equal(match.figures().frames, 1001);
});

// A picture of 36 pixels, each its own colour, on a body that turns in place: how many of each a frame holds says
// whether the picture is whole.
const KEYS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ', palette = Object.fromEntries([...KEYS].map((key, i) => [key, `#${(0x101010 + i * 0x060402).toString(16)}`]));
const tile = Array.from({ length: 6 }, (_, y) => KEYS.slice(y * 6, y * 6 + 6));
const spinner = { format: 'pixelforge-bodies', version: 1, name: 'spinner', width: 24, height: 24, palette, symbols: { tile }, effects: { turn: { frames: 40, duration: 40, gravity: [0, 0], bodies: [{ name: 'tile', shape: 'box', size: [6, 6], at: [12.3, 11.6], fixed: true, spin: 3, symbol: 'tile' }] } } };
const counts = (image, colours) => { const seen = new Map(); for (let i = 0; i < image.length; i += 4) if (image[i + 3]) { const key = (image[i] << 16) | (image[i + 1] << 8) | image[i + 2]; seen.set(key, (seen.get(key) ?? 0) + 1); } return colours.map(colour => seen.get(colour) ?? 0); };

test('drawn at a video\'s pixels, a turned picture keeps every pixel as a whole square', () => {
  // P-158: turned at the world's pixels and enlarged, a swinging monkey of 70 pixels lost up to 18 of them and drew 20
  // twice in a frame. At the video's own pixels each one is a square of about scale × scale video pixels at every angle.
  const colours = [...KEYS].map((_, i) => 0x101010 + i * 0x060402), scale = 10, match = bodiesFrames(spinner, undefined, { scale }), coarse = bodiesFrames(spinner);
  assert.deepEqual([match.width, match.height, match.scale, coarse.width, coarse.scale], [240, 240, 10, 24, 1]);
  let lost = 0;
  for (let f = 0; f < 40; f++) {
    const fine = counts(match.image(f), colours), world = counts(coarse.image(f), colours);
    for (const [i, area] of fine.entries()) assert.ok(area >= 0.8 * scale * scale && area <= 1.2 * scale * scale, `frame ${f}: pixel ${KEYS[i]} covers ${area} video pixels`);
    lost += world.filter(n => n === 0).length;
  }
  assert.ok(lost > 40, `the same turn at the world's pixels drops pixels (${lost} over 40 frames): what the finer drawing is for`);
});

test('what lies on the world\'s grid is the world\'s frame enlarged, and a scale of 1 is the recipe\'s frame', async () => {
  // The territory, its heads-up display, the obstacles and the background are drawn as ever and enlarged; only the
  // bodies differ, and at frame 0 of the territory preset they stand on whole pixels.
  for (const preset of ['territory', 'flag', 'crate-smash']) {
    const source = await example(preset), k = 3, world = bodiesFrames(source), fine = bodiesFrames(source, undefined, { scale: () => k }), same1 = bodiesFrames(source, undefined, { scale: 1 });
    const a = world.image(0), b = fine.image(0);
    assert.ok(same(a, same1.image(0)), `${preset}: scale 1`);
    let differ = 0;
    for (let y = 0; y < fine.height; y++) for (let x = 0; x < fine.width; x++) {
      const from = (Math.floor(y / k) * world.width + Math.floor(x / k)) * 4, to = (y * fine.width + x) * 4;
      if (a[from] !== b[to] || a[from + 1] !== b[to + 1] || a[from + 2] !== b[to + 2] || a[from + 3] !== b[to + 3]) differ++;
    }
    // Cloth is the world's pixels too (the flag); bodies placed between pixels differ along their edges only.
    assert.ok(differ <= { territory: 0.005, flag: 0, 'crate-smash': 0.02 }[preset] * fine.width * fine.height, `${preset}: ${differ} of ${fine.width * fine.height} pixels differ from the enlarged frame`);
  }
  assert.throws(() => bodiesFrames(spinner, undefined, { scale: 0 }), /sequence\.scale/);
  assert.throws(() => bodiesFrames(spinner, undefined, { scale: 200 }), /above 4096 a side/);
});

test('a sequence draws a match at the size it enlarges it to, and carries each named body\'s path', () => {
  // A fixed body has no path: this one floats free and turns.
  const free = { ...spinner, effects: { turn: { ...spinner.effects.turn, bodies: [{ ...spinner.effects.turn.bodies[0], fixed: undefined, weightless: true, spinDrag: 0 }] } } };
  const made = createBodiesSequence(free, { fps: 25, scale: 8 }), plain = createBodiesSequence(free, { fps: 25 });
  // A match plays once, so one loop is what it does: the help lists --loops for every sequence, and it was refused here.
  assert.equal(createBodiesSequence(free, { fps: 25, loops: 1 }).info.frames, plain.info.frames);
  assert.throws(() => createBodiesSequence(free, { fps: 25, loops: 2 }), error => error.path === 'sequence.loops' && /plays once/.test(error.message));
  assert.deepEqual([made.info.placement.scale, made.info.placement.drawn, made.info.width, plain.info.placement.drawn], [8, 8, 192, undefined]);
  // Larger than a still may be drawn, the frames are drawn as fine as one may and enlarged the rest of the way.
  const wide = { ...spinner, width: 256, height: 8, symbols: { tile: tile.slice(0, 4).map(row => row.slice(0, 4)) }, effects: { turn: { ...spinner.effects.turn, frames: 2, bodies: [{ ...spinner.effects.turn.bodies[0], size: [4, 4], at: [8, 4] }] } } };
  assert.deepEqual(createBodiesSequence(wide, { fps: 25, size: [4096, 512], fit: 'cover', scale: 32 }).info.placement.drawn, 16);
  const { figures } = made.info;
  assert.equal(figures.paths.tile.length, 40);
  assert.deepEqual(figures.paths.tile[0].slice(0, 2), [12.3, 11.6]);
  assert.deepEqual(figuresSummary(figures).ended, { tile: figures.paths.tile.at(-1) });
  assert.equal('paths' in figuresSummary(figures), false, 'a reply names where each body ended, not every frame');
});

test('a circle\'s symbol stays upright unless it rolls, and a rolled disc keeps its outline', () => {
  const disc = ['.kkkk.', 'kaabbk', 'kaabbk', 'kccddk', 'kccddk', '.kkkk.'], round = { ...spinner, palette: { k: '#000000', a: '#ff0000', b: '#00ff00', c: '#0000ff', d: '#ffff00' }, symbols: { disc } };
  const ball = extra => ({ ...round, effects: { turn: { ...spinner.effects.turn, bodies: [{ shape: 'circle', radius: 3, at: [12, 12], fixed: true, spin: 9, symbol: 'disc', ...extra }] } } });
  const upright = bodiesFrames(ball({})), rolling = bodiesFrames(ball({ rolls: true }));
  const first = Buffer.from(upright.image(0));
  assert.ok(same(first, upright.image(10)), 'upright: the same picture a quarter turn on');
  const start = Buffer.from(rolling.image(0)), quarter = rolling.image(10);
  assert.ok(same(first, start) && !same(start, quarter), 'rolling: the picture turns');
  // The disc covers the same pixels at every angle, its rim stays the rim, and a quarter turn is exact.
  for (let degrees = 0; degrees < 360; degrees += 7) {
    const turned = rollRows(disc, degrees);
    assert.deepEqual(turned.map(row => row.replace(/[abcd]/g, 'x')), disc.map(row => row.replace(/[abcd]/g, 'x')), `${degrees} degrees`);
  }
  assert.deepEqual(rollRows(disc, 90), ['.kkkk.', 'kccaak', 'kccaak', 'kddbbk', 'kddbbk', '.kkkk.']);
  assert.throws(() => compileBodies(ball({ shape: 'box', size: [6, 6], radius: undefined, rolls: true })), /rolls: a box's picture always turns/);
  assert.throws(() => compileBodies({ ...round, effects: { turn: { ...spinner.effects.turn, bodies: [{ shape: 'circle', radius: 3, at: [12, 12], fill: 'a', rolls: true }] } } }), /rolls: rolls turns a circle's symbol/);
});

test('a match drawn larger keeps to a still\'s size, takes its options as an object, and colours a translucent body as the sheet does', () => {
  // Height as well as width: a 16 by 256 match drawn 17 times larger was let through, 4,352 pixels tall.
  const tall = { ...spinner, width: 16, height: 256, effects: { turn: { ...spinner.effects.turn, frames: 2, bodies: [{ ...spinner.effects.turn.bodies[0], at: [8, 8] }] } } };
  assert.throws(() => bodiesFrames(tall, undefined, { scale: 17 }), error => error.path === 'sequence.scale' && /above 4096 a side/.test(error.message));
  assert.equal(bodiesFrames(tall, undefined, { scale: 16 }).height, 4096);
  // Options that are no object are refused in words, not by a TypeError.
  assert.throws(() => createBodiesSequence(spinner, null), error => error.path === 'sequence' && /expected an object/.test(error.message));
  // A translucent body over a territory cell: in the sheet its pixel takes the cell's place and shows the ground
  // through, and the frame drawn larger laid it over the cell, so the video was another colour than the sheet.
  const sheer = { format: 'pixelforge-bodies', version: 1, name: 'sheer', width: 16, height: 16, palette: { a: '#ff000080', n: '#0000ff', m: '#00ff00', k: '#000000' },
    effects: { e: { frames: 3, duration: 40, gravity: [0, 0], background: 'k', territory: { cell: 4, size: [4, 4], split: 'rows', teams: [{ name: 'x', color: 'n' }, { name: 'y', color: 'm' }] },
      bodies: [{ shape: 'box', size: [4, 4], at: [8, 6], team: 'x', fill: 'a' }] } } };
  const plain = bodiesFrames(sheer), fine = bodiesFrames(sheer, undefined, { scale: 2 }), a = plain.image(1), b = fine.image(1);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const from = ((y >> 1) * 16 + (x >> 1)) * 4, to = (y * 32 + x) * 4;
    assert.deepEqual([...b.subarray(to, to + 4)], [...a.subarray(from, from + 4)], `pixel ${x},${y}`);
  }
  assert.deepEqual([...a.subarray((6 * 16 + 8) * 4, (6 * 16 + 8) * 4 + 4)], [128, 0, 0, 255]);
  // A trail at the larger size is the trail of the sheet, enlarged along with the ball it follows (its discs are laid
  // as rows; as lists of cells they held hundreds of megabytes at a video's size).
  const comet = { ...spinner, symbols: undefined, effects: { turn: { frames: 12, duration: 40, gravity: [0, 0], bodies: [{ name: 'ball', shape: 'circle', radius: 3, at: [5, 12], velocity: [1, 0], weightless: true, fill: 'a', trail: { color: 'b', length: 4 } }] } } };
  const trailed = bodiesFrames(comet, undefined, { scale: 4 });
  let image; for (let f = 0; f < 10; f++) image = trailed.image(f);
  const keys = new Set(); for (let i = 0; i < image.length; i += 4) if (image[i + 3]) keys.add(`${image[i]},${image[i + 1]},${image[i + 2]}`);
  assert.equal(keys.size, 2, 'the ball and its trail are both drawn');
});
