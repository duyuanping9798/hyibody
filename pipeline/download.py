"""M1-1：按 config/sources.yaml 下载 BodyParts3D 数据、校验 sha256、解压到 raw/。

用法：
    python3 pipeline/download.py            # 全部下载（已存在且校验通过则跳过）
    python3 pipeline/download.py --only isa_parts_list_e.txt
    python3 pipeline/download.py --force    # 重新下载与解压
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
import hashlib
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

from bp3d import RAW_DIR, load_sources


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download_file(url: str, dest: Path) -> None:
    """流式下载到临时文件再原子改名，避免留下半截文件。"""
    print(f"下载 {url}")
    with tempfile.NamedTemporaryFile(dir=dest.parent, delete=False) as tmp:
        tmp_path = Path(tmp.name)
        try:
            with urllib.request.urlopen(url, timeout=600) as resp:
                shutil.copyfileobj(resp, tmp, length=1 << 20)
        except BaseException:
            tmp_path.unlink(missing_ok=True)
            raise
    tmp_path.replace(dest)


def ensure_file(entry: dict, base_url: str, raw_dir: Path, force: bool) -> Path:
    """下载并校验一个文件；返回本地路径。sha256 不匹配即报错退出（不静默重试）。"""
    dest = raw_dir / entry["name"]
    if dest.exists() and not force:
        actual = sha256_of(dest)
        if actual == entry["sha256"]:
            print(f"跳过 {entry['name']}（已存在，sha256 一致）")
            return dest
        raise SystemExit(
            f"错误：{dest} 已存在但 sha256 不符\n  期望 {entry['sha256']}\n  实际 {actual}\n"
            f"删除该文件或用 --force 重新下载。"
        )
    download_file(f"{base_url}/{entry['name']}", dest)
    actual = sha256_of(dest)
    if actual != entry["sha256"]:
        dest.unlink(missing_ok=True)
        raise SystemExit(
            f"错误：{entry['name']} 下载后 sha256 校验失败\n"
            f"  期望 {entry['sha256']}\n  实际 {actual}\n"
            f"来源文件可能已变化，请人工核对 sources.yaml。"
        )
    print(f"完成 {entry['name']}（sha256 通过）")
    return dest


def extract_zip(zip_path: Path, entry: dict, raw_dir: Path, force: bool) -> None:
    target = raw_dir / entry["extract_dir"]
    if target.is_dir() and not force:
        print(f"跳过解压 {entry['name']}（{target.name}/ 已存在）")
        return
    print(f"解压 {entry['name']} → {target.name}/")
    if target.is_dir():
        shutil.rmtree(target)
    with zipfile.ZipFile(zip_path) as z:
        for m in z.namelist():
            # 防 zip-slip：所有成员必须落在 raw_dir 内
            if Path(m).is_absolute() or ".." in Path(m).parts:
                raise SystemExit(f"错误：zip 成员路径异常 {m!r}")
        z.extractall(raw_dir)
    if not target.is_dir():
        raise SystemExit(f"错误：解压后未找到 {target}（zip 内目录名与 extract_dir 不符？）")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--only", help="只处理指定文件名")
    ap.add_argument("--force", action="store_true", help="重新下载与解压")
    args = ap.parse_args(argv)

    cfg = load_sources()
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    entries = [e for e in cfg["files"] if not args.only or e["name"] == args.only]
    if not entries:
        raise SystemExit(f"错误：sources.yaml 中没有 {args.only!r}")
    for entry in entries:
        path = ensure_file(entry, cfg["base_url"], RAW_DIR, args.force)
        if entry["kind"] == "obj_zip":
            extract_zip(path, entry, RAW_DIR, args.force)
    print("下载完成。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
