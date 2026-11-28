// Build a project's art from its manifest. Resolve and plan the whole delivery before touching outputs.
// The renderer owns every exported byte. Only recorded, unchanged files may be replaced without --force.
import { createHash } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, realpath, stat, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileAction, renderAction } from './actions.js';
import { errorReply, exportsStill, fail, isObject, isStills, meant, PixelError, portableName } from './core.js';
import { formatJSON, sameFiles } from './export.js';
import { animationGIF, renderProject } from './index.js';
import { COMPILERS, findPreset, loadPreset, PRESET_FOLDER } from './presets.js';
import { assertInside, linkPalette, resolveReferences } from './resolve.js';
import { readSize } from './resize.js';

const MANIFEST = 'pixelbolt.build.json', RECORD = 'pixelbolt.build.lock.json';
const NOTE = `Written by pixelbolt build: what it wrote, so it never replaces a file changed by hand. Commit it beside ${MANIFEST}; don't edit it.`;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const INPUTS = ['file', 'preset', 'module'];
const OPTIONS = { sheet: ['scale', 'columns'], bundle: ['scale', 'columns'], gif: ['scale', 'background', 'animation'], still: ['frame', 'scale'] };
const folderOutput = kind => kind === 'sheet' || kind === 'bundle';
const folded = process.platform === 'win32' || process.platform === 'darwin';
const fileKey = file => folded ? file.toLowerCase() : file;
const json = value => JSON.stringify(value, null, 2) + '\n';
const sha = data => 'sha256:' + createHash('sha256').update(data).digest('hex');
const fileHash = (file, bytes) => sha(/\.(json|tres|tsx|css|html|txt|js)$/i.test(file)
  ? Buffer.from(bytes.toString('latin1').replaceAll('\r\n', '\n'), 'latin1') : bytes);
