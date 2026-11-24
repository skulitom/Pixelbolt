// Exports that took a detour before: every file enlarged (render --scale), a sprite with its normal map and the Godot
// CanvasTexture that lights it (render --normal), a whole scene as one GIF (gif <scene>), a two-terrain tile set drawn
// as a map of the caller's own, and a normal pass rounded as a cylinder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, decodePNG, compileNormals, compileAutotile, prepareScene, renderScene, sceneGIF } from '../src/index.js';
import { createSceneBundle } from '../src/scene-export.js';
import { tilemapOf } from '../src/autotile.js';
import { decodeGIF } from './fixtures/decode-gif.js';
import { startMCP } from '../src/mcp.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const sprite = { version: 1, name: 'lamp', width: 8, height: 8, palette: { a: '#c08040', b: '#ffe080' },
  frames: [{ name: 'dim', ops: [{ op: 'rect', x: 2, y: 1, w: 4, h: 6, color: 'a' }] }, { name: 'lit', ops: [{ op: 'rect', x: 2, y: 1, w: 4, h: 6, color: 'b' }] }], animations: { glow: { frames: ['dim', 'lit'] } } };
const client = (t, dir) => {
  const input = new PassThrough(), output = new PassThrough(), waiting = new Map();
  let buffer = '', id = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)?.(message); } });
  startMCP({ input, output, root: dir, directory: path.join(dir, 'output') }); t.after(() => input.end());
  const call = (method, params) => new Promise(resolve => { waiting.set(++id, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  return async (name, args) => { if (!id) await call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'one-call', version: '1' } }); const result = (await call('tools/call', { name, arguments: args })).result; return { ...result, info: JSON.parse(result.content[0].text) }; };
};
const folder = async t => { const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-one-call-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; };
const cli = dir => (...args) => { const made = spawnSync(process.execPath, [path.join(root, 'bin/pixelbolt.js'), ...args], { encoding: 'utf8', cwd: dir }); return { ...made, said: made.stdout + made.stderr, info: made.status === 0 ? JSON.parse(made.stdout) : null }; };

test('render --scale and pixel_render scale enlarge every exported file, as sheet.scale does', async t => {
  const dir = await folder(t), run = cli(dir);
  await writeFile(path.join(dir, 'lamp.json'), JSON.stringify(sprite));
  const made = run('render', 'lamp.json', '--out', 'big', '--scale', '4', '--expect', '{"width":32,"height":32}');
  assert.equal(made.status, 0, made.said);
  assert.deepEqual([made.info.check.ok, made.info.check.delivered.size, made.info.check.delivered.scale], [true, [32, 32], 4]);
  const frame = decodePNG(await readFile(path.join(dir, 'big/frames/dim.png'))), sheet = decodePNG(await readFile(path.join(dir, 'big/lamp.png')));
  assert.deepEqual([frame.width, frame.height, sheet.width, sheet.height], [32, 32, 64, 32]);
  // The bundle's copy of the recipe carries the scale, so rendering that copy gives the same files.
  assert.equal(JSON.parse(await readFile(path.join(dir, 'big/lamp.pixel.json'), 'utf8')).sheet.scale, 4);
  assert.match(run('render', 'lamp.json', '--out', 'bad', '--scale', '40').said, /--scale expects a whole number from 1 to 16/);
  const tool = client(t, dir), rendered = await tool('pixel_render', { project: sprite, scale: 3, expect: { width: 24, height: 24 } });
  assert.deepEqual([rendered.info.check.ok, rendered.info.check.delivered.size], [true, [24, 24]]);
  // The revision returned is the recipe as rendered: a later call with it keeps the size.
  assert.deepEqual((await tool('pixel_render', { revision: rendered.info.revision })).info.check.delivered.size, [24, 24]);
  assert.equal((await tool('pixel_render', { project: sprite, scale: 0 })).isError, true);
});

