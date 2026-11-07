// The strict reader's check: a copy of the presets with one field the Lua port doesn't implement must make
// build.mjs fail, naming that field; the unchanged copy must build.
//   node aseprite/checks/strict-reader.mjs
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, PRESETS } from '../tools/presets.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const work = join(here, '..', 'dist', 'strict');
const cases = [
  { name: 'unchanged copy', edit: () => {}, expect: null },
  { name: 'unknown emitter field', file: 'torch', edit: e => { e.emitters[0].wobble = 1; }, expect: 'fluid.effects.torch.emitters[0].wobble: not supported by the Lua port (field "wobble")' },
  { name: 'unknown effect field', file: 'campfire', edit: e => { e.wind = [0.1, 0]; }, expect: 'fluid.effects.campfire.wind: not supported by the Lua port (field "wind")' },
  { name: 'unknown look pattern', file: 'explosion', edit: e => { e.look[0].pattern = 'blue-noise'; }, expect: 'fluid.effects.explosion.look[0].pattern: the Lua port supports only' },
  { name: 'liquid kind', file: 'smoke-puff', edit: e => { e.kind = 'liquid'; }, expect: 'fluid.effects.smoke-puff.kind: the Lua port supports only "gas"' },
  { name: 'another wall', file: 'dust-wave', edit: e => { e.walls = ['bottom', 'left']; }, expect: 'fluid.effects.dust-wave.walls[1]: the Lua port supports only bottom walls' },
  { name: 'unknown spark field', file: 'magic-swirl', edit: e => { e.emitters.find(m => m.sparks).sparks.rise = 1; }, expect: '.sparks.rise: not supported by the Lua port (field "rise")' }
];
let failed = 0;
for (const c of cases) {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  for (const name of PRESETS) cpSync(join(ROOT, 'examples', `${name}.fluid.json`), join(work, `${name}.fluid.json`));
  if (c.file) {
    const path = join(work, `${c.file}.fluid.json`), source = JSON.parse(readFileSync(path, 'utf8'));
    c.edit(Object.values(source.effects)[0]);
    writeFileSync(path, JSON.stringify(source, null, 2));
  }
  const run = spawnSync(process.execPath, [join(here, '..', 'build.mjs'), '--skip-gates'], { env: { ...process.env, PIXELBOLT_FLUIDS_EXAMPLES: work }, encoding: 'utf8' });
  const ok = c.expect === null ? run.status === 0 : run.status === 1 && run.stderr.includes(c.expect);
  if (!ok) failed++;
  console.log(`${ok ? 'ok' : 'not ok'} - ${c.name}${c.expect ? `: ${run.stderr.trim().split('\n').at(-1)}` : ''}`);
}
rmSync(work, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
