// Drives Pixelbolt's MCP server over stdio the way an agent would for a pixel-art effect, for the "Pixel FX Designer
// alternative" page:
//   initialize -> tools/list -> pixel_help {topic: "fluid"} -> pixel_compile every fluid preset twice (with metadata)
//   -> pixel_render the campfire revision with a GIF -> pixel_compile the campfire again with wind [0.3, 0].
// It times each call in-process (no Node start-up), checks that a resent source returns the same revision, and checks
// that each MCP revision id equals the content hash of the recipe the CLI compiled from the same preset
// (revision id = first 12 hex of SHA-256 of JSON.stringify(recipe), src/revisions.js).
// Usage: node pixelfx_mcp_probe.mjs <pixelbolt-bin.js> <examples-dir> <fresh-out-dir> <cli-measure.json> <result.json>
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const [bin, examples, outDir, cliMeasurePath, resultPath] = process.argv.slice(2);
if (existsSync(outDir)) throw new Error(`out dir must be fresh: ${outDir}`);
mkdirSync(outDir, { recursive: true });
const cliMeasure = JSON.parse(readFileSync(cliMeasurePath, 'utf8'));
const child = spawn(process.execPath, [bin, 'mcp', '--out', outDir, '--root', examples], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const waiting = new Map();
child.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.id != null && waiting.has(msg.id)) { waiting.get(msg.id)({ msg, bytes: Buffer.byteLength(line) }); waiting.delete(msg.id); }
  }
});
let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });
let nextId = 1;
function call(method, params) {
  const id = nextId++;
  const t0 = process.hrtime.bigint();
  return new Promise((resolve) => {
    waiting.set(id, (r) => resolve({ ...r, ms: Number(process.hrtime.bigint() - t0) / 1e6 }));
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
function parse(msg) {
  const content = msg.result?.content ?? [];
  const texts = content.filter((c) => c.type === 'text').map((c) => c.text);
  const images = content.filter((c) => c.type === 'image').map((c) => ({ mimeType: c.mimeType, base64Length: c.data.length }));
  let json = null;
  try { json = JSON.parse(texts[0]); } catch { json = texts[0] ?? null; }
  return { json, images, isError: !!msg.result?.isError, error: msg.error ?? null };
}
const revisionOf = (recipe) => createHash('sha256').update(JSON.stringify(recipe)).digest('hex').slice(0, 12);
const round = (x) => Math.round(x * 10) / 10;

const result = { bin, examples, node: process.version, calls: [], presets: [] };
const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'comparison-probe', version: '1' } });
result.server = init.msg.result?.serverInfo;
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
const list = await call('tools/list', {});
result.tools = { count: list.msg.result.tools.length, names: list.msg.result.tools.map((t) => t.name), replyBytes: list.bytes };
const help = await call('tools/call', { name: 'pixel_help', arguments: { topic: 'fluid' } });
result.helpFluid = { ms: round(help.ms), replyBytes: help.bytes, isError: !!help.msg.result?.isError };

const presets = readdirSync(examples).filter((f) => f.endsWith('.fluid.json')).sort();
const revisions = {};
for (const f of presets) {
  const name = f.replace(/\.fluid\.json$/, '');
  const source = JSON.parse(readFileSync(join(examples, f), 'utf8'));
  const a = await call('tools/call', { name: 'pixel_compile', arguments: { source, metadata: true } });
  const b = await call('tools/call', { name: 'pixel_compile', arguments: { source, metadata: true } });
  const pa = parse(a.msg), pb = parse(b.msg);
  const cli = cliMeasure.presets.find((p) => p.name === name);
  const cliRevision = cli ? revisionOf(JSON.parse(readFileSync(cli.recipePath, 'utf8'))) : null;
  revisions[name] = pa.json?.revision;
  result.presets.push({
    preset: name, sourceBytes: statSync(join(examples, f)).size, msA: round(a.ms), msB: round(b.ms),
    ok: pa.json?.ok === true && !pa.isError, revisionA: pa.json?.revision, revisionB: pb.json?.revision,
    sameRevision: pa.json?.revision === pb.json?.revision, cliRevision, matchesCli: cliRevision === pa.json?.revision,
    frames: pa.json?.frames, size: `${pa.json?.width}x${pa.json?.height}`, image: pa.images[0] ?? null, replyBytes: a.bytes,
    error: pa.isError ? pa.json : pa.error,
  });
  const p = result.presets.at(-1);
  console.log(`${name}: ${p.msA}/${p.msB} ms, revision ${p.revisionA} same=${p.sameRevision} matchesCli=${p.matchesCli}, image ${p.image?.mimeType} ${p.image?.base64Length}`);
}

// Render the campfire with a GIF, as an agent would after compiling.
const render = await call('tools/call', { name: 'pixel_render', arguments: { revision: revisions.campfire, gif: {} } });
const pr = parse(render.msg);
result.renderCampfire = { ms: round(render.ms), ok: pr.json?.ok === true && !pr.isError, summary: pr.json, images: pr.images, replyBytes: render.bytes };
console.log(`render campfire: ${result.renderCampfire.ms} ms ok=${result.renderCampfire.ok}`);

// One physics change: wind blowing to the right.
const camp = JSON.parse(readFileSync(join(examples, 'campfire.fluid.json'), 'utf8'));
const windy = structuredClone(camp);
const effectName = Object.keys(windy.effects)[0];
windy.effects[effectName].wind = [0.3, 0];
const w = await call('tools/call', { name: 'pixel_compile', arguments: { source: windy } });
const pw = parse(w.msg);
result.windyCampfire = { ms: round(w.ms), ok: pw.json?.ok === true && !pw.isError, revision: pw.json?.revision, differsFromCampfire: pw.json?.revision !== revisions.campfire, error: pw.isError ? pw.json : pw.error };
console.log(`windy campfire: ${result.windyCampfire.ms} ms revision ${result.windyCampfire.revision} differs=${result.windyCampfire.differsFromCampfire}`);

child.stdin.end();
await new Promise((r) => child.on('exit', r));
result.stderr = stderr.slice(0, 2000);
result.outFiles = (function count(d) { let n = 0; for (const f of readdirSync(d)) { const p = join(d, f); n += statSync(p).isDirectory() ? count(p) : 1; } return n; })(outDir);
writeFileSync(resultPath, JSON.stringify(result, null, 1));
console.log(`tools ${result.tools.count}, tools/list ${result.tools.replyBytes} B, help fluid ${result.helpFluid.replyBytes} B; all ok ${result.presets.every((p) => p.ok)}, all same ${result.presets.every((p) => p.sameRevision)}, all match CLI ${result.presets.every((p) => p.matchesCli)}`);
