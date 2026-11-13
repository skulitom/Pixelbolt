import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { compileBodies, bodiesFrames } from '../src/bodies.js';
import { PixelError, renderProject } from '../src/core.js';
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

// Pixels that differ between two frames of a rendered recipe.
const differing = (project, a, b) => { let count = 0; const one = project.frames[a].data, other = project.frames[b].data; for (let i = 0; i < one.length; i += 4) if (one[i] !== other[i] || one[i + 1] !== other[i + 1] || one[i + 2] !== other[i + 2] || one[i + 3] !== other[i + 3]) count++; return count; };

test('a looping cloth is drawn once it has settled into its wind, so the last frame leads into the first', async () => {
  const cloth = { name: 'flag', at: [12, 8], size: [19, 14], cell: 1, fill: ['d', 'f', 'g'], outline: 'k', wind: [1.4, 0], gust: 0.9, slack: 0.2, stiffness: 0.5, shear: 0.5, bend: 0.2, pins: [{ at: [0, 0], x: 11, y: 8 }, { at: [0, 13], x: 11, y: 21 }] };
  const make = (effect = {}, extra = {}) => source({ frames: 24, gravity: [0, 0.08], loop: true, cloths: [{ ...cloth, ...extra }], ...effect });
  const looped = run(make()), once = run(make({ loop: false }));
  assert.deepEqual([looped.recipe.animations.e.loop, once.recipe.animations.e.loop, once.effect.loop], [true, false, undefined]);
  // Whole cycles of the wind, until one ends where it began.
  assert.ok(looped.effect.loop.warmed >= 48 && looped.effect.loop.warmed % 24 === 0 && looped.effect.loop.seam <= 1 / 16, JSON.stringify(looped.effect.loop));
  assert.equal(looped.warnings, undefined);
  // The join is a step like any other: from the last frame to the first no more changes than between two neighbours,
  // where a cloth played once ends far from the rectangle it started as.
  const drawn = renderProject(looped.recipe), played = renderProject(once.recipe);
  const steps = Array.from({ length: 23 }, (_, i) => differing(drawn, i, i + 1));
  assert.ok(Math.max(...steps) > 0 && differing(drawn, 23, 0) <= Math.max(...steps), `join ${differing(drawn, 23, 0)}, steps ${steps}`);
  assert.ok(differing(played, 23, 0) > 4 * Math.max(...steps), `a one-shot's ends differ by ${differing(played, 23, 0)}`);
  // Numbered video frames start from the same settled cloth.
  assert.deepEqual([...bodiesFrames(make()).image(0)], [...drawn.frames[0].data]);
  // A cloth that never settles is said, with what to change: this one is blown against the canvas's right edge.
  const restless = run(source({ frames: 24, duration: 80, gravity: [0, 0.12], loop: true, bodies: [{ name: 'pole', shape: 'box', size: [40, 2], at: [24, 8], fixed: true, fill: 'g', outline: 'k' }],
    cloths: [{ ...cloth, at: [14, 10], size: [20, 30], wind: [0.5, 0], gust: 1, slack: 0.1, shear: 0.25, bend: 0.02, tear: 4, pins: [{ at: [0, 0], x: 14, y: 10 }, { at: [19, 0], x: 33, y: 10 }] }] }, { width: 48, height: 48 }));
  assert.match(restless.warnings[0], /^bodies\.effects\.e\.loop: after 192 frames of its wind the cloth still ends a cycle [\d.]+ px from where it began, so the last frame does not lead into the first; raise the cloth's damping or lower its gust$/);
  // What plays once is refused by name.
  const loop = 'bodies.effects.e.loop';
  refused(make({ bodies: [{ name: 'ball', shape: 'circle', radius: 2, at: [40, 4], fill: 'r' }] }), loop, /this effect has a body that is not fixed, which plays once\. Leave loop out$/);
  refused(make({ bodies: [{ name: 'cart', shape: 'box', size: [6, 4], at: [40, 40], fixed: true, velocity: [0.2, 0], fill: 'r' }] }), loop, /a fixed body that moves/);
  refused(make({}, { pins: [{ at: [0, 0], keys: [[0, 11, 8], [12, 14, 8]] }] }), loop, /a pin moved by keys/);
  refused(source({ frames: 24, loop: true, bodies: [{ name: 'post', shape: 'box', size: [2, 20], at: [10, 20], fixed: true, fill: 'k' }] }), loop, /no cloth/);
  refused(make({ frames: 3 }), loop, /fewer than 4 frames/);
  refused(make({ loop: 'yes' }), loop, /expected true or false/);
  // The shipped flag and banner are such loops.
  for (const name of ['flag', 'banner']) {
    const made = run(JSON.parse(await readFile(new URL(`../examples/${name}.bodies.json`, import.meta.url), 'utf8')));
    assert.ok(made.recipe.animations[name].loop && made.effect.loop.seam <= 1 / 16 && made.warnings === undefined, `${name}: ${JSON.stringify(made.effect.loop)} ${made.warnings}`);
  }
});

test('a ripple is drawn down a cloth from its held end, and turns a whole number of times in a loop', () => {
  // A cloth hung by its whole top edge in still air comes to rest, so only the ripple moves it.
  const hung = ripple => run(source({ frames: 24, gravity: [0, 0.1], loop: true, cloths: [{ name: 'drape', at: [20, 8], size: [15, 20], cell: 1, fill: 'r', slack: 0, stiffness: 1,
    pins: Array.from({ length: 15 }, (_, u) => ({ at: [u, 0], x: 20 + u, y: 8 })), ...ripple }] }));
  const still = renderProject(hung({}).recipe), swayed = renderProject(hung({ ripple: 3, waves: 1 }).recipe);
  for (let f = 1; f < 24; f++) assert.equal(differing(still, 0, f), 0, `frame ${f} of the still cloth`);
  assert.ok(differing(swayed, 0, 6) > 20 && differing(swayed, 0, 12) > 20, `${differing(swayed, 0, 6)} ${differing(swayed, 0, 12)}`);
  // The held edge stays where it is pinned, and the free end sways about three pixels to each side over the cycle.
  const reach = (project, row) => { let min = Infinity, max = -Infinity; for (const frame of project.frames) for (let x = 0; x < project.width; x++) if (frame.data[(row * project.width + x) * 4 + 3]) { min = Math.min(min, x); max = Math.max(max, x); } return [min, max]; };
  assert.deepEqual(reach(swayed, 8), reach(still, 8));
  const [left, right] = reach(swayed, 26), [stillLeft, stillRight] = reach(still, 26);
  assert.ok(stillLeft - left >= 2 && stillLeft - left <= 4 && right - stillRight >= 2 && right - stillRight <= 4, `${left}-${right} against ${stillLeft}-${stillRight}`);
  refused(source({ cloths: [{ at: [8, 8], size: [4, 4], fill: 'r', ripple: 9 }] }), 'bodies.effects.e.cloths[0].ripple', /expected a number from 0 to 8/);
  refused(source({ cloths: [{ at: [8, 8], size: [4, 4], fill: 'r', waves: 0 }] }), 'bodies.effects.e.cloths[0].waves', /expected a number from 0\.25 to 4/);
});

test('a cloth carries a design drawn by its mask, a ramp to each character; a chain with two keys is drawn in both', async () => {
  // Left half dark red, right half cream, with a hole: each cell takes the character at its top-left particle.
  const mask = Array.from({ length: 10 }, (_, v) => Array.from({ length: 12 }, (_, u) => (u === 3 && v === 4 ? '.' : u < 6 ? 'a' : 'b')).join(''));
  const designed = extra => source({ frames: 2, gravity: [0, 0], cloths: [{ at: [10, 10], size: [12, 10], cell: 2, mask, fill: { a: 'd', b: ['w', 'g'] }, pins: [{ at: [0, 0] }], ...extra }] });
  const drawn = renderProject(run(designed({})).recipe).frames[0], at = (x, y) => [...drawn.data.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 3)].map(v => v.toString(16).padStart(2, '0')).join('');
  assert.deepEqual([`#${at(12, 12)}`, `#${at(20, 20)}`], [palette.d, palette.d]);
  for (const [x, y] of [[24, 20], [30, 12]]) assert.ok([palette.w, palette.g].includes(`#${at(x, y)}`), `${x},${y} is ${at(x, y)}`);
  assert.equal(drawn.data[(19 * 64 + 17) * 4 + 3], 0, 'the hole stays a hole');
  const cloth = 'bodies.effects.e.cloths[0]';
  refused(designed({ mask: mask.map(row => row.replace('a', '#')) }), `${cloth}.mask[0]`, /expected a, b for cloth or \. for a hole/);
  refused(designed({ mask: undefined }), `${cloth}.mask`, /a fill of ramps by character needs a mask whose rows draw the cloth with them: a, b, and \. for a hole/);
  refused(designed({ fill: { ab: 'd' } }), `${cloth}.fill`, /1–16 such ramps each under the single character the mask draws it with/);
  refused(designed({ fill: { a: 'd', b: 'z' } }), `${cloth}.fill.b`, /expected a single-character key in the palette/);
  // The lantern preset hangs on such a chain: both its keys are in the frames, between the beam and the lantern.
  const lantern = run(JSON.parse(await readFile(new URL('../examples/lantern.bodies.json', import.meta.url), 'utf8')));
  const rows = grid(lantern.recipe.frames[0]).rows.slice(8, 28).join('');
  assert.ok(rows.includes('c') && rows.includes('k'), 'the chain draws its fill and its outline');
  // It swings out to the right, back past the middle, and ends near where it hung.
  const xs = lantern.effect.paths.lantern.map(([x]) => x);
  assert.ok(Math.max(...xs) > 34 && Math.min(...xs) < 20 && Math.abs(xs.at(-1) - 24) < 6, `${Math.min(...xs)} to ${Math.max(...xs)}, ends at ${xs.at(-1)}`);
});
