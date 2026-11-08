import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { renderProject, compilePoses, compileAutotile, compileEffects, resolveReferences, neighbourMask, BLOB_MASKS } from '../src/index.js';
import { World } from '../showcase/tidewatch/game/src/world.js';
import { TERRAIN, isSand, isGrass } from '../showcase/tidewatch/game/src/map.js';

const art = new URL('../showcase/tidewatch/art/', import.meta.url);
const json = path => JSON.parse(readFileSync(new URL(path, art), 'utf8'));
// Tidewatch sources link art/palette.json; resolve it the way the CLI does, relative to each file.
const resolved = async path => (await resolveReferences(json(path), { baseDir: fileURLToPath(new URL('.', new URL(path, art))) })).document;
const recipes = readdirSync(new URL('recipes/', art)).filter(f => f.endsWith('.json') && !f.includes('.meta.') && !f.includes('.map.'));

test('Tidewatch: every recipe validates without clipping warnings', async () => {
  assert.ok(recipes.length >= 30);
  for (const file of recipes) {
    const project = renderProject(await resolved(`recipes/${file}`));
    assert.deepEqual(project.warnings, [], file);
  }
});

test('Tidewatch: compiled recipes and metadata match their authoritative pose, autotile and effect sources', async () => {
  for (const name of ['keeper', 'crab']) {
    // compilePoses uses null-prototype maps; compare the JSON a file would contain.
    const { recipe, metadata } = JSON.parse(JSON.stringify(compilePoses(await resolved(`poses/${name}.poses.json`))));
    assert.deepEqual(recipe, await resolved(`recipes/${name}.json`), `${name} recipe is stale; recompile it`);
    assert.deepEqual(metadata, json(`recipes/${name}.meta.json`), `${name} metadata is stale; recompile it`);
  }
  for (const name of ['shore', 'grass']) {
    const { recipe } = JSON.parse(JSON.stringify(compileAutotile(await resolved(`terrain/${name}.autotile.json`))));
    assert.deepEqual(recipe, await resolved(`recipes/${name}.json`), `${name} recipe is stale; run pixelbolt autotile`);
  }
  assert.deepEqual(compileEffects(await resolved('effects/fx.fx.json')).recipe, await resolved('recipes/fx.json'), 'fx recipe is stale; run pixelbolt compile');
});

test('Tidewatch: particle effects keep the animations, anchor and hand-drawn frames the game uses', async () => {
  const fx = renderProject(await resolved('recipes/fx.json'));
  assert.deepEqual(Object.keys(fx.animations), ['leaves', 'shards', 'splash', 'poof', 'hit', 'sparkle', 'dust']);
  assert.deepEqual(Object.entries(fx.animations).map(([name, a]) => [name, a.frames.length, a.loop]), [['leaves', 7, false], ['shards', 6, false], ['splash', 5, false], ['poof', 6, false], ['hit', 3, false], ['sparkle', 4, true], ['dust', 3, false]]);
  assert.deepEqual(fx.frames[0].anchor, [16, 20]);
  // Hit and sparkle are the original hand-drawn frames, played by one particle at the positions the old scaffold used.
  const source = await resolved('effects/fx.fx.json');
  const drawn = (symbol, x, y) => renderProject({ version: 1, name: 'ref', width: 32, height: 32, palette: source.palette, frames: [{ name: 'a', ops: [{ op: 'grid', x, y, rows: source.symbols[symbol] }] }] }).frames[0].data;
  for (const [name, count, x, y] of [['hit', 3, 8, 10], ['sparkle', 4, 12, 12]]) for (let i = 0; i < count; i++) {
    assert.deepEqual(fx.frames.find(f => f.name === `${name}-${i}`).data, drawn(`${name}-${i}`, x, y), `${name}-${i}`);
  }
});

