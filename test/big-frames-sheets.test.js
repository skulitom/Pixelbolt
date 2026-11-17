// Contact sheets and motion review of screen-sized frames (up to 1024 a side and 262,144 pixels): what they show when
// one PNG of 16,777,216 pixels cannot hold every cell, and how each route (inspect, render --look, gif --sheet, MCP
// pixel_inspect and pixel_render, --beside, the parts view, every, motion) says so instead of failing in the encoder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PixelError, renderProject, inspectProject, stackViews, briefCells, briefDiagnostics } from '../src/core.js';
import { COMPILERS } from '../src/presets.js';
import { inspectMotion } from '../src/motion.js';
import { encodePNG } from '../src/png.js';
import { decodePNG } from '../src/import.js';
import { createToolRunner } from '../src/mcp.js';
import { compileEffects } from '../src/fx.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PNG_PIXELS = 16777216;
// A dark ground and a red square moving right, in two layers; `plays` repeats the frames in the animation.
// `parts` above 1 draws that many squares, each its own layer named after `part`.
const screen = (width, height, count, { plays = 1, part = 'square', parts = 1 } = {}) => ({
  version: 1, name: 'screen', width, height, palette: { k: '#102030', r: '#e04030' },
  frames: Array.from({ length: count }, (_, i) => ({ name: `f${i}`, duration: 80, layers: [
    { name: 'ground', ops: [{ op: 'rect', x: 0, y: 0, w: width, h: height, color: 'k' }] },
    ...Array.from({ length: parts }, (_, p) => ({ name: parts > 1 ? `${part}-${String(p).padStart(2, '0')}` : part, ops: [{ op: 'rect', x: (i * 8 + p) % width, y: 4 + p, w: 8, h: 8, color: 'r' }] }))] })),
  animations: { run: { frames: Array.from({ length: count * plays }, (_, i) => `f${i % count}`) } }
});
const encodes = sheet => { assert.ok(sheet.width * sheet.height <= PNG_PIXELS); return decodePNG(encodePNG(sheet.data, sheet.width, sheet.height)); };
const folder = async (t, name) => { const dir = await mkdtemp(path.join(os.tmpdir(), `pixelbolt-${name}-`)); t.after(() => rm(dir, { recursive: true, force: true })); return dir; };
const cliIn = dir => (...args) => spawnSync(process.execPath, [path.join(root, 'bin', 'pixelbolt.js'), ...args], { cwd: dir, encoding: 'utf8' });
const runner = async t => {
  const dir = await folder(t, 'sheets-mcp'), run = createToolRunner({ directory: dir, root: dir, version: '0.0.0' });
  return async (name, args) => {
    const result = await run(name, args);
    assert.ok(!result.isError, result.content?.[0]?.text);
    return { info: JSON.parse(result.content[0].text), images: result.content.filter(c => c.type === 'image') };
  };
};

test('maxCells counts the cells a sheet holds across and down apart, so a 1024x256 preview shows all 16 frames', async t => {
  const project = renderProject(screen(1024, 256, 16)), view = inspectProject(project, { maxCells: 256 });
  // floor(4094 / 1026) * floor(4094 / 258) = 3 * 15 = 45, not floor(4094 / 1026) squared = 9.
  assert.deepEqual([view.cells.length, view.sampling], [16, undefined]);
  // A square frame keeps the old count: 512x512 holds 7 * 7.
  assert.equal(inspectProject(renderProject(screen(512, 512, 16, { plays: 4 })), { animation: 'run', maxCells: 256, scale: 1 }).cells.length, 49);
  const call = await runner(t), { info } = await call('pixel_render', { project: screen(1024, 256, 16) });
  assert.deepEqual([info.preview.cells, info.preview.sampling], [['f0 … f15: 80 ms each'], undefined]);
});

test('every refuses to drop cells that do not fit, naming the every that does', () => {
  const project = renderProject(screen(512, 512, 16, { plays: 4 }));
  assert.throws(() => inspectProject(project, { animation: 'run', every: 80 }), error => error instanceof PixelError && error.path === 'inspect.every'
    && error.message === 'inspect.every: 5120 ms at one cell per 80 ms is 64 cells, and one 4096-pixel sheet of 512×512 cells holds 56; choose every 92 or more');
  const fits = inspectProject(project, { animation: 'run', every: 92 });
  assert.deepEqual([fits.cells.length, fits.sampling.every, fits.sampling.method], [56, 92, 'one cell per 92 ms of playback; a frame fills a cell for each 92 ms it is held']);
  encodes(fits.sheet);
  // Never thinned instead: the sampling of a sheet by time always reads as playback.
  assert.throws(() => inspectProject(project, { animation: 'run', every: 40 }), { path: 'inspect.every',
    message: 'inspect.every: 5120 ms at one cell per 40 ms is 128 cells, and one 4096-pixel sheet of 512×512 cells holds 56; choose every 92 or more' });
  // A sheet of big frames holding fewer than maxCells is refused the same way.
  assert.throws(() => inspectProject(project, { animation: 'run', every: 80, maxCells: 100, scale: 1 }),
    { path: 'inspect.every', message: 'inspect.every: 5120 ms at one cell per 80 ms is 64 cells, and one 4096-pixel sheet of 512×512 cells holds 49; choose every 105 or more' });
});

test('a maxCells below the cells every makes thins them evenly, as before big frames, at any scale', () => {
  // Main showed 10 evenly spaced cells of the 64 here; the branch had refused them.
  const project = renderProject(screen(32, 32, 16, { plays: 4 }));
  for (const scale of [undefined, 2]) {
    const view = inspectProject(project, { animation: 'run', every: 80, maxCells: 10, ...(scale && { scale }) });
    assert.deepEqual([view.cells.length, view.sampling.positions, view.sampling.method],
      [10, [0, 7, 14, 21, 28, 35, 42, 49, 56, 63], 'one cell per 80 ms of playback, then evenly spaced, including endpoints; a frame fills a cell for each 80 ms it is held']);
  }
  // Big frames too, when it is maxCells and not the sheet that drops cells.
  assert.equal(inspectProject(renderProject(screen(512, 512, 16, { plays: 4 })), { animation: 'run', every: 80, maxCells: 12 }).cells.length, 12);
});

test('the parts legend has room kept for it when big frames are fitted, and the sheet with it encodes', () => {
  // A long part name: without its room, 60 cells of 1024x256 fill the PNG and the legend takes the sheet past it.
  const part = 'a-very-long-part-name-that-widens-the-legend-of-the-parts-view';
  const project = renderProject(screen(1024, 256, 16, { plays: 4, part }), { owners: true });
  const view = inspectProject(project, { animation: 'run', view: 'parts' });
  assert.ok(view.sampling.shown < 60 && view.sampling.shown > 40, `${view.sampling.shown} cells`);
  const sheet = encodes(view.sheet);
  assert.ok(sheet.width > view.sheet.columns * 1024 + 300, 'the legend sits right of the cells');
  // Without the legend the same play order fits more cells.
  assert.ok(inspectProject(project, { animation: 'run' }).sampling.shown > view.sampling.shown);
});

