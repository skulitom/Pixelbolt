"""Merges compile_interleave.py sessions: pools every run of each version per preset and gives the pooled medians and
their ratio, plus each session as written.

usage: python -I compile_interleave_merge.py <session-1.json> [<session-2.json> ...] <merged.json>

Configs as in compile_interleave.py: A = 0.9.0 compiling its own preset, B = 0.17.0 compiling its own preset,
C = 0.17.0 compiling 0.9.0's preset source (only where the sources differ). Times are whole commands, Node's start-up
included, in milliseconds.
"""
import json
import statistics
import sys

*inputs, out = sys.argv[1:]
sessions = [json.load(open(p, encoding="utf-8")) for p in inputs]
presets = list(sessions[0]["presets"])
pooled = {}
for p in presets:
    row = {"same_source_json": all(s["presets"][p]["same_source_json"] for s in sessions)}
    for c in "ABC":
        runs = [x for s in sessions for x in s["presets"][p].get(c, {}).get("all", [])]
        if runs:
            row[c] = {"runs": len(runs), "median_ms": round(statistics.median(runs), 1), "min_ms": min(runs), "max_ms": max(runs),
                      "recipe_sha256": sorted({h for s in sessions for h in s["presets"][p][c]["recipe_sha256"]})}
    row["B_over_A"] = round(row["B"]["median_ms"] / row["A"]["median_ms"], 3)
    pairs = [b / a for s in sessions for a, b in zip(s["presets"][p]["A"]["all"], s["presets"][p]["B"]["all"])]
    row["B_over_A_paired_median"] = round(statistics.median(pairs), 3)
    if "C" in row:
        pc = [c / a for s in sessions for a, c in zip(s["presets"][p]["A"]["all"], s["presets"][p]["C"]["all"])]
        row["C_over_A_paired_median"] = round(statistics.median(pc), 3)
    pooled[p] = row
ratios = [r["B_over_A"] for r in pooled.values()]
merged = {
    "what": "Pixelbolt 0.9.0 (A) against 0.17.0 (B): whole `pixelbolt compile` commands, the two versions alternated in "
            "every round, sessions pooled",
    "sessions": len(sessions), "rounds": [s["rounds"] for s in sessions],
    "node_version": sessions[0]["node_version"],
    "B_over_A_range": [min(ratios), max(ratios)],
    "same_source_presets": [p for p, r in pooled.items() if r["same_source_json"]],
    "pooled": pooled,
    "session_results": sessions,
}
with open(out, "w", encoding="utf-8", newline="\n") as f:
    json.dump(merged, f, indent=1)
    f.write("\n")
for p, r in pooled.items():
    print(f"{p:12} A {r['A']['median_ms']:7.1f} B {r['B']['median_ms']:7.1f} B/A {r['B_over_A']:.3f} same={r['same_source_json']}")
print("B/A range", merged["B_over_A_range"])
