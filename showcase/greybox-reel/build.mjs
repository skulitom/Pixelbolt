// Greybox to finished art, one layer at a time: a 12-second square reel made entirely in Pixelbolt. One side-view
// platformer screen scrolls right while its grey placeholder boxes are replaced, layer by layer, by art: the player,
// the ground tiles, the sky, a far and a near parallax plane, coins and a slime, then lighting. Every stage is an
// ordinary recipe or scene written below as text and rendered locally, deterministically, with no image model.
//
// Usage: node showcase/greybox-reel/build.mjs [--force | --check]
//        node showcase/greybox-reel/build.mjs --reel [folder]   also renders the frames and GIF (default output/greybox-reel)
// Writes ordinary Pixelbolt sources into art/ and a contact sheet of the stages, stages.png. This script is
// authoritative; the written files are its output. Existing files are kept unless --force is passed; --check compares
// without writing. The reel itself (frames, GIF, MP4) is large and stays out of git; see README.md.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { formatJSON } from '../../src/export.js';
import { ease } from '../../src/craft.js';
import { measureText } from '../../src/font.js';
import { prepareScene, renderScene } from '../../src/scene.js';
import { encodePNG } from '../../src/png.js';

const args = process.argv.slice(2), force = args.includes('--force'), check = args.includes('--check'), reel = args.includes('--reel');
const here = fileURLToPath(new URL('.', import.meta.url)), out = path.join(here, 'art'), root = fileURLToPath(new URL('../../', import.meta.url));
const written = [], differing = [], docs = {};
// Saves a JSON source into art/, or bytes (a Buffer) at a path relative to this folder.
function save(name, value) {
  const binary = Buffer.isBuffer(value), target = binary ? path.join(here, name) : path.join(out, name), bytes = binary ? value : Buffer.from(formatJSON(value));
  if (!binary) docs[name] = value;
  if (check) { if (!existsSync(target) || !readFileSync(target).equals(bytes)) differing.push(name); return; }
  if (existsSync(target) && !force) {
    if (readFileSync(target).equals(bytes)) return;
    throw new Error(`Refusing to overwrite ${target}; pass --force`);
  }
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  written.push(name);
}

// ---------------------------------------------------------------- the reel's clock and screen
// 216 × 216 is exactly 1080 × 1080 at 5×. The camera moves 30 px a second, one pixel per video frame at 30 fps.
const W = 216, H = 216, TILE = 16, GROUND = 168, DURATION = 12000, SPEED = 30, HERO_X = 72;
const STAGES = [
  { cue: 'greybox', time: 0, title: 'GREYBOX', note: 'every layer is a placeholder' },
  { cue: 'player', time: 1400, title: 'PLAYER', note: 'run and jump poses' },
  { cue: 'tiles', time: 2700, title: 'TILES', note: 'tilemap + autotile' },
  { cue: 'sky', time: 4000, title: 'SKY', note: 'dithered bands, parallax 0' },
  { cue: 'far', time: 5300, title: 'FAR PLANE', note: 'parallax 0.25 + haze' },
  { cue: 'near', time: 6600, title: 'NEAR PLANE', note: 'parallax 0.5 + haze' },
  { cue: 'actors', time: 7900, title: 'COINS & SLIME', note: 'pickups and an enemy' },
  { cue: 'light', time: 9200, title: 'LIGHTING', note: 'sunset, lamps and a wisp' }
];
const CUE = Object.fromEntries(STAGES.map(s => [s.cue, s.time]));
// The last 1.2 seconds say what made it, while the lit scene keeps running.
const CAPTIONS = [...STAGES, { cue: 'credit', time: 10800, title: 'PIXELBOLT', note: 'text recipes, no image model', credit: true }];
const heroX = ms => HERO_X + SPEED * ms / 1000;

// ---------------------------------------------------------------- colours
// One table for the whole reel. Each recipe takes the keys it needs, with ramps from dark to light so ramp lighting
// darkens toward dusk without leaving the palette.
const C = {
  ink: '#1b1626',
  // greybox
  g0: '#34343b', g1: '#4b4b54', g2: '#64646e', g3: '#7f7f8a', g4: '#9c9ca6', g5: '#b8b8c1', g6: '#d2d2d8', g7: '#ececf0',
  // sky: blues and the warm band at the horizon
  sky0: '#1d2547', sky1: '#2b3c6e', sky2: '#3f5f9a', sky3: '#6189c0', sky4: '#92b6dc', sky5: '#c3dbea',
  warm0: '#6a3550', warm1: '#a8505e', warm2: '#dc7c6a', warm3: '#f4ab80', warm4: '#fcd5a4', warm5: '#fff1d2',
  white: '#fbf8f0',
  // far mountains and castle
  m0: '#252443', m1: '#3a3a66', m2: '#555a8c', m3: '#7d84b4', m4: '#aab2d6', m5: '#dfe4f4',
  // near plane: trees, roofs and walls
  t0: '#132a2e', t1: '#1d4040', t2: '#2a5c4c', t3: '#3f7c58', t4: '#62a065',
  r0: '#3a1a2e', r1: '#62263c', r2: '#8e3846', r3: '#b8564e', r4: '#d8805e',
  h0: '#3e3240', h1: '#66525c', h2: '#957c7c', h3: '#c2a690', h4: '#e2cdb0',
  // ground
  gr0: '#10302a', gr1: '#1c4e34', gr2: '#2e753c', gr3: '#4f9e42', gr4: '#8cc850', gr5: '#c8ec78',
  d0: '#1c1018', d1: '#341c22', d2: '#55302c', d3: '#7a4a36', d4: '#a06a44', d5: '#c49260',
  k0: '#1e1c2c', k1: '#36344a', k2: '#55546e', k3: '#7c7c98', k4: '#a8a8c0', k5: '#d4d4e2',
  // hero
  c0: '#3c1028', c1: '#6e1a34', c2: '#a8283a', c3: '#d84a44', c4: '#f27a56',
  f0: '#6a3030', f1: '#b46a52', f2: '#e8a47e', f3: '#fcd0aa',
  b0: '#121a38', b1: '#1c2c5c', b2: '#2c4c8c', b3: '#4278c4', b4: '#7cb0e8',
  // gold and the slime
  y0: '#5a2c10', y1: '#9a5a18', y2: '#d89420', y3: '#f8c848', y4: '#fff0a0',
  p0: '#24102e', p1: '#4a1a5a', p2: '#7a2c8a', p3: '#b050b8', p4: '#e08ae0', p5: '#fcd0f4'
};
// A recipe palette: single-character grid keys mapped to colour names from the table (or literal colours).
const pal = map => Object.fromEntries(Object.entries(map).map(([key, name]) => [key, C[name] ?? name]));

// ---------------------------------------------------------------- small drawing helpers
const grid = (x, y, rows, extra = {}) => ({ op: 'grid', x, y, rows, ...extra });
const rect = (x, y, w, h, color, extra = {}) => ({ op: 'rect', x, y, w, h, color, ...extra });
const outline = (color = 'O', extra = {}) => ({ op: 'outline', color, ...extra });
// A grid from a function of (x, y) returning a key or '.'.
const field = (w, h, at) => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => at(x, y)).join(''));
// Integer hash for deterministic texture; no Math.random anywhere.
const hash = (x, y, seed = 0) => { let n = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };

// ================================================================ the hero
// Drawn from parts (hood, tunic, arms, legs, cape) and outlined afterwards, so each pose keeps one clean silhouette.
// The near leg and arm are lighter than the far ones; the planted foot moves back 3–4 px a frame, close to the
// ground's 3 px at 30 px/s and 100 ms frames.
const heroPalette = pal({ O: 'ink', q: 'c0', r: 'c1', R: 'c2', Q: 'c3', z: 'f0', s: 'f1', S: 'f2', N: 'b0', n: 'b1', b: 'b2', B: 'b3', T: 'b4',
  x: 'd1', w: 'd2', W: 'd3', y: 'y3', G: 'g7', g: 'g4', k: 'g1' });
