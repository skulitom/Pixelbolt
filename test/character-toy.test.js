import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, buildAtlas } from '../src/core.js';
import { compilePoses } from '../src/authoring.js';
import { animationGIF } from '../src/gif.js';
import { spriteFrames } from '../src/godot.js';
import {
  CHARACTERS, CHARACTER_TOY_VERSION,
  characterById, recolorSource, groupAnimations, pickAnimation, fourWayAnimations,
  characterLink, readCharacterLink, fitZoom, gifScale, safeName, normalizeHex
} from '../playground/characters/lib.js';
import { buildItchCharacterArchive } from '../scripts/build-itch-characters.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFile(path.join(root, file), 'utf8');

test('character studio pins the same engine version as the playground and has no static imports in lib.js', async () => {
  const playgroundApp = await read('playground/app.js');
  const pin = /\bconst PINNED_VERSION = '([^']+)'/.exec(playgroundApp)[1];
  assert.equal(CHARACTER_TOY_VERSION, pin);
  assert.doesNotMatch(await read('playground/characters/lib.js'), /^\s*import\s/m);
});

test('every character preset and palette theme compiles, renders and exports cleanly', async () => {
  for (const preset of CHARACTERS) {
    assert.equal(characterById(preset.id), preset);
    const source = JSON.parse(await read(`examples/${preset.file}`));
    for (const theme of preset.themes) {
      const recolored = recolorSource(source, theme.palette);
      // Original source is never mutated.
      assert.notEqual(recolored, source);
      const compiled = compilePoses(recolored);
      const project = renderProject(compiled.recipe);
      assert.ok(project.frames.length > 0, `${preset.id}/${theme.id}`);
      const anims = Object.keys(project.animations);
      assert.ok(anims.length > 0, `${preset.id}/${theme.id}: needs animations`);
      if (preset.fourWay) {
        const quad = fourWayAnimations(anims, 'walk');
        assert.equal(quad?.length, 4, `${preset.id}: 4-way walk turntable`);
      }
      const chosen = pickAnimation(anims, 'down', 'walk');
      assert.ok(anims.includes(chosen));
      const atlas = buildAtlas(project);
      assert.match(spriteFrames(atlas.metadata, `${preset.id}.png`).text, /SpriteFrames/);
      const gif = animationGIF(project, chosen, { scale: gifScale(project.width, project.height) });
      assert.equal(Buffer.from(gif.data).toString('ascii', 0, 6), 'GIF89a');
    }
  }
});

test('recolorSource ignores unknown keys and invalid hex strings', () => {
  const base = { palette: { a: '#112233', b: '#445566' } };
  const next = recolorSource(base, { a: '#ABC', b: 'not-a-color', extra: '#ffffff' });
  assert.deepEqual(next.palette, { a: '#aabbcc', b: '#445566' });
  assert.equal(base.palette.a, '#112233');
  assert.equal(normalizeHex('#0f0'), '#00ff00');
  assert.equal(normalizeHex('#12345678'), '#12345678');
  assert.equal(normalizeHex('red'), null);
});

test('direction grouping and share links round-trip custom palettes and reject bad input', () => {
  const grouped = groupAnimations(['stand-down', 'stand-up', 'stand-right', 'stand-left', 'walk-down', 'walk-up', 'walk-right', 'walk-left', 'cast-down']);
  assert.deepEqual(grouped.availableDirections, ['down', 'up', 'right', 'left']);
  assert.equal(pickAnimation(grouped.all, 'right', 'walk'), 'walk-right');
  assert.equal(pickAnimation(grouped.all, 'left', 'stand'), 'stand-left');

  const link = characterLink('https://skulitom.github.io/Pixelbolt/playground/characters/', {
    character: 'four-way-mage',
    animation: 'cast-down',
    speed: 1.5,
    palette: { r: '#992d38', c: '#ff7b3b', x: '#231936' },
    basePalette: { r: '#4d3c94', c: '#76f1ff', x: '#231936' }
  });
  assert.ok(!link.includes('x:'), 'unchanged base color should be omitted from share link');
  const parsed = readCharacterLink(link);
  assert.deepEqual(parsed, {
    version: CHARACTER_TOY_VERSION,
    character: 'four-way-mage',
    animation: 'cast-down',
    speed: 1.5,
    palette: { r: '#992d38', c: '#ff7b3b' }
  });

  assert.throws(() => readCharacterLink('#c=unknown-rig'), /no character called/);
  assert.throws(() => readCharacterLink('#v=bad&c=four-way-knight'), /engine version/);
  assert.equal(fitZoom(320, 240, 24, 24, 1).zoom, 10);
  assert.equal(safeName('Four-Way Mage!'), 'Four-Way-Mage');
});

test('character studio HTML has strict CSP and all expected interactive controls', async () => {
  const html = await read('playground/characters/index.html');
  assert.match(html, /Content-Security-Policy" content="default-src 'none'; script-src 'self' https:\/\/cdn\.jsdelivr\.net; connect-src 'self' https:\/\/cdn\.jsdelivr\.net; img-src 'self' data: blob:; style-src 'self'; base-uri 'none'; form-action 'none'"/);
  assert.doesNotMatch(html, /<style\b|\sstyle\s*=|<script(?![^>]*\bsrc=)/i);
  for (const id of ['presets', 'stage', 'character', 'pause', 'step-back', 'step-forward', 'animation', 'speed', 'themes', 'swatches', 'reset-colors', 'dir-down', 'dir-up', 'dir-right', 'dir-left', 'dir-all', 'export-gif', 'export-sheet', 'export-atlas', 'export-godot', 'export-recipe', 'copy-link']) {
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  }
});

test('itch.io HTML5 packager builds a self-contained offline archive with zero external links and resolved imports', async () => {
  const { files, zip } = await buildItchCharacterArchive();
  assert.equal(zip.subarray(0, 4).toString('binary'), 'PK\x03\x04', 'valid ZIP signature');
  const html = files.get('index.html').toString('utf8');
  assert.match(html, /data-bundled="true"/);
  assert.doesNotMatch(html, /cdn\.jsdelivr\.net/, 'itch.io offline bundle must have zero CDN references');
  for (const preset of CHARACTERS) assert.ok(files.has(`presets/${preset.file}`), `missing bundled preset ${preset.file}`);
  // Every local relative JS import inside the archive must resolve to a file present in the archive.
  for (const [name, bytes] of files) {
    if (!name.endsWith('.js')) continue;
    const text = bytes.toString('utf8');
    for (const [, specifier] of text.matchAll(/^[ \t]*(?:import|export)[^;'"`]*?\bfrom\s*['"](\.[^'"]+)['"]/gm)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), specifier));
      assert.ok(files.has(target), `itch bundle ${name} imports ${specifier} -> ${target}, which is missing`);
    }
  }
});

