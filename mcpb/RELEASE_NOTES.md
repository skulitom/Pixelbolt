# 0.17.0

Rigid bodies that keep their pixels in video and go through what they break, cloth that waves in a loop, a scene as one GIF, and the open simulation bugs from the field fixed: liquid that is squeezed out instead of deleted, rafts that float, and falling sand that tells no left from right.

- **Bodies keep their pixels in video:** `pixelbolt sequence` of a match (and `bodiesFrames(source, effect, { scale })`) draws bodies and ropes at the size the frame is enlarged to, so a turned sprite is turned once, at the video's pixels, and every pixel of its picture survives. A swinging sprite was turned on the world's own grid and then enlarged, which broke it up. Sprite sheets and GIFs are unchanged. A circle's picture can roll with `rolls: true`, and a match's `figures()` and `sequence.json` carry every named body's path.
- **What breaks a body goes through it:** a body breaks before its knock is solved, its fresh pieces grip nothing for 12 frames, and a knock passes through a body that can't break. A heavy ball dropped down a shaft of crate floors stopped on the first; it now goes through all five. The pieces of a `weightless` body fall with `breaks: { "fall": true }`. A tower past its balance keeps tipping where it fell asleep mid-tip, a body asleep on ice falls when the ice melts, and a weld or hinge to the world holds the body where it starts.
- **Cloth that waves, in a loop:** a `pixelforge-bodies` effect with `"loop": true` is cloth in a wind that repeats; a cloth's `ripple` draws the travelling wave that reads as cloth in a wind, and its `fill` can carry a design that moves with the folds. New presets `banner` and `lantern`; `flag` waves in a 24-frame loop.
- **One call where there were several:** a scene as one looping GIF (`pixelbolt gif <scene.json>`, MCP `pixel_scene` with `gif`); `render --scale 4`; a sprite with its normal map and a Godot canvas material (`render --normal`); a cylinder's normals (`"axis"`); `[*]` in a patch `insert`; `presets <name> --out` saves a preset's source; tile sets and shipped scenes are presets.
- **Fluid:** a light body pushed under comes back up and a raft carries its load; liquid a piston or a gate closes on is squeezed out sideways or up, not removed; a pinhole where two bands of a body meet is filled, so depth bands no longer flicker with specks.
- **Falling sand:** a source drawn mirrored runs the mirrored way as often (one lake between two dams gave way at its left dam first in 61 of 64 runs), and a pool levels under what floats on it, a skin of ash or a layer of oil.
- **The library has the render check:** `readExpect`, `checkDelivery` and `briefCheck` come from the package entry, for programs that render with `createBundle`. `pixelbolt share` links a source itself, so long presets fit a link.
- **Reported faults:** an effect's light track could hold one frame's glow in every frame under Node 24; a symbol particle drew a row under its `floor`; the autotile test map drew every palette variant in the base palette; a figure with no canvas width threw a RangeError; `import --embedded` ignored `--frame` and `--padding`; `validate` on a source called its first field unknown; a territory `split` that leaves teams unequal shares now warns.

Known issues:
- Scenes with `breaks`, liquids with bodies stacked in them, the plasma presets' arcs and every falling-sand scene play out differently from 0.16.0: review before re-rendering a published piece.
- One MCP call draws a shorter match as video frames than before (about 240 frames of a small board at 1080 by 1920), since bodies are drawn at the video's pixels; the command line has no limit.
- Falling sand runs about 15% slower on a busy board.
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
