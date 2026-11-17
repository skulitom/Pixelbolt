import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderProject, describeStampRecipe, inspectProject } from '../src/core.js';
import { prepareScene } from '../src/scene.js';
import { checkDelivery } from '../src/check.js';
import { patchRecipe } from '../src/patch.js';
import { createBundle } from '../src/export.js';
import { decodePNG } from '../src/import.js';

// A recipe with exactly one frame may be up to 4096 a side within 4,194,304 pixels; an animation frame is at most 1024
// a side and 262,144 pixels.
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

test('larger stills, animation frames past 1024 a side or 262,144 pixels and sides over 4096 are refused with the limit that applies', () => {
  assert.throws(() => renderProject(still(3840, 2160)), { message: 'project: a 3840×2160 still is 8,294,400 pixels; a still holds at most 4,194,304 (1920×1080, 2560×1440 and 2048×2048 fit), so draw it smaller or enlarge a smaller canvas with sheet.scale' });
  assert.throws(() => renderProject(still(4097, 10)), { message: 'project.width: expected an integer from 1 to 4096' });
  const animation = { ...still(1025, 64), frames: [{ name: 'a' }, { name: 'b' }] };
  assert.throws(() => renderProject(animation), { message: 'project.width: expected an integer from 1 to 1024; only a single-frame still may be larger (up to 4096), and this recipe has 2 frames' });
  assert.throws(() => renderProject({ ...animation, width: 64, height: 1025 }), /^PixelError: project\.height: expected an integer from 1 to 1024; only a single-frame still/);
  // Within the side, a frame's area: 1024×512 is twice what an animation frame holds.
  assert.throws(() => renderProject({ ...animation, width: 1024, height: 512 }), { message: 'project: a 1024×512 frame is 524,288 pixels; an animation frame is at most 1024 pixels a side and 262,144 in all (320×180, 480×270, 640×360 and 512×512 fit), so draw it smaller or enlarge a smaller canvas with sheet.scale; only a single-frame still may be larger' });
  // The screen sizes of pixel games, and the widest strip, render as animations.
  for (const [w, h] of [[320, 180], [384, 216], [480, 270], [640, 360], [512, 512], [1024, 256], [300, 64], [64, 257]]) assert.deepEqual([renderProject({ ...animation, width: w, height: h }).frames.length, w, h], [2, w, h]);
  assert.throws(() => renderProject({ ...animation, width: 5000 }), { message: 'project.width: expected an integer from 1 to 1024' });
  // Pose sources compile to animations and keep 256 even with one pose.
  const pose = { version: 1, name: 'p', width: 300, height: 8, palette: {}, frames: [{ name: 'f' }] };
  assert.throws(() => describeStampRecipe(pose), { message: 'project.width: expected an integer from 1 to 256' });
});

test('the frames of a recipe share 4,194,304 pixels, and the refusal says how many of that size fit', () => {
  const frames = (count, width, height) => ({ ...still(width, height), frames: Array.from({ length: count }, (_, i) => ({ name: `f${i}` })) });
  assert.equal(renderProject(frames(72, 320, 180)).frames.length, 72);
  assert.equal(renderProject(frames(18, 640, 360)).frames.length, 18);
  assert.equal(renderProject(frames(16, 512, 512)).frames.length, 16);
  assert.throws(() => renderProject(frames(73, 320, 180)), { message: "project.frames: 73 frames of 320×180 are 4,204,800 pixels; a recipe's frames hold at most 4,194,304 in all, so 72 frames of 320×180 fit: use fewer frames or a smaller canvas" });
  assert.throws(() => renderProject(frames(19, 640, 360)), /so 18 frames of 640×360 fit/);
  assert.throws(() => renderProject(frames(17, 512, 512)), /so 16 frames of 512×512 fit/);
  assert.throws(() => renderProject(frames(65, 256, 256)), /so 64 frames of 256×256 fit/);
});

