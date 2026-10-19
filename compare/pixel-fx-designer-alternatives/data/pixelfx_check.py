"""Independent checks of Pixelbolt's fluid exports for the "Pixel FX Designer alternative" page.

Reads pixelfx_measure.mjs's result and, with Pillow (not Pixelbolt's code), decodes every exported frame PNG, the
sprite sheet and the 1x GIF of each preset:
- palette: every visible pixel's colour must be one of the recipe's palette colours;
- GIF: same frame count, and every pixel equal to the PNG frame (transparent where the PNG is transparent);
- sheet: the sprite sheet holds the same pixels as the frames, at the atlas's positions;
- loop seam: for looping effects, pixels changed from the last frame back to the first, against the changes between
  ordinary neighbouring frames (median and maximum).
Usage: python -I pixelfx_check.py <measure-result.json> <check-result.json>
"""
import json
import statistics
import sys
from pathlib import Path

from PIL import Image


def hex_to_rgba(value):
    v = value.lstrip('#')
    if len(v) == 6:
        v += 'ff'
    return tuple(int(v[i:i + 2], 16) for i in range(0, 8, 2))


def load_rgba(path):
    with Image.open(path) as im:
        return im.convert('RGBA')


def diff_count(a, b):
    pa, pb = a.getdata(), b.getdata()
    n = 0
    for x, y in zip(pa, pb):
        # Fully transparent pixels compare equal whatever their RGB.
        if x[3] == 0 and y[3] == 0:
            continue
        if x != y:
            n += 1
    return n


def main(measure_path, out_path):
    measure = json.loads(Path(measure_path).read_text(encoding='utf-8'))
    report = {'source': measure_path, 'commit': measure['commit'], 'describe': measure['describe'], 'pillow': Image.__version__, 'presets': []}
    for p in measure['presets']:
        name = p['name']
        render = Path(p['render']['dir'])
        palette = {hex_to_rgba(v) for v in p['palette'].values()}
        atlas = json.loads((render / f'{name}.atlas.json').read_text(encoding='utf-8'))
        frame_names = [f'{name}-{i}' for i in range(p['frames'])]
        # Use the recipe's own frame order from the animation when there is one animation.
        anims = p['animations']
        if len(anims) == 1:
            frame_names = list(anims.values())[0]['frames']
        frames = [load_rgba(render / 'frames' / f'{fn}.png') for fn in frame_names]
        colours = set()
        off = set()
        visible = 0
        partial = 0
        for im in frames:
            for px in im.getdata():
                if px[3] == 0:
                    continue
                visible += 1
                if px[3] != 255:
                    partial += 1
                colours.add(px)
                if px not in palette:
                    off.add(px)
        # Sheet against frames, using the atlas positions.
        sheet = load_rgba(render / f'{name}.png')
        sheet_mismatch = 0
        atlas_frames = atlas.get('frames', {})
        checked_sheet = 0
        for fn, im in zip(frame_names, frames):
            entry = atlas_frames.get(fn) if isinstance(atlas_frames, dict) else next((f for f in atlas_frames if f.get('filename') == fn or f.get('name') == fn), None)
            if not entry:
                continue
            fr = entry.get('frame', entry)
            src = entry.get('spriteSourceSize', {'x': 0, 'y': 0})
            crop = sheet.crop((fr['x'], fr['y'], fr['x'] + fr['w'], fr['y'] + fr['h']))
            ref = im.crop((src['x'], src['y'], src['x'] + fr['w'], src['y'] + fr['h']))
            sheet_mismatch += diff_count(crop, ref)
            checked_sheet += 1
        # GIF against frames.
        gif_frames = []
        gif_durations = []
        with Image.open(p['gif']['path']) as g:
            for i in range(g.n_frames):
                g.seek(i)
                gif_frames.append(g.convert('RGBA'))
                gif_durations.append(g.info.get('duration'))
        gif_mismatch = sum(diff_count(a, b) for a, b in zip(gif_frames, frames)) if len(gif_frames) == len(frames) else None
        # Loop seam.
        steps = [diff_count(frames[i], frames[i + 1]) for i in range(len(frames) - 1)]
        loops = [v.get('loop', True) for v in anims.values()]
        seam = diff_count(frames[-1], frames[0]) if len(frames) > 1 else None
        report['presets'].append({
            'preset': name, 'size': f"{p['width']}x{p['height']}", 'frames': len(frames), 'paletteSize': len(palette),
            'visiblePixels': visible, 'partialAlphaPixels': partial, 'coloursUsed': len(colours), 'offPalette': len(off),
            'sheetFramesChecked': checked_sheet, 'sheetMismatchPixels': sheet_mismatch,
            'gifFrames': len(gif_frames), 'gifMismatchPixels': gif_mismatch, 'gifDurationsMs': gif_durations,
            'recipeDurationsMs': [p['durationsMs'][i] for i in range(len(p['durationsMs']))],
            'animationLoop': loops, 'effectsLoop': [e['loop'] for e in p['effects']],
            'stepMedian': statistics.median(steps) if steps else None, 'stepMax': max(steps) if steps else None,
            'stepMin': min(steps) if steps else None, 'seam': seam,
        })
        r = report['presets'][-1]
        print(f"{name}: {r['size']} x{r['frames']} colours {r['coloursUsed']}/{r['paletteSize']} off={r['offPalette']} partial={r['partialAlphaPixels']}; "
              f"sheet {r['sheetFramesChecked']} frames mismatch={r['sheetMismatchPixels']}; gif {r['gifFrames']} frames mismatch={r['gifMismatchPixels']}; "
              f"loop={r['effectsLoop']} seam={r['seam']} steps median={r['stepMedian']} max={r['stepMax']}")
    Path(out_path).write_text(json.dumps(report, indent=1), encoding='utf-8')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
