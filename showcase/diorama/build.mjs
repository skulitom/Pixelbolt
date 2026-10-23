// Diorama study: an original 3/4 top-down dungeon room, a floating "diorama" of 8 px tiles. It began as a test of what
// that style asks of Pixelbolt (docs/reports/diorama-feasibility-2026-10-07.md) and now uses the features the test
// called for: the room is one recipe whose `tilemap` operation draws walls, faces, cliffs, water and bricks by rules;
// moss is smooth value noise over the real floor; shadows move colours along palette ramps; the scene sorts actors by
// ground, attaches the smear and the hero's shadow, writes the strike's times once and re-themes by palette file.
//
// Usage: node showcase/diorama/build.mjs [--force | --check]
// Writes ordinary Pixelbolt sources into art/. This script is authoritative; the written files are its output.
// Existing files are kept unless --force is passed; --check compares without writing.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { compileEffects } from '../../src/fx.js';
import { formatJSON } from '../../src/export.js';

const force = process.argv.includes('--force'), check = process.argv.includes('--check');
const out = fileURLToPath(new URL('art/', import.meta.url));
const written = [], differing = [];
function save(name, value) {
  const target = path.join(out, name), text = formatJSON(value);
  if (check) { if (!existsSync(target) || readFileSync(target, 'utf8') !== text) differing.push(name); return; }
  if (existsSync(target) && !force) throw new Error(`Refusing to overwrite ${target}; pass --force`);
  mkdirSync(out, { recursive: true });
  writeFileSync(target, text);
  written.push(name);
}

// ---------------------------------------------------------------- palette: 31 colours and their ramps
const palette = {
  k: '#0d0f16', K: '#171a24', // void and outline, the island's underside
  s: '#26282f', t: '#3a3a40', // wall face dark, wall face
  u: '#57534d', v: '#7a7262', w: '#9f977c', // cap shade, cap, cap light
  f: '#2e2f35', g: '#3c3d43', h: '#48484d', // floor shadow, floor, floor light
  r: '#3f2629', q: '#6b3731', p: '#8f5141', // brick and clay
  m: '#353d23', n: '#525c2d', o: '#73803a', // moss
  b: '#1c3350', c: '#27507a', d: '#3e76a0', e: '#88b6cf', E: '#d6ecf0', // water and foam
  1: '#27507a', 2: '#27507a', // water sparkles, cycled by the room's frames
  x: '#45291f', y: '#73462c', z: '#a3703d', G: '#d1ad5c', // wood and brass
  l: '#a9a08a', L: '#e3ddcb', // bone, cloth light
  F: '#e2703a', Y: '#fbc95e', W: '#fff3c2', // flame
  R: '#8a2d3a' // red cloth
};
// Ramps run dark to light: a shadow moves a colour one step down its own ramp, so it is right on stone, floor, moss,
// brick or wood alike, and ramp lighting keeps the palette.
const ramps = [['k', 'K', 's', 't', 'u', 'v', 'w'], ['f', 'g', 'h'], ['r', 'q', 'p'], ['m', 'n', 'o'], ['b', 'c', 'd', 'e', 'E'], ['x', 'y', 'z', 'G'], ['l', 'L'], ['F', 'Y', 'W']];
save('palette.json', { palette, ramps });
// The blue theme: the same keys, eight of them recoloured. A scene applies it with "palette": "palette-blue.json".
save('palette-blue.json', { s: '#1f2a36', t: '#2c3d4f', u: '#3f5a6e', v: '#5b7f93', w: '#83a6b4', f: '#2f2723', g: '#40342c', h: '#4e4136' });
const P = { $ref: 'palette.json' };

