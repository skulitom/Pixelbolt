// Loads exported Tiled tilesets (.tsx) in a real Tiled and checks them against their recipes: the grid (tile size,
// margin, spacing, columns, tile count, image), every tile's probability, collision polygons, oneWay property and
// animation, and each Wang set's type, colours and Wang id of every tile. Then paints maps with Tiled's own terrain
// filler (a script's TileLayerWangEdit, which the Terrain Brush uses), giving every side and corner of every cell its
// colour as Pixelbolt's map has it, and every tile Tiled chooses must be one Pixelbolt's tilemap draws there. Last it
// renders a map of every tile with tmxrasterizer, which must give each frame's exported pixels. The sets and maps are
// the Godot check's (scripts/verify-godot.mjs), so both engines are held to the same tiles. Then it exports a scene
// holding every kind of placement, reads its scene.tmx in Tiled and renders it with tmxrasterizer, which must draw the
// scene's unlit view. Independent developer check: Pixelbolt never needs Tiled.
//   node scripts/verify-tiled.mjs [--tiled <path to tiled>] [--keep]
// Without --tiled it uses $TILED, then tiled on PATH, then the Windows installer's folder. Needs Tiled 1.10.2 or later.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBundle } from '../src/export.js';
import { createSceneBundle } from '../src/scene-export.js';
import { compileAutotile } from '../src/authoring.js';
import { neighbourMask } from '../src/autotile.js';
import { renderProject } from '../src/core.js';
import { prepareScene, renderScene } from '../src/scene.js';
import { decodePNG } from '../src/import.js';
import { GODOT_TILE_SOURCES, GODOT_LAYERED_SOURCE, GODOT_LAYERED_MAPS, GODOT_TILE_MAPS, godotTileRecipe } from './verify-godot.mjs';

export function findTiled(given = process.env.TILED) {
  if (given) return given;
  for (const name of ['tiled']) {
    const found = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim().split(/\r?\n/)[0];
  }
  for (const candidate of ['C:/Program Files/Tiled/tiled.exe', '/Applications/Tiled.app/Contents/MacOS/Tiled']) if (existsSync(candidate)) return candidate;
  return null;
}
const run = (program, args) => {
  const result = spawnSync(program, args, { encoding: 'utf8', timeout: 300000, windowsHide: true });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
};

// Runs in Tiled (--evaluate): reads each tileset with Tiled's own TSX reader, reports its grid, tiles and Wang sets,
// and paints each map: every listed cell gets its eight Wang colours, then Tiled's filler picks the tiles.
const TILED_CHECK = String.raw`
const [casesFile, outFile] = tiled.scriptArguments;
const input = new TextFile(casesFile, TextFile.ReadOnly), cases = JSON.parse(input.readAll());
input.close();
const results = cases.map(c => {
  try {
    const ts = tiled.tilesetFormat('tsx').read(c.file);
    const typeName = type => (type === WangSet.Corner ? 'corner' : type === WangSet.Edge ? 'edge' : type === WangSet.Mixed ? 'mixed' : String(type));
    const result = {
      grid: { tileCount: ts.tileCount, columns: ts.columnCount, tileWidth: ts.tileWidth, tileHeight: ts.tileHeight, margin: ts.margin, spacing: ts.tileSpacing, imageWidth: ts.imageWidth, imageHeight: ts.imageHeight, image: ts.image },
      tiles: ts.tiles.map(tile => ({ id: tile.id, probability: tile.probability, oneWay: tile.property('oneWay') === true,
        polygons: tile.objectGroup ? tile.objectGroup.objects.map(o => o.polygon.map(p => [o.x + p.x, o.y + p.y])) : [],
        frames: tile.animated ? tile.frames.map(f => [f.tileId, f.duration]) : [] })),
      wangSets: ts.wangSets.map(ws => ({ name: ws.name, type: typeName(ws.type), colors: Array.from({ length: ws.colorCount }, (_, k) => ws.colorName(k + 1)), wangIds: ts.tiles.map(tile => ws.wangId(tile)) })),
      paints: (c.paints || []).map(p => {
        const map = new TileMap();
        map.orientation = TileMap.Orthogonal;
        map.width = p.width; map.height = p.height; map.tileWidth = ts.tileWidth; map.tileHeight = ts.tileHeight;
        map.addTileset(ts);
        const layer = new TileLayer('paint');
        layer.width = p.width; layer.height = p.height;
        map.addLayer(layer);
        const edit = layer.wangEdit(ts.wangSets[p.set]);
        for (const [x, y, wang] of p.cells) for (let i = 0; i < 8; i++) edit.setWangIndex(x, y, i, wang[i]);
        edit.apply();
        const chose = [];
        for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) { const tile = layer.tileAt(x, y); chose.push(tile ? tile.id : -1); }
        return chose;
      })
    };
    return result;
  } catch (error) { return { error: String(error && error.stack || error) }; }
});
const out = new TextFile(outFile, TextFile.WriteOnly);
out.write(JSON.stringify({ version: tiled.version, results }));
out.commit();
`;

