// P-041: agents sometimes send a tool's object or list argument as JSON text. The server reads text that parses to the
// type the schema declares, says so in the reply, and answers any other text with what to send instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { startMCP, MAX_ARGUMENT_DEPTH, parseTextArguments } from '../src/mcp.js';

const temp = async t => {
  const base = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(base, 'pixelbolt-text-arguments-'));
  t.after(async () => { assert.ok(dir.startsWith(base + path.sep)); await rm(dir, { recursive: true, force: true }); });
  return dir;
};
async function session(t) {
  const directory = await temp(t), input = new PassThrough(), output = new PassThrough(), waiting = new Map();
  let buffer = '', next = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)?.(message); } });
  const running = startMCP({ directory, root: directory, input, output });
  const request = (method, params) => new Promise(resolve => { waiting.set(++next, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n'); });
  const call = async (name, args) => (await request('tools/call', { name, arguments: args })).result;
  t.after(async () => { input.end(); await running; });
  await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  return { directory, request, call };
}
const strip = { version: 1, name: 'strip', width: 4, height: 2, palette: { k: '#000' }, frames: [{ name: 'a', ops: [{ op: 'pixel', x: 3, y: 1, color: 'k' }] }, { name: 'b', duration: 90 }] };
const first = result => JSON.parse(result.content[0].text);
const last = result => JSON.parse(result.content.at(-1).text);

test('a recipe sent as JSON text is read as the recipe, and the reply says so', async t => {
  const mcp = await session(t);
  const plain = await mcp.call('pixel_validate', { project: strip }), text = await mcp.call('pixel_validate', { project: JSON.stringify(strip, null, 2) });
  assert.equal(text.isError, undefined);
  assert.deepEqual(first(text), first(plain));
  // Only a parsed argument adds the note, as the last item.
  assert.equal(text.content.length, plain.content.length + 1);
  assert.deepEqual(last(text), { note: 'project arrived as JSON text and was read as an object. Send JSON values as they are, not inside strings.' });

  const rendered = await mcp.call('pixel_render', { project: JSON.stringify(strip), expect: '{"width": 4, "height": 2}' });
  assert.equal(rendered.isError, undefined, rendered.content[0].text);
  const reply = first(rendered);
  assert.equal(reply.revision, first(plain).revision);
  assert.equal(reply.check.ok, true);
  assert.ok((await readdir(reply.directory)).includes('strip.png'));
  assert.equal(last(rendered).note, 'project arrived as JSON text and was read as an object; expect arrived as JSON text and was read as an object. Send JSON values as they are, not inside strings.');
});

test('lists and compile sources sent as JSON text are read too', async t => {
  const mcp = await session(t);
  const { revision } = first(await mcp.call('pixel_validate', { project: strip }));
  const patched = await mcp.call('pixel_patch', { revision, changes: JSON.stringify([{ set: 'frames[b].duration', value: 120 }]) });
  assert.equal(patched.isError, undefined, patched.content[0].text);
  assert.equal(first(patched).base, revision);
  assert.match(last(patched).note, /^changes arrived as JSON text and was read as a list\./);
  const fx = JSON.parse(await readFile(new URL('../examples/effects.fx.json', import.meta.url), 'utf8'));
  const plain = await mcp.call('pixel_compile', { source: fx }), text = await mcp.call('pixel_compile', { source: JSON.stringify(fx) });
  assert.equal(text.isError, undefined, text.content[0].text);
  assert.equal(first(text).revision, first(plain).revision);
  assert.match(last(text).note, /^source arrived as JSON text/);
});

test('text that is not the declared type is refused with what to send instead', async t => {
  const mcp = await session(t);
  const refused = async (args, name = 'pixel_validate') => { const result = await mcp.call(name, args); assert.equal(result.isError, true); assert.equal(result.content.length, 1); return first(result); };
  const broken = await refused({ project: '{"version": 1, "name": ' });
  assert.equal(broken.path, 'project');
  assert.match(broken.error, /^project: expected an object, got text that is not JSON \(.+\)\. Send project as an object itself, not inside a string$/);
  assert.deepEqual(await refused({ project: '[1, 2]' }), { error: 'project: expected an object, got text holding a list. Send project as an object itself, not inside a string', path: 'project' });
  assert.equal((await refused({ project: '"strip"' })).error, 'project: expected an object, got text holding a string. Send project as an object itself, not inside a string');
  assert.equal((await refused({ project: 'null' })).error, 'project: expected an object, got text holding null. Send project as an object itself, not inside a string');
  // A revision id in the wrong argument is named as such.
  assert.match((await refused({ project: 'a1b2c3d4e5f6' })).error, /; to reuse a saved recipe, send its id as revision$/);
  assert.equal((await refused({ revision: 'a1b2c3d4e5f6', changes: '{"set": "frames[b].duration", "value": 1}' }, 'pixel_patch')).error, 'changes: expected a list, got text holding an object. Send changes as a list itself, not inside a string');
});

test('strings where the schema allows them, and objects sent as objects, are left as they are', () => {
  const properties = { project: { type: 'object' }, revision: { type: 'string' }, fps: { type: ['number', 'string'] }, value: {}, frames: { type: 'array' } };
  const args = { project: strip, revision: 'a1b2c3d4e5f6', fps: '29.97', value: '{"a": 1}', frames: ['a'] };
  const result = parseTextArguments(args, properties);
  assert.equal(result.args, args);
  assert.deepEqual(result.parsed, []);
  assert.deepEqual(parseTextArguments({ frames: '["a", "b"]' }, properties).args, { frames: ['a', 'b'] });
});

test('JSON text nested too deep is refused like the same object', async t => {
  const mcp = await session(t);
  const nested = depth => '{"a":'.repeat(depth) + '1' + '}'.repeat(depth);
  // The project argument is one level, so text nested MAX_ARGUMENT_DEPTH levels makes the arguments one deeper.
  const reply = await mcp.request('tools/call', { name: 'pixel_validate', arguments: { project: nested(MAX_ARGUMENT_DEPTH) } });
  assert.equal(reply.error.code, -32602);
  assert.equal(reply.error.message, `Invalid tool arguments: nested more than ${MAX_ARGUMENT_DEPTH} levels deep`);
  const inside = await mcp.call('pixel_validate', { project: nested(MAX_ARGUMENT_DEPTH - 1) });
  assert.equal(inside.isError, true);
  assert.match(first(inside).error, /^project\./);
});
