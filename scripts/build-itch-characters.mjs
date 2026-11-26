// Builds a self-contained offline HTML5 ZIP of the Character & Walk-Cycle Studio ready for itch.io upload.
// Usage: node scripts/build-itch-characters.mjs [output.zip]
// Zero external network requests: bundles the page, engine modules and character pose rigs into one archive.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip } from '../src/export.js';
import { CHARACTERS } from '../playground/characters/lib.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const ENGINE_ENTRIES = ['core.js', 'authoring.js', 'gif.js', 'godot.js'];

// Recursively collects every browser-compatible ES module imported from `src/` starting at ENGINE_ENTRIES.
async function collectEngineModules() {
  const files = new Map(), queue = [...ENGINE_ENTRIES], seen = new Set(queue);
  while (queue.length) {
    const name = queue.shift();
    const text = await readFile(path.join(root, 'src', name), 'utf8');
    files.set(`engine/${name}`, Buffer.from(text, 'utf8'));
    for (const match of text.matchAll(/^[ \t]*(?:import|export)[^;'"`]*?\bfrom\s*['"]\.\/([^'"]+)['"]/gm)) {
      const next = match[1];
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return files;
}

export async function buildItchCharacterArchive() {
  const files = new Map();

  // Rewrite parent-folder links (`../playground.css`, `../share.js`, etc.) to the archive root and enable bundled mode.
  const html = (await readFile(path.join(root, 'playground/characters/index.html'), 'utf8'))
    .replace('<html lang="en">', '<html lang="en" data-bundled="true">')
    .replace(
      "script-src 'self' https://cdn.jsdelivr.net; connect-src 'self' https://cdn.jsdelivr.net;",
      "script-src 'self'; connect-src 'self';"
    )
    .replace('href="../playground.css"', 'href="./playground.css"');

  const app = (await readFile(path.join(root, 'playground/characters/app.js'), 'utf8'))
    .replace("from '../share.js'", "from './share.js'")
    .replace("from '../png.js'", "from './png.js'")
    .replace("from '../lib.js'", "from './playground-lib.js'");

  files.set('index.html', Buffer.from(html, 'utf8'));
  files.set('app.js', Buffer.from(app, 'utf8'));
  files.set('lib.js', await readFile(path.join(root, 'playground/characters/lib.js')));
  files.set('characters.css', await readFile(path.join(root, 'playground/characters/characters.css')));
  files.set('playground.css', await readFile(path.join(root, 'playground/playground.css')));
  files.set('png.js', await readFile(path.join(root, 'playground/png.js')));
  files.set('share.js', await readFile(path.join(root, 'playground/share.js')));
  files.set('playground-lib.js', await readFile(path.join(root, 'playground/lib.js')));

  for (const [entry, bytes] of await collectEngineModules()) files.set(entry, bytes);
  for (const character of CHARACTERS) {
    files.set(`presets/${character.file}`, await readFile(path.join(root, 'examples', character.file)));
  }

  return { files, zip: createZip(files) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.resolve(process.argv[2] ?? path.join(root, 'dist', 'pixelbolt-characters-itch.zip'));
  const { files, zip } = await buildItchCharacterArchive();
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, zip);
  console.log(`Wrote ${path.relative(root, out)} (${files.size} files, ${(zip.length / 1024).toFixed(1)} KiB) — ready to upload to itch.io as an HTML5 project.`);
}

