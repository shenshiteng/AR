#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
ArUco 标记结构标注图
====================

读一张 ArUco 标记图，自动读出 7×7 格子的黑白分布，解出 ID，
然后画一张带标注的说明图：黑边框、静区、5×5 数据位、每一位的值、以及编码结论。

用法：
    python tools/annotate_aruco.py --image aruco-0.png
    python tools/annotate_aruco.py --image aruco-0.png --out docs/img/xxx.png
"""
import argparse
import os
import re
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DICT_FILE = os.path.join(ROOT, "js", "vendor", "js-aruco2.js")

INK = (26, 26, 26)
GRAY = (120, 118, 112)
GRID = (211, 209, 199)
RED = (180, 35, 24)
TEAL = (15, 110, 86)
BLUE = (24, 95, 165)


def _font(size, bold=False):
    for p in (["C:/Windows/Fonts/msyhbd.ttc", "C:/Windows/Fonts/simhei.ttf"] if bold
              else ["C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/simhei.ttf"]):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def read_grid(path):
    """读标记图，返回 (7×7 矩阵 1=白, 原图, 黑区包围盒)。"""
    img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        sys.exit("读不了图：%s" % path)
    b = (img < 128).astype(np.uint8)
    ys, xs = np.nonzero(b)
    if len(xs) == 0:
        sys.exit("图里没有黑色区域")
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    n = 7
    cw = (x1 - x0 + 1) / n
    ch = (y1 - y0 + 1) / n
    g = np.zeros((n, n), np.uint8)
    for r in range(n):
        for c in range(n):
            cx = int(x0 + (c + 0.5) * cw)
            cy = int(y0 + (r + 0.5) * ch)
            g[r, c] = 1 if img[cy, cx] > 128 else 0
    return g, img, (x0, y0, x1, y1)


def lookup(mid_hex):
    """去字典里查这个 25 位是不是合法码、对应哪个 ID。"""
    try:
        src = open(DICT_FILE, "r", encoding="utf-8").read()
    except OSError:
        return None, None
    m = re.search(r"ARUCO\s*:\s*\{[\s\S]*?codeList\s*:\s*\[([\s\S]*?)\]\s*\}", src)
    if not m:
        return None, None
    codes = [int(t.strip(), 16) for t in m.group(1).split(",")
             if re.match(r"^0x[0-9a-fA-F]+$", t.strip())]
    for i, v in enumerate(codes):
        if v == mid_hex:
            return i, len(codes)
    return None, len(codes)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--out", default="docs/img/aruco_annotated.png")
    args = ap.parse_args()

    grid, src, (x0, y0, x1, y1) = read_grid(args.image)
    bits = "".join(str(grid[r][c]) for r in range(1, 6) for c in range(1, 6))
    val = int(bits, 2)
    mid, total = lookup(val)

    # ---- 画布：码保持干净，说明全部放到右边 ----
    W, H = 1460, 780
    canvas = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(canvas)

    CELL = 88
    MX, MY = 90, 110
    SIDE = CELL * 7

    # 标记本体：不画网格、不画边框、不写数字，保持可扫描
    crop = src[y0:y1 + 1, x0:x1 + 1]
    body = Image.fromarray(crop).convert("L").resize((SIDE, SIDE), Image.NEAREST).convert("RGB")
    canvas.paste(body, (MX, MY))

    # 竖分隔线
    d.line([(MX + SIDE + 100, MY), (MX + SIDE + 100, MY + SIDE)], fill=GRID, width=2)

    tx = MX + SIDE + 150
    d.text((tx, MY + 6), "ArUco", font=_font(44, True), fill=INK)
    d.text((tx, MY + 66), "ID %s" % (mid if mid is not None else "未知"),
           font=_font(44, True), fill=TEAL)

    d.text((tx, MY + 150), "7 × 7 = 49 格", font=_font(24), fill=GRAY)
    d.text((tx, MY + 190), "其中 5 × 5 = 25 格是数据位", font=_font(24), fill=GRAY)

    d.text((tx, MY + 258), "25 位编码（白=1 黑=0）", font=_font(20), fill=GRAY)
    grouped = " ".join(bits[i:i + 5] for i in range(0, 25, 5))
    d.text((tx, MY + 292), grouped, font=_font(25, True), fill=INK)
    d.text((tx, MY + 340), "0x%07X" % val, font=_font(27, True), fill=TEAL)

    out = args.out if os.path.isabs(args.out) else os.path.join(ROOT, args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    canvas.save(out)

    print("测得格子（1=白）：")
    for r in range(7):
        print("   " + "".join(str(v) for v in grid[r]))
    print("25 位：%s" % bits)
    print("十六进制：0x%07X" % val)
    print("字典：%s" % ("命中 ID %d（共 %d 个码）" % (mid, total) if mid is not None else "不合法"))
    print("标注图：%s" % os.path.relpath(out, ROOT))


if __name__ == "__main__":
    main()
