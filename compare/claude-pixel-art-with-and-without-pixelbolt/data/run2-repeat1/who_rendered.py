"""[this benchmark]: who made each delivered file in the Pixelbolt arms (available "with" and "told"): Pixelbolt or Claude's own code.

A requested file counts as Pixelbolt's when a SUCCESSFUL pixel_render call saved it (saveAs) or a successful cp/mv
copied it out of Pixelbolt's output/ folder; as own code when a later successful python/node run saved it (the last
writer wins). Failed calls (is_error, or a reply starting with {"error") count for nothing. Logic after review 1's
rendered.py ([a local folder]/review-1/).

Usage: python who_rendered.py [folder]   (default: this script's folder; the replicate has no told arm)
Prints one line per job and totals; writes <folder>/who_rendered.json
"""
import collections
import json
import os
import re
import sys

BASE = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
tasks = {t["id"]: t for t in json.load(open(os.path.join(BASE, "tasks.json"), encoding="utf-8")) if not t.get("pilot")}
rows = [r for r in json.load(open(os.path.join(BASE, "results.json"), encoding="utf-8")) if not r["pilot"]]
if os.path.exists(os.path.join(BASE, "results-told.json")):
    rows += json.load(open(os.path.join(BASE, "results-told.json"), encoding="utf-8"))
SAVE = re.compile(r"\.save\(|save_all|writeFile|imwrite", re.I)
out = []
for r in rows:
    if r["arm"] == "without":
        continue
    names = [f["name"] for f in tasks[r["task"]]["files"]]
    pending, scripts, last = {}, {}, {n: None for n in names}
    saveas_ok = saveas_failed = copies = 0
    for line in open(r["stream"], encoding="utf-8", errors="replace"):
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if ev.get("type") == "assistant":
            for c in ev["message"].get("content", []):
                if c.get("type") == "tool_use":
                    pending[c["id"]] = c
                    if c["name"] == "Write":
                        scripts[os.path.basename(str(c["input"].get("file_path", "")))] = c["input"].get("content", "")
        elif ev.get("type") == "user" and isinstance(ev["message"].get("content"), list):
            for c in ev["message"]["content"]:
                if c.get("type") != "tool_result" or c.get("tool_use_id") not in pending:
                    continue
                call = pending[c["tool_use_id"]]
                name, inp, err = call["name"], call["input"], bool(c.get("is_error"))
                x = c.get("content")
                x = "".join(y.get("text", "") for y in x if isinstance(y, dict)) if isinstance(x, list) else str(x)
                if name.startswith("mcp__pixelbolt") and isinstance(inp.get("saveAs"), dict):
                    if err or '"error"' in x[:50]:
                        saveas_failed += 1
                        continue
                    saveas_ok += 1
                    for v in inp["saveAs"].values():
                        if os.path.basename(str(v)) in last:
                            last[os.path.basename(str(v))] = "pixelbolt"
                elif name == "Bash" and not err:
                    cmd = inp.get("command", "")
                    if re.search(r"(^|[\s;&])(cp|mv)\s", cmd) and "output" in cmd:
                        hit = [n for n in names if n in cmd]
                        copies += bool(hit)
                        for n in hit:
                            last[n] = "pixelbolt"
                    elif re.search(r"\b(python3?|node)\b", cmd):
                        text = cmd + "".join("\n" + body for s, body in scripts.items() if s in cmd)
                        if SAVE.search(text):
                            for n in names:
                                stem = os.path.splitext(n)[0]
                                # the stem must end at a dot or a quote: 'walk' must not match 'walk-contact-a'
                                if n in text or re.search(r"""['"]""" + re.escape(stem) + r"""['".]""", text):
                                    last[n] = "own code"
    vals = set(last.values())
    kind = vals.pop() if len(vals) == 1 else "mixed"
    if kind is None:
        kind = "none found"
    out.append(dict(model=r["model"], task=r["task"], arm=r["arm"], valid=r["valid"], kind=kind,
                    by_file=last, saveas_ok=saveas_ok, saveas_failed=saveas_failed, copies=copies,
                    pixelbolt_calls=r.get("pixelbolt_calls")))
json.dump(out, open(os.path.join(BASE, "who_rendered.json"), "w", encoding="utf-8"), indent=1)
for o in out:
    if o["kind"] != "pixelbolt" or o["saveas_failed"]:
        print(o["model"], o["task"], o["arm"], "valid" if o["valid"] else "INVALID", o["kind"], o["by_file"],
              f"saveAs ok {o['saveas_ok']} failed {o['saveas_failed']}", f"calls {o['pixelbolt_calls']}")
print(dict(collections.Counter((o["arm"], o["kind"]) for o in out)))
print("jobs with a successful saveAs:", sum(1 for o in out if o["saveas_ok"]),
      "| delivered only by copying out of output/:", sum(1 for o in out if o["copies"] and not o["saveas_ok"] and o["kind"] == "pixelbolt"))
