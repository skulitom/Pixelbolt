import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { link, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../src/build.js';
import { formatJSON } from '../src/export.js';

const cli = fileURLToPath(new URL('../bin/pixelbolt.js', import.meta.url));
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url))).version;
const manifest = 'pixelbolt.build.json', lock = 'pixelbolt.build.lock.json';
const idle = ['first', 'second'], animations = { rest: { frames: ['first'] }, walk: { frames: idle } };
const recipe = { version: 1, name: 'sprite', width: 4, height: 4, palette: { k: '#112233' },
  frames: idle.map((name, x) => ({ name, duration: 80, ops: [{ op: 'pixel', x, y: 1, color: 'k' }] })), animations };
const poses = { format: 'pixelforge-poses', version: 1, name: 'actor', width: 4, height: 4,
  palette: { $ref: 'colors.json' }, parts: { dot: { rows: ['k'] } },
  poses: idle.map((name, x) => ({ name, origin: [x, 1], parts: [{ name: 'dot', part: 'dot', at: [0, 0] }] })), animations };
const palette = { palette: { k: '#112233', l: '#abcdef' }, ramps: [['k', 'l']] };
const entry = (outputs, extra) => ({ name: 'hero', file: 'art.json', outputs, ...extra });
const noWork = { compiled: 0, rendered: 0 };

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-build-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const at = name => path.join(dir, name);
  const put = async (name, value) => {
    await mkdir(path.dirname(at(name)), { recursive: true });
    await writeFile(at(name), typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
  };
  const command = (expected, ...args) => {
    const run = spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8' });
    assert.equal(run.status, expected, `${args.join(' ')}\n${run.stderr}\n${run.stdout}`);
    return JSON.parse(run.stdout || run.stderr);
  };
  await put('art.json', recipe);
  return { at, put, command, build: options => build(dir, options), manifest: (entries, extra) => put(manifest, { ...extra, entries }),
    read: name => readFile(at(name)), json: async name => JSON.parse(await readFile(at(name))), exists: name => existsSync(at(name)) };
}
async function fileList(dir) {
  const files = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.isDirectory()) files.push(...(await fileList(path.join(dir, item.name))).map(f => `${item.name}/${f}`));
    else files.push(item.name);
  }
  return files.sort();
}

