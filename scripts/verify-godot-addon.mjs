// Real, headless Godot integration checks for the copyable addon. Expected resources
// always come from this checkout's CLI. Only throwaway projects are modified; no GPU,
// network, dependency install or edits to the demo. All child processes are bounded.
//   node scripts/verify-godot-addon.mjs --godot <console executable> [--work <dir>] [--keep]
//   node scripts/verify-godot-addon.mjs --godot <console executable> --install-zip <pixelbolt-godot-<version>.zip>
// The second form installs a built release zip in a fresh project and imports the shipped hero with it.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm, cp, readdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rootCertificates } from 'node:tls';
import { GODOT_FIXTURE, GODOT_TILE_SOURCES, findGodot } from './verify-godot.mjs';
import { readZip } from './build-studio.mjs';
import { stampVersion } from './build-godot-addon.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin/pixelbolt.js');
const slash = value => value.replaceAll('\\', '/');
const quote = value => JSON.stringify(slash(value));
// Linux keeps a killed process as a zombie (state Z) until its new parent reaps it; it runs nothing, so it counts as
// ended. What a survivor is, for the failure message.
const procState = pid => { try { return readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) /s, '').split(' ')[0]; } catch { return null; } };
const running = pid => {
  try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
  return procState(pid) !== 'Z';
};
const described = pid => {
  if (process.platform !== 'linux') return String(pid);
  let command = '';
  try { command = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ').trim(); } catch {}
  return `${pid} (state ${procState(pid) ?? 'gone'}${command ? `, ${command}` : ''})`;
};

function killTree(pid) {
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10000, stdio: 'ignore' });
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }
  else { try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch {} } }
}

// verify-godot's godotRun is private. This asynchronous runner additionally kills
// the complete process tree on a deadline, including a misbehaving CLI descendant.
export function runProcess(executable, args, { timeout = 120000, cwd = ROOT, env = {}, onOutput = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true, detached: process.platform !== 'win32',
      env: { ...process.env, ...env } });
    let output = '', expired = false;
    const timer = setTimeout(() => {
      expired = true;
      killTree(child.pid);
      child.stdout.destroy();
      child.stderr.destroy();
      reject(new Error('Process timed out: ' + executable + '\n' + output));
    }, timeout);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output += data.toString(); onOutput(output); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', status => {
      clearTimeout(timer);
      if (expired) reject(new Error('Process timed out: ' + executable + '\n' + output));
      else resolve({ status, output });
    });
  });
}

export function problems(output) {
  return output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').split(/\r?\n/).filter(line => /^\s*(?:ERROR|SCRIPT ERROR|WARNING):/.test(line));
}

export function reportFrom(output) {
  const lines = output.split(/\r?\n/).filter(line => line.startsWith('PIXELBOLT '));
  assert.equal(lines.length, 1, 'Expected one PIXELBOLT report:\n' + output);
  return JSON.parse(lines[0].slice(10));
}

export function supportsMultipart(version) {
  const match = /^(\d+)\.(\d+)/.exec(version);
  assert.ok(match && Number(match[1]) === 4 && Number(match[2]) >= 3, 'Godot 4.3+ is required: ' + version);
  return Number(match[2]) >= 5;
}

