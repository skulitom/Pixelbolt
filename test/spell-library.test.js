import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject } from '../src/core.js';
import { compileEffects } from '../src/fx.js';
import { spellLibrary } from '../scripts/spell-library.mjs';
import { goldens } from '../scripts/goldens.mjs';

// The spell library: seven elements, each a projectile (looping, in eight directions), an impact, an area effect and a
// looping buff on one 64 × 64 canvas anchored at the point a game places them.
const root = fileURLToPath(new URL('../', import.meta.url));
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const golden = goldens(new URL('./goldens/spell-library.json', import.meta.url));
const ELEMENTS = ['fire', 'ice', 'lightning', 'water', 'poison', 'holy', 'shadow'];
const differ = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) n++; return n; };
const drawn = data => { let n = 0; for (let i = 3; i < data.length; i += 4) if (data[i]) n++; return n; };

test('the spell library has every element, each with the same four effects on the same canvas', async () => {
  assert.deepEqual(Object.keys(spellLibrary), ELEMENTS);
  for (const element of ELEMENTS) {
    const preset = spellLibrary[element], example = JSON.parse(await readFile(path.join(root, `examples/${element}-spells.fx.json`), 'utf8'));
    assert.deepEqual(example, preset, `examples/${element}-spells.fx.json is stale; run node scripts/generate-examples.js`);
    assert.deepEqual([preset.name, preset.width, preset.height, preset.anchor], [`${element}-spells`, 64, 64, [32, 40]], element);
    assert.deepEqual(Object.keys(preset.effects), ['projectile', 'impact', 'area', 'buff'], element);
    assert.deepEqual(preset.effects.projectile.turn, { angles: [0, 45, 90, 135, 180, 225, 270, 315], about: [32, 40] }, element);
    assert.ok(Object.keys(preset.palette).length <= 12, `${element} palette`);
  }
});

test('every library effect loops seamlessly or ends empty, and has a hit cue where it lands', () => {
  for (const element of ELEMENTS) {
    const { recipe, metadata } = compileEffects(spellLibrary[element]), project = renderProject(recipe);
    assert.deepEqual(project.warnings, [], element);
    const byName = new Map(project.frames.map((frame, i) => [recipe.frames[i].name, frame.data]));
    for (const [name, animation] of Object.entries(recipe.animations)) {
      const frames = animation.frames.map(frame => byName.get(frame));
      if (animation.loop === false) assert.ok(drawn(frames[frames.length - 1]) <= 8, `${element} ${name} ends with ${drawn(frames[frames.length - 1])} pixels`);
      // A whole effect's frame 0 is exactly the frame that follows its last (its parts are reviewed with it), so its seam
      // is an ordinary step, which can be its largest by chance.
      else if (metadata.effects[name].seam.jump !== undefined) assert.equal(metadata.effects[name].seam.jump, 0, `${element} ${name} jumps at its loop point`);
      else {
        const inside = frames.slice(1).map((frame, k) => differ(frames[k], frame)), seam = differ(frames[frames.length - 1], frames[0]);
        assert.ok(seam <= Math.max(...inside), `${element} ${name}: seam ${seam}, inside ${inside}`);
      }
    }
    for (const effect of ['impact', 'area']) assert.ok((metadata.effects[effect].cues ?? []).some(cue => cue.name === 'hit'), `${element} ${effect} cues the hit`);
  }
});

golden.test('the spell library compiles to the pixels that were approved', () => {
  // These change with any change to the library's pixels: node scripts/goldens.mjs spell-library draws them before and
  // after, and --write updates them only after the art is seen again.
  for (const element of ELEMENTS) {
    const { recipe } = compileEffects(spellLibrary[element]);
    golden.equal(element, sha(recipe), { recipe });
  }
});
