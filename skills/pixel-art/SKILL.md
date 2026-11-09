---
name: pixelbolt-pixel-art
description: Make, fix and export pixel art with Pixelbolt JSON recipes - sprites, sprite sheets, tiles, icons, short animations and effects such as fire, smoke, water or sparks - saved as PNG, GIF, APNG, atlases or video frames. Use when someone asks to draw, animate, repair or export pixel art or game sprites. Not for vector or SVG graphics, photos or pictures from an image model. Local, no account, no API key.
---

# Pixelbolt pixel art

Use this when creating pixel sprites, tiles, icons, effects or short sprite animations. Pixelbolt lives at the project root two directories above this skill's directory. Run its CLI with Node.js (20 or newer), or use its MCP tools if configured.

In a copy of this file alone, as `npx skills add skulitom/Pixelbolt` installs it, there is no checkout, so run every command below as `npx -y pixelbolt@latest <command>` in place of `node bin/pixelbolt.js <command>`, for example `npx -y pixelbolt@latest validate <recipe>`. Read the files it names from GitHub: the quick start is https://raw.githubusercontent.com/skulitom/Pixelbolt/main/docs/agent-quick-start.md, and any other `docs/`, schema or `examples/` path works the same way after `https://raw.githubusercontent.com/skulitom/Pixelbolt/main/`. That copy comes from Pixelbolt's main branch, which can be a few days ahead of the npm release, so if `npx -y pixelbolt@latest help` or `npx -y pixelbolt@latest schema` does not know a command, option or field, leave it out rather than guess. Skip this paragraph where `bin/pixelbolt.js` is two directories above this file, as in a checkout, the npm package, the Claude Code plugin and Pixelbolt Studio, which carry Pixelbolt with them.

In the Claude Code plugin, the MCP tools (`pixel_help`, `pixel_validate`, `pixel_inspect`, `pixel_patch`, `pixel_render` and the rest) come with this skill. If they are missing, the plugin's server did not start: it needs Node.js 20 or later on PATH (`node --version`). Install Node.js from https://nodejs.org, then restart Claude Code.

In the portable Pixelbolt Studio build, run `.\pixelbolt` on Windows or `./pixelbolt` elsewhere from the build folder instead of `node bin/pixelbolt.js`.

## Decide first

- **Use Pixelbolt** for pixel art: exact palette colours, sprites and sheets for games or the web, tiles, icons, short loops, and effects (fire, smoke, water, sparks, explosions) that stay editable as text.
- **Don't use it** for vector or SVG logos, photographs, painted images, pictures from an image model, or anything that must be larger than the limits below. Say so and suggest a tool for that work.
- **Existing asset?** Edit its recipe with patches. Rebuild from scratch only when the user asks.

## Rules

- The recipe is the source. Keep the JSON file. Don't paint PNGs with another library and don't hand-edit exported files.
- Change one pixel with a patch, not by rewriting the recipe. A patch preview lists the frames it changes and, for small edits, each pixel; read that list.
- Save edits to a new recipe (`--out`) rather than over the old one, and render each attempt into a new folder. Use `--force` only to replace output you made, and only when the user wants it replaced.
- Validation and the render `check` show that a file matches the format and what was asked, not that the art works. Look at the inspect image at native size and enlarged, and at the animation in playback, before you say it is done.
- Stay in the palette: no gradients, anti-aliasing or subpixel positions. Export at scale 1 for game assets unless the user asks for enlarged pixels baked into the files.
- If the request leaves size or use open, pick a sensible default (for example 16 to 64 px for a game sprite, 4 to 16 colours), state it in one line, and build. Ask only when the answer changes the build.
- Words on screen (titles, captions, counters) use the `text` operation, not hand-drawn letters.
- Errors name their path, such as `project.frames[1].ops[0].rows[2]`, and come back together. Fix them all, then validate again. Don't guess field names; check `help guide` or `schema`.
- GIF keeps exact colours but drops partial transparency and rounds timing to 10 ms. Report the `notes` it returns.
- If asked to match a named game's quality, make original art and report what the visible evidence supports.

## Workflow

