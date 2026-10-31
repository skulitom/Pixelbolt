import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, readdir, mkdir, symlink, link } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMCP } from '../src/mcp.js';
import { createBundle } from '../src/export.js';
import { animationGIF } from '../src/gif.js';
import { compileAutotile } from '../src/authoring.js';
import { GODOT_TILE_SOURCES } from '../scripts/verify-godot.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const spirit = JSON.parse(await readFile(path.join(root, 'examples', 'forest-spirit.json'), 'utf8'));
const temp = async t => {
  const base = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(base, 'pixelbolt-save-as-'));
  t.after(async () => { assert.ok(dir.startsWith(base + path.sep)); await rm(dir, { recursive: true, force: true }); });
  return dir;
};
// An MCP session whose export directory is <project>/output, like the plugin's.
async function session(t, project, directory = path.join(project, 'output'), root = project) {
  const input = new PassThrough(), output = new PassThrough(), waiting = new Map(); let buffer = '', next = 0;
  output.on('data', chunk => { buffer += chunk; for (let end; (end = buffer.indexOf('\n')) !== -1; buffer = buffer.slice(end + 1)) { const message = JSON.parse(buffer.slice(0, end)); waiting.get(message.id)?.(message); } });
  const running = startMCP({ input, output, directory, root });
  t.after(async () => { input.end(); await running; });
  const request = (method, params) => new Promise(resolve => { waiting.set(++next, resolve); input.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n'); });
  await request('initialize', { protocolVersion: '2025-11-25' });
  const call = async (name, args) => { const { result } = await request('tools/call', { name, arguments: args }); return { isError: result.isError === true, info: JSON.parse(result.content[0].text) }; };
  return { render: args => call('pixel_render', args), call };
}
// Windows and macOS file systems ignore case by default.
const folded = process.platform === 'win32' || process.platform === 'darwin';
const exports = async project => (await readdir(path.join(project, 'output'))).filter(name => !name.startsWith('.'));

test('pixel_render saveAs writes the sheet, atlas and GIF at the asked paths, byte for byte, beside the export folder', async t => {
  const project = await temp(t), mcp = await session(t, project);
  const { isError, info } = await mcp.render({ project: spirit, animation: 'idle', saveAs: { sheet: 'assets/spirit_sheet.png', atlas: 'assets/spirit.json', gif: 'assets/spirit.gif', 'frames/blink.png': 'blink.png' } });
  assert.equal(isError, false, JSON.stringify(info));
  const bundle = await createBundle(spirit);
  assert.deepEqual(info.saved, [
    { file: 'forest-spirit.png', path: path.join(project, 'assets', 'spirit_sheet.png') },
    { file: 'forest-spirit.atlas.json', path: path.join(project, 'assets', 'spirit.json') },
    { file: 'gifs/idle.gif', path: path.join(project, 'assets', 'spirit.gif') },
    { file: 'frames/blink.png', path: path.join(project, 'blink.png') }
  ]);
  assert.deepEqual(await readFile(path.join(project, 'assets', 'spirit_sheet.png')), bundle.files.get('forest-spirit.png'));
  // The saved atlas names the saved sheet beside it; everything else in it is the export's.
  const atlas = JSON.parse(bundle.files.get('forest-spirit.atlas.json'));
  assert.deepEqual(JSON.parse(await readFile(path.join(project, 'assets', 'spirit.json'), 'utf8')), { ...atlas, meta: { ...atlas.meta, image: 'spirit_sheet.png' } });
  assert.deepEqual(await readFile(path.join(info.directory, 'forest-spirit.atlas.json')), bundle.files.get('forest-spirit.atlas.json'));
  assert.deepEqual(await readFile(path.join(project, 'blink.png')), bundle.files.get('frames/blink.png'));
  // A GIF in saveAs makes the GIFs (at the frames' own size), so the copy is the GIF the export folder holds.
  assert.deepEqual(await readFile(path.join(project, 'assets', 'spirit.gif')), Buffer.from(animationGIF(bundle.project, 'idle', {}).data));
  assert.deepEqual(await readFile(path.join(project, 'assets', 'spirit.gif')), await readFile(path.join(info.directory, 'gifs', 'idle.gif')));
  assert.equal(info.gifs.scale, 1);
  assert.deepEqual(await exports(project), [path.basename(info.directory)]);
});

test('pixel_render saveAs refuses, before writing anything, what would leave the root, change a file type or replace a file', async t => {
  const project = await temp(t), outside = await temp(t), mcp = await session(t, project);
  await writeFile(path.join(project, 'taken.png'), 'mine');
  await mkdir(path.join(project, 'folder.png'));
  // A link inside the root that leads out of it ('junction' makes a directory link without extra rights on Windows).
  await symlink(outside, path.join(project, 'link'), 'junction');
  for (const [saveAs, where, message, extra = {}] of [
    [{ sheet: '../escape.png' }, 'saveAs.sheet', /must stay inside/],
    [{ sheet: path.join(outside, 'abs.png') }, 'saveAs.sheet', /must stay inside/],
    [{ sheet: 'link/through.png' }, 'saveAs.sheet', /must stay inside/],
    [{ sheet: 'output/.revisions/x.png' }, 'saveAs.sheet', /revision store/],
    [{ sheet: 'sheet.gif' }, 'saveAs.sheet', /is a \.png file: give a path ending in \.png/],
    [{ gif: 'all.gif' }, 'saveAs.gif', /has 3 animations: pass animation, or name the file, such as gifs\/idle\.gif/],
    [{ 'gifs/nope.gif': 'nope.gif' }, 'saveAs.gifs/nope.gif', /this export has no gifs\/nope\.gif/],
    [{ constructor: 'x.png' }, 'saveAs.constructor', /this export has no constructor/],
    [{ sheet: 'taken.png' }, 'saveAs.sheet', /already exists: choose a new name, or pass "overwrite": true/],
    [{ sheet: 'folder.png' }, 'saveAs.sheet', /exists and is not a file/],
    [{ sheet: 'taken.png/inner.png' }, 'saveAs.sheet', /is a file, not a folder/],
    [{ sheet: 'same.png', 'frames/rest.png': 'SAME.png' }, 'saveAs.frames/rest.png', folded ? /named twice/ : null],
    [{ sheet: 'OUTPUT/.Revisions/x.png' }, 'saveAs.sheet', folded ? /revision store/ : null],
    [{ sheet: '' }, 'saveAs.sheet', /expected a path/],
    [{}, 'saveAs', /expected an object/],
    [{ sheet: 'fine.png' }, 'overwrite', /expected a boolean/, { overwrite: 'yes' }]
  ]) {
    if (!message) continue;
    const { isError, info } = await mcp.render({ project: spirit, saveAs, ...extra });
    assert.equal(isError, true, JSON.stringify(saveAs));
    assert.equal(info.path, where, JSON.stringify(info));
    assert.match(info.error, message);
  }
  // Nothing was written: no export folder, no copies, and the existing file is untouched.
  await assert.rejects(readdir(path.join(project, 'output')));
  assert.deepEqual((await readdir(project)).sort(), ['folder.png', 'link', 'taken.png']);
  assert.deepEqual(await readdir(outside), []);
  assert.equal(await readFile(path.join(project, 'taken.png'), 'utf8'), 'mine');
});

test('pixel_render saveAs writes only art: no scripts or text, no hidden names, and overwrite replaces no settings file', async t => {
  // The desktop bundle's root is the whole home folder by default, so these were writable: a player script anywhere,
  // a recipe in .config, and with overwrite any JSON file, such as an app's settings.
  const project = await temp(t), mcp = await session(t, project);
  await mkdir(path.join(project, 'cfg')); await mkdir(path.join(project, '.secret'));
  await writeFile(path.join(project, 'cfg', 'settings.json'), '{"theme": "dark"}');
  await writeFile(path.join(project, 'cfg', 'broken.json'), '{"frames": ');
  await symlink(path.join(project, '.secret'), path.join(project, 'art'), 'junction');
  for (const [saveAs, where, message] of [
    [{ 'player.js': 'scripts/run.js' }, 'saveAs.player.js', /saveAs copies PNG, GIF and JSON files .*keep player\.js in the export folder/],
    [{ 'README.txt': 'notes/readme.txt' }, 'saveAs.README.txt', /keep README\.txt in the export folder/],
    [{ recipe: '.config/app/settings.json' }, 'saveAs.recipe', /hidden file or folder/],
    [{ sheet: 'cfg/.hero.png' }, 'saveAs.sheet', /hidden file or folder/],
    [{ sheet: 'art/hero.png' }, 'saveAs.sheet', /hidden file or folder/],
    [{ recipe: 'cfg/settings.json' }, 'saveAs.recipe', /is not a recipe, atlas or sequence \(a JSON object with frames\), so overwrite won't replace it/],
    [{ atlas: 'cfg/broken.json' }, 'saveAs.atlas', /is not a recipe, atlas or sequence/]
  ]) {
    const { isError, info } = await mcp.render({ project: spirit, saveAs, overwrite: true });
    assert.deepEqual([isError, info.path], [true, where], JSON.stringify(info));
    assert.match(info.error, message);
  }
  assert.deepEqual((await readdir(project)).sort(), ['.secret', 'art', 'cfg']);
  assert.deepEqual((await readdir(path.join(project, 'cfg'))).sort(), ['broken.json', 'settings.json']);
  assert.deepEqual(await readdir(path.join(project, '.secret')), []);
  assert.equal(await readFile(path.join(project, 'cfg', 'settings.json'), 'utf8'), '{"theme": "dark"}');
  // A recipe, atlas or sequence made elsewhere (an object with frames) is still replaced, as is any image.
  await writeFile(path.join(project, 'cfg', 'hero.json'), JSON.stringify({ frames: {}, meta: { app: 'another editor' } }));
  await writeFile(path.join(project, 'cfg', 'hero.png'), 'not even a PNG');
  const { isError, info } = await mcp.render({ project: spirit, saveAs: { sheet: 'cfg/hero.png', atlas: 'cfg/hero.json' }, overwrite: true });
  assert.equal(isError, false, JSON.stringify(info));
  assert.deepEqual(info.saved.map(item => item.replaced), [true, true]);
  assert.equal(JSON.parse(await readFile(path.join(project, 'cfg', 'hero.json'), 'utf8')).meta.image, 'hero.png');
});

test('pixel_render saveAs keeps out of the home folder\'s settings (AppData, Library) unless the root is inside them', { skip: !['win32', 'darwin'].includes(process.platform) }, async t => {
  // Windows and macOS keep app settings in folders without a leading dot, under the home folder the bundle's root is.
  const home = await temp(t), settings = process.platform === 'win32' ? 'AppData' : 'Library', variable = process.platform === 'win32' ? 'USERPROFILE' : 'HOME', kept = process.env[variable];
  process.env[variable] = home;
  t.after(() => { if (kept === undefined) delete process.env[variable]; else process.env[variable] = kept; });
  const mcp = await session(t, home);
  const { isError, info } = await mcp.render({ project: spirit, saveAs: { atlas: `${settings}/Roaming/app/hero.json` } });
  assert.deepEqual([isError, info.path], [true, 'saveAs.atlas'], JSON.stringify(info));
  assert.match(info.error, /where apps keep their settings: saveAs writes only art/);
  assert.deepEqual(await readdir(home), []);
  // A workspace the user chose inside it is theirs to write to.
  const chosen = path.join(home, settings, 'Art'); await mkdir(chosen, { recursive: true });
  const inside = await session(t, chosen), saved = await inside.render({ project: spirit, saveAs: { sheet: 'hero.png' } });
  assert.equal(saved.isError, false, JSON.stringify(saved.info));
});

test('pixel_render saveAs checks real paths: no link into the revision store, no file named twice or inside another', async t => {
  const project = await temp(t), mcp = await session(t, project);
  // A first render makes the revision store; a link inside the root then leads into it.
  const first = await mcp.render({ project: spirit, sequence: { fps: 10 } });
  await mkdir(path.join(project, 'art'));
  await symlink(path.join(project, 'output', '.revisions'), path.join(project, 'store'), 'junction');
  await symlink(path.join(project, 'art'), path.join(project, 'alias'), 'junction');
  for (const [saveAs, where, message] of [
    [{ atlas: 'store/x.json' }, 'saveAs.atlas', /revision store/],
    [{ sheet: 'art/x.png', 'frames/rest.png': 'alias/x.png' }, 'saveAs.frames/rest.png', /named twice/],
    [{ sheet: 'hero.png', atlas: 'hero.png/hero.json' }, 'saveAs.atlas', /one to be a folder of the other/]
  ]) {
    const { isError, info } = await mcp.render({ project: spirit, saveAs, overwrite: true });
    assert.deepEqual([isError, info.path], [true, where], JSON.stringify(info));
    assert.match(info.error, message);
  }
  assert.deepEqual(await readdir(path.join(project, 'art')), []);
  // Sequence frames can be saved too, and an atlas saved alone names the export folder's sheet.
  const name = `sequence/${(await readdir(path.join(first.info.directory, "sequence"))).filter(file => file.endsWith(".png")).sort()[0]}`, { isError, info } = await mcp.render({ project: spirit, sequence: { fps: 10 }, saveAs: { [name]: 'art/first.png', atlas: 'art/spirit.json' } });
  assert.equal(isError, false, JSON.stringify(info));
  assert.deepEqual(await readFile(path.join(project, 'art', 'first.png')), await readFile(path.join(info.directory, name)));
  const image = JSON.parse(await readFile(path.join(project, 'art', 'spirit.json'), 'utf8')).meta.image;
  assert.equal(path.resolve(project, 'art', image), path.join(info.directory, 'forest-spirit.png'));
});

test('pixel_render saveAs replaces a file only with overwrite, and says so', async t => {
  const project = await temp(t), mcp = await session(t, project);
  await writeFile(path.join(project, 'hero.png'), 'old');
  const { isError, info } = await mcp.render({ project: spirit, saveAs: { sheet: 'hero.png', recipe: 'hero.pixel.json' }, overwrite: true });
  assert.equal(isError, false, JSON.stringify(info));
  assert.deepEqual(info.saved.map(item => [item.file, path.basename(item.path), item.replaced]), [['forest-spirit.png', 'hero.png', true], ['forest-spirit.pixel.json', 'hero.pixel.json', undefined]]);
  assert.deepEqual(await readFile(path.join(project, 'hero.png')), (await createBundle(spirit)).files.get('forest-spirit.png'));
  // Without saveAs a render is as before: one export folder and no saved list.
  const plain = await mcp.render({ project: spirit });
  assert.equal(plain.info.saved, undefined);
  assert.equal(plain.info.gifs, undefined);
});

test('pixel_render saveAs overwrite renames a new file over the old one, so a hard link to it keeps the old bytes', async t => {
  const project = await temp(t), mcp = await session(t, project);
  await writeFile(path.join(project, 'hero.png'), 'old');
  await link(path.join(project, 'hero.png'), path.join(project, 'kept.png'));
  const { isError, info } = await mcp.render({ project: spirit, saveAs: { sheet: 'hero.png' }, overwrite: true });
  assert.equal(isError, false, JSON.stringify(info));
  assert.deepEqual(await readFile(path.join(project, 'hero.png')), (await createBundle(spirit)).files.get('forest-spirit.png'));
  assert.equal(await readFile(path.join(project, 'kept.png'), 'utf8'), 'old');
  // No temporary file is left beside it.
  assert.deepEqual((await readdir(project)).sort(), ['hero.png', 'kept.png', 'output']);
});

test('pixel_render saveAs rebases every saved atlas, and refuses a sheet name that breaks as a URL', async t => {
  const project = await temp(t), mcp = await session(t, project);
  // The atlas under both of its names: each copy names the saved sheet, the one in its own folder first.
  const both = await mcp.render({ project: spirit, saveAs: { sheet: 'a/hero.png', atlas: 'a/hero.json', 'forest-spirit.atlas.json': 'b/hero.json' } });
  assert.equal(both.isError, false, JSON.stringify(both.info));
  assert.equal(JSON.parse(await readFile(path.join(project, 'a', 'hero.json'), 'utf8')).meta.image, 'hero.png');
  assert.equal(JSON.parse(await readFile(path.join(project, 'b', 'hero.json'), 'utf8')).meta.image, '../a/hero.png');
  // A name new URL() (loadSpriteSheet) reads as another one: #, ? and % cut it short or decode it, a leading space goes.
  for (const sheet of ['art/he#ro.png', 'art/100%.png', 'art/ hero.png']) {
    const { isError, info } = await mcp.render({ project: spirit, saveAs: { sheet, atlas: 'art/hero.json' } });
    assert.deepEqual([isError, info.path], [true, 'saveAs.atlas'], JSON.stringify(info));
    assert.match(info.error, /reads as another name when it is loaded as a URL/);
  }
  // A colon reads as a URL scheme (hero:idle.png); Windows refuses the name before that.
  const colon = await mcp.render({ project: spirit, saveAs: { sheet: 'art/hero:idle.png', atlas: 'art/hero.json' } });
  assert.equal(colon.isError, true, JSON.stringify(colon.info));
  assert.match(colon.info.error, process.platform === 'win32' ? /not a name Windows can create/ : /reads as another name when it is loaded as a URL/);
  await assert.rejects(readdir(path.join(project, 'art')));
  // Without an atlas naming it, such a sheet name is fine.
  const alone = await mcp.render({ project: spirit, saveAs: { sheet: 'art/100%.png' } });
  assert.equal(alone.isError, false, JSON.stringify(alone.info));
});

test('pixel_render saveAs never writes over a file the recipe was made from, even with overwrite', async t => {
  const project = await temp(t), mcp = await session(t, project);
  await writeFile(path.join(project, 'palette.json'), JSON.stringify(spirit.palette));
  const linked = { ...spirit, palette: { $ref: 'palette.json' } };
  const { isError, info } = await mcp.render({ project: linked, saveAs: { recipe: 'palette.json' }, overwrite: true });
  assert.deepEqual([isError, info.path], [true, 'saveAs.recipe'], JSON.stringify(info));
  assert.match(info.error, /palette\.json is a palette or asset file this recipe references/);
  assert.deepEqual(JSON.parse(await readFile(path.join(project, 'palette.json'), 'utf8')), spirit.palette);
  await assert.rejects(readdir(path.join(project, 'output')));
});

test('pixel_render saveAs protects the recipe\'s own files when it renders a revision, patched ones included', async t => {
  const project = await temp(t), mcp = await session(t, project);
  await writeFile(path.join(project, 'palette.json'), JSON.stringify(spirit.palette));
  const validated = await mcp.call('pixel_validate', { project: { ...spirit, palette: { $ref: 'palette.json' } } });
  assert.equal(validated.isError, false, JSON.stringify(validated.info));
  const patched = await mcp.call('pixel_patch', { revision: validated.info.revision, changes: [{ set: 'palette.g', value: '#f2dc94' }] });
  assert.equal(patched.isError, false, JSON.stringify(patched.info));
  for (const revision of [validated.info.revision, patched.info.revision]) {
    const { isError, info } = await mcp.render({ revision, saveAs: { atlas: 'palette.json' }, overwrite: true });
    assert.deepEqual([isError, info.path], [true, 'saveAs.atlas'], JSON.stringify(info));
    assert.match(info.error, /palette\.json is a palette or asset file this recipe references/);
  }
  assert.deepEqual(JSON.parse(await readFile(path.join(project, 'palette.json'), 'utf8')), spirit.palette);
});

test('pixel_render saveAs refuses names a file system can\'t take before writing anything', async t => {
  const project = await temp(t), mcp = await session(t, project);
  const cases = [[{ sheet: 'good.png', atlas: 'bad\u0000.json' }, 'saveAs.atlas', /control character/]];
  if (process.platform === 'win32') cases.push([{ sheet: 'good.png', atlas: 'art/con.json' }, 'saveAs.atlas', /not a name Windows can create/], [{ sheet: 'good.png', 'frames/blink.png': 'art /blink.png' }, 'saveAs.frames/blink.png', /not a name Windows can create/]);
  for (const [saveAs, where, message] of cases) {
    const { isError, info } = await mcp.render({ project: spirit, saveAs });
    assert.deepEqual([isError, info.path], [true, where], JSON.stringify(info));
    assert.match(info.error, message);
  }
  assert.deepEqual(await readdir(project), []);
});

test('pixel_render saveAs on Windows: an export directory on a missing drive or another drive', { skip: process.platform !== 'win32' }, async t => {
  const project = await temp(t), here = path.parse(project).root.toUpperCase();
  const letters = 'DEFGHIJKLMNOPQRSTUVWXYZC'.split('').map(letter => `${letter}:\\`);
  // No folder above the export directory exists: the walk stops at the drive instead of looping.
  const missing = letters.find(drive => !existsSync(drive));
  if (missing) {
    const mcp = await session(t, project, path.join(missing, 'pixelbolt-test', 'output'));
    const { isError, info } = await mcp.render({ project: spirit, saveAs: { sheet: 'hero.png' } });
    assert.equal(isError, true, JSON.stringify(info));
    assert.match(info.error, /does not exist/);
  }
  // An atlas saved without its sheet can't name a sheet on another drive.
  const other = letters.find(drive => drive !== here && existsSync(drive));
  if (other) {
    const mcp = await session(t, project, path.join(other, `pixelbolt-test-${path.basename(project)}`, 'output'));
    const { isError, info } = await mcp.render({ project: spirit, saveAs: { atlas: 'hero.json' } });
    assert.deepEqual([isError, info.path], [true, 'saveAs.atlas'], JSON.stringify(info));
    assert.match(info.error, /another drive .* save the sheet too/);
    assert.equal(existsSync(path.join(other, `pixelbolt-test-${path.basename(project)}`)), false);
  }
  assert.deepEqual(await readdir(project), []);
});

test('pixel_render saveAs protects the files behind a revision a normals source compiles', async t => {
  const project = await temp(t), mcp = await session(t, project);
  await writeFile(path.join(project, 'palette.json'), JSON.stringify(spirit.palette));
  const validated = await mcp.call('pixel_validate', { project: { ...spirit, palette: { $ref: 'palette.json' } } });
  const normals = await mcp.call('pixel_compile', { source: { format: 'pixelforge-normals', version: 1, recipe: { revision: validated.info.revision } } });
  assert.equal(normals.isError, false, JSON.stringify(normals.info));
  const { isError, info } = await mcp.render({ revision: normals.info.revision, saveAs: { recipe: 'palette.json' }, overwrite: true });
  assert.deepEqual([isError, info.path], [true, 'saveAs.recipe'], JSON.stringify(info));
  assert.match(info.error, /palette\.json is a palette or asset file this recipe references/);
});

test('pixel_render saveAs puts replaced files back when a later one can\'t be replaced', { skip: process.platform !== 'win32' }, async t => {
  const project = await temp(t), mcp = await session(t, project);
  await writeFile(path.join(project, 'a.png'), 'old a');
  await writeFile(path.join(project, 'b.png'), 'old b');
  // Another process holds b.png open with no sharing, so it can't be moved or replaced until that process ends.
  const locked = path.join(project, 'b.png').replace(/'/g, "''");
  const holder = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$f = [IO.File]::Open('${locked}', 'Open', 'ReadWrite', 'None'); 'locked'; [Console]::In.ReadLine() | Out-Null; $f.Close()`], { stdio: ['pipe', 'pipe', 'inherit'] });
  t.after(() => { holder.stdin.end(); holder.kill(); });
  await new Promise((resolve, reject) => { holder.stdout.on('data', chunk => { if (String(chunk).includes('locked')) resolve(); }); holder.on('exit', code => reject(new Error(`the lock holder exited with ${code}`))); });
  const { isError, info } = await mcp.render({ project: spirit, saveAs: { sheet: 'a.png', 'frames/blink.png': 'b.png' }, overwrite: true });
  assert.equal(isError, true, JSON.stringify(info));
  holder.stdin.end();
  await new Promise(resolve => holder.on('exit', resolve));
  assert.equal(await readFile(path.join(project, 'a.png'), 'utf8'), 'old a');
  assert.equal(await readFile(path.join(project, 'b.png'), 'utf8'), 'old b');
  assert.deepEqual((await readdir(project)).filter(name => name.endsWith('.tmp')), []);
});

test('pixel_render saveAs refuses the export directory or a folder above it', async t => {
  const project = await temp(t), mcp = await session(t, project, path.join(project, 'export.json'));
  for (const [saveAs, where] of [[{ recipe: 'export.json' }, 'saveAs.recipe']]) {
    const { isError, info } = await mcp.render({ project: spirit, saveAs, overwrite: true });
    assert.deepEqual([isError, info.path], [true, where], JSON.stringify(info));
    assert.match(info.error, /must not be the export directory/);
  }
  assert.deepEqual(await readdir(project), []);
});

test('pixel_render saveAs keeps every server\'s source files for a revision they share', async t => {
  const project = await temp(t), first = await session(t, project), second = await session(t, project);
  await writeFile(path.join(project, 'a.json'), JSON.stringify(spirit.palette));
  await writeFile(path.join(project, 'b.json'), JSON.stringify(spirit.palette));
  // The same resolved recipe from two palette files, through two servers sharing one export directory, at once.
  const [one, two] = await Promise.all([first.call('pixel_validate', { project: { ...spirit, palette: { $ref: 'a.json' } } }), second.call('pixel_validate', { project: { ...spirit, palette: { $ref: 'b.json' } } })]);
  assert.equal(one.info.revision, two.info.revision);
  for (const file of ['a.json', 'b.json']) {
    const { isError, info } = await first.render({ revision: one.info.revision, saveAs: { recipe: file }, overwrite: true });
    assert.deepEqual([isError, info.path], [true, 'saveAs.recipe'], `${file}: ${JSON.stringify(info)}`);
  }
});

test('pixel_render saveAs protects a revision\'s files through a server with another root', async t => {
  const project = await temp(t), game = path.join(project, 'game');
  await mkdir(path.join(game, 'assets'), { recursive: true });
  await writeFile(path.join(game, 'assets', 'palette.json'), JSON.stringify(spirit.palette));
  // Validated where the root is the game folder; rendered where the root is the folder above it.
  const inner = await session(t, game, path.join(project, 'output')), outer = await session(t, project, path.join(project, 'output'));
  const validated = await inner.call('pixel_validate', { project: { ...spirit, palette: { $ref: 'assets/palette.json' } } });
  assert.equal(validated.isError, false, JSON.stringify(validated.info));
  const { isError, info } = await outer.render({ revision: validated.info.revision, saveAs: { recipe: 'game/assets/palette.json' }, overwrite: true });
  assert.deepEqual([isError, info.path], [true, 'saveAs.recipe'], JSON.stringify(info));
  assert.deepEqual(JSON.parse(await readFile(path.join(game, 'assets', 'palette.json'), 'utf8')), spirit.palette);
});

test('pixel_render saveAs keeps the CSS and preview page, which load other files, in the export folder', async t => {
  const project = await temp(t), mcp = await session(t, project);
  for (const file of ['forest-spirit.css', 'preview.html']) {
    const { isError, info } = await mcp.render({ project: spirit, saveAs: { sheet: 'assets/custom.png', [file]: `assets/${file}` } });
    assert.deepEqual([isError, info.path], [true, `saveAs.${file}`], JSON.stringify(info));
    assert.match(info.error, /loads other export files by relative path/);
  }
  assert.deepEqual(await readdir(project), []);
});

test('pixel_render saveAs still saves a revision whose recorded source can\'t be reached any more', async t => {
  const project = await temp(t), mcp = await session(t, project);
  await writeFile(path.join(project, 'palette.json'), JSON.stringify(spirit.palette));
  const validated = await mcp.call('pixel_validate', { project: { ...spirit, palette: { $ref: 'palette.json' } } });
  // A recorded source behind a link whose target is gone, as on a disconnected drive.
  await mkdir(path.join(project, 'gone'));
  await symlink(path.join(project, 'gone'), path.join(project, 'link'), 'junction');
  await rm(path.join(project, 'gone'), { recursive: true });
  await writeFile(path.join(project, 'output', '.revisions', `${validated.info.revision}.sources`), JSON.stringify(path.join(project, 'link', 'palette.json')) + '\n', { flag: 'a' });
  const { isError, info } = await mcp.render({ revision: validated.info.revision, saveAs: { sheet: 'hero.png' } });
  assert.equal(isError, false, JSON.stringify(info));
  // The reachable source is still protected.
  const refused = await mcp.render({ revision: validated.info.revision, saveAs: { recipe: 'palette.json' }, overwrite: true });
  assert.deepEqual([refused.isError, refused.info.path], [true, 'saveAs.recipe'], JSON.stringify(refused.info));
});

test('pixel_render saveAs protects a palette read through a link that is later removed', async t => {
  const project = await temp(t), mcp = await session(t, project);
  await mkdir(path.join(project, 'shared'));
  await writeFile(path.join(project, 'shared', 'palette.json'), JSON.stringify(spirit.palette));
  await symlink(path.join(project, 'shared'), path.join(project, 'alias'), 'junction');
  const validated = await mcp.call('pixel_validate', { project: { ...spirit, palette: { $ref: 'alias/palette.json' } } });
  assert.equal(validated.isError, false, JSON.stringify(validated.info));
  await rm(path.join(project, 'alias'));
  const { isError, info } = await mcp.render({ revision: validated.info.revision, saveAs: { recipe: 'shared/palette.json' }, overwrite: true });
  assert.deepEqual([isError, info.path], [true, 'saveAs.recipe'], JSON.stringify(info));
  assert.deepEqual(JSON.parse(await readFile(path.join(project, 'shared', 'palette.json'), 'utf8')), spirit.palette);
});

test('pixel_render saveAs writes the Godot SpriteFrames naming its sheet, which must be inside the Godot project with it', async t => {
  const project = await temp(t), mcp = await session(t, project), text = (await createBundle(spirit)).files.get('forest-spirit.tres').toString();
  // Beside a saved sheet, the .tres names that sheet; everything else is the export's .tres.
  let { isError, info } = await mcp.render({ project: spirit, saveAs: { sheet: 'game/sprites/spirit.png', godot: 'game/sprites/spirit.tres' } });
  assert.equal(isError, false, JSON.stringify(info));
  assert.deepEqual(info.saved.map(item => item.file), ['forest-spirit.png', 'forest-spirit.tres']);
  assert.equal(await readFile(path.join(project, 'game', 'sprites', 'spirit.tres'), 'utf8'), text.replace('path="forest-spirit.png"', 'path="spirit.png"'));
  assert.equal(await readFile(path.join(info.directory, 'forest-spirit.tres'), 'utf8'), text);
  // Without a saved sheet it names the export folder's, relative to itself.
  ({ isError, info } = await mcp.render({ project: spirit, saveAs: { godot: 'loose/spirit.tres' } }));
  assert.equal(isError, false, JSON.stringify(info));
  assert.ok((await readFile(path.join(project, 'loose', 'spirit.tres'), 'utf8')).includes(`path="../output/${path.basename(info.directory)}/forest-spirit.png"`));
  // Godot loads textures only from inside its project, so a .tres saved in one needs its sheet there too.
  await writeFile(path.join(project, 'game', 'project.godot'), 'config_version=5\n');
  for (const [saveAs, message] of [
    [{ godot: 'game/sprites/other.tres' }, /is in the Godot project .*game, but its sheet would stay in the export folder, outside it/],
    [{ sheet: 'elsewhere/spirit.png', godot: 'game/sprites/other.tres' }, /elsewhere.spirit\.png is outside it/]
  ]) {
    ({ isError, info } = await mcp.render({ project: spirit, saveAs }));
    assert.equal(isError, true, JSON.stringify(saveAs)); assert.equal(info.path, 'saveAs.godot'); assert.match(info.error, message);
  }
  assert.equal(existsSync(path.join(project, 'game', 'sprites', 'other.tres')), false);
  assert.equal(existsSync(path.join(project, 'elsewhere')), false);
  // overwrite replaces a SpriteFrames .tres, never another Godot resource.
  ({ isError, info } = await mcp.render({ project: spirit, overwrite: true, saveAs: { sheet: 'game/sprites/spirit.png', godot: 'game/sprites/spirit.tres' } }));
  assert.equal(isError, false, JSON.stringify(info));
  assert.deepEqual(info.saved.map(item => item.replaced), [true, true]);
  await writeFile(path.join(project, 'game', 'theme.tres'), '[gd_resource type="Theme" format=3]\n');
  ({ isError, info } = await mcp.render({ project: spirit, overwrite: true, saveAs: { sheet: 'game/theme.png', godot: 'game/theme.tres' } }));
  assert.equal(isError, true); assert.match(info.error, /theme\.tres is not a Godot SpriteFrames resource, so overwrite won't replace it/);
  assert.equal(await readFile(path.join(project, 'game', 'theme.tres'), 'utf8'), '[gd_resource type="Theme" format=3]\n');
  assert.equal(existsSync(path.join(project, 'game', 'theme.png')), false);
});

test('pixel_render saveAs writes an autotile set\'s Godot TileSet naming its sheet, and replaces only a TileSet', async t => {
  const project = await temp(t), mcp = await session(t, project), { recipe } = compileAutotile(GODOT_TILE_SOURCES[0]);
  const text = (await createBundle(recipe)).files.get('turf.tileset.tres').toString();
  let { isError, info } = await mcp.render({ project: recipe, saveAs: { sheet: 'game/tiles/turf.png', tileset: 'game/tiles/turf.tileset.tres' } });
  assert.equal(isError, false, JSON.stringify(info));
  assert.deepEqual(info.saved.map(item => item.file), ['turf.png', 'turf.tileset.tres']);
  assert.equal(await readFile(path.join(project, 'game', 'tiles', 'turf.tileset.tres'), 'utf8'), text);
  // In another folder it names the saved sheet relative to itself; the export's own copy is unchanged.
  ({ isError, info } = await mcp.render({ project: recipe, saveAs: { sheet: 'game/art/turf.png', tileset: 'game/tiles/ground.tileset.tres' } }));
  assert.equal(isError, false, JSON.stringify(info));
  assert.equal(await readFile(path.join(project, 'game', 'tiles', 'ground.tileset.tres'), 'utf8'), text.replace('path="turf.png"', 'path="../art/turf.png"'));
  assert.equal(await readFile(path.join(info.directory, 'turf.tileset.tres'), 'utf8'), text);
  // Inside a Godot project its sheet must be there too.
  await writeFile(path.join(project, 'game', 'project.godot'), 'config_version=5\n');
  ({ isError, info } = await mcp.render({ project: recipe, saveAs: { tileset: 'game/tiles/other.tileset.tres' } }));
  assert.deepEqual([isError, info.path], [true, 'saveAs.tileset'], JSON.stringify(info));
  assert.match(info.error, /is in the Godot project .*game, but its sheet would stay in the export folder, outside it/);
  // overwrite replaces a TileSet, never a SpriteFrames or another resource, and a SpriteFrames never replaces a TileSet.
  ({ isError, info } = await mcp.render({ project: recipe, overwrite: true, saveAs: { sheet: 'game/tiles/turf.png', tileset: 'game/tiles/turf.tileset.tres' } }));
  assert.equal(isError, false, JSON.stringify(info));
  assert.deepEqual(info.saved.map(item => item.replaced), [true, true]);
  await writeFile(path.join(project, 'game', 'tiles', 'frames.tileset.tres'), '[gd_resource type="SpriteFrames" format=3]\n');
  ({ isError, info } = await mcp.render({ project: recipe, overwrite: true, saveAs: { sheet: 'game/tiles/turf.png', tileset: 'game/tiles/frames.tileset.tres' } }));
  assert.equal(isError, true); assert.match(info.error, /frames\.tileset\.tres is not a Godot TileSet resource, so overwrite won't replace it/);
  // A tile set with no animations of its own has no SpriteFrames to save; one with animations has one, which can't
  // replace a TileSet.
  ({ isError, info } = await mcp.render({ project: recipe, saveAs: { godot: 'game/tiles/turf.tres' } }));
  assert.equal(isError, true); assert.match(info.error, /^saveAs\.godot: this export is a tile set with no animations of its own, so it has no SpriteFrames or animated PNGs: save tileset/);
  ({ isError, info } = await mcp.render({ project: { ...recipe, animations: { first: { frames: [recipe.frames[0].name] } } }, overwrite: true, saveAs: { sheet: 'game/tiles/turf.png', godot: 'game/tiles/turf.tileset.tres' } }));
  assert.equal(isError, true); assert.match(info.error, /turf\.tileset\.tres is not a Godot SpriteFrames resource/);
  assert.equal(await readFile(path.join(project, 'game', 'tiles', 'turf.tileset.tres'), 'utf8'), text);
  // A recipe that isn't an autotile set has none to save.
  ({ isError, info } = await mcp.render({ project: spirit, saveAs: { tileset: 'game/tiles/spirit.tileset.tres' } }));
  assert.deepEqual([isError, info.path], [true, 'saveAs.tileset'], JSON.stringify(info));
  assert.match(info.error, /this export has no Godot TileSet: only a recipe whose frames are an autotile set/);
});

test('pixel_render saveAs writes an autotile set\'s Tiled tileset naming its image, and replaces only a Tiled tileset', async t => {
  const project = await temp(t), mcp = await session(t, project), { recipe } = compileAutotile(GODOT_TILE_SOURCES[0]);
  const text = (await createBundle(recipe)).files.get('turf.tsx').toString();
  let { isError, info } = await mcp.render({ project: recipe, saveAs: { sheet: 'game/tiles/turf.png', tiled: 'game/tiles/turf.tsx' } });
  assert.equal(isError, false, JSON.stringify(info));
  assert.deepEqual(info.saved.map(item => item.file), ['turf.png', 'turf.tsx']);
  assert.equal(await readFile(path.join(project, 'game', 'tiles', 'turf.tsx'), 'utf8'), text);
  // In another folder it names the saved image relative to itself, as Tiled reads it; the export's copy is unchanged.
  ({ isError, info } = await mcp.render({ project: recipe, saveAs: { sheet: 'game/art/turf.png', tiled: 'game/maps/ground.tsx' } }));
  assert.equal(isError, false, JSON.stringify(info));
  assert.equal(await readFile(path.join(project, 'game', 'maps', 'ground.tsx'), 'utf8'), text.replace('<image source="turf.png"', '<image source="../art/turf.png"'));
  assert.equal(await readFile(path.join(info.directory, 'turf.tsx'), 'utf8'), text);
  // Saved alone, it names the export folder's image.
  ({ isError, info } = await mcp.render({ project: recipe, saveAs: { tiled: 'game/maps/alone.tsx' } }));
  assert.equal(isError, false, JSON.stringify(info));
  assert.match(await readFile(path.join(project, 'game', 'maps', 'alone.tsx'), 'utf8'), new RegExp(`<image source="\\.\\./\\.\\./output/${path.basename(info.directory)}/turf\\.png"`));
  // overwrite replaces a Tiled tileset, never another file.
  await writeFile(path.join(project, 'game', 'maps', 'notes.tsx'), 'not a tileset\n');
  ({ isError, info } = await mcp.render({ project: recipe, overwrite: true, saveAs: { tiled: 'game/maps/notes.tsx' } }));
  assert.equal(isError, true); assert.match(info.error, /notes\.tsx is not a Tiled tileset, so overwrite won't replace it/);
  assert.equal(await readFile(path.join(project, 'game', 'maps', 'notes.tsx'), 'utf8'), 'not a tileset\n');
  ({ isError, info } = await mcp.render({ project: recipe, overwrite: true, saveAs: { sheet: 'game/art/turf.png', tiled: 'game/maps/ground.tsx' } }));
  assert.equal(isError, false, JSON.stringify(info));
  assert.deepEqual(info.saved.map(item => item.replaced), [true, true]);
  // A recipe that isn't a tile set has none to save.
  ({ isError, info } = await mcp.render({ project: spirit, saveAs: { tiled: 'game/maps/spirit.tsx' } }));
  assert.deepEqual([isError, info.path], [true, 'saveAs.tiled'], JSON.stringify(info));
  assert.match(info.error, /this export has no Tiled tileset: only a recipe whose frames are an autotile set/);
});
