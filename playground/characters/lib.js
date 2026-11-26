// The interactive Character & Walk-Cycle Studio's pure logic, without DOM or static imports so Node tests run
// exactly what the browser page runs.
//
// A share link encodes the engine version, character preset, animation, playback speed and any recolored palette keys:
//   https://skulitom.github.io/Pixelbolt/playground/characters/#v=0.21.0&c=four-way-mage&a=walk-down&s=1&p=r:8b2635,c:ffb703

export const CHARACTER_TOY_VERSION = '0.21.0';
export const LINK_LIMIT = 16384;
export const SPEEDS = [0.5, 1, 1.5, 2];
export const BACKGROUNDS = [
  { id: 'dark', title: 'Night', color: '#15161f', rgb: [21, 22, 31] },
  { id: 'meadow', title: 'Meadow', color: '#3b6437', rgb: [59, 100, 55] },
  { id: 'stone', title: 'Stone', color: '#454856', rgb: [69, 72, 86] },
  { id: 'light', title: 'Paper', color: '#ece9df', rgb: [236, 233, 223] }
];

export const CHARACTERS = [
  {
    id: 'four-way-knight',
    title: 'Four-way Knight',
    file: 'four-way-knight.poses.json',
    fourWay: true,
    hint: '4-direction armored knight with pixel-exact mirrored side walks.',
    labels: { x: 'Outline', s: 'Steel', h: 'Highlight', t: 'Leather', b: 'Shadow' },
    themes: [
      { id: 'steel', title: 'Steel', palette: {} },
      { id: 'paladin', title: 'Paladin', palette: { s: '#d7a948', h: '#fff1a8', b: '#875c24', t: '#9e2b2b' } },
      { id: 'obsidian', title: 'Obsidian', palette: { s: '#4c465c', h: '#9a8fc2', b: '#2a2438', t: '#cf485d' } },
      { id: 'emerald', title: 'Emerald', palette: { s: '#458f65', h: '#a2e3b5', b: '#275941', t: '#c98e46' } }
    ]
  },
  {
    id: 'four-way-mage',
    title: 'Four-way Mage',
    file: 'four-way-mage.poses.json',
    fourWay: true,
    hint: '4-direction wizard with pointed hat, crystal staff and spell-cast cycle.',
    labels: { x: 'Outline', r: 'Robe', d: 'Shade', g: 'Gold Trim', f: 'Skin', w: 'Staff', c: 'Crystal' },
    themes: [
      { id: 'arcane', title: 'Arcane', palette: {} },
      { id: 'pyro', title: 'Pyromancer', palette: { r: '#992d38', d: '#5c1824', g: '#f2c14e', c: '#ff7b3b' } },
      { id: 'frost', title: 'Frost', palette: { r: '#34689c', d: '#1f4169', g: '#dbe8f5', c: '#9cf6ff' } },
      { id: 'druid', title: 'Druid', palette: { r: '#3c7349', d: '#234a30', g: '#e5b960', c: '#a6ff78' } }
    ]
  },
  {
    id: 'four-way-ranger',
    title: 'Four-way Ranger',
    file: 'four-way-ranger.poses.json',
    fourWay: true,
    hint: '4-direction hooded archer with quiver, recurve bow and aim poses.',
    labels: { x: 'Outline', c: 'Cloak', d: 'Shade', l: 'Leather', t: 'Bow & Trim', f: 'Skin', a: 'Fletching' },
    themes: [
      { id: 'woodland', title: 'Woodland', palette: {} },
      { id: 'autumn', title: 'Autumn', palette: { c: '#a14b32', d: '#662b1f', l: '#6e4735', t: '#e3b366' } },
      { id: 'frost', title: 'Snow Scout', palette: { c: '#6e8ea8', d: '#455f78', l: '#66534a', t: '#d9c5a0' } },
      { id: 'shadow', title: 'Nightshade', palette: { c: '#483b63', d: '#2b2240', l: '#3d3347', t: '#b894c9', a: '#9cf6ff' } }
    ]
  },
  {
    id: 'hero-sword',
    title: 'Sword Hero',
    file: 'hero-sword.poses.json',
    fourWay: false,
    hint: 'Side-view hero rig with sword slash and walk animations.',
    labels: {},
    themes: [{ id: 'default', title: 'Default', palette: {} }]
  },
  {
    id: 'fox',
    title: 'Fox',
    file: 'fox.poses.json',
    fourWay: false,
    hint: 'Quadruped woodland fox rig with springy tail follow-through.',
    labels: {},
    themes: [{ id: 'default', title: 'Default', palette: {} }]
  },
  {
    id: 'slime-idle',
    title: 'Slime',
    file: 'slime-idle.poses.json',
    fourWay: false,
    hint: 'Squash-and-stretch RPG slime starter rig.',
    labels: {},
    themes: [{ id: 'default', title: 'Default', palette: {} }]
  }
];

export const characterById = id => CHARACTERS.find(item => item.id === id);

export class CharacterToyError extends Error {
  constructor(message) { super(message); this.name = 'CharacterToyError'; }
}
const fail = message => { throw new CharacterToyError(message); };

export function checkVersion(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/.test(version)) {
    fail('The engine version must look like 0.21.0.');
  }
  return version;
}

