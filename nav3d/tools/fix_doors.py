# -*- coding: utf-8 -*-
"""修正门窗朝向/位置 + 补西侧走廊与楼梯布局

依据（原图 B2-3F.jpg 实测，Lab a 通道红掩膜：）
- 走廊西墙 x=254，房间西墙 x=308  → 西侧走廊宽 54px ≈ 2.1m
- 314/313/312 的门洞（沿 x=308 扫描的缺口）：
    314: y 864..888   313: y 901..921   312: y 1120..1145
- 底排 307/304/303 北墙 y=1358（走廊在北），322 南墙 y=441（走廊在南）

修正内容：
1. 314/313/312 的 door 由 E（朝中庭）改为 W（朝走廊）—— 原来门开反了
2. 全部改为内开：swing="in"，门扇朝房间内部（即窗户一侧）转
3. 加 win=True，窗户在 door 的对面墙
4. 新增 corridors（西侧走廊）、stairs（西侧楼梯）、solids（楼梯西侧墙体）
"""
import io, re, json

P = "data/floor-3f.js"
s = io.open(P, encoding="utf-8").read()
D = json.loads(re.search(r"window\.FLOOR_DATA\s*=\s*(\{.*\});", s, re.S).group(1))

rooms = {r["id"]: r for r in D["rooms"]}

# ---------- 0. 几何修正：314 顶边实测 648（原 680 偏了 32px，与 315 共用一道墙） ----------
rooms["314"]["y1"] = 648
rooms["315"]["y2"] = 648

# ---------- 1. 门朝向与位置 ----------
# door = 门洞所在的墙（一律朝走廊）；doorT = 门洞在墙上位置 0~1；swing = 内开
DOOR_FIX = {
    # 左列：走廊在西，门开西墙；门位按实测缺口
    "314": dict(door="W", doorT=0.92),   # y864..888 → 中心 876（房间 648..895）
    "313": dict(door="W", doorT=0.07),   # y901..921 → 中心 911
    "312": dict(door="W", doorT=0.07),   # y1120..1145 → 中心 1132
    # 底排：走廊在北，门开北墙（原本就对，只加内开与窗）
    "307": dict(door="N"),
    "304": dict(door="N"),
    "303": dict(door="N"),
    # 顶排 322：走廊在南，门开南墙（原本就对）
    "322": dict(door="S"),
}

for rid, patch in DOOR_FIX.items():
    r = rooms[rid]
    r.update(patch)
    r["swing"] = "in"      # 门扇朝房间内部转，不朝走廊
    r["win"] = True        # 对面墙开窗（= 房间内部 / 采光侧）
    r["doorW"] = 0.95      # 实测 21~26px ≈ 0.81~1.0m

# ---------- 2. 西侧走廊 / 楼梯 / 墙 ----------
# 走廊：x254..308 贯穿 y648..1362（原图走廊西墙 x=254、房间西墙 x=308）
D["corridors"] = [
    {"id": "COR-W", "name": "西侧走廊", "x1": 254, "y1": 648, "x2": 308, "y2": 1362}
]

# 楼梯：走廊左侧（x130..254），踏步沿 y 排列，占 314 这一段的长度
D["stairs"] = [
    {"id": "ST-W", "name": "西侧楼梯间", "x1": 130, "y1": 660, "x2": 254, "y2": 1000,
     "tread": 9, "dir": "NS"}
]

# 楼梯再往左是一片墙：x=130 一道南北向墙，墙以西是实体（不通行）
D["solids"] = [
    {"id": "WALL-W", "kind": "wall", "x1": 122, "y1": 648, "x2": 138, "y2": 1362},
    {"id": "SOLID-W", "kind": "block", "x1": 16, "y1": 648, "x2": 122, "y2": 1362}
]

head  = "// 第二实验楼 3F —— 房间数据（坐标均为平面图像素，原点左上）\n"
head += "// x1,y1=左上; x2,y2=右下; door=门洞所在墙(N/S/E/W，朝走廊); doorT=门在墙上位置0~1;\n"
head += "// swing=门扇开启方向(in=朝房间内部/窗户侧); win=对面墙有窗; doorW=门洞宽(米)\n"
io.open(P, "w", encoding="utf-8").write(
    head + "window.FLOOR_DATA = " + json.dumps(D, ensure_ascii=False, indent=2) + ";\n")

print("已修正房间:", ", ".join(DOOR_FIX.keys()))
for rid in ("314", "313", "312", "307", "304", "303", "322"):
    r = rooms[rid]
    print("  %-4s x=%d..%d y=%d..%d  door=%s t=%s swing=%s win=%s" % (
        r["id"], r["x1"], r["x2"], r["y1"], r["y2"], r["door"],
        r.get("doorT", "中心"), r["swing"], r["win"]))
print("走廊:", D["corridors"])
print("楼梯:", D["stairs"])
print("墙体:", D["solids"])
