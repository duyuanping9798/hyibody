"""局部对比度：相邻像素亮度差的平均绝对值——"有没有纹理"的直接度量。

为什么需要它：着色器的观感改动只能看像素，而**眼睛会骗人**。2026-08-21 第一版
表面质感拍完 A/B，我看着觉得"椎体有起伏了"，量出来前景肋骨只有 1.06 倍、
椎体反而 0.93 倍——根本没变。这个数不受整体明暗影响，只看邻域的起伏。

用法：python3 scripts/surface-contrast.py <关.png> <开.png>

配套的截图脚本见 STATUS.md 的 v1.3 一节（固定机位、只留一个系统、
只差 ?surf= 一个变量——A/B 里除了要测的那个变量别的都得钉死）。
"""

import struct
import sys
import zlib
from pathlib import Path

# 取样区域（画面比例）：x0, x1, y0, y1
REGIONS = {
    "左上": (0.10, 0.45, 0.20, 0.45),
    "中央": (0.30, 0.65, 0.28, 0.55),
    "左下": (0.12, 0.48, 0.52, 0.70),
}


def read_png(path: str):
    d = Path(path).read_bytes()
    pos, idat, ct = 8, b"", 6
    w = h = 0
    while pos < len(d):
        ln = struct.unpack(">I", d[pos : pos + 4])[0]
        typ = d[pos + 4 : pos + 8]
        if typ == b"IHDR":
            w, h, _bd, ct = struct.unpack(">IIBB", d[pos + 8 : pos + 18])
        elif typ == b"IDAT":
            idat += d[pos + 8 : pos + 8 + ln]
        pos += 12 + ln
    raw = zlib.decompress(idat)
    ch = 4 if ct == 6 else 3
    stride = w * ch
    rows, prev, i = [], bytearray(stride), 0
    for _ in range(h):
        f = raw[i]
        i += 1
        line = bytearray(raw[i : i + stride])
        i += stride
        for x in range(stride):
            a = line[x - ch] if x >= ch else 0
            b = prev[x]
            c = prev[x - ch] if x >= ch else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        rows.append(bytes(line))
        prev = line
    return w, h, ch, rows


def contrast(rows, w, h, ch, box, stride: int = 1) -> float:
    """步长 `stride` 个像素的亮度差均值。

    **必须多尺度量**：这个指标对空间频率敏感——一处 12 像素周期的起伏，
    用步长 1 去量几乎读不出来，用步长 6 才读得到。2026-08-21 就在这上面
    绕过一次：把噪声频率调低（让它在真实观看距离下更像"骨面起伏"）之后，
    步长 1 的读数反而没怎么涨，差点据此判定"参数还是太弱"。
    """
    x0, x1, y0, y1 = box
    total = 0.0
    n = 0
    for y in range(int(h * y0), min(int(h * y1), h - stride)):
        r, r2 = rows[y], rows[y + stride]
        for x in range(int(w * x0), int(w * x1) - stride):
            lum = (r[x * ch] + r[x * ch + 1] + r[x * ch + 2]) / 3
            right = (r[(x + stride) * ch] + r[(x + stride) * ch + 1] + r[(x + stride) * ch + 2]) / 3
            down = (r2[x * ch] + r2[x * ch + 1] + r2[x * ch + 2]) / 3
            total += abs(lum - right) + abs(lum - down)
            n += 2
    return total / max(n, 1)


def main() -> int:
    a_path, b_path = sys.argv[1], sys.argv[2]
    a = read_png(a_path)
    b = read_png(b_path)
    strides = [1, 3, 6, 12]
    print(f"{'区域':6} {'步长':>4} {'关':>8} {'开':>8}   倍数")
    ratios = []
    for name, box in REGIONS.items():
        for st in strides:
            ca = contrast(a[3], a[0], a[1], a[2], box, st)
            cb = contrast(b[3], b[0], b[1], b[2], box, st)
            r = cb / ca if ca else 0
            ratios.append(r)
            print(f"{name:6} {st:>4} {ca:8.2f} {cb:8.2f}   {r:.2f}×")
    best = max(ratios)
    # 这个数**只回答"有没有生效"，不用来定幅度**。标定过：bump 从 2 抬到 20
    # （十倍，画面从"几乎看不出"变成"揉皱的锡纸"），读数只从 1.27× 走到 1.65×——
    # 局部对比度在这类场景被几何边缘和半透明叠加主导，比值被严重压缩。
    # 幅度请看同机位 A/B 的图。
    verdict = "没生效" if best < 1.1 else "生效了（幅度请看图，别看这个数）"
    print(f"\n最大 {best:.2f}× —— {verdict}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
