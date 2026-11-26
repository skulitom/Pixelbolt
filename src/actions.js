// Shared Node-side action layer for the CLI (bin/pixelbolt.js) and the MCP server (src/mcp.js).
// Each action runs one resolved operation in memory — validate, compile, patch, inspect, render, scene view,
// import or sequence — and returns structured results (rendered projects, bundles, GIFs, images, summaries, checks
// and warnings) without touching argv, stdio, revision stores or output paths. `call` ('cli' or 'mcp') shapes option
// names in error messages and check fixes so both interfaces stay identical in behavior while keeping their own wording.
import path from 'node:path';
import { PixelError, isObject, renderProject, inspectProject, stackViews, paletteUse, compareProjects, briefDiagnostics, briefComparison, stillsHaveNoAnimation, largestScale, columnsOfCall } from './core.js';
import { patchRecipe } from './patch.js';
import { applyOverlay } from './overlays.js';
import { compilePoses, compileAutotile } from './authoring.js';
import { inspectMotion } from './motion.js';
import { inspectWalks } from './walk-scan.js';
import { inspectPoseSheet, compileStackSlices } from './stack.js';
import { createBundle, describeAnimations } from './export.js';
import { animationGIF, STILLS_GIF_NOTE } from './gif.js';
import { readExpect, checkDelivery } from './check.js';
import { createSequence, createSceneSequence, createBodiesSequence, createPowderSequence, frameGrid } from './sequence.js';
import { readSize, resizeRecipe, resizeWarning, resizeMargins, keepFrames, keepAnimations } from './resize.js';
import { tilemapOf } from './autotile.js';
import { testMapScale } from './terrain.js';
import { prepareScene, renderScene, sceneImage, sceneColors } from './scene.js';
import { importPNG } from './import.js';
import { importCutoutPNG } from './cutout-import.js';
import { compilePreset, COMPILERS } from './presets.js';

// One render's GIFs hold 67,108,864 pixels in all, a GIF frame per played frame: checked before any is encoded,
// so the scale named fits every animation of the export.
export const RENDER_GIF_PIXELS = 67108864;

const FORMAT_LIST = 'pixelforge-poses, pixelforge-autotile, pixelforge-fx, pixelforge-fluid, pixelforge-wave, pixelforge-crystal, pixelforge-powder, pixelforge-bodies, pixelforge-stack or pixelforge-normals';
// Option name in an error message for CLI (`--size`) vs MCP (`size`).
const optionName = (call, key) => (call === 'cli' ? `--${key}` : key);
const refuse = (call, key, message) => { throw call === 'cli' ? new Error(message) : new PixelError(key, message); };

// Shared project summary fields returned by validate, inspect, compile and render.
export const projectSummary = (project, recipe) => ({
  name: project.name,
  width: project.width,
  height: project.height,
  frames: project.frames.length,
  ...describeAnimations(project, recipe),
  warnings: project.warnings,
  ...(project.clipping && { clipping: project.clipping }),
  ...(project.clippingOmitted && { clippingOmitted: project.clippingOmitted })
});

// What an imported PNG is named when no explicit name is given, if its basename is a valid recipe name.
export const nameFromFile = file => path.basename(file).replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^[^A-Za-z]+/, '').slice(0, 64) || undefined;

// Validates and renders a recipe, optionally checking frame durations against a video frame rate.
export function validateAction(recipe, { fps } = {}) {
  const project = renderProject(recipe);
  return {
    project,
    summary: projectSummary(project, recipe),
    ...(fps !== undefined && { frameGrid: frameGrid(project, fps) })
  };
}

