import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareScene, renderScene, sceneImage } from '../src/scene.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const block = (name, w, h, color, anchor) => ({ version: 1, name, width: w, height: h, palette: { c: color }, ...(anchor && { anchor }), frames: [{ name: 'a', ops: [{ op: 'rect', w, h, color: 'c' }] }] });
const scene = extra => ({ format: 'pixelforge-scene', version: 1, name: 'fixes', width: 32, height: 32, background: '#000000', ...extra });
const render = (source, options) => renderScene(prepareScene(source), options);
const pixel = (view, x, y) => [...view.data.subarray((y * view.width + x) * 4, (y * view.width + x) * 4 + 4)];

// A floor on a stone ramp, lit so strongly that a lit pixel is the ramp's top and an unlit one keeps the ambient light.
const stone = { a: '#101010', b: '#303030', c: '#505050', d: '#707070', e: '#909090' };
const floor = { version: 1, name: 'floor', width: 40, height: 32, palette: stone, ramps: [['a', 'b', 'c', 'd', 'e']], frames: [{ name: 'a', ops: [{ op: 'rect', w: 40, h: 32, color: 'c' }] }] };
const lamp = (instances, lights = [{ at: [8, 20], height: 12, radius: 96, strength: 8 }]) => scene({ width: 40, height: 32,
  assets: { floor, post: block('post', 1, 4, '#c03030'), pillar: block('pillar', 2, 4, '#c03030') },
  lighting: { mode: 'ramp', scope: 'all', ambient: 0.2, bands: 16, steps: 2, lights }, instances: [{ name: 'floor', asset: 'floor', at: [0, 0] }, ...instances] });

test('a sorted tilemap at scale 2 or more stands on the first screen row of its bottom art row, as a placement does', () => {
  // An 8×8 wall tile and a hero whose feet (its anchor row) are on the wall's bottom art row: a tie, so list order
  // decides at every scale, as it does at 1×.
  const yard = (s, heroFirst = false) => {
    const walls = { name: 'walls', asset: 'wall', at: [0, 0], scale: s, sort: 'ground', tilemap: { rows: ['W'], legend: { W: 'a' } } };
    const hero = { name: 'hero', asset: 'hero', at: [4 * s, 7 * s], anchor: [2, 7], scale: s, sort: 'ground' };
    return scene({ width: 64, height: 64, assets: { wall: block('wall', 8, 8, '#808080'), hero: block('hero', 4, 10, '#3050c0') }, instances: heroFirst ? [hero, walls] : [walls, hero] });
  };
  for (const s of [1, 2, 3]) {
    const { depth } = render(yard(s), { depth: true });
    assert.deepEqual(depth.sorted, [{ name: 'walls', ground: 7 * s, tiles: 1 }, { name: 'hero', at: [4 * s, 7 * s] }], `scale ${s}`);
    assert.deepEqual(depth.overlaps, [{ front: 'hero', behind: 'walls', pixels: 32 * s * s }], `scale ${s}`);
    const flipped = render(yard(s, true), { depth: true }).depth;
    assert.deepEqual(flipped.overlaps, [{ front: 'walls', behind: 'hero', pixels: 32 * s * s }], `scale ${s}, hero listed first`);
  }
});

test('a tile at scale 2 casts its shadow from the same ground as the same frame placed on its bottom row', () => {
  // A 2×4 pillar at 2×: as a one-tile map, and as a placement anchored at [1, 3], the middle of its bottom row.
  for (const light of [{ at: [8, 20], height: 12, radius: 96, strength: 8 }, { sun: [1, 0.5], strength: 8 }]) {
    const tile = render(lamp([{ name: 'pillar', asset: 'pillar', at: [18, 14], scale: 2, sort: 'ground', shadow: true, tilemap: { rows: ['P'], legend: { P: 'a' } } }], [light]));
    const placed = render(lamp([{ name: 'pillar', asset: 'pillar', at: [20, 20], anchor: [1, 3], scale: 2, sort: 'ground', shadow: true }], [light]));
    assert.ok(placed.shadows[0].pixels > 0);
    assert.equal(tile.shadows[0].pixels, placed.shadows[0].pixels, JSON.stringify(light));
    assert.equal(tile.shadows[0].length, placed.shadows[0].length, JSON.stringify(light));
    assert.deepEqual(tile.data, placed.data, JSON.stringify(light));
  }
});

