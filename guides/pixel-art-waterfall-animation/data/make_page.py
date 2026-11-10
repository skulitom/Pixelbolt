"""Waterfall page kit, step 3: write page/index.html, page/preview.png and page/data/ from the measured files.

Usage: python make_page.py   (after build.py, package.py and the Godot and playground checks)
Every number on the page is read from out/measured.json and out/godot-check.json, so it can't drift from the files.
"""
import html
import json
import os
import shutil
import subprocess

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
PAGE = os.path.join(HERE, "page")
PKG = os.path.normpath(os.path.join(HERE, "..", "c131", "pkg", "package"))
URL = "https://skulitom.github.io/Pixelbolt/guides/pixel-art-waterfall-animation/"
TAGS = ["waterfall", "lavafall", "slimefall", "moonlit-waterfall", "waterfall-12f", "waterfall-8f"]
M = {m["tag"]: m for m in json.load(open(os.path.join(OUT, "measured.json"), encoding="utf-8"))}
G = {g["set"]: g for g in json.load(open(os.path.join(OUT, "godot-check.json"), encoding="utf-8"))}
assert sorted(M) == sorted(G) == sorted(TAGS) and all(g["atlas_textures"] and g["loop"] for g in G.values())
for t, m in M.items():  # the Godot file plays what the sheet and the atlas hold
    assert G[t]["frames"] == m["frames"] and G[t]["frame_ms"] == m["frame_ms"][0] == G[t]["frame_ms_max"], t
    assert G[t]["frame_size"] == [m["width"], m["height"]] and m["alpha_values"] == [0, 255] and m["same_twice"], t
    assert m["step_px_min"] <= m["seam_px"] <= m["step_px_max"], t  # the page says so
    atlas = json.load(open(os.path.join(OUT, t, "bundle", f"{m['name']}.atlas.json"), encoding="utf-8"))
    want = [[atlas["frames"][k]["frame"][c] for c in "xywh"] for k in atlas["animations"][m["name"]]["frames"]]
    assert G[t]["regions"] == want, t
GODOT = G["waterfall"]["godot"].split("-")[0]


def share(name):
    p = subprocess.run(["node", os.path.join(PKG, "bin", "pixelbolt.js"), "share", f"{name}.fluid.json"],
                       cwd=os.path.join(PAGE, "downloads"), capture_output=True, text=True, encoding="utf-8")
    return json.loads(p.stdout)["link"]


def kb(n):
    return f"{n / 1024:.0f} KB" if n >= 10240 else f"{n / 1024:.1f} KB"


CARDS = [  # tag, heading, short name for link labels, alt text, description
    ("waterfall", "Stone waterfall", "stone waterfall",
     "Pixel art waterfall pouring off a mossy stone ledge into a basin",
     "Water pours off a mossy ledge in a foaming arc, splashes into a stone basin and spills over its lip. "
     "This is the waterfall recipe (a short JSON file that describes the simulation) that ships with Pixelbolt, "
     "unchanged."),
    ("lavafall", "Lavafall", "lavafall",
     "Pixel art lavafall pouring off a dark stone ledge into an orange pool",
     "The same simulation with nine palette colours changed: orange and yellow over dark stone. It moves like water, "
     "not like thick lava."),
    ("slimefall", "Slimefall", "slimefall",
     "Pixel art green slimefall pouring into a stone basin",
     "Five palette colours changed: toxic green over the grey stone, with a tan strip where the moss was. It moves "
     "like water, not like thick slime."),
    ("moonlit-waterfall", "Moonlit waterfall", "moonlit waterfall",
     "Pixel art waterfall at night in dark blue with pale highlights",
     "Nine palette colours changed for a night scene: navy water, pale highlights and blue-grey stone."),
]


