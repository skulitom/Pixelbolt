// The plugin evals' mock server (evals/mocks/pixelbolt/) answers as the real server does. Its tool listing
// (_tools.json) is the real server's, as a client without MCP Apps receives it, and the facts block of its
// instructions (_server.md, between the FACTS markers) is written from the real server's own replies: the drawing
// operations, the help topics, the shipped presets and the errors for a wrong one of each. `node scripts/eval-mock.mjs`
// rewrites both after a tool's description or options, an operation, a help topic or a preset changes; a test
// compares them, so the mock cannot fall behind. The rest of _server.md is written by hand.
import { readFile, writeFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { startMCP } from '../src/mcp.js';
import { presetEntries } from '../src/presets.js';

export const MOCK_TOOLS = fileURLToPath(new URL('../evals/mocks/pixelbolt/_tools.json', import.meta.url));
export const MOCK_SERVER = fileURLToPath(new URL('../evals/mocks/pixelbolt/_server.md', import.meta.url));
const FACTS = ['<!-- FACTS: written by node scripts/eval-mock.mjs from the real server; edit the script, not this block -->', '<!-- /FACTS -->'];

// Runs `ask` against a fresh in-process server, then closes it.
async function withServer(ask) {
  const input = new PassThrough(), output = new PassThrough(), replies = new Map();
  let buffer = '', id = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); replies.get(message.id)?.(message.result); } });
  const running = startMCP({ input, output });
  const request = (method, params) => new Promise(resolve => { replies.set(++id, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  try {
    await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'eval-mock', version: '1' } });
    return await ask(request);
  } finally { input.end(); await running; }
}

// _tools.json's text: the tools/list result on one line.
export async function mockTools() {
  return JSON.stringify(await withServer(request => request('tools/list', {}))) + '\n';
}

// _server.md's text with its facts block rewritten from the real server.
export async function mockServer(text) {
  const [from, to] = FACTS.map(marker => text.indexOf(marker));
  if (from < 0 || to < from) throw new Error(`${MOCK_SERVER} has lost its facts markers: put back ${FACTS.join(' and ')}`);
  // The presets by kind come from the folder, as the listing names them: the listing itself measures each preset
  // against a time budget, so its lines can differ on a slow machine.
  const presets = await presetEntries(), kinds = new Map();
  for (const { name, kind } of presets) kinds.set(kind, [...(kinds.get(kind) ?? []), name]);
  const facts = await withServer(async request => {
    // Each probe is a wrong call, so its reply must be a tool error.
    const reply = async (name, args) => {
      const result = await request('tools/call', { name, arguments: args });
      if (!result.isError) throw new Error(`${name} ${JSON.stringify(args)} is no longer refused: update the facts in scripts/eval-mock.mjs`);
      return result.content[0].text;
    };
    // A list the error ends with, after `lead`.
    const listed = (text, lead) => {
      const at = text.indexOf(lead);
      if (at < 0) throw new Error(`the error ${text} no longer ends with "${lead}<list>": update the facts in scripts/eval-mock.mjs`);
      return text.slice(at + lead.length).split(', ');
    };
    const op = async value => JSON.parse(await reply('pixel_validate', { project: { version: 1, name: 'probe', width: 4, height: 4, palette: { k: '#000' }, frames: [{ name: 'a', ops: [{ op: value, x: 1, y: 1 }] }] } }));
    const ops = listed((await op(5)).error, 'operations: ');
    const topics = listed(JSON.parse(await reply('pixel_help', { topic: 'unknown' })).error, 'expected one of ');
    const code = value => `\`${value}\``;
    return [
      `- The ops are exactly these ${ops.length}: ${ops.map(code).join(', ')}. Any other \`op\` is an error that suggests the nearest one, for example ${code(JSON.stringify(await op('circle')))}.`,
      `- The \`pixel_help\` topics are ${topics.map(code).join(', ')}; any other topic is the tool error ${code(await reply('pixel_help', { topic: 'unknown' }))}.`,
      `- The ${presets.length} shipped presets, by kind: ${[...kinds].map(([kind, names]) => `${kind} (${names.length}): ${names.join(', ')}`).join('; ')}. A preset name that isn't one of these is an error that suggests close names, such as ${code(await reply('pixel_help', { topic: 'preset', name: 'campfir' }))}.`
    ].join('\n');
  });
  return `${text.slice(0, from + FACTS[0].length)}\n${facts}\n${text.slice(to)}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeFile(MOCK_TOOLS, await mockTools());
  await writeFile(MOCK_SERVER, await mockServer(await readFile(MOCK_SERVER, 'utf8')));
  console.log(`wrote ${MOCK_TOOLS} and ${MOCK_SERVER}`);
}
