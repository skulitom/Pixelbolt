import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject } from '../src/core.js';
import { hash } from '../src/craft.js';
import { findPreset, loadPreset, compilePreset } from '../src/presets.js';
import { readSize, resizeRecipe, resizeWarning, keepFrames } from '../src/resize.js';
import { startMCP } from '../src/mcp.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const preset = async name => compilePreset((await loadPreset(await findPreset(name))).source).recipe;

// Pixels of the resized recipe that differ from the same window of the original. Outside the old canvas a recipe with
// a background shows it, and any other shows nothing: what an empty frame of the recipe shows. `options` are the
// renderer's, for a view of chosen layers.
function differing(recipe, resized, [ox, oy], options = {}) {
  const before = renderProject(recipe, options), after = renderProject(resized, options);
  const empty = renderProject({ version: 1, name: 'empty', width: 1, height: 1, palette: recipe.palette, ...(recipe.background && !options.layers && { background: recipe.background }), frames: [{ name: 'empty' }] }).frames[0].data;
  let count = 0;
  before.frames.forEach((frame, index) => {
    const data = after.frames[index].data;
    for (let y = 0; y < after.height; y++) for (let x = 0; x < after.width; x++) {
      const sx = x + ox, sy = y + oy, inside = sx >= 0 && sy >= 0 && sx < before.width && sy < before.height;
      for (let c = 0; c < 4; c++) if ((inside ? frame.data[(sy * before.width + sx) * 4 + c] : empty[c]) !== data[(y * after.width + x) * 4 + c]) { count++; break; }
    }
  });
  return count;
}

const dot = (x, y) => ({ op: 'pixel', x, y, color: 'a' });
const plain = (width, height, ops, more = {}) => ({ version: 1, name: 'plain', width, height, palette: { a: '#ff0000' }, frames: [{ name: 'one', ops, ...more }] });
// A frame as rows of # for drawn pixels.
const rows = (recipe, frame = 0) => { const { width, height, frames } = renderProject(recipe); return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => (frames[frame].data[(y * width + x) * 4 + 3] ? '#' : '.')).join('')); };

// A seeded recipe with layers. Operations of every placed kind start up to four pixels outside the canvas and reach
// past it on every side; layers have their own x and y, opacity, palettes and names, and some sort by ground; frames
// have operations under the layers, corrections over them, their own palettes, and continue earlier frames; colours
// are solid and partly clear, and some recipes have a background of either kind.
function layered(seed) {
  let draws = 0;
  const roll = sides => hash(seed, draws++) % sides, chance = (n, of) => roll(of) < n, among = (...values) => values[roll(values.length)];
  const width = 5 + roll(8), height = 5 + roll(8);
  const at = () => ({ x: roll(width + 8) - 4, y: roll(height + 8) - 4 }), box = () => ({ ...at(), w: 1 + roll(width + 4), h: 1 + roll(height + 4) });
  const colour = () => among('a', 'b', 'c', 'd', '#12345678');
  const standing = [
    () => ({ op: 'pixel', ...at(), color: colour() }),
    () => ({ op: 'rect', ...box(), color: colour(), filled: chance(2, 3) }),
    () => ({ op: 'ellipse', ...box(), color: colour() }),
    () => { const to = at(); return { op: 'line', ...at(), x2: to.x, y2: to.y, color: colour() }; },
    () => ({ op: 'grid', ...at(), rows: ['ab.', '.cd', 'd.a'], scale: 1 + roll(3), rotate: among(0, 90, 180, 270), flipX: chance(1, 2) }),
    () => ({ op: 'stamp', symbol: 's', ...at(), flipY: chance(1, 2), remap: { a: 'c' } }),
    () => ({ op: 'copy', symbol: 's', ...at(), sx: 1, w: 2 }),
    () => ({ op: 'box', ...at(), w: 4, d: 2 + 2 * roll(2), h: roll(4), top: 'a', left: 'b', right: 'c', edge: 'd' })
  ];
  const area = [
    () => ({ op: 'clear', ...box() }),
    () => ({ op: 'replace', from: among('transparent', 'a', 'b', 'd'), to: among('c', 'd', '#0080ff') }),
    () => ({ op: 'tilemap', ...at(), tile: [3, 2], rows: ['#.#', '.##'], legend: { '#': { symbol: 's' } } }),
    () => ({ op: 'text', text: 'Ag', ...at(), color: colour(), align: among('left', 'center', 'right') })
  ];
  const ops = sorted => Array.from({ length: roll(4) }, () => (sorted
    ? { ...among(...standing)(), ...(chance(1, 3) && { ground: roll(height) }) }
    : among(...standing, ...area)()));
  const layer = index => {
    const sorted = chance(1, 16);
    return {
      ...(chance(1, 2) && { name: ['back', 'body', 'front'][index] }), ...(chance(1, 2) && { x: roll(2 * width + 1) - width }), ...(chance(1, 2) && { y: roll(2 * height + 1) - height }),
      ...(chance(1, 4) && { opacity: 0.5 }), ...(chance(1, 8) && { visible: false }), ...(chance(1, 4) && { palette: { a: '#abcdef' } }), ...(sorted && { sort: 'ground' }), ops: ops(sorted)
    };
  };
  return {
    version: 1, name: `layered-${seed}`, width, height, palette: { a: '#ff0000', b: '#00ff00', c: '#0000ff', d: '#ffff0080' }, symbols: { s: ['ab.', 'cda'] },
    ...(chance(1, 3) && { background: among('#204060', '#20406080', 'b') }),
    frames: Array.from({ length: 1 + roll(3) }, (_, index) => ({
      name: `f${index}`, ...(index && chance(1, 2) && { from: `f${roll(index)}` }), ...(chance(1, 4) && { palette: { b: '#fedcba' } }),
      ...(chance(2, 3) && { ops: ops(false) }), ...(chance(5, 6) && { layers: Array.from({ length: 1 + roll(3) }, (_, li) => layer(li)) }),
      ...(chance(1, 3) && { pixels: [{ x: roll(width), y: roll(height), color: among('a', 'transparent', '#0000ff80') }] })
    }))
  };
}

