# -*- coding: utf-8 -*-
"""
生成「修正后的平面图」核对图（2D）。

画法严格对齐 3D 场景里的建模逻辑：
  - 房间：按 kind 上淡色填充 + 红线描边 + 房号
  - 走廊：黄绿色半透明填充
  - 楼梯：灰底 + 踏步线
  - 玻璃幕墙：青色粗虚线（不是墙！）
  - 楼体缺口（室外）：深灰填充
  - 门：绿色门洞 + 深棕门扇（绕铰链转 72°，一律朝房间内部开）
  - 洞口方向用橙色小三角标在门洞外侧（走廊一侧）

输出：
  plan-fixed-3f.png        整层（叠在原图上，便于对照）
  plan-fixed-3f-clean.png  白底干净版（去掉原图，只看我们的模型）
  plan-fixed-sw.png        西南角 + 西走廊特写
"""
import io
import json
import math
import os
import re

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
NAV = os.path.dirname(HERE)
ROOT = os.path.dirname(NAV)

SRC = os.path.join(NAV, "data", "floor-3f.js")
BASE = os.path.join(ROOT, "assets", "floors", "B2-3F.jpg")

src = io.open(SRC, encoding="utf-8").read()
D = json.loads(re.search(r"window\.FLOOR_DATA\s*=\s*(\{.*\});\s*$", src, re.S).group(1))

KIND = {
    "lab":     (245, 213, 185),   # BGR
    "office":  (171, 207, 246),
    "room":    (196, 227, 174),
    "store":   (231, 189, 217),
    "service": (227, 213, 203),
    "toilet":  (127, 212, 239),
    "stair":   (179, 179, 242),
}
C_ROOM = (60, 60, 200)
C_COR = (160, 228, 225)
C_GLASS = (235, 200, 60)
C_EXT = (168, 168, 168)
C_DOOR = (70, 60, 32)
C_OPEN = (0, 150, 0)

W, H = D["imageWidth"], D["imageHeight"]
PX = D.get("pxPerMeter", 26.0)
DOOR_OPEN = math.radians(72)


def door_geom(r):
    """返回 (门洞两端点, 铰链点, 门扇终点, 门扇长度, 门洞所在墙)"""
    x1, y1, x2, y2 = r["x1"], r["y1"], r["x2"], r["y2"]
    k = r.get("door", "S")
    t = r.get("doorT", 0.5)
    dw = (r.get("doorW") or 1.05) * PX
    if k in ("N", "S"):
        cx = x1 + (x2 - x1) * t
        cx = min(x2 - dw / 2, max(x1 + dw / 2, cx))
        cy = y1 if k == "N" else y2
        a, b = (cx - dw / 2, cy), (cx + dw / 2, cy)
        hinge = (cx - dw / 2, cy)
        s = -1 if k == "S" else 1
        # N 墙（y=y1）门扇朝 +y（向下=房间内）；S 墙（y=y2）朝 -y（向上=房间内）。
        # 屏幕 y 向下，闭合方向是 +x，所以 N 转 +72°、S 转 -72°。
        ang = DOOR_OPEN if k == "N" else -DOOR_OPEN
        ex = hinge[0] + dw * math.cos(ang)
        ey = hinge[1] - dw * math.sin(ang) * -1
        # 直接用向量推：闭合方向 +x，绕原点转 -ang（屏幕 y 向下）
        ex = hinge[0] + dw * math.cos(ang)
        ey = hinge[1] + dw * math.sin(ang)
    else:
        cy = y1 + (y2 - y1) * t
        cy = min(y2 - dw / 2, max(y1 + dw / 2, cy))
        cx = x1 if k == "W" else x2
        a, b = (cx, cy - dw / 2), (cx, cy + dw / 2)
        hinge = (cx, cy - dw / 2)
        ang = DOOR_OPEN if k == "W" else -DOOR_OPEN
        # 闭合方向 +y（屏幕向下），绕铰链转 ang
        ex = hinge[0] + dw * math.sin(ang)
        ey = hinge[1] + dw * math.cos(ang)
    return a, b, hinge, (ex, ey), dw, k


