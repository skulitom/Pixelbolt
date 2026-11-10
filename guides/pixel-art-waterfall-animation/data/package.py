"""Waterfall page kit, step 2: measure each rendered variant and package the page's files.

Usage: python package.py   -> page/ (the guide folder's files, without index.html) and out/measured.json
Reads out/<tag>/ from build.py. Zips are written with fixed timestamps so a rebuild gives the same bytes.
"""
import hashlib
import json
import os
import shutil
import statistics
import zipfile

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
PAGE = os.path.join(HERE, "page")
PKG = os.path.normpath(os.path.join(HERE, "..", "c131", "pkg", "package"))
ORDER = ["waterfall", "waterfall-12f", "waterfall-8f", "lavafall", "slimefall", "moonlit-waterfall"]
README = """{title}
Made with Pixelbolt 0.15.0 (https://github.com/skulitom/Pixelbolt) on 10 November 2026.
From https://skulitom.github.io/Pixelbolt/guides/pixel-art-waterfall-animation/

{w} x {h} pixels, {n} frames of {ms} ms, looping, {colours} colours, transparent background.

{tag}-strip.png        every frame in one row ({sw} x {h})
{name}.png             the same frames as a grid sheet, with:
{name}.atlas.json      frame rectangles, durations and the animation (TexturePacker-style, with Aseprite-style tags)
{name}.tres            Godot 4 SpriteFrames (keep it next to {name}.png)
{tag}.gif, {tag}-4x.gif   the loop at 1x and 4x
frames/                each frame as a PNG, renamed by us {tag}-00.png, -01 ... so that name order is playing order
animations/            the loop as an animated PNG
{name}.fluid.json      the recipe (the short JSON file that describes the simulation): edit it and compile again
{name}.pixel.json      the compiled result: every frame, as Pixelbolt's own editable file
{name}.css, player.js, preview.html   Pixelbolt's other export files
LICENSE.txt            the MIT licence (it names "PixelForge contributors": PixelForge is Pixelbolt's earlier name)

Licence: MIT. Free for any use, commercial too; keep the licence text with copies of these files.
The recipe is {origin}. This zip was made by AI agents working for Pixelbolt's maintainers.
"""
TITLES = {"waterfall": "Pixel art waterfall (stone ledge and basin)", "waterfall-12f": "Pixel art waterfall, 12 frames",
          "waterfall-8f": "Pixel art waterfall, 8 frames",
          "lavafall": "Pixel art lavafall", "slimefall": "Pixel art slimefall",
          "moonlit-waterfall": "Moonlit pixel art waterfall"}
ORIGIN = {"waterfall": "Pixelbolt's shipped waterfall example, unchanged",
          "waterfall-12f": "Pixelbolt's shipped waterfall example, compiled with --frames 12",
          "waterfall-8f": "Pixelbolt's shipped waterfall example, compiled with --frames 8",
          "lavafall": "Pixelbolt's shipped waterfall example with nine palette colours changed",
          "slimefall": "Pixelbolt's shipped waterfall example with five palette colours changed",
          "moonlit-waterfall": "Pixelbolt's shipped waterfall example with nine palette colours changed"}


def sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def diff(a, b):
    return sum(1 for p, q in zip(a.getdata(), b.getdata()) if p != q)


def zip_dir(src, dest):
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for root, dirs, files in os.walk(src):
            dirs.sort()
            for f in sorted(files):
                full = os.path.join(root, f)
                arc = os.path.relpath(full, os.path.dirname(src)).replace("\\", "/")
                zi = zipfile.ZipInfo(arc, date_time=(2026, 11, 10, 0, 0, 0))
                zi.compress_type = zipfile.ZIP_DEFLATED
                zi.external_attr = 0o644 << 16
                z.writestr(zi, open(full, "rb").read(), compresslevel=9)


