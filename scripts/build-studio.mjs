// Builds the portable Pixelbolt Studio: the files `npm pack` ships, the pinned official Node.js runtime for the
// target system and the launcher scripts from packaging/, packed into one reproducible archive (a ZIP for Windows,
// a .tar.gz that keeps execute permissions for macOS and Linux). Any host can build any target.
//   node scripts/build-studio.mjs [--target win-x64|linux-x64|linux-arm64|darwin-arm64|darwin-x64|all] [--out dist]
//                                 [--node-archive file] [--check] [--force] [--allow-dirty]
// The default target is this machine's own. --check rebuilds and compares with the archive already in --out instead
// of writing. --node-archive uses a runtime archive downloaded beforehand (one target only); it must still match
// the pinned SHA-256. Nothing is added to package.json's dependencies.
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, stat, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import zlib from 'node:zlib';
import { crc32 } from '../src/png.js';
import { studioPacker } from './environment.mjs';

export const root = fileURLToPath(new URL('../', import.meta.url));
// The newest 24.x LTS release. Archive hashes are from https://nodejs.org/dist/v24.21.0/SHASUMS256.txt; the binary
// hashes are of the node program inside each archive (SHASUMS256.txt lists that one for Windows only).
export const NODE_VERSION = '24.21.0';
export const TARGETS = {
  'win-x64': { os: 'windows', format: 'zip', archive: `node-v${NODE_VERSION}-win-x64.zip`, sha256: '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541', binary: 'node.exe', binarySha256: 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32' },
  'linux-x64': { os: 'linux', format: 'tar.gz', archive: `node-v${NODE_VERSION}-linux-x64.tar.gz`, sha256: '6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff', binary: 'bin/node', binarySha256: '7fde7b8afa198da66257f42ee2001d874c7355631e6d1579a5fb5ef1f246df4c' },
  'linux-arm64': { os: 'linux', format: 'tar.gz', archive: `node-v${NODE_VERSION}-linux-arm64.tar.gz`, sha256: '724282c3b43aec998aa9527380465b45d229e021b58035f5f4f63095eabfe5d5', binary: 'bin/node', binarySha256: '0f8949d1028f6d61506b2d5bc57e7e6fe893d7b1997509b7847294fc9c616584' },
  'darwin-arm64': { os: 'macos', format: 'tar.gz', archive: `node-v${NODE_VERSION}-darwin-arm64.tar.gz`, sha256: 'bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057', binary: 'bin/node', binarySha256: 'e4b5a3af0e05c75de2eae013904145f40fe7fc2a6e6f17510128bf45cca4e79b' },
  'darwin-x64': { os: 'macos', format: 'tar.gz', archive: `node-v${NODE_VERSION}-darwin-x64.tar.gz`, sha256: '1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097', binary: 'bin/node', binarySha256: '7abcf39bd37ab251015337ff75304d7555f0d8e88c6e0fbf04bce8ce34636f49' }
};
for (const target of Object.values(TARGETS)) target.url = `https://nodejs.org/dist/v${NODE_VERSION}/${target.archive}`;
// The target a machine runs natively, or undefined when no build is pinned for it.
export const hostTarget = (platform = process.platform, arch = process.arch) => [`${{ win32: 'win' }[platform] ?? platform}-${arch}`].find(name => Object.hasOwn(TARGETS, name));
// Folders under packaging/ that go into each system's build, in order. START HERE.txt is one text with
// "#if windows|macos|linux" blocks.
const PACKAGING = { windows: ['common', 'windows'], macos: ['common', 'unix', 'macos'], linux: ['common', 'unix'] };
export const sha256 = data => createHash('sha256').update(data).digest('hex');
const checksum = zlib.crc32 ?? crc32;

// Reads a ZIP32 archive with stored or deflated entries; each entry is checked against its CRC when read.
export function readZip(buffer) {
  let end = buffer.length - 22;
  const floor = Math.max(0, end - 65535);
  while (end >= floor && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < floor) throw new Error('Not a ZIP archive: no end-of-central-directory record');
  const count = buffer.readUInt16LE(end + 10), entries = new Map();
  let at = buffer.readUInt32LE(end + 16);
  if (count === 0xffff || at === 0xffffffff) throw new Error('ZIP64 archives are not supported');
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error('Damaged ZIP central directory');
    const method = buffer.readUInt16LE(at + 10), crc = buffer.readUInt32LE(at + 16), packed = buffer.readUInt32LE(at + 20), size = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28), local = buffer.readUInt32LE(at + 42), name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
    if (name.endsWith('/')) continue;
    entries.set(name, { size, read() {
      if (method !== 0 && method !== 8) throw new Error(`ZIP entry ${name} uses unsupported compression method ${method}`);
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28), raw = buffer.subarray(start, start + packed);
      const data = method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw);
      if (data.length !== size || checksum(data) !== crc) throw new Error(`ZIP entry ${name} is damaged`);
      return data;
    } });
  }
  return entries;
}
// Deflated ZIP32 with a fixed timestamp and no host metadata, so the same files always give the same bytes
// (for one zlib; the build repacks under the pinned runtime where it can).
export function writeZip(files, { date = new Date(Date.UTC(1980, 0, 1)) } = {}) {
  if (files.size > 65535) throw new Error('ZIP32 supports at most 65,535 entries');
  const time = date.getUTCHours() << 11 | date.getUTCMinutes() << 5 | date.getUTCSeconds() >> 1;
  const day = Math.max(0, date.getUTCFullYear() - 1980) << 9 | (date.getUTCMonth() + 1) << 5 | date.getUTCDate();
  const local = [], central = [];
  let offset = 0;
  for (const [filename, data] of files) {
    if (!/^[\x20-\x7e]+$/.test(filename) || /[\\:*?"<>|]/.test(filename)) throw new Error(`ZIP entry names must be plain ASCII with forward slashes: ${filename}`);
    const deflated = zlib.deflateRawSync(data, { level: 9 }), method = deflated.length < data.length ? 8 : 0, body = method ? deflated : data;
    const name = Buffer.from(filename), crc = checksum(data), header = Buffer.alloc(30), entry = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(method, 8); header.writeUInt16LE(time, 10); header.writeUInt16LE(day, 12);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(body.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(method, 10); entry.writeUInt16LE(time, 12); entry.writeUInt16LE(day, 14);
    entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(body.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    local.push(header, name, body); central.push(entry, name); offset += 30 + name.length + body.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  if (offset + directory.length + 22 > 0xffffffff) throw new Error('Archive exceeds the ZIP32 byte budget');
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.size, 8); end.writeUInt16LE(files.size, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
// Reads the regular files of a gzip-compressed tar archive as name -> { size, mode, read() }. Long names in the
// ustar prefix, GNU "L" records and pax "path" records are followed; links and directories are skipped.
export function readTarGz(buffer) {
  const tar = zlib.gunzipSync(buffer), entries = new Map(), text = (at, length) => { const end = tar.indexOf(0, at); return tar.toString('utf8', at, end === -1 || end > at + length ? at + length : end); };
  let longName = null;
  for (let at = 0; at + 512 <= tar.length && tar[at] !== 0;) {
    const size = parseInt(text(at + 124, 12).trim() || '0', 8), type = String.fromCharCode(tar[at + 156] || 48), start = at + 512;
    if (!Number.isFinite(size) || start + size > tar.length) throw new Error('Damaged tar archive');
    const stored = text(at + 257, 5) === 'ustar' && tar[at + 345] ? `${text(at + 345, 155)}/${text(at, 100)}` : text(at, 100);
    if (type === 'L') longName = text(start, size);
    else if (type === 'x') { const record = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(tar.toString('utf8', start, start + size)); if (record) longName = record[1]; }
    else { if (type === '0' || type === '7') entries.set(longName ?? stored, { size, mode: parseInt(text(at + 100, 8).trim(), 8) & 0o777, read: () => tar.subarray(start, start + size) }); longName = null; }
    at = start + Math.ceil(size / 512) * 512;
  }
  return entries;
}
// ustar in gzip, written by hand so that no clock, user name or host system leaks into the bytes: fixed owner 0,
// the given time on every entry, and a gzip header that always says "Unix". `modes` gives a file's permission bits.
export function writeTarGz(files, { date = new Date(Date.UTC(1980, 0, 1)), modes = new Map() } = {}) {
  const blocks = [], octal = (value, length) => value.toString(8).padStart(length - 1, '0') + '\0', seconds = Math.floor(date.getTime() / 1000);
  for (const [filename, data] of files) {
    if (!/^[\x20-\x7e]+$/.test(filename) || filename.includes('\\') || filename.startsWith('/')) throw new Error(`tar entry names must be plain ASCII, relative, with forward slashes: ${filename}`);
    // Names over 100 bytes are split at a slash into the 155-byte prefix field.
    let name = filename, prefix = '';
    if (name.length > 100) { const cut = name.lastIndexOf('/', 155); prefix = name.slice(0, cut); name = name.slice(cut + 1); if (cut < 1 || name.length > 100) throw new Error(`tar entry name is too long: ${filename}`); }
    const header = Buffer.alloc(512);
    header.write(name, 0, 'latin1'); header.write(octal(modes.get(filename) ?? 0o644, 8), 100); header.write(octal(0, 8), 108); header.write(octal(0, 8), 116);
    header.write(octal(data.length, 12), 124); header.write(octal(seconds, 12), 136); header.fill(32, 148, 156); header.write('0', 156);
    header.write('ustar\0' + '00', 257, 'latin1'); header.write(prefix, 345, 'latin1');
    header.write(octal(header.reduce((sum, byte) => sum + byte, 0), 7) + ' ', 148);
    blocks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  const tar = Buffer.concat(blocks), body = zlib.deflateRawSync(tar, { level: 9 }), trailer = Buffer.alloc(8);
  trailer.writeUInt32LE(checksum(tar), 0); trailer.writeUInt32LE(tar.length % 0x100000000, 4);
  // ID, deflate, no flags, no time, "best compression", system 3 (Unix).
  return Buffer.concat([Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 2, 3]), body, trailer]);
}
const readArchive = (format, buffer) => format === 'zip' ? readZip(buffer) : readTarGz(buffer);

async function walk(base, relative) {
  const found = [], entries = await readdir(path.join(base, relative), { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const file = `${relative}/${entry.name}`;
    if (['.DS_Store', 'Thumbs.db', 'node_modules', '.git'].includes(entry.name)) continue;
    if (entry.isDirectory()) found.push(...await walk(base, file)); else if (entry.isFile()) found.push(file);
  }
  return found;
}
// Everything `npm pack` ships: package.json and the entries of its `files` list. A test compares this with npm's own list.
export async function packageFiles(base = root) {
  const found = [];
  for (const entry of ['package.json', ...JSON.parse(await readFile(path.join(base, 'package.json'), 'utf8')).files]) {
    if ((await stat(path.join(base, entry))).isDirectory()) found.push(...await walk(base, entry)); else found.push(entry);
  }
  return found.sort();
}
// The Studio is a user's download, so it leaves out the files written for contributors in a checkout: AGENTS.md (the
// maintainer rules, which a user's coding agent would read as its own in that folder) and llms.txt (a checkout's
// index). npm still ships both.
export const NOT_IN_STUDIO = ['AGENTS.md', 'llms.txt'];
export const studioFiles = async (base = root) => (await packageFiles(base)).filter(file => !NOT_IN_STUDIO.includes(file));
// The commit a build is made from. A build is only named after a commit when every shipped file is tracked and
// unmodified at it; otherwise the build is marked as a development build. A clean state also carries `read`, which
// returns a shipped file's bytes from the commit itself: git calls a file unmodified when only its line endings
// differ, so two working copies of one commit can hold different bytes.
export async function sourceState(base = root) {
  const git = (...args) => execFileSync('git', ['-c', 'core.quotepath=off', ...args], { cwd: base, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 });
  const shipped = [...await studioFiles(base), ...await walk(base, 'packaging')], inputs = [...shipped, 'scripts/build-studio.mjs', 'scripts/environment.mjs'];
  let state;
  try {
    const commit = git('rev-parse', 'HEAD').trim(), date = new Date(Number(git('log', '-1', '--format=%ct').trim()) * 1000);
    const tracked = new Set(git('ls-files', '-z', '--', ...inputs).split('\0'));
    const changed = git('status', '--porcelain', '-z', '--untracked-files=all', '--', ...inputs).split('\0').filter(Boolean).map(line => line.slice(3));
    state = { commit, date, dirty: [...new Set([...changed, ...inputs.filter(file => !tracked.has(file))])].sort() };
  } catch { return { commit: null, date: new Date(Date.UTC(1980, 0, 1)), dirty: ['(not a git checkout)'] }; }
  if (state.dirty.length) return state;
  const output = execFileSync('git', ['cat-file', '--batch'], { cwd: base, input: shipped.map(file => `${state.commit}:${file}\n`).join(''), maxBuffer: 1024 * 1024 * 1024 }), blobs = new Map();
  for (let at = 0, i = 0; i < shipped.length; i++) {
    const end = output.indexOf(10, at), [, type, size] = output.toString('latin1', at, end).split(' ');
    if (type !== 'blob') throw new Error(`${shipped[i]} is not a file in commit ${state.commit}`);
    blobs.set(shipped[i], output.subarray(end + 1, end + 1 + Number(size))); at = end + 2 + Number(size);
  }
  return { ...state, read: file => blobs.get(file) };
}

// The pinned runtime for `name`: its node program and license, from --node-archive, the cache or nodejs.org.
async function nodeRuntime(name, { nodeArchive, cache, log }) {
  const target = TARGETS[name], file = nodeArchive ?? path.join(cache, target.archive);
  let archive;
  try { archive = await readFile(file); } catch (error) {
    if (error.code !== 'ENOENT' || nodeArchive) throw error;
    log(`Downloading ${target.url}`);
    const response = await fetch(target.url);
    if (!response.ok) throw new Error(`Download failed with status ${response.status}: ${target.url}`);
    archive = Buffer.from(await response.arrayBuffer());
    if (sha256(archive) === target.sha256) { await mkdir(cache, { recursive: true }); await writeFile(file, archive); }
  }
  if (sha256(archive) !== target.sha256) throw new Error(`${nodeArchive ? file : target.url} has SHA-256 ${sha256(archive)}, not the pinned ${target.sha256}. Nothing was built.${nodeArchive ? '' : ` If ${file} exists, delete it and try again.`}`);
  const entries = readArchive(target.format, archive), folder = target.archive.replace(/\.(zip|tar\.gz)$/, ''), exe = entries.get(`${folder}/${target.binary}`).read(), license = entries.get(`${folder}/LICENSE`).read();
  if (sha256(exe) !== target.binarySha256) throw new Error(`${target.binary} in ${target.archive} has SHA-256 ${sha256(exe)}, not the pinned ${target.binarySha256}. Nothing was built.`);
  return { version: NODE_VERSION, exe, license, origin: target.url, archiveSha256: target.sha256 };
}
// Keeps the lines of the "#if" blocks that name this system and drops the others.
export function forSystem(text, os) {
  const lines = [];
  let keep = true, open = false;
  for (const line of text.split(/\r?\n/)) {
    const block = /^#if((?: (?:windows|macos|linux))+)$/.exec(line);
    if (block) { if (open) throw new Error('#if blocks cannot be nested'); open = true; keep = block[1].trim().split(' ').includes(os); }
    else if (line === '#endif') { if (!open) throw new Error('#endif without #if'); open = false; keep = true; }
    else if (line.startsWith('#if') || line.startsWith('#end')) throw new Error(`Unreadable condition: ${line}`);
    else if (keep) lines.push(line);
  }
  if (open) throw new Error('#if without #endif');
  return lines.join('\n');
}
// Lays out one target's build as a map of archive paths to bytes, with permission bits for the files that need
// them. `runtime` is { version, exe, license, origin } and `source` is { commit, date, dirty, read? }; tests pass
// stand-ins for both. Without `read` the working copy is used.
export async function assembleStudio({ runtime, source, target = 'win-x64', base = root }) {
  const { os, format, binary } = TARGETS[target], windows = os === 'windows', read = source.read ?? (file => readFile(path.join(base, file))), release = Boolean(source.commit) && source.dirty.length === 0;
  const { version } = JSON.parse((await read('package.json')).toString()), name = `PixelboltStudio-${version}${release ? '' : '-dev'}-${target}`, files = new Map(), modes = new Map();
  // Windows batch files need CRLF to parse reliably and Notepad users expect it in text files; shell scripts need LF.
  const lines = (bytes, ending) => Buffer.from(bytes.toString('utf8').replace(/\r?\n/g, ending));
  for (const file of await studioFiles(base)) files.set(`app/${file}`, await read(file));
  modes.set('app/bin/pixelbolt.js', 0o755);
  modes.set('app/bin/pixelforge.js', 0o755);
  for (const folder of PACKAGING[os]) for (const file of await walk(base, `packaging/${folder}`)) {
    const inside = file.slice(`packaging/${folder}/`.length), text = inside === 'START HERE.txt' ? Buffer.from(forSystem((await read(file)).toString('utf8'), os)) : await read(file);
    files.set(inside, windows ? (/\.(cmd|txt)$/.test(inside) ? lines(text, '\r\n') : text) : lines(text, '\n'));
    if (folder !== 'common') modes.set(inside, 0o755);
  }
  const node = windows ? 'runtime/node.exe' : 'runtime/node';
  files.set(node, runtime.exe); modes.set(node, 0o755); files.set('runtime/NODE-LICENSE.txt', runtime.license);
  files.set('BUILD-INFO.txt', lines(Buffer.from([
    `Pixelbolt Studio, portable build for ${{ 'win-x64': '64-bit Windows', 'linux-x64': '64-bit Linux (x64)', 'linux-arm64': '64-bit Linux (ARM64)','darwin-arm64': 'macOS on Apple silicon', 'darwin-x64': 'macOS on Intel' }[target]}`, '',
    `Pixelbolt version: ${version}`,
    'Source: https://github.com/skulitom/Pixelbolt',
    `Source commit: ${source.commit ?? 'unknown'}${release ? '' : ' with uncommitted changes (development build, not a release)'}`,
    `Source commit date: ${source.date.toISOString()}`,
    `Target: ${target}`,
    `Node.js version: ${runtime.version}`,
    `Node.js origin: ${runtime.origin}`,
    ...(runtime.archiveSha256 ? [`Node.js archive SHA-256: ${runtime.archiveSha256}`] : []),
    `Node.js program SHA-256: ${sha256(runtime.exe)}`, '',
    `The node program in the runtime folder is the official Node.js binary (${binary} in that archive), unmodified.`,
    `To rebuild this archive, check out the source commit and run: node scripts/build-studio.mjs --target ${target}`, ''
  ].join('\n')), windows ? '\r\n' : '\n'));
  const sorted = [...files].sort(([a], [b]) => (a < b ? -1 : 1));
  return { name, version, release, target, format, files: new Map(sorted.map(([file, bytes]) => [`${name}/${file}`, bytes])), modes: new Map(windows ? [] : [...modes].map(([file, mode]) => [`${name}/${file}`, mode])) };
}
export const manifest = files => [...files].map(([file, bytes]) => `${sha256(bytes)}  ${String(bytes.length).padStart(9)}  ${file}\n`).join('');
export const packStudio = (build, date) => build.format === 'zip' ? writeZip(build.files, { date }) : writeTarGz(build.files, { date, modes: build.modes });

async function main(argv) {
  const options = { out: 'dist' };
  for (let i = 0; i < argv.length; i++) {
    if (['--check', '--force', '--allow-dirty'].includes(argv[i])) options[argv[i].slice(2)] = true;
    else if (['--out', '--node-archive', '--target'].includes(argv[i]) && argv[i + 1]) options[argv[i].slice(2)] = argv[++i];
    else throw new Error(`Unknown or incomplete option: ${argv[i]}`);
  }
  const host = hostTarget(), names = options.target === 'all' ? Object.keys(TARGETS) : [options.target ?? host];
  if (!names[0]) throw new Error(`No build is pinned for this machine (${process.platform}-${process.arch}); name one with --target ${Object.keys(TARGETS).join('|')}`);
  for (const name of names) if (!Object.hasOwn(TARGETS, name)) throw new Error(`Unknown target: ${name}. Choose ${Object.keys(TARGETS).join(', ')} or all.`);
  if (options['node-archive'] && names.length > 1) throw new Error('--node-archive names the runtime of one target; build that target on its own');
  const out = path.resolve(options.out), cache = path.join(root, 'dist', '.cache'), fetched = { cache, log: console.log };
  const source = await sourceState();
  if (source.dirty.length && !options['allow-dirty']) throw new Error(`These shipped files differ from the commit:\n  ${source.dirty.slice(0, 12).join('\n  ')}${source.dirty.length > 12 ? `\n  and ${source.dirty.length - 12} more` : ''}\nCommit them first, or pass --allow-dirty for a development build that is marked as one.`);
  // Deflate output can differ between zlib builds, so where a runtime is pinned for this machine the packing runs
  // under that runtime itself.
  if (host && process.versions.node !== NODE_VERSION && !studioPacker()) {
    const packer = path.join(cache, `node-v${NODE_VERSION}-${host}${TARGETS[host].os === 'windows' ? '.exe' : ''}`);
    if (await readFile(packer).then(bytes => sha256(bytes) !== TARGETS[host].binarySha256, () => true)) { await mkdir(cache, { recursive: true }); await writeFile(packer, (await nodeRuntime(host, fetched)).exe); await chmod(packer, 0o755); }
    const child = spawnSync(packer, [fileURLToPath(import.meta.url), ...argv], { stdio: 'inherit', env: { ...process.env, PIXELBOLT_STUDIO_PACKER: '1' } });
    if (child.error) throw child.error;
    process.exitCode = child.status ?? 1; return;
  }
  if (process.versions.node !== NODE_VERSION) console.log(`Packed with Node.js ${process.versions.node}; byte-identical archives are only promised when packing runs under ${NODE_VERSION}.`);
  for (const name of names) {
    const runtime = await nodeRuntime(name, { ...fetched, nodeArchive: options['node-archive'] && path.resolve(options['node-archive']) });
    const build = await assembleStudio({ runtime, source, target: name }), archive = packStudio(build, source.date), filename = `${build.name}.${build.format}`;
    const target = path.join(out, filename), existing = await readFile(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    const summary = `${filename}\n  ${build.files.size} files, ${archive.length} bytes\n  SHA-256 ${sha256(archive)}\n  Pixelbolt ${build.version} at ${source.commit ?? 'an unknown commit'}${build.release ? '' : ' with uncommitted changes (development build)'}, Node.js ${runtime.version}`;
    if (existing?.equals(archive)) { console.log(`${options.check ? 'Reproduced' : 'Unchanged'}: ${summary}`); continue; }
    if (options.check) {
      if (!existing) throw new Error(`Nothing to check: ${target} does not exist.`);
      const before = new Map([...readArchive(build.format, existing)].map(([file, entry]) => [file, sha256(entry.read())])), after = new Map([...build.files].map(([file, bytes]) => [file, sha256(bytes)]));
      const differing = [...new Set([...before.keys(), ...after.keys()])].filter(file => before.get(file) !== after.get(file)).sort();
      if (differing.length) throw new Error(`${target} was not reproduced. Files that differ:\n  ${differing.slice(0, 20).join('\n  ')}`);
      console.log(`Reproduced file for file (same list and per-file SHA-256); the archive bytes differ, so it was packed by another zlib: ${summary}`); continue;
    }
    if (existing && !options.force) throw new Error(`${target} already exists with different contents. One version names one build: bump the version, choose another --out, or pass --force.`);
    await mkdir(out, { recursive: true });
    await writeFile(target, archive);
    await writeFile(`${target}.sha256`, `${sha256(archive)}  ${filename}\n`);
    await writeFile(path.join(out, `${build.name}.manifest.txt`), manifest(build.files));
    console.log(`Wrote ${target}\n${summary}`);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
