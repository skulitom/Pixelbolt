# 0.9.1

A browser playground and recipes you can share, renders that check themselves against what was asked for, thicker and livelier fluids, moving scene lights, and an MCP server that stops a runaway call instead of hanging on it.

- **Playground:** [try Pixelbolt in the browser](https://skulitom.github.io/Pixelbolt/playground/) with nothing installed. A share link carries the recipe inside the link, and every PNG the playground exports carries its recipe, so it reopens. `pixelbolt share`, `--embed-recipe` and MCP `share` and `embedRecipe` do the same from the command line and the server.
- **Renders check themselves:** `pixel_render` and `pixelbolt render` report each frame's size, the frames and loops, colours and transparency. Given `expect`, they name every file that misses what was asked for, with the call that fixes it.
- **GIFs at the size you drew:** GIFs keep the frames' own size; a 32×32 animation used to come out 256×256. Pass `scale` to enlarge one for posting.
- **Fluids:** thick liquids and gases (`viscosity`, `yield`, `adhesion`, `apic`), smooth obstacles that liquids slide down, obstacles and liquid settings that change on cue (`keys`), bursts in mid-air, thrown dust, decorations the fluid ignores, per-frame figures, and warnings for setups that make nothing. `createLiveFluid` runs an effect a frame at a time for interactive pages. Seven new presets: honey, slime, snow off a roof, dam break, dust wave, bursting slime and honey let-go.
- **Particle effects:** ring and line spawn shapes, sparks that face their direction of travel, colour stages over a life, child emitters (trails, and bursts where a particle ends or lands), eased timing, and cue points for game code.
- **Scenes:** lights that follow a placement or a point, flicker, and flash on cues; `lit: false` keeps fires and lamps in their own colours.
- **Figures in motion:** bone and mass parts, six motion templates, and motion review for foot slide, ground error and loop seams.
- **Less for agents to read:** the tool listing is about 20 KB instead of 133 KB, and `pixel_help` returns a 7 KB quick start, with the longer guides as topics.
- **A sturdier MCP server:** each tool call runs in a worker thread and is stopped after 50 seconds (`--time-limit` changes this) or when it runs out of memory, with an error that says so, and the server keeps serving. A video sequence from one call may come to at most 512 MB.
- **Fixes:** a scene placement's `repeat` draws every copy again; `--force` re-exports remove an earlier export's leftover frames and never write over their own recipe; nothing passes through thin fluid obstacles; GIF holes stay clear in Pillow and ffmpeg; H.264 exports keep every colour.
- **Claude Code plugin:** `claude plugin install pixelbolt --marketplace skulitom/Pixelbolt` installs the MCP server and the pixel art skill.

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
