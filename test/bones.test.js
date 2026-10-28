import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { rasterizeBone, rasterizeMass, cleanupIds, cosDeg, sinDeg } from '../src/craft.js';
import { compilePoses } from '../src/authoring.js';
import { renderProject, parseColor } from '../src/core.js';

const ramp = ['a', 'b', 'c', 'd'];
const shape = (length, width, extra = {}) => ({ length, width: [width, width], base: 2, outline: 'k', ...extra });
const area = raster => raster.rows.join('').replaceAll('.', '').length;
test('bone drawing cache cannot be changed through returned arrays or a later source edit', () => {
  const bone = shape(12, 4), options = { ramp, angle: 37 }, original = rasterizeBone(bone, options), expectedRows = [...original.rows], expectedPoint = original.map([12, 0]);
  const touched = rasterizeBone(bone, options);
  touched.rows.fill('x'); touched.fill.fill(0); touched.outlineMask.fill(0); touched.pivot.fill(-100); touched.end.fill(-100); touched.spine[0].fill(-100);
  const next = rasterizeBone(bone, options);
  assert.deepEqual(next.rows, expectedRows); assert.deepEqual(next.fill, original.fill); assert.deepEqual(next.outlineMask, original.outlineMask);
  assert.deepEqual(next.pivot, original.pivot); assert.deepEqual(next.end, original.end); assert.deepEqual(next.spine, original.spine);
  bone.length = 8;
  assert.deepEqual(original.map([12, 0]), expectedPoint);
  assert.notDeepEqual(rasterizeBone(bone, options).end, next.end);
});
function craft(raster, where) {
  const { width, height, rows, fill, outlineMask } = raster;
  const ids = Uint32Array.from([...rows.join('')].map(c => c === '.' ? 0 : c.charCodeAt(0)));
  const spine = new Set((raster.spine ?? []).map(([x, y]) => y * width + x));
  assert.ok(rows.every(row => /^[.abcdk]+$/.test(row)), `palette ${where}`);
  assert.equal(cleanupIds(ids, width, height, { corners: true, allowed: i => Boolean(outlineMask[i] || spine.has(i)) }).length, 0, `corners ${where}`);
  assert.equal(cleanupIds(ids, width, height, { strays: true, allowed: i => Boolean(fill[i] && !spine.has(i)) }).length, 0, `orphans ${where}`);
  // Cleanup may shave an elbow off a two-pixel spine, but may never erase either attachment joint.
  if (raster.spine) for (const [x, y] of [raster.pivot, raster.end]) assert.ok(fill[y * width + x], `joint ${where}`);
}
for (let length = 3; length <= 16; length++) {
  test(`bone craft at every angle and widths 1–6, length ${length}`, () => {
    for (let angle = 0; angle < 360; angle++) for (let width = 1; width <= 6; width++) {
      const raster = rasterizeBone(shape(length, width), { ramp, angle }), where = `${length}/${width}/${angle}`;
      craft(raster, where);
      assert.deepEqual(raster.map([length, 0]), raster.end, `end point ${where}`);
      const dx = raster.end[0] - raster.pivot[0], dy = raster.end[1] - raster.pivot[1], distance = Math.sqrt(dx * dx + dy * dy);
      if (width <= 2) {
        const minor = Math.abs(dx) >= Math.abs(dy) ? 1 : 0, runs = [];
        let previous = null;
        for (const point of raster.spine) {
          if (point[minor] === previous) runs[runs.length - 1]++;
          else { runs.push(1); previous = point[minor]; }
        }
        const internal = runs.slice(1, -1);
        if (internal.length) assert.ok(Math.max(...internal) - Math.min(...internal) <= (raster.snapped ? 0 : 1), `even runs ${where}: ${runs}`);
      }
      const section = [], centroid = [0, 0, 0], highlight = [0, 0, 0];
      for (let y = 0; y < raster.height; y++) for (let x = 0; x < raster.width; x++) if (raster.fill[y * raster.width + x]) {
        const px = x - raster.pivot[0], py = y - raster.pivot[1], along = (px * dx + py * dy) / distance;
        if (Math.abs(along - distance / 2) <= .75) section.push((-px * dy + py * dx) / distance);
        centroid[0] += x; centroid[1] += y; centroid[2]++;
        if (raster.rows[y][x] === 'd') { highlight[0] += x; highlight[1] += y; highlight[2]++; }
      }
      assert.ok(section.length, `middle section ${where}`);
      const measured = Math.max(...section) - Math.min(...section) + 1;
      assert.ok(Math.abs(measured - width) <= 1.001, `width ${where}: ${measured}`);
      if (width >= 3) {
        assert.ok(highlight[2], `highlight ${where}`);
        const facing = (highlight[0] / highlight[2] - centroid[0] / centroid[2]) * cosDeg(225)
          + (highlight[1] / highlight[2] - centroid[1] / centroid[2]) * sinDeg(225);
        assert.ok(facing > 0, `light side ${where}`);
      }
    }
  });
}

