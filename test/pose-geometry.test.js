import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { solveReach, angleDelta } from '../src/pose-geometry.js';
import { boneEnd, rasterizeBone, rasterizeMass } from '../src/craft.js';
import { compilePoses } from '../src/authoring.js';
import { renderProject } from '../src/core.js';
import { skinkRig } from '../scripts/figure-rigs.mjs';

const bone = length => ({ length, width: [3, 3], ramp: 0, base: 1, outline: 'k' });
const source = () => ({
  format: 'pixelforge-poses', version: 1, name: 'joints', width: 32, height: 32,
  palette: { a: '#543', b: '#975', c: '#edb', k: '#123' }, ramps: [['a', 'b', 'c']],
  parts: {
    upper: { bone: bone(6), points: { end: 'end' } },
    lower: { bone: bone(5), points: { foot: 'end' } },
    hand: { rows: ['bb', 'bc'], anchor: [0, 0], points: { tip: [1, 1] } }
  },
  poses: [{ name: 'stand', origin: [16, 10], parts: [
    { name: 'hand', part: 'hand', attach: { part: 'lower', point: 'foot' } },
    { name: 'lower', part: 'lower', attach: { part: 'upper', point: 'end' }, angle: -30 },
    { name: 'upper', part: 'upper', angle: 90 }
  ], markers: [{ name: 'foot', part: 'lower', point: 'foot' }] }]
});

test('relative angles resolve forward attachments while layers and metadata keep drawing order', () => {
  const s = source(), { recipe, metadata } = compilePoses(s), parts = metadata.poses.stand.parts;
  assert.deepEqual(recipe.frames[0].layers.map(l => l.name), ['hand', 'lower', 'upper']);
  assert.deepEqual(Object.keys(parts), ['hand', 'lower', 'upper']);
  assert.equal(parts.upper.worldAngle, 90); assert.equal(parts.lower.worldAngle, 60);
  assert.deepEqual(parts.lower.joints.start, parts.upper.joints.end);
  assert.deepEqual(parts.hand.anchor, parts.lower.joints.end);
  assert.equal(parts.hand.rotate, undefined); // An attached grid stays upright by default.
  s.poses[0].parts[1].rotate = 15;
  assert.throws(() => compilePoses(s), e => e.path === 'poses.poses[0].parts[1].angle');
  delete s.poses[0].parts[1].angle;
  assert.equal(compilePoses(s).metadata.poses.stand.parts.lower.worldAngle, 15);
});

test('attachment cycles identify every participating source path', () => {
  const s = source(); s.poses[0].parts[2].attach = { part: 'lower', point: 'foot' };
  assert.throws(() => compilePoses(s), /attachment cycle:.*parts\[1\].*parts\[2\].*parts\[1\]/);
});

test('reach chooses a closest whole-pixel endpoint over a grid of targets and reports the actual error', () => {
  const first = bone(6), second = bone(5);
  // The independent oracle uses all degrees, without grouping or the solver's cache.
  const aa = Array.from({ length: 360 }, (_, a) => boneEnd(6, a));
  const bb = Array.from({ length: 360 }, (_, a) => boneEnd(5, a));
  for (let x = -9; x <= 9; x += 3) for (let y = -9; y <= 9; y += 3) {
    if (x * x + y * y > 121) continue;
    const solved = solveReach(first, second, [x, y], { rest: [90, 60] });
    let closest = Infinity;
    for (const a of aa) for (const b of bb) closest = Math.min(closest, (a[0] + b[0] - x) ** 2 + (a[1] + b[1] - y) ** 2);
    assert.ok(Math.abs(solved.error ** 2 - closest) < 1e-9);
    assert.deepEqual(solved, solveReach(first, second, [x, y], { rest: [90, 60] }));
  }
});

test('reach integrates with forward references, bend choices and out-of-range warnings', () => {
  const s = source(), lower = s.poses[0].parts[1]; delete lower.angle; lower.reach = [20, 18];
  for (const bend of ['forward', 'back']) {
    lower.bend = bend;
    const result = compilePoses(s), parts = result.metadata.poses.stand.parts;
    assert.deepEqual(parts.lower.joints.start, parts.upper.joints.end);
    assert.deepEqual(parts.lower.points.foot, [20, 18]); assert.equal(parts.lower.reach.error, 0);
    const a = parts.upper.joints.end.map((v, i) => v - parts.upper.joints.start[i]);
    const b = parts.lower.joints.end.map((v, i) => v - parts.lower.joints.start[i]);
    assert.ok((a[0] * b[1] - a[1] * b[0]) * (bend === 'forward' ? 1 : -1) >= 0);
  }
  lower.reach = [100, 100];
  const result = compilePoses(s);
  assert.equal(result.metadata.warnings[0].path, 'poses.poses[0].parts[1].reach');
  assert.equal(result.metadata.poses.stand.parts.lower.reach.unreachable, true);
  assert.equal(result.metadata.poses.stand.parts.upper.worldAngle, result.metadata.poses.stand.parts.lower.worldAngle);
});

