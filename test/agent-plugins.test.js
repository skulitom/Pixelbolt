// Agent Plugins 1.0.0 packaging and workspace selection, without a client installation or schema dependency.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startMCP } from '../src/mcp.js';

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

test('root mcp.json is a closed stdio config with portable placeholders and a persistent fallback', async () => {
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
    assert.ok(server.args.includes('--roots'));
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
    args: ['${PLUGIN_ROOT}/bin/pixelbolt.js', 'mcp', '--roots', '--root', '${PLUGIN_DATA}', '--out', '${PLUGIN_DATA}/output']
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

// A line-based client keeps server requests separate from responses, so roots/list can be answered while a tool waits.
function client(input, output) {
  let buffer = '', id = 0;
  const messages = [], inbox = [], waiting = [];
  output.setEncoding('utf8');
  output.on('data', chunk => {
    buffer += chunk;
    for (let end; (end = buffer.indexOf('\n')) !== -1;) {
      const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      messages.push(message);
      const index = waiting.findIndex(item => item.matches(message));
      if (index === -1) inbox.push(message); else waiting.splice(index, 1)[0].resolve(message);
    }
  });
  const next = matches => {
    const index = inbox.findIndex(matches);
    if (index !== -1) return Promise.resolve(inbox.splice(index, 1)[0]);
    return new Promise(resolve => waiting.push({ matches, resolve }));
  };
  const send = message => input.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  const request = (method, params) => { const current = ++id; send({ id: current, method, params }); return next(message => message.id === current && !message.method); };
  return {
    messages, send, request,
    roots: () => next(message => message.method === 'roots/list'),
    notify: method => send({ method }),
    init: capabilities => request('initialize', { protocolVersion: '2025-11-25', capabilities, clientInfo: { name: 'agent-plugins-test', version: '1' } }),
    call: async args => {
      const response = await request('tools/call', { name: 'pixel_render', arguments: args });
      assert.ok(response.result, JSON.stringify(response));
      const info = JSON.parse(response.result.content[0].text);
      assert.equal(info.ok, true, JSON.stringify(info));
      return info;
    }
  };
}

async function session(t, { roots = true, local = false } = {}) {
  const base = await mkdtemp(path.join(await realpath(os.tmpdir()), 'pixelbolt-agent-plugins-'));
  const data = path.join(base, 'data'), workspace = path.join(base, 'workspace'), other = path.join(base, 'other');
  let stop = async () => {};
  t.after(async () => { await stop(); await rm(base, { recursive: true, force: true }); });
  await Promise.all([data, workspace, other].map(folder => mkdir(folder)));
  const server = (await json('mcp.json')).mcpServers.pixelbolt;
  let input, output, stderr = '';
  if (local) {
    input = new PassThrough(); output = new PassThrough();
    const running = startMCP({ roots, root: data, directory: path.join(data, 'output'), input, output });
    stop = async () => { input.end(); await running; };
  } else {
    const args = server.args.filter(arg => roots || arg !== '--roots').map(arg => expand(arg, data));
    const child = spawn(server.command, args, { cwd: root, env: { ...process.env, PLUGIN_ROOT: root, PLUGIN_DATA: data }, stdio: ['pipe', 'pipe', 'pipe'] });
    input = child.stdin; output = child.stdout;
    child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { stderr += chunk; });
    const exited = once(child, 'exit');
    stop = async () => { child.kill(); await exited; };
    await once(child, 'spawn');
  }
  const connection = client(input, output);
  const project = { version: 1, name: `agent-art-${path.basename(base)}`, width: 2, height: 2, palette: { k: '#fff' }, frames: [{ name: 'still', ops: [{ op: 'pixel', x: 0, y: 0, color: 'k' }] }] };
  return { ...connection, data, workspace, other, project, stderr: () => stderr };
}

const directories = async folder => readdir(folder).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
async function exported(info, folder, project) {
  assert.equal(path.isAbsolute(info.directory), true, 'the existing reply locates fallback exports without new fields');
  assert.equal(path.dirname(info.directory), path.join(folder, 'output'));
  assert.ok((await stat(path.join(info.directory, `${project.name}.png`))).isFile());
  assert.ok((await stat(path.join(folder, 'output', '.revisions'))).isDirectory());
  assert.deepEqual((await directories(path.join(root, 'output'))).filter(name => name.startsWith(project.name)), [], 'no export in the plugin checkout');
}
const rootResult = (...folders) => ({ roots: folders.map(folder => ({ uri: pathToFileURL(folder).href })) });
async function choose(mcp, ...folders) {
  const request = await mcp.roots();
  assert.equal(typeof request.id, 'string');
  assert.deepEqual(Object.keys(request).sort(), ['id', 'jsonrpc', 'method']);
  mcp.send({ id: request.id, result: rootResult(...folders) });
}
const timeout = { timeout: 20000 };

test('Agent Plugins launch without roots capability lists tools and exports in PLUGIN_DATA, never the repo', timeout, async t => {
  const mcp = await session(t);
  await mcp.init({}); mcp.notify('notifications/initialized');
  assert.ok((await mcp.request('tools/list')).result.tools.some(tool => tool.name === 'pixel_render'));
  await exported(await mcp.call({ project: mcp.project }), mcp.data, mcp.project);
  assert.equal(mcp.messages.some(message => message.method === 'roots/list'), false);
  assert.ok(mcp.stderr().includes(JSON.stringify(path.join(mcp.data, 'output'))));
});

test('--roots reports and uses the plugin data fallback for stateless clients without initialize', timeout, async t => {
  const mcp = await session(t);
  const reply = await mcp.request('tools/call', { name: 'pixel_render', arguments: { project: mcp.project },
    _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} } });
  assert.ok(reply.result, JSON.stringify(reply));
  const info = JSON.parse(reply.result.content[0].text);
  assert.equal(info.ok, true, JSON.stringify(info));
  await exported(info, mcp.data, mcp.project);
  assert.ok(mcp.stderr().includes(JSON.stringify(path.join(mcp.data, 'output'))));
  assert.equal(mcp.messages.some(message => message.method === 'roots/list'), false);
});