// ---------------------------------------------------------------- blob templates
// A blob autotile template is two 8 px tiles wide and three tall. Fill quarters come from the island's centre shifted
// by a quarter, so an 8-periodic interior pattern always lines up; `edge` decides the island's rim.
function blobTemplate(pattern, edge) {
  const g = Array.from({ length: 24 }, () => Array(16).fill('.'));
  const pat = (x, y) => pattern[y % 8][x % 8];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) g[y][x] = pat(x, y);
  // inner-corner tile (x 8-15, y 0-7): each quadrant's corner pixel faces the open diagonal
  g[0][8] = g[0][15] = g[7][8] = g[7][15] = 'k';
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const edgeX = x === 0 || x === 15, edgeY = y === 0 || y === 15;
    g[8 + y][x] = edgeX && edgeY ? '.' : edgeX || edgeY ? 'k' : edge(x, y, pat);
  }
  return g.map(row => row.join(''));
}
// Wall caps: staggered stone blocks with a lit rim inside the top edge and a shaded rim inside the bottom edge, and a
// cracked, mossy variant with the same edges.
const capEdge = (x, y, pat) => y === 1 ? 'w' : y === 14 ? 'u' : pat(x, y);
// Water sits below the floor: the pool's own north wall goes down into it, a dark reflection lies under that wall and
// a lit rim runs along the other sides. Keys 1 and 2 are sparkles that the room's frames cycle.
const waterEdge = (x, y, pat) => y === 1 ? 't' : y === 2 ? 's' : y === 3 ? (x === 1 || x === 14 ? 'd' : 'b') : x === 1 || x === 14 || y === 14 ? 'd' : pat(x, y);
const symbols = {
  cap: blobTemplate(['wwwwwwwu', 'vvvvvvvu', 'vvvvrvvu', 'uuuuuuuu', 'wwwuwwww', 'vvvuvvvv', 'vrvuvvvv', 'uuuuuuuu'], capEdge),
  cracked: blobTemplate(['wwwwwwwu', 'vvvkvvvu', 'vvvvkvvu', 'uuuuuuuu', 'wwwuwwnw', 'vvvuvnov', 'vrvuvvnv', 'uuuuuuuu'], capEdge),
  water: blobTemplate(['cccccccc', 'ccccc1cc', 'cccccccc', 'cccccccc', 'cc2ccccc', 'cccccccc', 'cccccc1c', 'cccccccc'], waterEdge),
  // 8 px floor tiles and worn brick patches
  'floor-0': Array(8).fill('gggggggg'),
  'floor-1': ['gggggggg', 'gggggggg', 'gggfgggg', 'ggggfggg', 'gggfhggg', 'gggggggg', 'gggggggg', 'gggggggg'],
  'floor-2': ['gggggggg', 'gghggggg', 'ggfggggg', 'gggggggg', 'gggggggg', 'gggggghg', 'ggggggfg', 'gggggggg'],
  'floor-3': ['gggggggg', 'gggggggg', 'gggggggg', 'gggggfgg', 'gggggggg', 'gggggggg', 'gggggggg', 'gggggggg'],
  'brick-0': ['grrrrrgg', 'grhggrgg', 'grrrrrrr', 'ggggrhgr', 'ggrrrrrr', 'ggrhggrg', 'ggrrrrrg', 'gggggggg'],
  'brick-1': ['gggggggg', 'rrrrrggg', 'gggrhrgg', 'rrrrrrrg', 'grhgggrg', 'grrrrrrg', 'gggggggg', 'gggggggg'],
  // A wall's north face, drawn into the cell below it, ending in a contact line and a strip of shadow.
  'nface-0': ['tttsttts', 'tttsttts', 'ssssssss', 'tsttttst', 'tsttttst', 'kkkkkkkk', 'ffffffff', '........'],
  'nface-1': ['ttttstts', 'ttttstts', 'ssssssss', 'tttsttst', 'tttsttst', 'kkkkkkkk', 'ffffffff', '........'],
  // The island's outer face, hanging into the void below its south edge.
  'cliff-0': ['tttsttts', 'ssssssss', 'tsttttst', 'ssssssss', 'KKKKKKKK', 'k.k.k.k.', '........', '........'],
  'cliff-1': ['ttttstts', 'ssssssss', 'tttsttst', 'ssssssss', 'KKKKKKKK', '.k.k.k.k', '........', '........'],
  // Flat floor decals, placed freely so worn bricks, planks and bones straddle tile edges.
  'bricks-a': ['.rrrrr.rrrr', 'rrhgrrrghr.', '.rrrrrrrrrr', '..rghrr.rgr', '..rrrr..rrr'],
  'bricks-b': ['rrrr.rrr', 'rghrrghr', 'rrrrrrrr', '.rrhgr..', '.rrrrr..'],
  'bricks-c': ['.rrrrrr', '.rghrhr', 'rrrrrrr', 'rhgr...', 'rrrr...'],
  plank: ['.kkkkk', 'kyzzyk', 'kkkkk.'],
  'plank-d': ['..kk.', '.kzyk', 'kzyk.', 'kyk..', '.k...'],
  bones: ['.l...L', 'lLLl.l', '..l.kk'],
  skull: ['.kkk.', 'kLLLk', 'kkLkk', '.kLk.'],
  rubble: ['..kk..k', '.kuvkku', 'kuvukvk'],
  cobweb: ['lLlLl.', 'L.l.l.', 'll.L..', 'L.l...', 'l.....', '......']
};
symbols['cobweb-r'] = symbols.cobweb.map(row => [...row].reverse().join(''));

