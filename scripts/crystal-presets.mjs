// Crystal presets for examples/: each is an ordinary pixelforge-crystal source; scripts/generate-examples.js writes them
// as examples/<name>.crystal.json and showcase/crystals/build.mjs renders their GIFs. The rock they grow on is drawn
// here as plain palette grids (underlay and overlay), so the compiler draws only crystals.
import { sinDeg, cosDeg, random } from '../src/craft.js';
import { atan2Deg } from '../src/shapes.js';

const crystalSource = (name, width, height, palette, looks, effect) => ({ format: 'pixelforge-crystal', version: 1, name, width, height, palette, looks, effects: { [name]: effect } });
const rows = (w, h, at) => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => at(x, y) ?? '.').join(''));
// Seeds along an elliptical arc, from one angle to another (degrees clockwise from +x, y down), on half pixels.
const arc = ([cx, cy], [rx, ry], from, to, n) => Array.from({ length: n }, (_, i) => {
  const a = from + (to - from) * i / (n - 1);
  return [Math.round((cx + rx * cosDeg(a)) * 2) / 2, Math.round((cy + ry * sinDeg(a)) * 2) / 2];
});
// Smooth seeded bumps along a line: the sum of three sines with seeded phases, about one pixel high.
const bumps = (seed, x, size = 1) => size * (0.6 * sinDeg(x * 23 + 360 * random(seed, 1)) + 0.3 * sinDeg(x * 51 + 360 * random(seed, 2)) + 0.2 * sinDeg(x * 97 + 360 * random(seed, 3)));
// Rock in three tones lit from the upper left, with a dark outline: `inside(x, y)` says what is rock, and the tone
// comes from which way the rock's edge faces nearby (its open neighbours within two pixels).
function rock(width, height, inside, { outline = 'K', shadow = 'R', base = 'r', lit = 'q' } = {}) {
  const solid = (x, y) => x >= 0 && y >= 0 && x < width && y < height && inside(x, y);
  return rows(width, height, (x, y) => {
    if (!solid(x, y)) return null;
    let open = false, facing = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (solid(x + dx, y + dy)) continue;
      if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && (dx === 0 || dy === 0)) open = true;
      facing += -dx - dy;
    }
    if (open) return outline;
    return facing > 2 ? lit : facing < -2 ? shadow : base;
  });
}

// Geode: an amethyst geode broken open. Purple points grow inward from the agate lining, from every side at once, and
// stop short of the dark hollow at its heart; each catches the light as it finishes.
const geode = (() => {
  const W = 76, H = 58, centre = [37.5, 28.5], radius = [36, 27.5];
  const depth = (x, y) => {
    // How far a pixel lies inside the outer edge, in pixels along the ray from the centre; the edge wanders a little.
    const dx = x - centre[0], dy = y - centre[1], r = Math.sqrt(dx * dx + dy * dy);
    if (r < 1e-9) return 99;
    const ux = dx / r, uy = dy / r, edge = 1 / Math.sqrt((ux * ux) / (radius[0] * radius[0]) + (uy * uy) / (radius[1] * radius[1]));
    const angle = Math.round(atan2Deg(dy, dx));
    return edge * (1 + 0.025 * bumps(11, angle / 2)) - r;
  };
  const shell = rock(W, H, (x, y) => depth(x, y) >= 0);
  const underlay = shell.map((row, y) => [...row].map((key, x) => {
    if (key === '.' || key === 'K') return key;
    const d = depth(x, y), dx = x - centre[0], dy = y - centre[1], facing = -(dx / radius[0] + dy / radius[1]) / Math.sqrt(2 * ((dx / radius[0]) * (dx / radius[0]) + (dy / radius[1]) * (dy / radius[1])));
    // The rind is rounded: its outer band lit toward the upper left and shaded away from it; just inside the agate
    // it is shaded again, where the lining stands proud of it.
    if (d < 3.5) return facing > 0.35 ? 'q' : facing < -0.35 ? 'R' : 'r';
    if (d < 5.5) return 'r';
    if (d < 6.5) return 'R';
    if (d < 7.5) return 'g';
    if (d < 8.5) return 'h';
    if (d < 9.5) return 'g';
    return d < 11 ? 'u' : 'v';
  }).join(''));
  const inner = [radius[0] - 9.5, radius[1] - 9.5], toward = centre;
  const ring = (from, to, n, length, width, start) => ({ habit: 'prism', at: arc(centre, inner, from, to, 8), count: n, toward, spread: 24, length, width, tip: 0.9, start, grow: [18, 24], turn: [-25, 25], ease: 'inOut' });
  return crystalSource('geode', W, H,
    { K: '#1b1620', R: '#3a3140', r: '#564b5c', q: '#7a6e7f', g: '#8e8aa3', h: '#dcd8ea', u: '#2a1a3d', v: '#150d22',
      o: '#26103f', a: '#4b2580', b: '#7745b8', c: '#a87ce3', d: '#dcc8fb', w: '#ffffff' },
    { amethyst: { colors: ['a', 'b', 'c', 'd'], outline: 'o', glint: 'w' } },
    { frames: 56, duration: 70, seed: 5, underlay, crystals: [
      ring(195, 345, 10, [7, 11], [4, 6], [0, 12]),
      ring(15, 165, 10, [8, 12], [4, 6], [2, 14]),
      ring(160, 200, 3, [6, 8], [3, 4], [6, 16]),
      ring(-20, 20, 3, [6, 8], [3, 4], [6, 16])
    ] });
})();

