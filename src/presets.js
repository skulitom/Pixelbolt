// Node-side: the shipped examples an agent can start from instead of drawing an effect or a character from scratch.
// They are read from examples/ whenever they are asked for, so the listing always matches the folder. A preset is a
// top-level examples/*.fluid.json, *.fx.json, *.wave.json or *.poses.json source, or a plain recipe whose animations
// all loop (a coin spin, a flickering ember) and that no source there compiles to. Titles and notes come from the
// Fluid and Effects labs' lists where those have one; anything else is described from its own name and animations.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PixelError, renderProject } from './core.js';
import { resolveReferences } from './resolve.js';
import { compilePoses } from './authoring.js';
import { compileEffects } from './fx.js';
import { compileFluid } from './fluid.js';
import { compileWaves } from './wave.js';
import { EFFECT_PRESETS } from '../studio/effects-controls.js';
import { FLUID_PRESETS } from '../studio/fluid-controls.js';

export const PRESET_FOLDER = fileURLToPath(new URL('../examples/', import.meta.url));
const SOURCE = /^(.+)\.(fluid|fx|wave|poses)\.json$/;
const COMPILERS = { 'pixelforge-fluid': compileFluid, 'pixelforge-fx': compileEffects, 'pixelforge-wave': compileWaves, 'pixelforge-poses': compilePoses };
const TITLES = new Map([...FLUID_PRESETS.map(entry => [`fluid:${entry.file}`, entry]), ...EFFECT_PRESETS.map(entry => [`fx:${entry.file}`, entry])]);

// How to use the listing, and the one way to get fewer frames: a source's own `frames` is its simulation or timeline
// length, so lowering it cuts the effect off before it ends instead of sampling it.
export const PRESET_GUIDE = 'Start fire, smoke, explosions, splashes, spells and other effects from one of these rather than drawing them: pixel_compile {"preset": "<name>"} compiles one as it ships (pixelbolt compile --preset <name> --out <new.json> from a shell), and pixel_help {"topic": "preset", "name": "<name>"} returns its source to edit and compile. Fluid presets are simulations: a liquid preset (honey, slime, water) is liquid falling, pouring or splashing, not a character; for a character\'s squash, stretch or breathing idle, compile a pixelforge-poses source with one mass body and motions.idle. For fewer frames, never lower the source\'s frames (that stops the effect before it ends): compile the preset, then keep N evenly spaced frames with one pixel_patch call that removes the others and lists the kept ones in the animation (of F frames, keep frame floor(i x F / N) for i = 0 to N - 1; the quick start has the call for 8 of smoke-puff\'s 19).';

// The plain recipes are only known once read; each file is read once per call.
async function readJSON(file) {
  try { return JSON.parse(await readFile(path.join(PRESET_FOLDER, file), 'utf8')); } catch { return null; }
}
const loops = recipe => {
  if (!recipe || typeof recipe !== 'object' || recipe.format !== undefined || !Array.isArray(recipe.frames) || recipe.frames.length < 2) return false;
  const animations = recipe.animations && typeof recipe.animations === 'object' ? Object.values(recipe.animations) : [];
  return animations.length > 0 && animations.every(item => item && item.loop !== false && Array.isArray(item.frames) && item.frames.length > 1);
};

// Every preset file with its name: the file name without .json and the format word, or `<name>.<kind>` when two
// presets would share a name.
export async function presetEntries() {
  const files = (await readdir(PRESET_FOLDER, { withFileTypes: true })).filter(entry => entry.isFile() && entry.name.endsWith('.json')).map(entry => entry.name).sort();
  const sources = files.flatMap(file => { const match = SOURCE.exec(file); return match ? [{ file, base: match[1], kind: match[2] }] : []; });
  const compiledTo = new Set(sources.map(entry => entry.base)), recipes = [];
  for (const file of files) {
    if (SOURCE.test(file) || compiledTo.has(file.slice(0, -5))) continue;
    const document = await readJSON(file);
    if (loops(document)) recipes.push({ file, base: file.slice(0, -5), kind: 'recipe', document });
  }
  const entries = [...sources, ...recipes].sort((a, b) => (a.base < b.base ? -1 : a.base > b.base ? 1 : a.kind < b.kind ? -1 : 1));
  const count = new Map();
  for (const entry of entries) count.set(entry.base, (count.get(entry.base) ?? 0) + 1);
  return entries.map(entry => ({ ...entry, name: count.get(entry.base) > 1 ? `${entry.base}.${entry.kind}` : entry.base }));
}