test('beside refits the sheets to the one image, and a stack that would still pass it is a PixelError', async t => {
  const big = renderProject(screen(512, 512, 16, { plays: 4 }));
  // Inspected each on its own, two 3600x4114 sheets stack past the PNG.
  const alone = [1, 2].map(n => ({ ...inspectProject(big, { animation: 'run' }), name: `v${n}` }));
  assert.throws(() => stackViews(alone), error => error instanceof PixelError && error.path === 'beside' && /the 2 sheets stacked would be 3600×\d+ pixels, past the 16,777,216 one PNG holds; compare fewer recipes/.test(error.message));
  const shared = stackViews([1, 2, 3].map(n => ({ ...inspectProject(big, { animation: 'run' }, { sheets: 3 }), name: `v${n}` })));
  encodes(shared.sheet);
  assert.equal(shared.stack.length, 3);
  // The CLI and MCP pass the share themselves.
  const dir = await folder(t, 'sheets-beside'), cli = cliIn(dir);
  await writeFile(path.join(dir, 'a.json'), JSON.stringify(screen(512, 512, 16, { plays: 4 })));
  await writeFile(path.join(dir, 'b.json'), JSON.stringify(screen(512, 512, 16, { plays: 4 })));
  const made = cli('inspect', 'a.json', '--animation', 'run', '--beside', 'b.json,a.json', '--out', 'beside.png');
  assert.equal(made.status, 0, made.stderr);
  const reply = JSON.parse(made.stdout);
  assert.deepEqual(reply.stack.map(s => s.name), ['a.json', 'b.json', 'a.json']);
  encodes(decodePNG(await readFile(path.join(dir, 'beside.png'))));
  const call = await runner(t), { info: first } = await call('pixel_inspect', { project: screen(512, 512, 16, { plays: 4 }) });
  const { info, images } = await call('pixel_inspect', { revision: first.revision, animation: 'run', beside: [first.revision, first.revision] });
  assert.deepEqual([info.stack.length, images.length], [3, 1]);
  assert.ok(info.sheet.width * info.sheet.height <= PNG_PIXELS);
});

test('a 512x512 animation of 16 frames played 4 times is sampled to fit on every route, never a plain encoder error', async t => {
  const dir = await folder(t, 'sheets-routes'), cli = cliIn(dir), recipe = screen(512, 512, 16, { plays: 4 });
  await writeFile(path.join(dir, 'long.json'), JSON.stringify(recipe));
  const said = /^56 of the 64 frames, evenly spaced to fit the 4096-pixel sheet, including endpoints; /;
  const inspected = cli('inspect', 'long.json', '--animation', 'run', '--out', 'long.png');
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.deepEqual([JSON.parse(inspected.stdout).sampling.shown, JSON.parse(inspected.stdout).sampling.total], [56, 64]);
  encodes(decodePNG(await readFile(path.join(dir, 'long.png'))));
  const look = cli('render', 'long.json', '--out', 'made', '--look', '--animation', 'run');
  assert.equal(look.status, 0, look.stderr);
  assert.match(JSON.parse(look.stdout).lookShows, said);
  const gif = cli('gif', 'long.json', '--out', 'long.gif', '--sheet', 'sheet.png');
  assert.equal(gif.status, 0, gif.stderr);
  assert.match(JSON.parse(gif.stdout).sheetShows, said);
  encodes(decodePNG(await readFile(path.join(dir, 'sheet.png'))));
  const call = await runner(t), { info } = await call('pixel_inspect', { project: recipe, animation: 'run' });
  assert.deepEqual([info.sampling.shown, info.sampling.total], [56, 64]);
});

test('motion review fits its timing cells to frames over 256 tall and says what it sampled', async t => {
  const project = renderProject(screen(512, 512, 16));
  // Four columns of 16 512x512 cells pass 4,194,304 pixels; fifteen fit in three columns.
  const review = inspectMotion(project, { animation: 'run', ground: 511 });
  assert.deepEqual(review.sampling, { total: 16, shown: 15, omitted: 1, method: 'evenly spaced, including endpoints: as many 512×512 frames as fit the 4,194,304-pixel image, 4096 a side' });
  assert.deepEqual([review.cells.length, review.cells[0].position, review.cells.at(-1).position], [15, 0, 15]);
  assert.ok(review.nativeSheet.width * review.nativeSheet.height <= 4194304);
  // The ground line is drawn under the first cell's last row, 511.
  const { data, width } = review.nativeSheet, [x, y] = review.cells[0].timing, at = ((y + 512) * width + x + 100) * 4;
  assert.deepEqual([...data.subarray(at, at + 4)], [80, 100, 115, 255]);
  // Small frames keep 4 columns of at most 32 samples, and say nothing of sampling when every frame is shown.
  const small = inspectMotion(renderProject(screen(64, 64, 8)), { animation: 'run' });
  assert.deepEqual([small.sampling, small.cells[4].timing[1] > small.cells[3].timing[1]], [undefined, true]);
  // Over MCP, with a ground row past 255.
  const call = await runner(t), { info } = await call('pixel_inspect', { project: screen(512, 512, 16), animation: 'run', view: 'motion', ground: 500 });
  assert.deepEqual([info.sampling.shown, info.motion.ground], [15, 500]);
});

test('the parts legend reserves the columns it is drawn in beside the fitted sheet, not one column per twelve names', () => {
  // 30 parts named 40 characters each: the legend beside a sheet thousands of pixels tall is one column.
  for (const [w, h, count, cells] of [[640, 360, 18, 66], [512, 512, 16, 56]]) {
    const project = renderProject(screen(w, h, count, { plays: 4, part: 'p'.repeat(37), parts: 30 }), { owners: true });
    const view = inspectProject(project, { animation: 'run', view: 'parts' });
    assert.equal(view.cells.length, cells, `${w}x${h}`);
    encodes(view.sheet);
  }
});

