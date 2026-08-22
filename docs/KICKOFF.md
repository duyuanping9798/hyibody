# HyiBody — Claude Code 启动文档（KICKOFF）

版本：2026-08-17 v2（项目名定为 HyiBody）　|　适用：Claude Code 网页版（claude.ai/code）+ GitHub，单人 + AI 协作　|　配套：仓库根目录 `CLAUDE.md`、`prototype/`（效果图原型）、`.github/workflows/`（已预置）

## 0. 项目名与定位

项目名 **HyiBody**，仓库名 `hyibody`，界面品牌统一写 "HyiBody"（中文副标题"人体透视科普"，如需中文昵称在 `content/i18n/zh.json` 的 `brand` 字段设置）。

一句话：一个打开就能看的三维人体透视网页，让普通人三分钟看懂"人体是分层的"，再跟着几条奥秘认识核心器官系统；同一份代码全屏跑在展厅触摸屏上。它是完整版 BODYMAX 的轻量子集，数据格式与之兼容，将来可扩展。原型效果图已验证：BodyParts3D 全量 2,222 件经减面合并后 6 个 glb 共约 35 MB、173 万三角面，three.js 单场景 18 次绘制调用即可呈现分层透视。

## 1. 执行步骤（人类按顺序操作，约 30 分钟）

第一步 · 建仓库：登录 GitHub → New repository → 名称 `hyibody`，Private，勾选 "Add a README" → Create。进入 Settings → Pages → Build and deployment → Source 选 **GitHub Actions**。

第二步 · 上传启动包：把 `hyibody-starter.zip` 解压，在仓库页面 Add file → Upload files，把解压后的全部内容拖进去（含 `CLAUDE.md`、`README.md`、`.gitignore`、`docs/`、`prototype/`、`.github/`），提交到 main。若浏览器不允许拖入 `.github` 隐藏文件夹，改用 Add file → Create new file，路径分别填 `.github/workflows/ci.yml` 与 `.github/workflows/pages.yml`，内容从本文附录复制。上传后 Actions 页会跑一次 CI/Pages，因为还没有 `package.json` 会自动跳过，属正常。

第三步 · 连接 Claude Code：打开 claude.ai/code → 按引导授权 Claude GitHub App，安装到 `hyibody`（也可在终端 `/web-setup`）。

第四步 · 建云环境：在 claude.ai/code 的环境选择器 → Add cloud environment → 名称 `hyibody`；Network access 选 **Custom**，勾选 "Also include default list of common package managers"，Allowed domains 填第 2 节列表；Setup script 粘贴第 2 节脚本；Environment variables 填 `VITE_BASE=/hyibody/`。保存。

第五步 · 会话 1（初始化）：新建会话，选择仓库 `hyibody` 与环境 `hyibody`，粘贴第 9 节"会话 1"指令。等它开出 PR（约 20–40 分钟）后，在 PR 页看 Actions 是否绿色，浏览 diff，合并到 main。合并后 Actions → Deploy to GitHub Pages 会发布，Settings → Pages 显示站点地址（形如 `https://<你的用户名>.github.io/hyibody/`），手机和电脑各打开一次确认能看到占位模型。

第六步 · 会话 2（数据流水线）：粘贴第 9 节"会话 2"指令。它会从 NBDC 存档站下载 BodyParts3D 4.0、跑通骨骼系统端到端并生成候选结构清单。与此同时你在浏览器打开 https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html 另存为 PDF，上传到仓库 `docs/licenses/`。收到 PR 后审阅 `content/structures.candidates.yaml`，按第 7 节规则挑选定稿为 `content/structures.yaml`（可以让下一个会话帮你按规则初筛，你只做增删）。

第七步 · 会话 3 起（功能开发）：每个会话领一个 issue（会话 1 已按第 5 节创建），粘贴"会话 3+"指令。每次合并后在手机、电脑、（有条件时）展厅设备上试用，把问题写进 issue 或用"修 Bug"指令反馈。M1 完成即有可演示版本；M2 完成发布 v0.1。

日常节奏建议：每周 2–4 个会话；每个会话只做一个 issue；PR 合并前至少在手机上看一眼；每周把 `docs/STATUS.md` 里"给人类的待办"清一遍。

## 2. 云环境配置

允许域名（Custom 列表，逐行）：

```
dbarchive.biosciencedbc.jp
lifesciencedb.jp
*.humanatlas.io
hubmapconsortium.github.io
3d.nih.gov
zenodo.org
*.wikidata.org
raw.githubusercontent.com
media.githubusercontent.com
cdn.jsdelivr.net
unpkg.com
```

