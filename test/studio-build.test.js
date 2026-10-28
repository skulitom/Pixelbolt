import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createZip } from '../src/export.js';
import { browserChannel, studioPacker } from '../scripts/environment.mjs';
import { root, TARGETS, hostTarget, readZip, writeZip, readTarGz, writeTarGz, forSystem, packageFiles, studioFiles, NOT_IN_STUDIO, sourceState, assembleStudio, packStudio, manifest, sha256, download } from '../scripts/build-studio.mjs';

const source = { commit: 'c0ffee'.padEnd(40, '0'), date: new Date(Date.UTC(2026, 9, 2, 12, 30, 44)), dirty: [] };
const standIn = { version: process.versions.node, exe: Buffer.from('MZ stand-in for node.exe'), license: Buffer.from('Node.js license\n'), origin: 'a test stand-in' };

test('new environment names take precedence and old names remain fallbacks when unset', () => {
  for (const [read, suffix] of [[browserChannel, 'BROWSER_CHANNEL'], [studioPacker, 'STUDIO_PACKER']]) {
    const current = `PIXELBOLT_${suffix}`, legacy = `PIXELFORGE_${suffix}`;
    assert.equal(read({}), undefined);
    assert.equal(read({ [legacy]: 'old' }), 'old');
    assert.equal(read({ [current]: 'new' }), 'new');
    assert.equal(read({ [legacy]: 'old', [current]: 'new' }), 'new');
    assert.equal(read({ [legacy]: 'old', [current]: '' }), '');
  }
});

