import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, PixelError } from '../src/core.js';
import { compileNormals, NORMAL_DIRECTIONS } from '../src/authoring.js';
import { prepareScene, renderScene } from '../src/scene.js';
import { resolveReferences } from '../src/resolve.js';
import { startMCP } from '../src/mcp.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = async (t, label) => {
  const base = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(base, `pixelbolt-${label}-`));
  t.after(async () => { assert.ok(dir.startsWith(base + path.sep)); await rm(dir, { recursive: true, force: true }); });
  return dir;
};
// A disc with a transparent margin: the canvas border is not an edge, so shapes that should round need room.
const disc = (size, key = 'k') => Array.from({ length: size + 2 }, (_, y) => Array.from({ length: size + 2 }, (_, x) => { const dx = x - (size + 1) / 2, dy = y - (size + 1) / 2; return dx * dx + dy * dy <= (size / 2) ** 2 ? key : '.'; }).join(''));
const recipe = (rows, extra = {}) => ({ version: 1, name: 'shape', width: rows[0].length, height: rows.length, palette: { k: '#808080', l: '#f0f0f0', d: '#202020' }, frames: [{ name: 'a', ops: [{ op: 'grid', rows }] }], ...extra });
const derive = (spec, options = {}) => compileNormals({ format: 'pixelforge-normals', version: 1, recipe: spec, ...options });
const rowsOf = (compiled, frame = 0) => compiled.recipe.frames[frame].ops[0].rows;

test('a generated pass rounds a shape: rims lean outward, the middle faces the viewer, and keys encode their directions', () => {
  const compiled = derive(recipe(disc(15))), rows = rowsOf(compiled), middle = rows[8];
  assert.equal(middle[8], '5');
  assert.equal(middle[1], 'a'); assert.equal(middle[15], 'd'); assert.equal(rows[1][8], 'w'); assert.equal(rows[15][8], 'x');
  // Diagonal rims lean diagonally, and the keypad digits ring the facing middle.
  assert.equal(rows[3][3], 'q'); assert.equal(rows[13][13], 'c');
  assert.ok(middle.slice(2, 8).includes('4') && middle.slice(9, 15).includes('6'), middle);
  // Transparent pixels stay transparent: the pass covers exactly the colour silhouette.
  rows.forEach((row, y) => assert.equal(row.replace(/[^.]/g, '#'), disc(15)[y].replace(/[^.]/g, '#')));
  // Every direction is a unit vector and is in the palette, so a hand fix can use any of them.
  assert.equal(Object.keys(compiled.recipe.palette).length, 17);
  for (const [key, vector] of Object.entries(NORMAL_DIRECTIONS)) assert.ok(Math.abs(Math.hypot(...vector) - 1) < 1e-12, key);
  assert.equal(compiled.recipe.palette['5'], '#8080ff');
  const decode = key => compiled.recipe.palette[key].slice(1).match(/../g).map(hex => parseInt(hex, 16) / 127.5 - 1);
  assert.ok(decode('a')[0] < -0.8 && decode('d')[0] > 0.8 && decode('w')[1] < -0.8 && decode('x')[1] > 0.8 && decode('8')[1] < -0.4);
  assert.deepEqual(derive(recipe(disc(15))), compiled, 'deterministic');
  assert.equal(compiled.recipe.name, 'shape-normal');
  assert.deepEqual(compiled.metadata.pixels, Object.fromEntries(Object.keys(NORMAL_DIRECTIONS).map(key => [key, rows.join('').split(key).length - 1]).filter(([, n]) => n)));
});

