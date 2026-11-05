// Rigid-body presets for examples/: each is an ordinary pixelforge-bodies source; scripts/generate-examples.js writes
// them as examples/<name>.bodies.json and showcase/bodies/build.mjs renders their GIFs.
const bodiesSource = (name, width, height, palette, effect, symbols) => ({ format: 'pixelforge-bodies', version: 1, name, width, height, palette, ...(symbols && { symbols }), effects: { [name]: effect } });
const shapeRows = (w, h, at) => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => at(x, y) ?? '.').join(''));

// Ring escape: a ball bounces inside a ring of 42 blocks. Each block hangs where it is, asleep, until the ball knocks it;
// then it drifts out a little and stops. The ball is tireless (every knock gives back the speed it cost) and changes
// colour at each hit, so the ring loosens hit by hit until the ball shoves a run of blocks aside and escapes.
const ringEscape = bodiesSource('ring-escape', 96, 96,
  { b: '#f1f0ea', k: '#1d1d22', t: '#2b2b31', p: '#9b4dff', c: '#2ec4e6', m: '#ff3d7f', o: '#ff7a1a', g: '#2ee68f' },
  {
    frames: 256, duration: 40, gravity: [0, 0.12], background: 'b',
    bodies: [
      { name: 'ball', shape: 'circle', radius: 3, at: [48, 44], velocity: [2.5, -1.5], bounce: 1, friction: 0, tireless: true, fill: ['p', 'c', 'm', 'o', 'g'], outline: 'k', trail: { color: 't', length: 3 } },
      { shape: 'box', size: [4, 4], at: [48, 48], ring: { radius: 30, count: 42 }, asleep: true, weightless: true, density: 6, drag: 0.08, spinDrag: 0.1, friction: 0.3, bounce: 0, fill: 'k' }
    ]
  });

// Bouncing pixel: one pixel thrown into a small room with a ledge and a staircase. It bounces off walls, floor, ledge
// and steps, loses a little at every bounce, rolls, and comes to rest.
const room = { s: '#4a5068', f: '#6f7896' };
const bouncingPixel = bodiesSource('bouncing-pixel', 48, 32,
  { ...room, w: '#fff6d6', y: '#f2c94c' },
  {
    frames: 220, duration: 40, gravity: [0, 0.1], walls: ['left', 'right', 'top'],
    obstacles: [{ symbol: 'floor', x: 0, y: 29 }, { symbol: 'stairs', x: 32, y: 20 }, { symbol: 'ledge', x: 6, y: 15 }],
    bodies: [{ name: 'pixel', shape: 'circle', radius: 0.5, at: [3.5, 6.5], velocity: [2.4, -1.4], bounce: 0.85, friction: 0.3, drag: 0.012, fill: 'w', trail: { color: 'y', length: 2 } }]
  },
  {
    floor: shapeRows(48, 3, (x, y) => (y ? 's' : 'f')),
    stairs: shapeRows(16, 9, (x, y) => (y >= (x < 4 ? 6 : x < 8 ? 3 : 0) ? (y === (x < 4 ? 6 : x < 8 ? 3 : 0) ? 'f' : 's') : null)),
    ledge: shapeRows(12, 2, (x, y) => (y ? 's' : 'f'))
  });

// Spinning hoop: three balls in a hoop that turns with a gap in it. They bounce off the hoop and each other until each
// finds the gap, falls out and lands on the floor below, where they roll to rest.
const spinningHoop = bodiesSource('spinning-hoop', 72, 72,
  { h: '#8fd3ff', k: '#14141c', r: '#ff5a5f', y: '#ffd23f', g: '#3bceac', s: '#4a5068', f: '#6f7896' },
  {
    frames: 240, duration: 40, gravity: [0, 0.12], walls: ['left', 'right'],
    obstacles: [{ symbol: 'floor', x: 0, y: 69 }],
    bodies: [
      { shape: 'hoop', fixed: true, radius: 24, gap: 44, sides: 40, at: [36, 30], angle: 300, spin: 1.6, fill: 'h', bounce: 0.9, friction: 0.2 },
      { name: 'red', shape: 'circle', radius: 2.5, at: [30, 26], velocity: [1.2, -0.4], bounce: 0.95, friction: 0.2, fill: 'r', outline: 'k' },
      { name: 'yellow', shape: 'circle', radius: 2.5, at: [38, 22], velocity: [-0.8, 0.6], bounce: 0.95, friction: 0.2, fill: 'y', outline: 'k' },
      { name: 'green', shape: 'circle', radius: 2.5, at: [42, 34], velocity: [0.6, 1.1], bounce: 0.95, friction: 0.2, fill: 'g', outline: 'k' }
    ]
  },
  { floor: shapeRows(72, 3, (x, y) => (y ? 's' : 'f')) });

// Crate topple: a heavy ball thrown in an arc into a pyramid of crates. The crates rest asleep until they are hit; the
// pyramid falls apart, crates tumble (drawn turned, in steps their size reads at) and everything comes to rest.
const crate = ['oooooooo', 'ohhhhhho', 'ohcccdho', 'ohccdcho', 'ohcdccho', 'ohdcccho', 'ohhhhhho', 'oooooooo'];
const FLOOR = 45;
const crateTopple = bodiesSource('crate-topple', 112, 48,
  { o: '#3b2414', h: '#c98c4f', c: '#a5683a', d: '#6e4223', m: '#b4bdd8', k: '#14141c', s: '#4a5068', f: '#6f7896' },
  {
    frames: 200, duration: 40, gravity: [0, 0.14], walls: ['left', 'right'],
    obstacles: [{ symbol: 'ground', x: 0, y: FLOOR }],
    bodies: [
      { name: 'ball', shape: 'circle', radius: 4, at: [6, 30], velocity: [3.4, -1.3], density: 6, bounce: 0.2, friction: 0.6, fill: 'm', outline: 'k' },
      { shape: 'box', size: [8, 8], at: [70, FLOOR - 4], grid: { count: [3, 1], step: [8, 0] }, asleep: true, density: 0.6, friction: 0.6, bounce: 0.1, symbol: 'crate' },
      { shape: 'box', size: [8, 8], at: [74, FLOOR - 12], grid: { count: [2, 1], step: [8, 0] }, asleep: true, density: 0.6, friction: 0.6, bounce: 0.1, symbol: 'crate' },
      { shape: 'box', size: [8, 8], at: [78, FLOOR - 20], asleep: true, density: 0.6, friction: 0.6, bounce: 0.1, symbol: 'crate' }
    ]
  },
  {
    crate,
    ground: shapeRows(112, 3, (x, y) => (y ? 's' : 'f'))
  });

export const bodiesPresets = { 'ring-escape': ringEscape, 'bouncing-pixel': bouncingPixel, 'spinning-hoop': spinningHoop, 'crate-topple': crateTopple };
