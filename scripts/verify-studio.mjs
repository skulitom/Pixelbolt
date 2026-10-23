// Tests a built portable Studio the way a stranger's computer would run it: extracted with the system's own tool
// into a folder whose path has a space and a non-ASCII character, with no Node.js on PATH. It checks the layout and
// BUILD-INFO, the launcher, every studio route, the command line exactly as START HERE gives it, the MCP server
// over stdio, the connect helper and its one-line commands, that nothing is written to the user's profile or temp
// folders, and that nothing is left running afterwards. The runtime checks need the system the archive was built
// for; elsewhere only the contents are checked.
//   node scripts/verify-studio.mjs <PixelboltStudio-...zip|.tar.gz> [--allow-dev] [--keep]
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, readdir, rm, realpath, access, stat, chmod, cp, symlink } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NODE_VERSION, NOT_IN_STUDIO, TARGETS, readZip, readTarGz, sha256 } from './build-studio.mjs';

const SHARED = ['START HERE.txt', 'first-edit.json', 'BUILD-INFO.txt', 'THIRD-PARTY-NOTICES.txt', 'runtime/NODE-LICENSE.txt', 'launcher/studio.mjs', 'launcher/connect.mjs', 'launcher/layout.mjs', 'app/package.json', 'app/LICENSE', 'app/bin/pixelbolt.js', 'app/bin/pixelforge.js'];
// What each system starts: the studio launcher, the command line, the connect helper, the runtime, and the names
// START HERE must mention. On macOS the .command files are what Finder runs on a double-click.
const SYSTEMS = {
  windows: { studio: 'Pixelbolt Studio.cmd', cli: 'pixelbolt.cmd', alias: 'pixelforge.cmd', helper: 'Connect your agent.cmd', node: 'runtime/node.exe', scripts: [], named: ['Pixelbolt Studio.cmd', 'Connect your agent.cmd', 'first-edit.json'] },
  macos: { studio: 'pixelbolt-studio', cli: 'pixelbolt', alias: 'pixelforge', helper: 'connect-your-agent', node: 'runtime/node', scripts: ['Pixelbolt Studio.command', 'Connect your agent.command'], named: ['Pixelbolt Studio.command', 'Connect your agent.command', 'pixelbolt-studio', 'connect-your-agent', 'first-edit.json'] },
  linux: { studio: 'pixelbolt-studio', cli: 'pixelbolt', alias: 'pixelforge', helper: 'connect-your-agent', node: 'runtime/node', scripts: [], named: ['pixelbolt-studio', 'connect-your-agent', 'first-edit.json'] }
};
const FORBIDDEN = ['demo', 'showcase', 'test', 'scripts', 'packaging', 'output', 'node_modules', '.git', '.github'];
const COMMANDS = ['init', 'validate', 'inspect', 'patch', 'render', 'gif'];
const USUAL_PORT = 4747;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function tree(base, relative = '') {
  const found = [];
  for (const entry of await readdir(path.join(base, relative), { withFileTypes: true })) {
    const file = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await tree(base, file)); else found.push(file);
  }
  return found.sort();
}

