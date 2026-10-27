import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject } from '../src/core.js';
import { compileEffects } from '../src/fx.js';
import { SHAPE_KINDS, atan2Deg } from '../src/shapes.js';
import { spellPresets } from '../scripts/spell-presets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const palette = { k: '#112', b: '#24a', c: '#5af', W: '#fff', o: '#f93', y: '#fe6', g: '#2a5', s: '#999' };
const looks = { cool: { colors: ['b', 'c', 'W'], thresholds: [0.15, 0.45, 0.8] }, warm: { colors: ['o', 'y', 'W'], thresholds: [0.2, 0.5, 0.8] } };
const source = (effect, extra = {}) => ({ format: 'pixelforge-fx', version: 1, name: 'shapes', width: 48, height: 48, palette, effects: { hit: { frames: 8, looks, ...effect } }, ...extra });
// One layer of each kind, as the docs describe them.
const LAYERS = {
  ring: { kind: 'ring', look: 'warm', at: [24, 30], radius: [4, 20], width: [5, 2], squash: [1, 0.45], noise: 0.4, power: [1.2, 0.5] },
  slash: { kind: 'slash', look: 'cool', at: [22, 26], radius: 18, width: [8, 6], arc: [195, 345], squash: [1, 0.7], tilt: -15 },
  beam: { kind: 'beam', look: 'cool', at: [4, 24], to: [44, 24], width: [1, 7, 5, 0], wobble: 0.2, fade: 0.3 },
  bolt: { kind: 'bolt', look: 'cool', at: [26, 0], to: [22, 44], width: [3, 1], glow: [2, 1], branches: 3, flicker: 0.3 },
  glyph: { kind: 'glyph', look: 'cool', at: [24, 30], radius: 20, inner: 0.65, squash: [1, 0.45], points: 4, step: 1, runes: 8, double: true, spin: [0, 20], glow: 0, fill: [0, 0.2, 0] },
  star: { kind: 'star', look: 'warm', at: [24, 24], radius: [16, 4], width: [3, 1], points: 8, power: [1.3, 0.6], jitter: 0.2 },
  burst: { kind: 'burst', look: 'warm', at: [24, 26], radius: [6, 18], hole: [0, 0.3], power: [1.4, 1] }
};
const visible = rows => rows.join('').replace(/\./g, '').length;
const gridOf = frame => (frame.ops ?? []).find(op => op.op === 'grid');

test('atan2Deg matches Math.atan2 to a billionth of a degree, clockwise from +x with y down', () => {
  for (const [y, x, degrees] of [[0, 1, 0], [1, 0, 90], [0, -1, 180], [-1, 0, 270], [0, 0, 0]]) assert.equal(atan2Deg(y, x), degrees);
  for (const [y, x, degrees] of [[1, 1, 45], [1, -1, 135], [-1, -1, 225], [-1, 1, 315]]) assert.ok(Math.abs(atan2Deg(y, x) - degrees) < 1e-9);
  for (let k = 0; k < 2000; k++) {
    const x = Math.sin(k * 12.9898) * 40, y = Math.cos(k * 78.233) * 40, expected = ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
    const got = atan2Deg(y, x), difference = Math.abs(got - expected);
    assert.ok(got >= 0 && got < 360 && Math.min(difference, 360 - difference) < 1e-9, `atan2Deg(${y}, ${x}) = ${got}, expected ${expected}`);
  }
});

test('every shape kind compiles alone into an ordinary recipe of one grid per frame in its window, without symbols or emitters', () => {
  assert.deepEqual(SHAPE_KINDS, Object.keys(LAYERS));
  for (const [kind, layer] of Object.entries(LAYERS)) {
    const { recipe, metadata } = compileEffects(source({ layers: [{ ...layer, frames: [1, 7] }] }));
    assert.equal(recipe.symbols, undefined, kind);
    const project = renderProject(recipe);
    assert.deepEqual(project.warnings, [], kind);
    assert.deepEqual(metadata.effects.hit.layers, [{ kind, look: layer.look, frames: [1, 7] }]);
    recipe.frames.forEach((frame, i) => {
      const grid = gridOf(frame), inside = i >= 1 && i < 7;
      if (!inside) assert.equal(grid, undefined, `${kind} draws nothing outside its window (frame ${i})`);
      else {
        assert.ok(grid && visible(grid.rows) > 0, `${kind} draws in frame ${i}`);
        // Every drawn key belongs to the layer's look.
        const keys = new Set(grid.rows.join('').replace(/\./g, ''));
        for (const key of keys) assert.ok(looks[layer.look].colors.includes(key), `${kind} frame ${i} draws ${key}`);
        assert.ok(grid.x >= 0 && grid.y >= 0 && grid.x + grid.rows[0].length <= 48 && grid.y + grid.rows.length <= 48, `${kind} stays on the canvas`);
      }
    });
  }
});

