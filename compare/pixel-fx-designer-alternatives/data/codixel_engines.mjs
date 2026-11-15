// Renders Codixel's four effects (the same calls and settings as the page's codixel_effects.cjs, without file
// writes) in Node and in headless Chromium, Firefox and WebKit, and compares a 64-bit FNV-style hash of every frame buffer.
// usage: PLAYWRIGHT_MODULE=... [CHROMIUM_EXE=...] [FIREFOX_EXE=...] node codixel_engines.mjs <core/pixel.js> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [corePath, outPath] = process.argv.slice(2);
const coreSrc = readFileSync(corePath, 'utf8');

// Same as codixel_effects.cjs render(name, null, false), returning frame buffers.
const RENDER = `(P) => {
  const DT = 0.08, BG = [24, 26, 38], out = {};
  { const fx = new P.Flame({}); out.flame = []; for (let f = 0; f < 24; f++) { const b = new P.Buf(64, 72); fx.draw(b, 32, 70, f * DT); out.flame.push(b); } }
  { const fx = new P.Smoke({}); out.smoke = []; for (let f = 0; f < 24; f++) { const b = new P.Buf(128, 120); fx.draw(b, 64, 116, f * DT); out.smoke.push(b); } }
  { const fx = new P.HellFire(64, 64, {}); fx.step(1, 2, 60); out.hellfire = []; for (let f = 0; f < 24; f++) { fx.step(1, 2, 1); const b = new P.Buf(64, 64); fx.draw(b, 0, 64); out.hellfire.push(b); } }
  { const list = P.volley(0, 3, { stagger: 0.15 }); out.beams = []; for (let f = 0; f < 20; f++) { const b = new P.Buf(240, 135); b.clear(BG); P.beams(b, list, f * DT); out.beams.push(b); } }
  return out;
}`;

const FNV = `(px) => { let h1 = 0x811c9dc5 | 0, h2 = 0x01000193 ^ 0x5bd1e995; for (let i = 0; i < px.length; i++) { const v = px[i] >>> 0; h1 = Math.imul(h1 ^ v, 0x01000193); h2 = Math.imul(h2 ^ (v >>> 7) ^ i, 0x5bd1e995); } return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0'); }`;
const fnvFn = eval(FNV);
const require = createRequire(import.meta.url);
const P = require(resolve(corePath));
const nodeFrames = eval(RENDER)(P);
const nodeHash = {};
for (const [k, frames] of Object.entries(nodeFrames)) nodeHash[k] = frames.map((b) => fnvFn(b.px));

const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const engines = [
  ['chromium', pw.chromium, { ...(process.env.CHROMIUM_EXE && { executablePath: process.env.CHROMIUM_EXE }), args: ['--disable-gpu'] }],
  ['firefox', pw.firefox, { ...(process.env.FIREFOX_EXE && { executablePath: process.env.FIREFOX_EXE }) }],
  ['webkit', pw.webkit, {}],
];
const result = { node: process.version, nodeHash, engines: {} };
for (const [name, type, opts] of engines) {
  const browser = await type.launch({ headless: true, ...opts });
  const page = await browser.newPage();
  await page.setContent('<!doctype html><title>codixel</title>');
  await page.addScriptTag({ content: coreSrc });
  const hashes = await page.evaluate(([renderSrc, fnvSrc]) => {
    const frames = (0, eval)(renderSrc)(globalThis.P), h = (0, eval)(fnvSrc);
    const out = {};
    for (const [k, list] of Object.entries(frames)) out[k] = list.map((b) => h(b.px));
    return out;
  }, [RENDER, FNV]);
  const cmp = {};
  for (const k of Object.keys(nodeHash)) cmp[k] = { framesMatching: hashes[k].filter((h, i) => h === nodeHash[k][i]).length, frames: nodeHash[k].length };
  result.engines[name] = { version: browser.version(), cmp };
  console.log(name, browser.version(), JSON.stringify(cmp));
  await browser.close();
}
writeFileSync(outPath, JSON.stringify(result, null, 1));
process.exit(0);
