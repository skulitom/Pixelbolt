"""[this benchmark]: run 1 (Pixelbolt 0.9.0) and run 2 (main f964f40) side by side, never pooled (PLAN.md amendment 2).

Usage: python compare_runs.py > compare.md
Reads ../[another run's folder]/{results,results-told,judgements,judgements-told}.json and the same files here.
"""
import json
import os
import statistics
from decimal import ROUND_HALF_UP, Decimal

from summary import sign_test

BASE = os.path.dirname(os.path.abspath(__file__))
RUNS = {"run 1 (0.9.0)": os.path.join(BASE, "..", "run1"), "run 2 (f964f40)": BASE}
REP = os.path.join(BASE, "..", "run2-repeat1")  # run 2's replicate (PLAN.md amendments 2 and 3): main arms only
if os.path.exists(os.path.join(REP, "judgements.json")):
    RUNS["run 2 replicate (f964f40)"] = REP
REP3 = os.path.join(BASE, "..", "run2-repeat2")  # the second replicate (PLAN.md amendment 5): main arms only
if os.path.exists(os.path.join(REP3, "judgements.json")):
    RUNS["run 2 second replicate (f964f40)"] = REP3
MODELS = ("haiku", "sonnet", "opus")
KIND = {"T01": "static", "T02": "static", "T03": "static", "T04": "static", "T05": "static", "T09": "static",
        "T10": "static", "T06": "moving", "T07": "moving", "T08": "moving", "T11": "moving", "T12": "moving"}


def usd(x):
    """Dollars to two places, half up (3.835 -> 3.84)."""
    return str(Decimal(str(round(x, 6))).quantize(Decimal("0.01"), ROUND_HALF_UP))


SHOW = {"with": "available", "without": "nothing installed", "told": "told (exploratory)"}


def dropped(d):
    """Cells PLAN.md amendment 5 leaves out of the counts (flagged twice, or stopped by the cap): (model, task)."""
    p = os.path.join(d, "contaminated.json")
    return {(c["model"], c["task"]) for c in json.load(open(p, encoding="utf-8"))} if os.path.exists(p) else set()


def load(d, name):
    p = os.path.join(d, name)
    xs = json.load(open(p, encoding="utf-8")) if os.path.exists(p) else []
    drop = dropped(d)
    return [x for x in xs if not (isinstance(x, dict) and (x.get("model"), x.get("task")) in drop)]


def rows_of(d):
    main = [r for r in load(d, "results.json") if not r.get("pilot")]
    return main + load(d, "results-told.json")


def pairs(js, arm):
    w = sum(j["winner"] == arm for j in js)
    o = sum(j["winner"] == "without" for j in js)
    t = sum(j["winner"] == "tie" for j in js)
    d = sum(j.get("pair") == "by default" for j in js)
    return w, o, t, d


out = ["## Per model and arm", "",
       "| run | model | arm | valid /12 | pairs won vs nothing installed (ties; by-default wins) | called Pixelbolt | cost $ | median s |",
       "|---|---|---|---|---|---|---|---|"]
for label, d in RUNS.items():
    rows = rows_of(d)
    jm, jt = load(d, "judgements.json"), load(d, "judgements-told.json")
    for m in MODELS:
        for arm in ("with", "without", "told"):
            rs = [r for r in rows if r["model"] == m and r["arm"] == arm]
            if not rs:
                continue
            pr = ""
            if arm != "without":
                js = [j for j in (jm if arm == "with" else jt) if j["model"] == m]
                w, o, t, dd = pairs(js, arm)
                bd = [j["winner"] for j in js if j.get("pair") == "by default"]
                pr = (f"{w} vs {o} ({t} ties; by default: {bd.count(arm)} to the Pixelbolt arm, "
                      f"{bd.count('without')} to nothing installed)")
            used = f"{sum(1 for r in rs if r.get('pixelbolt_calls'))}/{len(rs)}" if arm != "without" else "-"
            out.append(f"| {label} | {m} | {SHOW[arm]} | {sum(r['valid'] for r in rs)} | {pr} | {used} | "
                       f"{usd(sum(r.get('cost', 0) for r in rs))} | "
                       f"{statistics.median([r.get('duration_s', 0) for r in rs]):.1f} |")

out += ["", "## Totals (each run on its own)", "",
        "| run | arm | valid /36 | pairs won vs nothing installed (ties) | sign test p | static tasks: pairs (descriptive) | moving tasks: pairs (descriptive) | cost $ |",
        "|---|---|---|---|---|---|---|---|"]
