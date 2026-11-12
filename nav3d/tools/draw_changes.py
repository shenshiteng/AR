# -*- coding: utf-8 -*-
"""生成「墙体调整 + 通行路径」说明图。

画的是 data/floor-3f.js 里的真实数据：
  - 房间按 kind 上淡色 + 深红墙线（若某面标了 open，则该面画绿色虚线 = 墙已拆）
  - 走廊 / 支廊浅青填充
  - 门：墙上的缺口 + 门扇线（绿=门洞）
  - 楼梯：灰底踏步
  - 最外圈外墙：深灰粗线
  - 三条通行路径：用页面同一套栅格（STEP=6/PAD=9）跑 A* 得到

输出：
  plan-changes-3f.png   整层（带 ①② 改动标记 + 三条路径）
  plan-changes-nw.png   西北角特写
  plan-changes-se.png   东南角特写
"""
import heapq
import io
import json
import math
import os
import re
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from check_grid import STEP, Grid   # noqa: E402  同一套栅格规则

NAV = os.path.dirname(HERE)
SRC = os.path.join(NAV, "data", "floor-3f.js")
F = "C:/Windows/Fonts/msyh.ttc"
FB = "C:/Windows/Fonts/msyhbd.ttc"


def font(sz, bold=False):
    return ImageFont.truetype(FB if bold else F, sz)


src = io.open(SRC, encoding="utf-8").read()
D = json.loads(re.search(r"window\.FLOOR_DATA\s*=\s*(\{.*\});\s*$", src, re.S).group(1))
W, H = D["imageWidth"], D["imageHeight"]

FILL = {
    "lab":     (252, 238, 226),
    "office":  (230, 240, 252),
    "room":    (232, 245, 232),
    "store":   (247, 236, 244),
    "service": (243, 240, 234),
    "toilet":  (224, 242, 250),
    "stair":   (250, 232, 234),
}
C_WALL = (150, 60, 60)
C_OPEN = (32, 150, 88)
C_COR = (226, 240, 238)
C_PER = (110, 118, 130)
C_DOOR = (32, 150, 88)


def dash(d, p1, p2, fill, width, on=16, off=11):
    dx, dy = p2[0] - p1[0], p2[1] - p1[1]
    L = math.hypot(dx, dy)
    if L < 1e-6:
        return
    ux, uy = dx / L, dy / L
    t = 0.0
    while t < L:
        t2 = min(L, t + on)
        d.line([p1[0] + ux * t, p1[1] + uy * t, p1[0] + ux * t2, p1[1] + uy * t2],
               fill=fill, width=width)
        t = t2 + off


def arrow(d, p1, p2, fill, width=7, head=26):
    d.line([p1, p2], fill=fill, width=width, joint="curve")
    ang = math.atan2(p2[1] - p1[1], p2[0] - p1[0])
    for s in (-0.42, 0.42):
        d.line([p2, (p2[0] - head * math.cos(ang + s), p2[1] - head * math.sin(ang + s))],
               fill=fill, width=width)


