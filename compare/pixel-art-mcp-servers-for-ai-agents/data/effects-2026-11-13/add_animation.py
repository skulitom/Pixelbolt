"""Name an imported strip's frames as one animation, so effects can follow it frame by frame.

Usage: python -I add_animation.py <recipe.json> <animation-name> <loop: true|false>
`pixelbolt import --frame WxH` writes frames <name>-0, <name>-1 ... and no animation; this adds
"animations": {<animation-name>: {"frames": [...all frames in order...], "loop": <loop>}} and changes nothing else.
"""
import json
import sys
from pathlib import Path

path, name, loop = Path(sys.argv[1]), sys.argv[2], sys.argv[3] == "true"
recipe = json.loads(path.read_text(encoding="utf-8"))
recipe["animations"] = {name: {"frames": [f["name"] for f in recipe["frames"]], "loop": loop}}
path.write_text(json.dumps(recipe, indent=2) + "\n", encoding="utf-8")
print(f"{path.name}: animation '{name}' = {len(recipe['frames'])} frames, loop {loop}")