export function normalizeHex(hex) {
  if (typeof hex !== 'string') return null;
  const clean = hex.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(clean) || /^#[0-9a-f]{8}$/.test(clean)) return clean;
  if (/^#[0-9a-f]{3}$/.test(clean)) return `#${clean[1]}${clean[1]}${clean[2]}${clean[2]}${clean[3]}${clean[3]}`;
  return null;
}

// Returns a deep-copied source with valid hex overrides applied to existing palette keys.
export function recolorSource(source, overrides = {}) {
  const next = structuredClone(source);
  if (!next || typeof next !== 'object' || !next.palette || typeof next.palette !== 'object') return next;
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(next.palette, key)) continue;
    const hex = normalizeHex(value);
    if (hex) next.palette[key] = hex;
  }
  return next;
}

// Groups animation names into cardinal directions and actions so 4-way rigs get a clean D-pad.
const DIRECTIONS = ['down', 'up', 'right', 'left'];
export function groupAnimations(animationNames) {
  const directions = {};
  const actions = new Set();
  for (const name of animationNames) {
    const match = /^([a-z0-9-]+)-(down|up|right|left)$/.exec(name);
    if (match) {
      const [, action, dir] = match;
      directions[dir] ??= {};
      directions[dir][action] = name;
      actions.add(action);
    }
  }
  const availableDirections = DIRECTIONS.filter(dir => directions[dir]);
  return { directions, availableDirections, actions: [...actions], all: [...animationNames] };
}

// Picks the best matching animation when switching direction or action.
export function pickAnimation(animationNames, preferredDir, preferredAction = 'walk') {
  const grouped = groupAnimations(animationNames);
  if (preferredDir && grouped.directions[preferredDir]) {
    if (grouped.directions[preferredDir][preferredAction]) return grouped.directions[preferredDir][preferredAction];
    if (grouped.directions[preferredDir].walk) return grouped.directions[preferredDir].walk;
    if (grouped.directions[preferredDir].stand) return grouped.directions[preferredDir].stand;
    return Object.values(grouped.directions[preferredDir])[0];
  }
  return animationNames.find(name => name === 'walk-down') ?? animationNames.find(name => name.startsWith('walk')) ?? animationNames[0] ?? '';
}

// Extracts the four matching walk (or stand) animations for simultaneous 4-way turntable preview.
export function fourWayAnimations(animationNames, preferredAction = 'walk') {
  const grouped = groupAnimations(animationNames);
  if (grouped.availableDirections.length < 4) return null;
  return DIRECTIONS.map(dir => ({
    direction: dir,
    animation: grouped.directions[dir][preferredAction] ?? grouped.directions[dir].walk ?? grouped.directions[dir].stand ?? Object.values(grouped.directions[dir])[0]
  }));
}

export function characterLink(base, { version = CHARACTER_TOY_VERSION, character, animation = '', speed = 1, palette = {}, basePalette = {} }) {
  checkVersion(version);
  if (!characterById(character)) fail(`There is no character called ${character}.`);
  const params = [`v=${version}`, `c=${character}`];
  if (animation && /^[A-Za-z0-9_-]{1,48}$/.test(animation)) params.push(`a=${animation}`);
  if (SPEEDS.includes(speed) && speed !== 1) params.push(`s=${speed}`);
  const changed = [];
  for (const [key, value] of Object.entries(palette)) {
    if (!/^[A-Za-z0-9_-]{1,16}$/.test(key)) continue;
    const hex = normalizeHex(value);
    const orig = normalizeHex(basePalette[key]);
    if (hex && hex !== orig) changed.push(`${key}:${hex.slice(1)}`);
  }
  if (changed.length) params.push(`p=${changed.join(',')}`);
  const link = `${base}#${params.join('&')}`;
  if (link.length > LINK_LIMIT) fail(`The share link exceeds ${LINK_LIMIT} characters.`);
  return link;
}

export function readCharacterLink(link, limit = LINK_LIMIT) {
  if (typeof link !== 'string') fail('A link must be text.');
  if (link.length > limit) fail(`The link is over the ${limit}-character limit.`);
  const hash = link.indexOf('#');
  const params = new URLSearchParams(hash >= 0 ? link.slice(hash + 1) : link);
  const version = checkVersion(params.get('v') ?? CHARACTER_TOY_VERSION);
  const character = params.get('c') ?? CHARACTERS[0].id;
  if (!characterById(character)) fail(`There is no character called ${character}.`);
  const rawAnim = params.get('a') ?? '';
  const animation = /^[A-Za-z0-9_-]{1,48}$/.test(rawAnim) ? rawAnim : '';
  const rawSpeed = Number(params.get('s') ?? '1');
  const speed = SPEEDS.includes(rawSpeed) ? rawSpeed : 1;
  const palette = {};
  const rawPalette = params.get('p');
  if (rawPalette) {
    for (const pair of rawPalette.split(',')) {
      const [key, hexBody] = pair.split(':');
      if (!key || !hexBody || !/^[A-Za-z0-9_-]{1,16}$/.test(key)) continue;
      const hex = normalizeHex(`#${hexBody}`);
      if (hex) palette[key] = hex;
    }
  }
  return { version, character, animation, speed, palette };
}

export function fitZoom(boxWidth, boxHeight, width, height, ratio = 1) {
  const zoom = Math.max(1, Math.floor(Math.min(boxWidth * ratio / width, boxHeight * ratio / height)));
  return { zoom, cssWidth: width * zoom / ratio, cssHeight: height * zoom / ratio };
}

export const gifScale = (width, height) => Math.max(2, Math.min(10, Math.floor(192 / Math.max(width, height))));
export const safeName = name => String(name ?? 'character').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'character';

