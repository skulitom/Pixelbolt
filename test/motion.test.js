import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compilePoses } from '../src/authoring.js';
import { renderProject, scalePixels } from '../src/core.js';
import { inspectMotion } from '../src/motion.js';
import { skinkRig } from '../scripts/figure-rigs.mjs';

function fixture(points, { contacts = points.map(() => ['foot']), angles = points.map(() => 0), loop = false, durations = points.map(() => 100) } = {}) {
  const recipe = { version: 1, name: 'motion', width: 16, height: 16, palette: { a: '#f00' },
    frames: points.map((p, i) => ({ name: `f${i}`, duration: durations[i], ops: [{ op: 'pixel', x: p[0], y: p[1], color: 'a' }] })),
    animations: { move: { frames: points.map((_, i) => `f${i}`), loop } } };
  const metadata = { format: 'pixelforge-pose-metadata', version: 1, rig: { ground: 12 },
    poses: Object.fromEntries(points.map((at, i) => [`f${i}`, { markers: [{ name: 'foot', at }], contacts: contacts[i], parts: { shin: { worldAngle: angles[i] } } }])) };
  const project = renderProject(recipe);
  return { project, metadata, review: options => inspectMotion(project, { animation: 'move', metadata, speed: 0, ...options }) };
}

test('motion measures planted movement, signed height and pose differences in pixels without editing inputs', () => {
  const f = fixture([[8, 12], [6, 12], [4, 12]]), before = structuredClone(f.metadata);
  assert.equal(f.review({ speed: 20 }).motion.slide[0].pixels, 0);
  assert.equal(f.review({ speed: 10 }).motion.slide[0].pixels, 2);
  assert.deepEqual(f.review().motion.groundErrors.map(e => e.pixels), [0, 0, 0]);
  const bad = fixture([[4, 10], [7, 14]]);
  assert.equal(bad.review().motion.slide[0].pixels, 5);
  assert.deepEqual(bad.review().motion.groundErrors.map(e => e.pixels), [2, -2]);
  assert.equal(bad.review().motion.checks.ground, false);
  assert.deepEqual(bad.review().motion.poseSpread[0], { from: 'f0', to: 'f1', changed: 2, opaque: 2, share: 1, minimum: .2, pass: true });
  assert.equal(fixture([[2, 12], [4, 12]]).review({ speed: -20 }).motion.slide[0].pixels, 0);
  assert.deepEqual(f.metadata, before);
});

test('contact phases merge across a loop seam, split on lifts and include the next cycle for continuously planted feet', () => {
  const wrapped = fixture([[4, 12], [5, 10], [8, 12], [6, 12]], { loop: true, contacts: [['foot'], [], ['foot'], ['foot']] }).review({ speed: 20 }).motion;
  assert.equal(wrapped.slide.length, 1);
  assert.deepEqual(wrapped.slide[0].samples.map(s => s.position), [2, 3, 0]);
  assert.equal(wrapped.slide[0].pixels, 0);
  const planted = fixture([[4, 12], [2, 12]], { loop: true }).review({ speed: 20 }).motion;
  assert.equal(planted.slide[0].pixels, 4); // The reset at the next loop is real slide.
  assert.deepEqual(planted.slide[0].samples.map(s => s.time), [0, 100, 200]);
  const split = fixture([[4, 12], [5, 10], [8, 12]], { contacts: [['foot'], [], ['foot']] }).review().motion;
  assert.equal(split.slide.length, 2);
});

test('contact diameter agrees with exhaustive pairs, including duplicate and collinear samples', () => {
  for (let seed = 1; seed <= 25; seed++) {
    let state = seed;
    const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % 16; };
    const points = Array.from({ length: 25 }, () => [next(), next()]);
    if (seed === 1) points.fill([3, 3]);
    if (seed === 2) points.forEach((p, i) => { p[0] = i % 16; p[1] = 3; });
    const speed = seed - 12, world = points.map((p, i) => [p[0] + speed * i / 10, p[1]]);
    let expected = 0;
    for (const a of world) for (const b of world) expected = Math.max(expected, Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2));
    assert.equal(fixture(points).review({ speed, scale: 1 }).motion.slide[0].pixels, Math.round(expected * 1e6) / 1e6);
  }
});

