// Node-side install of the pixel art skill on its own: a folder an agent loads skills from (Claude Code's
// ~/.claude/skills, or a project's .claude/skills) gets SKILL.md with every command run through npx at this
// package's version, and the guides, schemas and examples it names copied beside it. No checkout, no MCP server.
import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKILL_SOURCE = 'skills/pixel-art/SKILL.md';
export const SKILL_NAME = 'pixelbolt-pixel-art';
export const SKILL_MANIFEST = '.pixelbolt-skill.json';
// The agent-facing guides the skill and the quick start cite; a test fails when the skill names one not listed here.
const DOCS = ['docs/agent-quick-start.md', 'docs/agent-guide.md', 'docs/art-workflow.md', 'docs/wave-effects.md', 'docs/game-integration.md'];
const REPOSITORY = 'https://github.com/skulitom/Pixelbolt';
const sha256 = data => createHash('sha256').update(data).digest('hex');

export const skillCommand = version => `npx -y pixelbolt@${version}`;

async function filesUnder(folder) {
  const found = [];
  for (const entry of await readdir(path.join(ROOT, folder), { withFileTypes: true })) {
    const file = `${folder}/${entry.name}`;
    if (entry.isDirectory()) found.push(...await filesUnder(file)); else if (entry.isFile()) found.push(file);
  }
  return found;
}

