import { loadEngine, renderRecipe, framesDigest, sceneSheet, assertInline } from './render.js';
import { encodePNG } from './png.js';
import { checkVersion, recipeKind, RECIPE_LIMIT, shareLink, readShareLink, embedRecipe, readEmbeddedRecipe } from './share.js';
import { engineBase, examplePath, inlineExample, jsonErrorLocation, safeName } from './lib.js';

let loadedBase, loadedEngine, cached;
const encoder = new TextEncoder();
function checkText(text) {
  if (typeof text !== 'string') throw new Error('Expected recipe text.');
  if (text.length > RECIPE_LIMIT || encoder.encode(text).length > RECIPE_LIMIT) throw new Error(`The recipe is larger than ${RECIPE_LIMIT.toLocaleString('en')} bytes.`);
  return text;
}
function sourceText(document) {
  const pretty = JSON.stringify(document, null, 2);
  // Whitespace must not stop a compact link or PNG recipe from reopening near the input limit.
  if (pretty.length <= RECIPE_LIMIT && encoder.encode(pretty).length <= RECIPE_LIMIT) return pretty;
  return checkText(JSON.stringify(document));
}
function parse(text) {
  checkText(text);
  const clean = text.replace(/^\uFEFF/, '');
  try { return JSON.parse(clean); }
  catch (error) {
    const location = jsonErrorLocation(clean, error);
    // The line and column lead the message, so drop the parser's own position wording (V8 and SpiderMonkey).
    const detail = location.line ? location.message.replace(/^JSON\.parse:\s*/, '').replace(/\s*(?:in JSON\s+)?at position \d+(?:\s*\(line \d+ column \d+\))?/i, '').replace(/\s*at line \d+ column \d+ of the JSON data/i, '') : location.message;
    const text = detail.charAt(0).toUpperCase() + detail.slice(1);
    throw Object.assign(new Error(`${location.line ? `Line ${location.line}${location.column ? `, column ${location.column}` : ''}: ` : ''}${text}`), { line: location.line });
  }
}
async function engineFor(version, override) {
  checkVersion(version);
  const base = engineBase(version, override);
  if (loadedBase !== base) {
    loadedEngine = null; loadedBase = null;
    try { loadedEngine = await loadEngine(base); loadedBase = base; }
    catch { throw new Error(override ? 'The local test engine could not be loaded. Check the engine URL and static server.' : `Pixelbolt ${version} could not be loaded from jsDelivr. Is it a published version?`); }
  }
  return loadedEngine;
}
async function render(text, version, override) {
  const source = parse(text), base = engineBase(version, override);
  recipeKind(source); assertInline(source);
  if (cached?.text === text && cached.version === version && cached.base === base) return cached;
  const engine = await engineFor(version, override), result = renderRecipe(engine, source);
  cached = { text, version, base, source, engine, result, digest: await framesDigest(result.frames) };
  return cached;
}
const jsonFile = (name, value) => ({ name, type: 'application/json', data: encoder.encode(JSON.stringify(value, null, 2) + '\n') });