test('loop angle review uses shortest arcs and compares each joint with its own internal jumps', () => {
  const f = fixture([[4, 12], [5, 12], [6, 12]], { loop: true, angles: [350, 0, 30] });
  for (const [i, pose] of Object.values(f.metadata.poses).entries()) pose.parts.arm = { worldAngle: [0, 120, 0][i] };
  const seam = f.review().motion.loopSeam;
  assert.equal(seam.maximum, 40); assert.equal(seam.largestInternal, 120);
  assert.equal(seam.joints.find(j => j.name === 'shin').largestInternal, 30);
  assert.equal(seam.pass, false); // Another joint's large jump must not hide the shin's bad seam.
  assert.equal(fixture([[2, 12], [3, 12]], { angles: [0, 90] }).review().motion.checks.loopSeam, null);
});

test('motion reports missing information instead of claiming contacts or angles passed; images are bounded', () => {
  const f = fixture([[4, 12], [6, 12]]);
  const unknown = inspectMotion(f.project, { animation: 'move' });
  assert.equal(unknown.motion.checks.slide, null); assert.equal(unknown.motion.checks.ground, null);
  assert.equal(unknown.motion.checks.loopSeam, null); assert.equal(unknown.trajectory.shown, false);
  assert.equal(unknown.nativeSheet.scale, 1); assert.equal(unknown.sheet.scale, 4);
  assert.deepEqual(unknown.sheet.data, scalePixels(unknown.nativeSheet.data, unknown.nativeSheet.width, unknown.nativeSheet.height, 4));
  const many = fixture(Array.from({ length: 40 }, () => [4, 12]), { durations: Array(40).fill(60000) }).review({ speed: 4096, scale: 16 });
  assert.equal(many.cells.length, 32); assert.equal(many.omitted, 8); assert.equal(many.trajectory.shown, false);
  assert.ok(many.sheet.width * many.sheet.height <= 4194304);
  for (const options of [{ speed: Infinity }, { speed: '48' }, { ground: 16 }, { scale: 0 }, { animation: 'absent' }, { metadata: {} }, { frames: ['f0'] }]) assert.throws(() => f.review(options), /motion\./);
  f.metadata.poses.f0.contacts = ['absent']; assert.throws(() => f.review(), /invalid contacts/);
});

test('pose contacts are validated, mirrored and copied into playback entries; tweens declare contacts explicitly', () => {
  const source = { format: 'pixelforge-poses', version: 1, name: 'contacts', width: 16, height: 16, palette: { a: '#f00' }, rig: { ground: 12 },
    parts: { dot: { rows: ['a'], points: { end: [0, 0] } } },
    poses: [{ name: 'a', origin: [4, 12], parts: [{ name: 'leg', part: 'dot' }], markers: [{ name: 'foot', part: 'leg', point: 'end' }], contacts: ['foot'] },
      { name: 'b', mirror: 'a' }, { name: 'between', tween: { from: 'a', to: 'a', t: .5 } }] };
  const { metadata } = compilePoses(source);
  assert.deepEqual(metadata.poses.b.contacts, ['foot']); assert.deepEqual(metadata.poses.b.markers[0].at, [3, 12]);
  assert.deepEqual(metadata.animations.default.entries[1].contacts, ['foot']);
  assert.equal(metadata.poses.between.contacts, undefined);
  for (const contacts of [['missing'], ['foot', 'foot'], null, 'foot']) {
    const bad = structuredClone(source); bad.poses[0].contacts = contacts; assert.throws(() => compilePoses(bad), /contacts/);
  }
  const bad = structuredClone(source); bad.poses[1].contacts = []; assert.throws(() => compilePoses(bad), /contacts/);
});

test('old skink fails pose spread while the bone skink passes every run motion check', async () => {
  const old = JSON.parse(await readFile(new URL('../examples/quality/skink.json', import.meta.url), 'utf8'));
  const oldView = inspectMotion(renderProject(old), { animation: 'run', speed: 48 });
  assert.equal(oldView.motion.checks.poseSpread, false);
  const { recipe, metadata } = compilePoses(skinkRig()), project = renderProject(recipe);
  const start = performance.now(), view = inspectMotion(project, { animation: 'run', speed: 48, metadata });
  assert.ok(performance.now() - start < 500, 'loose CI review limit');
  assert.deepEqual(view.motion.checks, { slide: true, ground: true, poseSpread: true, loopSeam: true });
  assert.equal(Math.max(...view.motion.slide.map(p => p.pixels)), .16);
});
