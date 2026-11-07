// Goldens: output hashes the tests pin, kept in test/goldens/<set>.json (one set per test file), and the one command that
// shows and updates them. Each case stays defined in its test, which checks it with this module's helper:
//
//   const golden = goldens(new URL('./goldens/fluid.json', import.meta.url));
//   golden.test('every fluid example compiles to its golden recipe', () => {
//     for (...) golden.equal(name, sha(recipe), { recipe });   // or { frames: [{ name, width, height, data }] }
//   });
//
// The command runs only those tests (node --test --test-only), recording each case instead of asserting it:
//
//   node scripts/goldens.mjs [--check] [set | set/case ...]
//       Lists every case whose output differs from its pinned value, and draws each one's frames before (the last
//       commit's output; --base <ref> for another) and after, side by side, under output/goldens/.
//   node scripts/goldens.mjs --write [set | set/case ...]
//       The same, then writes the new values into test/goldens/. Pinned output changes only deliberately: look first.
//   --no-images skips the before run, --out <new folder> chooses where images go, --json prints a report to parse.
//
// test/fixtures/figures-baseline.json is the frozen pre-M0 baseline, not a golden set: nothing here reads or writes it.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const ROOT = fileURLToPath(new URL('../', import.meta.url)), SETS = path.join(ROOT, 'test', 'goldens');
// Set by the command for the test processes it starts: a folder to record into, and a file naming the cases to draw.
const RECORD = process.env.PIXELBOLT_GOLDENS_RECORD, WANTED = process.env.PIXELBOLT_GOLDENS_PICTURES;
const HOW = 'If the change is meant, node scripts/goldens.mjs draws it before and after, and --write updates the golden.';
const unix = file => file.split(path.sep).join('/');
const core = RECORD ? await import('../src/core.js') : null;

// ---- The helper golden tests use --------------------------------------------------------------------------------------

// The goldens command finds a set by this call's literal form: goldens(new URL('./goldens/<set>.json', import.meta.url)).
export function goldens(file) {
  const where = path.resolve(file instanceof URL ? fileURLToPath(file) : file), name = unix(path.relative(ROOT, where));
  if (path.relative(SETS, path.dirname(where)) !== '' || !where.endsWith('.json')) throw new Error(`goldens are kept in test/goldens/<set>.json, not ${name}`);
  const pinned = existsSync(where) ? JSON.parse(readFileSync(where, 'utf8')) : {}, set = path.basename(where, '.json');
  const checked = new Map();
  let tests = 0, finished = 0, running = 0;
  // Once every golden test in the file has run to its end, every pinned case must have been checked, so a loop that
  // stops reaching its cases fails instead of passing with nothing to compare.
  after(() => {
    if (RECORD || !tests || finished < tests) return;
    const unchecked = Object.keys(pinned).filter(key => !checked.has(key));
    if (unchecked.length) throw new Error(`${name} pins ${listed(unchecked)}, which no test checks any more. node scripts/goldens.mjs --write ${set} removes them.`);
  });
  return {
    // A node:test test whose cases the goldens command records; otherwise an ordinary test.
    test(title, options, fn) {
      if (typeof options === 'function') [options, fn] = [{}, options];
      tests++;
      return test(title, RECORD ? { ...options, only: true } : options, async context => {
        running++;
        try { await fn(context); finished++; } finally { running--; }
      });
    },
    // `actual` is any JSON value, usually a hash. The picture, { recipe } or { frames } (either may be a function, so it
    // is made only when drawn), is what the command draws when the value changes; `note` is added to the failure.
    equal(key, actual, picture = {}) {
      if (!running) throw new Error(`golden.equal(${JSON.stringify(key)}) belongs inside golden.test, where node scripts/goldens.mjs can run it`);
      const value = JSON.parse(JSON.stringify(actual));
      if (checked.has(key) && !isDeepStrictEqual(checked.get(key), value)) throw new Error(`${name}: ${key} was checked twice with different values`);
      checked.set(key, value);
      if (RECORD) return record(name, key, value, Object.hasOwn(pinned, key) ? pinned[key] : undefined, picture);
      const tail = picture.note ? `${HOW} ${picture.note}` : HOW;
      if (!Object.hasOwn(pinned, key)) assert.fail(`${name} has no golden for ${key}. ${tail}`);
      if (!isDeepStrictEqual(value, pinned[key])) assert.fail(`${key} changed (${describeChange(pinned[key], value)}); its golden is in ${name}. ${tail}`);
    }
  };
}

