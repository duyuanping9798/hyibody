# CLAUDE.md — HyiBody

本文件是 Claude Code 在本仓库工作的长期规则。每个会话开始时先读本文件、`docs/KICKOFF.md`（项目蓝图与任务）和 `docs/STATUS.md`（当前进度），结束前必须更新 `docs/STATUS.md` 并 commit + push。

## 项目一句话

HyiBody 是一个纯静态、轻量的三维人体"透视"科普网页：几百个核心解剖结构分层显示（皮肤→肌肉→骨骼→器官→血管/神经），点击识别、剖切、搜索、故事线引导游览，同一份代码全屏跑在展厅触摸屏上。不是医学级图谱，不做病人影像。

## 范围与非目标

做：三维分层查看器、约 300–600 个核心结构、中英文名与一句话科普、故事线（Tour）、展厅模式（Kiosk）、分享链接/二维码、PWA 离线、GitHub Pages 部署。
不做（除非 KICKOFF.md 改动）：WebGPU、顺序无关透明、万级结构优化、医学影像/DICOM、病人个体化分割、TA2/FMA 全量本体映射、VR、原生 App、后端与账号系统。

## 技术栈（固定，不要擅自更换）

pnpm + Vite + TypeScript(strict) + three.js（WebGL2 路径，`WebGLRenderer`）+ React 18/19（仅 UI）+ Zustand（UI 状态）+ Vitest + Playwright（无头截图冒烟）+ ESLint/Prettier。数据流水线：Python 3.11（trimesh、numpy、pymeshlab、fast-simplification、pygltflib、pyyaml）+ `@gltf-transform/cli`。不引入 R3F/drei/Babylon/Unity/Blender 依赖。

## 目录约定

```
src/viewer/     纯 three.js 渲染核心（禁止 import React），对外暴露 HyiViewer 类
src/ui/         React 界面（面板、滑块、卡片、搜索、Tour 播放器、Kiosk）
src/data/       类型定义、manifest/hierarchy 加载器、URL 状态编解码
src/tours/      故事线播放引擎（读取 content/tours/*.json）
content/        结构清单、术语、定义、故事线（JSON/YAML，人可编辑）
pipeline/       Python 数据流水线（download / select / process / export / validate）
prototype/      效果图原型（process.py + index.html + shot.mjs），只读参考，不再维护
public/assets/  流水线产物：按系统分包的 .glb + manifest.json（提交到仓库，单文件 < 50 MB）
docs/           KICKOFF.md STATUS.md DECISIONS.md ATTRIBUTION.md
.github/workflows/  CI 与 Pages 部署（已由人类预置，修改需在 PR 描述中说明）
```

## 数据与许可证铁律

只允许使用以下来源：BodyParts3D 4.0（NBDC 存档站，CC BY 4.0，署名文本见 docs/ATTRIBUTION.md）、HuBMAP HRA 3D 参考器官（CC BY 4.0）、CC0 体表/体型网格（Blender Studio Human Base Meshes、MakeHuman/MPFB2 资产）。禁止把 Z-Anatomy 网格/层级、Open3DModel、任何 NC/ND/需协议的数据（Allen、BigBrain、MedShapeNet、Dundee NC 素材、ViP/MIDA、CVH 等）放进仓库或产物。原始数据永不提交到 git（放 `pipeline/raw/`，已 gitignore；可上传到本仓库 Release 作镜像）。每个结构保留本体 id 以便将来对接：BodyParts3D 结构用 `fma`（FMA/FJ ID 列表），HRA 结构额外带 `uberon`；BP3D 两集都没有的概念（如室间隔）允许 `fma: []` 但必须有 `uberon`，两者不能都空（2026-08-18 修订，见 DECISIONS.md）。新增任何数据源前先在 docs/DECISIONS.md 记录并确认许可证。

## 性能与体积预算（PR 若突破需说明）

首屏包（皮肤 + 骨骼 + manifest）≤ 5 MB（当前收紧到 4 MB）；全部资产 ≤ 40 MB（当前收紧到 25 MB）；桌面 Chrome 60 fps、中端安卓 30 fps；同屏 draw call ≤ 600；单结构 500–30,000 面，皮肤（整张外壳）上限 60,000（2026-08-18 数据质量升级修订，见 DECISIONS.md）；总三角面目标 100–180 万，硬上限 200 万（2026-08-18 修订：换 HRA 数据源后结构数与内部件大幅增加，原 130/150 万上限卡住内容扩展；用户拍板"完整性和效果优先"，见 DECISIONS.md。中端安卓 30 fps 需人类真机复核）。所有 glb 经 gltf-transform 去重、焊接、量化、meshopt 压缩。

## 编码与协作规范

一个 issue 一个分支一个 PR，PR 保持小而完整（含测试与文档更新）。TypeScript strict，无 any 逃逸；渲染核心用类 + 事件而非全局变量；所有用户可见文字走 `content/i18n/{zh,en}.json`，中文优先，品牌名统一写 "HyiBody"。提交信息用 Conventional Commits（feat/fix/data/docs/chore）。每次改动流水线要能一条命令重跑（`pnpm pipeline:all`），并跑 `pipeline/validate.py`（结构完整性、面数、体积、命名重复检查）。云端会话无 GPU：用 Playwright 无头 Chromium 截图做冒烟检查（`pnpm test:e2e`），真机观感由人类确认。遇到需要"接受条款/付费/账号"的操作，停下来在 STATUS.md 写明并请人类处理。若推送 `.github/workflows/` 被拒绝，把文件内容写进 PR 描述请人类通过 GitHub 网页添加。

## 会话流程

1. 读 CLAUDE.md → docs/KICKOFF.md → docs/STATUS.md，确认本次要做的 issue。
2. 计划先行：列出步骤与验收标准，超出 KICKOFF.md 范围的想法写进 DECISIONS.md 的"待定"而不是直接做。
3. 实现 → 本地跑 lint/test/build → 更新 STATUS.md（做了什么、剩什么、给人类的待办）→ commit → push → 开/更新 PR。
4. 绝不把未提交的工作留在云端工作区。
