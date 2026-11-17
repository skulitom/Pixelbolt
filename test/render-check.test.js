import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, PixelError } from '../src/core.js';
import { animationGIF } from '../src/gif.js';
import { patchRecipe } from '../src/patch.js';
import { readExpect, checkDelivery } from '../src/check.js';

const root = fileURLToPath(new URL('../', import.meta.url));
// forest-spirit: 24x24, frames rest, rise, float, blink, fall, settle; idle plays 7 (blink among them), bob is a
// 3-name pingpong (4 played), blink plays 3 once.
const spirit = JSON.parse(await readFile(path.join(root, 'examples', 'forest-spirit.json'), 'utf8'));
// A 4x2 recipe: frame "a" opaque in two colours, "b" with a transparent pixel, "c" empty.
const small = { version: 1, name: 'tile', width: 4, height: 2, palette: { r: '#ff0000', g: '#00ff00' },
  frames: [{ name: 'a', ops: [{ op: 'rect', x: 0, y: 0, w: 4, h: 2, color: 'r' }, { op: 'pixel', x: 0, y: 0, color: 'g' }] }, { name: 'b', from: 'a', ops: [{ op: 'clear', x: 3, y: 1, w: 1, h: 1 }] }, { name: 'c', ops: [] }],
  animations: { flash: { frames: ['a', 'b'], loop: false }, gone: { frames: ['c'] } } };
const check = (recipe, options = {}) => checkDelivery(renderProject(recipe), { recipe, ...options });
// The fixes quote a pixel_patch change; this reads it back, to prove it is a change patchRecipe accepts.
const quoted = fix => JSON.parse(fix.slice(fix.indexOf('pixel_patch ') + 12, fix.lastIndexOf(', then render again')));
// The changes a canvas-size fix quotes, "(pixel_patch [...])" or one change, as a list.
const quotedSets = fix => [JSON.parse(fix.slice(fix.indexOf('(pixel_patch ') + 13, fix.indexOf('), fit the drawing')))].flat();

test('the render check reports what was delivered, and a hint, when nothing was asked for', () => {
  const plain = check(spirit, { gifs: [] });
  assert.deepEqual(plain.delivered, { size: [24, 24], animations: { idle: { frames: 7, loop: true }, bob: { frames: 4, loop: true }, blink: { frames: 3, loop: false } }, colors: 7, transparent: true, partlyTransparent: true });
  assert.equal(plain.ok, undefined); assert.equal(plain.problems, undefined); assert.match(plain.hint, /Pass expect .*gifScale/);
  // A command that writes no GIFs (the CLI's render) doesn't offer gifScale.
  assert.doesNotMatch(check(spirit).hint, /gifScale/);
  const project = renderProject(small), { delivered, notes } = checkDelivery(project, { recipe: small, gifs: [animationGIF(project, 'flash', { scale: 2 })] });
  // Fully transparent pixels are not colours; a frame with one clear pixel makes the delivery partly transparent.
  assert.deepEqual([delivered.colors, delivered.transparent, delivered.gifs], [2, 'some frames', [8, 4]]);
  assert.deepEqual(notes, ['Frame "c" is fully transparent; if that is not intended, draw it (pixel_patch) or take it out of the animation.']);
  assert.throws(() => check(small, { animation: 'nope' }), error => error instanceof PixelError && error.path === 'animation');
});

