"""Runs six of patch-gg/pixelfx's effects with pixelfx's own command line and our frame writer, twice each in new
folders and processes, and checks the output with Pillow (a decoder independent of pixelfx's PNG writer).
This script is ours (Pixelbolt's makers), not part of pixelfx. No AI agent is involved.

usage: python -I patchgg-pixelfx_measure.py <pixelfx checkout> <patchgg-pixelfx_frames.mjs> <new workdir> <result.json>

For each effect and each of the two runs, three commands, each timed as a whole (Node's start-up included):
  node <checkout>/tools/render.mjs <id> --sheet --out <run>/sheet    pixelfx's documented sprite-sheet export
  node <checkout>/tools/render.mjs <id> --gif --out <run>/gif        its GIF preview (pixelfx pipes frames to ffmpeg)
  node patchgg-pixelfx_frames.mjs <checkout> <id> <run>/frames       every frame as its own RGBA PNG (ours)
Then: byte comparison of every file between the two runs; frame size and count; distinct colours; the share of
visible pixels that are partly see-through (alpha 1..254, read from the RGBA bytes); the sprite sheet against the
frames, cell by cell; the sheet's JSON; the GIF's frames, size, colours and delays. Then a palette run: each effect
with its `palette` option set to a few PICO-8 colours (as `--opts` in tools/render.mjs), counting colours inside and
outside the ones given.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time

import numpy as np
from PIL import Image

EFFECTS = ["fire/campfire", "explosions/smoke-bomb", "explosions/big-explosion", "water/splash",
           "lightning/lightning-strike", "arcane/portal"]
# PICO-8 colours given as each effect's `palette` (dark to bright) in the palette run
PALETTES = {
    "fire/campfire": ["#7e2553", "#ff004d", "#ffa300", "#ffec27", "#fff1e8"],
    "explosions/smoke-bomb": ["#1d2b53", "#5f574f", "#83769c", "#c2c3c7"],
    "explosions/big-explosion": ["#7e2553", "#ff004d", "#ffa300", "#ffec27", "#fff1e8"],
    "water/splash": ["#1d2b53", "#29adff", "#c2c3c7", "#fff1e8"],
    "lightning/lightning-strike": ["#1d2b53", "#29adff", "#ffec27", "#fff1e8"],
    "arcane/portal": ["#1d2b53", "#7e2553", "#83769c", "#ff77a8", "#fff1e8"],
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


def timed(cmd, cwd):
    t = time.perf_counter()
    p = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd)
    wall = time.perf_counter() - t
    if p.returncode != 0:
        raise SystemExit(f"{cmd} failed ({p.returncode}): {p.stderr}")
    return round(wall, 3), p.stdout.strip()


def rgba_of(path):
    im = Image.open(path)
    mode = im.mode
    return mode, np.asarray(im.convert("RGBA"), dtype=np.uint8)


def colour_stats(frames):
    """frames: list of HxWx4 uint8 arrays. Distinct colours and alpha shares over visible pixels."""
    stack = np.concatenate([f.reshape(-1, 4) for f in frames])
    a = stack[:, 3]
    vis = stack[a > 0]
    partial = int(((a > 0) & (a < 255)).sum())
    packed = (vis[:, 0].astype(np.uint32) << 24) | (vis[:, 1].astype(np.uint32) << 16) | \
             (vis[:, 2].astype(np.uint32) << 8) | vis[:, 3].astype(np.uint32)
    rgba = np.unique(packed)
    rgb = np.unique(packed >> 8)
    alphas = np.unique(vis[:, 3])
    return {
        "pixels": int(len(stack)),
        "visible": int(len(vis)),
        "visible_share": round(len(vis) / len(stack), 4),
        "colours_rgba": int(len(rgba)),
        "colours_rgb": int(len(rgb)),
        "alpha_values_count": int(len(alphas)),
        "alpha_min_max": [int(alphas.min()), int(alphas.max())] if len(alphas) else None,
        "partly_see_through_visible": partial,
        "partly_see_through_share_of_visible": round(partial / len(vis), 4) if len(vis) else None,
        "_rgb_set": {(int(x >> 16) & 255, int(x >> 8) & 255, int(x) & 255) for x in rgb},
    }


def sheet_check(sheet_png, sheet_json, frames):
    mode, sheet = rgba_of(sheet_png)
    meta = json.load(open(sheet_json, encoding="utf-8"))
    rects = [f["frame"] for f in meta["frames"]]
    same_cells, diff_px, diff_partial_only, diff_alpha, premult_match, opaque_diff = 0, 0, 0, 0, 0, 0
    max_rgb_drop = 0
    for fr, r in zip(frames, rects):
        cell = sheet[r["y"]:r["y"] + r["h"], r["x"]:r["x"] + r["w"]]
        if cell.shape == fr.shape and np.array_equal(cell, fr):
            same_cells += 1
            continue
        d = np.any(cell != fr, axis=2)
        diff_px += int(d.sum())
        fa = fr[..., 3]
        diff_alpha += int((d & (cell[..., 3] != fa)).sum())
        opaque_diff += int((d & (fa == 255)).sum())
        part = d & (fa > 0) & (fa < 255)
        diff_partial_only += int(part.sum())
        # premultiplied: sheet RGB = frame RGB * alpha / 255, rounded (allow 1 for rounding)
        exp = np.rint(fr[..., :3].astype(np.float64) * (fa[..., None] / 255.0))
        ok = np.all(np.abs(cell[..., :3].astype(np.int32) - exp.astype(np.int32)) <= 1, axis=2)
        premult_match += int((d & ok).sum())
        if part.any():
            drop = (fr[..., :3].astype(np.int32) - cell[..., :3].astype(np.int32))[part].max()
            max_rgb_drop = max(max_rgb_drop, int(drop))
    return {
        "size": [int(sheet.shape[1]), int(sheet.shape[0])], "mode": mode, "json_frames": len(rects),
        "durations_ms": sorted({f["duration"] for f in meta["frames"]}),
        "columns": meta["meta"]["pixelfx"].get("columns"), "pixelfx_meta_keys": sorted(meta["meta"]["pixelfx"]),
        "frame_tags": meta["meta"].get("frameTags"),
        "cells_identical_to_frames": same_cells, "cells": len(rects),
        "pixels_differing": diff_px, "differing_pixels_with_partial_alpha_in_frame": diff_partial_only,
        "differing_pixels_opaque_in_frame": opaque_diff, "differing_pixels_alpha_changed": diff_alpha,
        "differing_pixels_explained_by_premultiplied_rgb": premult_match,
        "largest_rgb_drop_on_partial_pixels": max_rgb_drop,
    }


def gif_check(path):
    im = Image.open(path)
    n, delays, cols = 0, set(), set()
    for k in range(im.n_frames):
        im.seek(k)
        delays.add(im.info.get("duration"))
        fr = np.asarray(im.convert("RGBA")).reshape(-1, 4)
        vis = fr[fr[:, 3] > 0]
        cols.update(map(tuple, np.unique(vis[:, :3], axis=0).tolist()))
        n += 1
    return {"frames": n, "size": list(im.size), "colours": len(cols), "delays_ms": sorted(d for d in delays if d is not None),
            "loop": im.info.get("loop")}


def main():
    root, frames_js, work, result = sys.argv[1:5]
    root, frames_js = os.path.abspath(root), os.path.abspath(frames_js)
    node, ffmpeg = shutil.which("node"), shutil.which("ffmpeg")
    os.makedirs(work, exist_ok=False)
    work = os.path.abspath(work)
    render = os.path.join(root, "tools", "render.mjs")
    head = subprocess.run(["git", "-C", root, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    res = {
        "pixelfx_commit": head,
        "node": subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip(),
        "ffmpeg": subprocess.run([ffmpeg, "-version"], capture_output=True, text=True).stdout.splitlines()[0] if ffmpeg else None,
        "pillow": Image.__version__ if hasattr(Image, "__version__") else __import__("PIL").__version__,
        "effects": {}, "palette": {},
    }
    for e in EFFECTS:
        runs = []
        for k in (1, 2):
            d = os.path.join(work, e.replace("/", "-"), f"run{k}")
            os.makedirs(d)
            w_sheet, out_sheet = timed([node, render, e, "--sheet", "--out", os.path.join(d, "sheet")], d)
            w_gif, out_gif = timed([node, render, e, "--gif", "--out", os.path.join(d, "gif")], d)
            w_frames, out_frames = timed([node, frames_js, root, e, os.path.join(d, "frames")], d)
            runs.append({"dir": d, "wall_s": {"sheet": w_sheet, "gif": w_gif, "frames": w_frames},
                         "stdout": {"sheet": out_sheet, "gif": out_gif}, "meta": json.loads(out_frames),
                         "files": files_of(d)})
        d = runs[0]["dir"]
        name = e.split("/")[1]
        fdir = os.path.join(d, "frames", "frames")
        names = sorted(os.listdir(fdir))
        loaded = [rgba_of(os.path.join(fdir, n)) for n in names]
        frames = [a for _, a in loaded]
        stats = colour_stats(frames)
        stats.pop("_rgb_set")
        f1, f2 = runs[0]["files"], runs[1]["files"]
        res["effects"][e] = {
            "settings": {k: runs[0]["meta"][k] for k in ("name", "w", "h", "frames", "fps", "loop", "duration_s", "actor")},
            "default_options": runs[0]["meta"]["default_options"],
            "wall_s": {k: [r["wall_s"][k] for r in runs] for k in ("sheet", "gif", "frames")},
            "in_process_ms_frames_script": [r["meta"]["ms"] for r in runs],
            "files": len(f1),
            "bytes_identical": f1 == f2,
            "files_differing": sorted(k for k in set(f1) | set(f2) if f1.get(k) != f2.get(k)),
            "sha256": {k: v[:16] for k, v in f1.items() if not k.startswith("frames/frames/")},
            "frames_png_modes": sorted({m for m, _ in loaded}),
            "frame_size": [int(frames[0].shape[1]), int(frames[0].shape[0])],
            "frame_files": len(names),
            "check": stats,
            "sheet": sheet_check(os.path.join(d, "sheet", e, name + ".png"), os.path.join(d, "sheet", e, name + ".json"), frames),
            "gif": gif_check(os.path.join(d, "gif", e, "anim.gif")),
            "stdout": runs[0]["stdout"],
        }
        print(e, json.dumps({k: res["effects"][e][k] for k in ("frame_size", "frame_files", "bytes_identical", "wall_s")}), flush=True)
    for e in EFFECTS:
        d = os.path.join(work, "palette", e.replace("/", "-"))
        os.makedirs(d)
        pal = PALETTES[e]
        wall, out = timed([node, frames_js, root, e, os.path.join(d, "frames"), "--opts", json.dumps({"palette": pal})], d)
        fdir = os.path.join(d, "frames", "frames")
        frames = [rgba_of(os.path.join(fdir, n))[1] for n in sorted(os.listdir(fdir))]
        st = colour_stats(frames)
        given = {tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) for h in pal}
        rgbs = st.pop("_rgb_set")
        res["palette"][e] = {
            "palette_given": pal, "colours_rgba": st["colours_rgba"], "colours_rgb": st["colours_rgb"],
            "given_colours_used": len(rgbs & given), "colours_outside_given": len(rgbs - given),
            "partly_see_through_share_of_visible": st["partly_see_through_share_of_visible"], "wall_s": wall,
        }
        print("palette", e, json.dumps(res["palette"][e]), flush=True)
    with open(result, "w", encoding="utf-8") as f:
        json.dump(res, f, indent=1)
        f.write("\n")


if __name__ == "__main__":
    main()
