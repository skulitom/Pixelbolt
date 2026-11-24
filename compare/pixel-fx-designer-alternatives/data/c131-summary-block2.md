> Machine summary of block 2 of the agent bench on https://skulitom.github.io/Pixelbolt/compare/pixel-fx-designer-alternatives/#agent-bench . Ids such as C-131, C-147 and amendment numbers refer to the bench's own plan records.

# C-131 block 2: summary

## Run b2a
- Dropped tasks: none; jobs scored 64
- Delivered: Pixelbolt 32, pixelfx 32
- Judged pairs 32: Pixelbolt 7, pixelfx 21, ties 4 (sign p 0.013, descriptive)
- By default: ; neither 0; unjudged 0; flagged display 0
- haiku: Pixelbolt 4, pixelfx 10, ties 2; unjudged 0
- sonnet: Pixelbolt 3, pixelfx 11, ties 2; unjudged 0
- Model IDs and client per model: [('haiku', 'claude-haiku-5-5', '2.1.302'), ('sonnet', 'claude-sonnet-5-5', '2.1.302')]

## Run b2b
- Dropped tasks: none; jobs scored 64
- Delivered: Pixelbolt 32, pixelfx 32
- Judged pairs 32: Pixelbolt 8, pixelfx 20, ties 4 (sign p 0.036, descriptive)
- By default: ; neither 0; unjudged 0; flagged display 0
- haiku: Pixelbolt 4, pixelfx 12, ties 0; unjudged 0
- sonnet: Pixelbolt 4, pixelfx 8, ties 4; unjudged 0
- Model IDs and client per model: [('haiku', 'claude-haiku-5-5', '2.1.302'), ('sonnet', 'claude-sonnet-5-5', '2.1.302')]

## The rule (runs b2a and b2b)
- Cells (task x model) with a judged pair: 32 of 32; net positive for Pixelbolt 5, for pixelfx 21, zero 6; two-sided sign p = 0.0025
- Delivered over both runs: Pixelbolt 64, pixelfx 64
- **rule met: pixelfx over Pixelbolt**
- Robustness (not part of the rule): per task, Pixelbolt ahead in 3, pixelfx in 12, even 1 (sign p 0.035)
- Robustness: without flagged-display pairs, cells net positive for Pixelbolt 5, for pixelfx 21 (sign p 0.002)
- How two orders combine: an arm wins a pair only if it wins both orders; a split or any Tie is a tie.

| task | haiku net | sonnet net |
|---|---|---|
| E01 | -2 | -2 |
| E02 | -2 | -2 |
| E03 | -2 | -2 |
| E04 | -2 | -2 |
| E05 | -2 | -1 |
| E06 | 2 | 2 |
| E07 | -1 | 0 |
| E08 | 0 | -1 |
| E09 | 0 | 0 |
| E10 | -1 | -2 |
| E11 | 0 | 2 |
| E12 | -2 | -2 |
| E13 | -2 | -1 |
| E14 | -2 | -1 |
| E15 | 2 | 2 |
| E16 | 0 | -2 |
