// A patch whose corrections pass what a frame holds is refused with advice that works when followed: operations on the
// frame's top layer when it draws with layers (core draws frame.ops beneath them), and the same advice for a region
// change too large even to merge, on stills larger than an animation frame.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, PixelError } from '../src/core.js';
import { patchRecipe } from '../src/patch.js';
import { createToolRunner } from '../src/mcp.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const wall = (layers, extra = {}) => ({ version: 1, name: 'wall', width: 2048, height: 2048, palette: { a: '#102030', b: '#a0c0f0' }, frames: [{ name: 'f0', layers, ...extra }] });
const filled = color => ({ op: 'rect', x: 0, y: 0, w: 2048, h: 2048, color, filled: true });
const layered = wall([{ name: 'l', ops: [filled('a')] }]);
const recolor = { recolor: 'frames[f0]', value: { x: 0, y: 0, w: 600, h: 600, from: 'a', to: 'b' } };
const square = { op: 'rect', x: 0, y: 0, w: 600, h: 600, color: 'b', filled: true };
const advice = ops => `with this recolor, frame "f0" would have 360,000 pixel corrections, and a frame's corrections together hold at most 262,144: recolour or redraw an area this large with its top layer's operations (a set of ${ops} or an insert at ${ops}[-]), or change a smaller region`;
const insertAt = message => message.match(/an insert at (\S+)\)/)[1];
// The pixels that differ between two renders of the one frame, by colour key.
const differ = (before, after) => {
  const [a, b] = [before, after].map(recipe => renderProject(recipe).frames[0].data);
  let count = 0;
  for (let at = 0; at < a.length; at += 4) if (a[at] !== b[at] || a[at + 1] !== b[at + 1] || a[at + 2] !== b[at + 2] || a[at + 3] !== b[at + 3]) count++;
  return count;
};

test('the overflow advice on a layered frame names its top layer, and following it changes the 360,000 pixels', () => {
  assert.throws(() => patchRecipe(layered, [recolor]), error => error instanceof PixelError && error.path === 'changes[0].value' && error.message === `changes[0].value: ${advice('frames[f0].layers[l].ops')}`);
  // Old advice against new: an insert at frames[f0].ops[-] draws beneath the layer and changes nothing; the top layer's
  // operations change every pixel of the area, by insert or by set.
  const followed = path => patchRecipe(layered, [{ insert: path, value: square }]).recipe;
  assert.equal(differ(layered, followed('frames[f0].ops[-]')), 0);
  assert.equal(differ(layered, followed(insertAt(advice('frames[f0].layers[l].ops')))), 360000);
  const set = patchRecipe(layered, [{ set: 'frames[f0].layers[l].ops', value: [filled('a'), square] }]).recipe;
  assert.equal(differ(layered, set), 360000);
  // An unnamed top layer goes by index, and a hidden one is passed over for the shown layer beneath it.
  const unnamed = wall([{ name: 'back', ops: [filled('a')] }, { ops: [] }, { name: 'ghost', visible: false, ops: [] }]);
  assert.throws(() => patchRecipe(unnamed, [recolor]), { message: `changes[0].value: ${advice('frames[f0].layers[1].ops')}` });
  assert.equal(differ(unnamed, patchRecipe(unnamed, [{ insert: 'frames[f0].layers[1].ops[-]', value: square }]).recipe), 360000);
});

test('the overflow advice says the frame\'s pixel corrections still draw over its operations', () => {
  const corrected = wall([{ name: 'l', ops: [filled('a')] }], { pixels: [{ x: 5, y: 5, color: 'a' }, { x: 900, y: 900, color: 'b' }] });
  assert.throws(() => patchRecipe(corrected, [recolor]), { message: `changes[0].value: ${advice('frames[f0].layers[l].ops').replace('360,000', '360,001')}. The frame's 2 pixel corrections still draw over its operations (remove frames[f0].pixels to drop them)` });
  // As it says: the correction at 5,5 keeps its colour over the new rectangle until the corrections are removed.
  const drawn = patchRecipe(corrected, [{ insert: 'frames[f0].layers[l].ops[-]', value: square }]).recipe;
  assert.equal(differ(corrected, drawn), 359999);
  assert.equal(differ(corrected, patchRecipe(drawn, [{ remove: 'frames[f0].pixels' }]).recipe), 360001);
});

