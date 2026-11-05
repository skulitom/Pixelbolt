import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createViewModel, PREVIEW_KEY, MAX_PREVIEW_FILES, MAX_PREVIEW_PATH_LENGTH } from '../src/mcp-app-model.js';
import { viewerHTML } from '../src/mcp-app.js';
import { previewMeta } from '../src/mcp-preview.js';

const model = createViewModel(), project = { width: 2, height: 1, frames: [
  { name: '<first>', duration: 100, data: Uint8Array.of(255, 0, 0, 255, 0, 0, 0, 0) },
  { name: 'second', duration: 200, data: Uint8Array.of(0, 255, 0, 255, 0, 0, 0, 0) }
], animations: { bounce: { frames: [1, 0, 1], loop: true }, once: { frames: [1, 0], loop: false } } };
const payload = details => ({ content: [{ type: 'text', text: 'Model-facing text' }], ...previewMeta(project, details) });
const playback = { width: 2, height: 1,
  frames: Array.from({ length: 5 }, (_, i) => ({ name: `frame-${i}`, duration: 100 + i * 20, data: Uint8Array.of(i * 50, 255 - i * 50, 100, 255, 0, 0, 0, 0) })),
  animations: { loop: { frames: [0, 1, 2, 3, 4, 2], loop: true }, once: { frames: [4, 2, 0], loop: false } } };
const playbackPayload = () => ({ content: [], ...previewMeta(playback) });
const plain = value => JSON.parse(JSON.stringify(value));

test('the view decodes only its namespaced preview and falls back to text for errors, absent or malformed data', () => {
  const reply = payload({ files: ['<script>file</script>'], verdict: 'passed', shareLink: 'https://skulitom.github.io/Pixelbolt/playground/#recipe' });
  const decoded = model.decodeResult(reply); assert.equal(decoded.text, 'Model-facing text'); assert.equal(decoded.preview.width, 2);
  assert.deepEqual(decoded.preview.files, ['<script>file</script>']); assert.ok(decoded.preview.shareLink);
  for (const value of [undefined, {}, { ...reply, isError: true }, { content: reply.content, structuredContent: reply._meta }, { content: reply.content, _meta: { wrong: reply._meta[PREVIEW_KEY] } }]) assert.equal(model.decodeResult(value).preview, null);
  for (const mutate of [p => p.version = 2, p => p.width = 0, p => p.scale = 0.5, p => p.frames[0].duration = 0,
    p => p.frames[0].png = 'https://bad/image.png', p => p.animations[0].frames = [2], p => p.animations[0].loop = 1,
    p => p.frames = Array(241).fill(p.frames[0]), p => p.truncated = -1,
    p => p.files = Array(MAX_PREVIEW_FILES + 1).fill('a.png'), p => p.files = ['a'.repeat(MAX_PREVIEW_PATH_LENGTH + 1)],
    p => p.files = [42], p => p.files = {}, p => p.filesOmitted = -1, p => p.filesOmitted = 0.5, p => p.filesOmitted = '10']) {
    const bad = structuredClone(reply); mutate(bad._meta[PREVIEW_KEY].preview); assert.equal(model.decodeResult(bad).preview, null);
  }
  for (const url of ['javascript:alert(1)', 'https://skulitom.github.io.evil/Pixelbolt/', 'https://elsewhere.test/']) assert.equal(model.decodeResult(payload({ shareLink: url })).preview.shareLink, undefined);
  assert.equal(model.decodeResult({ isError: true, content: [{ type: 'text', text: 'Failure' }, { type: 'image' }, { type: 'text', text: 'Details' }] }).text, 'Failure\nDetails');
});

