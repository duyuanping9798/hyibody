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
import hra
from bp3d import HRA_SOURCE, SOURCE_SETS, SYSTEMS, WORK_DIR


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


def elements_for(set_name: str, fma_list: list[str]) -> list[str]:
    """一个结构的 FMA 概念列表 → 去重后的 FJ 元素网格 id 列表。"""
    dataset = bp3d.load_set(set_name)
    elements: list[str] = []
    seen: set[str] = set()
    for fma in fma_list:
        for fj in dataset.elements.get(fma, []):
            if fj not in seen:
                seen.add(fj)
                elements.append(fj)
    return elements


def bp3d_bounds(set_name: str, fma_list: list[str]) -> np.ndarray:
    """BP3D 里某结构的原始包围盒（毫米，未居中）——给 HRA 器官当定位锚点。

    只要包围盒，所以不做布尔并集，直接把各元素顶点堆起来取极值。
    """
    directory = bp3d.obj_dir(set_name)
    lo = np.full(3, np.inf)
    hi = np.full(3, -np.inf)
    for fj in elements_for(set_name, fma_list):
        path = directory / f"{fj}.obj"
        if not path.exists():
            continue
        v, f = bp3d.parse_obj(path)
        if not len(f):
            continue
        lo = np.minimum(lo, v.min(axis=0))
        hi = np.maximum(hi, v.max(axis=0))
    if not np.isfinite(lo).all():
        raise ValueError(f"{fma_list} 在 {set_name} 集没有可用网格，无法当定位锚点")
    return np.vstack([lo, hi])


def hra_assets_of(spec: dict) -> list[str]:
    """一条 HRA 结构用到的 glb 列表。`asset`（单个）是 `assets`（多个）的简写。"""
    if spec.get("assets"):
        return list(spec["assets"])
    if spec.get("asset"):
        return [spec["asset"]]
    raise ValueError(f"hra 配置缺 asset/assets：{spec}")


# 全局定标的两个参照：HRA 的全身皮肤 glb 与 BP3D 的皮肤概念
HRA_SKIN_ASSET = "3d-vh-m-skin.glb"
BP3D_SKIN_FMA = ["FMA7163"]


def hra_body_fit() -> tuple[float, hra.Fit]:
    """全身对齐：缩放取两具身体皮肤网格的身高比，平移把两张皮肤的包围盒中心对上。

    返回 (缩放, 全身变换)。全身变换给那些没有 BP3D 对应结构、又横跨全身的结构用
    （脊髓——BP3D 的"脊髓"只是脑干下方 36 mm 的一截残桩，拿它对中心会整条摆错）。
    """
    verts = [v for v, _ in hra.load_organ(HRA_SKIN_ASSET).values()]
    src = hra.bounds_of(np.vstack(verts))
    tgt = bp3d_bounds("isa", BP3D_SKIN_FMA)
    scale = hra.height_scale(src, tgt)
    return scale, hra.fit_centered(src, tgt, scale)


def hra_fit_for(entries: list[dict]) -> dict[str, hra.Fit]:
    """按资产算一次等比拟合变换：同一个 glb 的所有部件必须共用一个变换。

    锚点由声明了 `hra.fit_to_fma` 的那条（顶层结构）给出。一条锚点可以覆盖多个 glb
    （左右肾是两个文件但在本站是一条"肾"）：这时按几个 glb 合起来的包围盒算一次，
    再登记给组里每个 glb——各算各的会让左右肾缩放不一致。
    """
    anchors = [
        e for e in entries if e.get("source") == HRA_SOURCE and "fit_to_fma" in (e.get("hra") or {})
    ]
    borrowed = [
        e for e in entries if e.get("source") == HRA_SOURCE and "fit_from" in (e.get("hra") or {})
    ]
    if not anchors and not borrowed:
        return {}
    scale, body_fit = hra_body_fit()
    print(f"  HRA → BP3D 全局定标 ×{scale:.4f}（两具身体皮肤网格的身高比）")
    # 皮肤资产本身就是"全身对齐"这条变换，fit_from 指到它即可
    fits: dict[str, hra.Fit] = {HRA_SKIN_ASSET: body_fit}
    for entry in anchors:
        spec = entry["hra"]
        assets = hra_assets_of(spec)
        wanted = set(spec.get("meshes") or [])
        verts = []
        for asset in assets:
            for name, (v_part, _) in hra.load_organ(asset).items():
                # 锚点只按这条结构自己声明的部件算：前列腺的 glb 里还装着精囊与
                # 输精管，拿整包去比 BP3D 的前列腺等于把参照物撑大一圈
                if not wanted or name in wanted:
                    verts.append(v_part)
        source = hra.bounds_of(np.vstack(verts))
        target = bp3d_bounds(spec.get("fit_to_set", "partof"), list(spec["fit_to_fma"]))
        fit = hra.fit_centered(source, target, scale)
        for asset in assets:
            fits[asset] = fit
        # 逐轴比暴露两套数据分歧大的器官（脾在两边的长轴方向就不一样），
        # 这里只报告不纠正——纠正就等于按 BP3D 的粗网格去改 HRA 的形状
        ratios = hra.axis_ratios(source, target)
        flag = " ← 两套数据尺寸分歧较大" if float(np.min(ratios)) < 0.7 else ""
        print(
            f"  {'+'.join(assets)}: 对中到 BP3D {'/'.join(spec['fit_to_fma'])}，"
            f"平移 {np.round(fit.offset, 1).tolist()} mm，"
            f"逐轴尺寸比 {np.round(ratios, 2).tolist()}{flag}"
        )
    # BP3D 里没有对应结构的（主支气管），借用解剖上相连的那个资产的变换：
    # HRA 各资产共用一个坐标系，气管往下就是主支气管，跟着气管走才接得上
    for entry in borrowed:
        spec = entry["hra"]
        donor = spec["fit_from"]
        if donor not in fits:
            raise ValueError(f"{entry['slug']}: fit_from 指向的 {donor} 没有锚点")
        for asset in hra_assets_of(spec):
            if asset in fits:
                continue
            fits[asset] = fits[donor]
            print(f"  {asset}: 沿用 {donor} 的变换（BP3D 无对应结构可对中心）")
    return fits


