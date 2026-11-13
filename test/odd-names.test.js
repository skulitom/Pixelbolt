import test from 'node:test';
import assert from 'node:assert/strict';
import { PixelError } from '../src/core.js';
import { compileBodies } from '../src/bodies.js';
import { readFile } from 'node:fs/promises';
import { expandPoses, compilePoses } from '../src/authoring.js';
import { heroRig } from '../scripts/figure-rigs.mjs';

// Names read as text before anything checked that they were text. The bodies here carry the names such a reading
// makes up: a missing name read as text is "undefined", ["ball"] is "ball", true is "true" and NaN is "NaN".
const source = effect => ({ format: 'pixelforge-bodies', version: 1, name: 'names', width: 64, height: 32,
  palette: { k: '#000000', w: '#ffffff' }, effects: { main: { frames: 4, duration: 50, background: 'k',
    bodies: ['undefined', 'ball', 'null', 'true', 'NaN'].map((name, i) => ({ name, shape: 'circle', radius: 2, at: [6 + i * 10, 8], fill: 'w' })), ...effect } } });

for (const [list, field, entry] of [['events', 'body', { frame: 1, power: 'vanish' }], ['strikes', 'by', { power: 'vanish' }]]) {
  const path = `bodies.effects.main.${list}[0].${field}`, refused = item => assert.throws(() => compileBodies(source({ [list]: [item] })), error => error instanceof PixelError && error.path === path);
  // Each of these found a body and gave it the power.
  for (const [label, value] of [['missing', undefined], ['a list', ['ball']], ['true', true], ['NaN', NaN]]) {
    test(`${list}: ${field} must be a body's name, not ${label}`, () => {
      const item = { ...entry };
      if (value !== undefined) item[field] = value;
      refused(item);
    });
  }
  test(`${list}: what was refused stays refused, and names are found as before`, () => {
    for (const value of [1, null, {}, [], '', 'nobody', ' ball']) refused({ ...entry, [field]: value });
    // A missing name says that a name is wanted; a name under the wrong key is still called an unknown field.
    assert.throws(() => compileBodies(source({ [list]: [entry] })), error => error.path === path && /name/.test(error.message));
    assert.throws(() => compileBodies(source({ [list]: [{ ...entry, bdy: 'ball' }] })), error => error instanceof PixelError && error.path === `bodies.effects.main.${list}[0].bdy`);
    // Any letter case finds the body, and the result is the same.
    assert.deepEqual(compileBodies(source({ [list]: [{ ...entry, [field]: 'BALL' }] })), compileBodies(source({ [list]: [{ ...entry, [field]: 'ball' }] })));
  });
}

// A root instance has no parent, and its parent's rotation was looked up under the key "undefined" (a root tail's under
// "null"): an instance with that name turned every generated pose. Whatever an instance is called, the poses are the
// same: on the hero as shipped, with an arm made a root (the attack's shoulder) and with the cape made a root tail.
const rename = (value, from, to) => JSON.parse(JSON.stringify(value).replaceAll(`"${from}"`, `"${to}"`));
for (const variant of ['hero', 'root arm', 'root tail']) {
  test(`generated poses are the same whatever an instance is called: ${variant}`, () => {
    const hero = heroRig();
    if (variant !== 'hero') {
      const part = hero.poses[0].parts.find(p => p.name === (variant === 'root arm' ? 'nearArm' : 'cape'));
      // Keep the same rest placement while making the arm or tail a root instance.
      part.at = hero.parts.body.points[part.attach.point];
      delete part.attach;
    }
    const expected = rename(expandPoses(rename(hero, 'cape', 'capeX')), 'capeX', 'cape');
    assert.ok(expected.poses.some(p => p.name === 'walk-contact-a'));
    assert.ok(expected.poses.some(p => p.name === 'attack-strike'));
    for (const name of ['undefined', 'null']) assert.deepEqual(rename(expandPoses(rename(hero, 'cape', name)), name, 'cape'), expected, `${variant}: ${name}`);
  });
}

test('a figure is refused in words whatever its parts and instances are called, and whatever its canvas', async () => {
  const refused = (source, where, pattern) => assert.throws(() => compilePoses(source), error => error instanceof PixelError && error.path === where && pattern.test(error.message), where);
  // A body instance named as something every object has: the lookup found Object's own, and reading it threw a TypeError.
  const slime = JSON.parse(await readFile(new URL('../examples/slime-idle.poses.json', import.meta.url), 'utf8'));
  for (const name of ['body', 'constructor', 'toString']) {
    const source = structuredClone(slime);
    source.rig.body = name;
    for (const pose of source.poses) for (const part of pose.parts ?? []) { if (part.name === 'body') part.name = name; if (part.attach?.part === 'body') part.attach.part = name; }
    source.poses.push({ name: 'idle-2', duration: 140, origin: [16, 28], parts: [{ name: 'eyes', part: 'eyes', at: [0, -6] }] });
    refused(source, 'poses.poses[1]', new RegExp(`needs the body instance "${name}"`));
  }
  // A root instance has no bone to reach from, even when a part is named "undefined" and has a point of that name.
  const bone = { bone: { length: 5, width: [3, 3], ramp: 0, base: 2 }, points: { end: 'end' } };
  for (const first of ['thigh', 'undefined']) refused({ format: 'pixelforge-poses', version: 1, name: 'leg', width: 32, height: 32, palette: { a: '#333333', b: '#777777', c: '#bbbbbb' }, ramps: [['a', 'b', 'c']],
    parts: { [first]: { ...bone, points: { [first === 'undefined' ? 'undefined' : 'end']: 'end' } }, shin: bone }, poses: [{ name: 'stand', origin: [16, 28], parts: [{ name: 'leg', part: 'shin', reach: [20, 24] }] }] }, 'poses.poses[0].parts[0].reach', /reach needs a bone attached/);
  // The canvas is checked before the inner-line pass sizes its arrays by it (a RangeError, with outlined bones).
  const hero = heroRig();
  refused({ ...hero, width: undefined }, 'project.width', /missing; expected an integer from 1 to 256/);
  refused({ ...hero, width: -1 }, 'project.width', /expected an integer from 1 to 256/);
  refused({ ...hero, height: 100000 }, 'project.height', /expected an integer from 1 to 256/);
});
