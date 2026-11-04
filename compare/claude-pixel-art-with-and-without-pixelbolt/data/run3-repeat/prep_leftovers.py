"""[this benchmark] replicate 3, before any job (PLAN.md amendment 5): move aside the files that earlier [this benchmark] jobs (run 1, run 2,
the told arm, replicate 2, their judges) wrote into the shared temp folders C:\\tmp\\ and %TEMP%, so replicate 3's
jobs can't find them. Only exact files those jobs' streams show them writing (Write/Edit, shell redirection, cp/mv
targets) are moved; other agents' files stay. Dry run by default; --move moves them into leftovers-moved/ and writes
leftovers-moved/MANIFEST.txt (original path, size, mtime, sha256, the job that wrote it). Undo: move each file back
to the original path in the manifest.
Usage: python -I prep_leftovers.py [--move]
"""
import glob
import hashlib
import json
import os
import re
import shutil
import sys
from datetime import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
GTEMP = "C:/Users/[user]/appdata/local/temp"
ROOTS = {"c:/tmp": "C-tmp", GTEMP: "TEMP"}
STREAMS = glob.glob("[job logs]/*-bench-*.jsonl")


def norm(p, tool):
    p = p.strip("\"'").replace("\\", "/")
    if p.startswith("/tmp/"):
        p = ("c:/tmp" if tool else GTEMP) + p[4:]
    m = re.match(r"^/([a-zA-Z])/(.*)", p)
    if m:
        p = m.group(1) + ":/" + m.group(2)
    return os.path.normpath(p).replace("\\", "/").lower() if re.match(r"^[a-zA-Z]:/", p) else None


found = {}
for s in sorted(STREAMS):
    pend = {}
    for line in open(s, encoding="utf-8", errors="replace"):
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if ev.get("type") != "assistant":
            continue
        for c in ev["message"].get("content", []):
            if c.get("type") != "tool_use" or not isinstance(c.get("input"), dict):
                continue
            paths = []
            if c["name"] in ("Write", "Edit"):
                paths.append(norm(str(c["input"].get("file_path", "")), True))
            elif c["name"] == "Bash":
                cmd = str(c["input"].get("command", ""))
                for m in re.finditer(r"(?:>|tee)\s*(\"[^\"]+\"|'[^']+'|[^\s\"'<>|;&]+)", cmd):
                    paths.append(norm(m.group(1), False))
                for m in re.finditer(r"\b(?:cp|mv)\s+(?:-\w+\s+)*\S+\s+(\"[^\"]+\"|'[^']+'|[^\s\"'<>|;&]+)", cmd):
                    paths.append(norm(m.group(1), False))
            for p in paths:
                if not p:
                    continue
                for root in ROOTS:
                    if p.startswith(root + "/") and not p.startswith(GTEMP + "/claude/") and os.path.isfile(p):
                        found.setdefault(p, []).append(s)


def window(s):
    st = os.stat(s)
    return getattr(st, "st_birthtime", st.st_ctime) - 5, st.st_mtime + 5


# Only a file last modified while a [this benchmark] job that wrote it was running is ours; a later or earlier mtime means
# another agent's job wrote the file now there (it stays).
skipped = {p: ss for p, ss in found.items() if not any(window(s)[0] <= os.stat(p).st_mtime <= window(s)[1] for s in ss)}
found = {p: os.path.basename(next(s for s in ss if window(s)[0] <= os.stat(p).st_mtime <= window(s)[1]))
         for p, ss in found.items() if p not in skipped}

move = "--move" in sys.argv
dest = os.path.join(BASE, "leftovers-moved")
lines = []
for p, job in sorted(found.items()):
    root = next(r for r in ROOTS if p.startswith(r + "/"))
    rel = p[len(root) + 1:]
    st = os.stat(p)
    h = hashlib.sha256(open(p, "rb").read()).hexdigest()
    lines.append(f"{p}\t{st.st_size}\t{datetime.fromtimestamp(st.st_mtime):%Y-%m-%d %H:%M}\t{h}\t{job}\t"
                 f"leftovers-moved/{ROOTS[root]}/{rel}")
    if move:
        t = os.path.join(dest, ROOTS[root], rel)
        os.makedirs(os.path.dirname(t), exist_ok=True)
        shutil.move(p, t)
print(f"{len(lines)} files written by [this benchmark] jobs are still in C:\\tmp or %TEMP%" + (" (moved)" if move else " (dry run)"))
for x in lines:
    print(" ", x.split("\t")[0], x.split("\t")[2], x.split("\t")[4][:60])
print(f"{len(skipped)} paths a [this benchmark] job wrote now hold a file modified outside that job's run (left in place):")
for p in sorted(skipped):
    print("  ", p, f"{datetime.fromtimestamp(os.stat(p).st_mtime):%Y-%m-%d %H:%M}")
if move:
    os.makedirs(dest, exist_ok=True)
    with open(os.path.join(dest, "MANIFEST.txt"), "w", encoding="utf-8", newline="\n") as f:
        f.write(f"# moved {datetime.now():%Y-%m-%d %H:%M:%S} by prep_leftovers.py ([this benchmark] replicate 3, PLAN.md amendment 5)\n")
        f.write("# original path\tbytes\tmtime\tsha256\tstream that wrote it\tnow at\n")
        f.write("\n".join(lines) + "\n")
