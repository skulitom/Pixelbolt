// Loads exported SpriteFrames (.tres) in a real Godot 4 and checks them against the atlas: every animation's frames,
// regions and trim margins, each frame's pixels as Godot composes them, loop flags, and playback timing, by playing
// each animation on an AnimatedSprite2D at a fixed 1000 frames per second, so every process step is 1 ms. Then loads
// exported TileSets and paints maps with Godot's terrain painter, which must choose the tiles Pixelbolt would.
// Independent developer check: Pixelbolt never needs Godot.
//   node scripts/verify-godot.mjs [--godot <path to the Godot 4 executable>] [--keep] [--render]
// --render also lights a sprite in a Godot window (Godot can't render headless), so run it where a window may open.
// Without --godot it uses $GODOT, then godot4 or godot on PATH, then a winget install of GodotEngine.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createBundle } from '../src/export.js';
import { createSceneBundle } from '../src/scene-export.js';
import { compileAutotile, compileNormals } from '../src/authoring.js';
import { neighbourMask } from '../src/autotile.js';

// A trimmed, scaled, padded sheet with unequal frame times: a 1×1 cell for an empty frame, a half-transparent frame, a
// frame that fills the canvas, a 5 ms flash (Godot's 120 FPS ceiling), 33 and 34 ms frames (fractional durations),
// reverse and ping-pong runs, and a sequence with a hold, which has no Aseprite tag. Two frame names have hyphens,
// which a Godot resource id can't (Godot 4.7 logs an error for each), as compiled effects and autotile sets have.
export const GODOT_FIXTURE = {
  version: 1, name: 'godot-trim', width: 12, height: 10,
  palette: { r: '#e04040', g: '#40c060', b: '#4060e0', y: '#f0d040', h: '#4060e080' },
  frames: [
    { name: 'dot', duration: 100, ops: [{ op: 'rect', x: 1, y: 2, w: 2, h: 3, color: 'r' }] },
    { name: 'bar', duration: 150, ops: [{ op: 'rect', x: 5, y: 7, w: 6, h: 2, color: 'g' }, { op: 'pixel', x: 11, y: 9, color: 'y' }] },
    { name: 'gap', duration: 250 },
    { name: 'half-alpha', duration: 33, ops: [{ op: 'rect', x: 3, y: 0, w: 4, h: 10, color: 'h' }] },
    { name: 'full', duration: 34, ops: [{ op: 'rect', x: 0, y: 0, w: 12, h: 10, color: 'b' }] },
    { name: 'flash-5ms', duration: 5, ops: [{ op: 'pixel', x: 6, y: 5, color: 'y' }] }
  ],
  animations: {
    walk: { frames: ['dot', 'bar', 'gap'] },
    flicker: { frames: ['half-alpha', 'full'] },
    strobe: { frames: ['flash-5ms', 'dot'], loop: false },
    back: { frames: ['dot', 'bar', 'gap'], direction: 'reverse' },
    sway: { frames: ['dot', 'bar', 'gap'], direction: 'pingpong' },
    hold: { frames: ['dot', 'dot', 'full'] }
  },
  sheet: { trim: true, padding: 1, scale: 2 }
};

// Runs in Godot: dumps every animation's frames and plays each one, recording when its frame changes.
const CHECK = `extends SceneTree

var report := {}
var plan := []
var sprite: AnimatedSprite2D
var step := -1
# The length in milliseconds of every process step the sprite has played the current animation for, and what
# happened in which step: the main loop's _process runs before the nodes in the same step, with the same delta.
var steps := []
var played := 0.0
var events := []
var recording := false

func _initialize():
	var cases = JSON.parse_string(FileAccess.get_file_as_string("res://cases.json"))
	for c in cases:
		var frames = load(c["tres"])
		if not frames is SpriteFrames:
			report[c["key"]] = {"error": "not a SpriteFrames: %s" % [frames]}
			continue
		var animations := {}
		for anim in frames.get_animation_names():
			var list := []
			for i in frames.get_frame_count(anim):
				var texture = frames.get_frame_texture(anim, i)
				var entry := {"duration": frames.get_frame_duration(anim, i), "class": texture.get_class()}
				if texture is AtlasTexture:
					entry["region"] = [texture.region.position.x, texture.region.position.y, texture.region.size.x, texture.region.size.y]
					entry["margin"] = [texture.margin.position.x, texture.margin.position.y, texture.margin.size.x, texture.margin.size.y]
					entry["size"] = [texture.get_width(), texture.get_height()]
					entry["filter_clip"] = texture.filter_clip
					entry["atlas"] = texture.atlas.resource_path
					entry["mismatched"] = compare(texture, c["frames"] + "/" + c["names"][anim][i] + ".png")
				list.append(entry)
			animations[anim] = {"speed": frames.get_animation_speed(anim), "loop": frames.get_animation_loop(anim), "frames": list}
			plan.append({"key": c["key"], "frames": frames, "anim": anim, "run": c["run"][anim]})
		report[c["key"]] = {"animations": animations, "playback": {}}
	sprite = AnimatedSprite2D.new()
	root.add_child(sprite)
	sprite.frame_changed.connect(_on_frame_changed)
	sprite.animation_finished.connect(_on_finished)

func _on_frame_changed():
	if recording:
		events.append([steps.size() - 1, sprite.frame])

func _on_finished():
	if recording:
		events.append([steps.size() - 1, -1])

# The frame as Godot draws it: the region placed at margin.position on a texture of the AtlasTexture's size, compared
# with the full-canvas frame PNG. Fully transparent pixels match whatever their colour.
func compare(texture: AtlasTexture, file: String) -> int:
	var sheet: Image = texture.atlas.get_image()
	if sheet == null:
		return -1
	sheet.convert(Image.FORMAT_RGBA8)
	var drawn := Image.create_empty(texture.get_width(), texture.get_height(), false, Image.FORMAT_RGBA8)
	drawn.blit_rect(sheet, Rect2i(texture.region), Vector2i(texture.margin.position))
	var expected := Image.load_from_file(ProjectSettings.globalize_path(file))
	expected.convert(Image.FORMAT_RGBA8)
	if expected.get_size() != drawn.get_size():
		return -2
	var wrong := 0
	for y in drawn.get_height():
		for x in drawn.get_width():
			var a := drawn.get_pixel(x, y)
			var b := expected.get_pixel(x, y)
			if not (a.a8 == 0 and b.a8 == 0) and (a.r8 != b.r8 or a.g8 != b.g8 or a.b8 != b.b8 or a.a8 != b.a8):
				wrong += 1
	return wrong

func _process(delta: float) -> bool:
	if step >= 0 and played < plan[step]["run"]:
		steps.append(delta * 1000.0)
		played += delta * 1000.0
		return false
	if step >= 0:
		recording = false
		report[plan[step]["key"]]["playback"][plan[step]["anim"]] = {"steps": steps, "events": events}
	step += 1
	if step >= plan.size():
		print("PIXELBOLT " + JSON.stringify(report, "", false, true))
		quit()
		return true
	var next = plan[step]
	sprite.sprite_frames = next["frames"]
	sprite.play(next["anim"])
	steps = [delta * 1000.0]
	played = delta * 1000.0
	events = []
	recording = true
	return false
`;

