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
    frames: 140, duration: 40, gravity: [0, 0.14], walls: ['left', 'right'],
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
    frames: 152, duration: 40, gravity: [0, 0.2], background: 'b', walls: ['left', 'right'],
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

// Rope bridge: two posts hold a chain of planks by ropes; a crate drops onto the span. The planks are joined end to end,
// the ropes sag, and a heavy enough load tears one free.
const bridgeCrate = ['kkkkkkkk', 'khhhhhhk', 'khbbbbhk', 'khbbbbhk', 'khbbbbhk', 'khbbbbhk', 'khhhhhhk', 'kkkkkkkk'];
const bridgePlank = (name, x, y) => ({ name, shape: 'box', size: [12, 3], at: [x, y], density: 0.7, friction: 0.7, bounce: 0.1, fill: 'b', outline: 'k' });
const bridgeJoints = Array.from({ length: 6 }, (_, k) => ({ type: 'distance', a: `plank-${k}`, b: `plank-${k + 1}`, anchorA: [6, 0], anchorB: [-6, 0], length: 0.5, collide: false }));
const ropeBridge = bodiesSource('rope-bridge', 128, 64,
  { k: '#14141c', s: '#4a5068', f: '#6f7896', b: '#8a5a36', h: '#c98c4f', r: '#d7b56d', R: '#8a5a36', g: '#2ee68f', w: '#e8f4ff' },
  {
    frames: 140, duration: 40, gravity: [0, 0.18], walls: ['left', 'right'],
    obstacles: [{ symbol: 'ground', x: 0, y: 60 }],
    bodies: [
      { name: 'post-L', shape: 'box', size: [4, 42], at: [12, 39], fixed: true, fill: 's', outline: 'k' },
      { name: 'post-R', shape: 'box', size: [4, 42], at: [116, 39], fixed: true, fill: 's', outline: 'k' },
      ...[26.5, 39, 51.5, 64, 76.5, 89, 101.5].map((x, k) => bridgePlank(`plank-${k}`, x, 30)),
      { name: 'crate', shape: 'box', size: [8, 8], at: [64, 8], density: 2.2, friction: 0.5, bounce: 0.1, symbol: 'crate' }
    ],
    joints: bridgeJoints,
    ropes: [
      { from: { body: 'post-L', point: [2, -18] }, to: { body: 'plank-0', point: [-6, 0] }, links: 5, slack: 0, fill: 'r', outline: 'k', break: 40 },
      { from: { body: 'post-R', point: [-2, -18] }, to: { body: 'plank-6', point: [6, 0] }, links: 5, slack: 0, fill: 'r', outline: 'k', break: 40 }
    ]
  },
  { ground: shapeRows(128, 4, (x, y) => (y ? 's' : 'f')), crate: bridgeCrate });

// Wrecking ball: a heavy ball on a rope swings from a fixed pivot into a pyramid of crates.
const wreckingBall = bodiesSource('wrecking-ball', 96, 64,
  { k: '#14141c', s: '#4a5068', f: '#6f7896', m: '#b4bdd8', b: '#8a5a36', h: '#c98c4f', r: '#d7b56d', w: '#e8f4ff' },
  {
    frames: 160, duration: 40, gravity: [0, 0.16], walls: ['left', 'right'],
    obstacles: [{ symbol: 'ground', x: 0, y: 60 }],
    bodies: [
      { name: 'pivot', shape: 'circle', radius: 2, at: [50, 6], fixed: true, fill: 's', outline: 'k' },
      { name: 'ball', shape: 'circle', radius: 6, at: [86, 14], density: 9, bounce: 0.3, friction: 0.5, fill: 'm', outline: 'k' },
      { shape: 'box', size: [8, 8], at: [34, 56], grid: { count: [3, 1], step: [8, 0] }, asleep: true, density: 0.6, friction: 0.6, bounce: 0.1, symbol: 'crate' },
      { shape: 'box', size: [8, 8], at: [38, 48], grid: { count: [2, 1], step: [8, 0] }, asleep: true, density: 0.6, friction: 0.6, bounce: 0.1, symbol: 'crate' },
      { shape: 'box', size: [8, 8], at: [42, 40], asleep: true, density: 0.6, friction: 0.6, bounce: 0.1, symbol: 'crate' }
    ],
    ropes: [{ from: { body: 'pivot', point: [3, 1] }, to: { body: 'ball', point: [-7, -2] }, links: 14, slack: 0, thickness: 1, fill: 'r', outline: 'k' }]
  },
  { ground: shapeRows(96, 4, (x, y) => (y ? 's' : 'f')), crate: bridgeCrate });

