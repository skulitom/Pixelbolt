import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { browserCommand, STUDIO_PORT } from '../src/server.js';
import { root, hostTarget, assembleStudio } from '../scripts/build-studio.mjs';
import { verifyStudio } from '../scripts/verify-studio.mjs';

// The launchers and the release checks start studios that want the usual port, so they stay in one file, one after
// another. What a build holds is tested in studio-build.test.js, which runs alongside this file.
const source = { commit: 'c0ffee'.padEnd(40, '0'), date: new Date(Date.UTC(2026, 9, 2, 12, 30, 44)), dirty: [] };
const standIn = { version: process.versions.node, exe: Buffer.from('MZ stand-in for node.exe'), license: Buffer.from('Node.js license\n'), origin: 'a test stand-in' };
const launcher = (script, ...args) => [process.execPath, [path.join(root, 'packaging', 'common', 'launcher', script), ...args]];

test('the launcher is preview with a browser: the usual port, a free one beside it, and a dropped recipe opens', async t => {
  const start = (...dropped) => new Promise((resolve, reject) => {
    const child = spawn(...launcher('studio.mjs', '--no-browser', ...dropped), { stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    t.after(() => child.kill());
    child.stdout.on('data', chunk => { text += chunk; const address = /Pixelbolt studio: (http:\/\/127\.0\.0\.1:(\d+))/.exec(text); if (address && /Press Ctrl\+C to stop\./.test(text)) resolve({ child, url: address[1], port: Number(address[2]), text }); });
    child.once('error', reject); child.once('exit', code => reject(new Error(`exited with ${code}: ${text}`)));
  });
  // Drafts are stored per address, so the same port every time is what lets a draft be found again.
  const usualFree = await new Promise(resolve => { const probe = http.createServer(); probe.once('error', () => resolve(false)); probe.listen(STUDIO_PORT, '127.0.0.1', () => probe.close(() => resolve(true))); });
  const first = await start(), second = await start(path.join(root, 'examples', 'coin.json'));
  assert.match(first.text, /^Pixelbolt Studio \d+\.\d+\.\d+\r?\n\r?\nClose this window or press Ctrl\+C to stop it\./);
  if (usualFree) { assert.equal(first.port, STUDIO_PORT); assert.doesNotMatch(first.text, /is in use/); }
  assert.notEqual(second.port, STUDIO_PORT); assert.match(second.text, /Port 4747 is in use, so this studio has another address/);
  assert.notEqual(first.url, second.url);
  for (const { url } of [first, second]) assert.match(await (await fetch(url)).text(), /<title>Pixelbolt · Sprite studio<\/title>/);
  // A file handed to the launcher, as Explorer does for one dragged onto it, is the studio's project.
  assert.equal(await (await fetch(`${first.url}/project.json`)).json(), null);
  assert.equal((await (await fetch(`${second.url}/project.json`)).json()).name, 'coin');
  // A port named on the command line is used or refused, never swapped for another.
  const busy = spawnSync(process.execPath, ['bin/pixelbolt.js', 'preview', '--port', String(first.port)], { cwd: root, encoding: 'utf8' });
  assert.equal(busy.status, 1); assert.match(JSON.parse(busy.stderr).error, /EADDRINUSE/);
  const exits = [first, second].map(({ child }) => new Promise(resolve => child.once('exit', resolve)));
  first.child.kill(); second.child.kill(); await Promise.all(exits);
  await assert.rejects(fetch(first.url));
  const missing = spawnSync(...launcher('studio.mjs', '--no-browser', 'missing.pixel.json'), { encoding: 'utf8' });
  assert.equal(missing.status, 1); assert.match(JSON.parse(missing.stderr).error, /ENOENT/);
});
test('the browser is opened by each system\'s own handler, with no shell to quote for', () => {
  const url = 'http://127.0.0.1:4747/';
  assert.deepEqual(browserCommand(url, 'win32', { SystemRoot: 'D:\\Windows' }), ['D:\\Windows\\System32\\rundll32.exe', ['url.dll,FileProtocolHandler', url]]);
  assert.deepEqual(browserCommand(url, 'win32', {}), ['C:\\Windows\\System32\\rundll32.exe', ['url.dll,FileProtocolHandler', url]]);
  assert.deepEqual([browserCommand(url, 'darwin', {}), browserCommand(url, 'linux', {})], [['open', [url]], ['xdg-open', [url]]]);
});
test('the connect helper prints the same server for four agents and changes nothing', () => {
  const json = spawnSync(...launcher('connect.mjs', '--json'), { encoding: 'utf8' }), text = spawnSync(...launcher('connect.mjs'), { encoding: 'utf8' });
  assert.equal(json.status, 0, json.stderr); assert.equal(text.status, 0, text.stderr);
  const settings = JSON.parse(json.stdout);
  // From a checkout the helper names the Node that ran it and the repository's own files.
  assert.deepEqual(settings.server, { command: process.execPath, args: [path.join(root, 'bin', 'pixelbolt.js'), 'mcp', '--out', path.join(path.resolve(root), 'output')] });
  assert.deepEqual(settings.clients.map(client => client.name), ['Claude Code', 'Claude Desktop', 'Codex', 'Cursor']);
  for (const client of settings.clients) {
    assert.ok(text.stdout.includes(client.text));
    if (client.format === 'json') assert.deepEqual(JSON.parse(client.text), { mcpServers: { pixelbolt: settings.server } });
    else assert.deepEqual([JSON.parse(/^command = (.*)$/m.exec(client.text)[1]), JSON.parse(/^args = (.*)$/m.exec(client.text)[1])], [settings.server.command, settings.server.args]);
  }
  // The two agents with an "mcp add" command get one line. On Windows the separator is quoted so PowerShell cannot
  // drop it; elsewhere single quotes keep every character of a path literal.
  const quoted = value => process.platform === 'win32' ? `"${value}"` : `'${value.replaceAll("'", "'\\''")}'`;
  const target = `pixelbolt ${process.platform === 'win32' ? '"--"' : '--'} ${quoted(settings.server.command)} ${quoted(settings.server.args[0])} mcp --out ${quoted(settings.server.args[3])}`;
  assert.deepEqual(settings.clients.map(client => client.command), [`claude mcp add --scope user ${target}`, null, `codex mcp add ${target}`, null]);
  for (const client of settings.clients) if (client.command) assert.ok(text.stdout.includes(`\n${client.command}\n`), client.name);
});
test('the Windows connect helper pauses after failure only when started without arguments', async t => {
  const script = await readFile(path.join(root, 'packaging', 'windows', 'Connect your agent.cmd'));
  assert.ok(script.every(byte => byte < 128), 'the batch file must be plain ASCII');
  assert.doesNotMatch(script.toString(), /(?<!\r)\n|\r(?!\n)/, 'the batch file must use CRLF');
  assert.match(script.toString(), /if errorlevel 1 \(\r\n  if "%~1"=="" pause\r\n  exit \/b 1\r\n\)/);
  if (process.platform !== 'win32') return;
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelbolt-connect-failed-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  await mkdir(path.join(dir, 'runtime'));
  await writeFile(path.join(dir, 'runtime', 'node.exe'), standIn.exe);
  await writeFile(path.join(dir, 'Connect your agent.cmd'), script);
  const child = spawn('cmd.exe', ['/d', '/c', '"Connect your agent.cmd" --json'], { cwd: dir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { child.stdin.destroy(); child.kill(); });
  // Leave stdin open: an accidental pause cannot be satisfied by EOF.
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('the helper did not exit without waiting for input')); }, 5000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); resolve(code); });
  });
  assert.equal(result, 1);
});
test('an assembled build passes the release checks from a folder with a space and an accent', async t => {
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelbolt studio é-'));
  // Windows can hold a program's file for a moment after it exits, so the folder gets a few tries. rm's own maxRetries
  // retries again at every level of the tree, which for a file that stays locked comes to many minutes.
  t.after(async () => {
    assert.ok(dir.startsWith(tempRoot + path.sep));
    for (let attempt = 1; ; attempt++) {
      try { await rm(dir, { recursive: true, force: true }); return; }
      catch (error) { if (attempt === 5) throw error; await new Promise(resolve => setTimeout(resolve, 200 * attempt)); }
    }
  });
  // Where a build is pinned for this machine, the Node running the tests stands in for the pinned runtime, so the
  // launcher scripts really run. Elsewhere the Windows layout is checked for its contents only.
  const target = hostTarget(), runtime = target ? { ...standIn, exe: await readFile(process.execPath) } : standIn;
  const build = await assembleStudio({ runtime, source, target: target ?? 'win-x64' });
  for (const [file, bytes] of build.files) { await mkdir(path.dirname(path.join(dir, file)), { recursive: true }); await writeFile(path.join(dir, file), bytes, { mode: build.modes.get(file) ?? 0o644 }); }
  const lines = [], outcome = await verifyStudio({ dir: path.join(dir, build.name), pinned: false, log: line => lines.push(line) });
  assert.ok(outcome.ok, lines.join('\n')); assert.equal(outcome.complete, Boolean(target), lines.join('\n'));
  assert.ok(outcome.results.length >= (target ? 25 : 5), lines.join('\n'));
});