// What Tiled should find in one exported tileset, from the recipe and its atlas: per tile (a frame's index in the
// recipe) its kind, probability, polygons (exported pixels), oneWay, animation and Wang ids, and the Wang sets.
function tiledModel(recipe, atlas) {
  const project = renderProject(recipe), scale = Number(atlas.meta.scale), frames = recipe.frames, ids = new Map(frames.map((frame, i) => [frame.name, i]));
  const drawn = i => project.frames[i].data.some((value, k) => k % 4 === 3 && value > 0);
  const kinds = frames.map((frame, i) => {
    if (frame.tile?.corners) return { key: `corners ${frame.tile.corners.join()}`, corners: frame.tile.corners };
    if (frame.ops?.[0]?.op === 'autotile') return { key: `${frame.tile?.terrain ?? recipe.name} ${frame.ops[0].mask}`, terrain: frame.tile?.terrain ?? recipe.name, mode: frame.ops[0].mode ?? 'blob', mask: frame.ops[0].mask };
    return frame.tile || drawn(i) ? { key: 'plain' } : null;
  });
  // A looping animation over frames of one kind animates its first tile; its other frames are no Wang tiles.
  const animated = new Map(), covered = new Set();
  if (recipe.animations !== undefined) for (const animation of Object.values(atlas.animations)) {
    const sequence = animation.frames.map(name => ids.get(name)), kind = kinds[sequence[0]];
    if (!animation.loop || sequence.length < 2 || !kind || sequence.some(i => kinds[i]?.key !== kind.key) || animated.has(sequence[0]) || sequence.some(i => covered.has(i))) continue;
    animated.set(sequence[0], sequence.map(i => [i, atlas.frames[frames[i].name].duration]));
    for (const i of sequence.slice(1)) if (i !== sequence[0]) covered.add(i);
  }
  const weight = i => frames[i].tile?.weight ?? 1, heaviest = new Map();
  frames.forEach((_, i) => { if (kinds[i] && !covered.has(i)) heaviest.set(kinds[i].key, Math.max(heaviest.get(kinds[i].key) ?? 1, weight(i))); });
  const shapes = collision => (collision === undefined ? [] : Array.isArray(collision[0][0]) ? collision : [collision]);
  // Wang sets: each single terrain in order of first appearance, then the layered set, named by the recipe.
  const sets = [], layered = frames.map((_, i) => i).filter(i => kinds[i]?.corners && !covered.has(i));
  const WANG = { blob: [[1, 0], [2, 1], [4, 2], [8, 3], [16, 4], [32, 5], [64, 6], [128, 7]], cardinal: [[1, 0], [2, 2], [4, 4], [8, 6]], corner: [[1, 7], [2, 1], [4, 5], [8, 3]] };
  frames.forEach((_, i) => {
    const kind = kinds[i];
    if (!kind?.terrain || covered.has(i)) return;
    let set = sets.find(item => item.name === kind.terrain);
    if (!set) sets.push(set = { name: kind.terrain, type: { blob: 'mixed', cardinal: 'edge', corner: 'corner' }[kind.mode], colors: [kind.terrain], wang: new Map(), mode: kind.mode });
    if (kind.mask) set.wang.set(i, WANG[kind.mode].reduce((wang, [bit, at]) => { if (kind.mask & bit) wang[at] = 1; return wang; }, [0, 0, 0, 0, 0, 0, 0, 0]));
  });
  if (layered.length) {
    const colors = [];
    for (const i of layered) for (const corner of kinds[i].corners) if (!colors.includes(corner)) colors.push(corner);
    const wang = new Map(layered.map(i => { const id = [0, 0, 0, 0, 0, 0, 0, 0]; kinds[i].corners.forEach((corner, k) => { id[[7, 1, 5, 3][k]] = colors.indexOf(corner) + 1; }); return [i, id]; }));
    sets.push({ name: recipe.name, type: 'corner', colors, wang, layered: true });
  }
  const sheet = project.sheet, size = [recipe.width * scale, recipe.height * scale];
  return { name: recipe.name, frames, kinds, covered, animated, sets, size, scale,
    grid: { tileWidth: size[0], tileHeight: size[1], margin: sheet.padding * scale, spacing: sheet.padding * 2 * scale, columns: sheet.columns, tileCount: sheet.columns * Math.ceil(frames.length / sheet.columns), imageWidth: atlas.meta.size.w, imageHeight: atlas.meta.size.h },
    probability: i => (kinds[i] && !covered.has(i) ? weight(i) / heaviest.get(kinds[i].key) : 1),
    polygons: i => shapes(frames[i].tile?.collision).map(points => points.map(([x, y]) => [x * scale, y * scale])),
    oneWay: i => frames[i].tile?.oneWay === true };
}

