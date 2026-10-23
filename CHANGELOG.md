# Changelog

Releases before 0.9.0 are described on [GitHub Releases](https://github.com/skulitom/Pixelbolt/releases).

## Unreleased

### Renders check themselves

- `pixel_render` and `pixelbolt render` report a `check` of what they wrote: each frame's pixel size, every animation's frames and loop, the colours used, transparency and the GIF size. Give them what the user asked for (`expect` over MCP, `--expect` on the CLI: `width`, `height`, `frames`, `colors`, `transparent`, `loop`, `gifScale`) and `check.problems` names every file that misses it, with the patch or render call that fixes it; fully transparent frames are noted either way. Agents mostly exported their first try; this puts the check in the path. The tool descriptions, quick start and skill now say to work in that loop.

### GIFs at the size you drew

- GIFs now keep the frames' own size unless you ask for more: `pixelbolt gif`, MCP `pixel_render`'s `gif` and `animationGIF` default to scale 1. They used to enlarge to the largest whole multiple within 256 pixels, so a 32x32 animation came out 256x256 and agents handed that on when 32x32 was asked for. Pass `scale` (`--scale` on the CLI) to enlarge one for posting; the studio's **GIF** button still uses the current zoom.

### Older art out of sight

- The Emberfall and Tidewatch demos and the Listening Hollow study (with its lantern skink) no longer represent what Pixelbolt makes, so they are gone from the README, llms.txt, the guides, the skill and the portable build's START HERE. Their folders stay, marked as archived, because tests use them as fixtures.
- The studio no longer opens on the skink: the forest spirit is its first sample, and the "Light a scene" page shows the lit forest-spirit example (`examples/forest-spirit-lit.scene.json`) instead of the Hollow.
- The diorama's night scene takes their place in the README: torches and candles that flicker and a flash on the strike.

### Scene lights that move

- **`follow`:** a light rides a uniquely named placement, or with `point` a named point of its current frame (a torch flame, a blade tip), with `at` as the offset. It moves with trajectories, animations and attachments, and is off while the placement is hidden or its frame lacks the point.
- **`flicker`:** `{ amount, every, seed }` swings a light's strength by up to `amount` either way and its reach by up to half as much, along seeded noise that repeats once per scene duration, so looping scenes have no seam. On average it is as bright as a steady light.
- **`keys` and `strength`:** strength (0–8) and radius over time, at milliseconds or cue times such as `"strike+90"`, eased between keys. Above 1, ramp lighting lifts colours past their authored shade, so a flash on a hit reads.
- **`lit: false`** on a placement keeps its authored colours under lighting, for fires, lamps and glows.
- Renders, `pixel_scene` and the studio's scene viewer report where each light is at the current time; the viewer's markers follow moving lights, and dragging a following light moves its offset. Scenes without the new fields render exactly as before.

### Less for agents to read

- The MCP tool listing is about 20 KB instead of 133 KB (roughly 5,000 tokens instead of 36,000 on every connect): `pixel_validate`, `pixel_inspect`, `pixel_patch` and `pixel_render` describe `project` briefly instead of embedding the recipe's 30 KB JSON Schema four times. The server still checks every recipe and names the path of any mistake.
- `pixel_help` without a topic returns a 7 KB quick start ([docs/agent-quick-start.md](docs/agent-quick-start.md)): the recipe format with a complete example, the operations, the tools and working habits. It used to return the whole authoring guide, art workflow, schema and example, 142 KB or about 38,000 tokens. Those are now topics: `guide`, `workflow`, `schema` and `example`, beside the source format schemas.
- The examples use the same compact formatting as compiled files (anything that fits in 120 columns on one line, grids one row per line): 362 KB instead of 664 KB for the same data.

### Particle effects with structure

- **Spawn shapes:** a `ring` (radius or `[min, max]`, an optional `arc`) or a `line` instead of the `area` box, with `even: true` to space the particles spawned together evenly. On an `outward` ring, `angle` is measured from each particle's outward direction, so an even ring makes a shockwave and an arc a fan of sparks.
- **`face: true`** picks the sequence by direction of travel (2–16 sequences, the first facing right, turning clockwise), so sparks draw as streaks along their arc. **`tint`** lists colour stages over each life, so a spark cools from white to red without a symbol per colour.
- **Child emitters:** `from` names an earlier emitter, and `when` spawns from its particles where they end (`death`), first land (`floor`) or every frame they live (`life`: trails), with `inherit` for a share of the parent's velocity. Loops stay seamless: children are keyed by their parent and the warm-up covers the longest chain of lives. **`behind: true`** draws an emitter under the others.
- **Timing and cues:** `duration: { "from", "to", "ease" }` eases frame durations across an effect (`in` front-loads an impact). `cue` names a point at an emitter's spawn centre in every frame it spawns; frames carry it as a named point, atlases export it and the metadata lists it, so game code can shake or pause on the hit.
- Every existing source compiles to the same recipe as before: the new draws use their own salts, and the Tidewatch effects and the examples are unchanged.

### Torch preset

- The torch's flame no longer burns beside the handle under its metal cup. Its emitter was a radius-4 disc centred inside the cup, so its rim heated the empty pixels beside the narrower handle in every frame (76 pixels over the loop). It now sits 1.5 pixels higher with radius 3.5, which keeps about the same amount of flame and the tall tongues. Its golden and live hashes and README GIF are updated.

### Figures in motion

- Bone and mass parts rasterize from structure under palette ramp lighting, with clean thin strokes, socket joints and area-preserving squash. Grid parts keep authored views for detailed hands, heads and props.
- Relative joint angles, attachment dependency resolution, deterministic two-bone reach, angle/reach tweens, relit mirrors and joint metadata extend version-1 pose sources without changing existing recipes.
- Six motion templates generate editable key poses and in-betweens with foot targets, contacts, depth swaps and attack cues. `compile --expand` exposes them; authored poses override generated names.
- CLI/MCP motion inspection measures foot slide, ground error, pose spread and loop seams. The studio edits pose sources directly and adds Motion and Show contacts controls.
- Pinned figure hashes, performance fixtures, browser checks and independent PNG/GIF verification cover the workflow. Existing example pixels remain unchanged.
- Walk and run keep near limbs, and anything they hold, in front of the body for the whole cycle; `swapDepth: true` restores the exchange for front or back views. Before, a darker far arm and leg were drawn in front for half of every cycle.
- Relit mirrors are exact: bone ends, spines and points round halves away from zero, and the direction of −θ is the bit-exact reflection of θ. Before, 352 of 11,520 bone ends and 2,156 spines missed by a pixel.
- Templates sink a motion's poses together, by up to four pixels, when a bob or lean would lift a hip beyond its planted leg, so feet neither float nor slide. Attack follow-through swings 45° past the strike. Every template at its defaults now passes its own motion checks on a plain 32×32 humanoid.
- Motion review: contact A/B poses with joint angles also pass when a joint turns 20° or more (side-view contact poses can share most pixels), and a joint's loop seam may be as large as its paired limb's largest jump.
- Masses are cached like bones, and drawing structural parts has an 8,388,608-pixel budget per compile. A source that took 14 s now fails in about a quarter of a second with a path.

### Pose rendering performance

- Named part layers blend and consume the drawing budget only within their drawn bounds. Layers share one cleared scratch buffer per frame, so sparse rigs no longer scan and allocate a canvas for every part.
- Pose compilation builds timing metadata and validates stamp output without rendering every frame. Existing recipes, marker times, mirrors and trimmed atlas validation retain their behavior.
- `node scripts/bench-poses.mjs` records repeatable stamp-rig timings; `renderProject(recipe, { stats: true })` includes drawing work counters. The pre-change corpus is pinned by 861 RGBA frame hashes and pose metadata checks.

### Thick fluids

- **`viscosity`** (gases and liquids, 0–64 square pixels per frame): an implicit viscosity solve in stress form (after Batty and Bridson, 2008), with Jacobi-preconditioned conjugate gradients and a stress-free surface. It slows shearing and stretching, never motion as a whole, so a drop of honey falls exactly as fast as a drop of water, a stream stays one unbroken rope, and a heap spreads slowly instead of splashing. Walls and obstacles hold a viscous fluid; **`slip: true`** lets it slide along them. In a viscous liquid, the pressure solve runs again after the viscosity solve, so a heap does not slump a step at a time, and the particles' own jitter fades with the thickness (the FLIP share falls where the liquid is thick).
- **`yield`** (liquids, 0–16): a yield stress for mud, slime, dough and toothpaste, after Goktekin, Bargteil and O'Brien (2004). Each particle carries an elastic strain, turned with the flow and capped at the yield; the elastic stress is split as implicit elasticity is, so it is stable at any timestep. Below the yield a blob squashes where it lands and springs back, and a heap keeps its shape (a heap *h* pixels high holds when the yield is more than about gravity × *h* / 2); past it, the liquid flows.
- **`apic: true`** (liquids): affine particle-in-cell transfers, so the calm share of each particle's velocity keeps the turning and shearing of the flow around it. A spinning blob of syrup keeps about three times as much spin as with plain PIC.
- **`adhesion`** (liquids, 0–4): liquid touching a wall or obstacle stays on it unless pulled away faster than about `adhesion` ÷ 2 pixels per frame, so a film clings under a ledge or to a spoon.
- **`advection: "sharp"`** (gases): MacCormack advection with the limiter of Selle et al. (2008). A puff carried by the wind keeps more than twice as many dense pixels after 30 frames, with no new peaks, at up to twice the cost.
- **`drag`** is documented as resistance from the surroundings, which slows falling too; thickness is `viscosity`.
- **Two presets:** [honey](examples/honey.fluid.json), a glossy rope of honey from a dipper folding into a mound on a calm surface in a jar (viscosity, APIC, adhesion), and [slime](examples/slime.fluid.json), a blob that squashes flat, springs up tall, wobbles and settles into a dome that holds its shape (yield stress). Both have golden hashes and README GIFs. Their final look was chosen in blind A/B reviews of several variants each.
- **Fluid lab:** the two presets, and Thickness (viscosity) and Firmness (yield) sliders for liquids beside Liveliness (flip); the drag slider is now Resistance (drag).
- **Work budget:** a viscous or yield-stress effect counts about three times the cell updates per step, and sharp advection about thirty more per cell, so expensive sources are still refused before they run.
- Every new setting is off by default, so these settings leave existing sources as they were.

### Fluid fixes

- **Nothing passes through thin obstacles any more.** Sparks (and so whitewater spray) moved their whole step at once and were only checked where they landed, so anything faster than a pixel a frame could skip a wall one pixel thick; fast liquid particles could too. Both now walk every cell along their path and stop at the first solid one, which also stops them slipping between two pixels that touch only at their corners. This changes the waterfall (the water now leaves the lip in a free arc instead of creeping down the stepped cliff face around its corners), and the drip and potion slightly; their golden hashes, GIFs and the potion's live-session hash are updated.
- **Water no longer shows through a thin wall.** The blur that turns liquid particles into a surface also read what particles beside a wall had splatted into its cells, so a pool resting against a wall one pixel thick drew faint water down its far side at low look thresholds or with heavy dither. What lands in an obstacle cell now counts only for cells that hold water themselves, so it still shapes the water's own edge; every preset is unchanged apart from three shading pixels in honey and slime.
- **Liquid particles keep to the speed cap.** Cohesion was added after the cap, so at extreme settings a particle could reach 48 pixels a frame; the cap now comes last.
- **Docs:** sharp advection blurs less smoke away, so a one-shot gas needs more `dissipation` to end empty.
- **Depth bands under overhangs.** Liquid whose column starts right under a wall or obstacle took its depth from there, so water under an overhang showed a surface highlight deep in the pool (a pale block in the waterfall's basin). It now takes the depth of the nearest open water along the row; a drop hanging under a rock, with no open water beside it, keeps its own highlight.
- **Waterfall polished** for the corrected collisions, after blind reviews of a cliff-hugging curtain against an arc: the water now leaves the lip in one unbroken, foaming arc into the middle of the basin, and the spray rises where it actually lands instead of over calm water.

### Particle effects

- An emitter's vertical `sway` no longer draws a particle resting on its `floor` below it.

### Export fixes

- **GIF holes stay clear outside browsers.** A frame that is cleared after it is shown (because the next one is transparent where it is not) named no transparent index when it had no transparent pixels of its own, such as an opaque first frame. Browsers clear it anyway, but Pillow, and ffmpeg with a shared colour table, restore the background colour, so the next frame's holes showed opaque black. Such a frame now names the transparent index, or a spare entry of its own table; a frame that uses all 256 entries of its own table has none to spare, and the GIF's `notes` say so. The tests' own GIF decoder now reads disposal the strict way, which also caught this in two existing tests.
- **H.264 keeps every colour.** The `h264` command used 4:2:0, which stores colour once for each 2 × 2 pixels: at an odd scale or offset the colours of neighbouring sprite pixels mixed even in ffmpeg's own decoder, and at any scale once a player interpolates the colour (bicubic: up to 34% of sprite pixels off the palette). It is now lossless 4:4:4 (`-qp 0 -pix_fmt yuv444p`), exact to within 1 level and no larger for pixel art, and works on canvases of odd size. QuickTime, Safari and Windows' own players may not play 4:4:4, so on an even canvas `h264Compatible` keeps the previous 4:2:0 command, writing `<name>-yuv420.mp4`. `scripts/verify-exports.py` checks the new command with ffmpeg at an odd scale.
- **`drawFrame` snaps to whole pixels.** Fractional positions drew a frame between pixels, and Chromium blended its edges into semi-transparent pixels even with smoothing off. The bundled runtime now rounds the position first.

### Claude Code plugin

- **Install in one command:** `claude plugin install pixelbolt --marketplace skulitom/Pixelbolt` (Claude Code 2.1.292 or later) installs the MCP server and the pixel art skill. The plugin (`.claude-plugin/`) runs the checkout's own `bin/pixelbolt.js` with the user's Node.js 20 or later, in the project folder Claude Code has open, so there is nothing to download or build.
- **MCP:** every tool now has a `title` annotation, and `pixel_help` also declares `destructiveHint`, `idempotentHint` and `openWorldHint`. The server's `instructions` begin with when to use Pixelbolt and when not (photos, vector logos, full-resolution illustrations), and say it runs locally with no account and no API key. Tool names, inputs and outputs are unchanged.
- **Skill:** `skills/pixel-art` describes itself in the words a user would use, and says what to do when the plugin's tools are missing.
- **Evals:** `evals/` holds a `claude plugin eval` suite: three requests that should choose Pixelbolt and one (a vector logo) that must not, with every tool mocked from the real `tools/list`.

### Live fluids

- **`createLiveFluid(source, { effect, warmup })`** in `src/fluid.js`, exported from the package and from `pixelbolt/fluid`, runs one effect of a fluid source live, a frame at a time, for interactive pages:
  - `step(n)` advances it;
  - `push` stirs the flow with a soft disc, and `puff` adds or takes away smoke, heat or water;
  - `boost` scales a named emitter for some frames;
  - `render()` returns `{ rgba, keys }`, drawn with the effect's own look, sparks, whitewater and obstacles.
- It shares the compiler's simulation and makes the same checks as `compileFluid` before simulating, with the same error paths. Pointer inputs out of range are clamped rather than refused, and live runs don't stop at the particle or spark limits. The same calls give the same pixels in Node, Chromium, Firefox and WebKit, and golden hashes of two scripted sessions check that on every CI system. A 128 × 60 steam plume steps in about 7–9 ms on a desktop CPU.
- `compileFluid`'s output is unchanged: its golden hashes and the showcase GIFs are byte-identical.
- **Docs:** [live fluids](docs/art-workflow.md#live-fluids) in the art workflow guide, with a note in the authoring guide.

### Pixelbolt Studio

- The portable Studio no longer ships `AGENTS.md` or `llms.txt`. Both are written for contributors working in a checkout, and a user's coding agent in the Studio folder would read `AGENTS.md`'s maintainer rules as its own. The npm package still ships them, and README links to both on GitHub.

## 0.9.0 (2026-10-18)

### Fluid effects

- **A new source format, `pixelforge-fluid`** ([fluid.schema.json](fluid.schema.json)), compiled by `src/fluid.js` (`compileFluid`). It runs a small fluid simulation and bakes every frame into one palette `grid` operation plus `stamp`s for obstacles. The result is an ordinary recipe, so it inspects, patches, overlays and exports unchanged, and a colour outside the palette cannot appear. The grid has one cell per canvas pixel, up to 128 × 128.
- **Gases** (smoke, fire, steam, explosions, magic) use stable fluids on a staggered grid:
  - semi-Lagrangian advection and a fixed-iteration pressure solve;
  - vorticity confinement, and buoyancy from temperature;
  - dissipation, cooling, drag and wind.
- **Liquids** (splashes, waterfalls, drips, potions) use FLIP particles on the same grid and pressure solve, with gravity, cohesion (`tension`), fills, drains and closed walls.
- **Obstacles** come from symbols, drawn in front of the fluid, behind it, or not at all.
- **Emitters** are discs or boxes:
  - a `burst` once, or a `rate` until `end` that holds its cells at the given amounts;
  - `velocity` (an explicit `[0, 0]` holds water still), `vortex` and `expand` (gas expands through the pressure solve);
  - seeded `noise` and per-cell `flicker`, a `pulse` and an `orbit`.
- **Emitters:** `falloff` makes an emitter's amounts fall off from its centre toward its rim, so one emitter makes a round puff (the smoke puff now needs 5 emitters instead of 15). An orbit's `radius` may be `[x, y]` for an ellipse, so what it leaves behind stretches and squeezes as it turns. An orbiting rate emitter is laid along the path it covered since the last frame, so a fast orbit leaves a smooth trail instead of beads; this changes the output of orbiting emitters.
- **Sparks** are small particles carried by the flow and drawn over it: embers, debris, sparkles, spray that ends where it falls back into the water, and bubbles that burst at the surface in a ring and two droplets. Each has its own colours, `size` and an optional `trail`.
- **Whitewater** (`whitewater` on liquid effects): spray and foam thrown off the water by its own motion, where a particle at the surface changes speed sharply (`impact`: a drop landing) or moves fast (`speed`: a stream shedding drops). Droplets are sparks tipped away from the water; spray is drawn once it has left the water, and foam rides the flow. The splash now throws its crown this way instead of from emitters timed to the impact, and the waterfall froths with foam that rides its surface.
- **Look layers** map a field onto palette colours through rising thresholds and an ordered dither anchored to the canvas. The fields are `density`, `temperature`, `speed`, `depth` (from the liquid surface), and `light` and `shadow` (rims facing toward or away from a light). De-Stray and De-Corner cleanup and a one-pixel outline are optional.
- **Depth bands stay level:** below a liquid's first two rows, `depth` follows the shallowest surface within three pixels along the row, so a landing drop or a rising crest no longer pushes a dark column down through the bands beneath it.
- **Seamless loops:** forcing repeats every cycle. The simulation warms up for whole cycles and blends the fields (not the pixels) of its closing frames toward the frames before frame 0. Sparks that outlive the cycle wrap round. The inspector's loop-boundary check is quiet on every looping example.
- **Deterministic:** only `+ − × ÷` and square roots, `craft.js` trigonometry and seeded hashing, a fixed timestep and fixed iteration counts. Golden hashes check the ten presets on every CI system, and the browser produces the same recipes as Node.
- **Everywhere:**
  - `pixelbolt compile`, `preview` and `sequence` accept fluid sources;
  - MCP `pixel_compile` compiles them and `pixel_help` serves `topic: "fluid"`;
  - `compileFluid` is exported from the package and from `pixelbolt/fluid`.
- **Ten presets** in `examples/*.fluid.json`: campfire, smoke puff, explosion, steam vent, magic swirl, torch, splash, waterfall, drip and bubbling potion. Each compiles in well under a second (0.02–0.32 s on a laptop CPU). The README shows them as GIFs, built with `node showcase/fluid/build.mjs`.
- **Presets polished** after an independent art review: the splash drop falls with weight and its crater springs back, the drip speeds up as it falls, the waterfall runs as a shallow stream over the brink with a steady overflow, the potion's surface rocks, explosion debris leaves from the rim and its smoke thins away, steam puffs roll into rounded caps and fade before the top edge, and the magic swirl's eye no longer strobes.
- **Bounded:**
  - at most 32,768 liquid particles and 4,096 sparks alive at once;
  - flows no faster than 32 pixels per frame;
  - a work budget of about 400 million cell updates per source.

  Going over the particle, spark or work limit is an error naming the effect; the speed cap only clamps.
- **Fluid lab:** a studio page (`/fluid.html`) that compiles a preset in the browser, with sliders. It downloads the GIF, the sprite sheet, the recipe and the edited source, and shows the matching command-line and MCP calls.
- **Docs:** a "Fluid effects" section in [docs/art-workflow.md](docs/art-workflow.md#fluid-effects), with notes in the authoring guide, the pixel-art skill, the README and `llms.txt`.
