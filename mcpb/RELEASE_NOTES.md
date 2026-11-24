# 0.21.0

Walk cycles from drawings you already have: cut a PNG's feet and arms into moving parts, animate drawn front, back and side views in four directions, and review every step of a cutout walk for detached boots and gaps. A looping cloth keeps moving in video frames.

- **Four-direction walks from drawn parts:** a pose source's `walkCycles` pairs each facing's standing pose with two feet and optional arms, and compiles eight editable steps a direction through the CLI or MCP; a side cycle can generate its mirror. Start from `pixelbolt presets four-way-knight --out knight.poses.json`. The walks export as Godot SpriteFrames like any other animation.
- **Cutout walks from a PNG:** `pixelbolt import sprite.png --cutout cuts.json --out hero.poses.json` (`pixel_import` with `cutout`) makes the rectangles you mark into feet and arms and keeps the standing pixels and the ground point. `extendFeet` draws short boot shafts under a coat, and the exported `anchorPx` locates the same point on the source drawing.
- **Review a whole walk:** `inspect hero.poses.json --view walks` (`pixel_inspect` with `view: "walks"`) scans every phase of a character's walks and gives native coordinates for concealed joint gaps, exposed boot shafts and ink that moves with the wrong part. `inspect --motion <walk> --track mask.json` (`track` on `pixel_inspect`) follows chosen standing pixels through the steps, and `keepWith` in the cut manifest gives an outline shared by equipment and a limb to the right part.
- **A looping cloth keeps cycling in video frames:** a `loop: true` cloth made straight into frames (`pixelbolt sequence`, or `sequence` on `pixel_compile`) plays for as long as `--seconds` or `--loops` asks, as its compiled recipe does. In 0.20.0 the shipped `flag` held its last picture for the second half of a two-pass clip, and `--loops 2` was refused.
- **Tile set previews:** a recoloured variant's copy on the test map no longer replaces the template of a variant named `as-<that variant>`. The exported tiles were never affected.

Changed since 0.20.0, check before upgrading:
- A `loop: true` cloth, such as the shipped `flag` and `banner`, gives different video frames from `sequence` after its first pass: it keeps moving where 0.20.0 held one picture. Its compiled recipe is unchanged.
- The pose examples shipped in 0.20.0 compile to the same recipes as before.

Known issues:
- A slice sheet (`compile --slices`) leaves out moving parts, animations, facets and paths, and says so: those play from the baked frames.
- A stack on a map's grid (`cell`) is baked about 1.4 times wider than its slices stack at run time, so bake what stands on a map and stack what turns freely.
- On a canvas, a run-time stack turned between quarter turns has soft outer edges below scale 3. At quarter turns it is the baked frame pixel for pixel.
- `compile --slices` is refused when the stack's baked frames would not fit a recipe, though the slices would: give the source a lower `resolution` or one heading for that compile.
- A stack's sockets do not carry one another, a part cannot be hidden for a frame, and facets and paths take no shade from `ramps`. Studio plays parts and animations but does not edit them.
- An iso tilemap with `heights`, or one sorted among the placements, reaches Tiled as tile objects, not a tile layer. The isometric Godot TileSet has plain tiles and no terrains, and `scene.tscn` draws the scene from baked planes, not a `TileMapLayer`.
- A scene placement that moves is placed by pixels, not by cell.
- A forced re-export that drops the normal pass leaves `<name>.canvas.tres`, `<name>.normal.png` and `<name>.normal_y_up.png` in the folder: a TileSet or SpriteFrames saved in Godot may still use them, so delete them by hand if nothing does.
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