test('views stacked beside one another stay within 8,000 pixels tall, the tallest refitted', async t => {
  // n copies of one recipe's view, inspected once.
  const views = (recipe, n, options = {}) => { const view = inspectProject(renderProject(recipe), { ...options }, { sheets: n }); return Array.from({ length: n }, (_, i) => ({ ...view, name: `v${i}` })); };
  for (const [w, h, count, n] of [[512, 512, 16, 9], [640, 360, 18, 4]]) {
    const stacked = stackViews(views(screen(w, h, count, { plays: 4 }), n, { animation: 'run' }));
    // 4096 pixels of cells and 2-pixel gutters a side.
    assert.ok(stacked.sheet.height <= 8000 && stacked.sheet.width <= 4096 + 2 * (stacked.sheet.columns + 1), `${n} views of ${w}x${h}: ${stacked.sheet.width}x${stacked.sheet.height}`);
    assert.ok(stacked.cells.length >= 6, `${n} views of ${w}x${h}: ${stacked.cells.length} cells`);
    encodes(stacked.sheet);
  }
  // Small frames take a smaller scale rather than nine sheets of 1024 pixels.
  const small = renderProject(screen(64, 64, 16)), nine = scale => Array.from({ length: 9 }, (_, i) => ({ ...inspectProject(small, { scale }, { sheets: 9 }), name: `v${i}` }));
  assert.ok(stackViews(nine()).sheet.height <= 8000);
  // A scale asked for is drawn as asked, as before beside had shares: only the one PNG bounds the stack.
  const asked = stackViews(nine(4));
  assert.deepEqual([asked.sheet.height, asked.sheet.scale], [9612, 4]);
  encodes(asked.sheet);
  // A frame whose one row is too tall for the height left to it is refused with how many recipes fit, naming the
  // sheet. In a stack within 8,000 pixels the same sheet is drawn as alone.
  assert.equal(stackViews(views(screen(256, 1024, 4), 7)).sheet.height, 7 * (1028 + 12));
  assert.throws(() => stackViews(views(screen(256, 1024, 4), 9)), { path: 'beside',
    message: 'beside: v0: one row of 256×1024 cells is 1052 pixels tall with its gutters and label, past the 900 left to it in an image of 9 sheets stacked (8,000 pixels tall at most); compare at most 6 other recipes, or show a smaller region' });
  // So is a tile of one (this was a sheet "above the 4096-pixel limit", which neither side is), and a wide tile
  // whose stack the one PNG holds less than 8,000 pixels tall.
  assert.throws(() => stackViews(views(screen(256, 1024, 4), 8, { view: 'tile' })), { path: 'beside',
    message: 'beside: v0: one row of 768×3072 cells is 3100 pixels tall with its gutters and label, past the 1012 left to it in an image of 8 sheets stacked (8,000 pixels tall at most); compare at most 1 other recipe, or show a smaller region' });
  assert.throws(() => stackViews(views(screen(1024, 256, 4), 9, { view: 'tile' })), { path: 'beside',
    message: 'beside: v0: one row of 3072×768 cells is 796 pixels tall with its gutters and label, past the 618 left to it in an image of 9 sheets stacked (5,454 pixels tall at most at 3076 wide, 16,777,216 in all); compare at most 5 other recipes, or show a smaller region' });
  const six = stackViews(views(screen(1024, 256, 4), 6, { view: 'tile' }));
  assert.deepEqual([six.cells.length, six.sheet.width * six.sheet.height <= PNG_PIXELS], [1, true]);
  // The CLI passes the count, and replies with the cells and diagnostics of the first sheet as stacked.
  const dir = await folder(t, 'sheets-stack'), cli = cliIn(dir), recipe = screen(512, 512, 16, { plays: 4 });
  await writeFile(path.join(dir, 'a.json'), JSON.stringify(recipe));
  const made = cli('inspect', 'a.json', '--animation', 'run', '--diagnostics', '--beside', 'a.json,a.json,a.json', '--out', 'four.png');
  assert.equal(made.status, 0, made.stderr);
  const image = decodePNG(await readFile(path.join(dir, 'four.png'))), reply = JSON.parse(made.stdout);
  assert.ok(image.height <= 8000 && image.width * image.height <= PNG_PIXELS, `${image.width}x${image.height}`);
  const inProcess = stackViews(views(recipe, 4, { animation: 'run', diagnostics: true }));
  assert.deepEqual([reply.cells, reply.sampling.shown], [briefCells(inProcess.cells), inProcess.cells.length]);
  assert.ok(inProcess.cells.length < inspectProject(renderProject(recipe), { animation: 'run' }).cells.length);
  assert.deepEqual(reply.diagnostics, JSON.parse(JSON.stringify(briefDiagnostics(inProcess.diagnostics))));
});

test('a beside stack is measured whole: within 8,000 pixels it is drawn as each sheet alone, past it only the tallest shrink', () => {
  // The sheets of each recipe inspected alone, stacked: what beside drew before it measured the stack.
  const alone = recipes => stackViews(recipes.map((recipe, i) => ({ ...inspectProject(renderProject(recipe)), name: `v${i}` })));
  const stacked = recipes => stackViews(recipes.map((recipe, i) => ({ ...inspectProject(renderProject(recipe), {}, { sheets: recipes.length }), name: `v${i}` })));
  // The pixels of one stacked sheet, `width` wide from the left: the whole image by default.
  const bytes = (s, entry = { y: 0, height: s.sheet.height }, width = s.sheet.width) => Buffer.concat(Array.from({ length: entry.height }, (_, row) =>
    Buffer.from(s.sheet.data.subarray((entry.y + row) * s.sheet.width * 4, ((entry.y + row) * s.sheet.width + width) * 4))));
  // The shipped presets a reviewer stacked: 6506 pixels tall, with hermit-chest 4x6 at scale 5 (825x995).
  const shipped = ['hero.poses', 'fox.poses', 'knight.poses', 'slime-idle.poses', 'hermit-chest.poses', 'hero-sword.poses', 'coin-sparkle.fx', 'drip.fluid'].map(name => {
    const source = JSON.parse(readFileSync(path.join(root, 'examples', `${name}.json`), 'utf8'));
    return COMPILERS[source.format](source).recipe;
  });
  const before = alone(shipped), now = stacked(shipped);
  assert.deepEqual([now.sheet.width, now.sheet.height, now.stack[4].height], [before.sheet.width, 6506, 995]);
  assert.ok(bytes(now).equals(bytes(before)));
  // Nine of hermit-chest pass 8,000 (9171 tall): each takes a lower scale.
  const chests = stacked(Array(9).fill(shipped[4]));
  assert.equal(alone(Array(9).fill(shipped[4])).sheet.height, 9171);
  assert.ok(chests.sheet.height <= 8000 && chests.stack.every(entry => entry.height < 995), `${chests.sheet.height}`);
  // Four big sheets beside three small ones pass 8,000 (9072 tall): the four are refitted, while the small three
  // keep their sheets byte for byte.
  const big = screen(256, 256, 48), mix = [big, big, screen(32, 32, 8), screen(64, 48, 6), big, big, screen(16, 16, 4)];
  const was = alone(mix), mixed = stacked(mix);
  assert.equal(was.sheet.height, 9072);
  assert.ok(mixed.sheet.height <= 8000, `${mixed.sheet.height}`);
  mixed.stack.forEach((entry, i) => assert.equal(entry.height, mix[i] === big ? 1292 : was.stack[i].height, `sheet ${i}`));
  for (const i of [2, 3, 6]) {
    const { width } = inspectProject(renderProject(mix[i])).sheet;
    assert.ok(bytes(mixed, mixed.stack[i], width).equals(bytes(was, was.stack[i], width)), `sheet ${i} is drawn as alone`);
  }
});