test('reach distinguishes rounded short-bone endpoints from targets inside an unequal chain', () => {
  const rounded = solveReach(bone(1), bone(1), [2, 2]);
  assert.equal(rounded.error, 0); assert.equal(rounded.unreachable, false);
  const folded = solveReach(bone(8), bone(2), [0, 0]);
  assert.equal(folded.unreachable, true); assert.equal(folded.straightened, false);
  assert.ok(folded.error <= 6);
});

test('relative-angle tweens take the shorter arc and reach tweens interpolate targets', () => {
  const s = source(); s.poses[0].parts[2].angle = 170;
  s.poses.push({ ...structuredClone(s.poses[0]), name: 'other' }); s.poses[1].parts[2].angle = -170;
  s.poses.push({ name: 'half', tween: { from: 'stand', to: 'other', t: .5 } });
  assert.equal(compilePoses(s).metadata.poses.half.parts.upper.worldAngle, 180);
  for (const [i, target] of [[0, [20, 18]], [1, [16, 20]]]) {
    delete s.poses[i].parts[1].angle; s.poses[i].parts[1].reach = target;
  }
  assert.deepEqual(compilePoses(s).metadata.poses.half.parts.lower.reach.target, [18, 19]);
  assert.equal(angleDelta(350, 10), 20);
});

test('grid views select authored pixels and points within 22 degrees, then fall back to rotation', () => {
  const s = source();
  s.parts.hand.views = {
    0: { rows: ['cc', '.b'], anchor: [0, 0], points: { tip: [1, 0] } },
    90: { rows: ['bc', 'c.'], anchor: [1, 1], points: { tip: [0, 0] } }
  };
  s.poses[0].parts[0].rotate = 110;
  let result = compilePoses(s), hand = result.metadata.poses.stand.parts.hand;
  assert.equal(hand.view, 90); assert.deepEqual(result.recipe.symbols[hand.symbol], ['bc', 'c.']);
  assert.deepEqual(hand.points.tip, hand.anchor.map(v => v - 1));
  s.poses[0].parts[0].rotate = 113;
  result = compilePoses(s); assert.equal(result.metadata.poses.stand.parts.hand.view, undefined);
  s.parts.hand.views[90].rows = ['z'];
  assert.throws(() => compilePoses(s), e => e.path === 'poses.parts.hand.views.90.rows[0]');
});

test('plain mirrors preserve pixels and joints, while relit mirrors retain the world light', () => {
  const s = source(); s.poses[0].parts = [s.poses[0].parts[2]]; s.poses[0].markers = [];
  s.poses[0].parts[0].angle = 90;
  s.poses.push({ name: 'plain', mirror: 'stand' }, { name: 'relit', mirror: 'stand', relight: true });
  const { recipe, metadata } = compilePoses(s), project = renderProject(recipe);
  const [a, b, c] = project.frames.map(f => f.data);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) assert.deepEqual(a.slice((y * 32 + x) * 4, (y * 32 + x + 1) * 4), b.slice((y * 32 + 31 - x) * 4, (y * 32 + 32 - x) * 4));
  assert.notDeepEqual(b, c);
  assert.deepEqual(metadata.poses.plain.parts.upper.joints.start, [15, 10]);
  assert.deepEqual(metadata.poses.relit.parts.upper.joints.start, [15, 10]);
  assert.equal(metadata.poses.relit.relight, true);
});

