import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { decodePNG } from '../src/import.js';
import { resolveReferences } from '../src/resolve.js';
import { checkVersion, recipeKind, readEmbeddedRecipe, readShareLink, RECIPE_LIMIT } from '../src/share.js';
import { loadEngine, renderRecipe, framesDigest, ENGINE_MODULES, sceneSheet } from '../playground/render.js';
import { encodePNG } from '../playground/png.js';
import { compareVersions, filterExamples, engineOverride, engineBase, jsonErrorLocation, formatSize, safeName, examplePath, inlineExample, timeLimit, advancePlayback } from '../playground/lib.js';
import { handleRequest } from '../playground/worker.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFile(path.join(root, file), 'utf8');
const json = async file => JSON.parse(await read(file));
const app = await read('playground/app.js'), pin = /\bconst PINNED_VERSION = '([^']+)'/.exec(app)[1];
const manifest = await json('playground/examples.json');
const engineURL = pathToFileURL(path.join(root, 'src') + path.sep);
const engine = await loadEngine(engineURL);
const tiny = { version: 1, name: 'tiny', width: 2, height: 1, palette: { a: '#f008' }, frames: [{ name: 'one', duration: 100, ops: [{ op: 'grid', rows: ['a.'] }] }, { name: 'two', duration: 100, ops: [{ op: 'grid', rows: ['.a'] }] }] };
const resolved = async file => (await resolveReferences(await json(`examples/${file}`), { baseDir: path.join(root, 'examples', path.dirname(file)) })).document;

test('manifest has valid unique files, matching kinds and version-gated presets', async () => {
  const seen = new Set();
  for (const entry of manifest) {
    assert.deepEqual(Object.keys(entry).sort(), ['file', 'kind', 'minVersion', 'title']);
    assert.equal(typeof entry.title, 'string'); assert.ok(entry.title.trim());
    checkVersion(entry.minVersion); assert.equal(examplePath(entry.file), entry.file);
    assert.ok(!seen.has(entry.file)); seen.add(entry.file);
    assert.equal(entry.kind, recipeKind(await json(`examples/${entry.file}`)), entry.file);
  }
  const available = filterExamples(manifest, pin);
  assert.ok(available.length >= 20); assert.ok(available.filter(entry => entry.kind === 'fluid').length >= 10);
  for (const entry of manifest) assert.equal(available.includes(entry), compareVersions(entry.minVersion, pin) <= 0, entry.file);
  for (const file of ['honey.fluid.json', 'slime.fluid.json']) {
    const entry = manifest.find(item => item.file === file);
    assert.equal(entry.minVersion, '0.9.1');
    assert.ok(!filterExamples(manifest, '0.9.0').includes(entry)); assert.ok(filterExamples(manifest, '0.9.1').includes(entry));
  }
});
test('one engine pin is supported and no newer than the package; package excludes playground and scripts', async () => {
  assert.equal([...app.matchAll(/\b(?:const|let|var)\s+PINNED_VERSION\s*=/g)].length, 1);
  checkVersion(pin);
  const pkg = await json('package.json');
  assert.ok(compareVersions(pin, pkg.version) <= 0);
  assert.ok(!pkg.files.some(file => /^(?:\.\/)?(?:playground|scripts)(?:\/|$)/.test(file)));
});