test('a size is two whole sides within the canvas limit', () => {
  assert.deepEqual(readSize('32x48'), [32, 48]);
  assert.deepEqual(readSize(' 16×16 '), [16, 16]);
  assert.deepEqual(readSize([8, 9]), [8, 9]);
  for (const bad of ['32', '0x8', '32x257', '32 by 32', [32], [1.5, 2], 32, null]) assert.throws(() => readSize(bad), /expected a canvas size such as "32x32"/);
});

test('a smaller canvas is the window with the most drawing, and a larger one centres or keeps a touched edge', () => {
  // Most of the drawing is low and to the right.
  const low = plain(8, 8, [dot(1, 1), { op: 'rect', x: 4, y: 5, w: 3, h: 3, color: 'a' }]);
  const cut = resizeRecipe(low, '4x4');
  assert.deepEqual(cut.resized, { from: [8, 8], offset: [3, 4], cut: 0.1 });
  assert.deepEqual([cut.recipe.width, cut.recipe.height], [4, 4]);
  assert.match(resizeWarning(cut.resized, [4, 4]), /leaves out 10% of what the 8×8 drawing draws/);
  // Nothing touches an edge: margins all round. A floor stays the floor, a ceiling the ceiling, a wall a wall.
  const middle = plain(8, 8, [dot(3, 3)]);
  assert.deepEqual(resizeRecipe(middle, '12x14').resized, { from: [8, 8], offset: [-2, -3], cut: 0 });
  assert.equal(resizeWarning(resizeRecipe(middle, '12x14').resized, [12, 14]), null);
  assert.deepEqual(resizeRecipe(plain(8, 8, [dot(3, 7)]), '12x14').resized.offset, [-2, -6]);
  assert.deepEqual(resizeRecipe(plain(8, 8, [dot(0, 0)]), '12x14').resized.offset, [0, 0]);
  assert.deepEqual(resizeRecipe(plain(8, 8, [dot(7, 3)]), '12x14').resized.offset, [-4, -3]);
  // One axis may shrink while the other grows, and the same size changes nothing.
  assert.deepEqual(resizeRecipe(low, '4x10').resized.offset, [3, -2]);
  assert.deepEqual(resizeRecipe(low, '8x8').recipe.frames[0].ops, low.frames[0].ops.map(op => ({ ...op, x: op.x, y: op.y })));
});

