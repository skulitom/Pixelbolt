import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createToolRunner } from '../src/mcp.js';
import { CANVAS_SIDE } from '../src/core.js';
import { mockTools } from '../scripts/eval-mock.mjs';

// The MCP side of animation frames up to 1024 a side and 262,144 pixels: what the tools say and return for them.
const screen = (width, height, frames) => ({
  version: 1, name: 'screen', width, height, palette: { k: '#102030', s: '#a0c0f0' },
  frames: Array.from({ length: frames }, (_, i) => ({ name: `f${i}`, ops: [{ op: 'rect', x: 0, y: 0, w: width, h: height, color: 'k' }, { op: 'pixel', x: width - 1 - i, y: 0, color: 's' }] }))
});
const runner = async t => {
  const base = path.resolve(os.tmpdir()), dir = await mkdtemp(path.join(base, 'pixelbolt-big-mcp-'));
  t.after(async () => { assert.ok(dir.startsWith(base + path.sep)); await rm(dir, { recursive: true, force: true }); });
  const run = createToolRunner({ directory: dir, root: dir, version: '0.0.0' });
  return async (name, args) => {
    const result = await run(name, args);
    assert.ok(!result.isError, result.content?.[0]?.text);
    return { info: JSON.parse(result.content[0].text), texts: result.content.filter(c => c.type === 'text').map(c => c.text), images: result.content.filter(c => c.type === 'image') };
  };
};

test('MCP grid rulers read x 1000 and over apart from x 0 on a 1024-wide frame', async t => {
  const call = await runner(t);
  const { texts } = await call('pixel_inspect', { project: screen(1024, 256, 2), frames: ['f1'], grid: true, region: { x: 994, y: 0, w: 30, h: 2 } });
  const grid = texts.find(text => text.startsWith('Palette-key grids')).split('\n');
  const rulers = grid.slice(grid.indexOf('f1') + 1, grid.indexOf('f1') + 5);
  assert.deepEqual(rulers, [
    '   ' + '      ' + '1'.repeat(24),
    '   ' + '999999' + '0'.repeat(24),
    '   ' + '999999' + '0'.repeat(10) + '1'.repeat(10) + '2222',
    '   ' + '456789' + '0123456789'.repeat(2) + '0123'
  ]);
  assert.equal(grid[grid.indexOf('f1') + 5], `0  ${'k'.repeat(28)}sk`);
  // Below 1000 there is no thousands row, as before.
  const small = (await call('pixel_inspect', { project: screen(320, 180, 2), frames: ['f0'], grid: true, region: { x: 310, y: 0, w: 10, h: 1 } })).texts.find(text => text.startsWith('Palette-key grids')).split('\n');
  assert.deepEqual(small.slice(small.indexOf('f0') + 1, small.indexOf('f0') + 4), ['   3333333333', '   1111111111', '   0123456789']);
});

test('MCP pixel_inspect shows a 640x360 animation whole on one sheet at scale 1', async t => {
  const call = await runner(t);
  const { info, images } = await call('pixel_inspect', { project: screen(640, 360, 18) });
  assert.equal(info.width, 640);
  assert.equal(info.sheet.scale, 1);
  assert.equal(info.sheet.columns * info.sheet.rows >= 18, true);
  assert.ok(info.sheet.width <= 4096 && info.sheet.height <= 4096);
  assert.equal(images.length, 1);
});

test('the MCP listing takes a motion ground row anywhere in a frame up to CANVAS_SIDE tall', async () => {
  const tools = JSON.parse(await mockTools()).tools, inspect = tools.find(tool => tool.name === 'pixel_inspect');
  assert.equal(inspect.inputSchema.properties.ground.maximum, CANVAS_SIDE - 1);
  assert.match(inspect.inputSchema.properties.scale.description, /at least 1/);
});
