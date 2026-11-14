import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { startMCP } from '../src/mcp.js';

const PROTOCOL = 'io.modelcontextprotocol/protocolVersion', CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities', SERVER = 'io.modelcontextprotocol/serverInfo';
const UI_URI = 'ui://pixelbolt/viewer', UI_MIME = 'text/html;profile=mcp-app';
const supported = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2026-07-28'];
const uiCapabilities = { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: [UI_MIME] } } };
const meta = (capabilities = {}) => ({ [PROTOCOL]: '2026-07-28', [CAPABILITIES]: capabilities });
const project = { version: 1, name: 'dot', width: 1, height: 1, palette: { k: '#000' }, frames: [{ name: 'a', ops: [{ op: 'pixel', x: 0, y: 0, color: 'k' }] }] };
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// The same stream client as mcp-protocol, with teardown registered before any assertions or worker calls.
async function session(t) {
  const base = path.resolve(os.tmpdir()), directory = await mkdtemp(path.join(base, 'pixelbolt-discover-'));
  const input = new PassThrough(), output = new PassThrough(), received = [], waiting = new Map(); let buffer = '', next = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); received.push(message); waiting.get(message.id)?.(message); } });
  const running = startMCP({ input, output, directory });
  t.after(async () => { input.end(); await running; assert.ok(directory.startsWith(base + path.sep)); await rm(directory, { recursive: true, force: true }); });
  const send = message => input.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  const request = (method, params) => { const id = ++next, answered = new Promise(resolve => waiting.set(id, resolve)); send({ id, method, params }); return { id, answered }; };
  const modern = (method, params = {}, capabilities = {}) => request(method, { ...params, _meta: meta(capabilities) }).answered;
  const init = (capabilities = {}) => request('initialize', { protocolVersion: '2025-11-25', capabilities, clientInfo: { name: 'test', version: '1' } }).answered;
  return { received, request, modern, init };
}
function complete(reply, cacheable = false) {
  assert.equal(reply.error, undefined);
  assert.equal(reply.result.resultType, 'complete');
  assert.deepEqual(reply.result._meta[SERVER], { name: 'pixelbolt', version });
  if (cacheable) { assert.equal(reply.result.ttlMs, 0); assert.equal(reply.result.cacheScope, 'private'); }
  else { assert.equal(Object.hasOwn(reply.result, 'ttlMs'), false); assert.equal(Object.hasOwn(reply.result, 'cacheScope'), false); }
  return reply.result;
}

for (const ui of [false, true]) test(`MCP discover before initialize advertises ${ui ? 'tools and the UI resource' : 'only tools'}`, async t => {
  const mcp = await session(t), capabilities = ui ? uiCapabilities : {};
  const discovery = complete(await mcp.modern('server/discover', {}, capabilities), true);
  assert.deepEqual(discovery.supportedVersions, supported);
  assert.deepEqual(discovery.capabilities, { tools: {}, ...(ui && { resources: {} }) });
  assert.equal(Object.hasOwn(discovery, 'serverInfo'), false);
  const initialized = (await mcp.init(capabilities)).result;
  assert.equal(discovery.instructions, initialized.instructions);
  assert.match(discovery.instructions, /^Use Pixelbolt when the user wants pixel art:/);
});

