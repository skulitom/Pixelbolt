// What a render delivered, and how it differs from what the user asked for (`expect`). Each problem names the file
// and the call that fixes it, so an agent can correct an export before handing it on. Read-only: it never changes
// the bundle.
import { PixelError } from './core.js';

// The format's limits, as core.js enforces them, so no fix asks for a recipe the renderer refuses: canvas sides,
// sheet.scale, source frames, their total area, and the names one animation lists. A pingpong of n names (n > 2)
// plays 2n - 2 frames, so an animation plays at most 2,046.
const CANVAS = 256, SCALE = 16, SOURCE_FRAMES = 256, FRAME_AREA = 4194304, ATLAS = 16777216, NAMES = 1024, PLAYED = 2 * NAMES - 2;
const LIMITS = { width: CANVAS * SCALE, height: CANVAS * SCALE, frames: PLAYED, colors: 65536, gifScale: SCALE };

export function readExpect(expect) {
  if (expect === undefined) return undefined;
  if (expect === null || typeof expect !== 'object' || Array.isArray(expect)) throw new PixelError('expect', 'expected an object such as { "width": 32, "height": 32, "frames": 8 }');
  for (const [key, value] of Object.entries(expect)) {
    if (key === 'transparent' || key === 'loop') { if (typeof value !== 'boolean') throw new PixelError(`expect.${key}`, 'expected true or false'); continue; }
    if (!Object.hasOwn(LIMITS, key)) throw new PixelError(`expect.${key}`, 'unknown field; use width, height, frames, colors, transparent, loop or gifScale');
    if (!Number.isInteger(value) || value < 1 || value > LIMITS[key]) throw new PixelError(`expect.${key}`, `expected a whole number from 1 to ${LIMITS[key]}`);
  }
  return expect;
}

const gifFiles = gifs => gifs.map(gif => `gifs/${gif.animation}.gif`).slice(0, 8).join(', ');
const list = (names, limit = 8) => names.slice(0, limit).map(name => JSON.stringify(name)).join(', ') + (names.length > limit ? ` and ${names.length - limit} more` : '');
// The whole number k with canvas * k = asked on every given side, if there is one.
const wholeScale = (pairs, max) => {
  const scales = pairs.filter(([asked]) => asked !== undefined).map(([asked, canvas]) => asked / canvas);
  return scales.length && scales.every(k => k === scales[0] && Number.isInteger(k) && k >= 1 && k <= max) ? scales[0] : null;
};

// A size with a side over 256 px is a smaller canvas exported at a whole sheet.scale. Offers the canvas nearest the
// current one (the least redrawing) and, when it differs, the one with the most detail.
function largeSizeFix(expect, { width, height, frames, sheet }, recipe) {
  const asked = expect.width !== undefined && expect.height !== undefined ? `${expect.width}x${expect.height}` : expect.width !== undefined ? `a width of ${expect.width}` : `a height of ${expect.height}`;
  // The untrimmed atlas at that size (a trimmed one packs smaller, so it isn't held to this).
  const atlas = (w, h, k) => sheet.trim ? 0 : sheet.columns * (w + sheet.padding * 2) * k * Math.ceil(frames.length / sheet.columns) * (h + sheet.padding * 2) * k;
  const fits = [];
  let crowded = false;
  for (let k = 2; k <= SCALE; k++) {
    const w = expect.width === undefined ? width : expect.width / k, h = expect.height === undefined ? height : expect.height / k;
    if (!Number.isInteger(w) || !Number.isInteger(h) || w > CANVAS || h > CANVAS || w * h * frames.length > FRAME_AREA) continue;
    if (atlas(w, h, k) > ATLAS) crowded = true;
    else fits.push({ k, w, h, distance: Math.abs(w - width) + Math.abs(h - height) });
  }
  if (!fits.length && crowded) return `${frames.length} frames at ${asked} make an atlas over 16,777,216 pixels at every scale: ask for fewer frames or a smaller size${sheet.trim ? '' : ', or set sheet.trim if the frames have empty margins'}`;
  if (!fits.length) {
    const k = Math.min(SCALE, Math.ceil(Math.max(expect.width ?? 0, expect.height ?? 0) / CANVAS)), side = (value, canvas) => value === undefined ? canvas : Math.min(CANVAS, Math.max(1, Math.round(value / k)));
    const w = side(expect.width, width), h = side(expect.height, height);
    return `canvases stop at ${CANVAS} px a side and sheet.scale at ${SCALE}, and no whole scale exports ${asked} exactly from ${frames.length} frame${frames.length === 1 ? '' : 's'}: tell the user, and offer ${w * k}x${h * k} (a ${w}x${h} canvas at sheet.scale ${k}) instead`;
  }
  const changes = fit => JSON.stringify([...(expect.width !== undefined ? [{ set: 'width', value: fit.w }] : []), ...(expect.height !== undefined ? [{ set: 'height', value: fit.h }] : []), recipe !== undefined && recipe.sheet === undefined ? { set: 'sheet', value: { scale: fit.k } } : { set: 'sheet.scale', value: fit.k }]);
  const nearest = fits.reduce((best, fit) => fit.distance < best.distance ? fit : best), detailed = fits[0];
  return `canvases stop at ${CANVAS} px a side, so ${asked} is a ${nearest.w}x${nearest.h} canvas at sheet.scale ${nearest.k}, the nearest to the current ${width}x${height}: pixel_patch ${changes(nearest)}${nearest === detailed ? '' : ` (or ${changes(detailed)}, a ${detailed.w}x${detailed.h} canvas at sheet.scale ${detailed.k}, for the most detail)`}, fit the drawing to the new canvas, pixel_inspect, then render again`;
}