for (const [kind, file] of [['project', 'coin.json'], ['poses', 'swing.poses.json'], ['fx', 'effects.fx.json'], ['fluid', 'torch.fluid.json'], ['normals', 'forest-spirit.normals.json'], ['scene', 'forest-spirit-lit.scene.json'], ['autotile', null]]) {
  test(`shared render core: ${kind} is byte-stable and agrees with direct engine calls`, async () => {
    const document = file ? await resolved(file) : { format: 'pixelforge-autotile', version: 1, name: 'tiles', tile: 2, palette: { a: '#abc' }, template: Array(6).fill('aaaa'), frame: 'tile-{mask}' };
    const first = renderRecipe(engine, document), second = renderRecipe(engine, document);
    assert.equal(first.kind, kind); assert.ok(first.frames.length > 0);
    assert.equal(await framesDigest(first.frames), await framesDigest(second.frames));
    const compiler = { poses: engine.authoring.compilePoses, fx: engine.fx.compileEffects, fluid: engine.fluid.compileFluid, normals: engine.authoring.compileNormals, autotile: engine.authoring.compileAutotile }[kind];
    if (kind === 'scene') {
      const prepared = engine.scene.prepareScene(document);
      assert.equal(first.frames.length, Math.ceil(prepared.duration / 100));
      for (const [i, frame] of first.frames.entries()) assert.deepEqual(frame.data, engine.scene.renderScene(prepared, { time: i * 100 }).data);
      assert.deepEqual(first.animations.scene, { frames: first.frames.map((_, i) => i), loop: true });
    } else {
      const direct = engine.core.renderProject(compiler ? compiler(document).recipe : document);
      assert.deepEqual(first.frames.map(frame => frame.data), direct.frames.map(frame => frame.data));
      assert.deepEqual(first.animations, direct.animations);
    }
  });
}
test('digest uses big-endian dimensions and RGBA bytes in order', async () => {
  const frames = renderRecipe(engine, tiny).frames, hash = createHash('sha256');
  for (const frame of frames) { const header = Buffer.alloc(8); header.writeUInt32BE(2, 0); header.writeUInt32BE(1, 4); hash.update(header); hash.update(frame.data); }
  assert.equal(await framesDigest(frames), hash.digest('hex'));
  assert.notEqual(await framesDigest(frames), await framesDigest(frames.toReversed()));
  assert.notEqual(await framesDigest(frames), await framesDigest(frames.map(frame => ({ ...frame, width: 1, height: 2 }))));
});
test('scene sampling caps at 240, handles zero duration and assembles a sheet', () => {
  const stub = { scene: { prepareScene: doc => doc, renderScene: (doc, { time }) => ({ data: Uint8Array.of(time / 100, 0, 0, 255), warnings: ['sample'] }) } };
  const scene = renderRecipe(stub, { format: 'pixelforge-scene', name: 'sample', width: 1, height: 1, duration: 60000, warnings: [] });
  assert.equal(scene.frames.length, 240); assert.equal(scene.frames[239].data[0], 239);
  assert.ok(scene.warnings.some(warning => /240/.test(warning)));
  assert.equal(scene.warnings.filter(warning => warning === 'sample').length, 1);
  assert.equal(renderRecipe(stub, { format: 'pixelforge-scene', width: 1, height: 1, duration: 0, warnings: [] }).frames.length, 1);
  const sheet = sceneSheet(scene); assert.ok(sheet.width * sheet.height >= 240);
  assert.deepEqual([...sheet.data.subarray(0, 8)], [0, 0, 0, 255, 1, 0, 0, 255]);
});
test('unknown formats and unresolved filenames are clear errors', () => {
  for (const format of ['pixelforge-overlay', 'pixelforge-pose-metadata', 'unknown']) assert.throws(() => renderRecipe(engine, { format }), /cannot be rendered on their own/);
  for (const document of [
    { ...tiny, palette: { $ref: 'palette.json' } },
    { format: 'pixelforge-normals', recipe: 'palette.json' },
    { format: 'pixelforge-scene', assets: { a: { recipe: tiny, normal: 'palette.json' } } },
    { format: 'pixelforge-scene', palette: 'palette.json' }
  ]) assert.throws(() => renderRecipe(engine, document), { message: 'This recipe names the file palette.json; the playground needs it inline.' });
});
test('browser PNG encoder preserves RGBA and passes the independent Node decoder', async () => {
  const rgba = Uint8Array.from({ length: 7 * 5 * 4 }, (_, i) => i * 17 % 256), png = await encodePNG(rgba, 7, 5);
  const decoded = decodePNG(png);
  assert.equal(decoded.width, 7); assert.equal(decoded.height, 5);
  assert.deepEqual([...decoded.data], [...rgba]);
  await assert.rejects(encodePNG(rgba, 2, 2), /matching RGBA/);
});

