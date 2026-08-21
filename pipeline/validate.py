"""M1-5：校验结构清单与流水线产物是否满足 CLAUDE.md 预算。

检查项：
- 结构清单（structures.yaml 或候选清单）：字段齐全、slug/名称唯一、枚举合法、
  target_faces 在 500 至 bp3d.max_faces_for（按系统分档）之间、fma 非空
- manifest.json：schema（对齐 src/data/types.ts）、系统文件存在、结构互相对应
- glb：单文件 < 50 MB；全部资产 ≤ 40 MB；首屏（皮肤+manifest）≤ 5 MB；
  单结构面数上限见 bp3d.max_faces_for；总三角面 ≤ 500 万；节点名与 manifest 一致、extras 保留

用法：
    python3 pipeline/validate.py [--require-manifest]
"""

from __future__ import annotations

import sys
from pathlib import Path

# select.py 与标准库 select 同名（KICKOFF 规定的文件名）。直接运行本脚本时
# sys.path[0] 是 pipeline/，会遮蔽标准库；移到末尾让标准库优先，bp3d 等仍可找到。
_DIR = str(Path(__file__).resolve().parent)
if sys.path and sys.path[0] == _DIR:
    sys.path.remove(_DIR)
    sys.path.append(_DIR)

import argparse
import json
import math
import re
import sys
from pathlib import Path

import bp3d
from bp3d import ASSETS_DIR, FACES_MAX_LARGE, FACES_MIN, REGIONS, SIDES, SYSTEMS, max_faces_for

MAX_FILE_BYTES = 50_000_000  # 仓库单文件上限（CLAUDE.md）
# 2026-08-20 全量：放到 CLAUDE.md 的硬上限本身（40 MB / 5 MB），不再另设收紧值——
# 这一档就是"把 BP3D 用满"，收紧值已经没有意义。
MAX_TOTAL_BYTES = 40_000_000  # 全部资产
# 首屏：皮肤 + manifest。硬顶是 5 MB，这里留 4 MB 的收紧值——全量之后首屏实测
# 只有 1.29 MB，余量大到没有放开的理由；哪天它逼近 4 MB，说明有东西又挤进首屏了。
MAX_FIRST_SCREEN_BYTES = 4_000_000
MAX_TOTAL_TRIANGLES = 5_000_000
# 面数目标区间：低于下限说明网格被压得太狠（观感粗糙），只警告不报错。
#
# 2026-08-18 修订（用户拍板"完整性和效果优先"）：100–180 万，硬上限 200 万。
# 2026-08-20 修订（用户拍板走"B 计划"）：150–290 万，硬上限 300 万。
# 2026-08-20 再修订（用户拍板"开始向全量冲刺"）：**350–490 万，硬上限 500 万**。
# 单结构上限同时抬到"比该系统最大结构的原生面数高一点"——上限只剩护栏作用，
# 235 个 BP3D 结构全部原样导出，一个都不减面（见 bp3d.FACES_MAX_BY_SYSTEM）。
# 依据：我们用到的 BP3D 元素网格原生共 406 万面，B 计划保留 58%，
# 人类的评价是"离想要的效果还差 2/3"。这一档把剩下的 42% 全部拿回来。
# **代价照旧写在明处：全部资产 15.4 → 29.1 MB；中端安卓 30 fps 只能由人类真机
# 复核，这一档正是为了让那次复核有意义。**
TARGET_TRIANGLES_MIN = 3_500_000
TARGET_TRIANGLES_MAX = 4_900_000
# 结构数上限。
#
# 2026-08-20 之前这里写的是 580，依据是"每结构一份材质一次绘制"的静态估算。
# 那条估算**两头都错**，而且是量出来才知道的（`?stats=1`）：
#   - 改造前：235 个结构在高画质肌肉层是 **629** 次绘制调用，不是 235——
#     每个可见结构每帧要被画好几遍（主通道 + 阴影贴图 + AO 法线 G-buffer + 描边）
#   - 改造后（按系统合批，BatchedMesh）：同一场景 **41** 次。结构数已经不再驱动
#     绘制调用数了——一个系统一次（乘以通道数），跟里面装 40 个还是 400 个无关
#
# 所以这个上限现在约束的是别的东西：每实例的矩阵/颜色纹理尺寸、以及
# BatchedMesh 每帧对实例做的排序（O(N log N)）。2000 是留足余量的估计值，
# 真正该盯的是总面数与体积。**要再动这个数，先用 `?stats=1` 量，别再拍脑袋。**
MAX_STRUCTURES_FOR_DRAWCALLS = 2000
VALID_SOURCES = ("bp3d", "bp3d_partof", "hra", "cc0")
# 与 src/viewer/loadOrder.ts 的 FIRST_SCREEN_SYSTEMS 对齐（下面有一致性检查）
FIRST_SCREEN_SYSTEMS = ("skin",)


