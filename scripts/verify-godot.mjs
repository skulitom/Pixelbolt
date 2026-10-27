// Loads exported SpriteFrames (.tres) in a real Godot 4 and checks them against the atlas: every animation's frames,
// regions and trim margins, each frame's pixels as Godot composes them, loop flags, and playback timing, by playing
// each animation on an AnimatedSprite2D at a fixed 1000 frames per second, so every process step is 1 ms.
// Independent developer check: Pixelbolt never needs Godot.
//   node scripts/verify-godot.mjs [--godot <path to the Godot 4 executable>] [--keep]
// Without --godot it uses $GODOT, then godot4 or godot on PATH, then a winget install of GodotEngine.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createBundle } from '../src/export.js';

// A trimmed, scaled, padded sheet with unequal frame times: a 1×1 cell for an empty frame, a half-transparent frame, a
// frame that fills the canvas, a 5 ms flash (Godot's 120 FPS ceiling), 33 and 34 ms frames (fractional durations),
// reverse and ping-pong runs, and a sequence with a hold, which has no Aseprite tag.
export const GODOT_FIXTURE = {
  version: 1, name: 'godot-trim', width: 12, height: 10,
  palette: { r: '#e04040', g: '#40c060', b: '#4060e0', y: '#f0d040', h: '#4060e080' },
  frames: [
    { name: 'dot', duration: 100, ops: [{ op: 'rect', x: 1, y: 2, w: 2, h: 3, color: 'r' }] },
    { name: 'bar', duration: 150, ops: [{ op: 'rect', x: 5, y: 7, w: 6, h: 2, color: 'g' }, { op: 'pixel', x: 11, y: 9, color: 'y' }] },
    { name: 'gap', duration: 250 },
    { name: 'half', duration: 33, ops: [{ op: 'rect', x: 3, y: 0, w: 4, h: 10, color: 'h' }] },
    { name: 'full', duration: 34, ops: [{ op: 'rect', x: 0, y: 0, w: 12, h: 10, color: 'b' }] },
    { name: 'flash', duration: 5, ops: [{ op: 'pixel', x: 6, y: 5, color: 'y' }] }
  ],
  animations: {
    walk: { frames: ['dot', 'bar', 'gap'] },
    flicker: { frames: ['half', 'full'] },
    strobe: { frames: ['flash', 'dot'], loop: false },
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

const godotRun = (godot, args) => {
  const result = spawnSync(godot, ['--headless', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300_000 });
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
        assert.ok(!stale.length || !fixed.length, [`${where}: playback matches neither Godot 4.6's AnimatedSprite2D nor the fixed one:`, ...stale.slice(0, 4), ...fixed.slice(0, 4)].join('\n'));
        behaviour.add(stale.length ? 'fixed' : 'stale');
        // How far that is from the recipe: Godot 4.6's carried-over speed moves a frame change after a shorter frame.
        const ideal = idealEvents(animation.frames.map(name => atlas.frames[name].duration), animation.loop, steps, time);
        const shift = Math.max(0, ...ideal.map(([step], i) => (events[i] ? Math.abs(steps.slice(0, events[i][0] + 1).reduce((sum, ms) => sum + ms, 0) - steps.slice(0, step + 1).reduce((sum, ms) => sum + ms, 0)) : 0)));
        if (shift > 1.5) shifted.push(`${where} ${Math.round(shift)} ms`);
        changes += events.length;
      }
    }
    log(`${version}: ${Object.keys(expected).length} SpriteFrames loaded; ${frames} frames match their regions, margins, sizes, pixels and times; ${changes} playback events match a replay of AnimatedSprite2D${behaviour.has('stale') ? " as Godot 4.6 runs it (the rest of a step after a frame change at the previous frame's speed, godotengine/godot#123572)" : ' with each frame at its own speed'}.`);
    if (shifted.length) log(`AnimatedSprite2D moves frame changes away from the recipe's times in ${shifted.join(', ')} (1 ms process steps); the SpriteFrames' times are exact.`);
    return { version, report, expected, behaviour: [...behaviour], shifted, dir: keep ? dir : null };
  } finally {
    if (!keep) await rm(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), at = args.indexOf('--godot');
  try {
    const result = await verifyGodot({ ...(at >= 0 && { godot: args[at + 1] }), keep: args.includes('--keep') });
    if (result.dir) console.log(`Kept the Godot project at ${result.dir}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