test('engine overrides only accept HTTP own-origin or loopback-to-loopback URLs', () => {
  const page = 'https://skulitom.github.io/Pixelbolt/playground/';
  const use = (base, requested) => engineOverride(`${base}?engine=${encodeURIComponent(requested)}`);
  assert.equal(use(page, '../src/').base, 'https://skulitom.github.io/Pixelbolt/src/');
  assert.equal(use(page, 'https://skulitom.github.io/test').base, 'https://skulitom.github.io/test/');
  for (const host of ['localhost', '127.0.0.1', '[::1]']) assert.equal(use('http://127.0.0.1:8000/', `http://${host}:9000/src/`).base, `http://${host}:9000/src/`);
  for (const value of ['javascript:alert(1)', 'data:text/javascript,hello', 'https://cdn.jsdelivr.net/x', 'https://other.invalid/src/', 'http://localhost/src/', '//other.invalid/src/', 'https://user:password@skulitom.github.io/src/']) {
    const result = use(page, value); assert.equal(result.base, null, value); assert.match(result.notice, /Ignored/);
  }
  assert.equal(use('http://localhost/', 'http://127.0.0.2/src/').base, null);
  assert.equal(use('http://localhost/', 'https://external.invalid/').base, null);
  assert.equal(engineOverride(page).notice, '');
  assert.equal(engineBase('0.9.0'), 'https://cdn.jsdelivr.net/npm/pixelbolt@0.9.0/src/');
});
test('a JSON mistake reports its line once, without the parser\'s own position wording', async () => {
  const text = ['{', '  "version": 1,', '  "name": "broken"', '  "width": 8', '}'].join('\n');
  await assert.rejects(handleRequest({ type: 'render', text, version: pin, override: engineURL.href }), error => {
    assert.equal(error.line, 4);
    assert.match(error.message, /^Line 4, column 3: [A-Z]/);
    assert.doesNotMatch(error.message, /position|JSON\.parse|of the JSON data/);
    return true;
  });
});
test('playback keeps overshoot, so 20 ms frames play at 50 a second on a 60 Hz screen', () => {
  let state = { position: 0, nextAt: 0 }, steps = 0;
  for (let frame = 0; frame <= 60; frame++) {
    const next = advancePlayback({ ...state, now: frame * 1000 / 60, durations: [20, 20, 20, 20, 20], loop: true });
    if (next.moved) steps += (next.position - state.position + 5) % 5 || 5;
    state = next;
  }
  assert.ok(steps >= 49 && steps <= 50, `${steps} steps in one second`);
});
test('a one-shot animation holds its last step, then plays again; a stalled tab resyncs', () => {
  const durations = [100, 100, 100];
  let state = advancePlayback({ position: 0, nextAt: 0, now: 0, durations, loop: false });
  assert.deepEqual(state, { position: 0, nextAt: 100, moved: false });
  state = advancePlayback({ ...state, now: 200, durations, loop: false });
  assert.equal(state.position, 2); assert.equal(state.nextAt, 900);
  assert.equal(advancePlayback({ ...state, now: 899, durations, loop: false }).position, 2);
  assert.equal(advancePlayback({ ...state, now: 900, durations, loop: false }).position, 0);
  const stalled = advancePlayback({ position: 0, nextAt: 100, now: 10_000_000, durations: [1, 1], loop: true });
  assert.ok(stalled.nextAt > 10_000_000);
});
test('a downloaded recipe always reopens, compact when indenting would pass the size limit', async () => {
  const big = { ...tiny, notes: Array(3_000_000).fill(1) }, text = JSON.stringify(big);
  assert.ok(text.length < RECIPE_LIMIT && JSON.stringify(big, null, 2).length > RECIPE_LIMIT);
  const { files: [file] } = await handleRequest({ type: 'export', export: 'recipe', text, version: pin, override: engineURL.href });
  assert.ok(file.data.length <= RECIPE_LIMIT);
  const reopened = new TextDecoder().decode(file.data);
  await handleRequest({ type: 'open', text: reopened, version: pin, override: engineURL.href }, () => {}).catch(error => assert.doesNotMatch(error.message, /larger than/));
  assert.equal(JSON.stringify(JSON.parse(reopened)), text);
  const small = await handleRequest({ type: 'export', export: 'recipe', text: JSON.stringify(tiny), version: pin, override: engineURL.href });
  assert.equal(new TextDecoder().decode(small.files[0].data), JSON.stringify(tiny, null, 2) + '\n');
});
test('only a loopback page may lower the render time limit, and never raise it', () => {
  assert.equal(timeLimit('http://127.0.0.1:8000/playground/?limit=1000'), 1000);
  assert.equal(timeLimit('http://localhost/playground/?limit=99999'), 20000);
  assert.equal(timeLimit('http://[::1]/playground/?limit=150'), 150);
  for (const page of ['https://skulitom.github.io/Pixelbolt/playground/?limit=1000', 'http://127.0.0.1/playground/?limit=1e3', 'http://127.0.0.1/playground/?limit=-5', 'http://127.0.0.1/playground/']) assert.equal(timeLimit(page), 20000, page);
});
test('JSON error finder understands V8 and SpiderMonkey and preserves fallback messages', () => {
  const text = '{\n  "x":\n nope\n}';
  assert.deepEqual(jsonErrorLocation(text, 'Unexpected token n at position 10'), { line: 3, column: 2, message: 'Unexpected token n at position 10' });
  for (const message of ['Bad JSON (line 3 column 2)', 'JSON.parse: bad value at line 3 column 2 of the JSON data']) {
    assert.deepEqual(jsonErrorLocation(text, new Error(message)), { line: 3, column: 2, message });
  }
  assert.deepEqual(jsonErrorLocation(text, 'Unexpected end of JSON input'), { message: 'Unexpected end of JSON input' });
});
test('small helpers order versions numerically, format sizes and sanitise filenames', () => {
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1); assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('0.9.0', '1.0.0'), -1);
  assert.equal(formatSize(100), '100 B'); assert.equal(formatSize(1024), '1.0 KiB'); assert.equal(formatSize(1048576), '1.0 MiB');
  assert.match(safeName('<img src=x onerror=alert(1)>/../'), /^[A-Za-z0-9_-]+$/);
});
test('example inlining agrees with resolve.js for all manifest sources', async () => {
  for (const entry of manifest) {
    const source = await json(`examples/${entry.file}`);
    const actual = await inlineExample(source, entry.file, file => json(`examples/${file}`));
    assert.deepEqual(actual, await resolved(entry.file), entry.file);
  }
});
test('example references inherit palettes and ramps, resolve themes/passes, and reject escapes', async () => {
  const docs = { 'quality/palette.json': { palette: { a: '#123', b: '#456' }, ramps: [['a', 'b']] }, 'quality/base.json': { ...tiny, palette: { $ref: 'palette.json', a: '#fff' } } };
  const load = async file => { assert.ok(Object.hasOwn(docs, file), file); return docs[file]; };
  const source = { format: 'pixelforge-scene', palette: 'palette.json', assets: { one: { recipe: 'base.json', normal: 'base.json', emissive: 'base.json', palette: 'palette.json' }, two: 'base.json' } };
  const result = await inlineExample(source, 'quality/test.scene.json', load);
  assert.deepEqual(result.palette, { a: '#123', b: '#456' });
  assert.deepEqual(result.assets.one.recipe.palette, { a: '#fff', b: '#456' });
  assert.deepEqual(result.assets.two.ramps, [['a', 'b']]);
  assert.deepEqual(result.assets.one.normal, result.assets.one.emissive);
  assert.deepEqual(result.assets.one.palette, result.palette);
  for (const file of ['../evil.json', '/evil.json', 'https://evil.invalid/a', 'a\\b.json', '%2e%2e/x', 'a.json?x', 'a//b.json']) assert.throws(() => examplePath(file), /plain relative/);
  await assert.rejects(inlineExample({ ...tiny, palette: { $ref: 'nested.json' } }, 'a.json', async () => ({ $ref: 'again.json' })), /Nested palette/);
});