test('--roots waits for the workspace answer while discovery and ping remain available, then saveAs writes there', timeout, async t => {
  const mcp = await session(t);
  await mcp.init({ roots: {}, extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } });
  assert.equal(mcp.messages.some(message => message.method === 'roots/list'), false, 'wait for initialized notification');
  mcp.notify('notifications/initialized');
  const request = await mcp.roots();
  let finished = false;
  const rendered = mcp.call({ project: mcp.project, saveAs: { sheet: 'assets/sheet.png' } }).then(info => { finished = true; return info; });
  assert.ok((await mcp.request('tools/list')).result.tools.length);
  assert.ok((await mcp.request('resources/list')).result.resources.length);
  assert.deepEqual((await mcp.request('ping')).result, {});
  assert.equal((await mcp.init({})).result.serverInfo.name, 'pixelbolt');
  assert.equal(finished, false, 'the tool waits for roots instead of writing into the fallback');
  assert.deepEqual(await directories(path.join(mcp.data, 'output')), []);
  mcp.send({ id: request.id, result: rootResult(mcp.workspace) });
  const info = await rendered;
  await exported(info, mcp.workspace, mcp.project);
  assert.ok((await stat(path.join(mcp.workspace, 'assets/sheet.png'))).isFile());
  assert.deepEqual(await directories(path.join(mcp.data, 'output')), []);
  assert.ok(mcp.stderr().includes(JSON.stringify(mcp.workspace)));
  assert.equal(mcp.messages.filter(message => message.method === 'roots/list').length, 1);
});

for (const [label, answer] of [
  ['an error', { error: { code: -32601, message: 'No roots here' } }],
  ['an empty list', { result: { roots: [] } }],
  ['no usable root', { result: { roots: [{ uri: 'https://example.com/project' }, { uri: 'file:///%zz' }, { uri: 42 }] } }]
]) test(`--roots uses the configured fallback after ${label}`, timeout, async t => {
  const mcp = await session(t);
  await mcp.init({ roots: {} }); mcp.notify('notifications/initialized');
  const request = await mcp.roots();
  mcp.send({ id: request.id, ...answer });
  await exported(await mcp.call({ project: mcp.project, saveAs: { sheet: 'assets/fallback.png' } }), mcp.data, mcp.project);
  assert.ok((await stat(path.join(mcp.data, 'assets/fallback.png'))).isFile());
  assert.deepEqual(await directories(path.join(mcp.workspace, 'output')), []);
});

test('--roots skips non-file, missing and non-directory roots for the next usable directory', timeout, async t => {
  const mcp = await session(t);
  const file = path.join(mcp.workspace, 'file'); await writeFile(file, 'not a directory');
  await mcp.init({ roots: {} }); mcp.notify('notifications/initialized');
  const request = await mcp.roots();
  mcp.send({ id: request.id, result: { roots: [{ uri: 'https://example.com' }, ...rootResult(path.join(mcp.workspace, 'missing'), file, mcp.workspace, mcp.other).roots] } });
  await exported(await mcp.call({ project: mcp.project }), mcp.workspace, mcp.project);
  assert.deepEqual(await directories(path.join(mcp.other, 'output')), []);
});

test('--roots list_changed moves later calls and revisions to the new workspace, then an empty list restores fallback', timeout, async t => {
  const mcp = await session(t);
  await mcp.init({ roots: { listChanged: true } }); mcp.notify('notifications/initialized');
  await choose(mcp, mcp.workspace);
  const first = await mcp.call({ project: mcp.project }); await exported(first, mcp.workspace, mcp.project);
  mcp.notify('notifications/roots/list_changed'); await choose(mcp, mcp.other);
  const missing = await mcp.request('tools/call', { name: 'pixel_validate', arguments: { revision: first.revision } });
  assert.equal(missing.result.isError, true, 'revisions are not carried over');
  await exported(await mcp.call({ project: mcp.project, saveAs: { sheet: 'later.png' } }), mcp.other, mcp.project);
  assert.ok((await stat(path.join(mcp.other, 'later.png'))).isFile());
  mcp.notify('notifications/roots/list_changed'); await choose(mcp);
  await exported(await mcp.call({ project: mcp.project }), mcp.data, mcp.project);
  assert.equal(mcp.messages.filter(message => message.method === 'roots/list').length, 3);
});

