// Reviewed autotile sources drawn from terrain descriptions, written to examples/ by generate-examples.js: a top-down
// meadow over dirt with rare flowers, a side-view platformer ground with collision boxes and a layered shore of water,
// sand and grass. All compile without seam warnings; their test maps are the review (pixelbolt autotile
// examples/meadow.autotile.json --out <new.json> --preview <new.png>).

// Grass seen from above, over dirt: jittered edges with a dark outline, a lit top rim with tufts, a shaded lip and a
// cast shadow at the bottom. Two more fills and a flowered one hide the tile repeat when mixed by weight in a map.
const meadow = {
  format: 'pixelforge-autotile', version: 1, name: 'meadow', tile: 16,
  palette: { k: '#1e2b22', D: '#2d4a2c', d: '#3c6b35', g: '#4f8a3f', G: '#67a447', L: '#8fc75a', y: '#f0d76a', w: '#f4f1e2', s: '#20140c59', u: '#7a5534' },
  symbols: { daisy: ['.w.', 'wyw', '.w.'], buttercup: ['y.', '.y'] },
  terrain: {
    seed: 4,
    fill: { color: 'g', speckle: [{ color: 'd', amount: 0.22, size: 5 }, { color: 'G', amount: 0.16, size: 4 }, { color: 'L', amount: 0.03, size: 2 }] },
    edges: {
      all: { depth: 2, jitter: 1, size: 5, bands: ['k', 'd'] },
      n: { bands: ['k', 'G'], tufts: { colors: ['g', 'G'], amount: 0.4 } },
      s: { depth: 3, bands: ['k', 'D'], outside: ['s'] }
    },
    round: 2, inner: 1
  },
  frame: 'meadow-{mask}-{variant}',
  variants: [
    { name: 'a', weight: 4 },
    { name: 'b', weight: 4, terrain: { fill: { seed: 11 } } },
    { name: 'c', weight: 4, terrain: { fill: { seed: 23 } } },
    { name: 'flowers', weight: 1, terrain: { fill: { seed: 37 } }, ops: [{ op: 'stamp', symbol: 'daisy', x: 9, y: 25 }, { op: 'stamp', symbol: 'buttercup', x: 18, y: 34 }, { op: 'stamp', symbol: 'daisy', x: 19, y: 3 }] }
  ],
  preview: { background: 'u' },
  sheet: { columns: 16 }
};

// Ground seen from the side for a platformer: a flat walkable grass cap with tufts, dirt walls lit from the left,
// a dark underside with roots hanging from it, and a pebbled fill. A stony variant breaks up large walls.
const ground = {
  format: 'pixelforge-autotile', version: 1, name: 'ground', tile: 16,
  palette: { k: '#1a1418', G: '#9bdc5e', g: '#5ea842', d: '#3b7a36', b: '#a0704a', u: '#7c5136', U: '#5b3a29', p: '#8a8078', P: '#5f5852', R: '#4a2f22', S: '#9ccfe6' },
  symbols: { stone: ['.pp.', 'pppP', 'PPPP'], pebble: ['pP'] },
  terrain: {
    seed: 2,
    fill: { color: 'u', speckle: [{ color: 'U', amount: 0.16, size: 4 }, { color: 'b', amount: 0.1, size: 3 }, { color: 'P', amount: 0.03, size: 2 }] },
    edges: {
      all: { depth: 1, bands: ['k', 'U'] },
      n: { depth: 3, jitter: 0, bands: ['k', 'G', 'g', 'd'], tufts: { colors: ['g', 'G', 'G'], amount: 0.55 } },
      w: { bands: ['k', 'b'] },
      s: { depth: 2, bands: ['k', 'U'], tufts: { colors: ['R', 'R', 'R'], amount: 0.3 } }
    },
    round: 1, inner: 1
  },
  // A box per tile from the walkable grass top down: the insets are each edge's depth.
  collision: true,
  frame: 'ground-{mask}-{variant}',
  variants: [
    { name: 'a', weight: 3 },
    { name: 'b', weight: 3, terrain: { fill: { seed: 9 } } },
    { name: 'stones', weight: 1, terrain: { fill: { seed: 17 } }, ops: [{ op: 'stamp', symbol: 'stone', x: 10, y: 26 }, { op: 'stamp', symbol: 'pebble', x: 19, y: 36 }] }
  ],
  preview: { background: 'S' },
  sheet: { columns: 16 }
};

// A shore seen from above, as a layered corner set: water under sand under grass, 81 tiles for every mix of the three at
// a tile's corners. The sand meets the water with a line of foam and the grass keeps the meadow's outline, so grass
// on sand and grass straight on water both read.
const shore = {
  format: 'pixelforge-autotile', version: 1, name: 'shore', tile: 16,
  palette: { k: '#1e2b22', D: '#2d4a2c', d: '#3c6b35', g: '#4f8a3f', G: '#67a447', L: '#8fc75a', S: '#8a6d48', s: '#d9b97a', t: '#c49f62', y: '#ecd39a', W: '#28598a', w: '#2f6aa0', v: '#4a90c4', f: '#cfe8f2' },
  frame: 'shore-{corners}',
  layers: [
    { name: 'water', key: 'w', terrain: { seed: 5, fill: { color: 'w', speckle: [{ color: 'W', amount: 0.2, size: 8 }, { color: 'v', amount: 0.04, size: 2 }] } } },
    { name: 'sand', key: 's', terrain: { seed: 8,
      fill: { color: 's', speckle: [{ color: 't', amount: 0.14, size: 5 }, { color: 'y', amount: 0.06, size: 2 }, { color: 'S', amount: 0.02, size: 1 }] },
      edges: { all: { depth: 2, jitter: 1, size: 6, bands: ['t'], outside: ['f', 'v'] } }, round: 3, inner: 2 } },
    { name: 'grass', key: 'g', terrain: { seed: 4,
      fill: { color: 'g', speckle: [{ color: 'd', amount: 0.22, size: 5 }, { color: 'G', amount: 0.16, size: 4 }, { color: 'L', amount: 0.03, size: 2 }] },
      edges: { all: { depth: 2, jitter: 1, size: 5, bands: ['k', 'd'] }, n: { bands: ['k', 'G'], tufts: { colors: ['g', 'G'], amount: 0.4 } }, s: { depth: 3, bands: ['k', 'D'] } },
      round: 2, inner: 1 } }
  ],
  sheet: { columns: 9 }
};

export const terrainPresets = { 'meadow.autotile': meadow, 'ground.autotile': ground, 'shore.autotile': shore };
