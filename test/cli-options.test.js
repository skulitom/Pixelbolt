import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = (...args) => spawnSync(process.execPath, ['bin/pixelbolt.js', ...args], { cwd: root, encoding: 'utf8' });
const piped = (input, ...args) => spawnSync(process.execPath, ['bin/pixelbolt.js', ...args], { cwd: root, input, encoding: 'utf8' });
const refused = out => { assert.equal(out.status, 1, out.stdout.slice(0, 200)); return JSON.parse(out.stderr); };
const HELP = /^Pixelbolt — text to pixels/;
const temp = async (t, name) => { const dir = await mkdtemp(path.join(os.tmpdir(), `pixelbolt-${name}-`)); t.after(() => rm(dir, { recursive: true, force: true })); return dir; };

test('-h where an option takes its value is that value, not a request for the help', async t => {
  const dir = await temp(t, 'help-value'), at = name => path.join(dir, name);
  // Each command gets the value and judges it: the errors name the field, where the help used to print and exit 0.
  assert.equal(cli('inspect', 'examples/coin.json', '--frames', 'turn-0', '--scale', '1', '--out', at('-h0001.png')).status, 0);
  for (const [args, where] of [
    [['inspect', 'examples/coin.json', '--animation', '-h'], 'inspect.animation'],
    [['import', at('-h0001.png'), '--name', '-h', '--out', at('imported.json')], 'project.name'],
    [['gif-frames', at('empty'), '--prefix', '-h', '--fps', '12', '--out', at('none.gif')], 'frames']
  ]) {
    await mkdir(at('empty'), { recursive: true });
    const error = refused(cli(...args));
    assert.ok(error.path.startsWith(where), `${args.join(' ')}: ${error.error}`);
  }
  // And a value of -h that suits its option is used: frames named -h0001.png, -h0002.png.
  await copyFile(at('-h0001.png'), at('-h0002.png'));
  const gif = cli('gif-frames', dir, '--prefix', '-h', '--fps', '12', '--out', at('loop.gif'));
  assert.equal(gif.status, 0, gif.stderr);
  assert.equal(JSON.parse(gif.stdout).frames, 2);
  assert.equal((await readFile(at('loop.gif'))).subarray(0, 6).toString('latin1'), 'GIF89a');
  // Anywhere else among the arguments both spellings still ask for the help, and write nothing. A value never starts
  // with --, so --help after an option that lacks its value is the request too.
  for (const args of [['validate', '-h'], ['validate', '--help'], ['render', 'sprite.json', '-h'], ['inspect', 'examples/coin.json', '--animation', 'spin', '-h'],
    ['gif', 'examples/coin.json', '--help', '--out', at('help.gif')], ['gif', 'examples/coin.json', '--out', '--help'], ['presets', '--find', '--help'], ['help', 'guide', '-h'], ['-h']]) {
    const out = cli(...args);
    assert.equal(out.status, 0, args.join(' ')); assert.match(out.stdout, HELP, args.join(' '));
  }
  assert.ok(!existsSync(at('help.gif')));
});

test('compile --expand refuses --preview, which it would never write', async t => {
  const dir = await temp(t, 'expand'), at = name => path.join(dir, name);
  for (const out of [[], ['--out', at('expanded.poses.json')]]) {
    const error = refused(cli('compile', 'examples/slime-idle.poses.json', '--expand', '--preview', at('preview.png'), ...out));
    assert.match(error.error, /^--expand prints the poses and draws no image; omit --preview/);
  }
  assert.deepEqual(await readdir(dir), []);
  // Its other refusals and the plain call are as before.
  assert.match(refused(cli('compile', 'examples/slime-idle.poses.json', '--expand', '--metadata', at('meta.json'))).error, /omit --metadata/);
  assert.match(refused(cli('compile', 'examples/slime-idle.poses.json', '--expand', '--size', '32x32')).error, /^--size (goes|and --frames go) with a compile that writes a recipe/);
  const fine = cli('compile', 'examples/slime-idle.poses.json', '--expand', '--out', at('expanded.poses.json'));
  assert.equal(fine.status, 0, fine.stderr);
  assert.deepEqual(await readdir(dir), ['expanded.poses.json']);
});