test('the pass lines up with its colour recipe in a scene, and lights each side toward the light', () => {
  const colour = { ...recipe(disc(12)), frames: [{ name: 'a', duration: 120, ops: [{ op: 'grid', rows: disc(12) }] }, { name: 'b', ops: [{ op: 'grid', x: 1, rows: disc(10) }] }],
    animations: { idle: { frames: ['a', 'b'] } }, sheet: { trim: true, columns: 2 } };
  const { recipe: normal } = derive(colour);
  assert.deepEqual(renderProject(normal).frames.map(f => [f.name, f.duration]), [['a', 120], ['b', 100]]);
  const lit = x => {
    const scene = { format: 'pixelforge-scene', version: 1, name: 'lit', width: 12, height: 12, assets: { ball: { recipe: colour, normal } }, instances: [{ asset: 'ball', at: [0, 0], frame: 'a' }], lighting: { ambient: 0.1, bands: 16, lights: [{ at: [x, 6], height: 6, radius: 64 }] } };
    const { data } = renderScene(prepareScene(scene));
    return y => [1, 10].map(px => data[(y * 12 + px) * 4]);
  };
  const [left, right] = lit(-20)(6), [leftAfter, rightAfter] = lit(32)(6);
  assert.ok(left > right && rightAfter > leftAfter, JSON.stringify({ left, right, leftAfter, rightAfter }));
});

test('each separate shape rounds on its own; bevel flattens the top; mirrored frames get mirrored normals', () => {
  const pair = ['............', '.kkk........', '.kkk.kkkkkk.', '.kkk.kkkkkk.', '.....kkkkkk.', '.....kkkkkk.', '.....kkkkkk.', '.....kkkkkk.', '............'];
  const rows = rowsOf(derive(recipe(pair)));
  assert.equal(rows[2][2], '5', 'the small square has its own facing middle');
  assert.ok(['5', '2', '6', '3'].includes(rows[4][7]) && rows[2][5] === 'q', rows.join('\n'));
  const block = Array.from({ length: 12 }, () => 'k'.repeat(12)).map((row, y) => y === 0 || y === 11 ? '.'.repeat(12) : `.${row.slice(2)}.`);
  const flat = rowsOf(derive(recipe(block), { bevel: 1 })), round = rowsOf(derive(recipe(block)));
  assert.equal(flat[5].slice(3, 9), '555555');
  assert.notEqual(round[5].slice(3, 9), '555555');
  // A frame drawn mirrored has its pixels mirrored and its left/right leanings swapped.
  const lopsided = ['kkkkk...', 'kkkkkkk.', 'kkkkkkkk', 'kkkkk...', 'kkk.....'];
  const mirrored = derive({ ...recipe(lopsided), frames: [{ name: 'a', ops: [{ op: 'grid', rows: lopsided }] }, { name: 'b', from: 'a', flipX: true }] });
  const swap = { 7: '9', 9: '7', 4: '6', 6: '4', 1: '3', 3: '1', q: 'e', e: 'q', a: 'd', d: 'a', z: 'c', c: 'z' };
  assert.deepEqual(rowsOf(mirrored, 1), rowsOf(mirrored, 0).map(row => [...row].reverse().map(key => swap[key] ?? key).join('')));
});

test('detail raises lighter colours, ramps keep materials level, and the canvas border is not an edge unless frames wrap', () => {
  const tile = Array.from({ length: 6 }, () => 'kkllkk');
  assert.deepEqual(rowsOf(derive(recipe(tile), { detail: 0 })), Array(6).fill('555555'), 'a filled tile is flat');
  const raised = rowsOf(derive(recipe(tile), { detail: 1 }));
  assert.equal(raised[3], '544665', 'the stripe stands out: pixels on and beside its edges lean away from it');
  // Two materials at the same step of their own ramps are level, however different their brightness.
  const paint = Array.from({ length: 6 }, () => 'aaabbb'), palette = { a: '#f0f0f0', b: '#203060', c: '#a0a0a0', e: '#101830' };
  const level = { version: 1, name: 'paint', width: 6, height: 6, palette, ramps: [['c', 'a'], ['e', 'b']], frames: [{ name: 'f', ops: [{ op: 'grid', rows: paint }] }] };
  assert.deepEqual(rowsOf(derive(level, { detail: 1 })), Array(6).fill('555555'));
  assert.notDeepEqual(rowsOf(derive({ ...level, ramps: undefined }, { detail: 1 })), Array(6).fill('555555'));
  // A wrapping tile reads its slopes across the border, so tiles placed side by side stay seamless.
  const groove = Array.from({ length: 6 }, () => 'dkkkkk');
  const open = rowsOf(derive(recipe(groove), { detail: 1 })), wrapped = rowsOf(derive({ ...recipe(groove), frames: [{ name: 'a', wrap: true, ops: [{ op: 'grid', rows: groove }] }] }, { detail: 1 }));
  assert.equal(open[2][5], '5'); assert.equal(wrapped[2][5], '6');
});

