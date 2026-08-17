# 项目进度（STATUS）

最后更新：2026-08-17 · 会话 2（M1-1 … M1-5 数据流水线）

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
- **骨骼系统端到端产物已提交**：`public/assets/skeleton.glb` 0.52 MB / 35 结构 /
  70,078 三角面 + `manifest.json`（首屏 0.53 MB ≤ 5 MB 预算，校验全绿）
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

## 未完成 / 下一步

- ~~定稿 `content/structures.yaml`~~ 已完成：AI 审阅 140 候选 → 删 5 条重叠 →
  135 条定稿（人类在会话中批准，见 DECISIONS.md），PR diff 中可做最终增删
- M1-6 查看器核心交互（issue #6）：分层、拾取、信息卡、剖切、搜索、URL 状态
- M1-7 移动端与性能预算检查（issue #7）
- 其余系统（皮肤/肌肉/器官/血管/神经）跑流水线：`python3 pipeline/run_all.py
  --systems all --skip-download`（等 structures.yaml 定稿后再跑更省返工）
- M2：故事线、Kiosk、HRA 替换、周围神经补源决策

## 给人类的待办

1. **合并本 PR**（issue #1–#5）：看 CI 变绿、浏览 diff（重点：`content/
   structures.candidates.yaml` 与 `docs/DECISIONS.md` 新增决策）后合并。
2. **过目 `content/structures.yaml` 定稿**（已按你批准的审阅建议生成，135 条）：
   在 PR diff 里做最终增删即可；删掉的 5 条重叠结构仍留在候选清单里可随时恢复。
3. **确认 Pages**：合并后手机/电脑打开站点，应看到真实骨骼（不再是占位人形）。
4. **CI 未跑 Python 测试**：`.github/workflows/ci.yml` 属预置文件本会话未改；
   如需在 CI 加 `pnpm pipeline:test`（需装 Python 依赖），请人类在网页端编辑或
   下个会话在 PR 描述附 yaml。
5. **周围神经缺口**：BP3D 4.0 无坐骨神经等网格。M2 想要神经层有内容，需决策
   补源（HRA 或 BP3D 3.0），见 DECISIONS.md 待定节。
