import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileAutotile } from '../src/authoring.js';
import { renderProject } from '../src/core.js';
import { neighbourMask, BLOB_MASKS } from '../src/autotile.js';
import { readTerrain, drawTerrain, terrainTemplate, templateSeams, TEST_MAP } from '../src/terrain.js';
import { startMCP } from '../src/mcp.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const example = async name => JSON.parse(await readFile(path.join(root, 'examples', `${name}.autotile.json`), 'utf8'));
const palette = { k: '#1b1528', g: '#4a9a4a', G: '#6cbf4a', d: '#2f6f3a', L: '#9be06a', s: '#00000055', b: '#3a7a2a', y: '#ffd166', u: '#7a5534' };
const source = (extra = {}) => ({ format: 'pixelforge-autotile', version: 1, name: 'turf', tile: 16, palette, frame: 'turf-{mask}', ...extra });
const turf = { seed: 3, fill: { color: 'g', speckle: [{ color: 'd', amount: 0.15, size: 3 }, { color: 'G', amount: 0.1, size: 2 }] },
  edges: { all: { depth: 2, jitter: 1, bands: ['k'] }, n: { bands: ['k', 'L'], tufts: { colors: ['b', 'G'], amount: 0.5 } }, s: { depth: 3, bands: ['k', 'd'], outside: ['s'] } }, round: 2, inner: 1 };
const small = { fill: 'g', edges: { all: { depth: 1, bands: ['k'] }, n: { tufts: { colors: ['b'] } }, s: { outside: ['s'] } }, round: 1, inner: 1 };
const draw = (rows, ops = [{ op: 'stamp', symbol: 'r' }]) => renderProject({ version: 1, name: 'm', width: rows[0].length, height: rows.length, palette, symbols: { r: rows }, frames: [{ name: 'm', ops }] }).frames[0].data;
const tiled = (template, map, tile, mode = 'blob') => draw(template, [{ op: 'tilemap', tile: [tile, tile], rows: map, legend: { '#': { template: 'r', autotile: mode } } }]).subarray(0);
// Seeded maps of scattered terrain, so islands, lakes, strips and corner-only touches all turn up.
function maps(count, size, seed) {
  let state = seed; const next = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({ length: count }, () => Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => (x && y && x < size - 1 && y < size - 1 && next() < 0.62 ? '#' : '.')).join('')));
}

test('a terrain draws a template whose tiles, stitched into any map, are the terrain drawn directly', () => {
  for (const [spec, tile, map] of [[turf, 16, maps(3, 12, 5)], [small, 8, [TEST_MAP, ...maps(2, 16, 9)]]]) {
    const rows = terrainTemplate(spec, { tile, palette }), drawn = readTerrain(spec, { tile, palette });
    assert.deepEqual([rows.length, rows[0].length], [tile * 3, tile * 2]);
    for (const rowsOfMap of map) {
      const width = rowsOfMap[0].length * tile, direct = drawTerrain(drawn, rowsOfMap);
      const stitched = renderProject({ version: 1, name: 'm', width, height: rowsOfMap.length * tile, palette, symbols: { template: rows }, frames: [{ name: 'm', ops: [{ op: 'tilemap', tile: [tile, tile], rows: rowsOfMap, legend: { '#': { template: 'template', autotile: 'blob' } } }] }] }).frames[0].data;
      assert.deepEqual([...stitched], [...draw(direct)], `tile ${tile}: ${rowsOfMap.join('/')}`);
    }
    const compiled = compileAutotile(source({ tile, terrain: spec }));
    assert.equal(compiled.warnings, undefined);
    assert.deepEqual(compiled.metadata.seams, { joins: 68, shape: 0, texture: 0 });
    assert.deepEqual(compiled.recipe.symbols.template, rows);
  }
  // The same description always draws the same pixels.
  assert.deepEqual(terrainTemplate(turf, { tile: 16, palette }), terrainTemplate(structuredClone(turf), { tile: 16, palette }));
});

test('the example terrains compile without seam warnings to their reviewed pixels', async () => {
  // Regenerate these deliberately: they change with any change to what a terrain draws.
  const golden = { meadow: ['50d70244be8c4db2', 188], ground: ['dee3cfbdbc75e79e', 141] };
  for (const [name, [hash, frames]] of Object.entries(golden)) {
    const compiled = compileAutotile(await example(name));
    assert.equal(compiled.warnings, undefined, name);
    assert.equal(compiled.recipe.frames.length, frames);
    assert.equal(createHash('sha256').update(JSON.stringify(compiled.recipe.symbols)).digest('hex').slice(0, 16), hash, name);
  }
});

