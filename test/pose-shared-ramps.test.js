import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { heroRig } from '../scripts/figure-rigs.mjs';
import { compilePoses } from '../src/authoring.js';
import { inlineSharedPalette } from '../src/core.js';
import { resolveReferences } from '../src/resolve.js';

// poses.schema.json promises that a shared palette file ({"palette": {...}, "ramps": [...]}) can supply a pose
// source's ramps, as it does a recipe's (P-045).
const cli = path.join(fileURLToPath(new URL('../', import.meta.url)), 'bin', 'pixelbolt.js');
async function folder(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-pose-ramps-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
// The hero rig with its palette and ramps moved out to a shared file.
function linkedRig() {
  const { ramps, ...rig } = heroRig();
  return { rig: heroRig(), shared: { palette: rig.palette, ramps }, source: { ...rig, palette: { $ref: 'colours.json' } } };
}

test('a pose source without ramps takes them from its shared palette file, in the CLI, MCP resolver and studio', async t => {
  const dir = await folder(t), { rig, shared, source } = linkedRig();
  await writeFile(path.join(dir, 'colours.json'), JSON.stringify(shared));
  await writeFile(path.join(dir, 'hero.poses.json'), JSON.stringify(source));
  const resolved = await resolveReferences(source, { baseDir: dir });
  assert.deepEqual(resolved.document.ramps, rig.ramps);
  assert.deepEqual(resolved.palettes.map(entry => [entry.where, entry.ramps]), [['poses', rig.ramps]]);
  const expected = compilePoses(rig);
  assert.deepEqual(compilePoses(resolved.document), expected);
  // The studio draws the source as written with the file it was sent.
  assert.deepEqual(compilePoses(inlineSharedPalette(source, shared)), expected);
  // `pixelbolt compile` writes the recipe linked to the file; ramps that came from it stay there.
  const out = path.join(dir, 'hero.json');
  const compiled = spawnSync(process.execPath, [cli, 'compile', path.join(dir, 'hero.poses.json'), '--out', out], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stderr);
  const written = JSON.parse(await readFile(out, 'utf8'));
  assert.deepEqual([written.palette, written.ramps], [{ $ref: 'colours.json' }, undefined]);
  assert.deepEqual((await resolveReferences(written, { baseDir: dir })).document, expected.recipe);
});

test('a pose source keeps its own ramps over the shared file\'s', async t => {
  const dir = await folder(t), { rig, shared } = linkedRig();
  const source = { ...rig, palette: { $ref: 'colours.json' } };
  await writeFile(path.join(dir, 'colours.json'), JSON.stringify({ ...shared, ramps: [[...shared.ramps[0]].reverse()] }));
  const resolved = await resolveReferences(source, { baseDir: dir });
  assert.deepEqual(resolved.document.ramps, rig.ramps);
  assert.equal(Object.hasOwn(resolved.palettes[0], 'ramps'), false);
  assert.deepEqual(compilePoses(resolved.document), compilePoses(rig));
});

test('a pose part that names a ramp in a source with none says to add ramps', async t => {
  const dir = await folder(t), { shared, source } = linkedRig();
  await writeFile(path.join(dir, 'colours.json'), JSON.stringify(shared.palette));
  const message = /poses\.parts\.body\.mass\.ramp: this pose source has no ramps: add "ramps" \(lists of palette keys from dark to light\), or link a shared palette file that lists them/;
  const resolved = (await resolveReferences(source, { baseDir: dir })).document;
  assert.throws(() => compilePoses(resolved), message);
  const { ramps, ...inline } = heroRig();
  assert.throws(() => compilePoses(inline), message);
  assert.throws(() => compilePoses({ ...inline, ramps: [] }), message);
  // A ramp number past the end still names the range.
  assert.throws(() => compilePoses({ ...heroRig(), parts: { ...heroRig().parts, body: { ...heroRig().parts.body, mass: { ...heroRig().parts.body.mass, ramp: 1 } } } }), /poses\.parts\.body\.mass\.ramp: expected an integer from 0 to 0/);
});

test('effect sources never take a shared file\'s ramps, which they have no place for', async t => {
  const dir = await folder(t);
  await writeFile(path.join(dir, 'palette.json'), JSON.stringify({ palette: { a: '#123', b: '#456' }, ramps: [['a', 'b']] }));
  const fx = { format: 'pixelforge-fx', version: 1, name: 'puff', width: 8, height: 8, palette: { $ref: 'palette.json' }, effects: [] };
  const resolved = await resolveReferences(fx, { baseDir: dir });
  assert.equal(Object.hasOwn(resolved.document, 'ramps'), false);
  assert.equal(Object.hasOwn(inlineSharedPalette(fx, { palette: { a: '#123' }, ramps: [['a', 'a']] }), 'ramps'), false);
});
