#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inspectMotion } from '../src/motion.js';
import { expandPoses } from '../src/authoring.js';
import { compileWaves } from '../src/wave.js';
import { compileCrystals } from '../src/crystal.js';
import { compilePowder } from '../src/powder.js';
import { compileBodies } from '../src/bodies.js';
import { readExpect, checkDelivery, briefCheck } from '../src/check.js';
import { resizeRecipe, resizeWarning, keepFrames } from '../src/resize.js';
import { embedBundleRecipe, sameFiles, outputSummary, withRates } from '../src/export.js';
import { shareLink, readEmbeddedRecipe, recipeKind } from '../src/share.js';
import { PRESET_FOLDER, listPresets, briefListing, findListing, namedLike, presetWords, presetEntries, findPreset, loadPreset, compilePreset, presetNext } from '../src/presets.js';
import { renderProject, animationGIF, createSequence, frameGrid, createSceneSequence, createBodiesSequence, figuresSummary, prepareScene, renderScene, sceneImage, createBundle, writeBundle, inspectProject, briefDiagnostics, briefCells, errorReply, compareProjects, patchRecipe, encodePNG, compilePoses, draftViews, compileAutotile, compileEffects, compileFluid, compileNormals, formatJSON, createSceneBundle, createOverlay, applyOverlay, importPNG, resolveReferences, restorePaletteReference, testMapScale } from '../src/index.js';

// A reader that stops early (`| head -1`) closes the pipe: stop quietly, as other command-line tools do. Commands print
// their reply after writing their files, so only the rest of the reply is lost.
process.stdout.on('error', error => {
  if (error.code !== 'EPIPE') throw error;
  process.exit(process.exitCode ?? 0);
});

const HELP = `Pixelbolt — text to pixels, without dependencies

  pixelbolt init [file.json]               Create an editable example
  pixelbolt help [topic] [section]         One reference, as MCP pixel_help gives it: quickstart, guide, workflow,
                                           craft, schema, example, presets, preset <name>, poses, scenes, autotile, fx,
                                           fluid, wave, crystal, powder, bodies or normals. guide, workflow and craft list
                                           their sections first; name one to print only it: help craft "Characters"
  pixelbolt validate <file.json|-> [--fps 30]
                                           Validate and describe a project; --fps lists durations off that video frame grid
  pixelbolt inspect <file.json|-> [--out sheet.png] [--grid]
                                           See every frame; writes only --out
  pixelbolt patch <file.json|-> --changes <changes.json|-> [--out new.json] [--image diff.png]
                                           Preview edits; writes only --out and --image
  pixelbolt render <file.json|-> --out dir Export a complete asset bundle
                                           --expect '{"width":32,"height":32,"frames":8}' (or a .json file) checks it
                                           against the request; --animation <name> checks only that animation
  pixelbolt share <file.json|->           Print a playground link for the resolved recipe
  pixelbolt gif <file.json|-> --out anim.gif [--animation name] [--scale 1-16] [--background color]
                                           Share one animation as a GIF; writes only --out
  pixelbolt gif --preset <name> --out anim.gif [--size 32x32] [--frames 8] [--scale 8] [--sheet frames.png]
                                           A shipped preset straight to its GIF, in one call: --size and --frames as
                                           in compile, --sheet also writes the frames as a contact sheet to look at
                                           (all three work with a recipe file too)
  pixelbolt gif-frames <folder> --fps 25 --out loop.gif [--loops 0] [--background color] [--prefix name_]
                                           A GIF from numbered PNG frames (name_0001.png ...); writes only --out
  pixelbolt sequence <recipe|source|scene.json> --out folder --fps 30 [--size 1080p|WxH] [--scale n]
                    [--fit contain|cover] [--align center] [--offset x,y] [--background color] [--animation name]
                    [--loops n | --seconds s] [--step n]
                                           Numbered PNG frames for a video editor, at a constant frame rate
  pixelbolt compile <source.json> --out recipe.json [--metadata meta.json]
                                           Build a recipe from authored poses, an autotile template, particle effects,
                                           a wave source (looping interference and portals), a fluid source (smoke, fire,
                                           explosions, magic and water), a crystal source (crystals, geodes and
                                           snowflakes that grow and rest), a powder source (falling-sand sandboxes) or a
                                           normals source (a lighting normal pass derived from a colour recipe)
  pixelbolt compile <source.json> --expand [--out expanded.poses.json]
                                           Print editable poses with motion templates expanded
  pixelbolt compile <source.json> --draft-views boot:30,330[,hand:45] [--preview drafts.png] [--out drafts.json]
                                           Draft turned views of small grid parts to correct and paste into
                                           parts.<name>.views; --preview draws flat, today's turn, draft and drawn
  pixelbolt compile --preset <name> --out recipe.json [--metadata meta.json] [--size 32x32] [--frames 8]
                                           Compile a shipped preset (smoke-puff, campfire, fire-spells, hero...) as
                                           its examples/ file compiles; --expand for a poses preset. --size (any
                                           compile) puts the drawing on a canvas of that size: cut to the window
                                           holding the most of it or given margins, never scaled; the reply says
                                           where the window starts and what share of the drawing it cuts
                                           --frames (any compile) keeps that many evenly spaced frames of each
                                           animation that has more, playing as long as before: the way to fewer
                                           frames (lowering frames in a source cuts the effect short instead)
  pixelbolt presets [name] [--full]        List the presets, a line each (size, frames, loop, colours, what each is
                                           for; --full adds every animation and file), or print one preset's source
  pixelbolt presets --find "water splash"  Only the presets those words match: by name, else by description
  pixelbolt autotile <template.json> --out recipe.json [--metadata masks.json] [--preview map.png]
                                           Build a 47-tile blob or 16-tile cardinal set from template rows or a
                                           terrain description; --preview draws every tile over a test map
  pixelbolt scene <scene.json> --out dir   Export a bounded scene review and aligned material passes
  pixelbolt scene <scene.json> --image view.png [--time ms] [--view color|grayscale|depth] [--scale 1-8]
                    [--guides json]        One enlarged view at one time; depth lists who covers whom
  pixelbolt overlay <recipe.json> --changes edits.json --out fixes.json [--selections regions.json]
  pixelbolt import <image.png> --out recipe.json [--atlas atlas.json] [--name imported]
                    [--embedded]         Recover the recipe carried inside the PNG instead of its pixels
  pixelbolt preview [file.json] [--port N] [--open]
                                           Studio for a recipe or scene; sources open as their compiled recipe.
                                           Port 4747, or a free one when it is in use; --open starts your browser
  pixelbolt mcp [--out directory] [--root directory] [--time-limit seconds]  Run the MCP server over stdio
  pixelbolt schema                         Print the JSON Schema
  pixelbolt skill install [--project | --dir folder] [--force]
                                           Install the pixel art skill on its own, with no checkout or MCP server:
                                           into ~/.claude/skills (Claude Code), ./.claude/skills with --project, or
                                           a skills folder you name; its commands run npx -y pixelbolt@<this version>

Options: --force allows overwriting exported files, and removes an earlier export's frames the new one no longer has. No command writes over a file it reads, however the path is spelled (patch may save over the recipe it edits). '-' reads JSON from stdin.
--embed-recipe on render or scene embeds the resolved recipe in exported PNGs (not scene asset passes).
render and scene reply with their folder once and the files in it, leaving out frames/<name>.png and, past 16, each
animation; --list-files lists every file. compile, autotile and import save their metadata only with --metadata <new.json>.
Palette references ({"$ref": "palette.json"}), scene asset files and a normals source's recipe resolve from the
input file's folder.
Inspect: --frames a,b or --animation name picks cells (* and ? in a name match frames: --frames 'flash-*');
--step n [--offset k] keeps every nth cell from position k (0 is the first); --region x,y,w,h crops;
--animation name --every 100 draws a cell per 100 ms of playback, so holds and quick steps show as they play,
and lists the pixels each step changes;
--grid adds palette-key rows; --scale 1-16 and --background color style the sheet.
--view color|silhouette|grayscale|onion|tile|parts (each pixel coloured by the layer or pose part that drew it);
--native adds a 1x PNG; --diagnostics adds advisory evidence (past 8 frames, totals and the three frames with the
most to clean up; --full lists every frame).
--guides '{"horizon":40,"vanish":[[64,40]],"iso":{"tile":[32,16]}}' (or a file) draws perspective guides over the
enlarged sheet; scene --image takes the same.
--motion name --speed px/s reviews contacts, ground, pose spread, loop seam and gait, and draws the limb arcs.
Input may be a pose source, or a compiled recipe with --metadata meta.json. --ground row overrides the
metadata's ground.
--max-cells 1-256 samples long sequences with explicit omission metadata; evenly spaced samples can alias with a
repeating pattern (a strobe alternating A and B), so pick positions with --step and --offset.
Patch accepts correction overlays as --changes; a changed base fails with a fingerprint conflict.
A cleanup change ({"cleanup": "frames[run-2]", "value": {"corners": true, "strays": true}}) previews
proposed fixes for doubled corners and stray pixels; --diagnostics counts both per frame.
GIF keeps exact colours (at most 256 per frame, never quantized), 1-bit transparency unless --background blends
onto a colour, and 10 ms timing steps; the result's notes list what changed. Default scale: 1, the frames' own size.
gif-frames reads the folder's numbered PNGs in number order, one GIF frame each, by the same rules; frames whose
colours differ get colour tables of their own. --loops is the number of plays (0, the default, loops for ever).
Sequence writes one PNG per video frame with alpha, plus sequence.json and a README with the ffmpeg command for a
.mov. --size is 720p, 1080p, 1440p, 4k, vertical, square or WIDTHxHEIGHT; the sprite is enlarged by a whole number
(the largest that fits, or --scale; --fit cover takes the smallest that covers the canvas and crops the rest) and
placed by --align (top-left ... bottom-right) and --offset. A scene's margins take its background colour. --step 2
animates on twos. Rates such as 23.976 and 29.97 are exact (24000/1001, 30000/1001). A pixelforge-bodies source is
stepped frame after frame (--animation names the effect), so a match may run past a recipe's 256 frames.
Command results except help and the preview server are JSON. Errors exit with code 1.
Checkout: node bin/pixelbolt.js <command>. Portable build folder: .\\pixelbolt (Windows) or ./pixelbolt (macOS/Linux).
`;

