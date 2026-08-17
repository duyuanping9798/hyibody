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


def smooth_mesh(vertices: np.ndarray, faces: np.ndarray) -> np.ndarray:
    import trimesh

    mesh = trimesh.Trimesh(vertices=vertices.astype(np.float64), faces=faces, process=False)
    trimesh.smoothing.filter_taubin(mesh, lamb=0.5, nu=0.53, iterations=8)
    return np.asarray(mesh.vertices, dtype=np.float32)


def merge_elements(set_name: str, elements: list[str]) -> "trimesh.Trimesh":
    """加载并拼接一组 FJ obj，焊接顶点、去退化面。"""
    import trimesh

    directory = bp3d.obj_dir(set_name)
    parts_v: list[np.ndarray] = []
    parts_f: list[np.ndarray] = []
    offset = 0
    for fj in elements:
        path = directory / f"{fj}.obj"
        if not path.exists():
            print(f"  警告：缺 {path.name}，跳过")
            continue
        v, f = bp3d.parse_obj(path)
        if not len(f):
            continue
        parts_v.append(v)
        parts_f.append(f.astype(np.int64) + offset)
        offset += len(v)
    if not parts_v:
        raise ValueError("没有可用网格")
    mesh = trimesh.Trimesh(
        vertices=np.vstack(parts_v), faces=np.vstack(parts_f), process=True, validate=True
    )
    return mesh


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

    mesh = merge_elements(set_name, elements)
    raw_faces = len(mesh.faces)
    v, f = simplify_mesh(
        np.asarray(mesh.vertices, dtype=np.float32),
        np.asarray(mesh.faces, dtype=np.int64),
        int(entry["target_faces"]),
    )
    if entry["system"] in SMOOTH_SYSTEMS:
        v = smooth_mesh(v, f)
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
        "faces_raw": int(raw_faces),
        "faces": int(len(f)),
        "vertices": int(len(v)),
        "bbox": [round(float(x), 2) for x in bbox],
        "elements": len(elements),
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
                f"  {meta['slug']}: {meta['elements']} 件, {meta['faces_raw']} → {meta['faces']} 面"
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
