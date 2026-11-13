"""Make the stand-in 'generator output': plain PNG strips from rendered APNG animations.

Usage: python -I make_standin.py <animations-dir> <out-dir>
Writes knight-attack.png (5 frames) and knight-idle.png (4 frames), 32x36 cells in one row, RGBA,
and prints each file's size, frame count, colour count and SHA-256.
"""
import hashlib
import sys
from pathlib import Path

from PIL import Image


def strip(apng: Path, out: Path) -> None:
    im = Image.open(apng)
    frames = []
    for i in range(im.n_frames):
        im.seek(i)
        frames.append(im.convert("RGBA").copy())
    w, h = frames[0].size
    sheet = Image.new("RGBA", (w * len(frames), h), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        sheet.paste(f, (i * w, 0))
    sheet.save(out, optimize=False)
    colours = {p for p in sheet.getdata() if p[3] > 0}
    digest = hashlib.sha256(out.read_bytes()).hexdigest()
    print(f"{out.name}: {sheet.size[0]}x{sheet.size[1]}, {len(frames)} frames of {w}x{h}, "
          f"{len(colours)} visible colours, sha256 {digest}")


def main() -> None:
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    dst.mkdir(parents=True, exist_ok=True)
    strip(src / "attack.png", dst / "knight-attack.png")
    strip(src / "idle.png", dst / "knight-idle.png")


if __name__ == "__main__":
    main()
