import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { goldens, goldenSets, describeChange, runGoldens } from '../scripts/goldens.mjs';
import { decodePNG } from '../src/import.js';

const root = fileURLToPath(new URL('../', import.meta.url));

test('every golden set lives in test/goldens with exactly one test file, and the frozen baseline is none of them', () => {
  const sets = goldenSets(root);
  assert.deepEqual([...sets.keys()], ['bodies', 'crystal', 'figures', 'fluid', 'fx', 'idle-squash', 'shapes', 'spell-library', 'terrain', 'wave']);
  for (const { set, fixture, tests } of sets.values()) {
    assert.equal(fixture, `test/goldens/${set}.json`);
    assert.equal(tests.length, 1, `${fixture} is used by ${tests.join(', ') || 'no test'}`);
    assert.ok(Object.keys(JSON.parse(readFileSync(path.join(root, fixture), 'utf8'))).length > 0, fixture);
  }
  assert.deepEqual(readdirSync(path.join(root, 'test', 'goldens')).sort(), [...sets.keys()].map(set => `${set}.json`).sort());
  // The pre-M0 baseline is frozen: the helper refuses it, as it refuses any file outside test/goldens.
  assert.throws(() => goldens(new URL('./fixtures/figures-baseline.json', import.meta.url)), /kept in test\/goldens\/<set>\.json, not test\/fixtures\/figures-baseline\.json/);
});

test('golden.equal names what changed and belongs inside golden.test', async () => {
  assert.equal(describeChange('a'.repeat(64), 'b'.repeat(64)), `${'a'.repeat(12)}… is now ${'b'.repeat(12)}…`);
  assert.equal(describeChange({ compiled: 'x', frames: [{ rgba: 'a' }, { rgba: 'b' }] }, { compiled: 'y', frames: [{ rgba: 'a' }, { rgba: 'c' }] }), 'compiled, frames[1].rgba differ');
  const where = new URL('./goldens/no-such-set.json', import.meta.url), golden = goldens(where);
  assert.throws(() => golden.equal('x', 1), /golden\.equal\("x"\) belongs inside golden\.test/);
  await assert.rejects(runGoldens(['no-such-set']), /no golden set is named no-such-set; the sets are bodies, crystal, figures/);
});

// A project of its own with the real helper and renderer: a test with two cases, drawn as frames and as a recipe.
const ART = colour => `export const colour = [${colour}, 255];
// Two 4 × 4 frames: a diagonal in the colour, then the other diagonal.
export const frames = () => [0, 1].map(k => {
  const data = new Uint8Array(64);
  for (let i = 0; i < 4; i++) data.set(colour, (i * 4 + (k ? 3 - i : i)) * 4);
  return { name: 'f' + k, width: 4, height: 4, data };
});
export const recipe = () => ({ version: 1, name: 'dot', width: 3, height: 3, palette: { b: '#2050f0' }, frames: [{ name: 'a', ops: [{ op: 'pixel', x: 1, y: 1, color: 'b' }] }] });
`;
// (Split here so that this repository's own set discovery does not take the project's call for one of its sets.)
const TEST = cases => `import { createHash } from 'node:crypto';
import { goldens } from '../scripts/goldens.mjs';
import { frames, recipe } from '../lib/art.js';

const golden = goldens(${'new'} URL('./goldens/art.json', import.meta.url));
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
golden.test('art', () => {
${cases.map(name => name === 'dots' ? "  golden.equal('dots', sha(frames().map(frame => [...frame.data])), { frames });" : "  golden.equal('dot', sha(recipe()), { recipe });").join('\n')}
});
`;