test('the seam check names the pixels where hand-drawn template quarters do not meet', () => {
  const rows = terrainTemplate(turf, { tile: 16, palette }), edit = (from, changes) => from.map((row, y) => [...row].map((char, x) => changes[`${x},${y}`] ?? char).join(''));
  // Drawn as rows, a repeating template passes.
  assert.equal(compileAutotile(source({ template: rows })).warnings, undefined);
  // A top edge that does not repeat: the island's right tile has its top strip a row lower than its left tile, so the
  // outline jumps wherever a tile stitches one beside the other.
  const lowered = rows.map((row, y) => (y >= 16 && y < 24 ? row.slice(0, 16) + (y === 16 ? '.'.repeat(16) : rows[y - 1].slice(16)) : row));
  const top = compileAutotile(source({ template: lowered })).warnings.filter(text => text.startsWith('Seam in'));
  assert.ok(top.some(text => /the 8×8 quarter at \[8, 16\] is stitched right of the one at \[16, 16\]/.test(text) && /Make \[8, \d+\] match \[24, \d+\]/.test(text)), top.join('\n'));
  assert.equal(edit(rows, {}).join(), rows.join());
  // An inner-corner tile without its notches.
  const filled = rows.map((row, y) => (y < 16 ? row.slice(0, 16) + 'g'.repeat(16) : row));
  const corner = compileAutotile(source({ template: filled })).warnings;
  assert.ok(corner.some(text => /Seam in tiles with masks .*quarter at \[(1[6-9]|2\d|3[01]), \d+\]/.test(text) && text.includes('inner-corner tile')), corner.join('\n'));
  // A fill that does not repeat every tile is texture, reported once.
  const stripes = rows.map((row, y) => [...row].map((char, x) => (char === 'g' && (x + y) % 5 === 0 ? 'd' : char)).join(''));
  const texture = compileAutotile(source({ template: stripes })).warnings;
  assert.equal(texture.filter(text => text.startsWith('Texture')).length, 1);
  assert.match(texture.at(-1), /quarter joins do not continue the template/);
});

