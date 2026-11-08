#!/bin/sh
# Rebuilds the guide's four tile sets with Pixelbolt 0.13.0 from npm (Node.js 20 or newer), byte for byte.
# Run it in a new folder holding only snow.autotile.json, meadow.autotile.json, ground.autotile.json and
# shore.autotile.json (each is in sets/<name>/ on the guide). For each set it writes <name>.recipe.json, <name>.masks.json,
# <name>-test-map.png and a folder <name>/ holding the full render export (<name>.png, <name>.tileset.tres, <name>.tsx,
# <name>.atlas.json, <name>.pixel.json, frames/, README.txt and preview.html).
set -e
for n in snow meadow ground shore; do
  npx -y pixelbolt@0.13.0 autotile "$n.autotile.json" --out "$n.recipe.json" --metadata "$n.masks.json" --preview "$n-test-map.png"
  npx -y pixelbolt@0.13.0 render "$n.recipe.json" --out "$n"
done
