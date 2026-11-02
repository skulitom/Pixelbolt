# Pixelbolt browser playground

A static, dependency-free recipe editor and pixel preview. A module worker loads the browser-compatible engine from jsDelivr, compiles and renders recipes, and makes downloads locally. No build step, API server, cookies or analytics. Recipes in links stay in the URL fragment. PNGs carry their original source and engine version.

## Try locally

From the repository root, run `python -m http.server 8000 --bind 127.0.0.1` and open `http://127.0.0.1:8000/playground/`.
For an offline engine test, open `http://127.0.0.1:8000/playground/?engine=../src/` instead. The local source may differ from the version label: this override is for testing only. It also loads examples from the local `examples/` folder.
On a loopback page, `&limit=1000` lowers the 20-second render limit (never raises it), to test the stop.

Alternatively, run `node scripts/deploy-playground.mjs <tmp>` and serve that output with any static HTTP server. Do not open `index.html` as a file: module workers need HTTP. Use HTTPS when publishing. The page needs module workers, Canvas, Web Crypto, CompressionStream and DecompressionStream (including `deflate-raw`).

The `?engine=` override accepts only the page's own origin, or loopback-to-loopback URLs (`localhost`, `127.0.0.1`, `[::1]`). The page's meta CSP restricts its own connections and scripts to self and jsDelivr, but a meta tag doesn't reach the worker: workers take CSP only from response headers, and GitHub Pages sends none. So the worker checks every engine and example address itself before loading it (`engineAllowed` in `lib.js`): jsDelivr's `pixelbolt` package, the page's origin, or loopback on both URLs, with no credentials, query or fragment. A cross-origin loopback engine therefore needs a test server with a suitably adjusted CSP and CORS; the ordinary same-origin override needs neither.

## Live fluid toy

`fluids/` is **Poke the pixels**, at `/playground/fluids/`: seven fluid presets run live with the released engine's `createLiveFluid`. Dragging pushes, holding pours (a liquid) or adds heat (a gas), **Save GIF** keeps the last four seconds blended onto the stage colour, and **Copy link** makes a link that replays the visitor's pokes on the same frames, so whoever opens it sees exactly what they saw. **Edit the recipe** opens the preset in the playground. Try it locally at `http://127.0.0.1:8000/playground/fluids/?engine=../../src/`.

- `fluids/lib.js` holds the presets, the pokes and the link format: `#v=<version>&p=<preset>&i=<base64url of deflate(pokes)>`, with a format byte inside `i`. Links name a preset by id, so renaming or removing a preset breaks the links that name it. Keep `TOY_VERSION` equal to `PINNED_VERSION` (a test checks), and bump the two together.
- A preset belongs in the toy only if it keeps working however long it is poked: a one-shot effect repeats every cycle in a live run, and an obstacle key (the dam break's plank) comes back each cycle.
- On a loopback page, `globalThis.fluidToy.advance(frames)` steps frames without animation frames, for tests in a hidden browser tab.
- `preview.png` is the 1200 × 630 link card: `node scripts/fluid-toy-preview.mjs --force` draws it again from the engine.

## Publish

1. Prepare a local checkout of the site's `gh-pages` branch in a separate folder.
2. Run `node scripts/deploy-playground.mjs <out>` with that folder as `<out>`.
3. Review the copied `playground/`, the new sitemap entries (the playground and `playground/fluids/`) and the paragraphs on the home page: the playground's after the GitHub source link, and the fluid toy's after that. The script changes existing files only where needed and is idempotent. It never runs git or pushes. Missing home pages or sitemaps are left absent.
4. Run the exact `git -C` add, commit and push commands printed by the script. If a home page or sitemap was absent, omit that missing path from the add command.
5. Check `https://skulitom.github.io/Pixelbolt/playground/`, including a share link, a PNG round trip and downloads, and `…/playground/fluids/`: poke an effect, save a GIF, and open a copied link in a new tab to see it replay. Check narrow screens, light/dark modes, reduced motion and keyboard controls. Atlas export downloads two files; explicit links remain for two minutes if the browser blocks a second automatic download.

After deployment, add this exact Markdown directly under the README's first paragraph:

```markdown
[Try it in your browser](https://skulitom.github.io/Pixelbolt/playground/): render, export and share recipes with nothing installed.
```

## Versions and sharing

`PINNED_VERSION` in `app.js` is `0.11.0`. Engines load from `https://cdn.jsdelivr.net/npm/pixelbolt@<version>/src/`; examples come from that version's `examples/`. Share links and PNGs select the version they name, with an explicit button to switch to the pin. A version must be plain x.y.z and at least 0.9.0. An unavailable release produces an error instead of silently using a different engine.

To bump the default, publish the engine release first, update `PINNED_VERSION` and the fluid toy's `TOY_VERSION` together, then run `node --test test/playground.test.js test/share.test.js test/fluid-toy.test.js` and the whole `node --test` suite. Test live rendering and exports with the published release before deploying again. Examples are filtered by `minVersion`: honey and slime appear from 0.9.1, and the spell and water effects from 0.9.2 (or when a shared recipe selects such a version). The 0.9.2 wave examples are not listed: the playground has no wave compiler yet (`render.js` would need `wave` among its engine modules).

`LINK_LIMIT` is **16,384 characters**, including the base URL and fragment. Larger recipes should travel as a JSON file or a playground PNG. A PNG carries its recipe up to `EMBED_LIMIT` (1 MiB, the most Pillow opens); a larger one is left out of the PNG with a warning. Recipe text and unpacked shares have a 16 MiB limit. Each worker request has a 20-second deadline; Cancel terminates the worker immediately. A new edit supersedes pending work. Scenes use 100 ms steps and stop at 240 frames, with a warning if truncated.

`playground/share.js` must stay byte-identical to `src/share.js` until the pin reaches a release that ships `src/share.js`; then the page may load it from the engine instead. Keep the independent PNG chunk and link compatibility tests when changing the deployment.

The `playground/` directory and deploy script are excluded from the npm package by its existing `files` allowlist. Deployment copies everything in `playground/` except this guide; no engine sources are bundled.
