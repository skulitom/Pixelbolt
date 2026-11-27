# 0.22.0

Text in Cyrillic, Japanese kana, Korean Hangul and common CJK ideographs; scenes made straight from source files, with normal passes derived in place and dithered light; and two more four-direction characters, shown together in a lit camp scene.

- **Text in more scripts:** `text` draws Cyrillic (Russian and Ukrainian), Hiragana and Katakana with voiced and small forms, all 11,172 modern Hangul syllables and 165 ideographs of game menus, and full-width punctuation. Hangul and ideographs are drawn in a 9×9 cell, so every syllable is a picture of its own. Latin text lays out as before, and a character the font lacks is still an error that names it.
- **Two more four-direction characters:** the `four-way-mage` (with `cast-down`) and `four-way-ranger` (with `aim-right` and `aim-left`) presets walk in four directions, as `four-way-knight` does. Start from `pixelbolt presets four-way-mage --out mage.poses.json`.
- **A lit camp scene:** `examples/camp-clearing.scene.json` puts the three characters, a meadow clearing and the campfire fluid under flickering firelight, every asset a source file named as it is.
- **Scenes from sources:** a scene asset may be a poses, autotile, fx, fluid, wave, crystal, powder or bodies source, as a file, inline or a source revision; `pixel_scene`, `scene` and `gif <scene>` compile it first.
- **Normal passes in place:** a scene asset's `normal` takes a `pixelforge-normals` source and, without `recipe`, derives it from the asset's own drawing. A normals source's `recipe` may be a source file (`pixel_compile`, `pixel_render` with `normal`), and `detail: {"amount", "ignore"}` keeps outlines and eyes flush on the rounded surface.
- **Dithered scene light:** `lighting.dither` and `lighting.pattern` feather the bands of scene light into each other with no new colours; the pattern holds still under a camera pan.
- **Colour counts for GIFs:** `pixel_scene` replies with `colors`, and a scene GIF refused for passing 256 colours in a frame says how many come from the drawing, from the lighting and from translucent placements, and what to change.
- **Repeating fluid emitters:** an emitter's `repeat` fires its burst or window every `repeat` frames.
- **Several files in one validate:** `pixelbolt validate a.json b.json …` replies with an entry for each file and exits 1 when any fails.
- **Fixes:** `gif -` takes a scene on stdin; `gif` on a source file and `inspect --reference` with one no longer stop with `project.format: unknown field`; a liquid with `heat` and a `strand` layer, a thin polygon body with `subpixels` and a one-cell-wide iso stack with `cell` compile; a before and after image of two large frames fits one PNG; `frames` that merges past 60 seconds holds the frame at 60,000 ms with a warning.
- **MCP fixes:** wrong `data`, `path` and `beside` arguments, and a source revision where a recipe revision belongs, get errors that name the argument; `pixel_inspect` with `beside` previews the comparison in MCP Apps; revisions save where the output folder cannot make hard links.

Changed since 0.21.0, check before upgrading:
- The 122 presets shipped in 0.21.0 compile to the same recipes and draw the same pixels. A scene without `lighting.dither` and a normals source with a number for `detail` draw as before.
- Refused now, where 0.21.0 ignored the extra option: `pixel_compile` with `slices` and `draftViews` or `sequence`, or with `metadata` and `sequence`; `compile --animation` or `--slices` with `--draft-views` or `--expand`; `inspect --motion` with `--every`.
- `pixel_inspect`'s `beside` takes 1 to 8 revision ids; an empty list or more than 8 was taken by 0.21.0 and is refused now.
- Under the server root, a referenced palette, scene asset, normal pass or normals recipe larger than 16,777,216 bytes is refused; 0.21.0 read it. The CLI still reads one of any size.
- A stack whose animations make frame names that differ only in case (`Walk` and `walk`) is refused; 0.21.0 compiled it.
- `--offset` with an empty item (`4,`) is refused; 0.21.0 read it as `4,0`.
- `frames` (`compile --frames`) that merges frames past 60,000 ms now gives a recipe with that frame held at 60,000 ms and a warning, so the animation is shorter than its source; 0.21.0 refused it.
- `pixel_inspect` with `beside`, in a client that shows MCP Apps, previews the stacked comparison instead of playing the first recipe.
- Pose-sheet and draft-view labels and motion-strip keys draw Cyrillic, kana, Hangul and the listed ideographs where they drew `?`.
- For code that imports the font: `FONT_CHARACTERS` lists 629 characters (191 in 0.21.0) and leaves out the Hangul syllables, which are built on demand; ask `hasGlyph(character)` instead.

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
