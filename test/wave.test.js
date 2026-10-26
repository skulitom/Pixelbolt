import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { compileWaves, WAVE_KINDS } from '../src/wave.js';
import { renderProject, PixelError } from '../src/core.js';
import { wavePresets } from '../scripts/wave-presets.mjs';
import { resolveReferences } from '../src/resolve.js';
import { readShareLink } from '../src/share.js';
import { startMCP } from '../src/mcp.js';
import { startStudio } from '../src/server.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const tiny = () => ({ format: 'pixelforge-wave', version: 1, name: 'probe', width: 8, height: 4,
  palette: { a: '#fff', b: '#f00', z: 'transparent' }, effects: { loop: { frames: 16, duration: 60,
    sources: [{ kind: 'directional', at: [0, 0], angle: 0, wavelength: 8, amplitude: 0.1, cycles: 1 }],
    look: { colors: ['a'], thresholds: [0.15], negative: ['b'] } } } });
const pixels = source => renderProject(compileWaves(source).recipe).frames.map(f => Buffer.from(f.data));
const digest = source => createHash('sha256').update(Buffer.concat(pixels(source))).digest('hex');
const cli = (...args) => spawnSync(process.execPath, [path.join(root, 'bin/pixelbolt.js'), ...args], { cwd: root, encoding: 'utf8' });
const temp = async t => { const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-wave-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; };

test('coherent sources reinforce and cancel before colour mapping, including troughs', () => {
  const source = tiny();
  assert.ok(pixels(source).every(frame => frame.every(v => v === 0)), 'one weak source stays below threshold');
  source.effects.loop.sources.push(structuredClone(source.effects.loop.sources[0]));
  const combined = pixels(source);
  assert.equal(combined[0][3], 255, 'in-phase sources cross the threshold');
  assert.deepEqual([...combined[0].subarray(4 * 4, 4 * 5)], [255, 0, 0, 255], 'negative combined field uses the trough ramp');
  source.effects.loop.sources[1].phase = 180;
  assert.ok(pixels(source).every(frame => frame.every(v => v === 0)), 'opposite phases cancel below the palette threshold');
});

test('loop phase is independent of output duration and frame subdivision; reversal is symmetric', () => {
  const source = tiny(); source.effects.loop.look.thresholds = [0.04];
  const original = pixels(source);
  const slower = structuredClone(source); slower.effects.loop.duration = 120;
  assert.deepEqual(pixels(slower), original);
  const finer = structuredClone(source); finer.effects.loop.frames = 32;
  assert.deepEqual(pixels(finer).filter((_, i) => i % 2 === 0), original);
  const reversed = structuredClone(source); reversed.effects.loop.sources[0].cycles = -1;
  const backward = pixels(reversed);
  original.forEach((f, i) => assert.deepEqual(f, backward[(16 - i) % 16]));
  const result = compileWaves(source);
  assert.equal(result.recipe.animations.loop.loop, true);
  assert.equal(result.metadata.effects.loop.duration, 960);
});

test('a hard mask clips only the wave layer; decorations and returned frames remain editable', () => {
  const source = tiny(); source.effects.loop.sources[0].amplitude = 1;
  source.effects.loop.mask = { at: [0, 0], radius: [0.5, 0.5], feather: 0 };
  source.effects.loop.overlay = ['.......b', '........', '........', '........'];
  const before = JSON.stringify(source), { recipe, metadata } = compileWaves(source);
  const p = renderProject(recipe);
  assert.equal(p.frames[0].data[3], 255);
  assert.equal(p.frames[0].data[7 * 4 + 3], 255, 'overlay survives outside mask');
  assert.equal(p.frames[0].data[4 + 3], 0);
  assert.equal(metadata.effects.loop.visiblePixels[0], 1);
  recipe.frames[0].layers[1].ops[0].rows[0] = '........';
  assert.equal(recipe.frames[1].layers[1].ops[0].rows[0], '.......b');
  assert.equal(JSON.stringify(source), before);
  const transparent = tiny(); transparent.effects.loop.look = { colors: ['z'], thresholds: [0.01] };
  assert.ok(compileWaves(transparent).metadata.effects.loop.visiblePixels.every(n => n === 0));
});

