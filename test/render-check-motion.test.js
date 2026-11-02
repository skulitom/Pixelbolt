// The render check's motion review: each animation's silhouette boxes and lowest rows, and advisory notes on loops: a
// body that leaves its ground row, uneven steps, a jump at the loop and frames that hold on the same picture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { renderProject } from '../src/core.js';
import { compileAutotile } from '../src/authoring.js';
import { checkDelivery } from '../src/check.js';
import { startMCP } from '../src/mcp.js';

const check = (recipe, options = {}) => checkDelivery(renderProject(recipe), { recipe, ...options });
// One filled ellipse per frame, each in its box [x0, y0, x1, y1) with exclusive ends, played in order as "idle".
const ellipses = (name, size, boxes, loop = true) => ({ version: 1, name, width: size, height: size, palette: { g: '#33cc99' },
  frames: boxes.map(([x0, y0, x1, y1], i) => ({ name: `${name}-${i}`, ops: [{ op: 'ellipse', x: x0, y: y0, w: x1 - x0, h: y1 - y0, color: 'g', filled: true }] })),
  animations: { idle: { frames: boxes.map((_, i) => `${name}-${i}`), loop } } });
const asBoxes = boxes => boxes.map(([x0, y0, x1, y1]) => [x0, y0, x1 - x0, y1 - y0]);
const kinds = notes => (notes ?? []).map(note => /lowest visible row/.test(note) ? 'lift' : /moves unevenly/.test(note) ? 'uneven' : /jumps when it loops/.test(note) ? 'join'
  : /identical/.test(note) ? 'identical' : /nearly the same/.test(note) ? 'nearly' : 'other');
// The silhouette steps between neighbouring boxes, as the check measures them: the largest move of any edge.
const steps = boxes => boxes.map((a, i) => { const b = boxes[(i + 1) % boxes.length]; return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[0] + a[2] - b[0] - b[2]), Math.abs(a[1] + a[3] - b[1] - b[3])); });

// A hopping slime an agent drew: it leaves the ground, its steps jump from 2 to 9 px, and two steps barely move.
const slimeBoxes = [[6, 12, 26, 28], [4, 16, 28, 28], [8, 8, 24, 28], [7, 4, 25, 22], [7, 2, 25, 19], [7, 6, 25, 24], [5, 15, 27, 28], [6, 13, 26, 28]];
const slime = ellipses('slime', 32, slimeBoxes);
// A coin whose turn skips from nearly full width to nearly edge-on.
const coin = ellipses('coin', 16, [14, 13, 4, 3, 4, 13].map(w => { const x = Math.floor((16 - w) / 2); return [x, 1, x + w, 15]; }));

test('a hopping slime gets lift, uneven-step and nearly-the-same notes', () => {
  const result = check(slime);
  assert.deepEqual(result.motion, { idle: { box: asBoxes(slimeBoxes), lowest: [27, 27, 27, 21, 18, 23, 27, 27] } });
  assert.deepEqual(steps(result.motion.idle.box), [4, 8, 6, 3, 5, 9, 2, 1]);
  assert.deepEqual(kinds(result.notes), ['lift', 'uneven', 'nearly']);
  assert.equal(result.notes[0], '"idle" loops, but its lowest visible row leaves row 27 (where 5 of its 8 frames stand) for row 18 ("slime-4"): a body that stands on the ground should keep its lowest row on one row in every frame (squash it onto that row rather than lifting or sinking it). A hop, a jump, a run\'s flight frames or something that floats may leave the ground on purpose. pixel_inspect with view: "motion" and animation: "idle" shows its frames in play order.');
  assert.equal(result.notes[1], '"idle" moves unevenly: from "slime-5" to "slime-6" the silhouette moves 9 px, while the median step is 4.5 px. Space the frames so each step changes the silhouette by a similar amount, or add in-between frames.');
  assert.equal(result.notes[2], 'In "idle", "slime-6" → "slime-7" and "slime-7" → "slime-0" are nearly the same (the silhouette moves at most 2 px) while another step moves 9 px: the motion holds, then jumps.');
  // The motion field sits right after delivered, with or without expect.
  assert.deepEqual(Object.keys(result), ['delivered', 'motion', 'notes', 'hint']);
  assert.deepEqual(Object.keys(check(slime, { expect: { frames: 8 } })), ['ok', 'delivered', 'motion', 'notes']);
});

