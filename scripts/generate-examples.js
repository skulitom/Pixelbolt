import { writeFile, mkdir } from 'node:fs/promises';
import { compileEffects, compilePoses, compileNormals, formatJSON } from '../src/index.js';
import { wavePresets } from './wave-presets.mjs';
import { spellPresets } from './spell-presets.mjs';
import { spellLibrary } from './spell-library.mjs';
import { terrainPresets } from './terrain-presets.mjs';
import { plasmaPresets } from './plasma-presets.mjs';
const rows = source => source.map(row => row.padEnd(16, '.'));
const spirit = rows([
  '........dd',
  '.......dLld',
  '..dd...dld',
  '..dLdddld',
  '...dllld',
  '....dddddd',
  '...dllhhllld',
  '..dlhhhhhhhld',
  '..dlhhhhhhhld',
  '.dlhhkhhkhhhld',
  '.dlhhkhhkhhhld',
  '.dlpphhhhpplld',
  '..dlhhhhlhlld',
  '..dlllllllld',
  '...dlllllld',
  '....dlddld',
  '....dd..dd'
]);
const palette = { d: '#245449', l: '#72b58d', L: '#c9e6a0', h: '#b6db9c', k: '#20383f', p: '#e8b09e', s: '#283d5130', g: '#f2dc93' };
const pose = (name, y, duration, blink = false) => ({ name, duration, layers: [
  { name: 'shadow', ops: [{ op: 'ellipse', x: 7, y: 21, w: 10, h: 2, color: 's' }] },
  { name: 'body', y, ops: [{ op: 'stamp', symbol: 'mossling', x: 4, y: 3 }, ...(blink ? [{ op: 'rect', x: 8, y: 12, w: 6, h: 2, color: 'h' }, { op: 'line', x: 9, y: 13, x2: 10, y2: 13, color: 'k' }, { op: 'line', x: 12, y: 13, x2: 13, y2: 13, color: 'k' }] : [])] }
] });
const forest = { version: 1, name: 'forest-spirit', width: 24, height: 24, palette, symbols: { mossling: spirit }, frames: [pose('rest', 0, 240), pose('rise', -1, 140), pose('float', -2, 220), pose('blink', -2, 100, true), pose('fall', -1, 140), pose('settle', 0, 160)], animations: { idle: { frames: ['rest', 'rise', 'float', 'blink', 'float', 'fall', 'settle'] }, bob: { frames: ['rest', 'rise', 'float'], direction: 'pingpong' }, blink: { frames: ['rest', 'blink', 'rest'], loop: false } }, sheet: { columns: 6, padding: 1, scale: 1 } };
const ember = { version: 1, name: 'ember', width: 24, height: 24, palette: { o: '#6a3344', r: '#cf5b53', a: '#f39b5d', y: '#ffdb85', w: '#fff1ca' }, symbols: { flame: rows(['........oo','.......oro','......oroo','.....orrao','....orraao','...orraaooo','..orraaaaaro','..raayyyaaro','.oraywyyyaaro','.oraywyyyaaro','.orraayyaaro','..orraaaaaro','...orrrrro','....ooooo']) }, frames: [
  { name: 'flicker-a', duration: 110, ops: [{ op: 'stamp', symbol: 'flame', x: 4, y: 5 }] },
  { name: 'flicker-b', duration: 90, from: 'flicker-a', ops: [{ op: 'clear', x: 11, y: 5, w: 4, h: 3 }, { op: 'line', x: 12, y: 4, x2: 11, y2: 9, color: 'r' }, { op: 'pixel', x: 15, y: 3, color: 'y' }] },
  { name: 'flicker-c', duration: 120, ops: [{ op: 'stamp', symbol: 'flame', x: 4, y: 4, flipX: true }] },
  { name: 'flicker-d', duration: 80, from: 'flicker-a', ops: [{ op: 'pixel', x: 8, y: 3, color: 'a' }, { op: 'pixel', x: 15, y: 1, color: 'y' }] }
], animations: { burn: { frames: ['flicker-a', 'flicker-b', 'flicker-c', 'flicker-d'] } }, sheet: { columns: 4, padding: 1 } };
const widths = [12, 9, 5, 3, 5, 9];
const coin = { version: 1, name: 'coin', width: 24, height: 24, palette: { edge: '#916240', gold: '#edbb57', light: '#ffe4a0', shade: '#c78a43' }, frames: widths.map((w, i) => ({ name: `turn-${i}`, duration: 110, ops: [
  { op: 'ellipse', x: Math.floor((24-w)/2), y: 5, w, h: 15, color: 'edge' },
  { op: 'ellipse', x: Math.floor((24-w)/2) + 1, y: 6, w: Math.max(1,w-2), h: 12, color: 'gold' },
  ...(w >= 5 ? [{ op: 'line', x: Math.floor((24-w)/2)+2, y: 8, x2: Math.floor((24-w)/2)+2, y2: 15, color: 'light' }] : []),
  ...(w > 8 ? [{ op: 'line', x: 12, y: 9, x2: 12, y2: 15, color: 'shade' }] : [])
] })), animations: { spin: { frames: widths.map((_, i) => `turn-${i}`) } }, sheet: { columns: 6, padding: 1 } };

// Seeded particle effects: every frame compiles to stamps, grids and lines on these symbols.
const emit = (at, extra) => ({ at, ...extra });
const effects = { format: 'pixelforge-fx', version: 1, name: 'effects', width: 48, height: 40,
  palette: { W: '#fff4d6', y: '#ffd166', o: '#f4843c', r: '#c2413a', s: '#d8c7a8', S: '#a38d74', u: '#6f5d52', l: '#b8dc7a', g: '#79b15a', G: '#3f7a4a', q: '#a9a6c4', Q: '#6b6888' },
  symbols: { hot: ['W'], warm: ['y'], cool: ['o'], ash: ['r'], 'flash-0': ['..W..', '.WyW.', 'WyWyW', '.WyW.', '..W..'], 'flash-1': ['W...W', '..y..', '.y.y.', '..y..', 'W...W'],
    'ember-big': ['yW', 'oy'], ember: ['y'], 'ember-dim': ['o'], 'ember-end': ['r'], 'puff-big': ['.ss..', 'sssS.', 'sSSSu', '.SSu.'], puff: ['.s.', 'sSS', '.Su'], 'puff-small': ['sS', 'Su'], 'puff-end': ['S'],
    'leaf-a': ['lg.', '.gG'], 'leaf-b': ['.l', 'gG'], 'leaf-c': ['gl', 'G.'], 'chip-a': ['qQ', 'Q.'], 'chip-b': ['q', 'Q'], 'chip-c': ['.q', 'qQ'], 'chip-d': ['q'] },
  anchor: [24, 36],
  effects: {
    sparks: { frames: 9, duration: 55, seed: 11, emitters: [
      emit([24, 30], { name: 'flash', burst: 1, life: 2, shapes: ['flash-0', 'flash-1'], play: 'once' }),
      emit([24, 30], { name: 'burst', area: [3, 2], burst: 12, angle: [205, 335], speed: [1.8, 3.4], gravity: [0, 0.32], drag: 0.04, life: [6, 9], floor: 36, bounce: 0.35, shapes: ['hot', 'warm', 'cool', 'ash'], trail: { color: 'r', length: 1 } })] },
    embers: { frames: 16, duration: 70, loop: true, seed: 4, emitters: [
      emit([24, 35], { area: [12, 2], rate: 0.5, angle: [255, 285], speed: [0.6, 1.1], life: [12, 18], sway: { amplitude: [1, 0], period: 7 }, shapes: ['ember-big', 'ember', 'ember-dim', 'ember-end'], dissolve: 0.25 })] },
    // Round puffs, lit from the upper left, that swell and then shrink away rather than dithering out.
    dust: { frames: 11, duration: 70, seed: 6, emitters: [[22, [178, 196], 'left'], [26, [344, 362], 'right']].map(([x, angle, name]) =>
      emit([x, 35], { name, area: [4, 1], burst: 6, angle, speed: [0.8, 3.2], drag: 0.13, gravity: [0, -0.04], life: [9, 12], shapes: ['puff', 'puff-big', 'puff-big', 'puff', 'puff-small', 'puff-end'] })) },
    leaves: { frames: 12, duration: 70, seed: 9, emitters: [
      emit([24, 18], { area: [10, 4], burst: 8, angle: [200, 340], speed: [1, 2.2], gravity: [0, 0.18], drag: 0.14, life: [10, 12], sway: { amplitude: [1.4, 0], period: 6 },
        shapes: [['leaf-a', 'leaf-b'], ['leaf-b', 'leaf-c'], ['leaf-c', 'leaf-a']], play: 'loop', remaps: [{}, { g: 'l' }, { G: 'g', g: 'l' }], dissolve: 0.25 })] },
    shatter: { frames: 12, duration: 60, seed: 3, emitters: [
      emit([24, 26], { area: [6, 4], burst: 9, angle: [205, 335], speed: [2, 3.2], gravity: [0, 0.45], drag: 0.08, life: 12, floor: 35, bounce: 0.3, shapes: [['chip-a'], ['chip-b'], ['chip-c'], ['chip-d']] })] }
  } };

