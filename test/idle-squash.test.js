import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { compilePoses, expandPoses } from '../src/authoring.js';
import { renderProject, buildAtlas, PixelError } from '../src/core.js';
import { rasterizeMass } from '../src/craft.js';
import { animationGIF } from '../src/gif.js';
import { inspectMotion } from '../src/motion.js';
import { decodeGIF } from './fixtures/decode-gif.js';

const read = async file => JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
const hash = data => createHash('sha256').update(data).digest('hex');
const slime = await read('examples/slime-idle.poses.json');
const palette = { k: '#1d2b3a', d: '#2b7a3d', g: '#3fa34d', l: '#8fd16a', w: '#f4f4e8' };
// A one-mass rig whose rest pose stands above rig.ground, so grounding has to move it.
const blob = ({ mass = {}, idle = {}, body = {}, face = [0, -2] } = {}) => ({ format: 'pixelforge-poses', version: 1, name: 'blob', width: 64, height: 48, palette, ramps: [['d', 'g', 'l']],
  parts: { body: { mass: { size: [20, 12], ramp: 0, base: 1, outline: 'k', ...mass }, points: { face } }, eyes: { rows: ['w...w', 'k...k'], anchor: [2, 0] } },
  poses: [{ name: 'rest', origin: [32, 30], parts: [{ name: 'body', part: 'body', ...body }, { name: 'eyes', part: 'eyes', attach: { part: 'body', point: 'face' } }] }],
  rig: { ground: 40, body: 'body', rest: 'rest', head: 'eyes' }, motions: { idle: { template: 'idle', ...idle } } });
// A small two-legged rig with a head and a tail, standing on rig.ground.
const strider = idle => {
  const bone = (length, width, base = 1) => ({ bone: { length, width, ramp: 0, base, outline: 'k' }, points: { end: 'end' } });
  const leg = (side, hip, base) => [{ name: `${side}Thigh`, part: `${base ? '' : 'far'}thigh`, attach: { part: 'body', point: hip }, angle: 90 },
    { name: `${side}Shin`, part: `${base ? '' : 'far'}shin`, attach: { part: `${side}Thigh`, point: 'end' }, angle: 0 }];
  return { format: 'pixelforge-poses', version: 1, name: 'strider', width: 32, height: 32, palette, ramps: [['d', 'g', 'l']],
    parts: { body: { mass: { size: [10, 8], ramp: 0, base: 1, outline: 'k' }, points: { near: [2, 3], far: [-2, 3], neck: [2, -4], back: [-5, 0] } },
      thigh: bone(4, [3, 2]), shin: bone(4, [2, 2]), farthigh: bone(4, [3, 2], 0), farshin: bone(4, [2, 2], 0), tail: bone(4, [2, 1]),
      head: { rows: ['.kkk.', 'kwwgk', 'kwkgk', '.kkk.'], anchor: [2, 3] } },
    poses: [{ name: 'stand', origin: [16, 28], parts: [...leg('far', 'far', false), { name: 'tail', part: 'tail', attach: { part: 'body', point: 'back' }, angle: 160 },
      { name: 'body', part: 'body', at: [0, -11] }, { name: 'head', part: 'head', attach: { part: 'body', point: 'neck' } }, ...leg('near', 'near', true)] }],
    rig: { ground: 28, body: 'body', head: 'head', rest: 'stand', tail: ['tail'], legs: [['nearThigh', 'nearShin'], ['farThigh', 'farShin']] },
    motions: { idle: { template: 'idle', ...idle } } };
};
const refused = (source, pattern) => {
  for (const run of [compilePoses, expandPoses]) assert.throws(() => run(source), error => error instanceof PixelError && pattern.test(error.message), `${run.name}: ${pattern.source}`);
};

// The silhouette of one rendered frame: its box, and how many pixels of its lowest row are opaque.
function silhouette({ data }, width, height) {
  let left = width, right = -1, top = height, lowest = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3]) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); lowest = y; }
  let contact = 0;
  for (let x = 0; x < width; x++) if (lowest >= 0 && data[(lowest * width + x) * 4 + 3]) contact++;
  return { lowest, width: right - left + 1, height: lowest - top + 1, contact };
}
const idleFrames = (project, name = 'idle') => project.animations[name].frames.map(index => project.frames[index]);

