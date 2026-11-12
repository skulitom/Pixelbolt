# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Pixelbolt maintainers
"""Import a Pixelbolt sprite sheet into Unreal Engine's Paper2D and make one Flipbook per animation.

Run it inside the Unreal Editor (Edit > Plugins: Paper2D and Python Editor Script Plugin on). Put this
file in a folder whose path has no spaces, for example C:/pixelbolt, and Pixelbolt's name.atlas.json
and name.png together in another, for example C:/pixelbolt/hero. Then, in the Output Log's command box
with "Cmd" chosen beside it, type:

    py C:/pixelbolt/pixelbolt_paper2d.py C:/pixelbolt/hero/hero.atlas.json /Game/Sprites/Hero

The last argument is optional (default /Game/Pixelbolt/<name>). The script:

1. Imports name.atlas.json (with name.png beside it) through the editor's own import, with no
   importer named, so Paper2D's sprite sheet importer reads it: a Texture under Textures/, a Sprite
   Sheet, and one Sprite per frame under Frames/, each with the frame's rectangle, trim and pivot.
2. Sets the texture's Mip Gen Settings to NoMipmaps (pixel art wants no smaller, blurred copies;
   Unreal already does this unless both sides of the sheet are powers of two).
3. Writes one Flipbook per entry in the atlas's "animations" under Flipbooks/, in playback order,
   with exact timing. Pixelbolt gives every frame a time in whole milliseconds; a Flipbook has one
   frame rate and a whole number of frames per key frame. So the frame rate is 1000 / the largest
   step that divides every frame time in that animation, and each key frame runs time / step
   frames. Frames of 100, 100 and 200 ms play at 10 frames per second for 1, 1 and 2.

Give each import a folder of its own: the script stops, changing nothing, if the folder already
holds assets. A Paper2D Flipbook has no loop setting of its own, and a Paper Flipbook Component loops
by default. The animations the atlas marks "loop": false are listed at the end: for those, call Set
Looping (unticked) on the component in a Blueprint, then Play From Start.

It expects a Pixelbolt atlas: "frames" as an object keyed by frame name, each with a "duration" in
milliseconds, and "animations" keyed by name. Each animation is either an object whose "frames" lists
frame names in playback order, with "loop" (what Pixelbolt writes today), or a plain list of frame
names, with "loop" in a separate "loops" object (older atlases). Any other animation layout, or a
frame without a duration of 1 ms or more, stops with a message.

Tested with Unreal Engine 5.8.4 and Pixelbolt 0.12.1:
https://skulitom.github.io/Pixelbolt/guides/unreal-paper2d-sprite-sheets/
MIT licence, like Pixelbolt (https://github.com/skulitom/Pixelbolt): you may use, copy, modify and
share it, keeping this notice; it comes with no warranty.
"""
import functools
import json
import math
import os
import re
import sys

import unreal


def asset_name(text):
    return re.sub(r"[^A-Za-z0-9_-]", "_", text) or "unnamed"


def import_sheet(atlas_path, folder):
    task = unreal.AssetImportTask()
    task.set_editor_property("filename", atlas_path)
    task.set_editor_property("destination_path", folder)
    task.set_editor_property("automated", True)
    task.set_editor_property("replace_existing", True)
    task.set_editor_property("save", True)
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    for path in task.get_editor_property("imported_object_paths"):
        asset = unreal.load_asset(path)
        if isinstance(asset, unreal.PaperSpriteSheet):
            return asset
    raise RuntimeError(
        "Paper2D's sprite sheet importer did not take %s. Is the Paper2D plugin on, and is the "
        "sheet PNG named in the atlas's meta.image beside it?" % atlas_path)


def sprites_by_frame(sheet):
    names = list(sheet.get_editor_property("sprite_names"))
    sprites = list(sheet.get_editor_property("sprites"))
    found = {}
    for name, sprite in zip(names, sprites):
        if sprite is not None and not isinstance(sprite, unreal.PaperSprite):
            sprite = unreal.load_asset(str(sprite))
        found[name] = sprite
    return found


def frame_time(frames_by_name, frame):
    """A frame's time in whole milliseconds, or None if the atlas doesn't give it one of 1 ms or more."""
    entry = frames_by_name.get(frame) if isinstance(frame, str) else None
    duration = entry.get("duration") if isinstance(entry, dict) else None
    if (isinstance(duration, bool) or not isinstance(duration, (int, float)) or not math.isfinite(duration)
            or int(duration) < 1):
        return None
    return int(duration)


def no_mipmaps(texture):
    before = texture.get_editor_property("mip_gen_settings")
    if before != unreal.TextureMipGenSettings.TMGS_NO_MIPMAPS:
        texture.set_editor_property("mip_gen_settings", unreal.TextureMipGenSettings.TMGS_NO_MIPMAPS)
        unreal.log("Pixelbolt: %s Mip Gen Settings %s -> NoMipmaps" % (texture.get_name(), before))