// The cells to paint for one map and what Tiled must choose in each, as Pixelbolt's tilemap draws them: a blob or
// cardinal set's cells are the map's cells, a side coloured where both cells beside it are terrain and a corner where
// all four cells around it are; a corner set's tiles sit where four map cells meet, so the painted map is one cell
// wider and taller than Pixelbolt's map and its corners are that map's cells. `expect` lists, per painted cell, the
// kinds of tile allowed there (a kind key), or null for no tile.
function paintCase(model, setIndex, rows, keys) {
  const set = model.sets[setIndex], height = rows.length, width = rows[0].length, cells = [], expect = [];
  if (set.layered) {
    const at = (x, y) => rows[Math.min(Math.max(y, 0), height - 1)][Math.min(Math.max(x, 0), width - 1)];
    for (let y = 0; y <= height; y++) for (let x = 0; x <= width; x++) {
      const corners = [at(x - 1, y - 1), at(x, y - 1), at(x - 1, y), at(x, y)], wang = [0, 0, 0, 0, 0, 0, 0, 0];
      corners.forEach((char, k) => { wang[[7, 1, 5, 3][k]] = keys.indexOf(char) + 1; });
      cells.push([x, y, wang]);
      expect.push(`corners ${corners.map(char => set.colors[keys.indexOf(char)]).join()}`);
    }
    return { width: width + 1, height: height + 1, cells, expect };
  }
  const terrain = (x, y) => rows[y]?.[x] === '#';
  if (set.mode === 'corner') {
    for (let y = 0; y <= height; y++) for (let x = 0; x <= width; x++) {
      const corners = [terrain(x - 1, y - 1), terrain(x, y - 1), terrain(x - 1, y), terrain(x, y)], wang = [0, 0, 0, 0, 0, 0, 0, 0];
      corners.forEach((on, k) => { if (on) wang[[7, 1, 5, 3][k]] = 1; });
      cells.push([x, y, wang]);
      const mask = corners.reduce((bits, on, k) => (on ? bits | (1 << k) : bits), 0);
      expect.push(mask ? `${set.name} ${mask}` : null);
    }
    return { width: width + 1, height: height + 1, cells, expect };
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const on = terrain(x, y), wang = [0, 0, 0, 0, 0, 0, 0, 0];
    if (on) {
      const sides = [[0, -1, 0], [1, 0, 2], [0, 1, 4], [-1, 0, 6]];
      for (const [dx, dy, at] of sides) if (terrain(x + dx, y + dy)) wang[at] = 1;
      if (set.mode === 'blob') for (const [dx, dy, at] of [[1, -1, 1], [1, 1, 3], [-1, 1, 5], [-1, -1, 7]]) if (terrain(x + dx, y) && terrain(x, y + dy) && terrain(x + dx, y + dy)) wang[at] = 1;
    }
    cells.push([x, y, wang]);
    const mask = on ? neighbourMask(set.mode, (dx, dy) => terrain(x + dx, y + dy)) : 0;
    // A lone cell has no side or corner to paint, so Tiled leaves it empty; Pixelbolt draws its mask 0 tile.
    expect.push(mask ? `${set.name} ${mask}` : null);
  }
  return { width, height, cells, expect };
}

