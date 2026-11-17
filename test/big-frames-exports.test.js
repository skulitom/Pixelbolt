// Screen-sized animation frames (up to 1024 a side and 262,144 pixels) through every export: the sheet, atlas, frame
// PNGs, animated PNG, GIF, Godot SpriteFrames and video frames, the contact sheets that review them, and the PNGs read
// back. scripts/verify-godot.mjs and scripts/verify-tiled.mjs load such frames in a real Godot and Tiled.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, inspectProject } from '../src/core.js';
import { createBundle } from '../src/export.js';
import { animationGIF } from '../src/gif.js';
import { decodePNG } from '../src/import.js';
import { encodePNG } from '../src/png.js';
import { folderGIF } from '../src/frame-folder.js';
import { createSequence } from '../src/sequence.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A sweep across a screen: a dark ground, a red square moving right and a pale line turning, one step a frame.
const screen = (width, height, count, extra = {}) => ({
  version: 1, name: 'screen', width, height, palette: { k: '#102030', s: '#a0c0f0', r: '#e04030' },
  frames: Array.from({ length: count }, (_, i) => ({ name: `f${i}`, duration: 80, ops: [{ op: 'rect', x: 0, y: 0, w: width, h: height, color: 'k' }, { op: 'rect', x: i * 36, y: 100, w: 32, h: 32, color: 'r' }, { op: 'line', x: i * 8, y: 0, x2: width - 1 - i * 8, y2: height - 1, color: 's' }] })),
  animations: { run: { frames: Array.from({ length: count }, (_, i) => `f${i}`) } }, ...extra
});
const at = (data, width, x, y) => [...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
const RED = [224, 64, 48, 255];
// The number of frames an animated PNG declares (its acTL chunk).
const apngFrames = bytes => { const i = bytes.indexOf('acTL'); return i < 0 ? 0 : bytes.readUInt32BE(i + 4); };

test('a 640x360 animation of 16 frames exports its sheet, atlas, frames, animated PNG, GIF and Godot SpriteFrames', async () => {
  const recipe = screen(640, 360, 16), bundle = await createBundle(recipe);
  // Six 640-wide columns keep the sheet within 4096.
  const sheet = decodePNG(bundle.files.get('screen.png'));
  assert.deepEqual([sheet.width, sheet.height], [3840, 1080]);
  assert.deepEqual(at(sheet.data, sheet.width, 640 + 7 * 36 + 1, 360 + 101), RED, 'f7 sits in the second row, second column');
  const atlas = JSON.parse(bundle.files.get('screen.atlas.json'));
  assert.deepEqual([atlas.meta.size, atlas.frames.f7.frame, atlas.animations.run.frames.length], [{ w: 3840, h: 1080 }, { x: 640, y: 360, w: 640, h: 360 }, 16]);
  const frame = decodePNG(bundle.files.get('frames/f15.png'));
  assert.deepEqual([frame.width, frame.height, at(frame.data, 640, 15 * 36 + 1, 101)], [640, 360, RED]);
  const apng = bundle.files.get('animations/run.png');
  assert.deepEqual([apng.readUInt32BE(16), apng.readUInt32BE(20), apngFrames(apng)], [640, 360, 16]);
  assert.match(bundle.files.get('screen.tres').toString(), /\[sub_resource type="AtlasTexture" id="AtlasTexture_f7"\]\natlas = ExtResource\("1_sheet"\)\nregion = Rect2\(640, 360, 640, 360\)/);
  // The preview fits the page: a frame wider than a phone shrinks to it.
  assert.match(bundle.files.get('preview.html').toString(), /img\{width:640px;max-width:100%;image-rendering:pixelated\}/);
  const gif = animationGIF(renderProject(recipe), 'run'), data = Buffer.from(gif.data);
  assert.deepEqual([gif.width, gif.height, gif.frames, data.subarray(0, 6).toString('latin1'), data.readUInt16LE(6), data.readUInt16LE(8)], [640, 360, 16, 'GIF89a', 640, 360]);
});

test('a frame PNG past 4096 a side reads back: a GIF of an export\'s frames/ folder, and decodePNG up to 16384', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-big-frames-')); t.after(() => rm(dir, { recursive: true, force: true }));
  // 1024x64 at scale 5: each frame PNG is 5120 wide.
  const bundle = await createBundle(screen(1024, 64, 3, { sheet: { scale: 5 } }));
  await mkdir(path.join(dir, 'frames'));
  for (const [file, bytes] of bundle.files) if (file.startsWith('frames/')) await writeFile(path.join(dir, file.replace(/f(\d)/, 'frame_000$1')), bytes);
  const gif = folderGIF(path.join(dir, 'frames'), { fps: 12 });
  assert.deepEqual([gif.width, gif.height, gif.frames], [5120, 320, 3]);
  assert.deepEqual([decodePNG(encodePNG(new Uint8ClampedArray(16384 * 4), 16384, 1)).width, decodePNG(encodePNG(new Uint8ClampedArray(16 * 4), 1, 16)).height], [16384, 16]);
  assert.throws(() => decodePNG(encodePNG(new Uint8ClampedArray(16385 * 4), 16385, 1)), { message: 'import: PNG dimensions exceed 16384 per side or 16,777,216 pixels' });
});

