// Fast checks for strict report/error handling; no Godot, filesystem or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { problems, reportFrom, supportsMultipart } from '../scripts/verify-godot-addon.mjs';

test('addon runner detects Godot diagnostics without mistaking CLI JSON for errors', () => {
  assert.deepEqual(problems('ERROR: first\r\n SCRIPT ERROR: second\nWARNING: third\nPixelbolt: recipe: bad\n{"error":"bad"}'),
    ['ERROR: first', ' SCRIPT ERROR: second', 'WARNING: third']);
  assert.deepEqual(problems('\x1b[31mERROR: colored\x1b[0m'), ['ERROR: colored']);
});

test('addon runner requires exactly one valid report', () => {
  assert.deepEqual(reportFrom('banner\r\nPIXELBOLT {"failures":[]}\r\n'), { failures: [] });
  for (const output of ['none', 'PIXELBOLT {}\nPIXELBOLT {}', 'PIXELBOLT not json']) {
    assert.throws(() => reportFrom(output));
  }
});

test('addon runner gates multipart extensions on the actual engine version', () => {
  for (const version of ['4.3.stable', '4.4.1.stable']) assert.equal(supportsMultipart(version), false);
  for (const version of ['4.5.1.stable', '4.7.2.stable', '4.8.beta4']) assert.equal(supportsMultipart(version), true);
  for (const version of ['3.6.stable', '4.2.stable', 'unrecognized']) assert.throws(() => supportsMultipart(version));
});
