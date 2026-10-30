import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject } from '../src/core.js';
import { compilePoses } from '../src/authoring.js';
import { compileEffects } from '../src/fx.js';
import { prepareScene, renderScene } from '../src/scene.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const effects = (effect, extra = {}) => ({ format: 'pixelforge-fx', version: 1, name: 'fx', width: 24, height: 24, palette: { w: '#fff', y: '#fd6', o: '#e83', g: '#6b4', l: '#9d6' },
  symbols: { dot: ['w'], warm: ['y'], cool: ['o'], chip: ['yy', 'yo'], leafA: ['gl'], leafB: ['lg'] }, effects: { burst: effect }, ...extra });
const opsOf = recipe => recipe.frames.map(frame => frame.ops ?? []);

test('effects compile deterministically into ordinary frames, one animation per effect', () => {
  const source = effects({ frames: 6, duration: [40, 50, 60, 60, 70, 80], seed: 7, emitters: [{ at: [12, 12], burst: 6, angle: [0, 360], speed: [1, 2], life: [4, 6], shapes: ['dot', 'warm', 'cool'] }] });
  const first = compileEffects(source), second = compileEffects(structuredClone(source));
  assert.deepEqual(first, second);
  const project = renderProject(first.recipe);
  assert.deepEqual(project.frames.map(f => [f.name, f.duration]), [['burst-0', 40], ['burst-1', 50], ['burst-2', 60], ['burst-3', 60], ['burst-4', 70], ['burst-5', 80]]);
  assert.deepEqual(first.recipe.animations, { burst: { frames: ['burst-0', 'burst-1', 'burst-2', 'burst-3', 'burst-4', 'burst-5'], loop: false } });
  assert.deepEqual(project.warnings, []);
  // All six particles start on the emitter; symbols step through the life (dot → warm → cool).
  assert.deepEqual(opsOf(first.recipe)[0], Array(6).fill({ op: 'stamp', symbol: 'dot', x: 12, y: 12 }));
  assert.ok(opsOf(first.recipe)[3].every(op => op.symbol !== 'dot'));
  assert.equal(first.metadata.effects.burst.emitters[0].spawned, 6);
  // A different seed moves particles; the same seed with a different life keeps the launch directions.
  const reseeded = compileEffects({ ...source, effects: { burst: { ...source.effects.burst, seed: 8 } } });
  assert.notDeepEqual(opsOf(reseeded.recipe)[1], opsOf(first.recipe)[1]);
  const longer = compileEffects({ ...source, effects: { burst: { ...source.effects.burst, emitters: [{ ...source.effects.burst.emitters[0], life: [5, 6] }] } } });
  assert.deepEqual(opsOf(longer.recipe)[1].map(op => [op.x, op.y]), opsOf(first.recipe)[1].map(op => [op.x, op.y]));
});

test('gravity, floors, trails, variants, remaps and dissolve bake into stamps, grids, lines and pixels', () => {
  const fall = compileEffects(effects({ frames: 8, emitters: [{ at: [12, 4], burst: 1, gravity: [0, 1], floor: 18, shapes: ['dot'], trail: { color: 'o', length: 1 } }] }));
  const heights = opsOf(fall.recipe).map(ops => ops.find(op => op.op === 'stamp').y);
  assert.deepEqual(heights, [4, 5, 7, 10, 14, 18, 18, 18]);
  assert.deepEqual(opsOf(fall.recipe)[2][0], { op: 'line', x: 12, y: 5, x2: 12, y2: 7, color: 'o' });
  // Sway wobbles a particle in the air but never carries it below its floor.
  const resting = compileEffects(effects({ frames: 20, emitters: [{ at: [12, 4], burst: 1, gravity: [0, 1], floor: 18, life: 20, shapes: ['dot'], sway: { amplitude: [0, 3], period: 8 } }] }));
  assert.equal(Math.max(...opsOf(resting.recipe).flat().map(op => op.y)), 18);
  // Particles partly off the canvas are cropped into grids and trails keep only on-canvas pixels: no clipping.
  const edge = compileEffects(effects({ frames: 4, emitters: [{ at: [22, 12], burst: 1, angle: 0, speed: 1.5, shapes: ['chip'], trail: { color: 'o', length: 2 } }] }));
  assert.deepEqual(renderProject(edge.recipe).warnings, []);
  assert.ok(opsOf(edge.recipe).flat().some(op => op.op === 'grid'));
  assert.ok(opsOf(edge.recipe).flat().some(op => op.op === 'pixel'));
  const leaves = compileEffects(effects({ frames: 6, seed: 3, emitters: [{ at: [12, 12], burst: 8, speed: 1, life: 6, shapes: [['leafA', 'leafB'], ['leafB', 'leafA']], play: 'loop', remaps: [{}, { g: 'o' }], dissolve: 0.5 }] }));
  const all = opsOf(leaves.recipe).flat();
  assert.ok(all.some(op => op.remap?.g === 'o') && all.some(op => op.op === 'stamp' && !op.remap));
  // The last half of each life dissolves through an ordered pattern: those frames draw grids with fewer pixels.
  const drawn = ops => ops.reduce((sum, op) => sum + (op.op === 'stamp' ? 2 : op.rows.join('').replace(/\./g, '').length), 0);
  assert.ok(opsOf(leaves.recipe)[5].every(op => op.op === 'grid'));
  assert.ok(drawn(opsOf(leaves.recipe)[5]) < drawn(opsOf(leaves.recipe)[0]));
  assert.deepEqual(leaves.metadata.effects.burst.emitters, [{ spawned: 8, maxAlive: 8 }]);
});

test('looping effects warm up so the first frame continues the last', () => {
  const source = effects({ frames: 8, loop: true, seed: 2, emitters: [{ name: 'rise', at: [12, 20], area: [8, 1], rate: 1, angle: 270, speed: 1, life: 6, shapes: ['dot'] }] });
  const { recipe, metadata } = compileEffects(source);
  assert.equal(recipe.animations.burst.loop, undefined);
  // A steady rate of one particle per frame with six-frame lives keeps six particles in every frame, including frame 0.
  assert.deepEqual(opsOf(recipe).map(ops => ops.length), Array(8).fill(6));
  // Rising particles are one pixel higher each frame; at frame 0 the oldest has risen five pixels.
  assert.deepEqual(opsOf(recipe)[0].map(op => op.y).sort((a, b) => a - b), [15, 16, 17, 18, 19, 20]);
  assert.deepEqual(metadata.effects.burst.emitters, [{ name: 'rise', spawned: 8, maxAlive: 6 }]);
});

test('effect sources fail early with paths an agent can act on', () => {
  const bad = (emitter, path) => assert.throws(() => compileEffects(effects({ frames: 4, emitters: [{ at: [1, 1], shapes: ['dot'], ...emitter }] })), error => error.path === path);
  bad({ burst: 1, rate: 1 }, 'fx.effects.burst.emitters[0]');
  bad({ burst: 1, shapes: ['nope'] }, 'fx.effects.burst.emitters[0].shapes[0]');
  bad({ burst: 1, dissolve: 0.5 }, 'fx.effects.burst.emitters[0].dissolve');
  bad({ burst: 1, bounce: 0.5 }, 'fx.effects.burst.emitters[0].bounce');
  bad({ burst: 1, remaps: [{ g: 'nope' }] }, 'fx.effects.burst.emitters[0].remaps[0].g');
  bad({ burst: 1, speed: [3, 1] }, 'fx.effects.burst.emitters[0].speed');
  bad({ burst: 1, life: 4, dissolve: 0.5, pattern: [[0, 9]] }, 'fx.effects.burst.emitters[0].pattern[0][1]');
  bad({ burst: 1, life: 4, pattern: 'bayer4' }, 'fx.effects.burst.emitters[0].pattern');
  // A custom rank matrix shapes the dissolve like the dither operation: diagonal stripes drop one diagonal in three.
  const striped = compileEffects(effects({ frames: 2, emitters: [{ at: [12, 12], burst: 1, life: 2, dissolve: 0.5, pattern: [[0, 1, 2], [1, 2, 0], [2, 0, 1]], shapes: [['chip'], ['chip']] }], }, { symbols: { chip: ['yyy', 'yyy', 'yyy'] } }));
  assert.deepEqual(opsOf(striped.recipe)[1], [{ op: 'grid', x: 11, y: 11, rows: ['yy.', 'y.y', '.yy'] }]);
  assert.throws(() => compileEffects(effects({ frames: 4, loop: true, emitters: [{ at: [1, 1], burst: 1, shapes: ['dot'] }] })), /finite life/);
  const one = { frames: 1, emitters: [{ at: [1, 1], burst: 1, shapes: ['dot'] }] };
  assert.throws(() => compileEffects({ ...effects(one), effects: { spark: one, Spark: one } }), error => error.path === 'fx.effects.Spark' && /ignoring case/.test(error.message));
  assert.throws(() => compileEffects(effects({ frames: 4, duration: [1, 2], emitters: [{ at: [1, 1], burst: 1, shapes: ['dot'] }] })), /one duration or 4/);
  assert.throws(() => compileEffects({ ...effects({ frames: 200, emitters: [{ at: [1, 1], burst: 1, shapes: ['dot'] }] }), effects: { a: { frames: 200, emitters: [{ at: [1, 1], burst: 1, shapes: ['dot'] }] }, b: { frames: 100, emitters: [{ at: [1, 1], burst: 1, shapes: ['dot'] }] } } }), /at most 256/);
});

const stampsAt = ops => ops.filter(op => op.op === 'stamp').map(op => [op.x, op.y]);
const sorted = points => points.map(p => p.join(',')).sort();

