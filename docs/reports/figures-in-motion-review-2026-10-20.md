# Figures in motion: implementation review

The owner explicitly waived outside reviewers and the associated review process. There are no blind-review votes, preference percentages, comparative art scores or nine-attempt authoring-cost statistics. Those measures are **not performed**, rather than passed. The owner's request authorizes commit and push to main after engineering verification.

The implementation covers bone/mass rasterization, relative joints and integer reach, motion review, six editable motion templates, CLI/MCP support, a pose-aware studio, examples and authoring documentation. Existing version-1 pixels and legacy pose metadata are unchanged across the captured baseline: 87 recipes and 861 frames.

The [milestone report](figures-in-motion.md) records the implementation, decisions, failures and corrections. It includes the approved departures from exact ellipse contours (stable pixel area takes priority) and whole-limb four-connectivity (clean diagonals with locally connected joints).

## Evidence

- Automated craft and motion tests cover R1–R3, all template frames, angle sweeps, seams, contacts, unreachable targets and error paths. Compiled JSON and every figure frame have pinned hashes.
- [Reference benchmark](figures/m4-final-bench.json): R1/R2/R3 compile medians 4.238 / 13.296 / 61.558 ms; R2/R3 render medians 3.693 / 32.859 ms. R2 expansion is 1.599 ms and image-inclusive motion review 7.345 ms. Strict targets pass. The 64×16 bone's 0.002 ms median is warmed cache performance; the cold call is reported separately.
- R2 recipe size is 73,801 bytes, full MCP compile response with metadata 201,417 bytes. R3 uses 926,140 charged pixels and compiles inside a 60 MiB total V8 heap ceiling.
- Browser QA passes 35 checks, including source open/save/reopen, playback, contact overlays, motion review, bad input recovery, downloads and narrow layout. [Browser hashes](figures/m5-browser-hashes.json) match complete R1–R3 compiled JSON and all 148 RGBA frames.
- [Edit latency](figures/m5-edit-latency.json): 54.7 ms median and 75.9 ms p95 in Edge, including debounce, compilation, DOM updates and a paint. Strict target: p95 ≤100 ms; CI ceiling: 500 ms.
- `python scripts/verify-bones.py` independently decodes R2's PNG sheet and 40 GIF playback entries across all five animations with Pillow. RGBA and delays match exactly. The existing `verify-exports.py` also passes.
- The generated courier source, compiled recipe and metadata round-trip exactly; schemas regenerate unchanged and all 31 quality-lab files reproduce. MCPB builds twice byte-identically and its eight tools pass the bundle smoke checks.

## Visual inspection

All final M1–M4 native, enlarged, silhouette, moving-ground and motion-strip images were inspected. The [courier run](../images/figures/m4-craft-hero-run-4x.png) separates contact, down, passing and flight poses. Its [jump](../images/figures/m4-craft-hero-jump-4x.png) and [attack](../images/figures/m4-craft-hero-attack-4x.png) visibly change height and arm position. The teal shadow band was separated from the outline after the first visual pass. The guardian's extra limbs can still overlap densely; hand-authored replacements remain available.

The studio's [Motion view](../images/figures/m5-studio-motion.png), [contact overlay](../images/figures/m5-studio-contacts.png) and [narrow layout](../images/figures/m5-studio-narrow.png) were inspected. Motion displays pixel-valued slide/ground measurements and degree-valued loop joins alongside the strip. Contacts are shown as yellow marks at the feet.

These observations and passing numerical gates establish implemented behavior and pixel-craft constraints. They do not establish that independent artists prefer these figures to the old workflow.

Cross-platform CI and final landing are recorded in the final section of the milestone report.