// ---------------------------------------------------------------- the map
// W wall, F floor, P pool, V waterfall, . void. The bottom row is left empty for the cliffs below the island.
const MAP = [
  '.......WWWW.......',
  '..WWWWWWVVWWWWWW..',
  '..WFFFFFPPFFFFFW..',
  'WWWFFFFFPPFFFFFWWW',
  'WFFFFFFFPPFFFFFFFW',
  'WFFFFFPPPPPPFFFFFW',
  'WFFFFFPPPPPPFFFFFW',
  'WFFFFFFFFFFFFFFFFW',
  'WWWFFFFFFFFFFFFWWW',
  '..WFFFFFFFFFFFFW..',
  '..WWWWWFFFFWWWWW..',
  '......WFFFFW......',
  '......WWWWWW......',
  '..................'
];
const OX = 8, OY = 6; // the room's place in the scene
// Ground positions: the bottom-centre of a cell, nudged by dx, dy. room() is in the room recipe's pixels, scene() in the scene's.
const room = (x, y, dx = 0, dy = 0) => [x * 8 + 4 + dx, y * 8 + 7 + dy];
const scene = (x, y, dx = 0, dy = 0) => { const [px, py] = room(x, y, dx, dy); return [OX + px, OY + py]; };

// Everything that stands on the floor: [frame, column, row, dx, dy]. The room recipe shades a shadow under each; the
// scene places the props themselves, sorted with the hero by ground line.
const standing = [
  ['pillar', 3, 2, 0, 1], ['pillar', 14, 2, 0, 1], ['barrel', 1, 4], ['barrel', 1, 5, 1, 1], ['pot', 2, 4, 2], ['crate', 16, 7],
  ['pot', 16, 4], ['urn', 16, 5], ['pot', 15, 4, 1, -1], ['barrel', 3, 9], ['pot', 4, 9, 2, 1], ['crate', 14, 9], ['pot', 13, 9, 1, 1],
  ['candles', 10, 11, -2, -1], ['candles', 7, 11, -2, -1], ['barrel', 7, 8, 0, 4], ['chest', 8, 11, 4, -1], ['pot', 12, 8, -1, -2]
];
const widths = { pillar: 9, barrel: 8, pot: 7, crate: 8, urn: 7, candles: 6, chest: 9 };