test('the view timeline preserves repeats, durations, loop boundaries and the last frame of a one-shot', () => {
  const preview = model.decodeResult(payload()).preview, loop = model.timeline(preview, 'bounce'), once = model.timeline(preview, 'once');
  assert.deepEqual(loop, { entries: [{ frame: 1, start: 0, duration: 200 }, { frame: 0, start: 200, duration: 100 }, { frame: 1, start: 300, duration: 200 }], duration: 500, loop: true });
  assert.deepEqual([0, 199, 200, 299, 300, 499, 500, 700].map(t => model.frameAt(loop, t).position), [0, 0, 1, 1, 2, 2, 0, 1]);
  assert.deepEqual(model.frameAt(once, 300), { position: 1, frame: 0, ended: true });
  assert.deepEqual(model.frameAt(once, 900), model.frameAt(once, 300));
  assert.equal(model.frameAt(once, 299).ended, false); assert.equal(model.frameAt(once, -1).position, 0);
  assert.equal(model.timeline(preview, 'unknown').loop, true);
  assert.deepEqual(model.frameAt(model.timeline({ frames: [], animations: [] }), 0), { position: -1, frame: -1, ended: true });
  assert.equal(model.timeline({ ...preview, animations: [] }).loop, false);
});

test('speed changes advance from the current playhead and integer fitting never resamples below native size', () => {
  assert.equal(model.advance(200, 100, 0.25), 225); assert.equal(model.advance(225, 100, 2), 425);
  assert.equal(model.advance(100, -10, 1), 100); assert.equal(model.speed(3), 2); assert.equal(model.speed(0.1), 0.25);
  assert.equal(model.fitScale(32, 159, 8), 4); assert.equal(model.fitScale(32, 160, 8), 5);
  assert.equal(model.fitScale(32, 999, 8), 8); assert.equal(model.fitScale(32, 20, 8), 1); assert.equal(model.fitScale(32, 0, 8), 1);
});

test('view JSON-RPC builders match the stable MCP Apps message shapes', () => {
  assert.deepEqual(model.initialize(7, '1.2.3'), { jsonrpc: '2.0', id: 7, method: 'ui/initialize', params: { protocolVersion: '2026-01-26', appInfo: { name: 'Pixelbolt viewer', version: '1.2.3' }, appCapabilities: { availableDisplayModes: ['inline'] } } });
  assert.deepEqual(model.initialized(), { jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} });
  assert.deepEqual(model.sizeChanged(320, 240), { jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { width: 320, height: 240 } });
  assert.deepEqual(model.openLink(9, 'https://skulitom.github.io/Pixelbolt/'), { jsonrpc: '2.0', id: 9, method: 'ui/open-link', params: { url: 'https://skulitom.github.io/Pixelbolt/' } });
});

