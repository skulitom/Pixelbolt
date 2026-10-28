import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILL_MANIFEST, SKILL_NAME, installSkill, skillFiles } from '../src/skill.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const sha256 = data => createHash('sha256').update(data).digest('hex');
const temp = async t => {
  const base = await realpath(os.tmpdir()), dir = await mkdtemp(path.join(base, 'pixelbolt-skill-package-'));
  t.after(async () => { assert.ok(dir.startsWith(base + path.sep)); await rm(dir, { recursive: true, force: true }); });
  return { dir, skill: path.join(dir, SKILL_NAME) };
};

test('the npm package holds every file skill install copies', async () => {
  // npm packs package.json's `files` (folders and files) plus package.json; the installer reads from the package
  // itself, so a file it copies that the package lacks would break `npx pixelbolt skill install` after publishing.
  const packed = file => file === 'package.json' || pkg.files.some(entry => file === entry || file.startsWith(`${entry}/`));
  const copied = [...(await skillFiles(pkg.version)).keys()].map(file => file === 'SKILL.md' ? 'skills/pixel-art/SKILL.md' : file);
  assert.ok(copied.length > 20);
  assert.deepEqual(copied.filter(file => !packed(file)), []);
});

test('skill install finishes an interrupted install and clears the temporary files it left', async t => {
  const { dir, skill } = await temp(t);
  await installSkill({ version: pkg.version, dir });
  // Cut short before its manifest, while writing SKILL.md: only this version's files and a temporary one remain.
  await rm(path.join(skill, SKILL_MANIFEST));
  await writeFile(path.join(skill, 'SKILL.md.0123456789ab.tmp'), 'half');
  await writeFile(path.join(skill, 'docs', 'agent-guide.md.aaaaaaaaaaaa.tmp'), 'half');
  assert.equal((await installSkill({ version: pkg.version, dir })).status, 'installed');
  assert.deepEqual((await readdir(skill)).filter(name => name.endsWith('.tmp')), []);
  assert.deepEqual((await readdir(path.join(skill, 'docs'))).filter(name => name.endsWith('.tmp')), []);
  // With the manifest in place, a leftover is cleared too, and a file of the user's that only looks similar stays.
  await writeFile(path.join(skill, `${SKILL_MANIFEST}.0123456789ab.tmp`), '{}');
  await writeFile(path.join(skill, 'notes.md.0123456789ab.tmp'), 'mine');
  const again = await installSkill({ version: pkg.version, dir });
  assert.equal(again.status, 'updated');
  assert.deepEqual((await readdir(skill)).filter(name => name.endsWith('.tmp')), ['notes.md.0123456789ab.tmp']);
});

test('skill install keeps an edited file a new version no longer ships, and names what --force replaced', async t => {
  const { dir, skill } = await temp(t);
  await installSkill({ version: pkg.version, dir });
  // As if 0.9.0 had shipped docs/old.md, which the user then edited: an update asks for --force, which keeps the file
  // and says so rather than claiming to have replaced it.
  const manifestFile = path.join(skill, SKILL_MANIFEST), manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  await writeFile(path.join(skill, 'docs', 'old.md'), 'my notes');
  await writeFile(manifestFile, JSON.stringify({ ...manifest, version: '0.9.0', files: { ...manifest.files, 'docs/old.md': sha256('original') } }));
  await assert.rejects(installSkill({ version: pkg.version, dir }), /docs\/old\.md/);
  const update = await installSkill({ version: pkg.version, dir, force: true });
  assert.equal(update.status, 'updated'); assert.deepEqual(update.kept, ['docs/old.md']); assert.equal(update.overwrote, undefined);
  assert.equal(await readFile(path.join(skill, 'docs', 'old.md'), 'utf8'), 'my notes');
  assert.ok(!Object.hasOwn(JSON.parse(await readFile(manifestFile, 'utf8')).files, 'docs/old.md'));
  // A skill folder with no manifest and the user's own SKILL.md: refused, and --force lists what it replaced.
  const other = path.join(dir, 'other');
  await mkdir(path.join(other, SKILL_NAME), { recursive: true }); await writeFile(path.join(other, SKILL_NAME, 'SKILL.md'), 'my own skill');
  await assert.rejects(installSkill({ version: pkg.version, dir: other }), /already holds files this command didn't write/);
  const forced = await installSkill({ version: pkg.version, dir: other, force: true });
  assert.equal(forced.status, 'replaced'); assert.deepEqual(forced.overwrote, ['SKILL.md']);
});

test('every command shows the help with --help or -h, as the quick start says', () => {
  for (const args of [['validate', '--help'], ['render', 'sprite.json', '-h'], ['skill', 'install', '--help']]) {
    const result = spawnSync(process.execPath, [path.join(root, 'bin', 'pixelbolt.js'), ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /^Pixelbolt — text to pixels/);
    assert.ok(result.stdout.includes('pixelbolt validate <file.json|->'));
  }
});