const listed = (items, most = 4) => items.length <= most ? items.join(', ') : `${items.slice(0, most).join(', ')} and ${items.length - most} more`;
// The leaves of two JSON values that differ, as paths: "compiled, frames[3].rgba".
function changedPaths(a, b, at = '', out = []) {
  if (isDeepStrictEqual(a, b)) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) changedPaths(a[key], b[key], Array.isArray(a) ? `${at}[${key}]` : at ? `${at}.${key}` : key, out);
  } else out.push(at || 'the value');
  return out;
}
export function describeChange(from, to) {
  if (typeof from === 'string' && typeof to === 'string') return `${from.slice(0, 12)}… is now ${to.slice(0, 12)}…`;
  const paths = changedPaths(from, to);
  return `${listed(paths)} ${paths.length === 1 ? 'differs' : 'differ'}`;
}

let saved = 0, wanted = null;
function record(file, key, value, pinned, picture) {
  wanted ??= WANTED ? new Set(JSON.parse(readFileSync(WANTED, 'utf8'))) : false;
  const entry = { file, key, value };
  if (wanted ? wanted.has(`${file}#${key}`) : !isDeepStrictEqual(value, pinned)) entry.picture = savePicture(picture);
  mkdirSync(RECORD, { recursive: true });
  appendFileSync(path.join(RECORD, `${process.pid}.jsonl`), `${JSON.stringify(entry)}\n`);
}
// Frames are drawn in the test's own process, so "before" comes from the renderer of the commit it was made with.
function savePicture({ recipe, frames }) {
  const take = value => typeof value === 'function' ? value() : value;
  try {
    let list;
    if (recipe !== undefined) {
      const project = core.renderProject(take(recipe));
      list = project.frames.map(frame => ({ name: frame.name, width: project.width, height: project.height, data: frame.data }));
    } else if (frames !== undefined) list = take(frames).map((frame, i) => ({ name: frame.name ?? `frame ${i + 1}`, width: frame.width, height: frame.height, data: frame.data }));
    else return { none: true };
    for (const frame of list) if (frame.data?.length !== frame.width * frame.height * 4) throw new Error(`frame ${frame.name} is not ${frame.width}×${frame.height} RGBA`);
    const file = `${process.pid}-${++saved}.rgba`;
    mkdirSync(RECORD, { recursive: true });
    writeFileSync(path.join(RECORD, file), Buffer.concat(list.map(({ data }) => Buffer.from(data.buffer, data.byteOffset, data.byteLength))));
    return { file, frames: list.map(({ name, width, height }) => ({ name, width, height })) };
  } catch (error) { return { error: error.message }; }
}

// ---- Finding the golden sets ------------------------------------------------------------------------------------------

