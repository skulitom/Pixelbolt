// The greybox reel (showcase/greybox-reel): one scene that turns a greybox platformer screen into finished art, a
// layer per cue. These tests keep the committed sources in step with build.mjs and each cue doing its one swap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveReferences } from '../src/resolve.js';
import { prepareScene, renderScene } from '../src/scene.js';

const root = fileURLToPath(new URL('..', import.meta.url)), art = path.join(root, 'showcase/greybox-reel/art');
const loadScene = async () => prepareScene((await resolveReferences(JSON.parse(await readFile(path.join(art, 'reel.scene.json'), 'utf8')), { baseDir: art })).document);

test('greybox reel: the committed sources and stage sheet match build.mjs', () => {
  assert.match(execFileSync(process.execPath, ['showcase/greybox-reel/build.mjs', '--check'], { cwd: root, encoding: 'utf8' }), /All greybox reel sources match build\.mjs/);
});

test('greybox reel: each cue swaps one layer of grey stand-ins for art, without warnings', async () => {
  const scene = await loadScene();
  assert.deepEqual([scene.width * 5, scene.height * 5, scene.duration], [1080, 1080, 12000], 'fills 1080 × 1080 at 5× for 12 s');
  const at = time => {
    const view = renderScene(scene, { time });
    assert.deepEqual(view.warnings, [], `${time} ms`);
    const frame = name => view.placements.find(p => p.name === name)?.frame;
    // Whether a pixel is one of the greybox's neutral greys.
    const grey = (x, y) => { const [r, g, b] = view.data.subarray((y * view.width + x) * 4); return Math.max(r, g, b) - Math.min(r, g, b) <= 12; };
    return { frame, drawn: name => view.placements.some(p => p.name === name), grey };
  };
  const before = time => at(time - 1), after = time => at(time);
  // player
  assert.equal(before(1400).frame('hero'), 'grey');
  assert.match(after(1400).frame('hero'), /^run-/);
  // tiles: the ground under the hero's start turns from grey to grass and dirt
  assert.equal(before(2700).grey(40, 190), true);
  assert.equal(after(2700).grey(40, 190), false);
  assert.equal(after(2700).frame('lamp-2'), 'lamp-off');
  // sky, then the far and near planes, each replacing its grey blocks
  assert.equal(before(4000).drawn('sky'), false);
  assert.equal(after(4000).frame('sky'), 'day');
  for (const [time, plane] of [[5300, 'far'], [6600, 'near']]) {
    assert.deepEqual([before(time).drawn(`grey-${plane}`), before(time).drawn(plane)], [true, false], plane);
    assert.deepEqual([after(time).drawn(`grey-${plane}`), after(time).frame(plane)], [false, 'day'], plane);
  }
  // pickups and the enemy
  assert.equal(before(7900).frame('slime'), 'grey');
  assert.equal(after(7900).frame('slime'), 'rest');
  assert.equal(after(7900).frame('coin-17'), 'spin-0');
  // lighting: by the end the sky is night, the lamps and windows are lit and the wisp follows the hero
  const night = at(11000);
  assert.deepEqual(['sky', 'far', 'near', 'lamp-2', 'lamp-5'].map(night.frame), ['night', 'night', 'night', 'lamp-on', 'lamp-on']);
  assert.ok(night.drawn('near-glow') && night.drawn('far-glow') && night.drawn('wisp'));
  assert.equal(before(9200).drawn('wisp'), false);
});