test('everything a frame places moves with the canvas', () => {
  const recipe = {
    version: 1, name: 'all', width: 12, height: 10, palette: { a: '#ff0000', b: '#00ff00' }, anchor: [6, 9], symbols: { s: ['ab', 'ba'] },
    frames: [
      { name: 'one', anchor: [5, 9], points: { hand: [9, 4] }, ops: [{ op: 'line', x: 1, y: 8, x2: 10, y2: 8, color: 'a' }, { op: 'stamp', symbol: 's', x: 9, y: 3, scale: 2 }, { op: 'text', text: 'A', x: 2, y: 1, color: 'b' }],
        layers: [{ name: 'back', ops: [{ op: 'ellipse', x: 2, y: 2, w: 5, h: 5, color: 'b' }, { op: 'grid', rows: ['a.a'] }] }], pixels: [{ x: 0, y: 0, color: 'b' }, { x: 6, y: 8, color: 'b' }] },
      { name: 'two', from: 'one', ops: [{ op: 'clear', x: 0, y: 0, w: 2, h: 2 }, { op: 'copy', symbol: 's', x: 4, y: 4 }] }
    ]
  };
  for (const size of ['9x7', '15x13', '8x12', '16x6']) {
    const { recipe: moved, resized } = resizeRecipe(recipe, size), [ox, oy] = resized.offset;
    assert.equal(differing(recipe, moved, resized.offset), 0, size);
    assert.deepEqual(moved.anchor, [6 - ox, 9 - oy]);
    assert.deepEqual(moved.frames[0].points.hand, [9 - ox, 4 - oy]);
  }
  // The stamp hangs over the right edge, where the old canvas clipped it: a margin there stays empty. The second
  // frame starts from the first and draws inside the canvas, so it has nothing to clear.
  assert.ok(renderProject(recipe).clipping);
  assert.deepEqual(resizeRecipe(recipe, '15x13').recipe.frames.map(frame => frame.ops.some(op => op.op === 'clear' && op.h === 13)), [true, false]);
});

test('a layer that hangs over the canvas, or has its own x and y, is that window of the original too', () => {
  const frame = (more, size = [8, 4]) => ({ version: 1, name: 'layers', width: size[0], height: size[1], palette: { a: '#ff0000', b: '#0000ff' }, frames: [{ name: 'one', ...more }] });
  const bar = { op: 'rect', x: -1, y: 1, w: 10, h: 2, color: 'a' }, cut = ['............', '..########..', '..########..', '............'];
  // A layer's operations draw after the frame's, so the frame's clears cannot empty the margins of a layer.
  const over = frame({ layers: [{ ops: [bar] }] });
  assert.deepEqual(rows(resizeRecipe(over, '12x4').recipe), cut);
  assert.deepEqual(rows(resizeRecipe(frame({ ops: [bar] }), '12x4').recipe), cut);
  assert.deepEqual(rows(resizeRecipe(frame({ ops: [{ ...bar, y: 0, h: 1 }], layers: [{ ops: [{ ...bar, y: 2, h: 1 }] }, { ops: [dot(9, 3)] }] }), '12x4').recipe), ['..########..', '............', '..########..', '............']);
  // A layer is cut by its own canvas before its x and y move it: a block drawn at 0 and moved to the right half.
  const moved = frame({ layers: [{ x: 4, ops: [{ op: 'rect', x: 0, y: 1, w: 4, h: 2, color: 'a' }] }] }), half = resizeRecipe(moved, '4x4');
  assert.deepEqual(half.resized, { from: [8, 4], offset: [4, 0], cut: 0 });
  assert.deepEqual(rows(half.recipe), ['....', '####', '####', '....']);
  // Both cuts at once: the layer's canvas takes the left of the bar, the frame's takes the right after the move.
  const both = frame({ layers: [{ x: 3, y: 1, opacity: 0.5, ops: [bar] }] });
  assert.deepEqual(rows(both), ['........', '........', '...#####', '...#####']);
  assert.deepEqual(rows(resizeRecipe(both, '14x6').recipe), ['..............', '..............', '..............', '..............', '.........#####', '.........#####']);
  for (const recipe of [over, moved, both]) for (const size of ['12x4', '4x4', '14x6', '3x9', '8x4']) { const { recipe: sized, resized } = resizeRecipe(recipe, size); assert.equal(differing(recipe, sized, resized.offset), 0, size); }
  // A frame continued from one whose layer overhangs starts from margins already empty.
  const next = { ...over, frames: [...over.frames, { name: 'two', from: 'one', ops: [dot(3, 0)] }] };
  assert.deepEqual(rows(resizeRecipe(next, '12x4').recipe, 1), ['.....#......', ...cut.slice(1)]);
  // Only a list that was cut clears, and a layer without x or y keeps its operations where the frame's would be.
  const quiet = resizeRecipe(frame({ ops: [dot(1, 1)], layers: [{ name: 'in', ops: [dot(2, 2)] }, { name: 'out', ops: [bar] }] }), '12x4').recipe.frames[0];
  assert.deepEqual([quiet.ops, quiet.layers[0]], [[dot(3, 1)], { name: 'in', ops: [dot(4, 2)] }]);
  assert.deepEqual(quiet.layers[1].ops.map(op => op.op), ['rect', 'clear', 'clear']);
  // A render names sixteen places that were cut. Past them a layer may have been cut too, so it clears.
  const many = frame({ ops: Array.from({ length: 17 }, (_, index) => dot(-1, index % 4)), layers: [{ ops: [bar] }] });
  assert.equal(renderProject(many).clippingOmitted, 2);
  assert.deepEqual(rows(resizeRecipe(many, '12x4').recipe), cut);
  // Over several frames, each is asked alone, so a figure that overhangs through a long animation still clears only
  // in the layers that do: here the second of each frame's three, and not the frame continued from the one before.
  const long = { ...over, frames: Array.from({ length: 20 }, (_, index) => (index === 9 ? { name: 'f9', from: 'f8', layers: [{ ops: [dot(index % 8, 0)] }] }
    : { name: `f${index}`, layers: [{ ops: [dot(index % 8, 0)] }, { ops: [{ ...bar, x: index % 2 ? -1 : 5 }] }, { ops: [dot(0, 3)] }] })) };
  const sized = resizeRecipe(long, '12x6');
  assert.equal(renderProject(long).clippingOmitted, 3);
  assert.equal(differing(long, sized.recipe, sized.resized.offset), 0);
  assert.deepEqual(sized.recipe.frames.map(({ layers }) => layers.map(layer => layer.ops.length).join('')).join(' '), Array.from({ length: 20 }, (_, index) => (index === 9 ? '1' : '151')).join(' '));
});