// Tile sets: a blob set on a scaled, padded sheet, a cardinal set with two variants of every tile (Godot picks one at
// random), and a blob set whose three palette variants animate each tile (six columns, so every tile's frames sit
// side by side in one row).
const TILE_TEMPLATE = ['....oggo', '....gddg', '....gddg', '....oggo', 'oooooooo', 'oggggggo', 'ogddddgo', 'ogdggdgo', 'ogdggdgo', 'ogddddgo', 'oggggggo', 'oooooooo'];
const TILE_SOURCE = { format: 'pixelforge-autotile', version: 1, tile: 4, palette: { o: '#203018', g: '#58a040', d: '#3c7830' }, template: TILE_TEMPLATE };
export const GODOT_TILE_SOURCES = [
  { ...TILE_SOURCE, name: 'turf', frame: 'turf-{mask}', sheet: { padding: 1, scale: 2 } },
  { ...TILE_SOURCE, name: 'fence', mode: 'cardinal', frame: 'fence-{mask}-{variant}', variants: [{ name: 'plain' }, { name: 'mossy', palette: { d: '#6a8a30' } }] },
  { ...TILE_SOURCE, name: 'surf', frame: 'surf-{mask}-{variant}', animation: 'surf-{mask}', sheet: { columns: 6 },
    variants: [{ name: 'a', duration: 120 }, { name: 'b', duration: 250, palette: { g: '#60b0e0' } }, { name: 'c', duration: 90, palette: { d: '#2c5878' } }] }
];
// Maps painted with Godot's terrain painter: islands, single cells and one-cell strips, inner corners, a ring, cells
// touching only at a corner, and a seeded scatter.
const scatter = Array.from({ length: 14 }, (_, y) => Array.from({ length: 22 }, (_, x) => ((x * 7919 + y * 104729 + x * y * 31) % 97 < 58 ? '#' : '.')).join(''));
export const GODOT_TILE_MAPS = [
  ['#.##.###', '..##.#.#', '#...####', '###.....', '#.#.##.#'],
  ['.#####.', '##...##', '#..#..#', '##...##', '.#####.'],
  ['#.#.#', '.#.#.', '#.#.#', '.###.', '#.#.#'],
  ['..#..', '.###.', '#####', '.###.', '..#..'],
  scatter
];