test('rings, arcs and lines spawn evenly or at random, and outward rings launch away from their centre', () => {
  const at = emitter => opsOf(compileEffects(effects({ frames: 2, emitters: [{ at: [12, 12], shapes: ['dot'], ...emitter }] })).recipe);
  // Four particles evenly round a radius-4 ring, launched straight out at one pixel per frame.
  const ring = at({ ring: { radius: 4, even: true, outward: true }, burst: 4, speed: 1 });
  assert.deepEqual(sorted(stampsAt(ring[0])), sorted([[16, 12], [12, 16], [8, 12], [12, 8]]));
  assert.deepEqual(sorted(stampsAt(ring[1])), sorted([[17, 12], [12, 17], [7, 12], [12, 7]]));
  // A partial arc reaches both ends; outward angles are measured from the outward direction (90 turns clockwise).
  assert.deepEqual(sorted(stampsAt(at({ ring: { radius: 4, arc: [180, 360], even: true }, burst: 3 })[0])), sorted([[8, 12], [12, 8], [16, 12]]));
  const along = at({ ring: { radius: 4, arc: [0, 0], outward: true }, angle: 90, burst: 1, speed: 2 });
  assert.deepEqual([stampsAt(along[0]), stampsAt(along[1])], [[[16, 12]], [[16, 14]]]);
  // A line spawns from at to to; random spawns stay on it.
  assert.deepEqual(stampsAt(at({ line: { to: [20, 12], even: true }, burst: 3 })[0]), [[12, 12], [16, 12], [20, 12]]);
  assert.ok(stampsAt(at({ line: { to: [20, 4] }, burst: 6 })[0]).every(([x, y]) => x >= 12 && x <= 20 && y === 24 - x));
  // A random ring keeps its radius range.
  assert.ok(stampsAt(at({ ring: { radius: [3, 5] }, burst: 12 })[0]).every(([x, y]) => { const d = Math.hypot(x - 12, y - 12); return d >= 2 && d <= 6; }));
});

test('facing particles draw the sequence closest to their direction of travel and keep it at rest', () => {
  const source = emitter => effects({ frames: 4, emitters: [{ at: [12, 12], burst: 1, face: true, shapes: [['r'], ['d'], ['l'], ['u']], ...emitter }] }, { symbols: { r: ['w'], d: ['y'], l: ['o'], u: ['g'] } });
  const symbolsOf = emitter => opsOf(compileEffects(source(emitter)).recipe).map(ops => ops[0].symbol);
  // Launched right and pulled down by gravity, a spark turns from right to down.
  assert.deepEqual(symbolsOf({ angle: 0, speed: 2, gravity: [0, 1.5] }), ['r', 'r', 'd', 'd']);
  // Stopped dead by drag, a particle launched upward keeps facing up.
  assert.deepEqual(symbolsOf({ angle: 270, speed: 2, drag: 1 }), ['u', 'u', 'u', 'u']);
  // Each direction is its own sequence, so it still steps over the life.
  const shrinking = compileEffects(effects({ frames: 2, emitters: [{ at: [12, 12], burst: 1, angle: 180, speed: 1, life: 2, face: true, shapes: [['dot', 'warm'], ['cool', 'cool']] }] }));
  assert.deepEqual(opsOf(shrinking.recipe).map(ops => ops[0].symbol), ['cool', 'cool']);
});

test('child emitters spawn where parents end, land or travel, and loops stay seamless', () => {
  const run = (emitters, extra = {}) => compileEffects(effects({ frames: 6, emitters, ...extra }));
  // A parent living three frames hands its last position to two children, drawn from the next frame.
  const death = run([{ name: 'shot', at: [4, 12], burst: 1, angle: 0, speed: 2, life: 3, shapes: ['dot'] }, { from: 'shot', burst: 2, life: 2, shapes: ['warm'] }]);
  assert.deepEqual(opsOf(death.recipe).map(ops => ops.map(op => op.symbol).join()), ['dot', 'dot', 'dot', 'warm,warm', 'warm,warm', '']);
  assert.deepEqual(stampsAt(opsOf(death.recipe)[3]), [[8, 12], [8, 12]]);
  assert.deepEqual(death.metadata.effects.burst.emitters, [{ name: 'shot', spawned: 1, maxAlive: 1 }, { spawned: 2, maxAlive: 2 }]);
  // Landing spawns once, on the floor, even when the parent bounces.
  const floor = run([{ name: 'rock', at: [12, 4], burst: 1, gravity: [0, 3], floor: 12, bounce: 0.5, shapes: ['dot'] }, { from: 'rock', when: 'floor', burst: 1, life: 1, shapes: ['cool'] }]);
  assert.deepEqual(opsOf(floor.recipe).flat().filter(op => op.symbol === 'cool'), [{ op: 'stamp', symbol: 'cool', x: 12, y: 12 }]);
  // While it lives, a parent leaves `rate` children a frame where it is: a trail, here offset two pixels above.
  const trail = run([{ name: 'bolt', at: [2, 12], burst: 1, angle: 0, speed: 3, shapes: ['dot'] }, { from: 'bolt', when: 'life', at: [0, -2], rate: 1, life: 2, shapes: ['cool'] }]);
  assert.deepEqual(opsOf(trail.recipe).map(ops => stampsAt(ops.filter(op => op.symbol === 'cool'))), [[[2, 10]], [[2, 10], [5, 10]], [[5, 10], [8, 10]], [[8, 10], [11, 10]], [[11, 10], [14, 10]], [[14, 10], [17, 10]]]);
  // inherit gives a child its parent's velocity; behind draws it under the parent.
  const carried = run([{ name: 'a', at: [2, 12], burst: 1, angle: 0, speed: 2, life: 2, shapes: ['dot'] }, { from: 'a', burst: 1, inherit: 1, behind: true, shapes: ['cool'] }]);
  assert.deepEqual(opsOf(carried.recipe).map(ops => stampsAt(ops)), [[[2, 12]], [[4, 12]], [[4, 12]], [[6, 12]], [[8, 12]], [[10, 12]]]);
  const under = run([{ name: 'a', at: [12, 12], burst: 1, shapes: ['dot'] }, { from: 'a', when: 'life', rate: 1, life: 1, behind: true, shapes: ['cool'] }]);
  assert.deepEqual(opsOf(under.recipe)[0].map(op => op.symbol), ['cool', 'dot']);
  // A looping chain warms up for the parent's and child's lives together: every frame holds four parents and six children.
  const looping = compileEffects(effects({ frames: 8, loop: true, emitters: [{ name: 'p', at: [12, 20], rate: 1, angle: 270, speed: 1, life: 4, shapes: ['dot'] }, { from: 'p', burst: 1, angle: 0, speed: 1, life: 6, shapes: ['cool'] }] }));
  assert.deepEqual(opsOf(looping.recipe).map(ops => [ops.filter(op => op.symbol === 'dot').length, ops.filter(op => op.symbol === 'cool').length]), Array(8).fill([4, 6]));
  // Children compile deterministically, and the children of one event take their own seeded directions.
  const scatter = () => run([{ name: 'p', at: [12, 12], burst: 1, life: 1, shapes: ['dot'] }, { from: 'p', burst: 4, speed: 3, life: 3, shapes: ['cool'] }]);
  assert.deepEqual(scatter(), scatter());
  assert.equal(new Set(stampsAt(opsOf(scatter().recipe)[2]).map(String)).size, 4);
});

test('tint stages recolour particles over their life, over their own remap', () => {
  const { recipe } = compileEffects(effects({ frames: 4, emitters: [{ at: [12, 12], burst: 1, life: 4, shapes: ['chip'], remaps: [{ o: 'g' }], tint: [{}, { y: 'w' }] }] }));
  assert.deepEqual(opsOf(recipe).map(ops => ops[0].remap), [{ o: 'g' }, { o: 'g' }, { o: 'g', y: 'w' }, { o: 'g', y: 'w' }]);
  const plain = compileEffects(effects({ frames: 2, emitters: [{ at: [12, 12], burst: 1, life: 2, shapes: ['dot'], tint: [{}, { w: 'o' }] }] }));
  assert.deepEqual(opsOf(plain.recipe).map(ops => ops[0].remap), [undefined, { w: 'o' }]);
});

test('eased durations front-load an effect and cues become frame points for game code', () => {
  const timed = ease => compileEffects(effects({ frames: 4, duration: { from: 40, to: 100, ...(ease && { ease }) }, emitters: [{ at: [1, 1], burst: 1, shapes: ['dot'] }] })).recipe.frames.map(f => f.duration);
  assert.deepEqual([timed(), timed('in'), timed('hold')], [[40, 60, 80, 100], [40, 42, 58, 100], [40, 40, 40, 100]]);
  const { recipe, metadata } = compileEffects(effects({ frames: 4, emitters: [
    { at: [12.4, 9.6], burst: 1, life: 1, shapes: ['dot'], cue: 'impact' },
    { name: 'drop', at: [6, 2], burst: 1, gravity: [0, 4], floor: 10, shapes: ['dot'] }, { from: 'drop', when: 'floor', burst: 1, life: 1, shapes: ['cool'], cue: 'land' }] }));
  assert.deepEqual(recipe.frames.map(f => f.points), [{ impact: [12, 10] }, undefined, { land: [6, 10] }, undefined]);
  assert.deepEqual(metadata.effects.burst.cues, [{ name: 'impact', frame: 0, at: [12, 10] }, { name: 'land', frame: 2, at: [6, 10] }]);
  assert.deepEqual(renderProject(recipe).frames[0].points, { impact: [12, 10] });
});

test('cues named like Object.prototype\'s members become frame points too, and the first cue of a name still wins', () => {
  const names = ['toString', 'constructor', 'hasOwnProperty', 'valueOf'], dot = { burst: 1, life: 1, shapes: ['dot'] };
  const { recipe, metadata } = compileEffects(effects({ frames: 3, looks: { warm: { colors: ['o', 'y', 'w'], thresholds: [0.2, 0.5, 0.8] } },
    layers: [{ kind: 'ring', look: 'warm', at: [12, 12], radius: [2, 6], width: [2, 1], frames: [1, 3], cue: 'isPrototypeOf' }],
    emitters: [...names.map((cue, i) => ({ ...dot, at: [2 + 4 * i, 3], cue })), { ...dot, at: [20, 20], cue: 'toString' }] }));
  const first = Object.fromEntries(names.map((cue, i) => [cue, [2 + 4 * i, 3]]));
  assert.deepEqual(recipe.frames.map(f => f.points), [first, { isPrototypeOf: [12, 12] }, undefined]);
  assert.deepEqual(metadata.effects.burst.cues, [...names.map((name, i) => ({ name, frame: 0, at: [2 + 4 * i, 3] })), { name: 'isPrototypeOf', frame: 1, at: [12, 12] }]);
  assert.deepEqual(renderProject(recipe).frames[0].points, first);
});

