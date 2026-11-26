// Architectural invariants enforced statically across the toolkit's modules:
//   1. No circular static imports/re-exports across src/ (keeps module initialization order deterministic and TDZ-free).
//   2. No node:* imports in any browser-compatible module reachable from studio/ or exported scene player/ folders.
//   3. Exported scene player/ bundles contain the exact transitive JS modules of src/scene.js and studio/scene-player.js.
//   4. Every relative static named import/re-export across src/, bin/, studio/ and scripts/ resolves to an existing file
//      that actually exports that symbol (catches missing exports and typos in milliseconds before tests run).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSceneBundle } from '../src/scene-export.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const unix = file => file.split(path.sep).join('/');

// Strip single-line and block comments so commented-out examples never look like imports or exports.
const stripComments = text => text.replace(/\/\*[\s\S]*?\*\/|^[ \t]*\/\/[^\n]*/gm, '');

// Static relative imports and re-exports in one module: { kind, names, specifier }.
function parseModuleLinks(text) {
  const clean = stripComments(text), links = [];
  // Named imports / re-exports: `import { a, b as c } from '...'` or `export { a, b as c } from '...'`
  for (const m of clean.matchAll(/^[ \t]*(import|export)\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\3/gm)) {
    const names = m[2].split(',').map(s => s.trim()).filter(Boolean).map(part => {
      const [orig, alias] = part.split(/\s+as\s+/).map(s => s.trim());
      return { imported: orig, exported: alias ?? orig };
    });
    links.push({ kind: m[1], names, star: false, specifier: m[4] });
  }
  // Wildcard re-export: `export * from '...'`
  for (const m of clean.matchAll(/^[ \t]*export\s*\*\s*from\s*(['"])([^'"]+)\1/gm)) {
    links.push({ kind: 'export', names: [], star: true, specifier: m[2] });
  }
  // Namespace or default import: `import * as x from '...'` or `import x from '...'` or `import '...'`
  for (const m of clean.matchAll(/^[ \t]*import\s+(?:[^;'"`]*?\bfrom\s*)?(['"])([^'"]+)\1/gm)) {
    const specifier = m[2];
    if (!links.some(l => l.kind === 'import' && l.specifier === specifier && l.names.length > 0)) {
      links.push({ kind: 'import', names: [], star: false, specifier });
    }
  }
  return links;
}

function resolveRelative(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const target = path.resolve(path.dirname(path.join(root, fromFile)), specifier);
  return unix(path.relative(root, target));
}

// All named symbols directly or transitively exported by a module (relative to repo root).
function exportedNames(relFile, cache = new Map(), visiting = new Set()) {
  if (cache.has(relFile)) return cache.get(relFile);
  if (visiting.has(relFile)) return new Set();
  visiting.add(relFile);
  const full = path.join(root, relFile), names = new Set();
  if (!existsSync(full)) return names;
  const text = stripComments(readFileSync(full, 'utf8'));
  // `export function foo`, `export async function foo`, `export class Foo`
  for (const m of text.matchAll(/^export\s+(?:async\s+)?(?:function\*?|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  // `export const a = 1, b = 2;` or `export let a = ...` (handles multi-declarator lines at top level)
  for (const m of text.matchAll(/^export\s+(?:const|let)\s+([^\n]+)/gm)) {
    const line = m[1];
    // Scan top-level comma-separated declarators outside (), [], {}, '', "", ``
    let depth = 0, quote = null, start = 0;
    const parts = [];
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = null; continue; }
      if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth--;
      else if (ch === ',' && depth === 0) { parts.push(line.slice(start, i)); start = i + 1; }
      else if (ch === ';' && depth === 0) { parts.push(line.slice(start, i)); start = line.length; break; }
    }
    if (start < line.length) parts.push(line.slice(start));
    for (const part of parts) {
      const id = part.trim().match(/^([A-Za-z_$][\w$]*)\s*=/);
      if (id) names.add(id[1]);
    }
  }
  // Local export list: `export { a, b as c };` (without `from`)
  for (const m of text.matchAll(/^export\s*\{([^}]*)\}\s*(?:;|$)/gm)) {
    for (const part of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
      const [, alias] = part.split(/\s+as\s+/).map(s => s.trim());
      names.add(alias ?? part);
    }
  }
  // Re-exports: `export { a, b as c } from '...'` and `export * from '...'`
  for (const link of parseModuleLinks(text)) {
    if (link.kind !== 'export') continue;
    for (const entry of link.names) names.add(entry.exported);
    if (link.star) {
      const target = resolveRelative(relFile, link.specifier);
      if (target) for (const sym of exportedNames(target, cache, visiting)) names.add(sym);
    }
  }
  visiting.delete(relFile);
  cache.set(relFile, names);
  return names;
}

function walkGraph(seeds, resolveEdge) {
  const reached = new Set(), queue = [...seeds];
  while (queue.length) {
    const file = queue.shift();
    if (reached.has(file)) continue;
    reached.add(file);
    const full = path.join(root, file);
    if (!existsSync(full)) continue;
    for (const link of parseModuleLinks(readFileSync(full, 'utf8'))) {
      const next = resolveEdge(file, link.specifier);
      if (next && !reached.has(next)) queue.push(next);
    }
  }
  return reached;
}

test('src/ has no circular static imports or re-exports', () => {
  const files = readdirSync(path.join(root, 'src')).filter(f => f.endsWith('.js')).sort().map(f => `src/${f}`);
  const edges = new Map();
  for (const file of files) {
    const deps = new Set();
    for (const link of parseModuleLinks(readFileSync(path.join(root, file), 'utf8'))) {
      const target = resolveRelative(file, link.specifier);
      if (target && target.startsWith('src/')) deps.add(target);
    }
    edges.set(file, [...deps].sort());
  }
  const seen = new Set(), active = new Set(), cycles = [];
  function dfs(node, trail) {
    seen.add(node); active.add(node);
    for (const next of edges.get(node) ?? []) {
      if (active.has(next)) cycles.push([...trail, next].join(' -> '));
      else if (!seen.has(next)) dfs(next, [...trail, next]);
    }
    active.delete(node);
  }
  for (const file of files) if (!seen.has(file)) dfs(file, [file]);
  assert.deepEqual(cycles, []);
});

test('browser-compatible modules reachable from studio/ or scene player/ import no Node APIs', () => {
  const studioPages = readdirSync(path.join(root, 'studio')).filter(f => f.endsWith('.html'));
  const seeds = ['src/scene.js', 'src/share.js', 'src/runtime.js', 'src/crystal.js', 'src/patch.js', 'src/resize.js', 'src/godot.js', 'src/tiled.js'];
  for (const page of studioPages) {
    const html = readFileSync(path.join(root, 'studio', page), 'utf8');
    for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+\.js)"/g)) {
      const name = path.posix.basename(m[1]);
      seeds.push(existsSync(path.join(root, 'src', name)) ? `src/${name}` : `studio/${name}`);
    }
  }
  // Studio serves src/ and studio/ side by side at '/', so './foo.js' resolves into src/ or studio/.
  const studioResolve = (fromFile, specifier) => {
    if (!specifier.startsWith('.')) return null;
    const direct = resolveRelative(fromFile, specifier);
    if (direct && existsSync(path.join(root, direct))) return direct;
    const base = path.posix.basename(specifier);
    if (existsSync(path.join(root, 'src', base))) return `src/${base}`;
    if (existsSync(path.join(root, 'studio', base))) return `studio/${base}`;
    return null;
  };
  const reached = walkGraph(seeds, studioResolve);
  const violations = [];
  for (const file of [...reached].sort()) {
    const links = parseModuleLinks(readFileSync(path.join(root, file), 'utf8'));
    for (const link of links) if (link.specifier.startsWith('node:')) violations.push(`${file} imports ${link.specifier}`);
  }
  assert.deepEqual(violations, []);
});

test('exported scene player/ folder matches the exact transitive modules of scene.js and scene-player.js', async () => {
  const resolvePlayer = (fromFile, specifier) => {
    if (!specifier.startsWith('.')) return null;
    const base = path.posix.basename(specifier);
    if (existsSync(path.join(root, 'src', base))) return `src/${base}`;
    if (existsSync(path.join(root, 'studio', base))) return `studio/${base}`;
    return null;
  };
  const needed = walkGraph(['src/scene.js', 'studio/scene-player.js'], resolvePlayer);
  const expectedNames = [...needed].map(f => path.posix.basename(f)).sort();
  const scene = JSON.parse(readFileSync(path.join(root, 'examples', 'quality', 'stride.scene.json'), 'utf8'));
  const { files } = await createSceneBundle(scene);
  const packedNames = [...files.keys()].filter(name => name.startsWith('player/') && name.endsWith('.js')).map(name => name.slice('player/'.length)).sort();
  assert.deepEqual(packedNames, expectedNames);
});

test('every static relative import and re-export across src/, bin/, studio/ and scripts/ resolves to an exported symbol', () => {
  const cache = new Map(), problems = [];
  const folders = ['src', 'bin', 'studio', 'scripts'];
  for (const folder of folders) {
    for (const entry of readdirSync(path.join(root, folder)).filter(name => /\.m?js$/.test(name)).sort()) {
      const file = `${folder}/${entry}`;
      const text = readFileSync(path.join(root, file), 'utf8');
      for (const link of parseModuleLinks(text)) {
        if (!link.specifier.startsWith('.')) continue;
        // Studio pages serve src/ and studio/ side by side at '/', so studio/*.js imports './core.js' for src/core.js.
        let target = resolveRelative(file, link.specifier);
        if (folder === 'studio' && target && !existsSync(path.join(root, target))) {
          const sibling = `src/${path.posix.basename(link.specifier)}`;
          if (existsSync(path.join(root, sibling))) target = sibling;
        }
        if (!target || !existsSync(path.join(root, target))) {
          problems.push(`${file}: missing module ${link.specifier}`);
          continue;
        }
        const exports = exportedNames(target, cache);
        for (const { imported } of link.names) {
          if (!exports.has(imported)) problems.push(`${file}: ${target} does not export ${imported}`);
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});
