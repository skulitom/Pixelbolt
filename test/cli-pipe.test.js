import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// The reader of the CLI's output goes away before it writes, as `| head -1` does once it has its line.
const closedReader = (...args) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['bin/pixelbolt.js', ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.destroy();
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', reject).on('close', code => resolve({ code, stderr }));
});

test('the CLI stops quietly when the reader of its output goes away', async () => {
  // A long reply written at once, a short one, and one printed with console.log.
  for (const args of [['compile', '--preset', 'hero', '--expand'], ['help'], ['validate', 'examples/forest-spirit.json']]) {
    const { code, stderr } = await closedReader(...args);
    assert.deepEqual({ code, stderr }, { code: 0, stderr: '' }, args.join(' '));
  }
  // An error still goes to stderr with exit code 1.
  const failed = await closedReader('validate', 'examples/no-such-file.json');
  assert.equal(failed.code, 1);
  assert.match(failed.stderr, /"ok":false/);
});
