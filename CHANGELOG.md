# Changelog

Releases before 0.9.0 are described on [GitHub Releases](https://github.com/skulitom/Pixelbolt/releases).

## Unreleased

### Variants and collision for terrain transitions

- A layer of a layered autotile set takes `variants` of its plain tile, the one with it at all four corners, which fills big areas: another fill (`terrain` merged into the layer's) or decoration (`ops` drawn over the tile in tile pixels), weighed against the layer's `weight` for the plain tile. They come after the other tiles, named after the plain tile with `-<name>` (`shore-wwww-lily`), each kept in a template of its own (`template-water-lily`). Ops that change the tile's border are warned about.
- A layer takes `collision` (`true`, or `{ inset, oneWay }`): every tile is solid where that terrain shows, from where its edges start, less the corners of the terrains drawn over it from where theirs start. Solid water ends where the sand starts; two solid terrains give one shape where they touch.
- Scene and recipe tilemap legends may list a layered tile with its variants (`frames: ["shore-{corners}", "shore-{corners}-lily"]` with `weights`): at each point, the names the set has no tile for are left out, and a name that is no tile for any corners of the map's keys is an error.
- The layered test map adds a patch of each terrain between the bottom and the top, and draws every variant where a scene with those legends (seed 0) would.
- The Godot TileSet weighs a layered tile against the heaviest tile with its corners, so the plain tile and its variants share out Godot's random pick and every other tile keeps probability 1. A terrain's editor colour comes from its plain tile.
- `examples/shore.autotile.json` has two more fills per terrain and a rare lily pad, shell and daisies, and solid water: 90 tiles.

### Renders note loops that lift, jump or repeat a frame

- The render `check` (MCP `pixel_render`, CLI `render`) reports `motion`: each animation's silhouette box and lowest row for every played frame, in play order.
- When the recipe names its animations, its `notes` point out loop motion that tends to look wrong: a solid body of which at least half the frames stand on one ground row while one leaves it by 2 rows or more, moves unevenly (one step of 3 px or more and at least twice the median) or jumps back at the loop, with the steps that barely move beside it (and, for a loop that only loops by default, how to make it play once, on its first such note), and identical neighbouring frames of equal duration. One-shots, recipes without animations and tile sets without animations of their own get none. The notes are advice, at most eight motion notes a check plus a count of the rest, and never change `check.ok`; on the shipped examples they stay quiet on 49 of 57 animated presets.

### Grounded squash and stretch for slimes and blobs

- Masses take `flat: true`: the top half of an ellipse, a dome with a flat base anchored at the middle of its base row, which squash and rotation keep in place.
- The idle template takes 2–16 frames (from five, poses are numbered `idle-0`…) and `squash` (0.05–0.5): the body stretches and squashes along a sine while its lowest drawn pixel stays on `rig.ground` in every frame. Not with `breath` or legs. Past four frames the key poses are the quarter phases, so the motion review's pose spread passes gentle loops.
- New example `examples/slime-idle.poses.json`: the quick start's slime, eight frames at 32 × 32.
- Idles and masses without the new fields compile byte-identically.

### Transitions between terrains

- An autotile source's `layers` stacks 2–4 terrains bottom first (water, sand, grass) into one corner set with a tile for every mix of them at a tile's four corners: 16, 81 or 256 tiles, named by the layers' keys at the corners (`{corners}`, so `shore-wsgw`). Each layer is drawn from its own terrain (merged over the set's), template rows or ops. A tile is the lowest terrain among its corners filling it and each higher one among them drawn over it, counting the cells of every terrain above it as its own, so sand runs on under grass and grass straight on water draws no sand. Each frame's `tile.corners` names its corners' terrains.
- New reviewed example `examples/shore.autotile.json`: water, sand meeting it with a line of foam, and the meadow's grass. The test map puts the top terrain's shapes over the bottom one and rings of the terrains between round its block.
- Scene and recipe tilemaps name a layered tile with `{corners}`, the characters of the four cells around a corner tile (past the map's edge, the nearest cell). A scene drawn from the compiled tiles and a recipe drawing one map per layer give the same pixels.
- The Godot TileSet makes a layered set one terrain set matching corners with a terrain per layer, so Godot's painter draws the transitions. The bottom terrain is an unset corner, so cells at the edge of the painted area keep their tiles, and each tile is there once per terrain as its centre (alternative tiles). Painted bottom-up, as the export's README says, Godot picks Pixelbolt's tile and centre in every cell; `scripts/verify-godot.mjs` paints a three-terrain set over five maps to prove it.
- A corner tile drawn by several legend entries at one point is drawn once when they would draw the same thing.

### Corner (dual-grid) tile sets

- Autotile sources take `mode: "corner"`: 16 tiles that sit where four map cells meet, each mask naming which of those cells are terrain (NW=1, NE=2, SW=4, SE=8). Every quarter of a corner tile is the inner quarter of one of the four cells, cut from the same template, so any terrain or template gives a corner set, and a corner map draws exactly the pixels a blob map of the same cells draws, from a third of the tiles. Variants are picked per tile. The empty tile (mask 0) is compiled once.
- Recipe and scene tilemap legends take `autotile: "corner"`: the tiles are drawn half a cell up and left of the cells, one more row and column than the map, each point once per legend entry among its cells. Corner maps need an even cell size and square layout.
- The Godot TileSet gives a corner set a terrain that matches corners (mode 1). Godot's painter puts the terrain where four painted cells meet and picks Pixelbolt's corner tile on every painted cell, the empty tile where a cell has no terrain point; without that tile Godot would erase the cell and its terrain. The export's README says that ground ends half a cell inside what is painted.
- `collision` on a corner set boxes each tile's terrain quarters, kept from their cells' open sides, so the shapes join into the blob boxes of the same map; two cells that touch only at a tile's middle give two polygons. A frame's `tile.collision` takes a list of up to 8 polygons, the atlas always holds a list, and the TileSet writes `polygon_0`, `polygon_1` and so on.
- The seam check, test map and `expect.transparent` handle corner sets, and the delivery check does not call the empty tile an accident. `scripts/verify-godot.mjs` loads a weighted corner set with collision on its own and in the scene's TileSet, with three sets painted on one layer.

### Presets over MCP and the command line

- `pixel_help` topic `presets` lists every shipped fluid, fx, wave and poses source and each looping plain recipe in `examples/` (the coin spin, the ember), read from the folder when asked: each with its name, file, size, frames, loop or one-shot, colours, animations and a line on what it is for, with the Fluid and Effects labs' titles where they have one. Topic `preset` with a `name` returns one preset's source, any file it names inlined, ready to edit.
- `pixel_compile` takes `{"preset": "<name>"}` in place of `source`, and the CLI `compile --preset <name> --out <new.json>`; both are byte-identical to compiling the preset's file. `pixelbolt presets [name]` prints the listing or one source.
- The quick start, the server instructions and the first sentence of the fluid and fx schemas say to start fire, smoke, explosions, splashes and spells from a preset, and to get fewer frames by keeping N evenly spaced frames with one `pixel_patch` call (the quick start has the call for 8 of the smoke puff's 19), never by lowering `frames`, which stops the effect before it ends. The quick start no longer lists the slime fluid among ready-made effects: it is a drop of liquid, not a character.
- The MCPB bundle ships every top-level example and the labs' preset lists, so the presets work in Claude Desktop too.

### Godot TileSets with weights, collision, plain tiles and several sets

- Autotile variants take `weight` (1–1000): the test map mixes variants by weight, and the Godot TileSet gives each tile its probability against the heaviest of its terrain. The meadow example's flowers now show a quarter as often as each plain fill.
- An autotile source's `collision` gives every tile a collision box on physics layer 0: `true` keeps it from each open side by that edge's depth, so a body stands on the drawn ground, `inset` sets the margins and `oneWay` makes one-way platforms. The ground example has collision.
- Recipe frames take `tile`: `terrain`, `weight`, a `collision` polygon in canvas pixels and `oneWay`, checked when rendered (points inside the canvas, in order, enclosing an area) and exported in the atlas in exported pixels. Any frame with `tile` makes the export write a TileSet.
- Frames that are not autotile tiles but draw something become plain tiles in the TileSet instead of being left out; empty frames are no tiles.
- Each terrain is a terrain set of its own, so two sets in one recipe (named apart with `tile.terrain`) export together, blob and cardinal alike, and a scene export writes `tileset.tres` holding every tile-set asset as its own atlas source, painted by one `TileMapLayer`. Godot's terrain painter picks Pixelbolt's tile with both sets on one layer.
- A tile set without animations of its own exports no SpriteFrames, APNGs, CSS or player (its only animation flipped through every tile), its preview shows the sheet, and its README says how to paint it in Godot. MCP `saveAs` `godot` points at `tileset` there.
- `expect.transparent` no longer fails every tile set: inner tiles, with the terrain on all four sides, are solid by design, so only tiles with an open side are judged.
- `scripts/verify-godot.mjs` also checks probabilities, collision polygons, plain tiles and a scene's two-set TileSet in a real Godot (4.7.2), which re-saves the exported TileSets unchanged apart from resource ids.

### Tilesets from a terrain description, with a test map and seam check

- An autotile source can draw its template from a `terrain` instead of typed rows: a `fill` that repeats every tile (a colour with seeded `speckle` clumps, or a `pattern`), an edge per side (`depth`, `jitter`, `bands` such as an outline and a rim light, `outside` colours such as a cast shadow, seeded `tufts`), and `round` and `inner` corners. A terrain is seamless by construction: its tiles, stitched into any map, are exactly the terrain drawn directly. Agents no longer have to hand-type a 2×3-tile template, which a cold test found they could not do reliably.
- `ops` draw over a template (rows or terrain) with the source's `symbols` and `ramps`: flowers, cracks, stones. A variant's `terrain` merges into the set's field by field, so `{ "fill": { "seed": 11 } }` varies the fill and keeps every edge; a variant's `ops` draw after the set's.
- Compiling checks every quarter join a map can make. `Seam` warnings name the template pixels where an outline or edge breaks and the pixel to copy to mend it; one `Texture` warning counts fill that does not repeat; a cardinal set says once that it cannot turn inner corners. On a terrain only what `ops` change is checked.
- Compiling also draws every tile over a test map that holds all 47 (`--preview <new.png>` on `pixelbolt autotile` and `compile`; a second image from MCP `pixel_compile`), on `preview.background` when given. Metadata counts seams.
- New reviewed examples: `examples/meadow.autotile.json` (grass over dirt from above, with fill and flower variants) and `examples/ground.autotile.json` (platformer ground from the side: grass cap, lit walls, roots).
- A template of the wrong size names every row of the wrong width. Tiles are limited to 84 pixels, the largest whose template fits a symbol; larger ones used to fail with a message about symbols.
- The art workflow explains how tiles are stitched from template quarters, why a template has to repeat every tile, and where detail may cross quarter lines.

### Loop review that measures real jumps

- The fx compile no longer guesses at loop seams. It draws the frame that should follow a loop's last (the next cycle's first) and warns only when the loop's first frame differs from it, counted as `seam.jump`. The old test, a last-to-first change larger than every other step, also fired on seamless loops whose biggest change fell at the seam by chance: at seeds 2, 3 and 7 it flagged eighteen fireball, projectile and buff loops that loop exactly.
- A bolt `reroll` spanning a loop wraps round its cycle, and a stream's `head` and `tail` keys, read at the end of each frame, wrap with it.
- Keys that only show in later frames are warned about by name: a stream's `head` or `tail` and a `reveal` on a layer spanning the loop, and an emitter spanning the loop whose `path`, `sweep`, `throttle`, keyed `rate` or ring `grow` doesn't end where it starts.
- The Effects lab presets compile with no warnings at seeds 2, 3 and 7.

### Effects round a character, cut-off review and see-through gas

- Layers and emitters take `depth`: `back`, `split` (a layer's rows above its centre, or the particles born above their spawn centre, go behind) or `front`, the default. An effect with anything behind also compiles `<effect>-back` and `<effect>-front`, with the same frames, timing, cues and anchor, for a game to draw under and over its character; the whole effect draws the back side under the front side, so the parts drawn together give exactly its pixels. A sprite emitter that only draws can be a stand-in (`depth: "between"`), drawn between the sides in the whole effect and in neither part. Child emitters take their parent particle's side.
- The holy and ice buffs in the spell library use it, with a plain stand-in figure in `buff`.
- The fx compile reviews each animation's `edges`: the canvas sides it draws on, with the most pixels a frame and the frames. It warns about a side, since whatever reaches past it is cut off, unless the effect lists it in its own `edges` (a bolt from the sky); turned copies turn the sides. The Effects lab shows the chosen effect's warnings under the preview, so a seed that throws a spark off the canvas says so.
- Examples that were cut off are fixed: the water geyser's and dome's ripples (the canvas is 4 pixels taller), the lightning strike's flash (96 × 104, centred), the fluid blast's shockwave, the slash, swing and shatter flashes and shards, and the poison impact's drops; the lightning bolts and hero effects list the sides they touch on purpose. Every Effects lab preset stays off its edges at seeds 2, 3 and 7 too.
- Poison gas is see-through: translucent colours lit on top, with no shade band or dither, drifting apart on turbulence and thinning as it swells. The effects guide explains when smoke and gas should be translucent rather than outlined.


### Fixes from a cold-agent test of the effect tools

- Emitters take `kick: [x, y]`, a velocity added to every launch whatever its angle, so outward shards on a ring laid on the ground can pop up as they fly out.
- Emitters take `ground`: a floor that many pixels below where each particle was born, so shards thrown up from a ring laid on the ground land back on their own patch of it. `bounce` and `when: "floor"` children work with it.
- Paths, on emitters and layers, are travelled at a steady speed along their length, so unevenly spaced points no longer make the spawn centre or a layer lurch. Keyed `drift` still gives each key an equal share of the window.
- `halo` reaches round: one pixel wide it is the four neighbours as before, wider it is a round glow instead of a diamond.
- A squashed spawn ring spreads particles evenly along its perimeter instead of crowding its narrow ends, and a full `even` ring on a rate emitter turns to a fresh angle each frame instead of repeating fixed spokes.
- The render check no longer notes the empty frames that end a one-shot, which the effects guide asks for; empty frames elsewhere are still noted.
- An fx source's symbol with an unknown palette character is reported at `fx.symbols.<name>[row]`, with the palette's keys, instead of at `project.symbols`.
- The effects guide explains matching a spawn ring's `grow` to a ring layer (the same `start`/`end` numbers as its `frames`, `ease: "out"`, and ending keyed `rate` at 0 rather than shortening the window), and which symbols spin well.

### Effects lab

- The studio has an **Effects lab** (`/effects.html`), like the Fluid lab: it compiles the seventeen self-contained `pixelforge-fx` presets (spell shapes, the spell library, cel water, particles) in the browser with the same compiler, plays any of a source's effects and turned copies, changes the chosen effect's strength, speed and seed, and downloads the GIF, sprite sheet, recipe or edited source beside the matching CLI and MCP calls. The studio walk checks that every preset compiles in the browser to the same recipe as Node.

### Emitter ease and fixes from a review of the new effect tools

- Emitters take `ease`, which moves `path`, ring `grow`, `sweep` and `throttle` over the window as a layer's ease moves its keys (default linear), so a trail given its head's `ease` keeps pace with it.
- A `stream` with drift keys or a path no longer always curves them; `curve: false` is accepted on any layer; a layer `path` takes up to 16 points, as an emitter's does.
- Every particle a moving emitter spawns on its first frame inherits the same speed, and a pause in its path inherits none.
- Symbols turned for `spin` are added to the recipe after every effect is read, so one effect can no longer name a turned symbol another happened to make.
- Inputs that silently did nothing are refused: `path`, `sweep`, `throttle` and ring `grow` on a burst (which spawns at one moment), and a keyed `rate` over a one-frame window. `sweep` now turns an outward ring's launches too.

### Sweeping emitters

- Emitters take `throttle`, 2–8 keys scaling the launch speed over the same window: a fountain weakens, a flamethrower dies out.
- Emitters take `sweep`, 2–8 keys in degrees added to the launch angle over the emitter's window from `start` to `end`: a flamethrower swings across, a fountain sways. Without it, angles are picked as before.

### Sparks that carry forward

- `inherit` also works on an emitter moving along a `path`: its particles get that share of the emitter's own velocity, so sparks thrown by a projectile carry forward instead of stopping where they were born.

### Spawn rings on the ground

- An emitter's `ring` takes `fill`: distances in its radius range are picked evenly by area, so `radius: [0, r]` fills a disc evenly instead of crowding its middle.
- An emitter's `ring` takes `grow`, 2–8 keys over its window that scale the radius, so sparks spawn on a shockwave's edge as it spreads (`[0.2, 1]`) or close in (`[1, 0]`).
- An emitter's `ring` takes `squash`, as a ring layer does: `[1, 0.4]` lays the spawn ring on the ground, so sparks rise from a magic circle's ellipse instead of a circle standing upright. Without it, rings spawn as before.

### Paths for layers

- A shape layer may take a `path` of 2–8 absolute points instead of `at` and keyed `drift`, as an emitter does, so a projectile's head and the emitters trailing it share one list of points. `curve: true` smooths it.

### Curved paths

- `curve: true` on an emitter with a path, or on a layer with keyed `drift`, runs three or more points through a smooth Catmull-Rom curve that still passes every point, so an arc has no corner at its middle. Without it, paths and drift stay straight between points.

### Tumbling particles

- Emitters take `spin`, degrees a frame (a number or `[min, max]`): each particle's symbol turns from a seeded start in 45° RotSprite steps, so shards, rocks and leaves tumble instead of sliding. The turned symbols are added to the recipe as `<symbol>_r<degrees>`. Without it, nothing changes.

### Halos

- A shape look takes `halo: { color, width, dither }`: a glow of one colour on the empty pixels within `width` steps of the look, beyond its outline, dithered when two or more pixels wide, so a bright orb or beam glows without a hard ring. Without it, nothing changes.

### Even trails from fast parents

- Children that spawn while a parent particle lives (`when: "life"`) spread a frame's spawns along the stretch the parent moved since the last frame, the last where it is now, so a fast projectile leaves an even trail instead of one clump per frame. One child a frame spawns where it did before.

### Boiling rings

- A `ring` layer takes `boil`: its breaks churn over the window, or every cycle for a ring spanning a loop, through two fields that take turns so the loop stays seamless. A looping shield bubble or portal rim no longer stands still. Without it, rings draw as before.

### Vortex, meteor and shield examples

- `examples/shield.fx.json`: a looping shield bubble whose ring churns (`boil`) inside a dithered glow (`halo`), with a highlight arc, glints spread evenly inside it (ring `fill`) and motes drifting round it (`attract.swirl`).
- `examples/meteor.fx.json`: a one-shot meteor whose head shares its `path` and window with its trail emitters, so smoke, a tail of cooling fire blobs and embers keep pace with it, then an impact with fiery debris, rock chips that tumble (`spin`) and rising smoke from a keyed `rate`.
- `examples/vortex.fx.json`: a seamless looping vortex that shows the newest effect tools together: motes that swirl in (`attract.swirl`), wisps that wander (`turbulence`) and cool as they fade (blob `power`), drawn in front of the motes (`front`).

### Cooling blobs

- A blob emitter takes `power`, a number or 2–8 keys over each particle's life that scale its disc's field: embers and sparks of molten metal cool through their look's bands, white to yellow to red, as they fade. Without it, drops draw as before.

### Keyed drift

- A shape layer's `drift` takes 2–8 offsets as keys spread over its window, so an orb arcs or a flame wanders instead of sliding in a straight line. Turned copies turn the keys; a plain drift moves as before.

### Keyed emission rates

- An emitter's `rate` takes 2–8 keys spread from `start` to `end`, such as `[4, 0]`: a spray that starts thick and tapers, or a fire that builds, from one emitter. A steady rate spawns exactly as before.

### Moving emitters

- An emitter may take a `path` of 2–16 points instead of `at`: its spawn centre moves through them over the emitter's window from `start` to `end`, timed as a layer's keys are over its frames, so a trail keeps pace with a layer that has the same window. A meteor sheds smoke as it falls and a spark traces a circle, without a parent particle to carry the emitter. Turned copies turn the path.

### Turbulence

- Emitters take `turbulence: { strength, scale }`: each particle is pushed by a smooth seeded field that stays put, so smoke and embers wander apart organically instead of swaying in step. The field never moves, so loops stay seamless. Without it, nothing changes.

### Swirling attraction

- An emitter's `attract` takes `swirl`: an acceleration across the line to its point, clockwise when positive, so particles spiral into a portal or circle a target. Mirrored turns swirl the other way. Without it, nothing changes.

### Looks in front of particles

- A shape look takes `front: true`: it draws in a second grid over the effect's symbol particles instead of under them, so smoke can roll over sparks. Without it, nothing changes.

### Effects that light a scene

- `light: true` on a `pixelforge-fx` effect writes its light track into its frames as a point named `light`. A scene light that follows `{ instance, point: "light" }` rides the effect's light, lights the normal-mapped sprites around it and goes dark on frames with nothing bright; atlases export the point for game code.

### Light tracks

- Every `pixelforge-fx` compile gives each animation a `light` track in its metadata: per frame, where the bright pixels are (`at`), how much light they make (`glow`, in full-white pixels) and their colour, or null. Game code can drive a point light from it; it is the first step toward effects that light a scene.

### Auras round rings and discs

- An `aura` may hug an ellipse instead of a sprite: `around: [rx, ry]` centred on `at`, its ring or with `disc: true` the whole disc. A ring of flame licking up from the ground no longer needs an invisible ring symbol to hug (the fire helper's workaround).

### Flowing noise

- Slash, beam, bolt, glyph, star, stream and trail layers take `flow: [x, y]`: their noise moves that many pixels over the window, or every cycle for a layer spanning a loop, through two fields that take turns so the loop stays seamless. Water runs along a stream instead of its texture standing still. Without `flow`, nothing changes.

### Keyed squash

- A shape layer's `squash` may be 2–8 `[x, y]` pairs, keys spread over its frames like its other fields: a ground pool can round out as it shrinks instead of thinning to a one-pixel sliver. A single pair draws as before.

### Highlight reach

- A look's `reach` (default 2, as before) sets how many pixels toward the light its `lit` and `shade` bands measure over: 1 keeps a small drop's highlight to a thin rim (small drops used to come out almost all highlight), 3–4 spreads light over a large body.

### Streams that fade

- A `stream` takes `fade`, dimming it toward the far end of its curve as a beam's does: a tail that cools along its length, with no bright one-pixel tip. Default 0, as before.

### Keyed noise and blob sizes

- A shape layer's `noise` takes keys like its other numeric fields, so one layer can stand solid and then shatter; before, that took two layers.
- A blob emitter's `size` (a number or `[min, max]` picked per particle) scales its radius keys: mixed puff sizes give smoke and gas a bumpy, billowing outline. Both default to the old behaviour, pixel for pixel.

### Effect reviews

- Every `pixelforge-fx` compile reviews its animations in the metadata: each loop's `seam` against its `largestStep`, and each one-shot's `residue`. A loop that jumps at its loop point is reported under `warnings` (CLI `compile`, MCP `pixel_compile`), naming the effect and the usual fixes. None of the shipped effects warns.

### A spell library

- `examples/<element>-spells.fx.json` for fire, ice, lightning, water, poison, holy and shadow: each a looping projectile turned to eight directions, an impact, an area effect and a looping buff, on one 64 × 64 canvas anchored at [32, 40], the point a game places every effect at. 28 effects, each reviewed frame by frame; `test/spell-library.test.js` pins their pixels, keeps every loop seamless and every one-shot ending empty, and checks each impact and area cues its hit. The pixel art skill and the workflow guide point to them.

### Shape fixes

- A look's outline is drawn only round pixels still there after `cleanup`: a stray it removed used to leave its outline behind as a small hollow dark diamond (422 such pixels in the water examples, one in the fire explosion).
- A `slash` spanning a looping effect stays whole: its tail used to chase the head away over the cycle, so the crescent vanished and popped back at the loop point.

### Fluids inside an effect

- A `pixelforge-fx` symbol's `recipe` may be a fluid or wave source as well as a recipe or pose source; its effects are its animations. Drawn by a sprite emitter, a simulated explosion plays frame for frame, pixel for pixel, under shape-layer flashes and shockwaves and particles, all in one recipe. `examples/fluid-blast.fx.json` puts `explosion.fluid.json` under a flash star, a breaking shockwave and embers.

### Effects in every direction

- `turn: { angles, about, mirror }` on a `pixelforge-fx` effect compiles a copy for each angle, named `<effect>-<angle>` (and `-mirror`), with its geometry turned instead of its pixels rotated: places, spawn offsets, launch angles, attract points, tilts, slash arcs, beam, bolt, stream and trail points, drift. Gravity, floors, sway and the looks' light stay put, so sparks still fall and highlights stay upper left; the copy at 0 is the effect as drawn, pixel for pixel. Layer noise turns with each copy, so a quarter turn is the drawn copy turned, pixel for pixel. `examples/fireball.fx.json` now flies in eight directions on a 56 × 56 canvas, anchored at the ball.
- The fireball reads as a comet: a smaller white-hot core inside yellow and orange bands, a round front with no scraps of flame ahead of it, and a tail that leaves the head orange and cools to red before breaking into wisps. Its head had been one big flat white disc that the tail's dark red met head-on.

### Poke the pixels: a live fluid toy

- The playground gains **Poke the pixels** (`playground/fluids/`): a campfire, honey, slime, a waterfall, a potion, a magic swirl and steam run live in the browser with the released engine's `createLiveFluid`. Drag to push the fluid with the pointer's speed; hold to pour a liquid or add heat and smoke to a gas; arrow keys and Space do the same from the keyboard. **Save GIF** saves the last four seconds at about 320 pixels on the long side, blended onto the stage colour. **Copy link** makes a link (#v, p and i, all in the fragment) that replays what was done on the same frames, so the person who opens it sees the same pixels; a two-minute busy session fits in about 7,000 characters, and a longer one is cut at a poke to fit. Touching the effect during a replay takes over, and a new link carries both. **Edit the recipe** opens the preset in the playground. The page has a 1200 × 630 link card, drawn by `scripts/fluid-toy-preview.mjs`, and the deploy script lists it in the sitemap and links it from the home page.
- The playground and the toy load 0.9.2 by default, and the playground lists 0.9.2's slash hit, fire explosion, lightning strike, healing circle and cel-shaded water effects. Links that name 0.9.1 still open on 0.9.1.
- The playground and the toy load 0.10.0 by default; links that name an earlier version still open on it.

### Bigger live fluids, finer steps and round fills

- A live fluid run is held to the work budget (about 400 million cell updates) only for its warm-up, since it steps one frame at a time. A 72 × 128 slime with 256 frames at 4 substeps used to be refused by `createLiveFluid` because compiling all 256 frames would go over; it now runs with a warm-up of up to 132 frames, at about 3 million cell updates a frame (that source's 24 iterations, with yield stress). The default warm-up, a whole cycle, is too long for it, and the error says how many frames fit.
- `substeps` goes up to 16 (it stopped at 4), for fast liquids that need finer steps. Time grows with it: the waterfall steps live in about 2 ms at 2 substeps, 7 ms at 8 and 17 ms at 16, and the work budget counts every step.
- A liquid `fill` can be an ellipse (`radius: [x, y]` with `at`), and an effect may list 64 fills (it stopped at 16). A jelly dome wider than it is tall is one fill, an ellipse cut by a box, where it took a stack of 2-row strips with steps down its sides.

### Fixes

- The CLI's inline `--expect` and `--guides` JSON works in Windows PowerShell 5.1, which strips the double quotes from arguments it passes to a program (`'{"width":32}'` arrives as `{width:32}`), so the pixel art skill's `render --expect` step works there. A value with no quotes left has its bare keys quoted back (neither option takes a string value); if it still isn't JSON, the error says to pass a .json file or use PowerShell 7, cmd or bash.
- The release's npm check asks the registry again on every try (`--prefer-online`), for up to five minutes. 0.10.0's check failed: npm was still processing the new version at the first tries, and the later ones could reuse a cached version list without it. The package itself was fine; a rerun passed.
- Godot SpriteFrames (`name.tres`, a scene's `sprite_frames.tres`, MCP `saveAs.godot`) give each frame's AtlasTexture an id Godot accepts. The id was `AtlasTexture_` and the frame name, and Godot takes only letters, digits and underscores, so Godot 4.7 logged "The scene unique ID must contain only letters, numbers, and underscores" for every frame with a hyphen in its name: every compiled effect and autotile set. The frames still loaded. Hyphens now become underscores, with a number when that id is taken (`hit-1` beside `hit_1`); names without hyphens keep their ids, so those files are unchanged. `node scripts/verify-godot.mjs` loads frames with hyphenated names and passes in Godot 4.7.2.

## 0.10.0 (2026-10-29)

### Effects on a sprite

- A `pixelforge-fx` symbol may be a frame of another recipe or pose source: `{ "recipe": "hero.poses.json", "frame": "idle-rest" }`. The CLI and MCP read the file (MCP: under the server root, or a saved revision); the frame becomes rows over its whole canvas, so the sprite keeps its coordinates, and its colours join the palette under their own keys or spare letters where the effect uses a key for another colour.
- An emitter with `sprite: { symbol, pixels }` spawns on that sprite's pixels (all of them, its edge, or the outline just outside it), its top-left corner at `at`. Without shapes, each particle is its own pixel in its own colour. `release` takes every pixel once, in the order of a `sweep` across the sprite, while what is left stays drawn: death dissolves and teleports. `tint` stages may now be one colour each, turning a whole particle that colour.
- An `aura` shape layer is a continuous glow hugging a sprite, reaching further upward, its edge licking up in flames as noise rises; spanning a looping effect, it loops without a jump. Random particles along an outline looked patchy; this does not.
- `examples/hero-magic.fx.json` puts a teleport and a looping spirit aura on the rigged hero, read from `hero.poses.json`.
- A symbol may be a whole animation (`{ recipe, animation }`): a sprite emitter or aura on it shows its frame *i* in the effect's frame *i*. A sprite emitter with `draw: true` and nothing to spawn only draws its sprite, so a character can sit under its effect.
- A `trail` shape layer is the smear behind a moving point. `follow: { recipe, animation, point }` takes the point from each frame of a pose animation (`blade.tip`, in-between poses included), and a `pivot` such as `blade.anchor` bends it round the hilt: a crescent whose outer edge is where the tip went. `examples/swing-trail.fx.json` puts one on the sword of `swing.poses.json`.

### Effects that loop, and examples that follow their own advice

- In a looping `pixelforge-fx` effect, a shape layer that spans every frame is a cycle: it moves at a steady pace (`ease` defaults to `linear`), is whole from frame 0 (`reveal` defaults to 0), and a `burst`'s noise boils outward by `boil` pixels every cycle without slowing. A looping fireball changed 158 pixels at the loop point against at most 59 between other frames; it now changes 49, inside the 29–60 of the others. One-shots and shorter windows in a loop draw exactly as before, so every earlier source keeps its pixels.
- `examples/fireball.fx.json` is a projectile in flight that loops seamlessly: a cycling burst, a beam tail with whole waves and looping embers.
- The fire explosion's smoke is blob particles with lit and shade bands that swallow the dying fire and fade by breaking into shrinking puffs, instead of dithered grey; its shockwave breaks into pieces instead of thinning to a one-pixel ellipse, and its fire cools from the outside without leaving a dark ring.
- The slash hit's and lightning strike's rings break up instead of ending as one-pixel outlines; the lightning bolt flickers out by frame 6 instead of lingering as a thin line. The healing circle's pillar has clean bands instead of dither speckle. The landing dust in `examples/effects.fx.json` is round, lit puffs that spread and shrink away instead of two flat slabs.

### A lighter skill

- The pixel art skill is 12 KB instead of 21 KB and starts from the quick start, which covers most tasks, instead of asking for the 50 KB authoring guide before the first recipe. The core loop, the art brief and work order, and the judgement rules for characters, tiles, scenes, effects and lighting stay; field-level details now link to the guide and workflow sections that already hold them.

### Smaller replies

- The CLI's `render` and `scene` name their folder once (`directory`) and list files relative to it, leaving out each frame and, past 16, each animation, as MCP `pixel_render` does; `--list-files` lists every file. A 13-frame sprite's reply went from 3.9 KB to 0.8 KB. `removed` paths are relative too.
- `compile`, `autotile` and `import` write their metadata only with `--metadata <new.json>`; without it the reply carries a hint instead of the metadata, which ran to 110 KB for one rigged figure (MCP `pixel_compile` already returned it only on request).
- Clipping lists the first 16 places instead of 64, and the CLI and MCP replies now pass on `clippingOmitted`.

### Every error in one reply

- Validation names every broken drawing operation at once instead of stopping at the first: the error's `path` and message start with the first, the message names the rest, and the CLI's and MCP's error replies list each in `errors` (up to ten). Frame fields, animations and the sheet still stop at once.
- A grid names every row whose width differs from row 0, with its width (`row 6 has 19, row 9 has 21`), and every unknown character with its row.

### Rigged figures that say what went wrong

- `examples/hero.poses.json` is a complete rigged side-view figure to start from: bone limbs, a mass torso, a grid head and boots, far limbs a ramp step darker, and the idle, walk, run, jump, attack and hurt templates, each passing its own motion checks. Its origin is where the feet meet the ground, so every frame's atlas anchor is a ground point, and its torso stands there by `at`. The skill, quick start, workflow guide, README and llms.txt point to it.
- Compiling poses warns when a pose draws outside the canvas: how many of its pixels are lost, the box its parts cover and its origin. A figure placed entirely off the canvas used to compile to empty frames with no word about it. The rest pose of a rig says once that the generated poses follow it.
- Warnings on poses that motion templates generate point at what the author wrote. A reach warning is said once per motion and leg, naming the poses (`poses.motions.walk (farShin).reach: … in 8 of 8 poses …`), and once per leg when the rest pose already ends away from `rig.ground` (`poses.rig.legs[1] (farShin): … this leg ends at row 64 …`). They were one line per generated pose at a path such as `poses.poses[13].parts[3]`, which no source has. An authored pose that replaces a generated one keeps its own index in errors and warnings; the metadata keeps one entry per pose.
- The render check fails a delivery with nothing visible (every checked frame fully transparent), with or without `expect`, and its fix points at the compile warnings and the source. It used to pass with `colors: 0` and a note.
- `poses.schema.json` says a part's `at` is an offset from the pose origin (or the attached point), not a canvas position, and what `origin` is.
- The plain humanoid figure fixture is 36 pixels tall instead of 32, so its jump apex keeps the top of its head (18 pixels were clipped); its figure golden is updated.

### Lit sprites in Godot

- A scene export's asset with a normal pass also gets `normal_y_up.png`, the pass with green flipped to +Y up as Godot and Unity read a normal map, and `canvas_texture.tres`, a Godot 4 `CanvasTexture` pairing `color.png` with it at nearest filtering. Its `sprite_frames.tres` draws through that CanvasTexture, so an `AnimatedSprite2D` given it is lit by Light2D nodes such as `PointLight2D` with no import settings to change. `alignment.json` names both (`canvasTexture`, `passes.normalYUp`); `normal.png` keeps its +Y down convention.
- `node scripts/verify-godot.mjs` checks the lit asset's frames draw through the CanvasTexture and its normal map is `normal.png` flipped. With `--render` it lights the sprite in a Godot window from four sides: in Godot 4.6.3 the half facing the light is brighter, and the unflipped `normal.png` lights it upside down.

### Godot TileSets for autotile sets

- A recipe whose frames are an autotile set also exports `name.tileset.tres`, a Godot 4 `TileSet` for `TileMapLayer`. It has one atlas source on the sheet's grid (padding and scale as margins and separation) and one terrain: blob sets match corners and sides, cardinal sets sides only, and each tile's peering bits are its neighbour mask. Painting the terrain in Godot picks the tile Pixelbolt's tilemap would. Frames of one mask are alternatives Godot picks between at random. An animation that loops over one mask's frames, laid side by side in a row of the sheet, becomes an animated tile with each frame's time.
- The export warns instead of guessing: a trimmed sheet gets no TileSet, a set missing masks is named, and an animation that wraps onto the next row of the sheet keeps its first frame and says to set `sheet.columns` to a multiple of the frame count. A bundle can now hold 9 support files, so 65,535 − 9 − frames animations fit (65,525 with one frame).
- The CLI's `render`, MCP `pixel_render` and the studio's **Export assets** ZIP include it, and `pixel_render`'s `saveAs` takes `tileset`. A saved TileSet names the saved sheet relative to itself, keeps its sheet inside the Godot project, and replaces only another TileSet with `overwrite`.
- `node scripts/verify-godot.mjs` now also loads a blob, a cardinal and an animated TileSet in headless Godot. It checks every tile's peering bits, region, pixels and frame times, then paints five maps with Godot's terrain painter: Godot 4.6.3 chooses Pixelbolt's tile in all 762 painted cells.

### CI: slow downloads and a slow browser

- The portable build tries a Node.js runtime download again after a dropped connection, a stall of 30 s, a connection slower than 256 KB/s over 15 s or a server error (four tries), and says how to supply the archive yourself if every try fails. CI keeps the downloaded runtimes in a cache keyed on the pinned version, and a runner without its own entry starts from another system's.
- The studio walk waits up to 30 s instead of 8 s for something to happen, and for each sample's drawing instead of a fixed 150 ms. A cold browser on a busy runner once took longer than 8 s to load the studio.

### Fixes

- A pose source without `ramps` of its own takes them from the shared palette file it links (`{"palette": {...}, "ramps": [...]}`), as a recipe does and as `poses.schema.json` says, in the CLI, MCP and studio. A bone or mass that names a ramp in a source with none now says to add `ramps` instead of "expected an integer from 0 to -1".
- An fx cue named like a member of every JavaScript object (`toString`, `constructor`, `hasOwnProperty`, `valueOf`) becomes a frame point and a metadata cue like any other name. It was dropped without a word, because the cue map seemed to have it already.

## 0.9.2 (2026-10-28)

### The pixel art skill on its own

- `pixelbolt skill install` (or `npx -y pixelbolt@latest skill install`, with nothing cloned) installs the pixel art skill for Claude Code with no MCP server: into `~/.claude/skills/pixelbolt-pixel-art/`, the current folder's `.claude/skills/` with `--project`, or any skills folder with `--dir`. It prints where it wrote.
- The installed `SKILL.md` runs every command through `npx -y pixelbolt@<the installing version>` instead of a checkout's `node bin/pixelbolt.js`, and the agent guides, the schemas, every example and the licence are copied beside it, so the files it names are there. It maps each MCP tool the skill mentions to its command. Links to other repository files point to GitHub at that version's tag. The skill shipped in the package and the Claude Code plugin is unchanged. Installed from a checkout, the reply warns that npx runs the released version of the same number.
- A `.pixelbolt-skill.json` manifest records each file's SHA-256. Installing again leaves an unchanged copy alone, updates an earlier version's untouched copy (or finishes an interrupted install or update, and puts back a file that was deleted), and refuses a copy you changed, a file of yours that a new version also ships, or a folder it didn't write, unless you pass `--force`. A manifest naming anything but plain paths inside the skill counts as none. Files are written beside their target and renamed into place, and a skill folder, or a folder inside it, that is a link is never written or removed through.

### Godot SpriteFrames and Aseprite frame tags

- Every export writes `name.tres`, a Godot 4 `SpriteFrames` resource, beside `name.png` and `name.atlas.json`: one `AtlasTexture` per frame cut from the sheet, and every recipe animation in recipe order with its frames in playback order and its loop. A trimmed frame's `margin` keeps it the full canvas size with its pixels in place. Godot plays a frame for duration ÷ speed seconds, so each animation's speed is 1000 ÷ the largest step that divides its frame times and the durations are whole numbers (240, 140 and 220 ms play at 50 FPS for 12, 7 and 11); when that step is under 9 ms the shortest frame sets the speed, at most the 120 FPS Godot's editor shows, and a warning names the animations whose fractional durations Godot keeps to a ten-millionth. The `.tres` names the sheet relative to itself, which Godot reads from the `.tres`'s folder, so the two work anywhere in a project together. The Godot docs said to slice a grid by hand; [game integration](docs/game-integration.md#godot-4) now covers the `.tres`, texture filtering, moving the sheet, and a Godot 4.6 playback issue ([godotengine/godot#123572](https://github.com/godotengine/godot/issues/123572)) that can skip a long frame right after a very short one.
- The atlas's `meta` gains Aseprite-style `frameTags` (`name`, `from`, `to`, `direction`) for every animation that plays one run of frames forward, backward or ping-pong; `from` and `to` index the atlas's frames. An animation that holds or skips frames has no tag, and `animations` still lists all of them. No existing field changes.
- The CLI's `render`, MCP `pixel_render` and the studio's **Export assets** ZIP include the `.tres`, and `pixel_render`'s `saveAs` takes `godot` (`"saveAs": { "sheet": "game/sprites/hero.png", "godot": "game/sprites/hero.tres" }`): a saved `.tres` names the saved sheet, or the export folder's, relative to itself; inside a Godot project (a folder with `project.godot`) its sheet must be in the project too; and `overwrite` replaces a `.tres` only if it is a SpriteFrames. Scene exports add `assets/<n>/sprite_frames.tres` over each asset's colour pass, named in `alignment.json` as `godot`.
- A bundle now has 8 support files, so a recipe fits 65,535 − 8 − frames animations (65,526 with one frame). Tidewatch's game atlases are regenerated with their frame tags.
- `node scripts/verify-godot.mjs` loads the forest spirit and a trimmed, scaled sheet with unequal durations into a headless Godot 4 and checks every frame's region, margin, size, pixels and time, and each animation's playback step by step against a replay of `AnimatedSprite2D`'s own code. Godot 4.6.3 passes.

### Spell shapes

- A `pixelforge-fx` effect can carry shape `layers` beside its emitters: a `ring` shockwave, a `slash` crescent, a `beam`, a `bolt` of lightning, a `glyph` magic circle, an impact `star` and a `burst` fireball, each one line of JSON. Every layer writes a brightness field inside its own window of frames, with any number written as 2–8 keys moving across the window; named `looks` cut the layers' fields into hard bands of palette colours, with optional ordered dither, then `cleanup` and a one-pixel `outline`. `power` erodes a shape as it falls, `squash` and `tilt` lay rings, magic circles and a pillar's foot on the ground or turn a slash onto a diagonal, and `cue` marks a layer's first frame for game code. The shapes compile to one grid per frame between `behind` particles and the rest, so sparks and embers still draw on top, and the result is an ordinary recipe. Sources with only layers need no `symbols` or `emitters`; effects without layers compile exactly as before. The `fx` schema and the art workflow describe every field, and `examples/` has four reviewed effects to start from: a slash hit, a fire explosion, a lightning strike and a healing circle.
- Shape painting visits only the canvas and counts what it visits: past 400,000,000 pixels in one compile, the layer that crosses the line is refused by its path, and an fx source whose effects make more frames than a recipe holds (256, or 4,194,304 pixels of frames) is refused before anything is simulated or drawn. A stream thousands of pixels across an 8 × 8 canvas used to keep `compile` busy for hours; it now takes under a second, and the shipped effects use under 0.1% of the budget. `tilt` and `squash` belong to rings, slashes, beams, glyphs, stars and bursts (a bolt or a stream refuses them rather than ignoring them), noise `scale` is a whole number of pixels, a glyph's `step` must be fewer than its `points`, and a beam whose `to` is its `at` draws its round cap instead of a filled square.

### Liquid shapes

- Shape looks take `lit` and `shade` bands with a `light` direction: each recolours the look's own pixels by how far its field falls two pixels toward the light (or away from it), so a body of water gets a highlight on one rim and a shadow side on the other, as the fluid looks do.
- A `stream` layer draws a tapered body along a smooth curve through 2–8 points, with `head` and `tail` keys for the part drawn, a `taper` along it and a travelling `sway`: geyser spikes, whips, spirals and wave curls.
- An emitter with `blob` draws its particles as soft discs summed into a look's field instead of symbols, so drops that touch merge into one body and split again, shrinking through `radius` keys over their lives.
- Every shape kind takes `noise` and `scale`, so a falling `power` breaks any shape into pieces and drops, and every layer takes a `floor` that cuts it off below a row (a dome, an arch). Effects that use none of these compile exactly as before. `examples/water.fx.json` has five reviewed water effects: a geyser, a whip, a ring breaking into drops, a popping dome and a curling wave.

### Wave effects

- A `pixelforge-wave` source bakes looping interference and portal or shield interiors. Its signed radial and directional waves add up before the palette thresholds, so opposite phases leave cancellation gaps, and the result is an ordinary recipe of palette grids. `pixelbolt compile`, MCP `pixel_compile` (schema in `pixel_help` topic `wave`), the studio and `compileWaves` from `pixelbolt/wave` build it. `examples/interference.wave.json` and `examples/portal.wave.json` are two reviewed presets, and [wave effects](docs/wave-effects.md) explains the controls.

### Large stills

- A recipe with a single frame may be up to 4096 pixels a side, within the 4,194,304 pixels every recipe's frames already shared, so a 1920 × 1080 or 2560 × 1440 backdrop or mural is one canvas at one screen pixel per art pixel. Rectangles, ellipses and dither or shade regions on such a canvas may be up to twice its side. Recipes with two or more frames, scenes and their assets, pose, effect, wave and fluid sources, and `import` keep the 256-pixel limit, and every existing recipe renders exactly as before.
- The render check offers a still at the asked size alongside a smaller canvas at a whole `sheet.scale`, and alone when no whole scale makes the size; a recipe with several frames gets the same advice as before. MCP `pixel_inspect` regions reach across a large still. The studio opens one fitted to its window (a **Fit** zoom, offered only for large stills, that scales it down smoothly) and leaves out the native-size preview, which a large still would push off the page; 1× and up show its pixels, and sprites keep their zoom.
- Every tool takes a still up to its full size. `pixel_render`'s preview and `inspect` draw a 4096-pixel still (a sheet may hold 4096 pixels of frames plus its 2-pixel gutters). A patch across a still too wide for before and after side by side draws before above after and says so in `imageNote`. `rewrite` keeps each match as one 64-bit number instead of an object, so a 2048 × 2048 rewrite takes a tenth of the time and memory for the same pixels. Frame pixel corrections may reach 4095 in the schema, and a normals source whose colour recipe is over 256 a side is refused up front by `normals.recipe`, since normal passes feed scene assets.

### Depth and perspective

- A scene's depth view shows what is drawn in front of what. MCP `pixel_scene` with `view: "depth"`, `pixelbolt scene <scene.json> --image depth.png --view depth --time 900` and the studio's **Depth** box tint each placement by when it is drawn, cool for far and warm for near, leave the ground (placements that lie straight on the background) grey, and draw each sorted placement's ground line with a tick at its placement point, so an anchor on the wrong row shows at once. The reply's `depth` lists the sorted placements far to near with the point each stands on, and `overlaps`, who covers whom by how many pixels; when nothing is sorted, a note says so. In the diorama study it reports the barrel covering the hero who walks behind it, and with sorting removed, the hero covering the barrel. `renderScene(scene, { depth: true })` and `sceneImage(view, { mode })` are the same in JavaScript.
- `guides` on `pixel_inspect`, `pixel_scene`, `inspect --guides` and `scene --image --guides` draw a horizon, rays from up to three vanishing points and an isometric diamond grid over the enlarged image, never into the art.
- A `pixelforge-normals` source takes `faces`, a map from the colour recipe's palette keys to normal directions, so the top, front and sides of a box, wall or building get flat planes instead of a cushion. Other pixels are rounded as before; metadata counts each faced key's pixels, and a key that draws nothing is a warning.
- Scene tilemaps take `sort: "ground"`: each tile joins the sorted placements, standing on the bottom row of its frame, so a row of walls covers a hero walking behind it and a hero in front covers the walls. A tree drawn as one frame taller than its tile stands on its trunk's row, so its canopy covers whoever walks behind it. The depth report lists a sorted tilemap as one item per row of tiles (`{name, ground, tiles}`), and the depth view runs that row's ground line under each tile. Unsorted tilemaps draw as before.
- A scene placement takes `lift`: it is drawn that many pixels above where it stands, and where it stands still orders it, so a hero jumping in front of a barrel stays in front of it. A height hovers; keys of height over time (`{time, height, ease}`, with cue names) make a jump. What is attached to a frame point rises with it; `attach` without a `point` now follows where a placement stands, so a contact shadow stays on the floor under a jump. Placements and the depth report show each lift, and the depth view draws dashes from the ground tick up to a lifted placement.
- A placement attached to a frame point stands on its target's ground line, straight below the point, and is lifted up to it. With `sort: "ground"`, a held sword now sorts with its hero, list order deciding which of the two is in front; before, it sorted by the hand's row, so a barrel the hero stood in front of covered the sword. Its `lift` in placements and the depth report is the point's height above that line, and a light following it without a point sits on that line. Nothing else moves: the diorama's three scenes render the same pixels, lights and depth report at every 50 ms.
- Scenes take `haze`, the colour far planes fade toward, and a placement or tilemap with `haze` from 0 to 1 stands that far into it. After lighting, each colour moves that much of the way to the haze colour as a whole colour, never per pixel, so each becomes exactly one colour and keeps its place among the others, as a far palette an artist mixes does. Haze `colors` keep hazed placements inside a fixed palette: each faded colour becomes the nearest of them. The reply lists each hazed placement with the colours its palette keys became, ready for an asset entry's `palette`.
- Scenes take a `camera`, the scene point at the view's top-left corner, fixed or keyed over time with cue names and easing, and placements and tilemaps take `parallax`, how much of the camera's movement each follows: 1 the scene, 0.5 a far plane, 0 fixed on screen, above 1 a foreground plane, or `[x, y]` per axis. Each plane rounds its share to whole pixels. Attached placements move with their target, lights with the scene or the plane of what they follow, and ground sorting still compares scene positions. Replies give the camera's position; clipping at the view's edges is no longer a warning when a camera is set. The studio's light dragging allows for the camera. Without a camera, scenes draw as before.
- A `box` operation draws an isometric box: a 2:1 top face whose edges run `w` and `d` pixels across, over a left and a right face `h` pixels tall, each with its own colour, and an optional `edge` highlight. Each pixel belongs to the face its centre lies in, so edges step exactly two pixels across per row and boxes on a 2:1 grid meet with no gap or overlap; `h: 0` is a floor diamond. In a sorted layer it stands on its bottom row.
- Tilemaps in scenes and the recipe `tilemap` operation take `layout: "iso"`: cells lie on a 2:1 diamond grid, draw back to front, and each frame or symbol stands on its diamond, so blocks taller than the tile rise above their cells. In a sorted scene, an iso tile stands just above its cell's centre, covering what stands behind it and drawn under whatever stands on top of it with `lift`.
- A scene placement or tilemap takes `shadow: true` and casts a shadow from every scene light that reaches it: its frame, a cutout standing on its ground line and turned to face the light, stops that light on the pixels it falls on, so the shadow takes the light's colour, reach, flicker and keys, overlapping shadows of one light are no darker, and ramp lighting keeps the palette. Shadows fall away from the light, longer the farther the caster stands and the nearer its top comes to the light's height, and only on what is drawn before the caster or its sorted group, so standing things never shadow each other. A lifted caster's shadow leaves its feet, a tilemap casts from each tile, and a light riding a placement casts no shadow of it. Renders report `shadows`: each caster's light, pixels, reach and direction.
- A scene light can be a sun: `{"sun": [1, 0.5]}` falls the same way everywhere, with no position, height, reach or falloff, so outdoor scenes are lit alike from one direction. `sun` is how far a shadow falls across the ground per pixel of height, so it sets both where the sun stands and how high, and placements with `shadow` cast parallel shadows that long; `[0, 0]` is overhead. A sun takes colour, strength, flicker and strength keys, lights normal passes from its direction, and is reported as `{sun, strength}`. The studio lists it as a sun with no marker; its Shadow X and Y sliders set `sun`, and saving writes it into the scene.
- The art workflow's brief asks for a projection and depth planes, and a new [depth and perspective](docs/art-workflow.md#depth-and-perspective) section lists projections with their normal faces, the tool for each depth cue, and how to review depth. The pixel-art skill and quick start point to it.
- A sorted tilemap at `scale` 2 or more stands on the first screen row of its bottom art row, as a placement does, so a tile and a placement on the same row tie and list order decides at any scale. A placement with `shadow` anchored on its top row (the default `[0, 0]`) warns that it casts nothing. Overlapping `repeat` copies of one placement don't cover each other in the depth report. `lift`, and a keyed light's `strength` and `radius`, stay in range when eased with `overshoot` (lift 0–256, strength at least 0, radius at least 1).

### Ground sorting in recipe layers

- A layer with `sort: "ground"` draws its operations far to near by the row each stands on, as scene placements with the same `sort` do: an operation's `ground`, or the lowest row it draws (a stamp's or grid's bottom after scale and rotation, a line's lower end). Trees, grass, rocks and figures in one sorted layer overlap correctly whatever order they are listed in; with a layer per kind, grass drawn after the trees covered the trees standing in front of it. Text needs `ground`, area operations such as `dither` and `fill` are refused in a sorted layer, and `ground` outside one is an error. Layers without `sort` draw as before.

### Studio viewing

- The studio's preview zooms with the scroll wheel at the pointer, pans by dragging, and has − and + buttons, a **Fit** zoom for any canvas, 3×, 6×, 24× and 32×, and keys: + and − zoom, 0 fits and F toggles full screen. **Full screen** fills the window with the preview (and the screen, where the browser allows it); Escape leaves it.
- On a desktop-sized window the studio fits one screen: the page no longer scrolls, the projects, preview and source columns each scroll on their own, and the preview and the recipe editor take the height there is. Narrow or short windows keep the stacked layout.
- Dropdown lists in the studio are dark. On Windows an open list drew the light option text on white, so the zoom and other choices could not be read.

### Exports at the names the user asked for

- MCP `pixel_render` takes `saveAs`, a map from `sheet`, `atlas`, `recipe`, `gif`, `apng` or any exported PNG, GIF or JSON file to a path inside the server root, and writes those files there as well as in the export folder; a GIF named there makes the GIFs. Every path is checked before anything is written (inside the root, links included; not in the revision store; not a hidden name, one starting with `.`, nor in the home folder's `AppData` or `Library`; not a palette or asset file the recipe references, also when it comes back as a revision; a name the file system can take; same file type; not named twice, letter case ignored on Windows and macOS). Each copy is staged in a temporary file first, and a call that fails puts back what it had replaced, so the destinations stay as they were; an existing file is replaced only with `"overwrite": true`, and a JSON file only if it is a recipe, atlas or sequence, so a workspace that is a whole home folder (the desktop bundle's default) can't have a settings file replaced (renamed over, so a hard link to it keeps the old bytes), a saved atlas names the saved sheet (and a sheet name that would read as another name in a URL is refused), and the reply's `saved` lists each copy. Agents left exports in `output/<name>-<id>/` and the user's named file never appeared (P-011).

### MCP: ping and cancellation during a call, and a smaller tool listing

- The MCP server answers `ping` while a tool call runs, and `notifications/cancelled` stops a call: a running one ends its worker (the next call starts a fresh one) and one still waiting is skipped. Neither gets a reply, as the MCP specification asks, and `initialize` can't be cancelled. Everything else is still answered one request at a time, in the order sent. The server used to read nothing while a call ran, so a ping waited up to the call's 50-second limit (clients may drop a server whose ping times out), and a client could not stop a call it no longer wanted. While more than 16 MiB or 256 requests wait, the server pauses reading until the queue shortens.
- The tool listing an agent reads on connect is 15,877 bytes instead of 23,264, roughly 2,000 fewer tokens per session. Tool and option descriptions are shorter, and `pixel_scene`'s `sequence` names `pixel_render`'s options instead of repeating them; the server still rejects an unknown option by name. `pixel_help`'s `guide` topic explains every option, and now also the sequence defaults the listing dropped. The listing was within 1.3 KB of its 24 KB cap, too little room for the next feature's options.

### CI fails only when something is broken

- The test suite and the studio walk no longer assert how long anything takes, so a slow or busy runner can't fail them. They hold the work instead: the renderer's drawing count for the hero and boss rigs, the size of their motion review images, and one redraw for every live edit in the studio. Two checks that guard against a hang (the fluid work budget, wildcard frame names) bound this process's own CPU time.
- The timings moved to `npm run bench -- --budgets`: the figure workflow's targets and a few loose limits, as eleven cases with a budget each. CI runs it as an advisory job; a case over its budget is a warning on the run, never a failure.
- The MCP time-limit test moves a mocked clock, so only the slow call meets the 0.3 s limit. On a real clock the call after it was held to 0.3 s too, and a busy Windows runner once took longer.
- The portable build tries a Node.js runtime download again after a dropped connection, a stall of 30 s or a server error (three tries), and CI keeps the downloaded runtimes in a cache keyed on the pinned version.

### Fixes

- `<command> --help` (and `-h`) prints the help, as the quick start and the standalone skill tell agents to; it used to answer `Unknown option: --help`. `skill install` finishes an install cut short while it was writing a file and clears the temporary file it left, names in `kept` an edited file from an earlier version that `--force` leaves alone (it was listed as overwritten), and lists in `overwrote` what `--force` replaced in a folder it didn't write.
- Scene lighting measures lengths with square roots of sums instead of `Math.hypot`, which engines may round differently, so a lit scene draws the same pixels in the studio's browser as in Node; every example renders as before. A test now keeps engine-dependent maths out of every source module.
- Palette files, scene assets and normals recipes that the MCP server reads, and `pixel_import` paths, must be inside its root once links are followed, not only by name. A symbolic link or Windows junction under the root could lead anywhere, so a `"palette": { "$ref": "link/file.json" }` or an asset read a file outside the folder the user chose. Links that stay inside the root, and a root that is itself a link, work as before (`saveAs` already checked links). A name that only starts with two dots, such as `..notes.json`, is no longer taken for one outside the root.

- A forced export (`render --force`) into a folder another sprite was exported to no longer deletes that sprite's frames and animations. It removed every PNG in `frames/` and `animations/` that it didn't write itself, so re-exporting `coin` beside `ember` deleted ember's frames and any PNG added there by hand. It now removes only the frames and animations its own earlier `<name>.atlas.json` lists, never one another atlas in the folder lists, and nothing when an atlas there can't be read.
- A pose whose two-bone `reach` target is out of range says so in the `warnings` of MCP `pixel_compile` and `pixel_inspect` and the CLI's `compile` and `inspect`. The warning was only in the compile metadata, so `pixel_compile` without `metadata: true`, `pixel_inspect` and `inspect` of a pose source, and `compile --metadata <file>` answered with no warnings and a clamped pose. `compilePoses` now also returns the warnings as text beside the recipe, as the other compilers do, and the studio's status line shows them.
- The MCP server reads an object or list argument sent as JSON text, such as a `project` recipe passed as a string, and its reply ends with a note that says so; text that isn't JSON of the declared type gets an error naming the argument and what to send instead. Agents that call a tool without loading its schema sometimes send the recipe as a string, and the bare `project: expected an object` cost them a turn each time; one went back to drawing in its own script (P-041). The plugin's eval mock no longer names a version (it said 0.9.0 in 0.9.1), and its tool list and source formats match the server again, wave effects and the `saveAs` wording included.
- A keyed fluid obstacle that moves more pixels a frame than it is thick pushes water and smoke ahead of it instead of passing through. Only the cells it landed on were cleared, not those it passed over, so a 1-pixel plunger at 5 pixels a frame left about a fifth of the water behind it. Obstacles that move no faster than they are thick behave as before; every example and preset renders unchanged.
- Animated PNGs give frames of 10 ms or less 11 ms, and the render warns which. Browsers play such short animation frames at 100 ms, so a 5 ms flash flickered ten times too slowly; the atlas, CSS and Canvas player keep the exact durations.
- A PNG carries an embedded recipe only up to 1 MiB, the most Pillow opens: `--embed-recipe` and `embedRecipe` refuse a larger one with an error naming the size, and the playground writes such a PNG without its recipe and says so. Up to 16 MiB used to be embedded, which made PNGs Pillow (and the Python tools built on it) could not open.
- An accent on the first line of rotated or vertically flipped `text` no longer moves the letters. The accent rows always moved the block up, even where the transform put them below or beside the letters, so CAFE and CAFÉ landed 2 × scale pixels apart; centred and right-aligned rotated text also measured the accents. Unrotated, unflipped text is unchanged.
- A GIF whose first frame is fully opaque keeps its later transparent pixels clear in Pillow too. Pillow decodes every later frame with or without alpha by whether the first frame names a transparent colour, so those pixels came out opaque black there (browsers and ffmpeg showed them clear); the first frame now names one whenever the animation has transparency.
- The MCP server answers a tool call whose arguments nest more than 128 levels deep with an error and keeps serving. A request of about 12 KB nested thousands deep used to overflow the stack while it was handed to the tool worker, and the server exited.
- Where letter case is ignored (by default on Windows and macOS), a `--force` export after renaming a frame, animation or recipe only in letter case (`Run` to `run`) writes the files under their new names. It used to write into the old `Run.png`, then delete it as a leftover, and report success with the frame missing; a shorter sequence also left the old spelling's extra frames behind.
- No CLI command writes over a file it reads, even with `--force`. `compile`, `autotile`, `overlay`, `import`, `inspect` and `gif` used to replace their own source or a shared palette when `--out` named it (`compile x.poses.json --out x.poses.json --force` left a compiled recipe and no source); `patch` may still save over the recipe it edits. Exports compare paths on disk, so a folder link, a short 8.3 name or a hard link to the recipe no longer gets past the check `render`, `scene` and `sequence` already had, and `--out` and `--metadata` that differ only in letter case are refused on macOS as on Windows.
- Tilemap variants without a `seed` are picked by a seeded hash of the cell, like the rest. Two variants used to come out as a checkerboard and four as a 4×4 repeat, the very tiling variants exist to hide. Maps with variants and no `seed` render differently from 0.9.1; maps with a `seed`, and legend entries that name one frame, are unchanged.
- The browser playground asks before a link opened in the same tab (pasted into the address bar, or reached with Back or Forward) or an opened file replaces edits nobody has kept, and declining puts the address back. While there are such edits, leaving or reloading the page asks too. A link used to replace them silently, and reloading reopened the link over them.
- The playground shows a link's, PNG's or example's recipe indented only up to 50,000 lines, and compact beyond. A 6 KB link whose recipe unpacked to 2.4 million indented lines froze the page for 20 seconds and each key for about 6; it now opens in about a third of a second.
- Each studio tab keeps its own draft. Loading a sample or choosing New, Open or Save JSON in one tab used to delete the draft of another tab's unsaved edits, and editing in a second tab replaced it. A reload finds the tab's draft again, and a new tab is offered the drafts of tabs that were closed or crashed, never those of tabs still open.
- The scene page's **Save scene settings** writes the scene as written, with only the light fields you changed. It used to write the scene with every asset and palette file read in: `forest-spirit-lit.scene.json`, under 500 bytes naming `forest-spirit.json` and its normal pass, came back as 17 KB of inline recipes under the same name, and the links to those files were gone. The studio serves the scene as written beside the resolved one, read-only.
- The scene page's Radius slider changes a keyed light's preview. Its keys had copied the light's radius when the scene loaded, so the slider changed nothing on screen while the saved scene, opened again, drew the new radius; now the keys that set no radius of their own follow the slider, and when every key sets one the slider is off.
- The studio's **Save JSON** keeps a recipe's link to a shared palette file. `pixelbolt preview` sent the studio the recipe with `"palette": { "$ref": "shared.json" }` already read in, so Save JSON wrote the file's colours inline and the link was gone. The editor now holds the recipe as written, and the page draws it with that one file, served read-only; a recipe that links any other file is not drawn, and the error says why. Pose sources keep their link too, and effect, fluid and autotile sources open as the recipe `pixelbolt compile` writes beside them, link included.
- The studio's **Save JSON** no longer deletes the draft or says the file was saved. The page cannot tell whether the browser kept the file or the user cancelled its save dialog, and in that case the draft was gone, the toast still said "Project JSON saved" and leaving the page no longer asked. The draft now stays until you edit again or replace the recipe, leaving still asks, and replacing a recipe just sent to Save JSON says the save may have been cancelled.

## 0.9.1 (2026-10-25)

### Releases wait for every test and keep publish rights away from third-party tools

- **Release** runs the whole Tests matrix on the tagged commit (Node 20, 22 and 24, Windows, macOS, the portable builds, the MCPB bundle) and publishes nothing unless all of it passes. It used to run the suite once, on Linux with Node 24.
- `npx @anthropic-ai/mcpb validate` and the other checks now run in a job that can only read. The job that attests and publishes the GitHub release rebuilds the bundle itself and refuses unless it matches the verified one byte for byte, so a compromised validation tool can stop a release but not change what is attested. The npm job runs only `npm publish`; trying the published package with `npx` moved to a job without rights. See the table in [Publishing](docs/PUBLISHING.md).

### MCP calls have time and memory limits

- Every MCP tool call runs in a worker thread. A call that takes longer than 50 seconds, or runs out of memory, is stopped and answered with an error naming the limit, and the server keeps serving; before, one call could hold the server for many minutes or crash it. `pixelbolt mcp --time-limit <seconds>` changes the time limit.
- Child particle emitters that multiply within one frame fail at the 1,024-particle limit as soon as they reach it. A four-level `when: "life"` chain used to build millions of particles first and crash the process out of memory.
- `*` and `?` frame patterns in `inspect` match in time proportional to the pattern and name. The regular expression they used could take minutes on a pattern of 18 characters.
- An MCP `sequence` may come to at most 512 MB, the studio's limit; `pixelbolt sequence` writes longer shots. One call used to write 18,000 4K frames, about 660 MB, without a question.
- `pixel_help` with an unknown topic names the topics instead of failing with a file path.

### Fixes: scene repeats, forced re-exports, exports over their own recipe

- A scene placement's `repeat` draws every copy again. Since 2026-10-07 only placements with `sort: "ground"` did; the others drew one copy and dropped the rest (the Listening Hollow's stride scene lost five ground tiles).
- `--force` over an earlier export of the same recipe or sequence no longer leaves its old files behind: a shorter `sequence` used to keep the longer one's later frames, which video editors and `gif-frames` then picked up, and a renamed frame or animation kept its old PNG. A forced export now removes them after writing and lists them as `removed`. It only does so when the folder holds that export's own `sequence.json` or `<name>.atlas.json`, and only for numbered frames of that name or PNGs in `frames/` and `animations/`; nothing else in the folder is touched.
- `render`, `scene` and `sequence` refuse to write over their own recipe or a palette or asset file it references, even with `--force`. `render hero.json --out . --force` used to replace `hero.json` with its inlined copy, losing a palette `$ref`.

### Five fluid presets for the newer features

- `examples/` gains five presets, each with a GIF in the README and a place in the Fluid lab: **snow off a roof** (wet snow slides off a smooth roof as one slab and settles in a drift), **dam break** (a plank dam that an obstacle key takes away at frame 14), **dust wave** (a falling stone throws carried dust both ways), **bursting slime** (a burst fill) and **honey let-go** (keys thin stiff honey so it drops off a smooth spoon, then thicken it so the bowl settles). The playground lists them from the next release.
- The Fluid lab's Thickness slider reaches 64, the compiler's limit for viscosity, so the honey let-go shows its own value.
- The stuck-fill warning no longer fires for a liquid with `adhesion`, which is meant to cling.

### Fluid obstacles that move on cue

- `keys` on a fluid obstacle move it (`x`, `y`, in a straight line `over` some frames) or take it away and bring it back (`show`) from a chosen frame: a dam that vanishes, a gate that lifts, a plunger, a paddle through smoke. While a key's `over` runs, the obstacle pushes the fluid ahead of it, since its faces carry its speed along the ramp, and fluid in the cells it now covers is shoved along to the first open cell, never through another solid. A key with no `over` is a cut: the obstacle is simply elsewhere and pushes nothing. Water held by a wall that vanishes at frame 15 stays put until then and floods after; a plunger moving 36 pixels carries the water's middle from x 18 to x 55 and keeps 1,277 of its 1,280 particles. Each frame stamps the obstacle at its place, and live runners move it too. Obstacles without keys are unchanged.

### Renders check themselves

- `pixel_render` and `pixelbolt render` report a `check` of what they wrote: each frame's pixel size, every animation's frames and loop, the colours used, transparency and the GIF size. Give them what the user asked for (`expect` over MCP, `--expect` on the CLI: `width`, `height`, `frames`, `colors`, `transparent`, `loop`, and over MCP `gifScale` for the GIFs) and `check.problems` names every file that misses it, with the patch or render call that fixes it; fully transparent frames are noted either way. Agents mostly exported their first try; this puts the check in the path. The tool descriptions, quick start and skill now say to work in that loop.

### Fluid figures per frame, to tune by numbers

- Each fluid effect's metadata now has `figures`, one list per figure with an entry per frame: `box` (the fluid's drawn pixels, sparks left out), `middle` (the middle of its density), `amount` (smoke, or cells' worth of water), `pieces` (separate pieces drawn), `speed` (top speed where drawn) and, for liquids, `particles`. Agents had to write scripts to measure a heap's height, a cloud's spread or how many pieces a splash broke into; one compile now says. Live runners give the same figures for the current frame with `live.measure()`. Recipes are unchanged.

### The caption example spells Pixelbolt

- `examples/caption.json`, the studio's Caption sample, types PIXELBOLT (PIX, PIXELB, PIXELBOLT) instead of the old name.

### Liquids that hold, then let go, on cue

- `keys` on a liquid change its `yield`, `viscosity`, `adhesion` or `gravity` from a chosen frame, at once or in a straight line `over` some frames, so the decisive moment lands where you want it. A heap held up by `yield: 4` stands 21 pixels high until `{ frame: 40, yield: 0.3 }`, then slumps to 12 pixels by frame 50; `{ frame: 30, adhesion: 0 }` drops a film that adhesion held under a ledge. Each setting follows the keys that name it, in frame order, and a key that starts during another's ramp carries on from where it had got to; a loop repeats them every cycle, a live runner follows them too, and whitewater without its own gravity follows the keyed gravity. Liquids without keys are unchanged.

### Thrown dust: gas carried on heavy carriers

- A gas emitter with `carry: { drag, release, gravity }` throws its smoke and heat on carriers, one per covered cell, launched with its velocity, vortex, outward expand and noise. Each carrier slows toward the air's velocity by `drag` a frame, hands `release` of what it holds to the air a frame, falls by its own `gravity`, and drops the rest where it meets an obstacle or a closed edge (so dust settles on a closed floor); what it holds is drawn with the smoke. A carrying emitter needs a positive density or temperature, and an orbiting one throws once a frame. A puff of gas can't be thrown through still air (the pressure solve halves its speed at once), but dust is grains: two bursts thrown sideways at 8 pixels a frame now roll out about 90 pixels across in six frames, against about 26 without `carry`. At most 8,192 carriers are in the air at once.

### Liquid bursts in mid-air

- A liquid fill with `burst: { speed, pieces }` breaks into seeded pieces with a one-pixel gap between them, each flying straight out from the fill's middle at its own speed (a number, or `[min, max]` picked per piece) plus the fill's `velocity`. An outward velocity on one connected blob is cancelled by the pressure solve, since a liquid can't expand; separate pieces moving as one each keep theirs. The gaps' water goes to the pieces (to the nearest kept piece when a piece is all gap), so every particle is kept, however small the fill. A ball of radius 8 bursting at 2.5 pixels a frame is in six or more pieces, three times as wide, eight frames later.

### Fluid decorations the simulation ignores

- A fluid obstacle with `solid: false` is a decoration: it is stamped over or under the fluid as `draw` says, but the fluid never meets it. A basketball net, a candle flame, a label or a background no longer has to be a solid the water slides along, or painted on after `render()`. A decoration can't use `draw: "none"` or `surface`.

### Fluid warnings for setups that make nothing or start stuck

- `compileFluid` returns `warnings` (and each effect's metadata lists its own) when an emitter lies inside obstacles or off the canvas on every frame it works, so it adds no fluid, and when a liquid fill starts against the underside of a pixel obstacle or a closed edge with open space below it, where the pressure holds it on. Each warning names the field and says what to change. `pixel_compile` adds them to its reply's `warnings`, `pixelbolt compile` prints them, and live runners list them in `live.warnings`. A fill resting on something, including another fill's water, or thrown away from what is above it, is not warned about; nor is an orbiting emitter that clears the obstacle between frames. No preset sets one off, and recipes are unchanged.

### Smooth obstacles: liquids slide down drawn slopes

- A fluid obstacle with `surface: "smooth"` meets the fluid along an outline traced through its pixel steps, so a drawn 45° roof acts as a straight slope instead of a staircase. Wet snow and slime with `slip` slide off a smooth roof where they stalled for good on the stepped one, and slime pressed against the underside of a smooth branch falls away instead of hanging from it. Faces along the outline are partly open to the pressure and viscosity solves, particles slide along the outline, and a smooth obstacle pushes on a liquid but never pulls it (`adhesion` still holds liquid on). Nothing passes through it, however fast, even where it is one pixel thick.
- The obstacle is drawn exactly as before. Pixel obstacles stay the default and behave exactly as before: every preset compiles to the same recipe.

### A playground in the browser

- `playground/` is a page for the project site where anyone can try Pixelbolt with nothing installed: pick one of 20 examples (ten fluids, particle effects, poses, a normal pass and a lit scene) or paste a recipe, see it render live, and download a PNG, a GIF (its size shown first) or an atlas. Renders run in a worker with a 20-second limit and a Cancel button.
- **Share links:** Copy link puts the compressed recipe in the link's fragment, which browsers never send to a server, with the engine version, so a link renders the same after later releases. Links are capped at 16,384 characters; larger recipes travel as files.
- **PNGs that reopen:** every PNG the playground exports carries its recipe in a `pixelbolt-recipe` text chunk; drop it back in to reopen it. `src/share.js` reads and writes both formats.
- The page is live at <https://skulitom.github.io/Pixelbolt/playground/>; `playground/DEPLOY.md` and `node scripts/deploy-playground.mjs` prepare each site change.

### Fluid lab sliders that hold every preset

- The Fluid lab's Firmness slider now reaches 16, the compiler's limit for `yield`, so it shows and restores the slime preset's own firmness instead of stopping at 8. The Fade slider moves in steps of 0.0025, so the explosion's 0.1375 shows exactly instead of snapping to 0.14. No preset changed.
- The lab's presets and sliders live in `studio/fluid-controls.js`, and a test checks that every shipped fluid preset fits its sliders exactly and comes back unchanged.

### Recipes to reopen and share

- Opt-in `pixelbolt share` prints a playground link, `render` and `scene` accept `--embed-recipe` to carry the resolved source inside PNGs, and `import --embedded` recovers it. MCP `pixel_render` accepts `share` and `embedRecipe`; a link over the limit reports an error without failing the render. Both formats carry the engine version; links keep the recipe in the URL fragment and open once the playground is live on the project site. With the options off, exports and replies are unchanged.

### GIFs at the size you drew

- GIFs now keep the frames' own size unless you ask for more: `pixelbolt gif`, MCP `pixel_render`'s `gif` and `animationGIF` default to scale 1. They used to enlarge to the largest whole multiple within 256 pixels, so a 32x32 animation came out 256x256 and agents handed that on when 32x32 was asked for. Pass `scale` (`--scale` on the CLI) to enlarge one for posting; the studio's **GIF** button still uses the current zoom.

### Older art out of sight

- The Emberfall and Tidewatch demos and the Listening Hollow study (with its lantern skink) no longer represent what Pixelbolt makes, so they are gone from the README, llms.txt, the guides, the skill and the portable build's START HERE. Their folders stay, marked as archived, because tests use them as fixtures.
- The studio no longer opens on the skink: the forest spirit is its first sample, and the "Light a scene" page shows the lit forest-spirit example (`examples/forest-spirit-lit.scene.json`) instead of the Hollow.
- The diorama's night scene takes their place in the README: torches and candles that flicker and a flash on the strike.

### Scene lights that move

- **`follow`:** a light rides a uniquely named placement, or with `point` a named point of its current frame (a torch flame, a blade tip), with `at` as the offset. It moves with trajectories, animations and attachments, and is off while the placement is hidden or its frame lacks the point.
- **`flicker`:** `{ amount, every, seed }` swings a light's strength by up to `amount` either way and its reach by up to half as much, along seeded noise that repeats once per scene duration, so looping scenes have no seam. On average it is as bright as a steady light.
- **`keys` and `strength`:** strength (0–8) and radius over time, at milliseconds or cue times such as `"strike+90"`, eased between keys. Above 1, ramp lighting lifts colours past their authored shade, so a flash on a hit reads.
- **`lit: false`** on a placement keeps its authored colours under lighting, for fires, lamps and glows.
- Renders, `pixel_scene` and the studio's scene viewer report where each light is at the current time; the viewer's markers follow moving lights, and dragging a following light moves its offset. Scenes without the new fields render exactly as before.

### Less for agents to read

- The MCP tool listing is about 20 KB instead of 133 KB (roughly 5,000 tokens instead of 36,000 on every connect): `pixel_validate`, `pixel_inspect`, `pixel_patch` and `pixel_render` describe `project` briefly instead of embedding the recipe's 30 KB JSON Schema four times. The server still checks every recipe and names the path of any mistake.
- `pixel_help` without a topic returns a 7 KB quick start ([docs/agent-quick-start.md](docs/agent-quick-start.md)): the recipe format with a complete example, the operations, the tools and working habits. It used to return the whole authoring guide, art workflow, schema and example, 142 KB or about 38,000 tokens. Those are now topics: `guide`, `workflow`, `schema` and `example`, beside the source format schemas.
- The examples use the same compact formatting as compiled files (anything that fits in 120 columns on one line, grids one row per line): 362 KB instead of 664 KB for the same data.

### Particle effects with structure

- **Spawn shapes:** a `ring` (radius or `[min, max]`, an optional `arc`) or a `line` instead of the `area` box, with `even: true` to space the particles spawned together evenly. On an `outward` ring, `angle` is measured from each particle's outward direction, so an even ring makes a shockwave and an arc a fan of sparks.
- **`face: true`** picks the sequence by direction of travel (2–16 sequences, the first facing right, turning clockwise), so sparks draw as streaks along their arc. **`tint`** lists colour stages over each life, so a spark cools from white to red without a symbol per colour.
- **Child emitters:** `from` names an earlier emitter, and `when` spawns from its particles where they end (`death`), first land (`floor`) or every frame they live (`life`: trails), with `inherit` for a share of the parent's velocity. Loops stay seamless: children are keyed by their parent and the warm-up covers the longest chain of lives. **`behind: true`** draws an emitter under the others.
- **Timing and cues:** `duration: { "from", "to", "ease" }` eases frame durations across an effect (`in` front-loads an impact). `cue` names a point at an emitter's spawn centre in every frame it spawns; frames carry it as a named point, atlases export it and the metadata lists it, so game code can shake or pause on the hit.
- Every existing source compiles to the same recipe as before: the new draws use their own salts, and the Tidewatch effects and the examples are unchanged.

### Torch preset

- The torch's flame no longer burns beside the handle under its metal cup. Its emitter was a radius-4 disc centred inside the cup, so its rim heated the empty pixels beside the narrower handle in every frame (76 pixels over the loop). It now sits 1.5 pixels higher with radius 3.5, which keeps about the same amount of flame and the tall tongues. Its golden and live hashes and README GIF are updated.

### Figures in motion

- Bone and mass parts rasterize from structure under palette ramp lighting, with clean thin strokes, socket joints and area-preserving squash. Grid parts keep authored views for detailed hands, heads and props.
- Relative joint angles, attachment dependency resolution, deterministic two-bone reach, angle/reach tweens, relit mirrors and joint metadata extend version-1 pose sources without changing existing recipes.
- Six motion templates generate editable key poses and in-betweens with foot targets, contacts, depth swaps and attack cues. `compile --expand` exposes them; authored poses override generated names.
- CLI/MCP motion inspection measures foot slide, ground error, pose spread and loop seams. The studio edits pose sources directly and adds Motion and Show contacts controls.
- Pinned figure hashes, performance fixtures, browser checks and independent PNG/GIF verification cover the workflow. Existing example pixels remain unchanged.
- Walk and run keep near limbs, and anything they hold, in front of the body for the whole cycle; `swapDepth: true` restores the exchange for front or back views. Before, a darker far arm and leg were drawn in front for half of every cycle.
- Relit mirrors are exact: bone ends, spines and points round halves away from zero, and the direction of −θ is the bit-exact reflection of θ. Before, 352 of 11,520 bone ends and 2,156 spines missed by a pixel.
- Templates sink a motion's poses together, by up to four pixels, when a bob or lean would lift a hip beyond its planted leg, so feet neither float nor slide. Attack follow-through swings 45° past the strike. Every template at its defaults now passes its own motion checks on a plain 32×32 humanoid.
- Motion review: contact A/B poses with joint angles also pass when a joint turns 20° or more (side-view contact poses can share most pixels), and a joint's loop seam may be as large as its paired limb's largest jump.
- Masses are cached like bones, and drawing structural parts has an 8,388,608-pixel budget per compile. A source that took 14 s now fails in about a quarter of a second with a path.

### Pose rendering performance

- Named part layers blend and consume the drawing budget only within their drawn bounds. Layers share one cleared scratch buffer per frame, so sparse rigs no longer scan and allocate a canvas for every part.
- Pose compilation builds timing metadata and validates stamp output without rendering every frame. Existing recipes, marker times, mirrors and trimmed atlas validation retain their behavior.
- `node scripts/bench-poses.mjs` records repeatable stamp-rig timings; `renderProject(recipe, { stats: true })` includes drawing work counters. The pre-change corpus is pinned by 861 RGBA frame hashes and pose metadata checks.

### Thick fluids

- **`viscosity`** (gases and liquids, 0–64 square pixels per frame): an implicit viscosity solve in stress form (after Batty and Bridson, 2008), with Jacobi-preconditioned conjugate gradients and a stress-free surface. It slows shearing and stretching, never motion as a whole, so a drop of honey falls exactly as fast as a drop of water, a stream stays one unbroken rope, and a heap spreads slowly instead of splashing. Walls and obstacles hold a viscous fluid; **`slip: true`** lets it slide along them. In a viscous liquid, the pressure solve runs again after the viscosity solve, so a heap does not slump a step at a time, and the particles' own jitter fades with the thickness (the FLIP share falls where the liquid is thick).
- **`yield`** (liquids, 0–16): a yield stress for mud, slime, dough and toothpaste, after Goktekin, Bargteil and O'Brien (2004). Each particle carries an elastic strain, turned with the flow and capped at the yield; the elastic stress is split as implicit elasticity is, so it is stable at any timestep. Below the yield a blob squashes where it lands and springs back, and a heap keeps its shape (a heap *h* pixels high holds when the yield is more than about gravity × *h* / 2); past it, the liquid flows.
- **`apic: true`** (liquids): affine particle-in-cell transfers, so the calm share of each particle's velocity keeps the turning and shearing of the flow around it. A spinning blob of syrup keeps about three times as much spin as with plain PIC.
- **`adhesion`** (liquids, 0–4): liquid touching a wall or obstacle stays on it unless pulled away faster than about `adhesion` ÷ 2 pixels per frame, so a film clings under a ledge or to a spoon.
- **`advection: "sharp"`** (gases): MacCormack advection with the limiter of Selle et al. (2008). A puff carried by the wind keeps more than twice as many dense pixels after 30 frames, with no new peaks, at up to twice the cost.
- **`drag`** is documented as resistance from the surroundings, which slows falling too; thickness is `viscosity`.
- **Two presets:** [honey](examples/honey.fluid.json), a glossy rope of honey from a dipper folding into a mound on a calm surface in a jar (viscosity, APIC, adhesion), and [slime](examples/slime.fluid.json), a blob that squashes flat, springs up tall, wobbles and settles into a dome that holds its shape (yield stress). Both have golden hashes and README GIFs. Their final look was chosen in blind A/B reviews of several variants each.
- **Fluid lab:** the two presets, and Thickness (viscosity) and Firmness (yield) sliders for liquids beside Liveliness (flip); the drag slider is now Resistance (drag).
- **Work budget:** a viscous or yield-stress effect counts about three times the cell updates per step, and sharp advection about thirty more per cell, so expensive sources are still refused before they run.
- Every new setting is off by default, so these settings leave existing sources as they were.

### Fluid fixes

- **Nothing passes through thin obstacles any more.** Sparks (and so whitewater spray) moved their whole step at once and were only checked where they landed, so anything faster than a pixel a frame could skip a wall one pixel thick; fast liquid particles could too. Both now walk every cell along their path and stop at the first solid one, which also stops them slipping between two pixels that touch only at their corners. This changes the waterfall (the water now leaves the lip in a free arc instead of creeping down the stepped cliff face around its corners), and the drip and potion slightly; their golden hashes, GIFs and the potion's live-session hash are updated.
- **Water no longer shows through a thin wall.** The blur that turns liquid particles into a surface also read what particles beside a wall had splatted into its cells, so a pool resting against a wall one pixel thick drew faint water down its far side at low look thresholds or with heavy dither. What lands in an obstacle cell now counts only for cells that hold water themselves, so it still shapes the water's own edge; every preset is unchanged apart from three shading pixels in honey and slime.
- **Liquid particles keep to the speed cap.** Cohesion was added after the cap, so at extreme settings a particle could reach 48 pixels a frame; the cap now comes last.
- **Docs:** sharp advection blurs less smoke away, so a one-shot gas needs more `dissipation` to end empty.
- **Depth bands under overhangs.** Liquid whose column starts right under a wall or obstacle took its depth from there, so water under an overhang showed a surface highlight deep in the pool (a pale block in the waterfall's basin). It now takes the depth of the nearest open water along the row; a drop hanging under a rock, with no open water beside it, keeps its own highlight.
- **Waterfall polished** for the corrected collisions, after blind reviews of a cliff-hugging curtain against an arc: the water now leaves the lip in one unbroken, foaming arc into the middle of the basin, and the spray rises where it actually lands instead of over calm water.

### Particle effects

- An emitter's vertical `sway` no longer draws a particle resting on its `floor` below it.

### Export fixes

- **GIF holes stay clear outside browsers.** A frame that is cleared after it is shown (because the next one is transparent where it is not) named no transparent index when it had no transparent pixels of its own, such as an opaque first frame. Browsers clear it anyway, but Pillow, and ffmpeg with a shared colour table, restore the background colour, so the next frame's holes showed opaque black. Such a frame now names the transparent index, or a spare entry of its own table; a frame that uses all 256 entries of its own table has none to spare, and the GIF's `notes` say so. The tests' own GIF decoder now reads disposal the strict way, which also caught this in two existing tests.
- **H.264 keeps every colour.** The `h264` command used 4:2:0, which stores colour once for each 2 × 2 pixels: at an odd scale or offset the colours of neighbouring sprite pixels mixed even in ffmpeg's own decoder, and at any scale once a player interpolates the colour (bicubic: up to 34% of sprite pixels off the palette). It is now lossless 4:4:4 (`-qp 0 -pix_fmt yuv444p`), exact to within 1 level and no larger for pixel art, and works on canvases of odd size. QuickTime, Safari and Windows' own players may not play 4:4:4, so on an even canvas `h264Compatible` keeps the previous 4:2:0 command, writing `<name>-yuv420.mp4`. `scripts/verify-exports.py` checks the new command with ffmpeg at an odd scale.
- **`drawFrame` snaps to whole pixels.** Fractional positions drew a frame between pixels, and Chromium blended its edges into semi-transparent pixels even with smoothing off. The bundled runtime now rounds the position first.

### Claude Code plugin

- **Install in one command:** `claude plugin install pixelbolt --marketplace skulitom/Pixelbolt` (Claude Code 2.1.292 or later) installs the MCP server and the pixel art skill. The plugin (`.claude-plugin/`) runs the checkout's own `bin/pixelbolt.js` with the user's Node.js 20 or later, in the project folder Claude Code has open, so there is nothing to download or build.
- **MCP:** every tool now has a `title` annotation, and `pixel_help` also declares `destructiveHint`, `idempotentHint` and `openWorldHint`. The server's `instructions` begin with when to use Pixelbolt and when not (photos, vector logos, full-resolution illustrations), and say it runs locally with no account and no API key. Tool names, inputs and outputs are unchanged.
- **Skill:** `skills/pixel-art` describes itself in the words a user would use, and says what to do when the plugin's tools are missing.
- **Evals:** `evals/` holds a `claude plugin eval` suite: three requests that should choose Pixelbolt and one (a vector logo) that must not, with every tool mocked from the real `tools/list`.

### Live fluids

- **`createLiveFluid(source, { effect, warmup })`** in `src/fluid.js`, exported from the package and from `pixelbolt/fluid`, runs one effect of a fluid source live, a frame at a time, for interactive pages:
  - `step(n)` advances it;
  - `push` stirs the flow with a soft disc, and `puff` adds or takes away smoke, heat or water;
  - `boost` scales a named emitter for some frames;
  - `render()` returns `{ rgba, keys }`, drawn with the effect's own look, sparks, whitewater and obstacles.
- It shares the compiler's simulation and makes the same checks as `compileFluid` before simulating, with the same error paths. Pointer inputs out of range are clamped rather than refused, and live runs don't stop at the particle or spark limits. The same calls give the same pixels in Node, Chromium, Firefox and WebKit, and golden hashes of two scripted sessions check that on every CI system. A 128 × 60 steam plume steps in about 7–9 ms on a desktop CPU.
- `compileFluid`'s output is unchanged: its golden hashes and the showcase GIFs are byte-identical.
- **Docs:** [live fluids](docs/art-workflow.md#live-fluids) in the art workflow guide, with a note in the authoring guide.

### Pixelbolt Studio

- The portable Studio no longer ships `AGENTS.md` or `llms.txt`. Both are written for contributors working in a checkout, and a user's coding agent in the Studio folder would read `AGENTS.md`'s maintainer rules as its own. The npm package still ships them, and README links to both on GitHub.

## 0.9.0 (2026-10-18)

### Fluid effects

- **A new source format, `pixelforge-fluid`** ([fluid.schema.json](fluid.schema.json)), compiled by `src/fluid.js` (`compileFluid`). It runs a small fluid simulation and bakes every frame into one palette `grid` operation plus `stamp`s for obstacles. The result is an ordinary recipe, so it inspects, patches, overlays and exports unchanged, and a colour outside the palette cannot appear. The grid has one cell per canvas pixel, up to 128 × 128.
- **Gases** (smoke, fire, steam, explosions, magic) use stable fluids on a staggered grid:
  - semi-Lagrangian advection and a fixed-iteration pressure solve;
  - vorticity confinement, and buoyancy from temperature;
  - dissipation, cooling, drag and wind.
- **Liquids** (splashes, waterfalls, drips, potions) use FLIP particles on the same grid and pressure solve, with gravity, cohesion (`tension`), fills, drains and closed walls.
- **Obstacles** come from symbols, drawn in front of the fluid, behind it, or not at all.
- **Emitters** are discs or boxes:
  - a `burst` once, or a `rate` until `end` that holds its cells at the given amounts;
  - `velocity` (an explicit `[0, 0]` holds water still), `vortex` and `expand` (gas expands through the pressure solve);
  - seeded `noise` and per-cell `flicker`, a `pulse` and an `orbit`.
- **Emitters:** `falloff` makes an emitter's amounts fall off from its centre toward its rim, so one emitter makes a round puff (the smoke puff now needs 5 emitters instead of 15). An orbit's `radius` may be `[x, y]` for an ellipse, so what it leaves behind stretches and squeezes as it turns. An orbiting rate emitter is laid along the path it covered since the last frame, so a fast orbit leaves a smooth trail instead of beads; this changes the output of orbiting emitters.
- **Sparks** are small particles carried by the flow and drawn over it: embers, debris, sparkles, spray that ends where it falls back into the water, and bubbles that burst at the surface in a ring and two droplets. Each has its own colours, `size` and an optional `trail`.
- **Whitewater** (`whitewater` on liquid effects): spray and foam thrown off the water by its own motion, where a particle at the surface changes speed sharply (`impact`: a drop landing) or moves fast (`speed`: a stream shedding drops). Droplets are sparks tipped away from the water; spray is drawn once it has left the water, and foam rides the flow. The splash now throws its crown this way instead of from emitters timed to the impact, and the waterfall froths with foam that rides its surface.
- **Look layers** map a field onto palette colours through rising thresholds and an ordered dither anchored to the canvas. The fields are `density`, `temperature`, `speed`, `depth` (from the liquid surface), and `light` and `shadow` (rims facing toward or away from a light). De-Stray and De-Corner cleanup and a one-pixel outline are optional.
- **Depth bands stay level:** below a liquid's first two rows, `depth` follows the shallowest surface within three pixels along the row, so a landing drop or a rising crest no longer pushes a dark column down through the bands beneath it.
- **Seamless loops:** forcing repeats every cycle. The simulation warms up for whole cycles and blends the fields (not the pixels) of its closing frames toward the frames before frame 0. Sparks that outlive the cycle wrap round. The inspector's loop-boundary check is quiet on every looping example.
- **Deterministic:** only `+ − × ÷` and square roots, `craft.js` trigonometry and seeded hashing, a fixed timestep and fixed iteration counts. Golden hashes check the ten presets on every CI system, and the browser produces the same recipes as Node.
- **Everywhere:**
  - `pixelbolt compile`, `preview` and `sequence` accept fluid sources;
  - MCP `pixel_compile` compiles them and `pixel_help` serves `topic: "fluid"`;
  - `compileFluid` is exported from the package and from `pixelbolt/fluid`.
- **Ten presets** in `examples/*.fluid.json`: campfire, smoke puff, explosion, steam vent, magic swirl, torch, splash, waterfall, drip and bubbling potion. Each compiles in well under a second (0.02–0.32 s on a laptop CPU). The README shows them as GIFs, built with `node showcase/fluid/build.mjs`.
- **Presets polished** after an independent art review: the splash drop falls with weight and its crater springs back, the drip speeds up as it falls, the waterfall runs as a shallow stream over the brink with a steady overflow, the potion's surface rocks, explosion debris leaves from the rim and its smoke thins away, steam puffs roll into rounded caps and fade before the top edge, and the magic swirl's eye no longer strobes.
- **Bounded:**
  - at most 32,768 liquid particles and 4,096 sparks alive at once;
  - flows no faster than 32 pixels per frame;
  - a work budget of about 400 million cell updates per source.

  Going over the particle, spark or work limit is an error naming the effect; the speed cap only clamps.
- **Fluid lab:** a studio page (`/fluid.html`) that compiles a preset in the browser, with sliders. It downloads the GIF, the sprite sheet, the recipe and the edited source, and shows the matching command-line and MCP calls.
- **Docs:** a "Fluid effects" section in [docs/art-workflow.md](docs/art-workflow.md#fluid-effects), with notes in the authoring guide, the pixel-art skill, the README and `llms.txt`.
