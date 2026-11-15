import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32 } from '../src/png.js';
import { decodePNG, importPNG } from '../src/import.js';
import { renderProject } from '../src/core.js';
import { encodePNG } from '../src/png.js';
import { createBundle } from '../src/export.js';
import { folderGIF } from '../src/frame-folder.js';
import { startMCP } from '../src/mcp.js';

// PNGs written by hand, so every colour type, bit depth and filter is exercised without another encoder.
const chunk = (type, data = Buffer.alloc(0)) => {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length, 0); bytes.write(type, 4, 'ascii'); bytes.set(data, 8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, bytes.length - 4)), bytes.length - 4);
  return bytes;
};
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
// rows: one array of samples per row. Row y uses filter y % 5.
function png({ type, depth = 8, rows, plte, trns, interlace = 0, before = [], after = [] }) {
  const channels = CHANNELS[type] ?? 1, width = rows[0].length / channels, height = rows.length, bits = channels * depth;
  const stride = Math.ceil(width * bits / 8), bpp = Math.max(1, bits >> 3);
  const packed = rows.map(samples => {
    const row = Buffer.alloc(stride);
    if (depth === 8) row.set(samples);
    else samples.forEach((value, i) => { row[(i * depth) >> 3] |= value << (8 - depth - ((i * depth) & 7)); });
    return row;
  });
  const raw = Buffer.alloc((stride + 1) * height);
  packed.forEach((row, y) => {
    const filter = y % 5, up = packed[y - 1];
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0, b = up ? up[x] : 0, c = up && x >= bpp ? up[x - bpp] : 0;
      const p = a + b - c, paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      raw[y * (stride + 1) + 1 + x] = (row[x] - [0, a, b, (a + b) >> 1, paeth][filter]) & 255;
    }
  });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = depth; ihdr[9] = type; ihdr[12] = interlace;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), ...before,
    ...(plte ? [chunk('PLTE', Buffer.from(plte.flat()))] : []), ...(trns ? [chunk('tRNS', Buffer.from(trns))] : []),
    chunk('IDAT', deflateSync(raw)), ...after, chunk('IEND')]);
}
const rgba = image => Array.from({ length: image.width * image.height }, (_, i) => [...image.data.subarray(i * 4, i * 4 + 4)]);
const grid = (width, height, value) => Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => value(x, y)));

test('indexed PNGs at 1, 2, 4 and 8 bits decode through every filter with tRNS alpha per palette entry', () => {
  for (const depth of [1, 2, 4, 8]) {
    const entries = Math.min(1 << depth, 7), plte = Array.from({ length: entries }, (_, i) => [i * 30, 255 - i * 20, (i * 77) & 255]);
    // Entry 0 is fully transparent with a colour of its own, entry 1 half transparent, the rest opaque (no tRNS value).
    const trns = entries > 2 ? [0, 128] : [0];
    const indices = grid(5, 5, (x, y) => (x * 3 + y) % entries), image = decodePNG(png({ type: 3, depth, rows: indices, plte, trns }));
    assert.deepEqual([image.width, image.height, image.encoding], [5, 5, { colorType: 'indexed', bitDepth: depth, tRNS: true }]);
    assert.deepEqual(rgba(image), indices.flat().map(i => [...plte[i], trns[i] ?? 255]), `${depth}-bit`);
  }
  const opaque = decodePNG(png({ type: 3, depth: 4, rows: [[0, 1, 2]], plte: [[1, 2, 3], [4, 5, 6], [7, 8, 9]] }));
  assert.deepEqual([rgba(opaque), opaque.encoding.tRNS], [[[1, 2, 3, 255], [4, 5, 6, 255], [7, 8, 9, 255]], false]);
});

test('greyscale below 8 bits takes the PNG specification\'s 8-bit values, and a tRNS key makes its sample transparent', () => {
  for (const depth of [1, 2, 4, 8]) {
    const top = (1 << depth) - 1, samples = grid(7, 5, (x, y) => (x + y * 2) % (top + 1)), key = Math.min(1, top);
    const image = decodePNG(png({ type: 0, depth, rows: samples, trns: [0, key] }));
    assert.deepEqual(rgba(image), samples.flat().map(v => { const g = v * 255 / top; return [g, g, g, v === key ? 0 : 255]; }), `${depth}-bit`);
  }
  assert.deepEqual(rgba(decodePNG(png({ type: 0, depth: 4, rows: [[0, 7, 15]] }))), [[0, 0, 0, 255], [0x77, 0x77, 0x77, 255], [255, 255, 255, 255]]);
  assert.deepEqual(rgba(decodePNG(png({ type: 0, depth: 2, rows: [[1, 2]] }))), [[85, 85, 85, 255], [170, 170, 170, 255]]);
});

