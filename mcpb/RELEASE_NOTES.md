# 0.19.0

Shapes drawn once and moved as parts: filled polygons, layers that move together, and a wing drawn once that beats on a keyed track. Exports compress four to five times faster.

- **Polygons and parts:** a `polygon` operation draws a filled or outlined shape from editable vertices. A part drawn once in the project's `parts` is placed on any number of layers around its `pivot`, mirrored with `flipX` or `flipY`, and scaled per axis by a number or a named track in `scaleTracks`, keyed in milliseconds with easing and a per-layer `delay`. A frame's `groups` move several layers together. The Midnight Ramen and Eclipse Moth showcases use them.
- **Inspection:** `alpha-blend` names the off-palette colours that translucent paint or layer opacity made; `palette` keeps the ones drawn directly. `inspect --beside` fills a stack's gutters in one pass (about 140 ms to 7 ms for a full stack).
- **Faster exports:** every PNG and animated PNG is compressed at zlib's level 6 instead of 9: a render at the full frame total that barely compresses went from 11 s to 2.4 s, with the same pixels.
- **The skill is found for effects:** its description names fire, explosions, splashes, smoke, water, magic spells and sparks first, and says to use it before writing a drawing script by hand.
- **Reported faults:** `gif.scale` past 16 is refused at once (0.18.0 could run a call to its 50 s limit); a forced re-export removes the lit SpriteFrames, CanvasTexture and normal maps it no longer writes; a `[*]` patch that ends at a named item passes over the lists without it; `pixelbolt/terrain`'s `layeredTestMapRecipe(recipe, layers)` works without its options again.

Changed since 0.18.0, check before upgrading:
- Exported PNG files are about 8% larger (15% for noisy art) and their bytes differ from earlier releases; the pixels are the same. Re-hash anything that pins a PNG's bytes.
- Off-palette colours made by translucent paint or layer opacity are reported as `alpha-blend` in inspection, no longer as `palette`.
- `--gif-scale` takes 1 to 16; 0 and 17 to 99 are refused by the CLI's own message.

Known issues:
- In Godot's `scene.tscn`, a placement that moves, follows `sequence` cues or changes anchor between frames is drawn as it is at the scene's start; the export warns and names it.
- Pose, bodies, crystal, normals and falling-sand sources keep 256 pixels a side, and fluid and wave sources 128.
- Where an effect is too long for its frame total, following the reply's "own frames" route can end in a second refusal about an emitter's `start`, and its "once the loop has N frames" route in a particle limit.
- Light on a screen-sized effect is slow to compile: 640 × 360 over 256 frames takes about half a minute.
- Hand-drawn recipes have no `shine`, and a fluid one-shot that is cut off is not warned about. The one-shot warning does not see a particle still drawn over a sprite the effect draws.
- In a shell, `pixelbolt help <schema part>` prints indented JSON, so a part that is under 12 KB over MCP can pass that there (`help terrain` is 19 KB).
- A one-row sheet wider than 16,384 pixels (`--columns` with 1024-wide frames) can't be imported again.
- The particle examples in `effects.fx.json` (sparks, dust, leaves, shards) still end with a few pixels on screen.
- Scenes with `breaks`, liquids with bodies stacked in them, the plasma presets' arcs and every falling-sand scene play out differently from 0.16.0: review before re-rendering a piece published from 0.16.0 or earlier.
- A pocket of liquid sealed on every side leaks past the obstacle that shuts it in one frame.
- A liquid emitter at `rate` 1 only dips under a `pulse`; it never passes its steady reach.
- A row of thin pieces standing on the floor (bowling pins) is shoved along by a ball rather than knocked flat; stacks of blocks fall as they should.
- A rope given a `density` far lighter than its load stretches; left without one, it holds.
- Cloth is moved by bodies and obstacles but does not push them, and is drawn at the world's pixels in video.
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
