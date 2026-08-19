# v0.1 验收清单

对照 `docs/KICKOFF.md` 第 11 节的验收标准逐条核对。日期：2026-08-18。

**云端会话无 GPU，只能用无头 Chromium 软件渲染做粗检**（CLAUDE.md 的约定）。
带 ⚠️ 的三条只能由人类在真机上确认，其余都有可复现的量化结果。

| 验收标准 | 结果 | 依据 |
|---|---|---|
| 手机浏览器 10 秒内进入可交互状态 | ⚠️ 待真机确认 | 首屏只加载皮肤 + 骨骼 **2.02 MB**（含 manifest），其余四个系统后台补载；e2e 在软件渲染下 `data-hyi-ready` 平均 13–18 秒（软件渲染基线，真机应远快于此） |
| 分层滑块流畅无明显掉帧 | ⚠️ 待真机确认 | 同屏 draw call = 结构数 **143**（预算 600），剖切开启时器官层再多约 46；`validate.py` 静态校验结构数 ≤ 580 |
| 任意结构可点击并显示正确中英文名与一句话 | ✅ | **143/143** 结构都有中英名与**中英双语**一句话科普 + "你知道吗"（`content/definitions/{zh,en}.json`，双向契约单测把关）；e2e 覆盖点击识别、`?v=` 恢复选中、中英信息卡文案 |
| 三条奥秘可播放 | ✅ | 心跳（10 步，含打开心脏与半剖）、消化（7 步）、神经（5 步）；e2e 覆盖菜单启动、步进、退出 |
| Kiosk 模式闲置自动回到吸引动画且无法退出全屏误操作 | ✅ | `?kiosk=1`，闲置阈值默认 60 秒（`?idle=` 可调），大点按目标 ≥ 56 px、禁右键；e2e 用 `?idle=2` 覆盖 |
| 署名页完整 | ✅ | BodyParts3D 4.0（CC BY 4.0）+ Noto Sans SC（SIL OFL 1.1），见 `docs/ATTRIBUTION.md` 与界面"数据来源与署名" |
| 全部资产 ≤ 40 MB | ✅ **7.61 MB** | `validate.py`（本项目自己收紧到 25 MB） |
| 首屏 ≤ 5 MB | ✅ **2.02 MB** | `validate.py`（本项目自己收紧到 4 MB） |
| CI 通过并自动发布 | ✅ | 每个 PR 跑 lint / 单测 / pipeline pytest / build / validate；合并 main 触发 Pages 部署 |

## 这一版的规模

- **143 个结构**、**1,154,816 三角面**（目标区间 100–130 万）、六个系统 glb 共 7.61 MB
- 数据全部来自 **BodyParts3D 4.0**（CC BY 4.0），无第二个数据源
- 测试：单测 **86**、pipeline pytest **33**、e2e **14**（v0.1.1）

## 已知短板（写在明处）

1. **BP3D 4.0 的数据缺口**：尾骨、甲状腺、子宫/卵巢（男性模型）、坐骨神经等全部周围神经、
   部分浅层肌。补齐需要换/加数据源，见 DECISIONS.md 待定节。
2. **源网格分辨率**：胫骨、上腔静脉等短桩血管在 BP3D 里本来就粗，提 `target_faces` 也没有新信息量。
3. **文案待人工校对**：`content/definitions/{zh,en}.json` 的 `_meta.reviewed` 仍是 `false`，
   信息卡上会标注"AI 初稿"。校对完把它改成 `true` 即可（中英各记各的）。
4. ~~英文一句话科普未做~~ v0.1.1 已补齐 143 条英文 `blurb` + `fact`。
5. **键盘只能操作界面**：`?` 可查快捷键，但还不能用 Tab 在三维结构之间走。
6. **`prototype/` 目录不在仓库里**，视觉语言按 KICKOFF 第 6 节的记录执行。

## 发布后要做的事

- **补 `v0.1` 标签**：云端 git 代理会用 HTTP 403 拒掉 tag ref 的推送
  （`git push --dry-run` 会骗人地成功，因为它根本没发包），只能由人类来做，
  三选一，具体步骤见下面「v0.1 标签怎么打」
- 人类在手机 / 电脑 / 展厅设备各跑一遍上面三条 ⚠️
- 校对中英文案与三条奥秘，改完把各自的 `_meta.reviewed` 置 `true`
- 决定是否引入 HuBMAP HRA 器官与周围神经数据源（DECISIONS.md 待定节）

## v0.1 标签（已完成 2026-08-19）

`refs/tags/v0.1` → `80e5cd73ff5249dde2fe5487815c167902e7417b`（PR #28 的合并提交），
Release 页已发布并标记 Latest。

打的过程绕了一圈，把云端代理的行为记在这里，省得下次重新摸索：

| 操作                       | 云端 Claude 能不能做 |
| -------------------------- | -------------------- |
| 推 `refs/tags/*`（建标签） | ❌ HTTP 403          |
| 推 `refs/heads/*`（建分支）| ✅                   |
| 删 `refs/heads/*`（删分支）| ❌ 连接被断          |
| GitHub MCP 工具建标签/Release | ❌ 只有只读工具   |

注意 `git push --dry-run` 推标签时**会假成功**——它根本没发包，别拿它当证据。

最后走通的路子：Claude 用 `git push origin <sha>:refs/heads/release/v0.1` 建一个
临时分支指到目标提交 → 人类在 Release 页的 **Branches** 标签页选它 → Publish，
标签就落在那个提交上 → 人类再手动删掉临时分支（Claude 删不掉）。

为什么不能直接在 Release 页选提交：那个「Pick a branch or recent commit」的搜索框
**只过滤分支**，不过滤提交。框里有字时 Recent Commits 一律显示 No results found，
敲 PR 号（`#28`）或 SHA（`80e5cd7`）都一样。得把框清空才能看到 Recent Commits 列表，
而目标提交要往下滚十几条才出现。

如果将来要重打（比如标签指错了）：

```bash
git clone https://github.com/duyuanping9798/hyibody.git && cd hyibody
git tag -a v0.1 <目标提交> -m "..."
git push origin v0.1
```

撤销：`git push --delete origin v0.1 && git tag -d v0.1`（Release 要在网页上单独删）。
