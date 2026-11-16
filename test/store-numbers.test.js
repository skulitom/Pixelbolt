// Check the shipped inline workflow, including its public artifact boundary, without network access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const workflow = () => readFile(path.join(root, '.github/workflows/store-numbers.yml'), 'utf8');
const endpoint = 'https://api.itch.io/profile/games';
const readAt = '2026-11-16T05:37:00.000Z';
const secret = 'test-key-do-not-print';
const gate = "        if: steps.key.outputs.present == 'true'\n";
const secretEnv = '        env:\n          BUTLER_API_KEY: ${{ secrets.BUTLER_API_KEY }}\n';

function checkNumbersWorkflow(text) {
  text = text.replaceAll('\r\n', '\n');
  const opening = text.match(/^(?:#[^\n]*\n)+/)?.[0];
  assert.ok(opening, 'opening comment');
  assert.ok(opening.trimEnd().split('\n').length <= 8, 'short opening comment');
  for (const phrase of ['views and downloads', 'signed-in GitHub user', 'artifact', 'purchases', 'earnings', 'no key', 'passes and reads nothing']) {
    assert.ok(opening.includes(phrase), `opening explains ${phrase}`);
  }
  const code = text.split('\n').filter(line => !/^\s*(?:#|\/\/)/.test(line)).join('\n');
  assert.doesNotMatch(text, /pixelforge/i, 'current name only');
  assert.doesNotMatch(code, /:\s*write\b|write-all/, 'no write permissions');
  assert.doesNotMatch(code, /purchases|earnings|amount|email/i, 'no private fields in code');
  // The price is read once, to leave paid pages out, and never copied.
  assert.equal([...code.matchAll(/min_price/g)].length, 1, 'the price only decides');
  assert.ok(code.includes('game.min_price !== 0'), 'only free pages are saved');
  assert.doesNotMatch(code, /body\.games\.length/, 'the public summary does not count unsaved pages');
  assert.doesNotMatch(code, /\b(?:curl|gh|npm|npx)\b|actions\/(?:checkout|cache)\b/, 'no extra tools');
  assert.doesNotMatch(code, /set\s+-\S*x|set\s+-o\s+xtrace/, 'no shell tracing');
  assert.equal([...text.matchAll(/github\.repository\s*==/g)].length, 1, 'one repository guard');
  assert.equal([...code.matchAll(/^\s*permissions:/gm)].length, 2, 'workflow and job permissions only');

  const sections = code.split('\njobs:\n');
  assert.equal(sections.length, 2, 'one jobs section');
  assert.equal(sections[0].trim(), `name: Store numbers

on:
  schedule:
    - cron: '37 5 * * *'
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: store-numbers
  cancel-in-progress: false`, 'daily schedule, dispatch and read-only workflow');
  const jobs = Object.fromEntries(sections[1].split(/\n(?=  [a-z-]+:\n)/).map(block => [block.match(/^  ([a-z-]+):/)?.[1], block]));
  assert.deepEqual(Object.keys(jobs), ['itch'], 'only the itch job');
  const [job, stepsText, extra] = jobs.itch.split('\n    steps:\n');
  assert.equal(extra, undefined);
  assert.equal(job, `  itch:
    name: itch.io views and downloads
    if: github.repository == 'skulitom/Pixelbolt'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: read`, 'guarded job with timeout and read-only permissions');
  assert.ok(stepsText, 'steps exist');
  const steps = stepsText.split(/\n(?=      - )/);
  assert.equal(steps.length, 3, 'presence, read and upload only');
  const [presence, read, upload] = steps;
  assert.match(presence, /^      - name: Is the key there\?\n        id: key\n/);
  assert.match(read, /^      - name: Read and reduce\n/);
  assert.match(upload, /^      - name: Upload\n/);
  for (const step of [read, upload]) assert.ok(step.includes(gate), 'later steps require the key');
  assert.equal([...code.matchAll(/^\s*if:/gm)].length, 3, 'one job and two step guards');
  assert.equal([...text.matchAll(/secrets\./g)].length, 2, 'only two secret references');
  assert.equal([...code.matchAll(/^\s*env:/gm)].length, 2, 'only two step environments');
  for (const step of [presence, read]) assert.ok(step.includes(secretEnv), 'key only in step env');
  assert.doesNotMatch(upload, /\benv:|secrets\./, 'upload has no secret or environment');

  const runs = [...code.matchAll(/        run: \|\n((?:          .*\n|\n)+)/g)].map(match => match[1]);
  assert.equal(runs.length, 2, 'two inline scripts');
  for (const step of [presence, read]) assert.match(step, /        shell: bash\n/);
  for (const run of runs) {
    assert.match(run, /^          set -euo pipefail\n/, 'strict bash first');
    assert.doesNotMatch(run, /\$\{\{/, 'no expression interpolation in scripts');
  }
  assert.equal(runs[0].trimEnd(), `          set -euo pipefail
          if [[ -n "$BUTLER_API_KEY" ]]; then
            echo 'present=true' >> "$GITHUB_OUTPUT"
          else
            echo 'present=false' >> "$GITHUB_OUTPUT"
            echo '::notice::BUTLER_API_KEY is not set, so no itch.io numbers were read.'
          fi`, 'absent key produces only false and the notice, with no request');
  assert.equal([...read.matchAll(/node --input-type=module <<'NODE'\n/g)].length, 1);
  assert.equal([...read.matchAll(/\bfetch\s*\(/g)].length, 1, 'one request');
  assert.match(read, /fetch\(source, \{/);
  assert.match(read, /const source = 'https:\/\/api\.itch\.io\/profile\/games';/);
  assert.deepEqual(code.match(/https?:\/\/[a-z0-9][^\s'"`]+/g), [endpoint], 'only the bearer endpoint');
  assert.deepEqual([...read.matchAll(/\bmethod:\s*['"]([^'"]+)['"]/g)].map(match => match[1]), ['GET'], 'GET only');
  assert.ok(read.includes('headers: { Authorization: `Bearer ${process.env.BUTLER_API_KEY}` }'), 'bearer header');
  assert.match(read, /redirect: 'error'/, 'no redirects');
  assert.match(read, /signal: AbortSignal\.timeout\(30_000\)/, '30 second timeout');
  assert.match(read, /export function publicNumbers\(games, readAt\)/);
  assert.doesNotMatch(read, /\.\.\.\s*game\b|\bdelete\b/, 'build fields instead of copying API objects');

  const actions = [...code.matchAll(/uses:\s*(\S+)/g)].map(match => match[1]);
  assert.equal(actions.length, 1, 'upload is the only action');
  for (const action of actions) assert.match(action, /^actions\/[a-z/-]+@[a-f0-9]{40}$/, 'pinned first-party action');
  assert.match(upload, /uses: actions\/upload-artifact@[a-f0-9]{40}(?: #[^\n]*)?\n/);
  assert.match(upload, /        with:\n          name: itch-numbers\n          path: itch-numbers\.json\n          retention-days: 7\n          if-no-files-found: error\n?$/, 'one artifact, seven days, missing file fails');
  return { presence, read, upload, action: actions[0] };
}

test('store numbers has the required guards and the Studio upload pin', async () => {
  const text = await workflow(), checked = checkNumbersWorkflow(text);
  assert.doesNotMatch(text, /\r|^\uFEFF/, 'UTF-8 without BOM, LF lines');
  const studio = await readFile(path.join(root, '.github/workflows/studio-assets.yml'), 'utf8');
  assert.equal(checked.action, studio.match(/uses: (actions\/upload-artifact@[a-f0-9]{40})/)[1]);
});

test('store numbers structure rejects unsafe mutations', async t => {
  const text = await workflow();
  const mutants = [
    ['repository guard removed', text.replace("    if: github.repository == 'skulitom/Pixelbolt'\n", '')],
    ['another repository', text.replace("github.repository == 'skulitom/Pixelbolt'", "github.repository == 'other/Pixelbolt'")],
    ['workflow write permission', text.replace('  contents: read', '  contents: write')],
    ['job write permission', text.replace('      contents: read', '      contents: write')],
    ['read gate removed', text.replace(gate, '')],
    ['upload gate removed', text.replace('      - name: Upload\n' + gate, '      - name: Upload\n')],
    ['secret in upload', text.replace('      - name: Upload\n', '      - name: Upload\n' + secretEnv)],
    ['retention removed', text.replace('          retention-days: 7\n', '')],
    ['retention above seven', text.replace('retention-days: 7', 'retention-days: 8')],
    ['legacy key URL', text.replace(endpoint, 'https://itch.io/api/1/KEY/my-games')],
    ['private data in script', text.replace('const pages = [];', 'const pages = []; const purchases = 0;')],
    ['paid pages saved', text.replace('game.min_price !== 0 || ', '')],
    ['price copied', text.replace('views: game.views_count,', 'views: game.views_count, price: game.min_price,')],
    ['unsaved pages counted in public', text.replace('`Saved ${numbers.games.length} pages.\\n`', '`Saved ${numbers.games.length} of ${body.games.length} pages.\\n`')],
    ['third-party action', text.replace('actions/upload-artifact@', 'other/upload-artifact@')],
    ['unpinned action', text.replace(/actions\/upload-artifact@[a-f0-9]{40}/, 'actions/upload-artifact@v4')],
    ['run expression', text.replace('const pages = [];', 'const pages = []; const injected = "${{ github.actor }}";')],
    ['strict bash removed', text.replace('          set -euo pipefail\n', '')],
    ['shell tracing', text.replace('          set -euo pipefail\n', '          set -euo pipefail\n          set -x\n')],
    ['POST request', text.replace("method: 'GET'", "method: 'POST'")],
    ['redirects allowed', text.replace("redirect: 'error'", "redirect: 'follow'")],
    ['request timeout removed', text.replace('signal: AbortSignal.timeout(30_000)', 'signal: undefined')],
    ['job timeout removed', text.replace('    timeout-minutes: 5\n', '')],
    ['old project name', text + '# PixelForge\n'],
    ['extra command', text.replace('          NODE\n', '          NODE\n          curl https://example.com\n')]
  ];
  for (const [name, mutant] of mutants) await t.test(name, () => {
    assert.notEqual(mutant, text, 'mutation took effect');
    assert.throws(() => checkNumbersWorkflow(mutant), { name: 'AssertionError' });
  });
});

async function numbersChecks() {
  const text = await workflow();
  const code = text.split('// BEGIN numbers checks\n')[1].split('// END numbers checks')[0];
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

// The recorded API shape includes private fields to make accidental copying visible.
function gamesFixture() {
  const page = {
    id: 14, title: 'Pixelbolt tools', url: 'https://skulitom.itch.io/z-tools', published: true,
    views_count: 12345, downloads_count: 6789, purchases_count: 77, min_price: 0,
    earnings: [{ currency: 'USD', amount_formatted: '$19.00', amount: 1900 }], buyer_email: 'private@example.invalid',
    created_at: '2026-01-01', published_at: '2026-02-01', short_text: 'Private fixture marker'
  };
  const games = [
    page,
    { ...page, id: 15, published: false, url: 'https://skulitom.itch.io/draft' },
    { ...page, url: 'https://someone-else.itch.io/game' },
    { ...page, url: 'https://skulitom.itch.io.example.com/x' },
    { ...page, url: 'https://evilskulitom.itch.io/x' },
    { ...page, url: 'https://skulitom.itch.io/x/more' },
    { ...page, url: 'https://skulitom.itch.io/x?query=1' },
    { ...page, url: 'https://skulitom.itch.io/x#fragment' },
    { ...page, url: 'https://Skulitom.itch.io/x' },
    { ...page, url: 'https://skulitom.itch.io/x\n' },
    { ...page, url: 'https://skulitom.itch.io/' },
    { ...page, url: 'https://skulitom.itch.io/x//' },
    { ...page, url: 'https://skulitom.itch.io:443/x' },
    { ...page, url: 'https://user@skulitom.itch.io/x' },
    { ...page, id: 16, title: 'Older page', url: 'http://skulitom.itch.io/a_game-2/', views_count: 0, downloads_count: 0 },
    { ...page, published: 'true' },
    { ...page, id: 17, title: 'A'.repeat(119) + '\u{1f680}'.repeat(20), url: 'https://skulitom.itch.io/m-long/', views_count: Number.MAX_SAFE_INTEGER },
    { ...page, title: null },
    { ...page, url: null }, null,
    { ...page, id: 18, url: 'https://skulitom.itch.io/paid-pack', min_price: 499 },
    { ...page, id: 19, url: 'https://skulitom.itch.io/price-as-text', min_price: '0' },
    { ...page, id: 20, url: 'https://skulitom.itch.io/price-null', min_price: null },
    (({ min_price, ...rest }) => ({ ...rest, id: 21, url: 'https://skulitom.itch.io/price-missing' }))(page)
  ];
  for (const field of ['views_count', 'downloads_count']) {
    for (const value of [-1, 1.5, '12', null, undefined, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) games.push({ ...page, [field]: value });
    const missing = { ...page };
    delete missing[field];
    games.push(missing);
  }
  for (const id of [0, -1, 1.5, '14', undefined, Number.MAX_SAFE_INTEGER + 1]) games.push({ ...page, id });
  return games;
}

const expectedNumbers = {
  source: endpoint, read_at: readAt,
  games: [
    { id: 16, url: 'https://skulitom.itch.io/a_game-2', title: 'Older page', views: 0, downloads: 0 },
    { id: 17, url: 'https://skulitom.itch.io/m-long', title: 'A'.repeat(119) + '\u{1f680}', views: Number.MAX_SAFE_INTEGER, downloads: 6789 },
    { id: 14, url: 'https://skulitom.itch.io/z-tools', title: 'Pixelbolt tools', views: 12345, downloads: 6789 }
  ]
};

test('publicNumbers keeps only valid public owner pages and their five allowed fields', async () => {
  const { publicNumbers } = await numbersChecks(), games = gamesFixture(), original = structuredClone(games);
  assert.deepEqual(publicNumbers(games, readAt), expectedNumbers);
  assert.deepEqual(games, original, 'input objects and order stay intact');
  assert.deepEqual(publicNumbers([...games].reverse(), readAt), expectedNumbers, 'sort is independent of API order');
  assert.deepEqual(publicNumbers([], readAt), { source: endpoint, read_at: readAt, games: [] });
});

async function numbersScript() {
  const { read } = checkNumbersWorkflow(await workflow());
  return read.split("node --input-type=module <<'NODE'\n")[1].split('\n          NODE')[0]
    .replace(/^          /gm, '').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
}

async function runNumbers(t, scenario) {
  const folder = await mkdtemp(path.join(root, '.store-numbers-test-'));
  t.after(async () => {
    const relative = path.relative(root, folder);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
    await rm(folder, { recursive: true, force: true });
  });
  const env = { BUTLER_API_KEY: secret, GITHUB_OUTPUT: path.join(folder, 'output'), GITHUB_STEP_SUMMARY: path.join(folder, 'summary') };
  await writeFile(env.GITHUB_OUTPUT, '');
  await writeFile(env.GITHUB_STEP_SUMMARY, '');
  const calls = [], timeouts = [], stdout = [], stderr = [], signal = new AbortController().signal;
  const process = { env, exitCode: 0 };
  const local = file => {
    const resolved = path.resolve(folder, file), relative = path.relative(folder, resolved);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'writes stay in the test folder');
    return resolved;
  };
  const code = await numbersScript();
  await runInNewContext(`(async () => {\n${code}\n})()`, {
    process,
    Date: class extends Date { constructor() { super(readAt); } },
    AbortSignal: { timeout: ms => { timeouts.push(ms); return signal; } },
    fetch: async (url, options) => {
      calls.push({ url, method: options.method, headers: { ...options.headers }, redirect: options.redirect, signal: options.signal, keys: Object.keys(options).sort() });
      if (scenario.requestError) throw new Error(`Request details ${secret}`);
      return new Response(scenario.raw ?? JSON.stringify(scenario.body), { status: scenario.status ?? 200 });
    },
    writeFileSync: (file, data, options) => writeFileSync(local(file), data, options),
    appendFileSync: (file, data) => appendFileSync(local(file), data),
    console: { log: (...args) => stdout.push(args.join(' ')), error: (...args) => stderr.push(args.join(' ')), warn: (...args) => stderr.push(args.join(' ')) }
  });
  assert.deepEqual(calls, [{ url: endpoint, method: 'GET', headers: { Authorization: `Bearer ${secret}` }, redirect: 'error', signal, keys: ['headers', 'method', 'redirect', 'signal'] }], 'exactly one bearer GET');
  assert.deepEqual(timeouts, [30_000], 'timeout configured, without waiting on a clock');
  const summary = await readFile(env.GITHUB_STEP_SUMMARY, 'utf8'), output = await readFile(env.GITHUB_OUTPUT, 'utf8');
  let json;
  try { json = await readFile(path.join(folder, 'itch-numbers.json'), 'utf8'); }
  catch (error) { assert.equal(error.code, 'ENOENT'); }
  for (const text of [stdout.join('\n'), stderr.join('\n'), summary, output, json ?? '']) assert.ok(!text.includes(secret), 'key never leaves the request header');
  assert.deepEqual(stdout, [], 'no logged numbers or titles');
  assert.equal(output, '', 'read step does not expose extra outputs');
  return { process, stderr, summary, json };
}

test('inline reader writes only the reduced artifact and one aggregate summary line', async t => {
  const games = gamesFixture(), result = await runNumbers(t, { body: { games, buyer_email: secret } });
  assert.equal(result.process.exitCode, 0);
  assert.deepEqual(result.stderr, []);
  assert.equal(result.json, JSON.stringify(expectedNumbers, null, 2) + '\n');
  assert.equal(result.summary, 'Saved 3 pages.\n');
});

test('inline reader accepts an empty public list', async t => {
  const result = await runNumbers(t, { body: { games: [] } });
  assert.equal(result.process.exitCode, 0);
  assert.deepEqual(result.stderr, []);
  assert.deepEqual(JSON.parse(result.json), { source: endpoint, read_at: readAt, games: [] });
  assert.equal(result.summary, 'Saved 0 pages.\n');
});

for (const [name, scenario, errorLine] of [
  ['API errors with HTTP 200', { body: { errors: ['invalid key', 'access denied'], games: gamesFixture(), buyer_email: secret } }, 'HTTP 200: invalid key; access denied'],
  ['API errors with HTTP 403', { status: 403, body: { errors: ['invalid key'], games: [] } }, 'HTTP 403: invalid key'],
  ['HTTP 403 with otherwise valid games', { status: 403, body: { games: gamesFixture(), buyer_email: secret } }, 'HTTP 403: request was rejected'],
  ['non-JSON body', { raw: `<html>${secret}</html>` }, 'HTTP 200: reply is not JSON'],
  ['non-JSON HTTP 403', { status: 403, raw: secret }, 'HTTP 403: reply is not JSON'],
  ['missing games', { body: { buyer_email: secret } }, 'HTTP 200: reply has no games array'],
  ['non-array games', { body: { games: {}, buyer_email: secret } }, 'HTTP 200: reply has no games array'],
  ['null body', { body: null }, 'HTTP 200: reply has no games array'],
  ['empty errors field', { body: { errors: [], games: [] } }, 'HTTP 200: API reported errors'],
  ['malformed errors field', { body: { errors: { buyer_email: secret }, games: [] } }, 'HTTP 200: API reported errors'],
  ['escaped error strings', { body: { errors: [`invalid ${secret}\r\n::notice::100%`] } }, 'HTTP 200: invalid [redacted]%0D%0A::notice::100%25'],
  ['request failure', { requestError: true }, 'HTTP unavailable: request failed']
]) test(`inline reader fails safely: ${name}`, async t => {
  const result = await runNumbers(t, scenario);
  assert.equal(result.process.exitCode, 1);
  assert.deepEqual(result.stderr, [`::error::${errorLine}`], 'one escaped error line with status');
  assert.equal(result.json, undefined, 'no artifact on failure');
  assert.equal(result.summary, '', 'no summary on failure');
});
