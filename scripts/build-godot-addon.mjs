// Packs the Godot editor addon for a release: godot/addons/pixelbolt as addons/pixelbolt/ at the root of
// pixelbolt-godot-<version>.zip, the folder a user unzips into a Godot project, with its SHA-256 beside it.
//   node scripts/build-godot-addon.mjs [--out dist] [--check]
// <version> is package.json's, and the zip's plugin.cfg says the same version whatever the checkout's copy says, so a
// release's zip names its release. The same files always give the same bytes (for one zlib, as writeZip says): entries
// in sorted order, one fixed timestamp, and text files with LF line endings, as git stores them, even in a checkout that
// turned them into CRLF. --check builds again and fails unless the zip already in --out has those bytes. Nothing here
// touches package.json: the addon is not part of the npm package.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, writeZip, sha256 } from './build-studio.mjs';

export const ADDON = 'godot/addons/pixelbolt';
// What the addon folder may hold. Anything else (a stray binary, an editor's swap file) stops the build, so nothing
// ships by accident; GDScript only, as the addon's rules say.
export const TEXT = /\.(gd|cfg|md|txt|uid|json|tres|tscn|svg)$|^LICENSE$/;
const JUNK = /^(\.DS_Store|Thumbs\.db|desktop\.ini)$/;

async function walk(base, folder) {
  const found = [];
  for (const entry of (await readdir(path.join(base, folder), { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const file = `${folder}/${entry.name}`;
    if (entry.isDirectory()) found.push(...await walk(base, file));
    else if (!JUNK.test(entry.name)) found.push(file);
  }
  return found;
}

// plugin.cfg with its one `version="..."` line set to `version`.
export function stampVersion(text, version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error(`Not a release version: ${version}`);
  const lines = text.split('\n'), at = lines.flatMap((line, i) => (/^version=".*"$/.test(line) ? [i] : []));
  if (at.length !== 1) throw new Error(`plugin.cfg must have exactly one version="..." line; it has ${at.length}`);
  lines[at[0]] = `version="${version}"`;
  return lines.join('\n');
}

// The archive's files, name -> bytes, in the order they are packed.
export async function addonFiles({ base = root, version } = {}) {
  version ??= JSON.parse(await readFile(path.join(base, 'package.json'), 'utf8')).version;
  const files = new Map();
  for (const file of await walk(base, ADDON)) {
    const name = path.posix.basename(file);
    if (!TEXT.test(name)) throw new Error(`${file} is not a file the addon ships (GDScript, config and text only)`);
    let text = (await readFile(path.join(base, file), 'utf8')).replaceAll('\r\n', '\n');
    if (file === `${ADDON}/plugin.cfg`) text = stampVersion(text, version);
    files.set(`addons/pixelbolt/${file.slice(ADDON.length + 1)}`, Buffer.from(text));
  }
  for (const needed of ['plugin.cfg', 'plugin.gd', 'LICENSE', 'README.md']) if (!files.has(`addons/pixelbolt/${needed}`)) throw new Error(`${ADDON}/${needed} is missing`);
  return { version, files };
}

export async function buildAddonZip(options = {}) {
  const { version, files } = await addonFiles(options), name = `pixelbolt-godot-${version}.zip`, bytes = writeZip(files);
  return { name, version, files, bytes, sha256: sha256(bytes), checksum: `${sha256(bytes)}  ${name}\n` };
}

async function main(argv) {
  const options = { out: 'dist', check: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') options.check = true;
    else if (argv[i] === '--out' && argv[i + 1]) options.out = argv[++i];
    else throw new Error(`Unknown or incomplete option: ${argv[i]}`);
  }
  const build = await buildAddonZip(), target = path.join(path.resolve(options.out), build.name);
  const summary = `${build.name}: ${build.files.size} files, ${build.bytes.length} bytes, SHA-256 ${build.sha256}`;
  const existing = await readFile(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (options.check) {
    if (!existing) throw new Error(`Nothing to check: ${target} does not exist`);
    if (!existing.equals(build.bytes)) throw new Error(`${target} was not reproduced: the files give other bytes (${summary})`);
    if (await readFile(`${target}.sha256`, 'utf8') !== build.checksum) throw new Error(`${target}.sha256 does not name these bytes`);
    console.log(`Reproduced ${summary}`);
    return;
  }
  if (existing && !existing.equals(build.bytes)) throw new Error(`${target} already exists with other contents; one version names one zip: choose another --out`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, build.bytes);
  await writeFile(`${target}.sha256`, build.checksum);
  console.log(`Wrote ${target}\n${summary}`);
  process.stdout.write(build.checksum);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
