import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { compileBodies } from '../src/bodies.js';
import { PixelError } from '../src/core.js';
import { cosDeg, sinDeg } from '../src/craft.js';

const palette = { k: '#111111', w: '#eeeeee', r: '#dd3344', d: '#553333', f: '#aa6644', g: '#eeaa77', s: '#4a5068' };
const source = (effect, extra = {}) => ({ format: 'pixelforge-bodies', version: 1, name: 'joints', width: 64, height: 64, palette, ...extra, effects: { e: { frames: 120, duration: 40, ...effect } } });
const run = source => { const { recipe, metadata, warnings } = compileBodies(source); return { recipe, effect: Object.values(metadata.effects)[0], warnings }; };
const refused = (source, where, pattern) => assert.throws(() => compileBodies(source), error => error instanceof PixelError && error.path === where && pattern.test(error.message), where);
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const point = (path, index, local) => {
  const [x, y, angle] = path[index];
  return [x + cosDeg(angle) * local[0] - sinDeg(angle) * local[1], y + sinDeg(angle) * local[0] + cosDeg(angle) * local[1]];
};
const grid = frame => frame.ops.find(op => op.op === 'grid');

test('a distance joint holds a pendulum at its length and a hinge keeps its two anchors together', () => {
  const pendulum = run(source({ gravity: [0, 0.15], bodies: [
    { name: 'anchor', shape: 'circle', radius: 0.5, at: [32, 8], fixed: true, fill: 'k' },
    { name: 'ball', shape: 'circle', radius: 2, at: [46, 16], fill: 'r' }
  ], joints: [{ name: 'string', type: 'distance', a: 'anchor', b: 'ball', length: 16 }] })).effect;
  assert.equal(pendulum.joints, 1);
  for (const [x, y] of pendulum.paths.ball) if (x !== null) assert.ok(Math.abs(Math.sqrt((x - 32) ** 2 + (y - 8) ** 2) - 16) < 0.6, `the ball strayed to ${Math.sqrt((x - 32) ** 2 + (y - 8) ** 2)}`);
  // A hinge between a torso and an arm: both local anchors are the same world point at every frame.
  const ragdoll = run(source({ gravity: [0, 0.18], walls: ['bottom'], bodies: [
    { name: 'torso', shape: 'box', size: [10, 14], at: [32, 20], fill: 'w', outline: 'k' },
    { name: 'arm', shape: 'box', size: [4, 12], at: [25, 22], fill: 'r', outline: 'k' }
  ], joints: [{ type: 'hinge', a: 'torso', b: 'arm', anchorA: [-5, -4], anchorB: [2, -6] }] })).effect;
  for (let i = 0; i < ragdoll.paths.torso.length; i++) {
    const a = point(ragdoll.paths.torso, i, [-5, -4]), b = point(ragdoll.paths.arm, i, [2, -6]);
    assert.ok(Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) < 1.5, `frame ${i}: the hinge opened to ${Math.hypot(a[0] - b[0], a[1] - b[1])}`);
  }
});

test('a joint breaks above its impulse and the metadata names it', () => {
  const broken = run(source({ gravity: [0, 0.3], walls: ['bottom'], bodies: [
    { name: 'anchor', shape: 'circle', radius: 0.5, at: [32, 4], fixed: true, fill: 'k' },
    { name: 'ball', shape: 'circle', radius: 4, at: [32, 20], density: 8, fill: 'r' }
  ], joints: [{ name: 'rope', type: 'distance', a: 'anchor', b: 'ball', length: 16, break: 1 }] })).effect;
  assert.equal(broken.brokenJoints.length, 1);
  assert.equal(broken.brokenJoints[0].joint, 'rope');
  assert.equal(broken.brokenJoints[0].frame, 1);
  assert.ok(broken.brokenJoints[0].impulse > 1);
  assert.ok(broken.paths.ball.at(-1)[1] > 40, `the ball falls once the joint is gone: ${broken.paths.ball.at(-1)}`);
});

test('a rope sags between its anchors and is drawn with palette keys only', async () => {
  const example = JSON.parse(await readFile(new URL('../examples/rope-bridge.bodies.json', import.meta.url), 'utf8'));
  const { recipe, effect, warnings } = run(example);
  assert.equal(effect.ropes, 2);
  // Six between the seven planks, and each rope's five links with a joint more than links.
  assert.equal(effect.joints, 18);
  assert.equal(warnings, undefined);
  const keys = new Set(Object.keys(example.palette));
  assert.ok(effect.paths['plank-3'].at(-1)[1] > effect.paths['plank-3'][0][1] + 2, `the bridge sags: ${effect.paths['plank-3'][0]} to ${effect.paths['plank-3'].at(-1)}`);
  for (const frame of recipe.frames) for (const op of frame.ops ?? []) {
    if (op.op !== 'grid') continue;
    for (const row of op.rows) for (const ch of row) assert.ok(ch === '.' || keys.has(ch), `${frame.name} draws ${ch}`);
  }
});

