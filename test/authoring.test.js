import test from 'node:test';
import assert from 'node:assert/strict';
import { renderProject, buildAtlas } from '../src/core.js';
import { compilePoses, compileAutotile } from '../src/authoring.js';
import { createOverlay, applyOverlay } from '../src/overlays.js';
import { encodePNG } from '../src/png.js';
import { importPNG } from '../src/import.js';
import { BLOB_MASKS, quadrantPieces, templatePiece, neighbourMask } from '../src/autotile.js';

const actor = (poses, extra = {}) => ({ format: 'pixelforge-poses', version: 1, name: 'actor', width: 12, height: 8, palette: { a: '#f00', b: '#00f' },
  parts: { body: { rows: ['aab', 'a..'], anchor: [0, 1], points: { hand: [2, 0] } }, blade: { rows: ['bb'], anchor: [0, 0], points: { tip: [1, 0] } } }, poses, ...extra });
const pixelsOf = (project, frame) => { const f = project.frames.find(x => x.name === frame); return [...f.data]; };
const mirrored = (data, width, height, originX) => {
  // Reflect pixel columns around the origin corner: c -> 2 * originX - 1 - c, as drawFrame flips.
  const out = new Array(data.length).fill(0);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const tx = 2 * originX - 1 - x;
    if (tx >= 0 && tx < width) for (let c = 0; c < 4; c++) out[(y * width + tx) * 4 + c] = data[(y * width + x) * 4 + c];
  }
  return out;
};

test('pose instances flip their grid, anchor and points inside the part', () => {
  const { recipe, metadata } = compilePoses(actor([{ name: 'right', origin: [4, 4], parts: [{ name: 'torso', part: 'body' }, { name: 'held', part: 'blade', attach: { part: 'torso', point: 'hand' } }] },
    { name: 'flipped', origin: [4, 4], parts: [{ name: 'torso', part: 'body', flipX: true }, { name: 'held', part: 'blade', attach: { part: 'torso', point: 'hand' } }] }]));
  assert.deepEqual(metadata.poses.right.parts.torso.points.hand, [6, 3]);
  // Flipped, the hand is at local x 0 and the anchor at local x 2, so the part shifts left and the hand follows.
  assert.deepEqual(metadata.poses.flipped.parts.torso.topLeft, [2, 3]);
  assert.deepEqual(metadata.poses.flipped.parts.torso.points.hand, [2, 3]);
  assert.equal(recipe.frames[1].layers[0].ops[0].flipX, true);
  assert.equal(Object.getPrototypeOf(recipe.symbols), Object.prototype);
});

test('mirrored poses reflect parts, points and markers around the origin corner and inherit timing', () => {
  const source = actor([
    { name: 'right', duration: 140, origin: [5, 6], parts: [{ name: 'torso', part: 'body' }, { name: 'held', part: 'blade', attach: { part: 'torso', point: 'hand' } }], markers: [{ name: 'hit', part: 'held', point: 'tip' }] },
    { name: 'left', mirror: 'right' }
  ]);
  const { recipe, metadata } = compilePoses(source), project = renderProject(recipe);
  assert.deepEqual(pixelsOf(project, 'left'), mirrored(pixelsOf(project, 'right'), 12, 8, 5));
  assert.deepEqual([metadata.poses.right.markers[0].at, metadata.poses.left.markers[0].at], [[8, 5], [1, 5]]);
  assert.deepEqual(project.frames.map(f => [f.name, f.duration]), [['right', 140], ['left', 140]]);
  assert.deepEqual([recipe.anchor, recipe.frames[1].points], [[5, 6], { hit: [1, 5] }]);
  assert.throws(() => compilePoses(actor([{ name: 'left', mirror: 'right' }, { name: 'right', origin: [0, 0], parts: [] }])), /earlier pose/);
  assert.throws(() => compilePoses(actor([{ name: 'right', parts: [] }, { name: 'left', mirror: 'right', origin: [1, 1] }])), /its origin/);
});

