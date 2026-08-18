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


# 全身对齐用的皮肤资产：只参与算变换，不出现在结构清单里（见 process.hra_body_fit）
BODY_ANCHOR_ASSET = "3d-vh-m-skin.glb"


def test_body_anchor_asset_is_declared_in_sources():
    cfg = bp3d.load_sources(bp3d.SOURCES_HRA_YAML)
    assert any(e["name"] == BODY_ANCHOR_ASSET for e in cfg["files"]), (
        "全身对齐要用到皮肤资产，sources_hra.yaml 里必须有它"
    )


def test_structure_list_hra_entries_declare_meshes_and_one_anchor():
    entries = yaml.safe_load(bp3d.STRUCTURES_YAML.read_text(encoding="utf-8"))
    hra_entries = [e for e in entries if e.get("source") == bp3d.HRA_SOURCE]
    assert hra_entries, "结构清单里应该有 HRA 结构"

    anchors: dict[str, int] = {}      # 资产 → 声明了 fit_to_fma 的条数
    borrowed_assets: set[str] = set()  # 靠 fit_from 借变换的资产
    borrowers: dict[str, str] = {}     # slug → 借的对象
    used: set[str] = set()

    for e in hra_entries:
        spec = e.get("hra")
        assert spec, f"{e['slug']}: 缺 hra 配置"
        assets = list(spec.get("assets") or ([spec["asset"]] if spec.get("asset") else []))
        assert assets, f"{e['slug']}: 缺 hra.asset/assets"
        used.update(assets)
        assert "meshes" in spec, f"{e['slug']}: 缺 hra.meshes"
        assert e.get("fma") or e.get("uberon"), f"{e['slug']}: 本体 id 不能全空"
        assert not ("fit_to_fma" in spec and "fit_from" in spec), (
            f"{e['slug']}: fit_to_fma 与 fit_from 只能有一个"
        )
        if "fit_to_fma" in spec:
            for asset in assets:
                anchors[asset] = anchors.get(asset, 0) + 1
        if "fit_from" in spec:
            borrowers[e["slug"]] = spec["fit_from"]
            borrowed_assets.update(assets)

    # 每个资产要么自己有恰好一条锚点，要么借别人的（同一个 glb 的部件共用一个变换）
    for asset in used - borrowed_assets:
        assert anchors.get(asset) == 1, f"{asset}: 应恰好有一条声明 fit_to_fma"
    for asset in borrowed_assets:
        assert asset not in anchors, f"{asset}: 借了变换就不该再自己当锚点"
    assert BODY_ANCHOR_ASSET not in used, "皮肤只用来算全身对齐，不该被任何结构当网格来源"
    for slug, donor in borrowers.items():
        # 皮肤资产是流水线内建的"全身对齐"锚点（process.hra_body_fit），
        # 不出现在结构清单里，所以单独放行
        if donor == BODY_ANCHOR_ASSET:
            continue
        assert anchors.get(donor) == 1, f"{slug}: fit_from 指向的 {donor} 不是锚点"