for label, d in RUNS.items():
    rows = rows_of(d)
    for arm, jf in (("with", "judgements.json"), ("told", "judgements-told.json")):
        rs = [r for r in rows if r["arm"] == arm]
        if not rs:
            continue
        js = load(d, jf)
        w, o, t, _ = pairs(js, arm)
        st = pairs([j for j in js if KIND[j["task"]] == "static"], arm)
        mv = pairs([j for j in js if KIND[j["task"]] == "moving"], arm)
        out.append(f"| {label} | {SHOW[arm]} | {sum(r['valid'] for r in rs)} | {w} vs {o} ({t}) | {sign_test(w, o):.4f} | "
                   f"{st[0]}-{st[1]}-{st[2]} | {mv[0]}-{mv[1]}-{mv[2]} | {usd(sum(r.get('cost', 0) for r in rs))} |")
    rs = [r for r in rows if r["arm"] == "without"]
    out.append(f"| {label} | nothing installed | {sum(r['valid'] for r in rs)} | | | | | {usd(sum(r.get('cost', 0) for r in rs))} |")

out += ["", "## Failed checks per arm (count of jobs failing each check)", ""]
for label, d in RUNS.items():
    rows = rows_of(d)
    for arm in ("with", "without", "told"):
        fails = {}
        if not any(x["arm"] == arm for x in rows):
            continue  # the replicate has no told arm
        for r in (x for x in rows if x["arm"] == arm):
            for k, v in r["checks"].items():
                if not v:
                    fails[k] = fails.get(k, 0) + 1
        out.append(f"- {label}, {SHOW[arm]}: " + (", ".join(f"{k} {v}" for k, v in sorted(fails.items())) or "none"))

out += ["", "## Main runs where Pixelbolt was called: judged pairs (won-lost-tie; descriptive, not pre-registered)", ""]
for label, d in RUNS.items():
    rows, jm = rows_of(d), load(d, "judgements.json")
    used = {(r["model"], r["task"]) for r in rows if r["arm"] == "with" and r.get("pixelbolt_calls")}
    js = [j for j in jm if (j["model"], j["task"]) in used]
    w, o, t, _ = pairs(js, "with")
    out.append(f"- {label}: {len(used)} jobs; pairs {w}-{o}-{t}")

out += ["", "## Missing or wrong-size requested files (Pixelbolt arms)", ""]
for label, d in RUNS.items():
    rows = rows_of(d)
    miss = [(r["model"], r["task"], r["arm"]) for r in rows if r["arm"] != "without"
            and any(v == "missing" for v in r["files"].values())]
    out.append(f"- {label}: {len(miss)} jobs with a missing requested file: {miss}")
    sized = [(r["model"], r["task"], r["arm"]) for r in rows if r["arm"] != "without" and not r["checks"]["size"]
             and not any(v == "missing" for v in r["files"].values())]
    out.append(f"- {label}: {len(sized)} jobs with files present but the wrong size: {sized}")

out += ["", "## Judged pairs by who rendered the delivered files (descriptive, not pre-registered)", "",
        "From each run's who_rendered.json (successful Pixelbolt saves or copies vs Claude's own code; last writer wins).",
        "Pairs are won-lost-tie against nothing installed.", ""]
for label, d in list(RUNS.items())[1:]:
    wr = {(o["model"], o["task"], o["arm"]): o["kind"] for o in load(d, "who_rendered.json")}
    for arm, jf in (("with", "judgements.json"), ("told", "judgements-told.json")):
        js = load(d, jf)
        if not js:
            continue
        for kind in ("pixelbolt", "own code", "mixed"):
            sel = [j for j in js if wr.get((j["model"], j["task"], arm)) == kind]
            if not sel:
                continue
            w, o, t, _ = pairs(sel, arm)
            st = pairs([j for j in sel if KIND[j["task"]] == "static"], arm)
            mv = pairs([j for j in sel if KIND[j["task"]] == "moving"], arm)
            out.append(f"- {label}, {SHOW[arm]}, rendered by {kind}: {len(sel)} pairs, {w}-{o}-{t} "
                       f"(static {st[0]}-{st[1]}-{st[2]}, moving {mv[0]}-{mv[1]}-{mv[2]})")

POOL = [d for k, d in RUNS.items() if k.startswith("run 2")]
if len(POOL) > 1:
    n = 12 * len(POOL)
    out += ["", f"## Pooled: run 2 and its {len(POOL) - 1} replicate(s) (labelled pooled; no claim of its own, PLAN.md amendment 2)", "",
            f"| model | valid available /{n} | valid nothing installed /{n} | pairs won available vs nothing installed (ties) | sign test p |",
            "|---|---|---|---|---|"]
    for m in MODELS + ("all",):
        rs, js = [], []
        for d in POOL:
            rs += [r for r in rows_of(d) if (m == "all" or r["model"] == m)]
            js += [j for j in load(d, "judgements.json") if (m == "all" or j["model"] == m)]
        w, o, t, _ = pairs(js, "with")
        a = sum(r["valid"] for r in rs if r["arm"] == "with")
        b = sum(r["valid"] for r in rs if r["arm"] == "without")
        out.append(f"| {m} | {a} | {b} | {w} vs {o} ({t}) | {sign_test(w, o):.4f} |")
    out.append("")
    out.append(f"(For 'all', the valid counts are out of {3 * n}, less any dropped cells.)")

print("\n".join(out))