// Execute the actual inline script against a small DOM/host harness; no browser, GPU, network, or SDK needed.
function view({ reduced = true, imageSize } = {}) {
  const html = viewerHTML('test'), sent = [], listeners = new Map(), motionListeners = new Map(), documentListeners = new Map(), timers = new Map(), rafs = new Map(), elements = new Map(), observers = [];
  const images = [], loads = [], decodes = [], liveCounts = [];
  let next = 0, now = 0;
  const context = { calls: [], shown: null, cleared: false, imageSmoothingEnabled: true,
    clearRect(...args) { this.calls.push({ method: 'clearRect', args }); this.shown = null; this.cleared = true; },
    drawImage(image, ...args) { assert.ok(image.decoded, 'draw only a decoded image'); this.calls.push({ method: 'drawImage', image, args }); this.shown = image; this.cleared = false; } };
  const boundary = fn => { assert.equal(context.cleared, false, 'previous step left a blank canvas'); fn(); assert.equal(context.cleared, false, 'step cleared without drawing a replacement'); };
  const style = () => ({ setProperty(key, value) { this[key] = value; }, removeProperty(key) { delete this[key]; } });
  function element(id) {
    let text = '';
    return { id, hidden: false, disabled: false, value: '', textWrites: 0, get textContent() { return text; }, set textContent(value) { text = value; this.textWrites++; }, style: style(), dataset: {}, children: [], attributes: {}, clientWidth: 100,
      append(child) { this.children.push(child); if (!this.value) this.value = child.value; },
      replaceChildren() { this.children = []; this.value = ''; }, setAttribute(key, value) { this.attributes[key] = value; },
      getContext: () => context, getBoundingClientRect: () => ({ width: 320, height: 240 }) };
  }
  for (const [, id] of html.matchAll(/id="([^"]+)"/g)) elements.set(id, element(id));
  elements.get('speed').value = '1';
  const root = element('root'), parent = { postMessage: (message, origin) => { assert.equal(origin, '*'); sent.push(plain(message)); } };
  const motion = { matches: reduced, addEventListener: (name, fn) => motionListeners.set(name, fn), removeEventListener: name => motionListeners.delete(name) };
  const window = { parent, matchMedia: () => motion, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  class Observer { constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } }
  class Image {
    constructor() { this.complete = this.decoded = this.released = false; this.naturalWidth = this.naturalHeight = 0; images.push(this); liveCounts.push(images.filter(image => !image.released).length); }
    set src(value) { assert.match(value, /^data:image\/png;base64,/); this.url = value; loads.push({ image: this, onload: this.onload, onerror: this.onerror }); }
    decode() { return new Promise((resolve, reject) => decodes.push({ image: this, resolve, reject })); }
    removeAttribute(name) { assert.equal(name, 'src'); this.released = true; }
  }
  const document = { hidden: false, documentElement: root, getElementById: id => elements.get(id), createElement: () => element('new'),
    addEventListener: (name, fn) => documentListeners.set(name, fn), removeEventListener: name => documentListeners.delete(name) };
  const sandbox = { window, document, ResizeObserver: Observer, IntersectionObserver: Observer, Image,
    performance: { now: () => now }, requestAnimationFrame: fn => { rafs.set(++next, fn); return next; }, cancelAnimationFrame: id => rafs.delete(id),
    setTimeout: fn => { timers.set(++next, fn); return next; }, clearTimeout: id => timers.delete(id) };
  vm.runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)[1], sandbox);
  const send = (message, source = parent) => boundary(() => listeners.get('message')?.({ source, data: { jsonrpc: '2.0', ...message } }));
  const flush = () => { const batch = [...timers.values()]; timers.clear(); for (const fn of batch) boundary(fn); };
  const tick = ms => { now = ms; const batch = [...rafs.values()]; rafs.clear(); for (const fn of batch) boundary(() => fn(now)); };
  const load = (image = loads[0]?.image, fail = false) => boundary(() => {
    const index = loads.findIndex(job => job.image === image); assert.ok(index >= 0, 'image load is queued');
    const [job] = loads.splice(index, 1), png = Buffer.from(image.url.split(',')[1], 'base64');
    image.complete = true; [image.naturalWidth, image.naturalHeight] = imageSize ?? [png.readUInt32BE(16), png.readUInt32BE(20)];
    (fail ? job.onerror : job.onload)?.();
  });
  const decode = async (image = decodes[0]?.image, fail = false) => {
    const index = decodes.findIndex(job => job.image === image); assert.ok(index >= 0, 'image decode is queued');
    const [job] = decodes.splice(index, 1);
    if (fail) job.reject(new Error('Decode failed')); else { image.decoded = true; job.resolve(); }
    await Promise.resolve(); boundary(() => {});
  };
  const finish = async image => { load(image); if (decodes.some(job => job.image === image)) await decode(image); };
  const loadAll = async () => { for (const { image } of [...loads]) await finish(image); };
  const intersect = isIntersecting => boundary(() => observers[1].callback([{ target: elements.get('stage'), isIntersecting }]));
  const hide = hidden => boundary(() => { document.hidden = hidden; documentListeners.get('visibilitychange')?.(); });
  const initialize = (extra = {}) => send({ id: 1, result: { protocolVersion: '2026-01-26', hostCapabilities: { openLinks: {} }, ...extra } });
  return { sent, send, flush, tick, initialize, root, elements, timers, rafs, observers, motion, motionListeners, listeners, documentListeners, context,
    images, loads, decodes, liveCounts, load, decode, finish, loadAll, intersect, hide, act: boundary };
}

