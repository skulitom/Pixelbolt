import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crc32 } from '../src/png.js';
import { decodePNG, importPNG } from '../src/import.js';
import { renderProject } from '../src/core.js';
import { folderGIF } from '../src/frame-folder.js';

// PNGs written by hand, so every colour type, bit depth and filter is exercised without another encoder.
const chunk = (type, data = Buffer.alloc(0)) => {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length, 0); bytes.write(type, 4, 'ascii'); bytes.set(data, 8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, bytes.length - 4)), bytes.length - 4);
  return bytes;
};
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
// rows: one array of samples per row. Row y uses filter y % 5 unless `filters` says otherwise.
function png({ type, depth = 8, rows, plte, trns, interlace = 0, filters, before = [], after = [] }) {
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
    const filter = filters ? filters[y] : y % 5, up = packed[y - 1];
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
