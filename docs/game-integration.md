# Using Pixelbolt assets in games

The bundle deliberately keeps the interchange format simple: RGBA PNGs plus JSON frame rectangles, and a Godot 4 SpriteFrames made from them. By default every frame retains the full canvas and common origin; opt into trimmed packing with `sheet.trim` (below). Frames are never rotated. Use nearest-neighbor filtering and whole-pixel placement for crisp rendering (the bundled `drawFrame` snaps fractional positions to whole pixels for you).

## Phaser

Load the exported sheet with Phaser's [atlas loader and texture manager](https://docs.phaser.io/phaser/concepts/textures):

```js
preload() {
  this.load.atlas('spirit', 'assets/forest-spirit.png', 'assets/forest-spirit.atlas.json');
}
create() {
  this.add.sprite(200, 200, 'spirit', 'rest').setScale(4);
}
```

Set `pixelArt: true` in the game configuration. The atlas's extra `animations` object is Pixelbolt metadata; import it explicitly when building your engine's animation definitions. Each entry contains an expanded list of frame names, the total duration, and a loop flag. Per-frame durations live in `frames[name].duration` in milliseconds. Do not assume a constant frame rate when a recipe uses unequal durations.

## Godot 4

Every export includes `name.tres`, a Godot 4 `SpriteFrames` resource for `AnimatedSprite2D` and `AnimatedSprite3D`. Copy `name.png` and `name.tres` into one folder of your project, give an `AnimatedSprite2D` the `.tres` as its **Sprite Frames**, and play an animation by its recipe name:

```gdscript
$Spirit.sprite_frames = preload("res://sprites/forest-spirit.tres")
$Spirit.play("idle")
```

