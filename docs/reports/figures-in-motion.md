# Figures in motion

Implementation of the 20 October 2026 plan. The full goal covers M0–M5; completion of M0 is not completion of the bone/motion features.

## Accepted scope and decisions — 2026-10-20

- The owner requested implementation, a persistent goal, and commit/push to `main` when ready.
- The owner subsequently waived the outside-review instructions as unnecessary. External reviewers, voting thresholds, the 18-attempt blind comparison and a separate approval for that review are not delivery blockers. Automated craft/motion checks, performance targets, visual inspection and honest reporting remain required. No blind-review preference or score is claimed.
- The owner chose stable opaque pixel area over an exact ellipse under squash. A 12×7 outlined ellipse otherwise grows from 95 to 115 pixels at squash 0.5. Masses therefore use the closest ellipse-ranked contour to the unsquashed opaque area, including its outline.
- New pose fields remain optional version-1 additions; `rotate` retains its absolute meaning. Studio scope is preview, motion inspection and contact overlays.
- The existing untracked `.claude/` folder is unrelated and is preserved.
- M0 lands independently after its gate. Subsequent work continues on `figures-in-motion` and lands when verified under the owner's direct authorization.

## M0 — 2026-10-20 — passed

Baseline code: `862de088f3b23c4bef30f96fb0ff0833895ad340`. Implementation commit: `e0ad3a1511ef4bb7f1f3d83c1bc64b06730d0531`, **Speed up sparse pose layers without changing rendered pixels**, pushed to `main`.

The renderer tracks conservative bounds of all layer writes, composites only those bounds and reuses one scratch buffer per frame. It still executes global operations against the complete canvas, validates invisible layers, preserves hidden RGB semantics and counts clipping. Named layers remain available for isolation. `renderProject(recipe, {stats: true})` reports total charged drawing pixels, layer compositing pixels and operation count; normal calls retain their existing output shape.

Pose compilation validates its emitted stamp subset and builds timing from frame descriptions. Header, animation and atlas validation are shared with rendering. Trimmed atlas bounds are computed from symbol coverage, including clipping and flips, without rendering full frames.

### Performance evidence

Measured on the reference machine: Ryzen 9 7950X3D, 63 GiB reported RAM, Windows 11, Node 24.19.0. Each timing is the median of 15 runs after 3 warmups. Exact data, including p95, are preserved in [before](figures/m0-before.json) and [after](figures/m0-after.json). Synthetic fixtures are now reproducible in `scripts/pose-fixtures.mjs`; the plan's original ad hoc fixture generator was not present.