test('worker exports source-bearing PNGs, an exact atlas, explicit-scale GIF and source JSON', async () => {
  const request = { type: 'render', version: pin, override: engineURL.href, text: JSON.stringify(tiny) };
  const preview = await handleRequest(request);
  const detached = structuredClone(preview, { transfer: preview.frames.map(frame => frame.data.buffer) });
  assert.equal(preview.frames[0].data.byteLength, 0); assert.ok(detached.frames[0].data.length);
  for (const kind of ['frame', 'sheet', 'atlas', 'gif', 'recipe']) {
    const result = await handleRequest({ ...request, type: 'export', export: kind, scale: 3, frame: 1, animation: Object.keys(detached.animations)[0] });
    assert.equal(result.files.length, kind === 'atlas' ? 2 : 1);
    for (const file of result.files.filter(file => file.type === 'image/png')) {
      assert.deepEqual((await readEmbeddedRecipe(file.data)).recipe, tiny);
      const image = decodePNG(file.data);
      if (kind === 'frame') { assert.equal(image.width, 6); assert.equal(image.height, 3); assert.deepEqual(image.data, engine.core.scalePixels(detached.frames[1].data, 2, 1, 3)); }
      else assert.deepEqual(image.data, engine.core.buildAtlas(engine.core.renderProject(tiny)).data);
    }
    if (kind === 'atlas') assert.equal(new TextDecoder().decode(result.files[1].data), JSON.stringify(engine.core.buildAtlas(engine.core.renderProject(tiny)).metadata, null, 2) + '\n');
    if (kind === 'gif') { const data = Buffer.from(result.files[0].data); assert.equal(data.toString('ascii', 0, 6), 'GIF89a'); assert.equal(data.readUInt16LE(6), 6); assert.equal(data.readUInt16LE(8), 3); assert.ok(result.warnings.length); }
    if (kind === 'recipe') assert.deepEqual(JSON.parse(new TextDecoder().decode(result.files[0].data)), tiny);
  }
  const shared = await handleRequest({ ...request, type: 'share', base: 'https://skulitom.github.io/Pixelbolt/playground/' });
  assert.deepEqual((await readShareLink(shared.link)).recipe, tiny);
});
test('worker restores source/version from PNG and links and leaves invalid imports unpublished', async () => {
  const request = { type: 'render', version: pin, override: engineURL.href, text: JSON.stringify(tiny) };
  const png = (await handleRequest({ ...request, type: 'export', export: 'frame', frame: 0, scale: 1 })).files[0].data;
  let opened;
  const result = await handleRequest({ ...request, type: 'open', png: png.buffer }, source => { opened = source; });
  assert.equal(opened.version, pin); assert.deepEqual(JSON.parse(opened.text), tiny); assert.equal(result.kind, 'project');
  const link = (await handleRequest({ ...request, type: 'share', version: '0.9.1', base: 'https://skulitom.github.io/Pixelbolt/playground/' })).link;
  assert.equal((await handleRequest({ ...request, type: 'link', hash: link }, source => { opened = source; })).version, '0.9.1');
  assert.equal(opened.version, '0.9.1');
  await assert.rejects(handleRequest({ ...request, type: 'link', hash: '#r=broken' }, () => assert.fail('invalid source published')), /needs both/);
  const plain = await encodePNG(Uint8Array.of(0, 0, 0, 0), 1, 1);
  await assert.rejects(handleRequest({ ...request, type: 'open', png: plain.buffer }), /This PNG carries no Pixelbolt recipe/);
  await assert.rejects(handleRequest({ ...request, text: '{\n  bad' }), /Line 2, column/);
});
test('scene exports carry their source but atlas metadata is unavailable', async () => {
  const source = { format: 'pixelforge-scene', version: 1, name: 'scene', width: 2, height: 1, duration: 100, assets: { sprite: tiny }, instances: [{ asset: 'sprite', at: [0, 0] }] };
  const request = { type: 'export', version: pin, override: engineURL.href, text: JSON.stringify(source), scale: 1, frame: 0, animation: 'scene' };
  for (const kind of ['frame', 'sheet']) assert.deepEqual((await readEmbeddedRecipe((await handleRequest({ ...request, export: kind })).files[0].data)).recipe, source);
  await assert.rejects(handleRequest({ ...request, export: 'atlas' }), /no sprite atlas metadata/);
  assert.equal((await handleRequest({ ...request, export: 'gif' })).files[0].type, 'image/gif');
});
test('worker checks UTF-8 recipe bytes before parsing and recovers from a failed engine import', async () => {
  const request = { type: 'render', version: pin, override: engineURL.href, text: JSON.stringify(tiny) };
  await assert.rejects(handleRequest({ ...request, text: 'é'.repeat(RECIPE_LIMIT / 2 + 1) }), /larger than 16,777,216 bytes/);
  await handleRequest(request);
  await assert.rejects(handleRequest({ ...request, override: new URL('../missing-playground-test-engine/', engineURL).href }), /local test engine could not be loaded/);
  const recovered = await handleRequest({ ...request, text: JSON.stringify({ ...tiny, name: 'recovered' }) });
  assert.equal(recovered.name, 'recovered');
});