test('the render check passes a delivery that matches the request and names each mismatch with its fix', () => {
  const project = renderProject(spirit), gifs = Object.keys(project.animations).map(name => animationGIF(project, name, {}));
  const match = check(spirit, { gifs, expect: { width: 24, height: 24, colors: 7, transparent: true } });
  assert.deepEqual([match.ok, match.problems], [true, undefined]);
  assert.equal(check(spirit, { expect: { frames: 3, loop: false }, animation: 'blink' }).ok, true);
  const miss = check(spirit, { gifs: [animationGIF(project, 'idle', { scale: 8 })], expect: { width: 32, height: 32, frames: 7, colors: 4, transparent: false, loop: true }, animation: 'idle' });
  assert.equal(miss.ok, false);
  assert.deepEqual(miss.problems.map(problem => [problem.file, problem.asked, problem.got]), [
    ['forest-spirit.png, frames/ and animations/', { width: 32, height: 32 }, { width: 24, height: 24 }],
    ['gifs/idle.gif', { width: 32, height: 32 }, { width: 192, height: 192 }],
    ['forest-spirit.png, frames/ and animations/', 'at most 4 colours', 7],
    ['forest-spirit.png, frames/ and animations/', 'an opaque background', 'transparent or partly transparent pixels in "rest", "rise", "float", "blink", "fall", "settle"']
  ]);
  // Both asked sides are patched: the first alone left a 32x24 canvas.
  assert.deepEqual(quotedSets(miss.problems[0].fix), [{ set: 'width', value: 32 }, { set: 'height', value: 32 }]);
  assert.equal(check(patchRecipe(spirit, quotedSets(miss.problems[0].fix)).recipe, { expect: { width: 32, height: 32 } }).ok, true);
  assert.match(check(spirit, { expect: { width: 32 } }).problems[0].fix, /\(pixel_patch \{ "set": "width", "value": 32 \}\)/);
  // 32 is no whole multiple of 24, so the GIF waits for the frame size; an asked 24 needs scale 1.
  assert.match(miss.problems[1].fix, /fix the frame size first/);
  const native = check(spirit, { gifs: [animationGIF(project, 'idle', { scale: 8 })], expect: { width: 24 } });
  assert.deepEqual([native.ok, native.problems], [true, undefined]);
  assert.match(native.notes.at(-1), /^The GIFs are 8 times the frame size \(192×192\).*"gif": \{ "scale": 1 \} or "gif": \{\}\.$/);
  // A GIF scale chosen on purpose is not a problem when the request names no size.
  assert.equal(check(spirit, { gifs: [animationGIF(project, 'idle', { scale: 8 })], expect: { frames: 7 }, animation: 'idle' }).ok, true);
  // gifScale: GIFs at that multiple of the asked frame size, and a missing GIF when the command makes GIFs at all.
  assert.equal(check(spirit, { gifs: [animationGIF(project, 'idle', { scale: 4 })], expect: { gifScale: 4 } }).ok, true);
  assert.deepEqual(check(spirit, { gifs: [], expect: { gifScale: 4 } }).problems.map(problem => [problem.got, problem.fix]), [['no GIF', 'render again with "gif": { "scale": 4 }']]);
  assert.equal(check(spirit, { expect: { gifScale: 4 } }).ok, true);
  // A GIF background makes an opaque GIF with one more colour, though the frames meet the request.
  const dot = { version: 1, name: 'dot', width: 2, height: 2, palette: { r: '#ff0000' }, frames: [{ name: 'a', ops: [{ op: 'pixel', x: 0, y: 0, color: 'r' }] }] }, dotProject = renderProject(dot);
  const matte = check(dot, { gifs: [animationGIF(dotProject, undefined, { background: '#ffffff' })], expect: { transparent: true, colors: 1 } });
  assert.deepEqual(matte.problems.map(problem => [problem.file, problem.asked, problem.got]), [['gifs/default.gif', 'a transparent background', 'an opaque GIF'], ['gifs/default.gif', 'at most 1 colours', 2]]);
  assert.equal(check(dot, { gifs: [animationGIF(dotProject, undefined, {})], expect: { transparent: true, colors: 1 } }).ok, true);
  // With one animation named, only its GIF is checked: an opaque, three-colour "sky" doesn't fail the "sprite".
  const two = { ...dot, palette: { r: '#ff0000', b: '#0000ff', w: '#ffffff' }, frames: [...dot.frames, { name: 'sky', ops: [{ op: 'rect', x: 0, y: 0, w: 2, h: 2, color: 'b' }, { op: 'pixel', x: 1, y: 1, color: 'w' }, { op: 'pixel', x: 0, y: 1, color: 'r' }] }], animations: { sprite: { frames: ['a'] }, sky: { frames: ['sky'] } } }, twoProject = renderProject(two);
  const both = ['sprite', 'sky'].map(name => animationGIF(twoProject, name, {}));
  assert.equal(check(two, { gifs: both, expect: { transparent: true, colors: 1 }, animation: 'sprite' }).ok, true);
  assert.equal(check(two, { gifs: both, expect: { transparent: true, colors: 1 } }).ok, false);
  const solid = { ...dot, background: 'r' }, solidProject = renderProject(solid);
  assert.equal(check(solid, { gifs: [animationGIF(solidProject, undefined, {})], expect: { transparent: false } }).ok, true);
});

test('the render check fixes sheet.scale with whole multiples, from either side alone', () => {
  const scaled = { ...spirit, sheet: { scale: 4 } }, big = check(scaled, { expect: { width: 24 } });
  assert.deepEqual([big.delivered.size, big.delivered.canvas, big.delivered.scale, big.problems[0].asked], [[96, 96], [24, 24], 4, { width: 24 }]);
  assert.deepEqual(quoted(big.problems[0].fix.replace(/^.*?: (?=pixel_patch)/, '')), { set: 'sheet.scale', value: 1 });
  assert.deepEqual(quoted(check(scaled, { expect: { height: 48 } }).problems[0].fix), { set: 'sheet.scale', value: 2 });
  assert.equal(check(scaled, { expect: { width: 96 } }).ok, true);
  // GIFs ignore sheet.scale: at sheet.scale 2 an asked 48x48 GIF is gif scale 2 of the 24 canvas.
  const twice = { ...spirit, sheet: { scale: 2 } }, project = renderProject(twice);
  assert.equal(check(twice, { gifs: [animationGIF(project, 'idle', { scale: 2 })], expect: { width: 48, height: 48 }, animation: 'idle' }).ok, true);
  const tiny = check(twice, { gifs: [animationGIF(project, 'idle', {})], expect: { width: 48, height: 48 }, animation: 'idle' });
  assert.deepEqual(tiny.problems.map(problem => [problem.got, problem.fix]), [[{ width: 24, height: 24 }, 'render again with "gif": { "scale": 2 }']]);
  // A GIF scale above 16 can't be made: say so rather than blame the frame size.
  assert.match(check(scaled, { gifs: [animationGIF(renderProject(scaled), 'idle', {})], expect: { gifScale: 8 }, animation: 'idle' }).problems[0].fix, /needs scale 32, above the limit of 16/);
  // A recipe with no sheet field gets a change that creates it, which patchRecipe accepts.
  const fix = check(small, { expect: { width: 8, height: 4 } }).problems[0].fix;
  assert.deepEqual(quoted(fix), { set: 'sheet', value: { scale: 2 } });
  assert.equal(check(patchRecipe(small, [quoted(fix)]).recipe, { expect: { width: 8, height: 4 } }).ok, true);
});

