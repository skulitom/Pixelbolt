"""Times pixelfx's sprite-sheet command for the same six effects, three rounds, each round running every effect once
in turn (so a slow start or a busy moment doesn't land on one effect), each command in a new folder and process.
This script is ours (Pixelbolt's makers), not part of pixelfx.

usage: python -I patchgg-pixelfx_timing.py <pixelfx checkout> <new workdir> <result.json>
Times whole `node <checkout>/tools/render.mjs <id> --sheet --out <dir>` commands, Node's start-up included.
"""
import json
import os
import shutil
import subprocess
import sys
import time

EFFECTS = ["fire/campfire", "explosions/smoke-bomb", "explosions/big-explosion", "water/splash",
           "lightning/lightning-strike", "arcane/portal"]


def main():
    root, work, result = sys.argv[1:4]
    root = os.path.abspath(root)
    node = shutil.which("node")
    render = os.path.join(root, "tools", "render.mjs")
    os.makedirs(work, exist_ok=False)
    work = os.path.abspath(work)
    times = {e: [] for e in EFFECTS}
    for rnd in (1, 2, 3):
        for e in EFFECTS:
            d = os.path.join(work, f"round{rnd}", e.replace("/", "-"))
            os.makedirs(d)
            t = time.perf_counter()
            p = subprocess.run([node, render, e, "--sheet", "--out", d], capture_output=True, text=True, cwd=d)
            wall = time.perf_counter() - t
            if p.returncode != 0:
                raise SystemExit(f"{e} failed: {p.stderr}")
            times[e].append(round(wall, 3))
    out = {"node": subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip(),
           "command": "node tools/render.mjs <id> --sheet --out <new dir>", "rounds": 3,
           "wall_s": times, "median_s": {e: sorted(v)[1] for e, v in times.items()}}
    with open(result, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    print(json.dumps(out["median_s"]))


if __name__ == "__main__":
    main()