test('motion review keeps both sides of its strip within 4096, in the squarest grid, and says why a trajectory is left out', () => {
  for (const [w, h, count, shown] of [[480, 490, 17, 16], [490, 480, 17, 16], [640, 360, 18, 16], [360, 640, 18, 16]]) {
    const review = inspectMotion(renderProject(screen(w, h, count)), { animation: 'run', ground: h - 1, speed: 20 });
    const { width, height } = review.nativeSheet;
    assert.ok(width <= 4096 && height <= 4096 && width * height <= 4194304, `${w}x${h}x${count}: ${width}x${height}`);
    // Four columns: 16 cells in a square grid rather than one row or column of 17.
    assert.deepEqual([review.cells.length, review.cells[4].timing[1] > review.cells[3].timing[1]], [shown, true], `${w}x${h}x${count}`);
    // A few pixels of travel: what does not fit is the panel of lanes beside the cells, and the reason says so.
    assert.deepEqual(review.trajectory, { shown: false, reason: `The trajectory panel (${Math.round(20 * (count - 1) * 80 / 1000) + w + 8} pixels wide, lanes of ${w}×${h} frames) does not fit beside the timing cells within the 4,194,304-pixel image.` });
  }
  // Tall frames take fewer lanes when that fits: 400x400 in five.
  const lanes = inspectMotion(renderProject(screen(400, 400, 12)), { animation: 'run', speed: 20 });
  assert.deepEqual([lanes.trajectory.shown, lanes.trajectory.lanes], [true, 5]);
  assert.ok(lanes.nativeSheet.width * lanes.nativeSheet.height <= 4194304);
  // Small frames keep eight.
  assert.equal(inspectMotion(renderProject(screen(256, 256, 16)), { animation: 'run', speed: 20 }).trajectory.lanes, 8);
  // Travel wider than the image is said as travel.
  assert.equal(inspectMotion(renderProject(screen(64, 64, 32)), { animation: 'run', speed: 4000 }).trajectory.reason, 'Travel exceeds the 4096-pixel width: 9920 pixels of travel beside a 64-pixel frame.');
});

test('a sheet already at scale 1 is its own native sheet: said once, not drawn, written or sent twice', async t => {
  const recipe = screen(320, 180, 4), view = inspectProject(renderProject(recipe), { native: true });
  assert.deepEqual([view.sheet.scale, view.nativeSheet, view.native], [1, undefined, 'same as sheet']);
  // An enlarged sheet keeps its native one, and so does a sheet with guides drawn over it.
  const small = inspectProject(renderProject(screen(32, 32, 4)), { native: true });
  assert.deepEqual([small.sheet.scale, small.nativeSheet.scale, small.native], [8, 1, undefined]);
  assert.ok(inspectProject(renderProject(recipe), { native: true, guides: { horizon: 90 } }).nativeSheet);
  const dir = await folder(t, 'sheets-native'), cli = cliIn(dir);
  await writeFile(path.join(dir, 'wide.json'), JSON.stringify(recipe));
  const made = cli('inspect', 'wide.json', '--native', '--out', 'wide.png');
  assert.equal(made.status, 0, made.stderr);
  const reply = JSON.parse(made.stdout);
  assert.deepEqual([reply.native, reply.nativeSheet, reply.nativeImage], ['same as sheet', undefined, undefined]);
  await assert.rejects(readFile(path.join(dir, 'wide.native.png')), { code: 'ENOENT' });
  const call = await runner(t), { info, images } = await call('pixel_inspect', { project: recipe, native: true });
  assert.deepEqual([info.native, info.nativeSheet, images.length], ['same as sheet', undefined, 1]);
});

test('diagnostics of a long full-screen effect list findings only for the frames kept and add up the rest', async t => {
  // 48 frames of 320x180 rain: every frame has stray splash pixels. The reply was 19.9 KB of coordinates.
  const rain = compileEffects({ format: 'pixelforge-fx', version: 1, name: 'rain', width: 320, height: 180,
    palette: { W: '#dceeff', b: '#9cc4e8', d: '#5f86b0' },
    symbols: { drop: ['W'], splash1: ['.W.', 'W.W'], splash2: ['b...b'], mist: ['d'] },
    effects: { rain: { frames: 48, duration: 60, seed: 3, loop: true, edges: ['left', 'right', 'top'], emitters: [
      { name: 'drops', at: [170, -8], area: [400, 1], rate: 6, angle: [100, 104], speed: [9, 11], life: [20, 22], floor: 176, shapes: ['drop'], trail: { color: 'b', length: 2 } },
      { from: 'drops', when: 'floor', burst: 3, angle: [200, 340], speed: [0.6, 1.4], gravity: [0, 0.25], life: [3, 4], shapes: [['splash1', 'splash2', 'mist']] }] } } }).recipe;
  const dir = await folder(t, 'sheets-diagnostics'), cli = cliIn(dir);
  await writeFile(path.join(dir, 'rain.json'), JSON.stringify(rain));
  const made = cli('inspect', 'rain.json', '--diagnostics', '--native', '--out', 'rain.png');
  assert.equal(made.status, 0, made.stderr);
  assert.ok(made.stdout.length < 4096, `${made.stdout.length} bytes`);
  const { diagnostics } = JSON.parse(made.stdout), kept = diagnostics.frames.map(row => row.frame);
  assert.deepEqual([diagnostics.frameTotals.frames, kept.length, diagnostics.omitted], [48, 3, 45]);
  assert.ok(diagnostics.findings.every(finding => kept.includes(finding.frame)));
  const full = JSON.parse(cli('inspect', 'rain.json', '--diagnostics', '--full').stdout).diagnostics;
  const others = full.findings.filter(finding => finding.code === 'isolated' && !kept.includes(finding.frame));
  assert.equal(diagnostics.findingTotals.isolated, `${others.reduce((sum, finding) => sum + finding.count, 0)} pixels in ${others.length} frames`);
  assert.equal(full.findingTotals, undefined);
  const call = await runner(t), { info } = await call('pixel_inspect', { project: rain, diagnostics: true });
  assert.deepEqual(info.diagnostics.findingTotals, diagnostics.findingTotals);
});