test('the render check sees frame counts, pingpong, loops, recipes without animations and backgrounds', () => {
  // "gone" plays one frame beside the two-frame "flash": a still, left out of one count for every animation, with a note.
  const tile = check(small, { expect: { frames: 2, loop: true, transparent: true } });
  assert.deepEqual(tile.problems.map(problem => [problem.file, problem.asked, problem.got]), [
    ['tile.png, frames/ and animations/', 'a transparent background', 'no transparent pixel in "a"'],
    ['animations/flash.png', 'a loop', 'one play']
  ]);
  assert.match(tile.notes.at(-1), /^expect\.frames counts the frames each animation plays; "gone" plays one frame .* \{ "gone": 1 \}\.$/);
  assert.deepEqual(quoted(tile.problems[1].fix), { set: 'animations.flash.loop', value: true });
  // A count per animation checks the still too.
  assert.deepEqual(check(small, { expect: { frames: { gone: 2 } } }).problems.map(problem => [problem.file, problem.asked, problem.got]), [['animations/gone.png', 2, 1]]);
  // With one animation named, only its frames count: "c" is not in flash.
  assert.equal(check(small, { expect: { transparent: false }, animation: 'flash' }).problems[0].got, 'transparent pixels in "b"');
  assert.equal(check(small, { expect: { transparent: false } }).problems[0].got, 'transparent pixels in "b", "c"');
  assert.equal(check(small, { animation: 'flash' }).notes, undefined);
  // bob is pingpong: 3 names play 4 frames, so 6 played frames need 4 names (or forward).
  assert.match(check(spirit, { expect: { frames: 6 }, animation: 'bob' }).problems[0].fix, /pingpong.*list 4 names in animations\.bob\.frames, or set animations\.bob\.direction to "forward" and list 6 names/);
  assert.equal(check(spirit, { expect: { frames: 4 }, animation: 'bob' }).ok, true);
  // Without an animations field every frame plays once, and the fixes create the field instead of patching a missing one.
  const { animations, ...bare } = small, loose = check(bare, { expect: { loop: false, frames: 2 } });
  assert.match(loose.problems[0].fix, /no animations field, so every frame plays once/);
  const change = quoted(loose.problems[1].fix.replace('the recipe has no animations field: ', ''));
  assert.deepEqual(change, { set: 'animations', value: { default: { frames: ['a', 'b', 'c'], loop: false } } });
  assert.equal(check(patchRecipe(bare, [change]).recipe, { expect: { loop: false } }).ok, true);
});

test('expect.frames takes a count per animation, and a count that only the whole sheet makes says so', () => {
  // spirit: idle plays 7, bob 4 (pingpong of 3 names), blink 3 once.
  assert.deepEqual(readExpect({ frames: { idle: 7, bob: 4 } }), { frames: { idle: 7, bob: 4 } });
  assert.equal(check(spirit, { expect: { frames: { idle: 7, bob: 4, blink: 3 } } }).ok, true);
  const per = check(spirit, { expect: { frames: { idle: 8, walk: 4 } } });
  assert.deepEqual(per.problems.map(problem => [problem.file, problem.asked, problem.got]), [['animations/idle.png', 8, 7], ['animations/walk.png', 4, 'no such animation']]);
  assert.match(per.problems[1].fix, /no animation "walk" \(it has "idle", "bob", "blink"\)/);
  // With one animation named, only its entry is checked.
  assert.equal(check(spirit, { expect: { frames: { idle: 8, blink: 3 } }, animation: 'blink' }).ok, true);
  // One count that no animation plays, while the animations hold that many different frames: one problem that explains
  // the count, never a fix that pads each animation to the sheet's total.
  const knight = { version: 1, name: 'knight', width: 2, height: 2, palette: { r: '#ff0000' },
    frames: Array.from({ length: 6 }, (_, i) => ({ name: `f${i}`, ops: [{ op: 'pixel', x: i % 2, y: i >> 2, color: 'r' }] })),
    animations: { idle: { frames: ['f0', 'f1'] }, walk: { frames: ['f2', 'f3', 'f4', 'f5'] } } };
  const total = check(knight, { expect: { frames: 6 } });
  assert.deepEqual(total.problems.map(problem => [problem.file, problem.asked, problem.got]), [['animations/', 6, { idle: 2, walk: 4 }]]);
  assert.match(total.problems[0].fix, /^expect\.frames counts the frames each animation plays, and none plays 6, but the 2 animations hold 6 different frames\. .*"expect": \{ "frames": \{"idle":2,"walk":4\} \}/);
  assert.doesNotMatch(total.problems[0].fix, /repeat/);
  assert.equal(check(knight, { expect: { frames: { idle: 2, walk: 4 } } }).ok, true);
  // A sheet of stills (props, one frame each) asked for its number of frames gets the same explanation.
  const props = { ...knight, animations: Object.fromEntries(knight.frames.slice(0, 3).map(frame => [frame.name, { frames: [frame.name] }])) };
  assert.deepEqual(check(props, { expect: { frames: 3 } }).problems.map(problem => problem.got), [{ f0: 1, f1: 1, f2: 1 }]);
  // A count some animations play: the others' fixes also offer checking just those.
  const some = check(knight, { expect: { frames: 4 } });
  assert.deepEqual(some.problems.map(problem => problem.file), ['animations/idle.png']);
  assert.match(some.problems[0].fix, /; or, if the request was 4 frames for "walk" only, check per animation: "frames": \{"walk":4\}$/);
});

test('GIFs enlarged by the scale the call gave are noted, not failed, until expect says what size was asked for', () => {
  const project = renderProject(spirit), enlarged = check(spirit, { gifs: [animationGIF(project, 'idle', { scale: 8 })], expect: { width: 24 }, animation: 'idle' });
  assert.deepEqual([enlarged.ok, enlarged.problems], [true, undefined]);
  assert.equal(enlarged.notes.at(-1), 'The GIFs are 8 times the frame size (192×192), as the scale asked for makes them. If the user asked for GIFs that size, "gifScale": 8 in expect checks it; if they asked for GIFs at the frames\' own size, render again with "gif": { "scale": 1 } or "gif": {}.');
  // Said to be another size, a GIF is a problem with its fix.
  const other = check(spirit, { gifs: [animationGIF(project, 'idle', { scale: 8 })], expect: { width: 24, gifScale: 2 }, animation: 'idle' });
  assert.deepEqual([other.ok, other.problems[0].fix], [false, 'render again with "gif": { "scale": 2 }']);
  assert.equal(check(spirit, { gifs: [animationGIF(project, 'idle', { scale: 8 })], expect: { width: 24, gifScale: 8 }, animation: 'idle' }).ok, true);
});

