import { compilePoses } from '../src/authoring.js';
import { figureSnapshot, figureSources } from '../scripts/figure-goldens.mjs';
import { goldens } from '../scripts/goldens.mjs';

const golden = goldens(new URL('./goldens/figures.json', import.meta.url));
for (const [name, source] of Object.entries(figureSources)) golden.test(`${name} compiled JSON and every RGBA frame match the accepted figure golden`, () => {
  golden.equal(name, figureSnapshot(source()), { recipe: () => compilePoses(source()).recipe });
});
// R1's 50 ms warmed compile budget is measured by `npm run bench -- --budgets` (poses/skink-rig), which reports a case
// over budget without failing CI; the goldens above already hold every byte the compile makes.
