// The check behind https://skulitom.github.io/Pixelbolt/guides/tileset-generator-godot-tiled/ (8 Nov 2026).
// Runs Pixelbolt 0.13.0's own Godot and Tiled checks on the guide's four tile sets, and paints each set's compiler
// test map too. Pixelbolt's checks take their sets from exported arrays; this appends the guide's blob sets to them,
// swaps in the guide's layered set, and adds the test maps. Then it checks that the files the CLI wrote for download are
// byte-identical to the ones the checks exported.
// Put this file and verify-tiled-onestep.mjs in the scripts/ folder of a Pixelbolt v0.13.0 checkout, then:
//   TILED=<path to tiled> node scripts/check-page-sets.mjs <sets dir> <CLI download dir> <Godot 4 console exe> <out.json>
// <sets dir> holds snow, meadow, ground and shore .autotile.json; <CLI download dir> holds the folders that
// `pixelbolt render <name>.recipe.json --out <dir>/<name>` wrote.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as G from './verify-godot.mjs';
import * as T from './verify-tiled-onestep.mjs';
import { TEST_MAP, layeredTestMap } from '../src/terrain.js';
import { compileAutotile } from '../src/authoring.js';
import { createBundle } from '../src/export.js';

const [setsDir, dlDir, godot, outFile] = process.argv.slice(2);
const read = async name => JSON.parse(await readFile(path.join(setsDir, `${name}.autotile.json`), 'utf8'));
const blob = await Promise.all(['snow', 'meadow', 'ground'].map(read));
const shore = await read('shore');

// The guide's sets join Pixelbolt's fixtures; the scene checks keep using fixtures 1, 3 and 4, which stay in place.
const stockSources = G.GODOT_TILE_SOURCES.length, stockMaps = G.GODOT_TILE_MAPS.length, stockLayeredMaps = G.GODOT_LAYERED_MAPS.length;
G.GODOT_TILE_SOURCES.push(...blob);
G.GODOT_TILE_MAPS.push([...TEST_MAP]);
for (const key of Object.keys(G.GODOT_LAYERED_SOURCE)) delete G.GODOT_LAYERED_SOURCE[key];
Object.assign(G.GODOT_LAYERED_SOURCE, shore);
const keys = shore.layers.map(layer => layer.key).join('');
G.GODOT_LAYERED_MAPS.push(layeredTestMap(shore.layers.length).map(row => row.map(i => keys[i]).join('')));

const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const result = { pixelbolt: version, stock: { sources: stockSources, maps: stockMaps, layeredMaps: stockLayeredMaps }, sets: {} };

// Godot: every TileSet loaded and checked, every map painted with set_cells_terrain_connect.
const lines = [];
const g = await G.verifyGodotTiles({ godot, keep: true, log: line => lines.push(line) });
result.godot = { version: g.version, summary: lines.at(-1) };
for (const name of ['snow', 'meadow', 'ground', 'shore']) {
  const got = g.report[name];
  const painted = got.painted.map(map => Object.keys(map).length);
  const tiles = got.sources.reduce((sum, source) => sum + source.tiles.length, 0);
  result.sets[name] = { godot: { tiles, terrainSets: got.sets, paintedPerMap: painted, testMapCells: painted.at(-1), allCells: painted.reduce((a, b) => a + b, 0) } };
}

// Tiled: every .tsx loaded and checked, every map painted with Tiled's own terrain filler, every tile rasterised.
const tlines = [];
const t = await T.verifyTiled({ keep: true, log: line => tlines.push(line) });
result.tiled = { summary: tlines.at(-1), oneStep: t.oneStep, partial: t.partial, perKeyOneStep: t.perKeyOneStep, perKeyPartial: t.perKeyPartial };
const tcases = JSON.parse(await readFile(path.join(t.dir, 'cases.json'), 'utf8'));
const tres = JSON.parse(await readFile(path.join(t.dir, 'results.json'), 'utf8'));
result.tiled.version = tres.version;
// Lone cells of the blob maps: terrain with no terrain on any side, which Tiled leaves empty (no Wang tile).
const lone = G.GODOT_TILE_MAPS.reduce((sum, rows) => sum + rows.reduce((s, row, y) => s + [...row].filter((ch, x) => ch === '#' && ![[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => rows[y + dy]?.[x + dx] === '#')).length, 0), 0);
tcases.forEach((c, n) => {
  if (!result.sets[c.key]) return;
  const paints = tres.results[n].paints.map(p => p.length);
  const placed = tres.results[n].paints.reduce((sum, p) => sum + p.filter(id => id >= 0).length, 0);
  result.sets[c.key].tiled = { wangSets: tres.results[n].wangSets.map(s => [s.name, s.type, s.colors]), paintedPerMap: paints, testMapCells: paints.at(-1), allCells: paints.reduce((a, b) => a + b, 0), tilesPlaced: placed, ...(c.key !== 'shore' && { loneCellsLeftEmpty: lone }) };
});
result.note = 'Tiled allCells and the summary lines count every cell of the maps, empty ones included (the stock checks\' wording); tilesPlaced counts the cells where Tiled placed a tile, each one Pixelbolt draws there.';

// The downloads: the CLI's files against the bundle the checks exported.
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
for (const source of [...blob, shore]) {
  const { recipe } = compileAutotile(source), bundle = await createBundle(recipe), name = recipe.name, same = {};
  for (const file of [`${name}.png`, `${name}.tileset.tres`, `${name}.tsx`, `${name}.atlas.json`]) {
    const cli = await readFile(path.join(dlDir, name, file));
    same[file] = { identical: Buffer.compare(cli, Buffer.from(bundle.files.get(file))) === 0, sha256: sha(cli) };
  }
  result.sets[name].downloads = same;
  result.sets[name].frames = recipe.frames.length;
}
await writeFile(outFile, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ godot: result.godot.summary, tiled: result.tiled.summary }, null, 1));
for (const [name, set] of Object.entries(result.sets)) console.log(name, set.frames, 'frames; Godot test map', set.godot.testMapCells, 'cells, all', set.godot.allCells, '; Tiled test map', set.tiled?.testMapCells, 'all', set.tiled?.allCells, 'placed', set.tiled?.tilesPlaced, 'lone', set.tiled?.loneCellsLeftEmpty, '; downloads identical:', Object.values(set.downloads).every(d => d.identical));
console.log(`The checks kept their projects in ${g.dir} (Godot) and ${t.dir} (Tiled); delete them when done.`);
