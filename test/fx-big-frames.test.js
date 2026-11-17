import test from 'node:test';
import assert from 'node:assert/strict';
import { compileEffects } from '../src/fx.js';
import { renderProject } from '../src/core.js';
import { keepFrames } from '../src/resize.js';
import { compilePreset } from '../src/presets.js';

// An effect's canvas is an animation frame: at most 1024 a side and 262,144 pixels, so a full-screen overlay at 320x180
// or 640x360 is one effect, with every frame of it held to the 4,194,304 pixels a recipe's frames share.
const refused = (source, path, message) => assert.throws(() => compileEffects(source), error => {
  assert.equal(error.name, 'PixelError');
  assert.equal(error.path, path);
  if (message instanceof RegExp) assert.match(error.message, message); else assert.equal(error.message, `${path}: ${message}`);
  return true;
});
// Slanted streaks falling from above the screen, each splashing where it ends: a seamless rain loop.
const rain = (width = 320, height = 180, frames = 16, rate = 7 * width / 320, life = [16, 21]) => ({ format: 'pixelforge-fx', version: 1, name: 'rain', width, height,
  palette: { d: '#9fb8d8', l: '#5d7397', s: '#cfe0f4' },
  symbols: { drop: ['d'], splash: ['s'] },
  effects: { rain: { frames, duration: 60, loop: true, seed: 7, edges: ['top', 'left', 'right'], emitters: [
    { name: 'drop', at: [width / 2 - 10, -8], area: [width + 80, 1], rate, angle: [100, 102], speed: [8, 9], life, shapes: ['drop'], trail: { color: 'l', length: 2 } },
    { from: 'drop', when: 'death', burst: 2, angle: [200, 340], speed: [0.5, 1.2], gravity: [0, 0.3], life: [2, 3], shapes: ['splash'] }] } } });

test('a 320x180 rain overlay is one effect: slanted streaks, splashes and a seamless loop', () => {
  // Drops that live at most the loop's 16 frames: each is drawn once at a time.
  const { recipe, metadata, warnings } = compileEffects(rain(320, 180, 16, 7, [12, 16]));
  assert.deepEqual([recipe.width, recipe.height, recipe.frames.length], [320, 180, 16]);
  assert.equal(warnings, undefined);
  assert.equal(metadata.effects.rain.seam.jump, 0, 'the loop has no seam');
  const ops = recipe.frames.flatMap(frame => frame.ops);
  // Streaks lean the way the drops fall (down and a little left) and reach past the old 256-pixel side.
  const streaks = ops.filter(op => op.op === 'line');
  assert.ok(streaks.length > 100 && streaks.every(op => op.y2 > op.y && op.x2 <= op.x) && streaks.some(op => op.x2 < op.x));
  assert.ok(ops.some(op => op.op === 'stamp' && op.symbol === 'drop' && op.x > 256), 'drops fall across the full width');
  assert.ok(ops.some(op => op.op === 'stamp' && op.symbol === 'splash'), 'drops splash where they end');
  const project = renderProject(recipe);
  assert.deepEqual([project.width, project.height, project.frames.length], [320, 180, 16]);
});

test('a 640x360 effect compiles, and a full-width grid (a stream and its shine) renders past 256 columns', () => {
  const { recipe } = compileEffects(rain(640, 360, 8));
  assert.deepEqual([recipe.width, recipe.height, recipe.frames.length], [640, 360, 8]);
  const bright = { format: 'pixelforge-fx', version: 1, name: 'beam', width: 320, height: 180, palette: { W: '#ffffff', g: '#3a4a6a', h: '#8aa0c8' },
    effects: { beam: { frames: 2, looks: { hot: { colors: ['W'], thresholds: [0.2] } }, layers: [{ kind: 'stream', look: 'hot', at: [0, 90], through: [[319, 90]], width: 6 }],
      shine: { keys: { W: 1 }, reach: 12, thresholds: [0.3, 0.7], wall: ['g', 'h'] } } } };
  const lit = compileEffects(bright).recipe, grids = lit.frames[0].ops.filter(op => op.op === 'grid');
  assert.ok(grids.some(op => op.rows[0].length > 256), `grid widths ${grids.map(op => op.rows[0].length)}`);
  assert.equal(renderProject(lit).width, 320);
});

