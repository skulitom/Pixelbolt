# Changelog

Releases before 0.9.0 are described on [GitHub Releases](https://github.com/skulitom/Pixelbolt/releases).

## Unreleased

### Live fluids

- **`createLiveFluid(source, { effect, warmup })`** in `src/fluid.js`, exported from the package and from `pixelbolt/fluid`, runs one effect of a fluid source live, a frame at a time, for interactive pages:
  - `step(n)` advances it;
  - `push` stirs the flow with a soft disc, and `puff` adds or takes away smoke, heat or water;
  - `boost` scales a named emitter for some frames;
  - `render()` returns `{ rgba, keys }`, drawn with the effect's own look, sparks, whitewater and obstacles.
- It shares the compiler's simulation and checks sources exactly as `compileFluid` does. The same calls give the same pixels in Node, Chromium, Firefox and WebKit, and golden hashes of two scripted sessions check that on every CI system. A 128 × 60 steam plume steps in about 7–9 ms on a desktop CPU.
- `compileFluid`'s output is unchanged: its golden hashes and the showcase GIFs are byte-identical.
- **Docs:** [live fluids](docs/art-workflow.md#live-fluids) in the art workflow guide, with a note in the authoring guide.

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