// What leaves see-through pixels after the background is drawn, in the named frames or the earlier frames they copy
// (`from`): frame-level clear and erasing dither, translate without wrap, and "transparent" pixel corrections. Layer
// clears erase only their own layer, so they don't count. Returns frame name -> kinds.
function erasers(recipe, names) {
  const frames = Array.isArray(recipe?.frames) ? recipe.frames : [], byName = new Map(frames.map(frame => [frame?.name, frame])), found = new Map();
  for (const start of names) for (let frame = byName.get(start), hops = 0; frame && hops <= frames.length; frame = byName.get(frame.from), hops++) {
    const kinds = [];
    for (const op of Array.isArray(frame.ops) ? frame.ops : []) {
      if (op?.op === 'clear') kinds.push('clear');
      else if (op?.op === 'dither' && op.erase === true) kinds.push('dither with erase');
    }
    if (Array.isArray(frame.translate) && frame.translate.some(Boolean) && frame.wrap !== true) kinds.push('translate');
    if (Array.isArray(frame.pixels) && frame.pixels.some(pixel => pixel?.color === 'transparent')) kinds.push('"transparent" pixels');
    if (kinds.length) found.set(frame.name, [...new Set([...(found.get(frame.name) ?? []), ...kinds])]);
  }
  return found;
}

// The background's alpha from the recipe: 0 when unset or transparent, 255 when it can't tell.
function backgroundAlpha(recipe) {
  const key = recipe?.background ?? 'transparent', value = typeof recipe?.palette?.[key] === 'string' ? recipe.palette[key] : key;
  if (value === 'transparent') return 0;
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value)?.[1];
  return hex?.length === 4 ? parseInt(hex[3] + hex[3], 16) : hex?.length === 8 ? parseInt(hex.slice(6), 16) : 255;
}

function opaqueFix(recipe, holes) {
  const found = erasers(recipe, holes), culprits = [...found.keys()];
  const what = culprits.length ? `${[...new Set([...found.values()].flat())].join(', ')} in ${list(culprits)}` : '';
  if (backgroundAlpha(recipe) === 255) return culprits.length
    ? `the background is already opaque, but frame drawing erases it (${what}): remove those or paint over what they clear, then render again`
    : 'the background is already opaque: paint over the see-through pixels (pixel_inspect with grid: true shows them as "."), then render again';
  return `pixel_patch { "set": "background", "value": "<palette key>" }${backgroundAlpha(recipe) > 0 ? ' (an opaque one: the current background is see-through)' : ''}${culprits.length ? `, and remove or paint over what erases it (${what})` : ''}, then render again`;
}

// How to make one animation play `want` frames within the limits: source frames, names per list, pingpong's 2n - 2.
function framesFix(key, want, named, direction, { width, height }) {
  const pingpong = want % 2 === 0 && want >= 4 ? want / 2 + 1 : null;
  if (want > NAMES && pingpong === null) return `no animation plays ${want} frames: one lists at most ${NAMES} names, and a pingpong of n names plays 2n-2, an even number up to ${PLAYED}; tell the user, or play ${want - 1} or ${want + 1}`;
  if (!named) {
    const head = 'the recipe has no animations field, so every frame plays once in order';
    if (want <= SOURCE_FRAMES && want * width * height <= FRAME_AREA) return `${head}: add or remove frames (pixel_patch insert or remove under frames) until there are ${want}, or add an animation that lists ${want} frame names (a name may repeat)`;
    const cap = want > SOURCE_FRAMES ? `a recipe holds at most ${SOURCE_FRAMES} frames` : `${want} frames of ${width}x${height} pass the limit of 4,194,304 pixels of frames`;
    return want <= NAMES
      ? `${head}, and ${cap}: add an animation that lists ${want} frame names in play order (a name may repeat), pixel_patch set "animations" to { "${key}": { "frames": [${want} names] } }, then render again`
      : `${head}, and ${cap}: add a pingpong animation of ${pingpong} frame names, which plays ${want}: pixel_patch set "animations" to { "${key}": { "frames": [${pingpong} names], "direction": "pingpong" } }, then render again`;
  }
  if (direction === 'pingpong') {
    const options = [...(pingpong !== null ? [`list ${pingpong} names in animations.${key}.frames`] : []), ...(want <= NAMES ? [`set animations.${key}.direction to "forward" and list ${want} names`] : [])];
    return `"${key}" is pingpong, which plays 2n-2 frames for n names: ${options.join(', or ')}`;
  }
  return want <= NAMES
    ? `make "${key}" play ${want} frames: list ${want} names in animations.${key}.frames (a name may repeat; pixel_patch insert under frames only for new drawings), then render again`
    : `one animation lists at most ${NAMES} names: set animations.${key}.direction to "pingpong" and list ${pingpong} names, which play ${want}`;
}

