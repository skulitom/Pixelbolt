# Pixelbolt Fluids for Aseprite

Fire, smoke, steam, magic and dust that move like real gases, simulated inside Aseprite and baked into your sprite as
ordinary frames. It's free, open source (MIT) and made with [Pixelbolt](https://github.com/skulitom/Pixelbolt).

The extension runs the gas presets from Pixelbolt's Fluid lab, with the same controls. For the same settings you get
the same frames Pixelbolt makes, pixel for pixel: every build checks that against Pixelbolt itself before it's
packaged.

| Preset | Size | Frames | |
|---|---|---|---|
| Campfire | 32×48 | 24 | loop |
| Explosion | 64×64 | 32 | one-shot |
| Smoke puff | 32×32 | 19 | one-shot |
| Steam vent | 32×48 | 24 | loop |
| Magic swirl | 48×48 | 24 | loop |
| Torch | 16×32 | 16 | loop |
| Dust wave | 64×32 | 26 | one-shot |

All seven simulate live in Aseprite.

## Install

1. Get `pixelbolt-fluids-1.0.0.aseprite-extension`, or build it from this folder (see
   [Building from source](#building-from-source)).
2. Double-click it, or in Aseprite open **Edit > Preferences > Extensions > Add Extension** and pick the file.

You need Aseprite 1.3 or newer. The extension reads and writes no files and asks for no permissions.

## Use

**Edit > FX > Pixelbolt Fluids...** opens the dialog.

- **Preset**: one of the seven above.
- **Controls**, the Fluid lab's own:
  - **Strength** ×0.25 to ×2 scales how much every emitter puts out;
  - **Rise (buoyancy)** 0 to 1: how hard hot gas rises;
  - **Curl (vorticity)** 0 to 1: how much it swirls;
  - **Fade (dissipation)** 0 to 0.4: how fast it thins out;
  - **Seed**, with **Randomize**, for another take of the same effect. **Reset** puts the preset back.
- **Bake into**:
  - **New sprite**: a new RGB sprite at the preset's size, with its frame durations;
  - **New layer**: a new layer in the active sprite, starting at the active frame. **Layer position** is **Centre**
    by default (the middle of the sprite); untick it to type X and Y. Frames are added at the end when the effect
    needs more; existing frames keep their durations, and your tags keep their length.
- **Preview** plays the effect in the dialog. The first preview or bake of new settings shows "baking..." while it
  simulates: about two seconds or less for every preset on a desktop PC.
- **Bake** adds the frames. A frame tag named after the preset spans the effect. In an existing sprite, one **Undo**
  removes the whole bake; a new sprite can simply be closed.

Colour modes:
- **RGB**: everything works.
- **Indexed**: the effect's exact colours are added to the end of the palette (colours already in it are reused).
  If they don't fit in 256 entries, the bake stops and says so, and nothing changes.
- **Grayscale**: convert to RGB first (Sprite > Color Mode > RGB Color), or bake into a new sprite.

## More from Pixelbolt

Pixelbolt is a free pixel-art toolkit with 38 fluid presets (liquids, slime, honey, sand, electricity and heat as well
as these gases), effects, crystals and more, all from small text recipes:
- [Poke the pixels](https://skulitom.github.io/Pixelbolt/playground/fluids/): a live campfire and liquids in your
  browser, nothing to install.
- [The gallery](https://skulitom.github.io/Pixelbolt/gallery/) and the [playground](https://skulitom.github.io/Pixelbolt/playground/).
- The Fluid lab on your own computer: `npx -y pixelbolt@latest preview --open`, then open `/fluid.html` (the Fluid
  lab) in the studio it starts.

## Credit and licence

Made with Pixelbolt (MIT). The extension is a Lua port of Pixelbolt's gas simulation and ships under Pixelbolt's MIT
licence ([LICENSE](LICENSE)). The frames you bake are yours to use however you like.

## Building from source

The extension lives in Pixelbolt's repository, in `aseprite/`. It needs Node.js 20 or newer and a Lua 5.4
interpreter at `aseprite/.tools/lua` (`lua.exe` on Windows), or pass `--lua <path>`.

```
node aseprite/build.mjs
```

The build reads the seven presets from `examples/` and refuses any field the Lua port doesn't implement, naming it.
Then it checks the controls against the Fluid lab's sliders, bakes every preset with the port at three settings and
compares every pixel of every frame with Pixelbolt's own output from the same checkout, runs the checks against a
stand-in for Aseprite's API, bundles the modules and presets into one script, and writes
`aseprite/dist/pixelbolt-fluids-1.0.0.aseprite-extension` with its SHA-256.

| File | What it is |
|---|---|
| `extension/plugin.lua` | the command and dialog |
| `extension/bake.lua` | putting frames into a sprite in one transaction |
| `extension/controls.lua` | the Fluid lab's sliders and edit |
| `extension/engine.lua` | running a preset, and the cache Preview and Bake share |
| `extension/fluid/` | the Lua port of Pixelbolt's gas path |
| `tools/presets.mjs` | the strict preset reader and Lua writer |
| `tools/parity.mjs`, `tools/reference.mjs` | the parity gate: the port against Pixelbolt |
| `tools/speed.mjs` | bake times in standalone Lua |
| `tools/bake-cli.lua` | one bake outside Aseprite |
| `checks/` | the stand-in Aseprite API and the checks |
