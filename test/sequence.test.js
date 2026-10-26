import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, readdir, mkdtemp, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, PixelError } from '../src/core.js';
import { prepareScene, renderScene } from '../src/scene.js';
import { decodePNG } from '../src/import.js';
import { parseFrameRate, planSequence, placeSprite, createSequence, createSceneSequence, frameGrid, VIDEO_SIZES } from '../src/sequence.js';
import { writeBundle } from '../src/export.js';

const root = fileURLToPath(new URL('../', import.meta.url));
// Whether this folder ignores letter case, asked of the file system: Windows and macOS do by default, but a folder or
// volume can be case-sensitive.
const ignoresCase = async dir => {
  const probe = path.join(dir, 'case-probe');
  await writeFile(probe, '');
  try { await access(path.join(dir, 'CASE-PROBE')); return true; } catch { return false; } finally { await rm(probe); }
};
const fps = value => parseFrameRate(value);
// Three poses on a 2 × 1 canvas: opaque red, half-transparent green, and one pixel of blue.
const recipe = { version: 1, name: 'probe', width: 2, height: 1, palette: { k: '#102030' }, frames: [
  { name: 'red', duration: 100, ops: [{ op: 'pixel', x: 0, color: '#ff0000' }, { op: 'pixel', x: 1, color: '#ff0000' }] },
  { name: 'half', duration: 50, pixels: [{ x: 0, y: 0, color: '#00ff0080' }] },
  { name: 'blue', duration: 50, ops: [{ op: 'pixel', x: 1, color: '#0000ff' }] }
], animations: { cycle: { frames: ['red', 'half', 'blue'] }, once: { frames: ['red', 'blue'], loop: false } } };
const pixel = (png, x, y) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)];