// project: the rendered project; recipe: its source (for animation directions and whether it names animations);
// gifs: the animationGIF results written beside it, or undefined when the command writes no GIFs (the CLI's render);
// animation: check only that animation and its frames.
export function checkDelivery(project, { recipe, gifs, expect, animation } = {}) {
  const { name, width, height, sheet, animations } = project, scale = sheet.scale;
  if (animation !== undefined && !Object.hasOwn(animations, animation)) throw new PixelError('animation', `no animation named "${animation}"; choose one of: ${Object.keys(animations).join(', ')}`);
  const names = animation === undefined ? Object.keys(animations) : [animation];
  const frames = animation === undefined ? project.frames : [...new Set(animations[animation].frames)].sort((a, b) => a - b).map(index => project.frames[index]);
  const colors = new Set(), empty = [], clear = [], solid = [];
  for (const frame of frames) {
    let transparent = 0, opaque = 0;
    const { data } = frame, pixels = data.length >> 2;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha === 0) transparent++;
      else { colors.add(((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | alpha) >>> 0); if (alpha === 255) opaque++; }
    }
    if (transparent === pixels) empty.push(frame.name);
    if (transparent) clear.push(frame.name);
    if (opaque === pixels) solid.push(frame.name);
  }
  const played = Object.fromEntries(names.slice(0, 16).map(key => [key, { frames: animations[key].frames.length, loop: animations[key].loop }]));
  const delivered = {
    size: [width * scale, height * scale], ...(scale !== 1 && { canvas: [width, height], scale }),
    animations: played, ...(names.length > 16 && { animationsOmitted: names.length - 16 }),
    colors: colors.size, transparent: clear.length === frames.length ? true : clear.length ? 'some frames' : false,
    ...(gifs?.length && { gifs: [gifs[0].width, gifs[0].height] })
  };
  const notes = empty.length ? [`Frame${empty.length === 1 ? '' : 's'} ${list(empty)} ${empty.length === 1 ? 'is' : 'are'} fully transparent; if that is not intended, draw ${empty.length === 1 ? 'it' : 'them'} (pixel_patch) or take ${empty.length === 1 ? 'it' : 'them'} out of the animation.`] : [];
  const fields = gifs === undefined ? 'width, height, frames, colors, transparent, loop' : 'width, height, frames, colors, transparent, loop, gifScale';
  if (!expect) return { delivered, ...(notes.length && { notes }), hint: `Pass expect with what the user asked for (${fields}) to check every file against it.` };

  const problems = [], frameFiles = `${name}.png, frames/ and animations/`, named = recipe?.animations !== undefined;
  const asked = { ...(expect.width !== undefined && { width: expect.width }), ...(expect.height !== undefined && { height: expect.height }) };
  if ((expect.width !== undefined && expect.width !== width * scale) || (expect.height !== undefined && expect.height !== height * scale)) {
    const k = wholeScale([[expect.width, width], [expect.height, height]], 16);
    const fix = k !== null
      ? `${k === 1 ? `sheet.scale ${scale} enlarges every export: ` : ''}pixel_patch ${recipe !== undefined && recipe.sheet === undefined ? `{ "set": "sheet", "value": { "scale": ${k} } }` : `{ "set": "sheet.scale", "value": ${k} }`}, then render again`
      : (expect.width ?? 0) > CANVAS || (expect.height ?? 0) > CANVAS ? largeSizeFix(expect, project, recipe)
      : `the canvas is ${width}x${height}${scale !== 1 ? ` at sheet.scale ${scale}` : ''}: change the recipe's ${Object.keys(asked).join(' and ')} (pixel_patch { "set": "${Object.keys(asked)[0]}", "value": ${Object.values(asked)[0]} }${scale !== 1 ? ' and sheet.scale 1' : ''}), fit the drawing to it, pixel_inspect, then render again`;
    problems.push({ file: frameFiles, asked, got: { width: width * scale, height: height * scale }, fix });
  }
  if (gifs !== undefined) {
    // Only the GIFs of the animations being checked.
    const scoped = gifs.filter(gif => names.includes(gif.animation));
    // A GIF should be the asked frame size, times gifScale when one was asked for.
    const gifScale = expect.gifScale ?? 1, sized = expect.width !== undefined || expect.height !== undefined || expect.gifScale !== undefined;
    const wantW = (expect.width ?? width * scale) * gifScale, wantH = (expect.height ?? height * scale) * gifScale, k = wholeScale([[wantW, width], [wantH, height]], Infinity);
    const gifFix = k === null ? 'fix the frame size first (see the problem above), then render the GIFs again'
      : k > 16 ? `a GIF that size needs scale ${k}, above the limit of 16: ask for a smaller gifScale, or lower sheet.scale`
        : `render again with "gif": { "scale": ${k} }${k === 1 ? ' or "gif": {}' : ''}`;
    if (expect.gifScale !== undefined && !scoped.length) problems.push({ file: 'gifs/', asked: { width: wantW, height: wantH }, got: 'no GIF', fix: gifFix });
    const wrong = sized ? scoped.filter(gif => gif.width !== wantW || gif.height !== wantH) : [];
    if (wrong.length) problems.push({ file: gifFiles(wrong), asked: { width: wantW, height: wantH }, got: { width: wrong[0].width, height: wrong[0].height }, fix: gifFix });
    // A GIF background blends every pixel onto one colour, so GIFs can miss a request the frames meet. (Opaque frames
    // always make an opaque GIF, so only the transparent side needs a GIF check.)
    const opaque = expect.transparent === true && clear.length === frames.length ? scoped.filter(gif => !gif.transparent) : [];
    if (opaque.length) problems.push({ file: gifFiles(opaque), asked: 'a transparent background', got: 'an opaque GIF', fix: 'render again without a "background" in "gif" (GIFs keep 1-bit transparency by default)' });
    const many = expect.colors !== undefined && colors.size <= expect.colors ? scoped.filter(gif => gif.colors > expect.colors) : [];
    if (many.length) problems.push({ file: gifFiles(many), asked: `at most ${expect.colors} colours`, got: many[0].colors, fix: 'a GIF background adds its colour and blends soft edges into new ones: render again without it, or with a background from the palette' });
  }
  if (expect.frames !== undefined) for (const key of names) {
    const count = animations[key].frames.length;
    if (count === expect.frames) continue;
    problems.push({ file: `animations/${key}.png`, asked: expect.frames, got: count, fix: framesFix(key, expect.frames, named, recipe?.animations?.[key]?.direction, project) });
  }
  if (expect.colors !== undefined && colors.size > expect.colors) problems.push({ file: frameFiles, asked: `at most ${expect.colors} colours`, got: colors.size, fix: 'merge similar colours with pixel_patch recolor (or fewer palette entries), check with pixel_inspect diagnostics, then render again' });
  if (expect.transparent === true && clear.length !== frames.length) {
    const filled = frames.map(frame => frame.name).filter(frameName => !clear.includes(frameName));
    problems.push({ file: frameFiles, asked: 'a transparent background', got: `no transparent pixel in ${list(filled)}`, fix: 'pixel_patch { "set": "background", "value": "transparent" } and remove any fill that covers the whole canvas, then render again' });
  }
  if (expect.transparent === false && solid.length !== frames.length) {
    const holes = frames.map(frame => frame.name).filter(frameName => !solid.includes(frameName));
    problems.push({ file: frameFiles, asked: 'an opaque background', got: `transparent pixels in ${list(holes)}`, fix: opaqueFix(recipe, holes) });
  }
  if (expect.loop !== undefined) for (const key of names) {
    if (animations[key].loop === expect.loop) continue;
    const fix = named
      ? `pixel_patch { "set": "animations.${key}.loop", "value": ${expect.loop} }, then render again`
      : project.frames.length <= 16
        ? `the recipe has no animations field: pixel_patch { "set": "animations", "value": ${JSON.stringify({ [key]: { frames: project.frames.map(frame => frame.name), loop: expect.loop } })} }, then render again`
        : `the recipe has no animations field: pixel_patch set "animations" to { "${key}": { "frames": [every frame's name, in order], "loop": ${expect.loop} } }, then render again`;
    problems.push({ file: `animations/${key}.png`, asked: expect.loop ? 'a loop' : 'one play', got: animations[key].loop ? 'a loop' : 'one play', fix });
  }
  return { ok: !problems.length, delivered, ...(problems.length && { problems: problems.slice(0, 16) }), ...(notes.length && { notes }) };
}
