import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { assembleMcpb, buildMcpb, registryEntry, root } from '../scripts/build-mcpb.mjs';
import { readZip, writeZip, sha256 } from '../scripts/build-studio.mjs';
import { verifyMcpb } from '../scripts/verify-mcpb.mjs';

let temp, base, build, pkg, metadata, template;
const json = value => JSON.stringify(value, null, 2) + '\n';
const writeJSON = (file, value) => writeFile(file, json(value));
before(async () => {
  temp = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-mcpb-test-'));
  base = path.join(temp, 'source');
  build = await buildMcpb({ out: path.join(temp, 'first'), check: true });
  // A fixture lets release validation reject version disagreements without coupling ordinary tests to the
  // metadata version on main. package.json may be bumped independently until the release is prepared.
  for (const [file, entry] of readZip(build.bytes)) {
    if (file === 'manifest.json') continue;
    await mkdir(path.dirname(path.join(base, file)), { recursive: true });
    await writeFile(path.join(base, file), entry.read());
  }
  pkg = JSON.parse(await readFile(path.join(base, 'package.json')));
  metadata = { ...JSON.parse(await readFile(path.join(root, 'server.json'))), version: pkg.version };
  template = JSON.parse(await readFile(path.join(root, 'mcpb/manifest.json')));
  await mkdir(path.join(base, 'mcpb'));
  await writeJSON(path.join(base, 'mcpb/manifest.json'), template);
  await writeJSON(path.join(base, 'server.json'), metadata);
});
after(async () => {
  if (!temp) return;
  const relative = path.relative(path.resolve(os.tmpdir()), temp);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  await rm(temp, { recursive: true, force: true });
});

