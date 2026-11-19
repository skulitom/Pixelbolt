import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, buildAtlas, largestScale } from '../src/core.js';
import { createBundle } from '../src/export.js';
import { encodeGIF, animationGIF } from '../src/gif.js';
import { createToolRunner } from '../src/mcp.js';

// A sheet too big for one PNG is refused at project.sheet.scale with the largest scale at which the atlas and every
// frame fit (before, an untrimmed sheet got "atlas exceeds 16,777,216 pixels; reduce scale or columns", which named no
// scale and offered columns that could not help). The GIF and export budgets name theirs too.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const screen = (width, height, frames, extra = {}) => ({
  version: 1, name: 'screen', width, height, palette: { k: '#102030', s: '#a0c0f0' },
  frames: Array.from({ length: frames }, (_, i) => ({ name: `f${i}`, ops: [{ op: 'rect', x: 0, y: 0, w: width, h: height, color: 'k' }, { op: 'pixel', x: i % width, y: 0, color: 's' }] })),
  ...extra
});
const PAST = 'past the 16,777,216 pixels one PNG holds';
const refusal = message => error => error.path === 'project.sheet.scale' && error.message === `project.sheet.scale: ${message}`;

test('a 640x360 title card of 12 frames at scale 3 is refused at sheet.scale, naming scale 2, whatever the columns', () => {
  const title = { sheet: { scale: 3 } };
  assert.throws(() => renderProject(screen(640, 360, 12, title)), refusal(`at scale 3 the 12 frames of 640×360 make an atlas of 11520×2160, ${PAST}; scale 2 is the largest that fits`));
  // A full grid has no empty cell, so fewer columns cannot help and are not offered.
  assert.throws(() => renderProject(screen(640, 360, 12, { sheet: { scale: 3, columns: 1 } })), refusal(`at scale 3 the 12 frames of 640×360 make an atlas of 1920×12960, ${PAST}; scale 2 is the largest that fits`));
  assert.equal(renderProject(screen(640, 360, 12, { sheet: { scale: 2 } })).sheet.scale, 2);
});

test('a 320x180 rain overlay of 16 frames at scale 8 names scale 4', () => {
  assert.throws(() => renderProject(screen(320, 180, 16, { sheet: { scale: 8 } })), refusal(`at scale 8 the 16 frames of 320×180 make an atlas of 20480×2880, ${PAST}; scale 4 is the largest that fits`));
  const fits = renderProject(screen(320, 180, 16, { sheet: { scale: 4 } })).sheet;
  assert.ok(fits.width * fits.height <= 16777216);
});

test('a 4096x1024 still at scale 3 is refused for its frame, naming scale 2, and never offers columns', () => {
  const still = { ...screen(4096, 1024, 1), animations: {}, sheet: { scale: 3 } };
  assert.throws(() => renderProject(still), refusal(`a 4096×1024 frame at scale 3 is 12288×3072, ${PAST}; scale 2 is the largest that fits`));
  assert.equal(renderProject({ ...still, sheet: { scale: 2 } }).sheet.width, 8192);
});

test('fewer columns are offered only where the last row leaves empty cells and a narrower grid fits', () => {
  // 3 frames on 2 columns leave an empty cell: one column holds them at scale 5.
  assert.throws(() => renderProject(screen(420, 420, 3, { sheet: { scale: 5, columns: 2 } })), refusal(`at scale 5 the 3 frames of 420×420 make an atlas of 4200×4200, ${PAST}; scale 4 is the largest that fits, or sheet.columns 1 at scale 5`));
  assert.equal(renderProject(screen(420, 420, 3, { sheet: { scale: 5, columns: 1 } })).sheet.height, 6300);
  // More columns than frames: the widest grid without the waste, at the largest scale it fits.
  assert.throws(() => renderProject(screen(256, 256, 2, { sheet: { scale: 16, columns: 256 } })), refusal(`at scale 16 the 2 frames of 256×256 make an atlas of 1048576×4096, ${PAST}; scale 1 is the largest that fits, or sheet.columns 2 at scale 11`));
  // One frame on 8 columns fits no scale as asked; one column does.
  assert.throws(() => renderProject({ ...screen(2048, 2048, 1), animations: {}, sheet: { columns: 8 } }), refusal(`at scale 1 one frame of 2048×2048 makes an atlas of 16384×2048, ${PAST}; sheet.columns 1 at scale 1 fits`));
});