test('greyscale with alpha and RGB with a tRNS key colour decode exactly', () => {
  const la = decodePNG(png({ type: 4, rows: [[10, 0, 20, 64, 30, 255], [40, 128, 50, 1, 60, 0]] }));
  assert.deepEqual(rgba(la), [[10, 10, 10, 0], [20, 20, 20, 64], [30, 30, 30, 255], [40, 40, 40, 128], [50, 50, 50, 1], [60, 60, 60, 0]]);
  assert.deepEqual(la.encoding, { colorType: 'greyscale with alpha', bitDepth: 8, tRNS: false });
  const keyed = decodePNG(png({ type: 2, rows: [[255, 0, 255, 255, 0, 254, 1, 2, 3]], trns: [0, 255, 0, 0, 0, 255] }));
  assert.deepEqual(rgba(keyed), [[255, 0, 255, 0], [255, 0, 254, 255], [1, 2, 3, 255]]);
});

test('importing an indexed PNG keeps palette alpha and leaves transparent pixels empty, without hidden-RGB corrections', () => {
  const plte = [[255, 0, 255], [32, 48, 64], [255, 0, 0], [200, 220, 255]], trns = [0, 255, 255, 96];
  const rows = [[0, 1, 1, 0], [1, 2, 3, 1], [0, 1, 1, 0]], bytes = png({ type: 3, depth: 2, rows, plte, trns });
  const { recipe, provenance } = importPNG(bytes, { name: 'keyed' });
  assert.deepEqual(recipe.frames[0].ops, [{ op: 'grid', rows: ['.aa.', 'abca', '.aa.'] }]);
  assert.equal(recipe.frames[0].pixels, undefined);
  assert.deepEqual(recipe.palette, { a: '#203040ff', b: '#ff0000ff', c: '#c8dcff60' });
  assert.deepEqual([provenance.encoding, provenance.lossless, typeof provenance.hiddenRGB], [{ colorType: 'indexed', bitDepth: 2, tRNS: true }, true, 'string']);
  // Every visible colour and every alpha comes back; the magenta under alpha zero belonged to the palette entry.
  const drawn = renderProject(recipe).frames[0].data, decoded = decodePNG(bytes).data;
  for (let i = 0; i < drawn.length; i += 4) assert.deepEqual([...drawn.subarray(i, i + 4)], decoded[i + 3] ? [...decoded.subarray(i, i + 4)] : [0, 0, 0, 0]);
  // A per-pixel alpha channel still keeps its hidden grey, as RGBA keeps hidden RGB.
  const la = importPNG(png({ type: 4, rows: [[9, 0, 200, 255]] }));
  assert.deepEqual([la.recipe.frames[0].pixels, la.provenance.hiddenRGB], [[{ x: 0, y: 0, color: '#09090900' }], undefined]);
});

