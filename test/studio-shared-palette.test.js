import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { heroRig } from '../scripts/figure-rigs.mjs';
import { compilePoses } from '../src/authoring.js';
import { inlineSharedPalette, renderProject } from '../src/core.js';
import { resolveReferences } from '../src/resolve.js';
import { startStudio } from '../src/server.js';

// A recipe whose palette links a shared file (`"palette": { "$ref": "shared.json" }`), opened with `pixelbolt preview`.
// The studio's editor shows /project.json and Save JSON writes the editor's text; the page draws that text with
// /shared-palette.json, the one file the recipe links, through inlineSharedPalette as the CLI does.
const root = fileURLToPath(new URL('../', import.meta.url)), cli = path.join(root, 'bin', 'pixelbolt.js');
// node:http rather than fetch, which refuses the ports browsers block, and port 0 can hand out one of those.
const read = url => new Promise((resolve, reject) => {
  http.get(url, res => { const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve([res.statusCode, JSON.parse(Buffer.concat(chunks).toString('utf8'))])); }).once('error', reject);
});
async function folder(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-linked-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
// What `pixelbolt preview <file>` gives the studio page.
async function preview(t, file) {
  const child = spawn(process.execPath, [cli, 'preview', file, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const base = await new Promise((resolve, reject) => {
    let text = '';
    child.stdout.on('data', chunk => { text += chunk; const address = /Pixelbolt studio: (http:\/\/127\.0\.0\.1:\d+)/.exec(text); if (address) resolve(address[1]); });
    child.stderr.on('data', chunk => { text += chunk; });
    child.once('error', reject); child.once('exit', code => reject(new Error(`preview exited with ${code}: ${text}`)));
  });
  const [[sourceStatus, source], [sharedStatus, shared]] = await Promise.all([read(`${base}/project.json`), read(`${base}/shared-palette.json`)]);
  assert.deepEqual([sourceStatus, sharedStatus], [200, 200]);
  return { source, shared };
}

test('the studio is given a linked recipe as written, so Save JSON keeps its $ref, and draws it as the CLI renders it', async t => {
  const dir = await folder(t), shared = { palette: { g: '#72b58d', d: '#1d2b33', s: '#ffd27a' }, ramps: [['d', 'g']] };
  const hero = { version: 1, name: 'hero', width: 3, height: 1, palette: { $ref: 'shared.json', s: '#ff0000' }, frames: [{ name: 'idle', ops: [{ op: 'grid', rows: ['gsd'] }] }] };
  await writeFile(path.join(dir, 'shared.json'), JSON.stringify(shared));
  await writeFile(path.join(dir, 'hero.json'), JSON.stringify(hero, null, 2));
  const served = await preview(t, path.join(dir, 'hero.json'));
  // It used to be sent the palette read in ({"g":…,"d":…,"s":"#ff0000"}), and Save JSON wrote the recipe without its link.
  assert.deepEqual(served.source, hero);
  assert.deepEqual(served.shared, { $ref: 'shared.json', ...shared });
  // Drawn with that file, the recipe is the one the CLI renders, ramps from the file included.
  const resolved = (await resolveReferences(hero, { baseDir: dir })).document, drawn = inlineSharedPalette(served.source, served.shared);
  assert.deepEqual(drawn, resolved);
  assert.deepEqual(renderProject(drawn).frames[0].data, renderProject(resolved).frames[0].data);
  // Saved from the editor with an edit, the recipe still links the file and keeps its own entries local.
  const edited = JSON.parse(JSON.stringify(served.source, null, 2));
  edited.palette.x = '#ffffff'; edited.frames[0].ops[0].rows = ['gsx'];
  const reopened = await resolveReferences(edited, { baseDir: dir });
  assert.deepEqual([edited.palette, reopened.files], [{ $ref: 'shared.json', s: '#ff0000', x: '#ffffff' }, [path.join(dir, 'shared.json')]]);
  assert.deepEqual(inlineSharedPalette(edited, served.shared), reopened.document);
  // The page fills its editor from /project.json and Save JSON downloads the editor's text.
  const script = await readFile(path.join(root, 'studio', 'studio.js'), 'utf8');
  assert.match(script, /\[initial, linked\] = await Promise\.all\(\[fetch\('\/project\.json'\), fetch\('\/shared-palette\.json'\)\]/);
  assert.match(script, /if \(initial\) setSource\(initial\);/);
  assert.match(script, /\$\('save'\)\.addEventListener\('click', \(\) => \{[\s\S]*?download\(source\.value, filename/);
});
test('a pose source that links a shared palette keeps the link as written, and draws as the CLI compiles it', async t => {
  const dir = await folder(t), rig = heroRig(), source = { ...rig, palette: { $ref: './colours.json', w: '#ffffff' } };
  await writeFile(path.join(dir, 'colours.json'), JSON.stringify(rig.palette));
  await writeFile(path.join(dir, 'figure.poses.json'), JSON.stringify(source));
  const served = await preview(t, path.join(dir, 'figure.poses.json'));
  assert.deepEqual(served.source, source);
  assert.deepEqual(served.shared, { $ref: './colours.json', palette: rig.palette, ramps: null });
  assert.deepEqual(compilePoses(inlineSharedPalette(served.source, served.shared)), compilePoses((await resolveReferences(source, { baseDir: dir })).document));
});
test('a compiled source opens as the recipe pixelbolt compile writes beside it, with the link', async t => {
  const dir = await folder(t), art = path.join(root, 'showcase', 'diorama', 'art');
  for (const name of ['shards.fx.json', 'palette.json']) await copyFile(path.join(art, name), path.join(dir, name));
  const served = await preview(t, path.join(dir, 'shards.fx.json')), out = path.join(dir, 'shards.json');
  const compiled = spawnSync(process.execPath, [cli, 'compile', path.join(dir, 'shards.fx.json'), '--out', out], { encoding: 'utf8' });
  assert.equal(compiled.status, 0, compiled.stderr);
  assert.deepEqual(served.source, JSON.parse(await readFile(out, 'utf8')));
  assert.equal(served.source.palette.$ref, 'palette.json');
  // Drawn as `pixelbolt render shards.json` would draw that file.
  assert.ok(served.shared.ramps.length > 0);
  assert.deepEqual(inlineSharedPalette(served.source, served.shared), (await resolveReferences(served.source, { baseDir: dir })).document);
});
test('a studio without a linked recipe has no shared palette to give', async t => {
  for (const options of [{}, { project: { version: 1, name: 'dot', width: 1, height: 1, palette: { w: '#fff' }, frames: [{ name: 'idle', ops: [{ op: 'pixel', color: 'w' }] }] } }]) {
    const server = await startStudio({ port: 0, quiet: true, ...options });
    t.after(() => { server.closeAllConnections(); server.close(); });
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.deepEqual(await read(`${base}/shared-palette.json`), [200, null]);
    assert.deepEqual(await read(`${base}/project.json`), [200, options.project ?? null]);
  }
});
