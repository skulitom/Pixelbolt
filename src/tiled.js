// Tiled (mapeditor.org) tilesets in Tiled's XML format (.tsx), made from a Pixelbolt atlas. Browser-compatible: no
// imports, and the same atlas always gives the same bytes.
//
// A Tiled tileset cuts one image into a grid. Pixelbolt's untrimmed sheet is that grid: every cell is padded on all
// sides, so the margin is the padding and the spacing twice it, and a frame's tile id is its place in the grid, its
// index among the recipe's frames. Terrains become Wang sets, Tiled's terrain sets, which its Terrain Brush paints:
// - blob, cardinal and corner sets become mixed (sides and corners), edge and corner Wang sets, one per terrain with
//   one colour. A tile's Wang id marks the sides and corners where its terrain goes on, which is its neighbour mask:
//   Tiled lists them top, top-right, right, …, top-left, the order of a blob mask's bits. Tiled's brush paints sides
//   and corners, not cells, so a lone cell (a blob or cardinal mask 0) has none and is no Wang tile; place it by hand.
//   A corner set's empty tile is none either: Tiled leaves the cell empty.
// - a layered set becomes one corner Wang set whose colours are its terrains in order of first appearance, the bottom
//   first; a tile's corners are its corners' colours. A corner set's corners are Pixelbolt's map cells, so painting
//   them as a map's cells draws the tiles Pixelbolt's tilemap draws.
// A frame's tile.weight becomes its probability against the heaviest tile of its kind (one terrain and mask, one set of
// corners, or the plain tiles), which Tiled picks between; its tile.collision polygons objects in its collision group
// (in exported pixels) and tile.oneWay a bool property oneWay. A looping atlas animation over frames of one kind (one terrain and
// mask, one set of corners, or plain tiles) animates its first frame's tile; its other frames are then no Wang tiles,
// so the brush never places a still frame of it.

// The positions in a Wang id of each mask bit: blob bits run in Tiled's order; a cardinal mask has sides only and a
// corner mask (NW, NE, SW, SE) corners only.
const WANG_INDEX = {
  blob: [[1, 0], [2, 1], [4, 2], [8, 3], [16, 4], [32, 5], [64, 6], [128, 7]],
  cardinal: [[1, 0], [2, 2], [4, 4], [8, 6]],
  corner: [[1, 7], [2, 1], [4, 5], [8, 3]]
};
// A layered tile's corners (NW, NE, SW, SE) in a Wang id.
const CORNER_PLACES = [7, 1, 5, 3];
const WANG_TYPES = { blob: 'mixed', cardinal: 'edge', corner: 'corner' };
// Wang tiles a complete set has: its masks less the one with no terrain around it.
const WANG_TILES = { blob: 46, cardinal: 15, corner: 15 };
// The Tiled map format this file is written in; every feature used has been read since Tiled 1.5.
export const TILED_FORMAT = '1.10';

const xml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hex = ([r, g, b]) => `#${[r, g, b].map(channel => channel.toString(16).padStart(2, '0')).join('')}`;
const number = value => String(Number(value.toFixed(6)));
const popcount = mask => { let bits = 0; for (let m = mask; m; m &= m - 1) bits++; return bits; };

