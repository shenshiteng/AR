# -*- coding: utf-8 -*-
"""1F 边界与天井标定：找外墙四至、中央天井范围、以及各主要分区的分界。

用"长线+连通"判据：外墙是图上最外围的连续长线；天井是一整块内部无墙的大空白。
"""
import os

import numpy as np
from PIL import Image

R = r"C:\Users\35391\Desktop\python\实验室定位"
IMG = os.path.join(R, "docs", "img", "floor-1f-photo.jpg")


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


def main():
    im = Image.open(IMG).convert("RGB")
    W, H = im.size
    a = np.asarray(im).astype(np.int16)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    red = (r - np.maximum(g, b)) > 12
    red[:280, :] = False
    red[1753:, :] = False
    red[:, :121] = False
    red[:, 1664:] = False

    MIN = 45
    horiz = np.zeros_like(red)
    for y in range(H):
        for s, e in runs_1d(red[y], MIN):
            horiz[y, s:e + 1] = True
    vert = np.zeros_like(red)
    for x in range(W):
        for s, e in runs_1d(red[:, x], MIN):
            vert[s:e + 1, x] = True
    walls = horiz | vert

    ys, xs = np.nonzero(walls)
    print("墙体包围盒: x %d..%d  (宽 %d)   y %d..%d  (高 %d)" % (
        xs.min(), xs.max(), xs.max() - xs.min(), ys.min(), ys.max(), ys.max() - ys.min()))

    # 逐行打印"最左墙 / 最右墙"，看外轮廓的台阶
    print("\n=== 外轮廓（每 25 行采样：最左 / 最右 墙的 x）===")
    for y in range(ys.min(), ys.max() + 1, 25):
        row = np.nonzero(walls[y])[0]
        if len(row) == 0:
            print("  y=%-5d  （空）" % y)
            continue
        # 找该行的连续段
        segs = runs_1d(walls[y], 3)
        print("  y=%-5d  段: %s" % (y, " ".join("%d-%d" % s for s in segs[:8])))

    print("\n=== 逐列（每 50 列）：最上 / 最下 ===")
    for x in range(xs.min(), xs.max() + 1, 50):
        col = np.nonzero(walls[:, x])[0]
        if len(col) == 0:
            continue
        segs = runs_1d(walls[:, x], 3)
        print("  x=%-5d  段: %s" % (x, " ".join("%d-%d" % s for s in segs[:8])))


if __name__ == "__main__":
    main()
