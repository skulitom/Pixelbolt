import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createLiveFluid } from '../src/fluid.js';
import { framesGIF } from '../src/gif.js';
import { scalePixels } from '../src/core.js';
import { decodePNG } from '../src/import.js';
import { readShareLink, LINK_LIMIT as SHARE_LIMIT } from '../src/share.js';
import { shareLink } from '../playground/share.js';
import { compareVersions } from '../playground/lib.js';
import { PRESETS, TOY_VERSION, LINK_LIMIT, RECORD_FRAMES, MAX_POKES, GIF_MS, STAGE, presetById, checkToyVersion, pushPoke, puffPoke, applyPoke, replay, packPokes, unpackPokes, toyLink, fitLink, readToyLink, toBase64url, fitZoom, gifScale, stirRadius } from '../playground/fluids/lib.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFile(path.join(root, file), 'utf8');
const sourceOf = async preset => JSON.parse(await read(`examples/${preset.file}`));
const digest = live => createHash('sha256').update(live.render().rgba).digest('hex');
const BASE = 'https://skulitom.github.io/Pixelbolt/playground/fluids/';
const deflate = async bytes => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());

// A busy visitor, the same every run: a drag through the effect every frame, and a pour or stoke on every third.
function busyPokes({ width, height, kind }, frames) {
  const pokes = [];
  for (let t = 0; t < frames; t++) {
    const x = width * (0.5 + 0.4 * Math.sin(t / 7)), y = height * (0.5 + 0.3 * Math.cos(t / 11));
    pokes.push({ ...pushPoke({ x, y, vx: Math.cos(t / 7) * 3.3, vy: -Math.sin(t / 11) * 2.1, radius: stirRadius(width, height) }), f: t });
    if (t % 3 === 0) pokes.push({ ...puffPoke({ x, y, radius: 2.5, density: 1, temperature: 0.7 }, kind), f: t });
  }
  return pokes;
}
const session = (live, frames) => { const pokes = busyPokes(live, frames); replay(live, pokes, 0, frames); return pokes; };

test('the toy offers inline fluid presets the playground has at its pin, and loads the same engine version', async () => {
  const app = await read('playground/app.js'), pin = /\bconst PINNED_VERSION = '([^']+)'/.exec(app)[1];
  assert.equal(TOY_VERSION, pin);
  checkToyVersion(TOY_VERSION);
  const manifest = JSON.parse(await read('playground/examples.json'));
  assert.equal(new Set(PRESETS.map(preset => preset.id)).size, PRESETS.length);
  for (const preset of PRESETS) {
    assert.match(preset.id, /^[a-z-]+$/); assert.equal(presetById(preset.id), preset);
    const source = await sourceOf(preset), entry = manifest.find(item => item.file === preset.file);
    assert.equal(source.format, 'pixelforge-fluid', preset.file);
    assert.ok(entry && compareVersions(entry.minVersion, TOY_VERSION) <= 0, `${preset.file} is in the playground at ${TOY_VERSION}`);
    assert.equal(typeof source.palette.$ref, 'undefined', `${preset.file} has an inline palette`);
    const [effect] = Object.values(source.effects);
    assert.ok(Number.isInteger(effect.duration) && effect.duration >= 20, `${preset.file} names its frame duration`);
    assert.ok(preset.spot.every(share => share >= 0 && share <= 1)); assert.ok(preset.hint.endsWith('.'));
  }
});

test('every effect keeps working under a long, busy poke', async () => {
  for (const preset of PRESETS) {
    const live = createLiveFluid(await sourceOf(preset));
    session(live, 150);
    const { rgba } = live.render();
    let drawn = 0;
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i]) drawn++;
    assert.ok(drawn > live.width * live.height * 0.05, `${preset.id} still draws after 150 poked frames`);
  }
});