const heroRamps = [['q', 'r', 'R', 'Q'], ['z', 's', 'S'], ['N', 'n', 'b', 'B', 'T'], ['x', 'w', 'W']];
const HEAD = [
  '.....rrrr...',
  '...rrrrrRRR.',
  '..rrrrrRRRQR',
  'qrrrrrqqqqqR',
  '.qqrrqsSSSSS',
  '...rrqsSSOSS',
  '...qrqssSSSs',
  '....qqqssss.'
];
const TORSO = ['Nbbbbbbb', 'NbbbbbbB', 'NNbbbbbB', 'xxxxxyxx', 'Nbbbbbbb', 'NNNbbbbN'];
// Legs, full canvas width, rows 18–24: near leg n/w, far leg N/x.
const LEGS = {
  contact: ['........NNnnn.........', '.......NNN.nnn........', '......NNN...nnn.......', '.....NNN.....nnn......', '....xxN.......nnn.....', '...xxx........wwWw....', '..............wwww....'],
  down: ['........NNnnn.........', '.......NNNnnn.........', '......NNN..nnn........', '.....xxN...nnn........', '....xxx...nnn.........', '..........wwWw........', '..........wwww........'],
  pass: ['........Nnnnn.........', '........nnNNN.........', '.......nn..NNN........', '.......nn..xx.........', '.......nn.............', '......wwWw............', '......wwww............'],
  rise: ['........NNnnnn........', '.......NNN.nnnn.......', '......NNN....nn.......', '......xx.....nn.......', '.....xx.....wwWw......', '............www.......', '......................'],
  fall: ['........NNnnn.........', '........NN.nnn........', '.......NN....nn.......', '.......xx.....nn......', '......xx......wwWw....', '..............www.....', '......................']
};
// The second half of the run is the first with the legs' colours swapped: the far leg is then the one in front.
const swapLegs = rows => rows.map(r => r.replace(/[nNwWx]/g, c => ({ n: 'N', N: 'n', w: 'x', W: 'x', x: 'w' }[c])));
const CAPES = [
  ['....qrr', '..qqrrr', '.qqrrr.', 'qqrr...', 'qq.....'],
  ['.....rr', '...qrrr', '.qqrrrr', 'qqqrr..', '.q.....'],
  ['....qrr', '...qrrr', '..qqrr.', '.qqrr..', '.qq....'],
  ['qq..qrr', '.qqqrrr', '..qrrr.', '...r...', '.......']
];
const ARMS = {
  forward: { x: 11, dy: 0, rows: ['BT...', '.BT..', '..BSS'] },
  mid: { x: 10, dy: 0, rows: ['BT.', '.BT', '.SS'] },
  back: { x: 6, dy: 0, rows: ['...TB', '..TB.', 'SSB..'] },
  up: { x: 13, dy: -2, rows: ['...SS', '..TB.', 'BTB..'] }
};
// `wisp` is where the companion light floats, behind the head; it rises with every bob and jump.
const heroPose = (name, legs, cape, arm, dy, duration = 100) => ({ name, duration, points: { wisp: [3, 3 + dy] }, ops: [
  grid(2, 12 + dy, cape), grid(0, 18, legs), grid(7, 12 + dy, TORSO), grid(4, 4 + dy, HEAD),
  grid(arm.x, 13 + dy + arm.dy, arm.rows), outline()
] });
save('hero.json', { version: 1, name: 'hero', width: 22, height: 27, palette: heroPalette, ramps: heroRamps, anchor: [11, 26], frames: [
  // the greybox stand-in: a plain box with a notch for the way it faces
  { name: 'grey', duration: 100, points: { wisp: [3, 3] }, ops: [rect(6, 4, 11, 21, 'G'), rect(6, 4, 11, 21, 'k', { filled: false }), rect(13, 8, 2, 2, 'k')] },
  heroPose('run-0', LEGS.contact, CAPES[0], ARMS.back, 0),
  heroPose('run-1', LEGS.down, CAPES[1], ARMS.mid, 1),
  heroPose('run-2', LEGS.pass, CAPES[2], ARMS.forward, -1),
  heroPose('run-3', swapLegs(LEGS.contact), CAPES[0], ARMS.forward, 0),
  heroPose('run-4', swapLegs(LEGS.down), CAPES[1], ARMS.mid, 1),
  heroPose('run-5', swapLegs(LEGS.pass), CAPES[2], ARMS.back, -1),
  heroPose('rise', LEGS.rise, CAPES[3], ARMS.up, -1, 400),
  heroPose('fall', LEGS.fall, CAPES[3], ARMS.up, 0, 400)
], animations: {
  grey: { frames: ['grey'] },
  run: { frames: ['run-0', 'run-1', 'run-2', 'run-3', 'run-4', 'run-5'] },
  jump: { frames: ['rise', 'fall'], loop: false },
  drop: { frames: ['fall'], loop: false }
} });

// ================================================================ coins
// A coin turns in four drawings and bursts into a sparkle when collected. The greybox coin is a plain square.
const coinPalette = pal({ O: 'ink', a: 'y1', b: 'y2', c: 'y3', d: 'y4', e: 'white', g: 'g6', k: 'g1' });
const COIN = {
  face: ['.aaaa.', 'abbcca', 'abacda', 'abacda', 'abacda', 'abacda', 'abbcca', '.aaaa.'],
  three: ['.aa.', 'abca', 'abda', 'abda', 'abda', 'abda', 'abca', '.aa.'],
  edge: ['a', 'c', 'd', 'd', 'd', 'd', 'c', 'a']
};
const SPARKS = [
  ['...........', '...........', '.....d.....', '.....c.....', '....cdc....', '..dcdedcd..', '....cdc....', '.....c.....', '.....d.....', '...........', '...........'],
  ['.....d.....', '.....c.....', '.d...c...d.', '..c..d..c..', '...c...c...', 'dcd.....dcd', '...c...c...', '..c..d..c..', '.d...c...d.', '.....c.....', '.....d.....'],
  ['.....c.....', '...........', '.c.......c.', '...........', '...........', 'c.........c', '...........', '...........', '.c.......c.', '...........', '.....c.....'],
  ['...........', '...........', '...........', '...........', '...........', '.....d.....', '...........', '...........', '...........', '...........', '...........']
];
save('coin.json', { version: 1, name: 'coin', width: 12, height: 12, palette: coinPalette, ramps: [['a', 'b', 'c', 'd']], anchor: [6, 6], frames: [
  { name: 'grey', duration: 100, ops: [rect(3, 2, 6, 8, 'g'), rect(3, 2, 6, 8, 'k', { filled: false })] },
  { name: 'spin-0', duration: 200, ops: [grid(3, 2, COIN.face), outline()] },
  { name: 'spin-1', duration: 100, ops: [grid(4, 2, COIN.three), outline()] },
  { name: 'spin-2', duration: 100, ops: [grid(5, 2, COIN.edge), outline()] },
  { name: 'spin-3', duration: 100, ops: [grid(4, 2, COIN.three, { flipX: true }), outline()] },
  ...SPARKS.map((rows, i) => ({ name: `spark-${i}`, duration: 100, ops: [grid(1, 1, rows)] }))
], animations: {
  spin: { frames: ['spin-0', 'spin-1', 'spin-2', 'spin-3'] },
  collect: { frames: ['spark-0', 'spark-1', 'spark-2', 'spark-3'], loop: false }
} });

