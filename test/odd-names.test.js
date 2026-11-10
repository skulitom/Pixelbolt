import test from 'node:test';
import assert from 'node:assert/strict';
import { PixelError } from '../src/core.js';
import { compileBodies } from '../src/bodies.js';
import { expandPoses } from '../src/authoring.js';
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
