Pixel art waterfall sheets: how this page's files were made (10 November 2026)

Tool: Pixelbolt 0.15.0, the npm package (https://www.npmjs.com/package/pixelbolt/v/0.15.0), on Windows 11 with
Node.js 24.19.0 and Python 3.13 with Pillow (Python only counts pixels and packs files; it draws nothing).

1. build.py     Reads the package's examples/waterfall.fluid.json and writes four recipes: the shipped one, byte for
                byte, and three with only palette colours and the name changed (lavafall, slimefall,
                moonlit-waterfall). Compiles each twice (the two results must match), renders it with
                "pixelbolt render --look --gif" and makes a 4x GIF with "pixelbolt gif --scale 4". The stone
                waterfall is also compiled with --frames 12 and --frames 8.
2. package.py   Reads the rendered frame PNGs in playing order and counts, for each sheet: colours, alpha values,
                how many pixels change at each step and at the wrap (last frame back to first). Joins the frames
                into a one-row strip, renames the frame PNGs into playing order, and builds each zip with fixed
                timestamps. Writes measured.json.
3. check.gd     Run in Godot 4.7.2 (the official win64 console build, headless) on a project holding each sheet and
                its .tres: loads every .tres as SpriteFrames and prints frames, frame time, loop flag, frame size,
                sheet size and every frame's rectangle. Its output is godot-check.json.
4. make_page.py Writes index.html and preview.png from measured.json and godot-check.json, and stops if the two
                disagree (frames, frame time, frame size, or a frame rectangle that differs from the atlas), if
                any sheet has a soft-edged pixel, or if a last-to-first step is outside its sheet's other steps.

To run them yourself: unpack pixelbolt-0.15.0.tgz, point PKG in the scripts at its "package" folder, then
python build.py, python package.py, python make_page.py (make_page.py also wants this README and the searches file in
a data-src folder, godot-check.json and playground-check.json in out/, and check.gd in a godot folder).

The command-line lines on the page were run as written with npx: the sheet from
"npx -y pixelbolt@0.15.0 compile --preset waterfall" and "render" has the same SHA-256 as the one in waterfall.zip,
lavafall.gif from the two lavafall lines the same as the page's lavafall.gif, and "--frames 8" the same compiled
file as ours.

The playground links were made with "pixelbolt share <recipe>.fluid.json". playground_check.mjs (Playwright driving
the installed Chrome, headless) opened each link on the live playground and waited for it to render; its output is
playground-check.json.

Other people's waterfalls were read from their own pages on 10 November 2026. We did not download or open their
files.

Left out: a 48 x 96 version with a taller cliff. Its stream fell straight down the wall and broke up, so a fresh
review turned it down; it needs a retuned recipe first.

Two fresh reviewers (other AI agents, not the page's writer) checked the page. Both recounted the table from the frame
PNGs inside the zips and checked every statement about other people's pages against the saved pages; the first also
re-ran the commands. After the second review only wording changed, and one title line in slimefall.zip's README.