test('every delivered byte matches the CLI for files, linked sources, presets and both module exports', async t => {
  const f = await fixture(t), inputs = [
    { name: 'file', file: 'art.json' },
    { name: 'source', file: 'art/arbitrary.json', compile: { animation: ['rest', 'walk'], frames: 2, size: '6x6' } },
    { name: 'preset', preset: 'ember', compile: { frames: 2, size: '16x16' } },
    { name: 'object', module: 'art/sprite.js' },
    { name: 'factory', module: 'art/sprite.mjs' }
  ];
  await f.put('art/arbitrary.json', '\uFEFF' + JSON.stringify(poses));
  await f.put('art/package.json', { type: 'module' });
  await f.put('art/colors.json', palette);
  const linked = { ...recipe, palette: { $ref: 'colors.json' } };
  await f.put('art/sprite.js', `export default ${JSON.stringify(linked)};`);
  // The manifest's folder, however the path is spelled (macOS's /var is /private/var to a CLI run there).
  await f.put('art/sprite.mjs', `import { existsSync } from 'node:fs';
  import path from 'node:path';
  export default async ({ name, directory }) => {
    if (!existsSync(path.join(directory, 'pixelbolt.build.json')) || !existsSync(path.join(directory, 'art', 'sprite.mjs'))) throw Error('wrong directory');
    return { ...${JSON.stringify(poses)}, name };
  };`);
  const entries = [];
  for (const input of inputs) {
    const { name } = input;
    let reference = 'art.json';
    if (name === 'object') {
      reference = 'art/reference.json';
      await f.put(reference, formatJSON(linked));
    } else if (name !== 'file') {
      reference = `${name}.compiled.json`;
      let args = ['--preset', 'ember', '--frames', '2', '--size', '16x16'];
      if (name === 'source') args = [input.file, '--frames', '2', '--size', '6x6', '--animation', 'rest,walk'];
      if (name === 'factory') {
        await f.put('art/from-module.json', formatJSON({ ...poses, name }));
        args = ['art/from-module.json'];
      }
      f.command(0, 'compile', ...args, '--out', reference);
    }
    const doc = await f.json(reference), frame = doc.frames.at(-1).name;
    const animation = Object.keys(doc.animations).at(-1);
    const options = { scale: 2, columns: 2 };
    entries.push({ ...input, outputs: [{ bundle: `${name}/bundle`, ...options }, { sheet: `${name}/sheet`, ...options },
      { still: `${name}/still.png`, scale: 3, frame }, { gif: `${name}/anim.gif`, scale: 2, animation, background: '#1d2b53' }] });
    f.command(0, 'render', reference, '--scale', '2', '--columns', '2', '--out', `ref/${name}`);
    f.command(0, 'render', reference, '--scale', '3', '--out', `ref/still-${name}`);
    f.command(0, 'gif', reference, '--scale', '2', '--animation', animation, '--background', '#1d2b53', '--out', `ref/${name}.gif`);
  }
  await f.manifest(entries);
  const result = await f.build();
  assert.equal(result.ok, true, JSON.stringify(result.failed));
  assert.deepEqual(result.stats, { compiled: 3, rendered: 15 });
  for (const { name, outputs } of entries) {
    const files = await fileList(f.at(`ref/${name}`));
    assert.deepEqual(await fileList(f.at(`${name}/bundle`)), files);
    for (const file of files) assert.deepEqual(await f.read(`${name}/bundle/${file}`), await f.read(`ref/${name}/${file}`), `${name}: ${file}`);
    const atlas = files.find(file => file.endsWith('.atlas.json')), image = atlas.replace('.atlas.json', '.png');
    assert.deepEqual(await fileList(f.at(`${name}/sheet`)), [atlas, image].sort());
    for (const file of [atlas, image]) assert.deepEqual(await f.read(`${name}/sheet/${file}`), await f.read(`ref/${name}/${file}`));
    assert.deepEqual(await f.read(`${name}/anim.gif`), await f.read(`ref/${name}.gif`));
    assert.deepEqual(await f.read(`${name}/still.png`), await f.read(`ref/still-${name}/frames/${outputs[2].frame}.png`));
  }
  const again = await f.build();
  assert.deepEqual(again.stats, noWork);
  assert.equal(again.written, undefined);
  assert.deepEqual((await f.build({ check: true })).stats, noWork);
  // The CLI's reply names the files from the working folder and leaves the counts to the tests.
  const reply = f.command(0, 'build', manifest, '--check');
  assert.deepEqual([reply.ok, reply.manifest, reply.record, reply.stats], [true, manifest, lock, undefined]);
});

test('check explains missing, unrecorded, edited, stale and both version mismatches without changing files', async t => {
  const f = await fixture(t), output = { sheet: 'art' }, entries = [entry([output])];
  await f.put('art.json', { ...recipe, palette: { $ref: 'colors.json' } });
  await f.put('colors.json', palette);
  await f.manifest(entries);
  const check = (...reasons) => {
    const reply = f.command(reasons.length ? 1 : 0, 'build', '--check');
    assert.deepEqual([...new Set(reply.problems?.map(p => p.reason))].sort(), reasons.sort());
    assert.equal(reply.rendered, undefined);
    for (const p of reply.problems ?? []) assert.ok(p.message && (p.file || p.output));
    return reply;
  };
  check('missing');
  assert.equal(f.exists('art'), false);
  assert.equal(f.exists(lock), false);
  await f.put('art/sprite.png', 'handmade');
  check('unrecorded', 'missing');
  f.command(0, 'build', '--force');
  check();
  const png = await f.read('art/sprite.png'), record = await f.read(lock);
  await f.put('art/sprite.png', 'edited');
  check('edited');
  assert.deepEqual(await f.read(lock), record);
  await f.put('art/sprite.png', png);
  await f.put('colors.json', { ...palette, palette: { ...palette.palette, k: '#ff3344' } });
  check('stale');
  assert.equal((await f.build()).stats.rendered, 1);
  assert.notDeepEqual(await f.read('art/sprite.png'), png);
  output.scale = 2;
  await f.manifest(entries);
  check('stale');
  assert.equal((await f.build()).stats.rendered, 1);
  assert.equal((await f.build({ version: '99.1.0' })).stats.rendered, 1);
  check('version');
  await f.build();
  check();
  await f.manifest(entries, { pixelbolt: '88.0.0' });
  assert.match(check('version').problems[0].message, /88\.0\.0.*running .*npx pixelbolt@88\.0\.0 build/);
  assert.equal(f.command(1, 'build').path, 'pixelbolt');
});