// ================================================================ the slime
// It faces left and hops toward the hero: squash, stretch, a hang in the air, then the landing squash.
const slimePalette = pal({ O: 'ink', q: 'p0', p: 'p1', P: 'p2', Q: 'p3', h: 'p4', H: 'p5', e: 'white', g: 'g3', k: 'g1' });
const SLIME = {
  rest: [
    '.....pppppp.....',
    '...ppPPPPPPpp...',
    '..pPPPPPPPQhHp..',
    '.pPPPPPPPPPQhQp.',
    '.pPeeePPPPPPQQp.',
    'pPPOeePPPPPPPPPp',
    'pPPOeePPPPPPPPPp',
    'pPPPPPPPPPPPPPPp',
    'pPqqPPPPPPPPPPPp',
    'qpPPPPPPPPPPPPpq',
    'qqpppppppppppqqq',
    '.qqqqqqqqqqqqqq.'
  ],
  squash: [
    '......pppppp......',
    '...pppPPPPPPppp...',
    '..pPPPPPPPPPPQhHp.',
    '.pPeeePPPPPPPPQQp.',
    'pPPOeePPPPPPPPPPPp',
    'pPPOeePPPPPPPPPPPp',
    'pPqqPPPPPPPPPPPPPp',
    'qqpppppppppppppqqq',
    '.qqqqqqqqqqqqqqqq.'
  ],
  stretch: [
    '....pppp....',
    '..ppPPPPpp..',
    '.pPPPPPQhHp.',
    '.pPPPPPPQhp.',
    'pPPPPPPPPQQp',
    'pPeeePPPPPPp',
    'pPOeePPPPPPp',
    'pPOeePPPPPPp',
    'pPPPPPPPPPPp',
    'pqqPPPPPPPPp',
    'pPPPPPPPPPPp',
    'qpPPPPPPPPpq',
    'qqppppppppqq',
    '.qqqqqqqqqq.'
  ]
};
const slimeFrame = (name, rows, lift, duration) => ({ name, duration, ops: [grid(10 - (rows[0].length >> 1), 21 - rows.length - lift, rows), outline()] });
save('slime.json', { version: 1, name: 'slime', width: 20, height: 22, palette: slimePalette, ramps: [['q', 'p', 'P', 'Q', 'h', 'H']], anchor: [10, 22], frames: [
  { name: 'grey', duration: 100, ops: [rect(2, 10, 16, 12, 'g'), rect(2, 10, 16, 12, 'k', { filled: false }), rect(4, 13, 2, 2, 'k')] },
  slimeFrame('rest', SLIME.rest, 0, 200),
  slimeFrame('squash', SLIME.squash, 0, 100),
  slimeFrame('stretch', SLIME.stretch, 2, 100),
  slimeFrame('air', SLIME.rest, 5, 200),
  slimeFrame('land', SLIME.squash, 0, 100)
], animations: { hop: { frames: ['rest', 'squash', 'stretch', 'air', 'land'] } } });

// ================================================================ the wisp
// A small light that follows the hero once the sun has set. It keeps its own colours (lit: false in the scene).
const wispPalette = pal({ a: 'y2', b: 'y3', c: 'y4', d: 'white' });
const WISP = [
  ['...a...', '..aba..', '.abcba.', 'abcdcba', '.abcba.', '..aba..', '...a...'],
  ['.......', '..aba..', '.abcba.', '.bcdcb.', '.abcba.', '..aba..', '.......'],
  ['...a...', '...b...', '..bcb..', 'abcdcba', '..bcb..', '...b...', '...a...']
];
save('wisp.json', { version: 1, name: 'wisp', width: 9, height: 11, palette: wispPalette, anchor: [4, 6], frames: [
  { name: 'glow-0', duration: 200, ops: [grid(1, 2, WISP[0])] },
  { name: 'glow-1', duration: 200, ops: [grid(1, 1, WISP[1])] },
  { name: 'glow-2', duration: 200, ops: [grid(1, 2, WISP[2])] },
  { name: 'glow-3', duration: 200, ops: [grid(1, 3, WISP[1])] }
], animations: { glow: { frames: ['glow-0', 'glow-1', 'glow-2', 'glow-3'] } } });

