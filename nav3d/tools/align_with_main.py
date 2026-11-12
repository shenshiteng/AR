# -*- coding: utf-8 -*-
"""按主数据 data/labs.js 的 3F 清单，对齐 nav3d 的房间几何/名称/类型。

主数据坐标是 1540x1560 的示意坐标系，不能直接换算，所以：
- 几何：用原图实测值（本轮已重测 332|STAIR-E|334|335 与 331|333 的分界）
- 名称/类型：直接照抄主数据，保证两个系统对得上
"""
import io, re, json

P = "data/floor-3f.js"
s = io.open(P, encoding="utf-8").read()
D = json.loads(re.search(r"window\.FLOOR_DATA\s*=\s*(\{.*\})\s*;", s, re.S).group(1))

rooms = {r["id"]: r for r in D["rooms"]}

# ---------- 1. 几何修正（原图实测） ----------
GEOM = {
    # 332 右界 1382；1382..1540 是东楼梯间；334=1540..1674；335=1674..1760
    "332":  dict(x1=1284, y1=944,  x2=1382, y2=1029),
    "334":  dict(x1=1540, y1=950,  x2=1674, y2=1029),
    "335":  dict(x1=1674, y1=950,  x2=1760, y2=1029),
    # 331 右界 = 1380 = 333 左界（两者之间没有走道，支廊到此为止）
    "331":  dict(x1=1284, y1=1096, x2=1382, y2=1236),
    "333":  dict(x1=1380, y1=1029, x2=1740, y2=1236),
    # 330 / 东南楼梯
    "330":  dict(x1=1180, y1=1236, x2=1282, y2=1352),
}

# 原来的 STAIR-E 实际是 330 下方的东南楼梯 → 改名 STAIR-SE
old_stair_e = rooms["STAIR-E"]
stair_se = {
    "id": "STAIR-SE", "name": "楼梯间（东南角）", "kind": "stair",
    "x1": 1180, "y1": 1352, "x2": 1282, "y2": 1478, "door": "W"
}
# 补上真正的东侧楼梯间（332 右侧、334 左侧）
stair_e = {
    "id": "STAIR-E", "name": "楼梯间（东侧·334旁）", "kind": "stair",
    "x1": 1382, "y1": 950, "x2": 1540, "y2": 1029, "door": "S"
}

# ---------- 2. 名称 / 类型 照抄主数据 ----------
ALIGN = {
    "301": dict(name="液压传动实验室（待建）"),
    "302": dict(name="微型原理及接口技术实验室（待建）"),
    "306": dict(name="工程技术训练中心-1", kind="lab"),
    "307": dict(name="空地（大厅）"),
    "309": dict(name="工程技术训练中心-2", kind="lab"),
    "310": dict(name="ET机器人工作室", kind="lab"),
    "314": dict(name="机械创新实践中心（待建）", kind="lab"),
    "315": dict(name="机械学院直属党支部党员活动室", kind="room"),
    "317": dict(name="档案资料室", kind="room"),
    "318": dict(name="机械测试技术实验室（待建）"),
    "319": dict(name="心理健康工作室", kind="room"),
    "330": dict(name="行政副院长办公室"),
    "331": dict(name="机械学院院长办公室"),
    "332": dict(name="教学副院长办公室"),
    "334": dict(name="材料专业教研室", kind="office"),
    "335": dict(name="材料专业负责人办公室"),
    "423": dict(name="团委学工办工作室-2"),
    "425": dict(name="团委学工办工作室-1"),
    "STAIR-NW": dict(name="楼梯间（西北角）"),
    "STAIR-NE": dict(name="楼梯间（东北角·324旁）"),
    "STAIR-SW": dict(name="楼梯间（西南角）"),
    "WC-N1": dict(name="男厕（西北）"),
    "WC-N2": dict(name="女厕（西北）"),
    "WC-S1": dict(name="女厕（西南）"),
    "WC-S2": dict(name="男厕（西南）"),
    "WC-E1": dict(name="女厕（东）"),
    "WC-E2": dict(name="男厕（东）"),
}

for rid, patch in GEOM.items():
    if rid in rooms:
        rooms[rid].update(patch)
for rid, patch in ALIGN.items():
    if rid in rooms:
        rooms[rid].update(patch)

# 楼梯改名：原 STAIR-E 记录 → STAIR-SE
for i, r in enumerate(D["rooms"]):
    if r["id"] == "STAIR-E":
        D["rooms"][i] = stair_se
        break
# 插入新的 STAIR-E（放在 333 之后）
idx = next((i for i, r in enumerate(D["rooms"]) if r["id"] == "333"), len(D["rooms"]) - 1)
D["rooms"].insert(idx + 1, stair_e)

# ---------- 3. 支廊：只有一条横向的，东端到 333 左墙 ----------
D["spurs"] = [
    {"id": "SPUR-E-1", "name": "东侧横向支廊",
     "x1": 1180, "y1": 1029, "x2": 1380, "y2": 1096}
]

# ---------- 4. 记录楼层清单（照主数据三层） ----------
D["levelInfo"] = {
    "site": "第二实验楼 · 2层/3层/5层",
    "floors": [
        {"id": "B2-5", "label": "5F", "name": "5层", "ready": False,
         "theme": "电子学院大学生创新中心 · 智能车跑道"},
        {"id": "B2-3", "label": "3F", "name": "3层", "ready": True,
         "theme": "机械工程实验教学 + 学院党政办公/学生工作"},
        {"id": "B2-2", "label": "2F", "name": "2层", "ready": False,
         "theme": "电气/热工/力学实验室 + 学院行政办公"}
    ]
}

head  = "// 第二实验楼 3F —— 房间数据（坐标均为平面图像素，原点左上）\n"
head += "// x1,y1 = 左上角；x2,y2 = 右下角；door = 门所朝方向；doorT = 门在墙上位置(0~1，缺省居中)\n"
io.open(P, "w", encoding="utf-8").write(head + "window.FLOOR_DATA = " + json.dumps(D, ensure_ascii=False, indent=2) + ";\n")

print("房间数 =", len(D["rooms"]))
for r in D["rooms"]:
    if r["id"] in ("330","331","332","333","334","335","STAIR-E","STAIR-SE"):
        print("  %-9s %5d %5d %5d %5d  %-8s %s" % (r["id"], r["x1"], r["y1"], r["x2"], r["y2"], r["kind"], r["name"]))
