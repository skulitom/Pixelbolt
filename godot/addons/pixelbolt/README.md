# Pixelbolt for Godot

Copy this folder to your project's `addons/pixelbolt/`, then enable **Pixelbolt**
under **Project Settings → Plugins**. Requires Node.js 20+ and the Pixelbolt CLI.
No executable is bundled and no network download is enabled by default.

Recipes import automatically as **SpriteFrames**, ready for an AnimatedSprite2D.
Compiler sources (including poses and autotiles) compile first. Select
**Import As → Pixelbolt TileSet** in the Import dock for tile sets.
The addon reads the CLI's exported resources, including timing, trim margins and
tile properties. All generated data is embedded under `.godot/`.

Use `.pixelbolt` on Godot 4.3+. Godot 4.5+ also supports `.pixel.json`,
including `hero.poses.pixel.json`. Ordinary `.json` files are never claimed.
Tested headlessly on Windows with Godot 4.3, 4.7.2 and 4.8-beta4, and on Linux
with 4.3 and 4.7.2; not yet on macOS.

Project Settings, with **Advanced Settings** enabled:

| Setting under Pixelbolt | Default and meaning |
| --- | --- |
| Cli / Path | Empty. A CLI executable or `bin/pixelbolt.js`, absolute or relative to the project. |
| Cli / Node Path | Empty: `node` on PATH. Used for JavaScript CLI scripts. |
| Cli / Allow Npx | Off. Explicit opt-in to downloading and executing a pinned npm package. |
| Cli / Npx Version | This addon's version; an exact version, never `latest`. |
| Import / Timeout Seconds | 120, shared by compile and render. |

Discovery order: configured CLI, project `node_modules/pixelbolt/bin/pixelbolt.js`,
`pixelbolt` on PATH, then opt-in `npx`. Windows npm global scripts are run
directly through Node when available; other `.cmd`/`.bat` files use `cmd.exe`.
Batch commands reject paths containing `%`, `^`, quotes or newlines to prevent
shell expansion; point Cli / Path directly at `bin/pixelbolt.js` in that case.
The resolved package version and source path are saved in the resource's
`pixelbolt` metadata. Unidentifiable executable versions are `unknown`.

The import option **Texture Filter → Nearest** embeds a CanvasTexture with nearest
filtering. CanvasTexture draws only in 2D. For AnimatedSprite3D, choose **Inherit**
and set the node's texture filter to Nearest. Inherit uses a plain ImageTexture.

On failure, look for `Pixelbolt: res://…:` in Output. A previous successful import
is retained; a first failure is reported to Godot. Fix the recipe or CLI settings,
then use **Project → Tools → Pixelbolt: Reimport all recipes**. Use this command
also after updating Pixelbolt or changing a referenced palette. The source recipe
itself is reimported automatically when edited. Relative palette references are
resolved from the recipe's folder.

If Node is missing in an editor launched from a desktop shortcut, set its full
path. If a tile recipe has no animations, choose the TileSet importer. On timeout
the CLI and every process it started are terminated, and the temporary
render folder is removed. A failed import prints one red line in the Output, which
Godot counts as an error, and says whether the previous import was kept.
