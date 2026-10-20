"""Independent PNG/GIF verification with Pillow; no dependency is added to Pixelbolt."""
import base64
import io
import json
from pathlib import Path
import subprocess
from PIL import Image

root = Path(__file__).resolve().parents[1]
program = """
import { heroRig } from './scripts/figure-rigs.mjs';
import { compilePoses } from './src/authoring.js';
import { renderProject, buildAtlas } from './src/core.js';
import { encodePNG } from './src/png.js';
import { animationGIF } from './src/gif.js';
const p = renderProject(compilePoses(heroRig()).recipe), a = buildAtlas(p);
const b64 = bytes => Buffer.from(bytes).toString('base64');
console.log(JSON.stringify({
  sheet: {width:a.width,height:a.height,png:b64(encodePNG(a.data,a.width,a.height)),rgba:b64(a.data)},
  animations: Object.entries(p.animations).map(([name, animation]) => ({
    name, width:p.width, height:p.height, gif:b64(animationGIF(p,name,{scale:1}).data),
    frames:animation.frames.map(i=>({rgba:b64(p.frames[i].data),duration:p.frames[i].duration})), loop:animation.loop
  }))
}));
"""
data = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", program], cwd=root))
sheet = data["sheet"]
with Image.open(io.BytesIO(base64.b64decode(sheet["png"]))) as image:
    assert image.size == (sheet["width"], sheet["height"])
    assert image.convert("RGBA").tobytes() == base64.b64decode(sheet["rgba"])
total = 0
for animation in data["animations"]:
    with Image.open(io.BytesIO(base64.b64decode(animation["gif"]))) as image:
        assert image.size == (animation["width"], animation["height"])
        assert image.n_frames == len(animation["frames"]), animation["name"]
        for i, frame in enumerate(animation["frames"]):
            image.seek(i)
            assert image.convert("RGBA").tobytes() == base64.b64decode(frame["rgba"]), (animation["name"], i)
            assert image.info["duration"] == frame["duration"], (animation["name"], i, "duration")
            total += 1
print(f"Pillow: R2 PNG sheet and {total} GIF playback frames across five animations match exact rendered RGBA and timing.")