// The changes a size fix quotes as a JSON array, after `pixel_patch ` or `(or `.
const changesAfter = (fix, marker) => { const start = fix.indexOf(marker) + marker.length - 1; return JSON.parse(fix.slice(start, fix.indexOf(']', start) + 1)); };

test('the render check\'s fixes stay inside the format\'s limits, and applying them passes the check', () => {
  // Past an animation frame's 262,144 pixels: a smaller canvas at a whole sheet.scale, the one nearest the drawing and
  // the most detailed.
  const big = check(spirit, { expect: { width: 1024, height: 1024 } }).problems[0].fix;
  assert.match(big, /^an animation frame is at most 1024 pixels a side and 262,144 in all, so 1024x1024 is a 64x64 canvas at sheet\.scale 16, the nearest to the current 24x24: .*a 512x512 canvas at sheet\.scale 2, for the most detail\)/);
  for (const changes of [changesAfter(big, 'pixel_patch ['), changesAfter(big, '(or [')]) {
    assert.equal(check(patchRecipe(spirit, changes).recipe, { expect: { width: 1024, height: 1024 } }).ok, true, JSON.stringify(changes));
  }
  // A size a frame holds is the canvas itself.
  const framed = check(spirit, { expect: { width: 512, height: 512 } }).problems[0].fix;
  assert.match(framed, /^the canvas is 24x24: change the recipe's width and height \(pixel_patch \[/);
  assert.equal(check(patchRecipe(spirit, quotedSets(framed)).recipe, { expect: { width: 512, height: 512 } }).ok, true);
  // One side asked: the other keeps its canvas size. 1200 = 75 x 16 is nearest 24.
  const wide = check(spirit, { expect: { width: 1200 } }).problems[0].fix;
  assert.deepEqual(changesAfter(wide, 'pixel_patch ['), [{ set: 'width', value: 75 }, { set: 'sheet.scale', value: 16 }]);
  assert.equal(check(patchRecipe(spirit, changesAfter(wide, 'pixel_patch [')).recipe, { expect: { width: 1200 } }).ok, true);
  // An atlas the renderer refuses is never offered: 100 frames of 512x512 pass 16,777,216 pixels at any scale.
  const dots = { version: 1, name: 'dots', width: 2, height: 2, palette: { r: '#ff0000' }, frames: Array.from({ length: 100 }, (_, i) => ({ name: `f${i}`, ops: [{ op: 'pixel', x: 0, y: 0, color: 'r' }] })) };
  assert.equal(check(dots, { expect: { width: 512, height: 512 } }).problems[0].fix, 'at every whole scale that makes 512x512, an atlas of 100 frames at 512x512 passes 16,777,216 pixels: ask for fewer frames or a smaller size, or set sheet.trim if the frames have empty margins');
  // The same budgets hold a whole-scale fix: 100 frames of 64x64 at sheet.scale 8 would make that atlas too.
  const tiles = { ...dots, width: 64, height: 64 };
  assert.equal(check(tiles, { expect: { width: 512, height: 512 } }).problems[0].fix, 'an atlas of 100 frames at 512x512 passes 16,777,216 pixels: ask for fewer frames or a smaller size, or set sheet.trim if the frames have empty margins');
  // A trimmed atlas is measured by rendering the change: five full 256x256 frames at sheet.scale 8 pack too large,
  // while one-pixel frames pack small enough for the same scale. Each full frame has a mark of its own: frames that
  // show one picture share a cell.
  const full = { version: 1, name: 'full', width: 256, height: 256, palette: { r: '#ff0000', g: '#00ff00' }, sheet: { trim: true }, frames: Array.from({ length: 5 }, (_, i) => ({ name: `f${i}`, ops: [{ op: 'rect', x: 0, y: 0, w: 256, h: 256, color: 'r' }, { op: 'pixel', x: i, y: 0, color: 'g' }] })) };
  assert.equal(check(full, { expect: { width: 2048, height: 2048 } }).problems[0].fix, 'an atlas of 5 trimmed frames at sheet.scale 8 passes 16,777,216 pixels: ask for fewer frames or a smaller size');
  const specks = { ...full, frames: full.frames.map(frame => ({ ...frame, ops: [{ op: 'pixel', x: 0, y: 0, color: 'r' }] })) };
  assert.deepEqual(quoted(check(specks, { expect: { width: 2048, height: 2048 } }).problems[0].fix), { set: 'sheet.scale', value: 8 });
  // At a new canvas too: 100 one-pixel trimmed frames on 16x16 asked 512x512 pack into a small atlas at 32x32, scale 16.
  const dust = { version: 1, name: 'dust', width: 16, height: 16, palette: { r: '#ff0000' }, sheet: { trim: true }, frames: Array.from({ length: 100 }, (_, i) => ({ name: `f${i}`, ops: [{ op: 'pixel', x: 0, y: 0, color: 'r' }] })) };
  const dusty = check(dust, { expect: { width: 512, height: 512 } }).problems[0].fix;
  assert.deepEqual(changesAfter(dusty, 'pixel_patch ['), [{ set: 'width', value: 32 }, { set: 'height', value: 32 }, { set: 'sheet.scale', value: 16 }]);
  assert.equal(check(patchRecipe(dust, changesAfter(dusty, 'pixel_patch [')).recipe, { expect: { width: 512, height: 512 } }).ok, true);
  // Frame-count fixes are held to the animation pixels: 300 frames of 256x256 at sheet.scale 2 pass 67,108,864.
  const poster = { version: 1, name: 'poster', width: 256, height: 256, palette: { r: '#ff0000' }, sheet: { scale: 2 }, frames: [{ name: 'a', ops: [{ op: 'pixel', x: 0, y: 0, color: 'r' }] }] };
  assert.equal(check(poster, { expect: { frames: 300 } }).problems[0].fix, '300 frames in "default" make 300 played frames at 512x512, past the 67,108,864 animation pixels an export holds: ask for fewer frames or a smaller size');
  // The nearest size offered when no whole scale fits is held to the same budgets: 200 played frames at 4092x96.
  const repeated = { ...spirit, animations: { idle: { frames: Array(200).fill('rest') } } };
  assert.match(check(repeated, { expect: { width: 4093 } }).problems[0].fix, /and the nearest size, 4092x96, is refused too \(200 played frames at 4092x96 pass the 67,108,864 animation pixels an export holds\): tell the user, and ask for fewer frames or a smaller size$/);
  // Many animations: each frame-count fix is weighed against one count of the played frames, not a rescan.
  const many = { version: 1, name: 'many', width: 1, height: 1, palette: { r: '#f00' }, frames: [{ name: 'a', ops: [{ op: 'pixel', x: 0, y: 0, color: 'r' }] }], animations: Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [`m${i}`, { frames: ['a'] }])) };
  const crowd = check(many, { expect: { frames: 2 } });
  assert.deepEqual([crowd.problems.length, crowd.problems[0].file], [16, 'animations/m0.png']);
  // A GIF scale is held to the 67,108,864 pixels one render's GIFs hold: 300 frames at 32x32, scale 16.
  const reel = { version: 1, name: 'reel', width: 32, height: 32, palette: { r: '#ff0000' }, frames: [{ name: 'a', ops: [{ op: 'pixel', x: 0, y: 0, color: 'r' }] }], animations: { default: { frames: Array(300).fill('a') } } }, reelProject = renderProject(reel);
  assert.match(check(reel, { gifs: [animationGIF(reelProject, 'default', {})], expect: { gifScale: 16 } }).problems[0].fix, /^the GIFs of every animation at scale 16 pass the 67,108,864 pixels/);
  // Partly transparent pixels are reported as such, and don't count as an opaque delivery.
  const glass = { version: 1, name: 'glass', width: 2, height: 2, palette: { g: '#ff000080' }, frames: [{ name: 'a', ops: [{ op: 'rect', x: 0, y: 0, w: 2, h: 2, color: 'g' }] }] };
  const glassy = check(glass, { expect: { transparent: false } });
  assert.deepEqual([glassy.delivered.transparent, glassy.delivered.partlyTransparent, glassy.problems[0].got], [false, true, 'transparent or partly transparent pixels in "a"']);
  const forty = { ...dots, frames: dots.frames.slice(0, 40) }, roomy = check(forty, { expect: { width: 512, height: 512 } }).problems[0].fix;
  assert.equal(check(patchRecipe(forty, changesAfter(roomy, '(or [')).recipe, { expect: { width: 512, height: 512 } }).ok, true);
  // No whole scale: say so and offer the nearest size that exists.
  assert.match(check(spirit, { expect: { width: 4093 } }).problems[0].fix, /^an animation frame is at most 1024 pixels a side and 262,144 in all, sheet\.scale at most 16, and no whole scale exports a width of 4093 exactly from 6 frames: tell the user, and offer 4092x96 \(a 1023x24 canvas at sheet\.scale 4\) instead$/);
  // Asked both sides, the nearest canvas also keeps a frame's area: 1021x1021 is a 511x511 canvas at scale 2, not
  // 1021x1021 at scale 1 (1,042,441 pixels).
  assert.match(check(spirit, { expect: { width: 1021, height: 1021 } }).problems[0].fix, /exactly from 6 frames: tell the user, and offer 1022x1022 \(a 511x511 canvas at sheet\.scale 2\) instead$/);
  assert.match(check(spirit, { expect: { width: 4093, height: 4093 } }).problems[0].fix, /and the nearest size, 4096x4096, is refused too \(14 played frames at 4096x4096 pass/);

  // An opaque background asked for, with pixels erased after the background: name what erases them.
  const cleared = { version: 1, name: 'cleared', width: 4, height: 2, background: 'r', palette: { r: '#ff0000' }, frames: [{ name: 'a', ops: [{ op: 'clear', x: 0, y: 0, w: 1, h: 1 }] }, { name: 'b', from: 'a' }] };
  assert.equal(check(cleared, { expect: { transparent: false } }).problems[0].fix, 'the background is already opaque, but frame drawing erases it (clear in "a"): remove those or paint over what they clear, then render again');
  assert.equal(check(patchRecipe(cleared, [{ remove: 'frames[a].ops[0]' }]).recipe, { expect: { transparent: false } }).ok, true);
  const shifted = { ...cleared, frames: [{ name: 'a', translate: [1, 0], ops: [{ op: 'dither', erase: true, density: 0.5 }] }] };
  assert.match(check(shifted, { expect: { transparent: false } }).problems[0].fix, /\(dither with erase, translate in "a"\)/);
  assert.equal(check({ ...shifted, frames: [{ name: 'a', translate: [1, 0], wrap: true }] }, { expect: { transparent: false } }).ok, true);
  assert.equal(check(small, { expect: { transparent: false } }).problems[0].fix, 'pixel_patch { "set": "background", "value": "<palette key>" }, and remove or paint over what erases it (clear in "b"), then render again');
  assert.match(check({ ...cleared, background: '#ff000080', frames: [{ name: 'a' }] }, { expect: { transparent: false } }).problems[0].fix, /an opaque one: the current background is see-through/);
  // Whether a background is enough is measured by rendering with one: here only "b" stays see-through, by its clear.
  const lit = { ...small, palette: { ...small.palette, k: 'transparent' }, frames: [...small.frames.slice(0, 2), { name: 'c', ops: [{ op: 'rect', x: 0, y: 0, w: 4, h: 2, color: 'r' }, { op: 'fill', x: 0, y: 0, color: 'k' }] }] };
  const filled = check(lit, { expect: { transparent: false } }).problems[0].fix;
  assert.equal(filled, 'pixel_patch { "set": "background", "value": "<palette key>" }, and remove or paint over what erases it (clear, fill to a see-through colour in "b", "c"), then render again');
  const unfilled = check({ ...lit, frames: lit.frames.slice(0, 1), animations: undefined }, { expect: { transparent: false } });
  assert.equal(unfilled.ok, true);
  const plainFix = check({ ...lit, frames: [{ name: 'a' }], animations: undefined }, { expect: { transparent: false } }).problems[0].fix;
  assert.equal(plainFix, 'pixel_patch { "set": "background", "value": "<palette key>" }, then render again');
  // Pixel corrections replace the RGBA last, so a half-transparent one stays see-through over any background.
  const glazed = { ...cleared, palette: { r: '#ff0000', g: '#00ff0080' }, frames: [{ name: 'a', pixels: [{ x: 0, y: 0, color: 'g' }] }] };
  assert.equal(check(glazed, { expect: { transparent: false } }).problems[0].fix, 'the background is already opaque, but frame drawing erases it (partly transparent pixels in "a"): remove those or paint over what they clear, then render again');
  assert.match(check({ ...glazed, background: undefined }, { expect: { transparent: false } }).problems[0].fix, /, and remove or paint over what erases it \(partly transparent pixels in "a"\), then render again$/);

  // Frame counts: a recipe holds 256 frames and an animation lists 1,024 names, which may repeat.
  const bare = { version: 1, name: 'bare', width: 2, height: 2, palette: { r: '#ff0000' }, frames: [{ name: 'a', ops: [{ op: 'pixel', x: 0, y: 0, color: 'r' }] }] };
  assert.match(check(bare, { expect: { frames: 300 } }).problems[0].fix, /a recipe holds at most 256 frames: add an animation that lists 300 frame names/);
  assert.equal(check({ ...bare, animations: { default: { frames: Array(300).fill('a') } } }, { expect: { frames: 300 } }).ok, true);
  assert.match(check({ ...bare, width: 256, height: 256 }, { expect: { frames: 100 } }).problems[0].fix, /100 frames of 256x256 pass the limit of 4,194,304 pixels of frames: add an animation/);
  // Above 1,024 only a pingpong plays it, 2n - 2 frames for n names, so an odd count can't be played.
  assert.match(check(bare, { expect: { frames: 2046 } }).problems[0].fix, /a pingpong animation of 1024 frame names, which plays 2046/);
  assert.equal(check({ ...bare, animations: { default: { frames: Array(1024).fill('a'), direction: 'pingpong' } } }, { expect: { frames: 2046 } }).ok, true);
  assert.match(check(bare, { expect: { frames: 1025 } }).problems[0].fix, /^no animation plays 1025 frames: .*play 1024 or 1026$/);
  assert.match(check(spirit, { expect: { frames: 1500 }, animation: 'idle' }).problems[0].fix, /set animations\.idle\.direction to "pingpong" and list 751 names, which play 1500$/);
  assert.equal(check(spirit, { expect: { frames: 2046 }, animation: 'bob' }).problems[0].fix, '"bob" is pingpong, which plays 2n-2 frames for n names: list 1024 names in animations.bob.frames');
  // More frames than an animation plays are new poses; a repeated name is offered only as a hold.
  assert.match(check(spirit, { expect: { frames: 9 }, animation: 'idle' }).problems[0].fix, /^make "idle" play 9 frames: draw the 2 more poses it needs \(pixel_patch insert under frames.*list all 9 names in animations\.idle\.frames; repeat a name only for a deliberate hold, then render again$/);
  assert.equal(check(spirit, { expect: { frames: 5 }, animation: 'idle' }).problems[0].fix, 'make "idle" play 5 frames: compile its preset or source again with frames: 5 (--frames 5), or list 5 names in animations.idle.frames, keeping evenly spaced poses, then render again');
  // expect.frames reaches the longest pingpong: 514 names play 1,026 frames.
  assert.equal(check({ ...bare, animations: { default: { frames: Array(514).fill('a'), direction: 'pingpong' } } }, { expect: { frames: 1026 } }).ok, true);
  assert.deepEqual(readExpect({ frames: 2046 }), { frames: 2046 });
});

