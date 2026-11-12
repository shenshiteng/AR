# -*- coding: utf-8 -*-
"""修正 328/332/334/335 排、329/331 排、333 的排布关系
   核心：这两排之间必须留出横向支廊（y 1029..1096），333 的门开在支廊东端。
"""
import io, re, json

P = "data/floor-3f.js"
s = io.open(P, encoding="utf-8").read()
m = re.search(r"window\.FLOOR_DATA\s*=\s*(\{.*\});", s, re.S)
D = json.loads(m.group(1))

# id -> (x1,y1,x2,y2, door, doorT)
FIX = {
    # ---- 上排：底边收到 1029，把下方让给支廊 ----
    "327":  (1180,  876, 1372,  944, "W", None),
    "328":  (1180,  944, 1284, 1029, "W", None),
    "332":  (1284,  944, 1372, 1029, "W", None),
    "334":  (1420,  950, 1540, 1029, "S", None),
    "335":  (1540,  950, 1740, 1029, "S", None),
    # ---- 下排：顶边降到底 1096，支廊就有 1029..1096 这段宽度 ----
    "329":  (1180, 1096, 1284, 1236, "W", None),
    "331":  (1284, 1096, 1372, 1236, "W", None),
    # ---- 330 与东楼梯：整体下移，让出 1096..1236 给上面的会议室 ----
    "330":  (1180, 1236, 1372, 1352, "W", None),
    "STAIR-E": (1180, 1352, 1330, 1478, "W", None),
    # ---- 333：北边贴着支廊，门开在左墙上部，正对支廊东端开口 ----
    "333":  (1420, 1029, 1740, 1236, "W", 0.16),
}

NAME_FIX = {
    "333": "绿色成型及精密模具工程技术研究中心",
}

for r in D["rooms"]:
    if r["id"] in FIX:
        x1, y1, x2, y2, door, dt = FIX[r["id"]]
        r["x1"], r["y1"], r["x2"], r["y2"] = x1, y1, x2, y2
        r["door"] = door
        if dt is not None:
            r["doorT"] = dt
        elif "doorT" in r:
            del r["doorT"]
        if r["id"] in NAME_FIX:
            r["name"] = NAME_FIX[r["id"]]

# 支廊显式登记，供页面配色/校验用
D["spurs"] = [
    {"id": "SPUR-E-1", "name": "东侧横向支廊", "x1": 1180, "y1": 1029, "x2": 1420, "y2": 1096},
    {"id": "SPUR-E-2", "name": "东侧竖向支廊", "x1": 1372, "y1": 1029, "x2": 1420, "y2": 1236},
]

head = "// 第二实验楼 3F —— 房间数据（坐标均为平面图像素，原点左上）\n"
head += "// x1,y1 = 左上角；x2,y2 = 右下角；door = 门所朝方向；doorT = 门在墙上位置(0~1，缺省居中)\n"
js = head + "window.FLOOR_DATA = " + json.dumps(D, ensure_ascii=False, indent=2) + ";\n"
io.open(P, "w", encoding="utf-8").write(js)

print("已修正 %d 个房间，登记 %d 条支廊" % (len(FIX), len(D["spurs"])))
for r in D["rooms"]:
    if r["id"] in FIX:
        print("  %-9s %5d %5d %5d %5d  door=%s%s" % (
            r["id"], r["x1"], r["y1"], r["x2"], r["y2"], r["door"],
            ("  doorT=%.2f" % r["doorT"]) if "doorT" in r else ""))
