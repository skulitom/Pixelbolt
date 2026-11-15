"""Runs codixel_effects.cjs for Codixel's built-in effects, twice each in clean folders, and checks the
output with Pillow (a decoder independent of Codixel's own PNG and GIF writers).

usage: python -I codixel_measure.py <path/to/core/pixel.js> <path/to/codixel_effects.cjs> <new-workdir> <result.json>

For each effect: whole-command wall time (Node start-up included), byte comparison of every file between
the two runs, frame size and count, distinct colours, the share of partly transparent pixels, the sprite
sheet against the frames, and the GIF's frames, colours and delays. Then a palette check: each effect with
its colours set to a PICO-8 subset (--cols), and with every frame mapped to the 16 PICO-8 colours by
P.quantize (--quantize).
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time

from PIL import Image

EFFECTS = ["flame", "smoke", "hellfire", "beams"]
BG = (24, 26, 38)  # the scene colour codixel_effects.cjs fills for beams and for see-through GIFs
PICO8 = [[0, 0, 0], [29, 43, 83], [126, 37, 83], [0, 135, 81], [171, 82, 54], [95, 87, 79], [194, 195, 199],
         [255, 241, 232], [255, 0, 77], [255, 163, 0], [255, 236, 39], [0, 228, 54], [41, 173, 255],
         [131, 118, 156], [255, 119, 168], [255, 204, 170]]
COLS = {  # PICO-8 subsets passed as each effect's `cols`
    "flame": [[126, 37, 83], [255, 0, 77], [255, 163, 0], [255, 236, 39], [255, 241, 232]],
    "smoke": [[95, 87, 79], [194, 195, 199]],
    "hellfire": [[126, 37, 83], [255, 0, 77], [255, 163, 0], [255, 236, 39], [255, 241, 232]],
    "beams": [[41, 173, 255], [255, 241, 232]],
}


def sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def files_of(root):
    out = {}
    for d, _, names in os.walk(root):
        for n in names:
            p = os.path.join(d, n)
            out[os.path.relpath(p, root).replace(os.sep, "/")] = sha(p)
    return dict(sorted(out.items()))


def run(node, effects_js, core, effect, outdir, extra):
    cmd = [node, effects_js, core, effect, outdir] + extra
    t = time.perf_counter()
    p = subprocess.run(cmd, capture_output=True, text=True)
    wall = time.perf_counter() - t
    if p.returncode != 0:
        raise SystemExit(f"{effect} failed: {p.stderr}")
    return wall, json.loads(p.stdout)


def analyse(outdir):
    names = sorted(os.listdir(os.path.join(outdir, "frames")))
    frames = [Image.open(os.path.join(outdir, "frames", n)) for n in names]
    modes = sorted({f.mode for f in frames})
    frames = [f.convert("RGBA") for f in frames]
    w, h = frames[0].size
    colours, total, visible, partial = set(), 0, 0, 0
    alphas = set()
    for f in frames:
        for (r, g, b, a) in f.getdata():
            total += 1
            if a:
                visible += 1
                colours.add((r, g, b, a))
                alphas.add(a)
                if a < 255:
                    partial += 1
    sheet = Image.open(os.path.join(outdir, "sheet.png"))
    sheet_mode = sheet.mode
    sheet = sheet.convert("RGBA")
    cols = 8
    sheet_ok = True
    for i, f in enumerate(frames):
        box = ((i % cols) * w, (i // cols) * h, (i % cols) * w + w, (i // cols) * h + h)
        if list(sheet.crop(box).getdata()) != list(f.getdata()):
            sheet_ok = False
    gif = Image.open(os.path.join(outdir, "anim.gif"))
    gif_frames, gif_cols, delays = 0, set(), []
    for k in range(gif.n_frames):
        gif.seek(k)
        delays.append(gif.info.get("duration"))
        for px in gif.convert("RGBA").getdata():
            if px[3]:
                gif_cols.add(px[:3])
        gif_frames += 1
    return {
        "frame_files": len(names),
        "png_modes": modes,
        "frame_size": [w, h],
        "colours_rgba": len(colours),
        "colours_rgb": len({c[:3] for c in colours}),
        "alpha_values": sorted(alphas),
        "visible_share": round(visible / total, 4),
        "partly_transparent_share_of_all": round(partial / total, 4),
        "partly_transparent_share_of_visible": round(partial / visible, 4) if visible else None,
        "sheet": {"size": list(sheet.size), "mode": sheet_mode, "matches_frames": sheet_ok},
        "gif": {"frames": gif_frames, "size": list(gif.size), "colours": len(gif_cols),
                "delays_ms": sorted(set(delays))},
        "_rgb": {c[:3] for c in colours},
    }


def main():
    core, effects_js, work, result = sys.argv[1:5]
    node = shutil.which("node")
    os.makedirs(work, exist_ok=False)
    res = {"node": subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip(),
           "core_sha256": sha(core), "effects": {}, "palette": {}}
    for e in EFFECTS:
        runs = []
        for k in (1, 2):
            d = os.path.join(work, e, f"run{k}")
            os.makedirs(os.path.dirname(d), exist_ok=True)
            wall, meta = run(node, effects_js, core, e, d, [])
            runs.append({"dir": d, "wall_s": round(wall, 3), "meta": meta, "files": files_of(d)})
        a = analyse(runs[0]["dir"])
        a.pop("_rgb")
        res["effects"][e] = {
            "settings": {k: runs[0]["meta"][k] for k in ("frames", "frame", "sheet", "gif_delay_ms",
                                                          "gif_on_filled_background", "seconds_per_frame")},
            "wall_s": [r["wall_s"] for r in runs],
            "in_process_ms": [round(r["meta"]["ms"]["total_in_process"], 1) for r in runs],
            "files": len(runs[0]["files"]),
            "bytes_identical": runs[0]["files"] == runs[1]["files"],
            "sha256": {k: v[:16] for k, v in runs[0]["files"].items() if not k.startswith("frames/")},
            "check": a,
        }
    for e in EFFECTS:
        out = {}
        for label, extra, pal in (("cols", ["--cols", json.dumps(COLS[e])], COLS[e]),
                                  ("quantize_pico8", ["--quantize", json.dumps(PICO8)], PICO8)):
            d = os.path.join(work, "palette", e + "-" + label)
            os.makedirs(os.path.dirname(d), exist_ok=True)
            wall, meta = run(node, effects_js, core, e, d, extra)
            a = analyse(d)
            allowed = {tuple(c) for c in pal}
            outside = a["_rgb"] - allowed
            outside_not_bg = outside - {BG}
            out[label] = {
                "palette_size": len(pal),
                "colours_rgb": a["colours_rgb"],
                "colours_in_palette": len(a["_rgb"] & allowed),
                "colours_outside_palette": len(outside),
                "colours_outside_palette_excluding_scene_bg": len(outside_not_bg),
                "partly_transparent_share_of_visible": a["partly_transparent_share_of_visible"],
                "gif_colours": a["gif"]["colours"],
            }
        res["palette"][e] = out

    def scrub(o):
        if isinstance(o, dict):
            return {k: scrub(v) for k, v in o.items()}
        if isinstance(o, list):
            return [scrub(v) for v in o]
        if isinstance(o, str):
            return o.replace(work, "<work>").replace(os.path.abspath(work), "<work>")
        return o
    for e in res["effects"].values():
        e.pop("dir", None)
    with open(result, "w", encoding="utf-8", newline="\n") as f:
        json.dump(scrub(res), f, indent=1)
        f.write("\n")
    for e, v in res["effects"].items():
        c = v["check"]
        print(e, v["wall_s"], "identical" if v["bytes_identical"] else "DIFFERENT", c["frame_size"],
              c["frame_files"], c["colours_rgba"], c["partly_transparent_share_of_visible"], c["sheet"]["matches_frames"],
              c["gif"])
    for e, v in res["palette"].items():
        print(e, v)


main()