// The changed pixels between two renders of the one frame, and the box round them.
const changed = (before, after) => {
  const [a, b] = [before, after].map(recipe => renderProject(recipe).frames[0].data), width = before.width, box = [Infinity, Infinity, -1, -1];
  let pixels = 0;
  for (let at = 0; at < a.length; at += 4) {
    if (a[at] === b[at] && a[at + 1] === b[at + 1] && a[at + 2] === b[at + 2] && a[at + 3] === b[at + 3]) continue;
    const x = at / 4 % width, y = Math.floor(at / 4 / width);
    pixels++; box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
  }
  return { pixels, box: { x: box[0], y: box[1], w: box[2] - box[0] + 1, h: box[3] - box[1] + 1 } };
};
const area = { pixels: 360000, box: { x: 0, y: 0, w: 600, h: 600 } };

test('the overflow advice names a new top layer when the top layer is offset or sorted by ground, and following it changes the 360,000 pixels', () => {
  const newLayer = `changes[0].value: with this recolor, frame "f0" would have 360,000 pixel corrections, and a frame's corrections together hold at most 262,144: recolour or redraw an area this large with operations in a new top layer (an insert at frames[f0].layers[-] of {"ops": [...]}), or change a smaller region`;
  // Follows the reply as written: its path, and its value with the operations in place of [...].
  const follow = (recipe, message) => {
    const [, at, value] = message.match(/an insert at (\S+) of (\{.*\})\)/);
    return patchRecipe(recipe, [{ insert: at, value: JSON.parse(value.replace('[...]', JSON.stringify([square]))) }]).recipe;
  };
  const offset = wall([{ name: 'back', ops: [filled('a')] }, { name: 'l', x: 8, y: 8, ops: [{ op: 'pixel', x: 1500, y: 1500, color: 'b' }] }]);
  const ground = wall([{ name: 'l', sort: 'ground', ops: [filled('a')] }]);
  for (const recipe of [offset, ground]) {
    assert.throws(() => patchRecipe(recipe, [recolor]), { path: 'changes[0].value', message: newLayer });
    assert.deepEqual(changed(recipe, follow(recipe, newLayer)), area);
  }
  // Old advice against new: the offset layer draws the square 8 pixels off, and the sorted layer draws it first, by the
  // row it stands on, beneath the wall.
  const old = recipe => patchRecipe(recipe, [{ insert: 'frames[f0].layers[l].ops[-]', value: square }]).recipe;
  assert.deepEqual(changed(offset, old(offset)), { pixels: 360000, box: { x: 8, y: 8, w: 600, h: 600 } });
  assert.equal(changed(ground, old(ground)).pixels, 0);
  // A translucent or recoloured top layer gets the same advice; one at x and y 0 composites plainly and is named.
  const over = extra => wall([{ name: 'back', ops: [filled('a')] }, { name: 'l', ops: [{ op: 'pixel', x: 1500, y: 1500, color: 'b' }], ...extra }]);
  for (const extra of [{ opacity: 0.5 }, { palette: { b: '#ff0000' } }]) assert.throws(() => patchRecipe(over(extra), [recolor]), { message: newLayer });
  assert.throws(() => patchRecipe(over({ x: 0, y: 0, opacity: 1 }), [recolor]), { message: `changes[0].value: ${advice('frames[f0].layers[l].ops')}` });
});

// A 600x600 still drawn in k, recolour to s over its rows from y, and a redraw of all of it in s by its operations.
const still = (pixels = undefined) => ({ version: 1, name: 'wall', width: 600, height: 600, palette: { k: '#102030', s: '#a0c0f0' }, frames: [{ name: 'f', ops: [{ op: 'rect', x: 0, y: 0, w: 600, h: 600, color: 'k' }], ...(pixels && { pixels }) }] });
const half = (y, h = 300) => ({ recolor: 'frames[f]', value: { from: 'k', to: 's', x: 0, y, w: 600, h } });
const redraw = { insert: 'frames[f].ops[-]', value: { op: 'rect', x: 0, y: 0, w: 600, h: 600, color: 's' } };
const stillAdvice = at => `changes[${at}].value: with this recolor, frame "f" would have 360,000 pixel corrections, and a frame's corrections together hold at most 262,144: recolour or redraw an area this large with the frame's operations (a set of frames[f].ops or an insert at frames[f].ops[-]), or change a smaller region`;