test('--roots ignores unknown response ids without answering them and still rejects genuinely invalid messages', timeout, async t => {
  const mcp = await session(t);
  await mcp.init({});
  const before = mcp.messages.length;
  mcp.send({ id: 'unknown', result: { roots: [] } });
  mcp.send({ id: 'unknown-error', error: { code: -32601, message: 'Unknown' } });
  await mcp.request('tools/list');
  assert.equal(mcp.messages.length, before + 1, 'only tools/list gets a reply');
  mcp.send({ id: 'broken' });
  const help = await mcp.request('tools/call', { name: 'pixel_help', arguments: {} });
  assert.ok(help.result.content.length);
  assert.equal(mcp.messages.at(-2).error.code, -32600);
});

test('without --roots a roots-capable client never receives roots/list and keeps the configured paths', timeout, async t => {
  const mcp = await session(t, { roots: false });
  await mcp.init({ roots: { listChanged: true } });
  mcp.notify('notifications/initialized'); mcp.notify('notifications/roots/list_changed');
  await exported(await mcp.call({ project: mcp.project }), mcp.data, mcp.project);
  assert.equal(mcp.messages.some(message => message.method === 'roots/list'), false);
  assert.equal(mcp.stderr(), '');
});

test('--roots times out after 10 seconds despite overlapping notifications, releases waiting calls and ignores late answers', timeout, async t => {
  const mcp = await session(t, { local: true });
  await mcp.init({ roots: {} });
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  mcp.notify('notifications/initialized'); const request = await mcp.roots();
  let finished = false;
  const rendered = mcp.call({ project: mcp.project }).then(info => { finished = true; return info; });
  t.mock.timers.tick(9000);
  mcp.notify('notifications/roots/list_changed'); const newer = await mcp.roots();
  t.mock.timers.tick(999);
  await mcp.request('ping');
  assert.equal(finished, false);
  assert.deepEqual(await directories(path.join(mcp.data, 'output')), []);
  t.mock.timers.tick(1); t.mock.timers.reset();
  await exported(await rendered, mcp.data, mcp.project);
  mcp.send({ id: request.id, result: rootResult(mcp.workspace) });
  mcp.send({ id: newer.id, result: rootResult(mcp.other) });
  await exported(await mcp.call({ project: mcp.project }), mcp.data, mcp.project);
});

test('--roots accepts only the newest overlapping list response', timeout, async t => {
  const mcp = await session(t);
  await mcp.init({ roots: {} }); mcp.notify('notifications/initialized');
  const old = await mcp.roots();
  mcp.notify('notifications/roots/list_changed'); const latest = await mcp.roots();
  assert.notEqual(latest.id, old.id);
  mcp.send({ id: latest.id, result: rootResult(mcp.other) });
  mcp.send({ id: old.id, result: rootResult(mcp.workspace) });
  await exported(await mcp.call({ project: mcp.project }), mcp.other, mcp.project);
  assert.deepEqual(await directories(path.join(mcp.workspace, 'output')), []);
});

test('--roots lets an in-flight worker finish in its original workspace and starts queued calls in the new one', timeout, async t => {
  let release, started;
  t.after(() => { release?.(); });
  const mcp = await session(t, { local: true });
  await mcp.init({ roots: {} }); mcp.notify('notifications/initialized'); await choose(mcp, mcp.workspace);
  const held = new Promise(resolve => { started = resolve; });
  const post = Worker.prototype.postMessage;
  const mocked = t.mock.method(Worker.prototype, 'postMessage', function (message, ...rest) {
    if (message.name === 'pixel_render' && !release) {
      release = () => post.call(this, message, ...rest); started();
    } else return post.call(this, message, ...rest);
  });
  const first = mcp.call({ project: mcp.project }); await held;
  // Wait for root validation itself, without relying on rendering speed or a sleep.
  const applied = new Promise(resolve => {
    const write = process.stderr.write;
    const mock = t.mock.method(process.stderr, 'write', function (chunk, ...args) {
      const result = write.call(this, chunk, ...args);
      if (String(chunk).includes(JSON.stringify(mcp.other))) { mock.mock.restore(); resolve(); }
      return result;
    });
  });
  mcp.notify('notifications/roots/list_changed'); await choose(mcp, mcp.other);
  const second = mcp.call({ project: mcp.project });
  await applied;
  mocked.mock.restore(); const resume = release; release = null; resume();
  await exported(await first, mcp.workspace, mcp.project);
  await exported(await second, mcp.other, mcp.project);
});
