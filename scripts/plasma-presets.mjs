// Electric gas presets for examples/: plasma that electrodes break down, current heats and buoyancy lifts. Each is an
// ordinary pixelforge-fluid source (a gas effect with electrodes and `electric` settings); scripts/generate-examples.js
// writes them as examples/<name>.fluid.json and showcase/fluid/build.mjs renders their GIFs.
const fluidSource = (name, width, height, palette, effect, symbols) => ({ format: 'pixelforge-fluid', version: 1, name, width, height, palette, symbols, effects: { [name]: effect } });
const shapeRows = (w, h, at) => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => at(x, y) ?? '.').join(''));
// A straight run of pixels `thick` wide from (x0, y0) to (x1, y1), as a test for shapeRows.
const onLine = (x0, y0, x1, y1, thick) => (x, y) => {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let k = 0; k <= steps; k++) {
    const px = Math.round(x0 + (x1 - x0) * k / steps), py = Math.round(y0 + (y1 - y0) * k / steps);
    if (y === py && x >= px && x < px + thick) return true;
  }
  return false;
};
// Electric blue: violet glow, blue plasma, cyan and white where current runs.
const arc = { v: '#3b2a8c', b: '#4f7cff', c: '#8fe9ff', W: '#ffffff' };
// Plasma by its ionization (afterglow and leaders), current by its strength, with a violet glow round the current.
const arcLook = (glow, low, high, core, hot) => [
  { field: 'ionization', colors: [glow, low], thresholds: [0.06, 0.35], dither: 0.4 },
  { field: 'current', colors: [high, core], thresholds: hot, dither: 0, halo: { color: glow, width: 1 } }
];
// On for `on` frames, off for `off`, through `frames`, at `volts`.
const pulses = (on, off, frames, volts) => {
  const keys = [];
  for (let f = 0; f < frames; f += on + off) keys.push({ frame: f, voltage: volts }, ...(f + on < frames ? [{ frame: f + on, voltage: 0 }] : []));
  return keys;
};

// Jacob's ladder: two rods in a V. The arc strikes where they are closest, its own heat lifts it, it stretches as the
// rods part and, too long for the supply (its resistance sags the voltage), it goes out at the top; the supply rests
// for a few frames so the hot air clears, and the next arc strikes at the bottom.
const ladderRod = side => shapeRows(40, 64, (x, y) => (onLine(side < 0 ? 17 : 22, 52, side < 0 ? 5 : 34, 4, 2)(x, y) ? 'G' : null));
const jacobsLadder = fluidSource('jacobs-ladder', 40, 64, { ...arc, G: '#c4c8cf', g: '#6f7889', k: '#262a33' }, {
  frames: 22, duration: 60, loop: true, blend: 1, seed: 3, buoyancy: 0.6, vorticity: 0.1, cooling: 0.2, drag: 0.05,
  obstacles: [
    { symbol: 'rod-left', x: 0, y: 0, voltage: [{ frame: 0, voltage: 30 }, { frame: 18, voltage: 0 }], resistance: 20 },
    { symbol: 'rod-right', x: 0, y: 0, voltage: 0 },
    { symbol: 'posts', x: 0, y: 53 }
  ],
  emitters: [],
  electric: { breakdown: 4, focus: 3, growth: 6, recombine: 0.7, sustain: 0.4, memory: 0, heat: 1.5 },
  look: arcLook('v', 'b', 'c', 'W', [0.25, 0.8])
}, {
  'rod-left': ladderRod(-1), 'rod-right': ladderRod(1),
  posts: shapeRows(40, 11, (x, y) => (x === 17 || x === 18 || x === 22 || x === 23 ? (y > 7 ? 'k' : 'g') : null))
});

// Lightning: a charged pocket in a cloud sends a branching leader down; when it reaches the ground the return stroke
// lights the channel white, the charge is spent and it fades through blue and violet; a second stroke follows the
// same channel a moment later.
const lightning = fluidSource('lightning', 64, 96, { ...arc, k: '#1d2030', g: '#2c3044', s: '#3a3550', S: '#28233a' }, {
  frames: 32, duration: 60, seed: 2, buoyancy: 0.1, vorticity: 0.1, cooling: 0.15,
  obstacles: [
    { symbol: 'cloud', x: 0, y: 0, solid: false, draw: 'under' },
    { symbol: 'charge', x: 26, y: 8, solid: false, draw: 'none', voltage: [{ frame: 0, voltage: -240 }, { frame: 8, voltage: 0 }, { frame: 16, voltage: -240 }, { frame: 21, voltage: 0 }], resistance: 20 },
    { symbol: 'ground', x: 0, y: 92, voltage: 0 }
  ],
  emitters: [],
  electric: { breakdown: 2.5, focus: 2, growth: 40, recombine: 0.5, memory: 12, heat: 0.01 },
  look: arcLook('v', 'b', 'c', 'W', [0.25, 0.8])
}, {
  cloud: shapeRows(64, 14, (x, y) => { const d = (x - 32) * (x - 32) / 900 + (y - 2) * (y - 2) / 110; return d < 1 ? (d < 0.6 ? 'k' : 'g') : null; }),
  charge: shapeRows(9, 5, (x, y) => ((x - 4) * (x - 4) + (y - 2) * (y - 2) * 2.2 <= 10 ? 'k' : null)),
  ground: shapeRows(64, 4, (x, y) => (y === 0 ? 's' : 'S'))
});

