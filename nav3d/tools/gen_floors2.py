# -*- coding: utf-8 -*-
"""生成 4 层 / 1 层的楼层数据（data/floor-4f.js、data/floor-1f.js）。

做法与 gen_floors.py 一致：**以 3 层数据为骨架**。

  4 层：与 3 层的房间格位 1:1 对应（顶排 8 / 二排 4 / 西列 3 / 东翼 9 /
        南排 5 + 最底排 6，楼梯 5 部全部对齐），所以直接沿用 3 层的房间
        矩形（x1,y1,x2,y2）与门朝向，只换房号与房名 —— 和 2 层同一套办法。
        楼体核心（走廊 / 支廊 / 楼梯 / 外墙 / 天井 / 玻璃幕墙）原样复制。

  1 层：结构与 3 层不同（南侧被 101 大空间占据、环廊不闭合成环、
        108/109 是北侧两间大房），所以房间、走廊、楼梯全部按
        docs/img/aligned/1f_grid.png（已配准到 3F 坐标系的疏散板照片）
        逐格实测手写；外墙与天井沿用 3 层（同一栋楼同一天井）。

用法：python tools/gen_floors2.py
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
    ("设备", "store"),
    ("配电", "service"),
    ("资料", "room"),
    ("档案", "room"),
    ("值班", "service"),
    ("养护", "room"),
    ("办公室", "office"),
    ("教研室", "office"),
    ("实训室", "lab"),
    ("会议室", "room"),
    ("阅览室", "room"),
    ("空地", "room"),
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
    out = ("/* %s\n   由 tools/gen_floors2.py 生成，不要手改；改完重跑脚本。 */\n"
           "window.FLOOR_DATA_BY_ID = window.FLOOR_DATA_BY_ID || {};\n"
           "%s = %s;\n") % (title, var_expr, body)
    io.open(path, "w", encoding="utf-8").write(out)
    print("wrote %s  (%.1f KB)" % (path, os.path.getsize(path) / 1024.0))


# ---------------------------------------------------------------- 4 层

# (新编号, 新名字, 来源单元格 id, 追加属性)
SPEC_4F = [
    # ---- 顶排（走廊以北，8 间；西北角楼梯沿用 STAIR-NW）
    ("416", "配电间", "316", {}),
    ("417", "工程造价专业负责人", "317", {}),
    ("419", "土建学院科协学生会", "319", {}),
    ("420", "建筑环境与能源应用工程考研室", "320", {}),
    ("422", "土木工程实训中心主任", "322", {}),
    ("423", "建筑环境与能源应用工程专业", "423", {}),
    ("425", "教学秘书办公室", "425", {}),
    ("426", "会议室", "326", {}),
    # ---- 第二排（走廊以南，4 间实验室/教研室）
    ("415", "BIM协会/BIM工作室", "315", {}),
    ("418", "工程造价专业教研室", "318", {}),
    ("421", "工程造价实训室（待建）", "321", {}),
    ("424", "土木工程专业教研室", "324", {}),
    # ---- 西列（3 间，南北向长条）
    ("414", "网络工程实验室（待建）", "314", {}),
    ("413", "WEB技术实验室-2/交通运输实验室-2", "313", {}),
    ("412", "WEB技术实验室-1/交通运输实验室-1", "312", {}),
    # ---- 东翼（9 间）
    ("427", "教学副院长", "327", {}),
    ("428", "阅览室", "328", {}),
    ("432", "行政副院长", "332", {}),
    ("429", "土建学院资料室", "329", {}),
    ("431", "土建学院院长", "331", {}),
    ("430", "学院办公室", "330", {}),
    # 434/435 与 3 层的 334/335 同一处：门开在南边那间大房间（433）里，
    # 属于"套间"，只能先进 433 再进自己那道门
    ("434", "心理咨询室", "334", {"via": "433"}),
    ("435", "团委办公室", "335", {"via": "433"}),
    ("433", "学生工作办公室", "333", {}),
    # ---- 南排上排（5 间）
    ("411", "配电间", "311", {}),
    ("408", "设备间", "308", {}),
    ("407", "移动互联实验室-2", "307", {}),
    ("404", "物联网工程实验室-1", "304", {}),
    ("403", "单片机实验室", "303", {}),
    # ---- 最底排（6 间）
    ("410", "软件工程实验室-2", "310", {}),
    ("409", "软件工程实验室-1", "309", {}),
    ("406", "移动互联实验室-1", "306", {}),
    ("405", "物联网工程实验室-2", "305", {}),
    ("402", "计算机组成原理实验室", "302", {}),
    ("401", "大学生创新中心（计算机学院）", "301", {}),
]


def build_4f(D3):
    by_id = {r["id"]: r for r in D3["rooms"]}
    rooms = []
    for new_id, name, cell, extra in SPEC_4F:
        src = by_id[cell]
        r = dict(src)
        r["id"] = new_id
        r["name"] = name
        r["kind"] = kind_of(name, src.get("kind"))
        r.update(extra)
        rooms.append(r)

    # 楼体核心（楼梯间 / 厕所 / 咨询台）原样保留
    for r in D3["rooms"]:
        if r["kind"] in ("stair", "toilet"):
            rooms.append(dict(r))

    D = {
        "id": "B2-4",
        "name": "4层",
        "building": "第二实验楼",
        "image": "../../assets/floors/B2-4F.jpg",
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
        # 板子上的"当前位置"红点落在东北角楼梯前室西侧
        "startPx": {"x": 1180, "y": 700},
        "startName": "东北角走廊",
    }
    return D


def main():
    D3 = load(SRC)
    D4 = build_4f(D3)
    dump_js('window.FLOOR_DATA_BY_ID["B2-4"]', D4,
            os.path.join(NAV, "data", "floor-4f.js"), "第二实验楼 4 层")
    print("4F rooms=%d" % len(D4["rooms"]))


if __name__ == "__main__":
    main()
