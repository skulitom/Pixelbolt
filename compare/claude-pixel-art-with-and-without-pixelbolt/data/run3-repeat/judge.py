"""[this benchmark] blind pairwise judge: for each task and model, two Opus jobs (sides swapped) through [our job wrapper].

Usage: python judge.py <model> [task ids...]   writes judge/<model>/<task>-<order>.{png,txt,json} and judgements.json
An arm wins a pair only if it wins both orders; if only one arm has any readable file it wins "by default".
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

from score import score_job
from sheets import make_pair

BASE = os.path.dirname(os.path.abspath(__file__))
ARM = os.environ.get("BENCH_ARM", "with")  # "told" for the exploratory arm (PLAN.md amendment 1)
SUFFIX = "" if ARM == "with" else f"-{ARM}"
BASH = os.environ.get("BENCH_BASH", "bash")  # [local path replaced]
WRAPPER = "path/to/your-job-wrapper.sh"

PROMPT = """You are judging two pixel-art results made for the same request. You don't know how either was made.

The request was:
"{request}"

Read the image {image}. Its top panel, labelled "Left", is one result; its bottom panel, labelled "Right", is the
other. Each file is shown frame by frame, scaled up with nearest-neighbour, then at its real size (1x) and 2x, on a
grey checkerboard where it is transparent. Tiles are also shown repeated 3x3. "no readable file" means it is missing.

Pick the better result, judging only what you see:
1. Does it fulfil the request (subject, size, frames, background, the files asked for)?
2. Does it read clearly at its real size?
3. Is it clean pixel art: clear outlines, no stray or noisy pixels, consistent light and shading, a sensible palette?
4. For animations and effects: is the motion smooth and believable, and does a loop close cleanly?

Say "Tie" only if neither is better overall. Reply with one line of JSON and nothing else:
{{"choice": "Left" or "Right" or "Tie", "reason": "one or two sentences"}}
"""


def first_left(task_id, model):
    return ARM if int(hashlib.sha256(f"{task_id}|{model}".encode()).hexdigest(), 16) % 2 == 0 else "without"


def readable(task, folder):
    from score import load
    for spec in task["files"]:
        try:
            load(os.path.join(folder, spec["name"]), spec)
            return True
        except Exception:
            pass
    return False


def judge_one(args):
    task, model, order, left = args
    jdir = os.path.join(BASE, "judge" + SUFFIX, model, f"{task['id']}-{order}")
    if os.path.exists(jdir):
        shutil.rmtree(jdir)
    os.makedirs(jdir)
    make_pair(task, model, left, os.path.join(jdir, "pair.png"), other=ARM)
    pf = os.path.join(jdir, "prompt.txt")
    with open(pf, "w", encoding="utf-8", newline="\n") as f:
        f.write(PROMPT.format(request=task["prompt"], image="pair.png (in the current folder)"))
    env = dict(os.environ, BENCH_JOB_TIMEOUT="300")
    env.pop("BENCH_JOB_EFFORT", None)
    p = subprocess.run(
        [BASH, WRAPPER, jdir.replace("\\", "/"), pf.replace("\\", "/"), f"bench-r3-rep-judge{SUFFIX}-{model}-{task['id']}-{order}",
         "0.60", "opus", "--", "--tools", "Read", "--allowedTools", "Read", "--max-turns", "4"],
        capture_output=True, text=True, env=env)
    out = p.stdout + p.stderr
    open(os.path.join(jdir, "wrapper.txt"), "w", encoding="utf-8").write(out)
    choice, reason = None, ""
    m = re.search(r"job-wrapper: stream: (\S+)", out)
    if m and os.path.exists(m.group(1)):
        for line in open(m.group(1), encoding="utf-8", errors="replace"):
            try:
                ev = json.loads(line)
            except ValueError:
                continue
            if ev.get("type") == "result" and isinstance(ev.get("result"), str):
                j = re.search(r"\{.*\}", ev["result"], re.S)
                if j:
                    try:
                        d = json.loads(j.group(0))
                        choice, reason = d.get("choice"), d.get("reason", "")
                    except ValueError:
                        pass
    winner = None
    if choice == "Left":
        winner = left
    elif choice == "Right":
        winner = "without" if left == ARM else ARM
    elif choice == "Tie":
        winner = "tie"
    cost = re.search(r"cost=\$([0-9.]+)", out)
    return dict(task=task["id"], model=model, order=order, left=left, choice=choice, winner=winner, reason=reason,
                cost=float(cost.group(1)) if cost else None)


def main(model, ids):
    tasks = [t for t in json.load(open(os.path.join(BASE, "tasks.json"), encoding="utf-8")) if not t.get("pilot")]
    if ids:
        tasks = [t for t in tasks if t["id"] in ids]
    jobs, results = [], []
    for t in tasks:
        dirs = {a: os.path.join(BASE, "runs", model, f"{t['id']}-{a}") for a in (ARM, "without")}
        if not all(os.path.exists(d + ".wrapper.txt") for d in dirs.values()):
            continue  # not run (or cut)
        has = {a: readable(t, d) for a, d in dirs.items()}
        if has[ARM] != has["without"]:
            w = ARM if has[ARM] else "without"
            results.append(dict(task=t["id"], model=model, pair="by default", winner=w))
            continue
        if not any(has.values()):
            results.append(dict(task=t["id"], model=model, pair="neither delivered", winner="tie"))
            continue
        a = first_left(t["id"], model)
        b = "without" if a == ARM else ARM
        jobs += [(t, model, 1, a), (t, model, 2, b)]
    with ThreadPoolExecutor(3) as ex:
        singles = list(ex.map(judge_one, jobs))
    for t in tasks:
        two = [s for s in singles if s["task"] == t["id"]]
        if len(two) == 2:
            ws = {s["winner"] for s in two}
            winner = ws.pop() if len(ws) == 1 and None not in ws else "tie"
            results.append(dict(task=t["id"], model=model, pair="judged", winner=winner, orders=two))
    path = os.path.join(BASE, f"judgements{SUFFIX}.json")
    old = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else []
    keep = [r for r in old if not (r["model"] == model and r["task"] in {x["task"] for x in results})]
    json.dump(keep + results, open(path, "w", encoding="utf-8"), indent=1)
    for r in results:
        print(r["model"], r["task"], r["pair"], r["winner"], [(o["choice"], o["cost"]) for o in r.get("orders", [])])


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
