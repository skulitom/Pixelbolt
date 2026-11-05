import test from 'node:test';
import assert from 'node:assert/strict';
import { renderProject, parseColor, PixelError } from '../src/core.js';
import { compileFluid, createLiveFluid } from '../src/fluid.js';
import { compileBodies } from '../src/bodies.js';
import { fluidBodyPresets } from '../scripts/fluid-body-presets.mjs';
import { bodiesPresets } from '../scripts/bodies-presets.mjs';

// Bodies in a liquid (docs/physics-model.md, section 13): moving solids that shove it, floated and dragged by water,
// held up by resting sand.
const palette = { b: '#2f6fc0', B: '#1d3f7a', s: '#d1a457', k: '#111111', h: '#c98c4f', g: '#888888' };
const pool = (bodies, extra = {}) => ({ format: 'pixelforge-fluid', version: 1, name: 'pool', width: 48, height: 40, palette,
  effects: { pool: { kind: 'liquid', frames: 100, duration: 50, seed: 3, walls: ['left', 'right', 'bottom'], flip: 0.3, drag: 0.05, fill: [{ x: 0, y: 24, w: 48, h: 16 }], emitters: [],
    look: [{ field: 'density', colors: ['b'], thresholds: [0.5], dither: 0 }], bodies, ...extra } } });
const refused = (source, where, pattern) => assert.throws(() => compileFluid(source), error => error instanceof PixelError && error.path === where && pattern.test(error.message), where);
const paths = source => Object.values(compileFluid(source).metadata.effects)[0].bodies.paths;
// How many pixels of the given colours change from each frame to the next, from frame `from` on.
const changes = (source, keys, from) => {
  const project = renderProject(compileFluid(source).recipe), [animation] = Object.values(project.animations);
  const colours = keys.split('').map(key => parseColor(source.palette[key]).slice(0, 3).join());
  const mask = f => { const d = project.frames[animation.frames[f]].data, s = new Set(); for (let i = 0; i < d.length; i += 4) if (colours.includes(`${d[i]},${d[i + 1]},${d[i + 2]}`)) s.add(i); return s; };
  const out = [];
  for (let f = from; f + 1 < animation.frames.length; f++) { const a = mask(f), b = mask(f + 1); let n = 0; for (const i of a) if (!b.has(i)) n++; for (const i of b) if (!a.has(i)) n++; out.push(n); }
  return out;
};

test('bodies go wherever a fluid does; a body has a temperature only where there is heat', () => {
  const box = { shape: 'box', size: [6, 6], at: [24, 10], fill: 'h' };
  refused(pool([{ ...box, shape: 'star' }]), 'fluid.effects.pool.bodies[0].shape', /circle, box, polygon, hoop/);
  refused(pool([{ ...box, temperature: 4 }]), 'fluid.effects.pool.bodies[0].temperature', /with heat/);
  assert.throws(() => compileBodies({ format: 'pixelforge-bodies', version: 1, name: 'hot', width: 32, height: 32, palette,
    effects: { drop: { frames: 4, duration: 50, bodies: [{ ...box, temperature: 4 }] } } }), error => error instanceof PixelError && /temperature/.test(error.path) && /with heat/.test(error.message));
  // A gas has no gravity of its own; with bodies in it, gravity is what pulls them.
  const gas = (extra = {}) => ({ format: 'pixelforge-fluid', version: 1, name: 'air', width: 32, height: 24, palette,
    effects: { air: { kind: 'gas', frames: 6, duration: 50, seed: 2, emitters: [{ at: [8, 12], rate: 1 }], look: [{ field: 'density', colors: ['g'], thresholds: [0.3], dither: 0 }], gravity: [0, 0.2], ...extra } } });
  refused(gas(), 'fluid.effects.air.gravity', /applies to liquids/);
  const fall = paths(gas({ bodies: [{ ...box, name: 'box' }] })).box;
  assert.ok(fall.length === 6 && fall.at(-1)[1] > fall[0][1] + 1, `gravity pulls the box down through the air: ${fall.at(-1)}`);
  // A fixed body in a loop turns a whole number of its own symmetric turns a cycle, or it jumps where the loop repeats.
  const loop = spin => (compileFluid(pool([{ ...box, fixed: true, spin }], { loop: true, frames: 12 })).warnings ?? []).filter(w => /loop repeats/.test(w));
  assert.equal(loop(7.5).length, 0, '90 degrees a cycle');
  assert.match(loop(1)[0], /bodies\[0\] turns 12 degrees a cycle.*multiple of 7\.5/);
});