test('two inputs named - are refused by name, whichever two they are', async t => {
  const dir = await temp(t, 'stdin'), at = name => path.join(dir, name);
  const coin = await readFile(path.join(root, 'examples/coin.json'), 'utf8'), scene = await readFile(path.join(root, 'examples/forest-spirit-lit.scene.json'), 'utf8');
  await writeFile(at('changes.json'), '[{"set": "name", "value": "penny"}]');
  const FILE = 'the input file';
  for (const [args, first, second, input = coin] of [
    [['overlay', '-', '--changes', at('changes.json'), '--selections', '-', '--out', at('overlay.json')], FILE, '--selections'],
    [['overlay', 'examples/coin.json', '--changes', '-', '--selections', '-', '--out', at('overlay.json')], '--changes', '--selections'],
    [['overlay', '-', '--changes', '-', '--out', at('overlay.json')], FILE, '--changes'],
    [['inspect', '-', '--guides', '-'], FILE, '--guides'],
    [['inspect', 'examples/coin.json', '--reference', '-', '--guides', '-'], '--reference', '--guides'],
    [['inspect', '-', '--reference', '-'], FILE, '--reference'],
    [['inspect', '-', '--motion', 'spin', '--metadata', '-'], FILE, '--metadata'],
    [['scene', '-', '--image', at('scene.png'), '--guides', '-'], FILE, '--guides', scene],
    [['patch', '-', '--changes', '-'], FILE, '--changes'],
    [['render', '-', '--expect', '-', '--out', at('bundle')], FILE, '--expect']
  ]) {
    const { error } = refused(piped(input, ...args));
    assert.equal(error, `Only one input can use stdin: ${first} and ${second} are both given as -. Put one of them in a file and name the file.`, args.join(' '));
  }
  assert.deepEqual(await readdir(dir), ['changes.json']);
  // One input from stdin still works, whichever it is.
  for (const [input, ...args] of [[coin, 'inspect', '-'], ['{"horizon":4}', 'inspect', 'examples/coin.json', '--guides', '-'], [coin, 'inspect', 'examples/coin.json', '--reference', '-'],
    ['[{"set": "name", "value": "penny"}]', 'patch', 'examples/coin.json', '--changes', '-'], ['{"width":24,"height":24}', 'render', 'examples/coin.json', '--expect', '-', '--out', at('bundle')]]) {
    const out = piped(input, ...args);
    assert.equal(out.status, 0, `${args.join(' ')}: ${out.stderr}`);
  }
});

test('an option given twice is refused by name; a flag given twice is taken', async t => {
  const dir = await temp(t, 'twice'), at = name => path.join(dir, name);
  // The second value used to win without a word: only b.gif was written.
  assert.equal(refused(cli('gif', 'examples/coin.json', '--out', at('a.gif'), '--out', at('b.gif'))).error, `--out is given twice (${at('a.gif')} and ${at('b.gif')}); give it once`);
  assert.equal(refused(cli('gif', 'examples/coin.json', '--scale', '2', '--out', at('a.gif'), '--scale', '3')).error, '--scale is given twice (2 and 3); give it once');
  assert.deepEqual(await readdir(dir), []);
  // Lists go in one value, and the error writes it.
  assert.equal(refused(cli('inspect', 'examples/coin.json', '--frames', 'turn-0', '--frames', 'turn-1')).error, '--frames is given twice (turn-0 and turn-1); give it once, with the whole list in one value: --frames turn-0,turn-1');
  assert.match(refused(cli('inspect', 'examples/forest-spirit.json', '--layers', 'a', '--layers', 'b')).error, /^--layers is given twice .*: --layers a,b$/);
  assert.match(refused(cli('compile', 'examples/hero.poses.json', '--draft-views', 'nearBoot:30', '--draft-views', 'farBoot:330')).error, /: --draft-views nearBoot:30,farBoot:330$/);
  const listed = cli('inspect', 'examples/coin.json', '--frames', 'turn-0,turn-1', '--grid', '--grid');
  assert.equal(listed.status, 0, listed.stderr);
  const sheet = JSON.parse(listed.stdout);
  assert.equal(sheet.sheet.columns * sheet.sheet.rows, 2);
  assert.match(JSON.stringify(sheet.cells), /turn-0/); assert.match(JSON.stringify(sheet.cells), /turn-1/);
});