test('bad and excessive inputs fail with useful paths before rendering', () => {
  const cases = [
    [s => s.width = 129, 'wave.width'],
    [s => s.effects.loop.frames = 129, 'wave.effects.loop.frames'],
    [s => s.effects.loop.sources = Array(5).fill(s.effects.loop.sources[0]), 'wave.effects.loop.sources'],
    [s => s.effects.loop.sources[0].cycles = 0.5, 'wave.effects.loop.sources[0].cycles'],
    [s => s.effects.loop.sources[0].amplitude = null, 'wave.effects.loop.sources[0].amplitude'],
    [s => s.effects.loop.sources[0].wavelength = NaN, 'wave.effects.loop.sources[0].wavelength'],
    [s => s.effects.loop.sources[0].stretch = [1, 1], 'wave.effects.loop.sources[0].stretch'],
    [s => { s.effects.loop.sources[0].kind = 'radial'; }, 'wave.effects.loop.sources[0].angle'],
    [s => s.effects.loop.mask = { at: [1, 1], radius: [0, 2] }, 'wave.effects.loop.mask.radius[0]'],
    [s => s.effects.loop.look.colors = ['?'], 'wave.effects.loop.look.colors[0]'],
    [s => s.effects.loop.look.thresholds = [0], 'wave.effects.loop.look.thresholds[0]'],
    [s => { s.effects.loop.look.colors = ['a', 'b']; delete s.effects.loop.look.negative; s.effects.loop.look.thresholds = [0.2, 0.2]; }, 'wave.effects.loop.look.thresholds[1]'],
    [s => s.effects.loop.loop = false, 'wave.effects.loop.loop'],
    [s => s.effects.Loop = s.effects.loop, 'wave.effects'],
    [s => s.effects.CON = s.effects.loop, 'wave.effects.CON'],
    [s => s.effects.loop.overlay = ['a'], 'wave.effects.loop.overlay'],
    [s => { s.effects.loop.frames = 128; s.effects.second = s.effects.loop; s.effects.third = s.effects.loop; }, 'wave.effects']
  ];
  for (const [edit, expected] of cases) {
    const s = tiny(); edit(s);
    assert.throws(() => compileWaves(s), error => error instanceof PixelError && error.path === expected, expected);
  }
});

test('schema and compiler agree on source kinds, effect controls and bounds', async () => {
  const schema = JSON.parse(await readFile(new URL('../wave.schema.json', import.meta.url), 'utf8'));
  const effect = schema.properties.effects.additionalProperties;
  assert.deepEqual(effect.properties.sources.items.oneOf.map(s => s.properties.kind.const), WAVE_KINDS);
  assert.equal(schema.properties.width.maximum, 128);
  assert.equal(effect.properties.frames.maximum, 128);
  assert.equal(effect.properties.sources.maxItems, 4);
  for (const key of [...Object.keys(effect.properties), 'notAField']) {
    const s = tiny(); s.effects.loop[key] ??= 0;
    let unknown = false;
    try { compileWaves(s); } catch (e) { unknown = e.message === `wave.effects.loop.${key}: unknown or null field`; }
    assert.equal(unknown, key === 'notAField', key);
  }
});

