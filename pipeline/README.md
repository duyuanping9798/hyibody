# pipeline/

Python 数据流水线（M1-1 … M1-5，issue #1–#5）。一条命令重跑：

```bash
pnpm pipeline:all            # = python3 pipeline/run_all.py（默认只跑骨骼系统）
python3 pipeline/run_all.py --systems all --skip-download
pnpm pipeline:test           # = pytest pipeline/tests
```

## 脚本

- `download.py` 按 `config/sources.yaml` 下载 BodyParts3D 4.0（isa + partof 两集），
  校验 sha256（不符即报错退出），解压到 `raw/`（gitignore）；重复运行跳过已有文件
- `select.py` 解析 BP3D 表 + `config/groups.yaml` 分组定义 →
  生成 `content/structures.candidates.yaml`（候选清单，人类定稿为 `structures.yaml`）
  与 `work/select_report.json`（未匹配/剔除报告）
- `process.py` 逐结构合并元素 OBJ → 焊接/去退化面 → fast-simplification 减面到
  `target_faces` → 按 isa 全集包围盒中心统一居中（毫米、Z-up、前方 −Y，无需旋转）
  → `work/processed/<system>/`
- `export.py` pygltflib 组装 glb（节点名 = slug，extras = KICKOFF 第 7 节字段）→
  gltf-transform `dedup → weld → quantize → meshopt` → `public/assets/<system>.glb`
  + `manifest.json`
- `validate.py` 清单/manifest/glb 校验：字段与命名唯一、fma 保留、单结构面数、
  单文件 < 50 MB、全部资产 ≤ 40 MB、首屏 ≤ 5 MB、总三角面 ≤ 150 万
- `run_all.py` download → select → process → export → validate
- `bp3d.py` 表解析与公共工具（被上述脚本与测试共用）

## 约定

- 原始数据一律在 `raw/`、中间产物在 `work/`，均不提交 git；产物 `public/assets/` 提交
- 结构挑选规则改 `config/groups.yaml`（概念英文名精确匹配 + 正则），改完重跑 select
- `select.py` 与标准库 `select` 同名：入口脚本已把本目录移到 `sys.path` 末尾，
  新脚本请沿用同样的前导代码
- 依赖见 `requirements.txt`；`@gltf-transform/cli` 需全局安装（云环境 setup script 已含）