function assertFrame(v, preview, track, elapsed) {
  const state = model.frameAt(track, elapsed), frame = preview.frames[state.frame];
  assert.equal(v.context.shown?.url, `data:image/png;base64,${frame.png}`, `drawn frame at ${elapsed} ms`);
  assert.equal(v.elements.get('frame').textContent, `${frame.name} · ${frame.duration} ms · ${state.position + 1}/${track.entries.length}`);
  assert.equal(v.context.cleared, false);
}

test('five distinct frames preload asynchronously, never blank between draws, and follow the timeline across loops', async () => {
  const v = view({ reduced: false }), reply = playbackPayload(), p = model.decodeResult(reply).preview, track = model.timeline(p, 'loop');
  v.initialize(); v.send({ method: 'ui/notifications/tool-result', params: reply });
  assert.equal(v.images.length, 5); assert.equal(v.rafs.size, 0); assert.equal(v.context.calls.length, 0);
  assert.equal(v.elements.get('player').hidden, true); assert.match(v.elements.get('status').textContent, /Loading frames/);
  v.tick(1000); v.load(v.images[0]);
  assert.equal(v.elements.get('player').hidden, true, 'wait for decode, not just load'); assert.equal(v.rafs.size, 0);
  await v.decode(v.images[0]); assertFrame(v, p, track, 0); assert.equal(v.rafs.size, 1);
  assert.equal(v.elements.get('player').hidden, false); assert.equal(v.elements.get('status').hidden, true);
  await v.loadAll(); assert.equal(v.context.calls.length, 2, 'background decodes do not paint');
  const labelWrites = v.elements.get('frame').textWrites;
  v.tick(1016); v.tick(1032); assertFrame(v, p, track, 32);
  assert.equal(v.elements.get('frame').textWrites, labelWrites, 'unchanged frame does not rewrite its label');
  for (const elapsed of [100, 219, 220, 359, 360, 519, 520, 699, 700, 839, 840, 940, 1060, 1200, 1360, 1540, 1680, 1780]) {
    v.tick(1000 + elapsed); assertFrame(v, p, track, elapsed);
  }
  assert.equal(v.images.length, 5, 'all decoded frames survive repeated loops');
  for (let i = 0; i < v.context.calls.length; i += 2) {
    assert.equal(v.context.calls[i].method, 'clearRect'); assert.equal(v.context.calls[i + 1].method, 'drawImage');
  }
});

test('stepping and animation selection paint the requested images and label only actual changes', async () => {
  const v = view(), reply = playbackPayload(), p = model.decodeResult(reply).preview, loop = model.timeline(p, 'loop'), once = model.timeline(p, 'once');
  v.initialize(); v.send({ method: 'ui/notifications/tool-result', params: reply }); await v.loadAll();
  assert.equal(v.rafs.size, 0); assertFrame(v, p, loop, 0);
  for (const [button, elapsed] of [['next', 100], ['next', 220], ['previous', 100], ['previous', 0], ['previous', 700]]) {
    v.act(() => v.elements.get(button).onclick()); assertFrame(v, p, loop, elapsed);
  }
  const picker = v.elements.get('animation'); picker.value = 'once'; v.act(() => picker.onchange()); assertFrame(v, p, once, 0);
  v.act(() => v.elements.get('next').onclick()); assertFrame(v, p, once, 180);
  v.act(() => v.elements.get('next').onclick()); assertFrame(v, p, once, 320);
  const writes = v.elements.get('frame').textWrites, draws = v.context.calls.length;
  v.act(() => v.elements.get('next').onclick()); assertFrame(v, p, once, 320);
  assert.equal(v.elements.get('frame').textWrites, writes); assert.equal(v.context.calls.length, draws);
});

