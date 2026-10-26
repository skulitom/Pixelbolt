import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareScene, renderScene, withLightSettings, setLightRadius, keysSetRadius } from '../src/scene.js';
import { resolveReferences } from '../src/resolve.js';
import { startStudio } from '../src/server.js';

// The scene page's light controls: what the studio serves it, and what "Save scene settings" writes.
const root = fileURLToPath(new URL('../', import.meta.url)), examples = path.join(root, 'examples'), file = path.join(examples, 'forest-spirit-lit.scene.json');
const written = async () => JSON.parse(await readFile(file, 'utf8'));
const resolved = async scene => (await resolveReferences(scene, { baseDir: examples })).document;
// node:http rather than fetch, which refuses the ports browsers block (6000, 6665…), and port 0 can hand out one of those.
const request = (url, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = http.request(url, { method, headers }, res => {
    const chunks = []; res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, json: () => JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
  });
  req.once('error', reject); req.end(body);
});

test('the studio serves a scene resolved, to draw, and as written, to save light settings into', async t => {
  const original = await written(), document = await resolved(original);
  assert.equal(typeof original.assets.spirit.recipe, 'string'); assert.equal(typeof document.assets.spirit.recipe, 'object');
  const check = async (base, label) => {
    const drawn = await request(`${base}/scene.json`), source = await request(`${base}/scene-source.json`);
    assert.deepEqual([drawn.status, source.status, drawn.headers['x-pixelbolt-scene-source']], [200, 200, 'scene-source.json'], label);
    assert.deepEqual([drawn.json(), source.json()], [document, original], label);
    // Both are only read.
    assert.equal((await request(`${base}/scene-source.json`, { method: 'PUT', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{}' })).status, 405, label);
  };
  // Without a scene of its own the page shows the lit forest spirit; with one, the scene the studio was given.
  for (const options of [{}, { project: document, source: original }]) {
    const server = await startStudio({ port: 0, quiet: true, ...options });
    t.after(() => { server.closeAllConnections(); server.close(); });
    await check(`http://127.0.0.1:${server.address().port}`, Object.keys(options).join() || 'default');
  }
  // `pixelbolt preview <scene>` hands the studio both.
  const child = spawn(process.execPath, [path.join(root, 'bin', 'pixelbolt.js'), 'preview', file, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const base = await new Promise((resolve, reject) => {
    let text = '';
    child.stdout.on('data', chunk => { text += chunk; const address = /Pixelbolt studio: (http:\/\/127\.0\.0\.1:\d+)/.exec(text); if (address) resolve(address[1]); });
    child.once('error', reject); child.once('exit', code => reject(new Error(`preview exited with ${code}: ${text}`)));
  });
  await check(base, 'pixelbolt preview');
});
test('saving light settings writes only the settings that changed, into the scene as written', async () => {
  const original = await written(), scene = prepareScene(await resolved(original));
  const [light] = scene.lighting.lights;
  light.at = [3, 4]; light.height = 6; light.color = [255, 0, 16, 255]; scene.lighting.ambient = 0.5;
  const saved = withLightSettings(original, scene, new Set(['0.at', '0.height', '0.color', 'ambient']));
  // The asset files stay named, and nothing else changes: a scene of under 500 bytes used to come back as 17 KB of recipes.
  assert.deepEqual(saved, { ...original, lighting: { ...original.lighting, ambient: 0.5, lights: [{ ...original.lighting.lights[0], at: [3, 4], height: 6, color: '#ff0010' }] } });
  assert.deepEqual(saved.assets, { spirit: { recipe: 'forest-spirit.json', normal: 'forest-spirit-normal.json' } });
  assert.deepEqual(original, await written(), 'the scene as written is copied, not changed');
  // A setting nobody touched is not written, even where the prepared scene holds a default for it.
  light.radius = 9; light.strength = 2;
  assert.deepEqual(withLightSettings(original, scene, new Set()), original);
  // Opened again, the saved scene draws what the preview drew.
  const reopened = prepareScene(await resolved(saved)), preview = prepareScene(await resolved(original));
  Object.assign(preview.lighting.lights[0], { at: [3, 4], height: 6, color: [255, 0, 16, 255] }); preview.lighting.ambient = 0.5;
  for (const time of [0, 400, 900]) assert.deepEqual(renderScene(reopened, { time }).data, renderScene(preview, { time }).data, `${time} ms`);
  // Colours keep a partial alpha.
  light.color = [1, 2, 3, 128];
  assert.equal(withLightSettings(original, scene, new Set(['0.color'])).lighting.lights[0].color, '#01020380');
});
test('the radius of a light with keys reaches the keys that set none, so the preview is what the saved scene shows', async () => {
  const original = await written();
  original.lighting.lights[0].keys = [{ time: 0, strength: 1 }, { time: 600, strength: 1.5, radius: 20 }];
  const scene = prepareScene(await resolved(original)), before = renderScene(scene, { time: 0 });
  assert.equal(keysSetRadius(scene, 0), false);
  // The slider used to set only the light's radius, which its keys had already copied: the preview stayed as it was,
  // while the saved scene, opened again, drew the new radius.
  setLightRadius(scene, 0, 12);
  const after = renderScene(scene, { time: 0 });
  assert.notDeepEqual(after.data, before.data, 'the radius changes the preview');
  assert.equal(after.lights[0].radius, 12);
  const saved = withLightSettings(original, scene, new Set(['0.radius']));
  assert.deepEqual(saved.lighting.lights[0], { ...original.lighting.lights[0], radius: 12 });
  const reopened = prepareScene(await resolved(saved));
  for (const time of [0, 300, 600, 1100]) assert.deepEqual(renderScene(scene, { time }).data, renderScene(reopened, { time }).data, `${time} ms`);
  // A key with a radius of its own keeps it.
  assert.equal(renderScene(scene, { time: 1100 }).lights[0].radius, 20);
  // When every key sets its own radius, the light's changes nothing, and the scene page turns its slider off.
  original.lighting.lights[0].keys[0].radius = 30;
  assert.equal(keysSetRadius(prepareScene(await resolved(original)), 0), true);
  const steady = prepareScene(await resolved(await written()));
  assert.equal(keysSetRadius(steady, 0), false, 'a light without keys');
  setLightRadius(steady, 0, 12); assert.equal(renderScene(steady, { time: 0 }).lights[0].radius, 12);
});