def astar(g, s, t):
    Wg = g.W
    openh = [(0, s[1] * Wg + s[0])]
    came = {}
    gs = {s: 0}
    while openh:
        f, cur = heapq.heappop(openh)
        cx, cy = cur % Wg, cur // Wg
        if (cx, cy) == t:
            path = [(cx, cy)]
            c = cur
            while c in came:
                c = came[c]
                path.append((c % Wg, c // Wg))
            return path[::-1]
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                nx, ny = cx + dx, cy + dy
                if not g.free(nx, ny):
                    continue
                cost = 1.4142 if (dx and dy) else 1.0
                ng = gs[(cx, cy)] + cost
                if ng < gs.get((nx, ny), 1e18):
                    gs[(nx, ny)] = ng
                    came[ny * Wg + nx] = cur
                    heapq.heappush(openh, (ng + math.hypot(nx - t[0], ny - t[1]), ny * Wg + nx))
    return None


def route(g, start, goal_pt):
    s = g.nearest_free(start[0], start[1], 60)
    t = g.nearest_free(goal_pt[0], goal_pt[1], 6)
    if not s or not t:
        return None
    p = astar(g, s, t)
    if not p:
        return None
    pts = [(x * STEP, y * STEP) for x, y in p]
    # 抽稀
    out = [pts[0]]
    i = 1
    while i < len(pts) - 1:
        a, b, c = out[-1], pts[i], pts[i + 1]
        if abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) > 1e-6 and \
           (b[0] - a[0]) * (c[0] - a[0]) + (b[1] - a[1]) * (c[1] - a[1]) > 0:
            out.append(b)
        i += 1
    out.append(pts[-1])
    if math.hypot(out[-1][0] - goal_pt[0], out[-1][1] - goal_pt[1]) > STEP * 1.5:
        out.append(goal_pt)
    return out


def base_plan():
    img = Image.new("RGB", (W, H), (252, 252, 250))
    d = ImageDraw.Draw(img)

    # 走廊 / 支廊
    for c in D.get("corridors", []) + D.get("spurs", []):
        d.rectangle([c["x1"], c["y1"], c["x2"], c["y2"]], fill=C_COR)

    # 楼体缺口（室外）
    for e in D.get("exterior", []):
        d.rectangle([e["x1"], e["y1"], e["x2"], e["y2"]], fill=(226, 228, 232))

    # 房间填色
    for r in D["rooms"]:
        d.rectangle([r["x1"], r["y1"], r["x2"], r["y2"]], fill=FILL.get(r["kind"], (238, 238, 238)))

    # 楼梯踏步
    for r in D["rooms"]:
        if r["kind"] == "stair":
            n = 9
            for i in range(1, n):
                yy = r["y1"] + (r["y2"] - r["y1"]) * i / n
                d.line([r["x1"] + 4, yy, r["x2"] - 4, yy], fill=(196, 186, 190), width=2)

    # 房间墙线（open 的面画绿虚线）
    for r in D["rooms"]:
        op = r.get("open") or []
        edges = {
            "N": [(r["x1"], r["y1"]), (r["x2"], r["y1"])],
            "S": [(r["x1"], r["y2"]), (r["x2"], r["y2"])],
            "W": [(r["x1"], r["y1"]), (r["x1"], r["y2"])],
            "E": [(r["x2"], r["y1"]), (r["x2"], r["y2"])],
        }
        for k, (p1, p2) in edges.items():
            if k in op:
                dash(d, p1, p2, C_OPEN, 7)
            else:
                d.line([p1, p2], fill=C_WALL, width=4)

    # 玻璃幕墙
    for g in D.get("glassWalls", []):
        dash(d, (g["x1"], g["y1"]), (g["x2"], g["y2"]), (60, 170, 220), 8, 20, 12)

    # 最外圈外墙
    for g in D.get("perimeter", []):
        d.line([g["x1"], g["y1"], g["x2"], g["y2"]], fill=C_PER, width=9)

    # 门洞 + 门扇
    for r in D["rooms"]:
        k = r.get("door")
        if not k or (r.get("open") and k in r["open"]):
            continue
        t = 0.5 if r.get("doorT") is None else r["doorT"]
        dw = (r.get("doorW") or 1.05) * D.get("pxPerMeter", 26.0)
        sg = -1 if r.get("swing") == "out" else 1      # out = 往房间外开
        if k in ("N", "S"):
            cx = min(r["x2"] - dw / 2, max(r["x1"] + dw / 2, r["x1"] + (r["x2"] - r["x1"]) * t))
            cy = r["y1"] if k == "N" else r["y2"]
            a, b = (cx - dw / 2, cy), (cx + dw / 2, cy)
            hinge = (cx - dw / 2, cy)
            ang = math.radians(72) * (1 if k == "N" else -1) * sg
            end = (hinge[0] + dw * math.cos(ang), hinge[1] + dw * math.sin(ang))
        else:
            cy = min(r["y2"] - dw / 2, max(r["y1"] + dw / 2, r["y1"] + (r["y2"] - r["y1"]) * t))
            cx = r["x1"] if k == "W" else r["x2"]
            a, b = (cx, cy - dw / 2), (cx, cy + dw / 2)
            hinge = (cx, cy - dw / 2)
            ang = math.radians(72) * (1 if k == "W" else -1) * sg
            end = (hinge[0] + dw * math.sin(ang), hinge[1] + dw * math.cos(ang))
        d.line([a, b], fill=(255, 255, 255), width=11)
        d.line([a, b], fill=C_DOOR, width=5)
        d.line([hinge, end], fill=(120, 82, 46), width=4)

    # 补墙段
    for g in D.get("wallRuns", []):
        d.line([g["x1"], g["y1"], g["x2"], g["y2"]], fill=C_WALL, width=5)

    # 房间号（白描边文字，不铺白底，避免把墙线和虚线盖住）
    for r in D["rooms"]:
        w, h = r["x2"] - r["x1"], r["y2"] - r["y1"]
        if w < 44 or h < 30:
            continue
        fs = 30 if (w > 110 and h > 70) else 18
        txt = r["id"]
        tw = d.textlength(txt, font=font(fs, True))
        if tw > w - 6:
            fs = max(11, int(fs * (w - 8) / tw))
            tw = d.textlength(txt, font=font(fs, True))
        cx, cy = (r["x1"] + r["x2"]) / 2, (r["y1"] + r["y2"]) / 2
        d.text((cx - tw / 2, cy - fs * 0.62), txt, font=font(fs, True),
               fill=(56, 56, 96), stroke_width=3, stroke_fill=(255, 255, 255))

    return img, d


def annotate(img, d, g, routes):
    # 路径
    for pts, col in routes:
        for i in range(len(pts) - 1):
            w = 9 if i == len(pts) - 2 else 8
            arrow(d, pts[i], pts[i + 1], col, width=w, head=30 if i == len(pts) - 2 else 1)

    # 起点
    sx, sy = 1150, 742
    d.ellipse([sx - 16, sy - 16, sx + 16, sy + 16], fill=(255, 255, 255), outline=(210, 40, 40), width=5)
    d.ellipse([sx - 7, sy - 7, sx + 7, sy + 7], fill=(210, 40, 40))

    # 改动标记
    marks = [
        (1243, 1392, "1", (200, 40, 40)),
        (348, 376, "2", (30, 90, 200)),
    ]
    for x, y, txt, col in marks:
        R = 24
        d.ellipse([x - R, y - R, x + R, y + R], fill=(255, 255, 255), outline=col, width=4)
        tw = d.textlength(txt, font=font(30, True))
        d.text((x - tw / 2, y - 20), txt, font=font(30, True), fill=col)



def legend(img, d, top_y):
    pad = 40
    lines = [
        ("1", (200, 40, 40), "东南角楼梯：门由「朝西」改为「朝南」，正对 301 房间；楼梯口外补一块前室地面（安全出口）"),
        ("2", (30, 90, 200), "西北角楼梯：门由「朝南」改为「朝右（东）」；楼梯东侧补出梯前室，向南接北走廊"),
    ]
    y = top_y
    for num, col, txt in lines:
        d.ellipse([pad, y + 4, pad + 34, y + 38], fill=(255, 255, 255), outline=col, width=4)
        tw = d.textlength(num, font=font(24, True))
        d.text((pad + 17 - tw / 2, y + 8), num, font=font(24, True), fill=col)
        d.text((pad + 50, y + 6), txt, font=font(25), fill=(40, 46, 60))
        y += 42
    y += 6
    for col, txt in [((210, 40, 40), "路径 A：起点 → 东走廊 → 东南楼梯前室 → 301 北门"),
                     ((30, 90, 200), "路径 B：起点 → 北走廊 → 西北楼梯前室 → 楼梯门（朝东）"),
                     ((20, 140, 90), "路径 C：起点 → 北走廊 → 315 北门（315 四周恢复为实墙，只此一门）")]:
        d.line([pad, y + 16, pad + 34, y + 16], fill=col, width=8)
        d.text((pad + 50, y + 3), txt, font=font(25), fill=(40, 46, 60))
        y += 34
    y += 4
    d.line([pad, y + 14, pad + 34, y + 14], fill=C_OPEN, width=7)
    d.text((pad + 50, y + 1), "绿色缺口 + 棕色扇形 = 门洞与门扇（门开在哪面墙）", font=font(25), fill=(40, 46, 60))
    y += 34
    d.line([pad, y + 14, pad + 34, y + 14], fill=C_PER, width=9)
    d.text((pad + 50, y + 1), "深灰粗线 = 最外圈连续外墙；浅青 = 走廊 / 支廊地面", font=font(25), fill=(40, 46, 60))
    return y + 34


def main():
    g = Grid(D)
    r1 = route(g, (1150, 742), (1265, 1532))     # → 301
    r2 = route(g, (1150, 742), (259, 395))       # → 西北楼梯门
    r3 = route(g, (1150, 742), (400, 480))       # → 315 北门
    for nm, r in (("301", r1), ("STAIR-NW", r2), ("315N", r3)):
        print("%-9s %s" % (nm, "OK %d 点" % len(r) if r else "FAIL"))

    img, d = base_plan()
    annotate(img, d, g, [(r1, (210, 40, 40)), (r2, (30, 90, 200)), (r3, (20, 140, 90))])

    # 裁掉上方空白，只在下方留图例位置
    TY, BY = 320, 1792
    plan = img.crop((0, TY, W, BY))
    PW, PH = plan.size

    out = Image.new("RGB", (PW, PH + 420), (255, 255, 255))
    out.paste(plan, (0, 0))
    d2 = ImageDraw.Draw(out)
    legend(out, d2, PH + 20)
    d2.text((40, PH + 378), "第二实验楼 3F　墙体调整与通行路径　（数据源 data/floor-3f.js，比例 26 px = 1 m）",
            font=font(24), fill=(120, 126, 140))
    out.save(os.path.join(NAV, "plan-changes-3f.png"))
    print("wrote plan-changes-3f.png", out.size)

    # 西北特写
    box = (40, 290 - TY, 580, 820 - TY)
    c = plan.crop(box)
    c = c.resize((int(c.width * 2.2), int(c.height * 2.2)), Image.LANCZOS)
    c.save(os.path.join(NAV, "plan-changes-nw.png"))
    print("wrote plan-changes-nw.png", c.size)

    # 东南特写
    box = (1060, 1300 - TY, 1400, 1700 - TY)
    c = plan.crop(box)
    c = c.resize((int(c.width * 2.4), int(c.height * 2.4)), Image.LANCZOS)
    c.save(os.path.join(NAV, "plan-changes-se.png"))
    print("wrote plan-changes-se.png", c.size)


if __name__ == "__main__":
    main()