setup script（以 root 运行，需在 5 分钟内完成；结果会被快照缓存约 7 天）：

```bash
set -e
apt-get update -qq
apt-get install -y -qq gh libgl1 libglu1-mesa libxi6 libxrender1 xvfb unzip > /dev/null
pip install -q trimesh numpy scipy pymeshlab fast-simplification pygltflib pyyaml networkx tqdm rich pytest
npm i -g @gltf-transform/cli
# Playwright 无头 Chromium 用于截图冒烟测试（无 GPU，软件渲染，仅作粗检）
npx --yes playwright@latest install --with-deps chromium > /dev/null 2>&1 || echo "playwright install failed (non-fatal)"
```

环境变量：`VITE_BASE=/hyibody/`（自定义域名后改为 `/`）、`HYIBODY_KIOSK_IDLE_SECONDS=60`（可选）。

## 3. 仓库结构（会话 1 生成，粗体为已预置）

```
hyibody/
  **CLAUDE.md**  **README.md**  **.gitignore**
  package.json  pnpm-lock.yaml  vite.config.ts  tsconfig.json  eslint.config.js  .prettierrc
  index.html
  src/
    main.tsx
    viewer/        HyiViewer.ts  layers.ts  picking.ts  clipping.ts  highlight.ts  camera.ts  labels.ts  materials.ts
    ui/            App.tsx  LayerSlider.tsx  InfoCard.tsx  SearchBox.tsx  SystemPanel.tsx  WonderPlayer.tsx  Kiosk.tsx  ShareDialog.tsx  Attribution.tsx
    data/          types.ts  manifest.ts  hierarchy.ts  urlState.ts
    wonders/         engine.ts
  content/
    structures.yaml          结构清单（人可编辑，见第 7 节）
    i18n/zh.json  en.json
    wonders/heartbeat.json  digestion.json  nerve.json
    definitions/zh.md        每个结构一句话科普（按 slug 分节）
  pipeline/
    README.md  requirements.txt
    config/sources.yaml       数据源 URL + sha256 + 许可证
    download.py  select.py  process.py  export.py  validate.py  run_all.py
    raw/   (gitignore)   work/  (gitignore)
  **prototype/**   process.py  index.html  shot.mjs（效果图原型，只读参考）
  public/assets/
    manifest.json  skin.glb  skeleton.glb  muscles.glb  organs.glb  vessels.glb  nerves.glb
  **docs/**
    **KICKOFF.md**  STATUS.md  DECISIONS.md  ATTRIBUTION.md  licenses/
  tests/
    unit/  e2e/
  **.github/workflows/ci.yml  pages.yml**
```

## 4. 数据源与许可证

| 来源 | 用途 | 获取 | 许可证 / 署名 |
|---|---|---|---|
| BodyParts3D 4.0（NBDC 存档站） | 骨骼、肌肉、血管、神经、器官、皮肤的基础网格与 FMA 层级 | https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html 的 `isa_BP3D_4.0_obj_99.zip`（约 136 MB）+ `isa_parts_list_e.txt`、`isa_inclusion_relation_list.txt`、`isa_element_parts.txt`；`partof_BP3D_4.0_obj_99.zip`（62 MB，含复合器官如整心、整肺，用于补齐 isa 集缺的整器官） | CC BY 4.0；署名："BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International"；许可证页快照存 docs/licenses/ |
| HuBMAP HRA 3D 参考器官（v2.4 或最新） | 心、肺、肝、肾、脑、胃肠、脾、胰、膀胱等"主角"器官的美观版本 | 从 https://humanatlas.io/3d-reference-library 或 https://hubmapconsortium.github.io/ccf/pages/ccf-3d-reference-library.html 找到男性 GLB 直链，写入 `pipeline/config/sources.yaml`（含 sha256） | CC BY 4.0；署名 HuBMAP Human Reference Atlas；商用版本不用其中的 Allen 脑模型（改用 BP3D 脑） |
| CC0 体表网格（可选，M2） | 替换 BP3D 有孔洞的皮肤 | Blender Studio Human Base Meshes 或 MakeHuman/MPFB2 资产 | CC0，无需署名 |
| Wikidata | 中文/拉丁名初稿（P1402 FMA ID → zh 标签） | SPARQL 查询 | CC0；人工校对后使用 |

禁止来源：Z-Anatomy 网格与层级（CC BY-SA）、Open3DModel（CC BY-SA）、任何 NC/ND/需协议数据。原型阶段用过的 GitHub 镜像（jixiangying/anatomy）仅供对照，正式数据一律从 NBDC 存档站获取。

