import test from 'node:test';
import assert from 'node:assert/strict';
import { renderProject, buildAtlas, inspectProject, analyzeProject, tileReport } from '../src/core.js';

const make = (frames, extra = {}) => ({ version: 1, name: 'probe', width: 6, height: 4, palette: { r: '#f00', g: '#0f0', b: '#00f', k: '#000' }, frames, ...extra });
const px = (frame, x, y, width = 6) => [...frame.data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
const RED = [255, 0, 0, 255], GREEN = [0, 255, 0, 255], BLUE = [0, 0, 255, 255], BLACK = [0, 0, 0, 255], CLEAR = [0, 0, 0, 0];

test('clipping reports each source location and pixel count', () => {
  const project = renderProject(make([
    { name: 'a', ops: [{ op: 'rect', x: -2, w: 4, h: 1, color: 'r' }] },
    { name: 'b', ops: [{ op: 'pixel', x: 7, color: 'r' }], layers: [{ name: 'l', x: 5, ops: [{ op: 'rect', w: 3, h: 1, color: 'g' }] }] },
    { name: 'c', from: 'a', translate: [0, -1] }
  ]));
  assert.deepEqual(project.clipping, [
    { path: 'project.frames[0].ops[0]', pixels: 2 }, { path: 'project.frames[1].ops[0]', pixels: 1 },
    { path: 'project.frames[1].layers[0]', pixels: 2 }, { path: 'project.frames[2].translate', pixels: 2 }
  ]);
  assert.deepEqual(project.warnings, ['Some drawing falls outside the canvas and is clipped: project.frames[0].ops[0] (2 px) and 3 more locations.']);
  assert.equal(renderProject(make([{ name: 'a', ops: [{ op: 'pixel', color: 'r' }] }])).clipping, undefined);
});

test('copy takes rectangles from symbols or earlier frames, with transforms, and validates its source', () => {
  const symbols = { tiles: ['rrgg', 'rrgg', 'bbkk', 'bbkk'] };
  const project = renderProject(make([
    { name: 'a', ops: [{ op: 'copy', symbol: 'tiles', sx: 1, sy: 1, w: 2, h: 2, x: 1, y: 1 }] },
    { name: 'b', ops: [{ op: 'copy', symbol: 'tiles', sx: 0, sy: 0, w: 4, h: 1, flipX: true }] },
    { name: 'c', ops: [{ op: 'copy', from: 'a', sx: 1, sy: 1, w: 1, h: 1, x: 5, y: 3, scale: 1 }] }
  ], { symbols }));
  const [a, b, c] = project.frames;
  assert.deepEqual([px(a, 1, 1), px(a, 2, 1), px(a, 1, 2), px(a, 2, 2), px(a, 0, 0)], [RED, GREEN, BLUE, BLACK, CLEAR]);
  assert.deepEqual([px(b, 0, 0), px(b, 3, 0)], [GREEN, RED]);
  assert.deepEqual(px(c, 5, 3), RED);
  assert.throws(() => renderProject(make([{ name: 'a', ops: [{ op: 'copy', symbol: 'tiles', sx: 4 }] }], { symbols })), /sx: expected an integer from 0 to 3/);
  assert.throws(() => renderProject(make([{ name: 'a', ops: [{ op: 'copy', symbol: 'tiles', from: 'a' }] }], { symbols })), /exactly one of from/);
  assert.throws(() => renderProject(make([{ name: 'a', ops: [{ op: 'copy', from: 'later' }] }, { name: 'later' }])), /earlier frame/);
  // Symbol copies remap grid characters; frame copies remap colours (next test).
  assert.throws(() => renderProject(make([{ name: 'a', ops: [{ op: 'copy', symbol: 'tiles', remap: { '#f00': 'g' } }] }], { symbols })), /single grid characters/);
});

test('frame copies remap exact colours named by palette key or hex', () => {
  const project = renderProject(make([
    { name: 'a', ops: [{ op: 'rect', w: 3, h: 1, color: 'r' }, { op: 'pixel', y: 1, color: 'k' }, { op: 'pixel', x: 1, y: 1, color: '#f008' }] },
    { name: 'b', palette: { g: '#123456' }, ops: [{ op: 'copy', from: 'a', remap: { r: 'g', '#000': 'b', '#ff000088': '#ffffff' } }] }
  ]));
  const b = project.frames[1];
  // Keys name project colours; values use this frame's palette, as everywhere else.
  assert.deepEqual([px(b, 0, 0), px(b, 2, 0), px(b, 0, 1), px(b, 1, 1), px(b, 3, 0)], [[18, 52, 86, 255], [18, 52, 86, 255], BLUE, [255, 255, 255, 255], CLEAR]);
  const variant = renderProject(make([{ name: 'a', ops: [{ op: 'rect', w: 2, h: 1, color: 'r' }] }, { name: 'b', ops: [{ op: 'copy', from: 'a', w: 1, x: 4, remap: { r: 'transparent' } }, { op: 'copy', from: 'a', x: 2, y: 2, remap: { g: 'b' } }] }])).frames[1];
  assert.deepEqual([px(variant, 4, 0), px(variant, 2, 2), px(variant, 3, 2)], [CLEAR, RED, RED]);
  for (const [remap, message] of [[{ zz: 'b' }, /remap\.zz: unknown color "zz"/], [{ transparent: 'b' }, /remap\.transparent: frame copies skip transparent pixels/], [{ r: 'b', '#ff0000': 'g' }, /remap\.#ff0000: another key already names #ff0000$/], [{ r: 'nope' }, /remap\.r: unknown color "nope"/]]) {
    assert.throws(() => renderProject(make([{ name: 'a' }, { name: 'b', ops: [{ op: 'copy', from: 'a', remap }] }])), message);
  }
});

test('outline wraps the current buffer, 4-connected by default or 8-connected with diagonal', () => {
  const dot = [{ op: 'pixel', x: 2, y: 1, color: 'r' }];
  const [plain, diagonal, layered] = renderProject(make([
    { name: 'plain', ops: [...dot, { op: 'outline', color: 'k' }] },
    { name: 'diagonal', ops: [...dot, { op: 'outline', color: 'k', diagonal: true }] },
    { name: 'layered', ops: [{ op: 'pixel', x: 5, y: 3, color: 'g' }], layers: [{ ops: [...dot, { op: 'outline', color: 'b' }] }] }
  ])).frames;
  const count = (frame, color) => { let n = 0; for (let i = 0; i < frame.data.length; i += 4) if (color.every((v, j) => frame.data[i + j] === v)) n++; return n; };
  assert.equal(count(plain, BLACK), 4); assert.deepEqual(px(plain, 1, 0), CLEAR);
  assert.equal(count(diagonal, BLACK), 8); assert.deepEqual(px(diagonal, 1, 0), BLACK);
  assert.equal(count(layered, BLUE), 4); assert.deepEqual(px(layered, 5, 3), GREEN); // Only the layer's own pixels are outlined.
});

test('remap recolors palette characters for one operation only', () => {
  const [frame] = renderProject(make([{ name: 'a', ops: [
    { op: 'grid', rows: ['rg'], remap: { r: 'b', g: '#ff00ff' } }, { op: 'grid', y: 1, rows: ['rg'] }
  ] }])).frames;
  assert.deepEqual([px(frame, 0, 0), px(frame, 1, 0), px(frame, 0, 1)], [BLUE, [255, 0, 255, 255], RED]);
  assert.throws(() => renderProject(make([{ name: 'a', ops: [{ op: 'grid', rows: ['r'], remap: { rr: 'b' } }] }])), /single grid characters/);
});

test('frame palettes recolor declared keys for that frame, including symbols and corrections', () => {
  const spec = make([
    { name: 'a', ops: [{ op: 'stamp', symbol: 'dot' }], pixels: [{ x: 1, y: 0, color: 'r' }] },
    { name: 'b', palette: { r: 'g', k: '#123456' }, ops: [{ op: 'stamp', symbol: 'dot' }], pixels: [{ x: 1, y: 0, color: 'r' }] }
  ], { symbols: { dot: ['r'] } });
  const project = renderProject(spec);
  assert.deepEqual([px(project.frames[0], 0, 0), px(project.frames[1], 0, 0), px(project.frames[1], 1, 0)], [RED, GREEN, GREEN]);
  assert.deepEqual(project.frames[1].palette, { r: '#00ff00', k: '#123456' });
  assert.equal(analyzeProject(project).findings.filter(f => f.code === 'palette').length, 0);
  assert.throws(() => renderProject(make([{ name: 'a', palette: { z: 'r' } }])), /frames\[0\]\.palette\.z: frame palettes recolor keys declared/);
});

test('layer palettes recolor keys for one layer only, on top of the frame palette', () => {
  // A strobe: the glow layer flashes white while the panel border, drawn with the same key, keeps its colour.
  const panel = { name: 'panel', ops: [{ op: 'rect', w: 6, h: 4, color: 'r', filled: false }] };
  const glow = palette => ({ name: 'glow', ...(palette && { palette }), ops: [{ op: 'rect', x: 2, y: 1, w: 2, h: 2, color: 'r' }, { op: 'grid', x: 1, y: 1, rows: ['k'] }] });
  const spec = make([
    { name: 'off', layers: [panel, glow()] },
    { name: 'flash', layers: [panel, glow({ r: '#ffffff', k: 'b' })], pixels: [{ x: 5, y: 3, color: 'k' }] },
    { name: 'cycle', palette: { r: 'g', k: 'b' }, layers: [panel, glow({ r: 'k' })] }
  ]);
  const project = renderProject(spec), [off, flash, cycle] = project.frames;
  assert.deepEqual([px(off, 0, 0), px(off, 2, 1), px(off, 1, 1)], [RED, RED, BLACK]);
  // Shapes and grids on the glow layer take its palette; the border and the frame's corrections do not.
  assert.deepEqual([px(flash, 0, 0), px(flash, 2, 1), px(flash, 1, 1), px(flash, 5, 3)], [RED, [255, 255, 255, 255], BLUE, BLACK]);
  // Values name project colours: k is black here even though the frame palette makes k blue for other drawing.
  assert.deepEqual([px(cycle, 0, 0), px(cycle, 2, 1), px(cycle, 1, 1)], [GREEN, BLACK, BLUE]);
  assert.deepEqual([flash.layerPalettes, cycle.layerPalettes, off.layerPalettes], [[{ layer: 'glow', palette: { r: '#ffffff', k: '#0000ff' } }], [{ layer: 'glow', palette: { r: '#000000' } }], undefined]);
  // Colours a layer palette introduces count as declared for the frame.
  assert.equal(analyzeProject(project).findings.filter(f => f.code === 'palette').length, 0);
  // Isolating the layer keeps its palette.
  assert.deepEqual(px(renderProject(spec, { layers: ['glow'] }).frames[1], 2, 1), [255, 255, 255, 255]);
  assert.throws(() => renderProject(make([{ name: 'a', layers: [{ palette: { z: 'r' } }] }])), /frames\[0\]\.layers\[0\]\.palette\.z: layer palettes recolor keys declared/);
  assert.throws(() => renderProject(make([{ name: 'a', layers: [{ palette: { r: 'nope' } }] }])), /layers\[0\]\.palette\.r: unknown color/);
  assert.throws(() => renderProject(make([{ name: 'a', layers: [{ palette: ['r'] }] }])), /layers\[0\]\.palette: expected an object/);
});

test('wrapping translation scrolls pixels around the canvas without clipping', () => {
  const project = renderProject(make([{ name: 'a', ops: [{ op: 'pixel', x: 5, y: 3, color: 'r' }] }, { name: 'b', from: 'a', translate: [2, 1], wrap: true }]));
  assert.deepEqual(px(project.frames[1], 1, 0), RED);
  assert.equal(project.clipping, undefined);
});

test('anchors and named points reach the atlas: anchorPx and points in exported pixels, anchor and pivot as 0-1 shares', () => {
  const project = renderProject(make([{ name: 'a' }, { name: 'b', anchor: [0, 0], points: { hand: [5, 1] } }], { anchor: [3, 4], sheet: { scale: 2 } }));
  assert.deepEqual(project.frames.map(f => f.anchor), [[3, 4], [0, 0]]);
  const { frames } = buildAtlas(project).metadata;
  assert.deepEqual([frames.a.anchorPx, frames.a.anchor, frames.a.pivot], [{ x: 6, y: 8 }, { x: 0.5, y: 1 }, { x: 0.5, y: 1 }]);
  assert.deepEqual(frames.b.points, { hand: { x: 10, y: 2 } });
  assert.equal(buildAtlas(renderProject(make([{ name: 'a' }]))).metadata.frames.a.pivot, undefined);
  assert.throws(() => renderProject(make([{ name: 'a', points: { '1st': [0, 0] } }])), /points\.1st/);
});

test('trimmed atlases pack visible bounds deterministically and keep full-canvas source coordinates', () => {
  const spec = make([
    { name: 'wide', ops: [{ op: 'rect', x: 1, y: 1, w: 4, h: 2, color: 'r' }] },
    { name: 'dot', ops: [{ op: 'pixel', x: 5, y: 0, color: 'b' }] },
    { name: 'empty' }
  ], { sheet: { trim: true, padding: 1, scale: 2 } });
  const project = renderProject(spec), atlas = buildAtlas(project), { frames } = atlas.metadata;
  assert.deepEqual(frames.wide, { frame: { x: 2, y: 2, w: 8, h: 4 }, rotated: false, trimmed: true, spriteSourceSize: { x: 2, y: 2, w: 8, h: 4 }, sourceSize: { w: 12, h: 8 }, duration: 100 });
  assert.deepEqual(frames.dot.spriteSourceSize, { x: 10, y: 0, w: 2, h: 2 });
  assert.equal(frames.empty.trimmed, true);
  const at = (x, y) => [...atlas.data.subarray((y * atlas.width + x) * 4, (y * atlas.width + x) * 4 + 4)];
  assert.deepEqual(at(frames.dot.frame.x, frames.dot.frame.y), BLUE);
  assert.deepEqual(at(frames.wide.frame.x + 7, frames.wide.frame.y + 3), RED);
  assert.ok(atlas.width * atlas.height < buildAtlas(project, { trim: false }).width * buildAtlas(project, { trim: false }).height);
  assert.deepEqual(buildAtlas(renderProject(spec)).data, atlas.data);
  assert.equal(buildAtlas(project, { trim: false }).metadata.frames.wide.trimmed, false);
});

test('tile view repeats frames 3x3 and reports doubled edges and wrap steps instead of edge equality', () => {
  const tile = ops => renderProject({ version: 1, name: 't', width: 8, height: 8, palette: { g: '#4a9a4a', k: '#1b1528', w: '#ffffff' }, frames: [{ name: 't', ops: [{ op: 'rect', w: 8, h: 8, color: 'g' }, ...ops] }] }).frames[0];
  const doubled = tileReport(tile([{ op: 'line', x: 0, y: 0, x2: 0, y2: 7, color: 'k' }, { op: 'line', x: 7, y: 0, x2: 7, y2: 7, color: 'k' }]).data, 8, 8);
  assert.equal(doubled.leftRight.doubledRows.length, 8); assert.equal(doubled.leftRight.suspicious, true);
  const stroke = tileReport(tile([{ op: 'pixel', x: 0, y: 3, color: 'k' }, { op: 'pixel', x: 1, y: 3, color: 'k' }]).data, 8, 8);
  assert.equal(stroke.leftRight.suspicious, false); assert.equal(stroke.topBottom.suspicious, false);
  // A gradient whose small interior steps cannot continue across the wrap reads as a seam.
  const step = tileReport(tile(['#101010', '#242424', '#383838', '#4c4c4c', '#606060', '#747474', '#888888', '#9c9c9c'].map((color, x) => ({ op: 'rect', x, w: 1, h: 8, color }))).data, 8, 8);
  assert.deepEqual([step.leftRight.suspicious, step.leftRight.wrapSteps, step.leftRight.interiorMaxSteps, step.topBottom.suspicious], [true, 8, 0, false]);
  const view = inspectProject(renderProject({ version: 1, name: 't', width: 4, height: 4, frames: [{ name: 't', ops: [{ op: 'pixel', color: '#fff' }] }] }), { view: 'tile', scale: 2 });
  assert.equal(view.mode, 'tile'); assert.equal(view.tiles[0].frame, 't');
  assert.equal(view.sheet.width, 12 * 2 + 2 * 2);
  assert.throws(() => inspectProject(renderProject(make([{ name: 'a' }])), { view: 'tile', region: { x: 0, y: 0, w: 1, h: 1 } }), /omit region/);
});

test('palette file references and astral grid characters fail with actionable paths', () => {
  assert.throws(() => renderProject(make([{ name: 'a' }], { palette: { $ref: 'palette.json' } })), /project\.palette\.\$ref: palette files are resolved/);
  assert.throws(() => renderProject(make([{ name: 'a', ops: [{ op: 'grid', rows: ['🌲'] }] }], { palette: { '🌲': '#0f0' } })), /single UTF-16 code units/);
});
