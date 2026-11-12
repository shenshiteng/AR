# -*- coding: utf-8 -*-
"""生成 2 层 / 5 层的楼层数据（data/floor-2f.js、data/floor-5f.js）。

做法：**以 3 层数据为骨架**。
  2、3、5 层是同一栋楼：楼梯间、厕所、走廊、天井、玻璃幕墙、外轮廓这些"楼体核心"
  每层都一样，只有房间分隔和房名不同。所以直接从 floor-3f.js 里复制楼体核心
  （corridors / spurs / stairs / perimeter / atrium / glassWalls / exterior / wallRuns），
  只重新排房间 —— 这样三层叠在一起墙线是对齐的，风格也天然一致。

  2 层：整层环廊，房间沿用 3 层的单元格（cells），逐个改名/改号。
  5 层：只占北翼（北排 508/507/504/503/501 + 南排 510/509/506/505/502），
        南边没有楼板，所以外轮廓只有北翼那一个矩形，也没有天井。

用法：python tools/gen_floors.py
"""
import io
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
NAV = os.path.dirname(HERE)
SRC = os.path.join(NAV, "data", "floor-3f.js")

KIND_BY_NAME = [
    ("厕", "toilet"),
    ("楼梯", "stair"),
    ("仓库", "store"),
    ("储物", "store"),
    ("配电", "service"),
    ("设备", "store"),
    ("资料", "room"),
    ("档案", "room"),
    ("空地", "room"),
    ("办公室", "office"),
    ("教研室", "office"),
    ("实验室", "lab"),
    ("中心", "lab"),
]


def load(path):
    s = io.open(path, encoding="utf-8").read()
    s = s[s.index("{"):].rstrip().rstrip(";")
    return json.loads(s)


def kind_of(name, default="room"):
    for key, k in KIND_BY_NAME:
        if key in name:
            return k
    return default


def dump_js(var_expr, D, path, title):
    body = json.dumps(D, ensure_ascii=False, indent=2)
    out = ("/* %s\n   由 tools/gen_floors.py 生成，不要手改；改完重跑脚本。 */\n"
           "window.FLOOR_DATA_BY_ID = window.FLOOR_DATA_BY_ID || {};\n"
           "%s = %s;\n") % (title, var_expr, body)
    io.open(path, "w", encoding="utf-8").write(out)
    print("wrote %s  (%.1f KB)" % (path, os.path.getsize(path) / 1024.0))


# ---------------------------------------------------------------- 2 层