test('ops draw over a terrain, and only the seams they make are reported', () => {
  const symbols = { rock: ['yy', 'yy'] };
  // Inside one quarter of the island's middle, or across its middle lines (tile borders in any map): no seam.
  for (const x of [10, 15]) {
    const inside = compileAutotile(source({ terrain: turf, symbols, ops: [{ op: 'stamp', symbol: 'rock', x, y: 26 }] }));
    assert.equal(inside.warnings, undefined, `rock at ${x}`);
    assert.equal(inside.recipe.symbols.template[26].slice(x, x + 2), 'yy');
    assert.equal(inside.recipe.symbols.rock, undefined);
  }
  // Across a quarter line inside a tile, the rock is cut wherever those quarters are stitched apart.
  const across = compileAutotile(source({ terrain: turf, symbols, ops: [{ op: 'stamp', symbol: 'rock', x: 7, y: 26 }] })).warnings ?? [];
  assert.ok(across.some(text => text.startsWith('Texture')), across.join('\n'));
  // Ops alone draw on a clear template; their errors carry the source's paths.
  assert.equal(compileAutotile(source({ ops: [{ op: 'rect', x: 0, y: 16, w: 32, h: 32, color: 'g' }] })).recipe.symbols.template[20], 'g'.repeat(32));
  assert.throws(() => compileAutotile(source({ terrain: turf, ops: [{ op: 'rect', x: 0, y: 0, w: 2, h: 2, color: 'nope' }] })), /autotile\.ops\[0\]\.color/);
  assert.throws(() => compileAutotile(source({ terrain: turf, ops: [{ op: 'pixel', x: 1, y: 1, color: '#123456' }] })), /autotile\.ops: drew #123456ff at \[1, 1\], a colour no one-character palette key names/);
  assert.throws(() => compileAutotile(source({ terrain: turf, symbols: { template: ['g'] } })), /autotile\.symbols\.template: template and template-<variant> name the compiled templates/);
});

test('variants change the terrain field by field, keep its edges and add their own ops', () => {
  const compiled = compileAutotile(source({ terrain: turf, frame: 'turf-{mask}-{variant}', symbols: { rock: ['yy'] }, ops: [{ op: 'stamp', symbol: 'rock', x: 9, y: 25 }],
    variants: [{ name: 'a' }, { name: 'b', terrain: { fill: { seed: 8 } } }, { name: 'c', ops: [{ op: 'stamp', symbol: 'rock', x: 20, y: 36 }] }] }));
  assert.equal(compiled.warnings, undefined);
  const { template, 'template-b': b, 'template-c': c } = compiled.recipe.symbols;
  assert.notDeepEqual(b, template);
  // Another fill seed changes only the inside: every clear pixel and every edge colour stays.
  const clear = rows => rows.map(row => row.replace(/[^.]/g, '#'));
  assert.deepEqual(clear(b), clear(template));
  assert.equal(b.join('').split('k').length, template.join('').split('k').length);
  assert.deepEqual([b[25].slice(9, 11), c[25].slice(9, 11), c[36].slice(20, 22)], ['yy', 'yy', 'yy']);
  assert.deepEqual(compiled.recipe.frames.slice(0, 3).map(frame => frame.ops[0].symbol), ['template', 'template-b', 'template-c']);
  assert.throws(() => compileAutotile(source({ template: terrainTemplate(turf, { tile: 16, palette }), frame: 'x-{mask}-{variant}', variants: [{ name: 'a', terrain: { seed: 1 } }] })), /variants\[0\]\.terrain: a variant's terrain changes the set's terrain/);
});

test('terrain mistakes name their path and what fits', () => {
  assert.throws(() => compileAutotile(source({ tile: 8, terrain: turf })), /autotile\.terrain\.edges\.n: depth 2 \(from edges\.all\) \+ jitter 1 \(from edges\.all\) \+ 2 bands \+ round 2 is 7 pixels, but an edge has to fit in half a tile \(4 pixels\)/);
  assert.throws(() => compileAutotile(source({ terrain: { fill: 'g', edges: { all: { bands: ['Q'] } } } })), /autotile\.terrain\.edges\.all\.bands\[0\]: "Q" is not in the palette/);
  assert.throws(() => compileAutotile(source({ terrain: { fill: 'g', edges: { top: {} } } })), /autotile\.terrain\.edges\.top: unknown or null field/);
  assert.throws(() => compileAutotile(source({ terrain: { fill: { pattern: ['g'] } } })), /autotile\.terrain\.fill\.pattern: expected 16 rows of 16 characters/);
  assert.throws(() => compileAutotile(source({ terrain: turf, template: ['g'] })), /autotile\.terrain: give template rows or a terrain to draw them, not both/);
  assert.throws(() => compileAutotile(source()), /autotile\.template: give template rows \(48 rows of 32 characters\), a terrain to draw them, or ops/);
  // A hand-typed template names every row of the wrong width.
  const rows = Array.from({ length: 48 }, (_, y) => 'g'.repeat(y === 3 || y === 9 ? 31 : 32));
  assert.throws(() => compileAutotile(source({ template: rows })), /autotile\.template: expected 48 rows of 32 characters \(two tiles wide, three tall\): row 3 has 31, row 9 has 31/);
  // A pattern fill repeats exactly as given.
  const pattern = Array.from({ length: 16 }, (_, y) => (y % 2 ? 'gd' : 'dg').repeat(8));
  const patterned = terrainTemplate({ fill: { pattern } }, { tile: 16, palette });
  assert.equal(patterned[16 + 5].slice(0, 16), pattern[5]);
});

test('a cardinal set reports only the inner corners it cannot turn', () => {
  const edged = compileAutotile(source({ mode: 'cardinal', terrain: turf })).warnings;
  assert.equal(edged.length, 1);
  assert.match(edged[0], /^Inner corners: a cardinal set has no inner-corner tiles/);
  assert.equal(compileAutotile(source({ mode: 'cardinal', terrain: { fill: 'g' } })).warnings, undefined);
  assert.equal(templateSeams({ template: terrainTemplate({ fill: 'g' }, { tile: 8, palette, mode: 'cardinal' }) }, 8, 'cardinal').seams.length, 0);
});

test('the test map shows every tile, on the preview background', () => {
  const at = (x, y) => TEST_MAP[y]?.[x] === '#', masks = mode => new Set(TEST_MAP.flatMap((row, y) => [...row].flatMap((char, x) => (char === '#' ? [neighbourMask(mode, (dx, dy) => at(x + dx, y + dy))] : []))));
  assert.deepEqual([...masks('blob')].sort((a, b) => a - b), [...BLOB_MASKS]);
  assert.equal(masks('cardinal').size, 16);
  const compiled = compileAutotile(source({ terrain: small, tile: 8, preview: { background: 'u' } }));
  const project = renderProject(compiled.preview), data = project.frames[0].data;
  assert.deepEqual([project.width, project.height], [TEST_MAP[0].length * 8, TEST_MAP.length * 8]);
  assert.deepEqual([...data.subarray(0, 4)], [0x7a, 0x55, 0x34, 255]);
  // Without a background the ground stays clear; variants with templates of their own mix in.
  const mixed = compileAutotile(source({ terrain: small, tile: 8, frame: 'v-{mask}-{variant}', variants: [{ name: 'a' }, { name: 'b', terrain: { fill: 'd' } }] })).preview;
  assert.deepEqual(mixed.frames[0].ops.map(op => op.op), ['tilemap']);
  assert.deepEqual(mixed.frames[0].ops[0].legend['#'], { templates: ['template', 'template-b'], autotile: 'blob' });
  assert.throws(() => compileAutotile(source({ terrain: small, preview: { background: 'nope' } })), /autotile\.preview\.background/);
  // The largest tile whose template fits a symbol still gets a test map within the size of a still.
  const big = compileAutotile(source({ tile: 84, template: Array.from({ length: 252 }, () => 'g'.repeat(168)) }));
  assert.deepEqual([big.preview.width, big.preview.height], [1680, 1176]);
  assert.throws(() => compileAutotile(source({ tile: 86, template: [] })), /autotile\.tile: expected an even tile size from 2 to 84/);
});

test('CLI autotile writes the test map with --preview and suggests it otherwise', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-terrain-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cli = (...args) => spawnSync(process.execPath, [path.join(root, 'bin/pixelbolt.js'), ...args], { encoding: 'utf8' });
  const meadow = path.join(root, 'examples/meadow.autotile.json');
  const run = cli('autotile', meadow, '--out', path.join(dir, 'meadow.json'), '--preview', path.join(dir, 'meadow-map.png'));
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const reply = JSON.parse(run.stdout);
  assert.equal(reply.preview, path.join(dir, 'meadow-map.png'));
  assert.equal(reply.warnings, undefined);
  const png = await readFile(reply.preview);
  assert.deepEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47]);
  // A test map at twice the size: 768 pixels across fits two of its 320.
  assert.equal(png.readUInt32BE(16) >= TEST_MAP[0].length * 16 * 2, true);
  const plain = JSON.parse(cli('compile', meadow, '--out', path.join(dir, 'again.json')).stdout);
  assert.match(plain.hint, /--preview <new\.png> to see every tile in a test map/);
  const refused = cli('compile', path.join(root, 'examples/swing.poses.json'), '--out', path.join(dir, 'p.json'), '--preview', path.join(dir, 'p.png'));
  assert.equal(refused.status, 1);
  assert.match(refused.stdout + refused.stderr, /--preview draws an autotile set over a test map; this source is not an autotile set/);
});

test('MCP pixel_compile returns an autotile set with its test map', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-terrain-mcp-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const input = new PassThrough(), output = new PassThrough(), waiting = new Map(); let buffer = '', next = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)?.(message); } });
  startMCP({ input, output, directory: dir, root: dir });
  t.after(() => input.end());
  const request = (method, params) => new Promise(resolve => { waiting.set(++next, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n'); });
  await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  const compiled = (await request('tools/call', { name: 'pixel_compile', arguments: { source: await example('ground'), metadata: true } })).result;
  const info = JSON.parse(compiled.content[0].text);
  assert.deepEqual([info.ok, info.frames, info.warnings, info.metadata.seams.shape], [true, 141, [], 0]);
  assert.match(info.testMap, /second image/);
  assert.deepEqual(compiled.content.map(item => item.type), ['text', 'image', 'image']);
  // Other sources keep one image.
  const help = JSON.parse((await request('tools/call', { name: 'pixel_help', arguments: { topic: 'autotile' } })).result.content[0].text);
  assert.ok(help.properties.terrain && help.properties.ops);
});