// A Tiled tileset (.tsx) of one sheet. `source` is a tile source as export.js's tileSource makes it:
// { atlas, tiles, layered, plain, colors, name, terrain, margin, separation, image }, the atlas untrimmed and image the
// sheet's path relative to the .tsx (default the atlas's meta.image, beside it). Returns { text, warnings }; text is
// null when the sheet is not a grid.
export function tiledTileset(source) {
  const { atlas, margin = 0, separation = 0 } = source, warnings = [], frames = atlas.frames, names = Object.keys(frames);
  const first = frames[names[0]].frame, [w, h] = [first.w, first.h], { w: width, h: height } = atlas.meta.size;
  // The grid Tiled cuts the image into, which every frame must sit on.
  const columns = (width - 2 * margin + separation) / (w + separation), rows = (height - 2 * margin + separation) / (h + separation);
  const place = name => { const { x, y, w: fw, h: fh } = frames[name].frame; return { col: (x - margin) / (w + separation), row: (y - margin) / (h + separation), fw, fh }; };
  const offGrid = names.find(name => { const { col, row, fw, fh } = place(name); return fw !== w || fh !== h || !Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= columns || row >= rows; });
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || offGrid !== undefined) return { text: null, warnings: ['not written: a Tiled tileset cuts its image into a grid, and this sheet has none (a trimmed sheet packs frames without one)'] };
  const id = name => { const { col, row } = place(name); return row * columns + col; };

  // What a frame is as a tile: its terrain and mask, its corners, '' for a plain tile, or null for none.
  const byFrame = new Map(source.tiles.map(tile => [tile.frame, { ...tile, terrain: tile.terrain ?? source.terrain ?? source.name }]));
  const cornered = new Map((source.layered ?? []).map(tile => [tile.frame, tile.corners])), plain = new Set(source.plain ?? []);
  const kind = frame => (byFrame.has(frame) ? `${byFrame.get(frame).terrain} ${byFrame.get(frame).mask}` : cornered.has(frame) ? `corners ${cornered.get(frame).join()}` : plain.has(frame) ? '' : null);

  // Animated tiles: a looping animation over frames of one kind, each frame used by one animation at most.
  const animated = new Map(), covered = new Set(), stopping = [];
  for (const [key, animation] of Object.entries(atlas.animations ?? {})) {
    const sequence = animation.frames, start = kind(sequence[0]);
    if (sequence.length < 2 || start === null || sequence.some(frame => kind(frame) !== start) || animated.has(sequence[0]) || sequence.some(frame => covered.has(frame))) continue;
    if (!animation.loop) { stopping.push(key); continue; }
    animated.set(sequence[0], sequence);
    for (const frame of sequence.slice(1)) if (frame !== sequence[0]) covered.add(frame);
  }
  if (stopping.length) warnings.push(`animation${stopping.length === 1 ? '' : 's'} ${stopping.slice(0, 8).join(', ')}${stopping.length > 8 ? ', …' : ''} became still tiles of ${stopping.length === 1 ? 'its' : 'their'} first frame: Tiled loops every tile animation`);
  const tiled = names.filter(frame => kind(frame) !== null && !covered.has(frame));

  // Wang sets: one per single terrain, in order of first appearance, then the layered set.
  const sets = new Map();
  for (const frame of tiled) {
    const tile = byFrame.get(frame);
    if (!tile) continue;
    if (!sets.has(tile.terrain)) sets.set(tile.terrain, { name: tile.terrain, modes: new Set(), colors: [tile.terrain], tiles: [] });
    const set = sets.get(tile.terrain);
    set.modes.add(tile.mode);
    let wang = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const [bit, at] of WANG_INDEX[tile.mode]) if (tile.mask & bit) wang[at] = 1;
    if (tile.mask) set.tiles.push({ frame, wang, mask: tile.mask });
  }
  for (const set of sets.values()) {
    if (set.modes.size > 1) {
      warnings.push(`terrain ${set.name}: no Wang set: it mixes ${[...set.modes].sort().join(' and ')} masks, and a Tiled Wang set matches one way; give one set's frames another tile.terrain`);
      sets.delete(set.name);
      continue;
    }
    set.type = WANG_TYPES[[...set.modes][0]];
    const masks = new Set(set.tiles.map(tile => tile.mask)), missing = WANG_TILES[[...set.modes][0]] - masks.size;
    if (missing > 0) warnings.push(`${sets.size > 1 ? `terrain ${set.name}: ` : ''}${missing} of the ${WANG_TILES[[...set.modes][0]]} ${[...set.modes][0]} Wang tiles are missing, so Tiled draws its nearest match where one is needed`);
    const fullest = set.tiles.reduce((best, tile) => (!best || popcount(tile.mask) > popcount(best.mask) ? tile : best), null);
    set.icon = fullest ? id(fullest.frame) : -1;
    set.colorIcons = [set.icon];
  }
  const layered = tiled.filter(frame => cornered.has(frame));
  if (layered.length) {
    const colors = [];
    for (const frame of layered) for (const corner of cornered.get(frame)) if (!colors.includes(corner)) colors.push(corner);
    const combinations = colors.length * colors.length * colors.length * colors.length, missing = combinations - new Set(layered.map(frame => cornered.get(frame).join())).size;
    if (missing > 0) warnings.push(`${missing} of the ${combinations} combinations of ${colors.join(', ')} at a tile's corners have no tile, so Tiled draws its nearest match where one is needed`);
    const tiles = layered.map(frame => { const wang = [0, 0, 0, 0, 0, 0, 0, 0]; cornered.get(frame).forEach((corner, k) => { wang[CORNER_PLACES[k]] = colors.indexOf(corner) + 1; }); return { frame, wang }; });
    // Each colour's icon is its plain tile, with it at every corner.
    const colorIcons = colors.map(color => { const tile = layered.find(frame => cornered.get(frame).every(corner => corner === color)); return tile === undefined ? -1 : id(tile); });
    sets.set(`\u0000layers`, { name: source.name, type: 'corner', colors, tiles, icon: -1, colorIcons });
  }

  // Probabilities: a tile's weight against the heaviest tile of its kind, which the Terrain Brush (and the stamp
  // brush's random mode) picks between.
  const weight = frame => frames[frame].tile?.weight ?? 1, heaviest = new Map();
  for (const frame of tiled) heaviest.set(kind(frame), Math.max(heaviest.get(kind(frame)) ?? 1, weight(frame)));

  const lines = ['<?xml version="1.0" encoding="UTF-8"?>',
    `<tileset version="${TILED_FORMAT}" name="${xml(source.name)}" tilewidth="${w}" tileheight="${h}"${separation ? ` spacing="${separation}"` : ''}${margin ? ` margin="${margin}"` : ''} tilecount="${columns * rows}" columns="${columns}">`,
    ` <image source="${xml(source.image ?? atlas.meta.image)}" width="${width}" height="${height}"/>`];
  const described = names.map(frame => [id(frame), frame]).sort((a, b) => a[0] - b[0]);
  for (const [tileId, frame] of described) {
    const facts = frames[frame].tile ?? {}, isTile = kind(frame) !== null, inner = [];
    const probability = isTile && !covered.has(frame) ? weight(frame) / heaviest.get(kind(frame)) : 1;
    if (facts.oneWay) inner.push('  <properties>', '   <property name="oneWay" type="bool" value="true"/>', '  </properties>');
    if (facts.collision?.length) {
      inner.push('  <objectgroup draworder="index" id="2">');
      facts.collision.forEach((polygon, k) => inner.push(`   <object id="${k + 1}" x="0" y="0">`, `    <polygon points="${polygon.map(({ x, y }) => `${x},${y}`).join(' ')}"/>`, '   </object>'));
      inner.push('  </objectgroup>');
    }
    if (animated.has(frame)) inner.push('  <animation>', ...animated.get(frame).map(step => `   <frame tileid="${id(step)}" duration="${Math.max(1, Math.round(frames[step].duration))}"/>`), '  </animation>');
    if (probability === 1 && !inner.length) continue;
    const open = ` <tile id="${tileId}"${probability !== 1 ? ` probability="${number(probability)}"` : ''}`;
    lines.push(...(inner.length ? [`${open}>`, ...inner, ' </tile>'] : [`${open}/>`]));
  }
  if (sets.size) {
    lines.push(' <wangsets>');
    for (const set of sets.values()) {
      lines.push(`  <wangset name="${xml(set.name)}" type="${set.type}" tile="${set.icon}">`);
      set.colors.forEach((color, k) => lines.push(`   <wangcolor name="${xml(color)}" color="${hex(source.colors?.[color] ?? [255, 255, 255])}" tile="${set.colorIcons[k] ?? -1}" probability="1"/>`));
      for (const tile of [...set.tiles].sort((a, b) => id(a.frame) - id(b.frame))) lines.push(`   <wangtile tileid="${id(tile.frame)}" wangid="${tile.wang.join(',')}"/>`);
      lines.push('  </wangset>');
    }
    lines.push(' </wangsets>');
  }
  lines.push('</tileset>', '');
  return { text: lines.join('\n'), warnings };
}