test('a call whose output cannot be written leaves none of its outputs, and says which option and why', async t => {
  const dir = await temp(t, 'outputs'), at = (...names) => path.join(dir, ...names);
  await writeFile(at('blocker'), 'an ordinary file');
  // Known before anything is written: a folder in the path is a file. The GIF used to be written and left behind, so
  // the corrected call was refused as "Output already exists".
  for (const [args, option, first] of [
    [['gif', 'examples/coin.json', '--out', at('first.gif'), '--sheet', at('blocker', 'sheet.png')], '--sheet', 'first.gif'],
    [['compile', 'examples/slime-idle.poses.json', '--out', at('first.json'), '--metadata', at('blocker', 'deeper', 'meta.json')], '--metadata', 'first.json']
  ]) {
    const { error } = refused(cli(...args));
    assert.ok(error.startsWith(`${option} cannot be written to ${args.at(-1)}: ${at('blocker')} is a file, not a folder. No files were written.`), error);
    assert.doesNotMatch(error, /EEXIST|ENOTDIR|ENOENT|mkdir/);
    assert.ok(!existsSync(at(first)), `${first} was left behind`);
  }
  assert.deepEqual(await readdir(dir), ['blocker']);
  const corrected = cli('gif', 'examples/coin.json', '--out', at('first.gif'), '--sheet', at('sheets', 'sheet.png'));
  assert.equal(corrected.status, 0, corrected.stderr);
  // A folder under the output's own name is said as that, with or without --force.
  await mkdir(at('folder.gif'));
  for (const force of [[], ['--force']]) assert.match(refused(cli('gif', 'examples/coin.json', '--out', at('folder.gif'), ...force)).error, /^--out cannot be written to .*folder\.gif: a folder has that name\. No files were written\.$/);

  // Found only while writing: a name too long for any file system. The GIF written before it and the folders made for
  // the sheet are removed again.
  const fresh = at('fresh'), long = path.join(fresh, 'new', 'deep', `${'x'.repeat(300)}.png`);
  await mkdir(fresh);
  const failed = refused(cli('gif', 'examples/coin.json', '--out', path.join(fresh, 'made.gif'), '--sheet', long)).error;
  const start = `--sheet could not be written to ${long}: `;
  assert.ok(failed.startsWith(start), failed);
  assert.match(failed.slice(start.length), /^[^.]*too long[^.]*\. The file /);
  assert.ok(failed.endsWith(`The file this call had written before it (${path.join(fresh, 'made.gif')}) was removed again. Nothing of this call is left on disk.`), failed);
  assert.doesNotMatch(failed, /ENAMETOOLONG|ENOENT|, open /);
  assert.deepEqual(await readdir(fresh), []);
  // Under --force a replaced file can't be put back: it holds the new bytes, and the error says so.
  await writeFile(path.join(fresh, 'made.gif'), 'an earlier run');
  const forced = refused(cli('gif', 'examples/coin.json', '--out', path.join(fresh, 'made.gif'), '--sheet', long, '--force')).error;
  assert.ok(forced.endsWith(`No new files were written; ${path.join(fresh, 'made.gif')} had already been replaced under --force and now holds this run's bytes.`), forced);
  assert.deepEqual(await readdir(fresh), ['made.gif']);
  assert.equal((await readFile(path.join(fresh, 'made.gif'))).subarray(0, 6).toString('latin1'), 'GIF89a');
});

