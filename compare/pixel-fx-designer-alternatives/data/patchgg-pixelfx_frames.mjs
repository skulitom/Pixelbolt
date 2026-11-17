// Writes every frame of one patch-gg/pixelfx effect as its own RGBA PNG, using pixelfx's own functions:
// loadEffect and renderFrames from tools/lib/fxlib.mjs (what its `node tools/render.mjs <id>` calls) and encodePNG from
// tools/lib/png.mjs. Each file is a frame's transparent `clear` image, the one pixelfx pastes into its sprite sheet.
// No settings of ours: renderFrames gets no fps, seed or options unless --opts is given (then as `--opts` in
// tools/render.mjs, passed to the effect). This script is ours (Pixelbolt's makers), not part of pixelfx.
//
// usage: node patchgg-pixelfx_frames.mjs <pixelfx checkout> <effect id, e.g. fire/campfire> <new out dir> [--opts JSON]
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [root, id, out, ...rest] = process.argv.slice(2);
if (!root || !id || !out) {
  console.error("usage: node patchgg-pixelfx_frames.mjs <pixelfx checkout> <effect id> <out dir> [--opts JSON]");
  process.exit(2);
}
const opts = rest[0] === "--opts" ? JSON.parse(rest[1]) : undefined;
const lib = await import(pathToFileURL(resolve(root, "tools/lib/fxlib.mjs")).href);
const { encodePNG } = await import(pathToFileURL(resolve(root, "tools/lib/png.mjs")).href);

const t0 = performance.now();
const fx = await lib.loadEffect(id);
const r = lib.renderFrames(fx, opts ? { options: opts } : {});
const t1 = performance.now();
r.frames.forEach((f, i) => lib.save(join(out, "frames", String(i).padStart(3, "0") + ".png"), encodePNG(r.w, r.h, f.clear)));
const t2 = performance.now();
const m = fx.meta;
console.log(JSON.stringify({
  id, name: m.name, w: r.w, h: r.h, frames: r.n, fps: r.fps, loop: m.loop, duration_s: m.duration,
  origin: m.origin, actor: !!m.actor, options_given: opts ?? null, default_options: m.options,
  ms: { render: Math.round((t1 - t0) * 10) / 10, write_png: Math.round((t2 - t1) * 10) / 10 },
}));