test('a relit mirror reflects every bone end, spine and mass point exactly', () => {
  // Halves used to round toward +infinity, so a flipped bone at −θ missed the reflection of θ by a pixel.
  const rel = (part, flip) => part.spine.map(([x, y]) => `${(x - part.pivot[0]) * (flip ? -1 : 1)},${y - part.pivot[1]}`).sort().join(' ');
  for (const snap of [true, false]) for (let length = 1; length <= 16; length++) for (let angle = 0; angle < 360; angle++) {
    const [x, y] = boneEnd(length, angle, snap), [fx, fy] = boneEnd(length, -angle, snap, true);
    assert.deepEqual([fx, fy], [0 - x, y], `end of length ${length} at ${angle}° (snap ${snap})`);
    if (!snap || length % 5) continue;
    const thin = { length, width: [1, 1], base: 1, outline: null }, ramp = ['a', 'b', 'c'];
    assert.equal(rel(rasterizeBone(thin, { angle: -angle, flipX: true, ramp }), true), rel(rasterizeBone(thin, { angle, ramp }), false), `spine ${length} at ${angle}°`);
  }
  for (let angle = 0; angle < 360; angle += 15) for (const squash of [.5, 1, 1.35]) {
    const mass = { size: [12, 7], base: 1, outline: 'k' }, ramp = ['a', 'b', 'c'];
    const a = rasterizeMass(mass, { angle, squash, ramp }), b = rasterizeMass(mass, { angle: -angle, squash, flipX: true, ramp });
    const [ax, ay] = a.map([4, -2]), [bx, by] = b.map([4, -2]);
    assert.deepEqual([bx - b.pivot[0], by - b.pivot[1]], [a.pivot[0] - ax, ay - a.pivot[1]], `mass point at ${angle}°, squash ${squash}`);
  }
  // The reviewer's case, through the compiler: a relit mirror's marker matches the plain mirror's.
  for (let angle = 0; angle < 360; angle += 5) for (const length of [2, 3, 6, 9]) {
    const s = { format: 'pixelforge-poses', version: 1, name: 'm', width: 48, height: 48, palette: { k: '#000000', a: '#333333', b: '#666666' }, ramps: [['a', 'b']],
      parts: { arm: { bone: { length, width: [1, 1], ramp: 0, base: 1 }, points: { end: 'end' } } },
      poses: [{ name: 'right', origin: [24, 24], parts: [{ name: 'arm', part: 'arm', rotate: angle }], markers: [{ name: 'tip', part: 'arm', point: 'end' }] },
        { name: 'plain', mirror: 'right' }, { name: 'relit', mirror: 'right', relight: true }] };
    const { poses } = compilePoses(s).metadata;
    assert.deepEqual(poses.relit.markers[0].at, poses.plain.markers[0].at, `length ${length} at ${angle}°`);
  }
});

test('relighting a plain mirrored hierarchy preserves attachments and squash', () => {
  const s = source();
  s.parts.body = { mass: { size: [7, 5], ramp: 0, base: 1, outline: 'k' }, points: { hip: [0, 2] } };
  s.poses[0].parts.push({ name: 'body', part: 'body', squash: .8 });
  s.poses[0].parts[2].attach = { part: 'body', point: 'hip' };
  s.poses.push({ name: 'plain', mirror: 'stand' }, { name: 'back', mirror: 'plain', relight: true });
  const { recipe, metadata } = compilePoses(s), p = renderProject(recipe);
  assert.deepEqual(p.frames[0].data, p.frames[2].data);
  assert.equal(metadata.poses.back.parts.body.squash, .8);
  assert.deepEqual(metadata.poses.back.parts.lower.joints.start, metadata.poses.back.parts.upper.joints.end);
});

test('hierarchy, reach, views and relighting errors identify their source fields', () => {
  for (const [change, path] of [
    [s => { s.poses[0].parts[2].angle = 1.5; }, 'poses.poses[0].parts[2].angle'],
    [s => { s.poses[0].parts[1].bend = 'side'; }, 'poses.poses[0].parts[1].bend'],
    [s => { s.poses[0].parts[1].reach = [2, .5]; }, 'poses.poses[0].parts[1].reach'],
    [s => { s.poses[0].parts[1].reach = [2, 3]; }, 'poses.poses[0].parts[1].reach'],
    [s => { delete s.poses[0].parts[1].angle; s.poses[0].parts[1].reach = [2, 3]; s.poses[0].parts[1].at = [1, 0]; }, 'poses.poses[0].parts[1].at'],
    [s => { s.poses[0].relight = true; }, 'poses.poses[0].relight'],
    [s => { s.parts.upper.views = {}; }, 'poses.parts.upper.views'],
    [s => { s.parts.hand.views = { 360: { rows: ['b'], anchor: [0, 0] } }; }, 'poses.parts.hand.views.360'],
    [s => { s.parts.hand.views = { 90: { rows: ['b'] } }; }, 'poses.parts.hand.views.90.anchor'],
    [s => { s.parts.hand.views = { 90: { rows: ['b'], anchor: [0, 0] } }; }, 'poses.parts.hand.views.90.points.tip']
  ]) {
    const s = source(); change(s);
    assert.throws(() => compilePoses(s), error => error.path === path, path);
  }
});

// The 5 ms reach-solve budget is measured by `npm run bench -- --budgets` (reach/arm), which reports a case over budget
// without failing CI.