test('shape layers compile to golden recipes, the same every time', () => {
  const all = source({ cleanup: { corners: true, strays: true }, layers: Object.values(LAYERS).map((layer, i) => ({ ...layer, frames: [i % 3, 8] })) });
  const first = compileEffects(all), second = compileEffects(structuredClone(all));
  assert.deepEqual(first, second);
  // These change with any change to the shapes' pixels: regenerate them deliberately, after looking at the art.
  const golden = {};
  for (const [kind, layer] of Object.entries(LAYERS)) golden[kind] = sha(compileEffects(source({ layers: [layer] })).recipe);
  golden.all = sha(first.recipe);
  assert.deepEqual(golden, {
    ring: '61b165d169c36d373c64f88e298539c008ece0b0c635b570d91e3d270037bb26', slash: 'd492d264e470aebe75138384c462467d31f879264e81c1074587e715d31a0ec6',
    beam: '1a6015f6ac97c80ecff26e8e5b7258c9211613df1440c5c55f7f336ead225420', bolt: 'd54bdf63f41345c64b9ab402feb72ebdf809f1fbde4a71a8e63a6b06f9a3acee',
    glyph: '69221282a0198e368d410b9398d735b0e7f1e5959bd21933693472c65b92c802', star: '1a508a7b8019118c88f0a4a26b581d11c480546e45e498de6a09e2fabfc6c7d4',
    burst: '4151bac6ad5f35c106bdfde17ea8ae0249eaaa4bdbd1599d57a93f414378ae2c', all: '257505288a5f06496383b48891b0fe07da0201662aa8339589fe267bab8bc8e5'
  });
});

test('a beam\'s squash flattens its round ends alone, so a pillar stands on the ground of its circle', () => {
  const pillar = extra => {
    const grid = gridOf(compileEffects(source({ layers: [{ kind: 'beam', look: 'cool', at: [24, 40], to: [24, 14], width: 16, reveal: 0, wobble: 0, ...extra }] })).recipe.frames[0]);
    const widthAt = y => grid.rows[y - grid.y].replace(/^\.+|\.+$/g, '').length;
    return { lowest: grid.y + grid.rows.length - 1, top: grid.y, body: widthAt(20), foot: widthAt(40) };
  };
  const round = pillar(), flat = pillar({ squash: [1, 0.42] });
  // A round foot reaches most of the half width (8) below `at`; squashed by 0.42 it reaches under half as far.
  assert.ok(round.lowest >= 45, `round foot ends at ${round.lowest}`);
  assert.ok(flat.lowest <= 43, `flat foot ends at ${flat.lowest}`);
  assert.ok(flat.top >= round.top + 3, 'the far end flattens too');
  assert.equal(flat.body, round.body, 'the body keeps its width');
  assert.equal(flat.foot, round.foot, 'the foot is as wide as the body');
});

test('a falling power erodes a shape band by band, and reveals already show the first frame', () => {
  const counts = power => compileEffects(source({ layers: [{ ...LAYERS.star, radius: 14, width: 3, power }] })).recipe.frames.map(f => visible(gridOf(f)?.rows ?? []));
  const steady = counts(1), fading = counts([1.2, 0.2]);
  assert.ok(steady.every(n => n === steady[0]));
  for (let i = 1; i < fading.length; i++) assert.ok(fading[i] <= fading[i - 1], `frame ${i} draws no more than frame ${i - 1}: ${fading}`);
  assert.ok(fading.at(-1) < fading[0] / 2);
  for (const kind of ['slash', 'beam', 'bolt', 'glyph']) {
    const { recipe } = compileEffects(source({ layers: [{ ...LAYERS[kind], reveal: 0.5 }] }));
    assert.ok(visible(gridOf(recipe.frames[0]).rows) > 0, `${kind} shows in the first frame of its reveal`);
  }
});