function testFiles(root) {
  const found = [], walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.test\.[cm]?js$/.test(entry.name)) found.push(file);
    }
  };
  if (existsSync(path.join(root, 'test'))) walk(path.join(root, 'test'));
  return found.sort();
}
// Every set a test file opens with goldens(new URL(...)), and every file in test/goldens: set name → { set, fixture,
// tests }, paths relative to the root.
export function goldenSets(root = ROOT) {
  const sets = new Map(), call = /\bgoldens\(\s*new URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url\s*\)\s*\)/g;
  for (const file of testFiles(root)) {
    for (const match of readFileSync(file, 'utf8').matchAll(call)) {
      const fixture = unix(path.relative(root, path.resolve(path.dirname(file), match[2]))), set = path.basename(fixture, '.json');
      // The helper refuses anything else (a test may check that it does).
      if (!/^test\/goldens\/[^/]+\.json$/.test(fixture)) continue;
      if (!sets.has(set)) sets.set(set, { set, fixture, tests: [] });
      const entry = sets.get(set);
      if (entry.fixture !== fixture) throw new Error(`two golden files are named ${set}: ${entry.fixture} and ${fixture}`);
      entry.tests.push(unix(path.relative(root, file)));
    }
  }
  const folder = path.join(root, 'test', 'goldens');
  for (const name of existsSync(folder) ? readdirSync(folder) : []) {
    const set = path.basename(name, '.json');
    if (name.endsWith('.json') && !sets.has(set)) sets.set(set, { set, fixture: `test/goldens/${name}`, tests: [] });
  }
  return new Map([...sets].sort(([a], [b]) => a.localeCompare(b)));
}

// ---- The command ------------------------------------------------------------------------------------------------------

const USAGE = `Usage: node scripts/goldens.mjs [--check | --write] [set | set/case ...] [--base <ref>] [--out <new folder>] [--no-images] [--json]
  --check   (the default) run the golden tests, list the cases whose output changed and draw each one before and after
  --write   the same, then write the new values into test/goldens/<set>.json
A filter is a set (fluid) or one case (fluid/campfire; a trailing * matches the start of case names).`;
class UsageError extends Error {}

function parse(argv) {
  const options = { write: false, check: false, base: 'HEAD', out: null, images: true, json: false, filters: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check') options.check = true;
    else if (arg === '--write') options.write = true;
    else if (arg === '--no-images') options.images = false;
    else if (arg === '--json') options.json = true;
    else if (arg === '--base' || arg === '--out') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new UsageError(`${arg} needs a value`);
      options[arg.slice(2)] = argv[++i];
    } else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('-')) throw new UsageError(`unknown option ${arg}`);
    else options.filters.push(arg);
  }
  if (options.check && options.write) throw new UsageError('use --check or --write, not both');
  if (options.out && existsSync(options.out) && readdirSync(options.out).length) throw new UsageError(`--out ${options.out} is not empty; images go into a new or empty folder`);
  return options;
}
function select(sets, filters) {
  if (!filters.length) return new Map([...sets].map(([set, entry]) => [set, { ...entry, keys: null }]));
  const chosen = new Map();
  for (const filter of filters) {
    const slash = filter.indexOf('/'), set = slash < 0 ? filter : filter.slice(0, slash), key = slash < 0 ? null : filter.slice(slash + 1);
    if (!sets.has(set)) throw new UsageError(`no golden set is named ${set}; the sets are ${[...sets.keys()].join(', ')}`);
    const entry = chosen.get(set) ?? { ...sets.get(set), keys: [] };
    if (key === null || key === '' || key === '*') entry.keys = null; else if (entry.keys) entry.keys.push(key);
    chosen.set(set, entry);
  }
  return chosen;
}
const matches = (keys, key) => !keys || keys.some(pattern => pattern.endsWith('*') ? key.startsWith(pattern.slice(0, -1)) : key === pattern);

