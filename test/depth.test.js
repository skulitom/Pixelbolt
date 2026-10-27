import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, inspectProject, readGuides } from '../src/core.js';
import { compileNormals, NORMAL_DIRECTIONS } from '../src/authoring.js';
import { prepareScene, renderScene, sceneImage } from '../src/scene.js';
import { decodePNG } from '../src/import.js';
import { startMCP } from '../src/mcp.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = async (t, label) => {
  const base = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(base, `pixelbolt-${label}-`));
  t.after(async () => { assert.ok(dir.startsWith(base + path.sep)); await rm(dir, { recursive: true, force: true }); });
  return dir;
};

// A floor, a barrel and a hero sorted by where they stand, and a post drawn over everything. The hero walks from
// behind the barrel (ground row 8, above its 10) to in front of it (row 14).
const block = (name, w, h, color, anchor) => ({ version: 1, name, width: w, height: h, palette: { c: color }, anchor, frames: [{ name: 'a', ops: [{ op: 'rect', w, h, color: 'c' }] }] });
const yard = (sorted = true) => ({
  format: 'pixelforge-scene', version: 1, name: 'yard', width: 24, height: 16, background: '#000000',
  assets: { floor: block('floor', 24, 16, '#406040', [0, 0]), barrel: block('barrel', 4, 5, '#a06030', [2, 5]), hero: block('hero', 4, 6, '#3050c0', [2, 6]), post: block('post', 2, 16, '#c0c0c0', [0, 0]) },
  instances: [
    { name: 'floor', asset: 'floor', at: [0, 0] },
    { name: 'barrel', asset: 'barrel', at: [10, 10], anchor: 'frame', ...(sorted && { sort: 'ground' }) },
    { name: 'hero', asset: 'hero', at: [11, 8], anchor: 'frame', trajectory: [{ time: 0, at: [11, 8] }, { time: 1000, at: [11, 14] }], ...(sorted && { sort: 'ground' }) },
    { name: 'post', asset: 'post', at: [12, 0] }
  ]
});
const byPixels = list => [...list].sort((a, b) => b.pixels - a.pixels || a.front.localeCompare(b.front));

test('the depth report lists sorted placements far to near and who covers whom, never counting the ground', () => {
  const scene = prepareScene(yard());
  const behind = renderScene(scene, { time: 0, depth: true });
  assert.deepEqual(behind.depth.sorted, [{ name: 'hero', at: [11, 8] }, { name: 'barrel', at: [10, 10] }]);
  // The barrel stands nearer, so it covers the hero's lower 3×3; the post, drawn after the sorted group, covers a column.
  assert.deepEqual(behind.depth.overlaps, [{ front: 'barrel', behind: 'hero', pixels: 9 }, { front: 'post', behind: 'hero', pixels: 6 }]);
  assert.equal(behind.depth.note, undefined);
  const after = renderScene(scene, { time: 1000, depth: true });
  assert.deepEqual(after.depth.sorted.map(s => s.name), ['barrel', 'hero']);
  assert.deepEqual(byPixels(after.depth.overlaps), byPixels([{ front: 'hero', behind: 'barrel', pixels: 6 }, { front: 'post', behind: 'hero', pixels: 6 }]));
  // The floor lies straight on the background, so it is never the one behind, though everything covers it.
  for (const view of [behind, after]) assert.ok(view.depth.overlaps.every(o => o.behind !== 'floor'));
  // Recording depth changes no pixel, and the map stays out of JSON.
  assert.deepEqual(behind.data, renderScene(scene, { time: 0 }).data);
  assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(behind))).sort(), ['data', 'depth', 'height', 'placements', 'warnings', 'width']);
  assert.equal(renderScene(scene, { time: 0 }).depth, undefined);
  assert.throws(() => renderScene(scene, { depth: 'yes' }), /depth must be booleans/);
});

test('without sorting the report shows list order winning, and says so', () => {
  const view = renderScene(prepareScene(yard(false)), { time: 0, depth: true });
  assert.equal(view.depth.sorted, undefined);
  assert.deepEqual(view.depth.overlaps[0], { front: 'hero', behind: 'barrel', pixels: 9 });
  assert.match(view.depth.note, /No placement has sort: "ground"/);
});