test('shapes draw between behind particles and the rest; looks draw in order with cleanup and outlines', () => {
  const { recipe } = compileEffects(source({
    looks: { under: { colors: ['g'], thresholds: [0.1] }, over: { colors: ['W'], thresholds: [0.5], outline: 'k' } },
    layers: [{ kind: 'burst', look: 'under', at: [24, 24], radius: 12, noise: 0 }, { kind: 'star', look: 'over', at: [24, 24], radius: 18, points: 4, power: 1 }],
    emitters: [{ at: [24, 24], burst: 2, life: 8, shapes: ['smoke'], behind: true }, { at: [24, 24], burst: 2, life: 8, shapes: ['spark'] }]
  }, { symbols: { smoke: ['s'], spark: ['y'] } }));
  const ops = recipe.frames[0].ops;
  assert.deepEqual(ops.map(op => op.op === 'grid' ? 'grid' : op.symbol), ['smoke', 'smoke', 'grid', 'spark', 'spark']);
  const grid = gridOf(recipe.frames[0]), at = (x, y) => grid.rows[y - grid.y][x - grid.x];
  // The later look draws over the earlier one; its outline takes only empty pixels, never the burst under it.
  assert.equal(at(24, 24), 'W');
  assert.equal(at(30, 30), 'g');
  assert.ok(grid.rows.join('').includes('k'));
  for (let y = 0; y < grid.rows.length; y++) for (let x = 0; x < grid.rows[0].length; x++) if (grid.rows[y][x] === 'k') {
    const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => grid.rows[y + dy]?.[x + dx]);
    assert.ok(near.includes('W'), `outline at ${x + grid.x},${y + grid.y} touches the star`);
  }
});

test('a layer cue marks its first frame as a point, beside emitter cues', () => {
  const { recipe, metadata } = compileEffects(source({ layers: [{ ...LAYERS.star, frames: [2, 6], cue: 'hit' }, { ...LAYERS.ring, frames: [3, 8], cue: 'shake' }] }));
  assert.deepEqual(recipe.frames[2].points, { hit: [24, 24] });
  assert.deepEqual(recipe.frames[3].points, { shake: [24, 30] });
  assert.deepEqual(metadata.effects.hit.cues, [{ name: 'hit', frame: 2, at: [24, 24] }, { name: 'shake', frame: 3, at: [24, 30] }]);
});

test('shape mistakes name the field to fix', () => {
  const bad = (effect, where, message, extra) => assert.throws(() => compileEffects(source(effect, extra)), error => error.path === where && (!message || message.test(error.message)), where);
  bad({ layers: [{ ...LAYERS.ring, kind: 'wave' }] }, 'fx.effects.hit.layers[0].kind', /ring, slash/);
  bad({ layers: [{ ...LAYERS.ring, arc: [0, 90] }] }, 'fx.effects.hit.layers[0].arc');
  bad({ layers: [{ ...LAYERS.ring, look: undefined }] }, 'fx.effects.hit.layers[0].look', /cool, warm/);
  bad({ layers: [{ ...LAYERS.ring, look: 'hot' }] }, 'fx.effects.hit.layers[0].look');
  bad({ layers: [{ ...LAYERS.ring, frames: [6, 6] }] }, 'fx.effects.hit.layers[0].frames[1]');
  bad({ layers: [{ ...LAYERS.ring, frames: [0, 9] }] }, 'fx.effects.hit.layers[0].frames[1]');
  bad({ layers: [{ ...LAYERS.ring, radius: [1, 2, 3, 4, 5, 6, 7, 8, 9] }] }, 'fx.effects.hit.layers[0].radius', /2–8/);
  bad({ layers: [{ ...LAYERS.ring, radius: undefined }] }, 'fx.effects.hit.layers[0].radius');
  bad({ layers: [{ ...LAYERS.slash, arc: [90, 90] }] }, 'fx.effects.hit.layers[0].arc');
  bad({ layers: [{ ...LAYERS.glyph, points: 2 }] }, 'fx.effects.hit.layers[0].points');
  bad({ layers: [{ ...LAYERS.ring, blend: 'multiply' }] }, 'fx.effects.hit.layers[0].blend');
  bad({ layers: [{ ...LAYERS.ring, cue: 'nul' }] }, 'fx.effects.hit.layers[0].cue');
  bad({ looks: { cool: { colors: ['b', 'c'], thresholds: [0.5, 0.4] } }, layers: [LAYERS.slash] }, 'fx.effects.hit.looks.cool.thresholds[1]', /rise/);
  bad({ looks: { cool: { colors: ['b', 'Z'], thresholds: [0.2, 0.4] } }, layers: [LAYERS.slash] }, 'fx.effects.hit.looks.cool.colors[1]');
  bad({ looks: { cool: { colors: ['b'], thresholds: [0.2], pattern: 'bayer2' } }, layers: [LAYERS.slash] }, 'fx.effects.hit.looks.cool.pattern', /dither/);
  bad({ layers: [] }, 'fx.effects.hit.layers');
  bad({ layers: [LAYERS.ring], cleanup: { corners: 'yes' } }, 'fx.effects.hit.cleanup.corners');
  bad({ looks: undefined, layers: [LAYERS.ring] }, 'fx.effects.hit.looks');
  bad({ looks, layers: undefined, cleanup: { corners: true } }, 'fx.effects.hit.looks', /add layers/);
  bad({ looks: undefined }, 'fx.effects.hit.emitters', /shape layers/);
  bad({ layers: [LAYERS.ring], emitters: [] }, 'fx.effects.hit.emitters', /leave emitters out/);
});