test('pose geometry uses no engine-dependent mathematics', async () => {
  const code = await readFile(new URL('../src/pose-geometry.js', import.meta.url), 'utf8');
  assert.doesNotMatch(code, /Math\.(sin|cos|tan|atan|atan2|acos|asin|hypot|pow|random)\s*\(/);
});

test('the 15-part, 12-frame skink reaches every marker and opens sockets without interior seams', () => {
  const s = skinkRig(), compiled = compilePoses(s);
  assert.equal(s.poses.length, 12); assert.ok(s.poses.every(p => p.parts.length === 15));
  assert.equal(compiled.metadata.warnings, undefined);
  for (const pose of s.poses) {
    const placed = compiled.metadata.poses[pose.name].parts, rasters = new Map();
    for (const instance of pose.parts) {
      const part = placed[instance.name], definition = s.parts[instance.part], shape = definition.bone ?? definition.mass;
      if (!shape) continue;
      rasters.set(instance.name, (definition.bone ? rasterizeBone : rasterizeMass)(shape, {
        angle: part.rotate ?? 0, flipX: instance.flipX === true, squash: instance.squash ?? 1, ramp: s.ramps[shape.ramp], light: s.light
      }));
      if (part.reach) { assert.equal(part.reach.error, 0, `${pose.name}/${instance.name}`); assert.deepEqual(part.joints.end, part.reach.target); }
    }
    for (const [index, instance] of pose.parts.entries()) {
      const parent = placed[instance.attach?.part], part = placed[instance.name], childRaster = rasters.get(instance.name), parentRaster = rasters.get(instance.attach?.part);
      if (!parent?.joints || !part.joints) continue;
      assert.deepEqual(part.joints.start, parent.joints.end, `${pose.name}/${instance.name} shared joint`);
      const symbols = compiled.recipe.symbols, childRows = symbols[part.symbol ?? instance.part];
      const parentIndex = pose.parts.findIndex(p => p.name === instance.attach.part);
      if (parentIndex < index) {
        for (let y = 0; y < childRaster.height; y++) for (let x = 0; x < childRaster.width; x++) {
          const px = part.topLeft[0] + x - parent.topLeft[0], py = part.topLeft[1] + y - parent.topLeft[1];
          if (childRaster.outlineMask[y * childRaster.width + x] && px >= 0 && py >= 0 && px < parentRaster.width && py < parentRaster.height
            && parentRaster.fill[py * parentRaster.width + px]) assert.equal(childRows[y][x], '.', `${pose.name}/${instance.name} seam`);
        }
      }
      // Owner decision: preserve clean diagonal limbs (eight-neighbour continuity); enforce four-way
      // connectivity locally at the shared joint instead of thickening every diagonal stroke.
      const pixels = new Set();
      for (const p of [parent, part]) for (const [y, row] of symbols[p.symbol ?? p.definition].entries()) for (let x = 0; x < row.length; x++) {
        if (row[x] !== '.' && row[x] !== ' ') pixels.add(`${p.topLeft[0] + x},${p.topLeft[1] + y}`);
      }
      const pending = [[...pixels][0]], reached = new Set(pending);
      while (pending.length) {
        const [x, y] = pending.pop().split(',').map(Number);
        for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          const next = `${x + dx},${y + dy}`;
          if (pixels.has(next) && !reached.has(next)) { reached.add(next); pending.push(next); }
        }
      }
      assert.equal(reached.size, pixels.size, `${pose.name}/${instance.name} connected masks`);
      const joint = part.joints.start, key = joint.join(','), local = new Set([key]), queue = [joint];
      assert.ok(pixels.has(key), `${pose.name}/${instance.name} joint pixel`);
      while (queue.length) {
        const [x, y] = queue.pop();
        for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
          const nx = x + dx, ny = y + dy, id = `${nx},${ny}`;
          if (Math.abs(nx - joint[0]) > 1 || Math.abs(ny - joint[1]) > 1 || !pixels.has(id) || local.has(id)) continue;
          local.add(id); queue.push([nx, ny]);
        }
      }
      for (const [p, raster] of [[parent, parentRaster], [part, childRaster]]) {
        assert.ok([...local].some(id => {
          if (id === key) return false;
          const [x, y] = id.split(',').map(Number), px = x - p.topLeft[0], py = y - p.topLeft[1];
          return px >= 0 && py >= 0 && px < raster.width && py < raster.height && raster.fill[py * raster.width + px];
        }), `${pose.name}/${instance.name} four-way joint into ${p.definition}`);
      }
    }
  }
});