test('water floats a body by its density, a stone sinks to the bottom, and they come to rest', () => {
  const p = paths(pool([
    { name: 'light', shape: 'box', size: [8, 8], at: [10, 16], density: 0.2, fill: 'h' },
    { name: 'heavy', shape: 'box', size: [8, 8], at: [24, 16], density: 0.8, fill: 'h' },
    { name: 'stone', shape: 'box', size: [6, 4], at: [38, 16], density: 3, fill: 'g' }]));
  const end = name => p[name].at(-1)[1];
  // The water's surface is about row 24 (a little higher once the bodies displace it).
  assert.ok(end('light') < end('heavy'), `the lighter crate floats higher (${end('light')} against ${end('heavy')})`);
  assert.ok(end('light') > 16 && end('light') < 24, `the light crate floats mostly out of the water at ${end('light')}`);
  assert.ok(end('heavy') > 22 && end('heavy') < 32, `the heavy crate floats mostly under at ${end('heavy')}`);
  assert.equal(end('stone'), 38, 'the stone rests on the bottom');
  const crate = fluidBodyPresets['crate-splash'], still = changes(crate, 'hosSkr', 100);
  assert.ok(still.every(n => n === 0), `the bodies on the settled pool hold still: ${still.join(' ')}`);
});

test('resting sand holds a dropped body up as ground, and sand that slides carries one down', () => {
  const sand = { format: 'pixelforge-fluid', version: 1, name: 'sand', width: 48, height: 36, palette,
    effects: { sand: { kind: 'liquid', frames: 70, duration: 50, seed: 4, walls: ['left', 'right', 'bottom'], granular: { repose: 33 }, fill: [{ x: 0, y: 24, w: 48, h: 12 }], emitters: [],
      look: [{ field: 'density', colors: ['s'], thresholds: [0.35], dither: 0 }],
      bodies: [{ name: 'crate', shape: 'box', size: [8, 8], at: [16, 6], density: 2, fill: 'h' }, { name: 'ball', shape: 'circle', radius: 2.5, at: [34, 4], density: 3, fill: 'k' }] } } };
  const p = paths(sand);
  // The sand's surface is row 24: the crate's bottom (its centre plus 4) and the ball's (plus 2.5) stop within two rows of it.
  assert.ok(p.crate.at(-1)[1] + 4 <= 26 && p.crate.at(-1)[1] + 4 >= 23, `the crate stands on the sand at ${p.crate.at(-1)}`);
  assert.ok(p.ball.at(-1)[1] + 2.5 <= 26 && p.ball.at(-1)[1] + 2.5 >= 23, `the ball stands on the sand at ${p.ball.at(-1)}`);
  const late = p.crate.slice(-15);
  assert.ok(late.every(q => q[0] === late[0][0] && q[1] === late[0][1]), 'and stops');
  const slide = paths(fluidBodyPresets['sand-slide']).crate;
  assert.ok(slide.at(-1)[1] - slide[0][1] >= 4 && slide.at(-1)[0] - slide[0][0] >= 0.5, `the crate rides the slumping sand down and out: ${slide[0]} to ${slide.at(-1)}`);
});

test('a turning hoop is drawn as one ring: only its gap moves', () => {
  const project = renderProject(compileBodies(bodiesPresets['spinning-hoop']).recipe), [animation] = Object.values(project.animations);
  const hoop = parseColor(bodiesPresets['spinning-hoop'].palette.h).slice(0, 3).join();
  const mask = f => { const d = project.frames[animation.frames[f]].data, s = new Set(); for (let i = 0; i < d.length; i += 4) if (`${d[i]},${d[i + 1]},${d[i + 2]}` === hoop) s.add(i); return s; };
  for (let f = 5; f < 40; f++) {
    const a = mask(f), b = mask(f + 1); let n = 0;
    for (const i of a) if (!b.has(i)) n++;
    for (const i of b) if (!a.has(i)) n++;
    assert.ok(n <= 6, `frame ${f}: ${n} hoop pixels changed`);
  }
});

test('a spinning body stirs the water it turns in, and the water keeps its volume', () => {
  const stir = spin => compileFluid({ format: 'pixelforge-fluid', version: 1, name: 'stir', width: 40, height: 32, palette,
    effects: { stir: { kind: 'liquid', frames: 30, duration: 50, seed: 3, walls: ['left', 'right', 'bottom'], flip: 0.6, drag: 0.02,
      fill: [{ x: 0, y: 8, w: 40, h: 24 }], emitters: [], look: [{ field: 'density', colors: ['b'], thresholds: [0.5], dither: 0 }],
      bodies: [{ shape: 'box', size: [2, 16], at: [20, 20], fixed: true, spin, fill: 'g' }, { shape: 'box', size: [16, 2], at: [20, 20], fixed: true, spin, fill: 'g' }] } } }).metadata.effects.stir;
  const still = stir(0), turning = stir(6);
  assert.ok(turning.peak.speed > 1 && turning.peak.speed > 10 * still.peak.speed, `the paddles drive the water: ${turning.peak.speed} against ${still.peak.speed} still`);
  assert.equal(turning.particles, still.particles, 'the turning paddles neither swallow nor make water');
});

