#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""导出平面图/数字地图的全部坐标数据（机器可读）

输入：
  data/labs.js            人工标注的楼层数据（房间、节点、边、台账）
  assets/floors/B2-3F.jpg 源图（坐标系基准）
  assets/floors/B2-3F_map.png 自动生成的数字地图（红=墙）

输出：
  assets/floors/B2-3F_data.json  全部坐标 + 元信息 + 来源说明
  assets/floors/B2-3F_rooms.csv  房间矩形
  assets/floors/B2-3F_nodes.csv  路网节点
  assets/floors/B2-3F_edges.csv  路网边（含精确长度）
  assets/floors/B2-3F_walls.csv  墙体矩形分解

所有数值均保留原值，不做四舍五入（浮点只按 IEEE754 双精度原样输出）。
"""
import csv
import json
import math
import os
from fractions import Fraction

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_IMG = os.path.join(ROOT, "assets", "floors", "B2-3F.jpg")
MAP_PNG = os.path.join(ROOT, "assets", "floors", "B2-3F_map.png")
LABS_JS = os.path.join(ROOT, "data", "labs.js")


def load_labs():
    s = open(LABS_JS, encoding="utf-8").read()
    i = s.index("{")
    j = s.rindex("}")
    return json.loads(s[i:j + 1])


def wall_rectangles(path):
    """把红色墙像素做行游程 -> 纵向合并，得到轴对齐矩形列表"""
    im = Image.open(path).convert("RGB")
    W, H = im.size
    px = im.load()
    mask = bytearray(W * H)
    for y in range(H):
        base = y * W
        for x in range(W):
            r, g, b = px[x, y]
            if r > 150 and g < 90 and b < 90:
                mask[base + x] = 1

    rects = []
    active = {}          # (x0,x1) -> [y_start, y_end]
    order = []
    for y in range(H):
        base = y * W
        runs = []
        x = 0
        while x < W:
            if mask[base + x]:
                s = x
                while x < W and mask[base + x]:
                    x += 1
                runs.append((s, x - 1))
            else:
                x += 1
        cur = set(runs)
        for key in order:
            if key not in cur:
                y0, y1 = active.pop(key)
                rects.append((key[0], y0, key[1], y1))
        order = [k for k in order if k in cur]
        for key in runs:
            if key in active:
                active[key][1] = y
            else:
                active[key] = [y, y]
                order.append(key)
    for key in order:
        y0, y1 = active.pop(key)
        rects.append((key[0], y0, key[1], y1))
    rects.sort(key=lambda r: (r[0], r[1], r[2], r[3]))
    return W, H, rects


def dec(fr):
    """把分数转成精确十进制字符串（0.045 = 9/200，分母只有 2、5，必为有限小数）"""
    num, den = fr.numerator, fr.denominator
    sign = "-" if num < 0 else ""
    num = abs(num)
    i, r = divmod(num, den)
    s = str(i)
    if r:
        digits = ""
        seen = {}
        while r and r not in seen:
            seen[r] = len(digits)
            r *= 10
            d, r = divmod(r, den)
            digits += str(d)
        s += "." + digits
    return sign + s


def main():
    D = load_labs()
    floor = D["floors"][0]
    mpp = D["metersPerPixel"]
    mpp_f = Fraction(str(mpp))

    img = Image.open(SRC_IMG)
    IW, IH = img.size
    MW, MH, rects = wall_rectangles(MAP_PNG)

    # ---- 房间 ----
    rooms = []
    for r in floor["rooms"]:
        x, y, w, h = r["x"], r["y"], r["w"], r["h"]
        rooms.append({
            "id": r["id"],
            "name": r["name"],
            "kind": r["kind"],
            "x": x, "y": y, "w": w, "h": h,
            "x2": x + w, "y2": y + h,
            "cx": x + w / 2, "cy": y + h / 2,
            "area_px2": w * h,
            "x_m": dec(Fraction(x) * mpp_f), "y_m": dec(Fraction(y) * mpp_f),
            "w_m": dec(Fraction(w) * mpp_f), "h_m": dec(Fraction(h) * mpp_f),
        })

    # ---- 节点 ----
    nodes = {}
    for n in floor["nodes"]:
        nodes[n["id"]] = {
            "id": n["id"], "x": n["x"], "y": n["y"], "note": n.get("note", ""),
            "x_m": dec(Fraction(n["x"]) * mpp_f), "y_m": dec(Fraction(n["y"]) * mpp_f),
        }

    # ---- 边（长度精确计算）----
    # 节点 id 在 labs.js 里是全写（"B2-3/n1"），而 edges 里是同层简写（"n1"），
    # 这里按楼层前缀补全后再查，避免 KeyError（2026-11-11 修）。
    def node_of(short):
        if short in nodes:
            return nodes[short]
        full = floor["id"] + "/" + short
        if full in nodes:
            return nodes[full]
        raise KeyError("边引用了不存在的节点：%s（楼层 %s）" % (short, floor["id"]))

    edges = []
    for a, b in floor["edges"]:
        na, nb = node_of(a), node_of(b)
        dx = nb["x"] - na["x"]
        dy = nb["y"] - na["y"]
        sq = dx * dx + dy * dy
        if sq == int(math.sqrt(sq)) ** 2:
            exact = str(int(math.sqrt(sq)))
        else:
            exact = "sqrt(%d)" % sq
        L = math.sqrt(sq)
        edges.append({
            "from": a, "to": b,
            "from_xy": [na["x"], na["y"]],
            "to_xy": [nb["x"], nb["y"]],
            "dx": dx, "dy": dy,
            "length_px_exact": exact,
            "length_px": L,
            "length_m_exact": ("0.045*%s" % exact) if exact.startswith("sqrt") else dec(Fraction(int(exact)) * mpp_f),
            "length_m": L * mpp,
            "axis": "H" if dy == 0 else ("V" if dx == 0 else "diagonal"),
        })

    # ---- 墙体矩形 ----
    walls = [{
        "x": x0, "y": y0, "x2": x1, "y2": y1,
        "w": x1 - x0 + 1, "h": y1 - y0 + 1,
    } for (x0, y0, x1, y1) in rects]

    data = {
        "meta": {
            "title": "第二实验楼 3层 平面图 / 数字地图 坐标数据",
            "generated_by": "tools/export_map_data.py",
            "source_image": "assets/floors/B2-3F.jpg",
            "source_map": "assets/floors/B2-3F_map.png",
            "source_data": "data/labs.js",
            "coordinate_system": {
                "type": "图像像素直角坐标系（2D，无 Z）",
                "origin": "源图左上角像素 (0,0)",
                "x_axis": "向右为正，单位 px，取值 0 .. 1790",
                "y_axis": "向下为正（图像坐标，非数学坐标），单位 px，取值 0 .. 1919",
                "extent_px": {"width": IW, "height": IH},
                "rect_convention": "矩形用 (x,y,w,h) 表示：x,y 为左上角，w 向右，h 向下；右下角 = (x+w, y+h)",
                "scale": {
                    "metersPerPixel": mpp,
                    "note": "该常量由 data/labs.js 声明，非从图纸比例尺实测；图上无尺寸标注/比例尺，无法溯源。所有 _m 字段均由此常量换算，精度受限于该常量。",
                    "1_px": "%s m" % dec(mpp_f),
                    "full_extent_m": {"width": dec(Fraction(IW) * mpp_f), "height": dec(Fraction(IH) * mpp_f)},
                },
                "grid": {
                    "file": "assets/floors/B2-3F_grid.txt",
                    "cell_px": 4,
                    "cols": 448, "rows": 480,
                    "note": "列数 = ceil(1791/4)=448（最后一列仅覆盖 1788..1790，3px）；行数 = 1920/4=480",
                },
            },
            "value_types": "房间/节点/墙体坐标均为整数 px（原值，未舍入）；中心点 cx,cy 可能为 .5（w 或 h 为奇数时）；长度与米制换算为 IEEE754 双精度原值。",
        },
        "provenance": {
            "rooms": "data/labs.js floors[0].rooms —— 人工在 CAD 图上标注，单位 px（源图像素）",
            "nodes": "data/labs.js floors[0].nodes —— 人工在 CAD 图上标注的走廊路网点",
            "edges": "data/labs.js floors[0].edges —— 人工给定的连通关系；长度由本脚本用欧氏距离 sqrt(dx^2+dy^2) 计算",
            "walls": "assets/floors/B2-3F_map.png 的红色像素 —— 由 tools/img2map.py 从源图生成，规则见 tools/img2map.py 文件头；本脚本再按行游程+纵向合并分解为轴对齐矩形",
            "meters": "metersPerPixel（data/labs.js 顶层字段）换算",
        },
        "counts": {
            "rooms": len(rooms), "nodes": len(nodes), "edges": len(edges),
            "wall_rects": len(walls),
            "wall_px": sum(w["w"] * w["h"] for w in walls),
        },
        "rooms": rooms,
        "nodes": list(nodes.values()),
        "edges": edges,
        "walls": walls,
        "labs": D["labs"],
        "locations": D["locations"],
        "floor": {"id": floor["id"], "width": floor["width"], "height": floor["height"]},
    }

    out_json = os.path.join(ROOT, "assets", "floors", "B2-3F_data.json")
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)

    def csv_write(name, header, rows):
        with open(os.path.join(ROOT, "assets", "floors", name), "w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f)
            w.writerow(header)
            w.writerows(rows)

    csv_write("B2-3F_rooms.csv",
              ["id", "name", "kind", "x", "y", "w", "h", "x2", "y2", "cx", "cy", "area_px2", "x_m", "y_m", "w_m", "h_m"],
              [[r["id"], r["name"], r["kind"], r["x"], r["y"], r["w"], r["h"], r["x2"], r["y2"],
                r["cx"], r["cy"], r["area_px2"], r["x_m"], r["y_m"], r["w_m"], r["h_m"]] for r in rooms])

    csv_write("B2-3F_nodes.csv", ["id", "x", "y", "x_m", "y_m", "note"],
              [[n["id"], n["x"], n["y"], n["x_m"], n["y_m"], n["note"]] for n in nodes.values()])

    csv_write("B2-3F_edges.csv",
              ["from", "to", "from_x", "from_y", "to_x", "to_y", "dx", "dy", "axis",
               "length_px_exact", "length_px", "length_m_exact", "length_m"],
              [[e["from"], e["to"], e["from_xy"][0], e["from_xy"][1], e["to_xy"][0], e["to_xy"][1],
                e["dx"], e["dy"], e["axis"], e["length_px_exact"], e["length_px"],
                e["length_m_exact"], e["length_m"]] for e in edges])

    csv_write("B2-3F_walls.csv", ["x", "y", "x2", "y2", "w", "h"],
              [[w["x"], w["y"], w["x2"], w["y2"], w["w"], w["h"]] for w in walls])

    print("源图 %dx%d，地图 %dx%d" % (IW, IH, MW, MH))
    print("房间 %d，节点 %d，边 %d，墙矩形 %d（墙体像素 %d）"
          % (len(rooms), len(nodes), len(edges), len(walls), data["counts"]["wall_px"]))
    for p in ("B2-3F_data.json", "B2-3F_rooms.csv", "B2-3F_nodes.csv", "B2-3F_edges.csv", "B2-3F_walls.csv"):
        print("  输出 assets/floors/%s" % p)
    diag = [e for e in edges if e["axis"] == "diagonal"]
    print("非轴对齐边 %d 条：" % len(diag))
    for e in diag:
        print("   %s -> %s  dx=%d dy=%d  L=sqrt(%d)=%r px"
              % (e["from"], e["to"], e["dx"], e["dy"], e["dx"] ** 2 + e["dy"] ** 2, e["length_px"]))


if __name__ == "__main__":
    main()