test('shared names get their instance index, and shade placements cover nothing', () => {
  const source = yard();
  source.assets.shadow = { ...block('shadow', 4, 2, '#000000', [2, 1]), palette: { c: '#000000', d: '#101010' }, ramps: [['c', 'd']] };
  source.instances.splice(1, 0, { name: 'barrel', asset: 'barrel', at: [9, 11], anchor: 'frame', sort: 'ground' });
  source.instances.push({ asset: 'shadow', at: [11, 8], anchor: 'frame', shade: -1 });
  const view = renderScene(prepareScene(source), { time: 0, depth: true });
  assert.deepEqual(view.depth.sorted.map(s => s.name), ['hero', 'barrel#2', 'barrel#1']);
  assert.ok(view.depth.overlaps.some(o => o.front === 'barrel#1' && o.behind === 'barrel#2'));
  assert.ok(view.depth.overlaps.every(o => !String(o.front).startsWith('shadow')));
});

// A court with a row of walls drawn as tiles: each wall's cap (rows 8–15) and, through a rule's offset, its face in
// the cell below (rows 16–23). The hero stands on the row of its feet.
const tiles = (name, w, h, colors) => ({ version: 1, name, width: w, height: h, palette: Object.fromEntries(colors.map((c, k) => [`k${k}`, c])), frames: colors.map((c, k) => ({ name: `f${k}`, ops: [{ op: 'rect', w, h, color: `k${k}` }] })) });
const CAP = [128, 128, 128, 255], FACE = [80, 80, 80, 255], HERO = [48, 80, 192, 255], TREE = [32, 128, 32, 255];
const court = ({ sorted = true, heroAt = [10, 12], rows = ['WWWW'], extra = [] } = {}) => ({
  format: 'pixelforge-scene', version: 1, name: 'court', width: 32, height: 32, background: '#000000',
  assets: { floor: block('floor', 32, 32, '#406040', [0, 0]), wall: tiles('wall', 8, 8, ['#808080', '#505050']), tree: tiles('tree', 8, 16, ['#208020']), canopy: tiles('canopy', 8, 8, ['#208020', '#604020']), hero: block('hero', 4, 10, '#3050c0', [2, 9]) },
  instances: [
    { name: 'floor', asset: 'floor', at: [0, 0] },
    { name: 'walls', asset: 'wall', at: [0, 8], ...(sorted && { sort: 'ground' }), tilemap: { rows, legend: { W: { rules: [{ frame: 'f0' }, { frame: 'f1', offset: [0, 1] }] } } } },
    ...extra,
    { name: 'hero', asset: 'hero', at: heroAt, anchor: 'frame', sort: 'ground' }
  ]
});
const colour = (view, x, y) => [...view.data.subarray((y * view.width + x) * 4, (y * view.width + x) * 4 + 4)];