test('registry source is metadata-only with a short description', async () => {
  const server = JSON.parse(await readFile(path.join(root, 'server.json')));
  assert.equal(pkg.name, 'pixelbolt');
  // Every file a release names its version in agrees, as the release workflow's tag check requires.
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(JSON.parse(await readFile(path.join(root, '.claude-plugin', 'plugin.json'))).version, pkg.version, '.claude-plugin/plugin.json version');
  assert.equal(JSON.parse(await readFile(path.join(root, 'gemini-extension.json'))).version, pkg.version, 'gemini-extension.json version');
  assert.equal((await readFile(path.join(root, 'mcpb', 'RELEASE_NOTES.md'), 'utf8')).split('\n')[0].trim(), `# ${pkg.version}`);
  assert.deepEqual(pkg.bin, { pixelbolt: './bin/pixelbolt.js', pixelforge: './bin/pixelforge.js' });
  assert.equal(pkg.homepage, 'https://github.com/skulitom/Pixelbolt#readme');
  assert.equal(pkg.repository.url, 'git+https://github.com/skulitom/Pixelbolt.git');
  assert.equal(pkg.bugs.url, 'https://github.com/skulitom/Pixelbolt/issues');
  assert.equal(server.name, 'io.github.skulitom/pixelbolt');
  assert.equal(server.version, pkg.version);
  assert.equal(server.title, 'Pixelbolt pixel art toolkit');
  assert.equal(server.websiteUrl, pkg.homepage);
  assert.deepEqual(server.repository, { url: 'https://github.com/skulitom/Pixelbolt', source: 'github', id: '1389891909' });
  assert.equal(template.name, 'pixelbolt');
  assert.equal(template.display_name, 'Pixelbolt');
  assert.equal(template.server.entry_point, 'bin/pixelbolt.js');
  assert.deepEqual(template.server.mcp_config.args, ['${__dirname}/bin/pixelbolt.js', 'mcp', '--root', '${user_config.workspace}', '--out', '${user_config.workspace}/Pixelbolt']);
  assert.equal(server.$schema, 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json');
  assert.equal(Object.hasOwn(server, 'packages'), false);
  assert.ok(server.description.length <= 100);
  assert.equal(Object.hasOwn(template, 'version'), false);
});

test('the Gemini CLI extension runs its own copy of the server in the user\'s folder, beside the skill', async () => {
  // Gemini CLI's gallery lists the repository from this manifest at the root of each tagged release's source archive,
  // and `gemini extensions install` unpacks that archive; the name is the installed folder's and the one users type.
  const gemini = JSON.parse(await readFile(path.join(root, 'gemini-extension.json')));
  assert.equal(gemini.name, 'pixelbolt');
  assert.ok(gemini.description.length > 0);
  // No cwd: the server then starts in the folder Gemini CLI was opened in, so exports go to that project's output/,
  // as with the Claude Code plugin, and never into the installed extension.
  const server = gemini.mcpServers.pixelbolt;
  assert.equal(server.command, 'node');
  assert.deepEqual(server.args.slice(0, 2), ['${extensionPath}${/}bin${/}pixelbolt.js', 'mcp']);
  assert.equal(Object.hasOwn(server, 'cwd'), false);
  // Gemini CLI loads skills from skills/<name>/SKILL.md beside the manifest.
  assert.match(await readFile(path.join(root, 'skills/pixel-art/SKILL.md'), 'utf8'), /^---\nname: /);
});

test('release workflow guards and assets use the renamed repository', async () => {
  let guards = 0;
  for (const file of ['release.yml', 'publish-registry.yml', 'test.yml', 'studio-assets.yml']) {
    const text = await readFile(path.join(root, '.github/workflows', file), 'utf8');
    const matches = [...text.matchAll(/github\.repository\s*==\s*(['"])(.*?)\1/g)];
    assert.equal(matches.length, [...text.matchAll(/github\.repository\s*==/g)].length, file);
    for (const match of matches) { assert.equal(match[2], 'skulitom/Pixelbolt', file); guards++; }
    assert.doesNotMatch(text, /pixelforge/i);
    // The attachment workflow ships Studio archives, not the MCPB bundle.
    assert.ok(text.includes(file === 'studio-assets.yml' ? 'PixelboltStudio-' : 'pixelbolt.mcpb'), file);
    if (file === 'release.yml') { assert.ok(text.includes('name: pixelbolt-mcpb')); assert.ok(text.includes('--title "Pixelbolt $RELEASE_TAG"')); }
    if (file === 'publish-registry.yml') assert.ok(text.includes('io.github.skulitom%2Fpixelbolt'));
    if (file === 'test.yml') assert.ok(text.includes('PixelboltStudio-*'));
  }
  assert.equal(guards, 5);
});

function checkStudioWorkflow(text) {
  const code = text.replaceAll('\r\n', '\n').split('\njobs:\n')[1].split('\n').filter(line => !/^\s*#/.test(line)).join('\n');
  const jobs = Object.fromEntries(code.split(/\n(?=  [a-z-]+:\n)/).map(block => [block.match(/^  ([a-z-]+):/)[1], block]));
  assert.deepEqual(Object.keys(jobs), ['plan', 'build', 'report', 'upload']);
  assert.equal([...text.matchAll(/github\.repository\s*==/g)].length, 1);
  assert.match(jobs.plan, /if: github\.repository == 'skulitom\/Pixelbolt'/);
  assert.deepEqual(Object.entries(jobs).filter(([, block]) => /:\s*write\b/.test(block)).map(([name]) => name), ['upload']);
  assert.deepEqual(Object.entries(jobs).filter(([, block]) => /actions:\s*read\b/.test(block)).map(([name]) => name), ['plan']);
  assert.equal(jobs.upload.match(/    permissions:\n((?:      [^\n]+\n)+)/)[1], '      contents: write\n');
  assert.match(text.split('\njobs:')[0], /\npermissions:\n  contents: read\n/);
  assert.match(jobs.build, /needs: plan/);
  assert.match(jobs.report, /needs: \[plan, build\]/);
  assert.match(jobs.upload, /needs: \[plan, report\]/);
  // Fail closed: the upload runs only when the plan said in so many words that this is not a dry run.
  assert.match(jobs.upload, /if: needs\.plan\.outputs\.go == 'true' && needs\.plan\.outputs\.dry_run == 'false'\n/);
  assert.doesNotMatch(jobs.upload, /\bnpx\b|\bnpm\b|node\s+--test|verify-studio|qa-studio/);
  assert.doesNotMatch(text, /--clobber|gh\s+release\s+(edit|delete)|['"]release['"],\s*['"](?:edit|delete)['"]|pixelforge/i);
  for (const [, action] of text.matchAll(/uses:\s*(\S+)/g)) assert.match(action, /^actions\/[a-z/-]+@[a-f0-9]{40}$/);
  for (const [, block] of text.matchAll(/- uses: actions\/checkout@[^\n]+\n([\s\S]*?)(?=      - |\n  [a-z]|$)/g)) {
    assert.match(block, /ref: refs\/tags\//);
    assert.match(block, /persist-credentials: false/);
  }
  for (const block of Object.values(jobs)) assert.match(block, /    timeout-minutes:/);
  assert.match(text, /workflow_run:\n    workflows: \[Release\]\n    types: \[completed\]/);
  assert.match(text, /workflow_dispatch:\n    inputs:\n      tag:[\s\S]*?required: true\n        type: string\n      dry_run:[\s\S]*?type: boolean\n        default: true/);
  assert.match(text, /run-name: Studio release assets for \$\{\{ inputs.tag \|\| github.event.workflow_run.head_branch \}\}/);
  assert.match(text, /group: studio-assets-\$\{\{ inputs.tag \|\| github.event.workflow_run.head_branch \}\}\n  cancel-in-progress: false/);
  assert.doesNotMatch(jobs.plan, /workflow_run\.conclusion/);
  assert.doesNotMatch(text, /actions\/cache\/save@|run-id:|github-token:/);
  for (const [, run] of text.matchAll(/        run: \|\n((?:          .*\n|\n)+)/g)) assert.doesNotMatch(run, /\$\{\{/);
  for (const [, step] of text.matchAll(/        shell: bash\n([\s\S]*?)(?=      - |\n  [a-z]|$)/g)) assert.match(step, /run: \|\n          set -euo pipefail\n/);
  return jobs;
}

test('Studio attachment rights, tag refs and dry runs are guarded, including against mutations', async () => {
  const text = await readFile(path.join(root, '.github/workflows/studio-assets.yml'), 'utf8');
  checkStudioWorkflow(text);
  const mutants = [
    text.replace("    if: github.repository == 'skulitom/Pixelbolt'\n", ''),
    text.replace(/(  build:[\s\S]*?permissions:\n      contents:) read/, '$1 write'),
    text.replace("gh('release', 'upload', tag, ...missing", "gh('release', 'upload', tag, '--clobber', ...missing"),
    text.replace(/          ref: refs\/tags\/[^\n]+\n/, ''),
    text.replace(" && needs.plan.outputs.dry_run == 'false'", ''),
    text.replace("needs.plan.outputs.dry_run == 'false'", "needs.plan.outputs.dry_run != 'true'")
  ];
  for (const [i, mutant] of mutants.entries()) { assert.notEqual(mutant, text); assert.throws(() => checkStudioWorkflow(mutant), `mutant ${i + 1}`); }
});

// Exercise the actual inline code: older release tags do not carry a new helper script.
async function studioChecks(section) {
  const text = await readFile(path.join(root, '.github/workflows/studio-assets.yml'), 'utf8');
  const code = text.split(`// BEGIN ${section} checks\n`)[1].split(`// END ${section} checks`)[0];
  return import(`data:text/javascript;base64,${Buffer.from("import { createHash } from 'node:crypto';\n" + code).toString('base64')}`);
}

test('Studio Release logs require every occurrence of the exact archive hash to agree', async () => {
  const { printedHash, unavailable, stableTag } = await studioChecks('plan');
  // Trimmed real lines from Release 43539548933, Windows job 132287084837.
  const log = `2026-11-14T01:20:58.2233374Z 02d96c1e16f84327317d18212c0df17898d09466b7167b25ad01442e172ea370  PixelboltStudio-0.17.0-linux-x64.tar.gz
2026-11-14T01:20:58.2235110Z 72e8aa76eeec0e60ef6e7a7b147a82a6fe662bb50e2ff643b37926d72672445b  PixelboltStudio-0.17.0-win-x64.zip
2026-11-14T01:21:11.4551809Z 72e8aa76eeec0e60ef6e7a7b147a82a6fe662bb50e2ff643b37926d72672445b  PixelboltStudio-0.17.0-win-x64.zip
2026-11-14T01:21:11.4551809Z ##[group]Run verify`;
  const file = 'PixelboltStudio-0.17.0-win-x64.zip', hash = '72e8aa76eeec0e60ef6e7a7b147a82a6fe662bb50e2ff643b37926d72672445b';
  assert.equal(printedHash(log, file), hash);
  assert.equal(printedHash(log.replaceAll('\n', '\r\n'), file), hash);
  assert.throws(() => printedHash(log.replace(hash, 'a'.repeat(64)), file), /Conflicting/);
  assert.throws(() => printedHash(log, 'PixelboltStudio-0.17.1-win-x64.zip'), /No printed/);
  for (const status of [404, 410]) assert.equal(unavailable({ stderr: `gh: gone (HTTP ${status})` }), true);
  assert.equal(unavailable({ stderr: 'gh: forbidden (HTTP 403)' }), false);
  for (const tag of ['v0.17.0', 'v1.2.3']) assert.equal(stableTag(tag), true);
  for (const tag of ['main', 'v01.2.3', 'v1.2.3-beta', 'v1.2.3\n', 'v1.2.3;echo bad']) assert.equal(stableTag(tag), false);
});

test('Studio records, deterministic checksum list and upload checks reject changed or extra data', async () => {
  const { checkArchive, checksumList, targets } = await studioChecks('report');
  const { checkedFiles, requireIdentical } = await studioChecks('upload');
  const version = '0.17.0', tag = `v${version}`, sha = 'e1eb58000671d12bbfacd3add9240e1d0118656f', disk = new Map();
  const records = targets.map(target => {
    const bytes = Buffer.from(target), file = `PixelboltStudio-${version}-${target}.${target === 'win-x64' ? 'zip' : 'tar.gz'}`, hash = sha256(bytes);
    disk.set(`artifacts/studio-${target}/${file}`, bytes);
    const record = { target, file, bytes: bytes.length, sha256: hash, verify: 'pass', suite: 'pass', walk: target === 'darwin-x64' ? 'not run (translated browser under Rosetta)' : 'pass' };
    assert.deepEqual(checkArchive(target, version, bytes, `${hash}  ${file}\n`, record, hash), record);
    assert.deepEqual(checkArchive(target, version, bytes, `${hash}  ${file}\n`, record, null), record);
    assert.throws(() => checkArchive(target, version, bytes, `${hash}  ${file}`, record, 'f'.repeat(64)), /Release-run/);
    assert.throws(() => checkArchive(target, version, bytes, `${hash}  ${file}`, { ...record, bytes: 0 }, hash), /disagree/);
    assert.throws(() => checkArchive(target, version, bytes, `${hash}  ${file}`, { ...record, suite: 'not run (oops)' }, hash), /Invalid check/);
    return record;
  });
  const { text } = checksumList(tag, sha, records);
  assert.equal(checksumList(tag, sha, [...records].reverse()).text, text);
  assert.match(text, /# \| darwin-x64 \| pass \| pass \| not run \(translated browser under Rosetta\)/);
  const sumsPath = `artifacts/studio-sums/PixelboltStudio-${version}-SHA256SUMS.txt`;
  disk.set(sumsPath, Buffer.from(text));
  const read = file => { assert.ok(disk.has(file)); return disk.get(file); };
  const files = checkedFiles(version, tag, sha, read);
  assert.equal(files.size, 6);
  for (const [name, entry] of files) requireIdentical(name, entry.hash, read(entry.file));
  assert.throws(() => requireIdentical('existing.zip', records[0].sha256, Buffer.from('changed')), /different SHA-256/);
  disk.set(sumsPath, Buffer.from(text + `${'f'.repeat(64)}  unexpected.zip\n`));
  assert.throws(() => checkedFiles(version, tag, sha, read), /Unexpected/);
  disk.set(sumsPath, Buffer.from(text));
  disk.set(`artifacts/studio-win-x64/${records[0].file}`, Buffer.from('changed'));
  assert.throws(() => checkedFiles(version, tag, sha, read), /mismatch/);
});

async function studioScript(job) {
  const text = await readFile(path.join(root, '.github/workflows/studio-assets.yml'), 'utf8');
  const block = checkStudioWorkflow(text)[job];
  return block.split("node --input-type=module <<'NODE'\n")[1].split('\n          NODE')[0]
    .replace(/^          /gm, '').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
}

test('Studio plan skips unpublished or invalid releases, peels tags and tolerates only expired logs', async () => {
  const code = await studioScript('plan'), sha = 'e1eb58000671d12bbfacd3add9240e1d0118656f';
  for (const scenario of ['dispatch', 'failed Release', 'invalid', 'draft', 'missing release', 'annotated', 'no jobs', 'expired', 'forbidden', 'wrong sha', 'wrong repository', 'wrong event']) {
    const env = { EVENT: 'workflow_dispatch', TAG: 'v0.17.0', DRY_RUN: 'true', GITHUB_OUTPUT: 'outputs', GITHUB_STEP_SUMMARY: 'summary' }, written = {}, calls = [];
    if (['failed Release', 'wrong sha', 'wrong repository', 'wrong event'].includes(scenario)) Object.assign(env, { EVENT: 'workflow_run', DRY_RUN: 'false', RUN_EVENT: 'push', RUN_REPO: 'skulitom/Pixelbolt', RUN_SHA: sha, RUN_ID: '43539548933' });
    if (scenario === 'invalid') env.TAG = 'main';
    if (scenario === 'wrong sha') env.RUN_SHA = 'a'.repeat(40);
    if (scenario === 'wrong repository') env.RUN_REPO = 'somewhere/else';
    if (scenario === 'wrong event') env.RUN_EVENT = 'pull_request';
    const gone = status => Object.assign(new Error(`HTTP ${status}`), { stderr: `gh: unavailable (HTTP ${status})` });
    const stop = new Error('exit zero');
    const execFileSync = (command, args) => {
      assert.equal(command, 'gh'); calls.push(args);
      if (args[0] === 'run') return JSON.stringify([{ databaseId: 43539548933, headSha: sha, createdAt: '2026-11-14T01:16:09Z' }]);
      const endpoint = args.at(-1);
      if (endpoint.includes('/git/ref/')) return JSON.stringify({ object: { type: scenario === 'annotated' ? 'tag' : 'commit', sha } });
      if (endpoint.includes('/git/tags/')) return JSON.stringify({ object: { type: 'commit', sha } });
      if (endpoint.includes('/releases/')) {
        if (scenario === 'missing release') throw gone(404);
        return JSON.stringify({ draft: scenario === 'draft', published_at: '2026-11-14T01:42:42Z' });
      }
      if (endpoint.includes('/jobs?')) return JSON.stringify([{ jobs: scenario === 'no jobs' ? [] : [{ id: 132287084837, name: 'Full test matrix / Portable Studio / win-x64' }] }]);
      if (endpoint.endsWith('/logs')) {
        if (scenario === 'expired') throw gone(410);
        if (scenario === 'forbidden') throw gone(403);
        return '2026-11-14T01:21:11.4551809Z 72e8aa76eeec0e60ef6e7a7b147a82a6fe662bb50e2ff643b37926d72672445b  PixelboltStudio-0.17.0-win-x64.zip\n';
      }
      assert.fail(endpoint);
    };
    const invoke = () => runInNewContext(code, { process: { env, exit: n => { assert.equal(n, 0); throw stop; } }, execFileSync, appendFileSync: (file, data) => { written[file] = (written[file] ?? '') + data; } });
    if (['forbidden', 'wrong sha', 'wrong repository', 'wrong event'].includes(scenario)) { assert.throws(invoke); continue; }
    try { invoke(); } catch (error) { assert.equal(error, stop); }
    const outputs = Object.fromEntries(written.outputs.trim().split('\n').map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)]; }));
    if (['invalid', 'draft', 'missing release'].includes(scenario)) { assert.equal(outputs.go, 'false'); assert.match(written.summary, /Skipped/); }
    else {
      assert.equal(outputs.go, 'true'); assert.equal(outputs.sha, sha);
      assert.equal(outputs.dry_run, scenario === 'failed Release' ? 'false' : 'true');
      const expected = JSON.parse(outputs.expected);
      assert.equal(expected['linux-x64'], null);
      assert.equal(expected['win-x64'] === null, ['no jobs', 'expired'].includes(scenario));
      assert.match(written.summary, /no Release-run/);
    }
    if (scenario === 'invalid') assert.equal(calls.length, 0);
  }
});

test('Studio upload checks all existing assets before sending any and skips identical reruns', async () => {
  const code = await studioScript('upload'), { checksumList, targets } = await studioChecks('report');
  const tag = 'v0.17.0', version = '0.17.0', sha = 'e1eb58000671d12bbfacd3add9240e1d0118656f';
  for (const scenario of ['missing', 'identical', 'conflict', 'draft']) {
    const disk = new Map(), calls = [], errors = [], summaries = [];
    const records = targets.map(target => {
      const file = `PixelboltStudio-${version}-${target}.${target === 'win-x64' ? 'zip' : 'tar.gz'}`, bytes = Buffer.from(target);
      disk.set(`artifacts/studio-${target}/${file}`, bytes);
      return { file, target, bytes: bytes.length, sha256: sha256(bytes), verify: 'pass', suite: 'pass', walk: 'pass' };
    });
    const sums = `PixelboltStudio-${version}-SHA256SUMS.txt`;
    disk.set(`artifacts/studio-sums/${sums}`, Buffer.from(checksumList(tag, sha, records).text));
    const process = { env: { TAG: tag, VERSION: version, SHA: sha, GITHUB_STEP_SUMMARY: 'summary' } };
    const execFileSync = (command, args) => {
      assert.equal(command, 'gh'); calls.push(args);
      if (args[1] === 'view') return JSON.stringify({ isDraft: scenario === 'draft', publishedAt: '2026-11-14T01:42:42Z', assets: scenario === 'missing' ? [] : scenario === 'conflict' ? [{ name: sums }] : [...records, { file: sums }].map(r => ({ name: r.file })) });
      if (args[1] === 'download') {
        const name = args[args.indexOf('--pattern') + 1], entry = [...disk].find(([file]) => file.endsWith('/' + name));
        disk.set(`existing/${name}`, scenario === 'conflict' ? Buffer.from('different') : entry[1]);
        return '';
      }
      assert.equal(args[1], 'upload'); return '';
    };
    runInNewContext(code, { process, createHash, execFileSync, readFileSync: file => { assert.ok(disk.has(file)); return disk.get(file); }, mkdirSync: () => {}, appendFileSync: (_, data) => summaries.push(data), console: { error: e => errors.push(e) } });
    const uploads = calls.filter(args => args[1] === 'upload');
    if (scenario === 'missing') { assert.equal(uploads.length, 1); assert.equal(uploads[0].filter(arg => arg.startsWith('artifacts/')).length, 6); }
    else assert.equal(uploads.length, 0);
    if (['conflict', 'draft'].includes(scenario)) { assert.equal(process.exitCode, 1); assert.match(errors[0], /^::error::/); assert.equal(summaries.length, 0); }
    if (scenario === 'identical') assert.equal((summaries[0].match(/Skipped identical asset:/g) ?? []).length, 6);
  }
});

test('release rights stay in jobs that run only this repository\'s code, after the full test matrix passes', async () => {
  const text = await readFile(path.join(root, '.github/workflows/release.yml'), 'utf8');
  // Each job is the text from its two-space-indented name to the next one, without comment lines.
  const code = text.split('\njobs:\n')[1].split('\n').filter(line => !/^\s*#/.test(line)).join('\n');
  const jobs = Object.fromEntries(code.split(/\n(?=  [a-z-]+:\n)/).map(block => [block.match(/^  ([a-z-]+):/)[1], block]));
  assert.deepEqual(Object.keys(jobs), ['tests', 'build', 'release', 'npm', 'npm-check']);
  const rights = Object.entries(jobs).filter(([, block]) => /:\s*write\b/.test(block)).map(([name]) => name);
  assert.deepEqual(rights, ['release', 'npm']);
  for (const name of rights) {
    assert.doesNotMatch(jobs[name], /\bnpx\b|npm test|node --test|verify-mcpb/, name);
    for (const [, action, ref] of jobs[name].matchAll(/uses: ([^@\s]+)@(\S+)/g)) assert.match(`${action}@${ref}`, /^actions\/[a-z-]+@[0-9a-f]{40}$/, name);
  }
  assert.match(jobs.tests, /uses: \.\/\.github\/workflows\/test\.yml/);
  assert.match(await readFile(path.join(root, '.github/workflows/test.yml'), 'utf8'), /^  workflow_call:/m);
  assert.match(jobs.release, /needs: \[tests, build\]/);
  // The release job attests its own rebuild, and only when it matches the bundle the build job verified, whose hash
  // is recorded before npx runs.
  assert.match(jobs.release, /node scripts\/build-mcpb\.mjs\n[\s\S]*"\$actual" != "\$VERIFIED_SHA256"[\s\S]*attest-build-provenance/);
  assert.ok(jobs.build.indexOf('id: bundle') < jobs.build.indexOf('npx --yes'));
  for (const file of ['package.json', 'server.json', '.claude-plugin/plugin.json', 'gemini-extension.json', 'mcpb/RELEASE_NOTES.md']) assert.ok(jobs.build.includes(`'${file}'`), `the tag check reads ${file}`);
});

test('MCPB builds are byte-identical, including across CRLF and LF checkouts', async () => {
  const second = await buildMcpb({ base, out: path.join(temp, 'second') });
  assert.deepEqual(second.bytes, build.bytes);
  assert.equal(await readFile(`${build.bundle}.sha256`, 'utf8'), `${sha256(build.bytes)}  pixelbolt.mcpb\n`);
  assert.deepEqual(JSON.parse(await readFile(path.join(temp, 'first/manifest.json'))), build.manifest);
  const file = path.join(base, 'src/mcp.js'), original = await readFile(file, 'utf8');
  try {
    await writeFile(file, original.replace(/\n/g, '\r\n'));
    assert.deepEqual((await assembleMcpb({ base })).bytes, build.bytes);
  } finally { await writeFile(file, original); }
  const files = readZip(build.bytes);
  assert.ok(files.has('bin/pixelbolt.js'));
  assert.ok(files.has('bin/pixelforge.js'));
  assert.ok(files.has('studio/scene-player.js'));
  for (const file of ['src/mcp-app.js', 'src/mcp-app-model.js', 'src/mcp-preview.js']) assert.ok(files.has(file), file);
  for (const excluded of ['src/server.js', 'studio/index.html', 'server.json', 'scripts/build-mcpb.mjs', 'docs/PUBLISHING.md']) assert.equal(files.has(excluded), false, excluded);
});

test('the bundle serves the self-contained MCP Apps resource and builds preview metadata without an SDK', async () => {
  const { viewerHTML } = await import(pathToFileURL(path.join(base, 'src/mcp-app.js')).href);
  const { previewMeta } = await import(pathToFileURL(path.join(base, 'src/mcp-preview.js')).href);
  assert.match(viewerHTML(pkg.version), /^<!DOCTYPE html>/);
  assert.match(viewerHTML(pkg.version), /ui\/initialize/);
  const project = { width: 1, height: 1, frames: [{ name: 'dot', duration: 100, data: Uint8Array.of(255, 0, 0, 255) }], animations: {} };
  assert.equal(previewMeta(project)._meta['io.github.skulitom/pixelbolt'].preview.frames.length, 1);
});

test('the bundle carries every preset, so its presets topics and pixel_compile preset work as installed', async () => {
  const bundled = await import(pathToFileURL(path.join(base, 'src/presets.js')).href);
  const shipped = await import('../src/presets.js');
  assert.deepEqual((await bundled.presetEntries()).map(entry => entry.file), (await shipped.presetEntries()).map(entry => entry.file));
  // Every preset that names another file compiles from the bundle as it does here (the bundle ships only top-level
  // examples), and so does a self-contained one.
  for (const entry of await shipped.presetEntries()) {
    const here = await shipped.loadPreset(entry);
    if (!here.inlined.length && entry.file !== 'smoke-puff.fluid.json') continue;
    const there = await bundled.loadPreset(await bundled.findPreset(entry.name));
    assert.deepEqual(there.inlined, here.inlined, entry.name);
    assert.deepEqual(bundled.compilePreset(there.source).recipe, shipped.compilePreset(here.source).recipe, entry.name);
  }
});

// The verifier has its own guard for a server that never answers, so the run is not cut short here: on a busy machine
// it takes as long as it takes.
test('the standalone verifier runs bundled MCP help, render, import and scene export', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [path.join(root, 'scripts/verify-mcpb.mjs'), build.bundle], { encoding: 'utf8', windowsHide: true });
  assert.match(stdout, /MCPB verified:.*8 tools/);
});

test('the verifier stops a bundled server that never answers', async () => {
  const files = new Map([...readZip(build.bytes)].map(([name, entry]) => [name, entry.read()]));
  files.set('bin/pixelbolt.js', Buffer.from('process.stdin.resume();\n'));
  const silent = path.join(temp, 'silent.mcpb');
  await writeFile(silent, writeZip(files));
  await assert.rejects(verifyMcpb(silent, { stuckAfter: 50 }), /^Error: initialize had no reply in 0\.05 s, so the MCP server looks stuck/);
});

test('the verifier reports missing help and scene export assets and cleans up', async () => {
  for (const missing of ['docs/art-workflow.md', 'studio/scene-player.js']) {
    const files = new Map([...readZip(build.bytes)].map(([name, entry]) => [name, entry.read()]));
    files.delete(missing);
    const broken = path.join(temp, `${path.basename(missing)}.mcpb`);
    await writeFile(broken, writeZip(files));
    await assert.rejects(verifyMcpb(broken), /pixel_(help|scene) failed/);
  }
});

test('the verifier refuses traversal paths and a manifest/package version mismatch', async () => {
  const files = new Map([...readZip(build.bytes)].map(([name, entry]) => [name, entry.read()]));
  files.set('../escape.txt', Buffer.from('escape'));
  const bad = path.join(temp, 'bad.mcpb');
  await writeFile(bad, writeZip(files));
  await assert.rejects(verifyMcpb(bad), /Unsafe bundle path/);
  files.delete('../escape.txt');
  files.set('manifest.json', Buffer.from(json({ ...build.manifest, version: '999.0.0' })));
  await writeFile(bad, writeZip(files));
  await assert.rejects(verifyMcpb(bad), /manifest version must equal bundled package.json/);
});

test('the builder refuses template versions, non-stable versions and different existing artifacts', async () => {
  try {
    await writeJSON(path.join(base, 'mcpb/manifest.json'), { ...template, version: pkg.version });
    await assert.rejects(assembleMcpb({ base }), /must not contain version/);
  } finally { await writeJSON(path.join(base, 'mcpb/manifest.json'), template); }
  try {
    for (const version of ['1.0', 'v1.0.0', '01.0.0', '1.0.0-beta', 1]) {
      await writeJSON(path.join(base, 'package.json'), { ...pkg, version });
      await assert.rejects(assembleMcpb({ base }), /version must have the form X.Y.Z/);
    }
  } finally { await writeJSON(path.join(base, 'package.json'), pkg); }
  const out = path.join(temp, 'occupied');
  await mkdir(out); await writeFile(path.join(out, 'pixelbolt.mcpb'), 'keep');
  await assert.rejects(buildMcpb({ base, out }), /already exists with different contents/);
  assert.equal(await readFile(path.join(out, 'pixelbolt.mcpb'), 'utf8'), 'keep');
});

test('registry entry identifies the exact release bundle and preserves source metadata', async () => {
  const out = path.join(temp, 'server.registry.json'), before = await readFile(path.join(base, 'server.json'));
  const entry = await registryEntry({ base, tag: `v${pkg.version}`, bundle: build.bundle, out });
  assert.deepEqual(entry.packages, [{ registryType: 'mcpb', identifier: `https://github.com/skulitom/Pixelbolt/releases/download/v${pkg.version}/pixelbolt.mcpb`, version: pkg.version, fileSha256: sha256(build.bytes), transport: { type: 'stdio' } }]);
  assert.deepEqual(JSON.parse(await readFile(out)), entry);
  assert.deepEqual(await readFile(path.join(base, 'server.json')), before);
  await registryEntry({ base, tag: `v${pkg.version}`, bundle: build.bundle, out }); // Identical rerun is safe.
});

test('registry entry refuses bad tags, mismatched versions and packages in metadata', async () => {
  const options = { base, tag: `v${pkg.version}`, bundle: build.bundle, out: path.join(temp, 'refused.json') };
  for (const tag of ['0.7.1', 'v1.2', 'v1.2.3-beta', 'v01.2.3', '../v1.2.3']) await assert.rejects(registryEntry({ ...options, tag }), /Tag must have the form/);
  await assert.rejects(registryEntry({ ...options, tag: `v${pkg.version === '999.0.0' ? '998.0.0' : '999.0.0'}` }), /versions must match/);
  try {
    await writeJSON(path.join(base, 'server.json'), { ...metadata, packages: [] });
    await assert.rejects(registryEntry(options), /metadata-only/);
    await writeJSON(path.join(base, 'server.json'), { ...metadata, version: 'different' });
    await assert.rejects(registryEntry(options), /versions must match/);
  } finally { await writeJSON(path.join(base, 'server.json'), metadata); }
  const files = new Map([...readZip(build.bytes)].map(([name, entry]) => [name, entry.read()]));
  files.set('manifest.json', Buffer.from(json({ ...build.manifest, version: 'different' })));
  const oldBundle = path.join(temp, 'old.mcpb'); await writeFile(oldBundle, writeZip(files));
  await assert.rejects(registryEntry({ ...options, bundle: oldBundle }), /Bundle manifest version must match/);
});

test('registry entry cannot replace server.json or the bundle', async () => {
  for (const out of [path.join(base, 'server.json'), build.bundle]) {
    const before = await readFile(out);
    await assert.rejects(registryEntry({ base, tag: `v${pkg.version}`, bundle: build.bundle, out }), /must not overwrite/);
    assert.deepEqual(await readFile(out), before);
  }
});
