import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject } from '../src/core.js';
import { compileEffects } from '../src/fx.js';
import { resolveReferences } from '../src/resolve.js';
import { EFFECT_PRESETS, effectOf } from '../studio/effects-controls.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = (effects, extra = {}) => ({ format: 'pixelforge-fx', version: 1, name: 'fx', width: 32, height: 32,
  palette: { w: '#fff', y: '#fd6', o: '#e83', k: '#223', s: '#5a6' },
  symbols: { dot: ['w'], warm: ['y'], figure: ['.ss.', 'ssss', 'ssss', '.ss.', '.ss.'] }, effects, ...extra });
const pixelsOf = recipe => { const project = renderProject(recipe); return new Map(project.frames.map((frame, i) => [recipe.frames[i].name, frame.data])); };
const drawnOn = data => { let n = 0; for (let i = 3; i < data.length; i += 4) if (data[i]) n++; return n; };

test('a compile reports the canvas sides each animation draws on, and warns unless the effect lists the side in edges', () => {
  const ring = (extra = {}) => compileEffects(source({ edge: { frames: 3, looks: { warm: { colors: ['y'], thresholds: [0.2] } }, layers: [{ kind: 'ring', at: [16, 24], radius: 12, width: 2 }], ...extra } }));
  const cut = ring();
  assert.deepEqual(Object.keys(cut.metadata.effects.edge.edges), ['bottom']);
  assert.deepEqual(cut.metadata.effects.edge.edges.bottom.frames, [0, 2]);
  assert.ok(cut.metadata.effects.edge.edges.bottom.pixels > 0);
  assert.equal(cut.warnings.length, 1);
  assert.match(cut.warnings[0], /^fx\.effects\.edge: edge draws on the canvas's bottom edge \(bottom: up to \d+ pixels a frame, frames 0–2\), so whatever reaches past it is cut off/);
  // Listing the side keeps the report and drops the warning; a ring well inside touches nothing.
  const listed = ring({ edges: ['bottom'] });
  assert.equal(listed.warnings, undefined);
  assert.deepEqual(listed.metadata.effects.edge.edges, cut.metadata.effects.edge.edges);
  const inside = compileEffects(source({ edge: { frames: 3, looks: { warm: { colors: ['y'], thresholds: [0.2] } }, layers: [{ kind: 'ring', at: [16, 16], radius: 8, width: 2 }] } }));
  assert.equal(inside.metadata.effects.edge.edges, undefined);
  assert.equal(inside.warnings, undefined);
  for (const bad of [['up'], ['top', 'top'], 'top']) assert.throws(() => ring({ edges: bad }), /edges: expected the canvas sides/);
});

test('edges turn with a turned copy: a side listed for the drawn effect is the side its turned copies may touch', () => {
  // A beam running off the right edge, turned a quarter (down), a half (left) and an eighth (toward the lower right corner).
  const beam = edges => compileEffects(source({ beam: { frames: 2, looks: { warm: { colors: ['y'], thresholds: [0.2] } }, layers: [{ kind: 'beam', at: [16, 16], to: [40, 16], width: 3 }],
    turn: { angles: [0, 45, 90, 180], about: [16, 16] }, ...(edges && { edges }) } }));
  const warned = beam().warnings.map(w => w.match(/: (beam-\d+) draws on the canvas's (.*?) edges? \(/).slice(1));
  assert.deepEqual(warned, [['beam-0', 'right'], ['beam-45', 'right and bottom'], ['beam-90', 'bottom'], ['beam-180', 'left']]);
  assert.equal(beam(['right']).warnings, undefined);
});

test('depth splits an effect into the parts behind and in front of a character, which together give the whole', () => {
  const buff = { frames: 6, loop: true, seed: 4,
    looks: { glow: { colors: ['o', 'y', 'w'], thresholds: [0.2, 0.5, 0.8], outline: 'k' } },
    layers: [{ kind: 'ring', look: 'glow', at: [16, 24], radius: 10, width: 3, squash: [1, 0.35], depth: 'split' },
      { kind: 'beam', look: 'glow', at: [16, 24], to: [16, 6], width: 4, waves: 1, depth: 'back' }],
    emitters: [{ at: [16, 24], ring: { radius: 10, squash: [1, 0.35] }, rate: 1.5, angle: [265, 275], speed: 0.6, life: [4, 6], shapes: ['dot', 'warm'], depth: 'split' }] };
  const { recipe, metadata } = compileEffects(source({ buff }));
  assert.deepEqual(Object.keys(recipe.animations), ['buff', 'buff-back', 'buff-front']);
  assert.deepEqual(metadata.effects.buff.parts, { back: 'buff-back', front: 'buff-front' });
  assert.deepEqual(metadata.effects['buff-front'].part, { of: 'buff', side: 'front' });
  assert.deepEqual(recipe.animations['buff-back'].frames, ['buff-back-0', 'buff-back-1', 'buff-back-2', 'buff-back-3', 'buff-back-4', 'buff-back-5']);
  const at = pixelsOf(recipe);
  let back = 0, front = 0;
  for (let f = 0; f < 6; f++) {
    const whole = at.get(`buff-${f}`), under = at.get(`buff-back-${f}`), over = at.get(`buff-front-${f}`);
    back += drawnOn(under); front += drawnOn(over);
    // Opaque colours: each pixel of the whole is the front's where it draws, else the back's.
    for (let i = 0; i < whole.length; i += 4) {
      const from = over[i + 3] ? over : under;
      assert.deepEqual([...from.slice(i, i + 4)], [...whole.slice(i, i + 4)], `frame ${f} pixel ${i / 4}`);
    }
    // Nothing of the beam (the back) reaches the front, and the ring's far half (above its centre) stays behind.
    for (let y = 0; y < 21; y++) for (let x = 0; x < 32; x++) assert.equal(over[(y * 32 + x) * 4 + 3] !== 0 && under[(y * 32 + x) * 4 + 3] !== 0, false);
  }
  assert.ok(back > 0 && front > 0);
  // The lab's controls edit the effect a part belongs to.
  assert.equal(effectOf(metadata, 'buff-back'), 'buff');
});

test('a stand-in drawn between the sides shows only in the whole effect, and children follow their parent particle', () => {
  const stand = { frames: 4, emitters: [
    { name: 'up', at: [16, 20], area: [12, 1], burst: 6, angle: 270, speed: 1, life: 2, shapes: ['dot'], depth: 'back' },
    { from: 'up', when: 'death', burst: 1, life: 2, shapes: ['warm'] },
    { sprite: { symbol: 'figure', draw: true }, at: [14, 12], depth: 'between' }] };
  const { recipe } = compileEffects(source({ stand }));
  const at = pixelsOf(recipe), figure = [0x55, 0xaa, 0x66];
  const shows = data => { for (let i = 0; i < data.length; i += 4) if (data[i] === figure[0] && data[i + 1] === figure[1] && data[i + 2] === figure[2] && data[i + 3]) return true; return false; };
  for (let f = 0; f < 4; f++) {
    assert.equal(shows(at.get(`stand-${f}`)), true);
    assert.equal(shows(at.get(`stand-back-${f}`)) || shows(at.get(`stand-front-${f}`)), false);
  }
  // Every particle, the dying ones' children included, is behind: the front part draws nothing.
  for (let f = 0; f < 4; f++) assert.equal(drawnOn(at.get(`stand-front-${f}`)), 0);
  assert.ok(recipe.frames.find(frame => frame.name === 'stand-back-3').ops.some(op => op.symbol === 'warm'));
});

test('depth is checked: between is for a sprite that only draws, split for spawned particles, and part names are free', () => {
  const one = (emitter, more = {}) => () => compileEffects(source({ e: { frames: 2, emitters: [emitter] }, ...more }));
  assert.throws(one({ at: [4, 4], burst: 1, shapes: ['dot'], depth: 'between' }), /between is for a stand-in/);
  assert.throws(one({ sprite: { symbol: 'figure', draw: true }, at: [4, 4], depth: 'split' }), /split goes by where each particle is born/);
  assert.throws(one({ at: [4, 4], burst: 1, shapes: ['dot'], depth: 'under' }), /expected front, back, split/);
  assert.throws(() => compileEffects(source({ e: { frames: 2, looks: { warm: { colors: ['y'], thresholds: [0.2] } }, layers: [{ kind: 'ring', at: [9, 9], radius: 4, depth: 'far' }] } })), /expected front, back, or split/);
  const behind = { at: [4, 4], burst: 1, shapes: ['dot'], depth: 'back' }, plain = { frames: 2, emitters: [{ at: [4, 4], burst: 1, shapes: ['dot'] }] };
  assert.throws(() => compileEffects(source({ e: { frames: 2, emitters: [behind] }, 'e-back': plain })), /e draws something behind a character, so it also makes the animation e-back/);
  assert.throws(() => compileEffects(source({ 'e-front': plain, e: { frames: 2, emitters: [behind] } })), /e draws something behind a character, so it also makes the animation e-front/);
  // An effect wholly in front makes no parts.
  assert.deepEqual(Object.keys(compileEffects(source({ e: { frames: 2, emitters: [{ ...behind, depth: 'front' }] } })).recipe.animations), ['e']);
});

test('a light point and cues reach the back and front parts too', () => {
  const lit = { frames: 3, light: true, looks: { warm: { colors: ['w'], thresholds: [0.2] } },
    layers: [{ kind: 'ring', at: [16, 16], radius: 6, width: 3, squash: [1, 0.4], depth: 'split', cue: 'hit' }] };
  const { recipe } = compileEffects(source({ lit }));
  const frame = name => recipe.frames.find(f => f.name === name);
  for (const part of ['lit-0', 'lit-back-0', 'lit-front-0']) {
    assert.deepEqual(frame(part).points.light, frame('lit-0').points.light, part);
    assert.deepEqual(frame(part).points.hit, [16, 16], part);
  }
});

test('every effect example compiles without warnings, and the Effects lab presets stay off the canvas edges at seeds 2, 3 and 7', async () => {
  const lab = new Set(EFFECT_PRESETS.map(preset => preset.file));
  for (const file of (await readdir(path.join(root, 'examples'))).filter(name => name.endsWith('.fx.json'))) {
    const { document } = await resolveReferences(JSON.parse(await readFile(path.join(root, 'examples', file), 'utf8')), { baseDir: path.join(root, 'examples') });
    assert.equal(compileEffects(document).warnings, undefined, file);
    if (!lab.has(file.slice(0, -'.fx.json'.length))) continue;
    for (const seed of [2, 3, 7]) {
      const reseeded = structuredClone(document);
      for (const effect of Object.values(reseeded.effects)) effect.seed = seed;
      assert.deepEqual((compileEffects(reseeded).warnings ?? []).filter(text => text.includes(' draws on the canvas')), [], `${file} at seed ${seed}`);
    }
  }
});