test('contact sheets of big frames fit 4096 a side: fewer columns, then evenly spaced cells, and a scale asked for is still refused', () => {
  // 16 frames of 512x512 in a play order of 100: eight cells of 512 fill 4096 a side, and seven a side the other way
  // keep the sheet one PNG (16,777,216 pixels), so it shows 56 cells.
  const played = renderProject(screen(512, 512, 16, { animations: { hold: { frames: Array.from({ length: 100 }, (_, i) => `f${i % 16}`) } } }));
  const view = inspectProject(played, { animation: 'hold' });
  assert.deepEqual([view.sheet.width, view.sheet.height, view.sheet.columns, view.sheet.scale, view.cells.length], [3600, 4114, 7, 1, 56]);
  assert.deepEqual([view.sampling.total, view.sampling.shown, view.sampling.positions.at(-1)], [100, 56, 99]);
  assert.match(view.sampling.method, /^evenly spaced to fit the 4096-pixel sheet, including endpoints; /);
  // Every frame once fits whole, sampled nowhere.
  const all = inspectProject(played);
  assert.deepEqual([all.cells.length, all.sampling], [16, undefined]);
  // maxCells first, then the fit.
  assert.equal(inspectProject(played, { animation: 'hold', maxCells: 10 }).cells.length, 10);
  // Tile view repeats each 1024x256 frame 3x3 (3072x768): five fit one above another.
  const wide = renderProject(screen(1024, 256, 8));
  const tiles = inspectProject(wide, { view: 'tile' });
  assert.deepEqual([tiles.sheet.columns, tiles.sheet.rows, tiles.cells.length, tiles.sampling.total], [1, 5, 5, 8]);
  assert.throws(() => inspectProject(played, { animation: 'hold', scale: 2 }), /above the 4096-pixel limit/);
});

test('render --look and gif --sheet draw a long play order of 512x512 frames as a sheet that fits', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-big-look-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const cli = (...args) => spawnSync(process.execPath, [path.join(root, 'bin', 'pixelbolt.js'), ...args], { cwd: dir, encoding: 'utf8' });
  await writeFile(path.join(dir, 'screen.json'), JSON.stringify(screen(512, 512, 16, { animations: { hold: { frames: Array.from({ length: 80 }, (_, i) => `f${i % 16}`) } } })));
  const made = cli('render', 'screen.json', '--out', 'made', '--look', '--animation', 'hold');
  assert.equal(made.status, 0, made.stderr);
  assert.match(JSON.parse(made.stdout).lookShows, /^56 of the 80 frames, evenly spaced to fit the 4096-pixel sheet/);
  const look = decodePNG(await import('node:fs/promises').then(fs => fs.readFile(path.join(dir, 'made', 'look.png'))));
  assert.deepEqual([look.width, look.height], [3600, 4114]);
  const gif = cli('gif', 'screen.json', '--out', 'hold.gif', '--animation', 'hold', '--sheet', 'sheet.png');
  assert.equal(gif.status, 0, gif.stderr);
  assert.match(JSON.parse(gif.stdout).sheetShows, /^56 of the 80 frames, evenly spaced to fit the 4096-pixel sheet/);
});

test('a 640x360 animation fills a 1080p video frame at scale 3', () => {
  const { info } = createSequence(renderProject(screen(640, 360, 4)), { fps: 25, size: '1080p' });
  assert.deepEqual([info.width, info.height, info.placement.scale, info.placement.width, info.placement.height], [1920, 1080, 3, 1920, 1080]);
});
