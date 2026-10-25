import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { readFile, writeFile, readdir, mkdir, mkdtemp, rm, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { encodePNG, encodeAPNG } from '../src/png.js';
import { createBundle, writeBundle, createZip, formatJSON } from '../src/export.js';

export function pngChunks(buffer) {
  const result = []; let at = 8;
  assert.deepEqual([...buffer.subarray(0,8)], [137,80,78,71,13,10,26,10]);
  while (at < buffer.length) { const size = buffer.readUInt32BE(at), type = buffer.toString('ascii', at + 4, at + 8); result.push({ type, data: buffer.subarray(at + 8, at + 8 + size) }); at += size + 12; }
  return result;
}
const tiny = { version: 1, name: 'sample', width: 2, height: 1, frames: [{ name: 'a', duration: 80, ops: [{ op: 'pixel', color: '#f00' }] }, { name: 'b', duration: 120, ops: [{ op: 'pixel', x: 1, color: '#00f8' }] }], animations: { once: { frames: ['a','b'], loop: false } }, sheet: { columns: 1, padding: 1 } };
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
