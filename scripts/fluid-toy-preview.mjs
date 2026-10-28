// Draws the live fluid toy's link preview, playground/fluids/preview.png (1200 × 630, the size link cards use): a
// stoked campfire, poured honey and poured slime from the same live runner the page uses, under a title in Pixelbolt's
// own font, on the page's stage colour, at a whole-number scale. Refuses to replace the file without --force.
import { readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createLiveFluid } from '../src/fluid.js';
import { renderProject, scalePixels } from '../src/core.js';
import { encodePNG } from '../src/png.js';
import { STAGE, puffPoke, applyPoke } from '../playground/fluids/lib.js';

const root = new URL('../', import.meta.url), out = fileURLToPath(new URL('playground/fluids/preview.png', root));
const force = process.argv.includes('--force');
if (process.argv.slice(2).some(arg => arg !== '--force')) { console.error('Usage: node scripts/fluid-toy-preview.mjs [--force]'); process.exit(1); }
if (!force && await access(out).then(() => true, () => false)) { console.error(`${out} exists; add --force to replace it.`); process.exit(1); }

// 200 × 105 art pixels at 6× make exactly 1200 × 630.
const WIDTH = 200, HEIGHT = 105, SCALE = 6, canvas = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
for (let i = 0; i < WIDTH * HEIGHT; i++) canvas.set([...STAGE, 255], i * 4);
const paste = (rgba, width, height, left, top) => {
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const from = (y * width + x) * 4, alpha = rgba[from + 3], to = ((top + y) * WIDTH + left + x) * 4;
    if (!alpha || left + x < 0 || top + y < 0 || left + x >= WIDTH || top + y >= HEIGHT) continue;
    for (let c = 0; c < 3; c++) canvas[to + c] = Math.round((rgba[from + c] * alpha + canvas[to + c] * (255 - alpha)) / 255);
  }
};
// Each effect is poked as a visitor would, for a fixed number of frames, so the picture is the same every run.
async function poked(file, pour, frames) {
  const live = createLiveFluid(JSON.parse(await readFile(new URL(`examples/${file}`, root), 'utf8')));
  for (let t = 0; t < frames; t++) {
    if (t < pour.frames) applyPoke(live, puffPoke(live.kind === 'liquid' ? { x: live.width * pour.x, y: live.height * pour.y, radius: 2.5, density: 1 } : { x: live.width * pour.x, y: live.height * pour.y, radius: 3, density: 0.6, temperature: 1 }, live.kind));
    live.step();
  }
  return { ...live.render(), width: live.width, height: live.height };
}
// The campfire at the frame of its cycle with the most bright flame.
const brightest = async file => {
  const live = createLiveFluid(JSON.parse(await readFile(new URL(`examples/${file}`, root), 'utf8')));
  let best = null, most = -1;
  for (let t = 0; t < live.frames; t++) {
    const frame = live.step().render();
    let bright = 0;
    for (let i = 0; i < frame.rgba.length; i += 4) if (frame.rgba[i + 3] && frame.rgba[i] > 220 && frame.rgba[i + 1] > 150) bright++;
    if (bright > most) { most = bright; best = { ...frame, width: live.width, height: live.height }; }
  }
  return best;
};
const fire = await brightest('campfire.fluid.json');
const honey = await poked('honey.fluid.json', { frames: 0 }, 6);
const water = await poked('waterfall.fluid.json', { frames: 0 }, 10);
const slime = await poked('slime.fluid.json', { x: 0.5, y: 0.1, frames: 10 }, 60);
const effects = [fire, honey, water, slime], gap = 10, ground = 101;
let left = Math.floor((WIDTH - effects.reduce((sum, effect) => sum + effect.width, 0) - gap * (effects.length - 1)) / 2);
for (const effect of effects) { paste(effect.rgba, effect.width, effect.height, left, ground - effect.height); left += effect.width + gap; }

const title = renderProject({ version: 1, name: 'title', width: WIDTH, height: 22, palette: { ink: '#f2f0e4', soft: '#9fb6c9' }, frames: [{ name: 'title', duration: 100, ops: [
  { op: 'text', x: 100, y: 2, text: 'POKE THE PIXELS', color: 'ink', align: 'center' },
  { op: 'text', x: 100, y: 12, text: 'live fire, honey and slime', color: 'soft', align: 'center' }
] }] }).frames[0];
paste(title.data, WIDTH, 22, 0, 2);

await writeFile(out, encodePNG(scalePixels(canvas, WIDTH, HEIGHT, SCALE), WIDTH * SCALE, HEIGHT * SCALE));
console.log(`Wrote ${out} (${WIDTH * SCALE} × ${HEIGHT * SCALE}).`);
