# 0.16.0

A check that knows the sprite sheet that was asked for, MCP replies that name the release that sent them, and Tiled tile sets that play every looping animation of a sprite.

- **The check knows the sprite sheet:** `expect.sheet` checks the sheet the user named: its `width` and `height` in pixels, or its `columns` and `rows` (`{"rows": 1}` for a one-row strip). A grid wraps at 8 columns unless the recipe sets `sheet.columns`, so a sheet of 10 or 12 frames came out in two rows while every other check passed (5 of 8 such requests in one benchmark). A miss names the `sheet.columns` that makes the asked sheet with the fewest empty cells, and turns `sheet.trim` off for a trimmed atlas. When the default grid wraps and nothing asked about the sheet, `delivered.sheet` says so.
- **MCP replies name this release:** a bodies match too long for one call, and a `pixel_compile` with `sequence` stopped at the time or memory limit, name `npx -y pixelbolt@<the server's version> sequence ...`, so the command line runs the same release as the server, not whatever npm's latest is. `pixel_help`'s description names the `powder` topic it already served.
- **Tiled plays every looping animation:** a Tiled tileset of a sheet with no terrain (a sprite's `tileset.tsx` in a scene export) left out, without a word, any looping animation that shared a frame with an earlier one, so `iso-tiles`' `water-late` played nowhere. Every looping animation now plays from its first frame, in whichever order they are listed, and that frame keeps its tile weight.

Known issues:
- A row of thin pieces standing on the floor (bowling pins) is shoved along by a ball rather than knocked flat; stacks of blocks fall as they should.
- A rope given a `density` far lighter than its load stretches; left without one, it holds.
- Cloth is moved by bodies and obstacles but does not push them.
- `compile --size` keeps a drawing that touches one edge of its canvas on that edge, so the fox gets its margin below.
- Some command-line replies still name the MCP call that fixes a mismatch.
- Thin smoke in falling sand still reads as dark blobs, and compiled falling-sand recipes are large (0.2–2.5 MB).
- With Godot's pixel snapping, a camera between whole pixels can put a parallax plane a pixel from where Pixelbolt draws it.
- Tails of five or more short links can thrash, and a far elbow can snap between frames in walks of 32 or more frames.
- Left-facing jumps, attacks and hurts aren't mirrored.

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
