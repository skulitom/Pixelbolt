import { readFile } from 'node:fs/promises';
import { prepareScene, renderScene } from './scene.js';
import { encodePNG } from './png.js';
import { buildAtlas } from './core.js';
import { spriteFrames, canvasTexture, normalsYUp, tileSets } from './godot.js';
import { tileSource } from './export.js';
import { tiledTileset } from './tiled.js';

export async function createSceneBundle(source) {
  const scene = prepareScene(source), view = renderScene(scene), files = new Map();
  files.set('scene.json', Buffer.from(JSON.stringify(source, null, 2) + '\n'));
  files.set('scene.png', encodePNG(view.data, view.width, view.height));
  const unlit = renderScene(scene, { lit: false });
  files.set('unlit.png', encodePNG(unlit.data, unlit.width, unlit.height));
  const tiles = [], tileWarnings = [], alignment = { version: 1, coordinates: 'atlas pixels; normal RGB encodes XYZ in [0,255], +X right, +Y down, +Z toward viewer (normalYUp flips green to +Y up, as Godot and Unity read normal maps); never color-quantize normal passes', assets: Object.create(null) };
  for (const [id, asset] of Object.entries(scene.assets)) {
    // Asset keys may contain punctuation; use a stable numeric export directory.
    const directory = `assets/${Object.keys(alignment.assets).length}`;
    // Aligned passes share one uniform grid, even when a recipe trims its own export.
    const atlas = buildAtlas(asset.recipe, { trim: false });
    atlas.metadata.meta.image = 'color.png';
    const entry = alignment.assets[id] = { directory, metadata: `${directory}/atlas.json`, godot: `${directory}/sprite_frames.tres`, passes: {} };
    files.set(`${directory}/atlas.json`, Buffer.from(JSON.stringify(atlas.metadata, null, 2) + '\n'));
    for (const [pass, project] of Object.entries(asset)) {
      const rendered = pass === 'recipe' ? atlas : buildAtlas(project, { trim: false }), filename = `${directory}/${pass === 'recipe' ? 'color' : pass}.png`;
      files.set(filename, encodePNG(rendered.data, rendered.width, rendered.height));
      entry.passes[pass === 'recipe' ? 'color' : pass] = filename;
      if (pass !== 'normal') continue;
      // Godot reads a normal map +Y up: a flipped copy, and a CanvasTexture pairing it with the colour pass.
      files.set(`${directory}/normal_y_up.png`, encodePNG(normalsYUp(rendered.data), rendered.width, rendered.height));
      entry.passes.normalYUp = `${directory}/normal_y_up.png`;
      files.set(`${directory}/canvas_texture.tres`, Buffer.from(canvasTexture({ diffuse: 'color.png', normal: 'normal_y_up.png' })));
      entry.canvasTexture = `${directory}/canvas_texture.tres`;
    }
    // Godot 4 SpriteFrames over the colour pass beside it, drawn through the CanvasTexture when there is a normal pass,
    // so an AnimatedSprite2D with it is lit by Light2D nodes.
    files.set(`${directory}/sprite_frames.tres`, Buffer.from(spriteFrames(atlas.metadata, entry.canvasTexture ? { image: 'canvas_texture.tres' } : {}).text));
    // An asset that is a tile set joins the scene's TileSet as an atlas source, named by its id and drawn through its
    // CanvasTexture when it has one, so Light2D nodes light the tiles.
    const value = source.assets[id], spec = value?.recipe ?? value;
    const set = tileSource(spec, asset.recipe, atlas, { name: id, image: entry.canvasTexture ?? `${directory}/color.png` });
    if (set) tiles.push({ id, set });
    // And a Tiled tileset of its own beside its colour pass, since a Tiled tileset cuts one image.
    if (set) {
      const tiled = tiledTileset({ ...set, image: 'color.png' });
      tileWarnings.push(...tiled.warnings.map(warning => `${directory}/tileset.tsx: ${warning}`));
      if (tiled.text !== null) {
        files.set(`${directory}/tileset.tsx`, Buffer.from(tiled.text));
        entry.tiled = `${directory}/tileset.tsx`;
      }
    }
  }
  // One Godot TileSet holds every tile set of the scene, each a terrain set of its own, so one TileMapLayer paints all
  // of them and each one's edges open onto the others, as the scene's tilemaps draw them.
  if (tiles.length) {
    const result = tileSets(tiles.map(item => item.set));
    tileWarnings.push(...result.warnings.map(warning => `tileset.tres: ${warning}`));
    if (result.text !== null) {
      files.set('tileset.tres', Buffer.from(result.text));
      alignment.tileset = { file: 'tileset.tres', assets: tiles.map(item => item.id) };
    }
  }
  files.set('alignment.json', Buffer.from(JSON.stringify(alignment, null, 2) + '\n'));
  files.set('review.json', Buffer.from(JSON.stringify({ placements: view.placements, warnings: [...view.warnings, ...tileWarnings] }, null, 2) + '\n'));
  for (const file of ['core.js', 'craft.js', 'font.js', 'authoring.js', 'pose-geometry.js', 'motions.js', 'autotile.js', 'terrain.js', 'scene.js']) files.set(file, await readFile(new URL(file, import.meta.url)));
  for (const [file, source] of [['preview.html', '../studio/scene.html'], ['scene-player.js', '../studio/scene-player.js'], ['scene.css', '../studio/scene.css']]) files.set(file, await readFile(new URL(source, import.meta.url)));
  return { files, scene, warnings: [...view.warnings, ...tileWarnings] };
}