test('new emitter fields fail early with paths an agent can act on', () => {
  const bad = (emitters, path, message) => assert.throws(() => compileEffects(effects({ frames: 4, emitters })), error => error.path === path && (!message || message.test(error.message)), path);
  const dot = { at: [1, 1], burst: 1, shapes: ['dot'] };
  bad([dot, { from: 'nope', burst: 1, shapes: ['dot'] }], 'fx.effects.burst.emitters[1].from', /no earlier emitter/);
  bad([{ ...dot, name: 'a' }, { ...dot, name: 'a' }, { from: 'a', burst: 1, shapes: ['dot'] }], 'fx.effects.burst.emitters[2].from', /unique name/);
  bad([{ from: 'a', burst: 1, shapes: ['dot'] }, { ...dot, name: 'a' }], 'fx.effects.burst.emitters[0].from', /before its children/);
  bad([{ ...dot, name: 'a' }, { from: 'a', when: 'floor', burst: 1, shapes: ['dot'] }], 'fx.effects.burst.emitters[1].when', /no floor/);
  bad([{ ...dot, name: 'a' }, { from: 'a', when: 'life', burst: 1, shapes: ['dot'] }], 'fx.effects.burst.emitters[1].burst', /uses rate/);
  bad([{ ...dot, name: 'a' }, { from: 'a', rate: 1, shapes: ['dot'] }], 'fx.effects.burst.emitters[1].rate', /uses burst/);
  bad([{ ...dot, name: 'a' }, { from: 'a', when: 'later', burst: 1, shapes: ['dot'] }], 'fx.effects.burst.emitters[1].when');
  bad([{ ...dot, name: 'a' }, { from: 'a', burst: 1, start: 1, shapes: ['dot'] }], 'fx.effects.burst.emitters[1].start');
  bad([{ ...dot, inherit: 1 }], 'fx.effects.burst.emitters[0].inherit', /child emitter/);
  bad([{ burst: 1, shapes: ['dot'] }], 'fx.effects.burst.emitters[0].at');
  bad([{ ...dot, area: [2, 2], ring: { radius: 2 } }], 'fx.effects.burst.emitters[0].ring', /one of area/);
  bad([{ ...dot, ring: { radius: 2, arc: [90, 0] } }], 'fx.effects.burst.emitters[0].ring.arc');
  bad([{ ...dot, ring: { arc: [0, 90] } }], 'fx.effects.burst.emitters[0].ring.radius');
  bad([{ ...dot, ring: { radius: 2, even: 'yes' } }], 'fx.effects.burst.emitters[0].ring.even');
  bad([{ ...dot, line: { even: true } }], 'fx.effects.burst.emitters[0].line.to');
  bad([{ ...dot, face: true }], 'fx.effects.burst.emitters[0].shapes', /direction of travel/);
  bad([{ ...dot, tint: [] }], 'fx.effects.burst.emitters[0].tint');
  bad([{ ...dot, tint: [{ w: 'nope' }] }], 'fx.effects.burst.emitters[0].tint[0].w');
  bad([{ ...dot, cue: 'aux' }], 'fx.effects.burst.emitters[0].cue', /reserved/);
  bad([{ ...dot, behind: 1 }], 'fx.effects.burst.emitters[0].behind');
  assert.throws(() => compileEffects(effects({ frames: 4, duration: { from: 40, to: 90, ease: 'wobble' }, emitters: [dot] })), error => error.path === 'fx.effects.burst.duration.ease');
  assert.throws(() => compileEffects(effects({ frames: 4, duration: { from: 0, to: 90 }, emitters: [dot] })), error => error.path === 'fx.effects.burst.duration.from');
});

test('fx emitter fields in the schema match the compiler', async () => {
  const schema = JSON.parse(await readFile(path.join(root, 'fx.schema.json'), 'utf8'));
  const emitter = schema.properties.effects.additionalProperties.properties.emitters.items;
  // Probe each listed field with a value of the right shape and check the compiler knows it (no "unknown field").
  const values = { name: 'p', at: [1, 1], area: [1, 1], ring: { radius: 1 }, line: { to: [2, 2] }, burst: 1, rate: 1, start: 0, end: 2, life: 2, angle: 0, speed: 0, gravity: [0, 0], drag: 0,
    attract: { at: [0, 0] }, sway: { amplitude: [1, 0] }, floor: 9, bounce: 0, shapes: ['dot'], face: false, play: 'life', remaps: [], tint: [{}], trail: { color: 'w' }, dissolve: 0.5, pattern: 'bayer4',
    from: 'p', when: 'death', inherit: 0, behind: false, cue: 'hit', sprite: { symbol: 'chip' }, release: {} };
  const unknown = key => {
    const probe = { at: [1, 1], burst: 1, shapes: ['dot'], life: 2, [key]: values[key] ?? 0 };
    try { compileEffects(effects({ frames: 4, emitters: [{ name: 'p', at: [1, 1], burst: 1, shapes: ['dot'], life: 2 }, probe] })); return false; } catch (error) { return /unknown or null field/.test(error.message) && error.path.endsWith(`.${key}`); }
  };
  for (const key of Object.keys(emitter.properties)) assert.equal(unknown(key), false, `${key} is in the schema but the compiler rejects it`);
  assert.equal(unknown('notAField'), true);
  // A spawn point (or a parent), and symbols to draw, a blob drawn into a look or a sprite's own pixels, not symbols and a blob.
  assert.deepEqual(emitter.allOf, [{ anyOf: [{ required: ['at'] }, { required: ['from'] }, { required: ['path'] }] }, { anyOf: [{ required: ['shapes'] }, { required: ['blob'] }, { required: ['sprite'] }] }, { not: { required: ['shapes', 'blob'] } }]);
});

const armSource = poses => ({ format: 'pixelforge-poses', version: 1, name: 'arm', width: 16, height: 16, palette: { a: '#f00', b: '#00f', c: '#0f0' },
  parts: { upper: { rows: ['aaaa'], points: { elbow: [3, 0] } }, blade: { rows: ['bbbbc'], points: { tip: [4, 0] } } }, poses });
const swing = (name, rotate, extra = {}) => ({ name, origin: [4, 8], parts: [{ name: 'arm', part: 'upper', rotate }, { name: 'sword', part: 'blade', attach: { part: 'arm', point: 'elbow' }, rotate }], markers: [{ name: 'tip', part: 'sword', point: 'tip' }], ...extra });

test('rotated pose parts bake into editable symbols and carry their points', () => {
  const { recipe, metadata } = compilePoses(armSource([swing('rest', 0), swing('down', 90), swing('slant', 45), { name: 'back', mirror: 'down' }]));
  assert.deepEqual([recipe.symbols['upper-r90'], recipe.symbols['blade-r45']], [['a', 'a', 'a', 'a'], ['b...', '.b..', '..b.', '...c']]);
  assert.deepEqual(metadata.poses.down.parts.sword.points.tip, [4, 15]);
  assert.deepEqual(recipe.frames.find(f => f.name === 'slant').points, { tip: [9, 13] });
  assert.deepEqual(metadata.poses.back.parts.arm, { definition: 'upper', symbol: 'upper-r90', flipX: true, rotate: -90, topLeft: [3, 8], anchor: [3, 8], points: { elbow: [3, 11] } });
  assert.deepEqual(recipe.frames.find(f => f.name === 'down').layers[1].ops, [{ op: 'stamp', symbol: 'blade-r90', x: 4, y: 11 }]);
  // Unrotated parts compile exactly as before: plain stamps of the definition.
  assert.deepEqual(recipe.frames[0].layers[0].ops, [{ op: 'stamp', symbol: 'upper', x: 4, y: 8 }]);
  const raw = compilePoses(armSource([{ name: 'p', parts: [{ name: 'arm', part: 'upper', rotate: 30, cleanup: false }] }]));
  assert.ok(raw.recipe.symbols['upper-r30-raw']);
  assert.throws(() => compilePoses(armSource([{ name: 'p', parts: [{ name: 'arm', part: 'upper', rotate: 30.5 }] }])), /whole degrees/);
  assert.throws(() => compilePoses({ ...armSource([{ name: 'p', parts: [{ name: 'arm', part: 'upper', rotate: 90 }] }]), parts: { upper: { rows: ['a'] }, 'upper-r90': { rows: ['a'] } } }), /rename that part/);
});

