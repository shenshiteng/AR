# -*- coding: utf-8 -*-
"""1F 精确测量 v2：在去倾斜图上，沿指定扫描线报告墙段与开口。

已校正 -0.95° 倾斜，坐标基准 = docs/img/1f_deskew.png (1773x2364)
已知主横墙 y: 295/308/516/591/656/699/825/933/1058/1128/1182/1296/1314/1408/1492/1543/1591/1743
已知主竖墙 x: 285/362/372/416/491/504/531/559/746/1106/1154/1181/1239/1400/1564/1648
"""
import os
import sys

import numpy as np
from PIL import Image

R = r"C:\Users\35391\Desktop\python\实验室定位"
IMG = os.path.join(R, "docs", "img", "1f_deskew.png")

_red = None


def red():
    global _red
    if _red is None:
        im = Image.open(IMG).convert("RGB")
        a = np.asarray(im).astype(np.int16)
        r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
        m = (r - np.maximum(g, b)) > 12
        m[:280, :] = False
        m[1760:, :] = False
        m[:, :120] = False
        m[:, 1670:] = False
        _red = m
    return _red


def runs(line, mn=6):
    out = []
    i, n = 0, len(line)
    while i < n:
        if line[i]:
            j = i
            while j < n and line[j]:
                j += 1
            out.append((i, j - 1, j - i))
            i = j
        else:
            i += 1
    return [x for x in out if x[2] >= mn]


def hscan(y, x1, x2, band=2, label=""):
    m = red()
    seg = m[y - band:y + band + 1, x1:x2].any(axis=0)
    rs = runs(seg)
    print("  %s y=%d [%d..%d]" % (label, y, x1, x2))
    print("     墙:", " ".join("%d-%d" % (x1 + a, x1 + b) for a, b, _ in rs) or "无")
    # 开口 = 相邻墙之间的空隙（且 >=10px）
    gaps = []
    for i in range(len(rs) - 1):
        g0, g1 = x1 + rs[i][1] + 1, x1 + rs[i + 1][0] - 1
        if g1 - g0 >= 10:
            gaps.append((g0, g1, g1 - g0 + 1))
    print("     开口:", " ".join("%d-%d(%d)" % g for g in gaps) or "无")


def vscan(x, y1, y2, band=2, label=""):
    m = red()
    seg = m[y1:y2, x - band:x + band + 1].any(axis=1)
    rs = runs(seg)
    print("  %s x=%d [%d..%d]" % (label, x, y1, y2))
    print("     墙:", " ".join("%d-%d" % (y1 + a, y1 + b) for a, b, _ in rs) or "无")
    gaps = []
    for i in range(len(rs) - 1):
        g0, g1 = y1 + rs[i][1] + 1, y1 + rs[i + 1][0] - 1
        if g1 - g0 >= 10:
            gaps.append((g0, g1, g1 - g0 + 1))
    print("     开口:", " ".join("%d-%d(%d)" % g for g in gaps) or "无")


if __name__ == "__main__":
    print("=" * 72)
    print("1F 去倾斜图精确测量 (1773x2364, 已校正 -0.95°)")
    print("=" * 72)

    print("\n########## 北区 108 / 109 ##########")
    hscan(450, 120, 1000, label="穿过 108/109 中部水平线")
    vscan(300, 280, 620, label="108 内部竖线")
    vscan(650, 280, 620, label="109 内部竖线")
    hscan(591, 120, 1000, label="108/109 南墙")

    print("\n########## 北走廊 & 112/113 ##########")
    hscan(699, 120, 1670, label="走廊北边")
    hscan(825, 120, 1670, label="走廊南边(112/113北墙)")

    print("\n########## 西区 107 / 106 ##########")
    vscan(372, 600, 1760, label="107 西墙")
    vscan(559, 600, 1760, label="107 东墙(天井西)")
    hscan(1408, 120, 1670, label="106/105 与 101 之间")

    print("\n########## 东区 天井东侧 ##########")
    vscan(1106, 600, 1760, label="天井东墙/东走廊")
    vscan(1239, 750, 1400, label="东侧支廊")
    hscan(933, 1100, 1670, label="东侧厕所区")

    print("\n########## 南区 101 ##########")
    hscan(1314, 120, 1670, label="101 北墙")
    hscan(1743, 120, 1670, label="外墙南")
    vscan(1564, 1300, 1760, label="东南楼梯区")
    vscan(1648, 1300, 1760, label="东外墙")