Set **Project Settings → Rendering → Textures → Canvas Textures → Default Texture Filter** (or the node's **Texture → Filter**) to Nearest, or Godot smooths the pixels.

- **Where the sheet is.** The `.tres` names the sheet by a path relative to itself (`path="forest-spirit.png"`), and Godot reads it from the `.tres`'s own folder, so the pair works anywhere in the project as long as the two stay together. Godot writes the path as `res://…` the next time it saves the resource. Move them in Godot's FileSystem dock, which updates the path; to point a `.tres` at a sheet elsewhere, change the `path` in its `[ext_resource]` line to the sheet's `res://` path or its path relative to the `.tres`. Godot only loads textures from inside the project. MCP `pixel_render` writes both into a project with `"saveAs": { "sheet": "game/sprites/spirit.png", "godot": "game/sprites/spirit.tres" }`, naming the saved sheet in the saved `.tres`, and refuses a `.tres` inside a Godot project (a folder with `project.godot`) whose sheet would be outside it.
- **Frames.** Each frame is an `AtlasTexture` with the frame's atlas rectangle as its `region` and `filter_clip` on. With `sheet.trim`, its `margin` puts the visible pixels back where they were on the canvas, so every frame is the full canvas size and trimmed frames line up exactly as untrimmed ones do.
- **Timing.** Each recipe animation becomes one animation, in recipe order, with its frames in playback order (reverse and ping-pong expanded) and its `loop`. Godot gives an animation one speed (FPS) and each frame a relative duration, and shows a frame for duration ÷ speed seconds. The speed is 1000 ÷ the largest step that divides every frame's milliseconds, so durations are whole numbers: frames of 100, 100 and 200 ms play at 10 FPS for 1, 1 and 2; the forest spirit's 240, 140 and 220 ms at 50 FPS for 12, 7 and 11. When that step is under 9 ms (Godot's SpriteFrames editor shows at most 120 FPS), the shortest frame sets the speed, at most 120 FPS, and the others last a fraction of it; Godot keeps durations as 32-bit floats, so those frames play within a ten-millionth of their length, and the export's warnings name the animations. Frame times in multiples of 10 ms are always exact.
- **Godot's playback.** Godot 4.6 runs the rest of a process step after a frame change at the previous frame's speed ([godotengine/godot#123572](https://github.com/godotengine/godot/issues/123572)). A frame right after a shorter one ends early, by up to (its length ÷ the shorter one's − 1) display frames, and one after a longer one ends late by less than a display frame: at 60 FPS, a 100 ms frame right after a 5 ms flash can be skipped entirely. The `.tres` holds the exact times; give such flashes at least a display frame (17 ms) until Godot fixes it.

`node scripts/verify-godot.mjs` (with Godot 4 on `PATH`, in `GODOT` or passed as `--godot <path>`) imports the forest spirit and a trimmed, scaled sheet with unequal durations into a headless Godot project, and checks every frame's region, margin, size, pixels and time, and each animation's playback step by step.

## Unity and other grid importers

Keep the default untrimmed layout and set `sheet.padding` to `0`. Cell dimensions are `project.width × sheet.scale` and `project.height × sheet.scale`. Set your importer to multiple sprites or a frame grid and use `sheet.columns` horizontal cells. A partially filled last row contains transparent unused cells; use only the number of frames in the JSON.

Alternatively, import the PNGs in `frames/`, which removes any need for atlas slicing. Transfer the duration in milliseconds for each frame into the engine's frame-delay or keyframe controls. The source canvas is not trimmed, so the same pivot/origin keeps frames aligned.

## Normal and emissive passes

`pixelbolt scene <scene.json> --out <dir>` exports each lit asset's `color.png`, `normal.png` and `emissive.png` on one shared atlas grid, with `alignment.json` naming the files, and a Godot `sprite_frames.tres` that plays the colour pass. A normal recipe on its own renders with `pixelbolt render` like any recipe; a generated pass (`pixelforge-normals`) has exactly the colour recipe's frame rectangles, trimmed or not, so one atlas JSON slices both.

Normal RGB encodes XYZ from −1 to +1 as `(v + 1) × 127.5`, with +X right, +Y down and +Z toward the viewer. That is the "Y−" or DirectX convention, which Unreal also uses. Godot and Unity expect +Y up, so flip the green channel when importing, or lights above a sprite shade it as if they were below:

- **Godot 4**: select the normal PNG, enable **Normal Map Invert Y** in the Import dock, set the compression mode to Lossless and reimport. Use it as the `normal_texture` of a `CanvasTexture` whose `diffuse_texture` is the colour atlas, and light it with `PointLight2D` nodes.
- **Unity**: set the texture type to **Normal map**, enable **Flip Green Channel** (`TextureImporter.flipGreenChannel` in scripts), turn compression off and use point filtering. Add it to the colour sprite as the `_NormalMap` secondary texture for the 2D renderer's lights.

Keep normal and emissive textures uncompressed with nearest filtering: compression and smoothing blend neighbouring directions and colours, and pixel-art lighting depends on each pixel keeping its own.

## Canvas

The exported `player.js` provides a complete player, without an engine or runtime package dependency:

```js
import { SpritePlayer } from './player.js';
const player = await SpritePlayer.load(canvas, './forest-spirit.atlas.json', { scale: 4 });
player.play('idle');
player.pause();
player.resume();
player.play('blink'); // A once-only sequence holds its last frame.
// Release the animation loop when the component is removed:
player.destroy();
```

Use an HTTP server for module imports/fetch. The separate `preview.html` and APNGs work directly from disk. APNGs follow the [PNG specification](https://www.w3.org/TR/png-3/) and use full-frame source replacement, preserving transparency without motion trails.

## Atlas contract

The forest spirit's atlas, with the first of its six frames:

```json
{
  "frames": {
    "rest": {
      "frame": { "x": 1, "y": 1, "w": 24, "h": 24 },
      "rotated": false,
      "trimmed": false,
      "spriteSourceSize": { "x": 0, "y": 0, "w": 24, "h": 24 },
      "sourceSize": { "w": 24, "h": 24 },
      "duration": 240
    }
  },
  "animations": {
    "idle": { "frames": ["rest", "rise", "float", "blink", "float", "fall", "settle"], "loop": true, "duration": 1220 },
    "bob": { "frames": ["rest", "rise", "float", "rise"], "loop": true, "duration": 740 },
    "blink": { "frames": ["rest", "blink", "rest"], "loop": false, "duration": 580 }
  },
  "meta": {
    "image": "forest-spirit.png", "size": { "w": 156, "h": 26 }, "scale": "1",
    "frameTags": [{ "name": "bob", "from": 0, "to": 2, "direction": "pingpong" }]
  }
}
```

`frame` gives the exact source rectangle in the PNG, including export scale but excluding surrounding transparent padding. `meta.scale` records the scale already applied; do not multiply coordinates by it.

`meta.frameTags` lists Aseprite-style tags for tools that read Aseprite's JSON: `from` and `to` index the atlas's frames in order, and `direction` is `forward`, `reverse` or `pingpong` (forward and back without repeating either end). A tag can only name one run of frames, so an animation that holds, skips or reorders frames, such as the forest spirit's `idle`, has none; `animations` lists every animation in full, with its loop flag.

With `sheet.trim: true`, each `frame` rectangle holds only the visible pixels: `trimmed` is true, `spriteSourceSize` gives the rectangle's offset inside the unchanged `sourceSize`, and the frames/ PNGs stay full-canvas. Recipes with an `anchor` (compiled poses always have one) add `anchor` in exported pixels and `pivot` = anchor ÷ source size, which Phaser's JSON-hash loader reads as a custom pivot. Frames with named `points` (pose markers such as a blade tip or foot contact, or glyph advances) list them in exported pixels. The bundled `player.js` exports `loadSpriteSheet`, `frameAt` and `drawFrame`, which honor all of these. The TexturePacker-style frame layout is intended for existing atlas importers, but engine-specific integration should be checked in your target engine; this repository tests the bundled Canvas runtime and binary exports.