// Ragdoll: six blocks hinged into a figure, dropped into a heap.
const ragdoll = bodiesSource('ragdoll', 96, 64,
  { k: '#14141c', s: '#4a5068', f: '#6f7896', w: '#e8e4d8', c: '#3a6ea5', d: '#27496d', r: '#c0392b' },
  {
    frames: 64, duration: 40, gravity: [0, 0.18], walls: ['left', 'right'],
    obstacles: [{ symbol: 'ground', x: 0, y: 60 }],
    bodies: [
      { name: 'head', shape: 'box', size: [8, 8], at: [44, 14], density: 1, fill: 'w', outline: 'k' },
      { name: 'torso', shape: 'box', size: [10, 14], at: [44, 26], density: 1.4, fill: 'c', outline: 'k' },
      { name: 'arm-L', shape: 'box', size: [4, 12], at: [35, 24], density: 0.8, fill: 'd', outline: 'k' },
      { name: 'arm-R', shape: 'box', size: [4, 12], at: [53, 24], density: 0.8, fill: 'd', outline: 'k' },
      { name: 'leg-L', shape: 'box', size: [5, 14], at: [40, 43], density: 1, fill: 'r', outline: 'k' },
      { name: 'leg-R', shape: 'box', size: [5, 14], at: [48, 43], density: 1, fill: 'r', outline: 'k' }
    ],
    joints: [
      { type: 'hinge', a: 'head', b: 'torso', anchorA: [0, 4], anchorB: [0, -7] },
      { type: 'hinge', a: 'torso', b: 'arm-L', anchorA: [-5, -3], anchorB: [0, -6] },
      { type: 'hinge', a: 'torso', b: 'arm-R', anchorA: [5, -3], anchorB: [0, -6] },
      { type: 'hinge', a: 'torso', b: 'leg-L', anchorA: [-2, 7], anchorB: [0, -7] },
      { type: 'hinge', a: 'torso', b: 'leg-R', anchorA: [2, 7], anchorB: [0, -7] }
    ]
  },
  { ground: shapeRows(96, 4, (x, y) => (y ? 's' : 'f')) });

// Flag: a cloth pinned to a pole along its hoist, waving in a loop. The wind holds it out, and the ripple that
// travels from the pole to the fly is what waves it.
const flag = bodiesSource('flag', 64, 48,
  { k: '#14141c', s: '#4a5068', b: '#1a2433', r: '#b23a48', R: '#e06c5a', w: '#f2e6c9', g: '#d7b56d' },
  {
    frames: 24, duration: 40, loop: true, gravity: [0, 0.1], background: 'b',
    bodies: [{ name: 'pole', shape: 'box', size: [2, 38], at: [16, 24], fixed: true, fill: 'g', outline: 'k' }],
    cloths: [{
      name: 'flag', at: [18, 10], size: [25, 15], cell: 1, fill: ['r', 'R', 'w'], outline: 'k', light: [0, -1],
      wind: [1.6, 0], gust: 1, ripple: 3, waves: 1.5, slack: 0.35, stiffness: 0.5, shear: 0.25, bend: 0.02, tear: 4,
      pins: Array.from({ length: 8 }, (_, i) => ({ at: [0, i * 2], x: 17, y: 10 + i * 2 }))
    }]
  });

// Banner: a tattered cloth hung from a rod by its top edge, swaying in a light wind, in a loop. Its `mask` cuts the
// ragged hem and the holes and draws the design, a gold stripe down the red, each character with its own ramp; no
// background, so it drops into a scene.
const bannerHem = [22, 23, 25, 26, 27, 27, 25, 23, 22, 24, 26, 27, 26, 24, 22, 23, 25, 27, 27, 26, 23];
const banner = bodiesSource('banner', 48, 48,
  { k: '#14141c', r: '#8f2433', R: '#b23a48', l: '#e06c5a', G: '#a8802f', g: '#d7b56d', y: '#f2dc9b' },
  {
    frames: 24, duration: 60, loop: true, gravity: [0, 0.15],
    bodies: [{ name: 'rod', shape: 'box', size: [32, 3], at: [24, 7.5], fixed: true, fill: 'g', outline: 'k' }],
    cloths: [{
      name: 'banner', at: [14, 9], size: [21, 28], cell: 1, fill: { r: ['r', 'R', 'l'], g: ['G', 'g', 'y'] }, outline: 'k', light: [-1, 0],
      mask: shapeRows(21, 28, (u, v) => (v <= bannerHem[u] && !(u === 6 && v > 15 && v < 21) && !(u === 14 && v > 8 && v < 12) ? (u >= 9 && u <= 11 ? 'g' : 'r') : '.')),
      wind: [0.1, 0], gust: 1, ripple: 3, waves: 1.25, slack: 0.1, stiffness: 0.5, shear: 0.25, bend: 0.05, collide: false,
      pins: Array.from({ length: 11 }, (_, i) => ({ at: [i * 2, 0], x: 14 + i * 2, y: 9 }))
    }]
  });