def draw_leaf(img, r, scale_line=1):
    a, b, hinge, end, dw, k = door_geom(r)
    # 门洞：白底 + 绿框（表示"墙到这里断开"）
    cv2.line(img, tuple(int(v) for v in a), tuple(int(v) for v in b), (255, 255, 255), 9)
    cv2.line(img, tuple(int(v) for v in a), tuple(int(v) for v in b), C_OPEN, 3)
    if r.get("swing") != "in":
        return
    # 门扇
    cv2.line(img, tuple(int(v) for v in hinge), tuple(int(v) for v in end), C_DOOR, 4)
    cv2.circle(img, tuple(int(v) for v in hinge), 4, C_DOOR, -1)
    # 开启弧线
    pts = []
    n = 18
    if k in ("N", "S"):
        # 闭合方向 +x（0°）。N 墙往房间内是 +y → 角度递增；S 墙往房间内是 -y → 角度递减。
        start = 0
        sgn = 1 if k == "N" else -1
        for i in range(n + 1):
            th = start + sgn * (DOOR_OPEN * i / n)
            pts.append((int(hinge[0] + dw * math.cos(th)),
                        int(hinge[1] + dw * math.sin(th))))
    else:
        start = math.pi / 2 if k == "W" else math.pi / 2
        sgn = 1 if k == "W" else -1
        for i in range(n + 1):
            th = start - sgn * (DOOR_OPEN * i / n)
            pts.append((int(hinge[0] + dw * math.cos(th)),
                        int(hinge[1] + dw * math.sin(th))))
    for i in range(len(pts) - 1):
        cv2.line(img, pts[i], pts[i + 1], (150, 120, 90), 2)