for (const start of ['round', 'flat', 'point', 'socket']) {
  test(`bone ${start} cap with every end cap and angle`, () => {
    for (const end of ['round', 'flat', 'point', 'socket']) for (let angle = 0; angle < 360; angle++) {
      const raster = rasterizeBone(shape(10, 4, { caps: [start, end], width: [3, 6, 2] }), { ramp, angle });
      craft(raster, `${start}/${end}/${angle}`);
    }
  });
}

for (const size of [[2, 2], [3, 6], [12, 7], [16, 12], [64, 64]]) for (const angle of [0, 37, 90, 140]) {
  test(`mass ${size} at ${angle} degrees keeps area through every squash step`, () => {
    const mass = { size, base: 2, outline: 'k' }, baseline = area(rasterizeMass(mass, { ramp, angle }));
    for (let step = 10; step <= 40; step++) {
      const squash = step / 20, raster = rasterizeMass(mass, { ramp, angle, squash });
      craft(raster, `${size}/${angle}/${squash}`);
      assert.ok(Math.abs(area(raster) / baseline - 1) <= .1, `area ${size}/${angle}/${squash}: ${area(raster)} vs ${baseline}`);
    }
  });
}

const source = () => ({
  format: 'pixelforge-poses', version: 1, name: 'bone-probe', width: 32, height: 32,
  palette: { k: '#151321', a: '#392c36', b: '#72504b', c: '#bc7e60', d: '#f5c184' },
  ramps: [ramp], light: 225,
  parts: {
    body: { mass: { size: [8, 5], ramp: 0, base: 2, outline: 'k' }, points: { hip: [1, 2] } },
    leg: { bone: { length: 6, width: [3, 2], ramp: 0, base: 2, outline: 'k' }, points: { end: 'end' } }
  },
  poses: [{ name: 'stand', origin: [16, 16], parts: [
    { name: 'body', part: 'body', squash: .9 },
    { name: 'leg', part: 'leg', rotate: 45, attach: { part: 'body', point: 'hip' } }
  ], markers: [{ name: 'foot', part: 'leg', point: 'end' }] }, { name: 'mirror', mirror: 'stand' }]
});

test('structural parts bake palette stamps, share variants, attach at end, and retain exact plain mirrors', () => {
  const s = source();
  s.poses.push({ name: 'again', origin: [16, 16], parts: structuredClone(s.poses[0].parts) });
  const compiled = compilePoses(s), rendered = renderProject(compiled.recipe);
  assert.deepEqual(compiled, compilePoses(s));
  assert.equal(Object.keys(compiled.recipe.symbols).length, 2);
  assert.ok(compiled.recipe.frames.every(f => f.layers.every(l => l.ops.length === 1 && l.ops[0].op === 'stamp')));
  const colors = new Set(Object.values(s.palette).map(c => parseColor(c).join(',')));
  for (const frame of rendered.frames) for (let i = 0; i < frame.data.length; i += 4) if (frame.data[i + 3]) assert.ok(colors.has([...frame.data.slice(i, i + 4)].join(',')));
  const [a, b] = rendered.frames;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) assert.deepEqual(a.data.slice((y * 32 + x) * 4, (y * 32 + x + 1) * 4), b.data.slice((y * 32 + 31 - x) * 4, (y * 32 + 32 - x) * 4));
  assert.deepEqual(compiled.metadata.poses.stand.markers[0].at, compiled.metadata.poses.stand.parts.leg.points.end);
});