test('pose origins become recipe or frame anchors and markers become atlas points', () => {
  const varying = compilePoses(actor([{ name: 'low', origin: [4, 6], parts: [{ name: 'torso', part: 'body' }], markers: [{ name: 'hand', part: 'torso', point: 'hand' }] }, { name: 'high', origin: [4, 5], parts: [{ name: 'torso', part: 'body' }] }]));
  assert.equal(varying.recipe.anchor, undefined);
  assert.deepEqual(varying.recipe.frames.map(f => f.anchor), [[4, 6], [4, 5]]);
  const atlas = buildAtlas(renderProject(varying.recipe)).metadata.frames;
  assert.deepEqual([atlas.low.anchorPx, atlas.low.points, atlas.high.points], [{ x: 4, y: 6 }, { hand: { x: 6, y: 5 } }, undefined]);
  assert.throws(() => compilePoses(actor([{ name: 'p', parts: [{ name: 'torso', part: 'body' }], markers: [{ name: 'm', part: 'torso', point: 'hand' }, { name: 'm', part: 'torso', point: 'hand' }] }])), /unique within a pose/);
});

// A template whose 20 pieces are each a distinct color, so every composed quadrant can be traced to its source.
function tracerTemplate(tile) {
  const q = tile / 2, keys = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', rows = Array.from({ length: tile * 3 }, () => Array(tile * 2).fill('.'));
  const palette = {}, owner = new Map(); let n = 0;
  for (const position of ['tl', 'tr', 'bl', 'br']) for (const piece of ['o', 'h', 'v', 'f', 'i']) {
    const [sx, sy] = templatePiece(tile, position, piece), key = keys[n];
    palette[key] = `#${(n * 12 + 16).toString(16).padStart(2, '0')}0000`; owner.set(key, `${position}-${piece}`); n++;
    for (let y = 0; y < q; y++) for (let x = 0; x < q; x++) rows[sy + y][sx + x] = key;
  }
  return { rows: rows.map(r => r.join('')), palette, owner };
}
test('autotile compiler composes every blob mask from the template pieces its neighbours call for', () => {
  const { rows, palette, owner } = tracerTemplate(4);
  const { recipe, metadata } = compileAutotile({ format: 'pixelforge-autotile', version: 1, name: 'sand', tile: 4, palette, template: rows, frame: 'sand-{mask}' });
  assert.equal(recipe.frames.length, 47); assert.deepEqual(metadata.masks, [...BLOB_MASKS]);
  const project = renderProject(recipe), keyOf = new Map(Object.entries(palette).map(([k, v]) => [parseInt(v.slice(1, 3), 16), k]));
  for (const mask of BLOB_MASKS) {
    const frame = project.frames.find(f => f.name === `sand-${mask}`), pieces = quadrantPieces('blob', mask);
    for (const [position, [x, y]] of Object.entries({ tl: [0, 0], tr: [2, 0], bl: [0, 2], br: [2, 2] })) {
      assert.equal(owner.get(keyOf.get(frame.data[(y * 4 + x) * 4])), `${position}-${pieces[position]}`, `mask ${mask} ${position}`);
    }
  }
  // An isolated tile uses four outer corners; a fully surrounded one uses four fills.
  assert.deepEqual(quadrantPieces('blob', 0), { tl: 'o', tr: 'o', bl: 'o', br: 'o' });
  assert.deepEqual(quadrantPieces('blob', 255), { tl: 'f', tr: 'f', bl: 'f', br: 'f' });
  assert.equal(neighbourMask('blob', (dx, dy) => !(dx === 1 && dy === 1)), 255 - 8);
});

