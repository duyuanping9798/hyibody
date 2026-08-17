"""表解析单元测试（M1 验收：单元测试覆盖表解析）。"""

import pytest

import bp3d


@pytest.fixture
def parts_list(tmp_path):
    p = tmp_path / "isa_parts_list_e.txt"
    p.write_text(
        "concept id\trepresentation id\ten\n"
        "FMA9611\tBP8921\tfemur\n"
        "FMA24474\tBP8920\tright femur\n"
        "FMA24475\tBP9042\tleft femur\n",
        encoding="utf-8",
    )
    return p


def test_parse_parts_list(parts_list):
    concepts = bp3d.parse_parts_list(parts_list)
    assert len(concepts) == 3
    assert concepts["FMA9611"].en == "femur"
    assert concepts["FMA9611"].bp == "BP8921"


def test_parse_parts_list_rejects_bad_header(tmp_path):
    p = tmp_path / "bad.txt"
    p.write_text("wrong\theader\there\nFMA1\tBP1\tx\n", encoding="utf-8")
    with pytest.raises(ValueError, match="表头"):
        bp3d.parse_parts_list(p)


def test_parse_parts_list_rejects_duplicate_id(tmp_path):
    p = tmp_path / "dup.txt"
    p.write_text(
        "concept id\trepresentation id\ten\nFMA1\tBP1\ta\nFMA1\tBP2\tb\n", encoding="utf-8"
    )
    with pytest.raises(ValueError, match="重复"):
        bp3d.parse_parts_list(p)


def test_parse_parts_list_rejects_bad_columns(tmp_path):
    p = tmp_path / "cols.txt"
    p.write_text("concept id\trepresentation id\ten\nFMA1\tBP1\n", encoding="utf-8")
    with pytest.raises(ValueError, match="列"):
        bp3d.parse_parts_list(p)


def test_parse_element_parts(tmp_path):
    p = tmp_path / "isa_element_parts.txt"
    p.write_text(
        "concept id\tname\telement file id\n"
        "FMA9611\tfemur\tFJ1000\n"
        "FMA9611\tfemur\tFJ1001\n"
        "FMA24474\tright femur\tFJ1000\n",
        encoding="utf-8",
    )
    elements = bp3d.parse_element_parts(p)
    assert elements["FMA9611"] == ["FJ1000", "FJ1001"]
    assert elements["FMA24474"] == ["FJ1000"]


def test_parse_inclusion_relations(tmp_path):
    p = tmp_path / "isa_inclusion_relation_list.txt"
    p.write_text(
        "parent id\tparent name\tchild id\tchild name\n"
        "FMA5018\tbone\tFMA9611\tfemur\n",
        encoding="utf-8",
    )
    rels = bp3d.parse_inclusion_relations(p)
    assert rels == [("FMA5018", "FMA9611")]


def test_concepts_by_name_case_insensitive(parts_list):
    dataset = bp3d.Bp3dSet(name="isa", concepts=bp3d.parse_parts_list(parts_list))
    assert dataset.concepts_by_name()["right femur"].fma == "FMA24474"


def test_parse_obj(tmp_path):
    p = tmp_path / "FJ1.obj"
    p.write_text(
        "# comment\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n", encoding="utf-8"
    )
    v, f = bp3d.parse_obj(p)
    assert v.shape == (3, 3)
    assert f.shape == (1, 3)
    assert f.tolist() == [[0, 1, 2]]


def test_parse_obj_with_slash_indices(tmp_path):
    p = tmp_path / "FJ2.obj"
    p.write_text("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1/1 2/2 3/3\n", encoding="utf-8")
    _, f = bp3d.parse_obj(p)
    assert f.tolist() == [[0, 1, 2]]


def test_parse_obj_rejects_out_of_range(tmp_path):
    p = tmp_path / "FJ3.obj"
    p.write_text("v 0 0 0\nf 1 2 3\n", encoding="utf-8")
    with pytest.raises(ValueError, match="越界"):
        bp3d.parse_obj(p)


def test_slugify():
    assert bp3d.slugify("Right hip bone") == "right_hip_bone"
    assert bp3d.slugify("T1 vertebra") == "t1_vertebra"


def test_global_center():
    stats = {
        "a": {"bbox": [0, 0, 0, 10, 10, 10]},
        "b": {"bbox": [-10, 0, 0, 0, 20, 10]},
    }
    assert bp3d.global_center(stats) == [0.0, 10.0, 5.0]
