"""Score the exploratory "told" arm with score.py's own checks; writes results-told.json. Usage: python score_told.py"""
import json
import os

from score import score_job, stream_facts

BASE = os.path.dirname(os.path.abspath(__file__))
tasks = [t for t in json.load(open(os.path.join(BASE, "tasks.json"), encoding="utf-8")) if not t.get("pilot")]
rows = []
for m in ("haiku", "sonnet", "opus"):
    for t in tasks:
        folder = os.path.join(BASE, "runs", m, f"{t['id']}-told")
        checks, info, files = score_job(t, folder)
        rows.append(dict(model=m, task=t["id"], arm="told", pilot=False, checks=checks, valid=all(checks.values()),
                         info=info, files=files, **stream_facts(folder + ".wrapper.txt")))
json.dump(rows, open(os.path.join(BASE, "results-told.json"), "w", encoding="utf-8"), indent=1, default=str)
print(sum(r["valid"] for r in rows), "valid of", len(rows))