// ================================================================ ground tiles
// Cardinal autotile templates (two tiles wide, three tall; the island in rows 1–2). Grass and dirt for the ground,
// stone for floating platforms, each with a greybox twin of the same shape. Interior texture repeats every 16 px, the
// phase the autotile quarters are cut at, so neighbouring tiles always join.
const tilePalette = pal({
  O: 'ink', a: 'gr0', b: 'gr1', c: 'gr2', e: 'gr3', f: 'gr4', F: 'gr5',
  u: 'd0', v: 'd1', w: 'd2', x: 'd3', z: 'd4', Z: 'd5',
  i: 'k0', j: 'k1', l: 'k2', m: 'k3', n: 'k4', N: 'k5',
  '0': 'g0', '1': 'g1', '2': 'g2', '3': 'g3', '4': 'g4', '5': 'g5', '6': 'g6'
});
const tileRamps = [['a', 'b', 'c', 'e', 'f', 'F'], ['u', 'v', 'w', 'x', 'z', 'Z'], ['i', 'j', 'l', 'm', 'n', 'N']];
// The grass lip along the top, 16 px periodic: how many rows of grass hang down at each column.
const LIP = [5, 6, 5, 4, 5, 6, 6, 5, 4, 4, 5, 6, 5, 5, 4, 5];
const BLADES = [1, 0, 2, 0, 0, 1, 0, 0, 2, 1, 0, 0, 1, 0, 0, 2];
// Dirt texture, 16×16: pebbles and lighter specks placed by hand.
const DIRT = [
  'wwwwwwwwwwwwwwww',
  'wwwwxwwwwwwwwvww',
  'wwwwwwwwwwwwwwww',
  'wvwwwwwwwxxwwwww',
  'wwwwwwwwwwwwwwww',
  'wwwwwwjlwwwwwwww',
  'wwxwwwjjwwwwwvww',
  'wwwwwwwwwwwwwwww',
  'wwwwwwwwwwwwwwww',
  'wwwwwwwwwvwwwwwx',
  'vwwwwwwwwwwwwwww',
  'wwwwxwwwwwwwwwww',
  'wwwwwwwwwwwwjlww',
  'wwwvwwwwwwwwwjww',
  'wwwwwwwwxwwwwwww',
  'wwwwwwwwwwwwwwww'
];
function groundTemplate(grey) {
  const t = Array.from({ length: 48 }, () => Array(32).fill('.'));
  for (let iy = 0; iy < 32; iy++) for (let ix = 0; ix < 32; ix++) {
    const px = ix % 16, py = iy % 16, top = iy, left = ix, right = 31 - ix;
    let key;
    if (grey) {
      key = (px === 0 || py === 0) ? '2' : '3';
      if (top === 0) key = '5'; else if (top === 1) key = '4';
      if (left === 0 || right === 0) key = '1';
    } else {
      key = DIRT[py][px];
      // darker dirt down the side walls and a lit right-hand rim (the sun sets on the right)
      if (left < 2) key = 'v';
      if (right === 0) key = 'x'; else if (right === 1 && key === 'v') key = 'w';
      const lip = LIP[px] + (left < 2 || right < 2 ? -1 : 0);
      if (top < lip) key = top < 2 ? (BLADES[px] && top === 0 ? 'f' : top === 0 ? '.' : 'e') : top === lip - 1 ? 'b' : 'c';
      if (top === 1 && BLADES[px] === 2) key = 'F';
      if (top === lip || top === lip + 1 && hash(px, 3) < 0.4) key = 'u';
      if (top < lip && right < 2 && top > 0) key = top === lip - 1 ? 'b' : 'e';
      if (top === 0 && (left === 0 || right === 0)) key = '.';
    }
    t[16 + iy][ix] = key;
  }
  return t.map(r => r.join(''));
}
function platformTemplate(grey) {
  // A slab of stone: a light top lip, a body with joints, a dark underside.
  const t = Array.from({ length: 48 }, () => Array(32).fill('.'));
  for (let iy = 0; iy < 32; iy++) for (let ix = 0; ix < 32; ix++) {
    const px = ix % 16, top = iy, bottom = 31 - iy, left = ix, right = 31 - ix;
    let key;
    if (grey) {
      key = px === 0 ? '2' : '3';
      if (top === 0) key = '5'; else if (top === 1) key = '4';
      if (bottom === 0 || left === 0 || right === 0) key = '1';
    } else {
      key = 'l';
      if ((px === 0 || px === 8 && iy % 16 > 8) && top > 2 && bottom > 1) key = 'j';
      if (hash(ix, iy, 5) < 0.06 && top > 3 && bottom > 2) key = 'm';
      if (top === 0) key = 'N'; else if (top === 1) key = 'n'; else if (top === 2) key = 'm';
      if (bottom === 0) key = 'i'; else if (bottom === 1) key = 'j';
      if (left === 0) key = top < 2 ? 'm' : 'j';
      if (right === 0) key = top < 2 ? 'N' : 'm';
      // rounded corners
      if ((top === 0 || bottom === 0) && (left === 0 || right === 0)) key = '.';
    }
    t[16 + iy][ix] = key;
  }
  return t.map(r => r.join(''));
}
const CARDINAL = Array.from({ length: 16 }, (_, m) => m);
// The pit between ground tiles: the trench's back wall, darker with depth, with stakes at the bottom.
const PIT = {
  top: field(16, 16, (x, y) => (y < 2 ? 'u' : hash(x, y, 9) < 0.08 ? 'u' : 'v')),
  deep: field(16, 16, () => 'u'),
  stakes: field(16, 16, (x, y) => { const tip = x % 4 === 1 ? 6 : x % 4 === 2 ? 7 : 99; return y >= 10 ? (x % 4 === 0 ? 'i' : 'j') : y >= tip ? (x % 4 === 1 ? 'm' : 'l') : 'u'; })
};
const greyPit = rows => rows.map(r => r.replace(/[uvijlm]/g, c => ({ u: '1', v: '1', i: '0', j: '0', l: '2', m: '2' }[c])));
// Little plants and stones that the tiles' rules place on top of the grass, by chance.
const DECO = {
  tuft: ['................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '.....F..........', '...f.ef.F.......', '...efcef.f......', '..ecfccecfe.....', '..cccbcccbc.....'],
  flower: ['................', '................', '................', '................', '................', '................', '................', '................', '................', '..........ZZ....', '.........ZwwZ...', '..........ZZ....', '..........c.....', '.........ece....', '..........c.....', '.........cec....'],
  stone: ['................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '......nnN.......', '....lmmnnNm.....', '...jllmmmnml....', '...jjlllllmlj...'],
  mushroom: ['................', '................', '................', '................', '................', '................', '................', '................', '................', '................', '.......xZZ......', '......wxxZZ.....', '......vwwxx.....', '........NN......', '........nN......', '........nN......']
};
const tileFrames = [], tileAnimations = {};
// Every tile holds its greybox drawing until the tiles cue, then shows its art: an animation that plays from the
// scene's start and holds its last frame.
const swapAt = (name, greyOps, artOps) => {
  tileFrames.push({ name: `${name}-grey`, duration: CUE.tiles, ops: greyOps }, { name, duration: 100, ops: artOps });
  tileAnimations[`at-${name}`] = { frames: [`${name}-grey`, name], loop: false };
};
for (const m of CARDINAL) {
  swapAt(`ground-${m}`, [{ op: 'autotile', symbol: 'ground-grey', mask: m, mode: 'cardinal' }], [{ op: 'autotile', symbol: 'ground', mask: m, mode: 'cardinal' }]);
  swapAt(`slab-${m}`, [{ op: 'autotile', symbol: 'slab-grey', mask: m, mode: 'cardinal' }], [{ op: 'autotile', symbol: 'slab', mask: m, mode: 'cardinal' }]);
}
for (const [name, rows] of Object.entries(PIT)) swapAt(`pit-${name}`, [grid(0, 0, greyPit(rows))], [grid(0, 0, rows)]);
for (const [name, rows] of Object.entries(DECO)) swapAt(`deco-${name}`, [], [grid(0, 0, rows)]);
save('tiles.json', { version: 1, name: 'tiles', width: TILE, height: TILE, palette: tilePalette, ramps: tileRamps,
  symbols: { ground: groundTemplate(false), 'ground-grey': groundTemplate(true), slab: platformTemplate(false), 'slab-grey': platformTemplate(true) },
  frames: tileFrames, animations: tileAnimations });

// The level: 36 columns of 16 px from y = 72, so the ground's top row (row 6) is at y = 168. G ground, P stone slabs,
// v a pit and d its staked bottom. The empty top rows keep the slabs' tops open.
const MAP = [
  '....................................',
  '....................................',
  '.............................PPP....',
  '......PPP..PPP......................',
  '....................................',
  '...............GGG..................',
  'GGGGGGGGGvGGGGGGGGGGGGGGGvGGGGGGGGGG',
  'GGGGGGGGGvGGGGGGGGGGGGGGGvGGGGGGGGGG',
  'GGGGGGGGGdGGGGGGGGGGGGGGGdGGGGGGGGGG'
];
const MAP_Y = GROUND - 6 * TILE;

// ================================================================ props on the ground
// Lamp posts that light at dusk, bushes and a signpost: dressing that arrives with the tiles.
const propPalette = pal({ O: 'ink', a: 'gr0', b: 'gr1', c: 'gr2', e: 'gr3', f: 'gr4', F: 'gr5', v: 'd1', w: 'd2', x: 'd3', z: 'd4', Z: 'd5',
  i: 'k0', j: 'k1', l: 'k2', m: 'k3', n: 'k4', y: 'y2', Y: 'y3', W: 'y4', D: 'white', s: 'warm4' });
const propRamps = [['a', 'b', 'c', 'e', 'f', 'F'], ['v', 'w', 'x', 'z', 'Z'], ['i', 'j', 'l', 'm', 'n']];
const LAMP = {
  off: [
    '..iiiii..', '.ijjjjji.', 'ijlmmmlji', '.jsssssj.', '.jsYYYsj.', '.jsYYYsj.', '.jsssssj.', 'ijjjjjjji', '...jlj...',
    '...jlj...', '...jlj...', '...jlj...', '...jlj...', '...jlj...', '...jlj...', '...jlj...', '...jlj...', '...jlj...',
    '...jlj...', '...jlj...', '...jlj...', '...jlj...', '..ijllj..', '.ijjllmj.', 'iijjlllmi'
  ]
};
LAMP.on = LAMP.off.map((r, y) => (y >= 3 && y <= 6 ? r.replace(/s/g, 'Y').replace(/Y(?=YY)/, 'W').replace(/YYY/, 'WDW') : r));
const BUSH = [
  '......ccee..........',
  '....cceeffe..eef....',
  '...cceeeeffecceeff..',
  '..ccceeeeeeeeeeefFf.',
  '.bcccceeeeeeeeeeeff.',
  '.bbccccceeeeeeeeeef.',
  'abbbcccccceeeeeeeee.',
  'abbbbcccccccceeeeee.',
  '.aabbbbbcccccccccc..',
  '..aaabbbbbbbbbbbb...'
];
const SIGN = [
  'xxxxxxxxxxxx',
  'xzzzzzzzzzzx',
  'xzwwzwzwwzZx',
  'xzzzzzzzzzzx',
  'xxxxxxxxxxxx',
  '....wx......',
  '....wx......',
  '....wx......',
  '....wx......',
  '...vwxv.....'
];
// A lit lamp gets a dithered halo on a layer behind the post, so the post's outline stays its own.
const HALO = [{ op: 'dither', x: 0, y: 0, w: 24, h: 20, color: 'y', density: [0.55, 0], direction: 'radial', pattern: 'bayer4' },
  { op: 'dither', x: 5, y: 3, w: 14, h: 13, color: 'Y', density: [0.6, 0], direction: 'radial', pattern: 'bayer4' }];
save('props.json', { version: 1, name: 'props', width: 24, height: 30, palette: propPalette, ramps: propRamps, anchor: [12, 30], frames: [
  { name: 'lamp-off', duration: 100, ops: [grid(7, 5, LAMP.off), outline()] },
  { name: 'lamp-on', duration: 100, layers: [{ name: 'halo', ops: HALO }, { name: 'lamp', ops: [grid(7, 5, LAMP.on), outline()] }] },
  { name: 'bush', duration: 100, ops: [grid(2, 19, BUSH), outline()] },
  { name: 'sign', duration: 100, ops: [grid(6, 19, SIGN), { op: 'text', x: 8, y: 22, text: '>', color: 'Z' }, outline()] }
] });

// ================================================================ sky, sun, clouds and stars
// The backdrops keep their own colours under the scene's lights (lit: false), so lamp light stays on the ground.
// Their evening is palette cycling instead: a dusk and a night frame move every key one and two steps down its ramp.
const shiftPalette = (palette, ramps, steps) => {
  const map = {};
  for (const ramp of ramps) ramp.forEach((key, i) => { const j = Math.max(0, Math.min(ramp.length - 1, i + steps)); if (j !== i) map[key] = palette[ramp[j]]; });
  return map;
};
const withEvening = (palette, ramps, ops, night = 2) => [
  { name: 'day', ops },
  { name: 'dusk', palette: shiftPalette(palette, ramps, -1), ops },
  { name: 'night', palette: shiftPalette(palette, ramps, -night), ops }
];
// Bands of blue down to a warm horizon, joined by ordered dither.
const skyPalette = pal({ A: 'sky0', B: 'sky1', D: 'sky2', E: 'sky3', F: 'sky4', G: 'sky5', a: 'warm0', b: 'warm1', c: 'warm2', d: 'warm3', e: 'warm4', f: 'warm5' });
const skyRamps = [['A', 'B', 'D', 'E', 'F', 'G'], ['a', 'b', 'c', 'd', 'e', 'f']];
const BANDS = [['D', 0, 0], ['E', 50, 10], ['F', 88, 10], ['G', 116, 8], ['f', 138, 8], ['e', 156, 6]];
const skyOps = [rect(0, 0, W, H, 'D')];
for (const [key, y, fade] of BANDS.slice(1)) skyOps.push({ op: 'dither', x: 0, y: y - fade, w: W, h: fade, color: key, density: [0.1, 0.9], direction: 'down', pattern: 'bayer4' }, rect(0, y, W, H - y, key));
save('sky.json', { version: 1, name: 'sky', width: W, height: H, palette: skyPalette, ramps: skyRamps, frames: withEvening(skyPalette, skyRamps, skyOps) });
// The sun warms as it sets; it is drawn before the mountains, so it sinks behind them.
const sunPalette = pal({ a: 'warm3', b: 'warm4', c: 'warm5', d: 'white' });
const sunOps = [
  { op: 'ellipse', x: 0, y: 0, w: 26, h: 26, color: 'a' }, { op: 'ellipse', x: 2, y: 2, w: 22, h: 22, color: 'b' },
  { op: 'ellipse', x: 3, y: 3, w: 20, h: 20, color: 'c' }, { op: 'ellipse', x: 6, y: 5, w: 11, h: 10, color: 'd' }
];
save('sun.json', { version: 1, name: 'sun', width: 26, height: 26, palette: sunPalette, frames: [
  { name: 'day', ops: sunOps },
  { name: 'setting', palette: { a: C.warm1, b: C.warm2, c: C.warm3, d: C.warm4 }, ops: sunOps }
] });
// Clouds: rounded lumps with a lit crown and a flat, shaded underside. At sunset they catch the warm light.
const cloudPalette = pal({ a: 'sky3', b: 'sky4', c: 'sky5', d: 'white' });
function cloud(cx, cy, lumps) {
  const ops = [];
  for (const [dx, dy, w, h] of lumps) ops.push({ op: 'ellipse', x: cx + dx, y: cy + dy, w, h, color: 'c' });
  for (const [dx, dy, w, h] of lumps) ops.push({ op: 'ellipse', x: cx + dx + 2, y: cy + dy, w: w - 4, h: h - 4, color: 'd' });
  const bottom = Math.max(...lumps.map(([, dy, , h]) => dy + h)), right = Math.max(...lumps.map(([dx, , w]) => dx + w));
  ops.push({ op: 'shade', x: cx, y: cy + bottom - 4, w: right, h: 3, steps: -1 }, { op: 'clear', x: cx, y: cy + bottom - 1, w: right, h: 1 });
  return ops;
}
const cloudOps = [
  ...cloud(14, 14, [[0, 8, 22, 10], [10, 2, 18, 14], [22, 6, 20, 12], [34, 10, 14, 8]]),
  ...cloud(112, 4, [[0, 6, 16, 8], [8, 0, 16, 12], [18, 4, 14, 10]]),
  ...cloud(170, 30, [[0, 6, 26, 10], [14, 0, 22, 14], [30, 5, 24, 11], [46, 9, 14, 7]])
];
save('clouds.json', { version: 1, name: 'clouds', width: 256, height: 52, palette: cloudPalette, ramps: [['a', 'b', 'c', 'd']], frames: [
  { name: 'day', ops: cloudOps },
  { name: 'dusk', palette: { a: C.warm1, b: C.warm3, c: C.warm4, d: C.warm5 }, ops: cloudOps },
  { name: 'night', palette: { a: C.warm0, b: C.warm1, c: C.warm2, d: C.warm3 }, ops: cloudOps }
] });
// Stars come out last; two frames swap which ones are bright.
const starPalette = pal({ a: 'sky4', b: 'white' });
const STARS = Array.from({ length: 28 }, (_, i) => [Math.floor(hash(i, 1, 11) * W), 40 + Math.floor(hash(i, 2, 11) * 56), hash(i, 3, 11) < 0.5]);
save('stars.json', { version: 1, name: 'stars', width: W, height: 100, palette: starPalette, frames: [0, 1].map(phase => ({ name: `twinkle-${phase}`, duration: 300,
  ops: STARS.map(([x, y, odd]) => ({ op: 'pixel', x, y, color: odd === Boolean(phase) ? 'b' : 'a' })) })),
  animations: { twinkle: { frames: ['twinkle-0', 'twinkle-1'] } } });

// ================================================================ the far plane: mountains and a castle
// Peaks are a deterministic ridge, 256 px periodic so `repeat` joins it. Faces toward the setting sun (right) are lit;
// the scene's haze then fades every colour toward the sky as a whole.
const farPalette = pal({ a: 'm0', b: 'm1', c: 'm2', d: 'm3', e: 'm4', f: 'm5', q: 'r0', r: 'r1', R: 'r2', w: 'm1' });
const farRamps = [['a', 'b', 'c', 'd', 'e', 'f'], ['q', 'r', 'R']];
const FAR_W = 256, FAR_H = 112;
const PEAKS = [[18, 66, 1.1], [64, 46, 0.9], [118, 80, 1.15], [176, 54, 1.0], [226, 72, 1.15]];
function ridge(x) {
  let best = 0, owner = PEAKS[0];
  for (const peak of PEAKS) for (const shift of [-FAR_W, 0, FAR_W]) {
    const dx = x - (peak[0] + shift), h = peak[1] - Math.abs(dx) * peak[2] + (hash(Math.floor((x + 512) / 3), 1, 2) < 0.3 ? 1 : 0);
    if (h > best) { best = h; owner = [peak[0] + shift, peak[1], peak[2]]; }
  }
  return { h: best, owner };
}
const farRows = field(FAR_W, FAR_H, (x, y) => {
  const { h, owner } = ridge(x), top = FAR_H - h;
  if (y < top) return '.';
  const lit = x >= owner[0], depth = y - top, snow = owner[1] - 14 - (hash(x >> 1, 7) < 0.5 ? 0 : 2);
  if (owner[1] > 60 && FAR_H - y > snow) return lit ? 'f' : 'e';
  if (y > FAR_H - 20) return y > FAR_H - 12 ? 'b' : lit ? 'c' : 'b';
  return lit ? (depth < 2 ? 'e' : 'd') : depth < 1 ? 'd' : 'c';
});
// The castle on the tallest peak: two towers with spires and a keep between them. `w` marks the windows that light up.
const CASTLE = [
  '.....R................R.....',
  '.....R................R.....',
  '....RRr..............RRr....',
  '....RRr..............RRr....',
  '...RRRrr............RRRrr...',
  '...RRRrr.....R......RRRrr...',
  '..RRRRrrr...RRr....RRRRrrr..',
  '..qqqqqqq..RRRrr...qqqqqqq..',
  '..dddddcc.qqqqqqq..dddddcc..',
  '..dddwdcc.d.d.d.c..ddwdddc..',
  '..dddddcc.ddddddc..dddddcc..',
  '..dddddcc.ddwddcc..dddddcc..',
  '..dddwdcc.ddddddc..ddwdddc..',
  '..dddddccdddddddcdddddddcc..',
  '..dddddccddddwdddcdddddddc..',
  '.ddddddcccdddddddccddddddcc.',
  'dddddddccccdddddddcccddddddc'
];
// It sits into the peak, its foot where the slopes meet its outer walls.
const CASTLE_AT = [104, FAR_H - 80 + 16 - CASTLE.length];
save('far.json', { version: 1, name: 'far', width: FAR_W, height: FAR_H, palette: farPalette, ramps: farRamps,
  frames: withEvening(farPalette, farRamps, [grid(0, 0, farRows), grid(...CASTLE_AT, CASTLE)], 3) });

// ================================================================ the near plane: a village on a hill
// A rolling hill line, 256 px periodic; trees stand on it and houses sit into it.
const nearPalette = pal({ a: 't0', b: 't1', c: 't2', d: 't3', e: 't4', q: 'r0', r: 'r1', s: 'r2', u: 'r3', U: 'r4',
  h: 'h0', i: 'h1', j: 'h2', k: 'h3', l: 'h4', w: 'b0', W: 'b1', o: 'd1', p: 'd2' });
const nearRamps = [['a', 'b', 'c', 'd', 'e'], ['q', 'r', 's', 'u', 'U'], ['h', 'i', 'j', 'k', 'l'], ['o', 'p'], ['w', 'W']];
const NEAR_W = 256, NEAR_H = 96;
const HILL = [70, 62, 60, 66, 72, 66, 58, 64];
const hillTop = x => {
  const span = NEAR_W / HILL.length, i = Math.floor(((x % NEAR_W) + NEAR_W) % NEAR_W / span), t = ((((x % NEAR_W) + NEAR_W) % NEAR_W) - i * span) / span;
  const a = HILL[i], b = HILL[(i + 1) % HILL.length];
  return Math.round(a + (b - a) * t * t * (3 - 2 * t));
};
const hillRows = field(NEAR_W, NEAR_H, (x, y) => {
  const top = hillTop(x);
  if (y < top) return '.';
  const facing = hillTop(x + 2) < hillTop(x - 2) ? 'sun' : 'away', depth = y - top;
  if (depth === 0) return facing === 'sun' ? 'e' : 'd';
  if (depth < 3) return 'c';
  if (depth < 14) return hash(x, y, 4) < 0.04 ? 'c' : 'b';
  return y % 2 === x % 2 ? 'a' : 'b';
});
const TREE = [
  '......bbcc......',
  '....bbcccdcc....',
  '...bbcccddddc...',
  '..bbccccdddddc..',
  '.bbbcccccddddec.',
  '.bbbbcccccdddde.',
  'abbbbbcccccdddd.',
  'abbbbbbccccccdd.',
  '.abbbbbbbcccccd.',
  '..abbbbbbbbbcc..',
  '...aabbbbbbbb...',
  '.....aaoopaa....',
  '.......op.......',
  '.......op.......'
];
const PINE = ['....c....', '...bcd...', '...bcd...', '..bbccd..', '..bbcdd..', '.bbbccdd.', '..bbccd..', '.bbbbcdd.', 'bbbbbccdd', '.abbbbcc.', 'aabbbbccd', '....op...', '....op...'];
const HOUSE = [
  '.......qq.........',
  '......qrrq........',
  '.....qrrsUq.......',
  '....qrrssuUq......',
  '...qrrrssuuUq.....',
  '..qrrrsssuuuUq....',
  '.qrrrssssuuuuUq...',
  'qqqqqqqqqqqqqqqq..',
  '.hiiijjjjjkkkkh...',
  '.hiwwijjjjkwwkh...',
  '.hiWwijjjjkWwkh...',
  '.hiiijjjjjkkkkh...',
  '.hiiijjoojkkkkh...',
  '.hiiijjoojkkkkh...',
  '.hhhhhhoohhhhhh...'
];
// Stand a drawing on the hill: its bottom row sinks `sink` rows below the hill line under its middle.
const onHill = (x, rows, sink, extra = {}) => grid(x, hillTop(x + (rows[0].length >> 1)) + sink - rows.length, rows, extra);
const houses = [[40, false], [118, false], [176, true]];
const nearOps = [
  ...[[4, PINE], [22, TREE], [98, TREE], [150, PINE], [204, TREE], [240, PINE]].map(([x, rows]) => onHill(x, rows, 1)),
  ...houses.map(([x, flipX]) => onHill(x, HOUSE, 3, { flipX })),
  grid(0, 0, hillRows),
  ...[[72, PINE], [226, TREE]].map(([x, rows]) => onHill(x, rows, 2))
];
// The windows' panes in near-plane pixels, read from the drawing, so the glows always sit on them.
const NEAR_WINDOWS = houses.flatMap(([x, flipX]) => {
  const top = hillTop(x + (HOUSE[0].length >> 1)) + 3 - HOUSE.length, panes = [];
  HOUSE.forEach((row, y) => [...row].forEach((ch, col) => { if (ch === 'w' && (flipX ? row[col + 1] : row[col - 1]) !== 'w') panes.push([x + (flipX ? HOUSE[0].length - 1 - col : col), top + y]); }));
  return panes;
});
save('near.json', { version: 1, name: 'near', width: NEAR_W, height: NEAR_H, palette: nearPalette, ramps: nearRamps, frames: withEvening(nearPalette, nearRamps, nearOps) });

// Window glows, lit one after another: frame n shows the first n panes. They keep their colours in the scene.
const glowPalette = pal({ a: 'y2', b: 'y3', c: 'y4' });
const glowRecipe = (name, width, height, panes, size) => ({ version: 1, name, width, height, palette: glowPalette,
  frames: panes.map((_, n) => ({ name: `lit-${n + 1}`, duration: n === panes.length - 1 ? 100 : 200,
    ops: panes.slice(0, n + 1).flatMap(([x, y]) => [rect(x, y, size[0], size[1], 'b'), { op: 'pixel', x, y, color: 'c' }]) })),
  animations: { on: { frames: panes.map((_, n) => `lit-${n + 1}`), loop: false } } });
save('near-glow.json', glowRecipe('near-glow', NEAR_W, NEAR_H, NEAR_WINDOWS, [2, 2]));
const CASTLE_WINDOWS = CASTLE.flatMap((row, y) => [...row].flatMap((ch, x) => (ch === 'w' ? [[CASTLE_AT[0] + x, CASTLE_AT[1] + y]] : [])));
save('far-glow.json', glowRecipe('far-glow', FAR_W, FAR_H, CASTLE_WINDOWS, [1, 1]));

// ================================================================ greybox backdrops
const greyPalette = pal({ '1': 'g1', '2': 'g2', '3': 'g3', '4': 'g4', '5': 'g5', '6': 'g6' });
const blocks = (list, fill, edge) => list.flatMap(([x, y, w, h]) => [rect(x, y, w, h, fill), rect(x, y, w, h, edge, { filled: false })]);
save('grey-far.json', { version: 1, name: 'grey-far', width: FAR_W, height: FAR_H, palette: greyPalette, frames: [{ name: 'far', ops: blocks(
  [[0, 50, 40, 62], [36, 70, 50, 42], [84, 28, 50, 84], [130, 60, 46, 52], [172, 52, 30, 60], [198, 40, 58, 72]], '6', '5') }] });
save('grey-near.json', { version: 1, name: 'grey-near', width: NEAR_W, height: NEAR_H, palette: greyPalette, frames: [{ name: 'near', ops: blocks(
  [[0, 62, 20, 34], [22, 50, 26, 46], [40, 64, 30, 32], [72, 62, 14, 34], [96, 52, 24, 44], [118, 60, 30, 36], [150, 56, 14, 40], [170, 66, 30, 30], [200, 52, 26, 44], [234, 58, 22, 38]], '4', '3') }] });

// ================================================================ captions
// One frame per stage on a dark label: the stage's number and name, and underneath what it uses; then the credit.
const capPalette = pal({ O: 'ink', e: '#3a3452', w: 'white', y: 'y3', s: 'g5' });
const captionFrame = (stage, i) => {
  const counter = stage.credit ? '' : `${i + 1}/${STAGES.length}`, counterW = counter ? measureText(counter).width + 6 : 0, titleW = measureText(stage.title).width * 2;
  const lineW = counterW + titleW, panelW = Math.max(lineW, measureText(stage.note).width) + 18, x = Math.floor((W - panelW) / 2), lineX = x + Math.floor((panelW - lineW) / 2);
  return { name: stage.cue, duration: 100, ops: [
    rect(x, 0, panelW, 33, 'O'), rect(x + 1, 1, panelW - 2, 31, 'e', { filled: false }),
    ...[[x, 0], [x + panelW - 1, 0], [x, 32], [x + panelW - 1, 32]].map(([px, py]) => ({ op: 'clear', x: px, y: py, w: 1, h: 1 })),
    ...(counter ? [{ op: 'text', x: lineX, y: 8, text: counter, color: 'y' }] : []),
    { op: 'text', x: lineX + counterW, y: 4, text: stage.title, color: stage.credit ? 'y' : 'w', scale: 2 },
    { op: 'text', x: W / 2, y: 22, text: stage.note, color: 's', align: 'center' }
  ] };
};
save('caption.json', { version: 1, name: 'caption', width: W, height: 33, palette: capPalette, frames: CAPTIONS.map(captionFrame) });

// ================================================================ the scene
// Hero choreography: run at the camera's speed; jump the first pit, hop up onto the raised ground, drop off its end,
// jump the slime through two coins, then jump the second pit.
const JUMP = 800;
const jumps = [
  { time: Math.round((9 * TILE - 5 - HERO_X) / SPEED * 1000), from: 0, to: 0, height: 22 },
  { time: 5200, from: 0, to: 16, height: 30 },
  { time: 8500, from: 0, to: 0, height: 28 },
  { time: Math.round((25 * TILE - 5 - HERO_X) / SPEED * 1000), from: 0, to: 0, height: 22 }
];
const DROP = Math.round((18 * TILE + 3 - HERO_X) / SPEED * 1000);
const lift = [{ time: 0, height: 0 }];
const heroCues = [{ time: CUE.player, animation: 'run' }];
for (const j of jumps) {
  lift.push({ time: j.time, height: j.from, ease: 'out' }, { time: j.time + JUMP / 2, height: j.from + j.height, ease: 'in' }, { time: j.time + JUMP, height: j.to });
  heroCues.push({ time: j.time, animation: 'jump' }, { time: j.time + JUMP, animation: 'run' });
}
lift.push({ time: DROP, height: 16, ease: 'in' }, { time: DROP + 300, height: 0 });
heroCues.push({ time: DROP, animation: 'drop' }, { time: DROP + 300, animation: 'run' });
lift.sort((a, b) => a.time - b.time); heroCues.sort((a, b) => a.time - b.time);
// The hero's lift at a time, with the scene's own eases, so coins sit on the arc.
const liftAt = ms => {
  for (let i = 1; i < lift.length; i++) if (ms <= lift[i].time) {
    const a = lift[i - 1], b = lift[i], f = (ms - a.time) / (b.time - a.time);
    return a.height + (b.height - a.height) * ease(a.ease ?? 'linear', f);
  }
  return 0;
};
const coins = [];
// Two coins along each of three jumps, picked up as the hero passes through them.
for (const index of [0, 2, 3]) for (const offset of [180, 620]) {
  const time = jumps[index].time + offset;
  coins.push({ at: [Math.round(heroX(time)), Math.round(GROUND - liftAt(time) - 13)], collect: time });
}
for (const time of [11200, 11550]) coins.push({ at: [Math.round(heroX(time)), GROUND - 13], collect: time });
// Three on each slab, never collected.
for (const [col, row] of [[6, 3], [11, 3], [29, 2]]) for (let i = 0; i < 3; i++) coins.push({ at: [col * TILE + 8 + i * 16, MAP_Y + row * TILE - 8] });
const coinInstances = coins.map((coin, i) => {
  const sequence = [];
  if (!coin.collect || coin.collect > CUE.actors) sequence.push({ time: CUE.actors, animation: 'spin' });
  if (coin.collect) sequence.push(...(coin.collect > CUE.actors ? [{ time: coin.collect, animation: 'collect' }, { time: Math.min(coin.collect + 400, DURATION - 1), hide: true }] : [{ time: coin.collect, hide: true }]));
  return { name: `coin-${i + 1}`, asset: 'coin', frame: 'grey', at: coin.at, anchor: 'frame', lit: false, ...(sequence.length && { sequence }) };
});
// The slime hops left at 12 px/s and is under the top of the hero's third jump.
const slimeApex = jumps[2].time + JUMP / 2, slimeX0 = Math.round(heroX(slimeApex) + 12 * slimeApex / 1000);
const parallaxRepeat = (count, width) => ({ repeat: [count, 1], step: [width, 0] });
// A backdrop's frames over the reel: hidden until its stage, then day, dusk and night as the sun sets.
const evening = (stage, day = 'day', dusk = CUE.light + 300, night = CUE.light + 1100) => ({ hidden: true, lit: false,
  sequence: [{ time: CUE[stage], frame: day }, { time: dusk, frame: 'dusk' }, { time: night, frame: 'night' }] });
const FAR_Y = GROUND + 2 - FAR_H, NEAR_Y = GROUND + 2 - NEAR_H;
const instances = [
  { name: 'sky', asset: 'sky', at: [0, 0], parallax: 0, ...evening('sky') },
  { name: 'stars', asset: 'stars', at: [0, 0], parallax: 0, lit: false, hidden: true, sequence: [{ time: CUE.light + 1500, animation: 'twinkle' }] },
  // The sun sets in the gap between the clouds, behind a peak of the far plane.
  { name: 'sun', asset: 'sun', at: [94, 66], parallax: 0, lit: false, hidden: true, sequence: [{ time: CUE.sky, frame: 'day' }, { time: CUE.light + 600, frame: 'setting' }],
    trajectory: [{ time: 0, at: [94, 66], ease: 'hold' }, { time: CUE.light, at: [94, 66], ease: 'in' }, { time: CUE.light + 2600, at: [94, 150] }] },
  { name: 'clouds', asset: 'clouds', at: [0, 40], parallax: 0.1, ...parallaxRepeat(2, 256), ...evening('sky') },
  { name: 'grey-far', asset: 'grey-far', at: [0, FAR_Y], parallax: 0.25, ...parallaxRepeat(2, FAR_W), sequence: [{ time: CUE.far, hide: true }] },
  { name: 'far', asset: 'far', at: [0, FAR_Y], parallax: 0.25, haze: 0.35, ...parallaxRepeat(2, FAR_W), ...evening('far') },
  { name: 'far-glow', asset: 'far-glow', at: [0, FAR_Y], parallax: 0.25, haze: 0.2, lit: false, ...parallaxRepeat(2, FAR_W), hidden: true, sequence: [{ time: CUE.light + 1000, animation: 'on' }] },
  { name: 'grey-near', asset: 'grey-near', at: [0, NEAR_Y], parallax: 0.5, ...parallaxRepeat(2, NEAR_W), sequence: [{ time: CUE.near, hide: true }] },
  { name: 'near', asset: 'near', at: [0, NEAR_Y], parallax: 0.5, haze: 0.15, ...parallaxRepeat(2, NEAR_W), ...evening('near') },
  { name: 'near-glow', asset: 'near-glow', at: [0, NEAR_Y], parallax: 0.5, lit: false, ...parallaxRepeat(2, NEAR_W), hidden: true, sequence: [{ time: CUE.light + 500, animation: 'on' }] },
  { name: 'level', asset: 'tiles', at: [0, MAP_Y], tilemap: { rows: MAP, outside: 'match', empty: '_', legend: {
    G: { rules: [
      { animation: 'at-ground-{mask}', autotile: 'cardinal' },
      { where: ['._.', '...', '...'], animations: ['at-deco-tuft', 'at-deco-flower', 'at-deco-stone', 'at-deco-mushroom'], weights: [5, 2, 1, 1], chance: 0.35, offset: [0, -1] }
    ] },
    P: { animation: 'at-slab-{mask}', autotile: 'cardinal' },
    v: { rules: [{ where: ['._.', '...', '...'], animation: 'at-pit-top', stop: true }, { animation: 'at-pit-deep' }] },
    d: { animation: 'at-pit-stakes' }
  } } },
  ...[[3, 'bush'], [14, 'lamp'], [23, 'sign'], [27, 'bush'], [31, 'lamp']].map(([col, frame], i) => ({ name: `${frame}-${i + 1}`, asset: 'props', at: [col * TILE + 8, GROUND], anchor: 'frame', hidden: true,
    sequence: frame === 'lamp' ? [{ time: CUE.tiles, frame: 'lamp-off' }, { time: CUE.light + 400 + i * 60, frame: 'lamp-on' }] : [{ time: CUE.tiles, frame }] })),
  ...coinInstances,
  { name: 'slime', asset: 'slime', frame: 'grey', at: [slimeX0, GROUND], anchor: 'frame', sequence: [{ time: CUE.actors, animation: 'hop' }],
    trajectory: [{ time: 0, at: [slimeX0, GROUND] }, { time: DURATION - 1, at: [slimeX0 - Math.round(12 * (DURATION - 1) / 1000), GROUND] }] },
  { name: 'slime-2', asset: 'slime', frame: 'grey', at: [7 * TILE + 8, MAP_Y + 3 * TILE], anchor: 'frame', sequence: [{ time: CUE.actors, animation: 'hop' }] },
  { name: 'hero', asset: 'hero', frame: 'grey', at: [HERO_X, GROUND], anchor: 'frame', sequence: heroCues, lift,
    trajectory: [{ time: 0, at: [HERO_X, GROUND] }, { time: DURATION - 1, at: [Math.round(heroX(DURATION - 1)), GROUND] }] },
  { name: 'wisp', asset: 'wisp', at: [-6, -4], anchor: 'frame', lit: false, attach: { instance: 'hero', point: 'wisp' }, hidden: true, sequence: [{ time: CUE.light + 300, animation: 'glow' }] },
  ...CAPTIONS.map((stage, i) => {
    const next = CAPTIONS[i + 1], start = stage.time;
    return { name: `caption-${stage.cue}`, asset: 'caption', at: [0, 4], parallax: 0, lit: false, hidden: true,
      sequence: [{ time: start, frame: stage.cue }, ...(next ? [{ time: next.time, hide: true }] : [])],
      trajectory: [...(start ? [{ time: 0, at: [0, -36], ease: 'hold' }] : []), { time: start, at: [0, -36], ease: 'out' }, { time: start + 250, at: [0, 4] }] };
  })
];
const lights = [
  // An overhead fill (a sun straight above casts no shadows) keeps every lit colour as drawn until the lighting cue.
  { sun: [0, 0], strength: 0.75, keys: [{ time: 'light', strength: 0.75 }, { time: 'light+1000', strength: 0 }] },
  // The setting sun, low on the right.
  { sun: [-1.2, 0.2], strength: 0, color: '#ffd8a8', keys: [{ time: 'light', strength: 0 }, { time: 'light+1000', strength: 0.3 }] },
  { follow: { instance: 'wisp' }, at: [0, -26], height: 12, radius: 48, strength: 0, color: '#fff0c0', flicker: { amount: 0.2, every: 120, seed: 3 },
    keys: [{ time: 'light+300', strength: 0 }, { time: 'light+700', strength: 1.8 }] },
  ...['lamp-2', 'lamp-5'].map((instance, i) => ({ follow: { instance }, at: [0, -21], height: 14, radius: 40, strength: 0, color: '#ffe0a0', flicker: { amount: 0.15, every: 100, seed: 7 + i },
    keys: [{ time: `light+${400 + (i ? 4 : 1) * 60}`, strength: 0 }, { time: `light+${500 + (i ? 4 : 1) * 60}`, strength: 2 }] }))
];
save('reel.scene.json', { format: 'pixelforge-scene', version: 1, name: 'greybox-reel', width: W, height: H, duration: DURATION, background: C.g7,
  cues: Object.fromEntries(STAGES.filter(s => s.time).map(s => [s.cue, s.time])),
  camera: [{ time: 0, at: [0, 0] }, { time: DURATION - 1, at: [Math.round(SPEED * (DURATION - 1) / 1000), 0] }],
  haze: { color: '#b9bfe0' },
  lighting: { mode: 'ramp', scope: 'all', ambient: 0.25, bands: 5, steps: 3, lights },
  assets: { sky: 'sky.json', stars: 'stars.json', sun: 'sun.json', clouds: 'clouds.json', far: 'far.json', 'far-glow': 'far-glow.json', near: 'near.json', 'near-glow': 'near-glow.json',
    'grey-far': 'grey-far.json', 'grey-near': 'grey-near.json', tiles: 'tiles.json', props: 'props.json', coin: 'coin.json', slime: 'slime.json', hero: 'hero.json', wisp: 'wisp.json', caption: 'caption.json' },
  instances });

// ---------------------------------------------------------------- a contact sheet of the stages, for the README
// Each stage a moment after its cue, at 1×, four to a row.
const sceneDoc = docs['reel.scene.json'];
const prepared = prepareScene({ ...sceneDoc, assets: Object.fromEntries(Object.entries(sceneDoc.assets).map(([id, file]) => [id, docs[file]])) });
const SHEET_TIMES = [700, 2100, 3400, 4700, 6000, 7300, 8700, 10400], GAP = 2, COLUMNS = 4;
const sheetW = COLUMNS * W + (COLUMNS + 1) * GAP, sheetH = 2 * H + 3 * GAP, sheet = new Uint8ClampedArray(sheetW * sheetH * 4);
for (let i = 0; i < sheet.length; i += 4) sheet.set([0x1b, 0x16, 0x26, 255], i);
SHEET_TIMES.forEach((time, i) => {
  const view = renderScene(prepared, { time }), left = GAP + (i % COLUMNS) * (W + GAP), top = GAP + Math.floor(i / COLUMNS) * (H + GAP);
  if (view.warnings.length) throw new Error(`The scene warns at ${time} ms: ${view.warnings.join('; ')}`);
  for (let y = 0; y < H; y++) sheet.set(view.data.subarray(y * W * 4, (y + 1) * W * 4), ((top + y) * sheetW + left) * 4);
});
save('stages.png', Buffer.from(encodePNG(sheet, sheetW, sheetH)));

if (check) { console.log(differing.length ? `Out of date: ${differing.join(', ')}` : 'All greybox reel sources match build.mjs.'); process.exitCode = differing.length ? 1 : 0; }
else console.log(JSON.stringify({ ok: true, directory: out, files: written }));

// ---------------------------------------------------------------- the reel itself (not committed: large binaries)
if (reel && !check) {
  const target = path.resolve(args[args.indexOf('--reel') + 1]?.startsWith('--') === false ? args[args.indexOf('--reel') + 1] : path.join(root, 'output', 'greybox-reel'));
  const cli = (...rest) => execFileSync(process.execPath, [path.join(root, 'bin', 'pixelbolt.js'), ...rest], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
  const scene = path.join(out, 'reel.scene.json');
  cli('sequence', scene, '--out', path.join(target, 'frames'), '--fps', '30', '--size', '1080x1080', ...(force ? ['--force'] : []));
  cli('sequence', scene, '--out', path.join(target, 'frames-432'), '--fps', '30', '--size', '432x432', ...(force ? ['--force'] : []));
  console.log(cli('gif-frames', path.join(target, 'frames-432'), '--fps', '30', '--out', path.join(target, 'greybox-reel.gif'), ...(force ? ['--force'] : [])));
  console.log(`Frames in ${path.join(target, 'frames')}; encode the MP4 with the ffmpeg command in its README (see this folder's README).`);
}
