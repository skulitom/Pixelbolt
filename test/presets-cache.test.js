import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listPresets } from '../src/presets.js';

// The presets listing compiles every shipped preset to measure it (P-066: 5-7 s here, 14-18 s on CI runners). With a
// cache folder each preset is measured once per engine and source. A 1.5 s budget keeps each listing short: the
// presets past it are listed by name, and the next listing measures more of them.
const BUDGET = 1500;
const temp = async t => {
  const base = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(base, 'pixelbolt-presets-cache-'));
  t.after(async () => { assert.ok(dir.startsWith(base + path.sep)); await rm(dir, { recursive: true, force: true }); });
  return dir;
};
const cacheFile = async dir => {
  const names = (await readdir(dir)).filter(name => /^[0-9a-f]{64}\.json$/.test(name));
  assert.equal(names.length, 1, `one cache file: ${names.join(', ')}`);
  return path.join(dir, names[0]);
};
const measured = listing => listing.presets.filter(entry => !entry.unmeasured && !entry.error);

test('a listing keeps each measured preset\'s facts, and the next listing reads them instead of compiling', async t => {
  const dir = path.join(await temp(t), '.presets'), first = await listPresets({ budget: BUDGET, cache: dir });
  const done = measured(first);
  assert.ok(done.length > 0, 'at least one preset is measured within the budget');
  const file = await cacheFile(dir), cached = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(Object.keys(cached).length, done.length, 'one entry per measured preset');
  // Every cached entry is exactly a listed preset's facts.
  const facts = ({ name, kind, file: _, ...rest }) => JSON.stringify(rest);
  assert.deepEqual(Object.values(cached).map(entry => JSON.stringify(entry)).sort(), done.map(facts).sort());
  // A changed entry shows in the next listing, so the facts came from the cache, not from compiling again.
  for (const entry of Object.values(cached)) entry.colors = 99999;
  await writeFile(file, JSON.stringify(cached));
  const second = await listPresets({ budget: BUDGET, cache: dir }), byName = new Map(second.presets.map(entry => [entry.name, entry]));
  for (const entry of done) assert.equal(byName.get(entry.name).colors, 99999, entry.name);
  assert.ok(measured(second).length >= done.length, 'a later listing measures at least as many');
});

test('a damaged cache, a malformed entry, another engine\'s file and presets no longer listed are measured or dropped', async t => {
  const dir = path.join(await temp(t), '.presets'), first = await listPresets({ budget: BUDGET, cache: dir }), done = measured(first);
  const file = await cacheFile(dir), cached = JSON.parse(await readFile(file, 'utf8'));
  // A malformed entry is measured again; a key no preset has and another engine's file are removed on the next write.
  const [key] = Object.keys(cached), original = cached[key];
  cached[key] = { colors: 1 };
  cached['0'.repeat(64)] = original;
  await writeFile(file, JSON.stringify(cached));
  const stale = path.join(dir, `${'f'.repeat(64)}.json`);
  await writeFile(stale, '{}');
  const again = await listPresets({ budget: BUDGET, cache: dir });
  const kept = JSON.parse(await readFile(await cacheFile(dir), 'utf8'));
  assert.deepEqual(kept[key], original, 'the malformed entry was measured again');
  assert.equal(kept['0'.repeat(64)], undefined, 'a key no listed preset has is dropped');
  const remeasured = again.presets.find(entry => JSON.stringify((({ name, kind, file: _, ...rest }) => rest)(entry)) === JSON.stringify(original));
  assert.ok(remeasured, 'the listing shows the re-measured facts');
  // A file that isn't JSON is measured afresh and replaced.
  await writeFile(file, '{"oops');
  const fresh = await listPresets({ budget: BUDGET, cache: dir });
  assert.ok(measured(fresh).length > 0);
  const name = done[0].name;
  assert.deepEqual(fresh.presets.find(entry => entry.name === name), done[0]);
  assert.ok(Object.keys(JSON.parse(await readFile(file, 'utf8'))).length > 0, 'the damaged file was replaced');
});

test('a cache folder that can\'t be written costs only speed', async t => {
  const dir = await temp(t), blocker = path.join(dir, 'file');
  await writeFile(blocker, 'not a folder');
  const listing = await listPresets({ budget: BUDGET, cache: path.join(blocker, '.presets') });
  assert.ok(measured(listing).length > 0);
  assert.deepEqual(await readdir(dir), ['file']);
});
