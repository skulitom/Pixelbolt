import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { readFile, writeFile, readdir, mkdir, mkdtemp, rm, access, symlink, link } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { encodePNG, encodeAPNG } from '../src/png.js';
import { createBundle, writeBundle, createZip, formatJSON } from '../src/export.js';
import { renderProject } from '../src/core.js';
import { createSequence } from '../src/sequence.js';

export function pngChunks(buffer) {
  const result = []; let at = 8;
  assert.deepEqual([...buffer.subarray(0,8)], [137,80,78,71,13,10,26,10]);
  while (at < buffer.length) { const size = buffer.readUInt32BE(at), type = buffer.toString('ascii', at + 4, at + 8); result.push({ type, data: buffer.subarray(at + 8, at + 8 + size) }); at += size + 12; }
  return result;
}
const tiny = { version: 1, name: 'sample', width: 2, height: 1, frames: [{ name: 'a', duration: 80, ops: [{ op: 'pixel', color: '#f00' }] }, { name: 'b', duration: 120, ops: [{ op: 'pixel', x: 1, color: '#00f8' }] }], animations: { once: { frames: ['a','b'], loop: false } }, sheet: { columns: 1, padding: 1 } };
// Whether this folder ignores letter case, asked of the file system: Windows and macOS do by default, but a folder or
// volume can be case-sensitive.
const ignoresCase = async dir => {
  const probe = path.join(dir, 'case-probe');
  await writeFile(probe, '');
  try { await access(path.join(dir, 'CASE-PROBE')); return true; } catch { return false; } finally { await rm(probe); }
};
test('PNG encodes exact RGBA scanlines including transparency', () => {
  const bytes = new Uint8Array([255,0,0,255,0,0,0,0]), chunks = pngChunks(encodePNG(bytes, 2, 1));
  assert.equal(chunks[0].data.readUInt32BE(0), 2); assert.equal(chunks[0].data[9], 6);
  assert.deepEqual([...inflateSync(chunks.find(c => c.type === 'IDAT').data)], [0, ...bytes]);
});
test('APNG contains exact durations, loop flag and source replacement', () => {
  const chunks = pngChunks(encodeAPNG([{ data: new Uint8Array([255,0,0,255]), duration: 80 }, { data: new Uint8Array([0,0,0,0]), duration: 120 }], 1, 1, false));
  assert.equal(chunks.find(c => c.type === 'acTL').data.readUInt32BE(4), 1);
  const controls = chunks.filter(c => c.type === 'fcTL');
  assert.deepEqual(controls.map(c => c.data.readUInt16BE(20)), [80,120]);
  assert.deepEqual(controls.map(c => c.data[25]), [0,0]);
  assert.deepEqual([...inflateSync(chunks.find(c => c.type === 'fdAT').data.subarray(4))], [0,0,0,0,0]);
});
test('animated PNGs give frames of 10 ms or less 11 ms, which browsers play as written, and say so', async () => {
  // Browsers play an animation frame of 10 ms or less at 100 ms, so a 5 ms spark flickered ten times too slowly.
  const quick = { ...tiny, frames: [{ ...tiny.frames[0], duration: 5 }, { ...tiny.frames[1], duration: 11 }], animations: { once: { frames: ['a', 'b', 'a'], loop: false } } };
  const bundle = await createBundle(quick), delays = pngChunks(bundle.files.get('animations/once.png')).filter(c => c.type === 'fcTL').map(c => c.data.readUInt16BE(20));
  assert.deepEqual(delays, [11, 11, 11]);
  assert.deepEqual(Object.values(JSON.parse(bundle.files.get('sample.atlas.json')).frames).map(frame => frame.duration), [5, 11]);
  // 5 and 11 ms share no step of 9 ms or more, so the Godot SpriteFrames says its durations are fractional.
  assert.deepEqual(bundle.project.warnings, ['sample.tres: the frame times of animation once share no step of 9 ms or more, so Godot gets fractional frame durations, kept as 32-bit floats: each frame plays within a ten-millionth of its length. Frame times in multiples of 10 ms are exact.', '1 frame of 10 ms or less (a) last 11 ms in the animated PNGs: browsers play such short frames at 100 ms. The atlas, CSS and player keep the exact durations.']);
  assert.deepEqual((await createBundle(tiny)).project.warnings, []);
});
test('bundle emits CSS for variable duration and multi-row atlas', async () => {
  const bundle = await createBundle(tiny), css = bundle.files.get('sample.css').toString();
  assert.match(css, /200ms steps\(1, end\) 1 forwards/);
  assert.match(css, /40% \{ background-position: -1px -4px/);
  assert.match(css, /100% \{ background-position: -1px -4px/);
  assert.match(css, /\.pf-sample-once \{ background-position: -1px -1px;/);
  for (const file of ['sample.png','sample.atlas.json','sample.pixel.json','animations/once.png','frames/a.png','player.js','preview.html']) assert.ok(bundle.files.has(file), file);
});
test('exports are deterministic, including ZIP bytes', async () => {
  const a = await createBundle(tiny), b = await createBundle(tiny);
  assert.deepEqual(createZip(a.files), createZip(b.files));
  const zip = createZip(a.files); assert.equal(zip.readUInt32LE(0), 0x04034b50); assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
});
test('export refuses overwrite before changing any existing files', async t => {
  const root = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(root, 'pixelbolt-test-'));
  t.after(async () => { assert.ok(dir.startsWith(root + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const bundle = await createBundle(tiny); await writeBundle(bundle, dir);
  await assert.rejects(writeBundle(bundle, dir), /Output already exists/);
  const before = await readFile(path.join(dir, 'sample.png'));
  assert.deepEqual(before, bundle.files.get('sample.png'));
  await writeBundle(bundle, dir, { force: true }); await access(path.join(dir, 'preview.html'));
});
test('a forced export replaces an earlier export of the recipe without leaving its old frames, and touches nothing else', async t => {
  const root = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(root, 'pixelbolt-test-'));
  t.after(async () => { assert.ok(dir.startsWith(root + path.sep)); await rm(dir, { recursive: true, force: true }); });
  await writeBundle(await createBundle(tiny), dir);
  await writeFile(path.join(dir, 'notes.txt'), 'mine'); await writeFile(path.join(dir, 'frames', 'notes.txt'), 'mine');
  // Frame b becomes c and the animation is renamed: their old PNGs go, and the result says so.
  const renamed = { ...tiny, frames: [tiny.frames[0], { ...tiny.frames[1], name: 'c' }], animations: { twice: { frames: ['a', 'c'] } } };
  const written = await writeBundle(await createBundle(renamed), dir, { force: true });
  assert.deepEqual(written.removed, [path.join(dir, 'animations', 'once.png'), path.join(dir, 'frames', 'b.png')]);
  assert.deepEqual((await readdir(path.join(dir, 'frames'))).sort(), ['a.png', 'c.png', 'notes.txt']);
  assert.deepEqual(await readdir(path.join(dir, 'animations')), ['twice.png']);
  assert.equal(await readFile(path.join(dir, 'notes.txt'), 'utf8'), 'mine');
  // Without the recipe's own atlas in the folder, nothing there is taken for an earlier export.
  const other = await mkdtemp(path.join(root, 'pixelbolt-test-'));
  t.after(() => rm(other, { recursive: true, force: true }));
  await mkdir(path.join(other, 'frames')); await writeFile(path.join(other, 'frames', 'hand-drawn.png'), 'mine');
  assert.equal((await writeBundle(await createBundle(tiny), other, { force: true })).removed, undefined);
  await access(path.join(other, 'frames', 'hand-drawn.png'));
});
test('a forced export after a rename that only changes letter case writes the new names and keeps every file', async t => {
  const root = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(root, 'pixelbolt-test-'));
  t.after(async () => { assert.ok(dir.startsWith(root + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const spelled = (name, frame, animation) => ({ ...tiny, name, frames: [{ ...tiny.frames[0], name: frame }, tiny.frames[1]], animations: { [animation]: { frames: [frame, 'b'], loop: false } } });
  await writeBundle(await createBundle(spelled('Sample', 'A', 'Once')), dir);
  // Where letter case is ignored, writing frames/a.png kept the old name A.png, and the cleanup then deleted that file
  // as the old frame's, so the export reported success with the frame and animation missing.
  const written = await writeBundle(await createBundle(spelled('sample', 'a', 'once')), dir, { force: true });
  for (const file of written) await access(file);
  const frames = (await readdir(path.join(dir, 'frames'))).sort(), animations = await readdir(path.join(dir, 'animations')), top = await readdir(dir);
  assert.ok(['a.png', 'b.png'].every(name => frames.includes(name)) && animations.includes('once.png'), [...frames, ...animations].join());
  assert.ok(['sample.png', 'sample.atlas.json', 'sample.pixel.json'].every(name => top.includes(name)), top.join());
  // Where case matters, Sample is another recipe, and its export stays as any other renamed recipe's does.
  if (await ignoresCase(dir)) {
    assert.deepEqual(frames, ['a.png', 'b.png']); assert.deepEqual(animations, ['once.png']);
    assert.ok(!top.includes('Sample.png'), top.join()); assert.equal(written.removed, undefined);
  }
});
test('a forced export never removes files Pixelbolt does not write: another extension spelling, or another name where case matters', async t => {
  const root = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(root, 'pixelbolt-test-'));
  t.after(async () => { assert.ok(dir.startsWith(root + path.sep)); await rm(dir, { recursive: true, force: true }); });
  await writeBundle(await createBundle(tiny), dir);
  // Exports write .png; a photo.PNG put among the frames is someone else's, even where case is ignored.
  await writeFile(path.join(dir, 'frames', 'photo.PNG'), 'mine');
  assert.equal((await writeBundle(await createBundle(tiny), dir, { force: true })).removed, undefined);
  assert.equal(await readFile(path.join(dir, 'frames', 'photo.PNG'), 'utf8'), 'mine');
  // A case-sensitive folder on Windows (as a case-sensitive APFS volume on macOS): Sample.png beside sample.png is
  // another file, and so are another sequence's Coin-Spin frames beside coin-spin's.
  if (process.platform !== 'win32') return;
  const sensitive = path.join(dir, 'sensitive'); await mkdir(sensitive);
  if (spawnSync('fsutil.exe', ['file', 'setCaseSensitiveInfo', sensitive, 'enable'], { encoding: 'utf8' }).status !== 0) { t.diagnostic('this machine cannot make a case-sensitive folder'); return; }
  assert.equal(await ignoresCase(sensitive), false);
  await writeFile(path.join(sensitive, 'Sample.png'), 'mine');
  await writeBundle(await createBundle(tiny), sensitive);
  await writeBundle(await createBundle(tiny), sensitive, { force: true });
  assert.equal(await readFile(path.join(sensitive, 'Sample.png'), 'utf8'), 'mine');
  const coin = JSON.parse(await readFile(new URL('../examples/coin.json', import.meta.url), 'utf8'));
  const named = (name, animation, seconds) => createSequence(renderProject({ ...coin, name, animations: { [animation]: coin.animations.spin } }), { fps: 10, seconds });
  // A folder made inside a case-sensitive one is case-sensitive too.
  const video = path.join(sensitive, 'video'); await mkdir(video);
  assert.equal(await ignoresCase(video), false);
  await writeBundle(named('Coin', 'Spin', 2), video);
  await writeBundle(named('coin', 'spin', 1), video, { force: true });
  assert.equal((await readdir(video)).filter(name => name.startsWith('Coin-Spin_')).length, 20);
  assert.equal((await readdir(video)).filter(name => name.startsWith('coin-spin_')).length, 10);
});
test('an export never writes over its own inputs, even with force', async t => {
  const root = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(root, 'pixelbolt-test-'));
  t.after(async () => { assert.ok(dir.startsWith(root + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const source = path.join(dir, 'sample.pixel.json'), text = JSON.stringify({ ...tiny, palette: { $ref: 'pal.json' } });
  await writeFile(source, text);
  await assert.rejects(writeBundle(await createBundle(tiny), dir, { force: true, inputs: [source] }), /would replace its own input .*sample\.pixel\.json/);
  assert.equal(await readFile(source, 'utf8'), text);
  assert.deepEqual(await readdir(dir), ['sample.pixel.json']);
  // The CLI passes the recipe and the files it references, so rendering into the recipe's own folder is refused.
  await writeFile(path.join(dir, 'pal.json'), JSON.stringify({ r: '#f00' }));
  const cli = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/pixelbolt.js', import.meta.url)), 'render', source, '--out', dir, '--force'], { encoding: 'utf8' });
  assert.equal(cli.status, 1); assert.match(JSON.parse(cli.stderr).error, /would replace its own input/);
  assert.equal(await readFile(source, 'utf8'), text);
  assert.deepEqual((await readdir(dir)).sort(), ['pal.json', 'sample.pixel.json']);
});
test('an export never writes over its own inputs under another spelling: a linked folder or a hard link', async t => {
  const root = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(root, 'pixelbolt-test-'));
  t.after(async () => { assert.ok(dir.startsWith(root + path.sep)); await rm(dir, { recursive: true, force: true }); });
  await mkdir(path.join(dir, 'art'));
  const source = path.join(dir, 'art', 'sample.pixel.json'), text = JSON.stringify(tiny);
  await writeFile(source, text);
  // The paths used to be compared as written, so a folder link (or a short 8.3 name) to the recipe's folder got past.
  await symlink(path.join(dir, 'art'), path.join(dir, 'alias'), 'junction');
  await assert.rejects(writeBundle(await createBundle(tiny), path.join(dir, 'alias'), { force: true, inputs: [source] }), /would replace its own input .*sample\.pixel\.json/);
  // A hard link to the recipe in the export folder is the recipe too.
  await mkdir(path.join(dir, 'out')); await link(source, path.join(dir, 'out', 'sample.pixel.json'));
  await assert.rejects(writeBundle(await createBundle(tiny), path.join(dir, 'out'), { force: true, inputs: [source] }), /would replace its own input .*sample\.pixel\.json/);
  assert.equal(await readFile(source, 'utf8'), text);
  assert.deepEqual(await readdir(path.join(dir, 'art')), ['sample.pixel.json']);
  assert.deepEqual(await readdir(path.join(dir, 'out')), ['sample.pixel.json']);
});
test('CLI commands that write one file never write over a file they read, even with force; patch may save over its recipe', async t => {
  const root = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(root, 'pixelbolt-test-'));
  t.after(async () => { assert.ok(dir.startsWith(root + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const cli = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL('../bin/pixelbolt.js', import.meta.url)), ...args], { cwd: dir, encoding: 'utf8' });
  const poses = JSON.parse(await readFile(new URL('../examples/swing.poses.json', import.meta.url), 'utf8'));
  await writeFile(path.join(dir, 'palette.json'), JSON.stringify(poses.palette));
  const files = { 'swing.poses.json': JSON.stringify({ ...poses, palette: { $ref: 'palette.json' } }), 'recipe.json': JSON.stringify(tiny), 'changes.json': JSON.stringify([{ set: 'frames[a].duration', value: 90 }]) };
  for (const [name, text] of Object.entries(files)) await writeFile(path.join(dir, name), text);
  const before = Object.fromEntries(await Promise.all(['palette.json', ...Object.keys(files)].map(async name => [name, await readFile(path.join(dir, name), 'utf8')])));
  for (const args of [
    // The editable source replaced by the compiled recipe, or the shared palette by a recipe whose $ref is itself.
    ['compile', 'swing.poses.json', '--out', 'swing.poses.json', '--force'],
    ['compile', 'swing.poses.json', '--out', 'palette.json', '--force'],
    ['overlay', 'recipe.json', '--changes', 'changes.json', '--out', 'recipe.json', '--force'],
    ['overlay', 'recipe.json', '--changes', 'changes.json', '--out', 'changes.json', '--force'],
    ['patch', 'recipe.json', '--changes', 'changes.json', '--out', 'changes.json', '--force'],
    // Where letter case is ignored, SWING.poses.json is the source.
    ...(await ignoresCase(dir) ? [['compile', 'swing.poses.json', '--out', 'compiled.json', '--metadata', 'SWING.poses.json', '--force']] : [])
  ]) {
    const run = cli(...args);
    assert.equal(run.status, 1, args.join(' '));
    assert.match(JSON.parse(run.stderr).error, /is a file this command reads; even --force never writes over it/, args.join(' '));
  }
  for (const [name, text] of Object.entries(before)) assert.equal(await readFile(path.join(dir, name), 'utf8'), text, name);
  assert.deepEqual((await readdir(dir)).sort(), Object.keys(before).sort());
  // Saving a patch over the recipe it edits is an edit in place, which --force allows.
  const patched = cli('patch', 'recipe.json', '--changes', 'changes.json', '--out', 'recipe.json', '--force');
  assert.equal(patched.status, 0, patched.stderr);
  assert.equal(JSON.parse(await readFile(path.join(dir, 'recipe.json'), 'utf8')).frames[0].duration, 90);
  // render reads an --expect file too: one in the export folder under the name of a file the export writes stays.
  await mkdir(path.join(dir, 'out')); await writeFile(path.join(dir, 'out', 'sample.atlas.json'), '{"width": 2}');
  const rendered = cli('render', 'recipe.json', '--out', 'out', '--expect', path.join('out', 'sample.atlas.json'), '--force');
  assert.equal(rendered.status, 1); assert.match(JSON.parse(rendered.stderr).error, /would replace its own input .*sample\.atlas\.json/);
  assert.equal(await readFile(path.join(dir, 'out', 'sample.atlas.json'), 'utf8'), '{"width": 2}');
});
test('all bundled examples validate and produce complete exports', async () => {
  for (const name of ['forest-spirit','ember','coin']) {
    const project = JSON.parse(await readFile(new URL(`../examples/${name}.json`, import.meta.url), 'utf8'));
    const bundle = await createBundle(project); assert.equal(bundle.project.warnings.length, 0);
    assert.equal(bundle.files.get(`${name}.png`).subarray(1,4).toString(), 'PNG');
  }
});

test('formatJSON keeps short records on one line and grids one row per line, and parses back to the same value', () => {
  const recipe = { version: 1, name: 'x', width: 8, height: 8, palette: { a: '#fff' }, symbols: { dot: ['a'], box: ['aa', 'aa'] },
    frames: [{ name: 'f', duration: 100, ops: [{ op: 'stamp', symbol: 'box', x: 1, y: 1 }, { op: 'grid', rows: ['a.', '.a'] }] }], animations: { idle: { frames: ['f'] } } };
  const text = formatJSON(recipe);
  assert.deepEqual(JSON.parse(text), recipe);
  assert.equal(text, `{
  "version": 1,
  "name": "x",
  "width": 8,
  "height": 8,
  "palette": { "a": "#fff" },
  "symbols": {
    "dot": ["a"],
    "box": [
      "aa",
      "aa"
    ]
  },
  "frames": [
    {
      "name": "f",
      "duration": 100,
      "ops": [
        { "op": "stamp", "symbol": "box", "x": 1, "y": 1 },
        {
          "op": "grid",
          "rows": [
            "a.",
            ".a"
          ]
        }
      ]
    }
  ],
  "animations": { "idle": { "frames": ["f"] } }
}
`);
  assert.equal(formatJSON({ a: [], b: {}, c: undefined }), '{ "a": [], "b": {} }\n');
  assert.ok(formatJSON({ frames: Array.from({ length: 40 }, (_, i) => `frame-${i}`) }).split('\n').every(line => line.length <= 120));
});