test('diagnostics past eight frames still name the empty frames, and add off-palette colours up by colour', async t => {
  // A 12-frame walk: a stray pixel in every drawn frame, walk-7 empty, #123456 in ten frames and #abcdef in two.
  const walk = (count, empty) => ({ version: 1, name: 'walk', width: 32, height: 32, palette: { a: '#203040', b: '#e0a040' },
    frames: Array.from({ length: count }, (_, i) => ({ name: `walk-${i}`, ops: empty.includes(i) ? [] : [
      { op: 'rect', x: 4 + i, y: 8, w: 10, h: 16, color: 'a' }, { op: 'pixel', x: 30, y: i, color: 'b' },
      ...(i < 10 ? [{ op: 'rect', x: 20, y: 20, w: 3, h: 3, color: '#123456' }] : []), ...(i === 2 || i === 11 ? [{ op: 'rect', x: 0, y: 28, w: 2, h: 2, color: '#abcdef' }] : [])] })) });
  const brief = recipe => briefDiagnostics(inspectProject(renderProject(recipe), { diagnostics: true }).diagnostics);
  const one = brief(walk(12, [7]));
  // The three frames kept (walk-0 to walk-2) list their findings; the empty frame is named as before diagnostics were
  // added up, not counted as "1 frame".
  assert.deepEqual(one.frames.map(row => row.frame), ['walk-0', 'walk-1', 'walk-2']);
  assert.deepEqual(one.findings.find(finding => finding.code === 'empty'), { code: 'empty', frame: 'walk-7', note: 'An empty effect/transition frame may be intentional.' });
  // Each colour once, with the frames it is in among the others: not "7 colours in 7 frames", which counted a colour
  // again in every frame it is in. Strays in eight frames or fewer name them, and so do off-palette colours.
  assert.deepEqual(one.findingTotals, { isolated: '8 pixels in walk-3 … walk-6, walk-8 … walk-11', palette: '#123456 in 6 frames, #abcdef in 1 frame; in walk-3 … walk-6, walk-8, walk-9, walk-11' });
  assert.equal(brief(walk(13, [])).findingTotals.isolated, '10 pixels in 10 frames');
  // Several empty frames are one finding naming them, runs as their ends.
  const four = brief(walk(20, [5, 6, 7, 12]));
  assert.deepEqual(four.findings.filter(finding => finding.code === 'empty'), [{ code: 'empty', frames: 'walk-5 … walk-7, walk-12', note: 'An empty effect/transition frame may be intentional.' }]);
  // Forty colours a frame: eight are named, and the rest counted, with "or more" since a frame lists its first 32.
  const many = { version: 1, name: 'many', width: 40, height: 4, palette: { a: '#203040' },
    frames: Array.from({ length: 10 }, (_, i) => ({ name: `m-${i}`, ops: Array.from({ length: 40 }, (_, x) => ({ op: 'rect', x, y: 0, w: 1, h: 4, color: `#0000${(x + 16).toString(16)}` })) })) };
  // The three frames kept list theirs, so the other seven are counted and named.
  assert.equal(brief(many).findingTotals.palette, '#000010 in 7 frames, #000011 in 7 frames, #000012 in 7 frames, #000013 in 7 frames, #000014 in 7 frames, #000015 in 7 frames, #000016 in 7 frames, #000017 in 7 frames, 24 or more other colours; in m-3 … m-9');
  // Past eight frames they are counted, not named.
  assert.match(brief({ ...many, frames: [...many.frames, ...many.frames.map(frame => ({ ...frame, name: `n-${frame.name}` }))] }).findingTotals.palette, /in 17 frames, .* other colours$/);
  // The CLI reply is the same.
  const dir = await folder(t, 'sheets-empty'), cli = cliIn(dir);
  await writeFile(path.join(dir, 'walk.json'), JSON.stringify(walk(12, [7])));
  const made = cli('inspect', 'walk.json', '--diagnostics');
  assert.equal(made.status, 0, made.stderr);
  assert.deepEqual(JSON.parse(made.stdout).diagnostics, JSON.parse(JSON.stringify(one)));
});

test('diagnostics keep the frames that carry findings, so a long recipe with two flagged frames lists both', () => {
  // The shipped interference wave: 40 frames, stray pixels only in resonate-5 and resonate-25, which have few corners.
  // The three rows kept were the most cornered frames, and the reply listed no finding: "8 pixels in 2 frames".
  const source = JSON.parse(readFileSync(path.join(root, 'examples', 'interference.wave.json'), 'utf8'));
  const { diagnostics } = inspectProject(renderProject(COMPILERS[source.format](source).recipe), { diagnostics: true });
  const brief = briefDiagnostics(diagnostics), isolated = diagnostics.findings.filter(finding => finding.code === 'isolated');
  assert.deepEqual(isolated.map(finding => finding.frame), ['resonate-5', 'resonate-25']);
  assert.deepEqual([brief.frameTotals.frames, brief.frames.length], [40, 3]);
  assert.deepEqual(brief.frames.map(row => row.frame).slice(0, 2), ['resonate-5', 'resonate-25']);
  assert.deepEqual(brief.findings, isolated);
  assert.equal(brief.findingTotals, undefined);
});

test('a contact sheet refusal states the rule it enforces: gutters as wide as the scale count past 2 pixels', () => {
  const wide = renderProject(screen(1024, 256, 16));
  // 4096 pixels of frames and two 4-pixel gutters at scale 4: 4104, past the 4100 that 2-pixel gutters allow.
  assert.throws(() => inspectProject(wide, { scale: 4, frames: ['f0'] }), { path: 'inspect',
    message: 'inspect: the contact sheet would be 4104×1032 pixels, above the 4096-pixel limit (4096 pixels of frames and 2-pixel gutters; the 4-pixel gutters at scale 4 count their other 2 pixels against the 4096); select fewer frames, a smaller region or a lower scale' });
  // With 2-pixel gutters the refusal reads as it did before big frames.
  assert.throws(() => inspectProject(renderProject(screen(4096, 1024, 1)), { scale: 2 }), {
    message: 'inspect: the contact sheet would be 8196×2052 pixels, above the 4096-pixel limit (4096 pixels of frames and 2-pixel gutters); select fewer frames, a smaller region or a lower scale' });
  assert.equal(inspectProject(wide, { scale: 3, frames: ['f0'] }).sheet.width, 3078);
  // Within the sides but past one PNG: said as that.
  const big = renderProject(screen(512, 512, 16));
  assert.throws(() => inspectProject(big, { scale: 1, frames: Array.from({ length: 64 }, (_, i) => `f${i % 16}`) }), {
    message: 'inspect: the contact sheet would be 4114×4114 pixels, past the 16,777,216 one PNG holds; select fewer frames, a smaller region or a lower scale' });
  // One pixel is said as one.
  assert.throws(() => inspectProject(renderProject(screen(1366, 16, 1)), { scale: 3 }), {
    message: 'inspect: the contact sheet would be 4104×54 pixels, above the 4096-pixel limit (4096 pixels of frames and 2-pixel gutters; the 3-pixel gutters at scale 3 count their other 1 pixel against the 4096); select fewer frames, a smaller region or a lower scale' });
  // A frame whose 3×3 repeat no sheet holds is said as that: it had the advice above, though it has one frame, is at
  // scale 1 already and tile view takes no region.
  assert.throws(() => inspectProject(renderProject(screen(4096, 1024, 1)), { view: 'tile' }), { path: 'inspect.view',
    message: 'inspect.view: a 4096×1024 frame repeated 3×3 makes a sheet of 12292×3076 pixels with its gutters at scale 1, more than one holds (4096 pixels of frames a side, 16,777,216 pixels in all), so tile view cannot show it' });
  assert.throws(() => inspectProject(renderProject(screen(1366, 16, 1)), { view: 'tile' }), { path: 'inspect.view' });
  assert.throws(() => inspectProject(renderProject(screen(1365, 1365, 1)), { view: 'tile' }), { path: 'inspect.view' });
  assert.equal(inspectProject(renderProject(screen(1365, 16, 1)), { view: 'tile' }).sheet.width, 4099);
});