test('a refused member leaves the sheet and its record intact; force replaces it and identical bytes are adopted', async t => {
  const f = await fixture(t);
  await f.manifest([entry([{ sheet: 'sheet' }, { still: 'icon.png' }])]);
  await f.put('sheet/sprite.atlas.json', '{}');
  const first = f.command(1, 'build');
  assert.deepEqual(first.refused.map(r => r.file), ['sheet/sprite.atlas.json']);
  assert.equal(f.exists('sheet/sprite.png'), false);
  assert.equal(f.exists('icon.png'), true);
  assert.deepEqual(Object.keys((await f.json(lock)).entries.hero.outputs), ['still icon.png']);
  f.command(0, 'build', '--force');
  const record = await f.read(lock);
  await f.put('sheet/sprite.atlas.json', 'edited');
  await rm(f.at('sheet/sprite.png'));
  const edited = await f.build();
  assert.deepEqual(edited.stats, noWork);
  assert.equal(edited.refused[0].reason, 'edited');
  assert.equal(f.exists('sheet/sprite.png'), false);
  assert.deepEqual(await f.read(lock), record);
  f.command(0, 'build', '--force');
  await rm(f.at(lock));
  const adopted = await f.build();
  assert.equal(adopted.written, undefined);
  assert.equal(adopted.ok, true);
  assert.deepEqual(await f.read(lock), record);
});

test('CRLF in inputs, text outputs and the committed record requires no writes or rendering', async t => {
  const f = await fixture(t);
  await f.manifest([entry([{ sheet: '.' }])]);
  await f.build();
  for (const file of ['art.json', manifest, 'sprite.atlas.json', lock]) {
    const text = file === 'art.json' ? formatJSON(recipe) : (await f.read(file)).toString();
    await f.put(file, text.replaceAll('\n', '\r\n'));
    await utimes(f.at(file), 100000, 100000);
  }
  for (const options of [{ check: true }, {}]) {
    const run = await f.build(options);
    assert.equal(run.ok, true);
    assert.deepEqual(run.stats, noWork);
    assert.equal(run.written, undefined);
  }
  for (const file of ['sprite.atlas.json', lock]) assert.equal((await stat(f.at(file))).mtimeMs, 100000000);
});

test('changed module bytes reload in one process; only the returned document affects the fingerprint', async t => {
  const f = await fixture(t);
  const code = `export default ${JSON.stringify(recipe)}`;
  await f.manifest([{ name: 'item', module: 'mod.mjs', outputs: [{ still: 'a.png' }] }]);
  await f.put('mod.mjs', code);
  assert.equal((await f.build()).ok, true);
  await f.put('mod.mjs', code + '\n');
  assert.deepEqual((await f.build()).stats, noWork);
  await f.put('mod.mjs', code.replace('#112233', '#999999'));
  assert.equal((await f.build({ check: true })).problems[0].reason, 'stale');
  assert.equal((await f.build()).stats.rendered, 1);
});

test('output overlaps and input aliases fail before any file is delivered, even with --force and --only', async t => {
  const f = await fixture(t), recipeInput = 'art/sprite.pixel.json';
  await f.put(recipeInput, recipe);
  await f.put('linked.json', { ...recipe, palette: { $ref: 'palette.png' } });
  await f.put('palette.png', palette);
  await f.put('module.mjs', `export default ${JSON.stringify(recipe)}`);
  const existing = await f.read('palette.png');
  for (const [entries, options, problem] of [
    [[entry([{ still: 'first.png' }, { sheet: 'out' }, { still: 'out/sprite.png' }])], {}, /two outputs/],
    [[entry([{ still: 'first.png' }, { bundle: 'art' }], { file: recipeInput })], {}, /replace an input/],
    [[entry([{ still: 'first.png' }, { still: 'palette.png' }]), entry([{ sheet: 'other' }], { name: 'other', file: 'linked.json' })], { only: 'hero' }, /replace an input/],
    [[entry([{ still: 'first.png' }, { bundle: '.' }], { name: 'sprite.pixel' })], { keep: '.' }, /two outputs/],
    [[entry([{ still: 'first.png' }], { name: 'art' })], { keep: '.' }, /replace an input/],
    [[entry([{ still: 'first.png' }], { name: 'pixelbolt.build' })], { keep: '.' }, /replace an input/],
    [[entry([{ still: 'first.png' }], { name: 'pixelbolt.build.lock' })], { keep: '.' }, /replace an input/],
    [[entry([{ bundle: 'out' }, { still: 'out/animations/walk.png' }])], {}, /two outputs/]
  ]) {
    await f.manifest(entries);
    await assert.rejects(f.build({ force: true, ...options }), problem);
    assert.equal(f.exists('first.png'), false);
    assert.equal(f.exists('out'), false);
    assert.equal(f.exists(lock), false);
  }
  await link(f.at('module.mjs'), f.at('alias.png'));
  await f.manifest([entry([{ still: 'first.png' }, { still: 'alias.png' }]), { name: 'm', module: 'module.mjs', outputs: [{ sheet: 'm' }] }]);
  await assert.rejects(f.build({ force: true }), /replace an input/);
  assert.equal(f.exists('first.png'), false);
  assert.deepEqual(await f.read('palette.png'), existing);
});

