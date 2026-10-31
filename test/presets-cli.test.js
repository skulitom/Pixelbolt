import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { listPresets } from '../src/presets.js';

const cli = fileURLToPath(new URL('../bin/pixelbolt.js', import.meta.url));

test('pixelbolt presets prints the listing pixel_help gives', async () => {
  // The command and this process compile the presets side by side.
  const printed = promisify(execFile)(process.execPath, [cli, 'presets'], { maxBuffer: 16 * 1048576 }), listing = await listPresets();
  assert.ok(listing.presets.length > 0);
  assert.deepEqual(JSON.parse((await printed).stdout), listing);
});