test('beside refits a stack of composites from the recipe given, so stack and a translucent under are drawn once', () => {
  // 24 cells of a ground frame under a sprite frame, nine times: past 8,000 pixels, so the sheets are refitted. The
  // refit laid stack's composites again (unknown frame "b0") and under's ground a second time.
  const pal = { k: '#102030', r: '#e04030' }, square = i => ({ op: 'rect', x: i * 8, y: 4, w: 8, h: 8, color: 'r' }), ground = { op: 'rect', x: 0, y: 0, w: 256, h: 256, color: 'k' };
  const recipe = frames => ({ version: 1, name: 'cells', width: 256, height: 256, palette: pal, frames });
  const nine = (project, options) => { const view = inspectProject(project, { ...options }, { sheets: 9 }); return stackViews(Array.from({ length: 9 }, (_, i) => ({ ...view, name: `v${i}` }))); };
  const pieces = renderProject(recipe([...Array.from({ length: 24 }, (_, i) => ({ name: `b${i}`, ops: [ground] })), ...Array.from({ length: 24 }, (_, i) => ({ name: `t${i}`, ops: [square(i)] }))]));
  const drawnTogether = renderProject(recipe(Array.from({ length: 24 }, (_, i) => ({ name: `c${i}`, ops: [ground, square(i)] }))));
  const stacked = nine(pieces, { stack: Array.from({ length: 24 }, (_, i) => [`b${i}`, `t${i}`]) }), expected = nine(drawnTogether, {});
  assert.ok(expected.stack.length === 9 && expected.sheet.height <= 8000 && expected.stack[0].height < inspectProject(drawnTogether).sheet.height, 'the stack is refitted');
  assert.deepEqual([stacked.sheet.width, stacked.sheet.height], [expected.sheet.width, expected.sheet.height]);
  assert.ok(Buffer.from(stacked.sheet.data).equals(Buffer.from(expected.sheet.data)));
  // A half-transparent grey under the sprites: where a sprite is not, the grey shows once, at alpha 128.
  const sprites = renderProject(recipe(Array.from({ length: 24 }, (_, i) => ({ name: `t${i}`, ops: [square(i)] }))));
  const grey = { width: 4, height: 4, data: new Uint8ClampedArray(64).map((_, i) => (i % 4 === 3 ? 128 : 200)) };
  const laid = { ...sprites, frames: sprites.frames.map(frame => ({ ...frame, data: frame.data.map((v, i) => (frame.data[i - i % 4 + 3] ? v : grey.data[i % 4])) })) };
  const under = nine(sprites, { under: grey }), once = nine(laid, {});
  assert.deepEqual([under.sheet.width, under.sheet.height], [once.sheet.width, once.sheet.height]);
  assert.ok(Buffer.from(under.sheet.data).equals(Buffer.from(once.sheet.data)));
});

test('every beside other recipes is refused once, with the every that holds the whole stack', async t => {
  // Nine 1024x256 loops of 16 frames at one cell per 10 ms. The first refusal named the every one 4096-pixel sheet
  // holds (22), which the stack then refused again (214). The refusal says what the sheet holds at the every asked,
  // and that the stack moves the advice past it.
  const project = renderProject(screen(1024, 256, 16)), names = ['a.json', 'b.json', 'c.json', 'd.json', 'e.json', 'f.json', 'g.json', 'h.json', 'i.json'];
  const nine = every => names.map(name => ({ ...inspectProject(project, { animation: 'run', every }, { sheets: 9 }), name }));
  let advised;
  assert.throws(() => stackViews(nine(10)), error => {
    assert.equal(error.path, 'inspect.every');
    assert.match(error.message, /^inspect\.every: a\.json: 1280 ms at one cell per 10 ms is 128 cells, and one 4096-pixel sheet \(one of 9 in the image\) of 1024×256 cells holds 60; stacked with the others, choose every (\d+)$/);
    advised = Number(/choose every (\d+)/.exec(error.message)[1]);
    return true;
  });
  // Following it works: every sheet shows every cell, within 8,000 pixels.
  const followed = stackViews(nine(advised));
  assert.deepEqual([followed.stack.length, followed.cells.length, followed.sampling.every], [9, Math.ceil(1280 / advised), advised]);
  assert.ok(followed.sheet.height <= 8000, `${followed.sheet.height}`);
  encodes(followed.sheet);
  // It is the smallest that holds: one less is refused. An every between the two is refused with the same advice, not
  // one a sheet further down refuses.
  assert.throws(() => stackViews(nine(advised - 1)), { path: 'inspect.every' });
  assert.throws(() => stackViews(nine(100)), { message: new RegExp(`choose every ${advised}$`) });
});

test('every beside other recipes past 256 cells a sheet is refused once, with the every the whole stack holds', async t => {
  // A 64x64 loop of 48 frames beside a 256x256 one of 64, at one cell per 10 ms: each sheet's 256-cell cap was refused
  // on its own before the stack was looked at (choose every 15, then at 15 every 20), and then the stack (27).
  const recipes = [screen(64, 64, 48), screen(256, 256, 64)];
  const views = every => recipes.map((recipe, i) => ({ ...inspectProject(renderProject(recipe), { animation: 'run', every }, { sheets: 2 }), name: `v${i}` }));
  const refusal = 'inspect.every: v1: 5120 ms at one cell per 10 ms is 512 cells, and a sheet holds at most 256; stacked with the others, choose every 25';
  assert.throws(() => stackViews(views(10)), { path: 'inspect.every', message: refusal });
  // The values the old chain named get the same advice, and following it shows every cell of both.
  for (const every of [15, 20]) assert.throws(() => stackViews(views(every)), { message: /choose every 25$/ });
  const advised = views(25), followed = stackViews(advised);
  assert.deepEqual(followed.stack.map(entry => entry.name), ['v0', 'v1']);
  assert.deepEqual(advised.map(view => view.cells.length), [154, 205]);
  encodes(followed.sheet);
  assert.throws(() => stackViews(views(24)), { path: 'inspect.every' });
  // The CLI's beside: one refusal, and its advice works.
  const dir = await folder(t, 'sheets-every-cap'), cli = cliIn(dir);
  await writeFile(path.join(dir, 'a.json'), JSON.stringify(recipes[0]));
  await writeFile(path.join(dir, 'b.json'), JSON.stringify(recipes[1]));
  const refused = cli('inspect', 'a.json', '--beside', 'b.json', '--animation', 'run', '--every', '10', '--out', 'x.png');
  assert.equal(JSON.parse(refused.stderr).error, refusal.replace('v1', 'b.json'));
  const made = cli('inspect', 'a.json', '--beside', 'b.json', '--animation', 'run', '--every', '25', '--out', 'x.png');
  assert.equal(made.status, 0, made.stdout + made.stderr);
});