test('an effect follows the animation frame: 1024 a side, 262,144 pixels, and the frames that fit', () => {
  const source = (width, height, frames = 2) => ({ ...rain(width, height, frames), effects: { dot: { frames, emitters: [{ at: [4, 4], burst: 1, shapes: ['drop'] }] } } });
  assert.equal(compileEffects(source(1024, 256)).recipe.width, 1024);
  assert.equal(compileEffects(source(512, 512)).recipe.height, 512);
  refused(source(1025, 64), 'fx.width', /expected .*1 to 1024/);
  refused(source(1024, 512), 'fx', 'a 1024×512 frame is 524,288 pixels; an animation frame is at most 1024 pixels a side and 262,144 in all (320×180, 480×270, 640×360 and 512×512 fit), and an effect\'s canvas is one: draw it smaller or enlarge a smaller canvas with sheet.scale');
  // The total is checked before anything is simulated, and says how many frames of this size fit.
  refused(source(320, 180, 73), 'fx.effects', "the effects make 73 frames: 73 frames of 320×180 are 4,204,800 pixels; a recipe's frames hold at most 4,194,304 in all, so 72 frames of 320×180 fit: use fewer frames or a smaller canvas; or compile with frames 72 (pixelbolt compile --frames 72): it keeps that many of each animation's, evenly spaced, without cutting the effect short");
  assert.equal(compileEffects(source(320, 180, 72)).recipe.frames.length, 72);
});

test('spawn boxes, rings and grounds reach across a big canvas; a particle symbol stays at most 256', () => {
  const emitting = emitter => ({ ...rain(640, 360, 2), effects: { e: { frames: 2, emitters: [{ at: [320, 180], burst: 4, shapes: ['drop'], ...emitter }] } } });
  assert.ok(compileEffects(emitting({ area: [2048, 1] })));
  refused(emitting({ area: [2049, 1] }), 'fx.effects.e.emitters[0].area', 'expected a spawn box from 1 to 2048 pixels per side');
  assert.ok(compileEffects(emitting({ area: undefined, ring: { radius: 1024 } })));
  refused(emitting({ ring: { radius: 1025 }, area: undefined }), 'fx.effects.e.emitters[0].ring.radius', /1024/);
  assert.ok(compileEffects(emitting({ ground: 1024, gravity: [0, 1] })));
  refused(emitting({ ground: -1025 }), 'fx.effects.e.emitters[0].ground', /-1024 to 1024/);
  const wide = { ...rain(), symbols: { drop: ['d'.repeat(257)] } };
  refused(wide, 'fx.symbols.drop', 'its rows are 257 characters; a particle\'s symbol is at most 256 a side (a sprite taken from a recipe may span the canvas)');
  // A sprite taken from a recipe spans that recipe's canvas, so it follows the frame; a larger still is refused.
  const still = (width, height) => ({ version: 1, name: 'still', width, height, palette: { d: '#9fb8d8' }, frames: [{ name: 'f', ops: [{ op: 'pixel', x: 1, y: 1, color: 'd' }] }] });
  assert.ok(compileEffects({ ...rain(), symbols: { drop: ['d'], splash: ['s'], screen: { recipe: still(320, 180) } } }));
  refused({ ...rain(), symbols: { drop: ['d'], splash: ['s'], screen: { recipe: still(1024, 512) } } }, 'fx.symbols.screen.recipe', 'a 1024×512 frame is 524,288 pixels; an animation frame is at most 1024 pixels a side and 262,144 in all (320×180, 480×270, 640×360 and 512×512 fit), and a symbol or sprite taken from a recipe spans that recipe\'s canvas, so it is held to one');
});