test('a sorted tilemap joins the group tile by tile, so a wall covers a hero behind it and a hero in front covers it', () => {
  const behind = renderScene(prepareScene(court()), { depth: true });
  assert.deepEqual(colour(behind, 10, 10), CAP, 'the cap, standing on row 15, covers the hero standing on row 12');
  assert.deepEqual(colour(behind, 10, 5), HERO, "the hero's head shows above the wall");
  // Each row of tiles is one entry far to near, by the row it stands on.
  assert.deepEqual(behind.depth.sorted, [{ name: 'hero', at: [10, 12] }, { name: 'walls', ground: 15, tiles: 4 }, { name: 'walls', ground: 23, tiles: 4 }]);
  assert.deepEqual(behind.depth.overlaps, [{ front: 'walls', behind: 'hero', pixels: 20 }]);
  assert.deepEqual(behind.placements.filter(p => p.tilemap), [{ name: 'walls', tilemap: true, x: 0, y: 8, w: 32, h: 8, tiles: 8, scale: 1 }]);
  const front = renderScene(prepareScene(court({ heroAt: [10, 30] })), { depth: true });
  assert.deepEqual(colour(front, 10, 22), HERO, 'the hero standing on row 30 covers the face');
  assert.deepEqual(front.depth.sorted.map(s => s.name), ['walls', 'walls', 'hero']);
  // Unsorted, the tilemap draws once in list order, under the hero wherever the hero stands.
  const listed = renderScene(prepareScene(court({ sorted: false })), { depth: true });
  assert.deepEqual(colour(listed, 10, 10), HERO);
  assert.deepEqual(listed.depth.sorted, [{ name: 'hero', at: [10, 12] }]);
  // Sorting changes the order of drawing, never what a tile draws: with nothing in front, the pixels match.
  const alone = source => { source.instances.pop(); return renderScene(prepareScene(source)).data; };
  assert.deepEqual(alone(court()), alone(court({ sorted: false })));
  assert.throws(() => prepareScene({ ...court(), instances: [{ asset: 'wall', at: [0, 0], sort: 'y', tilemap: { rows: ['W'], legend: { W: 'f0' } } }] }), /sort: expected ground/);
  assert.throws(() => prepareScene({ ...court(), instances: [{ asset: 'wall', at: [0, 0], sort: 'ground', hidden: true, tilemap: { rows: ['W'], legend: { W: 'f0' } } }] }), /choose frames through their legend/);
});

test('a frame taller than its tile stands on its own bottom row, so a tree covers whoever walks behind its trunk', () => {
  // Trees 16 pixels tall on an 8-pixel grid, raised by the overhang so the T marks the cell the trunk stands in.
  const tall = { name: 'trees', asset: 'tree', at: [0, 16], anchor: [0, 8], sort: 'ground', tilemap: { tile: [8, 8], rows: ['T'], legend: { T: 'f0' } } };
  const view = renderScene(prepareScene(court({ rows: ['....'], heroAt: [4, 21], extra: [tall] })), { depth: true });
  assert.deepEqual(colour(view, 3, 13), TREE, "the canopy covers the hero, who stands on row 21, above the trunk's 23");
  assert.deepEqual(view.depth.sorted, [{ name: 'hero', at: [4, 21] }, { name: 'trees', ground: 23, tiles: 1 }]);
  assert.deepEqual(view.placements.find(p => p.name === 'trees'), { name: 'trees', tilemap: true, x: 0, y: 8, w: 8, h: 8, tiles: 1, scale: 1 });
  // A canopy drawn as its own tile stands on its own row instead, so the same hero draws over it.
  const split = { name: 'trees', asset: 'canopy', at: [0, 8], sort: 'ground', tilemap: { tile: [8, 8], rows: ['C', 'T'], legend: { C: 'f0', T: 'f1' } } };
  assert.deepEqual(colour(renderScene(prepareScene(court({ rows: ['....'], heroAt: [4, 21], extra: [split] }))), 3, 13), HERO);
});

// A hero in front of a barrel jumps from 200 ms to 500 ms, 12 pixels high at 350 ms, holding a sword at its hand; its
// shadow follows where it stands.
const hop = ({ heroLift } = {}) => ({
  format: 'pixelforge-scene', version: 1, name: 'hop', width: 32, height: 32, background: '#000000', duration: 1000, cues: { jump: 200 },
  assets: {
    floor: block('floor', 32, 32, '#406040', [0, 0]), barrel: block('barrel', 6, 8, '#a06030', [3, 7]),
    hero: { ...block('hero', 4, 10, '#3050c0', [2, 9]), frames: [{ name: 'a', points: { hand: [3, 4] }, ops: [{ op: 'rect', w: 4, h: 10, color: 'c' }] }] },
    sword: block('sword', 1, 4, '#e0e0e0', [0, 3]), shadow: { ...block('shadow', 6, 2, '#000000', [3, 1]), palette: { c: '#000000', d: '#101010' }, ramps: [['c', 'd']] }
  },
  instances: [
    { name: 'floor', asset: 'floor', at: [0, 0] },
    { name: 'shadow', asset: 'shadow', at: [0, 0], anchor: 'frame', attach: { instance: 'hero' }, shade: -1 },
    { name: 'barrel', asset: 'barrel', at: [16, 20], anchor: 'frame', sort: 'ground' },
    { name: 'hero', asset: 'hero', at: [16, 24], anchor: 'frame', sort: 'ground', lift: heroLift ?? [{ time: 'jump', height: 0, ease: 'out' }, { time: 'jump+150', height: 12, ease: 'in' }, { time: 'jump+300', height: 0 }] },
    { name: 'sword', asset: 'sword', at: [1, 0], anchor: 'frame', attach: { instance: 'hero', point: 'hand' } }
  ]
});
const BARREL = [160, 96, 48, 255];