test('malformed or unsupported PNGs fail with the reason', () => {
  const plte = [[0, 0, 0], [255, 255, 255]];
  const cases = [
    [png({ type: 3, depth: 2, rows: [[0, 2]], plte }), /palette entry 2, but PLTE has 2/],
    [png({ type: 3, rows: [[0]] }), /needs a PLTE/],
    [png({ type: 3, rows: [[0]], plte, trns: [0, 0, 0] }), /3 alpha values, but PLTE has 2/],
    [png({ type: 6, rows: [[0, 0, 0, 0]], trns: [0, 0] }), /not allowed in a PNG with an alpha channel/],
    [png({ type: 4, rows: [[0, 0]], trns: [0, 0] }), /not allowed in a PNG with an alpha channel/],
    [png({ type: 0, rows: [[0]], plte }), /not allowed in a greyscale PNG/],
    [png({ type: 0, depth: 4, rows: [[0]], trns: [0, 16] }), /invalid tRNS/],
    [png({ type: 2, rows: [[0, 0, 0]], trns: [0, 0] }), /invalid tRNS/],
    [png({ type: 3, rows: [[0]], plte, after: [chunk('tRNS', Buffer.from([0]))] }), /tRNS must come once, before the image data/],
    [png({ type: 3, rows: [[0]], plte, before: [chunk('PLTE', Buffer.from([1, 2, 3]))] }), /PLTE must come once/],
    [png({ type: 0, depth: 16, rows: [[0, 0]] }), /16-bit greyscale PNG is unsupported/],
    [png({ type: 6, depth: 16, rows: [[0, 0, 0, 0, 0, 0, 0, 0]] }), /16-bit RGBA PNG is unsupported/],
    [png({ type: 2, depth: 4, rows: [[0, 0, 0]] }), /invalid IHDR/],
    [png({ type: 3, depth: 16, rows: [[0]], plte }), /invalid IHDR/],
    [png({ type: 5, rows: [[0]] }), /invalid IHDR/],
    [png({ type: 6, rows: [[0, 0, 0, 0]], interlace: 1 }), /interlaced PNG is unsupported/],
  ];
  for (const [bytes, message] of cases) assert.throws(() => decodePNG(bytes), message);
});