// ---------------------------------------------------------------- the room: one recipe
// One tilemap operation draws the whole room by rules: floor variants, worn bricks beside walls, the north face of any
// wall above a floor or pool cell, the pool itself, wall caps (plain or cracked) and the cliff below every wall with
// nothing under it. The operations after it see the composed room, so moss grows on the floor colour only and
// shadows darken whatever they fall on.
const tilemap = {
  op: 'tilemap', tile: [8, 8], rows: MAP, empty: '~', legend: {
    F: { rules: [
      { symbols: ['floor-0', 'floor-3', 'floor-1', 'floor-2'], weights: [3, 1, 1, 1] },
      { where: ['...', 'W..', '...'], symbols: ['brick-0', 'brick-1'], chance: 0.3 },
      { where: ['...', '..W', '...'], symbols: ['brick-0', 'brick-1'], chance: 0.3 },
      { where: ['...', '...', '.W.'], symbols: ['brick-0', 'brick-1'], chance: 0.3 },
      { where: ['.W.', '...', '...'], symbols: ['nface-0', 'nface-1'] }
    ] },
    P: { rules: [
      { template: 'water', autotile: 'blob', match: 'PV' },
      { where: ['.W.', '...', '...'], symbols: ['nface-0', 'nface-1'] }
    ] },
    W: { rules: [
      { templates: ['cap', 'cracked'], weights: [2, 1], autotile: 'blob' },
      { where: ['...', '...', '.~.'], symbols: ['cliff-0', 'cliff-1'], offset: [0, 1] }
    ] },
    // The waterfall is a scene layer; here its cells only count as water for the pool's edges.
    V: null
  }
};
// Moss: clumps of seeded value noise over the floor colour, densest at each patch's centre, highlights in finer
// clumps over the moss, and a shadow along each clump's lower edge.
const moss = [
  ...[[30, 58, 44, 30], [108, 40, 34, 24], [78, 78, 40, 18], [36, 22, 24, 14], [120, 28, 14, 10]].map(([cx, cy, w, h]) =>
    ({ op: 'dither', x: cx - w / 2, y: cy - h / 2, w, h, color: 'n', density: [0.9, 0], direction: 'radial', pattern: 'value', scale: 5, seed: 3, over: 'g' })),
  { op: 'dither', color: 'o', density: 0.35, pattern: 'value', scale: 2, seed: 8, over: 'n' },
  { op: 'rewrite', chance: 0.8, seed: 6, rules: [{ match: ['n', 'g'], replace: ['m', '.'] }, { match: ['o', 'g'], replace: ['n', '.'] }] }
];
const decals = [['bricks-a', 2, 7], ['bricks-b', 15, 6, 1, 2], ['bricks-c', 6, 9], ['bricks-b', 10, 4, 3, 0], ['bricks-c', 13, 3, 0, -2], ['plank', 6, 5, -2, 0], ['plank-d', 12, 7, 2, -2], ['plank', 11, 9, 0, 1],
  ['bones', 5, 7, 0, -2], ['skull', 12, 6], ['rubble', 11, 3, 0, -1], ['rubble', 5, 8, 0, 3]]
  .map(([symbol, x, y, dx, dy]) => { const [gx, gy] = room(x, y, dx, dy), art = symbols[symbol]; return { op: 'stamp', symbol, x: gx - Math.floor(art[0].length / 2), y: gy - art.length + 1 }; });
// cobwebs in the inner corners where the north face meets a side wall
const webs = [{ op: 'stamp', symbol: 'cobweb', x: 8, y: 32 }, { op: 'stamp', symbol: 'cobweb-r', x: 130, y: 32 }];
// A shadow under everything that stands: one step down each colour's ramp.
const shadows = standing.map(([frame, x, y, dx, dy]) => { const [gx, gy] = room(x, y, dx, dy), w = widths[frame] + 2; return { op: 'shade', shape: 'ellipse', x: gx - Math.floor(w / 2), y: gy - 2, w, h: 4 }; });
const ops = [tilemap, ...moss, ...decals, ...webs, ...shadows];
// Four frames cycle the water's sparkle keys; each redraws the same operations with its own palette.
const sparkle = [['c', 'd'], ['d', 'e'], ['e', 'c'], ['c', 'c']];
save('room.json', { version: 1, name: 'room', width: MAP[0].length * 8, height: MAP.length * 8, palette: P, symbols,
  frames: sparkle.map(([one, two], i) => ({ name: `water-${i}`, duration: 180, palette: { 1: one, 2: two }, ops })), animations: { water: { frames: sparkle.map((_, i) => `water-${i}`) } } });

// ---------------------------------------------------------------- waterfall tiles
// Two halves, so neighbouring columns join without a seam; wrap scrolls each drawn column down.
const fall = { l: ['kdcedcdc', 'kcdecdec', 'kedcdced', 'kcedcdcc', 'kdcdedcd', 'kecdcedc', 'kcdedcce', 'kdecdced'],
  r: ['dcedcdck', 'cdecdcek', 'ecdcedck', 'dcedcdek', 'cdcedcck', 'edcdcedk', 'cdedccek', 'dcecdcek'] };
