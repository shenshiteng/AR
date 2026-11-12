# -*- coding: utf-8 -*-
"""1F 门洞实测 v3：先"吸附墙线"，再找门洞。

v2 失败的原因：房间矩形是从墙中心线取的，实际红线常偏移 1~3px，
             扫描线一旦落在墙外就整条空，全被判成"没门"。
解决办法：
    对每条边，先在 ±8px 内试探一系列偏移，取"该线上红墙覆盖率最高"的那个位置，
    认为它就是这道墙的真实像素位置；然后在这条线上找缺口。
"""
import io
import json
import os

import numpy as np
from PIL import Image

R = r"C:\Users\35391\Desktop\python\实验室定位"
IMG = os.path.join(R, "docs", "img", "1f_flat.png")
DATA = os.path.join(R, "nav3d", "data", "floor-1f.js")
PPM = 23.0

DOOR_MIN_M = 0.55
DOOR_MAX_M = 2.40
MIN_SIDE_PX = 10
SNAP = 8              # 吸附搜索半径（像素）

_red = None


def red():
    global _red
    if _red is None:
        im = Image.open(IMG).convert("RGB")
        a = np.asarray(im).astype(np.int16)
        r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
        m = (r - np.maximum(g, b)) > 45
        m[:290, :] = False
        m[1765:, :] = False
        m[:, :125] = False
        m[:, 1660:] = False
        _red = m
    return _red


def load():
    s = io.open(DATA, encoding="utf-8-sig").read()
    return json.loads(s[s.index("= {") + 2:].rstrip().rstrip(";"))


def line_h(y, x1, x2, band=1):
    """取 y 附近 band 内任一行有红即为墙。"""
    m = red()
    return m[max(0, y - band):y + band + 1, x1:x2].any(axis=0)


def line_v(x, y1, y2, band=1):
    m = red()
    return m[y1:y2, max(0, x - band):x + band + 1].any(axis=1)


def snap_h(y, x1, x2):
    best, bestcov = y, -1
    for off in range(-SNAP, SNAP + 1):
        seg = line_h(y + off, x1, x2, band=1)
        c = seg.sum()
        if c > bestcov:
            bestcov, best = c, y + off
    return best, bestcov / float(x2 - x1)


def snap_v(x, y1, y2):
    best, bestcov = x, -1
    for off in range(-SNAP, SNAP + 1):
        seg = line_v(x + off, y1, y2, band=1)
        c = seg.sum()
        if c > bestcov:
            bestcov, best = c, x + off
    return best, bestcov / float(y2 - y1)


def find_gaps(seg, lo):
    out = []
    n = len(seg)
    i = 0
    while i < n:
        if not seg[i]:
            j = i
            while j < n and not seg[j]:
                j += 1
            k = i - 1
            left = 0
            while k >= 0 and seg[k]:
                left += 1
                k -= 1
            k = j
            right = 0
            while k < n and seg[k]:
                right += 1
                k += 1
            out.append((lo + i, lo + j - 1, j - i, left, right))
            i = j
        else:
            i += 1
    return out


def doors_on(face, x1, y1, x2, y2):
    if face in ("S", "N"):
        y = y2 if face == "S" else y1
        y, cov = snap_h(y, x1, x2)
        gaps = find_gaps(line_h(y, x1, x2, 2), x1)
        lo, hi = x1, x2
    else:
        x = x1 if face == "W" else x2
        x, cov = snap_v(x, y1, y2)
        gaps = find_gaps(line_v(x, y1, y2, 2), y1)
        lo, hi = y1, y2
    span = float(hi - lo)
    out = []
    for g0, g1, w, lw, rw in gaps:
        wm = w / PPM
        if not (DOOR_MIN_M <= wm <= DOOR_MAX_M):
            continue
        if lw < MIN_SIDE_PX or rw < MIN_SIDE_PX:
            continue
        t = ((g0 + g1) / 2.0 - lo) / span
        out.append({"t": round(t, 3), "w": round(wm, 2), "px": [g0, g1],
                    "cov": round(cov, 2)})
    return out, cov


FACES = ("N", "S", "W", "E")


def main():
    D = load()
    print("1F 门洞实测 v3（先吸附墙线再找缺口）\n")
    print("%-9s %-22s %s" % ("id", "name", "各面实测门洞（* = 与当前 door 一致）"))
    print("-" * 96)

    total, none = 0, []
    for r in D["rooms"]:
        x1, y1, x2, y2 = r["x1"], r["y1"], r["x2"], r["y2"]
        parts = []
        for f in FACES:
            ds, cov = doors_on(f, x1, y1, x2, y2)
            for d in ds:
                star = "*" if r.get("door") == f else ""
                parts.append("%s t=%.2f w=%.2f%s" % (f, d["t"], d["w"], star))
                total += 1
        if not parts:
            none.append(r["id"])
            print("%-9s %-22s —" % (r["id"], r["name"][:20]))
        else:
            print("%-9s %-22s %s" % (r["id"], r["name"][:20], "   ".join(parts)))

    print("-" * 96)
    print("共测到 %d 个门洞" % total)
    print("仍无门洞的房间:", none if none else "无")


if __name__ == "__main__":
    main()
