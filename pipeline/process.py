"""M1-3：逐结构加载 OBJ → 清理 → 合并 → 简化到 target_faces → 统一坐标居中。

BP3D 坐标为毫米、Z 轴向上、前方 −Y（原型已核实），无需旋转缩放；居中偏移取 isa 集
全部网格包围盒中心（与结构挑选无关，保证各系统跨次运行对齐），写入 work/global_center.json。
产物：work/processed/<system>/<slug>.npz + meta.json。

用法：
    python3 pipeline/process.py --systems skeleton[,organs,…|all]
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

import numpy as np

import bp3d
from bp3d import SOURCE_SETS, SYSTEMS, WORK_DIR


def simplify_mesh(vertices: np.ndarray, faces: np.ndarray, target_faces: int) -> tuple[np.ndarray, np.ndarray]:
    """fast-simplification 减面到目标面数（已低于目标则原样返回）。"""
    if len(faces) <= target_faces:
        return vertices, faces
    import fast_simplification

    out_v, out_f = fast_simplification.simplify(
        vertices.astype(np.float32), faces.astype(np.int64), target_count=target_faces
    )
    return np.asarray(out_v, dtype=np.float32), np.asarray(out_f, dtype=np.uint32)


# 软组织减面后做轻度 Taubin 平滑（保体积不收缩），消掉低模碎裂感；骨骼/血管保持棱线
SMOOTH_SYSTEMS = ("skin", "muscles", "organs")
# 平滑参数：λ 收缩 / μ 回弹（|μ| > λ 才不整体缩水），迭代取偶数保证成对
SMOOTH_ITERATIONS = 8
SMOOTH_LAMBDA = 0.5
SMOOTH_MU = -0.53
# 单点位移硬上限（包围盒对角线比例）：数值一旦发散直接夹住，绝不放长刺出去
SMOOTH_MAX_MOVE_RATIO = 0.01


def _edge_graph(vertex_count: int, faces: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """无向边表 → (边端点 a, b, 各顶点度数, 边界顶点掩码)。只被一个面用到的边算边界。"""
    edges = np.vstack([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    uniq, counts = np.unique(np.sort(edges, axis=1), axis=0, return_counts=True)
    boundary = np.zeros(vertex_count, dtype=bool)
    boundary[uniq[counts == 1].ravel()] = True
    a, b = uniq[:, 0], uniq[:, 1]
    degree = (
        np.bincount(a, minlength=vertex_count) + np.bincount(b, minlength=vertex_count)
    ).astype(np.float64)
    return a, b, degree, boundary


def _umbrella(vertices: np.ndarray, a: np.ndarray, b: np.ndarray, degree: np.ndarray) -> np.ndarray:
    """伞算子位移 L·v − v；孤立点（无邻居）位移为 0，不会被拖向坐标原点。

    用 bincount 逐轴累加而不是 np.add.at：平滑改到减面之前做，输入是十几万面的
    原始网格，np.add.at 在这个量级上慢一个数量级。
    """
    n = len(vertices)
    acc = np.empty_like(vertices)
    for axis in range(3):
        col = vertices[:, axis]
        acc[:, axis] = np.bincount(a, weights=col[b], minlength=n) + np.bincount(
            b, weights=col[a], minlength=n
        )
    delta = np.zeros_like(vertices)
    has = degree > 0
    delta[has] = acc[has] / degree[has, None] - vertices[has]
    return delta


def smooth_mesh(vertices: np.ndarray, faces: np.ndarray) -> np.ndarray:
    """Taubin λ|μ 平滑（自实现的伞算子版）。

    不用 trimesh.smoothing.filter_taubin：其拉普拉斯算子在本数据上会发散——孤立点被
    拖向坐标原点、局部高频被放大，实测三角肌包围盒 499 → 651 mm、最长边 65 → 409 mm，
    渲染出来就是肩膀和手脚的长刺（2026-08-18 修）。这里固定边界点、并对总位移设硬上限。
    """
    v0 = vertices.astype(np.float64)
    v = v0.copy()
    a, b, degree, boundary = _edge_graph(len(v0), faces.astype(np.int64))
    for i in range(SMOOTH_ITERATIONS):
        step = SMOOTH_LAMBDA if i % 2 == 0 else SMOOTH_MU
        delta = _umbrella(v, a, b, degree)
        delta[boundary] = 0.0
        v += step * delta
    # 硬夹：任何顶点相对原位的位移不超过包围盒对角线的 1%
    diag = float(np.linalg.norm(v0.max(axis=0) - v0.min(axis=0)))
    moved = v - v0
    dist = np.linalg.norm(moved, axis=1)
    over = dist > SMOOTH_MAX_MOVE_RATIO * diag
    if over.any():
        moved[over] *= (SMOOTH_MAX_MOVE_RATIO * diag / dist[over])[:, None]
    return (v0 + moved).astype(np.float32)


def max_edge_length(vertices: np.ndarray, faces: np.ndarray) -> float:
    """最长三角形边（mm）——长刺检测用。"""
    if not len(faces):
        return 0.0
    f = faces.astype(np.int64)
    return float(
        max(
            np.linalg.norm(vertices[f[:, 1]] - vertices[f[:, 0]], axis=1).max(),
            np.linalg.norm(vertices[f[:, 2]] - vertices[f[:, 1]], axis=1).max(),
            np.linalg.norm(vertices[f[:, 0]] - vertices[f[:, 2]], axis=1).max(),
        )
    )


# 布尔并集的上限：件数或面数太大时退回简单拼接（避免个别结构把流水线拖到分钟级）
UNION_MAX_PARTS = 400
UNION_MAX_FACES = 600_000


def _load_parts(set_name: str, elements: list[str]) -> list["trimesh.Trimesh"]:
    import trimesh

    directory = bp3d.obj_dir(set_name)
    parts: list["trimesh.Trimesh"] = []
    for fj in elements:
        path = directory / f"{fj}.obj"
        if not path.exists():
            print(f"  警告：缺 {path.name}，跳过")
            continue
        v, f = bp3d.parse_obj(path)
        if not len(f):
            continue
        parts.append(
            trimesh.Trimesh(
                vertices=v.astype(np.float64),
                faces=f.astype(np.int64),
                process=True,
                validate=True,
            )
        )
    return parts


def merge_elements(set_name: str, elements: list[str]) -> tuple["trimesh.Trimesh", str]:
    """加载一组 FJ obj 并合成一个网格，返回 (网格, 合并方式)。

    BP3D 的一个结构常常是几十上百个各自封闭的小壳（心脏 83 件、双肺 124 件）。
    直接拼接只是把三角面堆在一起：壳与壳相交处两层表面都留着，内壁也全在，
    渲染出来就是坑坑洼洼的蜡块，近看完全不像器官。

    所以只要各件都水密就走**布尔并集**（manifold3d），得到一张真正的外表面；
    实测心脏 83 件 10.3 万面 → 8.6 万面且水密，耗时 1.3 秒。
    有一件不水密（BP3D 里确实存在破面）就退回拼接，并在日志里说明。
    """
    import trimesh

    parts = _load_parts(set_name, elements)
    if not parts:
        raise ValueError("没有可用网格")

    total_faces = sum(len(m.faces) for m in parts)
    if len(parts) > 1 and len(parts) <= UNION_MAX_PARTS and total_faces <= UNION_MAX_FACES:
        solid = [m for m in parts if m.is_watertight]
        leaky = [m for m in parts if not m.is_watertight]
        if len(solid) > 1:
            try:
                merged = trimesh.boolean.union(solid, engine="manifold")
                if len(merged.faces) > 0:
                    # 破面的那几件没法参与布尔，直接拼回去——总比整个结构退回拼接强
                    # （肝 60 件里只有 1 件破面，颅骨 21 件里 1 件）
                    if leaky:
                        print(f"  {len(leaky)}/{len(parts)} 件不水密，这几件拼接、其余取并集")
                        merged = trimesh.util.concatenate([merged, *leaky])
                    merged.process(validate=True)
                    return merged, "union" if not leaky else "union+concat"
                print("  警告：布尔并集结果为空，退回拼接")
            except Exception as exc:  # noqa: BLE001 — 并集失败不该中断整条流水线
                print(f"  警告：布尔并集失败（{type(exc).__name__}），退回拼接")

    if len(parts) == 1:
        return parts[0], "single"
    return trimesh.util.concatenate(parts), "concat"


def process_structure(entry: dict, center: np.ndarray) -> dict | None:
    """处理单个结构，返回 meta（含输出路径）；无网格返回 None。"""
    set_name = SOURCE_SETS.get(entry["source"])
    if set_name is None:
        print(f"  跳过 {entry['slug']}（source={entry['source']}，非 BP3D 来源，M2 处理）")
        return None
    dataset = bp3d.load_set(set_name)
    elements: list[str] = []
    seen: set[str] = set()
    for fma in entry["fma"]:
        for fj in dataset.elements.get(fma, []):
            if fj not in seen:
                seen.add(fj)
                elements.append(fj)
    if not elements:
        raise ValueError(f"{entry['slug']}: fma {entry['fma']} 在 {set_name} 集无元素网格")

    mesh, merge_mode = merge_elements(set_name, elements)
    raw_faces = len(mesh.faces)
    v = np.asarray(mesh.vertices, dtype=np.float32)
    f = np.asarray(mesh.faces, dtype=np.int64)
    # 先平滑再减面（2026-08-18 改）：在原始分辨率上抹掉扫描阶梯，减面算法据此保形；
    # 反过来先减面再平滑等于在低模上摊平，圆润度和特征都保不住。
    if entry["system"] in SMOOTH_SYSTEMS:
        diag_before = float(np.linalg.norm(v.max(axis=0) - v.min(axis=0)))
        v = smooth_mesh(v, f)
        diag_after = float(np.linalg.norm(v.max(axis=0) - v.min(axis=0)))
        # 平滑只该抹平细节，绝不该把网格撑大；发散时立刻失败而不是导出长刺
        # 逐点位移已夹在对角线 1% 内，包围盒最多涨 ~2%；超过 3% 说明算子发散
        if diag_before > 0 and diag_after > diag_before * 1.03:
            raise ValueError(
                f"{entry['slug']}: 平滑后包围盒对角线 {diag_before:.1f} → {diag_after:.1f} mm，疑似发散"
            )
    v, f = simplify_mesh(v, f, int(entry["target_faces"]))
    v = v - center.astype(np.float32)
    bbox = np.concatenate([v.min(axis=0), v.max(axis=0)]).astype(float)

    out_dir = WORK_DIR / "processed" / entry["system"]
    out_dir.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out_dir / f"{entry['slug']}.npz", vertices=v.astype(np.float32), faces=f.astype(np.uint32))
    return {
        "slug": entry["slug"],
        "zh": entry["zh"],
        "en": entry["en"],
        "system": entry["system"],
        "region": entry["region"],
        "side": entry["side"],
        "fma": list(entry["fma"]),
        "source": entry["source"],
        **({"parent": entry["parent"]} if entry.get("parent") else {}),
        "faces_raw": int(raw_faces),
        "faces": int(len(f)),
        "vertices": int(len(v)),
        "bbox": [round(float(x), 2) for x in bbox],
        "max_edge": round(max_edge_length(v, f), 2),
        "elements": len(elements),
        "merge_mode": merge_mode,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--systems", default="skeleton", help="逗号分隔的系统列表，或 all")
    args = ap.parse_args(argv)
    wanted = list(SYSTEMS) if args.systems == "all" else args.systems.split(",")
    for s in wanted:
        if s not in SYSTEMS:
            raise SystemExit(f"错误：未知系统 {s!r}")

    list_path, entries = bp3d.load_structure_list()
    print(f"结构清单：{list_path.name}（{len(entries)} 条）")
    # 居中偏移只依赖 isa 全集，跨系统 / 跨运行一致
    center = np.array(bp3d.global_center(bp3d.obj_stats("isa")), dtype=np.float64)
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    with (WORK_DIR / "global_center.json").open("w", encoding="utf-8") as fp:
        json.dump({"center_mm": [round(float(c), 3) for c in center]}, fp)

    for system in wanted:
        todo = [e for e in entries if e["system"] == system]
        if not todo:
            print(f"{system}: 清单中没有条目，跳过")
            continue
        print(f"{system}: 处理 {len(todo)} 个结构")
        metas: list[dict] = []
        for e in todo:
            meta = process_structure(e, center)
            if meta is None:
                continue
            print(
                f"  {meta['slug']}: {meta['elements']} 件（{meta['merge_mode']}）, "
                f"{meta['faces_raw']} → {meta['faces']} 面"
            )
            metas.append(meta)
        out_dir = WORK_DIR / "processed" / system
        out_dir.mkdir(parents=True, exist_ok=True)
        with (out_dir / "meta.json").open("w", encoding="utf-8") as fp:
            json.dump(metas, fp, ensure_ascii=False, indent=1)
        total = sum(m["faces"] for m in metas)
        print(f"{system}: 共 {len(metas)} 结构 {total} 面")
    return 0


if __name__ == "__main__":
    sys.exit(main())
