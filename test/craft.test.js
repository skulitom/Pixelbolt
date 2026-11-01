import test from 'node:test';
import assert from 'node:assert/strict';
import { renderProject, analyzeProject } from '../src/core.js';
import { patchRecipe } from '../src/patch.js';
import { createOverlay, applyOverlay } from '../src/overlays.js';
import { cleanupIds, rotateRows, ease, EASINGS, sinDeg, cosDeg, ditherThreshold } from '../src/craft.js';

const palette = { r: '#f00', b: '#00f', g: '#0f0', k: '#000', s: '#888', m: '#0a0' };
const names = new Map(Object.entries(palette).map(([key, hex]) => [renderProject({ version: 1, name: 'p', width: 1, height: 1, palette, frames: [{ name: 'a', ops: [{ op: 'pixel', color: hex }] }] }).frames[0].data.join(), key]));
const draw = (ops, width = 8, height = 8, extra = {}) => renderProject({ version: 1, name: 't', width, height, palette, frames: [{ name: 'a', ops }], ...extra });
const rows = (project, frame = 0) => Array.from({ length: project.height }, (_, y) => Array.from({ length: project.width }, (_, x) => {
  const at = (y * project.width + x) * 4, rgba = project.frames[frame].data.slice(at, at + 4);
  return rgba[3] ? names.get(rgba.join()) ?? '?' : '.';
}).join(''));
const count = (lines, char) => lines.join('').split(char).length - 1;

test('dither draws a canvas-anchored ordered pattern, ramps density and respects over/erase', () => {
  assert.deepEqual(rows(draw([{ op: 'dither', color: 'r' }])), Array.from({ length: 8 }, (_, y) => (y % 2 ? '.r' : 'r.').repeat(4)));
  // The pattern follows canvas coordinates: a region starting at x = 1 continues the same checkerboard.
  assert.deepEqual(rows(draw([{ op: 'dither', x: 1, y: 0, w: 3, h: 1, color: 'r' }]))[0], '..r.....');
  // Without w/h the region runs from x/y to the canvas edge, so an offset region never overhangs.
  const lower = draw([{ op: 'dither', y: 4, color: 'r' }]);
  assert.deepEqual([lower.warnings, count(rows(lower).slice(0, 4), 'r'), count(rows(lower), 'r')], [[], 0, 16]);
  const ramp = rows(draw([{ op: 'dither', color: 'r', density: [0, 1], direction: 'right' }]));
  assert.equal(ramp.filter(line => line[0] === 'r').length, 2);
  assert.equal(ramp.filter(line => line[7] === 'r').length, 8);
  assert.equal(count(rows(draw([{ op: 'dither', color: 'r', density: 1, pattern: 'bayer8' }])), 'r'), 64);
  assert.equal(count(rows(draw([{ op: 'dither', color: 'r', density: 0 }])), 'r'), 0);
  // over limits the pattern to exact colours; erase clears instead of drawing.
  const shaded = rows(draw([{ op: 'rect', x: 0, y: 0, w: 4, h: 8, color: 'b' }, { op: 'dither', color: 'g', density: 0.5, over: 'b' }]));
  assert.deepEqual(shaded.map(line => line.slice(4)), Array(8).fill('....'));
  assert.equal(count(shaded, 'g'), 16);
  assert.equal(count(rows(draw([{ op: 'rect', x: 0, y: 0, w: 8, h: 8, color: 'b' }, { op: 'dither', erase: true, density: 0.25 }])), 'b'), 48);
  assert.deepEqual(rows(draw([{ op: 'dither', color: 'r', density: 0.5, pattern: [[0, 1], [1, 0]] }], 4, 2)), ['r.r.', '.r.r']);
  assert.deepEqual(rows(draw([{ op: 'dither', color: 'r', density: 0.5, pattern: [[0], [1]] }], 2, 4)), ['rr', '..', 'rr', '..']);
  assert.equal(ditherThreshold('bayer2')(0, 0), 0.125);
  assert.throws(() => draw([{ op: 'dither', color: 'r', erase: true }]), /dither needs a color, or erase/);
  assert.throws(() => draw([{ op: 'dither', color: 'r', direction: 'up' }]), /density ramp/);
  assert.throws(() => draw([{ op: 'dither', color: 'r', pattern: 'bayer16' }]), /bayer2, bayer4, bayer8, noise/);
  assert.throws(() => draw([{ op: 'dither', color: 'r', pattern: [[0, 4]] }]), /pattern\[0\]\[1\]/);
  assert.throws(() => draw([{ op: 'dither', color: 'r', density: 2 }]), /density: expected a number from 0 to 1/);
});

