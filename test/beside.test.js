// Several recipes in one inspection image: `inspect --beside` and MCP pixel_inspect's `beside` draw the same view of
// each, one sheet under another, so variants (a sprite in three team colours) are compared with one look.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, inspectProject, stackViews, paletteUse, decodePNG } from '../src/index.js';
import { startMCP } from '../src/mcp.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const sprite = (name, color, width = 4) => ({ version: 1, name, width, height: 4, palette: { a: color }, frames: [{ name: 'one', ops: [{ op: 'rect', x: 0, y: 0, w: width, h: 4, color: 'a' }] }, { name: 'two', ops: [{ op: 'pixel', x: 1, y: 1, color: 'a' }] }] });
const pixel = (sheet, x, y) => [...sheet.data.subarray((y * sheet.width + x) * 4, (y * sheet.width + x) * 4 + 4)];

test('stacked views keep every sheet whole, each under the one before and under its name', () => {
  const views = [sprite('red', '#ff0000'), sprite('blue', '#0000ff', 8)].map(recipe => ({ ...inspectProject(renderProject(recipe), { scale: 2 }), name: recipe.name }));
  const [red, blue] = views.map(view => view.sheet), stacked = stackViews(views);
  // A band above each sheet holds its name.
  const band = stacked.stack[0].y;
  assert.ok(band >= 9 && band <= 16, `${band}`);
  assert.deepEqual([stacked.sheet.width, stacked.sheet.height], [Math.max(red.width, blue.width), red.height + blue.height + 2 * band]);
  assert.deepEqual(stacked.stack, [{ name: 'red', y: band, height: red.height }, { name: 'blue', y: 2 * band + red.height, height: blue.height }]);
  // Every pixel of each sheet is where the stack says, and what the narrower sheet leaves is the sheet's background.
  for (const [sheet, top] of [[red, band], [blue, 2 * band + red.height]]) for (let y = 0; y < sheet.height; y++) for (let x = 0; x < sheet.width; x++) assert.deepEqual(pixel(stacked.sheet, x, top + y), pixel(sheet, x, y));
  assert.deepEqual(pixel(stacked.sheet, stacked.sheet.width - 1, band), pixel(red, 0, 0));
  // The names are written in the bands, in a light colour on the sheet's background, and nowhere else in them.
  const lit = top => { let count = 0; for (let y = top; y < top + band; y++) for (let x = 0; x < stacked.sheet.width; x++) if (pixel(stacked.sheet, x, y)[0] > 200) count++; return count; };
  assert.ok(lit(0) > 12 && lit(band + red.height) > 16 && lit(band + red.height) > lit(0), `${lit(0)} ${lit(band + red.height)}`);
  assert.deepEqual([stacked.cells, stacked.name], [views[0].cells, undefined]);
});

test('inspect --beside and pixel_inspect beside draw the variants in one image and say where each starts', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-beside-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const files = {};
  for (const [name, color] of [['red', '#ff0000'], ['blue', '#0000ff'], ['green', '#00ff00']]) { files[name] = path.join(dir, `${name}.json`); await writeFile(files[name], JSON.stringify(sprite(name, color))); }
  const cli = (...args) => spawnSync(process.execPath, [path.join(root, 'bin/pixelbolt.js'), ...args], { encoding: 'utf8', cwd: dir });
  const out = path.join(dir, 'all.png'), made = cli('inspect', 'red.json', '--beside', 'blue.json,green.json', '--frames', 'one', '--scale', '2', '--out', 'all.png');
  assert.equal(made.status, 0, made.stderr + made.stdout);
  const reply = JSON.parse(made.stdout), alone = inspectProject(renderProject(sprite('red', '#ff0000')), { frames: ['one'], scale: 2 }).sheet;
  const band = reply.stack[0].y;
  assert.deepEqual(reply.stack, ['red.json', 'blue.json', 'green.json'].map((name, index) => ({ name, y: band + index * (band + alone.height), height: alone.height })));
  assert.deepEqual([reply.sheet.height, reply.cells], [(band + alone.height) * 3, ['one: 100 ms']]);
  const image = decodePNG(await readFile(out)), centre = index => pixel(image, alone.gap + 2, reply.stack[index].y + alone.gap + 2);
  assert.deepEqual([image.width, image.height, centre(0), centre(1), centre(2)], [reply.sheet.width, (band + alone.height) * 3, [255, 0, 0, 255], [0, 0, 255, 255], [0, 255, 0, 255]]);
  // What reads one recipe at a time is refused, and a file that is not there is named.
  const said = (...args) => { const result = cli(...args); assert.equal(result.status, 1); return result.stdout + result.stderr; };
  assert.match(said('inspect', 'red.json', '--beside', 'blue.json', '--grid'), /--beside draws several recipes in one sheet/);
  assert.match(said('inspect', 'red.json', '--beside', 'missing.json'), /missing\.json/);
  // A recipe that lacks the frame asked for is named, where the error named only the frame.
  await writeFile(path.join(dir, 'short.json'), JSON.stringify({ ...sprite('short', '#ffffff'), frames: sprite('short', '#ffffff').frames.slice(0, 1) }));
  assert.match(said('inspect', 'red.json', '--beside', 'short.json', '--frames', 'two'), /--beside short\.json: inspect\.frames\[0\]: unknown frame/);
  assert.match(said('inspect', 'red.json', '--beside', 'blue.json', '--motion', 'idle'), /--beside cannot be combined with --motion/);

  const input = new PassThrough(), output = new PassThrough(), waiting = new Map();
  let buffer = '', id = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)?.(message); } });
  startMCP({ input, output, root: dir, directory: path.join(dir, 'output') }); t.after(() => input.end());
  const call = (method, params) => new Promise(resolve => { waiting.set(++id, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'beside-test', version: '1' } });
  const tool = async (name, args) => { const result = (await call('tools/call', { name, arguments: args })).result; return { ...result, info: JSON.parse(result.content[0].text) }; };
  const blue = (await tool('pixel_validate', { project: sprite('blue', '#0000ff') })).info.revision, green = (await tool('pixel_validate', { project: sprite('green', '#00ff00') })).info.revision;
  const both = await tool('pixel_inspect', { project: sprite('red', '#ff0000'), beside: [blue, green], frames: ['one'], scale: 2 });
  assert.deepEqual(both.info.stack, [{ name: 'red', y: band, height: alone.height }, { name: `blue ${blue}`, y: 2 * band + alone.height, height: alone.height }, { name: `green ${green}`, y: 3 * band + alone.height * 2, height: alone.height }]);
  const picture = decodePNG(Buffer.from(both.content.find(item => item.type === 'image').data, 'base64'));
  assert.deepEqual(pixel(picture, alone.gap + 2, both.info.stack[2].y + alone.gap + 2), [0, 255, 0, 255]);
  const refused = await tool('pixel_inspect', { project: sprite('red', '#ff0000'), beside: ['nosuchrevision'] });
  assert.equal(refused.isError, true);
  // An option a tool lacks is named, with the options it has.
  const guessed = await call('tools/call', { name: 'pixel_inspect', arguments: { project: sprite('red', '#ff0000'), besides: [blue], colours: true } });
  assert.equal(guessed.error.code, -32602);
  assert.match(guessed.error.message, /^Invalid tool arguments: pixel_inspect has no option "besides", "colours"; its options are .*\bbeside\b.*\bpalette\b/);
});

