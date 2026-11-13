import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, PixelError } from '../src/core.js';
import { patchRecipe } from '../src/patch.js';
import { readExpect, checkDelivery } from '../src/check.js';

// expect.sheet: the sprite sheet the user named ("a sprite sheet fireball_sheet.png (640x64)", "a one-row strip").
// A grid wraps at 8 columns by default, so 10 frames of 64x64 came out as a 512x128 sheet that passed every other
// check (PIXELBOLT-BUGS P-127).
const root = fileURLToPath(new URL('../', import.meta.url));
const strip = (count, more = {}) => ({ version: 1, name: 'blast', width: 64, height: 64, palette: { a: '#ff8800', b: '#552200' },
  frames: Array.from({ length: count }, (_, i) => ({ name: `f${i}`, ops: [{ op: 'rect', x: 2 + i * 3, y: 20, w: 12 + i, h: 24, color: i % 2 ? 'a' : 'b' }] })), ...more });
const check = (recipe, expect) => checkDelivery(renderProject(recipe), { recipe, expect: readExpect(expect) });
// The change a fix quotes, applied as an agent would apply it.
const patched = (recipe, fix) => { const change = JSON.parse(fix.slice(fix.indexOf('pixel_patch ') + 12, fix.lastIndexOf(', then render again'))); return patchRecipe(recipe, [change].flat()).recipe; };
const pngSize = bytes => [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];

test('a sheet asked for as a size or a one-row strip fails on the default 8-column wrap, and its fix makes it', () => {
  const recipe = strip(10);
  for (const sheet of [{ width: 640, height: 64 }, { rows: 1 }, { width: 640 }, { height: 64 }, { columns: 10 }]) {
    const missed = check(recipe, { width: 64, height: 64, frames: 10, sheet });
    assert.equal(missed.ok, false, JSON.stringify(sheet));
    assert.deepEqual(missed.problems.map(problem => [problem.file, problem.asked, problem.got]), [['blast.png', sheet, { width: 512, height: 128, columns: 8, rows: 2 }]]);
    assert.match(missed.problems[0].fix, /^10 columns by 1 row of 64x64 cells, a 640x64 sheet: pixel_patch /);
    const fixed = patched(recipe, missed.problems[0].fix);
    assert.deepEqual(fixed.sheet, { columns: 10 });
    const passed = check(fixed, { width: 64, height: 64, frames: 10, sheet });
    assert.deepEqual([passed.ok, passed.problems, passed.delivered.sheet], [true, undefined, undefined]);
  }
  // Without a sheet in expect, the frames alone pass, and the wrap is still said.
  const unsaid = check(recipe, { width: 64, height: 64, frames: 10 });
  assert.equal(unsaid.ok, true);
  assert.deepEqual(unsaid.delivered.sheet, { size: [512, 128], columns: 8, rows: 2 });
  assert.match(checkDelivery(renderProject(recipe), { recipe }).hint, /, sheet\)/);
  // A sheet in one row, a grid the recipe chose, and a sheet expect checks (its problem says what came out) say nothing.
  assert.equal(check(strip(8), { frames: 8 }).delivered.sheet, undefined);
  assert.equal(check(strip(10, { sheet: { columns: 10 } }), { frames: 10 }).delivered.sheet, undefined);
  assert.equal(check(strip(12, { sheet: { columns: 4 } }), { sheet: { columns: 4, rows: 3 } }).delivered.sheet, undefined);
  assert.equal(check(strip(12, { sheet: { columns: 4 } }), {}).delivered.sheet, undefined);
  assert.equal(check(recipe, { sheet: { rows: 1 } }).delivered.sheet, undefined);
  // The sheet is the whole file, so checking one animation checks the same sheet.
  const named = strip(10, { animations: { a: { frames: ['f0', 'f1'] }, b: { frames: ['f2', 'f3', 'f4'] } } });
  const one = checkDelivery(renderProject(named), { recipe: named, expect: readExpect({ sheet: { rows: 1 } }), animation: 'a' });
  assert.deepEqual([one.problems[0].got, one.problems[0].fix], [{ width: 512, height: 128, columns: 8, rows: 2 }, check(named, { sheet: { rows: 1 } }).problems[0].fix]);
  assert.match(one.problems[0].fix, /^10 columns by 1 row/);
});

