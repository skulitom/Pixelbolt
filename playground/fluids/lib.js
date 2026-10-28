// The live fluid toy's logic, without the page: its effects, the pokes it records, and links that replay them.
// Browser-compatible with no static imports, so Node tests run exactly what the page runs.
//
// A link names the engine version, the effect and, optionally, what was done to it:
//   https://skulitom.github.io/Pixelbolt/playground/fluids/#v=<engine version>&p=<effect>&i=<base64url of deflate(pokes)>
// The engine gives the same pixels for the same calls in every browser, so replaying the pokes on the same frames
// redraws exactly what the sender saw.

// The engine release the toy loads by default. Keep it equal to the playground's PINNED_VERSION (a test checks).
export const TOY_VERSION = '0.9.1';
// Longest link, as for playground share links.
export const LINK_LIMIT = 16384;
// Pokes are recorded for this many frames after a start (about two minutes at 60–70 ms a frame); a link replays them.
export const RECORD_FRAMES = 1800;
// At most this many pokes are recorded: a push and a puff on every frame, with room to spare.
export const MAX_POKES = 4096;
// The GIF holds about this many milliseconds: the last few seconds before the button was pressed.
export const GIF_MS = 4000;
// The stage colour behind the effects. Saved GIFs are blended onto it, so smoke and glows look as they do on the page.
export const STAGE = [21, 22, 31];

// The effects on offer: each keeps working however long it is poked. `spot` is where the keyboard pours or adds heat,
// as a share of the width and height; `hint` says what dragging and holding do.
export const PRESETS = [
  { id: 'campfire', title: 'Campfire', file: 'campfire.fluid.json', hint: 'Drag to blow on the fire. Hold to stoke it.', spot: [0.5, 0.8] },
  { id: 'honey', title: 'Honey', file: 'honey.fluid.json', hint: 'Hold to pour honey. Drag to stir it.', spot: [0.5, 0.35] },
  { id: 'slime', title: 'Slime', file: 'slime.fluid.json', hint: 'Hold to pour slime. Drag to shove it.', spot: [0.5, 0.25] },
  { id: 'waterfall', title: 'Waterfall', file: 'waterfall.fluid.json', hint: 'Drag to push the water. Hold to pour more.', spot: [0.65, 0.25] },
  { id: 'potion', title: 'Potion', file: 'potion.fluid.json', hint: 'Drag to slosh the potion. Hold to top it up.', spot: [0.5, 0.15] },
  { id: 'magic-swirl', title: 'Magic swirl', file: 'magic-swirl.fluid.json', hint: 'Drag to stir the magic. Hold to add more.', spot: [0.5, 0.5] },
  { id: 'steam-vent', title: 'Steam', file: 'steam-vent.fluid.json', hint: 'Drag to blow the steam about. Hold to add more.', spot: [0.5, 0.85] }
];
export const presetById = id => PRESETS.find(preset => preset.id === id);

export class ToyError extends Error {
  constructor(message) { super(message); this.name = 'ToyError'; }
}
const fail = message => { throw new ToyError(message); };

// A published engine version, as the playground accepts them: x.y.z, 0.9.1 or newer (the first with live fluids).
export function checkToyVersion(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/.test(version)) fail('The engine version must look like 0.9.1.');
  const [major, minor, patch] = version.split('.').map(Number);
  if ((major - 0 || minor - 9 || patch - 1) < 0) fail(`Pixelbolt ${version} is older than live fluids (0.9.1 or newer).`);
  return version;
}

// Pokes. Each is stored in whole numbers so that a link replays exactly the calls that were made: positions and radii
// in quarter pixels, push speeds in eighths of a pixel per frame, puff amounts in hundredths.
//   op 0, push:        a = vx × 8, b = vy × 8
//   op 1, gas puff:    a = density × 100, b = temperature × 100
//   op 2, liquid puff: a = density × 100 (a liquid puff takes no temperature)
const RANGES = { x: [-1024, 2048], y: [-1024, 2048], r: [2, 256], 0: [[-128, 128], [-128, 128]], 1: [[-1600, 1600], [-1600, 1600]], 2: [[-100, 100], [0, 0]] };
// `+ 0` turns -0 (from rounding a small negative) into 0, which is what a link reads back.
const within = (value, [low, high]) => Math.min(high, Math.max(low, value)) + 0;
const finite = value => (Number.isFinite(value) ? value : 0);

