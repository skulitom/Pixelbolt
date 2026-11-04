"""[this benchmark] replicate 3 per-job script check (PLAN.md amendment 5). Read-only: it prints and writes stale3.json.

A job is FLAGGED when either holds:
  (a) it ran a script (python/node/bash/sh <path>.py|.js|.mjs|.sh) that it never wrote in that job, or it copied
      or moved in (cp/mv, the command succeeded) a file from outside its job folder and tmp/ folder that it never
      wrote in that job; or
  (b) it wrote a script at a shared path (outside its own job folder and its own tmp/ folder) that another
      replicate-3 job also wrote while both jobs were running (their reserve-to-final windows in costs.tsv overlap).
Path mapping (tested 2026-10-27 14:58 and in review 3 of run 2):
  - Claude Code's Write/Edit tools put "/tmp/x" at C:\\tmp\\x;
  - Git Bash puts "/tmp/x" at the shared %TEMP%, whatever TEMP the job was given;
  - $TEMP, $TMP and $TMPDIR are the job's own tmp/<model>/<task>-<arm>/ folder.
Scripts inside the Pixelbolt export (the arm's own package) never count for (a).
A run that failed to start (can't open file, module not found, or a Claude Code refusal) is "not run".
Addendum 6a (2026-11-03): a node run whose output is only the loader header (cut by `| head -1`) is "not run"
when a later run of the same path in that job says "Cannot find module" for it.
Usage: python -I stale3.py [models...]
"""
import json
import os
import re
import sys
from datetime import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
GTEMP = "C:/Users/[user]/appdata/local/temp"
COSTS = "[job logs]/costs.tsv"
PKG = os.path.normpath(os.path.join(BASE, "pkg", "package")).replace("\\", "/").lower()  # amendment 6
SCRIPT = r"\.(?:py|js|mjs|sh)"


def text(c):
    x = c.get("content")
    return "".join(y.get("text", "") for y in x if isinstance(y, dict)) if isinstance(x, list) else str(x)


def norm(p, tool, cwd, jtmp):
    p = p.strip("\"'").replace("\\", "/")
    for v in ("${TEMP}", "$TEMP", "${TMPDIR}", "$TMPDIR", "${TMP}", "$TMP"):
        p = p.replace(v, jtmp)
    if p == "/tmp" or p.startswith("/tmp/"):
        p = ("c:/tmp" if tool else GTEMP) + p[4:]
    m = re.match(r"^/([a-zA-Z])/(.*)", p)
    if m:
        p = m.group(1) + ":/" + m.group(2)
    if not re.match(r"^[a-zA-Z]:/", p):
        p = cwd.rstrip("/") + "/" + p
    return os.path.normpath(p).replace("\\", "/").lower()


def windows():
    """job name -> (start, end) from costs.tsv reserve and final lines."""
    w = {}
    for line in open(COSTS, encoding="utf-8").read().splitlines()[1:]:
        c = line.split("\t")
        if len(c) < 9 or not c[4].startswith("bench-r3-main-"):
            continue
        t = datetime.strptime(c[0], "%Y-%m-%dT%H:%M:%SZ")
        s, e = w.get(c[4], (None, None))
        if c[3] == "reserve":
            w[c[4]] = (t, e)
        elif c[3] == "final":
            w[c[4]] = (s, t)
    return w


