# 0.14.0

Falling sand, for agents and for games: a material grid of sand, water, fire, smoke, lava and more that runs live in a game loop and compiles to one-shot clips. A Powder lab to play with it in the studio. Parallax planes and haze that survive export to Tiled and Godot.

- **Falling sand:** a new source format, `pixelforge-powder` (`pixel_help` topic `powder`, `pixelbolt/powder`).
  - Every pixel holds one material from a table: powders, liquids, gases, fire, fixed solids and solids that fall. `base: "sandbox"` starts from sand, water, stone, wood, fire, smoke, steam, oil, lava, ice, ash, moss and wall, with their reactions.
  - Motion that reads:
    - falls speed up, landings splash and liquids pour in arcs;
    - pools level and come to rest;
    - heat, phase changes, burning and reactions between neighbours;
    - moving air lifts smoke into plumes, a wind blows and a blast opens a crater.
  - Structures collapse when what holds them up burns away. With `pieces: "tumble"` they topple and tumble as rigid bodies, float and come to rest.
  - Live: `createLivePowder` steps it every frame with paint, erase, wall, heat, push and burst from the pointer. Recorded strokes pack into a few bytes and replay exactly. A busy 320 × 180 sandbox takes a few milliseconds a frame, and settled regions cost almost nothing.
  - Compiled: `pixel_compile` and `pixelbolt compile` sample one-shot clips of palette grids from one run, with scripted inputs. The same source draws the same pixels everywhere.
  - New presets: hut fire, lava falls, quarry blast, rain on fire and stilt hut.
- **Powder lab** (`/powder.html` in the studio): a falling-sand sandbox in the browser.
  - Paint any material, or erase, wall, heat, cool, wind or blast, and pause or step through frames.
  - Open the presets, and download a GIF, recipe or source next to the matching CLI and MCP calls.
  - Copy a replay link that reopens the scene on the same frame with the same pixels.
- **Parallax and haze in game engines:**
  - `scene.tmx` layers carry each plane's parallax, and hazed placements draw from hazed copies of their tilesets.
  - Each plane is also exported as an image with its haze baked in.
  - A Godot `scene.tscn` scrolls the planes with `Parallax2D`. With the camera on whole pixels and pixel snapping on, every plane lands where Pixelbolt draws it.
- **Fixes from a review of this release:**
  - Falling sand no longer stops partway down through water.
  - A puddle drains into a hole dug beside it.
  - Thick pools come to rest.
  - A piece thrown off the top comes back down.
  - Cutting one piece into many keeps to the piece cap.
  - The compile's work limit counts scripted inputs and tumbling pieces.
  - Clearer errors for colours, sizes and scene fills.
  - The Powder lab says when a link is damaged or a recording is full, and a replay can be stopped.
  - Scene planes round half a pixel as Godot does.
  - `--force` re-exports remove stale planes.
  - MCP scene exports return their warnings.
- **Other fixes:**
  - Bodies matches drawn as video frames match the compile.
  - Tiled maps keep tiles above or left of the map.
  - Long tile-set names draw their test map.

Known issues:
- Thin smoke in falling sand still reads as dark blobs.
- Compiled falling-sand recipes are large (0.2–2.5 MB), because flames and heat glow touch most pixels.
- `base: "sandbox"` uses 76 of the 89 colours a source may have, so custom materials over it must share colours.
- With Godot's pixel snapping, a camera between whole pixels can put a parallax plane a pixel from where Pixelbolt draws it.
- Tails of five or more short links can thrash.
- A far elbow can snap between frames in walks of 32 or more frames.
- Left-facing jumps, attacks and hurts aren't mirrored.
- A plank nearly as wide as its pool, thrown in fast, can be launched out of it.

The full list of changes is in `CHANGELOG.md`.

The bundle keeps its 0.8.0 name, `pixelbolt.mcpb` (checksum `pixelbolt.mcpb.sha256`). The `pixelforge` command still works as an alias.

`pixelbolt.mcpb` contains the local Node.js MCP server, its eight tools, schemas, authoring help and the shipped examples, so every preset compiles from the bundle. The server makes no network requests.

Download `pixelbolt.mcpb` and open it in Claude Desktop, or use Settings -> Extensions -> install from file. Choose a workspace for recipes and generated artwork, then ask the agent to call `pixel_help`. The bundle uses the client's Node.js runtime (20 or newer); it does not include Node.js.

Download `pixelbolt.mcpb.sha256` beside the bundle to check its SHA-256:

```sh
sha256sum --check pixelbolt.mcpb.sha256
gh attestation verify pixelbolt.mcpb --repo skulitom/Pixelbolt --signer-workflow skulitom/Pixelbolt/.github/workflows/release.yml
```

On PowerShell, `(Get-FileHash pixelbolt.mcpb -Algorithm SHA256).Hash` should match the hash in the checksum file.

The GitHub release makes the bundle available immediately. MCP Registry publication is a separate, manually dispatched step after testing; see [Publishing](https://github.com/skulitom/Pixelbolt/blob/main/docs/PUBLISHING.md).
