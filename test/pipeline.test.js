import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { encodePNG, encodeAPNG } from '../src/png.js';
import { decodePNG, importPNG } from '../src/import.js';
import { renderProject, buildAtlas } from '../src/core.js';
import { prepareScene, renderScene, inspectTile } from '../src/scene.js';
import { createSceneBundle } from '../src/scene-export.js';
const asset = { version: 1, name: 'probe', width: 2, height: 2, frames: [{ name: 'a', duration: 75, pixels: [{ x: 0, y: 0, color: '#ff002280' }, { x: 1, y: 1, color: '#12345600' }] }, { name: 'b', duration: 125, ops: [{ op: 'pixel', x: 1, color: '#fff' }] }], animations: { once: { frames: ['b', 'a', 'a'], loop: false } }, sheet: { padding: 1 } };
const scene = { format: 'pixelforge-scene', version: 1, name: 'room', width: 8, height: 8, assets: { prop: asset }, instances: [{ name: 'placed', asset: 'prop', at: [3, 4], anchor: [1, 1], animation: 'once', sequence: [{ time: 300, frame: 'b' }] }] };
test('native RGBA PNG and atlas roundtrip preserve hidden RGB, alpha, order, timing and once flags', () => {
  const rendered = renderProject(asset), atlas = buildAtlas(rendered), bytes = encodePNG(atlas.data, atlas.width, atlas.height);
  assert.deepEqual(decodePNG(bytes).data, atlas.data);
  const imported = importPNG(bytes, { name: 'returned', atlas: atlas.metadata });
  const again = renderProject(imported.recipe);
  assert.deepEqual(again.frames, rendered.frames); assert.deepEqual(again.animations, rendered.animations);
  assert.equal(imported.provenance.lossless, true);
  assert.ok(imported.recipe.frames[0].ops[0].rows);
  assert.equal(imported.recipe.frames[0].pixels.length, 1); // Hidden RGB remains exact despite the compact grid.
  assert.throws(() => importPNG(bytes, { atlas: { ...atlas.metadata, meta: { scale: '2' } } }), /unscaled/);
  const corrupt = Buffer.from(bytes); corrupt[30] ^= 1; assert.throws(() => decodePNG(corrupt), /CRC/);
  assert.throws(() => decodePNG(bytes.subarray(0, bytes.length - 5)), /truncated/);
  assert.throws(() => decodePNG(encodeAPNG(rendered.frames, 2, 2, true)), /acTL/);
});
test('scene honors anchors, playback durations, state changes and persistent aftermath', () => {
  const prepared = prepareScene(scene), a = renderScene(prepared, { time: 0 }), b = renderScene(prepared, { time: 125 }), settled = renderScene(prepared, { time: 900 });
  assert.deepEqual(a.placements[0], { name: 'placed', frame: 'b', x: 2, y: 3, w: 2, h: 2, scale: 1 });
  assert.equal(b.placements[0].frame, 'a'); assert.equal(settled.placements[0].frame, 'b');
  assert.deepEqual(renderScene(prepared, { time: 900 }).data, settled.data);
  assert.throws(() => prepareScene({ ...scene, instances: [{ ...scene.instances[0], scale: 1.25 }] }), /fractional/);
  assert.throws(() => prepareScene({ ...scene, instances: Array(5).fill({ ...scene.instances[0], repeat: [32, 32] }) }), /4,096 draws/);
  assert.throws(() => prepareScene({ ...scene, instances: [{ ...scene.instances[0], repeat: [32, 32], scale: 16 }, { ...scene.instances[0], repeat: [32, 32], scale: 16 }, { ...scene.instances[0], repeat: [32, 32], scale: 16 }, { ...scene.instances[0], repeat: [32, 32], scale: 16 }, scene.instances[0]] }), /4,194,304 drawing pixels/);
  assert.throws(() => prepareScene({ ...scene, instances: [{ ...scene.instances[0], sequence: [{ time: 4, frame: 'a' }, { time: 3, frame: 'b' }] }] }), /increase strictly/);
  const moving = prepareScene({ ...scene, instances: [{ ...scene.instances[0], trajectory: [{ time: 0, at: [3, 4] }, { time: 100, at: [6, 4] }] }] });
  assert.equal(renderScene(moving, { time: 50 }).placements[0].x, 4);
  assert.equal(renderScene(moving, { time: 900 }).placements[0].x, 5);
});
test('material passes align exactly; light direction changes hand-authored normals and unlit pixels remain intact', async () => {
  const recipe = { version: 1, name: 'color', width: 1, height: 1, frames: [{ name: 'a', ops: [{ op: 'pixel', color: '#888' }] }] };
  const normal = { ...recipe, name: 'normal', frames: [{ name: 'a', ops: [{ op: 'pixel', color: '#008080' }] }] };
  const emissive = { ...recipe, name: 'emission', frames: [{ name: 'a', ops: [{ op: 'pixel', color: '#100000' }] }] };
  const source = { ...scene, width: 1, height: 1, assets: { prop: { recipe, normal, emissive } }, instances: [{ asset: 'prop', at: [0, 0] }], lighting: { ambient: .1, bands: 8, lights: [{ at: [-20, 0], height: 1, radius: 100 }] } };
  const left = renderScene(prepareScene(source));
  const other = structuredClone(source); other.lighting.lights[0].at = [20, 0];
  assert.ok(left.data[0] > renderScene(prepareScene(other)).data[0]);
  assert.deepEqual([...renderScene(prepareScene(source), { lit: false }).data], [136, 136, 136, 255]);
  const mismatch = structuredClone(source); mismatch.assets.prop.normal.frames[0].duration = 99;
  assert.throws(() => prepareScene(mismatch), /share color frame/);
  const bundle = await createSceneBundle(source), contract = JSON.parse(bundle.files.get('alignment.json'));
  assert.equal(contract.assets.prop.passes.normal, 'assets/0/normal.png');
  assert.equal(JSON.parse(bundle.files.get('assets/0/atlas.json')).meta.image, 'color.png');
  for (const file of Object.values(contract.assets.prop.passes)) assert.equal(decodePNG(bundle.files.get(file)).width, 1);
});
test('tile repeat exposes a seeded doubled edge line and leaves a clean tile unflagged', () => {
  const edged = renderProject({ version: 1, name: 'edged', width: 4, height: 4, palette: { g: '#4a9a4a', k: '#1b1528' }, frames: [
    { name: 'lined', ops: [{ op: 'rect', w: 4, h: 4, color: 'g' }, { op: 'line', x2: 0, y2: 3, color: 'k' }, { op: 'line', x: 3, x2: 3, y2: 3, color: 'k' }] },
    { name: 'clean', ops: [{ op: 'rect', w: 4, h: 4, color: 'g' }, { op: 'pixel', x: 1, y: 1, color: 'k' }] }
  ] });
  const tile = inspectTile(edged, 'lined');
  assert.equal(tile.width, 12); assert.equal(tile.height, 12);
  assert.deepEqual(tile.leftRight.doubledRows, [0, 1, 2, 3]); assert.equal(tile.leftRight.suspicious, true);
  assert.equal(inspectTile(edged, 'clean').leftRight.suspicious, false);
});
test('quality examples validate, preserve source poses and create deterministic scenes', async () => {
  const source = JSON.parse(await readFile(new URL('../examples/quality/hollow.scene.json', import.meta.url), 'utf8'));
  const scene = prepareScene(source);
  assert.deepEqual(renderScene(scene, { time: 1500 }).data, renderScene(prepareScene(source), { time: 1500 }).data);
  assert.equal(renderScene(scene, { time: 2000 }).placements.find(p => p.name === 'crystal').frame, 'fallen');
  assert.equal(renderScene(scene, { time: 1320 }).placements.find(p => p.name === 'spoken-spark').frame, 'crescent');
  assert.equal(renderScene(scene, { time: 1400 }).placements.find(p => p.name === 'spoken-spark').frame, 'empty');
  assert.equal(renderScene(scene, { time: 1400 }).placements.find(p => p.name === 'crystal').frame, 'impact');
});
