import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir, cp, utimes, appendFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listPresets } from '../src/presets.js';

// The presets listing compiles every shipped preset to measure it (P-066: about 14 s here for 58 presets, more on CI
// runners). With a cache folder each preset is measured once per engine and source. A 1.5 s budget keeps each listing
// short: the presets past it are listed by name, and the next listing measures more of them.
const BUDGET = 1500, root = fileURLToPath(new URL('../', import.meta.url));
const temp = async t => {
  const base = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(base, 'pixelbolt-presets-cache-'));
  t.after(async () => { assert.ok(dir.startsWith(base + path.sep)); await rm(dir, { recursive: true, force: true }); });
  return dir;
};
const engineFiles = async dir => (await readdir(dir).catch(() => [])).filter(name => /^[0-9a-f]{64}\.json$/.test(name));
const cacheFile = async dir => {
  const names = await engineFiles(dir);
  assert.equal(names.length, 1, `one cache file: ${names.join(', ')}`);
  return path.join(dir, names[0]);
};
const measured = listing => listing.presets.filter(entry => !entry.unmeasured && !entry.error);
const factsOf = ({ name, kind, file: _, ...rest }) => rest;

test('a listing keeps each measured preset\'s facts, and the next listing reads them instead of compiling', async t => {
  const dir = path.join(await temp(t), '.presets'), first = await listPresets({ budget: BUDGET, cache: dir });
  const done = measured(first);
  assert.ok(done.length > 0, 'at least one preset is measured within the budget');
  const file = await cacheFile(dir), cached = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(Object.keys(cached).length, done.length, 'one entry per measured preset');
  assert.deepEqual(Object.values(cached).map(entry => JSON.stringify(entry)).sort(), done.map(entry => JSON.stringify(factsOf(entry))).sort());
  // A changed entry shows in the next listing, so the facts came from the cache, not from compiling again.
  for (const entry of Object.values(cached)) entry.colors = 99999;
  await writeFile(file, JSON.stringify(cached));
  const second = await listPresets({ budget: BUDGET, cache: dir }), byName = new Map(second.presets.map(entry => [entry.name, entry]));
  for (const entry of done) assert.equal(byName.get(entry.name).colors, 99999, entry.name);
  assert.ok(measured(second).length >= done.length, 'a later listing measures at least as many');
  // Past the budget, cached presets are still listed with their facts; only the rest are unmeasured.
  const late = await listPresets({ budget: -1, cache: dir });
  assert.equal(measured(late).length, measured(second).length);
  assert.ok(measured(late).every(entry => entry.colors === 99999 || measured(second).some(other => other.name === entry.name && other.colors === entry.colors)));
  assert.equal(Object.keys(JSON.parse(await readFile(file, 'utf8'))).length, measured(second).length, 'nothing cached is dropped past the budget');
});

test('a damaged cache, a malformed entry and presets no longer listed are measured again or dropped', async t => {
  const dir = path.join(await temp(t), '.presets'), first = await listPresets({ budget: BUDGET, cache: dir }), done = measured(first);
  const file = await cacheFile(dir), cached = JSON.parse(await readFile(file, 'utf8'));
  // A malformed entry (a missing fact, or a key that isn't a fact) is measured again; a key no preset has is dropped.
  const [key, second] = Object.keys(cached), original = cached[key];
  cached[key] = { colors: 1 };
  if (second) cached[second] = { ...cached[second], name: 'other' };
  cached['0'.repeat(64)] = original;
  await writeFile(file, JSON.stringify(cached));
  const again = await listPresets({ budget: BUDGET, cache: dir });
  const kept = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(kept[key], original, 'the malformed entry was measured again');
  if (second) assert.equal(kept[second].name, undefined, 'an entry that would rename a preset is measured again');
  assert.equal(kept['0'.repeat(64)], undefined, 'a key no listed preset has is dropped');
  assert.ok(again.presets.some(entry => JSON.stringify(factsOf(entry)) === JSON.stringify(original)), 'the listing shows the re-measured facts');
  assert.ok(again.presets.every(entry => entry.name !== 'other'));
  // A file that isn't JSON is measured afresh and replaced.
  await writeFile(file, '{"oops');
  const fresh = await listPresets({ budget: BUDGET, cache: dir });
  assert.deepEqual(fresh.presets.find(entry => entry.name === done[0].name), done[0]);
  assert.ok(Object.keys(JSON.parse(await readFile(file, 'utf8'))).length > 0, 'the damaged file was replaced');
});

test('the folder keeps the newest three engines\' files and sweeps temp files a killed call left', async t => {
  const dir = path.join(await temp(t), '.presets');
  await listPresets({ budget: BUDGET, cache: dir });
  const file = await cacheFile(dir), hour = 3600, now = Date.now() / 1000;
  const others = ['a', 'b', 'c'].map((digit, i) => ({ file: path.join(dir, `${digit.repeat(64)}.json`), age: (i + 1) * 60 }));
  for (const other of others) { await writeFile(other.file, '{}'); await utimes(other.file, now - other.age, now - other.age); }
  const stale = path.join(dir, '00000000-0000-4000-8000-000000000000.tmp'), recent = path.join(dir, '11111111-1111-4111-8111-111111111111.tmp');
  await writeFile(stale, ''); await utimes(stale, now - 2 * hour, now - 2 * hour);
  await writeFile(recent, '');
  // Drop one entry, so the next listing measures it and writes the file.
  const cached = JSON.parse(await readFile(file, 'utf8'));
  delete cached[Object.keys(cached)[0]];
  await writeFile(file, JSON.stringify(cached));
  await listPresets({ budget: BUDGET, cache: dir });
  const names = await readdir(dir);
  assert.deepEqual((await engineFiles(dir)).sort(), [path.basename(file), `${'a'.repeat(64)}.json`, `${'b'.repeat(64)}.json`].sort(), 'the current file and the two newest others');
  assert.ok(!names.includes(path.basename(stale)), 'an hour-old temp file is swept');
  assert.ok(names.includes(path.basename(recent)), 'another call\'s fresh temp file is left alone');
});

test('a server whose engine files changed after it loaded neither reads nor writes the cache', async t => {
  // A copy of the package stands in for a server's checkout, updated under it after it started.
  const dir = await temp(t), pkg = path.join(dir, 'pkg');
  for (const part of ['src', 'examples', 'package.json', 'studio/effects-controls.js', 'studio/fluid-controls.js']) await cp(path.join(root, part), path.join(pkg, part), { recursive: true });
  const { listPresets: running } = await import(pathToFileURL(path.join(pkg, 'src/presets.js')).href);
  const before = path.join(dir, 'before'), after = path.join(dir, 'after');
  await running({ budget: BUDGET, cache: before });
  assert.equal((await engineFiles(before)).length, 1, 'unchanged files: the cache works');
  await appendFile(path.join(pkg, 'src', 'craft.js'), '\n// updated under the running server\n');
  const listing = await running({ budget: BUDGET, cache: after });
  assert.ok(measured(listing).length > 0, 'it still measures');
  assert.deepEqual(await engineFiles(after), [], 'old code never files facts under the new code\'s name');
});

test('a cache folder that can\'t be written costs only speed', async t => {
  const dir = await temp(t), blocker = path.join(dir, 'file');
  await writeFile(blocker, 'not a folder');
  const listing = await listPresets({ budget: BUDGET, cache: path.join(blocker, '.presets') });
  assert.ok(measured(listing).length > 0);
  assert.deepEqual(await readdir(dir), ['file']);
});