test('frame rates are exact fractions, including the NTSC rates', () => {
  assert.deepEqual([fps(30), fps('25'), fps('29.97'), fps('23.976'), fps('59.94'), fps(12.5), fps('30000/1001'), fps('60/2')].map(rate => [rate.numerator, rate.denominator, rate.label]),
    [[30, 1, '30'], [25, 1, '25'], [30000, 1001, '29.97'], [24000, 1001, '23.976'], [60000, 1001, '59.94'], [25, 2, '25/2'], [30000, 1001, '30000/1001'], [30, 1, '30']]);
  for (const bad of [0, -1, 'fast', '30fps', 241, '1/0', '']) assert.throws(() => fps(bad), error => error instanceof PixelError && error.path === 'sequence.fps', String(bad));
});
test('each video frame shows the pose that is active when the frame starts', () => {
  // 100 + 50 + 50 ms at 20 fps is four 50 ms frames; the loop closes on the grid.
  const even = planSequence([100, 50, 50], { fps: fps(20) });
  assert.deepEqual([even.poses, even.count, even.seamless, even.timing.map(t => [t.frames, t.got])], [[0, 0, 1, 2], 4, true, [[2, 100], [1, 50], [1, 50]]]);
  // At 30 fps the same animation is six frames starting at 0, 33, 67, 100, 133 and 167 ms: the two equal short poses
  // get two frames and one.
  const uneven = planSequence([100, 50, 50], { fps: fps(30) });
  assert.deepEqual([uneven.poses, uneven.seamless, uneven.timing.map(t => t.frames)], [[0, 0, 0, 1, 1, 2], true, [3, 2, 1]]);
  // 110 ms is 3.3 frames at 30 fps: the clip rounds up, the loop does not close, and ten loops would.
  const open = planSequence([110], { fps: fps(30) });
  assert.deepEqual([open.count, open.seamless, open.exactFrames, open.loopsThatFit], [4, false, 3.3, 10]);
  assert.deepEqual([planSequence([110], { fps: fps(30), loops: 10 }).count, planSequence([110], { fps: fps(30), loops: 10 }).seamless], [33, true]);
  // 29.97 is 30000/1001: 1001 ms is exactly thirty frames, with no drift however long the clip.
  assert.deepEqual([planSequence([1001], { fps: fps('29.97') }).count, planSequence([1001], { fps: fps('29.97'), loops: 600 }).count], [30, 18000]);
  // A pose shorter than a frame that no frame start lands in is never shown, and is reported with zero frames.
  assert.deepEqual(planSequence([190, 10], { fps: fps(10) }).timing.map(t => t.frames), [2, 0]);
  // On twos: every sampled frame is held for two video frames.
  assert.deepEqual(planSequence([100, 100, 100, 100], { fps: fps(10), step: 2 }).poses, [0, 0, 2, 2]);
  // A length in seconds: a loop keeps cycling, an animation that plays once holds its last pose.
  assert.deepEqual(planSequence([100, 100], { fps: fps(10), seconds: 0.5 }).poses, [0, 1, 0, 1, 0]);
  assert.deepEqual(planSequence([100, 100], { fps: fps(10), seconds: 0.5, loop: false }).poses, [0, 1, 1, 1, 1]);
  for (const [options, where] of [[{ loops: 0 }, 'sequence.loops'], [{ step: 61 }, 'sequence.step'], [{ seconds: 0 }, 'sequence.seconds'], [{ seconds: 4000 }, 'sequence.seconds'], [{ loops: 1000 }, 'sequence']]) assert.throws(() => planSequence([60000], { fps: fps(60), ...options }), error => error.path === where, where);
});
test('a sprite is enlarged by a whole number and placed on a video-sized canvas', () => {
  assert.deepEqual(placeSprite(24, 24), { width: 24, height: 24, scale: 1, x: 0, y: 0, spriteWidth: 24, spriteHeight: 24 });
  assert.deepEqual(placeSprite(24, 24, { scale: 8 }), { width: 192, height: 192, scale: 8, x: 0, y: 0, spriteWidth: 192, spriteHeight: 192 });
  // The default scale on a canvas is the largest that fits; the sprite is centred.
  assert.deepEqual(placeSprite(24, 24, { size: '1080p' }), { width: 1920, height: 1080, scale: 45, x: 420, y: 0, spriteWidth: 1080, spriteHeight: 1080 });
  assert.deepEqual(placeSprite(240, 135, { size: '1080p' }), { width: 1920, height: 1080, scale: 8, x: 0, y: 0, spriteWidth: 1920, spriteHeight: 1080 });
  assert.deepEqual(placeSprite(48, 16, { size: 'vertical', scale: 10, align: 'bottom-left', offset: [40, -60] }), { width: 1080, height: 1920, scale: 10, x: 40, y: 1700, spriteWidth: 480, spriteHeight: 160 });
  // 8 × 8 fits a 100 × 60 canvas seven times: 56 pixels, so 44 from the left when right-aligned and 2 from the top when centred.
  assert.deepEqual([placeSprite(8, 8, { size: '100x60', align: 'top-right' }).x, placeSprite(8, 8, { size: [100, 60], align: 'right' }).y, VIDEO_SIZES['4k']], [44, 2, [3840, 2160]]);
  // Cover takes the smallest whole scale that covers the canvas; what hangs over is cropped, and the result says so.
  assert.deepEqual(placeSprite(192, 72, { size: '1080p', fit: 'cover' }), { width: 1920, height: 1080, scale: 15, x: -480, y: 0, spriteWidth: 2880, spriteHeight: 1080, fit: 'cover', cropped: true, covers: true });
  assert.deepEqual(placeSprite(240, 135, { size: '1080p', fit: 'cover' }), { width: 1920, height: 1080, scale: 8, x: 0, y: 0, spriteWidth: 1920, spriteHeight: 1080, fit: 'cover', cropped: false, covers: true });
  // With cover a sprite may be larger than the canvas, a chosen scale may overhang, and align picks the part that stays.
  assert.deepEqual([placeSprite(24, 24, { size: '16x16', fit: 'cover' }).x, placeSprite(24, 24, { size: '1080p', fit: 'cover', scale: 46, align: 'top' }).y, placeSprite(24, 24, { size: '1080p', fit: 'cover', scale: 10 }).covers], [-4, 0, false]);
  for (const [options, where] of [[{ fit: 'cover' }, 'sequence.fit'], [{ size: '1080p', fit: 'stretch' }, 'sequence.fit'], [{ size: '1080p', fit: 'cover', offset: [4000, 0] }, 'sequence.offset']]) assert.throws(() => placeSprite(24, 24, options), error => error.path === where, JSON.stringify(options));
  assert.throws(() => placeSprite(8, 8, { size: '4k', fit: 'cover' }), error => error.path === 'sequence.fit' && /scale of 480/.test(error.message));
  for (const [options, where] of [[{ size: '8k' }, 'sequence.size'], [{ size: '5000x10' }, 'sequence.size'], [{ size: '16x16' }, 'sequence.size'], [{ size: '1080p', scale: 46 }, 'sequence.scale'], [{ scale: 300 }, 'sequence.scale'], [{ size: '1080p', align: 'middle' }, 'sequence.align'], [{ size: '1080p', offset: [900, 0] }, 'sequence.offset'], [{ offset: [1] }, 'sequence.offset']]) assert.throws(() => placeSprite(24, 24, options), error => error.path === where, JSON.stringify(options));
});
test('a recipe becomes numbered PNG frames with exact pixels, straight alpha, a sidecar and working instructions', () => {
  const { info, files } = createSequence(renderProject(recipe), { fps: 20, size: '8x4', scale: 2, align: 'bottom-right' });
  assert.deepEqual([...files.keys()], ['probe-cycle_0001.png', 'probe-cycle_0002.png', 'probe-cycle_0003.png', 'probe-cycle_0004.png', 'sequence.json', 'README.txt']);
  // Frames of one pose are the same bytes, encoded once.
  assert.equal(files.get('probe-cycle_0001.png'), files.get('probe-cycle_0002.png')); assert.equal(info.differentFrames, 3);
  const [red, , half, blue] = [1, 2, 3, 4].map(number => decodePNG(files.get(`probe-cycle_000${number}.png`)));
  assert.deepEqual([red.width, red.height], [8, 4]);
  // The 2 × 1 sprite at scale 2 is 4 × 2, in the bottom-right corner; everything else is transparent.
  assert.deepEqual([pixel(red, 3, 1), pixel(red, 4, 1), pixel(red, 4, 2), pixel(red, 7, 3)], [[0, 0, 0, 0], [0, 0, 0, 0], [255, 0, 0, 255], [255, 0, 0, 255]]);
  // Half-transparent green keeps its colour and its alpha: the PNG is not premultiplied.
  assert.deepEqual([pixel(half, 4, 2), pixel(half, 5, 3), pixel(half, 6, 2)], [[0, 255, 0, 128], [0, 255, 0, 128], [0, 0, 0, 0]]);
  assert.deepEqual([pixel(blue, 5, 2), pixel(blue, 6, 2), pixel(blue, 7, 3)], [[0, 0, 0, 0], [0, 0, 255, 255], [0, 0, 255, 255]]);
  const sidecar = JSON.parse(files.get('sequence.json').toString());
  assert.deepEqual(sidecar, info);
  assert.deepEqual([info.format, info.frames, info.fps, info.seconds, info.width, info.height, info.pattern, info.first, info.alpha], ['pixelforge-sequence', 4, { label: '20', numerator: 20, denominator: 1 }, 0.2, 8, 4, 'probe-cycle_%04d.png', 1, 'straight (unpremultiplied)']);
  assert.deepEqual([info.placement, info.loop, info.notes], [{ scale: 2, x: 4, y: 2, width: 4, height: 2, source: [2, 1] }, { loops: 1, plays: 'loops', passFrames: 4, seamless: true }, []]);
  assert.deepEqual(info.timing, [{ pose: 'red', frames: 2, wanted: 100, got: 100 }, { pose: 'half', frames: 1, wanted: 50, got: 50 }, { pose: 'blue', frames: 1, wanted: 50, got: 50 }]);
  assert.equal(info.commands.prores4444, 'ffmpeg -framerate 20 -start_number 1 -i "probe-cycle_%04d.png" -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le -vf "scale=out_color_matrix=bt709:flags=neighbor" -colorspace bt709 -color_primaries bt709 -color_trc bt709 "probe-cycle.mov"');
  assert.equal(info.commands.h264, undefined);
  const readme = files.get('README.txt').toString();
  for (const expected of ['4 PNG files, probe-cycle_####.png, numbered from 0001.', '8 x 4 pixels, 20 frames per second, 0.2 seconds.', 'import these files as an image sequence', "set the clip's frame rate to 20 where", info.commands.prores4444]) assert.ok(readme.includes(expected), expected);
});
test('cover fills the canvas with the sprite and crops what hangs over', () => {
  // 2 × 1 covers 3 × 3 at scale 3: 6 × 3, centred, so one and a half canvas pixels hang over on each side.
  const { info, files } = createSequence(renderProject(recipe), { fps: 20, size: '3x3', fit: 'cover' });
  assert.deepEqual(info.placement, { scale: 3, x: -2, y: 0, width: 6, height: 3, source: [2, 1], fit: 'cover', cropped: true, visible: [0, 0, 2, 1] });
  assert.deepEqual(info.notes, ['The sprite is enlarged 3 times to 6×3 and cropped to the 3×3 canvas: columns 0 to 1 and rows 0 to 0 of the sprite stay in view.']);
  // The blue pose is transparent on the left and blue on the right: one canvas column of the left pixel is left.
  const blue = decodePNG(files.get('probe-cycle_0004.png'));
  assert.deepEqual([[blue.width, blue.height], pixel(blue, 0, 0), pixel(blue, 1, 0), pixel(blue, 2, 2)], [[3, 3], [0, 0, 0, 0], [0, 0, 255, 255], [0, 0, 255, 255]]);
  // Align chooses what stays: from the left edge, only the sprite's left pixel is on the canvas.
  const left = createSequence(renderProject(recipe), { fps: 20, size: '3x3', fit: 'cover', align: 'left', background: 'k' });
  assert.deepEqual([left.info.placement.visible, pixel(decodePNG(left.files.get('probe-cycle_0004.png')), 2, 1), pixel(decodePNG(left.files.get('probe-cycle_0001.png')), 2, 1)], [[0, 0, 1, 1], [16, 32, 48, 255], [255, 0, 0, 255]]);
  // A sprite that covers the canvas exactly is not cropped, and nothing is noted.
  const exact = createSequence(renderProject(recipe), { fps: 20, size: '8x4', fit: 'cover' });
  assert.deepEqual([exact.info.placement, exact.info.notes], [{ scale: 4, x: 0, y: 0, width: 8, height: 4, source: [2, 1], fit: 'cover', cropped: false, visible: [0, 0, 2, 1] }, []]);
});
test('a background blends the alpha away, and the notes say what the frame grid changed', () => {
  const project = renderProject(recipe), matte = createSequence(project, { fps: '29.97', background: 'k', scale: 2 });
  const half = decodePNG(matte.files.get('probe-cycle_0005.png'));
  // 100 + 50 + 50 ms at 29.97 is 5.994 frames: six files, poses holding 3, 2 and 1 frames.
  assert.deepEqual([matte.info.frames, matte.info.timing.map(entry => entry.frames), matte.info.alpha], [6, [3, 2, 1], 'none: opaque background']);
  // #00ff0080 over #102030: every channel is the rounded blend, and the result is opaque.
  assert.deepEqual([pixel(half, 0, 0), pixel(half, 2, 1)], [[8, 144, 24, 255], [16, 32, 48, 255]]);
  assert.match(matte.info.commands.h264, /^ffmpeg -framerate 30000\/1001 .* -c:v libx264 .* "probe-cycle\.mp4"$/);
  // H.264 keeps every colour in lossless 4:4:4; 4:2:0, which shares colour between each 2 × 2 pixels, is the compatible
  // extra and needs an even canvas. With 4:4:4 an odd canvas still gets an H.264 command.
  assert.match(matte.info.commands.h264, / -qp 0 -pix_fmt yuv444p /);
  assert.match(matte.info.commands.h264Compatible, /^ffmpeg -framerate 30000\/1001 .* -crf 14 -pix_fmt yuv420p .* "probe-cycle-yuv420\.mp4"$/);
  const odd = createSequence(project, { fps: 10, background: 'k', size: '5x3' });
  assert.deepEqual([odd.info.width, Object.keys(odd.info.commands)], [5, ['prores4444', 'h264']]);
  for (const command of [matte.info.commands.h264, matte.info.commands.h264Compatible]) assert.ok(matte.files.get('README.txt').toString().includes(command));
  assert.deepEqual(matte.info.notes, [
    '3 of 3 poses changed length to fit whole video frames: red 100→100.1 ms, half 50→66.733 ms, blue 50→33.367 ms.',
    'One pass is 5.994 video frames, so this clip does not end exactly where the loop does and will hitch if the editor loops it.'
  ]);
  const once = createSequence(project, { fps: 10, animation: 'once', seconds: 0.5, step: 2 });
  assert.deepEqual([once.info.name, once.info.frames, once.info.loop.plays, once.info.loop.seamless, once.info.notes.at(-1)], ['probe-once', 5, 'once', false, 'Animated on 2s: each sampled frame is held for 2 video frames.']);
  const dropped = createSequence(renderProject({ ...recipe, frames: [{ ...recipe.frames[0], duration: 190 }, { ...recipe.frames[1], duration: 10 }, recipe.frames[2]], animations: { cycle: { frames: ['red', 'half'] } } }), { fps: 10 });
  assert.match(dropped.info.notes[0], /^1 pose is shorter than one video frame \(100 ms\) and never shown: half \(10 ms\)\.$/);
  for (const [options, where] of [[{}, 'sequence.fps'], [{ fps: 30, animation: 'nope' }, 'sequence.animation'], [{ fps: 30, background: '#00000080' }, 'sequence.background'], [{ fps: 30, dither: true }, 'sequence.dither'], [{ fps: 30, size: '4k', seconds: 3600 }, 'sequence']]) assert.throws(() => createSequence(project, options), error => error instanceof PixelError && error.path === where, where);
});
test('a scene becomes a shot: each frame is the scene at that moment, and still moments share a file', async () => {
  const source = JSON.parse(await readFile(path.join(root, 'examples', 'quality', 'stride.scene.json'), 'utf8')), scene = prepareScene(source);
  const { info, files } = createSceneSequence(scene, source.name, { fps: 12, size: '768x288' });
  // 3000 ms at 12 fps is 36 frames; a 192 × 72 scene fills 768 × 288 at scale 4.
  assert.deepEqual([info.source, info.frames, info.seconds, info.placement.scale, info.loop, info.sceneDuration], ['scene', 36, 3, 4, { loops: 1, plays: 'loops', passFrames: 36, seamless: true }, 3000]);
  for (const number of [1, 7, 36]) {
    const png = decodePNG(files.get(`skink-stride-study_${String(number).padStart(4, '0')}.png`)), expected = renderScene(scene, { time: (number - 1) * 1000 / 12 });
    for (const [x, y] of [[0, 0], [20, 30], [60, 40], [100, 50], [191, 71]]) assert.deepEqual(pixel(png, x * 4 + 3, y * 4 + 1), [...expected.data.subarray((y * 192 + x) * 4, (y * 192 + x) * 4 + 4)], `frame ${number} at ${x},${y}`);
  }
  assert.ok(info.differentFrames > 1 && info.differentFrames <= 36);
  // On a canvas it does not fill, the margins take the scene's own background colour, so the shot is opaque edge to
  // edge, and the note says how to fill the canvas.
  const letterboxed = createSceneSequence(scene, source.name, { fps: 6, size: '1080p', seconds: 1 });
  assert.deepEqual([letterboxed.info.frames, letterboxed.info.placement.scale, letterboxed.info.loop.seamless, letterboxed.info.alpha, Object.keys(letterboxed.info.commands)], [6, 10, false, 'none: opaque background', ['prores4444', 'h264', 'h264Compatible']]);
  assert.deepEqual(scene.background, [24, 34, 57, 255]);
  const margin = decodePNG(letterboxed.files.get('skink-stride-study_0001.png'));
  assert.deepEqual([pixel(margin, 0, 0), pixel(margin, 1919, 1079)], [[24, 34, 57, 255], [24, 34, 57, 255]]);
  assert.deepEqual(letterboxed.info.notes, ["The scene covers 1920×720 of the 1920×1080 canvas; the margins take the scene's background colour. Use fit cover to fill the canvas and crop the overhang, or author the scene at 192×108 to fill it exactly at this scale."]);
  // A named background replaces that colour, and "transparent" keeps the margins clear. Only the first frame is read,
  // so each of these shots is a single 1080p frame.
  const clear = createSceneSequence(scene, source.name, { fps: 1, size: '1080p', seconds: 1, background: 'transparent' });
  assert.deepEqual([pixel(decodePNG(clear.files.get('skink-stride-study_0001.png')), 0, 0), clear.info.alpha, clear.info.notes[0].startsWith('The scene covers 1920×720 of the 1920×1080 canvas. Use fit cover')], [[0, 0, 0, 0], 'straight (unpremultiplied)', true]);
  assert.deepEqual(pixel(decodePNG(createSceneSequence(scene, source.name, { fps: 1, size: '1080p', seconds: 1, background: '#ff0000' }).files.get('skink-stride-study_0001.png')), 0, 0), [255, 0, 0, 255]);
  // Cover fills 1080p with the 192 × 72 scene at scale 15 and keeps its middle 128 columns.
  const filled = createSceneSequence(scene, source.name, { fps: 6, size: '1080p', seconds: 1, fit: 'cover' });
  assert.deepEqual([filled.info.placement, filled.info.notes], [{ scale: 15, x: -480, y: 0, width: 2880, height: 1080, source: [192, 72], fit: 'cover', cropped: true, visible: [32, 0, 128, 72] }, ['The scene is enlarged 15 times to 2880×1080 and cropped to the 1920×1080 canvas: columns 32 to 159 and rows 0 to 71 of the scene stay in view.']]);
  const shot = decodePNG(filled.files.get('skink-stride-study_0001.png')), whole = renderScene(scene, { time: 0 });
  for (const [x, y] of [[32, 0], [60, 40], [100, 50], [159, 71]]) assert.deepEqual(pixel(shot, (x - 32) * 15 + 7, y * 15 + 7), [...whole.data.subarray((y * 192 + x) * 4, (y * 192 + x) * 4 + 4)], `cover at ${x},${y}`);
  // A still scene is one picture however many frames it lasts.
  const still = prepareScene({ format: 'pixelforge-scene', version: 1, name: 'still', width: 4, height: 4, duration: 1000, assets: { dot: { version: 1, name: 'dot', width: 1, height: 1, frames: [{ name: 'a', ops: [{ op: 'pixel', color: '#fff' }] }] } }, instances: [{ asset: 'dot', at: [1, 1] }] });
  assert.deepEqual([createSceneSequence(still, 'still', { fps: 30 }).info.frames, createSceneSequence(still, 'still', { fps: 30 }).info.differentFrames], [30, 1]);
  for (const [options, where] of [[{ fps: 30, step: 2 }, 'sequence.step'], [{ fps: 30, animation: 'run' }, 'sequence.animation'], [{}, 'sequence.fps']]) assert.throws(() => createSceneSequence(scene, 'x', options), error => error.path === where, where);
});
test('CLI sequence writes a new folder for a recipe, an effects source and a scene, and never half of one', async t => {
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelbolt-sequence-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const run = (file, ...args) => spawnSync(process.execPath, ['bin/pixelbolt.js', 'sequence', file, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const coin = run('examples/coin.json', '--fps', '30', '--size', '480x270', '--align', 'bottom', '--offset', '0,-4', '--out', path.join(dir, 'coin'));
  assert.equal(coin.status, 0, coin.stderr);
  const report = JSON.parse(coin.stdout);
  assert.deepEqual([report.ok, report.name, report.frames, report.width, report.directory, report.files, report.timing], [true, 'coin-spin', 20, 480, path.join(dir, 'coin'), 22, undefined]);
  // The 24-pixel coin fits 270 pixels eleven times (264); bottom-aligned and lifted 4 pixels, it sits 2 from the top.
  assert.deepEqual(report.placement, { scale: 11, x: 108, y: 2, width: 264, height: 264, source: [24, 24] });
  assert.equal((await readdir(path.join(dir, 'coin'))).length, 22);
  assert.equal(JSON.parse(await readFile(path.join(dir, 'coin', 'sequence.json'), 'utf8')).timing.length, 6);
  assert.match(JSON.parse(run('examples/coin.json', '--fps', '30', '--out', path.join(dir, 'coin')).stderr).error, /already exists/);
  // An effects source compiles on the way in; a scene is rendered moment by moment.
  const sparks = JSON.parse(run('examples/effects.fx.json', '--fps', '25', '--animation', 'sparks', '--scale', '4', '--out', path.join(dir, 'sparks')).stdout);
  assert.deepEqual([sparks.name, sparks.loop.plays, sparks.width, sparks.height], ['effects-sparks', 'once', 192, 160]);
  const shot = JSON.parse(run('examples/quality/stride.scene.json', '--fps', '10', '--seconds', '1', '--out', path.join(dir, 'shot')).stdout);
  assert.deepEqual([shot.source, shot.frames, shot.width, shot.height], ['scene', 10, 192, 72]);
  const filled = JSON.parse(run('examples/quality/stride.scene.json', '--fps', '5', '--seconds', '1', '--size', '720p', '--fit', 'cover', '--out', path.join(dir, 'filled')).stdout);
  assert.deepEqual([filled.width, filled.height, filled.placement.scale, filled.placement.visible], [1280, 720, 10, [32, 0, 128, 72]]);
  // Refused requests write nothing.
  for (const [args, message] of [[['--out', path.join(dir, 'a')], /requires --fps/], [['--fps', '30'], /requires --out/], [['--fps', '30', '--size', '8k', '--out', path.join(dir, 'b')], /sequence\.size/], [['--fps', '30', '--fit', 'cover', '--out', path.join(dir, 'd')], /sequence\.fit: cover needs a size to cover/], [['--fps', '30', '--grid', '--out', path.join(dir, 'c')], /--grid is not supported by sequence/]]) assert.match(JSON.parse(run('examples/coin.json', ...args).stderr).error, message);
  assert.deepEqual((await readdir(dir)).sort(), ['coin', 'filled', 'shot', 'sparks']);
});

test('CLI sequence --force over a longer sequence removes the frames it no longer has, and only those', async t => {
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelbolt-sequence-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const run = (...args) => spawnSync(process.execPath, ['bin/pixelbolt.js', 'sequence', 'examples/coin.json', '--fps', '10', '--out', dir, ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(run('--seconds', '2').status, 0);
  await writeFile(path.join(dir, 'other_0001.png'), 'not ours'); await writeFile(path.join(dir, 'notes.txt'), 'mine');
  const shorter = run('--seconds', '1', '--force'), report = JSON.parse(shorter.stdout);
  assert.equal(shorter.status, 0, shorter.stderr);
  assert.equal(report.frames, 10);
  assert.deepEqual(report.removed, Array.from({ length: 10 }, (_, i) => path.join(dir, `coin-spin_${String(i + 11).padStart(4, '0')}.png`)));
  const left = (await readdir(dir)).sort();
  assert.deepEqual(left.filter(name => name.startsWith('coin-spin_')).length, 10);
  assert.ok(left.includes('other_0001.png') && left.includes('notes.txt'));
});
test('a forced sequence after a rename that only changes letter case keeps the new frames and removes the old extra ones', async t => {
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelbolt-sequence-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const coin = JSON.parse(await readFile(path.join(root, 'examples', 'coin.json'), 'utf8'));
  const named = (name, animation, seconds) => createSequence(renderProject({ ...coin, name, animations: { [animation]: coin.animations.spin } }), { fps: 10, seconds });
  await writeBundle(named('Coin', 'Spin', 2), dir);
  // Where letter case is ignored, Coin-Spin_0011.png and later were left behind for a 10-frame sequence.json.
  await writeBundle(named('coin', 'spin', 1), dir, { force: true });
  const frames = (await readdir(dir)).filter(name => name.endsWith('.png')).sort(), wanted = Array.from({ length: 10 }, (_, i) => `coin-spin_${String(i + 1).padStart(4, '0')}.png`);
  assert.deepEqual(frames.filter(name => name.startsWith('coin-spin_')), wanted);
  // Where case matters, Coin-Spin_*.png are another name's frames and stay, like any other renamed sequence's.
  if (await ignoresCase(dir)) assert.deepEqual(frames, wanted);
  assert.equal(JSON.parse(await readFile(path.join(dir, 'sequence.json'), 'utf8')).frames, 10);
});

test('MCP render and scene tools write a sequence on request, beside what they already write', async t => {
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelbolt-sequence-mcp-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  // One server process answers every [tool, args] call in the list, in order.
  const calls = (directory, list) => {
    const messages = [{ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25' } }, ...list.map(([name, args], i) => ({ jsonrpc: '2.0', id: i + 1, method: 'tools/call', params: { name, arguments: args } }))];
    const result = spawnSync(process.execPath, ['bin/pixelbolt.js', 'mcp', '--out', directory], { cwd: root, input: messages.map(message => JSON.stringify(message)).join('\n') + '\n', encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    const replies = result.stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(replies.map(reply => reply.id), messages.map(message => message.id));
    return replies.slice(1).map(reply => reply.result);
  };
  const call = (directory, name, args) => calls(directory, [[name, args]])[0];
  const rendered = call(path.join(dir, 'recipe'), 'pixel_render', { project: recipe, animation: 'once', sequence: { fps: 10, scale: 3 } });
  assert.ok(!rendered.isError, JSON.stringify(rendered));
  const info = JSON.parse(rendered.content[0].text);
  assert.deepEqual([info.sequence.directory, info.sequence.pattern, info.sequence.frames, info.sequence.fps, info.sequence.width, info.sequence.loop.plays], ['sequence', 'probe-once_%04d.png', 2, '10', 6, 'once']);
  assert.match(info.sequence.ffmpeg.prores4444, /probe-once_%04d\.png/);
  assert.equal(decodePNG(await readFile(path.join(info.directory, 'sequence', 'probe-once_0002.png'))).width, 6);
  await access(path.join(info.directory, 'sequence', 'sequence.json')); await access(path.join(info.directory, 'preview.html'));
  const scene = JSON.parse(await readFile(path.join(root, 'examples', 'quality', 'stride.scene.json'), 'utf8'));
  const shot = JSON.parse(call(path.join(dir, 'scene'), 'pixel_scene', { scene, sequence: { fps: 4, seconds: 1 } }).content[0].text);
  assert.deepEqual([shot.sequence.frames, shot.sequence.width, (await readdir(path.join(shot.directory, 'sequence'))).length], [4, 192, 6]);
  const cover = JSON.parse(call(path.join(dir, 'cover'), 'pixel_scene', { scene, sequence: { fps: 4, seconds: 0.5, size: '720p', fit: 'cover' } }).content[0].text);
  assert.deepEqual([cover.sequence.frames, cover.sequence.width, cover.sequence.height, cover.sequence.placement.fit], [2, 1280, 720, 'cover']);
  for (const refused of calls(path.join(dir, 'refused'), [['pixel_render', { project: recipe, sequence: { fps: 0 } }], ['pixel_render', { project: recipe, sequence: { fps: 30, fit: 'cover' } }], ['pixel_render', { project: recipe, sequence: true }], ['pixel_scene', { scene, sequence: { fps: 30, step: 2 } }]])) {
    assert.equal(refused.isError, true, JSON.stringify(refused)); assert.match(JSON.parse(refused.content[0].text).path, /^sequence/);
  }
  assert.deepEqual(await readdir(path.join(dir, 'refused')).catch(() => []), []);
});
test('validate --fps lists durations off the video frame grid and agrees with the sequence it predicts', async t => {
  const project = renderProject(recipe), grid = frameGrid(project, 30);
  // 100 ms is three frames at 30 fps; 50 ms is 1.5. Frames start at 100 and 133.3 ms in the half pose and at 166.7 ms
  // in blue, so half gets two frames and blue one; 200 ms closes.
  assert.deepEqual([grid.fps, grid.frameMs, grid.offGrid], ['30', 33.333, [{ frame: 'half', duration: 50, videoFrames: 1.5 }, { frame: 'blue', duration: 50, videoFrames: 1.5 }]]);
  assert.deepEqual(grid.animations.cycle, { duration: 200, loop: true, videoFrames: 6, closes: true, changed: [{ position: 1, frame: 'half', wanted: 50, got: 66.667, videoFrames: 2 }, { position: 2, frame: 'blue', wanted: 50, got: 33.333, videoFrames: 1 }] });
  assert.deepEqual(grid.notes, ['2 of 3 frame durations are not whole video frames of 33.333 ms; at integer milliseconds, whole frames at 30 fps are multiples of 100 ms.', 'cycle: 2 positions change length.', 'once: 1 position changes length.']);
  // At 8 fps frames start at 0 and 125 ms: no frame starts during blue (150–200 ms), so it is never shown, and one
  // pass of 200 ms is 1.6 frames; 5 loops close.
  const slow = frameGrid(project, 8);
  assert.deepEqual([slow.animations.cycle.neverShown, slow.animations.cycle.closes, slow.animations.cycle.loopsThatFit], [[{ position: 2, frame: 'blue', duration: 50 }], false, 5]);
  // Every count matches what the sequence command writes.
  for (const rate of [8, 24, 25, 30, '29.97', 60]) for (const animation of ['cycle', 'once']) {
    const written = createSequence(project, { fps: rate, animation }).info, predicted = frameGrid(project, rate).animations[animation];
    assert.deepEqual(written.timing.flatMap((entry, position) => entry.frames && entry.got !== entry.wanted ? [[position, entry.got]] : []), (predicted.changed ?? []).map(entry => [entry.position, entry.got]), `${rate} ${animation}`);
    assert.deepEqual(written.timing.flatMap((entry, position) => entry.frames ? [] : [position]), (predicted.neverShown ?? []).map(entry => entry.position));
    assert.equal(written.loop.passFrames, predicted.videoFrames);
  }
  assert.throws(() => frameGrid(project, 'fast'), error => error instanceof PixelError && error.path === 'validate.fps');
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelbolt-validate-fps-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const cli = spawnSync(process.execPath, ['bin/pixelbolt.js', 'validate', 'examples/caption.json', '--fps', '60'], { cwd: root, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(cli.stdout).frameGrid.notes, []);
  assert.equal(JSON.parse(spawnSync(process.execPath, ['bin/pixelbolt.js', 'validate', 'examples/caption.json'], { cwd: root, encoding: 'utf8' }).stdout).frameGrid, undefined);
  const messages = [{ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25' } }, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'pixel_validate', arguments: { project: recipe, fps: '29.97' } } }];
  const mcp = spawnSync(process.execPath, ['bin/pixelbolt.js', 'mcp', '--out', dir], { cwd: root, input: messages.map(message => JSON.stringify(message)).join('\n') + '\n', encoding: 'utf8' });
  const validated = JSON.parse(JSON.parse(mcp.stdout.trim().split('\n')[1]).result.content[0].text);
  assert.deepEqual([validated.frameGrid.fps, validated.frameGrid.numerator, validated.frameGrid.offGrid.length], ['29.97', 30000, 3]);
});
