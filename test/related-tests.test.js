import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importGraph, relatedTests } from '../scripts/related-tests.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const byTest = found => new Map(found.map(({ test, reaches }) => [test, reaches.map(({ target, via }) => [target, via])]));

test('the repository\'s import graph reaches modules directly, through others, through workers and data files', () => {
  const graph = importGraph(root), related = target => byTest(relatedTests([target], { root, graph }));
  const pose = related('src/pose-geometry.js');
  assert.deepEqual(pose.get('test/pose-geometry.test.js'), [['src/pose-geometry.js', []]]);
  assert.deepEqual(pose.get('test/templates.test.js'), [['src/pose-geometry.js', ['src/authoring.js']]]);
  assert.ok(!pose.has('test/share.test.js'), 'the share links never load the pose compiler');
  // The MCP worker is started with new URL('./mcp-worker.js', import.meta.url).
  assert.deepEqual(related('src/mcp-worker.js').get('test/bodies.test.js'), [['src/mcp-worker.js', ['src/mcp.js']]]);
  // A fixture a test opens the same way.
  assert.deepEqual([...related('test/goldens/fluid.json').keys()], ['test/fluid.test.js']);
});

// A small project: a multi-line import, export-from, a dynamic import, a worker, a cycle, data, a file nothing imports
// and a test that fails.
const FILES = {
  'lib/a.js': 'export const a = 1;\n',
  'lib/b.js': "import {\n  a\n} from './a.js';\nexport const b = a + 1;\n",
  'lib/c.js': "export * from './b.js';\n",
  'lib/d.js': "export const later = () => import('./e.js');\nexport const name = 'e';\nexport const guessed = () => import(`./${name}.js`);\nexport const worker = new URL('./worker.js', import.meta.url);\n",
  'lib/e.js': "import { later } from './d.js';\nexport const e = later;\n",
  'lib/worker.js': "import { a } from './a.js';\nexport default a;\n",
  'lib/lone.js': 'export const lone = 1;\n',
  'lib/broken.js': 'export const two = 2;\n',
  'test/one.test.js': "import test from 'node:test';\nimport { b } from '../lib/c.js';\ntest('one', () => {});\n",
  'test/two.test.js': "import test from 'node:test';\nimport { later } from '../lib/d.js';\ntest('two', () => {});\n",
  'test/three.test.js': "import test from 'node:test';\nconst data = new URL('./data.json', import.meta.url);\ntest('three', () => {});\n",
  'test/data.json': '{}\n',
  'test/fails.test.js': "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { two } from '../lib/broken.js';\ntest('fails', () => assert.equal(two, 3));\n"
};

test('related tests follow every kind of import in a project, and the command runs only them', async t => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pixelbolt-related-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  for (const [file, text] of Object.entries(FILES)) { mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); writeFileSync(path.join(dir, file), text); }
  mkdirSync(path.join(dir, 'scripts'));
  cpSync(path.join(root, 'scripts', 'related-tests.mjs'), path.join(dir, 'scripts', 'related-tests.mjs'));
  writeFileSync(path.join(dir, 'package.json'), '{ "type": "module" }\n');

  const related = targets => byTest(relatedTests(targets, { root: dir }));
  assert.deepEqual([...related(['lib/a.js'])], [
    ['test/one.test.js', [['lib/a.js', ['lib/c.js', 'lib/b.js']]]],
    ['test/two.test.js', [['lib/a.js', ['lib/d.js', 'lib/worker.js']]]]
  ]);
  assert.deepEqual([...related(['lib/e.js'])], [['test/two.test.js', [['lib/e.js', ['lib/d.js']]]]]);
  assert.deepEqual([...related(['lib/lone.js'])], []);
  assert.deepEqual([...related(['test/data.json'])], [['test/three.test.js', [['test/data.json', []]]]]);
  assert.deepEqual([...related(['lib'])].map(([file]) => file), ['test/fails.test.js', 'test/one.test.js', 'test/two.test.js']);

  const env = { ...process.env, GIT_CONFIG_GLOBAL: path.join(dir, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Pixelbolt tests', GIT_AUTHOR_EMAIL: 'tests@pixelbolt.invalid', GIT_COMMITTER_NAME: 'Pixelbolt tests', GIT_COMMITTER_EMAIL: 'tests@pixelbolt.invalid' };
  delete env.NODE_TEST_CONTEXT;
  delete env.npm_lifecycle_event;
  writeFileSync(path.join(dir, 'gitconfig'), '');
  const run = (args, command = process.execPath) => spawnSync(command, args, { cwd: dir, env, encoding: 'utf8' });
  const command = (...args) => run([path.join('scripts', 'related-tests.mjs'), ...args]);

  let result = command('--list', 'lib/a.js');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^2 test files import lib\/a\.js:\n {2}test\/one\.test\.js +through lib\/c\.js → lib\/b\.js\n {2}test\/two\.test\.js +through lib\/d\.js → lib\/worker\.js\n$/);
  // Run: only the related test runs (options after -- reach node --test), and a failing one fails the command.
  result = command('lib/e.js', '--', '--test-reporter=spec');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /✔ two/);
  assert.doesNotMatch(result.stdout, /✔ (one|three)/);
  assert.notEqual(command('lib/broken.js').status, 0);
  result = command('lib/lone.js', 'docs/notes.md');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /No test file imports lib\/lone\.js, docs\/notes\.md, so no tests ran\./);

  // With no files, what changed since the last commit, untracked files included.
  for (const args of [['init', '-q'], ['add', '-A'], ['commit', '-q', '-m', 'start']]) assert.equal(run(args, 'git').status, 0);
  result = command('--list');
  assert.match(result.stdout, /Nothing has changed since the last commit/);
  writeFileSync(path.join(dir, 'lib', 'worker.js'), "import { a } from './a.js';\nexport default a + 1;\n");
  writeFileSync(path.join(dir, 'lib', 'new.js'), 'export const fresh = 1;\n');
  result = command('--list');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Changed since the last commit: lib\/new\.js, lib\/worker\.js\n1 test file imports these files:\n {2}test\/two\.test\.js +lib\/worker\.js through lib\/d\.js\nNo test file imports lib\/new\.js\.\n$/);
});