class Checker:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def error(self, msg: str) -> None:
        self.errors.append(msg)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)


def validate_structures(entries: list[dict], chk: Checker, list_name: str = "structures") -> None:
    """结构清单条目校验（候选与定稿共用）。"""
    slugs: set[str] = set()
    names: set[tuple[str, str]] = set()
    for e in entries:
        slug = e.get("slug", "<缺 slug>")
        for key in ("slug", "zh", "en", "system", "region", "side", "fma", "source", "target_faces", "priority"):
            if key not in e:
                chk.error(f"{list_name}: {slug} 缺少 {key}")
        if slug in slugs:
            chk.error(f"{list_name}: slug 重复 {slug}")
        slugs.add(slug)
        if e.get("system") not in SYSTEMS:
            chk.error(f"{list_name}: {slug} system 非法 {e.get('system')!r}")
        if e.get("region") not in REGIONS:
            chk.error(f"{list_name}: {slug} region 非法 {e.get('region')!r}")
        if e.get("side") not in SIDES:
            chk.error(f"{list_name}: {slug} side 非法 {e.get('side')!r}")
        if e.get("source") not in VALID_SOURCES:
            chk.error(f"{list_name}: {slug} source 非法 {e.get('source')!r}")
        fma = e.get("fma")
        if not isinstance(fma, list) or not all(isinstance(x, str) and x for x in fma):
            chk.error(f"{list_name}: {slug} fma 必须是字符串列表")
        elif not fma and not e.get("uberon"):
            # 许可证铁律要求每个结构留一个本体 id；BP3D 没有的概念（如室间隔）
            # 用 HRA 给的 UBERON 顶上，两者都没有才算缺
            chk.error(f"{list_name}: {slug} fma 与 uberon 不能都为空")
        tf = e.get("target_faces")
        cap = max_faces_for(slug, e.get("system"))
        if not isinstance(tf, int) or not FACES_MIN <= tf <= cap:
            chk.error(f"{list_name}: {slug} target_faces {tf!r} 不在 {FACES_MIN}–{cap}")
        if e.get("priority") not in (1, 2, 3):
            chk.error(f"{list_name}: {slug} priority 非法 {e.get('priority')!r}")
        key2 = (e.get("zh", ""), e.get("en", ""))
        if key2 in names:
            chk.warn(f"{list_name}: {slug} 中英文名与其他条目重复 {key2}")
        names.add(key2)

    # 内部件（parent）必须指向同一系统里真实存在的结构。层级最多三层
    # （脑 → 大脑 → 额叶）：HyiViewer.coversExpanded 支持多级让位，但界面上
    # 一路点下去超过三层就没人跟得住了，所以在这里卡住。
    by_slug = {e.get("slug"): e for e in entries}
    for entry in entries:
        parent = entry.get("parent")
        if parent is None:
            continue
        if parent not in by_slug:
            chk.error(f"{list_name}: {entry['slug']} 的 parent {parent!r} 不存在")
            continue
        if by_slug[parent].get("system") != entry.get("system"):
            chk.error(f"{list_name}: {entry['slug']} 与父结构 {parent} 不在同一系统")
        depth, cursor, seen = 0, parent, {entry["slug"]}
        while cursor is not None:
            if cursor in seen:
                chk.error(f"{list_name}: {entry['slug']} 的父结构链成环（{cursor}）")
                break
            seen.add(cursor)
            depth += 1
            if depth > 2:
                chk.error(f"{list_name}: {entry['slug']} 的父结构链超过三层（最多 脑 → 大脑 → 额叶）")
                break
            # 祖先本身不在清单里就停：那条错误由它自己那轮的
            # "parent 不存在"报，这里再往上走只会 KeyError
            if cursor not in by_slug:
                break
            cursor = by_slug[cursor].get("parent")


