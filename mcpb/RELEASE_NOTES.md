# 0.12.0

Rigid bodies that bounce, stack, topple, float and stir liquids; steadier fluids, effects and waves; territory games with teams, power-ups and long matches; sand and other grains; an inline pixel art player for hosts that support MCP Apps; particles that come to rest; quicker presets and start-up; fixes from agents' hands-on trials.

- **Rigid bodies:** a new source format, `pixelforge-bodies` (`pixel_help` topic `bodies`), bakes circles, boxes, convex polygons and fixed hoops into palette grids. Bodies bounce, slide, roll, stack and topple, then come to rest; `fixed` bodies with `velocity` or `spin` push what they meet, `weightless` bodies float, `asleep` ones hold until hit, and `tireless` is an open cheat. A body can change colour at each hit, draw a trail or carry a sprite turned with it, and `subpixels` draws bodies finer than the world's pixels so a tumbling crate turns smoothly without changing shape. The metadata reports hits, exits, paths and the frame from which everything rests. New presets: ring escape, bouncing pixel, spinning hoop and crate topple.
- **Bodies in fluids:** a fluid effect takes `bodies`. They splash into water and float by their density, are dragged by the flow, stir a pool with their turning, carry what rests on them, rest on sand as ground and are pushed by gas pressure, and they work in loops, with heat and in the live runner. New presets: crate splash, sand slide, water wheel, hot stone and plank tip.
- **Territory, power-ups and long matches:** a bodies effect can be a territory game: teams own cells, a body passes its own team's cells and claims the others' it hits, pickups and timed events grant split, grow, speed, warp and magnet, and a score is drawn over the board. A match longer than a recipe's 256 frames (up to 18,000) goes straight to numbered video frames with `pixelbolt sequence` or `pixel_compile`'s `sequence`. New preset: territory.
- **Sand and other grains:** a liquid's `granular` makes sand, salt, sugar, gravel or dry snow, with friction that grows with pressure, heaps that hold their angle of repose, dead landings and damp grains (`cohesion`). New presets: hourglass, sand gate and sand plough. The studio's Fluid lab lists them, with Steepest slope and Damp sliders.
- **Inline previews (MCP Apps):** hosts that support the `io.modelcontextprotocol/ui` extension show an inline player for inspect, patch, compile, render, scene and import results, at a crisp integer zoom, with play, frame stepping, speed, animation and background controls and an optional Open in playground button. The viewer makes no network requests; clients without the extension get exactly the same tool listings and results as before.
- **Steadier pictures:** fluid, effect and wave looks hold each pixel's band from frame to frame, so fire cores, smoke fringes, rippling beams, noisy rings and lit rims no longer flip pixels back and forth, and loops still close exactly; sparks, whitewater and bubbles keep their drawn pixel, and `dissolve` moves with its particle. Every fluid preset's pixels change.
- **Particles that come to rest:** an effect emitter with a `floor` or `ground` takes `rest: true`, so snow, leaves, petals and coins settle where they land.
- **For agents:** `expect.frames` takes a count per animation; an unknown field or operation names the one most likely meant; a `pixelforge-fx` source reports every broken layer and emitter at once (up to ten); `pixelbolt compile` and `autotile` always list `warnings`; `render`, `scene` and `sequence` refuse an `--out` named like a file; `pixelbolt help <topic> [section]` prints what `pixel_help` returns.
- **Faster:** the presets listing measures presets in parallel worker threads (a cold listing takes about a quarter of the time on a many-core machine), and every CLI command and tool worker starts about 100 ms sooner. `pixel_help` topic `presets` now lists 71 shipped presets.
- **Fixes:** a recipe `tilemap` of corner symbols gets the even-cell and no-iso checks; `pixel_help` is no longer annotated read-only, since its `presets` topic keeps its measurements in the export directory; the skill's paragraph for a copy of SKILL.md alone runs only released code; the agent guide and docs/PUBLISHING.md say what `saveAs` with `overwrite` replaces for `.tres` and `.tsx` files.

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
