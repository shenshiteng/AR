# -*- coding: utf-8 -*-
"""门窗核对图：把门洞位置、门扇开启方向、窗户位置画回原平面图

绿色粗线 = 门洞（开在朝走廊的那面墙）
深蓝粗线 = 门扇（从铰链转开 72°，指向房间内部 = 窗户一侧）
蓝色粗线 = 窗户（门的对面墙）
"""
import cv2, io, re, json, math

D = json.loads(re.search(r"window\.FLOOR_DATA\s*=\s*(\{.*\});",
                         io.open("data/floor-3f.js", encoding="utf-8").read(), re.S).group(1))

TARGET = ["314", "313", "312", "307", "304", "303", "322"]
img = cv2.imread("../assets/floors/B2-3F.jpg")
vis = img.copy()

# ---- 走廊 / 楼梯 / 实体 ----
for co in D.get("corridors", []):
    cv2.rectangle(vis, (co["x1"], co["y1"]), (co["x2"], co["y2"]), (225, 228, 160), -1)
for st in D.get("stairs", []):
    x1, y1, x2, y2 = st["x1"], st["y1"], st["x2"], st["y2"]
    cv2.rectangle(vis, (x1, y1), (x2, y2), (218, 218, 218), -1)
    tp = st.get("tread", 10)
    y = y1 + tp
    while y < y2:
        cv2.line(vis, (x1, y), (x2, y), (155, 155, 155), 1)
        y += tp
    cv2.rectangle(vis, (x1, y1), (x2, y2), (120, 120, 120), 2)
for so in D.get("solids", []):
    if so["kind"] == "block":
        cv2.rectangle(vis, (so["x1"], so["y1"]), (so["x2"], so["y2"]), (135, 135, 135), -1)
    else:
        cv2.rectangle(vis, (so["x1"], so["y1"]), (so["x2"], so["y2"]), (50, 50, 50), -1)

rooms = {r["id"]: r for r in D["rooms"]}
OPP = {"N": "S", "S": "N", "W": "E", "E": "W"}
L = 24          # 门洞宽（像素）≈ 0.92m

for rid in TARGET:
    r = rooms[rid]
    x1, y1, x2, y2 = r["x1"], r["y1"], r["x2"], r["y2"]
    k = r["door"]
    t = r.get("doorT", 0.5)

    if k in ("N", "S"):
        cx = x1 + (x2 - x1) * t
        cy = y1 if k == "N" else y2
    else:
        cy = y1 + (y2 - y1) * t
        cx = x1 if k == "W" else x2

    # 门洞（绿）
    if k in ("N", "S"):
        cv2.line(vis, (int(cx - L/2), int(cy)), (int(cx + L/2), int(cy)), (0, 200, 0), 7)
    else:
        cv2.line(vis, (int(cx), int(cy - L/2)), (int(cx), int(cy + L/2)), (0, 200, 0), 7)

    # 门扇：铰链在门洞较小端，向房间内部转 72°
    if k in ("W", "E"):
        hx, hy = cx, cy - L/2
        th = math.radians(72) * (-1 if k == "W" else 1)
        ex, ey = hx - L*math.sin(th), hy + L*math.cos(th)
    else:
        hx, hy = cx - L/2, cy
        th = math.radians(72) * (1 if k == "N" else -1)
        ex, ey = hx + L*math.cos(th), hy + L*math.sin(th)
    cv2.line(vis, (int(hx), int(hy)), (int(ex), int(ey)), (120, 60, 20), 6)
    cv2.circle(vis, (int(hx), int(hy)), 4, (120, 60, 20), -1)

    # 窗户（蓝）：门的对面墙
    op = OPP[k]
    if op in ("N", "S"):
        wy = y1 if op == "N" else y2
        wl = (x2 - x1) * 0.6
        cv2.line(vis, (int((x1+x2)/2 - wl/2), int(wy)),
                      (int((x1+x2)/2 + wl/2), int(wy)), (230, 150, 40), 7)
    else:
        wx = x1 if op == "W" else x2
        wl = (y2 - y1) * 0.6
        cv2.line(vis, (int(wx), int((y1+y2)/2 - wl/2)),
                      (int(wx), int((y1+y2)/2 + wl/2)), (230, 150, 40), 7)

    cv2.rectangle(vis, (x1, y1), (x2, y2), (0, 0, 210), 2)
    cv2.putText(vis, rid, (x1 + 6, y1 + 24), cv2.FONT_HERSHEY_SIMPLEX, 0.66, (0, 0, 210), 2)

# 左列（314/313/312 + 西侧走廊 + 楼梯）
crop = vis[590:1400, 40:560]
crop = cv2.resize(crop, (int(crop.shape[1]*1.85), int(crop.shape[0]*1.85)), interpolation=cv2.INTER_LANCZOS4)
cv2.imwrite("check-doors-west.png", crop)
print("check-doors-west.png", crop.shape)

# 底排 307/304/303 与 322
crop2 = vis[330:1560, 700:1180]
crop2 = cv2.resize(crop2, (int(crop2.shape[1]*1.6), int(crop2.shape[0]*1.6)), interpolation=cv2.INTER_LANCZOS4)
cv2.imwrite("check-doors-south.png", crop2)
print("check-doors-south.png", crop2.shape)
