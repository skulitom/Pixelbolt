"""How much of pixelfx's soft alpha is its additive light: renders the same six effects with the documented option
`light: 0` (glow strength 0; README "createFx ... also: flip, angle, seed, palette, light"), through
patchgg-pixelfx_frames.mjs, and counts colours and partly see-through pixels with Pillow, as patchgg-pixelfx_measure.py
does for the default run. This script is ours (Pixelbolt's makers), not part of pixelfx.

usage: python -I patchgg-pixelfx_light0.py <pixelfx checkout> <patchgg-pixelfx_frames.mjs> <new workdir> <result.json>
"""
import json
import os
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image

EFFECTS = ["fire/campfire", "explosions/smoke-bomb", "explosions/big-explosion", "water/splash",
           "lightning/lightning-strike", "arcane/portal"]


def main():
    root, frames_js, work, result = sys.argv[1:5]
    root, frames_js = os.path.abspath(root), os.path.abspath(frames_js)
    node = shutil.which("node")
    os.makedirs(work, exist_ok=False)
    out = {"options": {"light": 0}, "effects": {}}
    for e in EFFECTS:
        d = os.path.abspath(os.path.join(work, e.replace("/", "-")))
        os.makedirs(d)
        p = subprocess.run([node, frames_js, root, e, d, "--opts", json.dumps({"light": 0})], capture_output=True, text=True, cwd=d)
        if p.returncode != 0:
            raise SystemExit(f"{e} failed: {p.stderr}")
        fdir = os.path.join(d, "frames")
        stack = np.concatenate([np.asarray(Image.open(os.path.join(fdir, n)).convert("RGBA")).reshape(-1, 4)
                                for n in sorted(os.listdir(fdir))])
        a = stack[:, 3]
        vis = stack[a > 0]
        partial = int(((a > 0) & (a < 255)).sum())
        packed = (vis[:, 0].astype(np.uint32) << 24) | (vis[:, 1].astype(np.uint32) << 16) | \
                 (vis[:, 2].astype(np.uint32) << 8) | vis[:, 3].astype(np.uint32)
        out["effects"][e] = {
            "visible_share": round(len(vis) / len(stack), 4),
            "colours_rgba": int(len(np.unique(packed))), "colours_rgb": int(len(np.unique(packed >> 8))),
            "partly_see_through_share_of_visible": round(partial / len(vis), 4) if len(vis) else None,
        }
        print(e, json.dumps(out["effects"][e]), flush=True)
    with open(result, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
        f.write("\n")


if __name__ == "__main__":
    main()
