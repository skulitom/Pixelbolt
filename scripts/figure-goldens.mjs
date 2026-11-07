// The new figures pinned in test/goldens/figures.json, separate from the immutable M0 legacy baseline
// (test/fixtures/figures-baseline.json). node scripts/goldens.mjs figures checks them and draws what changed; --write
// updates them.
import { createHash } from 'node:crypto';
import { compilePoses } from '../src/authoring.js';
import { renderProject } from '../src/core.js';
import { skinkRig, heroRig, bossRig, plainRig } from './figure-rigs.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
export function figureSnapshot(source) {
  const compiled = compilePoses(source), project = renderProject(compiled.recipe);
  return {
    compiled: hash(JSON.stringify(compiled)),
    frames: project.frames.map(frame => ({ name: frame.name, rgba: hash(frame.data) }))
  };
}
export const figureSources = { R1: skinkRig, R2: heroRig, R3: bossRig, plain: plainRig };
