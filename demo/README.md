# Emberfall

> **Archived, 23 October 2026.** Emberfall was the first stress test of Pixelbolt, and its art was judged too primitive to represent the toolkit, so it has been taken out of the README. The game, generator and recipes stay because `test/emberfall.test.js` and `npm run stress:emberfall` use them as a large deterministic workload. For current work, see the [diorama study](../showcase/diorama/README.md), the [fluid effects](../showcase/fluid/) and the [gallery](../showcase/gallery/README.md).

An original, playable fantasy action-platformer and Pixelbolt stress-test project. Everything stays local for now. All game code and original artwork are covered by the repository's MIT license.

## Launch

From the Pixelbolt repository:

```sh
npm run play
```

Open **http://127.0.0.1:4173**. No install or build is needed: generated assets are included. The loopback-only server serves an allowlist of files from this directory and has no write endpoints. Set `EMBERFALL_PORT` to use another port.

Choose **Begin adventure** to play, or **Watch it play** for a guided journey using the same movement, combat, and environmental systems. Guided mode grants immunity to damage for demonstration. Ordinary play has health, hazards, death and checkpoint retries. Reach the Warden, defeat it, then enter the moon gate.

## Controls

| Action | Keyboard |
| --- | --- |
| Move | Left/right arrows or A/D |
| Jump, then double jump | Space, W or up arrow |
| Cast; hold and release for a charged spell | J or Z |
| Dash with brief invulnerability | Shift, K or X |
| Cycle spell | E or Q |
| Select ember / frost / storm | 1 / 2 / 3 |
| Pause / resume | P or Escape |
| Fullscreen | F |
| Toggle synthesized sound | M |

Touch controls appear on narrow screens and touch devices. Clicking game controls returns keyboard focus to the canvas. Losing window focus pauses the game. No audio plays before the sound button is enabled.

Ember burns grass and vines, and reignites frozen braziers. Frost freezes enemies and braziers. Storm breaks crystal quickly and deals extra damage to frozen enemies. Crates and crystal leave debris and healing runes. Moon shrines restore health and record a checkpoint for the current run; progress is not saved between reloads.

## Artwork

Nine JSON recipes produce **220 frames and 44 named animations**. The collection includes layered knight poses, crawling and flying enemies, a stone Warden, ground variants, braziers, crystals, vines, portals, spell impacts, trees, ruins, ferns, mushrooms, hanging lanterns and banners.

- `recipes/`: editable Pixelbolt source.
- `assets/`: PNG atlases, atlas metadata, animated PNG previews, contact sheets and downloadable complete ZIP bundles.
- `world.js`: deterministic simulation; no browser APIs.
- `game.js`: atlas playback, rendering, input, audio and UI.
- `../scripts/build-emberfall.mjs`: original art authoring script. It produces recipes and passes them through Pixelbolt's real renderer and exporter.

```sh
npm run art:emberfall
```

This intentionally replaces the demo's generated outputs. Make artwork changes in the generator for reproducible builds, or save a separately named recipe before experimenting. The generator is seeded; export output is deterministic.

The browser game uses exact atlas rectangles, per-frame durations, nearest-neighbor filtering and one-shot animation metadata. Small transient particles, UI bars and water ripples are drawn at runtime. No artwork, fonts or JavaScript are loaded from third-party servers.

## Verification

```sh
npm test
npm run stress:emberfall
python scripts/verify-emberfall.py
```

The independent image check requires Pillow; Pixelbolt and the game do not. The stress script writes evidence to `output/emberfall/stress/`, including immutable MCP test revisions. It intentionally reproduces reported bugs and lists them in its result JSON; it does not fix or conceal them.

Browser QA requires an independently installed Playwright. Pass its `index.mjs` path explicitly, or omit it if normal module resolution can find Playwright:

```sh
node scripts/qa-emberfall.mjs /path/to/playwright/index.mjs
node scripts/benchmark-emberfall.mjs /path/to/playwright/index.mjs
```

QA checks keyboard and pointer movement, double jump, charge shots, elemental reactions, pause, dash, sound, fullscreen, the asset gallery, restart, guided victory and mobile layout. The benchmark measures real animation frames separately from deterministic QA. Reports and screenshots are written under `output/emberfall/`.

For agent control, `window.render_game_to_text()` returns observable gameplay state and coordinates. `window.advanceTime(ms)` switches that page session to manual simulation stepping. Reload to resume ordinary real-time simulation after using it.

Read [the full stress-test report](../docs/bugreports/emberfall-stress-test.md) for evidence, reproduction instructions, limitations and proposed fixes.

Read [the Pixelbolt art-quality roadmap](../docs/reports/pixelforge-art-quality-roadmap.md) for what this demo reveals about authoring limitations and proposed toolkit improvements for more organic artwork and animation.