test('the slime idle keeps its lowest row on rig.ground in every frame, its base on the ground, gentle height changes and a passing motion review', () => {
  const { recipe, metadata, warnings } = compilePoses(slime), project = renderProject(recipe), { width, height } = project;
  assert.equal(warnings, undefined);
  // Past four frames the quarter phases are the key poses, and the motion review passes them.
  assert.deepEqual(metadata.animations.idle.keyPoses, ['idle-0', 'idle-2', 'idle-4', 'idle-6']);
  for (const [name, pass] of Object.entries(inspectMotion(project, { animation: 'idle', metadata, scale: 1 }).motion.checks)) assert.notEqual(pass, false, name);
  const shapes = idleFrames(project).map(frame => silhouette(frame, width, height));
  assert.equal(shapes.length, 8);
  shapes.forEach((shape, i) => {
    assert.equal(shape.lowest, slime.rig.ground, `frame ${i} lowest row`);
    assert.ok(shape.contact * 2 >= shape.width, `frame ${i}: ${shape.contact} of ${shape.width} pixels touch the ground`);
    const next = shapes[(i + 1) % shapes.length];
    assert.ok(Math.abs(next.height - shape.height) <= 2, `frames ${i} and ${(i + 1) % shapes.length}: heights ${shape.height} and ${next.height}`);
  });
  // It does squash and stretch: the tallest frame is narrower than the flattest one.
  const tallest = shapes.reduce((a, b) => b.height > a.height ? b : a), flattest = shapes.reduce((a, b) => b.height < a.height ? b : a);
  assert.ok(tallest.height > flattest.height && tallest.width < flattest.width);
  // Grounding moves the body, not the origin, so every frame keeps one anchor on the ground.
  assert.deepEqual(recipe.anchor, slime.poses[0].origin);
  assert.ok(recipe.frames.every(frame => frame.anchor === undefined));
});

test('the slime idle passes the sprite task checks: size, frames, looping GIF, crisp alpha, colours, background, content and motion', () => {
  const { recipe } = compilePoses(slime), project = renderProject(recipe), { width, height } = project, area = width * height;
  assert.deepEqual([width, height], [32, 32]);
  const atlas = buildAtlas(project), cells = Object.entries(atlas.metadata.frames);
  assert.equal(project.frames.length, 8);
  assert.equal(cells.length, 8);
  const frames = idleFrames(project);
  assert.deepEqual(frames.map(frame => frame.name), cells.map(([name]) => name));
  const gif = animationGIF(project, 'idle'), decoded = decodeGIF(gif.data);
  assert.equal(decoded.frames.length, 8);
  assert.equal(decoded.loop, 0, 'loops forever');
  const colors = new Set();
  let largest = 0;
  for (const frame of frames) {
    let opaque = 0;
    for (let i = 0; i < area; i++) {
      const alpha = frame.data[i * 4 + 3];
      assert.ok(alpha === 0 || alpha === 255, `${frame.name}: alpha ${alpha}`);
      if (alpha) { opaque++; colors.add(frame.data.slice(i * 4, i * 4 + 3).join()); }
    }
    for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]]) assert.equal(frame.data[(y * width + x) * 4 + 3], 0, `${frame.name} corner ${x},${y}`);
    assert.ok(opaque > 0 && (area - opaque) / area >= .2, `${frame.name}: ${opaque} opaque pixels`);
    largest = Math.max(largest, opaque / area);
  }
  assert.ok(colors.size <= 8, `${colors.size} colours`);
  assert.ok(largest >= .1, `largest opaque share ${largest}`);
  const zeroed = frame => Array.from(frame.data, (value, i) => frame.data[i - i % 4 + 3] ? value : 0).join();
  frames.forEach((frame, i) => assert.notEqual(zeroed(frame), zeroed(frames[(i + 1) % frames.length]), `${frame.name} and the next frame are the same`));
  // The GIF's frames are the sheet's frames, cell by cell.
  cells.forEach(([name, { frame: cell }], i) => {
    const sheet = [];
    for (let y = 0; y < cell.h; y++) for (let x = 0; x < cell.w; x++) {
      const at = ((cell.y + y) * atlas.width + cell.x + x) * 4;
      sheet.push(atlas.data[at + 3] ? Buffer.from(atlas.data.slice(at, at + 3)).toString('hex') : 'clear');
    }
    assert.deepEqual(decoded.frames[i].pixels, sheet, name);
  });
});

