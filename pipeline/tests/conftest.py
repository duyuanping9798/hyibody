import sys
from pathlib import Path

# pipeline/ 目录放到搜索路径末尾（select.py 与标准库 select 同名，标准库优先）
_PIPELINE = str(Path(__file__).resolve().parent.parent)
if _PIPELINE not in sys.path:
    sys.path.append(_PIPELINE)