test('late loads and decodes never overwrite a newer wanted frame or mislabel the retained frame', async () => {
  const v = view(), reply = playbackPayload(), p = model.decodeResult(reply).preview, loop = model.timeline(p, 'loop'), once = model.timeline(p, 'once');
  v.initialize(); v.send({ method: 'ui/notifications/tool-result', params: reply });
  const [first, second, third, fourth, fifth] = v.images;
  await v.finish(first); assertFrame(v, p, loop, 0);
  v.act(() => v.elements.get('next').onclick()); assertFrame(v, p, loop, 0);
  v.load(second); // Its decode is still pending when the user steps again.
  v.act(() => v.elements.get('next').onclick()); await v.finish(third); assertFrame(v, p, loop, 220);
  const calls = v.context.calls.length;
  await v.decode(second); assertFrame(v, p, loop, 220); assert.equal(v.context.calls.length, calls);
  const picker = v.elements.get('animation'); picker.value = 'once'; v.act(() => picker.onchange());
  assertFrame(v, p, loop, 220); // Retain the last shown label while waiting.
  await v.finish(fourth); assertFrame(v, p, loop, 220);
  await v.finish(fifth); assertFrame(v, p, once, 0);
});

test('playback keeps time through delayed decoding and a late unwanted load cannot replace the current frame', async () => {
  const v = view({ reduced: false }), reply = playbackPayload(), p = model.decodeResult(reply).preview, track = model.timeline(p, 'loop');
  v.initialize(); v.send({ method: 'ui/notifications/tool-result', params: reply });
  await v.finish(v.images[0]);
  v.tick(110); assertFrame(v, p, track, 0); // Frame 1 is not decoded yet.
  v.tick(230); await v.finish(v.images[2]); assertFrame(v, p, track, 230);
  await v.finish(v.images[1]); assertFrame(v, p, track, 230);
  v.tick(370); assertFrame(v, p, track, 230);
  await v.finish(v.images[3]); assertFrame(v, p, track, 370);
});

test('one-shots hold for 600 ms and preserve elapsed time when a tick crosses the replay boundary', async () => {
  const v = view({ reduced: false }), reply = playbackPayload(); reply._meta[PREVIEW_KEY].preview.animation = 'once';
  const p = model.decodeResult(reply).preview, track = model.timeline(p, 'once');
  v.initialize(); v.send({ method: 'ui/notifications/tool-result', params: reply }); await v.loadAll();
  v.tick(420); assertFrame(v, p, track, 420);
  v.tick(1019); assertFrame(v, p, track, 420);
  v.tick(1035); assertFrame(v, p, track, 15);
  v.tick(1200); assertFrame(v, p, track, 180);
});

test('replaced and torn-down previews ignore pending image callbacks and decoding failures stop playback', async () => {
  const v = view({ reduced: false }); v.initialize();
  v.send({ method: 'ui/notifications/tool-result', params: playbackPayload() });
  const oldLoad = v.images[1], oldDecode = v.images[0]; v.load(oldDecode);
  v.send({ method: 'ui/notifications/tool-result', params: playbackPayload() });
  await v.finish(oldLoad); await v.decode(oldDecode);
  assert.equal(v.context.calls.length, 0); assert.equal(v.elements.get('player').hidden, true);
  const current = v.images.find(image => !image.released); v.load(current); await v.decode(current, true);
  assert.match(v.elements.get('status').textContent, /could not be decoded/); assert.equal(v.rafs.size, 0);
  v.send({ method: 'ui/resource-teardown', id: 'bye' }); await v.loadAll();
  assert.equal(v.context.calls.length, 0); assert.equal(v.rafs.size, 0);
  assert.ok(v.images.every(image => image.released));
});