## 5. 里程碑与任务（会话 1 用 gh 建成 issue，标签 M0/M1/M2）

M0 初始化（1 个会话）：脚手架（Vite+TS+React+three.js+Zustand+ESLint/Prettier/Vitest/Playwright）；目录与占位模块；`HyiViewer` 能加载 `prototype/` 思路的示例 glb（先用一个程序生成的占位体）并轨道旋转；CI 与 Pages 工作流已预置，只需保证 `pnpm lint/test/build` 可用且 `vite.config.ts` 读取 `VITE_BASE`；docs/STATUS.md、DECISIONS.md、ATTRIBUTION.md 初稿；README 补充；创建 M1/M2 issue。

M1 数据与查看器核心（约 3–5 个会话）：
1. `pipeline/download.py`：按 sources.yaml 下载、校验 sha256、解压到 raw/。
2. `pipeline/select.py`：解析 BP3D 表 → 按第 7 节规则生成候选结构清单 `content/structures.candidates.yaml`（含系统、面数、体积、父子），人类挑选后成为 `structures.yaml`。
3. `pipeline/process.py`：逐结构加载 OBJ → 修复 → 合并组 → 简化到目标面数（可复用 prototype/process.py 的分类与减面逻辑）→ 统一单位（BP3D 坐标为毫米、Z 轴向上、前方为 −Y，原型已核实）→ 居中。
4. `pipeline/export.py`：按系统导出 glb（节点名 = slug，extras 见第 7 节）→ gltf-transform 优化 → 生成 `manifest.json`。
5. `pipeline/validate.py` + Vitest：清单完整性、面数与体积预算、命名唯一、FMA 保留。
6. 查看器：加载 manifest → 首屏皮肤+骨骼，其他系统按需加载；分层滑块（皮肤→肌肉→骨骼→器官→血管→神经，连续透明过渡；原型的菲涅尔 X-ray 材质可直接迁移）；点击识别 + 悬停高亮 + 信息卡（中/英名、一句话、来源）；隔离/隐藏/恢复；每系统透明度；单剖切面（X/Y/Z 轴滑块）；搜索（中英子串）；6 个预设视角；URL 状态编解码；署名页。
7. 移动端布局与触控；Playwright 截图冒烟测试；性能预算检查脚本。

M2 奥秘、展厅与打磨（约 3–4 个会话）：
1. Wonder 引擎与 3 条奥秘（心跳血液旅程、食物去哪了、一根神经的旅程）：每步 = 相机位姿 + 可见集合 + 高亮 + 文案 + 时长，支持播放/暂停/上一步/下一步。
2. Kiosk 模式（`?kiosk=1`）：全屏、大按钮、闲置 60 s 回到吸引动画（自动旋转 + 分层演示循环）、禁用右键与手势缩放、4K 与竖屏布局（原型 kiosk 样式可参考）。
3. 分享：URL 状态 + 二维码；PWA 离线（vite-plugin-pwa）。
4. HRA 器官替换与对齐（配置化缩放/偏移，保留 BP3D 版本回退）；BP3D partof 集补齐整肺/整心/主动脉/整脑；可选 CC0 皮肤替换；剖切封盖。
5. 中英切换；中文名人工校对流程（`content/review.csv` 状态列）；无障碍基础（键盘、对比度）。
6. 性能打磨与真机反馈修复；发布 v0.1。

## 6. 功能规格要点

分层控制条是核心交互（2026-08-22 v1.7 修订，用户拍板，见 DECISIONS）：六个系统各一格"推子"，独立调 0–1 透明度、任意混合；点某格名字一步跳到该层的策展视图。策展视图与奥秘/展厅吸引动画仍走 0–1 扫描曲线（各系统按顺序淡入淡出：皮肤 0–0.16、肌肉 0.14–0.45、骨骼 0.34–0.75、器官 0.45–0.9、血管 0.62–1、神经 0.8–1），首次拖某个推子时当前画面固化为六个独立值。点击：三维拾取只对可见且透明度 > 0.15 的结构生效；选中描边高亮 + 相机平滑对准；信息卡显示中/英名、一句话科普、所属系统、来源署名、"隔离/隐藏/聚焦"按钮。剖切与预设视角不再提供界面入口（引擎能力保留，供奥秘步骤与存量分享链接使用）。搜索：输入中文或英文子串，列表点选即定位。URL 状态：`?v=<base64url(json)>` 编码扫描值或六层混合（mix）、系统开关、剖切、相机、选中、语言、kiosk。顶栏收拢为：奥秘、细剖、ℹ（简介/语言/署名/快捷键）、👤（分享/创作）。展厅：无键盘鼠标也可完全操作，所有按钮 ≥ 56 px。视觉基调沿用原型：深色舞台、玻璃拟态面板、青色强调色、暖色奥秘按钮。