def scan(model, cell):
    jd = os.path.normpath(os.path.join(BASE, "runs", model, cell)).replace("\\", "/").lower()
    jt = os.path.normpath(os.path.join(BASE, "tmp", model, cell)).replace("\\", "/").lower()
    wt = open(os.path.join(BASE, "runs", model, cell + ".wrapper.txt"), encoding="utf-8", errors="replace").read()
    m = re.search(r"job-wrapper: stream: (\S+)", wt)
    written, pend, ran, copied, missing = set(), {}, [], [], set()
    for line in open(m.group(1), encoding="utf-8", errors="replace"):
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if ev.get("type") == "assistant":
            for c in ev["message"].get("content", []):
                if c.get("type") == "tool_use":
                    pend[c["id"]] = c
        elif ev.get("type") == "user" and isinstance(ev["message"].get("content"), list):
            for c in ev["message"]["content"]:
                if c.get("type") != "tool_result":
                    continue
                call = pend.get(c.get("tool_use_id"))
                if not call:
                    continue
                inp = call["input"] if isinstance(call["input"], dict) else {}
                err = bool(c.get("is_error"))
                if call["name"] in ("Write", "Edit") and not err:
                    written.add(norm(str(inp.get("file_path", "")), True, jd, jt))
                elif call["name"] == "Bash":
                    cmd = str(inp.get("command", ""))
                    # addendum 5b (15:48, before scoring): expand shell variables the same command assigns,
                    # e.g. D="<job folder>"; python "$D/x.py" (export and plain assignments, quoted or not)
                    for mm in re.finditer(r"(?:^|[;&\n]|export\s)\s*([A-Za-z_]\w*)=(\"[^\"]*\"|'[^']*'|[^\s;&|]+)", cmd):
                        val = mm.group(2).strip("\"'")
                        cmd = cmd.replace("${" + mm.group(1) + "}", val)
                        cmd = re.sub(r"\$" + mm.group(1) + r"(?![A-Za-z0-9_])", lambda _m, v=val: v, cmd)
                    cwd = jd
                    mm = re.match(r"\s*cd\s+(\"[^\"]+\"|'[^']+'|\S+)\s*&&", cmd)
                    if mm:
                        cwd = norm(mm.group(1), False, jd, jt)
                    if not err:
                        for mm in re.finditer(r"(?:>|tee)\s*(\"[^\"]+\"|'[^']+'|[^\s\"'<>|;&]+)", cmd):
                            written.add(norm(mm.group(1), False, cwd, jt))
                    for mm in re.finditer(r"\b(?:cp|mv)\s+(?:-\w+\s+)*(\"[^\"]+\"|'[^']+'|[^\s\"'<>|;&]+)\s+(\"[^\"]+\"|'[^']+'|[^\s\"'<>|;&]+)", cmd):
                        src = norm(mm.group(1), False, cwd, jt)
                        if (not err and src not in written and not src.startswith(jd + "/") and not src.startswith(jt + "/")
                                and not src.startswith(PKG + "/")):
                            copied.append(src)  # rule (a'): a file copied in from outside, never written by this job
                        if not err:
                            written.add(norm(mm.group(2), False, cwd, jt))
                    for mm in re.finditer(r"\b(?:python3?|node|bash|sh)\s+(?:-[Iuc]\s+)*(\"[^\"]+" + SCRIPT + r"\"|'[^']+"
                                          + SCRIPT + r"'|[^\s\"';&|<>]+" + SCRIPT + r")", cmd):
                        k = norm(mm.group(1), False, cwd, jt)
                        if k in written or k.startswith(PKG + "/"):
                            continue
                        out = text(c)
                        # fixed 2026-10-27 15:18, before scoring, to match the docstring: "can't open file" or
                        # "Cannot find module" means not run even when the command as a whole succeeded (`...; ls`)
                        started = not ("can't open file" in out or "Cannot find module" in out
                                       or (err and not out.startswith("Exit code")))
                        # addendum 6a (2026-11-03, before scoring): a later run of the same path in the same job that
                        # says "Cannot find module '<that path>'" shows that an earlier run cut by `| head -1` (output
                        # only node's loader header) never found the file either
                        for mm2 in re.finditer(r"Cannot find module '([^']+)'", out):
                            missing.add(norm(mm2.group(1), False, cwd, jt))
                        if started:
                            ran.append((k, out[:150].replace("\n", " ")))
    ran = [(k, o) for k, o in ran if not (k in missing and o.startswith("node:internal/modules/cjs/loader"))]
    shared = sorted(p for p in written if re.search(SCRIPT + "$", p)
                    and not p.startswith(jd + "/") and not p.startswith(jt + "/"))
    return ran + [(p, "copied in (cp/mv), never written by this job") for p in copied], shared


def main(models):
    win = windows()
    cells = {}
    for model in models:
        d = os.path.join(BASE, "runs", model)
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if f.endswith(".wrapper.txt"):
                cell = f[: -len(".wrapper.txt")]
                cells[(model, cell)] = scan(model, cell)
    flags = {}
    for key, (ran, shared) in cells.items():
        if ran:
            flags.setdefault(key, []).append({"rule": "a", "ran_not_written": ran})
    keys = list(cells)
    for i, k1 in enumerate(keys):
        for k2 in keys[i + 1:]:
            both = set(cells[k1][1]) & set(cells[k2][1])
            if not both:
                continue
            w1 = win.get(f"bench-r3-main-{k1[0]}-{k1[1]}", (None, None))
            w2 = win.get(f"bench-r3-main-{k2[0]}-{k2[1]}", (None, None))
            if None in w1 or None in w2 or (w1[0] <= w2[1] and w2[0] <= w1[1]):
                for a, b in ((k1, k2), (k2, k1)):
                    flags.setdefault(a, []).append({"rule": "b", "shared_paths": sorted(both), "with": "-".join(b)})
    print(f"{len(cells)} jobs checked; {len(flags)} flagged")
    for (model, cell), why in sorted(flags.items()):
        print(" FLAG", model, cell, json.dumps(why))
    for (model, cell), (ran, shared) in sorted(cells.items()):
        if shared:
            print(" shared writes (not a flag by themselves):", model, cell, shared)
    json.dump({"checked": len(cells), "flagged": {f"{m}/{c}": w for (m, c), w in flags.items()}},
              open(os.path.join(BASE, "stale3.json"), "w", encoding="utf-8"), indent=1)


main(sys.argv[1:] or ["haiku", "sonnet", "opus"])