const fallFrames = Object.entries(fall).flatMap(([side, rows]) => [{ name: `fall-${side}-0`, duration: 90, ops: [{ op: 'grid', rows }] },
  ...[1, 2, 3].map(i => ({ name: `fall-${side}-${i}`, duration: 90, from: `fall-${side}-0`, translate: [0, 2 * i], wrap: true }))]);
save('falls.json', { version: 1, name: 'falls', width: 8, height: 8, palette: P, frames: fallFrames, animations: Object.fromEntries(Object.keys(fall).map(side => [`fall-${side}`, { frames: [0, 1, 2, 3].map(i => `fall-${side}-${i}`) }])) });

// ---------------------------------------------------------------- props: 16 x 18 canvas, anchor at the ground contact
const ANCHOR = [8, 16], props = [];
const prop = (name, art, dy = 0) => { const x = ANCHOR[0] - Math.floor(art[0].length / 2); props.push({ name, ops: [{ op: 'grid', x, y: ANCHOR[1] - art.length + 1 + dy, rows: art }] }); };
prop('barrel', ['.kkkkkk.', 'kzzzzzzk', 'kzyyyyzk', 'kzyxxyzk', 'kyzzzzyk', 'kxyyyyxk', 'kGzyyzGk', 'kxyyyyxk', 'kxyzzyxk', '.kkkkkk.']);
prop('pot', ['.kkkkk.', 'kpkkkpk', 'kqpppqk', 'kpppqqk', 'kqppqqk', '.kqqqk.', '..kkk..']);
prop('pot-break-0', ['.kkkkk.', 'kpkkkpk', 'kqpkpqk', 'kpkpqqk', 'kqpkqqk', '.kqqkk.', '..kkk..']);
prop('pot-break-1', ['k.p..qk', '.kq.kpk', 'kqpk.qk', '.k.pqk.']);
prop('pot-shards', ['.....kq..', 'kqk...kpk', '.kpk.kqk.', 'q...kk..p']);
prop('urn', ['.kkkkk.', 'kekkkek', 'kcddcck', 'kddcbck', 'kGGGGGk', 'kdcccbk', '.kbbbk.', '..kkk..']);
prop('crate', ['kkkkkkkk', 'kzzzzzzk', 'kzyyyyzk', 'kzyyyyzk', 'kxxxxxxk', 'kyxyyxyk', 'kyyxxyyk', 'kyxyyxyk', 'kkkkkkkk']);
prop('pillar', ['.kkkkkkk.', 'kuvwwwvuk', 'kvwwwwwvk', 'kuvvvvvuk', '.kkkkkkk.', ...Array(6).fill('.ksttuuk.'), 'kkkkkkkkk', 'kstttuuuk', 'kkkkkkkkk']);
prop('chest', ['.kkkkkkk.', 'kzyyyyyzk', 'kyyyyyyyk', 'kkkkGkkkk', 'kxyyGyyxk', 'kxyyyyyxk', 'kxxxxxxxk', '.kkkkkkk.']);
prop('chest-open', ['.kkkkkkk.', 'kxyyyyyxk', 'kkkkkkkkk', 'kGYkYGkGk', 'kxyyyyyxk', 'kxyyyyyxk', 'kxxxxxxxk', '.kkkkkkk.']);
prop('candles', ['..Y...', '..W.Y.', '.kLkW.', '.kLkLk', 'kkLkLk', 'kkkkkk']);
prop('banner', ['kkkkkk', 'kRRRRk', 'kRGGRk', 'kRRRRk', 'kRGRRk', 'kRRRRk', 'kRRRRk', 'kR.kRk', 'k...Rk', '....k.'], 1);
prop('chain', ['.k.', 'kuk', '.k.', 'kuk', '.k.', 'kuk', '.k.', '.u.']);
// A wall torch: one bracket, four authored flames.
[['..Y..', '.YWY.', '.FYF.'], ['...Y.', '.YWY.', '.FWF.'], ['.Y...', '.YWY.', '.FYF.'], ['..Y..', '.YYF.', '.FWF.']].forEach((flame, i) =>
  props.push({ name: `torch-${i}`, duration: 110, ops: [{ op: 'grid', x: 6, y: 8, rows: ['.kkk.', 'kzGzk', '.kxk.', '..k..'] }, { op: 'grid', x: 6, y: 5, rows: flame }] }));