def main():
    stats = {s["tag"]: s for s in json.load(open(os.path.join(OUT, "stats.json"), encoding="utf-8"))}
    if os.path.exists(PAGE):
        shutil.rmtree(PAGE)
    os.makedirs(os.path.join(PAGE, "downloads"))
    stage = os.path.join(HERE, "stage")
    if os.path.exists(stage):
        shutil.rmtree(stage)
    measured = []
    for tag in ORDER:
        s = stats[tag]
        name = s["name"]
        d = os.path.join(OUT, tag)
        b = os.path.join(d, "bundle")
        atlas = json.load(open(os.path.join(b, f"{name}.atlas.json"), encoding="utf-8"))
        n = s["delivered"]["animations"][name]["frames"]
        keys = atlas["animations"][name]["frames"]  # in playing order (a --frames compile keeps the old numbers)
        assert len(keys) == n
        frames = [Image.open(os.path.join(b, "frames", f"{k}.png")).convert("RGBA") for k in keys]
        w, h = frames[0].size
        durs = [atlas["frames"][k]["duration"] for k in keys]
        cols = set()
        alphas = set()
        for f in frames:
            for r, g, bb, a in f.getdata():
                alphas.add(a)
                if a:
                    cols.add((r, g, bb))
        steps = [diff(frames[i], frames[i + 1]) for i in range(n - 1)]
        seam = diff(frames[-1], frames[0])
        strip = Image.new("RGBA", (w * n, h), (0, 0, 0, 0))
        for i, f in enumerate(frames):
            strip.paste(f, (i * w, 0))
        # staging folder for the zip
        z = os.path.join(stage, tag)
        shutil.copytree(b, z, ignore=shutil.ignore_patterns("look.png", "frames"))
        os.makedirs(os.path.join(z, "frames"))
        for i, k in enumerate(keys):  # name order = playing order (Pixelbolt's own names are not zero-padded)
            shutil.copy(os.path.join(b, "frames", f"{k}.png"), os.path.join(z, "frames", f"{tag}-{i:02d}.png"))
        strip.save(os.path.join(z, f"{tag}-strip.png"), optimize=True)
        shutil.copy(os.path.join(b, "gifs", f"{name}.gif"), os.path.join(z, f"{tag}.gif"))
        shutil.rmtree(os.path.join(z, "gifs"))
        shutil.copy(os.path.join(d, f"{tag}-4x.gif"), os.path.join(z, f"{tag}-4x.gif"))
        shutil.copy(os.path.join(d, f"{name}.fluid.json"), os.path.join(z, f"{name}.fluid.json"))
        shutil.copy(os.path.join(PKG, "LICENSE"), os.path.join(z, "LICENSE.txt"))
        os.remove(os.path.join(z, "README.txt"))
        open(os.path.join(z, "README.txt"), "w", encoding="utf-8", newline="\n").write(README.format(
            title=TITLES[tag], w=w, h=h, n=n, ms=durs[0], colours=len(cols), tag=tag, name=name, sw=w * n,
            origin=ORIGIN[tag]))
        zip_dir(z, os.path.join(PAGE, "downloads", f"{tag}.zip"))
        # loose files the page shows or links
        strip.save(os.path.join(PAGE, f"{tag}-strip.png"), optimize=True)
        shutil.copy(os.path.join(d, f"{tag}-4x.gif"), os.path.join(PAGE, f"{tag}.gif"))
        still = frames[0].resize((w * 4, h * 4), Image.NEAREST)
        still.save(os.path.join(PAGE, f"{tag}-still.png"), optimize=True)
        shutil.copy(os.path.join(d, f"{name}.fluid.json"), os.path.join(PAGE, "downloads", f"{tag}.fluid.json")) \
            if tag == name else None
        measured.append(dict(
            tag=tag, name=name, width=w, height=h, frames=n, frame_ms=sorted(set(durs)), loop_ms=sum(durs),
            colours=len(cols), alpha_values=sorted(alphas), compile_s=s["compile_s"], same_twice=s["same_twice"],
            step_px_median=statistics.median(steps), step_px_min=min(steps), step_px_max=max(steps), seam_px=seam,
            seam_ratio=round(seam / statistics.median(steps), 2),
            strip=dict(file=f"{tag}-strip.png", size=[w * n, h], bytes=os.path.getsize(os.path.join(PAGE, f"{tag}-strip.png")),
                       sha256=sha(os.path.join(PAGE, f"{tag}-strip.png"))),
            gif=dict(file=f"{tag}.gif", size=[w * 4, h * 4], bytes=os.path.getsize(os.path.join(PAGE, f"{tag}.gif"))),
            zip=dict(file=f"downloads/{tag}.zip", bytes=os.path.getsize(os.path.join(PAGE, "downloads", f"{tag}.zip")),
                     sha256=sha(os.path.join(PAGE, "downloads", f"{tag}.zip")))))
    json.dump(measured, open(os.path.join(OUT, "measured.json"), "w", encoding="utf-8"), indent=1)
    os.makedirs(os.path.join(PAGE, "data"), exist_ok=True)
    json.dump(measured, open(os.path.join(PAGE, "data", "measured.json"), "w", encoding="utf-8"), indent=1)
    for m in measured:
        print(f"{m['tag']:20} {m['width']}x{m['height']} {m['frames']}f {m['frame_ms']}ms {m['colours']} colours "
              f"alpha {m['alpha_values']} step median {m['step_px_median']} (min {m['step_px_min']}, max "
              f"{m['step_px_max']}) seam {m['seam_px']} ratio {m['seam_ratio']} zip {m['zip']['bytes']} B")


main()
