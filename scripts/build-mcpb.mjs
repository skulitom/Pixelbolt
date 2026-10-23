// node scripts/build-mcpb.mjs [--out dist/mcpb] [--check]
// node scripts/build-mcpb.mjs --registry-entry --tag vX.Y.Z --bundle file [--out file]
// All shipped inputs are UTF-8 text, read from disk and normalized to LF. Git's Windows checkout conversion
// therefore cannot change a clean build. ZIP dates and ordering are fixed; use the same Node/zlib for byte equality.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { writeZip, readZip, sha256 } from './build-studio.mjs';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const readJSON = async file => JSON.parse(await readFile(file, 'utf8'));

// A rerun may keep an identical artifact, but never silently replace an earlier build or source file.
async function writeUnchangedOrNew(file, bytes) {
  const existing = await readFile(file).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (existing) {
    if (!existing.equals(bytes)) throw new Error(`${file} already exists with different contents; choose a fresh --out.`);
    return;
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes, { flag: 'wx' });
}

export async function assembleMcpb({ base = root } = {}) {
  const template = await readJSON(path.join(base, 'mcpb/manifest.json'));
  if (Object.hasOwn(template, 'version')) throw new Error('mcpb/manifest.json must not contain version; package.json supplies it.');
  const { version } = await readJSON(path.join(base, 'package.json'));
  if (typeof version !== 'string' || !VERSION.test(version)) throw new Error('package.json version must have the form X.Y.Z.');
  const manifest = { ...template, version };
  // The CLI imports index.js, including frame-folder.js. server.js serves the Studio and is not needed by MCP.
  // pixel_help reads the quick start, two guides and one example. pixel_scene exports these three Studio player files as assets.
  const names = [
    'package.json', 'bin/pixelbolt.js', 'bin/pixelforge.js', 'LICENSE', 'README.md', 'schema.json',
    'docs/agent-quick-start.md', 'docs/agent-guide.md', 'docs/art-workflow.md', 'examples/forest-spirit.json',
    'studio/scene.html', 'studio/scene-player.js', 'studio/scene.css',
    ...(await readdir(base)).filter(file => file.endsWith('.schema.json')),
    ...(await readdir(path.join(base, 'src'))).filter(file => file.endsWith('.js') && file !== 'server.js').map(file => `src/${file}`)
  ];
  const files = new Map([['manifest.json', json(manifest)]]);
  for (const file of names.sort()) files.set(file, Buffer.from((await readFile(path.join(base, file), 'utf8')).replace(/\r\n/g, '\n')));
  const bytes = writeZip(new Map([...files].sort(([a], [b]) => a < b ? -1 : 1)), { date: new Date(Date.UTC(1980, 0, 1)) });
  return { bytes, manifest, files: files.size, hash: sha256(bytes) };
}

export async function buildMcpb({ base = root, out = path.join(root, 'dist/mcpb'), check = false } = {}) {
  const build = await assembleMcpb({ base });
  if (check && !build.bytes.equals((await assembleMcpb({ base })).bytes)) throw new Error('MCPB determinism check failed: two builds differ.');
  const bundle = path.resolve(out, 'pixelbolt.mcpb');
  await writeUnchangedOrNew(bundle, build.bytes);
  await writeUnchangedOrNew(`${bundle}.sha256`, Buffer.from(`${build.hash}  pixelbolt.mcpb\n`));
  // Kept beside the bundle for the pinned MCPB CLI's `validate <manifest>` command.
  await writeUnchangedOrNew(path.resolve(out, 'manifest.json'), json(build.manifest));
  return { ...build, bundle };
}

export async function registryEntry({ base = root, tag, bundle, out = path.join(root, 'dist/mcpb/server.registry.json') }) {
  if (typeof tag !== 'string' || !tag.startsWith('v') || !VERSION.test(tag.slice(1))) throw new Error('Tag must have the form vX.Y.Z.');
  if (!bundle) throw new Error('--bundle is required.');
  const metadataPath = path.resolve(base, 'server.json'), bundlePath = path.resolve(bundle), destination = path.resolve(out);
  const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (same(destination, metadataPath) || same(destination, bundlePath)) throw new Error('--out must not overwrite server.json or the bundle.');
  const server = await readJSON(metadataPath), { version } = await readJSON(path.join(base, 'package.json'));
  if (Object.hasOwn(server, 'packages')) throw new Error('server.json must remain metadata-only (no packages property).');
  if (`v${version}` !== tag || server.version !== version) throw new Error('Tag, package.json and server.json versions must match.');
  const bytes = await readFile(bundlePath), manifestFile = readZip(bytes).get('manifest.json');
  if (!manifestFile) throw new Error('Bundle has no manifest.json.');
  if (JSON.parse(manifestFile.read()).version !== version) throw new Error('Bundle manifest version must match the tag and package.json.');
  const entry = { ...server, packages: [{
    registryType: 'mcpb', identifier: `https://github.com/skulitom/Pixelbolt/releases/download/${tag}/pixelbolt.mcpb`,
    version, fileSha256: sha256(bytes), transport: { type: 'stdio' }
  }] };
  await writeUnchangedOrNew(destination, json(entry));
  return entry;
}

async function main(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    if (['--check', '--registry-entry'].includes(argv[i])) options[argv[i].slice(2)] = true;
    else if (['--out', '--tag', '--bundle'].includes(argv[i]) && argv[i + 1] && !argv[i + 1].startsWith('--')) options[argv[i].slice(2)] = argv[++i];
    else throw new Error(`Unknown or incomplete option: ${argv[i]}`);
  }
  if (options['registry-entry']) {
    if (options.check) throw new Error('--check is only for bundle builds.');
    const entry = await registryEntry(options);
    console.log(`Registry entry: ${entry.name} ${entry.version}, SHA-256 ${entry.packages[0].fileSha256}`);
  } else {
    if (options.tag || options.bundle) throw new Error('--tag and --bundle require --registry-entry.');
    const build = await buildMcpb(options);
    console.log(`${options.check ? 'Two byte-identical builds: ' : ''}${build.bundle}\n  ${build.files} files, ${build.bytes.length} bytes\n  SHA-256 ${build.hash}`);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