test('normals sources are validated with paths', () => {
  const ok = recipe(disc(5));
  for (const [source, where, message] of [
    [{ format: 'pixelforge-poses', version: 1, recipe: ok }, 'normals', /pixelforge-normals/],
    [{ format: 'pixelforge-normals', version: 1, recipe: ok, depth: 2 }, 'normals.depth', /unknown/],
    [{ format: 'pixelforge-normals', version: 1, recipe: 'shape.json' }, 'normals.recipe', /resolved by the CLI and MCP/],
    [{ format: 'pixelforge-normals', version: 1, recipe: { revision: 'abcdefabcdef' } }, 'normals.recipe', /resolved by the CLI and MCP/],
    [{ format: 'pixelforge-normals', version: 1 }, 'normals.recipe', /colour recipe/],
    [{ format: 'pixelforge-normals', version: 1, recipe: { format: 'pixelforge-fx', version: 1 } }, 'normals.recipe', /compile it first/],
    [{ format: 'pixelforge-normals', version: 1, recipe: ok, bevel: 0 }, 'normals.bevel', /1–64/],
    [{ format: 'pixelforge-normals', version: 1, recipe: ok, bevel: 2.5 }, 'normals.bevel', /1–64/],
    [{ format: 'pixelforge-normals', version: 1, recipe: ok, detail: 1.5 }, 'normals.detail', /0 \(shape only\) to 1/],
    [{ format: 'pixelforge-normals', version: 1, recipe: { ...ok, name: 'n'.repeat(60) } }, 'normals.name', /exceed 64 characters/],
    [{ format: 'pixelforge-normals', version: 1, recipe: { ...ok, width: 0 } }, 'project.width', /./]
  ]) assert.throws(() => compileNormals(source), error => error instanceof PixelError && error.path === where && message.test(error.message), `${where}: ${JSON.stringify(source).slice(0, 80)}`);
});

test('the normals schema lists exactly the fields the compiler accepts', async () => {
  const schema = JSON.parse(await readFile(path.join(root, 'normals.schema.json'), 'utf8'));
  const base = { format: 'pixelforge-normals', version: 1, recipe: recipe(disc(5)) }, values = { name: 'ball-normal', bevel: 2, detail: 0.3 };
  for (const key of Object.keys(schema.properties)) assert.doesNotThrow(() => compileNormals({ ...base, ...(key in values && { [key]: values[key] }) }), key);
  assert.throws(() => compileNormals({ ...base, notAField: 1 }), /unknown or null field/);
  assert.deepEqual(schema.required, ['format', 'version', 'recipe']);
});