// Effects on the rigged hero, whose idle frame the CLI and MCP read from hero.poses.json: a teleport that takes him apart
// from the feet up into light inside a pillar, and a looping spirit aura that hugs his outline, with sparkles.
const heroAt = [4, 16];
const heroMagic = { format: 'pixelforge-fx', version: 1, name: 'hero-magic', width: 40, height: 52,
  palette: { W: '#ffffff', c: '#8fe9ff', b: '#4f7cff', v: '#6a3fb5' },
  symbols: { hero: { recipe: 'hero.poses.json', frame: 'idle-rest' }, spark: ['W'], 'spark-dim': ['c'] },
  anchor: [20, 51],
  effects: {
    teleport: { frames: 14, duration: 70, seed: 3, edges: ['top', 'bottom'],
      looks: { light: { colors: ['v', 'b', 'c', 'W'], thresholds: [0.3, 0.5, 0.72, 0.9] } },
      layers: [{ kind: 'beam', look: 'light', at: [20, 51], to: [20, 0], width: [1, 11, 9, 0], reveal: 0.2, wobble: 0.12, wavelength: 9, waves: -3, fade: 0.6,
        power: [1.2, 1.1, 0.7, 0], ease: 'linear', noise: 0.35, scale: 3 }],
      emitters: [{ sprite: { symbol: 'hero' }, at: heroAt, release: { sweep: 270, jitter: 0.35 }, start: 1, end: 10,
        angle: [255, 285], speed: [0.6, 1.6], gravity: [0, -0.12], drag: 0.02, life: [5, 8], tint: [{}, 'W', 'c', 'b'], dissolve: 0.35 }] },
    aura: { frames: 12, duration: 70, loop: true, seed: 5, edges: ['bottom'],
      looks: { spirit: { colors: ['v', 'b', 'c', 'W'], thresholds: [0.1, 0.3, 0.55, 0.8] } },
      cleanup: { corners: true, strays: true },
      layers: [{ kind: 'aura', look: 'spirit', symbol: 'hero', at: heroAt, width: 4, rise: 3, noise: 0.8, scale: 3, floor: 51 }],
      emitters: [{ sprite: { symbol: 'hero', pixels: 'outline', draw: true }, at: heroAt, rate: 0.6, angle: [255, 285], speed: [0.6, 1.2], life: [5, 8], shapes: ['spark', 'spark-dim'] }] }
  } };

// The simulated explosion of explosion.fluid.json inside a particle effect: it plays frame for frame under a shape-layer
// flash and a shockwave that breaks up as it spreads, with a few embers over it.
const fluidBlast = { format: 'pixelforge-fx', version: 1, name: 'fluid-blast', width: 96, height: 96,
  palette: { W: '#fffbe6', y: '#ffd34d', o: '#ff8a2b', r: '#d6402b' },
  symbols: { blast: { recipe: 'explosion.fluid.json', animation: 'explosion' }, 'ember-big': ['yW', 'oy'], ember: ['y'], 'ember-dim': ['o'], 'ember-end': ['r'] },
  anchor: [48, 53],
  effects: {
    blast: { frames: 32, duration: { from: 45, to: 80, ease: 'in' }, seed: 7,
      looks: { flash: { colors: ['o', 'y', 'W'], thresholds: [0.25, 0.5, 0.8] } },
      cleanup: { corners: true, strays: true },
      layers: [
        { kind: 'star', look: 'flash', at: [48, 53], frames: [0, 3], radius: [28, 12], points: 8, width: [4, 2], ratio: 0.5, power: [1.3, 0.8], cue: 'boom' },
        { kind: 'ring', look: 'flash', at: [48, 53], frames: [1, 9], radius: [10, 40], width: [7, 4, 3], noise: 0.85, scale: 5, power: [1.3, 0.9, 0.3] }],
      emitters: [
        { sprite: { symbol: 'blast', draw: true }, at: [16, 16], behind: true },
        { at: [48, 53], burst: 9, start: 1, angle: [190, 350], speed: [1.4, 2.8], gravity: [0, 0.3], drag: 0.03, life: [6, 10], floor: 84, bounce: 0.3,
          shapes: ['ember-big', 'ember', 'ember-dim', 'ember-end'], trail: { color: 'r', length: 1 } }] }
  } };

// A crescent smear behind the sword of swing.poses.json: the trail follows the blade's tip round its hilt frame for frame,
// the sword animation is drawn under the effect's particles, and a flash and sparks mark the strike. The durations are
// the swing's own, then two frames for the smear to shrink away.
const swingTrail = { format: 'pixelforge-fx', version: 1, name: 'swing-trail', width: 40, height: 40,
  palette: { B: '#2f4fb3', c: '#4fa3f7', p: '#aee6ff', W: '#ffffff', Y: '#ffe066', O: '#ff9a3c' },
  symbols: { sword: { recipe: 'swing.poses.json', animation: 'swing' }, spark: ['W'], 'spark-y': ['Y'], 'spark-o': ['O'] },
  effects: {
    swing: { frames: 7, duration: [180, 50, 50, 90, 160, 70, 70], seed: 2,
      looks: { steel: { colors: ['B', 'c', 'p', 'W'], thresholds: [0.15, 0.4, 0.65, 0.88] }, flash: { colors: ['O', 'Y', 'W'], thresholds: [0.2, 0.5, 0.8] } },
      cleanup: { corners: true, strays: true },
      layers: [
        { kind: 'trail', look: 'steel', at: [0, 0], follow: { recipe: 'swing.poses.json', animation: 'swing', point: 'blade.tip', pivot: 'blade.anchor' }, length: 3, width: 8, fade: 0.5 },
        { kind: 'star', look: 'flash', at: [32, 31], frames: [3, 5], radius: [7, 3], width: [2, 1], points: 4, power: [1.3, 0.7], cue: 'hit' }],
      emitters: [
        { sprite: { symbol: 'sword', draw: true }, at: [0, 0] },
        { at: [32, 31], burst: 6, start: 3, angle: [300, 420], speed: [1, 2.2], gravity: [0, 0.25], drag: 0.05, life: [3, 5], shapes: ['spark', 'spark-y', 'spark-o'] }] }
  } };

// Dithered sky bands, a shading band limited to one colour, an inside rim light, grown cracks and moss, a drop line.
const band = (y, h, color, density) => ({ op: 'dither', x: 0, y, w: 48, h, color, density });
const shrine = { version: 1, name: 'shrine', width: 48, height: 40,
  palette: { a: '#2a2140', b: '#43305a', e: '#6b4668', f: '#a8606a', u: '#2c3b2f', v: '#3f5a3a', k: '#1d1a2b', s: '#6d6a8a', S: '#4d4a6a', h: '#9e9bbd', c: '#2f2b45', m: '#6fa34f', M: '#46703f', g: '#5fc7b8', G: '#d6fff1' },
  symbols: { rune: ['..g..', '.g.g.', 'g.g.g', '.g.g.', '..g..'] },
  frames: [
    { name: 'idle', duration: 400, layers: [
      { name: 'sky', ops: [
        { op: 'rect', x: 0, y: 0, w: 48, h: 30, color: 'a' }, band(8, 10, 'b', [0, 1]), { op: 'rect', x: 0, y: 18, w: 48, h: 6, color: 'b' }, band(18, 8, 'e', [0, 1]),
        { op: 'rect', x: 0, y: 26, w: 48, h: 4, color: 'e' }, band(26, 4, 'f', [0, 0.75]), { op: 'rect', x: 0, y: 30, w: 48, h: 10, color: 'v' }, band(30, 10, 'u', [0.25, 1])] },
      { name: 'stone', ops: [
        { op: 'ellipse', x: 16, y: 6, w: 16, h: 12, color: 's' }, { op: 'rect', x: 16, y: 12, w: 16, h: 22, color: 's' },
        { op: 'pixel', x: 26, y: 13, color: 'c' },
        { op: 'rewrite', x: 18, y: 12, w: 12, h: 20, rules: [{ match: ['c.', '.s'], replace: ['..', '.c'] }], mirror: true, limit: 1, steps: 9, seed: 7 },
        { op: 'dither', x: 24, y: 6, w: 8, h: 28, color: 'S', density: [0, 1], direction: 'right', over: 's' },
        { op: 'outline', color: 'h', position: 'inside', directions: ['xx.', 'x..', '...'] },
        { op: 'outline', color: 'k' },
        { op: 'rewrite', empty: '_', rules: [{ match: ['_', 'k'], replace: ['.', 'm'] }], chance: 0.7, seed: 2 },
        { op: 'rewrite', rules: [{ match: ['m', 'h'], replace: ['.', 'M'] }, { match: ['m', 's'], replace: ['.', 'M'] }], chance: 0.6, seed: 3 },
        { op: 'stamp', symbol: 'rune', x: 19, y: 20 },
        { op: 'outline', color: 'k', directions: ['...', '...', '.x.'] }] }
    ] },
    { name: 'glow', from: 'idle', duration: 240, palette: { g: 'G' }, ops: [{ op: 'stamp', symbol: 'rune', x: 19, y: 20 }] }
  ],
  animations: { pulse: { frames: ['idle', 'glow'] } } };

