import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject } from '../src/core.js';
import { checkDelivery } from '../src/check.js';
import { patchRecipe } from '../src/patch.js';
import { prepareScene } from '../src/scene.js';
import { sceneGIF } from '../src/scene-export.js';
import { createToolRunner } from '../src/mcp.js';
import { encodePNG } from '../src/png.js';
import { importPNG } from '../src/import.js';
import { encodeGIF } from '../src/gif.js';

// What the CLI, the check and the scene GIF say when a big frame passes a limit: each refusal names the change that
// gets through, and following it does.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const screen = (width, height, frames, extra = {}) => ({
  version: 1, name: 'screen', width, height, palette: { k: '#102030', s: '#a0c0f0' },
  frames: Array.from({ length: frames }, (_, i) => ({ name: `f${i}`, ops: [{ op: 'rect', x: 0, y: 0, w: width, h: height, color: 'k' }, { op: 'pixel', x: i % width, y: 0, color: 's' }] })),
  ...extra
});
const pixelbolt = (args, cwd) => {
  const run = spawnSync(process.execPath, [path.join(root, 'bin', 'pixelbolt.js'), ...args], { cwd, encoding: 'utf8' });
  return JSON.parse(run.status === 0 ? run.stdout : run.stderr);
};
const folder = async t => { const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-big-cli-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; };

test('the CLI\'s budget for every GIF names the largest --gif-scale that fits, as MCP names gif.scale', async t => {
  const dir = await folder(t), names = Array.from({ length: 12 }, (_, i) => `f${i}`);
  await writeFile(path.join(dir, 'title.json'), JSON.stringify(screen(640, 360, 12, { animations: { a: { frames: names }, b: { frames: names } } })));
  // Before: "all animations at this scale exceed 67,108,864 pixels; use a lower scale", naming none.
  const refused = pixelbolt(['render', 'title.json', '--out', 'four', '--gif-scale', '4'], dir);
  assert.equal(refused.error, '--gif-scale: the GIFs of every animation at scale 4 pass the 67,108,864 pixels one render\'s GIFs hold; --gif-scale 3 is the largest that fits');
  const followed = pixelbolt(['render', 'title.json', '--out', 'three', '--gif-scale', '3'], dir);
  assert.equal(followed.ok, true);
  assert.deepEqual([followed.gifs.width, followed.gifs.height], [1920, 1080]);
});

test('compile --size refuses a recipe tied to its canvas before counting its frames', async t => {
  const dir = await folder(t);
  // Before: "19 frames of 640×360 ... 18 frames fit: use fewer frames", and after --frames 1 the outline refusal.
  const iso = pixelbolt(['compile', '--preset', 'iso-tiles', '--size', '640x360', '--out', 'iso.json'], dir);
  assert.match(iso.error, /^--size: frames\[\d+\]\.ops\[\d+\] is "outline", which reads the whole canvas, so this recipe cannot move to another canvas size/);
  // Before: "151 frames ... 72 fit", and after --frames 72 the tile refusal.
  for (const size of ['640x360', '320x180']) {
    const ground = pixelbolt(['compile', '--preset', 'ground', '--size', size, '--out', 'ground.json'], dir);
    assert.equal(ground.error, '--size: frames[0].tile is tied to the canvas size, so this recipe cannot move to another one; change the size in its source instead');
  }
});

test('a frame-total refusal for several animations names the --frames that fits, and --animation', async t => {
  const dir = await folder(t);
  // Before: "... so 72 frames of 320×180 fit: use fewer frames or a smaller canvas", and --frames 72 changed nothing.
  const total = "107 frames of 320×180 are 6,163,200 pixels; a recipe's frames hold at most 4,194,304 in all, so 72 frames of 320×180 fit: use fewer frames or a smaller canvas";
  const refused = pixelbolt(['compile', '--preset', 'fire-spells', '--size', '320x180', '--out', 'all.json'], dir);
  assert.equal(refused.error, `--size: ${total}; --frames 6 keeps 66 (6 of each animation's, evenly spaced), or keep fewer animations with --animation <name>`);
  const kept = pixelbolt(['compile', '--preset', 'fire-spells', '--size', '320x180', '--frames', '6', '--out', 'six.json'], dir);
  assert.deepEqual([kept.ok, kept.frames, kept.width], [true, 66, 320]);
  assert.equal(pixelbolt(['compile', '--preset', 'fire-spells', '--size', '320x180', '--animation', 'impact', '--out', 'one.json'], dir).ok, true);
  // A GIF plays one animation, so when all the frames are too many --animation keeps only it before the canvas moves.
  const gif = pixelbolt(['gif', '--preset', 'fire-spells', '--size', '320x180', '--animation', 'impact', '--out', 'impact.gif'], dir);
  assert.deepEqual([gif.ok, gif.width, gif.frames], [true, 320, 12]);
  // MCP names its own options.
  const run = createToolRunner({ directory: dir, root: dir, version: '0.0.0' });
  const mcp = JSON.parse((await run('pixel_compile', { preset: 'fire-spells', size: '320x180', frames: 72 })).content[0].text);
  assert.equal(mcp.error, `size: ${total}; frames 6 keeps 66 (6 of each animation's, evenly spaced), or keep fewer animations with animation <name>`);
  const followed = JSON.parse((await run('pixel_compile', { preset: 'fire-spells', size: '320x180', frames: 6 })).content[0].text);
  assert.deepEqual([followed.ok, followed.frames], [true, 66]);
});