// A map holding every tile of the tileset in its own place, for tmxrasterizer.
const everyTileMap = (model, tsx) => {
  const { columns, tileCount, tileWidth, tileHeight } = model.grid, rows = tileCount / columns;
  const data = Array.from({ length: rows }, (_, y) => Array.from({ length: columns }, (_, x) => y * columns + x + 1).join(',')).join(',\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<map version="1.10" orientation="orthogonal" renderorder="right-down" width="${columns}" height="${rows}" tilewidth="${tileWidth}" tileheight="${tileHeight}" infinite="0" nextlayerid="2" nextobjectid="1">\n <tileset firstgid="1" source="${tsx}"/>\n <layer id="1" name="every tile" width="${columns}" height="${rows}">\n  <data encoding="csv">\n${data}\n</data>\n </layer>\n</map>\n`;
};

export async function verifyTiled({ tiled = findTiled(), keep = false, log = console.log } = {}) {
  if (!tiled) throw new Error('Tiled was not found: pass --tiled <path> or set TILED');
  const rasterizer = [path.join(path.dirname(tiled), process.platform === 'win32' ? 'tmxrasterizer.exe' : 'tmxrasterizer')].find(existsSync) ?? 'tmxrasterizer';
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-tiled-'));
  const put = async (file, bytes) => { await mkdir(path.dirname(path.join(dir, file)), { recursive: true }); await writeFile(path.join(dir, file), bytes); };
  try {
    const cases = [];
    const add = async (key, recipe, files, { tsx, png, atlas, paints = [] }) => {
      for (const [file, bytes] of files) await put(`${key}/${file}`, bytes);
      const model = tiledModel(recipe, atlas);
      cases.push({ key, recipe, model, tsx: `${key}/${tsx}`, png, paints: paints.map(paint => ({ ...paint, ...paintCase(model, paint.set, paint.rows, paint.keys) })) });
    };
    for (const source of GODOT_TILE_SOURCES) {
      const recipe = godotTileRecipe(source), bundle = await createBundle(recipe), { name } = bundle.project;
      assert.ok(bundle.files.has(`${name}.tsx`), `${name}: the export has no ${name}.tsx`);
      const files = [...bundle.files].filter(([file]) => file === `${name}.png` || file === `${name}.tsx` || file.startsWith('frames/'));
      await add(name, recipe, files, { tsx: `${name}.tsx`, png: `${name}.png`, atlas: JSON.parse(bundle.files.get(`${name}.atlas.json`)), paints: GODOT_TILE_MAPS.map(rows => ({ set: 0, rows, keys: '#' })) });
    }
    {
      const recipe = compileAutotile(GODOT_LAYERED_SOURCE).recipe, bundle = await createBundle(recipe), { name } = bundle.project, keys = GODOT_LAYERED_SOURCE.layers.map(layer => layer.key).join('');
      const files = [...bundle.files].filter(([file]) => file === `${name}.png` || file === `${name}.tsx` || file.startsWith('frames/'));
      await add(name, recipe, files, { tsx: `${name}.tsx`, png: `${name}.png`, atlas: JSON.parse(bundle.files.get(`${name}.atlas.json`)), paints: GODOT_LAYERED_MAPS.map(rows => ({ set: 0, rows, keys })) });
    }
    // A scene's tile-set assets, each a tileset of its own beside its colour pass.
    const [fence, ledge, moss] = [{ ...GODOT_TILE_SOURCES[1], sheet: { scale: 3 } }, GODOT_TILE_SOURCES[3], GODOT_TILE_SOURCES[4]].map(godotTileRecipe);
    const scene = await createSceneBundle({ format: 'pixelforge-scene', version: 1, name: 'tiles', width: 16, height: 16, assets: { fence, ledge, moss }, instances: [] });
    assert.deepEqual(scene.warnings, [], 'scene export warnings');
    for (const [i, recipe] of [fence, ledge, moss].entries()) {
      const folder = `assets/${i}`, frames = [...(await createBundle(recipe)).files].filter(([file]) => file.startsWith('frames/'));
      assert.ok(scene.files.has(`${folder}/tileset.tsx`), `the scene export has no ${folder}/tileset.tsx`);
      await add(`scene-${recipe.name}`, recipe, [['tileset.tsx', scene.files.get(`${folder}/tileset.tsx`)], ['color.png', scene.files.get(`${folder}/color.png`)], ...frames], { tsx: 'tileset.tsx', png: 'color.png', atlas: JSON.parse(scene.files.get(`${folder}/atlas.json`)) });
    }

    await writeFile(path.join(dir, 'cases.json'), JSON.stringify(cases.map(item => ({ key: item.key, file: path.join(dir, item.tsx).split(path.sep).join('/'), paints: item.paints.map(({ set, width, height, cells }) => ({ set, width, height, cells })) }))));
    await writeFile(path.join(dir, 'check.js'), TILED_CHECK);
    const evaluated = run(tiled, ['--evaluate', path.join(dir, 'check.js'), path.join(dir, 'cases.json'), path.join(dir, 'results.json')]);
    assert.ok(existsSync(path.join(dir, 'results.json')), `Tiled wrote no results (exit ${evaluated.status}):\n${evaluated.output}`);
    const { version, results } = JSON.parse(await readFile(path.join(dir, 'results.json'), 'utf8'));

    let tiles = 0, polygons = 0, wangTiles = 0, painted = 0, animations = 0, pixels = 0;
    for (const [n, item] of cases.entries()) {
      const got = results[n], { model, key } = item;
      assert.ok(!got.error, `${key}: Tiled failed: ${got.error}`);
      assert.deepEqual({ ...got.grid, image: path.basename(got.grid.image) }, { ...model.grid, image: path.basename(item.png) }, `${key}: grid`);
      assert.equal(got.tiles.length, model.grid.tileCount, `${key}: tiles`);
      for (const tile of got.tiles) {
        const i = tile.id, at = `${key} tile ${i}${model.frames[i] ? ` (${model.frames[i].name})` : ''}`, exists = i < model.frames.length;
        assert.ok(Math.abs(tile.probability - (exists ? model.probability(i) : 1)) < 1e-6, `${at}: probability ${tile.probability}, not ${exists ? model.probability(i) : 1}`);
        assert.deepEqual(tile.polygons, exists ? model.polygons(i) : [], `${at}: collision`);
        assert.equal(tile.oneWay, exists && model.oneWay(i), `${at}: oneWay`);
        assert.deepEqual(tile.frames, model.animated.get(i) ?? [], `${at}: animation`);
        polygons += tile.polygons.length;
        animations += tile.frames.length ? 1 : 0;
        tiles++;
      }
      assert.deepEqual(got.wangSets.map(set => [set.name, set.type, set.colors]), model.sets.map(set => [set.name, set.type, set.colors]), `${key}: Wang sets`);
      got.wangSets.forEach((set, s) => set.wangIds.forEach((id, i) => {
        assert.deepEqual(id, model.sets[s].wang.get(i) ?? [0, 0, 0, 0, 0, 0, 0, 0], `${key} Wang set ${set.name}, tile ${i}${model.frames[i] ? ` (${model.frames[i].name})` : ''}: Wang id`);
        if (model.sets[s].wang.has(i)) wangTiles++;
      }));
      // Tiled's filler against Pixelbolt's tilemap: any tile of the kind Pixelbolt draws (variants are a random pick).
      item.paints.forEach((paint, m) => got.paints[m].forEach((id, c) => {
        const want = paint.expect[c], x = c % paint.width, y = Math.floor(c / paint.width), kind = id < 0 ? null : model.kinds[id]?.key ?? `tile ${id}`;
        assert.equal(kind, want, `${key} map ${m} cell ${x},${y}: Tiled chose ${id < 0 ? 'no tile' : `tile ${id} (${model.frames[id]?.name})`}, a ${kind ?? 'gap'}, where Pixelbolt draws ${want ?? 'nothing'}`);
        if (id >= 0) assert.ok(!model.covered.has(id), `${key} map ${m} cell ${x},${y}: Tiled placed a later frame of an animated tile`);
        painted++;
      }));
      // tmxrasterizer draws every tile in its place: each must be its frame's exported pixels, and the rest empty.
      const tmx = path.join(dir, path.dirname(item.tsx), 'every-tile.tmx'), png = path.join(dir, path.dirname(item.tsx), 'every-tile.png');
      await writeFile(tmx, everyTileMap(model, path.basename(item.tsx)));
      const rendered = run(rasterizer, ['--no-smoothing', tmx, png]);
      assert.ok(existsSync(png), `${key}: tmxrasterizer wrote no image (exit ${rendered.status}):\n${rendered.output}`);
      const image = decodePNG(await readFile(png)), [w, h] = model.size, { columns } = model.grid;
      assert.deepEqual([image.width, image.height], [columns * w, (model.grid.tileCount / columns) * h], `${key}: rendered size`);
      for (let i = 0; i < model.grid.tileCount; i++) {
        const frame = i < model.frames.length ? decodePNG(await readFile(path.join(dir, item.key, 'frames', `${model.frames[i].name}.png`))) : null;
        let differ = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const at = (((Math.floor(i / columns) * h + y) * image.width) + (i % columns) * w + x) * 4, want = frame ? frame.data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4) : [0, 0, 0, 0];
          const alpha = image.data[at + 3];
          if (alpha !== want[3] || (alpha && [0, 1, 2].some(k => image.data[at + k] !== want[k]))) differ++;
          pixels++;
        }
        assert.equal(differ, 0, `${key} tile ${i}${model.frames[i] ? ` (${model.frames[i].name})` : ''}: ${differ} pixels differ from its frame in tmxrasterizer's render`);
      }
    }
    log(`Tiled ${version}: ${cases.length} tilesets loaded; ${tiles} tiles match their probability, ${polygons} collision polygons, oneWay and ${animations} animations; ${wangTiles} Wang tiles match their Wang ids; Tiled's terrain filler chose Pixelbolt's tile in all ${painted} painted cells; tmxrasterizer drew all ${pixels} pixels as exported.`);
    return { dir: keep ? dir : null };
  } finally {
    if (!keep) await rm(dir, { recursive: true, force: true });
  }
}

