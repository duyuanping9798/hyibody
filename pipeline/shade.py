"""逐顶点腔隙（cavity）烘焙：把"缝隙里的暗"预计算进 COLOR_0。

为什么烘的是**凹陷**而不是完整的环境光遮蔽：
- 运行时的 GTAO（屏幕空间）负责大尺度遮蔽——腋窝、颈侧、锁骨窝在任何
  观察距离下都由它实时算，分工已经存在；
- 缺的是高频那一层：骨缝、脑沟、椎骨关节突之间的暗。它频率高于 GTAO 的
  半分辨率缓冲，却正是 Complete Anatomy 那种"刻进骨头里"质感的来历
  （他们靠手绘 cavity 贴图，我们从几何里算）；
- pymeshlab 的 AO 滤镜在无 GPU 容器里加载不了（libfilter_ao 依赖 OpenGL），
  射线法 AO 没有 embree 又慢得不可用。凹率信号纯 numpy 可算，全身 240 万
  顶点秒级出结果，且不给流水线加任何新依赖。

算法：均匀权的伞算子（拉普拉斯）在顶点法线上的投影就是局部凹率——
邻居平均位置高出切平面越多越"凹"。按局部平均边长归一（尺度不变），
细/粗两个尺度（粗尺度 = 平滑几步后的同一信号）混合，映射到 [floor, 1]。
写进 glb 的 COLOR_0 后，three 的 vColor 直接乘进 albedo，查看器零改动。
"""

from __future__ import annotations

import numpy as np

# 细尺度直接量原始网格；粗尺度先把顶点平滑这么多步（≈ 把量测半径扩大几圈）
COARSE_SMOOTH_STEPS = 8
# 细/粗混合比：细尺度是"刻痕"，粗尺度是"沟壑"
FINE_WEIGHT = 0.62
# 凹率 → 暗度的增益；先按"中位凹缝压到 ~0.75"标定，见 test_shade.py
GAIN = 2.2
# 最深只压到这里：再黑就不像阴影像脏（审计建议 0.55–1.0 的映射区间）
FLOOR = 0.55


def _adjacency(faces: np.ndarray, count: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """无向边表（两个方向都展开）+ 每顶点度数。"""
    edges = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    edges = np.unique(np.sort(edges, axis=1), axis=0)
    a = np.concatenate([edges[:, 0], edges[:, 1]])
    b = np.concatenate([edges[:, 1], edges[:, 0]])
    degree = np.bincount(a, minlength=count).astype(np.float64)
    return a, b, degree


def _neighbor_mean(v: np.ndarray, a: np.ndarray, b: np.ndarray, degree: np.ndarray) -> np.ndarray:
    acc = np.zeros_like(v)
    for axis in range(3):
        acc[:, axis] = np.bincount(a, weights=v[b, axis], minlength=len(v))
    return acc / np.maximum(degree, 1)[:, None]


def _vertex_normals(v: np.ndarray, faces: np.ndarray) -> np.ndarray:
    fn = np.cross(v[faces[:, 1]] - v[faces[:, 0]], v[faces[:, 2]] - v[faces[:, 0]])
    n = np.zeros_like(v)
    for corner in range(3):
        for axis in range(3):
            n[:, axis] += np.bincount(faces[:, corner], weights=fn[:, axis], minlength=len(v))
    length = np.linalg.norm(n, axis=1)
    return n / np.maximum(length, 1e-12)[:, None]


def _concavity(v: np.ndarray, normals: np.ndarray, a, b, degree) -> np.ndarray:
    """归一化凹率：邻居平均位置沿法线高出多少（正 = 凹）。"""
    delta = _neighbor_mean(v, a, b, degree) - v
    concave = np.einsum("ij,ij->i", delta, normals)
    # 局部平均边长做尺度归一：肋骨的 2mm 网格和骨盆的 6mm 网格才能一个标准
    edge = np.linalg.norm(v[a] - v[b], axis=1)
    mean_edge = np.bincount(a, weights=edge, minlength=len(v)) / np.maximum(degree, 1)
    return concave / np.maximum(mean_edge, 1e-9)


def bake_vertex_shade(vertices: np.ndarray, faces: np.ndarray) -> np.ndarray:
    """返回每顶点的着色系数，float32，范围 [FLOOR, 1]。1 = 不压暗。"""
    v = np.asarray(vertices, dtype=np.float64)
    f = np.asarray(faces, dtype=np.int64)
    if len(f) == 0 or len(v) < 4:
        return np.ones(len(v), dtype=np.float32)
    a, b, degree = _adjacency(f, len(v))
    normals = _vertex_normals(v, f)

    fine = _concavity(v, normals, a, b, degree)
    smoothed = v.copy()
    for _ in range(COARSE_SMOOTH_STEPS):
        smoothed = _neighbor_mean(smoothed, a, b, degree)
    coarse = _concavity(smoothed, normals, a, b, degree)

    cavity = FINE_WEIGHT * np.maximum(fine, 0) + (1 - FINE_WEIGHT) * np.maximum(coarse, 0)
    shade = 1.0 - GAIN * cavity
    return np.clip(shade, FLOOR, 1.0).astype(np.float32)


def shade_to_color0(shade: np.ndarray) -> np.ndarray:
    """着色系数 → glb 的 COLOR_0（VEC4 uint8，RGB=系数，A=255）。

    必须是 **VEC4**：合批查看器靠几何体 color 属性的 itemSize==4 打开
    USE_COLOR_ALPHA，每实例不透明度（分层滑块）走的就是这条通道——
    导出 VEC3 会把整个分层功能弄哑（batching.ts 的 ensureVertexColor 只在
    属性缺失时补白，已有 VEC3 它不会改）。
    """
    rgb = np.round(np.clip(shade, 0, 1) * 255).astype(np.uint8)
    out = np.empty((len(shade), 4), dtype=np.uint8)
    out[:, 0] = rgb
    out[:, 1] = rgb
    out[:, 2] = rgb
    out[:, 3] = 255
    return out
