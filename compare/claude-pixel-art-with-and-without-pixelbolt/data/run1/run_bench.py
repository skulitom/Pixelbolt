"""Pixelbolt benchmark runner: each task in a fresh empty folder, with and without Pixelbolt 0.9.0, through your job wrapper.

Usage: python run_bench.py <model> [task ids...]       model: haiku | sonnet | opus
  default tasks: T01..T12 not yet run for that model (P0, the pilot, only when named)
  env: BENCH_ARMS=with,without (default both); BENCH_PARALLEL (default 3, never more)
"""
import json
import os
import re
import shutil
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

BASE = os.path.dirname(os.path.abspath(__file__))
BASH = os.environ.get("BENCH_BASH", "bash")  # [local path replaced]
WRAPPER = "path/to/your-job-wrapper.sh"
COSTS = "path/to/costs.tsv"
PKG = BASE.replace("\\", "/") + "/pixelbolt-0.9.0/bin/pixelbolt.js"
BUDGET = {"haiku": "0.60", "sonnet": "1.50", "opus": "3.00"}
CAP, JUDGE_RESERVE = 60.0, 8.0
ALLOWED = ["Read", "Write", "Edit", "Glob", "Grep", "Bash(node:*)", "Bash(python:*)", "Bash(cp:*)", "Bash(mv:*)",
           "Bash(mkdir:*)", "Bash(ls:*)"]
DENIED = ["WebSearch", "WebFetch", "Bash(npm:*)", "Bash(npx:*)", "Bash(pip:*)", "Bash(python -m pip:*)"]
lock = threading.Lock()
cut_decided = {}


def bench_spend():
    """This benchmark's own spend from costs.tsv: final costs of bench jobs, plus open reservations; and the dearest Opus job."""
    res, fin, opus_max = {}, 0.0, 0.0
    with open(COSTS, encoding="utf-8") as f:
        for line in f.read().splitlines()[1:]:
            c = line.split("\t")
            if len(c) < 9 or not c[4].startswith("bench"):
                continue
            if c[3] == "reserve":
                res[c[2]] = float(c[8] or 0)
            elif c[3] == "final":
                res.pop(c[2], None)
                fin += float(c[8] or 0)
                if c[5] == "opus" and not c[4].startswith("bench-judge"):
                    opus_max = max(opus_max, float(c[8] or 0))
    return fin + sum(res.values()), opus_max


def opus_allowed(tid):
    with lock:
        if tid not in cut_decided:
            spent, dearest = bench_spend()
            ok = spent + 2 * (dearest or 3.0) <= CAP - JUDGE_RESERVE
            # once a task is cut, every later task is cut too (cut from T12 backwards)
            if any(v is False for v in cut_decided.values()):
                ok = False
            cut_decided[tid] = ok
            print(f"opus {tid}: spent ${spent:.2f}, dearest ${dearest:.2f}: {'run' if ok else 'CUT'}", flush=True)
        return cut_decided[tid]


def run(job):
    task, arm, model = job
    tid = task["id"]
    if model == "opus" and not opus_allowed(tid):
        return tid, arm, None, "cut by the cap rule"
    runs = os.path.join(BASE, "runs", model)
    work = os.path.join(runs, f"{tid}-{arm}")
    if os.path.exists(work):
        shutil.rmtree(work)
    os.makedirs(work)
    pdir = os.path.join(BASE, "prompts")
    os.makedirs(pdir, exist_ok=True)
    pf = os.path.join(pdir, f"{tid}.txt" if arm != "told" else f"{tid}-told.txt")
    told = " Use the Pixelbolt MCP tools for this." if arm == "told" else ""  # PLAN.md amendment 1
    with open(pf, "w", encoding="utf-8", newline="\n") as f:
        f.write(task["prompt"] + told + "\n")
    allowed = list(ALLOWED)
    extra = []
    if arm in ("with", "told"):
        cfg = os.path.join(BASE, "mcp-pixelbolt.json")
        with open(cfg, "w", encoding="utf-8", newline="\n") as f:
            json.dump({"mcpServers": {"pixelbolt": {"command": "node", "args": [PKG, "mcp"]}}}, f)
        allowed.append("mcp__pixelbolt")
        extra = ["--mcp-config", cfg.replace("\\", "/")]
    env = dict(os.environ, BENCH_JOB_TIMEOUT="1500")
    env.pop("BENCH_JOB_EFFORT", None)
    name = f"bench-{model}-{tid}-{arm}"
    p = subprocess.run(
        [BASH, WRAPPER, work.replace("\\", "/"), pf.replace("\\", "/"), name, BUDGET[model], model, "--",
         "--allowedTools", ",".join(allowed), "--disallowedTools", ",".join(DENIED), "--max-turns", "60", *extra],
        capture_output=True, text=True, env=env)
    out = p.stdout + p.stderr
    with open(os.path.join(runs, f"{tid}-{arm}.wrapper.txt"), "w", encoding="utf-8") as f:
        f.write(out)
    m = re.search(r"job-wrapper: name=\S+ .*", out)
    return tid, arm, p.returncode, m.group(0) if m else out.strip()[-300:]


def main(model, ids):
    assert model in BUDGET
    tasks = json.load(open(os.path.join(BASE, "tasks.json"), encoding="utf-8"))
    if ids:
        tasks = [t for t in tasks if t["id"] in ids]
    else:
        tasks = [t for t in tasks if not t.get("pilot")]
    arms = os.environ.get("BENCH_ARMS", "with,without").split(",")
    jobs = []
    for t in tasks:
        for a in arms:
            if ids or not os.path.exists(os.path.join(BASE, "runs", model, f"{t['id']}-{a}.wrapper.txt")):
                jobs.append((t, a, model))
    os.makedirs(os.path.join(BASE, "runs", model), exist_ok=True)
    par = min(3, int(os.environ.get("BENCH_PARALLEL", "3")))
    with ThreadPoolExecutor(par) as ex:
        for tid, arm, rc, line in ex.map(run, jobs):
            print(f"{model} {tid}-{arm} rc={rc} {line}", flush=True)


main(sys.argv[1], sys.argv[2:])