// Verifies `archive`, or an already extracted build in `dir`. `pinned: false` accepts a stand-in runtime (tests).
export async function verifyStudio({ archive, dir, pinned = true, allowDev = false, keep = false, window = Boolean(archive), log = console.log }) {
  const results = [], notes = [];
  const check = async (name, run) => {
    try { const detail = await run(); results.push({ name, ok: true }); log(`  ok    ${name}${detail ? ` (${detail})` : ''}`); }
    catch (error) { results.push({ name, ok: false, error: error.message }); log(`  FAIL  ${name}\n        ${String(error.message).replace(/\n/g, '\n        ')}`); }
  };
  const note = text => { notes.push(text); log(`  note  ${text}`); };
  const host = { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform], windows = host === 'windows';
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows', system = path.join(systemRoot, 'System32'), powershell = path.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), comspec = path.join(system, 'cmd.exe');
  // What a computer without developer tools offers: the system's own folders on PATH and no Node or npm settings.
  // PowerShell 7's module path goes too: Windows PowerShell started with it cannot load its own modules.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(path|psmodulepath|node_.*|npm_.*)$/i.test(key)));
  // Off Windows, node, npm and git usually sit in /usr/bin beside the system's own tools, so PATH there becomes a
  // folder that holds only the two tools the launcher scripts call.
  let toolbox = null;
  if (windows) env.PATH = [system, systemRoot, path.join(system, 'Wbem'), path.dirname(powershell)].join(';');
  else {
    toolbox = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-path-'));
    for (const tool of ['dirname', 'readlink']) await symlink(spawnSync('/bin/sh', ['-c', `command -v ${tool}`], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' }).stdout.trim(), path.join(toolbox, tool));
    env.PATH = toolbox;
  }
  const ps = (script, extra = {}) => spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...env, ...extra }, encoding: 'utf8', windowsHide: true, timeout: 120000 });
  let workspace = null, modes = new Map();

  if (archive) {
    log(`Archive ${archive}`);
    const bytes = await readFile(archive), zip = archive.endsWith('.zip'), name = path.basename(archive).replace(/\.(zip|tar\.gz)$/, '');
    let entries = new Map();
    await check('the .sha256 file beside the archive matches it', async () => {
      const [hash, file] = (await readFile(`${archive}.sha256`, 'utf8')).trim().split(/\s+/);
      assert.equal(hash, sha256(bytes)); assert.equal(file, path.basename(archive)); return hash;
    });
    await check('the archive reads cleanly and holds one top-level folder named after it', () => {
      const listed = zip ? readZip(bytes) : readTarGz(bytes);
      entries = new Map([...listed].map(([file, entry]) => [file, entry.read()])); modes = new Map([...listed].map(([file, entry]) => [file, entry.mode]));
      assert.deepEqual([...new Set([...entries.keys()].map(file => file.split('/')[0]))], [name]); return `${entries.size} files`;
    });
    // mkdtemp keeps the prefix, so every later path carries the space, the accent and (off Windows) the apostrophe.
    workspace = await realpath(await mkdtemp(path.join(os.tmpdir(), windows ? 'Pixelbolt Studio vérifié ' : 'Pixelbolt Studio d\'été ')));
    dir = path.join(workspace, name);
    // Each system's own reader does the extracting where there is one for this kind of archive.
    const own = windows && zip ? 'Windows\' ZIP reader' : !windows && !zip ? 'the system\'s tar' : null;
    await check(`it extracts into "${workspace}"${own ? ` with ${own}, byte for byte` : ''}`, async () => {
      if (own && zip) assert.equal(ps('Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:PF_ZIP, $env:PF_DEST)', { PF_ZIP: path.resolve(archive), PF_DEST: workspace }).status, 0);
      else if (own) { const run = spawnSync('tar', ['-xzf', path.resolve(archive), '-C', workspace], { encoding: 'utf8' }); assert.equal(run.status, 0, run.stderr); }
      else for (const [file, data] of entries) { await mkdir(path.dirname(path.join(workspace, file)), { recursive: true }); await writeFile(path.join(workspace, file), data); if (!windows && modes.get(file)) await chmod(path.join(workspace, file), modes.get(file)); }
      assert.deepEqual(await tree(workspace), [...entries.keys()].sort());
      for (const [file, data] of entries) assert.ok(data.equals(await readFile(path.join(workspace, file))), `${file} differs after extraction`);
    });
  } else dir = await realpath(dir);
  const files = await tree(dir), read = file => readFile(path.join(dir, file), 'utf8');
  const info = Object.fromEntries((await read('BUILD-INFO.txt').catch(() => '')).split(/\r?\n/).map(line => /^([^:]+): (.*)$/.exec(line)?.slice(1)).filter(Boolean));
  const start = await read('START HERE.txt').catch(() => ''), pkg = JSON.parse(await read('app/package.json').catch(() => '{}'));
  const target = TARGETS[info.Target], kind = target?.os ?? 'windows', names = SYSTEMS[kind], unix = kind !== 'windows', node = path.join(dir, names.node);
  const executables = unix ? [names.studio, names.cli, names.alias, names.helper, ...names.scripts, names.node, 'app/bin/pixelbolt.js', 'app/bin/pixelforge.js'] : [];

  log('Contents');
  await check('the launcher, command line, helper, START HERE, BUILD-INFO, notices and runtime are present', () => {
    assert.ok(target, `BUILD-INFO names no known target: ${info.Target}`);
    assert.deepEqual([...SHARED, names.studio, names.cli, names.alias, names.helper, names.node, ...names.scripts].filter(file => !files.includes(file)), []);
    return `${info.Target}`;
  });
  await check(`app/ holds every entry of package.json's files list but the contributor files (${NOT_IN_STUDIO.join(', ')}), and no demo, test or development script`, () => {
    assert.deepEqual(pkg.files.filter(entry => !NOT_IN_STUDIO.includes(entry) && !files.some(file => file === `app/${entry}` || file.startsWith(`app/${entry}/`))), []);
    assert.deepEqual(NOT_IN_STUDIO.filter(entry => files.includes(`app/${entry}`)), []);
    assert.deepEqual(files.filter(file => FORBIDDEN.some(folder => file.startsWith(`${folder}/`) || file.startsWith(`app/${folder}/`)) || /\.test\.[cm]?js$/.test(file)), []);
    return `${files.filter(file => file.startsWith('app/')).length} files`;
  });
  await check('BUILD-INFO names the Pixelbolt version, the source commit and the Node.js runtime with its SHA-256', async () => {
    assert.equal(info['Pixelbolt version'], pkg.version);
    assert.match(info['Source commit'], allowDev ? /^([0-9a-f]{40}|unknown)/ : /^[0-9a-f]{40}$/, 'a release build names a clean commit; pass --allow-dev to accept a development build');
    assert.equal(info['Node.js program SHA-256'], sha256(await readFile(node)));
    if (pinned) { assert.equal(info['Node.js version'], NODE_VERSION); assert.equal(info['Node.js program SHA-256'], target.binarySha256); assert.equal(info['Node.js archive SHA-256'], target.sha256); assert.equal(info['Node.js origin'], target.url); }
    return `Pixelbolt ${pkg.version} at ${info['Source commit'].slice(0, 12)}, Node.js ${info['Node.js version']}`;
  });
  if (unix) await check('the scripts are plain ASCII shell scripts with LF line endings, marked executable', async () => {
    for (const file of [names.studio, names.cli, names.alias, names.helper, ...names.scripts]) {
      const text = await readFile(path.join(dir, file), 'latin1');
      assert.ok(text.startsWith('#!/bin/sh\n') && /^[\x09\x0a\x20-\x7e]*$/.test(text), file);
    }
    // In the archive itself, and on disk wherever the system keeps permission bits.
    for (const file of executables) {
      if (modes.size) assert.equal(modes.get(`${path.basename(dir)}/${file}`), 0o755, `${file} is not marked executable in the archive`);
      if (!windows) assert.ok((await stat(path.join(dir, file))).mode & 0o100, `${file} is not executable after extraction`);
    }
    if (modes.size) assert.deepEqual([...modes].filter(([file, mode]) => mode !== 0o644 && !executables.includes(file.slice(path.basename(dir).length + 1))), []);
    return `${executables.length} executable files`;
  });
  else await check('the batch files are plain ASCII with CRLF line endings', async () => {
    for (const file of files.filter(name => name.endsWith('.cmd'))) {
      const text = await readFile(path.join(dir, file), 'latin1');
      assert.ok(/^[\x09\x0d\x0a\x20-\x7e]*$/.test(text) && !/[^\r]\n/.test(text) && text.includes('\r\n'), file);
    }
  });
  await check('START HERE is written for this system and links the source', () => {
    assert.match(start, /https:\/\/github\.com\/skulitom\/Pixelbolt/); assert.doesNotMatch(start, /^#/m);
    for (const name of names.named) assert.ok(start.includes(name), `START HERE does not mention ${name}`);
    for (const other of Object.values(SYSTEMS).flatMap(system => [system.studio, system.helper, ...system.scripts]).filter(name => !names.named.includes(name))) assert.ok(!start.includes(`"${other}"`), `START HERE mentions ${other}, which is not in this build`);
  });

  // Everything the build itself runs gets per-user and temp folders inside an empty trap, which must stay empty: the
  // build writes nowhere outside its own folder. PowerShell runs and this script's own helpers keep `env`, because
  // Windows PowerShell caches module data in the profile by itself.
  const profile = kind === host ? await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-profile-trap-')) : null, runEnv = { ...env };
  if (profile) for (const key of windows ? ['USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP'] : ['HOME', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME']) {
    // Windows reads environment names in any case, so no second spelling may keep pointing at the real folder.
    for (const name of Object.keys(runEnv)) if (name.toUpperCase() === key) delete runEnv[name];
    runEnv[key] = path.join(profile, key.toLowerCase()); await mkdir(runEnv[key]);
  }
  // The runtime checks need the system the build is for, and a machine that can run its node program.
  const version = kind === host ? spawnSync(node, ['--version'], { env: runEnv, encoding: 'utf8', windowsHide: true }) : null, runnable = version?.status === 0;
  if (kind !== host) note(`Runtime checks skipped: this is a ${info.Target} build and this machine runs ${host}.`);
  else if (!runnable) note(`Runtime checks skipped: this machine cannot run the ${info.Target} runtime (${version.error?.message ?? (version.stderr.trim() || `exit ${version.status}`)}).`);
  else {
    const shell = (line, options = {}) => windows
      ? spawnSync(comspec, ['/d', '/s', '/c', `"${line}"`], { cwd: dir, env: runEnv, encoding: 'utf8', windowsVerbatimArguments: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, ...options })
      : spawnSync('/bin/sh', ['-c', line], { cwd: dir, env: runEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, ...options });
    // Runs one of the build's own scripts with arguments, the way a terminal or a double-click starts it.
    const script = (file, args = [], options = {}) => windows ? shell(`"${path.join(dir, file)}"${args.map(value => ` ${value}`).join('')}`, options) : spawnSync(path.join(dir, file), args, { cwd: dir, env: runEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, ...options });
    const running = () => {
      const run = windows
        ? ps('Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($env:PF_DIR, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { "$($_.ProcessId) $($_.Name)" }', { PF_DIR: dir + path.sep })
        : spawnSync('ps', ['-A', '-ww', '-o', 'pid=', '-o', 'command='], { encoding: 'utf8' });
      assert.equal(run.status, 0, run.stderr);
      return run.stdout.split(/\r?\n/).filter(line => line && (windows || line.includes(dir + path.sep))).map(line => line.trim());
    };
    const settled = async () => { for (let i = 0; ; i++) { const left = running(); if (!left.length || i === 20) return left; await sleep(500); } };
    // taskkill takes about a second each time, so the launchers are stopped together rather than one after another.
    const stop = child => windows ? new Promise(resolve => spawn(path.join(system, 'taskkill.exe'), ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }).once('error', resolve).once('close', resolve)) : child.kill('SIGTERM');
    const launchers = [];
    // `dropped` is a file handed to the launcher, as Explorer does for one dragged onto it; `file` picks the script.
    const launch = (dropped, file = names.studio) => new Promise((resolve, reject) => {
      const child = windows
        ? spawn(comspec, ['/d', '/s', '/c', `""${path.join(dir, file)}" --no-browser${dropped ? ` "${dropped}"` : ''}"`], { cwd: os.tmpdir(), env: runEnv, windowsVerbatimArguments: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        : spawn(path.join(dir, file), ['--no-browser', ...(dropped ? [dropped] : [])], { cwd: os.tmpdir(), env: runEnv, stdio: ['ignore', 'pipe', 'pipe'] });
      let text = '';
      const timer = setTimeout(() => reject(new Error(`no address within 30 seconds; output so far:\n${text}`)), 30000);
      launchers.push(child);
      for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
        text += chunk;
        const address = /Pixelbolt studio: (http:\/\/127\.0\.0\.1:(\d+))/.exec(text);
        if (address && /Press Ctrl\+C to stop\./.test(text)) { clearTimeout(timer); resolve({ child, url: address[1], port: Number(address[2]), text }); }
      });
      child.once('error', reject); child.once('exit', code => { clearTimeout(timer); reject(new Error(`the launcher exited with code ${code}:\n${text}`)); });
    });
    const status = (url, options = {}) => new Promise((resolve, reject) => { const request = http.request(url, options, response => { response.resume(); resolve(response.statusCode); }); request.on('error', reject); request.end(options.body); });
    const reachable = (address, port) => new Promise(resolve => {
      const socket = net.connect({ host: address, port, timeout: 2000 });
      socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', () => resolve(false)); socket.once('timeout', () => { socket.destroy(); resolve(false); });
    });

    log('Environment');
    await check('no Node.js and no git on PATH for anything started below', () => {
      for (const tool of ['node', 'npm', 'git']) assert.notEqual((windows ? spawnSync(path.join(system, 'where.exe'), [tool], { env, windowsHide: true }) : spawnSync('/bin/sh', ['-c', `command -v ${tool}`], { env })).status, 0, `${tool} is on PATH`);
    });
    await check('the bundled runtime starts and reports the version in BUILD-INFO', () => { assert.equal(version.stdout.trim(), `v${info['Node.js version']}`); return version.stdout.trim(); });
    if (windows) {
      note(`Elevated (administrator) process: ${/S-1-16-(12288|16384)/.test(spawnSync(path.join(system, 'whoami.exe'), ['/groups'], { encoding: 'utf8', windowsHide: true }).stdout) ? 'yes' : 'no'}`);
      note(`node.exe Authenticode signature: ${ps('$s = Get-AuthenticodeSignature -LiteralPath $env:PF_FILE; "$($s.Status): $($s.SignerCertificate.Subject)"', { PF_FILE: node }).stdout.trim() || 'could not be read'}`);
    } else {
      note(`Running as root: ${process.getuid() === 0 ? 'yes' : 'no'}`);
      if (host === 'macos') {
        const signed = spawnSync('codesign', ['--verify', '--strict', '--verbose=2', node], { encoding: 'utf8' }), details = spawnSync('codesign', ['-dvv', node], { encoding: 'utf8' }).stderr;
        note(`node code signature: ${signed.status === 0 ? 'valid' : `not valid (${signed.stderr.trim()})`}; ${(/^Authority=.*$/m.exec(details) ?? ['no signing authority read'])[0]}; ${(/^TeamIdentifier=.*$/m.exec(details) ?? [''])[0]}`);
        // An Intel build on Apple silicon runs through Rosetta; the translated runtime reports that about itself.
        const translated = spawnSync(node, ['-e', 'process.stdout.write(require("node:child_process").spawnSync("sysctl", ["-n", "sysctl.proc_translated"], { encoding: "utf8" }).stdout.trim())'], { encoding: 'utf8' }).stdout === '1';
        note(`Processor: ${spawnSync('sysctl', ['-n', 'machdep.cpu.brand_string'], { encoding: 'utf8' }).stdout.trim() || os.cpus()[0]?.model}. ${translated ? `The ${info.Target} runtime ran through Rosetta translation, not on the processor it is built for.` : `The ${info.Target} runtime ran natively.`}`);
      }
    }

    log('Studio');
    let first, second, paths = [];
    // Drafts live in browser storage, which is per address, so the launcher takes its usual port whenever it is free.
    const usualFree = await new Promise(resolve => { const probe = http.createServer(); probe.once('error', () => resolve(false)); probe.listen(USUAL_PORT, '127.0.0.1', () => probe.close(() => resolve(true))); });
    await check('the launcher in no-browser mode prints a loopback address and how to stop', async () => {
      first = await launch(); assert.match(first.text, /close this window/i);
      if (usualFree) assert.equal(first.port, USUAL_PORT, 'the usual port was free but the launcher took another');
      else assert.match(first.text, new RegExp(`Port ${USUAL_PORT} is in use`));
      return `${first.url}${usualFree ? ', its usual port' : `; port ${USUAL_PORT} was busy, so it fell back`}`;
    });
    // On macOS the second copy is started through the .command file, which is what a double-click in Finder runs.
    await check(`a second copy${names.scripts.length ? `, started through "${names.scripts[0]}",` : ''} runs beside the first on another port and says why`, async () => {
      second = await launch(null, names.scripts[0] ?? names.studio); assert.notEqual(second.port, first.port); assert.match(second.text, new RegExp(`Port ${USUAL_PORT} is in use`));
      assert.equal(await status(first.url), 200); assert.equal(await status(second.url), 200); return second.url;
    });
    await check('a recipe handed to the launcher opens in the studio', async () => {
      const dropped = await launch(path.join(dir, 'app', 'examples', 'coin.json'));
      assert.equal((await (await fetch(`${dropped.url}/project.json`)).json()).name, 'coin');
      assert.equal(await (await fetch(`${first.url}/project.json`)).json(), null, 'a studio started without a file has no project');
      return path.join('app', 'examples', 'coin.json');
    });
    await check('it listens on 127.0.0.1 only', async () => {
      const others = Object.values(os.networkInterfaces()).flat().filter(address => !address.internal && address.family === 'IPv4').map(address => address.address);
      assert.equal(await reachable('127.0.0.1', first.port), true);
      const answers = await Promise.all([...others, '::1'].map(address => reachable(address, first.port)));
      assert.deepEqual([...others, '::1'].filter((address, index) => answers[index]), [], 'the studio answers on another address');
      if (windows) {
        const listening = spawnSync(path.join(system, 'netstat.exe'), ['-ano', '-p', 'TCP'], { encoding: 'utf8', windowsHide: true }).stdout.split(/\r?\n/).map(line => line.trim().split(/\s+/)).filter(([, local, , state]) => state === 'LISTENING' && local.endsWith(`:${first.port}`));
        assert.deepEqual(listening.map(([, local]) => local), [`127.0.0.1:${first.port}`]);
      }
      return `refused on ${[...others, '::1'].join(', ')}`;
    });
    await check('every studio route answers 200 and anything else 404', async () => {
      ({ STUDIO_PATHS: paths } = await import(pathToFileURL(path.join(dir, 'app', 'src', 'server.js'))));
      assert.ok(paths.length >= 15);
      for (const route of paths) assert.equal(await status(first.url + route), 200, route);
      for (const route of ['/package.json', '/src/server.js', '/..%2fBUILD-INFO.txt']) assert.equal(await status(first.url + route), 404, route);
      return `${paths.length} routes`;
    });
    await check('a foreign Host header and a foreign Origin are refused with 403', async () => {
      assert.equal(await status(first.url, { headers: { Host: 'evil.example' } }), 403);
      assert.equal(await status(first.url + '/api/export', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' }), 403);
    });
    await check('an export returns a ZIP that contains preview.html', async () => {
      const response = await fetch(first.url + '/api/export', { method: 'POST', headers: { Origin: first.url, 'Content-Type': 'application/json' }, body: await read('app/examples/forest-spirit.json') });
      assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'application/zip');
      const bundle = readZip(Buffer.from(await response.arrayBuffer()));
      assert.match(bundle.get('preview.html').read().toString(), /^<!doctype html>/); return `${bundle.size} files`;
    });
    await check('stopping the launchers leaves no process behind', async () => {
      await Promise.all(launchers.map(stop));
      assert.deepEqual(await settled(), []);
      await assert.rejects(fetch(first.url), 'the studio still answers after its launcher was stopped');
    });
    // What closing the window does. Windows: the launcher in a console window of its own, closed the way its X button
    // closes it; that opens a minimised window, so it only runs for an archive (or on request) and only where there
    // is a desktop. Elsewhere a closed terminal sends its programs the hang-up signal.
    if (!windows) await check('a hang-up, which is what closing the terminal sends, stops the studio', async () => {
      const { child, url } = await launch();
      child.kill('SIGHUP'); assert.deepEqual(await settled(), []); await assert.rejects(fetch(url));
    });
    else if (window) {
      const run = ps([
        'function Under { @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($env:PF_DIR, [StringComparison]::OrdinalIgnoreCase) }) }',
        "$p = Start-Process -FilePath $env:ComSpec -ArgumentList ('/d /s /c \"\"' + $env:PF_LAUNCHER + '\" --no-browser\"') -WindowStyle Minimized -PassThru",
        'for ($i = 0; $i -lt 60 -and (Under).Count -eq 0; $i++) { Start-Sleep -Milliseconds 250 }',
        'Start-Sleep -Milliseconds 500; $p.Refresh()',
        "if ((Under).Count -eq 0 -or $p.MainWindowHandle -eq 0) { & taskkill.exe /pid $p.Id /t /f 2>&1 | Out-Null; 'NOWINDOW'; exit }",
        '[void]$p.CloseMainWindow()',
        'for ($i = 0; $i -lt 60 -and (Under).Count -gt 0; $i++) { Start-Sleep -Milliseconds 250 }',
        "'CLOSED ' + (Under).Count"
      ].join('; '), { PF_DIR: dir + path.sep, PF_LAUNCHER: path.join(dir, names.studio) });
      if (/^CLOSED \d+/m.test(run.stdout)) await check('closing the launcher\'s console window leaves no process behind', () => assert.match(run.stdout, /^CLOSED 0\s*$/m));
      else note(`Window-close check not run: no console window could be opened here (${(run.stdout || run.stderr).trim().split(/\r?\n/).pop() || 'no output'}).`);
      for (const line of running()) spawnSync(path.join(system, 'taskkill.exe'), ['/pid', line.split(' ')[0], '/t', '/f'], { windowsHide: true });
    }

    log('Command line');
    await check('the legacy command has the same help, validation and failure output', () => {
      for (const args of [['help'], ['validate', 'app/examples/forest-spirit.json'], ['unknown']]) {
        const current = script(names.cli, args), legacy = script(names.alias, args);
        assert.equal(current.status, args[0] === 'unknown' ? 1 : 0, current.stderr);
        assert.deepEqual([legacy.status, legacy.stdout, legacy.stderr], [current.status, current.stdout, current.stderr]);
      }
    });
    const lines = start.split(/\r?\n/).map(line => (windows ? /^ {4}(\.\\pixelbolt .+)$/ : /^ {4}(\.\/pixelbolt .+)$/).exec(line)?.[1]).filter(Boolean);
    await check('START HERE gives init, validate, inspect, patch, render and gif', () => assert.deepEqual(lines.map(line => line.split(' ')[1]), COMMANDS));
    for (const line of lines) await check(line, () => {
      const run = shell(line); assert.equal(run.status, 0, run.stderr || run.stdout); assert.equal(JSON.parse(run.stdout).ok, true);
    });
    await check('the commands wrote what START HERE says, inside the folder', async () => {
      assert.equal((await readFile(path.join(dir, 'hero-frames.png'))).toString('latin1', 1, 4), 'PNG');
      assert.equal(JSON.parse(await read('hero-v2.pixel.json')).palette.L, JSON.parse(await read('first-edit.json'))[0].value);
      assert.match(await read('output/hero/preview.html'), /^<!doctype html>/);
      assert.equal((await readFile(path.join(dir, 'hero.gif'))).toString('latin1', 0, 6), 'GIF89a');
    });
    await check('sequence writes numbered frames for a video editor, as START HERE describes', async () => {
      assert.match(start.replace(/\r?\n/g, ' '), /"sequence hero-v2\.pixel\.json --fps 30 --size 1080p --out shots"/);
      const run = shell(`${lines[0].split(' ')[0]} sequence hero-v2.pixel.json --fps 30 --size 1080p --out shots`); assert.equal(run.status, 0, run.stderr || run.stdout);
      const report = JSON.parse(run.stdout), sidecar = JSON.parse(await read('shots/sequence.json'));
      assert.deepEqual([report.ok, report.width, report.height, sidecar.frames, sidecar.fps.label], [true, 1920, 1080, report.frames, '30']);
      const first = await readFile(path.join(dir, 'shots', sidecar.pattern.replace('%04d', '0001')));
      assert.deepEqual([first.toString('latin1', 1, 4), first.readUInt32BE(16), first.readUInt32BE(20)], ['PNG', 1920, 1080]);
      assert.ok((await read('shots/README.txt')).includes(sidecar.commands.prores4444));
      return `${sidecar.frames} frames at 1920 × 1080`;
    });
    await check('a second run refuses to replace an existing file', () => {
      const run = shell(lines[0]); assert.equal(run.status, 1); assert.equal(JSON.parse(run.stderr).ok, false);
    });
    await check('two renders of one recipe are identical', async () => {
      const run = shell(lines.find(line => line.split(' ')[1] === 'render').replace(/hero$/, 'hero-again')); assert.equal(run.status, 0, run.stderr);
      const once = await tree(path.join(dir, 'output', 'hero'));
      assert.deepEqual(await tree(path.join(dir, 'output', 'hero-again')), once);
      for (const file of once) assert.ok((await readFile(path.join(dir, 'output', 'hero', file))).equals(await readFile(path.join(dir, 'output', 'hero-again', file))), file);
      return `${once.length} files`;
    });
    // The other shell people are likely to be in: PowerShell on Windows, zsh on macOS, bash on Linux.
    const other = windows ? ['PowerShell', line => spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', `${line}; exit $LASTEXITCODE`], { cwd: dir, env, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })]
      : [host === 'macos' ? 'zsh' : 'bash', line => spawnSync(host === 'macos' ? '/bin/zsh' : '/bin/bash', ['-c', line], { cwd: dir, env: runEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })];
    await check(`the same commands work from ${other[0]}`, () => {
      const run = other[1](lines[1]);
      assert.equal(run.status, 0, run.stderr || String(run.error)); assert.equal(JSON.parse(run.stdout).ok, true);
      assert.match(shell(`${lines[0].split(' ')[0]} help`).stdout, /pixelbolt init/);
    });
    if (unix) await check('the command line also works through a symbolic link from another folder', async () => {
      const bin = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-link-'));
      try {
        await symlink(path.join(dir, names.cli), path.join(bin, 'pixelbolt'));
        const run = spawnSync(path.join(bin, 'pixelbolt'), ['validate', path.join(dir, 'hero.pixel.json')], { cwd: bin, env: runEnv, encoding: 'utf8' });
        assert.equal(run.status, 0, run.stderr); assert.equal(JSON.parse(run.stdout).ok, true);
      } finally { await rm(bin, { recursive: true, force: true }); }
    });

    log('Agent connection');
    let settings;
    await check('the helper prints settings for Claude Code, Claude Desktop, Codex and Cursor that parse and point into this folder', async () => {
      // On macOS the plain-text run goes through the .command file that Finder starts.
      const json = script(names.helper, ['--json'], { cwd: os.tmpdir() }), text = script(names.scripts[1] ?? names.helper, [], { cwd: os.tmpdir() });
      assert.equal(json.status, 0, json.stderr); assert.equal(text.status, 0, text.stderr);
      settings = JSON.parse(json.stdout);
      assert.equal(settings.folder, dir); assert.equal(settings.server.command, node);
      await access(settings.server.command); await access(settings.server.args[0]);
      assert.deepEqual(settings.server.args.slice(1), ['mcp', '--out', path.join(dir, 'output')]);
      assert.deepEqual(settings.clients.map(client => client.id), ['claude-code', 'claude-desktop', 'codex', 'cursor']);
      for (const client of settings.clients) {
        const parsed = client.format === 'json' ? JSON.parse(client.text).mcpServers.pixelbolt
          : { command: JSON.parse(/^command = (.*)$/m.exec(client.text)[1]), args: JSON.parse(/^args = (.*)$/m.exec(client.text)[1]) };
        assert.deepEqual(parsed, settings.server, client.name);
        assert.ok(text.stdout.replace(/\r\n/g, '\n').includes(`${client.name} `) && text.stdout.replace(/\r\n/g, '\n').includes(client.text), `${client.name} is missing from the printed settings`);
        if (client.command) assert.ok(text.stdout.includes(client.command), `${client.name}'s one-line command is missing from the printed settings`);
      }
    });
    // The one-line commands are run as printed, in each shell, against stand-ins for the two tools: on Windows a .cmd
    // wrapper and the .ps1 wrapper npm installs, elsewhere a shell script. Each stand-in records the arguments it
    // was given; nothing is configured.
    await check(`the one-line commands hand claude and codex the same server from ${windows ? 'Command Prompt and PowerShell' : `sh and ${other[0]}`}`, async () => {
      const commands = Object.fromEntries(settings.clients.map(client => [client.id, client.command]));
      assert.deepEqual([commands['claude-desktop'], commands.cursor], [null, null]);
      if (windows && /["%$`]/.test(dir)) { assert.deepEqual([commands['claude-code'], commands.codex], [null, null]); return 'none offered: the folder path has a character that shells treat specially'; }
      const stand = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-shims-')), record = path.join(stand, 'record.cjs'), seen = path.join(stand, 'seen.json');
      try {
        await writeFile(record, 'require("node:fs").writeFileSync(process.env.PF_SEEN, JSON.stringify(process.argv.slice(2)));\n');
        for (const kindOf of windows ? ['cmd', 'ps1'] : ['sh']) await mkdir(path.join(stand, kindOf));
        for (const tool of ['claude', 'codex']) {
          if (windows) { await writeFile(path.join(stand, 'cmd', `${tool}.cmd`), '@echo off\r\n"%PF_NODE%" "%PF_RECORD%" %*\r\n'); await writeFile(path.join(stand, 'ps1', `${tool}.ps1`), '& $env:PF_NODE $env:PF_RECORD $args\r\n'); }
          else await writeFile(path.join(stand, 'sh', tool), '#!/bin/sh\nexec "$PF_NODE" "$PF_RECORD" "$@"\n', { mode: 0o755 });
        }
        const shells = {
          'Command Prompt': (line, shims) => spawnSync(comspec, ['/d', '/s', '/c', `"${line}"`], { cwd: os.tmpdir(), env: shims, encoding: 'utf8', windowsVerbatimArguments: true, windowsHide: true, timeout: 60000 }),
          // Bypass applies to this one child process, so the stand-in .ps1 runs whatever the machine's policy is.
          PowerShell: (line, shims) => spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(line, 'utf16le').toString('base64')], { cwd: os.tmpdir(), env: shims, encoding: 'utf8', windowsHide: true, timeout: 60000 }),
          sh: (line, shims) => spawnSync('/bin/sh', ['-c', line], { cwd: os.tmpdir(), env: shims, encoding: 'utf8', timeout: 60000 }),
          zsh: (line, shims) => spawnSync('/bin/zsh', ['-c', line], { cwd: os.tmpdir(), env: shims, encoding: 'utf8', timeout: 60000 }),
          bash: (line, shims) => spawnSync('/bin/bash', ['-c', line], { cwd: os.tmpdir(), env: shims, encoding: 'utf8', timeout: 60000 })
        };
        const to = [settings.server.command, ...settings.server.args], expected = { 'claude-code': ['mcp', 'add', '--scope', 'user', 'pixelbolt', '--', ...to], codex: ['mcp', 'add', 'pixelbolt', '--', ...to] };
        for (const [name, shim] of windows ? [['Command Prompt', 'cmd'], ['PowerShell', 'cmd'], ['PowerShell', 'ps1']] : [['sh', 'sh'], [other[0], 'sh']]) for (const id of ['claude-code', 'codex']) {
          await rm(seen, { force: true });
          const run = shells[name](commands[id], { ...(name === 'PowerShell' ? env : runEnv), PATH: `${path.join(stand, shim)}${path.delimiter}${env.PATH}`, PF_NODE: node, PF_RECORD: record, PF_SEEN: seen });
          assert.deepEqual(JSON.parse(await readFile(seen, 'utf8').catch(() => 'null')), expected[id], `${id} from ${name} through a ${shim} wrapper: ${run.stderr || run.stdout}`);
        }
      } finally { await rm(stand, { recursive: true, force: true }); }
      return windows ? 'cmd.exe and Windows PowerShell, .cmd and .ps1 wrappers' : undefined;
    });
    await check('the MCP server initialises, lists eight tools and renders over stdio on the bundled runtime', async () => {
      const child = spawn(settings.server.command, settings.server.args, { cwd: os.tmpdir(), env: runEnv, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '', errors = '';
      child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { errors += chunk; });
      const messages = [{ id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'verify-studio', version: '1' } } }, { method: 'notifications/initialized' }, { id: 2, method: 'tools/list' }, { id: 3, method: 'tools/call', params: { name: 'pixel_render', arguments: { project: JSON.parse(await read('app/examples/coin.json')) } } }];
      child.stdin.end(messages.map(message => JSON.stringify({ jsonrpc: '2.0', ...message })).join('\n') + '\n');
      const code = await new Promise(resolve => { const timer = setTimeout(() => { child.kill(); resolve('a timeout'); }, 60000); child.once('exit', status => { clearTimeout(timer); resolve(status); }); });
      assert.equal(code, 0, `the server ended with ${code}: ${errors}`);
      const [initialized, listed, rendered] = output.trim().split('\n').map(line => JSON.parse(line).result);
      assert.equal(initialized.serverInfo.version, pkg.version); assert.equal(listed.tools.length, 8);
      assert.ok(!rendered.isError, JSON.stringify(rendered)); assert.equal(rendered.content[1].mimeType, 'image/png');
      const written = JSON.parse(rendered.content[0].text);
      assert.ok(written.directory.startsWith(path.join(dir, 'output') + path.sep), `rendered outside the folder: ${written.directory}`);
      await access(written.playback); return `${listed.tools.map(tool => tool.name).join(', ')}`;
    });

    log('Afterwards');
    await check('nothing from the folder is still running', async () => assert.deepEqual(await settled(), []));
    // macOS marks what a browser downloads, and what is extracted from it, as quarantined. A copy of the folder
    // gets the same mark here to see whether the command line still runs; with no one at the screen this is a note.
    if (host === 'macos' && archive) {
      const copy = path.join(workspace, 'quarantined');
      await cp(dir, copy, { recursive: true });
      const marked = spawnSync('xattr', ['-r', '-w', 'com.apple.quarantine', `0083;${Math.floor(Date.now() / 1000).toString(16)};Safari;`, copy], { encoding: 'utf8' });
      const run = spawnSync(path.join(copy, names.cli), ['validate', path.join(copy, 'app', 'examples', 'coin.json')], { cwd: copy, env: runEnv, encoding: 'utf8', timeout: 60000 });
      note(`With the download quarantine mark set (${marked.status === 0 ? 'xattr ok' : `xattr failed: ${marked.stderr.trim()}`}; Gatekeeper ${spawnSync('spctl', ['--status'], { encoding: 'utf8' }).stdout.trim() || 'status unknown'}), the command line ${run.status === 0 ? 'ran normally' : `did not run: ${run.error?.message ?? run.signal ?? (run.stderr.trim().split('\n').pop() || `exit ${run.status}`)}`}. This runner has no screen, so it shows nothing about the prompts a person would see.`);
      await rm(copy, { recursive: true, force: true });
    }
    await check('nothing was written to the profile or temp folders every program was given', async () => {
      const written = await tree(profile);
      assert.equal(written.length, 0, `files written outside the folder (${written.length}):\n${written.slice(0, 20).join('\n')}`);
    });
    if (workspace && !keep) await check('deleting the folder removes everything', async () => { await rm(workspace, { recursive: true }); await assert.rejects(access(workspace)); workspace = null; });
  }
  if (toolbox) await rm(toolbox, { recursive: true, force: true }).catch(() => {});
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  if (workspace && !keep) await rm(workspace, { recursive: true, force: true }).catch(() => {});
  if (workspace && keep) note(`Kept ${workspace}`);
  const failed = results.filter(result => !result.ok), complete = kind === host && runnable;
  log(`${results.length - failed.length} of ${results.length} checks passed${failed.length ? `; failed: ${failed.map(result => result.name).join('; ')}` : ''}${complete ? '' : ' (contents only)'}`);
  return { ok: failed.length === 0, complete, target: info.Target, results, notes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), archive = args.find(argument => !argument.startsWith('--'));
  if (!archive || args.some(argument => argument.startsWith('--') && !['--allow-dev', '--keep'].includes(argument))) { console.error('Usage: node scripts/verify-studio.mjs <PixelboltStudio-...zip|.tar.gz> [--allow-dev] [--keep]'); process.exit(2); }
  const outcome = await verifyStudio({ archive, allowDev: args.includes('--allow-dev'), keep: args.includes('--keep') }).catch(error => { console.error(error.stack); return { ok: false, complete: true }; });
  // A run that could not exercise the build is not a pass.
  process.exitCode = !outcome.ok ? 1 : outcome.complete ? 0 : 3;
}
