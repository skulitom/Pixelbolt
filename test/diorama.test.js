import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveReferences } from '../src/resolve.js';
import { prepareScene, renderScene } from '../src/scene.js';
import { parseColor } from '../src/core.js';

const root = fileURLToPath(new URL('..', import.meta.url)), art = path.join(root, 'showcase/diorama/art');
const load = async name => (await resolveReferences(JSON.parse(await readFile(path.join(art, name), 'utf8')), { baseDir: art })).document;

test('diorama: the committed sources match build.mjs', () => {
  assert.match(execFileSync(process.execPath, ['showcase/diorama/build.mjs', '--check'], { cwd: root, encoding: 'utf8' }), /All diorama sources match build\.mjs/);
});

test('diorama: every scene, lit or re-themed, keeps exactly its palette', async () => {
  const { palette } = JSON.parse(await readFile(path.join(art, 'palette.json'), 'utf8'));
  const blue = { ...palette, ...JSON.parse(await readFile(path.join(art, 'palette-blue.json'), 'utf8')) };
  for (const [file, colours] of [['room.scene.json', palette], ['room-blue.scene.json', blue], ['room-night.scene.json', palette]]) {
    const allowed = new Set(Object.values(colours).map(hex => parseColor(hex).join()));
    const scene = prepareScene(await load(file));
    for (const time of [0, 600, 1300, 2300]) {
      const view = renderScene(scene, { time }), seen = new Set();
      for (let at = 0; at < view.data.length; at += 4) seen.add([...view.data.subarray(at, at + 4)].join());
      assert.deepEqual([...seen].filter(colour => !allowed.has(colour)), [], `${file} at ${time} ms`);
      assert.deepEqual(view.warnings, [], file);
    }
  }
});

test('diorama: by night the torch and candle lights follow their placements and flicker, and the pot flashes on the strike', async () => {
  const scene = prepareScene(await load('room-night.scene.json')), lights = time => renderScene(scene, { time }).lights;
  // Torches stand at y 23 and their lights 4 pixels above the flames; every light keeps to its placement.
  assert.deepEqual(lights(0).map(light => light.at), [[52, 19], [108, 19], [68, 98], [92, 98], [107, 70]]);
  const torch = Array.from({ length: 24 }, (_, k) => lights(k * 100)[0].strength);
  assert.ok(new Set(torch).size > 5 && Math.min(...torch) >= 0.65 && Math.max(...torch) <= 1.35, JSON.stringify(torch));
  // The flash is dark until strike+70 (1270 ms), peaks at strike+100 and is out again by strike+380.
  assert.deepEqual([1200, 1300, 1580].map(time => lights(time)[4].strength), [0, 2.5, 0]);
  // The flames keep their own colours (lit: false). Without it the night would shade some of them.
  const source = await load('room-night.scene.json'), flames = ['torch-left', 'torch-right', 'candles-left', 'candles-right'];
  const shaded = prepareScene({ ...source, instances: source.instances.map(({ lit, ...instance }) => instance) });
  const unlit = renderScene(scene, { time: 0, lit: false }), boxes = unlit.placements.filter(p => flames.includes(p.name));
  const fire = new Set(['#e2703a', '#fbc95e', '#fff3c2'].map(hex => parseColor(hex).join()));
  const flamePixels = boxes.flatMap(box => Array.from({ length: box.w * box.h }, (_, k) => ((box.y + Math.floor(k / box.w)) * unlit.width + box.x + k % box.w) * 4))
    .filter(at => fire.has([...unlit.data.subarray(at, at + 4)].join()));
  const differ = view => flamePixels.filter(at => view.data.subarray(at, at + 4).some((v, c) => v !== unlit.data[at + c])).length;
  assert.ok(flamePixels.length > 20, `${flamePixels.length} flame pixels`);
  assert.equal(differ(renderScene(scene, { time: 0 })), 0);
  assert.ok(differ(renderScene(shaded, { time: 0 })) > 0, 'without lit: false the night shades some flame pixels');
  // The loop has no seam: the end of the scene is its start.
  assert.deepEqual(renderScene(scene, { time: 2400 }).lights, lights(0));
});

test('diorama: the hero is drawn behind the barrel it walks past, and the smear only shows during the strike', async () => {
  const scene = prepareScene(await load('room.scene.json'));
  const order = time => renderScene(scene, { time }).placements.map(p => p.name);
  // The barrel in the middle of the room (column 7, its top-left at x 60) stands lower than the hero's path, so it is
  // drawn after the hero; at 600 ms the two overlap.
  const placements = renderScene(scene, { time: 600 }).placements, barrel = placements.findIndex(p => p.name === 'barrel' && p.x === 60), hero = placements.findIndex(p => p.name === 'hero');
  assert.ok(barrel > hero && hero >= 0, `barrel ${barrel}, hero ${hero}`);
  const [a, b] = [placements[barrel], placements[hero]];
  assert.ok(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, 'they overlap');
  assert.equal(order(1200).includes('slash'), false);
  assert.equal(order(1300).includes('slash'), true);
  assert.equal(order(1500).includes('slash'), false);
});