export function pushPoke({ x, y, vx, vy, radius }) {
  return { op: 0, x: within(Math.round(finite(x) * 4), RANGES.x), y: within(Math.round(finite(y) * 4), RANGES.y), r: within(Math.round(finite(radius) * 4), RANGES.r),
    a: within(Math.round(finite(vx) * 8), RANGES[0][0]), b: within(Math.round(finite(vy) * 8), RANGES[0][1]) };
}
export function puffPoke({ x, y, radius, density, temperature = 0 }, kind) {
  const op = kind === 'liquid' ? 2 : 1;
  return { op, x: within(Math.round(finite(x) * 4), RANGES.x), y: within(Math.round(finite(y) * 4), RANGES.y), r: within(Math.round(finite(radius) * 4), RANGES.r),
    a: within(Math.round(finite(density) * 100), RANGES[op][0]), b: op === 2 ? 0 : within(Math.round(finite(temperature) * 100), RANGES[op][1]) };
}
// The live runner call a poke makes.
export function applyPoke(live, poke) {
  const spot = { x: poke.x / 4, y: poke.y / 4, radius: poke.r / 4 };
  if (poke.op === 0) live.push({ ...spot, vx: poke.a / 8, vy: poke.b / 8 });
  else if (poke.op === 1) live.puff({ ...spot, density: poke.a / 100, temperature: poke.b / 100 });
  else live.puff({ ...spot, density: poke.a / 100 });
  return live;
}

// Runs `frames` frames of a live runner from frame `from` (counted from its start), making each recorded poke on its
// frame first. The page does the same one frame at a time; tests use it to check that a link replays exactly.
export function replay(live, pokes, from, frames) {
  let at = pokes.findIndex(poke => poke.f >= from);
  if (at < 0) at = pokes.length;
  for (let t = from; t < from + frames; t++) {
    while (at < pokes.length && pokes[at].f === t) applyPoke(live, pokes[at++]);
    live.step();
  }
  return live;
}

// The binary form of a recording: format byte 1, the recorded frames, the number of pokes, then per poke the frames
// since the last one, its op, its position as a step from the last, its radius and its amounts. Then deflate.
const FORMAT = 1;
function varint(out, value) {
  for (;;) { if (value < 128) { out.push(value); return; } out.push(value & 127 | 128); value = Math.floor(value / 128); }
}
const zigzag = value => (value < 0 ? -2 * value - 1 : 2 * value);
function reader(bytes) {
  let at = 0;
  const damaged = () => fail('This link is damaged: its pokes do not read back.');
  return {
    get done() { return at === bytes.length; },
    byte() { if (at >= bytes.length) damaged(); return bytes[at++]; },
    varint() {
      let value = 0, scale = 1;
      for (let n = 0; n < 5; n++) { const byte = this.byte(); value += (byte & 127) * scale; if (byte < 128) return value; scale *= 128; }
      return damaged();
    },
    signed() { const value = this.varint(); return value % 2 ? -(value + 1) / 2 : value / 2; }
  };
}
export function packPokes(pokes, frames) {
  const out = [FORMAT];
  varint(out, frames); varint(out, pokes.length);
  let f = 0, x = 0, y = 0;
  for (const poke of pokes) {
    varint(out, poke.f - f); out.push(poke.op);
    varint(out, zigzag(poke.x - x)); varint(out, zigzag(poke.y - y)); varint(out, poke.r);
    varint(out, zigzag(poke.a)); if (poke.op !== 2) varint(out, zigzag(poke.b));
    ({ f, x, y } = poke);
  }
  return new Uint8Array(out);
}
export function unpackPokes(bytes) {
  const read = reader(bytes);
  if (read.byte() !== FORMAT) fail('This link was made by a newer toy. Open it on the newest page.');
  const frames = read.varint(), count = read.varint();
  if (frames > RECORD_FRAMES) fail(`This link records more than ${RECORD_FRAMES} frames.`);
  if (count > MAX_POKES) fail(`This link records more than ${MAX_POKES} pokes.`);
  const pokes = [];
  let f = 0, x = 0, y = 0;
  for (let n = 0; n < count; n++) {
    f += read.varint(); const op = read.byte();
    x += read.signed(); y += read.signed();
    const r = read.varint(), a = read.signed(), b = op === 2 ? 0 : read.signed();
    if (!(op in RANGES) || f >= frames) fail('This link is damaged: a poke is outside the recording.');
    const inside = (value, range) => value >= range[0] && value <= range[1];
    if (![[x, RANGES.x], [y, RANGES.y], [r, RANGES.r], [a, RANGES[op][0]], [b, RANGES[op][1]]].every(([value, range]) => inside(value, range))) fail('This link is damaged: a poke is out of range.');
    pokes.push({ f, op, x, y, r, a, b });
  }
  if (!read.done) fail('This link is damaged: it has bytes after its pokes.');
  return { frames, pokes };
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function toBase64url(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = bytes[i] << 16 | (bytes[i + 1] ?? 0) << 8 | (bytes[i + 2] ?? 0);
    out += ALPHABET[n >> 18 & 63] + ALPHABET[n >> 12 & 63] + (i + 1 < bytes.length ? ALPHABET[n >> 6 & 63] : '') + (i + 2 < bytes.length ? ALPHABET[n & 63] : '');
  }
  return out;
}
export function fromBase64url(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) fail('This link is damaged: its pokes are not base64url.');
  const out = new Uint8Array(Math.floor(text.length * 3 / 4));
  let bits = 0, value = 0, offset = 0;
  for (const char of text) {
    value = (value << 6 | ALPHABET.indexOf(char)) & 0xffffff; bits += 6;
    if (bits >= 8) { bits -= 8; out[offset++] = value >> bits & 255; }
  }
  return out;
}
// Plain deflate (zlib) streams, which every browser with CompressionStream and Node 20 both support.
async function pipe(bytes, transform, limit) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform), chunks = [], read = stream.getReader();
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await read.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await read.cancel().catch(() => {}); fail('This link is damaged: its pokes unpack too large.'); }
      chunks.push(value);
    }
  } catch (error) { if (error instanceof ToyError) throw error; fail('This link is damaged: its pokes do not unpack.'); }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
  return out;
}
const UNPACKED_LIMIT = 16 + MAX_POKES * 32;