test('the palette report says which keys colour which layers, ramps together, for a colour variant', async t => {
  const figure = { version: 1, name: 'figure', width: 6, height: 6, palette: { k: '#101010', a: '#802020', b: '#c04040', s: '#e0b090', x: '#00ff00', glass: '#4080ff80' }, ramps: [['a', 'b']],
    frames: [{ name: 'stand', layers: [
      { name: 'coat', ops: [{ op: 'rect', x: 0, y: 2, w: 4, h: 4, color: 'a' }, { op: 'rect', x: 1, y: 3, w: 2, h: 2, color: 'b' }] },
      { name: 'head', ops: [{ op: 'rect', x: 1, y: 0, w: 2, h: 2, color: 's' }, { op: 'pixel', x: 1, y: 0, color: 'k' }, { op: 'pixel', x: 2, y: 3, color: 'a' }] },
      { name: 'visor', ops: [{ op: 'pixel', x: 2, y: 0, color: 'glass' }] }] }] };
  const use = paletteUse(renderProject(figure, { owners: true }));
  // The coat's ramp dark to light with the layers each key colours, most first; then the rest by pixels; then what
  // draws nothing; a translucent key over another colour is a blend that no key names.
  assert.deepEqual(use, { ramps: [['a #802020: 13 px on coat, head', 'b #c04040: 3 px on coat']], others: ['s #e0b090: 2 px on head', 'k #101010: 1 px on head'], unused: ['x', 'glass'], blended: 1, layers: 'coat, head, visor', counted: 'every pixel of the one frame, whatever the view shows' });
  assert.throws(() => paletteUse(renderProject(figure)), /palette needs the project rendered with \{ owners: true \}/);
  // Two keys of one colour can't be told apart in the pixels: the first is counted, and `same` says so.
  const twin = paletteUse(renderProject({ ...figure, palette: { ...figure.palette, x: '#802020' } }, { owners: true }));
  assert.deepEqual([twin.same, twin.unused, twin.ramps], [['x is the colour of a, and counted there'], ['glass'], use.ramps]);
  // A key may hold a space, and is still named once (it was listed under `same` and under `unused` too).
  const spaced = paletteUse(renderProject({ ...figure, palette: { ...figure.palette, 'dark red': '#802020' } }, { owners: true }));
  assert.deepEqual([spaced.same, spaced.unused], [['dark red is the colour of a, and counted there'], ['x', 'glass']]);
  // A recipe without ramps lists its keys under `keys`.
  assert.deepEqual(Object.keys(paletteUse(renderProject({ ...figure, ramps: undefined }, { owners: true }))), ['keys', 'unused', 'blended', 'layers', 'counted']);
  // inspect --palette and pixel_inspect palette carry it.
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-palette-')); t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'figure.json'), JSON.stringify(figure));
  const made = spawnSync(process.execPath, [path.join(root, 'bin/pixelbolt.js'), 'inspect', 'figure.json', '--palette'], { encoding: 'utf8', cwd: dir });
  assert.deepEqual(JSON.parse(made.stdout).palette, use, made.stderr);
  const input = new PassThrough(), output = new PassThrough(), waiting = new Map();
  let buffer = '', id = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)?.(message); } });
  startMCP({ input, output, root: dir, directory: path.join(dir, 'output') }); t.after(() => input.end());
  const call = (method, params) => new Promise(resolve => { waiting.set(++id, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'palette-test', version: '1' } });
  const inspected = (await call('tools/call', { name: 'pixel_inspect', arguments: { project: figure, palette: true } })).result;
  assert.deepEqual(JSON.parse(inspected.content[0].text).palette, use);
  assert.equal(JSON.parse((await call('tools/call', { name: 'pixel_inspect', arguments: { project: figure } })).result.content[0].text).palette, undefined);
});