test('autotile variants become palette-cycled frames with one animation per mask', () => {
  const { rows, palette } = tracerTemplate(2);
  const { recipe } = compileAutotile({ format: 'pixelforge-autotile', version: 1, name: 'surf', tile: 2, mode: 'cardinal', palette, template: rows,
    frame: 'surf-{mask}-{variant}', animation: 'surf-{mask}', variants: [{ name: 'calm', duration: 200 }, { name: 'break', duration: 120, palette: { A: '#ffffff' } }] });
  assert.equal(recipe.frames.length, 32); assert.equal(Object.keys(recipe.animations).length, 16);
  assert.deepEqual(recipe.animations['surf-0'].frames, ['surf-0-calm', 'surf-0-break']);
  const project = renderProject(recipe), calm = project.frames.find(f => f.name === 'surf-0-calm'), rough = project.frames.find(f => f.name === 'surf-0-break');
  assert.notDeepEqual([...calm.data.subarray(0, 4)], [...rough.data.subarray(0, 4)]);
  assert.throws(() => compileAutotile({ format: 'pixelforge-autotile', version: 1, name: 'x', tile: 4, template: rows, frame: 'x' }), /12 rows of 8 characters|\{mask\}/);
  assert.throws(() => compileAutotile({ format: 'pixelforge-autotile', version: 1, name: 'x', tile: 2, palette, template: rows, frame: 'x-{mask}', variants: [{ name: 'a' }] }), /\{variant\}/);
});

test('the autotile op draws the quarters a mask selects, exactly like four copies, and the compiler emits one per frame', () => {
  const { rows, palette } = tracerTemplate(4);
  const draw = (ops, symbols = { template: rows }) => renderProject({ version: 1, name: 't', width: 4, height: 4, palette, symbols, frames: [{ name: 'a', ops }] }).frames[0].data;
  for (const [mode, masks] of [['blob', BLOB_MASKS], ['cardinal', Array.from({ length: 16 }, (_, m) => m)]]) for (const mask of masks) {
    const pieces = quadrantPieces(mode, mask);
    const copies = Object.entries({ tl: [0, 0], tr: [2, 0], bl: [0, 2], br: [2, 2] }).map(([position, [x, y]]) => { const [sx, sy] = templatePiece(4, position, pieces[position]); return { op: 'copy', symbol: 'template', sx, sy, w: 2, h: 2, x, y }; });
    assert.deepEqual(draw([{ op: 'autotile', symbol: 'template', mask, mode }]), draw(copies), `${mode} ${mask}`);
  }
  // Raw blob masks reduce: a diagonal without both of its sides does not count.
  assert.deepEqual(draw([{ op: 'autotile', symbol: 'template', mask: 2 }]), draw([{ op: 'autotile', symbol: 'template', mask: 0 }]));
  const { recipe } = compileAutotile({ format: 'pixelforge-autotile', version: 1, name: 'sand', tile: 4, palette, template: rows, frame: 'sand-{mask}' });
  assert.deepEqual(recipe.frames[5].ops, [{ op: 'autotile', symbol: 'template', mask: BLOB_MASKS[5] }]);
  assert.throws(() => draw([{ op: 'autotile', symbol: 'template', mask: 16, mode: 'cardinal' }]), /mask: expected an integer from 0 to 15/);
  assert.throws(() => draw([{ op: 'autotile', symbol: 'odd', mask: 0 }], { odd: ['AAA'] }), /two tiles wide and three tall/);
});

