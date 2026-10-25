import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
  assert.equal(JSON.parse(await readFile(path.join(root, '.claude-plugin', 'plugin.json'))).version, pkg.version);
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

test('release workflow guards and assets use the renamed repository', async () => {
  let guards = 0;
  for (const file of ['release.yml', 'publish-registry.yml', 'test.yml']) {
    const text = await readFile(path.join(root, '.github/workflows', file), 'utf8');
    const matches = [...text.matchAll(/github\.repository\s*==\s*(['"])(.*?)\1/g)];
    assert.equal(matches.length, [...text.matchAll(/github\.repository\s*==/g)].length, file);
    for (const match of matches) { assert.equal(match[2], 'skulitom/Pixelbolt', file); guards++; }
    assert.doesNotMatch(text, /pixelforge/i);
    assert.ok(text.includes('pixelbolt.mcpb'), file);
    if (file === 'release.yml') { assert.ok(text.includes('name: pixelbolt-mcpb')); assert.ok(text.includes('--title "Pixelbolt $RELEASE_TAG"')); }
    if (file === 'publish-registry.yml') assert.ok(text.includes('io.github.skulitom%2Fpixelbolt'));
    if (file === 'test.yml') assert.ok(text.includes('PixelboltStudio-*'));
  }
  assert.equal(guards, 4);
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
  for (const file of ['package.json', 'server.json', '.claude-plugin/plugin.json', 'mcpb/RELEASE_NOTES.md']) assert.ok(jobs.build.includes(`'${file}'`), `the tag check reads ${file}`);
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
  for (const excluded of ['src/server.js', 'studio/index.html', 'server.json', 'scripts/build-mcpb.mjs', 'docs/PUBLISHING.md']) assert.equal(files.has(excluded), false, excluded);
});

test('the standalone verifier runs bundled MCP help, render, import and scene export', () => {
  const output = execFileSync(process.execPath, [path.join(root, 'scripts/verify-mcpb.mjs'), build.bundle], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.match(output, /MCPB verified:.*8 tools/);
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
