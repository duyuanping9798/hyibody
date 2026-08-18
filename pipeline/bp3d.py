"""BodyParts3D 表解析与流水线公共工具。

表格式（tab 分隔、首行表头，NBDC 存档站 4.0 版实测）：

- ``*_parts_list_e.txt``:      concept id / representation id / en
- ``*_element_parts.txt``:     concept id / name / element file id（FJ*.obj）
- ``*_inclusion_relation_list.txt``: parent id / parent name / child id / child name
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

import yaml

ROOT = Path(__file__).resolve().parent.parent
PIPELINE_DIR = ROOT / "pipeline"
CONFIG_DIR = PIPELINE_DIR / "config"
RAW_DIR = PIPELINE_DIR / "raw"
WORK_DIR = PIPELINE_DIR / "work"
CONTENT_DIR = ROOT / "content"
ASSETS_DIR = ROOT / "public" / "assets"

SOURCES_YAML = CONFIG_DIR / "sources.yaml"
# HRA（HuBMAP 3D 参考器官）另起一个源文件：许可证与署名按数据源各记一份
SOURCES_HRA_YAML = CONFIG_DIR / "sources_hra.yaml"
HRA_RAW_DIR = RAW_DIR / "hra"
GROUPS_YAML = CONFIG_DIR / "groups.yaml"
CANDIDATES_YAML = CONTENT_DIR / "structures.candidates.yaml"
STRUCTURES_YAML = CONTENT_DIR / "structures.yaml"

SYSTEMS = ("skin", "muscles", "skeleton", "organs", "vessels", "nerves")
REGIONS = ("head", "neck", "thorax", "abdomen", "pelvis", "upper_limb", "lower_limb", "whole")
SIDES = ("left", "right", "none", "both")
SOURCE_SETS = {"bp3d": "isa", "bp3d_partof": "partof"}
# 非 BP3D 的来源标记（结构清单的 source 字段），process.py 按此分流
HRA_SOURCE = "hra"

# 面数预算（CLAUDE.md，2026-08-18 数据质量升级修订——见 docs/DECISIONS.md）：
# 单结构下限 500、常规上限 30,000（groups.yaml 的 max_target_faces），
# 皮肤这类整张外壳上限 60,000；总量目标 100–130 万，硬上限仍 150 万。
FACES_MIN = 500
FACES_MAX = 6000
FACES_MAX_LARGE = 30000
# 皮肤是唯一一张覆盖全身的壳，轮廓直接决定第一眼观感，单独给更高上限
FACES_MAX_SKIN = 60000


def max_faces_for(slug: str) -> int:
    """单结构面数上限：皮肤特殊，其余走大结构上限。"""
    return FACES_MAX_SKIN if slug == "skin" else FACES_MAX_LARGE


@dataclass(frozen=True)
class Concept:
    """parts_list 中的一个概念（FMA id + BP 表示 id + 英文名）。"""

    fma: str
    bp: str
    en: str


@dataclass
class Bp3dSet:
    """一个 BP3D 数据集（isa 或 partof）的三张表。"""

    name: str
    concepts: dict[str, Concept] = field(default_factory=dict)
    elements: dict[str, list[str]] = field(default_factory=dict)
    relations: list[tuple[str, str]] = field(default_factory=list)

    def concepts_by_name(self) -> dict[str, Concept]:
        """英文名（小写）→ 概念。BP3D 表内英文名唯一，重名时保留首个并由调用方告警。"""
        out: dict[str, Concept] = {}
        for c in self.concepts.values():
            out.setdefault(c.en.lower(), c)
        return out

    def parents_of(self, fma: str) -> list[str]:
        return [p for p, c in self.relations if c == fma]


def _read_table(path: Path, expected_header: Iterable[str]) -> list[list[str]]:
    """读 tab 分隔表，校验表头，返回数据行。空行跳过，列数不符报错。"""
    expected = list(expected_header)
    rows: list[list[str]] = []
    with path.open(encoding="utf-8") as f:
        header = f.readline().rstrip("\n").split("\t")
        if [h.strip().lower() for h in header] != expected:
            raise ValueError(f"{path.name}: 表头不符，得到 {header!r}，期望 {expected!r}")
        for i, line in enumerate(f, start=2):
            line = line.rstrip("\n")
            if not line.strip():
                continue
            cols = line.split("\t")
            if len(cols) != len(expected):
                raise ValueError(f"{path.name}:{i}: 期望 {len(expected)} 列，得到 {len(cols)}")
            rows.append([c.strip() for c in cols])
    return rows


def parse_parts_list(path: Path) -> dict[str, Concept]:
    rows = _read_table(path, ["concept id", "representation id", "en"])
    out: dict[str, Concept] = {}
    for fma, bp, en in rows:
        if fma in out:
            raise ValueError(f"{path.name}: 概念 id 重复 {fma}")
        out[fma] = Concept(fma=fma, bp=bp, en=en)
    return out


def parse_element_parts(path: Path) -> dict[str, list[str]]:
    rows = _read_table(path, ["concept id", "name", "element file id"])
    out: dict[str, list[str]] = {}
    for fma, _name, fj in rows:
        out.setdefault(fma, []).append(fj)
    return out


def parse_inclusion_relations(path: Path) -> list[tuple[str, str]]:
    rows = _read_table(path, ["parent id", "parent name", "child id", "child name"])
    return [(parent, child) for parent, _pn, child, _cn in rows]


def load_set(name: str, raw_dir: Path = RAW_DIR) -> Bp3dSet:
    """加载 isa 或 partof 集的三张表（需先 download.py）。"""
    if name not in ("isa", "partof"):
        raise ValueError(f"未知数据集 {name!r}（应为 isa / partof）")
    return Bp3dSet(
        name=name,
        concepts=parse_parts_list(raw_dir / f"{name}_parts_list_e.txt"),
        elements=parse_element_parts(raw_dir / f"{name}_element_parts.txt"),
        relations=parse_inclusion_relations(raw_dir / f"{name}_inclusion_relation_list.txt"),
    )


def load_sources(path: Path = SOURCES_YAML) -> dict:
    """加载并校验 sources.yaml。"""
    with path.open(encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    for key in ("dataset", "license", "base_url", "files"):
        if key not in cfg:
            raise ValueError(f"{path.name} 缺少 {key}")
    lic = cfg["license"]
    for key in ("name", "url", "attribution"):
        if not lic.get(key):
            raise ValueError(f"{path.name} license 缺少 {key}")
    if not str(cfg["base_url"]).startswith("https://"):
        raise ValueError(f"{path.name} base_url 必须是 https")
    names: set[str] = set()
    for entry in cfg["files"]:
        for key in ("name", "kind", "bytes", "sha256"):
            if key not in entry:
                raise ValueError(f"{path.name} 文件项缺少 {key}: {entry}")
        if entry["kind"] not in ("table", "obj_zip", "glb"):
            raise ValueError(f"未知 kind {entry['kind']!r}")
        # BP3D 的表与 obj 包分属 isa / partof 两集；HRA 的 glb 没有集的概念
        if entry["kind"] == "glb":
            if "url_path" not in entry:
                raise ValueError(f"{entry['name']}: glb 需要 url_path")
        else:
            if "set" not in entry:
                raise ValueError(f"{path.name} 文件项缺少 set: {entry}")
            if entry["set"] not in ("isa", "partof"):
                raise ValueError(f"未知 set {entry['set']!r}")
        if not re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]):
            raise ValueError(f"{entry['name']}: sha256 非法")
        if entry["kind"] == "obj_zip" and "extract_dir" not in entry:
            raise ValueError(f"{entry['name']}: obj_zip 需要 extract_dir")
        if entry["name"] in names:
            raise ValueError(f"文件名重复 {entry['name']}")
        names.add(entry["name"])
    return cfg


def obj_dir(set_name: str, sources: dict | None = None, raw_dir: Path = RAW_DIR) -> Path:
    """某数据集解压后的 OBJ 目录。"""
    cfg = sources or load_sources()
    for entry in cfg["files"]:
        if entry["kind"] == "obj_zip" and entry["set"] == set_name:
            return raw_dir / entry["extract_dir"]
    raise ValueError(f"sources.yaml 中没有 {set_name} 集的 obj_zip")


def slugify(name: str) -> str:
    """英文名 → slug（小写下划线，仅 [a-z0-9_]）。"""
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")
    if not s:
        raise ValueError(f"无法从 {name!r} 生成 slug")
    return s


# ---------------------------------------------------------------------------
# OBJ 快速解析（BP3D 的 obj 只有 v/f 行，三角面；自写解析比 trimesh 快一个量级）


def parse_obj(path: Path) -> tuple["np.ndarray", "np.ndarray"]:
    """读 BP3D OBJ → (float32 顶点 Nx3, uint32 三角面 Mx3)。"""
    import numpy as np

    verts: list[str] = []
    faces: list[str] = []
    with path.open(encoding="utf-8", errors="replace") as f:
        for line in f:
            if line.startswith("v "):
                verts.append(line[2:])
            elif line.startswith("f "):
                faces.append(line[2:])
    v = np.array(" ".join(verts).split(), dtype=np.float32).reshape(-1, 3)
    # 面索引可能带 1/2/3 的 v/vt/vn 形式，取第一段；OBJ 索引从 1 起
    idx = [tok.split("/")[0] for row in faces for tok in row.split()]
    fcs = np.array(idx, dtype=np.int64).reshape(-1, 3)
    if fcs.size and (fcs.min() < 1 or fcs.max() > len(v)):
        raise ValueError(f"{path.name}: 面索引越界")
    return v, (fcs - 1).astype(np.uint32)


def obj_stats(set_name: str, refresh: bool = False) -> dict[str, dict]:
    """扫描某集全部 OBJ 的面数/顶点数/包围盒，缓存到 work/obj_stats_<set>.json。"""
    cache = WORK_DIR / f"obj_stats_{set_name}.json"
    if cache.exists() and not refresh:
        with cache.open(encoding="utf-8") as f:
            return json.load(f)
    directory = obj_dir(set_name)
    if not directory.is_dir():
        raise FileNotFoundError(f"{directory} 不存在，先跑 pipeline/download.py")
    stats: dict[str, dict] = {}
    for p in sorted(directory.glob("*.obj")):
        v, f_ = parse_obj(p)
        stats[p.stem] = {
            "vertices": int(len(v)),
            "faces": int(len(f_)),
            "bbox": [float(x) for x in v.min(axis=0)] + [float(x) for x in v.max(axis=0)],
        }
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    with cache.open("w", encoding="utf-8") as f:
        json.dump(stats, f)
    return stats


def load_structure_list() -> tuple[Path, list[dict]]:
    """结构清单：human 定稿的 structures.yaml 优先，否则用候选清单。"""
    path = STRUCTURES_YAML if STRUCTURES_YAML.exists() else CANDIDATES_YAML
    if not path.exists():
        raise FileNotFoundError("没有 content/structures(.candidates).yaml，先跑 pipeline/select.py")
    with path.open(encoding="utf-8") as f:
        entries = yaml.safe_load(f)
    if not isinstance(entries, list) or not entries:
        raise ValueError(f"{path.name}: 清单为空或不是列表")
    return path, entries


def global_center(stats: dict[str, dict]) -> list[float]:
    """全集包围盒中心（毫米）。所有系统共用同一居中偏移，保证跨系统对齐。"""
    lo = [min(s["bbox"][i] for s in stats.values()) for i in range(3)]
    hi = [max(s["bbox"][i + 3] for s in stats.values()) for i in range(3)]
    return [(lo[i] + hi[i]) / 2 for i in range(3)]