test('structural fields reject invalid values with their source path', () => {
  for (const [change, path] of [
    [s => { s.light = 360; }, 'poses.light'],
    [s => { s.parts.leg.bone.length = 0; }, 'poses.parts.leg.bone.length'],
    [s => { s.parts.leg.bone.width = [1]; }, 'poses.parts.leg.bone.width'],
    [s => { s.parts.leg.bone.width = [1, 17]; }, 'poses.parts.leg.bone.width[1]'],
    [s => { s.parts.leg.bone.caps = ['bad', 'round']; }, 'poses.parts.leg.bone.caps'],
    [s => { s.parts.leg.bone.snap = 1; }, 'poses.parts.leg.bone.snap'],
    [s => { s.parts.leg.bone.ramp = 1; }, 'poses.parts.leg.bone.ramp'],
    [s => { s.parts.leg.bone.base = 4; }, 'poses.parts.leg.bone.base'],
    [s => { s.parts.leg.bone.outline = '#fff'; }, 'poses.parts.leg.bone.outline'],
    [s => { s.parts.body.mass.size = [1, 5]; }, 'poses.parts.body.mass.size[0]'],
    [s => { s.parts.body.points.hip = [65, 0]; }, 'poses.parts.body.points.hip'],
    [s => { s.parts.body.points.hip = 'end'; }, 'poses.parts.body.points.hip'],
    [s => { s.poses[0].parts[0].squash = .91; }, 'poses.poses[0].parts[0].squash'],
    [s => { s.poses[0].parts[1].squash = 1; }, 'poses.poses[0].parts[1].squash']
  ]) {
    const s = source(); change(s);
    assert.throws(() => compilePoses(s), error => error.path === path);
  }
  const s = source(); s.parts.leg.bone.outline = null; s.parts.body.mass.outline = 'selective';
  assert.doesNotThrow(() => compilePoses(s));
});

// The 1 ms budget for one maximum-sized bone (64 × 16) is measured by `npm run bench -- --budgets` (raster/bone), which
// reports a case over budget without failing CI.

test('structural rasterizers use engine-independent mathematics', async () => {
  const source = await readFile(new URL('../src/craft.js', import.meta.url), 'utf8');
  const structural = source.split('// ---- Structural parts')[1].split('// ---- Rewrite rules')[0];
  assert.doesNotMatch(structural, /Math\.(sin|cos|tan|atan|atan2|acos|asin|hypot|pow|random)\s*\(/);
});

test('unoutlined, selective, flipped and unsnapped parts preserve palette and joints', () => {
  for (const outline of [null, 'selective']) for (const flipX of [false, true]) {
    for (let angle = 0; angle < 360; angle += 7) {
      const part = rasterizeBone(shape(9, 4, { outline, snap: false, width: [3, 5, 2] }), { ramp, angle, flipX });
      craft(part, `${outline}/${flipX}/${angle}`);
      assert.equal(part.snapped, false);
      if (outline === null) assert.equal(part.outlineMask.some(Boolean), false);
      else for (let i = 0; i < part.outlineMask.length; i++) if (part.outlineMask[i]) assert.equal(part.rows[Math.floor(i / part.width)][i % part.width], 'a');
    }
  }
});

test('mass tween quantizes squash and uses stable baked variants', () => {
  const s = source(); s.poses = [s.poses[0]];
  s.poses.push({ ...structuredClone(s.poses[0]), name: 'stretch' });
  s.poses[0].parts[0].squash = .5; s.poses[1].parts[0].squash = 2;
  s.poses.push({ name: 'between', tween: { from: 'stand', to: 'stretch', t: .25 } });
  const result = compilePoses(s);
  assert.match(result.metadata.poses.between.parts.body.symbol, /s90$/);
  assert.deepEqual(result, compilePoses(s));
});
