import test from 'node:test';
import assert from 'node:assert/strict';
import { renderProject, describeStampRecipe, PixelError } from '../src/core.js';
import { createBundle } from '../src/export.js';
import { decodePNG, importPNG } from '../src/import.js';
import { encodePNG } from '../src/png.js';
import { patchRecipe } from '../src/patch.js';
import { compilePoses, compileNormals } from '../src/authoring.js';
import { compileBodies } from '../src/bodies.js';
import { compileCrystals } from '../src/crystal.js';
import { compilePowder } from '../src/powder.js';
import { compileWaves } from '../src/wave.js';

// An animation frame is at most 1024 a side and 262,144 pixels: the standard pixel-game screens (320x180, 480x270,
// 640x360) are one recipe, and so is a full-screen overlay such as rain.
const rain = (width, height, frames = 2, extra = {}) => ({
  version: 1, name: 'rain', width, height, palette: { k: '#102030', s: '#a0c0f0' }, ...extra,
  frames: Array.from({ length: frames }, (_, i) => ({ name: `f${i}`, ops: [{ op: 'rect', x: 0, y: 0, w: width, h: height, color: 'k' }, { op: 'line', x: i, y: 0, x2: width - 1 - i, y2: height - 1, color: 's' }] }))
});
const at = (data, width, x, y) => [...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];

test('320x180 and 640x360 animations render and export, every frame at its size', async () => {
  for (const [width, height] of [[320, 180], [640, 360]]) {
    const project = renderProject(rain(width, height));
    assert.deepEqual([project.width, project.height, project.frames.length], [width, height, 2]);
    const bundle = await createBundle(rain(width, height));
    const frame = decodePNG(bundle.files.get('frames/f1.png')), sheet = decodePNG(bundle.files.get('rain.png'));
    assert.deepEqual([frame.width, frame.height, at(frame.data, width, 0, 0), at(frame.data, width, 1, 0)], [width, height, [16, 32, 48, 255], [160, 192, 240, 255]]);
    assert.deepEqual([sheet.width, sheet.height], [2 * width, height]);
    assert.ok(bundle.files.has('animations/default.png'));
  }
});

test('a sheet keeps 8 columns up to 512-wide frames, and fewer for wider ones so it stays within 4096', () => {
  const sheet = recipe => renderProject(recipe).sheet;
  assert.deepEqual([sheet(rain(256, 16, 9)).columns, sheet(rain(512, 16, 9)).columns], [8, 8]);
  const wide = sheet(rain(1024, 256, 8));
  assert.deepEqual([wide.columns, wide.width, wide.height], [4, 4096, 512]);
  assert.deepEqual([sheet(rain(600, 400, 9)).columns, sheet(rain(1024, 16, 3)).columns, sheet(rain(4096, 16, 1)).columns], [6, 3, 1]);
  // Columns the recipe gives are kept.
  assert.equal(sheet(rain(1024, 256, 8, { sheet: { columns: 8 } })).width, 8192);
});

test('a frame whose scaled image would pass what one PNG holds is refused at sheet.scale, with the largest that fits', async () => {
  // A trimmed atlas of small drawings fits, but each frame is also exported whole.
  const sparse = (width, height, scale) => ({ version: 1, name: 'dots', width, height, palette: { s: '#fff' }, sheet: { trim: true, scale }, frames: [{ name: 'a', ops: [{ op: 'pixel', x: 0, y: 0, color: 's' }] }, { name: 'b', ops: [{ op: 'pixel', x: 1, y: 0, color: 's' }] }] });
  const message = 'project.sheet.scale: a 1024×256 frame at scale 9 is 9216×2304, past the 16,777,216 pixels one PNG holds; scale 8 is the largest that fits';
  assert.throws(() => renderProject(sparse(1024, 256, 9)), { message });
  await assert.rejects(createBundle(sparse(1024, 256, 9)), error => error instanceof PixelError && error.message === message);
  assert.throws(() => renderProject(sparse(512, 512, 9)), /scale 8 is the largest that fits$/);
  assert.equal(renderProject(sparse(1024, 256, 8)).sheet.scale, 8);
});

