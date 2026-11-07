Pixelbolt sprite sheets in Unreal Engine Paper2D: the test behind the guide
https://skulitom.github.io/Pixelbolt/guides/unreal-paper2d-sprite-sheets/

Run on 7 November 2026 with Unreal Engine 5.8.4 (an installed build, Windows 11), Pixelbolt 0.12.1 and 0.9.2 from
npm, Node.js 24 and Python 3.13 with Pillow 12.

Files
  make_sheets.sh        builds the seven test sheets (src/ recipes, out/<name>/ bundles) from Pixelbolt's examples
  P2DDefault.uproject   throwaway project with Unreal's default plugins, Python Editor Script on, and Fab, Bridge,
                        EditorTelemetry and RuntimeTelemetry off
  P2DTest.uproject      throwaway project with every engine plugin off but Paper2D and Python Editor Script
  ue_check.py           runs inside the editor: the guide's script on each sheet, then records what Paper2D built
  check_results.py      compares that record with each atlas (needs Pillow, an image decoder independent of Pixelbolt)
  out/                  the seven sheets as tested: name.png and name.atlas.json
  results-default/      ue_check.py's record per sheet in P2DDefault, the stored textures exported back as PNG,
                        and check.json
  results/              the same for P2DTest
  log-excerpts.txt      the import, script and warning lines from the editor logs
  searches-2026-11-07.txt   the five searches the guide answers, and what ranked
  ../pixelbolt_paper2d.py   the guide's script (MIT)

To reproduce, in a folder holding these files with ../pixelbolt_paper2d.py copied beside them:
  Git Bash:   bash make_sheets.sh
  cmd.exe:    set P2D_ROOT=<this folder>
              set P2D_OUT=<this folder>\results-default
              "<Unreal>\Engine\Binaries\Win64\UnrealEditor-Cmd.exe" "<this folder>\P2DDefault.uproject" -ExecutePythonScript="<this folder>\ue_check.py" -RenderOffScreen -nullrhi -unattended -nosplash -nosound
              python check_results.py <this folder> <this folder>\results-default
  (For P2DTest.uproject, set P2D_OUT to <this folder>\results.)

-RenderOffScreen makes the editor open no window, -nullrhi keeps it off the GPU (so nothing is drawn: the checks read
what Paper2D stored, not what it renders) and -unattended makes it answer any dialog by itself. We also pointed the
editor's derived data cache at a folder of its own (-DDC=(Local=(Type=FileSystem,Path=<folder>))) so it left the
machine's shared cache alone; that is optional. The runs took about 30 seconds (P2DDefault) and 16 (P2DTest) from launch to exit, by the log
timestamps.

The console form the guide gives was run in P2DDefault through
-ExecCmds="py <kit>/pixelbolt_paper2d.py <kit>/out/hero/hero.atlas.json /Game/Sprites/Hero,QUIT_EDITOR":
into a new folder (44 assets), into the same folder again (the script stops: "already holds assets", still 44), and
into /Game/Sprites/Hero2 (44).

What the check compares, for each of the seven sheets (235 frames, 26 animations):
  - one Texture, one Sprite Sheet, one Sprite per frame and one Flipbook per animation, all saved to disk;
  - the texture's stored pixels, exported back to PNG, against the Pixelbolt sheet (Pillow, RGBA), its size and its
    settings: 2D Pixels group, Uncompressed (RGBA8), Filter from the group, NoMipmaps, sRGB;
  - each sprite's rectangle, trim offset and untrimmed size against the atlas, and its pixels per unit (1);
  - where the pivot sits on the frame's canvas, worked out from every vertex of Paper2D's baked geometry: on the
    frame's anchor when the atlas has one, on the canvas centre otherwise;
  - the material Paper2D chose against the frame's alpha (masked when every pixel is fully opaque or fully clear,
    translucent otherwise);
  - each flipbook's frame rate, key frame count and length (to within 0.01 ms), and the sprite it returns for the
    middle of every frame.
All seven passed in both projects (results-default/check.json, results/check.json). The explosion's 512 x 256 sheet
came in with Mip Gen Settings "FromTextureGroup" (its sides are powers of two); the script set NoMipmaps, as its log
line shows.
