> Machine summary of block 1 of the agent bench on https://skulitom.github.io/Pixelbolt/compare/pixel-fx-designer-alternatives/#agent-bench . Ids such as C-131, C-147 and amendment numbers refer to the bench's own plan records.

### Run a

| model | arm | delivered | valid | valid without crisp | checks failed | used its tool | cost $ | median s | median turns | caps or errors |
|---|---|---|---|---|---|---|---|---|---|---|
| haiku | pixelbolt | 12/12 | 5 | 5 | background 3, content 4, motion 1 | 12 | 0.14 | 54.5 | 8.5 | 0 |
| haiku | pixelfx | 11/12 | 2 | 2 | files 1, size 9, frames 1, crisp 1, palette 1, background 1, content 1, motion 2 | 12 | 0.43 | 135.5 | 33.5 | 0 |
| haiku | without | 12/12 | 9 | 9 | background 2, content 1 | - | 0.14 | 63 | 13 | 0 |
| sonnet | pixelbolt | 12/12 | 8 | 8 | size 2, frames 2, background 2, content 1, motion 2 | 12 | 2.15 | 65 | 9.5 | 0 |
| sonnet | pixelfx | 12/12 | 9 | 9 | size 1, background 1, content 1 | 12 | 3.77 | 94.5 | 28 | 0 |
| sonnet | without | 12/12 | 10 | 10 | background 2 | - | 1.31 | 48 | 9.5 | 0 |
| all | pixelbolt | 24/24 | 13 | 13 | size 2, frames 2, background 5, content 5, motion 3 | 24 | 2.29 | 61 | 9 | 0 |
| all | pixelfx | 23/24 | 11 | 11 | files 1, size 10, frames 1, crisp 1, palette 1, background 2, content 2, motion 2 | 24 | 4.20 | 112 | 33 | 0 |
| all | without | 24/24 | 19 | 19 | background 4, content 1 | - | 1.45 | 56 | 11 | 0 |

| pair (A v B) | model | pairs | judged | A won | B won | ties | by default A/B | neither | unjudged | sign p | rule |
|---|---|---|---|---|---|---|---|---|---|---|---|
| pixelbolt v pixelfx | haiku | 12 | 12 | 5 | 4 | 3 | 0/0 | 0 | 0 | 1.0000 | - |
| pixelbolt v pixelfx | sonnet | 12 | 12 | 2 | 9 | 1 | 0/0 | 0 | 0 | 0.0654 | - |
| pixelbolt v pixelfx | all | 24 | 24 | 7 | 13 | 4 | 0/0 | 0 | 0 | 0.2632 | not met |

### Run b

| model | arm | delivered | valid | valid without crisp | checks failed | used its tool | cost $ | median s | median turns | caps or errors |
|---|---|---|---|---|---|---|---|---|---|---|
| haiku | pixelbolt | 12/12 | 6 | 6 | size 2, background 1, content 4, motion 1 | 12 | 0.16 | 51 | 14 | 0 |
| haiku | pixelfx | 12/12 | 2 | 2 | size 9, frames 1, crisp 1, palette 1, background 2, content 1 | 12 | 0.40 | 136 | 33.5 | 0 |
| haiku | without | 12/12 | 12 | 12 | none | - | 0.12 | 59.5 | 8 | 0 |
| sonnet | pixelbolt | 12/12 | 5 | 5 | size 3, frames 3, background 3, content 1, motion 3 | 12 | 2.15 | 54 | 9 | 0 |
| sonnet | pixelfx | 12/12 | 7 | 7 | size 2, background 3 | 12 | 3.71 | 108.5 | 26.5 | 0 |
| sonnet | without | 12/12 | 10 | 10 | background 1, content 1 | - | 1.14 | 44 | 7.5 | 0 |
| all | pixelbolt | 24/24 | 11 | 11 | size 5, frames 3, background 4, content 5, motion 4 | 24 | 2.31 | 51 | 10.5 | 0 |
| all | pixelfx | 24/24 | 9 | 9 | size 11, frames 1, crisp 1, palette 1, background 5, content 1 | 24 | 4.11 | 118 | 31.5 | 0 |
| all | without | 24/24 | 22 | 22 | background 1, content 1 | - | 1.26 | 49 | 8 | 0 |

| pair (A v B) | model | pairs | judged | A won | B won | ties | by default A/B | neither | unjudged | sign p | rule |
|---|---|---|---|---|---|---|---|---|---|---|---|
| pixelbolt v pixelfx | haiku | 12 | 12 | 4 | 5 | 3 | 0/0 | 0 | 0 | 1.0000 | - |
| pixelbolt v pixelfx | sonnet | 12 | 12 | 1 | 9 | 2 | 0/0 | 0 | 0 | 0.0215 | - |
| pixelbolt v pixelfx | all | 24 | 24 | 5 | 14 | 5 | 0/0 | 0 | 0 | 0.0636 | not met |

### The rule (primary pair, amendment 2)
{"pair": "pixelbolt v pixelfx", "first": "a", "second": "b", "rule_met_for": null}
Nothing is published from this block alone (amendment 2).