test('noise dither is seeded and non-periodic, and a rising density only ever adds pixels', () => {
  const field = (density, seed = 7, extra = {}) => rows(draw([{ op: 'dither', color: 'r', density, pattern: 'noise', seed, ...extra }], 64, 64));
  const half = field(0.5), quarter = field(0.25);
  // About the asked share of pixels, never the same 64-pixel row twice, and a different seed gives a different field.
  assert.ok(Math.abs(count(half, 'r') - 2048) < 160, String(count(half, 'r')));
  assert.equal(new Set(half).size, 64);
  assert.notDeepEqual(field(0.5, 8), half);
  assert.deepEqual(field(0.5), half);
  // Each pixel keeps its threshold, so pixels on at 0.25 stay on at 0.5: a dissolve that never flickers back.
  assert.ok(quarter.every((line, y) => [...line].every((char, x) => char !== 'r' || half[y][x] === 'r')));
  assert.equal(count(field(1), 'r'), 4096); assert.equal(count(field(0), 'r'), 0);
  // The field follows canvas coordinates: a region continues it, and offset shifts it.
  assert.deepEqual(rows(draw([{ op: 'dither', x: 10, y: 3, w: 20, h: 1, color: 'r', pattern: 'noise', seed: 7 }], 64, 64))[3].slice(10, 30), half[3].slice(10, 30));
  assert.deepEqual(field(0.5, 7, { offset: [1, 0] })[5].slice(0, 63), half[5].slice(1));
  assert.equal(ditherThreshold('noise', [0, 0], 7)(3, 4), ditherThreshold('noise', [1, 0], 7)(2, 4));
  assert.throws(() => draw([{ op: 'dither', color: 'r', seed: 3 }]), /seed: seed chooses the noise or value pattern; set pattern to noise or value/);
  assert.throws(() => draw([{ op: 'dither', color: 'r', pattern: 'noise', seed: -1 }]), /seed: expected an integer from 0 to 2147483647/);
});