test('Tidewatch: exported game atlases match the recipes byte for byte', () => {
  const output = execFileSync(process.execPath, ['showcase/tidewatch/tools/build-assets.mjs', '--check'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.match(output, /All exported assets match their recipes/);
});

test('Tidewatch: material passes stay aligned with their colour recipes', async () => {
  for (const name of ['lighthouse', 'cottage', 'lamp']) {
    const color = renderProject(await resolved(`recipes/${name}.json`));
    for (const pass of ['normal', 'emissive']) {
      const other = renderProject(await resolved(`recipes/${name}-${pass}.json`));
      assert.deepEqual(other.frames.map(f => [f.name, f.duration]), color.frames.map(f => [f.name, f.duration]), `${name}-${pass}`);
      assert.deepEqual([other.width, other.height], [color.width, color.height]);
    }
  }
});

test('Tidewatch: Pixelbolt blob masks give every sand and grass cell a compiled tile', async () => {
  const shore = renderProject(await resolved('recipes/shore.json')), grass = renderProject(await resolved('recipes/grass.json'));
  assert.equal(BLOB_MASKS.length, 47);
  const frames = new Set(grass.frames.map(f => f.name));
  TERRAIN.forEach((row, y) => [...row].forEach((_, x) => {
    if (isSand(x, y)) assert.ok(Object.hasOwn(shore.animations, `surf-${neighbourMask('blob', (dx, dy) => isSand(x + dx, y + dy))}`), `sand ${x},${y}`);
    if (isGrass(x, y)) assert.ok(frames.has(`grass-${neighbourMask('blob', (dx, dy) => isGrass(x + dx, y + dy))}`), `grass ${x},${y}`);
  }));
});

test('Tidewatch: the game places sprites from atlas anchors and reads reach, held items and glyph advances from points', () => {
  const atlas = name => JSON.parse(readFileSync(new URL(`../showcase/tidewatch/game/assets/${name}.json`, import.meta.url), 'utf8'));
  const keeper = atlas('keeper'), props = atlas('props'), font = atlas('font');
  assert.deepEqual(keeper.frames['idle-d'].anchorPx, { x: 20, y: 31 });
  assert.equal(keeper.frames['idle-d'].trimmed, true);
  // Mirrored left-facing strikes carry mirrored blade tips.
  const right = keeper.frames['attack-r-2'].points.hit, left = keeper.frames['attack-l-2'].points.hit;
  // Pixels reflect around the anchor corner x = 20: column c becomes 39 - c, as drawFrame flips.
  assert.equal(right.x + left.x, 2 * 20 - 1); assert.equal(right.y, left.y);
  assert.ok(keeper.frames['hold-up'].points.item);
  assert.deepEqual([props.frames.pot.anchorPx, props.frames['flower-red'].anchorPx, props.frames.chest.anchorPx], [{ x: 8, y: 13 }, { x: 8, y: 11 }, { x: 8, y: 12 }]);
  assert.deepEqual([font.frames.uM.points.advance.x, font.frames.period.points.advance.x], [6, 2]);
});

test('Tidewatch: the island can be completed in a deterministic headless run', () => {
  const keeper = JSON.parse(readFileSync(new URL('../showcase/tidewatch/game/assets/keeper.json', import.meta.url), 'utf8')), world = new World(keeper, 3);
  const input = { pressed: new Set(), held: new Set(), take(k) { const had = this.pressed.has(k); this.pressed.delete(k); return had; }, axis() { return { x: 0, y: 0 }; } };
  const run = (ms, key) => { if (key) input.pressed.add(key); for (let t = 0; t < ms; t += 1000 / 60) world.update(1000 / 60, input); };
  const skip = () => { while (world.messages.length) world.messages.shift(); run(20); };
  const p = world.player;
  // The sea blocks movement.
  p.x = 5 * 16; p.y = 13 * 16; const x0 = p.x; world.move(p, -40, 0, [-5, -4, 10, 5]); assert.ok(p.x > x0 - 40);
  // Cutting tall grass reveals the sunflint; walking onto it grants the item and starts dusk.
  p.x = 152; p.y = 352; p.dir = 'u'; run(100, 'attack'); run(400);
  const flint = world.pickups.find(k => k.kind === 'flint'); assert.ok(flint, 'flint revealed');
  p.x = flint.x; p.y = flint.y; run(300);
  assert.equal(world.flags.flint, true); assert.equal(world.phase, 'dusk'); skip();
  // The east-cove chest holds the tower key.
  p.x = 584; p.y = 304; p.dir = 'u'; run(50, 'act'); assert.equal(world.flags.key, true); skip();
  // A crab takes two cutlass hits.
  const crab = world.enemies.find(e => e.kind === 'crab'); p.inv = 99999;
  for (let i = 0; i < 2; i++) { p.x = crab.x - 16; p.y = crab.y; p.dir = 'r'; run(400, 'attack'); }
  assert.equal(crab.alive, false); assert.ok(world.stats.defeated >= 1);
  // With both items the lighthouse door starts the ending.
  p.x = 320; p.y = 162; p.dir = 'u'; run(50, 'act');
  assert.ok(world.flags.ending > 0);
  assert.ok(world.events.some(e => e.type === 'ignite'));
});