const missing = error => { if (error.code !== 'ENOENT') throw error; return null; };
const readBytes = file => readFile(file).catch(missing);
function parseJSON(bytes, where) {
  try { return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); }
  catch (error) { fail(where, `expected valid JSON (${error.message})`); }
}
function unknown(key, keys) {
  const guess = meant(key, keys);
  return `unknown ${JSON.stringify(key)}${guess ? `; did you mean "${guess}"?` : ''}; choose from ${keys.join(', ')}`;
}
function checkFields(value, keys, where) {
  if (!isObject(value)) fail(where, 'expected an object');
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${where}.${key}`, unknown(key, keys));
}
function oneOf(value, keys, where) {
  const found = keys.filter(key => Object.hasOwn(value, key));
  if (found.length !== 1) fail(where, `expected exactly one of ${keys.join(', ')}`);
  return found[0];
}
function nonemptyArray(value, where) {
  if (!Array.isArray(value) || !value.length) fail(where, 'expected a non-empty array');
  return value;
}
function relative(value, where, folder = false) {
  if (typeof value !== 'string' || !value.trim() || path.win32.isAbsolute(value) || /^[a-z]:/i.test(value) || value.includes('\0'))
    fail(where, 'expected a non-empty relative path inside the manifest folder');
  const parts = value.split(/[/\\]/);
  if (parts.includes('..')) fail(where, 'a path must stay inside the manifest folder and contain no .. segment');
  if (process.platform === 'win32' && parts.some(part => part !== '.' && (/[<>:"|?*]|[. ]$/.test(part) || /^(con|nul|prn|aux|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))))
    fail(where, 'expected a Windows file path without reserved names or characters');
  const name = parts.filter(part => part && part !== '.').join('/') || '.';
  if (name === '.' && !folder) fail(where, 'expected a file inside the manifest folder');
  return name;
}
function outputSpec(value, where) {
  if (!isObject(value)) fail(where, 'expected an output object');
  const kind = oneOf(value, Object.keys(OPTIONS), where), keys = OPTIONS[kind];
  const dest = relative(value[kind], `${where}.${kind}`, folderOutput(kind));
  if (kind === 'gif' && !/\.gif$/i.test(dest)) fail(`${where}.gif`, 'pixelbolt gif requires a .gif file');
  if (kind === 'still' && !/\.png$/i.test(dest)) fail(`${where}.still`, 'expected a .png file');
  if (folderOutput(kind) && /\.(png|apng|gif|jpe?g|webp|json|tres|tsx|tmx|mov|mp4)$/i.test(dest)) fail(`${where}.${kind}`, 'pixelbolt render takes an output folder');
  for (const key of Object.keys(value)) if (key !== kind && !keys.includes(key)) {
    const command = kind === 'gif' ? 'pixelbolt gif' : `a ${kind} output`;
    fail(`${where}.${key}`, `${key} is not supported by a ${kind} output; ${command} takes ${new Intl.ListFormat('en').format(keys)}`);
  }
  const options = Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
  for (const [key, val] of Object.entries(options)) {
    if (key === 'scale') {
      if (!Number.isInteger(val) || val < 1 || val > 16) fail(`${where}.scale`, '--scale expects a whole number from 1 to 16');
    } else if (key === 'columns') {
      if (!Number.isInteger(val) || val < 1 || val > 999) fail(`${where}.columns`, '--columns expects a whole number from 1 to the frame count');
    } else if (typeof val !== 'string' || !val.trim()) fail(`${where}.${key}`, `expected a ${key === 'background' ? 'colour' : 'name'}`);
  }
  return { kind, dest, options, where, key: `${kind} ${dest}` };
}
function compileOptions(value, where) {
  if (value === undefined) return;
  checkFields(value, ['size', 'frames', 'animation'], where);
  const { size, frames } = value;
  if (size !== undefined) {
    if (typeof size !== 'string') fail(`${where}.size`, 'expected a canvas size such as "32x32"');
    readSize(size, `${where}.size`);
  }
  if (frames !== undefined && (!Number.isInteger(frames) || frames < 1 || frames > 256)) fail(`${where}.frames`, 'expected how many frames each animation keeps, a whole number from 1 to 256');
  const animation = typeof value.animation === 'string' ? value.animation.split(',') : value.animation;
  if (animation !== undefined && (!Array.isArray(animation) || !animation.length || animation.some(name => typeof name !== 'string' || !name.trim()))) fail(`${where}.animation`, 'expected one or more animation names');
  return { size, frames, animation };
}
function readEntries(manifest) {
  const seen = new Set();
  return nonemptyArray(manifest.entries, 'entries').map((value, index) => {
    const name = value?.name, at = `entries[${index}]`;
    if (typeof name !== 'string' || !NAME.test(name)) fail(`${at}.name`, 'expected 1–64 letters, digits, dots, underscores or hyphens, starting with a letter or digit');
    const where = `entries.${name}`;
    if (seen.has(name.toLowerCase())) fail(`${where}.name`, 'entry names must be unique ignoring case');
    seen.add(name.toLowerCase());
    checkFields(value, ['name', ...INPUTS, 'compile', 'outputs'], where);
    const kind = oneOf(value, INPUTS, where), field = `${where}.${kind}`;
    const input = kind === 'preset' ? value.preset : relative(value[kind], field);
    if (kind === 'preset' && (typeof input !== 'string' || !input.trim())) fail(field, 'expected a shipped preset name');
    if (kind === 'file' && !/\.json$/i.test(input)) fail(field, 'expected a .json recipe or compiler source');
    if (kind === 'module' && !/\.(js|mjs)$/i.test(input)) fail(field, 'expected a .js or .mjs module');
    const outputs = nonemptyArray(value.outputs, `${where}.outputs`).map((o, i) => outputSpec(o, `${where}.outputs[${i}]`));
    return { name, where, field, kind, input, compile: compileOptions(value.compile, `${where}.compile`), outputs };
  });
}

// assertInside checks existing links. Walk the parents too: a new leaf below a junction has no realpath yet.
// The canonical future path catches two spellings of an output even before either file exists.
function locations(root) {
  const cache = new Map();
  async function locate(file, where) {
    if (cache.has(file)) return cache.get(file);
    const disk = path.join(root, file);
    let real, info;
    if (file === '.') {
      real = await realpath(root);
      info = await stat(root);
    } else {
      const parent = await locate(path.posix.dirname(file), where);
      if (parent.info && !parent.info.isDirectory()) fail(where, `${parent.disk} is a file where a folder is required`);
      const link = await lstat(disk, { bigint: true }).catch(missing);
      info = link;
      real = path.join(parent.real, path.basename(file));
      if (link?.isSymbolicLink()) {
        await assertInside(disk, root, where);
        info = await stat(disk, { bigint: true }).catch(missing);
        if (!info) fail(where, `${file} is a dangling link`);
        real = await realpath(disk);
      } else if (link) real = await realpath(disk);
    }
    const result = { disk, real, info };
    cache.set(file, result);
    return result;
  }
  return locate;
}

// The CLI resolver can compile the colour source nested inside a normals input. Inline that source now but defer
// its compiler until a rebuild, so checking and skipping a normals entry cost no compilation either.
const compileNested = Symbol('compile colour source');
const deferredCompilers = Object.fromEntries(Object.entries(COMPILERS).map(([format, compiler]) =>
  [format, document => ({ recipe: { ...document, [compileNested]: compiler } })]));
const require = createRequire(import.meta.url), commonJSVersions = new WeakMap();
async function moduleValue(file, bytes) {
  const url = pathToFileURL(file), hash = sha(bytes).slice(7);
  url.searchParams.set('sha256', hash);
  // Node also exposes module.exports as a default export. Its CommonJS cache keys .js by real path alone.
  const key = await realpath(file), cached = require.cache[key];
  if (cached && commonJSVersions.get(cached) !== hash) delete require.cache[key];
  const { default: value } = await import(url.href);
  if (require.cache[key]) commonJSVersions.set(require.cache[key], hash);
  return value;
}
// When resolution fails partway, it cannot return the list of files it read. Reserve the named palettes and
// recipe references in that input so another entry can still build safely, even under --force.
async function protectReferences(value, baseDir, inputs, visited = new Set()) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (typeof child !== 'string' || !['recipe', '$ref'].includes(key)) {
      if (child && typeof child === 'object') await protectReferences(child, baseDir, inputs, visited);
      continue;
    }
    const file = path.resolve(baseDir, child);
    inputs.add(file);
    if (key === 'recipe' && !visited.has(file)) {
      visited.add(file);
      let nested;
      try {
        if ((await stat(file)).isFile()) nested = parseJSON(await readFile(file), file);
      } catch { continue; }
      await protectReferences(nested, path.dirname(file), inputs, visited);
    }
  }
}
async function loadInput(entry, directory, inputs) {
  let baseDir = directory, original;
  if (entry.kind === 'preset') {
    const preset = await findPreset(entry.input, entry.field);
    const file = path.join(PRESET_FOLDER, preset.file);
    inputs.add(file);
    const { source, inlined } = await loadPreset(preset);
    baseDir = PRESET_FOLDER;
    // Only a linked source needs its original palette link for compile's save/read round trip.
    original = inlined.length ? parseJSON(await readFile(file), entry.field) : source;
  } else {
    const file = path.join(directory, entry.input), bytes = await readFile(file);
    baseDir = path.dirname(file);
    if (entry.kind === 'module') {
      const value = await moduleValue(file, bytes);
      original = typeof value === 'function' ? await value({ name: entry.name, directory }) : value;
      if (!isObject(original)) fail(entry.field, 'expected a default export returning a recipe or compiler source');
      original = JSON.parse(JSON.stringify(original));
    } else original = parseJSON(bytes, entry.field);
  }
  if (original?.format === 'pixelforge-scene') fail(entry.field, 'scenes are not built from a manifest yet; use pixelbolt scene or pixelbolt gif');
  if (!isObject(original)) fail(entry.field, 'expected a recipe or compiler source object');
  const compilers = original.format === 'pixelforge-normals' ? deferredCompilers : COMPILERS;
  const resolution = await resolveReferences(original, { baseDir, compilers }).catch(async error => {
    await protectReferences(original, baseDir, inputs);
    throw error;
  });
  for (const file of resolution.files) inputs.add(file);
  const document = resolution.document, source = entry.kind === 'preset' || Object.hasOwn(COMPILERS, document.format);
  if (!source && entry.compile) fail(`${entry.where}.compile`, 'compile options require a compiler source or a preset; this input is already a recipe');
  const name = portableName(document.name ?? (document.format === 'pixelforge-normals' ? `${document.recipe?.name}-normal` : undefined), `${entry.field}.name`);
  return { document, name, source, baseDir, resolution };
}
async function makeRecipe(entry, directory, stats) {
  const { document, source, baseDir, resolution } = entry.loaded;
  if (!source) return document;
  let input = document;
  if (document.recipe?.[compileNested]) {
    stats.compiled++;
    input = { ...document, recipe: document.recipe[compileNested](document.recipe).recipe };
  }
  stats.compiled++;
  let { recipe } = compileAction(input, { ...entry.compile, ...(entry.kind === 'preset' && { preset: entry.input }), call: 'cli' });
  if (resolution.palettes.length && !(document.format === 'pixelforge-stack' && !entry.compile && entry.kind !== 'preset')) {
    recipe = linkPalette(recipe, { baseDir, resolution }, path.join(directory, MANIFEST));
    recipe = (await resolveReferences(recipe, { baseDir: directory, compilers: COMPILERS })).document;
  }
  return JSON.parse(JSON.stringify(recipe));
}

// Keep recipe object order: palettes, animations and the recipe JSON inside a bundle can all depend on it.
function fingerprint(entry, out, version) {
  const { document, resolution, source } = entry.loaded;
  return sha(JSON.stringify([1, version, entry.kind, entry.input, document,
    source && resolution.palettes.map(({ shared, sharedRamps }) => [shared, sharedRamps]), entry.compile, out.kind, out.dest, out.options]));
}
function sheetNames(name) { return [`${name}.png`, `${name}.atlas.json`]; }
function knownFiles(out, loaded) {
  if (!folderOutput(out.kind)) return [out.dest];
  if (!loaded) return [];
  const { name, document } = loaded, names = sheetNames(name);
  if (out.kind === 'bundle') {
    names.push(`${name}.pixel.json`, 'README.txt', 'preview.html');
    if (!loaded.source && Array.isArray(document.frames)) {
      for (const frame of document.frames) names.push(`frames/${portableName(frame?.name, 'project.frames.name')}.png`);
      if (!exportsStill(document, { ...document, sheet: document.sheet ?? {}, stills: isStills(document) })) {
        names.push(`${name}.css`, `${name}.tres`, 'player.js');
        for (const animation of Object.keys(document.animations ?? { default: {} })) names.push(`animations/${portableName(animation, 'project.animations')}.png`);
      }
    }
  }
  return names.map(name => path.posix.join(out.dest, name));
}

async function renderOutput(recipe, out, cache, stats) {
  const { kind, dest, options } = out;
  if (kind === 'gif') {
    if (!cache.has('gif')) { stats.rendered++; cache.set('gif', renderProject(recipe)); }
    const { scale, background, animation } = options;
    const { data } = animationGIF(cache.get('gif'), animation, { scale, background });
    return new Map([[dest, data]]);
  }
  const { scale, columns } = options, key = JSON.stringify([scale, columns]);
  if (!cache.has(key)) {
    stats.rendered++;
    cache.set(key, (await renderAction(recipe, { scale, columns, call: 'cli' })).bundle);
  }
  const { files, project } = cache.get(key);
  if (kind === 'still') {
    const frame = options.frame ?? project.frames[0].name, png = files.get(`frames/${frame}.png`);
    if (!png) fail(`${out.where}.frame`, `no frame named "${frame}"; choose from ${project.frames.slice(0, 12).map(f => f.name).join(', ')}`);
    return new Map([[dest, png]]);
  }
  const names = kind === 'sheet' ? sheetNames(project.name) : files.keys();
  return new Map(Array.from(names, name => [path.posix.join(dest, name), files.get(name)]));
}

function readRecord(bytes) {
  if (!bytes) return new Map();
  const record = parseJSON(bytes, RECORD);
  if (!isObject(record?.entries)) fail(RECORD, 'expected a build record with an entries object');
  for (const [name, entry] of Object.entries(record.entries)) {
    const where = `${RECORD}.entries.${name}`;
    if (!NAME.test(name) || !isObject(entry?.outputs)) fail(where, 'expected a named entry with recorded outputs');
    for (const [key, out] of Object.entries(entry.outputs)) {
      const space = key.indexOf(' '), kind = key.slice(0, space), dest = key.slice(space + 1);
      if (!Object.hasOwn(OPTIONS, kind) || relative(dest, where, folderOutput(kind)) !== dest || !isObject(out?.files) ||
          typeof out.pixelbolt !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(out.inputs))
        fail(where, `invalid recorded output "${key}"`);
      for (const [file, hash] of Object.entries(out.files)) {
        if (relative(file, where) !== file || !/^sha256:[a-f0-9]{64}$/.test(hash)) fail(where, `invalid recorded file "${file}"`);
        if (folderOutput(kind) ? (dest !== '.' && !file.startsWith(dest + '/')) : file !== dest) fail(where, `${file} does not belong to ${key}`);
      }
    }
  }
  return new Map(Object.entries(record.entries));
}
// JSON.stringify orders integer-like object keys numerically. Entry names may be numbers, so serialize each
// named entry in the Map's manifest order, with ordinary two-space JSON indentation.
function recordText(entries) {
  const lines = [...entries].map(([name, entry]) => `    ${JSON.stringify(name)}: ${JSON.stringify(entry, null, 2).replaceAll('\n', '\n    ')}`);
  return `{\n  "note": ${JSON.stringify(NOTE)},\n  "entries": {${lines.length ? '\n' + lines.join(',\n') + '\n  ' : ''}}\n}\n`;
}
function selectEntries(only, entries) {
  if (only === undefined) return new Set(entries.map(e => e.name));
  const names = entries.map(e => e.name), wanted = new Set();
  for (const name of (Array.isArray(only) ? only : only.split(',')).map(s => s.trim())) {
    const found = names.find(other => other.toLowerCase() === name.toLowerCase());
    if (!found) fail('--only', `${unknown(name, names)} (manifest entries)`);
    wanted.add(found);
  }
  return wanted;
}
function fieldError(error, where, options = {}) {
  if (!(error instanceof Error)) error = new Error(String(error));
  if (error instanceof PixelError && (error.path.startsWith('entries.') || error.errors)) return error;
  const key = Object.keys(options).find(key => error.path === `--${key}` || error.path?.endsWith(`.${key}`) || error.message.startsWith(`--${key} `));
  return new PixelError(key ? `${where}.${key}` : where, error.message);
}
function outputReport(result, list, out, files) {
  if (!files.length) return;
  if (out.kind === 'bundle') result[list].push({ folder: out.dest, files: files.length });
  else result[list].push(...files);
}
const refusal = (file, reason) => ({ file, reason, message: `${file} ${reason === 'edited' ? 'was changed by hand' : 'already exists without a matching build record'}; keep it or pass --force to replace it` });

// On a case-folding filesystem a renamed frame can still occupy the same file. Use the new spelling whenever
// possible so an old record never schedules that file for removal immediately after rebuilding it.
function withLeftovers(current, old) {
  const files = new Set(current), keys = new Set([...files].map(fileKey));
  for (const file of Object.keys(old ?? {})) if (!keys.has(fileKey(file))) files.add(file);
  return files;
}
const recordedHashes = out => new Map(Object.entries(out.old?.files ?? {}).map(([name, hash]) => [fileKey(name), hash]));

// Make ownership independent of entry order. Check both future paths (including junctions above a new folder)
// and existing file identities. A recorded leftover is also a write target: removing it must pass the same checks.
async function checkClaims(entries, directory, inputs, locate, keep) {
  const paths = new Map(), identities = new Map(), targets = new Map(), directories = new Set();
  const inputPaths = new Set([...inputs].map(file => fileKey(path.resolve(file))));
  async function claim(file, where) {
    const { real, disk, info } = await locate(file, where);
    const key = fileKey(real);
    if (inputPaths.has(fileKey(disk)) || inputPaths.has(key)) fail(where, `${file} would replace an input or the build record`);
    if (info && !info.isFile()) fail(where, `${file} must be a file; a folder or special file has that name`);
    const id = info?.ino ? `${info.dev}:${info.ino}` : undefined;
    const previous = paths.get(key) ?? identities.get(id);
    if (previous) fail(where, `two outputs would write ${file} (${previous} and ${where})`);
    paths.set(key, where);
    if (id) identities.set(id, where);
    targets.set(disk, where);
    for (let dir = path.dirname(key); !directories.has(dir); dir = path.dirname(dir)) {
      directories.add(dir);
      if (dir === path.dirname(dir)) break;
    }
  }
  for (const entry of entries) {
    for (const out of entry.outputs) {
      const names = withLeftovers([...out.known, ...(out.bytes?.keys() ?? [])], out.old?.files);
      for (const name of names) await claim(name, `${out.where}.${out.kind}`);
    }
    if (keep && entry.selected) await claim(entry.keep, '--keep');
  }
  for (const [key, where] of paths) if (directories.has(key)) fail(where, `one output needs ${key} as a folder and another as a file`);
  for (const key of inputPaths) if (directories.has(key)) fail('build', `an output needs ${key} as a folder, but it names an input or the build record`);
  const [same] = await sameFiles([...targets.keys()], [...inputs]);
  if (same) fail(targets.get(same), `${path.relative(directory, same)} would replace an input or the build record`);
}
async function examine(entry, out, version, locate) {
  const inputs = fingerprint(entry, out, version), old = out.old, problems = [];
  const report = (reason, message, file) => problems.push({ entry: entry.name, ...(file ? { file } : { output: out.key }), reason, message });
  if (old && old.pixelbolt !== version) report('version', `built by Pixelbolt ${old.pixelbolt}; running ${version}`);
  else if (old && old.inputs !== inputs) report('stale', 'the inputs or output options changed; run pixelbolt build');
  const files = withLeftovers(out.known, old?.files), hashes = recordedHashes(out);
  for (const file of files) {
    const bytes = await readBytes((await locate(file, out.where)).disk);
    const hash = bytes && fileHash(file, bytes), recorded = hashes.has(fileKey(file));
    // Once an output is recorded, its record says which files it makes: a predicted name it never wrote is no
    // missing file, or a wrong guess would keep the output stale for ever. Before any record, the names are a guess.
    if (!bytes) { if (recorded || !old) report('missing', `${file} is missing; run pixelbolt build`, file); }
    else if (!recorded) report('unrecorded', `${file} has no build record`, file);
    else if (hashes.get(fileKey(file)) !== hash) report('edited', `${file} differs from the recorded file`, file);
  }
  return { inputs, problems, files };
}
async function planOutput(entry, out, locate, version, options, result) {
  const { inputs, problems, files } = await examine(entry, out, version, locate);
  if (options.check) { result.problems.push(...problems); return; }
  if (!problems.length) { outputReport(result, 'skipped', out, [...files]); return; }
  // With identical inputs/version the recorded hash already tells us the bytes a render would make.
  const edits = problems.filter(p => p.reason === 'edited');
  if (out.old?.inputs === inputs && out.old.pixelbolt === version && edits.length && !options.force) {
    result.refused.push(...edits.map(p => refusal(p.file, 'edited')));
    return;
  }
  out.inputs = inputs;
  return true;
}
async function renderEntry(entry, directory, options, result) {
  const recipe = await makeRecipe(entry, directory, result.stats);
  if (options.keep !== undefined) entry.keepBytes = Buffer.from(formatJSON(recipe));
  const cache = new Map();
  for (const out of entry.outputs.filter(out => out.inputs)) {
    try {
      out.bytes = await renderOutput(recipe, out, cache, result.stats);
    } catch (error) { result.failed.push({ entry: entry.name, ...errorReply(fieldError(error, out.where, out.options)) }); }
  }
  if (cache.size) result.rendered.push(entry.name);
}

// Preflight every member of the group, retaining the original bytes for rollback. Exclusive creation protects a
// newly appeared file. Re-check existing bytes through the open handle before changing them.
async function applyChanges(changes) {
  const applied = [];
  try {
    for (const item of changes) {
      const { disk, before, after } = item;
      if (before === null) {
        await mkdir(path.dirname(disk), { recursive: true });
        const handle = await open(disk, 'wx');
        applied.push(item);
        try { await handle.writeFile(after); } finally { await handle.close(); }
      } else {
        const handle = await open(disk, after === null ? 'r' : 'r+');
        try {
          if (!(await handle.readFile()).equals(before)) fail(disk, 'changed during build; run pixelbolt build again');
          if (after !== null) {
            applied.push(item);
            if ((await handle.stat()).nlink > 1) {
              // Replacing this path must leave copies hard-linked under other names untouched.
              await unlink(disk);
              await writeFile(disk, after, { flag: 'wx' });
            } else {
              await handle.truncate(0);
              // readFile leaves the file position at EOF; start this replacement explicitly at byte zero.
              for (let offset = 0; offset < after.length;) offset += (await handle.write(after, offset, after.length - offset, offset)).bytesWritten;
            }
          }
        } finally { await handle.close(); }
        if (after === null) { await unlink(disk); applied.push(item); }
      }
    }
  } catch (error) {
    for (const { disk, before } of applied.reverse()) {
      if (before === null) await unlink(disk);
      else await writeFile(disk, before);
    }
    throw error;
  }
}
async function deliver(out, locate, force, result, version) {
  const changes = [], skipped = [], removed = [], files = Object.create(null), refused = [];
  const hashes = recordedHashes(out);
  for (const file of withLeftovers(out.bytes.keys(), out.old?.files)) {
    const disk = (await locate(file, out.where)).disk, before = await readBytes(disk);
    const previous = before && fileHash(file, before), after = out.bytes.get(file);
    if (after === undefined) {
      if (before === null) continue;
      if (previous !== hashes.get(fileKey(file))) {
        refused.push({ file, reason: 'edited', message: `${file} is no longer generated and was edited; move it to keep it or remove it and rebuild` });
      } else { changes.push({ disk, before, after: null }); removed.push(file); }
    } else {
      const hash = fileHash(file, after);
      files[file] = hash;
      if (hash === previous) skipped.push(file);
      else if (before && !force && previous !== hashes.get(fileKey(file))) refused.push(refusal(file, hashes.has(fileKey(file)) ? 'edited' : 'unrecorded'));
      else changes.push({ disk, before, after, file });
    }
  }
  if (refused.length) { result.refused.push(...refused); return; }
  await applyChanges(changes);
  outputReport(result, 'written', out, changes.filter(c => c.after !== null).map(c => c.file));
  outputReport(result, 'skipped', out, skipped);
  result.removed.push(...removed);
  return { pixelbolt: version, inputs: out.inputs, files };
}

async function init(directory, manifest, version) {
  if (await lstat(manifest).catch(missing)) fail(MANIFEST, `${manifest} already exists; --init only writes a first manifest`);
  const files = [], skipped = [], entries = [], used = new Set(), sheets = new Set();
  async function walk(folder) {
    for (const item of await readdir(path.join(directory, folder), { withFileTypes: true })) {
      const file = path.posix.join(folder, item.name);
      if (item.isSymbolicLink()) skipped.push({ file, reason: 'symbolic link' });
      else if (item.isDirectory()) {
        if (item.name.startsWith('.') || item.name === 'node_modules') skipped.push({ file, reason: 'excluded folder' });
        else await walk(file);
      } else if (item.isFile() && /\.json$/i.test(file)) files.push(file);
    }
  }
  await walk('.');
  for (const file of files.sort()) {
    const disk = path.join(directory, file), base = path.posix.basename(file);
    let reason, doc;
    if ([MANIFEST, RECORD].includes(base)) reason = 'build manifest or record';
    else if (/\.pixel\.json$/i.test(file) && await stat(disk.replace(/\.pixel\.json$/i, '.atlas.json')).catch(missing)) reason = 'exported recipe beside its atlas';
    else {
      try { doc = parseJSON(await readFile(disk), file); } catch (error) { reason = error.message; }
      if (!reason && doc?.format === 'pixelforge-scene') reason = 'scene';
      else if (!reason && doc?.format === 'pixelforge-normals') reason = 'normal pass for its colour recipe';
      else if (!reason && !Object.hasOwn(COMPILERS, doc?.format) && !(isObject(doc) && typeof doc.name === 'string' &&
        typeof doc.width === 'number' && typeof doc.height === 'number' && Array.isArray(doc.frames))) reason = 'not a recipe or compiler source';
    }
    if (reason) { skipped.push({ file, reason }); continue; }
    const stem = base.slice(0, -5).replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 64) || 'art';
    let name = stem;
    for (let i = 2; used.has(name.toLowerCase()); i++) {
      const suffix = `-${i}`;
      name = stem.slice(0, 64 - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    let sheet = path.posix.dirname(file);
    const sheetKey = () => fileKey(path.posix.join(sheet, `${doc.name}.png`));
    while (sheets.has(sheetKey())) sheet = path.posix.join(sheet, name);
    sheets.add(sheetKey());
    entries.push({ name, file, outputs: [{ sheet }] });
  }
  if (!entries.length) fail(MANIFEST, `no recipes or compiler sources found in ${directory}`);
  await writeFile(manifest, json({ pixelbolt: version, entries }), { flag: 'wx' });
  skipped.sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
  return { ok: true, manifest, entries: entries.map(e => e.name), ...(skipped.length && { skipped }), next: 'Run pixelbolt build. Pass --force to adopt existing files with different bytes.' };
}
function finish(result) {
  result.ok = !(result.problems.length || result.refused.length || result.failed.length);
  for (const [key, value] of Object.entries(result)) if (Array.isArray(value) && !value.length) delete result[key];
  return result;
}

// Build, check, or initialize a manifest. Supplying version lets a caller exercise version changes offline.
export async function build(target = '.', options = {}, version = options.version) {
  if (options.init && (options.check || options.only !== undefined || options.keep !== undefined)) fail('--init', 'cannot be combined with --check, --only or --keep');
  if (options.check && (options.force || options.keep !== undefined)) fail('--check', 'cannot be combined with --force or --keep');
  const absolute = path.resolve(target), info = await stat(absolute).catch(missing);
  let directory = absolute;
  if (!info?.isDirectory()) {
    if (options.init || path.basename(absolute) !== MANIFEST) fail('build', `expected a folder or ${MANIFEST}; that is the manifest name the build reads`);
    directory = path.dirname(absolute);
  }
  const manifest = path.join(directory, MANIFEST), record = path.join(directory, RECORD);
  version ??= JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
  if (options.init) return init(directory, manifest, version);
  let locate = locations(directory);
  await locate(MANIFEST, MANIFEST);
  const bytes = await readBytes(manifest);
  if (!bytes) fail(MANIFEST, `missing in ${directory}; run pixelbolt build --init`);
  const spec = parseJSON(bytes, MANIFEST);
  checkFields(spec, ['pixelbolt', 'entries'], MANIFEST);
  const result = { ok: true, manifest, written: [], skipped: [], refused: [], removed: [], orphaned: [], failed: [],
    problems: [], rendered: [], record, stats: { compiled: 0, rendered: 0 } };
  if (spec.pixelbolt !== undefined && (typeof spec.pixelbolt !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(spec.pixelbolt))) fail('pixelbolt', 'expected an exact Pixelbolt version such as "0.22.0"');
  if (spec.pixelbolt !== undefined && spec.pixelbolt !== version) {
    const message = `manifest pins Pixelbolt ${spec.pixelbolt}, running ${version}; run npx pixelbolt@${spec.pixelbolt} build or change the pin`;
    if (!options.check) fail('pixelbolt', message);
    result.problems.push({ file: MANIFEST, reason: 'version', message });
    return finish(result);
  }
  const entries = readEntries(spec), selected = selectEntries(options.only, entries);
  await locate(RECORD, RECORD);
  const oldBytes = await readBytes(record), oldEntries = readRecord(oldBytes), nextEntries = new Map();
  const inputs = new Set([manifest]);
  const keep = options.keep === undefined ? undefined : relative(options.keep, '--keep', true);
  // Resolve inputs for ownership even with --only: another entry's shared palette must never become an output.
  for (const entry of entries) {
    entry.selected = selected.has(entry.name);
    if (entry.kind !== 'preset') {
      const { disk, real } = await locate(entry.input, entry.field);
      inputs.add(disk);
      inputs.add(real);
    }
    if (keep && entry.selected) entry.keep = relative(path.posix.join(keep, `${entry.name}.json`), '--keep');
    for (const out of entry.outputs) if (folderOutput(out.kind)) await locate(out.dest, `${out.where}.${out.kind}`);
    const old = oldEntries.get(entry.name)?.outputs ?? {};
    for (const out of entry.outputs) {
      out.old = Object.hasOwn(old, out.key) ? old[out.key] : undefined;
      out.known = knownFiles(out);
    }
    try {
      const loaded = await loadInput(entry, directory, inputs);
      for (const out of entry.outputs) out.known = knownFiles(out, loaded);
      entry.loaded = loaded;
    } catch (error) { if (entry.selected) result.failed.push({ entry: entry.name, ...errorReply(fieldError(error, entry.field)) }); }
  }
  // Module factories have now finished. Check paths against the current filesystem.
  locate = locations(directory);
  const realRecord = (await locate(RECORD, RECORD)).real;
  if ([...inputs].some(file => [record, realRecord].some(target => fileKey(file) === fileKey(target))) || (await sameFiles([record], [...inputs])).length) fail(RECORD, 'the build record would replace an input');
  inputs.add(record);
  inputs.add(realRecord);
  await checkClaims(entries, directory, inputs, locate, keep);
  for (const entry of entries.filter(e => e.selected && e.loaded)) {
    let needed = false;
    for (const out of entry.outputs) {
      try { if (await planOutput(entry, out, locate, version, options, result)) needed = true; }
      catch (error) { result.failed.push({ entry: entry.name, ...errorReply(fieldError(error, out.where)) }); }
    }
    if (needed) {
      try { await renderEntry(entry, directory, options, result); }
      catch (error) { result.failed.push({ entry: entry.name, ...errorReply(fieldError(error, entry.compile ? `${entry.where}.compile` : entry.field, entry.compile)) }); }
    } else if (keep && !entry.loaded.source) entry.keepBytes = Buffer.from(formatJSON(entry.loaded.document));
  }
  if (options.check) return finish(result);
  if (result.rendered.length) await checkClaims(entries, directory, inputs, locate, keep);
  for (const entry of entries) {
    const old = oldEntries.get(entry.name);
    if (!entry.selected) {
      if (old) nextEntries.set(entry.name, old);
      continue;
    }
    const outputs = Object.create(null);
    for (const out of entry.outputs) {
      let saved = out.old;
      if (out.bytes) {
        try { saved = await deliver(out, locate, options.force, result, version) ?? saved; }
        catch (error) { result.failed.push({ entry: entry.name, ...errorReply(fieldError(error, out.where)) }); }
      }
      if (saved) outputs[out.key] = saved;
    }
    if (Object.keys(outputs).length) nextEntries.set(entry.name, { outputs });
    for (const output of Object.keys(old?.outputs ?? {})) {
      if (!entry.outputs.some(o => o.key === output)) result.orphaned.push({ entry: entry.name, output });
    }
    if (entry.keepBytes) {
      try {
        const disk = (await locate(entry.keep, '--keep')).disk, before = await readBytes(disk);
        if (before && !options.force) result.refused.push({ file: entry.keep, reason: 'existing', message: 'kept recipe exists; choose another --keep folder or pass --force' });
        else if (before && fileHash(entry.keep, before) === fileHash(entry.keep, entry.keepBytes)) result.skipped.push(entry.keep);
        else { await applyChanges([{ disk, before, after: entry.keepBytes }]); result.written.push(entry.keep); }
      } catch (error) { result.failed.push({ entry: entry.name, ...errorReply(fieldError(error, '--keep')) }); }
    }
  }
  for (const [name, old] of oldEntries) if (!entries.some(entry => entry.name === name)) {
    if (options.only !== undefined) nextEntries.set(name, old);
    else for (const output of Object.keys(old.outputs)) result.orphaned.push({ entry: name, output });
  }
  const after = Buffer.from(recordText(nextEntries));
  if ((oldBytes || nextEntries.size) && (!oldBytes || fileHash(RECORD, oldBytes) !== fileHash(RECORD, after))) {
    await applyChanges([{ disk: record, before: oldBytes, after }]);
  }
  return finish(result);
}
