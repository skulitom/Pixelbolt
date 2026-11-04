# Pixelbolt with and without: the plan of a pixel-art benchmark

*Published copy: local paths, internal names and our own scheduling notes are replaced in [square brackets]; nothing else is changed.*

*Written Fri 2026-10-23 before any benchmark job ran. The plan is frozen once the main runs start:
any later change goes in "Amendments" at the bottom, dated, with the reason, and the page reports it.*

## Question
Given the same user-worded sprite, animation, tile and effect requests, does Claude deliver valid, clean pixel art more
often when Pixelbolt is available than when nothing is installed? And what does it cost in time and money?

## What runs
- **Client:** Claude Code 2.1.302, headless (`claude -p`), through [our job wrapper] (the October API credit).
  Each job starts in a fresh, empty folder under `[a local folder]/runs/` (no git repo, no CLAUDE.md
  above it, a fresh Claude config with no plugins, skills, memory or user settings). Effort: Claude Code's default
  (`BENCH_JOB_EFFORT` unset), the setting a typical user has.
- **Models:** the `haiku`, `sonnet` and `opus` aliases (Claude Haiku, Sonnet and Opus 5.5). The resolved model ids
  are read from each stream and reported.
- **Arms:** 
  - **with:** Pixelbolt **0.9.0** as an MCP server, the npm tarball (`pixelbolt-0.9.0.tgz`, SHA-1
    `18317396f740cf201461b6a83120bf8cd8d69c1b`, the same as the registry's `dist.shasum`), unpacked once and started
    with the plugin's own command, `node <unpacked>/bin/pixelbolt.js mcp`, through `--mcp-config`. That is what
    `npx -y pixelbolt mcp` or the plugin gives a user, minus a download per job. The plugin's skill isn't loaded: the
    wrapper refuses `--plugin-dir`, and [this benchmark] allows the MCP server alone. The server's own `instructions` and
    `pixel_help` are its guidance.
  - **without:** nothing installed, no MCP config.
- **The same in both arms:** the prompt (it never names a tool), Python 3.13.9 with Pillow 12.0.0, Node 24.19.0,
  and these tools: Read, Write, Edit, Glob, Grep, and Bash for `node`, `python`, `cp`, `mv`, `mkdir` and `ls`. Denied
  in both: WebSearch, WebFetch, `npm`, `npx`, `pip` and `python -m pip`, so neither arm installs anything or goes
  online. Both may write and run their own code.
- **Limits per job:** 60 turns, 1,500 s, and a dollar cap of $0.60 (Haiku), $1.50 (Sonnet) or $3.00 (Opus). A job
  that hits a cap keeps whatever files it wrote; they are scored like any others. Cap hits are reported per arm.
- **Tasks:** the 12 in `tasks.json` (its SHA-256 is in the run log), worded as a user would, each naming exact sizes,
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
- If Pixelbolt doesn't win, the page says so or stays unpublished, and its failures go to `[Pixelbolt's issue list]` as a
  list for [the maintainer's] sessions and [our nightly maintenance].
- The page publishes after [an internal item]'s 28 Oct re-check, unless that decision stops new pages; marketing takes it for X
  and dev.to.

## Files
- `tasks.json`, `run_bench.py`, `score.py`, `sheets.py`, `judge.py`: in `[a local folder]/`, copied here
  with the results.
- Streams: `[job logs]`; costs: `[job logs]`.

## Amendments
1. **2026-10-23, after the 72 main jobs had run and been scored, before their judging was read: an exploratory arm,
   "told".** The main runs showed Sonnet never called Pixelbolt (0 of 12) and Haiku and Opus called it in 5 and 8 of
   12, so "available" can't separate "Claude doesn't choose it" from "it doesn't help when used". The "told" arm is
   the "with" arm plus one sentence at the end of each prompt, "Use the Pixelbolt MCP tools for this.", on all three
   models (36 jobs), scored by the same `score.py` checks and judged blind against the same "without" outputs by the
   same judge prompt (the arm label passed to `judge.py` as an argument; nothing else in the scripts changes). It was
   decided after seeing results, so it is reported as exploratory: it never feeds the claim rules above, and the page
   says when it was added. `summary.py` (added after the freeze) only applies the rules above to the results.
2. **2026-10-26, written before any run-2 job: run 2, on Pixelbolt main `f964f40`** ([our task list], [our planner's]
   10-26 line: run 2 moved up to Mon 26, on main HEAD, up to $35).
   - **What changes: only the package.** The "with" and "told" arms start Pixelbolt main at `f964f40` (merged
     2026-10-26 03:33 UTC; the server reports version 0.9.1). That commit carries everything 0.9.1 shipped (among it
     #22's new server wording for [an issue], [an issue]'s GIF scale (#33) and [an issue] (#34)) plus three later PRs: [an issue]'s
     `saveAs` (#48), #49 and #50. It is exported with `git archive f964f40` from a clone of
     github.com/skulitom/Pixelbolt into `[a local folder]/pixelbolt-f964f40/` (Pixelbolt has no
     dependencies) and started as `node <export>/bin/pixelbolt.js mcp`, the same command shape as run 1.
   - **Unchanged:** `tasks.json` and `score.py` (same SHA-256 as frozen), `sheets.py` and `judge.py` as amended for
     the told arm, the prompts, Claude Code 2.1.302, Node 24.19.0, Python 3.13.9 with Pillow 12.0.0, default effort,
     the allowed and denied tools, the per-job turn, time and dollar caps, and at most 3 jobs at once. `run_bench.py`
     and `judge.py` differ from run 1's only in the package path, the job-name prefix (`bench-r2-`, so run 2's spend
     sums apart) and the cap.
   - **Arms:** "with", "without" and "told", all run again, so every comparison is inside run 2 (the "without" arm
     re-runs because single runs are noisy and both sides should share a day and a client). Order: the two main arms
     for Haiku, Sonnet, then Opus; then "told". The told arm stays exploratory: it never feeds the claim rules.
   - **Cap:** $35 for run 2 (jobs, judging and its reviews), $8 of it held for judging; the Opus cut rule as frozen,
     with $35 in place of $60.
   - **Pilot:** P0 on Haiku, both main arms, to test the harness; excluded from results.
   - **Claim rules:** the frozen rules, applied to run 2's main arms alone, with "Pixelbolt main `f964f40`" as the
     version. Run 1 (0.9.0) and run 2 are shown side by side and never pooled, because the package differs.
   - **Tuesday's replicate** (a second run of the two main arms on the same commit, [our task list]), fixed now so it
     can't be fitted to the result: it is reported next to run 2. A public "Pixelbolt helps" claim (per model or
     overall) needs run 2 to meet the frozen rule **and** the replicate to point the same way for that model or
     overall (pairs won with Pixelbolt more than without, and valid with at least valid without). A table pooling the
     two replicates may be shown, labelled as pooled, with no claim of its own.
   - **Context, not this harness:** [our nightly maintenance]'s pick-rate check ([our task list] item 1;
     [a run log], "[an issue]") ran [this benchmark]'s 13 prompts on Haiku and Sonnet against a recording stub with no
     Python: 0.9.0's server wording was picked first in 0 of 26 runs, 0.9.1's in 52 of 52. The page may cite it,
     marked as a different harness that measured picks, not results.
3. **2026-10-26 15:50, after run 2 was scored and judged, before the replicate's first job: the replicate runs today.**
   Run 2 finished at 15:45 for $17.17 of its $35, so amendment 2's replicate (a second run of the two main arms on the
   same commit) starts today instead of Tuesday, leaving Tuesday for further replicates and the page draft ([our task list], [an internal item] item 3). Nothing else changes: the same export of `f964f40`, scripts, prompts, tools, caps and judge,
   in its own folder (`[a local folder]/`), job names `bench-r2-rep2-` (still inside [an internal item]'s
   `bench-r2-` prefix). Its own cap is $15 with $3 held for judging (the Opus cut rule counts its own jobs only).
   Its claim role is amendment 2's, fixed before run 2: it is reported next to run 2, and a "helps" claim needs run 2
   to meet the frozen rule and the replicate to point the same way. Run 2 met no rule, so no claim can follow from
   today's runs whatever the replicate shows.
4. **2026-10-26 16:12, after the replicate was judged, before the cells below ran: the replicate's cut Opus tasks run.**
   The replicate's $15 cap was set too low for the cut rule, which counts each running Opus job's $3 reservation: it
   cut Opus T08 to T12 (both arms, 10 jobs) at $11.33 "spent" while the replicate's real spend was about $7. Those
   cells were never run, so nothing about them has been seen, and the rule cuts whole tasks in a fixed order, so
   running them can't pick favourable cells. They run now under the same rules with the replicate's cap raised to
   $25 ($3 still held for judging), are judged by the same script, and complete the replicate's 72 jobs. The
   replicate's claim role is unchanged (amendment 2).

**Erratum, 2026-10-26 16:41 (after review 1; amendments 3 and 4 above are left as written):**
- Amendment 3's stated time "15:50" is wrong: it was written and hashed by 15:46 (`frozen-hashes-rep2.txt` at
  15:46:17 records this file through amendment 3) and the replicate's first job started at 15:46:29.
- Amendment 4's stated time "16:12" is wrong: this file was saved at 16:10:16 and the first cut-cell job started at
  16:10:22.
- Amendment 4's "real spend was about $7" is wrong: at the cut the replicate had $5.33 of real cost; the $11.33 it
  counted was that plus two running Opus jobs' $3 reservations.
- When amendment 4 was decided, the replicate's 31 judged tasks stood at valid 28 vs 25 and pairs 14-13 (4 ties); the
  ten cut-cell jobs then went valid 5 vs 5 and pairs 1-3-1, so running them didn't favour Pixelbolt.
- The replicate's `run_bench.py` before amendment 4 differs from the kept file only in the cap line (`15.0, 3.0`);
  restoring that line reproduces the hash in `frozen-hashes-rep2.txt` (25164eef...), kept as
  `run2/replicate/run_bench.pre-amendment4.py`.

5. **2026-10-27, written before any replicate-3 job (save time and hash in `frozen-hashes-rep3.txt`): replicate 3,
   October's last API spend.** [our task list] ([our planner], 10-27): replicates up to the wrapper's October cap
   ($106.50; $91.05 spent, so $15.45 left at 14:56), with per-job temp folders and a per-job script check fixed first;
   then a page draft, reviewed and not published. $15.45 is room for one replicate (replicate 2 cost $10.69).
   - **What runs:** the two main arms again on the same `git archive` export of `f964f40`, the 12 tasks on Haiku,
     Sonnet and Opus (72 jobs), judged by the same judge prompt and order rule. Folder
     `[a local folder]/`, job names `bench-r2-rep3-` (inside [an internal item]'s `bench-r2-` prefix).
   - **Unchanged from replicate 2:** `tasks.json`, `score.py` and `sheets.py` (same SHA-256 as frozen), the prompts,
     the allowed and denied tools (so `python3` stays refused, for comparability; by-default wins are reported apart),
     Node 24.19.0, Python 3.13.9 with Pillow 12.0.0, default effort, the per-job turn, time and dollar caps, the judge.
     `run_bench.py` and `judge.py` differ from replicate 2's only as listed here.
   - **Claude Code 2.1.302, pinned:** the installed client moved to 2.1.310 on 10-26 at 18:14, after run 2. Runs 1 and
     2 ran 2.1.302, so jobs and judges run the installed 2.1.302 binary (`~/.local/share/claude/versions/2.1.302`,
     hard-linked as `cc-2.1.302/claude.exe`, first on PATH; same SHA-256). Each stream's reported version is checked.
   - **Cap:** $15.45 for replicate 3, $2.00 of it held for judging; the Opus cut rule as frozen with these numbers.
     Opus runs 2 jobs at once (within "at most 3"): at 3, the running jobs' $3 reservations would pass the October
     cap near the end and the wrapper would trim a job's $3 budget. A job given less than its frozen cap is reported.
   - **Against contamination** (run 2 record, "For Tuesday's run"):
     1. Each job gets its own TEMP, TMP and TMPDIR, `tmp/<model>/<task>-<arm>/`, outside its job folder so the job
        folder still starts empty. Tested at 14:58 today from a Node parent: Git Bash's `/tmp` stays the shared
        `%TEMP%` whatever TEMP says, so this isolates `$TEMP`, `$TMPDIR` and temp-file APIs only; the check below is
        the guard for `/tmp`.
     2. Before the first job, `prep_leftovers.py --move` moves aside the files earlier [this benchmark] jobs left in `C:\tmp\`
        and `%TEMP%` (files a [this benchmark] stream wrote, last modified while that job ran: 68 at the dry run) into
        `leftovers-moved/`, with a manifest. Other agents' files stay.
     3. After each model's jobs and before scoring, `stale3.py` flags a job that (a) ran a script it didn't write in
        that job, or copied in a file from outside its job and tmp folders that it didn't write, or (b) wrote a script
        at a shared path that another replicate-3 job also wrote while both ran. Scripts in the Pixelbolt export don't
        count. Checked first on replicate 2's streams: it flags the two cells review 3 found and four more where a job
        ran a leftover before writing its own.
     4. A flagged cell is re-run once, with no other job running, in a fresh folder with the same settings, before
        any judging; the re-run replaces the cell and the first run stays in the record. A cell flagged again, or one
        the cap stops, is reported as contaminated and left out of the counts (shown apart).
   - **Claim role:** amendment 2's. Run 2 met no rule, so no "helps" claim can follow whatever replicate 3 shows. It
     is reported next to run 2 and replicate 2; a table pooling the three may be shown, labelled pooled, with no claim.

   **Addendum 5a, 2026-10-27 15:19, after replicate 3's Haiku and Sonnet jobs ran, before any Opus job and before
   anything was scored or judged:**
   - **`stale3.py` fixed to match its own docstring.** Its code counted a run whose output said "can't open file" as
     started when the command as a whole succeeded. It flagged Sonnet T10 available: Claude Code refused that job's
     heredoc, so `%TEMP%\g\gen.py` was never written, and `python /tmp/g/gen.py; ls` printed "can't open file" with
     no error status (the `; ls`); the job then wrote and ran its own script in its folder. Under the docstring's rule
     the file never ran, so the cell stands and isn't re-run. The fixed check flags 0 of replicate 3's 48 jobs so far
     and still flags replicate 2's six; the old file is kept as `stale3.pre-fix.py`.
   - **Opus runs one job at a time, not two.** Haiku and Sonnet cost $2.63. The cut rule counts a running job's $3
     reservation, so at two at once the last Opus task's check would have had about $1 of margin at replicate 2's
     Opus costs. One at a time is within "at most 3", can't trim a job's budget at the wrapper either, and changes
     nothing a job sees.

   **Addendum 5b, 2026-10-27 15:48, after all 72 replicate-3 jobs ran, before anything was scored or judged:**
   - **`stale3.py` now expands shell variables a command assigns itself.** It flagged Opus T12 no-tool for
     `python "$D/make_smoke.py"`. The same command had set `D="<that job's own folder>"`, and the job had written
     `make_smoke.py` there with the Write tool, so under the rule ("ran a script it didn't write") the file is its own
     and the cell stands, not re-run. To find the path I read that job's commands, which include its own printout of
     its files (sizes, frame and colour counts); no score or judgement was run or read. The fixed check flags 0 of
     the 72 jobs and still flags replicate 2's six; the old file is kept as `stale3.pre-5b.py`. Every flag the check
     raised today (two) was a gap in the check, not a job running another's script.

**Erratum, 2026-10-27, after review 2 (addenda 5a and 5b above are left as written):**
- Addendum 5b's stated time "15:48" (and the same in `stale3.py`'s comment) is wrong: `stale3.py` was saved at
  15:47:19, this file at 15:47:32 and hashed at 15:47:35 (`frozen-hashes-rep3.txt`); scoring wrote `results.json` at
  15:47:35.8 and the first judge job started at 15:47:42. So 5b still came before the scoring and judging it names.
- Addendum 5a's account of Sonnet T10 also came from reading that job's commands and outputs, which include its own
  printout "(48, 48) 7" (size and colour count); nothing had been scored or judged.

6. **2026-11-03, written before any run-3 job (save time and hashes in `[a local folder]/frozen-hashes-r3.txt`):
   run 3, on Pixelbolt 0.11.0.** [our task list] ([our planner], 11-02: run 3 on Tue 3, up to $60, on Pixelbolt 0.11.0, the
   latest release, with [our animation build]'s skill installed, on the frozen tasks, judged as in runs 1 and 2) and [our animation build] done-when 3.
   - **Package:** `pixelbolt-0.11.0.tgz` from npm (`npm pack pixelbolt@0.11.0`, SHA-1
     `388970faf7c41ed5c014379bbda1ee5f1e8a21fa`, equal to the registry's `dist.shasum`; tag v0.11.0, 2026-11-02 01:54
     UTC; the latest on npm and GitHub at 15:00 today). It carries [our animation build]'s build (#73 presets over MCP and the CLI, #74
     the grounded slime idle, #75 motion notes) and everything since run 2's `f964f40`. Unpacked into
     `benchr3/pkg/package/` and started as `node <package>/bin/pixelbolt.js mcp`, the frozen command shape (smoke test:
     server "pixelbolt" 0.11.0, 8 tools). No frozen task's inputs change: a task is its prompt and file names only.
   - **Arms: "with" and "without", as frozen.** The skill arm [our animation build] asks for can't run today. The wrapper starts every
     job with `--setting-sources user` and a fresh, empty config folder, and refuses `--plugin-dir`; a project skill
     (`pixelbolt skill install --project` in the job folder) isn't loaded under that setting. Tested at 15:01 with a
     one-turn Haiku job (`bench-r3-skilltest`, $0.0023): the init line's skills list has no `pixelbolt-pixel-art`.
     Changing the wrapper isn't compare's work, so a request goes to [our internal requests list]. When the wrapper can load a user-level
     skill, the skill arm runs as fixed now: the same 36 cells; the skill from `skill install` of this same tarball in
     the job's user skills folder; no MCP config; `Bash(npx:*)` added to the allowed tools, with npm offline from a
     cache warmed with `pixelbolt@0.11.0` only; judged by the same judge against this run's "without" outputs. [our animation build]'s
     test below applies to it too.
   - **Unchanged from replicate 3:** `tasks.json`, `score.py` and `sheets.py` (same SHA-256 as frozen); the prompts;
     the allowed and denied tools (`python3` stays refused, so by-default wins are reported apart); Node 24.19.0;
     Python 3.13.9 with Pillow 12.0.0; default effort; the per-job caps (60 turns, 1,500 s, $0.60, $1.50 or $3.00);
     the judge prompt and the order rule. Also unchanged: Claude Code 2.1.302 pinned for jobs and judges (a hard link
     of `~/.local/share/claude/versions/2.1.302`, the same SHA-256 as replicate 3's; the installed client is now
     2.1.317), each job's own TEMP, TMP and TMPDIR, leftovers moved first (10 files,
     `benchr3/leftovers-moved/MANIFEST.txt`), and `stale3.py` (addendum 5b's version) with amendment 5's re-run rule.
     `run_bench.py`, `judge.py` and `stale3.py` differ from replicate 3's only in the package path, the cap and the job
     prefixes (`bench-r3-main-`, `bench-r3-judge-`).
   - **Order:** Haiku, Sonnet, then Opus; within a model, task by task with the two arms side by side; at most 3 jobs
     at once, Opus included.
   - **Cap:** $25 for run 3, $4 of it held for judging; the Opus cut rule as frozen, with these numbers. The whole of
     run 3 stays within [our planner's] $60, the replicate and the later skill arm included.
   - **Claim rules:** the frozen rules, applied to run 3's main arms alone, with "Pixelbolt 0.11.0" as the version.
     Runs 1 and 2 and the replicates are shown beside it and never pooled with it, because the package differs.
     Amendment 2 stands: a public "Pixelbolt helps" claim also needs a replicate on the same package pointing the
     same way.
   - **[our animation build]'s test (done-when 3), fixed now.** The animation and effect tasks are T06, T07, T08, T11 and T12: 15
     pairs over the three models. The test passes if the "with" arm wins at least 60% of the decided ones **and**
     its valid files over all 36 cells are at least the "without" arm's. Decided pairs are pairs judged and won in
     both orders. Ties aren't decided, and by-default wins are reported apart and don't count. Pass: the compare page
     publishes runs 1 to 3. Fail: no page, and the findings go to [Pixelbolt's issue list] for [the maintainer's] sessions and the
     nightly.
   - **Replicate, fixed now.** If run 3 costs under $15 and its judging ends before 17:45, a replicate of both main
     arms runs straight after, on the same settings, in `benchr3-rep/` with the prefix `bench-r3-rep-` and a $20 cap.
     It is reported next to run 3. [our animation build]'s test is decided on run 3 alone, as [our animation build] words it. The replicate decides
     only amendment 2's claim rule, and the page says so if it disagrees.

   **Addendum 6a, 2026-11-03, after run 3's Haiku jobs ran (Sonnet's running), before anything was scored or
   judged:** `stale3.py` now treats a node run cut to its first line as not run when the same job later shows the
   file was never there. It flagged Haiku T04 no-tool for `node /tmp/swordgen/make_sword.js 2>&1 | head -1; echo done`.
   That file didn't exist at that path: the job's next two runs of it print "Cannot find module
   'C:/Users/[user]\AppData\Local\Temp\swordgen\make_sword.js'", and that folder holds only a 10-26 `preview.png`.
   `| head -1` had cut the output to node's loader header, so the check's "Cannot find module" test missed it. The job
   then wrote and ran its own script (`runs/haiku/gen/make_sword.js`). Under the rule ("ran a script it didn't write")
   the cell stands and isn't re-run. I found this by reading that job's commands and their printed output, which
   include its own text preview of the sword; no score or judgement was run or read. The fixed check flags 0 of the
   24 Haiku jobs, still flags replicate 2's six and replicate 3's 0 (control copies, deleted after). The old file is
   kept as `stale3.pre-6a.py`.

   **Erratum and addendum 6b, 2026-11-03, after run 3 was scored and judged (and its verdicts read), before the
   replicate's scoring or judging:**
   - **Run 3's judge ran the wrong client.** Amendment 6 pins Claude Code 2.1.302 for jobs and judges. `run_bench.py`
     puts it first on PATH itself, but `judge.py` doesn't (replicate 3's judge got the pin from the shell), and I ran
     run 3's judge without it. All 70 run-3 judge streams (15:26 to 15:30) report Claude Code 2.1.317. A fresh
     reviewer found it. Those verdicts were: animation and effect pairs 9-6-0 ([our animation build]'s test: pass), all pairs 19-14
     (3 ties).
   - **Fix, fixed now:** run 3 is judged again as amendment 6 says, with 2.1.302 first on PATH and nothing else
     changed. Those verdicts are run 3's result, and [our animation build]'s test is decided on them, whatever they show. The 2.1.317
     verdicts are kept (`judgements-cc2.1.317.json`, `judge-cc2.1.317/`) and reported beside them. The replicate is
     judged with 2.1.302 too. Every judge stream's version is checked before its verdicts are used.
   - **The replicate's script check flagged one cell, and it is a real case:** Haiku T04 no-tool wrote
     `/tmp/sword_gen/make_sword.py` with the Write tool (that lands in `C:\tmp\`), then ran
     `python -I /tmp/sword_gen/make_sword.py`, which Git Bash resolves to `%TEMP%\sword_gen\`, where a 10-25 script of
     the same name from another agent's job sat. That script drew the delivered sword. Under amendment 5's rule 4 the
     cell is re-run once, with no other job running, in a fresh folder with the same settings (the other agent's files
     stay where they are), before any judging; the first run is kept in `runs-flagged/`. If the re-run is flagged
     again, the cell is reported as contaminated and left out of the counts.
