# -*- coding: utf-8 -*-
"""把 1F 板上的红色像素分成"长横线/长竖线"（真墙）和"短笔画"（文字、箭头、图例），
只输出长线构成的墙体骨架图 + 坐标清单。

这是量图的关键一步：疏散板上的房间号是红色大字，直接做红掩膜会把文字当成墙。
"""
import os

import numpy as np
from PIL import Image

R = r"C:\Users\35391\Desktop\python\实验室定位"
IMG = os.path.join(R, "docs", "img", "floor-1f-photo.jpg")
OUT = os.path.join(R, "_1f_crops", "walls_only.png")


def runs_1d(mask_line, min_len):
    """返回这一行/列里长度 >= min_len 的连续段 [(start, end)]。"""
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

    # 图面范围（去掉蓝边框和标题）
    x1, y1, x2, y2 = 121, 280, 1663, 1752
    red = red.copy()
    red[:y1, :] = False
    red[y2 + 1:, :] = False
    red[:, :x1] = False
    red[:, x2 + 1:] = False

    # 横线：逐行找长 run
    MIN_LEN = 45          # 45px ≈ 2m（板面 23px/m），比任何文字笔画长
    horiz = np.zeros_like(red)
    for y in range(y1, y2 + 1):
        for s, e in runs_1d(red[y], MIN_LEN):
            horiz[y, s:e + 1] = True

    # 竖线：逐列
    vert = np.zeros_like(red)
    for x in range(x1, x2 + 1):
        for s, e in runs_1d(red[y1:y2 + 1, x], MIN_LEN):
            vert[y1 + s:y1 + e + 1, x] = True

    walls = horiz | vert

    # 输出可视化：白底 + 黑墙
    out = np.full((H, W, 3), 255, dtype=np.uint8)
    out[walls] = [0, 0, 0]
    out[red & ~walls] = [255, 200, 200]     # 被判定为"非墙"的红像素（淡红，供校验）
    Image.fromarray(out).save(OUT)
    print("wrote", OUT)

    # ---- 统计横墙的 y 位置 ----
    print("\n=== 横墙 y 坐标（该行长横线总长 ≥ 80px）===")
    hp = horiz.sum(axis=1)
    i = y1
    while i <= y2:
        if hp[i] >= 80:
            j = i
            while j <= y2 and hp[j] >= 80:
                j += 1
            seg = hp[i:j]
            print("  y = %-5d (峰 %d px, 厚度 %d 行)" % ((i + j - 1) // 2, seg.max(), j - i))
            i = j
        else:
            i += 1

    print("\n=== 竖墙 x 坐标（该列长竖线总长 ≥ 80px）===")
    vp = vert.sum(axis=0)
    i = x1
    while i <= x2:
        if vp[i] >= 80:
            j = i
            while j <= x2 and vp[j] >= 80:
                j += 1
            seg = vp[i:j]
            print("  x = %-5d (峰 %d px, 厚度 %d 列)" % ((i + j - 1) // 2, seg.max(), j - i))
            i = j
        else:
            i += 1


if __name__ == "__main__":
    main()
