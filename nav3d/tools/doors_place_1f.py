# -*- coding: utf-8 -*-
"""1F 门位重定：门必须朝相邻走廊 + 实测开口定位置。

为什么不能纯自动测：
    疏散板上的墙线在房间转角、与走廊重合处本身就会断，
    单纯找"缺口"会把墙角当成门。必须有语义约束才可靠。

规则：
    1. 房间的门只能开在"与走廊贴边"的那面墙上；
    2. 有多面贴走廊时，优先选"实测有开口"的那面；
    3. doorT 取该面墙上实测开口的中心；没有实测就用 0.5。

用法：
    python tools/doors_place_1f.py            # 只报告
    python tools/doors_place_1f.py --write    # 写回 data/floor-1f.js
"""
import io
import json
import os
import sys

import numpy as np
from PIL import Image

R = r"C:\Users\35391\Desktop\python\实验室定位"
IMG = os.path.join(R, "docs", "img", "1f_flat.png")
DATA = os.path.join(R, "nav3d", "data", "floor-1f.js")
PPM = 23.0

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


def gaps_h(y, x1, x2, band=3, mn=10):
    seg = red()[max(0, y - band):y + band + 1, x1:x2].any(axis=0)
    out = []
    i, n = 0, len(seg)
    while i < n:
        if not seg[i]:
            j = i
            while j < n and not seg[j]:
                j += 1
            if j - i >= mn:
                out.append((x1 + i, x1 + j - 1, j - i))
            i = j
        else:
            i += 1
    return out


def gaps_v(x, y1, y2, band=3, mn=10):
    seg = red()[y1:y2, max(0, x - band):x + band + 1].any(axis=1)
    out = []
    i, n = 0, len(seg)
    while i < n:
        if not seg[i]:
            j = i
            while j < n and not seg[j]:
                j += 1
            if j - i >= mn:
                out.append((y1 + i, y1 + j - 1, j - i))
            i = j
        else:
            i += 1
    return out


WMIN, WMAX = 0.6, 3.0


def best_gap(gaps, lo, hi):
    span = float(hi - lo)
    cand = []
    for g0, g1, w in gaps:
        wm = w / PPM
        if not (WMIN <= wm <= WMAX):
            continue
        t = ((g0 + g1) / 2.0 - lo) / span
        if t < 0.05 or t > 0.95:
            continue
        cand.append((abs(t - 0.5), t, wm, g0, g1))
    if not cand:
        return None
    cand.sort()
    _, t, wm, g0, g1 = cand[0]
    return {"t": round(t, 3), "w": round(min(wm, 2.4), 2), "px": [g0, g1]}


def face_geom(r, face):
    if face == "S":
        return gaps_h(r["y2"], r["x1"], r["x2"]), r["x1"], r["x2"]
    if face == "N":
        return gaps_h(r["y1"], r["x1"], r["x2"]), r["x1"], r["x2"]
    if face == "W":
        return gaps_v(r["x1"], r["y1"], r["y2"]), r["y1"], r["y2"]
    return gaps_v(r["x2"], r["y1"], r["y2"]), r["y1"], r["y2"]


def faces_touching(r, cs, pad=8):
    out = []
    for c in cs:
        if abs(r["y2"] - c["y1"]) <= pad and not (r["x2"] < c["x1"] or c["x2"] < r["x1"]):
            out.append("S")
        if abs(r["y1"] - c["y2"]) <= pad and not (r["x2"] < c["x1"] or c["x2"] < r["x1"]):
            out.append("N")
        if abs(r["x2"] - c["x1"]) <= pad and not (r["y2"] < c["y1"] or c["y2"] < r["y1"]):
            out.append("E")
        if abs(r["x1"] - c["x2"]) <= pad and not (r["y2"] < c["y1"] or c["y2"] < r["y1"]):
            out.append("W")
    seen, res = set(), []
    for f in out:
        if f not in seen:
            seen.add(f)
            res.append(f)
    return res


def main():
    D = load()
    cs = D["corridors"]
    print("1F 门位重定（门必须开在贴走廊那面墙上）\n")
    print("%-9s %-20s %-13s %-5s %-7s %-7s %s" % (
        "id", "name", "贴走廊的面", "选定", "doorT", "doorW", "实测开口"))
    print("-" * 96)

    changes = 0
    noface = []
    updates = {}
    for r in D["rooms"]:
        tf = faces_touching(r, cs)
        if not tf:
            noface.append(r["id"])
            print("%-9s %-20s %-13s %s" % (r["id"], r["name"][:18], "无", "不贴任何走廊"))
            continue

        pick = None
        for f in tf:
            gaps, lo, hi = face_geom(r, f)
            g = best_gap(gaps, lo, hi)
            if g:
                pick = (f, g)
                break
        if pick is None:
            cur = r.get("door")
            f = cur if cur in tf else tf[0]
            pick = (f, {"t": 0.5, "w": float(r.get("doorW", 1.0)), "px": None})

        f, g = pick
        old_f, old_t = r.get("door"), r.get("doorT", 0.5)
        changed = (old_f != f) or (abs(float(old_t) - g["t"]) > 0.08)
        if changed:
            changes += 1
        updates[r["id"]] = {"door": f, "doorT": g["t"], "doorW": g["w"]}
        detail = ("%d-%d" % tuple(g["px"])) if g.get("px") else "推定"
        print("%-9s %-20s %-13s %-5s %-7s %-7s %s%s" % (
            r["id"], r["name"][:18], ",".join(tf), f, g["t"], g["w"], detail,
            "   <-改" if changed else ""))

    print("-" * 96)
    print("需要调整门位的房间: %d 间" % changes)
    if noface:
        print("不贴走廊的房间:", noface)

    if "--write" in sys.argv:
        for r in D["rooms"]:
            u = updates.get(r["id"])
            if u:
                r["door"] = u["door"]
                r["doorT"] = u["doorT"]
                r["doorW"] = u["doorW"]
        body = json.dumps(D, ensure_ascii=False, indent=2)
        out = ("/* 第二实验楼 1 层\n"
               "   由 tools/gen_1f.py 生成，不要手改；改完重跑脚本。\n"
               "   坐标全部实测自 docs/img/floor-1f-photo.jpg（已做平场校正）。\n"
               "   门位由 tools/doors_place_1f.py 按「门必须朝相邻走廊 + 实测开口」确定。\n"
               "   ⚠ 1F 结构与 2/3/4/5 层不同，未沿用任何其他层的骨架。 */\n"
               "window.FLOOR_DATA_BY_ID = window.FLOOR_DATA_BY_ID || {};\n"
               'window.FLOOR_DATA_BY_ID["B2-1"] = %s;\n') % body
        io.open(DATA, "w", encoding="utf-8").write(out)
        print("\n已写入 %s" % DATA)


if __name__ == "__main__":
    main()
