"""平滑与网格清理的回归测试。

背景：2026-08-18 之前用 trimesh.smoothing.filter_taubin，它在本数据上会发散——
顶点被甩出几百毫米，渲染出来就是肩膀和手脚的长刺。这里用合成网格锁住三条底线：
平滑不放大包围盒、位移有硬上限、互不相连的部件不会被"焊"到一起。
"""

from __future__ import annotations

import numpy as np
import pytest

process = pytest.importorskip("process")


def _uv_sphere(radius: float, rings: int = 14, sectors: int = 20, center=(0.0, 0.0, 0.0)):
    """简易 UV 球（含极点），带一点噪声好看出平滑效果。"""
    rng = np.random.default_rng(7)
    verts = [[0.0, 0.0, radius], [0.0, 0.0, -radius]]
    for i in range(1, rings):
        phi = np.pi * i / rings
        for j in range(sectors):
            theta = 2 * np.pi * j / sectors
            verts.append(
                [
                    radius * np.sin(phi) * np.cos(theta),
                    radius * np.sin(phi) * np.sin(theta),
                    radius * np.cos(phi),
                ]
            )
    v = np.array(verts, dtype=np.float64)
    v[2:] += rng.normal(0.0, radius * 0.02, size=(len(v) - 2, 3))  # 只扰动非极点
    faces = []
    idx = lambda i, j: 2 + (i - 1) * sectors + (j % sectors)  # noqa: E731
    for j in range(sectors):
        faces.append([0, idx(1, j), idx(1, j + 1)])
        faces.append([1, idx(rings - 1, j + 1), idx(rings - 1, j)])
    for i in range(1, rings - 1):
        for j in range(sectors):
            a, b, c, d = idx(i, j), idx(i, j + 1), idx(i + 1, j + 1), idx(i + 1, j)
            faces.append([a, b, c])
            faces.append([a, c, d])
    return (v + np.array(center)).astype(np.float32), np.array(faces, dtype=np.uint32)


def test_smooth_keeps_bounding_box():
    v, f = _uv_sphere(50.0)
    before = np.linalg.norm(v.max(axis=0) - v.min(axis=0))
    out = process.smooth_mesh(v, f)
    after = np.linalg.norm(out.max(axis=0) - out.min(axis=0))
    assert after <= before * 1.03, f"平滑把包围盒撑大了：{before:.2f} → {after:.2f}"
    assert out.shape == v.shape


def test_smooth_clamps_vertex_travel():
    v, f = _uv_sphere(50.0)
    out = process.smooth_mesh(v, f)
    diag = float(np.linalg.norm(v.max(axis=0) - v.min(axis=0)))
    moved = np.linalg.norm(out - v, axis=1).max()
    assert moved <= diag * process.SMOOTH_MAX_MOVE_RATIO + 1e-3


def test_smooth_actually_smooths():
    """噪声球平滑后应更接近理想球面（半径方差变小）。"""
    v, f = _uv_sphere(50.0)
    out = process.smooth_mesh(v, f)
    assert np.std(np.linalg.norm(out, axis=1)) < np.std(np.linalg.norm(v, axis=1))


def test_disconnected_parts_do_not_collapse_together():
    """左右两件（本项目左右侧常合并成一个结构）不能被平滑拉到一起——长刺就是这么来的。"""
    va, fa = _uv_sphere(30.0, center=(-150.0, 0.0, 0.0))
    vb, fb = _uv_sphere(30.0, center=(150.0, 0.0, 0.0))
    v = np.vstack([va, vb]).astype(np.float32)
    f = np.vstack([fa, fb + len(va)]).astype(np.uint32)
    out = process.smooth_mesh(v, f)
    left = out[: len(va)].mean(axis=0)
    right = out[len(va) :].mean(axis=0)
    assert abs(right[0] - left[0]) > 290.0, "两件被拉近了"
    assert process.max_edge_length(out, f) < 100.0, "出现跨部件长边（长刺）"


def test_max_edge_length_reports_longest_edge():
    v = np.array([[0, 0, 0], [10, 0, 0], [0, 4, 0]], dtype=np.float32)
    f = np.array([[0, 1, 2]], dtype=np.uint32)
    assert process.max_edge_length(v, f) == pytest.approx(10.770, abs=1e-3)
