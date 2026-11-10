import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { startMCP } from '../src/mcp.js';
import { TOPICS } from '../src/help.js';
import { createBodiesSequence } from '../src/index.js';

// What the MCP server tells an agent to run, and which help topics it names (PIXELBOLT-BUGS P-122, P-123). A command
// line in an error runs the release that refused the call, not whatever npm's latest is by then; the help tool's
// description names every topic it serves, so an agent choosing from it finds them all.
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const temp = async (t, label) => {
  const base = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(base, `pixelbolt-${label}-`));
  t.after(async () => { assert.ok(dir.startsWith(base + path.sep)); await rm(dir, { recursive: true, force: true }); });
  return dir;
};
function session(options) {
  const input = new PassThrough(), output = new PassThrough(), waiting = new Map(); let buffer = '', next = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)?.(message); } });
  const running = startMCP({ input, output, ...options });
  const request = (method, params) => new Promise(resolve => { waiting.set(++next, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n'); });
  const call = async (name, args) => { const result = (await request('tools/call', { name, arguments: args })).result; return { result, info: JSON.parse(result.content[0].text) }; };
  return { input, running, request, call, init: () => request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } }) };
}
// A ball that falls for `frames` frames of `duration` ms: as many different video frames as the clip shows.
const match = (frames, duration) => ({ format: 'pixelforge-bodies', version: 1, name: 'probe', width: 16, height: 16, palette: { k: '#000000', w: '#ffffff' },
  effects: { main: { frames, duration, background: 'k', bodies: [{ name: 'ball', shape: 'circle', radius: 2, at: [8, 4], fill: 'w' }] } } });
const strip = { version: 1, name: 'strip', width: 4, height: 2, palette: { k: '#000' }, frames: [{ name: 'a', ops: [{ op: 'pixel', x: 3, y: 1, color: 'k' }] }] };

test('pixel_help\'s description names every topic it serves', async t => {
  const dir = await temp(t, 'topics'), mcp = session({ directory: dir });
  t.after(async () => { mcp.input.end(); await mcp.running; });
  await mcp.init();
  const help = (await mcp.request('tools/list', {})).result.tools.find(tool => tool.name === 'pixel_help');
  assert.deepEqual(help.inputSchema.properties.topic.enum, TOPICS);
  assert.deepEqual(TOPICS.filter(topic => !new RegExp(`\\b${topic}\\b`).test(help.description)), []);
  assert.match(help.description, /\bcrystal, powder, bodies\b/);
});

test('a match too long for one call names the command line it was given, and MCP gives its own version', async t => {
  const told = command => error => error.path === 'sequence' && error.message.includes(`${command} sequence <source.json> --out <new folder> --fps 30`);
  // Past what one call keeps in memory (about 297 different frames at 4096x4096, where 256 fit), refused before
  // simulating; and past a caller's time budget.
  assert.throws(() => createBodiesSequence(match(300, 33), { fps: 30, size: '4096x4096' }, { command: 'npx -y pixelbolt@1.2.3' }), told('npx -y pixelbolt@1.2.3'));
  assert.throws(() => createBodiesSequence(match(120, 33), { fps: 30 }, { budget: 1, command: 'npx -y pixelbolt@1.2.3' }), told('npx -y pixelbolt@1.2.3'));
  // A library caller that names no command gets the plain one, as before.
  assert.throws(() => createBodiesSequence(match(120, 33), { fps: 30 }, { budget: 1 }), told('npx -y pixelbolt'));
  // Over MCP, 120 different frames at 4096x4096 pass the server's budget: the refusal names this release.
  const dir = await temp(t, 'pinned'), mcp = session({ directory: dir });
  t.after(async () => { mcp.input.end(); await mcp.running; });
  await mcp.init();
  const refused = await mcp.call('pixel_compile', { source: match(120, 33), sequence: { fps: 30, size: '4096x4096' } });
  assert.equal(refused.result.isError, true);
  assert.ok(refused.result.content[0].text.includes(`npx -y pixelbolt@${version} sequence <source.json> --out <new folder> --fps 30 --size 4096x4096`), refused.result.content[0].text);
});

test('a match stopped at the time limit names the command line of this release', async t => {
  // The limit is a timer in this process, moved by a mocked clock, as in mcp-features.test.js: a first call loads the
  // worker, then the match (594 different 1920x1080 frames, many seconds of work) is stopped at the first tick.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dir = await temp(t, 'stopped'), mcp = session({ directory: dir, timeLimit: 300 });
  t.after(async () => { mcp.input.end(); await mcp.running; t.mock.timers.reset(); });
  await mcp.init();
  assert.equal((await mcp.call('pixel_validate', { project: strip })).info.ok, true);
  let stopped;
  const answered = mcp.call('pixel_compile', { source: match(600, 33), sequence: { fps: 30, size: '1920x1080' } }).then(reply => { stopped = reply; });
  while (!stopped) { t.mock.timers.tick(300); await new Promise(resolve => setImmediate(resolve)); }
  await answered;
  assert.equal(stopped.result.isError, true);
  assert.match(stopped.info.error, /^pixel_compile took longer than 0\.3 s and was stopped\. A long match runs on the command line/);
  assert.ok(stopped.info.error.includes(`npx -y pixelbolt@${version} sequence <source.json> --out <new folder> --fps 30;`), stopped.info.error);
});
