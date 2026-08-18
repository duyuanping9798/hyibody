"""HuBMAP Human Reference Atlas（HRA）3D 参考器官接入（M2）。

HRA 的参考器官是医学插画师按 Visible Human 男性数据做的，解剖结构分件命名、
内部件齐全（心脏 14 件：四个腔、室间隔、四个瓣、五束乳头肌），比 BodyParts3D
的扫描分割细得多。许可证 CC BY 4.0，署名见 pipeline/config/sources_hra.yaml。

两个坐标系不一样，本模块负责对上：

* 单位：HRA 的 glb 是米，BP3D 是毫米 → ×1000
* 轴向：HRA 是 glTF 惯例 Y 向上、+Z 朝前；BP3D 是 Z 向上、−Y 朝前。
  两者的 +X 都是被试的左侧（用左右心房质心实测确认，见 tests）。
  所以 (x, y, z)_hra → (x, −z, y)_bp3d，是绕 X 轴 +90° 的纯旋转（行列式 +1，不镜像）。
* 位置与大小：HRA 与 BP3D 是两个不同的人，全局对齐只能做到厘米级。
  所以逐器官做**等比拟合**：把 HRA 器官的包围盒等比缩放并平移到 BP3D 同名结构的
  包围盒上（`fit_to_fma`）。这样新器官正好占据老器官的位置，与 BP3D 的骨骼/肌肉
  仍然对得上；等比（不是逐轴）保证器官自身不变形，内部件用**同一个**变换，
  相互关系原封不动。
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


@dataclass(frozen=True)
class Fit:
    """等比相似变换：p' = p * scale + offset。"""

    scale: float
    offset: tuple[float, float, float]

    def apply(self, vertices: np.ndarray) -> np.ndarray:
        return np.asarray(vertices, dtype=np.float64) * self.scale + np.asarray(self.offset)


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