const put = async (dir, name, content) => {
  const file = path.join(dir, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
};

async function sandboxSettings(dir) {
  // Explicit local user data and bundled roots avoid Windows profile/certificate
  // store access in restricted runners. No network connection is made.
  await put(dir, '.godot/test-roots.pem', rootCertificates.join('\n'));
  await mkdir(path.join(dir, '.godot/user-profile'), { recursive: true });
  await put(dir, 'override.cfg', '[application]\nconfig/use_custom_user_dir=true\nconfig/custom_user_dir=' +
    quote(path.join(dir, '.godot/user-data')) + '\n[network]\ntls/certificate_bundle_override="res://.godot/test-roots.pem"\n');
}

async function godotRun(godot, dir, args, options = {}) {
  return runProcess(godot, ['--headless', '--path', dir, ...args], {
    env: process.platform === 'win32' ? { APPDATA: path.join(dir, '.godot/user-profile') } : {}, ...options
  });
}

async function cleanRun(godot, dir, args, options = {}) {
  const result = await godotRun(godot, dir, args, options);
  assert.deepEqual(problems(result.output), [], result.output);
  assert.equal(result.status, 0, result.output);
  return result.output;
}

async function renderExpected(dir, source, folder) {
  let input = path.join(dir, source);
  const data = JSON.parse(await readFile(input, 'utf8'));
  if (typeof data.format === 'string') {
    const compiled = path.join(dir, '.godot', folder.replaceAll('/', '-') + '.json');
    await mkdir(path.dirname(compiled), { recursive: true });
    const result = await runProcess(process.execPath, [CLI, 'compile', input, '--out', compiled]);
    assert.equal(result.status, 0, result.output);
    input = compiled;
  }
  const result = await runProcess(process.execPath, [CLI, 'render', input, '--out', path.join(dir, folder)]);
  assert.equal(result.status, 0, result.output);
  const reply = JSON.parse(result.output);
  for (const file of await readdir(path.join(dir, folder))) {
    if (file.endsWith('.pixel.json')) await rm(path.join(dir, folder, file));
  }
  return { frames: folder + '/' + reply.sheet.replace(/\.png$/, '.tres'), tiles: folder + '/' + reply.sheet.replace(/\.png$/, '.tileset.tres') };
}

function projectText(settings = {}, toggle = false) {
  const values = { 'cli/path': CLI, 'cli/node_path': process.execPath, ...settings };
  return 'config_version=5\n[application]\nconfig/name="Pixelbolt addon check"\n[editor_plugins]\nenabled=PackedStringArray("res://addons/pixelbolt/plugin.cfg"' +
    (toggle ? ', "res://addons/toggle/plugin.cfg"' : '') + ')\n[pixelbolt]\n' +
    Object.entries(values).map(([key, value]) => key + '=' + (typeof value === 'string' ? quote(value) : JSON.stringify(value))).join('\n') + '\n';
}

async function seedImport(dir, source, { tiles = false, inherit = false } = {}) {
  await put(dir, source + '.import', '[remap]\nimporter="pixelbolt.' + (tiles ? 'tile_set' : 'sprite_frames') +
    '"\ntype="' + (tiles ? 'TileSet' : 'SpriteFrames') + '"\n[params]\ntexture_filter=' + (inherit ? '1' : '0') + '\n');
}

async function importPath(dir, source) {
  const text = await readFile(path.join(dir, source + '.import'), 'utf8');
  const match = /^path="res:\/\/(.+)"$/m.exec(text);
  assert.ok(match, 'No imported resource: ' + text);
  return path.join(dir, match[1]);
}

async function assertNoLeftovers(dir) {
  const folder = path.join(dir, '.godot/pixelbolt');
  if (existsSync(folder)) assert.deepEqual(await readdir(folder), [], 'Temporary render folders remain');
}

async function snapshot(dir, prefix = '') {
  const entries = {};
  for (const item of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    if (item.name === '.godot' || item.name.endsWith('.import') || item.name.endsWith('.uid')) continue;
    const relative = prefix ? prefix + '/' + item.name : item.name;
    if (item.isDirectory()) Object.assign(entries, await snapshot(dir, relative));
    else entries[relative] = (await readFile(path.join(dir, relative))).toString('base64');
  }
  return entries;
}

// The copied addon says this checkout's version, as a release zip of it does (scripts/build-godot-addon.mjs stamps
// plugin.cfg), so the checks hold when package.json has moved on and the checked-in plugin.cfg has not.
async function stampAddon(project, version) {
  const cfg = path.join(project, 'addons/pixelbolt/plugin.cfg');
  await writeFile(cfg, stampVersion((await readFile(cfg, 'utf8')).replaceAll('\r\n', '\n'), version));
}

// On Windows, a copy of the editor in self-contained mode with its own editor settings, so the user's Godot settings
// never apply and a restricted runner needs no access to the system's certificate store.
async function isolatedGodot(godot, root, version) {
  if (process.platform !== 'win32' || !existsSync(godot)) return godot;
  const runtime = path.join(root, 'runtime');
  await mkdir(runtime);
  const names = new Set([path.basename(godot), path.basename(godot).replace('_console.exe', '.exe')]);
  for (const name of names) await cp(path.join(path.dirname(godot), name), path.join(runtime, name));
  await put(runtime, '._sc_', '');
  await put(runtime, 'roots.pem', rootCertificates.join('\n'));
  await put(runtime, 'editor_data/editor_settings-4.' + version.split('.')[1] + '.tres',
    '[gd_resource type="EditorSettings" format=3]\n[resource]\nnetwork/tls/editor_tls_certificates=' + quote(path.join(runtime, 'roots.pem')) + '\n');
  return path.join(runtime, path.basename(godot));
}

async function godotVersion(godot) {
  const probe = await runProcess(godot, ['--version']);
  assert.equal(probe.status, 0, probe.output);
  return probe.output.trim().split(/\r?\n/)[0];
}

// A release zip's entries, every name checked before anything is written: each lands inside `dir`'s
// addons/pixelbolt/, so no entry can write outside the throwaway project.
export function addonZipEntries(bytes, dir) {
  const entries = readZip(bytes), addon = path.join(path.resolve(dir), 'addons', 'pixelbolt') + path.sep;
  assert.ok(entries.has('addons/pixelbolt/plugin.cfg'), 'The zip has no addons/pixelbolt/plugin.cfg at its root');
  for (const name of entries.keys()) {
    assert.match(name, /^addons\/pixelbolt\/[^/]/, `Every file in the zip is under addons/pixelbolt/: ${name}`);
    assert.ok(!name.includes('\\') && !name.includes(':') && name.split('/').every(part => part && part !== '.' && part !== '..'), `Unsafe name in the zip: ${name}`);
    assert.ok(path.resolve(dir, name).startsWith(addon), `Unsafe name in the zip: ${name}`);
  }
  return entries;
}

// The release zip as a user installs it: unzipped into a fresh project, which then holds only addons/pixelbolt/ from
// the zip, the project file that enables it and one recipe, the shipped hero. Godot must import it with no error or
// warning, as a SpriteFrames equal to the CLI's own, field by field and pixel by pixel.
export async function verifyAddonZip({ godot = findGodot(), zip, work = os.tmpdir(), keep = false, log = console.log } = {}) {
  assert.ok(godot, 'Godot 4 was not found: pass --godot <console executable>');
  assert.ok(zip, 'Name the zip: --install-zip <pixelbolt-godot-<version>.zip>');
  if (godot.includes('/') || godot.includes('\\')) godot = path.resolve(godot);
  const version = await godotVersion(godot), ext = supportsMultipart(version) ? '.pixel.json' : '.pixelbolt';
  const packageVersion = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8')).version;
  await mkdir(path.resolve(work), { recursive: true });
  const root = await mkdtemp(path.join(path.resolve(work), 'pixelbolt-addon-zip-'));
  const dir = path.join(root, 'zip project');
  try {
    godot = await isolatedGodot(godot, root, version);
    const entries = addonZipEntries(await readFile(zip), dir);
    for (const [name, entry] of entries) await put(dir, name, entry.read());
    assert.match(entries.get('addons/pixelbolt/plugin.cfg').read().toString(), new RegExp(`^version="${packageVersion.replaceAll('.', '\\.')}"$`, 'm'));
    await sandboxSettings(dir);
    await put(dir, 'project.godot', projectText());
    await cp(path.join(ROOT, 'godot/tests/check.gd'), path.join(dir, 'check.gd'));
    const source = 'recipes/hero' + ext;
    await put(dir, source, await readFile(path.join(ROOT, 'examples/hero.poses.json')));
    const expected = await renderExpected(dir, source, 'expected/hero');
    const output = await cleanRun(godot, dir, ['--import']);
    assert.equal(output.split(/\r?\n/).filter(line => line.startsWith(`Pixelbolt ${packageVersion}: imported res://${source} (`)).length, 1, output);
    await assertNoLeftovers(dir);
    await put(dir, 'cases.json', JSON.stringify({ version: packageVersion, cases: [{ key: 'hero', source: 'res://' + source, expected: 'res://' + expected.frames, inherit: false }] }));
    const report = reportFrom(await cleanRun(godot, dir, ['--script', 'res://check.gd']));
    assert.deepEqual(report.failures, []);
    const line = `${version}: install: ${path.basename(zip)} (${entries.size} files) unzipped into a fresh project, enabled, and imported ${source} as SpriteFrames: ${report.totals.animations} animations, ${report.totals.frames} frames equal to the CLI's own.`;
    log(line);
    return { version, line, dir: keep ? root : null };
  } finally {
    if (keep) log('Kept the zip project at ' + root);
    else await rm(root, { recursive: true, force: true });
  }
}

export async function verifyGodotAddon({ godot = findGodot(), work = os.tmpdir(), keep = false, log = console.log } = {}) {
  assert.ok(godot, 'Godot 4 was not found: pass --godot <console executable>');
  if (godot.includes('/') || godot.includes('\\')) godot = path.resolve(godot);
  const probe = await runProcess(godot, ['--version']);
  assert.equal(probe.status, 0, probe.output);
  const version = probe.output.trim().split(/\r?\n/)[0], multipart = supportsMultipart(version);
  await mkdir(path.resolve(work), { recursive: true });
  const root = await mkdtemp(path.join(path.resolve(work), 'pixelbolt-addon-'));
  const dir = path.join(root, 'project with spaces');
  const summaries = [];
  const say = text => { const line = version + ': ' + text; summaries.push(line); log(line); };
  const packageVersion = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8')).version;
  const ext = multipart ? '.pixel.json' : '.pixelbolt';
  const cases = [];
  let expectedRevision = 0;
  const check = async (selected = cases) => {
    await put(dir, 'cases.json', JSON.stringify({ version: packageVersion, cases: selected }));
    const output = await cleanRun(godot, dir, ['--script', 'res://check.gd']);
    const report = reportFrom(output);
    assert.deepEqual(report.failures, [], output);
    return report.totals;
  };
  const reimport = async (options = {}) => {
    const before = await snapshot(dir);
    const output = await cleanRun(godot, dir, ['--import'], options);
    assert.deepEqual(await snapshot(dir), before, 'An import wrote outside .godot (excluding Godot sidecars)');
    await assertNoLeftovers(dir);
    return output;
  };
  try {
    godot = await isolatedGodot(godot, root, version);
    await mkdir(dir, { recursive: true });
    await sandboxSettings(dir);
    await cp(path.join(ROOT, 'godot/addons/pixelbolt'), path.join(dir, 'addons/pixelbolt'), { recursive: true });
    await stampAddon(dir, packageVersion);
    assert.deepEqual(await readFile(path.join(dir, 'addons/pixelbolt/LICENSE')), await readFile(path.join(ROOT, 'LICENSE')));
    await cp(path.join(ROOT, 'godot/tests/check.gd'), path.join(dir, 'check.gd'));
    await cp(path.join(ROOT, 'godot/tests/discovery.gd'), path.join(dir, 'discovery.gd'));
    await put(dir, 'addons/toggle/plugin.cfg', '[plugin]\nname="Toggle test"\ndescription="Test only"\nauthor="Pixelbolt"\nversion="1.0"\nscript="toggle.gd"\n');
    await cp(path.join(ROOT, 'godot/tests/toggle.gd'), path.join(dir, 'addons/toggle/toggle.gd'));
    await put(dir, 'project.godot', projectText({}, true));
    const install = await cleanRun(godot, dir, ['--editor']);
    assert.equal(reportFrom(install).toggle, true);
    const saved = await readFile(path.join(dir, 'project.godot'), 'utf8');
    assert.equal(saved, projectText({}, true), 'Enable/disable changed project.godot');
    await rm(path.join(dir, 'addons/toggle'), { recursive: true });
    await put(dir, 'project.godot', projectText());
    say('install: enable, disable and re-enable clean; settings defaults not saved.');

    const discovery = async settings => {
      await put(dir, 'discovery.json', JSON.stringify({ path: path.join(dir, '.godot/fake-path'), cases: settings }));
      return reportFrom(await cleanRun(godot, dir, ['--script', 'res://discovery.gd'])).results;
    };
    const fakePath = path.join(dir, '.godot/fake-path');
    await put(dir, '.godot/fake-path/' + (process.platform === 'win32' ? 'npx.cmd' : 'npx'), '');
    let resolved = await discovery([{}, { 'cli/allow_npx': true }, { 'cli/allow_npx': true, 'cli/npx_version': 'latest' },
      { 'cli/path': slash(path.relative(dir, CLI)), 'cli/node_path': process.execPath }]);
    assert.match(resolved[0].error, /CLI not found/);
    assert.deepEqual(resolved[1].args, ['-y', 'pixelbolt@' + packageVersion]);
    assert.equal(resolved[1].version, packageVersion);
    assert.match(resolved[2].error, /exact version/);
    assert.equal(resolved[3].version, packageVersion);
    assert.equal(resolved[3].args[0], slash(CLI));
    await put(dir, 'node_modules/pixelbolt/bin/pixelbolt.js', '');
    await put(dir, 'node_modules/pixelbolt/package.json', '{"name":"pixelbolt","version":"1.2.3"}');
    resolved = await discovery([{ 'cli/node_path': process.execPath }]);
    assert.equal(resolved[0].version, '1.2.3');
    assert.equal(resolved[0].args[0], slash(path.join(dir, 'node_modules/pixelbolt/bin/pixelbolt.js')));
    await rm(path.join(dir, 'node_modules'), { recursive: true });
    await put(dir, '.godot/fake-path/' + (process.platform === 'win32' ? 'pixelbolt.cmd' : 'pixelbolt'), '');
    resolved = await discovery([{}]);
    assert.equal(slash(resolved[0].exe), slash(fakePath) + '/' + (process.platform === 'win32' ? 'pixelbolt.cmd' : 'pixelbolt'));
    if (process.platform === 'win32') {
      await put(dir, '.godot/fake-path/node_modules/pixelbolt/bin/pixelbolt.js', '');
      await put(dir, '.godot/fake-path/node_modules/pixelbolt/package.json', '{"name":"pixelbolt","version":"2.3.4"}');
      resolved = await discovery([{ 'cli/node_path': process.execPath }]);
      assert.equal(resolved[0].version, '2.3.4');
      assert.equal(slash(resolved[0].args[0]), slash(fakePath) + '/node_modules/pixelbolt/bin/pixelbolt.js');
    }
    say('discovery: configured, local and PATH CLI precedence; pinned opt-in npx; no downloads.');

    const add = async (key, data, options = {}) => {
      const source = 'recipes/' + key + (options.extension ?? ext);
      await put(dir, source, JSON.stringify(data));
      if (options.tiles || options.inherit) await seedImport(dir, source, options);
      const expected = await renderExpected(dir, source, 'expected/' + key + '-' + expectedRevision++);
      const entry = { key, source: 'res://' + source, expected: 'res://' + expected[options.tiles ? 'tiles' : 'frames'], inherit: !!options.inherit };
      cases.push(entry);
      return entry;
    };
    await add('forest', JSON.parse(await readFile(path.join(ROOT, 'examples/forest-spirit.json'), 'utf8')));
    const fixture = await add('timing', GODOT_FIXTURE, { extension: '.pixelbolt' });
    await add('inherit', GODOT_FIXTURE, { inherit: true });
    await add('hero', JSON.parse(await readFile(path.join(ROOT, 'examples/hero.poses.json'), 'utf8')));
    await add('ground', JSON.parse(await readFile(path.join(ROOT, 'examples/ground.autotile.json'), 'utf8')), { tiles: true });
    // Make tile animations, weighted collisions and alternate tiles non-vacuous checks.
    for (const [i, source] of GODOT_TILE_SOURCES.entries()) await add('tile-' + i, source, { tiles: true, inherit: i === 1 });
    // The same relative palette is resolved from a plain file and a compiler source.
    const palette = GODOT_FIXTURE.palette;
    await put(dir, 'pal.json', JSON.stringify(palette));
    await add('palette', { ...GODOT_FIXTURE, palette: { $ref: '../pal.json' } });
    const hero = JSON.parse(await readFile(path.join(ROOT, 'examples/hero.poses.json'), 'utf8'));
    await put(dir, 'hero-pal.json', JSON.stringify(hero.palette));
    await add('hero-palette', { ...hero, palette: { $ref: '../hero-pal.json' } });
    const imported = await reimport();
    assert.equal(imported.split(/\r?\n/).filter(line => /^Pixelbolt [^:]+: imported /.test(line)).length, cases.length, imported);
    const totals = await check();
    say('resources: ' + totals.resources + ' resources, ' + totals.animations + ' animations, ' + totals.frames + ' frames, ' + totals.tiles + ' tiles match CLI fields and pixels; metadata, filters, palettes and self-contained saves pass.');
    say('extensions: ' + (multipart ? '.pixel.json and .pixelbolt' : '.pixelbolt (multipart extensions require Godot 4.5+)') + '.');
    const unchanged = await reimport();
    assert.ok(!unchanged.includes(': imported res://recipes/'), 'Unchanged recipes were reimported');
    await put(dir, 'addons/toggle/plugin.cfg', '[plugin]\nname="Menu test"\ndescription="Test only"\nauthor="Pixelbolt"\nversion="1.0"\nscript="toggle.gd"\n');
    await cp(path.join(ROOT, 'godot/tests/reimport_menu.gd'), path.join(dir, 'addons/toggle/toggle.gd'));
    await put(dir, 'project.godot', projectText({}, true));
    const menu = await cleanRun(godot, dir, ['--editor']);
    assert.equal(reportFrom(menu).reimport_all, true);
    assert.equal(menu.split(/\r?\n/).filter(line => /^Pixelbolt [^:]+: imported /.test(line)).length, cases.length, menu);
    await put(dir, 'project.godot', projectText());
    await rm(path.join(dir, 'addons/toggle'), { recursive: true });
    await check();
    say('menu: reimport all rebuilds every claimed recipe without source edits.');

    const source = fixture.source.slice(6);
    const edited = structuredClone(GODOT_FIXTURE);
    edited.frames[0].duration = 370;
    await put(dir, source, JSON.stringify(edited));
    fixture.expected = 'res://' + (await renderExpected(dir, source, 'expected/edited')).frames;
    const editedOutput = await reimport();
    assert.equal(editedOutput.split(/\r?\n/).filter(line => /^Pixelbolt [^:]+: imported /.test(line)).length, 1, editedOutput);
    await check();
    say('reimport: changed duration matches fresh CLI output; unchanged sources are skipped.');

    if (process.platform === 'win32') {
      const shim = '.godot/CLI & tools/pixelbolt.cmd';
      await put(dir, shim, '@echo off\r\n"' + process.execPath + '" "' + CLI + '" %*\r\n');
      await put(dir, 'project.godot', projectText({ 'cli/path': shim }));
      await put(dir, source, JSON.stringify(edited) + '\n');
      const shimOutput = await reimport();
      assert.ok(shimOutput.includes('Pixelbolt unknown: imported ' + fixture.source), shimOutput);
      fixture.version = 'unknown';
      await check([fixture]);
      delete fixture.version;
      await put(dir, 'project.godot', projectText());
      await put(dir, source, JSON.stringify(edited));
      await reimport();
      say('Windows shim: .cmd runs through cmd.exe with spaces and ampersands in its path.');
    }

    const resource = await importPath(dir, source), previous = await readFile(resource);
    const failures = [
      ['no Node', { 'cli/node_path': path.join(dir, 'missing-node.exe') }, /Node.js not found/],
      ['no CLI', { 'cli/path': path.join(dir, 'missing-cli.js') }, /CLI not found/],
      ['invalid recipe', {}, /unknown.*op|unknown operation|unknown drawing/i]
    ];
    await cp(path.join(ROOT, 'godot/tests/stall.txt'), path.join(dir, '.godot/stall.js'));
    for (const [index, [label, settings, expectedError]] of failures.entries()) {
      await put(dir, 'project.godot', projectText(settings));
      const broken = structuredClone(edited);
      broken.frames[0].duration += index + 1;
      if (label === 'invalid recipe') broken.frames[0].ops = [{ op: 'not-a-pixelbolt-operation' }];
      await put(dir, source, JSON.stringify(broken));
      const output = await reimport();
      const lines = output.split(/\r?\n/).filter(line => line.startsWith('Pixelbolt: '));
      assert.equal(lines.length, 1, output);
      assert.ok(lines[0].startsWith('Pixelbolt: ' + fixture.source + ':'), output);
      assert.match(lines[0], expectedError);
      assert.match(lines[0], /Previous import kept/);
      if (label === 'invalid recipe') {
        const cliFailure = await runProcess(process.execPath, [CLI, 'render', path.join(dir, source), '--out', path.join(dir, '.godot/invalid-reference')]);
        assert.equal(cliFailure.status, 1);
        const diagnostic = JSON.parse(cliFailure.output);
        assert.ok(lines[0].includes(diagnostic.error), 'Lost the CLI error message');
        assert.ok(lines[0].includes(diagnostic.path), 'Lost the CLI error path');
      }
      assert.deepEqual(await readFile(resource), previous, label + ': saved resource changed');
      await check([fixture]);
      say('failure ' + label + ': one diagnostic; previous resource unchanged and loadable.');
    }
    await put(dir, 'project.godot', projectText());
    await put(dir, source, JSON.stringify(edited));
    await reimport();
    await put(dir, 'recipes/first.pixelbolt', JSON.stringify({ ...edited, frames: [{ name: 'bad', ops: [{ op: 'not-a-pixelbolt-operation' }] }] }));
    const first = await godotRun(godot, dir, ['--import']);
    const diagnostics = first.output.split(/\r?\n/).filter(line => line.startsWith('Pixelbolt: '));
    assert.equal(diagnostics.length, 1, first.output);
    assert.match(diagnostics[0], /No previous import/);
    const errors = problems(first.output);
    assert.ok(errors.length > 0 && errors.every(line => /Error importing.*first.pixelbolt/.test(line)), first.output);
    await assertNoLeftovers(dir);
    say('first failure: Godot reports an import error; no temporary render folders remain.');
    await rm(path.join(dir, 'recipes/first.pixelbolt'));
    await rm(path.join(dir, 'recipes/first.pixelbolt.import'), { force: true });

    const demo = path.join(root, 'demo');
    await mkdir(demo);
    await sandboxSettings(demo);
    for (const name of ['project.godot', 'demo', 'addons']) await cp(path.join(ROOT, 'godot', name), path.join(demo, name), { recursive: true });
    await stampAddon(demo, packageVersion);
    let demoProject = await readFile(path.join(demo, 'project.godot'), 'utf8');
    demoProject = demoProject.replace(/^cli\/path=.*$/m, 'cli/path=' + quote(CLI));
    await put(demo, 'project.godot', demoProject);
    if (!multipart) {
      // The checked-in demo explicitly requires 4.5; adapt only this throwaway copy.
      const old = path.join(demo, 'demo/hero.pixel.json');
      await cp(old, path.join(demo, 'demo/hero.pixelbolt'));
      await rm(old);
      const scene = await readFile(path.join(demo, 'demo/demo.tscn'), 'utf8');
      await put(demo, 'demo/demo.tscn', scene.replaceAll('hero.pixel.json', 'hero.pixelbolt'));
    }
    await cleanRun(godot, demo, ['--import']);
    await cleanRun(godot, demo, ['--quit-after', '360', '--fixed-fps', '60']);
    await assertNoLeftovers(demo);
    say('demo: imported and ran 360 headless frames clean' + (multipart ? '.' : ' (throwaway recipe renamed to .pixelbolt for 4.3).'));

    // Godot 4.3's blocking pipes have their own reader: a reply in pieces, longer than a pipe holds, is read to its end.
    await cp(path.join(ROOT, 'godot/tests/long-reply.txt'), path.join(dir, '.godot/long-reply.js'));
    await put(dir, '.godot/long-reply-cli.txt', CLI);
    await put(dir, 'project.godot', projectText({ 'cli/path': path.join(dir, '.godot/long-reply.js'), 'import/timeout_seconds': 30 }));
    await put(dir, source, JSON.stringify(edited) + '\n');
    const longReply = await reimport();
    assert.ok(longReply.includes('Pixelbolt unknown: imported ' + fixture.source), longReply);
    fixture.version = 'unknown';
    await check([fixture]);
    delete fixture.version;
    await put(dir, 'project.godot', projectText());
    await put(dir, source, JSON.stringify(edited));
    await reimport();
    say('long reply: a CLI reply in two writes, longer than a pipe holds, is read to its end.');

    await put(dir, 'project.godot', projectText({ 'cli/path': path.join(dir, '.godot/stall.js'), 'import/timeout_seconds': 2 }));
    await put(dir, source, JSON.stringify({ ...edited, name: 'timeout-edited' }));
    const beforeTimeout = await readFile(resource);
    let observation;
    const timedOut = await reimport({ onOutput(output) {
      if (observation || !output.includes('CLI timed out')) return;
      const pids = JSON.parse(readFileSync(path.join(dir, '.godot/stall-pids.json'), 'utf8'));
      observation = (async () => {
        // TerminateProcess/JobObject teardown may still be completing when the
        // Output line arrives. Wait for exit, not for an assumed number of frames.
        const deadline = Date.now() + 5000;
        while (pids.some(running) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
        const survivors = pids.filter(running).map(pid => ({ pid, what: described(pid), parent: pid === pids[0] }));
        // A failed termination must fail below, but never leak the fixture.
        for (const { pid } of survivors) { try { process.kill(pid, 'SIGKILL'); } catch {} }
        return survivors;
      })();
    } });
    const survivors = await observation;
    const timeoutLines = timedOut.split(/\r?\n/).filter(line => line.startsWith('Pixelbolt: '));
    assert.equal(timeoutLines.length, 1, timedOut);
    assert.match(timeoutLines[0], /CLI timed out.*Previous import kept/);
    assert.deepEqual(await readFile(resource), beforeTimeout, 'Timeout replaced the previous import');
    await check([fixture]);
    if (survivors?.length) say('FAIL timeout: the timed-out CLI or its child survived: ' + survivors.map(item => `${item.parent ? 'CLI' : 'child'} ${item.what}`).join('; ') + '; the test cleaned them up.');
    assert.deepEqual(survivors, [], 'Timed-out processes survived (on Windows taskkill /T may be denied by the environment); the fixture processes were cleaned up');
    say('failure timeout: one diagnostic; previous resource unchanged and loadable; parent and child terminated.');
    say('PASS: all addon checks passed.');
    return { version, summaries, dir: keep ? root : null };
  } finally {
    const pidFile = path.join(dir, '.godot/stall-pids.json');
    if (existsSync(pidFile)) for (const pid of JSON.parse(await readFile(pidFile, 'utf8'))) {
      try { process.kill(pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    if (keep) log('Kept addon projects at ' + root);
    else await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const options = { godot: findGodot(option('--godot')), work: option('--work'), keep: args.includes('--keep') };
  try { await (args.includes('--install-zip') ? verifyAddonZip({ ...options, zip: option('--install-zip') }) : verifyGodotAddon(options)); }
  catch (error) { console.error(error.stack ?? error.message); process.exitCode = 1; }
}
