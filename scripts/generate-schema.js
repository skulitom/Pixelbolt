import { writeFile } from 'node:fs/promises';
import { DITHER_PATTERNS, EASINGS } from '../src/craft.js';
import { FLUID_KINDS, FLUID_FIELDS, FLUID_WALLS } from '../src/fluid.js';
import { FX_EVENTS } from '../src/fx.js';
import { SHAPE_KINDS } from '../src/shapes.js';
import { NORMAL_DIRECTIONS } from '../src/authoring.js';
const NORMAL_KEYS = Object.keys(NORMAL_DIRECTIONS);
const int = (minimum, maximum, description) => ({ type: 'integer', minimum, maximum, ...(description ? { description } : {}) });
const num = (minimum, maximum, description) => ({ type: 'number', minimum, maximum, ...(description ? { description } : {}) });
const bool = { type: 'boolean' }, color = { type: 'string', description: 'Palette name, transparent, or #RGB/#RGBA/#RRGGBB/#RRGGBBAA.' };
const id = { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_-]{0,63}$', description: 'Portable name: do not use Windows device names (CON, PRN, AUX, NUL, COM1–9, LPT1–9). Frame/animation names must be unique ignoring case.' };
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const ref = name => ({ $ref: `#/$defs/${name}` });
const array = (items, maxItems = 2048) => ({ type: 'array', items, maxItems });
const xy = { x: int(-4096, 4096), y: int(-4096, 4096) };
// Shapes and dither or shade regions may overhang the canvas: up to 512 pixels, or twice the side of a larger still.
const wh = { w: int(1, 8192, 'At most 512, or twice the canvas width on a still wider than 256.'), h: int(1, 8192, 'At most 512, or twice the canvas height on a still taller than 256.') };
// A rewrite region stays inside the canvas; it runs to the canvas edge by default.
const region = { w: int(1, 4096, 'Default: to the canvas edge. The region stays inside the canvas.'), h: int(1, 4096, 'Default: to the canvas edge. The region stays inside the canvas.') };
// One frame may be a still larger than 256 pixels a side; a recipe with several frames may not.
const side = int(1, 4096, '1–256 pixels; a still (a recipe with exactly one frame) may be up to 4096, within 4,194,304 pixels in all.');
// The row an operation stands on, in a layer with sort "ground".
const ground = int(-4096, 4096, 'In a layer with sort "ground": the row this stands on, which orders the drawing far to near. Default: the lowest row it draws (a line\'s lower end). Text needs it.');
const point = { ...array(int(-4096, 4096), 2), minItems: 2, description: '[x, y] in unscaled canvas pixels; the top-left corner of that pixel.' };
const transform = { scale: int(1, 16), flipX: bool, flipY: bool, rotate: { enum: [0, 90, 180, 270] } };
const remap = { type: 'object', propertyNames: { minLength: 1, maxLength: 1 }, additionalProperties: color, description: 'Recolor grid characters for this operation only: character → palette name or colour.' };
const operation = (op, properties, required = []) => object({ op: { const: op }, ...properties }, ['op', ...required]);
const hex = '^(transparent|#([a-fA-F0-9]{3,4}|[a-fA-F0-9]{6}|[a-fA-F0-9]{8}))$';
// An opaque colour: #RGB or #RRGGBB, or with a full alpha.
const opaqueHex = '^#([a-fA-F0-9]{3}[fF]?|[a-fA-F0-9]{6}([fF]{2})?)$';
const pairOf = item => ({ ...array(item, 2), minItems: 2 });
const ruleRows = { ...array({ type: 'string', minLength: 1, maxLength: 8 }, 8), minItems: 1, description: 'Equal-width rows of palette keys; dot or space matches anything (match) or keeps the pixel (replace); the empty character stands for transparent.' };
const ease = { enum: EASINGS, description: 'linear (default), hold (jump at the end), in, out, inOut, overshoot or bounce.' };
const names64 = { ...array({ type: 'string', minLength: 1 }, 64), minItems: 1 };
// Tilemap legends are shared by scene tilemaps (frames and animations) and the recipe tilemap operation (symbols and
// autotile templates); `kinds` are the singular names, each also with a plural for variants.
const legend = (kinds, describe) => {
  const draws = Object.fromEntries(kinds.flatMap(kind => [[kind, { type: 'string', description: describe[kind] }], [`${kind}s`, { ...names64, description: `Variants of ${kind}, picked by cell position (seeded when the tilemap has a seed).` }]]));
  const shared = { ...draws, weights: { ...array(int(1, 1000), 64), minItems: 1, description: 'One whole-number weight per variant name; heavier names are picked more often.' },
    autotile: { enum: ['blob', 'cardinal'], description: 'Pick by neighbour mask: 47-value blob or 16-value cardinal.' }, match: { type: 'string', minLength: 1, description: 'Characters counted as the same terrain for the mask; default: this character.' } };
  const rule = object({ ...shared,
    where: { ...array({ type: 'string', minLength: 3, maxLength: 3 }, 3), minItems: 3, description: '3×3 characters centred on the cell. A dot matches anything, the tilemap\'s empty character matches empty cells (and cells beyond the map), a class matches its members, any other character matches itself.' },
    chance: num(0, 1, 'Seeded probability that a matching rule draws.'), offset: { ...pairOf(int(-8, 8)), description: '[columns, rows] to draw into another cell; it draws over that cell\'s own tiles.' },
    stop: { type: 'boolean', description: 'When this rule draws, skip the rest of the cell\'s rules.' } });
  return { type: 'object', propertyNames: { minLength: 1, maxLength: 1 }, description: 'Map characters to what they draw. Dot and space are empty cells.', additionalProperties: { oneOf: [
    { type: 'string', description: describe[kinds[0]] },
    object(shared),
    { ...object({ rules: { ...array(rule, 32), minItems: 1, description: 'Every rule that matches draws, in order, until one with stop draws.' } }, ['rules']) },
    { type: 'null', description: 'Context cell: never drawn, but it counts for other entries\' match and for rules.' }] } };
};
const tilemapFields = {
  rows: { ...array({ type: 'string', minLength: 1, maxLength: 256 }, 256), minItems: 1 },
  outside: { enum: ['empty', 'match'], description: 'Cells beyond the map: empty (default), or matching every mask and rule pattern.' },
  empty: { type: 'string', minLength: 1, maxLength: 1, description: 'A character, not a legend key, that stands for empty cells in rule patterns.' },
  classes: { type: 'object', propertyNames: { minLength: 1, maxLength: 1 }, additionalProperties: { type: 'string', minLength: 1, maxLength: 64 }, description: 'Characters that stand for several map characters in rule patterns, e.g. {"#": "WV"}; include the empty character to match empty cells too.' },
  seed: int(0, 2147483647, 'Reshuffles variant picks and rule chances, which are seeded by cell position; default 0.'),
  layout: { enum: ['square', 'iso'], description: 'square (default): cells side by side, each drawing from its top-left. iso: a 2:1 diamond grid (even tile sizes such as [32, 16]), drawn back to front, cell [x, y] at [(x - y + rows - 1) * w/2, (x + y) * h/2]; each drawing stands on its diamond, bottoms aligned and centred across, so a block taller than the tile rises above its cell.' }
};
const densityFields = {
  density: { oneOf: [num(0, 1), pairOf(num(0, 1))], description: 'Share of pixels changed, 0–1, or [from, to] ramping along direction.' },
  direction: { enum: ['down', 'up', 'right', 'left', 'radial'], description: 'Ramp direction for a [from, to] density; radial runs from the centre to the edge.' },
  pattern: { oneOf: [{ enum: DITHER_PATTERNS }, { ...array({ ...array(int(0, 255), 16), minItems: 1 }, 16), minItems: 1, description: 'Rows of ranks from 0 to cells − 1; low ranks turn on first, and a highest rank n gives n + 1 levels, so [[0, 1], [1, 0]] is a checkerboard at 0.5.' }], description: 'bayer4 by default. noise is seeded white noise with no repeating grid; value is seeded smooth noise that forms clumps about scale pixels across. Patterns follow canvas coordinates, so neighbouring areas line up.' },
  offset: { ...point, description: 'Shift the pattern, for example to crawl it between frames.' },
  seed: int(0, 2147483647, 'Orders the noise or value pattern (default 0): the same seed keeps every pixel\'s threshold, so a rising density grows in a fixed order; another seed reshuffles it.'),
  scale: int(1, 64, 'Clump size of the value pattern in pixels; default 4.'),
  over: { oneOf: [color, { ...array(color, 64), minItems: 1 }], description: 'Only change pixels whose exact current color is listed (transparent included).' }
};
const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Pixelbolt project',
  ...object({
    $schema: { type: 'string' }, version: { const: 1 }, name: id,
    width: side, height: side,
    palette: { type: 'object', maxProperties: 257, properties: { $ref: { type: 'string', description: 'Shared palette file, resolved by the CLI and MCP relative to this recipe. Local entries add to or override it.' } }, additionalProperties: { type: 'string', pattern: hex } },
    ramps: { ...array({ ...array({ type: 'string', minLength: 1, maxLength: 64 }, 32), minItems: 2 }, 64), description: 'Palette keys from dark to light, one list per material. shade and scene ramp lighting move a colour along its ramp instead of inventing one. A key belongs to one ramp. A shared palette file ({"palette": {...}, "ramps": [...]}) can supply them.' },
    background: color, symbols: { type: 'object', propertyNames: id, additionalProperties: ref('rows') },
    anchor: { ...point, description: 'Default pivot for every frame, exported to the atlas as anchor (exported pixels) and pivot (anchor / source size).' },
    frames: { ...array(ref('frame'), 256), minItems: 1 },
    animations: { type: 'object', minProperties: 1, maxProperties: 65526, description: 'ZIP32 bundle budget: animation count + frame count + 8 support files must not exceed 65,535.', propertyNames: id, additionalProperties: object({ frames: { ...array(id, 1024), minItems: 1 }, direction: { enum: ['forward', 'reverse', 'pingpong'] }, loop: bool }, ['frames']) },
    sheet: object({ columns: int(1, 256), padding: int(0, 16), scale: int(1, 16), trim: { type: 'boolean', description: 'Pack each frame by its visible bounds; the atlas reports trimmed rectangles with spriteSourceSize. Ignores columns.' } })
  }, ['version', 'name', 'width', 'height', 'frames']),
  if: { properties: { frames: { minItems: 2 } }, required: ['frames'] },
  then: { properties: { width: { maximum: 256 }, height: { maximum: 256 } } },
  $defs: {
    rows: { ...array({ type: 'string', minLength: 1, maxLength: 256 }, 256), minItems: 1, description: 'Equal-width text rows. Every character is a palette key; dot and space skip a pixel.' },
    frame: object({ name: id, duration: int(1, 60000, 'Frame duration in milliseconds; default 100.'), from: id, translate: { ...array(int(-4096, 4096), 2), minItems: 2 }, wrap: { type: 'boolean', description: 'Translation wraps around the canvas instead of clipping (scrolling tiles).' }, flipX: bool, flipY: bool,
      palette: { type: 'object', maxProperties: 256, additionalProperties: color, description: 'Recolor project palette keys for this frame only (palette cycling). Keys must exist in the project palette.' },
      anchor: point, points: { type: 'object', maxProperties: 64, propertyNames: id, additionalProperties: point, description: 'Named frame positions (hands, hit points, glyph advance), exported in the atlas in exported pixels.' },
      ops: array(ref('op')), layers: array(ref('layer'), 64), pixels: { ...array(ref('pixel'), 65536), description: 'Final canvas-coordinate RGBA replacements after ops and layers. Coordinates must be inside this canvas. Later entries win; transparent erases.' } }, ['name']),
    pixel: object({ x: int(0, 4095), y: int(0, 4095), color }, ['x', 'y', 'color']),
    layer: object({ name: id, visible: bool, opacity: { type: 'number', minimum: 0, maximum: 1 }, ...xy,
      sort: { enum: ['ground'], description: 'ground: draw the operations far to near by the row each stands on (its ground, or the lowest row it draws), list order breaking ties, as a game draws actors and props. Use it for everything standing on the ground: trees, grass, rocks, figures. Area operations (dither, shade, fill, outline, tilemap...) are refused.' },
      palette: { type: 'object', maxProperties: 256, additionalProperties: color, description: 'Recolor project palette keys for this layer\'s drawing only, on top of the frame palette: a flash or cycle on one layer leaves other drawing that shares the key alone. Keys must exist in the project palette; values are colours or project palette names.' },
      ops: array(ref('op')) }),
    op: { oneOf: [
      operation('pixel', { ...xy, ground, color }, ['color']),
      operation('rect', { ...xy, ground, ...wh, color, filled: bool }, ['w', 'h', 'color']),
      operation('ellipse', { ...xy, ground, ...wh, color, filled: bool }, ['w', 'h', 'color']),
      operation('line', { ...xy, ground, x2: int(-4096, 4096), y2: int(-4096, 4096), color }, ['x2', 'y2', 'color']),
      operation('clear', { ...xy, ...wh }, ['w', 'h']),
      operation('fill', { ...xy, color }, ['color']),
      operation('replace', { from: color, to: color }, ['from', 'to']),
      operation('grid', { ...xy, ground, rows: ref('rows'), ...transform, remap }, ['rows']),
      operation('stamp', { ...xy, ground, symbol: id, ...transform, remap }, ['symbol']),
      { ...operation('text', { ...xy, ground, text: { type: 'string', minLength: 1, maxLength: 512, description: 'Printable ASCII, western European accented letters and common symbols; \\n starts a new line (at most 64).' }, color, align: { enum: ['left', 'center', 'right'], description: 'What x is: the left edge of the text (default), its centre or its right edge. Lines align the same way.' }, spacing: int(0, 16, 'Pixels between glyphs; default 1.'), lineHeight: int(1, 64, 'Pixels from the top of one line to the top of the next; default 10.'), ...transform }, ['text', 'color']),
        description: 'Draw text in the built-in pixel font. y is the top of the capitals; a line is 8 rows: capitals 7 tall, lowercase 5, descenders 1 below, and the accent of a capital reaches 2 rows above y. Glyphs are 1 to 5 pixels wide (© ® — Œ œ are 7), digits always 5, a space 3. One line of n average characters is about 6n pixels wide.' },
      { ...operation('copy', { ...xy, ground, from: id, symbol: id, sx: int(0, 255), sy: int(0, 255), w: int(1, 256), h: int(1, 256), ...transform, remap: { type: 'object', maxProperties: 256, propertyNames: { minLength: 1, maxLength: 64 }, additionalProperties: color, description: 'Symbol copies: recolor grid characters (one character each) → palette name or colour. Frame copies: swap exact colours, named by project palette key or hex (#RGB to #RRGGBBAA), for a palette name or colour.' } }), oneOf: [{ required: ['from'] }, { required: ['symbol'] }], description: 'Copy a rectangle of a symbol (palette characters) or an earlier frame (exact RGBA).' },
      { ...operation('autotile', { ...xy, ground, symbol: id, mask: int(0, 255, 'Neighbour mask. Blob: N=1, NE=2, E=4, SE=8, S=16, SW=32, W=64, NW=128, reduced so a diagonal counts only with both of its sides. Cardinal: N=1, E=2, S=4, W=8.'), mode: { enum: ['blob', 'cardinal'], description: 'blob (default) or cardinal.' }, remap }, ['symbol', 'mask']),
        description: 'Draw one autotile tile from a template symbol two tiles wide and three tall: the four quarters the mask selects (see the autotile template format). The autotile compiler emits one per frame, so editing the template redraws every tile.' },
      { ...operation('box', { ...xy, ground, w: { ...int(2, 512), multipleOf: 2, description: 'How far the top face\'s right edge runs across, in pixels (even); it runs half as far down.' }, d: { ...int(2, 512), multipleOf: 2, description: 'How far the top face\'s left edge runs across, in pixels (even).' },
        h: int(0, 512, 'Height of the side faces in pixels; default 0, a flat diamond.'), top: color, left: color, right: color, edge: { ...color, description: 'Marks the top face\'s front edges and the corner between the side faces.' } }, ['w', 'd']), anyOf: [{ required: ['top'] }, { required: ['left'] }, { required: ['right'] }],
        description: 'An isometric box from the top-left of its bounds (w + d wide, (w + d) / 2 + h tall): a 2:1 top face over a left and a right face. Each pixel belongs to the face its centre lies in, so edges step two pixels across per row and boxes on a 2:1 grid meet exactly. A face without a colour is left out.' },
      { ...operation('outline', { color, diagonal: bool, position: { enum: ['outside', 'inside', 'middle'], description: 'outside (default) surrounds the visible pixels; inside recolors their edge pixels; middle splits the width, the odd pixel outside.' }, width: int(1, 8, 'Rings of pixels; default 1.'),
        directions: { ...array({ type: 'string', pattern: '^[x.]{3}$' }, 3), minItems: 3, description: '3×3 grid centred on a visible pixel, with a dot in the centre: x marks the sides that get the line, e.g. ["...", "...", "..x"] for a drop shadow or [".x.", "...", "..."] for a top rim. Replaces diagonal.' } }, ['color']), description: 'Outline every visible pixel in this buffer (frame or layer): outside rings, inside edge rings or both, in chosen directions.' },
      { ...operation('dither', { ...xy, ...wh, color, erase: { type: 'boolean', description: 'Clear the pattern pixels instead of drawing a color.' }, ...densityFields }), anyOf: [{ required: ['color'] }, { required: ['erase'] }], description: 'Ordered dither between the current pixels and color: draws (or erases) where a canvas-anchored threshold pattern is below the density (default 0.5). x/y default to 0 and w/h reach the canvas edge.' },
      { ...operation('shade', { ...xy, ...wh, steps: int(-8, 8, 'Steps along each colour\'s ramp: negative darkens (default -1), positive lightens. Clamped at the ramp\'s ends; not 0.'), shape: { enum: ['rect', 'ellipse'], description: 'rect (default) or the ellipse inside the region.' }, ...densityFields }),
        description: 'Move every pixel of the region along its colour\'s ramp (see ramps), so shadows and light keep the palette on any surface. Colours on no ramp stay. density (default 1) and pattern give a dithered edge. x/y default to 0 and w/h reach the canvas edge.' },
      { ...operation('tilemap', { ...xy, tile: { ...pairOf(int(1, 256)), description: 'Cell size [width, height] in pixels.' }, ...tilemapFields,
        legend: legend(['symbol', 'template'], { symbol: 'A symbol drawn at the cell\'s top-left (in an iso map, standing on its diamond); with autotile, {mask} in its name becomes the neighbour mask.', template: 'An autotile template symbol (two tiles wide, three tall) drawn with the cell\'s neighbour mask; needs autotile.' }) }, ['tile', 'rows', 'legend']),
        description: 'Draw a character map from this recipe\'s symbols and autotile templates, with variants, weights and neighbour rules, so later operations see the composed result (dither over its floor, rewrite rules at its corners).' },
      { ...operation('rewrite', { ...xy, ...region, rules: { ...array(object({ match: ruleRows, replace: ruleRows }, ['match', 'replace']), 16), minItems: 1 },
        empty: { type: 'string', minLength: 1, maxLength: 1, description: 'A non-palette character meaning a transparent pixel in match and erasure in replace.' },
        steps: int(1, 64, 'Passes over every rule; stops early when a pass changes nothing.'), chance: num(0, 1, 'Seeded probability that each match is applied.'), limit: int(1, 65536, 'Most replacements per rule per step.'),
        seed: int(0, 2147483647), rotate: { type: 'boolean', description: 'Also match the rules turned 90°, 180° and 270°.' }, mirror: { type: 'boolean', description: 'Also match the rules mirrored horizontally.' } }, ['rules']),
        description: 'Markov-style rewrite rules on this buffer: each small match grid found on exact colors is replaced, in a seeded order, without overlapping rewrites. The region defaults to the whole canvas.' }
    ] }
  }
};
await writeFile(new URL('../schema.json', import.meta.url), JSON.stringify(schema, null, 2) + '\n');

