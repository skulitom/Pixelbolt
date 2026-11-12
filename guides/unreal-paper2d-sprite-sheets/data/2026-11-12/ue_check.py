# Runs inside Unreal Engine (tested on 5.8.4), headless:
#   UnrealEditor-Cmd.exe <kit>/P2DDefault.uproject -ExecutePythonScript=<kit>/ue_check.py -RenderOffScreen -nullrhi -unattended -nosplash -nosound
# (or P2DTest.uproject, with P2D_OUT=<kit>/results)
# with the environment variable P2D_ROOT=<kit> (the folder holding out/ and pixelbolt_paper2d.py).
# For each test sheet it runs the guide's script, then writes what Paper2D built to results/<case>.json:
# the texture's settings and pixels (as PNG), each sprite's rectangle, trim, pivot, material and baked
# geometry, and each flipbook's frame rate, length and the sprite it returns for the middle of every frame.
# check_results.py compares those with the Pixelbolt atlas. The editor quits when done.
import json
import os
import re
import sys
import traceback

import unreal

ROOT = os.environ["P2D_ROOT"].replace("\\", "/").rstrip("/")
OUT = os.environ.get("P2D_OUT", ROOT + "/results").replace("\\", "/")
sys.path.insert(0, ROOT)
import pixelbolt_paper2d  # noqa: E402

CASES = os.environ.get("P2D_CASES", "forest-spirit,forest-spirit-trim2x,campfire,hero,fire-spells,explosion,campfire-092").split(",")
VERT = re.compile(r"BakedRenderData\((\d+)\)=\(X=([-0-9.e+]+),Y=([-0-9.e+]+),Z=([-0-9.e+]+),W=([-0-9.e+]+)\)")


def vec2(v):
    return [v.x, v.y]


def path_of(obj):
    return obj.get_path_name() if obj is not None else None


def export(obj, filename, exporter):
    task = unreal.AssetExportTask()
    task.set_editor_property("object", obj)
    task.set_editor_property("filename", filename)
    task.set_editor_property("automated", True)
    task.set_editor_property("prompt", False)
    task.set_editor_property("replace_identical", True)
    task.set_editor_property("exporter", exporter)
    return unreal.Exporter.run_asset_export_task(task)


def baked_render_data(sprite, name):
    # BakedRenderData is not an editor property, so read it from the sprite's text (T3D) export:
    # one (X, Y, U, V) per vertex, X and Y in pixels from the pivot (Y up), U and V across the texture.
    filename = OUT + "/t3d/" + name + ".t3d"
    if not export(sprite, filename, unreal.ObjectExporterT3D()):
        return None
    with open(filename, encoding="utf-8", errors="replace") as handle:
        found = VERT.findall(handle.read())
    return [[float(x), float(y), float(u), float(v)] for _, x, y, u, v in sorted(found, key=lambda m: int(m[0]))]


def check(case):
    atlas_path = ROOT + "/out/%s/%s.atlas.json" % (case, case)
    folder = "/Game/T/" + case
    result = {"case": case, "atlas": "out/%s/%s.atlas.json" % (case, case), "folder": folder,
              "engine": unreal.SystemLibrary.get_engine_version()}
    sheet = pixelbolt_paper2d.main(["pixelbolt_paper2d.py", atlas_path, folder])
    with open(atlas_path, encoding="utf-8") as handle:
        atlas = json.load(handle)

    assets = unreal.get_editor_subsystem(unreal.EditorAssetSubsystem)
    result["assets"] = {}
    for path in assets.list_assets(folder, recursive=True, include_folder=False):
        result["assets"][path] = unreal.load_asset(path).get_class().get_name()
    result["saved_on_disk"] = sum(
        1 for path in result["assets"]
        if os.path.exists(unreal.Paths.convert_relative_path_to_full(
            unreal.Paths.project_content_dir() + path.split(".")[0][len("/Game/"):] + ".uasset")))

    result["sheet"] = path_of(sheet)
    sprites = pixelbolt_paper2d.sprites_by_frame(sheet)
    texture = sheet.get_editor_property("texture")
    result["texture"] = {
        "path": path_of(texture),
        "size": [texture.blueprint_get_size_x(), texture.blueprint_get_size_y()],
        "lod_group": str(texture.get_editor_property("lod_group")),
        "compression_settings": str(texture.get_editor_property("compression_settings")),
        "filter": str(texture.get_editor_property("filter")),
        "srgb": texture.get_editor_property("srgb"),
        "mip_gen_settings": str(texture.get_editor_property("mip_gen_settings")),
        "exported_png": export(texture, OUT + "/" + case + ".texture.png", unreal.TextureExporterPNG()),
    }

    result["sprites"] = {}
    for frame in atlas["frames"]:
        sprite = sprites[frame]
        result["sprites"][frame] = {
            "path": path_of(sprite),
            "source_uv": vec2(sprite.get_editor_property("source_uv")),
            "source_dimension": vec2(sprite.get_editor_property("source_dimension")),
            "trimmed": sprite.get_editor_property("trimmed_in_source_image"),
            "origin_before_trim": vec2(sprite.get_editor_property("origin_in_source_image_before_trimming")),
            "size_before_trim": vec2(sprite.get_editor_property("source_image_dimension_before_trimming")),
            "rotated": sprite.get_editor_property("rotated_in_source_image"),
            "pivot_mode": str(sprite.get_editor_property("pivot_mode")),
            "pixels_per_unit": sprite.get_editor_property("pixels_per_unreal_unit"),
            "material": path_of(sprite.get_editor_property("default_material")),
            "baked": baked_render_data(sprite, case + "__" + re.sub(r"[^A-Za-z0-9_-]", "_", frame)),
        }

    result["flipbooks"] = {}
    for animation, entry in atlas.get("animations", {}).items():
        flipbook = unreal.load_asset(folder + "/Flipbooks/" + pixelbolt_paper2d.asset_name(case + "_" + animation))
        times = [int(atlas["frames"][f]["duration"]) for f in (entry if isinstance(entry, list) else entry["frames"])]
        samples, start = [], 0
        for frame, time in zip((entry if isinstance(entry, list) else entry["frames"]), times):
            middle = (start + time / 2.0) / 1000.0
            samples.append({"frame": frame, "at": middle, "got": path_of(flipbook.get_sprite_at_time(middle, False))})
            start += time
        result["flipbooks"][animation] = {
            "path": path_of(flipbook),
            "fps": flipbook.get_editor_property("frames_per_second"),
            "num_key_frames": flipbook.get_num_key_frames(),
            "num_frames": flipbook.get_num_frames(),
            "total_duration": flipbook.get_total_duration(),
            "expected_ms": sum(times),
            "samples": samples,
        }
    return result


os.makedirs(OUT + "/t3d", exist_ok=True)
summary = {}
for case in CASES:
    try:
        data = check(case)
        with open(OUT + "/" + case + ".json", "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=1)
        summary[case] = "ok"
    except Exception:
        summary[case] = traceback.format_exc()
        unreal.log_error("P2D check failed for %s:\n%s" % (case, summary[case]))
with open(OUT + "/summary.json", "w", encoding="utf-8") as handle:
    json.dump(summary, handle, indent=1)
unreal.log("P2D check summary: " + json.dumps(summary)[:2000])
if os.environ.get("P2D_QUIT", "1") == "1":
    unreal.SystemLibrary.quit_editor()
