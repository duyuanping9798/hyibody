# 数据来源与署名（ATTRIBUTION）

HyiBody 使用的所有第三方数据及其许可证与署名要求。站内"署名页"（Attribution 界面）显示的文本以本文件为准。新增数据源前必须先在 docs/DECISIONS.md 记录并确认许可证（CLAUDE.md 数据铁律）。

## BodyParts3D 4.0

- 用途：骨骼、肌肉、血管、神经、器官、皮肤的基础网格与 FMA 层级
- 来源：NBDC 存档站 <https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html>
- 许可证：CC BY 4.0
- 署名文本（站内与文档统一使用）：

  > BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International

- 许可证页快照：`docs/licenses/`（由人类保存 PDF，见 KICKOFF 第 10 节）

## HuBMAP Human Reference Atlas 3D 参考器官（已接入）

- 用途：解剖结构分件、内部件齐全的"主角"器官。2026-08-18 起以下结构已换成 HRA 版：
  **心脏**（四腔、室间隔、四个瓣膜、乳头肌）、**气管**（软骨环、隆嵴）、
  **喉软骨**（甲状软骨/环状软骨/会厌软骨）、**胰腺**（胰头/胰体/胰尾）、**脾**、
  **肾**（皮质/锥体/肾门）。其余器官仍为 BodyParts3D
- **肺没有换**：HRA 的 `lung-male` 里只有支气管树与肺门，没有肺实质
- 另外下载 `skin-male`（全身皮肤）**只用于计算两具身体的身高比**（全局定标 ×0.9425），
  不进产物、不显示
- 来源：<https://humanatlas.io/3d-reference-library>；
  目录接口 <https://apps.humanatlas.io/api/v1/reference-organs>；
  资产直链与 sha256 记录于 `pipeline/config/sources_hra.yaml`
- 许可证：CC BY 4.0（各 digital object 的 `metadata.json` 里都写着这一条，例：
  <https://cdn.humanatlas.io/digital-objects/ref-organ/heart-male/v1.3/metadata.json>）
- 署名文本（站内与文档统一使用）：

  > 3D Reference Organs from the Human Reference Atlas (HRA), HuBMAP Consortium
  > — Kristen Browne (NIH/NIAID) — licensed under CC BY 4.0

- 只取 **Male** 版本：本站骨骼/肌肉来自 BodyParts3D 的男性模型，混性别会前后矛盾
- **明确不取 `brain-male`（`3d-allen-m-brain.glb`）**：它派生自 Allen 脑图谱，
  许可证不在允许清单里（脑继续用 BodyParts3D 的）。`pipeline/tests/test_hra.py`
  有一条测试盯着这件事

## CC0 体表网格（可选，M2）

- 用途：替换 BP3D 有孔洞的皮肤
- 来源：Blender Studio Human Base Meshes 或 MakeHuman/MPFB2 资产
- 许可证：CC0，无需署名（仍在此登记以便追溯）

## Wikidata

- 用途：中文/拉丁名初稿（P1402 FMA ID → zh 标签），人工校对后使用
- 许可证：CC0

## 禁止来源（不得进入仓库或产物）

Z-Anatomy 网格与层级（CC BY-SA）、Open3DModel（CC BY-SA）、任何 NC/ND/需协议数据（Allen、BigBrain、MedShapeNet、Dundee NC 素材、ViP/MIDA、CVH 等）。

## 当前状态

M1 起站点资产（`public/assets/*.glb` + `manifest.json`）由数据流水线从 BodyParts3D 4.0
生成（isa 集细分部件 + partof 集复合器官），`manifest.json` 的 `attribution` 字段携带上述
BodyParts3D 署名文本并显示在页面上；用到 HRA 网格时 `attribution` 里同时带上 HRA 署名
（`pipeline/validate.py` 有一条检查盯着"用了 HRA 就必须署 HRA"）。
每个结构保留本体 id：BodyParts3D 结构用 `fma`，HRA 结构额外带 `uberon`
（室间隔这类 BP3D 没有的概念只有 `uberon`）。
原始数据不入库（`pipeline/raw/`，gitignore），直链与 sha256 记录于
`pipeline/config/sources.yaml`（BodyParts3D）与 `pipeline/config/sources_hra.yaml`（HRA）。

## 字体

界面中文字体为 **Noto Sans SC（思源黑体简体）**，由 Google 发布，许可证
**SIL Open Font License 1.1**。仓库中提交的是按本站实际用字
子集化后的 woff2（`src/assets/fonts/`，当前 1,242 个字符），源文件来自
<https://github.com/notofonts/noto-cjk>（`Sans/SubsetOTF/SC/`），
子集化脚本见 `scripts/build_font_subset.py`（`pnpm font:subset`）。
