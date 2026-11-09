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
      { shape: 'hoop', fixed: true, radius: 24, gap: 44, sides: 40, at: [36.5, 30.5], angle: 300, spin: 1.6, fill: 'h', bounce: 0.9, friction: 0.2 },
      { name: 'red', shape: 'circle', radius: 2.5, at: [30, 26], velocity: [1.2, -0.4], bounce: 0.95, friction: 0.2, fill: 'r', outline: 'k' },
      { name: 'yellow', shape: 'circle', radius: 2.5, at: [38, 22], velocity: [-0.8, 0.6], bounce: 0.95, friction: 0.2, fill: 'y', outline: 'k' },
      { name: 'green', shape: 'circle', radius: 2.5, at: [42, 34], velocity: [0.6, 1.1], bounce: 0.95, friction: 0.2, fill: 'g', outline: 'k' }
    ]
  },
  { floor: shapeRows(72, 3, (x, y) => (y ? 's' : 'f')) });

// Crate topple: a heavy ball thrown in an arc into a pyramid of crates. The crates rest asleep until they are hit; the
// pyramid falls apart, crates tumble and everything comes to rest (by frame 117). Drawn twice as fine as the world's
// pixels (subpixels), the crates turn as rigid pictures; 190 frames keep the finer recipe within its frames' pixels.
const crate = ['oooooooo', 'ohhhhhho', 'ohcccdho', 'ohccdcho', 'ohcdccho', 'ohdcccho', 'ohhhhhho', 'oooooooo'];
const FLOOR = 45;
const crateTopple = bodiesSource('crate-topple', 112, 48,
  { o: '#3b2414', h: '#c98c4f', c: '#a5683a', d: '#6e4223', m: '#b4bdd8', k: '#14141c', s: '#4a5068', f: '#6f7896' },
  {
    frames: 190, duration: 40, gravity: [0, 0.14], walls: ['left', 'right'],
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

const finer = (source, subpixels) => { const { format, version, name, width, height, ...rest } = source; return { format, version, name, width, height, subpixels, ...rest }; };
// Territory: tide (navy, top) against ember (amber, bottom). Each team's balls fly at a held speed through their own
// ground and bounce off the other team's, claiming every cell they hit, so the border between them frays. Pickups drop
// in: a triple split, a giant, a warp that drops a tide ball deep in ember ground to carve a pocket, a rush of speed and
// a vortex that drags the other team's balls to the border. The score bar and counts sit under the board, the latest
// power over it, and the leader is named at the end. A longer match goes out as video frames (pixelbolt sequence).
const territoryFrames = 256, territorySpeed = 3.5;
const ball = (name, team, at, velocity, fill) => ({ name, shape: 'circle', radius: 2.5, at, velocity, speed: territorySpeed, team, bounce: 1, friction: 0, fill });
const territory = bodiesSource('territory', 72, 128,
  { n: '#1d3557', a: '#f4a259', N: '#0d1b2a', A: '#fff1d6', k: '#10131a', w: '#f8f4ec', p: '#e63973', q: '#ffe0ea' },
  {
    frames: territoryFrames, duration: 34, gravity: [0, 0], background: 'k', walls: ['left', 'right', 'top'],
    obstacles: [{ symbol: 'floor', x: 0, y: 112, draw: 'none' }],
    territory: { cell: 4, size: [18, 28], split: 'rows', teams: [{ name: 'tide', color: 'n' }, { name: 'ember', color: 'a' }] },
    bodies: [
      ball('tide1', 'tide', [22, 30], [1.2, 1.6], 'A'), ball('ember1', 'ember', [50, 84], [-1.5, -1.3], 'N'),
      ball('tide2', 'tide', [54, 12], [-1.1, 1.7], 'A'), ball('ember2', 'ember', [14, 104], [1.6, -1.2], 'N')
    ],
    pickups: [
      { at: [16, 16], from: 10, power: 'split', symbol: 'triple', label: 'TRIPLE' },
      { at: [56, 96], from: 40, power: 'grow', symbol: 'giant', label: 'GIANT', frames: 70, scale: 2.4 },
      { at: [54, 22], from: 90, power: 'warp', symbol: 'warp', label: 'WARP', to: [20, 92] },
      { at: [18, 100], from: 120, power: 'speed', symbol: 'rush', label: 'RUSH', frames: 70 },
      { at: [36, 40], from: 150, power: 'magnet', symbol: 'vortex', label: 'VORTEX', frames: 70, strength: 0.25, to: [36, 56] }
    ],
    hud: [
      { bar: { at: [4, 116], size: [64, 3] } },
      { text: '{tide}', at: [4, 121], color: 'w' },
      { text: '{ember}', at: [68, 121], color: 'w', align: 'right' },
      { text: '{news}', at: [36, 3], color: 'w', align: 'center', back: 'p', pad: 1, news: 40 },
      { text: '{leader} LEADS', at: [36, 52], color: 'w', align: 'center', back: 'p', pad: 2, from: territoryFrames - 30 }
    ]
  },
  {
    floor: ['k'.repeat(72)],
    triple: ['ppppp', 'pqpqp', 'ppppp', 'pqpqp', 'ppppp'],
    giant: ['ppppp', 'pqqqp', 'pqpqp', 'pqqqp', 'ppppp'],
    warp: ['ppppp', 'pqpqp', 'ppqpp', 'pqpqp', 'ppppp'],
    rush: ['ppppp', 'pqppp', 'ppqpp', 'pqppp', 'ppppp'],
    vortex: ['ppppp', 'pqqqp', 'pqpqp', 'pqpqp', 'ppppp']
  });

// Blade bloom: a sword turns about its hilt in a ring, its swing smeared behind it. One ball drops in and lands just as
// the blade comes round; the blade cuts through every ball it touches (each at most once every 6 frames), and the three
// pieces drift off behind it in the colour of the moment, which steps once a turn (every 30 frames), so each turn's
// generation fills the blade's wake and, once the ring is full, every turn washes a new colour round behind the blade.
// At frame 200 the ring vanishes, the packed crowd bursts out and falls away, and the sword spins on alone. 900 balls at
// most.
const bladeHandle = 8, bladeGuard = 2, bladeSteel = 26, bladeLength = bladeHandle + bladeGuard + bladeSteel;
const bladeRow = f => Array.from({ length: bladeLength }, (_, x) => f(x) ?? '.').join('');
const katana = [
  bladeRow(x => (x >= bladeHandle && x < bladeHandle + bladeGuard ? 'y' : null)),
  bladeRow(x => (x < bladeHandle ? 'R' : x < bladeHandle + bladeGuard ? 'y' : x < bladeLength - 3 ? 'G' : null)),
  bladeRow(x => (x < bladeHandle ? (x % 2 ? 'y' : 'R') : x < bladeHandle + bladeGuard ? 'y' : 'W')),
  bladeRow(x => (x < bladeHandle ? 'R' : x < bladeHandle + bladeGuard ? 'y' : x < bladeLength - 1 ? 'w' : null)),
  bladeRow(x => (x >= bladeHandle && x < bladeHandle + bladeGuard ? 'y' : null))
];
const bladeBloom = bodiesSource('blade-bloom', 80, 80,
  {
    k: '#07070d', o: '#d8d8e4', R: '#a3122a', y: '#e3b341', G: '#8d93a8', W: '#ffffff', w: '#c9e4ff', s: '#5d6378', t: '#2c3040',
    a: '#ff3b5c', b: '#ff7a2f', c: '#ffc93c', d: '#b8f040', e: '#41e07a', f: '#2fe0c0', g: '#35c6ff', h: '#3d7bff', i: '#7a5cff', j: '#c04dff', l: '#ff4fd8', m: '#ff4f93'
  },
  {
    frames: 240, duration: 40, gravity: [0, 0.3], background: 'k', most: 900,
    bodies: [
      { name: 'ring', shape: 'hoop', fixed: true, radius: 36, thickness: 2, sides: 48, at: [40, 40], fill: 'o' },
      { name: 'blade', shape: 'box', size: [bladeLength, 3], pivot: [-bladeLength / 2 + 2, 0], at: [40, 40], angle: 170, fixed: true, spin: 12, symbol: 'katana', bounce: 0.2, friction: 0.1, smear: { colors: ['W', 's', 't'], frames: 2 } },
      { name: 'seed', shape: 'circle', radius: 1, at: [40, 10], velocity: [0.5, 0], bounce: 0.2, friction: 0.15, fill: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'l', 'm'], fillEvery: 30 }
    ],
    strikes: [{ by: 'blade', power: 'split', count: 3, spread: 60, rest: 6, cut: 0.5 }],
    events: [{ frame: 200, body: 'ring', power: 'vanish' }]
  },
  { katana });

// Crate smash: a heavy iron ball is thrown through a pane of glass into a pyramid of crates. The pane shatters and its
// shards fly on into the crates; crates the ball or the flying pieces knock hard enough break apart, each piece carrying
// its part of the crate (its boards and grain), while the far side of the pyramid stands; a crate that falls from the top
// breaks where it lands. Everything settles into a heap of whole crates, planks and glass.
const SMASH_FLOOR = 56;
const pane = ['wwwww', 'wpppw', 'wpqpw', 'wpppw', 'wppqw', 'wpppw', 'wqppw', 'wpppw', 'wpqpw', 'wpppw', 'wppqw', 'wpppw', 'wpppw', 'wqppw', 'wpppw', 'wwwww'];
const smashCrate = (at, extra) => ({ shape: 'box', size: [8, 8], at, asleep: true, density: 0.6, friction: 0.6, bounce: 0.1, symbol: 'crate', breaks: { at: 1.5, pieces: 4 }, ...extra });
const crateSmash = bodiesSource('crate-smash', 112, 64,
  { o: '#3b2414', h: '#c98c4f', c: '#a5683a', d: '#6e4223', m: '#b4bdd8', k: '#14141c', s: '#4a5068', b: '#1b1d2a', g: '#2c3047', w: '#e8f4ff', p: '#6fc3e6', q: '#b9e6f7' },
  {
    frames: 180, duration: 40, gravity: [0, 0.2], background: 'b', walls: ['left', 'right'],
    obstacles: [{ symbol: 'ground', x: 0, y: SMASH_FLOOR }],
    bodies: [
      { name: 'ball', shape: 'circle', radius: 4, at: [6, 46], velocity: [5.5, -0.8], density: 20, bounce: 0.2, friction: 0.6, fill: 'm', outline: 'k' },
      smashCrate([64, SMASH_FLOOR - 4], { name: 'crate', grid: { count: [4, 1], step: [8, 0] } }),
      smashCrate([68, SMASH_FLOOR - 12], { name: 'crate-two', grid: { count: [3, 1], step: [8, 0] } }),
      smashCrate([72, SMASH_FLOOR - 20], { name: 'crate-three', grid: { count: [2, 1], step: [8, 0] } }),
      smashCrate([76, SMASH_FLOOR - 28], { name: 'crate-top' }),
      { name: 'pane', shape: 'box', size: [5, 16], at: [36, SMASH_FLOOR - 8], asleep: true, density: 1.2, friction: 0.4, bounce: 0.1, symbol: 'pane', breaks: { at: 1.2, pieces: 8, speed: 0.8 } }
    ]
  },
  { crate, pane, ground: ['g'.repeat(112), 's'.repeat(112), 'g'.repeat(112)] });

export const bodiesPresets = { 'ring-escape': ringEscape, 'bouncing-pixel': bouncingPixel, 'spinning-hoop': spinningHoop, 'crate-topple': finer(crateTopple, 2), territory, 'blade-bloom': bladeBloom, 'crate-smash': crateSmash };
