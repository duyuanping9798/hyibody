# 项目进度（STATUS）

最后更新：2026-08-17 · 会话 2 续（M1-7 移动端与手感）

## 已完成（本会话，issue #1–#5）

- `pipeline/config/sources.yaml`：BodyParts3D 4.0 八个文件直链（NBDC 存档站
  `/data/bodyparts3d/LATEST/`，即 4.0 终版）+ 实测 sha256 + CC BY 4.0 许可证信息
- `download.py`：下载 → sha256 校验（不符报错退出）→ 解压；重复运行跳过已有文件
- `select.py` + `config/groups.yaml`：按 KICKOFF 第 7 节规则生成
  `content/structures.candidates.yaml`（132 个候选：骨骼 35、肌肉 42、血管 29、
  器官 19、神经 6、皮肤 1），含面数/包围盒体积/父概念参考信息
- `process.py`：合并元素 OBJ → 焊接清理 → fast-simplification 减面 → isa 全集
  包围盒中心统一居中（各系统跨运行对齐）
- `export.py`：pygltflib 组 glb（节点名 = slug，extras 按 KICKOFF 第 7 节）→
  gltf-transform dedup/weld/quantize/meshopt → `manifest.json`（含 BP3D 署名）
- `validate.py` + `run_all.py`（`pnpm pipeline:all`）；pytest 19 个用例覆盖表解析、
  分组匹配、配置校验（`pnpm pipeline:test`）
- **全六系统流水线产物已提交**：135 结构 / 6 个 glb 共 **1.87 MB** / 239,044
  三角面（骨骼 0.52 + 肌肉 0.45 + 器官 0.42 + 血管 0.31 + 神经 0.07 + 皮肤 0.05 MB），
  首屏（皮肤+骨骼+manifest）0.63 MB ≤ 5 MB，校验全绿；`run_all.py` 默认跑全系统
- 查看器接入：GLTFLoader 注册 MeshoptDecoder；占位生成脚本检测到流水线 manifest
  即跳过；页脚显示 BP3D 署名；Playwright 截图冒烟通过（骨骼完整渲染）

## 结构挑选方法（供人类审阅候选清单）

规则写在 `pipeline/config/groups.yaml`（人可编辑）：每个候选结构 = 若干 BP3D 概念
（英文名精确匹配或正则），元素网格按 FJ id 去重合并。骨骼按 KICKOFF：颅骨 13 块合
为一组、椎骨按颈/胸/腰三组、肋骨整体一组、腕骨/跗骨各一组、四肢长骨左右单列；
isa 集缺的整器官（心/肺/肝/脑/主动脉/胸骨等）取 partof 集（`source: bp3d_partof`）。
审阅方式：直接编辑候选 yaml 删条目/改字段后另存为 `content/structures.yaml`，或改
`groups.yaml` 重跑 `python3 pipeline/select.py`。`meta` 块（面数/体积/父概念）仅供
参考，定稿时可删。未匹配与剔除记录在 `pipeline/work/select_report.json`。

**BP3D 4.0 已知缺口**（两集均无网格，候选清单已如实缺席，详见 DECISIONS.md 待定节）：
尾骨、甲状腺、子宫/卵巢（男性模型）、全部主要周围神经（坐骨神经/臂丛等；nerves
目前只有脑/小脑/脑干/脊髓/视神经/神经系统复合体 6 条）、腹直肌/背阔肌/咬肌等部分浅层肌。

## 已完成（M1-6，issue #6，PR #16）

- 首屏只加载皮肤+骨骼（0.63 MB）即可交互，其余四系统后台补载
- 分层滑块 0–1 连续透视（layers.ts 映射；皮肤/肌肉用菲涅尔 X-ray 材质）
- 点击识别（拖拽不误触；仅命中不透明度 > 0.15 的结构）+ 悬停高亮 + 选中青色高亮
- 信息卡：中英名 + FMA、系统/部位/来源署名、隔离/隐藏/聚焦/关闭；一句话科普
  为占位文案（等 content/definitions，人类任务）
- 系统面板：每系统显隐 + 透明度；血管按名称自动分动脉红/静脉蓝
- 单剖切面（左右/前后/上下 + 位置滑块）；6 预设视角 + 相机平滑飞行
- 搜索（中英子串，中文命中优先，点选即选中+聚焦）；署名弹层
- URL 状态：?v= 恢复与防抖回写（分层/系统开关/剖切/选中/相机）
- Zustand store 桥接 viewer（src/viewer 仍零 React 依赖，ESLint 强制）
- 测试：23 个单测（新增搜索、剖切数学）+ 2 个 e2e（默认视图；?v= 恢复分层+选中断言信息卡并截图）

## 已完成（观感升级包，PR #17）

- 网格精度 ×3：总面 23.9 万 → **59 万**（预算 150 万），总体积 4.1 MB（预算 40 MB），
  首屏 1.31 MB（预算 5 MB）；面数预算修订记入 CLAUDE.md 与 DECISIONS.md
- 软组织（皮肤/肌肉/器官）减面后 Taubin 平滑，消低模碎裂感
- 渲染：ACES 色调映射 + RoomEnvironment 环境光照；分系统 PBR 质感
  （骨骼哑光 / 器官血管清漆湿润 / 神经缎面）；渐变舞台背景；选中反壳描边

## 已完成（M1-7 移动端与手感，issue #7，PR #18）

- 小屏（≤720px）：右侧面板改抽屉（系统/视角标签唤出，选中结构自动收起）、
  信息卡改底部全宽卡片、搜索/滑块全宽；触屏点按目标 ≥ 44px
- 选中后相机平滑对准（保持距离与方向，只移目标点）
- 性能预算检查进流水线校验：draw call 静态估算（结构数 ≤ 580）加入 validate.py
  （体积/面数已有；fps 需真机人类确认）
- e2e 新增移动端视口用例（390×844：抽屉展开 + 信息卡断言 + 截图）

## 未完成 / 下一步

- 加强路线（人类已选定，按序做）：①观感升级 ✅ → ②移动端与手感 ✅ →
  ③科普内容+故事线（M2）→ ④剖切封盖/微动画/CC0 皮肤
- 选中高亮强度、X-ray 参数等观感项待真机反馈微调
- content/definitions 一句话科普（人类）；M2：故事线、Kiosk、HRA 替换、周围神经补源

## 给人类的待办

1. **合并 PR #16**（issue #6 查看器交互）：CI 绿后合并，手机+电脑打开站点试
   分层滑块/点击/搜索/剖切，观感问题写进 issue。
2. ~~PR #15~~ 已合并（issue #1–#5 数据流水线 + structures.yaml 定稿）。
3. **一句话科普**：信息卡目前显示占位文案，等 `content/definitions/zh.md`
   （KICKOFF 第 10 节人类清单）。
4. **CI 未跑 Python 测试**：`.github/workflows/ci.yml` 属预置文件本会话未改；
   如需在 CI 加 `pnpm pipeline:test`（需装 Python 依赖），请人类在网页端编辑或
   下个会话在 PR 描述附 yaml。
5. **周围神经缺口**：BP3D 4.0 无坐骨神经等网格。M2 想要神经层有内容，需决策
   补源（HRA 或 BP3D 3.0），见 DECISIONS.md 待定节。
