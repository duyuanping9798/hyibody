"""M1-2：解析 BP3D 表 + config/groups.yaml → 生成 content/structures.candidates.yaml。

候选清单含 KICKOFF 第 7 节全部字段，外加 meta（原始面数 / 包围盒体积 / 元素数 /
父概念），供人类挑选定稿为 content/structures.yaml。匹配不到数据的组会被剔除并写入
work/select_report.json。

用法：
    python3 pipeline/select.py [--refresh-stats]
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

import argparse
import json
import math
import re
import sys
from typing import Any

import yaml

import bp3d
from bp3d import GROUPS_YAML, REGIONS, SIDES, SOURCE_SETS, SYSTEMS, WORK_DIR


def load_groups(path=GROUPS_YAML) -> dict:
    """加载并校验 groups.yaml。"""
    with path.open(encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    if not isinstance(cfg.get("groups"), list) or not cfg["groups"]:
        raise ValueError("groups.yaml: groups 为空")
    slugs: set[str] = set()
    for g in cfg["groups"]:
        for key in ("slug", "zh", "en", "system", "region", "side", "priority"):
            if key not in g:
                raise ValueError(f"groups.yaml: {g.get('slug', g)} 缺少 {key}")
        if not re.fullmatch(r"[a-z0-9_]+", g["slug"]):
            raise ValueError(f"groups.yaml: slug 非法 {g['slug']!r}")
        if g["slug"] in slugs:
            raise ValueError(f"groups.yaml: slug 重复 {g['slug']}")
        slugs.add(g["slug"])
        if g["system"] not in SYSTEMS:
            raise ValueError(f"{g['slug']}: 未知 system {g['system']!r}")
        if g["region"] not in REGIONS:
            raise ValueError(f"{g['slug']}: 未知 region {g['region']!r}")
        if g["side"] not in SIDES:
            raise ValueError(f"{g['slug']}: 未知 side {g['side']!r}")
        if g.get("set", "isa") not in ("isa", "partof"):
            raise ValueError(f"{g['slug']}: 未知 set {g['set']!r}")
        if not g.get("concepts") and not g.get("patterns"):
            raise ValueError(f"{g['slug']}: concepts 与 patterns 至少一项")
        if int(g["priority"]) not in (1, 2, 3):
            raise ValueError(f"{g['slug']}: priority 应为 1/2/3")
    return cfg


def resolve_group(group: dict, dataset: bp3d.Bp3dSet) -> dict[str, Any]:
    """把一个组解析为概念列表 + 去重后的元素文件列表。"""
    by_name = dataset.concepts_by_name()
    matched: list[bp3d.Concept] = []
    missing_names: list[str] = []
    for name in group.get("concepts", []):
        c = by_name.get(name.lower())
        if c:
            matched.append(c)
        else:
            missing_names.append(name)
    unmatched_patterns: list[str] = []
    for pattern in group.get("patterns", []):
        rx = re.compile(pattern, re.IGNORECASE)
        hits = [c for c in dataset.concepts.values() if rx.fullmatch(c.en)]
        if hits:
            matched.extend(hits)
        else:
            unmatched_patterns.append(pattern)
    # 概念可能被 concepts 与 patterns 同时命中，先按 FMA id 去重
    seen: set[str] = set()
    concepts = [c for c in matched if not (c.fma in seen or seen.add(c.fma))]
    elements: list[str] = []
    eseen: set[str] = set()
    no_elements: list[str] = []
    for c in concepts:
        els = dataset.elements.get(c.fma, [])
        if not els:
            no_elements.append(c.en)
        for e in els:
            if e not in eseen:
                eseen.add(e)
                elements.append(e)
    return {
        "concepts": concepts,
        "elements": elements,
        "missing_names": missing_names,
        "unmatched_patterns": unmatched_patterns,
        "concepts_without_elements": no_elements,
    }


def group_target_faces(group: dict, defaults: dict, faces_raw: int = 0) -> int:
    """目标面数 = 配置基准；源网格远比基准细时按最大压缩比放宽，再统一封顶。

    只有基准会把小结构抬上去；`max_compression` 保证密集源网格不被压成低模；
    `max_target_faces` 防止个别超密结构吃掉整个预算（显式写的基准永远是下限）。
    """
    base = int(group.get("target_faces") or defaults["target_faces"][group["system"]])
    target = base
    limit = int(defaults.get("max_compression") or 0)
    if limit > 1 and faces_raw > 0:
        target = max(target, math.ceil(faces_raw / limit / 500) * 500)
    ceiling = int(defaults.get("max_target_faces") or 0)
    if ceiling:
        target = min(target, max(ceiling, base))
    return target


def build_candidates(groups_cfg: dict, sets: dict[str, bp3d.Bp3dSet], stats: dict[str, dict]) -> tuple[list[dict], dict]:
    """生成候选条目与报告。stats 键为 "<set>/<FJ id>"。"""
    entries: list[dict] = []
    report: dict[str, Any] = {"dropped": [], "warnings": [], "totals": {}}
    for group in groups_cfg["groups"]:
        set_name = group.get("set", "isa")
        res = resolve_group(group, sets[set_name])
        for name in res["missing_names"]:
            report["warnings"].append(f"{group['slug']}: 概念名未匹配 {name!r}（{set_name} 集）")
        for pattern in res["unmatched_patterns"]:
            report["warnings"].append(f"{group['slug']}: 正则无命中 {pattern!r}（{set_name} 集）")
        for name in res["concepts_without_elements"]:
            report["warnings"].append(f"{group['slug']}: 概念 {name!r} 无元素网格")
        if not res["elements"]:
            report["dropped"].append({"slug": group["slug"], "reason": "无任何元素网格，剔除"})
            continue
        faces = 0
        bbox: list[float] | None = None
        stats_missing = 0
        for fj in res["elements"]:
            s = stats.get(f"{set_name}/{fj}")
            if s is None:
                stats_missing += 1
                continue
            faces += s["faces"]
            b = s["bbox"]
            if bbox is None:
                bbox = list(b)
            else:
                bbox = [min(bbox[i], b[i]) for i in range(3)] + [max(bbox[i + 3], b[i + 3]) for i in range(3)]
        if stats_missing:
            report["warnings"].append(f"{group['slug']}: {stats_missing} 个元素缺 OBJ 文件")
        if bbox is None:
            report["dropped"].append({"slug": group["slug"], "reason": "全部元素缺 OBJ 文件，剔除"})
            continue
        size = [bbox[i + 3] - bbox[i] for i in range(3)]
        entry = {
            "slug": group["slug"],
            "zh": group["zh"],
            "en": group["en"],
            "system": group["system"],
            "region": group["region"],
            "side": group["side"],
            "fma": [c.fma for c in res["concepts"]],
            "source": {"isa": "bp3d", "partof": "bp3d_partof"}[set_name],
            "target_faces": group_target_faces(group, groups_cfg["defaults"], faces),
            "priority": int(group["priority"]),
            # 内部件：默认不显示，界面上"展开内部"才出现
            **({"parent": group["parent"]} if group.get("parent") else {}),
        }
        meta: dict[str, Any] = {
            "elements": len(res["elements"]),
            "faces_raw": faces,
            "bbox_size_mm": [round(x, 1) for x in size],
            "volume_cm3": round(size[0] * size[1] * size[2] / 1000.0, 1),
            "parents": sorted(
                {
                    sets[set_name].concepts[p].en
                    for c in res["concepts"]
                    for p in sets[set_name].parents_of(c.fma)
                    if p in sets[set_name].concepts
                }
            ),
        }
        if group.get("note"):
            meta["note"] = group["note"]
        entry["meta"] = meta
        entries.append(entry)
    counts: dict[str, int] = {}
    for e in entries:
        counts[e["system"]] = counts.get(e["system"], 0) + 1
    report["totals"] = {"structures": len(entries), "by_system": counts}
    return entries, report


HEADER = """\
# 候选结构清单（select.py 生成，勿手改——改 pipeline/config/groups.yaml 后重跑）。
# 人类审阅后定稿为 content/structures.yaml：删除不要的条目、按需调整 zh/priority/
# target_faces；meta 为参考信息（原始面数、包围盒、父概念），定稿时可整块删除。
# 挑选方法与已知数据缺口见 docs/STATUS.md。
"""


def sync_targets(entries: list[dict]) -> int:
    """把候选清单里的 target_faces 同步进已定稿的 content/structures.yaml。

    定稿清单是人类审阅过的（删过条目、改过命名），不能整份覆盖；这里只按 slug
    逐行改 target_faces 的数值，其余一字不动。返回改动条数。
    """
    path = bp3d.STRUCTURES_YAML
    if not path.exists():
        return 0
    want = {e["slug"]: int(e["target_faces"]) for e in entries}
    # 非 BP3D 来源（HRA 等）的 target_faces 由人在 structures.yaml 里定：
    # groups.yaml 的基准是按 BP3D 源网格面数算的，套到别的数据源上没有意义。
    for entry in bp3d.load_structure_list()[1]:
        if entry.get("source") not in bp3d.SOURCE_SETS:
            want.pop(entry["slug"], None)
    existing = {
        line.strip().split(":", 1)[1].strip()
        for line in path.read_text(encoding="utf-8").split("\n")
        if line.strip().startswith("- slug:")
    }
    out: list[str] = []
    slug: str | None = None
    changed = 0
    for line in path.read_text(encoding="utf-8").split("\n"):
        stripped = line.strip()
        if stripped.startswith("- slug:"):
            slug = stripped.split(":", 1)[1].strip()
        if slug in want and stripped.startswith("target_faces:"):
            indent = line[: len(line) - len(line.lstrip())]
            new_line = f"{indent}target_faces: {want[slug]}"
            if new_line != line:
                changed += 1
            out.append(new_line)
            continue
        out.append(line)
    # 内部件（声明了 parent 的组）跟着父结构走，不需要人类逐条挑选：缺了就补进去。
    # 顶层结构仍然只由人类增删——定稿清单是审阅结果，不该被 select 悄悄扩张。
    added = [e for e in entries if e.get("parent") and e["slug"] not in existing]
    if added:
        block = ["", f"# 以下 {len(added)} 条为内部件（parent 指向父结构），由 select.py 自动补入"]
        for entry in added:
            block.append(f"- slug: {entry['slug']}")
            for key in ("zh", "en", "system", "region", "side", "parent"):
                block.append(f"  {key}: {entry[key]}")
            block.append("  fma:")
            for fma in entry["fma"]:
                block.append(f"  - {fma}")
            block.append(f"  source: {entry['source']}")
            block.append(f"  target_faces: {entry['target_faces']}")
            block.append(f"  priority: {entry['priority']}")
        out.extend(block)
        changed += len(added)
        print(f"  新增 {len(added)} 条内部件：{', '.join(e['slug'] for e in added)}")
    if changed:
        path.write_text("\n".join(out), encoding="utf-8")
    return changed


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--refresh-stats", action="store_true", help="重扫 OBJ 面数缓存")
    ap.add_argument(
        "--no-sync-targets",
        action="store_true",
        help="不要把新的 target_faces 同步进 content/structures.yaml",
    )
    args = ap.parse_args(argv)

    groups_cfg = load_groups()
    sets = {name: bp3d.load_set(name) for name in ("isa", "partof")}
    stats: dict[str, dict] = {}
    for name in ("isa", "partof"):
        for fj, s in bp3d.obj_stats(name, refresh=args.refresh_stats).items():
            stats[f"{name}/{fj}"] = s

    entries, report = build_candidates(groups_cfg, sets, stats)

    bp3d.CONTENT_DIR.mkdir(parents=True, exist_ok=True)
    with bp3d.CANDIDATES_YAML.open("w", encoding="utf-8") as f:
        f.write(HEADER)
        yaml.safe_dump(entries, f, allow_unicode=True, sort_keys=False, width=100)
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    with (WORK_DIR / "select_report.json").open("w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(f"候选结构 {report['totals']['structures']} 个：{report['totals']['by_system']}")
    if report["dropped"]:
        print(f"剔除 {len(report['dropped'])} 组（无网格）：")
        for d in report["dropped"]:
            print(f"  - {d['slug']}: {d['reason']}")
    if report["warnings"]:
        print(f"警告 {len(report['warnings'])} 条（详见 work/select_report.json）")
        for w in report["warnings"][:15]:
            print(f"  - {w}")
    print(f"已写入 {bp3d.CANDIDATES_YAML.relative_to(bp3d.ROOT)}")
    if not args.no_sync_targets:
        changed = sync_targets(entries)
        if changed:
            print(f"已同步 {changed} 条 target_faces 到 {bp3d.STRUCTURES_YAML.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
