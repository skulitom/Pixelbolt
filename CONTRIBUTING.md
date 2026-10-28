# Contributing to Pixelbolt

Contributions from people and agents are welcome. Keep the project focused on editable pixel art recipes, deterministic exports and a useful inspect/revise loop.

## Local setup

Install Node.js 20 or newer, clone your fork and run:

```sh
npm test
node bin/pixelbolt.js preview
```

There are no dependencies to install and no build step. The preview studio opens at `http://127.0.0.1:4747`. Run CLI commands from the repository root.

Optional quality-lab browser checks use `PIXELBOLT_BROWSER_CHANNEL` to select an installed browser channel. The portable builder uses `PIXELBOLT_STUDIO_PACKER` internally to prevent relaunching the pinned packer. Both variables accept their `PIXELFORGE_` equivalents as a fallback only when the new name is unset.

Read [AGENTS.md](AGENTS.md) for the architecture and project constraints. Agents authoring artwork should also read the [pixel art skill](skills/pixel-art/SKILL.md) and [authoring reference](docs/agent-guide.md).

## Propose a change

Open an issue for substantial features or format changes so the scope can be discussed first. For a bug, include the Node.js version, operating system, exact command, expected result, actual result and a minimal recipe if relevant. Remove private paths and credentials from logs.

External contributors should use a branch in their fork and submit a focused pull request. Explain the user-visible result and how you verified it. Documentation fixes and small bug fixes can go straight to a pull request. Agents working for the repository owner follow the standing direct-to-`main` commit and push authorization in [AGENTS.md](AGENTS.md); routine confirmation or a pull request is not required after review and successful checks.

## Verify your work

- Run `npm test` after functional changes. Add a regression test when fixing behavior that the existing tests do not cover.
- Keep runtime validation, [schema.json](schema.json) and [the authoring reference](docs/agent-guide.md) aligned. Regenerate the schemas (`schema.json`, `poses.schema.json`, `scene.schema.json`, `autotile.schema.json`, `fx.schema.json`, `fluid.schema.json`, `wave.schema.json`, `normals.schema.json`) with `node scripts/generate-schema.js` when intentionally changing a format, and review the diff.
- When intentionally changing bundled examples, use `node scripts/generate-examples.js` and review the recipes and rendered artwork.
- Fluid output is pinned: a change to `src/fluid.js` or a `*.fluid.json` preset that alters pixels fails the golden hashes in `test/fluid.test.js`. When the change is intended, review the contact sheets, update the hashes and rebuild the README GIFs with `npm run art:fluid -- --force` (`npm run check:fluid` verifies them).
- For changes to binary exports, also check with an independent decoder. The optional `scripts/verify-exports.py` check uses Python and Pillow after `npm run demo`. If `output/forest-spirit` already exists, preserve or move that output before running the demo again. `scripts/verify-trim.py` checks trimmed atlases the same way and needs no prior output. `node scripts/verify-godot.mjs` loads the Godot SpriteFrames in a headless Godot 4 when one is installed (`--godot <path>` or `GODOT`).
- For studio changes, run `node scripts/qa-studio.mjs` (Node.js 22+ and an installed Edge or Chrome; nothing else is needed). It walks the studio in a headless browser with a throwaway profile: every sample, editing, a broken recipe, the controls, Save, Open, Export and GIF downloads, draft recovery, keyboard access and narrow and wide windows, and the Fluid lab (every preset compiled in the browser to the same recipe as Node), and keeps screenshots under `output/studio-qa`. Still look at the preview yourself at narrow and wide sizes, with the keyboard, and with animation playing. For artwork changes, inspect every frame, not just recipe validity.
- For a change meant to make something faster or smaller, measure it with `npm run bench -- --compare <a checkout of main>`. It times fluid, fx and pose compiles, renders, exports and the live fluid runner on the shipped examples, each case in a fresh process (so its peak memory is its own), with this checkout and the other one interleaved, five processes a side. It calls a case faster or slower only when every process on one side beat every one on the other (identical code does that about once in 126 cases), and it says whether both sides made the same output. Put its table in the pull request. `--only fluid/,live/` picks cases and `--list` names them; `npm run bench` alone times this checkout. `npm run bench -- --budgets` times only the cases with a speed budget (the figure workflow's targets and a few loose limits) and names any over it; CI runs it as an advisory job that warns and never fails, because the tests themselves assert no timings.
- For changes to `packaging/` or the portable build scripts, build and verify on the system you changed: `node scripts/build-studio.mjs --allow-dirty --out <fresh folder>`, then `node scripts/verify-studio.mjs <the archive> --allow-dev`. `npm test` runs the same checks against a stand-in runtime on Windows, macOS and Linux, and CI verifies every target on its own system.

Keep the core and runtime dependency-free. Use Node.js standard APIs for the CLI, file formats and local server. Preserve the text-first workflow, overwrite protection, loopback binding and explicit server asset allowlist.

For MCPB releases and the separate MCP Registry publication step, see [Publishing](docs/PUBLISHING.md).

New code, documentation and original example artwork contributed to this repository are covered by its [MIT license](LICENSE). Only contribute material you have the right to license this way.