test('every source that can link a shared palette compiles to a recipe that keeps the link', async t => {
  const dir = await temp(t, 'palette-link'), at = name => path.join(dir, name);
  const examples = { poses: 'slime-idle.poses.json', autotile: 'ground.autotile.json', fx: 'slash-hit.fx.json', fluid: 'smoke-puff.fluid.json', wave: 'portal.wave.json', crystal: 'pyrite.crystal.json', bodies: 'bouncing-pixel.bodies.json', powder: 'rain-on-fire.powder.json' };
  // The kinds src/resolve.js resolves a palette for: a kind added there has to be added here.
  const sidecars = /const sidecars = \{([^}]+)\}/.exec(await readFile(path.join(root, 'src/resolve.js'), 'utf8'))[1];
  assert.deepEqual([...sidecars.matchAll(/'pixelforge-[a-z]+': '([a-z]+)'/g)].map(match => match[1]).sort(), Object.keys(examples).sort());
  for (const [kind, file] of Object.entries(examples)) {
    const source = JSON.parse(await readFile(path.join(root, 'examples', file), 'utf8'));
    if (kind === 'powder') {
      // A powder source has no palette (its colours are its materials'), so there is nothing to link: said, not dropped.
      await writeFile(at('powder.palette.json'), JSON.stringify({ palette: { a: '#112233' } }));
      await writeFile(at('powder.source.json'), JSON.stringify({ ...source, palette: { $ref: './powder.palette.json' } }));
      assert.equal(refused(cli('compile', at('powder.source.json'), '--out', at('powder.recipe.json'))).path, 'powder.palette');
      continue;
    }
    assert.ok(Object.keys(source.palette).length && source.palette.$ref === undefined, `${file} has a palette of its own`);
    await writeFile(at(`${kind}.palette.json`), JSON.stringify({ palette: source.palette }));
    await writeFile(at(`${kind}.source.json`), JSON.stringify({ ...source, palette: { $ref: `./${kind}.palette.json` } }));
    const compiled = cli('compile', at(`${kind}.source.json`), '--out', at(`${kind}.recipe.json`));
    assert.equal(compiled.status, 0, `${kind}: ${compiled.stderr}`);
    const recipe = JSON.parse(await readFile(at(`${kind}.recipe.json`), 'utf8'));
    assert.equal(recipe.palette.$ref, `${kind}.palette.json`, `${kind} lost its link`);
    // Nothing of the shared file is repeated in the recipe, and it draws with the file's colours.
    for (const [key, color] of Object.entries(recipe.palette)) assert.ok(key === '$ref' || source.palette[key] !== color, `${kind}: ${key} is repeated`);
    const linked = cli('validate', at(`${kind}.recipe.json`));
    assert.equal(linked.status, 0, `${kind}: ${linked.stderr}`);
    assert.deepEqual(JSON.parse(linked.stdout).resolved, [at(`${kind}.palette.json`)]);
  }
});

test('validate on a source says what the file is and how to check it, and the package exports the render check', async () => {
  // Read as a recipe, a source's first field was "unknown", which reads as a broken file.
  const error = refused(cli('validate', 'examples/meteor.fx.json'));
  assert.match(error.error, /^validate checks a recipe, and this is a pixelforge-fx source; pixelbolt compile examples\/meteor\.fx\.json --out <new\.json> checks it/);
  // What the CLI and MCP check a render against is the library's too: createBundle alone delivered unchecked.
  const { readExpect, checkDelivery, briefCheck, renderProject } = await import('../src/index.js');
  const recipe = JSON.parse(await readFile(path.join(root, 'examples', 'coin.json'), 'utf8')), project = renderProject(recipe);
  const check = checkDelivery(project, { recipe, expect: readExpect({ width: project.width + 1 }) });
  assert.equal(check.ok, false);
  assert.ok(briefCheck(check).problems.length >= 1);
  assert.equal(checkDelivery(project, { recipe, expect: readExpect({ width: project.width, height: project.height }) }).ok, true);
});
