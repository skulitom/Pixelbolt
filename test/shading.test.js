import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderProject, analyzeProject } from '../src/core.js';
import { prepareScene, renderScene } from '../src/scene.js';
import { resolveReferences, restorePaletteReference } from '../src/resolve.js';
import { createSceneBundle } from '../src/scene-export.js';

// Two ramps, stone (a darker than b darker than c) and moss (m darker than n); x is on no ramp.
const palette = { a: '#202020', b: '#606060', c: '#a0a0a0', m: '#204010', n: '#408020', x: '#ff00ff' };
const ramps = [['a', 'b', 'c'], ['m', 'n']];
const keyOf = new Map(Object.entries(palette).map(([key, hex]) => [hex.slice(1).match(/../g).map(h => parseInt(h, 16)).join() + ',255', key]));
const read = (data, width, height) => Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => {
  const at = (y * width + x) * 4; return data[at + 3] ? keyOf.get([...data.subarray(at, at + 4)].join()) ?? '?' : '.';
}).join(''));
const draw = (ops, extra = {}) => { const p = renderProject({ version: 1, name: 's', width: 6, height: 2, palette, ramps, frames: [{ name: 'a', ops }], ...extra }); return read(p.frames[0].data, 6, 2); };

test('shade moves each pixel along its own ramp, clamped at the ends, and keeps the palette', () => {
  const ground = { op: 'grid', rows: ['bbnnxa', 'ccnmxa'] };
  // One step darker: stone and moss each darken within their own ramp; x (on no ramp) and the darkest stone stay.
  assert.deepEqual(draw([ground, { op: 'shade' }]), ['aammxa', 'bbmmxa']);
  assert.deepEqual(draw([ground, { op: 'shade', steps: 2 }]), ['ccnnxc', 'ccnnxc']);
  // Region, ellipse and over limit where it applies; a density gives a dithered edge.
  assert.deepEqual(draw([ground, { op: 'shade', x: 2, w: 2, h: 1 }]), ['bbmmxa', 'ccnmxa']);
  assert.deepEqual(draw([ground, { op: 'shade', over: 'n' }]), ['bbmmxa', 'ccmmxa']);
  assert.deepEqual(draw([{ op: 'rect', w: 6, h: 2, color: 'c' }, { op: 'shade', density: 0.5, pattern: [[0, 1], [1, 0]] }]), ['bcbcbc', 'cbcbcb']);
  const round = renderProject({ version: 1, name: 'r', width: 6, height: 6, palette, ramps, frames: [{ name: 'a', ops: [{ op: 'rect', w: 6, h: 6, color: 'c' }, { op: 'shade', shape: 'ellipse', w: 6, h: 6 }] }] });
  assert.deepEqual(read(round.frames[0].data, 6, 6), ['cbbbbc', 'bbbbbb', 'bbbbbb', 'bbbbbb', 'bbbbbb', 'cbbbbc']);
  // Diagnostics find no colour outside the palette: shading never invents one.
  assert.equal(analyzeProject(round).findings.filter(f => f.code === 'palette').length, 0);
  // Frame palettes recolour ramps too, because ramps name keys.
  assert.deepEqual(draw([ground, { op: 'shade', over: 'c' }], { frames: [{ name: 'a', palette: { b: '#a0a0a0' }, ops: [{ op: 'grid', rows: ['cccccc', 'cccccc'] }, { op: 'shade' }] }] }), ['aaaaaa', 'aaaaaa']);
});