test('a shadow on a placement anchored on its top row warns once that it casts nothing', () => {
  const warned = view => view.warnings.filter(message => /shadow, but its anchor is on its top row/.test(message));
  // The default anchor [0, 0], two lights and three copies: one warning, at every time.
  const top = prepareScene(lamp([{ name: 'post', asset: 'post', at: [20, 17], shadow: true, repeat: [3, 1], step: [4, 0] }], [{ at: [8, 20], height: 12 }, { sun: [1, 0] }]));
  for (const time of [0, 500, 1000]) {
    const view = renderScene(top, { time });
    assert.equal(view.shadows, undefined);
    assert.deepEqual(warned(view), ['post: shadow, but its anchor is on its top row, so it casts nothing; anchor it at its feet (anchor: "frame" or [x, bottom]).']);
  }
  // Frames placed by anchors on their top row say so too.
  const frames = prepareScene(lamp([{ name: 'post', asset: 'post', at: [20, 17], anchor: 'frame', shadow: true }]));
  assert.deepEqual(frames.warnings.filter(message => /shadow, but/.test(message)), ['post: shadow, but its anchor is on its top row, so it casts nothing; anchor post\'s frames at their feet.']);
  // Anchored at its feet, it casts and says nothing.
  const feet = render(lamp([{ name: 'post', asset: 'post', at: [20, 20], anchor: [0, 3], shadow: true }]));
  assert.ok(feet.shadows[0].pixels > 0);
  assert.deepEqual(warned(feet), []);
  // Nor does one always lifted, which casts what stands above its ground line, or one held at a frame point, which
  // stands on its holder's ground.
  assert.deepEqual(warned(render(lamp([{ name: 'post', asset: 'post', at: [20, 20], lift: 3, shadow: true }]))), []);
  const holder = { version: 1, name: 'holder', width: 2, height: 6, palette: { h: '#3050c0' }, anchor: [1, 5], frames: [{ name: 'a', points: { hand: [1, 2] }, ops: [{ op: 'rect', w: 2, h: 6, color: 'h' }] }] };
  const held = lamp([{ name: 'holder', asset: 'holder', at: [20, 20], anchor: 'frame' }, { name: 'post', asset: 'post', at: [0, 0], attach: { instance: 'holder', point: 'hand' }, shadow: true }]);
  held.assets.holder = holder;
  assert.deepEqual(warned(render(held)), []);
});

test('overlapping repeat copies of one placement do not cover each other in the depth report', () => {
  // A grass strip of five copies, each overlapping the last by a column, and a hero standing on it.
  const yard = (step, under = [], hero = [12, 10]) => scene({ width: 32, height: 16, assets: { grass: block('grass', 8, 16, '#406040'), hero: block('hero', 4, 6, '#3050c0', [2, 5]), ground: block('ground', 32, 16, '#202020') },
    instances: [...under, { name: 'grass', asset: 'grass', at: [0, 0], repeat: [5, 1], step: [step, 0] }, { name: 'hero', asset: 'hero', at: hero, anchor: 'frame', sort: 'ground' }] });
  for (const step of [8, 7]) {
    const view = render(yard(step), { depth: true });
    assert.deepEqual(view.depth.overlaps, [], `step ${step}`);
    // Every copy lies on the background, so the depth view leaves them grey.
    const image = sceneImage(view, { mode: 'depth' });
    for (const x of [1, 9, 17, 25]) { const [r, g, b] = pixel(image, x, 1); assert.ok(r === g && g === b, `step ${step}, copy at x ${x} is grey`); }
  }
  // Over a ground of its own, the strip covers something, so the hero covering it still counts, even where copies are
  // stacked wholly on a copy that covers the ground.
  for (const step of [7, 0]) {
    const covered = render(yard(step, [{ name: 'ground', asset: 'ground', at: [0, 0] }], [4, 10]), { depth: true });
    assert.ok(covered.depth.overlaps.some(o => o.front === 'hero' && o.behind === 'grass'), `step ${step}`);
  }
});