test('seeded layered recipes resize to the window of the original, pixel for pixel', () => {
  let compared = 0, moved = 0, cleared = 0, refused = 0;
  for (let seed = 1; seed <= 90; seed++) {
    const recipe = layered(seed), { width, height } = recipe;
    for (const size of [[width + 3, height + 4], [width - 2, height - 3], [width + 5, height - 4], [width - 4, height + 1], [2 * width, 2 * height], [width, height], [3, 2]]) {
      const label = `seed ${seed} at ${size.join('x')}`, layers = recipe.frames.flatMap(frame => frame.layers ?? []);
      let made;
      try { made = resizeRecipe(recipe, size); } catch (error) {
        // The one refusal: a sorted layer cannot clear what it draws past the canvas.
        assert.match(error.message, /^size: frames\[\d\]\.layers\[\d\] is sorted by ground and draws past the canvas where the new one has a margin/, label);
        assert.ok(layers.some(layer => layer.sort) && (size[0] > width || size[1] > height || layers.some(layer => layer.sort && (layer.x || layer.y))), label);
        refused++;
        continue;
      }
      assert.equal(differing(recipe, made.recipe, made.resized.offset), 0, label);
      // Each layer clears for itself, so a view of chosen layers is that window of the same view.
      for (const name of new Set(layers.map(layer => layer.name).filter(Boolean))) assert.equal(differing(recipe, made.recipe, made.resized.offset, { layers: [name] }), 0, `${label}, layer ${name}`);
      compared++;
      if (layers.some(layer => layer.x || layer.y)) moved++;
      if (made.recipe.frames.some((frame, fi) => frame.layers?.some((layer, li) => layer.ops.length > recipe.frames[fi].layers[li].ops.length))) cleared++;
    }
  }
  // Most cases resize, most of those have a layer with its own x or y, and many clear a layer's margins.
  assert.ok(compared >= 500 && moved >= 300 && cleared >= 150 && refused >= 10, JSON.stringify({ compared, moved, cleared, refused }));
});