test('the check\'s direct fix sets sheet.scale 1 inside its patch, and applying the patch passes', () => {
  const recipe = screen(24, 24, 2, { sheet: { scale: 2 } }), expect = { width: 600, height: 400 };
  const fix = checkDelivery(renderProject(recipe), { recipe, expect }).problems[0].fix;
  // Before: "(pixel_patch [width, height] and sheet.scale 1)", whose quoted patch left the sheet at 2x.
  assert.match(fix, /^the canvas is 24x24 at sheet\.scale 2: change the recipe's width and height with sheet\.scale 1 \(pixel_patch \[/);
  const patch = JSON.parse(/pixel_patch (\[.*?\])\)/.exec(fix)[1]);
  assert.deepEqual(patch, [{ set: 'width', value: 600 }, { set: 'height', value: 400 }, { set: 'sheet.scale', value: 1 }]);
  const patched = patchRecipe(recipe, patch).recipe, check = checkDelivery(renderProject(patched), { recipe: patched, expect });
  assert.equal(check.problems, undefined);
  // At scale 1 the patch is the canvas alone.
  const plain = screen(24, 24, 2);
  assert.match(checkDelivery(renderProject(plain), { recipe: plain, expect }).problems[0].fix, /^the canvas is 24x24: change the recipe's width and height \(pixel_patch \[\{ "set": "width", "value": 600 \}, \{ "set": "height", "value": 400 \}\]\)/);
});

test('a scene GIF names the largest scale at which its whole loop fits, up front', () => {
  // 18 frames of a 320x180 asset in a 320x180 scene, played as 45 GIF frames: 2,592,000 pixels at scale 1.
  const scene = prepareScene({ format: 'pixelforge-scene', version: 1, name: 's', width: 320, height: 180, duration: 1800,
    assets: { a: screen(320, 180, 18, { frames: screen(320, 180, 18).frames.map(frame => ({ ...frame, duration: 100 })) }) },
    instances: [{ asset: 'a', at: [0, 0], animation: 'default' }] });
  // Before: "8 or less fits" for one image at 16, then at 8 "more than 12 frames at 2560×1440 exceed 134,217,728 pixels;
  // shorten the loop or use smaller frames", naming no scale.
  assert.throws(() => sceneGIF(scene, { scale: 16 }), { path: 'scale', message: 'scale: at scale 16 the 45 frames of the 320×180 scene are 5120×2880, 663,552,000 pixels in all, past the 134,217,728 a GIF holds; scale 7 is the largest that fits, or shorten the scene' });
  assert.throws(() => sceneGIF(scene, { scale: 8 }), { message: /; scale 7 is the largest that fits, or shorten the scene$/ });
  const gif = sceneGIF(scene, { scale: 7 });
  assert.deepEqual([gif.width, gif.height, gif.frames], [2240, 1260, 45]);
});

test('a sheet refusal names --columns or columns when the call set the columns', async t => {
  const dir = await folder(t), recipe = screen(420, 420, 3);
  await writeFile(path.join(dir, 'tall.json'), JSON.stringify(recipe));
  const tail = 'at scale 5 the 3 frames of 420×420 make an atlas of 4200×4200, past the 16,777,216 pixels one PNG holds; scale 4 is the largest that fits, or';
  // Before: "sheet.columns 1 at scale 5", which --columns 2 overrides, so the patch changed nothing.
  assert.equal(pixelbolt(['render', 'tall.json', '--out', 'o', '--scale', '5', '--columns', '2'], dir).error, `project.sheet.scale: ${tail} --columns 1 at scale 5`);
  const run = createToolRunner({ directory: dir, root: dir, version: '0.0.0' });
  assert.equal(JSON.parse((await run('pixel_render', { project: recipe, scale: 5, columns: 2 })).content[0].text).error, `project.sheet.scale: ${tail} columns 1 at scale 5`);
  // Columns from the recipe itself are still the recipe's.
  await writeFile(path.join(dir, 'two.json'), JSON.stringify({ ...recipe, sheet: { columns: 2 } }));
  assert.equal(pixelbolt(['render', 'two.json', '--out', 'p', '--scale', '5'], dir).error, `project.sheet.scale: ${tail} sheet.columns 1 at scale 5`);
});

test('help says how the largest render scale and a --beside stack are bounded', () => {
  const help = spawnSync(process.execPath, [path.join(root, 'bin', 'pixelbolt.js'), '--help'], { encoding: 'utf8' }).stdout.replace(/\s+/g, ' ');
  assert.match(help, /sheet\.scale, for this export; the largest depends on frame size and count\)/);
  assert.match(help, /at the automatic scale the stack is kept within 8,000 px tall/);
});