test('what rests on a body weighs on it: sand poured on one end of a plank tips it', () => {
  const plank = paths(fluidBodyPresets['plank-tip']).plank, turn = (plank.at(-1)[2] - plank[0][2] + 540) % 360 - 180;
  assert.ok(Math.abs(turn) > 20, `the plank tips down under the sand: ${plank[0]} to ${plank.at(-1)}`);
  const late = plank.slice(-10);
  assert.ok(late.every(q => Math.abs(q[2] - late[0][2]) < 1), 'and rests');
});

test('a gas pushes and drags a body; with heat, a hot body boils the water it lands in', () => {
  const crate = paths({ format: 'pixelforge-fluid', version: 1, name: 'wind', width: 40, height: 24, palette, symbols: { ground: ['k'.repeat(40)] },
    effects: { wind: { kind: 'gas', frames: 40, duration: 50, seed: 2, gravity: [0, 0.2], walls: ['left', 'right', 'bottom'], obstacles: [{ symbol: 'ground', x: 0, y: 23 }],
      emitters: [{ at: [3, 19], radius: 2.5, rate: 2, velocity: [3, 0] }], look: [{ field: 'density', colors: ['g'], thresholds: [0.3], dither: 0 }],
      bodies: [{ name: 'crate', shape: 'box', size: [5, 5], at: [14, 20.5], density: 0.3, fill: 'h' }] } } }).crate;
  assert.ok(crate.at(-1)[0] - crate[0][0] > 5, `the wind blows the crate along: ${crate[0]} to ${crate.at(-1)}`);
  assert.ok(crate.every(q => q[1] < 21.5), 'along the ground, which holds it up');
  const steam = temperature => {
    const source = structuredClone(fluidBodyPresets['hot-stone']), effect = Object.values(source.effects)[0];
    effect.frames = 80; effect.bodies[0].temperature = temperature;
    const project = renderProject(compileFluid(source).recipe), [animation] = Object.values(project.animations);
    const vapour = ['s', 'S'].map(key => parseColor(source.palette[key]).slice(0, 3).join());
    let n = 0;
    for (const f of animation.frames.slice(-20)) { const d = project.frames[f].data; for (let i = 0; i < d.length; i += 4) if (vapour.includes(`${d[i]},${d[i + 1]},${d[i + 2]}`)) n++; }
    return n;
  };
  const hot = steam(4), cold = steam(0);
  assert.ok(hot > 100 && cold === 0, `the hot stone makes steam (${hot} pixels over the last frames), a cold one none (${cold})`);
});

test('in a loop, floating bodies come round to where they started', () => {
  const { duck, crate } = paths(fluidBodyPresets['water-wheel']);
  for (const [name, p] of Object.entries({ duck, crate })) {
    const gap = Math.hypot(p.at(-1)[0] - p[0][0], p.at(-1)[1] - p[0][1]);
    assert.ok(gap < 2.5, `the ${name} ends within a frame's drift of where it starts: ${p.at(-1)} against ${p[0]}`);
  }
});

test('the live runner steps the bodies with the fluid, a push moves them, and they are drawn', () => {
  const source = pool([{ name: 'crate', shape: 'box', size: [6, 6], at: [24, 10], density: 0.3, fill: 'h' }]);
  const live = createLiveFluid(source).step(30), [crate] = live.bodies;
  assert.equal(crate.name, 'crate');
  assert.ok(crate.y > 18 && crate.y < 26, `the crate falls in and floats at ${crate.y}`);
  assert.ok(live.render().keys.some(row => row.includes('h')), 'the crate is drawn');
  const pushed = createLiveFluid(source).step(20).push({ x: 24, y: 24, radius: 6, vx: 4, vy: 0 }).step(10).bodies[0];
  assert.ok(pushed.x > crate.x + 3, `a push drives it along: ${pushed.x} against ${crate.x}`);
  const again = createLiveFluid(source).step(20).push({ x: 24, y: 24, radius: 6, vx: 4, vy: 0 }).step(10).bodies[0];
  assert.deepEqual(again, pushed, 'the same pushes, the same run');
});