test('an unevenly spaced coin gets uneven-step and nearly-the-same notes, but no lift', () => {
  const result = check(coin);
  assert.deepEqual(result.motion.idle.box.map(box => box[2]), [14, 13, 4, 3, 4, 13]);
  assert.deepEqual(result.motion.idle.lowest, [14, 14, 14, 14, 14, 14]);
  assert.deepEqual(steps(result.motion.idle.box), [1, 5, 1, 1, 5, 1]);
  assert.deepEqual(kinds(result.notes), ['uneven', 'nearly']);
  assert.match(result.notes[0], /^"idle" moves unevenly: from "coin-1" to "coin-2" and from "coin-4" to "coin-5" the silhouette moves 5 px, while the median step is 1 px\./);
  assert.match(result.notes[1], /^In "idle", "coin-0" → "coin-1", "coin-2" → "coin-3", "coin-3" → "coin-4" and "coin-5" → "coin-0" are nearly the same \(the silhouette moves at most 1 px\) while another step moves 5 px/);
});

test('a bounce that squashes onto one row, evenly, gets no motion notes', () => {
  // Heights ease 12 to 14 to 10 and back, widths the other way, and the bottom row stays on row 21.
  const boxes = [12, 13, 14, 13, 12, 11, 10, 11].map(h => { const w = 26 - h, x = Math.floor((24 - w) / 2); return [x, 22 - h, x + w, 22]; });
  const result = check(ellipses('bounce', 24, boxes));
  assert.deepEqual(result.motion.idle.box, asBoxes(boxes));
  assert.deepEqual(new Set(result.motion.idle.lowest), new Set([21]));
  assert.ok(Math.max(...steps(result.motion.idle.box)) <= 1);
  assert.equal(result.notes, undefined);
});

test('a one-shot may rise: a puff whose lowest row moves gets no lift note', () => {
  const boxes = [18, 16, 14, 12, 10].map(y => [5, y, 11, y + 4]);
  const result = check(ellipses('puff', 24, boxes, false));
  assert.deepEqual(result.motion.idle.lowest, [21, 19, 17, 15, 13]);
  assert.equal(result.notes, undefined);
  // The same puff as a loop jumps back 8 px to its start; no row holds half its frames, so it has no ground to leave.
  assert.deepEqual(kinds(check(ellipses('puff', 24, boxes)).notes), ['join', 'nearly']);
});

test('a tall body may wobble a row for every 12 of its height: 2 rows on a 26-row ball is a wobble, 3 rows a lift', () => {
  const ball = bottoms => ellipses('ball', 40, bottoms.map((bottom, i) => { const x = 6 + [0, 1, 2, 3, 2, 1][i]; return [x, bottom - 25, x + 24, bottom + 1]; }));
  assert.equal(check(ball([36, 36, 34, 36, 36, 36])).notes, undefined);
  assert.deepEqual(kinds(check(ball([36, 36, 33, 36, 36, 36])).notes).slice(0, 1), ['lift']);
});

test('a loop whose lowest row wobbles by one row gets no lift note; two rows off its ground row gets one', () => {
  // Each frame also steps a pixel sideways (4, 5, 6, 7, 6, 5), so no two neighbours are the same picture.
  const rows = bottoms => bottoms.map((bottom, i) => { const x = 4 + [0, 1, 2, 3, 2, 1][i]; return [x, bottom - 5, x + 8, bottom + 1]; });
  const wobble = check(ellipses('wobble', 24, rows([20, 20, 19, 19, 20, 20])));
  assert.deepEqual(wobble.motion.idle.lowest, [20, 20, 19, 19, 20, 20]);
  assert.equal(wobble.notes, undefined);
  // Four of six frames stand on row 20 and one sinks to 22. On a tie the ground is the lower row: 20, not 18.
  assert.match(check(ellipses('sink', 24, rows([20, 20, 21, 22, 20, 20]))).notes[0], /^"idle" loops, but its lowest visible row leaves row 20 \(where 4 of its 6 frames stand\) for row 22 below it \("sink-3"\): .*\(squash it onto that row rather than lifting or sinking it\)/);
  assert.match(check(ellipses('tie', 24, rows([20, 20, 18, 18]))).notes[0], /leaves row 20 \(where 2 of its 4 frames stand\) for row 18 \("tie-2"\)/);
});

