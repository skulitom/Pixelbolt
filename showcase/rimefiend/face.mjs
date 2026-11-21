// Compare both profiles with the front on the same native pixel grid. The camera
// follows a point inside the skull, so the muzzle is free to change silhouette.
import { readFile, writeFile } from 'node:fs/promises';
import { prepareStack } from '../../src/stack.js';
import { projectPoint } from '../../src/stack-facets.js';
import { renderProject, pictureSheet } from '../../src/core.js';
import { cosDeg, sinDeg } from '../../src/craft.js';
import { framesGIF } from '../../src/gif.js';
import { encodePNG } from '../../src/png.js';

const [input, stem, before] = process.argv.slice(2);
if (!input || !stem) throw Error('Supply a Rimefiend stack, a new output stem and optionally the original stack.');
const sweep = Array.from({ length: 31 }, (_, i) => (225 + 6 * i) % 360);
const width = 66, height = 54;
async function headCrops(file) {
  const source = JSON.parse(await readFile(file, 'utf8'));
  const recipe = prepareStack({ ...source, headings: sweep }).recipe();
  const project = renderProject(recipe);
  const view = { anchor: recipe.anchor, pivot: source.pivot, squash: 0.5, resolution: source.resolution };
  const centre = source.sockets.body.at.map((v, i) => v + [0, 7.5, 47.4][i]);
  return sweep.map((heading, i) => {
    const angle = heading + 45;
    const [x, y] = projectPoint(centre, view, cosDeg(angle), sinDeg(angle));
    const left = Math.floor(x - width / 2), top = Math.floor(y - height / 2);
    const data = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row++) {
      const start = ((top + row) * project.width + left) * 4;
      data.set(project.frames[i].data.subarray(start, start + width * 4), row * width * 4);
    }
    return { width, height, anchor: [0, 0], data };
  });
}

const labels = before ? ['Original', 'Named contours'] : ['Named contours'];
const models = await Promise.all((before ? [before, input] : [input]).map(headCrops));
const style = { background: [54, 52, 67, 255], scale: 3, exactScale: true };
const stops = [0, 8, 15, 22, 30];
const sheet = pictureSheet({ ...style,
  headings: ['Profile 225', 'Three-quarter 273', 'Front 315', 'Three-quarter 357', 'Profile 45'],
  rows: models.map((cells, i) => ({ label: labels[i], cells: stops.map(k => cells[k]) }))
});
const frames = sweep.map((_, i) => pictureSheet({ ...style, headings: labels,
  rows: [{ label: '', cells: models.map(cells => cells[i]) }]
}));
const playback = [frames[0], ...frames, frames.at(-1), ...frames.slice(1, -1).reverse()];
const gif = framesGIF(playback, { fps: { numerator: 14, denominator: 1 } });
await writeFile(stem + '.png', encodePNG(sheet.data, sheet.width, sheet.height), { flag: 'wx' });
await writeFile(stem + '.gif', gif.data, { flag: 'wx' });