test('a grid asked of a trimmed recipe (trim: false) is refused the same way', () => {
  const project = renderProject({ ...screen(640, 360, 12, { sheet: { scale: 2, trim: true } }), frames: Array.from({ length: 12 }, (_, i) => ({ name: `f${i}`, ops: [{ op: 'pixel', x: i, y: 0, color: 's' }] })) });
  assert.equal(buildAtlas(project).width * buildAtlas(project).height < 1000, true);
  assert.throws(() => buildAtlas({ ...project, sheet: { ...project.sheet, scale: 3 } }, { trim: false }), refusal(`at scale 3 the 12 frames of 640×360 make an atlas of 11520×2160, ${PAST}; scale 2 is the largest that fits`));
});

test('the render CLI and MCP pixel_render name scale 2 for the 640x360 title card at scale 3', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-big-scale-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const message = `project.sheet.scale: at scale 3 the 12 frames of 640×360 make an atlas of 11520×2160, ${PAST}; scale 2 is the largest that fits`;
  await writeFile(path.join(dir, 'title.json'), JSON.stringify(screen(640, 360, 12)));
  const cli = spawnSync(process.execPath, [path.join(root, 'bin', 'pixelbolt.js'), 'render', 'title.json', '--out', 'out', '--scale', '3'], { cwd: dir, encoding: 'utf8' });
  assert.equal(cli.status, 1);
  assert.deepEqual(JSON.parse(cli.stderr), { ok: false, error: message, path: 'project.sheet.scale' });
  assert.deepEqual(await readdir(dir), ['title.json']);
  const run = createToolRunner({ directory: dir, root: dir, version: '0.0.0' });
  for (const args of [{ project: screen(640, 360, 12), scale: 3 }, { project: screen(640, 360, 12, { sheet: { scale: 3 } }) }]) {
    const result = await run('pixel_render', args);
    assert.equal(result.isError, true);
    assert.deepEqual(JSON.parse(result.content[0].text), { error: message, path: 'project.sheet.scale' });
  }
});

test('GIF and export budgets name the largest scale that fits', async t => {
  assert.equal(largestScale(16 * 320 * 180, 67108864, 9), 8);
  assert.equal(largestScale(1024 * 320 * 180 * 2, 67108864, 2), 0);
  // The budget is checked before any frame is read, so the frames can share one buffer.
  const blank = new Uint8Array(320 * 180 * 4), frames = Array.from({ length: 16 }, () => ({ data: blank, duration: 100 }));
  assert.throws(() => encodeGIF(frames, 320, 180, { scale: 9 }), { path: 'gif', message: 'gif: 16 frames at 2880×1620 exceed 67,108,864 pixels; scale 8 is the largest that fits, or shorten the animation' });
  assert.equal(encodeGIF(frames, 320, 180, { scale: 8 }).width, 2560);
  const long = Array.from({ length: 1000 }, () => ({ data: blank, duration: 100 }));
  assert.throws(() => encodeGIF(long, 320, 180, { scale: 2 }), { message: 'gif: 1000 frames at 640×360 exceed 67,108,864 pixels; scale 1 is the largest that fits, or shorten the animation' });
  assert.throws(() => encodeGIF([...long, ...long], 320, 180), { message: 'gif: 2000 frames at 320×180 exceed 67,108,864 pixels; shorten the animation' });
  // A side past a GIF's 65,535 (a 4096-wide still at scale 16) said only "invalid dimensions": it names the scale too,
  // and that scale holds the pixel budget as well.
  const strip = [{ data: new Uint8ClampedArray(4096 * 1024 * 4), duration: 100 }];
  assert.throws(() => encodeGIF(strip, 4096, 1024, { scale: 16 }), { path: 'gif', message: 'gif: 65536×16384 is past the 65,535 pixels a GIF\'s side holds; scale 4 is the largest that fits' });
  assert.equal(encodeGIF(strip, 4096, 1024, { scale: 4 }).width, 16384);
  // Two frames played 1024 times: the atlas fits at scale 2, the animation pixels only at 1.
  const replayed = screen(320, 180, 2, { animations: { spin: { frames: Array.from({ length: 1024 }, (_, i) => `f${i % 2}`) } } });
  await assert.rejects(createBundle({ ...replayed, sheet: { scale: 2 } }), { path: 'project.sheet.scale', message: 'project.sheet.scale: the animations play 1024 frames of 640×360, past the 67,108,864 animation pixels an export holds; scale 1 is the largest that fits, or shorten them' });
  assert.equal((await createBundle(replayed)).project.sheet.scale, 1);
  const twice = { ...replayed, animations: { spin: replayed.animations.spin, again: replayed.animations.spin } };
  await assert.rejects(createBundle(twice), { path: 'project.animations', message: 'project.animations: the animations play 2048 frames of 320×180, past the 67,108,864 animation pixels an export holds; shorten them' });
  // MCP: every animation's GIF at gif.scale 4 together passes the budget; 3 fits.
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-big-scale-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const run = createToolRunner({ directory: dir, root: dir, version: '0.0.0' });
  const names = Array.from({ length: 12 }, (_, i) => `f${i}`), title = screen(640, 360, 12, { animations: { a: { frames: names }, b: { frames: names } } });
  assert.ok(animationGIF(renderProject(title), 'a', { scale: 4 }).width === 2560);
  const result = await run('pixel_render', { project: title, gif: { scale: 4 } });
  assert.equal(result.isError, true);
  assert.equal(JSON.parse(result.content[0].text).error, 'gif: the GIFs of every animation at scale 4 pass the 67,108,864 pixels one render\'s GIFs hold; gif.scale 3 is the largest that fits');
  // At scale 6 one animation's GIF alone passes the budget, and that GIF's own refusal named scale 4, which the next
  // call refused: the total is checked first, so the scale named fits them all.
  assert.throws(() => animationGIF(renderProject(title), 'a', { scale: 6 }), /scale 4 is the largest that fits/);
  const alone = await run('pixel_render', { project: title, gif: { scale: 6 } });
  assert.equal(JSON.parse(alone.content[0].text).error, 'gif: the GIFs of every animation at scale 6 pass the 67,108,864 pixels one render\'s GIFs hold; gif.scale 3 is the largest that fits');
  // A scale that is no whole number keeps the encoder's own refusal.
  const broken = await run('pixel_render', { project: title, gif: { scale: 2.5 } });
  assert.equal(broken.isError, true);
  assert.doesNotMatch(JSON.parse(broken.content[0].text).error, /GIFs of every animation/);
});