test('scattered particles in a loop get no uneven-step note, while a solid body that moves the same way does', () => {
  // Three specks spread over a box that grows a pixel a frame, then snaps back: steps of 1 and one of 7.
  const spans = [4, 5, 6, 7, 8, 9, 10, 3];
  const specks = { version: 1, name: 'specks', width: 16, height: 16, palette: { y: '#ffd34d' },
    frames: spans.map((span, i) => ({ name: `s${i}`, ops: [{ op: 'pixel', x: 2, y: 2, color: 'y' }, { op: 'pixel', x: 2 + span, y: 2 + span, color: 'y' }, { op: 'pixel', x: 2 + (span >> 1), y: 2, color: 'y' }] })),
    animations: { idle: { frames: spans.map((_, i) => `s${i}`) } } };
  const scattered = check(specks);
  assert.deepEqual(steps(scattered.motion.idle.box), [1, 1, 1, 1, 1, 1, 7, 1]);
  assert.equal(scattered.notes, undefined);
  // The same boxes filled in are a body: the 7 px step is noted.
  const filled = { ...specks, frames: spans.map((span, i) => ({ name: `s${i}`, ops: [{ op: 'rect', x: 2, y: 2, w: span + 1, h: span + 1, color: 'y' }] })) };
  assert.deepEqual(steps(check(filled).motion.idle.box), [1, 1, 1, 1, 1, 1, 7, 1]);
  assert.deepEqual(kinds(check(filled).notes), ['uneven', 'nearly']);
});

test('a loop that jumps back to its first frame gets a loop join note', () => {
  const slide = ellipses('slide', 16, [2, 3, 4, 5, 6, 7].map(x => [x, 6, x + 4, 10]));
  const result = check(slide);
  assert.deepEqual(kinds(result.notes), ['join', 'nearly']);
  assert.match(result.notes[0], /^"idle" jumps when it loops: from "slide-5" back to "slide-0" the silhouette moves 5 px, while the median step is 1 px\. Make the last frame lead into the first\. pixel_inspect/);
  // Played once, the same frames never wrap.
  assert.equal(check({ ...slide, animations: { idle: { frames: slide.animations.idle.frames, loop: false } } }).notes, undefined);
});

test('identical neighbouring frames get a note, while a repeated frame name is a hold', () => {
  const base = { version: 1, name: 'twins', width: 8, height: 8, palette: { g: '#33cc99', k: '#000000' },
    frames: [{ name: 'a', ops: [{ op: 'rect', x: 2, y: 2, w: 4, h: 4, color: 'g' }] }, { name: 'b', from: 'a' }, { name: 'c', ops: [{ op: 'rect', x: 2, y: 2, w: 4, h: 4, color: 'k' }] }] };
  const twins = check({ ...base, animations: { idle: { frames: ['a', 'b', 'c'] } } });
  assert.deepEqual(twins.notes, ['"idle": "a" and "b" are identical; drop one (and add its duration to the other) or change it. pixel_inspect with view: "motion" and animation: "idle" shows its frames in play order.']);
  // "c" has the same silhouette in another colour, so it is not identical; "a", "a" is a hold on purpose.
  assert.equal(check({ ...base, animations: { idle: { frames: ['a', 'a', 'c'] } } }).notes, undefined);
  // A run of identical frames is named once, and pingpong's way back doesn't name it again.
  const run = check({ ...base, frames: [...base.frames, { name: 'd', from: 'a' }], animations: { idle: { frames: ['a', 'b', 'd', 'c'], direction: 'pingpong' } } });
  assert.deepEqual(run.notes, ['"idle" has identical neighbouring frames: "a" = "b" = "d"; keep one of each (with their durations added up) or change the others. pixel_inspect with view: "motion" and animation: "idle" shows its frames in play order.']);
  // Fully transparent pixels are equal whatever colour they hold: a pixel correction leaves red in one.
  const tinted = { ...base, palette: { ...base.palette, z: '#ff000000' }, frames: [base.frames[0], { name: 'b', from: 'a', pixels: [{ x: 0, y: 0, color: 'z' }] }, base.frames[2]], animations: { idle: { frames: ['a', 'b', 'c'] } } };
  assert.deepEqual([...renderProject(tinted).frames[1].data.subarray(0, 4)], [255, 0, 0, 0]);
  assert.deepEqual(kinds(check(tinted).notes), ['identical']);
  // With another duration, an identical frame is a hold: it changes the timing on purpose.
  assert.equal(check({ ...base, frames: [base.frames[0], { name: 'b', from: 'a', duration: 300 }, base.frames[2]], animations: { idle: { frames: ['a', 'b', 'c'] } } }).notes, undefined);
  assert.deepEqual(kinds(check({ ...base, frames: [{ ...base.frames[0], duration: 300 }, { name: 'b', from: 'a', duration: 300 }, base.frames[2]], animations: { idle: { frames: ['a', 'b', 'c'] } } }).notes), ['identical']);
  // A one-shot may end on, or pass through, identical frames: a settling liquid, an impact that holds.
  assert.equal(check({ ...base, animations: { idle: { frames: ['c', 'a', 'b'], loop: false } } }).notes, undefined);
});

