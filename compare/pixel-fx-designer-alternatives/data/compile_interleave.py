"""Interleaved compile timing: Pixelbolt 0.9.0 (git archive of tag v0.9.0) against 0.17.0 (npm tarball).

usage: python -I compile_interleave.py <rounds> <fresh-out-dir> <result.json>

Configs per preset:
  A  0.9.0 bin compiling 0.9.0's own preset source
  B  0.17.0 bin compiling 0.17.0's own preset source   (what the page compares with A)
  C  0.17.0 bin compiling 0.9.0's preset source         (only where the sources differ)
  N  `node -e 0`, once per round (Node start-up)
Order inside a round rotates per (round, preset), so no config always runs first.
Whole-command wall time, Node start-up included, like the page's measure script.
"""
import hashlib, json, os, statistics, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
V090 = os.path.join(HERE, "v090")
V017 = os.path.join(HERE, "v017", "package")
PRESETS = ["campfire", "drip", "explosion", "magic-swirl", "potion", "smoke-puff", "splash", "steam-vent", "torch",
           "waterfall"]
NODE = "node"


def sha(p):
    with open(p, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def same_source(p):
    a = json.load(open(os.path.join(V090, "examples", p + ".fluid.json"), encoding="utf-8"))
    b = json.load(open(os.path.join(V017, "examples", p + ".fluid.json"), encoding="utf-8"))
    return a == b


def cmd(cfg, p, out):
    if cfg == "A":
        return [NODE, os.path.join(V090, "bin", "pixelbolt.js"), "compile", os.path.join(V090, "examples", p + ".fluid.json")]
    if cfg == "B":
        return [NODE, os.path.join(V017, "bin", "pixelbolt.js"), "compile", os.path.join(V017, "examples", p + ".fluid.json")]
    if cfg == "C":
        return [NODE, os.path.join(V017, "bin", "pixelbolt.js"), "compile", os.path.join(V090, "examples", p + ".fluid.json")]
    raise ValueError(cfg)


def main():
    rounds, out, result = int(sys.argv[1]), sys.argv[2], sys.argv[3]
    os.makedirs(out, exist_ok=False)
    same = {p: same_source(p) for p in PRESETS}
    t = {p: {c: [] for c in "ABC"} for p in PRESETS}
    hashes = {p: {c: set() for c in "ABC"} for p in PRESETS}
    node0 = []
    started = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    for r in range(rounds):
        s = time.perf_counter(); subprocess.run([NODE, "-e", "0"], check=True); node0.append((time.perf_counter() - s) * 1000)
        for i, p in enumerate(PRESETS):
            cfgs = ["A", "B"] if same[p] else ["A", "B", "C"]
            k = (r + i) % len(cfgs)
            cfgs = cfgs[k:] + cfgs[:k]
            for c in cfgs:
                d = os.path.join(out, f"r{r:02d}", c)
                os.makedirs(d, exist_ok=True)
                rec, meta = os.path.join(d, p + ".json"), os.path.join(d, p + ".meta.json")
                argv = cmd(c, p, d) + ["--out", rec, "--metadata", meta]
                s = time.perf_counter()
                pr = subprocess.run(argv, capture_output=True, text=True)
                ms = (time.perf_counter() - s) * 1000
                if pr.returncode:
                    raise SystemExit(f"{c} {p} failed: {pr.stderr}")
                t[p][c].append(ms)
                hashes[p][c].add(sha(rec))
        print(f"round {r + 1}/{rounds} done", flush=True)
    res = {"started": started, "ended": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "rounds": rounds,
           "node_version": subprocess.run([NODE, "--version"], capture_output=True, text=True).stdout.strip(),
           "node_startup_ms": {"median": round(statistics.median(node0), 1), "all": [round(x, 1) for x in node0]},
           "presets": {}}
    for p in PRESETS:
        row = {"same_source_json": same[p]}
        for c in "ABC":
            if t[p][c]:
                row[c] = {"median": round(statistics.median(t[p][c]), 1), "min": round(min(t[p][c]), 1),
                          "max": round(max(t[p][c]), 1), "all": [round(x, 1) for x in t[p][c]],
                          "recipe_sha256": sorted(h[:12] for h in hashes[p][c])}
        # paired ratios: B/A in the same round
        pairs = [b / a for a, b in zip(t[p]["A"], t[p]["B"])]
        row["B_over_A_median_of_medians"] = round(row["B"]["median"] / row["A"]["median"], 3)
        row["B_over_A_paired"] = {"median": round(statistics.median(pairs), 3), "min": round(min(pairs), 3),
                                  "max": round(max(pairs), 3)}
        n = statistics.median(node0)
        row["B_over_A_minus_node_startup"] = round((row["B"]["median"] - n) / (row["A"]["median"] - n), 3)
        if t[p]["C"]:
            pc = [c / a for a, c in zip(t[p]["A"], t[p]["C"])]
            row["C_over_A_paired_median"] = round(statistics.median(pc), 3)
        res["presets"][p] = row
    with open(result, "w", encoding="utf-8", newline="\n") as f:
        json.dump(res, f, indent=1)
    print(f"{'preset':12} {'A 0.9.0':>8} {'B 0.17.0':>8} {'B/A':>6} {'paired':>14} {'-node':>6} {'C/A':>6}")
    for p, row in res["presets"].items():
        pr = row["B_over_A_paired"]
        print(f"{p:12} {row['A']['median']:8.0f} {row['B']['median']:8.0f} {row['B_over_A_median_of_medians']:6.2f} "
              f"{pr['min']:4.2f}-{pr['median']:4.2f}-{pr['max']:4.2f} {row['B_over_A_minus_node_startup']:6.2f} "
              f"{row.get('C_over_A_paired_median', '') or '':>6}")
    print("node -e 0 median ms", res["node_startup_ms"]["median"])


main()