test('an effect drawn behind a character makes three frames for each of its own, and the reply says how many of its own fit', () => {
  // 512x512: 16 frames fit in all. A plain effect of 4 frames leaves 12, so one drawn behind a character (its frames,
  // its -back and its -front) may have 4 of its own.
  const dot = (frames, depth) => ({ frames, emitters: [{ at: [4, 4], burst: 1, shapes: ['drop'], ...(depth && { depth }) }] });
  const source = frames => ({ ...rain(512, 512), effects: { plain: dot(4), behind: dot(frames, 'back') } });
  const { recipe } = compileEffects(source(4));
  assert.deepEqual([recipe.frames.length, Object.keys(recipe.animations)], [16, ['plain', 'behind', 'behind-back', 'behind-front']]);
  refused(source(5), 'fx.effects', "the effects make 19 frames: 19 frames of 512×512 are 4,980,736 pixels; a recipe's frames hold at most 4,194,304 in all, so 16 frames of 512×512 fit: use fewer frames or a smaller canvas; behind draws behind a character, so each frame of its own makes 3 of the recipe's, and 4 of its own fit; or compile with frames 4 (pixelbolt compile --frames 4): it keeps that many of each animation's, evenly spaced, without cutting the effect short");
  // The effect is known to draw behind before its frames are counted, so even when its own frames alone are too many,
  // the first refusal counts all three parts and says how many fit: following it compiles.
  refused(source(13), 'fx.effects', /^fx\.effects: the effects make 43 frames: .*16 frames of 512×512 fit: use fewer frames or a smaller canvas; behind draws behind a character, so each frame of its own makes 3 of the recipe's, and 4 of its own fit; or compile with frames 4 /);
  // A layer drawn behind counts the same as an emitter.
  const ring = frames => ({ frames, looks: { hot: { colors: ['s'], thresholds: [0.2] } }, layers: [{ kind: 'ring', look: 'hot', at: [256, 256], radius: [4, 20], depth: 'split' }] });
  refused({ ...rain(512, 512), effects: { plain: dot(4), behind: ring(13) } }, 'fx.effects', /; behind draws behind a character, so each frame of its own makes 3 of the recipe's, and 4 of its own fit; or compile with frames 4 /);
  assert.equal(compileEffects({ ...rain(512, 512), effects: { plain: dot(4), behind: ring(4) } }).recipe.frames.length, 16);
  // With no room left, it says so.
  refused({ ...rain(512, 512), effects: { plain: dot(15), behind: dot(1, 'back') } }, 'fx.effects', /: use fewer frames or a smaller canvas; behind draws behind a character, so each frame of its own makes 3 of the recipe's, and not one of its own fits; or compile with frames 13 /);
  // An effect that draws nothing behind keeps the plain total, and its reply says nothing of -back and -front parts;
  // when one counted before it does draw behind, the reply says what that adds.
  refused({ ...rain(512, 512), effects: { plain: dot(4), more: dot(13) } }, 'fx.effects', /^fx\.effects: the effects make 17 frames: 17 frames of 512×512 are 4,456,448 pixels; .*16 frames of 512×512 fit: use fewer frames or a smaller canvas; or compile with frames 12 /);
  refused({ ...rain(512, 512), effects: { behind: dot(2, 'back'), more: dot(11) } }, 'fx.effects', /^fx\.effects: the effects make 17 frames \(an effect drawn behind a character also makes its -back and -front parts\): 17 frames of 512×512 /);
});

test('a turned effect counts every copy, and the reply names the effect as written and how many of its own frames fit', () => {
  // 512x512: 16 frames fit. Four turned copies drawn behind a character make 12 frames for each of the effect's own.
  const slash = (frames, depth) => ({ ...rain(512, 512), effects: { slash: { frames, turn: { angles: [0, 90, 180, 270] }, emitters: [{ at: [256, 256], burst: 1, shapes: ['drop'], ...(depth && { depth }) }] } } });
  // Only frames 1 fits (12 of the 16), and the reply names it: before, it named none.
  refused(slash(3, 'back'), 'fx.effects', /^fx\.effects: the effects make 36 frames: .*16 frames of 512×512 fit: use fewer frames or a smaller canvas; slash makes 4 turned copies and draws behind a character, so each frame of its own makes 12 of the recipe's, and 1 of its own fits; or compile with frames 1 \(pixelbolt compile --frames 1\)/);
  assert.equal(kept(slash(3, 'back'), 1).frames, 12);
  const { recipe } = compileEffects(slash(1, 'back'));
  assert.equal(recipe.frames.length, 12);
  // Turned only: each frame of its own makes 4.
  refused(slash(5), 'fx.effects', /; slash makes 4 turned copies, so each frame of its own makes 4 of the recipe's, and 4 of its own fit; or compile with frames 4 /);
  assert.equal(compileEffects(slash(4)).recipe.frames.length, 16);
});

test('the 256-frame cap says the same: what the effects make, and how many frames of an effect drawn behind fit', () => {
  // 64x64: the area holds 1,024 frames, so the recipe's 256 is the limit. 100 plain frames leave 156, so 52 of an effect
  // drawn behind a character.
  const dot = (frames, depth) => ({ frames, emitters: [{ at: [4, 4], burst: 1, shapes: ['drop'], ...(depth && { depth }) }] });
  const source = frames => ({ ...rain(64, 64), effects: { plain: dot(100), behind: dot(frames, 'back') } });
  refused(source(60), 'fx.effects', "the effects make 280 frames; a recipe holds at most 256; behind draws behind a character, so each frame of its own makes 3 of the recipe's, and 52 of its own fit");
  assert.equal(compileEffects(source(52)).recipe.frames.length, 256);
  // An effect that makes one of the recipe's frames for each of its own is told its room too, which compiles.
  refused({ ...rain(64, 64), effects: { plain: dot(200), more: dot(57) } }, 'fx.effects', 'the effects make 257 frames; a recipe holds at most 256; more: 56 of its own frames fit beside the others');
  assert.equal(compileEffects({ ...rain(64, 64), effects: { plain: dot(200), more: dot(56) } }).recipe.frames.length, 256);
});

test('a particle shape stays at most 256 a side: a canvas-sized sprite from a recipe belongs to a sprite emitter or an aura', () => {
  const still = (width, height) => ({ version: 1, name: 'still', width, height, palette: { d: '#9fb8d8' }, frames: [{ name: 'f', ops: [{ op: 'rect', x: 0, y: 0, w: width, h: height, color: 'd' }] }] });
  const emitting = (screen, emitter) => ({ ...rain(640, 360, 2), symbols: { drop: ['d'], splash: ['s'], screen: { recipe: screen } }, effects: { e: { frames: 2, emitters: [{ at: [320, 180], burst: 2, ...emitter }] } } });
  // As a particle's shape, a 320x180 frame would be stamped (and cropped at the canvas edge) for every particle.
  refused(emitting(still(320, 180), { shapes: ['drop', 'screen'] }), 'fx.effects.e.emitters[0].shapes[1]', 'screen is 320×180; a particle\'s symbol is at most 256 a side, since every particle stamps it, so a sprite as large as the canvas belongs to a sprite emitter or an aura');
  refused(emitting(still(257, 8), { shapes: [['drop'], ['screen']], spin: 30 }), 'fx.effects.e.emitters[0].shapes[1][0]', /^fx\.effects\.e\.emitters\[0\]\.shapes\[1\]\[0\]: screen is 257×8; a particle's symbol is at most 256 a side/);
  // At 256 a side it is still a shape, and as a sprite emitter's sprite the whole frame is fine.
  assert.ok(compileEffects(emitting(still(256, 16), { shapes: ['screen'] })).recipe.frames.length);
  assert.ok(compileEffects(emitting(still(320, 180), { at: [0, 0], sprite: { symbol: 'screen' }, burst: 4, life: 2 })).recipe.frames.length);
});

// A refusal's message matched against a pattern, returning the match for the route it names.
const refusal = (run, pattern) => {
  let match = null;
  assert.throws(run, error => { assert.equal(error.name, 'PixelError'); match = error.message.match(pattern); assert.ok(match, error.message); return true; });
  return match;
};
// What compile --frames delivers, thinned the way the CLI and MCP thin it.
const kept = (source, frames) => {
  const thinned = keepFrames(compilePreset(source, { frames }).recipe, frames);
  return { kept: thinned.kept, frames: renderProject(thinned.recipe).frames.length };
};

test('compile --frames holds the 20,000 drawing operations to the frames it keeps: 72 frames of a 320x180 rain', () => {
  // 73 frames of 320x180 are past the recipe's pixels. Frames 72 would thin the 73-frame loop unevenly (the compile
  // warns), so the refusal names a loop of 72 frames, which thins nothing and compiles clean.
  refused(rain(320, 180, 73, 6), 'fx.effects', /; or give the loop 72 frames$/);
  assert.equal(compileEffects(rain(320, 180, 72, 6)).warnings, undefined);
  // Before, the operations of every frame simulated were counted, so frames 72 was refused ("needs about 24,004 drawing
  // operations (250 a frame) and makes at most 20000, so about 79 frames fit") and no frames value led anywhere.
  assert.deepEqual(kept(rain(320, 180, 73, 6), 72), { kept: { rain: '72 of 73' }, frames: 72 });
  assert.deepEqual(kept(rain(320, 180, 96, 6), 72), { kept: { rain: '72 of 96' }, frames: 72 });
  // Within the 72 frames a recipe holds too, the operations are counted over the frames kept. Before: "the effect needs
  // about 20,251 drawing operations (289 a frame) and makes at most 20000, so about 69 frames fit at this density".
  assert.deepEqual(kept(rain(320, 180, 70), 64), { kept: { rain: '64 of 70' }, frames: 64 });
});

test('with frames, what every effect simulates and what the recipe delivers each hold a limit, and each refusal names what fits', () => {
  // The frames kept hold 20,000 operations: a denser rain is told how many frames it may keep, and that compiles.
  // Before: "frames 0–60 need about 20,306 drawing operations (333 a frame); every 72 frames of 320×180 in a row are
  // drawn together before frames 72 thins them", since 72 frames in a row were rendered at once.
  const dense = refusal(() => compileEffects(rain(320, 180, 96, 8), { frames: 72 }), /^fx\.effects\.rain: the 72 frames kept with frames 72 need about [\d,]+ drawing operations \(\d+ a frame\) and a recipe makes at most 20,000, so frames (\d+) fits \(pixelbolt compile --frames \1\), or lower burst, rate or trail$/);
  assert.deepEqual(kept(rain(320, 180, 96, 8), Number(dense[1])), { kept: { rain: `${dense[1]} of 96` }, frames: Number(dense[1]) });
  // Every frame is simulated, kept or not, up to 80,000 operations: 600 snowflakes standing still for 256 frames of
  // 640x360 are 153,600; 18 kept are 10,800.
  const snow = frames => ({ ...rain(640, 360), symbols: { flake: ['s'] }, effects: { snow: { frames, residue: true, emitters: [{ at: [320, 180], area: [640, 360], burst: 600, speed: 0, life: 256, shapes: ['flake'] }] } } });
  const long = refusal(() => compileEffects(snow(256), { frames: 18 }), /^fx\.effects\.snow: the effect simulates all 256 of its frames, kept or not, and needs about 153,600 drawing operations \(600 a frame\) of the 80,000 a compile may simulate: lower burst, rate or trail, or the effect's frames \((\d+) fit\)$/);
  assert.deepEqual(kept(snow(Number(long[1])), 18), { kept: { snow: `18 of ${long[1]}` }, frames: 18 });
  // The frames kept hold 20,000 too. 1024x256 holds 16 frames, and frames 16 keeps every 4th of 64: here the frames
  // where 80 streaks cross the right edge in 1,920 pixels.
  const streaks = { format: 'pixelforge-fx', version: 1, name: 'streaks', width: 1024, height: 256, palette: { d: '#9fb8d8', l: '#5d7397' }, symbols: { drop: ['d'] },
    effects: { streaks: { frames: 64, loop: true, edges: ['right'], emitters: Array.from({ length: 16 }, (_, k) => ({ at: [1000, 16 * k + 8], burst: 80, start: (4 * k + 62) % 64, angle: 0, speed: 20, life: 5, shapes: ['drop'], trail: { color: 'l', length: 2 } })) } } };
  // Before: "the effect needs about 42,202 drawing operations (659 a frame) and makes at most 20000, so about 30 frames
  // fit at this density: lower burst, rate or trail, or frames", though no frames value under 16 would hold 30.
  refused(streaks, 'fx.effects', /; or compile with frames 16 /);
  assert.throws(() => compileEffects(streaks, { frames: 16 }), { message: 'fx.effects.streaks: the 16 frames kept with frames 16 need about 30,720 drawing operations (1920 a frame) and a recipe makes at most 20,000, so frames 8 fits (pixelbolt compile --frames 8), or lower burst, rate or trail' });
  // 15 fits as well, but would thin the 64-frame loop unevenly: 8 is the most that fits and divides it.
  assert.deepEqual(kept(streaks, 8), { kept: { streaks: '8 of 64' }, frames: 8 });
  assert.equal(compileEffects(streaks, { frames: 8 }).warnings, undefined);
});

test('the frames a compile may keep are worked out from every effect, those after the one refused too', () => {
  // 512x512 holds 16 frames. The first effect's 20 are refused; the second's 10 need room as well, so 8 of each fit.
  const dot = (frames, depth) => ({ frames, emitters: [{ at: [4, 4], burst: 1, shapes: ['drop'], ...(depth && { depth }) }] });
  const source = second => ({ ...rain(512, 512), effects: { first: dot(20), second } });
  // Before: "or compile with frames 16", which then refused the second effect.
  refused(source(dot(10)), 'fx.effects', /: use fewer frames or a smaller canvas; or compile with frames 8 \(pixelbolt compile --frames 8\)/);
  assert.equal(kept(source(dot(10)), 8).frames, 16);
  // One drawn behind a character makes three of the recipe's frames for each of its own: 4 of each fit (4 + 12).
  refused(source(dot(10, 'back')), 'fx.effects', /; or compile with frames 4 \(pixelbolt compile --frames 4\)/);
  assert.equal(kept(source(dot(10, 'back')), 4).frames, 16);
  // With frames already given, the reply says which fits.
  assert.throws(() => compileEffects(source(dot(10, 'back')), { frames: 5 }), /; frames 4 fits$/);
});

test('past the particles alive at once, a release is blamed only when it holds most of them', () => {
  const source = burst => ({ ...rain(64, 64), symbols: { drop: ['d'], bar: Array(10).fill('dddddddddd') },
    effects: { e: { frames: 4, emitters: [{ at: [32, 32], burst, life: 4, shapes: ['drop'] }, { at: [2, 2], sprite: { symbol: 'bar' }, release: {}, angle: 0, speed: 1, life: 2 }] } } });
  // Before: the release whose particle crossed 1,024 was told to lower its share or use a smaller sprite, though the
  // burst held 1,000 of them. The reply says how many are alive at the peak, and whose.
  refused(source(1000), 'fx.effects.e', 'more than 1024 particles are alive at once (about 1,052: emitters[0] 1,000, emitters[1] 52); lower burst, rate or life (release.share or life for emitters[1])');
  assert.equal(compileEffects(source(900)).recipe.frames.length, 4);
});
