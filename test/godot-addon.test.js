// The Godot editor addon's packaging and workflows, with no Godot needed: the release zip (scripts/build-godot-addon.mjs)
// is deterministic and holds only the addon, under addons/pixelbolt/, stamped with this version; nothing under godot/ is
// JavaScript that `node --test` would pick up; and the two workflows keep their rights, pins and dry-run gate, checked
// against mutations. scripts/verify-godot-addon.mjs runs the addon itself in a real headless Godot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm, readdir, cp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { root, readZip } from '../scripts/build-studio.mjs';
import { ADDON, addonFiles, buildAddonZip, stampVersion } from '../scripts/build-godot-addon.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const workflow = name => readFile(path.join(root, '.github/workflows', name), 'utf8');
const version = async () => JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;

async function walk(folder) {
  const found = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) { if (entry.name !== '.godot') found.push(...await walk(file)); } else found.push(file);
  }
  return found;
}

// A checkout with only what the builder reads, so its rules can be tried on changed copies.
async function fixture(change = async () => {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-godot-zip-'));
  await cp(path.join(root, ADDON), path.join(base, ADDON), { recursive: true });
  await writeFile(path.join(base, 'package.json'), await readFile(path.join(root, 'package.json')));
  await change(base);
  return base;
}

test('plugin.cfg gets the release version on its one version line', () => {
  const cfg = '[plugin]\n\nname="Pixelbolt"\nversion="0.0.1"\nscript="plugin.gd"\n';
  assert.equal(stampVersion(cfg, '1.2.3'), cfg.replace('0.0.1', '1.2.3'));
  assert.throws(() => stampVersion(cfg.replace('version="0.0.1"\n', ''), '1.2.3'), /exactly one version/);
  assert.throws(() => stampVersion(cfg + 'version="2"\n', '1.2.3'), /exactly one version/);
  for (const bad of ['1.2', '1.2.3-beta.1', 'v1.2.3', '01.2.3', '']) assert.throws(() => stampVersion(cfg, bad), /Not a release version/);
});

test('the release zip holds the addon at addons/pixelbolt/, stamped with this version, and builds to the same bytes', async () => {
  const first = await buildAddonZip(), second = await buildAddonZip(), current = await version();
  assert.equal(first.name, `pixelbolt-godot-${current}.zip`);
  assert.ok(first.bytes.equals(second.bytes), 'two builds differ');
  assert.equal(first.checksum, `${sha256(first.bytes)}  ${first.name}\n`);
  const entries = readZip(first.bytes), names = [...entries.keys()];
  assert.deepEqual(names, [...names].sort(), 'entries are in sorted order');
  for (const name of names) assert.match(name, /^addons\/pixelbolt\/[^/]/);
  for (const needed of ['plugin.cfg', 'plugin.gd', 'LICENSE', 'README.md']) assert.ok(entries.has(`addons/pixelbolt/${needed}`), needed);
  const cfg = entries.get('addons/pixelbolt/plugin.cfg').read().toString();
  assert.match(cfg, /^name="Pixelbolt"$/m);
  assert.deepEqual(cfg.match(/^version="(.*)"$/gm), [`version="${current}"`]);
  assert.ok(entries.get('addons/pixelbolt/LICENSE').read().equals(Buffer.from((await readFile(path.join(root, 'LICENSE'), 'utf8')).replaceAll('\r\n', '\n'))), 'the LICENSE is the repository\'s');
  // Every file of the addon folder, and nothing else: no tests, demo or project files.
  const shipped = (await walk(path.join(root, ADDON))).map(file => `addons/pixelbolt/${path.relative(path.join(root, ADDON), file).split(path.sep).join('/')}`).sort();
  assert.deepEqual(names, shipped);
  for (const [name, entry] of entries) assert.ok(!entry.read().includes('\r\n'), `${name} has CRLF line endings`);
});

test('a CRLF checkout and an older plugin.cfg version give the same zip', async () => {
  const expected = await buildAddonZip(), base = await fixture(async base => {
    for (const file of await walk(path.join(base, ADDON))) {
      const text = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n').replaceAll('\n', '\r\n');
      await writeFile(file, path.basename(file) === 'plugin.cfg' ? text.replace(/version="[^"]*"/, 'version="0.0.1"') : text);
    }
  });
  try { assert.ok((await buildAddonZip({ base })).bytes.equals(expected.bytes)); } finally { await rm(base, { recursive: true, force: true }); }
});

test('the zip refuses files the addon must not ship and a missing plugin file', async () => {
  for (const [name, change, message] of [
    ['a binary', base => writeFile(path.join(base, ADDON, 'pixelbolt.dll'), 'MZ'), /not a file the addon ships/],
    ['an imported icon', base => writeFile(path.join(base, ADDON, 'icon.png'), 'png'), /not a file the addon ships/],
    ['no plugin.gd', base => rm(path.join(base, ADDON, 'plugin.gd')), /plugin\.gd is missing/],
    ['a prerelease version', base => writeFile(path.join(base, 'package.json'), JSON.stringify({ version: '1.0.0-rc.1' })), /Not a release version/]
  ]) {
    const base = await fixture(change);
    try { await assert.rejects(addonFiles({ base }), message, name); } finally { await rm(base, { recursive: true, force: true }); }
  }
});

test('godot/ holds no JavaScript, stays out of the npm package, and its tests are hidden from the demo project', async () => {
  // `npm test` is a bare `node --test`, whose default patterns take any script under a folder named test.
  const scripts = (await walk(path.join(root, 'godot'))).filter(file => /\.[cm]?js$/i.test(file));
  assert.deepEqual(scripts, []);
  const { files } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.deepEqual(files.filter(entry => /godot/i.test(entry)), []);
  assert.equal(await readFile(path.join(root, 'godot/tests/.gdignore'), 'utf8').then(() => true, () => false), true, 'godot/tests/.gdignore');
  // The demo enables the addon and renders with this checkout's own CLI.
  const project = await readFile(path.join(root, 'godot/project.godot'), 'utf8');
  assert.match(project, /^enabled=PackedStringArray\("res:\/\/addons\/pixelbolt\/plugin\.cfg"\)$/m);
  assert.match(project, /^cli\/path="\.\.\/bin\/pixelbolt\.js"$/m);
  assert.match(project, /^run\/main_scene="res:\/\/demo\/demo\.tscn"$/m);
  assert.match(await readFile(path.join(root, 'godot/demo/demo.tscn'), 'utf8'), /path="res:\/\/demo\/hero\.pixel\.json"/);
});

// ---- The test workflow ---------------------------------------------------------------------------------------------
const PATHS = ['godot/**', 'src/godot.js', 'src/tiled.js', 'src/export.js', 'bin/**', 'scripts/verify-godot.mjs', 'scripts/verify-godot-addon.mjs', 'scripts/build-godot-addon.mjs', '.github/workflows/godot-addon.yml'];
const GODOT_PIN = /curl -fsSL --proto '=https' --proto-redir '=https' --tlsv1\.2 --retry 3 "https:\/\/github\.com\/godotengine\/godot\/releases\/download\/4\.7\.2-stable\/\$GODOT_ZIP" -o godot\.zip\n {10}echo "\$GODOT_SHA512  godot\.zip" \| sha512sum -c\n/;
const PIN_ENV = /      GODOT_ZIP: Godot_v4\.7\.2-stable_linux\.x86_64\.zip\n      GODOT_SHA512: 9aa00f7a605200940bce3027a567b782f49bd8e940dd06ae9e987bd65aee1b1467edd56ed84fcdcbdd44354bf613bdbb4e5d2913e925850368e150c59ed54c65\n/;

// Each job is the text from its two-space-indented name to the next one, without comment lines.
function jobsOf(text) {
  const code = text.replaceAll('\r\n', '\n').split('\njobs:\n')[1].split('\n').filter(line => !/^\s*#/.test(line)).join('\n');
  return Object.fromEntries(code.split(/\n(?=  [a-z-]+:\n)/).map(block => [block.match(/^  ([a-z-]+):/)[1], block]));
}
// What both workflows keep: pinned first-party actions, credentials not kept by checkout, strict bash, no expressions
// inside scripts, no secrets, no write rights outside the named jobs, a time limit on every job, and the new name only.
function checkCommon(text, jobs, writers) {
  assert.doesNotMatch(text, /\r|^﻿/, 'UTF-8 without BOM, LF lines');
  assert.match(text.split('\njobs:')[0], /\npermissions:\n  contents: read\n/);
  assert.deepEqual(Object.entries(jobs).filter(([, block]) => /:\s*write\b/.test(block)).map(([name]) => name), writers);
  assert.doesNotMatch(text.split('\njobs:')[0], /:\s*write\b/);
  for (const block of Object.values(jobs)) assert.match(block, /\n    timeout-minutes: \d+\n/);
  for (const [, action] of text.matchAll(/uses:\s*(\S+)/g)) assert.match(action, /^actions\/[a-z/-]+@[a-f0-9]{40}$/);
  for (const [, block] of text.matchAll(/- uses: actions\/checkout@[^\n]+\n([\s\S]*?)(?=      - |\n  [a-z]|$)/g)) assert.match(block, /persist-credentials: false/);
  for (const [, run] of text.matchAll(/        run: \|\n((?:          .*\n|\n)+)/g)) assert.doesNotMatch(run, /\$\{\{/);
  for (const [, step] of text.matchAll(/        shell: bash\n([\s\S]*?)(?=      - |\n  [a-z]|$)/g)) assert.match(step, /run: \|\n          set -euo pipefail\n/);
  assert.doesNotMatch(text, /\bsecrets\b|set\s+-[a-z]*x\b|continue-on-error:|--clobber|gh\s+release\s+(edit|delete)|['"]release['"],\s*['"](?:edit|delete)['"]/i);
  assert.doesNotMatch(text, /pixelforge/i);
  assert.doesNotMatch(text, /\blatest\b(?!["'])(?<!ubuntu-latest)/i, 'no moving versions');
}

function checkTestWorkflow(text) {
  const jobs = jobsOf(text);
  assert.deepEqual(Object.keys(jobs), ['test']);
  checkCommon(text, jobs, []);
  const list = PATHS.map(item => `      - '${item}'\n`).join('');
  assert.ok(text.includes(`  push:\n    branches: [main]\n    paths:\n${list}  pull_request:\n    paths:\n${list}  workflow_dispatch:\n`), 'push and pull_request run on the addon\'s paths');
  assert.equal([...text.matchAll(/github\.repository\s*==/g)].length, 0);
  assert.match(jobs.test, PIN_ENV);
  assert.match(jobs.test, GODOT_PIN);
  const order = ['node scripts/verify-godot.mjs --godot "$GODOT"', 'node scripts/verify-godot-addon.mjs --godot "$GODOT"\n',
    'node scripts/build-godot-addon.mjs --out dist\n', 'node scripts/build-godot-addon.mjs --out dist --check\n',
    'node scripts/verify-godot-addon.mjs --godot "$GODOT" --install-zip "${zips[0]}"', 'name: pixelbolt-godot-zip'];
  const at = order.map(part => jobs.test.indexOf(part));
  assert.ok(at.every((value, i) => value >= 0 && (i === 0 || value > at[i - 1])), `the test job runs, in order: ${order.join(' | ')}`);
  assert.match(jobs.test, /if-no-files-found: error\n/);
  return jobs;
}

test('the Godot test workflow runs the addon\'s paths on a pinned, checked Godot and builds the zip as a release does', async () => {
  checkTestWorkflow(await workflow('godot-addon.yml'));
});

test('the Godot test workflow rejects unsafe or weaker mutations', async () => {
  const text = await workflow('godot-addon.yml');
  const mutants = [
    ['a write right', text.replace('    permissions:\n      contents: read\n', '    permissions:\n      contents: write\n')],
    ['a moving Godot', text.replace('releases/download/4.7.2-stable/', 'releases/latest/download/')],
    ['an unchecked download', text.replace(/ {10}echo "\$GODOT_SHA512  godot\.zip" \| sha512sum -c\n/g, '')],
    ['another hash', text.replace(/GODOT_SHA512: 9a/, 'GODOT_SHA512: 0a')],
    ['no reproduction check', text.replace('          node scripts/build-godot-addon.mjs --out dist --check\n', '')],
    ['no install check', text.replace(/ {10}node scripts\/verify-godot-addon\.mjs --godot "\$GODOT" --install-zip[^\n]+\n/, '')],
    ['no CLI export check', text.replace('          node scripts/verify-godot.mjs --godot "$GODOT"\n', '')],
    ['a path dropped from pull requests', text.replace(/(  pull_request:\n    paths:\n(?:      - '[^']+'\n)*?)      - 'src\/godot\.js'\n/, '$1')],
    ['an expression in a script', text.replace('node scripts/verify-godot-addon.mjs --godot "$GODOT"\n', 'node scripts/verify-godot-addon.mjs --godot "${{ env.GODOT }}"\n')],
    ['strict bash removed', text.replace('          set -euo pipefail\n', '')],
    ['credentials kept', text.replace('persist-credentials: false', 'persist-credentials: true')],
    ['an unpinned action', text.replace(/actions\/upload-artifact@[a-f0-9]{40}/, 'actions/upload-artifact@v4')],
    ['a secret', text.replace('    env:\n      GODOT_ZIP', '    env:\n      TOKEN: ${{ secrets.GITHUB_TOKEN }}\n      GODOT_ZIP')],
    ['no time limit', text.replace('    timeout-minutes: 25\n', '')],
    ['the old name', text + '# pixelforge\n']
  ];
  for (const [name, mutant] of mutants) { assert.notEqual(mutant, text, name); assert.throws(() => checkTestWorkflow(mutant), name); }
});

// ---- The release workflow ------------------------------------------------------------------------------------------
function checkReleaseWorkflow(text) {
  const jobs = jobsOf(text);
  assert.deepEqual(Object.keys(jobs), ['plan', 'build', 'upload']);
  checkCommon(text, jobs, ['upload']);
  assert.equal([...text.matchAll(/github\.repository\s*==/g)].length, 1);
  assert.match(jobs.plan, /\n    if: github\.repository == 'skulitom\/Pixelbolt'\n/);
  assert.equal(jobs.upload.match(/    permissions:\n((?:      [^\n]+\n)+)/)[1], '      contents: write\n');
  for (const name of ['plan', 'build']) assert.equal(jobs[name].match(/    permissions:\n((?:      [^\n]+\n)+)/)[1], '      contents: read\n', name);
  assert.match(jobs.build, /\n    needs: plan\n    if: needs\.plan\.outputs\.go == 'true'\n/);
  // Fail closed: the upload runs only when the plan said in so many words that this is not a dry run.
  assert.match(jobs.upload, /\n    needs: \[plan, build\]\n    if: needs\.plan\.outputs\.go == 'true' && needs\.plan\.outputs\.dry_run == 'false'\n/);
  // The upload job runs nothing from a checkout: it only compares and attaches the tested bytes.
  assert.doesNotMatch(jobs.upload, /\bnpx\b|\bnpm\b|node\s+--test|node scripts\/|actions\/checkout@/);
  assert.match(jobs.upload, /gh\('release', 'upload', tag, \.\.\.missing, '-R', repo\)/);
  assert.match(jobs.upload, /requireIdentical\(name, hash, readFileSync\(`existing\/\$\{name\}`\)\)/);
  // Every checkout is the planned tag, never the branch a dispatch or workflow_run would otherwise check out.
  const checkouts = [...text.matchAll(/- uses: actions\/checkout@[^\n]+\n([\s\S]*?)(?=      - |\n  [a-z]|$)/g)];
  assert.equal(checkouts.length, 1);
  for (const [, block] of checkouts) assert.match(block, /ref: refs\/tags\/\$\{\{ needs\.plan\.outputs\.tag \}\}\n/);
  assert.match(jobs.build, /test "\$\(git rev-parse HEAD\)" = "\$PLANNED_SHA"\n/);
  assert.match(jobs.build, /test "\$\(node -p "require\('\.\/package\.json'\)\.version"\)" = "\$VERSION"\n/);
  assert.match(jobs.build, PIN_ENV);
  assert.match(jobs.build, GODOT_PIN);
  const order = ['node scripts/build-godot-addon.mjs --out dist\n', 'node scripts/build-godot-addon.mjs --out dist --check\n', 'node scripts/verify-godot-addon.mjs --godot "$GODOT"\n',
    'node scripts/verify-godot-addon.mjs --godot "$GODOT" --install-zip "dist/pixelbolt-godot-$VERSION.zip"\n', 'name: pixelbolt-godot\n'];
  const at = order.map(part => jobs.build.indexOf(part));
  assert.ok(at.every((value, i) => value >= 0 && (i === 0 || value > at[i - 1])), `the build job runs, in order: ${order.join(' | ')}`);
  assert.match(text, /\non:\n  workflow_run:\n    workflows: \[Release\]\n    types: \[completed\]\n  workflow_dispatch:\n    inputs:\n      tag:\n[\s\S]*?required: true\n        type: string\n      dry_run:\n[\s\S]*?type: boolean\n        default: true\n/);
  assert.match(text, /\nrun-name: Godot addon release zip for \$\{\{ inputs\.tag \|\| github\.event\.workflow_run\.head_branch \}\}\n/);
  assert.match(text, /\n  group: godot-addon-release-\$\{\{ inputs\.tag \|\| github\.event\.workflow_run\.head_branch \}\}\n  cancel-in-progress: false\n/);
  assert.match(jobs.plan, /DRY_RUN: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.dry_run \}\}\n/);
  assert.doesNotMatch(jobs.plan, /workflow_run\.conclusion/);
  return jobs;
}

test('the Godot release zip keeps its rights in the upload job, builds from the tag and attaches only on a real run', async () => {
  checkReleaseWorkflow(await workflow('godot-addon-release.yml'));
});

test('the Godot release zip rejects unsafe mutations', async () => {
  const text = await workflow('godot-addon-release.yml');
  const mutants = [
    ['the repository guard removed', text.replace("    if: github.repository == 'skulitom/Pixelbolt'\n", '')],
    ['a write right in build', text.replace(/(  build:[\s\S]*?permissions:\n      contents:) read/, '$1 write')],
    ['a write right for the workflow', text.replace('permissions:\n  contents: read\n\nconcurrency', 'permissions:\n  contents: write\n\nconcurrency')],
    ['replacing assets', text.replace("gh('release', 'upload', tag, ...missing", "gh('release', 'upload', tag, '--clobber', ...missing")],
    ['the branch checked out', text.replace(/          ref: refs\/tags\/[^\n]+\n/, '')],
    ['the dry-run gate removed', text.replace(" && needs.plan.outputs.dry_run == 'false'", '')],
    ['the dry-run gate opened', text.replace("needs.plan.outputs.dry_run == 'false'", "needs.plan.outputs.dry_run != 'true'")],
    ['a moved tag allowed', text.replace('          test "$(git rev-parse HEAD)" = "$PLANNED_SHA"\n', '')],
    ['another version allowed', text.replace(/ {10}test "\$\(node -p[^\n]+\n/, '')],
    ['an untested zip', text.replace(/ {10}node scripts\/verify-godot-addon\.mjs --godot "\$GODOT" --install-zip[^\n]+\n/, '')],
    ['a checkout in the upload job', text.replace('      - uses: actions/download-artifact@', '      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6\n        with:\n          ref: refs/tags/${{ needs.plan.outputs.tag }}\n          persist-credentials: false\n      - uses: actions/download-artifact@')],
    ['no identity check of existing assets', text.replace("requireIdentical(name, hash, readFileSync(`existing/${name}`));\n", '')],
    ['dry runs on workflow_run', text.replace("github.event_name == 'workflow_dispatch' && inputs.dry_run", 'inputs.dry_run')],
    ['the run conclusion trusted', text.replace("output({ go: 'false' });", "output({ go: 'false' }); if (env.CONCLUSION === 'success') {} // github.event.workflow_run.conclusion")],
    ['a moving Godot', text.replace('releases/download/4.7.2-stable/', 'releases/latest/download/')],
    ['the old name', text + '# pixelforge\n']
  ];
  for (const [name, mutant] of mutants) { assert.notEqual(mutant, text, name); assert.throws(() => checkReleaseWorkflow(mutant), name); }
});

// The inline scripts themselves, run against stand-ins for gh, the output files and the disk.
async function script(job, step) {
  let block = checkReleaseWorkflow(await workflow('godot-addon-release.yml'))[job];
  if (step) block = block.split(/\n(?=      - )/).find(part => part.includes(`        id: ${step}\n`));
  return block.split("node --input-type=module <<'NODE'\n")[1].split('\n          NODE')[0]
    .replace(/^          /gm, '').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
}

test('the plan attaches nothing to tags without the addon, skips unpublished releases and peels tags', async () => {
  const code = await script('plan', 'plan'), sha = 'e1eb58000671d12bbfacd3add9240e1d0118656f';
  const scenarios = ['dispatch', 'release run', 'no addon', 'invalid', 'draft', 'missing release', 'annotated', 'forbidden', 'contents forbidden', 'wrong sha', 'wrong repository', 'wrong event'];
  for (const scenario of scenarios) {
    const env = { EVENT: 'workflow_dispatch', TAG: 'v0.20.0', DRY_RUN: 'true', GITHUB_OUTPUT: 'outputs', GITHUB_STEP_SUMMARY: 'summary' }, written = {}, calls = [];
    if (['release run', 'wrong sha', 'wrong repository', 'wrong event'].includes(scenario)) Object.assign(env, { EVENT: 'workflow_run', DRY_RUN: 'false', RUN_EVENT: 'push', RUN_REPO: 'skulitom/Pixelbolt', RUN_SHA: sha });
    if (scenario === 'invalid') env.TAG = 'main';
    if (scenario === 'wrong sha') env.RUN_SHA = 'a'.repeat(40);
    if (scenario === 'wrong repository') env.RUN_REPO = 'somewhere/else';
    if (scenario === 'wrong event') env.RUN_EVENT = 'pull_request';
    const gone = status => Object.assign(new Error(`HTTP ${status}`), { stderr: `gh: Not Found (HTTP ${status})` });
    const stop = new Error('exit zero');
    const execFileSync = (command, args) => {
      assert.equal(command, 'gh'); calls.push(args);
      const endpoint = args.at(-1);
      if (endpoint.includes('/git/ref/')) return JSON.stringify({ object: { type: scenario === 'annotated' ? 'tag' : 'commit', sha } });
      if (endpoint.includes('/git/tags/')) return JSON.stringify({ object: { type: 'commit', sha } });
      if (endpoint.includes('/releases/')) {
        if (scenario === 'missing release') throw gone(404);
        if (scenario === 'forbidden') throw gone(403);
        return JSON.stringify({ draft: scenario === 'draft', published_at: '2026-11-26T22:42:42Z' });
      }
      if (endpoint.includes('/contents/godot/addons/pixelbolt/plugin.cfg?ref=')) {
        assert.ok(endpoint.endsWith(`?ref=${sha}`), 'the addon is looked for at the tag\'s commit');
        if (scenario === 'no addon') throw gone(404);
        if (scenario === 'contents forbidden') throw gone(403);
        return JSON.stringify({ name: 'plugin.cfg' });
      }
      assert.fail(endpoint);
    };
    const invoke = () => runInNewContext(code, { process: { env, exit: n => { assert.equal(n, 0); throw stop; } }, execFileSync, appendFileSync: (file, data) => { written[file] = (written[file] ?? '') + data; } });
    if (['forbidden', 'contents forbidden', 'wrong sha', 'wrong repository', 'wrong event'].includes(scenario)) { assert.throws(invoke, error => error !== stop, scenario); continue; }
    try { invoke(); } catch (error) { assert.equal(error, stop, scenario); }
    const outputs = Object.fromEntries(written.outputs.trim().split('\n').map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)]; }));
    if (['no addon', 'invalid', 'draft', 'missing release'].includes(scenario)) {
      assert.equal(outputs.go, 'false', scenario);
      assert.match(written.summary, scenario === 'no addon' ? /^Nothing to attach: v0\.20\.0 \(e1eb5800[0-9a-f]+\) has no godot\/addons\/pixelbolt/ : /Skipped/, scenario);
    } else {
      assert.equal(outputs.go, 'true', scenario);
      assert.deepEqual([outputs.tag, outputs.version, outputs.sha], ['v0.20.0', '0.20.0', sha]);
      assert.equal(outputs.dry_run, scenario === 'release run' ? 'false' : 'true', scenario);
    }
    if (scenario === 'invalid') assert.equal(calls.length, 0);
  }
});

test('the upload checks the checksum and every existing asset before sending any, and skips identical reruns', async () => {
  const code = await script('upload'), tag = 'v0.20.0', ver = '0.20.0', zip = `pixelbolt-godot-${ver}.zip`;
  for (const scenario of ['missing', 'identical', 'one missing', 'conflict', 'draft', 'bad checksum']) {
    const bytes = Buffer.from('a checked addon zip'), sums = Buffer.from(scenario === 'bad checksum' ? `${'0'.repeat(64)}  ${zip}\n` : `${sha256(bytes)}  ${zip}\n`);
    const disk = new Map([[`artifacts/${zip}`, bytes], [`artifacts/${zip}.sha256`, sums]]), calls = [], errors = [], summaries = [];
    const process = { env: { TAG: tag, VERSION: ver, GITHUB_STEP_SUMMARY: 'summary' } };
    const assets = { missing: [], identical: [zip, `${zip}.sha256`], 'one missing': [zip], conflict: [zip], draft: [], 'bad checksum': [] }[scenario];
    const execFileSync = (command, args) => {
      assert.equal(command, 'gh'); calls.push(args);
      if (args[1] === 'view') return JSON.stringify({ isDraft: scenario === 'draft', publishedAt: '2026-11-26T22:42:42Z', assets: assets.map(name => ({ name })) });
      if (args[1] === 'download') {
        const name = args[args.indexOf('--pattern') + 1];
        disk.set(`existing/${name}`, scenario === 'conflict' ? Buffer.from('different') : disk.get(`artifacts/${name}`));
        return '';
      }
      assert.equal(args[1], 'upload'); return '';
    };
    runInNewContext(code, { process, createHash, execFileSync, readFileSync: file => { assert.ok(disk.has(file), file); return disk.get(file); }, mkdirSync: () => {}, appendFileSync: (_, data) => summaries.push(data), console: { error: e => errors.push(e) } });
    const uploads = calls.filter(args => args[1] === 'upload');
    if (scenario === 'missing') assert.deepEqual(uploads.map(args => [...args].filter(arg => arg.startsWith('artifacts/'))), [[`artifacts/${zip}`, `artifacts/${zip}.sha256`]]);
    else if (scenario === 'one missing') assert.deepEqual(uploads.map(args => [...args].filter(arg => arg.startsWith('artifacts/'))), [[`artifacts/${zip}.sha256`]]);
    else assert.equal(uploads.length, 0, scenario);
    if (['conflict', 'draft', 'bad checksum'].includes(scenario)) { assert.equal(process.exitCode, 1, scenario); assert.match(errors[0], /^::error::/); assert.equal(summaries.length, 0); }
    if (scenario === 'bad checksum') assert.equal(calls.length, 0, 'nothing is asked of GitHub before the checksum matches');
    if (scenario === 'identical') assert.equal((summaries[0].match(/Skipped identical asset:/g) ?? []).length, 2);
  }
});