test('motion notes never change ok or problems', () => {
  const met = check(slime, { expect: { width: 32, height: 32, frames: 8, loop: true, transparent: true } });
  assert.deepEqual([met.ok, met.problems, kinds(met.notes)], [true, undefined, ['lift', 'uneven', 'nearly']]);
  const missed = check(slime, { expect: { frames: 6 } });
  assert.deepEqual([missed.ok, missed.problems.length, missed.notes.length], [false, 1, 3]);
  // Without expect there is still no verdict.
  assert.equal(check(slime).ok, undefined);
});

test('motion skips stills and tile sets, keeps 64 entries an animation, and caps the notes at 8 with a count of the rest', async () => {
  const still = { version: 1, name: 'still', width: 4, height: 4, palette: { g: '#33cc99' }, frames: [{ name: 'a', ops: [{ op: 'pixel', x: 1, y: 1, color: 'g' }] }] };
  assert.equal(check(still).motion, undefined);
  // A one-frame animation beside a moving one is left out.
  const mixed = check({ ...slime, animations: { ...slime.animations, pose: { frames: ['slime-0'] } } });
  assert.deepEqual(Object.keys(mixed.motion), ['idle']);
  // With animation named, only that animation is measured.
  assert.equal(check({ ...slime, animations: { ...slime.animations, pose: { frames: ['slime-0'] } } }, { animation: 'pose' }).motion, undefined);
  const long = check({ ...slime, animations: { idle: { frames: Array.from({ length: 70 }, (_, i) => `slime-${i % 8}`) } } });
  assert.deepEqual([long.motion.idle.box.length, long.motion.idle.lowest.length, long.motion.idle.omitted], [64, 64, 6]);
  // A moving animation named beside another that plays other frames is measured from its own frames.
  const pair = { ...slime, animations: { idle: { frames: ['slime-0', 'slime-1'] }, fall: { frames: ['slime-3', 'slime-4', 'slime-5'] } } };
  assert.deepEqual(check(pair, { animation: 'fall' }).motion, { fall: { box: asBoxes(slimeBoxes.slice(3, 6)), lowest: [21, 18, 23] } });
  // Ten hopping animations: every one is measured, eight motion notes are shown and the other 22 counted, and
  // pixel_inspect is named once.
  const crowd = check({ ...slime, animations: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`hop${i}`, slime.animations.idle])) });
  assert.equal(Object.keys(crowd.motion).length, 10);
  assert.deepEqual([crowd.notes.length, crowd.notes.at(-1)], [9, '22 more motion notes not shown: pass animation to check one animation at a time.']);
  assert.equal(crowd.notes.filter(note => note.includes('pixel_inspect')).length, 1);
  // A tile set's only animation flips through its tiles: no motion to review.
  const meadow = JSON.parse(await readFile(new URL('../examples/meadow.autotile.json', import.meta.url), 'utf8'));
  const tiles = check(compileAutotile(meadow).recipe);
  assert.deepEqual([tiles.motion, tiles.notes], [undefined, undefined]);
});