test('cloth hangs from its pins, moves with wind, tears when stretched, and is deterministic', () => {
  const make = (extra = {}) => source({ gravity: [0, 0.08], cloths: [{
    name: 'flag', at: [12, 8], size: [19, 14], cell: 1, fill: ['d', 'f', 'g'], outline: 'k', light: [0, -1],
    wind: [1.4, 0], gust: 0.9, slack: 0.2, stiffness: 0.5, shear: 0.5, bend: 0.2, tear: 4,
    pins: [{ at: [0, 0], x: 11, y: 8 }, { at: [0, 13], x: 11, y: 21 }], ...extra
  }] });
  const first = run(make()), second = run(make());
  assert.equal(first.effect.cloths, 1);
  assert.notDeepEqual(grid(first.recipe.frames[0]), grid(first.recipe.frames[30]), 'the flag moves');
  assert.equal(sha(first.recipe), sha(second.recipe), 'the same cloth compiles to the same pixels');
  const keys = new Set(Object.keys(palette));
  for (const frame of first.recipe.frames) {
    const op = grid(frame);
    for (const row of op.rows) for (const ch of row) assert.ok(ch === '.' || keys.has(ch), `draws ${ch}`);
  }
  const torn = run(make({ wind: [4, 0], gust: 1, slack: 0.5, stiffness: 0.2, tear: 1.01 }));
  assert.ok(torn.effect.clothTears > 0, `the cloth tore ${torn.effect.clothTears ?? 0} times`);
});

test('cloth can pin to a moving body, and a cloth-only effect needs no bodies', async () => {
  const example = JSON.parse(await readFile(new URL('../examples/cape.bodies.json', import.meta.url), 'utf8'));
  const { recipe, effect } = run(example);
  assert.equal(effect.bodies, 1);
  assert.equal(effect.cloths, 1);
  assert.equal(recipe.frames.length, 120);
  // The hero is a fixed body moving right; the cape's crop follows it.
  assert.ok(grid(recipe.frames.at(-1)).x > grid(recipe.frames[0]).x, 'the pinned cloth follows the body');
});

test('a masked cloth keeps its holes and hangs from a pinned edge', () => {
  const masked = run(source({ gravity: [0, 0.1], cloths: [{
    at: [8, 8], size: [6, 6], mask: ['######', '######', '##..##', '##..##', '######', '######'],
    fill: ['d', 'f', 'g'], outline: 'k', pins: [{ at: [0, 0], x: 8, y: 8 }]
  }] }));
  assert.equal(masked.recipe.frames.length, 120);
  assert.ok(grid(masked.recipe.frames[0]).rows.some(row => row.includes('.')));
});

test('joints, ropes and cloths are read strictly', () => {
  const base = extra => source({ bodies: [{ name: 'a', shape: 'circle', radius: 2, at: [10, 10], fill: 'k' }], ...extra });
  refused(base({ joints: [{ type: 'elastic', a: 'a', b: 'world' }] }), 'bodies.effects.e.joints[0].type', /distance, rope, spring, hinge, weld/);
  refused(base({ joints: [{ type: 'distance', a: 'nope', b: 'world' }] }), 'bodies.effects.e.joints[0].a', /unknown body/);
  refused(base({ joints: [{ type: 'distance', a: 'world', b: 'world' }] }), 'bodies.effects.e.joints[0].b', /at least one body/);
  refused(base({ ropes: [{ from: { at: [0, 0] }, to: { at: [10, 10] }, fill: 'z' }] }), 'bodies.effects.e.ropes[0].fill', /palette/);
  refused(base({ cloths: [{ at: [0, 0], size: [4, 4], fill: 'k', mask: ['###'] }] }), 'bodies.effects.e.cloths[0].mask', /4 rows of 4 characters/);
  refused(base({ cloths: [{ at: [0, 0], size: [4, 4], fill: 'k', pins: [{ at: [9, 9] }] }] }), 'bodies.effects.e.cloths[0].pins[0].at[0]', /from 0 to 3/);
  refused(base({ cloths: [{ at: [0, 0], size: [4, 4], fill: 'k', mask: ['####', '#..#', '#..#', '####'], pins: [{ at: [1, 1] }] }] }), 'bodies.effects.e.cloths[0].pins[0].at', /hole in the mask/);
});

