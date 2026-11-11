#!/usr/bin/env node
// Offline, dependency-free builder. Run from the site root:
//   node gallery/data/build.mjs --engine _engine
// Only gallery output and _work/gallery-build are written; the engine is read-only.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const gallery = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.dirname(gallery);
const work = path.join(root, '_work', 'gallery-build');
const VERSION = '0.15.0', DATE = '2026-11-11';
const SITE = 'https://skulitom.github.io/Pixelbolt/';
const REPO = 'https://github.com/skulitom/Pixelbolt';
const RAW = `https://raw.githubusercontent.com/skulitom/Pixelbolt/v${VERSION}/`;
const NPX = `npx -y pixelbolt@${VERSION}`;
const BG = [27, 29, 42, 255];
const groups = [
  ['falling-sand', 'Falling sand', 'hut-fire lava-falls stilt-hut rain-on-fire quarry-blast'],
  ['phase-changes', 'Phase changes', 'ice-melt pond-freeze boiling-pot frost-window dry-ice', true],
  ['electricity', 'Electricity', 'jacobs-ladder lightning plasma-globe lightning-pond', true],
  ['fire-smoke-gas', 'Fire, smoke and gas', 'campfire torch steam-vent magic-swirl explosion smoke-puff dust-wave', true],
  ['liquids', 'Liquids', 'waterfall drip potion splash honey slime roof-snow dam-break slime-burst honey-drop aquarium honey-dipper glug', true],
  ['sand-grains', 'Sand grains', 'hourglass sand-gate sand-plough', true],
  ['bodies-in-fluid', 'Bodies in a fluid', 'crate-splash sand-slide water-wheel hot-stone plank-tip', true],
  ['rigid-bodies', 'Rigid bodies, ropes and cloth', 'ring-escape bouncing-pixel spinning-hoop crate-topple crate-smash territory blade-bloom rope-bridge wrecking-ball ragdoll flag cape'],
  ['crystal-growth', 'Crystal growth', 'geode quartz-cluster pyrite snowflakes'],
  ['particle-spell-effects', 'Particle and spell effects', 'effects fire-explosion fire-spells fireball fluid-blast healing-circle hero-magic holy-spells ice-spells lightning-spells lightning-strike meteor poison-spells shadow-spells shield slash-hit swing-trail vortex water water-spells'],
  ['waves', 'Waves', 'interference portal'],
  ['characters-motion', 'Characters and motion', 'hero knight hero-sword fox hermit-chest slime-idle swing'],
  ['hand-drawn-sprites', 'Hand-drawn sprites', 'coin ember shrine forest-spirit'],
  ['tile-sets', 'Tile sets', 'ground meadow shore iso-tiles'],
  ['scenes', 'Scenes', 'forest-spirit-lit iso-glade room room-night wave-scene']
].map(([id, name, names, fluid = false]) => ({ id, name, names: names.split(' '), fluid }));
// The fluid groups are adjacent and sit under one "Fluid simulations" heading.
const fluidGroups = groups.filter(g => g.fluid).map(g => g.id);
const extras = [
  { name: 'forest-spirit', kind: 'recipe', file: 'examples/forest-spirit.json', for: 'A hand-drawn forest spirit: idle, bob and blink.' },
  ...['ground', 'meadow', 'shore'].map(name => ({ name, kind: 'autotile', file: `examples/${name}.autotile.json`, for: ({ ground: 'Side-view platformer ground with slopes, stones and collision boxes, on its test map.', meadow: 'A top-down meadow over dirt with rare flowers, on its test map.', shore: 'A layered shore of water, sand and grass, on its test map.' })[name] })),
  { name: 'forest-spirit-lit', kind: 'scene', file: 'examples/forest-spirit-lit.scene.json', for: 'A forest spirit lit through its normal pass.' },
  { name: 'iso-glade', title: 'Isometric glade', kind: 'scene', file: 'examples/iso-glade.scene.json', for: 'An isometric glade laid out on a 2:1 diamond grid from the iso tile set, with a coin hovering over one cell.' },
  { name: 'room', title: 'Diorama room', kind: 'scene', file: 'showcase/diorama/art/room.scene.json', copyGif: 'docs/images/diorama/room.gif', copyStill: 'docs/images/diorama/room.png', for: 'A dungeon diorama with a waterfall, torches and a hero breaking a pot.' },
  { name: 'room-night', title: 'Diorama by torchlight', kind: 'scene', file: 'showcase/diorama/art/room-night.scene.json', copyGif: 'docs/images/diorama/room-night.gif', copyStill: 'docs/images/diorama/room-night.png', for: 'Torches and candles flicker; the room flashes when the hero breaks a pot.' },
  { name: 'wave-scene', title: 'Wave scene', kind: 'scene', file: 'showcase/waves/scene.scene.json', copyGif: 'showcase/waves/scene.gif', copyStill: 'showcase/waves/scene.png', for: 'Paired cyan waves and a violet portal in a small game scene.' }
];
const candidates = 'campfire torch steam-vent magic-swirl waterfall potion honey drip plasma-globe jacobs-ladder boiling-pot aquarium vortex shield portal'.split(' ');
const omitted = [
  { file: 'examples/quality/', reason: 'not shown' },
  { file: 'examples/caption.json', reason: 'old caption' },
  { file: 'examples/effects.json', reason: 'compiled copy of effects.fx.json' },
  { file: 'examples/swing.json', reason: 'compiled copy of swing.poses.json' },
  { file: 'examples/forest-spirit-normal.json', reason: 'lighting pass used by the lit scene' },
  { file: 'examples/forest-spirit.normals.json', reason: 'lighting normal source for the lit scene' },
  { file: 'examples/fix-one-frame/', reason: 'inputs of the fix-one-frame walk-through', url: `${REPO}/blob/v${VERSION}/docs/fix-one-frame.md` },
  { file: 'examples/*.brief.md', reason: 'design briefs for the fox, hero and knight rigs' },
  { file: 'showcase/gallery/', reason: 'room generator scripts are not in the repository', url: `${REPO}/tree/v${VERSION}/showcase/gallery` }
];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const writeJSON = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n');
const slash = value => value.split(path.sep).join('/');
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const TITLES = { 'jacobs-ladder': "Jacob's Ladder" };
const title = name => TITLES[name] ?? name.split('-').map(s => s[0].toUpperCase() + s.slice(1)).join(' ');
const scaleFor = (w, h) => Math.max(1, Math.min(4, Math.ceil(128 / Math.max(w, h))));
const gcd = (a, b) => b ? gcd(b, a % b) : a;
const lcm = (a, b) => a / gcd(a, b) * b;
let engine, cli, api, playground, commandCount = 0;
const warnings = [], projects = new Map();

