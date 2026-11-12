# -*- coding: utf-8 -*-
"""1F 板墙线探测：把红色墙线投影成行/列直方图，找出所有横墙 y 和竖墙 x。

只做测量，不做决定。输出用来人工核对后写进 floor-1f.js。
"""
import os
import sys

import numpy as np
from PIL import Image

R = r"C:\Users\35391\Desktop\python\实验室定位"
IMG = os.path.join(R, "docs", "img", "floor-1f-photo.jpg")


def red_mask(im):
    a = np.asarray(im.convert("RGB")).astype(np.int16)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    return (r - np.maximum(g, b)) > 12


def peaks(hist, thr, min_gap=6):
    """找出连续超阈值的区间，返回中心坐标。"""
    out = []
    i, n = 0, len(hist)
    while i < n:
        if hist[i] >= thr:
            j = i
            while j < n and hist[j] >= thr:
                j += 1
            out.append(((i + j - 1) / 2.0, int(hist[i:j].max()), j - i))
            i = j
        else:
            i += 1
    # 合并挨得太近的
    merged = []
    for c, pk, w in out:
        if merged and c - merged[-1][0] < min_gap:
            if pk > merged[-1][1]:
                merged[-1] = (c, pk, w)
        else:
            merged.append((c, pk, w))
    return merged


def main():
    im = Image.open(IMG)
    W, H = im.size
    m = red_mask(im)

    # 去掉标题带（上 12%）和底部空白
    top = int(H * 0.115)
    m[:top, :] = False

    xs = np.nonzero(m)[1]
    ys = np.nonzero(m)[0]
    x1, x2 = xs.min(), xs.max()
    y1, y2 = ys.min(), ys.max()
    print("图像 %dx%d  红墙包围盒 x%d-%d y%d-%d" % (W, H, x1, x2, y1, y2))
    print()

    # 只在图面范围内统计
    sub = m[y1:y2 + 1, x1:x2 + 1]
    h, w = sub.shape

    # 竖墙：每列的红像素数
    colhist = sub.sum(axis=0)
    # 横墙：每行的红像素数
    rowhist = sub.sum(axis=1)

    print("=== 竖墙（x 坐标，按红像素数）阈值=较高峰值的 25% ===")
    thr_c = max(40, colhist.max() * 0.25)
    for c, pk, wd in peaks(colhist, thr_c):
        print("  x = %-6.0f  峰值 %-5d  宽 %d px" % (x1 + c, pk, wd))

    print()
    print("=== 横墙（y 坐标）阈值=较高峰值的 25% ===")
    thr_r = max(40, rowhist.max() * 0.25)
    for c, pk, wd in peaks(rowhist, thr_r):
        print("  y = %-6.0f  峰值 %-5d  宽 %d px" % (y1 + c, pk, wd))

    print()
    print("=== 所有局部强峰（阈值 45%，用来看次级墙）===")
    print("-- 竖墙 --")
    for c, pk, wd in peaks(colhist, max(30, colhist.max() * 0.45)):
        print("  x = %-6.0f  峰值 %d" % (x1 + c, pk))
    print("-- 横墙 --")
    for c, pk, wd in peaks(rowhist, max(30, rowhist.max() * 0.45)):
        print("  y = %-6.0f  峰值 %d" % (y1 + c, pk))


if __name__ == "__main__":
    main()