// Compiles a source format (or shipped preset) to a recipe, applying optional animation filter, frame thinning,
// canvas resize and autotile test-map rendering.
export function compileAction(document, { preset, slices, frames, animation, size, compiler, call = 'mcp', formatCheck = false, withTestMap = false } = {}) {
  const format = document?.format;
  if (formatCheck && preset === undefined && !Object.hasOwn(COMPILERS, format ?? '')) throw new PixelError('source.format', `expected ${FORMAT_LIST}`);
  if (slices !== undefined && typeof slices !== 'boolean') throw new PixelError('slices', 'expected true or false');
  if (slices && format !== 'pixelforge-stack') {
    refuse(call, 'slices', call === 'cli' ? '--slices writes the slices of a sprite stack source (a pixelforge-stack), to stack at run time' : 'slices are a sprite stack\'s (a pixelforge-stack source), to stack at run time');
  }
  if (slices) {
    for (const [key, value] of [['frames', frames], ['animation', animation], ['size', size]]) {
      if (value !== undefined) refuse(call, key, `${optionName(call, key)} shapes baked frames; a slice sheet is the stack's slices as they are, so ${call === 'cli' ? 'omit it with --slices' : 'leave it out with slices'}`);
    }
  }
  const compile = compiler ?? (preset !== undefined ? compilePreset : COMPILERS[format] ?? compilePoses);
  const tileSet = compiler === compileAutotile || format === 'pixelforge-autotile';
  const made = slices ? compileStackSlices(document)
    : compile === compilePreset || compile === COMPILERS['pixelforge-fx']
      ? compilePreset(document, { frames, animation, ...(call === 'cli' && { animationPath: '--animation' }) })
      : compile(document);
  let recipe = made.recipe, metadata = made.metadata, kept, resized, cut;
  const warnings = [...(made.warnings ?? [])], preview = made.preview;
  if (animation !== undefined) {
    if (tileSet) refuse(call, 'animation', `${optionName(call, 'animation')} keeps animations, and a tile set has none to choose from`);
    recipe = keepAnimations(recipe, animation, optionName(call, 'animation')).recipe;
  }
  if (frames !== undefined) {
    if (tileSet) refuse(call, 'frames', `${optionName(call, 'frames')} thins animations, and the frames of a tile set are its tiles`);
    const thinned = keepFrames(recipe, frames, optionName(call, 'frames'));
    recipe = thinned.recipe; kept = thinned.kept; warnings.push(...thinned.notes);
    if (metadata) metadata = { ...metadata, kept };
  }
  if (size !== undefined) {
    if (tileSet) refuse(call, 'size', call === 'cli' ? '--size: a tile set\'s size is its tile, set in the source' : 'a tile set\'s size is its tile, set in the source');
    const moved = resizeRecipe(recipe, size, optionName(call, 'size'));
    recipe = moved.recipe; resized = moved.resized; cut = resizeWarning(resized, [recipe.width, recipe.height]);
    if (cut) warnings.push(cut);
    if (metadata) metadata = { ...metadata, resized };
  }
  const project = renderProject(recipe);
  const madeSummary = { name: project.name, width: project.width, height: project.height, frames: project.frames.length, ...describeAnimations(project, recipe) };
  const margins = resized && resizeMargins(resized, [project.width, project.height]);
  const testMap = withTestMap && preview ? inspectProject(renderProject(preview), { scale: testMapScale(preview) }) : null;
  const tilemap = preview ? tilemapOf(recipe, metadata) : null;
  const projectWarnings = project.warnings.filter(text => !(cut && text.startsWith('Some drawing falls outside the canvas')));
  return { recipe, project, made: madeSummary, metadata, preview, testMap, tilemap, resized, margins, kept, warnings, projectWarnings, cut };
}

// Applies targeted edits or a saved overlay to a resolved recipe, renders before and after, and compares them.
export function patchAction(base, { changes, overlay } = {}) {
  const before = renderProject(base);
  const applied = overlay !== undefined ? applyOverlay(base, overlay) : patchRecipe(base, changes);
  const { recipe, edits } = applied, after = renderProject(recipe);
  const { image, ...report } = compareProjects(before, after);
  return { recipe, edits, rebased: Boolean(applied.rebased), before, after, image, report, comparison: briefComparison(report) };
}