async function walk(folder) {
  const result = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) result.push(...await walk(file)); else result.push(file);
  }
  return result;
}
test('page security: safe DOM APIs, exact CSP, permitted hosts and browser-only engine modules', async () => {
  for (const file of await walk(path.join(root, 'playground'))) {
    const text = await readFile(file, 'utf8');
    if (file.endsWith('.js')) assert.doesNotMatch(text, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new\s+Function\b/, file);
    for (const match of text.matchAll(/https:\/\/([A-Za-z0-9.-]+)/g)) assert.ok(['cdn.jsdelivr.net', 'skulitom.github.io', 'github.com'].includes(match[1]), `${file}: ${match[1]}`);
  }
  const html = await read('playground/index.html');
  const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)[1];
  assert.equal(policy, "default-src 'none'; script-src 'self' https://cdn.jsdelivr.net; worker-src 'self' blob:; connect-src 'self' https://cdn.jsdelivr.net; img-src 'self' data: blob:; style-src 'self'; base-uri 'none'; form-action 'none'");
  assert.doesNotMatch(html, /<style\b|\sstyle\s*=|<script(?![^>]*\bsrc=)/i);
  assert.deepEqual(ENGINE_MODULES, ['core', 'authoring', 'fx', 'fluid', 'scene', 'gif']);
  assert.doesNotMatch(await read('playground/render.js'), /^import\s/m);
  for (const id of ['recipe', 'examples', 'open-file', 'copy-link', 'share-link', 'export-frame', 'export-sheet', 'export-gif', 'export-atlas', 'export-recipe', 'gif-size', 'gif-scale', 'zoom', 'animation', 'play', 'step-back', 'step-forward', 'cancel', 'status', 'error', 'digest', 'engine-version']) assert.ok(html.includes(`id="${id}"`), id);
});
test('deploy copies only page files, inserts once, keeps second-run bytes and mtimes, never runs git', async () => {
  const out = await mkdtemp(path.join(tmpdir(), 'pixelbolt-playground-'));
  try {
    await writeFile(path.join(out, 'index.html'), '<html><p>Source: <a href="https://github.com/skulitom/Pixelbolt">GitHub</a>.</p><p>Next paragraph.</p><footer>Plain static pages: no scripts, trackers or cookies. Made here.</footer></html>');
    await writeFile(path.join(out, 'sitemap.xml'), '<?xml version="1.0"?><urlset>\n</urlset>');
    const script = path.join(root, 'scripts/deploy-playground.mjs');
    const output = execFileSync(process.execPath, [script, out], { encoding: 'utf8', env: { ...process.env, PATH: '' } });
    assert.match(output, /add -A playground sitemap.xml index.html/); assert.match(output, /commit -m "Add the browser playground"/); assert.match(output, /push origin gh-pages/);
    const before = new Map();
    for (const file of await walk(out)) before.set(file, { bytes: await readFile(file), mtime: (await stat(file)).mtimeMs });
    const index = (await readFile(path.join(out, 'index.html'), 'utf8'));
    assert.equal((index.match(/href="playground\/"/g) ?? []).length, 1); assert.ok(index.indexOf('Try Pixelbolt') < index.indexOf('Next paragraph'));
    assert.match(index, /<footer>Plain static pages with no trackers or cookies; only the playground runs scripts, in your browser\. Made here\.<\/footer>/);
    assert.match(await readFile(path.join(out, 'sitemap.xml'), 'utf8'), /<loc>https:\/\/skulitom.github.io\/Pixelbolt\/playground\/<\/loc><lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
    assert.ok(!before.has(path.join(out, 'playground/DEPLOY.md')));
    for (const file of await readdir(path.join(root, 'playground'))) if (file !== 'DEPLOY.md') assert.deepEqual(await readFile(path.join(out, 'playground', file)), await readFile(path.join(root, 'playground', file)));
    assert.match(execFileSync(process.execPath, [script, out], { encoding: 'utf8', env: { ...process.env, PATH: '' } }), /No files changed/);
    assert.equal((await walk(out)).length, before.size);
    for (const [file, original] of before) { assert.deepEqual(await readFile(file), original.bytes); assert.equal((await stat(file)).mtimeMs, original.mtime); }
    await assert.rejects(stat(path.join(out, '.git')), { code: 'ENOENT' });
    assert.doesNotMatch(await read('scripts/deploy-playground.mjs'), /node:child_process|\b(?:spawn|execFile|execSync)\s*\(/);
  } finally {
    // mkdtemp's absolute result is confined to the OS temp directory before recursive removal.
    assert.equal(path.dirname(out), path.resolve(tmpdir())); assert.ok(path.basename(out).startsWith('pixelbolt-playground-'));
    await rm(out, { recursive: true, force: true });
  }
});

test('main-thread lifecycle handles reduced motion, stale results, errors, cancellation and the 20-second deadline', async () => {
  // This exercises the real controller without a browser or network. Pixels and workers have their own tests above.
  const elements = new Map(), timers = new Map(), workers = [], events = new Map();
  let timerId = 0;
  class Element {
    constructor(tag) { this.tag = tag; this.value = ''; this.textContent = ''; this.children = []; this.events = new Map(); this.style = {}; this.dataset = {}; this.attributes = {}; this.classList = { add() {}, remove() {} }; }
    get options() { return this.children.flatMap(child => child.tag === 'optgroup' ? child.children : [child]); }
    append(...children) { this.children.push(...children); if (this.tag === 'select' && !this.value) this.value = this.options[0]?.value ?? ''; }
    replaceChildren(...children) { this.children = []; this.value = ''; this.append(...children); }
    addEventListener(name, handler) { this.events.set(name, handler); }
    emit(name, extra = {}) { return this.events.get(name)?.({ preventDefault() {}, ...extra }); }
    setAttribute(name, value) { this.attributes[name] = value; }
    getContext() { return { putImageData() {} }; }
    focus() {} select() {} remove() {} click() { return this.emit('click'); }
  }
  for (const match of (await read('playground/index.html')).matchAll(/<(\w+)\b[^>]*\bid="([^"]+)"/g)) elements.set(match[2], new Element(match[1]));
  const body = new Element('body');
  class Worker {
    constructor(url, options) { assert.ok(url.href.endsWith('/playground/worker.js')); assert.equal(options.type, 'module'); this.requests = []; workers.push(this); }
    postMessage(message) { this.requests.push(message); }
    terminate() { this.terminated = true; }
    reply(value) { this.onmessage({ data: { id: this.requests.at(-1).id, ...value } }); }
  }
  const replacements = {
    document: { body, hidden: false, getElementById: id => { assert.ok(elements.has(id), id); return elements.get(id); }, createElement: tag => new Element(tag), addEventListener() {} },
    location: { href: 'http://localhost/playground/?engine=../src/', origin: 'http://localhost', pathname: '/playground/', hash: '' },
    history: { replaceState() {} }, Worker,
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    requestAnimationFrame: () => {},
    addEventListener: (name, callback) => events.set(name, callback),
    fetch: async () => ({ ok: true, json: async () => manifest }),
    ImageData: class { constructor(data, width, height) { this.data = data; this.width = width; this.height = height; } },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id)
  };
  const originals = new Map(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  const fireTimer = delay => { const entry = [...timers].find(([, timer]) => timer.delay === delay); assert.ok(entry, `timer ${delay}`); timers.delete(entry[0]); entry[1].callback(); };
  const preview = { ...renderRecipe(engine, tiny), digest: 'abc123', version: pin };
  try {
    for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    await import('../playground/app.js?controller-test'); await flush();
    assert.equal(workers.length, 1);
    workers[0].reply({ source: { text: JSON.stringify(tiny), version: pin } });
    workers[0].reply({ result: preview }); await flush();
    assert.equal(body.dataset.state, 'ready'); assert.equal(body.dataset.digest, 'abc123');
    assert.equal(elements.get('play').textContent, 'Play');
    assert.equal(elements.get('gif-size').textContent, 'GIF: 2×1 px, 2 frames, scale 1');
    assert.equal(elements.get('copy-link').disabled, false);
    elements.get('preview').emit('keydown', { key: 'ArrowRight' });
    assert.equal(elements.get('frame-counter').textContent, '2 / 2');
    elements.get('preview').emit('keydown', { key: ' ' }); assert.equal(elements.get('play').textContent, 'Pause');
    elements.get('recipe').value = '{bad'; elements.get('recipe').emit('input'); fireTimer(300);
    workers[0].reply({ error: { name: 'Error', message: 'Line 1, column 2: bad JSON' } }); await flush();
    assert.equal(body.dataset.state, 'error'); assert.equal(body.dataset.digest, 'abc123');
    assert.match(elements.get('error').textContent, /Line 1/);
    assert.equal(elements.get('export-frame').disabled, true);
    elements.get('recipe').value = JSON.stringify(tiny); elements.get('recipe').emit('input'); fireTimer(300);
    const staleId = workers[0].requests.at(-1).id;
    elements.get('recipe').emit('input'); assert.equal(workers[0].terminated, true); fireTimer(300);
    assert.equal(workers.length, 2);
    workers[0].onmessage({ data: { id: staleId, result: { ...preview, digest: 'stale' } } });
    workers[0].onerror({ preventDefault() {}, message: 'old worker error' });
    assert.ok(!workers[1].terminated); assert.equal(body.dataset.digest, 'abc123');
    fireTimer(20000); await flush();
    assert.equal(workers[1].terminated, true);
    assert.equal(elements.get('error').textContent, 'Stopped: rendering took longer than 20 s.');
    elements.get('retry').click(); assert.equal(workers.length, 3);
    elements.get('cancel').click(); await flush();
    assert.equal(workers[2].terminated, true); assert.equal(elements.get('error').textContent, 'Stopped: rendering cancelled.');
    assert.equal(elements.get('cancel').hidden, true);
    const before = elements.get('recipe').value;
    globalThis.location.hash = '#r=broken'; events.get('hashchange')();
    workers[3].reply({ error: { name: 'ShareError', message: 'The link needs both v= and r=.' } }); await flush();
    assert.equal(elements.get('recipe').value, before);
    // A link that names another engine version than the pin keeps the last good render until that version replies.
    const other = pin === '0.9.0' ? '0.9.1' : '0.9.0', escape = version => version.replaceAll('.', '\\.');
    globalThis.location.hash = `#v=${other}&r=valid`; events.get('hashchange')();
    workers[3].reply({ source: { text: before, version: other } });
    assert.match(elements.get('engine-version').textContent, new RegExp(`Pixelbolt ${escape(pin)} \\(last good render\\)`));
    workers[3].reply({ result: { ...preview, version: other } }); await flush();
    assert.match(elements.get('version-message').textContent, new RegExp(`This recipe was made with Pixelbolt ${escape(other)}`));
    assert.equal(elements.get('examples').options.some(option => option.value === 'honey.fluid.json'), compareVersions(other, '0.9.1') >= 0);
    elements.get('use-pin').click(); assert.equal(workers[3].requests.at(-1).version, pin);
    events.get('pagehide')(); await flush();
  } finally {
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});
