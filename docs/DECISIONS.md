# 决策记录（DECISIONS）

新增数据源、偏离 KICKOFF 的做法、待人类确认的事项都记在这里。格式：日期 · 决定 · 理由。

## 已决定

- 2026-08-17 · M0 开发分支使用 `claude/hyibody-setup-7eumlp` 而非 KICKOFF 中的 `feat/m0-scaffold` · 云端会话被指定只能推送该分支；分支名不影响产物，后续会话按 issue 建 `feat/*` 分支。
- 2026-08-17 · `.github/workflows` 中 `pnpm/action-setup@v4` 不再写死 `version: 9`，改由 `package.json` 的 `packageManager: pnpm@10` 字段决定 · 本地与 CI 用同一 pnpm 大版本，避免 lockfile 不一致；与 KICKOFF 附录的唯一差异。
- 2026-08-17 · 占位模型用 `@gltf-transform/core` 在 Node 里生成真实 .glb（胶囊+球+圆柱的人形，约 4k 三角面），提交到 `public/assets/` 并附 `manifest.json` · 让 HyiViewer 从第一天就走"fetch manifest → 加载 glb"的正式数据通路，M1 流水线产物可无缝替换。
- 2026-08-17 · 坐标系约定从 M0 起对齐 BP3D：毫米、Z 轴向上、前方 −Y；相机 `up` 设为 +Z · 避免 M1 接入真实数据时翻转坐标。
- 2026-08-17 · Vite 6 + Vitest 3 + React 19 + three 0.185（对应原型的 r185）+ ESLint 9 flat config · 均为当前稳定版本；three 版本与原型一致以便迁移菲涅尔材质。
- 2026-08-17 · ESLint 增加规则：`src/viewer|data|tours` 禁止 import React · 把 CLAUDE.md 的目录约定变成机器可查的硬约束。
- 2026-08-17 · M0 占位资产（placeholder.glb + manifest.json）不提交 git，改为 dev/test/build 前自动生成 · 本会话的 git 推送通道只读，二进制无法经 GitHub API 文本通道提交；且占位资产本就是临时产物。M1 起真实流水线产物按 CLAUDE.md 约定提交到 `public/assets/`（届时若推送仍受限需人类处理，见 STATUS 待办）。

## 待定（不做，等人类点头）

- `prototype/` 目录未随启动包上传，仓库中暂缺。KICKOFF 描述的关键结论（6 glb / 173 万面 / 18 draw call、菲涅尔 X-ray、Kiosk 样式）已在文档中保留；若人类手头有原型文件，建议上传到 `prototype/`（只读参考）。
- KICKOFF 第 3 节列出的 `src/viewer/picking.ts、clipping.ts、highlight.ts、labels.ts` 与 `src/ui/` 各面板组件未在 M0 创建空壳，避免无用空文件；将随 M1-6（查看器核心）与对应 issue 实现。
- PWA（vite-plugin-pwa）按 KICKOFF 属 M2-3，M0 未引入。
