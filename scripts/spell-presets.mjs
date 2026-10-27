// Reviewed pixelforge-fx effects built from shape layers: four spells and a set of cel-shaded water effects, written
// to examples/<name>.fx.json by scripts/generate-examples.js. Their compiled pixels are pinned in test/shapes.test.js.
export const spellPresets = {
  'slash-hit': {
    "format": "pixelforge-fx",
    "version": 1,
    "name": "slash-hit",
    "width": 80,
    "height": 64,
    "palette": {
      "k": "#16182e",
      "b": "#2f4fb3",
      "c": "#4fa3f7",
      "p": "#aee6ff",
      "W": "#ffffff",
      "y": "#ffe066",
      "o": "#ff9a3c"
    },
    "symbols": { "spark": ["W"], "spark-y": ["y"], "spark-o": ["o"] },
    "effects": {
      "slash-hit": {
        "frames": 9,
        "duration": { "from": 40, "to": 90, "ease": "in" },
        "seed": 3,
        "looks": {
          "steel": { "colors": ["b", "c", "p", "W"], "thresholds": [0.15, 0.4, 0.65, 0.88] },
          "flash": { "colors": ["o", "y", "W"], "thresholds": [0.2, 0.5, 0.8] }
        },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "slash",
            "look": "steel",
            "at": [38, 42],
            "frames": [0, 8],
            "radius": 32,
            "width": [15, 11],
            "arc": [195, 345],
            "squash": [1, 0.68],
            "tilt": -16,
            "reveal": 0.3
          },
          {
            "kind": "star",
            "look": "flash",
            "at": [64, 27],
            "frames": [1, 6],
            "radius": [18, 5],
            "width": [3, 1],
            "points": 8,
            "ratio": 0.5,
            "power": [1.3, 0.6],
            "cue": "hit"
          },
          {
            "kind": "ring",
            "look": "flash",
            "at": [64, 27],
            "frames": [2, 7],
            "radius": [4, 13],
            "width": [4, 1],
            "power": [1.1, 0.4]
          }
        ],
        "emitters": [
          {
            "at": [64, 27],
            "burst": 12,
            "start": 2,
            "angle": [150, 390],
            "speed": [1.5, 3.2],
            "gravity": [0, 0.25],
            "drag": 0.05,
            "life": [4, 7],
            "shapes": ["spark", "spark-y", "spark-o"],
            "trail": { "color": "o", "length": 1 }
          }
        ]
      }
    }
  },
  'fire-explosion': {
    "format": "pixelforge-fx",
    "version": 1,
    "name": "fire-explosion",
    "width": 96,
    "height": 96,
    "palette": {
      "W": "#fffbe6",
      "y": "#ffd34d",
      "o": "#ff8a2b",
      "r": "#d6402b",
      "R": "#8f2a2e",
      "s": "#b3a5ad",
      "S": "#867882",
      "k": "#5a4e5b"
    },
    "symbols": {
      "ember-big": [
        "yW",
        "oy"
      ],
      "ember": ["y"],
      "ember-dim": ["o"],
      "ember-end": ["r"]
    },
    "effects": {
      "fire-explosion": {
        "frames": 16,
        "duration": { "from": 45, "to": 100, "ease": "in" },
        "seed": 7,
        "looks": {
          "smoke": { "colors": ["k", "S"], "thresholds": [0.15, 0.5], "dither": 1 },
          "shock": { "colors": ["o", "y", "W"], "thresholds": [0.25, 0.5, 0.8] },
          "fire": { "colors": ["R", "r", "o", "y", "W"], "thresholds": [0.08, 0.22, 0.4, 0.6, 0.8] }
        },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "burst",
            "look": "smoke",
            "at": [44, 50],
            "frames": [4, 16],
            "drift": [-3, -16],
            "radius": [12, 20],
            "noise": 0.8,
            "scale": 6,
            "boil": 6,
            "power": [1, 0.6, 0],
            "ease": "linear",
            "seed": 21
          },
          {
            "kind": "burst",
            "look": "smoke",
            "at": [54, 52],
            "frames": [5, 16],
            "drift": [4, -18],
            "radius": [10, 17],
            "noise": 0.8,
            "scale": 6,
            "boil": 6,
            "power": [1, 0.55, 0],
            "ease": "linear",
            "seed": 22
          },
          {
            "kind": "ring",
            "look": "shock",
            "at": [48, 62],
            "frames": [1, 8],
            "radius": [10, 46],
            "width": [9, 4],
            "squash": [1, 0.42],
            "noise": 0.3,
            "power": [1.3, 0.5]
          },
          {
            "kind": "star",
            "look": "fire",
            "at": [48, 56],
            "frames": [0, 2],
            "radius": [26, 14],
            "points": 8,
            "width": [4, 3],
            "ratio": 0.5,
            "power": 1.2,
            "cue": "boom"
          },
          {
            "kind": "burst",
            "look": "fire",
            "at": [48, 56],
            "frames": [0, 12],
            "radius": [10, 24, 28],
            "hole": [0, 0, 0.25, 0.85],
            "noise": 0.5,
            "scale": 5,
            "power": [1.5, 1.1, 0.5]
          }
        ],
        "emitters": [
          {
            "at": [48, 56],
            "burst": 14,
            "start": 1,
            "angle": [190, 350],
            "speed": [1.8, 3.6],
            "gravity": [0, 0.3],
            "drag": 0.03,
            "life": [7, 12],
            "floor": 78,
            "bounce": 0.3,
            "shapes": ["ember-big", "ember", "ember-dim", "ember-end"],
            "trail": { "color": "r", "length": 1 }
          }
        ]
      }
    }
  },
  'lightning-strike': {
    "format": "pixelforge-fx",
    "version": 1,
    "name": "lightning-strike",
    "width": 80,
    "height": 96,
    "palette": { "g": "#2b2433", "v": "#3b2a8c", "b": "#4f7cff", "c": "#8fe9ff", "W": "#ffffff" },
    "symbols": { "spark": ["W"], "spark-c": ["c"], "spark-b": ["b"] },
    "effects": {
      "lightning-strike": {
        "frames": 12,
        "duration": { "from": 40, "to": 90, "ease": "in" },
        "seed": 5,
        "looks": {
          "scorch": { "colors": ["g"], "thresholds": [0.3] },
          "bolt": { "colors": ["v", "b", "c", "W"], "thresholds": [0.12, 0.3, 0.55, 0.85] }
        },
        "cleanup": { "corners": true },
        "layers": [
          {
            "kind": "ring",
            "look": "scorch",
            "at": [40, 85],
            "frames": [2, 12],
            "radius": 9,
            "width": 3,
            "fill": 1,
            "squash": [1, 0.35],
            "noise": 0.3,
            "power": [1, 1, 0.6]
          },
          {
            "kind": "bolt",
            "look": "bolt",
            "at": [44, 0],
            "to": [40, 82],
            "frames": [0, 7],
            "width": [3, 1],
            "glow": [2, 1],
            "jag": 0.4,
            "branches": 3,
            "reroll": 2,
            "reveal": 0.25,
            "flicker": 0.35
          },
          {
            "kind": "ring",
            "look": "bolt",
            "at": [40, 84],
            "frames": [1, 9],
            "radius": [3, 30],
            "width": [4, 1],
            "squash": [1, 0.35],
            "power": [1.2, 0.3]
          },
          {
            "kind": "star",
            "look": "bolt",
            "at": [40, 82],
            "frames": [1, 5],
            "radius": [20, 6],
            "points": 8,
            "width": [3, 1],
            "ratio": 0.45,
            "power": [1.3, 0.7],
            "cue": "strike"
          }
        ],
        "emitters": [
          {
            "at": [40, 82],
            "burst": 12,
            "start": 1,
            "angle": [200, 340],
            "speed": [1.4, 3],
            "gravity": [0, 0.3],
            "life": [6, 10],
            "floor": 86,
            "bounce": 0.4,
            "shapes": ["spark", "spark-c", "spark-b"]
          }
        ]
      }
    }
  },
  'healing-circle': {
    "format": "pixelforge-fx",
    "version": 1,
    "name": "healing-circle",
    "width": 96,
    "height": 72,
    "palette": {
      "d": "#14432f",
      "g": "#2a8a4f",
      "m": "#5fd37a",
      "l": "#b6f5a0",
      "W": "#f4ffe8",
      "y": "#ffe07a",
      "Y": "#fff6c4"
    },
    "symbols": {
      "sparkle-big": [
        ".Y.",
        "YWY",
        ".Y."
      ],
      "sparkle": ["Y"],
      "sparkle-dim": ["y"]
    },
    "effects": {
      "healing-circle": {
        "frames": 18,
        "duration": 70,
        "seed": 2,
        "looks": {
          "rune": { "colors": ["d", "g", "m", "l"], "thresholds": [0.1, 0.35, 0.6, 0.82], "dither": 0.8 },
          "light": { "colors": ["g", "m", "l", "W"], "thresholds": [0.1, 0.35, 0.6, 0.85], "dither": 0.8 }
        },
        "cleanup": { "corners": true },
        "layers": [
          {
            "kind": "glyph",
            "look": "rune",
            "at": [48, 52],
            "frames": [0, 18],
            "radius": 36,
            "inner": 0.64,
            "squash": [1, 0.42],
            "runes": 10,
            "double": true,
            "points": 4,
            "step": 1,
            "spin": [0, 24],
            "reveal": 0.35,
            "glow": 0,
            "power": [1, 1, 0.9, 0],
            "fill": [0, 0.06, 0.06, 0],
            "ease": "linear"
          },
          {
            "kind": "ring",
            "look": "rune",
            "at": [48, 52],
            "frames": [6, 12],
            "radius": [36, 44],
            "width": [5, 2],
            "squash": [1, 0.42],
            "noise": 0.5,
            "power": [0.9, 0.3]
          },
          {
            "kind": "beam",
            "look": "light",
            "at": [48, 52],
            "to": [48, 2],
            "frames": [5, 16],
            "width": [0, 18, 14, 0],
            "reveal": 0.25,
            "wobble": 0.06,
            "wavelength": 10,
            "waves": -4,
            "fade": 0.85,
            "power": [0.65, 0.65, 0.35],
            "ease": "linear",
            "squash": [1, 0.42]
          }
        ],
        "emitters": [
          {
            "at": [48, 48],
            "area": [56, 7],
            "rate": 0.6,
            "start": 4,
            "end": 16,
            "angle": [265, 275],
            "speed": [0.8, 1.4],
            "life": [6, 10],
            "shapes": ["sparkle-big", "sparkle", "sparkle-dim"],
            "behind": true
          },
          {
            "at": [48, 56],
            "area": [56, 7],
            "rate": 0.6,
            "start": 4,
            "end": 16,
            "angle": [265, 275],
            "speed": [0.8, 1.4],
            "life": [6, 10],
            "shapes": ["sparkle-big", "sparkle", "sparkle-dim"]
          }
        ]
      }
    }
  },
  'water': {
    "format": "pixelforge-fx",
    "version": 1,
    "name": "water",
    "width": 64,
    "height": 64,
    "palette": { "o": "#123c40", "d": "#2a7f86", "m": "#4fb3b5", "b": "#9fe3e0", "h": "#e8fffb" },
    "effects": {
      "geyser": {
        "frames": 16,
        "duration": 83,
        "seed": 6,
        "looks": {
          "water": {
            "colors": ["m", "b"],
            "thresholds": [0.2, 0.55],
            "light": [-1, -1],
            "lit": { "colors": ["h"], "thresholds": [0.45] },
            "shade": { "colors": ["d"], "thresholds": [0.4] },
            "outline": "o"
          }
        },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "stream",
            "at": [32, 58],
            "through": [[32, 34], [33, 10]],
            "frames": [0, 12],
            "width": [6, 11, 9, 5],
            "taper": [1, 0.8, 0.55, 0],
            "head": [0.25, 1, 1, 0.35],
            "tail": 0,
            "sway": 1.5,
            "wavelength": 18,
            "waves": 2,
            "noise": 0.7,
            "scale": 5,
            "power": [1.3, 1.3, 1.1, 0.4],
            "ease": "linear"
          },
          {
            "kind": "ring",
            "at": [32, 58],
            "frames": [1, 15],
            "radius": [5, 22],
            "width": [4, 2],
            "squash": [1, 0.28],
            "noise": 0.7,
            "power": [1.3, 0.25]
          }
        ],
        "emitters": [
          {
            "name": "crown",
            "at": [33, 12],
            "area": [6, 3],
            "burst": 10,
            "start": 6,
            "angle": [200, 340],
            "speed": [0.9, 2],
            "gravity": [0, 0.24],
            "floor": 58,
            "life": [9, 11],
            "blob": { "radius": [2.6, 2.2, 1.4] }
          },
          {
            "name": "spray",
            "at": [32, 40],
            "line": { "to": [33, 16] },
            "burst": 6,
            "start": 8,
            "angle": [180, 360],
            "speed": [0.3, 0.9],
            "gravity": [0, 0.2],
            "floor": 58,
            "life": [6, 9],
            "blob": { "radius": [1.9, 1.2] }
          }
        ]
      },
      "whip": {
        "frames": 14,
        "duration": 83,
        "seed": 4,
        "looks": {
          "water": {
            "colors": ["m", "b"],
            "thresholds": [0.2, 0.55],
            "light": [-1, -1],
            "lit": { "colors": ["h"], "thresholds": [0.45] },
            "shade": { "colors": ["d"], "thresholds": [0.4] },
            "outline": "o"
          }
        },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "stream",
            "at": [6, 46],
            "through": [[20, 30], [36, 36], [50, 22], [58, 10]],
            "frames": [0, 12],
            "width": [7, 9, 6],
            "taper": [0, 1, 0.6, 0],
            "head": [0.15, 1, 1],
            "tail": [0, 0.15, 1],
            "sway": 2.5,
            "wavelength": 20,
            "waves": 1.5,
            "noise": 0.6,
            "scale": 5,
            "power": [1.3, 1.2, 0.5],
            "ease": "linear"
          }
        ],
        "emitters": [
          {
            "name": "shed",
            "at": [14, 36],
            "line": { "to": [54, 16] },
            "burst": 10,
            "start": 6,
            "angle": [200, 340],
            "speed": [0.3, 1.1],
            "gravity": [0, 0.18],
            "life": [6, 8],
            "blob": { "radius": [2.2, 1.2] }
          }
        ]
      },
      "ring": {
        "frames": 14,
        "duration": 83,
        "seed": 2,
        "looks": {
          "water": {
            "colors": ["m", "b"],
            "thresholds": [0.2, 0.55],
            "light": [-1, -1],
            "lit": { "colors": ["h"], "thresholds": [0.45] },
            "shade": { "colors": ["d"], "thresholds": [0.4] },
            "outline": "o"
          }
        },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "ring",
            "at": [32, 32],
            "frames": [0, 11],
            "radius": [5, 17, 21],
            "width": [7, 6, 4],
            "noise": 1,
            "scale": 5,
            "power": [1.5, 1.2, 0.22]
          }
        ],
        "emitters": [
          {
            "name": "spray",
            "at": [32, 32],
            "ring": { "radius": 20, "outward": true },
            "burst": 12,
            "start": 7,
            "angle": [-20, 20],
            "speed": [0.4, 1],
            "gravity": [0, 0.1],
            "drag": 0.05,
            "life": [6, 7],
            "blob": { "radius": [2.4, 1.4] }
          }
        ]
      },
      "dome": {
        "frames": 16,
        "duration": 83,
        "seed": 8,
        "looks": {
          "water": {
            "colors": ["m", "b"],
            "thresholds": [0.2, 0.55],
            "light": [-1, -1],
            "lit": { "colors": ["h"], "thresholds": [0.45] },
            "shade": { "colors": ["d"], "thresholds": [0.4] },
            "outline": "o"
          },
          "shine": { "colors": ["h"], "thresholds": [0.4] }
        },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "burst",
            "look": "water",
            "at": [32, 56],
            "frames": [0, 8],
            "radius": [3, 14, 16],
            "noise": 0.08,
            "scale": 6,
            "boil": 0,
            "floor": 56,
            "power": [1.5, 1.4, 1.3]
          },
          {
            "kind": "burst",
            "look": "shine",
            "at": [28, 50],
            "frames": [2, 8],
            "radius": [2, 3.4],
            "noise": 0,
            "boil": 0,
            "drift": [0, -1]
          },
          {
            "kind": "ring",
            "at": [32, 56],
            "frames": [8, 16],
            "radius": [14, 28],
            "width": [4, 2],
            "squash": [1, 0.25],
            "noise": 0.7,
            "power": [1.3, 0.25],
            "look": "water"
          }
        ],
        "emitters": [
          {
            "name": "pop",
            "at": [32, 56],
            "ring": { "radius": 15, "arc": [190, 350], "even": true, "outward": true },
            "burst": 11,
            "start": 8,
            "angle": [-10, 10],
            "speed": [1.2, 2],
            "gravity": [0, 0.22],
            "floor": 57,
            "life": [7, 9],
            "blob": { "radius": [2.6, 1.6], "look": "water" }
          }
        ]
      },
      "curl": {
        "frames": 14,
        "duration": 83,
        "seed": 3,
        "looks": {
          "water": {
            "colors": ["m", "b"],
            "thresholds": [0.2, 0.55],
            "light": [-1, -1],
            "lit": { "colors": ["h"], "thresholds": [0.45] },
            "shade": { "colors": ["d"], "thresholds": [0.4] },
            "outline": "o"
          }
        },
        "cleanup": { "corners": true, "strays": true },
        "layers": [
          {
            "kind": "stream",
            "at": [8, 54],
            "through": [[34, 52], [50, 38], [44, 20], [30, 22], [32, 32]],
            "frames": [0, 12],
            "width": [8, 12, 9],
            "taper": [0.5, 1, 0.7, 0],
            "head": [0.2, 1, 1],
            "tail": [0, 0.1, 0.85],
            "noise": 0.6,
            "scale": 5,
            "power": [1.3, 1.2, 0.45],
            "ease": "linear"
          }
        ],
        "emitters": [
          {
            "name": "crest",
            "at": [42, 18],
            "area": [10, 4],
            "burst": 8,
            "start": 6,
            "angle": [200, 290],
            "speed": [0.5, 1.4],
            "gravity": [0, 0.18],
            "life": [6, 8],
            "blob": { "radius": [2.2, 1.3] }
          }
        ]
      }
    }
  }
};