test('value dither grows seeded clumps of a chosen size and keeps density as the share of pixels drawn', () => {
  const field = (density, extra = {}) => rows(draw([{ op: 'dither', color: 'r', density, pattern: 'value', seed: 3, ...extra }], 96, 96));
  // Neighbours agree far more often than in white noise: that is what makes clumps instead of speckle.
  const agreement = lines => { let same = 0; lines.forEach((line, y) => { for (let x = 1; x < line.length; x++) if (line[x] === line[x - 1]) same++; }); return same / (lines.length * (lines[0].length - 1)); };
  const smooth = field(0.5), speckle = rows(draw([{ op: 'dither', color: 'r', density: 0.5, pattern: 'noise', seed: 3 }], 96, 96));
  assert.ok(agreement(smooth) > 0.75 && agreement(speckle) < 0.6, `${agreement(smooth)} vs ${agreement(speckle)}`);
  // Larger scales make larger clumps, and thresholds are equalized, so coverage follows density.
  assert.ok(agreement(field(0.5, { scale: 12 })) > agreement(field(0.5, { scale: 2 })));
  for (const density of [0.2, 0.5, 0.8]) assert.ok(Math.abs(count(field(density, { scale: 3 }), 'r') / 9216 - density) < 0.08, String(density));
  // Deterministic, seeded, canvas-anchored, and a rising density only adds pixels.
  assert.deepEqual(field(0.5), smooth);
  assert.notDeepEqual(field(0.5, { seed: 4 }), smooth);
  assert.ok(field(0.3).every((line, y) => [...line].every((char, x) => char !== 'r' || smooth[y][x] === 'r')));
  assert.equal(ditherThreshold('value', [2, 0], 3, 6)(5, 9), ditherThreshold('value', [0, 0], 3, 6)(7, 9));
  assert.equal(count(field(1), 'r'), 9216); assert.equal(count(field(0), 'r'), 0);
  assert.throws(() => draw([{ op: 'dither', color: 'r', pattern: 'noise', scale: 4 }]), /scale: scale sets the size of the value pattern's clumps; set pattern to value/);
  assert.throws(() => draw([{ op: 'dither', color: 'r', pattern: 'value', scale: 65 }]), /scale: expected an integer from 1 to 64/);
});

test('outline adds inside, middle, width and direction masks', () => {
  assert.deepEqual(rows(draw([{ op: 'rect', x: 2, y: 2, w: 4, h: 4, color: 'b' }, { op: 'outline', color: 'r', position: 'inside' }])).slice(2, 6), ['..rrrr..', '..rbbr..', '..rbbr..', '..rrrr..']);
  // A drop shadow grows down-right only; two rings make a longer shadow.
  assert.deepEqual(rows(draw([{ op: 'rect', x: 2, y: 2, w: 3, h: 3, color: 'b' }, { op: 'outline', color: 'r', directions: ['...', '...', '..x'], width: 2 }])).slice(2, 7), ['..bbb...', '..bbbr..', '..bbbrr.', '...rrrr.', '....rrr.']);
  // An inside rim on top edges only: pixels whose upper neighbour is transparent.
  assert.deepEqual(rows(draw([{ op: 'ellipse', x: 1, y: 1, w: 6, h: 6, color: 'b' }, { op: 'outline', color: 'g', position: 'inside', directions: ['.x.', '...', '...'] }])).slice(1, 4), ['..gggg..', '.gbbbbg.', '.bbbbbb.']);
  assert.deepEqual(rows(draw([{ op: 'rect', x: 2, y: 2, w: 4, h: 4, color: 'b' }, { op: 'outline', color: 'r', position: 'middle', width: 2 }])).slice(1, 7), ['..rrrr..', '.rrrrrr.', '.rrbbrr.', '.rrbbrr.', '.rrrrrr.', '..rrrr..']);
  // A shape cut by the canvas edge gets no inside line along that edge.
  assert.deepEqual(rows(draw([{ op: 'rect', x: 0, y: 0, w: 3, h: 3, color: 'b' }, { op: 'outline', color: 'r', position: 'inside' }], 4, 4)).slice(0, 3), ['bbr.', 'bbr.', 'rrr.']);
  assert.throws(() => draw([{ op: 'outline', color: 'r', diagonal: true, directions: ['.x.', '...', '...'] }]), /directions or diagonal/);
  assert.throws(() => draw([{ op: 'outline', color: 'r', directions: ['.x.', '.x.', '...'] }]), /centre/);
  assert.throws(() => draw([{ op: 'outline', color: 'r', position: 'around' }]), /outside, inside or middle/);
});

test('rewrite rules grow, clean and decorate deterministically', () => {
  // Growth in all four directions, two passes: a diamond.
  assert.deepEqual(rows(draw([{ op: 'pixel', x: 3, y: 3, color: 'r' }, { op: 'rewrite', empty: '_', rules: [{ match: ['r_'], replace: ['.r'] }], rotate: true, steps: 2 }])).slice(1, 6), ['...r....', '..rrr...', '.rrrrr..', '..rrr...', '...r....']);
  // A rule-based corner cleanup: overlapping fixes never both apply, so the doubled staircase becomes one line.
  assert.deepEqual(rows(draw([{ op: 'grid', rows: ['k.....', 'kk....', '.kk...', '..kk..', '...k..'] }, { op: 'rewrite', empty: '_', rules: [{ match: ['k_', 'kk'], replace: ['..', '_.'] }] }], 6, 5)), ['k.....', '.k....', '..k...', '...k..', '...k..']);
  const moss = seed => rows(draw([{ op: 'rect', x: 0, y: 3, w: 8, h: 3, color: 's' }, { op: 'rewrite', empty: '_', rules: [{ match: ['_', 's'], replace: ['m', '.'] }], chance: 0.5, seed }]))[2];
  assert.equal(moss(4), moss(4));
  assert.ok(new Set([1, 2, 3, 4, 5, 6].map(moss)).size > 1, 'different seeds pick different matches');
  assert.equal(count([rows(draw([{ op: 'rect', x: 0, y: 3, w: 8, h: 3, color: 's' }, { op: 'rewrite', empty: '_', rules: [{ match: ['_', 's'], replace: ['m', '.'] }], limit: 3 }]))[2]], 'm'), 3);
  assert.equal(count([rows(draw([{ op: 'rect', x: 0, y: 3, w: 8, h: 3, color: 's' }, { op: 'rewrite', empty: '_', rules: [{ match: ['_', 's'], replace: ['m', '.'] }], chance: 0 }]))[2]], 'm'), 0);
  // The region limits where whole matches may sit.
  assert.equal(rows(draw([{ op: 'rect', x: 0, y: 3, w: 8, h: 3, color: 's' }, { op: 'rewrite', x: 2, y: 2, w: 3, h: 2, empty: '_', rules: [{ match: ['_', 's'], replace: ['m', '.'] }] }]))[2], '..mmm...');
  // Matches whose replacement is already in place do not use up the limit.
  assert.equal(count(rows(draw([{ op: 'rect', x: 0, y: 0, w: 8, h: 8, color: 'b' }, { op: 'pixel', x: 3, y: 3, color: 'r' }, { op: 'rewrite', rules: [{ match: ['.'], replace: ['b'] }], limit: 1 }])), 'b'), 64);
  // Mirror adds the reflected rule: both sides of a peak.
  assert.deepEqual(rows(draw([{ op: 'pixel', x: 3, y: 3, color: 'r' }, { op: 'rewrite', empty: '_', rules: [{ match: ['r_'], replace: ['.r'] }], mirror: true }]))[3], '..rrr...');
  assert.throws(() => draw([{ op: 'rewrite', rules: [{ match: ['r_'], replace: ['.r'] }] }]), /set empty/);
  assert.throws(() => draw([{ op: 'rewrite', empty: '_', rules: [{ match: ['r_'], replace: ['r'] }] }]), /same size/);
  assert.throws(() => draw([{ op: 'rewrite', empty: '_', rules: [{ match: ['r_'], replace: ['..'] }] }]), /keeps every pixel/);
  assert.throws(() => draw([{ op: 'rewrite', empty: 'r', rules: [{ match: ['r'], replace: ['b'] }] }]), /empty/);
});

test('cleanup finds doubled corners and strays without touching filled areas or right-angle corners', () => {
  const grid = (lines, key = { x: 1, k: 1, g: 2, b: 3 }) => { const ids = new Uint32Array(lines.length * lines[0].length); lines.forEach((line, y) => [...line].forEach((c, x) => { ids[y * line.length + x] = key[c] ?? 0; })); return ids; };
  const staircase = cleanupIds(grid(['x......', 'xx.....', '.xx....', '..xx...', '...x...']), 7, 5, { corners: true });
  assert.deepEqual(staircase.map(({ x, y, id, kind }) => [x, y, id, kind]), [[0, 1, 0, 'corner'], [1, 2, 0, 'corner'], [2, 3, 0, 'corner']]);
  assert.equal(cleanupIds(grid(['kkkk', 'kggk', 'kggk', 'kkkk']), 4, 4, { corners: true, strays: true }).length, 0);
  assert.equal(cleanupIds(grid(['gggg', 'gggg', 'gg..', 'g...']), 4, 4, { corners: true }).length, 0);
  // A lone speck inside a fill and a pinhole both take the colour around them.
  assert.deepEqual(cleanupIds(grid(['ggg', 'gbg', 'ggg']), 3, 3, { strays: true }).map(({ id }) => id), [2]);
  assert.deepEqual(cleanupIds(grid(['ggg', 'g.g', 'ggg']), 3, 3, { strays: true }).map(({ id }) => id), [2]);
  assert.equal(cleanupIds(grid(['ggg', 'gbg', 'ggg']), 3, 3, { strays: true, allowed: index => index !== 4 }).length, 0);
  // A step out in the open goes; the same step tucked against a wall (an obstacle a liquid rests on) stays.
  const nook = grid(['.....', '.xx..', '.x...', '.x...']);
  assert.deepEqual(cleanupIds(nook, 5, 4, { corners: true }).map(({ x, y }) => [x, y]), [[1, 1]]);
  assert.equal(cleanupIds(nook, 5, 4, { corners: true, walls: index => index === 0 }).length, 0);
});

test('a cleanup patch proposes corrections with a report, and diagnostics count what it would change', () => {
  const recipe = { version: 1, name: 'fix', width: 8, height: 6, palette: { k: '#111', g: '#6a6', b: '#248' }, frames: [
    { name: 'idle', ops: [{ op: 'rect', x: 4, y: 0, w: 4, h: 3, color: 'g' }, { op: 'pixel', x: 5, y: 1, color: 'b' }, { op: 'grid', x: 0, y: 1, rows: ['k...', 'kk..', '.kk.', '..k.'] }] },
    { name: 'next', from: 'idle', translate: [0, 1] }, { name: 'hold', from: 'idle' }
  ] };
  // Counts, not findings: deliberate L-steps and specks are common in finished art. Duplicate frames reuse the count.
  const report = analyzeProject(renderProject(recipe));
  assert.deepEqual(report.frames.map(({ frame, corners, strays }) => [frame, corners, strays]), [['idle', 2, 1], ['next', 2, 1], ['hold', 2, 1]]);
  assert.equal(report.findings.filter(f => ['corners', 'strays'].includes(f.code)).length, 0);
  const { recipe: fixed, edits } = patchRecipe(recipe, [{ cleanup: 'frames[idle]', value: { corners: true } }, { cleanup: 'frames[idle]', value: { strays: true } }]);
  assert.deepEqual(edits.map(({ pixels, corners, strays }) => [pixels, corners, strays]), [[2, 2, 0], [1, 0, 1]]);
  assert.deepEqual(fixed.frames[0].pixels, [{ x: 0, y: 2, color: 'transparent' }, { x: 1, y: 3, color: 'transparent' }, { x: 5, y: 1, color: 'g' }]);
  const after = analyzeProject(renderProject(fixed)).frames[0];
  assert.deepEqual([after.corners, after.strays], [0, 0]);
  // Region, mask and colour limits keep a deliberate accent; frame scope protects inheriting frames.
  assert.equal(patchRecipe(recipe, [{ cleanup: 'frames[idle]', value: { strays: true, colors: ['k'] } }]).edits[0].pixels, 0);
  assert.equal(patchRecipe(recipe, [{ cleanup: 'frames[idle]', value: { corners: true, x: 0, y: 0, w: 2, h: 3 } }]).edits[0].pixels, 1);
  const scoped = patchRecipe(recipe, [{ cleanup: 'frames[idle]', value: { corners: true }, scope: 'frame' }]);
  assert.deepEqual(scoped.edits[0].protected, [{ frame: 'next', pixels: 2 }, { frame: 'hold', pixels: 2 }]);
  assert.throws(() => patchRecipe(recipe, [{ cleanup: 'frames[idle]', value: {} }]), /corners: true, strays: true or both/);
  assert.throws(() => patchRecipe(recipe, [{ cleanup: 'frames[idle]', value: { corners: true, w: 9 } }]), /value\.w/);
  // Overlays carry cleanup changes through rebuilds that leave the frame unchanged.
  const overlay = createOverlay(recipe, [{ cleanup: 'frames[idle]', value: { corners: true } }]);
  const rebuilt = { ...recipe, frames: [recipe.frames[0], { ...recipe.frames[1], duration: 150 }, recipe.frames[2]] };
  assert.equal(applyOverlay(rebuilt, overlay).rebased, true);
});

test('rotation keeps colours, turns around the pivot pixel and is exact at right angles', () => {
  assert.deepEqual(rotateRows(['ab', 'cd', 'ef'], 90, [0, 0]).rows, ['eca', 'fdb']);
  assert.deepEqual(rotateRows(['ab', 'cd', 'ef'], 90, [0, 0]).pivot, [2, 0]);
  assert.deepEqual(rotateRows(['ab', 'cd', 'ef'], 90, [0, 0]).map([1, 2]), [0, 1]);
  assert.deepEqual(rotateRows(['ab', 'cd'], 180, [0, 0]).rows, ['dc', 'ba']);
  assert.deepEqual(rotateRows(['ab', 'cd'], -360, [1, 1]).rows, ['ab', 'cd']);
  const bar = rotateRows(['.....', 'kkkkk', 'kwwwk', 'kkkkk', '.....'], 45, [2, 2]);
  assert.deepEqual(bar.rows, ['.k...', 'kwk..', '.kwk.', '..kwk', '...k.']);
  assert.deepEqual(bar.pivot, [2, 2]);
  const turned = rotateRows(['..w....', '.kwk...', 'kssssk.', '.kkkk..'], 30, [3, 2]), again = rotateRows(['..w....', '.kwk...', 'kssssk.', '.kkkk..'], 30, [3, 2]);
  assert.ok(turned.rows.every(row => /^[.wks]+$/.test(row)), 'no new colours');
  assert.deepEqual([turned.rows, turned.pivot], [again.rows, again.pivot]);
  // Compared with Math.sin on the reduced angle, since Math.sin itself loses bits converting large degree values.
  for (let degrees = -720; degrees <= 720; degrees += 7.5) {
    const radians = (degrees % 360) * Math.PI / 180;
    assert.ok(Math.abs(sinDeg(degrees) - Math.sin(radians)) < 1e-15 && Math.abs(cosDeg(degrees) - Math.cos(radians)) < 1e-15, `${degrees}°`);
  }
  assert.ok(sinDeg(90) === 1 && cosDeg(0) === 1 && sinDeg(180) === 0);
});

test('easing presets start at 0, end at 1 and keep their character', () => {
  for (const name of EASINGS) { assert.equal(ease(name, 0), 0, name); assert.equal(ease(name, 1), 1, name); }
  assert.equal(ease('hold', 0.99), 0);
  assert.ok(ease('in', 0.5) < 0.5 && ease('out', 0.5) > 0.5 && ease('inOut', 0.5) === 0.5);
  assert.ok(Math.max(...Array.from({ length: 99 }, (_, i) => ease('overshoot', (i + 1) / 100))) > 1);
  assert.ok(Math.abs(ease('bounce', 1 / 2.75) - 1) < 1e-12);
});
