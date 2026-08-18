# 数据来源与署名（ATTRIBUTION）

HyiBody 使用的所有第三方数据及其许可证与署名要求。站内"署名页"（Attribution 界面）显示的文本以本文件为准。新增数据源前必须先在 docs/DECISIONS.md 记录并确认许可证（CLAUDE.md 数据铁律）。

## BodyParts3D 4.0

- 用途：骨骼、肌肉、血管、神经、器官、皮肤的基础网格与 FMA 层级
- 来源：NBDC 存档站 <https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html>
- 许可证：CC BY 4.0
- 署名文本（站内与文档统一使用）：

  > BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International

- 许可证页快照：`docs/licenses/`（由人类保存 PDF，见 KICKOFF 第 10 节）

## HuBMAP Human Reference Atlas 3D 参考器官

- 用途：心、肺、肝、肾、脑、胃肠、脾、胰、膀胱等"主角"器官的美观版本（M2-4 接入）
- 来源：<https://humanatlas.io/3d-reference-library>
- 许可证：CC BY 4.0
- 署名：HuBMAP Human Reference Atlas
- 注意：商用场景不使用其中的 Allen 脑模型（改用 BP3D 脑）

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
BodyParts3D 署名文本并显示在页面上。每个结构保留 `fma` 概念 ID 列表以便追溯。
原始数据不入库（`pipeline/raw/`，gitignore），直链与 sha256 记录于 `pipeline/config/sources.yaml`。

## 字体

界面中文字体为 **Noto Sans SC（思源黑体简体）**，由 Google 发布，许可证
**SIL Open Font License 1.1**。仓库中提交的是按本站实际用字（1,205 个字符）
子集化后的 woff2（`src/assets/fonts/`），源文件来自
<https://github.com/notofonts/noto-cjk>（`Sans/SubsetOTF/SC/`），
子集化脚本见 `scripts/build_font_subset.py`（`pnpm font:subset`）。