test('the overflow note counts the recipe\'s own corrections, names the earlier changes that add the rest, and following it works', () => {
  const head = at => `${stillAdvice(at)}. The frame's 180,000 pixel corrections still draw over its operations: `;
  // Two halves: the corrections are the first change's, so the old advice, removing frames[f].pixels, is refused.
  assert.throws(() => patchRecipe(still(), [half(0), half(300)]), { message: `${head(1)}changes[0] adds 180,000 of them; drop or shrink it` });
  assert.throws(() => patchRecipe(still(), [{ remove: 'frames[f].pixels' }, half(300)]), { message: 'changes[0].remove: nothing to remove at frames[0].pixels' });
  // Dropped, the operations redraw all of it; shrunk, both changes fit as corrections.
  const redrawn = patchRecipe(still(), [redraw]).recipe;
  assert.deepEqual([changed(still(), redrawn), redrawn.frames[0].pixels], [area, undefined]);
  assert.equal(patchRecipe(still(), [half(0, 100), half(300)]).recipe.frames[0].pixels.length, 240000);
  // The recipe's own correction and the change's are counted apart, and each part of the advice works.
  const corrected = still([{ x: 1, y: 1, color: 'k' }]);
  assert.throws(() => patchRecipe(corrected, [half(0), half(300)]), { message: `${head(1)}the recipe has 1 of them (remove frames[f].pixels to drop it) and changes[0] adds 179,999; drop or shrink it` });
  assert.equal(changed(corrected, patchRecipe(corrected, [redraw]).recipe).pixels, 359999);
  assert.deepEqual(changed(corrected, patchRecipe(corrected, [{ remove: 'frames[f].pixels' }, redraw]).recipe), area);
  // Several earlier changes are each named with what they add.
  assert.throws(() => patchRecipe(still(), [{ paint: 'frames[f]', value: [{ x: 0, y: 0, color: 's' }] }, half(0), half(300)]), { message: `${head(2)}changes[0] adds 1 of them and changes[1] adds 179,999; drop or shrink them` });
});

test('a change that sets, removes or adds to a frame\'s corrections takes them over in the note, which never names more than the list holds', () => {
  const kept = { x: 1, y: 1, color: 'k' }, top = Array.from({ length: 180000 }, (_, at) => ({ x: at % 600, y: Math.floor(at / 600), color: 'k' }));
  const all = half(0, 600), one = { set: 'frames[f].pixels', value: [kept] };
  // A set of the list after an earlier change: the note names the set, and the one correction it leaves, not changes[0].
  assert.throws(() => patchRecipe(still(), [half(0), one, all]), { message: `${stillAdvice(2)}. The frame's 1 pixel correction still draws over its operations: changes[1] adds it; drop or shrink it` });
  assert.deepEqual(changed(still(), patchRecipe(still(), [half(0), redraw]).recipe), area);
  assert.equal(changed(still(), patchRecipe(still(), [one, redraw]).recipe).pixels, 359999, 'the old note named changes[0]; dropping it leaves the set');
  // A set of the whole list, or of the frame, is named as what adds it; dropped, the redraw changes all of it.
  assert.throws(() => patchRecipe(still(), [{ set: 'frames[f].pixels', value: top }, all]), { message: `${stillAdvice(1)}. The frame's 180,000 pixel corrections still draw over its operations: changes[0] adds 180,000 of them; drop or shrink it` });
  assert.throws(() => patchRecipe(still(), [{ set: 'frames[f]', value: { ...still().frames[0], pixels: [kept] } }, all]), { message: `${stillAdvice(1)}. The frame's 1 pixel correction still draws over its operations: changes[0] adds it; drop or shrink it` });
  assert.deepEqual(changed(still(), patchRecipe(still(), [redraw]).recipe), area);
  assert.equal(changed(still(), patchRecipe(still(), [{ set: 'frames[f].pixels', value: top }, redraw]).recipe).pixels, 180000);
  // A remove of the list clears what earlier changes added: the note names only the change after it.
  assert.throws(() => patchRecipe(still(), [half(0), { remove: 'frames[f].pixels' }, half(300), all]), { message: `${stillAdvice(3)}. The frame's 180,000 pixel corrections still draw over its operations: changes[2] adds 180,000 of them; drop or shrink it` });
  assert.deepEqual(changed(still(), patchRecipe(still(), [half(0), { remove: 'frames[f].pixels' }, redraw]).recipe), area);
  // An insert into the recipe's list is counted apart from the recipe's own, and following both parts works.
  const corrected = still([kept]), added = { insert: 'frames[f].pixels[-]', value: { x: 2, y: 2, color: 'k' } };
  assert.throws(() => patchRecipe(corrected, [added, all]), { message: `${stillAdvice(1)}. The frame's 2 pixel corrections still draw over its operations: the recipe has 1 of them (remove frames[f].pixels to drop it) and changes[0] adds 1; drop or shrink it` });
  assert.equal(changed(corrected, patchRecipe(corrected, [added, redraw]).recipe).pixels, 359998);
  assert.deepEqual(changed(corrected, patchRecipe(corrected, [{ remove: 'frames[f].pixels' }, redraw]).recipe), area);
  // One correction of the recipe's own reads in the singular, and removing it lets the redraw change every pixel.
  assert.throws(() => patchRecipe(corrected, [all]), { message: `${stillAdvice(0)}. The frame's 1 pixel correction still draws over its operations (remove frames[f].pixels to drop it)` });
  assert.equal(changed(corrected, patchRecipe(corrected, [redraw]).recipe).pixels, 359999);
});

