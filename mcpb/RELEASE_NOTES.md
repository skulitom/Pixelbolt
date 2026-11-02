# 0.11.0

Liquids that freeze, boil and carry lightning, air pockets and bubbles, sticky and elastic liquids, plasma arcs; tile sets drawn from a terrain description, with corners, transitions, slopes and Tiled exports; a spell library and a much larger effects toolkit; presets to compile instead of drawing.

- **Ice, steam and frost:** a liquid's `heat` gives water a temperature on one scale with the gases: it freezes in from its shore, melts after a latent plateau, boils into steam (`vapour`) that rises and beads back as dew on anything cold, grows fern-like frost on cold panes and sublimates, and every frame's figures keep the water, ice and vapour exactly. New presets: an ice cube melting, a pond freezing, a boiling pot that loops seamlessly, a frosted window and dry-ice fog.
- **Electricity and plasma:** gas effects carry arcs between electrodes (an obstacle with a `voltage`): leaders fork like lightning by dielectric breakdown, a channel stays lit while current flows, heats the air it burns in, fades to an afterglow and restrikes down its trace. Over a liquid with heat and vapour, arcs reach the water, and the current boils it where they land. New presets: Jacob's ladder, lightning with a restrike, a Tesla coil, a plasma globe and lightning into a pond.
- **Air that stays air:** with `air`, a liquid keeps the air it seals off as pockets that push back by the gas law, so an upturned cup holds its air and a bottle glugs as it pours (the glugging bottle preset). A small trapped gap rises as bubbles (`air.bubbles`), and bubbles gathering under a ceiling become a pocket that vents when it reaches open air.
- **Sticky, cohesive and elastic liquids:** moving obstacles carry the liquid touching them and pull it into strings, with `adhesion` per obstacle; cohesive and elastic liquids come to rest instead of trembling; slime and snow heap; edges, drops and spray are cleaner; liquids fill small spaces. Live fluids can be bigger, with `substeps` up to 16, elliptical fills and obstacles that hang off the canvas.
- **Tile sets from a terrain description:** describe a fill, edges with bands and tufts and rounded corners, and the autotile compiler draws a seamless set with a test map of every tile and a seam check. Corner (dual-grid) sets, transitions between terrains with variants and collision, and side-view slopes. Exports add a Tiled tileset (`name.tsx`) and a scene's Tiled map (`scene.tmx`), both checked in a real headless Tiled; Godot TileSets gain weights, collision, plain tiles and several sets.
- **Effects:** a spell library for seven elements (a looping projectile in eight directions, an impact, an area and a buff each), the studio's Effects lab, sweeping and moving emitters, curved paths, turbulence, swirling attraction, tumbling particles, halos, keyed noise and emission, fluids inside an effect, effects that light a scene, and vortex, meteor and shield examples.
- **Presets:** `pixel_help` topic `presets` lists the 58 shipped presets (fire, smoke, explosions, spells, liquids, plasma, characters), `preset` returns one's source, and `pixel_compile` takes `preset`; on the command line, `pixelbolt presets` and `compile --preset`. The listing keeps what it measured, so later listings take milliseconds.
- **Reading and reviewing:** replies and README.txt state each animation's frame rate; renders note loops that lift off their ground, step unevenly, jump or repeat a frame; idle templates squash and stretch a grounded slime; indexed and greyscale PNGs import; the guide and workflow topics list their sections, and `name` returns one, so clients that keep only part of a long reply still reach the fluid section.
- **Fixes:** a review of the whole release before tagging fixed loop seams (pocket bubbles popping at the seam, bubbles drawn over air in the aquarium loop, trails vanishing at frame 0), frost that broke off under gravity, a vanished smooth obstacle that still held water when heated, hot plain obstacles counted as plasma, Godot TileSets that dropped a held animation's tile, stale `.tsx` and `.tileset.tres` files after a forced re-export, seam checks between a set and its variants, and Tiled maps with control characters in names. Render-check motion notes no longer misfire on effects their compiler keeps seamless.

The full list of changes is in `CHANGELOG.md`.

The bundle keeps its 0.8.0 name, `pixelbolt.mcpb` (checksum `pixelbolt.mcpb.sha256`). The `pixelforge` command still works as an alias.

`pixelbolt.mcpb` contains the local Node.js MCP server, its eight tools, schemas, authoring help and the shipped examples, so every preset compiles from the bundle. The server makes no network requests.

Download `pixelbolt.mcpb` and open it in Claude Desktop, or use Settings -> Extensions -> install from file. Choose a workspace for recipes and generated artwork, then ask the agent to call `pixel_help`. The bundle uses the client's Node.js runtime (20 or newer); it does not include Node.js.

Download `pixelbolt.mcpb.sha256` beside the bundle to check its SHA-256:

```sh
sha256sum --check pixelbolt.mcpb.sha256
gh attestation verify pixelbolt.mcpb --repo skulitom/Pixelbolt --signer-workflow skulitom/Pixelbolt/.github/workflows/release.yml
```

On PowerShell, `(Get-FileHash pixelbolt.mcpb -Algorithm SHA256).Hash` should match the hash in the checksum file.

The GitHub release makes the bundle available immediately. MCP Registry publication is a separate, manually dispatched step after testing; see [Publishing](https://github.com/skulitom/Pixelbolt/blob/main/docs/PUBLISHING.md).
