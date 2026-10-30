import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import { startMCP } from '../src/mcp.js';

const temp = async (t, label) => {
  const base = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(base, `pixelbolt-${label}-`));
  t.after(async () => { assert.ok(dir.startsWith(base + path.sep)); await rm(dir, { recursive: true, force: true }); });
  return dir;
};
// A client that keeps every message the server sends, so a test can show that a request was never answered.
function session(options) {
  const input = new PassThrough(), output = new PassThrough(), received = [], waiting = new Map(); let buffer = '', next = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); received.push(message); waiting.get(message.id)?.(message); } });
  const running = startMCP({ input, output, ...options });
  const send = message => input.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  const request = (method, params) => { const id = ++next, answered = new Promise(resolve => waiting.set(id, resolve)); send({ id, method, params }); return { id, answered }; };
  const call = (name, args) => request('tools/call', { name, arguments: args });
  const cancel = requestId => send({ method: 'notifications/cancelled', params: { requestId, reason: 'no longer needed' } });
  const init = () => request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  return { received, request, call, cancel, init, end: async () => { input.end(); await running; } };
}
const strip = { version: 1, name: 'strip', width: 4, height: 2, palette: { k: '#000' }, frames: [{ name: 'a', ops: [{ op: 'pixel', x: 3, y: 1, color: 'k' }] }, { name: 'b', duration: 90 }] };
// A thick liquid this size takes most of a minute to simulate, well inside the compiler's own work budget.
const slowSource = () => ({ format: 'pixelforge-fluid', version: 1, name: 'slow', width: 64, height: 52, palette: { a: '#123', b: '#456' }, effects: { goo: {
  kind: 'liquid', frames: 256, loop: true, warmup: 8, substeps: 4, iterations: 1, viscosity: 64, yield: 16, apic: true, walls: ['left', 'right', 'bottom', 'top'],
  fill: [{ x: 0, y: 0, w: 64, h: 52 }], emitters: [], look: [{ field: 'density', colors: ['a', 'b'], thresholds: [0.3, 0.6] }] } } });
const info = reply => JSON.parse(reply.result.content[0].text);

test('MCP answers ping while a call runs, and stops a cancelled call without answering it', async t => {
  const dir = await temp(t, 'cancel'), mcp = session({ directory: dir }); await mcp.init().answered;
  try {
    const slow = mcp.call('pixel_compile', { source: slowSource() }), queued = mcp.call('pixel_validate', { project: strip });
    await delay(500);
    // ping used to wait behind the call, up to its 50 s limit; now it is answered while both requests wait.
    assert.deepEqual((await mcp.request('ping').answered).result, {});
    assert.deepEqual(mcp.received.filter(message => message.id === slow.id || message.id === queued.id), []);
    // Cancelling the waiting request skips it; cancelling the running one stops its worker. Neither is answered.
    mcp.cancel(queued.id); mcp.cancel(slow.id);
    const cancelled = performance.now(), next = await mcp.call('pixel_validate', { project: strip }).answered;
    assert.equal(info(next).ok, true);
    // A hang guard, not a speed check (AGENTS.md): the wait is idle, so no work count can show the worker stopped. A
    // working cancel answers the next call in about 1 s on the slowest CI job; a broken one waits for the 50 s limit.
    assert.ok(performance.now() - cancelled < 20000, 'the next call ran without waiting for the cancelled one');
    assert.deepEqual(mcp.received.filter(message => message.id === slow.id || message.id === queued.id), []);
  } finally { await mcp.end(); }
});

test('MCP ignores cancelling initialize, an unknown request or one already answered', async t => {
  const dir = await temp(t, 'cancel-ignored'), mcp = session({ directory: dir });
  try {
    const init = mcp.init(); mcp.cancel(init.id);
    assert.equal((await init.answered).result.serverInfo.name, 'pixelbolt');
    mcp.cancel(999); mcp.cancel('unknown');
    const done = mcp.call('pixel_validate', { project: strip });
    assert.equal(info(await done.answered).ok, true);
    mcp.cancel(done.id);
    assert.deepEqual((await mcp.request('ping').answered).result, {});
    assert.equal(info(await mcp.call('pixel_validate', { project: strip }).answered).ok, true);
    assert.equal(mcp.received.filter(message => message.id === done.id).length, 1);
  } finally { await mcp.end(); }
});

test('MCP answers every request queued behind a long call, in order, past the point where it stops reading', async t => {
  const dir = await temp(t, 'queue'), mcp = session({ directory: dir, timeLimit: 1000 }); await mcp.init().answered;
  try {
    const slow = mcp.call('pixel_compile', { source: slowSource() });
    // More requests than the server holds before it pauses reading; the rest wait in the pipe.
    const many = Array.from({ length: 300 }, () => mcp.call('no_such_tool', {}));
    const replies = await Promise.all(many.map(request => request.answered));
    assert.ok(replies.every(reply => reply.error?.code === -32602 && reply.error.message === 'Unknown tool'));
    const ids = new Set(many.map(request => request.id));
    assert.deepEqual(mcp.received.filter(message => ids.has(message.id)).map(message => message.id), many.map(request => request.id));
    assert.match(info(await slow.answered).error, /^pixel_compile took longer than 1 s and was stopped/);
  } finally { await mcp.end(); }
});
