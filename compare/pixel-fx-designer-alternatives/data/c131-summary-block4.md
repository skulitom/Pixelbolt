> Machine summary of block 4 of the agent bench on https://skulitom.github.io/Pixelbolt/compare/pixel-fx-designer-alternatives/#agent-bench . Ids such as C-131, C-147 and amendment numbers refer to the bench's own plan records.

# C-131 block 4: summary

## Run b4a (judged against block 2's pixelfx results; block 3's pair: b3a)
- Dropped tasks: none; jobs scored 64
- Delivered: Pixelbolt 32, pixelfx 32
- Judged pairs 32: Pixelbolt 21, pixelfx 4, ties 7 (net 17)
- By default: none; neither 0; unjudged 0; flagged display 0
- haiku: Pixelbolt 12, pixelfx 0, ties 4
- sonnet: Pixelbolt 9, pixelfx 4, ties 3
- Model IDs and client per arm and model: [('pixelbolt', 'haiku', 'claude-haiku-5-5', '2.1.302'), ('pixelbolt', 'sonnet', 'claude-sonnet-5-5', '2.1.302'), ('pixelfx', 'haiku', 'claude-haiku-5-5', '2.1.302'), ('pixelfx', 'sonnet', 'claude-sonnet-5-5', '2.1.302')]
- Judge model IDs: [('claude-opus-5-5', '2.1.302')]; maker model ID flags: none

## Run b4b (judged against block 2's pixelfx results; block 3's pair: b3b)
- Dropped tasks: none; jobs scored 64
- Delivered: Pixelbolt 32, pixelfx 32
- Judged pairs 32: Pixelbolt 21, pixelfx 6, ties 5 (net 15)
- By default: none; neither 0; unjudged 0; flagged display 0
- haiku: Pixelbolt 11, pixelfx 2, ties 3
- sonnet: Pixelbolt 10, pixelfx 4, ties 2
- Model IDs and client per arm and model: [('pixelbolt', 'haiku', 'claude-haiku-5-5', '2.1.302'), ('pixelbolt', 'sonnet', 'claude-sonnet-5-5', '2.1.302'), ('pixelfx', 'haiku', 'claude-haiku-5-5', '2.1.302'), ('pixelfx', 'sonnet', 'claude-sonnet-5-5', '2.1.302')]
- Judge model IDs: [('claude-opus-5-5', '2.1.302')]; maker model ID flags: none

## Block 4's rules (PLAN-block4.txt; runs b4a and b4b)
- **D, delivery: PASS**: Pixelbolt delivered 64 of 64 scored (needs at least 62) and pixelfx 64 (needs at least 62)
- **L, the look moved: FAIL**: median native longest side 80.0 (needs 96); median native drawn side 67.5 (needs 72); median frames 16.0 (needs 20); jobs with a partly transparent pixel 26 (needs 32)
  - haiku (shown, not deciding): median native longest side 76.0 (needs 96); median native drawn side 64.0 (needs 72); median frames 20.5 (needs 20); jobs with a partly transparent pixel 13 (needs 16)
  - sonnet (shown, not deciding): median native longest side 96.0 (needs 96); median native drawn side 71.0 (needs 72); median frames 16.0 (needs 20); jobs with a partly transparent pixel 13 (needs 16)
- **H, half the gap: PASS**: {"pairs": 64, "N3": -17, "N4": 32, "move": 49, "closed_share": 2.882, "half_needs_N4_at_least": -8.5, "m": 0.1875, "s": 3.464, "s_1_645": 5.698, "flip_rate": 0.1875}
  (N3, N4: pair nets of block 3 and block 4 on the cells judged, or decided by default at +1 or -1, in both (amendment 1121); half the gap needs N4 >= N3 / 2 and a move N4 - N3 over s = sqrt(pairs x m), m from the noise check)
- Noise check: 16 pairs re-judged; agree 13, winner flipped 0, win<->tie 3; flip rate 0.1875; m 0.1875
- **Outcome: D passes, H passes: the pooled bar is met beyond the judge's own noise; what may be claimed is the split's pre-registered reading below (amendment 1121); L fails (the release's results don't have the larger, longer, softer look)**

## The split (amendments 1120 and 1121; shown, the pooled rules decide)
- **MATCHED (10 tasks with a preset added in 0.18.0)**: L facts: median native longest side 96.0 (needs 96); median native drawn side 91.0 (needs 72); median frames 19.0 (needs 20); jobs with a partly transparent pixel 22 (needs 20)
  - H on these pairs: PASS: {"pairs": 40, "N3": -27, "N4": 24, "move": 51, "closed_share": 1.889, "half_needs_N4_at_least": -13.5, "m": 0.1875, "s": 2.739, "s_1_645": 4.505, "flip_rate": 0.1875}
  - haiku: jobs 20; the task's own preset: compiled by name (a lower bound) 16, named, looked up or read 8; compiled any preset 17
  - sonnet: jobs 20; the task's own preset: compiled by name (a lower bound) 18, named, looked up or read 3; compiled any preset 20
