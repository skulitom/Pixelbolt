# Pixelbolt browser playground

A static, dependency-free recipe editor and pixel preview. A module worker loads the browser-compatible engine from jsDelivr, compiles and renders recipes, and makes downloads locally. No build step, API server, cookies or analytics. Recipes in links stay in the URL fragment. PNGs carry their original source and engine version.

## Try locally

From the repository root, run `python -m http.server 8000 --bind 127.0.0.1` and open `http://127.0.0.1:8000/playground/`.
For an offline engine test, open `http://127.0.0.1:8000/playground/?engine=../src/` instead. The local source may differ from the version label: this override is for testing only. It also loads examples from the local `examples/` folder.
On a loopback page, `&limit=1000` lowers the 20-second render limit (never raises it), to test the stop.

Alternatively, run `node scripts/deploy-playground.mjs <tmp>` and serve that output with any static HTTP server. Do not open `index.html` as a file: module workers need HTTP. Use HTTPS when publishing. The page needs module workers, Canvas, Web Crypto, CompressionStream and DecompressionStream (including `deflate-raw`).

The `?engine=` override accepts only the page's own origin, or loopback-to-loopback URLs (`localhost`, `127.0.0.1`, `[::1]`). The production CSP also restricts connections and scripts to self and jsDelivr. A cross-origin loopback engine therefore needs a test server with a suitably adjusted CSP and CORS; the ordinary same-origin override needs neither.

## Publish

1. Prepare a local checkout of the site's `gh-pages` branch in a separate folder.
2. Run `node scripts/deploy-playground.mjs <out>` with that folder as `<out>`.
3. Review the copied `playground/`, the new sitemap entry and the paragraph after the GitHub source link on the home page. The script changes existing files only where needed and is idempotent. It never runs git or pushes. Missing home pages or sitemaps are left absent.
4. Run the exact `git -C` add, commit and push commands printed by the script. If a home page or sitemap was absent, omit that missing path from the add command.
5. Check `https://skulitom.github.io/Pixelbolt/playground/`, including a share link, a PNG round trip and downloads. Check narrow screens, light/dark modes, reduced motion and keyboard controls. Atlas export downloads two files; explicit links remain for two minutes if the browser blocks a second automatic download.

After deployment, add this exact Markdown directly under the README's first paragraph:

```markdown
[Try it in your browser](https://skulitom.github.io/Pixelbolt/playground/): render, export and share recipes with nothing installed.
```

## Versions and sharing

`PINNED_VERSION` in `app.js` is `0.9.0`. Engines load from `https://cdn.jsdelivr.net/npm/pixelbolt@<version>/src/`; examples come from that version's `examples/`. Share links and PNGs select the version they name, with an explicit button to switch to the pin. A version must be plain x.y.z and at least 0.9.0. An unavailable release produces an error instead of silently using a different engine.

To bump the default, publish the engine release first, update the one `PINNED_VERSION` constant, then run `node --test test/playground.test.js test/share.test.js` and the whole `node --test` suite. Test live rendering and exports with the published release before deploying again. Examples are filtered by `minVersion`; honey and slime appear once the pin reaches 0.9.1 (or when a shared recipe selects that version).

`LINK_LIMIT` is **16,384 characters**, including the base URL and fragment. Larger recipes should travel as a JSON file or a playground PNG. Recipe text and unpacked shares have a 16 MiB limit. Each worker request has a 20-second deadline; Cancel terminates the worker immediately. A new edit supersedes pending work. Scenes use 100 ms steps and stop at 240 frames, with a warning if truncated.

`playground/share.js` must stay byte-identical to `src/share.js` until the pin reaches a release that ships `src/share.js`; then the page may load it from the engine instead. Keep the independent PNG chunk and link compatibility tests when changing the deployment.

The `playground/` directory and deploy script are excluded from the npm package by its existing `files` allowlist. Deployment copies everything in `playground/` except this guide; no engine sources are bundled.