test('expect is refused by name when it is malformed', () => {
  assert.equal(readExpect(undefined), undefined);
  for (const [expect, where] of [[null, 'expect'], [[], 'expect'], [{ size: 32 }, 'expect.size'], [{ width: 0 }, 'expect.width'], [{ frames: 1.5 }, 'expect.frames'], [{ frames: 2047 }, 'expect.frames'], [{ frames: {} }, 'expect.frames'], [{ frames: { walk: 0 } }, 'expect.frames.walk'], [{ frames: { walk: '8' } }, 'expect.frames.walk'], [{ frames: [8] }, 'expect.frames'], [{ frames: null }, 'expect.frames'], [{ width: 4097 }, 'expect.width'], [{ gifScale: 17 }, 'expect.gifScale'], [{ loop: 'yes' }, 'expect.loop']]) {
    assert.throws(() => readExpect(expect), error => error instanceof PixelError && error.path === where, JSON.stringify(expect));
  }
  // A count under an animation's name points to expect.frames, with every such count and those frames already gives;
  // a name the recipe does not animate gets the list of fields.
  const named = { animations: { intro: { frames: ['a'] }, idle: { frames: ['a'] }, loop: { frames: ['a'] } } };
  assert.throws(() => readExpect({ width: 640, height: 360, intro: 6, idle: 6 }, named), error => error.path === 'expect.intro' && error.message.endsWith('unknown field; "intro" is an animation, and a count per animation goes in expect.frames: {"frames": {"intro": 6, "idle": 6}}'));
  assert.throws(() => readExpect({ frames: { walk: 2 }, loop: true, idle: 0 }, named), error => error.path === 'expect.idle' && error.message.endsWith('{"frames": {"walk": 2, "idle": 1}}'));
  for (const recipe of [undefined, named, { animations: [] }]) assert.throws(() => readExpect({ walk: 6 }, recipe), error => error.path === 'expect.walk' && error.message.endsWith('unknown field; use width, height, frames, colors, transparent, loop, gifScale or sheet'));
  assert.equal(readExpect({ frames: { intro: 6, idle: 6 } }, named).frames.intro, 6);
});