## 7. 数据规格

结构挑选规则（select.py 生成候选，人类定稿）：优先"科普可辨认"——骨骼合并为约 60 组（颅骨整体、椎骨按颈/胸/腰分组、肋骨整体、腕骨/跗骨各一组、四肢长骨单列）；主要肌群约 60（表浅大肌为主）；器官约 40；大血管约 40（主动脉及主要分支、腔静脉、肺动静脉、颈动脉、股动静脉等）；主要神经约 30（脑、脊髓、臂丛、坐骨神经等）；皮肤 1。总数 300–600。太小、太碎、名字普通人不认识的不要。isa 集缺整器官时用 partof 集或 HRA 补。

`content/structures.yaml` 条目：

```yaml
- slug: heart                # 唯一，英文小写下划线
  zh: 心脏
  en: Heart
  la: Cor                    # 可选
  system: organs             # skin | muscles | skeleton | organs | vessels | nerves
  region: thorax             # head | neck | thorax | abdomen | pelvis | upper_limb | lower_limb | whole
  side: none                 # left | right | none | both
  fma: [FMA7088]             # BodyParts3D 部件 ID 列表（isa 集为 FJxxxx，可多件合并为一组）
  source: bp3d               # bp3d | bp3d_partof | hra | cc0
  target_faces: 6000
  priority: 1                # 1 首屏必备 2 常用 3 补充
```

glTF 节点 `extras`：`{slug, zh, en, system, region, side, fma[], source}`。`manifest.json`：`{version, generatedAt, systems:[{id, file, bytes, structures:[slug…]}], structures:{slug:{zh,en,system,region,side,fma,source,bbox}}, attribution:[…]}`。

## 8. GitHub Actions（已预置）

`.github/workflows/ci.yml`：push/PR 触发，pnpm install → lint → test → build；`package.json` 不存在时自动跳过。`.github/workflows/pages.yml`：main 分支 push 触发，build 后用 `actions/upload-pages-artifact` + `actions/deploy-pages` 发布，构建时注入 `VITE_BASE=/hyibody/`；`vite.config.ts` 必须读取 `process.env.VITE_BASE`（默认 `/`）。自定义域名后把变量改为 `/`。云端会话若无法推送 workflows 目录的改动，把 yaml 放进 PR 描述由人类在网页编辑。

## 9. 会话指令模板（复制粘贴）

会话 1：初始化

```
你是本仓库的主要开发者。先读 CLAUDE.md、docs/KICKOFF.md，并浏览 prototype/ 里的 process.py 与 index.html 了解已验证的渲染与流水线思路。然后执行 KICKOFF 第 5 节的 M0：
1) 生成脚手架与目录（第 3 节），HyiViewer 能加载一个程序生成的占位 glb 并轨道旋转，vite.config.ts 读取 VITE_BASE；
2) 配置 ESLint/Prettier/Vitest/Playwright，写一个渲染截图冒烟测试；
3) 保证 pnpm lint / test / build 三条命令可用，与已预置的 .github/workflows 配合；
4) 写 docs/STATUS.md、docs/DECISIONS.md、docs/ATTRIBUTION.md（含第 4 节署名文本）并补充 README；
5) 用 gh 创建 M1、M2 的 issue（按第 5 节逐条，标签 M1/M2）；
6) 全部提交到分支 feat/m0-scaffold，push，开 PR，PR 描述里列出需要人类做的事。
遇到需要人类决定的事项写进 STATUS.md 后继续做其余部分，不要停在原地等待。
```

会话 2：数据流水线

```
读 CLAUDE.md、docs/KICKOFF.md、docs/STATUS.md，领取 issue #<n>（M1-1 到 M1-5）。
先写 pipeline/config/sources.yaml：从 https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html 解析 BodyParts3D 4.0 的 isa 与 partof 压缩包及关系表直链，记录 sha256 与许可证；下载到 pipeline/raw/（已 gitignore）。
实现 download/select/process/export/validate 五个脚本与 run_all.py（可迁移 prototype/process.py 的分类、减面与合并逻辑，但要按第 7 节写入 extras 与 manifest），先只跑骨骼系统跑通端到端，产出 public/assets/skeleton.glb 与 manifest.json，体积和面数满足 CLAUDE.md 预算；
生成 content/structures.candidates.yaml 供人类挑选，并在 STATUS.md 说明挑选方法。
单元测试覆盖表解析与清单校验。提交 PR。
```