test('a link replays a busy session exactly, for gases and liquids', async () => {
  for (const id of ['campfire', 'slime']) {
    const preset = presetById(id), source = await sourceOf(preset), live = createLiveFluid(source), frames = 120;
    // The visitor's own run: each poke made on its frame, as the page does, before the link exists.
    const pokes = busyPokes(live, frames);
    for (let t = 0, at = 0; t < frames; t++) { while (at < pokes.length && pokes[at].f === t) applyPoke(live, pokes[at++]); live.step(); }
    const expected = digest(live);
    const { link, cut } = await fitLink(BASE, { preset: id, frames, pokes });
    assert.equal(cut, false); assert.ok(link.length <= LINK_LIMIT);
    assert.ok(link.startsWith(`${BASE}#v=${TOY_VERSION}&p=${id}&i=`));
    const shared = await readToyLink(link);
    assert.deepEqual(shared.pokes, pokes); assert.equal(shared.frames, frames); assert.equal(shared.preset, id);
    assert.equal(digest(replay(createLiveFluid(source), shared.pokes, 0, shared.frames)), expected, id);
    // Replaying in pieces, as the page does a frame at a time, gives the same pixels.
    const pieces = createLiveFluid(source);
    for (let from = 0; from < frames; from += 37) replay(pieces, shared.pokes, from, Math.min(37, frames - from));
    assert.equal(digest(pieces), expected, `${id} in pieces`);
  }
});

test('the longest recording a visitor can make still fits a link', async () => {
  const pokes = busyPokes({ width: 48, height: 64, kind: 'liquid' }, RECORD_FRAMES);
  assert.ok(pokes.length <= MAX_POKES);
  const { link, cut } = await fitLink(BASE, { preset: 'waterfall', frames: RECORD_FRAMES, pokes });
  assert.equal(cut, false); assert.ok(link.length < LINK_LIMIT * 0.6, `${link.length} characters`);
});

test('a recording too long for a link is cut at a poke, and the cut link replays what it keeps', async () => {
  // Only the pokes matter here, and they depend on the effect's size and kind alone, so nothing is simulated.
  const pokes = busyPokes(createLiveFluid(await sourceOf(presetById('campfire')), { warmup: 0 }), 200);
  const whole = (await toyLink(BASE, { preset: 'campfire', frames: 200, pokes })).length, limit = Math.floor(whole / 2);
  const { link, frames, cut } = await fitLink(BASE, { preset: 'campfire', frames: 200, pokes }, limit);
  assert.equal(cut, true); assert.ok(link.length <= limit);
  const shared = await readToyLink(link, limit);
  assert.ok(shared.pokes.length > 10 && shared.pokes.length < pokes.length);
  assert.deepEqual(shared.pokes, pokes.slice(0, shared.pokes.length));
  assert.equal(frames, pokes[shared.pokes.length].f); assert.equal(shared.frames, frames);
  assert.ok(shared.pokes.every(poke => poke.f < frames));
});

test('pokes are whole numbers inside the live runner\'s ranges, and a liquid puff carries no temperature', async () => {
  assert.deepEqual(pushPoke({ x: 1.13, y: 2.26, vx: 0.3, vy: -99, radius: 4.1 }), { op: 0, x: 5, y: 9, r: 16, a: 2, b: -128 });
  assert.deepEqual(pushPoke({ x: NaN, y: Infinity, vx: NaN, vy: 1, radius: 0 }), { op: 0, x: 0, y: 0, r: 2, a: 0, b: 8 });
  assert.deepEqual(puffPoke({ x: 9999, y: -9999, radius: 99, density: 0.6, temperature: 1 }, 'gas'), { op: 1, x: 2048, y: -1024, r: 256, a: 60, b: 100 });
  assert.deepEqual(puffPoke({ x: 3, y: 4, radius: 2.5, density: 5, temperature: 1 }, 'liquid'), { op: 2, x: 12, y: 16, r: 10, a: 100, b: 0 });
  const calls = [], spy = { push: input => calls.push(['push', input]), puff: input => calls.push(['puff', input]) };
  applyPoke(spy, { op: 0, x: 5, y: 9, r: 16, a: 2, b: -128 }); applyPoke(spy, { op: 1, x: 4, y: 4, r: 12, a: 60, b: 100 }); applyPoke(spy, { op: 2, x: 4, y: 4, r: 10, a: -50, b: 0 });
  assert.deepEqual(calls, [['push', { x: 1.25, y: 2.25, radius: 4, vx: 0.25, vy: -16 }], ['puff', { x: 1, y: 1, radius: 3, density: 0.6, temperature: 1 }], ['puff', { x: 1, y: 1, radius: 2.5, density: -0.5 }]]);
  // A liquid runner refuses a temperature; the toy never sends one.
  const honey = createLiveFluid(await sourceOf(presetById('honey')));
  assert.throws(() => honey.puff({ x: 5, y: 5, temperature: 1 }), /temperature/);
  applyPoke(honey, puffPoke({ x: 5, y: 5, radius: 2, density: 1, temperature: 1 }, 'liquid')).step();
});

