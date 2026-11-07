# 0.13.0

Characters that move as if animated: walks, runs and jumps that read, tails that follow through, four-legged creatures and drafted turned drawings for small parts; crystals that grow; bodies that break; a parts view and motion arcs for reviewing figures.

- **Walks, runs and jumps that read:**
  - Arms swing against the legs, legs are long at contact, the body dips after each step, and the lifted foot leaves behind and lands in front.
  - The jump tucks its legs at the apex and reaches down to land.
  - Feet drawn with `views` roll heel to toe.
  - A far hand never floats free of its arm.
  - A figure keeps one outline round its silhouette.
  - The hero example is redrawn from a brief.
  - The motion review checks the gait (`armSwing`, `contactLegs`, `kneeLift`), so a walk that slides nowhere but still looks wrong now fails.
- **Tails that follow through:** `rig.tail` hangs on damped springs that the body's own motion drives. The tail trails in a run, lifts as the body falls, whips after a strike and settles after landing. Each motion's `follow` (0–2) sets how far it swings.
- **Four-legged creatures:**
  - `rig.fore` and `rig.hind`, with optional `rig.chest` and `rig.neck`.
  - Gaits: a lateral-sequence `walk`, a new `trot` template and a gallop `run` whose spine curls and stretches.
  - Idle, jump and hurt for four legs.
  - A new red fox example and preset, `fox`.
- **Draft views:** `pixelbolt compile x.poses.json --draft-views boot:15,345` (MCP `pixel_compile` `draftViews`) drafts small grid parts turned by pixel-art rules, for you to correct and paste into `views`. `--preview` draws each draft beside the flat drawing and today's turn.
- **Seeing motion and parts:** the motion review draws one cycle's path of each foot, hand and the head. A new `parts` view (also in the studio's review menu) paints each pixel by the part that drew it.
- **Crystal growth:** a new source format, `pixelforge-crystal` (`pixel_help` topic `crystal`, `pixelbolt/crystal`). Faceted prisms, cubes and octahedra, clusters and geodes, and snowflakes all grow from a seed and come to rest. New presets: geode, quartz cluster, pyrite and snowflakes.
- **Rigid bodies:**
  - Breaking bodies: `breaks` and the `break` power. A knocked body breaks into convex pieces that carry its picture. New preset: crate smash.
  - Blade bloom: strikes, cuts, pivots, smears and crowds of thousands. New preset: blade bloom.
  - Heavy loads rest on light bodies, and touching bodies are drawn side by side.
  - Bodies in a liquid share its pressure solve, so a light plank lands on a pool instead of erupting it.
- **For agents:**
  - The presets listing is a line per preset, 9 KB instead of 21 KB.
  - A held prop turns with the hand.
  - A cut-down expanded poses source compiles.
  - `pixelbolt` exits quietly when piped to `head`.
- **Fixes from a review of this release:**
  - The crate smash preset no longer crashes as video frames (`pixelbolt sequence`, `pixel_compile` `sequence`).
  - Breaks no longer stop silently at the crowd limit: there is room for every body with `breaks` by default, and a compile warns when a break is cut short.
  - Fixed bodies that events break count toward the work limit.
  - Figures facing left bend their knees and lean the way they face.
  - Quick or many-framed four-legged gaits compile.
  - A tail can't also be a leg or arm bone, the chest or the neck.
  - The schemas refuse what the compilers refuse.
- **Docs:** README in Korean and Spanish.

Known issues:
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
