# Pixelbolt

[English](https://github.com/skulitom/Pixelbolt/blob/main/README.md) · 简体中文 · [日本語](https://github.com/skulitom/Pixelbolt/blob/main/README.ja.md)

> 本文是英文 README 的中文摘要译本。功能细节、限制和最新变化以[英文 README](https://github.com/skulitom/Pixelbolt/blob/main/README.md) 为准。

**让 AI 智能体绘制、检查并修改像素画和精灵动画。** Pixelbolt 把可编辑的 JSON 配方（recipe）变成精灵、图块、图标、特效和短动画，并导出为 PNG 精灵表（sprite sheet）、纹理图集（texture atlas）、动画 PNG（APNG）、GIF，以及供视频剪辑软件使用的逐帧 PNG。智能体通过本地 MCP 服务器或命令行使用它；你也可以在本地浏览器工作室里查看和编辑同一份配方。

![用 Pixelbolt 绘制的图书馆：书本绕着吊灯飞舞，讲台上的书翻页，一只灰色虎斑猫在书架上睡觉](https://raw.githubusercontent.com/skulitom/Pixelbolt/main/showcase/gallery/library.gif)

![用 Pixelbolt 的流体编译器模拟的篝火：火焰从木柴上蹿起，火星飘起，烟雾卷曲散去](https://raw.githubusercontent.com/skulitom/Pixelbolt/main/showcase/fluid/campfire.gif) ![用 Pixelbolt 模拟的爆炸：白色闪光膨胀成橙色火球，上升、冷却并卷成烟雾](https://raw.githubusercontent.com/skulitom/Pixelbolt/main/showcase/fluid/explosion.gif)

火焰、烟雾、蒸汽、爆炸、魔法、水、蜂蜜和史莱姆都来自真正的流体模拟：在你自己的 CPU 上运行，用时远不到一秒，每一帧都烘焙成可以编辑的调色板像素，循环首尾无缝衔接（见英文 README 的 [Fluid effects](https://github.com/skulitom/Pixelbolt#fluid-effects)）。

- **适合谁：** 希望让 Claude、Codex、Cursor 等智能体绘制和修改像素画的游戏开发者、游戏开发马拉松（game jam）团队、网页或视频创作者，以及需要精确、可重复图像输出的智能体开发者。
- **什么时候用：** 你需要以文本形式保持可编辑的小型 2D 游戏素材时。智能体可以读回每一个像素，只修改一个像素或一帧而不必重画其余部分，同一份配方每次都渲染出完全相同的图像。
- **什么时候不用：** 绘画风格或照片类图像、大尺寸动画（动画每帧最多 256 × 256 像素；一个项目最多 256 帧，总计不超过 4,194,304 像素；只有一帧的静态图，例如 1920 × 1080 的背景或壁画，可在这个总量内每边最多 4096 像素）；用图像生成模型生成美术；编辑 GIF 或 Aseprite 文件（只支持导入每通道最多 8 位的 PNG）。

## 试用

需要 Node.js 20 或更新版本。无需安装任何依赖，无需 API 密钥，也不依赖任何网络服务：

```sh
git clone https://github.com/skulitom/Pixelbolt.git
cd Pixelbolt
node bin/pixelbolt.js preview --open
```

浏览器会打开本地工作室（默认地址 http://127.0.0.1:4747，端口被占用时会改用空闲端口并打印出来）。选择森林精灵、篝火或金币示例，编辑 JSON，查看动画或精灵表，然后下载素材 ZIP。

不打开浏览器也可以直接生成素材：

```sh
node bin/pixelbolt.js init hero.pixel.json
node bin/pixelbolt.js validate hero.pixel.json
node bin/pixelbolt.js inspect hero.pixel.json --out hero-frames.png
node bin/pixelbolt.js render hero.pixel.json --out output/hero
```

`node bin/pixelbolt.js gif hero.pixel.json --out hero.gif` 会把一个动画保存为便于分享的 GIF。除帮助信息和预览服务器外，命令结果都是 JSON；错误写到 stderr，退出码为 1。

## 交给智能体使用

**Claude Desktop：** 从最新发布（Release）下载 [`pixelbolt.mcpb`](https://github.com/skulitom/Pixelbolt/releases/latest/download/pixelbolt.mcpb) 并打开它（或在“设置 → 扩展”（Settings → Extensions）中从文件安装）。选择一个存放配方和生成素材的工作区，然后让智能体调用 `pixel_help`。

**Claude Code、Codex、Cursor 等 MCP 客户端：** 先克隆仓库，再把服务器加入智能体的 MCP 配置。把 `/absolute/path/to/Pixelbolt` 换成你的检出目录的绝对路径；在 Windows 上请使用正斜杠，例如 `C:/DEV/Pixelbolt`：

```json
{
  "mcpServers": {
    "pixelbolt": {
      "command": "node",
      "args": [
        "/absolute/path/to/Pixelbolt/bin/pixelbolt.js",
        "mcp",
        "--out",
        "/absolute/path/to/Pixelbolt/output"
      ]
    }
  }
}
```

使用 TOML 配置的客户端（如 Codex）：

```toml
[mcp_servers.pixelbolt]
command = "node"
args = ["/absolute/path/to/Pixelbolt/bin/pixelbolt.js", "mcp", "--out", "/absolute/path/to/Pixelbolt/output"]
```

Pixelbolt 已收录在官方 MCP Registry 中，名称为 `io.github.skulitom/pixelbolt`。

八个 MCP 工具：

- **`pixel_help`**：简短的快速入门（配方格式、操作、工具和工作流程）。从这里开始。传入 `topic` 可获取完整创作指南（`guide`）、美术工作流程（`workflow`）、配方的 JSON Schema（`schema`）、一个可编辑的完整示例（`example`），或 poses、scenes、autotile、fx、fluid、normals 各自的 Schema。
- **`pixel_validate`**：检查配方，报告尺寸、帧时长、动画和超出画布的位置；保存一个不可变的配方版本（revision），不导出素材。
- **`pixel_inspect`**：不导出素材，直接以帧总览图（contact sheet）查看每一帧；可选调色板键文本网格、剪影、灰度、洋葱皮视图和诊断信息。
- **`pixel_patch`**：用有针对性的编辑修改配方，例如改一个像素、一种颜色或某一帧，并返回改动了哪些像素和前后对比图。
- **`pixel_render`**：导出精灵表、图集 JSON、单帧 PNG、APNG 动画、CSS 和 Canvas 播放器；可选同时导出 GIF 和/或供视频剪辑使用的逐帧 PNG。每次调用写入一个新的文件夹。
- **`pixel_compile`**：把姿势（poses）源文件、自动图块（autotile）模板、粒子特效源文件、流体源文件（模拟的烟、火、爆炸、魔法、水，以及蜂蜜、史莱姆等黏稠液体）或法线贴图源文件编译成普通配方。
- **`pixel_scene`**：渲染场景清单（图块地图、素材摆放、光照等），可导出场景或逐帧 PNG。
- **`pixel_import`**：把原始分辨率的 PNG（RGB、RGBA、灰度或索引色，每通道最多 8 位）无损导入为可编辑配方。

每次成功的配方工具调用都会返回一个 `revision` 编号，之后的调用可以用它代替完整配方，不必重复发送。

## 一个小动画

```json
{
  "version": 1,
  "name": "slime",
  "width": 8,
  "height": 8,
  "palette": { "g": "#72b58d", "e": "#20383f" },
  "frames": [
    {
      "name": "rest",
      "duration": 180,
      "ops": [{ "op": "grid", "x": 1, "y": 3,
        "rows": [".gggg.", "ggeegg", "gggggg", ".gggg."] }]
    },
    { "name": "up", "from": "rest", "translate": [0, -1], "duration": 180 }
  ],
  "animations": { "bounce": { "frames": ["rest", "up"] } }
}
```

文本网格中的每个字符对应调色板里的一种颜色；`.` 和空格不改变像素。帧继承让小改动的描述成本很低。渲染是确定性的，只使用整数像素坐标。

## 导出内容

| 文件 | 用途 |
| --- | --- |
| `name.png` | RGBA PNG 精灵表 |
| `name.atlas.json` | TexturePacker 风格的 JSON 图集：矩形、锚点、帧时长、命名动画和 Aseprite 风格的帧标签 |
| `name.tres` | Godot 4 的 `SpriteFrames`（用于 `AnimatedSprite2D`），请与 `name.png` 放在同一文件夹 |
| `name.tileset.tres` | 仅限自动图块集：Godot 4 的 `TileSet`（用于 `TileMapLayer`），用地形绘制时选出的图块与 Pixelbolt 的图块地图相同；请与 `name.png` 放在同一文件夹 |
| `name.tsx` | 仅限自动图块集：[Tiled](https://www.mapeditor.org) 图块集，每种地形一个 Wang 集，用地形笔刷绘制时选出的图块与 Pixelbolt 的图块地图相同；请与 `name.png` 放在同一文件夹 |
| `frames/*.png` | 每一帧的透明 PNG |
| `animations/*.png` | 每个动画的 APNG，保留透明度和帧时长 |
| `name.css` | CSS 动画类 |
| `player.js` | 无依赖的小型 Canvas 播放器 |
| `name.pixel.json` | 可编辑的源配方 |
| `preview.html` | 可直接在浏览器中打开的独立预览页 |

## 更多文档（英文）

- [英文 README](https://github.com/skulitom/Pixelbolt/blob/main/README.md)：完整的命令、导出、JavaScript API 和便携版说明
- [创作指南](https://github.com/skulitom/Pixelbolt/blob/main/docs/agent-guide.md)：配方字段、绘图操作和限制
- [像素画技能](https://github.com/skulitom/Pixelbolt/blob/main/skills/pixel-art/SKILL.md)：可复用的创作与检查流程
- [示例](https://github.com/skulitom/Pixelbolt/tree/main/examples)和[作品展示](https://github.com/skulitom/Pixelbolt/blob/main/showcase/gallery/README.md)
- [llms.txt](https://github.com/skulitom/Pixelbolt/blob/main/llms.txt)：面向智能体的文档索引

## 同一作者的其他工具

以下工具同样免费、采用 MIT 许可证，都在本地运行并可作为 MCP 服务器使用：

- [Anode](https://github.com/skulitom/Anode)：在隐藏的后台会话中进行 Windows 桌面自动化，智能体可以点击、输入和截图，而不会占用你的屏幕。
- [Cutbolt](https://github.com/skulitom/Cutbolt)：视频剪辑引擎，提供精确的时间线、字幕和渲染。
- [Inkbolt](https://github.com/skulitom/Inkbolt)：用于图表和插画的矢量与位图编辑，可导入 SVG，并导出 SVG 或 PDF。
- [Nestbolt](https://github.com/skulitom/Nestbolt)：为激光、CNC、等离子和水刀切割在板材上排布零件的 2D 排样工具，也可以[在浏览器中使用](https://skulitom.github.io/Nestbolt/)。

## 许可证

[MIT 许可证](https://github.com/skulitom/Pixelbolt/blob/main/LICENSE)。仓库中的美术作品均为原创，采用同一许可证。