test('MCP pixel_render and CLI render carry the check, and a bad expect or animation writes nothing', async t => {
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelbolt-check-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const messages = [{ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'pixel_render', arguments: { project: spirit, gif: { scale: 8 }, expect: { width: 24, height: 24 } } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'pixel_render', arguments: { project: spirit, expect: { width: '24' } } } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'pixel_render', arguments: { project: spirit, expect: { idle: 7 } } } }];
  const result = spawnSync(process.execPath, ['bin/pixelbolt.js', 'mcp', '--out', path.join(dir, 'mcp')], { cwd: root, input: messages.map(message => JSON.stringify(message)).join('\n') + '\n', encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  const [, rendered, refused, misplaced] = result.stdout.trim().split('\n').map(line => JSON.parse(line).result);
  const info = JSON.parse(rendered.content[0].text);
  // The frames are the 24 asked for, and the GIFs 8 times that by the scale the call gave: noted, not failed.
  assert.deepEqual([info.check.ok, info.check.delivered.gifs, info.check.problems], [true, [192, 192], undefined]);
  assert.match(info.check.notes.at(-1), /^The GIFs are 8 times the frame size \(192×192\)/);
  assert.deepEqual([refused.isError, JSON.parse(refused.content[0].text).path], [true, 'expect.width']);
  // The recipe's animation names reach the refusal.
  assert.match(JSON.parse(misplaced.content[0].text).error, /expect\.frames: \{"frames": \{"idle": 7\}\}$/);
  // Only the first render wrote a folder.
  assert.equal((await readdir(path.join(dir, 'mcp'))).filter(name => !name.startsWith('.')).length, 1);
  const cli = (...args) => spawnSync(process.execPath, ['bin/pixelbolt.js', 'render', 'examples/forest-spirit.json', ...args], { cwd: root, encoding: 'utf8' });
  const out = cli('--out', path.join(dir, 'cli'), '--expect', '{"frames":3,"loop":false,"gifScale":2}', '--animation', 'blink');
  assert.equal(out.status, 0, out.stderr);
  // render writes no GIFs, so gifScale asks nothing of it; blink plays 3 frames once.
  const report = JSON.parse(out.stdout).check;
  assert.deepEqual([report.ok, report.delivered.animations], [true, { blink: { frames: 3, loop: false } }]);
  for (const [args, where] of [[['--expect', '{"width":'], 'expect'], [['--animation', 'nope'], 'animation'], [['--expect', '{"bob":4}'], 'expect.bob']]) {
    const bad = cli('--out', path.join(dir, 'bad'), ...args);
    assert.deepEqual([bad.status, JSON.parse(bad.stderr).path], [1, where]);
    if (where === 'expect.bob') assert.match(JSON.parse(bad.stderr).error, /\{"frames": \{"bob": 4\}\}$/);
  }
  await assert.rejects(readdir(path.join(dir, 'bad')));
});

