import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

// A library user (an agent tool that bundles Pixelbolt, as Hermes Agent's Asset Curator does) imports the package by
// name and gets the same render check the CLI's render --expect and MCP pixel_render's expect reply with (P-148).
// Before, the package entry had no check, and its exports map refuses pixelbolt/src/check.js.
test('the package entry exports the render check, and it gives the check the CLI replies with', async t => {
  const { readExpect, checkDelivery, briefCheck, createBundle } = await import('pixelbolt');
  for (const fn of [readExpect, checkDelivery, briefCheck]) assert.equal(typeof fn, 'function');
  const file = path.join(root, 'examples', 'forest-spirit.json'), recipe = JSON.parse(await readFile(file, 'utf8'));
  // 24x24 as asked, but 8 frames where the sprite has 6, so the check fails with a problem and its fix.
  const expect = { width: 24, height: 24, frames: 8, transparent: true };
  const bundle = await createBundle(recipe), check = briefCheck(checkDelivery(bundle.project, { recipe, expect: readExpect(expect) }));
  assert.equal(check.ok, false);
  assert.ok(check.problems.some(problem => problem.fix), 'each problem says how to fix it');
  const out = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-library-check-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  const cli = spawnSync(process.execPath, [path.join(root, 'bin', 'pixelbolt.js'), 'render', file, '--out', path.join(out, 'spirit'), '--expect', JSON.stringify(expect)], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(check, JSON.parse(cli.stdout).check);
  assert.throws(() => readExpect({ width: 'big' }), /expect\.width/);
});
