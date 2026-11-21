// A source on the sandbox base that names one of the starter table's materials replaces it whole. When the
// replacement breaks one of the table's own reactions, the error names the source's material and the table's
// reaction, not powder.reactions[n], an index into a merged list the source never wrote (P-182).
import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePowder, createLivePowder } from '../src/powder.js';

const hopper = { format: 'pixelforge-powder', version: 1, name: 'hopper', base: 'sandbox', width: 16, height: 16 };
const solidWood = { state: 'solid', colors: ['#885522'] };
const replaced = (name, partner, field, said) => error => error.path === `powder.materials.${name}`
  && error.message === `powder.materials.${name}: this replaces the starter table's ${name} whole, and the table's reaction of ${partner} (its ${field}) then fails: ${said}. Rename your material, give it what that reaction needs, or write your own reaction for ${partner}, which replaces the table's`;

test("a material that breaks one of the starter table's reactions is named, with that reaction, however many reactions the source wrote", () => {
  const wood = replaced('wood', 'fire and wood', 'ignite', 'wood does not burn; give it a burn');
  // No reactions of its own: the table's fire and wood used to be reported as powder.reactions[1].
  assert.throws(() => compilePowder({ ...hopper, materials: { wood: solidWood } }), wood);
  // Reactions of its own (one replacing a table pair, one new) come first and keep their indexes; the table's error is still the material's.
  const own = [{ a: 'water', b: 'lava', into: ['steam', 'stone'] }, { a: 'sand', b: 'water', chance: 0.1 }];
  assert.throws(() => compilePowder({ ...hopper, materials: { wood: solidWood }, reactions: own }), wood);
  // The live grid reads sources the same way.
  assert.throws(() => createLivePowder({ ...hopper, materials: { wood: solidWood } }), wood);
  // Oil burns in the table too: the first of the table's reactions it breaks is the one named.
  assert.throws(() => compilePowder({ ...hopper, materials: { oil: { state: 'liquid', colors: ['#332211'] } } }), replaced('oil', 'fire and oil', 'ignite', 'oil does not burn; give it a burn'));
});

test("the source's own reactions keep their own paths, and the ways out compile", () => {
  // An error in a reaction the source wrote is still named by its own index.
  assert.throws(() => compilePowder({ ...hopper, materials: { wood: solidWood }, reactions: [{ a: 'fire', b: 'stone', ignite: 'b' }] }),
    error => error.path === 'powder.reactions[0].ignite' && /stone does not burn; give it a burn/.test(error.message));
  // A source with no base keeps every path as it was.
  assert.throws(() => compilePowder({ format: 'pixelforge-powder', version: 1, name: 'plain', width: 16, height: 16, materials: { wood: solidWood, fire: { state: 'gas', colors: ['#ff8800'] } }, reactions: [{ a: 'fire', b: 'wood', ignite: 'b' }] }),
    error => error.path === 'powder.reactions[0].ignite');
  // Renamed, given a burn, or with its own reaction for the pair: each compiles.
  assert.doesNotThrow(() => compilePowder({ ...hopper, materials: { hopper: solidWood } }));
  assert.doesNotThrow(() => compilePowder({ ...hopper, materials: { wood: { ...solidWood, burn: { temperature: 280, frames: [140, 260], into: 'ash' } } } }));
  // Its own reaction for fire and wood replaces the table's; the table's water and wood (which puts burning wood out) is then the one named, until it too is the source's.
  const fireWood = { a: 'fire', b: 'wood', into: [null, 'ash'], chance: 0.04 };
  assert.throws(() => compilePowder({ ...hopper, materials: { wood: solidWood }, reactions: [fireWood] }), replaced('wood', 'water and wood', 'douse', 'wood does not burn; give it a burn'));
  assert.doesNotThrow(() => compilePowder({ ...hopper, materials: { wood: solidWood }, reactions: [fireWood, { a: 'water', b: 'wood', heat: 10, chance: 0.3 }] }));
});
