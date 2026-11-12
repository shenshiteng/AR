# -*- coding: utf-8 -*-
"""从应急疏散图（拍照）里粗提墙线，输出可读的横/竖线清单。

画面是"白底 + 细红/蓝线"，墙线比字更长、更连续，所以：
  1) 用颜色+亮度做出"线条掩膜"
  2) 逐行/逐列找长游程（允许 3px 断口，容忍照片轻微倾斜）
  3) 合并共线、只留够长的，按长度排序打印

用法：python tools/trace_plan.py <图片> [x1 y1 x2 y2]
"""
import sys
import numpy as np
from PIL import Image

MIN_H = 55        # 横线最短像素长度
MIN_V = 45        # 竖线最短高度
GAP = 3           # 允许断口
THICK = 5         # 同一条线内的行/列合并厚度


def load_mask(path):
    a = np.asarray(Image.open(path).convert('RGB')).astype(int)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    mx = a.max(axis=2)
    mn = a.min(axis=2)
    # 线条：比白底暗，且带颜色（红字/蓝字/深灰框），去掉大面积高光
    mask = (mx < 200) & ((mx - mn) > 12)
    return mask


def runs(vec, min_len, gap=GAP):
    """返回 [(s,e)]，允许 gap 长度的断口"""
    out = []
    i, n = 0, len(vec)
    while i < n:
        if not vec[i]:
            i += 1
            continue
        s = i
        e = i
        j = i + 1
        miss = 0
        while j < n:
            if vec[j]:
                e = j
                miss = 0
            else:
                miss += 1
                if miss > gap:
                    break
            j += 1
        if e - s + 1 >= min_len:
            out.append((s, e))
        i = e + 1
    return out


def merge(vals):
    """把相邻的坐标合并成区间"""
    out = []
    for v in sorted(vals):
        if out and v - out[-1][1] <= THICK:
            out[-1][1] = v
        else:
            out.append([v, v])
    return out


def main():
    path = sys.argv[1]
    m = load_mask(path)
    box = None
    if len(sys.argv) >= 6:
        x1, y1, x2, y2 = map(int, sys.argv[2:6])
        box = (x1, y1, x2, y2)
        sub = m[y1:y2, x1:x2]
    else:
        x1, y1 = 0, 0
        sub = m
    print('image', Image.open(path).size, 'mask frac %.3f' % m.mean())

    H, W = sub.shape
    hs = []      # (y, x1, x2)
    for y in range(H):
        for s, e in runs(sub[y], MIN_H):
            hs.append((y + y1, s + x1, e + x1))
    vs = []      # (x, y1, y2)
    for x in range(W):
        for s, e in runs(sub[:, x], MIN_V):
            vs.append((x + x1, s + y1, e + y1))

    # 同一 y 上互相重叠的合并
    def group(items, ax, lo, hi):
        items = sorted(items, key=lambda t: (t[0], t[1]))
        out = []
        for it in items:
            placed = False
            for g in out:
                if abs(g['ax'] - it[0]) <= 4 and not (it[2] < g['lo'] - 8 or it[1] > g['hi'] + 8):
                    g['ax'] = it[0]
                    g['lo'] = min(g['lo'], it[1])
                    g['hi'] = max(g['hi'], it[2])
                    placed = True
                    break
            if not placed:
                out.append({'ax': it[0], 'lo': it[1], 'hi': it[2]})
        return out

    H2 = group(hs, 0, 1, 2)
    V2 = group(vs, 0, 1, 2)

    print('\n=== 横线（y | x1..x2 | 长）')
    for g in sorted(H2, key=lambda g: (g['ax'], g['lo'])):
        print('  y=%4d  x %4d..%4d  len=%3d' % (g['ax'], g['lo'], g['hi'], g['hi'] - g['lo']))
    print('\n=== 竖线（x | y1..y2 | 高）')
    for g in sorted(V2, key=lambda g: (g['ax'], g['lo'])):
        print('  x=%4d  y %4d..%4d  len=%3d' % (g['ax'], g['lo'], g['hi'], g['hi'] - g['lo']))


if __name__ == '__main__':
    main()