test('patches reach across a big frame: moves of up to 1024, grids of 1024 rows, paint and recolours of a whole frame', () => {
  const recipe = rain(640, 360);
  const moved = patchRecipe(recipe, [{ move: 'frames[f0]', value: { x: 0, y: 0, w: 20, h: 20, dx: 600, dy: 0 } }]).recipe;
  assert.equal(renderProject(moved).frames.length, 2);
  assert.throws(() => patchRecipe(recipe, [{ move: 'frames[f0]', value: { x: 0, y: 0, w: 20, h: 20, dx: 1025, dy: 0 } }]), { message: 'changes[0].value.dx: expected an integer offset from -1024 to 1024' });
  const tall = rain(16, 600);
  const gridded = patchRecipe(tall, [{ grid: 'frames[f1]', value: { x: 0, y: 0, rows: Array(600).fill('s'.repeat(16)) } }]).recipe;
  assert.equal(gridded.frames[1].pixels.length, 9600);
  // A recolour of every pixel of a 512x512 frame, past the old 131,072-pixel list.
  const square = rain(512, 512);
  const recolored = patchRecipe(square, [{ recolor: 'frames[f0]', value: { from: 'k', to: 's', x: 0, y: 0, w: 512, h: 512 } }]).recipe;
  assert.ok(recolored.frames[0].pixels.length > 131072);
  assert.equal(renderProject(recolored).frames.length, 2);
  assert.throws(() => patchRecipe(square, [{ paint: 'frames[f0]', value: Array(262145).fill({ x: 0, y: 0, color: 's' }) }]), { message: 'changes[0].value: paint needs 1–262,144 pixels with x, y and color' });
});

test('a PNG imports as frames up to 1024 a side and 262,144 pixels, each one grid', () => {
  const png = (width, height) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) data.set(i % 7 ? [16, 32, 48, 255] : [160, 192, 240, 255], i * 4);
    return encodePNG(data, width, height);
  };
  const { recipe } = importPNG(png(320, 180));
  assert.deepEqual([recipe.width, recipe.height, recipe.frames[0].ops[0].rows.length, recipe.frames[0].ops[0].rows[0].length], [320, 180, 180, 320]);
  assert.equal(renderProject(recipe).width, 320);
  const sheet = importPNG(png(1280, 360), { frame: [640, 360], padding: 0 }).recipe;
  assert.deepEqual([sheet.width, sheet.height, sheet.frames.length], [640, 360, 2]);
  // A PNG imported whole is a still up to a still's limits (big-frames-cli.test.js follows it through); split by
  // frame, each frame is held to an animation frame's.
  assert.deepEqual([importPNG(png(1024, 512)).recipe.width, importPNG(png(1024, 512)).recipe.frames.length], [1024, 1]);
  assert.throws(() => importPNG(png(1280, 360), { frame: [1280, 360] }), { message: 'import: frame: a 1280×360 frame is 460,800 pixels; an animation frame is at most 1024 pixels a side and 262,144 in all (320×180, 480×270, 640×360 and 512×512 fit), and an imported frame is one' });
});

