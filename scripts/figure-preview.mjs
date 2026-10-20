// Reusable visual evidence. Existing evidence is compared, never overwritten.
import { readFile, writeFile } from 'node:fs/promises';
import { renderProject, scalePixels } from '../src/core.js';
import { encodeGIF } from '../src/gif.js';
import { encodePNG } from '../src/png.js';

export async function saveEvidence(file, bytes) {
  try {
    const previous = await readFile(file);
    if (!previous.equals(Buffer.from(bytes))) throw new Error(`Evidence changed: ${file}. Choose a new prefix to preserve the earlier result.`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFile(file, bytes, { flag: 'wx' });
  }
}

export async function movingGroundPreview(project, directory, prefix, names, { speed = 48, ground = project.height - 1 } = {}) {
  const width = project.width, height = project.height, frames = [];
  let time = 0;
  for (const name of names) {
    const frame = project.frames.find(f => f.name === name);
    if (!frame) throw new Error(`No evidence frame ${name}`);
    const shift = Math.round(time * speed / 1000);
    const data = renderProject({
      version: 1, name: 'ground', width, height, background: '#182239',
      frames: [{ name: 'reference', ops: [
        { op: 'rect', x: 0, y: ground, w: width, h: Math.max(1, height - ground), color: '#26354c' },
        ...Array.from({ length: Math.ceil(width / 8) + 1 }, (_, i) => ({ op: 'pixel', x: i * 8 - shift % 8, y: ground, color: '#72967d' }))
      ] }]
    }).frames[0].data;
    for (let i = 0; i < data.length; i += 4) if (frame.data[i + 3]) data.set(frame.data.subarray(i, i + 4), i);
    frames.push({ data, duration: frame.duration }); time += frame.duration;
  }
  const gif = encodeGIF(frames, width, height, { scale: 4 });
  await saveEvidence(new URL(`${prefix}-ground.gif`, directory), gif.data);
  const stripWidth = width * frames.length, strip = new Uint8ClampedArray(stripWidth * height * 4);
  frames.forEach((frame, i) => {
    for (let y = 0; y < height; y++) strip.set(frame.data.subarray(y * width * 4, (y + 1) * width * 4), (y * stripWidth + i * width) * 4);
  });
  await saveEvidence(new URL(`${prefix}-ground-strip.png`, directory), encodePNG(scalePixels(strip, stripWidth, height, 4), stripWidth * 4, height * 4));
  return { speed, ground, delays: gif.delays, partialAlpha: gif.partialAlpha };
}
