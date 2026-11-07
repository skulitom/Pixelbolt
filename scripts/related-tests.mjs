// Runs only the test files that import the given files, directly or through other modules: a quick inner loop while
// working on a module. npm test still runs everything before a push.
//
//   npm run test:related -- src/motions.js [more files or folders]   the test files that import them
//   npm run test:related                                             ... that import a file changed since the last commit
//   npm run test:related -- --since main                             ... that import a file changed since main
//   --list names the test files and why, without running them; arguments after -- (and --test-* options) go to node --test.
//
// The graph is read from the source text, with no dependencies: import and export ... from '...', import('...') with a
// literal path, and new URL('...', import.meta.url) (workers, fixtures). A test that reaches code only through a process
// it starts (the CLI) or a path it builds at run time is not found.
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const unix = file => file.split(path.sep).join('/');
const SPECIFIERS = [
  /\bfrom\s*(['"])(\.{1,2}\/[^'"\n]*)\1/g,
  /\bimport\s*(['"])(\.{1,2}\/[^'"\n]*)\1/g,
  /\bimport\s*\(\s*(['"`])(\.{1,2}\/[^'"`\n$]*)\1\s*\)/g,
  /\bnew\s+URL\(\s*(['"`])(\.{1,2}\/[^'"`\n$]*)\1\s*,\s*import\.meta\.url\s*\)/g
];

export function testFiles(root = ROOT) {
  const found = [], walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.test\.[cm]?js$/.test(entry.name)) found.push(unix(path.relative(root, file)));
    }
  };
  if (existsSync(path.join(root, 'test'))) walk(path.join(root, 'test'));
  return found.sort();
}

// Each module reachable from a test file → the files it refers to, all relative to the root. A file that no longer
// exists keeps its edges, so a test importing a deleted module is still found.
export function importGraph(root = ROOT) {
  const edges = new Map(), tests = testFiles(root);
  const visit = file => {
    if (edges.has(file)) return;
    const out = new Set();
    edges.set(file, out);
    const where = path.join(root, file);
    if (!/\.[cm]?js$/.test(file) || !existsSync(where)) return;
    const text = readFileSync(where, 'utf8');
    for (const pattern of SPECIFIERS) for (const match of text.matchAll(pattern)) {
      const target = path.resolve(path.dirname(where), match[2].replace(/[?#].*$/, ''));
      const relative = unix(path.relative(root, target));
      if (!relative || relative.startsWith('../') || path.isAbsolute(relative) || match[2].endsWith('/')) continue;
      if (existsSync(target) && statSync(target).isDirectory()) continue;
      out.add(relative);
    }
    for (const next of out) visit(next);
  };
  for (const test of tests) visit(test);
  return { tests, edges };
}

// For each target (a file or a folder, relative to the root), the tests that reach it and the shortest chain of
// modules in between: [{ test, reaches: [{ target, via: [modules between the test and the target] }] }].
export function relatedTests(targets, { root = ROOT, graph = importGraph(root) } = {}) {
  const wanted = targets.map(target => unix(target).replace(/\/+$/, ''));
  const hit = file => wanted.filter(target => file === target || file.startsWith(`${target}/`));
  const found = [];
  for (const test of graph.tests) {
    const from = new Map([[test, null]]), queue = [test], reaches = new Map();
    while (queue.length) {
      const file = queue.shift();
      for (const target of hit(file)) if (!reaches.has(target)) {
        const via = [];
        for (let step = from.get(file); step !== null && step !== undefined; step = from.get(step)) via.unshift(step);
        reaches.set(target, { target, via: via.slice(1) });
      }
      for (const next of graph.edges.get(file) ?? []) if (!from.has(next)) { from.set(next, file); queue.push(next); }
    }
    if (reaches.size) found.push({ test, reaches: [...reaches.values()] });
  }
  return found;
}

// Files changed since a commit (HEAD: what is not committed yet), untracked ones included, relative to the root.
export function changedFiles(root = ROOT, since = 'HEAD') {
  const run = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const files = new Set();
  for (const file of run(['diff', '--name-only', '-z', '--no-renames', since, '--']).split('\0')) if (file) files.add(file);
  for (const file of run(['ls-files', '--others', '--exclude-standard', '-z']).split('\0')) if (file) files.add(file);
  return [...files].sort();
}

const USAGE = `Usage: npm run test:related -- [file or folder ...] [--since <ref>] [--list] [-- <node --test options>]
With no files, the files changed since the last commit (or since <ref>) are used.`;

export function runRelated(argv, { root = ROOT, log = console.log } = {}) {
  const split = argv.indexOf('--'), own = split < 0 ? argv : argv.slice(0, split), passed = split < 0 ? [] : argv.slice(split + 1);
  const targets = [];
  let list = false, since = null;
  for (let i = 0; i < own.length; i++) {
    const arg = own[i];
    if (arg === '--list') list = true;
    else if (arg === '--since') { since = own[++i]; if (!since) { log(USAGE); return 2; } }
    else if (arg === '--help' || arg === '-h') { log(USAGE); return 0; }
    else if (arg.startsWith('--test')) passed.push(arg);
    else if (arg.startsWith('-')) { log(`unknown option ${arg}\n${USAGE}`); return 2; }
    else targets.push(arg);
  }
  let files;
  if (targets.length) {
    // npm runs scripts from the package folder; a path is meant from where npm was started.
    const base = process.env.npm_lifecycle_event === 'test:related' && process.env.INIT_CWD ? process.env.INIT_CWD : process.cwd();
    files = [];
    for (const target of targets) {
      const relative = unix(path.relative(root, path.resolve(base, target)));
      if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) { log(`${target} is not a file or folder inside ${root}`); return 2; }
      files.push(relative);
    }
  } else {
    try { files = changedFiles(root, since ?? 'HEAD'); } catch (error) { log(`could not ask git what changed: ${error.stderr?.trim() || error.message}`); return 2; }
    if (!files.length) { log(`Nothing has changed since ${since ?? 'the last commit'}. Name the files to test, as in npm run test:related -- src/motions.js`); return 0; }
    log(`Changed since ${since ?? 'the last commit'}: ${files.join(', ')}`);
  }
  const related = relatedTests(files, { root });
  const reached = new Set(related.flatMap(r => r.reaches.map(x => x.target)));
  const unreached = files.filter(file => !reached.has(unix(file).replace(/\/+$/, '')));
  if (!related.length) {
    log(`No test file imports ${files.join(', ')}, so no tests ran. npm test runs everything.`);
    return 0;
  }
  const width = Math.max(...related.map(r => r.test.length));
  log(`${related.length} test ${related.length === 1 ? 'file imports' : 'files import'} ${files.length === 1 ? files[0] : 'these files'}:`);
  for (const { test, reaches } of related) {
    const why = reaches.map(({ target, via }) => `${files.length > 1 ? `${target} ` : ''}${via.length ? `through ${via.join(' → ')}` : 'directly'}`).join('; ');
    log(`  ${test.padEnd(width)}  ${why}`);
  }
  if (unreached.length) log(`No test file imports ${unreached.join(', ')}.`);
  if (list) return 0;
  const env = { ...process.env };
  // A run started from inside another test run reports to us, not to that run.
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ['--test', ...passed, ...related.map(r => r.test)], { cwd: root, env, stdio: 'inherit' });
  return run.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = runRelated(process.argv.slice(2));
