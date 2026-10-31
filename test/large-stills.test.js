import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { Worker } from 'node:worker_threads';
import os from 'node:os';
import path from 'node:path';
import { PixelError, renderProject, inspectProject, compareProjects } from '../src/core.js';
import { patchRecipe } from '../src/patch.js';
import { compileNormals } from '../src/authoring.js';
import { createBundle } from '../src/export.js';
import { startMCP } from '../src/mcp.js';

// Large stills (one frame, up to 4096 a side) through inspection, patch comparison, rewrite, normals and the schema.
const still = (width, height, ops = [], extra = {}) => ({ version: 1, name: 'mural', width, height, palette: { k: '#102030', s: '#f0c080' }, frames: [{ name: 'still', ops }], ...extra });
const filled = (width, height) => still(width, height, [{ op: 'rect', x: 0, y: 0, w: width, h: height, color: 'k' }]);
const sha = data => createHash('sha256').update(data).digest('hex').slice(0, 16);
const pixel = (sheet, x, y) => [...sheet.data.subarray((y * sheet.width + x) * 4, (y * sheet.width + x) * 4 + 4)];
const gutter = [23, 25, 29, 255], dark = [16, 32, 48, 255], recoloured = [17, 34, 51, 255];

function session(options) {
  const input = new PassThrough(), output = new PassThrough(), waiting = new Map(); let buffer = '', next = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)?.(message); } });
  startMCP({ input, output, ...options });
  const request = (method, params) => new Promise(resolve => { waiting.set(++next, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n'); });
  const call = async (name, args) => (await request('tools/call', { name, arguments: args })).result;
  return { input, call, init: () => request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } }) };
}
const temp = async t => {
  const base = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(base, 'pixelbolt-large-stills-'));
  t.after(async () => { assert.ok(dir.startsWith(base + path.sep)); await rm(dir, { recursive: true, force: true }); });
  return dir;
};

test('a still 4093 to 4096 pixels a side inspects as one sheet: the 4096-pixel limit is on the cells, not the gutters', () => {
  const wide = renderProject(filled(4096, 1024));
  for (const [w, h] of [[4096, 1024], [4093, 1024], [1024, 4096]]) {
    const project = w === 4096 ? wide : renderProject(filled(w, h));
    // pixel_render previews with maxCells 256; the CLI and pixel_inspect without options.
    for (const options of w === 4096 ? [{}, { maxCells: 256 }] : [{}]) {
      const { sheet } = inspectProject(project, options);
      assert.deepEqual([sheet.width, sheet.height, sheet.columns, sheet.rows, sheet.scale, sheet.gap], [w + 4, h + 4, 1, 1, 1, 2], `${w}×${h}`);
      assert.deepEqual([pixel(sheet, 1, 1), pixel(sheet, 2, 2), pixel(sheet, w + 1, h + 1), pixel(sheet, w + 2, h + 2)], [gutter, dark, dark, gutter]);
    }
  }
  // Cells past 4096 are still refused, with the advice that fixes it.
  assert.throws(() => inspectProject(wide, { scale: 2 }), /8196×2052 pixels, above the 4096-pixel limit/);
  assert.throws(() => inspectProject(renderProject({ ...still(256, 256), frames: Array.from({ length: 17 }, (_, i) => ({ name: `f${i}` })) }), { scale: 16 }), /above the 4096-pixel limit/);
});

test('sheets that fitted before are byte-identical', async () => {
  const spirit = renderProject(JSON.parse(await readFile(new URL('../examples/forest-spirit.json', import.meta.url), 'utf8')));
  const all = inspectProject(spirit), idle = inspectProject(spirit, { animation: 'idle', scale: 3 });
  assert.deepEqual([sha(all.sheet.data), all.sheet.width, all.sheet.height], ['9bd7933ba79941f4', 760, 510]);
  assert.deepEqual([sha(idle.sheet.data), idle.sheet.width, idle.sheet.height], ['92613698bb70bdf1', 528, 78]);
  const hd = still(1920, 1080, [{ op: 'rect', x: 0, y: 0, w: 1920, h: 1080, color: 'k' }, { op: 'dither', color: 's', density: 0.3, pattern: 'noise' }]);
  const report = compareProjects(renderProject(hd), renderProject(patchRecipe(hd, [{ set: 'palette.k', value: '#112233' }]).recipe));
  assert.deepEqual([sha(report.image.sheet.data), report.image.sheet.width, report.image.sheet.height, report.image.sheet.columns], ['611f55ec8ba5c4e3', 3846, 1084, 2]);
  assert.deepEqual(Object.keys(report), ['frames', 'image', 'legend']);
  const mural = inspectProject(renderProject(filled(2560, 1440)));
  assert.deepEqual([sha(mural.sheet.data), mural.sheet.width, mural.sheet.height], ['52da730e252473c3', 2564, 1444]);
});