// The link for an effect and what was done to it. With no pokes it only names the effect.
export async function toyLink(base, { version = TOY_VERSION, preset, frames = 0, pokes = [] }) {
  checkToyVersion(version);
  if (!presetById(preset)) fail(`There is no effect called ${preset}.`);
  const params = [`v=${version}`, `p=${preset}`];
  if (pokes.length) params.push(`i=${toBase64url(await pipe(packPokes(pokes, frames), new CompressionStream('deflate'), Infinity))}`);
  return `${base}#${params.join('&')}`;
}
// The longest recording that still fits a link: the pokes up to some frame, and that many frames. Returns the link,
// the frames it replays and whether it had to stop short of `frames`.
export async function fitLink(base, { version, preset, frames, pokes }, limit = LINK_LIMIT) {
  let link = await toyLink(base, { version, preset, frames, pokes });
  if (link.length <= limit) return { link, frames, cut: false };
  // Keep the most pokes that fit, and replay up to the frame of the first one left out.
  let low = 0, high = pokes.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2), kept = pokes.slice(0, middle), end = pokes[middle].f;
    if ((await toyLink(base, { version, preset, frames: end, pokes: kept })).length <= limit) low = middle; else high = middle - 1;
  }
  const end = pokes[low].f;
  link = await toyLink(base, { version, preset, frames: end, pokes: pokes.slice(0, low) });
  return { link, frames: end, cut: true };
}
// Reads a link or its fragment. Returns { version, preset, frames, pokes }; a link that names only the effect has none.
export async function readToyLink(link, limit = LINK_LIMIT) {
  if (typeof link !== 'string') fail('A link must be text.');
  if (link.length > limit) fail(`The link is ${link.length.toLocaleString('en')} characters long, over the ${limit.toLocaleString('en')}-character limit.`);
  const hash = link.indexOf('#'), params = new URLSearchParams(hash >= 0 ? link.slice(hash + 1) : link);
  const version = checkToyVersion(params.get('v') ?? TOY_VERSION), preset = params.get('p');
  if (!presetById(preset)) fail(preset === null ? 'The link names no effect (it needs p=).' : `There is no effect called ${preset}.`);
  const packed = params.get('i');
  if (packed === null) return { version, preset, frames: 0, pokes: [] };
  const { frames, pokes } = unpackPokes(await pipe(fromBase64url(packed), new DecompressionStream('deflate'), UNPACKED_LIMIT));
  return { version, preset, frames, pokes };
}

// The zoom, in device pixels per art pixel, that fits the art into a box, and the art's CSS size at that zoom.
export function fitZoom(boxWidth, boxHeight, width, height, ratio = 1) {
  const zoom = Math.max(1, Math.floor(Math.min(boxWidth * ratio / width, boxHeight * ratio / height)));
  return { zoom, cssWidth: width * zoom / ratio, cssHeight: height * zoom / ratio };
}
// The whole-number scale that makes a GIF about 320 pixels on its long side, for chats and social posts.
export const gifScale = (width, height) => Math.max(1, Math.min(16, Math.floor(320 / Math.max(width, height))));
// The radius of a stir for an effect of this size: big enough to move the fluid, small enough to aim.
export const stirRadius = (width, height) => Math.max(3, Math.round(Math.min(width, height) / 8));
