"""Independent developer check. Requires Pillow, never used by Pixelbolt itself."""
from pathlib import Path
import base64
import io
import json
import subprocess
import tempfile
import zipfile
from PIL import Image

root = Path(__file__).resolve().parents[1]
folder = root / 'output' / 'forest-spirit'
atlas = json.loads((folder / 'forest-spirit.atlas.json').read_text())
sheet = Image.open(folder / atlas['meta']['image']).convert('RGBA')
assert sheet.size == (atlas['meta']['size']['w'], atlas['meta']['size']['h'])
for name, frame in atlas['frames'].items():
    rect = frame['frame']
    individual = Image.open(folder / 'frames' / f'{name}.png').convert('RGBA')
    cropped = sheet.crop((rect['x'], rect['y'], rect['x'] + rect['w'], rect['y'] + rect['h']))
    assert cropped.tobytes() == individual.tobytes(), name
for name, animation in atlas['animations'].items():
    image = Image.open(folder / 'animations' / f'{name}.png')
    assert image.n_frames == len(animation['frames']), name
    assert image.info['loop'] == (0 if animation['loop'] else 1)
    for index, frame_name in enumerate(animation['frames']):
        image.seek(index)
        assert image.info['duration'] == atlas['frames'][frame_name]['duration']
        expected = Image.open(folder / 'frames' / f'{frame_name}.png').convert('RGBA')
        assert image.convert('RGBA').tobytes() == expected.tobytes(), (name, index)

# Decode an independently generated transparent replacement frame to detect trails.
program = """
import { encodeAPNG } from './src/png.js';
process.stdout.write(encodeAPNG([
  {data:new Uint8Array([255,0,0,255,0,0,0,0]),duration:70},
  {data:new Uint8Array([0,0,0,0,0,255,0,128]),duration:130}
],2,1));
"""
image = Image.open(io.BytesIO(subprocess.check_output(['node', '--input-type=module', '-e', program], cwd=root)))
image.seek(1)
assert list(image.convert('RGBA').getdata()) == [(0, 0, 0, 0), (0, 255, 0, 128)]

# A GIF frame with no transparent pixels of its own, then one with holes. Pillow restores a cleared frame to the
# background colour unless the frame names a transparent index, so the holes must still read as clear here.
program = """
import { encodeGIF } from './src/gif.js';
const red = [255, 0, 0, 255], blue = [0, 0, 255, 255], clear = [0, 0, 0, 0];
process.stdout.write(encodeGIF([
  { data: Uint8Array.from(Array(16).fill(red).flat()), duration: 100 },
  { data: Uint8Array.from(Array.from({ length: 16 }, (_, i) => i === 5 ? blue : clear).flat()), duration: 100 }
], 4, 4).data);
"""
image = Image.open(io.BytesIO(subprocess.check_output(['node', '--input-type=module', '-e', program], cwd=root)))
image.seek(1)
assert list(image.convert('RGBA').getdata()) == [(0, 0, 255, 255) if i == 5 else (0, 0, 0, 0) for i in range(16)]

program = """
import { readFile } from 'node:fs/promises';
import { createBundle, createZip } from './src/export.js';
const spec = JSON.parse(await readFile('examples/forest-spirit.json', 'utf8'));
process.stdout.write(createZip((await createBundle(spec)).files));
"""
data = subprocess.check_output(['node', '--input-type=module', '-e', program], cwd=root)
with zipfile.ZipFile(io.BytesIO(data)) as archive:
    assert archive.testzip() is None
    assert 'forest-spirit.atlas.json' in archive.namelist()
    Image.open(io.BytesIO(archive.read('forest-spirit.png'))).verify()
    count = len(archive.namelist())

# Decode an inspection contact sheet and compare every cell with the raw frame pixels.
program = """
import { readFile } from 'node:fs/promises';
import { renderProject, inspectProject } from './src/core.js';
import { encodePNG } from './src/png.js';
const project = renderProject(JSON.parse(await readFile('examples/forest-spirit.json', 'utf8')));
const { cells, sheet: { data, ...layout } } = inspectProject(project, { animation: 'idle', background: 'transparent' });
const frames = Object.fromEntries(project.frames.map(f => [f.name, Buffer.from(f.data).toString('base64')]));
process.stdout.write(JSON.stringify({ size: [project.width, project.height], cells, layout, frames, png: encodePNG(data, layout.width, layout.height).toString('base64') }));
"""
view = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', program], cwd=root))
layout, size = view['layout'], tuple(view['size'])
contact = Image.open(io.BytesIO(base64.b64decode(view['png']))).convert('RGBA')
assert contact.size == (layout['width'], layout['height'])
cell_w, cell_h = size[0] * layout['scale'], size[1] * layout['scale']
for index, cell in enumerate(view['cells']):
    left = layout['gap'] + index % layout['columns'] * (cell_w + layout['gap'])
    top = layout['gap'] + index // layout['columns'] * (cell_h + layout['gap'])
    crop = contact.crop((left, top, left + cell_w, top + cell_h)).resize(size, Image.Resampling.NEAREST)
    assert crop.tobytes() == base64.b64decode(view['frames'][cell['frame']]), cell['frame']