test('packed pokes round-trip, and damaged or oversized recordings are refused with a reason', async () => {
  const pokes = [{ f: 0, op: 0, x: -4, y: 2048, r: 2, a: -128, b: 128 }, { f: 0, op: 1, x: 7, y: 0, r: 256, a: -1600, b: 1600 }, { f: 9, op: 2, x: 0, y: -1024, r: 10, a: 100, b: 0 }];
  assert.deepEqual(unpackPokes(packPokes(pokes, 10)), { frames: 10, pokes });
  const bytes = packPokes(pokes, 10);
  assert.throws(() => unpackPokes(Uint8Array.of(2, ...bytes.subarray(1))), /newer toy/);
  assert.throws(() => unpackPokes(packPokes([], RECORD_FRAMES + 1)), /more than 1800 frames/);
  assert.throws(() => unpackPokes(Uint8Array.of(1, 10, 0x81, 0x40)), /more than 4096 pokes/);
  assert.throws(() => unpackPokes(packPokes(pokes, 9)), /outside the recording/);
  assert.throws(() => unpackPokes(packPokes([{ ...pokes[0], r: 1 }], 10)), /out of range/);
  assert.throws(() => unpackPokes(packPokes([{ ...pokes[0], op: 7 }], 10)), /outside the recording|out of range|damaged/);
  assert.throws(() => unpackPokes(Uint8Array.of(...bytes, 0)), /bytes after/);
  assert.throws(() => unpackPokes(bytes.subarray(0, bytes.length - 1)), /do not read back/);
  const link = async packed => `${BASE}#p=honey&i=${toBase64url(await deflate(packed))}`;
  assert.deepEqual((await readToyLink(await link(bytes))).pokes, pokes);
  await assert.rejects(readToyLink(await link(new Uint8Array(1 << 20))), /unpack too large/);
  await assert.rejects(readToyLink(`${BASE}#p=honey&i=AAAA`), /do not unpack/);
  await assert.rejects(readToyLink(`${BASE}#p=honey&i=!!`), /not base64url/);
  await assert.rejects(readToyLink('#p=nope'), /no effect called nope/);
  await assert.rejects(readToyLink('#v=1.0.0'), /needs p=/);
  await assert.rejects(readToyLink('#v=0.9.0&p=honey'), /older than live fluids/);
  await assert.rejects(readToyLink('#v=latest&p=honey'), /must look like/);
  await assert.rejects(readToyLink(`#p=honey&i=${'A'.repeat(LINK_LIMIT)}`), /over the 16,384-character limit/);
});

test('a link with nothing done names only the effect, and the default version can be left out', async () => {
  assert.equal(await toyLink(BASE, { preset: 'honey' }), `${BASE}#v=${TOY_VERSION}&p=honey`);
  assert.deepEqual(await readToyLink('#p=honey'), { version: TOY_VERSION, preset: 'honey', frames: 0, pokes: [] });
  assert.deepEqual(await readToyLink(`${BASE}#v=0.9.4&p=slime`), { version: '0.9.4', preset: 'slime', frames: 0, pokes: [] });
  await assert.rejects(toyLink(BASE, { preset: 'dam-break' }), /no effect called dam-break/);
});

