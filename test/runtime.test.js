import test from 'node:test';
import assert from 'node:assert/strict';
import { SpritePlayer } from '../src/runtime.js';

test('Canvas player respects durations, once/loop behavior, pause/resume and scaled atlas rectangles', t => {
  let sequence = 0; const pending = new Map();
  const originalRAF = globalThis.requestAnimationFrame, originalCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = callback => { const id = ++sequence; pending.set(id, callback); return id; };
  globalThis.cancelAnimationFrame = id => pending.delete(id);
  t.after(() => { if (originalRAF) globalThis.requestAnimationFrame = originalRAF; else delete globalThis.requestAnimationFrame; if (originalCancel) globalThis.cancelAnimationFrame = originalCancel; else delete globalThis.cancelAnimationFrame; });
  const draws = [], ctx = { clearRect() {}, drawImage(...args) { draws.push(args); } };
  const canvas = { width: 0, height: 0, style: {}, getContext() { return ctx; } };
  const atlas = {
    frames: { a: { frame: { x: 2, y: 4, w: 8, h: 12 }, duration: 80 }, b: { frame: { x: 12, y: 4, w: 8, h: 12 }, duration: 120 } },
    animations: { once: { frames: ['a','b'], duration: 200, loop: false }, loop: { frames: ['a','b'], duration: 200, loop: true } }
  };
  const player = new SpritePlayer(canvas, {}, atlas, { scale: 3 });
  player.play('once'); assert.equal(pending.size, 1);
  assert.equal(canvas.width, 24); assert.equal(canvas.height, 36); assert.equal(ctx.imageSmoothingEnabled, false);
  player.drawAt(79); assert.equal(draws.at(-1)[1], 2);
  player.drawAt(80); assert.equal(draws.at(-1)[1], 12);
  player.drawAt(200); assert.equal(draws.at(-1)[1], 12); assert.equal(player.playing, false); assert.equal(pending.size, 0);
  player.play('loop'); player.drawAt(200); assert.equal(draws.at(-1)[1], 2);
  player.pause(); assert.equal(pending.size, 0); player.resume(); player.resume(); assert.equal(pending.size, 1);
  player.play('loop'); assert.equal(pending.size, 1);
  assert.throws(() => player.play('missing'), /Unknown animation/);
  assert.throws(() => player.play('toString'), /Unknown animation/);
  player.destroy(); assert.equal(pending.size, 0); assert.equal(player.animation, null);
});

test('runtime helpers look up frames by time and draw trimmed, anchored and mirrored frames', async t => {
  const { frameAt, drawFrame, loadSpriteSheet } = await import('../src/runtime.js');
  const atlas = {
    meta: { image: 'sheet.png' },
    frames: {
      a: { frame: { x: 4, y: 0, w: 2, h: 3 }, trimmed: true, spriteSourceSize: { x: 5, y: 1, w: 2, h: 3 }, sourceSize: { w: 8, h: 6 }, anchor: { x: 4, y: 6 }, duration: 50 },
      b: { frame: { x: 0, y: 0, w: 4, h: 4 }, duration: 70 }
    },
    animations: { run: { frames: ['a', 'b'], duration: 120, loop: true }, once: { frames: ['a', 'b'], duration: 120, loop: false } }
  };
  assert.deepEqual([frameAt(atlas, 'run', 49), frameAt(atlas, 'run', 50), frameAt(atlas, 'run', 130), frameAt(atlas, 'once', 999)], ['a', 'b', 'a', 'b']);
  assert.throws(() => frameAt(atlas, 'toString', 0), /Unknown animation/);
  const calls = [], context = { save: () => calls.push(['save']), restore: () => calls.push(['restore']), translate: (...a) => calls.push(['translate', ...a]), scale: (...a) => calls.push(['scale', ...a]), drawImage: (...a) => calls.push(['draw', ...a.slice(1)]) };
  const sheet = { image: {}, atlas };
  drawFrame(context, sheet, 'a', 100, 50, { scale: 2 }); // anchor (4, 6) lands on (100, 50); the trimmed rect sits at source (5, 1)
  assert.deepEqual(calls.pop(), ['draw', 4, 0, 2, 3, 102, 40, 4, 6]);
  drawFrame(context, sheet, 'a', 100, 50, { flipX: true });
  assert.deepEqual(calls.slice(-5), [['save'], ['translate', 99, 45], ['scale', -1, 1], ['draw', 4, 0, 2, 3, 0, 0, 2, 3], ['restore']]);
  drawFrame(context, sheet, 'b', 10, 10, { anchor: false });
  assert.deepEqual(calls.pop(), ['draw', 0, 0, 4, 4, 10, 10, 4, 4]);
  // Fractional positions snap to whole pixels, mirrored or not: a canvas would blend the edges of a sprite between pixels.
  drawFrame(context, sheet, 'b', 10.4, 9.6, { anchor: false, scale: 3 });
  assert.deepEqual(calls.pop(), ['draw', 0, 0, 4, 4, 10, 10, 12, 12]);
  drawFrame(context, sheet, 'a', 100.5, 49.5, { flipX: true });
  assert.deepEqual(calls.slice(-5), [['save'], ['translate', 100, 45], ['scale', -1, 1], ['draw', 4, 0, 2, 3, 0, 0, 2, 3], ['restore']]);
  // The loader resolves on the image's load event and never waits on decode().
  const saved = { fetch: globalThis.fetch, Image: globalThis.Image, document: globalThis.document };
  t.after(() => Object.assign(globalThis, saved));
  globalThis.document = { baseURI: 'http://local.test/assets/' };
  globalThis.fetch = async url => ({ ok: true, json: async () => ({ ...atlas, requested: String(url) }) });
  globalThis.Image = class { decode() { return new Promise(() => {}); } set src(value) { this.url = value; queueMicrotask(() => this.onload()); } };
  const loaded = await loadSpriteSheet('hero.atlas.json');
  assert.equal(loaded.atlas.requested, 'http://local.test/assets/hero.atlas.json');
  assert.equal(loaded.image.url, 'http://local.test/assets/sheet.png');
  globalThis.Image = class { set src(value) { queueMicrotask(() => this.onerror()); } };
  await assert.rejects(loadSpriteSheet('hero.atlas.json'), /Could not load atlas image/);
});

test('Canvas player keeps the full source size and draws trimmed frames at their offset', t => {
  const originalRAF = globalThis.requestAnimationFrame, originalCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {};
  t.after(() => { if (originalRAF) globalThis.requestAnimationFrame = originalRAF; else delete globalThis.requestAnimationFrame; if (originalCancel) globalThis.cancelAnimationFrame = originalCancel; else delete globalThis.cancelAnimationFrame; });
  const draws = [], ctx = { clearRect() {}, drawImage(...args) { draws.push(args.slice(1)); } };
  const canvas = { width: 0, height: 0, style: {}, getContext() { return ctx; } };
  const atlas = { frames: { a: { frame: { x: 4, y: 0, w: 2, h: 3 }, spriteSourceSize: { x: 5, y: 1, w: 2, h: 3 }, sourceSize: { w: 8, h: 6 }, duration: 50 } }, animations: { idle: { frames: ['a'], duration: 50, loop: true } } };
  new SpritePlayer(canvas, {}, atlas, { scale: 2 }).play('idle');
  assert.deepEqual([canvas.width, canvas.height], [16, 12]);
  assert.deepEqual(draws.at(-1), [4, 0, 2, 3, 10, 2, 4, 6]);
});