test('lift draws a placement higher while where it stands still orders it', () => {
  const scene = prepareScene(hop()), at = time => renderScene(scene, { time, depth: true });
  const top = at(350), hero = top.placements.find(p => p.name === 'hero');
  assert.deepEqual([hero.y, hero.lift], [24 - 9 - 12, 12]);
  assert.deepEqual(top.depth.sorted, [{ name: 'barrel', at: [16, 20] }, { name: 'hero', at: [16, 24], lift: 12 }]);
  // Rising through the barrel's rows (8 pixels up at 250 ms), the hero is still drawn in front of it.
  const rising = at(250);
  assert.equal(rising.placements.find(p => p.name === 'hero').lift, 8);
  assert.deepEqual(colour(rising, 16, 14), HERO);
  assert.deepEqual(rising.depth.overlaps.find(o => o.behind === 'barrel'), { front: 'hero', behind: 'barrel', pixels: 16 });
  // Moving the hero up by the same 8 pixels instead puts it behind the barrel, which covers it.
  const moved = hop({ heroLift: 0 }); moved.instances[3].at = [16, 16];
  assert.deepEqual(colour(renderScene(prepareScene(moved)), 16, 14), BARREL);
  // Keys hold before the first and after the last; out on the way up and in on the way down ease the arc.
  assert.deepEqual([0, 200, 275, 350, 425, 500, 900].map(time => at(time).placements.find(p => p.name === 'hero').lift ?? 0), [0, 0, Math.round(12 * (1 - 0.5 ** 3)), 12, Math.round(12 - 12 * 0.5 ** 3), 0, 0]);
  // The shadow, attached to where the hero stands, stays on the floor; the sword at the hand rises with it. The sword
  // stands on the hero's ground line, so its lift is the hand's height above it: 5, and 17 at the top of the jump.
  const placed = name => top.placements.find(p => p.name === name), ground = renderScene(scene, { time: 0 });
  assert.equal(placed('shadow').y, ground.placements.find(p => p.name === 'shadow').y);
  assert.equal(placed('sword').y, ground.placements.find(p => p.name === 'sword').y - 12);
  assert.deepEqual([ground.placements.find(p => p.name === 'sword').lift, placed('sword').lift], [5, 17]);
  assert.equal(placed('shadow').lift, undefined);
  // A fixed lift hovers, and a scene without lift draws as before.
  assert.equal(renderScene(prepareScene(hop({ heroLift: 5 }))).placements.find(p => p.name === 'hero').y, 24 - 9 - 5);
  const flat = hop(); delete flat.instances[3].lift;
  assert.deepEqual(renderScene(prepareScene(flat), { time: 350 }).data, renderScene(prepareScene(hop({ heroLift: 0 })), { time: 350 }).data);
});