- **UNMATCHED (6 tasks)**: L facts: median native longest side 48.0 (needs 96); median native drawn side 48.0 (needs 72); median frames 11.5 (needs 20); jobs with a partly transparent pixel 4 (needs 12)
  - H on these pairs: undefined (block 3 had no gap on these pairs): {"pairs": 24, "N3": 10, "N4": 8, "move": -2}
  - haiku: jobs 12; the task's own preset: compiled by name (a lower bound) 0, named, looked up or read 0; compiled any preset 4
  - sonnet: jobs 12; the task's own preset: compiled by name (a lower bound) 0, named, looked up or read 0; compiled any preset 6
- **The parts (always reported, amendment 1121):** pooled N3 -17 -> N4 32 on 64 pairs (H PASS); on the 10 MATCHED tasks N3m -27 -> N4m 24 on 40 pairs (closed share of their own gap 1.889; their own H PASS); on the 6 UNMATCHED tasks N3u 10 -> N4u 8 on 24 pairs (fell by 2, within the judge's own noise for 24 pairs (s 2.121))
- **Reading (pre-registered, amendment 1121):** Pixelbolt 0.19.0 (block 4, run on 23 November 2026) closes half the gap, beyond the judge's own noise, on the 10 effects Pixelbolt added presets for after this comparison (N3m -27 -> N4m 24); on the other 6 tasks, which had no gap to close, it fell by 2, within the judge's own noise for 24 pairs (s 2.121); pixelfx (0.3.1, results of 12 November 2026) got no such tuning
- No general claim from this block: Pixelbolt was already ahead on the 6 unmatched tasks in all four earlier runs (+2, +6, +5, +5), so they had no gap to close; they can show a fall, never a gain.
- Any public sentence says "beyond the judge's own noise" (never "beyond noise"), names the split, Pixelbolt 0.19.0 (block 4, run on 23 November 2026) and pixelfx (0.3.1, results of 12 November 2026), and says pixelfx got no such tuning.

## Block 2's claim rule and C-147 item 3 (as in block 3; shown, not block 4's decision)
- Cells with a judged pair: 32; net positive for Pixelbolt 24, for pixelfx 6, zero 2; two-sided sign p = 0.0014: **rule met: Pixelbolt over pixelfx**
- C-147 item 3 part 1 (even with or ahead): **PASS**; part 2: holds by construction (64 of 64)
- Per task (robustness): Pixelbolt ahead in 11, pixelfx in 3, even 2 (sign p 0.057)
- Judge model IDs over the runs: [('claude-opus-5-5', '2.1.302')]

| run | task | haiku b3 | haiku b4 | sonnet b3 | sonnet b4 |
|---|---|---|---|---|---|
| b4a | E01 | -1 | 0 | -1 | -1 |
| b4a | E02 | -1 | 1 | 0 | 0 |
| b4a | E03 | -1 | 1 | -1 | 0 |
| b4a | E04 | 1 | 1 | -1 | 1 |
| b4a | E05 | -1 | 1 | 0 | 1 |
| b4a | E06 | 0 | 0 | 1 | 1 |
| b4a | E07 | 0 | 1 | -1 | 0 |
| b4a | E08 | 1 | 1 | 1 | -1 |
| b4a | E09 | 1 | 0 | -1 | -1 |
| b4a | E10 | -1 | 1 | 0 | -1 |
| b4a | E11 | 0 | 0 | 1 | 1 |
| b4a | E12 | 0 | 1 | -1 | 1 |
| b4a | E13 | -1 | 1 | -1 | 1 |
| b4a | E14 | 0 | 1 | -1 | 1 |
| b4a | E15 | 1 | 1 | 1 | 1 |
| b4a | E16 | -1 | 1 | 0 | 1 |
| b4b | E01 | -1 | -1 | -1 | -1 |
| b4b | E02 | -1 | 1 | 1 | 1 |
| b4b | E03 | -1 | 1 | -1 | 0 |
| b4b | E04 | -1 | 1 | -1 | 1 |
| b4b | E05 | -1 | 0 | -1 | 1 |
| b4b | E06 | -1 | 1 | 1 | 0 |
| b4b | E07 | -1 | 0 | 1 | -1 |
| b4b | E08 | 1 | 1 | -1 | -1 |
| b4b | E09 | 1 | -1 | 1 | 1 |
| b4b | E10 | -1 | 0 | -1 | -1 |
| b4b | E11 | 0 | 1 | 1 | 1 |
| b4b | E12 | -1 | 1 | -1 | 1 |
| b4b | E13 | -1 | 1 | -1 | 1 |
| b4b | E14 | 0 | 1 | -1 | 1 |
| b4b | E15 | 1 | 1 | 1 | 1 |
| b4b | E16 | -1 | 1 | 1 | 1 |
