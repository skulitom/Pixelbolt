import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, createSequence, createBodiesSequence } from '../src/index.js';
import { compileBodies, bodiesFrames } from '../src/bodies.js';

// bodiesFrames steps a match frame after frame for video frames (src/sequence.js); every frame it shows must be the
// frame compileBodies draws, whatever the frame rate, the pictures and the names.
const root = fileURLToPath(new URL('../', import.meta.url));
const example = async name => JSON.parse(await readFile(path.join(root, 'examples', `${name}.bodies.json`), 'utf8'));
const same = (a, b) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
const pngs = files => [...files].filter(([name]) => name.endsWith('.png')).map(([name, bytes]) => [name, bytes.toString('base64')]);

test('a match sampled below its frame rate shows the frames its recipe draws', async () => {
  // A body's drawn place and angle hold from frame to frame. Drawn only on the frames shown, crate-topple's turning
  // crates came out different in three of every second frame; crate-smash's pieces are held the same way.
  for (const preset of ['crate-topple', 'crate-smash']) {
    const source = await example(preset), frames = renderProject(compileBodies(source).recipe).frames;
    for (const step of [2, 3]) {
      const match = bodiesFrames(source);
      for (let f = 0; f < match.frames; f += step) assert.ok(same(match.image(f), frames[f].data), `${preset} every ${step}: frame ${f}`);
    }
  }
  // The same through the sequence a video editor gets: 10 frames a second from a 25-frame match.
  const source = await example('crate-topple');
  assert.deepEqual(pngs(createBodiesSequence(source, { fps: 10 }).files), pngs(createSequence(renderProject(compileBodies(source).recipe), { fps: 10 }).files));
});

test('a match with a 60-character effect name draws past frame 999', () => {
  // Each shown frame was rendered as a one-frame recipe named after the effect and the frame number, over the
  // renderer's 64 characters from frame 1000 of a 60-character name.
  const name = `e${'x'.repeat(59)}`, source = {
    format: 'pixelforge-bodies', version: 1, name: 'long', width: 16, height: 16, palette: { w: '#eeeeee' },
    effects: { [name]: { frames: 1001, duration: 40, bodies: [{ shape: 'circle', radius: 2, at: [8, 4], fill: 'w', bounce: 0.9 }] } }
  };
  const match = bodiesFrames(source, name);
  assert.equal(match.image(1000).length, 16 * 16 * 4);
  assert.equal(match.figures().frames, 1001);
});