test('a recipe without animations, such as an icon sheet, gets its motion but no motion notes', () => {
  // Four unrelated items; named as one animation they would get a lift note (the gem sits 5 rows above the others).
  const icons = { version: 1, name: 'items', width: 16, height: 16, palette: { g: '#33cc99' },
    frames: [['sword', 6, 2, 4, 13], ['potion', 4, 6, 8, 9], ['gem', 5, 4, 6, 6], ['shield', 3, 3, 10, 10]].map(([name, x, y, w, h]) => ({ name, ops: [{ op: 'rect', x, y, w, h, color: 'g' }] })) };
  const sheet = check(icons);
  assert.deepEqual([Object.keys(sheet.motion), sheet.motion.default.lowest, sheet.notes], [['default'], [14, 14, 9, 12], undefined]);
  assert.ok(kinds(check({ ...icons, animations: { items: { frames: ['sword', 'potion', 'gem', 'shield'] } } }).notes).includes('lift'));
});

test('sparkles that leave their row in a loop get no lift note, while a solid body does', () => {
  // Two specks a frame, the lower one on rows 10, 10, 14, 10, 10: they cover little of their box, so no body stands.
  const lows = [10, 10, 14, 10, 10];
  const sparkles = { version: 1, name: 'sparkles', width: 16, height: 16, palette: { y: '#ffd34d' },
    frames: lows.map((row, i) => ({ name: `s${i}`, ops: [{ op: 'pixel', x: 2 + i, y: 3, color: 'y' }, { op: 'pixel', x: 9, y: row, color: 'y' }] })),
    animations: { twinkle: { frames: lows.map((_, i) => `s${i}`), loop: true } } };
  const result = check(sparkles);
  assert.deepEqual([result.motion.twinkle.lowest, result.notes], [lows, undefined]);
  const solid = { ...sparkles, frames: lows.map((row, i) => ({ name: `s${i}`, ops: [{ op: 'rect', x: 2 + i, y: 3, w: 8, h: row - 2, color: 'y' }] })) };
  assert.match(check(solid).notes[0], /^"twinkle" loops, but its lowest visible row leaves row 10 \(where 4 of its 5 frames stand\) for row 14 below it \("s2"\)/);
});

test('a pingpong turn is no loop jump: its big first step is noted once, as uneven', () => {
  const sway = { version: 1, name: 'sway', width: 16, height: 16, palette: { g: '#33cc99' },
    frames: [1, 6, 7, 8].map((x, i) => ({ name: `p${i}`, ops: [{ op: 'rect', x, y: 4, w: 4, h: 4, color: 'g' }] })),
    animations: { sway: { frames: ['p0', 'p1', 'p2', 'p3'], direction: 'pingpong', loop: true } } };
  const result = check(sway);
  // Played p0 p1 p2 p3 p2 p1; the wrap from p1 back to p0 is the first step played backwards.
  assert.deepEqual(steps(result.motion.sway.box), [5, 1, 1, 1, 1, 5]);
  assert.deepEqual(kinds(result.notes), ['uneven', 'nearly']);
  assert.match(result.notes[0], /^"sway" moves unevenly: from "p0" to "p1" the silhouette moves 5 px, while the median step is 1 px\./);
  assert.ok(!result.notes.some(note => note.includes('jumps when it loops')));
});

test('a loop that only loops by default is told how to make it play once', () => {
  // The coin and the slide without a loop field: their uneven and join notes end with the change that makes a one-shot.
  const byDefault = recipe => ({ ...recipe, animations: { idle: { frames: recipe.animations.idle.frames } } });
  const coinNotes = check(byDefault(coin)).notes;
  assert.match(coinNotes[0], /add in-between frames\. If it should play once, set animations\.idle\.loop to false\. pixel_inspect/);
  assert.ok(!coinNotes[1].includes('play once'));
  const slide = ellipses('slide', 16, [2, 3, 4, 5, 6, 7].map(x => [x, 6, x + 4, 10]));
  assert.match(check(byDefault(slide)).notes[0], /Make the last frame lead into the first\. If it should play once, set animations\.idle\.loop to false\. pixel_inspect/);
  // A loop set on purpose gets no hint, and a one-shot no notes at all.
  assert.ok(!check(coin).notes.some(note => note.includes('play once')));
  assert.equal(check({ ...coin, animations: { idle: { frames: coin.animations.idle.frames, loop: false } } }).notes, undefined);
});

