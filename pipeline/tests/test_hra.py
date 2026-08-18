"""HRA 接入的坐标映射与等比拟合测试（不依赖已下载的 glb）。"""

import numpy as np
import pytest
import yaml

import bp3d
import hra


def test_axis_matrix_is_a_proper_rotation():
    """(x, y, z)_hra → (x, −z, y)_bp3d 必须是纯旋转：行列式 +1，绝不能镜像左右。"""
    assert np.isclose(np.linalg.det(hra.AXIS_TO_BP3D), 1.0)
    assert np.allclose(hra.AXIS_TO_BP3D @ hra.AXIS_TO_BP3D.T, np.eye(3))


def test_axis_mapping_keeps_left_right_and_flips_front():
    # HRA：Y 向上、+Z 朝前、+X 是被试左侧；BP3D：Z 向上、−Y 朝前、+X 同样是左侧
    up = hra.to_bp3d_axes(np.array([[0.0, 1.0, 0.0]]))[0]
    front = hra.to_bp3d_axes(np.array([[0.0, 0.0, 1.0]]))[0]
    left = hra.to_bp3d_axes(np.array([[1.0, 0.0, 0.0]]))[0]
    assert np.allclose(up, [0, 0, 1000])  # 顺带验证米 → 毫米
    assert np.allclose(front, [0, -1000, 0])
    assert np.allclose(left, [1000, 0, 0])


def test_height_scale_is_the_body_height_ratio():
    src = np.array([[0.0, 0.0, -900.0], [0.0, 0.0, 900.0]])
    tgt = np.array([[0.0, 0.0, -800.0], [0.0, 0.0, 900.0]])
    assert hra.height_scale(src, tgt) == pytest.approx(1700 / 1800)


def test_fit_centered_keeps_scale_and_matches_centres():
    """全局定标 + 对中：尺寸只按给定缩放变，中心落到目标包围盒中心。"""
    source = np.array([[0.0, 0.0, 0.0], [10.0, 20.0, 40.0]])
    target = np.array([[100.0, 100.0, 100.0], [110.0, 110.0, 110.0]])
    fit = hra.fit_centered(source, target, 0.5)
    out = hra.bounds_of(fit.apply(source))
    assert np.allclose((out[0] + out[1]) / 2, [105.0, 105.0, 105.0])
    assert np.allclose(out[1] - out[0], [5.0, 10.0, 20.0])  # 形状没有被拉伸


def test_axis_ratios_reports_per_axis_disagreement():
    source = np.array([[0.0, 0.0, 0.0], [10.0, 10.0, 10.0]])
    target = np.array([[0.0, 0.0, 0.0], [8.0, 5.0, 10.0]])
    assert np.allclose(hra.axis_ratios(source, target), [0.8, 0.5, 1.0])


def test_fit_is_uniform_and_centres_on_target():
    source = np.array([[0.0, 0.0, 0.0], [10.0, 10.0, 10.0]])
    target = np.array([[100.0, 100.0, 100.0], [120.0, 120.0, 120.0]])
    fit = hra.fit_to_bounds(source, target)
    assert fit.scale == pytest.approx(2.0)
    fitted = hra.bounds_of(fit.apply(source))
    assert np.allclose(fitted, target)


def test_fit_scale_is_geometric_mean_so_shape_is_not_squashed():
    """逐轴比例不同时取几何平均：器官只改大小，不被压扁。"""
    source = np.array([[0.0, 0.0, 0.0], [10.0, 10.0, 10.0]])
    target = np.array([[0.0, 0.0, 0.0], [10.0, 20.0, 40.0]])
    fit = hra.fit_to_bounds(source, target)
    assert fit.scale == pytest.approx((1 * 2 * 4) ** (1 / 3))
    size = np.diff(hra.bounds_of(fit.apply(source)), axis=0)[0]
    assert size[0] == pytest.approx(size[1]) == pytest.approx(size[2])


def test_fit_rejects_degenerate_source():
    flat = np.array([[0.0, 0.0, 0.0], [10.0, 0.0, 10.0]])
    with pytest.raises(ValueError):
        hra.fit_to_bounds(flat, np.array([[0.0, 0.0, 0.0], [1.0, 1.0, 1.0]]))


def test_concat_parts_offsets_face_indices():
    a = (np.zeros((3, 3)), np.array([[0, 1, 2]]))
    b = (np.ones((3, 3)), np.array([[0, 1, 2]]))
    v, f = hra.concat_parts([a, b])
    assert len(v) == 6
    assert f.tolist() == [[0, 1, 2], [3, 4, 5]]


def test_hra_sources_yaml_is_valid_and_cc_by():
    cfg = bp3d.load_sources(bp3d.SOURCES_HRA_YAML)
    assert cfg["license"]["name"] == "CC BY 4.0"
    assert cfg["license"]["url"].startswith("https://creativecommons.org/licenses/by/4.0")
    assert cfg["files"], "至少要有一个资产"
    for entry in cfg["files"]:
        assert entry["kind"] == "glb"
        assert entry["url_path"].endswith(".glb")
        # 明确不收 Allen 派生的脑模型（CLAUDE.md 的许可证铁律）
        assert "allen" not in entry["url_path"].lower()


def test_structure_list_hra_entries_declare_meshes_and_one_anchor():
    entries = yaml.safe_load(bp3d.STRUCTURES_YAML.read_text(encoding="utf-8"))
    hra_entries = [e for e in entries if e.get("source") == bp3d.HRA_SOURCE]
    assert hra_entries, "结构清单里应该有 HRA 结构"
    anchors: dict[str, int] = {}
    used: set[str] = set()
    for e in hra_entries:
        spec = e.get("hra")
        assert spec, f"{e['slug']}: 缺 hra 配置"
        assets = list(spec.get("assets") or ([spec["asset"]] if spec.get("asset") else []))
        assert assets, f"{e['slug']}: 缺 hra.asset/assets"
        used.update(assets)
        assert "meshes" in spec, f"{e['slug']}: 缺 hra.meshes"
        assert e.get("fma") or e.get("uberon"), f"{e['slug']}: 本体 id 不能全空"
        if "fit_to_fma" in spec:
            for asset in assets:
                anchors[asset] = anchors.get(asset, 0) + 1
    for asset in used:
        # 同一个 glb 的所有部件共用一个变换，锚点必须恰好一条
        assert anchors.get(asset) == 1, f"{asset}: 应恰好有一条声明 fit_to_fma"