test('a heavy ball on a rope swings as it does on a rigid joint, where a rope of feather-light links lets it fall', () => {
  const swing = held => ({ format: 'pixelforge-bodies', version: 1, name: 'pendulum', width: 96, height: 64, palette: { k: '#14141c', m: '#b4bdd8', r: '#d7b56d' },
    effects: { swing: { frames: 61, gravity: [0, 0.16], walls: ['left', 'right', 'bottom'],
      bodies: [{ name: 'pivot', shape: 'circle', radius: 2, at: [50, 6], fixed: true, fill: 'k' }, { name: 'ball', shape: 'circle', radius: 6, at: [86, 14], density: 9, fill: 'm' }], ...held } } });
  const far = source => { const path = compileBodies(source).metadata.effects.swing.paths.ball; return { left: Math.min(...path.map(at => at[0])), low: Math.max(...path.map(at => at[1])) }; };
  const rope = { from: { body: 'pivot', point: [3, 1] }, to: { body: 'ball', point: [-7, -2] }, links: 14, slack: 0, fill: 'r' };
  const rigid = far(swing({ joints: [{ type: 'distance', a: 'pivot', b: 'ball' }] })), roped = far(swing({ ropes: [rope] })), light = far(swing({ ropes: [{ ...rope, density: 0.6 }] }));
  // Both swing through to the far side and stay off the floor (the ball's centre rests at 58 on it).
  assert.ok(rigid.left < 25 && rigid.low < 50, JSON.stringify(rigid));
  assert.ok(roped.left < 25 && roped.low < 52, JSON.stringify(roped));
  // A density the source gives is kept, and at 0.6 the rope stretches until the ball is on the floor.
  assert.ok(light.low >= 57, JSON.stringify(light));
});

test('what a joint, a rope or a pin cannot use is refused by name, and a pin with several keys compiles', () => {
  const box = (name, x) => ({ name, shape: 'box', size: [4, 4], at: [x, 10], fill: 'k' });
  const source = effect => ({ format: 'pixelforge-bodies', version: 1, name: 'checks', width: 48, height: 32, palette: { k: '#14141c', r: '#d7b56d' }, effects: { e: { frames: 8, bodies: [box('a', 10), box('b', 30)], ...effect } } });
  const refused = (effect, path, message) => assert.throws(() => compileBodies(source(effect)), error => error.path === path && message.test(error.message), `${path}`);
  refused({ joints: [{ type: 'weld', a: 'a', b: 'b', limit: [30, 60] }] }, 'bodies.effects.e.joints[0].limit', /a weld holds the angle its bodies start at; an angle limit goes with a hinge/);
  refused({ joints: [{ type: 'rope', a: 'a', b: 'b', stiffness: 0.5 }] }, 'bodies.effects.e.joints[0].stiffness', /a rope pulls only when it is taut/);
  refused({ joints: [{ type: 'hinge', a: 'a', b: 'a' }] }, 'bodies.effects.e.joints[0].b', /both ends are the same body/);
  refused({ joints: [{ type: 'hinge', a: 'a', b: 'body1' }] }, 'bodies.effects.e.joints[0].b', /unknown body "body1"; a joint names a body by its name \(this effect names a, b\)/);
  refused({ ropes: [{ from: { body: 'a' }, to: { body: 'a', point: [2, 0] }, fill: 'r' }] }, 'bodies.effects.e.ropes[0].to', /both ends are the same body/);
  const cloth = pins => ({ cloths: [{ at: [10, 4], size: [4, 4], fill: 'r', pins }] });
  refused(cloth([{ at: [0, 0], to: 'a', x: 3 }]), 'bodies.effects.e.cloths[0].pins[0].x', /to already places this one/);
  refused(cloth([{ at: [0, 0] }, { at: [0, 0], x: 12, y: 5 }]), 'bodies.effects.e.cloths[0].pins[1].at', /particle \[0, 0\] already has a pin/);
  refused(cloth([{ at: [0, 0], keys: [[0, 10, 4], [0, 12, 4]] }]), 'bodies.effects.e.cloths[0].pins[0].keys[1][0]', /frames increase strictly/);
  // Two keys crashed the compiler before any of that was checked.
  assert.equal(compileBodies(source(cloth([{ at: [0, 0], keys: [[0, 10, 4], [6, 14, 4]] }, { at: [3, 0] }]))).recipe.frames.length, 8);
});

test('a rope hangs at its length however many links it is made of', () => {
  const hang = links => {
    const made = compileBodies({ format: 'pixelforge-bodies', version: 1, name: 'hang', width: 64, height: 128, palette: { k: '#14141c', r: '#d7b56d' },
      effects: { e: { frames: 160, gravity: [0, 0.3], bodies: [{ name: 'a', shape: 'box', size: [6, 6], at: [32, 10], fixed: true, fill: 'k' }, { name: 'b', shape: 'box', size: [10, 10], at: [32, 60], density: 8, drag: 0.3, fill: 'k' }],
        ropes: [{ from: { body: 'a' }, to: { body: 'b' }, links, slack: 0, fill: 'r' }] } } });
    return made.metadata.effects.e.paths.b.at(-1)[1] - 10;
  };
  // 50 pixels from anchor to load. With one solver pass a joint, 64 links hung at 73.7.
  for (const links of [12, 40, 64]) { const length = hang(links); assert.ok(length > 49 && length < 53.5, `${links} links hang ${length.toFixed(1)} long`); }
});
