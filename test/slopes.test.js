// Slopes cut from a side-view set's top edge and fill: each column of the flat ground's edge moved down the slope over
// the fill in place, a foot under a slope's low end where the edge runs into the cell below, collision under the
// slope's line, and a legend that draws them in maps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileAutotile } from '../src/authoring.js';
import { renderProject } from '../src/core.js';
import { prepareScene, renderScene } from '../src/scene.js';
import { SLOPES, slopeTiles, slopeCollision, templateTile } from '../src/slopes.js';

const ground = JSON.parse(await readFile(new URL('../examples/ground.autotile.json', import.meta.url), 'utf8'));

test('a slope is the flat ground\'s top edge moved down the slope, over the fill in place, with a foot where it runs below', () => {
  const { recipe, metadata, warnings } = compileAutotile(ground), tile = 16;
  assert.equal(warnings, undefined);
  assert.deepEqual(Object.keys(metadata.slopes.tiles), ['up', 'up-foot', 'down', 'down-foot', 'gentle-up-low', 'gentle-up-low-foot', 'gentle-up-high', 'gentle-down-high', 'gentle-down-low', 'gentle-down-low-foot']);
  assert.deepEqual(recipe.frames.slice(-10).map(frame => frame.name), Object.values(metadata.slopes.tiles));
  assert.deepEqual(recipe.frames.find(frame => frame.name === 'ground-up').ops, [{ op: 'stamp', symbol: 'slope-up' }]);
  // Column by column: air above the moved edge, the edge's rows, then the fill tile's own rows.
  const north = templateTile(recipe.symbols.template, tile, 'blob', 124), fill = templateTile(recipe.symbols.template, tile, 'blob', 255);
  const slopes = slopeTiles(recipe.symbols.template, { tile, mode: 'blob' });
  for (const slope of slopes) {
    const shift = SLOPES.find(item => item.key === slope.key).shift, strip = [...slope.rows, ...(slope.foot ?? fill)];
    for (let x = 0; x < tile; x++) {
      const s = shift(x, tile);
      let edge = 0;
      for (let r = 0; r < tile; r++) if (north[r][x] !== fill[r][x]) edge = r + 1;
      for (let r = 0; r < 2 * tile; r++) assert.equal(strip[r][x], r < s ? '.' : r < s + edge ? north[r - s][x] : fill[r % tile][x], `${slope.key} column ${x} row ${r}`);
    }
  }
  // The grass cap's three rows of margin and four bands run into the cell under a low end; a gentle slope's high half
  // stays in its own cell, so the fill under it is the plain fill tile.
  assert.deepEqual(slopes.map(slope => [slope.key, Boolean(slope.foot)]), [['up', true], ['down', true], ['gentle-up-low', true], ['gentle-up-high', false], ['gentle-down-high', false], ['gentle-down-low', true]]);
});

test('a slope is solid under its line, the grass cap\'s depth below it, and engines get it as a plain tile', () => {
  const { recipe } = compileAutotile(ground), facts = name => recipe.frames.find(frame => frame.name === name).tile;
  assert.deepEqual(facts('ground-up'), { collision: [[3, 16], [16, 3], [16, 16]] });
  assert.deepEqual(facts('ground-up-foot'), { collision: [[0, 3], [3, 0], [16, 0], [16, 16], [0, 16]] });
  assert.deepEqual(facts('ground-gentle-down-high'), { collision: [[0, 3], [16, 11], [16, 16], [0, 16]] });
  assert.deepEqual(facts('ground-gentle-down-low'), { collision: [[0, 11], [10, 16], [0, 16]] });
  // At no depth the lines meet the tile's corners; one-way travels; without collision a slope is art alone.
  assert.deepEqual(slopeCollision('up', 16, 0), [[16, 0], [16, 16], [0, 16]]);
  assert.deepEqual(slopeCollision('gentle-up-low', 16, 0, true), [[0, 0], [16, 0], [16, 16], [0, 16]]);
  assert.equal(slopeCollision('gentle-up-low', 16, 9), null);
  assert.deepEqual(compileAutotile({ ...ground, collision: { oneWay: true } }).recipe.frames.find(frame => frame.name === 'ground-down').tile, { collision: [[0, 3], [13, 16], [0, 16]], oneWay: true });
  assert.equal(compileAutotile({ ...ground, collision: undefined }).recipe.frames.find(frame => frame.name === 'ground-up').tile, undefined);
});

test('the compiled legend draws slopes in a scene as the test map draws its hills', () => {
  const { recipe, metadata, preview } = compileAutotile(ground), hills = preview.frames[0].ops.at(-1);
  assert.deepEqual(hills.rows, metadata.slopes.map);
  assert.deepEqual(metadata.slopes.legend['/'], { frame: 'ground-up' });
  assert.deepEqual(metadata.slopes.legend['#'].rules.at(-1), { frames: ['ground-{mask}-a', 'ground-{mask}-b', 'ground-{mask}-stones'], weights: [3, 3, 1], autotile: 'blob', match: '#/\\uUDd' });
  // A scene is at most 256 pixels wide: two 16-cell slices of the map, the 45° hill and the gentle one.
  for (const from of [0, 8]) {
    const rows = hills.rows.map(row => row.slice(from, from + 16));
    const drawn = renderProject({ ...preview, width: 256, height: 80, frames: [{ name: 'hills', ops: [{ ...hills, y: 0, rows }] }] }).frames[0].data;
    const scene = renderScene(prepareScene({ format: 'pixelforge-scene', version: 1, name: 'hills', width: 256, height: 80, background: '#00000000', assets: { ground: recipe },
      instances: [{ asset: 'ground', at: [0, 0], tilemap: { rows, outside: 'match', legend: metadata.slopes.legend } }] }), { lit: false });
    assert.deepEqual(scene.data, drawn, `from column ${from}`);
  }
});

test('slopes need a blob or cardinal set and a {slope} name, and a cardinal set has them too', () => {
  for (const [change, message] of [
    [{ mode: 'corner' }, /autotile\.slopes: slopes are cut from the top-edge tile of a side-view blob or cardinal set/],
    [{ slopes: { frame: 'ground-slope' } }, /autotile\.slopes\.frame: expected a frame name template containing \{slope\}/],
    [{ slopes: { frame: 'ground-{slope}-{variant}' } }, /a slope has no \{mask\} or \{variant\}/],
    [{ slopes: { frame: 'ground-{slope}', angle: 45 } }, /autotile\.slopes\.angle/]
  ]) assert.throws(() => compileAutotile({ ...ground, ...change }), message, JSON.stringify(change));
  const shore = JSON.parse(JSON.stringify(ground));
  assert.throws(() => compileAutotile({ format: 'pixelforge-autotile', version: 1, name: 's', tile: 16, frame: 's-{corners}', slopes: { frame: 's-{slope}' }, layers: [{ name: 'a', key: 'a', terrain: shore.terrain }, { name: 'b', key: 'b', terrain: shore.terrain }] }), /autotile\.slopes: slopes are cut from a side-view blob or cardinal set, not a layered one/);
  const cardinal = compileAutotile({ ...ground, mode: 'cardinal', variants: undefined, frame: 'fence-{mask}', slopes: { frame: 'fence-{slope}' } });
  assert.equal(cardinal.recipe.frames.filter(frame => frame.name.startsWith('fence-') && !/^fence-\d+$/.test(frame.name)).length, 10);
});
