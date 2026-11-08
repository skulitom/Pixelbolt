// docs/fix-one-frame.md and examples/fix-one-frame/: an edit to a base pose reaches every frame built from it, and a
// blink fix with scope "frame" leaves every other frame byte-identical, the frame built from the blink included.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProject, compareProjects } from '../src/core.js';
import { patchRecipe } from '../src/patch.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const example = async file => JSON.parse(await readFile(path.join(root, 'examples', 'fix-one-frame', file), 'utf8'));
const pictures = project => new Map(project.frames.map(frame => [frame.name, Buffer.from(frame.data)]));

// The frames whose `from` chain reaches `name`, the frame itself first, in recipe order.
function builtFrom(recipe, name) {
  const reaches = new Set([name]);
  for (const frame of recipe.frames) if (reaches.has(frame.from)) reaches.add(frame.name);
  return recipe.frames.map(frame => frame.name).filter(frame => reaches.has(frame));
}

test('fix-one-frame: a base-pose edit reaches every frame built from it, and the reply lists them', async () => {
  const recipe = await example('mossling.json'), { recipe: leafy, edits } = patchRecipe(recipe, await example('base-edit.json'));
  assert.deepEqual(edits, [{ grid: 'frames[rest]', at: 'frames[0]', pixels: 7 }]);
  const { frames } = compareProjects(renderProject(recipe), renderProject(leafy));
  assert.deepEqual(frames.changed.map(frame => frame.frame), builtFrom(recipe, 'rest'));
  assert.deepEqual(frames.changed.map(frame => frame.frame), ['rest', 'rise', 'float', 'blink', 'doze', 'fall', 'settle']);
  assert.deepEqual(frames.unchanged, []);
  // The leaf rides with the body: the same seven pixels, one row higher for each pixel the frame rises.
  const rise = { rest: 0, rise: 1, float: 2, blink: 2, doze: 2, fall: 1, settle: 0 };
  for (const frame of frames.changed) assert.deepEqual([frame.pixels, frame.box], [7, { x: 13, y: 5 - rise[frame.frame], w: 5, h: 2 }], frame.frame);
});

test('fix-one-frame: the blink fix with scope "frame" changes only the blink; without it, doze changes too', async () => {
  const recipe = await example('mossling.json'), fix = await example('blink-fix.json');
  const leafy = patchRecipe(recipe, await example('base-edit.json')).recipe, before = renderProject(leafy);
  assert.deepEqual(builtFrom(leafy, 'blink'), ['blink', 'doze']);
  const { recipe: fixed, edits } = patchRecipe(leafy, fix), after = renderProject(fixed);
  assert.deepEqual(edits, [{ grid: 'frames[blink]', at: 'frames[3]', pixels: 14, scope: 'frame', protected: [{ frame: 'doze', pixels: 10 }] }]);
  const { frames } = compareProjects(before, after);
  assert.deepEqual(frames.changed.map(frame => [frame.frame, frame.pixels, frame.box]), [['blink', 10, { x: 8, y: 10, w: 7, h: 2 }]]);
  assert.deepEqual(frames.unchanged, ['rest', 'rise', 'float', 'doze', 'fall', 'settle']);
  const was = pictures(before), now = pictures(after);
  for (const [name, data] of was) if (name !== 'blink') assert.ok(data.equals(now.get(name)), `${name} is byte-identical`);
  assert.ok(!was.get('blink').equals(now.get('blink')));
  // The same change at the default scope flows on into doze, which is built from the blink.
  const inherited = fix.map(({ scope, ...change }) => change), wide = patchRecipe(leafy, inherited);
  assert.equal(wide.edits[0].protected, undefined);
  assert.deepEqual(compareProjects(before, renderProject(wide.recipe)).frames.changed.map(frame => [frame.frame, frame.pixels]), [['blink', 10], ['doze', 10]]);
});

test('fix-one-frame: the documented CLI commands give the replies the page quotes', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'pixelbolt-fix-one-frame-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const run = (...args) => {
    const result = spawnSync(process.execPath, ['bin/pixelbolt.js', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const leafy = path.join(dir, 'leafy.json'), fixed = path.join(dir, 'fixed.json');
  const base = run('patch', 'examples/fix-one-frame/mossling.json', '--changes', 'examples/fix-one-frame/base-edit.json', '--out', leafy, '--image', path.join(dir, 'base-edit.png'));
  assert.equal(base.frames.changed.length, 7);
  assert.deepEqual(base.image.frames.map(frame => frame.status), Array(7).fill('changed'));
  const blink = run('patch', leafy, '--changes', 'examples/fix-one-frame/blink-fix.json', '--out', fixed, '--image', path.join(dir, 'blink-fix.png'));
  assert.deepEqual(blink.edits[0].protected, [{ frame: 'doze', pixels: 10 }]);
  assert.deepEqual([blink.frames.changed.map(frame => frame.frame), blink.frames.unchanged], [['blink'], ['rest', 'rise', 'float', 'doze', 'fall', 'settle']]);
  assert.deepEqual(blink.image.frames, [{ frame: 'blink', status: 'changed' }]);
  // The corrections that hold doze in place are named by palette key, so a palette edit still reaches them.
  const doze = JSON.parse(await readFile(fixed, 'utf8')).frames.find(frame => frame.name === 'doze');
  assert.deepEqual([...new Set(doze.pixels.map(pixel => pixel.color))].sort(), ['h', 'k']);
});
