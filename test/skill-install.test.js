import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, copyFile, link, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILL_MANIFEST, SKILL_NAME, skillCommand, skillFiles, standaloneProblems } from '../src/skill.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const command = skillCommand(version);
// The real path: macOS's temp folder is behind a link (/var is /private/var), and the CLI's working folder is real.
const temp = async t => {
  const base = await realpath(os.tmpdir()), dir = await mkdtemp(path.join(base, 'pixelbolt-skill-'));
  t.after(async () => { assert.ok(dir.startsWith(base + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const home = path.join(dir, 'home'), project = path.join(dir, 'project');
  await mkdir(home); await mkdir(project);
  return { dir, home, project, skill: path.join(home, '.claude', 'skills', SKILL_NAME) };
};
// The CLI with a stand-in home folder: Node reads HOME on macOS and Linux and USERPROFILE on Windows.
const cli = (args, { project, home }) => spawnSync(process.execPath, [path.join(root, 'bin', 'pixelbolt.js'), ...args], { cwd: project, encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
const ok = result => { assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout); };
const refused = (result, pattern) => {
  assert.equal(result.status, 1, result.stdout);
  const reply = JSON.parse(result.stderr);
  assert.equal(reply.ok, false); assert.match(reply.error, pattern);
};
const exists = file => access(file).then(() => true, () => false);
async function listed(folder, prefix = '') {
  const found = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.isDirectory()) found.push(...await listed(path.join(folder, entry.name), `${prefix}${entry.name}/`)); else found.push(`${prefix}${entry.name}`);
  }
  return found.sort();
}
// Splits a command as a POSIX shell would for these simple lines: spaces separate words, single quotes group them.
const words = line => [...line.matchAll(/'([^']*)'|(\S+)/g)].map(match => match[1] ?? match[2]);

test('skill install writes a standalone skill to Claude Code\'s skills folder in the home folder, the project or a named folder', async t => {
  const where = await temp(t);
  const installed = ok(cli(['skill', 'install'], where));
  assert.deepEqual(installed, { ok: true, status: 'installed', skill: where.skill, version, command, files: installed.files });
  const skill = await readFile(path.join(where.skill, 'SKILL.md'), 'utf8');
  const front = /^---\r?\nname: (.+)\r?\ndescription: (.+)\r?\n---\r?\n/.exec(skill);
  assert.ok(front, 'SKILL.md starts with name and description front matter');
  assert.equal(front[1], SKILL_NAME); assert.equal(path.basename(where.skill), SKILL_NAME);
  assert.ok(front[2].length > 0 && front[2].length <= 1024, 'a skill description is 1 to 1,024 characters');
  assert.deepEqual(standaloneProblems(skill), []);
  assert.match(skill, new RegExp(`through \`${command.replace(/[.@]/g, '\\$&')}\``));
  // The folder holds exactly what the manifest lists, so the next install can tell what changed.
  const manifest = JSON.parse(await readFile(path.join(where.skill, SKILL_MANIFEST), 'utf8'));
  assert.equal(manifest.version, version); assert.equal(manifest.command, command);
  assert.deepEqual(await listed(where.skill), [...Object.keys(manifest.files), SKILL_MANIFEST].sort());
  assert.equal(Object.keys(manifest.files).length, installed.files);

  assert.equal(ok(cli(['skill', 'install'], where)).status, 'unchanged');
  assert.equal(ok(cli(['skill', 'install', '--project'], where)).skill, path.join(where.project, '.claude', 'skills', SKILL_NAME));
  assert.equal(ok(cli(['skill', 'install', '--dir', 'agent-skills'], where)).skill, path.join(where.project, 'agent-skills', SKILL_NAME));
  assert.ok(await exists(path.join(where.project, 'agent-skills', SKILL_NAME, 'SKILL.md')));
  refused(cli(['skill', 'install', '--project', '--dir', 'x'], where), /one of --project and --dir/);
  refused(cli(['skill'], where), /pixelbolt skill install/);
  refused(cli(['skill', 'remove'], where), /pixelbolt skill install/);
  refused(cli(['skill', 'install', '--out', 'x'], where), /--out is not supported by skill/);
  assert.match(cli(['help'], where).stdout, /pixelbolt skill install \[--project \| --dir folder\] \[--force\]/);
});

test('the installed skill reaches every guide, schema and example it names, and runs every command through npx at this version', async () => {
  const files = await skillFiles(version);
  // Every example ships with it: the skill tells the agent to begin from one.
  const examples = (await listed(path.join(root, 'examples'))).filter(file => file.endsWith('.json')).map(file => `examples/${file}`);
  for (const file of [...examples, 'schema.json', 'docs/agent-guide.md', 'docs/art-workflow.md', 'docs/agent-quick-start.md', 'LICENSE']) assert.ok(files.has(file), `${file} is installed`);
  for (const [file, data] of files) {
    if (!file.endsWith('.md')) continue;
    const text = data.toString('utf8'), from = path.posix.dirname(file);
    assert.deepEqual(standaloneProblems(text, { skill: file === 'SKILL.md' }), [], file);
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) continue;
      const resolved = path.posix.normalize(path.posix.join(from, target.split('#')[0])).replace(/\/$/, '');
      assert.ok(!resolved.startsWith('..') && (files.has(resolved) || [...files.keys()].some(copy => copy.startsWith(`${resolved}/`))), `${file} links to ${target}, which is not in the skill`);
    }
    for (const [, runner] of text.matchAll(/npx -y (pixelbolt@[^\s`]*)/g)) assert.equal(runner, `pixelbolt@${version}`, `${file} runs ${runner}`);
  }
  // The files the skill and the quick start name in code spans are copied (patterns and placeholders aside).
  for (const file of ['SKILL.md', 'docs/agent-quick-start.md']) {
    for (const [, named] of files.get(file).toString('utf8').matchAll(/`((?:docs|examples)\/[^`\s*<]+?\.(?:md|json)|[a-z]*\.?schema\.json)(?:#[^`]*)?`/g)) {
      assert.ok(files.has(named), `${file} names ${named}, which is not in the skill`);
    }
  }
  // The shipped skill keeps its checkout and plugin layout; only the copy changes.
  const shipped = await readFile(path.join(root, 'skills', 'pixel-art', 'SKILL.md'), 'utf8');
  assert.match(shipped, /two directories above this skill's directory/);
  assert.match(shipped, /node bin\/pixelbolt\.js validate/);
});

test('the installed skill\'s validate, inspect, render and gif commands work on a bundled example from the user\'s project, offline', async t => {
  const where = await temp(t);
  ok(cli(['skill', 'install'], where));
  const skill = await readFile(path.join(where.skill, 'SKILL.md'), 'utf8');
  const lines = [...skill.matchAll(/`(npx -y pixelbolt@[^`]+)`/g)].map(match => match[1]);
  // As the skill says, the agent copies an example into the project before using it.
  await copyFile(path.join(where.skill, 'examples', 'forest-spirit.json'), path.join(where.project, 'sprite.json'));
  const values = { '<recipe>': 'sprite.json', '<frames.png>': 'frames.png', '<directory>': 'sprite-assets', '<new.gif>': 'sprite.gif' };
  const replies = {};
  for (const name of ['validate', 'inspect', 'render', 'gif']) {
    const line = lines.find(candidate => words(candidate)[3] === name);
    assert.ok(line, `the skill names a ${name} command`);
    const [npx, yes, runner, ...args] = words(line);
    assert.deepEqual([npx, yes, runner], ['npx', '-y', `pixelbolt@${version}`]);
    const filled = args.map((word, i) => args[i - 1] === '--expect' ? JSON.stringify({ width: 24, height: 24 }) : values[word] ?? word);
    assert.deepEqual(filled.filter(word => /^<.*>$/.test(word)), [], `${line} has a placeholder this test fills`);
    // npx would run this same package; the checkout's own bin runs it without a network.
    replies[name] = ok(spawnSync(process.execPath, [path.join(root, 'bin', 'pixelbolt.js'), ...filled], { cwd: where.project, encoding: 'utf8' }));
    assert.equal(replies[name].ok, true, line);
  }
  assert.equal(replies.validate.name, 'forest-spirit');
  assert.equal(replies.render.check.ok, true, JSON.stringify(replies.render.check));
  for (const file of ['frames.png', 'frames.native.png', 'sprite.gif', path.join('sprite-assets', 'forest-spirit.png')]) assert.ok(await exists(path.join(where.project, file)), `${file} was written`);
});

test('skill install keeps a changed copy unless --force, updates its own, keeps other files and never writes through a link', async t => {
  const where = await temp(t), skillFile = path.join(where.skill, 'SKILL.md');
  ok(cli(['skill', 'install'], where));
  const original = await readFile(skillFile, 'utf8');
  await writeFile(path.join(where.skill, 'notes.md'), 'mine\n');
  // A second name for SKILL.md: editing through it changes the copy, and the reinstall replaces the file, not the link.
  const other = path.join(where.dir, 'other.md');
  await link(skillFile, other); await writeFile(other, `${original}\nMy own rule.\n`);
  refused(cli(['skill', 'install'], where), /has changes since Pixelbolt .* installed it \(SKILL\.md\)\. Pass --force/);
  assert.match(await readFile(skillFile, 'utf8'), /My own rule\./);
  const forced = ok(cli(['skill', 'install', '--force'], where));
  assert.equal(forced.status, 'replaced'); assert.deepEqual(forced.overwrote, ['SKILL.md']);
  assert.equal(await readFile(skillFile, 'utf8'), original);
  assert.match(await readFile(other, 'utf8'), /My own rule\./);
  assert.equal(await readFile(path.join(where.skill, 'notes.md'), 'utf8'), 'mine\n');

  // An earlier version's untouched copy is updated without --force, and a file it had that this one lacks goes.
  const manifestFile = path.join(where.skill, SKILL_MANIFEST), manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  await writeFile(path.join(where.skill, 'docs', 'old.md'), 'old\n');
  manifest.version = '0.0.1'; manifest.files['docs/old.md'] = 'ca4f3ddea1e4fc7cb2f2cc8b1b8e6b1e4c9f05b9a0fa6c6b3f0ef9ca2b4a1b3c';
  await writeFile(manifestFile, JSON.stringify(manifest));
  refused(cli(['skill', 'install'], where), /docs\/old\.md/);
  manifest.files['docs/old.md'] = (await import('node:crypto')).createHash('sha256').update('old\n').digest('hex');
  await writeFile(manifestFile, JSON.stringify(manifest));
  const updated = ok(cli(['skill', 'install'], where));
  assert.equal(updated.status, 'updated'); assert.equal(updated.from, '0.0.1'); assert.deepEqual(updated.removed, ['docs/old.md']);
  assert.ok(!await exists(path.join(where.skill, 'docs', 'old.md')));

  // A folder this command didn't write is someone else's.
  const foreign = path.join(where.project, 'skills', SKILL_NAME);
  await mkdir(foreign, { recursive: true }); await writeFile(path.join(foreign, 'SKILL.md'), 'hand-made\n');
  refused(cli(['skill', 'install', '--dir', 'skills'], where), /already holds files this command didn't write/);
  assert.equal(await readFile(path.join(foreign, 'SKILL.md'), 'utf8'), 'hand-made\n');
  assert.equal(ok(cli(['skill', 'install', '--dir', 'skills', '--force'], where)).status, 'replaced');

  // A skill folder that is a link (a checkout's skills/pixel-art, say) is never written through, even with --force.
  const target = path.join(where.dir, 'checkout-skill'), linked = path.join(where.project, 'linked', SKILL_NAME);
  await mkdir(target); await writeFile(path.join(target, 'SKILL.md'), 'checkout\n'); await mkdir(path.dirname(linked));
  try { await symlink(target, linked, process.platform === 'win32' ? 'junction' : 'dir'); } catch (error) { t.diagnostic(`no folder link here (${error.code})`); return; }
  for (const force of [[], ['--force']]) refused(cli(['skill', 'install', '--dir', 'linked', ...force], where), /is a link/);
  assert.deepEqual(await readdir(target), ['SKILL.md']);
  assert.equal(await readFile(path.join(target, 'SKILL.md'), 'utf8'), 'checkout\n');
  // Nor is a folder inside it.
  await rm(path.join(where.skill, 'examples'), { recursive: true });
  await symlink(target, path.join(where.skill, 'examples'), process.platform === 'win32' ? 'junction' : 'dir');
  refused(cli(['skill', 'install', '--force'], where), /examples is a link; remove it/);
  assert.deepEqual(await readdir(target), ['SKILL.md']);
});