test('how many sheets beside stacks is never a caller option: one recipe past 256 cells is refused as on its own', async t => {
  // MCP pixel_inspect passes its options to inspectProject. With `sheets` an option, a call with sheets and no beside
  // left the 256-cell refusal to a stack that never came, and showed one cell with ok: true.
  const recipe = screen(64, 64, 64), project = renderProject(recipe), cap = 'inspect.every: 5120 ms at one cell per 10 ms is 512 cells; at most 256, so choose every 20 or more';
  assert.throws(() => inspectProject(project, { animation: 'run', every: 10, sheets: 2 }), { path: 'inspect.sheets', message: /^inspect\.sheets: unknown field; fields here: frames, .*, under$/ });
  assert.throws(() => inspectProject(project, { animation: 'run', every: 10 }), { path: 'inspect.every', message: cap });
  const dir = await folder(t, 'sheets-option'), run = createToolRunner({ directory: dir, root: dir, version: '0.0.0' });
  const sent = await run('pixel_inspect', { project: recipe, animation: 'run', every: 10, sheets: 2 });
  assert.ok(sent.isError);
  assert.match(sent.content[0].text, /inspect\.sheets: unknown field/);
  const alone = await run('pixel_inspect', { project: recipe, animation: 'run', every: 10 });
  assert.ok(alone.isError);
  assert.ok(alone.content[0].text.includes(cap.slice('inspect.every: '.length)), alone.content[0].text);
  // Following the refusal shows every cell, and beside still gathers the stack's one refusal through MCP.
  const followed = await run('pixel_inspect', { project: recipe, animation: 'run', every: 20 });
  assert.ok(!followed.isError, followed.content[0].text);
  const { revision, sampling } = JSON.parse(followed.content[0].text);
  assert.deepEqual([sampling?.shown ?? 256, sampling?.every], [256, 20]);
  const stacked = await run('pixel_inspect', { revision, animation: 'run', every: 10, beside: [revision] });
  assert.ok(stacked.isError);
  assert.match(stacked.content[0].text, /choose every 20\b/);
  assert.ok(!(await run('pixel_inspect', { revision, animation: 'run', every: 20, beside: [revision] })).isError);
});

test('every beside other recipes names the smallest every the stack holds, and what the sheet holds at the every asked', () => {
  // Nine mixed loops at one cell per 15 ms. The refusal named the first every that held (640), and "holds 1" from the
  // try that failed, though every value from 256 holds and the 256x1024 sheet shows 3 cells there. The 1024x128 sheet
  // alone holds 124 of the 171 cells asked; the stack moves the every past its own 21.
  const sizes = [[64, 64, 48], [320, 180, 40], [1024, 128, 32], [640, 360, 16], [512, 512, 12], [320, 180, 40], [64, 64, 48], [1024, 256, 8], [256, 1024, 8]];
  const projects = sizes.map(([w, h, n]) => renderProject(screen(w, h, n)));
  const views = every => projects.map((project, i) => ({ ...inspectProject(project, { animation: 'run', every }, { sheets: 9 }), name: `v${i}` }));
  assert.throws(() => stackViews(views(15)), { path: 'inspect.every',
    message: 'inspect.every: v2: 2560 ms at one cell per 15 ms is 171 cells, and one 4096-pixel sheet (one of 9 in the image) of 1024×128 cells holds 124; stacked with the others, choose every 256' });
  const advised = views(256), followed = stackViews(advised);
  assert.ok(followed.sheet.height <= 8000, `${followed.sheet.height}`);
  assert.equal(advised[8].cells.length, 3);
  encodes(followed.sheet);
  // One less: the 256x1024 sheet's 3 cells, which it holds at 256, are more than the 1 the other sheets' cells at 255
  // leave it room for. Said so, never "is 3 cells, and … holds 3".
  assert.throws(() => stackViews(views(255)), { path: 'inspect.every',
    message: "inspect.every: v8: 640 ms at one cell per 255 ms is 3 cells, and the height left to it in an image of 9 sheets stacked (8,000 pixels tall at most) holds 1 beside the other sheets' cells at that every; choose every 256" });
});

test('every beside other recipes climbs from the every asked, so a run that holds just above it is named', () => {
  // A stack is not monotone in every: fewer cells can let a small sheet keep a larger scale and crowd the rest. These
  // nine loops hold at 214 to 280, are refused at 290 to 319 and hold again from 320. The search jumped to what the
  // refused sheet asked for (640), halved down to 320, and named it to an agent asking 213.
  const mixE = [[256, 256, 64], [256, 256, 24], [256, 256, 64], [256, 1024, 8], [256, 256, 24], [128, 128, 32], [256, 256, 24], [1024, 256, 16], [1024, 128, 32]];
  // The second holds at 60 to 75, is refused at 80 to 100 and holds again from 110; asked 55 or 109 it was told 110.
  const nine = [[64, 64, 48], [512, 512, 12], [64, 64, 48], [64, 64, 48], [256, 256, 24], [512, 512, 2], [1024, 256, 2], [128, 128, 32], [64, 64, 48]];
  const stackOf = sizes => {
    const projects = sizes.map(([w, h, n]) => renderProject(screen(w, h, n)));
    return every => projects.map((project, i) => ({ ...inspectProject(project, { animation: 'run', every }, { sheets: projects.length }), name: `a${sizes[i].join('x')}` }));
  };
  const refusal = (views, every) => {
    let message;
    assert.throws(() => stackViews(views(every)), error => { message = error.message; return error.path === 'inspect.every'; });
    // What the sheet holds at the every asked is fewer than the cells that every makes.
    const [, cells, held] = /is (\d+) cells, and .* holds (\d+)/.exec(message);
    assert.ok(Number(held) < Number(cells), message);
    return { message, advised: Number(/choose every (\d+)$/.exec(message)[1]) };
  };
  const follow = (views, every) => {
    const shown = views(every), followed = stackViews(shown);
    assert.ok(followed.sheet.height <= 8000, `${followed.sheet.height}`);
    shown.forEach(view => assert.equal(view.cells.length, Math.ceil(view.timing.duration / every)));
    encodes(followed.sheet);
  };
  const e = stackOf(mixE), first = refusal(e, 213);
  assert.equal(first.message, "inspect.every: a256x1024x8: 640 ms at one cell per 213 ms is 4 cells, and the height left to it in an image of 9 sheets stacked (8,000 pixels tall at most) holds 1 beside the other sheets' cells at that every; choose every 214");
  follow(e, first.advised);
  const n = stackOf(nine);
  assert.equal(refusal(n, 55).message, "inspect.every: a512x512x12: 960 ms at one cell per 55 ms is 18 cells, and the height left to it in an image of 9 sheets stacked (8,000 pixels tall at most) holds 16 beside the other sheets' cells at that every; choose every 60");
  follow(n, 60);
  // Asked 109, the 512x512 sheet's 9 cells are 9 at 110 too, where it holds them: at 109 the other sheets' cells leave
  // it room for 8, and the reply says that, not "is 9 cells, and … holds 9".
  assert.equal(refusal(n, 109).message, "inspect.every: a512x512x12: 960 ms at one cell per 109 ms is 9 cells, and the height left to it in an image of 9 sheets stacked (8,000 pixels tall at most) holds 8 beside the other sheets' cells at that every; choose every 110");
  follow(n, 110);
});

