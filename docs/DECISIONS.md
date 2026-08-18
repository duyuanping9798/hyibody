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

- 2026-08-17 · 观感升级修订面数预算：单结构 500–3,000（大 8,000）→ 500–6,000（多件合并组/整器官/皮肤 24,000），目标面数整体 ×3 · 人类反馈"效果简陋粗糙"并选定观感升级方向；原预算仅用到总量 16%，提升后总面 59 万仍远低于 150 万上限、总体积 4.1 MB ≪ 40 MB。CLAUDE.md 预算行同步更新。
- 2026-08-17 · 渲染升级：ACES 色调映射 + RoomEnvironment 程序化环境光照（无外部 HDR 资源）、分系统 PBR 质感（骨骼哑光/器官血管清漆湿润/神经缎面）、软组织减面后 Taubin 平滑、渐变舞台背景球、选中改反壳描边 · 全部为 three.js 内置能力，不引入新依赖；不用后处理 OutlinePass（移动端与软件渲染成本高）。

- 2026-08-17 · 器官微动画：心脏 66 次/分"扑通"搏动（正弦正半周立方波形）+ 双肺 13 次/分呼吸起伏，绕结构自身中心 ≤3% 微缩放；`prefers-reduced-motion` 时关闭 · 科普"活体感"性价比最高的一步；纯函数实现可单测。
- 2026-08-17 · 剖切"实心感"用双面渲染（剖切开启时材质切 DoubleSide 露出内壁）而非模板缓冲封盖 · 135 结构逐一做 stencil cap 成本高且移动端不稳；DoubleSide 观感已达科普需求，真封盖列入待定。

- 2026-08-17 · 新依赖：`qrcode`（分享二维码，MIT）、`vite-plugin-pwa` + `workbox-window`（PWA 离线，MIT，KICKOFF M2-3 本就规划）· 均为构建/前端工具链，不涉数据许可证；PWA 预缓存全部资产 4.95 MB。
- 2026-08-17 · PWA 图标为脚本生成的占位图形（scripts/generate-icons.mjs，深底青色圆环+轴线）· 无外部素材依赖；人类可随时替换 public/icons/ 下 PNG。
- 2026-08-17 · 中英切换（M2-5）：文案统一走 STRINGS[lang] 运行时查表，zh/en 键集一致性由单测保证；语言写入 ?v= 分享状态 · InfoCard 一句话科普暂只有中文（content/definitions/zh.md），英文态显示占位句，en.md 待 M2 后续或人类补。

- 2026-08-18 · 自实现 Taubin 平滑（伞算子 + 固定边界 + 位移硬上限 1% 对角线），弃用
  `trimesh.smoothing.filter_taubin` · 后者在本数据上发散：三角肌包围盒 499 → 651 mm、
  最长边 65 → 409 mm，肝脏 305 → 571 mm，渲染出来就是肩膀/手脚的长刺（人类截图反馈）。
  process.py 增加"平滑后包围盒涨幅 > 3% 即报错"的守卫，validate.py 增加最长边/对角线
  比例检查（> 65% 报错、> 40% 警告），pipeline 单测用合成球锁住三条底线。
- 2026-08-18 · 选中描边外扩量改在**视图空间**按深度换算成固定像素宽（2.5 px），不再直接
  加在物体空间 position 上 · 流水线用 KHR_mesh_quantization，节点自带缩放（皮肤那条是
  859.88），物体空间的 2.2 被放大成 1891 mm 的巨壳，选中皮肤时整个视口被染成青色
  （人类截图反馈的"背景颜色"问题）。
- 2026-08-18 · 分层滑块改为真正的"淡入淡出"：各系统在轮到自己之前只有 0.12–0.3 的底噪，
  主场时升到 1，淡出区间仍按 KICKOFF · 之前六个系统在 layer=0 时全是 1，六层实体叠加
  被 ACES 压成一团白，看不出任何结构。
- 2026-08-18 · 肌肉从 X-ray 菲涅尔壳改为受光的 MeshStandardMaterial（皮肤仍是 X-ray）·
  X-ray 只有边缘亮，轮到肌肉层时只剩一圈红边、看不出肌肉形状；受光材质下肌肉层能看到
  真实的肌肉走向。
- 2026-08-18 · 同系统内按 slug 做确定性的微小色相/明度抖动（肌肉 ±1.2% 色相 ±10% 明度、
  器官 ±2.2%/±9%、骨骼 ±0.4%/±5%）· 相邻结构同色时看不出边界，抖一点点即可分辨，
  又不破坏系统配色的整体识别。