test('ramps and shade validate with actionable paths', () => {
  const fails = (extra, pattern) => assert.throws(() => renderProject({ version: 1, name: 's', width: 2, height: 2, palette, frames: [{ name: 'a', ops: [{ op: 'shade' }] }], ...extra }), pattern);
  fails({}, /ops\[0\]: shade moves colours along the recipe's ramps; declare ramps/);
  fails({ ramps: [['a']] }, /project\.ramps\[0\]: a ramp lists 2–32 palette keys from dark to light/);
  fails({ ramps: [['a', 'q']] }, /project\.ramps\[0\]\[1\]: expected a key of the project palette/);
  fails({ ramps: [['a', 'b'], ['b', 'c']] }, /project\.ramps\[1\]\[0\]: "b" is already in a ramp/);
  fails({ ramps, frames: [{ name: 'a', ops: [{ op: 'shade', steps: 0 }] }] }, /steps: expected a nonzero number of steps/);
  fails({ ramps, frames: [{ name: 'a', ops: [{ op: 'shade', shape: 'star' }] }] }, /shape: expected rect or ellipse/);
});

const scene = (instances, extra = {}) => ({ format: 'pixelforge-scene', version: 1, name: 'room', width: 6, height: 2, background: '#000000', assets: {
  floor: { version: 1, name: 'floor', width: 6, height: 2, palette, ramps, frames: [{ name: 'f', ops: [{ op: 'grid', rows: ['bbnnxc', 'ccnmxc'] }] }] },
  shadow: { version: 1, name: 'shadow', width: 2, height: 1, palette, ramps, anchor: [1, 0], frames: [{ name: 's', ops: [{ op: 'rect', w: 2, h: 1, color: 'a' }] }] },
  plain: { version: 1, name: 'plain', width: 1, height: 1, palette: { x: '#ff00ff' }, frames: [{ name: 'p', ops: [{ op: 'pixel', color: 'x' }] }] }
}, instances, ...extra });
const view = source => { const v = renderScene(prepareScene(source)); return read(v.data, v.width, v.height); };

test('shade placements darken whatever lies beneath along its ramps, so one shadow suits any floor', async () => {
  const rows = view(scene([{ asset: 'floor', at: [0, 0], frame: 'f' }, { asset: 'shadow', at: [1, 0], anchor: 'frame', frame: 's', shade: -1 }, { asset: 'shadow', at: [3, 1], anchor: 'frame', frame: 's', shade: -1 }]));
  assert.deepEqual(rows, ['aannxc', 'ccmmxc']);
  assert.throws(() => prepareScene(scene([{ asset: 'plain', at: [0, 0], frame: 'p', shade: -1 }])), /instances\[0\]\.shade: shade moves colours along ramps; declare ramps in plain's recipe/);
  // Scene exports write one atlas (and Godot SpriteFrames) per asset; ramps do not add passes.
  const bundle = await createSceneBundle(scene([{ asset: 'floor', at: [0, 0], frame: 'f' }, { asset: 'shadow', at: [1, 0], anchor: 'frame', frame: 's', shade: -1 }]));
  assert.deepEqual([...bundle.files.keys()].filter(file => file.startsWith('assets/')).sort(), ['assets/0/atlas.json', 'assets/0/color.png', 'assets/0/sprite_frames.tres', 'assets/0/tileset.tsx', 'assets/1/atlas.json', 'assets/1/color.png', 'assets/1/sprite_frames.tres', 'assets/1/tileset.tsx', 'assets/2/atlas.json', 'assets/2/color.png', 'assets/2/sprite_frames.tres', 'assets/2/tileset.tsx']);
  assert.throws(() => prepareScene(scene([{ asset: 'shadow', at: [0, 0], frame: 's', shade: 0 }])), /shade: expected a nonzero number of steps/);
});

test('ramp lighting moves colours along ramps instead of multiplying them, so a lit scene keeps its palette', () => {
  const lit = lighting => { const v = renderScene(prepareScene(scene([{ asset: 'floor', at: [0, 0], frame: 'f' }], { lighting }))); return read(v.data, v.width, v.height); };
  // Dim ambient light, no lamps: everything on a ramp goes one step darker (ambient 0.5, 2 steps per unit).
  assert.deepEqual(lit({ ambient: 0.5, scope: 'all', mode: 'ramp' }), ['aammxb', 'bbmmxb']);
  // A bright lamp at the left lifts that side a step above its authored colour; the far side stays dim.
  const lamp = lit({ ambient: 0.4, scope: 'all', mode: 'ramp', steps: 2, lights: [{ at: [0, 0], height: 1, radius: 3 }] });
  assert.equal(lamp[0][0], 'c');
  assert.equal(lamp[1][5], 'b');
  assert.ok(lamp.join('').split('').every(char => char !== '?'));
  assert.throws(() => prepareScene(scene([], { lighting: { mode: 'paint' } })), /lighting\.mode: expected multiply or ramp/);
  assert.throws(() => prepareScene(scene([], { lighting: { steps: 3 } })), /steps apply to ramp lighting; set mode to ramp/);
});

test('shared palette files may carry ramps, and themes override palette keys per scene or per asset', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pf-shade-'));
  try {
    await writeFile(path.join(dir, 'palette.json'), JSON.stringify({ palette, ramps }));
    await writeFile(path.join(dir, 'blue.json'), JSON.stringify({ c: '#0000ff', zz: '#123456' }));
    const recipe = { version: 1, name: 'floor', width: 2, height: 1, palette: { $ref: 'palette.json' }, frames: [{ name: 'f', ops: [{ op: 'grid', rows: ['cb'] }, { op: 'shade', x: 1, w: 1 }] }] };
    await writeFile(path.join(dir, 'floor.json'), JSON.stringify(recipe));
    const resolved = await resolveReferences(recipe, { baseDir: dir });
    assert.deepEqual(resolved.document.ramps, ramps);
    assert.deepEqual(read(renderProject(resolved.document).frames[0].data, 2, 1), ['ca']);
    // Saving an edit keeps the link: ramps that still match the shared file are not copied into the recipe.
    const restored = restorePaletteReference(recipe, { ...resolved.document, name: 'floor2' }, resolved);
    assert.deepEqual([restored.palette, restored.ramps], [{ $ref: 'palette.json' }, undefined]);
    // A scene palette file re-themes every asset; only keys the recipe has change, so extra keys do no harm.
    const source = { format: 'pixelforge-scene', version: 1, name: 'themed', width: 2, height: 1, palette: 'blue.json', assets: { floor: 'floor.json', tinted: { recipe: 'floor.json', palette: { c: '#00ff00' } } },
      instances: [{ asset: 'floor', at: [0, 0], frame: 'f' }] };
    const themed = (await resolveReferences(source, { baseDir: dir })).document;
    assert.deepEqual(themed.palette, { c: '#0000ff', zz: '#123456' });
    const first = renderScene(prepareScene(themed));
    assert.deepEqual([...first.data.subarray(0, 4)], [0, 0, 255, 255]);
    const second = renderScene(prepareScene({ ...themed, instances: [{ asset: 'tinted', at: [0, 0], frame: 'f' }] }));
    assert.deepEqual([...second.data.subarray(0, 4)], [0, 255, 0, 255]);
    assert.throws(() => prepareScene({ ...source, assets: { floor: resolved.document } }), /scene\.palette: palette files are resolved by the CLI and MCP/);
    assert.throws(() => prepareScene({ ...themed, palette: { c: 'blue' } }), /scene\.palette\.c: unknown color "blue"/);
    // Checked even when no asset has the key.
    assert.throws(() => prepareScene({ ...themed, palette: { nothing: '#12' } }), /scene\.palette\.nothing: unknown color "#12"/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
