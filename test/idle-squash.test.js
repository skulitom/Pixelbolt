import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { compilePoses, expandPoses } from '../src/authoring.js';
import { renderProject, buildAtlas, PixelError } from '../src/core.js';
import { rasterizeMass } from '../src/craft.js';
import { animationGIF } from '../src/gif.js';
import { inspectMotion } from '../src/motion.js';

const read = async file => JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
const hash = data => createHash('sha256').update(data).digest('hex');
const slime = await read('examples/slime-idle.poses.json'), hero = await read('examples/hero.poses.json');
const palette = { k: '#1d2b3a', d: '#2b7a3d', g: '#3fa34d', l: '#8fd16a', w: '#f4f4e8' };
// A one-mass rig whose rest pose stands above rig.ground, so grounding has to move it.
const blob = ({ mass = {}, idle = {}, body = {}, face = [0, -2] } = {}) => ({ format: 'pixelforge-poses', version: 1, name: 'blob', width: 64, height: 48, palette, ramps: [['d', 'g', 'l']],
  parts: { body: { mass: { size: [20, 12], ramp: 0, base: 1, outline: 'k', ...mass }, points: { face } }, eyes: { rows: ['w...w', 'k...k'], anchor: [2, 0] } },
  poses: [{ name: 'rest', origin: [32, 30], parts: [{ name: 'body', part: 'body', ...body }, { name: 'eyes', part: 'eyes', attach: { part: 'body', point: 'face' } }] }],
  rig: { ground: 40, body: 'body', rest: 'rest', head: 'eyes' }, motions: { idle: { template: 'idle', ...idle } } });

// The silhouette of one rendered frame: its box, and how many pixels of its lowest row are opaque.
function silhouette({ data }, width, height) {
  let left = width, right = -1, top = height, lowest = -1, opaque = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3]) { opaque++; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); lowest = y; }
  let contact = 0;
  for (let x = 0; x < width; x++) if (lowest >= 0 && data[(lowest * width + x) * 4 + 3]) contact++;
  return { lowest, width: right - left + 1, height: lowest - top + 1, contact, opaque };
}
const idleFrames = (project, name = 'idle') => project.animations[name].frames.map(index => project.frames[index]);

// A plain reading of the GIF89a structure and its LZW stream (as in gif.test.js), sharing no code with the encoder.
function decodeGIF(bytes) {
  assert.equal(Buffer.from(bytes.subarray(0, 6)).toString('latin1'), 'GIF89a');
  const word = at => bytes[at] | bytes[at + 1] << 8, gif = { width: word(6), height: word(8), loop: null, frames: [] };
  let at = 13, control = null, canvas = Array(gif.width * gif.height).fill('clear');
  const table = flags => { const colors = bytes.subarray(at, at + (3 << (flags & 7) + 1)); at += colors.length; return colors; };
  const blocks = () => { const parts = []; for (let size = bytes[at++]; size; size = bytes[at++]) { parts.push(bytes.subarray(at, at + size)); at += size; } return Buffer.concat(parts); };
  const shared = bytes[10] & 0x80 ? table(bytes[10]) : null;
  for (let marker = bytes[at++]; marker !== 0x3b; marker = bytes[at++]) {
    if (marker === 0x21) {
      const label = bytes[at++];
      if (label === 0xf9) { assert.equal(bytes[at], 4); control = { disposal: bytes[at + 1] >> 2 & 7, transparent: bytes[at + 1] & 1 ? bytes[at + 4] : null }; at += 5; assert.equal(bytes[at++], 0); }
      else if (label === 0xff) { assert.equal(Buffer.from(bytes.subarray(at + 1, at + 12)).toString('latin1'), 'NETSCAPE2.0'); at += 12; const data = blocks(); assert.equal(data[0], 1); gif.loop = data[1] | data[2] << 8; }
      else assert.fail(`unexpected extension ${label}`);
      continue;
    }
    assert.equal(marker, 0x2c);
    const rect = [word(at), word(at + 2), word(at + 4), word(at + 6)], flags = bytes[at + 8]; at += 9;
    const colors = flags & 0x80 ? table(flags) : shared, minimum = bytes[at++], data = blocks(), clear = 1 << minimum, indices = [];
    let size = minimum + 1, buffer = 0, bits = 0, read = 0, dictionary = [], previous = null;
    for (;;) {
      while (bits < size) { buffer |= data[read++] << bits; bits += 8; }
      const code = buffer & (1 << size) - 1; buffer >>>= size; bits -= size;
      if (code === clear) { dictionary = Array.from({ length: clear + 2 }, (_, index) => [index]); size = minimum + 1; previous = null; continue; }
      if (code === clear + 1) break;
      const entry = code < dictionary.length ? dictionary[code] : [...previous, previous[0]];
      indices.push(...entry);
      if (previous && dictionary.length < 4096) dictionary.push([...previous, entry[0]]);
      if (dictionary.length === 1 << size && size < 12) size++;
      previous = entry;
    }
    const pixels = canvas.slice(), inside = callback => { for (let y = 0; y < rect[3]; y++) for (let x = 0; x < rect[2]; x++) callback((rect[1] + y) * gif.width + rect[0] + x, y * rect[2] + x); };
    inside((to, from) => { if (indices[from] !== control.transparent) pixels[to] = Buffer.from(colors.subarray(indices[from] * 3, indices[from] * 3 + 3)).toString('hex'); });
    gif.frames.push(pixels);
    canvas = pixels.slice();
    if (control.disposal === 2) inside(to => { canvas[to] = 'clear'; });
  }
  return gif;
}

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
    assert.deepEqual(decoded.frames[i], sheet, name);
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
  const refused = (source, pattern) => assert.throws(() => compilePoses(source), error => error instanceof PixelError && pattern.test(error.message), pattern.source);
  for (const frames of [1, 17]) refused(blob({ idle: { frames } }), /^poses\.motions\.idle\.frames: expected an integer from 2 to 16$/);
  refused(blob({ idle: { breath: .1, squash: .1 } }), /^poses\.motions\.idle\.squash: choose breath or squash, not both/);
  for (const squash of [0, .01, .6, '0.1']) refused(blob({ idle: { squash } }), /^poses\.motions\.idle\.squash: expected a number from 0\.05 to 0\.5$/);
  refused({ ...hero, motions: { idle: { template: 'idle', squash: .1 } } }, /^poses\.motions\.idle\.squash: squash sits the body on rig\.ground, but this rig stands on its legs/);
  refused(blob({ mass: { flat: 'yes' } }), /^poses\.parts\.body\.mass\.flat: expected a boolean$/);
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
  // them only for a deliberate change to the idle template, mass drawing or these examples.
  const compiled = source => { const result = compilePoses(source); return hash(JSON.stringify(result) + renderProject(result.recipe).frames.map(frame => hash(frame.data)).join()); };
  assert.deepEqual([compiled({ ...hero, motions: { idle: hero.motions.idle } }), ...[2, 3, 4].map(frames => compiled(blob({ idle: { frames, breath: .15 } }))), compiled(blob({ mass: { outline: 'selective' }, body: { angle: 20 } }))], [
    'f8a670010c03bd1829b2cb6a3cb54e4e44a4784a01930b0582100d552a78990c',
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
