# How much the judge alone moves: block 2's Sonnet pairs judged again

*Run on 17 November 2026 (32 judge calls). Part of the agent bench on https://skulitom.github.io/Pixelbolt/compare/pixel-fx-designer-alternatives/#agent-bench*

**What was done:** block 2's 16 Sonnet pairs of run `b2a` (Pixelbolt 0.15.0 against pixelfx 0.3.1) were judged
again, both orders, by a fresh Opus judge call each: the same images (all 128 decoded pixel-identical to block 2's,
checked free first), the same prompt and the same first-shown parity. Two differences, on purpose: the call's budget
line was $0.30 (block 2: $0.80; block 3 and block 4 use $0.30), and calls ran one at a time. Ran 15:06-15:14 UTC.

**Result:** 13 of 16 pairs got the same verdict; no winner flipped; 3 moved between a win and a tie (E05 and E14
from pixelfx to a tie, E07 from a tie to pixelfx). 29 of 32 single orders picked the same arm. Net (+ Pixelbolt):
block 2 -8, again -7. The mean squared change of a pair's outcome is m = 0.1875, so the judge alone spreads a
block-to-block move by about s = 2.4 on 32 pairs (one run) and 3.5 on 64 (two runs).

**What it says about block 3 (our reading):** block 2's nets were -14 (b2a) and -12 (b2b), block 3's
-7 (b3a) and -10 (b3b): a move of +9 over 64 pairs, about 2.6 times the judge-only spread. So the judge being run
again explains little of block 3's smaller gap. Two limits: this measures the judge only, not how much new jobs on
the same release would differ; and m comes from Sonnet pairs, applied to Haiku's too.