test('a margin shows the background, or nothing, whatever the drawing does to the rest', () => {
  const backed = (background, ops, more = {}) => ({ ...plain(8, 4, ops, more), palette: { a: '#ff0000', b: '#0000ff' }, background });
  const bar = { op: 'rect', x: -1, y: 1, w: 10, h: 2, color: 'a' };
  const corner = recipe => [...renderProject(recipe).frames[0].data.subarray(0, 4)];
  // Clearing what hangs over the old canvas clears the background there too, so it is painted back: a solid one, a
  // partly clear one (once a pixel), and one named by a palette key that the frame recolours.
  for (const [background, colour, more] of [['#204060', [32, 64, 96, 255]], ['#20406080', [32, 64, 96, 128]], ['b', [0, 0, 255, 255], { palette: { b: '#00ff00' } }]]) {
    for (const recipe of [backed(background, [bar], more), backed(background, [], { ...more, layers: [{ ops: [bar] }] })]) {
      const { recipe: sized, resized } = resizeRecipe(recipe, '12x6');
      assert.deepEqual([resized.offset, corner(sized)], [[-2, -1], colour], background);
      assert.equal(differing(recipe, sized, resized.offset), 0, background);
    }
  }
  // A replace recolours every pixel of its canvas without being cut by it: the margins of a larger one too.
  const flood = [dot(2, 2), { op: 'replace', from: 'transparent', to: 'b' }];
  for (const recipe of [plain(8, 4, flood), plain(8, 4, [], { layers: [{ x: 3, y: -1, opacity: 0.5, ops: flood }] }), backed('#204060', [{ op: 'replace', from: '#204060', to: 'a' }])]) {
    recipe.palette = { a: '#ff0000', b: '#0000ff' };
    for (const size of ['12x6', '5x3', '10x2']) { const { recipe: sized, resized } = resizeRecipe(recipe, size); assert.equal(differing(recipe, sized, resized.offset), 0, size); }
  }
  assert.deepEqual(rows(resizeRecipe(plain(4, 2, [{ op: 'replace', from: 'transparent', to: 'a' }]), '6x4').recipe), ['......', '.####.', '.####.', '......']);
});

test('a sorted layer that draws past the canvas is refused where a margin would show it', () => {
  const sorted = (ops, more = {}) => plain(8, 4, [], { layers: [{ name: 'props', sort: 'ground', ...more, ops }] });
  const bar = { op: 'rect', x: -1, y: 1, w: 10, h: 2, color: 'a' }, post = { op: 'rect', x: 1, y: 0, w: 2, h: 3, color: 'a' }, far = { op: 'rect', x: 0, y: 1, w: 4, h: 1, color: 'a', ground: 9 };
  // Only a clear erases, and a sorted layer takes none.
  assert.throws(() => resizeRecipe(sorted([bar]), '12x4'), /size: frames\[0\]\.layers\[0\] is sorted by ground and draws past the canvas where the new one has a margin, which a sorted layer cannot clear, so this recipe cannot move to that canvas size; change the size in its source instead$/);
  assert.throws(() => resizeRecipe(sorted([post], { x: 7 }), '12x4'), /layers\[0\] is sorted by ground/);
  // Without a margin the new canvas cuts what the old one cut; and a sorted layer that stays inside moves like any
  // other, its own x and y and each ground row with it.
  for (const [recipe, size] of [[sorted([bar]), '6x4'], [sorted([bar]), '8x2'], [sorted([far, post], { x: 3, y: 1 }), '12x7'], [sorted([far, post], { x: 3, y: 1 }), '5x3']]) {
    const { recipe: sized, resized } = resizeRecipe(recipe, size);
    assert.equal(differing(recipe, sized, resized.offset), 0, size);
  }
  const stood = resizeRecipe(sorted([far, post], { x: 3, y: 1 }), '12x7');
  assert.deepEqual(stood.resized.offset, [-2, -3]);
  assert.deepEqual(stood.recipe.frames[0].layers[0], { name: 'props', sort: 'ground', ops: [{ ...far, x: 5, y: 5, ground: 13 }, { ...post, x: 6, y: 4 }] });
});

