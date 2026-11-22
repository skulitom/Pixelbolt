// Agent Plugins 1.0.0 packaging, checked without a client installation or a schema dependency.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFile(path.join(root, file), 'utf8');
const json = async file => JSON.parse(await read(file));
const object = value => assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
function closed(value, keys) {
  object(value);
  assert.deepEqual(Object.keys(value).filter(key => !keys.includes(key)), [], 'unknown fields');
}
const strings = values => { assert.ok(Array.isArray(values)); for (const value of values) assert.equal(typeof value, 'string'); };
const expand = (text, data) => text.replaceAll('${PLUGIN_ROOT}', root).replaceAll('${PLUGIN_DATA}', data);

test('root plugin.json conforms to Agent Plugins 1.0.0 and matches the Claude plugin metadata', async () => {
  const manifest = await json('plugin.json'), claude = await json('.claude-plugin/plugin.json');
  const shared = ['name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords'];
  closed(manifest, ['$schema', ...shared, 'extensions']);
  assert.equal(manifest.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  for (const key of ['name', 'version', 'description', 'homepage', 'repository', 'license']) assert.equal(typeof manifest[key], 'string', key);
  assert.ok(manifest.name.length >= 1 && manifest.name.length <= 64);
  assert.match(manifest.name, /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
  closed(manifest.author, ['name', 'email', 'url']);
  for (const value of Object.values(manifest.author)) assert.equal(typeof value, 'string');
  strings(manifest.keywords);
  if (manifest.extensions !== undefined) {
    object(manifest.extensions);
    for (const [namespace, value] of Object.entries(manifest.extensions)) {
      assert.match(namespace, /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/); object(value);
    }
  }
  assert.equal(manifest.version, (await json('package.json')).version);
  for (const key of shared) assert.deepEqual(manifest[key], claude[key], key);
  assert.deepEqual(Object.keys(manifest).sort(), ['$schema', ...shared].sort(), 'only the shared metadata ships');
});

test('root mcp.json is a closed stdio config with portable placeholders that keeps files in PLUGIN_DATA', async () => {
  const config = await json('mcp.json'), manifest = await json('plugin.json');
  closed(config, ['$schema', 'mcpServers']);
  assert.equal(config.$schema, 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
  assert.equal(config.$schema.replace('/mcp.schema.json', ''), manifest.$schema.replace('/plugin.schema.json', ''));
  object(config.mcpServers);
  assert.deepEqual(Object.keys(config.mcpServers), ['pixelbolt']);
  for (const server of Object.values(config.mcpServers)) {
    closed(server, ['type', 'command', 'args', 'env', 'cwd']);
    assert.equal(server.type, 'stdio');
    assert.equal(typeof server.command, 'string');
    assert.match(server.command, /^[a-zA-Z0-9_.-]+$/, 'one bare executable token');
    assert.ok(server.command !== '.' && server.command !== '..');
    strings(server.args);
    const expanded = expand(server.args[0], root);
    assert.ok((await stat(expanded)).isFile(), 'args[0] names the shipped entry point');
    assert.ok(!(path.relative(root, await realpath(expanded))).startsWith('..'));
    if (server.env !== undefined) {
      object(server.env);
      for (const [key, value] of Object.entries(server.env)) {
        assert.ok(!['PLUGIN_ROOT', 'PLUGIN_DATA'].includes(key)); assert.equal(typeof value, 'string');
      }
    }
    if (server.cwd !== undefined) {
      assert.equal(typeof server.cwd, 'string');
      assert.match(server.cwd, /^(?:\.\/|\$\{PLUGIN_ROOT\}(?:\/|$)|\$\{PLUGIN_DATA\}(?:\/|$))/);
      const relative = path.relative(root, path.resolve(root, expand(server.cwd, root)));
      assert.ok(relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
    }
    for (const value of [...server.args, ...Object.values(server.env ?? {}), server.cwd ?? '']) {
      for (const placeholder of value.matchAll(/\$\{([^}]+)\}/g)) assert.ok(['PLUGIN_ROOT', 'PLUGIN_DATA'].includes(placeholder[1]));
    }
  }
  assert.deepEqual(config.mcpServers.pixelbolt, {
    type: 'stdio', command: 'node',
    args: ['${PLUGIN_ROOT}/bin/pixelbolt.js', 'mcp', '--root', '${PLUGIN_DATA}', '--out', '${PLUGIN_DATA}/output']
  });
  for (const file of ['plugin.json', 'mcp.json']) {
    const text = await read(file);
    assert.doesNotMatch(text, /CLAUDE_PLUGIN_ROOT/);
    assert.equal(text, JSON.stringify(JSON.parse(text), null, 2) + '\n', 'two-space JSON, LF and trailing newline');
    assert.ok(!(await json('package.json')).files.includes(file), `${file} stays out of npm`);
  }
});

test('every discovered skill has an Agent Skills name matching its immediate directory and a description', async () => {
  let count = 0;
  for (const entry of await readdir(path.join(root, 'skills'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let skill;
    try { skill = await read(`skills/${entry.name}/SKILL.md`); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    count++;
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(skill)?.[1];
    assert.ok(frontmatter, entry.name);
    const name = /^name: (.+)$/m.exec(frontmatter)?.[1].trim();
    const description = /^description: (.+)$/m.exec(frontmatter)?.[1].trim();
    assert.equal(name, entry.name);
    assert.ok(name.length >= 1 && name.length <= 64);
    assert.match(name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(description?.length >= 1 && description.length <= 1024);
  }
  assert.ok(count > 0, 'the package ships a discoverable skill');
});

// Launches the server as an Agent Plugins client does: placeholders expanded, cwd = the plugin root, PLUGIN_* set.
test('the Agent Plugins launch lists the tools and keeps renders and saveAs copies in PLUGIN_DATA, never the plugin folder', { timeout: 30000 }, async t => {
  const base = await mkdtemp(path.join(await realpath(os.tmpdir()), 'pixelbolt-agent-plugins-'));
  const data = path.join(base, 'data');
  await mkdir(data);
  const server = (await json('mcp.json')).mcpServers.pixelbolt;
  const child = spawn(server.command, server.args.map(arg => expand(arg, data)), { cwd: root, env: { ...process.env, PLUGIN_ROOT: root, PLUGIN_DATA: data }, stdio: ['pipe', 'pipe', 'inherit'] });
  const exited = once(child, 'exit');
  t.after(async () => { child.kill(); await exited; await rm(base, { recursive: true, force: true }); });
  await once(child, 'spawn');
  let buffer = '', id = 0;
  const waiting = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    for (let end; (end = buffer.indexOf('\n')) !== -1;) {
      const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      waiting.get(message.id)?.(message);
    }
  });
  const request = (method, params) => new Promise(resolve => { waiting.set(++id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  assert.equal((await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'agent-plugins-test', version: '1' } })).result.serverInfo.name, 'pixelbolt');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  assert.ok((await request('tools/list')).result.tools.some(tool => tool.name === 'pixel_render'));
  const name = `agent-art-${path.basename(base)}`;
  const project = { version: 1, name, width: 2, height: 2, palette: { k: '#fff' }, frames: [{ name: 'still', ops: [{ op: 'pixel', x: 0, y: 0, color: 'k' }] }] };
  const reply = await request('tools/call', { name: 'pixel_render', arguments: { project, saveAs: { sheet: 'assets/sheet.png' } } });
  assert.ok(reply.result, JSON.stringify(reply));
  const info = JSON.parse(reply.result.content[0].text);
  assert.equal(info.ok, true, JSON.stringify(info));
  // An agent outside the data folder finds every file from the reply alone.
  assert.equal(path.isAbsolute(info.directory), true);
  assert.equal(path.dirname(info.directory), path.join(data, 'output'));
  assert.ok((await stat(path.join(info.directory, `${name}.png`))).isFile());
  assert.deepEqual(info.saved.map(item => item.path), [path.join(data, 'assets', 'sheet.png')]);
  assert.ok((await stat(path.join(data, 'assets', 'sheet.png'))).isFile());
  const inRepo = await readdir(path.join(root, 'output')).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  assert.deepEqual(inRepo.filter(entry => entry.startsWith(name)), [], 'no export in the plugin folder');
  await assert.rejects(stat(path.join(root, 'assets', 'sheet.png')), { code: 'ENOENT' });
});
