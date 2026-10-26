import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderProject, describeStampRecipe, inspectProject } from '../src/core.js';
import { prepareScene } from '../src/scene.js';
import { checkDelivery } from '../src/check.js';
import { patchRecipe } from '../src/patch.js';
import { createBundle } from '../src/export.js';
import { decodePNG } from '../src/import.js';

// A recipe with exactly one frame may be up to 4096 a side within 4,194,304 pixels; everything else keeps 256.
const still = (width, height, ops = [], extra = {}) => ({ version: 1, name: 'mural', width, height, palette: { k: '#102030', s: '#f0c080' }, frames: [{ name: 'still', ops }], ...extra });
const at = (project, x, y) => [...project.frames[0].data.subarray((y * project.width + x) * 4, (y * project.width + x) * 4 + 4)];

test('a single-frame still renders up to 4096 a side within 4,194,304 pixels', () => {
  // A dither without w/h runs to the edge of a 1920-wide canvas, and its pattern follows canvas coordinates there too.
  const mural = renderProject(still(1920, 1080, [{ op: 'rect', x: 0, y: 0, w: 1920, h: 1080, color: 'k' }, { op: 'dither', color: 's', density: 0.5, pattern: [[0, 1], [1, 0]] }]));
  assert.deepEqual([mural.width, mural.height, mural.frames[0].data.length], [1920, 1080, 1920 * 1080 * 4]);
  assert.deepEqual(at(mural, 0, 0), [240, 192, 128, 255]);
  assert.deepEqual(at(mural, 1, 0), [16, 32, 48, 255]);
  assert.deepEqual(at(mural, 1919, 1079), [240, 192, 128, 255]);
  assert.deepEqual(mural.warnings, []);
  for (const [w, h] of [[2560, 1440], [2048, 2048], [4096, 1024], [4096, 1], [257, 1]]) assert.equal(renderProject(still(w, h)).width, w);
});

test('larger stills, animations over 256 and sides over 4096 are refused with the limit that applies', () => {
  assert.throws(() => renderProject(still(3840, 2160)), { message: 'project: a 3840×2160 still is 8,294,400 pixels; a still holds at most 4,194,304 (1920×1080, 2560×1440 and 2048×2048 fit), so draw it smaller or enlarge a smaller canvas with sheet.scale' });
  assert.throws(() => renderProject(still(4097, 10)), { message: 'project.width: expected an integer from 1 to 4096' });
  const animation = { ...still(300, 64), frames: [{ name: 'a' }, { name: 'b' }] };
  assert.throws(() => renderProject(animation), { message: 'project.width: expected an integer from 1 to 256; only a single-frame still may be larger (up to 4096), and this recipe has 2 frames' });
  assert.throws(() => renderProject({ ...animation, width: 64, height: 257 }), /^PixelError: project\.height: expected an integer from 1 to 256; only a single-frame still/);
  // Unchanged at and below 256, and above 4096 for animations.
  assert.equal(renderProject({ ...animation, width: 256, height: 256 }).frames.length, 2);
  assert.throws(() => renderProject({ ...animation, width: 5000 }), { message: 'project.width: expected an integer from 1 to 256' });
  // Pose sources compile to animations and keep 256 even with one pose.
  const pose = { version: 1, name: 'p', width: 300, height: 8, palette: {}, frames: [{ name: 'f' }] };
  assert.throws(() => describeStampRecipe(pose), { message: 'project.width: expected an integer from 1 to 256' });
});

test('shapes and regions may overhang a large still by up to twice its side, and small canvases keep 512', () => {
  const rect = (width, height, w, h) => () => renderProject(still(width, height, [{ op: 'rect', x: -10, y: -10, w, h, color: 'k' }]));
  assert.throws(rect(64, 64, 513, 1), { message: 'project.frames[0].ops[0].w: expected an integer from 1 to 512' });
  assert.throws(rect(256, 256, 1, 513), { message: 'project.frames[0].ops[0].h: expected an integer from 1 to 512' });
  assert.equal(rect(1920, 1080, 3840, 2160)().clipping[0].path, 'project.frames[0].ops[0]');
  assert.throws(rect(1920, 1080, 3841, 1), { message: 'project.frames[0].ops[0].w: expected an integer from 1 to 3840' });
  assert.throws(rect(300, 200, 1, 513), { message: 'project.frames[0].ops[0].h: expected an integer from 1 to 512' });
  const ellipse = renderProject(still(1920, 1080, [{ op: 'ellipse', x: 0, y: 0, w: 1920, h: 1080, color: 's' }]));
  assert.deepEqual([at(ellipse, 960, 540), at(ellipse, 0, 0)], [[240, 192, 128, 255], [0, 0, 0, 0]]);
  const shade = { ...still(600, 100, [{ op: 'rect', x: 0, y: 0, w: 600, h: 100, color: 's' }, { op: 'shade', x: -200, y: 0, w: 1200, h: 100 }]), ramps: [['k', 's']] };
  assert.deepEqual(at(renderProject(shade), 599, 99), [16, 32, 48, 255]);
});

