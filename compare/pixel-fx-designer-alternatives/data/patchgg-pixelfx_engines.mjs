// Renders the same six patch-gg/pixelfx effects as patchgg-pixelfx_measure.py (default settings) in Node and in
// headless Chromium, Firefox and WebKit, and compares a 64-bit FNV-style hash of every frame's RGBA bytes.
// In Node the frames come from pixelfx's own renderFrames (tools/lib/fxlib.mjs, the `clear` image its sprite sheet
// uses). Browsers can't load that file (it imports node:fs), so they run RENDER below, a copy of renderFrames' steps for
// that image (createFx, update at 1/fps, draw, edgeFade, composite over nothing); Node runs RENDER too, as a check that
// the copy matches. pixelfx's files reach the browsers through Playwright's request routing from the local checkout:
// nothing is fetched from a network. This script is ours (Pixelbolt's makers), not part of pixelfx.
//
// usage: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs [CHROMIUM_EXE=...] [FIREFOX_EXE=...]
//        node patchgg-pixelfx_engines.mjs <pixelfx checkout> <out.json>
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join, extname } from "node:path";
import { pathToFileURL } from "node:url";

const [root, outPath] = process.argv.slice(2).map((p) => resolve(p));
const IDS = ["fire/campfire", "explosions/smoke-bomb", "explosions/big-explosion", "water/splash", "lightning/lightning-strike", "arcane/portal"];

// renderFrames' steps for the `clear` frames, with edgeFade copied from tools/lib/fxlib.mjs (MIT, Patch).
const RENDER = `async (base, id) => {
  const core = await import(base + "src/core/index.js");
  const mod = await import(base + "src/fx/" + id + ".js");
  const meta = { fps: 30, bg: "dark", loop: false, duration: 1, tags: [], options: {}, ...mod.meta };
  const [W, H] = meta.size, [OX, OY] = meta.origin, fps = meta.fps;
  const n = Math.max(1, Math.round(meta.duration * fps) + (meta.loop ? 0 : 1));
  const isScreen = meta.size[0] >= 320 && Math.abs(meta.size[0] / meta.size[1] - 16 / 9) < 0.05;
  const edgeFade = (f, E = 8) => {
    const { w, h, light: L } = f;
    for (let y = 0; y < h; y++) {
      const ey = Math.min(y, h - 1 - y);
      for (let x = 0; x < w; x++) {
        const e = Math.min(ey, x, w - 1 - x);
        if (e >= E) { x = w - 1 - E; continue; }
        const i = y * w + x, l = L[i];
        if (!(l & 0xffffff)) continue;
        const u = (e + 0.5) / E, k = u * u * (3 - 2 * u);
        L[i] = (l & 0xff000000) | Math.round((l & 255) * k) | (Math.round(((l >>> 8) & 255) * k) << 8) | (Math.round(((l >>> 16) & 255) * k) << 16);
      }
    }
  };
  const bare = core.createFrame(W, H, 0, 0), shown = core.createFrame(W, H, 0, 0);
  const inst = core.createFx({ ...mod, meta }, { x: OX, y: OY });
  const out = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) inst.update(1 / fps);
    // the same draw calls as renderFrames (none of these six effects has a character)
    core.clearFrame(shown);
    core.clearFrame(bare);
    inst.draw(bare);
    inst.draw(shown, "back");
    inst.draw(shown, "front");
    if (!isScreen) edgeFade(bare);
    out.push(HASH(core.composite(bare, new Uint8ClampedArray(W * H * 4), null)));
  }
  return out;
}`;
const HASH_SRC = `(bytes) => { const px = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2); let h1 = 0x811c9dc5 | 0, h2 = 0x01000193 ^ 0x5bd1e995; for (let i = 0; i < px.length; i++) { const v = px[i] >>> 0; h1 = Math.imul(h1 ^ v, 0x01000193); h2 = Math.imul(h2 ^ (v >>> 7) ^ i, 0x5bd1e995); } return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0"); }`;
const HASH = (0, eval)(HASH_SRC);
const renderIn = (0, eval)(`(HASH) => ${RENDER}`);

// Node, through pixelfx's own renderFrames, and through RENDER.
const lib = await import(pathToFileURL(join(root, "tools/lib/fxlib.mjs")).href);
const nodeOwn = {}, nodeCopy = {};
for (const id of IDS) {
  const r = lib.renderFrames(await lib.loadEffect(id), {});
  nodeOwn[id] = r.frames.map((f) => HASH(f.clear));
  nodeCopy[id] = await renderIn(HASH)(pathToFileURL(root).href + "/", id);
}
const copyMatches = Object.fromEntries(IDS.map((id) => [id, nodeOwn[id].length === nodeCopy[id].length && nodeOwn[id].every((h, i) => h === nodeCopy[id][i])]));
console.log("node", process.version, "copy matches renderFrames:", JSON.stringify(copyMatches));

const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const engines = [
  ["chromium", pw.chromium, { ...(process.env.CHROMIUM_EXE && { executablePath: process.env.CHROMIUM_EXE }), args: ["--disable-gpu"] }],
  ["firefox", pw.firefox, { ...(process.env.FIREFOX_EXE && { executablePath: process.env.FIREFOX_EXE }) }],
  ["webkit", pw.webkit, {}],
];
const ORIGIN = "http://pixelfx.test/";
const result = { node: process.version, copyMatchesRenderFrames: copyMatches, frames: Object.fromEntries(IDS.map((id) => [id, nodeOwn[id].length])), nodeHashFirstLast: Object.fromEntries(IDS.map((id) => [id, [nodeOwn[id][0], nodeOwn[id].at(-1)]])), engines: {} };
for (const [name, type, opts] of engines) {
  const browser = await type.launch({ headless: true, ...opts });
  const context = await browser.newContext();
  let outside = 0;
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (!url.startsWith(ORIGIN)) { outside++; return route.abort(); }
    const rel = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, "");
    if (rel === "" || rel === "index.html") return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>pixelfx</title>" });
    const file = join(root, rel);
    if (!file.startsWith(root) || !existsSync(file)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, contentType: extname(file) === ".js" ? "text/javascript" : "application/octet-stream", body: readFileSync(file) });
  });
  const page = await context.newPage();
  await page.goto(ORIGIN + "index.html");
  const cmp = {};
  for (const id of IDS) {
    const hashes = await page.evaluate(async ([renderSrc, hashSrc, base, id]) => {
      const HASH = (0, eval)(hashSrc);
      return (0, eval)(`(HASH) => ${renderSrc}`)(HASH)(base, id);
    }, [RENDER, HASH_SRC, ORIGIN, id]);
    cmp[id] = { framesMatching: hashes.filter((h, i) => h === nodeOwn[id][i]).length, frames: nodeOwn[id].length, browserFrames: hashes.length };
  }
  result.engines[name] = { version: browser.version(), cmp, requestsOutsideOrigin: outside };
  console.log(name, browser.version(), JSON.stringify(cmp), "outside requests:", outside);
  await browser.close();
}
writeFileSync(outPath, JSON.stringify(result, null, 1) + "\n");
process.exit(0);
