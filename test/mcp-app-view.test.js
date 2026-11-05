import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createViewModel, PREVIEW_KEY } from '../src/mcp-app-model.js';
import { viewerHTML } from '../src/mcp-app.js';
import { previewMeta } from '../src/mcp-preview.js';

const model = createViewModel(), project = { width: 2, height: 1, frames: [
  { name: '<first>', duration: 100, data: Uint8Array.of(255, 0, 0, 255, 0, 0, 0, 0) },
  { name: 'second', duration: 200, data: Uint8Array.of(0, 255, 0, 255, 0, 0, 0, 0) }
], animations: { bounce: { frames: [1, 0, 1], loop: true }, once: { frames: [1, 0], loop: false } } };
const payload = details => ({ content: [{ type: 'text', text: 'Model-facing text' }], ...previewMeta(project, details) });
const plain = value => JSON.parse(JSON.stringify(value));

test('the view decodes only its namespaced preview and falls back to text for errors, absent or malformed data', () => {
  const reply = payload({ files: ['<script>file</script>'], verdict: 'passed', shareLink: 'https://skulitom.github.io/Pixelbolt/playground/#recipe' });
  const decoded = model.decodeResult(reply); assert.equal(decoded.text, 'Model-facing text'); assert.equal(decoded.preview.width, 2);
  assert.deepEqual(decoded.preview.files, ['<script>file</script>']); assert.ok(decoded.preview.shareLink);
  for (const value of [undefined, {}, { ...reply, isError: true }, { content: reply.content, structuredContent: reply._meta }, { content: reply.content, _meta: { wrong: reply._meta[PREVIEW_KEY] } }]) assert.equal(model.decodeResult(value).preview, null);
  for (const mutate of [p => p.version = 2, p => p.width = 0, p => p.scale = 0.5, p => p.frames[0].duration = 0,
    p => p.frames[0].png = 'https://bad/image.png', p => p.animations[0].frames = [2], p => p.animations[0].loop = 1,
    p => p.frames = Array(241).fill(p.frames[0]), p => p.truncated = -1]) {
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
function view({ reduced = true } = {}) {
  const html = viewerHTML('test'), sent = [], listeners = new Map(), motionListeners = new Map(), timers = new Map(), rafs = new Map(), elements = new Map(), observers = [];
  let next = 0, now = 0;
  const context = { clearRect() {}, drawImage() {}, imageSmoothingEnabled: true };
  const style = () => ({ setProperty(key, value) { this[key] = value; }, removeProperty(key) { delete this[key]; } });
  function element(id) {
    return { id, hidden: false, disabled: false, value: '', textContent: '', style: style(), dataset: {}, children: [], attributes: {}, clientWidth: 100,
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
  class Image { constructor() { this.complete = true; this.naturalWidth = 2; this.naturalHeight = 1; } set src(value) { assert.match(value, /^data:image\/png;base64,/); this.onload?.(); } removeAttribute() {} }
  const sandbox = { window, document: { documentElement: root, getElementById: id => elements.get(id), createElement: () => element('new') }, ResizeObserver: Observer, Image,
    performance: { now: () => now }, requestAnimationFrame: fn => { rafs.set(++next, fn); return next; }, cancelAnimationFrame: id => rafs.delete(id),
    setTimeout: fn => { timers.set(++next, fn); return next; }, clearTimeout: id => timers.delete(id) };
  vm.runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)[1], sandbox);
  const send = (message, source = parent) => listeners.get('message')?.({ source, data: { jsonrpc: '2.0', ...message } });
  const flush = () => { const batch = [...timers.values()]; timers.clear(); for (const fn of batch) fn(); };
  const tick = ms => { now = ms; const batch = [...rafs.values()]; rafs.clear(); for (const fn of batch) fn(now); };
  const initialize = (extra = {}) => send({ id: 1, result: { protocolVersion: '2026-01-26', hostCapabilities: { openLinks: {} }, ...extra } });
  return { sent, send, flush, tick, initialize, root, elements, timers, rafs, observers, motion, motionListeners, listeners, context };
}

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

test('inline player honors reduced motion, frame stepping, speed, animation selection and background controls', () => {
  const v = view(); v.initialize(); v.send({ method: 'ui/notifications/tool-input', params: { arguments: {} } });
  assert.equal(v.elements.get('status').textContent, "Waiting for Pixelbolt's result");
  v.send({ method: 'ui/notifications/tool-result', params: payload() }); v.flush();
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
  v.tick(800); assert.match(el('frame').textContent, /1\/2/);
  el('play').onclick(); assert.equal(v.rafs.size, 0); assert.equal(el('play').textContent, 'Play');
  el('background').value = 'dark'; el('background').onchange(); assert.equal(el('stage').dataset.background, 'dark');
});

test('inline player autoplays when allowed, opens links through the host, and tears down every timer and observer', () => {
  const v = view({ reduced: false }); v.initialize();
  const url = 'https://skulitom.github.io/Pixelbolt/playground/#recipe';
  v.send({ method: 'ui/notifications/tool-result', params: payload({ shareLink: url, files: ['<b>sprite.png</b>'], verdict: 'passed' }) });
  assert.equal(v.rafs.size, 1); assert.equal(v.elements.get('files').children[0].textContent, '<b>sprite.png</b>');
  v.elements.get('share').onclick(); assert.deepEqual(v.sent.at(-1), model.openLink(2, url));
  v.send({ id: 2, error: { code: -32000, message: 'Denied' } }); assert.match(v.elements.get('status').textContent, /Denied/);
  v.motion.matches = true; v.motionListeners.get('change')(); assert.equal(v.rafs.size, 0);
  v.send({ method: 'ui/resource-teardown', id: 'bye', params: {} });
  assert.deepEqual(v.sent.at(-1), { jsonrpc: '2.0', id: 'bye', result: {} });
  assert.equal(v.timers.size, 0); assert.equal(v.rafs.size, 0); assert.equal(v.listeners.size, 0); assert.equal(v.motionListeners.size, 0);
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