def validate_manifest_schema(manifest: dict, chk: Checker) -> None:
    for key in ("version", "generatedAt", "systems", "structures", "attribution"):
        if key not in manifest:
            chk.error(f"manifest: 缺少 {key}")
            return
    if not isinstance(manifest["systems"], list) or not manifest["systems"]:
        chk.error("manifest: systems 为空")
        return
    listed: set[str] = set()
    for s in manifest["systems"]:
        for key in ("id", "file", "bytes", "structures"):
            if key not in s:
                chk.error(f"manifest: 系统项缺少 {key}: {s.get('id')}")
        if s.get("id") not in SYSTEMS:
            chk.error(f"manifest: 系统 id 非法 {s.get('id')!r}")
        listed.update(s.get("structures", []))
    defined = set(manifest["structures"].keys())
    for slug in listed - defined:
        chk.error(f"manifest: 系统引用了未定义结构 {slug}")
    for slug in defined - listed:
        chk.error(f"manifest: 结构 {slug} 不属于任何系统")
    for slug, info in manifest["structures"].items():
        for key in ("zh", "en", "system", "region", "side", "fma", "source"):
            if key not in info:
                chk.error(f"manifest: 结构 {slug} 缺少 {key}")
        if not info.get("fma") and not info.get("uberon"):
            chk.error(f"manifest: 结构 {slug} fma 与 uberon 都为空（许可证铁律要求保留本体 id）")
        bbox = info.get("bbox")
        if bbox is not None and (not isinstance(bbox, list) or len(bbox) != 6):
            chk.error(f"manifest: 结构 {slug} bbox 非法")
    if not manifest["attribution"] or not any("BodyParts3D" in a for a in manifest["attribution"]):
        chk.error("manifest: attribution 缺少 BodyParts3D 署名")
    uses_hra = any(info.get("source") == "hra" for info in manifest["structures"].values())
    if uses_hra and not any("Human Reference Atlas" in a for a in manifest["attribution"]):
        chk.error("manifest: 用了 HRA 数据却没有 HuBMAP HRA 署名")


def glb_triangle_counts(path: Path) -> dict[str, int]:
    """读 glb（可含 meshopt 压缩）的节点名 → 三角面数；accessor.count 无需解码。"""
    from pygltflib import GLTF2

    gltf = GLTF2().load(str(path))
    out: dict[str, int] = {}
    for node in gltf.nodes:
        if node.mesh is None:
            continue
        tris = 0
        for prim in gltf.meshes[node.mesh].primitives:
            if prim.indices is not None:
                tris += gltf.accessors[prim.indices].count // 3
            else:
                tris += gltf.accessors[prim.attributes.POSITION].count // 3
        out[node.name or f"<node {node.mesh}>"] = tris
    return out


def glb_extras_ok(path: Path) -> list[str]:
    """返回缺 extras.slug 的节点名列表（gltf-transform 应保留 extras）。"""
    from pygltflib import GLTF2

    gltf = GLTF2().load(str(path))
    bad = []
    for node in gltf.nodes:
        if node.mesh is None:
            continue
        extras = getattr(node, "extras", None) or {}
        if not extras.get("slug"):
            bad.append(node.name or "<unnamed>")
    return bad