# Decode a patch comparison: each row's before and after cells must show their frames' opaque pixels.
program = """
import { readFile } from 'node:fs/promises';
import { renderProject, compareProjects } from './src/core.js';
import { patchRecipe } from './src/patch.js';
import { encodePNG } from './src/png.js';
const recipe = JSON.parse(await readFile('examples/forest-spirit.json', 'utf8'));
const before = renderProject(recipe), after = renderProject(patchRecipe(recipe, [{ set: 'palette.k', value: '#5a2d3c' }]).recipe);
const { image: { region, frames, sheet: { data, ...layout } } } = compareProjects(before, after);
const raw = project => Object.fromEntries(project.frames.map(f => [f.name, Buffer.from(f.data).toString('base64')]));
process.stdout.write(JSON.stringify({ width: after.width, region, frames, layout, before: raw(before), after: raw(after), png: encodePNG(data, layout.width, layout.height).toString('base64') }));
"""
diff = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', program], cwd=root))
layout, region = diff['layout'], diff['region']
comparison = Image.open(io.BytesIO(base64.b64decode(diff['png']))).convert('RGBA')
assert comparison.size == (layout['width'], layout['height']) and layout['columns'] == 2
cell_w, cell_h = region['w'] * layout['scale'], region['h'] * layout['scale']
for row, entry in enumerate(diff['frames']):
    for column, side in enumerate(('before', 'after')):
        left, top = layout['gap'] + column * (cell_w + layout['gap']), layout['gap'] + row * (cell_h + layout['gap'])
        cell = comparison.crop((left, top, left + cell_w, top + cell_h)).resize((region['w'], region['h']), Image.Resampling.NEAREST)
        raw = base64.b64decode(diff[side][entry['frame']])
        for y in range(region['h']):
            for x in range(region['w']):
                at = ((region['y'] + y) * diff['width'] + region['x'] + x) * 4
                if raw[at + 3] == 255:
                    assert cell.getpixel((x, y)) == tuple(raw[at:at + 4]), (entry['frame'], side, x, y)