test('compile --help and pixel_compile say a --frames count dividing a loop\'s frames keeps its step even, and it does', async t => {
  const dir = await folder(t);
  const help = spawnSync(process.execPath, [path.join(root, 'bin', 'pixelbolt.js'), 'compile', '--help'], { encoding: 'utf8' }).stdout.replace(/\s+/g, ' ');
  assert.match(help, /playing as long as before \(a count dividing a loop's frames keeps its step even\)/);
  const tools = JSON.parse(await readFile(path.join(root, 'evals', 'mocks', 'pixelbolt', '_tools.json'), 'utf8'));
  const listed = (tools.tools ?? tools).find(tool => tool.name === 'pixel_compile').inputSchema.properties.frames.description;
  assert.match(listed, /a count dividing a loop's frames keeps its step even/);
  // A 32-frame loop: 16 divides it and keeps every kept frame 120 ms; 12 does not and draws the stutter warning.
  const source = { format: 'pixelforge-fx', version: 1, name: 'rain', width: 160, height: 90, palette: { d: '#9fb8d8' }, symbols: { drop: ['d'] },
    effects: { rain: { frames: 32, duration: 60, loop: true, seed: 7, edges: ['top', 'left', 'right', 'bottom'], emitters: [{ at: [70, -8], area: [240, 1], rate: 3, angle: [100, 102], speed: [8, 9], life: [12, 16], shapes: ['drop'] }] } } };
  await writeFile(path.join(dir, 'rain.fx.json'), JSON.stringify(source));
  const even = pixelbolt(['compile', 'rain.fx.json', '--frames', '16', '--out', 'even.json'], dir);
  assert.deepEqual([even.ok, even.frames, even.warnings ?? []], [true, 16, []]);
  const kept = JSON.parse(await readFile(path.join(dir, 'even.json'), 'utf8'));
  assert.deepEqual(new Set(kept.frames.map(frame => frame.duration)), new Set([120]));
  const uneven = pixelbolt(['compile', 'rain.fx.json', '--frames', '12', '--out', 'uneven.json'], dir);
  assert.match(uneven.warnings.join('\n'), /frames 12 thins its 32-frame loop unevenly/);
});

test('gif --preset --animation compiles every animation, as main does, so --size places the window by all of them', async t => {
  const dir = await folder(t);
  // Before: only aura was compiled, so the window sat on aura's drawing alone ({left: 20, right: 20, top: 28}) and the
  // reply named no other animation. Now the GIF is the whole preset resized, then played, byte for byte.
  const gif = pixelbolt(['gif', '--preset', 'hero-magic', '--animation', 'aura', '--size', '80x80', '--out', 'aura.gif'], dir);
  assert.equal(pixelbolt(['compile', '--preset', 'hero-magic', '--size', '80x80', '--out', 'whole.json'], dir).ok, true);
  const whole = pixelbolt(['gif', 'whole.json', '--animation', 'aura', '--out', 'whole.gif'], dir);
  assert.deepEqual(await readFile(path.join(dir, 'aura.gif')), await readFile(path.join(dir, 'whole.gif')));
  assert.deepEqual([gif.ok, gif.animation, gif.animations], [true, 'aura', whole.animations]);
  assert.ok(gif.animations.length > 1);
});

test('gif --size --animation default plays a recipe that names no animations, and the reply lists every animation', async t => {
  const dir = await folder(t);
  await writeFile(path.join(dir, 'plain.json'), JSON.stringify(screen(64, 64, 4)));
  // Before: "--animation: no animation "default"", though gif without --size and render name it.
  const plain = pixelbolt(['gif', 'plain.json', '--size', '80x80', '--animation', 'default', '--out', 'plain.gif'], dir);
  assert.deepEqual([plain.ok, plain.animation, plain.width, plain.frames], [true, 'default', 80, 4]);
  // A recipe that names its animations plays the one asked for, and the reply still names them all.
  await writeFile(path.join(dir, 'named.json'), JSON.stringify(screen(64, 64, 4, { animations: { idle: { frames: ['f0', 'f1'] }, run: { frames: ['f2', 'f3'] } } })));
  const named = pixelbolt(['gif', 'named.json', '--size', '80x80', '--animation', 'run', '--out', 'run.gif'], dir);
  assert.deepEqual([named.ok, named.animation, named.frames, named.animations], [true, 'run', 2, ['idle', 'run']]);
  // Stills ("animations": {}) get the stills refusal with --size as without it, and listing the frames it names plays.
  await writeFile(path.join(dir, 'stills.json'), JSON.stringify(screen(64, 64, 4, { animations: {} })));
  const stills = pixelbolt(['gif', 'stills.json', '--size', '80x80', '--animation', 'default', '--out', 'stills.gif'], dir);
  assert.equal(stills.error, pixelbolt(['gif', 'stills.json', '--animation', 'default', '--out', 'stills.gif'], dir).error);
  assert.match(stills.error, /^gif: the frames are stills \("animations": \{\} in the recipe\)/);
  await writeFile(path.join(dir, 'listed.json'), JSON.stringify(screen(64, 64, 4, { animations: { loop: { frames: ['f0', 'f1', 'f2', 'f3'] } } })));
  const listed = pixelbolt(['gif', 'listed.json', '--size', '80x80', '--out', 'listed.gif'], dir);
  assert.deepEqual([listed.ok, listed.width, listed.frames], [true, 80, 4]);
  // The window is placed by every frame's drawing, so the GIF is the played animation of the whole recipe resized,
  // byte for byte: walk touches the left edge, which stays the edge although blink alone does not reach it.
  const box = (name, x0, x1) => ({ name, ops: [{ op: 'rect', x: x0, y: 10, w: x1 - x0 + 1, h: 31, color: 'k' }] });
  const edge = { ...screen(64, 64, 0), frames: [box('f0', 0, 20), box('f1', 4, 16), box('f2', 5, 16), box('f3', 0, 18)], animations: { walk: { frames: ['f0', 'f1', 'f2', 'f3'] }, blink: { frames: ['f1', 'f2'] } } };
  await writeFile(path.join(dir, 'edge.json'), JSON.stringify(edge));
  const blink = pixelbolt(['gif', 'edge.json', '--size', '80x80', '--animation', 'blink', '--out', 'blink.gif'], dir);
  assert.deepEqual([blink.ok, blink.frames, blink.margins], [true, 2, { right: 16, top: 8, bottom: 8 }]);
  const { resizeRecipe } = await import('../src/resize.js'), { animationGIF } = await import('../src/gif.js');
  const whole = animationGIF(renderProject(resizeRecipe(edge, '80x80').recipe), 'blink').data;
  assert.ok(Buffer.from(await readFile(path.join(dir, 'blink.gif'))).equals(Buffer.from(whole)));
});

test('a check whose scale came from the call says to drop or change --scale (scale), and following it passes', async t => {
  const dir = await folder(t), recipe = screen(24, 24, 2);
  await writeFile(path.join(dir, 'plain.json'), JSON.stringify(recipe));
  const fix = reply => reply.check.problems[0].fix;
  // The direct fix: the patch is the canvas alone. Before, it also set sheet.scale 1, and the same call with --scale 2
  // enlarged the patched recipe again.
  const direct = fix(pixelbolt(['render', 'plain.json', '--out', 'a', '--scale', '2', '--expect', '{"width":60,"height":40}'], dir));
  assert.equal(direct, 'the canvas is 24x24 at --scale 2: change the recipe\'s width and height (pixel_patch [{ "set": "width", "value": 60 }, { "set": "height", "value": 40 }]), fit the drawing to it, pixel_inspect, then render again without --scale');
  const patch = JSON.parse(/pixel_patch (\[.*?\])\)/.exec(direct)[1]);
  await writeFile(path.join(dir, 'patched.json'), JSON.stringify(patchRecipe(recipe, patch).recipe));
  assert.equal(pixelbolt(['render', 'patched.json', '--out', 'b', '--expect', '{"width":60,"height":40}'], dir).check.ok, true);
  // The k branch: before, "pixel_patch { set: sheet.scale, value: 1 }", which --scale 2 overrides on the next call.
  assert.equal(fix(pixelbolt(['render', 'plain.json', '--out', 'c', '--scale', '2', '--expect', '{"width":24,"height":24}'], dir)), '--scale 2 enlarges every export: render again without --scale');
  assert.equal(pixelbolt(['render', 'plain.json', '--out', 'c2', '--expect', '{"width":24,"height":24}'], dir).check.ok, true);
  assert.equal(fix(pixelbolt(['render', 'plain.json', '--out', 'd', '--scale', '2', '--expect', '{"width":72,"height":72}'], dir)), 'render again with --scale 3');
  assert.equal(pixelbolt(['render', 'plain.json', '--out', 'e', '--scale', '3', '--expect', '{"width":72,"height":72}'], dir).check.ok, true);
  // A recipe with a scale of its own under --scale: dropping --scale leaves its 3, so the direct patch sets it to 1.
  await writeFile(path.join(dir, 'three.json'), JSON.stringify({ ...recipe, sheet: { scale: 3 } }));
  const under = fix(pixelbolt(['render', 'three.json', '--out', 'f', '--scale', '2', '--expect', '{"width":60,"height":40}'], dir));
  assert.match(under, /\(pixel_patch \[\{ "set": "width", "value": 60 \}, \{ "set": "height", "value": 40 \}, \{ "set": "sheet\.scale", "value": 1 \}\]\), .* then render again without --scale$/);
  assert.equal(fix(pixelbolt(['render', 'three.json', '--out', 'g', '--scale', '2', '--expect', '{"width":72,"height":72}'], dir)), 'render again without --scale');
  assert.equal(pixelbolt(['render', 'three.json', '--out', 'g2', '--expect', '{"width":72,"height":72}'], dir).check.ok, true);
  // A size past a frame: the canvases are offered at --scale k, and the patch leaves sheet.scale alone.
  const large = fix(pixelbolt(['render', 'plain.json', '--out', 'h', '--scale', '2', '--expect', '{"width":1920,"height":1080}'], dir));
  assert.match(large, /1920x1080 is a 128x72 canvas at --scale 15, .*: pixel_patch \[\{"set":"width","value":128\},\{"set":"height","value":72\}\] \(or .*, a 640x360 canvas at --scale 3, for the most detail\), .* then render again with --scale 15 \(--scale 3 for the 640x360 canvas\)$/);
  const wide = JSON.parse(/pixel_patch (\[.*?\]) \(or/.exec(large)[1]);
  await writeFile(path.join(dir, 'wide.json'), JSON.stringify(patchRecipe(recipe, wide).recipe));
  assert.equal(pixelbolt(['render', 'wide.json', '--out', 'i', '--scale', '15', '--expect', '{"width":1920,"height":1080}'], dir).check.ok, true);
  // A still: each route ends with its own render, the still's without --scale. Before, the still's clause said "render
  // again without --scale" and the shared ending "render again with that --scale", naming none.
  const still = screen(24, 24, 1), patched = (patch, name) => writeFile(path.join(dir, name), JSON.stringify(patchRecipe(still, patch).recipe));
  await writeFile(path.join(dir, 'still.json'), JSON.stringify(still));
  const routes = fix(pixelbolt(['render', 'still.json', '--out', 'j', '--scale', '2', '--expect', '{"width":1920,"height":1080}'], dir));
  assert.match(routes, /; or, since this is a still, a 1920x1080 still at one screen pixel per art pixel: pixel_patch \[.*?\]\. Either way, fit the drawing to the new canvas, pixel_inspect, then render again with --scale 15 \(--scale 2 for the 960x540 canvas\), or without --scale for the still$/);
  const [near, detail, whole] = [...routes.matchAll(/(\[\{"set".*?\])/g)].map(match => JSON.parse(match[1]));
  for (const [patch, name, args] of [[near, 'near.json', ['--scale', '15']], [detail, 'detail.json', ['--scale', '2']], [whole, 'whole.json', []]]) {
    await patched(patch, name);
    assert.equal(pixelbolt(['render', name, '--out', name.replace('.json', ''), ...args, '--expect', '{"width":1920,"height":1080}'], dir).check.ok, true, name);
  }
  // No whole scale makes 1921x1080: the still alone, rendered without --scale.
  const odd = fix(pixelbolt(['render', 'still.json', '--out', 'k', '--scale', '2', '--expect', '{"width":1921,"height":1080}'], dir));
  assert.equal(odd, 'no whole --scale makes 1921x1080 from this canvas, but a still may be up to 4096 px a side, so make it a 1921x1080 still at one screen pixel per art pixel: pixel_patch [{"set":"width","value":1921},{"set":"height","value":1080}], fit the drawing to the new canvas, pixel_inspect, then render again without --scale');
  await patched(JSON.parse(/pixel_patch (\[.*?\])/.exec(odd)[1]), 'odd.json');
  assert.equal(pixelbolt(['render', 'odd.json', '--out', 'l', '--expect', '{"width":1921,"height":1080}'], dir).check.ok, true);
  // MCP names its own option.
  const run = createToolRunner({ directory: dir, root: dir, version: '0.0.0' });
  const stillMCP = JSON.parse((await run('pixel_render', { project: still, scale: 2, expect: { width: 1920, height: 1080 } })).content[0].text);
  assert.match(stillMCP.check.problems[0].fix, /then pixel_render again with scale: 15 \(scale: 2 for the 960x540 canvas\), or without scale for the still$/);
  const mcp = JSON.parse((await run('pixel_render', { project: recipe, scale: 2, expect: { width: 24, height: 24 } })).content[0].text);
  assert.equal(mcp.check.problems[0].fix, 'scale 2 enlarges every export: pixel_render again without scale');
  // Without a call's scale, the recipe's own sheet.scale is still patched.
  const own = { ...recipe, sheet: { scale: 2 } };
  assert.equal(checkDelivery(renderProject(own), { recipe: own, expect: { width: 24, height: 24 }, call: 'cli' }).problems[0].fix, 'sheet.scale 2 enlarges every export: pixel_patch { "set": "sheet.scale", "value": 1 }, then render again');
});

test('the check\'s canvas for the most detail holds the frames expect asks for, so both fixes together render', async t => {
  const dir = await folder(t), recipe = screen(8, 8, 2), expect = { width: 1920, height: 1080, frames: 8 };
  const problems = checkDelivery(renderProject(recipe), { recipe, expect }).problems;
  // Before: "or ... a 640x360 canvas at sheet.scale 3, for the most detail", whose 8 frames make an 11520x2160 atlas.
  assert.match(problems[0].fix, /\(or \[\{"set":"width","value":480\},\{"set":"height","value":270\},\{"set":"sheet","value":\{"scale":4\}\}\], a 480x270 canvas at sheet\.scale 4, for the most detail\)/);
  const detailed = JSON.parse(/\(or (\[.*?\]), a 480x270/.exec(problems[0].fix)[1]);
  // Both fixes: the canvas, then the 6 more frames the frame problem asks for.
  const resized = patchRecipe(recipe, detailed).recipe, full = { ...resized, frames: screen(480, 270, 8).frames };
  await writeFile(path.join(dir, 'eight.json'), JSON.stringify(full));
  const rendered = pixelbolt(['render', 'eight.json', '--out', 'o', '--expect', JSON.stringify(expect)], dir);
  assert.deepEqual([rendered.ok, rendered.check.ok], [true, true]);
});

test('render\'s GIF budget is a PixelError at --gif-scale, checked before a GIF is encoded', async t => {
  const dir = await folder(t), names = Array.from({ length: 12 }, (_, i) => `f${i}`);
  // 300 colours in a frame, which a GIF refuses while it encodes: the budget speaks first.
  const title = screen(640, 360, 12, { animations: { a: { frames: names }, b: { frames: names } } });
  title.frames[0].ops.push(...Array.from({ length: 300 }, (_, i) => ({ op: 'pixel', x: i, y: 5, color: `#${(0x102030 + i * 257).toString(16).padStart(6, '0')}` })));
  await writeFile(path.join(dir, 'title.json'), JSON.stringify(title));
  // Before: a plain error with no path, after every GIF was encoded (here the colour refusal came first).
  const refused = pixelbolt(['render', 'title.json', '--out', 'four', '--gif-scale', '4'], dir);
  assert.deepEqual([refused.path, refused.error], ['--gif-scale', '--gif-scale: the GIFs of every animation at scale 4 pass the 67,108,864 pixels one render\'s GIFs hold; --gif-scale 3 is the largest that fits']);
  assert.match(pixelbolt(['render', 'title.json', '--out', 'three', '--gif-scale', '3'], dir).error, /^gif: frame 1 of the animation uses \d+ colours/);
});

test('a scene GIF too long at scale 1 names the frame rate that fits, and one frame is said as one', () => {
  const scene = prepareScene({ format: 'pixelforge-scene', version: 1, name: 's', width: 1024, height: 256, duration: 60000,
    assets: { a: screen(1024, 256, 2) }, instances: [{ asset: 'a', at: [0, 0], animation: 'default' }] });
  // Before: path "scale" and "shorten the scene" alone, at a scale that was already 1.
  assert.throws(() => sceneGIF(scene), { path: 'fps', message: 'fps: at scale 1 the 1500 frames of the 1024×256 scene are 1024×256, 393,216,000 pixels in all, past the 134,217,728 a GIF holds; fps 8 is the largest that fits, or shorten the scene' });
  assert.throws(() => sceneGIF(scene, { scale: 2 }), { path: 'fps', message: /; fps 8 at scale 1 is the largest that fits, or shorten the scene$/ });
  assert.throws(() => sceneGIF(scene, { fps: 9 }), { path: 'fps' });
  assert.equal(sceneGIF(scene, { fps: 8 }).frames, 480);
  // One frame: "1 frame ... exceeds", and no animation to shorten.
  const still = [{ data: new Uint8ClampedArray(1024 * 1024 * 4).fill(255), duration: 100 }];
  assert.throws(() => encodeGIF(still, 1024, 1024, { scale: 16 }), { message: 'gif: 1 frame at 16384×16384 exceeds 67,108,864 pixels; scale 8 is the largest that fits' });
  assert.equal(encodeGIF(still, 1024, 1024, { scale: 8 }).width, 8192);
});

test('an option a command does not take names its nearest one, and following it works', async t => {
  const dir = await folder(t);
  await writeFile(path.join(dir, 'a.json'), JSON.stringify(screen(32, 32, 3)));
  const refused = pixelbolt(['inspect', 'a.json', '--frame', 'f1', '--out', 'a.png'], dir);
  assert.equal(refused.error, '--frame is not supported by inspect; did you mean --frames?');
  assert.equal(pixelbolt(['inspect', 'a.json', '--frames', 'f1', '--out', 'a.png'], dir).ok, true);
  assert.equal(pixelbolt(['render', 'a.json', '--out', 'o', '--scal', '2'], dir).error, 'Unknown option: --scal; did you mean --scale?');
  assert.equal(pixelbolt(['render', 'a.json', '--out', 'o', '--colour', 'k'], dir).error, 'Unknown option: --colour');
});

test('inspect, render and validate say a source compiles first and a scene goes to scene or gif', async t => {
  const dir = await folder(t);
  await writeFile(path.join(dir, 'meteor.fx.json'), await readFile(path.join(root, 'examples', 'meteor.fx.json')));
  // Before: "project.format: unknown field; fields here: ...".
  for (const command of ['inspect', 'render', 'validate']) {
    const reply = pixelbolt([command, 'meteor.fx.json', ...(command === 'validate' ? [] : ['--out', command === 'render' ? 'r' : 'i.png'])], dir);
    assert.equal(reply.path, 'project.format');
    assert.equal(reply.error, `project.format: this is a pixelforge-fx source: compile it first (pixelbolt compile meteor.fx.json --out <new.json>), then ${command} the recipe it writes`);
  }
  assert.equal(pixelbolt(['compile', 'meteor.fx.json', '--out', 'meteor.json'], dir).ok, true);
  assert.equal(pixelbolt(['inspect', 'meteor.json', '--out', 'm.png'], dir).ok, true);
  const scene = { format: 'pixelforge-scene', version: 1, name: 'sc', width: 32, height: 32, assets: { a: screen(32, 32, 2) }, instances: [{ asset: 'a', at: [0, 0] }] };
  await writeFile(path.join(dir, 'sc.scene.json'), JSON.stringify(scene));
  for (const command of ['inspect', 'validate']) assert.equal(pixelbolt([command, 'sc.scene.json', ...(command === 'inspect' ? ['--out', 's.png'] : [])], dir).error, 'project.format: this is a scene, not a recipe: use pixelbolt scene on it (--out <folder>, or --image <view.png> for one view) or pixelbolt gif (--out <new.gif>)');
  assert.equal(pixelbolt(['render', 'sc.scene.json', '--out', 'sr'], dir).path, 'project.format');
  assert.equal(pixelbolt(['scene', 'sc.scene.json', '--image', 'view.png'], dir).ok, true);
  assert.equal(pixelbolt(['gif', 'sc.scene.json', '--out', 'sc.gif'], dir).ok, true);
  // Pose and wave sources are still inspected as they compile.
  assert.equal(pixelbolt(['inspect', path.join(root, 'examples', 'hero.poses.json'), '--out', 'h.png'], dir).ok, true);
});

test('a PNG imported whole within a still\'s limits is a still, its grid in tiles; past them, frame splits it', async t => {
  const dir = await folder(t), width = 1500, height = 700, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if ((x * 7 + y * 3) % 11 && !(x < 1024 && y >= 256 && y < 512)) data.set([(x % 4) * 60, (y % 4) * 60, 90, 255], (y * width + x) * 4);
  const bytes = encodePNG(data, width, height);
  await writeFile(path.join(dir, 'wall.png'), bytes);
  // Before: "a 1500×700 frame is 1,050,000 pixels ...; give frame, the size of one frame in a sheet".
  assert.equal(pixelbolt(['import', 'wall.png', '--out', 'wall.json'], dir).ok, true);
  const recipe = importPNG(bytes).recipe, project = renderProject(recipe);
  assert.deepEqual([project.width, project.height, project.frames.length], [width, height, 1]);
  assert.ok(Buffer.from(project.frames[0].data).equals(Buffer.from(data)), 'every pixel as the PNG holds it');
  // Tiles of at most 1024 across and 262,144 cells; the empty one is left out.
  assert.ok(recipe.frames[0].ops.every(op => op.rows[0].length <= 1024 && op.rows.length * op.rows[0].length <= 262144));
  assert.equal(recipe.frames[0].ops.length, 5);
  assert.equal(pixelbolt(['render', 'wall.json', '--out', 'out'], dir).ok, true);
  // Past a still's limits the refusal says frame splits it into an animation, and frame does.
  await writeFile(path.join(dir, 'strip.png'), encodePNG(new Uint8ClampedArray(4100 * 8 * 4).fill(200), 4100, 8));
  assert.equal(pixelbolt(['import', 'strip.png', '--out', 'strip.json'], dir).error, 'import: a 4100×8 image is past a still\'s 4096 pixels a side and 4,194,304 in all; give frame, the size of one frame in a sheet, to split it into an animation');
  assert.equal(pixelbolt(['import', 'strip.png', '--frame', '820x8', '--out', 'strip.json'], dir).ok, true);
  assert.equal(JSON.parse(await readFile(path.join(dir, 'strip.json'), 'utf8')).frames.length, 5);
});

test('a still narrower than 256 and taller than 1024 imports in tiles of at most 1024 rows', async t => {
  const dir = await folder(t);
  // Before: "project.frames[0].ops[0].rows: expected an array with at most 1024 items", core's own validation.
  for (const [width, height] of [[100, 4000], [1, 4096], [255, 1100]]) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if ((x + y) % 3) data.set([(x % 5) * 50, (y % 7) * 30, 90, 255], (y * width + x) * 4);
    const bytes = encodePNG(data, width, height), name = `tall-${width}.png`;
    await writeFile(path.join(dir, name), bytes);
    const reply = pixelbolt(['import', name, '--out', `tall-${width}.json`], dir);
    assert.equal(reply.ok, true, reply.error);
    const recipe = JSON.parse(await readFile(path.join(dir, `tall-${width}.json`), 'utf8'));
    assert.ok(recipe.frames[0].ops.every(op => op.rows.length <= 1024 && op.rows[0].length <= 1024 && op.rows.length * op.rows[0].length <= 262144));
    const project = renderProject(recipe);
    assert.ok(Buffer.from(project.frames[0].data).equals(Buffer.from(data)), `${width}×${height}: every pixel as the PNG holds it`);
  }
});

test('a scene GIF at the default rate names the even rate when its frames would be split unevenly, and that rate holds them evenly', async t => {
  const dir = await folder(t);
  // A backdrop and a 30-frame snow loop of 100 ms frames over 3000 ms. Before: 25 fps and no word, while each snow
  // frame was held 120 ms, then 80, in turn.
  const snow = { ...screen(32, 18, 30), frames: screen(32, 18, 30).frames.map(frame => ({ ...frame, duration: 100, ops: frame.ops.slice(1) })) };
  const source = { format: 'pixelforge-scene', version: 1, name: 'winter', width: 32, height: 18, duration: 3000, assets: { backdrop: screen(32, 18, 1, { animations: {} }), snow },
    instances: [{ asset: 'backdrop', at: [0, 0], frame: 'f0' }, { asset: 'snow', at: [0, 0], animation: 'default' }] };
  await writeFile(path.join(dir, 'winter.scene.json'), JSON.stringify(source));
  const note = 'At 25 fps (40 ms a GIF frame) frames of 100 ms are held for uneven numbers of GIF frames, so their animation stutters; fps 20 holds each for a whole number.';
  const plain = pixelbolt(['gif', 'winter.scene.json', '--out', 'plain.gif'], dir);
  assert.deepEqual([plain.fps, plain.frames, plain.notes], ['25', 75, [note]]);
  const even = pixelbolt(['gif', 'winter.scene.json', '--out', 'even.gif', '--fps', '20'], dir);
  assert.deepEqual([even.ok, even.fps, even.frames, even.notes], [true, '20', 60, undefined]);
  // How long each snow frame stays on screen, in GIF frames: alternating 3 and 2 at 25 fps, 2 apiece at 20.
  const scene = prepareScene(source), { renderScene } = await import('../src/scene.js');
  const holds = (frameMs, count) => {
    const runs = []; let last = null;
    for (let k = 0; k < count; k++) {
      const image = Buffer.from(renderScene(scene, { time: k * frameMs }).data).toString('base64');
      if (image === last) runs[runs.length - 1]++; else runs.push(1);
      last = image;
    }
    return new Set(runs);
  };
  assert.deepEqual(holds(40, 75), new Set([3, 2]));
  assert.deepEqual(holds(50, 60), new Set([2]));
  assert.deepEqual(sceneGIF(scene, { fps: 20 }).delays, { 50: 60 });
  // Given a rate, the call chose it: no note. MCP, given none, says the same as the CLI.
  assert.equal(sceneGIF(scene, { fps: 25 }).notes.length, 0);
  const run = createToolRunner({ directory: dir, root: dir, version: '0.0.0' });
  const viewed = JSON.parse((await run('pixel_scene', { scene: source, gif: { scale: 1 } })).content[0].text);
  assert.ok(JSON.stringify(viewed).includes(note), JSON.stringify(viewed).slice(0, 400));
  // A placement hidden at first and shown by a cue that plays snow stutters the same way, and fps 20 holds it evenly.
  const cued = { ...source, duration: 1200, instances: [source.instances[0], { asset: 'snow', at: [0, 0], hidden: true, sequence: [{ time: 200, animation: 'default' }] }] };
  assert.deepEqual(sceneGIF(prepareScene(cued)).notes, [note]);
  const followed = sceneGIF(prepareScene(cued), { fps: 20 });
  assert.deepEqual([followed.frames, followed.delays, followed.notes], [24, { 50: 24 }, []]);
  // No note where no even rate from 8 to 25 fps exists: frames sharing only 10 or 20 ms (stride's 90 and 80) would
  // need more than 25 fps, and frames of 130 and 260 ms less than 8.
  const timed = durations => ({ ...source, duration: 2600, instances: [source.instances[0], { asset: 'snow', at: [0, 0], animation: 'default' }],
    assets: { ...source.assets, snow: { ...snow, frames: snow.frames.slice(0, durations.length).map((frame, i) => ({ ...frame, duration: durations[i] })), animations: { default: { frames: durations.map((_, i) => `f${i}`), loop: true } } } } });
  for (const durations of [[90, 80, 80, 90, 80, 80], [60, 100], [130, 260]]) assert.deepEqual(sceneGIF(prepareScene(timed(durations))).notes.filter(text => text.includes('holds each')), [], String(durations));
  // Frames of 110 and 330 ms (iso-glade's coin) name fps 100/11, and that rate holds them in 110 ms GIF frames.
  const coin = sceneGIF(prepareScene({ ...timed([110, 330, 110]), duration: 1100 }));
  assert.ok(coin.notes.some(text => text.endsWith('fps 100/11 (110 ms a frame) holds each for a whole number.')), coin.notes.join('\n'));
  const coinEven = sceneGIF(prepareScene({ ...timed([110, 330, 110]), duration: 1100 }), { fps: '100/11' });
  assert.deepEqual([coinEven.frames, coinEven.delays], [10, { 110: 10 }]);
});
