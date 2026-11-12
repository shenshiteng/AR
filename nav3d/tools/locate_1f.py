# -*- coding: utf-8 -*-
"""1F 墙体量测 v4：在平场校正图上工作（光照已均匀，暗部墙线也能测到）。

输出：横墙 y 列表、竖墙 x 列表，以及每个分区内的精确墙位置。
"""
import os

import numpy as np
from PIL import Image

R = r"C:\Users\35391\Desktop\python\实验室定位"
IMG = os.path.join(R, "docs", "img", "1f_flat.png")

_m = None


def m():
    global _m
    if _m is None:
        im = Image.open(IMG).convert("RGB")
        a = np.asarray(im).astype(np.int16)
        r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
        x = (r - np.maximum(g, b)) > 60        # 增强图里墙是纯红 (200,0,0)
        x[:290, :] = False                     # 去掉标题带
        x[1765:, :] = False
        x[:, :125] = False
        x[:, 1660:] = False
        _m = x
    return _m


def longest_run(line):
    best = cur = 0
    for v in line:
        if v:
            cur += 1
            if cur > best:
                best = cur
        else:
            cur = 0
    return best


def find_h(y1, y2, x1, x2, mincover=0.55, minrun=40):
    mm = m()[y1:y2, x1:x2]
    w = x2 - x1
    out = []
    for i in range(mm.shape[0]):
        ln = mm[i]
        if ln.sum() / float(w) >= mincover and longest_run(ln) >= minrun:
            out.append(y1 + i)
    return out


def find_v(x1, x2, y1, y2, mincover=0.55, minrun=40):
    mm = m()[y1:y2, x1:x2]
    h = y2 - y1
    out = []
    for i in range(mm.shape[1]):
        ln = mm[:, i]
        if ln.sum() / float(h) >= mincover and longest_run(ln) >= minrun:
            out.append(x1 + i)
    return out


def group(vals, gap=6):
    if not vals:
        return []
    out = [[vals[0]]]
    for v in vals[1:]:
        if v - out[-1][-1] <= gap:
            out[-1].append(v)
        else:
            out.append([v])
    return [(g[0], g[-1], (g[0] + g[-1]) // 2) for g in out]


def H(name, y1, y2, x1, x2, **kw):
    gs = group(find_h(y1, y2, x1, x2, **kw))
    print("  %-22s → y: %s" % (name, " ".join("%d" % c for _, _, c in gs) or "—"))


def V(name, x1, x2, y1, y2, **kw):
    gs = group(find_v(x1, x2, y1, y2, **kw))
    print("  %-22s → x: %s" % (name, " ".join("%d" % c for _, _, c in gs) or "—"))


if __name__ == "__main__":
    print("=" * 76)
    print("1F 平场校正图 墙线定位 (1773x2364)")
    print("=" * 76)

    print("\n【全区 外墙】")
    H("北外墙 (x200-1450)", 290, 330, 200, 1450, mincover=0.5, minrun=100)
    H("南外墙 (x160-1400)", 1700, 1760, 160, 1400, mincover=0.5, minrun=100)

    print("\n【北区 108 / 109 / 中间走廊】")
    V("108西墙", 150, 260, 330, 580, mincover=0.4, minrun=100)
    V("108东墙/走廊西", 460, 500, 330, 580, mincover=0.4, minrun=100)
    V("走廊东/109西", 500, 540, 330, 580, mincover=0.4, minrun=100)
    V("109东墙", 720, 780, 330, 580, mincover=0.4, minrun=100)
    H("108南墙", 575, 615, 180, 500, mincover=0.4, minrun=80)
    H("109南墙", 575, 615, 520, 760, mincover=0.4, minrun=80)

    print("\n【北走廊 110/111/113/112】")
    H("走廊各横墙 (x560-1100)", 570, 850, 560, 1105, mincover=0.5, minrun=80)
    V("110/111竖墙", 470, 570, 660, 820, mincover=0.4, minrun=60)
    V("112/113竖墙", 540, 1120, 600, 820, mincover=0.5, minrun=100)

    print("\n【西北 厕所/楼梯】")
    V("西北竖墙 (y660-830)", 130, 480, 660, 830, mincover=0.4, minrun=60)
    H("西北横墙 (x140-480)", 640, 850, 140, 480, mincover=0.4, minrun=60)

    print("\n【西区 107 / 106 / 105 / 104】")
    V("107西墙", 340, 400, 840, 1300, mincover=0.4, minrun=150)
    V("107东墙", 540, 600, 840, 1300, mincover=0.4, minrun=150)
    H("107/106/105/104 横墙", 1280, 1610, 400, 545, mincover=0.4, minrun=60)

    print("\n【南区 101 / 102 / 103】")
    H("101北墙 (x560-1100)", 1390, 1430, 560, 1100, mincover=0.5, minrun=100)
    H("102/103横墙 (x160-540)", 1570, 1610, 160, 540, mincover=0.4, minrun=100)
    V("102/103竖墙 (y1600-1730)", 140, 560, 1600, 1730, mincover=0.4, minrun=80)
    V("101东墙", 1090, 1130, 1420, 1740, mincover=0.4, minrun=100)

    print("\n【东区 天井东 / 东翼】")
    V("天井东墙", 1090, 1130, 700, 1400, mincover=0.4, minrun=150)
    V("东走廊东墙", 1140, 1180, 830, 1400, mincover=0.4, minrun=100)
    H("东翼横墙 (x1150-1650)", 1040, 1330, 1150, 1650, mincover=0.4, minrun=80)
    V("东翼竖墙 (y1190-1310)", 1140, 1660, 1190, 1310, mincover=0.4, minrun=60)
