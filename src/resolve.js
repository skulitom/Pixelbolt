// Node-side reference resolution. The renderer only sees inline data; this module inlines shared palette files
// (`palette: { "$ref": "palette.json", ...local entries }`) and scene asset files or saved revisions. Relative
// paths resolve from `baseDir`; when `root` is set (the MCP server), every referenced file must stay inside it.
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { PixelError, inlineSharedPalette } from './core.js';

const fail = (where, message) => { throw new PixelError(where, message); };
const within = (parent, child) => { const relative = path.relative(parent, child); return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
/**
 * Throws a PixelError at `where` unless `file` is inside `root`, both as written and once links are followed, so a
 * symbolic link or junction under the root can't lead out of it. A file that doesn't exist is left for its read to
 * report.
 */
export async function assertInside(file, root, where, message = `must stay inside ${path.resolve(root)}`) {
  if (!within(path.resolve(root), path.resolve(file))) fail(where, message);
  const real = await realpath(file).catch(() => null);
  if (real !== null && !within(await realpath(root), real)) fail(where, `${message}; ${path.resolve(file)} is a link that leads out of it`);
}
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
async function readJSON(file, where) {
  let text;
  try { text = await readFile(file, 'utf8'); } catch (error) { fail(where, `could not read ${file} (${error.code ?? error.message})`); }
  try { return JSON.parse(text.replace(/^﻿/, '')); } catch { fail(where, `${file} is not valid JSON`); }
}
async function locate(reference, baseDir, root, where) {
  if (typeof reference !== 'string' || !reference.trim()) fail(where, 'expected a relative file path');
  const file = path.resolve(baseDir, reference);
  if (root !== undefined) await assertInside(file, root, where, `references must stay inside ${path.resolve(root)}`);
  return file;
}
// A shared palette file is either a flat map of names to colours or any JSON document with a `palette` map, which may
// also list `ramps` (palette keys from dark to light) for the recipes and pose sources that link it.
async function sharedPalette(reference, baseDir, context, where) {
  const file = await locate(reference, baseDir, context.root, where), loaded = await readJSON(file, where);
  const palette = isObject(loaded?.palette) ? loaded.palette : loaded;
  if (!isObject(palette) || Object.values(palette).some(value => typeof value !== 'string')) fail(where, `${reference} must contain a palette object of colour strings`);
  if (Object.hasOwn(palette, '$ref')) fail(where, 'nested palette references are not supported');
  context.files.add(file);
  return { palette, ramps: isObject(loaded?.palette) && loaded.ramps !== undefined ? loaded.ramps : null };
}
async function resolvePalette(document, baseDir, context, where) {
  if (!isObject(document) || !isObject(document.palette) || !Object.hasOwn(document.palette, '$ref')) return document;
  const reference = document.palette.$ref, file = await sharedPalette(reference, baseDir, context, `${where}.palette.$ref`);
  // A recipe or pose source without ramps of its own takes the shared file's; the other sidecar sources compile to
  // recipes without them.
  const resolved = inlineSharedPalette(document, file), inherited = resolved.ramps !== document.ramps;
  // `ramps` are set when the document took the file's; `sharedRamps` are the file's own, for the studio, which draws the
  // recipe as written with the file and so inlines it again after every edit.
  context.palettes.push({ where, reference, shared: file.palette, ...(inherited && { ramps: file.ramps }), ...(file.ramps && { sharedRamps: file.ramps }) });
  return resolved;
}
// A pixelforge-normals source names the colour recipe it derives from: a file, a saved revision or an inline recipe.
async function loadRecipe(entry, baseDir, context, where) {
  if (typeof entry === 'string') {
    const file = await locate(entry, baseDir, context.root, where);
    context.files.add(file);
    return resolvePalette(await readJSON(file, where), path.dirname(file), context, where);
  }
  if (isObject(entry) && Object.keys(entry).length === 1 && typeof entry.revision === 'string') {
    if (!context.revisions) fail(where, 'revision references are only available through the MCP server');
    return resolvePalette(await context.revisions(entry.revision), baseDir, context, where);
  }
  return resolvePalette(entry, baseDir, context, where);
}
async function resolveScene(scene, baseDir, context) {
  if (!isObject(scene.assets)) return scene;
  // A theme: a palette file for the whole scene or for one asset overrides the keys the recipes share.
  const theme = async (value, where) => typeof value === 'string' ? (await sharedPalette(value, baseDir, context, where)).palette : value;
  if (scene.palette !== undefined) scene = { ...scene, palette: await theme(scene.palette, 'scene.palette') };
  const assets = {};
  for (const [id, value] of Object.entries(scene.assets)) {
    const where = `scene.assets.${id}`;
    const load = (entry, key) => loadRecipe(entry, baseDir, context, key ? `${where}.${key}` : where);
    if (isObject(value) && (value.recipe !== undefined || value.normal !== undefined || value.emissive !== undefined) && value.version === undefined) {
      assets[id] = {};
      for (const key of ['recipe', 'normal', 'emissive']) if (value[key] !== undefined) assets[id][key] = await load(value[key], key);
      for (const key of Object.keys(value)) if (!['recipe', 'normal', 'emissive'].includes(key)) assets[id][key] = key === 'palette' ? await theme(value.palette, `${where}.palette`) : value[key];
    } else assets[id] = await load(value);
  }
  return { ...scene, assets };
}
/**
 * Returns the document with references inlined, plus the files it read. Works for recipes, pose sources,
 * autotile templates, effect and fluid sources, normal sources and scenes. `revisions(id)` supplies saved recipes for
 * `{ "revision": id }` scene assets and normal sources.
 */
export async function resolveReferences(document, { baseDir = process.cwd(), root, revisions } = {}) {
  const context = { root, revisions, files: new Set(), palettes: [] };
  const sidecars = { 'pixelforge-poses': 'poses', 'pixelforge-autotile': 'autotile', 'pixelforge-fx': 'fx', 'pixelforge-fluid': 'fluid', 'pixelforge-wave': 'wave' };
  const resolved = document?.format === 'pixelforge-scene' ? await resolveScene(document, baseDir, context)
    : document?.format === 'pixelforge-normals' && document.recipe !== undefined ? { ...document, recipe: await loadRecipe(document.recipe, baseDir, context, 'normals.recipe') }
      : await resolvePalette(document, baseDir, context, sidecars[document?.format] ?? 'project');
  return { document: resolved, files: [...context.files], palettes: context.palettes };
}
/**
 * After editing a resolved recipe, restore its palette reference: entries identical to the shared file are dropped
 * again and anything added or changed stays local. Keeps edited recipes linked to their shared palette.
 */
export function restorePaletteReference(original, edited, resolution) {
  const link = resolution.palettes.find(entry => entry.where === 'project');
  if (!link || !isObject(original?.palette) || !Object.hasOwn(original.palette, '$ref') || !isObject(edited?.palette)) return edited;
  const local = Object.fromEntries(Object.entries(edited.palette).filter(([key, value]) => !(Object.hasOwn(link.shared, key) && link.shared[key] === value)));
  const removed = Object.keys(link.shared).filter(key => !Object.hasOwn(edited.palette, key));
  if (removed.length) fail('project.palette', `the edit removed shared palette entries (${removed.join(', ')}); edit ${link.reference} instead`);
  const restored = { ...edited, palette: { $ref: original.palette.$ref, ...local } };
  // Ramps taken from the shared file stay there unless the edit changed them.
  if (link.ramps && JSON.stringify(edited.ramps) === JSON.stringify(link.ramps)) delete restored.ramps;
  return restored;
}
