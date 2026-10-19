// Compiles every fluid preset with Pixelbolt's browser-compatible src/fluid.js in headless Chromium, Firefox and
// WebKit (Playwright), and in Node, and compares the recipe hashes: first 12 hex of SHA-256 of JSON.stringify(recipe),
// the same id the MCP server gives a revision. Serves <clone>/src and <clone>/examples on a loopback port only.
// Needs Playwright with its browsers installed; PLAYWRIGHT_MODULE is the path to playwright/index.mjs, and
// CHROMIUM_EXE / FIREFOX_EXE optionally point at installed builds when Playwright's expected ones are missing.
// Usage: PLAYWRIGHT_MODULE=... node pixelfx_browsers.mjs <pixelbolt-clone> <result.json>
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [clone, resultPath] = process.argv.slice(2);
const root = resolve(clone);
const pw = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const engines = [
  ['chromium', pw.chromium, { ...(process.env.CHROMIUM_EXE && { executablePath: process.env.CHROMIUM_EXE }), args: ['--disable-gpu'] }],
  ['firefox', pw.firefox, { ...(process.env.FIREFOX_EXE && { executablePath: process.env.FIREFOX_EXE }) }],
  ['webkit', pw.webkit, {}],
];
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^[\\/]+/, '');
  if (url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>probe</title>'); return; }
  if (!(rel.startsWith('src') || rel.startsWith('examples'))) { res.writeHead(404); res.end(); return; }
  let body;
  try { body = readFileSync(join(root, rel)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': rel.endsWith('.js') ? 'text/javascript' : 'application/json' });
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const presets = readdirSync(join(root, 'examples')).filter((f) => f.endsWith('.fluid.json')).sort();

const { compileFluid } = await import(pathToFileURL(join(root, 'src', 'fluid.js')).href);
const node = {};
for (const f of presets) node[f] = createHash('sha256').update(JSON.stringify(compileFluid(JSON.parse(readFileSync(join(root, 'examples', f), 'utf8'))).recipe)).digest('hex').slice(0, 12);

const result = { clone: root, node: process.version, presets, hashes: { node }, versions: {} };
for (const [name, type, opts] of engines) {
  const browser = await type.launch({ headless: true, ...opts });
  result.versions[name] = browser.version();
  const page = await browser.newPage();
  await page.goto(base + '/');
  result.hashes[name] = await page.evaluate(async ({ presets }) => {
    const { compileFluid } = await import('/src/fluid.js');
    const out = {};
    for (const f of presets) {
      const source = await (await fetch('/examples/' + f)).json();
      const text = JSON.stringify(compileFluid(source).recipe);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      out[f] = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
    }
    return out;
  }, { presets });
  await browser.close();
  console.log(`${name} ${result.versions[name]}: ${presets.filter((f) => result.hashes[name][f] === node[f]).length}/${presets.length} match Node`);
}
server.close();
result.allMatch = engines.every(([name]) => presets.every((f) => result.hashes[name][f] === node[f]));
writeFileSync(resultPath, JSON.stringify(result, null, 1));
console.log(`all engines match Node: ${result.allMatch}`);
