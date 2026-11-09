import test from 'node:test';
import assert from 'node:assert/strict';
import { PixelError } from '../src/core.js';
import { compileBodies } from '../src/bodies.js';
import { expandPoses } from '../src/authoring.js';
import { heroRig } from '../scripts/figure-rigs.mjs';

const source = effect => ({ format: 'pixelforge-bodies', version: 1, name: 'names', width: 32, height: 32,
  palette: { k: '#000000', w: '#ffffff' }, effects: { main: { frames: 4, duration: 50, background: 'k',
    bodies: ['undefined', 'ball', 'null'].map((name, i) => ({ name, shape: 'circle', radius: 2, at: [6 + i * 10, 8], fill: 'w' })), ...effect } } });

for (const [list, field, entry] of [['events', 'body', { frame: 1, power: 'vanish' }], ['strikes', 'by', { power: 'vanish' }]]) {
  // Each of these found a body before: read as text, a missing name is "undefined", ["ball"] is "ball", null is "null".
  for (const [label, value] of [['missing', undefined], ['list', ['ball']], ['number', 1], ['null', null], ['object', {}], ['true', true]]) {
    test(`${list} require a body's name: ${label}`, () => {
      const item = { ...entry };
      if (value !== undefined) item[field] = value;
      assert.throws(() => compileBodies(source({ [list]: [item] })), error =>
        error instanceof PixelError && error.path === `bodies.effects.main.${list}[0].${field}` && /expected a body's name/.test(error.message));
    });
  }
  test(`${list} keep case-insensitive and unknown-name behaviour`, () => {
    assert.deepEqual(compileBodies(source({ [list]: [{ ...entry, [field]: 'BALL' }] })),
      compileBodies(source({ [list]: [{ ...entry, [field]: 'ball' }] })));
    for (const unknown of ['nobody', '']) assert.throws(() => compileBodies(source({ [list]: [{ ...entry, [field]: unknown }] })), error =>
      error instanceof PixelError && error.path === `bodies.effects.main.${list}[0].${field}` && error.message.includes(`no body is named ${JSON.stringify(unknown)}`));
  });
}

const rename = (value, from, to) => JSON.parse(JSON.stringify(value).replaceAll(`"${from}"`, `"${to}"`));
for (const variant of ['hero', 'root arm', 'root tail']) for (const name of ['undefined', 'null']) {
  test(`generated poses ignore instance name ${name}: ${variant}`, () => {
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
    assert.deepEqual(rename(expandPoses(rename(hero, 'cape', name)), name, 'cape'), expected, `${variant}: ${name}`);
  });
}