// One sword drawn once, rotated around its grip; eased tweens accelerate the swing into the strike.
const tip = [{ name: 'tip', part: 'blade', point: 'tip' }], held = rotate => [{ name: 'blade', part: 'sword', rotate }];
const swing = { format: 'pixelforge-poses', version: 1, name: 'swing', width: 40, height: 40,
  palette: { k: '#1d1a2b', b: '#7a4a32', y: '#e8b04a', w: '#eef3ff', s: '#9aa7c7', S: '#5d6a8f' },
  parts: { sword: { rows: ['....k............', '...kyk...........', 'kkkkykkkkkkkkkk..', 'kbbkykwwwwwwwwwkk', 'kkkkykssssssssSk.', '...kyk.kkkkkkkk..', '....k............'], anchor: [2, 3], points: { tip: [16, 3] } } },
  poses: [
    { name: 'raise', duration: 180, origin: [20, 24], parts: held(-135), markers: tip },
    { name: 'strike', duration: 90, origin: [20, 24], parts: held(30), markers: tip },
    { name: 'swing-1', duration: 50, tween: { from: 'raise', to: 'strike', t: 0.33, ease: 'in' } },
    { name: 'swing-2', duration: 50, tween: { from: 'raise', to: 'strike', t: 0.67, ease: 'in' } },
    { name: 'follow', duration: 160, origin: [20, 24], parts: held(50) }
  ],
  animations: { swing: { frames: ['raise', 'swing-1', 'swing-2', 'strike', 'follow'], loop: false } } };

// A side-view figure rigged for the motion templates: bone limbs, a mass torso, a grid head and boots. The pose origin
// is where the feet meet the ground, exported as each frame's anchor; the torso, the only part without attach, stands
// 15 rows above it (its `at` is an offset from the origin, not a canvas position), and every other part hangs from it.
// Far limbs are one ramp step darker, paired limbs share rest angles, and every motion passes its own checks.
const limb = (length, width, ramp, base, caps = ['socket', 'round']) => ({ bone: { length, width, ramp, base, outline: 'k', caps }, points: { end: 'end' } });
const leg = (side, far) => [
  { name: `${side}Thigh`, part: far ? 'farThigh' : 'thigh', attach: { part: 'torso', point: 'hip' }, angle: 90 },
  { name: `${side}Shin`, part: far ? 'farShin' : 'shin', attach: { part: `${side}Thigh`, point: 'end' }, angle: 0 },
  { name: `${side}Boot`, part: 'boot', attach: { part: `${side}Shin`, point: 'end' } }
];
const arm = (side, far) => [
  { name: `${side}Upper`, part: far ? 'farUpper' : 'upper', attach: { part: 'torso', point: 'shoulder' }, angle: 95 },
  { name: `${side}Fore`, part: far ? 'farFore' : 'fore', attach: { part: `${side}Upper`, point: 'end' }, angle: -15 }
];
const hero = { format: 'pixelforge-poses', version: 1, name: 'hero', width: 32, height: 36,
  palette: { k: '#1b1626', x: '#6e3f3a', y: '#c27b5c', z: '#f0b98e', r: '#3f1c2c', s: '#7f2b3d', t: '#b8463f', u: '#e07e52',
    p: '#222844', q: '#39476b', o: '#5a6f99', b: '#3a2421', c: '#6e4430', h: '#f2c14e', g: '#c08a2a' },
  ramps: [['x', 'y', 'z'], ['r', 's', 't', 'u'], ['p', 'q', 'o']],
  light: 225,
  parts: {
    torso: { mass: { size: [7, 9], ramp: 1, base: 2, outline: 'k' }, points: { hip: [0, 4], shoulder: [1, -3], neck: [1, -4] } },
    head: { rows: ['..kkkk..', '.kghhhk.', 'kgghhhhk', 'kghzzkzk', '.kgzzzzk', '.kyzzzyk', '..kyyyk.', '...kkk..'], anchor: [4, 7] },
    thigh: limb(5, [3, 3], 2, 1, ['round', 'round']), shin: limb(5, [3, 2], 2, 1),
    farThigh: limb(5, [3, 3], 2, 0, ['round', 'round']), farShin: limb(5, [3, 2], 2, 0),
    upper: limb(4, [2, 2], 1, 2, ['round', 'round']), fore: limb(4, [2, 2], 0, 1),
    farUpper: limb(4, [2, 2], 1, 1, ['round', 'round']), farFore: limb(4, [2, 2], 0, 0),
    boot: { rows: ['kcck.', 'kbcck', 'kkkkk'], anchor: [1, 2] }
  },
  poses: [{ name: 'stand', duration: 200, origin: [15, 35], parts: [
    ...arm('far', true), ...leg('far', true),
    { name: 'torso', part: 'torso', at: [0, -15] }, { name: 'head', part: 'head', attach: { part: 'torso', point: 'neck' } },
    ...leg('near', false), ...arm('near', false)
  ] }],
  rig: { body: 'torso', head: 'head', ground: 34, rest: 'stand',
    legs: [['nearThigh', 'nearShin'], ['farThigh', 'farShin']], arms: [['nearUpper', 'nearFore'], ['farUpper', 'farFore']] },
  motions: { idle: { template: 'idle' }, walk: { template: 'walk', speed: 24, stride: 10, lift: 2, bob: 1 },
    run: { template: 'run', speed: 48, stride: 10, lift: 4, bob: 1, lean: 8 }, jump: { template: 'jump' }, attack: { template: 'attack' }, hurt: { template: 'hurt' } },
  sheet: { columns: 8 } };

// The quick start's slime at 32 × 32, breathing in a gentle squash and stretch: a flat mass keeps its base on its
// anchor row, and the idle template's squash keeps the outline's lowest row on rig.ground in every frame. The rest pose
// is named idle-0, the loop's first generated pose, so it stands in for that pose and the sheet holds just the loop.
const slimeIdle = { format: 'pixelforge-poses', version: 1, name: 'slime-idle', width: 32, height: 32,
  palette: { k: '#1d2b3a', d: '#2b7a3d', g: '#3fa34d', l: '#8fd16a', w: '#f4f4e8' },
  ramps: [['d', 'g', 'l']], light: 225,
  parts: {
    body: { mass: { size: [23, 12], ramp: 0, base: 1, outline: 'k', flat: true }, points: { face: [0, -5], shine: [-6, -8] } },
    eyes: { rows: ['ww...ww', 'kk...kk', 'kk...kk'], anchor: [3, 1] },
    shine: { rows: ['ww', 'w.'] }
  },
  poses: [{ name: 'idle-0', duration: 140, origin: [16, 28], parts: [
    { name: 'body', part: 'body', at: [0, -1] },
    { name: 'eyes', part: 'eyes', attach: { part: 'body', point: 'face' } },
    { name: 'shine', part: 'shine', attach: { part: 'body', point: 'shine' } }
  ] }],
  rig: { ground: 28, body: 'body', rest: 'idle-0' },
  motions: { idle: { template: 'idle', frames: 8, squash: 0.15, duration: 140 } },
  sheet: { columns: 8 } };

// A lower third for video: 240 × 32 fills the width of a 1080p frame at scale 8. The panel opens, the title is typed
// in, and the last pose holds. Every duration is a whole number of frames at 30 and at 60 frames per second.
const panel = width => [{ op: 'rect', x: 0, y: 4, w: 3, h: 24, color: 'gold' }, ...(width ? [{ op: 'rect', x: 3, y: 4, w: width, h: 24, color: 'panel' }, { op: 'rect', x: 3, y: 27, w: width, h: 1, color: 'edge' }] : [])];
const title = 'PIXELBOLT', line = 'text to pixels, frame by frame';
const caption = { version: 1, name: 'caption', width: 240, height: 32, palette: { panel: '#141824e6', edge: '#0b0e16', gold: '#f2dc93', ink: '#f2f0e4', soft: '#9fb6c9' },
  frames: [
    { name: 'bar', duration: 100, ops: panel(0) },
    { name: 'open-1', duration: 100, ops: panel(70) },
    { name: 'open-2', duration: 100, ops: panel(150) },
    { name: 'open-3', duration: 100, ops: panel(210) },
    ...[3, 6, title.length].map((letters, i) => ({ name: `type-${i + 1}`, duration: 100, ops: [...panel(210), { op: 'text', x: 11, y: 8, text: title.slice(0, letters), color: 'ink' }] })),
    { name: 'shown', duration: 2000, ops: [...panel(210), { op: 'text', x: 11, y: 8, text: title, color: 'ink' }, { op: 'text', x: 11, y: 18, text: line, color: 'soft' }] }
  ],
  animations: { in: { frames: ['bar', 'open-1', 'open-2', 'open-3', 'type-1', 'type-2', 'type-3', 'shown'], loop: false }, hold: { frames: ['shown'] } },
  sheet: { columns: 2, padding: 1 } };