def build_2f(D3):
    """2 层：沿用 3 层的房间单元格，只换编号/房名。

    每一项 = (新编号, 新名字, 来源单元格 id, 追加属性)
    追加属性用来处理"两格并一间"或"改开门方向"。
    """
    spec = [
        # 北排（走廊以北，8 间）
        ("216", "配电间", "316", {}),
        ("217", "学工仓库", "317", {}),
        ("219", "学工仓库", "319", {}),
        ("221", "空地", "320", {}),
        ("222", "能源专业教研室", "322", {}),
        ("224", "车辆专业教研室", "423", {}),
        ("225", "大学生创新中心", "425", {}),
        ("226", "机械专业教研室", "326", {}),
        # 北二排（走廊以南，4 间，实验室）
        ("215", "测量学实验室", "315", {}),
        ("218", "工程地质实验室", "318", {}),
        ("220", "工程结构实验室-2", "321", {}),
        ("223", "力学结构实验室-2", "324", {}),
        # 西翼（3 间）
        ("214", "热工综合实验室-3", "314", {}),
        ("213", "热工综合实验室-2", "313", {}),
        ("212", "流体力学实验室", "312", {}),
        # 南侧上排（311/308 两小间 + 3 间大房间）
        ("211", "配电间", "311", {}),
        ("208", "储物间", "308", {}),
        ("207", "空地", "307", {}),
        ("204", "电工技术实验室（待建）", "304", {}),
        ("203", "焊接实验室", "303", {}),
        # 南侧下排（6 间）
        ("210", "自动控制实验室（待建）", "310", {}),
        ("209", "工厂供电实验室（待建）", "309", {}),
        ("206", "电力电子技术实验室", "306", {}),
        ("205", "电机技术实验室", "305", {}),
        ("202", "电工技术实验室", "302", {}),
        ("201", "大学生创新中心（电子学院）", "301", {}),
        # 东翼（9 间）
        ("227", "机械专业负责人办公室", "DESK-NE", {}),
        ("228", "土木宣传资料室", "327", {}),
        ("232", "机械实验员办公室", "332", {}),
        ("229", "机械学院档案室", "328", {}),
        ("231", "机械学院机械办公室", "331", {}),
        # 329 + 330 竖向合并成一间（土建学院实验教师办公室）
        ("230", "土建学院实验教师办公室", "329", {"y2": 1352}),
        # 234/235 与 3 层的 334/335 同一处：门开在南边那间大房间（233）里，
        # 属于"套间"，只能先进 233 再进自己那道门
        ("234", "材料设备室", "334", {"via": "233"}),
        ("235", "资料室", "335", {"via": "233"}),
        ("233", "电力系统实验室", "333", {}),
    ]
    core = [r for r in D3["rooms"] if r["kind"] in ("stair", "toilet")]
    by_id = {}
    for r in D3["rooms"]:
        by_id[r["id"]] = r

    rooms = []
    used = set()
    for new_id, name, cell, extra in spec:
        src = by_id[cell]
        r = dict(src)
        r["id"] = new_id
        r["name"] = name
        r["kind"] = kind_of(name, src.get("kind"))
        r.pop("via", None)
        r.update(extra)
        rooms.append(r)
        used.add(cell)

    # 楼体核心（楼梯间 / 厕所）原样保留
    for r in core:
        rooms.append(dict(r))

    # 2 层门禁数据不需要（3 层没有），这里保持干净
    D = {
        "id": "B2-2",
        "name": "2层",
        "building": "第二实验楼",
        "image": "../../assets/floors/B2-2F.jpg",
        "imageWidth": D3["imageWidth"],
        "imageHeight": D3["imageHeight"],
        "pxPerMeter": D3["pxPerMeter"],
        "originPx": D3["originPx"],
        "bounds": D3["bounds"],
        "wallHeight": D3["wallHeight"],
        "atrium": D3["atrium"],
        "rooms": rooms,
        "spurs": D3["spurs"],
        "corridors": D3["corridors"],
        "wallRuns": D3["wallRuns"],
        "fixtures": D3["fixtures"],
        "glassWalls": D3["glassWalls"],
        "perimeter": D3["perimeter"],
        "perimeterHoles": D3["perimeterHoles"],
        "stairs": D3["stairs"],
        "exterior": D3["exterior"],
    }
    return D


# ---------------------------------------------------------------- 5 层

def room(rid, name, kind, x1, y1, x2, y2, door, t=0.5, w=1.05, swing="in"):
    return {
        "id": rid, "name": name, "kind": kind,
        "x1": x1, "y1": y1, "x2": x2, "y2": y2,
        "door": door, "doorT": t, "doorW": w, "swing": swing,
    }


