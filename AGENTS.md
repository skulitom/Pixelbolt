# Pixelbolt

To **use** Pixelbolt for artwork, start with [the pixel art skill](skills/pixel-art/SKILL.md) and [the quick start](docs/agent-quick-start.md), then [the authoring guide](docs/agent-guide.md) and [schema.json](schema.json) as needed. [llms.txt](llms.txt) indexes the public documentation; [README.md](README.md) includes CLI and MCP setup. The instructions below apply when **contributing to the toolkit**.

This is an agent-first pixel art toolkit. Keep the core and runtime free of dependencies. Use standard Node.js APIs for the CLI, PNG/APNG encoding, ZIP and the local server. No build step is required.

## Map

Every module opens with a comment saying what it does and what must stay true. Before changing one, read that comment and its entry in [docs/modules.md](docs/modules.md), which has the longer notes: what it draws, what pins its output and what to run afterwards. Keep this map to a few words a module; a new module gets a place here, its design in its opening comment and its notes in `docs/modules.md`.

- **Recipes to pixels** (browser-compatible, `src/`): `core.js` (validation, rasterizing, atlas packing, inspection, comparison), `craft.js` (dither, cleanup, rotation, easing, seeded hashing, trigonometry), `font.js` (the pixel font), `patch.js` (targeted edits), `resize.js` (another canvas size, fewer frames), `share.js` (share links, recipes inside PNGs).
- **Compilers**, each from a source format to an ordinary recipe (browser-compatible): `authoring.js` (poses, autotile templates, normal passes, draft views) with `pose-geometry.js`, `motions.js` (rigs and motion templates) and `motion.js` (motion review); `fx.js` with `shapes.js` (particles and spell shapes); `fluid.js` with `electric.js` (gases, liquids, sand, plasma); `bodies.js` with `territory.js` (rigid bodies, territory matches); `powder.js` (falling sand); `wave.js`; `crystal.js`; `autotile.js`, `terrain.js` and `slopes.js` (tile sets); `scene.js` (scenes).
- **Exports**: `export.js` and `png.js` (bundles), `gif.js`, `godot.js`, `tiled.js`, `sequence.js` (video frames, never video), `scene-export.js`, `runtime.js` (the Canvas player).
- **Node side**: `resolve.js` (palette files, scene assets), `revisions.js`, `import.js`, `frame-folder.js`, `check.js` (the `check` in render replies), `help.js` (help topics), `presets.js` (the shipped examples as presets), `skill.js` (`skill install`).
- **Interfaces**: `bin/pixelbolt.js` (CLI), `src/mcp.js` with `mcp-worker.js` (MCP server, one tool call at a time in a worker), `src/server.js` and `studio/` (the local studio and its labs), `playground/` (the site's playground, not in the npm package), `packaging/` (portable builds).
- **Generated, never edited by hand**: the `*.schema.json` files (`node scripts/generate-schema.js`) and `examples/` (`node scripts/generate-examples.js`, plus the `scripts/*-presets.mjs` files that write the reviewed presets).

## What holds output in place

Simulated and drawn output is pinned by golden hashes in `test/goldens/<set>.json`, one set per test file. `node scripts/goldens.mjs [set | set/case ...]` runs only those tests, lists every case whose output changed and draws its frames before and after under `output/goldens/`; look at them, then `--write` updates the hashes. Never update a hash you have not looked at, and never rewrite `test/fixtures/figures-baseline.json`, the frozen pre-M0 baseline.

| After changing | Run |
|---|---|
| `shapes.js`, `fx.js` | `node scripts/goldens.mjs shapes` (and `fx`, `spell-library`) |
| `fluid.js`, `electric.js` | `node scripts/goldens.mjs fluid`, then the GIFs: `showcase/fluid/build.mjs` |
| `bodies.js`, `territory.js` | `node scripts/goldens.mjs bodies`, `showcase/bodies/build.mjs` |
| `powder.js` | `node scripts/goldens.mjs powder`, `showcase/powder/build.mjs` |
| `wave.js`, `crystal.js`, `terrain.js` | `node scripts/goldens.mjs wave` (`crystal`, `terrain`); `showcase/waves/build.mjs --check`, `showcase/crystals/build.mjs` |
| `craft.js` (`turnRows`, `draftTurn`), `motions.js`, `authoring.js` | `node scripts/goldens.mjs drafts figures idle-squash` |
| `font.js` glyphs | a format change: regenerate examples and every golden set, and review |
| a `.tres`, a `.tscn`, the atlas, normal passes, autotile masks, scene planes | `node scripts/verify-godot.mjs` (a real headless Godot 4) |
| a `.tsx`, a `.tmx`, the atlas, autotile masks, scene drawing | `node scripts/verify-tiled.mjs` (a real headless Tiled) |
| `studio/` | `node scripts/qa-studio.mjs` (an installed Edge or Chrome, headless) |
| `packaging/`, the portable build scripts | `node scripts/build-studio.mjs`, then `node scripts/verify-studio.mjs` on the built archive |
| binary exports (PNG, APNG, GIF, ZIP) | also check with an independent image decoder |

## Rules

- **The same output on every JavaScript engine.** New randomness is seeded (craft's hashing), new maths is polynomial or `+ − × ÷` and `sqrt` with craft's trigonometry, never `Math.sin`, `Math.hypot` or the like, and steps, iterations and visiting orders are fixed.
- **Browser-compatible modules import no Node API.** The renderer never reads files: `resolve.js` does, on the Node side.
- **New fluid, powder or body physics follows [docs/physics-model.md](docs/physics-model.md)**: looks and satisfying motion first, then one set of units, one heat scale, one solid layer, one notion of air, one step order and a matter ledger, so features written apart still agree.
- **MCP tool code keeps no state between calls** other than files on disk; only `ping` and cancellations skip the queue.
- **`skills/pixel-art/SKILL.md` stays a short router.** A checklist for one kind of job goes in a section of `docs/agent-craft.md`; when the skill cites a new guide, add it to `DOCS` in `src/skill.js`.
- **Draft recovery in the studio stays in the browser**, never a server endpoint. Studio buttons mirror a CLI or MCP call.
- **Packaging adds nothing to `package.json`'s dependencies or `files`**, and its scripts only print or serve: they never edit a user's configuration. `scripts/deploy-playground.mjs` prepares a site change and never pushes.

## Checks

Run `npm test` after functional changes; while working, `npm run test:related -- <files>` is the quicker loop, and `npm run goldens` shows which pinned outputs moved. Tests and the studio walk never assert how long something takes, since a busy CI runner would fail them with nothing broken: hold the work instead (a count such as `renderProject`'s `stats`), and give a speed target a `budget` case in `scripts/bench.mjs`, which CI reports without failing. Keep the schema, authoring reference and runtime validation aligned. Keep what an agent reads on connect small: MCP tool schemas describe a recipe and each option briefly (the server validates them, and the guide topic explains every option), `pixel_help` returns the short quick start, and longer references are its topics; a test caps both. Binary export changes should also be checked with an independent image decoder. Do not replace the text-first workflow with a UI-only drawing tool.

Never silently overwrite source recipes or generated assets. MCP renders create unique folders. The preview server must stay on loopback with an explicit asset allowlist and no arbitrary file-writing endpoints.

## Commit and push workflow

The repository owner authorizes agents working on this project to commit completed changes and push directly to `main` by default. After reviewing the diff and passing the relevant checks (including `npm test` for functional changes), commit and push without asking for routine confirmation or opening a pull request. This is the standing workflow for this small project unless the user requests a different approach.

Before committing, inspect existing uncommitted changes and preserve them. Include changes from other agents when the user has authorized combining that work; otherwise leave unrelated work untouched. Fetch before pushing and integrate upstream changes without discarding local work. Never force-push, rewrite published history, reset away changes or delete branches as part of this authorization. Report the resulting commit and push status; if pushing fails, explain the concrete blocker.
