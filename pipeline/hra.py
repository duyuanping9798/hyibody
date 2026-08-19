"""HuBMAP Human Reference Atlas（HRA）3D 参考器官接入（M2）。

HRA 的参考器官是医学插画师按 Visible Human 男性数据做的，解剖结构分件命名、
内部件齐全（心脏 14 件：四个腔、室间隔、四个瓣、五束乳头肌），比 BodyParts3D
的扫描分割细得多。许可证 CC BY 4.0，署名见 pipeline/config/sources_hra.yaml。

两个坐标系不一样，本模块负责对上：

* 单位：HRA 的 glb 是米，BP3D 是毫米 → ×1000
* 轴向：HRA 是 glTF 惯例 Y 向上、+Z 朝前；BP3D 是 Z 向上、−Y 朝前。
  两者的 +X 都是被试的左侧（用左右心房质心实测确认，见 tests）。
  所以 (x, y, z)_hra → (x, −z, y)_bp3d，是绕 X 轴 +90° 的纯旋转（行列式 +1，不镜像）。
* 大小：**全局按身高定标一次**（两具身体皮肤网格的身高比，实测 0.9426）。
  一开始试过逐器官按包围盒缩放，结果发现 BP3D 的器官网格在前后方向普遍偏薄
  （气管 0.49、胰腺 0.61、肾 0.56，而全身皮肤的前后比是 0.90），
  按包围盒缩会把 HRA 器官整体缩掉四分之一。
* 位置：**逐器官对中心**——把缩放后的 HRA 器官平移到 BP3D 同名结构包围盒的中心
  （`fit_to_fma`）。位置信 BP3D（那样才和 BP3D 的骨骼肌肉对得上），
  形状与比例信 HRA（那本来就是这套数据的价值所在）。
  同一个 glb 的所有部件用**同一个**变换，内部相互关系原封不动。
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

from dataclasses import dataclass

import numpy as np

from bp3d import HRA_RAW_DIR

M_TO_MM = 1000.0

# (x, y, z)_hra → (x, −z, y)_bp3d：绕 X 轴 +90°
AXIS_TO_BP3D = np.array(
    [
        [1.0, 0.0, 0.0],
        [0.0, 0.0, -1.0],
        [0.0, 1.0, 0.0],
    ]
)


def to_bp3d_axes(vertices: np.ndarray) -> np.ndarray:
    """HRA glb 顶点（米、Y 向上）→ BP3D 坐标（毫米、Z 向上、−Y 朝前）。"""
    return (np.asarray(vertices, dtype=np.float64) * M_TO_MM) @ AXIS_TO_BP3D.T


def load_organ(asset: str, raw_dir: Path = HRA_RAW_DIR) -> dict[str, np.ndarray]:
    """读一个参考器官 glb，返回 {部件名: (vertices, faces)}，已换到 BP3D 坐标。

    节点变换要摊平（glb 里各部件靠节点矩阵摆到体内位置），否则部件会全挤在原点。
    """
    import trimesh

    path = raw_dir / asset
    if not path.exists():
        raise FileNotFoundError(f"{path} 不存在，先跑 python3 pipeline/download.py")
    scene = trimesh.load(path, process=False)
    if not isinstance(scene, trimesh.Scene):
        raise ValueError(f"{asset}: 期望 glTF 场景，得到 {type(scene).__name__}")
    out: dict[str, np.ndarray] = {}
    for node in scene.graph.nodes_geometry:
        transform, geom_name = scene.graph[node]
        mesh = scene.geometry[geom_name].copy()
        mesh.apply_transform(transform)
        out[geom_name] = (
            to_bp3d_axes(mesh.vertices).astype(np.float64),
            np.asarray(mesh.faces, dtype=np.int64),
        )
    if not out:
        raise ValueError(f"{asset}: 场景里没有网格")
    return out


def concat_parts(parts: list[tuple[np.ndarray, np.ndarray]]) -> tuple[np.ndarray, np.ndarray]:
    """把若干 (vertices, faces) 拼成一个网格（面索引顺移）。"""
    if not parts:
        raise ValueError("没有可拼接的部件")
    if len(parts) == 1:
        return parts[0]
    verts: list[np.ndarray] = []
    faces: list[np.ndarray] = []
    offset = 0
    for v, f in parts:
        verts.append(v)
        faces.append(f + offset)
        offset += len(v)
    return np.vstack(verts), np.vstack(faces)


def bounds_of(vertices: np.ndarray) -> np.ndarray:
    """[[minx,miny,minz],[maxx,maxy,maxz]]。"""
    v = np.asarray(vertices, dtype=np.float64)
    return np.vstack([v.min(axis=0), v.max(axis=0)])


# 判定减面碎屑的两个安全系数：连通块的面数/尺寸都不到"减面前同部件最小连通块
# 按比例缩完"的这个倍数，才算碎屑。取 0.5 是给减面算法留一倍的余量。
FRAGMENT_FACE_SLACK = 0.5
FRAGMENT_SIZE_SLACK = 0.5
# 再小的合法闭合壳也有 4 个面（四面体）
MIN_LEGIT_FACES = 4
# 源网格里不到整体对角线这个比例、又不足 4 面的连通块，判定为建模垃圾
JUNK_SIZE_RATIO = 0.01


def weld(vertices: np.ndarray, faces: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """合并重合顶点。HRA 的 glb 有些是未焊接的（眼球巩膜 12192 面却有 24383 个顶点），
    不焊就减面，算法会把它当成一堆互不相连的三角形，减完碎成几百块。"""
    import trimesh

    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    mesh.merge_vertices()
    return np.asarray(mesh.vertices), np.asarray(mesh.faces)


def clean_source(vertices: np.ndarray, faces: np.ndarray):
    """焊接 + 剔除退化面 + 剔除源网格里的杂物，返回 (顶点, 面, 连通块列表)。

    HRA 是美术建模，个别 glb 里混着零面积三角形和一两面的碎渣：右心房焊完有
    1060 个连通块，其中 1058 个是 1~2 面、对角线为 0 的垃圾。这些垃圾会把
    "减面前最小连通块"拉到 1 面 / 0 尺寸，让 drop_fragments 的门槛失效，
    于是减面产生的真碎屑一个都清不掉。所以要先把源头扫干净。
    """
    import trimesh

    wv, wf = weld(vertices, faces)
    mesh = trimesh.Trimesh(vertices=wv, faces=wf, process=False)
    mesh.update_faces(mesh.nondegenerate_faces())
    mesh.remove_unreferenced_vertices()
    pieces = mesh.split(only_watertight=False)
    if len(pieces) <= 1:
        return np.asarray(mesh.vertices), np.asarray(mesh.faces), list(pieces) or [mesh]
    whole = _diag(mesh)
    keep = [
        p
        for p in pieces
        if len(p.faces) >= MIN_LEGIT_FACES or _diag(p) >= whole * JUNK_SIZE_RATIO
    ]
    if not keep:
        return np.asarray(mesh.vertices), np.asarray(mesh.faces), list(pieces)
    kv, kf = concat_parts([(np.asarray(p.vertices), np.asarray(p.faces)) for p in keep])
    return kv, kf, keep


def _split(vertices: np.ndarray, faces: np.ndarray):
    import trimesh

    return trimesh.Trimesh(vertices=vertices, faces=faces, process=False).split(
        only_watertight=False
    )


def _diag(mesh) -> float:
    return float(np.linalg.norm(mesh.bounds[1] - mesh.bounds[0]))


def drop_fragments(
    vertices: np.ndarray, faces: np.ndarray, before, ratio: float
) -> tuple[np.ndarray, np.ndarray, int]:
    """清掉减面产生的碎屑，返回 (顶点, 面, 被清掉的面数)。

    判据来自**这个部件减面前的连通块**，而不是整个结构的总面数——这是关键。
    晶状体悬韧带本来就是 322 根各 21~42 面的睫状小带，按"占总面数 0.5% 以下
    就是碎屑"一刀切会把它整根删光（实测删掉 95%）；而右心房减面前只有 1 块，
    减完多出来的 49 块小碎片确实全是垃圾。所以门槛必须按部件自身的尺度定：
    合法连通块减面后至少还剩"最小块 × 减面比例 × 余量"这么大。
    """
    pieces = _split(vertices, faces)
    if len(pieces) <= 1:
        return vertices, faces, 0
    face_floor = max(
        float(MIN_LEGIT_FACES),
        min(len(p.faces) for p in before) * ratio * FRAGMENT_FACE_SLACK,
    )
    size_floor = min(_diag(p) for p in before) * FRAGMENT_SIZE_SLACK
    keep: list[tuple[np.ndarray, np.ndarray]] = []
    dropped = 0
    for piece in pieces:
        if len(piece.faces) < face_floor and _diag(piece) < size_floor:
            dropped += len(piece.faces)
            continue
        keep.append((np.asarray(piece.vertices), np.asarray(piece.faces)))
    if not keep:  # 全被判成碎屑说明判据不适用，原样返回
        return vertices, faces, 0
    kv, kf = concat_parts(keep)
    return kv, kf, dropped


def simplify_parts(
    parts: list[tuple[np.ndarray, np.ndarray]], target_faces: int
) -> tuple[np.ndarray, np.ndarray, float]:
    """逐部件减面再拼接，顺手清掉碎屑。返回 (顶点, 面, 被清掉的面数占比)。

    为什么逐部件而不是拼起来一起减：一个结构常常由几十个各自封闭的小壳组成
    （支气管树 34 件、大肠 10 段）。整体减面时算法会跨壳折叠，把管子掐断成
    几千个碎片——实测大肠只减 18% 的面就碎成 6229 块，逐部件减完是 17 块。

    即便逐部件，个别拓扑不干净的壳（HRA 是美术建模，不保证流形）减面后仍会掉渣，
    交给 drop_fragments 按部件自身的尺度清理。
    """
    import fast_simplification

    total_raw = sum(len(f) for _, f in parts)
    if total_raw == 0:
        raise ValueError("没有可减面的部件")
    reduced: list[tuple[np.ndarray, np.ndarray]] = []
    dropped = 0
    for v, f in parts:
        share = max(60, int(round(target_faces * len(f) / total_raw)))
        if len(f) <= share:
            reduced.append((np.asarray(v), np.asarray(f)))
            continue
        wv, wf, before = clean_source(v, f)
        if len(wf) <= share:
            reduced.append((wv, wf))
            continue
        ov, of = fast_simplification.simplify(
            np.asarray(wv, dtype=np.float32), np.asarray(wf, dtype=np.int64), target_count=share
        )
        cv, cf, lost = drop_fragments(
            np.asarray(ov), np.asarray(of), before, len(of) / max(1, len(wf))
        )
        dropped += lost
        reduced.append((cv, cf))

    v, f = concat_parts(reduced)
    return v, f, dropped / max(1, dropped + len(f))


@dataclass(frozen=True)
class Fit:
    """等比相似变换：p' = p * scale + offset。"""

    scale: float
    offset: tuple[float, float, float]

    def apply(self, vertices: np.ndarray) -> np.ndarray:
        return np.asarray(vertices, dtype=np.float64) * self.scale + np.asarray(self.offset)