// Exported for Node tests; the worker message adapter below supplies transfer lists, never engine objects.
export async function handleRequest(request, onSource = () => {}) {
  const { type, override } = request;
  let { text, version } = request;
  checkVersion(version);
  if (type === 'link') {
    const opened = await readShareLink(request.hash);
    text = sourceText(opened.recipe); version = opened.version;
  } else if (type === 'open') {
    if (request.png) {
      const opened = await readEmbeddedRecipe(new Uint8Array(request.png));
      if (!opened) throw new Error('This PNG carries no Pixelbolt recipe.');
      text = sourceText(opened.recipe); version = opened.version;
    } else { parse(text); }
  } else if (type === 'example') {
    const base = new URL('../examples/', engineBase(version, override)), reads = new Map();
    const read = async file => {
      examplePath(file);
      if (!reads.has(file)) reads.set(file, (async () => {
        const response = await fetch(new URL(file, base), { credentials: 'omit', redirect: 'error' });
        if (!response.ok) throw new Error(`Could not load example ${file}: HTTP ${response.status}.`);
        return parse(await response.text());
      })());
      return reads.get(file);
    };
    const file = examplePath(request.file), source = await inlineExample(await read(file), file, read);
    text = sourceText(source);
  }
  checkText(text);
  if (['link', 'open', 'example'].includes(type)) onSource({ text, version });
  if (type === 'share') return { link: await shareLink(parse(text), version, { base: request.base }) };
  if (type === 'export' && request.export === 'recipe') {
    // Indented when that still fits the reopen limit, compact otherwise, so a downloaded recipe always reopens.
    const source = parse(text), kind = recipeKind(source), body = sourceText(source), bytes = encoder.encode(body);
    const data = bytes.length < RECIPE_LIMIT ? encoder.encode(`${body}\n`) : bytes;
    return { files: [{ name: `${safeName(source.name ?? source.recipe?.name)}.${kind === 'project' ? 'pixel' : kind}.json`, type: 'application/json', data }], warnings: [] };
  }
  const item = await render(text, version, override), { result, source, engine } = item;
  if (type !== 'export') {
    const { project, ...preview } = result;
    // Retain the worker's pixels for export; only the copies cross the boundary and are detached.
    return { ...preview, version, digest: item.digest, frames: result.frames.map(frame => ({ ...frame, data: frame.data.slice() })) };
  }
  const name = safeName(result.name), files = [], warnings = [];
  // embedRecipe refuses a recipe too large for its reader, so every PNG written here reopens.
  const pngFile = async (pixels, filename) => ({ name: filename, type: 'image/png', data: await embedRecipe(await encodePNG(pixels.data, pixels.width, pixels.height), source, version) });
  if (request.export === 'frame') {
    const frame = result.frames[request.frame];
    if (!frame) throw new Error('Choose an available frame.');
    const scale = request.scale;
    files.push(await pngFile({ width: result.width * scale, height: result.height * scale,
      data: engine.core.scalePixels(frame.data, result.width, result.height, scale) }, `${name}-${safeName(frame.name)}.png`));
  } else if (request.export === 'sheet' || request.export === 'atlas') {
    if (request.export === 'atlas' && !result.project) throw new Error('Scenes are sampled images and have no sprite atlas metadata. Download the sheet instead.');
    const atlas = result.project ? engine.core.buildAtlas(result.project) : sceneSheet(result);
    files.push(await pngFile(atlas, `${name}.png`));
    if (request.export === 'atlas') files.push(jsonFile(`${name}.atlas.json`, atlas.metadata));
  } else if (request.export === 'gif') {
    const project = result.project ?? { ...result, palette: {} };
    const gif = engine.gif.animationGIF(project, request.animation, { scale: request.scale, background: 'transparent' });
    files.push({ name: `${name}-${safeName(request.animation)}.gif`, type: 'image/gif', data: gif.data });
    if (gif.notes?.length) warnings.push(...gif.notes);
    else if (gif.partialAlpha) warnings.push(`${gif.partialAlpha} partly transparent pixels became fully transparent or opaque; GIF has no partial transparency.`);
    // Older engines report delays but may not provide the newer prose notes.
    if (!gif.notes) {
      const frames = project.animations[request.animation].frames;
      if (frames.some(i => project.frames[i].duration < 20 || project.frames[i].duration % 10)) warnings.push('GIF rounds frame durations to 10 ms steps, with a 20 ms minimum.');
    }
  } else throw new Error('Unknown export.');
  return { files, warnings };
}

if (typeof self !== 'undefined') self.onmessage = async ({ data: request }) => {
  try {
    const result = await handleRequest(request, source => self.postMessage({ id: request.id, source }));
    const buffers = result.frames?.map(frame => frame.data.buffer) ?? result.files?.map(file => file.data.buffer) ?? [];
    self.postMessage({ id: request.id, result }, [...new Set(buffers)]);
  } catch (error) { self.postMessage({ id: request.id, error: { message: error.message, name: error.name, path: error.path, line: error.line } }); }
};
