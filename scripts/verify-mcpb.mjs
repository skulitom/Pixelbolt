// Smoke-test only the bundle's files, from an unrelated cwd and an initially absent workspace.
// node scripts/verify-mcpb.mjs dist/mcpb/pixelbolt.mcpb
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, readdir, realpath, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip } from './build-studio.mjs';

export const TOOL_NAMES = ['pixel_help', 'pixel_validate', 'pixel_inspect', 'pixel_patch', 'pixel_render', 'pixel_compile', 'pixel_scene', 'pixel_import'];
const tiny = { version: 1, name: 'mcpb-smoke', width: 2, height: 2, frames: [{ name: 'idle', ops: [{ op: 'pixel', x: 0, y: 0, color: '#ff0066' }] }] };
const inside = (base, file) => { const relative = path.relative(base, file); return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };

export function checkManifest(manifest, pkg) {
  for (const key of ['name', 'version', 'description', 'display_name']) assert.ok(typeof manifest[key] === 'string' && manifest[key], `manifest.${key} is required`);
  assert.equal(manifest.manifest_version, '0.3', 'manifest_version must be 0.3');
  assert.equal(manifest.name, 'pixelbolt');
  assert.equal(manifest.display_name, 'Pixelbolt');
  assert.equal(pkg.name, 'pixelbolt');
  assert.equal(manifest.version, pkg.version, 'manifest version must equal bundled package.json version');
  assert.match(manifest.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  assert.ok(manifest.author?.name, 'manifest.author.name is required');
  assert.equal(manifest.server?.type, 'node');
  assert.equal(manifest.server.entry_point, 'bin/pixelbolt.js');
  assert.equal(manifest.server.mcp_config?.command, 'node');
  assert.ok(Array.isArray(manifest.server.mcp_config.args), 'manifest server args are required');
  assert.equal(manifest.user_config?.workspace?.type, 'directory');
  assert.ok(manifest.user_config.workspace.default, 'workspace default is required');
  assert.deepEqual(new Set(manifest.compatibility?.platforms), new Set(['win32', 'darwin', 'linux']));
  assert.equal(manifest.compatibility.runtimes?.node, '>=20.0.0');
  assert.ok(Array.isArray(manifest.tools));
  assert.equal(manifest.tools.length, TOOL_NAMES.length);
  assert.deepEqual(new Set(manifest.tools.map(tool => tool.name)), new Set(TOOL_NAMES));
  assert.ok(manifest.tools.every(tool => typeof tool.description === 'string' && tool.description), 'every tool needs a description');
}

export async function verifyMcpb(bundle) {
  const entries = readZip(await readFile(bundle));
  for (const file of ['manifest.json', 'package.json', 'bin/pixelbolt.js', 'bin/pixelforge.js']) assert.ok(entries.has(file), `Bundle is missing ${file}`);
  const manifest = JSON.parse(entries.get('manifest.json').read()), pkg = JSON.parse(entries.get('package.json').read());
  checkManifest(manifest, pkg);
  const tempRoot = path.resolve(os.tmpdir()), temp = await mkdtemp(path.join(tempRoot, 'pixelbolt-mcpb-'));
  let child, closed, timer;
  try {
    const extension = path.join(temp, 'extension'), workspace = path.join(temp, 'new-workspace'), cwd = path.join(temp, 'cwd');
    await mkdir(cwd);
    for (const [name, entry] of entries) {
      // Reject traversal, Windows drive/stream names and ambiguous separator aliases before extracting anything.
      assert.ok(!/[\\:]/.test(name) && !name.split('/').some(part => part === '.' || part === '..' || part === ''), `Unsafe bundle path: ${name}`);
      const file = path.resolve(extension, name);
      assert.ok(inside(extension, file), `Bundle path escapes extraction folder: ${name}`);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, entry.read(), { flag: 'wx' });
    }
    const substitute = value => {
      assert.equal(typeof value, 'string', 'MCP config values must be strings');
      const result = value.replaceAll('${__dirname}', extension).replaceAll('${user_config.workspace}', workspace);
      assert.ok(!result.includes('${'), `Unresolved MCP variable: ${result}`);
      return result;
    };
    const config = manifest.server.mcp_config, pending = new Map();
    let id = 0, buffer = '', stderr = '', failure;
    const fail = error => { failure ??= error; for (const request of pending.values()) request.reject(error); pending.clear(); };
    child = spawn(process.execPath, config.args.map(substitute), {
      cwd, env: { ...process.env, ...Object.fromEntries(Object.entries(config.env ?? {}).map(([key, value]) => [key, substitute(value)])) },
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
    });
    closed = new Promise(resolve => child.once('close', (code, signal) => { fail(new Error(`MCP server exited (${code ?? signal}): ${stderr}`)); resolve(); }));
    child.on('error', fail);
    child.stdin.on('error', fail);
    child.stderr.setEncoding('utf8'); child.stderr.on('data', data => { stderr = (stderr + data).slice(-8000); });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', data => {
      try {
        buffer += data;
        assert.ok(buffer.length < 4 * 1024 * 1024, 'MCP response exceeds smoke-test budget');
        let end;
        while ((end = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          const message = JSON.parse(line), request = pending.get(message.id);
          assert.equal(message.jsonrpc, '2.0');
          if (!request) continue;
          pending.delete(message.id);
          if (message.error) request.reject(new Error(`${request.method}: ${JSON.stringify(message.error)}`));
          else request.resolve(message.result);
        }
      } catch (error) { fail(error); }
    });
    timer = setTimeout(() => { fail(new Error(`MCP smoke test timed out after 8 seconds. ${stderr}`)); child.kill(); }, 8000);
    const send = message => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
    const request = (method, params) => new Promise((resolve, reject) => {
      if (failure) { reject(failure); return; }
      const current = ++id; pending.set(current, { resolve, reject, method }); send({ id: current, method, params });
    });
    const call = async (name, args = {}) => {
      const result = await request('tools/call', { name, arguments: args });
      assert.ok(!result?.isError, `${name} failed: ${JSON.stringify(result)}`);
      assert.ok(Array.isArray(result?.content), `${name} returned no content`);
      return result;
    };
    const initialized = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'pixelbolt-mcpb-smoke', version: '1.0.0' } });
    assert.equal(initialized.serverInfo.version, pkg.version);
    assert.equal(initialized.serverInfo.name, 'pixelbolt');
    send({ method: 'notifications/initialized' });
    const listed = await request('tools/list', {});
    assert.deepEqual(new Set(listed.tools.map(tool => tool.name)), new Set(manifest.tools.map(tool => tool.name)));
    const help = await call('pixel_help');
    assert.match(help.content[0].text, /^# Pixelbolt quick start/);
    const topic = async name => (await call('pixel_help', { topic: name })).content[0].text;
    assert.ok(JSON.parse(await topic('schema')).properties.frames && JSON.parse(await topic('example')).frames, 'pixel_help must serve the schema and an editable example');
    for (const name of ['guide', 'workflow']) assert.match(await topic(name), /^# /, `pixel_help topic ${name} must serve its guide`);
    for (const name of ['poses', 'scenes', 'autotile', 'fx', 'fluid', 'normals']) assert.ok(JSON.parse(await topic(name)));
    const checkFiles = async result => {
      const info = JSON.parse(result.content[0].text);
      assert.equal(info.ok, true);
      assert.ok(inside(workspace, info.directory), `Exports escaped workspace: ${info.directory}`);
      assert.ok(info.files.length > 0, 'Render returned no files');
      for (const name of info.files) {
        const file = path.resolve(info.directory, name);
        assert.ok(inside(workspace, file) && inside(await realpath(workspace), await realpath(file)), `Export escaped workspace: ${file}`);
        assert.ok((await stat(file)).isFile(), `Missing render file: ${file}`);
      }
      return info;
    };
    const rendered = await checkFiles(await call('pixel_render', { project: tiny, listFiles: true }));
    const png = path.join(rendered.directory, 'mcpb-smoke.png');
    assert.deepEqual((await readFile(png)).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    // Exercise --root as well as --out, and the scene player's file reads that a sprite render never reaches.
    await call('pixel_import', { path: path.relative(workspace, png) });
    await checkFiles(await call('pixel_scene', { scene: { format: 'pixelforge-scene', version: 1, name: 'mcpb-scene', width: 2, height: 2, assets: { dot: tiny }, instances: [{ asset: 'dot', at: [0, 0] }] }, export: true }));
    assert.deepEqual(await readdir(cwd), [], 'The server wrote into its working directory');
    return { version: pkg.version, tools: listed.tools.length, files: entries.size };
  } finally {
    clearTimeout(timer);
    if (child) { child.kill(); await closed; }
    assert.ok(inside(tempRoot, temp), 'Refusing to remove a folder outside the temporary root');
    await rm(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  Promise.resolve().then(() => {
    if (args.length !== 1) throw new Error('Usage: node scripts/verify-mcpb.mjs <bundle>');
    return verifyMcpb(args[0]);
  }).then(result => console.log(`MCPB verified: Pixelbolt ${result.version}, ${result.tools} tools, ${result.files} files; help, sprite and scene exports passed.`)).catch(error => { console.error(`MCPB verification failed: ${error.message}`); process.exitCode = 1; });
}