test('a grounded squash puts the body\'s lowest drawn pixel on rig.ground for ellipses and flat masses, outlined or not, turned, flipped or squashed', () => {
  const masses = [{}, { flat: true }, { outline: null }, { flat: true, outline: 'selective' }, { flat: true, outline: null }];
  const bodies = [{}, { flipX: true }, { angle: 20 }, { squash: 1.2 }];
  const idles = [{ frames: 8, squash: .15 }, { frames: 5, squash: .5 }, { frames: 16, squash: .05 }, { frames: 2, squash: .3 }, { frames: 3, squash: .2 }, { squash: .1 }];
  for (const mass of masses) for (const body of bodies) for (const idle of idles) {
    const source = blob({ mass, body, idle, face: [0, -4] }), { recipe, warnings } = compilePoses(source), project = renderProject(recipe), label = JSON.stringify({ mass, body, idle });
    assert.equal(warnings, undefined, label);
    const frames = idleFrames(project);
    assert.equal(frames.length, idle.frames ?? 4, label);
    for (const frame of frames) assert.equal(silhouette(frame, project.width, project.height).lowest, source.rig.ground, `${label} ${frame.name}`);
    assert.ok(new Set(frames.map(frame => hash(frame.data))).size > 1, `${label}: every frame draws the same`);
    assert.deepEqual(recipe.anchor, source.poses[0].origin, label);
  }
});

test('idle takes 2 to 16 frames, numbers poses past four, and refuses squash with breath, with legs or out of range', () => {
  for (const frames of [5, 6, 7, 8]) {
    const expanded = expandPoses(blob({ idle: { frames } })), names = expanded.animations.idle.frames;
    assert.deepEqual(names, Array.from({ length: frames }, (_, i) => `idle-${i}`));
    const squashes = names.map(name => expanded.poses.find(pose => pose.name === name).parts.find(part => part.name === 'body').squash);
    assert.ok(new Set(squashes).size > 1, `${frames} frames breathe`);
    assert.equal(compilePoses(blob({ idle: { frames } })).warnings, undefined);
  }
  // Two to four frames keep their breathing names with squash too.
  assert.deepEqual(expandPoses(blob({ idle: { squash: .1 } })).animations.idle.frames, ['idle-rest', 'idle-inhale', 'idle-settle', 'idle-exhale']);
  for (const frames of [1, 17]) refused(blob({ idle: { frames } }), /^poses\.motions\.idle\.frames: expected an integer from 2 to 16$/);
  refused(blob({ idle: { breath: .1, squash: .1 } }), /^poses\.motions\.idle\.squash: choose breath or squash, not both/);
  for (const squash of [0, .01, .6, '0.1']) refused(blob({ idle: { squash } }), /^poses\.motions\.idle\.squash: expected a number from 0\.05 to 0\.5$/);
  assert.equal(compilePoses(strider({})).warnings, undefined);
  refused(strider({ squash: .1 }), /^poses\.motions\.idle\.squash: squash sits the body on rig\.ground, but this rig stands on its legs/);
  refused(blob({ mass: { flat: 'yes' } }), /^poses\.parts\.body\.mass\.flat: expected a boolean$/);
});