test('MCP lists tools statelessly without discover, selecting UI metadata anew on every request', async t => {
  const mcp = await session(t);
  for (const capabilities of [{}, uiCapabilities, {}, { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html'] } } }, uiCapabilities]) {
    const result = complete(await mcp.modern('tools/list', {}, capabilities), true);
    assert.ok(result.tools.some(tool => tool.name === 'pixel_validate'));
    const picture = result.tools.find(tool => tool.name === 'pixel_inspect');
    assert.deepEqual(picture._meta, capabilities === uiCapabilities ? { ui: { resourceUri: UI_URI }, 'ui/resourceUri': UI_URI } : undefined);
  }
});

test('MCP validates a real recipe statelessly and decorates tool errors as complete results', async t => {
  const mcp = await session(t);
  const result = complete(await mcp.modern('tools/call', { name: 'pixel_validate', arguments: { project } }));
  const info = JSON.parse(result.content[0].text);
  assert.equal(info.ok, true);
  assert.match(info.revision, /^[a-f0-9]{12}$/);
  const invalid = complete(await mcp.modern('tools/call', { name: 'pixel_validate', arguments: { project: {} } }));
  assert.equal(invalid.isError, true);
  const text = complete(await mcp.modern('tools/call', { name: 'pixel_validate', arguments: { project: '{' } }));
  assert.equal(text.isError, true);
});

test('MCP tool workers receive each request UI flag and keep preview metadata beside serverInfo', async t => {
  const mcp = await session(t);
  for (const capabilities of [uiCapabilities, {}, uiCapabilities]) {
    const result = complete(await mcp.modern('tools/call', { name: 'pixel_inspect', arguments: { project } }, capabilities));
    assert.equal(Object.hasOwn(result._meta, 'io.github.skulitom/pixelbolt'), capabilities === uiCapabilities);
  }
});

for (const method of ['resources/list', 'resources/templates/list', 'resources/read']) test(`MCP serves ${method} statelessly only for that request's UI capability`, async t => {
  const mcp = await session(t), params = method === 'resources/read' ? { uri: UI_URI } : {};
  for (const capabilities of [uiCapabilities, {}, uiCapabilities]) {
    const reply = await mcp.modern(method, params, capabilities);
    if (capabilities !== uiCapabilities) { assert.equal(reply.error.code, -32601); continue; }
    const result = complete(reply, true);
    if (method === 'resources/list') assert.equal(result.resources[0].mimeType, UI_MIME);
    if (method === 'resources/templates/list') assert.deepEqual(result.resourceTemplates, []);
    if (method === 'resources/read') { assert.equal(result.contents[0].uri, UI_URI); assert.match(result.contents[0].text, /ui\/initialize/); }
  }
  if (method === 'resources/read') assert.equal((await mcp.modern(method, { uri: 'ui://missing' }, uiCapabilities)).error.code, -32602);
});

test('MCP ping stays immediate, validates modern metadata and leaves legacy ping unchanged', async t => {
  const mcp = await session(t);
  const queued = mcp.request('tools/list', { _meta: meta() }), ping = mcp.request('ping', { _meta: meta() });
  complete(await ping.answered);
  complete(await queued.answered, true);
  assert.deepEqual(mcp.received.map(message => message.id), [ping.id, queued.id]);
  assert.deepEqual((await mcp.request('ping').answered).result, {});
  assert.equal((await mcp.request('ping', { _meta: { [PROTOCOL]: '2026-07-28' } }).answered).error.code, -32602);
});

const invalidMeta = [
  ['no _meta', undefined, [PROTOCOL, CAPABILITIES]],
  ['null _meta', null, [PROTOCOL, CAPABILITIES]],
  ['array _meta', [], [PROTOCOL, CAPABILITIES]],
  ['missing protocolVersion', { [CAPABILITIES]: {} }, [PROTOCOL]],
  ['missing clientCapabilities', { [PROTOCOL]: '2026-07-28' }, [CAPABILITIES]],
  ['wrong protocolVersion type', { ...meta(), [PROTOCOL]: 2026 }, [PROTOCOL]],
  ['null clientCapabilities', meta(null), [CAPABILITIES]],
  ['array clientCapabilities', meta([]), [CAPABILITIES]],
  ['string clientCapabilities', meta('ui'), [CAPABILITIES]],
  ['malformed nested capability', meta({ roots: { listChanged: 'yes' } }), [CAPABILITIES]],
  ['malformed optional clientInfo', { ...meta(), 'io.modelcontextprotocol/clientInfo': { name: 'test' } }, ['io.modelcontextprotocol/clientInfo']]
];
for (const [label, envelope, fields] of invalidMeta) test(`MCP rejects ${label} with named invalid metadata fields`, async t => {
  const mcp = await session(t);
  // A _meta that isn't an object holds no envelope, so only server/discover reads it as a 2026 request.
  const envelopes = envelope !== null && typeof envelope === 'object' && !Array.isArray(envelope);
  for (const method of envelopes ? ['server/discover', 'tools/list', 'ping'] : ['server/discover']) {
    const reply = await mcp.request(method, envelope === undefined ? undefined : { _meta: envelope }).answered;
    assert.equal(reply.error?.code, -32602);
    for (const field of fields) assert.ok(reply.error.message.includes(field), reply.error.message);
  }
});

test('MCP keeps a 2025 session\'s requests with a _meta that holds no envelope on the 2025 path', async t => {
  const mcp = await session(t);
  for (const envelope of [null, [], 'x']) assert.deepEqual((await mcp.request('tools/list', { _meta: envelope }).answered).error, { code: -32000, message: 'Initialize the server first' });
  await mcp.init();
  const legacy = (await mcp.request('tools/list').answered).result;
  for (const envelope of [null, [], 'x', { progressToken: 3 }]) {
    assert.deepEqual((await mcp.request('tools/list', { _meta: envelope }).answered).result, legacy);
    assert.deepEqual((await mcp.request('ping', { _meta: envelope }).answered).result, {});
  }
});

test('MCP unsupported versions return the negotiation error with supported and requested versions', async t => {
  const mcp = await session(t);
  for (const method of ['server/discover', 'tools/list', 'ping']) {
    const reply = await mcp.request(method, { _meta: { ...meta(), [PROTOCOL]: '2099-01-01' } }).answered;
    assert.deepEqual(reply.error, { code: -32022, message: 'Unsupported protocol version: 2099-01-01', data: { supported, requested: '2099-01-01' } });
  }
});

test('MCP discovery does not initialize or alter a legacy session or its tools/list result', async t => {
  for (const ui of [false, true]) {
    const mcp = await session(t), before = await mcp.request('tools/list').answered;
    assert.deepEqual(before.error, { code: -32000, message: 'Initialize the server first' });
    complete(await mcp.modern('server/discover', {}, uiCapabilities), true);
    assert.deepEqual((await mcp.request('tools/list').answered).error, before.error);
    const initialized = (await mcp.init(ui ? uiCapabilities : {})).result;
    assert.deepEqual(initialized, { protocolVersion: '2025-11-25', capabilities: { tools: {}, ...(ui && { resources: {} }) }, serverInfo: { name: 'pixelbolt', version }, instructions: initialized.instructions });
    const legacy = (await mcp.request('tools/list').answered).result;
    assert.deepEqual(Object.keys(legacy), ['tools']);
    const modern = complete(await mcp.modern('tools/list', {}, ui ? {} : uiCapabilities), true);
    assert.equal(Object.hasOwn(modern.tools.find(tool => tool.name === 'pixel_inspect'), '_meta'), !ui);
    assert.deepEqual((await mcp.request('tools/list', { _meta: { progressToken: 1 } }).answered).result, legacy);
    assert.deepEqual((await mcp.init(ui ? {} : uiCapabilities)).result, initialized);
  }
});