def downloads(tag, label, recipe):
    m = M[tag]
    parts = [f'<a class="open" href="downloads/{tag}.zip" download>Download {tag}.zip ({kb(m["zip"]["bytes"])})</a>',
             f'<a href="{tag}-strip.png" download aria-label="Strip PNG of the {label}">Strip PNG</a> '
             f'({m["strip"]["size"][0]} × {m["strip"]["size"][1]}, {kb(m["strip"]["bytes"])})',
             f'<a href="{tag}.gif" download aria-label="GIF at 4× of the {label}">GIF at 4×</a> ({kb(m["gif"]["bytes"])})']
    if recipe:
        parts.append(f'<a href="downloads/{tag}.fluid.json" download aria-label="Recipe JSON of the {label}">Recipe JSON</a>')
    return " ".join(f'<span class="nw">{p}{" ·" if i < len(parts) - 1 else ""}</span>' for i, p in enumerate(parts))


def card(tag, heading, label, alt, text, links):
    m = M[tag]
    return f"""<section id="{tag}">
<h2>{heading}</h2>
<figure class="stage"><picture><source srcset="{tag}-still.png" media="(prefers-reduced-motion: reduce)"><img src="{tag}.gif" width="{m['width'] * 4}" height="{m['height'] * 4}" alt="{html.escape(alt)}" decoding="async"{'' if tag == 'waterfall' else ' loading="lazy"'}></picture></figure>
<p>{text}</p>
<p class="size">{m['width']} × {m['height']} pixels, {m['frames']} frames of {m['frame_ms'][0]} ms ({m['loop_ms'] / 1000:.2f} s a loop), {m['colours']} colours, transparent background. Shown at 4×.</p>
<p>{downloads(tag, label, True)}</p>
<p><a href="{html.escape(links[tag])}">Open the {label} recipe in the playground</a> to change it in your browser.</p>
</section>
"""


def table():
    rows = []
    for tag in ["waterfall", "waterfall-12f", "waterfall-8f", "lavafall", "slimefall", "moonlit-waterfall"]:
        m = M[tag]
        rows.append(f"<tr><th scope=\"row\"><a href=\"downloads/{tag}.zip\" download>{tag}.zip</a></th>"
                    f"<td>{m['width']} × {m['height']}</td><td>{m['frames']} × {m['frame_ms'][0]} ms</td>"
                    f"<td>{m['colours']}</td><td>{m['strip']['size'][0]} × {m['strip']['size'][1]}</td>"
                    f"<td>{m['step_px_median']:g} ({m['step_px_min']} to {m['step_px_max']})</td>"
                    f"<td>{m['seam_px']}</td><td>{kb(m['zip']['bytes'])}</td></tr>")
    return "\n".join(rows)


def preview():
    """1200 x 630 social image: four looks' first frames at 5x, with gaps, on the page's dark stage colour."""
    im = Image.new("RGBA", (1200, 630), (27, 29, 42, 255))
    x = 60
    for t in ["moonlit-waterfall", "lavafall", "waterfall", "slimefall"]:
        f = Image.open(os.path.join(PAGE, f"{t}-still.png")).convert("RGBA")  # 192 x 256 (4x)
        f = f.resize((240, 320), Image.NEAREST)  # 5x
        im.alpha_composite(f, (x, 155))
        x += 240 + 40
    im.convert("RGB").save(os.path.join(PAGE, "preview.png"), optimize=True)