// Lantern: an iron lantern on a chain from a beam, pushed by a gust, swinging and settling. What hangs and swings is a
// body on a rope: the picture is a symbol that turns with it, and the chain's two keys are its links by turns.
const lanternRows = ['.....kkk.....', '....kiiik....', '...kkiiikk...', '..kiiiiiiik..', '.kkkkkkkkkkk.', '.kiyyYYYyyik.', '.kiyYYWYYyik.', '.kiyYWWWYyik.', '.kiyYWWWYyik.', '.kiyYYWYYyik.', '.kiyyYYYyyik.', '.kiyyyYyyyik.', '.kkkkkkkkkkk.', '..kiiiiiiik..', '...kkkkkkk...'];
const lantern = bodiesSource('lantern', 48, 64,
  { k: '#14141c', i: '#4a5068', y: '#e8a23a', Y: '#ffd866', W: '#fff6c9', b: '#8a5a36', c: '#8b93ad' },
  {
    frames: 76, duration: 40, gravity: [0, 0.5],
    bodies: [
      { name: 'beam', shape: 'box', size: [44, 5], at: [24, 4.5], fixed: true, fill: 'b', outline: 'k' },
      { name: 'lantern', shape: 'box', size: [13, 15], at: [24, 37.5], velocity: [2.2, 0], density: 3, drag: 0.03, spinDrag: 0.1, symbol: 'lantern' }
    ],
    ropes: [{ from: { body: 'beam', point: [0, 2.5] }, to: { body: 'lantern', point: [0, -7.5] }, links: 8, slack: 0, look: 'chain', fill: 'c', outline: 'k' }]
  },
  { lantern: lanternRows });

// Cape: a walking figure (a fixed body that moves) with a cloth pinned at its shoulders, hanging down its back and
// trailing as it goes.
const heroRows = ['...kkkk...', '..kwwwwk..', '..kwwwwk..', '...kkkk...', '..kcccck..', '.kcccccck.', '.kcccccck.', '.kcccccck.', '..kcccck..', '..kcccck..', '...kkkk...', '..kk..kk..', '..kk..kk..', '..kk..kk..', '..kk..kk..', '..kk..kk..', '..kk..kk..', '..kk..kk..'];
const cape = bodiesSource('cape', 80, 64,
  { k: '#14141c', s: '#4a5068', f: '#6f7896', w: '#e8d8c0', c: '#3a6ea5', d: '#27496d', r: '#c0392b', R: '#e06c5a', g: '#7fb3d5' },
  {
    frames: 120, duration: 40, gravity: [0, 0.16], walls: ['left', 'right'],
    obstacles: [{ symbol: 'ground', x: 0, y: 60 }],
    bodies: [{ name: 'hero', shape: 'box', size: [10, 18], at: [30, 51], fixed: true, velocity: [0.3, 0], symbol: 'hero' }],
    cloths: [{
      name: 'cape', at: [17, 46], size: [9, 13], cell: 1, fill: ['R', 'r', 'r'], outline: 'k', light: [0, -1],
      wind: [-0.1, 0], gust: 1, slack: 0.3, stiffness: 0.5, shear: 0.3, bend: 0.1, tear: 4, draw: 'under', collide: false,
      pins: [{ at: [8, 0], to: 'hero', point: [-4, -5] }, { at: [6, 0], to: 'hero', point: [-6, -5] }]
    }]
  },
  { ground: shapeRows(80, 4, (x, y) => (y ? 's' : 'f')), hero: heroRows });

export const bodiesPresets = { 'ring-escape': ringEscape, 'bouncing-pixel': bouncingPixel, 'spinning-hoop': spinningHoop, 'crate-topple': finer(crateTopple, 2), territory, 'blade-bloom': bladeBloom, 'crate-smash': crateSmash,
  'rope-bridge': ropeBridge, 'wrecking-ball': wreckingBall, lantern, ragdoll, flag, banner, cape };
