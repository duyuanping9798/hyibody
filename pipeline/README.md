# pipeline/

Python 数据流水线（M1 实现，见 docs/KICKOFF.md 第 5 节 M1-1 … M1-5）：

- `download.py` 按 `config/sources.yaml` 下载并校验 sha256，解压到 `raw/`（gitignore）
- `select.py` 解析 BP3D 表 → 生成 `content/structures.candidates.yaml` 候选清单
- `process.py` 修复 / 合并 / 简化 / 统一单位（毫米、Z-up、前方 −Y）/ 居中
- `export.py` 按系统导出 glb + `manifest.json`，经 gltf-transform 优化
- `validate.py` 结构完整性、面数、体积、命名重复检查
- `run_all.py` 一条命令重跑全流水线（`pnpm pipeline:all`）

依赖见 `requirements.txt`。原始数据一律放 `raw/`，永不提交 git。