def main():
    links = {t: share(M[t]["name"]) for t, *_ in CARDS}
    base, f12, f8 = M["waterfall"], M["waterfall-12f"], M["waterfall-8f"]
    zips = sorted(m["zip"]["bytes"] for m in M.values())
    pj = {t: round(os.path.getsize(os.path.join(OUT, t, "bundle", f"{M[t]['name']}.pixel.json")) / 1024) for t in M}
    title = "Pixel art waterfall animation: free sprite sheets and recipe"
    h1 = "Pixel art waterfall animation: six free sprite sheets and the recipe behind them"
    desc = ("Six free pixel art waterfall sprite sheets (48 × 64 px, 8 to 24 frames, 9 colours, MIT): strips, GIFs, "
            "atlases and Godot 4 files, made with Pixelbolt 0.15.0.")
    assert len(title) <= 60 and len(desc) <= 160, (len(title), len(desc))
    quick = " · ".join(f'<a href="downloads/{t}.zip" download>{n}</a>' for t, n in (
        ("waterfall", "stone"), ("lavafall", "lava"), ("slimefall", "slime"), ("moonlit-waterfall", "moonlit"),
        ("waterfall-12f", "stone in 12 frames"), ("waterfall-8f", "stone in 8 frames")))
    page = f"""<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{URL}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Pixelbolt">
<meta property="og:title" content="{h1}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{URL}">
<meta property="og:image" content="{URL}preview.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Four pixel art waterfalls side by side: moonlit, lava, stone and slime">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@type": "TechArticle",
  "headline": "{h1}",
  "description": "{desc}",
  "datePublished": "2026-11-10",
  "dateModified": "2026-11-10",
  "inLanguage": "en-GB",
  "url": "{URL}",
  "mainEntityOfPage": "{URL}",
  "image": "{URL}preview.png",
  "author": {{"@type": "Organization", "name": "Pixelbolt maintainers", "url": "https://github.com/skulitom/Pixelbolt"}},
  "publisher": {{"@type": "Organization", "name": "Pixelbolt maintainers", "url": "https://github.com/skulitom/Pixelbolt"}},
  "isPartOf": {{"@type": "WebSite", "name": "Pixelbolt", "url": "https://skulitom.github.io/Pixelbolt/"}},
  "about": {{"@type": "SoftwareApplication", "name": "Pixelbolt", "url": "https://github.com/skulitom/Pixelbolt", "applicationCategory": "MultimediaApplication", "softwareVersion": "0.15.0", "license": "https://opensource.org/licenses/MIT"}}
}}
</script>
<style>
:root {{ --bg: #ffffff; --fg: #1d1d1f; --muted: #5b5b66; --link: #0b57d0; --rule: #d9d9e0; --head: #f3f3f6; --stage: #1b1d2a; --button: #0b57d0; --button-fg: #ffffff; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg: #16171a; --fg: #e8e8ec; --muted: #a2a2ad; --link: #8ab4f8; --rule: #33343a; --head: #202126; --stage: #0e0f15; --button: #8ab4f8; --button-fg: #10131a; }} }}
* {{ box-sizing: border-box; }}
body {{ background: var(--bg); color: var(--fg); font: 17px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; }}
main, footer {{ max-width: 46rem; margin: 0 auto; padding: 1.5rem 16px 0; }}
a {{ color: var(--link); }}
h1 {{ font-size: 1.7rem; line-height: 1.25; margin: 0.5rem 0 1rem; }}
h2 {{ font-size: 1.3rem; line-height: 1.3; margin: 2.4rem 0 0.6rem; }}
h3 {{ font-size: 1.05rem; margin: 1.4rem 0 0.4rem; }}
li {{ margin: 0.3rem 0; }}
.lead {{ font-size: 1.05rem; }}
.muted, .crumbs {{ color: var(--muted); font-size: 0.92rem; }}
.nw {{ white-space: nowrap; }}
code {{ font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: 0.88em; overflow-wrap: anywhere; }}
pre {{ background: var(--head); border: 1px solid var(--rule); border-radius: 6px; padding: 0.7rem; overflow-x: auto; font-size: 0.85rem; line-height: 1.5; }}
pre code {{ overflow-wrap: normal; }}
figure.stage {{ background: var(--stage); border-radius: 6px; margin: 1rem 0; padding: 16px; display: flex; justify-content: center; gap: 16px; flex-wrap: wrap; }}
figure.stage img {{ display: block; max-width: 100%; height: auto; image-rendering: pixelated; }}
figure.stage figure {{ margin: 0; }}
figure.stage figcaption {{ color: #c9c9d6; font-size: 0.88rem; text-align: center; margin-top: 6px; }}
.size {{ color: var(--muted); font-size: 0.92rem; }}
a.open {{ display: inline-block; background: var(--button); color: var(--button-fg); font-weight: 600; text-decoration: none; padding: 0.55rem 0.95rem; border-radius: 6px; }}
a.open:hover, a.open:focus-visible {{ text-decoration: underline; }}
.wrap {{ overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 1rem 0; }}
table {{ border-collapse: collapse; font-size: 0.86rem; min-width: 40rem; }}
caption {{ text-align: left; color: var(--muted); font-size: 0.92rem; padding-bottom: 0.4rem; }}
th, td {{ border: 1px solid var(--rule); padding: 0.4rem 0.55rem; text-align: left; vertical-align: top; }}
thead th, tbody th {{ background: var(--head); }}
footer {{ border-top: 1px solid var(--rule); margin-top: 3rem; padding-top: 1rem; padding-bottom: 4rem; }}
</style>
</head>
<body>
<main>
<nav class="crumbs" aria-label="Breadcrumb"><a href="../../">Pixelbolt</a> › <a href="../">Guides</a></nav>
<h1>{h1}</h1>
<p class="lead">Six free sprite sheets of one simulated pixel art waterfall, a side view with its own stone ledge and basin: the original, three recolours (lava, slime and moonlit), and the original again in 12 and 8 frames. Made with Pixelbolt 0.15.0 on 10 November 2026: 48 × 64 pixels, 9 colours, hard-edged pixels on a transparent background, each with a one-row strip, a GIF, a JSON atlas and a Godot 4 SpriteFrames file, under the MIT licence.</p>
<p><strong>Download</strong> (zips, {kb(zips[0])} to {kb(zips[-1])}): {quick}</p>
<p>In every sheet the step from the last frame back to the first stays inside the range of the other steps: {base['seam_px']} pixels in the 24-frame stone waterfall, where the others change {base['step_px_min']} to {base['step_px_max']} (<a href="#numbers">the table</a> has all six). All six Godot files load in Godot {GODOT} with the right frames, frame time and loop flag.</p>
<p class="muted">We make Pixelbolt, the free, open-source tool that simulated these. This page and its files were made by AI agents working for its maintainers. Last checked 10 November 2026. The previews loop for ever; if your system asks for reduced motion, you get stills. On this page: <a href="#waterfall">Stone</a> · <a href="#lavafall">Lava</a> · <a href="#slimefall">Slime</a> · <a href="#moonlit-waterfall">Moonlit</a> · <a href="#fewer">12 and 8 frames</a> · <a href="#engine">Use it in your engine</a> · <a href="#own">Make your own</a> · <a href="#others">Other free waterfalls</a></p>

{card(*CARDS[0], links)}
{card(*CARDS[1], links)}
{card(*CARDS[2], links)}
{card(*CARDS[3], links)}
<section id="fewer">
<h2>The stone waterfall in 12 and 8 frames</h2>
<figure class="stage">
<figure><picture><source srcset="waterfall-12f-still.png" media="(prefers-reduced-motion: reduce)"><img src="waterfall-12f.gif" width="192" height="256" alt="The stone waterfall as a 12-frame loop" decoding="async" loading="lazy"></picture><figcaption>12 frames of {f12['frame_ms'][0]} ms</figcaption></figure>
<figure><picture><source srcset="waterfall-8f-still.png" media="(prefers-reduced-motion: reduce)"><img src="waterfall-8f.gif" width="192" height="256" alt="The stone waterfall as an 8-frame loop" decoding="async" loading="lazy"></picture><figcaption>8 frames of {f8['frame_ms'][0]} ms</figcaption></figure>
</figure>
<p>For a smaller sheet: every second frame of the 24-frame loop (12 frames of {f12['frame_ms'][0]} ms) or every third (8 frames of {f8['frame_ms'][0]} ms). The loop still lasts {f12['loop_ms'] / 1000:.2f} s and the water steps more coarsely. The step from the last frame back to the first stays inside the range of the other steps: {f12['seam_px']} pixels against {f12['step_px_min']} to {f12['step_px_max']}, and {f8['seam_px']} against {f8['step_px_min']} to {f8['step_px_max']}.</p>
<p>12 frames: {downloads('waterfall-12f', '12-frame stone waterfall', False)}</p>
<p>8 frames: {downloads('waterfall-8f', '8-frame stone waterfall', False)}</p>
</section>

<h2 id="numbers">The six sheets in numbers</h2>
<div class="wrap" tabindex="0" role="region" aria-labelledby="numbers"><table>
<caption>Counted from each sheet's frame PNGs. Scroll sideways on a narrow screen.</caption>
<thead><tr><th scope="col">Download</th><th scope="col">Frame, px</th><th scope="col">Frames</th><th scope="col">Colours</th><th scope="col">Strip, px</th><th scope="col">Pixels changed per step: median (range)</th><th scope="col">Pixels changed from the last frame back to the first</th><th scope="col">Zip</th></tr></thead>
<tbody>
{table()}
</tbody>
</table></div>
<p class="muted">Counted by <a href="data/package.py">package.py</a>; the full figures, with a SHA-256 for each strip and zip, are in <a href="data/measured.json">measured.json</a>. Every pixel is fully opaque or fully transparent. The three recolours move exactly as the stone waterfall does, so their counts are the same. Compiling a recipe took about a second on our PC, and compiling it twice with Pixelbolt 0.15.0 gave the same bytes each time.</p>
<p>Each zip holds the strip, the same frames as a grid sheet with its atlas JSON and Godot file, the GIF at 1× and 4×, every frame as a PNG (named in playing order), an animated PNG, the recipe, the compiled frames as Pixelbolt's editable <code>.pixel.json</code> (the largest file in each zip: about {pj['waterfall']} KB unzipped at 24 frames, {pj['waterfall-12f']} KB at 12 and {pj['waterfall-8f']} KB at 8), Pixelbolt's other export files (CSS classes, a small Canvas player, a preview page), a README and the licence.</p>

<h2 id="engine">Use it in your engine</h2>
<ul>
<li><strong>Godot 4:</strong> copy the grid sheet and its <code>.tres</code> (for example <code>waterfall.png</code> and <code>waterfall.tres</code>) into one folder of your project, give an AnimatedSprite2D that SpriteFrames file and play the animation. Set the node's texture filter to Nearest. We loaded all six files in Godot {GODOT}, run headless: each came in as SpriteFrames with the frame count, frame time, loop flag and frame rectangles its atlas gives (<a href="data/godot-check.json">godot-check.json</a>, made by <a href="data/check.gd">check.gd</a>). We did not look at them playing in the editor.</li>
<li><strong>Unity, GameMaker and other engines that slice grids:</strong> the strip is one row of equal cells, 48 × 64 pixels, with no padding. Play it at the frame time above, with point (nearest-neighbour) filtering and no compression. Not tested by us in those engines.</li>
<li><strong>Phaser and other atlas loaders:</strong> the zip's <code>.atlas.json</code> is a TexturePacker-style JSON hash with each frame's rectangle and duration, plus Aseprite-style frame tags. Pixelbolt's <a href="https://github.com/skulitom/Pixelbolt/blob/v0.15.0/docs/game-integration.md">game integration notes</a> go through it.</li>
<li><strong>Unreal Engine 5:</strong> see <a href="../unreal-paper2d-sprite-sheets/">importing Pixelbolt sheets into Paper2D, with flipbooks</a>.</li>
</ul>

<h2 id="own">Make your own</h2>
<p>A recipe is a short JSON file that describes the simulation: the palette, the stone, where the water enters and how it moves. Each <strong>Recipe JSON</strong> link above is one.</p>
<p>In the browser: each playground link above carries its whole recipe. Change a value and the preview renders again; then download a sheet, an atlas or a GIF. Nothing to install, no account. The link names Pixelbolt 0.15.0, so the playground renders it with that version; we opened all four on 10 November and each rendered its 24 frames (<a href="data/playground-check.json">playground-check.json</a>).</p>
<p>From the command line, with Node.js 20 or newer:</p>
<pre><code>npx -y pixelbolt@0.15.0 compile --preset waterfall --out waterfall.json
npx -y pixelbolt@0.15.0 render waterfall.json --out waterfall --gif</code></pre>
<p>The first command runs the simulation and writes every frame into <code>waterfall.json</code>; the second writes the export folder our zips start from. To that folder we add the strip, the 4× GIF, the recipe and the licence, move the 1× GIF out of <code>gifs/</code>, rename the frame PNGs into playing order and replace <code>README.txt</code>. We ran both commands as written: the sheet came out byte for byte the one in <code>waterfall.zip</code>. For fewer frames add <code>--frames 8</code> (or 12) to <code>compile</code>. To start from one of our recolours, download its Recipe JSON and compile that instead:</p>
<pre><code>npx -y pixelbolt@0.15.0 compile lavafall.fluid.json --out lavafall.json
npx -y pixelbolt@0.15.0 gif lavafall.json --scale 4 --out lavafall.gif</code></pre>
<h3>What to change in the recipe</h3>
<ul>
<li><strong>Colours:</strong> the nine entries of <code>palette</code>. <code>B</code>, <code>b</code>, <code>c</code> and <code>w</code> are the liquid from deep to foam; <code>r</code>, <code>R</code>, <code>k</code> and <code>L</code> are the stone; <code>m</code> is the moss on the ledge. The lava, slime and moonlit sheets change only these (and the recipe's name).</li>
<li><strong>How far the arc reaches:</strong> <code>velocity</code> on the emitter named <code>source</code> ([1.1, 0]), where the water enters.</li>
<li><strong>Surges:</strong> <code>pulse</code> on <code>source</code> (<code>amplitude</code> 0.5, <code>period</code> 6). In a loop, <code>period</code> must divide the number of frames (24).</li>
<li><strong>Foam and spray:</strong> the two <code>whitewater</code> layers throw foam off fast water (<code>chance</code> sets how much), and the emitter named <code>spray</code> draws the splash where the stream lands.</li>
</ul>
<p>The <a href="../pixel-art-water-animation/">water guide</a> explains the same recipe field by field, next to a splash, a drip and a dam break. Its pictures and commands use Pixelbolt 0.9.1, whose frames for this recipe differ from 0.15.0's in all 24 frames: with one Pixelbolt version the same recipe gives the same bytes (we compiled each twice), and another version can give other frames. That is why the commands and links here name 0.15.0.</p>

<h2 id="others">Other free pixel art waterfalls, and when to use them instead</h2>
<p>These sheets are one side-view scene with its own ledge and basin, in one art style and nine colours. They are not tiles: they don't stack, widen or join a tile set without editing the recipe. The lava and the slime move like water. The overflow runs off the bottom-right of the frame, so it needs water or a drain under it. There is no top-down view. If that isn't what you need, three packs and one set of files are free elsewhere, and one tutorial shows how to draw your own (from each page as read on 10 November 2026; we did not download or open the files):</p>
<ul>
<li><a href="https://heosphorus.itch.io/animated-waterfalls">Animated Waterfalls by Heosphorus</a> (itch.io, name your own price): 20 animations of 8 frames (the first ten at 8 fps), ten at 48 × 48 and ten at 64 × 64 pixels, as transparent PNGs. Its page says the 48 × 48 size is easy to fit into tile sets and lists commercial games among its uses; it shows no licence text. Take it for variety, and for falls sized to sit in a tile set.</li>
<li><a href="https://jomi13.itch.io/waterfall-animated">WaterFall by JoMI</a> (itch.io, name your own price), 128 × 128 by its description: a GIF, sprite sheets and the Aseprite source file. The author answered "Yes you can" to a commenter asking about a commercial game. Take it if you want to edit the drawing itself in Aseprite.</li>
<li><a href="https://nyknck.itch.io/waterfall-sprite">Waterfall Sprite by NYKNCK</a> (itch.io, name your own price): PNG with a transparent background, in a 30 kB zip; the page is marked "In development" and gives no size or frame count. The author says in the comments that it is completely free, in reply to a question about commercial use. Take it if you want a waterfall sprite that is already drawn.</li>
<li><a href="https://opengameart.org/content/waterfall-0">WaterFall by ElectDraw</a> (OpenGameArt, 24 July 2025): four PNG files under CC0, so there is no licence text to carry. Take it if you need public-domain art.</li>
<li><a href="https://www.slynyrd.com/blog/2018/10/12/pixelblog-10-water-in-motion">Pixelblog 10, Water in Motion, by Raymond Schlitter</a> (16 October 2018), a tutorial, not a download: how to draw a waterfall by hand, as a mouth, a flow and a splash. Read it if you want to animate your own.</li>
</ul>
<p class="muted">All three itch.io pages say no generative AI was used.</p>
<p>What a simulated sheet gives you instead: the colours, the frame count and the flow are settings, so one recipe makes a 24-frame or an 8-frame loop, or a lavafall, and you can keep changing it.</p>

<h2>Licence</h2>
<p>The sheets, GIFs, recipes and scripts on this page are under the MIT licence: free for any use, commercial too, as long as the licence text stays with copies of the files. Each zip has it as <code>LICENSE.txt</code>; if you take a single file, take <a href="https://github.com/skulitom/Pixelbolt/blob/v0.15.0/LICENSE">the licence text</a> too. It names the copyright holder as "PixelForge contributors": PixelForge is Pixelbolt's earlier name. The stone waterfall is the example recipe in Pixelbolt's MIT-licensed npm package, whose README says the included artwork is original and covered by the same licence; the recolours are that recipe with only palette colours and the name changed.</p>

<h2>How this page was made</h2>
<p>Three scripts, run on 10 November 2026 with Pixelbolt 0.15.0 from npm: <a href="data/build.py">build.py</a> writes the four recipes and compiles and renders them, <a href="data/package.py">package.py</a> counts the pixels and builds the strips and zips, and <a href="data/make_page.py">make_page.py</a> writes this page from the counts. <a href="data/README.txt">README.txt</a> says how to run them. The searches this page answers, and what ranked for them that day, are in <a href="data/searches-2026-11-10.txt">searches-2026-11-10.txt</a>.</p>

<h2>More pixel art effect guides</h2>
<ul>
<li><a href="../pixel-art-water-animation/">Water: the waterfall recipe explained, a splash, a drip and a dam break</a></li>
<li><a href="../pixel-art-fire-animation/">Fire: a campfire, a torch and a hand-drawn flame</a></li>
<li><a href="../pixel-art-explosion/">Explosions: a fireball with smoke and sparks, and small particle bursts</a></li>
<li><a href="../pixel-art-smoke-and-steam/">Smoke and steam: a cartoon smoke puff, a steam vent and a dust wave</a></li>
<li><a href="../pixel-art-slime-and-honey/">Slime and honey: a squashing slime, a bursting slime, pouring honey and a honey drop</a></li>
<li><a href="../pixel-art-magic-effects/">Magic: a spell swirl and a bubbling potion</a></li>
<li><a href="../tileset-generator-godot-tiled/">Free tile sets for Godot 4 and Tiled, drawn from a terrain description</a></li>
</ul>
<p><a href="../">All guides</a> · <a href="../../playground/">The playground</a> · <a href="../../gallery/">The gallery</a> · <a href="../../compare/">All comparisons</a> · <a href="../../">Pixelbolt home</a></p>
<p class="muted">Comparing effect tools? See <a href="../../compare/pixel-fx-designer-alternatives/">Pixel FX Designer alternatives: 7 pixel-art effect tools compared</a>. For agents: <a href="../../compare/pixel-art-mcp-servers-for-ai-agents/">pixel art MCP servers compared</a>.</p>
</main>
<footer class="muted"><p>Plain static page: no JavaScript, trackers or cookies. Made by AI agents working for the Pixelbolt maintainers. <a href="https://github.com/skulitom/Pixelbolt">GitHub</a> · <a href="https://github.com/skulitom/Pixelbolt/issues/new">Report a mistake</a></p></footer>
</body>
</html>
"""
    open(os.path.join(PAGE, "index.html"), "w", encoding="utf-8", newline="\n").write(page)
    preview()
    data = os.path.join(PAGE, "data")
    os.makedirs(data, exist_ok=True)
    for f in ("build.py", "package.py", "make_page.py", "playground_check.mjs"):
        shutil.copy(os.path.join(HERE, f), os.path.join(data, f))
    shutil.copy(os.path.join(OUT, "godot-check.json"), os.path.join(data, "godot-check.json"))
    shutil.copy(os.path.join(HERE, "godot", "check.gd"), os.path.join(data, "check.gd"))
    shutil.copy(os.path.join(OUT, "playground-check.json"), os.path.join(data, "playground-check.json"))
    for f in ("README.txt", "searches-2026-11-10.txt"):
        shutil.copy(os.path.join(HERE, "data-src", f), os.path.join(data, f))
    print("page written:", len(page), "chars; title", len(title), "description", len(desc))


main()