test('gif-frames reads indexed and greyscale frames', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pixelbolt-indexed-'));
  try {
    const plte = [[255, 0, 0], [0, 0, 255]];
    await writeFile(path.join(directory, 'f_0001.png'), png({ type: 3, depth: 1, rows: [[0, 1], [1, 0]], plte, trns: [0] }));
    await writeFile(path.join(directory, 'f_0002.png'), png({ type: 0, depth: 8, rows: [[0, 255], [255, 0]] }));
    const gif = folderGIF(directory, { fps: 10 });
    assert.deepEqual([gif.frames, gif.width, gif.height, gif.transparent, gif.colors], [2, 2, 2, true, 3]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a sheet with no atlas imports by the size of one frame: every drawn cell in reading order, pixel for pixel', async () => {
  const { readFile } = await import('node:fs/promises');
  const coin = JSON.parse(await readFile(new URL('../examples/coin.json', import.meta.url), 'utf8')), project = renderProject(coin);
  // The sheet Pixelbolt itself writes has a border of one pixel round each frame; it is found without being given.
  const sheet = (await createBundle(coin)).files.get('coin.png'), made = importPNG(sheet, { name: 'coin', frame: [project.width, project.height] }).recipe;
  const back = renderProject(made);
  assert.deepEqual([back.width, back.height, back.frames.map(frame => frame.name)], [project.width, project.height, project.frames.map((_, index) => `coin-${index}`)]);
  back.frames.forEach((frame, index) => assert.deepEqual(frame.data, project.frames[index].data, `frame ${index}`));
  // No animation is written, so a frame added later plays with the rest.
  assert.equal(made.animations, undefined);
  // Frames flush to each other in two rows, the last cell empty: three frames, and a stated padding of 0.
  const data = new Uint8ClampedArray(4 * 4 * 4);
  for (const [x, y, color] of [[0, 0, [255, 0, 0, 255]], [3, 1, [0, 255, 0, 255]], [1, 2, [0, 0, 255, 255]]]) data.set(color, (y * 4 + x) * 4);
  const grid = importPNG(encodePNG(data, 4, 4), { name: 'dots', frame: [2, 2], padding: 0 }).recipe;
  assert.deepEqual(renderProject(grid).frames.map(frame => [frame.name, [...frame.data].filter(Boolean).length]), [['dots-0', 2], ['dots-1', 2], ['dots-2', 2]]);
  // What does not fit says so, and frame and atlas are one or the other.
  assert.throws(() => importPNG(sheet, { frame: [25, 24] }), /frame: frames of 25×24 with a border of 0 to 8 pixels do not tile the 156×26 image; give the padding its sheet has, or its atlas/);
  assert.throws(() => importPNG(sheet, { frame: [24, 24], padding: 0 }), /frames of 24×24 with a border of 0 do not tile/);
  assert.throws(() => importPNG(sheet, { frame: [24, 24], atlas: { frames: {} } }), /an atlas already says where the frames are/);
  assert.throws(() => importPNG(sheet, { padding: 1 }), /padding: goes with frame/);
  assert.throws(() => importPNG(sheet, { frame: [0, 24] }), /frame: expected the size of one frame/);
});

// Synthetic Aseprite sheets: one coloured pixel in each 8×8 cell, with the rest transparent.
function atlasPNG(names) {
  const width = names.length * 8, data = new Uint8ClampedArray(width * 8 * 4);
  const frames = names.map((filename, i) => { data.set([i + 1, 40, 80, 255], i * 8 * 4); return { filename, frame: { x: i * 8, y: 0, w: 8, h: 8 }, duration: 33 }; });
  return { bytes: encodePNG(data, width, 8), atlas: { frames } };
}
function sparseSheet() {
  const data = new Uint8ClampedArray(4 * 4 * 4);
  data.set([255, 0, 0, 255], 0); data.set([0, 0, 255, 255], 2 * 4 * 4);
  return encodePNG(data, 4, 4); // A 2×2 grid: drawn, empty, drawn, empty.
}

test('Aseprite array atlases keep 33 ms frames and turn frameTags into animations', () => {
  const { bytes, atlas } = atlasPNG(['x 0', 'x 1']);
  atlas.meta = { frameTags: [{ name: 'torch loop', from: 0, to: 1 }] };
  const { recipe } = importPNG(bytes, { atlas }), drawn = renderProject(recipe);
  assert.deepEqual(recipe.frames.map(({ name, duration }) => [name, duration]), [['x-0', 33], ['x-1', 33]]);
  assert.deepEqual(recipe.animations, { 'torch-loop': { frames: ['x-0', 'x-1'], loop: true } });
  assert.deepEqual(drawn.frames.map(frame => [...frame.data.slice(0, 4)]), [[1, 40, 80, 255], [2, 40, 80, 255]]);
  assert.equal(drawn.animations['torch-loop'].duration, 66);
});

test('hash atlas filenames lose one extension and import without adding animations', () => {
  const { bytes, atlas } = atlasPNG(['torch 0.aseprite']);
  atlas.frames = Object.fromEntries(atlas.frames.map(entry => [entry.filename, entry]));
  const { recipe } = importPNG(bytes, { atlas });
  assert.equal(recipe.frames[0].name, 'torch-0');
  assert.equal(recipe.frames[0].duration, 33);
  assert.equal(Object.hasOwn(recipe, 'animations'), false);
  assert.equal(renderProject(recipe).frames.length, 1);
});

test('atlas names become portable and unique in order, preserving already valid names', () => {
  const names = ['torch 0', 'torch 0.aseprite', '0', '9lives', 'con', 'NUL.png', 'a/b\\c', 'émoji ✨', '   ', '', 'a'.repeat(100), 'Case', 'case', '__x__', 'already-valid_1', 'a'.repeat(99), 'valid__', 'x.png.ase', 'x.123456789', 'z'.repeat(63) + '-more', 'walk.1', 'walk.2', 'v1.2b'];
  const { bytes, atlas } = atlasPNG(names), { recipe } = importPNG(bytes, { atlas });
  assert.deepEqual(recipe.frames.map(frame => frame.name), ['torch-0', 'torch-0-2', 'frame-0', 'frame-9lives', 'con-frame', 'NUL-frame', 'a-b-c', 'moji', 'frame', 'frame-2', 'a'.repeat(64), 'Case', 'case-2', 'x', 'already-valid_1', 'a'.repeat(62) + '-2', 'valid__', 'x-png', 'x-123456789', 'z'.repeat(63), 'walk-1', 'walk-2', 'v1']);
  assert.equal(renderProject(recipe).frames.length, names.length);
  // Hash atlases follow Object.entries order too, including integer keys before the other keys.
  atlas.frames = Object.fromEntries(atlas.frames.map(entry => [entry.filename, entry]));
  const hashed = importPNG(bytes, { atlas }).recipe;
  assert.deepEqual(hashed.frames.map(frame => frame.name), ['frame-0', 'torch-0', 'torch-0-2', ...recipe.frames.slice(3).map(frame => frame.name)]);
  assert.equal(renderProject(hashed).frames.length, names.length);
});

test('an atlas with Pixelbolt-style animations follows the frames whose names were repaired', () => {
  // A packer's hash with spaces in its names and an animations table that lists them as written.
  const { bytes, atlas } = atlasPNG(['walk 0', 'walk 1', 'rest']);
  atlas.frames = Object.fromEntries(atlas.frames.map(entry => [entry.filename, entry]));
  atlas.animations = { walk: { frames: ['walk 0', 'walk 1', 'walk 0'], loop: false }, idle: { frames: ['rest'] } };
  const { recipe } = importPNG(bytes, { atlas });
  assert.deepEqual(recipe.animations, { walk: { frames: ['walk-0', 'walk-1', 'walk-0'], loop: false }, idle: { frames: ['rest'], loop: true } });
  assert.deepEqual(renderProject(recipe).animations.walk.frames, [0, 1, 0]);
});

test('every reserved filename is repaired before case-insensitive collision suffixes', () => {
  const names = ['con', 'PRN', 'aux', 'NuL', ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`), ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`), 'con-frame', 'CON', 'com0', 'lpt10'];
  const { bytes, atlas } = atlasPNG(names), { recipe } = importPNG(bytes, { atlas });
  assert.deepEqual(recipe.frames.map(frame => frame.name), [...names.slice(0, 22).map(name => `${name}-frame`), 'con-frame-2', 'CON-frame-3', 'com0', 'lpt10']);
  assert.equal(renderProject(recipe).frames.length, names.length);
});