// Quartz cluster: clear quartz points fan up out of a rock, the tall one first, then its neighbours, then the small
// ones in front. Each point is a six-sided prism lit from the upper left, so it shows a bright, a middle and a dark face.
const quartzCluster = (() => {
  const W = 64, H = 58, top = x => 43 + Math.round(bumps(4, x, 1.3) + 0.011 * (x - 32) * (x - 32));
  const inside = (x, y) => {
    const edge = Math.max(0, Math.abs(x - 32) - 21);
    return x >= 5 && x <= 58 && y >= top(x) && y <= 55 - Math.round(edge * edge * 0.25);
  };
  const underlay = rock(W, H, inside);
  // The front lip of the rock covers the crystals' feet, so they grow out of it rather than stand on it.
  const overlay = underlay.map((row, y) => [...row].map((key, x) => (y >= top(x) + 3 ? key : '.')).join(''));
  const seeds = (from, to) => Array.from({ length: 5 }, (_, i) => { const x = from + (to - from) * i / 4; return [x, top(Math.round(x)) + 3]; });
  return crystalSource('quartz-cluster', W, H,
    { K: '#1f1c24', R: '#3b3540', r: '#5a5260', q: '#82788a', o: '#1c2c44', a: '#3c6386', b: '#6c9cc0', c: '#a3cde6', d: '#d2ecf8', w: '#ffffff' },
    { quartz: { colors: ['a', 'b', 'c', 'd'], outline: 'o', glint: 'w' } },
    { frames: 60, duration: 70, seed: 9, underlay, overlay, crystals: [
      { habit: 'prism', at: [31, top(31) + 3], angle: -90, length: 36, width: 8, tip: 0.8, start: 0, grow: 30, ease: 'inOut' },
      { habit: 'prism', at: [24, top(24) + 3], angle: -116, length: 25, width: 6, tip: 0.9, turn: 20, start: 5, grow: 26, ease: 'inOut' },
      { habit: 'prism', at: [38, top(38) + 3], angle: -63, length: 27, width: 6, tip: 0.9, turn: -20, start: 3, grow: 28, ease: 'inOut' },
      { habit: 'prism', at: seeds(13, 51), count: 5, angle: [-162, -18], length: [11, 17], width: [4, 5], tip: 0.9, turn: [-30, 30], start: [8, 18], grow: [18, 24], ease: 'inOut' },
      { habit: 'prism', at: [[19, top(19) + 4], [45, top(45) + 4]], count: 3, angle: [-140, -40], length: [6, 8], width: [3, 4], tip: 1, turn: [-30, 30], start: [16, 26], grow: [14, 18], ease: 'inOut' }
    ] });
})();

// Pyrite: brassy cubes grow out of a dark matrix, interlocked at different turns, with two octahedra among them; each
// shows a lit top and two shaded sides.
const pyrite = (() => {
  const W = 56, H = 44, top = x => 33 + Math.round(bumps(8, x, 1.5));
  const inside = (x, y) => x >= 3 && x <= 52 && y >= top(x) && y <= 41;
  const underlay = rock(W, H, inside);
  return crystalSource('pyrite', W, H,
    { K: '#17151a', R: '#2c2930', r: '#433e47', q: '#5f5866', o: '#2b1f08', a: '#6e5420', b: '#a7832f', c: '#d6b44c', d: '#f7e7a1', w: '#ffffff' },
    { pyrite: { colors: ['a', 'b', 'c', 'd'], outline: 'o', glint: 'w' } },
    { frames: 52, duration: 70, seed: 2, underlay, crystals: [
      { habit: 'cube', at: [27, 33], size: 14, start: 0, grow: 24, ease: 'inOut' },
      { habit: 'cube', at: [16, 36], size: 9, start: 6, grow: 20, ease: 'inOut' },
      { habit: 'cube', at: [39, 36], size: 10, start: 4, grow: 22, ease: 'inOut' },
      { habit: 'octahedron', at: [9, 37], size: 7, angle: -90, start: 12, grow: 16, ease: 'inOut' },
      { habit: 'octahedron', at: [47, 37], size: 8, angle: -90, turn: 30, start: 14, grow: 16, ease: 'inOut' },
      { habit: 'cube', at: [[20, 39], [36, 39]], count: 3, size: [4, 6], start: [16, 22], grow: [12, 16], ease: 'inOut' }
    ] });
})();

// Snowflakes: three flakes grow at once from hexagonal seeds: a broad stellar dendrite whose branches sprout twigs, a
// small sectored plate and a fern-like flake turned on its side. Each tip glints as it grows and the flakes come to rest.
const snowflakes = crystalSource('snowflakes', 96, 52,
  { i: '#3b6ea8', j: '#8cc4ec', k: '#e2f4ff', w: '#ffffff' },
  { ice: { colors: ['i', 'j', 'k'], glint: 'w' } },
  { frames: 44, duration: 70, seed: 3, crystals: [
    { habit: 'snowflake', at: [48, 26], radius: 23, spacing: 5, branches: 0.7, twigs: 0.5, plate: 1, start: 0, grow: 34 },
    { habit: 'snowflake', at: [13, 15], radius: 11, spacing: 3, branches: 0.5, plate: 6, start: 6, grow: 26 },
    { habit: 'snowflake', at: [84, 37], radius: 12, spacing: 3, branches: 1, arms: 'horizontal', start: 4, grow: 30 }
  ] });

export const crystalPresets = { geode, 'quartz-cluster': quartzCluster, pyrite, snowflakes };
