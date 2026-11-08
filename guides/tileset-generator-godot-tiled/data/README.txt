How the tile set guide was tested (8 November 2026)
=================================================

Page: https://skulitom.github.io/Pixelbolt/guides/tileset-generator-godot-tiled/

What was tested
- Pixelbolt 0.13.0 from npm (its src/ byte-identical to the v0.13.0 tag), Node.js 24.19.0, Windows 11.
- Four terrain descriptions: snow (written for this guide) and Pixelbolt's shipped examples meadow, ground and shore
  (examples/*.autotile.json in the npm package). Each is in ../sets/<name>/<name>.autotile.json.
- Godot 4.7.2 stable (Godot_v4.7.2-stable_win64.exe.zip from github.com/godotengine/godot releases, SHA-512 checked
  against its SHA512-SUMS.txt), run with --headless: no window, no GPU.
- Tiled 1.12.2 (Windows installer build), run with --evaluate and tmxrasterizer: no window.

1. Build the sets (make-sets.sh; both commands took 555 to 666 ms a set, three runs each, on a Ryzen 9 7950X3D)
   In a new folder holding only the four .autotile.json files:
     sh make-sets.sh
   It runs, for each set:
     npx -y pixelbolt@0.13.0 autotile <name>.autotile.json --out <name>.recipe.json --metadata <name>.masks.json \
       --preview <name>-test-map.png
     npx -y pixelbolt@0.13.0 render <name>.recipe.json --out <name>
   What it writes is byte-identical to the files on the page and in the zips (re-run on 8 November). Neither command
   overwrites earlier output; add --force to rebuild in the same folder.
   No compile reported a warning. A terrain's own edges can't seam, so the seam check covers the joins that stamps
   and variants change; <name>.masks.json counts the joins it looked at (seams.joins: 464 for snow and meadow, 300 for
   ground, 204 for shore) and found no broken shape or texture in any of them.

2. Pixelbolt's own engine checks, unchanged (stock-godot.txt, stock-tiled.txt)
   In a git checkout of Pixelbolt at tag v0.13.0 (the scripts are in the repository, not the npm package):
     node scripts/verify-godot.mjs --godot <path to Godot_v4.7.2-stable_win64_console.exe>
     TILED=<path to tiled.exe> node scripts/verify-tiled.mjs
   Both passed (exit 0).

3. The same checks on the guide's four sets (check-page-sets.mjs, check-results.json)
   Copy check-page-sets.mjs and verify-tiled-onestep.mjs into that checkout's scripts/ folder, then:
     TILED=<path to tiled.exe> node scripts/check-page-sets.mjs <folder with the four .autotile.json> \
       <folder where make-sets.sh wrote the set folders> <path to the Godot console exe> results.json
   check-page-sets.mjs adds the guide's three blob sets (snow, meadow, ground) to Pixelbolt's own test sets, puts
   the shore set in place of its layered test set, and adds each set's compiler test map to the maps both engines
   paint: the 20 x 14 test map for the blob sets (for ground, without the slope hills, which aren't terrain) and the
   22 x 21 layered test map for the shore. The other maps are Pixelbolt's five blob maps (blob sets) or its five
   layered maps (shore). Then:
   - Godot loads every TileSet with no error or warning and checks each tile's terrain, peering bits, probability,
     collision polygons, region and pixels (exactly), and paints every map with
     TileMapLayer.set_cells_terrain_connect. For a blob set, Godot must put the tile shape Pixelbolt's tilemap draws in
     every painted cell. For the shore, the cells are painted bottom-up (water everywhere, sand over the sand and grass
     cells, grass over the grass cells), and Godot must put in every cell the tile that Pixelbolt's corner tilemap of
     the map's points draws: a point takes the lowest terrain of its four cells, so each terrain ends half a cell
     inside the painted cells. That is not the shore figure on the page, which Tiled paints as drawn.
   - Tiled loads every .tsx and checks the grid, each tile's probability, collision objects, oneWay and Wang id. Then
     each cell is given all its sides' and corners' terrain colours from Pixelbolt's map through TileLayerWangEdit
     (Tiled's scripting interface for terrain edits), and every tile Tiled picks must be one Pixelbolt's tilemap draws
     there. This checks the Wang ids and Tiled's tile lookup, not strokes painted by hand. A lone blob cell has no Wang
     tile in Tiled (Pixelbolt draws its mask 0 tile there), so Tiled must leave it empty. Last, tmxrasterizer draws
     every tile, which must give its exported pixels.
   - The CLI's files are compared byte for byte with a build of the same descriptions made in the same run as the
     files the engines loaded (all identical).
   The two scripts here are tidied copies of the ones that produced check-results.json (paths only: they import from
   the checkout's own folders). Run from a v0.13.0 checkout's scripts/ folder on 8 November, they gave the same results.

   verify-tiled-onestep.mjs is Pixelbolt's scripts/verify-tiled.mjs with one change, marked "guide change": in the
   tmxrasterizer step a partly transparent pixel may come back one colour step off. The stock check demands exact
   pixels in that step, and the snow and meadow sets have a half-transparent shadow (alpha 89 of 255) under their
   bottom edge: tmxrasterizer returned all 1,824 of those pixels at most one step off in each colour channel (for
   example 14,23,37 for the exported 14,22,38), most likely rounding as it blends a partly transparent pixel. The stock check
   already allows one step where partly transparent pixels blend in its scene step. Every opaque pixel, and every
   pixel's alpha, matched exactly. Godot's check compares the same pixels exactly, and all of them matched there.

Results (check-results.json)
  Set     Tiles  Godot: cells painted (test map)  Tiled: cells in the maps / tiles placed  Downloads = checked files
  snow     188   393 in 6 maps (139)               713 / 365, 28 lone cells left empty      yes
  meadow   188   393 in 6 maps (139)               713 / 365, 28 lone cells left empty      yes
  ground   151   393 in 6 maps (139)               713 / 365, 28 lone cells left empty      yes
  shore     90   736 in 6 maps (462)               855 / 855                                yes
  Godot counts the cells it painted with a terrain, every one with Pixelbolt's tile shape (for the shore, Pixelbolt's
  map of the points, as above). Tiled counts every cell of each map, empty ones included (a corner map is one cell
  wider and taller in Tiled); the 393 terrain cells of the blob maps include 28 lone cells, which Tiled leaves empty,
  and every other cell has the tile Pixelbolt draws, or stays empty where Pixelbolt draws nothing. In
  check-results.json, tilesPlaced is the 365 (393 terrain cells less the 28 lone ones, loneCellsLeftEmpty); allCells
  (713) and the summary lines count every cell, empty ones included, in the stock checks' wording. A variant counts:
  both checks accept any variant of the tile shape Pixelbolt draws.

Not tested
- Painting by hand in the Godot or Tiled editor with a person at it (both ran without a window).
- Other Godot or Tiled versions; Godot 3 (Pixelbolt writes no Godot 3 file); macOS and Linux.
- Game physics: the collision polygons were checked against the atlas, but no body was simulated walking on them.
- The 16-tile cardinal and single-terrain corner modes.

The searches the page answers, and what ranked for them, are in searches-2026-11-08.txt.