def process_hra_structure(entry: dict, center: np.ndarray, fits: dict[str, hra.Fit]) -> dict:
    """处理一条 HRA 结构：取指定部件 → 等比拟合 → 减面 → 居中。

    不做 Taubin 平滑：HRA 是医学插画师建的模型，本来就光顺，平滑只会磨掉瓣叶边缘。
    """
    spec = entry["hra"]
    assets = hra_assets_of(spec)
    parts: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for asset in assets:
        fit = fits.get(asset)
        if fit is None:
            raise ValueError(f"{entry['slug']}: {asset} 没有定位锚点（哪条结构都没写 fit_to_fma）")
        # 拟合在这里就做掉：同一条结构可能横跨两个 glb（左右肾），拼起来之前先各自摆正
        for name, (v_part, f_part) in hra.load_organ(asset).items():
            parts[name] = (fit.apply(v_part), f_part)
    wanted = list(spec["meshes"]) if spec.get("meshes") else sorted(parts)
    missing = [n for n in wanted if n not in parts]
    if missing:
        raise ValueError(f"{entry['slug']}: {'+'.join(assets)} 里没有部件 {missing}（可用：{sorted(parts)}）")
    raw_faces = sum(len(parts[n][1]) for n in wanted)
    # 逐部件焊接 + 减面 + 清碎屑，见 hra.simplify_parts 的注释
    v, f, dropped = hra.simplify_parts([parts[n] for n in wanted], int(entry["target_faces"]))
    v = v.astype(np.float32)
    f = f.astype(np.int64)
    v = v - center.astype(np.float32)
    bbox = np.concatenate([v.min(axis=0), v.max(axis=0)]).astype(float)

    out_dir = WORK_DIR / "processed" / entry["system"]
    out_dir.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        out_dir / f"{entry['slug']}.npz", vertices=v.astype(np.float32), faces=f.astype(np.uint32)
    )
    return {
        "slug": entry["slug"],
        "zh": entry["zh"],
        "en": entry["en"],
        "system": entry["system"],
        "region": entry["region"],
        "side": entry["side"],
        "fma": list(entry.get("fma") or []),
        **({"uberon": entry["uberon"]} if entry.get("uberon") else {}),
        "source": entry["source"],
        **({"parent": entry["parent"]} if entry.get("parent") else {}),
        "faces_raw": int(raw_faces),
        "fragment_ratio": round(float(dropped), 4),
        "faces": int(len(f)),
        "vertices": int(len(v)),
        "bbox": [round(float(x), 2) for x in bbox],
        "max_edge": round(max_edge_length(v, f), 2),
        "elements": len(wanted),
        "merge_mode": "hra",
    }


def process_structure(entry: dict, center: np.ndarray) -> dict | None:
    """处理单个结构，返回 meta（含输出路径）；无网格返回 None。"""
    set_name = SOURCE_SETS.get(entry["source"])
    if set_name is None:
        print(f"  跳过 {entry['slug']}（source={entry['source']}，非 BP3D 来源，M2 处理）")
        return None
    elements = elements_for(set_name, list(entry["fma"]))
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
        **({"uberon": entry["uberon"]} if entry.get("uberon") else {}),
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
        fits = hra_fit_for(todo)
        metas: list[dict] = []
        for e in todo:
            if e.get("source") == HRA_SOURCE:
                meta = process_hra_structure(e, center, fits)
            else:
                meta = process_structure(e, center)
            if meta is None:
                continue
            frag = meta.get("fragment_ratio") or 0
            extra = f"，清掉碎屑 {frag * 100:.1f}%" if frag > 0.001 else ""
            print(
                f"  {meta['slug']}: {meta['elements']} 件（{meta['merge_mode']}）, "
                f"{meta['faces_raw']} → {meta['faces']} 面{extra}"
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