test('a remove of one correction takes it from the part that owns it, and following the note works', () => {
  const all = half(0, 600), redrawn = recipe => changed(still(), recipe).pixels;
  // The recipe's own entry removed after a change appends 180,000: the change owns all of the list.
  const corrected = still([{ x: 1, y: 1, color: 'k' }]), first = { remove: 'frames[f].pixels[0]' };
  assert.throws(() => patchRecipe(corrected, [half(300), first, all]), { message: `${stillAdvice(2)}. The frame's 180,000 pixel corrections still draw over its operations: changes[0] adds 180,000 of them; drop or shrink it` });
  assert.equal(redrawn(patchRecipe(corrected, [first, redraw]).recipe), 360000);
  // Before, the loss was taken from the newest part, so the note also named the recipe, and removing its list as well is refused.
  assert.throws(() => patchRecipe(corrected, [{ remove: 'frames[f].pixels' }, first, redraw]), { path: 'changes[1].remove' });
  // Of two recipe corrections, the one removed after the change leaves the recipe 1, which stays when the change is dropped.
  const two = still([{ x: 1, y: 1, color: 'k' }, { x: 2, y: 2, color: 'k' }]), second = { remove: 'frames[f].pixels[1]' };
  assert.throws(() => patchRecipe(two, [half(300), second, all]), { message: `${stillAdvice(2)}. The frame's 180,001 pixel corrections still draw over its operations: the recipe has 1 of them (remove frames[f].pixels to drop it) and changes[0] adds 180,000; drop or shrink it` });
  assert.equal(redrawn(patchRecipe(two, [second, redraw]).recipe), 359999);
  assert.equal(redrawn(patchRecipe(two, [{ remove: 'frames[f].pixels' }, redraw]).recipe), 360000);
  // An entry of an earlier change removed later is taken from that change, not from the newest.
  const paint = { paint: 'frames[f]', value: [{ x: 1, y: 1, color: 'k' }, { x: 2, y: 2, color: 'k' }] };
  assert.throws(() => patchRecipe(still(), [paint, half(300), first, all]), { message: `${stillAdvice(3)}. The frame's 180,001 pixel corrections still draw over its operations: changes[0] adds 1 of them and changes[1] adds 180,000; drop or shrink them` });
  assert.equal(redrawn(patchRecipe(still(), [paint, first, redraw]).recipe), 359999);
  assert.equal(redrawn(patchRecipe(still(), [redraw]).recipe), 360000);
});