1. **Brief.** Note the size, display scale, three silhouette landmarks, palette roles, light direction, outline treatment, the projection (side, 3/4 top-down, isometric 2:1 or top-down, one for the whole set) and the action. Keep the brief beside the recipe, not inside it.
2. **Start.** Begin from an `examples/` file when one is close (see the table below), or create an editable example with `node bin/pixelbolt.js init <recipe.json>`. A pose, effect or other source is not a recipe: compile it first.
3. **Validate.** `node bin/pixelbolt.js validate <recipe>`
4. **Inspect.** `node bin/pixelbolt.js inspect <recipe> --out <frames.png> --native --diagnostics`. Then check `--view silhouette` and `--view grayscale`, use `--animation <name> --view onion` for the poses either side of each frame, and read exact pixels with `--grid --region x,y,w,h` before you change them. Diagnostics are advice: intentional eyes, sparks and holds are fine. Record what reads and what fails, so the next change is deliberate.
5. **Patch.** Put the edits in a file and preview them: `node bin/pixelbolt.js patch <recipe> --changes <changes.json> [--out <new recipe>]`. To set one pixel, the file holds `[{"paint": "frames[blink]", "value": [{"x": 9, "y": 7, "color": "k"}]}]`; `"transparent"` erases. On paint, grid, move, recolor or cleanup changes, add `"scope": "frame"` when other frames must keep their pixels.
6. **Render.** `node bin/pixelbolt.js render <recipe> --out <directory> --expect '{"width":24,"height":24,"frames":6}'`. Put in `--expect` what the user asked for. Read the `check`, fix every mismatch it lists, and render again. For frame counts per animation, use `{"idle": 4, "walk": 8}`.
7. **Other formats, when asked.**
   - To post or embed: `node bin/pixelbolt.js gif <recipe> --out <new.gif>`. Options include `--animation <name>`, `--scale <1-16>` (use it only to enlarge for posting) and `--background "#17191d"`, which blends transparent pixels onto a colour.
   - For a video editor: `node bin/pixelbolt.js validate <recipe> --fps 30` checks the timing, then `node bin/pixelbolt.js sequence <recipe> --out <new folder> --fps 30 --size 1080p` writes numbered PNG frames. Pass on the ffmpeg command it prints; Pixelbolt does not encode video.
   - From a folder of numbered PNG frames: `node bin/pixelbolt.js gif-frames <folder> --fps 25 --out <new.gif>`.
