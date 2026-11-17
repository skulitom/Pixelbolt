import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderProject, frameFits, frameAreaProblem, FRAME_LIMIT, CANVAS_SIDE, FRAME_PIXELS, PixelError } from '../src/core.js';
import { readSize } from '../src/resize.js';
import { prepareScene } from '../src/scene.js';
import { importPNG } from '../src/import.js';
import { encodePNG } from '../src/png.js';
import { patchRecipe } from '../src/patch.js';
import { compileEffects } from '../src/fx.js';

// The per-frame limit is said one way, from core's constants, by every recipe, source and asset held to it.
test('one per-frame limit: frameFits and frameAreaProblem, worded from CANVAS_SIDE and FRAME_PIXELS', () => {
  assert.deepEqual([CANVAS_SIDE, FRAME_PIXELS], [1024, 262144]);
  for (const [w, h] of [[320, 180], [640, 360], [512, 512], [1024, 256], [1, 1024]]) assert.equal(frameAreaProblem(w, h), null, `${w}×${h}`);
  assert.deepEqual([frameFits(1024, 256), frameFits(1024, 257), frameFits(1025, 1), frameFits(600, 600)], [true, false, false, false]);
  assert.equal(FRAME_LIMIT, 'an animation frame is at most 1024 pixels a side and 262,144 in all');
  const area = 'a 1024×512 frame is 524,288 pixels; an animation frame is at most 1024 pixels a side and 262,144 in all (320×180, 480×270, 640×360 and 512×512 fit)';
  assert.equal(frameAreaProblem(1024, 512), area);
  assert.equal(frameAreaProblem(1025, 10), 'a 1025×10 frame is past 1024 pixels a side; an animation frame is at most 1024 pixels a side and 262,144 in all (320×180, 480×270, 640×360 and 512×512 fit)');
  // Each place that checks a frame leads with that one sentence.
  const message = run => { try { run(); } catch (error) { assert.ok(error instanceof PixelError); return error.message; } assert.fail('expected a refusal'); };
  const animation = { version: 1, name: 'a', width: 1024, height: 512, palette: { k: '#000' }, frames: [{ name: 'f0' }, { name: 'f1' }] };
  const png = encodePNG(new Uint8ClampedArray(1024 * 512 * 4).fill(255), 1024, 512);
  const fx = { format: 'pixelforge-fx', version: 1, name: 'fx', width: 1024, height: 512, palette: { d: '#fff' }, symbols: { d: ['d'] }, effects: { e: { frames: 2, emitters: [{ at: [4, 4], burst: 1, shapes: ['d'] }] } } };
  const scene = { format: 'pixelforge-scene', version: 1, name: 's', width: 64, height: 64, assets: { big: { ...animation, frames: [{ name: 'f0' }] } }, instances: [{ asset: 'big', at: [0, 0] }] };
  for (const [where, run] of [['project: ', () => renderProject(animation)], ['size: ', () => readSize('1024x512')], ['import: frame: ', () => importPNG(png, { frame: [1024, 512] })], ['fx: ', () => compileEffects(fx)], ['scene.assets.big: ', () => prepareScene(scene)]]) {
    assert.ok(message(run).startsWith(where + area), where);
  }
});

test('the recipe tilemap operation takes cells up to 1024 a side, as a scene tilemap does', () => {
  const map = tile => ({ version: 1, name: 'map', width: 640, height: 360, palette: { g: '#3a6' }, symbols: { wide: Array(8).fill('g'.repeat(300)) },
    frames: [{ name: 'f0', ops: [{ op: 'tilemap', tile, rows: ['##'], legend: { '#': { symbol: 'wide' } } }] }, { name: 'f1' }] });
  const project = renderProject(map([300, 8]));
  const at = (x, y) => project.frames[0].data[(y * 640 + x) * 4 + 3];
  assert.deepEqual([at(0, 0), at(299, 7), at(300, 0), at(599, 7), at(600, 0)], [255, 255, 255, 255, 0], 'two 300-wide cells side by side');
  assert.equal(renderProject(map([1024, 8])).width, 640);
  assert.throws(() => renderProject(map([1025, 8])), { message: 'project.frames[0].ops[0].tile: cells are 1–1024 pixels wide and tall, as a scene tilemap\'s are' });
});