test('a recipe whose operations read the whole canvas says so instead of drawing something else', () => {
  const refuse = (recipe, pattern) => assert.throws(() => resizeRecipe(recipe, '6x6'), pattern);
  refuse(plain(8, 8, [dot(1, 1), { op: 'outline', color: 'a' }]), /size: frames\[0\]\.ops\[1\] is "outline", which reads the whole canvas.*change the size in its source/);
  refuse(plain(8, 8, [{ op: 'fill', x: 1, y: 1, color: 'a' }]), /"fill"/);
  refuse({ ...plain(8, 8, [dot(1, 1)]), frames: [{ name: 'one', ops: [dot(1, 1)] }, { name: 'two', ops: [{ op: 'copy', from: 'one', x: 2, y: 2 }] }] }, /frames\[1\]\.ops\[0\] is a copy from another frame/);
  refuse(plain(8, 8, [dot(1, 1)], { translate: [1, 0] }), /frames.0..translate is tied to the canvas size/);
  refuse(plain(8, 8, [dot(1, 1)], { flipX: true }), /frames\[0\]\.flipX is tied to the canvas size/);
  assert.throws(() => resizeRecipe({ ...plain(8, 8, [dot(1, 1)]), frames: Array.from({ length: 70 }, (_, index) => ({ name: `f${index}`, ops: [dot(1, 1)] })) }, '256x256'), /size: 70 frames of 256×256 pixels exceed the 4,194,304-pixel limit/);
});

test('presets of every kind move to another canvas pixel for pixel', async () => {
  // A gas on a floor, a rig with anchors, points and corrections, particles and shapes, a wave, and a plain recipe.
  for (const name of ['campfire', 'swing', 'swing-trail', 'interference', 'coin']) {
    const recipe = await preset(name);
    for (const size of [[32, 32], [recipe.width + 7, recipe.height + 5], [recipe.width - 9, recipe.height + 4]]) {
      const { recipe: moved, resized } = resizeRecipe(recipe, size);
      assert.equal(differing(recipe, moved, resized.offset), 0, `${name} at ${size.join('x')}`);
    }
  }
  // The campfire asked for at 32×32 keeps its logs and the floor, and loses only wisps of smoke off the top.
  const { resized } = resizeRecipe(await preset('campfire'), '32x32');
  assert.deepEqual([resized.from, resized.offset], [[32, 48], [0, 16]]);
  assert.ok(resized.cut > 0 && resized.cut < 0.03, `${resized.cut}`);
  // The shrine is drawn with a dither, which another canvas would draw differently.
  assert.throws(() => resizeRecipe(compilePreset(JSON.parse(JSON.stringify({ ...plain(8, 8, [{ op: 'dither', color: 'a' }]) }))).recipe, '4x4'), /"dither"/);
});