test('small renders are byte for byte what they were before the refusal changed', async () => {
  // Hashes from 139f1ad: the sheet PNG, the atlas JSON and a scale-2 GIF of the first animation. The sheets' hashes
  // are from the switch to deflate level 6, whose PNGs decode to the same pixels as 139f1ad's (Pillow and ffmpeg).
  const sha = data => createHash('sha256').update(data).digest('hex').slice(0, 16);
  const cases = [
    ['coin.json', undefined, ['36a6db886654b688', '679346b3895f9c90', '6bd9d1cceef0ae1e']],
    ['coin.json', { scale: 4 }, ['df9dc2e456df1582', 'b9399de97286d40b', '6bd9d1cceef0ae1e']],
    ['ember.json', { trim: true, scale: 3 }, ['a898084df24f4663', 'cb0834dec6ad2a72', 'a269dd5138d5ce11']],
    ['effects.json', undefined, ['b513517473b154d6', '8d1066145b07b7ab', '619bdb2aff26b4c5']]
  ];
  for (const [file, sheet, expected] of cases) {
    const recipe = JSON.parse(await readFile(path.join(root, 'examples', file), 'utf8'));
    if (sheet) recipe.sheet = { ...recipe.sheet, ...sheet };
    const bundle = await createBundle(recipe), name = bundle.project.name;
    assert.deepEqual([sha(bundle.files.get(`${name}.png`)), sha(bundle.files.get(`${name}.atlas.json`)), sha(animationGIF(bundle.project, undefined, { scale: 2 }).data)], expected, file);
  }
});

test('every frame written to frames/ is inside the export\'s budget: stills and unplayed frames on a trimmed sheet', async () => {
  // A trimmed sheet packs what is drawn, so its atlas is small where the whole frames in frames/ are not, and stills
  // (or frames no animation plays) are in no animation's count: 40 stills of 128×128 at scale 16 made 167,772,160
  // pixels of frame PNGs, held at once, with nothing said.
  const icons = (count, scale, extra = {}) => ({ version: 1, name: 'icons', width: 128, height: 128, palette: { a: '#e04030' },
    frames: Array.from({ length: count }, (_, k) => ({ name: `f${k}`, ops: [{ op: 'rect', x: k, y: 3, w: 8, h: 8, color: 'a' }] })), animations: {}, sheet: { trim: true, scale }, ...extra });
  const refusal = { path: 'project.sheet.scale', message: 'project.sheet.scale: the 40 frames of 2048×2048 written to frames/ are past the 67,108,864 pixels an export\'s frames hold; scale 10 is the largest that fits' };
  await assert.rejects(createBundle(icons(40, 16)), refusal);
  await assert.rejects(createBundle(icons(40, 16, { animations: { one: { frames: ['f0'] } } })), refusal);
  await assert.rejects(createBundle(icons(40, 11)), { message: /the 40 frames of 1408×1408 written to frames\/ .*; scale 10 is the largest that fits$/ });
  const fits = await createBundle(icons(40, 10));
  assert.equal([...fits.files.keys()].filter(file => file.startsWith('frames/')).length, 40);
  assert.equal(fits.files.get('frames/f0.png').readUInt32BE(16), 1280);
  // The frames an animation plays are refused by the animation budget, worded as before.
  await assert.rejects(createBundle(icons(40, 16, { animations: undefined })), { message: /^project\.sheet\.scale: the animations play 40 frames of 2048×2048, past the 67,108,864 animation pixels an export holds; scale 10 is the largest that fits, or shorten them$/ });
});