test('canvas-only overlays survive unrelated base edits but refuse changes to the frames they touch', () => {
  const base = { version: 1, name: 'fern', width: 4, height: 4, palette: { g: '#0a0', h: '#6c6', k: '#000' }, frames: [
    { name: 'still', ops: [{ op: 'rect', x: 1, y: 1, w: 2, h: 2, color: 'g' }] }, { name: 'sway', from: 'still', translate: [1, 0] }, { name: 'other', duration: 90 }
  ] };
  const overlay = createOverlay(base, [{ grid: 'frames[still]', value: { x: 1, y: 1, rows: ['h'] } }]);
  assert.deepEqual(Object.keys(overlay.frames), ['still', 'sway']); assert.deepEqual(overlay.colors, { h: '#66cc66ff' });
  const unrelated = structuredClone(base); unrelated.frames[2].duration = 120; unrelated.frames[2].ops = [{ op: 'pixel', color: 'k' }];
  const applied = applyOverlay(unrelated, overlay);
  assert.equal(applied.rebased, true); assert.deepEqual(applied.report.frames.changed.map(f => f.frame), ['still', 'sway']);
  const touched = structuredClone(base); touched.frames[0].ops[0].w = 3;
  assert.throws(() => applyOverlay(touched, overlay), /frame still changed/);
  const recolored = structuredClone(base); recolored.palette.h = '#fff';
  assert.throws(() => applyOverlay(recolored, overlay), /palette h changed/);
  const legacy = { ...overlay }; delete legacy.frames; delete legacy.targets; delete legacy.colors;
  assert.throws(() => applyOverlay(unrelated, legacy), /fingerprint conflict/);
});

test('PNG import keeps up to 256 colours as compact, lossless palette grids', () => {
  const width = 16, height = 16, data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([i, 255 - i, (i * 7) & 255, 255], i * 4);
  const imported = importPNG(encodePNG(data, width, height), { name: 'rich' });
  assert.equal(imported.provenance.representation, 'palette grids with hidden-RGB corrections');
  assert.equal(Object.keys(imported.recipe.palette).length, 256);
  assert.deepEqual([...renderProject(imported.recipe).frames[0].data], [...data]);
});

// A 2D context stand-in that rasterizes drawImage through translate/scale(-1, 1), sampling pixel centres.
function rasterContext(width, height) {
  const out = new Uint8ClampedArray(width * height * 4), stack = [];
  let tx = 0, ty = 0, sx = 1;
  return {
    out, imageSmoothingEnabled: true,
    save() { stack.push([tx, ty, sx]); }, restore() { [tx, ty, sx] = stack.pop(); },
    translate(x, y) { tx += x * sx; ty += y; }, scale(a) { sx *= a; },
    drawImage(image, srcX, srcY, srcW, srcH, dx, dy, dw, dh) {
      for (let j = 0; j < dh; j++) for (let i = 0; i < dw; i++) {
        const u = srcX + Math.floor(i * srcW / dw), v = srcY + Math.floor(j * srcH / dh), from = (v * image.width + u) * 4;
        const X = Math.floor(tx + sx * (dx + i + 0.5)), Y = Math.floor(ty + dy + j + 0.5);
        if (X >= 0 && Y >= 0 && X < width && Y < height && image.data[from + 3]) out.set(image.data.subarray(from, from + 4), (Y * width + X) * 4);
      }
    }
  };
}
test('a compiled mirror placed by its anchor draws exactly what drawFrame draws when flipping the original', async () => {
  const { drawFrame } = await import('../src/runtime.js');
  for (const trim of [false, true]) {
    const { recipe } = compilePoses(actor([
      { name: 'right', origin: [5, 6], parts: [{ name: 'torso', part: 'body' }, { name: 'held', part: 'blade', attach: { part: 'torso', point: 'hand' } }] },
      { name: 'left', mirror: 'right' }
    ], { sheet: { trim } }));
    const atlas = buildAtlas(renderProject(recipe)), sheet = { image: { data: atlas.data, width: atlas.width }, atlas: atlas.metadata };
    const flipped = rasterContext(32, 24), mirrored = rasterContext(32, 24);
    drawFrame(flipped, sheet, 'right', 16, 12, { flipX: true });
    drawFrame(mirrored, sheet, 'left', 16, 12);
    assert.ok(flipped.out.some(v => v), 'something was drawn');
    assert.deepEqual(mirrored.out, flipped.out, `trim ${trim}`);
  }
});