test('the sheet fix picks the fewest empty cells, keeps a recipe\'s own sheet fields, and agrees with the frame-size fix', () => {
  // A grid asked by columns and rows; the recipe has a sheet field, so only sheet.columns changes.
  const gridded = strip(12, { sheet: { padding: 1 } });
  const grid = check(gridded, { sheet: { columns: 4, rows: 3 } });
  assert.match(grid.problems[0].fix, /^4 columns by 3 rows of 66x66 cells \(each frame with 1 px of padding a side\), a 264x198 sheet: pixel_patch \{"set":"sheet.columns","value":4\}/);
  assert.equal(check(patched(gridded, grid.problems[0].fix), { sheet: { columns: 4, rows: 3 } }).ok, true);
  // Two rows of 10 frames: 5 columns fill both rows, where 6 to 9 leave cells empty (the default 8 is one of those).
  assert.match(check(strip(10, { sheet: { columns: 10 } }), { sheet: { rows: 2 } }).problems[0].fix, /^5 columns by 2 rows of 64x64 cells, a 320x128 sheet: pixel_patch {"set":"sheet.columns","value":5}/);
  assert.equal(check(strip(10), { sheet: { rows: 2 } }).ok, true);
  // Wider than the frames fill: offered, with the empty cells said.
  assert.match(check(strip(8, { sheet: { columns: 4 } }), { sheet: { width: 640, height: 64 } }).problems[0].fix, /^10 columns by 1 row of 64x64 cells, a 640x64 sheet with 2 empty cells: pixel_patch \{"set":"sheet.columns","value":10\}/);
  // Frames at half the asked size, in a recipe without a sheet field: the sheet's patch carries the scale, so applying
  // it alone fixes both, and the frame-size patch is the one it replaces.
  const small = { ...strip(12), width: 32, height: 32 };
  const both = check(small, { width: 64, height: 64, sheet: { width: 768, height: 64 } });
  assert.deepEqual(both.problems.map(problem => problem.file), ['blast.png, frames/ and animations/', 'blast.png']);
  assert.match(both.problems[1].fix, /at the frame-size fix's sheet\.scale 2, which this patch carries \(apply it instead of that one\): pixel_patch \{"set":"sheet","value":\{"scale":2,"columns":12\}\}/);
  assert.equal(check(patched(small, both.problems[1].fix), { width: 64, height: 64, sheet: { width: 768, height: 64 } }).ok, true);
  // With a sheet field, the two patches are separate and both apply.
  const fielded = { ...small, sheet: { scale: 1 } }, apart = check(fielded, { width: 64, height: 64, sheet: { width: 768, height: 64 } });
  assert.match(apart.problems[1].fix, /with the frame-size fix \(sheet\.scale 2\) applied too: pixel_patch \{"set":"sheet.columns","value":12\}/);
  const fixedBoth = patchRecipe(patched(fielded, apart.problems[1].fix), [{ set: 'sheet.scale', value: 2 }]).recipe;
  assert.equal(check(fixedBoth, { width: 64, height: 64, sheet: { width: 768, height: 64 } }).ok, true);
  // Only the scale was wrong: the frame-size fix alone makes the sheet.
  const scaleOnly = check({ ...strip(4), width: 32, height: 32 }, { width: 64, height: 64, sheet: { width: 256, height: 64 } });
  assert.equal(scaleOnly.problems[1].fix, 'the frame-size fix (sheet.scale 2) makes it: 4 columns by 1 row of 64x64 cells, a 256x64 sheet');
});

test('a trimmed atlas, an impossible size and a frame size no scale makes each get a fix that says so', () => {
  const trimmed = strip(10, { sheet: { trim: true } }), packed = check(trimmed, { sheet: { rows: 1 } });
  assert.deepEqual(Object.keys(packed.problems[0].got), ['width', 'height', 'trimmed']);
  assert.match(packed.problems[0].fix, /^a trimmed atlas packs each frame's visible bounds.*pixel_patch \[\{"set":"sheet.trim","value":false\},\{"set":"sheet.columns","value":10\}\]/);
  assert.equal(check(patched(trimmed, packed.problems[0].fix), { sheet: { rows: 1 } }).ok, true);
  // A trimmed atlas asked for a size it already has passes; it has no grid to say.
  const size = renderProject(trimmed).sheet;
  assert.equal(check(trimmed, { sheet: { width: size.width, height: size.height } }).ok, true);
  assert.equal(check(trimmed, {}).delivered.sheet, undefined);
  // No column count makes 600 px of 64 px cells.
  const none = check(strip(10), { sheet: { width: 600, height: 64 } }).problems[0].fix;
  assert.match(none, /^no grid of these 10 frames makes that sheet: with 64x64 cells/);
  assert.doesNotMatch(none, /pixel_patch/);
  // Frames of 50 px from a 64 px canvas: no whole scale, so a sheet asked by its size waits for the frame size, while
  // one asked by columns or rows is fixed at the cells it has.
  assert.match(check(strip(10), { width: 50, sheet: { width: 500, height: 50 } }).problems[1].fix, /^no whole sheet.scale makes the frame size asked for yet/);
  assert.ok(check(strip(10), { width: 50, sheet: { rows: 1 } }).problems[1].fix.startsWith('10 columns by 1 row of 64x64 cells, a 640x64 sheet: pixel_patch {"set":"sheet","value":{"columns":10}}'));
  // A frame size the export refuses at its scale (1,024 played frames at 320x320 pass its pixels): the sheet's fix
  // never carries that scale.
  const long = strip(10, { animations: { run: { frames: Array.from({ length: 1024 }, (_, i) => `f${i % 10}`) } } });
  const refused = check(long, { width: 320, height: 320, sheet: { width: 3200, height: 320 } }).problems;
  assert.match(refused[0].fix, /animation pixels/);
  assert.equal(refused[1].fix, 'the frame size asked for is refused at sheet.scale 5 (its own problem says why): settle the frame size first, then render and check the sheet again');
  assert.ok(check(long, { width: 320, height: 320, sheet: { rows: 1 } }).problems[1].fix.startsWith('10 columns by 1 row of 64x64 cells, a 640x64 sheet: pixel_patch {"set":"sheet","value":{"columns":10}}'));
  // A sheet past the atlas's pixels is refused, not offered.
  const huge = { ...strip(40), width: 256, height: 256, sheet: { scale: 2 } };
  assert.match(check(huge, { sheet: { columns: 256 } }).problems[0].fix, /^a 131072x512 sheet passes the 16,777,216 pixels an atlas holds: ask for fewer frames or a smaller size$/);
});

test('expect.sheet is refused by name when it is malformed', () => {
  for (const [sheet, where] of [[null, 'expect.sheet'], [[640, 64], 'expect.sheet'], ['640x64', 'expect.sheet'], [{}, 'expect.sheet'], [true, 'expect.sheet'], [10, 'expect.sheet'],
    [{ size: [640, 64] }, 'expect.sheet.size'], [{ Width: 640 }, 'expect.sheet.Width'], [{ width: 0 }, 'expect.sheet.width'], [{ width: '640' }, 'expect.sheet.width'], [{ height: null }, 'expect.sheet.height'],
    [{ rows: 1.5 }, 'expect.sheet.rows'], [{ rows: Number.NaN }, 'expect.sheet.rows'], [{ columns: 257 }, 'expect.sheet.columns'], [{ columns: -1 }, 'expect.sheet.columns'], [{ width: 16777217 }, 'expect.sheet.width']]) {
    assert.throws(() => readExpect({ sheet }), error => error instanceof PixelError && error.path === where, JSON.stringify(sheet));
  }
  assert.throws(() => readExpect({ Sheet: { rows: 1 } }), error => error.path === 'expect.Sheet' && /gifScale or sheet$/.test(error.message));
  assert.deepEqual(readExpect({ sheet: { width: 16777216, height: 1, columns: 256, rows: 256 } }).sheet, { width: 16777216, height: 1, columns: 256, rows: 256 });
});

test('MCP pixel_render and CLI render check the sheet, and the fixed recipe writes a 640x64 PNG', async t => {
  const tempRoot = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(tempRoot, 'pixelbolt-sheet-'));
  t.after(async () => { assert.ok(dir.startsWith(tempRoot + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const recipe = strip(10), expect = { width: 64, height: 64, frames: 10, sheet: { width: 640, height: 64 } };
  const messages = [{ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'pixel_render', arguments: { project: recipe, expect } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'pixel_render', arguments: { project: strip(10, { sheet: { columns: 10 } }), expect } } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'pixel_render', arguments: { project: recipe, expect: { sheet: { rows: 0 } } } } }];
  const result = spawnSync(process.execPath, ['bin/pixelbolt.js', 'mcp', '--out', path.join(dir, 'mcp')], { cwd: root, input: messages.map(message => JSON.stringify(message)).join('\n') + '\n', encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  const [, wrapped, strip10, refused] = result.stdout.trim().split('\n').map(line => JSON.parse(line).result);
  const missed = JSON.parse(wrapped.content[0].text), passed = JSON.parse(strip10.content[0].text);
  assert.deepEqual([missed.check.ok, missed.check.problems.map(problem => [problem.file, problem.got]), missed.check.delivered.sheet], [false, [['blast.png', { width: 512, height: 128, columns: 8, rows: 2 }]], undefined]);
  assert.equal(passed.check.ok, true);
  assert.deepEqual(pngSize(await readFile(path.join(passed.directory, 'blast.png'))), [640, 64]);
  assert.deepEqual([refused.isError, JSON.parse(refused.content[0].text).path], [true, 'expect.sheet.rows']);
  const file = path.join(dir, 'blast.json');
  await writeFile(file, JSON.stringify(recipe));
  const cli = spawnSync(process.execPath, ['bin/pixelbolt.js', 'render', file, '--out', path.join(dir, 'cli'), '--expect', '{"sheet":{"rows":1}}'], { cwd: root, encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(JSON.parse(cli.stdout).check.problems[0].fix, /pixel_patch \{"set":"sheet","value":\{"columns":10\}\}/);
});