test('the CLI compiles a normals source whose recipe file sits beside it, keeping the colour palette link out of the pass', async t => {
  const dir = await temp(t, 'normals');
  await mkdir(path.join(dir, 'art'));
  await writeFile(path.join(dir, 'palette.json'), JSON.stringify({ k: '#808080' }));
  await writeFile(path.join(dir, 'art', 'ball.json'), JSON.stringify({ ...recipe(disc(9)), name: 'ball', palette: { $ref: '../palette.json' } }));
  await writeFile(path.join(dir, 'art', 'ball.normals.json'), JSON.stringify({ format: 'pixelforge-normals', version: 1, recipe: 'ball.json', bevel: 3 }));
  const run = (...args) => spawnSync(process.execPath, ['bin/pixelbolt.js', ...args], { cwd: root, encoding: 'utf8' });
  const out = path.join(dir, 'art', 'ball-normal.json'), meta = path.join(dir, 'art', 'ball-normal.meta.json');
  const compiled = run('compile', path.join(dir, 'art', 'ball.normals.json'), '--out', out, '--metadata', meta);
  assert.equal(compiled.status, 0, compiled.stderr);
  const result = JSON.parse(compiled.stdout), normal = JSON.parse(await readFile(out, 'utf8'));
  assert.deepEqual([JSON.parse(await readFile(meta, 'utf8')).bevel, result.resolved.map(file => path.basename(file)).sort()], [3, ['ball.json', 'palette.json']]);
  assert.equal(normal.name, 'ball-normal'); assert.equal(normal.palette.$ref, undefined); assert.equal(normal.palette['5'], '#8080ff');
  assert.match(JSON.parse(run('compile', path.join(dir, 'art', 'ball.normals.json'), '--out', out).stderr).error, /already exists/);
  // The scene accepts the written pass as the colour recipe's normal.
  await writeFile(path.join(dir, 'art', 'lit.scene.json'), JSON.stringify({ format: 'pixelforge-scene', version: 1, name: 'lit', width: 9, height: 9, assets: { ball: { recipe: 'ball.json', normal: 'ball-normal.json' } }, instances: [{ asset: 'ball', at: [0, 0] }], lighting: { lights: [{ at: [0, 0] }] } }));
  const { document } = await resolveReferences(JSON.parse(await readFile(path.join(dir, 'art', 'lit.scene.json'), 'utf8')), { baseDir: path.join(dir, 'art') });
  assert.doesNotThrow(() => prepareScene(document));
});

test('MCP compiles a normals source from a saved revision and explains the normals topic', async t => {
  const dir = await temp(t, 'normals-mcp'), input = new PassThrough(), output = new PassThrough(), waiting = new Map();
  let buffer = '', next = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)?.(message); } });
  const running = startMCP({ input, output, directory: dir, root: dir });
  const request = (method, params) => new Promise(resolve => { waiting.set(++next, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n'); });
  const call = async (name, args) => { const result = (await request('tools/call', { name, arguments: args })).result; return { result, info: JSON.parse(result.content[0].text) }; };
  await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  const saved = await call('pixel_validate', { project: recipe(disc(9)) });
  const compiled = await call('pixel_compile', { source: { format: 'pixelforge-normals', version: 1, recipe: { revision: saved.info.revision } }, metadata: true });
  assert.ok(!compiled.result.isError, JSON.stringify(compiled.info));
  assert.deepEqual([compiled.info.name, compiled.info.frames, compiled.info.metadata.detail], ['shape-normal', 1, 0]);
  assert.equal(compiled.result.content[1].mimeType, 'image/png');
  const topic = (await request('tools/call', { name: 'pixel_help', arguments: { topic: 'normals' } })).result;
  assert.equal(JSON.parse(topic.content[0].text).title, 'Pixelbolt normal pass');
  input.end(); await running;
});

test('the bundled spirit normal pass is what its source compiles to, and its night scene lights it', async () => {
  const examples = path.join(root, 'examples'), read = async file => JSON.parse(await readFile(path.join(examples, file), 'utf8'));
  const { document } = await resolveReferences(await read('forest-spirit.normals.json'), { baseDir: examples });
  assert.deepEqual(compileNormals(document).recipe, await read('forest-spirit-normal.json'));
  const scene = prepareScene((await resolveReferences(await read('forest-spirit-lit.scene.json'), { baseDir: examples })).document);
  assert.notDeepEqual(renderScene(scene).data, renderScene(scene, { lit: false }).data);
});
