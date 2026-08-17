"""M1-5：校验结构清单与流水线产物是否满足 CLAUDE.md 预算。

检查项：
- 结构清单（structures.yaml 或候选清单）：字段齐全、slug/名称唯一、枚举合法、
  target_faces 在 500–8000、fma 非空
- manifest.json：schema（对齐 src/data/types.ts）、系统文件存在、结构互相对应
- glb：单文件 < 50 MB；全部资产 ≤ 40 MB；首屏（皮肤+骨骼+manifest）≤ 5 MB；
  单结构面数 ≤ 8000×1.05；总三角面 ≤ 150 万；节点名与 manifest 一致、extras 保留

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
import sys
from pathlib import Path

import bp3d
from bp3d import ASSETS_DIR, FACES_MAX_LARGE, FACES_MIN, REGIONS, SIDES, SYSTEMS

MAX_FILE_BYTES = 50_000_000  # 仓库单文件上限（CLAUDE.md）
MAX_TOTAL_BYTES = 40_000_000  # 全部资产
MAX_FIRST_SCREEN_BYTES = 5_000_000  # 首屏：皮肤 + 骨骼 + manifest
MAX_TOTAL_TRIANGLES = 1_500_000
VALID_SOURCES = ("bp3d", "bp3d_partof", "hra", "cc0")


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
        if not isinstance(fma, list) or not fma or not all(isinstance(x, str) and x for x in fma):
            chk.error(f"{list_name}: {slug} fma 必须是非空字符串列表")
        tf = e.get("target_faces")
        if not isinstance(tf, int) or not FACES_MIN <= tf <= FACES_MAX_LARGE:
            chk.error(f"{list_name}: {slug} target_faces {tf!r} 不在 {FACES_MIN}–{FACES_MAX_LARGE}")
        if e.get("priority") not in (1, 2, 3):
            chk.error(f"{list_name}: {slug} priority 非法 {e.get('priority')!r}")
        key2 = (e.get("zh", ""), e.get("en", ""))
        if key2 in names:
            chk.warn(f"{list_name}: {slug} 中英文名与其他条目重复 {key2}")
        names.add(key2)


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
        if not info.get("fma"):
            chk.error(f"manifest: 结构 {slug} fma 为空（许可证铁律要求保留）")
        bbox = info.get("bbox")
        if bbox is not None and (not isinstance(bbox, list) or len(bbox) != 6):
            chk.error(f"manifest: 结构 {slug} bbox 非法")
    if not manifest["attribution"] or not any("BodyParts3D" in a for a in manifest["attribution"]):
        chk.error("manifest: attribution 缺少 BodyParts3D 署名")


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
        if s["id"] in ("skin", "skeleton"):
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
            if tris > FACES_MAX_LARGE * 1.05:
                chk.error(f"{glb.name}: {slug} {tris} 面超过大结构上限 {FACES_MAX_LARGE}")
            elif tris < 100:
                chk.warn(f"{glb.name}: {slug} 仅 {tris} 面，检查是否网格缺失")
        missing_extras = glb_extras_ok(glb)
        for slug in missing_extras:
            chk.error(f"{glb.name}: 节点 {slug} 丢失 extras（gltf-transform 配置问题？）")
    if total_bytes > MAX_TOTAL_BYTES:
        chk.error(f"全部资产 {total_bytes / 1e6:.1f} MB 超过 40 MB 预算")
    if first_screen > MAX_FIRST_SCREEN_BYTES:
        chk.error(f"首屏包 {first_screen / 1e6:.2f} MB 超过 5 MB 预算")
    if total_tris > MAX_TOTAL_TRIANGLES:
        chk.error(f"总三角面 {total_tris} 超过 150 万预算")
    print(
        f"资产：{total_bytes / 1e6:.2f} MB（首屏 {first_screen / 1e6:.2f} MB），"
        f"三角面 {total_tris}"
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
