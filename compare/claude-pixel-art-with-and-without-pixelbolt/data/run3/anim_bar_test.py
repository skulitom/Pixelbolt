"""[our animation build] done-when 3, as PLAN.md amendment 6 fixes it (written before any run-3 result was read).

The animation and effect tasks are T06, T07, T08, T11 and T12 (15 pairs over three models). PASS when the "with" arm
wins at least 60% of the decided ones AND its valid files over all 36 cells are at least the "without" arm's.
Decided = judged and won in both orders ("pair": "judged" with winner "with" or "without"). Ties aren't decided;
by-default wins are reported apart and don't count.

Usage: python -I anim_bar_test.py [folder]   (default: this script's folder) -> prints the test and writes anim_bar_test.json
"""
import json
import os
import sys

BASE = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
MOVING = ("T06", "T07", "T08", "T11", "T12")
rows = [r for r in json.load(open(os.path.join(BASE, "results.json"), encoding="utf-8")) if not r["pilot"]]
judg = json.load(open(os.path.join(BASE, "judgements.json"), encoding="utf-8"))

valid = {a: sum(1 for r in rows if r["arm"] == a and r["valid"]) for a in ("with", "without")}
cells = {a: sum(1 for r in rows if r["arm"] == a) for a in ("with", "without")}
mov = [j for j in judg if j["task"] in MOVING]
judged = [j for j in mov if j.get("pair") == "judged"]
won = {a: sum(1 for j in judged if j["winner"] == a) for a in ("with", "without")}
ties = sum(1 for j in judged if j["winner"] == "tie")
by_default = {a: sum(1 for j in mov if j.get("pair") == "by default" and j["winner"] == a) for a in ("with", "without")}
neither = sum(1 for j in mov if j.get("pair") == "neither delivered")
decided = won["with"] + won["without"]
share = won["with"] / decided if decided else 0.0
pass_pairs = decided > 0 and share >= 0.60
pass_valid = valid["with"] >= valid["without"]
res = dict(moving_pairs=len(mov), decided=decided, won_with=won["with"], won_without=won["without"], ties=ties,
           by_default=by_default, neither_delivered=neither, share_with=round(share, 4),
           valid_with=valid["with"], valid_without=valid["without"], cells=cells,
           pass_pairs=pass_pairs, pass_valid=pass_valid, passed=pass_pairs and pass_valid)
json.dump(res, open(os.path.join(BASE, "anim_bar_test.json"), "w", encoding="utf-8"), indent=1)
print(f"animation and effect pairs: {len(mov)}; decided {decided}: with {won['with']}, without {won['without']} "
      f"({share:.0%} with; needs 60%); ties {ties}; by default with {by_default['with']}, "
      f"without {by_default['without']} (not counted); neither delivered {neither}")
print(f"valid files, all cells: with {valid['with']}/{cells['with']}, without {valid['without']}/{cells['without']}")
print("[our animation build] done-when 3:", "PASS" if res["passed"] else "FAIL",
      f"(pairs {'met' if pass_pairs else 'not met'}, valid {'met' if pass_valid else 'not met'})")