// The options each command takes: the one place an option is listed. One named in FLAGS takes no value; every other
// takes the argument after it.
const FLAGS = new Set(['force', 'grid', 'native', 'diagnostics', 'open', 'expand', 'embed-recipe', 'embedded', 'project', 'list-files', 'full']);
const OPTIONS = {
  init: ['force'],
  validate: ['fps'],
  inspect: ['frames', 'animation', 'region', 'grid', 'scale', 'background', 'out', 'force', 'view', 'native', 'diagnostics', 'full', 'max-cells', 'step', 'offset', 'every', 'layers', 'reference', 'guides', 'motion', 'speed', 'ground', 'metadata'],
  patch: ['changes', 'out', 'image', 'force'],
  render: ['out', 'force', 'expect', 'animation', 'list-files', 'embed-recipe'],
  gif: ['out', 'animation', 'scale', 'background', 'force', 'preset', 'size', 'frames', 'sheet'],
  'gif-frames': ['out', 'fps', 'loops', 'background', 'prefix', 'force'],
  sequence: ['out', 'fps', 'animation', 'size', 'scale', 'fit', 'align', 'offset', 'background', 'loops', 'seconds', 'step', 'force'],
  preview: ['port', 'open'],
  mcp: ['out', 'root', 'time-limit'],
  schema: [],
  compile: ['out', 'metadata', 'preview', 'force', 'expand', 'preset', 'draft-views', 'size', 'frames'],
  autotile: ['out', 'metadata', 'preview', 'force'],
  scene: ['out', 'force', 'image', 'time', 'view', 'scale', 'guides', 'list-files', 'embed-recipe'],
  overlay: ['changes', 'selections', 'out', 'force'],
  import: ['out', 'name', 'atlas', 'metadata', 'force', 'embedded'],
  presets: ['full', 'find'],
  share: [],
  skill: ['project', 'dir', 'force']
};
const KNOWN = new Set(Object.values(OPTIONS).flat());
function parseArgs(args) {
  const positional = [], options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i].startsWith('--') ? args[i].slice(2) : null;
    if (key === null) positional.push(args[i]);
    else if (FLAGS.has(key)) options[key] = true;
    else if (key === 'gif') throw new Error('--gif is not an option; the gif command makes one: pixelbolt gif <recipe.json> --out <new.gif>');
    else if (!KNOWN.has(key)) throw new Error(`Unknown option: ${args[i]}`);
    else {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`--${key} requires a value`);
      options[key] = args[++i];
    }
  }
  return { positional, options };
}
// --draft-views boot:30,330,hand:45: a name followed by a colon starts a part; the numbers after it are its angles.
function readDraftViews(value) {
  const request = {};
  let part = null;
  for (const token of value.split(',').map(item => item.trim())) {
    const named = /^([A-Za-z][A-Za-z0-9_-]{0,63}):(.*)$/.exec(token), angle = named ? named[2] : token;
    if (named) { part = named[1]; if (Object.hasOwn(request, part)) throw new Error(`--draft-views names ${part} twice`); request[part] = []; }
    if (part === null || !/^\d{1,3}$/.test(angle)) throw new Error(`--draft-views expects part:angle,angle such as boot:30,330 or boot:30,hand:45; got ${JSON.stringify(token)}`);
    request[part].push(Number(angle));
  }
  return request;
}
const DRAFT_NEXT = 'Drafts, not art: compare each with the flat drawing and correct its rows by eye, then paste the view into parts.<name>.views of your source. A view is drawn at angles within 22.5° of its key. Nothing was written to the source.';
// --expect and --guides take inline JSON or a file holding it. Windows PowerShell 5.1 strips the double quotes from the
// arguments it passes to a program, so '{"width":32}' arrives as {width:32}: with no quote left, quote the bare keys
// back (no value either option takes is a string).
async function readJSONOption(value, key = 'expect', example = '{"width":32,"height":32}') {
  if (!String(value).trimStart().startsWith('{')) return readProject(value);
  try { return JSON.parse(value); } catch (error) {
    const stripped = !value.includes('"');
    if (stripped) try { return JSON.parse(value.replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3')); } catch {}
    throw Object.assign(new Error(`--${key}: expected JSON such as ${example}: ${error.message}${stripped ? '. Windows PowerShell 5.1 drops the double quotes inside arguments: put the JSON in a .json file and pass its name, or use PowerShell 7, cmd or bash' : ''}`), { path: key });
  }
}
const readGuidesOption = value => readJSONOption(value, 'guides', '{"horizon":40,"vanish":[[64,40]]}');
async function readProject(file) {
  if (!file) throw new Error('Provide a project JSON filename or - for stdin');
  let source;
  if (file === '-') { const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk); source = Buffer.concat(chunks).toString('utf8'); }
  else source = await readFile(file, 'utf8');
  return JSON.parse(source.replace(/^﻿/, ''));
}
// Reads a document and inlines its references relative to its own folder (stdin: the working directory).
async function readResolved(file) {
  const original = await readProject(file), baseDir = file === '-' ? process.cwd() : path.dirname(path.resolve(file));
  const resolution = await resolveReferences(original, { baseDir });
  return { file, original, document: resolution.document, resolution, baseDir };
}
// Every file an export was made from: the recipe itself and the palette and asset files it references.
const inputsOf = input => [...(input.file === '-' ? [] : [path.resolve(input.file)]), ...input.resolution.files];
// A bundle's files relative to its folder, leaving out each frame (frames/<name>.png) and, past 16, each animation
// unless --list-files: the reply already names the frames and animations.
const bundleFiles = (directory, files, options) => { const { files: listed, removed } = outputSummary(directory, files, options['list-files'] === true); return { directory: shown(directory), files: listed, ...(removed && { removed }) }; };
// The documents whose shared-palette link carries over to the recipe they are or compile to (a normal source's recipe
// and a scene's assets do not).
const LINKED_SOURCES = ['poses', 'autotile', 'fx', 'fluid', 'wave', 'crystal', 'powder', 'project'];
// Compiled output keeps a shared-palette link, rewritten relative to where the output is written.
function linkPalette(recipe, input, outFile) {
  const link = input.resolution.palettes.find(entry => LINKED_SOURCES.includes(entry.where));
  if (!link) return recipe;
  const shared = path.resolve(input.baseDir, link.reference), reference = path.relative(path.dirname(path.resolve(outFile)), shared).split(path.sep).join('/');
  return restorePaletteReference({ palette: { $ref: reference } }, recipe, { palettes: [{ ...link, where: 'project' }] });
}
function inspectOptions({ frames, animation, region, grid, scale, background, view, native, diagnostics, 'max-cells': maxCells, step, offset, every }) {
  for (const [key, value] of [['step', step], ['offset', offset], ['every', every]]) if (value !== undefined && !/^\d+$/.test(value)) throw new Error(`--${key} expects a whole number`);
  if (region !== undefined && !/^\d+,\d+,\d+,\d+$/.test(region)) throw new Error('--region expects four whole numbers: x,y,w,h');
  const [x, y, w, h] = region?.split(',').map(Number) ?? [];
  return { ...(frames !== undefined && { frames: frames.split(',') }), ...(animation !== undefined && { animation }), ...(region !== undefined && { region: { x, y, w, h } }), ...(grid && { grid }), ...(scale !== undefined && { scale: Number(scale) }), ...(background !== undefined && { background }), ...(view !== undefined && { view }), ...(native && { native }), ...(diagnostics && { diagnostics }), ...(maxCells !== undefined && { maxCells: Number(maxCells) }), ...(step !== undefined && { step: Number(step) }), ...(offset !== undefined && { offset: Number(offset) }), ...(every !== undefined && { every: Number(every) }) };
}
// The named files a command reads (stdin aside), so its outputs can be kept off them.
// A folder output named like a file (scene.png) is a mix-up that would make a folder of that name: name what to use.
function folderOut(command, out, instead) {
  if (/\.(?:png|apng|gif|jpe?g|webp|json|tres|tsx|tmx|mov|mp4)$/i.test(out)) throw new Error(`${command} --out takes a folder, and ${out} names a file: ${instead}`);
}
const filesRead = (...files) => files.filter(file => file !== undefined && file !== '-').map(file => path.resolve(file));
// Checks every target before writing any, so a refused overwrite leaves nothing half-written. `inputs` are the files the
// command read: even --force never writes over one, however the path is spelled (links, short names, letter case).
async function writeOutputs(targets, force, inputs = []) {
  const entries = Object.entries(targets).map(([label, [file, data]]) => [label, path.resolve(file), data]);
  // Windows and macOS file systems ignore case by default, so Hero.json and hero.json are one file there.
  const unique = new Set(entries.map(([, target]) => process.platform === 'win32' || process.platform === 'darwin' ? target.toLowerCase() : target));
  if (unique.size !== entries.length) throw new Error('Output paths must be distinct; no files were written.');
  // Two existing outputs can be one file under other names (a hard link, a symbolic link, a short 8.3 name): the
  // second write would replace the first.
  for (let i = 1; i < entries.length; i++) {
    const [twin] = await sameFiles([entries[i][1]], entries.slice(0, i).map(([, target]) => target));
    if (twin) throw new Error(`${twin} is the same file on disk as another output; output paths must be distinct. No files were written.`);
  }
  const [read] = await sameFiles(entries.map(([, target]) => target), inputs);
  if (read) throw new Error(`${read} is a file this command reads; even --force never writes over it. Choose another file; no files were written.`);
  if (!force) for (const [, target] of entries) {
    try { await access(target); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    // Said outright, since an agent that misses the refusal opens the old file and takes it for this run's.
    throw new Error(`Output already exists: ${target}. Nothing was written, so that file is an earlier run's, not this one's. Choose a new file or pass --force.`);
  }
  for (const [, target, data] of entries) {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data, { flag: force ? 'w' : 'wx' });
  }
  return Object.fromEntries(entries.map(([label, target]) => [label, shown(target)]));
}
// Sidecar sources compile by their format; `autotile` remains a dedicated command for templates.
const COMPILERS = { 'pixelforge-poses': compilePoses, 'pixelforge-autotile': compileAutotile, 'pixelforge-fx': compileEffects, 'pixelforge-fluid': compileFluid, 'pixelforge-wave': compileWaves, 'pixelforge-crystal': compileCrystals, 'pixelforge-powder': compilePowder, 'pixelforge-bodies': compileBodies, 'pixelforge-normals': compileNormals };
// Every reply is printed one way: like JSON.stringify(value, null, 2), but an object or array that fits in ROW
// characters is written on one line, and a longer list of names or numbers is wrapped to lines of that length rather
// than a line an item. Grid rows (`rows`, strings that must line up under each other) are always a line each.
const ROW = 140;
function rowsJSON(value, indent = '', key) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const list = Array.isArray(value), entries = list ? value.map(item => [null, item === undefined ? null : item]) : Object.entries(value).filter(([, item]) => item !== undefined && typeof item !== 'function');
  const open = list ? '[' : '{', close = list ? ']' : '}';
  if (!entries.length) return open + close;
  const flat = JSON.stringify(value), aligned = list && (key === 'rows' || key === 'grids');
  if (!aligned && flat.length <= ROW && !/"(rows|grids)":\[/.test(flat)) return flat;
  const inner = indent + '  ';
  let lines = entries.map(([name, item]) => `${name === null ? '' : `${JSON.stringify(name)}: `}${rowsJSON(item, inner, name ?? key)}`);
  if (list && !aligned && value.every(item => typeof item !== 'object' && String(item).length < 40)) {
    lines = lines.reduce((wrapped, item) => { const last = wrapped.at(-1); if (last !== undefined && last.length + item.length + 2 <= ROW - inner.length) wrapped[wrapped.length - 1] = `${last}, ${item}`; else wrapped.push(item); return wrapped; }, []);
  }
  return [open, lines.map(line => inner + line).join(',\n'), indent + close].join('\n');
}
const print = value => console.log(rowsJSON(value));
// A path as a reply names it: from the working directory when it is inside it, as the caller wrote it, with forward
// slashes; anywhere else, in full.
const shown = file => { const from = path.relative(process.cwd(), file); return from && !from.startsWith('..') && !path.isAbsolute(from) ? from.split(path.sep).join('/') : file; };
// --frames 8: how many frames each animation keeps.
const frameCount = value => { if (!/^\d{1,3}$/.test(value)) throw new Error('--frames expects how many frames each animation keeps, such as --frames 8'); return Number(value); };
const summary = (project, recipe) => ({ name: project.name, width: project.width, height: project.height, frames: project.frames.length, animations: Object.keys(project.animations), ...withRates(project, recipe), warnings: project.warnings, ...(project.clipping && { clipping: project.clipping }), ...(project.clippingOmitted && { clippingOmitted: project.clippingOmitted }) });
const referenced = input => input.resolution.files.length ? { resolved: input.resolution.files.map(shown) } : {};
const engineVersion = async () => JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
// `presets [name] [--full]`, and `help presets [--full]` or `help preset <name>`: every preset, a line each or in full,
// or one preset's source. A shell has no time limit, so every preset is measured.
async function presetsText(name, full = false, find) {
  if (find !== undefined) {
    if (name !== undefined || full) throw new Error('--find goes on its own: pixelbolt presets --find "water splash" lists the presets those words match');
    // Names are known without compiling anything, so a name match measures only the presets it lists.
    const named = new Set(namedLike(await presetEntries(), presetWords(find, '--find')).map(entry => entry.name));
    return rowsJSON(findListing(await listPresets({ budget: Infinity, ...(named.size && { only: entry => named.has(entry.name) }) }), find, '--find'));
  }
  if (name === undefined) { const listing = await listPresets({ budget: Infinity }); return rowsJSON(full ? listing : briefListing(listing)); }
  if (full) throw new Error('--full goes with the listing (pixelbolt presets --full); pixelbolt presets <name> prints one preset\'s source');
  const entry = await findPreset(name, 'name'), { source, inlined } = await loadPreset(entry);
  return rowsJSON({ name: entry.name, file: `examples/${entry.file}`, ...(inlined.length && { inlined }), next: presetNext(entry, true), source });
}
// `help <topic> [section]`: what MCP pixel_help returns for the topic, so a shell reads one section of a long guide
// instead of the whole file. A section name may be quoted or not.
async function helpTopic([topic, ...words]) {
  const { TOPICS, SECTIONED, helpText } = await import('../src/help.js');
  const name = words.length ? words.join(' ') : undefined;
  if (['quickstart', 'quick-start', 'start'].includes(topic)) {
    if (name !== undefined) throw new Error('the quick start has no sections; run pixelbolt help quickstart');
    return helpText(undefined);
  }
  if (!TOPICS.includes(topic)) throw new Error(`Unknown help topic "${topic}"; topics: quickstart, ${TOPICS.join(', ')}`);
  if (topic === 'presets' || topic === 'preset') {
    if (topic === 'preset' && name === undefined) throw new Error('help preset needs a preset name: pixelbolt help preset smoke-puff (pixelbolt help presets lists them)');
    const full = topic === 'presets' && name === '--full';
    if (topic === 'presets' && name !== undefined && !full) throw new Error('help presets lists every preset (--full adds every animation and file); for one preset\'s source run pixelbolt help preset <name>');
    return `${await presetsText(full ? undefined : name, full)}\n`;
  }
  if (name !== undefined && !SECTIONED.has(topic)) throw new Error(`help ${topic} has no sections; only guide, workflow and craft do`);
  return helpText(topic, name, 'cli');
}
try {
  const [command = 'help', ...rest] = process.argv.slice(2);
  // `<command> --help` shows the same help, which lists every command's options (the quick start points agents there).
  if (command === 'help' && rest.length && !rest.includes('--help') && !rest.includes('-h')) process.stdout.write(await helpTopic(rest));
  else if (['help', '--help', '-h'].includes(command) || rest.includes('--help') || rest.includes('-h')) process.stdout.write(HELP);
  else {
    const { positional, options } = parseArgs(rest);
    if (positional.length > 1) throw new Error('Too many positional arguments');
    if (!Object.hasOwn(OPTIONS, command)) throw new Error(`Unknown command: ${command}. Run pixelbolt help.`);
    for (const key of Object.keys(options)) if (!OPTIONS[command].includes(key)) throw new Error(`--${key} is not supported by ${command}`);
    if (['schema', 'mcp'].includes(command) && positional.length) throw new Error(`${command} does not accept a filename`);
    // A preset compiles exactly as its file in examples/ does, so the compile command reads that file.
    if ((command === 'compile' || command === 'gif') && options.preset !== undefined) {
      if (positional.length) throw new Error(`${command} takes a ${command === 'gif' ? 'recipe' : 'source'} file or --preset <name>, not both`);
      const entry = await findPreset(options.preset);
      positional[0] = path.join(PRESET_FOLDER, entry.file); options.preset = entry.name;
    }
    if (command === 'init') {
      const file = positional[0] ?? 'sprite.pixel.json';
      try {
        await writeFile(file, await readFile(new URL('../examples/forest-spirit.json', import.meta.url)), { flag: options.force ? 'w' : 'wx' });
      } catch (error) {
        if (error.code === 'EEXIST') throw new Error(`Output already exists: ${path.resolve(file)}. Choose a new file or pass --force.`);
        throw error;
      }
      print({ ok: true, file });
    } else if (command === 'schema') process.stdout.write(await readFile(new URL('../schema.json', import.meta.url), 'utf8'));
    else if (command === 'presets') {
      console.log(await presetsText(positional[0], options.full === true, options.find));
    } else if (command === 'skill') {
      if (positional[0] !== 'install') throw new Error('Usage: pixelbolt skill install [--project | --dir <skills folder>] [--force]');
      const { installSkill } = await import('../src/skill.js');
      print({ ok: true, ...await installSkill({ version: await engineVersion(), force: options.force, project: options.project, dir: options.dir }) });
    } else if (command === 'mcp') {
      const { startMCP } = await import('../src/mcp.js');
      // A tool call that runs longer is stopped and answered with an error; the default is 50 seconds.
      const limit = options['time-limit'] === undefined ? undefined : Number(options['time-limit']);
      if (limit !== undefined && !(limit >= 1 && limit <= 3600)) throw new Error('--time-limit must be 1 to 3600 seconds');
      await startMCP({ directory: options.out, ...(options.root !== undefined && { root: path.resolve(options.root) }), ...(limit !== undefined && { timeLimit: limit * 1000 }) });
    } else if (command === 'preview') {
      const { startStudio, openBrowser, STUDIO_PORT } = await import('../src/server.js');
      const port = options.port === undefined ? STUDIO_PORT : Number(options.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535');
      const input = positional[0] ? await readResolved(positional[0]) : undefined;
      // The studio shows and saves documents as written, so the files they name stay named: a scene's light settings are
      // saved into the scene, and Save JSON writes a recipe or pose source with its link to a shared palette file.
      let project = input?.document, source = input?.original;
      // Preserve editable pose and wave sources; other authoring formats open as compiled recipes, which keep
      // the link as `pixelbolt compile` writes it beside the source.
      if (project && !['pixelforge-poses', 'pixelforge-wave'].includes(project.format) && Object.hasOwn(COMPILERS, project.format ?? '')) {
        project = COMPILERS[project.format](project).recipe; source = linkPalette(project, input, input.file);
      }
      // The page draws a linked recipe with the palette file as read here; it reads no file itself.
      const link = input?.resolution.palettes.find(entry => LINKED_SOURCES.includes(entry.where)), reference = source?.palette?.$ref;
      const sharedPalette = link && reference !== undefined ? { $ref: reference, palette: link.shared, ramps: link.sharedRamps ?? null } : null;
      // A port you name is used or refused; the usual one gives way to any free port when something else has it.
      const server = await startStudio({ port, project, source, sharedPalette, fallback: options.port === undefined });
      if (options.open && !await openBrowser(`http://127.0.0.1:${server.address().port}/`)) console.log('No browser was opened. Copy the address above into your browser.');
    } else if (command === 'compile' && (options.size !== undefined || options.frames !== undefined) && (options['draft-views'] !== undefined || options.expand)) {
      throw new Error('--size and --frames go with a compile that writes a recipe; leave out --draft-views and --expand');
    } else if (command === 'compile' && options['draft-views'] !== undefined) {
      // Drafts are printed (or saved with --out) for the author to correct and paste; the source is never touched.
      for (const key of ['metadata', 'expand']) if (options[key] !== undefined) throw new Error(`--${key} cannot be combined with --draft-views`);
      if (options.out && !/\.json$/i.test(options.out)) throw new Error('--out must name a new .json file for the drafts');
      if (options.preview !== undefined && !/\.png$/i.test(options.preview)) throw new Error('--preview must name a new .png file');
      // The sheet is drawn only for --preview; one too large to draw leaves the drafts to come back without it.
      const input = await readResolved(positional[0]), { drafts, sheet, noSheet } = draftViews(input.document, readDraftViews(options['draft-views']), { sheet: options.preview !== undefined });
      const reply = { ok: true, drafts, next: DRAFT_NEXT };
      const written = await writeOutputs({ ...(options.out && { drafts: [options.out, formatJSON(reply)] }), ...(sheet && { preview: [options.preview, encodePNG(sheet.data, sheet.width, sheet.height)] }) }, options.force, inputsOf(input));
      const unwritten = noSheet && { preview: `not written: ${noSheet}` };
      if (options.out) print({ ok: true, ...written, ...unwritten, parts: Object.keys(drafts), next: DRAFT_NEXT, ...referenced(input) });
      else process.stdout.write(formatJSON({ ...reply, ...written, ...unwritten, ...(options.preview === undefined && { hint: 'Pass --preview <new.png> to see each draft beside the flat drawing, the turn the compiler draws today and any drawn view.' }), ...referenced(input) }));
    } else if (command === 'compile' && options.expand) {
      if (options.metadata) throw new Error('--expand prints source annotations; omit --metadata');
      if (options.out && !/\.json$/i.test(options.out)) throw new Error('--out must name a .json file');
      const input = await readResolved(positional[0]), expanded = expandPoses(input.document);
      if (options.out) print({ ok: true, ...await writeOutputs({ source: [options.out, formatJSON(linkPalette(expanded, input, options.out))] }, options.force, inputsOf(input)), ...referenced(input) });
      else process.stdout.write(formatJSON(expanded));
    } else if (command === 'share') {
      const input = await readResolved(positional[0]), version = await engineVersion();
      // The hosted playground has no compiler for wave, crystal, powder or bodies sources, so they are shared as the
      // ordinary grids they compile to.
      const compile = { 'pixelforge-wave': compileWaves, 'pixelforge-crystal': compileCrystals, 'pixelforge-powder': compilePowder, 'pixelforge-bodies': compileBodies }[input.document?.format];
      const document = compile ? compile(input.document).recipe : input.document;
      const link = await shareLink(document, version);
      print({ ok: true, link, characters: link.length, version, kind: recipeKind(document), ...(compile && { compiledFrom: input.document.format }) });
    } else if (command === 'import' && options.embedded) {
      if (!options.out || !/\.json$/i.test(options.out)) throw new Error('import requires --out <new.json>');
      if (!positional[0] || positional[0] === '-') throw new Error('import requires a PNG filename');
      for (const key of ['name', 'atlas', 'metadata']) if (options[key] !== undefined) throw new Error(`--${key} cannot be combined with --embedded`);
      const embedded = await readEmbeddedRecipe(await readFile(positional[0]));
      if (!embedded) throw new Error('This PNG carries no Pixelbolt recipe; drop --embedded to import its pixels.');
      const { version, kind, recipe } = embedded;
      print({ ok: true, ...await writeOutputs({ recipe: [options.out, formatJSON(recipe)] }, options.force, filesRead(positional[0])), embedded: { version, kind } });
    } else if (['compile', 'autotile', 'overlay', 'import'].includes(command)) {
      if (!options.out || !/\.json$/i.test(options.out)) throw new Error(`${command} requires --out <new.json>`);
      let value, metadata, input, warnings, preview, resized, kept;
      if (command === 'compile' || command === 'autotile') {
        input = await readResolved(positional[0]);
        // A preset may be a plain recipe, which compiles to itself.
        const compile = command === 'autotile' ? compileAutotile : options.preset !== undefined ? compilePreset : COMPILERS[input.document?.format] ?? compilePoses;
        const compiled = compile(input.document);
        // A plain recipe preset compiles to itself and has no metadata to save.
        if (options.metadata && compiled.metadata === undefined) throw new Error(`${options.preset} is a plain recipe preset, which has no metadata; omit --metadata`);
        metadata = compiled.metadata; warnings = compiled.warnings ?? []; preview = compiled.preview;
        // --frames: each animation down to that many evenly spaced frames, playing as long as before.
        if (options.frames !== undefined) {
          if (compile === compileAutotile) throw new Error('--frames thins animations, and the frames of a tile set are its tiles');
          const thinned = keepFrames(compiled.recipe, frameCount(options.frames), '--frames');
          compiled.recipe = thinned.recipe; kept = thinned.kept; warnings.push(...thinned.notes);
          if (metadata) metadata = { ...metadata, kept };
        }
        // --size: the compiled drawing on a canvas of another size (cut or given margins, never scaled).
        if (options.size !== undefined) {
          if (command === 'autotile') throw new Error('--size goes with compile: a tile set\'s size is its tile, set in the source');
          const { recipe, resized: moved } = resizeRecipe(compiled.recipe, options.size, '--size'), cut = resizeWarning(moved, [recipe.width, recipe.height]);
          compiled.recipe = recipe; resized = moved;
          if (cut) warnings.push(cut);
          // The metadata keeps the source's own coordinates; this says where the new canvas starts in them.
          if (metadata) metadata = { ...metadata, resized };
        }
        value = linkPalette(compiled.recipe, input, options.out);
      } else if (command === 'overlay') {
        if (!options.changes) throw new Error('overlay requires --changes <edits.json>');
        if (positional[0] === '-' && options.changes === '-') throw new Error('Only one input can use stdin');
        input = await readResolved(positional[0]);
        value = createOverlay(input.document, await readProject(options.changes), options.selections ? await readProject(options.selections) : {});
      } else {
        if (!positional[0] || positional[0] === '-') throw new Error('import requires a PNG filename');
        const imported = importPNG(await readFile(positional[0]), { name: options.name, atlas: options.atlas ? await readProject(options.atlas) : undefined });
        value = imported.recipe; metadata = imported.provenance;
      }
      if (options.metadata && !/\.json$/i.test(options.metadata)) throw new Error('--metadata must name a .json file');
      if (options.preview !== undefined && !/\.png$/i.test(options.preview)) throw new Error('--preview must name a new .png file');
      if (options.preview !== undefined && !preview) throw new Error('--preview draws an autotile set over a test map; this source is not an autotile set');
      // The test map: every tile of an autotile set in one image, as MCP pixel_compile returns it.
      const testMap = options.preview !== undefined ? inspectProject(renderProject(preview), { scale: testMapScale(preview) }).sheet : null;
      // Generated files use compact formatting: one line per frame, operation or short grid when it fits.
      const reads = command === 'import' ? filesRead(positional[0], options.atlas) : [...inputsOf(input), ...filesRead(options.changes, options.selections)];
      const written = await writeOutputs({ recipe: [options.out, formatJSON(value)], ...(options.metadata && { metadata: [options.metadata, formatJSON(metadata)] }), ...(testMap && { preview: [options.preview, encodePNG(testMap.data, testMap.width, testMap.height)] }) }, options.force, reads);
      // The metadata goes to a file or nowhere: a rig's runs to a hundred kilobytes, which no reply should carry. The
      // hint to save it comes only where a next step reads it: a rig's motion review, a tile set's masks, an import.
      const reviewed = command !== 'compile' || ['pixelforge-poses', 'pixelforge-autotile', undefined].includes(input.document?.format);
      print({ ok: true, ...written, ...(kept && { kept }), ...(resized && { width: value.width, height: value.height, resized }), ...(warnings && { warnings }), ...(((metadata && !options.metadata && reviewed) || (preview && !options.preview)) && { hint: [metadata && !options.metadata && reviewed && `The metadata${warnings ? ' (what review tools and engines read: loop seams, pose contacts, tile masks)' : ''} was not saved; pass --metadata <new.json> to keep it.`, preview && !options.preview && 'Pass --preview <new.png> to see every tile in a test map.'].filter(Boolean).join(' ') }), ...(input && referenced(input)) });
    } else if (command === 'scene' && options.image !== undefined) {
      // One image at one time, as MCP pixel_scene returns it: color, grayscale or depth, with optional guides.
      if (options.out !== undefined || options['embed-recipe']) throw new Error('scene --image writes one image; export a bundle with --out instead');
      if (!/\.png$/i.test(options.image)) throw new Error('scene --image must name a .png file');
      for (const [key, value] of [['time', options.time], ['scale', options.scale]]) if (value !== undefined && !/^\d+$/.test(value)) throw new Error(`--${key} expects a whole number`);
      const input = await readResolved(positional[0]), scene = prepareScene(input.document), time = Number(options.time ?? 0), mode = options.view ?? 'color';
      const frame = renderScene(scene, { time, depth: mode === 'depth' });
      const scale = options.scale === undefined ? Math.max(1, Math.min(8, Math.floor(768 / Math.max(frame.width, frame.height)))) : Number(options.scale);
      const image = sceneImage(frame, { mode, scale, ...(options.guides !== undefined && { guides: await readGuidesOption(options.guides) }) });
      const written = await writeOutputs({ image: [options.image, encodePNG(image.data, image.width, image.height)] }, options.force, [...inputsOf(input), ...filesRead(options.guides?.trimStart().startsWith('{') ? undefined : options.guides)]);
      print({ ok: true, name: input.document.name, width: frame.width, height: frame.height, duration: scene.duration, time, scale, view: mode, placements: frame.placements.length, ...(frame.depth && { depth: frame.depth }), ...(image.guides && { guides: image.guides }), ...(frame.lights && { lights: frame.lights }), ...(frame.shadows && { shadows: frame.shadows }), ...(frame.camera && { camera: frame.camera }), ...(frame.haze && { haze: frame.haze }), warnings: frame.warnings, ...written, ...referenced(input) });
    } else if (command === 'scene') {
      if (!options.out) throw new Error('scene requires --out <directory>, or --image <file.png> for one view');
      folderOut('scene', options.out, 'for one image of the scene use --image <file.png>; --out writes a bundle folder');
      for (const key of ['time', 'view', 'scale', 'guides']) if (options[key] !== undefined) throw new Error(`--${key} goes with --image, which writes one view of the scene`);
      const input = await readResolved(positional[0]), bundle = await createSceneBundle(input.document);
      if (options['embed-recipe']) await embedBundleRecipe(bundle, input.document, await engineVersion());
      const files = await writeBundle(bundle, options.out, { force: options.force, inputs: inputsOf(input) });
      print({ ok: true, ...bundleFiles(path.resolve(options.out), files, options), warnings: bundle.warnings, ...referenced(input) });
    } else if (command === 'inspect') {
      const layerOptions = options.layers === undefined ? {} : { layers: options.layers.split(',') };
      if ([positional[0], options.reference, options.metadata].filter(file => file === '-').length > 1) throw new Error('Only one inspection input can use stdin');
      if (!options.motion && ['speed', 'ground', 'metadata'].some(key => options[key] !== undefined)) throw new Error('--speed, --ground and --metadata require --motion');
      if (options.full && !options.diagnostics) throw new Error('--full goes with --diagnostics: it lists the counts of every frame');
      if (options.motion) for (const key of ['frames', 'animation', 'region', 'grid', 'view', 'native', 'diagnostics', 'max-cells', 'step', 'offset', 'layers', 'reference', 'guides']) if (options[key] !== undefined) throw new Error(`--${key} cannot be combined with --motion`);
      const input = await readResolved(positional[0]), compiled = input.document.format === 'pixelforge-poses' ? compilePoses(input.document) : input.document.format === 'pixelforge-wave' ? compileWaves(input.document) : null;
      if (input.document.format === 'pixelforge-wave' && options.motion) throw new Error('--motion reviews character poses; inspect a wave without --motion');
      if (compiled && options.metadata) throw new Error('A pose source supplies its own metadata; omit --metadata');
      const recipe = compiled?.recipe ?? input.document, project = renderProject(recipe, { ...layerOptions, ...(options.view === 'parts' && { owners: true }) });
      const comparison = options.reference ? compareProjects(renderProject((await readResolved(options.reference)).document, layerOptions), project) : undefined;
      const { image: referenceImage, ...comparisonReport } = comparison ?? {};
      const view = options.motion ? inspectMotion(project, { animation: options.motion, metadata: compiled?.metadata ?? (options.metadata ? await readProject(options.metadata) : undefined),
        ...Object.fromEntries(['speed', 'ground', 'scale'].filter(key => options[key] !== undefined).map(key => [key, Number(options[key])])),
        ...(options.background !== undefined && { background: options.background }) }) : inspectProject(project, { ...inspectOptions(options), ...(options.guides !== undefined && { guides: await readGuidesOption(options.guides) }) }), { data, ...sheet } = view.sheet;
      if (options.out && !/\.png$/i.test(options.out)) throw new Error('inspect --out must name a .png file');
      const written = await writeOutputs(options.out ? { image: [options.out, encodePNG(data, sheet.width, sheet.height)], ...(view.nativeSheet && { nativeImage: [options.out.replace(/\.png$/i, '.native.png'), encodePNG(view.nativeSheet.data, view.nativeSheet.width, view.nativeSheet.height)] }), ...(referenceImage && { referenceImage: [options.out.replace(/\.png$/i, '.reference.png'), encodePNG(referenceImage.sheet.data, referenceImage.sheet.width, referenceImage.sheet.height)] }) } : {}, options.force, [...inputsOf(input), ...filesRead(options.reference, options.metadata)]);
      if (view.diagnostics && !options.full) view.diagnostics = briefDiagnostics(view.diagnostics);
      // Grid rows line up for reading; a short row of a table (a cell, a frame's counts, a box) stays on one line.
      print({ ok: true, ...summary(project, recipe), ...view, cells: briefCells(view.cells), warnings: [...(compiled?.warnings ?? []), ...project.warnings], sheet, nativeSheet: view.nativeSheet ? { ...view.nativeSheet, data: undefined } : undefined, ...(comparison && { comparison: comparisonReport }), ...written, ...referenced(input) });
    } else if (command === 'patch') {
      if (!options.changes) throw new Error('patch requires --changes <file.json|->');
      if (positional[0] === '-' && options.changes === '-') throw new Error('Only one of the project and --changes can be read from stdin');
      if (options.out && !/\.json$/i.test(options.out)) throw new Error('patch --out must name a .json file');
      if (options.image && !/\.png$/i.test(options.image)) throw new Error('patch --image must name a .png file');
      const input = await readResolved(positional[0]), base = input.document, changes = await readProject(options.changes);
      const applied = changes?.format === 'pixelforge-overlay' ? applyOverlay(base, changes) : patchRecipe(base, Array.isArray(changes) ? changes : changes?.changes);
      const { recipe, edits } = applied;
      const after = renderProject(recipe), { image, ...report } = compareProjects(renderProject(base), after);
      // A recipe that referenced a shared palette keeps that reference; only new or changed entries stay local.
      const saved = restorePaletteReference(input.original, recipe, input.resolution);
      const written = await writeOutputs({
        ...(options.out && { recipe: [options.out, Buffer.from(JSON.stringify(saved, null, 2) + '\n')] }),
        ...(options.image && image && { image: [options.image, encodePNG(image.sheet.data, image.sheet.width, image.sheet.height)] })
      }, options.force, [...input.resolution.files, ...filesRead(options.changes)]);
      const { sheet, ...drawn } = image ?? {};
      print({ ok: true, name: after.name, edits, ...(applied.rebased && { rebased: true }), ...report, ...(written.image && { image: { ...drawn, scale: sheet.scale, file: written.image } }), ...(written.recipe && { recipe: written.recipe }), warnings: after.warnings, ...(after.clipping && { clipping: after.clipping }), ...(after.clippingOmitted && { clippingOmitted: after.clippingOmitted }) });
    } else if (command === 'sequence') {
      if (!options.out) throw new Error('sequence requires --out <new folder>');
      folderOut('sequence', options.out, 'name a new folder for the numbered frames; for one GIF use pixelbolt gif --out <new.gif>');
      if (options.fps === undefined) throw new Error('sequence requires --fps, for example 24, 25, 29.97, 30 or 60');
      const input = await readResolved(positional[0]);
      // Pose, autotile, effect and fluid sources become the recipe they compile to; a scene is rendered moment by moment,
      // and a bodies match frame after frame (so it may run past a recipe's 256 frames).
      const bodies = input.document?.format === 'pixelforge-bodies';
      const document = bodies ? input.document : Object.hasOwn(COMPILERS, input.document?.format ?? '') ? COMPILERS[input.document.format](input.document).recipe : input.document;
      const numeric = key => options[key] === undefined ? {} : { [key]: Number(options[key]) }, text = key => options[key] === undefined ? {} : { [key]: options[key] };
      const settings = { ...text('fps'), ...text('animation'), ...text('size'), ...numeric('scale'), ...text('fit'), ...text('align'), ...(options.offset !== undefined && { offset: options.offset.split(',').map(Number) }), ...text('background'), ...numeric('loops'), ...numeric('seconds'), ...numeric('step') };
      // A match is simulated, drawn and written a frame at a time, so its length isn't bounded by memory.
      const sequence = bodies ? createBodiesSequence(document, settings, { stream: true }) : document?.format === 'pixelforge-scene' ? createSceneSequence(prepareScene(document), document.name, settings) : createSequence(renderProject(document), settings);
      const files = await writeBundle(sequence, options.out, { force: options.force, inputs: inputsOf(input) }), { timing, figures, ...info } = sequence.info;
      // A match's every-frame figures stay in sequence.json; the reply carries their summary, after where the files went.
      print({ ok: true, ...info, directory: shown(path.resolve(options.out)), files: files.length, ...(files.removed && { removed: files.removed }), ...referenced(input), ...(figures && { figures: figuresSummary(figures) }) });
    } else if (command === 'gif') {
      if (!options.out || !/\.gif$/i.test(options.out)) throw new Error('gif requires --out <new.gif>');
      if (options.sheet !== undefined && !/\.png$/i.test(options.sheet)) throw new Error('--sheet must name a new .png file');
      // --preset: a shipped preset straight to its GIF, compiled as compile --preset compiles it.
      const input = await readResolved(positional[0]), compiled = options.preset !== undefined ? compilePreset(input.document) : null, warnings = [...(compiled?.warnings ?? [])];
      let recipe = compiled ? compiled.recipe : input.document, resized, kept;
      if (options.frames !== undefined) {
        const thinned = keepFrames(recipe, frameCount(options.frames), '--frames');
        ({ recipe, kept } = thinned); warnings.push(...thinned.notes);
      }
      if (options.size !== undefined) {
        ({ recipe, resized } = resizeRecipe(recipe, options.size, '--size'));
        const cut = resizeWarning(resized, [recipe.width, recipe.height]);
        if (cut) warnings.push(cut);
      }
      const project = renderProject(recipe), names = Object.keys(project.animations);
      const { data, ...gif } = animationGIF(project, options.animation, { ...(options.scale !== undefined && { scale: Number(options.scale) }), ...(options.background !== undefined && { background: options.background }) });
      // The cut is already said once: the clipping it causes is not a second problem.
      // --sheet: the frames of that animation as a contact sheet, to look at before delivering.
      const sheet = options.sheet !== undefined ? inspectProject(project, { animation: gif.animation }).sheet : null;
      const written = await writeOutputs({ file: [options.out, data], ...(sheet && { sheet: [options.sheet, encodePNG(sheet.data, sheet.width, sheet.height)] }) }, options.force, inputsOf(input));
      print({ ok: true, name: project.name, ...gif, ...(names.length > 1 && { animations: names }), ...(kept && { kept }), ...(resized && { resized }), ...written, warnings: [...warnings, ...project.warnings.filter(text => !(resized?.cut && text.startsWith('Some drawing falls outside the canvas')))], ...(options.preset === undefined && referenced(input)) });
    } else if (command === 'gif-frames') {
      if (!positional[0] || positional[0] === '-') throw new Error('gif-frames requires a folder of numbered PNG frames');
      if (!options.out || !/\.gif$/i.test(options.out)) throw new Error('gif-frames requires --out <new.gif>');
      if (options.fps === undefined) throw new Error('gif-frames requires --fps, for example 12, 24, 25 or 30');
      const { folderGIF } = await import('../src/frame-folder.js');
      const { data, ...gif } = folderGIF(positional[0], { fps: options.fps, ...(options.loops !== undefined && { loops: Number(options.loops) }), ...(options.background !== undefined && { background: options.background }), ...(options.prefix !== undefined && { prefix: options.prefix }) });
      const written = await writeOutputs({ file: [options.out, data] }, options.force);
      print({ ok: true, ...gif, bytes: data.length, ...written });
    } else {
      const input = await readResolved(positional[0]);
      if (command === 'validate') { const project = renderProject(input.document); print({ ok: true, ...summary(project, input.document), ...(options.fps !== undefined && { frameGrid: frameGrid(project, options.fps) }), ...referenced(input) }); }
      else {
        if (!options.out) throw new Error('render requires --out <directory>');
        folderOut('render', options.out, 'name a new folder: the sheet, atlas and animations are written inside it (the sheet as <name>.png); for one GIF use pixelbolt gif --out <new.gif>');
        if (positional[0] === '-' && options.expect === '-') throw new Error('Only one input can use stdin');
        const expect = options.expect === undefined ? undefined : readExpect(await readJSONOption(options.expect));
        // The check runs before anything is written, so an unknown --animation writes nothing. render writes no GIFs.
        const bundle = await createBundle(input.document), check = checkDelivery(bundle.project, { recipe: input.document, expect, animation: options.animation });
        if (options['embed-recipe']) await embedBundleRecipe(bundle, input.document, await engineVersion());
        const expectFile = options.expect !== undefined && !String(options.expect).trimStart().startsWith('{') ? filesRead(options.expect) : [];
        const files = await writeBundle(bundle, options.out, { force: options.force, inputs: [...inputsOf(input), ...expectFile] });
        print({ ok: true, ...summary(bundle.project, input.document), ...bundleFiles(path.resolve(options.out), files, options), check: briefCheck(check), ...referenced(input) });
      }
    }
  }
} catch (error) {
  console.error(rowsJSON({ ok: false, ...errorReply(error) })); process.exitCode = 1;
}
