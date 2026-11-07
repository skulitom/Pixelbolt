import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { renderProject, inspectProject } from '../src/core.js';
import { compilePoses } from '../src/authoring.js';

const root = new URL('../', import.meta.url);
const rgba = (data, width, x, y) => [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];
// Frame operations, two named layers that overlap, an unnamed one, a hidden one and final pixels (one over a part,
// one on empty canvas), then a frame inherited and moved down a row.
const recipe = { version: 1, name: 'owners', width: 6, height: 3, palette: { r: '#f00', g: '#0f0', b: '#00f', k: '#000' }, frames: [
  { name: 'a', ops: [{ op: 'pixel', x: 0, y: 0, color: 'k' }],
    layers: [
      { name: 'back', ops: [{ op: 'rect', x: 1, y: 0, w: 3, h: 2, color: 'r' }] },
      { name: 'front', ops: [{ op: 'pixel', x: 2, y: 1, color: 'g' }] },
      { ops: [{ op: 'pixel', x: 5, y: 2, color: 'b' }] },
      { name: 'hidden', visible: false, ops: [{ op: 'pixel', x: 4, y: 2, color: 'b' }] }
    ],
    pixels: [{ x: 1, y: 0, color: 'b' }, { x: 0, y: 2, color: 'g' }] },
  { name: 'b', from: 'a', translate: [0, 1] }
] };
const names = project => project.frames.map(frame => Array.from({ length: project.height }, (_, y) =>
  Array.from({ length: project.width }, (_, x) => project.ownerNames[frame.owners[y * project.width + x] - 1] ?? '.').join(' ')));

test('a render with owners records what drew each pixel last, through layers, final pixels, inheritance and moves', () => {
  const project = renderProject(recipe, { owners: true }), plain = renderProject(recipe);
  assert.deepEqual(project.ownerNames, ['frame.ops', 'back', 'front', 'layers[2]', 'frame.pixels']);
  // A final pixel over a part recolours it and stays the part's; one on empty canvas is its own; a hidden layer owns nothing.
  assert.deepEqual(names(project), [
    ['frame.ops back back back . .', '. back front back . .', 'frame.pixels . . . . layers[2]'],
    ['. . . . . .', 'frame.ops back back back . .', '. back front back . .']
  ]);
  // Owners change no pixel, and a render without them carries none.
  assert.deepEqual(project.frames.map(f => [...f.data]), plain.frames.map(f => [...f.data]));
  assert.equal(plain.ownerNames, undefined);
  assert.ok(plain.frames.every(frame => frame.owners === undefined));
  // An erasing frame operation leaves nothing behind it; isolated layers keep only their own names.
  const erased = renderProject({ ...recipe, frames: [{ ...recipe.frames[0], pixels: undefined }, { name: 'c', from: 'a', ops: [{ op: 'clear', x: 1, y: 0, w: 1, h: 1 }] }] }, { owners: true });
  assert.equal(erased.frames[1].owners[1], 0);
  assert.deepEqual(renderProject(recipe, { layers: ['front'], owners: true }).ownerNames, ['front']);
  const opaque = renderProject({ ...recipe, background: '#222' }, { owners: true });
  assert.equal(opaque.ownerNames[0], 'background');
  assert.throws(() => renderProject(recipe, { owners: 1 }), /render\.owners/);
});

test('the parts view paints each part one flat colour, lists the parts it shows and reads them back as grids', () => {
  const project = renderProject(recipe, { owners: true }), view = inspectProject(project, { view: 'parts', grid: true, scale: 4, background: '#808080' });
  assert.equal(view.mode, 'parts');
  assert.deepEqual(view.parts.map(({ name, pixels }) => [name, pixels]), [['frame.ops', 2], ['back', 10], ['front', 2], ['layers[2]', 1], ['frame.pixels', 1]]);
  assert.equal(new Set(view.parts.map(part => part.color)).size, 5);
  assert.deepEqual(view.grids, [{ frame: 'a', rows: ['0111..', '.121..', '4....3'] }, { frame: 'b', rows: ['......', '0111..', '.121..'] }]);
  assert.deepEqual(view.legend['1'], { part: 'back', color: view.parts[1].color });
  // Each cell pixel shows its part's colour, whatever colour the part drew it in; empty pixels show the background.
  const { sheet } = view, hex = color => '#' + color.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('');
  const cell = (x, y) => hex(rgba(sheet.data, sheet.width, sheet.gap + x * sheet.scale + 1, sheet.gap + y * sheet.scale + 1));
  assert.deepEqual([cell(1, 0), cell(2, 0), cell(2, 1), cell(0, 2), cell(4, 0)], [view.parts[1].color, view.parts[1].color, view.parts[2].color, view.parts[4].color, '#808080']);
  // The legend sits right of the cells: a swatch per part in its colour.
  const cells = sheet.columns * project.width * sheet.scale + (sheet.columns + 1) * sheet.gap;
  assert.ok(sheet.width > cells + 20, `${sheet.width} is wider than the ${cells} px of cells`);
  const legendColors = new Set();
  for (let y = 0; y < sheet.height; y++) for (let x = cells; x < sheet.width; x++) legendColors.add(hex(rgba(sheet.data, sheet.width, x, y)));
  for (const part of view.parts) assert.ok(legendColors.has(part.color), `${part.name}'s swatch`);
  // A region counts only what it shows; the native sheet carries the legend too.
  const cropped = inspectProject(project, { view: 'parts', frames: ['a'], region: { x: 2, y: 1, w: 1, h: 1 }, native: true });
  assert.deepEqual(cropped.parts.map(part => part.name), ['front']);
  assert.ok(cropped.nativeSheet.width > 3);
  assert.throws(() => inspectProject(renderProject(recipe), { view: 'parts' }), /inspect\.view.*owners/);
});

test('a pose\'s parts own every pixel of the figure, the inner lines where limbs cross included', () => {
  const { recipe: hero } = compilePoses(JSON.parse(readFileSync(new URL('examples/hero.poses.json', root), 'utf8')));
  assert.ok(hero.frames.some(frame => frame.pixels?.length), 'the hero has inner lines, drawn as final pixels');
  const project = renderProject(hero, { owners: true }), layers = new Set(hero.frames.flatMap(frame => frame.layers.map(layer => layer.name)));
  assert.ok(project.ownerNames.every(name => layers.has(name)), project.ownerNames.join());
  for (const frame of project.frames) for (let at = 0; at < frame.owners.length; at++) assert.equal(Boolean(frame.owners[at]), Boolean(frame.data[at * 4 + 3]), `${frame.name} pixel ${at}`);
  const walk = inspectProject(project, { view: 'parts', animation: 'walk' });
  for (const part of ['head', 'nearThigh', 'farThigh', 'nearFore', 'hips']) assert.ok(walk.parts.some(entry => entry.name === part), part);
});

test('CLI inspect --view parts colours a pose source by part and reads part keys back', () => {
  const run = spawnSync(process.execPath, ['bin/pixelbolt.js', 'inspect', 'examples/hero.poses.json', '--view', 'parts', '--frames', 'walk-contact-a', '--grid'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const view = JSON.parse(run.stdout), key = Object.entries(view.legend).find(([, entry]) => entry.part === 'nearThigh')[0];
  assert.equal(view.mode, 'parts');
  assert.ok(view.grids[0].rows.some(row => row.includes(key)));
  assert.equal(view.parts.reduce((sum, part) => sum + part.pixels, 0), view.grids[0].rows.join('').replaceAll('.', '').length);
});