- 2026-08-18 · ?v= 分享链接选中的结构若还在后台加载（器官/血管/神经不在首屏），
  viewer 先挂起选中、等该系统加载完再补上 · 之前分享"选中心脏"的链接打开后选中被静默丢弃。
- 2026-08-18 · 把压缩比 ≥ 6× 的 20 个结构的 target_faces 翻倍（单件封顶 6,000、
  多件合并组/整器官封顶 24,000，不改 CLAUDE.md 的预算上限）· 135 个结构里有 60 个已经是
  BP3D 源网格原分辨率、再提也没有信息量；剩下被压得最狠的（肋间肌 42×、腹外斜肌 37×、
  脑 16×、肝 13×）提精度收益最大。总面数与体积仍远低于预算。

- 2026-08-18 · 数据质量升级（步骤 A）：`groups.yaml` 基准目标面数提高到皮肤 60,000 /
  骨骼 5,000（颅骨与髋骨 12,000）/ 肌肉 4,000 / 器官 10,000（心肺肝 15,000）/ 血管 6,000 /
  脑 15,000，并新增两条规则——`max_compression: 2`（源网格比基准细很多时按最大压缩比
  放宽目标，别把几十万面的部件硬压成低模）与 `max_target_faces: 30000`（统一封顶，
  免得肋间肌这种 37.7 万面的组吃掉整个预算；显式写的基准永远是下限，皮肤 60,000 因此不受限）
  · 人类要求"整体观感升级"。只按给定基准算总面数只有 58 万，达不到 100–130 万的验收区间；
  加这两条规则后落在 109 万。单结构上限随之改为 30,000 / 皮肤 60,000（CLAUDE.md 同步）。
- 2026-08-18 · 平滑改到减面之前做 · 在原始分辨率上抹掉扫描阶梯，减面算法据此保形；
  反过来先减面再平滑等于在低模上摊平，圆润度和特征都保不住。伞算子改用 bincount 逐轴累加
  （输入从几千面变成几十万面，np.add.at 慢一个量级）。
- 2026-08-18 · 导出前焊接同位顶点并重算面积加权平滑法线 · 减面会在部件接缝留下重复顶点，
  不焊接的话法线在接缝处断开，渲染出来是一条条硬棱。焊接后实际面数写回 meta.json，
  保证 manifest 与 glb 对得上。
- 2026-08-18 · `select.py --sync-targets`（默认开）把候选清单的 target_faces 同步进已定稿的
  `content/structures.yaml` · 定稿清单是人类审阅过的，不能整份覆盖；只按 slug 逐行改数值。
  这样"改 groups.yaml → pnpm pipeline:all"就是完整链路，不用手改定稿清单。
- 2026-08-18 · validate.py 收紧到本次验收标准（总体积 ≤ 25 MB、首屏 ≤ 4 MB），
  并对总面数不在 100–130 万时告警 · CLAUDE.md 的硬上限（40 MB / 5 MB / 150 万）不变。

## 待定（不做，等人类点头）

- 剖切模板封盖（stencil cap，真实断面填色）：每结构需两个 pass，移动端性能与实现复杂度高，等真机反馈决定是否值得。
- CC0 皮肤替换（Blender Studio Human Base Meshes / MPFB2）：涉及新数据源下载（域名需加入云环境白名单）与对齐工作，按 KICKOFF M2-4 流程先在此确认再动工。

- BodyParts3D 4.0 数据缺口（两集均无网格，候选清单已如实缺席）：尾骨、甲状腺、子宫/卵巢（男性模型）、坐骨神经/臂丛等全部周围神经（isa 集只有眼周细支神经，partof 集只有"nervous system"复合体）、腹直肌/背阔肌/咬肌/颞肌等部分浅层肌。M2 若需补齐，候选来源为 HuBMAP HRA（已在允许清单）或恢复 BP3D 3.0 数据源——后者需先在此记录并确认许可证。

- `prototype/` 目录未随启动包上传，仓库中暂缺。KICKOFF 描述的关键结论（6 glb / 173 万面 / 18 draw call、菲涅尔 X-ray、Kiosk 样式）已在文档中保留；若人类手头有原型文件，建议上传到 `prototype/`（只读参考）。
- KICKOFF 第 3 节列出的 `src/viewer/picking.ts、clipping.ts、highlight.ts、labels.ts` 与 `src/ui/` 各面板组件未在 M0 创建空壳，避免无用空文件；将随 M1-6（查看器核心）与对应 issue 实现。
- PWA（vite-plugin-pwa）按 KICKOFF 属 M2-3，M0 未引入。