test('a delivery with nothing visible fails the check, with or without expect; a few empty frames are only a note', () => {
  const blank = { version: 1, name: 'blank', width: 4, height: 4, palette: { r: '#ff0000' }, frames: [{ name: 'a' }, { name: 'b' }] };
  const plain = check(blank);
  assert.equal(plain.ok, false); assert.equal(plain.notes, undefined); assert.match(plain.hint, /Pass expect/);
  assert.deepEqual(plain.problems.map(problem => [problem.file, problem.asked, problem.got]), [['blank.png, frames/ and animations/', 'something visible', 'all 2 frames, fully transparent']]);
  assert.match(plain.problems[0].fix, /compile warnings, fix the source \(a pose part without attach stands at the pose origin plus its at\)/);
  // With expect, the specific mismatches come first, and the cap of 16 problems never drops nothing-visible.
  assert.deepEqual(check(blank, { expect: { width: 8 } }).problems.map(problem => problem.asked), [{ width: 8 }, 'something visible']);
  const many = { ...blank, animations: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`m${i}`, { frames: ['a'] }])) };
  const capped = check(many, { expect: { frames: 2 } }).problems;
  assert.equal(capped.length, 16); assert.equal(capped.at(-1).asked, 'something visible');
  // small: "c" is empty while "a" and "b" are drawn, which is a note; its "gone" animation alone shows nothing.
  const some = check(small);
  assert.equal(some.ok, undefined); assert.equal(some.notes.length, 1);
  const gone = check(small, { animation: 'gone' });
  assert.deepEqual([gone.ok, gone.problems[0].file, gone.problems[0].got], [false, 'animations/gone.png', 'one frame, fully transparent']);
});

