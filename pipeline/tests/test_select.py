"""select 匹配引擎与配置文件校验测试。"""

import importlib.util
import sys
from pathlib import Path

import pytest

import bp3d

_DIR = Path(__file__).resolve().parent.parent


def _load(name: str):
    alias = f"hyibody_{name}"
    if alias in sys.modules:
        return sys.modules[alias]
    spec = importlib.util.spec_from_file_location(alias, _DIR / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[alias] = mod
    spec.loader.exec_module(mod)
    return mod


select = _load("select")


@pytest.fixture
def dataset():
    concepts = {
        "FMA1": bp3d.Concept("FMA1", "BP1", "femur"),
        "FMA2": bp3d.Concept("FMA2", "BP2", "right femur"),
        "FMA3": bp3d.Concept("FMA3", "BP3", "short head of biceps brachii"),
        "FMA4": bp3d.Concept("FMA4", "BP4", "long head of biceps brachii"),
    }
    elements = {
        "FMA1": ["FJ10", "FJ11"],
        "FMA2": ["FJ10"],
        "FMA3": ["FJ20"],
        "FMA4": ["FJ21", "FJ20"],
    }
    return bp3d.Bp3dSet(name="isa", concepts=concepts, elements=elements)


def test_resolve_exact_names(dataset):
    res = select.resolve_group({"concepts": ["Femur"]}, dataset)
    assert [c.fma for c in res["concepts"]] == ["FMA1"]
    assert res["elements"] == ["FJ10", "FJ11"]
    assert not res["missing_names"]


def test_resolve_dedups_elements_across_concepts(dataset):
    # femur 聚合概念与 right femur 共享 FJ10，元素必须去重
    res = select.resolve_group({"concepts": ["femur", "right femur"]}, dataset)
    assert res["elements"] == ["FJ10", "FJ11"]


def test_resolve_patterns(dataset):
    res = select.resolve_group(
        {"patterns": [r"^(short|long) head of biceps brachii$"]}, dataset
    )
    assert {c.fma for c in res["concepts"]} == {"FMA3", "FMA4"}
    assert res["elements"] == ["FJ20", "FJ21"]


def test_resolve_reports_missing(dataset):
    res = select.resolve_group(
        {"concepts": ["no such thing"], "patterns": ["^nothing here$"]}, dataset
    )
    assert res["missing_names"] == ["no such thing"]
    assert res["unmatched_patterns"] == ["^nothing here$"]
    assert res["elements"] == []


def test_build_candidates_drops_empty_group(dataset):
    groups_cfg = {
        "defaults": {"target_faces": {"skeleton": 1200}},
        "groups": [
            {
                "slug": "femur_right",
                "zh": "右股骨",
                "en": "Right femur",
                "system": "skeleton",
                "region": "lower_limb",
                "side": "right",
                "priority": 1,
                "concepts": ["right femur"],
            },
            {
                "slug": "missing",
                "zh": "无",
                "en": "Missing",
                "system": "skeleton",
                "region": "whole",
                "side": "none",
                "priority": 3,
                "concepts": ["no such thing"],
            },
        ],
    }
    stats = {"isa/FJ10": {"faces": 100, "vertices": 52, "bbox": [0, 0, 0, 10, 20, 30]}}
    entries, report = select.build_candidates(groups_cfg, {"isa": dataset}, stats)
    assert [e["slug"] for e in entries] == ["femur_right"]
    assert entries[0]["fma"] == ["FMA2"]
    assert entries[0]["source"] == "bp3d"
    assert entries[0]["target_faces"] == 1200
    assert entries[0]["meta"]["faces_raw"] == 100
    assert entries[0]["meta"]["volume_cm3"] == 6.0
    assert report["dropped"][0]["slug"] == "missing"


def test_load_groups_real_config():
    cfg = select.load_groups()
    slugs = [g["slug"] for g in cfg["groups"]]
    assert len(slugs) == len(set(slugs))
    assert "skull" in slugs and "femur_left" in slugs


def test_load_sources_real_config():
    cfg = bp3d.load_sources()
    assert len(cfg["files"]) == 8
    assert {e["set"] for e in cfg["files"]} == {"isa", "partof"}
    assert any(e["kind"] == "obj_zip" for e in cfg["files"])
    assert "BodyParts3D" in cfg["license"]["attribution"]


class TestGroupTargetFaces:
    """目标面数规则（2026-08-18）：基准 → 按最大压缩比放宽 → 统一封顶。"""

    defaults = {
        "target_faces": {"skin": 60000, "muscles": 4000, "skeleton": 5000,
                         "organs": 10000, "vessels": 6000, "nerves": 6000},
        "max_compression": 2,
        "max_target_faces": 30000,
    }

    def test_small_source_keeps_base(self):
        group = {"system": "skeleton"}
        assert select.group_target_faces(group, self.defaults, faces_raw=3000) == 5000

    def test_dense_source_relaxes_to_half(self):
        group = {"system": "muscles"}
        # 源 40,000 面：按 2× 最大压缩比放宽到 20,000，而不是压到基准 4,000
        assert select.group_target_faces(group, self.defaults, faces_raw=40000) == 20000

    def test_ceiling_caps_very_dense_source(self):
        group = {"system": "muscles"}
        assert select.group_target_faces(group, self.defaults, faces_raw=377532) == 30000

    def test_explicit_target_is_a_floor_above_the_ceiling(self):
        # 皮肤显式写 60000，高于 max_target_faces，显式配置说了算
        group = {"system": "skin", "target_faces": 60000}
        assert select.group_target_faces(group, self.defaults, faces_raw=203382) == 60000

    def test_explicit_target_still_relaxed_by_compression(self):
        group = {"system": "organs", "target_faces": 15000}
        assert select.group_target_faces(group, self.defaults, faces_raw=102802) == 30000


class TestParentValidation:
    """内部件（parent）校验：只支持一层、必须同系统、父结构必须存在。"""

    @staticmethod
    def _entries(**overrides):
        base = {
            "slug": "heart",
            "zh": "心脏",
            "en": "Heart",
            "system": "organs",
            "region": "thorax",
            "side": "none",
            "fma": ["FMA7088"],
            "source": "bp3d_partof",
            "target_faces": 15000,
            "priority": 1,
        }
        child = {**base, "slug": "heart_valve", "zh": "瓣膜", "en": "Valve", "parent": "heart"}
        child.update(overrides)
        return [base, child]

    def _check(self, entries):
        validate = _load("validate")
        chk = validate.Checker()
        validate.validate_structures(entries, chk)
        return chk.errors

    def test_valid_parent_passes(self):
        assert self._check(self._entries()) == []

    def test_unknown_parent_errors(self):
        errors = self._check(self._entries(parent="nope"))
        assert any("parent" in e for e in errors)

    def test_cross_system_parent_errors(self):
        errors = self._check(self._entries(system="vessels"))
        assert any("同一系统" in e for e in errors)

    def test_two_levels_error(self):
        entries = self._entries()
        entries[0]["parent"] = "something"  # 让父结构自己也成为内部件
        errors = self._check(entries)
        assert any("只支持一层" in e for e in errors)