async function filesUnder(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), `Refusing symbolic link: ${path.join(directory, entry.name)}`);
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(file));
    else if (entry.isFile()) files.push(file);
  }
  return files.sort();
}
async function resetDirectory(directory, parent) {
  // Resolve and check the final absolute deletion target, including its existing parents.
  await fs.mkdir(parent, { recursive: true });
  const realParent = await fs.realpath(parent);
  assert(path.dirname(directory) === parent && path.basename(directory) !== '..', `Unsafe cleanup target: ${directory}`);
  const safe = path.join(realParent, path.basename(directory));
  const stat = await fs.lstat(directory).catch(e => { if (e.code !== 'ENOENT') throw e; });
  if (stat) {
    assert(!stat.isSymbolicLink() && await fs.realpath(directory) === safe, `Unsafe cleanup target: ${directory}`);
    await filesUnder(directory); // Reject links inside the tree, too.
    await fs.rm(directory, { recursive: true, force: true });
  }
  await fs.mkdir(directory, { recursive: true });
}
function run(args, cwd = work, allowLongShare = false) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  commandCount++;
  if (result.error) throw new Error(`Command could not run: pixelbolt ${args.join(' ')}: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    const long = detail.match(/makes a ([\d,]+)-character link, over the 16,384-character limit/);
    if (allowLongShare && long) return { tooLong: true, characters: Number(long[1].replaceAll(',', '')) };
    throw new Error(`Command failed (${result.status}): pixelbolt ${args.join(' ')}\n${detail}`);
  }
  try { return JSON.parse(result.stdout); }
  catch { throw new Error(`Command returned invalid JSON: pixelbolt ${args.join(' ')}`); }
}
async function resolved(file) {
  return api.resolveReferences(await json(file), { baseDir: path.dirname(file), root: engine });
}
async function copyEngineFile(source, destination) {
  const from = path.resolve(engine, source);
  assert(!path.relative(engine, from).startsWith('..'), `Source outside engine: ${source}`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(from, destination);
}
async function executeCommands(piece, directory, recipe) {
  const commands = [];
  const exec = args => { commands.push(`${NPX} ${args.join(' ')}`); return run(args, directory); };
  if (piece.preset) {
    exec(['compile', '--preset', piece.name, '--out', `${piece.name}.json`]);
    exec(['render', `${piece.name}.json`, '--out', piece.name]);
  } else if (piece.copyGif) {
    commands.push(`git clone --depth 1 --branch v${VERSION} ${REPO}.git`, 'cd Pixelbolt');
    const checkout = path.join(directory, 'Pixelbolt');
    // An offline clone: copy the complete engine tree, never invoke git or the network.
    await fs.cp(engine, checkout, { recursive: true, filter: source => !['.git', 'node_modules'].includes(path.basename(source)) });
    const args = ['scene', piece.file, '--out', piece.name];
    commands.push(`node bin/pixelbolt.js ${args.join(' ')}`);
    run(args, checkout);
    // A scene bundle contains asset sheets/atlases/Godot files; sequence supplies its numbered frames.
    const sequence = ['sequence', piece.file, '--out', `${piece.name}/frames`, '--fps', '25', '--size', `${recipe.width}x${recipe.height}`, '--scale', '1'];
    commands.push(`node bin/pixelbolt.js ${sequence.join(' ')}`);
    run(sequence, checkout);
  } else {
    const resolution = await resolved(path.join(engine, piece.file));
    const inputs = [path.join(engine, piece.file), ...resolution.files];
    const basenames = new Set();
    for (const source of [...new Set(inputs)]) {
      const name = path.basename(source);
      assert(!basenames.has(name), `curl basename collision for ${piece.name}: ${name}`);
      basenames.add(name);
      commands.push(`curl -LO ${RAW}${slash(path.relative(engine, source))}`);
      await copyEngineFile(path.relative(engine, source), path.join(directory, name));
    }
    const source = path.basename(piece.file);
    if (piece.kind === 'autotile') {
      exec(['autotile', source, '--out', `${piece.name}.json`, '--preview', `${piece.name}-map.png`]);
      exec(['render', `${piece.name}.json`, '--out', piece.name]);
    } else if (piece.kind === 'scene') {
      exec(['scene', source, '--out', piece.name]);
      exec(['sequence', source, '--out', `${piece.name}/frames`, '--fps', '25', '--size', `${recipe.width}x${recipe.height}`, '--scale', '1']);
    } else exec(['render', source, '--out', piece.name]);
  }
  return commands;
}
function colorCount(frames) {
  const colors = new Set();
  for (const { data } of frames) for (let i = 0; i < data.length; i += 4) if (data[i + 3]) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}`);
  return colors.size;
}
// Read GIF metadata and used palette indices, including local palettes. No GIF encoder here.
function gifFacts(bytes) {
  assert(/^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6)), 'Invalid GIF header');
  const width = bytes.readUInt16LE(6), height = bytes.readUInt16LE(8);
  let at = 13, table = [], transparent = -1, delay = 0, frames = 0, duration = 0, loops = 1;
  const colors = new Set(), delays = [];
  const palette = packed => {
    const count = 1 << ((packed & 7) + 1), result = [];
    for (let i = 0; i < count; i++, at += 3) result.push(bytes.subarray(at, at + 3).toString('hex'));
    return result;
  };
  if (bytes[10] & 128) table = palette(bytes[10]);
  const blocks = () => {
    const parts = [];
    while (bytes[at]) { const length = bytes[at++]; parts.push(bytes.subarray(at, at + length)); at += length; }
    at++; return Buffer.concat(parts);
  };
  while (at < bytes.length) {
    const marker = bytes[at++];
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      const label = bytes[at++], data = blocks();
      if (label === 0xf9) { delay = data.readUInt16LE(1) * 10; transparent = data[0] & 1 ? data[3] : -1; }
      if (label === 0xff && data.toString('ascii', 0, 11) === 'NETSCAPE2.0') { const repeats = data.readUInt16LE(12); loops = repeats === 0 ? 0 : repeats + 1; }
    } else if (marker === 0x2c) {
      const packed = bytes[at + 8]; at += 9;
      const active = packed & 128 ? palette(packed) : table;
      const minimum = bytes[at++], compressed = blocks(), clear = 1 << minimum, end = clear + 1;
      let dictionary, size, next, previous, bit = 0;
      const reset = () => { dictionary = Array.from({ length: clear }, (_, i) => [i]); size = minimum + 1; next = end + 1; previous = null; };
      reset();
      for (;;) {
        assert(bit + size <= compressed.length * 8, 'Truncated GIF image data');
        let code = 0;
        for (let b = 0; b < size; b++, bit++) code |= ((compressed[bit >> 3] >> (bit & 7)) & 1) << b;
        if (code === clear) { reset(); continue; }
        if (code === end) break;
        const entry = dictionary[code] ?? (code === next && previous ? [...previous, previous[0]] : null);
        assert(entry, 'Invalid GIF LZW code');
        for (const index of entry) if (index !== transparent) { assert(active[index], 'GIF palette index missing'); colors.add(active[index]); }
        if (previous && next < 4096) { dictionary[next++] = [...previous, entry[0]]; if (next === 1 << size && size < 12) size++; }
        previous = entry;
      }
      frames++; duration += delay; delays.push(delay); transparent = -1; delay = 0;
    } else throw new Error(`Invalid GIF block: ${marker}`);
  }
  assert(frames > 0 && at === bytes.length, 'Incomplete GIF');
  return { width, height, frames, durationMs: duration, plays: loops === 0 ? 'loop' : 'one-shot', colors: colors.size, delaysMs: delays };
}
function animationSelection(animations) {
  const names = Object.keys(animations), directions = new Set();
  const shown = names.filter(name => {
    const match = name.match(/^(.*)-(0|45|90|135|180|225|270|315)$/);
    if (!match || !names.includes(`${match[1]}-0`)) return true;
    if (directions.has(match[1])) return false;
    directions.add(match[1]); return true;
  }).slice(0, 4);
  return { shown, also: names.filter(name => !shown.includes(name)) };
}
// A one-shot plays once in a game. A gallery GIF that played once would sit on its last (often empty) frame by the
// time a lazy image scrolls into view, so its preview loops and holds the last frame before each replay.
const HOLD_MS = 800;
function loopedOneShot(sequence, frames, project, scale) {
  const timed = frames.map((frame, position) => ({ data: frame.data, duration: frame.duration + (position === frames.length - 1 ? HOLD_MS : 0) }));
  const gif = api.encodeGIF(timed, project.width, project.height, { loop: true, scale });
  assert(gif.delays.length === frames.length && gif.delays.at(-1) >= HOLD_MS, `One-shot preview of ${sequence.frames.length} frames lost frames or its hold`);
  return gif.data;
}
function enlarge(data, width, height, scale) {
  const out = Buffer.alloc(width * height * scale * scale * 4), w = width * scale;
  for (let y = 0; y < height * scale; y++) for (let x = 0; x < w; x++) {
    const source = (Math.floor(y / scale) * width + Math.floor(x / scale)) * 4;
    out.set(data.subarray(source, source + 4), (y * w + x) * 4);
  }
  return out;
}
async function makePiece(input, readmeAlts) {
  const piece = { ...input, title: input.title ?? title(input.name) };
  delete piece.moreAnimations; // The manifest below contains the complete animation list.
  const group = groups.find(g => g.names.includes(piece.name));
  piece.group = group.name; piece.groupId = group.id;
  piece.recipeUrl = `${REPO}/blob/v${VERSION}/${piece.file}`;
  const source = path.join(engine, piece.file), original = await json(source);
  const directory = path.join(work, piece.name);
  await fs.mkdir(directory, { recursive: true });
  piece.commands = await executeCommands(piece, directory, original);
  piece.alt = readmeAlts.get(piece.name) ?? piece.for;
  // People read the card: the README's own sentence where there is one, else the preset text without its agent-facing
  // tail (the facts line already says loop or one-shot).
  piece.description = readmeAlts.has(piece.name) ? `${readmeAlts.get(piece.name)}.` : piece.for.replace(/ A simulated (liquid, not a character|gas)\.$/, '').replace(/ · (loop|one-shot)\.$/, '.');
  piece.altSource = readmeAlts.has(piece.name) ? 'README.md: first matching showcase image' : 'description';
  if (piece.kind === 'fluid' && !readmeAlts.has(piece.name)) warnings.push(`${piece.name}: README has no matching fluid image; alt text uses the preset description.`);
  const shared = run(['share', source], directory, true);
  piece.playground = shared.link ?? null;
  piece.playgroundCharacters = shared.characters;
  piece.playgroundReason = shared.tooLong ? `${shared.characters} characters exceeds the 16384-character playground limit` : null;
  if (shared.tooLong) {
    piece.download = `data/recipes/${piece.name}.json`;
    const document = (await resolved(source)).document;
    await writeJSON(path.join(gallery, piece.download), document);
    // The playground's own check: it opens fluid, fx, poses, scene, autotile and normals sources, but not every
    // source format (falling sand and rigid bodies compile only with the CLI or MCP).
    try { playground.recipeKind(document); piece.playgroundOpens = true; } catch { piece.playgroundOpens = false; }
  }
  piece.images = [];
  if (piece.kind === 'scene') {
    piece.size = `${original.width}x${original.height}`;
    const target = path.join(gallery, 'gifs', `${piece.name}.gif`), still = `gifs/${piece.name}-still.png`;
    if (piece.copyGif) { await copyEngineFile(piece.copyGif, target); await copyEngineFile(piece.copyStill, path.join(gallery, still)); }
    else {
      const scale = scaleFor(original.width, original.height), frames = path.join(directory, 'gallery-frames');
      run(['sequence', source, '--out', frames, '--fps', '25', '--size', `${original.width * scale}x${original.height * scale}`, '--scale', String(scale)], directory);
      run(['gif-frames', frames, '--fps', '25', '--out', target, '--loops', '0'], directory);
      const numbered = (await fs.readdir(frames)).filter(name => name.endsWith('.png')).sort();
      await fs.copyFile(path.join(frames, numbered[Math.floor(numbered.length / 2)]), path.join(gallery, still));
    }
    const facts = gifFacts(await fs.readFile(target));
    piece.frames = facts.frames; piece.plays = facts.plays; piece.colors = facts.colors;
    piece.animations = { scene: { frames: facts.frames, durationMs: facts.durationMs, plays: facts.plays } };
    piece.shownAnimations = ['scene']; piece.alsoAnimations = [];
    piece.images.push({ animation: 'scene', path: `gifs/${piece.name}.gif`, still, ...facts });
    piece.factsNote = 'Scene size; frame and colour counts describe the displayed GIF.';
  } else {
    const recipeFile = piece.preset || piece.kind === 'autotile' ? path.join(directory, `${piece.name}.json`) : source;
    const recipe = await json(recipeFile), project = api.renderProject(recipe);
    if (candidates.includes(piece.name)) projects.set(piece.name, project);
    piece.size = `${project.width}x${project.height}`; piece.frames = project.frames.length;
    piece.colors = colorCount(project.frames);
    piece.animations = Object.fromEntries(Object.entries(project.animations).map(([name, a]) => [name, { frames: a.frames.length, durationMs: a.duration, plays: a.loop ? 'loop' : 'one-shot' }]));
    const loops = new Set(Object.values(project.animations).map(a => a.loop));
    piece.plays = loops.size > 1 ? 'loops and one-shots' : loops.has(true) ? 'loop' : 'one-shot';
    const { shown, also } = animationSelection(project.animations);
    piece.shownAnimations = shown; piece.alsoAnimations = also;
    if (piece.kind === 'autotile') {
      const map = api.decodePNG(await fs.readFile(path.join(directory, `${piece.name}-map.png`)));
      const scale = scaleFor(map.width, map.height), image = `gifs/${piece.name}.png`;
      await fs.writeFile(path.join(gallery, image), api.encodePNG(enlarge(map.data, map.width, map.height, scale), map.width * scale, map.height * scale));
      piece.images.push({ animation: 'test map', path: image, width: map.width * scale, height: map.height * scale, scale, plays: 'still' });
      piece.plays = 'still'; piece.animations = {}; piece.shownAnimations = []; piece.alsoAnimations = [];
      piece.factsNote = 'Tile size and tile-frame count; preview shows the static test map.';
    } else for (const animation of shown) {
      const sequence = project.animations[animation], frames = sequence.frames.map(i => project.frames[i]);
      const scale = scaleFor(project.width, project.height);
      const still = frames.every(f => Buffer.from(f.data).equals(Buffer.from(frames[0].data)));
      const image = `gifs/${piece.name}--${animation}.${still ? 'png' : 'gif'}`;
      if (still) await fs.writeFile(path.join(gallery, image), api.encodePNG(enlarge(frames[0].data, project.width, project.height, scale), project.width * scale, project.height * scale));
      else if (sequence.loop) run(['gif', recipeFile, '--animation', animation, '--scale', String(scale), '--out', path.join(gallery, image)], directory);
      else await fs.writeFile(path.join(gallery, image), loopedOneShot(sequence, frames, project, scale));
      const facts = still ? { width: project.width * scale, height: project.height * scale, frames: 1, plays: 'still' } : gifFacts(await fs.readFile(path.join(gallery, image)));
      if (!still && !sequence.loop) { assert(facts.plays === 'loop', `${image}: a one-shot preview must loop`); facts.plays = 'one-shot, looped here'; }
      // Visitors who ask for reduced motion get the middle frame as a still, as the guides do.
      let stillImage;
      if (!still) {
        stillImage = `gifs/${piece.name}--${animation}-still.png`;
        const middle = frames[Math.floor(frames.length / 2)];
        await fs.writeFile(path.join(gallery, stillImage), api.encodePNG(enlarge(middle.data, project.width, project.height, scale), project.width * scale, project.height * scale));
      }
      piece.images.push({ animation, path: image, ...(stillImage ? { still: stillImage } : {}), scale, ...facts });
    }
  }
  piece.gifPaths = piece.images.filter(i => i.path.endsWith('.gif')).map(i => i.path);
  for (const image of piece.images) { image.bytes = (await fs.stat(path.join(gallery, image.path))).size; if (image.path.endsWith('.gif')) assert(image.bytes <= 1_500_000, `${image.path} exceeds 1.5 MB (${image.bytes} bytes)`); }
  return piece;
}

