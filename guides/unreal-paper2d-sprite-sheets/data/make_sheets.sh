#!/usr/bin/env bash
# Builds the seven test sheets from Pixelbolt's own shipped examples. Needs Node.js 20 or newer.
# Run it in this folder: it writes src/ (recipes) and out/<name>/ (Pixelbolt's render bundles).
set -euo pipefail
mkdir -p tools/pb-0.12.1 tools/pb-0.9.2 src out
(cd tools/pb-0.12.1 && npm init -y >/dev/null && npm install --no-audit --no-fund pixelbolt@0.12.1 >/dev/null)
(cd tools/pb-0.9.2 && npm init -y >/dev/null && npm install --no-audit --no-fund pixelbolt@0.9.2 >/dev/null)
pb=tools/pb-0.12.1/node_modules/.bin/pixelbolt
ex=tools/pb-0.12.1/node_modules/pixelbolt/examples

$pb compile --preset campfire --out src/campfire.json
$pb compile --preset fire-spells --out src/fire-spells.json
# The explosion renders to 512 x 256, a sheet whose sides are powers of two.
$pb compile --preset explosion --out src/explosion.json
$pb compile --preset hero --out src/hero.json
cp "$ex/forest-spirit.json" src/forest-spirit.json
# The forest spirit again, trimmed and at 2x, to test Paper2D's trim offsets.
node -e "
const fs = require('fs');
const r = JSON.parse(fs.readFileSync('src/forest-spirit.json', 'utf8'));
r.sheet = Object.assign({}, r.sheet, { trim: true, scale: 2 });
r.name = 'forest-spirit-trim2x';
fs.writeFileSync('src/forest-spirit-trim2x.json', JSON.stringify(r, null, 1));"
for name in forest-spirit forest-spirit-trim2x campfire hero fire-spells explosion; do
  $pb render "src/$name.json" --out "out/$name" >/dev/null
done

# The campfire on 0.9.2, the version the online playground pinned on 7 Nov 2026.
pb092=tools/pb-0.9.2/node_modules/.bin/pixelbolt
$pb092 compile tools/pb-0.9.2/node_modules/pixelbolt/examples/campfire.fluid.json --out src/campfire-092.json
node -e "
const fs = require('fs');
const r = JSON.parse(fs.readFileSync('src/campfire-092.json', 'utf8'));
r.name = 'campfire-092';
fs.writeFileSync('src/campfire-092.json', JSON.stringify(r));"
$pb092 render src/campfire-092.json --out out/campfire-092 >/dev/null
ls out
