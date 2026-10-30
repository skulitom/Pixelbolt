// The spell library: for each of seven elements a projectile (looping, turned to eight directions), an impact, an area
// effect and a looping buff, on one 64 × 64 canvas anchored at [32, 40], the point a game places every effect at. Each
// was reviewed frame by frame; scripts/generate-examples.js writes them to examples/<element>-spells.fx.json and
// test/spell-library.test.js pins their pixels.
export const spellLibrary = {
  fire: {
    "format": "pixelforge-fx",
    "version": 1,
    "name": "fire-spells",
    "width": 64,
    "height": 64,
    "palette": {
      "W": "#fffbe6",
      "y": "#ffd34d",
      "o": "#ff8a2b",
      "r": "#d6402b",
      "R": "#8f2a2e",
      "s": "#b3a5ad",
      "S": "#867882",
      "k": "#5a4e5b",
      "d": "#3b3140"
    },
    "symbols": {
      "ember-big": [
        "yW",
        "oy"
      ],
      "ember": ["y"],
      "ember-dim": ["o"],
      "ember-end": ["r"],
      "ground-ring": [
        ".............ddddddddddddddd.............",
        "........ddddd...............ddddd........",
        ".....ddd.........................ddd.....",
        "...dd...............................dd...",
        "..d...................................d..",
        ".d.....................................d.",
        ".d.....................................d.",
        ".d.....................................d.",
        "..d...................................d..",
        "...dd...............................dd...",
        ".....ddd.........................ddd.....",
        "........ddddd...............ddddd........",
        ".............ddddddddddddddd............."
      ],
      "feet-ring": [
        ".d.......................d.",
        ".d..d.................d..d.",
        ".d..d...d.........d...d..d.",
        "....d...ddddddddddd...d....",
        "....dddd...........dddd....",
        "..dd...................dd..",
        ".d.......................d.",
        ".d.......................d.",
        ".d.......................d.",
        "..dd...................dd..",
        "....dddd...........dddd....",
        "........ddddddddddd........"
      ]
    },
    "anchor": [32, 40],
    "effects": {
      "projectile": {
        "frames": 8,
        "duration": 60,
        "loop": true,
        "seed": 4,
        "turn": { "angles": [0, 45, 90, 135, 180, 225, 270, 315], "about": [32, 40] },
        "looks": { "fire": { "colors": ["R", "r", "o", "y", "W"], "thresholds": [0.12, 0.3, 0.5, 0.7, 0.9] } },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "beam",
            "look": "fire",
            "at": [33, 40],
            "to": [10, 40],
            "width": 12,
            "fade": 0.9,
            "wobble": 0.25,
            "wavelength": 7,
            "waves": 2,
            "noise": 0.55,
            "scale": 3,
            "power": 1.3
          },
          {
            "kind": "burst",
            "look": "fire",
            "at": [33, 40],
            "radius": 7,
            "noise": 0.3,
            "boil": 6,
            "power": 1.1,
            "seed": 4
          }
        ],
        "emitters": [
          {
            "at": [22, 40],
            "area": [10, 6],
            "rate": 0.7,
            "angle": [160, 200],
            "speed": [0.4, 1],
            "drag": 0.05,
            "life": [5, 7],
            "shapes": ["ember-big", "ember", "ember-dim", "ember-end"]
          }
        ]
      },
      "impact": {
        "frames": 12,
        "duration": { "from": 40, "to": 100, "ease": "in" },
        "seed": 7,
        "looks": {
          "fire": { "colors": ["R", "r", "o", "y", "W"], "thresholds": [0.18, 0.32, 0.46, 0.64, 0.86] },
          "smoke": {
            "colors": ["k", "S"],
            "thresholds": [0.5, 1],
            "light": [-0.5, -1],
            "lit": { "colors": ["s"], "thresholds": [0.25] },
            "shade": { "colors": ["k"], "thresholds": [0.08] },
            "outline": "d"
          }
        },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "star",
            "look": "fire",
            "at": [32, 40],
            "frames": [0, 1],
            "radius": 17,
            "points": 8,
            "width": 3,
            "ratio": 0.5,
            "power": 1.2,
            "cue": "hit"
          },
          {
            "kind": "burst",
            "look": "fire",
            "at": [32, 40],
            "frames": [0, 4],
            "radius": [5, 11, 13, 14],
            "noise": 0.5,
            "scale": 4,
            "power": [1.6, 1.35, 1.1, 0.7],
            "ease": "linear"
          },
          {
            "kind": "burst",
            "look": "fire",
            "at": [32, 39],
            "frames": [2, 10],
            "radius": [13, 15, 16],
            "noise": 0.9,
            "scale": 5,
            "power": [1, 0.7, 0.45, 0.25, 0.08],
            "hole": [0, 0, 0.3, 0.65],
            "drift": [0, -7],
            "ease": "linear"
          },
          {
            "kind": "ring",
            "look": "fire",
            "at": [32, 40],
            "frames": [1, 4],
            "radius": [9, 17],
            "width": [5, 4],
            "noise": 0.9,
            "scale": 4,
            "power": [0.75, 0.5, 0.3]
          }
        ],
        "emitters": [
          {
            "name": "smoke",
            "at": [32, 30],
            "area": [34, 14],
            "burst": 14,
            "start": 4,
            "angle": [230, 310],
            "speed": [0.3, 1],
            "gravity": [0, -0.05],
            "drag": 0.12,
            "life": [7, 7],
            "blob": { "look": "smoke", "radius": [3, 6, 5.5, 4, 2.5] }
          },
          {
            "name": "embers",
            "at": [32, 40],
            "burst": 9,
            "start": 1,
            "angle": [160, 380],
            "speed": [2.4, 3.8],
            "gravity": [0, 0.3],
            "drag": 0.06,
            "life": [4, 7],
            "shapes": ["ember-big", "ember-big", "ember", "ember-dim", "ember-end"],
            "trail": { "color": "o", "length": 1 }
          }
        ]
      },
      "area": {
        "frames": 19,
        "duration": { "from": 50, "to": 100, "ease": "in" },
        "seed": 11,
        "looks": {
          "scorch": { "colors": ["d"], "thresholds": [0.3] },
          "smoke": {
            "colors": ["k", "S"],
            "thresholds": [0.5, 1],
            "light": [-0.5, -1],
            "lit": { "colors": ["s"], "thresholds": [0.25] },
            "shade": { "colors": ["k"], "thresholds": [0.08] },
            "outline": "d"
          },
          "fire": { "colors": ["R", "r", "o", "y", "W"], "thresholds": [0.15, 0.3, 0.48, 0.68, 0.9] }
        },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "burst",
            "look": "scorch",
            "at": [32, 40],
            "frames": [4, 19],
            "radius": [17, 20, 20],
            "squash": [1, 0.35],
            "noise": 0.6,
            "scale": 6,
            "boil": 0,
            "power": [1.4, 1.4, 1.3, 1, 0.5, 0.15],
            "ease": "linear"
          },
          {
            "kind": "burst",
            "look": "fire",
            "at": [32, 40],
            "frames": [0, 2],
            "radius": [14, 19],
            "squash": [1, 0.35],
            "noise": 0.5,
            "scale": 4,
            "hole": [0.2, 0.8],
            "power": [1.5, 0.6],
            "cue": "hit"
          },
          {
            "kind": "aura",
            "look": "fire",
            "symbol": "ground-ring",
            "at": [12, 34],
            "frames": [0, 15],
            "width": [1.5, 3, 3, 2.5, 2],
            "rise": 4,
            "noise": 0.8,
            "scale": 3,
            "boil": 24,
            "power": [0.88, 0.85, 0.8, 0.45, 0],
            "floor": 47,
            "ease": "linear"
          },
          {
            "kind": "burst",
            "look": "fire",
            "at": [32, 40],
            "frames": [11, 18],
            "radius": 15,
            "squash": [1, 0.35],
            "noise": 0.9,
            "scale": 3,
            "boil": 2,
            "power": [0.5, 0.4, 0.25, 0.1],
            "ease": "linear"
          },
          {
            "kind": "stream",
            "look": "fire",
            "at": [27, 34],
            "through": [[26, 24], [28, 8]],
            "frames": [1, 13],
            "width": [6, 9, 7, 3],
            "taper": [1, 0.7, 0.3, 0],
            "head": [0.2, 1, 1, 1],
            "tail": [0, 0, 0.3, 0.9],
            "sway": 1,
            "wavelength": 14,
            "waves": 1.5,
            "noise": 0.55,
            "scale": 3,
            "power": [1.1, 1.05, 0.8, 0.3],
            "ease": "linear",
            "seed": 1
          },
          {
            "kind": "stream",
            "look": "fire",
            "at": [46, 36],
            "through": [[46, 27], [45, 14]],
            "frames": [2, 13],
            "width": [6, 8, 6, 3],
            "taper": [1, 0.7, 0.3, 0],
            "head": [0.2, 1, 1, 1],
            "tail": [0, 0, 0.3, 0.9],
            "sway": 1,
            "wavelength": 14,
            "waves": 1.5,
            "noise": 0.55,
            "scale": 3,
            "power": [1.1, 1.05, 0.8, 0.3],
            "ease": "linear",
            "seed": 2
          },
          {
            "kind": "stream",
            "look": "fire",
            "at": [16, 39],
            "through": [[15, 31], [17, 18]],
            "frames": [2, 14],
            "width": [6, 8, 6, 3],
            "taper": [1, 0.7, 0.3, 0],
            "head": [0.2, 1, 1, 1],
            "tail": [0, 0, 0.3, 0.9],
            "sway": 1,
            "wavelength": 14,
            "waves": 1.5,
            "noise": 0.55,
            "scale": 3,
            "power": [1.1, 1.05, 0.8, 0.3],
            "ease": "linear",
            "seed": 3
          },
          {
            "kind": "stream",
            "look": "fire",
            "at": [22, 45],
            "through": [[21, 37], [22, 24]],
            "frames": [1, 12],
            "width": [6, 9, 7, 3],
            "taper": [1, 0.7, 0.3, 0],
            "head": [0.2, 1, 1, 1],
            "tail": [0, 0, 0.3, 0.9],
            "sway": 1,
            "wavelength": 14,
            "waves": 1.5,
            "noise": 0.55,
            "scale": 3,
            "power": [1.1, 1.05, 0.8, 0.3],
            "ease": "linear",
            "seed": 5
          },
          {
            "kind": "stream",
            "look": "fire",
            "at": [41, 45],
            "through": [[42, 35], [40, 20]],
            "frames": [1, 13],
            "width": [7, 10, 8, 3],
            "taper": [1, 0.7, 0.3, 0],
            "head": [0.2, 1, 1, 1],
            "tail": [0, 0, 0.3, 0.9],
            "sway": 1,
            "wavelength": 14,
            "waves": 1.5,
            "noise": 0.55,
            "scale": 3,
            "power": [1.1, 1.05, 0.8, 0.3],
            "ease": "linear",
            "seed": 6
          }
        ],
        "emitters": [
          {
            "name": "smoke",
            "at": [32, 30],
            "area": [34, 8],
            "rate": 3.5,
            "start": 7,
            "end": 11,
            "angle": [238, 302],
            "speed": [0.3, 1.5],
            "gravity": [0, -0.16],
            "drag": 0.08,
            "life": [7, 7],
            "blob": { "look": "smoke", "radius": [2, 5.5, 6, 4.5, 2.5] }
          },
          {
            "name": "embers",
            "at": [32, 38],
            "area": [36, 10],
            "rate": 0.8,
            "start": 2,
            "end": 10,
            "angle": [255, 285],
            "speed": [0.5, 1.2],
            "gravity": [0, -0.03],
            "drag": 0.02,
            "life": [5, 7],
            "sway": { "amplitude": [1, 0], "period": 6 },
            "shapes": ["ember-big", "ember", "ember-dim", "ember-end"]
          }
        ]
      },
      "buff": {
        "frames": 12,
        "duration": 80,
        "loop": true,
        "seed": 5,
        "looks": { "fire": { "colors": ["R", "r", "o", "y"], "thresholds": [0.15, 0.35, 0.55, 0.8] } },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "aura",
            "look": "fire",
            "symbol": "feet-ring",
            "at": [19, 33],
            "width": 2,
            "rise": 3.5,
            "noise": 0.75,
            "scale": 3,
            "boil": 16,
            "floor": 45,
            "power": 0.9
          },
          {
            "kind": "stream",
            "look": "fire",
            "at": [21, 41],
            "through": [[22, 32], [20, 20]],
            "width": 7,
            "taper": [1, 0.75, 0.45, 0.1],
            "head": [1, 0.6, 0.8, 1],
            "tail": 0,
            "sway": 1,
            "wavelength": 12,
            "waves": 1,
            "noise": 0.45,
            "scale": 3,
            "power": 1.1,
            "seed": 11
          },
          {
            "kind": "stream",
            "look": "fire",
            "at": [43, 41],
            "through": [[42, 31], [44, 19]],
            "width": 7,
            "taper": [1, 0.75, 0.45, 0.1],
            "head": [0.65, 1, 0.75, 0.65],
            "tail": 0,
            "sway": 1,
            "wavelength": 12,
            "waves": 1,
            "noise": 0.45,
            "scale": 3,
            "power": 1.1,
            "seed": 12
          },
          {
            "kind": "stream",
            "look": "fire",
            "at": [26, 37],
            "through": [[25, 30], [27, 22]],
            "width": 6,
            "taper": [1, 0.75, 0.45, 0.1],
            "head": [0.8, 1, 0.55, 0.8],
            "tail": 0,
            "sway": 0.8,
            "wavelength": 12,
            "waves": 1,
            "noise": 0.45,
            "scale": 3,
            "power": 1.1,
            "seed": 13
          },
          {
            "kind": "stream",
            "look": "fire",
            "at": [38, 37],
            "through": [[39, 30], [37, 21]],
            "width": 6,
            "taper": [1, 0.75, 0.45, 0.1],
            "head": [1, 0.6, 1, 0.7, 1],
            "tail": 0,
            "sway": 0.8,
            "wavelength": 12,
            "waves": 1,
            "noise": 0.45,
            "scale": 3,
            "power": 1.1,
            "seed": 14
          },
          {
            "kind": "stream",
            "look": "fire",
            "at": [23, 44],
            "through": [[24, 37], [22, 28]],
            "width": 5,
            "taper": [1, 0.75, 0.45, 0.1],
            "head": [0.55, 0.9, 0.6, 0.55],
            "tail": 0,
            "sway": 0.8,
            "wavelength": 12,
            "waves": 1,
            "noise": 0.45,
            "scale": 3,
            "power": 1.1,
            "seed": 15
          },
          {
            "kind": "stream",
            "look": "fire",
            "at": [41, 44],
            "through": [[40, 37], [42, 29]],
            "width": 5,
            "taper": [1, 0.75, 0.45, 0.1],
            "head": [0.9, 0.55, 0.75, 0.9],
            "tail": 0,
            "sway": 0.8,
            "wavelength": 12,
            "waves": 1,
            "noise": 0.45,
            "scale": 3,
            "power": 1.1,
            "seed": 16
          }
        ],
        "emitters": [
          {
            "name": "embers",
            "at": [32, 26],
            "area": [20, 20],
            "rate": 0.8,
            "angle": [262, 278],
            "speed": [0.8, 1.5],
            "gravity": [0, -0.02],
            "drag": 0.02,
            "life": [6, 10],
            "sway": { "amplitude": [1, 0], "period": 6 },
            "shapes": ["ember-big", "ember", "ember-dim", "ember-end"]
          }
        ]
      }
    }
  },
  ice: {
    "format": "pixelforge-fx",
    "version": 1,
    "name": "ice-spells",
    "width": 64,
    "height": 64,
    "palette": { "W": "#ffffff", "p": "#d8f6ff", "c": "#8fe0ff", "b": "#4aa8e8", "B": "#2f5fb3", "n": "#1d2f6b", "s": "#4a4e63" },
    "symbols": {
      "stand-in": [
        ".....ssssss.....",
        "....ssssssss....",
        "....ssssssss....",
        "....ssssssss....",
        "....ssssssss....",
        ".....ssssss.....",
        "......ssss......",
        "...ssssssssss...",
        "..ssssssssssss..",
        "..ssssssssssss..",
        ".sss.ssssss.sss.",
        ".sss.ssssss.sss.",
        ".sss.ssssss.sss.",
        ".sss.ssssss.sss.",
        ".sss.ssssss.sss.",
        ".sss.ssssss.sss.",
        ".sss.ssssss.sss.",
        ".sss.ssssss.sss.",
        ".ss..ssssss..ss.",
        ".ss..ssssss..ss.",
        ".....ssssss.....",
        ".....ssssss.....",
        "....sss..sss....",
        "....sss..sss....",
        "....sss..sss....",
        "....sss..sss....",
        "....sss..sss....",
        "....sss..sss....",
        "....sss..sss....",
        "....sss..sss....",
        "....sss..sss....",
        "....sss..sss....",
        "....sss..sss....",
        "...ssss..ssss..."
      ],
      "shard-0": [
        ".bpp..",
        "BbccpW",
        "..bb.."
      ],
      "shard-45": [
        "B....",
        ".bp..",
        ".bcp.",
        "..bp.",
        "....W"
      ],
      "shard-90": [
        ".B.",
        "bb.",
        "pcb",
        "pcb",
        ".p.",
        ".W."
      ],
      "shard-135": [
        "....B",
        "..pb.",
        ".pcb.",
        ".pb..",
        "W...."
      ],
      "shard-180": [
        "..ppb.",
        "WpccbB",
        "..bb.."
      ],
      "shard-225": [
        "W....",
        ".pp..",
        ".bcp.",
        "..bb.",
        "....B"
      ],
      "shard-270": [
        ".W.",
        ".p.",
        "pcb",
        "pcb",
        "bb.",
        ".B."
      ],
      "shard-315": [
        "....W",
        "..pp.",
        ".pcb.",
        ".bb..",
        "B...."
      ],
      "chip-0": ["bcp"],
      "chip-45": [
        "b..",
        ".c.",
        "..p"
      ],
      "chip-90": [
        "b",
        "c",
        "p"
      ],
      "chip-135": [
        "..b",
        ".c.",
        "p.."
      ],
      "chip-180": ["pcb"],
      "chip-225": [
        "p..",
        ".c.",
        "..b"
      ],
      "chip-270": [
        "p",
        "c",
        "b"
      ],
      "chip-315": [
        "..p",
        ".c.",
        "b.."
      ],
      "bit-0": ["bc"],
      "bit-45": [
        "b.",
        ".c"
      ],
      "bit-90": [
        "b",
        "c"
      ],
      "bit-135": [
        ".b",
        "c."
      ],
      "bit-180": ["cb"],
      "bit-225": [
        "c.",
        ".b"
      ],
      "bit-270": [
        "c",
        "b"
      ],
      "bit-315": [
        ".c",
        "b."
      ],
      "glint-1": ["p"],
      "glint-3": [
        ".p.",
        "pWp",
        ".p."
      ],
      "glint-5": [
        "..p..",
        "..c..",
        "pcWcp",
        "..c..",
        "..p.."
      ],
      "flake": [
        "..p..",
        "p.c.p",
        ".cWc.",
        "p.c.p",
        "..p.."
      ],
      "flake-s": [
        "p.p",
        ".c.",
        "p.p"
      ],
      "flake-far": [
        "b.b",
        ".c.",
        "b.b"
      ],
      "mote": ["c"],
      "mote-dim": ["b"]
    },
    "anchor": [32, 40],
    "effects": {
      "projectile": {
        "frames": 8,
        "duration": 60,
        "loop": true,
        "seed": 5,
        "turn": { "angles": [0, 45, 90, 135, 180, 225, 270, 315], "about": [32, 40] },
        "looks": {
          "tail": { "colors": ["n", "B", "b", "c"], "thresholds": [0.12, 0.25, 0.5, 0.8] },
          "shard": {
            "colors": ["c"],
            "thresholds": [0.12],
            "lit": { "colors": ["p"], "thresholds": [0.45] },
            "shade": { "colors": ["b", "B"], "thresholds": [0.12, 0.45] },
            "outline": "n"
          },
          "gleam": { "colors": ["p", "W"], "thresholds": [0.4, 0.75] }
        },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "beam",
            "look": "tail",
            "at": [30, 40],
            "to": [10, 40],
            "width": 7,
            "fade": 0.95,
            "wobble": 0.3,
            "wavelength": 6.5,
            "waves": 2,
            "noise": 0.5,
            "scale": 3,
            "power": 1.6
          },
          {
            "kind": "star",
            "look": "shard",
            "at": [33.5, 40],
            "points": 2,
            "angle": 0,
            "radius": 19,
            "ratio": 0.38,
            "width": 5,
            "core": 0,
            "power": 1.4
          },
          {
            "kind": "star",
            "look": "gleam",
            "at": [36, 37],
            "points": 4,
            "angle": 0,
            "ratio": 1,
            "radius": [1, 1, 1, 3, 5, 3, 1, 1],
            "width": 0.8,
            "core": 0.8,
            "power": [0, 0, 0, 1.1, 1.2, 1.1, 0, 0],
            "ease": "linear"
          }
        ],
        "emitters": [
          {
            "name": "streaks",
            "at": [26, 40],
            "area": [4, 8],
            "rate": 1,
            "angle": [177, 183],
            "speed": [1.6, 2.2],
            "drag": 0.03,
            "life": [4, 6],
            "shapes": [["mote", "mote", "mote-dim"]],
            "trail": { "color": "b", "length": 2 }
          },
          {
            "name": "sparkle",
            "at": [26, 40],
            "area": [12, 9],
            "rate": 0.5,
            "angle": [165, 195],
            "speed": [0.4, 0.9],
            "drag": 0.08,
            "life": [4, 6],
            "shapes": ["glint-1", "glint-3", "glint-5", "glint-3", "glint-1"]
          },
          {
            "name": "flakes",
            "at": [22, 40],
            "area": [8, 10],
            "rate": 0.6,
            "angle": [160, 200],
            "speed": [0.5, 0.9],
            "drag": 0.05,
            "life": [4, 7],
            "shapes": [["mote", "mote", "mote-dim"], ["flake-s", "mote", "mote-dim"]]
          }
        ]
      },
      "impact": {
        "frames": 12,
        "duration": { "from": 40, "to": 100, "ease": "in" },
        "seed": 9,
        "looks": {
          "chill": { "colors": ["b", "c", "p"], "thresholds": [0.25, 0.5, 0.8] },
          "crystal": { "colors": ["b", "c", "p", "W"], "thresholds": [0.15, 0.35, 0.62, 0.92], "outline": "n" },
          "flash": { "colors": ["c", "p", "W"], "thresholds": [0.3, 0.55, 0.8] }
        },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "ring",
            "look": "chill",
            "at": [32, 40],
            "frames": [1, 5],
            "radius": [9, 21],
            "width": [5, 3, 2],
            "noise": 0.9,
            "scale": 4,
            "power": [1.3, 0.8, 0.3]
          },
          {
            "kind": "star",
            "look": "crystal",
            "at": [32, 40],
            "frames": [0, 2],
            "points": 12,
            "ratio": 0.5,
            "radius": [16, 19],
            "width": [3.5, 3],
            "core": 3.5,
            "angle": -90,
            "power": [1.2, 1.1],
            "cue": "hit"
          },
          {
            "kind": "star",
            "look": "crystal",
            "at": [32, 40],
            "frames": [2, 4],
            "points": 12,
            "ratio": 0.5,
            "radius": [15, 11],
            "width": [3, 2.5],
            "core": 3,
            "angle": -90,
            "noise": 0.9,
            "scale": 4,
            "power": [0.65, 0.25],
            "ease": "linear"
          },
          {
            "kind": "star",
            "look": "flash",
            "at": [32, 40],
            "frames": [0, 2],
            "points": 4,
            "ratio": 0.5,
            "radius": [8, 4],
            "width": 1.5,
            "angle": 45,
            "power": [1.2, 0.8]
          }
        ],
        "emitters": [
          {
            "name": "frost",
            "at": [32, 40],
            "ring": { "radius": 4, "even": true, "outward": true },
            "burst": 12,
            "start": 2,
            "angle": [-15, 15],
            "speed": [1.4, 2.4],
            "drag": 0.18,
            "life": [3, 4],
            "shapes": [["glint-3", "glint-1", "glint-1"], ["flake-s", "mote", "mote"]]
          },
          {
            "name": "shards",
            "at": [32, 40],
            "ring": { "radius": 6, "arc": [185, 355], "even": true, "outward": true },
            "burst": 8,
            "start": 2,
            "angle": [-20, 20],
            "speed": [3.2, 4.3],
            "gravity": [0, 0.4],
            "drag": 0.08,
            "life": [7, 9],
            "face": true,
            "shapes": [
              ["shard-0", "shard-0", "shard-0", "chip-0", "bit-0"],
              ["shard-45", "shard-45", "shard-45", "chip-45", "bit-45"],
              ["shard-90", "shard-90", "shard-90", "chip-90", "bit-90"],
              ["shard-135", "shard-135", "shard-135", "chip-135", "bit-135"],
              ["shard-180", "shard-180", "shard-180", "chip-180", "bit-180"],
              ["shard-225", "shard-225", "shard-225", "chip-225", "bit-225"],
              ["shard-270", "shard-270", "shard-270", "chip-270", "bit-270"],
              ["shard-315", "shard-315", "shard-315", "chip-315", "bit-315"]
            ],
            "remaps": [{}, {}, { "W": "p", "p": "c" }]
          },
          {
            "name": "shards-low",
            "at": [32, 40],
            "ring": { "radius": 6, "arc": [15, 165], "even": true, "outward": true },
            "burst": 5,
            "start": 2,
            "angle": [-20, 20],
            "speed": [2, 2.7],
            "gravity": [0, 0.3],
            "drag": 0.12,
            "life": [6, 8],
            "face": true,
            "shapes": [
              ["shard-0", "shard-0", "chip-0", "bit-0"],
              ["shard-45", "shard-45", "chip-45", "bit-45"],
              ["shard-90", "shard-90", "chip-90", "bit-90"],
              ["shard-135", "shard-135", "chip-135", "bit-135"],
              ["shard-180", "shard-180", "chip-180", "bit-180"],
              ["shard-225", "shard-225", "chip-225", "bit-225"],
              ["shard-270", "shard-270", "chip-270", "bit-270"],
              ["shard-315", "shard-315", "chip-315", "bit-315"]
            ],
            "remaps": [{}, { "W": "p", "p": "c" }]
          },
          {
            "name": "glints",
            "at": [32, 38],
            "area": [28, 20],
            "burst": 4,
            "start": 4,
            "life": [4, 6],
            "shapes": ["glint-1", "glint-3", "glint-5", "glint-3", "glint-1"]
          }
        ]
      },
      "area": {
        "frames": 22,
        "duration": { "from": 45, "to": 100, "ease": "in" },
        "seed": 3,
        "looks": {
          "frost": { "colors": ["B", "b", "c", "p"], "thresholds": [0.25, 0.4, 0.6, 0.85] },
          "shard": {
            "colors": ["c"],
            "thresholds": [0.12],
            "lit": { "colors": ["p"], "thresholds": [0.45] },
            "shade": { "colors": ["b", "B"], "thresholds": [0.12, 0.45] },
            "outline": "n"
          }
        },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "burst",
            "look": "frost",
            "at": [32, 40],
            "frames": [0, 22],
            "radius": [6, 20, 23, 24, 24, 24, 24, 24],
            "squash": [1, 0.3],
            "noise": 0.75,
            "scale": 3,
            "boil": 2,
            "power": [1.4, 1.35, 1.3, 1.25, 1.2, 0.8, 0.4, 0.05],
            "ease": "linear",
            "cue": "hit"
          },
          {
            "kind": "ring",
            "look": "frost",
            "at": [32, 40],
            "frames": [0, 8],
            "radius": [4, 27],
            "width": [4, 3, 2],
            "squash": [1, 0.32],
            "noise": 0.85,
            "scale": 4,
            "power": [1.3, 0.9, 0.25]
          },
          {
            "kind": "star",
            "look": "shard",
            "at": [32.5, 41],
            "frames": [1, 15],
            "points": 2,
            "angle": 270,
            "ratio": 0.1,
            "radius": [2, 30, 30, 30, 30, 30, 27, 15],
            "width": 5,
            "core": 0,
            "floor": 41,
            "noise": 0.6,
            "scale": 4,
            "power": [1.4, 1.4, 1.4, 1.4, 1.4, 1.3, 0.7, 0],
            "ease": "linear"
          },
          {
            "kind": "star",
            "look": "shard",
            "at": [23.5, 40],
            "frames": [2, 15],
            "points": 2,
            "angle": 254,
            "ratio": 0.1,
            "radius": [2, 19, 19, 19, 19, 19, 17.1, 9.5],
            "width": 4,
            "core": 0,
            "floor": 40,
            "noise": 0.6,
            "scale": 4,
            "power": [1.4, 1.4, 1.4, 1.4, 1.4, 1.3, 0.7, 0],
            "ease": "linear"
          },
          {
            "kind": "star",
            "look": "shard",
            "at": [41.5, 40],
            "frames": [2, 15],
            "points": 2,
            "angle": 287,
            "ratio": 0.1,
            "radius": [2, 21, 21, 21, 21, 21, 18.9, 10.5],
            "width": 4,
            "core": 0,
            "floor": 40,
            "noise": 0.6,
            "scale": 4,
            "power": [1.4, 1.4, 1.4, 1.4, 1.4, 1.3, 0.7, 0],
            "ease": "linear"
          },
          {
            "kind": "star",
            "look": "shard",
            "at": [16.5, 43],
            "frames": [3, 15],
            "points": 2,
            "angle": 243,
            "ratio": 0.1,
            "radius": [2, 12, 12, 12, 12, 12, 10.8, 6],
            "width": 3,
            "core": 0,
            "floor": 43,
            "noise": 0.6,
            "scale": 4,
            "power": [1.4, 1.4, 1.4, 1.4, 1.4, 1.3, 0.7, 0],
            "ease": "linear"
          },
          {
            "kind": "star",
            "look": "shard",
            "at": [48.5, 43],
            "frames": [3, 15],
            "points": 2,
            "angle": 298,
            "ratio": 0.1,
            "radius": [2, 13, 13, 13, 13, 13, 11.7, 6.5],
            "width": 3,
            "core": 0,
            "floor": 43,
            "noise": 0.6,
            "scale": 4,
            "power": [1.4, 1.4, 1.4, 1.4, 1.4, 1.3, 0.7, 0],
            "ease": "linear"
          },
          {
            "kind": "star",
            "look": "shard",
            "at": [27.5, 46],
            "frames": [3, 15],
            "points": 2,
            "angle": 262,
            "ratio": 0.1,
            "radius": [2, 11, 11, 11, 11, 11, 9.9, 5.5],
            "width": 3,
            "core": 0,
            "floor": 46,
            "noise": 0.6,
            "scale": 4,
            "power": [1.4, 1.4, 1.4, 1.4, 1.4, 1.3, 0.7, 0],
            "ease": "linear"
          },
          {
            "kind": "star",
            "look": "shard",
            "at": [38.5, 46],
            "frames": [4, 15],
            "points": 2,
            "angle": 279,
            "ratio": 0.1,
            "radius": [2, 13, 13, 13, 13, 13, 11.7, 6.5],
            "width": 3,
            "core": 0,
            "floor": 46,
            "noise": 0.6,
            "scale": 4,
            "power": [1.4, 1.4, 1.4, 1.4, 1.4, 1.3, 0.7, 0],
            "ease": "linear"
          }
        ],
        "emitters": [
          {
            "name": "shatter",
            "at": [18, 34],
            "line": { "to": [46, 34], "even": true },
            "burst": 11,
            "start": 13,
            "angle": [230, 310],
            "speed": [3.5, 5.2],
            "gravity": [0, 0.4],
            "drag": 0.03,
            "floor": 45,
            "bounce": 0.25,
            "life": [6, 7],
            "face": true,
            "shapes": [
              ["shard-0", "shard-0", "chip-0"],
              ["shard-45", "shard-45", "chip-45"],
              ["shard-90", "shard-90", "chip-90"],
              ["shard-135", "shard-135", "chip-135"],
              ["shard-180", "shard-180", "chip-180"],
              ["shard-225", "shard-225", "chip-225"],
              ["shard-270", "shard-270", "chip-270"],
              ["shard-315", "shard-315", "chip-315"]
            ],
            "remaps": [{}, {}, { "W": "p", "p": "c" }]
          },
          {
            "name": "shatter-tip",
            "at": [32, 16],
            "line": { "to": [32, 26] },
            "burst": 4,
            "start": 13,
            "angle": [230, 310],
            "speed": [1.8, 3],
            "gravity": [0, 0.32],
            "drag": 0.03,
            "floor": 45,
            "bounce": 0.25,
            "life": [6, 7],
            "face": true,
            "shapes": [
              ["shard-0", "chip-0", "chip-0"],
              ["shard-45", "chip-45", "chip-45"],
              ["shard-90", "chip-90", "chip-90"],
              ["shard-135", "chip-135", "chip-135"],
              ["shard-180", "chip-180", "chip-180"],
              ["shard-225", "chip-225", "chip-225"],
              ["shard-270", "chip-270", "chip-270"],
              ["shard-315", "chip-315", "chip-315"]
            ]
          },
          {
            "name": "lingering",
            "at": [32, 40],
            "area": [34, 6],
            "burst": 3,
            "start": 15,
            "life": [4, 5],
            "shapes": ["glint-1", "glint-3", "glint-5", "glint-3", "glint-1"]
          },
          {
            "name": "glints",
            "at": [32, 28],
            "area": [24, 22],
            "rate": 0.4,
            "start": 4,
            "end": 13,
            "life": [4, 5],
            "shapes": ["glint-1", "glint-3", "glint-5", "glint-3", "glint-1"]
          }
        ]
      },
      "buff": {
        "frames": 12,
        "duration": 80,
        "loop": true,
        "seed": 7,
        "looks": {
          "rime": { "colors": ["B", "b", "c"], "thresholds": [0.2, 0.5, 0.8] },
          "shard": {
            "colors": ["c"],
            "thresholds": [0.12],
            "lit": { "colors": ["p"], "thresholds": [0.45] },
            "shade": { "colors": ["b", "B"], "thresholds": [0.12, 0.45] },
            "outline": "n"
          },
          "gleam": { "colors": ["p", "W"], "thresholds": [0.4, 0.75] }
        },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "ring",
            "look": "rime",
            "at": [32, 40],
            "radius": 16,
            "width": 4,
            "fill": 0.22,
            "squash": [1, 0.33],
            "noise": 0.5,
            "scale": 3,
            "power": [1.15, 1, 1.15],
            "depth": "split"
          },
          {
            "kind": "star",
            "look": "shard",
            "at": [25.5, 37],
            "points": 2,
            "angle": 265,
            "ratio": 0.1,
            "radius": 5,
            "width": 1.5,
            "core": 0,
            "floor": 37,
            "depth": "back"
          },
          {
            "kind": "star",
            "look": "shard",
            "at": [42.5, 38],
            "points": 2,
            "angle": 281,
            "ratio": 0.1,
            "radius": 10,
            "width": 2.2,
            "core": 0,
            "floor": 38,
            "depth": "back"
          },
          {
            "kind": "star",
            "look": "shard",
            "at": [45.5, 39],
            "points": 2,
            "angle": 298,
            "ratio": 0.1,
            "radius": 6,
            "width": 1.8,
            "core": 0,
            "floor": 39,
            "depth": "back"
          },
          {
            "kind": "star",
            "look": "shard",
            "at": [17.5, 43],
            "points": 2,
            "angle": 240,
            "ratio": 0.1,
            "radius": 6,
            "width": 1.8,
            "core": 0,
            "floor": 43
          },
          {
            "kind": "star",
            "look": "shard",
            "at": [20.5, 44],
            "points": 2,
            "angle": 257,
            "ratio": 0.1,
            "radius": 12,
            "width": 2.4,
            "core": 0,
            "floor": 44
          },
          {
            "kind": "star",
            "look": "shard",
            "at": [23.5, 45],
            "points": 2,
            "angle": 273,
            "ratio": 0.1,
            "radius": 7,
            "width": 2,
            "core": 0,
            "floor": 45
          },
          {
            "kind": "star",
            "look": "shard",
            "at": [37.5, 46],
            "points": 2,
            "angle": 270,
            "ratio": 0.1,
            "radius": 4,
            "width": 1.5,
            "core": 0,
            "floor": 46
          },
          {
            "kind": "star",
            "look": "shard",
            "at": [40.5, 45],
            "points": 2,
            "angle": 287,
            "ratio": 0.1,
            "radius": 8,
            "width": 2,
            "core": 0,
            "floor": 45
          },
          {
            "kind": "star",
            "look": "gleam",
            "at": [18, 33],
            "frames": [2, 5],
            "points": 4,
            "ratio": 1,
            "radius": [2, 4, 1],
            "width": 0.8,
            "core": 0.8,
            "power": [0.9, 1.2, 0.6],
            "ease": "linear"
          },
          {
            "kind": "star",
            "look": "gleam",
            "at": [44, 29],
            "frames": [8, 11],
            "points": 4,
            "ratio": 1,
            "radius": [2, 4, 1],
            "width": 0.8,
            "core": 0.8,
            "power": [0.9, 1.2, 0.6],
            "ease": "linear"
          }
        ],
        "emitters": [
          {
            "name": "rise-back",
            "at": [32, 38],
            "area": [16, 3],
            "rate": 0.2,
            "angle": [266, 274],
            "speed": [0.9, 1.3],
            "life": [24, 30],
            "sway": { "amplitude": [8, 2], "period": 16 },
            "behind": true,
            "depth": "back",
            "shapes": [
              ["mote-dim", "flake-far", "flake-far", "flake-far", "flake-far", "mote", "mote-dim", "mote-dim"],
              ["mote", "mote", "mote", "mote-dim", "mote-dim"]
            ]
          },
          {
            "name": "rise-front",
            "at": [32, 42],
            "area": [16, 3],
            "rate": 0.25,
            "angle": [266, 274],
            "speed": [0.9, 1.3],
            "life": [24, 30],
            "sway": { "amplitude": [9, 2], "period": 16 },
            "shapes": [
              ["mote", "flake-s", "flake", "flake", "flake", "flake-s", "mote", "mote-dim"],
              ["mote", "flake-s", "flake-s", "flake-s", "mote", "mote-dim"]
            ]
          },
          {
            "name": "glints",
            "at": [32, 22],
            "area": [20, 30],
            "rate": 0.3,
            "life": [4, 5],
            "shapes": ["glint-1", "glint-3", "glint-5", "glint-3", "glint-1"]
          },
          {
            "name": "stand-in",
            "sprite": { "symbol": "stand-in", "draw": true },
            "at": [24, 6],
            "depth": "between"
          }
        ]
      }
    }
  },
  lightning: {
    "format": "pixelforge-fx",
    "version": 1,
    "name": "lightning-spells",
    "width": 64,
    "height": 64,
    "anchor": [32, 40],
    "palette": { "g": "#2b2433", "v": "#3b2a8c", "b": "#4f7cff", "c": "#8fe9ff", "W": "#ffffff" },
    "symbols": {
      "spark": ["W"],
      "spark-c": ["c"],
      "spark-b": ["b"],
      "spark-v": ["v"],
      "streak-0": ["cW"],
      "streak-45": [
        "c.",
        ".W"
      ],
      "streak-90": [
        "c",
        "W"
      ],
      "streak-135": [
        ".c",
        "W."
      ],
      "streak-180": ["Wc"],
      "streak-225": [
        "W.",
        ".c"
      ],
      "streak-270": [
        "W",
        "c"
      ],
      "streak-315": [
        ".W",
        "c."
      ]
    },
    "effects": {
      "projectile": {
        "frames": 8,
        "duration": 60,
        "loop": true,
        "seed": 7,
        "turn": { "angles": [0, 45, 90, 135, 180, 225, 270, 315], "about": [32, 40] },
        "looks": { "arc": { "colors": ["v", "b", "c", "W"], "thresholds": [0.14, 0.3, 0.55, 0.88] } },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "beam",
            "look": "arc",
            "at": [35, 40],
            "to": [14, 40],
            "width": 8,
            "fade": 1,
            "wobble": 0.3,
            "wavelength": 7,
            "waves": 2,
            "noise": 0.6,
            "scale": 3,
            "power": 0.55
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [34, 40],
            "to": [16, 40],
            "width": 1,
            "glow": 1,
            "jag": 0.45,
            "branches": 1,
            "reroll": 2,
            "segment": 3,
            "power": 0.65
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [34, 40],
            "to": [22, 41],
            "width": 1,
            "glow": 0,
            "jag": 0.5,
            "branches": 0,
            "reroll": 2,
            "segment": 3,
            "power": 0.5,
            "seed": 21
          },
          {
            "kind": "burst",
            "look": "arc",
            "at": [35, 40],
            "radius": 6,
            "noise": 0.45,
            "scale": 2,
            "boil": 4,
            "power": 1.12
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [35, 40],
            "to": [42, 32],
            "frames": [0, 2],
            "width": 1,
            "glow": 1,
            "jag": 0.55,
            "branches": 1,
            "reroll": 1,
            "segment": 3,
            "power": 0.85
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [35, 40],
            "to": [39, 48],
            "frames": [0, 1],
            "width": 1,
            "glow": 1,
            "jag": 0.55,
            "branches": 1,
            "reroll": 1,
            "segment": 3,
            "power": 0.85,
            "seed": 30
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [35, 40],
            "to": [40, 50],
            "frames": [1, 3],
            "width": 1,
            "glow": 1,
            "jag": 0.55,
            "branches": 1,
            "reroll": 1,
            "segment": 3,
            "power": 0.85
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [35, 40],
            "to": [30, 30],
            "frames": [2, 4],
            "width": 1,
            "glow": 1,
            "jag": 0.55,
            "branches": 1,
            "reroll": 1,
            "segment": 3,
            "power": 0.85
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [35, 40],
            "to": [46, 43],
            "frames": [3, 5],
            "width": 1,
            "glow": 1,
            "jag": 0.55,
            "branches": 1,
            "reroll": 1,
            "segment": 3,
            "power": 0.85
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [35, 40],
            "to": [28, 49],
            "frames": [4, 6],
            "width": 1,
            "glow": 1,
            "jag": 0.55,
            "branches": 1,
            "reroll": 1,
            "segment": 3,
            "power": 0.85
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [35, 40],
            "to": [45, 35],
            "frames": [5, 7],
            "width": 1,
            "glow": 1,
            "jag": 0.55,
            "branches": 1,
            "reroll": 1,
            "segment": 3,
            "power": 0.85
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [35, 40],
            "to": [43, 47],
            "frames": [6, 8],
            "width": 1,
            "glow": 1,
            "jag": 0.55,
            "branches": 1,
            "reroll": 1,
            "segment": 3,
            "power": 0.85
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [35, 40],
            "to": [37, 30],
            "frames": [7, 8],
            "width": 1,
            "glow": 1,
            "jag": 0.55,
            "branches": 1,
            "reroll": 1,
            "segment": 3,
            "power": 0.85
          }
        ],
        "emitters": [
          {
            "at": [22, 40],
            "area": [14, 6],
            "rate": 0.7,
            "angle": [160, 200],
            "speed": [0.3, 1],
            "life": [3, 6],
            "shapes": ["spark", "spark-c", "spark-b", "spark-v"]
          }
        ]
      },
      "impact": {
        "frames": 10,
        "duration": { "from": 40, "to": 100, "ease": "in" },
        "seed": 11,
        "looks": { "arc": { "colors": ["v", "b", "c", "W"], "thresholds": [0.14, 0.3, 0.55, 0.88] } },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "star",
            "look": "arc",
            "at": [32, 40],
            "frames": [0, 3],
            "radius": [16, 6],
            "points": 8,
            "ratio": 0.4,
            "width": [2.5, 1],
            "core": [2, 1],
            "jitter": 0.25,
            "angle": 0,
            "power": [1.5, 0.7],
            "cue": "hit"
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [32, 40],
            "to": [51, 31],
            "frames": [0, 3],
            "width": 1,
            "glow": [2, 1],
            "jag": 0.45,
            "branches": 2,
            "reroll": 1,
            "segment": 3,
            "noise": 0.4,
            "power": [1.3, 0.9, 0.4]
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [32, 40],
            "to": [40, 58],
            "frames": [0, 3],
            "width": 1,
            "glow": [2, 1],
            "jag": 0.45,
            "branches": 2,
            "reroll": 1,
            "segment": 3,
            "noise": 0.4,
            "power": [1.3, 0.9, 0.4]
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [32, 40],
            "to": [13, 47],
            "frames": [0, 3],
            "width": 1,
            "glow": [2, 1],
            "jag": 0.45,
            "branches": 2,
            "reroll": 1,
            "segment": 3,
            "noise": 0.4,
            "power": [1.3, 0.9, 0.4]
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [32, 40],
            "to": [18, 25],
            "frames": [0, 3],
            "width": 1,
            "glow": [2, 1],
            "jag": 0.45,
            "branches": 2,
            "reroll": 1,
            "segment": 3,
            "noise": 0.4,
            "power": [1.3, 0.9, 0.4]
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [32, 40],
            "to": [37, 20],
            "frames": [0, 3],
            "width": 1,
            "glow": [2, 1],
            "jag": 0.45,
            "branches": 2,
            "reroll": 1,
            "segment": 3,
            "noise": 0.4,
            "power": [1.3, 0.9, 0.4]
          },
          {
            "kind": "ring",
            "look": "arc",
            "at": [32, 40],
            "frames": [1, 6],
            "radius": [6, 20],
            "width": [4, 3.5],
            "noise": 0.95,
            "scale": 4,
            "power": [1.4, 0.7, 0.16]
          },
          {
            "kind": "burst",
            "look": "arc",
            "at": [32, 40],
            "frames": [2, 7],
            "radius": [5, 3],
            "noise": 0.3,
            "scale": 2,
            "flicker": 0.3,
            "power": [1.6, 0.7]
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [32, 40],
            "to": [41, 36],
            "frames": [4, 5],
            "width": 1,
            "glow": 1,
            "jag": 0.55,
            "branches": 1,
            "reroll": 1,
            "segment": 3,
            "power": 1
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [32, 40],
            "to": [26, 47],
            "frames": [4, 5],
            "width": 1,
            "glow": 1,
            "jag": 0.55,
            "branches": 1,
            "reroll": 1,
            "segment": 3,
            "power": 1
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [32, 40],
            "to": [28, 31],
            "frames": [4, 5],
            "width": 1,
            "glow": 1,
            "jag": 0.55,
            "branches": 1,
            "reroll": 1,
            "segment": 3,
            "power": 1
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [32, 40],
            "to": [24, 40],
            "frames": [6, 7],
            "width": 1,
            "glow": 1,
            "jag": 0.55,
            "branches": 1,
            "reroll": 1,
            "segment": 3,
            "power": 0.7
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [32, 40],
            "to": [37, 46],
            "frames": [6, 7],
            "width": 1,
            "glow": 1,
            "jag": 0.55,
            "branches": 1,
            "reroll": 1,
            "segment": 3,
            "power": 0.7
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [32, 40],
            "to": [36, 33],
            "frames": [6, 7],
            "width": 1,
            "glow": 1,
            "jag": 0.55,
            "branches": 1,
            "reroll": 1,
            "segment": 3,
            "power": 0.7
          },
          {
            "kind": "star",
            "look": "arc",
            "at": [32, 40],
            "frames": [7, 9],
            "radius": [4, 2.5],
            "points": 4,
            "ratio": 1,
            "width": 1,
            "core": 1,
            "angle": 0,
            "power": [1.1, 0.6]
          }
        ],
        "emitters": [
          {
            "at": [32, 40],
            "burst": 10,
            "start": 0,
            "angle": [0, 360],
            "speed": [2, 4],
            "drag": 0.02,
            "gravity": [0, 0.12],
            "life": [3, 6],
            "face": true,
            "shapes": [
              ["streak-0"],
              ["streak-45"],
              ["streak-90"],
              ["streak-135"],
              ["streak-180"],
              ["streak-225"],
              ["streak-270"],
              ["streak-315"]
            ],
            "tint": [{}, { "W": "c", "c": "b" }, { "W": "b", "c": "v" }]
          }
        ]
      },
      "area": {
        "frames": 20,
        "duration": { "from": 45, "to": 100, "ease": "in" },
        "seed": 21,
        "edges": ["top"],
        "looks": {
          "scorch": { "colors": ["g", "v"], "thresholds": [0.2, 0.65] },
          "ground": { "colors": ["v", "b", "c"], "thresholds": [0.15, 0.4, 0.8] },
          "arc": { "colors": ["v", "b", "c", "W"], "thresholds": [0.14, 0.3, 0.55, 0.88] }
        },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "ring",
            "look": "ground",
            "at": [32, 40],
            "frames": [0, 19],
            "radius": [6, 22, 22, 22, 22, 22, 22, 22],
            "width": 5,
            "squash": [1, 0.36],
            "noise": 0.95,
            "scale": 3,
            "flicker": 0.25,
            "power": [1.4, 1, 0.95, 0.95, 0.9, 0.8, 0.3, 0.1],
            "cue": "hit",
            "ease": "linear"
          },
          {
            "kind": "ring",
            "look": "scorch",
            "at": [32, 40],
            "frames": [1, 20],
            "radius": 5,
            "width": 2,
            "fill": 1,
            "squash": [1, 0.4],
            "noise": 0.5,
            "scale": 2,
            "power": [1.5, 0.9, 0.45, 0],
            "ease": "linear"
          },
          {
            "kind": "ring",
            "look": "scorch",
            "at": [19, 38],
            "frames": [5, 20],
            "radius": 5,
            "width": 2,
            "fill": 1,
            "squash": [1, 0.4],
            "noise": 0.5,
            "scale": 2,
            "power": [1.5, 0.9, 0.45, 0],
            "ease": "linear"
          },
          {
            "kind": "ring",
            "look": "scorch",
            "at": [44, 43],
            "frames": [9, 20],
            "radius": 5,
            "width": 2,
            "fill": 1,
            "squash": [1, 0.4],
            "noise": 0.5,
            "scale": 2,
            "power": [1.5, 0.9, 0.45, 0],
            "ease": "linear"
          },
          {
            "kind": "ring",
            "look": "scorch",
            "at": [28, 44],
            "frames": [13, 20],
            "radius": 5,
            "width": 2,
            "fill": 1,
            "squash": [1, 0.4],
            "noise": 0.5,
            "scale": 2,
            "power": [1.5, 0.9, 0.45, 0],
            "ease": "linear"
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [35, 2],
            "to": [32, 40],
            "frames": [0, 3],
            "width": [2, 1],
            "glow": [2, 2, 1],
            "jag": 0.4,
            "branches": 3,
            "reroll": 1,
            "segment": 4,
            "noise": 0.6,
            "power": [1.7, 1, 0.3]
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [14, 4],
            "to": [19, 38],
            "frames": [4, 7],
            "width": 1,
            "glow": [2, 2, 1],
            "jag": 0.4,
            "branches": 2,
            "reroll": 1,
            "segment": 4,
            "noise": 0.6,
            "power": [1.9, 1, 0.3]
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [50, 3],
            "to": [44, 43],
            "frames": [8, 11],
            "width": 1,
            "glow": [2, 2, 1],
            "jag": 0.4,
            "branches": 2,
            "reroll": 1,
            "segment": 4,
            "noise": 0.6,
            "power": [1.9, 1, 0.3]
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [24, 5],
            "to": [28, 44],
            "frames": [12, 15],
            "width": 1,
            "glow": [2, 2, 1],
            "jag": 0.4,
            "branches": 2,
            "reroll": 1,
            "segment": 4,
            "noise": 0.6,
            "power": [1.8, 1, 0.3]
          },
          {
            "kind": "star",
            "look": "arc",
            "at": [32, 40],
            "frames": [0, 2],
            "radius": [11, 5],
            "points": 8,
            "ratio": 0.4,
            "width": [2, 1],
            "squash": [1, 0.6],
            "power": [1.3, 0.7]
          },
          {
            "kind": "star",
            "look": "arc",
            "at": [19, 38],
            "frames": [4, 6],
            "radius": [8, 4],
            "points": 8,
            "ratio": 0.4,
            "width": [2, 1],
            "squash": [1, 0.6],
            "power": [1.2, 0.6]
          },
          {
            "kind": "star",
            "look": "arc",
            "at": [44, 43],
            "frames": [8, 10],
            "radius": [8, 4],
            "points": 8,
            "ratio": 0.4,
            "width": [2, 1],
            "squash": [1, 0.6],
            "power": [1.2, 0.6]
          },
          {
            "kind": "star",
            "look": "arc",
            "at": [28, 44],
            "frames": [12, 14],
            "radius": [8, 4],
            "points": 8,
            "ratio": 0.4,
            "width": [2, 1],
            "squash": [1, 0.6],
            "power": [1.2, 0.6]
          }
        ],
        "emitters": [
          {
            "at": [32, 40],
            "burst": 8,
            "start": 0,
            "angle": [200, 340],
            "speed": [1.2, 2.6],
            "gravity": [0, 0.3],
            "life": [5, 8],
            "floor": 42,
            "bounce": 0.35,
            "shapes": ["spark", "spark-c", "spark-b"]
          },
          {
            "at": [19, 38],
            "burst": 5,
            "start": 4,
            "angle": [200, 340],
            "speed": [1, 2.2],
            "gravity": [0, 0.3],
            "life": [5, 8],
            "floor": 40,
            "bounce": 0.35,
            "shapes": ["spark", "spark-c", "spark-b"]
          },
          {
            "at": [44, 43],
            "burst": 5,
            "start": 8,
            "angle": [200, 340],
            "speed": [1, 2.2],
            "gravity": [0, 0.3],
            "life": [5, 8],
            "floor": 45,
            "bounce": 0.35,
            "shapes": ["spark", "spark-c", "spark-b"]
          },
          {
            "at": [28, 44],
            "burst": 5,
            "start": 12,
            "angle": [200, 340],
            "speed": [1, 2.2],
            "gravity": [0, 0.3],
            "life": [4, 7],
            "floor": 46,
            "bounce": 0.35,
            "shapes": ["spark", "spark-c", "spark-b"]
          }
        ]
      },
      "buff": {
        "frames": 12,
        "duration": 80,
        "loop": true,
        "seed": 31,
        "looks": {
          "ground": { "colors": ["v", "b", "c"], "thresholds": [0.25, 0.6, 1] },
          "arc": { "colors": ["v", "b", "c", "W"], "thresholds": [0.14, 0.3, 0.55, 0.88] }
        },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "ring",
            "look": "ground",
            "at": [32, 40],
            "radius": 12,
            "width": 5,
            "squash": [1, 0.35],
            "noise": 0.95,
            "scale": 3,
            "flicker": 1,
            "power": 1.3
          },
          {
            "kind": "ring",
            "look": "ground",
            "at": [32, 40],
            "frames": [1, 12],
            "radius": 12,
            "width": 5,
            "squash": [1, 0.35],
            "noise": 0.95,
            "scale": 3,
            "flicker": 1,
            "power": 1.3,
            "seed": 7
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [20, 39],
            "to": [25, 37],
            "frames": [0, 3],
            "width": 1,
            "glow": 1,
            "jag": 0.5,
            "branches": 0,
            "reroll": 1,
            "segment": 3,
            "power": [1, 0.6]
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [42, 38],
            "to": [44, 42],
            "frames": [3, 6],
            "width": 1,
            "glow": 1,
            "jag": 0.5,
            "branches": 0,
            "reroll": 1,
            "segment": 3,
            "power": [1, 0.6]
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [42, 42],
            "to": [35, 44],
            "frames": [6, 9],
            "width": 1,
            "glow": 1,
            "jag": 0.5,
            "branches": 0,
            "reroll": 1,
            "segment": 3,
            "power": [1, 0.6]
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [23, 43],
            "to": [20, 40],
            "frames": [9, 12],
            "width": 1,
            "glow": 1,
            "jag": 0.5,
            "branches": 0,
            "reroll": 1,
            "segment": 3,
            "power": [1, 0.6]
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [23, 38],
            "to": [22, 27],
            "frames": [0, 2],
            "width": 1,
            "glow": 1,
            "jag": 0.5,
            "branches": 1,
            "reroll": 1,
            "segment": 3,
            "power": [1.2, 0.8]
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [41, 31],
            "to": [44, 22],
            "frames": [1, 3],
            "width": 1,
            "glow": 1,
            "jag": 0.55,
            "branches": 0,
            "reroll": 1,
            "segment": 3,
            "power": [1.1, 0.75]
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [41, 26],
            "to": [39, 14],
            "frames": [2, 4],
            "width": 1,
            "glow": 1,
            "jag": 0.5,
            "branches": 1,
            "reroll": 1,
            "segment": 3,
            "power": [1.2, 0.8]
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [23, 24],
            "to": [26, 9],
            "frames": [4, 6],
            "width": 1,
            "glow": 1,
            "jag": 0.5,
            "branches": 1,
            "reroll": 1,
            "segment": 3,
            "power": [1.2, 0.8]
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [24, 36],
            "to": [20, 30],
            "frames": [5, 7],
            "width": 1,
            "glow": 1,
            "jag": 0.55,
            "branches": 0,
            "reroll": 1,
            "segment": 3,
            "power": [1.1, 0.75]
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [41, 39],
            "to": [42, 28],
            "frames": [6, 8],
            "width": 1,
            "glow": 1,
            "jag": 0.5,
            "branches": 1,
            "reroll": 1,
            "segment": 3,
            "power": [1.2, 0.8]
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [22, 33],
            "to": [22, 20],
            "frames": [8, 10],
            "width": 1,
            "glow": 1,
            "jag": 0.5,
            "branches": 1,
            "reroll": 1,
            "segment": 3,
            "power": [1.2, 0.8]
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [33, 5],
            "to": [39, 9],
            "frames": [9, 11],
            "width": 1,
            "glow": 1,
            "jag": 0.55,
            "branches": 0,
            "reroll": 1,
            "segment": 3,
            "power": [1.1, 0.75]
          },
          {
            "kind": "bolt",
            "look": "arc",
            "at": [40, 17],
            "to": [37, 6],
            "frames": [10, 12],
            "width": 1,
            "glow": 1,
            "jag": 0.5,
            "branches": 1,
            "reroll": 1,
            "segment": 3,
            "power": [1.2, 0.8]
          }
        ],
        "emitters": [
          {
            "at": [32, 40],
            "area": [24, 7],
            "rate": 0.4,
            "angle": [265, 275],
            "speed": [0.9, 1.4],
            "life": [5, 8],
            "shapes": [["streak-270", "spark-c", "spark-b"]]
          }
        ]
      }
    }
  },
  water: {
    "format": "pixelforge-fx",
    "version": 1,
    "name": "water-spells",
    "width": 64,
    "height": 64,
    "palette": { "W": "#f2fdff", "h": "#bff2ff", "m": "#6fd3f0", "b": "#2f8fd6", "d": "#1d4f8f", "o": "#12305a" },
    "symbols": {
      "bubble-big": [
        ".hhh.",
        "hW..h",
        "h...m",
        "h...m",
        ".mmm."
      ],
      "bubble": [
        ".hh.",
        "hW.m",
        "h..m",
        ".mm."
      ]
    },
    "anchor": [32, 40],
    "effects": {
      "projectile": {
        "frames": 8,
        "duration": 60,
        "loop": true,
        "seed": 5,
        "turn": { "angles": [0, 45, 90, 135, 180, 225, 270, 315], "about": [32, 40] },
        "looks": {
          "water": {
            "colors": ["b"],
            "thresholds": [0.2],
            "lit": { "colors": ["m", "h"], "thresholds": [0.35, 0.72] },
            "shade": { "colors": ["d"], "thresholds": [0.4] },
            "outline": "o"
          }
        },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "stream",
            "at": [44, 40],
            "through": [[35, 40], [24, 40]],
            "width": 15,
            "taper": [1, 0.8, 0.5, 0.15],
            "sway": 0.8,
            "wavelength": 16,
            "waves": 1,
            "noise": 0.15,
            "scale": 4,
            "power": 1.4
          },
          { "kind": "burst", "at": [44, 40], "radius": 7.5, "noise": 0.1, "boil": 3, "power": 1.3 }
        ],
        "emitters": [
          {
            "name": "drops",
            "at": [18, 40],
            "area": [2, 4],
            "rate": 0.8,
            "angle": [172, 188],
            "speed": [1.2, 1.8],
            "life": [3, 4],
            "blob": { "radius": [3.4, 3, 2.6] }
          }
        ]
      },
      "impact": {
        "frames": 11,
        "duration": { "from": 40, "to": 90, "ease": "in" },
        "seed": 3,
        "looks": {
          "water": {
            "colors": ["b"],
            "thresholds": [0.2],
            "lit": { "colors": ["m", "h"], "thresholds": [0.35, 0.72] },
            "shade": { "colors": ["d"], "thresholds": [0.4] },
            "outline": "o"
          }
        },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "star",
            "at": [32, 40],
            "frames": [0, 2],
            "radius": [15, 18],
            "points": 7,
            "ratio": 0.75,
            "width": [8, 5],
            "core": 4,
            "jitter": 0.3,
            "angle": 12,
            "power": [1.4, 1],
            "cue": "hit"
          },
          {
            "kind": "burst",
            "at": [32, 40],
            "frames": [0, 2],
            "radius": [9, 9],
            "noise": 0.3,
            "scale": 3,
            "boil": 2,
            "power": [1.3, 0.8]
          },
          {
            "kind": "ring",
            "at": [32, 40],
            "frames": [1, 9],
            "radius": [10, 16, 19.5],
            "width": [8, 7, 6],
            "noise": 1,
            "scale": 5,
            "power": [1.6, 1.1, 0.22]
          }
        ],
        "emitters": [
          {
            "name": "tips",
            "at": [32, 40],
            "ring": { "radius": 12, "arc": [12, 372], "even": true, "outward": true },
            "burst": 7,
            "angle": [-6, 6],
            "speed": [2.4, 3],
            "gravity": [0, 0.1],
            "drag": 0.2,
            "life": [2, 3],
            "blob": { "radius": [3.4, 3] }
          },
          {
            "name": "beads",
            "at": [32, 40],
            "ring": { "radius": [15, 18], "outward": true },
            "burst": 9,
            "start": 4,
            "angle": [-25, 25],
            "speed": [0.4, 1.3],
            "gravity": [0, 0.16],
            "drag": 0.06,
            "life": [4, 6],
            "blob": { "radius": [3, 2.7, 2.4] }
          }
        ]
      },
      "area": {
        "frames": 20,
        "duration": { "from": 50, "to": 95, "ease": "in" },
        "seed": 6,
        "looks": {
          "pool": { "colors": ["d", "b"], "thresholds": [0.2, 0.6], "outline": "o" },
          "water": {
            "colors": ["b"],
            "thresholds": [0.2],
            "lit": { "colors": ["m", "h"], "thresholds": [0.3, 0.85] },
            "shade": { "colors": ["d"], "thresholds": [0.45] },
            "outline": "o",
            "light": [-0.35, -1]
          }
        },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "ring",
            "look": "pool",
            "at": [32, 40],
            "frames": [0, 18],
            "radius": [6, 17, 17, 14, 6],
            "width": 6,
            "fill": 0.85,
            "squash": [1, 0.34],
            "noise": 0.3,
            "scale": 8,
            "power": [1.3, 1.2, 1.1, 0.7, 0.2],
            "ease": "linear",
            "cue": "hit"
          },
          {
            "kind": "ring",
            "look": "pool",
            "at": [32, 40],
            "frames": [9, 17],
            "radius": [15, 28],
            "width": [11, 8],
            "squash": [1, 0.36],
            "noise": 0.8,
            "scale": 6,
            "power": [1.4, 0.35]
          },
          {
            "kind": "burst",
            "look": "water",
            "at": [32, 40],
            "frames": [0, 3],
            "radius": [7, 9, 8],
            "squash": [1, 0.6],
            "floor": 41,
            "noise": 0.25,
            "scale": 4,
            "boil": 0,
            "power": [1.5, 1.3, 0.6]
          },
          {
            "kind": "stream",
            "look": "water",
            "at": [32, 41],
            "through": [[32, 26], [33, 9]],
            "frames": [0, 14],
            "width": [9, 12, 11, 7],
            "taper": [0.75, 0.8, 0.85, 0.75],
            "head": [0.1, 0.82, 0.82, 0.25],
            "tail": 0,
            "sway": 1.2,
            "wavelength": 16,
            "waves": 2,
            "noise": 0.6,
            "scale": 4,
            "power": [1.45, 1.35, 1.1, 0.35],
            "ease": "linear"
          },
          {
            "kind": "stream",
            "look": "water",
            "at": [24, 41],
            "through": [[22, 34], [18, 28], [13, 27], [10, 31]],
            "frames": [1, 12],
            "width": [7, 7, 5],
            "taper": [1, 0.8, 0.65],
            "head": [0.12, 1, 1, 1],
            "tail": [0, 0, 0.35, 1],
            "sway": 0.6,
            "wavelength": 14,
            "waves": 1,
            "noise": 0.5,
            "scale": 4,
            "power": [1.4, 1.35, 1.1, 0.4],
            "ease": "linear",
            "seed": 11
          },
          {
            "kind": "stream",
            "look": "water",
            "at": [40, 40],
            "through": [[42, 34], [46, 29], [51, 28], [54, 32]],
            "frames": [2, 12],
            "width": [7, 7, 5],
            "taper": [1, 0.8, 0.65],
            "head": [0.12, 1, 1, 1],
            "tail": [0, 0, 0.35, 1],
            "sway": -0.6,
            "wavelength": 14,
            "waves": 1,
            "noise": 0.5,
            "scale": 4,
            "power": [1.4, 1.35, 1.1, 0.4],
            "ease": "linear",
            "seed": 12
          }
        ],
        "emitters": [
          {
            "name": "cap-0",
            "at": [32, 36],
            "burst": 1,
            "angle": 270,
            "speed": 5.7,
            "life": 5,
            "blob": { "look": "water", "radius": [2.5600000000000005, 3.2, 3.2, 3.2] }
          },
          {
            "name": "cap-1",
            "at": [28, 35],
            "burst": 1,
            "angle": 264,
            "speed": 5.8,
            "life": 5,
            "blob": { "look": "water", "radius": [3.6, 4.5, 4.5, 4.5] }
          },
          {
            "name": "cap-2",
            "at": [36, 35],
            "burst": 1,
            "angle": 276,
            "speed": 5.8,
            "life": 5,
            "blob": { "look": "water", "radius": [3.6, 4.5, 4.5, 4.5] }
          },
          {
            "name": "shed",
            "from": "cap-1",
            "when": "life",
            "rate": 0.5,
            "at": [-1, 1],
            "area": [4, 3],
            "angle": [165, 200],
            "speed": [0.8, 1.4],
            "gravity": [0, 0.4],
            "life": [3, 4],
            "blob": { "look": "water", "radius": [2.8, 2.4] }
          },
          {
            "name": "shed2",
            "from": "cap-2",
            "when": "life",
            "rate": 0.5,
            "at": [1, 1],
            "area": [4, 3],
            "angle": [340, 375],
            "speed": [0.8, 1.4],
            "gravity": [0, 0.4],
            "life": [3, 4],
            "blob": { "look": "water", "radius": [2.8, 2.4] }
          },
          {
            "name": "tip-left",
            "at": [11, 30],
            "area": [3, 3],
            "burst": 2,
            "start": 5,
            "angle": [95, 120],
            "speed": [0.5, 1],
            "gravity": [0, 0.6],
            "floor": 43,
            "life": [4, 5],
            "blob": { "look": "water", "radius": [3.2, 2.8, 2.4] }
          },
          {
            "name": "tip-right",
            "at": [53, 31],
            "area": [3, 3],
            "burst": 2,
            "start": 6,
            "angle": [60, 85],
            "speed": [0.5, 1],
            "gravity": [0, 0.6],
            "floor": 43,
            "life": [4, 5],
            "blob": { "look": "water", "radius": [3.2, 2.8, 2.4] }
          },
          {
            "name": "crown-left",
            "at": [31, 11],
            "area": [5, 5],
            "burst": 4,
            "start": 5,
            "angle": [185, 240],
            "speed": [1.6, 2.6],
            "gravity": [0, 0.9],
            "floor": 42,
            "life": [8, 9],
            "blob": { "look": "water", "radius": [3.4, 3, 2.6] }
          },
          {
            "name": "crown-right",
            "at": [35, 11],
            "area": [5, 5],
            "burst": 4,
            "start": 5,
            "angle": [300, 355],
            "speed": [1.6, 2.6],
            "gravity": [0, 0.9],
            "floor": 42,
            "life": [8, 9],
            "blob": { "look": "water", "radius": [3.4, 3, 2.6] }
          },
          {
            "name": "splash-left",
            "from": "crown-left",
            "when": "floor",
            "burst": 2,
            "angle": [215, 325],
            "speed": [0.8, 1.4],
            "gravity": [0, 0.35],
            "floor": 43,
            "life": [3, 4],
            "blob": { "look": "water", "radius": [2.6, 2.2] }
          },
          {
            "name": "splash-right",
            "from": "crown-right",
            "when": "floor",
            "burst": 2,
            "angle": [215, 325],
            "speed": [0.8, 1.4],
            "gravity": [0, 0.35],
            "floor": 43,
            "life": [3, 4],
            "blob": { "look": "water", "radius": [2.6, 2.2] }
          },
          {
            "name": "spray",
            "at": [32, 28],
            "line": { "to": [33, 14] },
            "burst": 4,
            "start": 9,
            "angle": [180, 360],
            "speed": [0.6, 1.2],
            "gravity": [0, 0.8],
            "floor": 42,
            "life": [5, 6],
            "blob": { "look": "water", "radius": [3, 2.6] }
          }
        ]
      },
      "buff": {
        "frames": 10,
        "duration": 80,
        "loop": true,
        "seed": 9,
        "looks": {
          "water": {
            "colors": ["b"],
            "thresholds": [0.2],
            "lit": { "colors": ["m", "h"], "thresholds": [0.35, 0.72] },
            "shade": { "colors": ["d"], "thresholds": [0.4] },
            "outline": "o"
          }
        },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "ring",
            "look": "water",
            "at": [32, 40],
            "radius": 14,
            "width": 7,
            "squash": [1, 0.32],
            "noise": 0.3,
            "scale": 5,
            "power": 0.75
          },
          {
            "kind": "stream",
            "look": "water",
            "at": [19, 40],
            "through": [[17, 31], [19, 22], [17, 15]],
            "frames": [0, 6],
            "width": [5, 6, 4],
            "taper": [1, 0.6, 0.1],
            "head": [0.15, 1, 1],
            "tail": [0, 0.2, 1],
            "sway": 1.5,
            "wavelength": 12,
            "waves": 1,
            "noise": 0.4,
            "scale": 4,
            "power": [1.3, 1.25, 0.6],
            "ease": "linear"
          },
          {
            "kind": "stream",
            "look": "water",
            "at": [45, 40],
            "through": [[47, 32], [45, 24], [47, 17]],
            "frames": [4, 10],
            "width": [5, 6, 4],
            "taper": [1, 0.6, 0.1],
            "head": [0.15, 1, 1],
            "tail": [0, 0.2, 1],
            "sway": -1.5,
            "wavelength": 12,
            "waves": 1,
            "noise": 0.4,
            "scale": 4,
            "power": [1.3, 1.25, 0.6],
            "ease": "linear",
            "seed": 3
          }
        ],
        "emitters": [
          {
            "name": "swirl",
            "at": [32, 40],
            "rate": 1.2,
            "speed": 0,
            "life": [7, 9],
            "sway": { "amplitude": [14, 4.5], "period": 10 },
            "blob": { "look": "water", "radius": [1.8, 3.2, 3.2, 1.8] }
          },
          {
            "name": "bubbles",
            "at": [32, 32],
            "area": [28, 12],
            "rate": 0.45,
            "angle": [265, 275],
            "speed": [1.6, 2.2],
            "drag": 0.02,
            "life": [10, 13],
            "sway": { "amplitude": [1.5, 0], "period": 5 },
            "shapes": ["bubble", "bubble-big", "bubble-big", "bubble"]
          }
        ]
      }
    }
  },
  poison: {
    "format": "pixelforge-fx",
    "version": 1,
    "name": "poison-spells",
    "width": 64,
    "height": 64,
    "anchor": [32, 40],
    "palette": {
      "L": "#e8ff9a",
      "l": "#a8e05a",
      "g": "#5aa83a",
      "G": "#2f6b3a",
      "k": "#2b1d33",
      "v": "#6b3a8f",
      "V": "#a463c9",
      "b": "#d6ea8ca6",
      "a": "#8db84a80",
      "A": "#4d7a3a59"
    },
    "symbols": {
      "gb3": [
        ".l.",
        "l.g",
        ".g."
      ],
      "gb4": [
        ".ll.",
        "lL.g",
        "l..g",
        ".gg."
      ],
      "gb5": [
        ".lll.",
        "lL..g",
        "l...g",
        "l...g",
        ".ggg."
      ],
      "gpop": [
        ".l..l.",
        "l....l",
        "......",
        "......",
        "g....g",
        ".g..g."
      ],
      "vb3": [
        ".V.",
        "V.v",
        ".v."
      ],
      "vb4": [
        ".VV.",
        "VL.v",
        "V..v",
        ".vv."
      ],
      "vb5": [
        ".VVV.",
        "VL..v",
        "V...v",
        "V...v",
        ".vvv."
      ],
      "vpop": [
        ".V..V.",
        "V....V",
        "......",
        "......",
        "v....v",
        ".v..v."
      ]
    },
    "effects": {
      "projectile": {
        "frames": 8,
        "duration": 60,
        "loop": true,
        "seed": 5,
        "turn": { "angles": [0, 45, 90, 135, 180, 225, 270, 315], "about": [32, 40] },
        "looks": {
          "gas": {
            "colors": ["A", "a"],
            "thresholds": [0.3, 0.6],
            "light": [-0.5, -1],
            "lit": { "colors": ["b"], "thresholds": [0.7] }
          },
          "slime": {
            "colors": ["g", "l"],
            "thresholds": [0.2, 1],
            "light": [-0.5, -0.5],
            "lit": { "colors": ["L"], "thresholds": [0.75] },
            "shade": { "colors": ["G"], "thresholds": [0.6] },
            "outline": "k"
          }
        },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "burst",
            "look": "slime",
            "at": [37, 40],
            "radius": [6.5, 7, 6.5],
            "noise": 0.2,
            "scale": 4,
            "boil": 3,
            "power": 1.6
          }
        ],
        "emitters": [
          {
            "name": "goo",
            "at": [33, 40],
            "area": [2, 3],
            "rate": 1.1,
            "angle": [174, 186],
            "speed": [1.6, 2.1],
            "drag": 0.05,
            "life": [7, 9],
            "blob": { "look": "slime", "radius": [4.2, 3.4, 2.4, 1.4] }
          },
          {
            "name": "puffs",
            "at": [22, 40],
            "area": [2, 4],
            "rate": 0.75,
            "angle": [168, 192],
            "speed": [0.7, 1.7],
            "gravity": [0, -0.04],
            "drag": 0.08,
            "life": [6, 7],
            "blob": { "look": "gas", "radius": [2.4, 3.4, 3.2, 2.6] }
          },
          {
            "name": "drips",
            "at": [36, 40],
            "area": [6, 6],
            "rate": 0.4,
            "angle": [170, 190],
            "speed": [0.3, 0.6],
            "gravity": [0, 0.25],
            "life": [6, 8],
            "blob": { "look": "slime", "radius": [2.6, 2.4, 2.2, 1.8] }
          }
        ]
      },
      "impact": {
        "frames": 12,
        "duration": { "from": 40, "to": 100, "ease": "in" },
        "seed": 18,
        "looks": {
          "gas": {
            "colors": ["A", "a"],
            "thresholds": [0.3, 0.6],
            "light": [-0.5, -1],
            "lit": { "colors": ["b"], "thresholds": [0.7] }
          },
          "slime": {
            "colors": ["g", "l"],
            "thresholds": [0.2, 1],
            "light": [-0.5, -0.5],
            "lit": { "colors": ["L"], "thresholds": [0.75] },
            "shade": { "colors": ["G"], "thresholds": [0.6] },
            "outline": "k"
          }
        },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "star",
            "look": "slime",
            "at": [32, 40],
            "frames": [0, 2],
            "radius": [13, 15],
            "points": 8,
            "ratio": 0.7,
            "width": [3.2, 2.4],
            "core": [7, 6],
            "angle": 10,
            "jitter": 0.45,
            "noise": 0.3,
            "scale": 3,
            "power": [1.2, 0.9],
            "cue": "hit"
          },
          {
            "kind": "burst",
            "look": "slime",
            "at": [32, 40],
            "frames": [0, 5],
            "radius": [8, 9, 7],
            "noise": 0.6,
            "scale": 3,
            "boil": 3,
            "power": [1.6, 1, 0.35, 0.1]
          }
        ],
        "emitters": [
          {
            "name": "lobes",
            "at": [32, 40],
            "ring": { "radius": [8, 13], "outward": true, "even": true },
            "burst": 8,
            "start": 0,
            "angle": [-8, 8],
            "speed": [1.4, 3],
            "gravity": [0, 0.22],
            "drag": 0.1,
            "floor": 58,
            "life": [5, 7],
            "blob": { "look": "slime", "radius": [3.6, 3.2, 2.6, 2] }
          },
          {
            "name": "gas",
            "at": [27, 36],
            "area": [12, 10],
            "burst": 8,
            "start": 1,
            "angle": [185, 290],
            "speed": [0.8, 1.6],
            "gravity": [0, -0.08],
            "drag": 0.1,
            "turbulence": { "strength": 0.12, "scale": 6 },
            "life": [9, 10],
            "blob": { "look": "gas", "radius": [3, 6, 5, 2], "power": [1, 1, 0.8, 0.5] }
          },
          {
            "name": "bubbles",
            "at": [25, 33],
            "line": { "to": [39, 29], "even": true },
            "burst": 2,
            "start": 4,
            "angle": [255, 285],
            "speed": [0.5, 0.7],
            "life": [6, 7],
            "shapes": [["vb3", "vb4", "vb5", "vb5", "vb5", "vpop"]]
          },
          {
            "name": "gas-right",
            "at": [37, 39],
            "area": [12, 10],
            "burst": 8,
            "start": 1,
            "angle": [250, 355],
            "speed": [0.8, 1.6],
            "gravity": [0, -0.08],
            "drag": 0.1,
            "turbulence": { "strength": 0.12, "scale": 6 },
            "life": [9, 10],
            "blob": { "look": "gas", "radius": [3, 6, 5, 2], "power": [1, 1, 0.8, 0.5] }
          }
        ]
      },
      "area": {
        "frames": 22,
        "duration": { "from": 50, "to": 100, "ease": "in" },
        "seed": 7,
        "looks": {
          "pool": {
            "colors": ["G", "g", "l"],
            "thresholds": [0.15, 0.45, 1.05],
            "light": [-0.5, -0.5],
            "lit": { "colors": ["L"], "thresholds": [0.8] },
            "shade": { "colors": ["G"], "thresholds": [0.5] },
            "outline": "k"
          },
          "gas": {
            "colors": ["A", "a"],
            "thresholds": [0.3, 0.6],
            "light": [-0.5, -1],
            "lit": { "colors": ["b"], "thresholds": [0.7] }
          }
        },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "burst",
            "look": "pool",
            "at": [32, 40],
            "frames": [0, 16],
            "radius": [16, 20, 21, 21, 21, 20],
            "squash": [1, 0.32],
            "noise": 0.12,
            "scale": 6,
            "boil": 3,
            "power": [1.7, 1.5, 1.4, 1.4, 1.3, 0.6],
            "ease": "linear",
            "cue": "hit"
          },
          {
            "kind": "burst",
            "look": "pool",
            "at": [32, 40],
            "frames": [13, 22],
            "radius": [20, 17],
            "squash": [1, 0.32],
            "noise": 0.45,
            "scale": 6,
            "boil": 2,
            "power": [1.2, 0.04],
            "ease": "linear"
          }
        ],
        "emitters": [
          {
            "name": "splash",
            "at": [18, 39],
            "line": { "to": [46, 39], "even": true },
            "burst": 6,
            "start": 0,
            "angle": [250, 290],
            "speed": [2.8, 3.6],
            "gravity": [0, 0.34],
            "floor": 41,
            "life": [7, 9],
            "blob": { "look": "pool", "radius": [3.2, 3, 2.6, 2.2] }
          },
          {
            "name": "bubbles",
            "at": [32, 40],
            "area": [24, 4],
            "rate": 0.4,
            "start": 3,
            "end": 12,
            "angle": [265, 275],
            "speed": [0.1, 0.3],
            "life": [5, 7],
            "shapes": [["gb3", "gb4", "gb5", "gb5", "gpop"], ["gb3", "gb4", "gb4", "gpop"], ["vb3", "vb4", "vb5", "vpop"]]
          },
          {
            "name": "cloud-left",
            "at": [25, 39],
            "area": [18, 3],
            "rate": 0.9,
            "start": 2,
            "end": 12,
            "angle": [220, 265],
            "speed": [1.8, 2.6],
            "gravity": [0, -0.05],
            "drag": 0.09,
            "life": [10, 11],
            "blob": { "look": "gas", "radius": [3, 6, 5, 2] }
          },
          {
            "name": "cloud-right",
            "at": [39, 39],
            "area": [18, 3],
            "rate": 0.9,
            "start": 2,
            "end": 12,
            "angle": [275, 320],
            "speed": [1.8, 2.6],
            "gravity": [0, -0.05],
            "drag": 0.09,
            "life": [10, 11],
            "blob": { "look": "gas", "radius": [3, 6, 5, 2] }
          }
        ]
      },
      "buff": {
        "frames": 12,
        "duration": 80,
        "loop": true,
        "seed": 7,
        "looks": {
          "pool": {
            "colors": ["G", "g", "l"],
            "thresholds": [0.15, 0.5, 1.1],
            "light": [-0.5, -0.5],
            "lit": { "colors": ["L"], "thresholds": [0.92] },
            "shade": { "colors": ["G"], "thresholds": [0.5] },
            "outline": "k"
          }
        },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "burst",
            "look": "pool",
            "at": [32, 40],
            "radius": 9.5,
            "squash": [1, 0.35],
            "noise": 0.1,
            "scale": 5,
            "boil": 4,
            "power": 1.35
          }
        ],
        "emitters": [
          {
            "name": "drip",
            "at": [31, 30],
            "area": [2, 2],
            "burst": 1,
            "start": 4,
            "angle": [88, 92],
            "speed": [0.2, 0.3],
            "gravity": [0, 0.2],
            "floor": 40,
            "life": [7, 7],
            "blob": { "look": "pool", "radius": [1.7, 1.9, 1.9, 2.2] }
          },
          {
            "name": "bubble-a",
            "at": [24, 34],
            "area": [2, 2],
            "burst": 1,
            "start": 0,
            "angle": [268, 272],
            "speed": [1.9, 2.1],
            "life": [11, 11],
            "sway": { "amplitude": [1, 0], "period": 6 },
            "shapes": [["gb4", "gb4", "gb5", "gb5", "gb5", "gpop"]]
          },
          {
            "name": "bubble-b",
            "at": [40, 30],
            "area": [2, 2],
            "burst": 1,
            "start": 3,
            "angle": [268, 272],
            "speed": [1.8, 2],
            "life": [10, 10],
            "sway": { "amplitude": [1, 0], "period": 6 },
            "shapes": [["vb4", "vb4", "vb5", "vb5", "vb5", "vpop"]]
          },
          {
            "name": "bubble-c",
            "at": [31, 27],
            "area": [2, 2],
            "burst": 1,
            "start": 6,
            "angle": [268, 272],
            "speed": [1.6, 1.8],
            "life": [9, 9],
            "sway": { "amplitude": [1, 0], "period": 6 },
            "shapes": [["gb3", "gb4", "gb4", "gb4", "gpop"]]
          },
          {
            "name": "bubble-d",
            "at": [37, 36],
            "area": [2, 2],
            "burst": 1,
            "start": 9,
            "angle": [268, 272],
            "speed": [1.9, 2.1],
            "life": [11, 11],
            "sway": { "amplitude": [1, 0], "period": 6 },
            "shapes": [["gb4", "gb4", "gb5", "gb5", "gb5", "gpop"]]
          }
        ]
      }
    }
  },
  holy: {
    "format": "pixelforge-fx",
    "version": 1,
    "name": "holy-spells",
    "width": 64,
    "height": 64,
    "palette": { "W": "#fffef0", "Y": "#fff3b0", "y": "#ffd84d", "g": "#e0a83a", "o": "#b8742a", "s": "#4a4e63" },
    "symbols": {
      "stand-in": [
        ".....ssssss.....",
        "....ssssssss....",
        "....ssssssss....",
        "....ssssssss....",
        "....ssssssss....",
        ".....ssssss.....",
        "......ssss......",
        "...ssssssssss...",
        "..ssssssssssss..",
        "..ssssssssssss..",
        ".sss.ssssss.sss.",
        ".sss.ssssss.sss.",
        ".sss.ssssss.sss.",
        ".sss.ssssss.sss.",
        ".sss.ssssss.sss.",
        ".sss.ssssss.sss.",
        ".sss.ssssss.sss.",
        ".sss.ssssss.sss.",
        ".ss..ssssss..ss.",
        ".ss..ssssss..ss.",
        ".....ssssss.....",
        ".....ssssss.....",
        "....sss..sss....",
        "....sss..sss....",
        "....sss..sss....",
        "....sss..sss....",
        "....sss..sss....",
        "....sss..sss....",
        "....sss..sss....",
        "....sss..sss....",
        "....sss..sss....",
        "....sss..sss....",
        "....sss..sss....",
        "...ssss..ssss..."
      ],
      "twinkle": [
        "..y..",
        "..Y..",
        "yYWYy",
        "..Y..",
        "..y.."
      ],
      "mote-big": [
        ".Y.",
        "YWY",
        ".Y."
      ],
      "mote-cross": [
        ".y.",
        "yYy",
        ".y."
      ],
      "mote": ["Y"],
      "mote-y": ["y"],
      "mote-g": ["g"]
    },
    "anchor": [32, 40],
    "effects": {
      "projectile": {
        "frames": 8,
        "duration": 60,
        "loop": true,
        "seed": 2,
        "turn": { "angles": [0, 45, 90, 135, 180, 225, 270, 315], "about": [32, 40] },
        "looks": { "light": { "colors": ["o", "g", "y", "Y", "W"], "thresholds": [0.12, 0.25, 0.45, 0.7, 0.9] } },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "beam",
            "look": "light",
            "at": [32, 40],
            "to": [12, 40],
            "width": 4,
            "wobble": 0.25,
            "wavelength": 8,
            "waves": 2,
            "fade": 0.9
          },
          {
            "kind": "beam",
            "look": "light",
            "at": [29, 37],
            "to": [17, 37],
            "width": 2.2,
            "wobble": 0.35,
            "wavelength": 6,
            "waves": 2,
            "fade": 0.8,
            "power": 0.8
          },
          {
            "kind": "beam",
            "look": "light",
            "at": [29, 43],
            "to": [17, 43],
            "width": 2.2,
            "wobble": 0.35,
            "wavelength": 6,
            "waves": 2,
            "fade": 0.8,
            "power": 0.8
          },
          { "kind": "burst", "look": "light", "at": [32, 40], "radius": 6.2, "noise": 0, "power": 0.92 },
          {
            "kind": "star",
            "look": "light",
            "at": [32, 40],
            "radius": [10, 7.5, 10],
            "points": 4,
            "ratio": 1,
            "width": 1,
            "core": 1.5,
            "power": 0.95
          }
        ],
        "emitters": [
          {
            "at": [23, 40],
            "area": [8, 10],
            "rate": 0.6,
            "angle": [165, 195],
            "speed": [0.2, 0.6],
            "drag": 0.05,
            "life": [4, 6],
            "shapes": [["mote-big", "mote", "mote-y"], ["mote-cross", "mote-y", "mote-g"]]
          }
        ]
      },
      "impact": {
        "frames": 14,
        "duration": { "from": 40, "to": 90, "ease": "in" },
        "seed": 5,
        "looks": {
          "light": { "colors": ["o", "g", "y", "Y", "W"], "thresholds": [0.12, 0.3, 0.5, 0.72, 0.9] },
          "halo": { "colors": ["g", "y", "Y", "W"], "thresholds": [0.12, 0.35, 0.6, 0.88] }
        },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "star",
            "look": "light",
            "at": [32, 40],
            "frames": [0, 2],
            "radius": [17, 13],
            "points": 16,
            "ratio": 0.5,
            "width": [2, 1.4],
            "core": [2.5, 1.8],
            "jitter": 0.3,
            "power": [1, 0.85],
            "ease": "linear",
            "cue": "hit"
          },
          {
            "kind": "star",
            "look": "light",
            "at": [32, 40],
            "frames": [0, 2],
            "radius": [22, 18],
            "points": 4,
            "ratio": 1,
            "width": [2.2, 1.6],
            "core": 0,
            "power": [1, 0.9],
            "ease": "linear"
          },
          {
            "kind": "star",
            "look": "light",
            "at": [32, 40],
            "frames": [1, 2],
            "radius": 20,
            "points": 8,
            "ratio": 1,
            "angle": 22.5,
            "width": 1,
            "core": 0,
            "power": 0.7
          },
          {
            "kind": "ring",
            "look": "halo",
            "at": [32, 40],
            "frames": [2, 9],
            "radius": [10, 23],
            "width": [2, 3, 4],
            "noise": 0.9,
            "scale": 6,
            "power": [1.3, 1, 0.5, 0.12]
          }
        ],
        "emitters": [
          {
            "at": [32, 40],
            "ring": { "radius": [4, 9], "arc": [170, 370], "outward": true },
            "burst": 9,
            "start": 2,
            "angle": [-30, 30],
            "speed": [0.8, 2.6],
            "gravity": [0, -0.16],
            "drag": 0.08,
            "sway": { "amplitude": [1, 0], "period": 6 },
            "life": [8, 11],
            "shapes": [
              ["twinkle", "mote-big", "mote-big", "mote-cross", "mote-cross", "mote-y"],
              ["mote-big", "mote-big", "mote-cross", "mote-cross", "mote-y"]
            ]
          }
        ]
      },
      "area": {
        "frames": 16,
        "duration": { "from": 50, "to": 90, "ease": "in" },
        "seed": 7,
        "looks": {
          "rune": { "colors": ["o", "g", "y", "Y"], "thresholds": [0.12, 0.75, 0.85, 0.95] },
          "light": { "colors": ["o", "g", "y", "Y", "W"], "thresholds": [0.1, 0.2, 0.4, 0.65, 0.88] }
        },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "glyph",
            "look": "rune",
            "at": [32, 40],
            "frames": [0, 15],
            "radius": 22,
            "inner": 0.6,
            "points": 4,
            "step": 1,
            "runes": 8,
            "spin": [0, 22.5],
            "reveal": 0.2,
            "glow": 0,
            "squash": [1, 0.45],
            "power": [1, 1.35, 1.1, 1, 1, 1, 0.5, 0],
            "ease": "linear"
          },
          {
            "kind": "star",
            "look": "light",
            "at": [32, 40],
            "frames": [3, 5],
            "radius": [27, 22],
            "points": 8,
            "ratio": 0.5,
            "width": [2, 1],
            "core": 0,
            "squash": [1, 0.45],
            "power": [0.9, 0.3]
          },
          {
            "kind": "ring",
            "look": "light",
            "at": [32, 40],
            "frames": [3, 10],
            "radius": [18, 29],
            "width": 4,
            "squash": [1, 0.45],
            "noise": 0.9,
            "scale": 5,
            "power": [1.1, 0.25]
          },
          {
            "kind": "beam",
            "look": "light",
            "at": [32, 40],
            "to": [32, 3],
            "frames": [3, 14],
            "width": [5, 16, 13, 0],
            "reveal": 0.12,
            "wobble": 0.06,
            "wavelength": 8,
            "waves": 3,
            "fade": 0.75,
            "squash": [1, 0.45],
            "power": [1, 0.95, 0.6],
            "ease": "linear",
            "cue": "hit"
          }
        ],
        "emitters": [
          {
            "at": [32, 37],
            "area": [36, 5],
            "rate": 0.8,
            "start": 4,
            "end": 9,
            "angle": [265, 275],
            "speed": [1.6, 2.6],
            "life": [5, 7],
            "shapes": [
              ["twinkle", "mote-big", "mote-big", "mote-cross"],
              ["mote-big", "mote-cross", "mote-cross", "mote-y"]
            ],
            "behind": true
          },
          {
            "at": [32, 43],
            "area": [36, 5],
            "rate": 0.8,
            "start": 4,
            "end": 9,
            "angle": [265, 275],
            "speed": [1.6, 2.6],
            "life": [5, 7],
            "shapes": [
              ["twinkle", "mote-big", "mote-big", "mote-cross"],
              ["mote-big", "mote-cross", "mote-cross", "mote-y"]
            ]
          }
        ]
      },
      "buff": {
        "frames": 10,
        "duration": 80,
        "loop": true,
        "seed": 9,
        "looks": {
          "rune": { "colors": ["o", "g", "y", "Y"], "thresholds": [0.12, 0.75, 0.85, 0.95] },
          "halo": { "colors": ["g", "y", "Y"], "thresholds": [0.2, 0.6, 0.9] }
        },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "glyph",
            "look": "rune",
            "at": [32, 40],
            "radius": 15,
            "inner": 0.62,
            "points": 0,
            "runes": 6,
            "spin": 60,
            "glow": 0,
            "squash": [1, 0.45],
            "depth": "split"
          },
          {
            "kind": "ring",
            "look": "halo",
            "at": [32, 35],
            "radius": [13, 10],
            "width": 1.5,
            "squash": [1, 0.4],
            "drift": [0, -22],
            "noise": 0.75,
            "scale": 4,
            "power": [0, 1.3, 1.1, 0],
            "depth": "split"
          },
          { "kind": "ring", "look": "halo", "at": [32, 3], "radius": 6, "width": 1.5, "squash": [1, 0.35], "depth": "split" }
        ],
        "emitters": [
          {
            "at": [32, 40],
            "area": [30, 10],
            "rate": 0.5,
            "angle": [266, 274],
            "speed": [1.8, 2.4],
            "drag": 0.02,
            "sway": { "amplitude": [1, 0], "period": 8 },
            "life": [13, 17],
            "depth": "split",
            "shapes": [
              ["twinkle", "mote-big", "mote-big", "mote-cross", "mote-cross", "mote-y"],
              ["mote-big", "mote-cross", "mote-cross", "mote-cross", "mote-y"]
            ]
          },
          {
            "at": [32, 40],
            "area": [26, 8],
            "rate": 0.35,
            "angle": 270,
            "speed": [1.8, 2.4],
            "life": [8, 11],
            "shapes": [["mote", "mote-y", "mote-g"]],
            "trail": { "color": "g", "length": 3 },
            "depth": "split"
          },
          {
            "name": "stand-in",
            "sprite": { "symbol": "stand-in", "draw": true },
            "at": [24, 6],
            "depth": "between"
          }
        ]
      }
    }
  },
  shadow: {
    "format": "pixelforge-fx",
    "version": 1,
    "name": "shadow-spells",
    "width": 64,
    "height": 64,
    "palette": { "W": "#f0d8ff", "p": "#c08cff", "v": "#7a3fd6", "V": "#4a1f8f", "k": "#24123d", "K": "#120a1f" },
    "symbols": {
      "mote-p": ["p"],
      "mote-v": ["v"],
      "void-mote": [
        ".p.",
        "pKp",
        ".p."
      ]
    },
    "anchor": [32, 40],
    "effects": {
      "projectile": {
        "frames": 8,
        "duration": 60,
        "loop": true,
        "seed": 5,
        "turn": { "angles": [0, 45, 90, 135, 180, 225, 270, 315], "about": [32, 40] },
        "looks": {
          "smoke": {
            "colors": ["V", "k"],
            "thresholds": [0.15, 0.45],
            "lit": { "colors": ["v"], "thresholds": [0.45] },
            "shade": { "colors": ["K"], "thresholds": [0.7] },
            "outline": "K"
          },
          "trail": { "colors": ["v", "V", "k"], "thresholds": [0.1, 0.22, 0.45], "outline": "K" },
          "rim": { "colors": ["p", "W"], "thresholds": [0.12, 0.45] },
          "void": { "colors": ["p", "V", "k", "K"], "thresholds": [0.1, 0.22, 0.45, 0.75], "outline": "K" }
        },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "stream",
            "look": "trail",
            "at": [30, 40],
            "through": [[24, 40], [18, 40], [13, 40]],
            "width": 10,
            "taper": [1, 0.55, 0.25, 0],
            "sway": 2,
            "wavelength": 16,
            "waves": 1,
            "noise": 0.45,
            "scale": 3,
            "power": 1.3
          },
          { "kind": "burst", "look": "rim", "at": [35.7, 40], "radius": 7, "noise": 0.15, "boil": 3, "power": 1.3 },
          { "kind": "burst", "look": "void", "at": [33, 40], "radius": 7, "noise": 0.2, "boil": 4, "power": 1.3 }
        ],
        "emitters": [
          {
            "name": "wisps",
            "at": [21, 40],
            "area": [4, 6],
            "rate": 0.8,
            "angle": [160, 200],
            "speed": [1.1, 1.6],
            "gravity": [0, 0.06],
            "drag": 0.1,
            "life": [7, 9],
            "sway": { "amplitude": [1, 1.2], "period": 8 },
            "blob": { "look": "smoke", "radius": [2.6, 3.4, 2.6, 1.2] }
          }
        ]
      },
      "impact": {
        "frames": 12,
        "duration": { "from": 40, "to": 95, "ease": "in" },
        "seed": 3,
        "looks": {
          "smoke": {
            "colors": ["V", "k"],
            "thresholds": [0.15, 0.42],
            "lit": { "colors": ["v"], "thresholds": [0.4] },
            "shade": { "colors": ["K"], "thresholds": [0.65] },
            "outline": "K"
          },
          "void": {
            "colors": ["V", "k", "K"],
            "thresholds": [0.12, 0.3, 0.6],
            "lit": { "colors": ["v", "p"], "thresholds": [0.35, 0.7] },
            "outline": "K"
          },
          "glow": { "colors": ["V", "v", "p", "W"], "thresholds": [0.15, 0.35, 0.6, 0.88] }
        },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "ring",
            "look": "glow",
            "at": [32, 40],
            "frames": [0, 2],
            "radius": [15, 5],
            "width": [3.5, 3.5],
            "noise": 0.3,
            "power": [1.2, 1.4],
            "ease": "linear"
          },
          {
            "kind": "burst",
            "look": "void",
            "at": [32, 40],
            "frames": [1, 2],
            "radius": 5,
            "noise": 0.2,
            "boil": 0,
            "power": 1.5
          },
          {
            "kind": "burst",
            "look": "void",
            "at": [32, 40],
            "frames": [2, 10],
            "radius": [11, 14, 15],
            "hole": [0, 0.45, 0.85],
            "noise": 0.6,
            "scale": 4,
            "power": [1.7, 1.3, 0.7, 0.25],
            "cue": "hit"
          },
          {
            "kind": "ring",
            "look": "glow",
            "at": [32, 40],
            "frames": [2, 3],
            "radius": 10,
            "width": 3,
            "noise": 0.3,
            "scale": 4,
            "power": 1.2
          },
          {
            "kind": "stream",
            "look": "void",
            "at": [36.9, 40.9],
            "through": [[41.1, 44.2], [42.3, 50.3], [38, 56.5], [29.3, 59.2]],
            "frames": [2, 9],
            "width": [6, 6, 5, 4],
            "taper": [0.5, 1, 0],
            "head": [0.3, 0.85, 1, 1],
            "tail": [0, 0.15, 0.6, 1],
            "noise": 0.7,
            "scale": 4,
            "power": [1.5, 1.4, 1.1, 0.4],
            "ease": "out",
            "seed": 20
          },
          {
            "kind": "stream",
            "look": "void",
            "at": [33.9, 44.6],
            "through": [[33, 48.4], [29.1, 52.4], [22.1, 52.7], [14.9, 47.6]],
            "frames": [2, 9],
            "width": [6, 6, 5, 4],
            "taper": [0.5, 1, 0],
            "head": [0.3, 0.85, 1, 1],
            "tail": [0, 0.15, 0.6, 1],
            "noise": 0.7,
            "scale": 4,
            "power": [1.5, 1.4, 1.1, 0.4],
            "ease": "out",
            "seed": 21
          },
          {
            "kind": "stream",
            "look": "void",
            "at": [28.7, 43.7],
            "through": [[24, 45.2], [18.1, 43.2], [14.3, 36.2], [16, 26.6]],
            "frames": [2, 9],
            "width": [6, 6, 5, 4],
            "taper": [0.5, 1, 0],
            "head": [0.3, 0.85, 1, 1],
            "tail": [0, 0.15, 0.6, 1],
            "noise": 0.7,
            "scale": 4,
            "power": [1.5, 1.4, 1.1, 0.4],
            "ease": "out",
            "seed": 22
          },
          {
            "kind": "stream",
            "look": "void",
            "at": [27, 39.3],
            "through": [[24.6, 36.9], [23.2, 31.8], [26.3, 25.9], [33.8, 22.5]],
            "frames": [2, 9],
            "width": [6, 6, 5, 4],
            "taper": [0.5, 1, 0],
            "head": [0.3, 0.85, 1, 1],
            "tail": [0, 0.15, 0.6, 1],
            "noise": 0.7,
            "scale": 4,
            "power": [1.5, 1.4, 1.1, 0.4],
            "ease": "out",
            "seed": 23
          },
          {
            "kind": "stream",
            "look": "void",
            "at": [30.1, 35.4],
            "through": [[30.8, 30.1], [35.4, 25.4], [43.7, 25], [52.1, 31.1]],
            "frames": [2, 9],
            "width": [6, 6, 5, 4],
            "taper": [0.5, 1, 0],
            "head": [0.3, 0.85, 1, 1],
            "tail": [0, 0.15, 0.6, 1],
            "noise": 0.7,
            "scale": 4,
            "power": [1.5, 1.4, 1.1, 0.4],
            "ease": "out",
            "seed": 24
          },
          {
            "kind": "stream",
            "look": "void",
            "at": [35.5, 36.4],
            "through": [[39.7, 35.4], [45.3, 37.4], [48.6, 44.1], [46.7, 53.2]],
            "frames": [2, 9],
            "width": [6, 6, 5, 4],
            "taper": [0.5, 1, 0],
            "head": [0.3, 0.85, 1, 1],
            "tail": [0, 0.15, 0.6, 1],
            "noise": 0.7,
            "scale": 4,
            "power": [1.5, 1.4, 1.1, 0.4],
            "ease": "out",
            "seed": 25
          },
          {
            "kind": "ring",
            "look": "glow",
            "at": [32, 40],
            "frames": [3, 7],
            "radius": [13, 22],
            "width": [5, 4],
            "noise": 1,
            "scale": 5,
            "power": [1.4, 0.17]
          }
        ],
        "emitters": [
          {
            "name": "mist",
            "at": [32, 40],
            "area": [22, 16],
            "burst": 16,
            "start": 3,
            "angle": [0, 360],
            "speed": [0.3, 0.8],
            "gravity": [0, 0.02],
            "drag": 0.12,
            "life": [6, 8],
            "sway": { "amplitude": [1, 1], "period": 8 },
            "blob": { "look": "smoke", "radius": [3, 5.2, 4.2, 1.2] }
          }
        ]
      },
      "area": {
        "frames": 19,
        "duration": { "from": 50, "to": 100, "ease": "in" },
        "seed": 8,
        "looks": {
          "smoke": {
            "colors": ["V", "k"],
            "thresholds": [0.15, 0.42],
            "lit": { "colors": ["v"], "thresholds": [0.4] },
            "shade": { "colors": ["K"], "thresholds": [0.65] },
            "outline": "K"
          },
          "pool": { "colors": ["p", "V", "k", "K"], "thresholds": [0.1, 0.3, 0.6, 0.85], "outline": "K" },
          "glow": { "colors": ["V", "v", "p", "W"], "thresholds": [0.15, 0.35, 0.6, 0.88] }
        },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "burst",
            "look": "pool",
            "at": [32, 40],
            "frames": [0, 18],
            "radius": [6, 18, 20, 20, 19, 10, 0],
            "squash": [1, 0.34],
            "noise": 0.2,
            "scale": 5,
            "boil": 3,
            "power": 1.4,
            "ease": "linear",
            "cue": "hit"
          },
          {
            "kind": "stream",
            "look": "pool",
            "at": [27, 40],
            "through": [[23, 31], [28, 21], [25, 12], [29, 5]],
            "frames": [2, 16],
            "width": 10,
            "taper": [1, 0.6, 0.25],
            "head": [0, 1, 1, 0],
            "sway": 2.5,
            "wavelength": 16,
            "waves": 1,
            "power": 1.3,
            "ease": "linear",
            "seed": 1
          },
          {
            "kind": "stream",
            "look": "pool",
            "at": [38, 41],
            "through": [[42, 33], [38, 24], [42, 15]],
            "frames": [4, 17],
            "width": 9,
            "taper": [1, 0.6, 0.25],
            "head": [0, 1, 1, 0],
            "sway": 2.5,
            "wavelength": 16,
            "waves": 1,
            "power": 1.3,
            "ease": "linear",
            "seed": 2
          },
          {
            "kind": "stream",
            "look": "pool",
            "at": [20, 39],
            "through": [[15, 34], [17, 27], [14, 23]],
            "frames": [6, 15],
            "width": 6,
            "taper": [1, 0.6, 0.25],
            "head": [0, 1, 1, 0],
            "sway": 2,
            "wavelength": 16,
            "waves": 1,
            "power": 1.3,
            "ease": "linear",
            "seed": 3
          },
          {
            "kind": "stream",
            "look": "pool",
            "at": [45, 39],
            "through": [[50, 35], [48, 29], [51, 25]],
            "frames": [5, 14],
            "width": 6,
            "taper": [1, 0.6, 0.25],
            "head": [0, 1, 1, 0],
            "sway": 2,
            "wavelength": 16,
            "waves": 1,
            "power": 1.3,
            "ease": "linear",
            "seed": 4
          },
          {
            "kind": "ring",
            "look": "glow",
            "at": [32, 40],
            "frames": [0, 5],
            "radius": [8, 24],
            "width": [3, 3],
            "squash": [1, 0.34],
            "noise": 0.9,
            "scale": 5,
            "power": [1.4, 0.2]
          },
          {
            "kind": "ring",
            "look": "glow",
            "at": [32, 40],
            "frames": [2, 16],
            "radius": [17, 21, 21, 19, 11],
            "width": 3,
            "squash": [1, 0.34],
            "noise": 0.8,
            "scale": 4,
            "power": [0.9, 1.1, 1, 0.7, 0.18],
            "ease": "linear"
          }
        ]
      },
      "buff": {
        "frames": 10,
        "duration": 80,
        "loop": true,
        "seed": 6,
        "looks": {
          "smoke": {
            "colors": ["V", "k"],
            "thresholds": [0.15, 0.42],
            "lit": { "colors": ["v", "p"], "thresholds": [0.4, 0.85] },
            "shade": { "colors": ["K"], "thresholds": [0.65] },
            "outline": "K"
          },
          "pool": { "colors": ["p", "V", "k", "K"], "thresholds": [0.1, 0.3, 0.6, 0.85], "outline": "K" },
          "glow": { "colors": ["V", "v", "p", "W"], "thresholds": [0.15, 0.35, 0.6, 0.88] }
        },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "burst",
            "look": "pool",
            "at": [32, 40],
            "radius": 10,
            "squash": [1, 0.34],
            "noise": 0.25,
            "scale": 5,
            "boil": 3,
            "power": 1.4
          },
          {
            "kind": "stream",
            "look": "pool",
            "at": [23, 39],
            "through": [[20, 31], [21, 22], [24, 15], [27, 13]],
            "width": [8, 9.5, 8],
            "taper": [1, 0.75, 0.45, 0.25],
            "sway": 2.2,
            "wavelength": 14,
            "waves": 1,
            "power": 1.3,
            "seed": 1
          },
          {
            "kind": "stream",
            "look": "pool",
            "at": [41, 39],
            "through": [[44, 31], [43, 22], [40, 15], [37, 13]],
            "width": [9.5, 8, 9.5],
            "taper": [1, 0.75, 0.45, 0.25],
            "sway": 2.2,
            "wavelength": 16,
            "waves": 1,
            "power": 1.3,
            "seed": 2
          },
          {
            "kind": "stream",
            "look": "pool",
            "at": [19, 38],
            "through": [[15, 33], [16, 27]],
            "width": 5,
            "taper": [1, 0.75, 0.45, 0.25],
            "sway": 1.5,
            "wavelength": 10,
            "waves": 1,
            "power": 1.3,
            "seed": 3
          },
          {
            "kind": "stream",
            "look": "pool",
            "at": [45, 38],
            "through": [[49, 33], [48, 27]],
            "width": 5,
            "taper": [1, 0.75, 0.45, 0.25],
            "sway": 1.5,
            "wavelength": 11,
            "waves": 1,
            "power": 1.3,
            "seed": 4
          },
          {
            "kind": "ring",
            "look": "glow",
            "at": [32, 40],
            "radius": 12.5,
            "width": 3,
            "squash": [1, 0.34],
            "noise": 0.5,
            "scale": 4,
            "power": [1.25, 0.75, 1.25]
          }
        ],
        "emitters": [
          {
            "name": "motes",
            "at": [32, 18],
            "area": [2, 12],
            "rate": 0.4,
            "angle": [88, 92],
            "speed": [1, 1.3],
            "life": [10, 10],
            "sway": { "amplitude": [12, 3], "period": 10 },
            "shapes": ["void-mote", "void-mote", "mote-p", "mote-v"]
          }
        ]
      }
    }
  }
};