test('lift and point-free attachments are checked where they are written', () => {
  const fails = (change, message) => { const source = hop(); change(source); assert.throws(() => prepareScene(source), message); };
  fails(s => { s.instances[3].lift = -1; }, /lift: expected an integer from 0 to 256/);
  fails(s => { s.instances[3].lift = []; }, /lift: expected 1–64 timed heights/);
  fails(s => { s.instances[3].lift = [{ time: 10, height: 2 }, { time: 10, height: 3 }]; }, /key times must increase strictly/);
  fails(s => { s.instances[3].lift = [{ time: 'leap', height: 2 }]; }, /not in scene\.cues/);
  fails(s => { s.instances[3].lift = [{ time: 0, height: 2, ease: 'spring' }]; }, /lift\[0\]\.ease: expected one of/);
  fails(s => { s.instances[3].lift = [{ time: 0, height: 2, speed: 1 }]; }, /speed/);
  fails(s => { s.instances[1].attach = { instance: 'hero', point: 'foot' }; }, /no frame of hero has a point named "foot"/);
  fails(s => { s.instances.push({ asset: 'floor', at: [0, 0], lift: 2, tilemap: { rows: ['f'], legend: { f: 'a' } } }); }, /a tilemap lies where it is placed/);
  // The schema offers both forms, and attach needs only the instance.
  const schema = JSON.parse(readFileSync(path.join(root, 'scene.schema.json'), 'utf8')), placement = schema.properties.instances.items.properties;
  assert.equal(placement.lift.oneOf.length, 2);
  assert.deepEqual(placement.attach.required, ['instance']);
});

test("a sorted placement attached to a frame point stands on its target's ground line, so a held sword stays with its hero", () => {
  const SWORD = [224, 224, 224, 255], held = (change = () => {}) => { const source = hop(); source.instances[4].sort = 'ground'; change(source); return prepareScene(source); };
  const view = renderScene(held(), { depth: true });
  // The hero stands in front of the barrel, so the sword in its hand does too, and covers the barrel where they meet.
  assert.deepEqual(view.depth.sorted, [{ name: 'barrel', at: [16, 20] }, { name: 'hero', at: [16, 24] }, { name: 'sword', at: [18, 24], lift: 5 }]);
  assert.deepEqual(view.depth.overlaps.find(o => o.behind === 'barrel' && o.front === 'sword'), { front: 'sword', behind: 'barrel', pixels: 4 });
  assert.deepEqual(colour(view, 18, 17), SWORD);
  // At the top of the jump it still stands on the hero's line, 17 rows below the hand.
  assert.deepEqual(renderScene(held(), { time: 350, depth: true }).depth.sorted.at(-1), { name: 'sword', at: [18, 24], lift: 17 });
  // Sharing the hero's line, list order decides: listed after the hero it is drawn over it, listed before, under it.
  const over = held(s => { s.instances[4].at = [-1, 0]; }), under = held(s => { s.instances[4].at = [-1, 0]; s.instances.splice(3, 0, s.instances.pop()); });
  assert.deepEqual(colour(renderScene(over), 16, 17), SWORD);
  assert.deepEqual(colour(renderScene(under), 16, 17), HERO);
  // A light that follows the sword without a point is where the sword stands, on the floor below the hand.
  const lit = held(s => { s.lighting = { lights: [{ follow: { instance: 'sword' } }] }; });
  assert.deepEqual(renderScene(lit).lights[0].at, [18, 24]);
});

test('the depth view draws dashes from the ground tick up to a lifted placement', () => {
  const s = 4, view = renderScene(prepareScene(hop()), { time: 350, depth: true }), image = sceneImage(view, { mode: 'depth', scale: s });
  const at = (x, y) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
  const white = [255, 255, 255, 255], column = y => at(16 * s - 1, y);
  // The hero's tick ends 5 screen pixels above its ground line; dashes go on up to its lifted point, 12 rows higher.
  const dashes = [];
  for (let y = 24 * s - 5; y >= 12 * s; y--) dashes.push(column(y)[0] === 255 && column(y)[1] === 255 ? 1 : 0);
  assert.deepEqual(dashes.slice(0, 8), [1, 1, 0, 0, 1, 1, 0, 0]);
  assert.deepEqual(column(24 * s), white, 'the ground line stays at the row the hero stands on');
  // Standing on the ground, no dashes.
  const still = sceneImage(renderScene(prepareScene(hop()), { time: 0, depth: true }), { mode: 'depth', scale: s });
  assert.notDeepEqual([...still.data.subarray(((24 * s - 8) * still.width + 16 * s - 1) * 4, ((24 * s - 8) * still.width + 16 * s - 1) * 4 + 4)], white);
});