// A normal pass derived from the spirit, and a small night scene that lights it. Move the light in the scene viewer
// (pixelbolt preview examples/forest-spirit-lit.scene.json) to see the form turn toward it.
const spiritNormals = { format: 'pixelforge-normals', version: 1, recipe: 'forest-spirit.json' };
const litSpirit = { format: 'pixelforge-scene', version: 1, name: 'forest-spirit-lit', width: 72, height: 40, duration: 1200, background: '#141a2a',
  assets: { spirit: { recipe: 'forest-spirit.json', normal: 'forest-spirit-normal.json' } },
  instances: [{ name: 'spirit', asset: 'spirit', at: [24, 8], animation: 'idle' }],
  lighting: { ambient: 0.35, bands: 4, lights: [{ at: [14, 10], height: 12, radius: 48, color: '#fff2d6' }] } };

// Fluid effects: each source is one simulated effect compiled into palette grids (pixelbolt compile x.fluid.json).
// Gases hold their sources with `rate` and colour density and temperature through ramps; liquids are FLIP water.
const fluidSource = (name, width, height, palette, effect, symbols) => ({ format: 'pixelforge-fluid', version: 1, name, width, height, palette, ...(symbols && { symbols }), effects: { [name]: effect } });
const shapeRows = (w, h, at) => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => at(x, y) ?? '.').join(''));
const fireRamp = (keys, thresholds, dither = 0.6) => ({ field: 'temperature', colors: keys, thresholds, dither });
// The source is a disc sunk into the logs, so the flame rises from a dome; quick cooling ends it in tongues.
const campfire = fluidSource('campfire', 32, 48, { u: '#4d4558', S: '#6e6678', r: '#b8322f', o: '#f0772b', y: '#ffcc4d', W: '#fff6d1', b: '#5a3825', B: '#8a5a36', k: '#2a1c18' }, {
  frames: 24, duration: 70, loop: true, seed: 3, walls: ['bottom'], buoyancy: 0.45, vorticity: 0.45, dissipation: 0.065, cooling: 0.24,
  obstacles: [{ symbol: 'logs', x: 3, y: 40 }, { symbol: 'ground', x: 0, y: 46, draw: 'none' }],
  emitters: [{ name: 'fire', at: [16, 42], radius: 6, rate: 1, temperature: 1.1, density: 0.4, velocity: [0, -1.2], noise: 1.4, flicker: 0.6 },
    { name: 'embers', at: [16, 34], radius: 3, rate: 1, sparks: { count: 0.5, life: [8, 14], colors: ['W', 'y', 'y', 'o'], trail: true, angle: [250, 290], speed: [0.3, 0.7], drag: 0.08 } }],
  look: [{ field: 'density', colors: ['u', 'S'], thresholds: [0.16, 0.4], dither: 0.5, pattern: 'value' }, fireRamp(['r', 'o', 'y', 'W'], [0.3, 0.42, 0.62, 1], 0.5)]
}, {
  ground: ['k'.repeat(32), 'k'.repeat(32)], logs: ['....kk..............kk....', '...kBBkk..........kkBBk...', '..kBbbBBkk......kkBBbbBk..', '..kbbbbbBBkk..kkBBbbbbbk..', '...kkbbbbbBBkkBBbbbbbkk...', '.....kkkbbbbBBbbbbkkk.....', '.......kkkkbbbbkkkk.......', '...........kkkk...........'] });
// A cloud of five lobes, three along a flat base and two bumps on top, popping out centre first. Each lobe is one
// emitter held for three frames whose density falls off from its centre to its rim, so the lobes billow out round and,
// as dissipation thins them, part into round balls that shrink away. No drift and little vorticity keep the balls
// round; the hard silhouette leaves no dither shards.
const lobe = (at, radius, start, density) => ({ at, radius, rate: 1, ...(start && { start }), end: start + 3, density, falloff: 0.95, expand: 0.9, noise: 0.3, flicker: 0.2 });
const smokePuff = fluidSource('smoke-puff', 32, 32, { k: '#121019', d: '#5d5872', m: '#9a95ad', l: '#cfcadb', w: '#f8f6fc' }, {
  frames: 19, duration: 60, seed: 5, buoyancy: 0, vorticity: 0.1, dissipation: 0.14, drag: 0.25,
  emitters: [lobe([16.5, 17.5], 4, 0, 1.35), lobe([10.5, 19.5], 3, 1, 1.3), lobe([22.5, 19.5], 3.25, 1, 1.45), lobe([12.5, 13.5], 3, 2, 1.45), lobe([19.5, 12.5], 3.5, 2, 1.6)],
  look: [{ field: 'density', colors: ['m'], thresholds: [0.18], dither: 0 }, { field: 'density', colors: ['l'], thresholds: [0.55], dither: 0 },
    { field: 'shadow', colors: ['d'], thresholds: [0.5], dither: 0 }, { field: 'light', colors: ['w'], thresholds: [0.5], dither: 0 }],
  outline: 'k', cleanup: { strays: true }
});
// A small flash, then six offset sub-blasts with staggered windows: the fireball is lumpy from its first frames and
// churns at the rim where they push into each other. They carry different amounts of smoke, so the cooled cloud has
// thick and thin parts that light and shadow layers model. A slight negative weight lifts the smoke with the fire, so
// the underside trails a soft wake instead of strands, and ordered dither thins the last smoke away instead of
// chipping it into dark chunks. Debris bursts from the rim once the core has formed, so no streak crosses it.
const blast = (at, radius, start, end, density, temperature, expand, i) => ({ name: `blast-${i}`, at, radius, rate: 1, ...(start && { start }), end, density, temperature, expand, noise: 1.6, flicker: 0.5 });
const debris = (at, angle, i) => ({ name: `debris-${i}`, at, radius: 1.5, burst: 1, start: 2,
  sparks: { count: 2.7, life: [9, 15], colors: ['W', 'y', 'y', 'o', 'r'], trail: true, angle: [angle - 22, angle + 22], speed: [3, 5.5], gravity: [0, 0.12], drag: 0.03, follow: 0 } });
