> Machine summary of block 3 of the agent bench on https://skulitom.github.io/Pixelbolt/compare/pixel-fx-designer-alternatives/#agent-bench . Ids such as C-131, C-147 and amendment numbers refer to the bench's own plan records.

# C-131 block 3: summary

## Run b3a
- Dropped tasks: none; jobs scored 64
- Delivered: Pixelbolt 32, pixelfx 32
- Judged pairs 32: Pixelbolt 8, pixelfx 15, ties 9 (sign p 0.210, descriptive)
- By default: ; neither 0; unjudged 0; flagged display 0
- haiku: Pixelbolt 4, pixelfx 7, ties 5; unjudged 0
- sonnet: Pixelbolt 4, pixelfx 8, ties 4; unjudged 0
- Model IDs and client per arm and model: [('pixelbolt', 'haiku', 'claude-haiku-5-5', '2.1.302'), ('pixelbolt', 'sonnet', 'claude-sonnet-5-5', '2.1.302'), ('pixelfx', 'haiku', 'claude-haiku-5-5', '2.1.302'), ('pixelfx', 'sonnet', 'claude-sonnet-5-5', '2.1.302')]
- Judge model IDs and client: [('claude-opus-5-5', '2.1.302')]
- Model ID flags (Pixelbolt job against block 2's same slot): none

## Run b3b
- Dropped tasks: none; jobs scored 64
- Delivered: Pixelbolt 32, pixelfx 32
- Judged pairs 32: Pixelbolt 10, pixelfx 20, ties 2 (sign p 0.099, descriptive)
- By default: ; neither 0; unjudged 0; flagged display 0
- haiku: Pixelbolt 3, pixelfx 11, ties 2; unjudged 0
- sonnet: Pixelbolt 7, pixelfx 9, ties 0; unjudged 0
- Model IDs and client per arm and model: [('pixelbolt', 'haiku', 'claude-haiku-5-5', '2.1.302'), ('pixelbolt', 'sonnet', 'claude-sonnet-5-5', '2.1.302'), ('pixelfx', 'haiku', 'claude-haiku-5-5', '2.1.302'), ('pixelfx', 'sonnet', 'claude-sonnet-5-5', '2.1.302')]
- Judge model IDs and client: [('claude-opus-5-5', '2.1.302')]
- Model ID flags (Pixelbolt job against block 2's same slot): none

## The rule (runs b3a and b3b)
- Cells (task x model) with a judged pair: 32 of 32; net positive for Pixelbolt 8, for pixelfx 18, zero 6; two-sided sign p = 0.0755
- Delivered over the runs: Pixelbolt 64 of 64, pixelfx 64 of 64
- **no rule met**
- **C-147 item 3, part 1 (even with or ahead): FAIL**: cells net positive for Pixelbolt 8 < for pixelfx 18; Pixelbolt delivered 64 >= pixelfx's 64 less 2
- **C-147 item 3, part 2 (spec-valid at least equal to no tool): holds by construction**: Pixelbolt delivered 64 of 64 scored jobs (2 runs)
- Judge model IDs over the runs: [('claude-opus-5-5', '2.1.302')]; model ID flags: 0
- Robustness (not part of the rule): per task, Pixelbolt ahead in 5, pixelfx in 11, even 0 (sign p 0.210)
- Robustness: without flagged-display pairs, cells net positive for Pixelbolt 8, for pixelfx 18 (sign p 0.076)
- How two orders combine: an arm wins a pair only if it wins both orders; a split or any Tie is a tie.

| task | haiku net | sonnet net |
|---|---|---|
| E01 | -2 | -2 |
| E02 | -2 | 1 |
| E03 | -2 | -2 |
| E04 | 0 | -2 |
| E05 | -2 | -1 |
| E06 | -1 | 2 |
| E07 | -1 | 0 |
| E08 | 2 | 0 |
| E09 | 2 | 0 |
| E10 | -2 | -1 |
| E11 | 0 | 2 |
| E12 | -1 | -2 |
| E13 | -2 | -2 |
| E14 | 0 | -2 |
| E15 | 2 | 2 |
| E16 | -2 | 1 |