test('tweened poses interpolate offsets and angles, switch shapes at the eased midpoint and keep attachments', () => {
  const { recipe, metadata } = compilePoses(armSource([
    { ...swing('wind', 0), origin: [2, 8] }, { ...swing('strike', 90), origin: [6, 10] },
    { name: 'half', duration: 60, tween: { from: 'wind', to: 'strike', t: 0.5 } },
    { name: 'early', tween: { from: 'wind', to: 'strike', t: 0.5, ease: 'in' } },
    { name: 'again', tween: { from: 'half', to: 'strike', t: 0.5 } },
    { name: 'mirrored', mirror: 'half' }
  ]));
  assert.deepEqual([metadata.poses.half.origin, metadata.poses.half.parts.arm.rotate, metadata.poses.early.parts.arm.rotate, metadata.poses.again.parts.arm.rotate], [[4, 9], 45, 11, 68]);
  assert.deepEqual(metadata.poses.half.tween, { from: 'wind', to: 'strike', t: 0.5 });
  // The sword stays on the rotated elbow; in-betweens fire no markers unless they declare them.
  assert.deepEqual(metadata.poses.half.parts.sword.anchor, metadata.poses.half.parts.arm.points.elbow);
  assert.deepEqual(metadata.poses.half.markers, []);
  assert.equal(recipe.frames.find(f => f.name === 'half').duration, 60);
  assert.ok(renderProject(recipe).frames.find(f => f.name === 'mirrored'));
  assert.throws(() => compilePoses(armSource([swing('a', 0), { name: 'b', mirror: 'a' }, { name: 'c', tween: { from: 'a', to: 'b', t: 0.5 } }])), /mirror the finished tween/);
  assert.throws(() => compilePoses(armSource([swing('a', 0), { name: 'b', parts: [{ name: 'arm', part: 'upper' }] }, { name: 'c', tween: { from: 'a', to: 'b', t: 0.5 } }])), /same part instances/);
  assert.throws(() => compilePoses(armSource([swing('a', 0), swing('b', 90), { name: 'c', tween: { from: 'a', to: 'b', t: 2 } }])), /from 0 to 1/);
  assert.throws(() => compilePoses(armSource([swing('a', 0), swing('b', 90), { name: 'c', origin: [0, 0], tween: { from: 'a', to: 'b', t: 0.5 } }])), /interpolate the parts and origin/);
});

test('scene trajectories ease each segment and still land on whole pixels', () => {
  const dot = { version: 1, name: 'dot', width: 1, height: 1, palette: { w: '#fff' }, frames: [{ name: 'a', ops: [{ op: 'pixel', x: 0, y: 0, color: 'w' }] }] };
  const x = (ease, time) => renderScene(prepareScene({ format: 'pixelforge-scene', version: 1, name: 'path', width: 16, height: 4, duration: 200, assets: { dot },
    instances: [{ asset: 'dot', at: [0, 0], trajectory: [{ time: 0, at: [0, 1], ...(ease && { ease }) }, { time: 100, at: [10, 1] }] }] }), { time }).placements[0].x;
  assert.deepEqual([x(undefined, 25), x('inOut', 25), x('hold', 99), x('hold', 100), x('out', 50), x('overshoot', 57), x('overshoot', 100)], [3, 1, 0, 10, 9, 11, 10]);
  assert.throws(() => prepareScene({ format: 'pixelforge-scene', version: 1, name: 'path', width: 4, height: 4, assets: { dot }, instances: [{ asset: 'dot', at: [0, 0], trajectory: [{ time: 0, at: [0, 0], ease: 'wobble' }, { time: 10, at: [1, 0] }] }] }), /expected one of linear/);
});

test('the CLI compiles effect sources and keeps their shared palette link', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-fx-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'palette.json'), JSON.stringify({ w: '#fff', y: '#fd6', o: '#e83', g: '#6b4', l: '#9d6' }));
  const source = { ...effects({ frames: 3, emitters: [{ at: [4, 4], burst: 2, speed: 1, shapes: ['dot'] }] }), palette: { $ref: 'palette.json' } };
  await writeFile(path.join(dir, 'burst.fx.json'), JSON.stringify(source));
  const run = spawnSync(process.execPath, [path.join(root, 'bin/pixelbolt.js'), 'compile', path.join(dir, 'burst.fx.json'), '--out', path.join(dir, 'out/burst.json'), '--metadata', path.join(dir, 'out/burst.meta.json')], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const recipe = JSON.parse(await readFile(path.join(dir, 'out/burst.json'), 'utf8'));
  assert.deepEqual(recipe.palette, { $ref: '../palette.json' });
  assert.equal(JSON.parse(await readFile(path.join(dir, 'out/burst.meta.json'), 'utf8')).format, 'pixelforge-fx-metadata');
  const validate = spawnSync(process.execPath, [path.join(root, 'bin/pixelbolt.js'), 'validate', path.join(dir, 'out/burst.json')], { encoding: 'utf8' });
  assert.equal(JSON.parse(validate.stdout).frames, 3);
  // compile dispatches on the source format, so it also builds autotile templates.
  await writeFile(path.join(dir, 'turf.autotile.json'), JSON.stringify({ format: 'pixelforge-autotile', version: 1, name: 'turf', tile: 2, mode: 'cardinal', palette: { g: '#0a0' }, template: Array(6).fill('gggg'), frame: 'turf-{mask}' }));
  const tiles = spawnSync(process.execPath, [path.join(root, 'bin/pixelbolt.js'), 'compile', path.join(dir, 'turf.autotile.json'), '--out', path.join(dir, 'out/turf.json')], { encoding: 'utf8' });
  assert.equal(tiles.status, 0, tiles.stderr);
  assert.equal(JSON.parse(await readFile(path.join(dir, 'out/turf.json'), 'utf8')).frames.length, 16);
});

// ---- Sprites: particles from a symbol's pixels, a release that takes it apart, and symbols from a recipe's frame -----
const block = { block: ['yyy', 'yoy', 'yyy'], bar: ['y', 'y', 'o', 'o', 'y', 'y'] };
const sprited = (effect, extra = {}) => effects(effect, { symbols: { ...effects({}).symbols, ...block }, ...extra });
const gridIn = frame => (frame.ops ?? []).find(op => op.op === 'grid');
const cellsOf = grid => (grid ? grid.rows.flatMap((row, j) => [...row].map((key, i) => ({ x: grid.x + i, y: grid.y + j, key }))).filter(c => c.key !== '.') : []);

test('a sprite emitter spawns on the pixels it names: every one, its edge, or the outline just outside it', () => {
  const count = pixels => compileEffects(sprited({ frames: 2, emitters: [{ sprite: { symbol: 'block', pixels }, at: [4, 4], burst: 1, life: 2, shapes: ['dot'] }] })).metadata.effects.burst.emitters[0].pixels;
  assert.deepEqual(['all', 'edge', 'outline'].map(count), [9, 8, 12]);
  // Without shapes, each particle is its own pixel, in its colour, at its place on the canvas (top-left at at).
  const still = compileEffects(sprited({ frames: 2, seed: 3, emitters: [{ sprite: { symbol: 'block' }, at: [4, 4], burst: 30, life: 2 }] }));
  const drawn = cellsOf(gridIn(still.recipe.frames[0]));
  assert.ok(drawn.length > 1 && drawn.every(c => c.x >= 4 && c.x < 7 && c.y >= 4 && c.y < 7 && c.key === block.block[c.y - 4][c.x - 4]), JSON.stringify(drawn));
  // draw: true keeps the whole sprite under its particles; outline particles start outside it.
  const ringed = compileEffects(sprited({ frames: 2, emitters: [{ sprite: { symbol: 'block', pixels: 'outline', draw: true }, at: [4, 4], burst: 12, life: 2, shapes: ['dot'] }] }));
  const [grid, ...stamps] = opsOf(ringed.recipe)[0];
  assert.deepEqual(grid, { op: 'grid', x: 4, y: 4, rows: block.block });
  assert.ok(stamps.length === 12 && stamps.every(op => op.op === 'stamp' && (op.x < 4 || op.x > 6 || op.y < 4 || op.y > 6)));
});

test('a release takes every pixel once in the order of its sweep and draws what is left of the sprite', () => {
  const run = release => compileEffects(sprited({ frames: 6, emitters: [{ sprite: { symbol: 'bar' }, at: [5, 5], release, angle: 180, speed: 2, life: 2 }] }));
  const { recipe, metadata } = run({ sweep: 270, jitter: 0 });
  assert.equal(metadata.effects.burst.emitters[0].spawned, 6);
  recipe.frames.forEach((frame, k) => {
    // Bottom first: by frame k the lowest k pixels have gone, and the one leaving now still sits in its place.
    const column = cellsOf(gridIn(frame)).filter(c => c.x === 5).map(c => c.y).sort((a, b) => a - b);
    assert.deepEqual(column, Array.from({ length: 6 - k }, (_, i) => 5 + i), `frame ${k}`);
  });
  // Without a sweep the order is seeded at random; share: 0 spawns nothing, yet the sprite still empties.
  assert.deepEqual(run({}), run({}));
  const quiet = run({ share: 0 });
  assert.equal(quiet.metadata.effects.burst.emitters[0].spawned, 0);
  assert.equal(cellsOf(gridIn(quiet.recipe.frames[5])).length, 0);
});

test('pixel particles keep their colours, or take a tint: a stage of one colour turns a particle whole', () => {
  const keys = tint => compileEffects(sprited({ frames: 4, emitters: [{ sprite: { symbol: 'block' }, at: [4, 4], burst: 20, life: 4, tint }] })).recipe.frames.map(f => [...new Set(cellsOf(gridIn(f)).map(c => c.key))].sort().join(''));
  assert.deepEqual(keys([{}, 'w']), ['oy', 'oy', 'w', 'w']);
  assert.deepEqual(keys([{ o: 'g' }]), ['gy', 'gy', 'gy', 'gy']);
  // A one-colour stage remaps every character of a symbol particle.
  const chip = compileEffects(effects({ frames: 2, emitters: [{ at: [12, 12], burst: 1, life: 2, shapes: ['chip'], tint: [{}, 'w'] }] }));
  assert.deepEqual(opsOf(chip.recipe).map(ops => ops[0].remap), [undefined, { y: 'w', o: 'w' }]);
});