test('fx shape fields in the schema match the compiler', async () => {
  const schema = JSON.parse(await readFile(path.join(root, 'fx.schema.json'), 'utf8')), effect = schema.properties.effects.additionalProperties;
  assert.deepEqual(effect.anyOf, [{ required: ['emitters'] }, { required: ['layers', 'looks'] }]);
  assert.ok(!schema.required.includes('symbols'));
  const kinds = effect.properties.layers.items.oneOf;
  assert.deepEqual(kinds.map(k => k.properties.kind.const), SHAPE_KINDS);
  const values = { look: 'cool', at: [24, 24], frames: [0, 8], ease: 'linear', power: 1, flicker: 0, blend: 'max', tilt: 0, squash: [1, 1], drift: [0, 0], seed: 3, cue: 'hit',
    radius: 10, width: 2, fill: 0, noise: 0, scale: 4, arc: [0, 90], reveal: 0, to: [40, 24], wobble: 0, wavelength: 8, waves: 1, fade: 0, glow: 1, jag: 0.3, branches: 1, reroll: 2,
    segment: 4, inner: 0.7, points: 5, step: 2, runes: 4, double: false, spin: 0, ratio: 0.5, core: 2, angle: 0, jitter: 0, hole: 0, boil: 2 };
  const unknown = (kind, key) => {
    const layer = { kind, ...Object.fromEntries(kinds.find(k => k.properties.kind.const === kind).required.filter(k => k !== 'kind').map(k => [k, values[k]])), [key]: values[key] ?? 0 };
    try { compileEffects(source({ layers: [layer] })); return false; } catch (error) { return /unknown or null field/.test(error.message) && error.path.endsWith(`.${key}`); }
  };
  for (const schemaKind of kinds) {
    const kind = schemaKind.properties.kind.const;
    for (const key of Object.keys(schemaKind.properties)) if (key !== 'kind') assert.equal(unknown(kind, key), false, `${kind}.${key} is in the schema but the compiler rejects it`);
    assert.equal(unknown(kind, 'notAField'), true);
  }
  const look = schema.$defs['shape-look'];
  for (const key of Object.keys(look.properties)) {
    const probe = { colors: ['b'], thresholds: [0.5], [key]: { colors: ['b'], thresholds: [0.5], dither: 0.5, pattern: 'bayer2', outline: 'k' }[key] };
    if (key === 'pattern') probe.dither = 0.5;
    assert.doesNotThrow(() => compileEffects(source({ looks: { cool: probe }, layers: [LAYERS.slash] })), key);
  }
});

test('effects without shape layers keep their exact output', async () => {
  const fx = JSON.parse(await readFile(path.join(root, 'examples/effects.fx.json'), 'utf8')), compiled = compileEffects(fx).recipe;
  const generated = JSON.parse(await readFile(path.join(root, 'examples/effects.json'), 'utf8'));
  assert.deepEqual(compiled.frames, generated.frames);
});

test('the reviewed spell examples match their presets and compile to the pixels the owner approved', async () => {
  // These change with any change to the shapes' or particles' pixels: regenerate them only after the art is seen again.
  const golden = {
    'slash-hit': 'c184a564e5c2c3bc461a43dc3b182ec4d6e11457e2a9502d12e8c7610f8b12aa', 'fire-explosion': 'd99620d5189a507b462f778c6a78d7091fa4767ab500f3998d0f1045130447b7',
    'lightning-strike': '2da952dbcd93107cc51bddab14c3d54943c47b352fc37410f5f82e3efa2785fc', 'healing-circle': '6e40fdfe6ce5ebefa848adb3f6649bd9e0a93e8a2ebd1740583931fbf3e8a01a'
  };
  assert.deepEqual(Object.keys(spellPresets), Object.keys(golden));
  for (const [name, preset] of Object.entries(spellPresets)) {
    const example = JSON.parse(await readFile(path.join(root, `examples/${name}.fx.json`), 'utf8'));
    assert.deepEqual(example, preset, `examples/${name}.fx.json is stale; run node scripts/generate-examples.js`);
    const { recipe } = compileEffects(example);
    assert.deepEqual(renderProject(recipe).warnings, [], name);
    assert.equal(sha(recipe), golden[name], name);
  }
});