def validate_assets(manifest: dict, chk: Checker) -> None:
    # 单结构上限按系统分档，所以这里要能从 manifest 反查 slug → system
    structures = manifest.get("structures", {})
    total_bytes = (ASSETS_DIR / "manifest.json").stat().st_size
    total_tris = 0
    first_screen = (ASSETS_DIR / "manifest.json").stat().st_size
    for s in manifest["systems"]:
        glb = ASSETS_DIR / Path(s["file"]).name
        if not glb.exists():
            chk.error(f"资产缺失：{s['file']}")
            continue
        size = glb.stat().st_size
        if size != s["bytes"]:
            chk.error(f"{glb.name}: manifest bytes {s['bytes']} 与实际 {size} 不符")
        if size > MAX_FILE_BYTES:
            chk.error(f"{glb.name}: {size / 1e6:.1f} MB 超过单文件 50 MB")
        total_bytes += size
        # 首屏 = 派发 ready 之前必须下完的东西。2026-08-20 全量之后骨骼
        # （4.7 MB）挪去后台补载，这里的口径必须跟着改，否则量的是别的东西。
        # 单一事实来源是 src/viewer/loadOrder.ts 的 FIRST_SCREEN_SYSTEMS。
        if s["id"] in FIRST_SCREEN_SYSTEMS:
            first_screen += size
        counts = glb_triangle_counts(glb)
        manifest_slugs = set(s["structures"])
        node_slugs = set(counts.keys())
        for slug in manifest_slugs - node_slugs:
            chk.error(f"{glb.name}: manifest 结构 {slug} 在 glb 中无对应节点")
        for slug in node_slugs - manifest_slugs:
            chk.error(f"{glb.name}: glb 节点 {slug} 不在 manifest 中")
        for slug, tris in counts.items():
            total_tris += tris
            cap = max_faces_for(slug, structures.get(slug, {}).get("system"))
            if tris > cap * 1.05:
                chk.error(f"{glb.name}: {slug} {tris} 面超过单结构上限 {cap}")
            elif tris < 100:
                chk.warn(f"{glb.name}: {slug} 仅 {tris} 面，检查是否网格缺失")
        missing_extras = glb_extras_ok(glb)
        for slug in missing_extras:
            chk.error(f"{glb.name}: 节点 {slug} 丢失 extras（gltf-transform 配置问题？）")
    if total_bytes > MAX_TOTAL_BYTES:
        chk.error(
            f"全部资产 {total_bytes / 1e6:.1f} MB 超过 "
            f"{MAX_TOTAL_BYTES / 1e6:.0f} MB 预算"
        )
    if first_screen > MAX_FIRST_SCREEN_BYTES:
        chk.error(
            f"首屏包 {first_screen / 1e6:.2f} MB 超过 "
            f"{MAX_FIRST_SCREEN_BYTES / 1e6:.0f} MB 预算"
        )
    if not TARGET_TRIANGLES_MIN <= total_tris <= TARGET_TRIANGLES_MAX:
        chk.warn(
            f"总三角面 {total_tris} 不在目标区间 "
            f"{TARGET_TRIANGLES_MIN}–{TARGET_TRIANGLES_MAX}"
        )
    if total_tris > MAX_TOTAL_TRIANGLES:
        chk.error(f"总三角面 {total_tris} 超过 {MAX_TOTAL_TRIANGLES // 10000} 万硬上限")
    n_structures = len(manifest["structures"])
    if n_structures > MAX_STRUCTURES_FOR_DRAWCALLS:
        chk.error(
            f"结构数 {n_structures} 超过 {MAX_STRUCTURES_FOR_DRAWCALLS}"
            "（同屏 draw call ≤ 600 预算的静态估算）"
        )
    print(
        f"资产：{total_bytes / 1e6:.2f} MB（首屏 {first_screen / 1e6:.2f} MB），"
        f"三角面 {total_tris}"
    )


# 长刺检测：最长三角形边 / 包围盒对角线。平滑发散时这个值会飙到 0.8 以上
SPIKE_RATIO_ERROR = 0.65
SPIKE_RATIO_WARN = 0.4