// Sidecar formats evolve independently; compiled sprite recipes remain version 1.
const structuralColor = {
  ramp: int(0, 63, 'Index of a source ramp; structural parts use one-character palette keys.'),
  base: int(0, 31, 'Neutral fill step inside that ramp.'),
  outline: { oneOf: [{ type: 'string', minLength: 1, maxLength: 1 }, { const: 'selective' }, { type: 'null' }],
    description: 'One-pixel outer line: a palette key, selective for the darkest ramp step, or null/omitted for none.' }
};
const structuralPoint = { ...pairOf(int(-64, 64)), description: '[along, across] relative to the part anchor; transformed with the part.' };
const bonePart = object({
  ...structuralColor, length: int(1, 64, 'Start-to-end joint distance in pixels.'),
  width: { ...array(int(1, 16), 3), minItems: 2, description: '[start, end] or [start, middle, end] fill widths.' },
  caps: pairOf({ enum: ['round', 'flat', 'point', 'socket'] }),
  snap: { type: 'boolean', description: 'Snap within 4 degrees of a clean slope (default true); endpoints follow the stepped slope.' }
}, ['length', 'width', 'ramp', 'base']);
const massPart = object({ ...structuralColor, size: { ...pairOf(int(2, 64)), description: 'Unsquashed ellipse diameters [width, height].' } }, ['size', 'ramp', 'base']);
const poses = {
  $schema: schema.$schema, title: 'Pixelbolt authored poses',
  ...object({ format: { const: 'pixelforge-poses' }, version: { const: 1 }, name: id, width: int(1, 256), height: int(1, 256), palette: schema.properties.palette,
    ramps: schema.properties.ramps, light: int(0, 359, 'Clockwise light direction: 0 right, 225 top left (default).'),
    rig: object({ ground: int(0, 255, 'Canvas pixel row touched by planted markers; must be below height.'), body: id, head: id, rest: id,
      legs: array({ ...array(id, 3), minItems: 2 }, 8), arms: array({ ...array(id, 3), minItems: 2 }, 8), tail: array(id, 16) }, ['ground']),
    motions: { type: 'object', maxProperties: 16, propertyNames: id, additionalProperties: { oneOf: [
      ...['walk', 'run'].map(template => object({ template: { const: template }, frames: { ...int(template === 'walk' ? 4 : 6, 64), multipleOf: 2 }, duration: int(1, 60000), speed: num(-1024, 1024), stride: num(1, 64), lift: num(0, 32), bob: num(0, 8), lean: int(-45, 45), swapDepth: { type: 'boolean', description: 'Exchange the draw order of paired limbs in the second half-cycle, for front or back views where the stepping limb comes nearer the camera. Default false: side views keep near limbs in front.' } }, ['template'])),
      object({ template: { const: 'idle' }, frames: int(2, 4), duration: int(1, 60000), breath: num(0, .5) }, ['template']),
      object({ template: { const: 'jump' }, frames: { const: 7 }, duration: int(1, 60000), crouch: num(.5, 1), stretch: num(1, 2), apex: int(1, 32) }, ['template']),
      object({ template: { const: 'attack' }, frames: { const: 4 }, duration: int(1, 60000), arm: int(0, 7), windup: int(-360, 360), strike: int(-360, 360), hold: int(1, 16) }, ['template']),
      object({ template: { const: 'hurt' }, frames: { const: 2 }, duration: int(1, 60000), recoil: int(-90, 90), squash: num(.5, 2) }, ['template'])
    ] } },
    motionInfo: { type: 'object', propertyNames: id, additionalProperties: object({ template: { enum: ['walk', 'run', 'idle', 'jump', 'attack', 'hurt'] }, speed: num(-1024, 1024), keyPoses: { ...array(id, 256), minItems: 1, uniqueItems: true } }, ['template', 'speed', 'keyPoses']),
      description: 'Expansion annotations: generated animation speed and key poses. Retain these when editing --expand output; do not combine with motions.' },
    parts: { type: 'object', maxProperties: 256, propertyNames: id, additionalProperties: { oneOf: [
      object({ rows: ref('rows'), anchor: point, points: { type: 'object', propertyNames: id, additionalProperties: point },
        views: { type: 'object', minProperties: 1, maxProperties: 16, propertyNames: { pattern: '^(0|[1-9][0-9]?|[12][0-9]{2}|3[0-5][0-9])$' },
          additionalProperties: object({ rows: ref('rows'), anchor: point, points: { type: 'object', propertyNames: id, additionalProperties: point } }, ['rows', 'anchor']),
          description: 'Authored grid drawings by world angle (0–359). Each supplies its anchor and every named point of the base part. Use the nearest drawing within 22.5 degrees; otherwise rotate the base grid.' }
      }, ['rows']),
      object({ bone: bonePart, points: { type: 'object', propertyNames: id, additionalProperties: { oneOf: [structuralPoint, { const: 'end' }] } } }, ['bone']),
      object({ mass: massPart, points: { type: 'object', propertyNames: id, additionalProperties: structuralPoint } }, ['mass'])
    ] } },
    poses: { ...array({ ...object({ name: id, duration: int(1, 60000), origin: point,
      mirror: { ...id, description: 'Reflect an earlier pose (parts, points and markers) around its origin corner: pixel column c becomes 2 × originX − 1 − c, as drawFrame\'s flipX does. Omit parts, markers and origin.' },
      relight: { type: 'boolean', description: 'Mirror poses only: redraw structural parts with the source light unchanged; false/omitted preserves exact runtime-flipped pixels.' },
      tween: { ...object({ from: id, to: id, t: num(0, 1, 'Position between the two poses.'), ease }, ['from', 'to', 't']), description: 'An in-between of two earlier authored or tweened poses with the same part instances: origin, offsets and angles interpolate and round; part definitions and flips switch at the eased halfway point. Omit parts and origin; markers are not inherited.' },
      parts: array(object({ name: id, part: id, at: point, attach: object({ part: id, point: id }, ['part', 'point']), flipX: { type: 'boolean', description: 'Mirror this part, its anchor and its points inside the part.' },
        rotate: int(-360, 360, 'Whole degrees clockwise around the part anchor pixel, after any flip. The rotated grid is baked into an editable symbol named <part>-r<degrees> (-fr when flipped); points turn with it; right angles are exact.'),
        angle: int(-360, 360, 'Clockwise degrees relative to the parent world angle, or world degrees at a root. Mutually exclusive with rotate. Relative-angle tweens take the shorter arc.'),
        reach: { ...point, description: 'Canvas target [x, y] for the last bone of a two-bone chain. Replaces angle/rotate; attach to a named end point with zero at offset. Both bones are solved at whole degrees.' },
        bend: { enum: ['forward', 'back'], description: 'Reach only: preferred clockwise (forward, default) or anticlockwise bend. Equal-error solutions prefer this bend, then rest-angle proximity and lower angles.' },
        // No multipleOf: 0.05 has no exact binary form, so validators would reject 0.95 or 1.15 that the compiler accepts.
        squash: num(.5, 2, 'Mass parts only, in steps of 0.05. Height scales by squash and width by its inverse; contour adjustments keep opaque pixel area stable.'),
        cleanup: { type: 'boolean', description: 'Remove doubled corners the rotation leaves (default true; false names the symbol with -raw).' } }, ['name', 'part']), 64),
      markers: array(object({ name: id, part: id, point: id }, ['name', 'part', 'point']), 64),
      contacts: { ...array(id, 64), uniqueItems: true, description: 'Markers planted on the ground in this pose. Mirrors inherit contacts; tweens must declare their own.' }
    }, ['name']), anyOf: [{ required: ['parts'] }, { required: ['mirror'] }, { required: ['tween'] }] }, 256), minItems: 1 }, animations: schema.properties.animations, sheet: schema.properties.sheet
  }, ['format', 'version', 'name', 'width', 'height', 'parts', 'poses']), $defs: { rows: schema.$defs.rows }
};
const recipeSchema = { ...schema }; delete recipeSchema.$schema; delete recipeSchema.$defs; delete recipeSchema.title;
// Scene assets keep to the animation canvas: a still larger than 256 pixels a side renders on its own.
const assetSide = int(1, 256, 'A scene asset is at most 256 pixels a side.');
const sceneRecipe = { ...recipeSchema, properties: { ...recipeSchema.properties, width: assetSide, height: assetSide } }; delete sceneRecipe.if; delete sceneRecipe.then;
const themePalette = description => ({ oneOf: [{ type: 'string', description: 'Palette file, resolved by the CLI relative to the scene or inside the MCP root.' }, { type: 'object', additionalProperties: { type: 'string', pattern: hex } }], description });
const cueTime = (maximum, description) => ({ oneOf: [int(0, maximum), { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_-]{0,63}([+-][0-9]{1,5})?$' }], description });
const assetRef = { oneOf: [ref('recipe'), { type: 'string', description: 'Recipe file, resolved by the CLI relative to the scene or inside the MCP root.' }, object({ revision: { type: 'string', pattern: '^[a-f0-9]{12}$' } }, ['revision'])] };
const scene = {
  $schema: schema.$schema, title: 'Pixelbolt scene review',
  ...object({ format: { const: 'pixelforge-scene' }, version: { const: 1 }, name: id, width: int(1, 256), height: int(1, 256), background: color, duration: int(1, 60000),
    palette: themePalette('A theme for every asset: colours for palette keys the recipes share (keys a recipe lacks are ignored), or a palette file resolved by the CLI and MCP.'),
    cues: { type: 'object', maxProperties: 64, propertyNames: id, additionalProperties: int(0, 60000), description: 'Named times in milliseconds; sequence and trajectory times may say "name", "name+90" or "name-20".' },
    assets: { type: 'object', maxProperties: 64, additionalProperties: { oneOf: [assetRef, object({ recipe: assetRef, normal: assetRef, emissive: assetRef, palette: themePalette('A theme for this asset, applied after the scene palette.') }, ['recipe'])] } },
    instances: array(object({ name: { type: 'string' }, asset: { type: 'string' }, at: point,
      anchor: { oneOf: [point, { const: 'frame' }], description: '[x, y] in asset pixels placed at `at` (default [0, 0]), or "frame" to place every drawn frame by its own atlas anchor, so animated placements follow per-frame anchors. Tilemaps take [x, y] only.' }, scale: int(1, 16), frame: id, animation: id,
      hidden: { type: 'boolean', description: 'Start hidden; a later frame or animation cue shows the placement.' },
      repeat: { ...array(int(1, 32), 2), minItems: 2 }, step: point,
      trajectory: { ...array(object({ time: cueTime(60000, 'Milliseconds or a named cue.'), at: point, ease: { ...ease, description: `Shape of the segment starting at this key: ${ease.description} Positions round to whole pixels.` } }, ['time', 'at']), 256), minItems: 2 },
      sequence: array(object({ time: cueTime(59999, 'Milliseconds or a named cue.'), frame: id, animation: id, hide: { const: true, description: 'Hide the placement from this time until a later frame or animation cue.' } }, ['time']), 64),
      attach: { ...object({ instance: { type: 'string', description: 'Name of another uniquely named placement that is neither a tilemap nor attached itself.' }, point: { ...id, description: 'A named point of its current frame; not drawn while that frame has no such point. Without one, follow where it stands, which stays on the ground while it is lifted (a contact shadow).' } }, ['instance']), description: 'Follow another placement; at becomes the offset from the point followed. Attached to a frame point, it stands on the other placement\'s ground line below the point and is lifted up to it, so a sorted held item sorts with its holder (list order decides which is in front).' },
      sort: { const: 'ground', description: 'Draw among the other sorted placements by ground line (the y of the placement point), where the first of them is listed. A sorted tilemap joins cell by cell, each standing on the bottom row of its frame, so walls and trees taller than their tile cover what stands behind them.' },
      lift: { oneOf: [int(0, 256), { ...array(object({ time: cueTime(60000, 'Milliseconds or a named cue such as "jump+150".'), height: int(0, 256), ease: { ...ease, description: `Shape of the change from this key to the next: ${ease.description}` } }, ['time', 'height']), 64), minItems: 1 }],
        description: 'Draw this many pixels above where the placement stands, which still orders it: a jump or a flight keeps its ground line. A height, or keys of height over time, held before the first and after the last. Not on tilemaps.' },
      shade: int(-8, 8, 'Draw no colours: wherever the frame is opaque, move the pixels beneath this many steps along the asset recipe\'s ramps (negative darkens). Not 0.'),
      tilemap: object({ tile: point, ...tilemapFields, legend: legend(['frame', 'animation'], { frame: 'Frame name; with autotile, {mask} becomes the neighbour mask.', animation: 'Animation name; with autotile, {mask} becomes the neighbour mask.' }) }, ['rows', 'legend']),
      lit: { type: 'boolean', description: 'false keeps this placement\'s authored colours under scene lighting: fires, lamps, glows and other light sources. Default true.' },
      parallax: { oneOf: [num(0, 4), { ...array(num(0, 4), 2), minItems: 2 }], description: 'How much of scene.camera\'s movement this placement or tilemap follows, as a number or [x, y]: 1 the scene (default), 0.5 a far plane, 0 fixed on screen (a sky), above 1 a plane nearer than the scene. Each plane rounds its share to whole pixels. Not on attached placements, which move with their target.' },
      haze: num(0, 1, 'How far into scene.haze this placement or tilemap stands: each of its colours moves this much of the way to the haze colour, after lighting (0 none, 1 the haze colour).'),
      shadow: { type: 'boolean', description: 'Cast a shadow from each scene light that reaches this placement (or each tile of this tilemap): its frame, a cutout standing on its ground line and facing the light, stops that light on what is drawn before it (before its sorted group, when sorted). Needs lighting.lights; not on shade placements.' }
    }, ['asset', 'at']), 256),
    camera: { oneOf: [point, { ...array(object({ time: cueTime(60000, 'Milliseconds or a named cue.'), at: point, ease: { ...ease, description: `Shape of the move from this key to the next: ${ease.description}` } }, ['time', 'at']), 256), minItems: 1 }],
      description: 'The scene point at the view\'s top-left corner: [x, y], or keys over time held before the first and after the last. Placements move by their parallax share of it; at [0, 0] everything is where it is written.' },
    haze: { ...object({ color: { type: 'string', pattern: opaqueHex, description: 'The colour far planes fade toward, usually the sky\'s.' }, colors: { ...array({ type: 'string', pattern: opaqueHex }, 64), minItems: 1, description: 'The only colours hazed placements may end on, with color: each faded colour becomes the nearest. List a fixed game palette, or a short ramp toward the haze for silhouettes. Without it, every colour fades exactly.' } }, ['color']),
      description: 'Atmospheric haze for placements with haze: each colour fades as a whole, never per pixel, so each becomes one colour and keeps its place among the others.' },
    lighting: object({ ambient: { type: 'number', minimum: 0, maximum: 1 }, bands: int(2, 16), scope: { enum: ['passes', 'all'], description: 'passes (default) lights only assets with normal/emissive passes; all also lights plain assets as flat surfaces.' },
      mode: { enum: ['multiply', 'ramp'], description: 'multiply (default) scales colours by the light; ramp moves each colour along its recipe\'s ramps instead, so the lit scene keeps its palette (light colour then only sets brightness).' },
      steps: int(1, 8, 'Ramp lighting: steps per unit of brightness away from 1; default 2.'),
      lights: array({ ...object({ at: { ...point, description: 'Where the light is, the point on the ground under it for shadows; with follow, an offset from what it follows (default [0, 0]). Not on a sun.' }, height: int(1, 256, 'Pixels above the scene; default 24. Not on a sun.'), radius: int(1, 512, 'How far it reaches; default 96. Not on a sun.'), color,
        sun: { ...array(num(-8, 8), 2), minItems: 2, description: 'Makes this light a sun: so far away it falls the same way everywhere, with no position, height or reach. [x, y] is how far a shadow falls across the ground per pixel of height: [1, 0.5] is a low sun up and to the left, whose shadows fall right and down; [0, 0] is overhead. Takes color, strength, flicker and strength keys.' },
        strength: num(0, 8, 'Brightness multiplier; default 1. Above 1, ramp lighting can lift colours past their authored shade (a flash); multiply lighting never brightens past the authored colour. 0 is off.'),
        follow: { ...object({ instance: { type: 'string', description: 'Name of a uniquely named placement that is not a tilemap.' }, point: { ...id, description: 'A named frame point of that placement (a torch flame, a blade tip); default: the placement point itself.' } }, ['instance']), description: 'Ride a placement as it moves, animates and attaches. The light is off while the placement is hidden or its current frame has no such point.' },
        flicker: { ...object({ amount: num(0, 1, 'How far it swings either way: 0.3 makes the strength vary from 70% to 130% of its own and the reach by up to 15% either way, so on average it is as bright as a steady light.'), every: int(10, 10000, 'About how often the flicker changes, in milliseconds; default 80.'), seed: int(0, 2147483647, 'Reorders the flicker; default 0. Each light flickers on its own even with the same seed.') }, ['amount']), description: 'Seeded, deterministic flicker that repeats once per scene duration, so a looping scene has no seam.' },
        keys: { ...array(object({ time: cueTime(60000, 'Milliseconds or a named cue such as "strike+70".'), strength: num(0, 8, 'Default: the light\'s strength.'), radius: int(1, 512, 'Default: the light\'s radius.'), ease: { ...ease, description: `Shape of the change from this key to the next: ${ease.description}` } }, ['time']), 64), minItems: 1,
          description: 'Strength and radius over time, held before the first key and after the last: a flash on a hit, a lamp that lights later. Times increase strictly.' }
      }), anyOf: [{ required: ['at'] }, { required: ['follow'] }, { required: ['sun'] }] }, 8) })
  }, ['format', 'version', 'name', 'width', 'height', 'assets', 'instances']), $defs: { ...schema.$defs, recipe: sceneRecipe }
};
const autotile = {
  $schema: schema.$schema, title: 'Pixelbolt autotile template',
  description: 'A template two tiles wide and three tall: row 0 holds an unused preview tile and an inner-corner tile; rows 1–2 hold a 2×2-tile island whose quadrants give outer corners, edges and fill. Compiles to a recipe whose frames copy four quarters each.',
  ...object({ format: { const: 'pixelforge-autotile' }, version: { const: 1 }, name: id, tile: int(2, 128, 'Even tile size in pixels.'), mode: { enum: ['blob', 'cardinal'] }, palette: schema.properties.palette,
    template: { ...ref('rows'), description: 'tile × 3 rows of tile × 2 characters.' },
    frame: { type: 'string', pattern: '\\{mask\\}', description: 'Frame name template; {mask} is the neighbour mask and {variant} the variant name.' },
    variants: { ...array(object({ name: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,16}$' }, duration: int(1, 60000), palette: { type: 'object', additionalProperties: color }, template: { ...ref('rows'), description: 'Redraw this variant from its own template of the same size (compiled as the symbol template-<name>): cracked or mossy stone with the base set\'s edges.' } }, ['name']), 16), minItems: 1 },
    animation: { type: 'string', pattern: '\\{mask\\}', description: 'Optional per-mask animation over the variants, in order.' },
    sheet: schema.properties.sheet
  }, ['format', 'version', 'name', 'tile', 'template', 'frame']), $defs: { rows: schema.$defs.rows }
};
const range = (minimum, maximum, description) => ({ oneOf: [num(minimum, maximum), pairOf(num(minimum, maximum))], description: `${description} [min, max] picks per particle.` });
const vector = (minimum, maximum, description) => ({ ...pairOf(num(minimum, maximum)), ...(description && { description }) });
const evenly = { type: 'boolean', description: 'Space the particles spawned together evenly instead of at random.' };
const emitter = { ...object({
  name: id, at: vector(-4096, 4096, 'Spawn centre [x, y] in canvas pixels. For a child (from), an offset from the parent particle; default [0, 0].'),
  area: { ...pairOf(int(1, 256)), description: 'Spawn box [w, h] centred on at; default [1, 1]. Use one of area, ring and line.' },
  ring: { ...object({ radius: range(0, 256, 'Distance from at.'), arc: { ...pairOf(num(-3600, 3600)), description: '[from, to] degrees clockwise (0 right, 90 down) to spawn over, at most 360 apart; default [0, 360].' }, even: evenly,
    outward: { type: 'boolean', description: 'Measure angle from each particle\'s outward direction: 0 straight out (the default angle), 90 clockwise along the ring, 180 inward. Shockwaves and radial bursts.' } }, ['radius']),
    description: 'Spawn on a circle or arc around at instead of in a box.' },
  line: { ...object({ to: vector(-4096, 4096, 'The other end of the segment (for a child, an offset from the parent particle).'), even: evenly }, ['to']), description: 'Spawn along the segment from at to to instead of in a box.' },
  burst: int(1, 1024, 'Particles spawned at start (each cycle when looping); for a child, particles per event.'), rate: num(0.001, 64, 'Particles per frame from start until end; for a child with when: life, per frame for each parent particle.'),
  start: int(0, 255, 'Frame of the burst or first spawn; default 0.'), end: int(1, 256, 'Frame where a rate emitter stops; default the last.'),
  life: { oneOf: [int(1, 256), pairOf(int(1, 256))], description: 'Frames a particle lives; [min, max] picks per particle. Required to loop or dissolve; otherwise particles live to the end.' },
  angle: range(-3600, 3600, 'Launch direction in degrees, clockwise: 0 right, 90 down, 270 up. Default [0, 360].'), speed: range(0, 64, 'Launch speed in pixels per frame; default 0.'),
  gravity: vector(-8, 8, 'Acceleration [x, y] added each frame.'), drag: num(0, 1, 'Share of velocity lost each frame.'),
  attract: { ...object({ at: vector(-4096, 4096), strength: num(-8, 8, 'Acceleration toward at (negative repels); default 0.5.') }, ['at']), description: 'Pull every particle toward a point.' },
  sway: { ...object({ amplitude: vector(0, 32, 'Drawn offset [x, y]: x follows a sine and y a cosine, from a random phase.'), period: num(1, 256, 'Frames per cycle; default 8.') }, ['amplitude']), description: 'Wobble, added when drawing (drifting leaves, rising embers).' },
  floor: int(-4096, 4096, 'Particles never go below this y, sway included.'), bounce: num(0, 1, 'Share of downward speed returned at the floor; default 0 (they settle).'),
  shapes: { oneOf: [{ ...array(id, 64), minItems: 1 }, { ...array({ ...array(id, 64), minItems: 1 }, 64), minItems: 1 }], description: 'Symbol names drawn centred on the particle: one sequence, or a list of sequences with one picked per particle (or by direction, with face).' },
  face: { type: 'boolean', description: 'Pick the sequence by direction of travel instead of at random: shapes lists 2–16 sequences, the first facing right and the rest turning clockwise, evenly spaced (with 8: right, down-right, down, down-left, left, up-left, up, up-right). Streaking sparks and debris; a particle at rest keeps its last direction.' },
  play: { enum: ['life', 'loop', 'once'], description: 'life spreads the sequence over the lifetime (default); loop steps one symbol per frame from a random start; once steps and holds the last.' },
  remaps: { ...array(remap, 64), description: 'Colour variants; each particle picks one.' },
  tint: { ...array(remap, 64), minItems: 1, description: 'Colour stages over each life, the first at birth, spread like play: life. Each overrides the particle\'s remap for the characters it names, so a spark cools from white to red without a symbol per colour.' },
  trail: { ...object({ color, length: int(1, 16, 'Frames back the streak reaches; default 2.') }, ['color']), description: 'A one-pixel streak from an earlier position, drawn under the particle.' },
  dissolve: num(0, 1, 'Share of the life, at its end, during which the particle thins out through an ordered-dither pattern.'),
  pattern: { oneOf: [{ enum: DITHER_PATTERNS }, { ...array({ ...array(int(0, 255), 16), minItems: 1 }, 16), minItems: 1 }], description: 'Dissolve pattern, as for the dither operation: bayer2, bayer4 (default), bayer8, noise (ordered by the effect\'s seed) or a matrix of ranks, e.g. [[0, 1, 2], [1, 2, 0], [2, 0, 1]] for diagonal stripes.' },
  from: { ...id, description: 'Make this a child of the earlier emitter with this (unique) name: it spawns from that emitter\'s particles at when, instead of on a schedule of its own (no start or end).' },
  when: { enum: FX_EVENTS, description: 'For a child: death (default; burst particles where a parent particle ends), floor (burst where it first lands on its floor) or life (rate particles per frame from each parent while it lives: trails).' },
  inherit: num(0, 2, 'For a child: the share of its parent particle\'s velocity it starts with, added to its own launch; default 0.'),
  behind: { type: 'boolean', description: 'Draw this emitter\'s particles under every other emitter\'s (smoke behind sparks, a trail behind its bolt).' },
  cue: { ...id, description: 'Name a point at the spawn centre in each frame this emitter spawns. Frames carry it as a named point, which atlases export for game code (a shake or a pause on impact); the metadata lists every cue.' },
  blob: { ...object({ look: { ...id, description: 'The look it is drawn into; may be left out when the effect has one look.' },
    radius: { oneOf: [num(0, 64), { ...array(num(0, 64), 8), minItems: 2 }], description: 'Pixels: a number, or 2–8 keys spread over each particle\'s life (shrinking drops). Default 3.' } }),
    description: 'Draw each particle as a soft disc, (1 − d²/r²)², added to a look\'s field instead of stamping a symbol: touching drops merge into one body of water that stretches, pinches and splits, banded, lit and outlined by the look. Replaces shapes, face, play, remaps, tint, trail, dissolve, pattern and behind.' }
}), allOf: [{ anyOf: [{ required: ['at'] }, { required: ['from'] }] }, { oneOf: [{ required: ['shapes'] }, { required: ['blob'] }] }] };
// Shape layers: each writes an intensity field inside its frame window; a look cuts the layers that name it into bands.
const tween = (minimum, maximum, description) => ({ oneOf: [num(minimum, maximum), { ...array(num(minimum, maximum), 8), minItems: 2 }], description: `${description} A number, or 2–8 keys spread evenly over the layer's frames through its ease.` });
const shading = object({ colors: { ...array({ type: 'string', minLength: 1, maxLength: 1 }, 8), minItems: 1, description: 'Palette keys, one per band.' }, thresholds: { ...array(num(0.001, 1), 8), minItems: 1, description: 'One rising share per colour, where its band begins.' } }, ['colors', 'thresholds']);
const shapeLook = object({
  colors: { ...array({ type: 'string', minLength: 1, maxLength: 1 }, 8), minItems: 1, description: 'Palette keys from the faintest band to the brightest.' },
  thresholds: { ...array(num(0.001, 16), 8), minItems: 1, description: 'One rising threshold per colour: a colour is on where the combined field reaches its threshold.' },
  dither: num(0, 1, 'Feather each band in below its threshold through the pattern, over this share of the gap to the band below; default 0 (hard bands).'),
  pattern: { oneOf: [{ enum: DITHER_PATTERNS }, { ...array({ ...array(int(0, 255), 16), minItems: 1 }, 16), minItems: 1 }], description: 'Dither pattern, as for the dither operation; default bayer4. Needs dither.' },
  outline: { type: 'string', minLength: 1, maxLength: 1, description: 'Palette key for a one-pixel outline on the empty pixels beside this look\'s own.' },
  light: vector(-1, 1, 'Direction toward the light for lit and shade, such as [-1, -1] (the default) for the upper left.'),
  lit: { ...shading, description: 'Highlight bands: recolour this look\'s pixels by the share (0–1) by which its field falls two pixels toward the light, 1 on a rim that faces it and 0 inside. Cel water, ice, slime.' },
  shade: { ...shading, description: 'Shadow bands, as lit but measured away from the light; lit wins where both apply.' }
}, ['colors', 'thresholds']);
const layerCommon = {
  look: { ...id, description: 'The look that colours this layer; may be left out when the effect has one look.' },
  at: vector(-4096, 4096, 'Centre [x, y] (a beam or bolt starts here).'),
  frames: { ...pairOf(int(0, 256)), description: '[first, end]: the first frame drawn and the frame after the last; default the whole effect. Progress runs from 0 at first toward 1.' },
  ease: { ...ease, description: 'How tweened values move across the window: out (default), linear, in, inOut, hold, overshoot or bounce.' },
  power: tween(0, 8, 'Multiplies the field: bright bands shrink as it falls, so the shape erodes instead of fading; default 1.'),
  flicker: num(0, 1, 'Every other frame of the window, power drops by this share.'),
  blend: { enum: ['max', 'add'], description: 'max (default): the brighter layer of a look wins; add: layers sum.' },
  drift: vector(-4096, 4096, 'Move by [x, y] pixels over the window (smoke rising).'), floor: num(-4096, 4096, 'Cut the layer off below this canvas row: a disc becomes a dome, a ring an arch.'), seed: int(0, 2147483647, 'Seeded detail (noise, runes, bolt paths); default the layer index.'),
  cue: { ...id, description: 'Name a point at at in the layer\'s first frame, as an emitter cue does (a shake on impact).' }
};
// The fields every kind shares are defined once, under $defs, and referenced from each kind.
// Tilt and squash, on the kinds drawn around a centre (not bolts and streams, which run between points).
const layerPlaced = {
  tilt: num(-3600, 3600, 'Rotate the shape clockwise by degrees.'), squash: { ...pairOf(num(0.125, 8)), description: 'Scale [x, y] before tilt; [1, 0.4] lays a ring or circle on the ground. On a beam it shapes the round ends alone: give a pillar the squash of its circle so its foot lies on the same ground.' }
};
const layerRefs = Object.fromEntries(Object.keys(layerCommon).map(key => [key, ref(`layer-${key}`)]));
const placedRefs = Object.fromEntries(Object.keys(layerPlaced).map(key => [key, ref(`layer-${key}`)]));
const shapeLayer = (kind, description, properties, required = []) => ({ ...object({ kind: { const: kind }, ...layerRefs, ...(!['bolt', 'stream'].includes(kind) && placedRefs), ...properties }, ['kind', 'at', ...required]), description });
const reveal = share => num(0, 0.95, `Share of the window the shape takes to draw on; default ${share}.`);
// Noise on the kinds without their own: smooth seeded noise in screen space that a falling power breaks the shape up through.
const grain = { noise: num(0, 1, 'Seeded smooth noise: a pixel keeps value × power × (1 − noise × n), so as power falls toward the look\'s first threshold the shape breaks into pieces and drops. Default 0.'), scale: int(1, 64, 'Noise feature size in pixels; default 4.') };
const layer = { oneOf: [
  shapeLayer('ring', 'A shockwave: a crisp leading edge at radius, fading inward over width.', { radius: tween(0, 512, 'Pixels to the leading edge.'), width: tween(0, 256, 'Band thickness behind the edge; default 3. Ending at 2 or more, with noise, breaks a fading ring up instead of thinning it to an outline.'), fill: tween(0, 2, 'Glow inside the band, as a share; default 0.'), noise: num(0, 1, 'Seeded breaks along the ring; default 0.'), scale: int(1, 64, 'Noise feature size in pixels; default 6.') }, ['radius']),
  shapeLayer('slash', 'A crescent: a crisp outer arc at radius, thickest mid-arc and pointed at both ends; the head sweeps arc during reveal and the tail chases it.', { radius: tween(1, 512, 'Pixels to the outer edge.'), width: tween(0, 256, 'Thickest point, inward from the edge; default 6.'), arc: { ...pairOf(num(-3600, 3600)), description: '[from, to] degrees clockwise (0 right, 90 down), at most 360 apart; the slash sweeps from the first to the second.' }, reveal: reveal(0.35), ...grain }, ['radius', 'arc']),
  shapeLayer('beam', 'A straight beam from at to to, brightest on its axis, with travelling ripples.', { to: vector(-4096, 4096, 'The far end.'), width: tween(0, 256, 'Pixels across; default 5.'), reveal: reveal(0.15), wobble: num(0, 1, 'Share by which the width ripples; default 0.15.'), wavelength: num(2, 512, 'Pixels between ripples; default 12.'), waves: num(-64, 64, 'Ripples that pass over the window; negative runs back toward at. Default 3.'), fade: num(0, 1, 'Share by which it dims toward to (a pillar of light); default 0.'), ...grain }, ['to']),
  shapeLayer('bolt', 'Lightning from at to to: a jagged one-pixel core with a glow and seeded branches, re-rolled every reroll frames.', { to: vector(-4096, 4096, 'Where it strikes.'), width: tween(1, 9, 'Core thickness in pixels; default 1.'), glow: tween(0, 4, 'Glow in pixels around the core; default 1.'), jag: num(0, 1, 'How far the path strays; default 0.35.'), branches: int(0, 8, 'Default 2.'), reroll: int(0, 256, 'Frames per new path; 0 keeps one. Default 2.'), segment: num(2, 64, 'Pixels per straight piece; default 4.'), reveal: reveal(0), ...grain }, ['to']),
  shapeLayer('glyph', 'A magic circle in one-pixel ink: an outer ring (doubled on request), an inner ring, upright seeded runes between them and an optional star polygon; it draws on clockwise from the top.', { radius: tween(2, 512, 'Outer ring radius.'), inner: num(0.2, 0.95, 'Inner ring as a share of radius; default 0.72.'), points: int(0, 12, 'Star corners on the inner ring: 0 for none (default 5).'), step: int(1, 6, 'Corners each star line skips to, fewer than points: 1 a polygon, 2 a pentagram from 5. Default the largest below half the corners: 1 for 3 or 4, 2 for 5 or 6, 3 for 7 or 8.'), runes: int(0, 48, 'Default 12.'), double: { type: 'boolean', description: 'A second outer ring two pixels inside the first.' }, spin: tween(-3600, 3600, 'Degrees the runes travel round (the star turns the other way); default 0.'), reveal: reveal(0.3), glow: tween(0, 4, 'Glow in pixels around the ink; default 1.'), fill: tween(0, 2, 'Glow inside the outer ring; default 0.'), ...grain }, ['radius']),
  shapeLayer('star', 'An impact star: points spikes, every other one ratio as long, tapering to one-pixel tips around a bright core.', { radius: tween(0, 512, 'Length of the long spikes.'), points: int(2, 16, 'Default 8.'), ratio: num(0.05, 1, 'Length of the short spikes; default 0.55.'), width: tween(0, 64, 'Half-width at the base; default 2.5.'), core: tween(0, 128, 'Core radius; default 1.2 × width.'), angle: num(-3600, 3600, 'Direction of the first spike; default 0 (right).'), spin: tween(-3600, 3600, 'Degrees turned over the window; default 0.'), jitter: num(0, 1, 'Seeded variation in spike length; default 0.'), ...grain }, ['radius']),
  shapeLayer('burst', 'A fireball or puff: a disc broken by seeded smooth noise that boils outward, hottest in the middle, with an optional hole opening from the centre.', { radius: tween(0, 512, 'Pixels.'), hole: tween(0, 1, 'Burnt-out centre as a share of radius; default 0.'), noise: num(0, 1, 'Default 0.4.'), scale: int(1, 64, 'Noise feature size in pixels; default 4.'), boil: num(-512, 512, 'Pixels the noise moves outward over the window; default half the largest radius.') }, ['radius']),
  shapeLayer('stream', 'A tapered body of water (or anything that flows) along a smooth curve from at through 1–7 more points, brightest on its centre line: the part between tail and head is drawn, narrowing by taper, swaying in travelling waves. Geyser spikes, whips, spirals, wave curls.', {
    through: { ...array(vector(-4096, 4096), 7), minItems: 1, description: 'More [x, y] points; the curve passes through at and each of them.' },
    width: tween(0, 256, 'Pixels across at the widest; default 6.'), taper: { ...array(num(0, 2), 8), minItems: 2, description: 'Width shares spread along the drawn part, from tail to head; default [0, 1, 0], pointed at both ends.' },
    head: tween(0, 1, 'Share of the curve the front has reached; default 1. Counts to the end of each frame, as reveals do.'), tail: tween(0, 1, 'Share of the curve the back has left behind; default 0.'),
    sway: num(-64, 64, 'Pixels it swings sideways at the far end, less toward at; default 0.'), wavelength: num(2, 512, 'Pixels between sway waves; default 16.'), waves: num(-64, 64, 'Sway waves that pass over the window; default 1.'), ...grain }, ['through'])
] };
const fx = {
  $schema: schema.$schema, title: 'Pixelbolt particle effects',
  description: 'Seeded particle emitters and shape layers (shockwave rings, slashes, beams, lightning, magic circles, impact stars, fireballs, streams of water) compiled into an ordinary recipe: one frame sequence and animation per effect (frames <effect>-0, <effect>-1…). Shapes draw as one grid per frame between behind particles and the rest; particles draw with stamp, grid and line operations on these symbols. Deterministic for a given seed.',
  ...object({ format: { const: 'pixelforge-fx' }, version: { const: 1 }, name: id, width: int(1, 256), height: int(1, 256), palette: schema.properties.palette,
    symbols: { type: 'object', minProperties: 1, propertyNames: id, additionalProperties: ref('rows'), description: 'Particle drawings; may be left out when no effect has emitters.' }, anchor: schema.properties.anchor,
    effects: { type: 'object', minProperties: 1, maxProperties: 64, propertyNames: id, additionalProperties: { ...object({ frames: int(1, 256), duration: { oneOf: [int(1, 60000), array(int(1, 60000), 256),
      object({ from: int(1, 60000, 'Milliseconds of the first frame.'), to: int(1, 60000, 'Milliseconds of the last frame.'), ease: { ...ease, description: 'How durations move from from to to: linear (default), in (quick frames, then a slow settle: impacts), out, inOut, hold, overshoot or bounce.' } }, ['from', 'to'])],
      description: 'Milliseconds per frame, one per frame, or {from, to, ease} eased across the frames; default 100.' },
      loop: { type: 'boolean', description: 'Seamless loop: the simulation warms up so particles in flight at frame 0 are those alive at the end. Needs a finite life.' }, seed: int(0, 2147483647, 'Default 1.'), emitters: { ...array(emitter, 16), minItems: 1, description: 'Particle emitters; may be left out when the effect has layers. Blob emitters draw into the looks.' },
      looks: { type: 'object', minProperties: 1, maxProperties: 8, propertyNames: id, additionalProperties: ref('shape-look'), description: 'Named colour ramps for the layers and blob particles, drawn in this order (later over earlier).' },
      layers: { ...array(layer, 16), minItems: 1, description: `Shape layers: ${SHAPE_KINDS.join(', ')}. Needs looks.` },
      cleanup: { ...object({ corners: bool, strays: bool }), description: 'Remove doubled corners and stray pixels from the shapes (not the particles).' } }, ['frames']), anyOf: [{ required: ['emitters'] }, { required: ['layers', 'looks'] }] } },
    sheet: schema.properties.sheet
  }, ['format', 'version', 'name', 'width', 'height', 'effects']), $defs: { rows: schema.$defs.rows, 'shape-look': shapeLook, ...Object.fromEntries(Object.entries({ ...layerCommon, ...layerPlaced }).map(([key, value]) => [`layer-${key}`, value])) }
};
const key = { type: 'string', minLength: 1, maxLength: 1, description: 'A one-character palette key (grid rows name colours by character).' };
const keys = description => ({ ...array(key, 16), minItems: 1, description });
const cycle = (extra, lowest, description, required = []) => ({ ...object({ ...extra, period: int(lowest, 256, `Frames per cycle; default the effect's frame count. A looping effect's period must divide its frame count.${lowest < 0 ? ' Negative turns anticlockwise; not 0.' : ''}`), phase: num(-3600, 3600, 'Degrees into the cycle at frame 0.') }, required), description });
const fluidEmitter = object({
  name: id, at: vector(-256, 512, 'Centre [x, y] in canvas pixels (one grid cell per pixel).'),
  radius: num(0.5, 64, 'A disc of this radius; default 2.'), area: { ...pairOf(num(1, 128)), description: 'A box [w, h] centred on at, instead of a disc.' },
  burst: num(0.01, 64, 'Add the amounts once, at start (each cycle when looping), times this strength.'),
  rate: num(0.01, 64, 'Every frame from start until end, raise the covered cells toward the amounts times this strength, so a steady source holds its level.'),
  start: int(0, 255, 'Frame of the burst or first emission; default 0.'), end: int(1, 256, 'Frame where a rate emitter stops; default the last. A short window (end: 3) gives a burst that keeps growing for a few frames.'),
  density: num(-16, 16, 'Gas: smoke added or held (default 0); negative drains. Liquid: share of each covered cell filled with water, 0–1 (default 1); negative drains that share of the particles there each frame.'),
  temperature: num(-16, 16, 'Gas only: heat added or held; heat rises by buoyancy and maps to fire ramps. Default 0.'),
  falloff: num(0, 1, 'The amounts fall off from the centre toward the rim: 1 at the centre, 1 - falloff at the edge of the disc (or the ellipse inside the box), so a puff is densest in the middle. Default 0, a flat disc or box.'),
  velocity: vector(-16, 16, 'Flow [x, y] in pixels per frame: a rate emitter steers its cells toward it (a jet; [0, 0] holds them still, as a drop gathering at a tip), a burst adds it once.'),
  expand: num(-16, 16, 'Push outward by this many pixels per frame while active (negative pulls inward): gas expands through the pressure solve, liquid particles are pushed.'),
  vortex: num(-16, 16, 'Swirl speed around at, in pixels per frame; positive turns clockwise on screen.'),
  noise: num(0, 8, 'Random push in pixels per frame, coherent over about three pixels and new every frame (seeded): turbulence.'),
  flicker: num(0, 1, 'Random variation of strength from cell to cell and frame to frame (seeded value noise), so a flame base breaks into tongues.'),
  pulse: cycle({ amplitude: num(0, 1, 'Share by which strength rises and falls; default 0.5. 1 switches the emitter off at the trough.') }, 1, 'Strength follows a sine wave: puffs, heaves, heartbeats.'),
  orbit: cycle({ radius: { oneOf: [num(0, 128), pairOf(num(0, 128))], description: 'Pixels from at, or [x, y] for an ellipse.' } }, -256, 'The emitter circles at (or follows an ellipse round it); a negative period turns anticlockwise. A rate emitter is laid along the path it covered since the last frame, so a fast orbit leaves a smooth trail.', ['radius']),
  carry: { ...object({
    drag: num(0, 1, 'Share of the difference between a carrier\'s velocity and the air\'s that it loses each frame; default 0.1. Low throws dust far, high lets the air take it at once.'),
    release: num(0.01, 1, 'Share of what a carrier still holds that it hands to the air each frame; default 0.2. What it holds is drawn with the smoke.'),
    gravity: vector(-2, 2, 'Each carrier\'s own acceleration [x, y]; a small positive y lets dust settle. Default [0, 0].')
  }), description: 'Gas: throw this emitter\'s smoke and heat (it needs a positive density or temperature) on heavy carriers, one per covered cell (each frame for a rate emitter, whose amounts are then thrown every frame; an orbiting one throws once a frame), launched with its velocity, vortex, expand (outward) and noise. A puff of gas cannot be thrown through still air, but dust can: carriers keep their momentum, slow by drag, hand their smoke to the air as they go and drop the rest where they meet an obstacle. For dust waves, skid smoke, dash trails.' },
  sparks: { ...object({
    count: num(0.01, 256, 'Sparks per frame for a rate emitter (at most 16; fractions spawn on some frames), or in all for a burst; follows pulse and flicker.'),
    life: { oneOf: [int(1, 256), pairOf(int(1, 256))], description: 'Frames each spark lives; [min, max] picks per spark. Default [8, 16].' },
    colors: keys('Palette keys spread over each spark\'s life, from birth to death.'),
    size: int(1, 3, 'Pixels across each spark; default 1. 2 reads at 1× (bubbles, embers, spray).'),
    trail: { type: 'boolean', description: 'Streak back to where the spark was a frame earlier, in the next colour of its list: flying debris, rising embers.' },
    angle: range(-3600, 3600, 'Launch direction in degrees, clockwise: 0 right, 90 down, 270 up. Default [0, 360].'), speed: range(0, 16, 'Launch speed in pixels per frame; default 0.'),
    gravity: vector(-2, 2, 'The spark\'s own acceleration [x, y]; negative y rises (bubbles, embers).'), drag: num(0, 1, 'Share of the spark\'s own speed lost each frame; default 0.05.'),
    follow: num(0, 2, 'How much the flow carries the spark: 1 (default) moves with the fluid, 0 ignores it (thrown debris). In a liquid, a spark with follow 0 that leaves the water ends where it falls back in (spray).'),
    pop: { type: 'boolean', description: 'Liquid only: the spark pops where it leaves the liquid, drawn as a ring around it for one frame and two droplets the next (bubbles bursting at the surface).' }
  }, ['count', 'colors']), description: 'One-pixel particles carried by the flow and drawn over it: embers, sparkles, debris, bubbles. In a loop they wrap round, so they loop exactly.' }
}, ['at']);
const fluidLook = object({
  field: { enum: FLUID_FIELDS, description: 'density (smoke or water; water is 1 inside), temperature (gas heat), speed (pixels per frame; foam, fast flow; a liquid has speed where there is water, a gas wherever its air moves, smoke or not), depth (pixels down from the liquid surface, 1 on the top row; from the third row down it follows the shallowest surface within three pixels along the row), light or shadow (0–1: how sharply density falls toward or away from the light; these only recolour pixels earlier layers drew).' },
  colors: keys('Palette keys from the lowest level to the highest.'),
  thresholds: { ...array(num(0.001, 256), 16), minItems: 1, description: 'One rising value per colour: each colour is fully on from its threshold up.' },
  dither: num(0, 1, 'Feather each colour in below its threshold through the pattern, over this share of the gap to the previous threshold (to 0 for the first). 0 draws hard bands; default 0.5.'),
  pattern: { oneOf: [{ enum: DITHER_PATTERNS }, { ...array({ ...array(int(0, 255), 16), minItems: 1 }, 16), minItems: 1 }], description: 'Dither pattern, as for the dither operation: bayer4 (default), bayer2, bayer8, noise or value (seeded by the effect) or a matrix of ranks. Anchored to the canvas, so it never crawls.' }
}, ['field', 'colors', 'thresholds']);
const fluidWhitewater = { ...object({
  impact: num(0.05, 32, 'Throw where a particle\'s velocity changes by at least this many pixels per frame within one frame: a drop landing, water striking water. Use impact or speed.'),
  speed: num(0.05, 32, 'Throw where a particle moves at least this many pixels per frame: a fast stream shedding drops. Use impact or speed.'),
  chance: num(0.001, 1, 'Share of qualifying surface particles that throw a droplet each frame (a seeded draw per particle); default 0.1.'),
  throw: num(0, 4, 'Droplet speed as a share of the impact or speed; default 1.'), spread: num(0, 180, 'Degrees of random turn either way; default 20.'),
  life: { oneOf: [int(1, 256), pairOf(int(1, 256))], description: 'Frames each droplet lives; [min, max] picks per droplet. Default [6, 12].' },
  colors: keys('Palette keys spread over each droplet\'s life, from birth to death.'), size: int(1, 3, 'Pixels across each droplet; default 1.'),
  trail: { type: 'boolean', description: 'Streak back to where the droplet was a frame earlier, in the next colour of its list.' },
  gravity: vector(-2, 2, 'The droplet\'s own acceleration [x, y]; default the effect\'s gravity.'), drag: num(0, 1, 'Share of the droplet\'s speed lost each frame; default 0.02.'),
  follow: num(0, 2, 'How much the flow carries the droplet: 0 (default) is spray, drawn once it has left the water and ending where it falls back in; above 0 is foam carried on the flow, ending once it is carried under.')
}, ['colors']), oneOf: [{ required: ['impact'] }, { required: ['speed'] }],
  description: 'Spray and foam thrown off the liquid by its own motion, from particles at the surface, tipped away from the water.' };
const fluidShape = object({ x: int(0, 127), y: int(0, 127), w: int(1, 128), h: int(1, 128), at: vector(-256, 512), radius: num(0.5, 128), velocity: vector(-16, 16, 'Starting velocity [x, y] in pixels per frame.'), burst: { ...object({ speed: { ...range(0, 16, 'Speed'), description: 'How fast each piece flies out from the middle of the fill, in pixels per frame; [min, max] picks per piece.' }, pieces: int(2, 64, 'How many pieces. Default 8.') }, ['speed']), description: 'Break the fill into seeded pieces with a one-pixel gap between them, each flying straight out at its own speed (plus velocity): a liquid burst in mid-air. Outward velocity on one connected blob is cancelled by the pressure solve; separate pieces keep it. The water of the gaps goes to their pieces, so the volume is kept.' } });
const fluid = {
  $schema: schema.$schema, title: 'Pixelbolt fluid effects',
  description: 'A deterministic fluid simulation compiled into an ordinary recipe: one frame sequence and animation per effect (frames <effect>-0, <effect>-1…), each frame a palette grid operation, with obstacles stamped from symbols. Gases (smoke, fire, steam, explosions, magic) run stable fluids with buoyancy, vorticity confinement, dissipation and cooling; liquids (splashes, waterfalls, drips, potions) run FLIP particles on the same grid. Either may be viscous (honey, syrup, tar), and a liquid may have a yield stress (mud, slime). Look layers map fields onto palette ramps through ordered dither, so no colour outside the palette can appear. Looping effects warm up for whole cycles and blend their closing frames toward the frames before frame 0, so the last frame flows into the first. The same source gives the same recipe on every machine.',
  ...object({ format: { const: 'pixelforge-fluid' }, version: { const: 1 }, name: id, width: int(4, 128, 'Canvas width in pixels; the grid has one cell per pixel.'), height: int(4, 128), palette: schema.properties.palette,
    symbols: { type: 'object', propertyNames: id, additionalProperties: ref('rows'), description: 'Named rows for obstacles: braziers, logs, pipes, flasks, rocks.' }, anchor: schema.properties.anchor,
    effects: { type: 'object', minProperties: 1, maxProperties: 16, propertyNames: id, additionalProperties: object({
      kind: { enum: FLUID_KINDS, description: 'gas (default): smoke, fire, steam, explosions, magic. liquid: water, potions, honey and slime as FLIP particles.' },
      frames: int(1, 256), duration: { oneOf: [int(1, 60000), array(int(1, 60000), 256)], description: 'Milliseconds per frame, or one per frame; default 80.' },
      loop: { type: 'boolean', description: 'Seamless loop: emitter timing, pulses, orbits and noise repeat every cycle; the simulation warms up and its closing frames blend toward the frames before frame 0.' },
      seed: int(0, 2147483647, 'Default 1.'), warmup: int(1, 8, 'Loops: whole cycles simulated before the recorded one; default 2. Raise it when a flow takes long to settle (a filling pool).'),
      blend: int(1, 128, 'Loops: closing frames blended toward the previous cycle\'s; default a third of the frames, at most 8.'),
      substeps: int(1, 4, 'Simulation steps per frame; default 2. Raise for fast liquids.'), iterations: int(1, 200, 'Pressure solve sweeps per step, and with viscosity or yield as many steps of the viscosity solve; default 30 (gas) or 40 (liquid).'),
      buoyancy: num(-2, 2, 'Gas: upward acceleration per unit of temperature; default 0.15.'), weight: num(-2, 2, 'Gas: downward acceleration per unit of density (negative floats smoke); default 0.'),
      vorticity: num(0, 2, 'Gas: vorticity confinement, which keeps small swirls so smoke curls; default 0.25.'),
      dissipation: num(0, 1, 'Gas: share of density lost per frame; default 0.03.'), cooling: num(0, 1, 'Gas: share of temperature lost per frame; default 0.08.'),
      drag: num(0, 1, 'Share of velocity lost per frame, as if the surroundings held the fluid back (water under water, a gas in still air); it slows falling too. For a thick fluid use viscosity. Default 0.02 (gas) or 0 (liquid).'), wind: vector(-2, 2, 'Gas: acceleration [x, y] everywhere.'),
      advection: { enum: ['smooth', 'sharp'], description: 'Gas: smooth (default) is plain semi-Lagrangian advection, which blurs a little every step; sharp (MacCormack with a limiter) keeps edges and small swirls crisp, at up to twice the cost; smoke lingers longer, so a one-shot may need more dissipation to end empty.' },
      viscosity: num(0, 64, 'Thickness, in square pixels per frame: it slows shearing and stretching but not falling or turning as a whole, so a thick drop falls as fast as water but spreads slowly and a stream never breaks into drops. Liquids: about 0.5 oil, 2–4 syrup, 8–16 honey, 32–64 tar. Gases: 0.1–1 for slow, smooth flows (a swirl dies away within frames above 1). Walls and obstacles hold a viscous fluid unless slip is set. Default 0.'),
      yield: num(0, 16, 'Liquid: yield stress, for mud, slime, dough and toothpaste. Below it the liquid is elastic and keeps its shape, squashing and springing back; pushed past it, it flows. A heap h pixels high holds itself up when yield is more than about gravity × h / 2. Default 0.'),
      slip: { type: 'boolean', description: 'With viscosity or yield: the fluid slides along walls and obstacles instead of being held by them (a greased pan). Default false.' },
      gravity: vector(-2, 2, 'Liquid: acceleration [x, y]; default [0, 0.3].'), flip: num(0, 1, 'Liquid: FLIP share of each particle\'s velocity (lively, noisier) against the grid\'s (calm); default 0.9. A viscous liquid lowers it where it is thick.'),
      apic: { type: 'boolean', description: 'Liquid: affine particle-in-cell. The calm (grid) share of each particle\'s velocity also carries the turning and shearing of the flow around it, so calm and thick liquids keep their swirls and folds instead of smearing them. Use it with a low flip. Default false.' },
      tension: num(0, 4, 'Liquid: cohesion that keeps drops and streams together; default 0.5.'),
      adhesion: num(0, 4, 'Liquid: how strongly it holds on to walls and obstacles. Liquid touching a solid stays on it unless pulled away faster than about adhesion ÷ 2 pixels per frame, so a film clings under a ledge, to a spoon or down a jar\'s side. Default 0.'),
      keys: { ...array(object({ frame: int(0, 255, 'The frame (within the cycle, for a loop) the change starts on.'), over: int(0, 256, 'Frames to move to the new values in a straight line; default 0, at once.'), yield: num(0, 16), viscosity: num(0, 64), adhesion: num(0, 4), gravity: vector(-2, 2) }, ['frame']), 16), minItems: 1, description: 'Liquid: change yield, viscosity, adhesion or gravity at a chosen frame, so the decisive moment lands where you want it: a heap held up by its yield gives way when a key drops it, a blob held under a ledge by adhesion drops when a key sets adhesion to 0. Each setting starts from the effect\'s own value and follows the keys that name it, in frame order; a loop repeats them every cycle.' },
      fill: { ...array(fluidShape, 16), description: 'Liquid: water at frame 0 in discs (at, radius), boxes (x, y, w, h) or their overlap (both).' },
      walls: { ...array({ enum: FLUID_WALLS }, 4), uniqueItems: true, description: 'Closed canvas edges. Open edges (the default) let gas and water out.' },
      obstacles: { ...array(object({ symbol: id, x: int(0, 127), y: int(0, 127), draw: { enum: ['over', 'under', 'none'], description: 'over (default): stamped in front of the fluid, its outline and sparks; under: behind its outline and sparks (the fluid itself never enters a solid obstacle); none: an invisible wall.' }, surface: { enum: ['pixels', 'smooth'], description: 'pixels (default): the fluid meets every pixel step. smooth: it meets an outline traced through the steps, so a liquid slides down a drawn slope, roof or chute (a 1:1 staircase acts as a straight 45° slope; draw lines at least 2 pixels thick to smooth both sides), and a liquid can fall away from it instead of hanging on by suction (adhesion still holds it on). The obstacle is drawn as it is either way.' }, solid: { type: 'boolean', description: 'false: a decoration, drawn over or under the fluid as draw says but never met by it (a net, a candle flame, a label, a background). Default true.' }, keys: { ...array(object({ frame: int(0, 255, 'The frame (within the cycle, for a loop) the change starts on.'), over: int(0, 256, 'Frames to move to the new place in a straight line, in whole pixels; default 0, at once.'), x: int(0, 127), y: int(0, 127), show: { type: 'boolean', description: 'false takes the obstacle away (not drawn, not solid) from this frame on; true brings it back.' } }, ['frame']), 16), minItems: 1, description: 'Move the obstacle or take it away on cue: a dam that vanishes, a gate that lifts, a plunger, a paddle. Each key starts from where the obstacle is on its frame; the symbol must stay inside the canvas on every frame it shows. While a key\'s over runs, the obstacle pushes the fluid ahead of it (its faces carry its speed) and shoves fluid in cells it now covers to the first open cell, never through another solid. A key with no over is a cut: the obstacle is simply elsewhere, pushes nothing, and fluid where it lands (or where an obstacle appears) is taken away. A loop repeats the keys every cycle.' } }, ['symbol']), 32), description: 'Solid shapes from symbols: their visible pixels block the flow (decorations with solid: false only draw). They must fit the canvas.' },
      emitters: { ...array(fluidEmitter, 16), description: '1–16 sources; a liquid with a fill may have none.' },
      look: { ...array(fluidLook, 8), minItems: 1, description: 'Layers drawn in order, later over earlier, each mapping one field to palette colours.' },
      whitewater: { ...array(fluidWhitewater, 4), description: 'Liquid: up to four layers of spray or foam thrown off the water where it lands or runs fast, drawn over it like sparks.' },
      light: vector(-1, 1, 'Direction toward the light for the light and shadow fields; default [-1, -1], the upper left.'),
      outline: { ...key, description: 'Palette key for a one-pixel outline around the fluid.' },
      cleanup: { ...object({ strays: bool, corners: bool }), description: 'De-Stray (specks and pinholes take their surroundings\' colour) and De-Corner cleanup of the fluid before outline and sparks.' }
    }, ['frames', 'emitters', 'look']) },
    sheet: schema.properties.sheet
  }, ['format', 'version', 'name', 'width', 'height', 'effects']), $defs: { rows: schema.$defs.rows }
};
const waveCommon = {
  at: vector(-4096, 4096, 'Source centre or phase origin [x, y] in pixel coordinates.'),
  wavelength: num(2, 256, 'Pixels per cycle before radial stretch. Wider bands read better at small sizes.'),
  amplitude: num(0, 4, 'Signed sources are summed before colouring. Default 1.'),
  cycles: int(-16, 16, 'Whole cycles per animation; negative reverses travel, zero is static. Default 1.'),
  phase: num(-3600, 3600, 'Relative phase in degrees. 180 opposes an otherwise identical source. Default 0.')
};
const waveColors = { ...array({ type: 'string', minLength: 1, maxLength: 1 }, 8), minItems: 1, description: 'Single-character palette keys; dot and space are reserved.' };
const waveRows = { ...array({ type: 'string', minLength: 1, maxLength: 128 }, 128), minItems: 1, description: 'A full-canvas palette grid. Dot or space leaves the pixel transparent.' };
const wave = {
  $schema: schema.$schema, title: 'Pixelbolt wave effects',
  description: 'Looping coherent procedural waves compiled to editable palette grids. Direct radial/directional synthesis, not a physical water or obstacle solver. All sources combine before palette thresholds. No runtime physics or dependencies.',
  ...object({ format: { const: 'pixelforge-wave' }, version: { const: 1 }, name: id,
    width: int(1, 128), height: int(1, 128), palette: schema.properties.palette, anchor: point, sheet: schema.properties.sheet,
    effects: { type: 'object', minProperties: 1, maxProperties: 16,
      propertyNames: { ...id, maxLength: 60 }, description: 'Names become animations; unique ignoring case. At most 256 frames and 4,194,304 pixels in total.',
      additionalProperties: object({ frames: int(4, 128), duration: int(20, 1000, 'Milliseconds per frame. Default 80. Every effect loops.'),
        sources: { ...array({ oneOf: [
          object({ kind: { const: 'radial' }, ...waveCommon, stretch: vector(0.125, 8, 'Radial shape scale [x, y]; default [1, 1]. A smaller y flattens the rings onto the ground.') }, ['kind', 'at', 'wavelength']),
          object({ kind: { const: 'directional' }, ...waveCommon, angle: num(-3600, 3600, 'Degrees clockwise, 0 right and 90 down. Default 0.') }, ['kind', 'at', 'wavelength'])
        ] }, 4), minItems: 1 },
        mask: object({ at: vector(-4096, 4096), radius: vector(0.5, 256, 'Ellipse radii [x, y]. Clipping only, never a reflecting obstacle.'), feather: num(0, 1, 'Fraction of the ellipse radius faded inward; 0 is a hard edge. Default 0.2.') }, ['at', 'radius']),
        look: object({ colors: waveColors,
          thresholds: { ...array(num(0.000001, 16), 8), minItems: 1, description: 'Strictly increasing positive values, one per colour. Values below the first remain transparent.' },
          negative: { ...waveColors, description: 'Optional colours for negative amplitudes at the same absolute thresholds; otherwise negative amplitudes are transparent.' }
        }, ['colors', 'thresholds']),
        underlay: waveRows, overlay: waveRows
      }, ['frames', 'sources', 'look']) }
  }, ['format', 'version', 'name', 'width', 'height', 'palette', 'effects'])
};
const normals = {
  $schema: schema.$schema, title: 'Pixelbolt normal pass',
  description: 'Derives a lighting normal pass from a colour recipe and compiles it to an ordinary recipe aligned with it (same size, frame names and durations, animations and atlas layout), ready for a scene asset\'s normal and editable like any recipe. Each separate shape is rounded from its silhouette, lighter colours can be raised by detail, and every pixel takes the nearest of 17 directions: palette key 5 faces the viewer, the keypad digits 1–4 and 6–9 lean 30° the way they sit around 5, and q w e a d z x c lean 60° the same way.',
  ...object({ format: { const: 'pixelforge-normals' }, version: { const: 1 }, name: { ...id, description: 'Name of the normal recipe; default <recipe name>-normal.' },
    recipe: { ...assetRef, description: 'The colour recipe, at most 256 pixels a side (a normal pass lights scene assets): inline, a file resolved by the CLI relative to this source (or inside the MCP root), or {"revision": id} through MCP.' },
    bevel: int(1, 64, 'Pixels from the edge to the flat top. Default: each shape rounds all the way to its thickest point, like a cushion.'),
    detail: num(0, 1, 'How far lighter colours stand out of the surface, up to 2 pixels: 0 (default) keeps only the silhouette\'s shape; 0.5–1 embosses textured surfaces such as brick, bark or rock. A colour on a ramp counts its step along the ramp, any other its brightness.'),
    faces: { type: 'object', minProperties: 1, additionalProperties: { enum: NORMAL_KEYS }, description: 'Flat faces by colour: maps the colour recipe\'s palette keys to one direction each, so a box, wall or building gets flat planes instead of a cushion. Pixels drawn in that key\'s colour take the direction; all others are rounded as usual. Side view: tops w, fronts 5. 3/4 top-down: tops w or 8, south faces 2 or 5. Isometric 2:1: tops w, left faces z, right faces c.' }
  }, ['format', 'version', 'recipe']), $defs: { ...schema.$defs, recipe: recipeSchema }
};
for (const [file, value] of [['poses.schema.json', poses], ['scene.schema.json', scene], ['autotile.schema.json', autotile], ['fx.schema.json', fx], ['fluid.schema.json', fluid], ['wave.schema.json', wave], ['normals.schema.json', normals]]) await writeFile(new URL(`../${file}`, import.meta.url), JSON.stringify(value, null, 2) + '\n');