function canvas(width, height) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(BG, i);
  return data;
}
function drawCell(data, width, height, project, frame, cell) {
  const scale = Math.floor(Math.min(cell.width / project.width, cell.height / project.height));
  assert(scale >= 1, 'Montage candidate does not fit its cell');
  const left = cell.x + Math.floor((cell.width - project.width * scale) / 2), top = cell.y + Math.floor((cell.height - project.height * scale) / 2);
  for (let y = 0; y < project.height * scale; y++) for (let x = 0; x < project.width * scale; x++) {
    const from = (Math.floor(y / scale) * project.width + Math.floor(x / scale)) * 4;
    assert(frame.data[from + 3] === 0 || frame.data[from + 3] === 255, 'Montage requires exact opaque or transparent source pixels');
    if (!frame.data[from + 3]) continue;
    assert(left + x < width && top + y < height, 'Montage pixel outside canvas');
    data.set(frame.data.subarray(from, from + 4), ((top + y) * width + left + x) * 4);
  }
}
function frameAt(project, animation, time) {
  const sequence = project.animations[animation];
  let at = time % sequence.duration;
  for (const index of sequence.frames) { const frame = project.frames[index]; if (at < frame.duration) return frame; at -= frame.duration; }
  throw new Error('Animation duration disagrees with frames');
}
async function makeMontage() {
  const available = candidates.map(name => {
    const project = projects.get(name), animation = Object.keys(project.animations)[0], sequence = project.animations[animation];
    const colors = new Set([BG.slice(0, 3).join(',')]);
    let exact = true;
    for (const i of sequence.frames) {
      const frame = project.frames[i];
      exact &&= frame.duration >= 20 && frame.duration % 10 === 0;
      for (let at = 0; at < frame.data.length; at += 4) {
        if (frame.data[at + 3] !== 0 && frame.data[at + 3] !== 255) exact = false;
        if (frame.data[at + 3]) colors.add(`${frame.data[at]},${frame.data[at + 1]},${frame.data[at + 2]}`);
      }
    }
    return { name, project, animation, duration: sequence.duration, colors, fits: sequence.loop && exact && project.width <= 96 && project.height <= 96 };
  }).filter(c => c.fits);
  // Deterministic backtracking swaps incompatible candidates (duration or palette) for later ones.
  function choose(from, selected, duration, colors) {
    if (selected.length === 8) return { selected, duration, colors };
    for (let i = from; i <= available.length - (8 - selected.length); i++) {
      const c = available[i], nextDuration = lcm(duration, c.duration), nextColors = new Set([...colors, ...c.colors]);
      if (nextDuration > 6000 || nextColors.size > 256) continue;
      const found = choose(i + 1, [...selected, c], nextDuration, nextColors);
      if (found) return found;
    }
    return null;
  }
  const chosen = choose(0, [], 1, new Set());
  assert(chosen, 'Cannot choose eight exact-colour looping presets with a common period at most 6 seconds');
  const { selected, duration, colors } = chosen, times = new Set([0, duration]);
  for (const c of selected) for (let cycle = 0; cycle < duration; cycle += c.duration) {
    let time = cycle;
    for (const i of c.project.animations[c.animation].frames) { times.add(time); time += c.project.frames[i].duration; }
  }
  const clock = [...times].sort((a, b) => a - b), frames = [];
  for (let i = 0; i < clock.length - 1; i++) {
    const data = canvas(768, 96), length = clock[i + 1] - clock[i];
    assert(length >= 20, 'Combined montage clock needs a GIF delay below 20 ms');
    selected.forEach((c, cell) => drawCell(data, 768, 96, c.project, frameAt(c.project, c.animation, clock[i]), { x: cell * 96, y: 0, width: 96, height: 96 }));
    frames.push({ data, duration: length });
  }
  const gif = api.encodeGIF(frames, 768, 96, { loop: true });
  assert(gif.colors <= 256 && !gif.transparent && gif.delays.reduce((a, b) => a + b, 0) === duration, 'Montage palette, opacity or timing changed');
  assert(gif.data.length <= 3_000_000, `Montage exceeds 3 MB: ${gif.data.length} bytes`);
  await fs.writeFile(path.join(gallery, 'montage.gif'), gif.data);
  const still = canvas(768, 96);
  selected.forEach((c, cell) => drawCell(still, 768, 96, c.project, frameAt(c.project, c.animation, Math.floor(c.duration / 2)), { x: cell * 96, y: 0, width: 96, height: 96 }));
  await fs.writeFile(path.join(gallery, 'montage-still.png'), api.encodePNG(still, 768, 96));
  const preview = canvas(1200, 630);
  selected.forEach((c, i) => drawCell(preview, 1200, 630, c.project, frameAt(c.project, c.animation, Math.floor(c.duration / 2)), { x: i % 4 * 300 + 12, y: Math.floor(i / 4) * 315 + 12, width: 276, height: 291 }));
  await fs.writeFile(path.join(gallery, 'preview.png'), api.encodePNG(preview, 1200, 630));
  return { path: 'montage.gif', width: 768, height: 96, durationMs: duration, frames: frames.length, colors: colors.size, background: '#1b1d2a', bytes: gif.data.length, pieces: selected.map(c => ({ name: c.name, animation: c.animation, durationMs: c.duration, repeats: duration / c.duration })), still: 'montage-still.png', preview: 'preview.png' };
}