test('goldens --check lists what changed and draws it before and after; --write updates only what was asked', async t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pixelbolt-goldens-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  cpSync(path.join(root, 'src'), path.join(dir, 'src'), { recursive: true });
  for (const folder of ['scripts', 'lib', 'test']) mkdirSync(path.join(dir, folder));
  cpSync(path.join(root, 'scripts', 'goldens.mjs'), path.join(dir, 'scripts', 'goldens.mjs'));
  writeFileSync(path.join(dir, 'package.json'), '{ "type": "module" }\n');
  writeFileSync(path.join(dir, 'lib', 'art.js'), ART('200, 40, 40'));
  writeFileSync(path.join(dir, 'test', 'art.test.js'), TEST(['dots', 'dot']));
  writeFileSync(path.join(dir, 'gitconfig'), '');
  // Git sees only this project's settings: no signing prompts or line-ending rewrites from the machine's own.
  const env = { ...process.env, GIT_CONFIG_GLOBAL: path.join(dir, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Pixelbolt tests', GIT_AUTHOR_EMAIL: 'tests@pixelbolt.invalid', GIT_COMMITTER_NAME: 'Pixelbolt tests', GIT_COMMITTER_EMAIL: 'tests@pixelbolt.invalid' };
  delete env.NODE_TEST_CONTEXT;
  const run = (args, command = process.execPath) => spawnSync(command, args, { cwd: dir, env, encoding: 'utf8' });
  const goldensRun = (...args) => run([path.join('scripts', 'goldens.mjs'), ...args]);
  const tests = () => run(['--test', path.join('test', 'art.test.js')]);
  const pinned = () => JSON.parse(readFileSync(path.join(dir, 'test', 'goldens', 'art.json'), 'utf8'));
  const git = (...args) => assert.equal(run(args, 'git').status, 0, `git ${args.join(' ')}`);

  // No goldens yet and no history: both cases are new, drawn as they are now.
  let result = goldensRun();
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /art \(test\/goldens\/art\.json\): 2 new/);
  assert.match(result.stdout, /new {9}dots; 2 frames\n {14}art\/dots\.png/);
  assert.match(result.stdout, /Note: no before images: HEAD is not a commit/);
  assert.match(result.stdout, /If the change is meant: node scripts\/goldens\.mjs --write/);
  result = goldensRun('--write', '--no-images');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Wrote test\/goldens\/art\.json: 2 added\./);
  assert.deepEqual(Object.keys(pinned()), ['dots', 'dot']);
  const passed = tests();
  assert.equal(passed.status, 0, passed.stdout);
  git('init', '-q'); git('add', '-A'); git('commit', '-q', '-m', 'goldens');

  // A changed colour fails the ordinary test with the command to run, and the check draws before, after and the change.
  writeFileSync(path.join(dir, 'lib', 'art.js'), ART('40, 160, 60'));
  const failed = tests();
  assert.notEqual(failed.status, 0);
  assert.match(failed.stdout, /dots changed \([0-9a-f]{12}… is now [0-9a-f]{12}…\); its golden is in test\/goldens\/art\.json\. If the change is meant, node scripts\/goldens\.mjs draws it/);
  const before = pinned();
  result = goldensRun();
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /art \(test\/goldens\/art\.json\): 1 changed, 1 unchanged/);
  assert.match(result.stdout, /changed {5}dots: [0-9a-f]{12}… is now [0-9a-f]{12}…; 2 of 2 frames differ/);
  const folder = result.stdout.match(/Before and after images are in (.+)\/\n/)[1];
  const sheet = decodePNG(readFileSync(path.join(dir, folder, 'art', 'dots.png'))), colours = new Set();
  for (let at = 0; at < sheet.data.length; at += 4) colours.add(sheet.data.slice(at, at + 3).join());
  for (const colour of ['200,40,40', '40,160,60', '255,0,200']) assert.ok(colours.has(colour), `the sheet shows ${colour}`);
  assert.deepEqual(pinned(), before, '--check writes nothing');
  const report = JSON.parse(goldensRun('--json', '--no-images').stdout);
  assert.equal(report.ok, false);
  assert.deepEqual(report.sets[0].cases.map(c => [c.key, c.status]), [['dots', 'changed'], ['dot', 'unchanged']]);

  // --write with a case names exactly what changes; then everything passes.
  result = goldensRun('--write', '--no-images', 'art/dots');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Wrote test\/goldens\/art\.json: 1 changed\./);
  assert.notEqual(pinned().dots, before.dots);
  assert.equal(pinned().dot, before.dot);
  assert.equal(tests().status, 0);
  result = goldensRun();
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /Unchanged: art \(2\)\./);

  // A case its test no longer checks fails the ordinary run, is reported as not reached and removed by --write.
  writeFileSync(path.join(dir, 'test', 'art.test.js'), TEST(['dots']));
  assert.match(tests().stdout, /test\/goldens\/art\.json pins dot, which no test checks any more\. node scripts\/goldens\.mjs --write art removes them/);
  result = goldensRun();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /1 unchanged, 1 not reached\n {2}not reached dot/);
  assert.equal(goldensRun('--write').status, 0);
  assert.deepEqual(Object.keys(pinned()), ['dots']);
  assert.equal(tests().status, 0);
  // The images go into a new folder: an occupied --out is refused.
  result = goldensRun('--out', 'test');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--out test is not empty/);
});