test('reviewed presets regenerate exactly and keep palette-only, byte-stable output', async () => {
  const expected = JSON.parse(await readFile(new URL('../showcase/waves/goldens.json', import.meta.url), 'utf8'));
  for (const [name, source] of Object.entries(wavePresets)) {
    const example = JSON.parse(await readFile(new URL(`../examples/${name}.wave.json`, import.meta.url), 'utf8'));
    assert.deepEqual(example, source);
    assert.equal(digest(example), expected[name]);
    assert.equal(digest(example), digest(example));
    const { recipe } = compileWaves(example);
    for (const frame of recipe.frames) for (const layer of frame.layers) for (const row of layer.ops[0].rows)
      for (const key of row) assert.ok(key === '.' || Object.hasOwn(example.palette, key));
  }
});

test('CLI compiles shared palettes without losing the source, refuses overwrites and shares ordinary grids', async t => {
  const dir = await temp(t), source = tiny();
  const palette = source.palette; source.palette = { $ref: 'palette.json' };
  await writeFile(path.join(dir, 'palette.json'), JSON.stringify(palette));
  await writeFile(path.join(dir, 'source.wave.json'), JSON.stringify(source));
  const out = path.join(dir, 'compiled.json');
  const run = cli('compile', path.join(dir, 'source.wave.json'), '--out', out);
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(result.palette.$ref, 'palette.json');
  assert.deepEqual(result.frames, compileWaves({ ...source, palette }).recipe.frames);
  assert.match(cli('compile', path.join(dir, 'source.wave.json'), '--out', out).stderr, /already exists/);
  assert.equal(cli('inspect', path.join(dir, 'source.wave.json')).status, 0);
  const inspection = cli('inspect', 'examples/interference.wave.json');
  assert.equal(inspection.status, 0, inspection.stderr);
  assert.ok(JSON.parse(inspection.stdout).warnings.some(warning => warning.includes('narrow waves')));
  assert.match(cli('inspect', path.join(dir, 'source.wave.json'), '--motion', 'loop').stderr, /inspect a wave without --motion/);
  const share = cli('share', path.join(dir, 'source.wave.json'));
  assert.equal(share.status, 0, share.stderr);
  const info = JSON.parse(share.stdout), decoded = await readShareLink(info.link);
  assert.equal(info.compiledFrom, 'pixelforge-wave');
  assert.equal(decoded.recipe.format, undefined);
  assert.deepEqual(decoded.recipe.frames, result.frames);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'source.wave.json'), 'utf8')), source);
});

test('studio keeps editable wave sources, serves their module and resolves only the given palette', async t => {
  const dir = await temp(t), source = tiny(), palette = source.palette;
  source.palette = { $ref: 'palette.json' };
  await writeFile(path.join(dir, 'palette.json'), JSON.stringify(palette));
  const { document } = await resolveReferences(source, { baseDir: dir });
  const server = await startStudio({ port: 0, quiet: true, project: document, source, sharedPalette: { $ref: 'palette.json', palette } });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await (await fetch(base + '/project.json')).json(), source);
  assert.match(await (await fetch(base + '/wave.js')).text(), /export function compileWaves/);
  assert.equal((await fetch(base + '/not-a-wave.js')).status, 404);
});

test('MCP compiles wave revisions and exposes the wave schema', async t => {
  const dir = await temp(t), input = new PassThrough(), output = new PassThrough(), waiting = new Map();
  let buffer = '', id = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) {
    const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)?.(message);
  } });
  startMCP({ input, output, root: dir, directory: dir }); t.after(() => input.end());
  const call = (method, params) => new Promise(resolve => { waiting.set(++id, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'wave-test', version: '1' } });
  const help = await call('tools/call', { name: 'pixel_help', arguments: { topic: 'wave' } });
  assert.equal(JSON.parse(help.result.content[0].text).title, 'Pixelbolt wave effects');
  const compiled = await call('tools/call', { name: 'pixel_compile', arguments: { source: tiny(), metadata: true } });
  const info = JSON.parse(compiled.result.content[0].text);
  assert.deepEqual([info.ok, info.frames, info.metadata.format], [true, 16, 'pixelforge-wave-metadata']);
  assert.match(info.revision, /^[a-f0-9]{12}$/);
});