test('one grid covers a 320-wide frame, and grids hold at most 262,144 cells', () => {
  const rows = (w, h) => Array.from({ length: h }, () => 'k'.repeat(w));
  const overlay = { version: 1, name: 'rain', width: 320, height: 180, palette: { k: '#102030' }, frames: [{ name: 'a', ops: [{ op: 'grid', rows: rows(320, 180) }] }, { name: 'b', from: 'a' }] };
  const project = renderProject(overlay);
  assert.deepEqual([project.frames.length, at(project, 319, 179)], [2, [16, 32, 48, 255]]);
  // A symbol too, at the frame's side; a grid past it, or past 262,144 cells, is refused.
  assert.equal(renderProject({ ...overlay, symbols: { sheet: rows(1024, 4) } }).frames.length, 2);
  assert.throws(() => renderProject({ ...overlay, symbols: { sheet: rows(1025, 1) } }), { message: 'project.symbols.sheet[0]: row must contain 1–1024 characters' });
  assert.throws(() => renderProject({ ...overlay, symbols: { sheet: rows(1024, 257) } }), { message: 'project.symbols.sheet: a 1024×257 grid is 263,168 cells; a grid holds at most 262,144, as an animation frame does, so split it into several grids' });
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

test('scenes keep their assets to an animation frame, 1024 a side and 262,144 pixels', () => {
  const scene = asset => ({ format: 'pixelforge-scene', version: 1, name: 's', width: 64, height: 64, assets: { big: asset }, instances: [{ asset: 'big', at: [0, 0] }] });
  assert.throws(() => prepareScene(scene(still(1025, 10))), { message: 'scene.assets.big: a 1025×10 frame is past 1024 pixels a side; an animation frame is at most 1024 pixels a side and 262,144 in all (320×180, 480×270, 640×360 and 512×512 fit), and a scene asset is one; a larger still renders on its own, not in a scene' });
  assert.throws(() => prepareScene(scene(still(1024, 512))), /a 1024×512 frame is 524,288 pixels; .*, and a scene asset is one; a larger still renders on its own/);
  assert.equal(prepareScene(scene(still(300, 10))).instances.length, 1);
  // A full-screen animation is an asset: a 320×180 rain overlay of two frames.
  const rain = { ...still(320, 180), frames: [{ name: 'a', ops: [{ op: 'dither', color: 's', density: 0.1 }] }, { name: 'b', translate: [0, 4], wrap: true, from: 'a' }] };
  assert.equal(prepareScene({ ...scene(rain), width: 320, height: 180 }).instances.length, 1);
  // A tilemap's cell defaults to the asset's frame, so cells larger than 256 are fine.
  assert.equal(prepareScene({ ...scene(still(300, 10)), instances: [{ asset: 'big', at: [0, 0], tilemap: { rows: ['kk'], legend: { k: 'still' } } }] }).instances.length, 1);
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
  // Two frames: a smaller canvas enlarged, within an animation frame's side and area: 640x360 at scale 3 for the most
  // detail, never 960x540 at scale 2 (518,400 pixels).
  const pair = { ...icon, frames: [{ name: 'a', ops: icon.frames[0].ops }, { name: 'b', from: 'a' }] };
  const paired = check(pair, { width: 1920, height: 1080 }).problems[0].fix;
  assert.match(paired, /^an animation frame is at most 1024 pixels a side and 262,144 in all, so 1920x1080 is a 128x72 canvas at sheet\.scale 15,[^;]*\(or \[[^\]]*\], a 640x360 canvas at sheet\.scale 3, for the most detail\), fit the drawing to the new canvas, pixel_inspect, then render again$/);
  const detail = JSON.parse(paired.slice(paired.indexOf('(or [') + 4, paired.indexOf(']', paired.indexOf('(or [')) + 1));
  assert.deepEqual(detail, [{ set: 'width', value: 640 }, { set: 'height', value: 360 }, { set: 'sheet', value: { scale: 3 } }]);
  assert.equal(check(patchRecipe(pair, detail).recipe, { width: 1920, height: 1080 }).ok, true);
  // Twenty trimmed frames of 640x360 pass the 4,194,304 pixels frames share, so 480x270 at scale 4 is the most detail.
  const sparks = { ...icon, sheet: { trim: true }, frames: Array.from({ length: 20 }, (_, i) => ({ name: `f${i}`, ops: [{ op: 'pixel', x: i, y: 0, color: 's' }] })) };
  assert.match(check(sparks, { width: 1920, height: 1080 }).problems[0].fix, /, a 480x270 canvas at sheet\.scale 4, for the most detail\)/);
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

test('the schemas allow a still up to 4096 a side, animations and scene assets 1024, a scene\'s view 1024', async () => {
  const read = async file => JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
  const recipe = await read('schema.json'), scene = await read('scene.schema.json');
  assert.deepEqual([recipe.properties.width.maximum, recipe.properties.height.maximum], [4096, 4096]);
  assert.deepEqual(recipe.if, { properties: { frames: { minItems: 2 } }, required: ['frames'] });
  assert.deepEqual(recipe.then, { properties: { width: { maximum: 1024 }, height: { maximum: 1024 } } });
  assert.match(recipe.properties.width.description, /^1–1024 pixels, and at most 262,144 pixels a frame/);
  assert.deepEqual([scene.properties.width.maximum, scene.$defs.recipe.properties.width.maximum, scene.$defs.recipe.properties.height.maximum, scene.$defs.recipe.if], [1024, 1024, 1024, undefined]);
  assert.deepEqual([recipe.$defs.rows.maxItems, recipe.$defs.rows.items.maxLength, recipe.$defs.frame.properties.pixels.maxItems], [1024, 1024, 262144]);
});