test('a grounded idle refuses an authored stand-in pose whose body is off rig.ground, and a body that is also the head or tail', () => {
  // The rest pose named idle-0 stands in for the loop's first frame; it is the author's, so it is checked, not moved.
  const lifted = structuredClone(slime); lifted.poses[0].parts[0].at = [0, -4];
  refused(lifted, /^poses\.poses\[0\]: "idle-0" stands in for a pose of the grounded idle "idle", so its body must stand on rig\.ground \(row 28\); its lowest pixel is on row 25$/);
  // Any authored pose with a generated name counts, measured as drawn: its own squash, angle and flip.
  const extra = (body, at = [0, -1]) => { const source = structuredClone(slime); source.poses.push({ name: 'idle-3', duration: 140, origin: [16, 28], parts: [{ name: 'body', part: 'body', at, ...body }, ...source.poses[0].parts.slice(1)] }); return source; };
  for (const body of [{ squash: 1.1 }, { squash: .85, flipX: true }]) {
    const { recipe, metadata } = compilePoses(extra(body)), project = renderProject(recipe);
    assert.equal(silhouette(project.frames.find(frame => frame.name === 'idle-3'), 32, 32).lowest, 28, JSON.stringify(body));
    assert.equal(metadata.poses['idle-3'].parts.body.squash, body.squash);
  }
  refused(extra({ squash: 1.1 }, [0, 1]), /^poses\.poses\[1\]: "idle-3" stands in for a pose of the grounded idle "idle", so its body must stand on rig\.ground \(row 28\); its lowest pixel is on row 30$/);
  refused(extra({ angle: 20 }), /^poses\.poses\[1\]: "idle-3" stands in .* its lowest pixel is on row 32$/);
  const bodiless = structuredClone(slime); bodiless.poses.push({ name: 'idle-5', origin: [16, 28], parts: [{ name: 'eyes', part: 'eyes', at: [0, -6] }] });
  refused(bodiless, /^poses\.poses\[1\]: "idle-5" stands in for a pose of the grounded idle "idle", so it needs the body instance "body" standing on rig\.ground \(row 28\)$/);
  // A mirror of a grounded pose stands where that pose stands.
  const mirrored = structuredClone(slime); mirrored.poses.push({ name: 'idle-5', mirror: 'idle-0' });
  assert.equal(compilePoses(mirrored).warnings, undefined);
  // An ellipse body that stands in off the ground, and the same stand-in in a breathing idle, which grounds nothing.
  const ellipse = blob({ idle: { frames: 8, squash: .15 } }); ellipse.poses[0].name = ellipse.rig.rest = 'idle-0';
  refused(ellipse, /^poses\.poses\[0\]: "idle-0" stands in for a pose of the grounded idle "idle", so its body must stand on rig\.ground \(row 40\); its lowest pixel is on row 37$/);
  delete ellipse.motions.idle.squash;
  assert.equal(compilePoses(ellipse).warnings, undefined);
  // The head bob and tail sway run after grounding, so the body can't also be the head or part of the tail.
  const head = structuredClone(slime); head.rig.head = 'body';
  refused(head, /^poses\.rig\.head: the grounded idle "idle" keeps the body on rig\.ground, so the body can't also be the head/);
  const tail = structuredClone(slime); tail.rig.tail = ['eyes', 'body'];
  refused(tail, /^poses\.rig\.tail\[1\]: the grounded idle "idle" keeps the body on rig\.ground, so the body can't also be part of the tail/);
  // Without squash those rigs breathe as before.
  for (const source of [head, tail]) { delete source.motions.idle.squash; assert.equal(compilePoses(source).warnings, undefined); }
});

test('a flat mass keeps its base on its anchor row under every squash, keeps its area and turns with its rotation', () => {
  const ramp = ['d', 'g', 'l'];
  for (const size of [[23, 12], [9, 4], [2, 2], [30, 20]]) for (const outline of ['k', null, 'selective']) for (let step = 10; step <= 40; step++) {
    const squash = step / 20, raster = rasterizeMass({ size, ramp: 0, base: 1, outline, flat: true }, { squash, ramp }), label = JSON.stringify({ size, outline, squash });
    const [px, py] = raster.pivot, rows = new Set();
    for (let y = 0; y < raster.height; y++) for (let x = 0; x < raster.width; x++) if (raster.fill[y * raster.width + x]) rows.add(y);
    assert.equal(raster.fill[py * raster.width + px], 1, `${label}: the anchor is a base pixel`);
    assert.equal(Math.max(...rows), py, `${label}: nothing below the base row`);
    assert.equal(raster.rows.findLastIndex(row => /[^.]/.test(row)), py + (outline ? 1 : 0), `${label}: the outline is the row under the base`);
    assert.ok(Math.abs(raster.rows.join('').replaceAll('.', '').length / raster.targetArea - 1) <= .1, `${label}: area`);
    if (squash === 1) assert.equal(rows.size, size[1], `${label}: a dome as tall as its size`);
  }
  // Turned clockwise, the base turns about the anchor: at 90 degrees the dome points right, at 180 it hangs down.
  const turned = angle => rasterizeMass({ size: [23, 12], ramp: 0, base: 1, outline: 'k', flat: true }, { angle, ramp });
  const filled = (raster, test) => { for (let y = 0; y < raster.height; y++) for (let x = 0; x < raster.width; x++) if (raster.fill[y * raster.width + x] && test(x - raster.pivot[0], y - raster.pivot[1])) return true; return false; };
  assert.ok(!filled(turned(90), x => x < 0) && filled(turned(90), x => x > 10));
  assert.ok(!filled(turned(180), (x, y) => y < 0) && filled(turned(180), (x, y) => y > 10));
  // flat: false is the ellipse, and a flat drawing never shares the ellipse's cache entry.
  const ellipse = { size: [23, 12], ramp: 0, base: 1, outline: 'k' }, plain = rasterizeMass(ellipse, { ramp });
  assert.deepEqual(rasterizeMass({ ...ellipse, flat: false }, { ramp }).rows, plain.rows);
  assert.notDeepEqual(rasterizeMass({ ...ellipse, flat: true }, { ramp }).rows, plain.rows);
  assert.deepEqual(rasterizeMass(ellipse, { ramp }).rows, plain.rows);
});

test('idles and ellipse masses without the new fields stay byte-identical to the output before grounded squash', () => {
  // Hashes of the compiled JSON and every RGBA frame, taken before flat masses and idle squash existed. Regenerate
  // them only for a deliberate change to the idle template, mass drawing or the rigs above.
  const compiled = source => { const result = compilePoses(source); return hash(JSON.stringify(result) + renderProject(result.recipe).frames.map(frame => hash(frame.data)).join()); };
  assert.deepEqual([...[2, 3, 4].map(frames => compiled(strider({ frames, breath: .1 }))), ...[2, 3, 4].map(frames => compiled(blob({ idle: { frames, breath: .15 } }))), compiled(blob({ mass: { outline: 'selective' }, body: { angle: 20 } }))], [
    '06cd66bdf8a51a7a5e692784c8aa776fb33d4b3c082b5701e2343abde556e24a',
    '4ef8b1eb52f03c49defde6735b88002d1afc8b508613ae534943c7dc57155536',
    '55719b3e381bd650155ed8e56aae851b606e0ead9b2cf3824ba6d09f3e594a12',
    'e7bb07f06fc353b42345a5dafc5a7fabe9ebd972cc388c23813a6b08d9f87c63',
    '2c46ead9cd7e3a30334e221010baa8ebf8d033f677538bb35a988896fc427fa7',
    '905e03e98f3045aecfd5d0d6a92e1252b6c89d010a2a5d70504f30526a47e72c',
    '1ea16cceb746be26c05a4c118deb58a2dc660d6083d57c124036c6003ff01662'
  ]);
  const ellipses = [];
  for (const size of [[2, 2], [7, 9], [12, 10], [20, 14]]) for (const outline of ['k', null, 'selective']) for (const angle of [0, 33, 90]) for (const flipX of [false, true]) for (const squash of [.5, .85, 1, 1.15, 2]) {
    const raster = rasterizeMass({ size, ramp: 0, base: 1, outline }, { angle, flipX, squash, ramp: ['d', 'g', 'l'] });
    ellipses.push(JSON.stringify([raster.rows, raster.pivot, raster.work, raster.targetArea, raster.map([3, -2])]));
  }
  assert.equal(hash(ellipses.join('\n')), '0a707fb68225cd6b0b73939149ac07b9b3c0677e29096ed374ed339ed8839348');
});