test('compile --size and pixel_compile size put a preset on the canvas asked for', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-resize-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const cli = (...args) => spawnSync(process.execPath, [path.join(root, 'bin/pixelbolt.js'), ...args], { encoding: 'utf8' });
  const out = path.join(dir, 'fire.json'), meta = path.join(dir, 'fire.meta.json');
  const made = cli('compile', '--preset', 'campfire', '--size', '32x32', '--out', out, '--metadata', meta), reply = JSON.parse(made.stdout);
  assert.deepEqual([reply.ok, reply.width, reply.height, reply.resized.from, reply.resized.offset], [true, 32, 32, [32, 48], [0, 16]]);
  assert.match(reply.warnings.at(-1), /^The 32×32 canvas leaves out /);
  const recipe = JSON.parse(await readFile(out, 'utf8'));
  assert.deepEqual(recipe, resizeRecipe(await preset('campfire'), '32x32').recipe);
  // The metadata keeps the source's coordinates and says where the new canvas starts in them.
  assert.deepEqual(JSON.parse(await readFile(meta, 'utf8')).resized, reply.resized);
  for (const [args, pattern] of [
    [['--preset', 'campfire', '--size', 'small'], /--size: expected a canvas size such as \\"32x32\\"/],
    [['--preset', 'shrine', '--size', '32x32'], /--size: .* is \\"dither\\", which reads the whole canvas/],
    [['--preset', 'swing', '--size', '32x32', '--expand'], /--size and --frames go with a compile that writes a recipe/]
  ]) {
    const refused = cli('compile', ...args, '--out', path.join(dir, 'refused.json'));
    assert.equal(refused.status, 1);
    assert.match(refused.stdout + refused.stderr, pattern);
  }

  const input = new PassThrough(), output = new PassThrough(), waiting = new Map();
  let buffer = '', id = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)?.(message); } });
  startMCP({ input, output, root: dir, directory: dir }); t.after(() => input.end());
  const call = (method, params) => new Promise(resolve => { waiting.set(++id, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'resize-test', version: '1' } });
  const compile = async args => (await call('tools/call', { name: 'pixel_compile', arguments: args })).result;
  const sized = JSON.parse((await compile({ preset: 'campfire', size: '32x32', metadata: true })).content[0].text);
  assert.deepEqual([sized.ok, sized.width, sized.height, sized.resized, sized.metadata.resized], [true, 32, 32, reply.resized, reply.resized]);
  assert.ok(sized.warnings.some(warning => /^The 32×32 canvas leaves out /.test(warning)));
  // Without size a preset compiles as it always has.
  const whole = JSON.parse((await compile({ preset: 'campfire' })).content[0].text);
  assert.deepEqual([whole.width, whole.height, whole.resized], [32, 48, undefined]);
  const refused = await compile({ preset: 'shrine', size: '32x32' });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /which reads the whole canvas/);
  assert.match((await compile({ preset: 'ring-escape', size: '32x32', sequence: { fps: 30 } })).content[0].text, /size goes with a compile that returns a recipe/);

  // frames thins the preset the same way from both, before the canvas moves.
  const thin = JSON.parse((await compile({ preset: 'campfire', size: '32x32', frames: 8, metadata: true })).content[0].text);
  assert.deepEqual([thin.frames, thin.kept, thin.metadata.kept, thin.animationFps, thin.resized.offset], [8, { campfire: '8 of 24' }, { campfire: '8 of 24' }, { campfire: 4.76 }, [0, 16]]);
  const thinOut = path.join(dir, 'thin.json'), shell = JSON.parse(cli('compile', '--preset', 'campfire', '--size', '32x32', '--frames', '8', '--out', thinOut).stdout);
  assert.deepEqual(shell.kept, thin.kept);
  assert.deepEqual(JSON.parse(await readFile(thinOut, 'utf8')), resizeRecipe(keepFrames(await preset('campfire'), 8).recipe, '32x32').recipe);
  const gif = JSON.parse(cli('gif', '--preset', 'fire-explosion', '--frames', '6', '--out', path.join(dir, 'boom.gif')).stdout);
  assert.deepEqual([gif.frames, gif.kept, gif.duration], [6, { 'fire-explosion': '6 of 16' }, 960]);
  for (const [args, pattern] of [
    [['compile', '--preset', 'campfire', '--frames', 'few'], /--frames expects how many frames each animation keeps, such as --frames 8/],
    [['compile', '--preset', 'campfire', '--frames', '0'], /--frames: expected how many frames each animation keeps, a whole number from 1 to 256/],
    [['compile', path.join(root, 'examples/meadow.autotile.json'), '--frames', '4'], /--frames thins animations, and the frames of a tile set are its tiles/],
    [['compile', '--preset', 'swing', '--frames', '4', '--expand'], /--size and --frames go with a compile that writes a recipe/]
  ]) {
    const refusal = cli(...args, '--out', path.join(dir, 'refused.json'));
    assert.equal(refusal.status, 1);
    assert.match(refusal.stdout + refusal.stderr, pattern);
  }
  assert.match((await compile({ preset: 'campfire', frames: 0 })).content[0].text, /frames: expected how many frames each animation keeps/);
  assert.match((await compile({ preset: 'ring-escape', frames: 8, sequence: { fps: 30 } })).content[0].text, /frames goes with a compile that returns a recipe/);
});

const strip = (count, more = {}, animations) => ({ version: 1, name: 'strip', width: 4, height: 4, palette: { a: '#ff0000' }, frames: Array.from({ length: count }, (_, i) => ({ name: `f${i}`, duration: 10 * (i + 1), ops: [dot(i % 4, 0)], ...more[i] })), ...(animations && { animations }) });
const plays = recipe => Object.fromEntries(Object.entries(renderProject(recipe).animations).map(([key, a]) => [key, a.frames.map(i => recipe.frames[i].name).join(' ')]));
const lengths = recipe => Object.fromEntries(Object.entries(renderProject(recipe).animations).map(([key, a]) => [key, a.duration]));

