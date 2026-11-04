"""Pixelbolt benchmark page figures: labelled side-by-side panels (not blind) for chosen task and model pairs.

Usage: python figures.py <out dir> <model:task> ...   e.g. opus:T11 haiku:T07
Each figure stacks the arms that ran: with Pixelbolt, told to use it (exploratory), nothing installed.
"""
import json
import os
import sys

from PIL import Image, ImageDraw

from sheets import panel, GAP, BG

BASE = os.path.dirname(os.path.abspath(__file__))
LABEL = {"with": "Pixelbolt 0.9.0 available", "told": "Pixelbolt 0.9.0, told to use it (exploratory arm)",
         "without": "Nothing installed"}
NAMES = {"haiku": "Claude Haiku 5.5", "sonnet": "Claude Sonnet 5.5", "opus": "Claude Opus 5.5"}


def main(out, pairs):
    tasks = {t["id"]: t for t in json.load(open(os.path.join(BASE, "tasks.json"), encoding="utf-8"))}
    os.makedirs(out, exist_ok=True)
    for p in pairs:
        model, tid = p.split(":")
        panels = []
        for arm in ("with", "told", "without"):
            folder = os.path.join(BASE, "runs", model, f"{tid}-{arm}")
            if os.path.isdir(folder):
                label = f"{NAMES[model]}, {LABEL[arm]}"
                pn = panel(tasks[tid], folder, label)
                need = int(ImageDraw.Draw(pn).textlength(label)) + 40
                if pn.size[0] < need:  # widen so the label isn't cut off
                    wide = Image.new("RGBA", (need, pn.size[1]), BG)
                    wide.paste(pn, (0, 0))
                    d = ImageDraw.Draw(wide)
                    d.rectangle([1, 1, need - 2, 24], fill=BG)  # the label was clipped at the old width: redraw it
                    d.text((16, 8), label, fill=(20, 20, 20, 255))
                    d.rectangle([0, 0, need - 1, pn.size[1] - 1], outline=(20, 20, 20, 255))
                    pn = wide
                panels.append(pn)
        w = max(x.size[0] for x in panels)
        im = Image.new("RGBA", (w, sum(x.size[1] for x in panels) + GAP * (len(panels) - 1)), BG)
        y = 0
        for x in panels:
            im.paste(x, (0, y))
            y += x.size[1] + GAP
        path = os.path.join(out, f"{model}-{tid}.png")
        im.convert("RGB").save(path, optimize=True)
        print(path, im.size, os.path.getsize(path))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
