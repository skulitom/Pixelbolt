"""[this benchmark] scorer: the deterministic checks of PLAN.md, the same for both arms, plus each job's stream facts.

Usage: python score.py [models...]   (default: haiku sonnet opus; reads runs/<model>/<task>-<arm>/)
Writes results.json and results.md next to this script.
"""
import json
import os
import re
import statistics
import sys

from PIL import Image

BASE = os.path.dirname(os.path.abspath(__file__))
ARMS = ("with", "without")


def norm(fr):
    """RGBA bytes with transparent pixels zeroed, so frames compare by what shows."""
    px = [(r, g, b, a) if a else (0, 0, 0, 0) for r, g, b, a in fr.getdata()]
    return tuple(px)


def load(path, spec):
    """Return (frames, notes) for one requested file; frames are RGBA images; raises if unreadable."""
    im = Image.open(path)
    notes = {"format": im.format, "size": list(im.size)}
    if spec["type"] == "gif":
        frames, durs = [], []
        for i in range(getattr(im, "n_frames", 1)):
            im.seek(i)
            frames.append(im.convert("RGBA"))
            durs.append(im.info.get("duration"))
        notes.update(n_frames=len(frames), loop=im.info.get("loop"), durations=durs, gif=im.format == "GIF")
        return frames, notes
    rgba = im.convert("RGBA")
    if spec["type"] == "sheet" and rgba.size == (spec["w"] * spec["n"], spec["h"]):
        return [rgba.crop((i * spec["w"], 0, (i + 1) * spec["w"], spec["h"])) for i in range(spec["n"])], notes
    return [rgba], notes


def seam_score(img, kind):
    """Colour change across wrap edges (or tile joins) over the mean change between neighbouring interior lines."""
    w, h = img.size
    px = img.convert("RGB").load()

    def coldiff(a, b):
        return sum(abs(px[a, y][k] - px[b, y][k]) for y in range(h) for k in range(3)) / h

    def rowdiff(a, b):
        return sum(abs(px[x, a][k] - px[x, b][k]) for x in range(w) for k in range(3)) / w

    interior = [coldiff(x, x + 1) for x in range(w - 1)] + [rowdiff(y, y + 1) for y in range(h - 1)]
    if kind == "wrap":
        edge = [coldiff(w - 1, 0), rowdiff(h - 1, 0)]
    else:  # joins between the 16x16 pieces of a 3x3 set
        edge = [coldiff(15, 16), coldiff(31, 32), rowdiff(15, 16), rowdiff(31, 32)]
    base = statistics.mean(interior) or 1e-9
    return round(statistics.mean(edge) / base, 3)


def score_job(task, folder):
    checks = {k: True for k in ("files", "size", "crisp", "palette", "background", "content")}
    if task["kind"] in ("anim", "effect"):
        checks.update(frames=True, motion=True)
    info, per_file = {}, {}
    for spec in task["files"]:
        path = os.path.join(folder, spec["name"])
        if not os.path.isfile(path):
            checks = {k: False for k in checks}
            per_file[spec["name"]] = "missing"
            continue
        try:
            frames, notes = load(path, spec)
        except Exception as e:  # unreadable file
            checks = {k: False for k in checks}
            per_file[spec["name"]] = f"unreadable: {e}"
            continue
        per_file[spec["name"]] = notes
        # size
        if spec["type"] == "png":
            ok = notes["size"] == [spec["w"], spec["h"]]
        elif spec["type"] == "sheet":
            ok = notes["size"] == [spec["w"] * spec["n"], spec["h"]]
        else:
            ok = all(f.size == (spec["w"], spec["h"]) for f in frames)
        checks["size"] &= ok
        # frames and loop (GIF)
        if spec["type"] == "gif":
            ok = notes.get("gif") and notes["n_frames"] == spec["n"]
            if task.get("loop"):
                ok = ok and notes.get("loop") == 0
            checks["frames"] &= bool(ok)
        if spec["type"] == "sheet" and len(frames) != spec["n"]:
            checks["frames"] = False
        alphas = [set(f.getchannel("A").getdata()) for f in frames]
        checks["crisp"] &= all(a <= {0, 255} for a in alphas)
        colours = set()
        for f in frames:
            colours |= {(r, g, b) for r, g, b, a in f.getdata() if a == 255}
        notes["colours"] = len(colours)
        checks["palette"] &= len(colours) <= task["palette"]
        opaque = [sum(1 for a in f.getchannel("A").getdata() if a == 255) / (f.size[0] * f.size[1]) for f in frames]
        notes["opaque_share"] = [round(o, 3) for o in opaque]
        if task["background"] == "opaque":
            checks["background"] &= all(o == 1 for o in opaque)
        else:
            for f, o in zip(frames, opaque):
                w, h = f.size
                corners = [f.getpixel(p)[3] for p in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1))]
                checks["background"] &= all(c == 0 for c in corners) and (1 - o) >= 0.20
        empties = [i for i, f in enumerate(frames) if not any(a > 0 for a in f.getchannel("A").getdata())]
        if task["kind"] == "effect" and not task.get("loop"):
            empties = [i for i in empties if i != len(frames) - 1]
        checks["content"] &= max(opaque) >= 0.10 and not empties
        if "motion" in checks and len(frames) > 1:
            n = [norm(f) for f in frames]
            ok = all(n[i] != n[i + 1] for i in range(len(n) - 1))
            if task.get("loop"):
                ok = ok and n[-1] != n[0]
            checks["motion"] &= ok
        elif "motion" in checks:
            checks["motion"] = False
        if task.get("seam") and checks["size"]:
            info["seam_ratio"] = seam_score(frames[0], task["seam"])
        if spec["type"] == "sheet":
            info["_sheet"] = [norm(f) for f in frames]
        if spec["type"] == "gif":
            info["_gif"] = [norm(f) for f in frames]
    if "_sheet" in info and "_gif" in info:
        info["gif_matches_sheet"] = info["_sheet"] == info["_gif"]
    info.pop("_sheet", None)
    info.pop("_gif", None)
    return checks, info, per_file