| Case | Compile before → after | Render before → after | M0 rendering gate | Result |
| --- | --- | --- | --- | --- |
| Existing skink | 2.058 → 0.519 ms | 1.389 → 0.345 ms | Record baseline | Pass |
| 64 px, 16 stamps, 24 poses | 34.215 → 1.402 ms | 31.960 → 1.383 ms | ≤ 4.65 ms (1.5 × plan's 3.1 ms) | Pass |
| 128 px, 32 stamps, 96 poses | 972.287 → 10.112 ms | 968.267 → 12.800 ms | ≤ 54 ms (1.5 × plan's 36 ms) | Pass |
| 256 px, 64 stamps, 32 poses | Budget error → 6.509 ms | Budget error → 9.100 ms | No canvas-times-layers rejection | Pass |

The 128 px fixture charges 184,320 drawing pixels (0.275% of 67,108,864); the 256 px fixture charges 122,880. Increasing only the canvas from 64 to 256 leaves stamp work unchanged. Merged-op references remain pixel-identical, with median renders of 0.914 ms and 8.739 ms at 64/128 px. Bone-rig R1–R3 targets are not measured or claimed yet.

### Verification

- Before edits: 257 tests passed in 11.312 s.
- After implementation: 273 tests passed. Verification runs took 11.706 s, 13.816 s and 11.700 s; the slower run overlapped a repository fetch, and an uncontended rerun returned to 11.700 s (0.388 s above baseline). Every new individual test was under 83 ms in the slower run. The ≤2 s suite-growth and ≤500 ms individual-test targets pass in the uncontended measurement; total suite time is sensitive to the existing portable-build tests.
- All 87 existing on-disk recipes/pose sources under `examples/` and `showcase/`, including inline recipes in JSON, retain all 861 per-frame RGBA hashes, animation timelines and full pose compilation hashes. There was no pre-existing `test/fixtures/` directory. New tests also cover the inline regression fixtures.
- The baseline was recorded before changing `src/core.js`; no expected hash was changed. `node scripts/check-figure-baseline.mjs` checks it without rewriting it. New snapshots require a new destination.
- Tests compare bounded layers against independent full-canvas compositing, including fill, replace, rewrite, outline, copy, shade, hidden RGB, clears, opacity, invisible layers and offsets. Stamp validation tests cover timing, invalid fields, names, palettes, coordinates, atlas limits and exact clipped/trimmed layouts.
- The runtime, schemas, drawing operations and binary encoders are unchanged. [CI run 39435581740](https://github.com/skulitom/Pixelbolt/actions/runs/39435581740) passed all Node 20/22/24 Ubuntu tests and Node 24 Windows/macOS tests. Two portable macOS packaging jobs were initially cancelled before running any steps; the failed-job rerun is tracked separately.

### Visual evidence

Inspected the native and enlarged sheets, silhouettes and every frame of the moving-ground strip. The old skink retains its pointed ears, long tail, bright charm and small leg shapes. The two contact poses have very similar silhouettes; M0 does not improve that motion.

- [Native run sheet](../images/figures/m0-skink-native.png)
- [4× run sheet](../images/figures/m0-skink-4x.png)
- [Silhouette sheet](../images/figures/m0-skink-silhouette.png)
- [Moving-ground GIF](../images/figures/m0-skink-ground.gif)
- [Every GIF frame in a strip](../images/figures/m0-skink-ground-strip.png)

The GIF uses a camera-relative ground reference moving at 48 px/s and y=26. The old source declares no foot contacts or ground height, so this is a playback reference, not a measured ground-contact verdict. All six GIF delays match the original 90/80/80/90/80/80 ms and no partial alpha is lost. `scripts/figure-evidence.mjs` creates these new evidence files and refuses to overwrite them.

## Remaining milestones

- M1: implemented and verified below.
- M2: hierarchy, reach, views, angular tweens, relit mirrors and a separate bone skink.
- M3: contact markers and quantitative motion inspection through CLI/MCP.
- M4: six editable motion templates and R2/R3 fixtures.
- M5: documentation/skill/examples, studio inspection, export verification and final evidence. External blind review is waived as recorded above.

## M1 — 2026-10-20 — primitive gate passed

`rasterizeBone` draws a clean stepped spine, tapered or bulged fill, world-facing ramp bands, four cap types and an external outline. `rasterizeMass` maintains opaque pixel area under squash using the owner's contour decision above. Both return exact attachment coordinates and masks for inspection. Compilation bakes ordinary palette-row symbols and stamp operations; grids and plain mirrors retain their existing behavior. The pose schema includes the same optional fields as validation. Tidewatch's bundled copy of `craft.js` is synchronized; none of its art changed.

Snapped endpoints quantize the major axis first and derive the minor coordinate from the clean integer ratio. This keeps short spines on that ratio. Two-pixel bones keep their attachment endpoints and permit De-Corner to shave an interior elbow. Neither adjustment alters grid parts or legacy poses.

### Checks

- All 318 tests pass in 11.543 s, compared with 11.312 s before M0. The 45 new M1 tests fit the suite-growth budget; the individual craft groups remain below 500 ms.
- The angle matrix covers 360 whole-degree angles × widths 1–6 × lengths 3–16; all four start/end cap combinations are also checked across 360 angles. Tests check palette closure, De-Corner stability, fill strays, stepping, mid-width tolerance, highlight direction and retained joint endpoints.
- Masses cover every 0.05 squash step from 0.5 through 2.0 at four angles, for sizes 2×2, 3×6, 12×7, 16×12 and 64×64. Opaque area remains within 10%.
- Additional tests cover unoutlined/selective outlines, flips, unsnapped tapers, squash interpolation, shared baked variants, invalid-field paths, schema alignment and forbidden native mathematics.
- The complete M0 baseline still matches: 87 source documents, 861 frame hashes and all old pose compiler metadata. Existing golden values were not updated.
- An initial full run correctly failed because Tidewatch's bundled helper copy was stale; it passed after synchronizing that file.

### Performance

The [verified measurement](figures/m1-verified-bench.json) preserves the same 3-warmup, 15-run protocol and machine information. The specified 64-pixel, width-16 bone at its default angle takes **0.036 ms median**, **0.044 ms p95** during the compiler workflow, passing the 0.05 ms target. The 101-frame primitive fixture compiles in 3.296 ms and renders in 1.640 ms.

This is a warmed workflow measurement, not a cold-start claim: the same bone before any compiler work takes 0.273 ms median. A 37° bone takes 0.098 ms median. Those additional probes are reported explicitly; they do not meet 0.05 ms. The first slower implementation and intermediate measurements are preserved alongside the verified measurement. Whole-rig budgets remain to be verified in M2/M4.

### Visual evidence

Inspected every native sheet, enlarged sheet, silhouette and frame of the ground strip. Thin strokes step evenly; wider bones carry a warm light band above and left; socket ends visibly open their outline. Squashed masses keep their pixel area but very small/extreme contours can be asymmetric by one pixel, as expected from the discrete-area choice. The files still match freshly generated output after the optimizations.

| Primitive | Native | 4× | Silhouette |
| --- | --- | --- | --- |
| Bones | [Sheet](../images/figures/m1-bones-native.png) | [Sheet](../images/figures/m1-bones-4x.png) | [Sheet](../images/figures/m1-bones-silhouette.png) |
| Masses | [Sheet](../images/figures/m1-masses-native.png) | [Sheet](../images/figures/m1-masses-4x.png) | [Sheet](../images/figures/m1-masses-silhouette.png) |
| Caps | [Sheet](../images/figures/m1-caps-native.png) | [Sheet](../images/figures/m1-caps-4x.png) | [Sheet](../images/figures/m1-caps-silhouette.png) |

[Primitive GIF](../images/figures/m1-ground.gif) and [all 20 frames](../images/figures/m1-ground-strip.png). The moving ground is a visual reference at 48 px/s, y=47, with 100 ms frames. These isolated rotating/squashing parts do not claim locomotion or foot contact. Character readability and joint seams remain M2/M3 work.