test('render --normal writes the sprite with its normal map and the Godot CanvasTexture that lights it', async t => {
  const dir = await folder(t), run = cli(dir);
  await writeFile(path.join(dir, 'lamp.json'), JSON.stringify(sprite));
  await writeFile(path.join(dir, 'lamp.normals.json'), JSON.stringify({ format: 'pixelforge-normals', version: 1, recipe: 'lamp.json', axis: 'vertical' }));
  const made = run('render', 'lamp.json', '--normal', 'lamp.normals.json', '--out', 'lit', '--scale', '2');
  assert.equal(made.status, 0, made.said);
  for (const file of ['lamp.png', 'lamp.normal.png', 'lamp.normal_y_up.png', 'lamp.canvas.tres', 'lamp.tres']) assert.ok(made.info.files.includes(file), `${file} in ${made.info.files}`);
  // The normal sheet lies on the colour sheet's grid, and the flipped copy differs from it only in green.
  const colour = decodePNG(await readFile(path.join(dir, 'lit/lamp.png'))), normal = decodePNG(await readFile(path.join(dir, 'lit/lamp.normal.png'))), flipped = decodePNG(await readFile(path.join(dir, 'lit/lamp.normal_y_up.png')));
  assert.deepEqual([normal.width, normal.height, flipped.width, flipped.height], [colour.width, colour.height, colour.width, colour.height]);
  for (let i = 0; i < normal.data.length; i += 4) {
    assert.equal(normal.data[i + 3] > 0, colour.data[i + 3] > 0, `pixel ${i / 4} is covered in one sheet only`);
    if (normal.data[i + 3]) assert.deepEqual([flipped.data[i], flipped.data[i + 1], flipped.data[i + 2]], [normal.data[i], 255 - normal.data[i + 1], normal.data[i + 2]]);
  }
  const canvas = await readFile(path.join(dir, 'lit/lamp.canvas.tres'), 'utf8'), frames = await readFile(path.join(dir, 'lit/lamp.tres'), 'utf8');
  assert.match(canvas, /^\[gd_resource type="CanvasTexture" format=3\]\n\n\[ext_resource type="Texture2D" path="lamp\.png" id="1_diffuse"\]\n\[ext_resource type="Texture2D" path="lamp\.normal_y_up\.png" id="2_normal"\]/);
  assert.match(frames, /\[ext_resource type="Texture2D" path="lamp\.canvas\.tres" id="1_sheet"\]/);
  assert.match(await readFile(path.join(dir, 'lit/README.txt'), 'utf8'), /lamp\.canvas\.tres: a Godot 4 CanvasTexture of lamp\.png and lamp\.normal_y_up\.png/);
  // Without --normal the SpriteFrames draws the sheet itself.
  run('render', 'lamp.json', '--out', 'plain');
  assert.match(await readFile(path.join(dir, 'plain/lamp.tres'), 'utf8'), /path="lamp\.png" id="1_sheet"/);
  // A pass of another shape is refused with what differs.
  await writeFile(path.join(dir, 'other.json'), JSON.stringify({ ...sprite, name: 'other', frames: sprite.frames.slice(0, 1), animations: undefined }));
  assert.match(run('render', 'lamp.json', '--normal', 'other.json', '--out', 'bad').said, /normal: a normal pass shares the colour recipe's size and frames: it has 1 frames and the colour recipe 2/);
  // MCP takes the source, a recipe or a revision of one.
  const tool = client(t, dir), compiled = await tool('pixel_compile', { source: { format: 'pixelforge-normals', version: 1, recipe: sprite } });
  for (const normalOption of [{ revision: compiled.info.revision }, { format: 'pixelforge-normals', version: 1, recipe: sprite }]) {
    const lit = await tool('pixel_render', { project: sprite, normal: normalOption, listFiles: true });
    assert.ok(lit.info.files.some(file => file.endsWith('lamp.canvas.tres')) && lit.info.files.some(file => file.endsWith('lamp.normal_y_up.png')), JSON.stringify(lit.info.files));
  }
});

test('a normal pass with an axis is a cylinder: it leans across the axis and never along it', () => {
  // A barrel: a 12-wide body with a narrower top and bottom row.
  const rows = ['...aaaaaa...', ...Array.from({ length: 8 }, () => 'aaaaaaaaaaaa'), '...aaaaaa...'];
  const barrel = { version: 1, name: 'barrel', width: 14, height: 12, palette: { a: '#8a5a36' }, frames: [{ name: 'barrel', ops: [{ op: 'grid', x: 1, y: 1, rows }] }] };
  const pass = extra => compileNormals({ format: 'pixelforge-normals', version: 1, recipe: barrel, ...extra }), grid = made => made.recipe.frames[0].ops[0].rows;
  const upright = grid(pass({ axis: 'vertical' })), cushion = grid(pass({}));
  // Left and right of 5 on the keypad and the keyboard: 4 a lean left, 6 d lean right. Nothing leans up or down.
  for (const row of upright.slice(1, 11)) assert.match(row, /^\.+[a4]+5+[6d]+\.+$/, row);
  assert.ok(/[qwe789]/.test(cushion[1]) && /[zxc123]/.test(cushion[10]), `${cushion[1]} ${cushion[10]}`);
  // Every full row away from the ends is the same slice, and a narrower end row is the middle of that slice.
  assert.equal(new Set(upright.slice(3, 9)).size, 1);
  assert.equal(upright[1].slice(5, 9), upright[5].slice(5, 9));
  assert.equal(pass({ axis: 'vertical' }).metadata.axis, 'vertical');
  // Lying down, the same form leans up and down instead.
  const lying = grid(pass({ axis: 'horizontal' }));
  for (let x = 1; x <= 12; x++) assert.match(lying.slice(1, 11).map(row => row[x]).join(''), /^\.*[w8]+5+[2x]+\.*$/, `column ${x}`);
  assert.throws(() => pass({ axis: 'round' }), /normals\.axis: expected vertical \(a barrel or a pillar standing up\) or horizontal/);
});

test('gif <scene> and pixel_scene gif write the whole scene as one looping GIF', async t => {
  const dir = await folder(t), run = cli(dir);
  await writeFile(path.join(dir, 'lamp.json'), JSON.stringify(sprite));
  const scene = { format: 'pixelforge-scene', version: 1, name: 'porch', width: 16, height: 12, duration: 200, background: '#101020', assets: { lamp: 'lamp.json' }, instances: [{ name: 'lamp', asset: 'lamp', at: [4, 2], animation: 'glow' }] };
  await writeFile(path.join(dir, 'porch.scene.json'), JSON.stringify(scene));
  const made = run('gif', 'porch.scene.json', '--out', 'porch.gif', '--scale', '3');
  assert.equal(made.status, 0, made.said);
  // 200 ms at 25 frames a second: five frames of 40 ms, the lamp dim for the first 100 ms and lit after, which 40 ms
  // frames split unevenly (three, then two), so the reply names an even rate.
  assert.deepEqual([made.info.width, made.info.height, made.info.frames, made.info.fps, made.info.duration, made.info.notes], [48, 36, 5, '25', 200, ['At 25 fps (40 ms a GIF frame) frames of 100 ms are held for uneven numbers of GIF frames, so their animation stutters; fps 20 holds each for a whole number.']]);
  const bytes = await readFile(path.join(dir, 'porch.gif'));
  assert.deepEqual([bytes.subarray(0, 6).toString('latin1'), bytes.readUInt16LE(6), bytes.readUInt16LE(8)], ['GIF89a', 48, 36]);
  const prepared = prepareScene({ ...scene, assets: { lamp: sprite } }), same = sceneGIF(prepared, { scale: 3 });
  assert.deepEqual(Buffer.from(same.data), bytes);
  assert.notDeepEqual(renderScene(prepared, { time: 0 }).data, renderScene(prepared, { time: 120 }).data);
  // A duration that is no whole number of frames is said, with one that is.
  assert.match(sceneGIF(prepareScene({ ...scene, duration: 250, assets: { lamp: sprite } })).notes.join(' '), /The scene lasts 250 ms, 6\.25 frames at 25 fps, and the GIF plays 6: give the scene a duration that is a whole number of frames \(240 ms\)/);
  assert.equal(sceneGIF(prepared, { fps: 10 }).frames, 2);
  // A duration that cuts a placement's loop, and a one-shot in the loop, are said with what would close it.
  const uneven = { ...sprite, frames: [{ ...sprite.frames[0], duration: 60 }, { ...sprite.frames[1], duration: 90 }] }, sparkle = { ...sprite, name: 'sparkle', animations: { glow: { frames: ['dim', 'lit'], loop: false } } };
  const notes = sceneGIF(prepareScene({ ...scene, assets: { lamp: uneven, sparkle }, instances: [...scene.instances, { name: 'steady', asset: 'lamp', at: [0, 0], frame: 'dim' }, { name: 'spark', asset: 'sparkle', at: [8, 2], animation: 'glow' }] })).notes;
  assert.deepEqual(notes, ["The scene's 200 ms cut lamp (a loop of 150 ms) mid-loop, so the GIF jumps where it repeats. A scene duration of 150 ms holds whole loops of every placement.",
    'spark plays once and holds its last frame, then starts again where the GIF repeats: a one-shot animation in a loop. A patch of animations.<name> with "loop": true and "direction": "pingpong" makes a swing go there and back.']);
  // What goes with a recipe's GIF is refused for a scene, and --fps for a recipe.
  assert.match(run('gif', 'porch.scene.json', '--out', 'a.gif', '--animation', 'glow').said, /--animation goes with a recipe's GIF; a scene's takes --scale, --fps, --background and --sheet/);
  assert.match(run('gif', 'lamp.json', '--out', 'b.gif', '--fps', '10').said, /--fps goes with a scene's GIF/);
  const tool = client(t, dir), viewed = await tool('pixel_scene', { scene, gif: { scale: 2, fps: 12.5 } });
  assert.deepEqual([viewed.info.gif.width, viewed.info.gif.height, viewed.info.gif.frames, path.basename(viewed.info.gif.file)], [32, 24, 3, 'porch.gif']);
  assert.equal((await readFile(viewed.info.gif.file)).subarray(0, 6).toString('latin1'), 'GIF89a');
});

test('gif - reads a scene from stdin and writes the same GIF as its file', async t => {
  const dir = await folder(t), run = cli(dir);
  await writeFile(path.join(dir, 'lamp.json'), JSON.stringify(sprite));
  const scene = { format: 'pixelforge-scene', version: 1, name: 'porch', width: 16, height: 12, duration: 200, background: '#101020', assets: { lamp: 'lamp.json' }, instances: [{ name: 'lamp', asset: 'lamp', at: [4, 2], animation: 'glow' }] };
  const input = JSON.stringify(scene);
  await writeFile(path.join(dir, 'porch.scene.json'), input);
  const made = run('gif', 'porch.scene.json', '--out', 'file.gif', '--scale', '3');
  assert.equal(made.status, 0, made.said);
  const piped = spawnSync(process.execPath, [path.join(root, 'bin/pixelbolt.js'), 'gif', '-', '--out', 'stdin.gif', '--scale', '3'], { input, encoding: 'utf8', cwd: dir });
  assert.equal(piped.status, 0, piped.stdout + piped.stderr);
  assert.deepEqual({ ...JSON.parse(piped.stdout), file: made.info.file }, made.info);
  assert.deepEqual(await readFile(path.join(dir, 'stdin.gif')), await readFile(path.join(dir, 'file.gif')));
});

test('gif - reads a recipe from stdin and writes the same GIF as its file', async t => {
  const dir = await folder(t), run = cli(dir), input = JSON.stringify(sprite);
  await writeFile(path.join(dir, 'lamp.json'), input);
  const made = run('gif', 'lamp.json', '--out', 'file.gif', '--animation', 'glow', '--scale', '2');
  assert.equal(made.status, 0, made.said);
  const piped = spawnSync(process.execPath, [path.join(root, 'bin/pixelbolt.js'), 'gif', '-', '--out', 'stdin.gif', '--animation', 'glow', '--scale', '2'], { input, encoding: 'utf8', cwd: dir });
  assert.equal(piped.status, 0, piped.stdout + piped.stderr);
  assert.deepEqual({ ...JSON.parse(piped.stdout), file: made.info.file }, made.info);
  const bytes = await readFile(path.join(dir, 'stdin.gif'));
  assert.deepEqual(bytes, await readFile(path.join(dir, 'file.gif')));
  const gif = decodeGIF(bytes);
  assert.deepEqual([gif.width, gif.height, gif.frames.length], [16, 16, 2]);
});

test('gif <scene> takes --background and --sheet as a recipe\'s GIF does: blended frames, and a sheet of them as the GIF holds them', async t => {
  const dir = await folder(t), run = cli(dir);
  // A see-through scene: a lamp with a half-transparent glow over nothing, as a rain overlay is.
  const glow = { ...sprite, palette: { ...sprite.palette, h: '#ffe08080' }, frames: sprite.frames.map(frame => ({ ...frame, ops: [{ op: 'rect', x: 0, y: 0, w: 8, h: 8, color: 'h' }, ...frame.ops] })) };
  await writeFile(path.join(dir, 'lamp.json'), JSON.stringify(glow));
  const scene = { format: 'pixelforge-scene', version: 1, name: 'rain', width: 16, height: 12, duration: 200, background: 'transparent', assets: { lamp: 'lamp.json' }, instances: [{ name: 'lamp', asset: 'lamp', at: [4, 2], animation: 'glow' }] };
  await writeFile(path.join(dir, 'rain.scene.json'), JSON.stringify(scene));
  const made = run('gif', 'rain.scene.json', '--out', 'rain.gif', '--background', '#14213d', '--scale', '3', '--sheet', 'sheet.png');
  assert.equal(made.status, 0, made.said);
  assert.equal(made.info.sheetShows, undefined, 'five frames all fit on the sheet');
  const gif = decodeGIF(await readFile(path.join(dir, 'rain.gif')));
  assert.deepEqual([gif.width, gif.height, gif.frames.length], [48, 36, 5]);
  // Opaque everywhere: the empty corner is the background, and the glow is blended onto it, not cut to 1-bit alpha.
  for (const frame of gif.frames) { assert.equal(frame.transparent, null); assert.ok(!frame.pixels.includes('clear')); assert.equal(frame.pixels[0], '14213d'); }
  assert.equal(gif.frames[0].pixels[(3 * 3) * 48 + 4 * 3], ((0xff * 128 + 0x14 * 127 + 127) / 255 | 0).toString(16) + ((0xe0 * 128 + 0x21 * 127 + 127) / 255 | 0).toString(16) + ((0x80 * 128 + 0x3d * 127 + 127) / 255 | 0).toString(16));
  // Cell n of a sheet read at the GIF's pixels (`enlarge` times the scene's 16x12), as decodeGIF names them: a pixel
  // the sheet shows over its checkerboard is one the GIF leaves clear.
  const cellOf = (sheet, view, n, enlarge) => Array.from({ length: 16 * enlarge * 12 * enlarge }, (_, i) => {
    const left = view.gap + (n % view.columns) * (16 * view.scale + view.gap), top = view.gap + Math.floor(n / view.columns) * (12 * view.scale + view.gap);
    const x = left + Math.floor((i % (16 * enlarge)) / enlarge) * view.scale, y = top + Math.floor(Math.floor(i / (16 * enlarge)) / enlarge) * view.scale, at = (y * sheet.width + x) * 4;
    const hex = Buffer.from(sheet.data.subarray(at, at + 3)).toString('hex');
    return hex === '8f9197' || hex === '83858b' ? 'clear' : hex;
  });
  // The sheet's cells are the decoded GIF's frames, pixel for pixel, at the sheet's own enlargement.
  const sheet = decodePNG(await readFile(path.join(dir, 'sheet.png'))), view = sceneGIF(prepareScene({ ...scene, assets: { lamp: glow } }), { background: '#14213d', sheet: true }).sheet.sheet;
  assert.deepEqual([sheet.width, sheet.height], [view.width, view.height]);
  gif.frames.forEach((frame, n) => assert.deepEqual(cellOf(sheet, view, n, 3), frame.pixels, `sheet cell ${n} is GIF frame ${n}`));
  // A long scene with no --background, panned by its camera, with a row below 50% alpha and the rest of the glow at
  // 50%: its sheet is sampled as inspect samples, the reply says so in inspect's words, and each sampled cell is the
  // GIF's frame at inspect's position, cut to 1-bit alpha as the GIF holds it (the faint row clear, the glow opaque).
  const faint = { ...glow, palette: { ...glow.palette, f: '#ffe08060' }, frames: sprite.frames.map(frame => ({ ...frame, ops: [{ op: 'rect', x: 0, y: 0, w: 8, h: 1, color: 'f' }, { op: 'rect', x: 0, y: 1, w: 8, h: 7, color: 'h' }, ...frame.ops] })) };
  await writeFile(path.join(dir, 'faint.json'), JSON.stringify(faint));
  const longScene = { ...scene, name: 'long', duration: 12000, assets: { lamp: 'faint.json' }, camera: [{ time: 0, at: [0, 0] }, { time: 12000, at: [4, 2] }] };
  await writeFile(path.join(dir, 'long.scene.json'), JSON.stringify(longScene));
  const long = run('gif', 'long.scene.json', '--out', 'long.gif', '--sheet', 'long.png');
  assert.equal(long.status, 0, long.said);
  assert.deepEqual([long.info.frames, long.info.sheetShows], [300, '256 of the 300 frames, evenly spaced, including endpoints; durations are original, not playback timing']);
  const longGIF = decodeGIF(await readFile(path.join(dir, 'long.gif'))), longSheet = decodePNG(await readFile(path.join(dir, 'long.png')));
  const longView = sceneGIF(prepareScene({ ...longScene, assets: { lamp: faint } }), { sheet: true }).sheet.sheet;
  assert.deepEqual([longSheet.width, longSheet.height], [longView.width, longView.height]);
  assert.notDeepEqual(longGIF.frames[0].pixels, longGIF.frames[299].pixels, 'the camera moves the lamp');
  assert.equal(longGIF.frames[0].pixels[2 * 16 + 4], 'clear', 'the faint row is below 50% alpha');
  assert.notEqual(longGIF.frames[0].pixels[3 * 16 + 4], 'clear', 'the glow at 50% alpha is kept');
  for (const n of [0, 1, 2, 127, 200, 254, 255]) assert.deepEqual(cellOf(longSheet, longView, n, 1), longGIF.frames[Math.floor(n * 299 / 255)].pixels, `sheet cell ${n} is GIF frame ${Math.floor(n * 299 / 255)}`);
  // Other recipe options are still refused, as is a sheet that is not a PNG; a background must be opaque.
  assert.match(run('gif', 'rain.scene.json', '--out', 'c.gif', '--frames', '2').said, /--frames goes with a recipe's GIF/);
  assert.match(run('gif', 'rain.scene.json', '--out', 'c.gif', '--size', '8x8').said, /--size goes with a recipe's GIF/);
  // A scene has no palette, so a colour that is not hex is refused in hex terms.
  assert.match(run('gif', 'rain.scene.json', '--out', 'c.gif', '--background', 'black').said, /gif\.background: expected a hex colour such as #14213d, not \\"black\\"/);
  assert.match(run('gif', 'rain.scene.json', '--out', 'c.gif', '--sheet', 'c.jpg').said, /--sheet must name a new \.png file/);
  assert.match(run('gif', 'rain.scene.json', '--out', 'c.gif', '--background', '#14213d80').said, /gif\.background: must be an opaque colour/);
  // MCP: pixel_scene's gif takes background too.
  const tool = client(t, dir), viewed = await tool('pixel_scene', { scene, gif: { background: '#14213d' } });
  assert.ok(decodeGIF(await readFile(viewed.info.gif.file)).frames.every(frame => frame.transparent === null && frame.pixels[0] === '14213d'));
});

test('a layered tile set draws a map of its own layers, gives the tilemap a scene needs, and its corner fringe is no clipped drawing', () => {
  const source = { format: 'pixelforge-autotile', version: 1, name: 'shore', tile: 8, palette: { g: '#3a7d44', s: '#e2c98a', d: '#b89a5a' }, frame: 'shore-{corners}',
    layers: [{ name: 'grass', key: 'g', terrain: { seed: 1, fill: { color: 'g' } } }, { name: 'sand', key: 's', terrain: { seed: 2, fill: { color: 's' }, edges: { all: { depth: 1, bands: ['d'] } } } }] };
  const rows = ['gggggg', 'ggssgg', 'gssssg', 'gggggg'], made = compileAutotile({ ...source, preview: { rows } }), plain = compileAutotile(source);
  // The map is the rows, a tile a cell; without rows it is the test map that shows every tile.
  assert.deepEqual([made.preview.width, made.preview.height], [48, 32]);
  assert.notDeepEqual([plain.preview.width, plain.preview.height], [48, 32]);
  const drawn = renderProject(made.preview).frames[0], at = (x, y) => `#${[...drawn.data.subarray((y * 48 + x) * 4, (y * 48 + x) * 4 + 3)].map(v => v.toString(16).padStart(2, '0')).join('')}`;
  assert.deepEqual([at(4, 4), at(24, 20), at(44, 28)], ['#3a7d44', '#e2c98a', '#3a7d44']);
  assert.deepEqual(made.recipe, plain.recipe);
  assert.deepEqual(tilemapOf(made.recipe, made.metadata), { tile: [8, 8], legend: { g: { frame: 'shore-{corners}', autotile: 'corner' }, s: { frame: 'shore-{corners}', autotile: 'corner' } } });
  assert.throws(() => compileAutotile({ ...source, preview: { rows: ['gg#g'] } }), /autotile\.preview\.rows\[0\]: character "#" at column 2 is no layer's key: g for grass, s for sand/);
  assert.throws(() => compileAutotile({ ...source, preview: { rows: ['ggg', 'gg'] } }), /autotile\.preview\.rows/);
  // In a scene exactly the map's size, the half cell the corner tiles reach past it is not reported as clipped.
  const scene = prepareScene({ format: 'pixelforge-scene', version: 1, name: 'bay', width: 48, height: 32, assets: { shore: made.recipe }, instances: [{ name: 'map', asset: 'shore', at: [0, 0], tilemap: { ...tilemapOf(made.recipe, made.metadata), rows, outside: 'match' } }] });
  const view = renderScene(scene);
  assert.deepEqual([view.warnings, view.clipped], [[], undefined]);
  // A map that does hang off the scene still is.
  const off = renderScene(prepareScene({ format: 'pixelforge-scene', version: 1, name: 'bay', width: 40, height: 32, assets: { shore: made.recipe }, instances: [{ name: 'map', asset: 'shore', at: [0, 0], tilemap: { ...tilemapOf(made.recipe, made.metadata), rows, outside: 'match' } }] }));
  assert.match(off.warnings[0], /^\d+ drawn pixels clipped at scene bounds \(map \d+\)\.$/);
});

test('variants that are the frames of an animation are said so, and an outline with nothing to surround is too', () => {
  // Three palettes of one water tile, with and without the animation that plays them.
  const pond = { format: 'pixelforge-autotile', version: 1, name: 'pond', tile: 8, frame: 'pond-{mask}-{variant}', palette: { w: '#2f78b0', a: '#3c8cc4', b: '#2a6a9e' },
    terrain: { seed: 1, fill: { color: 'w', speckle: [{ color: 'a', amount: 0.2, size: 2 }] } }, variants: [{ name: 's1', palette: { a: '#8fd0ee' }, duration: 180 }, { name: 's2', palette: { a: '#3c8cc4' }, duration: 180 }] };
  assert.deepEqual(compileAutotile(pond).warnings.filter(text => text.startsWith('autotile.variants')), ['autotile.variants: the 2 variants differ only in palette or duration, which are the frames of an animation, but with no `animation` each cell picks one of them at random and never changes. Add "animation": "pond-{mask}" and every tile plays them in turn (an animated tile in the Godot TileSet and in Tiled).']);
  const animated = compileAutotile({ ...pond, animation: 'pond-{mask}' });
  assert.ok(!(animated.warnings ?? []).some(text => text.startsWith('autotile.variants')) && animated.recipe.animations['pond-255'].frames.length === 2);
  // The tilemap the reply gives names the animation, where a list of its frames would scatter them as stills.
  assert.deepEqual([tilemapOf(animated.recipe, animated.metadata).legend['#'], tilemapOf(compileAutotile(pond).recipe, null).legend['#']], [{ animation: 'pond-{mask}', autotile: 'blob' }, { frames: ['pond-{mask}-s1', 'pond-{mask}-s2'], autotile: 'blob' }]);
  // Variants that draw something else are tiles to scatter, and say nothing.
  assert.ok(!(compileAutotile({ ...pond, variants: [{ name: 's1', terrain: { fill: { seed: 4 } } }, { name: 's2', palette: { a: '#8fd0ee' } }] }).warnings ?? []).some(text => text.startsWith('autotile.variants')));
  // A frame's ops and its layers are buffers apart: an outline among the ops of a frame drawn in layers draws nothing.
  const base = { version: 1, name: 'crate', width: 8, height: 8, palette: { a: '#b07e52', k: '#2a1c18' } }, body = { op: 'rect', x: 2, y: 2, w: 3, h: 3, color: 'a' }, outline = { op: 'outline', color: 'k' };
  assert.deepEqual(renderProject({ ...base, frames: [{ name: 'f', layers: [{ name: 'body', ops: [body] }], ops: [outline] }] }).warnings, ["An outline drew nothing: project.frames[0].ops[0] surrounds what its own buffer holds, and a frame's ops and each of its layers are buffers apart. Put the outline at the end of the layer it should surround."]);
  assert.deepEqual(renderProject({ ...base, frames: [{ name: 'f', layers: [{ name: 'body', ops: [body, outline] }] }] }).warnings, []);
  // P-166: a frame palette recolours the frame's own drawing. A frame that continues another and draws nothing has
  // nothing for its palette to recolour: it is the same picture again, and the reply says so.
  assert.deepEqual(renderProject({ ...base, frames: [{ name: 'f', ops: [body] }, { name: 'glint', from: 'f', palette: { a: '#ffffff' } }] }).warnings,
    [`Frame "glint" sets a palette but draws nothing of its own, so the palette changes nothing: it continues "f" in that frame's exact colours. A frame palette recolours the frame's own drawing: stamp the symbol again in this frame, or copy from "f" with remap.`]);
  assert.match(renderProject({ ...base, frames: [{ name: 'f', ops: [body] }, { name: 'g', from: 'f', palette: { a: '#ffffff' } }, { name: 'h', palette: { a: '#ffffff' }, ops: [] }] }).warnings[0], /^Frame "g" \(and 1 more frame\) sets a palette but draws nothing of its own, so the palette changes nothing: it continues "f"/);
  // A frame that draws with its palette, over what it continues or alone, says nothing.
  assert.deepEqual(renderProject({ ...base, frames: [{ name: 'f', ops: [body] }, { name: 'g', from: 'f', palette: { a: '#ffffff' }, ops: [body] }, { name: 'h', palette: { a: '#ffffff' }, layers: [{ name: 'body', ops: [body] }] }] }).warnings, []);
  // In a frame that draws nothing at all, an effect's empty frame, it is no mistake.
  assert.deepEqual(renderProject({ ...base, frames: [{ name: 'f', ops: [outline] }, { name: 'g', ops: [body, outline] }] }).warnings, []);
});

test('tile sets are presets, and a shipped scene answers to its name where a source is read', async t => {
  const dir = await folder(t), run = cli(dir);
  const found = run('presets', '--find', 'shore');
  assert.match(found.info.presets.shore, /^autotile, 16x16, \d+ frames, .*A tile set for a terrain brush \(Godot TileSet, Tiled tileset\): water, sand, grass and the tiles where they meet, with collision\.$/);
  assert.match(run('presets', '--find', 'ground').info.presets.ground, /^autotile, .*one terrain, blob tiles, with slopes/);
  // A scene is saved as it is, its assets still files, and says how to fetch them; nothing compiles it.
  const saved = run('presets', 'iso-glade', '--out', 'glade.scene.json');
  assert.equal(saved.status, 0, saved.said);
  assert.match(saved.info.next, /^A scene: pixelbolt presets iso-glade --out <new\.scene\.json> saves it, and each file its assets name is a preset to save beside it/);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'glade.scene.json'), 'utf8')), JSON.parse(await readFile(path.join(root, 'examples/iso-glade.scene.json'), 'utf8')));
  assert.match(run('compile', '--preset', 'iso-glade', '--out', 'x.json').said, /no preset named .{1,2}iso-glade/);
});

test('a scene export keeps what replays it in player/, and the page finds every file it loads', async () => {
  const bundle = await createSceneBundle({ format: 'pixelforge-scene', version: 1, name: 'porch', width: 16, height: 12, assets: { lamp: sprite }, instances: [{ name: 'lamp', asset: 'lamp', at: [4, 2], animation: 'glow' }] });
  const files = [...bundle.files.keys()], top = files.filter(file => !file.includes('/'));
  // The top level is the scene and what an engine takes; no module of the player sits among it.
  assert.deepEqual(top.filter(file => file.endsWith('.js') || file.endsWith('.css')), []);
  assert.ok(top.includes('preview.html') && top.includes('scene.json') && top.includes('scene.tscn') && top.includes('scene.tmx'), top.join(' '));
  // The page's stylesheet and module, and every module those import, are in the bundle where they are asked for.
  const page = bundle.files.get('preview.html').toString();
  const asked = [...page.matchAll(/(?:href|src)="\.\/([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(asked.sort(), ['player/scene-player.js', 'player/scene.css']);
  for (const file of files.filter(name => name.startsWith('player/') && name.endsWith('.js'))) {
    for (const [, from] of bundle.files.get(file).toString().matchAll(/^import [^;]*? from '\.\/([^']+)';/gm)) assert.ok(bundle.files.has(`player/${from}`), `${file} imports ${from}`);
  }
  // The scene itself is fetched beside the page, not from player/.
  assert.match(bundle.files.get('player/scene-player.js').toString(), /fetch\('\.\/scene\.json'\)/);
});