# Exercise actual MCP responses and decode canvas corrections after a real server restart.
with tempfile.TemporaryDirectory(prefix='pixelbolt-decode-') as temporary:
    assert Path(temporary).resolve().is_relative_to(Path(tempfile.gettempdir()).resolve())
    recipe = {
        'version': 1, 'name': 'painted', 'width': 3, 'height': 2,
        'frames': [
            {'name': 'a', 'duration': 70, 'layers': [{'x': 1, 'y': 1, 'ops': [{'op': 'pixel', 'color': '#f00'}]}]},
            {'name': 'b', 'duration': 130, 'from': 'a'}
        ]
    }

    def mcp(name, arguments):
        messages = [
            {'jsonrpc': '2.0', 'id': 0, 'method': 'initialize', 'params': {'protocolVersion': '2025-11-25'}},
            {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': name, 'arguments': arguments}}
        ]
        response = subprocess.check_output(['node', 'bin/pixelbolt.js', 'mcp', '--out', temporary],
                                           input=''.join(json.dumps(m) + '\n' for m in messages).encode(), cwd=root)
        result = json.loads(response.splitlines()[-1])['result']
        assert not result.get('isError'), result
        return result

    patched = mcp('pixel_patch', {'project': recipe, 'changes': [{'paint': 'frames[a]', 'value': [
        {'x': 1, 'y': 1, 'color': 'transparent'}, {'x': 2, 'y': 0, 'color': '#00ff0080'}
    ]}]})
    revision = json.loads(patched['content'][0]['text'])['revision']
    result = mcp('pixel_render', {'revision': revision})
    info = json.loads(result['content'][0]['text'])
    preview = info['preview']
    assert preview['cells'] == [{'frame': 'a', 'duration': 70}, {'frame': 'b', 'duration': 130}]
    image = Image.open(io.BytesIO(base64.b64decode(result['content'][1]['data']))).convert('RGBA')
    layout = preview['sheet']
    assert image.size == (layout['width'], layout['height'])
    for index, entry in enumerate(preview['cells']):
        raw = Image.open(Path(info['directory']) / 'frames' / (entry['frame'] + '.png')).convert('RGBA')
        assert raw.getpixel((1, 1)) == (0, 0, 0, 0)
        assert raw.getpixel((2, 0)) == (0, 255, 0, 128)
        left = layout['gap'] + index % layout['columns'] * (3 * layout['scale'] + layout['gap'])
        top = layout['gap'] + index // layout['columns'] * (2 * layout['scale'] + layout['gap'])
        cell = image.crop((left, top, left + 3 * layout['scale'], top + 2 * layout['scale'])).resize((3, 2), Image.Resampling.NEAREST)
        assert cell.getpixel((1, 1)) == (143, 145, 151, 255)
        assert cell.getpixel((2, 0)) == (65, 194, 69, 255)
    with Image.open(Path(info['directory']) / 'animations' / 'default.png') as animated:
        assert animated.n_frames == 2
        for index, duration in enumerate((70, 130)):
            animated.seek(index)
            assert animated.info['duration'] == duration
            assert animated.convert('RGBA').getpixel((1, 1)) == (0, 0, 0, 0)
            assert animated.convert('RGBA').getpixel((2, 0)) == (0, 255, 0, 128)

# Decode GIFs with Pillow and compare every pixel, delay and loop flag with the rendered frames: once with
# 1-bit transparency (alpha below 128 is clear) and once blended onto a background and scaled.
program = """
import { readFile } from 'node:fs/promises';
import { renderProject } from './src/core.js';
import { animationGIF } from './src/gif.js';
const project = renderProject(JSON.parse(await readFile('examples/forest-spirit.json', 'utf8'))), out = {};
for (const [name, options] of [['idle', { scale: 1 }], ['blink', { scale: 3, background: '#17191d' }]]) {
  const gif = animationGIF(project, name, options);
  out[name] = { data: Buffer.from(gif.data).toString('base64'), loop: gif.loop, scale: gif.scale, width: project.width, height: project.height,
    frames: project.animations[name].frames.map(i => ({ rgba: Buffer.from(project.frames[i].data).toString('base64'), duration: project.frames[i].duration })) };
}
process.stdout.write(JSON.stringify(out));
"""
gifs = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', program], cwd=root))
matte = (0x17, 0x19, 0x1d)
for name, expected in gifs.items():
    image = Image.open(io.BytesIO(base64.b64decode(expected['data'])))
    scale, width, height = expected['scale'], expected['width'], expected['height']
    assert image.format == 'GIF' and image.size == (width * scale, height * scale), name
    assert image.n_frames == len(expected['frames']), name
    assert image.info.get('loop') == (0 if expected['loop'] else None), (name, image.info.get('loop'))
    for index, frame in enumerate(expected['frames']):
        image.seek(index)
        assert image.info['duration'] == frame['duration'], (name, index)
        source = base64.b64decode(frame['rgba'])
        decoded = image.convert('RGBA').resize((width, height), Image.Resampling.NEAREST)
        for position, actual in enumerate(decoded.getdata()):
            r, g, b, a = source[position * 4:position * 4 + 4]
            if name == 'blink':
                wanted = tuple((channel * a + back * (255 - a) + 127) // 255 for channel, back in zip((r, g, b), matte)) + (255,)
            else:
                wanted = (r, g, b, 255) if a >= 128 else (0, 0, 0, 0)
            assert actual == wanted, (name, index, position, actual, wanted)
        # Every pixel of a scaled block is the same colour: nothing was resampled.
        assert image.convert('RGBA').tobytes() == decoded.resize(image.size, Image.Resampling.NEAREST).tobytes(), (name, index)

# An image sequence for a video editor. Pillow reads every numbered PNG; each must be the pose that is active when
# that video frame starts (worked out here with fractions, apart from Pixelbolt), enlarged by whole pixels at its
# place, with the alpha left alone. If ffmpeg is installed, the command the sequence prints must then make a video
# with the same frame count, rate and size, whose alpha is exact and whose colours are within 3 of 255.
from fractions import Fraction
import shutil
with tempfile.TemporaryDirectory() as temporary:
    out = Path(temporary) / 'sequence'
    subprocess.check_output(['node', 'bin/pixelbolt.js', 'sequence', 'examples/forest-spirit.json', '--fps', '29.97', '--size', '320x180',
                             '--align', 'bottom-left', '--offset', '12,-6', '--loops', '2', '--out', str(out)], cwd=root)
    info = json.loads((out / 'sequence.json').read_text(encoding='utf-8'))
    assert (info['fps']['numerator'], info['fps']['denominator'], info['width'], info['height']) == (30000, 1001, 320, 180)
    poses = [(name, atlas['frames'][name]['duration']) for name in atlas['animations']['idle']['frames']]
    one_pass = sum(duration for _, duration in poses)
    assert info['frames'] == -(-Fraction(2 * one_pass * 30000, 1000 * 1001) // 1), info['frames']
    sheet_scale = atlas['meta']['scale'] if isinstance(atlas['meta'].get('scale'), int) else 1
    for number in range(1, info['frames'] + 1):
        moment = Fraction((number - 1) * 1001 * 1000, 30000) % one_pass
        elapsed, active = 0, None
        for name, duration in poses:
            if elapsed <= moment < elapsed + duration:
                active = name
            elapsed += duration
        pose = Image.open(folder / 'frames' / f'{active}.png').convert('RGBA')
        native = pose.resize((pose.width // sheet_scale, pose.height // sheet_scale), Image.Resampling.NEAREST)
        expected = Image.new('RGBA', (320, 180), (0, 0, 0, 0))
        # 24 pixels fit 180 seven times: 168, placed 12 from the left and 6 above the bottom edge.
        expected.paste(native.resize((168, 168), Image.Resampling.NEAREST), (12, 180 - 168 - 6))
        actual = Image.open(out / (info['pattern'] % number))
        assert actual.mode == 'RGBA' and actual.tobytes() == expected.tobytes(), (number, active)
    video = 'not checked: ffmpeg is not installed'
    if shutil.which('ffmpeg') and shutil.which('ffprobe'):
        subprocess.run(info['commands']['prores4444'] + ' -loglevel error', cwd=out, shell=True, check=True)
        stream = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries',
            'stream=codec_name,pix_fmt,width,height,r_frame_rate,nb_read_frames', '-of', 'json', str(out / (info['name'] + '.mov'))]))['streams'][0]
        assert (stream['codec_name'], int(stream['nb_read_frames']), stream['width'], stream['height'], stream['r_frame_rate']) == ('prores', info['frames'], 320, 180, '30000/1001'), stream
        assert stream['pix_fmt'].startswith('yuva'), stream['pix_fmt']
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', str(out / (info['name'] + '.mov')), '-vf', 'scale=in_color_matrix=bt709:flags=neighbor', '-frames:v', '1', '-pix_fmt', 'rgba', str(out / 'back.png')], check=True)
        first, back = Image.open(out / (info['pattern'] % 1)).convert('RGBA'), Image.open(out / 'back.png').convert('RGBA')
        assert first.getchannel('A').tobytes() == back.getchannel('A').tobytes()
        worst = max(abs(a - b) for original, decoded in zip(first.getdata(), back.getdata()) if original[3] for a, b in zip(original[:3], decoded[:3]))
        assert worst <= 3, worst
        video = f'ffmpeg made a {stream["pix_fmt"]} ProRes video of {stream["nb_read_frames"]} frames with exact alpha and colours within {worst} of 255'
        # The H.264 command keeps every colour (lossless 4:4:4), even at an odd scale: 24 pixels fit 180 seven times.
        # It is read back with bicubic chroma, as players do, which would smear the colours of a 4:2:0 file.
        matte = Path(temporary) / 'matte'
        subprocess.check_output(['node', 'bin/pixelbolt.js', 'sequence', 'examples/forest-spirit.json', '--fps', '10', '--size', '320x180',
                                 '--background', '#1a1c2c', '--seconds', '0.2', '--out', str(matte)], cwd=root)
        matted = json.loads((matte / 'sequence.json').read_text(encoding='utf-8'))
        subprocess.run(matted['commands']['h264'] + ' -loglevel error', cwd=matte, shell=True, check=True)
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', str(matte / (matted['name'] + '.mp4')), '-vf', 'scale=in_color_matrix=bt709:flags=bicubic+full_chroma_int+full_chroma_inp+accurate_rnd,format=rgb24',
                        '-frames:v', '1', str(matte / 'back.png')], check=True)
        first, back = Image.open(matte / (matted['pattern'] % 1)).convert('RGB'), Image.open(matte / 'back.png').convert('RGB')
        h264_worst = max(abs(a - b) for original, decoded in zip(first.getdata(), back.getdata()) for a, b in zip(original, decoded))
        assert matted['placement']['scale'] == 7 and h264_worst <= 2, (matted['placement'], h264_worst)
        video += f', and an H.264 video at scale 7 with colours within {h264_worst} of 255'
    sequence_frames = info['frames']
    # The sequence folder back as a GIF at its own rate. Each frame must be its PNG with alpha below 128 cleared, and
    # each delay the step between frame starts rounded to centiseconds, worked out here with fractions.
    looped = Path(temporary) / 'sequence.gif'
    report = json.loads(subprocess.check_output(['node', 'bin/pixelbolt.js', 'gif-frames', str(out), '--fps', '29.97', '--loops', '3', '--out', str(looped)], cwd=root))
    image = Image.open(looped)
    assert image.n_frames == info['frames'] == report['frames'] and image.info.get('loop') == 2, (image.n_frames, image.info.get('loop'))
    starts = [(Fraction(k * 100 * 1001, 30000) + Fraction(1, 2)) // 1 for k in range(info['frames'] + 1)]
    for number in range(1, info['frames'] + 1):
        image.seek(number - 1)
        assert image.info['duration'] == max(2, starts[number] - starts[number - 1]) * 10, (number, image.info['duration'])
        source = Image.open(out / (info['pattern'] % number)).convert('RGBA')
        wanted = bytes(channel for r, g, b, a in source.getdata() for channel in ((r, g, b, 255) if a >= 128 else (0, 0, 0, 0)))
        assert image.convert('RGBA').tobytes() == wanted, number
    # Pillow keeps an animated file open for seeking; Windows cannot delete the folder until it is closed.
    image.close()
    # Frames whose colours differ: 1,200 in all, 200 per frame, some one level apart. Each frame needs a table of its
    # own, and every colour must come back exactly.
    many = Path(temporary) / 'many'
    many.mkdir()
    for number in range(6):
        frame = Image.new('RGB', (40, 30))
        frame.putdata([((i * 7 + number * 31) % 256, (i * 13 + number) % 256, number * 40 + i % 2) for i in range(200)] * 6)
        frame.save(many / f'flash_{number + 1:03d}.png')
    report = json.loads(subprocess.check_output(['node', 'bin/pixelbolt.js', 'gif-frames', str(many), '--fps', '25', '--out', str(Path(temporary) / 'many.gif')], cwd=root))
    assert (report['colors'], report['tables'], report['loops']) == (1200, 'per frame', 0), report
    image = Image.open(Path(temporary) / 'many.gif')
    for number in range(6):
        image.seek(number)
        assert image.info['duration'] == 40 and image.convert('RGB').tobytes() == Image.open(many / f'flash_{number + 1:03d}.png').tobytes(), number
    image.close()
    # Cover: 24 pixels cover 100 × 60 five times (120 × 120); from the top-right corner, 20 pixels are cut on the left
    # and 60 at the bottom. Pillow crops the same enlarged pose itself.
    cover = Path(temporary) / 'cover'
    subprocess.check_output(['node', 'bin/pixelbolt.js', 'sequence', 'examples/forest-spirit.json', '--fps', '10', '--size', '100x60',
                             '--fit', 'cover', '--align', 'top-right', '--out', str(cover)], cwd=root)
    covered = json.loads((cover / 'sequence.json').read_text(encoding='utf-8'))
    assert (covered['placement']['scale'], covered['placement']['x'], covered['placement']['visible']) == (5, -20, [4, 0, 20, 12]), covered['placement']
    pose = Image.open(folder / 'frames' / f'{poses[0][0]}.png').convert('RGBA')
    native = pose.resize((pose.width // sheet_scale, pose.height // sheet_scale), Image.Resampling.NEAREST)
    expected = native.resize((120, 120), Image.Resampling.NEAREST).crop((20, 0, 120, 60))
    actual = Image.open(cover / (covered['pattern'] % 1))
    assert actual.mode == 'RGBA' and actual.size == (100, 60) and actual.tobytes() == expected.tobytes()

print(f'Independent decode passed: a {sequence_frames}-frame image sequence at 29.97 with exact pixels and alpha ({video}), a cover-cropped frame, the sequence back as a GIF and 1,200 colours over 6 GIF frames from PNG folders, {len(gifs)} GIFs with exact pixels, delays and loop flags, sprite sheet, {len(atlas["frames"])} frames, {len(atlas["animations"])} APNGs, exact timing/alpha, {count}-file ZIP, a {len(view["cells"])}-cell contact sheet, a {len(diff["frames"])}-row patch comparison, and MCP painting/restart/all-frame preview.')
