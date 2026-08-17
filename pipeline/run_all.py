"""一条命令重跑数据流水线：download → select → process → export → validate。

用法（对应 pnpm pipeline:all）：
    python3 pipeline/run_all.py                     # 默认只跑骨骼系统（M1）
    python3 pipeline/run_all.py --systems all       # 全系统
    python3 pipeline/run_all.py --skip-download     # 已有 raw/ 数据时
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

_DIR = Path(__file__).resolve().parent
# select.py 与标准库 select 同名（KICKOFF 规定的文件名）：把本目录移到搜索路径
# 末尾，标准库优先；再用别名加载本目录脚本，避免任何遮蔽。
if sys.path and sys.path[0] == str(_DIR):
    sys.path.remove(str(_DIR))
    sys.path.append(str(_DIR))


def load_step(name: str):
    alias = f"hyibody_{name}"
    if alias in sys.modules:
        return sys.modules[alias]
    spec = importlib.util.spec_from_file_location(alias, _DIR / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[alias] = mod
    spec.loader.exec_module(mod)
    return mod


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--systems", default="all", help="逗号分隔的系统列表，或 all")
    ap.add_argument("--skip-download", action="store_true")
    args = ap.parse_args(argv)

    steps: list[tuple[str, list[str]]] = []
    if not args.skip_download:
        steps.append(("download", []))
    steps += [
        ("select", []),
        ("process", ["--systems", args.systems]),
        ("export", ["--systems", args.systems]),
        ("validate", ["--require-manifest"]),
    ]
    for name, step_args in steps:
        print(f"==== {name} {' '.join(step_args)}".rstrip() + " ====")
        code = load_step(name).main(step_args)
        if code != 0:
            print(f"{name} 失败（退出码 {code}）", file=sys.stderr)
            return code
    print("流水线完成。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
