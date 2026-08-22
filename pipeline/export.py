"""M1-4：把 work/processed/<system>/ 的网格导出为 public/assets/<system>.glb，
经 gltf-transform（dedup → weld → quantize → meshopt）优化，并生成 manifest.json。

节点名 = slug，节点 extras = {slug, zh, en, system, region, side, fma, source}
（KICKOFF 第 7 节）。manifest 含各系统文件与全部结构元数据、BodyParts3D 署名。

用法：
    python3 pipeline/export.py --systems skeleton[,…|all]
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
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from shade import bake_vertex_shade, shade_to_color0

import bp3d
from bp3d import ASSETS_DIR, ROOT, SYSTEMS, WORK_DIR


def _pad4(data: bytes, fill: bytes = b"\x00") -> bytes:
    return data + fill * (-len(data) % 4)


def build_glb(metas: list[dict], npz_dir: Path, out_path: Path) -> None:
    """用 pygltflib 组装未压缩 glb：每结构一个 mesh + node（名 = slug，带 extras）。"""
    import trimesh
    from pygltflib import (
        ARRAY_BUFFER,
        ELEMENT_ARRAY_BUFFER,
        FLOAT,
        GLTF2,
        UNSIGNED_BYTE,
        UNSIGNED_INT,
        Accessor,
        Attributes,
        Buffer,
        BufferView,
        Material,
        Mesh,
        Node,
        PbrMetallicRoughness,
        Primitive,
        Scene,
    )

    gltf = GLTF2(scene=0, scenes=[Scene(nodes=[])])
    gltf.materials.append(
        Material(
            name="default",
            pbrMetallicRoughness=PbrMetallicRoughness(
                baseColorFactor=[0.87, 0.84, 0.78, 1.0], metallicFactor=0.0, roughnessFactor=0.85
            ),
        )
    )
    blob = bytearray()
    for meta in metas:
        data = np.load(npz_dir / f"{meta['slug']}.npz")
        # 导出前焊接同位顶点再算法线（2026-08-18 加）：减面会在部件接缝留下重复顶点，
        # 不焊接的话法线在接缝处断开，渲染出来是一条条硬棱。
        mesh = trimesh.Trimesh(
            vertices=np.asarray(data["vertices"], dtype=np.float64),
            faces=np.asarray(data["faces"], dtype=np.int64),
            process=True,
            validate=True,
        )
        mesh.merge_vertices()
        mesh.remove_unreferenced_vertices()
        v = np.ascontiguousarray(mesh.vertices, dtype=np.float32)
        f = np.ascontiguousarray(mesh.faces, dtype=np.uint32)
        # 面积加权的平滑法线
        normals = np.ascontiguousarray(mesh.vertex_normals, dtype=np.float32)
        meta["faces"] = int(len(f))
        meta["vertices"] = int(len(v))
        idx = f.reshape(-1)

        # 逐顶点腔隙烘焙（见 shade.py 模块注释）。皮肤跳过：它走 X-ray 加色壳，
        # 顶点色压暗会把整张壳弄脏，而那个设计本来就不打算写实。
        color0 = None if meta["system"] == "skin" else shade_to_color0(bake_vertex_shade(v, f))

        views = []
        arrays = [(v, ARRAY_BUFFER), (normals, ARRAY_BUFFER), (idx, ELEMENT_ARRAY_BUFFER)]
        if color0 is not None:
            arrays.append((color0, ARRAY_BUFFER))
        for arr, target in arrays:
            raw = _pad4(arr.tobytes())
            views.append(len(gltf.bufferViews))
            gltf.bufferViews.append(
                BufferView(buffer=0, byteOffset=len(blob), byteLength=len(raw), target=target)
            )
            blob.extend(raw)
        base = len(gltf.accessors)
        gltf.accessors.extend(
            [
                Accessor(
                    bufferView=views[0],
                    componentType=FLOAT,
                    count=len(v),
                    type="VEC3",
                    min=[float(x) for x in v.min(axis=0)],
                    max=[float(x) for x in v.max(axis=0)],
                ),
                Accessor(bufferView=views[1], componentType=FLOAT, count=len(normals), type="VEC3"),
                Accessor(bufferView=views[2], componentType=UNSIGNED_INT, count=len(idx), type="SCALAR"),
            ]
        )
        if color0 is not None:
            gltf.accessors.append(
                Accessor(
                    bufferView=views[3],
                    componentType=UNSIGNED_BYTE,
                    count=len(color0),
                    type="VEC4",
                    normalized=True,
                )
            )
        attributes = Attributes(POSITION=base, NORMAL=base + 1)
        if color0 is not None:
            attributes.COLOR_0 = base + 3
        gltf.meshes.append(
            Mesh(
                name=meta["slug"],
                primitives=[
                    Primitive(
                        attributes=attributes,
                        indices=base + 2,
                        material=0,
                    )
                ],
            )
        )
        node = Node(name=meta["slug"], mesh=len(gltf.meshes) - 1)
        node.extras = {
            "slug": meta["slug"],
            "zh": meta["zh"],
            "en": meta["en"],
            "system": meta["system"],
            "region": meta["region"],
            "side": meta["side"],
            "fma": meta["fma"],
            **({"uberon": meta["uberon"]} if meta.get("uberon") else {}),
            "source": meta["source"],
            **({"parent": meta["parent"]} if meta.get("parent") else {}),
        }
        gltf.scenes[0].nodes.append(len(gltf.nodes))
        gltf.nodes.append(node)

    gltf.buffers.append(Buffer(byteLength=len(blob)))
    gltf.set_binary_blob(bytes(blob))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    gltf.save_binary(str(out_path))


def gltf_transform_bin() -> list[str]:
    exe = shutil.which("gltf-transform")
    if exe:
        return [exe]
    return ["npx", "--yes", "@gltf-transform/cli"]

def optimize_glb(raw: Path, out: Path) -> None:
    """gltf-transform 链：dedup → weld → quantize（KHR_mesh_quantization）→ meshopt。"""
    bin_ = gltf_transform_bin()
    steps = [
        ["dedup"],
        ["weld"],
        ["quantize"],
        ["meshopt", "--level", "medium"],
    ]
    cur = raw
    for i, step in enumerate(steps):
        nxt = out if i == len(steps) - 1 else raw.with_suffix(f".s{i}.glb")
        # gltf-transform <cmd> <in> <out> [flags]
        cmd = bin_ + [step[0], str(cur), str(nxt)] + step[1:]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            raise SystemExit(f"错误：{' '.join(cmd)}\n{proc.stdout}\n{proc.stderr}")
        if cur != raw:
            cur.unlink(missing_ok=True)
        cur = nxt


def load_metas(system: str) -> list[dict]:
    meta_path = WORK_DIR / "processed" / system / "meta.json"
    if not meta_path.exists():
        raise SystemExit(f"错误：{meta_path} 不存在，先跑 pipeline/process.py --systems {system}")
    with meta_path.open(encoding="utf-8") as f:
        return json.load(f)


def write_manifest() -> None:
    """按 public/assets/ 现有系统 glb + work 元数据生成 manifest.json。"""
    sources = bp3d.load_sources()
    hra_sources = (
        bp3d.load_sources(bp3d.SOURCES_HRA_YAML) if bp3d.SOURCES_HRA_YAML.exists() else None
    )
    with (ROOT / "package.json").open(encoding="utf-8") as f:
        version = json.load(f)["version"]
    systems = []
    structures: dict[str, dict] = {}
    for system in SYSTEMS:
        glb = ASSETS_DIR / f"{system}.glb"
        meta_path = WORK_DIR / "processed" / system / "meta.json"
        if not glb.exists() or not meta_path.exists():
            continue
        with meta_path.open(encoding="utf-8") as f:
            metas = json.load(f)
        systems.append(
            {
                "id": system,
                "file": f"assets/{system}.glb",
                "bytes": glb.stat().st_size,
                "structures": [m["slug"] for m in metas],
            }
        )
        for m in metas:
            structures[m["slug"]] = {
                "zh": m["zh"],
                "en": m["en"],
                "system": m["system"],
                "region": m["region"],
                "side": m["side"],
                "fma": m["fma"],
                **({"uberon": m["uberon"]} if m.get("uberon") else {}),
                "source": m["source"],
                **({"parent": m["parent"]} if m.get("parent") else {}),
                "bbox": m["bbox"],
            }
    if not systems:
        raise SystemExit("错误：public/assets/ 没有任何系统 glb，先跑 export")
    # 署名逐条按数据源写：用到哪个源就署哪个源（CLAUDE.md 的许可证铁律）
    attribution = [
        sources["license"]["attribution"],
        "数据来源：BodyParts3D 4.0（NBDC LSDB 存档站），CC BY 4.0。",
    ]
    if hra_sources and any(info["source"] == bp3d.HRA_SOURCE for info in structures.values()):
        attribution += [
            hra_sources["license"]["attribution"],
            "心脏内部结构来自 HuBMAP Human Reference Atlas 3D 参考器官，CC BY 4.0。",
        ]
    manifest = {
        "version": version,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "systems": systems,
        "structures": structures,
        "attribution": attribution,
    }
    out = ASSETS_DIR / "manifest.json"
    with out.open("w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"manifest.json：{len(systems)} 个系统，{len(structures)} 个结构")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--systems", default="skeleton", help="逗号分隔的系统列表，或 all")
    args = ap.parse_args(argv)
    wanted = list(SYSTEMS) if args.systems == "all" else args.systems.split(",")
    for s in wanted:
        if s not in SYSTEMS:
            raise SystemExit(f"错误：未知系统 {s!r}")

    export_dir = WORK_DIR / "export"
    export_dir.mkdir(parents=True, exist_ok=True)
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    for system in wanted:
        metas = load_metas(system)
        if not metas:
            print(f"{system}: 无处理产物，跳过")
            continue
        raw = export_dir / f"{system}.raw.glb"
        out = ASSETS_DIR / f"{system}.glb"
        build_glb(metas, WORK_DIR / "processed" / system, raw)
        # build_glb 焊接后面数可能微降，把实际值写回 meta，manifest 与 glb 才对得上
        with (WORK_DIR / "processed" / system / "meta.json").open("w", encoding="utf-8") as fp:
            json.dump(metas, fp, ensure_ascii=False, indent=1)
        optimize_glb(raw, out)
        print(
            f"{system}.glb: {out.stat().st_size / 1e6:.2f} MB"
            f"（未压缩 {raw.stat().st_size / 1e6:.2f} MB，{sum(m['faces'] for m in metas)} 面）"
        )
    write_manifest()
    return 0


if __name__ == "__main__":
    sys.exit(main())