// Foam where the waterfall meets the channel: three authored frames.
['.EeE.eEEe.EeE.e.|eEdeEEdEeEEdeEe.|..e..e..e..e....', 'E.eEe.EeE.eEe.E.|eEEdeEEEdeEEEde.|.e..e..e..e..e..', '.eE.EeE.eEe.EeE.|EdeEEdeEEdEeEdEe|e..e..e..e..e...']
  .forEach((art, i) => props.push({ name: `foam-${i}`, duration: 120, ops: [{ op: 'grid', x: 0, y: 14, rows: art.split('|') }] }));
save('props.json', { version: 1, name: 'props', width: 16, height: 18, palette: P, anchor: ANCHOR, frames: props, animations: {
  'pot-break': { frames: ['pot-break-0', 'pot-break-1', 'pot-shards'], loop: false },
  'chest-open': { frames: ['chest', 'chest-open'], loop: false },
  torch: { frames: ['torch-0', 'torch-1', 'torch-2', 'torch-3'] }, foam: { frames: ['foam-0', 'foam-1', 'foam-2'] } } });

// ---------------------------------------------------------------- hero: 7 x 10 pixels on a 12 x 14 canvas
// Every frame names its feet, where the scene attaches the hero's shadow; the strike frames name the blade, where the
// smear attaches.
const head = ['..kkk..', '.kRRRk.', 'kRRRRRk'];
const pose = (body, legs, bob = 0, dx = 0) => [{ op: 'grid', x: 3 + dx, y: 2 + bob, rows: [...head, ...body] }, { op: 'grid', x: 3 + dx, y: 10, rows: legs }];
const front = ['kRlLlRk', '.kRRRk.', 'kvwwwvk', 'kuvGvuk', '.kuuuk.'], side = ['kRRlLk.', '.kRRk..', '.kvwwk.', '.kuvGk.', '.kuuk..'];
const apart = ['.kt.tk.', '.kk.kk.'], wide = ['kt...tk', 'kk...kk'], crossed = ['..ktk..', '..kkk..'];
const feet = { feet: [6, 12] }, blade = { ...feet, blade: [9, 8] };
const hero = [
  { name: 'idle-0', duration: 400, points: feet, ops: pose(front, apart) },
  // the second idle pose breathes: the chest drops a row
  { name: 'idle-1', duration: 400, points: feet, ops: pose(front.slice(0, 4), apart, 1) },
  { name: 'down-0', duration: 120, points: feet, ops: pose(front, ['.kt.k..', '.kk....']) },
  { name: 'down-1', duration: 120, points: feet, ops: pose(front, apart, -1) },
  { name: 'down-2', duration: 120, points: feet, ops: pose(front, ['..k.tk.', '....kk.']) },
  { name: 'down-3', duration: 120, points: feet, ops: pose(front, apart, -1) },
  { name: 'right-0', duration: 120, points: feet, ops: pose(side, ['.kt..tk', 'kk...kk']) },
  { name: 'right-1', duration: 120, points: feet, ops: pose(side, crossed, -1) },
  { name: 'right-2', duration: 120, points: feet, ops: pose(side, apart) },
  { name: 'right-3', duration: 120, points: feet, ops: pose(side, crossed, -1) },
  // attack to the right: wind-up with the blade raised behind, a lunging strike, a low follow-through
  { name: 'atk-0', duration: 90, points: blade, ops: [...pose(side, apart), { op: 'grid', x: 0, y: 1, rows: ['L...', '.L..', '..lk', '...k'] }] },
  { name: 'atk-1', duration: 70, points: blade, ops: [...pose(side, wide, 1, 1), { op: 'grid', x: 9, y: 7, rows: ['kLL'] }] },
  { name: 'atk-2', duration: 160, points: blade, ops: [...pose(side, wide, 1, 1), { op: 'grid', x: 9, y: 8, rows: ['k..', '.L.', '..L'] }] }
];
save('hero.json', { version: 1, name: 'hero', width: 12, height: 14, palette: P, anchor: [6, 12], frames: hero, animations: {
  idle: { frames: ['idle-0', 'idle-1'] }, down: { frames: ['down-0', 'down-1', 'down-2', 'down-3'] },
  right: { frames: ['right-0', 'right-1', 'right-2', 'right-3'] }, attack: { frames: ['atk-0', 'atk-1', 'atk-2', 'right-0'], loop: false } } });