test('a patch whose merged pixel corrections would pass 262,144 fails at its value, saying what works', () => {
  // A 600x600 still: a recolour of all of it is a bounded list (two writes a pixel at most), but its 360,000
  // corrections are more than a frame's pixels list holds.
  const still = { version: 1, name: 'wall', width: 600, height: 600, palette: { k: '#102030', s: '#a0c0f0' }, frames: [{ name: 'f', ops: [{ op: 'rect', x: 0, y: 0, w: 600, h: 600, color: 'k' }] }] };
  const refusal = at => `changes[${at}].value: with this recolor, frame "f" would have 360,000 pixel corrections, and a frame's corrections together hold at most 262,144: recolour or redraw an area this large with the frame's operations (a set of frames[f].ops or an insert at frames[f].ops[-]), or change a smaller region`;
  const whole = { recolor: 'frames[f]', value: { from: 'k', to: 's', x: 0, y: 0, w: 600, h: 600 } };
  assert.throws(() => patchRecipe(still, [whole]), error => error instanceof PixelError && error.path === 'changes[0].value' && error.message === refusal(0));
  // Corrections already on the frame count too, so splitting the change never gets past it: two halves that each fit
  // pass it together.
  const half = y => ({ recolor: 'frames[f]', value: { from: 'k', to: 's', x: 0, y, w: 600, h: 300 } });
  assert.equal(patchRecipe(still, [half(0)]).recipe.frames[0].pixels.length, 180000);
  // The first half's corrections would draw over any operations, and the refusal says so: they are the first change's,
  // not the recipe's (a refused patch changes nothing), so it says to drop or shrink that change.
  assert.throws(() => patchRecipe(still, [half(0), half(300)]), { message: `${refusal(1)}. The frame's 180,000 pixel corrections still draw over its operations: changes[0] adds 180,000 of them; drop or shrink it` });
  // What the reply suggests works: the frame's operations redraw the area, and a smaller region still fits as corrections.
  const redrawn = patchRecipe(still, [{ set: 'frames[f].ops', value: [{ op: 'rect', x: 0, y: 0, w: 600, h: 600, color: 's' }] }]).recipe;
  assert.equal(redrawn.frames[0].pixels, undefined);
  const inserted = patchRecipe(still, [{ insert: 'frames[f].ops[-]', value: { op: 'rect', x: 0, y: 0, w: 600, h: 600, color: 's' } }]).recipe;
  assert.deepEqual(inserted.frames[0].ops.map(op => op.color), ['k', 's']);
  assert.equal(patchRecipe(still, [{ recolor: 'frames[f]', value: { from: 'k', to: 's', x: 0, y: 0, w: 400, h: 400 } }]).recipe.frames[0].pixels.length, 160000);
});

test('the schemas keep autotile templates at 256 rows, take tilemap cells to 1024, and say what a normal pass keeps', async () => {
  const read = async file => JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
  const [autotile, recipe, normals] = await Promise.all(['autotile.schema.json', 'schema.json', 'normals.schema.json'].map(read));
  const small = rows => [rows.maxItems, rows.items.maxLength];
  const layer = autotile.properties.layers.items.properties, variant = autotile.properties.variants.items.properties;
  assert.deepEqual([small(autotile.properties.template), small(layer.template), small(variant.template)], [[256, 256], [256, 256], [256, 256]]);
  const tilemap = recipe.$defs.op.oneOf.find(op => op.properties?.op?.const === 'tilemap');
  assert.equal(tilemap.properties.tile.items.maximum, 1024);
  assert.equal(normals.properties.recipe.description, 'The colour recipe: inline, a file resolved by the CLI relative to this source (or inside the MCP root), or {"revision": id} through MCP. A pass made by the normals compiler keeps 256 pixels a side; a larger scene asset takes a normal pass drawn as a recipe of its own size.');
});