// Renders a recipe and runs one of the four inspection modes (walks, poseSheet, motion, or contact sheet),
// with optional beside stacking, reference comparison, diagnostics briefing and palette usage report.
export function inspectAction(recipe, { layers, walks = false, poseSheet, motion, inspection = {}, metadata, reference, beside = [], palette = false, full = false, call = 'mcp', label, formatBesideName, formatBesideError } = {}) {
  const layerOptions = layers === undefined ? {} : { layers };
  const owners = walks || inspection.view === 'parts' || Boolean(motion) || palette === true;
  const project = renderProject(recipe, { ...layerOptions, ...(owners && { owners: true }) });
  const comparison = reference === undefined ? null : compareProjects(renderProject(reference, layerOptions), project);
  const share = beside.length ? { sheets: Math.min(9, beside.length + 1) } : undefined;
  let view;
  if (walks) view = inspectWalks(project, inspection, metadata, recipe);
  else if (poseSheet !== undefined) view = inspectPoseSheet(project, poseSheet, inspection);
  else if (motion) view = inspectMotion(project, { ...motion, metadata }, recipe);
  else view = inspectProject(project, inspection, share);
  let drawn = view;
  if (beside.length) {
    if (inspection.native || inspection.grid) {
      refuse(call, 'beside', call === 'cli' ? '--beside draws several recipes in one sheet; --native and --grid read one recipe at a time' : 'beside draws several recipes in one sheet; native and grid read one recipe at a time');
    }
    const others = [];
    for (const item of beside) {
      const other = renderProject(item.recipe, layerOptions);
      let peer;
      try { peer = inspectProject(other, inspection, share); } catch (error) { throw formatBesideError ? formatBesideError(item, other, error) : error; }
      others.push({ ...peer, name: formatBesideName ? formatBesideName(item, other) : (item.name ?? other.name) });
    }
    drawn = stackViews([{ ...view, name: label ?? project.name }, ...others]);
  }
  if (drawn.diagnostics && !full) drawn.diagnostics = briefDiagnostics(drawn.diagnostics);
  return { project, view, drawn, comparison, ...(palette === true && { palette: paletteUse(project) }) };
}

// Prepares an export bundle, optional normal pass, optional GIFs (checking the 64 MP per-render GIF budget
// before encoding any), optional contact-sheet view and delivery check — all in memory before writing files.
export async function renderAction(sourceRecipe, { scale, columns, normal: normalDocument, animation, gif, gifScalePath, expect: rawExpect, call = 'mcp', checkStillsAnimation = false, previewView = false } = {}) {
  const expect = rawExpect === undefined ? undefined : readExpect(rawExpect, sourceRecipe);
  if (columns !== undefined && sourceRecipe?.sheet?.trim === true) {
    refuse(call, 'columns', `${optionName(call, 'columns')} lays the sheet out as a grid, and this recipe's sheet.trim packs each frame by its visible bounds, which ignores columns; ${call === 'cli' ? 'patch' : 'pixel_patch'} {"set": "sheet.trim", "value": false} first`);
  }
  const recipeScale = Number.isInteger(sourceRecipe?.sheet?.scale) ? sourceRecipe.sheet.scale : 1;
  const forExport = { ...(scale !== undefined && { scale }), ...(columns !== undefined && { columns: Math.min(columns, 256) }) };
  // Only a sheet that is an object or missing takes export overrides; any other is left for the renderer to refuse.
  const recipe = Object.keys(forExport).length && isObject(sourceRecipe) && (sourceRecipe.sheet === undefined || isObject(sourceRecipe.sheet))
    ? { ...sourceRecipe, sheet: { ...sourceRecipe.sheet, ...forExport } }
    : sourceRecipe;
  const normal = normalDocument === undefined ? undefined : normalDocument?.format === 'pixelforge-normals' ? COMPILERS['pixelforge-normals'](normalDocument).recipe : normalDocument;
  const bundle = await createBundle(recipe, { normal }).catch(error => { throw columns === undefined ? error : columnsOfCall(error, optionName(call, 'columns')); });
  if (checkStillsAnimation && animation !== undefined && bundle.project.stills) throw new PixelError('animation', stillsHaveNoAnimation('choose'));
  const view = previewView ? inspectProject(bundle.project, { ...(animation !== undefined && { animation }), maxCells: 256 }) : null;
  if (columns !== undefined && columns > bundle.project.frames.length) {
    const count = bundle.project.frames.length;
    refuse(call, 'columns', call === 'cli'
      ? `--columns expects a whole number from 1 to the frame count, ${count}: --columns ${count} is a one-row strip`
      : `expected a whole number from 1 to the frame count, ${count}: columns ${count} is a one-row strip`);
  }
  const wantsGif = gif !== undefined;
  if (wantsGif && (gif === null || typeof gif !== 'object' || Array.isArray(gif))) throw new PixelError('gif', 'expected an object such as {} or { "scale": 8 }');
  if (wantsGif && bundle.project.stills) bundle.project.warnings.push(STILLS_GIF_NOTE);
  if (wantsGif && !bundle.project.stills) {
    const at = gif.scale ?? 1, played = Object.values(bundle.project.animations).reduce((sum, item) => sum + item.frames.length, 0) * bundle.project.width * bundle.project.height;
    if (Number.isInteger(at) && at >= 1 && at <= 16 && played * at * at > RENDER_GIF_PIXELS) {
      const fits = largestScale(played, RENDER_GIF_PIXELS, at);
      const pathKey = call === 'cli' ? (gifScalePath ?? (gif.scale === undefined ? '--gif' : '--gif-scale')) : 'gif';
      const hint = fits ? `${call === 'cli' ? '--gif-scale' : 'gif.scale'} ${fits} is the largest that fits` : 'shorten the animations';
      throw new PixelError(pathKey, `the GIFs of every animation at scale ${at} pass the 67,108,864 pixels one render's GIFs hold; ${hint}`);
    }
  }
  const gifs = wantsGif && !bundle.project.stills ? Object.keys(bundle.project.animations).map(name => animationGIF(bundle.project, name, gif)) : [];
  const gifNotes = gifs.flatMap(item => item.notes.map(text => `${item.animation}: ${text}`)).slice(0, 16);
  const check = checkDelivery(bundle.project, { recipe, gifs: wantsGif && !bundle.project.stills ? gifs : undefined, expect, animation, call, scale, recipeScale });
  return { recipe, bundle, view, gifs, gifNotes, check };
}

