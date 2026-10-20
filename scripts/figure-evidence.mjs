// Existing skink evidence for M0. This preserves the source and writes only previously absent output files.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { renderProject, inspectProject, scalePixels } from '../src/core.js';
import { encodePNG } from '../src/png.js';
import { encodeGIF } from '../src/gif.js';

const directory = new URL('../docs/images/figures/', import.meta.url);
await mkdir(directory, { recursive: true });
const recipe = JSON.parse(await readFile(new URL('../examples/quality/skink.json', import.meta.url), 'utf8'));
const project = renderProject(recipe), save = (name, bytes) => writeFile(new URL(name, directory), bytes, { flag: 'wx' });
for (const [name, scale, view] of [['m0-skink-native', 1, 'color'], ['m0-skink-4x', 4, 'color'], ['m0-skink-silhouette', 4, 'silhouette']]) {
  const { sheet } = inspectProject(project, { animation: 'run', scale, view, background: '#182239' });
  await save(`${name}.png`, encodePNG(sheet.data, sheet.width, sheet.height));
}
// A fixed camera follows the sprite at 48 px/s. Ground tick marks travel left at that speed; the sprite's actual
// authored timing and native pixels are preserved. This is evidence of the old motion, not a claimed contact fix.
const frames = [], width = 64, height = 32;
let time = 0;
for (const index of project.animations.run.frames) {
  const frame = project.frames[index], shift = Math.round(time * 48 / 1000);
  const ground = renderProject({
    version: 1, name: 'ground', width, height, background: '#182239',
    frames: [{ name: 'tick', ops: [
      { op: 'rect', x: 0, y: 26, w: width, h: 6, color: '#26354c' },
      ...Array.from({ length: 10 }, (_, i) => ({ op: 'pixel', x: i * 8 - shift % 8, y: 27, color: '#72967d' }))
    ] }]
  }).frames[0].data;
  for (let y = 0; y < project.height; y++) for (let x = 0; x < project.width; x++) {
    const from = (y * project.width + x) * 4;
    if (frame.data[from + 3]) ground.set(frame.data.subarray(from, from + 4), (y * width + x + 16) * 4);
  }
  frames.push({ data: ground, duration: frame.duration }); time += frame.duration;
}
const gif = encodeGIF(frames, width, height, { scale: 4 });
await save('m0-skink-ground.gif', gif.data);
// A static strip permits inspecting every exported moving-ground frame without relying on a GIF viewer.
const strip = new Uint8ClampedArray(width * frames.length * height * 4);
frames.forEach((frame, i) => {
  for (let y = 0; y < height; y++) strip.set(frame.data.subarray(y * width * 4, (y + 1) * width * 4), (y * width * frames.length + i * width) * 4);
});
await save('m0-skink-ground-strip.png', encodePNG(scalePixels(strip, width * frames.length, height, 4), width * frames.length * 4, height * 4));
console.log(JSON.stringify({ directory: directory.href, speed: 48, delays: gif.delays, sourceDelays: frames.map(f => f.duration), partialAlpha: gif.partialAlpha }));