test('oversized previews prefetch a moving window within 64 MiB and hold their pixels on a cache miss', async () => {
  // Simulated natural dimensions exercise the memory policy without allocating large browser bitmaps.
  const v = view({ imageSize: [2048, 2048] }), reply = playbackPayload();
  reply._meta[PREVIEW_KEY].preview.width = reply._meta[PREVIEW_KEY].preview.height = 2048;
  const p = model.decodeResult(reply).preview, track = model.timeline(p, 'loop');
  v.initialize(); v.send({ method: 'ui/notifications/tool-result', params: reply });
  assert.equal(v.images.length, 4); await v.loadAll(); assertFrame(v, p, track, 0);
  v.act(() => v.elements.get('next').onclick()); assertFrame(v, p, track, 100);
  const ahead = v.images.find(image => image.url.endsWith(p.frames[4].png)); assert.ok(ahead, 'prefetch ahead of playback');
  v.act(() => v.elements.get('next').onclick()); assertFrame(v, p, track, 220);
  v.act(() => v.elements.get('next').onclick()); assertFrame(v, p, track, 360);
  v.act(() => v.elements.get('next').onclick()); assertFrame(v, p, track, 360); // Cache miss retains the previous pixels.
  await v.finish(ahead); assertFrame(v, p, track, 520);
  assert.ok(v.liveCounts.every(count => count * 2048 * 2048 * 4 <= 64 * 1024 * 1024));
});

test('a one-image budget uses the canvas to retain the current frame while prefetching the next', async () => {
  const v = view({ imageSize: [4096, 4096] }), reply = playbackPayload();
  reply._meta[PREVIEW_KEY].preview.width = reply._meta[PREVIEW_KEY].preview.height = 4096;
  const p = model.decodeResult(reply).preview, track = model.timeline(p, 'loop');
  v.initialize(); v.send({ method: 'ui/notifications/tool-result', params: reply }); await v.finish(v.images[0]);
  assertFrame(v, p, track, 0); assert.equal(v.images.length, 2);
  assert.ok(v.images[1].url.endsWith(p.frames[1].png));
  await v.finish(v.images[1]); assertFrame(v, p, track, 0);
  v.act(() => v.elements.get('next').onclick()); assertFrame(v, p, track, 100);
  assert.ok(v.liveCounts.every(count => count === 1));
});

test('off-screen and hidden players stop rAF, resume without counting hidden time, and respect a user pause', async () => {
  const v = view({ reduced: false }), reply = playbackPayload(), p = model.decodeResult(reply).preview, track = model.timeline(p, 'loop');
  v.initialize(); v.hide(true); v.send({ method: 'ui/notifications/tool-result', params: reply }); await v.loadAll();
  assert.equal(v.rafs.size, 0); v.hide(false); assert.equal(v.rafs.size, 1);
  v.tick(110); assertFrame(v, p, track, 110);
  v.hide(true); assert.equal(v.rafs.size, 0); v.tick(5110); assertFrame(v, p, track, 110);
  v.hide(false); assert.equal(v.rafs.size, 1); v.tick(5120); assertFrame(v, p, track, 120);
  v.intersect(false); assert.equal(v.rafs.size, 0); v.tick(9120); assertFrame(v, p, track, 120);
  v.hide(true); v.intersect(true); assert.equal(v.rafs.size, 0);
  v.hide(false); assert.equal(v.rafs.size, 1); v.tick(9220); assertFrame(v, p, track, 220);
  v.act(() => v.elements.get('play').onclick()); assert.equal(v.rafs.size, 0);
  v.intersect(false); v.intersect(true); v.hide(true); v.hide(false); assert.equal(v.rafs.size, 0);
  v.act(() => v.elements.get('play').onclick()); assert.equal(v.rafs.size, 1);
});

