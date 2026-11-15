// Renders one of Codixel's built-in effects (core/pixel.js) through its documented API and writes
// PNG frames, a P.pack sprite sheet and a P.gif animation. No LLM or agent is involved.
//
// usage: node codixel_effects.cjs <path/to/core/pixel.js> <flame|smoke|hellfire|beams> <new-empty-outdir>
//            [--cols <json colour list>] [--quantize <json palette>]
//
// Settings are the core's defaults; canvas size, frame count and time step are ours (Codixel ships
// no example scripts), and are printed with the timings on stdout.
"use strict";
const fs = require("fs");
const path = require("path");

const [corePath, effect, outDir, ...rest] = process.argv.slice(2);
if (!corePath || !effect || !outDir) {
  console.error("usage: node codixel_effects.cjs <core/pixel.js> <effect> <outdir> [--cols json] [--quantize json]");
  process.exit(2);
}
const opt = {};
for (let i = 0; i < rest.length; i += 2) opt[rest[i].replace(/^--/, "")] = JSON.parse(rest[i + 1]);

const t0 = process.hrtime.bigint();
const P = require(path.resolve(corePath));
const tLoad = process.hrtime.bigint();

const DT = 0.08; // seconds per frame; P.gif's default delay is 80 ms
const DELAY = 80;
const BG = [24, 26, 38]; // a dark scene colour, used only where noted

function render(name, cols, onBg) {
  const frames = [];
  if (name === "flame") {
    // new P.Flame(opt): defaults height 48, width 14; draw(buf, x, ground, t)
    const fx = new P.Flame(cols ? { cols } : {});
    for (let f = 0; f < 24; f++) {
      const b = new P.Buf(64, 72);
      if (onBg) b.clear(BG);
      fx.draw(b, 32, 70, f * DT);
      frames.push(b);
    }
  } else if (name === "smoke") {
    // new P.Smoke(opt): defaults height 84, see-through alpha bands
    const fx = new P.Smoke(cols ? { cols } : {});
    for (let f = 0; f < 24; f++) {
      const b = new P.Buf(128, 120);
      if (onBg) b.clear(BG);
      fx.draw(b, 64, 116, f * DT);
      frames.push(b);
    }
  } else if (name === "hellfire") {
    // new P.HellFire(w, h, opt); step(power, cool, steps) each frame; draw(buf, x, ground)
    const fx = new P.HellFire(64, 64, cols ? { cols } : {});
    fx.step(1, 2, 60); // warm-up: 60 steps before the first captured frame
    for (let f = 0; f < 24; f++) {
      fx.step(1, 2, 1);
      const b = new P.Buf(64, 64);
      if (onBg) b.clear(BG);
      fx.draw(b, 0, 64);
      frames.push(b);
    }
  } else if (name === "beams") {
    // P.volley(t0, n, {w, h, stagger}) then P.beams(buf, list, t, cols) each frame.
    // Beams mix into what is already drawn and flash the screen, so they are drawn on a filled scene.
    // volley's default screen is 240x135, so the buffer is too
    const list = P.volley(0, 3, { stagger: 0.15 });
    for (let f = 0; f < 20; f++) {
      const b = new P.Buf(240, 135);
      b.clear(BG);
      if (cols) P.beams(b, list, f * DT, cols);
      else P.beams(b, list, f * DT);
      frames.push(b);
    }
  } else throw new Error("unknown effect " + name);
  return frames;
}

const cols = opt.cols || null;
let frames = render(effect, cols, false);
const tRender = process.hrtime.bigint();
if (opt.quantize) frames = frames.map((b) => P.quantize(b, opt.quantize.length, { palette: opt.quantize }).buf);
const hasPartAlpha = frames.some((b) => b.px.some((c) => { const a = c >>> 24; return a > 0 && a < 255; }));
// SKILL.md: "A GIF cannot be see-through, so fill the background before making one."
let gifFrames = frames;
if (hasPartAlpha) {
  gifFrames = render(effect, cols, true);
  if (opt.quantize) gifFrames = gifFrames.map((b) => P.quantize(b, opt.quantize.length, { palette: opt.quantize }).buf);
}

fs.mkdirSync(outDir, { recursive: false });
fs.mkdirSync(path.join(outDir, "frames"));
frames.forEach((b, i) => P.save(b, path.join(outDir, "frames", `f${String(i).padStart(2, "0")}.png`)));
const sheet = P.pack(frames, { cols: 8 });
P.save(sheet, path.join(outDir, "sheet.png"));
fs.writeFileSync(path.join(outDir, "anim.gif"), P.gif(gifFrames, { delay: DELAY }));
const tEnd = process.hrtime.bigint();

const ms = (a, b) => Number(b - a) / 1e6;
process.stdout.write(JSON.stringify({
  effect,
  cols,
  quantize: opt.quantize || null,
  frames: frames.length,
  frame: { w: frames[0].w, h: frames[0].h },
  sheet: sheet.frame,
  gif_delay_ms: DELAY,
  gif_on_filled_background: hasPartAlpha || effect === "beams",
  seconds_per_frame: DT,
  ms: { load: ms(t0, tLoad), render: ms(tLoad, tRender), write_and_gif: ms(tRender, tEnd), total_in_process: ms(t0, tEnd) },
}) + "\n");