function runTests(cwd, files, extra) {
  const env = { ...process.env, ...extra };
  // A test process started from inside a test run would report to that run instead of to us.
  delete env.NODE_TEST_CONTEXT;
  if (!extra.PIXELBOLT_GOLDENS_PICTURES) delete env.PIXELBOLT_GOLDENS_PICTURES;
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--test', '--test-only', '--test-reporter=spec', ...files], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('close', code => resolve({ code, output }));
  });
}
// Every recorded case, by "fixture#key", in the order the tests checked them.
function readRecords(dir) {
  const cases = new Map(), clashes = [];
  for (const name of existsSync(dir) ? readdirSync(dir).filter(file => file.endsWith('.jsonl')).sort() : []) {
    for (const line of readFileSync(path.join(dir, name), 'utf8').split('\n')) {
      if (!line) continue;
      const entry = JSON.parse(line), id = `${entry.file}#${entry.key}`, seen = cases.get(id);
      if (!seen) cases.set(id, entry);
      else if (!isDeepStrictEqual(seen.value, entry.value)) clashes.push(id);
      else seen.picture ??= entry.picture;
    }
  }
  return { cases, clashes };
}
function loadFrames(dir, picture) {
  if (!picture?.file) return null;
  const bytes = readFileSync(path.join(dir, picture.file));
  let at = 0;
  return picture.frames.map(frame => {
    const size = frame.width * frame.height * 4, data = bytes.subarray(at, at + size);
    at += size;
    return { ...frame, data };
  });
}
const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
// The commit's files in a folder of their own, through a throwaway index: the checkout and its own index are untouched.
function exportCommit(root, ref, into) {
  if (!existsSync(path.join(root, '.git'))) return null;
  let commit;
  try { commit = git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim(); } catch { return null; }
  const index = path.join(into, 'index'), tree = path.join(into, 'tree');
  mkdirSync(into, { recursive: true });
  git(root, ['read-tree', commit], { GIT_INDEX_FILE: index });
  git(root, ['checkout-index', '--all', '--force', `--prefix=${unix(tree)}/`], { GIT_INDEX_FILE: index });
  return { commit, tree };
}

