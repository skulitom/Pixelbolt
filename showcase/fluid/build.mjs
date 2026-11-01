// Builds the fluid GIFs shown in the README from examples/*.fluid.json: each effect is compiled, rendered at 4× on a
// dark backdrop and encoded with exact colours. One-shot effects hold their last frame for a moment and play again,
// so a page never shows a finished explosion. --check verifies the committed GIFs; --force replaces them.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFluid, renderProject, encodeGIF } from '../../src/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const FLUID_SHOWCASE = ['campfire', 'explosion', 'smoke-puff', 'steam-vent', 'magic-swirl', 'torch', 'splash', 'waterfall', 'drip', 'potion', 'honey', 'slime', 'roof-snow', 'dam-break', 'dust-wave', 'slime-burst', 'honey-drop', 'aquarium'];
const BACKDROP = [38, 42, 61, 255], SCALE = 4, HOLD = 600;

// One GIF per example: `recipes` may hand in recipes compiled elsewhere (the tests), keyed by example name.
export async function buildFluidGIFs(recipes = {}) {
  const files = new Map(), report = [];
  for (const name of FLUID_SHOWCASE) {
    const started = performance.now();
    const recipe = recipes[name] ?? compileFluid(JSON.parse(await readFile(path.join(root, 'examples', `${name}.fluid.json`), 'utf8'))).recipe;
    const compiled = performance.now() - started, project = renderProject(recipe), [animation] = Object.values(project.animations);
    const frames = animation.frames.map((index, position) => ({ data: project.frames[index].data, duration: project.frames[index].duration + (!animation.loop && position === animation.frames.length - 1 ? HOLD : 0) }));
    const gif = encodeGIF(frames, project.width, project.height, { scale: SCALE, background: BACKDROP });
    files.set(`showcase/fluid/${name}.gif`, Buffer.from(gif.data));
    report.push({ name, frames: frames.length, loop: animation.loop, width: gif.width, height: gif.height, colors: gif.colors, bytes: gif.data.length, compileMs: Math.round(compiled) });
  }
  return { files, report };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check'), force = process.argv.includes('--force'), { files, report } = await buildFluidGIFs();
  if (check) {
    for (const [file, bytes] of files) if (!bytes.equals(await readFile(path.join(root, file)))) throw new Error(`Generated GIF differs: ${file}. Rebuild with node showcase/fluid/build.mjs --force.`);
    console.log(`Verified ${files.size} fluid GIFs.`);
  } else {
    if (!force) for (const file of files.keys()) {
      try { await access(path.join(root, file)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      throw new Error(`Refusing to replace ${file}; use --force for an intentional rebuild.`);
    }
    for (const [file, bytes] of files) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), bytes, { flag: force ? 'w' : 'wx' }); }
    console.log(`Wrote ${files.size} fluid GIFs.`);
  }
  console.table(report);
}