test('diagnostics of a long recipe whose only findings are off-palette colours name the frames they are in', () => {
  // The cannon-smoke preset: 44 frames, off-palette colours in cannon-smoke-0 … cannon-smoke-5 alone. The three rows
  // kept were frames with none, and the colours were totalled with no frame named.
  const source = JSON.parse(readFileSync(path.join(root, 'examples', 'cannon-smoke.fluid.json'), 'utf8'));
  const { diagnostics } = inspectProject(renderProject(COMPILERS[source.format](source).recipe), { diagnostics: true });
  const flagged = diagnostics.findings.filter(finding => finding.code === 'palette').map(finding => finding.frame);
  assert.deepEqual(flagged, Array.from({ length: 6 }, (_, i) => `cannon-smoke-${i}`));
  const brief = briefDiagnostics(diagnostics), kept = brief.frames.map(row => row.frame);
  assert.ok(kept.every(frame => flagged.includes(frame)), kept.join());
  assert.deepEqual(brief.findings.map(finding => finding.frame).sort(), [...kept].sort());
  const named = /; in (.*)$/.exec(brief.findingTotals.palette)[1];
  // What is listed and what is named are the six frames, each once.
  assert.equal(named, 'cannon-smoke-0 … cannon-smoke-2');
  assert.deepEqual([...kept, 'cannon-smoke-0', 'cannon-smoke-1', 'cannon-smoke-2'].sort(), [...flagged].sort());
});

test('a beside row too tall for its share counts the other recipes by the least each takes', () => {
  // One 256x900 recipe above eight 256x1024 ones: one row of 900 is refused, and as many others as tall as it would
  // be 7, which with taller neighbours is refused again.
  const views = (n, sheets) => [screen(256, 900, 4), ...Array(n).fill(screen(256, 1024, 4))].map((recipe, i) => ({ ...inspectProject(renderProject(recipe), {}, { sheets }), name: `v${i}` }));
  assert.throws(() => stackViews(views(8, 9)), { path: 'beside',
    message: 'beside: v0: one row of 256×900 cells is 928 pixels tall with its gutters and label, past the 900 left to it in an image of 9 sheets stacked (8,000 pixels tall at most); compare at most 6 other recipes, or show a smaller region' });
  const six = stackViews(views(6, 7));
  assert.ok(six.stack.length === 7 && six.sheet.height <= 8000, `${six.sheet.height}`);
});

test('motion review of tall frames keeps the arcs and the trajectory it can, and names what crowds a trajectory out', () => {
  // One foot marker per frame, so the review has arcs to draw.
  const foot = (w, h, count) => ({ format: 'pixelforge-pose-metadata', version: 1,
    poses: Object.fromEntries(Array.from({ length: count }, (_, i) => [`f${i}`, { markers: [{ name: 'foot', at: [(i * 3) % w, h - 1 - (i % 5)] }] }])) });
  const review = (w, h, count) => inspectMotion(renderProject(screen(w, h, count)), { animation: 'run', metadata: foot(w, h, count), speed: 20, ground: h - 1 });
  const crowded = (w, h, count, by) => `The trajectory panel (${Math.round(20 * (count - 1) * 80 / 1000) + w + 8} pixels wide, lanes of ${w}×${h} frames) does not fit beside ${by} within the 4,194,304-pixel image.`;
  // [w, h, frames, arcs, trajectory]: the wide timing grid of tall frames once left no room for arcs at magnification 8,
  // and the trajectory, dropped first, was never tried again. Now the arcs come down to 3 and take another grid, and a
  // trajectory left out beside them says so; one that fits once the arcs are left out is drawn.
  for (const [w, h, count, arcs, trajectory] of [
    [128, 512, 32, true, crowded(128, 512, 32, 'the timing cells and arcs')],
    [96, 520, 32, true, 6],
    [200, 400, 32, true, crowded(200, 400, 32, 'the timing cells and arcs')],
    [256, 600, 24, false, 2],
    [640, 360, 18, false, crowded(640, 360, 18, 'the timing cells')]]) {
    const r = review(w, h, count), { width, height } = r.nativeSheet;
    assert.deepEqual([r.arcs.shown, r.trajectory.lanes ?? r.trajectory.reason], [arcs, trajectory], `${w}x${h}x${count}`);
    if (arcs) assert.ok(r.arcs.magnification >= 3 && r.arcs.origin[1] + r.arcs.height <= height, `${w}x${h}x${count}`);
    else assert.equal(r.arcs.reason, 'The arcs, magnified at least 3 times, would take the image past 4,194,304 pixels or 8192 a side.');
    assert.ok(width * height <= 4194304 && width <= 8192 && height <= 8192, `${w}x${h}x${count}: ${width}x${height}`);
    encodes(r.sheet);
  }
  // 128x512: eight columns of four rows leave room for the arcs at 3 times.
  const tall = review(128, 512, 32);
  assert.deepEqual([tall.arcs.magnification, tall.cells[8].timing[1] > tall.cells[7].timing[1], tall.cells.length], [3, true, 32]);
});

test('the motion review moves pose metadata from a resized canvas onto it: ground, contacts and the ground line', async t => {
  const dir = await folder(t, 'motion-resized'), cli = cliIn(dir);
  const review = (name, size) => {
    const made = cli('compile', '--preset', 'hero', ...size, '--animation', 'walk', '--out', `${name}.json`, '--metadata', `${name}.meta.json`);
    assert.equal(made.status, 0, made.stderr);
    const seen = cli('inspect', `${name}.json`, '--metadata', `${name}.meta.json`, '--motion', 'walk', '--speed', '40', '--out', `${name}.png`);
    assert.equal(seen.status, 0, seen.stderr);
    return JSON.parse(seen.stdout);
  };
  const before = review('small', []), after = review('big', ['--size', '640x360']);
  const { offset } = JSON.parse(await readFile(path.join(dir, 'big.meta.json'), 'utf8')).resized;
  // The figure stands 162 rows lower on the new canvas, and so do its ground and contacts; what they measure is unchanged.
  assert.deepEqual(offset, [-304, -162]);
  assert.equal(after.motion.ground, before.motion.ground + 162);
  assert.deepEqual(after.motion.slide.map(s => s.samples.map(x => x.at)), before.motion.slide.map(s => s.samples.map(x => x.at.map((v, i) => v - offset[i]))));
  assert.deepEqual([after.motion.groundErrors, after.motion.checks], [before.motion.groundErrors, before.motion.checks]);
  assert.equal(after.motion.checks.ground, true);
  // The ground line runs under the figure in each cell, not at the old row near the top.
  const image = decodePNG(await readFile(path.join(dir, 'big.native.png'))), [x, y] = after.cells[0].timing;
  const at = row => [...image.data.slice(((y + row) * image.width + x + 10) * 4, ((y + row) * image.width + x + 10) * 4 + 3)];
  assert.deepEqual([at(after.motion.ground + 1), at(before.motion.ground + 1)], [[80, 100, 115], [24, 33, 43]]);
});