// Renders one frame and enlarged review image of a resolved scene document.
export function sceneViewAction(document, { time = 0, lit = true, density = false, view = 'color', scale, guides } = {}) {
  const scene = prepareScene(document);
  const frame = renderScene(scene, { time, lit, density, depth: view === 'depth' });
  const resolvedScale = scale ?? Math.max(1, Math.min(8, Math.floor(768 / Math.max(frame.width, frame.height))));
  const image = sceneImage(frame, { mode: view, scale: resolvedScale, ...(guides !== undefined && { guides }) });
  const summary = {
    name: document.name,
    width: frame.width,
    height: frame.height,
    duration: scene.duration,
    time,
    scale: resolvedScale,
    colors: sceneColors(frame.data),
    placements: frame.placements.length,
    ...(frame.depth && { depth: frame.depth }),
    ...(frame.lights && { lights: frame.lights }),
    ...(frame.shadows && { shadows: frame.shadows }),
    ...(frame.camera && { camera: frame.camera }),
    ...(frame.haze && { haze: frame.haze }),
    warnings: frame.warnings
  };
  return { scene, frame, scale: resolvedScale, image, summary };
}

// Imports a PNG buffer as an ordinary recipe or (with cutout) an editable pose source + compiled recipe.
export function importAction(bytes, { name, file, atlas, frame, padding, frames, cutout, framePath = 'frame' } = {}) {
  const readPNG = cutout === undefined ? importPNG : importCutoutPNG;
  const resolvedName = name ?? (file ? nameFromFile(file) : undefined);
  return readPNG(bytes, {
    ...(resolvedName !== undefined && { name: resolvedName }),
    ...(atlas !== undefined && { atlas }),
    ...(frame !== undefined && { frame: readSize(frame, framePath) }),
    ...(padding !== undefined && { padding }),
    ...(frames !== undefined && { frames }),
    ...(cutout !== undefined && { cutout })
  });
}

// Builds a numbered-PNG video frame sequence for a recipe, source format or scene.
export function sequenceAction(document, settings, { stream = false, budget, command, animationPath } = {}) {
  const format = document?.format;
  if (format === 'pixelforge-bodies') return createBodiesSequence(document, settings, { ...(stream && { stream }), ...(budget !== undefined && { budget }), ...(command !== undefined && { command }) });
  if (format === 'pixelforge-powder') return createPowderSequence(document, settings, { ...(stream && { stream }), ...(budget !== undefined && { budget }), ...(command !== undefined && { command }) });
  if (format === 'pixelforge-scene') return createSceneSequence(prepareScene(document), document.name, settings);
  const compiled = format === 'pixelforge-fx'
    ? compilePreset(document, { animation: settings.animation, ...(animationPath && { animationPath }) }).recipe
    : Object.hasOwn(COMPILERS, format ?? '') ? COMPILERS[format](document).recipe : document;
  return createSequence(renderProject(compiled), settings);
}