test('the render check does not note the empty frames that end a one-shot, only empty frames elsewhere', () => {
  const recipe = { version: 1, name: 'puff', width: 2, height: 2, palette: { r: '#ff0000' },
    frames: [{ name: 'a', ops: [{ op: 'pixel', x: 0, y: 0, color: 'r' }] }, { name: 'gap', ops: [] }, { name: 'end', ops: [] }],
    animations: { puff: { frames: ['a', 'gap', 'a', 'end'], loop: false } } };
  // 'end' only ends the one-shot; 'gap' sits between drawn frames.
  assert.deepEqual(check(recipe).notes, ['Frame "gap" is fully transparent; if that is not intended, draw it (pixel_patch) or take it out of the animation.']);
  // The same empty frame in a loop is still noted.
  const looped = structuredClone(recipe); looped.animations.puff.loop = true;
  assert.match(check(looped).notes[0], /Frames "gap" and "end" are fully transparent|"gap".*"end"/);
});

test('the render check delivers stills by count, judges no motion, and counts expect.frames as frames', () => {
  const stills = { ...small, animations: {} }, plain = check(stills);
  assert.deepEqual(plain.delivered, { size: [4, 2], stills: 3, colors: 2, transparent: 'some frames' });
  assert.equal(plain.motion, undefined);
  assert.deepEqual(plain.notes, ['Frame "c" is fully transparent; if that is not intended, draw it (pixel_patch) or remove it.']);
  assert.equal(check(stills, { expect: { frames: 3 } }).ok, true);
  const missed = check(stills, { expect: { frames: 4, loop: true } });
  assert.deepEqual(missed.problems.map(problem => [problem.file, problem.asked, problem.got]), [['tile.png and frames/', 4, 3], ['animations/', 'a loop', 'stills']]);
  assert.match(missed.problems[1].fix, /^the frames are stills \("animations": \{\} in the recipe\), so there is no animation to loop: /);
});

test('a still asked past 256 is offered a smaller canvas enlarged and itself, held to a still\'s limits; an animation up to 1024 is the canvas', () => {
  const dots = (width, height, count) => ({ version: 1, name: 'dots', width, height, palette: { r: '#ff0000' }, frames: Array.from({ length: count }, (_, i) => ({ name: `f${i}`, ops: [{ op: 'pixel', x: 0, y: 0, color: 'r' }] })) });
  const still = dots(128, 128, 1);
  // 600x400 fits an animation frame and 600x500 does not; a still gets the same kind of fix for both. The branch sent
  // 600x400 to "change the recipe's width and height" with a patch of the width alone (a 600x128 canvas).
  for (const [w, h, near] of [[600, 400, [150, 100]], [600, 500, [150, 125]]]) {
    const fix = check(still, { expect: { width: w, height: h } }).problems[0].fix;
    assert.ok(fix.startsWith(`${w}x${h} is a ${near[0]}x${near[1]} canvas at sheet.scale 4, the nearest to the current 128x128: `), fix);
    assert.ok(fix.includes(`; or, since this is a still, a ${w}x${h} still at sheet.scale 1, one screen pixel per art pixel: pixel_patch [{"set":"width","value":${w}},{"set":"height","value":${h}}]. Either way`), fix);
    for (const marker of ['pixel_patch [', '(or [', 'art pixel: pixel_patch [']) assert.equal(check(patchRecipe(still, changesAfter(fix, marker)).recipe, { expect: { width: w, height: h } }).ok, true, marker);
  }
  // A still's canvas is not held to an animation frame's area: 1200x1000 is a 600x500 canvas at sheet.scale 2 at most.
  assert.match(check(still, { expect: { width: 1200, height: 1000 } }).problems[0].fix, /\(or \[\{"set":"width","value":600\},\{"set":"height","value":500\},\{"set":"sheet","value":\{"scale":2\}\}\], a 600x500 canvas at sheet\.scale 2, for the most detail\)/);
  // An animation: a size a frame holds is the canvas, with both sides patched; past a frame's area, a smaller canvas.
  const strip = dots(128, 128, 4);
  assert.deepEqual(quotedSets(check(strip, { expect: { width: 600, height: 400 } }).problems[0].fix), [{ set: 'width', value: 600 }, { set: 'height', value: 400 }]);
  assert.match(check(strip, { expect: { width: 600, height: 500 } }).problems[0].fix, /^an animation frame is at most 1024 pixels a side and 262,144 in all, so 600x500 is a 150x125 canvas at sheet\.scale 4/);
  // Frames the export refuses at the asked size: up to 256 a side, refused as before; past it, a smaller canvas.
  const crowd = dots(64, 64, 100);
  assert.equal(check(crowd, { expect: { width: 256, height: 192 } }).problems[0].fix, '100 frames of 256x192 pass the limit of 4,194,304 pixels of frames: ask for fewer frames or a smaller size');
  assert.match(check(crowd, { expect: { width: 320, height: 180 } }).problems[0].fix, /^100 frames of 320x180 pass the limit of 4,194,304 pixels of frames, so 320x180 is a 64x36 canvas at sheet\.scale 5, .*a 160x90 canvas at sheet\.scale 2, for the most detail\)/);
});