test('scenes keep their assets to 256 pixels a side', () => {
  const scene = asset => ({ format: 'pixelforge-scene', version: 1, name: 's', width: 64, height: 64, assets: { big: asset }, instances: [{ asset: 'big', at: [0, 0] }] });
  assert.throws(() => prepareScene(scene(still(300, 10))), { message: 'scene.assets.big: a scene asset is at most 256×256 pixels; a larger still renders on its own, not in a scene' });
  assert.equal(prepareScene(scene(still(256, 10))).instances.length, 1);
});

test('the render check offers a still at the asked size, and keeps its advice for animations', () => {
  const icon = still(64, 64, [{ op: 'rect', x: 0, y: 0, w: 64, h: 64, color: 'k' }]);
  const check = (recipe, expect) => checkDelivery(renderProject(recipe), { recipe, expect });
  const quoted = fix => [...fix.matchAll(/pixel_patch (\[[^\]]*\])/g)].map(match => JSON.parse(match[1]));
  const wide = check(icon, { width: 1920, height: 1080 }).problems[0].fix;
  assert.match(wide, /^1920x1080 is a 128x72 canvas at sheet\.scale 15, the nearest to the current 64x64: .*; or, since this is a still, a 1920x1080 still at sheet\.scale 1, one screen pixel per art pixel: pixel_patch \[\{"set":"width","value":1920\},\{"set":"height","value":1080\}\]\. Either way,/);
  for (const changes of quoted(wide)) assert.equal(check(patchRecipe(icon, changes).recipe, { width: 1920, height: 1080 }).ok, true, JSON.stringify(changes));
  // No whole scale makes 1921 wide, so the still is the fix; one at sheet.scale 2 goes back to 1.
  const odd = check({ ...icon, sheet: { scale: 2 } }, { width: 1921, height: 1080 }).problems[0].fix;
  assert.equal(odd, 'no whole sheet.scale makes 1921x1080 from this canvas, but a still may be up to 4096 px a side, so make it a 1921x1080 still at sheet.scale 1, one screen pixel per art pixel: pixel_patch [{"set":"width","value":1921},{"set":"height","value":1080},{"set":"sheet.scale","value":1}], fit the drawing to the new canvas, pixel_inspect, then render again');
  assert.equal(check(patchRecipe({ ...icon, sheet: { scale: 2 } }, quoted(odd)[0]).recipe, { width: 1921, height: 1080 }).ok, true);
  // More than a still holds: the enlargement alone, named for what a still holds.
  assert.match(check(icon, { width: 3840, height: 2160 }).problems[0].fix, /^3840x2160 is more than a still holds at one screen pixel per art pixel \(4096 px a side, 4,194,304 pixels\), so 3840x2160 is a 240x135 canvas at sheet\.scale 16/);
  // Two frames: the advice is the one animations always had.
  const pair = { ...icon, frames: [{ name: 'a' }, { name: 'b' }] };
  assert.match(check(pair, { width: 1920, height: 1080 }).problems[0].fix, /^canvases stop at 256 px a side, so 1920x1080 is a 128x72 canvas at sheet\.scale 15,[^;]*, fit the drawing to the new canvas, pixel_inspect, then render again$/);
});

test('a large still inspects as one sheet or by region, and exports at its size', async () => {
  const project = renderProject(still(1920, 1080, [{ op: 'rect', x: 0, y: 0, w: 1920, h: 1080, color: 'k' }, { op: 'pixel', x: 1500, y: 900, color: 's' }]));
  const whole = inspectProject(project);
  assert.deepEqual([whole.sheet.width, whole.sheet.height, whole.sheet.scale], [1924, 1084, 1]);
  const region = inspectProject(project, { region: { x: 1496, y: 896, w: 8, h: 8 }, grid: true });
  assert.deepEqual(region.grids[0].rows[4], 'kkkkskkk');
  const bundle = await createBundle(still(1920, 1080, [{ op: 'rect', x: 0, y: 0, w: 1920, h: 1080, color: 'k' }, { op: 'pixel', x: 1919, y: 1079, color: 's' }]));
  for (const file of ['mural.png', 'frames/still.png']) {
    const image = decodePNG(bundle.files.get(file));
    assert.deepEqual([image.width, image.height, ...image.data.subarray(-4)], [1920, 1080, 240, 192, 128, 255], file);
  }
});

test('the schemas allow a still up to 4096 a side, animations and scene assets 256', async () => {
  const read = async file => JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
  const recipe = await read('schema.json'), scene = await read('scene.schema.json');
  assert.deepEqual([recipe.properties.width.maximum, recipe.properties.height.maximum], [4096, 4096]);
  assert.deepEqual(recipe.if, { properties: { frames: { minItems: 2 } }, required: ['frames'] });
  assert.deepEqual(recipe.then, { properties: { width: { maximum: 256 }, height: { maximum: 256 } } });
  assert.deepEqual([scene.properties.width.maximum, scene.$defs.recipe.properties.width.maximum, scene.$defs.recipe.properties.height.maximum, scene.$defs.recipe.if], [256, 256, 256, undefined]);
});
