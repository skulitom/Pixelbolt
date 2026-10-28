# 0.9.2

Depth and perspective for scenes, spell and water effects, Godot 4 export, the pixel art skill on its own, and an MCP server that answers while it works.

- **The skill on its own:** `npx -y pixelbolt@latest skill install` installs the pixel art skill for Claude Code, with no MCP server and nothing cloned. Every command it names runs through `npx -y pixelbolt@0.9.2`.
- **Godot and Aseprite:** every export writes a Godot 4 `SpriteFrames` resource (`name.tres`) beside the sheet, and the atlas carries Aseprite-style `frameTags`.
- **Depth and perspective:** scenes get a depth view, perspective guides, ground-sorted tilemaps, `lift` for jumps, held items that sort with their holder, `haze` for far planes, a `camera` with `parallax` planes, cast `shadow`s and a `sun`. Recipes get an isometric `box`, iso tilemaps and ground-sorted layers, and normals sources take flat `faces`.
- **Spell and water effects:** `pixelforge-fx` shape layers draw rings, slashes, beams, lightning, magic circles, impact stars and fireballs, and with lit and shade bands, `stream`s, blob particles, `noise` and a ground `floor`, cel-shaded water. Nine reviewed examples.
- **Wave effects:** `pixelforge-wave` bakes looping interference and portal interiors into palette grids.
- **Large stills:** a single-frame recipe may be up to 4096 pixels a side, so a 1080p backdrop is one canvas at one screen pixel per art pixel.
- **Exports at the names asked for:** `pixel_render`'s `saveAs` writes the sheet, atlas, `.tres`, GIF or recipe where the user asked inside the server root, and never over a file it shouldn't.
- **MCP server:** answers `ping` during a call and stops a call on `notifications/cancelled`, reads a recipe sent as JSON text, and lists its tools in 15.9 KB instead of 23.3 KB.
- **Studio:** zoom with the wheel, pan by dragging and full screen; one screen on a desktop window; each tab keeps its own draft.
- **Fixes:** a link under the MCP root can't lead outside it; forced exports keep other sprites' files and survive renames that only change letter case; no CLI command writes over a file it reads; GIFs keep later transparency in Pillow; APNG frames of 10 ms or less play as written; embedded recipes stay within what Pillow opens; fast thin fluid obstacles push water instead of passing through. Tilemap variants without a `seed` no longer form a checkerboard, so those maps render differently from 0.9.1.

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
