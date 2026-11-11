// Lists an MCP server's tools through the MCP TypeScript SDK v1 client (1.32.2) and the v2 client (2.4.0) in its
// 'legacy' (default), 'auto' and {pin: '2026-07-28'} modes, and records the protocol version and era each negotiates.
// Set C below to a folder holding clients/ (npm install @modelcontextprotocol/client@2.4.0 @modelcontextprotocol/sdk@1.32.2),
// servers/ (npm install pixelbolt@0.15.0) and work/pixelbolt-out/; add other servers to SERVERS to compare them.
// Usage: node mcp-clients-list-tools.mjs <out.json> [server-name-regex]
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const C = '<kit folder>';
const imp = (p) => import(pathToFileURL(`${C}/clients/node_modules/${p}`).href);
const v2 = await imp('@modelcontextprotocol/client/dist/index.mjs');
const v2stdio = await imp('@modelcontextprotocol/client/dist/stdio.mjs');
const v1 = await imp('@modelcontextprotocol/sdk/dist/esm/client/index.js');
const v1stdio = await imp('@modelcontextprotocol/sdk/dist/esm/client/stdio.js');

const SERVERS = {
  'pixelbolt-0.15.0 (node, npm package)': { command: 'node', args: [`${C}/servers/node_modules/pixelbolt/bin/pixelbolt.js`, 'mcp', '--out', `${C}/work/pixelbolt-out`] },
  'pixelbolt-0.15.0 (cmd /c npx -y pixelbolt@0.15.0)': { command: 'cmd', args: ['/c', 'npx', '-y', 'pixelbolt@0.15.0', 'mcp', '--out', `${C}/work/pixelbolt-out`] },
};
const MODES = ['v1-sdk-1.32.2', 'v2-2.4.0-legacy(default)', 'v2-2.4.0-auto', 'v2-2.4.0-pin-2026-07-28'];
const only = process.argv[3] ? new RegExp(process.argv[3]) : null;

async function run(name, s, mode) {
  const t0 = Date.now();
  const params = { command: s.command, args: s.args, env: { ...process.env, ...(s.env || {}) }, cwd: s.cwd, stderr: 'ignore' };
  let client, transport;
  const info = { name: 'mcp-client-check', version: '1.0.0' };
  if (mode.startsWith('v1')) { client = new v1.Client(info, { capabilities: {} }); transport = new v1stdio.StdioClientTransport(params); }
  else {
    const m = mode.endsWith('legacy(default)') ? undefined : mode.endsWith('auto') ? 'auto' : { pin: '2026-07-28' };
    client = new v2.Client(info, m ? { versionNegotiation: { mode: m, probe: { timeoutMs: 15000 } } } : {});
    transport = new v2stdio.StdioClientTransport(params);
  }
  const r = { server: name, client: mode };
  try {
    await client.connect(transport, { timeout: 60000 });
    r.protocolVersion = client.getNegotiatedProtocolVersion?.() ?? '(v1 client: no getter)';
    r.era = client.getProtocolEra?.();
    r.serverInfo = client.getServerVersion?.();
    let tools = [], cursor;
    do { const res = await client.listTools(cursor ? { cursor } : undefined); tools = tools.concat(res.tools); cursor = res.nextCursor; } while (cursor);
    r.toolCount = tools.length; r.tools = tools.map(t => t.name).sort();
  } catch (e) { r.error = `${e?.name}: ${e?.message}`.slice(0, 500); r.toolCount = 0; }
  try { await client.close(); } catch {}
  r.ms = Date.now() - t0;
  return r;
}
const out = [];
for (const [name, s] of Object.entries(SERVERS)) {
  if (only && !only.test(name)) continue;
  for (const mode of MODES) {
    const r = await run(name, s, mode);
    console.log(`${name} | ${mode} | tools=${r.toolCount} | proto=${r.protocolVersion ?? '-'} | era=${r.era ?? '-'} | ${r.ms} ms${r.error ? ' | ERROR ' + r.error : ''}`);
    out.push(r);
  }
}
writeFileSync(process.argv[2], JSON.stringify({ when: new Date().toISOString(), node: process.version, results: out }, null, 2));