// The preset a name means: its name, `<name>.<kind>` or its file name, ignoring case. Names are matched against the
// folder's own listing, never used as a path.
export async function findPreset(name, where = 'preset') {
  if (typeof name !== 'string' || !name.trim()) throw new PixelError(where, 'expected a preset name such as "smoke-puff"; pixel_help {"topic": "presets"} lists them');
  const wanted = name.trim().toLowerCase(), entries = await presetEntries();
  const found = entries.filter(entry => [entry.name, `${entry.base}.${entry.kind}`, entry.file].some(alias => alias.toLowerCase() === wanted));
  if (found.length === 1) return found[0];
  const shared = entries.filter(entry => entry.base.toLowerCase() === wanted);
  if (shared.length > 1) throw new PixelError(where, `"${name}" names ${shared.length} presets: use ${shared.map(entry => `"${entry.name}"`).join(' or ')}`);
  const near = entries.filter(entry => entry.name.toLowerCase().includes(wanted) || wanted.includes(entry.base.toLowerCase())).slice(0, 6);
  throw new PixelError(where, `no preset named "${name}"${near.length ? `; did you mean ${near.map(entry => `"${entry.name}"`).join(', ')}?` : '.'} pixel_help {"topic": "presets"} (pixelbolt presets in a shell) lists them`);
}

// A preset's source with the files it names (an fx symbol drawn from a pose source, say) inlined, so it compiles
// anywhere: as shipped, or edited and sent back as pixel_compile's source.
export async function loadPreset(entry) {
  const document = entry.document ?? await readJSON(entry.file);
  if (document === null) throw new PixelError('preset', `examples/${entry.file} could not be read`);
  const { document: resolved, files } = await resolveReferences(document, { baseDir: PRESET_FOLDER, root: PRESET_FOLDER });
  return { source: resolved, inlined: files.map(file => `examples/${path.relative(PRESET_FOLDER, file).split(path.sep).join('/')}`) };
}

// A plain recipe compiles to itself.
export function compilePreset(source) {
  const compile = COMPILERS[source?.format];
  return compile ? compile(source) : { recipe: source, warnings: [] };
}

const plays = animations => {
  const loops = animations.filter(([, item]) => item.loop).length;
  return loops === animations.length ? 'loop' : loops ? 'loops and one-shots' : 'one-shot';
};
const listNames = names => names.length <= 6 ? names.join(', ') : `${names.slice(0, 6).join(', ')} and ${names.length - 6} more`;
function about(entry, source, animations) {
  const titled = TITLES.get(`${entry.kind}:${entry.base}`), names = animations.map(([name]) => name);
  if (entry.kind === 'fluid') {
    const liquid = Object.values(source.effects ?? {}).some(effect => effect?.kind === 'liquid');
    const kind = liquid ? 'A simulated liquid, not a character.' : 'A simulated gas.';
    return titled ? `${titled.title}: ${titled.note.toLowerCase()}.${liquid ? ` ${kind}` : ''}` : kind;
  }
  if (titled) return `${titled.title}: ${titled.note.toLowerCase()}.`;
  if (entry.kind === 'poses') {
    const templates = [...new Set(Object.values(source.motions ?? {}).map(motion => motion?.template).filter(Boolean))];
    return templates.length ? `A rigged figure whose motion templates make ${listNames(templates)}.` : `Posed parts: ${listNames(names)}.`;
  }
  if (entry.kind === 'fx') return `Particles and effect shapes: ${listNames(names)}.`;
  if (entry.kind === 'wave') return `A looping wave pattern: ${listNames(names)}.`;
  return `A hand-drawn recipe: ${listNames(names)}.`;
}

// One line of facts per preset, from compiling it: what an agent compares with the request before picking one.
async function summarize(entry) {
  const { source } = await loadPreset(entry), recipe = compilePreset(source).recipe, project = renderProject(recipe);
  const colors = new Set();
  for (const frame of project.frames) for (let i = 0; i < frame.data.length; i += 4) if (frame.data[i + 3]) colors.add(((frame.data[i] << 24) | (frame.data[i + 1] << 16) | (frame.data[i + 2] << 8) | frame.data[i + 3]) >>> 0);
  const animations = Object.entries(project.animations), shown = animations.slice(0, 12);
  return {
    name: entry.name, kind: entry.kind, file: `examples/${entry.file}`, for: about(entry, source, animations),
    size: `${project.width}x${project.height}`, frames: project.frames.length, plays: plays(animations), colors: colors.size,
    animations: Object.fromEntries(shown.map(([name, item]) => [name, `${item.frames.length} frames, ${item.loop ? 'loop' : 'one-shot'}`])),
    ...(animations.length > shown.length && { moreAnimations: animations.length - shown.length })
  };
}

// The whole listing. A preset that fails to compile is listed with its error, so one broken file hides nothing else.
export async function listPresets() {
  const presets = [];
  for (const entry of await presetEntries()) {
    try { presets.push(await summarize(entry)); }
    catch (error) { presets.push({ name: entry.name, kind: entry.kind, file: `examples/${entry.file}`, error: error.message }); }
  }
  return { guide: PRESET_GUIDE, presets };
}
