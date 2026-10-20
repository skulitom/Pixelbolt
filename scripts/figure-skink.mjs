import { mkdir } from 'node:fs/promises';
import { compilePoses } from '../src/authoring.js';
import { renderProject, inspectProject } from '../src/core.js';
import { encodePNG } from '../src/png.js';
import { skinkRig } from './figure-rigs.mjs';
import { saveEvidence, movingGroundPreview } from './figure-preview.mjs';

const directory = new URL('../docs/images/figures/', import.meta.url);
await mkdir(directory, { recursive: true });
const at = process.argv.indexOf('--prefix'), prefix = at < 0 ? 'm2-skink' : process.argv[at + 1];
if (!prefix || !/^[a-z0-9-]+$/.test(prefix)) throw new Error('--prefix needs lowercase letters, digits or hyphens');
const source = skinkRig(), compiled = compilePoses(source), project = renderProject(compiled.recipe);
for (const [suffix, scale, view] of [['native', 1, 'color'], ['4x', 4, 'color'], ['silhouette', 4, 'silhouette']]) {
  const { sheet } = inspectProject(project, { scale, view, background: '#182239' });
  await saveEvidence(new URL(`${prefix}-${suffix}.png`, directory), encodePNG(sheet.data, sheet.width, sheet.height));
}
console.log(JSON.stringify({ warnings: compiled.metadata.warnings ?? [], ...await movingGroundPreview(project, directory, prefix, source.animations.run.frames, { ground: 24, speed: 48 }) }));
