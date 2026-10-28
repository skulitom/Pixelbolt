import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { renderProject, inspectProject, wildcard } from '../src/core.js';

const pixel = (sheet, x, y) => [...sheet.data.slice((y * sheet.width + x) * 4, (y * sheet.width + x) * 4 + 4)];
test('grids read pixels back as palette keys, transparency and one shared legend', () => {
  const project = renderProject({ version: 1, name: 'probe', width: 3, height: 2, palette: { r: '#f00', 0: '#0f0', gold: '#fc0' }, frames: [
    { name: 'a', ops: [{ op: 'pixel', color: 'r' }, { op: 'pixel', x: 1, color: '0' }, { op: 'pixel', x: 2, color: 'gold' }, { op: 'pixel', y: 1, color: '#00f' }, { op: 'pixel', x: 1, y: 1, color: '#f008' }] },
    { name: 'b', from: 'a', ops: [{ op: 'pixel', x: 2, y: 1, color: '#00f' }] }
  ], animations: { loop: { frames: ['a', 'b', 'a'] } } });
  const view = inspectProject(project, { animation: 'loop', grid: true });
  assert.deepEqual(view.cells.map(c => c.frame), ['a', 'b', 'a']);
  // Legend symbols skip the palette's own "0" key; repeated frames get one grid.
  assert.deepEqual(view.grids, [{ frame: 'a', rows: ['r01', '23.'] }, { frame: 'b', rows: ['r01', '232'] }]);
  assert.deepEqual(view.legend, { 1: { color: '#ffcc00', palette: 'gold' }, 2: { color: '#0000ff' }, 3: { color: '#ff000088' } });
  // Symbols belong to the revision, not the selection: frame b alone still reads #00f as 2.
  const alone = inspectProject(project, { frames: ['b'], region: { x: 0, y: 1, w: 3, h: 1 }, grid: true });
  assert.deepEqual([alone.grids[0].rows, alone.legend], [['232'], { 2: { color: '#0000ff' }, 3: { color: '#ff000088' } }]);
});
test('inspection keeps frame order, crops regions and rejects bad options with paths', () => {
  const project = renderProject({ version: 1, name: 'probe', width: 4, height: 3, palette: { k: '#000' }, frames: [{ name: 'a', duration: 80, ops: [{ op: 'pixel', x: 3, y: 2, color: 'k' }] }, { name: 'b' }] });
  const view = inspectProject(project, { frames: ['b', 'a'], region: { x: 2, y: 1, w: 2, h: 2 }, grid: true });
  assert.deepEqual(view.cells, [{ frame: 'b', duration: 100 }, { frame: 'a', duration: 80 }]);
  assert.deepEqual(view.grids.map(g => g.rows), [['..', '..'], ['..', '.k']]);
  for (const [options, message] of [
    [{ frames: ['a'], animation: 'default' }, /not both/], [{ frames: ['missing'] }, /inspect\.frames\[0\]: unknown frame/],
    [{ animation: 'missing' }, /inspect\.animation/], [{ region: { x: 3, y: 0, w: 2, h: 1 } }, /inspect\.region\.w/],
    [{ region: { x: 0, y: 0, w: 1 } }, /inspect\.region\.h/], [{ scale: 17 }, /inspect\.scale/],
    [{ zoom: 2 }, /inspect\.zoom: unknown field/], [{ grid: null }, /null is not supported/], [{ background: 'nope' }, /inspect\.background/]
  ]) assert.throws(() => inspectProject(project, options), message);
});
test('contact sheet scales cells exactly over a checkerboard inside dark gutters', () => {
  const project = renderProject({ version: 1, name: 'probe', width: 2, height: 1, palette: { r: '#f00' }, frames: [{ name: 'a', ops: [{ op: 'pixel', color: 'r' }] }, { name: 'b', ops: [{ op: 'pixel', x: 1, color: '#f008' }] }] });
  const { data, ...layout } = inspectProject(project, { scale: 3 }).sheet, sheet = { data, ...layout };
  assert.deepEqual(layout, { columns: 2, rows: 1, scale: 3, gap: 3, width: 21, height: 9 });
  assert.deepEqual(pixel(sheet, 0, 0), [23, 25, 29, 255]);
  assert.deepEqual(pixel(sheet, 3, 3), [255, 0, 0, 255]); assert.deepEqual(pixel(sheet, 5, 5), [255, 0, 0, 255]);
  assert.deepEqual(pixel(sheet, 6, 3), [143, 145, 151, 255]);
  assert.deepEqual(pixel(sheet, 15, 3), [203, 68, 70, 255]);
  const plain = inspectProject(project, { scale: 3, background: 'transparent' }).sheet;
  assert.deepEqual(pixel(plain, 15, 3), [255, 0, 0, 136]); assert.deepEqual(pixel(plain, 12, 3), [0, 0, 0, 0]);
  assert.deepEqual(pixel(inspectProject(project, { scale: 3, background: 'r' }).sheet, 12, 3), [255, 0, 0, 255]);
});
test('automatic layout picks the largest readable scale and enforces size limits', () => {
  const spirit = renderProject(JSON.parse(readFileSync(new URL('../examples/forest-spirit.json', import.meta.url), 'utf8')));
  const { columns, rows, scale, width, height } = inspectProject(spirit).sheet;
  assert.deepEqual({ columns, rows, scale, width, height }, { columns: 3, rows: 2, scale: 10, width: 760, height: 510 });
  assert.equal(inspectProject(spirit, { animation: 'idle', region: { x: 7, y: 8, w: 10, h: 6 } }).sheet.scale, 16);
  const big = renderProject({ version: 1, name: 'big', width: 256, height: 256, frames: [{ name: 'a' }] });
  assert.throws(() => inspectProject(big, { scale: 16 }), /4096-pixel limit/);
  assert.throws(() => inspectProject(big, { grid: true }), /inspect\.grid: grids are limited/);
  assert.equal(inspectProject(big, { grid: true, region: { x: 0, y: 0, w: 128, h: 128 } }).grids[0].rows.length, 128);
});
test('a stride picks the A or B frames of a strobe that evenly spaced samples would mix', () => {
  // 192 frames alternate between an A pose and a B pose, as a strobe does.
  const frames = Array.from({ length: 192 }, (_, i) => ({ name: `${i % 2 ? 'b' : 'a'}-${i}`, ops: [{ op: 'pixel', color: i % 2 ? '#fff' : '#000' }] }));
  const project = renderProject({ version: 1, name: 'strobe', width: 2, height: 2, frames, animations: { flash: { frames: frames.map(frame => frame.name) } } });
  const kinds = view => [...new Set(view.cells.map(cell => cell.frame[0]))];
  assert.deepEqual(kinds(inspectProject(project, { maxCells: 16 })), ['a', 'b']);
  const a = inspectProject(project, { step: 2 }), b = inspectProject(project, { animation: 'flash', step: 2, offset: 1, maxCells: 12 });
  assert.deepEqual([kinds(a), a.cells.length, a.sampling.positions.slice(0, 3), a.sampling.step, a.sampling.offset, a.sampling.method], [['a'], 96, [0, 2, 4], 2, 0, 'every 2nd position from 0; durations are original, not playback timing']);
  // The stride comes first, then maxCells samples what it kept; positions stay those of the whole selection.
  assert.deepEqual([kinds(b), b.cells.length, b.sampling.total, b.sampling.positions.slice(0, 3), b.sampling.positions.at(-1), b.sampling.method], [['b'], 12, 192, [1, 17, 35], 191, 'every 2nd position from 1, then evenly spaced, including endpoints; durations are original, not playback timing']);
  // Onion neighbours follow the original playback positions.
  const onion = inspectProject(project, { animation: 'flash', view: 'onion', step: 96, offset: 1, scale: 1, background: 'transparent' });
  assert.deepEqual([onion.cells.map(cell => cell.frame), onion.sampling.positions], [['b-1', 'b-97'], [1, 97]]);
  assert.deepEqual([inspectProject(project, { step: 13 }).sampling.method, inspectProject(project, { step: 21 }).sampling.method, inspectProject(project, { offset: 190 }).cells.map(cell => cell.frame)], ['every 13th position from 0; durations are original, not playback timing', 'every 21st position from 0; durations are original, not playback timing', ['a-190', 'b-191']]);
  assert.equal(inspectProject(project, { step: 1, offset: 0 }).sampling, undefined);
  // * and ? in a frame name select every matching frame, in project order.
  assert.deepEqual(inspectProject(project, { frames: ['b-1?', 'a-0'] }).cells.map(cell => cell.frame), ['b-11', 'b-13', 'b-15', 'b-17', 'b-19', 'a-0']);
  assert.equal(inspectProject(project, { frames: ['a-*'] }).cells.length, 96);
  for (const [options, message] of [[{ offset: 192 }, /inspect\.offset: the selection has 192 positions, numbered from 0; choose an offset below 192/], [{ step: 0 }, /inspect\.step/], [{ step: 1.5 }, /inspect\.step/], [{ frames: ['c-*'] }, /inspect\.frames\[0\]: no frame matches "c-\*"/], [{ frames: ['a.*'] }, /inspect\.frames\[0\]: unknown frame/]]) assert.throws(() => inspectProject(project, options), message);
  assert.equal(inspectProject(project, { frames: Array(5).fill('*'), maxCells: 4 }).sampling.total, 960);
  assert.throws(() => inspectProject(project, { frames: Array(6).fill('*') }), /inspect\.frames: the names and patterns select 1152 frames; at most 1,024 cells/);
});
test('frame-name patterns match as * and ? always did, in time proportional to pattern × name', () => {
  // Seeded random patterns and names over a small alphabet agree with the regular expression the matcher replaced.
  let seed = 7;
  const next = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const word = (alphabet, length) => Array.from({ length }, () => alphabet[next(alphabet.length)]).join('');
  for (let i = 0; i < 4000; i++) {
    const pattern = word('ab*?', 1 + next(7)), name = word('ab', next(9));
    assert.equal(wildcard(pattern, name), new RegExp(`^${pattern.replaceAll('*', '.*').replaceAll('?', '.')}$`).test(name), `${pattern} ${name}`);
  }
  // The regular expression backtracked through every *: against this name, six *a took about 4 s and eight ran for
  // over a minute. This pattern has nine.
  // Matching it now takes about a millisecond. The bound is this process's own CPU time, so other work on a busy runner
  // can't trip it; the backtracking it guards against would take minutes.
  const project = renderProject({ version: 1, name: 'long', width: 1, height: 1, frames: [{ name: 'a'.repeat(64) }] });
  const cpu = process.cpuUsage();
  assert.throws(() => inspectProject(project, { frames: ['*a*a*a*a*a*a*a*a*a*b'] }), /no frame matches/);
  const used = process.cpuUsage(cpu);
  assert.ok(used.user + used.system < 10e6, `matching took ${(used.user + used.system) / 1000} ms of CPU`);
});
test('CLI inspect takes --step and --offset', () => {
  const run = (...args) => spawnSync(process.execPath, ['bin/pixelbolt.js', 'inspect', 'examples/forest-spirit.json', ...args], { cwd: new URL('../', import.meta.url), encoding: 'utf8' });
  const view = JSON.parse(run('--animation', 'idle', '--step', '2', '--offset', '1').stdout);
  assert.deepEqual([view.cells.map(cell => cell.frame), view.sampling.positions], [['rise', 'blink', 'fall'], [1, 3, 5]]);
  assert.match(JSON.parse(run('--step', '2x').stderr).error, /--step expects a whole number/);
  assert.match(JSON.parse(run('--offset', '1.5').stderr).error, /--offset expects a whole number/);
});