def build_5f(D3):
    """5 层只占北翼，按 B2-5F 疏散板【逐格实测】重排（2026-11-11）。

    板子实测（照片像素）：北外墙 y846 / 厕所南墙 y935 / 北排南墙 y990 /
    走廊南墙 y1036 / 南外墙 y1180；东西外墙 x175、x1341。

      北排（y846-990）：女厕 → 男厕 → 西楼梯 → 508 → 507 → 504 → 503 → 前室 → 东楼梯
      走廊  （y935/990-1036）
      南排（y1036-1180）：510 → 509 → 506 → 505 → 502 → 501

    ★ 三层那套"楼体核心整段复制"在 5 层是错的（三层厕所/楼梯在南边、门朝北；
      五层厕所贴西外墙、楼梯在厕所东侧、门全朝南）。所以这里楼梯、厕所一律手写，
      不再 by_id 抄。行深沿用三层的 361-442 / 442-495 / 495-658，与上下层对齐；
      只按板子比例重分 x，南北两排共用同一套分格线。
    """
    rooms = [
        # ---- 北排：最西是两间厕所（贴西外墙），楼梯在厕所东侧、不贴墙
        {"id": "WC-N1", "name": "女厕（西北，贴西外墙）", "kind": "toilet",
         "x1": 102, "y1": 361, "x2": 190, "y2": 442,
         "door": "S", "doorT": 0.38, "doorW": 0.9, "swing": "out", "hinge": "lo"},
        {"id": "WC-N2", "name": "男厕（西北，女厕东侧）", "kind": "toilet",
         "x1": 190, "y1": 361, "x2": 251, "y2": 442,
         "door": "S", "doorT": 0.55, "doorW": 0.9, "swing": "out", "hinge": "hi"},
        {"id": "STAIR-NW", "name": "西北楼梯（五楼，双跑·门朝南出走廊）", "kind": "stair",
         "x1": 251, "y1": 361, "x2": 321, "y2": 442,
         "door": "S", "doorT": 0.5, "doorW": 1.2, "swing": "out", "leaf": 2},
        # 508 只标了"使用空间"，507/504/503 板上无房名，统一按创新实验室编号
        room("508", "使用空间（508）", "room", 321, 361, 531, 442, "S"),
        room("507", "创新实验室-1", "lab", 531, 361, 743, 442, "S"),
        room("504", "创新实验室-2", "lab", 743, 361, 953, 442, "S"),
        room("503", "创新实验室-3", "lab", 953, 361, 1171, 442, "S"),
        # ---- 北排东端：前室 + 东楼梯（五楼楼梯，门朝南，正对下方 501）
        {"id": "STAIR-NE", "name": "东楼梯（五楼，双跑·门朝南正对 501）", "kind": "stair",
         "x1": 1253, "y1": 361, "x2": 1320, "y2": 442,
         "door": "S", "doorT": 0.5, "doorW": 1.2, "swing": "out", "leaf": 2},
        # ---- 南排：510 → 509 → 506 → 505 → 502 → 501（502、501 并排占东南角）
        room("510", "软件实验室", "lab", 102, 495, 321, 658, "N"),
        room("509", "综合实验室", "lab", 321, 495, 531, 658, "N"),
        room("506", "实践实验室", "lab", 531, 495, 743, 658, "N"),
        room("505", "中心实验室", "lab", 743, 495, 953, 658, "N"),
        room("502", "智能车跑道（电子学院大学生创新中心）", "lab", 953, 495, 1171, 658, "N", 0.5, 1.1),
        room("501", "大学生创新中心（电子学院）", "lab", 1171, 495, 1320, 658, "N", 0.5, 1.2),
    ]

    # 走廊贯通整层（x102-1320）；东端另有一段前室凹进去，单独当支廊
    corridors = [
        {"id": "COR-N", "name": "北侧东西向主廊（贯通整层）", "x1": 102, "y1": 442, "x2": 1320, "y2": 495},
    ]
    spurs = [
        {"id": "SPUR-NE-VEST", "name": "东楼梯前室（503 与东楼梯之间，南接北走廊）",
         "x1": 1171, "y1": 361, "x2": 1253, "y2": 442},
    ]
    stairs = [
        {"id": "ST-NW5", "name": "西北楼梯（五楼，双跑）", "x1": 251, "y1": 361,
         "x2": 321, "y2": 442, "tread": 5, "dir": "NS"},
        {"id": "ST-NE5", "name": "东楼梯（五楼，双跑·501 正上方）", "x1": 1253, "y1": 361,
         "x2": 1320, "y2": 442, "tread": 5, "dir": "NS"},
    ]
    perimeter = [
        {"x1": 102, "y1": 361, "x2": 1320, "y2": 361},
        {"x1": 1320, "y1": 361, "x2": 1320, "y2": 658},
        {"x1": 1320, "y1": 658, "x2": 102, "y2": 658},
        {"x1": 102, "y1": 658, "x2": 102, "y2": 361},
    ]
    D = {
        "id": "B2-5",
        "name": "5层",
        "building": "第二实验楼",
        "image": "../../assets/floors/B2-5F.jpg",
        "imageWidth": D3["imageWidth"],
        "imageHeight": D3["imageHeight"],
        "pxPerMeter": D3["pxPerMeter"],
        "originPx": D3["originPx"],
        "bounds": {"x1": 102, "y1": 361, "x2": 1320, "y2": 658},
        "wallHeight": D3["wallHeight"],
        "rooms": rooms,
        "spurs": spurs,
        "corridors": corridors,
        "wallRuns": [],
        "fixtures": [],
        "glassWalls": [],
        "perimeter": perimeter,
        "perimeterHoles": [],
        "stairs": stairs,
        "exterior": [],
        # 板子上的"当前位置"红点落在北走廊
        "startPx": {"x": 600, "y": 468},
        "startName": "北走廊",
    }
    return D


def main():
    D3 = load(SRC)
    D2 = build_2f(D3)
    D5 = build_5f(D3)
    dump_js('window.FLOOR_DATA_BY_ID["B2-2"]', D2,
            os.path.join(NAV, "data", "floor-2f.js"), "第二实验楼 2 层")
    dump_js('window.FLOOR_DATA_BY_ID["B2-5"]', D5,
            os.path.join(NAV, "data", "floor-5f.js"), "第二实验楼 5 层")
    # 顺带把 3 层也登记进注册表（页面按 id 取楼层）
    print("2F rooms=%d  5F rooms=%d" % (len(D2["rooms"]), len(D5["rooms"])))


if __name__ == "__main__":
    main()