test('the viewer shows bounded paths as text with an omitted-file count', () => {
  const v = view(); v.initialize();
  v.send({ method: 'ui/notifications/tool-result', params: payload({ files: Array.from({ length: 80 }, (_, i) => `<b>${i}.png</b>`) }) });
  const list = v.elements.get('files').children;
  assert.equal(list.length, MAX_PREVIEW_FILES + 1); assert.equal(list[0].textContent, '<b>0.png</b>');
  assert.equal(list.at(-1).textContent, 'and 16 more files'); assert.equal(v.elements.get('file-count').textContent, 'Written files (80)');
});

test('inline script waits for initialization, filters senders, merges host context, and debounces size reports', () => {
  const v = view(); assert.deepEqual(v.sent, [model.initialize(1, 'test')]);
  v.send({ id: 1, result: { protocolVersion: '2026-01-26' } }, {}); assert.equal(v.sent.length, 1);
  v.send({ id: 77, result: {} }); assert.equal(v.sent.length, 1);
  v.initialize({ hostContext: { theme: 'dark', styles: { variables: { '--color-text-primary': '#eee' }, css: { fonts: '@import "https://bad/font.css";' } }, containerDimensions: { width: 320, maxHeight: 500 } } });
  assert.deepEqual(v.sent[1], model.initialized()); assert.equal(v.root.style.colorScheme, 'dark'); assert.equal(v.root.style.width, '100vw');
  assert.equal(v.elements.get('main').style.maxHeight, '500px');
  v.flush(); assert.deepEqual(v.sent[2], model.sizeChanged(320, 240));
  v.observers[0].callback(); v.observers[0].callback(); v.flush(); assert.equal(v.sent.length, 3);
  v.send({ method: 'ui/notifications/host-context-changed', params: { theme: 'light', styles: { variables: { '--font-sans': 'system-ui' } } } });
  assert.equal(v.root.style.colorScheme, 'light'); assert.equal(v.root.style['--color-text-primary'], '#eee'); assert.equal(v.root.style['--font-sans'], 'system-ui');
  v.send({ method: 'ping', id: 'health' }); assert.deepEqual(v.sent.at(-1), { jsonrpc: '2.0', id: 'health', result: {} });
});

test('inline player honors reduced motion, frame stepping, speed, animation selection and background controls', async () => {
  const v = view(); v.initialize(); v.send({ method: 'ui/notifications/tool-input', params: { arguments: {} } });
  assert.equal(v.elements.get('status').textContent, "Waiting for Pixelbolt's result");
  v.send({ method: 'ui/notifications/tool-result', params: payload() }); await v.loadAll(); v.flush();
  const el = id => v.elements.get(id);
  assert.equal(v.rafs.size, 0); assert.match(el('frame').textContent, /second · 200 ms · 1\/3/);
  assert.equal(v.context.imageSmoothingEnabled, false); assert.equal(el('canvas').style.width, '16px');
  el('next').onclick(); assert.match(el('frame').textContent, /<first> · 100 ms · 2\/3/);
  el('previous').onclick(); assert.match(el('frame').textContent, /second · 200 ms · 1\/3/);
  el('play').onclick(); el('speed').value = '2'; el('speed').onchange(); v.tick(100);
  assert.match(el('frame').textContent, /2\/3/); el('play').onclick(); assert.equal(v.rafs.size, 0);
  el('animation').value = 'once'; el('animation').onchange(); el('play').onclick(); v.tick(300);
  // A one-shot holds its last frame for 600 ms of animation time (300 ms here, at 2x), then plays again.
  assert.equal(v.rafs.size, 1); assert.equal(el('play').textContent, 'Pause'); assert.match(el('frame').textContent, /2\/2/);
  v.tick(500); assert.match(el('frame').textContent, /2\/2/);
  v.tick(549); assert.match(el('frame').textContent, /2\/2/);
  v.tick(550); assert.match(el('frame').textContent, /1\/2/);
  el('play').onclick(); assert.equal(v.rafs.size, 0); assert.equal(el('play').textContent, 'Play');
  el('background').value = 'dark'; el('background').onchange(); assert.equal(el('stage').dataset.background, 'dark');
});

