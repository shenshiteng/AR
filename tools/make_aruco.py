#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
生成每个楼梯口（locations）的 ArUco 定位码，输出真正的 PNG + SVG。

和浏览器识别端「逐像素一致」：
  - 字典读取 js/vendor/js-aruco2.js 里 ARUCO 的 codeList（十六进制），不是抄一份。
  - 编码规则和 js/aruco-marker.js 的 ArucoMark.svg() 完全一致：
    25 位二进制（最高位在前，'1'=白）→ 5x5 数据位 → 外圈 1 格黑边框
    → 四周 1 格白边（quiet zone）。

用法（在项目根目录执行）：
    python tools/make_aruco.py
    python tools/make_aruco.py --id P-B2-01     # 只生成某一个

产物：
    aruco/<定位点ID>.svg   矢量码（打印随便放大不糊）
    aruco/<定位点ID>.png   真 PNG 位图（发/贴/插文档用）
"""
import argparse
import io
import json
import os
import re
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_FILE = os.path.join(ROOT, "data", "labs.js")
DICT_FILE = os.path.join(ROOT, "js", "vendor", "js-aruco2.js")
OUT_DIR = os.path.join(ROOT, "aruco")


def load_data():
    with io.open(DATA_FILE, "r", encoding="utf-8") as f:
        raw = f.read()
    raw = re.sub(r"^\s*window\.LAB_DATA\s*=\s*", "", raw).strip()
    raw = re.sub(r";\s*$", "", raw)
    return json.loads(raw)


def load_dict():
    with io.open(DICT_FILE, "r", encoding="utf-8") as f:
        src = f.read()
    m = re.search(r"ARUCO\s*:\s*\{[\s\S]*?codeList\s*:\s*\[([\s\S]*?)\]\s*\}", src)
    if not m:
        raise RuntimeError("在 js-aruco2.js 里找不到 ARUCO 字典")
    codes = []
    for tok in m.group(1).split(","):
        tok = tok.strip()
        if re.match(r"^0x[0-9a-fA-F]+$", tok):
            codes.append(int(tok, 16))
    if not codes:
        raise RuntimeError("ARUCO 字典 codeList 解析为空")
    return codes


def bits_of(codes, mid):
    if mid >= len(codes):
        raise RuntimeError("标记号 %d 超出字典范围 0~%d" % (mid, len(codes) - 1))
    return format(codes[mid], "025b")   # 25 位二进制，最高位在前，'1'=白


def make_svg(bits, margin=4):
    """整张白纸、码居中、四周留白（和 PNG 一致）。margin = 码四周留白格数。"""
    quiet = 1
    mark = 7 + quiet * 2        # 码本身 9 格
    n = mark + margin * 2       # 总边长（格）
    s = []
    s.append('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" shape-rendering="crispEdges">' % (n, n))
    s.append('<rect x="0" y="0" width="%d" height="%d" fill="#ffffff"/>' % (n, n))
    ox = margin
    s.append('<rect x="%d" y="%d" width="7" height="7" fill="#000000"/>' % (ox + quiet, ox + quiet))
    for y in range(5):
        for x in range(5):
            if bits[y * 5 + x] == "1":
                s.append('<rect x="%d" y="%d" width="1" height="1" fill="#ffffff"/>' % (ox + quiet + 1 + x, ox + quiet + 1 + y))
    s.append("</svg>")
    return "".join(s)


def _chinese_font(size):
    """找一个能显示中文的系统字体。找不到就退回默认字体（会变豆腐块，但不会崩）。"""
    for p in ("C:/Windows/Fonts/simhei.ttf", "C:/Windows/Fonts/msyh.ttc",
              "C:/Windows/Fonts/simsun.ttc"):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def make_png(bits, place="", mid=0, cell=60, margin=4):
    """整张白纸、码居中、四周留白，码下方印位置名（防止张贴错误）。
    cell = 码里每格像素（越大越清晰）；margin = 码四周留白的「格数」。
    place/mid 会在码下方加两行字：位置名 + ArUco ID。"""
    quiet = 1                       # 码自带 1 格白边
    mark_cells = 7 + quiet * 2      # 码本身占 9 格
    mark_px = mark_cells * cell     # 码的边长（像素）
    pad = margin * cell             # 四周留白（像素）

    # 文字区：码下方留白之外再加一行文字高度
    text_h = 0
    if place:
        text_h = int(cell * 3.2)    # 码下方文字区高度

    size_w = mark_px + pad * 2
    size_h = mark_px + pad * 2 + text_h
    img = Image.new("L", (size_w, size_h), 255)   # 整张白纸
    d = ImageDraw.Draw(img)

    ox = pad                             # 码左上角 x 偏移（水平居中）
    oy = pad                             # 码左上角 y 偏移
    # 外圈黑边框（7x7）
    d.rectangle([ox + quiet * cell, oy + quiet * cell,
                 ox + (quiet + 7) * cell - 1, oy + (quiet + 7) * cell - 1], fill=0)
    # 数据位：先有大黑框，'1'=白 → 画白格挖出图案；'0'=黑 → 黑框本身就是，不用画
    for y in range(5):
        for x in range(5):
            if bits[y * 5 + x] == "1":
                px = ox + (quiet + 1 + x) * cell
                py = oy + (quiet + 1 + y) * cell
                d.rectangle([px, py, px + cell - 1, py + cell - 1], fill=255)

    # 码下方印文字：位置名（大字）+ ArUco ID（小字），居中
    if place:
        center_x = size_w // 2
        f1 = _chinese_font(max(28, cell))          # 位置名字号
        f2 = _chinese_font(max(18, int(cell * 0.6)))  # ID 字号
        y = oy + mark_px + int(cell * 0.9)
        d.text((center_x, y), place, font=f1, fill=0, anchor="ma")
        y2 = y + int(cell * 1.5)
        d.text((center_x, y2), "ArUco ID %d · %s" % (mid, place), font=f2, fill=120, anchor="ma")
    return img


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    ap = argparse.ArgumentParser()
    ap.add_argument("--id", help="只生成某一个定位点（如 P-B2-01）")
    args = ap.parse_args()

    data = load_data()
    locs = data.get("locations", [])
    if not locs:
        sys.exit("data/labs.js 里还没有 locations（定位点）")

    codes = load_dict()
    os.makedirs(OUT_DIR, exist_ok=True)

    count = 0
    for i, loc in enumerate(locs):
        if args.id and loc["id"] != args.id:
            continue
        mid = loc.get("marker", i)
        bits = bits_of(codes, mid)
        place = loc.get("place", loc["id"])
        svg = make_svg(bits)
        png = make_png(bits, place=place, mid=mid)

        svg_path = os.path.join(OUT_DIR, loc["id"] + ".svg")
        png_path = os.path.join(OUT_DIR, loc["id"] + ".png")
        with io.open(svg_path, "w", encoding="utf-8") as f:
            f.write(svg)
        png.save(png_path)
        count += 1
        print("  \u2713 %s  ArUco ID %d  %s" % (loc["id"], mid, loc.get("place", "")))

    print("\n已生成 %d 个定位码到 aruco/ 目录（.svg 矢量 + .png 真位图）" % count)


if __name__ == "__main__":
    main()