def validate_processed_meta(chk: Checker) -> None:
    """有 work/processed 时顺带查长刺（云端重跑流水线后立刻能发现平滑发散）。"""
    root = bp3d.WORK_DIR / "processed"
    if not root.is_dir():
        return
    checked = 0
    for meta_path in sorted(root.glob("*/meta.json")):
        with meta_path.open(encoding="utf-8") as f:
            metas = json.load(f)
        for m in metas:
            edge = m.get("max_edge")
            bbox = m.get("bbox")
            if edge is None or not bbox:
                continue
            size = [bbox[i + 3] - bbox[i] for i in range(3)]
            diag = math.sqrt(sum(x * x for x in size))
            if diag <= 0:
                continue
            ratio = edge / diag
            checked += 1
            if ratio > SPIKE_RATIO_ERROR:
                chk.error(f"{m['slug']}: 最长边 {edge} mm 占包围盒对角线 {ratio:.0%}，疑似长刺")
            elif ratio > SPIKE_RATIO_WARN:
                chk.warn(f"{m['slug']}: 最长边占包围盒对角线 {ratio:.0%}（源网格本就粗？）")
    if checked:
        print(f"网格长边检查：{checked} 个结构")


def validate_first_screen_agreement(chk: Checker) -> None:
    """首屏系统这件事写在 TypeScript 那边，这里得跟它对上，否则量的是另一回事。

    validate.py 报的"首屏 X MB"是用来卡 5 MB 预算的，而真正决定首屏下什么的是
    `src/viewer/loadOrder.ts` 的 `FIRST_SCREEN_SYSTEMS`。2026-08-21 把骨骼挪去
    后台时，这个口径一共写在**三处**（这里、查看器、单测），只改了一处——
    校验会继续把骨骼算进首屏，虚报 4.9 MB 却看不出错在哪。
    TS 那边现在只剩 loadOrder.ts 一份，单测直接 import 它；这里读源码核对。
    """
    source = bp3d.ROOT / "src" / "viewer" / "loadOrder.ts"
    if not source.exists():
        chk.warn("找不到 src/viewer/loadOrder.ts，无法核对首屏口径")
        return
    m = re.search(
        r"export const FIRST_SCREEN_SYSTEMS: readonly SystemId\[\] = \[([^\]]*)\]",
        source.read_text(encoding="utf-8"),
    )
    if not m:
        chk.warn("loadOrder.ts 里找不到 FIRST_SCREEN_SYSTEMS，无法核对首屏口径")
        return
    in_viewer = tuple(re.findall(r"'([^']+)'", m.group(1)))
    if in_viewer != FIRST_SCREEN_SYSTEMS:
        chk.error(
            f"首屏口径不一致：validate.py {FIRST_SCREEN_SYSTEMS} vs "
            f"loadOrder.ts {in_viewer}"
        )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--require-manifest", action="store_true", help="manifest.json 缺失时报错")
    args = ap.parse_args(argv)
    chk = Checker()

    try:
        list_path, entries = bp3d.load_structure_list()
        validate_structures(entries, chk, list_path.name)
        print(f"结构清单 {list_path.name}：{len(entries)} 条")
    except FileNotFoundError as e:
        chk.error(str(e))

    validate_processed_meta(chk)
    validate_first_screen_agreement(chk)

    manifest_path = ASSETS_DIR / "manifest.json"
    if manifest_path.exists():
        with manifest_path.open(encoding="utf-8") as f:
            manifest = json.load(f)
        if manifest["systems"] and manifest["systems"][0].get("id") == "placeholder":
            print("manifest 为 M0 占位版，跳过资产校验")
        else:
            validate_manifest_schema(manifest, chk)
            if not chk.errors:
                validate_assets(manifest, chk)
    elif args.require_manifest:
        chk.error("public/assets/manifest.json 不存在")
    else:
        print("manifest.json 不存在，跳过资产校验")

    for w in chk.warnings:
        print(f"警告：{w}")
    if chk.errors:
        for e in chk.errors:
            print(f"错误：{e}", file=sys.stderr)
        print(f"校验失败：{len(chk.errors)} 个错误", file=sys.stderr)
        return 1
    print("校验通过。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
