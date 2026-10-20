import { mkdir } from 'node:fs/promises';
import { compilePoses } from '../src/authoring.js';
import { renderProject, inspectProject } from '../src/core.js';
import { inspectMotion } from '../src/motion.js';
import { encodePNG } from '../src/png.js';
import { heroRig, bossRig } from './figure-rigs.mjs';
import { saveEvidence, movingGroundPreview } from './figure-preview.mjs';

const directory = new URL('../output/figures/', import.meta.url);
await mkdir(directory, { recursive: true });
const at = process.argv.indexOf('--prefix'), prefix = at < 0 ? 'm4-templates' : process.argv[at + 1];
if (!prefix || !/^[a-z0-9-]+$/.test(prefix)) throw new Error('--prefix needs lowercase letters, digits or hyphens');
for (const [name, make] of [['hero', heroRig], ['boss', bossRig]]) {
  const source = make(), { recipe, metadata } = compilePoses(source), project = renderProject(recipe), reports = {};
  const save = async (suffix, sheet) => saveEvidence(new URL(`${prefix}-${name}-${suffix}.png`, directory), encodePNG(sheet.data, sheet.width, sheet.height));
  await save('native', inspectProject(project, { scale: 1, background: '#182239' }).sheet);
  for (const animation of Object.keys(source.motions)) {
    await save(`${animation}-4x`, inspectProject(project, { animation, scale: 4, background: '#182239' }).sheet);
    await save(`${animation}-silhouette`, inspectProject(project, { animation, scale: 4, view: 'silhouette', background: '#182239' }).sheet);
    const review = inspectMotion(project, { animation, metadata });
    reports[animation] = review.motion;
    if (animation === 'run') { await save('motion-native', review.nativeSheet); await save('motion-4x', review.sheet); }
  }
  await saveEvidence(new URL(`${prefix}-${name}-motion.json`, directory), Buffer.from(JSON.stringify(reports, null, 2) + '\n'));
  const names = project.animations.run.frames.map(i => project.frames[i].name);
  const gif = await movingGroundPreview(project, directory, `${prefix}-${name}`, names, { speed: metadata.animations.run.speed, ground: source.rig.ground + 1 });
  console.log(JSON.stringify({ name, warnings: metadata.warnings ?? [], ...gif, checks: Object.fromEntries(Object.entries(reports).map(([name, report]) => [name, report.checks])) }));
}