// ---- Scene maps ----------------------------------------------------------------------------------------------------
// A scene with every kind of placement a Tiled map holds: a layered map with variants, a corner map, a blob map, a map
// whose frames are taller than its cells (all tile layers), a map of a sheet exported at 3× and a ground-sorted map
// among a sorted placement (objects), a placement at 2× whose partly transparent glow falls on tiles, and a repeat.
const posts = { version: 1, name: 'posts', width: 4, height: 8, palette: { o: '#203018', b: '#a07040', t: '#d0a060' },
  frames: [{ name: 'post', ops: [{ op: 'rect', x: 1, y: 1, w: 2, h: 7, color: 'b' }, { op: 'pixel', x: 1, y: 1, color: 't' }] }, { name: 'stump', ops: [{ op: 'rect', x: 0, y: 5, w: 4, h: 3, color: 'o' }] }] };
export async function tiledScene() {
  const spirit = JSON.parse(await readFile(new URL('../examples/forest-spirit.json', import.meta.url), 'utf8'));
  const turf = godotTileRecipe({ ...GODOT_TILE_SOURCES[0], sheet: { padding: 1 } }), moss = godotTileRecipe({ ...GODOT_TILE_SOURCES[4], sheet: { padding: 1, columns: 4 } });
  const shore = compileAutotile({ ...GODOT_LAYERED_SOURCE, sheet: { padding: 1, columns: 9 } }).recipe, fence = godotTileRecipe({ ...GODOT_TILE_SOURCES[1], sheet: { scale: 3 } });
  const sea = ['wwwwwwwwwwwwwwwwwwwwwwww', 'wwsssssswwwwwwwwwwwwwwww', 'wsssggssswwwwwwwwwggwwww', 'wssggggsswwwwwwwwwggwwww', 'wsssggsssswwwwwwwwwwwwww', 'wwssssssswwwwwwwwwwwwwww', 'wwwwwwwwwwwwwwwwwwwwwwww', 'wwwwwwwwwwwwwwwwwwwwwwww'];
  return { format: 'pixelforge-scene', version: 1, name: 'tiled-check', width: 96, height: 72, background: '#203040', assets: { turf, moss, shore, fence, posts, spirit },
    instances: [
      { name: 'sea', asset: 'shore', at: [0, 0], tilemap: { tile: [4, 4], rows: sea, legend: { w: { frames: ['shore-{corners}', 'shore-{corners}-glint'], weights: [3, 1], autotile: 'corner' }, s: { frames: ['shore-{corners}', 'shore-{corners}-shell'], weights: [1, 2], autotile: 'corner' }, g: { frame: 'shore-{corners}', autotile: 'corner' } } } },
      { name: 'moss', asset: 'moss', at: [8, 36], tilemap: { tile: [4, 4], rows: ['.##..##', '####.##', '.###...', '..#....'], legend: { '#': { frames: ['moss-{mask}-a', 'moss-{mask}-b'], autotile: 'corner' } } } },
      { name: 'turf', asset: 'turf', at: [48, 36], tilemap: { tile: [4, 4], rows: ['.###.', '#####', '##.##', '.###.'], legend: { '#': { frame: 'turf-{mask}', autotile: 'blob' } } } },
      { name: 'fence', asset: 'fence', at: [8, 56], tilemap: { tile: [4, 4], rows: ['####', '#..#'], legend: { '#': { frame: 'fence-{mask}-plain', autotile: 'cardinal' } } } },
      { name: 'posts', asset: 'posts', at: [36, 34], tilemap: { tile: [4, 4], rows: ['#.#', '...', '#x#'], legend: { '#': 'post', x: 'stump' } } },
      { name: 'grove', asset: 'posts', at: [70, 50], sort: 'ground', tilemap: { tile: [4, 4], rows: ['#.#.', '.#.#', '#.#.'], legend: { '#': 'post' } } },
      { name: 'walker', asset: 'spirit', at: [72, 60], anchor: [12, 23], sort: 'ground', animation: 'bob' },
      { name: 'spirit', asset: 'spirit', at: [44, 2], animation: 'idle', scale: 2 },
      { name: 'wisps', asset: 'spirit', at: [40, 56], frame: spirit.frames[1].name, repeat: [2, 1], step: [14, 0] }
    ] };
}

