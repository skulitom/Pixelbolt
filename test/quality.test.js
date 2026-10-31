import test from 'node:test';
import assert from 'node:assert/strict';
import { PixelError, renderProject, inspectProject, animationNeighbors, animationPosition, reviewPixels, analyzeProject, compareProjects } from '../src/core.js';
import { createZip, createBundle } from '../src/export.js';
import { patchRecipe } from '../src/patch.js';
import { createOverlay, applyOverlay } from '../src/overlays.js';
import { compilePoses } from '../src/authoring.js';

const tiny = { version: 1, name: 'probe', width: 1, height: 1, frames: [{ name: 'p', ops: [{ op: 'pixel', color: '#fff' }] }] };
test('PF-EF-001: ZIP32 accepts 65,535 entries and preflights overflow before reading entries', async () => {
  const files = new Map(Array.from({ length: 65535 }, (_, i) => [`a${i}`, Buffer.alloc(0)]));
  const zip = createZip(files); assert.equal(zip.readUInt16LE(zip.length - 12), 65535);
  files.set('overflow', Buffer.alloc(0));
  files[Symbol.iterator] = () => { throw new Error('must not read entries'); };
  assert.throws(() => createZip(files), error => error instanceof PixelError && /65,535/.test(error.message));
  const many = { ...tiny, animations: Object.fromEntries(Array.from({ length: 65525 }, (_, i) => [`a${i}`, { frames: ['p'] }])) };
  // Even an invalid drawing op is not visited before the bundle-count preflight.
  many.frames = [{ name: 'p', ops: [{ op: 'not-an-op' }] }];
  await assert.rejects(createBundle(many), /project.animations: bundle exceeds/);
  delete many.animations.a65524; many.frames = tiny.frames;
  assert.equal(Object.keys(renderProject(many).animations).length, 65524);
});
test('PF-EF-003: stamp references have the same string type as the schema', () => {
  const source = { ...tiny, symbols: { dot: ['x'] }, palette: { x: '#fff' } };
  for (const symbol of [['dot'], 1, {}, true]) assert.throws(() => renderProject({ ...source, frames: [{ name: 'p', ops: [{ op: 'stamp', symbol }] }] }), /project.frames\[0\].ops\[0\].symbol: expected a string/);
  assert.equal(renderProject({ ...source, frames: [{ name: 'p', ops: [{ op: 'stamp', symbol: 'dot' }] }] }).frames[0].data[3], 255);
});
test('PF-EF-002: oversized animation sheets can sample endpoints with honest omission metadata', () => {
  const project = renderProject({ ...tiny, width: 128, height: 128, animations: { hold: { frames: Array(1024).fill('p') } } });
  const view = inspectProject(project, { animation: 'hold', maxCells: 256 });
  assert.equal(view.sampling.omitted, 768); assert.equal(view.sampling.positions.at(-1), 1023);
  assert.ok(view.sheet.width <= 4096 && view.sheet.height <= 4096);
  assert.equal(project.animations.hold.frames.length, 1024);
});
test('review views preserve pixels; silhouette is solid even for translucent detail', () => {
  const data = new Uint8ClampedArray([255, 0, 0, 20, 0, 0, 0, 0]);
  assert.deepEqual([...reviewPixels(data, 'silhouette')], [240, 240, 240, 255, 0, 0, 0, 0]);
  assert.deepEqual([...reviewPixels(data, 'grayscale')], [54, 54, 54, 20, 0, 0, 0, 0]);
  assert.equal(data[3], 20);
  const view = inspectProject(renderProject(tiny), { native: true, diagnostics: true });
  assert.equal(view.nativeSheet.scale, 1); assert.equal(view.diagnostics.advisory, true);
});
test('layer isolation preserves inherited placement and validates the full source before hiding it', () => {
  const source = { ...tiny, width: 4, height: 2, background: '#f00', frames: [
    { name: 'a', ops: [{ op: 'pixel', x: 3, color: '#00f' }], layers: [{ name: 'body', x: 1, ops: [{ op: 'pixel', color: '#fff' }] }], pixels: [{ x: 1, y: 0, color: '#0f0' }] },
    { name: 'b', from: 'a', translate: [1, 1] }
  ] };
  const isolated = renderProject(source, { layers: ['body'] });
  assert.deepEqual([...isolated.frames[0].data.slice(4, 8)], [255, 255, 255, 255]);
  assert.equal(isolated.frames[0].data[3], 0);
  assert.equal(isolated.frames[1].data[(1 * 4 + 2) * 4 + 3], 255);
  source.frames[0].ops[0].op = 'invalid';
  assert.throws(() => renderProject(source, { layers: ['body'] }), /unknown operation/);
});
test('onion neighbors follow reverse, sparse, repeated and pingpong positions with once boundaries', () => {
  const project = renderProject({ ...tiny, frames: ['a', 'skipped', 'b', 'c'].map((name, i) => ({ name, duration: 10 * (i + 1) })), animations: { reverse: { frames: ['a', 'b', 'b', 'c'], direction: 'reverse', loop: false }, ping: { frames: ['a', 'b', 'c'], direction: 'pingpong' } } });
  const a = project.animations.reverse;
  assert.deepEqual(a.frames, [3, 2, 2, 0]);
  assert.deepEqual(animationNeighbors(a, 0), { previous: null, next: 1 });
  assert.deepEqual(animationNeighbors(a, 2), { previous: 1, next: 3 });
  assert.deepEqual(animationNeighbors(a, 3), { previous: 2, next: null });
  assert.equal(animationPosition(project, a, 40), 1); assert.equal(animationPosition(project, a, 70), 2);
  assert.equal(animationPosition(project, a, 1000), 3);
  assert.deepEqual(animationNeighbors(project.animations.ping, 0), { previous: 3, next: 1 });
  const view = inspectProject(project, { animation: 'reverse', view: 'onion', diagnostics: true });
  assert.deepEqual(view.timing.entries.map(e => e.start), [0, 40, 70, 100]);
  assert.equal(view.cells.some(c => c.frame === 'skipped'), false);
});
test('diagnostics expose deliberate isolated pixels, undeclared colors and a loop jump, without rejecting holds', () => {
  const project = renderProject({ ...tiny, width: 8, height: 8, palette: { a: '#fff' }, frames: [
    { name: 'a', ops: [{ op: 'pixel', x: 7, y: 7, color: '#f00' }] },
    { name: 'hold', from: 'a' },
    { name: 'b', from: 'a', ops: [{ op: 'rect', w: 6, h: 6, color: 'a' }] },
    { name: 'c', from: 'b', ops: [{ op: 'pixel', x: 6, color: 'a' }] }
  ] });
  const report = analyzeProject(project);
  assert.ok(report.findings.some(f => f.code === 'duplicate' && f.frame === 'hold'));
  assert.deepEqual(report.findings.find(f => f.code === 'isolated').coordinates, [{ x: 7, y: 7 }]);
  assert.ok(report.findings.some(f => f.code === 'palette'));
  const loop = renderProject({ ...tiny, width: 10, frames: Array.from({ length: 10 }, (_, i) => ({ name: `f${i}`, ops: [{ op: 'rect', w: i + 1, h: 1, color: '#fff' }] })) });
  assert.deepEqual(analyzeProject(loop).findings.find(f => f.code === 'loop-jump').box, { x: 1, y: 0, w: 9, h: 1 });
  const clean = analyzeProject(renderProject({ ...tiny, frames: [{ name: 'empty' }] }));
  assert.ok(clean.findings.some(f => f.code === 'empty'));
});
const plant = { version: 1, name: 'fern', width: 5, height: 4, palette: { g: '#496', h: '#bd8' }, frames: [
  { name: 'base', ops: [{ op: 'grid', rows: ['..g..', '.ggg.', '..g..', '..g..'] }], pixels: [{ x: 2, y: 0, color: 'h' }] },
  { name: 'sway', from: 'base', translate: [1, 0] }
] };
test('regional grids preserve dots and masks, erase explicitly, and report inherited versus frame scope', () => {
  const change = { grid: 'frames[base]', value: { x: 0, y: 0, rows: ['.h...', '.~...'], erase: '~', mask: ['.x...', '.x...'] } };
  const result = patchRecipe(plant, [change]);
  let report = compareProjects(renderProject(plant), renderProject(result.recipe));
  assert.deepEqual(report.frames.changed.map(f => f.frame), ['base', 'sway']);
  const single = patchRecipe(plant, [{ ...change, scope: 'frame' }]);
  report = compareProjects(renderProject(plant), renderProject(single.recipe));
  assert.deepEqual(report.frames.changed.map(f => f.frame), ['base']);
  assert.deepEqual(report.frames.unchanged, ['sway']);
  const rows = inspectProject(renderProject(single.recipe), { frames: ['base'], grid: true }).grids[0].rows;
  assert.deepEqual(rows, ['.hh..', '..gg.', '..g..', '..g..']);
  assert.equal(plant.frames[0].pixels.length, 1);
});
test('overlapping masked moves carry highlights and recoloring respects exact selected pixels', () => {
  const moved = patchRecipe(plant, [{ move: 'frames[base]', scope: 'frame', value: { x: 1, y: 0, w: 3, h: 2, mask: ['.x.', 'xxx'], dx: 1, dy: 1 } }]).recipe;
  const rows = inspectProject(renderProject(moved), { frames: ['base'], grid: true }).grids[0].rows;
  assert.deepEqual(rows, ['.....', '...h.', '..ggg', '..g..']);
  const recolored = patchRecipe(moved, [{ recolor: 'frames[base]', value: { x: 2, y: 2, w: 3, h: 1, from: 'g', to: 'h', mask: ['.xx'] } }]).recipe;
  assert.equal(inspectProject(renderProject(recolored), { frames: ['base'], grid: true }).grids[0].rows[2], '..ghh');
  assert.throws(() => patchRecipe(plant, [{ move: 'frames[base]', value: { x: 0, y: 0, w: 5, h: 4, dx: 1, dy: 0 } }]), /outside the canvas/);
});
test('named correction overlays survive identical rebuilds and refuse moved bases atomically', () => {
  const overlay = createOverlay(plant, [{ recolor: 'frames[base]', selection: 'tip', value: { from: 'h', to: 'g' } }], { tip: { space: 'canvas', x: 2, y: 0, w: 1, h: 1 } });
  assert.equal(applyOverlay(JSON.parse(JSON.stringify(plant)), overlay).report.frames.changed.length, 2);
  const changed = structuredClone(plant); changed.frames[0].ops[0].x = 1;
  assert.throws(() => applyOverlay(changed, overlay), /fingerprint conflict/);
  assert.equal(changed.frames[0].pixels.length, 1);
});
test('large regional batches preflight bounded edit work without changing their source', () => {
  const source = { ...tiny, width: 256, height: 256 };
  const before = JSON.stringify(source);
  assert.throws(() => patchRecipe(source, Array.from({ length: 1024 }, () => ({ move: 'frames[p]', value: { x: 0, y: 0, w: 256, h: 256, dx: 0, dy: 0 } }))), /estimated pixels/);
  assert.equal(JSON.stringify(source), before);
});
test('authored part replacements keep held objects attached and export timing in expanded order', () => {
  const source = { format: 'pixelforge-poses', version: 1, name: 'actor', width: 8, height: 8, palette: { a: '#fff' }, parts: {
    low: { rows: ['aa'], points: { grip: [1, 0] } }, high: { rows: ['a', 'a'], points: { grip: [0, 0] } }, lamp: { rows: ['a'], anchor: [0, 0], points: { light: [0, 0] } }
  }, poses: ['low', 'high'].map((part, i) => ({ name: part, duration: 80 + i * 20, origin: [2, 2], parts: [{ name: 'hand', part }, { name: 'held', part: 'lamp', attach: { part: 'hand', point: 'grip' } }], markers: [{ name: 'release', part: 'held', point: 'light' }] })), animations: { cast: { frames: ['low', 'high', 'low'], direction: 'reverse', loop: false } } };
  const { recipe, metadata } = compilePoses(source);
  assert.equal(renderProject(recipe).warnings.length, 0);
  assert.deepEqual(metadata.poses.low.parts.held.anchor, [3, 2]);
  assert.deepEqual(metadata.poses.high.parts.held.anchor, [2, 2]);
  assert.deepEqual(metadata.animations.cast.entries.map(e => e.start), [0, 80, 180]);
  assert.deepEqual(metadata.animations.cast.entries[1].markers[0].at, [2, 2]);
  source.poses[0].parts[1].attach.part = 'missing';
  assert.throws(() => compilePoses(source), /part in this pose/);
});
