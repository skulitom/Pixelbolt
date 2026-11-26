import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, buildAtlas, parseColor } from '../src/core.js';
import { compilePoses } from '../src/authoring.js';
import { animationGIF } from '../src/gif.js';
import { spriteFrames } from '../src/godot.js';
import { prepareScene, renderScene } from '../src/scene.js';
import { resolveReferences } from '../src/resolve.js';
import { COMPILERS } from '../src/presets.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const FOUR_WAY_KITS = ['four-way-knight', 'four-way-mage', 'four-way-ranger'];

const opaqueBox = (data, width, height) => {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY };
};

const mirrorHorizontally = (data, width, height) => {
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4, dst = (y * width + (width - 1 - x)) * 4;
      out[dst] = data[src]; out[dst + 1] = data[src + 1]; out[dst + 2] = data[src + 2]; out[dst + 3] = data[src + 3];
    }
  }
  return out;
};

for (const kit of FOUR_WAY_KITS) {
  test(`character kit ${kit}: 4-way consistency, pixel-exact mirror symmetry, palette discipline and engine exports`, async () => {
    const source = JSON.parse(await readFile(path.join(root, 'examples', `${kit}.poses.json`), 'utf8'));
    const first = compilePoses(source), second = compilePoses(source);
    assert.deepEqual(first.recipe, second.recipe, `${kit}: compile must be deterministic`);
    assert.equal(first.warnings, undefined, `${kit}: unexpected compile warnings`);

    const project = renderProject(first.recipe);
    assert.equal(project.clipping, undefined, `${kit}: no clipped pixels`);

    // Complete 4-direction coverage (stand + 8-frame walk in every cardinal direction).
    for (const dir of ['down', 'up', 'right', 'left']) {
      assert.ok(project.animations[`stand-${dir}`], `${kit}: missing stand-${dir}`);
      const walk = project.animations[`walk-${dir}`];
      assert.ok(walk, `${kit}: missing walk-${dir}`);
      assert.equal(walk.frames.length, 8, `${kit}: walk-${dir} should have 8 frames`);
      assert.equal(walk.loop, true, `${kit}: walk-${dir} should loop`);
    }

    // Strict palette adherence: every opaque pixel must match a declared palette RGBA.
    const allowed = new Set(Object.values(source.palette).map(hex => parseColor(hex, {}, 'palette').join(',')));
    for (const frame of project.frames) {
      for (let i = 0; i < frame.data.length; i += 4) {
        if (frame.data[i + 3] === 0) continue;
        const rgba = `${frame.data[i]},${frame.data[i + 1]},${frame.data[i + 2]},${frame.data[i + 3]}`;
        assert.ok(allowed.has(rgba), `${kit} ${frame.name}: off-palette pixel ${rgba}`);
      }
    }

    // Pixel-exact horizontal mirror symmetry between right and left stand + walk frames.
    const assertMirrorPair = (rightAnim, leftAnim) => {
      const rFrames = project.animations[rightAnim].frames, lFrames = project.animations[leftAnim].frames;
      assert.equal(rFrames.length, lFrames.length);
      for (let i = 0; i < rFrames.length; i++) {
        const rf = project.frames[rFrames[i]], lf = project.frames[lFrames[i]];
        assert.deepEqual(lf.data, mirrorHorizontally(rf.data, project.width, project.height), `${kit}: ${leftAnim}[${i}] must mirror ${rightAnim}[${i}]`);
      }
    };
    assertMirrorPair('stand-right', 'stand-left');
    assertMirrorPair('walk-right', 'walk-left');

    // Ground-contact consistency: walk frames stay grounded within 2 px of standing baseline (no floating/sinking).
    for (const dir of ['down', 'up', 'right', 'left']) {
      const standBox = opaqueBox(project.frames[project.animations[`stand-${dir}`].frames[0]].data, project.width, project.height);
      for (const fi of project.animations[`walk-${dir}`].frames) {
        const box = opaqueBox(project.frames[fi].data, project.width, project.height);
        assert.ok(Math.abs(box.maxY - standBox.maxY) <= 2, `${kit} walk-${dir} frame ${fi}: ground baseline drifted (${box.maxY} vs ${standBox.maxY})`);
      }
    }

    // Export readiness: Atlas + Godot 4 SpriteFrames .tres + Animated GIF all succeed cleanly.
    const atlas = buildAtlas(project);
    assert.ok(atlas.width > 0 && atlas.height > 0);
    const { text: tres } = spriteFrames(atlas.metadata, `${kit}.png`);
    assert.match(tres, /\[gd_resource type="SpriteFrames"/);
    assert.match(tres, /&"walk-right"/);
    const gif = animationGIF(project, 'walk-right', { scale: 2 });
    assert.equal(Buffer.from(gif.data).toString('ascii', 0, 6), 'GIF89a');
  });
}

test('editable lit camp-clearing scene compiles character rigs, derived normals, autotile meadow and fluid campfire', async () => {
  const raw = JSON.parse(await readFile(path.join(root, 'examples', 'camp-clearing.scene.json'), 'utf8'));
  const resolved = await resolveReferences(raw, { baseDir: path.join(root, 'examples'), compilers: COMPILERS });
  const prepared = prepareScene(resolved.document);
  assert.deepEqual(prepared.warnings, []);
  const frameA = renderScene(prepared, { time: 0 });
  const frameB = renderScene(prepared, { time: 440 });
  assert.deepEqual(frameA.warnings, []);
  assert.deepEqual(frameB.warnings, []);
  assert.notDeepEqual(frameA.data, frameB.data, 'animated lit scene must advance between frames');
  // Deterministic replay at the exact same timestamp.
  assert.deepEqual(frameA.data, renderScene(prepared, { time: 0 }).data);
});
