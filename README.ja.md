# Pixelbolt

[English](https://github.com/skulitom/Pixelbolt/blob/main/README.md) · [简体中文](https://github.com/skulitom/Pixelbolt/blob/main/README.zh-CN.md) · 日本語

> これは英語版 README の日本語による要約です。機能の詳細、制限、最新の変更は[英語版 README](https://github.com/skulitom/Pixelbolt/blob/main/README.md) を参照してください。内容が異なる場合は英語版 README を優先してください。

**AI エージェントが作り、確かめ、直せるピクセルアートとスプライトアニメーション。** Pixelbolt は編集可能な JSON レシピから、スプライト、タイル、アイコン、エフェクト、短いアニメーションを作り、PNG スプライトシート、テクスチャアトラス、アニメーション PNG（APNG）、GIF、動画編集ソフト向けの連番 PNG として書き出します。エージェントはローカルの MCP サーバーまたはコマンドラインから使います。同じレシピは、ローカルのブラウザスタジオで確認・編集することもできます。

![Pixelbolt で描いた図書館：シャンデリアの周りを本が回り、書見台の本がページをめくり、棚の上でグレーのトラ猫が眠っている](https://raw.githubusercontent.com/skulitom/Pixelbolt/main/showcase/gallery/library.gif)

![Pixelbolt の流体コンパイラでシミュレーションしたたき火：薪から炎が立ちのぼり、火の粉が舞い、煙が渦を巻いて消えていく](https://raw.githubusercontent.com/skulitom/Pixelbolt/main/showcase/fluid/campfire.gif) ![Pixelbolt でシミュレーションした爆発：白い閃光がオレンジの火球に膨らみ、上昇し、冷えて煙になる](https://raw.githubusercontent.com/skulitom/Pixelbolt/main/showcase/fluid/explosion.gif)

炎、煙、蒸気、爆発、魔法、水、はちみつ、スライムは本物の流体シミュレーションから生まれます。手元の CPU で 1 秒もかからずに計算され、各フレームは編集できるパレットのピクセルとして焼き込まれ、ループは継ぎ目なくつながります（英語版 README の [Fluid effects](https://github.com/skulitom/Pixelbolt#fluid-effects) を参照）。

- **対象：** Claude、Codex、Cursor などのエージェントにピクセルアートを描かせたり直させたりしたいゲーム開発者、ゲームジャムのチーム、Web や動画の制作者、そして正確で再現性のある画像出力を必要とするエージェント開発者。
- **向いている用途：** テキストのまま編集可能な小さな 2D ゲーム素材が欲しいとき。エージェントはすべてのピクセルを読み戻し、残りを描き直さずに 1 ピクセルや 1 フレームだけを直せます。同じレシピからは毎回まったく同じ画像が描かれます。
- **向いていない用途：** 絵画風・写真風の画像や大きな画像（1 フレームは最大 256 × 256 ピクセル、1 プロジェクトは最大 256 フレームで合計 4,194,304 ピクセルまで）、画像生成モデルによるアート生成、GIF や Aseprite ファイルの編集（取り込めるのは 8 ビット RGB/RGBA PNG のみ）。

## 試してみる

Node.js 20 以降が必要です。依存パッケージのインストール、API キー、ネットワークサービスは不要です：

```sh
git clone https://github.com/skulitom/Pixelbolt.git
cd Pixelbolt
node bin/pixelbolt.js preview --open
```

ブラウザでローカルスタジオが開きます（通常は http://127.0.0.1:4747。ポートが使用中なら空いているポートを使い、そのアドレスを表示します）。森の精霊、焚き火、コインのサンプルを選び、JSON を編集し、アニメーションやスプライトシートを確認して、素材の ZIP をダウンロードできます。

ブラウザを開かずに素材を作ることもできます：

```sh
node bin/pixelbolt.js init hero.pixel.json
node bin/pixelbolt.js validate hero.pixel.json
node bin/pixelbolt.js inspect hero.pixel.json --out hero-frames.png
node bin/pixelbolt.js render hero.pixel.json --out output/hero
```

`node bin/pixelbolt.js gif hero.pixel.json --out hero.gif` は 1 つのアニメーションを共有用の GIF として保存します。ヘルプとプレビューサーバー以外のコマンド結果は JSON です。エラーは stderr に出力され、終了コードは 1 になります。

## エージェントに渡す

**Claude Desktop：** 最新リリースから [`pixelbolt.mcpb`](https://github.com/skulitom/Pixelbolt/releases/latest/download/pixelbolt.mcpb) をダウンロードして開きます（または 設定 → 拡張機能 からファイルでインストールします）。レシピと生成した素材を置くワークスペースを選び、エージェントに `pixel_help` を呼ぶよう頼んでください。

**Claude Code、Codex、Cursor などの MCP クライアント：** まずリポジトリをクローンし、エージェントの MCP 設定にサーバーを追加します。`/absolute/path/to/Pixelbolt` はチェックアウトした場所の絶対パスに置き換えてください。Windows ではスラッシュを使います（例：`C:/DEV/Pixelbolt`）：

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

TOML で設定するクライアント（Codex など）：

```toml
[mcp_servers.pixelbolt]
command = "node"
args = ["/absolute/path/to/Pixelbolt/bin/pixelbolt.js", "mcp", "--out", "/absolute/path/to/Pixelbolt/output"]
```

Pixelbolt は公式 MCP Registry に `io.github.skulitom/pixelbolt` として登録されています。

8 つの MCP ツール：

- **`pixel_help`**：短いクイックスタート（レシピ形式、操作、ツール、作業の流れ）。まずここから始めます。`topic` を指定すると、オーサリングガイド全体（`guide`）、アートワークフロー（`workflow`）、レシピの JSON Schema（`schema`）、そのまま編集できるサンプル（`example`）、または poses・scenes・autotile・fx・fluid・normals の各スキーマを返します。
- **`pixel_validate`**：レシピを検証し、サイズ、フレームの表示時間、アニメーション、キャンバスからはみ出した位置を報告します。変更不可のレシピのリビジョンを保存し、素材は書き出しません。
- **`pixel_inspect`**：素材を書き出さずに、全フレームをコンタクトシートで確認します。パレットキーのテキストグリッド、シルエット、グレースケール、オニオンスキン表示、診断情報も選べます。
- **`pixel_patch`**：1 ピクセル、1 色、1 フレームなど、狙った部分だけを編集してレシピを直し、変わったピクセルと前後比較の画像を返します。
- **`pixel_render`**：スプライトシート、アトラス JSON、フレームごとの PNG、APNG アニメーション、CSS、Canvas プレーヤーを書き出します。GIF や動画編集用の連番 PNG も同時に書き出せます。呼び出しごとに新しいフォルダーに書き込みます。
- **`pixel_compile`**：ポーズ（poses）ソース、オートタイル（autotile）テンプレート、パーティクルエフェクトのソース、流体ソース（シミュレーションした煙、炎、爆発、魔法、水、はちみつやスライムのような粘り気のある液体）、法線マップのソースを通常のレシピにコンパイルします。
- **`pixel_scene`**：シーンマニフェスト（タイルマップ、素材の配置、ライティングなど）を描画し、シーンや連番 PNG として書き出せます。
- **`pixel_import`**：原寸の 8 ビット RGB/RGBA PNG を、ピクセルを変えずに編集可能なレシピとして取り込みます。

レシピを扱うツールは成功するたびに `revision` ID を返します。以降の呼び出しではレシピ全体の代わりにこの ID を渡せるので、レシピを何度も送る必要はありません。

## 小さなアニメーション

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

テキストグリッドの各文字がパレットの色を選びます。`.` と空白はピクセルを変えません。フレームの継承により、小さな変更を短く書けます。描画は決定論的で、整数のピクセル座標だけを使います。

## 書き出されるファイル

| ファイル | 用途 |
| --- | --- |
| `name.png` | RGBA PNG スプライトシート |
| `name.atlas.json` | TexturePacker 形式の JSON アトラス：矩形、アンカー、フレームの表示時間、名前付きアニメーション |
| `frames/*.png` | 各フレームの透過 PNG |
| `animations/*.png` | アニメーションごとの APNG（透過とフレームの表示時間を保持） |
| `name.css` | CSS アニメーションのクラス |
| `player.js` | 依存のない小さな Canvas プレーヤー |
| `name.pixel.json` | 編集可能なソースレシピ |
| `preview.html` | ブラウザで直接開けるプレビューページ |

## その他のドキュメント（英語）

- [英語版 README](https://github.com/skulitom/Pixelbolt/blob/main/README.md)：コマンド、書き出し、JavaScript API、ポータブル版の詳しい説明
- [オーサリングガイド](https://github.com/skulitom/Pixelbolt/blob/main/docs/agent-guide.md)：レシピのフィールド、描画操作、制限
- [ピクセルアートのスキル](https://github.com/skulitom/Pixelbolt/blob/main/skills/pixel-art/SKILL.md)：再利用できる制作と確認の手順
- [サンプル](https://github.com/skulitom/Pixelbolt/tree/main/examples)と[ギャラリー](https://github.com/skulitom/Pixelbolt/blob/main/showcase/gallery/README.md)
- [llms.txt](https://github.com/skulitom/Pixelbolt/blob/main/llms.txt)：エージェント向けのドキュメント索引

## 同じ作者のツール

どれも無料で MIT ライセンス、ローカルで動き、MCP サーバーとして使えます：

- [Anode](https://github.com/skulitom/Anode)：隠れたバックグラウンドセッションで Windows デスクトップを自動操作します。エージェントがクリック、入力、スクリーンショットをしても、あなたの画面は奪われません。
- [Cutbolt](https://github.com/skulitom/Cutbolt)：正確なタイムライン、字幕、レンダリングを備えた動画編集エンジン。
- [Inkbolt](https://github.com/skulitom/Inkbolt)：図やイラスト向けのベクター画像・ラスター画像の編集。SVG を取り込み、SVG または PDF で書き出せます。
- [Nestbolt](https://github.com/skulitom/Nestbolt)：レーザー、CNC、プラズマ、ウォータージェット切断向けに、板材へ部品を配置する 2D ネスティング。[ブラウザでも使えます](https://skulitom.github.io/Nestbolt/)。

## ライセンス

[MIT ライセンス](https://github.com/skulitom/Pixelbolt/blob/main/LICENSE)。同梱のアートワークはオリジナルで、同じライセンスが適用されます。