test('inline player autoplays when allowed, opens links through the host, and tears down every timer and observer', async () => {
  const v = view({ reduced: false }); v.initialize();
  const url = 'https://skulitom.github.io/Pixelbolt/playground/#recipe';
  v.send({ method: 'ui/notifications/tool-result', params: payload({ shareLink: url, files: ['<b>sprite.png</b>'], verdict: 'passed' }) });
  await v.loadAll();
  assert.equal(v.rafs.size, 1); assert.equal(v.elements.get('files').children[0].textContent, '<b>sprite.png</b>');
  v.elements.get('share').onclick(); assert.deepEqual(v.sent.at(-1), model.openLink(2, url));
  v.send({ id: 2, error: { code: -32000, message: 'Denied' } }); assert.match(v.elements.get('status').textContent, /Denied/);
  v.motion.matches = true; v.motionListeners.get('change')(); assert.equal(v.rafs.size, 0);
  v.send({ method: 'ui/resource-teardown', id: 'bye', params: {} });
  assert.deepEqual(v.sent.at(-1), { jsonrpc: '2.0', id: 'bye', result: {} });
  assert.equal(v.timers.size, 0); assert.equal(v.rafs.size, 0); assert.equal(v.listeners.size, 0); assert.equal(v.motionListeners.size, 0);
  assert.equal(v.documentListeners.size, 0); assert.ok(v.images.every(image => image.released));
  assert.ok(v.observers.every(o => o.disconnected));
});

test('inline player replaces old previews with text errors or cancellation and handles failed initialization', () => {
  const v = view({ reduced: false }); v.initialize(); v.send({ method: 'ui/notifications/tool-result', params: payload({ files: ['a.png'] }) });
  v.send({ method: 'ui/notifications/tool-result', params: { isError: true, content: [{ type: 'text', text: '<error>' }] } });
  assert.equal(v.elements.get('status').textContent, '<error>'); assert.equal(v.elements.get('player').hidden, true);
  assert.equal(v.elements.get('delivery').hidden, true); assert.equal(v.rafs.size, 0);
  v.send({ method: 'ui/notifications/tool-cancelled', params: { reason: 'Stopped' } }); assert.equal(v.elements.get('status').textContent, 'Stopped');
  const failed = view(); failed.send({ id: 1, error: { message: 'No UI' } }); assert.match(failed.elements.get('status').textContent, /No UI/);
  assert.equal(failed.sent.length, 1);
  // A host may answer with another version it negotiated (the SDK's AppBridge falls back to its latest): still ready.
  const older = view(); older.send({ id: 1, result: { protocolVersion: '2025-11-21', hostCapabilities: {} } });
  assert.deepEqual(older.sent[1], model.initialized());
  const broken = view(); broken.send({ id: 1, result: {} }); assert.equal(broken.sent.length, 1);
  assert.match(broken.elements.get('status').textContent, /invalid preview handshake/);
});

test('a preview truncated far past the frame cap still decodes its first frames', () => {
  const reply = payload(); reply._meta[PREVIEW_KEY].preview.truncated = 65000;
  assert.equal(model.decodeResult(reply).preview.truncated, 65000);
});

test('a review sheet a little wider than 4096 px (gutters) still decodes as a preview', () => {
  const reply = payload(); const p = reply._meta[PREVIEW_KEY].preview; p.width = 4100; p.height = 1030;
  assert.equal(model.decodeResult(reply).preview.width, 4100);
  p.width = 16385; assert.equal(model.decodeResult(reply).preview, null);
});

test('an animation the frame cap cut off is reported, not replaced by another animation', () => {
  const v = view({ reduced: false }); v.initialize();
  v.send({ method: 'ui/notifications/tool-result', params: payload({ animation: 'gone' }) }); v.flush();
  assert.match(v.elements.get('status').textContent, /"gone" animation uses frames past this preview/);
  assert.equal(v.elements.get('player').hidden, true); assert.equal(v.rafs.size, 0);
});
