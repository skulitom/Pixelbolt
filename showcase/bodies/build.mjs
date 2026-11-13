// Builds the rigid-body GIFs shown in the README from examples/*.bodies.json: each effect is compiled, rendered at 4×
// on a dark backdrop and encoded with exact colours. A one-shot preset's last frame holds for a moment before it plays
// again; a loop runs on. --check verifies the committed GIFs; --force replaces them.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileBodies, renderProject, encodeGIF } from '../../src/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const BODIES_SHOWCASE = ['ring-escape', 'bouncing-pixel', 'spinning-hoop', 'crate-topple', 'territory', 'blade-bloom', 'crate-smash', 'rope-bridge', 'wrecking-ball', 'lantern', 'ragdoll', 'flag', 'banner', 'cape'];
const BACKDROP = [38, 42, 61, 255], SCALE = 4, HOLD = 800;

// One GIF per example: `recipes` may hand in recipes compiled elsewhere (the tests), keyed by example name.
export async function buildBodiesGIFs(recipes = {}) {
  const files = new Map(), report = [];
  for (const name of BODIES_SHOWCASE) {
    const recipe = recipes[name] ?? compileBodies(JSON.parse(await readFile(path.join(root, 'examples', `${name}.bodies.json`), 'utf8'))).recipe;
    const project = renderProject(recipe), [animation] = Object.values(project.animations);
    const frames = animation.frames.map((index, position) => ({ data: project.frames[index].data, duration: project.frames[index].duration + (position === animation.frames.length - 1 && !animation.loop ? HOLD : 0) }));
    // A source drawn finer than its pixels (subpixels) is enlarged less, so its world's pixels stay about SCALE across.
    const source = JSON.parse(await readFile(path.join(root, 'examples', `${name}.bodies.json`), 'utf8')), scale = Math.max(1, Math.round(SCALE / (source.subpixels ?? 1)));
    const gif = encodeGIF(frames, project.width, project.height, { scale, background: BACKDROP });
    files.set(`showcase/bodies/${name}.gif`, Buffer.from(gif.data));
    report.push({ name, frames: frames.length, width: gif.width, height: gif.height, colors: gif.colors, bytes: gif.data.length });
  }
  return { files, report };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check'), force = process.argv.includes('--force'), { files, report } = await buildBodiesGIFs();
  if (check) {
    for (const [file, bytes] of files) if (!bytes.equals(await readFile(path.join(root, file)))) throw new Error(`Generated GIF differs: ${file}. Rebuild with node showcase/bodies/build.mjs --force.`);
    console.log(`Verified ${files.size} rigid-body GIFs.`);
  } else {
    if (!force) for (const file of files.keys()) {
      try { await access(path.join(root, file)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      throw new Error(`Refusing to replace ${file}; use --force for an intentional rebuild.`);
    }
    for (const [file, bytes] of files) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), bytes, { flag: force ? 'w' : 'wx' }); }
    console.log(`Wrote ${files.size} rigid-body GIFs.`);
  }
  console.table(report);
}