// Relative Markdown links keep working when their target is copied; any other file in the repository becomes a link
// to it on GitHub at this version's tag.
function relink(text, from, to, copied, version) {
  return text.replace(/\]\(([^)\s]+)\)/g, (link, target) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) return link;
    const [file, anchor = ''] = target.split(/(?=#)/);
    const source = path.posix.normalize(path.posix.join(path.posix.dirname(from), file));
    if (copied.has(source)) return `](${path.posix.relative(path.posix.dirname(to), copied.get(source)) || path.posix.basename(source)}${anchor})`;
    // A folder whose files are copied (examples/) stays a relative link; copied folders keep their place.
    const folder = source.replace(/\/$/, '');
    if ([...copied.values()].some(copy => copy.startsWith(`${folder}/`))) return `](${path.posix.relative(path.posix.dirname(to), folder) || '.'}/${anchor})`;
    return `](${REPOSITORY}/blob/v${version}/${source.replace(/^(?:\.\.\/)+/, '')}${anchor})`;
  });
}
// Checkout commands and bare `pixelbolt <command>` mentions both run through npx at this version.
const runThrough = (text, command) => text.replace(/node bin\/pixel(?:bolt|forge)\.js/g, command).replace(/(`|^)pixelbolt (?=[a-z])/gm, `$1${command} `);

// The skill as shipped assumes the package two directories above it. Its standalone copy says where things are.
function standaloneSkill(text, version) {
  const command = skillCommand(version);
  const end = text.startsWith('---') ? text.indexOf('\n---', 3) + 4 : 0;
  const head = text.slice(0, end), paragraphs = text.slice(end).split(/\n{2,}/);
  const intro = `This copy of the skill was installed on its own by \`pixelbolt skill install\` from Pixelbolt ${version}, with no checkout and no MCP server. Run every command as written below, through \`${command}\` (Node.js 20 or newer; npm downloads the package on first use), or through \`pixelbolt\` when Pixelbolt ${version} is installed globally. The guides, schemas and examples it names are copied beside this file, so \`docs/\`, \`schema.json\`, the \`*.schema.json\` files and \`examples/\` mean this skill's directory (\`${command} schema\` also prints the recipe schema). Commands run in the user's project, where those paths don't exist: copy an example into the project before editing or compiling it, or pass its absolute path. If Pixelbolt's MCP tools (\`pixel_help\`, \`pixel_validate\`, \`pixel_inspect\`, \`pixel_patch\`, \`pixel_render\` and the rest) are configured as well, you may use them as described below.`;
  const body = [];
  for (const paragraph of paragraphs) {
    // The plugin's server and the portable build don't apply to this copy.
    if (/^In the (?:Claude Code plugin|portable Pixelbolt Studio build),/.test(paragraph)) continue;
    body.push(paragraph.replace(/ ?Pixelbolt lives at the project root two directories above this skill's directory\./, '')
      .replace(/\(in the Pixelbolt folder two directories above this skill's directory\)/g, "(copied into this skill's `examples/` folder)"));
    if (/^# /.test(paragraph)) body.push(intro);
  }
  return head + body.join('\n\n');
}

// What the copy is checked for: anything still pointing into a checkout would send the agent to a missing file.
// Relative links in the copied guides point only at copied files (relink), so only SKILL.md, at the top, can escape.
export function standaloneProblems(text, { skill = true } = {}) {
  return [[/two directories above/, 'a path two directories above the skill'], [/bin\/pixel(?:bolt|forge)\.js/, 'a checkout command'], ...(skill ? [[/\]\(\.\.\//, 'a relative link outside the skill']] : []), [/plugin's server/, "the plugin's server"]]
    .filter(([pattern]) => pattern.test(text)).map(([, problem]) => problem);
}

// Every installed file: its path inside the skill folder and its bytes.
export async function skillFiles(version) {
  const { files } = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const schemas = files.filter(file => /(?:^|\.)schema\.json$/.test(file)).sort();
  const sources = [...DOCS, ...schemas, ...(await filesUnder('examples')).filter(file => file.endsWith('.json')).sort(), 'LICENSE'];
  const copied = new Map([[SKILL_SOURCE, 'SKILL.md'], ...sources.map(file => [file, file])]), command = skillCommand(version), out = new Map();
  for (const [source, target] of copied) {
    let data = await readFile(path.join(ROOT, source));
    if (source.endsWith('.md')) {
      let text = data.toString('utf8');
      if (source === SKILL_SOURCE) text = standaloneSkill(text, version);
      text = runThrough(relink(text, source, target, copied, version), command);
      const problems = standaloneProblems(text, { skill: source === SKILL_SOURCE });
      if (problems.length) throw new Error(`The skill in Pixelbolt ${version} could not be made standalone: ${target} still has ${problems.join(', ')}. Please report this at ${REPOSITORY}/issues; nothing was written.`);
      data = Buffer.from(text, 'utf8');
    }
    out.set(target, data);
  }
  return out;
}

const lstatOrNull = async file => { try { return await lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
async function readManifest(folder) {
  const stats = await lstatOrNull(path.join(folder, SKILL_MANIFEST));
  if (!stats?.isFile()) return null;
  try {
    const manifest = JSON.parse(await readFile(path.join(folder, SKILL_MANIFEST), 'utf8'));
    return manifest && typeof manifest.files === 'object' && !Array.isArray(manifest.files) ? manifest : null;
  } catch { return null; }
}
// What changed in an earlier install: files edited, removed or replaced since it wrote them.
async function changedSince(folder, manifest) {
  const changed = [];
  for (const [file, hash] of Object.entries(manifest.files)) {
    const target = path.join(folder, ...file.split('/')), stats = await lstatOrNull(target);
    if (!stats?.isFile() || sha256(await readFile(target)) !== hash) changed.push(file);
  }
  return changed;
}
// Writes beside the target and renames it into place, so a link or a second name for the old file is never written
// through.
async function replaceFile(target, data) {
  const temporary = `${target}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, data, { flag: 'wx' });
  try { await rename(temporary, target); } catch (error) { await rm(temporary, { force: true }); throw error; }
}

export function skillsFolder({ dir, project, cwd = process.cwd(), home = os.homedir() } = {}) {
  if (dir !== undefined && project) throw new Error('Choose one of --project and --dir');
  return dir !== undefined ? path.resolve(cwd, dir) : path.join(project ? cwd : home, '.claude', 'skills');
}

export async function installSkill({ version, force = false, ...where }) {
  const folder = path.join(skillsFolder(where), SKILL_NAME), files = await skillFiles(version), list = [...files.keys()].sort();
  const usage = 'Pass --force to replace it, or --dir to install somewhere else; nothing was written.';
  const stats = await lstatOrNull(folder);
  // lstat: a link is never a folder here, whatever it points at.
  if (stats && !stats.isDirectory()) throw new Error(`${folder} is ${stats.isSymbolicLink() ? 'a link' : 'not a folder'}, so the skill is not installed through it, even with --force. Remove it or pass --dir; nothing was written.`);
  // Folders inside the skill must be real folders too, or a write would land wherever they point.
  for (const sub of new Set(list.flatMap(file => file.split('/').slice(0, -1).map((part, i, parts) => parts.slice(0, i + 1).join('/'))))) {
    const inner = await lstatOrNull(path.join(folder, ...sub.split('/')));
    if (inner && !inner.isDirectory()) throw new Error(`${path.join(folder, ...sub.split('/'))} is ${inner.isSymbolicLink() ? 'a link' : 'not a folder'}; remove it and install again. Nothing was written.`);
  }
  const manifest = stats ? await readManifest(folder) : null;
  let changed = [], status = stats ? 'updated' : 'installed';
  if (stats && !manifest) {
    if ((await readdir(folder)).length && !force) throw new Error(`${folder} already holds files this command didn't write. ${usage}`);
    if ((await readdir(folder)).length) status = 'replaced';
  } else if (manifest) {
    changed = await changedSince(folder, manifest);
    if (changed.length && !force) throw new Error(`${folder} has changes since Pixelbolt ${manifest.version ?? 'an earlier version'} installed it (${changed.slice(0, 5).join(', ')}${changed.length > 5 ? `, and ${changed.length - 5} more` : ''}). ${usage}`);
    if (changed.length) status = 'replaced';
  }
  for (const file of list) {
    const target = path.join(folder, ...file.split('/')), existing = await lstatOrNull(target);
    if (existing?.isDirectory()) throw new Error(`${target} is a folder; remove it and install again. Nothing was written.`);
  }
  const hashes = Object.fromEntries(list.map(file => [file, sha256(files.get(file))]));
  const stale = manifest ? Object.keys(manifest.files).filter(file => !files.has(file) && !changed.includes(file)) : [];
  const same = manifest && !changed.length && !stale.length && manifest.version === version && JSON.stringify(manifest.files) === JSON.stringify(hashes);
  const command = skillCommand(version), result = { skill: folder, version, command, files: list.length };
  if (same) return { status: 'unchanged', ...result };
  await mkdir(folder, { recursive: true });
  for (const file of list) {
    const target = path.join(folder, ...file.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await replaceFile(target, files.get(file));
  }
  for (const file of stale) await rm(path.join(folder, ...file.split('/')), { force: true });
  await replaceFile(path.join(folder, SKILL_MANIFEST), JSON.stringify({ installedBy: 'pixelbolt skill install', version, command, files: hashes }, null, 2) + '\n');
  return { status, ...result, ...(manifest?.version && manifest.version !== version && { from: manifest.version }), ...(changed.length && { overwrote: changed }), ...(stale.length && { removed: stale }) };
}
