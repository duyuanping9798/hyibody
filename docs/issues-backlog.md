# Issue 待建清单（M1 / M2）

本会话的 GitHub 集成令牌无 issue 写权限，M1/M2 任务先记录于此。**权限修复后，由下一个会话按本文件逐条创建 issue（标签见括号），创建完删除本文件并更新 STATUS.md。** 每条的详细规格见 docs/KICKOFF.md 第 5 节。

## M1 数据与查看器核心

1. **M1-1 pipeline/download.py：按 sources.yaml 下载 BP3D 数据并校验**（M1）
   先写 `pipeline/config/sources.yaml`：从 NBDC 存档站解析 isa 与 partof 压缩包及关系表直链（`isa_BP3D_4.0_obj_99.zip`、`isa_parts_list_e.txt`、`isa_inclusion_relation_list.txt`、`isa_element_parts.txt`、`partof_BP3D_4.0_obj_99.zip`），记录 sha256 与许可证；`download.py` 下载、校验 sha256、解压到 `raw/`。验收：一条命令完成；sha256 不匹配报错；重复运行跳过已下载。

2. **M1-2 pipeline/select.py：生成候选结构清单**（M1)
   解析 BP3D 表 → 按 KICKOFF 第 7 节规则生成 `content/structures.candidates.yaml`（含系统、面数、体积、父子），骨骼约 60 组、肌群约 60、器官约 40、大血管约 40、神经约 30、皮肤 1，总数 300–600。人类挑选后定稿为 `structures.yaml`。单元测试覆盖表解析。

3. **M1-3 pipeline/process.py：网格修复、合并、简化**（M1）
   逐结构加载 OBJ → 修复 → 合并组 → 简化到 target_faces（单结构 500–3,000 面，大器官 8,000）→ 统一单位（毫米、Z-up、前方 −Y）→ 居中。可参考 prototype/process.py 的分类与减面逻辑（如已上传）。

4. **M1-4 pipeline/export.py：按系统导出 glb 与 manifest**（M1）
   节点名 = slug，extras 按 KICKOFF 第 7 节（slug/zh/en/system/region/side/fma/source）→ gltf-transform 去重、焊接、量化、meshopt → 生成 `manifest.json`。体积预算：首屏 ≤ 5 MB、全部 ≤ 40 MB。

5. **M1-5 pipeline/validate.py + 单元测试**（M1）
   清单完整性、面数与体积预算、命名唯一、FMA 保留检查；`run_all.py` 一条命令重跑；接入 `pnpm pipeline:all`。先只跑骨骼系统端到端（skeleton.glb + manifest.json）。

6. **M1-6 查看器核心交互**（M1）
   加载 manifest → 首屏皮肤+骨骼，其余系统按需加载；分层滑块（连续透明过渡，映射已在 src/viewer/layers.ts）；点击识别 + 悬停高亮 + 信息卡（中英名、一句话、来源）；隔离/隐藏/恢复；每系统透明度；单剖切面（X/Y/Z 滑块）；搜索（中英子串）；6 个预设视角；URL 状态（src/data/urlState.ts）；署名页。src/viewer 禁止 import React。

7. **M1-7 移动端与性能**（M1）
   移动端布局与触控；Playwright 截图冒烟扩展；性能预算检查脚本（draw call ≤ 600、总面数 ≤ 150 万）。

## M2 故事线、展厅与打磨

8. **M2-1 Tour 引擎与 3 条故事线**（M2）
   完善 src/tours/engine.ts；心跳血液旅程、食物去哪了、一根神经的旅程（content/tours/*.json）；每步 = 相机位姿 + 可见集合 + 高亮 + 文案 + 时长；播放/暂停/上一步/下一步。

9. **M2-2 Kiosk 展厅模式**（M2）
   `?kiosk=1`：全屏、大按钮（≥ 56 px）、闲置 60 s 回吸引动画（自动旋转 + 分层演示循环）、禁右键与手势缩放、4K 与竖屏布局。

10. **M2-3 分享与 PWA**（M2）
    URL 状态 + 二维码分享；vite-plugin-pwa 离线缓存。

11. **M2-4 HRA 器官替换与 partof 补齐**（M2）
    HRA 主角器官替换与对齐（配置化缩放/偏移，保留 BP3D 回退）；BP3D partof 集补齐整肺/整心/主动脉/整脑；可选 CC0 皮肤替换；剖切封盖。

12. **M2-5 中英切换与校对流程**（M2）
    i18n 切换；中文名人工校对流程（content/review.csv 状态列）；无障碍基础（键盘、对比度）。

13. **M2-6 性能打磨与 v0.1 发布**（M2）
    真机反馈修复；验收标准见 KICKOFF 第 11 节；打 tag v0.1。
