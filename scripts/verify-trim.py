"""Independent developer check for trimmed atlases. Requires Pillow, never used by Pixelbolt itself.

Exports a pose-compiled character with sheet.trim, padding and scale 2 through the CLI, then uses Pillow to
confirm that every trimmed rectangle, pasted at its spriteSourceSize offset into a sourceSize canvas, equals the
full-canvas frame PNG; that no two rectangles overlap; and that each pivot and anchor equal anchorPx / sourceSize.
"""
from pathlib import Path
import json
import subprocess
import tempfile
from PIL import Image

root = Path(__file__).resolve().parents[1]
compile_keeper = """
import { readFileSync } from 'node:fs';
import { compilePoses, resolveReferences } from './src/index.js';
const source = JSON.parse(readFileSync('showcase/tidewatch/art/poses/keeper.poses.json', 'utf8'));
const { document } = await resolveReferences(source, { baseDir: 'showcase/tidewatch/art/poses' });
const { recipe } = compilePoses(document);
recipe.name = 'keeper-trim'; recipe.sheet = { trim: true, padding: 1, scale: 2 };
process.stdout.write(JSON.stringify(recipe));
"""
recipe = subprocess.check_output(['node', '--input-type=module', '-e', compile_keeper], cwd=root)
with tempfile.TemporaryDirectory() as temporary:
    out = Path(temporary) / 'bundle'
    subprocess.run(['node', 'bin/pixelbolt.js', 'render', '-', '--out', str(out)], input=recipe, cwd=root, check=True, capture_output=True)
    atlas = json.loads((out / 'keeper-trim.atlas.json').read_text())
    sheet = Image.open(out / atlas['meta']['image']).convert('RGBA')
    assert sheet.size == (atlas['meta']['size']['w'], atlas['meta']['size']['h'])
    rects = []
    for name, entry in atlas['frames'].items():
        rect, offset, source = entry['frame'], entry['spriteSourceSize'], entry['sourceSize']
        assert entry['trimmed'] is True, name
        assert (rect['w'], rect['h']) == (offset['w'], offset['h']), name
        rebuilt = Image.new('RGBA', (source['w'], source['h']), (0, 0, 0, 0))
        rebuilt.paste(sheet.crop((rect['x'], rect['y'], rect['x'] + rect['w'], rect['y'] + rect['h'])), (offset['x'], offset['y']))
        full = Image.open(out / 'frames' / f'{name}.png').convert('RGBA')
        assert full.size == (source['w'], source['h']), name
        assert rebuilt.tobytes() == full.tobytes(), name
        assert entry['pivot']['x'] * source['w'] == entry['anchorPx']['x'] and entry['pivot']['y'] * source['h'] == entry['anchorPx']['y'], name
        assert entry['anchor'] == entry['pivot'], name
        rects.append((name, rect))
    for i, (a, ra) in enumerate(rects):
        for b, rb in rects[i + 1:]:
            apart = ra['x'] + ra['w'] <= rb['x'] or rb['x'] + rb['w'] <= ra['x'] or ra['y'] + ra['h'] <= rb['y'] or rb['y'] + rb['h'] <= ra['y']
            assert apart, (a, b)
    untrimmed_area = len(rects) * source['w'] * source['h']
    print(f"Verified {len(rects)} trimmed frames: atlas {sheet.size[0]}x{sheet.size[1]} = {sheet.size[0] * sheet.size[1]} px vs {untrimmed_area} px untrimmed cells.")