test('array atlas filename errors name the entry, and rectangle restrictions still apply', () => {
  const { bytes, atlas } = atlasPNG(['a', 'b', 'c', 'd']);
  for (const filename of [undefined, null, 3, {}]) {
    const bad = structuredClone(atlas); bad.frames[3].filename = filename;
    assert.throws(() => importPNG(bytes, { atlas: bad }), /atlas\.frames\[3\]\.filename: expected the frame's name/);
  }
  for (const change of [{ rotated: true }, { trimmed: true }, { frame: { x: 0, y: 0, w: 7, h: 8 } }, { frame: { x: 32, y: 0, w: 8, h: 8 } }]) {
    const bad = structuredClone(atlas); Object.assign(bad.frames[1], change);
    assert.throws(() => importPNG(bytes, { atlas: bad }), /equal-size, untrimmed, unrotated rectangles inside the PNG/);
  }
});

test('frameTags preserve ranges and forward, reverse and recipe pingpong playback', () => {
  const { bytes, atlas } = atlasPNG(['a', 'b', 'c', 'd']);
  atlas.meta = { frameTags: [{ name: 'run 0', from: 1, to: 3, direction: 'forward' }, { name: 'run 0.ase', from: 1, to: 3, direction: 'reverse' }, { name: 'CON', from: 1, to: 3, direction: 'pingpong' }] };
  const { recipe } = importPNG(bytes, { atlas });
  assert.deepEqual(recipe.animations, { 'run-0': { frames: ['b', 'c', 'd'], loop: true }, 'run-0-2': { frames: ['d', 'c', 'b'], loop: true }, 'CON-frame': { frames: ['b', 'c', 'd'], direction: 'pingpong', loop: true } });
  assert.deepEqual(Object.values(renderProject(recipe).animations).map(animation => animation.frames), [[1, 2, 3], [3, 2, 1], [1, 2, 3, 2]]);
});

test('invalid frameTags refuse the offending path and unsupported direction plainly', () => {
  const { bytes, atlas } = atlasPNG(['a', 'b']);
  atlas.frames = Object.fromEntries(atlas.frames.map(entry => [entry.filename, entry]));
  for (const [change, message] of [
    [{ name: 3 }, /atlas\.meta\.frameTags\[0\]\.name: expected the animation's name/],
    [{ from: 1, to: 0 }, /atlas\.meta\.frameTags\[0\]\.from: expected.*to/],
    [{ to: 2 }, /atlas\.meta\.frameTags\[0\]\.to: expected.*0.*1/],
    [{ from: -1 }, /atlas\.meta\.frameTags\[0\]\.from: expected.*0.*1/],
    [{ from: 0.5 }, /atlas\.meta\.frameTags\[0\]\.from: expected.*whole number/],
    [{ to: '1' }, /atlas\.meta\.frameTags\[0\]\.to: expected.*whole number/],
    ...['pingpong_reverse', 'other', null].map(direction => [{ direction }, `atlas.meta.frameTags[0].direction: ${JSON.stringify(direction)} is not supported; use forward, reverse or pingpong`])
  ]) {
    const bad = { ...atlas, meta: { frameTags: [{ name: 'run', from: 0, to: 1, ...change }] } };
    assert.throws(() => importPNG(bytes, { atlas: bad }), typeof message === 'string' ? error => error.message.endsWith(message) : message);
  }
});

test('pixelfx loop and inclusive whole-pixel pivot survive, ignoring other third-party fields', () => {
  const { bytes, atlas } = atlasPNG(['a', 'b']);
  atlas.meta = { frameTags: [{ name: 'once', from: 0, to: 1 }], pixelfx: { fps: 99, frames: 200, frameSize: [1, 1], loop: false, pivot: [8, 0] } };
  const { recipe } = importPNG(bytes, { name: 'effect', atlas });
  assert.deepEqual(recipe.anchor, [8, 0]);
  assert.deepEqual(recipe.animations, { once: { frames: ['a', 'b'], loop: false } });
  assert.deepEqual(recipe.frames.map(frame => frame.duration), [33, 33]);
  delete atlas.meta.frameTags;
  assert.deepEqual(importPNG(bytes, { name: 'effect', atlas }).recipe.animations, { effect: { frames: ['a', 'b'], loop: false } });
  atlas.meta.frameTags = [];
  assert.deepEqual(importPNG(bytes, { name: 'effect', atlas }).recipe.animations, { effect: { frames: ['a', 'b'], loop: false } });
});

test('invalid pixelfx loop and pivot are ignored while tags still import', () => {
  const { bytes, atlas } = atlasPNG(['a', 'b']);
  for (const loop of ['no', 0, null, {}, true]) for (const pivot of [[9, 0], [0, -1], [1.5, 2], ['1', 2], [1], [1, 2, 3], Array(2), 'center', null]) {
    atlas.meta = { frameTags: [{ name: 'run', from: 0, to: 1 }], pixelfx: { loop, pivot } };
    const { recipe } = importPNG(bytes, { atlas });
    assert.deepEqual(recipe.animations, { run: { frames: ['a', 'b'], loop: true } });
    assert.equal(Object.hasOwn(recipe, 'anchor'), false);
    delete atlas.meta.frameTags;
    assert.equal(Object.hasOwn(importPNG(bytes, { atlas }).recipe, 'animations'), false);
  }
});

test('Pixelbolt animations win unchanged over tags and pixelfx loop, with pivot still imported', () => {
  const { bytes, atlas } = atlasPNG(['a', 'b']);
  atlas.frames = Object.fromEntries(atlas.frames.map(entry => [entry.filename, entry]));
  atlas.animations = { native: { frames: ['b', 'a', 'b'], loop: true } };
  const before = importPNG(bytes, { atlas }).recipe;
  atlas.meta = { frameTags: [{ name: 3, from: 99 }], pixelfx: { loop: false, pivot: [4, 8] } };
  assert.deepEqual(importPNG(bytes, { atlas }).recipe, { ...before, anchor: [4, 8] });
});

test('grid import reports omitted empty cells and can retain exactly the first N cells', () => {
  const bytes = sparseSheet(), options = { name: 'effect', frame: [2, 2] }, imported = importPNG(bytes, options);
  assert.deepEqual(imported.provenance.grid, { cells: 4, kept: 2, empty: 2 });
  assert.equal(imported.recipe.frames.length, 2);
  const kept = importPNG(bytes, { ...options, frames: 4 });
  assert.equal(kept.recipe.frames.length, 4);
  assert.equal(kept.provenance.grid, undefined);
  const drawn = renderProject(kept.recipe).frames;
  assert.deepEqual(drawn.map(frame => frame.name), ['effect-0', 'effect-1', 'effect-2', 'effect-3']);
  assert.deepEqual(drawn[1].data, new Uint8ClampedArray(16));
  assert.deepEqual(drawn[3].data, new Uint8ClampedArray(16));
  assert.deepEqual(renderProject(importPNG(bytes, { ...options, frames: 2 }).recipe).frames, drawn.slice(0, 2));
  assert.throws(() => importPNG(bytes, { ...options, frames: 5 }), /frames:.*sheet has 4 cells/);
  for (const frames of [0, 257, 1.5, '4', null]) assert.throws(() => importPNG(bytes, { ...options, frames }), /frames: expected.*1.*256/);
  assert.throws(() => importPNG(bytes, { frames: 4 }), /frames: goes with frame/);
  assert.throws(() => importPNG(bytes, { frames: 4, atlas: { frames: {} } }), /frames:.*atlas/);
  assert.throws(() => importPNG(bytes, { ...options, frames: 4, atlas: { frames: {} } }), /frames:.*atlas/);
});

test('exact RGBA imports omit only plain transparency, render identically and keep empty frames', () => {
  const width = 20, height = 20, data = new Uint8ClampedArray(width * height * 2 * 4);
  for (let i = 0; i < 257; i++) data.set([i & 255, i >> 8, 70, 255], i * 4);
  data.set([12, 34, 56, 0], 257 * 4);
  const atlas = { frames: { color: { frame: { x: 0, y: 0, w: width, h: height } }, empty: { frame: { x: 0, y: height, w: width, h: height } } } };
  const { recipe, provenance } = importPNG(encodePNG(data, width, height * 2), { atlas });
  assert.equal(provenance.representation, 'exact RGBA pixels');
  assert.equal(recipe.frames[0].pixels.length, 258);
  assert.deepEqual(recipe.frames[0].pixels.at(-1), { x: 17, y: 12, color: '#0c223800' });
  assert.deepEqual(recipe.frames[1].pixels, []);
  const legacy = { ...recipe, frames: recipe.frames.map((frame, index) => ({ ...frame, pixels: Array.from({ length: width * height }, (_, i) => ({ x: i % width, y: Math.floor(i / width), color: '#' + [...data.slice((index * width * height + i) * 4, (index * width * height + i + 1) * 4)].map(v => v.toString(16).padStart(2, '0')).join('') })) })) };
  const drawn = renderProject(recipe), before = renderProject(legacy);
  assert.deepEqual(drawn.frames, before.frames);
  drawn.frames.forEach((frame, i) => assert.deepEqual(frame.data, data.slice(i * width * height * 4, (i + 1) * width * height * 4)));
});

test('CLI import reports grid omissions once, accepts --frames and refuses it with --embedded', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pixelbolt-import-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'sheet.png'), out = path.join(directory, 'recipe.json');
  await writeFile(file, sparseSheet());
  const cli = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL('../bin/pixelbolt.js', import.meta.url)), 'import', file, '--out', out, ...args], { encoding: 'utf8' });
  const result = cli('--frame', '2x2'), note = '2 of 4 cells are empty and were left out; frames N (--frames N) keeps the first N cells, empty ones included (4 keeps them all)';
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).notes, [note]);
  assert.equal(result.stdout.split(note).length, 2);
  const kept = cli('--frame', '2x2', '--frames', '4', '--force');
  assert.equal(kept.status, 0, kept.stderr);
  assert.equal(Object.hasOwn(JSON.parse(kept.stdout), 'notes'), false);
  assert.equal(JSON.parse(await readFile(out, 'utf8')).frames.length, 4);
  const refused = cli('--embedded', '--frames', '4');
  assert.equal(refused.status, 1);
  assert.match(JSON.parse(refused.stderr).error, /--frames cannot be combined with --embedded/);
});

