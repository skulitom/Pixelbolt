// Inspect M1's geometric coverage without changing an existing character or its generated assets.
import { mkdir } from 'node:fs/promises';
import { compilePoses } from '../src/authoring.js';
import { renderProject, inspectProject } from '../src/core.js';
import { encodePNG } from '../src/png.js';
import { structuralFixture } from './pose-fixtures.mjs';
import { saveEvidence, movingGroundPreview } from './figure-preview.mjs';

const directory = new URL('../output/figures/', import.meta.url);
await mkdir(directory, { recursive: true });
const source = structuralFixture(), { recipe } = compilePoses(source), project = renderProject(recipe);
const at = process.argv.indexOf('--prefix'), prefix = at < 0 ? 'm1' : process.argv[at + 1];
if (!prefix || !/^[a-z0-9-]+$/.test(prefix)) throw new Error('--prefix needs lowercase letters, digits or hyphens');
for (const [label, frames] of [['bones', ['width-*']], ['masses', ['mass-*']], ['caps', ['round-*', 'flat-*', 'point-*', 'socket-*']]]) {
  for (const [suffix, scale, view] of [['native', 1, 'color'], ['4x', 4, 'color'], ['silhouette', 4, 'silhouette']]) {
    const { sheet } = inspectProject(project, { frames, scale, view, background: '#182239' });
    await saveEvidence(new URL(`${prefix}-${label}-${suffix}.png`, directory), encodePNG(sheet.data, sheet.width, sheet.height));
  }
}
console.log(`Wrote new M1 bone, cap and mass sheets in ${directory.href}`);
console.log(await movingGroundPreview(project, directory, prefix, project.frames.filter(f => f.name.startsWith('width-4-') || f.name.startsWith('mass-')).map(f => f.name)));