def stream_facts(wrapper_txt):
    facts = {}
    txt = open(wrapper_txt, encoding="utf-8", errors="replace").read()
    m = re.search(r"exit=(\d+) duration=(\d+)s cost=\$([0-9.]+)", txt)
    if m:
        facts.update(exit=int(m.group(1)), duration_s=int(m.group(2)), cost=float(m.group(3)))
    facts["timed_out"] = "TIMED OUT" in txt
    m = re.search(r"job-wrapper: stream: (\S+)", txt)
    if not m or not os.path.exists(m.group(1)):
        return facts
    facts["stream"] = m.group(1)
    tools = {}
    for line in open(m.group(1), encoding="utf-8", errors="replace"):
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if ev.get("type") == "system" and ev.get("subtype") == "init":
            facts["model_id"] = ev.get("model")
            facts["key"] = ev.get("apiKeySource")
            facts["mcp"] = {s.get("name"): s.get("status") for s in ev.get("mcp_servers", [])}
        elif ev.get("type") == "assistant":
            for c in ev.get("message", {}).get("content", []):
                if c.get("type") == "tool_use":
                    name = c.get("name")
                    if name == "Bash":
                        name = "Bash:" + (c.get("input", {}).get("command", "").split() or ["?"])[0]
                    tools[name] = tools.get(name, 0) + 1
        elif ev.get("type") == "result":
            facts.update(result=ev.get("subtype"), turns=ev.get("num_turns"), is_error=ev.get("is_error"),
                         stream_cost=ev.get("total_cost_usd"), usage=ev.get("usage"))
    facts["tools"] = tools
    facts["pixelbolt_calls"] = sum(v for k, v in tools.items() if k.startswith("mcp__pixelbolt"))
    return facts


def main(models):
    tasks = json.load(open(os.path.join(BASE, "tasks.json"), encoding="utf-8"))
    rows = []
    for model in models:
        for t in tasks:
            for arm in ARMS:
                folder = os.path.join(BASE, "runs", model, f"{t['id']}-{arm}")
                wt = folder + ".wrapper.txt"
                if not os.path.exists(wt):
                    continue
                checks, info, per_file = score_job(t, folder)
                row = dict(model=model, task=t["id"], arm=arm, pilot=bool(t.get("pilot")), checks=checks,
                           valid=all(checks.values()), info=info, files=per_file, **stream_facts(wt))
                rows.append(row)
    json.dump(rows, open(os.path.join(BASE, "results.json"), "w", encoding="utf-8"), indent=1, default=str)
    out = ["| model | arm | jobs | valid | checks failed (count) | Pixelbolt used | cost $ | median s | caps hit |",
           "|---|---|---|---|---|---|---|---|---|"]
    for model in models:
        for arm in ARMS:
            rs = [r for r in rows if r["model"] == model and r["arm"] == arm and not r["pilot"]]
            if not rs:
                continue
            fails = {}
            for r in rs:
                for k, v in r["checks"].items():
                    if not v:
                        fails[k] = fails.get(k, 0) + 1
            caps = sum(1 for r in rs if r.get("timed_out") or (r.get("result") or "").startswith("error"))
            used = sum(1 for r in rs if r.get("pixelbolt_calls"))
            out.append(f"| {model} | {arm} | {len(rs)} | {sum(r['valid'] for r in rs)} | "
                       f"{', '.join(f'{k} {v}' for k, v in sorted(fails.items())) or '-'} | "
                       f"{used if arm == 'with' else '-'} | {sum(r.get('cost', 0) for r in rs):.2f} | "
                       f"{statistics.median([r.get('duration_s', 0) for r in rs]):.0f} | {caps} |")
    out += ["", "| model | task | arm | valid | failed | colours | seam | gif=sheet | Pixelbolt calls | turns | cost $ | s | result |",
            "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        cols = [v.get("colours") for v in r["files"].values() if isinstance(v, dict)]
        out.append(f"| {r['model']} | {r['task']} | {r['arm']} | {'yes' if r['valid'] else 'no'} | "
                   f"{', '.join(k for k, v in r['checks'].items() if not v) or '-'} | {cols} | "
                   f"{r['info'].get('seam_ratio', '')} | {r['info'].get('gif_matches_sheet', '')} | "
                   f"{r.get('pixelbolt_calls', 0)} | {r.get('turns')} | {r.get('cost', 0):.2f} | "
                   f"{r.get('duration_s')} | {r.get('result')}{' TIMEOUT' if r.get('timed_out') else ''} |")
    open(os.path.join(BASE, "results.md"), "w", encoding="utf-8").write("\n".join(out) + "\n")
    print("\n".join(out))


if __name__ == "__main__":
    main(sys.argv[1:] or ["haiku", "sonnet", "opus"])