test("the depth image runs a tile row's ground line under each of its tiles, without a placement mark", () => {
  const view = renderScene(prepareScene(court({ rows: ['W.W.'], heroAt: [28, 30] })), { depth: true }), s = 3, image = sceneImage(view, { mode: 'depth', scale: s });
  const at = (x, y) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
  for (const x of [0, 7 * s, 16 * s, 24 * s - 1]) assert.deepEqual(at(x, 15 * s), [255, 255, 255, 255], `cap line at ${x}`);
  assert.notDeepEqual(at(12 * s, 15 * s), [255, 255, 255, 255], 'no line across the gap between tiles');
  assert.notDeepEqual(at(4 * s, 15 * s - 2), [255, 255, 255, 255], 'no tick');
  // The two caps are one row, so they share a tint.
  assert.deepEqual(at(2 * s + 1, 10 * s + 1), at(18 * s + 1, 10 * s + 1));
  assert.notDeepEqual(at(2 * s + 1, 10 * s + 1), at(2 * s + 1, 18 * s + 1), 'the face row, nearer, is tinted apart from the caps');
});

test('the depth image tints far cool and near warm, keeps the ground grey and draws ground lines', () => {
  const view = renderScene(prepareScene(yard()), { time: 0, depth: true }), s = 3, image = sceneImage(view, { mode: 'depth', scale: s });
  assert.equal(image.width, 24 * s); assert.equal(image.height, 16 * s);
  const at = (x, y) => [...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
  const [fr, fg, fb] = at(1 * s + 1, 1 * s + 1);
  assert.ok(fr === fg && fg === fb, 'the floor is grey');
  const hero = at(10 * s + 1, 3 * s + 1), post = at(13 * s + 1, 1 * s + 1);
  assert.ok(hero[2] > hero[0], `the hero, drawn first, is cool: ${hero}`);
  assert.ok(post[0] > post[2], `the post, drawn last, is warm: ${post}`);
  // The hero stands on row 8: a white line across its width, a dark one under it, and a tick at its placement point.
  for (let x = 9 * s; x < 13 * s; x++) assert.deepEqual(at(x, 8 * s), [255, 255, 255, 255], `ground line at ${x}`);
  assert.deepEqual(at(9 * s + 1, 8 * s + 1), [12, 12, 20, 255]);
  assert.deepEqual(at(11 * s, 8 * s - 2), [255, 255, 255, 255]);
  // Colour and grayscale views are the scene enlarged; the depth view needs a depth render.
  assert.deepEqual(sceneImage(view, { scale: 1 }).data, view.data);
  assert.throws(() => sceneImage(renderScene(prepareScene(yard())), { mode: 'depth' }), /depth: true/);
  assert.throws(() => sceneImage(view, { mode: 'side' }), /color, grayscale or depth/);
});

test('guides are checked, drawn over the enlarged image only, and placed by canvas corners', () => {
  assert.deepEqual(readGuides({ horizon: 4, vanish: [[8, 4]], iso: { tile: [16, 8] } }), { horizon: 4, vanish: [[8, 4]], iso: { tile: [16, 8], at: [0, 0] } });
  for (const [bad, message] of [[{}, /name a horizon/], [{ vanish: [] }, /1–3 points/], [{ vanish: [[0, 0], [1, 1], [2, 2], [3, 3]] }, /at most 3/], [{ iso: { tile: [16] } }, /\[width, height\]/], [{ horizon: 2, colour: 'red' }, /unknown field/]]) assert.throws(() => readGuides(bad), message);
  const project = renderProject({ version: 1, name: 'wall', width: 8, height: 8, palette: { k: '#404040' }, frames: [{ name: 'a', ops: [{ op: 'rect', w: 8, h: 8, color: 'k' }] }] });
  const region = { x: 2, y: 2, w: 4, h: 4 }, plain = inspectProject(project, { region, scale: 4, native: true }), guided = inspectProject(project, { region, scale: 4, native: true, guides: { horizon: 4 } });
  assert.deepEqual(guided.guides, { horizon: 4 });
  assert.deepEqual(guided.nativeSheet.data, plain.nativeSheet.data, 'the native sheet keeps its exact pixels');
  const changed = new Set();
  for (let i = 0; i < plain.sheet.data.length; i += 4) if (plain.sheet.data[i] !== guided.sheet.data[i] || plain.sheet.data[i + 2] !== guided.sheet.data[i + 2]) changed.add(Math.floor(i / 4 / plain.sheet.width));
  // Row 4 of the canvas is row 2 of the region, so the line is 2 × 4 pixels below the cell's top edge.
  assert.deepEqual([...changed], [plain.sheet.gap + 2 * 4]);
  assert.throws(() => inspectProject(project, { view: 'tile', guides: { horizon: 4 } }), /omit guides/);
  // A scene takes the same guides, in any view.
  const view = renderScene(prepareScene(yard())), image = sceneImage(view, { scale: 2, guides: { horizon: 4 } }), at = (8 * 48 + 1) * 4;
  assert.ok(image.data[at] > image.data[at + 2], 'the horizon is orange');
  assert.deepEqual(image.guides, { horizon: 4 });
  // Rays and an isometric grid cross the whole image without leaving it.
  const busy = sceneImage(view, { scale: 2, guides: { vanish: [[12, 4], [400, 4]], iso: { tile: [8, 4], at: [2, 0] } } });
  assert.equal(busy.data.length, 48 * 32 * 4);
});

test('per-colour faces give a box flat planes, keep the cushion elsewhere and report what they matched', () => {
  const rows = ['..........', '.kkkkkkkk.', '.kttttttk.', '.kttttttk.', '.kffffffk.', '.kffffffk.', '.kffffffk.', '.kkkkkkkk.', '..........'];
  const recipe = { version: 1, name: 'crate', width: 10, height: 9, palette: { k: '#202020', t: '#c08040', f: '#804020', u: '#123456' }, frames: [{ name: 'a', ops: [{ op: 'grid', rows }] }] };
  const derive = options => compileNormals({ format: 'pixelforge-normals', version: 1, recipe, ...options });
  const cushion = derive({}).recipe.frames[0].ops[0].rows, faced = derive({ faces: { t: 'w', f: '5' }, detail: 1 });
  const out = faced.recipe.frames[0].ops[0].rows;
  assert.deepEqual(out.slice(2, 4).map(row => row.slice(2, 8)), ['wwwwww', 'wwwwww']);
  assert.deepEqual(out.slice(4, 7).map(row => row.slice(2, 8)), ['555555', '555555', '555555']);
  // The outline is not faced, so it keeps the cushion's rim (detail aside, it is the darkest colour).
  assert.equal(out[1], cushion[1]); assert.equal(out[4][1], 'a');
  assert.deepEqual(faced.metadata.faces, { t: { direction: 'w', pixels: 12 }, f: { direction: '5', pixels: 18 } });
  assert.equal(faced.warnings, undefined);
  assert.match(derive({ faces: { u: '2' } }).warnings[0], /faces\.u: no pixel is drawn/);
  for (const [faces, message] of [[{}, /expected a map/], [{ zz: 'w' }, /not a palette key/], [{ t: 'up' }, /expected a direction/], [[], /expected a map/]]) assert.throws(() => derive({ faces }), message);
  assert.throws(() => compileNormals({ format: 'pixelforge-normals', version: 1, recipe: { ...recipe, palette: { ...recipe.palette, T: '#c08040' } }, faces: { t: 'w', T: '8' } }), /same colour as "t"/);
  // Two keys of one colour facing one way share the face, and neither is reported as unmatched.
  const twins = compileNormals({ format: 'pixelforge-normals', version: 1, recipe: { ...recipe, palette: { ...recipe.palette, T: '#c08040' } }, faces: { t: 'w', T: 'w' } });
  assert.deepEqual(twins.metadata.faces, { t: { direction: 'w', pixels: 12 }, T: { direction: 'w', pixels: 12 } });
  assert.equal(twins.warnings, undefined);
  assert.throws(() => compileNormals({ format: 'pixelforge-normals', version: 1, recipe: { ...recipe, palette: { ...recipe.palette, z: 'transparent' } }, faces: { z: '5' } }), /transparent/);
});

test('the normals schema offers faces with exactly the 17 directions', async () => {
  const schema = JSON.parse(await readFile(path.join(root, 'normals.schema.json'), 'utf8'));
  assert.deepEqual(schema.properties.faces.additionalProperties.enum, Object.keys(NORMAL_DIRECTIONS));
});

test('MCP pixel_scene returns the depth report with its image, and pixel_inspect takes guides', async t => {
  const dir = await temp(t, 'depth-mcp'), input = new PassThrough(), output = new PassThrough(), waiting = new Map();
  let buffer = '', next = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)?.(message); } });
  startMCP({ input, output, directory: dir, root: dir });
  const request = (method, params) => new Promise(resolve => { waiting.set(++next, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n'); });
  t.after(() => input.end());
  await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  const call = async (name, args) => (await request('tools/call', { name, arguments: args })).result;
  const scene = await call('pixel_scene', { scene: yard(), view: 'depth', time: 0, scale: 2 }), info = JSON.parse(scene.content[0].text);
  assert.equal(scene.isError, undefined, scene.content[0].text);
  assert.deepEqual(info.depth.overlaps[0], { front: 'barrel', behind: 'hero', pixels: 9 });
  const png = decodePNG(Buffer.from(scene.content[1].data, 'base64'));
  assert.deepEqual([png.width, png.height], [48, 32]);
  const plain = JSON.parse((await call('pixel_scene', { scene: yard() })).content[0].text);
  assert.equal(plain.depth, undefined);
  // Guides sent as JSON text are read as the object the schema declares.
  const recipe = { version: 1, name: 'wall', width: 8, height: 8, palette: { k: '#404040' }, frames: [{ name: 'a', ops: [{ op: 'rect', w: 8, h: 8, color: 'k' }] }] };
  const inspected = await call('pixel_inspect', { project: recipe, guides: '{"horizon": 4, "iso": {"tile": [8, 4]}}' });
  assert.equal(inspected.isError, undefined, inspected.content[0].text);
  const refused = await call('pixel_scene', { scene: yard(), guides: { horizon: 'middle' } });
  assert.equal(refused.isError, true); assert.match(refused.content[0].text, /guides\.horizon/);
});

test('the CLI writes one scene view with its depth report, and inspect takes --guides', async t => {
  const dir = await temp(t, 'depth-cli'), file = path.join(dir, 'yard.scene.json'), image = path.join(dir, 'depth.png');
  await writeFile(file, JSON.stringify(yard()));
  const spawn = (...args) => spawnSync(process.execPath, ['bin/pixelbolt.js', ...args], { cwd: root, encoding: 'utf8' });
  // Errors are JSON on stderr; results are JSON on stdout.
  const run = (...args) => { const out = spawn(...args); return { ...out, text: out.stdout + out.stderr }; };
  const result = run('scene', file, '--image', image, '--view', 'depth', '--time', '1000', '--scale', '2', '--guides', '{"horizon":4}');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.depth.sorted.map(s => s.name), ['barrel', 'hero']);
  assert.deepEqual(report.guides, { horizon: 4 });
  const png = decodePNG(await readFile(image));
  assert.deepEqual([png.width, png.height], [48, 32]);
  assert.match(run('scene', file, '--image', image).text, /already exists/);
  assert.match(run('scene', file, '--out', path.join(dir, 'bundle'), '--view', 'depth').text, /--view goes with --image/);
  assert.match(run('scene', file, '--image', path.join(dir, 'view.gif')).text, /must name a \.png/);
  const inspected = run('inspect', 'examples/shrine.json', '--guides', '{"vanish":[[24,10]]}');
  assert.equal(inspected.status, 0, inspected.stderr || inspected.stdout);
  assert.deepEqual(JSON.parse(inspected.stdout).guides, { vanish: [[24, 10]] });
  assert.match(run('inspect', 'examples/shrine.json', '--guides', '{"horizon":').text, /--guides: expected JSON/);
});
