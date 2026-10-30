import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = (...args) => spawnSync(process.execPath, ['bin/pixelbolt.js', ...args], { cwd: root, encoding: 'utf8' });
const POWERSHELL = /Windows PowerShell 5\.1 drops the double quotes inside arguments: put the JSON in a \.json file and pass its name/;

// Windows PowerShell 5.1 hands '{"width":24}' to a program as {width:24}. These arguments reach Node with no shell in
// between, so each test sends exactly what that shell would.
test('--expect and --guides read inline JSON whose double quotes Windows PowerShell 5.1 stripped', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-json-option-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const check = (name, expect) => {
    const out = cli('render', 'examples/forest-spirit.json', '--out', path.join(dir, name), '--expect', expect);
    assert.equal(out.status, 0, out.stderr);
    return JSON.parse(out.stdout).check;
  };
  // A size and an opaque background the sprite doesn't have, so the check reports a mismatch for every field read.
  const quoted = check('quoted', '{"width":48,"height":48,"transparent":false}');
  assert.deepEqual(quoted.problems.map(problem => problem.asked), [{ width: 48, height: 48 }, 'an opaque background']);
  assert.deepEqual(check('stripped', '{width:48,height:48,transparent:false}'), quoted);
  // With a space PowerShell 5.1 wraps the argument in quotes of its own; Node still sees the keys bare.
  assert.deepEqual(check('spaced', '{width: 48, height: 48, transparent: false}'), quoted);
  const guides = value => {
    const out = cli('inspect', 'examples/shrine.json', '--guides', value);
    assert.equal(out.status, 0, out.stderr);
    return JSON.parse(out.stdout);
  };
  const nested = guides('{"horizon":12,"vanish":[[24,10]],"iso":{"tile":[8,4]}}');
  assert.deepEqual(nested.guides, { horizon: 12, vanish: [[24, 10]], iso: { tile: [8, 4], at: [0, 0] } });
  assert.deepEqual(guides('{horizon:12,vanish:[[24,10]],iso:{tile:[8,4]}}'), nested);
});

test('inline JSON that still fails says how to pass it when its quotes were stripped, and only then', () => {
  const refused = (...args) => {
    const out = cli(...args);
    assert.equal(out.status, 1, out.stdout);
    return JSON.parse(out.stderr);
  };
  // A bare word is no number or boolean, so quoting the keys back can't save it.
  for (const [option, value, command] of [['--expect', '{width:big}', 'render'], ['--guides', '{horizon:}', 'inspect']]) {
    const error = refused(command, command === 'render' ? 'examples/forest-spirit.json' : 'examples/shrine.json', ...(command === 'render' ? ['--out', path.join(os.tmpdir(), 'pixelbolt-never-written')] : []), option, value);
    assert.equal(error.path, option.slice(2));
    assert.match(error.error, new RegExp(`^${option}: expected JSON such as `));
    assert.match(error.error, POWERSHELL);
  }
  // Quotes present: an ordinary JSON mistake, with today's message and no word about PowerShell.
  const plain = refused('render', 'examples/forest-spirit.json', '--out', path.join(os.tmpdir(), 'pixelbolt-never-written'), '--expect', '{"width":}');
  assert.equal(plain.path, 'expect');
  assert.match(plain.error, /^--expect: expected JSON such as \{"width":32,"height":32\}: /);
  assert.doesNotMatch(plain.error, /PowerShell/);
});