test('lift and light keys eased with overshoot stay in range', () => {
  // A hero landing from 10 pixels with overshoot would sink below its ground line; one rising to 256 would pass it.
  const hero = block('hero', 4, 6, '#3050c0', [2, 5]);
  const jump = (from, to) => prepareScene(scene({ duration: 1000, assets: { hero }, instances: [{ name: 'hero', asset: 'hero', at: [10, 20], anchor: 'frame', sort: 'ground', lift: [{ time: 0, height: from, ease: 'overshoot' }, { time: 1000, height: to }] }] }));
  const landing = jump(10, 0), rising = jump(0, 256);
  for (let time = 0; time <= 1000; time += 50) {
    const down = renderScene(landing, { time }).placements[0], up = renderScene(rising, { time }).placements[0];
    assert.ok((down.lift ?? 0) >= 0 && down.y <= 15, `landing at ${time}: ${JSON.stringify(down)}`);
    assert.ok(up.lift <= 256 || up.lift === undefined, `rising at ${time}: ${JSON.stringify(up)}`);
  }
  // A light fading out with overshoot: its strength would turn negative and its radius below zero, which lit pixels
  // farther away more brightly. Here the ambient light alone is left.
  const room = keys => scene({ width: 32, height: 8, duration: 1000, assets: { floor: block('floor', 32, 8, '#808080') },
    lighting: { scope: 'all', ambient: 0.5, lights: [keys[0].sun ? { sun: keys[0].sun, keys: keys.slice(1) } : { at: [0, 4], height: 4, keys }] }, instances: [{ asset: 'floor', at: [0, 0] }] });
  const fading = render(room([{ time: 0, radius: 100, strength: 2, ease: 'overshoot' }, { time: 1000, radius: 1, strength: 0 }]), { time: 800 });
  assert.deepEqual(fading.lights, [{ at: [0, 4], radius: 1, strength: 0 }]);
  for (const x of [2, 16, 30]) assert.equal(pixel(fading, x, 4)[0], 64);
  // A light whose reach shrinks with overshoot at full strength lights only near itself.
  const shrinking = render(room([{ time: 0, radius: 100, strength: 1, ease: 'overshoot' }, { time: 1000, radius: 1, strength: 1 }]), { time: 800 });
  assert.equal(shrinking.lights[0].radius, 1);
  assert.equal(pixel(shrinking, 30, 4)[0], 64);
  // A sun's keys set its strength the same way.
  const sunset = render(room([{ sun: [1, 0] }, { time: 0, strength: 2, ease: 'overshoot' }, { time: 1000, strength: 0 }]), { time: 800 });
  assert.equal(sunset.lights[0].strength, 0);
  assert.equal(pixel(sunset, 16, 4)[0], 64);
});

test('the skill keeps the 4096-pixel still apart from scene backdrops, which are tiled', () => {
  const skill = readFileSync(path.join(root, 'skills', 'pixel-art', 'SKILL.md'), 'utf8');
  const still = skill.split(/(?<=\.) /).find(sentence => sentence.includes('4096'));
  assert.match(still, /on its own/);
  assert.match(skill, /backdrop[^.]*\b(repeat|tilemap)\b/);
  // The limit the sentence describes: a scene refuses an asset larger than 256 pixels a side.
  assert.throws(() => prepareScene(scene({ width: 128, height: 64, assets: { sky: block('sky', 512, 64, '#8090c0') }, instances: [{ asset: 'sky', at: [0, 0] }] })), /at most 256×256/);
});
