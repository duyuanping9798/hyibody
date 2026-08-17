# 项目进度（STATUS）

最后更新：2026-08-17 · 会话 1（M0 初始化）

## 已完成（M0）

- 脚手架：pnpm + Vite 6 + TypeScript strict + React 19 + three.js 0.185 + Zustand（依赖就位，M1 起用于 UI 状态）
- `HyiViewer` 渲染核心（`src/viewer/`，无 React 依赖，ESLint 强制）：fetch `manifest.json` → GLTFLoader 加载 glb → 轨道旋转（自动旋转，交互即停）；Z-up 毫米坐标系与 BP3D 对齐
- 程序生成占位人形 glb（dev/test/build 前自动跑 `scripts/generate-placeholder.mjs` 生成 `public/assets/placeholder.glb` + `manifest.json`，不提交 git），数据通路与 M1 流水线产物格式一致
- `vite.config.ts` 读取 `VITE_BASE`（默认 `/`，Pages 构建注入 `/hyibody/`）
- 分层滑块的不透明度映射 `src/viewer/layers.ts`（KICKOFF 第 6 节数值）+ 单元测试
- URL 状态编解码 `src/data/urlState.ts` + 单元测试；manifest 校验 + 单元测试
- 菲涅尔 X-ray 材质移植（`src/viewer/materials.ts`，M1 接入皮肤/肌肉层）
- Tour 引擎骨架 `src/tours/engine.ts`（M2-1 完善）
- ESLint 9 / Prettier / Vitest 3 / Playwright 配置；`pnpm lint / test / build / test:e2e` 全部通过
- Playwright 无头截图冒烟测试（`tests/e2e/smoke.spec.ts`：等 ready 标记 → 读回像素验证画面非空 → 存截图）
- `.github/workflows/ci.yml + pages.yml`（KICKOFF 附录版本，pnpm 版本改由 packageManager 字段决定）
- 文档：CLAUDE.md、docs/KICKOFF.md 入库；STATUS / DECISIONS / ATTRIBUTION 初稿；README 重写
- M1（7 个）、M2（6 个）任务已整理成 `docs/issues-backlog.md`（GitHub 集成暂无 issue 写权限，见下方待办 1；权限修复后由下个会话逐条建成 issue）

## 未完成 / 下一步

- M1-1 … M1-7：数据流水线与查看器核心（见 issues）
- M2-1 … M2-6：故事线、Kiosk、分享、HRA 替换、中英切换、发布（见 issues）
- `prototype/` 原型目录未上传（见"给人类的待办"）

## 给人类的待办

1. **⚠️ 修复 Claude GitHub App 权限（最优先）**：本会话对仓库只有读权限——git push、建分支、写文件、建 issue、开 PR 全部被 403 拒绝。请打开 <https://github.com/settings/installations>，找到 Claude 应用 → Configure：确认 `hyibody` 在 Repository access 里，且 Repository permissions 含 **Contents: Read and write**、**Issues: Read and write**、**Pull requests: Read and write**（有待批准的权限更新请点接受）。修好后在 claude.ai/code 会话里说"继续"，代码会自动推上去。
2. **（若暂不修权限）手工上传 M0 成果**：会话已导出 `hyibody-m0.zip`（Claude 会话里可下载），解压后在仓库页 Add file → Upload files 全部拖入提交到 main（`.github` 是隐藏文件夹，Mac 按 Cmd+Shift+. 显示；拖不进就按 zip 内 `.github/workflows/` 的内容用 Create new file 手工建两个文件——**不要用 KICKOFF 附录版**，附录里 `version: 9` 与 package.json 的 pnpm@10 冲突）。
3. **Pages 设置**：仓库已是 Public（免费计划可用 Pages）；确认 Settings → Pages → Source 已选 **GitHub Actions**。合并/上传到 main 后 Pages 自动发布，用手机和电脑打开 `https://duyuanping9798.github.io/hyibody/` 确认能看到占位人形并可拖动旋转。
4. **上传 prototype/**（可选但推荐）：启动包里的 `prototype/process.py、index.html、shot.mjs` 不在仓库中，网页端 Add file → Upload files 传到 `prototype/` 目录，供后续会话参考。
5. **BodyParts3D 许可证快照**：把 <https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html> 另存为 PDF 上传到 `docs/licenses/`（会话 2 之前完成即可）。
6. **云环境**：会话 2 开始前按 KICKOFF 第 2 节建好 `hyibody` 云环境（Custom 域名列表 + setup script + `VITE_BASE=/hyibody/`），流水线要联网下载 BP3D 数据。
7. **会话 2**：粘贴 KICKOFF 第 9 节"会话 2"指令，做数据流水线（对应 issues-backlog 的 M1-1 … M1-5；开始前先让它把 backlog 建成 issue）。