test('entry paths reject absolute names, empty paths and every .. segment', async t => {
  const f = await fixture(t);
  for (const bad of ['../art.json', 'nested/../art.json', '..\\art.json', f.at('art.json'), '']) {
    await f.manifest([entry([{ sheet: '.' }], { file: bad })]);
    await assert.rejects(f.build(), { name: 'PixelError', path: 'entries.hero.file' });
    await f.manifest([entry([{ sheet: bad }])]);
    await assert.rejects(f.build({ check: true }), { name: 'PixelError', path: 'entries.hero.outputs[0].sheet' });
  }
  await assert.rejects(build(f.at('art.json')), /manifest name the build reads/);
});

test('a junction outside the manifest folder cannot be used for existing inputs or new output paths', async t => {
  const f = await fixture(t), outside = await fixture(t);
  try { await symlink(outside.at('.'), f.at('junction'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return t.skip(error.code); throw error; }
  for (const [input, output] of [['junction/art.json', { sheet: 'new' }], ['art.json', { still: 'junction/nested/new.png' }]]) {
    await f.manifest([entry([{ still: 'first.png' }, output], { file: input })]);
    await assert.rejects(f.build({ force: true }), /leads out|inside/);
    assert.equal(f.exists('first.png'), false);
    assert.equal(outside.exists('nested'), false);
  }
});

test('--init discovers documents by content, skips export copies and chooses distinct sheet destinations', async t => {
  const f = await fixture(t);
  await f.put('aaa.pixel.json', { ...recipe, name: 'sprite' });
  await f.put('art/slime.odd.json', poses);
  await f.put('art/colors.json', palette);
  await f.put('art/slime.pixel.json', recipe);
  await f.put('art/slime.atlas.json', {});
  await f.put('other/ART.json', recipe);
  await f.put('scene.json', { format: 'pixelforge-scene' });
  await f.put('normal.json', { format: 'pixelforge-normals' });
  await f.put('node_modules/ignore.json', recipe);
  await f.put('.hidden/ignore.json', recipe);
  const result = f.command(0, 'build', '--init');
  assert.match(result.next, /pixelbolt build.*--force/);
  const original = await f.read(manifest), made = await f.json(manifest);
  assert.equal(made.pixelbolt, version);
  assert.deepEqual(made.entries.map(e => e.file), ['aaa.pixel.json', 'art.json', 'art/slime.odd.json', 'other/ART.json']);
  assert.equal(new Set(result.entries.map(name => name.toLowerCase())).size, 4);
  assert.deepEqual(made.entries.map(e => e.outputs), [[{ sheet: '.' }], [{ sheet: 'art' }], [{ sheet: 'art' }], [{ sheet: 'other' }]]);
  assert.match(result.skipped.find(p => p.file === 'art/slime.pixel.json').reason, /export/);
  assert.match(f.command(1, 'build', '--init', '--force').error, /already exists/);
  assert.deepEqual(await f.read(manifest), original);
  assert.equal((await f.build()).ok, true);
  await mkdir(f.at('empty'));
  await assert.rejects(build(f.at('empty'), { init: true }), /no recipes/);
  assert.deepEqual(await readdir(f.at('empty')), []);
});

test('--only preserves unselected records and checks the names; --keep saves the recipe once', async t => {
  const f = await fixture(t), entries = [entry([{ still: 'hero.png' }]), entry([{ sheet: 'extra' }], { name: 'extra' })];
  await f.manifest(entries);
  const first = f.command(0, 'build', '--only', 'hero', '--keep', 'kept');
  assert.deepEqual(first.rendered, ['hero']);
  assert.deepEqual(await f.read('kept/hero.json'), Buffer.from(formatJSON(recipe)));
  assert.equal(f.exists('extra'), false);
  assert.deepEqual(Object.keys((await f.json(lock)).entries), ['hero']);
  assert.match(f.command(1, 'build', '--only', 'heros').error, /did you mean "hero".*hero, extra/);
  const extra = f.command(0, 'build', '--only', 'EXTRA,hero');
  assert.deepEqual(extra.rendered, ['extra']);
  const saved = (await f.json(lock)).entries.extra;
  entries[1].outputs = [{ bundle: 'different' }];
  await f.manifest(entries);
  // Kept again with the same bytes, it is left as it is; a different file there is refused.
  const again = await f.build({ only: 'hero', keep: 'kept' });
  assert.equal(again.ok, true);
  assert.ok(again.skipped.includes('kept/hero.json'));
  await f.put('kept/hero.json', 'my notes');
  assert.equal((await f.build({ only: 'hero', keep: 'kept' })).refused[0].file, 'kept/hero.json');
  assert.deepEqual((await f.json(lock)).entries.extra, saved);
  assert.equal(f.exists('different'), false);
});

test('manifest validation names the field, describes the supported options, and identifies the failing entry', async t => {
  const f = await fixture(t);
  for (const [value, field, message] of [
    [{ ...entry([{ sheet: '.' }]), name: '/bad' }, 'entries[0].name', /letters/],
    [{ ...entry([]), outpuss: [] }, 'entries.hero.outpuss', /did you mean "outputs"/],
    [entry([{ gif: 'a.gif', columns: 2 }]), 'entries.hero.outputs[0].columns', /columns is not supported.*pixelbolt gif takes/],
    [entry([{ sheet: '.', scale: 17 }]), 'entries.hero.outputs[0].scale', /1 to 16/],
    [entry([{ bundle: '.', columns: 0 }]), 'entries.hero.outputs[0].columns', /frame count/],
    [entry([{ still: 'still.gif' }]), 'entries.hero.outputs[0].still', /\.png/],
    [entry([{ sheet: '.', gif: 'x.gif' }]), 'entries.hero.outputs[0]', /exactly one/],
    [entry([{ sheet: '.' }], { preset: 'campfire' }), 'entries.hero', /exactly one/],
    [entry([{ sheet: '.' }], { compile: { size: 'tiny' } }), 'entries.hero.compile.size', /canvas size/]
  ]) {
    await f.manifest([value]);
    await assert.rejects(f.build(), error => error.name === 'PixelError' && error.path === field && message.test(error.message));
  }
  await f.manifest([entry([{ sheet: '.' }])], { entriess: [] });
  await assert.rejects(f.build(), /did you mean "entries"/);
  await f.manifest([entry([{ sheet: 'a' }]), entry([{ sheet: 'b' }], { name: 'HERo' })]);
  await assert.rejects(f.build(), /unique ignoring case/);
  for (const [out, field] of [[{ sheet: '.', columns: 3 }, 'columns'], [{ still: 'a.png', frame: 'third' }, 'frame'],
    [{ gif: 'a.gif', animation: 'run' }, 'animation'], [{ gif: 'b.gif', background: '#rgba' }, 'background']]) {
    await f.manifest([entry([out])]);
    const { failed } = await f.build();
    assert.equal(failed[0].path, `entries.hero.outputs[0].${field}`);
    if (field === 'frame') assert.match(failed[0].error, /first, second/);
  }
  await f.manifest([entry([{ sheet: '.' }], { compile: {} })]);
  assert.equal((await f.build()).failed[0].path, 'entries.hero.compile');
  await f.put('scene.json', { format: 'pixelforge-scene' });
  await f.manifest([entry([{ sheet: '.' }], { file: 'scene.json' }), entry([{ still: 'good.png' }], { name: 'good' })]);
  const reply = f.command(1, 'build');
  assert.match(reply.failed[0].error, /use pixelbolt scene or pixelbolt gif/);
  assert.deepEqual(reply.written, ['good.png']);
  for (const args of [['--check', '--force'], ['--check', '--keep', 'foo'], ['--init', '--only', 'hero'], ['--init', '--check'], ['--init', '--keep', 'a']])
    assert.match(f.command(1, 'build', ...args).error, /cannot be combined/);
  const help = spawnSync(process.execPath, [cli, 'build', '--help'], { encoding: 'utf8' });
  assert.ok(help.stdout.includes(lock) && help.stdout.length < 3000);
});

test('renamed frames are removed only while owned; dropped entries and outputs are reported once and retained', async t => {
  const f = await fixture(t), outputs = [{ bundle: 'all' }, { still: 'a.png' }];
  const entries = [entry(outputs), entry([{ gif: 'b.gif' }], { name: 'another' })];
  await f.manifest(entries);
  assert.equal((await f.build()).ok, true);
  const changed = structuredClone(recipe);
  changed.frames[1].name = 'next';
  changed.animations.walk.frames[1] = 'next';
  await f.put('art.json', changed);
  const old = await f.read('all/frames/second.png');
  await f.put('all/frames/second.png', 'edited obsolete file');
  const kept = await f.build();
  assert.equal(kept.refused[0].file, 'all/frames/second.png');
  assert.equal(f.exists('all/frames/next.png'), false);
  await f.put('all/frames/second.png', old);
  await f.manifest([entry([outputs[0]])]);
  // --check names what the record still holds and the manifest dropped, since the build will change the record.
  const checked = await f.build({ check: true });
  assert.deepEqual(checked.problems.filter(p => p.reason === 'orphaned').map(p => [p.entry, p.output]), [['hero', 'still a.png'], ['another', 'gif b.gif']]);
  const rebuilt = await f.build();
  assert.deepEqual(rebuilt.removed, ['all/frames/second.png']);
  assert.equal(f.exists('all/frames/second.png'), false);
  assert.equal(f.exists('all/frames/next.png'), true);
  assert.deepEqual(rebuilt.orphaned, [{ entry: 'hero', output: 'still a.png' }, { entry: 'another', output: 'gif b.gif' }]);
  assert.ok(f.exists('a.png') && f.exists('b.gif'));
  assert.equal((await f.build()).orphaned, undefined);
});

test('direct stack rendering and normals with a nested source match the CLI and skip compilation on check', async t => {
  const f = await fixture(t);
  const stack = { format: 'pixelforge-stack', version: 1, name: 'block', palette: { $ref: 'colors.json' }, slices: [['kk', 'kk']], headings: [0, 90] };
  await f.put('colors.json', palette);
  await f.put('stack.json', stack);
  await f.put('actor.json', { ...poses, palette: palette.palette });
  await f.put('normal.json', { version: 1, format: 'pixelforge-normals', recipe: 'actor.json' });
  f.command(0, 'render', 'stack.json', '--out', 'ref-stack');
  f.command(0, 'compile', 'normal.json', '--out', 'normal-compiled.json');
  f.command(0, 'render', 'normal-compiled.json', '--out', 'ref-normal');
  await f.manifest([entry([{ bundle: 'stack' }], { file: 'stack.json' }), entry([{ bundle: 'normal' }], { name: 'normal', file: 'normal.json' })]);
  const built = await f.build();
  assert.equal(built.ok, true, JSON.stringify(built.failed));
  for (const name of ['stack', 'normal']) for (const file of await fileList(f.at(`ref-${name}`)))
    assert.deepEqual(await f.read(`${name}/${file}`), await f.read(`ref-${name}/${file}`), file);
  assert.deepEqual((await f.build()).stats, noWork);
  assert.deepEqual((await f.build({ check: true })).stats, noWork);
});

test('the Godot importer claims neither build filename', async () => {
  const gd = await readFile(new URL('../godot/addons/pixelbolt/import.gd', import.meta.url), 'utf8');
  const list = gd.match(/func _get_recognized_extensions\(\)[^\n]*\n\s*return PackedStringArray\((\[[^\]]+\])\)/);
  assert.ok(list);
  for (const ext of JSON.parse(list[1])) for (const name of [manifest, lock]) assert.equal(name.endsWith(`.${ext}`), false);
});

test('a partial record identifies a missing hash and a bundle adopts the identical file without rewriting it', async t => {
  const f = await fixture(t);
  await f.manifest([entry([{ bundle: 'out' }])]);
  await f.build();
  const record = await f.json(lock), file = 'out/animations/walk.png';
  delete record.entries.hero.outputs['bundle out'].files[file];
  await f.put(lock, record);
  const checked = await f.build({ check: true });
  assert.deepEqual(checked.problems.map(p => [p.file, p.reason]), [[file, 'unrecorded']]);
  assert.deepEqual(checked.stats, noWork);
  const rebuilt = await f.build();
  assert.equal(rebuilt.ok, true);
  assert.equal(rebuilt.written, undefined);
  assert.deepEqual((await f.build()).stats, noWork);
});

test('a recorded output is judged by its record: a file it never wrote is not missing', async t => {
  const f = await fixture(t);
  await f.manifest([entry([{ bundle: 'out' }])]);
  await f.build();
  // As if the bundle's file names were guessed wrong: the record lacks one, and so does the folder.
  const record = await f.json(lock), file = 'out/animations/walk.png';
  delete record.entries.hero.outputs['bundle out'].files[file];
  await f.put(lock, record);
  await rm(f.at(file));
  const checked = await f.build({ check: true });
  assert.equal(checked.ok, true, JSON.stringify(checked.problems));
  assert.deepEqual((await f.build()).stats, noWork);
  // Before any record the names are all there is, so the same absent file is missing.
  await rm(f.at(lock));
  assert.ok((await f.build({ check: true })).problems.some(p => p.file === file && p.reason === 'missing'));
});

test('a recipe renamed only in letter case renames its files where the file system ignores case', async t => {
  const f = await fixture(t);
  await f.manifest([entry([{ sheet: 'out' }])]);
  await f.build();
  if (!f.exists('out/SPRITE.png')) return t.skip('this folder keeps letter case apart');
  // The pixels are the same, so the sheet's bytes are too; only its name and the atlas's image change.
  await f.put('art.json', { ...recipe, name: 'Sprite' });
  assert.equal((await f.build()).ok, true);
  assert.deepEqual(await readdir(f.at('out')), ['Sprite.atlas.json', 'Sprite.png']);
  assert.equal((await f.build({ check: true })).ok, true);
  // A file given the old spelling again on disk is named by --check, and the next build renames it.
  await rename(f.at('out/Sprite.png'), f.at('out/moved.png'));
  await rename(f.at('out/moved.png'), f.at('out/sprite.png'));
  assert.deepEqual((await f.build({ check: true })).problems.map(p => [p.file, p.reason]), [['out/Sprite.png', 'stale']]);
  assert.equal((await f.build()).ok, true);
  assert.deepEqual(await readdir(f.at('out')), ['Sprite.atlas.json', 'Sprite.png']);
});

test('an entry renamed with its recipe changed still owns its files, and its old record stays until a clean run', async t => {
  const f = await fixture(t);
  await f.manifest([entry([{ sheet: 'out' }])]);
  await f.build();
  await f.put('art.json', { ...recipe, palette: { k: '#445566' } });
  await f.manifest([entry([{ sheet: 'out' }], { name: 'player' })]);
  assert.deepEqual((await f.build({ check: true })).problems.map(p => p.reason).sort(), ['orphaned', 'stale', 'stale']);
  const renamed = await f.build();
  assert.equal(renamed.ok, true, JSON.stringify(renamed.refused));
  assert.deepEqual(renamed.written, ['out/sprite.png']);
  assert.deepEqual(renamed.orphaned, [{ entry: 'hero', output: 'sheet out' }]);
  assert.deepEqual(Object.keys((await f.json(lock)).entries), ['player']);
  // Renamed again while a file is changed by hand: refused, and the old name's record stays so nothing is lost.
  await f.put('art.json', { ...recipe, palette: { k: '#778899' } });
  await f.manifest([entry([{ sheet: 'out' }], { name: 'hero' })]);
  await f.put('out/sprite.atlas.json', 'edited');
  const refused = await f.build();
  assert.deepEqual(refused.refused.map(r => [r.file, r.reason]), [['out/sprite.atlas.json', 'edited']]);
  assert.deepEqual(Object.keys((await f.json(lock)).entries), ['player']);
  await rm(f.at('out/sprite.atlas.json'));
  const clean = await f.build();
  assert.equal(clean.ok, true);
  assert.deepEqual(Object.keys((await f.json(lock)).entries), ['hero']);
});

test('a file two records name with different hashes is the build output if it matches either', async t => {
  const f = await fixture(t), colour = k => ({ ...recipe, palette: { k } });
  await f.manifest([entry([{ sheet: 'out' }])]);
  await f.build();
  // Renamed with the recipe changed, in a run where another entry fails: the old record stays beside the new one.
  await f.put('art.json', colour('#445566'));
  await f.put('broken.json', { ...recipe, frames: [null] });
  await f.manifest([entry([{ sheet: 'out' }], { name: 'player' }), entry([{ still: 'b.png' }], { name: 'broken', file: 'broken.json' })]);
  const failed = await f.build();
  assert.equal(failed.failed[0].entry, 'broken');
  assert.deepEqual(Object.keys((await f.json(lock)).entries), ['player', 'hero']);
  // Renamed back and changed again: hero's old record names other bytes, player's names these; either makes it ours.
  await f.put('art.json', colour('#778899'));
  await f.manifest([entry([{ sheet: 'out' }])]);
  const back = await f.build();
  assert.equal(back.ok, true, JSON.stringify(back.refused));
  assert.deepEqual(back.written, ['out/sprite.png']);
  assert.deepEqual(Object.keys((await f.json(lock)).entries), ['hero']);
});

test('a file that matches another record of it is stale, not changed by hand, even when its own record has current inputs', async t => {
  const f = await fixture(t);
  await f.manifest([entry([{ sheet: 'out' }])]);
  await f.build();
  await f.put('art.json', { ...recipe, palette: { k: '#445566' } });
  await f.put('broken.json', { ...recipe, frames: [null] });
  await f.manifest([entry([{ sheet: 'out' }], { name: 'player' }), entry([{ still: 'b.png' }], { name: 'broken', file: 'broken.json' })]);
  await f.build();
  // Back to the first name and the first recipe: hero's own record is current again, but the sheet holds player's bytes.
  await f.put('art.json', recipe);
  await f.manifest([entry([{ sheet: 'out' }])]);
  const reasons = (await f.build({ check: true })).problems.map(p => p.reason);
  assert.ok(reasons.includes('stale') && !reasons.includes('edited'), reasons.join());
  const back = await f.build();
  assert.equal(back.ok, true, JSON.stringify(back.refused));
  assert.deepEqual(back.written, ['out/sprite.png']);
});

test('an output folder named in other letter case on disk is refused with what to do, never renamed', async t => {
  const f = await fixture(t);
  await f.manifest([entry([{ sheet: 'out' }])]);
  await f.build();
  if (!f.exists('OUT/sprite.png')) return t.skip('this folder keeps letter case apart');
  await f.manifest([entry([{ sheet: 'Out' }])]);
  const checked = await f.build({ check: true });
  assert.ok(checked.problems.some(p => p.reason === 'case' && /would go into out on disk.*rename that folder/.test(p.message)), JSON.stringify(checked.problems));
  const refused = await f.build();
  assert.deepEqual([...new Set(refused.refused.map(r => r.reason))], ['case']);
  assert.ok((await readdir(f.at('.'))).includes('out'));
  await rename(f.at('out'), f.at('moved'));
  await rename(f.at('moved'), f.at('Out'));
  assert.equal((await f.build()).ok, true);
  assert.equal((await f.build({ check: true })).ok, true);
});

test('a manifest named inside a folder that is not there says so', async t => {
  const f = await fixture(t);
  for (const target of [f.at('nowhere'), f.at('nowhere/pixelbolt.build.json')]) await assert.rejects(build(target), /does not exist/);
  await assert.rejects(build(f.at('nowhere'), { init: true }), /does not exist/);
});

test('a failed input retains its record, protects its references, and allows independent entries to finish', async t => {
  const f = await fixture(t), bad = entry([{ bundle: 'out' }]);
  await f.manifest([bad]);
  await f.build();
  const old = (await f.json(lock)).entries.hero;
  await f.put('art.json', { ...recipe, frames: [null] });
  await f.put('good.json', recipe);
  await f.manifest([bad, entry([{ still: 'good.png' }], { name: 'good', file: 'good.json' })]);
  const run = await f.build();
  assert.equal(run.failed[0].entry, 'hero');
  assert.deepEqual((await f.json(lock)).entries.hero, old);
  assert.deepEqual(run.written, ['good.png']);
  await f.put('art.json', { ...recipe, palette: { $ref: 'protected.png' } });
  await f.put('protected.png', 'invalid palette');
  await f.manifest([bad, entry([{ still: 'new.png' }, { still: 'protected.png' }], { name: 'good', file: 'good.json' })]);
  await assert.rejects(f.build({ force: true }), /replace an input/);
  assert.equal(f.exists('new.png'), false);
  assert.equal((await f.read('protected.png')).toString(), 'invalid palette');
});

test('Node CommonJS default exports reload and replacing a hard-linked output changes only the named file', async t => {
  const f = await fixture(t);
  await f.put('mod/package.json', { type: 'commonjs' });
  const code = `module.exports = ${JSON.stringify(recipe)}`;
  await f.put('mod/item.js', code);
  await f.manifest([{ name: '10', module: 'mod/item.js', outputs: [{ still: 'ten.png' }] }, entry([{ sheet: 'two' }], { name: '2' })]);
  assert.equal((await f.build()).ok, true);
  const text = (await f.read(lock)).toString();
  assert.ok(text.indexOf('"10":') < text.indexOf('"2":'));
  const first = await f.read('ten.png');
  await link(f.at('ten.png'), f.at('copy.png'));
  await f.put('mod/item.js', code.replace('#112233', '#fedcba'));
  assert.equal((await f.build({ check: true })).problems[0].reason, 'stale');
  const changed = await f.build();
  assert.equal(changed.ok, true, JSON.stringify(changed.failed));
  assert.deepEqual(changed.written, ['ten.png']);
  assert.deepEqual(await f.read('copy.png'), first);
  assert.notDeepEqual(await f.read('ten.png'), first);
});