const explosion = fluidSource('explosion', 64, 64, { W: '#fffbe6', y: '#ffd34d', o: '#ff8a2b', r: '#d6402b', R: '#8f2a2e', s: '#b3a5ad', S: '#867882', k: '#5a4e5b' }, {
  frames: 32, duration: 60, seed: 7, buoyancy: 0.18, weight: -0.04, vorticity: 0.3, dissipation: 0.1375, cooling: 0.16, drag: 0.1,
  emitters: [{ name: 'flash', at: [32, 37], radius: 5, burst: 1, temperature: 2.6, flicker: 0.4 },
    blast([32, 38], 4, 0, 3, 2, 2.8, 3.2, 1), blast([24, 37], 3, 1, 4, 2.4, 2.4, 2.4, 2), blast([40, 33], 3, 2, 4, 1, 2, 2.4, 3),
    blast([37, 44], 2.5, 1, 3, 1.4, 2, 1.8, 4), blast([30, 31], 3, 1, 3, 3.4, 2.2, 2, 5), blast([27, 43], 2, 3, 5, 0.8, 1.8, 1.6, 6),
    debris([15, 33.5], 190, 1), debris([20, 27], 220, 2), debris([26, 21], 250, 3), debris([36.5, 22.5], 290, 4), debris([43, 27], 320, 5), debris([47, 34], 350, 6)],
  look: [{ field: 'density', colors: ['k'], thresholds: [0.08], dither: 0.6, pattern: 'bayer4' }, { field: 'density', colors: ['S', 's'], thresholds: [0.2, 0.45], dither: 0.65, pattern: 'value' },
    { field: 'shadow', colors: ['k'], thresholds: [0.3], dither: 0.4, pattern: 'value' }, { field: 'light', colors: ['s'], thresholds: [0.6], dither: 0.4, pattern: 'value' },
    { field: 'temperature', colors: ['R', 'r', 'o', 'y', 'W'], thresholds: [0.28, 0.5, 1, 1.7, 2.4], dither: 0.5, pattern: 'value' }],
  cleanup: { strays: true }
});
const steamVent = fluidSource('steam-vent', 32, 48, { q: '#7d8ca3', Q: '#b4c2d6', w: '#eef4fb', p: '#4a5160', P: '#6f7889', h: '#9aa3b3', k: '#262a33' }, {
  frames: 24, duration: 70, loop: true, seed: 2, walls: ['bottom'], buoyancy: 0.25, vorticity: 0.7, dissipation: 0.11, cooling: 0.1, drag: 0.04,
  obstacles: [{ symbol: 'pipe', x: 11, y: 42 }],
  // A slow updraft over the column that spreads as it climbs, so each puff widens and thins as it rises instead of
  // being stretched into strings by its own heat. Three puffs a loop, each a soft disc (a faint halo, a light body and
  // a one-frame hot core, so only a small core flashes white) that leaves the pipe turning, so it rolls into a curled
  // cap; between puffs a drain clears the nozzle. Two bands under the top edge thin the steam out before it gets there.
  emitters: [{ name: 'billow', at: [16, 20], radius: 17, rate: 0.2, velocity: [0, -2.8], expand: 6 },
    ...[0, 8, 16].flatMap((start, i) => [
      { name: `puff-${i + 1}`, at: [16, 39.5], radius: 3.5, rate: 1, start, end: start + 2, density: 0.25, temperature: 0.8, velocity: [[-0.6, 0.6, 0][i], -2], expand: 1, noise: 0.8, flicker: 0.3, vortex: [0.8, -0.8, 0.6][i] },
      { name: `body-${i + 1}`, at: [16, 40], radius: 2, rate: 1, start, end: start + 2, density: 0.36, flicker: 0.3 },
      { name: `core-${i + 1}`, at: [16, 40], radius: 1, rate: 1, start, end: start + 1, density: 1.45 },
      { name: `gap-${i + 1}`, at: [16, 39], area: [8, 4], rate: 1, start: start + 3, end: start + 8, density: -1, temperature: -1 }]),
    { name: 'thin', at: [16, 6], area: [32, 10], rate: 1, density: -0.15 }, { name: 'fade', at: [16, 2], area: [32, 6], rate: 1, density: -0.4 }],
  // The faintest steam dissolves through white-noise dither into loose specks instead of an even checkerboard; denser
  // steam uses ordered dither.
  look: [{ field: 'density', colors: ['q'], thresholds: [0.11], dither: 0.65, pattern: 'noise' }, { field: 'density', colors: ['q'], thresholds: [0.25], dither: 0.45 },
    { field: 'density', colors: ['Q', 'w'], thresholds: [0.42, 1], dither: 0.6 }]
}, { pipe: ['kkkkkkkkkk', 'kPhhhhhhPk', 'kpPPPPPPpk', '.kpPPPPpk.', '.kpPPPPpk.', '.kpPPPPpk.'] });
// Two comets circle the rim: a hot head (cyan, with a white glint) over a thin, pulsing trail of dye, laid along their
// path so it stays unbroken. The swirl turns slower than the comets and pulls inward, so each trail lags and winds into
// the centre, thinning and darkening as it goes. The comets ride an ellipse and the pull breathes once a loop, so the
// spiral stretches into a long S and closes into a ring instead of turning rigidly. A drain at the centre swallows the
// tails; the round eye rolls twice as fast as the comets. Sparkles ride the flow inward.
const comet = (phase, i) => {
  const at = [24, 24], orbit = { radius: [16, 13], period: 24, ...(phase && { phase }) };
  return [{ name: `comet-${i}`, at, radius: 2.2, rate: 1, temperature: 1.05, orbit },
    { name: `glint-${i}`, at, radius: 1.5, rate: 1, temperature: 1.45, orbit },
    { name: `halo-${i}`, at, radius: 2.4, rate: 1, density: 0.15, orbit },
    { name: `tail-${i}`, at, radius: 1.2, rate: 1, density: 1.1, pulse: { amplitude: 0.5, period: 6 }, orbit,
      sparks: { count: 0.7, life: [12, 20], colors: ['W', 'c', 'c', 'm'], angle: [0, 360], speed: [0.1, 0.3], follow: 1, drag: 0.08 } }];
};
const magicSwirl = fluidSource('magic-swirl', 48, 48, { v: '#3d2a6b', p: '#7a44c9', m: '#c06cf0', c: '#6fe3f2', W: '#f4f0ff' }, {
  frames: 24, duration: 60, loop: true, seed: 9, substeps: 1, buoyancy: 0, vorticity: 0.2, dissipation: 0.08, cooling: 0.35, drag: 0.05,
  emitters: [{ name: 'swirl', at: [24, 24], radius: 21, rate: 1, vortex: 0.7, expand: -1.15, pulse: { amplitude: 0.4, period: 24 } },
    ...comet(0, 1), ...comet(180, 2),
    { name: 'drain', at: [24, 24], radius: 5, rate: 1, density: -0.25 }, { name: 'core', at: [24, 24], radius: 2, rate: 1, density: 0.3, temperature: 1.1 },
    { name: 'eye', at: [24, 24], radius: 1, rate: 1, density: 0.5, temperature: 1.3, orbit: { radius: 1.5, period: 12 } }],
  look: [{ field: 'density', colors: ['v', 'p', 'm'], thresholds: [0.12, 0.3, 0.65], dither: 0.5, pattern: 'value' }, fireRamp(['c', 'W'], [0.5, 0.9], 0.25)]
});
const torch = fluidSource('torch', 16, 32, { r: '#c23b2e', o: '#f57f2a', y: '#ffd257', W: '#fff7d6', b: '#5c3a24', B: '#8c5a32', g: '#8a8f99', G: '#c4c8cf', k: '#221a1c' }, {
  frames: 16, duration: 70, loop: true, seed: 4, buoyancy: 0.45, vorticity: 0.45, dissipation: 0.14, cooling: 0.34, drag: 0.03,
  obstacles: [{ symbol: 'torch', x: 5, y: 22 }],
  emitters: [{ name: 'flame', at: [8.5, 21], radius: 3.5, rate: 1, temperature: 1.1, velocity: [0, -1], noise: 0.8, flicker: 0.35 },
    { name: 'embers', at: [8.5, 15], radius: 1.5, rate: 1, sparks: { count: 0.15, life: [5, 8], colors: ['W', 'y', 'o'], trail: true, angle: [255, 285], speed: [0.3, 0.5] } }],
  look: [fireRamp(['r', 'o', 'y', 'W'], [0.32, 0.44, 0.64, 0.98], 0.5)]
}, { torch: ['kGGGGGk', 'kgGGGgk', '.kgggk.', '.kBbbk.', '.kBbbk.', '.kBbbk.', '.kBbbk.', '.kBbbk.', '.kBbbk.', '..kkk..'] });
// Water: a body colour, then depth bands from a one-pixel highlight on the surface down to the deep colour.
const water = { B: '#1d3f7a', b: '#2f6fc0', c: '#5fb4e8', w: '#dff6ff' }, stone = { r: '#5b5568', R: '#433e50', k: '#2b2735' };
const waterLook = (deep, band = 4) => [{ field: 'density', colors: ['b'], thresholds: [0.5], dither: 0 }, { field: 'depth', colors: ['w', 'c', 'b', 'B'], thresholds: [1, 2, band, deep], dither: 0 }];
// Spray thrown up where water lands; in a liquid it ends where it falls back into the water.
const spray = (name, at, start, count, angle, extra = {}) => ({ name, at, area: [2, 1], burst: 1, start, density: 0, sparks: { count, life: [12, 20], colors: ['w', 'w', 'c'], angle, speed: [2.8, 4], gravity: [0, 0.55], drag: 0.02, follow: 0, ...extra } });
// A round drop falls and speeds up; where it lands, whitewater throws a crown of spray streaks and drops off the crater's
// rims, and the crater springs back as a hump in the middle. A low flip share and drag calm the waves, and a slow drain
// at the bottom takes back the drop's water, so the pool settles flat at its old level instead of a fraction of a pixel
// higher.
const splash = fluidSource('splash', 48, 40, water, {
  kind: 'liquid', frames: 40, duration: 60, seed: 3, walls: ['left', 'right', 'bottom'], gravity: [0, 0.6], flip: 0.2, drag: 0.08, tension: 1.2,
  fill: [{ x: 0, y: 28, w: 48, h: 12 }, { at: [24, 5], radius: 3, velocity: [0, 0.5] }],
  emitters: [{ name: 'settle', at: [24, 38], area: [48, 2], rate: 1, start: 12, end: 29, density: -0.017 },
    { name: 'rebound', at: [24, 31], area: [4, 3], rate: 1, start: 15, end: 17, density: 0, velocity: [0, -2] }],
  whitewater: [{ impact: 1.5, chance: 0.45, throw: 1.8, spread: 30, life: [12, 20], colors: ['w', 'w', 'c'], trail: true },
    { impact: 2.5, chance: 0.3, throw: 1.6, spread: 20, life: [12, 20], colors: ['w', 'w', 'c'], size: 2 }],
  look: waterLook(9, 5), cleanup: { strays: true }
});
// A stream runs along the cliff top and pours over the mossy lip in one unbroken arc that falls clear of the cliff face,
// thick where it leaves the lip and thinning as it speeds up, into the middle of a basin. The source pulses, so fuller and
// thinner stretches run down the fall, and glints carried by the flow streak down it; the fall is drawn by its speed,
// darker where it leaves the lip with lighter flecks as it speeds up. Whitewater froths its edges with foam that rides the
// surface down and drifts where the water churns, and throws the odd droplet off it; short-lived spray rises where it
// lands. A seep along the basin's surface takes much of the inflow, so the level stays just above the right
// lip and a steady stream spills over it through the open edge.
const waterfall = fluidSource('waterfall', 48, 64, { ...water, ...stone, L: '#7b7590', m: '#5f9a4a' }, {
  kind: 'liquid', frames: 24, duration: 60, loop: true, seed: 5, warmup: 4, substeps: 3, walls: ['left'], flip: 0.6, drag: 0.06,
  obstacles: [{ symbol: 'cliff', x: 0, y: 12 }, { symbol: 'basin', x: 0, y: 49 }], fill: [{ x: 18, y: 49, w: 22, h: 12 }],
  emitters: [{ name: 'source', at: [7.5, 10], area: [15, 4], rate: 1, velocity: [1.1, 0], pulse: { amplitude: 0.5, period: 6 } },
    { name: 'spray', at: [28, 46], radius: 2, rate: 1, density: 0, sparks: { count: 0.8, life: [5, 9], colors: ['w', 'c'], angle: [220, 320], speed: [0.8, 1.6], gravity: [0, 0.25], follow: 0 } },
    { name: 'seep', at: [27, 48.5], area: [18, 3], rate: 1, density: -0.05 },
    { name: 'glints', at: [16, 10], radius: 1.5, rate: 1, density: 0, sparks: { count: 1, life: [18, 26], colors: ['w', 'w', 'w', 'c'], trail: true, follow: 1, speed: 0, drag: 0 } }],
  whitewater: [{ speed: 3, chance: 0.05, throw: 1.2, spread: 15, life: [8, 14], colors: ['w', 'c'] }, { speed: 1.4, chance: 0.04, life: [3, 6], colors: ['w', 'c'], follow: 1 }],
  look: [...waterLook(8), { field: 'speed', colors: ['b', 'c'], thresholds: [1.6, 3.4], dither: 0 }], cleanup: { strays: true }
}, {
  // Rock in strata: a dark seam every five rows, a lit edge along the face.
  cliff: shapeRows(19, 52, (x, y) => {
    const face = y < 3 ? 18 : 15 + [0, 1, 0, -1, 0, 1, 1, 0][Math.floor(y / 6) % 8];
    return x > face ? null : y === 0 ? 'm' : x === face ? 'k' : x === face - 1 ? 'L' : y % 5 === 0 || (x + Math.floor(y / 5) * 3) % 9 === 0 ? 'R' : 'r';
  }),
  // The basin's floor ends at a lip; water over the lip spills down outside it and leaves through the open bottom.
  basin: shapeRows(44, 15, (x, y) => (y >= 12 || (x >= 40 && y >= 1) ? (x === 40 && y < 12 ? 'L' : y === 12 || (x * 2 + y) % 7 === 0 ? 'R' : 'r') : null))
});
// A drop gathers under the stalactite, falls and splashes; a slow soak drains as much as each drop adds.
const drip = fluidSource('drip', 16, 32, { ...water, ...stone }, {
  kind: 'liquid', frames: 24, duration: 70, loop: true, seed: 2, warmup: 3, walls: ['left', 'right', 'bottom'], gravity: [0, 0.4], flip: 0, drag: 0.04, tension: 2,
  obstacles: [{ symbol: 'rock', x: 0, y: 0 }, { symbol: 'ground', x: 0, y: 29 }], fill: [{ x: 1, y: 25, w: 14, h: 4 }],
  // A bead hangs at the tip, held still by velocity [0, 0], and swells when the wider emitter joins; when both stop,
  // the drop falls, speeding up, as one compact two-pixel-wide drop with a highlight on top (strong cohesion and little
  // drag keep it whole). A pair of droplets flies out either side where it lands. The soak drains the row above the
  // pool's level, so each drop's water runs off and the surface settles flat between drops.
  emitters: [{ name: 'bead', at: [8, 7.5], radius: 1.4, rate: 1, end: 8, velocity: [0, 0] }, { name: 'swell', at: [8, 8], radius: 1.5, rate: 1, start: 4, end: 8, velocity: [0, 0] },
    spray('spray-left', [6.5, 25.5], 18, 2, [220, 250], { life: [8, 14], speed: [1.3, 2], gravity: [0, 0.5] }),
    { name: 'soak', at: [8, 26], area: [14, 2], rate: 1, density: -0.1 },
    spray('spray-right', [9.5, 25.5], 18, 2, [290, 320], { life: [8, 14], speed: [1.3, 2], gravity: [0, 0.5] })],
  look: [{ field: 'density', colors: ['b'], thresholds: [0.5], dither: 0 }, { field: 'depth', colors: ['w', 'c'], thresholds: [1, 2], dither: 0 }], cleanup: { strays: true }
}, {
  rock: ['RrrrrRrrrrRrrrrR', 'rrrRrrrrRrrrrRrr', '...rrrRrrrrRr...', '....RrrrrRrr....', '.....rrRrrr.....', '......rrrr......', '.......rR.......'],
  ground: ['R..............R', 'R..............R', 'RRRRRRRRRRRRRRRR']
});
// A stoppered round-bottom flask: the surface heaves and rocks while bubbles rise and pop.
const flask = shapeRows(32, 40, (x, y) => {
  const dx = x - 15.5, d = Math.sqrt(dx * dx + (y - 26.5) * (y - 26.5)), side = Math.abs(dx);
  if (y >= 2 && y < 4 && side < 5) return y === 2 ? 'k' : 'h';
  if (y >= 2 && y < 17 && side < 4 && side >= 2.5) return side >= 3.5 ? 'k' : 'h';
  if (d >= 10.5 && d < 12.5 && !(y < 17 && side < 2.5)) return d >= 11.5 ? 'k' : (dx < 0 && y < 26.5 ? 'H' : 'h');
  return null;
});
const potion = fluidSource('potion', 32, 40, { G: '#1f6a3f', g: '#3fa34d', l: '#8be36a', w: '#e6ffc9', k: '#1b1a26', h: '#8fa3b8', H: '#e4f0ff' }, {
  kind: 'liquid', frames: 24, duration: 70, loop: true, seed: 8, walls: ['bottom'], gravity: [0, 0.25], flip: 0.8, drag: 0.04,
  obstacles: [{ symbol: 'flask', x: 0, y: 0 }], fill: [{ at: [15.5, 26.5], radius: 10.5, x: 0, y: 22, w: 32, h: 18 }],
  emitters: [{ name: 'heat', at: [15.5, 34], area: [8, 2], rate: 1, density: 0, velocity: [0, -2], pulse: { amplitude: 1, period: 12 } },
    { name: 'boil', at: [15.5, 24], area: [18, 4], rate: 1, density: 0, noise: 0.2 },
    // Bubbles start across the bottom and rise mostly under their own lift, so the stirring only sways them; where they
    // leave the liquid they pop, a ring and then two droplets above the surface. The boil only ruffles the surface.
    { name: 'bubbles', at: [15.5, 33.5], area: [14, 3], rate: 1, density: 0, sparks: { count: 0.3, life: [24, 32], colors: ['w'], size: 2, angle: 270, speed: 0.8, gravity: [0, -0.1], drag: 0.05, follow: 0.2, pop: true } },
    // Two pushes take turns over the loop, so the surface rocks from side to side.
    ...[[10, 0.4, 0], [21, -0.4, 180]].map(([x, push, phase], i) => ({ name: `rock-${i + 1}`, at: [x, 26], area: [6, 6], rate: 1, density: 0, velocity: [push, -0.2], pulse: { amplitude: 1, period: 24, ...(phase && { phase }) } }))],
  look: [{ field: 'density', colors: ['g'], thresholds: [0.5], dither: 0 }, { field: 'depth', colors: ['w', 'l', 'g', 'G'], thresholds: [1, 2, 4, 9], dither: 0 }], cleanup: { strays: true }
}, { flask });
// Honey runs off a dipper into a jar as one unbroken rope that folds and piles into a mound where it lands, and the mound
// slowly sinks into a calm surface: viscosity resists shearing, never falling, so the rope falls as fast as water would
// but never breaks into drops or throws a wave; it thins as it speeds up, as a honey stream does. APIC keeps the folds
// turning instead of smearing them, a little adhesion holds the honey to the glass, and low cohesion keeps the thin rope
// from pulling itself into beads. The source swells and thins a little over the loop (more makes the rope sway differently
// each cycle, so the loop's blended closing frames show two ropes at once), and a seep at the surface keeps the level.
const dipper = shapeRows(28, 9, (x, y) => {
  if (x >= 9 && y >= 3 && y <= 5) return y === 3 ? 'n' : y === 5 ? 'b' : 'B';
  if (x > 9) return null;
  const r = Math.abs(y - 4);
  if (r > 4 - (x === 0 || x === 9 ? 1 : 0)) return null;
  return x % 3 === 0 || r === 4 ? 'b' : y < 4 ? 'n' : 'B';
});
const jar = shapeRows(26, 22, (x, y) => (y === 21 || x === 0 || x === 25 || (y <= 1 && (x <= 2 || x >= 23)) ? 'k' : x === 1 || x === 24 ? 'q' : null));
const honey = fluidSource('honey', 40, 48, { H: '#fff3b0', y: '#f7c948', a: '#e09a1f', A: '#a85f0e', b: '#6e4426', B: '#9c6a3c', n: '#c79a5b', q: '#c7d6e6', k: '#1b1a26' }, {
  kind: 'liquid', frames: 24, duration: 70, loop: true, warmup: 3, seed: 6, iterations: 24, walls: ['left', 'right', 'bottom'], viscosity: 10, apic: true, adhesion: 1.5, tension: 0.3,
  obstacles: [{ symbol: 'dipper', x: 12, y: 2 }, { symbol: 'jar', x: 7, y: 26 }], fill: [{ x: 9, y: 37, w: 22, h: 10 }],
  emitters: [{ name: 'drizzle', at: [16.5, 13], radius: 2, rate: 1, velocity: [0, 0.8], pulse: { amplitude: 0.15, period: 12 } },
    { name: 'seep', at: [20, 36.5], area: [22, 1], rate: 1, density: -0.25 }],
  // The rope is thin, so it is drawn by its speed as well as its density, as the waterfall is. The jar's honey darkens in
  // bands with depth; the rope, a long column from the dipper that would darken in the same bands, is drawn over wherever
  // it moves in the jar's middle amber. Then both are lit from the upper left, one ramp for the rope and the jar: a pale
  // gloss line on the lit side and a dark amber edge on the other.
  look: [{ field: 'density', colors: ['a'], thresholds: [0.5], dither: 0 }, { field: 'speed', colors: ['a'], thresholds: [0.3], dither: 0 }, { field: 'depth', colors: ['H', 'y', 'a', 'A'], thresholds: [1, 2, 3, 7], dither: 0 },
    { field: 'speed', colors: ['a'], thresholds: [0.3], dither: 0 }, { field: 'shadow', colors: ['A'], thresholds: [0.65], dither: 0 }, { field: 'light', colors: ['y', 'H'], thresholds: [0.4, 0.75], dither: 0 }], cleanup: { strays: true }
}, { dipper, jar });
// A blob of slime drops, squashes flat where it lands, springs up taller than it is wide, squashes again and wobbles to
// rest as a dome that holds its shape. A high yield stress keeps it elastic through the landing, so it bounces back
// instead of spreading flat as water or honey would; four substeps damp the wobble less, and cohesion rounds it.
const slime = fluidSource('slime', 32, 32, { G: '#1f6a3f', g: '#3fa34d', l: '#8be36a', w: '#e6ffc9', k: '#1b1a26', ...stone }, {
  kind: 'liquid', frames: 40, duration: 60, seed: 4, substeps: 4, walls: ['left', 'right', 'bottom'], gravity: [0, 0.5], yield: 16, apic: true, tension: 2,
  obstacles: [{ symbol: 'ground', x: 0, y: 28 }], fill: [{ at: [15.5, 9.5], radius: 6.5, velocity: [0, 0.5] }], emitters: [],
  // Lit from the upper left: a pale top edge, a dark rim away from the light and a glint toward it. Lit rims rather than
  // depth bands, which drew a dark wedge inside the ball.
  look: [{ field: 'density', colors: ['g'], thresholds: [0.5], dither: 0 }, { field: 'depth', colors: ['l', 'g'], thresholds: [1, 2], dither: 0 },
    { field: 'shadow', colors: ['G'], thresholds: [0.5], dither: 0 }, { field: 'light', colors: ['w'], thresholds: [0.7], dither: 0 }], outline: 'k', cleanup: { strays: true, corners: true }
}, { ground: Array.from({ length: 4 }, (_, y) => shapeRows(32, 1, x => (y === 0 ? (x % 2 ? 'r' : 'R') : y === 2 && x % 4 === 1 ? 'R' : 'r'))[0]) });
// Wet snow on a house's 45-degree roof slides off as one slab, pours over the eave and settles in a drift against the
// wall. The roof is a smooth obstacle, so the snow (a soft yield-stress liquid with slip) slides down its pixel steps
// instead of catching on them; a key firms the snow once it has landed, so the drift stays put rather than skidding on.
const roofSlab = shapeRows(22, 24, (x, y) => (y === x ? 't' : y === x + 1 ? 'r' : y === x + 2 || (y > x + 2 && x < 2) ? 'R' : null));
const roofWall = shapeRows(20, 22, (x, y) => (y < x - 9 ? null : x >= 8 && x <= 12 && y >= 10 && y <= 14 ? (x === 10 || y === 12 ? 'M' : 'y') : y % 4 === 0 ? 'M' : 'm'));
const roofSnow = fluidSource('roof-snow', 56, 44, { w: '#f4f8ff', s: '#b8c8e8', S: '#7f93bf', o: '#2a3150', r: '#a3483a', R: '#6f2f2a', t: '#c96a4f', m: '#6b5a6e', M: '#4a3d52', y: '#f2d27a', g: '#3d4a3a', G: '#2c3528' }, {
  kind: 'liquid', frames: 48, duration: 60, seed: 3, walls: ['left', 'right', 'bottom'], gravity: [0, 0.3], yield: 0.9, slip: true, apic: true, tension: 1.2,
  keys: [{ frame: 26, yield: 4, over: 4 }],
  // The house is drawn in front of the snow's outline, so the outline stops at the wall instead of covering its edge.
  obstacles: [{ symbol: 'wall', x: 2, y: 18 }, { symbol: 'slab', x: 2, y: 6, surface: 'smooth' }, { symbol: 'ground', x: 0, y: 40 }],
  fill: [{ x: 6, y: 2, w: 12, h: 7 }], emitters: [],
  // White snow with a two-step blue shadow away from the light, outlined.
  look: [{ field: 'density', colors: ['w'], thresholds: [0.5], dither: 0 }, { field: 'shadow', colors: ['s', 'S'], thresholds: [0.4, 0.8], dither: 0 }],
  light: [-1, -1], outline: 'o', cleanup: { strays: true, corners: true }
}, { slab: roofSlab, wall: roofWall, ground: shapeRows(56, 4, (x, y) => (y === 0 ? 'g' : 'G')) });
// A plank dam holds back a tank of water until frame 14, when an obstacle key takes it away: the water floods out as a
// wave, rolls over a rock and splashes off the far wall, throwing whitewater where it lands. It runs on until the
// water has settled, so the one-shot ends at rest.
const damBreak = fluidSource('dam-break', 64, 36, { B: '#1d3f7a', b: '#2f6fc0', c: '#5fb4e8', w: '#dff6ff', p: '#8a5a36', P: '#5a3825', n: '#c79a5b', g: '#4a4a5e', G: '#33334a' }, {
  kind: 'liquid', frames: 70, duration: 60, seed: 5, walls: ['left', 'right', 'bottom'], gravity: [0, 0.3], apic: true,
  // Water sloshes on long after the wave breaks, so it thickens over frames 45-55 and the one-shot ends at rest.
  keys: [{ frame: 45, viscosity: 4, over: 10 }],
  obstacles: [{ symbol: 'basin', x: 0, y: 30 }, { symbol: 'rock', x: 40, y: 25 }, { symbol: 'plank', x: 20, y: 8, keys: [{ frame: 14, show: false }] }],
  fill: [{ x: 0, y: 10, w: 20, h: 20 }], emitters: [],
  whitewater: [{ impact: 1.2, chance: 0.35, throw: 0.6, spread: 30, colors: ['w', 'c'], life: [6, 12] }],
  look: [{ field: 'density', colors: ['b'], thresholds: [0.5], dither: 0 }, { field: 'depth', colors: ['w', 'c', 'b', 'B'], thresholds: [1, 2, 5, 9], dither: 0 }], cleanup: { strays: true }
}, {
  plank: shapeRows(3, 22, (x, y) => (x === 1 ? (y % 6 === 0 ? 'n' : 'p') : 'P')), basin: shapeRows(64, 6, (x, y) => (y === 0 ? 'g' : 'G')),
  rock: shapeRows(9, 5, (x, y) => ((x - 4) * (x - 4) / 20 + (y - 5) * (y - 5) / 25 < 1 ? (y < 2 ? 'g' : 'G') : null))
});
// A stone drops onto the ground (an obstacle key moves it down over five frames) and throws a wave of dust out both
// ways. Gas can't be thrown through still air, but dust can: the dust rides on carriers that slow by drag and hand it to
// the air as they go, so the clouds roll out, billow, slow and thin away, while two small warm puffs rise beside the
// stone. It ends empty.
const dustThrow = dir => ({ at: [32 + 6 * dir, 26], area: [5, 3], burst: 1, start: 6, density: 1.6, velocity: [3.4 * dir, -0.8], noise: 0.6, carry: { drag: 0.22, release: 0.24, gravity: [0, 0.04] } });
const dustPuff = dir => ({ at: [32 + 7 * dir, 24], radius: 2, burst: 1, start: 6, density: 0.8, temperature: 0.6, velocity: [1.2 * dir, -0.8] });
const dustWave = fluidSource('dust-wave', 64, 32, { d: '#6e5a48', l: '#9c8268', L: '#c9b08f', o: '#2b2230', s: '#8a8a9e', S: '#5e5e74', h: '#c4c4d4', g: '#4d3f36', G: '#352b26' }, {
  frames: 26, duration: 60, seed: 7, walls: ['bottom'], buoyancy: 0.05, vorticity: 0.6, dissipation: 0.07, cooling: 0.08,
  obstacles: [{ symbol: 'ground', x: 0, y: 28 }, { symbol: 'stone', x: 27, y: 0, keys: [{ frame: 1, y: 20, over: 5 }] }],
  emitters: [dustThrow(-1), dustThrow(1), dustPuff(-1), dustPuff(1)],
  look: [{ field: 'density', colors: ['d'], thresholds: [0.1], dither: 0.2 }, { field: 'density', colors: ['l'], thresholds: [0.32], dither: 0.2 }, { field: 'light', colors: ['L'], thresholds: [0.5], dither: 0 }], cleanup: { strays: true }
}, {
  stone: shapeRows(10, 8, (x, y) => { const d = (x - 4.5) * (x - 4.5) / 22 + (y - 3.5) * (y - 3.5) / 14; return d < 1 ? (x + y < 6 ? 'h' : d > 0.6 ? 'S' : 's') : null; }),
  ground: shapeRows(64, 4, (x, y) => (y === 0 ? 'g' : 'G'))
});
// A ball of slime bursts in mid-air: its fill breaks into five chunks with a pixel of air between them, each flying out
// at its own speed (an outward push on one blob would be cancelled by the pressure solve), and they land and wobble into
// mounds. Cohesion rounds the chunks in flight; a moderate yield lets them squash and spring back.
const slimeBurst = fluidSource('slime-burst', 56, 40, { G: '#1f6a3f', g: '#3fa34d', l: '#8be36a', w: '#e6ffc9', k: '#1f2a24', r: '#5b5568', R: '#433e50' }, {
  kind: 'liquid', frames: 40, duration: 60, seed: 9, substeps: 4, walls: ['left', 'right', 'bottom'], gravity: [0, 0.25], yield: 4, apic: true, tension: 3.2,
  obstacles: [{ symbol: 'ground', x: 0, y: 36 }],
  fill: [{ at: [28, 17], radius: 7.5, burst: { speed: [1.2, 1.8], pieces: 5 } }], emitters: [],
  look: [{ field: 'density', colors: ['g'], thresholds: [0.5], dither: 0 }, { field: 'shadow', colors: ['G'], thresholds: [0.5], dither: 0 }, { field: 'light', colors: ['l', 'w'], thresholds: [0.45, 0.8], dither: 0 }],
  outline: 'k', cleanup: { strays: true, corners: true }
}, { ground: shapeRows(56, 4, (x, y) => (y === 0 ? 'r' : 'R')) });
// Cold, stiff honey (viscosity 64) clings under a wooden spoon until a key thins it at frame 14, as if it warmed: it
// stretches, lets go and drops into a bowl of honey, and a second key thickens it again so the bowl settles. The spoon
// is smooth, so only adhesion holds the honey on; a pixel spoon's suction would hold the drop however runny it got.
const spoon = shapeRows(30, 5, (x, y) => {
  if (x < 18) return y === 1 ? 'n' : y === 2 ? 'B' : null;
  const dx = (x - 23.5) / 6.5, under = 1 + Math.floor(3.4 * Math.sqrt(Math.max(0, 1 - dx * dx)));
  return y === 0 && x > 18 ? 'n' : y >= 1 && y <= under ? (y === under ? 'b' : 'B') : null;
});
const bowl = shapeRows(28, 10, (x, y) => { const inner = (x - 13.5) * (x - 13.5) / 156 + (y + 1) * (y + 1) / 100, outer = (x - 13.5) * (x - 13.5) / 196 + (y + 1) * (y + 1) / 121; return outer < 1 && inner >= 1 ? (y > 6 ? 'Q' : 'q') : null; });
const honeyDrop = fluidSource('honey-drop', 40, 48, { H: '#fff3b0', y: '#f7c948', a: '#e09a1f', A: '#a85f0e', b: '#6e4426', B: '#9c6a3c', n: '#c79a5b', q: '#c7d6e6', Q: '#8fa4bd', k: '#1b1a26' }, {
  kind: 'liquid', frames: 44, duration: 70, seed: 6, iterations: 24, walls: ['left', 'right', 'bottom'], gravity: [0, 0.3], viscosity: 64, apic: true, adhesion: 4, tension: 0.3,
  keys: [{ frame: 14, viscosity: 3, over: 2 }, { frame: 30, viscosity: 16, over: 6 }],
  obstacles: [{ symbol: 'spoon', x: 2, y: 6, surface: 'smooth' }, { symbol: 'bowl', x: 6, y: 36 }],
  fill: [{ at: [25.5, 13.6], radius: 3.4 }, { x: 9, y: 39, w: 22, h: 5 }], emitters: [],
  look: [{ field: 'density', colors: ['a'], thresholds: [0.5], dither: 0 }, { field: 'depth', colors: ['H', 'y', 'a', 'A'], thresholds: [1, 2, 3, 7], dither: 0 }, { field: 'shadow', colors: ['A'], thresholds: [0.65], dither: 0 }, { field: 'light', colors: ['y', 'H'], thresholds: [0.4, 0.75], dither: 0 }],
  cleanup: { strays: true }
}, { spoon, bowl });
const fluids = { campfire, 'smoke-puff': smokePuff, explosion, 'steam-vent': steamVent, 'magic-swirl': magicSwirl, torch, splash, waterfall, drip, potion, honey, slime, 'roof-snow': roofSnow, 'dam-break': damBreak, 'dust-wave': dustWave, 'slime-burst': slimeBurst, 'honey-drop': honeyDrop };