// Runs in Godot: reads each TileSet back (terrain, tiles, peering bits, animation frames and their pixels), then paints
// every map with set_cells_terrain_connect and records the tile Godot chose for each cell.
const TILE_CHECK = `extends SceneTree

const NEIGHBOURS = {"right_side": TileSet.CELL_NEIGHBOR_RIGHT_SIDE, "bottom_right_corner": TileSet.CELL_NEIGHBOR_BOTTOM_RIGHT_CORNER, "bottom_side": TileSet.CELL_NEIGHBOR_BOTTOM_SIDE, "bottom_left_corner": TileSet.CELL_NEIGHBOR_BOTTOM_LEFT_CORNER, "left_side": TileSet.CELL_NEIGHBOR_LEFT_SIDE, "top_left_corner": TileSet.CELL_NEIGHBOR_TOP_LEFT_CORNER, "top_side": TileSet.CELL_NEIGHBOR_TOP_SIDE, "top_right_corner": TileSet.CELL_NEIGHBOR_TOP_RIGHT_CORNER}

func _initialize():
	var cases = JSON.parse_string(FileAccess.get_file_as_string("res://tilecases.json"))
	var report := {}
	for c in cases:
		var tiles = load(c["tres"])
		if not tiles is TileSet:
			report[c["key"]] = {"error": "not a TileSet: %s" % [tiles]}
			continue
		var source: TileSetAtlasSource = tiles.get_source(tiles.get_source_id(0))
		var list := []
		for i in source.get_tiles_count():
			var at := source.get_tile_id(i)
			var data := source.get_tile_data(at, 0)
			var bits := {}
			for name in NEIGHBOURS:
				if data.is_valid_terrain_peering_bit(NEIGHBOURS[name]) and data.get_terrain_peering_bit(NEIGHBOURS[name]) != -1:
					bits[name] = data.get_terrain_peering_bit(NEIGHBOURS[name])
			var frames := []
			for f in source.get_tile_animation_frames_count(at):
				var region := source.get_tile_texture_region(at, f)
				var cell := Vector2i(at.x + f, at.y)
				var file = c["files"].get("%d:%d" % [cell.x, cell.y], "")
				frames.append({"duration": source.get_tile_animation_frame_duration(at, f), "region": [region.position.x, region.position.y, region.size.x, region.size.y], "mismatched": compare(source.texture, region, file)})
			list.append({"at": [at.x, at.y], "alternatives": source.get_alternative_tiles_count(at), "terrain_set": data.terrain_set, "terrain": data.terrain, "probability": data.probability, "bits": bits, "frames": frames})
		var painted := []
		for rows in c["maps"]:
			var layer := TileMapLayer.new()
			layer.tile_set = tiles
			root.add_child(layer)
			var cells: Array[Vector2i] = []
			for y in rows.size():
				for x in rows[y].length():
					if rows[y][x] != ".":
						cells.append(Vector2i(x, y))
			layer.set_cells_terrain_connect(cells, 0, 0)
			var got := {}
			for cell in layer.get_used_cells():
				var at := layer.get_cell_atlas_coords(cell)
				got["%d,%d" % [cell.x, cell.y]] = "%d:%d" % [at.x, at.y]
			painted.append(got)
			layer.free()
		report[c["key"]] = {"mode": tiles.get_terrain_set_mode(0), "terrain": tiles.get_terrain_name(0, 0), "tile_size": [tiles.tile_size.x, tiles.tile_size.y], "texture": source.texture.resource_path, "margins": [source.margins.x, source.margins.y], "separation": [source.separation.x, source.separation.y], "region_size": [source.texture_region_size.x, source.texture_region_size.y], "tiles": list, "painted": painted}
	print("PIXELBOLT " + JSON.stringify(report, "", false, true))
	quit()

# A tile's region of the sheet against the frame PNG it came from. Fully transparent pixels match whatever their colour.
func compare(texture: Texture2D, region: Rect2i, file: String) -> int:
	if file == "":
		return -3
	var sheet: Image = texture.get_image()
	if sheet == null:
		return -1
	sheet.convert(Image.FORMAT_RGBA8)
	var expected := Image.load_from_file(ProjectSettings.globalize_path(file))
	expected.convert(Image.FORMAT_RGBA8)
	if expected.get_size() != region.size:
		return -2
	var wrong := 0
	for y in region.size.y:
		for x in region.size.x:
			var a := sheet.get_pixel(region.position.x + x, region.position.y + y)
			var b := expected.get_pixel(x, y)
			if not (a.a8 == 0 and b.a8 == 0) and (a.r8 != b.r8 or a.g8 != b.g8 or a.b8 != b.b8 or a.a8 != b.a8):
				wrong += 1
	return wrong
`;

export function findGodot(given = process.env.GODOT) {
  if (given) return given;
  for (const name of ['godot4', 'godot']) {
    const probe = spawnSync(name, ['--version'], { encoding: 'utf8' });
    if (probe.status === 0 && /^4\./.test(probe.stdout.trim())) return name;
  }
  const packages = path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Packages');
  if (process.platform === 'win32' && existsSync(packages)) for (const folder of readdirSync(packages).filter(name => name.startsWith('GodotEngine.GodotEngine'))) {
    const executable = readdirSync(path.join(packages, folder)).find(name => /^Godot_v4.*_console\.exe$/.test(name));
    if (executable) return path.join(packages, folder, executable);
  }
  return null;
}

const godotRun = (godot, args, { headless = true } = {}) => {
  const result = spawnSync(godot, [...(headless ? ['--headless'] : []), ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300_000 });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
};

// AnimatedSprite2D's process step (scene/2d/animated_sprite_2d.cpp), replayed over the step lengths Godot used, for
// an animation of `durations` (Godot's relative durations) at `speed`. Returns [step, frame] for every frame change
// and [step, -1] for animation_finished. Godot 4.6 takes the speed at the top of each pass, so after a frame changes
// the rest of that pass still runs at the previous frame's speed: a frame after a much shorter one is cut short
// (godotengine/godot#123572). `stale: false` gives the new frame its own speed at once, as the proposed fix does.
// Godot keeps frame_progress and frame durations as 32-bit floats.
export function replaySprite(speed, durations, loop, steps, { stale = true } = {}) {
  const f32 = Math.fround, events = [], last = durations.length - 1;
  let frame = 0, progress = 0;
  for (const [index, ms] of steps.entries()) {
    let remaining = ms / 1000, passes = 0;
    while (remaining) {
      let rate = speed * (1 / f32(durations[frame]));
      if (progress >= 1) {
        if (frame >= last) {
          if (!loop) { events.push([index, -1]); return events; }
          frame = 0;
        } else frame++;
        progress = 0;
        events.push([index, frame]);
        if (!stale) rate = speed * (1 / f32(durations[frame]));
      }
      const taken = Math.min((1 - progress) / rate, remaining);
      progress = f32(progress + taken * rate);
      remaining -= taken;
      if (++passes > durations.length) break;
    }
  }
  return events;
}
// When each frame change and the finish would happen if every frame lasted exactly its recipe milliseconds: the step
// whose span holds the boundary, or the next one when a step ends exactly on it.
function idealEvents(ms, loop, steps, played) {
  const events = [], ends = [];
  let at = 0, time = 0;
  for (const step of steps) ends.push(at += step);
  const stepOf = boundary => { const i = ends.findIndex(end => end > boundary + 1e-6); return i < 0 ? null : i; };
  for (let i = 0; ; i = (i + 1) % ms.length) {
    time += ms[i];
    const step = stepOf(time);
    if (step === null || time > played - 1) return events;
    if (!loop && i === ms.length - 1) { events.push([step, -1]); return events; }
    events.push([step, (i + 1) % ms.length]);
  }
}
// The events [step, frame] of `got` that differ from `want`: same frames in order, steps within `slack`.
const differences = (got, want, slack) => got.length !== want.length ? [`${got.length} events, expected ${want.length}`]
  : got.flatMap(([step, frame], i) => (frame !== want[i][1] || Math.abs(step - want[i][0]) > slack ? [`event ${i}: frame ${frame} in step ${step}, expected frame ${want[i][1]} in step ${want[i][0]}`] : []));