def axis_ratios(source: np.ndarray, target: np.ndarray) -> np.ndarray:
    """逐轴尺寸比（target / source）。用来在日志里暴露两套数据分歧大的器官。"""
    src_size = source[1] - source[0]
    if np.any(src_size <= 0):
        raise ValueError(f"源包围盒退化：{src_size}")
    return (target[1] - target[0]) / src_size


def height_scale(source: np.ndarray, target: np.ndarray, axis: int = 2) -> float:
    """全局定标：两具身体的身高比（BP3D 坐标下 Z 轴），由各自的全身皮肤网格给出。"""
    src = float(source[1][axis] - source[0][axis])
    tgt = float(target[1][axis] - target[0][axis])
    if src <= 0 or tgt <= 0:
        raise ValueError(f"皮肤包围盒退化：源 {src}、目标 {tgt}")
    return tgt / src


def fit_centered(source: np.ndarray, target: np.ndarray, scale: float) -> Fit:
    """给定缩放，把 source 包围盒的中心平移到 target 包围盒的中心。"""
    src_center = (source[0] + source[1]) / 2.0
    tgt_center = (target[0] + target[1]) / 2.0
    offset = tgt_center - src_center * scale
    return Fit(scale=float(scale), offset=(float(offset[0]), float(offset[1]), float(offset[2])))


def fit_to_bounds(source: np.ndarray, target: np.ndarray) -> Fit:
    """把 source 包围盒等比拟合到 target 包围盒：缩放取三轴比例的几何平均，中心对齐。

    几何平均而不是逐轴缩放：逐轴会把器官压扁（两个人的心脏胖瘦本来就不同），
    等比只改大小不改形状，剩下的差异宁可留着也不造假。
    """
    src_size = source[1] - source[0]
    tgt_size = target[1] - target[0]
    if np.any(src_size <= 0):
        raise ValueError(f"源包围盒退化：{src_size}")
    ratios = tgt_size / src_size
    scale = float(np.exp(np.log(ratios).mean()))
    src_center = (source[0] + source[1]) / 2.0
    tgt_center = (target[0] + target[1]) / 2.0
    offset = tgt_center - src_center * scale
    return Fit(scale=scale, offset=(float(offset[0]), float(offset[1]), float(offset[2])))
