// Reviewed spell-shape effects (pixelforge-fx shape layers with a few particle emitters), written to
// examples/<name>.fx.json by scripts/generate-examples.js. Their compiled pixels are pinned in test/shapes.test.js.
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
  }
};