def draw_all(base, on_site):
    img = base.copy()
    ov = img.copy()

    for e in D.get("exterior", []):
        cv2.rectangle(ov, (e["x1"], e["y1"]), (e["x2"], e["y2"]), C_EXT, -1)
    for co in D.get("corridors", []):
        cv2.rectangle(ov, (co["x1"], co["y1"]), (co["x2"], co["y2"]), C_COR, -1)
    for sp in D.get("spurs", []):
        cv2.rectangle(ov, (sp["x1"], sp["y1"]), (sp["x2"], sp["y2"]), C_COR, -1)
    for r in D["rooms"]:
        cv2.rectangle(ov, (r["x1"], r["y1"]), (r["x2"], r["y2"]),
                      KIND.get(r["kind"], (200, 200, 200)), -1)

    img = cv2.addWeighted(ov, 0.45 if on_site else 0.75, img, 1 - (0.45 if on_site else 0.75), 0)

    # 楼梯踏步
    for st in D.get("stairs", []):
        y = st["y1"] + st.get("tread", 9)
        while y < st["y2"]:
            cv2.line(img, (st["x1"], y), (st["x2"], y), (150, 150, 150), 1)
            y += st.get("tread", 9)
    for r in D["rooms"]:
        if r["kind"] == "stair":
            n = 9
            for i in range(1, n):
                yy = int(r["y1"] + (r["y2"] - r["y1"]) * i / n)
                cv2.line(img, (r["x1"] + 3, yy), (r["x2"] - 3, yy), (150, 150, 160), 1)

    # 走廊 / 支廊 边线
    for co in D.get("corridors", []) + D.get("spurs", []):
        cv2.rectangle(img, (co["x1"], co["y1"]), (co["x2"], co["y2"]), (60, 150, 145), 1)

    # 房间描边 + 房号
    for r in D["rooms"]:
        cv2.rectangle(img, (r["x1"], r["y1"]), (r["x2"], r["y2"]), C_ROOM, 2)
        cx = (r["x1"] + r["x2"]) // 2
        cy = (r["y1"] + r["y2"]) // 2
        label = r["id"]
        fs = 0.62 if (r["x2"] - r["x1"]) > 90 else 0.42
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, fs, 2)
        cv2.rectangle(img, (cx - tw // 2 - 5, cy - th - 5),
                      (cx + tw // 2 + 5, cy + 8), (255, 255, 255), -1)
        cv2.putText(img, label, (cx - tw // 2, cy + 2),
                    cv2.FONT_HERSHEY_SIMPLEX, fs, (40, 40, 120), 2)

    # 玻璃幕墙（粗虚线 + 浅蓝描边）
    for g in D.get("glassWalls", []):
        p1, p2 = (g["x1"], g["y1"]), (g["x2"], g["y2"])
        L = math.hypot(p2[0] - p1[0], p2[1] - p1[1])
        n = max(1, int(L / 26))
        for i in range(n):
            t0, t1 = i / n, (i + 0.6) / n
            q1 = (int(p1[0] + (p2[0] - p1[0]) * t0), int(p1[1] + (p2[1] - p1[1]) * t0))
            q2 = (int(p1[0] + (p2[0] - p1[0]) * t1), int(p1[1] + (p2[1] - p1[1]) * t1))
            cv2.line(img, q1, q2, C_GLASS, 7)
        cv2.putText(img, "GLASS", (min(p1[0], p2[0]) - 6, (p1[1] + p2[1]) // 2),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (120, 90, 0), 1, cv2.LINE_AA)

    # 门
    for r in D["rooms"]:
        draw_leaf(img, r)

    # 补墙段（带门/窗）与洗手台
    draw_wall_runs(img)
    draw_fixtures(img)

    return img


def draw_wall_runs(img):
    """补墙段（wallRuns）：不属于任何房间的独立墙，可以带门或窗。"""
    for g in D.get("wallRuns", []):
        is_v = g["x1"] == g["x2"]
        if is_v:
            lo, hi = min(g["y1"], g["y2"]), max(g["y1"], g["y2"])
            fixed = g["x1"]
        else:
            lo, hi = min(g["x1"], g["x2"]), max(g["x1"], g["x2"])
            fixed = g["y1"]

        holes = []
        if g.get("door"):
            d = g["door"]
            dw = d.get("w", 1.1) * PX
            c = lo + (hi - lo) * d.get("t", 0.5)
            c = min(hi - dw / 2, max(lo + dw / 2, c))
            holes.append(("door", c - dw / 2, c + dw / 2, d))
        if g.get("win"):
            w = g["win"]
            ww = w.get("w", 2.0) * PX
            c = lo + (hi - lo) * w.get("t", 0.5)
            c = min(hi - ww / 2, max(lo + ww / 2, c))
            holes.append(("win", c - ww / 2, c + ww / 2, w))
        holes.sort(key=lambda h: h[1])

        def seg(u0, u1):
            if u1 - u0 < 1:
                return
            if is_v:
                cv2.line(img, (int(fixed), int(u0)), (int(fixed), int(u1)), C_ROOM, 5)
            else:
                cv2.line(img, (int(u0), int(fixed)), (int(u1), int(fixed)), C_ROOM, 5)

        cur = lo
        for kind, s, t, cfg in holes:
            seg(cur, s)
            if kind == "win":
                # 窗：青色玻璃 + 两端白框
                if is_v:
                    cv2.line(img, (int(fixed), int(s)), (int(fixed), int(t)), C_GLASS, 6)
                else:
                    cv2.line(img, (int(s), int(fixed)), (int(t), int(fixed)), C_GLASS, 6)
            else:
                if is_v:
                    cv2.line(img, (int(fixed), int(s)), (int(fixed), int(t)), C_OPEN, 3)
                else:
                    cv2.line(img, (int(s), int(fixed)), (int(t), int(fixed)), C_OPEN, 3)
                # 门扇：沿墙 u，向 n 转开 72°
                ux, uy = (0, 1) if is_v else (1, 0)
                nx, ny = cfg.get("n", (0, 1) if is_v else (1, 0))
                nl = math.hypot(nx, ny) or 1
                nx, ny = nx / nl, ny / nl
                leaves = 2 if cfg.get("leaf") == 2 else 1
                lw = (t - s) / leaves
                ca, sa = math.cos(DOOR_OPEN), math.sin(DOOR_OPEN)
                for i in range(leaves):
                    hinge = s if i == 0 else t
                    du = 1 if i == 0 else -1
                    hx = fixed if is_v else hinge
                    hy = hinge if is_v else fixed
                    ex = hx + (ux * ca * du + nx * sa) * lw
                    ey = hy + (uy * ca * du + ny * sa) * lw
                    cv2.line(img, (int(hx), int(hy)), (int(ex), int(ey)), C_DOOR, 4)
                    cv2.circle(img, (int(hx), int(hy)), 4, C_DOOR, -1)
            cur = t
        seg(cur, hi)


def draw_fixtures(img):
    """洗手台等固定家具。"""
    for f in D.get("fixtures", []):
        x1, y1, x2, y2 = f["x1"], f["y1"], f["x2"], f["y2"]
        cv2.rectangle(img, (x1, y1), (x2, y2), (210, 216, 226), -1)
        cv2.rectangle(img, (x1, y1), (x2, y2), (150, 160, 175), 1)
        n = f.get("n", 4)
        along_x = (x2 - x1) >= (y2 - y1)
        for k in range(n):
            tt = (k + 0.5) / n
            cx = x1 + (x2 - x1) * tt if along_x else (x1 + x2) // 2
            cy = (y1 + y2) // 2 if along_x else y1 + (y2 - y1) * tt
            cv2.circle(img, (int(cx), int(cy)), 5, (255, 255, 255), -1)
            cv2.circle(img, (int(cx), int(cy)), 5, (150, 160, 175), 1)


def annotate(img, marks):
    for n, (x, y) in enumerate(marks, 1):
        cv2.circle(img, (x, y), 17, (255, 255, 255), -1)
        cv2.circle(img, (x, y), 17, (30, 30, 200), 3)
        cv2.putText(img, str(n), (x - 7, y + 8), cv2.FONT_HERSHEY_SIMPLEX, 0.68, (30, 30, 200), 2)
    return img


LEGEND = [
    "1  south corridor: doors of 307/304/303 moved to the SOUTH wall; all doors open INTO the rooms",
    "2  west corridor now runs THROUGH to the south corridor (passes 312/311); 311/308 re-measured to x352-464",
    "3  west side of that corridor = GLASS curtain wall (not a solid wall / not a staircase)",
    "4  STAIR-SW door moved to its SOUTH side, opening onto the south corridor (was facing north into 312)",
    "5  EAST wing: STAIR-E sits between 332 and 334, its door now faces SOUTH onto the 333 entry aisle;",
    "   333's own door faces WEST on x=1457 - the two doors meet at right angles, exactly as in the site photo.",
    "6  334 / 335 are INNER rooms of 333: their doors cut through 333's north wall (x1546-1565 / x1684-1701),",
    "   so they are reached from inside 333 - matching the site photo taken standing inside 333.",
    "7  NE corner: DESK-NE opens WEST onto a small aisle whose south end is the STAIR-NE door (the EXIT door);",
    "   the aisle's north end meets the north corridor - this is the L-shaped lobby in the photo.",
    "8  EAST toilets (WC-E1 / WC-E2): their doors no longer open onto the corridor. A washroom spur",
    "   (y749-813) now runs between the two WCs; the two doors sit on the spur's two sides, facing each other.",
    "9  The spur's EAST end is the exterior wall -> big window + basin counter. This is where the photo was taken.",
    "10 STAIR-E: the aisle facing it is now CLOSED by a wall (y=1029, x1382-1457); only the stair's own",
    "   double door pierces that wall - it is no longer one wide open gap.",
    "11 The 333 entry aisle's SOUTH end (y=1234, x1380-1457) is now a SOLID wall - no gap, no door, no",
    "   window. Before this fix the aisle ran straight out into empty space past 333's south wall.",
]


def add_legend(img, pad=500):
    h, w = img.shape[:2]
    out = np.full((h + pad, w, 3), 255, np.uint8)
    out[:h] = img
    cv2.line(out, (0, h), (w, h), (200, 205, 215), 2)
    for i, t in enumerate(LEGEND):
        cv2.putText(out, t, (36, h + 46 + i * 36), cv2.FONT_HERSHEY_SIMPLEX,
                    0.68, (40, 48, 66), 2, cv2.LINE_AA)
    return out


def imread_zh(path):
    """cv2.imread 在 Windows 下读不了中文路径，用 fromfile+imdecode 绕过"""
    buf = np.fromfile(path, dtype=np.uint8)
    return cv2.imdecode(buf, cv2.IMREAD_COLOR)


def imwrite_zh(path, img):
    ext = os.path.splitext(path)[1]
    ok, buf = cv2.imencode(ext, img)
    if not ok:
        raise IOError("编码失败：" + path)
    buf.tofile(path)


def main():
    site = imread_zh(BASE)
    if site is None:
        raise SystemExit("读不到底图：" + BASE)
    site = cv2.resize(site, (W, H))

    on_site = draw_all(site, True)
    on_site = annotate(on_site, [
        (985, 1548),    # 1 南侧走廊门向
        (283, 1268),    # 2 西走廊贯通
        (254, 830),     # 3 玻璃幕墙
        (206, 1400),    # 4 楼梯口
        (1455, 1062),   # 5 东楼梯门 + 333 西门（直角相交）
        (1234, 781),    # 6 盥洗室（两厕之间的支廊，门对门）
        (1420, 1024),   # 7 东楼梯正对的走道已封墙
    ])
    cv2.putText(on_site, "3F  corrected plan  (over original)", (30, 345),
                cv2.FONT_HERSHEY_SIMPLEX, 1.0, (30, 30, 160), 2)
    imwrite_zh(os.path.join(NAV, "plan-fixed-3f.png"), add_legend(on_site))

    clean = np.full((H, W, 3), 255, np.uint8)
    clean = draw_all(clean, False)
    imwrite_zh(os.path.join(NAV, "plan-fixed-3f-clean.png"), add_legend(clean))

    # 西南角 + 西走廊特写
    crop = on_site[1180:1620, 0:560]
    crop = cv2.resize(crop, (crop.shape[1] * 3, crop.shape[0] * 3),
                      interpolation=cv2.INTER_LANCZOS4)
    imwrite_zh(os.path.join(NAV, "plan-fixed-sw.png"), crop)

    # 东翼特写：东楼梯 + 333 门厅
    crop2 = on_site[900:1300, 1140:1791]
    crop2 = cv2.resize(crop2, (crop2.shape[1] * 3, crop2.shape[0] * 3),
                       interpolation=cv2.INTER_LANCZOS4)
    imwrite_zh(os.path.join(NAV, "plan-fixed-east.png"), crop2)

    # 东北角特写：学生服务咨询台 + 楼梯间
    crop3 = on_site[420:700, 1080:1400]
    crop3 = cv2.resize(crop3, (crop3.shape[1] * 5, crop3.shape[0] * 5),
                       interpolation=cv2.INTER_LANCZOS4)
    imwrite_zh(os.path.join(NAV, "plan-fixed-ne.png"), crop3)

    # 东侧厕所 + 中间盥洗室特写（拍照位置）
    crop4 = on_site[610:940, 1090:1360]
    crop4 = cv2.resize(crop4, (crop4.shape[1] * 5, crop4.shape[0] * 5),
                       interpolation=cv2.INTER_LANCZOS4)
    imwrite_zh(os.path.join(NAV, "plan-fixed-wc-e.png"), crop4)

    print("plan-fixed-3f.png", on_site.shape)
    print("plan-fixed-3f-clean.png", clean.shape)
    print("plan-fixed-sw.png", crop.shape)
    print("plan-fixed-east.png", crop2.shape)
    print("plan-fixed-ne.png", crop3.shape)
    print("plan-fixed-wc-e.png", crop4.shape)


if __name__ == "__main__":
    main()
