# Pixelbolt with and without: the plan of a pixel-art benchmark

*Published copy: local paths, internal names and our own scheduling notes are replaced in [square brackets]; nothing else is changed.*

*Written Fri 2026-10-23 before any benchmark job ran. The plan is frozen once the main runs start:
any later change goes in "Amendments" at the bottom, dated, with the reason, and the page reports it.*

## Question
Given the same user-worded sprite, animation, tile and effect requests, does Claude deliver valid, clean pixel art more
often when Pixelbolt is available than when nothing is installed? And what does it cost in time and money?

## What runs
- **Client:** Claude Code 2.1.302, headless (`claude -p`), through [our wrapper that bills each job to an API key].
  Each job starts in a fresh, empty folder [under a local runs folder] (no git repo, no CLAUDE.md
  above it, a fresh Claude config with no plugins, skills, memory or user settings). Effort: Claude Code's default
  ([no effort setting passed]), the setting a typical user has.
- **Models:** the `haiku`, `sonnet` and `opus` aliases (Claude Haiku, Sonnet and Opus 5.5). The resolved model ids
  are read from each stream and reported.
- **Arms:** 
  - **with:** Pixelbolt **0.9.0** as an MCP server, the npm tarball (`pixelbolt-0.9.0.tgz`, SHA-1
    `18317396f740cf201461b6a83120bf8cd8d69c1b`, the same as the registry's `dist.shasum`), unpacked once and started
    with the plugin's own command, `node <unpacked>/bin/pixelbolt.js mcp`, through `--mcp-config`. That is what
    `npx -y pixelbolt mcp` or the plugin gives a user, minus a download per job. The plugin's skill isn't loaded: the
    wrapper refuses `--plugin-dir`, and [the benchmark's brief] allows the MCP server alone. The server's own `instructions` and
    `pixel_help` are its guidance.
  - **without:** nothing installed, no MCP config.
- **The same in both arms:** the prompt (it never names a tool), Python 3.13.9 with Pillow 12.0.0, Node 24.19.0,
  and these tools: Read, Write, Edit, Glob, Grep, and Bash for `node`, `python`, `cp`, `mv`, `mkdir` and `ls`. Denied
  in both: WebSearch, WebFetch, `npm`, `npx`, `pip` and `python -m pip`, so neither arm installs anything or goes
  online. Both may write and run their own code.
- **Limits per job:** 60 turns, 1,500 s, and a dollar cap of $0.60 (Haiku), $1.50 (Sonnet) or $3.00 (Opus). A job
  that hits a cap keeps whatever files it wrote; they are scored like any others. Cap hits are reported per arm.
- **Tasks:** the 12 in `tasks.json` (its SHA-256 is in [frozen-hashes.txt]), worded as a user would, each naming exact sizes,
  frame counts, a colour limit, the background and the file names:
  - static sprites: T01 chest 32×32, T02 potion icon 16×16, T03 knight 32×32, T04 sword icon 16×16, T05 oak tree 48×48;
  - animations, sheet plus GIF: T06 coin spin 6 × 16×16, T07 slime idle 8 × 32×32, T08 walk cycle 6 × 32×32;
  - tiles: T09 seamless grass 16×16, T10 3×3 dirt-path set in one 48×48 image;
  - effects, sheet plus GIF: T11 campfire loop 8 × 32×32, T12 one-shot smoke puff 8 × 32×32.
- **Runs:** one run per task, arm and model: 72 jobs. Order: Haiku, then Sonnet, then Opus; within a model, task by
  task with the two arms side by side; at most 3 jobs at once.
- **Pilot (excluded from results):** one extra task, P0 (a 16×16 mushroom icon), on Haiku and Sonnet in both arms,
  only to test the harness. Its cost counts against the cap.
- **Cap:** $60 for everything in [this benchmark] (pilot, 72 jobs, judging). $8 is held back for judging. Before each Opus task,
  if the spend so far plus twice the dearest Opus job so far (or $3 before the first) would pass $52, the remaining
  Opus tasks are cut, from T12 backwards, both arms together. Cut cells are reported as not run.

## Deterministic metrics (`score.py`, one script for both arms)
Read from the job folder only, at the exact file names the task gives. Each file is opened with Pillow; GIF frames
are read composited (RGBA). "Opaque" is alpha 255.
1. **files:** every requested file exists and opens.
2. **size:** a sprite or tile is exactly W×H; a sheet is exactly N·W × H; every GIF frame is W×H.
3. **frames** (animations and effects): the GIF has exactly N frames, and a looping task's GIF loops forever.
4. **crisp:** every pixel's alpha is 0 or 255, in every frame (no soft, anti-aliased edges).
5. **palette:** each file has at most the task's number of distinct opaque RGB colours (transparent isn't a colour).
6. **background:** sprites and effects: the four corner pixels of every frame are transparent and at least 20% of
   the pixels are; tiles: every pixel is opaque.
7. **content:** the fullest frame is at least 10% opaque, and no frame is empty (except the last frame of the
   one-shot T12).
8. **motion** (animations and effects): consecutive frames differ, and for loops the last differs from the first.

A task is **valid** when all its checks pass. Reported, not part of "valid": whether the GIF matches the sheet frame
for frame, and for T09 and T10 a wrap-seam score (colour change across the wrap edges against the change between
neighbouring interior rows and columns). Also from each stream: cost, duration, turns, whether a cap was hit, and in
the "with" arm which Pixelbolt tools were called.

**Primary result:** valid tasks out of 12, per arm and model.

## Blind pairwise judgement (`judge.py`)
- For each task and model, a contact sheet of each arm's files: every frame scaled up with nearest-neighbour to at
  least 192 px tall, on a grey checkerboard where it's transparent, labelled only "Left" or "Right". A missing or
  unreadable file shows as "no file".
- The judge is a fresh Claude Opus 5.5 job through the wrapper, with the Read tool only, given the user's request
  and the two sheets. It answers `{"choice": "Left" | "Right" | "Tie", "reason": "..."}` on: does it fulfil the
  request, does it read clearly at its real size, is it clean pixel art (outlines, no stray pixels, consistent
  light), and for animations, is the motion smooth and believable.
- Each pair is judged twice with the sides swapped (first side from the parity of SHA-256 of `task|model`). An arm
  wins a pair only if it wins both orders; anything else is a tie. If only one arm delivered any readable file, it
  wins without a judge ("by default", reported apart).

## What we may say in public (decided now, before the results)
- Every number is published, losses included, with the method, the version (0.9.0) and "one run per cell".
- "Pixelbolt helps <model>" only if, for that model, valid tasks with Pixelbolt are at least 3 more than without
  **and** the judge's pair wins with Pixelbolt outnumber those without.
- "Pixelbolt helps Claude" overall only if the valid difference across the three models is at least 6 of 36 **and**
  the 36 pairs pass a two-sided exact sign test at p < 0.05 (ties dropped).
- Short of those, only the raw counts ("valid in 9 of 12 with, 7 of 12 without"). Never an unmeasured "better",
  "fastest" or "only". Cost and time per arm are always shown next to the result.
- If Pixelbolt doesn't win, the page says so or stays unpublished, and its failures go to
  [Pixelbolt's issue list].
- The page publishes after [a planned 28 Oct re-check of whether search engines find our pages], unless that
  decision stops new pages; [our posting accounts may then share it].

## Files
- `tasks.json`, `run_bench.py`, `score.py`, `sheets.py`, `judge.py`: [published with the page].
- [Raw job logs and the cost log, kept locally.]

## Amendments
1. **2026-10-23, after the 72 main jobs had run and been scored, before their judging was read: an exploratory arm,
   "told".** The main runs showed Sonnet never called Pixelbolt (0 of 12) and Haiku and Opus called it in 5 and 8 of
   12, so "available" can't separate "Claude doesn't choose it" from "it doesn't help when used". The "told" arm is
   the "with" arm plus one sentence at the end of each prompt, "Use the Pixelbolt MCP tools for this.", on all three
   models (36 jobs), scored by the same `score.py` checks and judged blind against the same "without" outputs by the
   same judge prompt (the arm label passed to `judge.py` as an argument; nothing else in the scripts changes). It was
   decided after seeing results, so it is reported as exploratory: it never feeds the claim rules above, and the page
   says when it was added. `summary.py` (added after the freeze) only applies the rules above to the results.