// Runs in Tiled: reads scene.tmx with Tiled's own reader and reports its tilesets and, per layer, its kind, name,
// offset and how many tiles or tile objects it holds.
const TILED_MAP_CHECK = String.raw`
const [mapFile, outFile] = tiled.scriptArguments;
let result;
try {
  const map = tiled.mapFormat('tmx').read(mapFile);
  result = { size: [map.width, map.height, map.tileWidth, map.tileHeight], tilesets: map.tilesets.map(ts => [ts.name, ts.tileCount]),
    layers: map.layers.map(layer => {
      if (layer.isTileLayer) { let tiles = 0; for (let y = 0; y < layer.height; y++) for (let x = 0; x < layer.width; x++) if (layer.tileAt(x, y)) tiles++; return ['tiles', layer.name, layer.offset.x, layer.offset.y, tiles]; }
      return ['objects', layer.name, layer.offset.x, layer.offset.y, layer.objects.filter(o => o.tile).length];
    }) };
} catch (error) { result = { error: String(error && error.stack || error) }; }
const out = new TextFile(outFile, TextFile.WriteOnly);
out.write(JSON.stringify(result));
out.commit();
`;

// Exports the scene, has Tiled read scene.tmx, and renders it with tmxrasterizer, which must draw Pixelbolt's unlit
// view at time 0: every pixel exact, but for a step of one where a partly transparent pixel blends (Qt blends in
// premultiplied 8-bit colour). tmxrasterizer widens the map's rectangle by each tile layer's offset and leaves the
// map's background colour out, so the check lays its render on that colour at the map's origin.
export async function verifyTiledScene({ tiled = findTiled(), keep = false, log = console.log } = {}) {
  if (!tiled) throw new Error('Tiled was not found: pass --tiled <path> or set TILED');
  const rasterizer = [path.join(path.dirname(tiled), process.platform === 'win32' ? 'tmxrasterizer.exe' : 'tmxrasterizer')].find(existsSync) ?? 'tmxrasterizer';
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-tiled-scene-'));
  try {
    const source = await tiledScene(), bundle = await createSceneBundle(source);
    for (const [file, bytes] of bundle.files) if (/\.(tmx|tsx|png)$/.test(file)) { await mkdir(path.dirname(path.join(dir, file)), { recursive: true }); await writeFile(path.join(dir, file), bytes); }
    await writeFile(path.join(dir, 'mapcheck.js'), TILED_MAP_CHECK);
    const evaluated = run(tiled, ['--evaluate', path.join(dir, 'mapcheck.js'), path.join(dir, 'scene.tmx'), path.join(dir, 'map.json')]);
    assert.ok(existsSync(path.join(dir, 'map.json')), `Tiled wrote no report (exit ${evaluated.status}):\n${evaluated.output}`);
    const read = JSON.parse(await readFile(path.join(dir, 'map.json'), 'utf8'));
    assert.ok(!read.error, `Tiled failed to read scene.tmx: ${read.error}`);
    const scene = prepareScene(source), view = renderScene(scene, { lit: false, draws: true });
    assert.deepEqual(read.tilesets, Object.entries(scene.assets).map(([id, asset]) => [id, asset.recipe.sheet.columns * Math.ceil(asset.recipe.frames.length / asset.recipe.sheet.columns)]), 'scene.tmx: tilesets');
    // The square, unsorted maps at 1× of 1× sheets are tile layers: the corner maps half a cell up and left, the posts
    // (8 pixels tall on 4-pixel cells, at y 34) a cell lower, since Tiled hangs a tile from its cell's bottom, and up
    // the 2 pixels left over from whole cells. The rest are tile objects in drawing order.
    const cells = name => view.draws.filter(draw => draw.cell !== undefined && scene.instances[draw.instance].name === name).length;
    const objects = names => view.draws.filter(draw => names.includes(scene.instances[draw.instance].name)).length;
    assert.deepEqual(read.layers, [['tiles', 'sea', -2, -2, cells('sea')], ['tiles', 'moss', -2, -2, cells('moss')], ['tiles', 'turf', 0, 0, cells('turf')], ['objects', 'fence', 0, 0, objects(['fence'])],
      ['tiles', 'posts', 0, -2, cells('posts')], ['objects', 'grove, walker, spirit, wisps', 0, 0, objects(['grove', 'walker', 'spirit', 'wisps'])]], 'scene.tmx: layers');
    assert.deepEqual(bundle.warnings.filter(warning => warning.startsWith('scene.tmx')), [], 'scene.tmx warnings');
    // Where some frame's partly transparent pixel lands, Qt's blend may differ by one.
    const blended = new Uint8Array(scene.width * scene.height);
    for (const draw of view.draws) {
      const project = scene.assets[draw.asset].recipe, data = project.frames[draw.frame].data, s = draw.scale;
      for (let y = 0; y < project.height * s; y++) for (let x = 0; x < project.width * s; x++) {
        const alpha = data[(Math.floor(y / s) * project.width + Math.floor(x / s)) * 4 + 3], sx = draw.x + x, sy = draw.y + y;
        if (alpha > 0 && alpha < 255 && sx >= 0 && sy >= 0 && sx < scene.width && sy < scene.height) blended[sy * scene.width + sx] = 1;
      }
    }
    const rendered = run(rasterizer, ['--no-smoothing', path.join(dir, 'scene.tmx'), path.join(dir, 'tiled.png')]);
    assert.ok(existsSync(path.join(dir, 'tiled.png')), `tmxrasterizer wrote no image (exit ${rendered.status}):\n${rendered.output}`);
    const image = decodePNG(await readFile(path.join(dir, 'tiled.png'))), tmx = await readFile(path.join(dir, 'scene.tmx'), 'utf8');
    let left = 0, top = 0;
    for (const [, attributes] of tmx.matchAll(/<layer ([^>]*)>/g)) {
      left = Math.max(left, Math.ceil(-Number(attributes.match(/offsetx="(-?[\d.]+)"/)?.[1] ?? 0)));
      top = Math.max(top, Math.ceil(-Number(attributes.match(/offsety="(-?[\d.]+)"/)?.[1] ?? 0)));
    }
    const hex = tmx.match(/backgroundcolor="#([0-9a-f]{6})"/)[1], background = [0, 2, 4].map(k => parseInt(hex.slice(k, k + 2), 16));
    let exact = 0, near = 0;
    const wrong = [];
    for (let y = 0; y < scene.height; y++) for (let x = 0; x < scene.width; x++) {
      const at = ((y + top) * image.width + x + left) * 4, alpha = image.data[at + 3] / 255, want = view.data.subarray((y * scene.width + x) * 4, (y * scene.width + x) * 4 + 4);
      const got = [0, 1, 2].map(k => Math.round(image.data[at + k] * alpha + background[k] * (1 - alpha)));
      const off = Math.max(...got.map((v, k) => Math.abs(v - want[k])));
      if (off === 0) exact++;
      else if (off === 1 && blended[y * scene.width + x]) near++;
      else wrong.push(`${x},${y}: Tiled ${got.join(' ')}, Pixelbolt ${[...want.subarray(0, 3)].join(' ')}`);
    }
    assert.deepEqual(wrong.slice(0, 12), [], `scene.tmx: ${wrong.length} pixels of tmxrasterizer's render differ from the unlit scene`);
    log(`Tiled scene map: Tiled read scene.tmx with ${read.layers.filter(layer => layer[0] === 'tiles').length} tile layers and ${read.layers.filter(layer => layer[0] === 'objects').reduce((sum, layer) => sum + layer[4], 0)} tile objects over ${read.tilesets.length} tilesets; tmxrasterizer drew the unlit scene exactly in ${exact} of ${scene.width * scene.height} pixels and within one step in the other ${near}, where partly transparent pixels blend.`);
    return { dir: keep ? dir : null };
  } finally {
    if (!keep) await rm(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), at = args.indexOf('--tiled');
  try {
    for (const verify of [verifyTiled, verifyTiledScene]) {
      const result = await verify({ ...(at >= 0 && { tiled: args[at + 1] }), keep: args.includes('--keep') });
      if (result.dir) console.log(`Kept the Tiled files at ${result.dir}`);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
