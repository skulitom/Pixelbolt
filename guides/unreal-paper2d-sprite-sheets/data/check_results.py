"""Compare what Unreal Engine Paper2D built (results/<case>.json, written by ue_check.py) with the Pixelbolt atlas.

Usage: python check_results.py <kit folder> [results folder] [case ...]   (needs Pillow)
Pixels are decoded with Pillow, independently of Pixelbolt's own PNG code. Exits 1 if any check fails.
"""
import json
import math
import os
import sys
from functools import reduce

from PIL import Image

ROOT = sys.argv[1]
RESULTS = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "results")
CASES = sys.argv[3:] or ["forest-spirit", "forest-spirit-trim2x", "campfire", "hero", "fire-spells", "explosion", "campfire-092"]


def rgba(path):
    with Image.open(path) as image:
        return image.convert("RGBA")


def check(case):
    problems, notes = [], {}
    atlas = json.load(open(os.path.join(ROOT, "out", case, case + ".atlas.json"), encoding="utf-8"))
    got = json.load(open(os.path.join(RESULTS, case + ".json"), encoding="utf-8"))
    frames, animations = atlas["frames"], atlas.get("animations", {})

    classes = {}
    for cls in got["assets"].values():
        classes[cls] = classes.get(cls, 0) + 1
    notes["assets"] = classes
    want = {"PaperSprite": len(frames), "PaperSpriteSheet": 1, "Texture2D": 1, "PaperFlipbook": len(animations)}
    if classes != want:
        problems.append("assets %s, expected %s" % (classes, want))
    if got.get("saved_on_disk") != len(got["assets"]):
        problems.append("%s of %d assets saved on disk" % (got.get("saved_on_disk"), len(got["assets"])))
    notes["engine"] = got.get("engine")

    tex = got["texture"]
    notes["texture"] = {k: tex[k] for k in ("lod_group", "compression_settings", "filter", "srgb", "mip_gen_settings")}
    if tex["size"] != [atlas["meta"]["size"]["w"], atlas["meta"]["size"]["h"]]:
        problems.append("texture size %s" % tex["size"])
    wanted = {"lod_group": "TEXTUREGROUP_PIXELS2D", "compression_settings": "TC_EDITOR_ICON",
              "filter": "TF_DEFAULT", "mip_gen_settings": "TMGS_NO_MIPMAPS"}
    for key, value in wanted.items():
        if value not in tex[key]:
            problems.append("texture %s is %s, expected %s" % (key, tex[key], value))
    if tex["srgb"] is not True:
        problems.append("texture sRGB is off")
    sheet = rgba(os.path.join(ROOT, "out", case, atlas["meta"]["image"]))
    exported = rgba(os.path.join(RESULTS, case + ".texture.png"))
    same = sheet.size == exported.size and sheet.tobytes() == exported.tobytes()
    notes["pixels_identical"] = same
    if not same:
        problems.append("texture pixels differ from the Pixelbolt sheet")

    pivots, materials = set(), {}
    for name, frame in frames.items():
        sprite = got["sprites"][name]
        rect = frame["frame"]
        if sprite["source_uv"] != [rect["x"], rect["y"]] or sprite["source_dimension"] != [rect["w"], rect["h"]]:
            problems.append("%s: rect %s %s vs %s" % (name, sprite["source_uv"], sprite["source_dimension"], rect))
        if sprite["trimmed"] != frame["trimmed"] or sprite["rotated"]:
            problems.append("%s: trimmed %s rotated %s" % (name, sprite["trimmed"], sprite["rotated"]))
        offset = frame["spriteSourceSize"] if frame["trimmed"] else {"x": 0, "y": 0}
        if frame["trimmed"] and (sprite["origin_before_trim"] != [offset["x"], offset["y"]] or
                                 sprite["size_before_trim"] != [frame["sourceSize"]["w"], frame["sourceSize"]["h"]]):
            problems.append("%s: trim offset %s size %s" % (name, sprite["origin_before_trim"], sprite["size_before_trim"]))
        if sprite["pixels_per_unit"] != 1:
            problems.append("%s: pixels per unit %s" % (name, sprite["pixels_per_unit"]))

        # Paper2D's own baked geometry: position (X right, Y up, in pixels from the pivot) and UV for each vertex.
        verts = sprite["baked"] or []
        if not verts:
            problems.append("%s: no baked geometry" % name)
            continue
        found = set()
        for x, y, u, v in verts:
            tx, ty = u * tex["size"][0], v * tex["size"][1]          # texel in the sheet
            cx, cy = tx - rect["x"] + offset["x"], ty - rect["y"] + offset["y"]  # pixel on the frame's canvas
            found.add((round(cx - x, 3), round(cy + y, 3)))           # where the pivot sits on the canvas
        if len(found) != 1:
            problems.append("%s: vertices disagree on the pivot %s" % (name, sorted(found)))
        pivot = found.pop()
        pivots.add(pivot)
        if "anchor" in frame:
            if pivot != (frame["anchor"]["x"], frame["anchor"]["y"]):
                problems.append("%s: pivot %s, anchor %s" % (name, pivot, frame["anchor"]))
        elif pivot != (frame["sourceSize"]["w"] / 2, frame["sourceSize"]["h"] / 2):
            problems.append("%s: pivot %s, canvas centre expected" % (name, pivot))

        crop = sheet.crop((rect["x"], rect["y"], rect["x"] + rect["w"], rect["y"] + rect["h"]))
        alphas = set(crop.getchannel("A").getdata())
        partial = any(0 < a < 255 for a in alphas)
        material = sprite["material"].rsplit(".", 1)[-1]
        expected = "TranslucentUnlitSpriteMaterial" if partial else "MaskedUnlitSpriteMaterial"
        materials[material] = materials.get(material, 0) + 1
        if material != expected:
            problems.append("%s: material %s, alpha partial=%s" % (name, material, partial))
    notes["materials"] = materials
    notes["pivots_on_canvas"] = sorted(pivots)

    for animation, entry in animations.items():
        flipbook = got["flipbooks"][animation]
        times = [frames[f]["duration"] for f in entry["frames"]]
        step = reduce(math.gcd, times)
        if abs(flipbook["fps"] - 1000 / step) > 1e-3 or flipbook["num_key_frames"] != len(times):
            problems.append("%s: fps %s keys %s" % (animation, flipbook["fps"], flipbook["num_key_frames"]))
        if abs(flipbook["total_duration"] * 1000 - sum(times)) > 0.01:
            problems.append("%s: %.4f s, expected %d ms" % (animation, flipbook["total_duration"], sum(times)))
        for sample in flipbook["samples"]:
            if sample["got"] != got["sprites"][sample["frame"]]["path"]:
                problems.append("%s at %.4f s: %s, expected %s" % (animation, sample["at"], sample["got"], sample["frame"]))
    notes["flipbooks"] = {a: "%g fps, %d keys, %d ms" % (f["fps"], f["num_key_frames"], f["expected_ms"])
                          for a, f in got["flipbooks"].items()}
    return problems, notes


report, failed = {}, 0
for case in CASES:
    problems, notes = check(case)
    report[case] = {"problems": problems, **notes}
    failed += bool(problems)
    print("%-22s %s  %d sprites, %d flipbooks, pixels identical: %s, materials %s, pivots %s" % (
        case, "PASS" if not problems else "FAIL (%d)" % len(problems), notes["assets"].get("PaperSprite", 0),
        notes["assets"].get("PaperFlipbook", 0), notes["pixels_identical"], notes["materials"], notes["pivots_on_canvas"][:3]))
    for problem in problems[:8]:
        print("    " + problem)
json.dump(report, open(os.path.join(RESULTS, "check.json"), "w", encoding="utf-8"), indent=1)
sys.exit(1 if failed else 0)
