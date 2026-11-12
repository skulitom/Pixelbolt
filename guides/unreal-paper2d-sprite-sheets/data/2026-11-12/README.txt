Pixelbolt sprite sheets in Unreal Engine Paper2D: the 12 November 2026 re-test
https://skulitom.github.io/Pixelbolt/guides/unreal-paper2d-sprite-sheets/

What changed: ../../pixelbolt_paper2d.py now also reads older Pixelbolt atlases, whose "animations" are plain
lists of frame names with "loop" in a separate "loops" object (the layout in our earlier asset packs). It stops
with its own message, before importing anything, when an animation is neither a list nor an object with "frames",
has no frames, or names a frame the atlas doesn't have or one without a duration of 1 ms or more. Before, an older
atlas stopped with "TypeError: list indices must be integers or slices, not str".

Run on 12 November 2026, launched 15:15:18 UTC, with Unreal Engine 5.8.4-58902052 on Windows 11 (the log's Build,
Engine Version and OS lines are in log-excerpts.txt), headless as on 7 November (-RenderOffScreen -nullrhi
-unattended -nosplash -nosound), in a fresh copy of ../P2DDefault.uproject (Unreal's default plugins). The editor
exited 0 after 16 s (run-and-versions.txt; its log opens at 15:15:19 and closes at 15:15:34). The check ran
afterwards with Python 3.13.9 and Pillow 12.0.0.

Files
  ue_check.py         ../ue_check.py with one change: it also reads an animation given as a plain list
  check_results.py    ../check_results.py with that change, plus: it compares the pivot with "anchorPx" or
                      points.anchor_px when the atlas has them (older atlases give "anchor" as a fraction of the
                      frame, which the 7 November check would read as pixels)
  out/fx-shield/      an older Pixelbolt atlas from our own art library: 42 frames, animations up, idle, hit and pop as plain
                      lists, "loops" marking up, hit and pop as playing once
  out/fx-shift-arc/   an older Pixelbolt atlas from the same library: 24 frames, one looping animation as a plain list
  out/bad-*/          five broken copies of fx-shift-arc's atlas (each used with a copy of fx-shift-arc.png named
                      after it; the copies are not included):
                        bad-anim      one more animation, "bad": 7
                        bad-empty     one more animation with no frames
                        bad-unknown   one more animation naming a frame the atlas doesn't have
                        bad-duration  the first frame's duration set to 0
                        bad-nan       the first frame's duration set to NaN
  summary.json        ue_check.py's outcome per sheet: "ok", or the full error
  check-results.txt   check_results.py's verdict for the nine sheets that should import
  log-excerpts.txt    the editor log's first line, Build, Engine Version and OS lines (CPU and GPU cut), the
                      script's own lines and the last line (the errors' full text is in summary.json)
  run-and-versions.txt  the launch time, exit code and run time, and the Python and Pillow versions

Result: the seven sheets of 7 November (../out/) and the two older atlases passed every check (texture pixels,
settings, sprite rectangles, trims and pivots, flipbook frame rates, key frames, lengths and the sprite at the middle
of every frame). The shield's play-once line lists fx-shield_up, fx-shield_hit and fx-shield_pop. Each broken atlas
stopped before importing anything, with its own message, for example: animation 'bad' should be a list of frame names
or an object with "frames".

To reproduce: as in ../README.txt, with these bundles added under out/ (and the PNG copies), and P2D_CASES set to
forest-spirit,forest-spirit-trim2x,campfire,hero,fire-spells,explosion,campfire-092,fx-shield,fx-shift-arc,bad-anim,bad-empty,bad-unknown,bad-duration,bad-nan
