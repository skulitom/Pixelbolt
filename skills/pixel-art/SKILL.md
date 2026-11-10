---
name: pixelbolt-pixel-art
description: Make, fix and export pixel art with Pixelbolt JSON recipes - sprites, sprite sheets, tiles, icons, short animations and effects such as fire, smoke, water or sparks - saved as PNG, GIF, APNG, atlases or video frames. Use when someone asks to draw, animate, repair or export pixel art or game sprites. Not for vector or SVG graphics, photos or pictures from an image model. Local, no account, no API key.
---

# Pixelbolt pixel art

Use this when creating pixel sprites, tiles, icons, effects or short sprite animations. Pixelbolt lives at the project root two directories above this skill's directory. Run its CLI with Node.js (20 or newer) as `node bin/pixelbolt.js <command>`, or use its MCP tools if configured. It is not for vector or SVG logos, photographs, painted images or pictures from an image model: say so and suggest a tool for that work.

In a copy of this file alone, as `npx skills add skulitom/Pixelbolt` installs it, there is no checkout, so run every command below as `npx -y pixelbolt@latest <command>` in place of `node bin/pixelbolt.js <command>`, and read any `docs/`, schema or `examples/` path named here after https://raw.githubusercontent.com/skulitom/Pixelbolt/main/. That copy comes from Pixelbolt's main branch, which can be a few days ahead of the npm release, so if `npx -y pixelbolt@latest help` does not know a command, option or topic, leave it out rather than guess. Skip this paragraph where `bin/pixelbolt.js` is two directories above this file, as in a checkout, the npm package, the Claude Code plugin and Pixelbolt Studio.

In the Claude Code plugin, the MCP tools come with this skill. If they are missing, the plugin's server did not start: it needs Node.js 20 or later on PATH, then a restart of Claude Code.

In the portable Pixelbolt Studio build, run `.\pixelbolt` on Windows or `./pixelbolt` elsewhere from the build folder instead of `node bin/pixelbolt.js`.

## Where to start

Begin from the closest row. A preset or example compiled as it ships needs nothing more read than this file.

| Request | Start from |
|---|---|
| A ready-made effect (fire, torch, smoke, steam, explosion, splash, waterfall, potion, slime, spell, portal, crystal, falling sand) | A preset: `presets --find <word>` lists the ones a word matches, a line each, and `compile --preset <name> --out <recipe.json>` compiles one as shipped, with `--size 32x32` on the canvas asked for (cut or padded, never scaled) and `--frames 8` down to 8 evenly spaced frames (`presets <name>` prints its source to edit). When the request is just a GIF of one, `gif --preset <name> --out <new.gif> --sheet <frames.png>` (with `--size`, `--frames`, `--scale`) is the whole job in one call: look at the sheet, then deliver. That sheet is an enlarged contact sheet for looking at; a game's sprite sheet and atlas come from `render`. MCP: `pixel_help` with `topic: "presets"` and `find`, then `pixel_compile` with `preset` (and `size`, `frames`). Deliver it as shipped first, then offer to tune it. |
| A character in motion (idle, walk, run, jump, attack, hurt) | `examples/hero.poses.json` (slim), `examples/knight.poses.json` (stocky, with shield and sword), the hero with a sword `examples/hero-sword.poses.json`, four-legged `examples/fox.poses.json`, a squashing blob `examples/slime-idle.poses.json`, a prop of moving parts `examples/hermit-chest.poses.json`. Compile with `compile <source.poses.json> --out <recipe.json>`. For another character, redraw the nearest one: read `help craft "Characters"` first. |
| Sparks, dust, leaves, or a spell to change | `examples/effects.fx.json`, `examples/<element>-spells.fx.json` (fire, ice, lightning, water, poison, holy, shadow); `help craft "Effects"` |
| Terrain tiles, a scene, a lit scene | `examples/meadow.autotile.json` with `autotile <template.json> --out <recipe.json>`; `examples/forest-spirit-lit.scene.json`; isometric `examples/iso-tiles.json` laid out by `examples/iso-glade.scene.json` (`help craft "Isometric"`); `help craft "Tiles and scenes"` |
| An icon, a hand-drawn sprite, a caption | `examples/coin.json`, `examples/forest-spirit.json`, `examples/caption.json`, or `init <recipe.json>`. Read `help quickstart` first: it is the recipe format. |
| An existing PNG to edit | `import <image.png> --out <recipe.json>` |

## The loop

A pose, effect or other source is not a recipe: compile it first. Then:

1. **Validate.** `node bin/pixelbolt.js validate <recipe>`. Errors name their paths and come back together; fix them all. Don't guess field names: check `help guide` or `schema`.
2. **Inspect.** `node bin/pixelbolt.js inspect <recipe> --out <frames.png> --native --diagnostics`, and look at the image. A valid recipe can still look bad.
3. **Patch.** Edit through the recipe, never the exported files: `node bin/pixelbolt.js patch <recipe> --changes <changes.json> --out <new recipe>` (the quick start has the change format).
4. **Render.** `node bin/pixelbolt.js render <recipe> --out <directory> --expect '{"width":24,"height":24,"frames":6}'`, with what the user asked for in `--expect`. Read the `check`, fix every mismatch it lists, and render again.
5. **GIF, when asked.** `node bin/pixelbolt.js gif <recipe> --out <new.gif>`; `--scale <1-16>` enlarges it for posting.
6. **Deliver** the paths to the source recipe, the sheet, the atlas JSON and any GIF, with any `notes` the tools returned.

Keep the JSON recipe: it is the source. Save edits to a new recipe and render each attempt into a new folder; use `--force` only on output you made, when the user wants it replaced. Stay in the palette, and export at scale 1 for game assets. If the request leaves size or colours open, pick a default, state it in one line and build.

Over MCP the same steps are `pixel_compile`, `pixel_validate`, `pixel_inspect`, `pixel_patch` and `pixel_render` (its `gif` option makes the GIF). Send the recipe once as `project`, then the `revision` id each reply returns.

## Read more only when the job needs it

Run `help` as `node bin/pixelbolt.js help <topic> ["<section>"]`; over MCP, `pixel_help` with `topic` and `name`.

- `help quickstart` (MCP `pixel_help` alone): the recipe format, the operations and patches. Read it before writing or editing a recipe by hand.
- `help craft "<section>"`: one short checklist. Sections: `Rules`, `Drawing by hand`, `Characters`, `Effects`, `Tiles and scenes`, `Isometric`, `Exports and delivery` (video frames, GIF options, Godot, Tiled, Phaser), `MCP`, `Limits`.
- `help guide "<heading>"`: every field, operation, inspection option and export. `help guide` lists its headings.
- `help workflow "<section>"`: long techniques for poses, scenes, tiles, effects and lighting. `help workflow` lists its sections.
- Files: `docs/agent-quick-start.md`, `docs/agent-craft.md`, `docs/agent-guide.md`, `docs/art-workflow.md`, `docs/game-integration.md`, and `schema.json` with the per-format schemas beside it.

Limits: an animation frame is at most 256 × 256 pixels and a project 256 frames; `help craft "Limits"` has the rest.
