# -*- coding: utf-8 -*-
"""1F 房间自动分割：把墙体当障碍，对空白区域做连通域填充，
每个连通块就是一个房间/走廊，输出其外接矩形和面积。

这比目测准：矩形边界必然是真实墙线，不会出现"手量差几像素"的问题。
"""
import os
import sys

import numpy as np
from PIL import Image

R = r"C:\Users\35391\Desktop\python\实验室定位"
IMG = os.path.join(R, "docs", "img", "floor-1f-photo.jpg")
OUTDIR = os.path.join(R, "_1f_crops")


def runs_1d(mask_line, min_len):
    out = []
    i, n = 0, len(mask_line)
    while i < n:
        if mask_line[i]:
            j = i
            while j < n and mask_line[j]:
                j += 1
            if j - i >= min_len:
                out.append((i, j - 1))
            i = j
        else:
            i += 1
    return out


def build_walls():
    im = Image.open(IMG).convert("RGB")
    W, H = im.size
    a = np.asarray(im).astype(np.int16)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    red = (r - np.maximum(g, b)) > 12
    red[:280, :] = False
    red[1753:, :] = False
    red[:, :121] = False
    red[:, 1664:] = False

    MIN = 40
    horiz = np.zeros_like(red)
    for y in range(H):
        for s, e in runs_1d(red[y], MIN):
            horiz[y, s:e + 1] = True
    vert = np.zeros_like(red)
    for x in range(W):
        for s, e in runs_1d(red[:, x], MIN):
            vert[s:e + 1, x] = True
    return horiz | vert, W, H


def dilate(m, n=1):
    out = m.copy()
    for _ in range(n):
        p = np.pad(out, 1, constant_values=False)
        out = (p[1:-1, 1:-1] | p[:-2, 1:-1] | p[2:, 1:-1] |
               p[1:-1, :-2] | p[1:-1, 2:])
    return out


def label_regions(free):
    """纯 numpy 的 4-邻域连通域标注（BFS）。"""
    H, W = free.shape
    lab = np.full((H, W), -1, dtype=np.int32)
    cur = 0
    comps = []
    for y in range(H):
        row = free[y]
        for x in range(W):
            if row[x] and lab[y, x] == -1:
                stack = [(y, x)]
                lab[y, x] = cur
                pix = []
                while stack:
                    cy, cx = stack.pop()
                    pix.append((cy, cx))
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < H and 0 <= nx < W and free[ny, nx] and lab[ny, nx] == -1:
                            lab[ny, nx] = cur
                            stack.append((ny, nx))
                comps.append(pix)
                cur += 1
    return lab, comps


def main():
    walls, W, H = build_walls()
    # 关键：墙是断的（门洞、扫描件虚边），必须先"闭合"再分割。
    # 做法 = 膨胀若干次再腐蚀同样次数（形态学闭运算），把 ≤GAP 的缺口补上。
    GAP = 9          # 9px ≈ 0.4m，足够补门洞缝但不吞掉整条走廊
    w2 = dilate(walls, GAP)
    free = ~w2
    # 只保留图面内部（外墙围起来的区域）
    free[:300, :] = False
    free[1740:, :] = False
    free[:, :130] = False
    free[:, 1655:] = False

    print("正在做连通域标注（图较大，稍等）...")
    lab, comps = label_regions(free)
    print("共 %d 个连通块" % len(comps))
    print("（注意：这是膨胀 %dpx 后的分割，矩形会比真实墙线略小，"
          "最后要按真实墙线回补 %dpx）" % (GAP, GAP))

    rows = []
    for pix in comps:
        ys = [p[0] for p in pix]
        xs = [p[1] for p in pix]
        y1, y2, x1, x2 = min(ys), max(ys), min(xs), max(xs)
        area = len(pix)
        rows.append((area, x1, y1, x2, y2))

    rows.sort(reverse=True)
    print("\n%-7s %-22s %-9s %s" % ("面积", "内缩矩形", "回补后矩形", "宽x高"))
    out = []
    for area, x1, y1, x2, y2 in rows:
        if area < 2000:
            continue
        # 回补：向外扩 GAP 像素
        rx1, ry1 = x1 - GAP, y1 - GAP
        rx2, ry2 = x2 + GAP, y2 + GAP
        out.append((rx1, ry1, rx2, ry2, area))
        print("%-7d x%-5d-%-5d y%-5d-%-5d x%-5d-%-5d y%-5d-%-5d %dx%d" % (
            area, x1, x2, y1, y2, rx1, rx2, ry1, ry2, rx2 - rx1, ry2 - ry1))

    # 存可视化
    vis = np.zeros((H, W, 3), dtype=np.uint8)
    vis[w2] = [40, 40, 40]
    rng = np.random.RandomState(7)
    colors = rng.randint(70, 235, size=(len(comps), 3))
    for i, pix in enumerate(comps):
        if len(pix) < 2000:
            continue
        for yy, xx in pix:
            vis[yy, xx] = colors[i]
    Image.fromarray(vis).save(os.path.join(OUTDIR, "regions_1f.png"))
    print("\nwrote", os.path.join(OUTDIR, "regions_1f.png"))


if __name__ == "__main__":
    main()