function page(manifest) {
  const count = manifest.pieces.length, heading = `${count} pixel art effects, sprites and scenes, every one a recipe`;
  const pageTitle = `Pixel art effects gallery: ${count} animated recipes made with Pixelbolt`;
  const description = `Explore ${count} Pixelbolt ${VERSION} pixel art effects, from falling sand, fluids, rigid bodies and crystals to sprites, tile sets and scenes, with animated previews, editable JSON recipes, browser playground links and tested export commands.`;
  const montageAlt = `Looping pixel art: ${manifest.montage.pieces.map(p => title(p.name)).join(', ')}.`;
  const schema = { '@context': 'https://schema.org', '@type': 'CollectionPage', name: pageTitle, description, url: `${SITE}gallery/`, inLanguage: 'en', dateModified: DATE,
    isPartOf: { '@type': 'WebSite', name: 'Pixelbolt', url: SITE }, about: { '@type': 'SoftwareApplication', name: 'Pixelbolt', url: REPO, applicationCategory: 'MultimediaApplication', softwareVersion: VERSION, license: 'https://opensource.org/licenses/MIT' },
    mainEntity: { '@type': 'ItemList', numberOfItems: count, itemListElement: manifest.pieces.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: p.title, url: `${SITE}gallery/#${p.name}` })) } };
  let imageIndex = 1; // The montage is the first image; defer everything after the first six.
  function card(p, level) {
    const images = p.images.map(i => `<figure class="stage">${i.still ? `<picture><source srcset="${esc(i.still)}" media="(prefers-reduced-motion: reduce)">` : ''}<img src="${esc(i.path)}" width="${i.width * 2}" height="${i.height * 2}" alt="${esc(p.alt + (p.images.length > 1 ? ` Animation: ${i.animation}.` : ''))}"${imageIndex++ >= 6 ? ' loading="lazy"' : ''} decoding="async">${i.still ? '</picture>' : ''}<figcaption>${p.images.length > 1 ? `${esc(i.animation)} · ` : ''}${esc(i.plays)}</figcaption></figure>`).join('\n');
    const open = p.playground ? `<a class="open" href="${esc(p.playground)}">Open in the playground</a>`
      : p.playgroundOpens ? `Too long for a link: <a href="${esc(p.download)}" download>download the recipe</a> and use Open file in the <a href="${SITE}playground/">playground</a>.`
      : `Too long for a playground link: <a href="${esc(p.download)}" download>download the source</a> to edit, or run the export commands below.`;
    return `<article class="card" id="${esc(p.name)}">
<h${level}>${esc(p.title)}</h${level}>
<p>${esc(p.description)}</p>
<div class="previews">${images}</div>
${p.alsoAnimations.length ? `<p class="muted">also: ${esc(p.alsoAnimations.join(', '))}.</p>` : ''}
<p class="facts">${esc(p.size.replace('x', ' × '))} px · ${p.frames} frames · ${esc(p.plays)} · ${p.colors} colours</p>
${p.factsNote ? `<p class="muted">${esc(p.factsNote)}</p>` : ''}
<p>${open}</p>
<p><a href="${esc(p.recipeUrl)}">Recipe</a>: <code>${esc(p.file)}</code></p>
<details><summary>Export commands</summary><pre><code>${esc(p.commands.join('\n'))}</code></pre></details>
</article>`;
  }
  const firstFluid = fluidGroups[0], lastFluid = fluidGroups.at(-1);
  const sections = groups.map(g => `${g.id === firstFluid ? '<section aria-labelledby="fluid-simulations"><h2 id="fluid-simulations">Fluid simulations</h2>\n<p>A deterministic simulation on your CPU bakes gases, FLIP liquids and sand grains, heat and phase change, electric gas, and bodies that float, sink or ride the flow into palette pixels.</p>\n' : ''}<section aria-labelledby="${g.id}"><h${g.fluid ? 3 : 2} id="${g.id}">${esc(g.name)} <span class="count">(${manifest.groups.find(row => row.id === g.id).count})</span></h${g.fluid ? 3 : 2}>
<div class="cards">${manifest.pieces.filter(p => p.groupId === g.id).map(p => card(p, g.fluid ? 4 : 3)).join('\n')}</div></section>${g.id === lastFluid ? '\n</section>' : ''}`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${SITE}gallery/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Pixelbolt">
<meta property="og:title" content="${esc(pageTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${SITE}gallery/">
<meta property="og:image" content="${SITE}gallery/preview.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(montageAlt)}">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">
${JSON.stringify(schema, null, 2).replaceAll('<', '\\u003c')}
</script>
<style>
:root { --bg: #ffffff; --fg: #1d1d1f; --muted: #5b5b66; --link: #0b57d0; --rule: #d9d9e0; --head: #f3f3f6; --stage: #1b1d2a; --button: #0b57d0; --button-fg: #ffffff; }
@media (prefers-color-scheme: dark) { :root { --bg: #16171a; --fg: #e8e8ec; --muted: #a2a2ad; --link: #8ab4f8; --rule: #33343a; --head: #202126; --stage: #0e0f15; --button: #8ab4f8; --button-fg: #10131a; } }
* { box-sizing: border-box; }
body { background: var(--bg); color: var(--fg); font: 17px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; }
main { max-width: 72rem; margin: 0 auto; padding: 1.5rem 16px 4rem; }
a { color: var(--link); }
h1 { font-size: 1.7rem; line-height: 1.25; margin: 0.5rem 0 1rem; max-width: 48rem; }
h2 { font-size: 1.3rem; line-height: 1.3; margin: 2.4rem 0 0.6rem; }
h3 { font-size: 1.05rem; margin: 1.4rem 0 0.4rem; }
h4 { font-size: 1.05rem; }
.lead { font-size: 1.05rem; max-width: 62rem; }
.muted, .crumbs, .facts, figcaption { color: var(--muted); font-size: 0.92rem; }
.count { color: var(--muted); font-weight: 400; }
.jump { display: flex; flex-wrap: wrap; gap: 0.35rem 1.2rem; list-style: none; padding: 0; margin: 1.25rem 0 2rem; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: 1rem; align-items: start; }
.card { min-width: 0; border: 1px solid var(--rule); border-radius: 6px; padding: 1rem; overflow-wrap: anywhere; }
.card h3, .card h4 { margin: 0 0 0.5rem; line-height: 1.3; }
.card p { margin: 0.6rem 0; }
.card p:last-child { margin-bottom: 0; }
.previews { display: grid; gap: 0.5rem; }
code { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: 0.88em; overflow-wrap: anywhere; }
pre { background: var(--head); border: 1px solid var(--rule); border-radius: 6px; padding: 0.7rem; max-width: 100%; overflow-x: auto; font-size: 0.85rem; line-height: 1.5; }
pre code { overflow-wrap: normal; }
summary { color: var(--link); cursor: pointer; }
figure.stage { background: var(--stage); border-radius: 6px; margin: 0; padding: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 0; }
figure.stage img, .montage img { display: block; max-width: 100%; height: auto; image-rendering: pixelated; }
figure.stage figcaption { color: #d4d5df; margin-top: 0.5rem; }
.montage { background: #1b1d2a; border-radius: 6px; margin: 1rem 0; padding: 12px; display: flex; justify-content: center; }
a.open { display: inline-block; background: var(--button); color: var(--button-fg); font-weight: 600; text-decoration: none; padding: 0.55rem 0.95rem; border-radius: 6px; }
a.open:hover, a.open:focus-visible { text-decoration: underline; }
footer { border-top: 1px solid var(--rule); margin-top: 3rem; padding-top: 1rem; }
@media (max-width: 540px) { .cards { grid-template-columns: minmax(0, 1fr); } }
</style>
</head>
<body>
<main>
<nav class="crumbs" aria-label="Breadcrumb"><a href="../">Pixelbolt</a></nav>
<h1>${esc(heading)}</h1>
<figure class="montage"><picture><source srcset="${manifest.montage.still}" media="(prefers-reduced-motion: reduce)"><img src="montage.gif" width="1536" height="192" alt="${esc(montageAlt)}" decoding="async"></picture></figure>
<p class="lead">These are JSON recipes rendered by Pixelbolt ${VERSION}. Open any in the playground in your browser with nothing installed, edit it and download a sprite sheet, atlas or GIF. Pixelbolt is free and MIT-licensed. Your agent can make new ones through the MCP server or the skill: <a href="${REPO}">source, setup and documentation</a>.</p>
<nav aria-label="Gallery groups"><ul class="jump">${groups.map(g => `<li><a href="#${g.id}">${esc(g.name)}</a></li>`).join('')}</ul></nav>
<p class="muted">One-shot effects play once in a game; here their previews loop, with a 0.8 s pause before each replay. Each card shows up to four animations; the recipe includes those listed under “also”. Export commands write sprite sheets, atlases, Godot files and frames; tile sets include terrain exports, and scenes include asset bundles and numbered scene frames.</p>
${sections}
<footer class="muted">
<p>Plain static page: no JavaScript, trackers or cookies. Rendered with Pixelbolt ${VERSION} on ${new Date(`${DATE}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })} by <a href="data/build.mjs">gallery/data/build.mjs</a>. <a href="data/pieces.json">Gallery manifest</a>.</p>
<p>Not shown: <code>examples/quality/</code>, old <code>caption.json</code>, compiled copies <code>effects.json</code> and <code>swing.json</code>, the two forest-spirit lighting passes, the inputs of the <a href="${REPO}/blob/v${VERSION}/docs/fix-one-frame.md">fix-one-frame walk-through</a>, the rigs' design briefs, and the <a href="${REPO}/tree/v${VERSION}/showcase/gallery">showcase/gallery rooms</a> (their generator scripts are not in the repository).</p>
<p><a href="${REPO}">GitHub</a> · <a href="${REPO}/issues/new">Report a mistake</a></p>
</footer>
</main>
</body>
</html>
`;
}

async function checkPage(html) {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  let count = 0;
  for (const [, encoded] of html.matchAll(/\b(?:src|href|srcset)="([^"]+)"/g)) {
    const value = encoded.replaceAll('&amp;', '&');
    if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(value)) continue;
    if (value.startsWith('#')) { assert(ids.has(value.slice(1)), `Missing anchor: ${value}`); continue; }
    const [pathname] = value.split(/[?#]/);
    let target = path.resolve(gallery, decodeURIComponent(pathname));
    if (pathname.endsWith('/')) target = path.join(target, 'index.html');
    assert((await fs.stat(target).catch(() => null))?.isFile(), `Missing relative link/image: ${value}`);
    count++;
  }
  assert(!/<script(?! type="application\/ld\+json")/.test(html), 'Executable JavaScript in gallery');
  return count;
}
async function report() {
  const files = await filesUnder(gallery), rows = [];
  for (const file of files) { const bytes = await fs.readFile(file); rows.push({ path: slash(path.relative(gallery, file)), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); }
  const bytes = rows.reduce((sum, r) => sum + r.bytes, 0);
  assert(bytes <= 25_000_000, `Gallery exceeds 25 MB (${bytes} bytes)`);
  for (const row of rows.filter(r => r.path.endsWith('.gif'))) assert(row.bytes <= (row.path === 'montage.gif' ? 3_000_000 : 1_500_000), `GIF exceeds its size limit: ${row.path}`);
  // Hash ordered paths and file content hashes: independent of mtime and absolute checkout location.
  const sha256 = createHash('sha256').update(rows.map(r => `${r.path}\0${r.sha256}\n`).join('')).digest('hex');
  await writeJSON(path.join(work, 'hashes.json'), rows);
  return { files: rows.length, bytes, sha256, largestGIFs: rows.filter(r => r.path.endsWith('.gif')).sort((a, b) => b.bytes - a.bytes).slice(0, 5) };
}
async function main() {
  const args = process.argv.slice(2);
  assert(args.length === 2 && args[0] === '--engine', `Usage: node gallery/data/build.mjs --engine <Pixelbolt-${VERSION}-folder>`);
  engine = await fs.realpath(path.resolve(args[1])); cli = path.join(engine, 'bin', 'pixelbolt.js');
  assert((await json(path.join(engine, 'package.json'))).version === VERSION, `Expected Pixelbolt ${VERSION}`);
  const modules = await Promise.all(['core', 'resolve', 'png', 'gif', 'import', 'presets'].map(name => import(pathToFileURL(path.join(engine, 'src', `${name}.js`)))));
  api = Object.assign({}, ...modules);
  playground = await import(pathToFileURL(path.join(root, 'playground', 'share.js')));
  await resetDirectory(work, path.dirname(work));
  console.log('Measuring shipped presets and checking group coverage…');
  // Unlike the CLI's time-budgeted listing, this always measures every preset.
  const { presets } = await api.listPresets({ budget: Infinity });
  const inputs = [...presets.map(p => ({ ...p, preset: true })), ...extras];
  const names = new Set(inputs.map(p => p.name)), assigned = groups.flatMap(g => g.names);
  assert(names.size === inputs.length, 'Duplicate piece names');
  assert(new Set(assigned).size === assigned.length, 'A piece is assigned to more than one group');
  for (const p of inputs) assert(assigned.includes(p.name), `Unassigned ${p.preset ? 'preset' : 'piece'}: ${p.name}`);
  for (const name of assigned) assert(names.has(name), `Group names a piece that does not exist: ${name}`);
  const fluidAt = groups.flatMap((g, i) => g.fluid ? [i] : []);
  assert(fluidAt.length && fluidAt.every((at, i) => !i || at === fluidAt[i - 1] + 1), 'The fluid groups must be adjacent');
  for (const p of inputs) assert((await fs.stat(path.join(engine, p.file))).isFile(), `Missing source: ${p.file}`);
  await resetDirectory(path.join(gallery, 'gifs'), gallery);
  await resetDirectory(path.join(gallery, 'data', 'recipes'), path.join(gallery, 'data'));
  const readme = await fs.readFile(path.join(engine, 'README.md'), 'utf8'), readmeAlts = new Map();
  for (const match of readme.matchAll(/!\[([^\]]*)\]\([^\s)]*showcase\/(?:fluid|powder|bodies|crystals)\/([^/()]+)\.gif\)/g)) if (!readmeAlts.has(match[2])) readmeAlts.set(match[2], match[1]);
  const pieces = [];
  for (const name of assigned) {
    console.log(`[${pieces.length + 1}/${inputs.length}] ${name}: verify exports, share and render previews`);
    pieces.push(await makePiece(inputs.find(p => p.name === name), readmeAlts));
  }
  console.log('Composing the exact-colour montage and social preview…');
  const montage = await makeMontage();
  const manifest = { version: VERSION, dateModified: DATE, count: pieces.length, groups: groups.map(g => ({ id: g.id, name: g.name, count: pieces.filter(p => p.groupId === g.id).length })), montage, omitted, warnings, pieces };
  await writeJSON(path.join(gallery, 'data', 'pieces.json'), manifest);
  const html = page(manifest);
  await fs.writeFile(path.join(gallery, 'index.html'), html);
  const relativeLinksChecked = await checkPage(html), result = await report();
  console.log(JSON.stringify({ ok: true, pieceCount: pieces.length, groups: manifest.groups, relativeLinksChecked, commandsExecuted: commandCount, montage, ...result, withoutPlaygroundLink: pieces.filter(p => !p.playground).map(p => ({ name: p.name, reason: p.playgroundReason })), warnings }, null, 2));
}
main().catch(error => { console.error(`Gallery build failed: ${error.message}`); process.exitCode = 1; });