test('a patch across a still wider than 2048 shows before above after; up to 2048 wide they stay side by side', () => {
  const wide = filled(2560, 1440), report = compareProjects(renderProject(wide), renderProject(patchRecipe(wide, [{ set: 'palette.k', value: '#112233' }]).recipe));
  assert.deepEqual(report.frames.changed.map(({ frame, pixels, box }) => ({ frame, pixels, box })), [{ frame: 'still', pixels: 2560 * 1440, box: { x: 0, y: 0, w: 2560, h: 1440 } }]);
  const { image } = report, { sheet } = image;
  assert.deepEqual([image.region, image.frames, sheet.columns, sheet.rows, sheet.width, sheet.height], [{ x: 0, y: 0, w: 2560, h: 1440 }, [{ frame: 'still', status: 'changed' }], 1, 2, 2564, 2886]);
  assert.deepEqual([pixel(sheet, 2, 2), pixel(sheet, 2561, 1441), pixel(sheet, 2, 1442), pixel(sheet, 2, 1444), pixel(sheet, 2561, 2883)], [dark, dark, gutter, recoloured, recoloured]);
  assert.match(report.imageNote, /before above after/);
  // 2048 wide: two cells of 2048 make 4096 pixels of frames, so they stay side by side, gutters and all.
  const square = filled(2048, 2048), side = compareProjects(renderProject(square), renderProject(patchRecipe(square, [{ set: 'palette.k', value: '#112233' }]).recipe));
  assert.deepEqual([side.image.sheet.columns, side.image.sheet.rows, side.image.sheet.width, side.image.sheet.height, side.imageNote], [2, 1, 4102, 2052, undefined]);
  assert.deepEqual([pixel(side.image.sheet, 2, 2), pixel(side.image.sheet, 2052, 2)], [dark, recoloured]);
});

test('a comparison too large to draw either way keeps its report and says why there is no image', () => {
  // No valid recipe gets here (a still over 2048 on both sides is over 4,194,304 pixels), but compareProjects takes any
  // two rendered projects, and a missing image must never cost the report.
  const side = 2100, frame = value => ({ name: 'big', duration: 100, data: new Uint8ClampedArray(side * side * 4).fill(value) });
  const project = value => ({ width: side, height: side, palette: {}, animations: {}, frames: [frame(value)] });
  const report = compareProjects(project(255), project(128));
  assert.equal(report.image, undefined);
  assert.deepEqual([report.frames.changed[0].pixels, report.frames.changed[0].box], [side * side, { x: 0, y: 0, w: side, h: side }]);
  assert.match(report.imageNote, /no before\/after image.*4096/);
});

test('MCP renders a 4096-wide still and patches a 2560-wide one', async t => {
  const dir = await temp(t), mcp = session({ directory: path.join(dir, 'out'), root: dir }); await mcp.init();
  try {
    const rendered = await mcp.call('pixel_render', { project: filled(4096, 1024) });
    assert.ok(!rendered.isError, rendered.content[0].text.slice(0, 300));
    assert.equal(JSON.parse(rendered.content[0].text).ok, true);
    const patched = await mcp.call('pixel_patch', { project: filled(2560, 1440), changes: [{ set: 'palette.k', value: '#112233' }] });
    assert.ok(!patched.isError, patched.content[0].text.slice(0, 300));
    const info = JSON.parse(patched.content[0].text);
    assert.deepEqual([info.ok, info.image.region, info.image.scale, patched.content[1].type], [true, { x: 0, y: 0, w: 2560, h: 1440 }, 1, 'image']);
    assert.match(info.imageNote, /before above after/);
  } finally { mcp.input.end(); }
});

// The 2048×2048 rewrite once held an object per candidate match (16.8 million, about 1.9 GB) while charging about
// 56% of the work budget. Candidates now take 8 bytes each, and the pixels and work are what they were.
const runLimited = (recipe, megabytes) => new Promise((resolve, reject) => {
  const code = `const { parentPort, workerData } = require('node:worker_threads');
import(workerData.core).then(({ renderProject }) => { const p = renderProject(workerData.recipe, { stats: true }); parentPort.postMessage({ work: p.work, data: p.frames[0].data }); });`;
  const worker = new Worker(code, { eval: true, workerData: { core: new URL('../src/core.js', import.meta.url).href, recipe }, resourceLimits: { maxOldGenerationSizeMb: megabytes } });
  worker.once('message', message => { resolve(message); worker.terminate(); });
  worker.once('error', reject);
});
test('rewrite on a 2048×2048 still runs in bounded memory with the same pixels and work', async () => {
  const side = 2048, recipe = { version: 1, name: 's', width: side, height: side, palette: { a: '#336699', b: '#ffcc00' }, frames: [{ name: 'f', ops: [
    { op: 'rect', x: 0, y: 0, w: side, h: side, color: 'a' },
    { op: 'rewrite', rules: [{ match: ['aa'], replace: ['ab'] }], rotate: true, mirror: true }] }] };
  const { work, data } = await runLimited(recipe, 256);
  assert.deepEqual([sha(data), work], ['7bf8284e269fafbd', { pixels: 37732352, layerPixels: 0, operations: 2 }]);
});

