import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { presetEntries } from '../src/presets.js';

const root = fileURLToPath(new URL('../', import.meta.url)), cli = path.join(root, 'bin', 'pixelbolt.js'), examples = path.join(root, 'examples');
const run = (...args) => promisify(execFile)(process.execPath, [cli, ...args], { maxBuffer: 16 * 1048576 });

test('pixelbolt presets lists every preset, and prints one preset\'s source', async () => {
  const entries = await presetEntries(), { guide, presets } = JSON.parse((await run('presets')).stdout);
  assert.match(guide, /pixel_compile \{"preset": "<name>"\}/);
  assert.deepEqual(presets.map(entry => [entry.name, entry.file]), entries.map(entry => [entry.name, `examples/${entry.file}`]));
  assert.ok(presets.every(entry => entry.size && entry.frames && entry.plays && entry.colors && entry.for && !entry.error));
  const smoke = entries.find(entry => entry.file === 'smoke-puff.fluid.json');
  if (smoke) {
    const one = JSON.parse((await run('presets', smoke.name)).stdout);
    assert.deepEqual(one.source, JSON.parse(await readFile(path.join(examples, smoke.file), 'utf8')));
    assert.match(one.next, /pixelbolt compile --preset smoke-puff/);
  }
});

test('compile --preset writes the bytes compiling the preset\'s file writes, and refuses metadata a recipe lacks', async t => {
  const dir = await mkdtemp(path.join(path.resolve(os.tmpdir()), 'pixelbolt-presets-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const entries = await presetEntries();
  // compile --preset reads the preset's own file: one preset of each kind shows it, an fx one that names another file
  // if there is one.
  const namesFile = async entry => /"recipe":\s*"/.test(await readFile(path.join(examples, entry.file), 'utf8'));
  const fx = entries.filter(entry => entry.kind === 'fx'), naming = [];
  for (const entry of fx) if (await namesFile(entry)) naming.push(entry);
  const picked = [...['fluid', 'wave', 'poses', 'recipe'].map(kind => entries.find(entry => entry.kind === kind)), naming[0] ?? fx[0]].filter(Boolean);
  await Promise.all(picked.map(async entry => {
    const out = path.join(dir, `${entry.name}.json`), file = path.join(dir, `${entry.name}.file.json`);
    await run('compile', '--preset', entry.name, '--out', out);
    if (entry.kind === 'recipe') assert.equal(await readFile(out, 'utf8'), await readFile(path.join(examples, entry.file), 'utf8'), entry.name);
    else {
      await run('compile', path.join(examples, entry.file), '--out', file);
      assert.equal(await readFile(out, 'utf8'), await readFile(file, 'utf8'), entry.name);
    }
  }));
  const recipe = entries.find(entry => entry.kind === 'recipe');
  if (recipe) {
    const refused = await run('compile', '--preset', recipe.name, '--out', path.join(dir, 'x.json'), '--metadata', path.join(dir, 'x.meta.json')).then(() => null, error => error);
    assert.ok(refused, 'compile --metadata of a plain recipe preset fails');
    assert.match(refused.stdout + refused.stderr, /has no metadata; omit --metadata/);
    await assert.rejects(readFile(path.join(dir, 'x.json')), { code: 'ENOENT' });
  }
  await assert.rejects(run('compile', path.join(examples, entries[0].file), '--preset', entries[0].name, '--out', path.join(dir, 'y.json')));
});
