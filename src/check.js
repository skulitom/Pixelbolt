// What a render delivered, and how it differs from what the user asked for (`expect`). Each problem names the file
// and the call that fixes it, so an agent can correct an export before handing it on. Read-only: it never changes
// the bundle.
import { PixelError } from './core.js';

const LIMITS = { width: 4096, height: 4096, frames: 1024, colors: 65536, gifScale: 16 };

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

const list = (names, limit = 8) => names.slice(0, limit).map(name => JSON.stringify(name)).join(', ') + (names.length > limit ? ` and ${names.length - limit} more` : '');
// The whole number k with canvas * k = asked on every given side, if there is one.
const wholeScale = (pairs, max) => {
  const scales = pairs.filter(([asked]) => asked !== undefined).map(([asked, canvas]) => asked / canvas);
  return scales.length && scales.every(k => k === scales[0] && Number.isInteger(k) && k >= 1 && k <= max) ? scales[0] : null;
};

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
      : `the canvas is ${width}x${height}${scale !== 1 ? ` at sheet.scale ${scale}` : ''}: change the recipe's ${Object.keys(asked).join(' and ')} (pixel_patch { "set": "${Object.keys(asked)[0]}", "value": ${Object.values(asked)[0]} }${scale !== 1 ? ' and sheet.scale 1' : ''}), fit the drawing to it, pixel_inspect, then render again`;
    problems.push({ file: frameFiles, asked, got: { width: width * scale, height: height * scale }, fix });
  }
  if (gifs !== undefined) {
    // A GIF should be the asked frame size, times gifScale when one was asked for.
    const gifScale = expect.gifScale ?? 1, sized = expect.width !== undefined || expect.height !== undefined || expect.gifScale !== undefined;
    const wantW = (expect.width ?? width * scale) * gifScale, wantH = (expect.height ?? height * scale) * gifScale, k = wholeScale([[wantW, width], [wantH, height]], Infinity);
    const gifFix = k === null ? 'fix the frame size first (see the problem above), then render the GIFs again'
      : k > 16 ? `a GIF that size needs scale ${k}, above the limit of 16: ask for a smaller gifScale, or lower sheet.scale`
        : `render again with "gif": { "scale": ${k} }${k === 1 ? ' or "gif": {}' : ''}`;
    if (expect.gifScale !== undefined && !gifs.length) problems.push({ file: 'gifs/', asked: { width: wantW, height: wantH }, got: 'no GIF', fix: gifFix });
    const wrong = sized ? gifs.filter(gif => gif.width !== wantW || gif.height !== wantH) : [];
    if (wrong.length) problems.push({ file: wrong.map(gif => `gifs/${gif.animation}.gif`).slice(0, 8).join(', '), asked: { width: wantW, height: wantH }, got: { width: wrong[0].width, height: wrong[0].height }, fix: gifFix });
  }
  if (expect.frames !== undefined) for (const key of names) {
    const count = animations[key].frames.length, pingpong = recipe?.animations?.[key]?.direction === 'pingpong';
    if (count === expect.frames) continue;
    const fix = !named
      ? `the recipe has no animations field, so every frame plays once in order: add or remove frames (pixel_patch insert or remove under frames) until there are ${expect.frames}`
      : pingpong
        ? `"${key}" is pingpong, which plays 2n-2 frames for n names: ${expect.frames % 2 === 0 && expect.frames >= 4 ? `list ${expect.frames / 2 + 1} names in animations.${key}.frames, or ` : ''}set animations.${key}.direction to "forward" and list ${expect.frames} names`
        : `make "${key}" play ${expect.frames} frames: pixel_patch insert or remove frames, then list ${expect.frames} names in animations.${key}.frames`;
    problems.push({ file: `animations/${key}.png`, asked: expect.frames, got: count, fix });
  }
  if (expect.colors !== undefined && colors.size > expect.colors) problems.push({ file: frameFiles, asked: `at most ${expect.colors} colours`, got: colors.size, fix: 'merge similar colours with pixel_patch recolor (or fewer palette entries), check with pixel_inspect diagnostics, then render again' });
  if (expect.transparent === true && clear.length !== frames.length) {
    const filled = frames.map(frame => frame.name).filter(frameName => !clear.includes(frameName));
    problems.push({ file: frameFiles, asked: 'a transparent background', got: `no transparent pixel in ${list(filled)}`, fix: 'pixel_patch { "set": "background", "value": "transparent" } and remove any fill that covers the whole canvas, then render again' });
  }
  if (expect.transparent === false && solid.length !== frames.length) {
    const holes = frames.map(frame => frame.name).filter(frameName => !solid.includes(frameName));
    problems.push({ file: frameFiles, asked: 'an opaque background', got: `transparent pixels in ${list(holes)}`, fix: 'pixel_patch { "set": "background", "value": "<palette key>" }, then render again' });
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