test('sources that keep 256 a side still refuse 257 with the messages they always gave', () => {
  const refused = (run, message) => assert.throws(run, error => error instanceof PixelError && error.message === message);
  refused(() => compilePoses({ format: 'pixelforge-poses', version: 1, name: 'p', width: 257, height: 8, palette: {}, parts: {}, poses: [] }), 'project.width: expected an integer from 1 to 256');
  refused(() => describeStampRecipe({ version: 1, name: 'p', width: 257, height: 8, palette: {}, frames: [{ name: 'f' }] }), 'project.width: expected an integer from 1 to 256');
  refused(() => describeStampRecipe({ version: 1, name: 'p', width: 8, height: 8, palette: { k: '#000' }, symbols: { s: ['k'.repeat(257)] }, frames: [{ name: 'f' }] }), 'project.symbols.s[0]: row must contain 1–256 characters');
  const colour = { version: 1, name: 'r', width: 257, height: 8, palette: { k: '#000' }, frames: [{ name: 'f', ops: [{ op: 'rect', x: 0, y: 0, w: 257, h: 8, color: 'k' }] }] };
  refused(() => compileNormals({ format: 'pixelforge-normals', version: 1, name: 'n', recipe: colour }), 'normals.recipe: the colour recipe is 257×8; a pass made by the normals compiler keeps 256 pixels a side, so derive normals from a recipe of at most 256 a side; a larger scene asset takes a normal pass drawn as a recipe of its own size');
  refused(() => compileBodies({ format: 'pixelforge-bodies', version: 1, name: 'b', width: 257, height: 64, palette: { k: '#000' }, effects: { drop: { frames: 4, bodies: [] } } }), 'bodies.width: expected an integer from 4 to 256');
  refused(() => compileCrystals({ format: 'pixelforge-crystal', version: 1, name: 'c', width: 257, height: 64, palette: { k: '#000' }, effects: {} }), 'crystal.width: expected an integer from 1 to 256');
  // A compiled powder grid, the rows under or over a wave or a crystal, and a bodies canvas drawn finer.
  refused(() => compilePowder({ format: 'pixelforge-powder', version: 1, name: 'g', base: 'sandbox', width: 257, height: 16, scene: [{ material: 'sand', rect: [4, 2, 8, 4] }], clips: { fall: { frames: 4 } } }),
    'powder.width: a compiled powder grid is an animation, at most 256 pixels a side; use a smaller grid, write a larger one as numbered video frames (pixelbolt sequence), or run it live in a page or game (createLivePowder)');
  const wave = { format: 'pixelforge-wave', version: 1, name: 'w', width: 8, height: 4, palette: { a: '#fff', b: '#f00' }, effects: { loop: { frames: 16, duration: 60,
    sources: [{ kind: 'directional', at: [0, 0], angle: 0, wavelength: 8, amplitude: 0.1, cycles: 1 }], look: { colors: ['a'], thresholds: [0.15], negative: ['b'] }, underlay: Array(257).fill('aaaaaaaa') } } };
  refused(() => compileWaves(wave), 'wave.effects.loop.underlay: expected an array with at most 256 items');
  const gems = { k: '#101018', a: '#40306a', b: '#7050b0', c: '#a080e0', d: '#e0d0ff', w: '#ffffff' };
  const crystal = { format: 'pixelforge-crystal', version: 1, name: 'c', width: 48, height: 40, palette: gems, looks: { gem: { colors: ['a', 'b', 'c', 'd'], outline: 'k', glint: 'w' } },
    effects: { e: { frames: 4, crystals: [{ at: [24, 30], look: 'gem', habit: 'prism', length: 12, width: 6 }], underlay: Array(257).fill('a'.repeat(48)) } } };
  refused(() => compileCrystals(crystal), 'crystal.effects.e.underlay: expected an array with at most 256 items');
  const bodies = { format: 'pixelforge-bodies', version: 1, name: 'b', width: 72, height: 24, subpixels: 4, palette: { s: '#888', w: '#fff', k: '#000' }, symbols: { post: ['ss', 'ss'] },
    effects: { e: { frames: 24, gravity: [0, 0], obstacles: [{ symbol: 'post', x: 2, y: 2 }], bodies: [{ shape: 'box', size: [8, 8], at: [16, 12], fixed: true, fill: 'w', outline: 'k' }] } } };
  refused(() => compileBodies(bodies), 'bodies.subpixels: a 72×24 canvas drawn 4 times finer is 288×96; an animation is at most 256 a side, so use subpixels of at most 3');
});