def write_flipbook(folder, name, frames, sprites, step):
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    flipbook = tools.create_asset(name, folder, unreal.PaperFlipbook, unreal.PaperFlipbookFactory())
    if flipbook is None:
        raise RuntimeError("Could not create the Flipbook %s/%s" % (folder, name))
    keys = []
    for frame, time in frames:
        key = unreal.PaperFlipbookKeyFrame()
        key.set_editor_property("sprite", sprites[frame])
        key.set_editor_property("frame_run", time // step)
        keys.append(key)
    flipbook.set_editor_property("frames_per_second", 1000.0 / step)
    flipbook.set_editor_property("key_frames", keys)
    return flipbook


def main(argv):
    if len(argv) < 2:
        raise SystemExit("usage: py C:/pixelbolt/pixelbolt_paper2d.py C:/pixelbolt/hero/hero.atlas.json [/Game/Folder]")
    atlas_path = os.path.abspath(argv[1])
    with open(atlas_path, encoding="utf-8") as handle:
        atlas = json.load(handle)
    frames_by_name = atlas.get("frames")
    animations = atlas.get("animations")
    if not isinstance(frames_by_name, dict) or not isinstance(animations, dict) or not animations:
        raise RuntimeError("%s is not a Pixelbolt atlas: it needs \"frames\" as an object and an \"animations\" "
                           "object. Drag other JSON sheets into the Content Browser instead." % atlas_path)
    base = os.path.basename(atlas_path)
    name = base[: -len(".atlas.json")] if base.endswith(".atlas.json") else os.path.splitext(base)[0]
    folder = argv[2].rstrip("/") if len(argv) > 2 else "/Game/Pixelbolt/" + asset_name(name)

    loops = atlas.get("loops")
    loops = loops if isinstance(loops, dict) else {}
    plan = {}
    for animation, entry in animations.items():
        if isinstance(entry, list):  # an older atlas: frame names here, "loop" in "loops"
            names, loop = entry, loops.get(animation)
        elif isinstance(entry, dict) and isinstance(entry.get("frames"), list):
            names, loop = entry["frames"], entry.get("loop", loops.get(animation))
        else:
            raise RuntimeError("%s: animation %r should be a list of frame names or an object with \"frames\"."
                               % (atlas_path, animation))
        if not names:
            raise RuntimeError("%s: animation %r has no frames." % (atlas_path, animation))
        times = [(frame, frame_time(frames_by_name, frame)) for frame in names]
        bad = [str(frame) for frame, time in times if time is None]
        if bad:
            raise RuntimeError("%s: animation %r names frames the atlas doesn't have, or frames without a duration "
                               "of 1 ms or more: %s" % (atlas_path, animation, ", ".join(bad[:5])))
        flipbook_name = asset_name(name + "_" + animation)
        if flipbook_name in plan:
            raise RuntimeError("Animations %r and %r would both be named %s" % (plan[flipbook_name][0], animation, flipbook_name))
        plan[flipbook_name] = (animation, times, loop is False)

    assets = unreal.get_editor_subsystem(unreal.EditorAssetSubsystem)
    if assets.list_assets(folder, recursive=True, include_folder=False):
        raise RuntimeError("%s already holds assets. Import into a new folder, or delete that one first." % folder)

    sheet = import_sheet(atlas_path, folder)
    sprites = sprites_by_frame(sheet)
    missing = [frame for frame in frames_by_name if sprites.get(frame) is None]
    if missing:
        raise RuntimeError("No sprite was imported for frames: " + ", ".join(missing))
    no_mipmaps(sheet.get_editor_property("texture"))

    once, made = [], []
    for flipbook_name, (animation, times, plays_once) in plan.items():
        step = functools.reduce(math.gcd, [time for _, time in times])
        write_flipbook(folder + "/Flipbooks", flipbook_name, times, sprites, step)
        made.append("%s (%d key frames at %g fps, %d ms)" % (flipbook_name, len(times), 1000.0 / step,
                                                              sum(time for _, time in times)))
        if plays_once:
            once.append(flipbook_name)

    # The importer leaves the texture and sprites unsaved; save everything in the folder.
    assets.save_directory(folder, only_if_is_dirty=True, recursive=True)
    unreal.log("Pixelbolt: %d sprites and %d flipbooks in %s" % (len(sprites), len(made), folder))
    for line in made:
        unreal.log("  " + line)
    if once:
        unreal.log("Play once (Set Looping off on the Paper Flipbook Component, then Play From Start): " + ", ".join(once))
    return sheet


if __name__ == "__main__":
    main(sys.argv)
