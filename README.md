# HyiBody · 人体透视科普

一个纯静态、轻量的三维人体"透视"科普网页：几百个核心解剖结构分层显示（皮肤 → 肌肉 → 骨骼 → 器官 → 血管/神经），点击识别、剖切、搜索、故事线引导游览；同一份代码全屏跑在展厅触摸屏上。不是医学级图谱，不做病人影像。

- 项目章程与协作规则：[CLAUDE.md](./CLAUDE.md)
- 蓝图与任务：[docs/KICKOFF.md](./docs/KICKOFF.md)
- 当前进度与人类待办：[docs/STATUS.md](./docs/STATUS.md)
- 数据来源与署名：[docs/ATTRIBUTION.md](./docs/ATTRIBUTION.md)

## 开发

```bash
pnpm install
pnpm dev                  # 本地开发服务器
pnpm lint                 # ESLint + Prettier 检查
pnpm test                 # Vitest 单元测试
pnpm test:e2e             # Playwright 无头截图冒烟测试（自动 build + preview）
pnpm build                # 类型检查 + 生产构建（读取 VITE_BASE，默认 /）
pnpm assets:placeholder   # 重新生成占位 glb 与 manifest.json
```

技术栈（固定）：pnpm + Vite + TypeScript(strict) + three.js（WebGL2）+ React（仅 UI）+ Zustand + Vitest + Playwright。`src/viewer/` 是纯 three.js 渲染核心，禁止依赖 React。

## 部署

推送到 `main` 后 GitHub Actions 自动构建并发布到 GitHub Pages（`.github/workflows/pages.yml`，构建时注入 `VITE_BASE=/hyibody/`）。

## 数据与许可证

正式解剖数据来自 BodyParts3D 4.0（CC BY 4.0）与 HuBMAP HRA（CC BY 4.0），由 `pipeline/`（M1）生成；当前站点仅含程序生成的占位模型。署名与禁止来源见 [docs/ATTRIBUTION.md](./docs/ATTRIBUTION.md)。原始数据永不提交到 git。