// The hero's shadow: a shade placement, so it darkens whatever floor the hero crosses.
save('shadow.json', { version: 1, name: 'shadow', width: 8, height: 3, palette: P, anchor: [4, 1], frames: [{ name: 'feet', ops: [{ op: 'ellipse', w: 8, h: 3, color: 'k' }] }] });

// ---------------------------------------------------------------- slash smear: a crescent, thinned and dissolved
const crescent = thin => Array.from({ length: 14 }, (_, y) => Array.from({ length: 10 }, (_, x) => {
  const outer = Math.hypot(x - 1.5, y - 6.5), inner = Math.hypot(x + 1.5 + thin, y - 6.5);
  return outer > 7.2 || inner < 7.2 || x < 2 ? '.' : outer > 6.2 ? 'E' : 'L';
}).join(''));
save('slash.json', { version: 1, name: 'slash', width: 16, height: 14, palette: P, anchor: [2, 9], frames: [
  { name: 'slash-0', duration: 60, ops: [{ op: 'grid', x: 4, y: 0, rows: crescent(0) }] },
  { name: 'slash-1', duration: 60, ops: [{ op: 'grid', x: 4, y: 0, rows: crescent(2) }, { op: 'dither', erase: true, density: 0.35, pattern: 'bayer2' }] },
  { name: 'slash-2', duration: 60, ops: [{ op: 'grid', x: 4, y: 0, rows: crescent(3) }, { op: 'dither', erase: true, density: 0.7, pattern: 'bayer2' }] }
], animations: { slash: { frames: ['slash-0', 'slash-1', 'slash-2'], loop: false } } });

// ---------------------------------------------------------------- shards: a pixelforge-fx burst
const shardsSource = { format: 'pixelforge-fx', version: 1, name: 'shards', width: 32, height: 24, palette: P,
  symbols: { a: ['qp'], b: ['p', 'q'], c: ['k'], d: ['rq'] },
  effects: { burst: { frames: 10, duration: 50, seed: 7, emitters: [
    { at: [16, 18], burst: 7, angle: [200, 340], speed: [1.4, 2.6], gravity: [0, 0.38], life: [7, 10], floor: 21, bounce: 0.3, shapes: [['a'], ['b'], ['c'], ['d']] }
  ] } } };
save('shards.fx.json', shardsSource);
save('shards.json', { ...compileEffects({ ...shardsSource, palette }).recipe, palette: P });