test('MCP pixel_render replies carry the motion and its notes in the check', async t => {
  const base = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(base, 'pixelbolt-motion-check-'));
  t.after(async () => { assert.ok(dir.startsWith(base + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const input = new PassThrough(), output = new PassThrough(), waiting = new Map(); let buffer = '', next = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)?.(message); } });
  const running = startMCP({ input, output, directory: dir });
  const request = (method, params) => new Promise(resolve => { waiting.set(++next, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n'); });
  try {
    await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    const reply = (await request('tools/call', { name: 'pixel_render', arguments: { project: slime, expect: { width: 32, height: 32, frames: 8 } } })).result;
    assert.ok(!reply.isError, reply.content[0].text);
    const { check: result } = JSON.parse(reply.content[0].text);
    assert.deepEqual([result.ok, result.problems], [true, undefined]);
    assert.deepEqual(result.motion, { idle: { box: asBoxes(slimeBoxes), lowest: [27, 27, 27, 21, 18, 23, 27, 27] } });
    assert.deepEqual(kinds(result.notes), ['lift', 'uneven', 'nearly']);
  } finally { input.end(); await running; }
});

test('shipped spell loops, whose outline wanders while the compiler keeps them seamless, get no lift, uneven or join note', async () => {
  const { compileEffects } = await import('../src/fx.js');
  for (const element of ['poison', 'shadow', 'fire']) {
    const { recipe, metadata } = compileEffects(JSON.parse(await readFile(new URL(`../examples/${element}-spells.fx.json`, import.meta.url), 'utf8')));
    const project = renderProject(recipe);
    for (const name of Object.keys(recipe.animations).filter(key => metadata.effects[key].loop)) {
      // The compile's own seam review: the frame after the last is exactly the first.
      assert.equal(metadata.effects[name].seam.jump, 0, name);
      const notes = checkDelivery(project, { recipe, animation: name }).notes ?? [];
      assert.deepEqual(kinds(notes).filter(kind => ['lift', 'uneven', 'join', 'nearly'].includes(kind)), [], `${name}: ${notes.join(' | ')}`);
    }
  }
});

test('a body that boils inside redraws as much in every frame, so a 3 px pop of its outline is no jump; a slide back to the start still is', () => {
  // A ball whose inside churns (a 14 × 14 patch flickering between two colours) and whose right edge pops out 3 px in
  // its last frame.
  const boil = { version: 1, name: 'boil', width: 40, height: 40, palette: { g: '#33cc99', k: '#116644', m: '#88eecc' },
    frames: Array.from({ length: 8 }, (_, i) => ({ name: `b${i}`, ops: [{ op: 'ellipse', x: 6, y: 6, w: i === 7 ? 27 : 24, h: 24, color: 'g', filled: true }, { op: 'rect', x: 11, y: 11, w: 14, h: 14, color: i % 2 ? 'm' : 'k' }] })),
    animations: { idle: { frames: Array.from({ length: 8 }, (_, i) => `b${i}`) } } };
  const result = check(boil);
  // Its silhouette alone would read as an uneven step and a jump at the loop: 3 px against a median of 0.
  assert.deepEqual(steps(result.motion.idle.box), [0, 0, 0, 0, 0, 0, 3, 3]);
  assert.equal(result.notes, undefined);
  // The ball sliding a pixel a frame and jumping back at the loop redraws far more at the wrap: still a join.
  const slideBack = ellipses('slide', 40, [0, 1, 2, 3, 4, 5, 6, 7].map(x => [4 + x, 8, 28 + x, 32]));
  assert.deepEqual(kinds(check(slideBack).notes), ['join', 'nearly']);
});

test('the play-once hint goes on a default loop\'s first note, a lift note included', () => {
  // A jump drawn as frames but left as a default loop: even 3 px steps up and down, so only the lift note fires.
  const jump = ellipses('jump', 32, [[8, 14, 24, 28], [8, 14, 24, 28], [8, 14, 24, 28], [8, 11, 24, 25], [8, 8, 24, 22], [8, 11, 24, 25]]);
  delete jump.animations.idle.loop;
  const notes = check(jump).notes.filter(note => /lowest visible row|moves unevenly|jumps when it loops/.test(note));
  assert.ok(notes.length >= 1 && /lowest visible row/.test(notes[0]), JSON.stringify(notes));
  assert.ok(notes[0].includes('on purpose. If it should play once, set animations.idle.loop to false.'), notes[0]);
  assert.equal(notes.filter(note => note.includes('If it should play once')).length, 1);
  // Set explicitly, the loop is the author's choice: no hint.
  assert.ok(!check({ ...jump, animations: { idle: { ...jump.animations.idle, loop: true } } }).notes.some(note => note.includes('If it should play once')));
});
