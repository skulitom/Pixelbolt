"""C-158 measurement: effects added to an imported sprite strip with Pixelbolt, run twice from clean folders.

Usage: python -I measure.py <pixelbolt.js> <run-dir> <out-json>     (needs Pillow; relative paths are fine)
<run-dir> holds input/knight-attack.png, input/knight-idle.png, add_animation.py and knight-effects.fx.json.
For each of two runs, in a fresh temporary folder holding only those four files, it runs:
  pixelbolt import (x2) -> add_animation.py (x2) -> pixelbolt compile -> pixelbolt render --gif-scale 4
times each step, and hashes every file the run wrote (the four copied inputs are left out). On run 1 it then checks
every frame of the attack-hit effect against the imported sprite and against hit-overlay (the same effect without
the sprite): which sprite pixels are unchanged, which the effect draws over, and whether the two effects match
outside the sprite. It also counts the colours.
"""
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from PIL import Image

PB, RUN, OUT = (Path(a).resolve() for a in sys.argv[1:4])
PY = sys.executable
FILES = ["input/knight-attack.png", "input/knight-idle.png", "add_animation.py", "knight-effects.fx.json"]
CELL_W, CELL_H, AT = 32, 36, (8, 14)


def step(cmd, cwd, timings, name):
    t0 = time.perf_counter()
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    timings[name] = round((time.perf_counter() - t0) * 1000)
    if p.returncode != 0 or '"ok": false' in p.stdout or '"ok":false' in p.stdout:
        raise SystemExit(f"{name} failed: {p.stdout[:400]} {p.stderr[:400]}")


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def one_run(base: Path) -> dict:
    for f in FILES:
        (base / f).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(RUN / f, base / f)
    t = {}
    node = shutil.which("node")
    step([node, str(PB), "import", "input/knight-attack.png", "--frame", "32x36", "--name", "knight-attack",
          "--out", "input/knight-attack.json"], base, t, "import attack")
    step([node, str(PB), "import", "input/knight-idle.png", "--frame", "32x36", "--name", "knight-idle",
          "--out", "input/knight-idle.json"], base, t, "import idle")
    step([PY, "-I", "add_animation.py", "input/knight-attack.json", "attack", "false"], base, t, "name attack")
    step([PY, "-I", "add_animation.py", "input/knight-idle.json", "idle", "true"], base, t, "name idle")
    step([node, str(PB), "compile", "knight-effects.fx.json", "--out", "knight-effects.json"], base, t, "compile")
    step([node, str(PB), "render", "knight-effects.json", "--out", "out", "--gif-scale", "4"], base, t, "render")
    written = {}
    for p in sorted(base.rglob("*")):
        rel = str(p.relative_to(base)).replace("\\", "/")
        if p.is_file() and rel not in FILES:
            written[rel] = sha(p)
    return {"timings_ms": t, "hashes": written}


def pixel_check(base: Path) -> dict:
    strip = Image.open(base / "input/knight-attack.png").convert("RGBA")
    cells = [strip.crop((i * CELL_W, 0, i * CELL_W + CELL_W, CELL_H)) for i in range(5)]
    report = {"sprite_colours": len({p for p in strip.getdata() if p[3] > 0}), "frames": []}
    all_colours = set()
    for i in range(9):
        hit = Image.open(base / f"out/frames/attack-hit-{i}.png").convert("RGBA")
        overlay = Image.open(base / f"out/frames/hit-overlay-{i}.png").convert("RGBA")
        sprite = Image.new("RGBA", hit.size, (0, 0, 0, 0))
        sprite.paste(cells[min(i, 4)], AT)
        row = {"frame": i + 1, "sprite_pixels": 0, "unchanged": 0, "drawn_over_by_effect": 0,
               "drawn_over_matches_effect_alone": 0, "changed_without_effect": 0,
               "outside_sprite_pixels_differing_from_effect_alone": 0}
        for h, o, s in zip(hit.getdata(), overlay.getdata(), sprite.getdata()):
            if s[3] == 0:
                row["outside_sprite_pixels_differing_from_effect_alone"] += h != o
                continue
            row["sprite_pixels"] += 1
            if h == s:
                row["unchanged"] += 1
            elif o[3] != 0:
                row["drawn_over_by_effect"] += 1
                row["drawn_over_matches_effect_alone"] += h == o
            else:
                row["changed_without_effect"] += 1
        composed = Image.alpha_composite(sprite, overlay)
        row["effect_alone_over_sprite_equals_hit"] = list(composed.getdata()) == list(hit.getdata())
        all_colours |= {p for p in hit.getdata() if p[3] > 0}
        report["frames"].append(row)
    totals = {k: sum(r[k] for r in report["frames"]) for k in report["frames"][0] if k != "frame"}
    totals["effect_alone_over_sprite_equals_hit"] = f'{totals["effect_alone_over_sprite_equals_hit"]} of 9 frames'
    report["totals"] = totals
    report["attack_hit_colours"] = len(all_colours)
    return report


def main() -> None:
    results = {"pixelbolt": json.loads((PB.parent.parent / "package.json").read_text(encoding="utf-8"))["version"],
               "node": subprocess.run([shutil.which("node"), "--version"], capture_output=True, text=True).stdout.strip(),
               "inputs": {f: sha(RUN / f) for f in FILES}}
    runs = []
    for n in (1, 2):
        with tempfile.TemporaryDirectory(prefix=f"c158-run{n}-") as d:
            r = one_run(Path(d))
            if n == 1:
                results["pixel_check"] = pixel_check(Path(d))
            runs.append(r)
    results["runs"] = [{"timings_ms": r["timings_ms"]} for r in runs]
    results["files_written"] = len(runs[0]["hashes"])
    results["identical_across_runs"] = runs[0]["hashes"] == runs[1]["hashes"]
    results["hashes_run1"] = runs[0]["hashes"]
    OUT.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    pc = results["pixel_check"]
    print(f"pixelbolt {results['pixelbolt']}, node {results['node']}; files written {results['files_written']}, "
          f"identical across runs: {results['identical_across_runs']}")
    print("timings ms:", [r["timings_ms"] for r in results["runs"]])
    print(f"sprite colours {pc['sprite_colours']}; attack-hit colours {pc['attack_hit_colours']}")
    print("totals:", pc["totals"])
    for fr in pc["frames"]:
        print(fr)


if __name__ == "__main__":
    main()