// Runs the command; resolves to its exit code (0: nothing pending, or written).
export async function runGoldens(argv, { root = ROOT, log = console.log } = {}) {
  const options = parse(argv);
  if (options.help) { log(USAGE); return 0; }
  const chosen = select(goldenSets(root), options.filters), files = [...new Set([...chosen.values()].flatMap(entry => entry.tests))];
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'pixelbolt-goldens-')), report = { sets: [], notes: [] };
  try {
    const records = path.join(scratch, 'after');
    const run = files.length ? await runTests(root, files, { PIXELBOLT_GOLDENS_RECORD: records }) : { code: 0, output: '' };
    const { cases, clashes } = readRecords(records);
    report.tests = { files, passed: run.code === 0, ...(run.code !== 0 && { output: failures(run.output) }) };
    for (const id of clashes) report.notes.push(`${id.replace('#', ' ')} was recorded twice with different values`);
    for (const entry of chosen.values()) {
      const pinnedFile = path.join(root, entry.fixture), pinned = existsSync(pinnedFile) ? JSON.parse(readFileSync(pinnedFile, 'utf8')) : {};
      const recorded = [...cases.values()].filter(c => c.file === entry.fixture), list = [];
      if (!entry.tests.length) report.notes.push(`no test uses ${entry.fixture}; delete it if it is no longer needed`);
      for (const c of recorded) if (matches(entry.keys, c.key)) {
        const status = !Object.hasOwn(pinned, c.key) ? 'new' : isDeepStrictEqual(pinned[c.key], c.value) ? 'unchanged' : 'changed';
        list.push({ key: c.key, status, value: c.value, picture: c.picture, ...(status === 'changed' && { from: pinned[c.key], change: describeChange(pinned[c.key], c.value) }) });
      }
      for (const key of Object.keys(pinned)) if (matches(entry.keys, key) && !recorded.some(c => c.key === key)) list.push({ key, status: 'not reached', from: pinned[key] });
      report.sets.push({ ...entry, pinned, recorded, cases: list });
    }
    const moved = report.sets.flatMap(entry => entry.cases.filter(c => c.status === 'changed' || c.status === 'new').map(c => ({ entry, c })));
    if (options.images && moved.length) await drawBeforeAfter(root, options, scratch, records, moved, report);
    if (options.write) write(root, report);
    const pending = !options.write && report.sets.some(entry => entry.cases.some(c => c.status !== 'unchanged'));
    report.ok = report.tests.passed && !clashes.length && !pending && !report.refused;
    log(options.json ? JSON.stringify(summary(report, root), null, 2) : text(report, options));
    return report.ok ? 0 : 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

// The spec reporter's failure section (or the end of the output when it has none).
function failures(output) {
  const at = output.lastIndexOf('✖ failing tests:'), part = at >= 0 ? output.slice(at) : output.split('\n').slice(-60).join('\n');
  return part.length > 6000 ? `${part.slice(0, 6000)}\n…` : part;
}

async function drawBeforeAfter(root, options, scratch, records, moved, report) {
  const base = path.join(scratch, 'before');
  let before = new Map(), exported = null;
  try { exported = exportCommit(root, options.base, base); } catch (error) { report.notes.push(`no before images: git could not write out ${options.base} (${error.stderr?.trim() || error.message})`); }
  if (!exported && !report.notes.some(note => note.startsWith('no before images'))) report.notes.push(`no before images: ${options.base} is not a commit of a git checkout at ${root}`);
  else {
    report.base = { ref: options.base, commit: exported.commit };
    const files = [...new Set(moved.flatMap(({ entry }) => entry.tests))].filter(file => existsSync(path.join(exported.tree, file)));
    const list = path.join(scratch, 'wanted.json');
    writeFileSync(list, JSON.stringify(moved.map(({ entry, c }) => `${entry.fixture}#${c.key}`)));
    if (files.length) {
      const run = await runTests(exported.tree, files, { PIXELBOLT_GOLDENS_RECORD: path.join(base, 'records'), PIXELBOLT_GOLDENS_PICTURES: list });
      if (run.code !== 0) report.notes.push(`the golden tests failed at ${options.base}, so some before images may be missing`);
      before = readRecords(path.join(base, 'records')).cases;
    }
  }
  const { encodePNG } = await import('../src/png.js');
  let out = null;
  const folder = () => {
    if (out) return out;
    if (options.out) out = path.resolve(options.out);
    else {
      const parent = path.join(root, 'output', 'goldens');
      mkdirSync(parent, { recursive: true });
      out = mkdtempSync(path.join(parent, `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-`));
    }
    return out;
  };
  const label = exported ? `before: ${options.base} (${exported.commit.slice(0, 7)}), after: this checkout` : 'after: this checkout';
  // A commit from before scripts/goldens.mjs records nothing: say so once rather than for every case.
  if (exported && !before.size) report.notes.push(`${options.base} records no goldens, so there are no before pictures (pass --base <a later commit>)`);
  for (const { entry, c } of moved) {
    const old = before.get(`${entry.fixture}#${c.key}`);
    if (old && c.status === 'changed' && !isDeepStrictEqual(old.value, c.from)) c.note = `${options.base} does not give the pinned value either, so "before" is ${options.base}'s output`;
    if (!c.picture || c.picture.none) { c.note ??= 'no picture: the test draws none for this case'; continue; }
    if (c.picture.error) { c.note = `no picture: ${c.picture.error}`; continue; }
    const now = loadFrames(records, c.picture), earlier = loadFrames(path.join(base, 'records'), old?.picture);
    if (before.size && c.status === 'changed' && !earlier) c.note ??= old?.picture?.error ? `no before picture: ${old.picture.error}` : `no before picture: ${options.base} has no such case`;
    const sheet = await comparison(earlier, now, `${entry.set}/${c.key}`, label);
    c.frames = { count: sheet.count, ...(earlier && { differ: sheet.differ }), ...(sheet.omitted && { omitted: sheet.omitted }) };
    if (earlier && !sheet.differ) { c.note ??= 'the pixels are the same: only the data its hash covers changed'; continue; }
    const name = c.key.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'case';
    mkdirSync(path.join(folder(), entry.set), { recursive: true });
    c.images = sheet.pages.map((page, i) => {
      const file = path.join(folder(), entry.set, `${name}${i ? `-${i + 1}` : ''}.png`);
      writeFileSync(file, encodePNG(page.data, page.width, page.height));
      return file;
    });
  }
  if (out) report.images = out;
}

function write(root, report) {
  if (!report.tests.passed) { report.refused = 'the golden tests failed; fix them first'; return; }
  report.written = [];
  for (const entry of report.sets) {
    const changes = entry.cases.filter(c => c.status !== 'unchanged');
    if (!changes.length || !entry.tests.length) continue;
    const target = path.resolve(root, entry.fixture);
    // Only test/goldens is ever written: the frozen baseline and every other file stay as they are.
    if (path.relative(path.join(root, 'test', 'goldens'), path.dirname(target)) !== '' || path.basename(target) === 'figures-baseline.json') throw new Error(`refusing to write ${entry.fixture}`);
    let next;
    // A whole set is written in the order its tests check it; a chosen case is changed in place.
    if (!entry.keys) next = Object.fromEntries(entry.recorded.map(c => [c.key, c.value]));
    else {
      next = { ...entry.pinned };
      for (const c of changes) if (c.status === 'not reached') delete next[c.key]; else next[c.key] = c.value;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(next, null, 2)}\n`);
    const count = status => changes.filter(c => c.status === status).length;
    report.written.push({ fixture: entry.fixture, changed: count('changed'), added: count('new'), removed: count('not reached') });
  }
}

function summary(report, root) {
  return {
    ok: report.ok,
    tests: report.tests,
    ...(report.base && { base: report.base }),
    ...(report.images && { images: unix(path.relative(root, report.images)) }),
    sets: report.sets.map(entry => ({
      set: entry.set, fixture: entry.fixture, tests: entry.tests,
      cases: entry.cases.map(({ key, status, change, frames, images, note }) => ({ key, status, ...(change && { change }), ...(frames && { frames }), ...(images && { images: images.map(file => unix(path.relative(root, file))) }), ...(note && { note }) }))
    })),
    ...(report.written && { written: report.written }),
    ...(report.refused && { refused: report.refused }),
    ...(report.notes.length && { notes: report.notes })
  };
}

function text(report, options) {
  const lines = [], shown = file => unix(path.relative(process.cwd(), file));
  const total = report.sets.reduce((n, entry) => n + entry.cases.length, 0), quiet = [];
  lines.push(`Ran the golden tests in ${report.tests.files.length} files: ${total} cases${report.tests.passed ? '' : '. SOME TESTS FAILED'}.`);
  if (report.images) lines.push(`Before and after images are in ${shown(report.images)}/`);
  for (const entry of report.sets) {
    const moved = entry.cases.filter(c => c.status !== 'unchanged');
    if (!moved.length) { quiet.push(`${entry.set} (${entry.cases.length})`); continue; }
    const counts = {};
    for (const c of entry.cases) counts[c.status] = (counts[c.status] ?? 0) + 1;
    lines.push(`${entry.set} (${entry.fixture}): ${Object.entries(counts).map(([status, n]) => `${n} ${status}`).join(', ')}`);
    for (const c of moved) {
      const f = c.frames, frames = !f ? '' : f.differ === undefined ? `; ${f.count} frames` : `; ${f.differ} of ${f.count} frames differ${f.omitted ? ` (the last ${f.omitted} not drawn)` : ''}`;
      lines.push(`  ${c.status.padEnd(11)} ${c.key}${c.change ? `: ${c.change}` : ''}${frames}`);
      if (c.images?.length) lines.push(`              ${unix(path.relative(report.images, c.images[0]))}${c.images.length > 1 ? ` and ${c.images.length - 1} more ${c.images.length > 2 ? 'pages' : 'page'}` : ''}`);
      if (c.note) lines.push(`              ${c.note}`);
    }
  }
  if (quiet.length) lines.push(`Unchanged: ${quiet.join(', ')}.`);
  for (const note of report.notes) lines.push(`Note: ${note}.`);
  if (!report.tests.passed) lines.push('', 'The golden tests failed, so cases after a failure were not reached:', report.tests.output ?? '');
  if (report.refused) lines.push(`Nothing written: ${report.refused}.`);
  for (const w of report.written ?? []) lines.push(`Wrote ${w.fixture}: ${[w.changed && `${w.changed} changed`, w.added && `${w.added} added`, w.removed && `${w.removed} removed`].filter(Boolean).join(', ')}.`);
  if (report.written && !report.written.length) lines.push('Nothing to write: every chosen case matches its golden.');
  if (!options.write && report.sets.some(entry => entry.cases.some(c => c.status !== 'unchanged'))) {
    const look = report.sets.some(entry => entry.cases.some(c => c.images?.length)) ? 'Look at the images. ' : '';
    lines.push(`${look}If the change is meant: node scripts/goldens.mjs --write${options.filters.length ? ` ${options.filters.join(' ')}` : ''}`);
  }
  return lines.join('\n');
}

// ---- Before and after sheets ------------------------------------------------------------------------------------------

const PAGE_HEIGHT = 1800, PAGE_WIDTH = 1400, MOST_PAGES = 8, GAP = 6, LINE = 11;
const INK = [232, 232, 236], DIM = [150, 152, 160], PAPER = [30, 31, 38];
// For each frame that differs, a row of before | after | changed: the changed panel shows the frame faintly in grey and
// every pixel that differs in magenta. A missing frame (new or gone) is an empty dark cell.
async function comparison(before, after, title, subtitle) {
  const { layoutText, FONT_CHARACTERS } = await import('../src/font.js');
  const count = Math.max(before?.length ?? 0, after?.length ?? 0), rows = [];
  for (let i = 0; i < count; i++) {
    const a = before?.[i], b = after?.[i];
    if (!a || !b || a.width !== b.width || a.height !== b.height || Buffer.compare(a.data, b.data) !== 0) rows.push({ index: i, a, b });
  }
  if (!rows.length) return { count, differ: 0, pages: [] };
  const w = Math.max(...rows.flatMap(({ a, b }) => [a?.width ?? 0, b?.width ?? 0])), h = Math.max(...rows.flatMap(({ a, b }) => [a?.height ?? 0, b?.height ?? 0]));
  // With nothing before, each frame is shown once, as it is now.
  const panels = before ? ['before', 'after', 'changed'] : ['after'];
  const scale = Math.max(1, Math.min(8, Math.floor(160 / Math.max(w, h)))), cw = w * scale, ch = h * scale;
  const group = panels.length * (cw + GAP) + GAP, across = Math.max(1, Math.min(before ? 4 : 8, Math.floor((PAGE_WIDTH - GAP) / group)));
  const head = 3 * LINE + 2 * GAP, rowHeight = LINE + ch + GAP, perPage = across * Math.max(1, Math.floor((PAGE_HEIGHT - head) / rowHeight));
  const drawn = rows.slice(0, perPage * MOST_PAGES), pageCount = Math.ceil(drawn.length / perPage), pages = [], glyphs = new Set(FONT_CHARACTERS);
  const write = (page, words, x, y, [r, g, b], room = page.width - x - GAP) => {
    let line = [...words].map(c => glyphs.has(c) ? c : '?').join('');
    while (line && layoutText(line).width > room) line = line.slice(0, -1);
    if (line) layoutText(line).rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === '#') blend(page, x + i, y + j, r, g, b, 255); });
  };
  for (let p = 0; p < pageCount; p++) {
    const chunk = drawn.slice(p * perPage, (p + 1) * perPage), width = Math.max(GAP + Math.min(across, chunk.length) * group, 360);
    const page = { width, height: head + Math.ceil(chunk.length / across) * rowHeight, data: null };
    page.data = new Uint8Array(page.width * page.height * 4);
    for (let i = 0; i < page.data.length; i += 4) page.data.set([...PAPER, 255], i);
    write(page, `${title}: ${before ? `${rows.length} of ${count} frames differ` : `${count} frames, no before`}${pageCount > 1 ? ` (page ${p + 1} of ${pageCount})` : ''}`, GAP, GAP, INK);
    write(page, subtitle, GAP, GAP + LINE, DIM);
    for (let g = 0; g < Math.min(across, chunk.length); g++) panels.forEach((word, k) => write(page, word, GAP + g * group + k * (cw + GAP), GAP + 2 * LINE, DIM, cw));
    chunk.forEach(({ index, a, b }, n) => {
      const x = GAP + (n % across) * group, y = head + Math.floor(n / across) * rowHeight;
      const tag = !before ? '' : !a ? ' (new)' : !b ? ' (gone)' : a.width !== b.width || a.height !== b.height ? ` (${a.width}x${a.height} to ${b.width}x${b.height})` : '';
      write(page, `${index + 1}. ${(b ?? a).name ?? ''}${tag}`, x, y, INK, group - 2 * GAP);
      if (!before) { cell(page, x, y + LINE, cw, ch, scale, b); return; }
      cell(page, x, y + LINE, cw, ch, scale, a);
      cell(page, x + cw + GAP, y + LINE, cw, ch, scale, b);
      changes(page, x + 2 * (cw + GAP), y + LINE, cw, ch, scale, a, b);
    });
    pages.push(page);
  }
  return { count, differ: rows.length, pages, ...(drawn.length < rows.length && { omitted: rows.length - drawn.length }) };
}
function blend(page, x, y, r, g, b, a) {
  if (!a || x < 0 || y < 0 || x >= page.width || y >= page.height) return;
  const at = (y * page.width + x) * 4, d = page.data, keep = 255 - a;
  d[at] = (r * a + d[at] * keep) / 255; d[at + 1] = (g * a + d[at + 1] * keep) / 255; d[at + 2] = (b * a + d[at + 2] * keep) / 255; d[at + 3] = 255;
}
// A light checkerboard under each frame shows transparency, as pixel editors do.
function cell(page, x0, y0, cw, ch, scale, frame) {
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    if (!frame) { blend(page, x0 + x, y0 + y, PAPER[0] + 14, PAPER[1] + 14, PAPER[2] + 14, 255); continue; }
    const light = ((x >> 3) + (y >> 3)) & 1 ? 200 : 236, fx = Math.floor(x / scale), fy = Math.floor(y / scale);
    blend(page, x0 + x, y0 + y, light, light, light + 4, 255);
    if (fx < frame.width && fy < frame.height) {
      const at = (fy * frame.width + fx) * 4, d = frame.data;
      blend(page, x0 + x, y0 + y, d[at], d[at + 1], d[at + 2], d[at + 3]);
    }
  }
}
function changes(page, x0, y0, cw, ch, scale, a, b) {
  const read = (frame, x, y) => !frame || x >= frame.width || y >= frame.height ? null : (y * frame.width + x) * 4;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const fx = Math.floor(x / scale), fy = Math.floor(y / scale), i = read(a, fx, fy), j = read(b, fx, fy);
    const was = i === null ? [0, 0, 0, 0] : a.data.subarray(i, i + 4), now = j === null ? [0, 0, 0, 0] : b.data.subarray(j, j + 4);
    blend(page, x0 + x, y0 + y, 250, 250, 252, 255);
    if ((was[3] || now[3]) && (was[0] !== now[0] || was[1] !== now[1] || was[2] !== now[2] || was[3] !== now[3])) { blend(page, x0 + x, y0 + y, 255, 0, 200, 255); continue; }
    const shown = now[3] ? now : was, grey = Math.round(0.3 * shown[0] + 0.59 * shown[1] + 0.11 * shown[2]);
    blend(page, x0 + x, y0 + y, grey, grey, grey, Math.round(shown[3] * 0.35));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await runGoldens(process.argv.slice(2)); } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`${error.message}\n${USAGE}`);
    process.exitCode = 2;
  }
}
