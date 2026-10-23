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

// project: a rendered project; gifs: the animationGIF results written beside it; animation: the one animation the
// agent asked about (checks every animation when omitted).
export function checkDelivery(project, { gifs = [], expect, animation } = {}) {
  const { name, width, height, sheet, frames, animations } = project, scale = sheet.scale;
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
  const names = animation !== undefined && Object.hasOwn(animations, animation) ? [animation] : Object.keys(animations);
  const played = Object.fromEntries(names.slice(0, 16).map(key => [key, { frames: animations[key].frames.length, loop: animations[key].loop }]));
  const delivered = {
    size: [width * scale, height * scale], ...(scale !== 1 && { canvas: [width, height], scale }),
    animations: played, ...(names.length > 16 && { animationsOmitted: names.length - 16 }),
    colors: colors.size, transparent: clear.length === frames.length ? true : clear.length ? 'some frames' : false,
    ...(gifs.length && { gifs: [gifs[0].width, gifs[0].height] })
  };
  const notes = empty.length ? [`Frame${empty.length === 1 ? '' : 's'} ${list(empty)} ${empty.length === 1 ? 'is' : 'are'} fully transparent; if that is not intended, draw ${empty.length === 1 ? 'it' : 'them'} (pixel_patch) or take ${empty.length === 1 ? 'it' : 'them'} out of the animation.`] : [];
  if (!expect) return { delivered, ...(notes.length && { notes }), hint: 'Pass expect with what the user asked for (width, height, frames, colors, transparent, loop, gifScale) to check every file against it.' };

  const problems = [], frameFiles = `${name}.png, frames/ and animations/`;
  const wantW = expect.width ?? width * scale, wantH = expect.height ?? height * scale;
  if (wantW !== width * scale || wantH !== height * scale) {
    if (wantW === width && wantH === height) problems.push({ file: frameFiles, asked: [wantW, wantH], got: [width * scale, height * scale], fix: `sheet.scale ${scale} enlarges every export; pixel_patch { "set": "sheet.scale", "value": 1 } (or remove it), then render again` });
    else problems.push({ file: frameFiles, asked: [wantW, wantH], got: [width * scale, height * scale], fix: `the canvas is ${width}x${height}${scale !== 1 ? ` at sheet.scale ${scale}` : ''}: change the recipe's width and height (pixel_patch { "set": "width", "value": ${wantW} } and "height"), fit the drawing to it, pixel_inspect, then render again` });
  }
  const gifScale = expect.gifScale ?? 1;
  if (expect.gifScale !== undefined && !gifs.length) problems.push({ file: 'gifs/', asked: `GIFs at scale ${gifScale}`, got: 'no GIF', fix: `render again with "gif": { "scale": ${gifScale} }` });
  const wrongGifs = gifs.filter(gif => gif.scale !== gifScale);
  if (wrongGifs.length) problems.push({ file: wrongGifs.map(gif => `gifs/${gif.animation}.gif`).slice(0, 8).join(', '), asked: [width * gifScale, height * gifScale], got: [wrongGifs[0].width, wrongGifs[0].height], fix: `render again with "gif": { "scale": ${gifScale} }${gifScale === 1 ? ' or "gif": {}' : ''}` });
  if (expect.frames !== undefined) for (const key of names) {
    const count = animations[key].frames.length;
    if (count !== expect.frames) problems.push({ file: `animations/${key}.png`, asked: expect.frames, got: count, fix: `make animation "${key}" play ${expect.frames} frames: pixel_patch insert or remove frames, then list ${expect.frames} names in animations.${key}.frames` });
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
  if (expect.loop !== undefined) for (const key of names) if (animations[key].loop !== expect.loop) problems.push({ file: `animations/${key}.png`, asked: expect.loop ? 'a loop' : 'one play', got: animations[key].loop ? 'a loop' : 'one play', fix: `pixel_patch { "set": "animations.${key}.loop", "value": ${expect.loop} }, then render again` });
  return { ok: !problems.length, delivered, ...(problems.length && { problems: problems.slice(0, 16) }), ...(notes.length && { notes }) };
}