test('a recipe list with a coordinate twice keeps its owners when a change merges into it, and a list without one too', () => {
  // A list with one entry per coordinate takes its owners from the merge's own map; one with a coordinate twice is
  // mapped again by coordinate. Both name the recipe's distinct corrections and what each change adds.
  const all = half(0, 600), dot = { paint: 'frames[f]', value: [{ x: 3, y: 3, color: 'k' }] };
  const tail = (k, adds) => `. The frame's ${(180000 + k).toLocaleString('en-US')} pixel corrections still draw over its operations: the recipe has 2 of them (remove frames[f].pixels to drop them)${adds}`;
  for (const pixels of [[{ x: 1, y: 1, color: 'k' }, { x: 2, y: 2, color: 'k' }], [{ x: 1, y: 1, color: 'k' }, { x: 2, y: 2, color: 'k' }, { x: 1, y: 1, color: 'k' }]]) {
    assert.throws(() => patchRecipe(still(pixels), [half(300), all]), { message: `${stillAdvice(1)}${tail(2, ' and changes[0] adds 180,000; drop or shrink it')}` });
    assert.throws(() => patchRecipe(still(pixels), [dot, half(300), all]), { message: `${stillAdvice(2)}${tail(3, ', changes[0] adds 1 and changes[1] adds 180,000; drop or shrink them')}` });
  }
});

test('a grid with more rows than a canvas up to 1024 tall is refused at its height, as on main', () => {
  for (const side of [16, 256, 1024]) {
    const canvas = { version: 1, name: 'c', width: 16, height: side, palette: { k: '#102030' }, frames: [{ name: 'f' }] };
    for (const count of [side + 1, 1025]) assert.throws(() => patchRecipe(canvas, [{ grid: 'frames[f]', value: { x: 0, y: 0, rows: Array(count).fill('k') } }]), { path: 'changes[0].value.h', message: 'changes[0].value.h: expected an integer region inside the canvas' });
    assert.equal(patchRecipe(canvas, [{ grid: 'frames[f]', value: { x: 0, y: 0, rows: Array(side).fill('k') } }]).recipe.frames[0].pixels.length, side);
    // Rows that are no list of text are refused at rows on every canvas, naming the rows this canvas takes.
    for (const rows of [[], [''], [1], ['k', 1]]) assert.throws(() => patchRecipe(canvas, [{ grid: 'frames[f]', value: { x: 0, y: 0, rows } }]), { path: 'changes[0].value.rows', message: `changes[0].value.rows: expected 1–${side} equal-width rows` });
  }
  // On a still taller than 1024, a grid is at most 1024 rows, and 1024 of them are taken.
  const tall = { version: 1, name: 'c', width: 16, height: 2048, palette: { k: '#102030' }, frames: [{ name: 'f' }] };
  assert.throws(() => patchRecipe(tall, [{ grid: 'frames[f]', value: { x: 0, y: 0, rows: Array(1025).fill('k') } }]), { path: 'changes[0].value.rows', message: 'changes[0].value.rows: expected 1–1024 equal-width rows' });
  assert.equal(patchRecipe(tall, [{ grid: 'frames[f]', value: { x: 0, y: 1024, rows: Array(1024).fill('k') } }]).recipe.frames[0].pixels.length, 1024);
});

test('a grid row wider than a canvas up to 1024 is refused at its width, as on main', () => {
  for (const side of [256, 1024]) {
    const canvas = { version: 1, name: 'c', width: side, height: 16, palette: { k: '#102030' }, frames: [{ name: 'f' }] };
    assert.throws(() => patchRecipe(canvas, [{ grid: 'frames[f]', value: { x: 0, y: 0, rows: ['k'.repeat(1025)] } }]), { path: 'changes[0].value.w', message: 'changes[0].value.w: expected an integer region inside the canvas' });
    assert.equal(patchRecipe(canvas, [{ grid: 'frames[f]', value: { x: 0, y: 0, rows: ['k'.repeat(side)] } }]).recipe.frames[0].pixels.length, side);
  }
});

