# 0.10.0

Effects on a sprite and sword trails, Godot TileSets and lit sprites, effects that loop, a rigged hero to start from, every validation error in one reply, smaller CLI replies and a lighter skill.

- **Effects on a sprite:** a `pixelforge-fx` symbol may be a frame of another recipe or pose source (`{ "recipe": "hero.poses.json", "frame": "idle-rest" }`); an emitter with `sprite` spawns on that sprite's pixels, its edge or the outline just outside it, and `release` dissolves it pixel by pixel for deaths and teleports; an `aura` shape layer is a continuous glow hugging a sprite, and in a looping effect it loops without a jump. A symbol may be a whole animation, shown frame by frame. A `trail` shape layer is the smear behind a moving point, such as a sword tip taken from a pose animation. `examples/hero-magic.fx.json` puts a teleport and a looping spirit aura on the rigged hero, and `examples/swing-trail.fx.json` a trail on a sword swing.
- **Godot TileSets:** a recipe whose frames are an autotile set also exports `name.tileset.tres`, a Godot 4 `TileSet` for `TileMapLayer` with one terrain, so painting the terrain in Godot picks the tile Pixelbolt's tilemap would. Frames of one mask become alternatives, and an animation that loops over one mask's frames, side by side in one row of the sheet, becomes an animated tile. The CLI's `render`, MCP `pixel_render` (whose `saveAs` takes `tileset`) and the studio's **Export assets** ZIP include it.
- **Lit sprites in Godot:** a scene export's asset with a normal pass also gets `normal_y_up.png` and `canvas_texture.tres`, a Godot 4 `CanvasTexture`; its `sprite_frames.tres` draws through it, so `Light2D` nodes light the sprite with no import settings to change.
- **Effects that loop:** in a looping `pixelforge-fx` effect, a shape layer that spans every frame cycles at a steady pace with no jump at the loop point. `examples/fireball.fx.json` is a seamless looping projectile, and the fire explosion, slash hit, lightning strike, healing circle and landing dust examples follow their own advice. One-shots and shorter windows draw as before.
- **Rigged figures:** `examples/hero.poses.json` is a complete rigged side-view figure with idle, walk, run, jump, attack and hurt. Compiling poses warns when a pose draws outside the canvas, and warnings on generated poses point at what the author wrote. The render check fails a delivery with nothing visible.
- **Every error in one reply:** validation names every broken drawing operation, and every grid row of the wrong width, at once (up to ten in `errors`), instead of stopping at the first.
- **Smaller replies:** the CLI's `render` and `scene` name their folder once and list files relative to it (`--list-files` lists every file); a 13-frame sprite's reply went from 3.9 KB to 0.8 KB. `compile`, `autotile` and `import` now write their metadata only with `--metadata <new.json>`, as MCP `pixel_compile` already did. Clipping lists the first 16 places. Scripts that read these replies should take paths relative to `directory` and pass `--metadata` for the metadata.
- **A lighter skill:** the pixel art skill is 12 KB instead of 21 KB and starts from the quick start.
- **Fixes:** a pose source without `ramps` takes them from its shared palette file; fx cues named `toString`, `constructor`, `hasOwnProperty` or `valueOf` are no longer dropped; the portable build retries a slow or dropped Node.js download.

The full list of changes is in `CHANGELOG.md`.

The bundle keeps its 0.8.0 name, `pixelbolt.mcpb` (checksum `pixelbolt.mcpb.sha256`). The `pixelforge` command still works as an alias.

`pixelbolt.mcpb` contains the local Node.js MCP server, its eight tools, schemas and authoring help. The server makes no network requests.

Download `pixelbolt.mcpb` and open it in Claude Desktop, or use Settings -> Extensions -> install from file. Choose a workspace for recipes and generated artwork, then ask the agent to call `pixel_help`. The bundle uses the client's Node.js runtime (20 or newer); it does not include Node.js.

Download `pixelbolt.mcpb.sha256` beside the bundle to check its SHA-256:

```sh
sha256sum --check pixelbolt.mcpb.sha256
gh attestation verify pixelbolt.mcpb --repo skulitom/Pixelbolt --signer-workflow skulitom/Pixelbolt/.github/workflows/release.yml
```

On PowerShell, `(Get-FileHash pixelbolt.mcpb -Algorithm SHA256).Hash` should match the hash in the checksum file.

The GitHub release makes the bundle available immediately. MCP Registry publication is a separate, manually dispatched step after testing; see [Publishing](https://github.com/skulitom/Pixelbolt/blob/main/docs/PUBLISHING.md).