test('each effect\'s remix link opens its recipe in the playground', async () => {
  for (const preset of PRESETS) {
    const source = await sourceOf(preset), link = await shareLink(source, TOY_VERSION, { base: 'https://skulitom.github.io/Pixelbolt/playground/' });
    assert.ok(link.length < SHARE_LIMIT / 4, `${preset.id}: ${link.length} characters`);
    const opened = await readShareLink(link);
    assert.equal(opened.kind, 'fluid'); assert.equal(opened.version, TOY_VERSION); assert.deepEqual(opened.recipe, source);
  }
});

test('a saved GIF holds the last few seconds, enlarged and blended onto the stage colour', async () => {
  const preset = presetById('steam-vent'), source = await sourceOf(preset), live = createLiveFluid(source), duration = Object.values(source.effects)[0].duration;
  const ring = [], keep = Math.ceil(GIF_MS / duration);
  for (let t = 0; t < keep + 20; t++) { live.step(); ring.push(live.render().rgba); if (ring.length > keep) ring.shift(); }
  const scale = gifScale(live.width, live.height);
  const gif = framesGIF(ring.map(rgba => ({ width: live.width * scale, height: live.height * scale, data: scalePixels(rgba, live.width, live.height, scale) })), { fps: { numerator: 1000, denominator: duration }, background: STAGE });
  assert.equal(gif.frames, keep); assert.equal(gif.width, live.width * scale); assert.equal(gif.transparent, false);
  assert.deepEqual(gif.delays, { [duration]: keep });
  assert.equal(Buffer.from(gif.data.subarray(0, 6)).toString('latin1'), 'GIF89a');
  assert.ok(!gif.notes.some(note => /partly transparent/.test(note)));
});

test('zoom and GIF scale are whole numbers that fit', () => {
  for (const [box, size, ratio] of [[[1000, 600], [32, 48], 1], [[343, 430], [40, 48], 2], [[900, 560], [48, 64], 1.25], [[10, 10], [64, 64], 1]]) {
    const { zoom, cssWidth, cssHeight } = fitZoom(...box, ...size, ratio);
    assert.ok(Number.isInteger(zoom) && zoom >= 1);
    if (zoom > 1) assert.ok(cssWidth <= box[0] && cssHeight <= box[1]);
    assert.equal(cssWidth * ratio, size[0] * zoom);
  }
  assert.equal(gifScale(32, 48), 6); assert.equal(gifScale(16, 32), 10); assert.equal(gifScale(400, 10), 1);
  assert.equal(stirRadius(32, 48), 4); assert.equal(stirRadius(16, 16), 3);
});

test('page: exact CSP, a link card, every element the script uses, and only relative or engine imports', async () => {
  const html = await read('playground/fluids/index.html'), app = await read('playground/fluids/app.js'), lib = await read('playground/fluids/lib.js');
  const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)[1];
  assert.equal(policy, "default-src 'none'; script-src 'self' https://cdn.jsdelivr.net; connect-src 'self' https://cdn.jsdelivr.net; img-src 'self' data: blob:; style-src 'self'; base-uri 'none'; form-action 'none'");
  assert.doesNotMatch(html, /<style\b|\sstyle\s*=|<script(?![^>]*\bsrc=)/i);
  assert.match(html, /<meta property="og:image" content="https:\/\/skulitom\.github\.io\/Pixelbolt\/playground\/fluids\/preview\.png">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/skulitom\.github\.io\/Pixelbolt\/playground\/fluids\/">/);
  for (const [, id] of app.matchAll(/\$\('([A-Za-z-]+)'\)/g)) assert.ok(html.includes(`id="${id}"`), id);
  for (const [, from] of app.matchAll(/^import .* from '([^']+)';$/gm)) assert.match(from, /^\.\.?\/[a-z]+\.js$/);
  assert.doesNotMatch(lib, /^import\s/m);
  // The test hook is only made on loopback pages.
  assert.match(app, /if \(loopback\) \{\s*globalThis\.fluidToy/);
  const preview = decodePNG(await readFile(path.join(root, 'playground/fluids/preview.png')));
  assert.equal(preview.width, 1200); assert.equal(preview.height, 630);
});
