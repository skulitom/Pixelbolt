"""[this benchmark] contact sheets: one image per task, model and side order, with the two arms as unlabelled "Left" and "Right".

make_pair(task, model, left_arm, out_path) draws every requested file of each arm, frames scaled up with
nearest-neighbour to at least 192 px tall, plus a 1x and 2x copy of the first frame, on a grey checkerboard.
Tiles are also shown repeated 3x3. Nothing on the sheet says which arm is which.
"""
import math
import os

from PIL import Image, ImageDraw

BASE = os.path.dirname(os.path.abspath(__file__))
TARGET, GAP, PAD = 192, 12, 16
BG, INK = (250, 250, 250, 255), (20, 20, 20, 255)


def checker(w, h, cell=8):
    im = Image.new("RGBA", (w, h), (205, 205, 205, 255))
    d = ImageDraw.Draw(im)
    for y in range(0, h, cell):
        for x in range(0, w, cell):
            if (x // cell + y // cell) % 2:
                d.rectangle([x, y, x + cell - 1, y + cell - 1], fill=(160, 160, 160, 255))
    return im


def on_checker(fr, scale):
    big = fr.resize((fr.size[0] * scale, fr.size[1] * scale), Image.NEAREST)
    bg = checker(*big.size)
    bg.alpha_composite(big)
    return bg


def file_row(task, folder, spec):
    """Return an RGBA strip for one file, or a 'no file' box."""
    from score import load
    path = os.path.join(folder, spec["name"])
    try:
        frames, _ = load(path, spec)
    except Exception:
        box = Image.new("RGBA", (TARGET * 2, 40), BG)
        ImageDraw.Draw(box).text((6, 12), f"{spec['name']}: no readable file", fill=INK)
        return box
    if task["kind"] == "tile" and spec["w"] <= 48:
        f = frames[0]
        rep = Image.new("RGBA", (f.size[0] * 3, f.size[1] * 3))
        for y in range(3):
            for x in range(3):
                rep.paste(f, (x * f.size[0], y * f.size[1]))
        frames = [frames[0], rep]
    h = max(fr.size[1] for fr in frames)
    scale = max(1, math.ceil(TARGET / max(h, 1)))
    tiles = [on_checker(fr, scale) for fr in frames]
    tiles += [on_checker(frames[0], 1), on_checker(frames[0], 2)]  # real size, and 2x
    w = sum(t.size[0] for t in tiles) + GAP * (len(tiles) - 1)
    hh = max(t.size[1] for t in tiles)
    strip = Image.new("RGBA", (w, hh + 18), BG)
    ImageDraw.Draw(strip).text((0, 2), f"{spec['name']} ({len(frames) if task['kind'] != 'tile' else 1} frame(s), "
                                       f"shown at {scale}x, then 1x and 2x)", fill=INK)
    x = 0
    for t in tiles:
        strip.paste(t, (x, 18))
        x += t.size[0] + GAP
    return strip


def panel(task, folder, label):
    rows = [file_row(task, folder, s) for s in task["files"]]
    w = max(r.size[0] for r in rows) + 2 * PAD
    h = sum(r.size[1] for r in rows) + GAP * (len(rows) - 1) + 2 * PAD + 26
    im = Image.new("RGBA", (w, h), BG)
    d = ImageDraw.Draw(im)
    d.text((PAD, 8), label, fill=INK)
    y = PAD + 26
    for r in rows:
        im.paste(r, (PAD, y))
        y += r.size[1] + GAP
    d.rectangle([0, 0, w - 1, h - 1], outline=INK)
    return im


def make_pair(task, model, left_arm, out_path, other="with"):
    right_arm = "without" if left_arm != "without" else other
    left = panel(task, os.path.join(BASE, "runs", model, f"{task['id']}-{left_arm}"), "Left")
    right = panel(task, os.path.join(BASE, "runs", model, f"{task['id']}-{right_arm}"), "Right")
    w = max(left.size[0], right.size[0])
    im = Image.new("RGBA", (w, left.size[1] + right.size[1] + GAP), BG)
    im.paste(left, (0, 0))
    im.paste(right, (0, left.size[1] + GAP))
    im.convert("RGB").save(out_path)
    return out_path