8. **Deliver.** Give the user the paths to the source recipe, the sprite sheet, the atlas JSON, the preview and any GIF, plus a short note on how to use them: Godot 4 (the `.tres` beside the sheet is an `AnimatedSprite2D`'s SpriteFrames, and an autotile set's `.tileset.tres` is a `TileMapLayer`'s TileSet with a terrain to paint), Tiled (the `.tsx` has a terrain set for the Terrain Brush), Phaser (atlas JSON), CSS, or the bundled `player.js`. Mention any `notes` and limits that apply.

## Where to start

| Request | Start from |
|---|---|
| A ready-made effect (campfire, torch, smoke, steam, explosion, splash, waterfall, potion, honey, slime, dripping) | A preset. `presets` lists them, `presets <name>` prints one's source, and `compile --preset <name> --out <recipe.json>` compiles one as shipped (run these as `node bin/pixelbolt.js`; MCP: `pixel_help` topic `presets`, then `pixel_compile` with `preset`). For a bigger file, enlarge the GIF (`--scale`, MCP `gif.scale`); a different canvas size also means moving the effect's obstacles and emitters, which use absolute coordinates. Deliver that first, then offer to tune it. Don't build a new recipe around it. |
| A character in motion (idle, walk, run, jump, attack, hurt) | `examples/hero.poses.json`, or `examples/hero-sword.poses.json` with a sword. Compile with `node bin/pixelbolt.js compile <source.poses.json> --out <recipe.json> --metadata <new.json>` so review tools keep the pose data. |
| A four-legged animal | `examples/fox.poses.json` |
| A squashing blob | `examples/slime-idle.poses.json` |
| A spell (projectile, impact, area, buff) | `examples/<element>-spells.fx.json` for fire, ice, lightning, water, poison, holy or shadow. Change only what was asked. |
| Particle effects (sparks, dust, leaves) | `examples/effects.fx.json` |
| Terrain tiles | `examples/meadow.autotile.json`, `examples/ground.autotile.json`, or `examples/shore.autotile.json` for transitions. Compile with `node bin/pixelbolt.js autotile <template.json> --out <recipe.json>`. |
| A small icon or hand-drawn sprite | `examples/coin.json`, `examples/shrine.json`, `examples/forest-spirit.json` |
| Looping interference or a portal | `examples/interference.wave.json`, `examples/portal.wave.json` |
| Crystals that grow | `examples/quartz-cluster.crystal.json`, `examples/geode.crystal.json`, `examples/pyrite.crystal.json`, `examples/snowflakes.crystal.json` |
| Falling sand (fire, lava, blasts, rain) | `examples/hut-fire.powder.json`, `examples/lava-falls.powder.json`, `examples/quarry-blast.powder.json`, `examples/rain-on-fire.powder.json`, or `examples/stilt-hut.powder.json` for pieces that topple (`pieces: "tumble"`). `base: "sandbox"` gives the starter materials (`help workflow "Falling sand"`). |
| A lit scene | `examples/forest-spirit-lit.scene.json`, with normals from `examples/forest-spirit.normals.json` |
| A caption | `examples/caption.json` |
| An existing PNG to edit | `node bin/pixelbolt.js import <image.png> --out <recipe.json>` (any PNG colour type up to 8 bits per channel, indexed and greyscale included; not 16-bit, interlaced or animated) |

## Characters

- For figures in motion, use a `pixelforge-poses` source: bones for limbs, masses for bodies, grid parts for heads, hands and props. Start from `examples/hero.poses.json`. A part without `attach` stands at the pose `origin` plus its `at`, an offset rather than a canvas position.
- Assign rig roles and use the idle, walk, run, jump, attack and hurt templates as starting points. Set speed, stride, lift and frame timing for the body, and fix compile warnings (a pose off the canvas, a foot out of reach) before adding detail.
- A prop held in a hand needs a relative `angle`, such as `-45`, so it turns with the arm. `rotate` is absolute: with it, or with neither, the blade keeps one angle through the attack. `examples/hero-sword.poses.json` is the hero holding a sword.
- In a side view, draw far limbs a ramp step darker (not the darkest step, which merges with the outline) and give paired legs the same rest angles. Near limbs stay in front for the whole cycle.
- For a four-legged animal, start from `examples/fox.poses.json`: `rig.fore` and `rig.hind` take the place of `legs`, and the templates `walk`, `trot` and `run` set the gait.
- Start any turned part (boots, hands, held weapons, a tilted head) from a draft, never from nothing: `node bin/pixelbolt.js compile <source.poses.json> --draft-views boot:15,345 --preview <drafts.png>` (MCP `pixel_compile` with `draftViews`) prints the turned rows to correct by eye and paste into `parts.<name>.views`.
- Review the silhouette, the difference between key poses, planted contacts, the loop join and the gait with `node bin/pixelbolt.js inspect <source> --motion run --speed 48`, and `--view parts` to name the part behind a stray pixel. Don't infer contact quality from a still sheet. More in `help workflow "Authored poses, attachments and cues"`.

## Craft

- Work in this order: silhouette, then large connected colour shapes, then material accents, then key poses, then timing, then the scene. Don't make variants until the resting silhouette and one action read well.
- Noise and extra glow can't fix weak structure. Redraw the part.
- Shade along palette ramps (`ramps` with the `shade` operation) so light stays in the palette. Use dither for transitions and bands, not whole surfaces.
- Share a palette with `"palette": { "$ref": "palette.json" }`, cycle water or lights with frame or layer `palette` overrides, and use `remap` for colour variants and hit flashes.
- Water, fire and crystal need different behaviour, not the same shape recoloured.
- Judge motion in playback. A still sheet can't show weight.

## Effects, tiles and scenes

Each `help workflow "<section>"` below runs as `node bin/pixelbolt.js help workflow "<section>"` (MCP: `pixel_help` with `topic: "workflow"` and `name`).

- **Fluids** (`examples/*.fluid.json`): tune `viscosity` and `yield`; the `look` decides the colours. Check one-shots at 1× and that they end empty, and keep the loop boundary quiet (`help workflow "Fluid effects"`).
- **Particle effects** (`pixelforge-fx`): fix every edge warning the compile gives unless the effect lists that side in `edges`. Make gas and mist see-through, not outlined. For an effect round a character, give what belongs behind it a `depth`, so the game draws `<effect>-back`, the character, then `<effect>-front` (`help workflow "Particle effects"`).
- **Waves and crystals:** keep a portal's rims in an overlay and use particle rings for one-shot impacts; draw a crystal's rock as the source's underlay and its front lip as the overlay (`help workflow "Crystal growth"`).
- **Tiles:** review `--view tile` (a 3×3 repeat) and set `wrap` on frames whose drawing crosses the edges. An autotile `terrain` compiles into 47 blob, 16 cardinal or 16 corner (dual-grid) tiles; check its test map and seam warnings. A side-view set takes `slopes`, and tilemap legends take `rules`, `weights` and variants (`help workflow "Autotile templates"`).
- **Scenes:** put things that stand on the ground in one layer or group with `sort: "ground"`, and give scene placements `anchor: "frame"`. Use `lift` for jumps, `shadow: true` with a light or a `sun`, `haze` for far planes, `box` and `layout: "iso"` for isometric art, and a `camera` with `parallax` to pan. Inspect a 2–4× `region` where different things meet, and check who covers whom with `pixel_scene` `view: "depth"` and `guides` (`help workflow "Depth and perspective"`, `help workflow "Scene and tile review"`).
- **Lit scenes:** derive normal passes with a `pixelforge-normals` source rather than painting them, light the result from both sides, and tell the user Godot and Unity read +Y up (`help workflow "Aligned material passes"`).

## Tools

| Task | CLI | MCP tool |
|---|---|---|
| Learn the format | `help quickstart`, `help guide`, `schema` | `pixel_help` (topics such as `guide`, `workflow`, `schema`, `example`, `presets`) |
| Check a recipe | `validate` | `pixel_validate` |
| See the frames | `inspect` | `pixel_inspect` |
| Edit | `patch` | `pixel_patch` |
| Export | `render`, `gif`, `sequence` | `pixel_render`, with the `gif` or `sequence` option |
| Compile a source or preset | `compile` | `pixel_compile` |
| Scenes | `scene` | `pixel_scene` |
| Import a PNG | `import` | `pixel_import` |

With MCP, send the recipe once as `project`. Each reply includes a `revision` id; send `revision` in later calls instead of the full recipe. Revisions are saved in the output directory the server was started with (`--out`), so keep using the same absolute path. When the user named files, add `saveAs` to `pixel_render`, such as `{ "sheet": "assets/hero.png", "gif": "assets/hero.gif" }`. Pass `listFiles: true` to see every exported file. Requests are capped at 16 MiB: send a large recipe once and reuse its revision.

## Where the details are

Read only the part you need. Run `help` as `node bin/pixelbolt.js help <topic> [section]`, or over MCP as `pixel_help` with `topic` and `name`.

- `help quickstart` (MCP `pixel_help`): the recipe format, the operations and the working loop. Read it first.
- `help guide`: every field, operation, inspection option and export. Print one section with `help guide "<heading>"`.
- `help workflow`: techniques for characters, scenes, tiles, effects and lighting. It is long, so list its sections, then print one, for example `help workflow "Particle effects"`.
- Files: `docs/agent-quick-start.md`, `docs/agent-guide.md`, `docs/art-workflow.md`, `docs/game-integration.md`, `docs/wave-effects.md`, and `schema.json` with the per-format schemas beside it (`poses.schema.json`, `scene.schema.json`, `fx.schema.json`, and the others).

To let the user play an animation, run `node bin/pixelbolt.js preview <recipe> --open`. It starts a local studio on this machine only.

## Limits

- Imports: PNG of any colour type up to 8 bits per channel (RGB, RGBA, greyscale, indexed); 16-bit, interlaced and animated PNGs are refused. GIF import, Aseprite files and automatic colour reduction are not supported.
- Animation frames are at most 256 × 256 pixels, a project has at most 256 frames, and its frames together hold at most 4,194,304 pixels. A backdrop or mural rendered on its own, outside a scene, may be a single-frame still up to 4096 pixels a side; draw it at one pixel per screen pixel, with no enlarged stamps or text. Scene assets are at most 256 pixels a side, so tile a panning backdrop with `repeat` or a `tilemap`.
- Pixelbolt does not encode video. `sequence` writes the PNG frames and the command.
- Advisory diagnostics and review notes are prompts to look, not commands to delete pixels. Keep the original assets and any failed comparisons.