test('fewer frames are evenly spaced ones, lasting as long as the frames they stand for', async () => {
  // A loop steps evenly round its seam; a one-shot keeps its first and last frame.
  const loop = keepFrames(strip(8), 3);
  assert.deepEqual([loop.kept, plays(loop.recipe), loop.notes], [{ default: '3 of 8' }, { default: 'f0 f2 f5' }, []]);
  assert.deepEqual(loop.recipe.frames.map(frame => frame.duration), [10 + 20, 30 + 40 + 50, 60 + 70 + 80]);
  assert.equal(loop.recipe.animations, undefined);
  const once = keepFrames(strip(8, {}, { burst: { frames: ['f0', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7'], loop: false } }), 3);
  assert.deepEqual([plays(once.recipe), lengths(once.recipe)], [{ burst: 'f0 f4 f7' }, { burst: 360 }]);
  assert.deepEqual(once.recipe.animations.burst.loop, false);
  // One that fades to nothing ends on its last frame with a picture, which lasts through the empty ones.
  const fades = keepFrames(strip(8, { 6: { ops: [] }, 7: { ops: [] } }, { burst: { frames: ['f0', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7'], loop: false } }), 3);
  assert.deepEqual([plays(fades.recipe), lengths(fades.recipe), fades.recipe.frames.at(-1).duration], [{ burst: 'f0 f3 f5' }, { burst: 360 }, 60 + 70 + 80]);
  // A pingpong plays its inner frames twice, so it lists fewer; an animation that already fits is left as it is.
  const mixed = strip(8, {}, { sway: { frames: ['f0', 'f1', 'f2', 'f3', 'f4'], direction: 'pingpong' }, blink: { frames: ['f5', 'f6'] }, hold: { frames: ['f7', 'f7', 'f7', 'f6', 'f7'], loop: false } });
  const thinned = keepFrames(mixed, 4);
  assert.deepEqual(thinned.kept, { sway: '3 of 5', hold: '4 of 5' });
  assert.deepEqual(plays(thinned.recipe), { sway: 'f0 f2 f4 f2', blink: 'f5 f6', hold: 'f7 f7 f6 f7' });
  // f7 is played three times at lengths that differ, so it keeps its own and says so.
  assert.equal(thinned.recipe.frames.find(frame => frame.name === 'f7').duration, 80);
  assert.match(thinned.notes.join(' '), /^Frame "f7" is played more than once, so it keeps its 80 ms/);
  assert.deepEqual(thinned.recipe.frames.map(frame => frame.name), ['f0', 'f2', 'f4', 'f5', 'f6', 'f7']);
  // A frame another is drawn from stays, unplayed, and the animation that played every frame is spelled out.
  const derived = keepFrames(strip(6, { 3: { from: 'f1' }, 5: { ops: [{ op: 'copy', from: 'f4', x: 0, y: 0 }] } }), 2);
  assert.deepEqual(derived.recipe.frames.map(frame => frame.name), ['f0', 'f1', 'f3']);
  assert.deepEqual(derived.recipe.animations, { default: { frames: ['f0', 'f3'] } });
  assert.deepEqual(lengths(derived.recipe), { default: 210 });
  // Nothing to remove changes nothing.
  const same = strip(4), untouched = keepFrames(same, 4);
  assert.equal(untouched.recipe, same);
  assert.deepEqual([untouched.kept, untouched.notes], [{}, ['Every animation already plays 4 frames or fewer, so none was removed.']]);
  for (const bad of [0, 257, 2.5, '8', undefined]) assert.throws(() => keepFrames(same, bad), /frames: expected how many frames each animation keeps, a whole number from 1 to 256/);
  // Presets keep their length and every kept frame its picture.
  for (const [name, count] of [['smoke-puff', 8], ['fire-spells', 6], ['knight', 4], ['coin', 3]]) {
    const recipe = await preset(name), before = renderProject(recipe), { recipe: fewer } = keepFrames(recipe, count), after = renderProject(fewer);
    assert.deepEqual(lengths(fewer), lengths(recipe), name);
    for (const frame of after.frames) assert.deepEqual(frame.data, before.frames.find(each => each.name === frame.name).data, `${name} ${frame.name}`);
    for (const animation of Object.values(after.animations)) assert.ok(animation.frames.length <= count, name);
  }
});