test('rewrite keeps its order: a mix of rules, turns, chance, limits and steps renders as before', () => {
  const mixed = { version: 1, name: 'mix', width: 96, height: 64, palette: { a: '#336699', b: '#ffcc00', c: '#ff0000', d: '#00ff00' }, frames: [{ name: 'f', ops: [
    { op: 'rect', x: 0, y: 0, w: 96, h: 64, color: 'a' }, { op: 'dither', color: 'b', density: 0.4, pattern: 'noise', seed: 7 }, { op: 'dither', color: 'c', density: 0.15, pattern: 'noise', seed: 3 },
    { op: 'rewrite', rules: [{ match: ['ab', '.a'], replace: ['cd', '..'] }, { match: ['bb'], replace: ['ba'] }, { match: ['c'], replace: ['_'] }], empty: '_', rotate: true, mirror: true, steps: 5, seed: 11 },
    { op: 'rewrite', x: 10, y: 5, w: 60, h: 40, rules: [{ match: ['ab'], replace: ['bb'] }], rotate: true, chance: 0.5, limit: 300, steps: 3, seed: 2 },
    { op: 'rewrite', rules: [{ match: ['a', 'a', 'b'], replace: ['d', '.', 'd'] }], mirror: true, steps: 64 }] }] };
  const project = renderProject(mixed, { stats: true });
  assert.deepEqual([sha(project.frames[0].data), project.work], ['22c5c98c01bd4f18', { pixels: 1341424, layerPixels: 0, operations: 6 }]);
});

test('normals refuse a colour recipe over 256 a side up front, naming the limit', () => {
  const source = recipe => ({ format: 'pixelforge-normals', version: 1, recipe });
  for (const [w, h] of [[300, 40], [40, 300], [4096, 1024]]) {
    assert.throws(() => compileNormals(source(filled(w, h))), error => error instanceof PixelError && error.path === 'normals.recipe' && /at most 256×256/.test(error.message) && error.message.includes(`${w}×${h}`), `${w}×${h}`);
  }
  const edge = compileNormals(source(filled(256, 256)));
  assert.deepEqual([edge.recipe.width, edge.recipe.height, edge.recipe.frames[0].ops[0].rows.length], [256, 256, 256]);
});

test('the schema lets frame pixel corrections reach the far side of a 4096-wide still', async () => {
  const schema = JSON.parse(await readFile(new URL('../schema.json', import.meta.url), 'utf8')), { x, y } = schema.$defs.pixel.properties;
  assert.deepEqual([x.minimum, x.maximum, y.minimum, y.maximum], [0, 4095, 0, 4095]);
  const project = renderProject({ ...still(4096, 1024), frames: [{ name: 'still', pixels: [{ x: 4095, y: 1023, color: 's' }] }] });
  assert.deepEqual([...project.frames[0].data.subarray(-4)], [240, 192, 128, 255]);
  const tall = renderProject({ ...still(1024, 4096), frames: [{ name: 'still', pixels: [{ x: 1023, y: 4095, color: 's' }] }] });
  assert.deepEqual([...tall.frames[0].data.subarray(-4)], [240, 192, 128, 255]);
});

test('the game integration guide shows the atlas the forest spirit actually exports', async () => {
  const guide = await readFile(new URL('../docs/game-integration.md', import.meta.url), 'utf8');
  const shown = JSON.parse(guide.split('## Atlas contract')[1].match(/```json\n([\s\S]*?)```/)[1]);
  const bundle = await createBundle(JSON.parse(await readFile(new URL('../examples/forest-spirit.json', import.meta.url), 'utf8')));
  const atlas = JSON.parse(bundle.files.get('forest-spirit.atlas.json'));
  assert.deepEqual(shown.frames, { rest: atlas.frames.rest });
  assert.deepEqual(shown.animations, atlas.animations);
  for (const [key, value] of Object.entries(shown.meta)) assert.deepEqual(value, atlas.meta[key], `meta.${key}`);
  // The text says idle holds, skips and reorders frames, so it has no tag; bob is one pingpong run.
  assert.deepEqual(atlas.meta.frameTags, [{ name: 'bob', from: 0, to: 2, direction: 'pingpong' }]);
  assert.match(guide, /such as the forest spirit's `idle`, has none/);
});