test('a trimmed sheet\'s normal pass is not refused for an atlas of its own that is never written', async () => {
  // The normal sheet is drawn on the colour sheet's cells (P-172). The pass was still packed by itself first, and a
  // normal pass has a flat background: every frame full, so at scale 3 its own "atlas of 6144×6144" was refused
  // where the colour sheet, and the normal sheet written, are 384×384.
  const at = k => ({ x: 10 + (k % 16), y: 20 + Math.floor(k / 16) });
  const colour = scale => ({ version: 1, name: 'lit', width: 256, height: 256, palette: { a: '#e04030', b: '#30e040' },
    frames: Array.from({ length: 64 }, (_, k) => ({ name: `f${k}`, ops: [{ op: 'rect', x: 10, y: 20, w: 16, h: 16, color: 'a' }, { op: 'pixel', ...at(k), color: 'b' }] })), sheet: { trim: true, scale } });
  const normal = { version: 1, name: 'lit', width: 256, height: 256, palette: { n: '#8080ff', u: '#80ff80' },
    frames: Array.from({ length: 64 }, (_, k) => ({ name: `f${k}`, ops: [{ op: 'rect', x: 0, y: 0, w: 256, h: 256, color: 'n' }, { op: 'pixel', ...at(k), color: 'u' }] })) };
  const size = png => [png.readUInt32BE(16), png.readUInt32BE(20)];
  for (const scale of [2, 3, 4]) {
    const { files } = await createBundle(colour(scale), { normal });
    assert.deepEqual(size(files.get('lit.normal.png')), size(files.get('lit.png')), `scale ${scale}`);
    assert.deepEqual(size(files.get('lit.png')), [128 * scale, 128 * scale]);
  }
  // An untrimmed pair is byte for byte what it was: the pass is rendered for its frames, and the sheet is the colour's.
  const plain = { ...colour(1), sheet: { scale: 1 }, frames: colour(1).frames.slice(0, 4) }, flat = { ...normal, frames: normal.frames.slice(0, 4) };
  const { files } = await createBundle(plain, { normal: flat }), alone = buildAtlas(renderProject({ ...flat, sheet: { scale: 1 } }));
  assert.deepEqual(size(files.get('lit.normal.png')), [alone.width, alone.height]);
});

test('gif.scale past 16 gets the encoder\'s 1 to 16 refusal at once, never a search for a smaller scale (P-188)', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-gif-range-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const run = createToolRunner({ directory: dir, root: dir, version: '0.0.0' });
  const pair = screen(64, 64, 2, { animations: { a: { frames: ['f0', 'f1'] } } }), range = 'gif.scale: expected a whole number from 1 to 16';
  // Before: the budget came first and named "gif.scale 90 is the largest that fits", which the encoder then refused.
  const past = await run('pixel_render', { project: pair, gif: { scale: 99 } });
  assert.deepEqual([past.isError, JSON.parse(past.content[0].text).error], [true, range]);
  // Before: the search counted down from 1e20 one at a time, k-- left it unchanged, and the call ran to its time limit.
  const huge = await run('pixel_render', { project: pair, gif: { scale: 1e20 } });
  assert.deepEqual([huge.isError, JSON.parse(huge.content[0].text).error], [true, range]);
  // 16 is still checked against the budget, and 17 on a small sprite still gets the range refusal.
  const tall = screen(640, 360, 12, { animations: { a: { frames: Array.from({ length: 12 }, (_, i) => `f${i}`) } } });
  assert.match(JSON.parse((await run('pixel_render', { project: tall, gif: { scale: 16 } })).content[0].text).error, /^gif: the GIFs of every animation at scale 16 .* gif\.scale 4 is the largest that fits$/);
  assert.equal(JSON.parse((await run('pixel_render', { project: screen(8, 8, 2), gif: { scale: 17 } })).content[0].text).error, range);
});
