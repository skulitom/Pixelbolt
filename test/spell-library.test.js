import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject } from '../src/core.js';
import { compileEffects } from '../src/fx.js';
import { spellLibrary } from '../scripts/spell-library.mjs';

// The spell library: seven elements, each a projectile (looping, in eight directions), an impact, an area effect and a
// looping buff on one 64 × 64 canvas anchored at the point a game places them.
const root = fileURLToPath(new URL('../', import.meta.url));
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
      else {
        const inside = frames.slice(1).map((frame, k) => differ(frames[k], frame)), seam = differ(frames[frames.length - 1], frames[0]);
        assert.ok(seam <= Math.max(...inside), `${element} ${name}: seam ${seam}, inside ${inside}`);
      }
    }
    for (const effect of ['impact', 'area']) assert.ok((metadata.effects[effect].cues ?? []).some(cue => cue.name === 'hit'), `${element} ${effect} cues the hit`);
  }
});

test('the spell library compiles to the pixels that were approved', () => {
  // These change with any change to the library's pixels: regenerate them only after the art is seen again.
  const golden = {};
  for (const element of ELEMENTS) golden[element] = sha(compileEffects(spellLibrary[element]).recipe);
  assert.deepEqual(golden, GOLDEN);
});
const GOLDEN = {
  fire: '2f2401c06e516e6f38428e3313828a958f73abbf6852b70e0e7a34a0015532e9', ice: '486851832f0b2f6ca2df9e05ff3ed0f254834fbe28dd9d6de76d21be66fee432',
  lightning: 'a0db113da3483bcafdf4e21ccdc2e0e9539137452cc8f6207542354fd1627a28', water: 'e9be238e0e57be6a18bb3732a95e7421209864e04db9acbc385e2d046352f73e',
  poison: '86274e2560033e70b052edfa5ae38b74b0182e9e6fa896bf1fc016cce97b30b4', holy: '48f280a19abe8ba9de1b3bba0aadd601039eabbabd7b746173a3c7a82fe058a2',
  shadow: 'd1e4995d2b33366759b0b8aa8babac2dd45af19ffd03caab576113b4fff65ead'
};
