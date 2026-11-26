import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG } from '../src/png.js';
import { renderProject } from '../src/core.js';
import {
  RENDER_GIF_PIXELS, projectSummary, nameFromFile, validateAction, compileAction,
  patchAction, inspectAction, renderAction, sceneViewAction, importAction, sequenceAction
} from '../src/actions.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const json = async rel => JSON.parse(await readFile(path.join(root, rel), 'utf8'));

test('validateAction, patchAction and inspectAction share summaries, comparisons and beside stacking', async () => {
  const coin = await json('examples/coin.json');
  const validated = validateAction(coin, { fps: 30 });
  assert.equal(validated.summary.name, 'coin');
  assert.equal(validated.summary.frames, coin.frames.length);
  assert.ok(validated.frameGrid);
  assert.deepEqual(validated.summary, projectSummary(validated.project, coin));

  const key = Object.keys(coin.palette)[0];
  const patched = patchAction(coin, { changes: [{ set: `palette.${key}`, value: '#ff00ff' }] });
  assert.equal(patched.edits.length, 1);
  assert.ok(patched.report.frames.changed.length > 0);
  assert.ok(patched.comparison.frames.changed.length > 0);
  assert.ok(patched.image);

  const inspected = inspectAction(coin, {
    inspection: { scale: 2 },
    reference: patched.recipe,
    beside: [{ id: 'rev1', recipe: patched.recipe }],
    palette: true,
    call: 'mcp',
    formatBesideName: (item, other) => `${other.name} ${item.id}`
  });
  assert.equal(inspected.drawn.stack.length, 2);
  assert.equal(inspected.drawn.stack[1].name, 'coin rev1');
  assert.ok(inspected.comparison);
  assert.ok(inspected.palette);
});

test('compileAction enforces slices, tileSet and resize rules with CLI and MCP option names', async () => {
  const autotile = await json('examples/ground.autotile.json');
  assert.throws(() => compileAction(autotile, { size: '32x32', call: 'cli' }), /--size: a tile set's size is its tile/);
  assert.throws(() => compileAction(autotile, { size: '32x32', call: 'mcp' }), { path: 'size', message: /a tile set's size is its tile/ });
  assert.throws(() => compileAction(autotile, { slices: true, call: 'cli' }), /--slices writes the slices/);
  assert.throws(() => compileAction(autotile, { slices: true, call: 'mcp' }), { path: 'slices' });

  const compiled = compileAction(autotile, { call: 'mcp', withTestMap: true });
  assert.ok(compiled.testMap?.sheet);
  assert.ok(compiled.tilemap);

  const poses = await json('examples/slime-idle.poses.json');
  const resized = compileAction(poses, { frames: 2, size: '32x32', call: 'cli' });
  assert.equal(resized.made.width, 32);
  assert.equal(resized.made.height, 32);
  assert.ok(resized.kept);
  assert.ok(resized.metadata.resized);
});

test('renderAction applies overrides, compiles normals sources and enforces the shared GIF pixel budget', async () => {
  const coin = await json('examples/coin.json');
  const normals = { format: 'pixelforge-normals', version: 1, name: 'coin-normal', recipe: coin };
  const rendered = await renderAction(coin, { scale: 2, columns: coin.frames.length, normal: normals, gif: { scale: 2 }, call: 'mcp', previewView: true });
  assert.equal(rendered.bundle.project.sheet.scale, 2);
  assert.equal(rendered.bundle.project.sheet.columns, coin.frames.length);
  assert.ok(rendered.bundle.files.has('coin.normal_y_up.png'));
  assert.ok(rendered.bundle.files.has('coin.canvas.tres'));
  assert.equal(rendered.gifs.length, 1);
  assert.ok(rendered.view?.sheet);

  // Oversized render GIF budget fails identically on both call surfaces, naming the right option.
  const huge = {
    version: 1, name: 'huge', width: 512, height: 512, palette: { a: '#ffffff' },
    frames: Array.from({ length: 16 }, (_, i) => ({ name: `f${i}`, duration: 100, ops: [{ op: 'pixel', x: i, y: 0, color: 'a' }] })),
    animations: { loop: { frames: Array.from({ length: 16 }, (_, i) => `f${i}`), loop: true } }
  };
  assert.equal(RENDER_GIF_PIXELS, 67108864);
  await assert.rejects(renderAction(huge, { gif: { scale: 5 }, call: 'cli' }), { path: '--gif-scale', message: /--gif-scale 4 is the largest that fits/ });
  await assert.rejects(renderAction(huge, { gif: { scale: 5 }, call: 'mcp' }), { path: 'gif', message: /gif\.scale 4 is the largest that fits/ });
});

test('sceneViewAction, importAction, nameFromFile and sequenceAction produce expected outputs', async () => {
  assert.equal(nameFromFile('dir/01-hero sprite!.png'), 'hero-sprite-');
  assert.equal(nameFromFile('123.png'), undefined);

  const coin = await json('examples/coin.json');
  const project = renderProject(coin);
  const png = encodePNG(project.frames[0].data, project.width, project.height);
  const imported = importAction(png, { file: 'assets/shiny-coin.png' });
  assert.equal(imported.recipe.name, 'shiny-coin');
  assert.equal(imported.recipe.width, project.width);

  const scene = {
    format: 'pixelforge-scene', version: 1, name: 'tiny-scene', width: 32, height: 32,
    assets: { coin }, instances: [{ asset: 'coin', at: [16, 20] }]
  };
  const view = sceneViewAction(scene, { time: 0 });
  assert.equal(view.scale, 8);
  assert.equal(view.summary.name, 'tiny-scene');
  assert.ok(view.summary.colors > 0);
  assert.equal(view.image.width, 256);

  const seq = sequenceAction(coin, { fps: 10, loops: 1 });
  assert.ok(seq.info.frames >= 1);
  assert.ok(seq.files.size >= 1);
});