test('MCP pixel_import reports grid omissions once and keeps blank cells with frames', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pixelbolt-import-mcp-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = new PassThrough(), output = new PassThrough(), waiting = new Map();
  let buffer = '', next = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)?.(message); waiting.delete(message.id); } });
  const running = startMCP({ input, output, directory });
  t.after(async () => { input.end(); await running; });
  const request = (method, params) => new Promise(resolve => { waiting.set(++next, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n'); });
  await request('initialize', { protocolVersion: '2025-11-25' });
  const call = async args => {
    const { result } = await request('tools/call', { name: 'pixel_import', arguments: { data: sparseSheet().toString('base64'), name: 'effect', frame: '2x2', ...args } });
    assert.ok(!result.isError, JSON.stringify(result)); return JSON.parse(result.content[0].text);
  };
  const imported = await call({}), note = '2 of 4 cells are empty and were left out; frames N (--frames N) keeps the first N cells, empty ones included (4 keeps them all)';
  assert.deepEqual(imported.provenance.grid, { cells: 4, kept: 2, empty: 2 });
  assert.deepEqual(imported.notes, [note]);
  assert.equal(JSON.stringify(imported).split(note).length, 2);
  const kept = await call({ frames: 4 });
  assert.equal(kept.frames, 4);
  assert.equal(Object.hasOwn(kept, 'notes'), false);
});
