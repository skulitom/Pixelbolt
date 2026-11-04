"""Pixelbolt benchmark summary: per-model valid counts, judge pairs, and PLAN.md's claim rules, from results.json and judgements.json.

Usage: python summary.py   -> prints a Markdown summary and writes summary.json
"""
import json
import math
import os
import statistics

BASE = os.path.dirname(os.path.abspath(__file__))
MODELS = ("haiku", "sonnet", "opus")


def sign_test(wins, losses):
    """Two-sided exact binomial test, p = 0.5, ties dropped."""
    n = wins + losses
    if n == 0:
        return 1.0
    k = min(wins, losses)
    p = sum(math.comb(n, i) for i in range(0, k + 1)) / 2 ** n
    return min(1.0, 2 * p)


def main():
    rows = [r for r in json.load(open(os.path.join(BASE, "results.json"), encoding="utf-8")) if not r["pilot"]]
    jpath = os.path.join(BASE, "judgements.json")
    judg = json.load(open(jpath, encoding="utf-8")) if os.path.exists(jpath) else []
    out, summ = [], {"models": {}}
    out.append("| model | valid with | valid without | pairs won with | won without | ties | Pixelbolt used | "
               "cost with $ | cost without $ | median s with | median s without | verdict |")
    out.append("|---|---|---|---|---|---|---|---|---|---|---|---|")
    tot = {"vw": 0, "vo": 0, "pw": 0, "po": 0, "pt": 0}
    for m in MODELS:
        w = [r for r in rows if r["model"] == m and r["arm"] == "with"]
        o = [r for r in rows if r["model"] == m and r["arm"] == "without"]
        if not w and not o:
            continue
        js = [j for j in judg if j["model"] == m]
        pw = sum(j["winner"] == "with" for j in js)
        po = sum(j["winner"] == "without" for j in js)
        pt = sum(j["winner"] == "tie" for j in js)
        vw, vo = sum(r["valid"] for r in w), sum(r["valid"] for r in o)
        helps = (vw - vo >= 3) and (pw > po)
        tasks_both = {r["task"] for r in w} & {r["task"] for r in o}
        s = dict(tasks=len(tasks_both), valid_with=vw, valid_without=vo, pairs_with=pw, pairs_without=po, ties=pt,
                 by_default=sum(j.get("pair") == "by default" for j in js), judged=len(js),
                 used=sum(1 for r in w if r.get("pixelbolt_calls")),
                 cost_with=round(sum(r.get("cost", 0) for r in w), 4),
                 cost_without=round(sum(r.get("cost", 0) for r in o), 4),
                 median_s_with=statistics.median([r.get("duration_s", 0) for r in w]) if w else None,
                 median_s_without=statistics.median([r.get("duration_s", 0) for r in o]) if o else None,
                 helps=helps)
        summ["models"][m] = s
        for k, v in (("vw", vw), ("vo", vo), ("pw", pw), ("po", po), ("pt", pt)):
            tot[k] += v
        out.append(f"| {m} | {vw}/{len(w)} | {vo}/{len(o)} | {pw} | {po} | {pt} | {s['used']}/{len(w)} | "
                   f"{s['cost_with']:.2f} | {s['cost_without']:.2f} | {s['median_s_with']} | {s['median_s_without']} | "
                   f"{'helps (rule met)' if helps else 'rule not met'} |")
    p = sign_test(tot["pw"], tot["po"])
    overall = (tot["vw"] - tot["vo"] >= 6) and p < 0.05 and tot["pw"] > tot["po"]
    summ.update(total=tot, sign_p=round(p, 4), overall_helps=overall)
    out.append("")
    out.append(f"All models: valid {tot['vw']} with vs {tot['vo']} without; pairs {tot['pw']}-{tot['po']} "
               f"({tot['pt']} ties); sign test p = {p:.4f}; overall rule {'met' if overall else 'not met'}.")
    json.dump(summ, open(os.path.join(BASE, "summary.json"), "w", encoding="utf-8"), indent=1)
    # the exploratory "told" arm (PLAN.md amendment 1), reported apart; it never feeds the rules above
    tpath, tjpath = os.path.join(BASE, "results-told.json"), os.path.join(BASE, "judgements-told.json")
    if os.path.exists(tpath) and os.path.exists(tjpath):
        rt, jt = json.load(open(tpath, encoding="utf-8")), json.load(open(tjpath, encoding="utf-8"))
        out.append("")
        out.append("Exploratory told arm vs nothing installed:")
        tw = to = tt = 0
        for m in MODELS:
            r = [x for x in rt if x["model"] == m]
            js = [j for j in jt if j["model"] == m]
            w, o, t = (sum(j["winner"] == k for j in js) for k in ("told", "without", "tie"))
            tw, to, tt = tw + w, to + o, tt + t
            out.append(f"- {m}: valid {sum(x['valid'] for x in r)}/{len(r)}, pairs {w}-{o} ({t} ties), "
                       f"cost ${sum(x.get('cost', 0) for x in r):.2f}")
        out.append(f"- all: pairs {tw}-{to} ({tt} ties), sign test p = {sign_test(tw, to):.4f}")
    print("\n".join(out))


if __name__ == "__main__":
    main()