test('the build ZIP is deterministic, compressed where it helps and read back exactly', () => {
  const files = new Map([['top/text.txt', Buffer.from('pixel '.repeat(400))], ['top/noise.bin', Buffer.from(Array.from({ length: 64 }, (_, i) => i * 37 % 256))], ['top/empty', Buffer.alloc(0)]]);
  const zip = writeZip(files, { date: source.date }), entries = readZip(zip);
  assert.ok(zip.equals(writeZip(files, { date: source.date })));
  assert.deepEqual([...entries].map(([name, entry]) => [name, entry.read()]), [...files]);
  // Local headers: the text is deflated (8), the incompressible bytes are stored (0); the DOS stamp is the given UTC time.
  assert.deepEqual([zip.readUInt16LE(8), zip.readUInt16LE(10), zip.readUInt16LE(12)], [8, 12 << 11 | 30 << 5 | 22, 46 << 9 | 10 << 5 | 2]);
  assert.equal(zip.readUInt16LE(zip.indexOf('top/noise.bin') - 30 + 8), 0);
  assert.ok(zip.length < 1000);
  for (const name of ['top\\file', 'tòp/file', 'C:/file']) assert.throws(() => writeZip(new Map([[name, Buffer.alloc(1)]])), /plain ASCII/);
  const damaged = Buffer.from(zip); damaged[zip.indexOf('top/noise.bin') + 'top/noise.bin'.length] ^= 1;
  assert.throws(() => readZip(damaged).get('top/noise.bin').read(), /damaged/);
  assert.throws(() => readZip(Buffer.alloc(64)), /Not a ZIP/);
  // The studio's own store-mode exports read back through the same reader.
  assert.equal(readZip(createZip(new Map([['preview.html', Buffer.from('<!doctype html>')]]))).get('preview.html').read().toString(), '<!doctype html>');
});
test('the macOS and Linux archive keeps permissions, carries no host details and is read back exactly', async t => {
  const long = `top/${'deep/'.repeat(22)}file.txt`, files = new Map([['top/run', Buffer.from('#!/bin/sh\necho hi\n')], ['top/text.txt', Buffer.from('pixel '.repeat(400))], [long, Buffer.from('far down')], ['top/empty', Buffer.alloc(0)]]);
  const modes = new Map([['top/run', 0o755]]), archive = writeTarGz(files, { date: source.date, modes }), entries = readTarGz(archive);
  assert.ok(archive.equals(writeTarGz(files, { date: source.date, modes })));
  assert.deepEqual([...entries].map(([name, entry]) => [name, entry.mode, entry.read().toString()]), [...files].map(([name, data]) => [name, name === 'top/run' ? 0o755 : 0o644, data.toString()]));
  // gzip header: deflate, no flags, no timestamp, and always "Unix", whatever system packed it.
  assert.deepEqual([...archive.subarray(0, 10)], [0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 2, 3]);
  assert.ok(long.length > 100 && archive.length < 600);
  for (const name of ['/top/file', 'top\\file', 'tòp/file', `top/${'x'.repeat(120)}`]) assert.throws(() => writeTarGz(new Map([[name, Buffer.alloc(1)]])), /tar entry name/);
  // The system's own tar reads it the same way: names, bytes, the time and, where there are any, permission bits.
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelbolt-tar-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  await writeFile(path.join(dir, 'archive.tar.gz'), archive);
  const extracted = spawnSync('tar', ['-xzf', 'archive.tar.gz'], { cwd: dir, encoding: 'utf8' });
  if (extracted.error) { t.diagnostic('no tar program on this machine'); return; }
  assert.equal(extracted.status, 0, extracted.stderr);
  for (const [name, data] of files) assert.ok(data.equals(await readFile(path.join(dir, name))), name);
  const { mode, mtime } = await stat(path.join(dir, 'top', 'run'));
  assert.equal(mtime.getTime(), source.date.getTime());
  if (process.platform !== 'win32') assert.deepEqual([mode & 0o777, (await stat(path.join(dir, 'top', 'text.txt'))).mode & 0o777], [0o755, 0o644]);
});
test('START HERE is one text with blocks for each system', () => {
  const text = 'all\n#if windows\nwin\n#endif\n#if macos linux\nunix\n#endif\n#if macos\nmac\n#endif\nend';
  assert.deepEqual([forSystem(text, 'windows'), forSystem(text, 'macos'), forSystem(text, 'linux')], ['all\nwin\nend', 'all\nunix\nmac\nend', 'all\nunix\nend']);
  for (const [broken, message] of [['#if windows\n#if linux\n#endif\n#endif', /nested/], ['#endif', /without #if/], ['#if windows', /without #endif/], ['#if solaris\n#endif', /Unreadable/], ['#ifdef x', /Unreadable/]]) assert.throws(() => forSystem(broken, 'linux'), message);
});
test('the macOS and Linux builds hold shell launchers marked executable, their own START HERE and the right runtime', async () => {
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  for (const [target, system, launchers] of [['linux-x64', 'linux', []], ['linux-arm64', 'linux', []],['darwin-arm64', 'macos', ['Pixelbolt Studio.command', 'Connect your agent.command']], ['darwin-x64', 'macos', ['Pixelbolt Studio.command', 'Connect your agent.command']]]) {
    const build = await assembleStudio({ runtime: standIn, source, target }), inside = file => build.files.get(`${build.name}/${file}`), names = [...build.files.keys()].map(name => name.slice(build.name.length + 1));
    assert.deepEqual([build.name, build.format, TARGETS[target].os], [`PixelboltStudio-${version}-${target}`, 'tar.gz', system]);
    const scripts = ['pixelbolt', 'pixelforge', 'pixelbolt-studio', 'connect-your-agent', ...launchers];
    assert.deepEqual(names.filter(name => !name.includes('/')).sort(), ['BUILD-INFO.txt', 'START HERE.txt', 'THIRD-PARTY-NOTICES.txt', 'first-edit.json', ...scripts].sort());
    assert.deepEqual(names.filter(name => name.startsWith('app/')).map(name => name.slice(4)), await studioFiles());
    assert.ok(inside('runtime/node').equals(standIn.exe)); assert.equal(inside('runtime/node.exe'), undefined);
    // Exactly the programs are executable; everything is LF, and the scripts start with a shell line.
    assert.deepEqual([...build.modes].map(([name, mode]) => [name.slice(build.name.length + 1), mode]).sort(), ['app/bin/pixelbolt.js', 'app/bin/pixelforge.js', 'runtime/node', ...scripts].sort().map(name => [name, 0o755]));
    assert.deepEqual(inside('pixelforge'), inside('pixelbolt'));
    for (const script of scripts) assert.match(inside(script).toString(), /^#!\/bin\/sh\n/, script);
    for (const file of [...scripts, 'START HERE.txt', 'BUILD-INFO.txt', 'launcher/studio.mjs']) assert.ok(!inside(file).includes('\r'), `${file} must use LF`);
    const start = inside('START HERE.txt').toString(), info = inside('BUILD-INFO.txt').toString();
    assert.doesNotMatch(start, /^#|\.cmd|\\pixelforge/m); assert.match(start, /^ {4}\.\/pixelbolt render hero-v2\.pixel\.json --out output\/hero$/m);
    assert.equal(start.includes('Pixelbolt Studio.command'), system === 'macos');
    for (const line of [`Target: ${target}`, `Node.js program SHA-256: ${sha256(standIn.exe)}`, `run: node scripts/build-studio.mjs --target ${target}`]) assert.ok(info.includes(`${line}\n`), line);
    // Packed and read back, the archive carries the same files and the permission bits.
    const packed = readTarGz(packStudio(build, source.date));
    assert.deepEqual([...packed.keys()], [...build.files.keys()]);
    assert.deepEqual([packed.get(`${build.name}/pixelbolt`).mode, packed.get(`${build.name}/START HERE.txt`).mode], [0o755, 0o644]);
  }
  assert.deepEqual([hostTarget('win32', 'x64'), hostTarget('linux', 'x64'), hostTarget('linux', 'arm64'), hostTarget('darwin', 'arm64'), hostTarget('darwin', 'x64'), hostTarget('win32', 'arm64'), hostTarget('freebsd', 'x64')], ['win-x64', 'linux-x64', 'linux-arm64', 'darwin-arm64', 'darwin-x64', undefined, undefined]);
});
test('the build ships exactly the files npm pack ships', async t => {
  const packed = spawnSync('npm pack --dry-run --json', { cwd: root, shell: true, encoding: 'utf8' });
  if (packed.status !== 0) { t.skip('npm is not available'); return; }
  assert.deepEqual(await packageFiles(), JSON.parse(packed.stdout)[0].files.map(file => file.path).sort());
});

test('every relative README link and image is shipped in the portable package', async () => {
  const readme = await readFile(path.join(root, 'README.md'), 'utf8'), shipped = await studioFiles();
  // Inline links/images and reference definitions; a directory is shipped when it contains a packaged file.
  const targets = [...readme.matchAll(/!?\[[^\]\n]*\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/g), ...readme.matchAll(/^ {0,3}\[[^\]\n]+\]:\s*<?([^\s>]+)>?/gm)].map(match => match[1]);
  assert.ok(targets.length > 0);
  const missing = [];
  for (const target of targets) {
    if (/^(?:#|[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue;
    const relative = path.posix.normalize(decodeURIComponent(target.split(/[?#]/)[0])).replace(/\/$/, '');
    if (!shipped.some(file => file === relative || file.startsWith(`${relative}/`))) missing.push(target);
  }
  assert.deepEqual(missing, [], 'README links must resolve inside the shipped package or use an absolute URL');
});

test('the portable layout holds the package, runtime, launchers and build facts, and nothing from development', async () => {
  const build = await assembleStudio({ runtime: standIn, source }), { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(build.name, `PixelboltStudio-${version}-win-x64`);
  const names = [...build.files.keys()], inside = file => build.files.get(`${build.name}/${file}`);
  assert.ok(names.every(name => name.startsWith(`${build.name}/`))); assert.deepEqual(names, [...names].sort());
  assert.deepEqual(names.filter(name => name.startsWith(`${build.name}/app/`)).map(name => name.slice(build.name.length + 5)), await studioFiles());
  // npm ships the contributor files; the Studio, a user's download, leaves them out.
  for (const file of NOT_IN_STUDIO) assert.ok((await packageFiles()).includes(file) && !inside(`app/${file}`), file);
  assert.deepEqual(names.filter(name => /\/(demo|showcase|test|scripts|packaging|output)\//.test(name)), []);
  assert.ok(inside('app/src/server.js').equals(await readFile(path.join(root, 'src', 'server.js'))));
  assert.ok(inside('runtime/node.exe').equals(standIn.exe)); assert.ok(inside('runtime/NODE-LICENSE.txt').equals(standIn.license));
  for (const file of ['Pixelbolt Studio.cmd', 'pixelbolt.cmd', 'pixelforge.cmd', 'Connect your agent.cmd', 'START HERE.txt', 'BUILD-INFO.txt']) assert.ok(!/[^\r]\n/.test(inside(file).toString()), `${file} needs CRLF`);
  assert.deepEqual(inside('pixelforge.cmd'), inside('pixelbolt.cmd'));
  const info = inside('BUILD-INFO.txt').toString();
  for (const line of [`Pixelbolt version: ${version}`, `Source commit: ${source.commit}`, 'Source commit date: 2026-10-02T12:30:44.000Z', 'Target: win-x64', `Node.js version: ${standIn.version}`, `Node.js program SHA-256: ${sha256(standIn.exe)}`]) assert.ok(info.includes(`${line}\r\n`), line);
  assert.equal(manifest((await assembleStudio({ runtime: standIn, source })).files), manifest(build.files));
  // Uncommitted changes never produce a build that carries a release name.
  const dev = await assembleStudio({ runtime: standIn, source: { ...source, dirty: ['src/core.js'] } });
  assert.equal(dev.name, `PixelboltStudio-${version}-dev-win-x64`);
  assert.match(dev.files.get(`${dev.name}/BUILD-INFO.txt`).toString(), /with uncommitted changes \(development build, not a release\)/);
});
test('a release build takes its files from the commit, whatever line endings the working copy holds', async t => {
  const tempRoot = path.resolve(os.tmpdir()), repo = await mkdtemp(path.join(tempRoot, 'pixelbolt-source-'));
  t.after(async () => { assert.ok(repo.startsWith(tempRoot + path.sep)); await rm(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });
  const git = (...args) => spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' });
  if (git('init', '-q').status !== 0) { t.skip('git is not available'); return; }
  const write = async (file, text) => { await mkdir(path.dirname(path.join(repo, file)), { recursive: true }); await writeFile(path.join(repo, file), text); };
  await write('.gitattributes', '* text=auto eol=lf\n'); await write('package.json', JSON.stringify({ version: '9.9.9', files: ['notes.txt', 'AGENTS.md'] }) + '\n');
  await write('AGENTS.md', 'maintainer rules\n');
  // Saved with Windows line endings and then added: git stores LF and calls the CRLF working copy unmodified.
  await write('notes.txt', 'one\r\ntwo\r\n'); await write('packaging/windows/run.cmd', '@echo off\n'); await write('scripts/build-studio.mjs', '\n');
  await write('scripts/environment.mjs', '\n');
  git('add', '-A'); assert.equal(git('commit', '-q', '-m', 'fixture').status, 0);
  assert.equal(await readFile(path.join(repo, 'notes.txt'), 'utf8'), 'one\r\ntwo\r\n');
  const clean = await sourceState(repo);
  assert.deepEqual(clean.dirty, []); assert.match(clean.commit, /^[0-9a-f]{40}$/);
  const build = await assembleStudio({ runtime: standIn, source: clean, base: repo });
  assert.equal(build.name, 'PixelboltStudio-9.9.9-win-x64');
  assert.equal(build.files.get(`${build.name}/app/notes.txt`).toString(), 'one\ntwo\n');
  assert.equal(build.files.get(`${build.name}/run.cmd`).toString(), '@echo off\r\n');
  assert.equal(build.files.get(`${build.name}/app/AGENTS.md`), undefined);
  // A file the Studio leaves out doesn't make it a development build when only that file is edited.
  await write('AGENTS.md', 'edited rules\n');
  assert.deepEqual((await sourceState(repo)).dirty, []);
  // A real edit or an untracked shipped file makes it a development build, which is read from the working copy.
  await write('notes.txt', 'one\r\nthree\r\n'); await write('packaging/windows/extra.txt', 'new\n');
  const edited = await sourceState(repo), dev = await assembleStudio({ runtime: standIn, source: edited, base: repo });
  assert.deepEqual(edited.dirty, ['notes.txt', 'packaging/windows/extra.txt']); assert.equal(edited.read, undefined);
  assert.equal(dev.files.get('PixelboltStudio-9.9.9-dev-win-x64/app/notes.txt').toString(), 'one\r\nthree\r\n');
});

test('a runtime download tries again after a dropped connection, a stall, a server error or wrong bytes, and stops at three tries', async () => {
  // A stand-in for fetch: each try answers with the next reply. A stalled body sends one chunk and then nothing, until
  // the download gives the try up through its signal, as a real connection would.
  const archive = Buffer.from('node runtime archive'), url = 'https://nodejs.org/dist/stand-in.tar.gz';
  const body = (...chunks) => new ReadableStream({ start(stream) { for (const chunk of chunks) stream.enqueue(chunk); stream.close(); } });
  const replies = {
    ok: () => new Response(body(archive.subarray(0, 4), archive.subarray(4))),
    dropped: () => { throw new TypeError('fetch failed', { cause: new Error('terminated') }); },
    unavailable: () => new Response('busy', { status: 503 }),
    missing: () => new Response('no such file', { status: 404 }),
    wrong: () => new Response(body(Buffer.from('a captive portal page'))),
    stalled: signal => new Response(new ReadableStream({ start(stream) { stream.enqueue(archive.subarray(0, 4)); signal.addEventListener('abort', () => stream.error(signal.reason)); } }))
  };
  const attempt = async (...sequence) => {
    const logged = [], waits = [];
    let tries = 0;
    const fetch = async (address, { signal }) => { assert.equal(address, url); return replies[sequence[tries++]](signal); };
    const result = download(url, { fetch, stall: 50, log: line => logged.push(line), wait: async ms => { waits.push(ms); }, accept: bytes => bytes.equals(archive) });
    return { result: await result.then(bytes => bytes, error => error), logged, waits, tries };
  };
  for (const first of ['dropped', 'unavailable', 'stalled', 'wrong']) {
    const { result, logged, waits, tries } = await attempt(first, 'ok');
    assert.ok(Buffer.isBuffer(result) && result.equals(archive), `${first}: ${result.message ?? result}`);
    assert.equal(tries, 2); assert.deepEqual(waits, [3000]);
    assert.equal(logged.length, 1); assert.match(logged[0], /^Download of https:\/\/nodejs\.org\/dist\/stand-in\.tar\.gz failed \(.+\); trying again in 3 s \(try 2 of 3\)$/);
  }
  assert.match((await attempt('stalled', 'ok')).logged[0], /\(no data for 0\.05 s\)/);
  assert.match((await attempt('dropped', 'ok')).logged[0], /\(fetch failed \(terminated\)\)/);
  // A missing file is not tried again; three failures end the download with the last reason.
  const missing = await attempt('missing', 'ok');
  assert.equal(missing.tries, 1); assert.equal(missing.result.message, `Download failed (status 404): ${url}`);
  const failing = await attempt('dropped', 'unavailable', 'dropped', 'ok');
  assert.equal(failing.tries, 3); assert.deepEqual(failing.waits, [3000, 9000]);
  assert.equal(failing.result.message, `Download failed after 3 tries (fetch failed (terminated)): ${url}`);
  // Bytes still wrong on the last try come back, so the build's own SHA-256 check names them.
  const wrong = await attempt('wrong', 'wrong', 'wrong');
  assert.equal(wrong.tries, 3); assert.equal(wrong.result.toString(), 'a captive portal page');
});
