// Godot 4 SpriteFrames resources in Godot's text format (.tres), made from a Pixelbolt atlas. Browser-compatible: no
// imports, and the same atlas always gives the same bytes.
//
// One AtlasTexture per frame cuts the frame's rectangle out of the sheet. A trimmed frame also gets a margin that puts
// its visible pixels back where they sat on the canvas, so every frame keeps the canvas size and the same origin.
// The sheet is named by a path relative to the .tres, which Godot resolves from the .tres's own folder.

// The SpriteFrames editor shows speeds from 0 to 120 FPS (it would show a faster animation as 120).
export const GODOT_MAX_FPS = 120;

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// Godot plays a frame for duration ÷ speed seconds, with one speed per animation, and keeps each duration as a 32-bit
// float. The speed is 1000 ÷ the largest step that divides every frame's milliseconds, so every duration is a whole
// number of steps: 100, 100, 200 ms play at 10 FPS for 1, 1 and 2; 240, 140, 220 ms at 50 FPS for 12, 7 and 11. When
// that step is under 9 ms (more than 120 FPS), the shortest frame sets the speed instead, at most 120 FPS, and the
// others last a fraction of it: 33, 34 ms play at 30.3 FPS for 1 and 1.0303…. `exact` is false when such a fraction
// isn't a 32-bit float; Godot then plays the frame within a ten-millionth of its length.
export function godotTiming(durations) {
  const step = durations.reduce(gcd);
  if (1000 / step <= GODOT_MAX_FPS) return { speed: 1000 / step, durations: durations.map(ms => ms / step), exact: true };
  const shortest = Math.min(...durations), fits = 1000 / shortest <= GODOT_MAX_FPS;
  const relative = durations.map(ms => (fits ? ms / shortest : ms * GODOT_MAX_FPS / 1000));
  const exact = relative.every((value, i) => Math.fround(value) === value && (fits ? value * shortest : value * 1000 / GODOT_MAX_FPS) === durations[i]);
  return { speed: fits ? 1000 / shortest : GODOT_MAX_FPS, durations: relative, exact };
}

// Godot writes a float with a decimal point (1.0), and Rect2 components without one.
const real = value => (Number.isInteger(value) ? value.toFixed(1) : String(value));
const quote = text => `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;

// `atlas` is Pixelbolt atlas metadata ({ frames, animations, meta }); `image` is the sheet's path relative to the
// .tres (default: meta.image, the sheet beside it). Animations keep the atlas's order, so the first one is the one an
// AnimatedSprite2D shows when the resource is assigned. Returns the text and the animations whose durations are not
// exact (see godotTiming).
export function spriteFrames(atlas, { image = atlas.meta.image } = {}) {
  const animations = Object.entries(atlas.animations), approximate = [];
  // Only frames an animation plays become textures, in recipe order.
  const used = new Set(animations.flatMap(([, animation]) => animation.frames));
  const names = Object.keys(atlas.frames).filter(name => used.has(name));
  const id = name => `AtlasTexture_${name}`;
  // Laid out as Godot 4.5 and later save it (no load_steps; earlier 4.x versions read it the same).
  const lines = ['[gd_resource type="SpriteFrames" format=3]', '', `[ext_resource type="Texture2D" path=${quote(image)} id="1_sheet"]`, ''];
  for (const name of names) {
    const { frame, spriteSourceSize: offset, sourceSize } = atlas.frames[name];
    lines.push(`[sub_resource type="AtlasTexture" id=${quote(id(name))}]`, 'atlas = ExtResource("1_sheet")', `region = Rect2(${frame.x}, ${frame.y}, ${frame.w}, ${frame.h})`);
    // margin.position offsets the drawn rectangle and margin.size adds to the texture's size, so a trimmed frame
    // draws at its canvas position inside a texture the size of the whole canvas.
    const margin = [offset.x, offset.y, sourceSize.w - offset.w, sourceSize.h - offset.h];
    if (margin.some(Boolean)) lines.push(`margin = Rect2(${margin.join(', ')})`);
    // Keeps a filtered or scaled frame from sampling its neighbours in the sheet.
    lines.push('filter_clip = true', '');
  }
  const entries = animations.map(([key, animation]) => {
    const timing = godotTiming(animation.frames.map(name => atlas.frames[name].duration));
    if (!timing.exact) approximate.push(key);
    const frames = animation.frames.map((name, index) => `{\n"duration": ${real(timing.durations[index])},\n"texture": SubResource(${quote(id(name))})\n}`);
    return `{\n"frames": [${frames.join(', ')}],\n"loop": ${animation.loop ? 'true' : 'false'},\n"name": &${quote(key)},\n"speed": ${real(timing.speed)}\n}`;
  });
  lines.push('[resource]', `animations = [${entries.join(', ')}]`, '');
  return { text: lines.join('\n'), approximate };
}