// Tesla coil: the top load is pulsed, so streamers fork out from it into the air on every pulse and die between them;
// those near the grounded rod reach it and strike, bright, along the path the last strike left.
const teslaCoil = fluidSource('tesla-coil', 96, 64, { ...arc, m: '#c06cf0', p: '#7a44c9', G: '#c4c8cf', g: '#6f7889', h: '#9aa3b3', k: '#262a33' }, {
  frames: 24, duration: 60, loop: true, warmup: 1, blend: 1, seed: 5, buoyancy: 0.3, vorticity: 0.2, cooling: 0.3,
  obstacles: [
    { symbol: 'top', x: 29, y: 25, voltage: pulses(2, 1, 24, 90), resistance: 30 },
    { symbol: 'coil', x: 33, y: 31 },
    { symbol: 'rod', x: 60, y: 38, voltage: 0 }
  ],
  emitters: [],
  electric: { breakdown: 3, focus: 1.2, growth: 40, recombine: 0.9, sustain: 0.4, memory: 2, heat: 0.05, ground: ['left', 'right', 'bottom'] },
  look: [
    { field: 'ionization', colors: ['p', 'm'], thresholds: [0.06, 0.45], dither: 0.4 },
    { field: 'current', colors: ['c', 'W'], thresholds: [0.4, 1.2], dither: 0, halo: { color: 'p', width: 1 } }
  ]
}, {
  top: shapeRows(15, 6, (x, y) => ((x - 7) * (x - 7) / 42 + (y - 2.5) * (y - 2.5) / 9 <= 1 ? 'G' : null)),
  coil: shapeRows(7, 33, (x, y) => (y >= 27 ? 'k' : x === 0 || x === 6 ? 'g' : y % 2 ? 'h' : 'g')),
  rod: shapeRows(5, 26, (x, y) => ((x - 2) * (x - 2) + (y - 2) * (y - 2) <= 5 ? 'G' : y > 2 && (x === 1 || x === 2) ? 'G' : null))
});

// Plasma globe: the ball at the centre is driven in pulses (a globe runs on alternating current), so filaments run from
// it to the glass on every pulse, flicker between white and violet, and drift on the warm gas; each pulse takes the
// paths the last one left.
const globeR = 27, globeC = [32, 30];
const plasmaGlobe = fluidSource('plasma-globe', 64, 64, { ...arc, m: '#c06cf0', p: '#7a44c9', G: '#c4c8cf', g: '#6f7889', h: '#3a4560', k: '#262a33' }, {
  frames: 24, duration: 70, loop: true, warmup: 1, blend: 1, seed: 4, buoyancy: 0.2, vorticity: 0.1, cooling: 0.15,
  obstacles: [
    { symbol: 'glass', x: 0, y: 0, voltage: 0 },
    { symbol: 'ball', x: 28, y: 26, voltage: pulses(3, 1, 24, 120), resistance: 3 },
    { symbol: 'stand', x: 0, y: 0 }
  ],
  emitters: [],
  electric: { breakdown: 3, focus: 3, growth: 60, recombine: 0.6, sustain: 2, memory: 2, heat: 0.005 },
  look: [
    { field: 'ionization', colors: ['p'], thresholds: [0.1], dither: 0.4 },
    { field: 'current', colors: ['m', 'W'], thresholds: [0.6, 4], dither: 0 }
  ]
}, {
  glass: shapeRows(64, 64, (x, y) => { const d = Math.sqrt((x + 0.5 - globeC[0]) ** 2 + (y + 0.5 - globeC[1]) ** 2); return d >= globeR && d < globeR + 1.6 ? 'h' : null; }),
  ball: shapeRows(8, 8, (x, y) => ((x + 0.5 - 4) ** 2 + (y + 0.5 - 4) ** 2 <= 13 ? 'G' : null)),
  stand: shapeRows(64, 64, (x, y) => {
    const d = Math.sqrt((x + 0.5 - globeC[0]) ** 2 + (y + 0.5 - globeC[1]) ** 2);
    if (y > globeC[1] + 3 && d < globeR && Math.abs(x + 0.5 - globeC[0]) < 1.5) return 'g';
    return y >= 57 && Math.abs(x + 0.5 - globeC[0]) < 12 && d >= globeR + 1.6 ? 'k' : null;
  })
});

export const plasmaPresets = { 'jacobs-ladder': jacobsLadder, lightning, 'tesla-coil': teslaCoil, 'plasma-globe': plasmaGlobe };
