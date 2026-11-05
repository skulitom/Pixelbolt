import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { presetEntries, loadPreset, compilePreset } from '../src/presets.js';
import { renderProject } from '../src/core.js';
import { EFFECT_PRESETS } from '../studio/effects-controls.js';
import { FLUID_PRESETS } from '../studio/fluid-controls.js';
import { FLUID_SHOWCASE } from '../showcase/fluid/build.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)), cli = path.join(root, 'bin', 'pixelbolt.js'), examples = path.join(root, 'examples');
const runScript = (options, script, ...args) => promisify(execFile)(process.execPath, [...options, script, ...args], { maxBuffer: 16 * 1048576 });
const run = (...args) => runScript([], cli, ...args);

// Small presets, one of each kind, so a command here takes a moment rather than the minute that measuring every preset
// takes on a slow runner: a gas, a wave, a pose rig, a plain recipe, and an fx preset that names another file (the
// swing trail draws the swing rig) if there is one. A renamed preset leaves the first of its kind in its place.
const SMALL = { fluid: 'smoke-puff', wave: 'interference', poses: 'swing', recipe: 'coin', fx: 'swing-trail' };
async function smallPresets(entries) {
  const of = kind => entries.filter(entry => entry.kind === kind), naming = [];
  for (const entry of of('fx')) if (/"recipe":\s*"/.test(await readFile(path.join(examples, entry.file), 'utf8'))) naming.push(entry);
  const pick = (list, kind) => list.find(entry => entry.name === SMALL[kind]) ?? list[0];
  return [...['fluid', 'wave', 'poses', 'recipe'].map(kind => pick(of(kind), kind)), pick(naming.length ? naming : of('fx'), 'fx')].filter(Boolean);
}

// More small presets for the listing, whose descriptions take its other branches: an Effects lab title on a mix of
// loops and one-shots, a rig's motion templates, and more than 12 animations.
const DESCRIBED = ['effects', 'slime-idle', 'holy-spells'];

// A clock that reads an hour later at every reading, so a listing with any time budget stops measuring at once.
const HOUR_PER_READING = `data:text/javascript,${encodeURIComponent('const now = Date.now; let readings = 0; Date.now = () => now() + 3600000 * readings++;')}`;

test('pixelbolt presets lists every preset and measures each however long that takes, and prints one preset\'s source', async t => {
  // The listing runs in a copy of the package that holds the small presets, on the clock above. presets.test.js compiles
  // and renders every shipped preset, and checks the listed facts of each one its MCP listing measures within its budget.
  const copy = await mkdtemp(path.join(path.resolve(os.tmpdir()), 'pixelbolt-presets-cli-'));
  t.after(() => rm(copy, { recursive: true, force: true }));
  await Promise.all(['bin', 'src', 'studio', 'package.json'].map(item => cp(path.join(root, item), path.join(copy, item), { recursive: true })));
  const entries = await presetEntries(), picked = [...await smallPresets(entries), ...entries.filter(entry => DESCRIBED.includes(entry.name))];
  assert.ok(picked.length > 0);
  for (const entry of picked) for (const file of [`examples/${entry.file}`, ...(await loadPreset(entry)).inlined]) {
    await mkdir(path.dirname(path.join(copy, file)), { recursive: true });
    await cp(path.join(root, file), path.join(copy, file));
  }
  const { guide, presets } = JSON.parse((await runScript(['--import', HOUR_PER_READING], path.join(copy, 'bin', 'pixelbolt.js'), 'presets')).stdout);
  const copied = await (await import(pathToFileURL(path.join(copy, 'src', 'presets.js')).href)).presetEntries();
  assert.match(guide, /pixel_compile \{"preset": "<name>"\}/);
  assert.deepEqual(presets.map(entry => [entry.name, entry.file]), copied.map(entry => [entry.name, `examples/${entry.file}`]));
  for (const entry of picked) assert.ok(presets.some(listed => listed.file === `examples/${entry.file}`), entry.name);
  // No time budget in a shell: every preset is measured.
  assert.ok(presets.every(entry => entry.size && entry.frames && entry.plays && entry.colors && entry.for && !entry.error && !entry.unmeasured));
  // The listing says what a lab preset is for with its title and note in the lab's list, so every lab preset has both.
  for (const entry of [...FLUID_PRESETS, ...EFFECT_PRESETS]) assert.ok(typeof entry.title === 'string' && entry.title && typeof entry.note === 'string' && entry.note, entry.file);
  const smoke = entries.find(entry => entry.file === 'smoke-puff.fluid.json');
  if (smoke) {
    const one = JSON.parse((await run('presets', smoke.name)).stdout);
    assert.deepEqual(one.source, JSON.parse(await readFile(path.join(examples, smoke.file), 'utf8')));
    assert.match(one.next, /pixelbolt compile --preset smoke-puff/);
  }
});

// A listed preset has colours only if it draws something. The fluid presets' golden recipes in fluid.test.js pin every
// byte they draw, so this renders the others.
test('every shipped preset draws something', async () => {
  const draws = project => project.frames.some(frame => { for (let i = 3; i < frame.data.length; i += 4) if (frame.data[i]) return true; return false; });
  for (const entry of await presetEntries()) {
    if (entry.kind === 'fluid' && FLUID_SHOWCASE.includes(entry.base)) continue;
    assert.ok(draws(renderProject(compilePreset((await loadPreset(entry)).source).recipe)), `${entry.name} draws no pixel`);
  }
});

test('compile --preset writes the bytes compiling the preset\'s file writes, and refuses metadata a recipe lacks', async t => {
  const dir = await mkdtemp(path.join(path.resolve(os.tmpdir()), 'pixelbolt-presets-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const entries = await presetEntries();
  // compile --preset reads the preset's own file: one preset of each kind shows it, an fx one that names another file
  // if there is one.
  const picked = await smallPresets(entries);
  await Promise.all(picked.map(async entry => {
    const out = path.join(dir, `${entry.name}.json`), file = path.join(dir, `${entry.name}.file.json`);
    await run('compile', '--preset', entry.name, '--out', out);
    if (entry.kind === 'recipe') assert.equal(await readFile(out, 'utf8'), await readFile(path.join(examples, entry.file), 'utf8'), entry.name);
    else {
      await run('compile', path.join(examples, entry.file), '--out', file);
      assert.equal(await readFile(out, 'utf8'), await readFile(file, 'utf8'), entry.name);
    }
  }));
  const recipe = entries.find(entry => entry.kind === 'recipe');
  if (recipe) {
    const refused = await run('compile', '--preset', recipe.name, '--out', path.join(dir, 'x.json'), '--metadata', path.join(dir, 'x.meta.json')).then(() => null, error => error);
    assert.ok(refused, 'compile --metadata of a plain recipe preset fails');
    assert.match(refused.stdout + refused.stderr, /has no metadata; omit --metadata/);
    await assert.rejects(readFile(path.join(dir, 'x.json')), { code: 'ENOENT' });
  }
  await assert.rejects(run('compile', path.join(examples, entries[0].file), '--preset', entries[0].name, '--out', path.join(dir, 'y.json')));
});
