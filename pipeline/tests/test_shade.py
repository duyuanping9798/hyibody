"""腔隙烘焙（shade.py）：几何 → 顶点着色系数的契约。"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from shade import FLOOR, bake_vertex_shade, shade_to_color0


def _grid(nx: int, ny: int, z=None):
    """规则网格；z 给一个函数就成波面。返回 (v, f)。"""
    xs, ys = np.meshgrid(np.arange(nx, dtype=float), np.arange(ny, dtype=float))
    zs = z(xs, ys) if z else np.zeros_like(xs)
    v = np.stack([xs.ravel(), ys.ravel(), zs.ravel()], axis=1)
    quads = []
    for j in range(ny - 1):
        for i in range(nx - 1):
            a = j * nx + i
            quads.append([a, a + 1, a + nx])
            quads.append([a + 1, a + nx + 1, a + nx])
    return v, np.asarray(quads, dtype=np.int64)


def test_平面不压暗():
    v, f = _grid(20, 20)
    shade = bake_vertex_shade(v, f)
    # 内部顶点全平——不该有任何压暗（边界顶点的伞算子有偏，容忍轻微值）
    assert np.median(shade) > 0.995
    assert shade.min() > 0.9


def test_凹槽比两侧暗():
    # V 形槽：z = |x - 中线|，槽底是一条凹线
    v, f = _grid(21, 8, z=lambda x, y: np.abs(x - 10) * 1.5)
    shade = bake_vertex_shade(v, f)
    groove = shade[np.isclose(v[:, 0], 10)]
    flank = shade[np.isclose(v[:, 0], 5)]
    assert groove.mean() < flank.mean() - 0.1, (groove.mean(), flank.mean())
    # 槽再深也不许黑成一团
    assert shade.min() >= FLOOR - 1e-6


def test_凸脊不压暗():
    # 倒过来是凸脊——凹率为负，不该被当成缝隙
    v, f = _grid(21, 8, z=lambda x, y: -np.abs(x - 10) * 1.5)
    shade = bake_vertex_shade(v, f)
    ridge = shade[np.isclose(v[:, 0], 10)]
    assert ridge.mean() > 0.97


def test_退化输入不炸():
    assert bake_vertex_shade(np.zeros((0, 3)), np.zeros((0, 3), dtype=int)).shape == (0,)
    v = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0]], dtype=float)
    assert np.allclose(bake_vertex_shade(v, np.zeros((0, 3), dtype=int)), 1)


def test_COLOR0_是_VEC4_uint8():
    # VEC4 是硬契约：查看器靠 itemSize==4 打开每实例 alpha 通道（分层滑块）
    c = shade_to_color0(np.array([0.0, 0.5, 1.0], dtype=np.float32))
    assert c.shape == (3, 4)
    assert c.dtype == np.uint8
    assert list(c[:, 3]) == [255, 255, 255]
    assert c[0, 0] == 0 and c[2, 0] == 255 and 126 <= c[1, 0] <= 129