// ---------------------------------------------------------------- the scenes
// The strike happens at "strike"; every related cue is written as an offset from it.
const heroEnd = scene(10, 8, 1, -2), potAt = scene(12, 8, -1, -2);
const place = (name, frame, at, extra = {}) => ({ name, asset: 'props', frame, at, anchor: 'frame', ...extra });
const instances = [
  { name: 'room', asset: 'room', animation: 'water', at: [OX, OY] },
  // The waterfall's halves by rule: a column with another to its west is the right half.
  { name: 'falls', asset: 'falls', at: [OX, OY], tilemap: { rows: MAP, legend: { V: { rules: [{ where: ['...', 'V..', '...'], animation: 'fall-r', stop: true }, { animation: 'fall-l' }] }, W: null, F: null, P: null } } },
  { name: 'foam', asset: 'props', animation: 'foam', at: [OX + 8 * 8 + 8, OY + 2 * 8 + 2], anchor: 'frame' },
  // Named apart, so the night scene's lights can follow them.
  ...[[5, 2, 'torch-left'], [12, 2, 'torch-right']].map(([x, y, name]) => ({ name, asset: 'props', animation: 'torch', at: scene(x, y, 0, -6), anchor: 'frame' })),
  // Listed before the props, so it lands on the floor under them; attached, so it follows the hero's feet.
  { name: 'hero-shadow', asset: 'shadow', frame: 'feet', at: [0, 0], anchor: 'frame', attach: { instance: 'hero', point: 'feet' }, shade: -1 },
  // Props and the hero are drawn by ground line, so the hero passes behind the barrel in the middle of the room.
  ...standing.filter(([frame], i) => i < standing.length - 2).map(([frame, x, y, dx, dy]) => place(frame === 'candles' ? `candles-${x < 9 ? 'left' : 'right'}` : frame, frame, scene(x, y, dx, dy), { sort: 'ground' })),
  place('chest', 'chest', scene(8, 11, 4, -1), { sort: 'ground', sequence: [{ time: 'strike+800', animation: 'chest-open' }] }),
  place('target-pot', 'pot', potAt, { sort: 'ground', sequence: [{ time: 'strike+90', animation: 'pot-break' }] }),
  { name: 'hero', asset: 'hero', animation: 'right', at: heroEnd, anchor: 'frame', sort: 'ground', trajectory: [{ time: 0, at: scene(4, 8, 0, -2) }, { time: 'strike', at: heroEnd }],
    sequence: [{ time: 'strike', animation: 'attack' }, { time: 'strike+700', animation: 'idle' }] },
  // The smear rides the blade point and stays hidden outside the strike; the shards appear when the pot breaks.
  { name: 'slash', asset: 'slash', at: [0, 0], anchor: 'frame', hidden: true, attach: { instance: 'hero', point: 'blade' }, sequence: [{ time: 'strike+70', animation: 'slash' }, { time: 'strike+250', hide: true }] },
  { name: 'shards', asset: 'shards', at: [potAt[0] - 16, potAt[1] - 21], hidden: true, sequence: [{ time: 'strike+90', animation: 'burst' }, { time: 'strike+590', hide: true }] },
  // chains and a banner hang off the island's south edge
  ...[[3, 11], [13, 11], [8, 13], [10, 13]].map(([x, y]) => place('chain', 'chain', scene(x, y, -1, 1))),
  place('banner', 'banner', scene(4, 10, 0, 6))
];
const assets = { room: 'room.json', falls: 'falls.json', props: 'props.json', hero: 'hero.json', shadow: 'shadow.json', slash: 'slash.json', shards: 'shards.json' };
const base = { format: 'pixelforge-scene', version: 1, width: 160, height: 128, duration: 2400, background: palette.k, cues: { strike: 1200 }, assets, instances };
save('room.scene.json', { ...base, name: 'diorama' });
// The same room in blue stone on a brown floor: one palette file, no copied recipes.
save('room-blue.scene.json', { ...base, name: 'diorama-blue', palette: 'palette-blue.json' });
// By torchlight: ramp lighting moves colours along their ramps, so the lit room keeps exactly its palette. Each torch
// and candle light follows its placement and flickers on its own seed; the flames themselves keep their colours
// (lit: false). On the strike, a flash rises at the pot as it breaks, quickly, then fades more slowly.
const flames = new Set(['torch-left', 'torch-right', 'candles-left', 'candles-right']);
const nightLights = [
  ...['torch-left', 'torch-right'].map((instance, i) => ({ follow: { instance }, at: [0, -4], height: 12, radius: 64, color: '#fff0c8', flicker: { amount: 0.35, every: 90, seed: i + 1 } })),
  ...['candles-left', 'candles-right'].map((instance, i) => ({ follow: { instance }, at: [2, -2], height: 6, radius: 26, color: '#ffd090', flicker: { amount: 0.45, every: 70, seed: i + 3 } })),
  { follow: { instance: 'target-pot' }, at: [0, -5], height: 8, radius: 10, strength: 0, color: '#fff1c4',
    keys: [{ time: 'strike+70', strength: 0 }, { time: 'strike+100', strength: 2.5, radius: 48, ease: 'out' }, { time: 'strike+380', strength: 0, radius: 10 }] }
];
save('room-night.scene.json', { ...base, name: 'diorama-night', instances: instances.map(instance => (flames.has(instance.name) ? { ...instance, lit: false } : instance)),
  lighting: { mode: 'ramp', scope: 'all', ambient: 0.3, bands: 4, steps: 3, lights: nightLights } });
if (check) { console.log(differing.length ? `Out of date: ${differing.join(', ')}` : 'All diorama sources match build.mjs.'); process.exitCode = differing.length ? 1 : 0; }
else console.log(JSON.stringify({ ok: true, directory: out, files: written }));