test('sprite mistakes name the field to fix', () => {
  const wrong = (emitter, extra = {}) => { try { compileEffects(sprited({ frames: 4, ...extra, emitters: [emitter] })); } catch (error) { return `${error.path}: ${error.message}`; } return 'compiled'; };
  const base = { sprite: { symbol: 'block' }, at: [4, 4], burst: 1, life: 2 };
  assert.match(wrong({ ...base, sprite: { symbol: 'nope' } }), /sprite\.symbol: .*none named "nope"/);
  assert.match(wrong({ ...base, at: undefined }), /emitters\[0\]\.at: a sprite emitter needs at/);
  assert.match(wrong({ ...base, area: [3, 3] }), /\.area: a sprite emitter spawns on the sprite's pixels/);
  assert.match(wrong({ ...base, sprite: { symbol: 'block', pixels: 'outline' } }), /\.shapes: particles from a sprite's outline start on empty pixels/);
  assert.match(wrong({ ...base, burst: undefined, release: { sweep: 90 } }, { loop: true }), /\.release: a sprite comes apart once/);
  assert.match(wrong({ at: [4, 4], release: {}, life: 2, shapes: ['dot'] }), /\.release: release lets each pixel of a sprite leave once/);
  assert.match(wrong({ ...base, release: {} }), /emitters\[0\]: use exactly one of burst .*, rate .* or release/);
  assert.match(wrong({ ...base, tint: ['#fff'] }), /\.tint\[0\]: a sprite's pixel particles change to single-character palette keys/);
  assert.match(wrong({ ...base, burst: undefined, release: { jitter: 0.5 } }), /release\.jitter: jitter loosens a sweep/);
});

test('a symbol can be a frame of a recipe or pose source, its colours joining the palette under free keys', async () => {
  const recipe = { version: 1, name: 'man', width: 4, height: 3, palette: { y: '#000', q: '#123456' }, frames: [{ name: 'stand', ops: [{ op: 'grid', rows: ['.yq.', 'yyyy', '.q..'] }] }, { name: 'duck', ops: [{ op: 'grid', y: 1, rows: ['qqqq'] }] }] };
  const plain = symbols => compileEffects(effects({ frames: 1, emitters: [{ at: [1, 1], burst: 1, shapes: ['dot'] }] }, { symbols: { ...effects({}).symbols, ...symbols } }));
  const compiled = plain({ man: { recipe, frame: 'stand' } });
  // The effect's y is #fd6, so the recipe's y (#000) takes the first free letter; its q keeps its own key.
  assert.deepEqual(compiled.recipe.symbols.man, ['.Aq.', 'AAAA', '.q..']);
  assert.deepEqual([compiled.recipe.palette.A, compiled.recipe.palette.q, compiled.recipe.palette.y], ['#000000', '#123456', '#fd6']);
  // The first frame by default; a pose source compiles first; a missing frame lists the ones there are.
  assert.deepEqual(plain({ man: { recipe } }).recipe.symbols.man, compiled.recipe.symbols.man);
  assert.equal(plain({ arm: { recipe: armSource([swing('rest', 0)]), frame: 'rest' } }).recipe.symbols.arm.length, 16);
  const wrong = symbol => { try { plain({ man: symbol }); } catch (error) { return `${error.path}: ${error.message}`; } return 'compiled'; };
  assert.match(wrong({ recipe, frame: 'jump' }), /symbols\.man\.frame: man has no frame named "jump"; it has stand, duck/);
  assert.match(wrong({ recipe: 'man.json' }), /symbols\.man\.recipe: file and revision references are resolved by the CLI and MCP/);
  assert.match(wrong({ recipe: { format: 'pixelforge-fx' } }), /symbols\.man\.recipe: expected a recipe or a pixelforge-poses, pixelforge-fluid or pixelforge-wave source, not pixelforge-fx/);
  // The CLI and MCP inline a file named there, relative to the source.
  const { resolveReferences } = await import('../src/resolve.js');
  const source = effects({ frames: 1, emitters: [{ sprite: { symbol: 'hero' }, at: [0, 0], burst: 1, life: 1 }] }, { width: 32, height: 36, symbols: { hero: { recipe: 'hero.poses.json', frame: 'idle-rest' } } });
  const { document, files } = await resolveReferences(source, { baseDir: path.join(root, 'examples') });
  assert.equal(document.symbols.hero.recipe.format, 'pixelforge-poses');
  assert.ok(files.some(file => file.endsWith('hero.poses.json')));
  assert.equal(compileEffects(document).recipe.symbols.hero.length, 36);
});

test('the hero magic example compiles from the hero\'s pose source to the pixels that were approved, its aura looping', async () => {
  const { resolveReferences } = await import('../src/resolve.js');
  const { createHash } = await import('node:crypto');
  const written = JSON.parse(await readFile(path.join(root, 'examples/hero-magic.fx.json'), 'utf8'));
  const { recipe } = compileEffects((await resolveReferences(written, { baseDir: path.join(root, 'examples') })).document);
  const project = renderProject(recipe);
  assert.deepEqual(project.warnings, []);
  // This changes with any change to the sprite, aura or particle pixels: regenerate it only after the art is seen again.
  assert.equal(createHash('sha256').update(JSON.stringify(recipe)).digest('hex'), '20b2a333f54dfca726644909242d7060552fc2b0c870769468b86c9e18181e1f');
  // The aura's last frame runs into its first no more than any two neighbouring frames differ.
  const aura = project.frames.filter(frame => frame.name.startsWith('aura-')).map(frame => frame.data);
  const differ = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 3] !== b[i + 3] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++; return n; };
  const inside = aura.slice(1).map((frame, k) => differ(aura[k], frame)), seam = differ(aura[aura.length - 1], aura[0]);
  assert.ok(seam <= Math.max(...inside), `seam ${seam}, inside ${inside}`);
});

// ---- Animations and trails: sprites frame for frame, and smears that follow a point ----------------------------------------
const blink = { version: 1, name: 'blink', width: 6, height: 1, palette: { q: '#123456', r: '#654321' },
  frames: [{ name: 'a', ops: [{ op: 'grid', rows: ['qq....'] }] }, { name: 'b', ops: [{ op: 'grid', rows: ['....rr'] }] }], animations: { blink: { frames: ['a', 'b'] } } };
const swingPoses = JSON.parse(await readFile(path.join(root, 'examples/swing.poses.json'), 'utf8'));

test('a sprite or an aura follows an animation frame for frame, holding its last frame or going round in a loop', () => {
  const drawn = (frames, loop) => compileEffects(effects({ frames, loop, emitters: [{ sprite: { symbol: 'eye', draw: true }, at: [2, 2] }] }, { symbols: { eye: { recipe: blink, animation: 'blink' } } }));
  const once = drawn(3, false);
  assert.deepEqual(once.recipe.frames.map(f => gridIn(f).rows[0]), ['qq', 'rr', 'rr']);
  assert.deepEqual(once.recipe.frames.map(f => gridIn(f).x), [2, 6, 6]);
  assert.equal(once.recipe.symbols?.eye, undefined, 'an animation is not stamped, so it stays out of the recipe\'s symbols');
  assert.deepEqual(drawn(4, true).recipe.frames.map(f => gridIn(f).rows[0]), ['qq', 'rr', 'qq', 'rr']);
  // An aura hugs the frame showing.
  const glow = compileEffects(effects({ frames: 2, looks: { warm: { colors: ['y'], thresholds: [0.3] } }, layers: [{ kind: 'aura', symbol: 'eye', at: [8, 10], width: 2, noise: 0 }] }, { symbols: { eye: { recipe: blink, animation: 'blink' } } }));
  assert.equal(gridIn(glow.recipe.frames[1]).x - gridIn(glow.recipe.frames[0]).x, 4);
  const wrong = emitter => { try { compileEffects(effects({ frames: 3, emitters: [emitter] }, { symbols: { ...effects({}).symbols, eye: { recipe: blink, animation: 'blink' } } })); } catch (error) { return `${error.path}: ${error.message}`; } return 'compiled'; };
  assert.match(wrong({ at: [1, 1], burst: 1, shapes: ['eye'] }), /shapes\[0\]: eye is an animation: a sprite or an aura can follow it, but a particle draws one symbol/);
  assert.match(wrong({ sprite: { symbol: 'eye' }, at: [1, 1], release: {} }), /sprite\.symbol: eye is an animation; a release takes apart one frame/);
  assert.match(wrong({ sprite: { symbol: 'eye' }, at: [1, 1] }), /emitters\[0\]: use exactly one of burst/);
});

test('a trail follows a pose point frame for frame and, with a pivot, sweeps round it with its outer edge on the path', async () => {
  const trail = (layer, frames = 5) => compileEffects(effects({ frames, looks: { steel: { colors: ['w'], thresholds: [0.1] } }, layers: [{ kind: 'trail', at: [0, 0], length: 3, width: 6, ...layer }] }, { width: 40, height: 40 })).recipe;
  const follow = { recipe: swingPoses, animation: 'swing', point: 'blade.tip' };
  // The strike (frame 3) sweeps from the raised tip over the top to the struck one.
  const plain = cellsOf(gridIn(trail({ follow }).frames[3])), round = cellsOf(gridIn(trail({ follow: { ...follow, pivot: 'blade.anchor' } }).frames[3]));
  for (const drawn of [plain, round]) assert.ok(drawn.some(c => c.x < 16 && c.y < 16) && drawn.some(c => c.x > 28 && c.y > 24), JSON.stringify(drawn.slice(0, 4)));
  // Round the hilt at [20, 24], no pixel lies beyond the tip's reach (about 14), and it bulges out where the plain curve cuts across.
  const reach = c => Math.sqrt((c.x - 20) ** 2 + (c.y - 24) ** 2);
  assert.ok(round.every(c => reach(c) <= 15.5), Math.max(...round.map(reach)));
  assert.ok(round.filter(c => c.x > 28 && c.y < 20).length > plain.filter(c => c.x > 28 && c.y < 20).length);
  // The first frame has one place, so nothing; the frames after the animation shrink the smear away.
  const frames = trail({ follow: { ...follow, pivot: 'blade.anchor' } }, 7).frames.map(f => cellsOf(gridIn(f)).length);
  assert.ok(frames[0] === 0 && frames[3] > frames[6] && frames[6] > 0, `${frames}`);
  // Fixed points and a fixed pivot work the same way.
  assert.deepEqual(cellsOf(gridIn(trail({ points: [[10, 14], [11, 13], [21, 10], [32, 31], [29, 35]], pivot: [20, 24] }).frames[3])), round);
  const wrong = layer => { try { trail(layer); } catch (error) { return `${error.path}: ${error.message}`; } return 'compiled'; };
  assert.match(wrong({ follow: { ...follow, point: 'blade.edge' } }), /follow\.point: no frame of swing has a point named "blade\.edge"; it has .*blade\.tip/);
  assert.match(wrong({ follow, points: [[1, 1]] }), /\.points: a trail follows a point \(follow\) or takes its positions \(points\), not both/);
  assert.match(wrong({ follow: { ...follow, pivot: 'blade.anchor' }, pivot: [1, 1] }), /\.pivot: the trail already follows a pivot/);
  assert.match(compileEffectsError(() => trail({ follow }, 3)), /follow\.animation: swing has 5 frames and the effect 3/);
  assert.match(wrong({ follow: { ...follow, recipe: 'swing.poses.json' } }), /follow\.recipe: file and revision references are resolved by the CLI and MCP/);
  assert.match(wrong({ points: [null, null] }), /\.points: expected at least one position to follow/);
  // The CLI and MCP inline a file named there.
  const { resolveReferences } = await import('../src/resolve.js');
  const source = effects({ frames: 5, looks: { steel: { colors: ['w'], thresholds: [0.1] } }, layers: [{ kind: 'trail', at: [0, 0], follow: { ...follow, recipe: 'swing.poses.json' } }] });
  const { document } = await resolveReferences(source, { baseDir: path.join(root, 'examples') });
  assert.equal(document.effects.burst.layers[0].follow.recipe.format, 'pixelforge-poses');
});
const compileEffectsError = run => { try { run(); } catch (error) { return `${error.path}: ${error.message}`; } return 'compiled'; };

test('the swing trail example compiles from the swing\'s pose source to the pixels that were approved', async () => {
  const { resolveReferences } = await import('../src/resolve.js');
  const { createHash } = await import('node:crypto');
  const written = JSON.parse(await readFile(path.join(root, 'examples/swing-trail.fx.json'), 'utf8'));
  const { recipe, metadata } = compileEffects((await resolveReferences(written, { baseDir: path.join(root, 'examples') })).document);
  assert.deepEqual(renderProject(recipe).warnings, []);
  assert.deepEqual(metadata.effects.swing.cues, [{ name: 'hit', frame: 3, at: [32, 31] }]);
  // This changes with any change to the trail, sprite or particle pixels: regenerate it only after the art is seen again.
  assert.equal(createHash('sha256').update(JSON.stringify(recipe)).digest('hex'), '553f1d57519cdcb55dd5b64f88842e97bd2a86959a0bff5dfeac85ba86dc93b9');
});

test('a fluid or a wave can play inside an effect as a sprite, drawing exactly the pixels it draws on its own', async () => {
  const { compileFluid } = await import('../src/fluid.js');
  const { compileWaves } = await import('../src/wave.js');
  const smoke = JSON.parse(await readFile(path.join(root, 'examples/smoke-puff.fluid.json'), 'utf8')), portal = JSON.parse(await readFile(path.join(root, 'examples/portal.wave.json'), 'utf8'));
  for (const [kind, source, compile] of [['fluid', smoke, compileFluid], ['wave', portal, compileWaves]]) {
    const alone = renderProject(compile(source).recipe), [name, animation] = Object.entries(alone.animations)[0];
    const inside = compileEffects({ format: 'pixelforge-fx', version: 1, name: 'mix', width: alone.width, height: alone.height,
      symbols: { play: { recipe: source, animation: name } }, effects: { mix: { frames: animation.frames.length, emitters: [{ sprite: { symbol: 'play', draw: true }, at: [0, 0] }] } } });
    const drawn = renderProject(inside.recipe).frames;
    animation.frames.forEach((index, i) => assert.deepEqual(drawn[i].data, alone.frames[index].data, `${kind} frame ${i}`));
  }
});

test('the fluid blast example compiles from the explosion fluid source to the pixels that were approved', async () => {
  const { resolveReferences } = await import('../src/resolve.js');
  const { createHash } = await import('node:crypto');
  const written = JSON.parse(await readFile(path.join(root, 'examples/fluid-blast.fx.json'), 'utf8'));
  const { document, files } = await resolveReferences(written, { baseDir: path.join(root, 'examples') });
  assert.equal(document.symbols.blast.recipe.format, 'pixelforge-fluid');
  assert.ok(files.some(file => file.endsWith('explosion.fluid.json')));
  const { recipe, metadata } = compileEffects(document);
  assert.deepEqual(renderProject(recipe).warnings, []);
  assert.deepEqual(metadata.effects.blast.cues.map(cue => cue.name), ['boom']);
  // This changes with any change to the fluid, shape or particle pixels: regenerate it only after the art is seen again.
  assert.equal(createHash('sha256').update(JSON.stringify(recipe)).digest('hex'), '10784dad44b78f0752cb35d341765c4382032adbb1bc64ed74d84c9da58ec8b0');
});

// ---- Turned copies: one effect drawn in several directions ---------------------------------------------------------------
test('turned copies draw an effect in each direction with its geometry turned, while gravity and light stay put', () => {
  const shot = (turn, extra = {}) => compileEffects(effects({ frames: 3, turn, emitters: [{ at: [12, 12], burst: 1, angle: 0, speed: 3, life: 3, shapes: ['dot'], ...extra }] }));
  const four = shot({ angles: [0, 90, 180, 270], about: [12, 12] });
  assert.deepEqual(Object.keys(four.recipe.animations), ['burst-0', 'burst-90', 'burst-180', 'burst-270']);
  const at = (recipe, name, i) => { const op = recipe.frames.find(f => f.name === `${name}-${i}`).ops[0]; return [op.x, op.y]; };
  assert.deepEqual(['burst-0', 'burst-90', 'burst-180', 'burst-270'].map(name => at(four.recipe, name, 2)), [[18, 12], [12, 18], [6, 12], [12, 6]]);
  assert.deepEqual(four.metadata.effects['burst-90'].turn, { of: 'burst', angle: 90, mirror: false });
  // The copy at 0 is the effect as drawn, pixel for pixel; a mirror flips it across the upright line through about.
  assert.deepEqual(four.recipe.frames.slice(0, 3).map(f => f.ops), shot(undefined).recipe.frames.map(f => f.ops));
  const flipped = shot({ mirror: true, about: [12, 12] });
  assert.deepEqual(Object.keys(flipped.recipe.animations), ['burst-0', 'burst-0-mirror']);
  assert.deepEqual(at(flipped.recipe, 'burst-0-mirror', 2), [6, 12]);
  // Gravity stays down the canvas: thrown left in the half turn, the spark still falls as far as it does thrown right.
  const falling = shot({ angles: [0, 180], about: [12, 12] }, { gravity: [0, 1] });
  const [right, left] = [at(falling.recipe, 'burst-0', 2), at(falling.recipe, 'burst-180', 2)];
  assert.ok(right[1] > 12 && left[1] === right[1] && left[0] === 24 - right[0], `${right} ${left}`);
  // Cues turn with their emitter.
  const cued = shot({ angles: [90], about: [12, 12] }, { at: [18, 12], cue: 'hit' });
  assert.deepEqual(cued.metadata.effects['burst-90'].cues, [{ name: 'hit', frame: 0, at: [12, 18] }]);
  // A lit look keeps its light upper left: a lying ellipse stood up still has its highlight toward the upper left.
  const lit = compileEffects(effects({ frames: 1, turn: { angles: [0, 90] }, looks: { warm: { colors: ['o'], thresholds: [0.2], lit: { colors: ['w'], thresholds: [0.45] } } }, layers: [{ kind: 'burst', at: [12, 12], radius: 9, squash: [1, 0.5], noise: 0 }] }));
  for (const name of ['burst-0', 'burst-90']) {
    const cells = cellsOf(gridIn(lit.recipe.frames.find(f => f.name === `${name}-0`))), shine = cells.filter(c => c.key === 'w');
    const mean = axis => shine.reduce((sum, c) => sum + c[axis], 0) / shine.length;
    assert.ok(shine.length > 3 && mean('x') < 12 && mean('y') < 12, `${name}: ${shine.length} lit, mean ${mean('x')}, ${mean('y')}`);
  }
  const box = name => { const g = gridIn(lit.recipe.frames.find(f => f.name === `${name}-0`)); return [g.rows[0].length, g.rows.length]; };
  assert.deepEqual(box('burst-90'), box('burst-0').reverse());
  // The grain turns with its copy, so a quarter turn of a grainy beam is the drawn one turned, pixel for pixel.
  const beam = compileEffects(effects({ frames: 2, turn: { angles: [0, 90], about: [12, 12] }, looks: { warm: { colors: ['o', 'y'], thresholds: [0.15, 0.5] } }, layers: [{ kind: 'beam', at: [12, 12], to: [2, 12], width: 7, noise: 0.6, scale: 3 }] }));
  const drawn = name => cellsOf(gridIn(beam.recipe.frames.find(f => f.name === name))).map(c => `${c.x},${c.y},${c.key}`).sort();
  const turned = cellsOf(gridIn(beam.recipe.frames.find(f => f.name === 'burst-0-1'))).map(c => `${24 - c.y},${c.x},${c.key}`).sort();
  assert.ok(turned.length > 10);
  assert.deepEqual(drawn('burst-90-1'), turned);
});

test('a turned slash keeps its crescent, a mirror sweeps it the other way, and turn mistakes name the field to fix', () => {
  const slash = turn => compileEffects(effects({ frames: 6, turn, looks: { steel: { colors: ['y', 'w'], thresholds: [0.2, 0.6] } }, layers: [{ kind: 'slash', at: [12, 12], radius: 9, width: 4, arc: [200, 340], reveal: 0.5 }] }));
  const { recipe } = slash({ angles: [0, 180], mirror: true });
  const cells = name => cellsOf(gridIn(recipe.frames.find(f => f.name === `${name}-5`))), side = list => list.reduce((sum, c) => sum + c.y, 0) / list.length;
  // The crescent arcs over the top as drawn and under the bottom turned half way round; mirrored, over the top again.
  assert.ok(side(cells('burst-0')) < 12 && side(cells('burst-180')) > 12 && side(cells('burst-0-mirror')) < 12);
  // Mirrored, its head starts at the other end: the first frame draws on from the right instead of the left.
  const first = name => { const list = cellsOf(gridIn(recipe.frames.find(f => f.name === `${name}-0`))); return list.reduce((sum, c) => sum + c.x, 0) / list.length; };
  assert.ok(first('burst-0') < 12 && first('burst-0-mirror') > 12, `${first('burst-0')} ${first('burst-0-mirror')}`);
  const wrong = (turn, extra = {}) => { try { compileEffects(sprited({ frames: 2, turn, emitters: [{ at: [4, 4], burst: 1, life: 2, shapes: ['dot'] }], ...extra })); } catch (error) { return `${error.path}: ${error.message}`; } return 'compiled'; };
  assert.match(wrong({ angles: [360] }), /turn\.angles\[0\]: expected an integer from 0 to 359/);
  assert.match(wrong({ angles: [90, 90] }), /turn\.angles: list each angle once/);
  assert.match(wrong({ spin: 1 }), /turn: unknown or null field spin|turn\.spin/);
  assert.match(wrong({ angles: [90] }, { emitters: [{ sprite: { symbol: 'block' }, at: [4, 4], burst: 1, life: 2 }] }), /turn: a sprite emitter can't turn/);
  assert.match(compileEffectsError(() => compileEffects(effects({ frames: 1, emitters: [{ at: [1, 1], burst: 1, shapes: ['dot'] }], turn: { angles: [90] } }, { effects: { burst: { frames: 1, emitters: [{ at: [1, 1], burst: 1, shapes: ['dot'] }], turn: { angles: [90] } }, 'burst-90': { frames: 1, emitters: [{ at: [1, 1], burst: 1, shapes: ['dot'] }] } } }))), /burst-90: effect names must be unique ignoring case/);
});

test('a compile reviews each animation: the seam of a loop against its largest step, warned when it jumps, and the residue of a one-shot', () => {
  const ring = (loop, radius) => compileEffects(effects({ frames: 6, loop, looks: { warm: { colors: ['y'], thresholds: [0.2] } }, layers: [{ kind: 'ring', at: [12, 12], radius }] }));
  const steady = ring(true, 6);
  assert.deepEqual(steady.metadata.effects.burst.seam, { pixels: 0, largestStep: 0 });
  assert.equal(steady.warnings, undefined);
  const jumping = ring(true, [1, 9]);
  assert.ok(jumping.metadata.effects.burst.seam.pixels > jumping.metadata.effects.burst.seam.largestStep);
  assert.match(jumping.warnings[0], /^fx\.effects\.burst: burst changes \d+ pixels from its last frame to its first, more than the \d+ between any two others, so the loop jumps/);
  // A one-shot reports what its last frame still draws; a ring that fades to nothing ends empty.
  assert.ok(ring(false, 6).metadata.effects.burst.residue > 0);
  assert.equal(compileEffects(effects({ frames: 6, looks: { warm: { colors: ['y'], thresholds: [0.2] } }, layers: [{ kind: 'ring', at: [12, 12], radius: 6, power: [1, 0] }] })).metadata.effects.burst.residue, 0);
});

test('a compile gives each animation a light track: where its bright pixels are, how much light and what colour', () => {
  const { metadata } = compileEffects(effects({ frames: 4, looks: { warm: { colors: ['o', 'y', 'w'], thresholds: [0.2, 0.5, 0.8] } }, layers: [{ kind: 'burst', at: [10, 14], frames: [0, 3], radius: [6, 2], noise: 0, power: [1.4, 0.3] }] }));
  const light = metadata.effects.burst.light;
  assert.equal(light.length, 4);
  // Brightest on the first frame, centred on the burst, nothing bright once it has gone.
  assert.ok(light[0].glow > light[1].glow && light[0].glow > 10, JSON.stringify(light));
  assert.deepEqual(light[0].at, [10, 14]);
  assert.match(light[0].color, /^#[0-9a-f]{6}$/);
  assert.equal(light[3], null);
});

test('light: true writes the light track into the frames as a point a scene light can follow', async () => {
  const { prepareScene, renderScene } = await import('../src/scene.js');
  const flash = light => compileEffects(effects({ frames: 4, light, looks: { warm: { colors: ['o', 'y', 'w'], thresholds: [0.2, 0.5, 0.8] } }, layers: [{ kind: 'burst', at: [10, 14], frames: [0, 3], radius: [6, 2], noise: 0, power: [1.4, 0.3] }] }));
  const { recipe, metadata } = flash(true);
  assert.deepEqual(recipe.frames.map(f => f.points?.light ?? null), metadata.effects.burst.light.map(l => l?.at ?? null));
  assert.equal(flash(undefined).recipe.frames.some(f => f.points), false, 'without light, frames carry no point');
  // A scene light that follows the point sits on the flash and goes dark with it.
  const scene = { format: 'pixelforge-scene', version: 1, name: 'lit', width: 24, height: 24, duration: 400, assets: { boom: recipe },
    instances: [{ name: 'boom', asset: 'boom', at: [0, 0], animation: 'burst' }], lighting: { scope: 'all', lights: [{ follow: { instance: 'boom', point: 'light' }, radius: 20 }] } };
  const prepared = prepareScene(scene), at = time => renderScene(prepared, { time }).lights ?? [];
  assert.deepEqual(at(0).map(light => light.at), [[10, 14]]);
  assert.ok(at(0)[0].strength > 0 && at(390).every(light => light.strength === 0), JSON.stringify(at(390)));
});

test('attract swirl turns particles round the point, clockwise when positive, the other way when mirrored', () => {
  const orbit = (swirl, turn) => compileEffects(effects({ frames: 6, ...(turn && { turn }), emitters: [{ at: [10, 4], burst: 1, speed: 0, life: 12, shapes: ['dot'], attract: { at: [10, 14], strength: 0.4, ...(swirl !== undefined && { swirl }) } }] })).recipe;
  const xs = (recipe, animation = 'burst') => recipe.animations[animation].frames.map(name => recipe.frames.find(f => f.name === name).ops[0].x);
  // Without swirl the particle falls straight to the point; clockwise round a point below means moving right first.
  const plain = xs(orbit(undefined)), right = xs(orbit(0.6)), left = xs(orbit(-0.6));
  assert.deepEqual(xs(orbit(0)), plain);
  assert.ok(plain.every(x => x === plain[0]), String(plain));
  assert.ok(right.at(-1) > plain[0] && left.at(-1) < plain[0], `${right} / ${left}`);
  // A mirrored copy, about a vertical line through the point, swirls the other way: right becomes left.
  const turned = orbit(0.6, { angles: [0], mirror: true, about: [10, 14] });
  assert.deepEqual(xs(turned, Object.keys(turned.animations).find(name => name.endsWith('mirror'))), left);
});

test('turbulence pushes particles along a still seeded field: they wander apart, the same way every time', () => {
  const smoke = turbulence => compileEffects(effects({ frames: 10, emitters: [{ at: [12, 22], area: [9, 1], burst: 8, angle: 270, speed: 0.6, life: 20, shapes: ['dot'], ...(turbulence !== undefined && { turbulence }) }] })).recipe;
  const spread = recipe => { const xs = recipe.frames.at(-1).ops.map(op => op.x); return xs.reduce((sum, x) => sum + Math.abs(x - xs.reduce((a, b) => a + b, 0) / xs.length), 0); };
  const plain = smoke(undefined);
  assert.deepEqual(smoke({ strength: 0 }), plain);
  const stirred = smoke({ strength: 0.4, scale: 6 });
  assert.deepEqual(smoke({ strength: 0.4, scale: 6 }), stirred);
  assert.notDeepEqual(stirred.frames.at(-1).ops, plain.frames.at(-1).ops);
  // Rising straight, each particle keeps its column; stirred, they leave them.
  const moved = stirred.frames.at(-1).ops.filter((op, i) => op.x !== plain.frames.at(-1).ops[i]?.x).length;
  assert.ok(moved >= 4, `${moved} of 8 moved; spread ${spread(plain)} vs ${spread(stirred)}`);
  assert.throws(() => smoke({ strength: 0.4, swirl: 1 }), /turbulence\.swirl/);
});

test('an emitter with a path moves its spawn centre along it over its window, in step with a layer of the same window', () => {
  const trail = (emitter, effect = {}) => compileEffects(effects({ frames: 7, ...effect, emitters: [{ rate: 1, speed: 0, life: 40, shapes: ['dot'], ...emitter }] })).recipe;
  const last = recipe => recipe.frames.at(-1).ops.map(op => [op.x, op.y]);
  // Standing still, every particle sits on one pixel; moving, frame k spawns at progress k / 7 along the path.
  assert.equal(new Set(last(trail({ at: [2, 12] })).map(String)).size, 1);
  assert.deepEqual(last(trail({ path: [[2, 12], [23, 12]] })), [0, 3, 6, 9, 12, 15, 18].map(dx => [2 + dx, 12]));
  // Through several points, and over a window of its own: from start to end, then no more spawns.
  assert.deepEqual(last(trail({ path: [[2, 2], [14, 2], [14, 14]] }, { frames: 6 })).map(String), ['2,2', '6,2', '10,2', '14,2', '14,6', '14,10']);
  assert.deepEqual(last(trail({ path: [[2, 12], [14, 12]], start: 1, end: 5 })), [[2, 12], [5, 12], [8, 12], [11, 12]]);
  // Several spawns in a frame spread along the stretch travelled since the last frame, so a fast trail stays even.
  assert.deepEqual(last(trail({ path: [[2, 12], [23, 12]], rate: 3 })).map(([x]) => x), [2, 2, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  // A turned copy moves its path too.
  const turned = trail({ path: [[2, 12], [23, 12]] }, { turn: { angles: [180], about: [12, 12] } });
  assert.deepEqual(last(turned), [0, 3, 6, 9, 12, 15, 18].map(dx => [22 - dx, 12]));
  assert.throws(() => trail({ at: [2, 12], path: [[2, 12], [20, 12]] }), /leave at out/);
  assert.throws(() => trail({ path: [[2, 12]] }), /expected 2–16 points/);
});

test('a keyed rate ramps the emission from start to end, and a steady rate spawns as before', () => {
  const spray = rate => compileEffects(effects({ frames: 8, emitters: [{ at: [12, 12], rate, speed: 0, life: 1, shapes: ['dot'] }] }));
  const perFrame = rate => spray(rate).recipe.frames.map(frame => frame.ops?.length ?? 0);
  assert.deepEqual(perFrame(2), Array(8).fill(2));
  // Thick at first, tapering to nothing; the total is the running sum of the keys.
  const ramp = perFrame([4, 0]);
  assert.deepEqual(ramp, [4, 3, 3, 2, 2, 1, 1, 0]);
  assert.equal(spray([4, 0]).metadata.effects.burst.emitters[0].spawned, ramp.reduce((a, b) => a + b, 0));
  assert.throws(() => spray([0, 0]), /every key is 0/);
  assert.throws(() => spray([1]), /2–8 of them as keys/);
});

test('children that spawn while a fast parent lives spread along the stretch it moved, so its trail stays even', () => {
  const comet = rate => compileEffects(effects({ frames: 5, emitters: [
    { name: 'head', at: [2, 12], burst: 1, angle: 0, speed: 4, life: 20, shapes: ['warm'] },
    { from: 'head', when: 'life', rate, speed: 0, life: 20, shapes: ['dot'] }] })).recipe;
  const xs = recipe => recipe.frames.at(-1).ops.filter(op => op.symbol === 'dot').map(op => op.x).sort((a, b) => a - b);
  // One child a frame sits where the parent is; four a frame fill the four pixels it crossed.
  assert.deepEqual(xs(comet(1)), [2, 6, 10, 14, 18]);
  assert.deepEqual(xs(comet(4)), [2, 2, 2, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
});

test('spin turns each particle\'s symbol in 45° RotSprite steps from a seeded start, and without spin nothing changes', async () => {
  const { rotateRows } = await import('../src/craft.js');
  const tumble = spin => compileEffects(effects({ frames: 4, emitters: [{ at: [12, 12], burst: 1, speed: 0, life: 10, shapes: ['chip'], ...(spin !== undefined && { spin }) }] })).recipe;
  const drawn = recipe => recipe.frames.map(frame => frame.ops[0].symbol);
  assert.deepEqual(drawn(tumble(undefined)), ['chip', 'chip', 'chip', 'chip']);
  assert.deepEqual(tumble(0), tumble(undefined));
  // A quarter turn a frame steps two 45° stops a frame; each turned symbol is the RotSprite turn of the original.
  const recipe = tumble(90), names = drawn(recipe);
  const step = name => (name === 'chip' ? 0 : Number(name.split('_r')[1]) / 45);
  names.slice(1).forEach((name, i) => assert.equal((step(name) - step(names[i]) + 8) % 8, 2, String(names)));
  for (const name of names.filter(n => n !== 'chip')) assert.deepEqual(recipe.symbols[name], rotateRows(recipe.symbols.chip, Number(name.split('_r')[1]), [1, 1]).rows);
  assert.throws(() => compileEffects(effects({ frames: 2, emitters: [{ at: [12, 12], burst: 1, life: 2, shapes: [['dot'], ['warm']], face: true, spin: 10 }] })), /use one or the other/);
});

test('curve runs a path and keyed drift through a smooth curve that still passes every point', async () => {
  const { curveSample } = await import('../src/shapes.js');
  // Through every key, and level with its neighbours at a symmetric peak instead of turning a corner there.
  assert.equal(curveSample([0, 10, 0], 0), 0);
  assert.equal(curveSample([0, 10, 0], 0.5), 10);
  assert.equal(curveSample([0, 10, 0], 1), 0);
  assert.ok(curveSample([0, 10, 0], 0.4) > 0.8 * 10 && curveSample([0, 10, 0], 0.4) < 10);
  const arc = (curve, extra = {}) => compileEffects(effects({ frames: 8, emitters: [{ path: [[2, 20], [12, 4], [22, 20]], rate: 1, speed: 0, life: 40, shapes: ['dot'], ...(curve !== undefined && { curve }), ...extra }] })).recipe.frames.at(-1).ops.map(op => [op.x, op.y]);
  const straight = arc(undefined), curved = arc(true);
  assert.deepEqual(arc(false), straight);
  // The same start and peak (frame 4 is halfway); the curve's sides bow outward, above the straight lines.
  assert.deepEqual([curved[0], curved[4]], [straight[0], [12, 4]]);
  assert.deepEqual(straight[4], [12, 4]);
  assert.ok(curved.slice(1, -1).every((p, i) => p[1] <= straight[i + 1][1]) && curved.some((p, i) => p[1] < straight[i][1]), JSON.stringify(curved));
  assert.throws(() => arc(true, { path: [[2, 20], [22, 20]] }), /give path three or more points/);
});

test('a squashed spawn ring lies on the ground as an ellipse, and without squash it spawns as before', () => {
  const circle = squash => compileEffects(effects({ frames: 1, emitters: [{ at: [12, 12], ring: { radius: 10, even: true, ...(squash && { squash }) }, burst: 16, speed: 0, life: 2, shapes: ['dot'] }] })).recipe.frames[0].ops.map(op => [op.x, op.y]);
  assert.deepEqual(circle([1, 1]), circle(undefined));
  const flat = circle([1, 0.4]), xs = flat.map(p => p[0]), ys = flat.map(p => p[1]);
  assert.deepEqual([Math.min(...xs), Math.max(...xs)], [2, 22]);
  assert.deepEqual([Math.min(...ys), Math.max(...ys)], [8, 16]);
});

test('a spawn ring that grows spawns farther out over the emitter\'s window, in step with a ring layer\'s keys', () => {
  const wave = grow => compileEffects(effects({ frames: 5, emitters: [{ at: [12, 12], ring: { radius: 10, even: true, ...(grow && { grow }) }, rate: 4, speed: 0, life: 1, shapes: ['dot'] }] })).recipe;
  const reach = frame => Math.max(...frame.ops.map(op => Math.abs(op.x - 12)));
  assert.deepEqual(wave(undefined).frames.map(reach), [10, 10, 10, 10, 10]);
  // Keys [0, 1] over five frames: progress k / 5, so the spawn ring's radius is 0, 2, 4, 6 and 8.
  assert.deepEqual(wave([0, 1]).frames.map(reach), [0, 2, 4, 6, 8]);
  assert.throws(() => wave([1]), /expected 2–8 keys scaling the radius/);
});

test('a filled spawn ring spreads particles evenly by area instead of crowding the middle', () => {
  const disc = fill => compileEffects(effects({ frames: 1, emitters: [{ at: [24, 24], ring: { radius: [0, 20], ...(fill !== undefined && { fill }) }, burst: 400, speed: 0, life: 2, shapes: ['dot'] }] }, { width: 48, height: 48 })).recipe.frames[0].ops;
  const inner = ops => ops.filter(op => Math.hypot(op.x - 24, op.y - 24) < 10).length / ops.length;
  assert.deepEqual(disc(false), disc(undefined));
  // Half the radius holds a quarter of the disc's area: about half the particles without fill, about a quarter with it.
  assert.ok(inner(disc(undefined)) > 0.4 && inner(disc(true)) < 0.32, `${inner(disc(undefined))} / ${inner(disc(true))}`);
});

test('a moving emitter\'s particles can inherit its motion along the path', () => {
  const sparks = inherit => compileEffects(effects({ frames: 4, emitters: [{ path: [[2, 12], [18, 12]], rate: 1, speed: 0, life: 10, shapes: ['dot'], ...(inherit !== undefined && { inherit }) }] })).recipe.frames.at(-1).ops.map(op => op.x);
  // The emitter moves 4 pixels a frame; without inherit its particles stay where they were born, with 0.5 they follow at 2.
  assert.deepEqual(sparks(undefined), [2, 6, 10, 14]);
  assert.deepEqual(sparks(0), sparks(undefined));
  assert.deepEqual(sparks(0.5), [8, 10, 12, 14]);
  assert.throws(() => compileEffects(effects({ frames: 2, emitters: [{ at: [2, 12], rate: 1, life: 2, shapes: ['dot'], inherit: 1 }] })), /applies to a child emitter or one moving along a path/);
});

test('sweep turns the launch angle by keys over the emitter\'s window, and without it nothing changes', () => {
  const nozzle = sweep => compileEffects(effects({ frames: 5, emitters: [{ at: [12, 12], rate: 1, angle: 0, speed: 4, life: 2, shapes: ['dot'], ...(sweep && { sweep }) }] }));
  // One particle a frame, drawn where it was born and then a frame later: read each one's step from frame to frame.
  const steps = recipe => recipe.frames.slice(1).map(frame => { const [older] = frame.ops; return [older.x - 12, older.y - 12]; });
  assert.deepEqual(nozzle(undefined).recipe, nozzle(undefined).recipe);
  assert.deepEqual(steps(nozzle(undefined).recipe), [[4, 0], [4, 0], [4, 0], [4, 0]]);
  // Keys [0, 90] over five frames: progress k / 5, so the particles launch at 0, 18, 36 and 54 degrees.
  assert.deepEqual(steps(nozzle([0, 90]).recipe), [[4, 0], [4, 1], [3, 2], [2, 3]]);
  assert.throws(() => nozzle([10]), /expected 2–8 keys in degrees/);
});
