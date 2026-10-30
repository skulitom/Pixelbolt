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
  burst: { kind: 'burst', look: 'warm', at: [24, 26], radius: [6, 18], hole: [0, 0.3], power: [1.4, 1] },
  stream: { kind: 'stream', look: 'cool', at: [6, 40], through: [[18, 14], [32, 30], [42, 8]], width: [4, 8, 5], head: [0.3, 1], tail: [0, 0.4], sway: 2, noise: 0.3, power: [1.3, 0.8] },
  aura: { kind: 'aura', look: 'warm', symbol: 'man', at: [20, 24], width: 4, rise: 2, noise: 0.5 },
  trail: { kind: 'trail', look: 'cool', at: [2, 2], points: [[4, 34], [8, 14], [20, 4], [34, 10], [40, 26], [36, 36], [30, 40], [26, 42]], width: [7, 5], length: 3 }
};
// The sprite an aura hugs: a head, a body and two legs, 6 × 12.
const MAN = { man: ['..yy..', '..yy..', '.yyyy.', 'yyyyyy', 'y.yy.y', 'y.yy.y', '..yy..', '..yy..', '.y..y.', '.y..y.', '.y..y.', 'yy..yy'] };
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

test('every shape kind compiles alone into an ordinary recipe of one grid per frame in its window, without emitters (or symbols, but the sprite an aura hugs)', () => {
  assert.deepEqual(SHAPE_KINDS, Object.keys(LAYERS));
  for (const [kind, layer] of Object.entries(LAYERS)) {
    const { recipe, metadata } = compileEffects(source({ layers: [{ ...layer, frames: [1, 7] }] }, kind === 'aura' ? { symbols: MAN } : {}));
    assert.deepEqual(recipe.symbols, kind === 'aura' ? MAN : undefined, kind);
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
  // The aura and the trail came later, so they have goldens of their own and stay out of all.
  const all = source({ cleanup: { corners: true, strays: true }, layers: Object.values(LAYERS).filter(layer => !['aura', 'trail'].includes(layer.kind)).map((layer, i) => ({ ...layer, frames: [i % 3, 8] })) });
  const first = compileEffects(all), second = compileEffects(structuredClone(all));
  assert.deepEqual(first, second);
  // These change with any change to the shapes' pixels: regenerate them deliberately, after looking at the art.
  const golden = {};
  for (const [kind, layer] of Object.entries(LAYERS)) golden[kind] = sha(compileEffects(source({ layers: [layer] }, kind === 'aura' ? { symbols: MAN } : {})).recipe);
  golden.all = sha(first.recipe);
  assert.deepEqual(golden, {
    ring: '61b165d169c36d373c64f88e298539c008ece0b0c635b570d91e3d270037bb26', slash: 'd492d264e470aebe75138384c462467d31f879264e81c1074587e715d31a0ec6',
    beam: '1a6015f6ac97c80ecff26e8e5b7258c9211613df1440c5c55f7f336ead225420', bolt: 'd54bdf63f41345c64b9ab402feb72ebdf809f1fbde4a71a8e63a6b06f9a3acee',
    glyph: '69221282a0198e368d410b9398d735b0e7f1e5959bd21933693472c65b92c802', star: '1a508a7b8019118c88f0a4a26b581d11c480546e45e498de6a09e2fabfc6c7d4',
    burst: '4151bac6ad5f35c106bdfde17ea8ae0249eaaa4bdbd1599d57a93f414378ae2c', stream: '0ce67436fbd732efd96876017738fed1cae5a3c4bcd18cf843d8d7fab8b15e09',
    aura: '45380c9b86ee656f4ed73b15478de8a64f7e8ebb35e32aa343bbf66a3b5aa9c8', trail: 'a0c40eb6ff1f127b5562fd1c87fc52bf2fb375a8ca5c8f7ccd72eb03a171b96e',
    all:'d515b0d1c38a42b23eef630e048ee6dd9aeee9f6a16f8d06740b3ef82af15a8d'
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
    segment: 4, inner: 0.7, points: 5, step: 2, runes: 4, double: false, spin: 0, ratio: 0.5, core: 2, angle: 0, jitter: 0, hole: 0, boil: 2,
    floor: 40, through: [[30, 10]], taper: [0, 1, 0], head: 1, tail: 0, sway: 0 };
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
    const bands = { colors: ['W'], thresholds: [0.5] };
    const probe = { colors: ['b'], thresholds: [0.5], [key]: { colors: ['b'], thresholds: [0.5], dither: 0.5, pattern: 'bayer2', outline: 'k', light: [1, -1], lit: bands, shade: bands }[key] };
    if (key === 'pattern') probe.dither = 0.5;
    if (key === 'light') probe.lit = bands;
    assert.doesNotThrow(() => compileEffects(source({ looks: { cool: probe }, layers: [LAYERS.slash] })), key);
  }
});

test('effects without shape layers keep their exact output', async () => {
  const fx = JSON.parse(await readFile(path.join(root, 'examples/effects.fx.json'), 'utf8')), compiled = compileEffects(fx).recipe;
  const generated = JSON.parse(await readFile(path.join(root, 'examples/effects.json'), 'utf8'));
  assert.deepEqual(compiled.frames, generated.frames);
});

test('the reviewed shape examples match their presets and compile to the pixels that were approved', async () => {
  // These change with any change to the shapes' or particles' pixels: regenerate them only after the art is seen again.
  const golden = {
    'slash-hit': 'ee88be08c01b53e36903ba3baf762a650731c738a0d894c8fe33a1e5fcb0ce75', 'fire-explosion': '6a98f8e6e928da3247bb01795e45a714ad3f10bd6b09f2f4b2045ef25fe95171',
    fireball: '2f64b93aa9c45d2f8c5a23c7318cf89d1fc022b21b76d3d0ba17856e613c2e81',
    'lightning-strike': 'faa749af1157a2ace4569082d13d631c5da762ae4ffa34484f237c3341d43baf', 'healing-circle': '2ea35d57cc912f2f184344a939446917979725e7782e1577d27e0d4c1745a7ff',
    water: '58416cfb88c16164f10911fa1e3e569a3e2c3947e3406b0774c2c8a7bf057a57'
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

// ---- Liquid shapes: light and shade, noise on every kind, a ground clip, streams and blob particles ----------------------
const water = { colors: ['b', 'c'], thresholds: [0.2, 0.55], lit: { colors: ['W'], thresholds: [0.45] }, shade: { colors: ['k'], thresholds: [0.4] }, outline: 's' };
const cells = grid => grid.rows.flatMap((row, j) => [...row].map((key, i) => ({ x: grid.x + i, y: grid.y + j, key }))).filter(cell => cell.key !== '.');
// Connected pieces of drawn pixels (4-neighbour), for break-up checks.
const pieces = grid => {
  const seen = new Set(), at = new Set(cells(grid).map(c => `${c.x},${c.y}`));
  let count = 0;
  for (const start of at) {
    if (seen.has(start)) continue;
    count++;
    const stack = [start];
    while (stack.length) {
      const here = stack.pop();
      if (seen.has(here) || !at.has(here)) continue;
      seen.add(here);
      const [x, y] = here.split(',').map(Number);
      stack.push(`${x + 1},${y}`, `${x - 1},${y}`, `${x},${y + 1}`, `${x},${y - 1}`);
    }
  }
  return count;
};

test('lit and shade bands put a highlight on the rim facing the light and a shadow opposite, only on the look\'s own pixels', () => {
  const disc = light => gridOf(compileEffects(source({ looks: { cool: { ...water, ...(light && { light }) } }, layers: [{ kind: 'burst', look: 'cool', at: [24, 24], radius: 14, noise: 0 }] })).recipe.frames[0]);
  const mean = (list, axis) => list.reduce((sum, c) => sum + c[axis], 0) / list.length;
  for (const [light, sx, sy] of [[undefined, -1, -1], [[1, 0], 1, 0], [[0, 1], 0, 1]]) {
    const all = cells(disc(light)), lit = all.filter(c => c.key === 'W'), shade = all.filter(c => c.key === 'k');
    assert.ok(lit.length > 4 && shade.length > 4, `light ${light}: ${lit.length} lit, ${shade.length} shade`);
    // The highlight sits toward the light and the shadow away from it, on either side of the centre.
    if (sx) { assert.ok(Math.sign(mean(lit, 'x') - 24) === sx && Math.sign(mean(shade, 'x') - 24) === -sx, `light ${light} across`); }
    if (sy) { assert.ok(Math.sign(mean(lit, 'y') - 24) === sy && Math.sign(mean(shade, 'y') - 24) === -sy, `light ${light} down`); }
    // Inside, where the field barely falls, the body keeps its own bands; the outline stays outside.
    assert.ok(all.some(c => c.key === 'c'));
  }
  const plain = cells(gridOf(compileEffects(source({ looks: { cool: { colors: ['b', 'c'], thresholds: [0.2, 0.55], outline: 's' } }, layers: [{ kind: 'burst', look: 'cool', at: [24, 24], radius: 14, noise: 0 }] })).recipe.frames[0]));
  assert.deepEqual(cells(disc()).map(c => `${c.x},${c.y}`), plain.map(c => `${c.x},${c.y}`), 'lit and shade recolour, never add or remove pixels');
});

test('a floor cuts any layer off below its row: a disc becomes a dome, a ring an arch', () => {
  for (const layer of [{ kind: 'burst', look: 'cool', at: [24, 30], radius: 12, noise: 0 }, { kind: 'ring', look: 'cool', at: [24, 30], radius: 12, width: 3 }, LAYERS.stream]) {
    const whole = cells(gridOf(compileEffects(source({ looks: { cool: water }, layers: [layer] })).recipe.frames[7]));
    const cut = cells(gridOf(compileEffects(source({ looks: { cool: water }, layers: [{ ...layer, floor: 30 }] })).recipe.frames[7]));
    assert.ok(whole.some(c => c.y > 31), layer.kind);
    // Only the outline may reach one row below the floor.
    assert.ok(cut.every(c => c.y <= 30 || (c.y === 31 && c.key === 's')), `${layer.kind} stops at the floor`);
    assert.ok(cut.length > 10, `${layer.kind} keeps its part above`);
  }
});

test('noise on any kind breaks it into pieces as power falls, and changes nothing at 0', () => {
  for (const kind of ['slash', 'beam', 'star', 'stream']) {
    // At a low steady power only the brightest parts reach the first threshold; noise then decides which survive.
    const { noise, ...plain } = LAYERS[kind], base = { ...plain, power: 0.5, frames: [0, 8] }, drawn = layer => gridOf(compileEffects(source({ looks: { cool: water, warm: water }, layers: [layer] })).recipe.frames[4]);
    assert.deepEqual(drawn({ ...base, noise: 0 }), drawn(base), `${kind} noise 0`);
    const whole = drawn(base), broken = drawn({ ...base, noise: 0.6, scale: 3 });
    assert.ok(cells(broken).length < cells(whole).length, `${kind} erodes: ${cells(whole).length} → ${cells(broken).length} pixels`);
    if (kind === 'stream') assert.ok(pieces(broken) > pieces(whole), `a stream breaks into pieces: ${pieces(whole)} → ${pieces(broken)}`);
  }
});

test('a stream draws the part of its curve between tail and head, tapered to points, from its first frame', () => {
  const frames = compileEffects(source({ looks: { cool: water }, layers: [{ kind: 'stream', look: 'cool', at: [4, 24], through: [[24, 24], [44, 24]], width: 8, head: [0, 1], tail: [0, 0, 1], ease: 'linear', frames: [0, 8] }] })).recipe.frames;
  const spans = frames.map(f => { const g = gridOf(f); return g ? [g.x, g.x + g.rows[0].length - 1] : null; });
  assert.ok(spans[0], 'the first frame already shows the head under way');
  // The front moves right, then the back follows it.
  for (let k = 1; k < 4; k++) assert.ok(spans[k][1] >= spans[k - 1][1], `head advances at ${k}`);
  for (let k = 5; k < 7; k++) assert.ok(spans[k][0] > spans[k - 1][0], `tail chases at ${k}`);
  // Pointed at both ends: the middle column is wider than the columns near either end.
  const g = gridOf(frames[4]), column = x => g.rows.filter(row => row[x - g.x] !== '.').length, [x0, x1] = spans[4];
  assert.ok(column(Math.floor((x0 + x1) / 2)) > column(x0 + 1) && column(Math.floor((x0 + x1) / 2)) > column(x1 - 1));
});

test('blob particles draw soft discs into a look, merging where they touch, shrinking through their radius keys', () => {
  const effect = blobs => source({ looks: { cool: water }, emitters: blobs });
  const drop = (at, extra = {}) => ({ at, burst: 1, life: 8, blob: { radius: 4 }, ...extra });
  // Without symbols or layers, blobs alone draw one grid per frame and no stamps.
  const one = compileEffects(effect([drop([24, 24])]));
  assert.equal(one.recipe.symbols, undefined);
  assert.ok(one.recipe.frames.every(f => (f.ops ?? []).every(op => op.op === 'grid')));
  assert.equal(pieces(gridOf(one.recipe.frames[0])), 1);
  assert.equal(pieces(gridOf(compileEffects(effect([drop([18, 24]), drop([25, 24])])).recipe.frames[0])), 1, 'two touching drops merge');
  assert.equal(pieces(gridOf(compileEffects(effect([drop([10, 24]), drop([36, 24])])).recipe.frames[0])), 2, 'two far drops stay apart');
  const shrinking = compileEffects(effect([drop([24, 24], { blob: { radius: [5, 1] } })])).recipe.frames.map(f => cells(gridOf(f)).length);
  assert.ok(shrinking.every((n, k) => !k || n <= shrinking[k - 1]) && shrinking[7] < shrinking[0] / 3, `${shrinking}`);
  // Blobs and layers of one look share its field, under the particles drawn as symbols.
  const mixed = compileEffects(source({ looks: { cool: water }, layers: [LAYERS.stream], emitters: [drop([40, 10]), { at: [4, 4], burst: 1, life: 8, shapes: ['dot'] }] }, { symbols: { dot: ['W'] } })).recipe.frames[7].ops;
  assert.deepEqual(mixed.map(op => op.op), ['grid', 'stamp']);
  // Mistakes name the field to fix.
  const wrong = (emitter, extra = {}) => { try { compileEffects({ ...effect([emitter]), ...extra }); } catch (error) { return `${error.path}: ${error.message}`; } return 'compiled'; };
  assert.match(wrong({ ...drop([24, 24]), shapes: ['dot'] }, { symbols: { dot: ['W'] } }), /emitters\[0\]\.shapes: shapes applies to particles drawn as symbols/);
  assert.match(wrong(drop([24, 24], { blob: { look: 'ice' } })), /blob\.look: no look is named "ice"/);
  assert.match(wrong(drop([24, 24]), { effects: { hit: { frames: 8, emitters: [drop([24, 24])] } } }), /hit\.looks: blob particles are drawn into the effect's looks/);
  assert.match(wrong(drop([24, 24]), { effects: { hit: { frames: 8, looks, emitters: [drop([24, 24])] } } }), /blob\.look: name the look this blob is drawn into: cool, warm/);
  const twice = (first, second) => { try { compileEffects(effect([first, second])); } catch (error) { return `${error.path}: ${error.message}`; } return 'compiled'; };
  assert.match(twice(drop([24, 24]), { at: [24, 24], burst: 1 }), /emitters\[1\]\.shapes: expected 1–64 symbol names .* or a blob drawn into a look/);
});

test('liquid shapes compile to golden recipes, the same every time', () => {
  const liquid = source({ looks: { cool: { ...water, light: [-1, -0.5] } }, cleanup: { corners: true, strays: true },
    layers: [{ ...LAYERS.stream, look: 'cool', floor: 36 }, { kind: 'ring', look: 'cool', at: [24, 38], radius: [4, 18], width: [4, 2], squash: [1, 0.3], noise: 0.7, power: [1.3, 0.25] },
      { ...LAYERS.slash, noise: 0.8, power: [1.4, 0.3] }],
    emitters: [{ at: [40, 10], area: [6, 3], burst: 6, start: 3, angle: [200, 340], speed: [0.6, 1.4], gravity: [0, 0.25], floor: 38, life: [4, 6], blob: { radius: [2.5, 1.2] } }] });
  assert.deepEqual(compileEffects(liquid), compileEffects(structuredClone(liquid)));
  assert.equal(sha(compileEffects(liquid).recipe), '54ea5eeff8395e62eaa33007d77b370e9106c8527b146d51b7eddf551d41bb0b');
});

// ---- Looping shapes: a layer that spans a looping effect is a cycle ------------------------------------------------------
const changes = recipe => {
  const frames = renderProject(recipe).frames.map(frame => frame.data), differ = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) n++; return n; };
  return { inside: frames.slice(1).map((frame, k) => differ(frames[k], frame)), seam: differ(frames[frames.length - 1], frames[0]) };
};

test('a burst spanning a looping effect boils on through the loop point instead of jumping back', () => {
  const ball = { kind: 'burst', look: 'warm', at: [24, 24], radius: 12, noise: 0.5, boil: 8 };
  const loop = changes(compileEffects(source({ frames: 12, loop: true, layers: [ball] })).recipe);
  // The loop point changes no more than an ordinary step, and the noise keeps moving to the end instead of easing to a stop.
  assert.ok(loop.seam <= Math.max(...loop.inside), `seam ${loop.seam}, inside ${loop.inside}`);
  assert.ok(Math.min(...loop.inside) > Math.max(...loop.inside) / 4, `inside ${loop.inside}`);
  // So does the shipped fireball in each of its eight directions, a burst with a rippling beam for a tail and embers.
  const shipped = compileEffects(spellPresets.fireball).recipe;
  assert.equal(Object.keys(shipped.animations).length, 8);
  for (const [name, animation] of Object.entries(shipped.animations)) {
    const { inside, seam } = changes({ ...shipped, frames: shipped.frames.filter(f => animation.frames.includes(f.name)), animations: { [name]: animation } });
    assert.ok(seam <= Math.max(...inside), `${name} seam ${seam}, inside ${inside}`);
  }
  // The same layer in a one-shot keeps its eased boil, so the jump back is there (and approved one-shots keep their pixels).
  const once = changes(compileEffects(source({ frames: 12, layers: [ball] })).recipe);
  assert.ok(once.seam > Math.max(...once.inside), `one-shot seam ${once.seam}, inside ${once.inside}`);
  // boil: 0 keeps the noise still in a loop too; a window shorter than the loop is an event drawn as a one-shot.
  assert.equal(changes(compileEffects(source({ frames: 12, loop: true, layers: [{ ...ball, boil: 0 }] })).recipe).seam, 0);
  const event = { ...ball, frames: [2, 10] };
  const inLoop = compileEffects(source({ frames: 12, loop: true, layers: [event] })).recipe, alone = compileEffects(source({ frames: 12, layers: [event] })).recipe;
  assert.deepEqual(inLoop.frames, alone.frames);
});

test('cycling layers move at a steady pace and draw without a reveal, so spins and waves loop', () => {
  // A glyph turning two rune steps per loop (its square the other way by a quarter turn), and a beam with whole waves,
  // meet their first frame again.
  const circle = { ...LAYERS.glyph, spin: [0, 90], fill: 0 }, beam = { ...LAYERS.beam, width: 6, waves: 2 };
  for (const layer of [circle, beam]) {
    const { inside, seam } = changes(compileEffects(source({ frames: 8, loop: true, layers: [layer] })).recipe);
    assert.ok(inside.some(n => n > 0) && seam <= Math.max(...inside), `${layer.kind}: seam ${seam}, inside ${inside}`);
  }
  // A cycling slash stays whole in every frame: its tail no longer chases the head away and pops back at the loop point.
  const crescent = compileEffects(source({ frames: 8, loop: true, layers: [{ ...LAYERS.slash, width: 6 }] })).recipe;
  assert.ok(crescent.frames.every(frame => gridOf(frame) && visible(gridOf(frame).rows) === visible(gridOf(crescent.frames[0]).rows)));
  assert.equal(changes(crescent).seam, 0);
  // Drawn whole from the first frame: a cycling glyph has no draw-on unless it asks for one, as a one-shot draws on.
  const first = (loop, extra = {}) => visible(gridOf(compileEffects(source({ frames: 8, loop, layers: [{ ...circle, ...extra }] })).recipe.frames[0]).rows);
  assert.ok(first(true) > 1.5 * first(false), `${first(true)} against ${first(false)}`);
  assert.equal(first(true, { reveal: 0.3 }), first(false, { ease: 'linear' }));
});

// ---- Auras: a continuous glow hugging a sprite ---------------------------------------------------------------------------
test('an aura hugs its whole sprite in one piece, reaches further up than down, and loops without a jump', () => {
  const glow = (layer, effect = {}) => compileEffects(source({ layers: [{ ...LAYERS.aura, ...layer }], ...effect }, { symbols: MAN })).recipe;
  const still = cells(gridOf(glow({ noise: 0 }).frames[0])), at = new Set(still.map(c => `${c.x},${c.y}`));
  // Every pixel of the sprite (top-left at [20, 24]) is covered, and the glow is one piece around it.
  MAN.man.forEach((row, j) => [...row].forEach((char, i) => { if (char !== '.') assert.ok(at.has(`${20 + i},${24 + j}`), `sprite pixel ${i},${j}`); }));
  assert.equal(pieces(gridOf(glow({ noise: 0 }).frames[0])), 1);
  // With rise 2, it reaches about twice as far above the head as below the feet or beside the body.
  const ys = still.map(c => c.y), xs = still.map(c => c.x), above = 24 - Math.min(...ys), below = Math.max(...ys) - 35, beside = 20 - Math.min(...xs);
  assert.ok(above >= 2 * below - 1 && above > beside + 2, `above ${above}, below ${below}, beside ${beside}`);
  // Noise licks the edge up and down over the frames; in a loop it rises through the loop point without a jump.
  const loop = changes(glow({ noise: 0.8 }, { frames: 12, loop: true }));
  assert.ok(Math.min(...loop.inside) > 0 && loop.seam <= Math.max(...loop.inside), `seam ${loop.seam}, inside ${loop.inside}`);
  const wrong = layer => { try { glow(layer); } catch (error) { return `${error.path}: ${error.message}`; } return 'compiled'; };
  assert.match(wrong({ symbol: 'ghost' }), /layers\[0\]\.symbol: .*none named "ghost"/);
  assert.match(wrong({ symbol: undefined }), /layers\[0\]\.symbol: a aura layer needs symbol/);
  assert.match(wrong({ squash: [1, 0.5] }), /layers\[0\]: unknown or null field squash|squash/);
});

// ---- Keyed noise and blob sizes --------------------------------------------------------------------------------------------
test('keyed noise lets one layer stand solid and then shatter, and blob sizes vary puff by puff', () => {
  const disc = noise => compileEffects(source({ frames: 6, layers: [{ kind: 'burst', look: 'warm', at: [24, 24], radius: 12, noise, power: [1.3, 0.5] }] })).recipe.frames;
  const solid = disc(0), keyed = disc([0, 0.9]);
  // The first frame matches the solid disc; by the last the keyed one has broken into pieces the solid one has not.
  assert.deepEqual(keyed[0], solid[0]);
  assert.ok(pieces(gridOf(keyed[5])) > pieces(gridOf(solid[5])), `${pieces(gridOf(keyed[5]))} pieces against ${pieces(gridOf(solid[5]))}`);
  // Keys that stay put are the plain number, pixel for pixel.
  assert.deepEqual(disc([0.6, 0.6]), disc(0.6));
  const puffs = size => compileEffects(source({ frames: 1, looks: { cool: water }, emitters: [{ at: [24, 24], ring: { radius: 14, even: true }, burst: 6, life: 2, blob: { radius: 4, size } }] })).recipe.frames[0];
  // Even spacing, so only size tells the puffs apart: with a range their areas differ, with the default they match.
  const areas = frame => { const g = gridOf(frame), all = cells(g); return [0, 60, 120, 180, 240, 300].map(a => all.filter(c => Math.hypot(c.x - (24 + 14 * Math.cos(a * Math.PI / 180)), c.y - (24 + 14 * Math.sin(a * Math.PI / 180))) < 7).length); };
  assert.equal(new Set(areas(puffs(undefined))).size <= 2, true);
  assert.ok(new Set(areas(puffs([0.5, 1.5]))).size >= 4, JSON.stringify(areas(puffs([0.5, 1.5]))));
  assert.deepEqual(puffs(1), puffs(undefined));
});

test('a stream with fade dims toward the far end of its curve, and without it draws as before', () => {
  const tail = fade => gridOf(compileEffects(source({ frames: 1, layers: [{ kind: 'stream', look: 'warm', at: [6, 24], through: [[42, 24]], width: 8, taper: [1, 0.2], ...(fade !== undefined && { fade }) }] })).recipe.frames[0]);
  const bright = grid => cells(grid).filter(c => c.key === 'W');
  // Faded, the white core stops short of the far end, and the far tip is no longer drawn white.
  const plain = bright(tail()), faded = bright(tail(0.8));
  assert.ok(Math.max(...faded.map(c => c.x)) < Math.max(...plain.map(c => c.x)) - 8, `${Math.max(...faded.map(c => c.x))} against ${Math.max(...plain.map(c => c.x))}`);
  assert.deepEqual(tail(0), tail());
});

test('a look\'s reach sizes its lit and shade bands: shorter keeps a small drop\'s highlight to a thin rim', () => {
  const drop = reach => cells(gridOf(compileEffects(source({ frames: 1, looks: { cool: { ...water, ...(reach !== undefined && { reach }) } }, layers: [{ kind: 'burst', look: 'cool', at: [24, 24], radius: 5, noise: 0 }] })).recipe.frames[0])).filter(c => c.key === 'W').length;
  assert.ok(drop(1) < drop(2) && drop(2) < drop(4), `${drop(1)} ${drop(2)} ${drop(4)}`);
  assert.equal(drop(2), drop());
  assert.throws(() => compileEffects(source({ frames: 1, looks: { cool: { colors: ['b'], thresholds: [0.2], reach: 1 } }, layers: [{ kind: 'burst', look: 'cool', at: [24, 24], radius: 5 }] })), /reach sizes the lit and shade bands/);
});
