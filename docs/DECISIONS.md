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

- 2026-08-17 · M1 数据流水线：结构分组定义放在人可编辑的 `pipeline/config/groups.yaml`（概念英文名精确匹配 + 正则），select.py 据此解析 BP3D 表生成候选清单 · 让"挑选规则"本身可审阅、可迭代，人类改配置即可重新生成候选，无需读代码。
- 2026-08-17 · isa 集缺整器官（整心/整肺/整脑/肝/主动脉主干/胸骨等）时直接用 partof 集补齐（`source: bp3d_partof`），不等 M2 · partof 集与 isa 集同源同许可证，KICKOFF 第 4 节本就为此下载；骨骼中胸骨用 isa 的柄/体/剑突三件合并。
- 2026-08-17 · glb 优化链固定为 gltf-transform `dedup → weld → quantize → meshopt`，不用 `optimize` 一键命令 · `optimize` 默认会 join 节点，破坏"节点名 = slug + extras"的结构标识；分步执行可控且 extras 实测保留。
- 2026-08-17 · 查看器 GLTFLoader 注册 MeshoptDecoder（three 内置 `meshopt_decoder.module.js`）· 流水线产物用 EXT_meshopt_compression；KHR_mesh_quantization 为 GLTFLoader 原生支持。
- 2026-08-17 · `pipeline/select.py` 文件名与 Python 标准库 `select` 模块同名（KICKOFF 规定文件名不变）：各入口脚本把 `pipeline/` 移到 `sys.path` 末尾、run_all 用 importlib 别名加载 · 避免 `subprocess` 等标准库在导入 `select` 时被遮蔽。
- 2026-08-17 · 居中偏移取 isa 集全部 2,234 件网格包围盒中心（`work/global_center.json`），而非当前所选结构 · 偏移与挑选结果解耦，各系统分批处理也能对齐。

- 2026-08-17 · `content/structures.yaml` 定稿 135 条（骨骼 35、肌肉 42、血管 31、器官 23、神经 3、皮肤 1）：删候选中 5 条"整体 vs 部分"重叠（十二指肠/直肠/小脑/脑干/神经系统复合体）；左右侧合并为一条、椎骨按颈/胸/腰合组，总数不凑 KICKOFF 的 300–600 · 人类在会话中批准"按 AI 审阅建议直接定稿"；"太小太碎不要"原则优先于数量目标，左右合并另省 draw call。候选与分组定义保留全量，翻案改 groups.yaml 重跑即可。

## 待定（不做，等人类点头）

- BodyParts3D 4.0 数据缺口（两集均无网格，候选清单已如实缺席）：尾骨、甲状腺、子宫/卵巢（男性模型）、坐骨神经/臂丛等全部周围神经（isa 集只有眼周细支神经，partof 集只有"nervous system"复合体）、腹直肌/背阔肌/咬肌/颞肌等部分浅层肌。M2 若需补齐，候选来源为 HuBMAP HRA（已在允许清单）或恢复 BP3D 3.0 数据源——后者需先在此记录并确认许可证。

- `prototype/` 目录未随启动包上传，仓库中暂缺。KICKOFF 描述的关键结论（6 glb / 173 万面 / 18 draw call、菲涅尔 X-ray、Kiosk 样式）已在文档中保留；若人类手头有原型文件，建议上传到 `prototype/`（只读参考）。
- KICKOFF 第 3 节列出的 `src/viewer/picking.ts、clipping.ts、highlight.ts、labels.ts` 与 `src/ui/` 各面板组件未在 M0 创建空壳，避免无用空文件；将随 M1-6（查看器核心）与对应 issue 实现。
- PWA（vite-plugin-pwa）按 KICKOFF 属 M2-3，M0 未引入。