export async function verifyGodot({ godot = findGodot(), keep = false, log = console.log } = {}) {
  if (!godot) throw new Error('Godot 4 was not found: pass --godot <path> or set GODOT');
  const version = godotRun(godot, ['--version']).output.trim().split('\n')[0];
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-godot-'));
  try {
    await writeFile(path.join(dir, 'project.godot'), 'config_version=5\n\n[application]\n\nconfig/name="Pixelbolt Godot check"\n');
    const spirit = JSON.parse(await readFile(fileURLToPath(new URL('../examples/forest-spirit.json', import.meta.url)), 'utf8'));
    const cases = [], expected = {};
    for (const recipe of [spirit, GODOT_FIXTURE]) {
      const bundle = await createBundle(recipe), { name } = bundle.project, folder = `sprites/${name}`;
      const atlas = JSON.parse(bundle.files.get(`${name}.atlas.json`));
      // The sheet, the .tres and the frame PNGs, in a folder below the project root, so the .tres's relative path is used.
      for (const [file, bytes] of bundle.files) if (file === `${name}.png` || file === `${name}.tres` || file.startsWith('frames/')) {
        await mkdir(path.dirname(path.join(dir, folder, file)), { recursive: true });
        await writeFile(path.join(dir, folder, file), bytes);
      }
      const run = Object.fromEntries(Object.entries(atlas.animations).map(([key, animation]) => [key, animation.loop ? animation.duration * 2 + 5 : animation.duration + 10]));
      cases.push({ key: name, tres: `res://${folder}/${name}.tres`, frames: `res://${folder}/frames`, names: Object.fromEntries(Object.entries(atlas.animations).map(([key, a]) => [key, a.frames])), run });
      expected[name] = { atlas, run, warnings: bundle.project.warnings };
    }
    await writeFile(path.join(dir, 'cases.json'), JSON.stringify(cases));
    await writeFile(path.join(dir, 'check.gd'), CHECK);
    const imported = godotRun(godot, ['--path', dir, '--import']);
    const problems = imported.output.split('\n').filter(line => /ERROR|WARNING/.test(line) && /sprites\//.test(line));
    assert.deepEqual(problems, [], `Godot reported problems while importing:\n${imported.output}`);
    const checked = godotRun(godot, ['--path', dir, '--fixed-fps', '1000', '--script', 'res://check.gd']);
    const line = checked.output.split('\n').find(text => text.startsWith('PIXELBOLT '));
    assert.ok(line, `Godot printed no report:\n${checked.output}`);
    const errors = checked.output.split('\n').filter(text => /^\s*(ERROR|SCRIPT ERROR|WARNING)/.test(text));
    assert.deepEqual(errors, [], `Godot reported problems:\n${checked.output}`);
    const report = JSON.parse(line.slice(10));
    let frames = 0, changes = 0;
    const behaviour = new Set(), shifted = [];
    for (const [name, { atlas }] of Object.entries(expected)) {
      const got = report[name];
      assert.ok(got && !got.error, `${name}: ${got?.error ?? 'missing from the report'}`);
      assert.deepEqual(Object.keys(got.animations).sort(), Object.keys(atlas.animations).sort(), `${name}: animation names`);
      for (const [key, animation] of Object.entries(atlas.animations)) {
        const where = `${name}.${key}`, played = got.animations[key];
        assert.equal(played.loop, animation.loop, `${where}: loop`);
        assert.equal(played.frames.length, animation.frames.length, `${where}: frame count`);
        played.frames.forEach((frame, i) => {
          const source = atlas.frames[animation.frames[i]], { x, y, w, h } = source.frame, offset = source.spriteSourceSize;
          assert.equal(frame.class, 'AtlasTexture', `${where}[${i}]: texture class`);
          assert.equal(frame.atlas, `res://sprites/${name}/${name}.png`, `${where}[${i}]: the sheet beside the .tres`);
          assert.deepEqual(frame.region, [x, y, w, h], `${where}[${i}]: region`);
          assert.deepEqual(frame.margin, source.trimmed ? [offset.x, offset.y, source.sourceSize.w - w, source.sourceSize.h - h] : [0, 0, 0, 0], `${where}[${i}]: margin`);
          assert.deepEqual(frame.size, [source.sourceSize.w, source.sourceSize.h], `${where}[${i}]: texture size`);
          assert.equal(frame.filter_clip, true, `${where}[${i}]: filter_clip`);
          assert.equal(frame.mismatched, 0, `${where}[${i}]: ${frame.mismatched} pixels differ from frames/${animation.frames[i]}.png (-1: no image, -2: size)`);
          // Godot plays a frame for duration ÷ speed seconds.
          const ms = frame.duration / played.speed * 1000;
          assert.ok(Math.abs(ms - source.duration) <= source.duration * 1e-6, `${where}[${i}]: plays ${ms} ms, not ${source.duration}`);
          frames++;
        });
        // Playback: what AnimatedSprite2D did, step by step, against a replay of its code with these durations
        // (exact up to one step of float rounding) and against the recipe's own timing.
        const { steps, events } = got.playback[key], time = steps.reduce((sum, ms) => sum + ms, 0);
        const relative = played.frames.map(frame => frame.duration);
        const stale = differences(events, replaySprite(played.speed, relative, played.loop, steps), 1);
        const fixed = differences(events, replaySprite(played.speed, relative, played.loop, steps, { stale: false }), 1);
        assert.ok(!stale.length || !fixed.length, [`${where}: playback matches neither Godot 4.6 and 4.7's AnimatedSprite2D nor the fixed one:`, ...stale.slice(0, 4), ...fixed.slice(0, 4)].join('\n'));
        behaviour.add(stale.length ? 'fixed' : 'stale');
        // How far that is from the recipe: Godot 4.6's carried-over speed moves a frame change after a shorter frame.
        const ideal = idealEvents(animation.frames.map(name => atlas.frames[name].duration), animation.loop, steps, time);
        const shift = Math.max(0, ...ideal.map(([step], i) => (events[i] ? Math.abs(steps.slice(0, events[i][0] + 1).reduce((sum, ms) => sum + ms, 0) - steps.slice(0, step + 1).reduce((sum, ms) => sum + ms, 0)) : 0)));
        if (shift > 1.5) shifted.push(`${where} ${Math.round(shift)} ms`);
        changes += events.length;
      }
    }
    log(`${version}: ${Object.keys(expected).length} SpriteFrames loaded; ${frames} frames match their regions, margins, sizes, pixels and times; ${changes} playback events match a replay of AnimatedSprite2D${behaviour.has('stale') ? " as Godot 4.6 and 4.7 run it (the rest of a step after a frame change at the previous frame's speed, godotengine/godot#123572)" : ' with each frame at its own speed'}.`);
    if (shifted.length) log(`AnimatedSprite2D moves frame changes away from the recipe's times in ${shifted.join(', ')} (1 ms process steps); the SpriteFrames' times are exact.`);
    return { version, report, expected, behaviour: [...behaviour], shifted, dir: keep ? dir : null };
  } finally {
    if (!keep) await rm(dir, { recursive: true, force: true });
  }
}

// A lit scene asset: an orb with a normal pass derived from it, two frames so the SpriteFrames has a sequence.
const ORB = { version: 1, name: 'orb', width: 16, height: 16, palette: { o: '#30285a', b: '#6a5acd', l: '#b8b0f0' },
  frames: [{ name: 'a', duration: 200, ops: [{ op: 'ellipse', x: 1, y: 1, w: 14, h: 14, color: 'b', filled: true }, { op: 'ellipse', x: 1, y: 1, w: 14, h: 14, color: 'o' }, { op: 'rect', x: 5, y: 4, w: 2, h: 2, color: 'l' }] },
    { name: 'b', duration: 200, from: 'a', ops: [{ op: 'pixel', x: 9, y: 9, color: 'l' }] }] };
export const GODOT_LIT_SCENE = { format: 'pixelforge-scene', version: 1, name: 'lit-orb', width: 32, height: 24,
  assets: { orb: { recipe: ORB, normal: compileNormals({ format: 'pixelforge-normals', version: 1, recipe: ORB }).recipe } },
  instances: [{ asset: 'orb', at: [8, 4] }], lighting: { ambient: 0.4, lights: [{ at: [4, 2], height: 12, radius: 40 }] } };

// Runs in Godot, headless: each frame of the lit asset's SpriteFrames must be drawn through its CanvasTexture, whose
// normal map is the normal pass with green flipped.
const LIT_CHECK = `extends SceneTree

func _initialize():
	var dir = "res://lit/assets/0/"
	var frames = load(dir + "sprite_frames.tres")
	var report := {"frames": []}
	for anim in frames.get_animation_names():
		for i in frames.get_frame_count(anim):
			var texture = frames.get_frame_texture(anim, i)
			var atlas = texture.atlas if texture is AtlasTexture else null
			var entry := {"class": texture.get_class(), "atlas": atlas.get_class() if atlas else ""}
			if atlas is CanvasTexture:
				entry["diffuse"] = atlas.diffuse_texture.resource_path
				entry["normal"] = atlas.normal_texture.resource_path
				entry["filter"] = atlas.texture_filter
			report["frames"].append(entry)
	var up := (load(dir + "normal_y_up.png") as Texture2D).get_image()
	var down := (load(dir + "normal.png") as Texture2D).get_image()
	up.convert(Image.FORMAT_RGBA8)
	down.convert(Image.FORMAT_RGBA8)
	var flipped := 0
	var wrong := 0
	for y in down.get_height():
		for x in down.get_width():
			var a := up.get_pixel(x, y)
			var b := down.get_pixel(x, y)
			# Godot's importer bleeds edge colours into transparent pixels (fix_alpha_border), so those only stay transparent.
			if b.a8 == 0:
				if a.a8 != 0:
					wrong += 1
			elif a.r8 == b.r8 and a.g8 == 255 - b.g8 and a.b8 == b.b8 and a.a8 == b.a8:
				flipped += 1
			else:
				wrong += 1
	report["flipped"] = flipped
	report["wrong"] = wrong
	print("PIXELBOLT " + JSON.stringify(report))
	quit()
`;

// Runs in Godot with a window (it renders): the orb drawn from the exported SpriteFrames, and as a control the same
// frame through a CanvasTexture with the unflipped normal pass, each lit by a point light above, below, left and right
// of it. Reports the brightness of each half of the sprite.
const LIGHT_CHECK = `extends SceneTree

const SIDES = {"above": Vector2(0, -150), "below": Vector2(0, 150), "left": Vector2(-150, 0), "right": Vector2(150, 0)}
var plan := []
var step := -1
var wait := 0
var report := {}
var exported: AnimatedSprite2D
var control: Sprite2D
var light: PointLight2D

func _initialize():
	RenderingServer.set_default_clear_color(Color.BLACK)
	var dir = "res://lit/assets/0/"
	var frames = load(dir + "sprite_frames.tres")
	var shade := CanvasModulate.new()
	shade.color = Color(0.1, 0.1, 0.1)
	root.add_child(shade)
	exported = AnimatedSprite2D.new()
	exported.sprite_frames = frames
	exported.animation = frames.get_animation_names()[0]
	exported.position = Vector2(128, 128)
	exported.scale = Vector2(8, 8)
	root.add_child(exported)
	var raw := CanvasTexture.new()
	raw.diffuse_texture = load(dir + "color.png")
	raw.normal_texture = load(dir + "normal.png")
	raw.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	control = Sprite2D.new()
	control.texture = raw
	control.region_enabled = true
	control.region_rect = frames.get_frame_texture(exported.animation, 0).region
	control.position = exported.position
	control.scale = exported.scale
	root.add_child(control)
	var white := Image.create_empty(64, 64, false, Image.FORMAT_RGBA8)
	white.fill(Color.WHITE)
	light = PointLight2D.new()
	light.texture = ImageTexture.create_from_image(white)
	light.texture_scale = 16.0
	light.height = 60.0
	root.add_child(light)
	for sprite in ["exported", "control"]:
		for side in SIDES:
			plan.append([sprite, side])

func _process(_delta: float) -> bool:
	if step >= 0 and wait < 4:
		wait += 1
		return false
	if step >= 0:
		var image := root.get_texture().get_image()
		image.convert(Image.FORMAT_RGBA8)
		var halves := {"top": 0.0, "bottom": 0.0, "left": 0.0, "right": 0.0}
		for y in range(64, 192):
			for x in range(64, 192):
				var value := image.get_pixel(x, y).get_luminance()
				halves["top" if y < 128 else "bottom"] += value
				halves["left" if x < 128 else "right"] += value
		report[plan[step][0] + " " + plan[step][1]] = halves
	step += 1
	if step >= plan.size():
		print("PIXELBOLT " + JSON.stringify(report))
		quit()
		return true
	exported.visible = plan[step][0] == "exported"
	control.visible = plan[step][0] == "control"
	light.position = exported.position + SIDES[plan[step][1]]
	wait = 0
	return false
`;

// Loads a lit scene asset's export in a real Godot 4: its SpriteFrames draws every frame through canvas_texture.tres,
// whose normal map is normal_y_up.png, the normal pass with green flipped. With render (a window opens, so not
// headless), it also lights the sprite from each side and checks the lit half faces the light, while the unflipped
// normal pass lights it upside down.
export async function verifyGodotLit({ godot = findGodot(), keep = false, log = console.log, render = false } = {}) {
  if (!godot) throw new Error('Godot 4 was not found: pass --godot <path> or set GODOT');
  const version = godotRun(godot, ['--version']).output.trim().split('\n')[0];
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-godot-lit-'));
  try {
    await writeFile(path.join(dir, 'project.godot'), 'config_version=5\n\n[application]\n\nconfig/name="Pixelbolt lit sprite check"\n');
    const bundle = await createSceneBundle(GODOT_LIT_SCENE);
    for (const [file, bytes] of bundle.files) if (file.startsWith('assets/')) {
      await mkdir(path.dirname(path.join(dir, 'lit', file)), { recursive: true });
      await writeFile(path.join(dir, 'lit', file), bytes);
    }
    await writeFile(path.join(dir, 'litcheck.gd'), LIT_CHECK);
    await writeFile(path.join(dir, 'lightcheck.gd'), LIGHT_CHECK);
    const imported = godotRun(godot, ['--path', dir, '--import']);
    const problems = imported.output.split('\n').filter(line => /ERROR|WARNING/.test(line) && /lit\//.test(line));
    assert.deepEqual(problems, [], `Godot reported problems while importing:\n${imported.output}`);
    const report = godotReport(godotRun(godot, ['--path', dir, '--script', 'res://litcheck.gd']));
    const atlas = JSON.parse(bundle.files.get('assets/0/atlas.json')), count = Object.values(atlas.animations).reduce((sum, a) => sum + a.frames.length, 0);
    assert.equal(report.frames.length, count, 'frames in the SpriteFrames');
    for (const [i, frame] of report.frames.entries()) assert.deepEqual(frame, { class: 'AtlasTexture', atlas: 'CanvasTexture', diffuse: 'res://lit/assets/0/color.png', normal: 'res://lit/assets/0/normal_y_up.png', filter: 1 }, `frame ${i}`);
    assert.equal(report.wrong, 0, `${report.wrong} pixels of normal_y_up.png are not normal.png with green flipped`);
    assert.ok(report.flipped > 0, 'the normal pass has visible pixels');
    let lit = '';
    if (render) {
      const light = godotReport(godotRun(godot, ['--path', dir, '--rendering-method', 'gl_compatibility', '--audio-driver', 'Dummy', '--resolution', '256x256', '--script', 'res://lightcheck.gd'], { headless: false }));
      const brighter = (halves, a, b) => halves[a] > halves[b] * 1.05;
      const opposite = { above: ['top', 'bottom'], below: ['bottom', 'top'], left: ['left', 'right'], right: ['right', 'left'] };
      for (const [side, [near, far]] of Object.entries(opposite)) {
        assert.ok(brighter(light[`exported ${side}`], near, far), `lit from ${side}, the exported sprite's ${near} half should be brighter: ${JSON.stringify(light[`exported ${side}`])}`);
        // The +Y down pass swaps above and below in Godot, and keeps left and right.
        const [cNear, cFar] = side === 'above' || side === 'below' ? [far, near] : [near, far];
        assert.ok(brighter(light[`control ${side}`], cNear, cFar), `lit from ${side}, the unflipped control's ${cNear} half should be brighter: ${JSON.stringify(light[`control ${side}`])}`);
      }
      lit = ' Lit from above, below, left and right, the half facing the light is brighter, and the unflipped normal pass lights it upside down.';
    }
    log(`${version}: the lit asset's SpriteFrames draws all ${count} frames through canvas_texture.tres (nearest filtering), whose normal map is normal.png with green flipped in all ${report.flipped} visible pixels.${lit}`);
    return { version, report, dir: keep ? dir : null };
  } finally {
    if (!keep) await rm(dir, { recursive: true, force: true });
  }
}
// The JSON a check script printed after PIXELBOLT, once Godot reported no errors.
function godotReport(run) {
  const line = run.output.split('\n').find(text => text.startsWith('PIXELBOLT '));
  assert.ok(line, `Godot printed no report:\n${run.output}`);
  const errors = run.output.split('\n').filter(text => /^\s*(ERROR|SCRIPT ERROR|WARNING)/.test(text));
  assert.deepEqual(errors, [], `Godot reported problems:\n${run.output}`);
  return JSON.parse(line.slice(10));
}

// Pixelbolt's mask bit for each of Godot's peering bits, written out here rather than taken from src/godot.js.
const GODOT_PEERS = {
  blob: { top_side: 1, top_right_corner: 2, right_side: 4, bottom_right_corner: 8, bottom_side: 16, bottom_left_corner: 32, left_side: 64, top_left_corner: 128 },
  cardinal: { top_side: 1, right_side: 2, bottom_side: 4, left_side: 8 }
};

// Loads exported TileSets in a real Godot 4: the terrain, every tile's peering bits, animation frames, durations and
// pixels, then paints GODOT_TILE_MAPS with Godot's terrain painter and checks each cell got the tile whose mask
// Pixelbolt's tilemap gives it.
export async function verifyGodotTiles({ godot = findGodot(), keep = false, log = console.log } = {}) {
  if (!godot) throw new Error('Godot 4 was not found: pass --godot <path> or set GODOT');
  const version = godotRun(godot, ['--version']).output.trim().split('\n')[0];
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pixelbolt-godot-tiles-'));
  try {
    await writeFile(path.join(dir, 'project.godot'), 'config_version=5\n\n[application]\n\nconfig/name="Pixelbolt TileSet check"\n');
    const cases = [], expected = {};
    for (const source of GODOT_TILE_SOURCES) {
      const { recipe } = compileAutotile(source), bundle = await createBundle(recipe), { name, sheet } = bundle.project, folder = `tiles/${name}`;
      assert.ok(bundle.files.has(`${name}.tileset.tres`), `${name}: the export has no ${name}.tileset.tres`);
      for (const [file, bytes] of bundle.files) if (file === `${name}.png` || file === `${name}.tileset.tres` || file.startsWith('frames/')) {
        await mkdir(path.dirname(path.join(dir, folder, file)), { recursive: true });
        await writeFile(path.join(dir, folder, file), bytes);
      }
      const atlas = JSON.parse(bundle.files.get(`${name}.atlas.json`)), size = [recipe.width * sheet.scale, recipe.height * sheet.scale];
      const margin = sheet.padding * sheet.scale, step = size.map(side => side + sheet.padding * 2 * sheet.scale);
      // The sheet cell of every frame, and back.
      const cells = Object.fromEntries(Object.entries(atlas.frames).map(([frame, { frame: rect }]) => [frame, `${(rect.x - margin) / step[0]}:${(rect.y - margin) / step[1]}`]));
      const frameAt = Object.fromEntries(Object.entries(cells).map(([frame, cell]) => [cell, frame]));
      cases.push({ key: name, tres: `res://${folder}/${name}.tileset.tres`, files: Object.fromEntries(Object.entries(frameAt).map(([cell, frame]) => [cell, `res://${folder}/frames/${frame}.png`])), maps: GODOT_TILE_MAPS });
      const masks = Object.fromEntries(recipe.frames.map(frame => [frame.name, frame.ops[0].mask]));
      expected[name] = { mode: source.mode ?? 'blob', atlas, recipe, size, margin, step, cells, frameAt, masks, warnings: bundle.project.warnings };
    }
    await writeFile(path.join(dir, 'tilecases.json'), JSON.stringify(cases));
    await writeFile(path.join(dir, 'tilecheck.gd'), TILE_CHECK);
    const imported = godotRun(godot, ['--path', dir, '--import']);
    const problems = imported.output.split('\n').filter(line => /ERROR|WARNING/.test(line) && /tiles\//.test(line));
    assert.deepEqual(problems, [], `Godot reported problems while importing:\n${imported.output}`);
    const checked = godotRun(godot, ['--path', dir, '--script', 'res://tilecheck.gd']);
    const line = checked.output.split('\n').find(text => text.startsWith('PIXELBOLT '));
    assert.ok(line, `Godot printed no report:\n${checked.output}`);
    const errors = checked.output.split('\n').filter(text => /^\s*(ERROR|SCRIPT ERROR|WARNING)/.test(text));
    assert.deepEqual(errors, [], `Godot reported problems:\n${checked.output}`);
    const report = JSON.parse(line.slice(10));
    let tiles = 0, frames = 0, painted = 0;
    const differ = [];
    for (const [name, want] of Object.entries(expected)) {
      const got = report[name];
      assert.ok(got && !got.error, `${name}: ${got?.error ?? 'missing from the report'}`);
      assert.equal(got.mode, want.mode === 'cardinal' ? 2 : 0, `${name}: terrain mode`);
      assert.equal(got.terrain, name, `${name}: terrain name`);
      assert.deepEqual(got.tile_size, want.size, `${name}: tile size`);
      assert.deepEqual(got.region_size, want.size, `${name}: texture region size`);
      assert.deepEqual(got.margins, [want.margin, want.margin], `${name}: margins`);
      assert.deepEqual(got.separation, [want.step[0] - want.size[0], want.step[1] - want.size[1]], `${name}: separation`);
      assert.equal(got.texture, `res://tiles/${name}/${name}.png`, `${name}: the sheet beside the .tres`);
      // One tile per frame, except that an animation over one mask's frames is one animated tile.
      const animations = Object.values(want.atlas.animations).filter(a => a.frames.length > 1 && new Set(a.frames.map(f => want.masks[f])).size === 1);
      const later = new Set(animations.flatMap(a => a.frames.slice(1))), firsts = new Map(animations.map(a => [a.frames[0], a.frames]));
      const expectedTiles = Object.keys(want.atlas.frames).filter(frame => !later.has(frame));
      assert.deepEqual(got.tiles.map(tile => want.frameAt[tile.at.join(':')]).sort(), [...expectedTiles].sort(), `${name}: tiles`);
      for (const tile of got.tiles) {
        // Compiled masks are already reduced.
        const frame = want.frameAt[tile.at.join(':')], where = `${name} ${frame}`, mask = want.masks[frame];
        assert.equal(tile.alternatives, 1, `${where}: alternatives`);
        assert.equal(tile.terrain_set, 0, `${where}: terrain set`);
        assert.equal(tile.terrain, 0, `${where}: terrain`);
        assert.equal(tile.probability, 1, `${where}: probability`);
        const bits = Object.fromEntries(Object.entries(GODOT_PEERS[want.mode]).filter(([, bit]) => mask & bit).map(([peer]) => [peer, 0]));
        assert.deepEqual(tile.bits, bits, `${where}: peering bits for mask ${mask}`);
        const sequence = firsts.get(frame) ?? [frame];
        assert.equal(tile.frames.length, sequence.length, `${where}: animation frames`);
        tile.frames.forEach((played, i) => {
          const source = want.atlas.frames[sequence[i]], { x, y, w, h } = source.frame;
          assert.deepEqual(played.region, [x, y, w, h], `${where}[${i}]: region`);
          assert.equal(played.mismatched, 0, `${where}[${i}]: ${played.mismatched} pixels differ from frames/${sequence[i]}.png (-1: no image, -2: size, -3: no frame there)`);
          if (sequence.length > 1) assert.ok(Math.abs(played.duration * 1000 - source.duration) < 1e-3, `${where}[${i}]: ${played.duration * 1000} ms, not ${source.duration}`);
          frames++;
        });
        tiles++;
      }
      // Godot's terrain painter against Pixelbolt's tilemap masks, empty outside the map.
      GODOT_TILE_MAPS.forEach((rows, m) => {
        const filled = (x, y) => rows[y]?.[x] === '#';
        rows.forEach((row, y) => [...row].forEach((char, x) => {
          if (char !== '#') return;
          const pixelbolt = neighbourMask(want.mode, (dx, dy) => filled(x + dx, y + dy)), cell = got.painted[m][`${x},${y}`];
          const mask = cell === undefined ? null : want.masks[want.frameAt[cell]];
          if (mask !== pixelbolt) differ.push(`${name} map ${m} cell ${x},${y}: Godot drew ${cell === undefined ? 'nothing' : `mask ${mask}`}, Pixelbolt mask ${pixelbolt}`);
          painted++;
        }));
        assert.equal(Object.keys(got.painted[m]).length, rows.join('').split('#').length - 1, `${name} map ${m}: Godot painted cells outside the map's own`);
      });
    }
    assert.deepEqual(differ.slice(0, 20), [], `Godot's terrain painter chose other tiles than Pixelbolt's masks in ${differ.length} cells`);
    log(`${version}: ${Object.keys(expected).length} TileSets loaded; ${tiles} tiles match their peering bits, regions and ${frames} frames of pixels and timing; Godot's terrain painter chose Pixelbolt's tile in all ${painted} painted cells.`);
    return { version, report, expected, dir: keep ? dir : null };
  } finally {
    if (!keep) await rm(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), at = args.indexOf('--godot');
  try {
    for (const verify of [verifyGodot, verifyGodotTiles, verifyGodotLit]) {
      const result = await verify({ ...(at >= 0 && { godot: args[at + 1] }), keep: args.includes('--keep'), render: args.includes('--render') });
      if (result.dir) console.log(`Kept the Godot project at ${result.dir}`);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
