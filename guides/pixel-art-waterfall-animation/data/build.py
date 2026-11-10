"""Waterfall page kit: variants of Pixelbolt 0.15.0's shipped waterfall recipe, compiled and rendered with the npm build.

Usage: python build.py            -> out/<variant>/ (source, compiled frames, export folder, GIFs) and out/stats.json
Each variant is the shipped examples/waterfall.fluid.json with only its palette colours and name changed.
"""
import copy
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.normpath(os.path.join(HERE, "..", "c131", "pkg", "package"))
PB = ["node", os.path.join(PKG, "bin", "pixelbolt.js")]
OUT = os.path.join(HERE, "out")
BASE = json.load(open(os.path.join(PKG, "examples", "waterfall.fluid.json"), encoding="utf-8"))


def recolour(name, liquid, rock):
    s = copy.deepcopy(BASE)
    s["name"] = name
    s["palette"].update(liquid)
    s["palette"].update(rock)
    s["effects"] = {name: s["effects"].pop("waterfall")}
    return s


VARIANTS = {
    "waterfall": copy.deepcopy(BASE),
    "lavafall": recolour("lavafall",
                         {"B": "#7a1d0a", "b": "#cf3f14", "c": "#f58a1f", "w": "#ffe08a"},
                         {"r": "#4b4148", "R": "#372f35", "k": "#1f1a1f", "L": "#66585e", "m": "#2c2529"}),
    "slimefall": recolour("slimefall",
                          {"B": "#1e5a2c", "b": "#3c9a3a", "c": "#86d44a", "w": "#e6ffad"},
                          {"m": "#8a7a52"}),
    "moonlit-waterfall": recolour("moonlit-waterfall",
                                  {"B": "#1b2660", "b": "#2c3f8c", "c": "#5f76cc", "w": "#d4dcff"},
                                  {"r": "#4a4770", "R": "#39365c", "k": "#262341", "L": "#66629a", "m": "#2f6a55"}),
}
FEWER = {"waterfall": (12, 8)}  # the stone waterfall also as 12 and 8 frames (compile --frames)


def run(args, cwd):
    t = time.perf_counter()
    p = subprocess.run(PB + args, cwd=cwd, capture_output=True, text=True, encoding="utf-8")
    if p.returncode != 0:
        print("FAILED", args, p.stdout[-800:], p.stderr[-800:])
        sys.exit(1)
    return p.stdout, time.perf_counter() - t


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def build(name, src, frames=None):
    tag = name if not frames else f"{name}-{frames}f"
    d = os.path.join(OUT, tag)
    if os.path.exists(d):
        shutil.rmtree(d)
    os.makedirs(d)
    sp = os.path.join(d, f"{name}.fluid.json")
    if name == "waterfall":  # the shipped example, byte for byte
        shutil.copy(os.path.join(PKG, "examples", "waterfall.fluid.json"), sp)
    else:
        json.dump(src, open(sp, "w", encoding="utf-8", newline="\n"), indent=2)
    extra = ["--frames", str(frames)] if frames else []
    out, secs = run(["compile", f"{name}.fluid.json", "--out", f"{tag}.json", *extra], d)
    comp = json.loads(out)
    out2, _ = run(["compile", f"{name}.fluid.json", "--out", f"{tag}.again.json", *extra], d)
    same = sha(os.path.join(d, f"{tag}.json")) == sha(os.path.join(d, f"{tag}.again.json"))
    os.remove(os.path.join(d, f"{tag}.again.json"))
    rout, _ = run(["render", f"{tag}.json", "--out", "bundle", "--look", "--gif"], d)
    rend = json.loads(rout)
    run(["gif", f"{tag}.json", "--scale", "4", "--out", f"{tag}-4x.gif"], d)
    return dict(tag=tag, name=name, frames_asked=frames, compile_s=round(secs, 2), same_twice=same,
                warnings=comp.get("warnings"), delivered=rend.get("check", {}).get("delivered"),
                animations=rend.get("animations"), files=rend.get("files"))


def main():
    os.makedirs(OUT, exist_ok=True)
    only = sys.argv[1:]
    stats = []
    for name, src in VARIANTS.items():
        if only and name not in only:
            continue
        stats.append(build(name, src))
        for n in FEWER.get(name, ()):
            stats.append(build(name, src, n))
    path = os.path.join(OUT, "stats.json")
    old = json.load(open(path, encoding="utf-8")) if os.path.exists(path) and only else []
    keep = [o for o in old if o["tag"] not in {s["tag"] for s in stats}]
    json.dump(keep + stats, open(path, "w", encoding="utf-8"), indent=1)
    for s in stats:
        print(s["tag"], s["delivered"], "compile", s["compile_s"], "s", "same twice:", s["same_twice"], s["warnings"])


main()