test('a region change too large to merge on a big still gets the same advice, and grid rows stay 1024 wide', () => {
  const at = { path: 'changes[0].value' };
  const refusal = (verb, count) => `changes[0].value: with this ${verb}, frame "f0" would have ${count} pixel corrections, and a frame's corrections together hold at most 262,144: recolour or redraw an area this large with its top layer's operations (a set of frames[f0].layers[l].ops or an insert at frames[f0].layers[l].ops[-]), or change a smaller region`;
  // A 600x600 move clears and writes 720,000 entries over 366,000 distinct pixels; before, each was 'expected a bounded pixel list'.
  assert.throws(() => patchRecipe(layered, [{ move: 'frames[f0]', value: { x: 0, y: 0, w: 600, h: 600, dx: 10, dy: 0 } }]), { ...at, message: refusal('move', '366,000') });
  assert.throws(() => patchRecipe(layered, [{ recolor: 'frames[f0]', value: { x: 0, y: 0, w: 2048, h: 2048, from: 'a', to: 'b' } }]), { ...at, message: refusal('recolor', '4,194,304') });
  assert.throws(() => patchRecipe(layered, [{ grid: 'frames[f0]', value: { x: 0, y: 0, rows: Array(1024).fill('b'.repeat(1024)) } }]), { ...at, message: refusal('grid', '1,048,576') });
  // A grid row is at most 1024 characters, as core's readRows takes, though the still is 2048 wide.
  assert.throws(() => patchRecipe(layered, [{ grid: 'frames[f0]', value: { x: 0, y: 0, rows: Array(1024).fill('b'.repeat(2048)) } }]), { path: 'changes[0].value.rows[0]', message: 'changes[0].value.rows[0]: row must contain 1–1024 characters' });
  assert.equal(patchRecipe(layered, [{ grid: 'frames[f0]', value: { x: 1024, y: 0, rows: Array(256).fill('b'.repeat(1024)) } }]).recipe.frames[0].pixels.length, 262144);
});

test('over the CLI and MCP, following the overflow advice on a layered 2048x2048 still changes the 360,000 pixels', async t => {
  const base = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(base, 'pixelbolt-patch-overflow-'));
  t.after(async () => { assert.ok(dir.startsWith(base + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const file = name => path.join(dir, name);
  await writeFile(file('wall.json'), JSON.stringify(layered));
  const cli = async (changes, out) => {
    await writeFile(file('changes.json'), JSON.stringify(changes));
    const run = spawnSync(process.execPath, [path.join(root, 'bin', 'pixelbolt.js'), 'patch', file('wall.json'), '--changes', file('changes.json'), '--out', file(out)], { encoding: 'utf8' });
    return JSON.parse(run.stdout || run.stderr);
  };
  const refused = await cli([recolor], 'refused.json');
  assert.deepEqual([refused.ok, refused.path, refused.error], [false, 'changes[0].value', `changes[0].value: ${advice('frames[f0].layers[l].ops')}`]);
  const moved = await cli([{ move: 'frames[f0]', value: { x: 0, y: 0, w: 600, h: 600, dx: 10, dy: 0 } }], 'moved.json');
  assert.match(moved.error, /would have 366,000 pixel corrections.*an insert at frames\[f0\]\.layers\[l\]\.ops\[-\]/);
  const followed = await cli([{ insert: insertAt(refused.error), value: square }], 'followed.json');
  assert.deepEqual(followed.frames.changed, [{ frame: 'f0', pixels: 360000, box: { x: 0, y: 0, w: 600, h: 600 }, transitions: [{ from: 'a', to: 'b', pixels: 360000 }] }]);
  assert.equal(differ(layered, JSON.parse(await readFile(file('followed.json'), 'utf8'))), 360000);

  const run = createToolRunner({ directory: dir, root: dir, version: '0.0.0' });
  const failed = await run('pixel_patch', { project: layered, changes: [recolor] });
  assert.equal(failed.isError, true);
  const reply = JSON.parse(failed.content[0].text);
  assert.equal(reply.path, 'changes[0].value');
  assert.ok(reply.error.endsWith(advice('frames[f0].layers[l].ops')), reply.error);
  const grid = await run('pixel_patch', { project: layered, changes: [{ grid: 'frames[f0]', value: { x: 0, y: 0, rows: Array(1024).fill('b'.repeat(1024)) } }] });
  assert.match(JSON.parse(grid.content[0].text).error, /would have 1,048,576 pixel corrections.*an insert at frames\[f0\]\.layers\[l\]\.ops\[-\]/);
  const done = await run('pixel_patch', { project: layered, changes: [{ insert: insertAt(reply.error), value: square }] });
  assert.ok(!done.isError, done.content[0].text);
  assert.deepEqual(JSON.parse(done.content[0].text).frames.changed[0].transitions, [{ from: 'a', to: 'b', pixels: 360000 }]);
});
