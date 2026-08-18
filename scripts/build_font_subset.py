"""把 Noto Sans SC 子集化成本站实际用到的那几百个字，产物提交进仓库。

为什么要子集：整套思源黑体简体有 2 万多字、单个字重就 8 MB，整站资产预算才 25 MB。
本站的中文全部来自 content/ 下的几个文件（界面文案、科普文案、故事线、结构中英名），
字符集是封闭的，子集下来只有几百字、几十 KB。

用法：
    python3 scripts/build_font_subset.py        # 缺源文件时自动下载（缓存在 .font-cache/）

**改了 content/ 里的中文之后要重跑本脚本**，否则新字会掉回系统字体。
CI 不跑这个脚本（要联网），产物直接提交。

字体许可证：SIL Open Font License 1.1（见 docs/ATTRIBUTION.md）。
"""

from __future__ import annotations

import json
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".font-cache"
OUT_DIR = ROOT / "src" / "assets" / "fonts"

BASE = "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF/SC"
FACES = [
    ("NotoSansSC-Regular.otf", "noto-sans-sc-400-subset.woff2", 400),
    ("NotoSansSC-Bold.otf", "noto-sans-sc-700-subset.woff2", 700),
]

# 界面里可能出现、但不在 content/ 文件里的字符（数字、标点、单位、箭头等）
EXTRA = (
    "0123456789"
    "abcdefghijklmnopqrstuvwxyz"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    " !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"
    "·—…‘’“”、。《》〈〉【】（）％×÷±≤≥→←↑↓°"
    "①②③④⑤⑥⑦⑧⑨⑩"
)


def iter_text() -> list[str]:
    """收集所有会出现在界面上的文本。"""
    texts: list[str] = [EXTRA]
    content = ROOT / "content"

    def walk(node: object) -> None:
        if isinstance(node, str):
            texts.append(node)
        elif isinstance(node, dict):
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    for path in sorted(content.rglob("*.json")):
        walk(json.loads(path.read_text(encoding="utf-8")))
    # structures.yaml 的中英文名（不引 yaml，直接按行取值就够——只是收字符）
    for path in sorted(content.glob("*.yaml")):
        texts.append(path.read_text(encoding="utf-8"))
    return texts


def download(name: str) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    dest = CACHE / name
    if dest.exists() and dest.stat().st_size > 1_000_000:
        return dest
    url = f"{BASE}/{name}"
    print(f"下载 {url}")
    with urllib.request.urlopen(url, timeout=180) as resp, dest.open("wb") as f:  # noqa: S310
        f.write(resp.read())
    return dest


def main() -> int:
    chars = sorted({c for text in iter_text() for c in text if c.isprintable() and c != " "})
    chars.append(" ")
    print(f"需要的字符：{len(chars)} 个")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    unicodes = ",".join(f"U+{ord(c):04X}" for c in chars)
    total = 0
    for source_name, out_name, weight in FACES:
        source = download(source_name)
        out = OUT_DIR / out_name
        cmd = [
            sys.executable,
            "-m",
            "fontTools.subset",
            str(source),
            f"--unicodes={unicodes}",
            "--flavor=woff2",
            "--layout-features=",  # 中文界面用不到 OpenType 特性，去掉省体积
            "--no-hinting",
            "--desubroutinize",
            "--name-IDs=1,2,3,4,6",
            f"--output-file={out}",
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        if proc.returncode != 0:
            print(proc.stdout, proc.stderr, file=sys.stderr)
            raise SystemExit(f"子集化失败：{source_name}")
        size = out.stat().st_size
        total += size
        print(f"  {out.relative_to(ROOT)}（字重 {weight}）: {size / 1024:.1f} KB")
    print(f"字体子集合计 {total / 1024:.1f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
