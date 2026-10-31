// The GIF reader from test/gif.test.js, shared by the tests that compare an exported GIF with its sheet: a separate,
// plain reading of the GIF89a structure and its LZW stream that shares no code with the encoder.
import assert from 'node:assert/strict';

export function decodeGIF(bytes, { browser = false } = {}) {
  assert.equal(Buffer.from(bytes.subarray(0, 6)).toString('latin1'), 'GIF89a');
  const word = at => bytes[at] | bytes[at + 1] << 8, gif = { width: word(6), height: word(8), loop: null, frames: [] };
  let at = 13, control = null, canvas = Array(gif.width * gif.height).fill('clear');
  const table = flags => { const colors = bytes.subarray(at, at + (3 << (flags & 7) + 1)); at += colors.length; return colors; };
  const blocks = () => { const parts = []; for (let size = bytes[at++]; size; size = bytes[at++]) { parts.push(bytes.subarray(at, at + size)); at += size; } return Buffer.concat(parts); };
  const shared = bytes[10] & 0x80 ? table(bytes[10]) : null;
  gif.shared = Boolean(shared);
  for (let marker = bytes[at++]; marker !== 0x3b; marker = bytes[at++]) {
    if (marker === 0x21) {
      const label = bytes[at++];
      if (label === 0xf9) { assert.equal(bytes[at], 4); control = { disposal: bytes[at + 1] >> 2 & 7, transparent: bytes[at + 1] & 1 ? bytes[at + 4] : null, delay: word(at + 2) * 10 }; at += 5; assert.equal(bytes[at++], 0); }
      else if (label === 0xff) { assert.equal(Buffer.from(bytes.subarray(at + 1, at + 12)).toString('latin1'), 'NETSCAPE2.0'); at += 12; const data = blocks(); assert.equal(data[0], 1); gif.loop = data[1] | data[2] << 8; }
      else assert.fail(`unexpected extension ${label}`);
      continue;
    }
    assert.equal(marker, 0x2c);
    const rect = [word(at), word(at + 2), word(at + 4), word(at + 6)], flags = bytes[at + 8]; at += 9;
    assert.ok(rect[2] && rect[3] && rect[0] + rect[2] <= gif.width && rect[1] + rect[3] <= gif.height, 'frame rectangle inside the canvas');
    const colors = flags & 0x80 ? table(flags) : shared, minimum = bytes[at++], data = blocks(), clear = 1 << minimum, indices = [];
    let size = minimum + 1, buffer = 0, bits = 0, read = 0, dictionary = [], previous = null;
    for (;;) {
      while (bits < size) { buffer |= data[read++] << bits; bits += 8; }
      const code = buffer & (1 << size) - 1; buffer >>>= size; bits -= size;
      if (code === clear) { dictionary = Array.from({ length: clear + 2 }, (_, index) => [index]); size = minimum + 1; previous = null; continue; }
      if (code === clear + 1) break;
      assert.ok(code <= dictionary.length && (previous || code < clear), 'code out of range');
      const entry = code < dictionary.length ? dictionary[code] : [...previous, previous[0]];
      indices.push(...entry);
      if (previous && dictionary.length < 4096) dictionary.push([...previous, entry[0]]);
      if (dictionary.length === 1 << size && size < 12) size++;
      previous = entry;
    }
    assert.equal(read, data.length, 'bytes after the end code'); assert.equal(indices.length, rect[2] * rect[3]);
    const pixels = canvas.slice(), inside = (callback) => { for (let y = 0; y < rect[3]; y++) for (let x = 0; x < rect[2]; x++) callback((rect[1] + y) * gif.width + rect[0] + x, y * rect[2] + x); };
    inside((to, from) => { if (indices[from] !== control.transparent) pixels[to] = Buffer.from(colors.subarray(indices[from] * 3, indices[from] * 3 + 3)).toString('hex'); });
    gif.frames.push({ ...control, local: Boolean(flags & 0x80), colors: colors.length / 3, rect, pixels });
    canvas = pixels.slice();
    if (control.disposal === 2) {
      const background = browser || control.transparent !== null ? 'clear' : Buffer.from(colors.subarray(bytes[11] * 3, bytes[11] * 3 + 3)).toString('hex');
      inside(to => { canvas[to] = background; });
    }
  }
  assert.equal(at, bytes.length);
  return gif;
}
