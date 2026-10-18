# 0.9.0

Fluid effects. A new source format, `pixelforge-fluid`, runs a small fluid simulation and bakes every frame into palette pixels: smoke, fire, steam, explosions, magic swirls, splashes, waterfalls, drips and a bubbling potion. The result is an ordinary editable recipe, so it inspects, patches and exports like any other, and it never uses a colour outside the palette. Loops are seamless, and the same source gives the same pixels on every machine and in the browser.

- Liquids can throw spray and foam off the water by their own motion (`whitewater`), and an emitter can fade toward its rim (`falloff`) or orbit in an ellipse.
- Ten presets in `examples/*.fluid.json`, polished after an art review; each compiles in well under a second.
- `pixelbolt compile`, `preview` and `sequence` accept fluid sources; MCP `pixel_compile` compiles them, and `pixel_help` with `topic: "fluid"` returns the schema.
- The studio's Fluid lab (`/fluid.html`) tunes a preset in the browser and downloads the GIF, sprite sheet, recipe or source.
- The guide is the "Fluid effects" section of `docs/art-workflow.md`; the full list of changes is in `CHANGELOG.md`.

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