await mkdir(new URL('../examples/', import.meta.url), { recursive: true });
// Authored sources are pretty-printed; compiled recipes use the CLI's compact formatting.
const authored = { 'forest-spirit': forest, ember, coin, shrine, caption, 'effects.fx': effects, 'hero-magic.fx': heroMagic, 'swing-trail.fx': swingTrail, 'fluid-blast.fx': fluidBlast, 'swing.poses': swing, 'hero.poses': hero, 'slime-idle.poses': slimeIdle, 'forest-spirit.normals': spiritNormals, 'forest-spirit-lit.scene': litSpirit, ...Object.fromEntries(Object.entries(fluids).map(([name, source]) => [`${name}.fluid`, source])), ...Object.fromEntries(Object.entries(wavePresets).map(([name, source]) => [`${name}.wave`, source])), ...Object.fromEntries(Object.entries(spellPresets).map(([name, source]) => [`${name}.fx`, source])), ...Object.fromEntries(Object.entries(spellLibrary).map(([element, source]) => [`${element}-spells.fx`, source])) };
// Autotile sets drawn from terrain descriptions (scripts/terrain-presets.mjs).
Object.assign(authored, terrainPresets);
// Electric gases: arcs, lightning and plasma (scripts/plasma-presets.mjs).
for (const [name, source] of Object.entries(plasmaPresets)) authored[`${name}.fluid`] = source;
const compiled = { effects: compileEffects(effects).recipe, swing: compilePoses(swing).recipe, 'forest-spirit-normal': compileNormals({ ...spiritNormals, recipe: forest }).recipe };
// Compact, as compiled files are: whatever fits in 120 columns stays on one line and grids keep one row per line, so
// an agent reading an example pays for its content rather than its indentation.
for (const [name, value] of Object.entries(authored)) await writeFile(new URL(`../examples/${name}.json`, import.meta.url), formatJSON(value));
for (const [name, value] of Object.entries(compiled)) await writeFile(new URL(`../examples/${name}.json`, import.meta.url), formatJSON(value));