会话 3+：功能开发

```
读 CLAUDE.md、docs/KICKOFF.md、docs/STATUS.md，领取 issue #<n>。
按第 6 节规格实现，保持 src/viewer 不依赖 React；补测试与截图；更新 STATUS.md；PR 描述附上你希望人类在真机上重点检查的 3 个点。
```

修 Bug / 真机反馈

```
真机反馈：<描述/截图链接>。定位原因，修复，补回归测试，PR 描述解释根因。
```

## 10. 人类清单

建仓与 Pages 设置；上传启动包；安装 Claude GitHub App 与云环境；保存 BodyParts3D 许可证页快照到 docs/licenses/；审定 `structures.yaml`（AI 出候选，你定稿）；写或审核 `content/definitions/zh.md` 的一句话科普与三条奥秘文案；找人校对中文名称并在 `content/review.csv` 标注；每次发布后在手机、电脑、展厅设备上试用并把问题写进 issue；准备展厅设备（触摸一体机或大屏 + 能开 Chrome/Edge 的主机）；域名与备案（若面向国内公网）。

## 11. 验收标准（v0.1）

手机浏览器 10 秒内进入可交互状态；分层滑块流畅无明显掉帧；任意结构可点击并显示正确中英文名与一句话；三条奥秘可播放；Kiosk 模式闲置自动回到吸引动画且无法退出全屏误操作；署名页完整；全部资产 ≤ 40 MB、首屏 ≤ 5 MB；CI 通过并自动发布。

## 12. 原型说明（prototype/）

`process.py`：效果图用的最小流水线，输入是 BodyParts3D 4.0 isa 部件清单 `data.json` 与 `obj/<id>.obj`，按系统分类、减面、合并，输出 6 个 glb（皮肤/骨骼/肌肉/器官/血管/神经）。`index.html`：three.js r185 单页场景 + 界面样机（分层滑块、系统面板、信息卡、奥秘入口、展厅模式），支持 `?mode=desktop|kiosk&cam=hero|chest|kiosk&clip=1&layer=0.56` 参数，皮肤/肌肉用菲涅尔 X-ray 材质，剖切用 clippingPlanes。`shot.mjs`：Playwright 无头截图脚本。本地/云端复现：`npm i three playwright-core`，准备 `obj/` 与 `data.json` 后 `python process.py`，起静态服务器打开 `prototype/index.html`。已知局限：isa 集缺整肺、主动脉主干、整脑，心脏只有心室/心房壁；皮肤为 BP3D 原始网格；界面无交互；剖切无封盖。这些正是 M1/M2 要解决的事。

## 附录 · workflows 文件内容（如需手工创建）

若 `.github/` 目录未能随启动包上传，在 GitHub 网页 Add file → Create new file，路径填 `.github/workflows/ci.yml`，内容：

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - id: check
        run: |
          if [ -f package.json ]; then echo "has=true" >> "$GITHUB_OUTPUT"; else echo "has=false" >> "$GITHUB_OUTPUT"; echo "package.json 尚不存在，跳过（M0 完成后自动生效）"; fi
      - if: steps.check.outputs.has == 'true'
        uses: pnpm/action-setup@v4
        with:
          version: 9
      - if: steps.check.outputs.has == 'true'
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - if: steps.check.outputs.has == 'true'
        run: pnpm install --frozen-lockfile
      - if: steps.check.outputs.has == 'true'
        run: pnpm lint
      - if: steps.check.outputs.has == 'true'
        run: pnpm test
      - if: steps.check.outputs.has == 'true'
        run: pnpm build
```

再创建 `.github/workflows/pages.yml`，内容：

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      has: ${{ steps.check.outputs.has }}
    steps:
      - uses: actions/checkout@v4
      - id: check
        run: |
          if [ -f package.json ]; then echo "has=true" >> "$GITHUB_OUTPUT"; else echo "has=false" >> "$GITHUB_OUTPUT"; echo "package.json 尚不存在，跳过部署（M0 完成后自动生效）"; fi
      - if: steps.check.outputs.has == 'true'
        uses: pnpm/action-setup@v4
        with:
          version: 9
      - if: steps.check.outputs.has == 'true'
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - if: steps.check.outputs.has == 'true'
        run: pnpm install --frozen-lockfile
      - if: steps.check.outputs.has == 'true'
        run: pnpm build
        env:
          VITE_BASE: /hyibody/
      - if: steps.check.outputs.has == 'true'
        uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    if: needs.build.outputs.has == 'true'
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```
