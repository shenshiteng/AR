#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""图片 -> 数字地图（红=墙，其余=可通行）

目标：输出“墙就是一条细红线”的干净平面图，而不是一坨红色。

用法：
  python tools/img2map.py assets/floors/B2-3F.jpg --banner 340
  python tools/img2map.py 输入.jpg -o 输出前缀 --minrun 22 --gap 10 --cell 4

处理流程（每一步都可关掉/调参）：
  1) 红判定：r > g+12 且 r > b+12 且 红度 r-(g+b)/2 < 40
     - “相对偏红”抓淡红墙线；
     - 红度 < 40 先排掉深饱和红的房间号文字。
  2) 线段过滤（--minrun，默认 22px）：
     平面图墙是横平竖直的长线段，房间号笔画是 5~20px 的短线段。
     只保留“行内连续 >= minrun”或“列内连续 >= minrun”的像素。
     这一步既去掉数字，又不会像密度法那样啃掉旁边的墙。
  3) 连通域过滤：只留细长低填充结构（长边>=50 且 填充<=0.35），去掉噪点/碎笔画。
  4) 补缺口（--gap，默认 10px）：沿行/列把 <= gap 的断口连上，
     使墙线连续；真实门洞一般 > 30px，不受影响。
  5) 膨胀 1px：把细线补到 ~3px，缩放显示时仍是一条细线。

输出：
  <前缀>_map.png   原分辨率，墙=细红线，其余=白
  <前缀>_grid.txt  0/1 网格（1=墙）
"""
import argparse
import os
import sys

from PIL import Image


def build_mask(img, banner, red_max, min_bright):
    W, H = img.size
    px = img.load()
    mask = bytearray(W * H)
    for y in range(banner, H):
        row = y * W
        for x in range(W):
            r, g, b = px[x, y]
            if r > g + 12 and r > b + 12 and (r - (g + b) // 2) < red_max:
                if (r + g + b) // 3 >= min_bright:
                    mask[row + x] = 1
    return mask


def filter_runs(mask, W, H, minrun):
    """只保留行/列方向连续长度 >= minrun 的像素（去掉短笔画文字）"""
    keep = bytearray(W * H)
    # 水平方向
    for y in range(H):
        base = y * W
        x = 0
        while x < W:
            if mask[base + x]:
                s = x
                while x < W and mask[base + x]:
                    x += 1
                if x - s >= minrun:
                    for k in range(s, x):
                        keep[base + k] = 1
            else:
                x += 1
    # 垂直方向
    for x in range(W):
        y = 0
        while y < H:
            if mask[y * W + x]:
                s = y
                while y < H and mask[y * W + x]:
                    y += 1
                if y - s >= minrun:
                    for k in range(s, y):
                        keep[k * W + x] = 1
            else:
                y += 1
    return keep


def filter_components(mask, W, H, min_len=50, max_fill=0.35):
    """只保留细长低填充的结构"""
    lab = [0] * (W * H)
    keep = bytearray(W * H)
    kept = 0
    for y in range(H):
        for x in range(W):
            i = y * W + x
            if not mask[i] or lab[i]:
                continue
            tag = i + 1
            lab[i] = tag
            st = [i]
            minx = maxx = x
            miny = maxy = y
            area = 0
            while st:
                j = st.pop()
                area += 1
                jy, jx = divmod(j, W)
                if jx < minx:
                    minx = jx
                if jx > maxx:
                    maxx = jx
                if jy < miny:
                    miny = jy
                if jy > maxy:
                    maxy = jy
                for dy in (-1, 0, 1):
                    yy = jy + dy
                    if yy < 0 or yy >= H:
                        continue
                    bb = yy * W
                    for dx in (-1, 0, 1):
                        xx = jx + dx
                        if xx < 0 or xx >= W:
                            continue
                        k = bb + xx
                        if mask[k] and not lab[k]:
                            lab[k] = tag
                            st.append(k)
            bw = maxx - minx + 1
            bh = maxy - miny + 1
            if max(bw, bh) >= min_len and area / (bw * bh) <= max_fill:
                kept += 1
                for yy in range(miny, maxy + 1):
                    b2 = yy * W
                    for xx in range(minx, maxx + 1):
                        if lab[b2 + xx] == tag:
                            keep[b2 + xx] = 1
    return keep, kept


def close_gaps(mask, W, H, gap):
    """沿行/列把 <= gap 的小断口连上"""
    out = bytearray(mask)
    for y in range(H):
        base = y * W
        x = 0
        while x < W:
            if out[base + x]:
                while x < W and out[base + x]:
                    x += 1
                e = x
                g = 0
                while e < W and not out[base + e] and g <= gap:
                    e += 1
                    g += 1
                if 1 <= g <= gap and e < W and out[base + e]:
                    for k in range(x, e):
                        out[base + k] = 1
            else:
                x += 1
    for x in range(W):
        y = 0
        while y < H:
            if out[y * W + x]:
                while y < H and out[y * W + x]:
                    y += 1
                e = y
                g = 0
                while e < H and not out[e * W + x] and g <= gap:
                    e += 1
                    g += 1
                if 1 <= g <= gap and e < H and out[e * W + x]:
                    for k in range(y, e):
                        out[k * W + x] = 1
            else:
                y += 1
    return out


def dilate1(mask, W, H):
    nm = bytearray(mask)
    for y in range(H):
        base = y * W
        for x in range(W):
            if mask[base + x]:
                continue
            hit = False
            for dy in (-1, 0, 1):
                yy = y + dy
                if yy < 0 or yy >= H:
                    continue
                bb = yy * W
                for dx in (-1, 0, 1):
                    xx = x + dx
                    if xx < 0 or xx >= W:
                        continue
                    if mask[bb + xx]:
                        hit = True
                        break
                if hit:
                    break
            if hit:
                nm[base + x] = 1
    return nm


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("-o", "--out", default=None, help="输出前缀")
    ap.add_argument("--banner", type=int, default=0, help="顶部横幅高度(px)")
    ap.add_argument("--red-max", type=int, default=40, help="红度上限（>= 视为文字）")
    ap.add_argument("--min-bright", type=int, default=0, help="最低亮度，排除过黑像素")
    ap.add_argument("--minrun", type=int, default=22, help="最短线段长度(px)")
    ap.add_argument("--gap", type=int, default=10, help="补缺口最大长度(px)")
    ap.add_argument("--cell", type=int, default=4, help="网格单元(px)")
    ap.add_argument("--no-dilate", action="store_true")
    args = ap.parse_args()

    if not os.path.exists(args.src):
        sys.exit("找不到输入文件：%s" % args.src)

    img = Image.open(args.src).convert("RGB")
    W, H = img.size
    prefix = args.out or os.path.splitext(args.src)[0].replace("_map", "")

    print("输入 %s  %dx%d" % (args.src, W, H))
    mask = build_mask(img, args.banner, args.red_max, args.min_bright)
    print("  红像素            : %6d (%.2f%%)" % (sum(mask), 100 * sum(mask) / (W * H)))

    mask = filter_runs(mask, W, H, args.minrun)
    print("  线段过滤后        : %6d" % sum(mask))

    mask, kept = filter_components(mask, W, H)
    print("  细长连通域        : %6d 个" % kept)

    mask = close_gaps(mask, W, H, args.gap)
    print("  补缺口后          : %6d" % sum(mask))

    if not args.no_dilate:
        mask = dilate1(mask, W, H)

    out = Image.new("RGB", (W, H), (255, 255, 255))
    op = out.load()
    for i in range(W * H):
        if mask[i]:
            op[i % W, i // W] = (200, 30, 30)
    map_path = prefix + "_map.png"
    out.save(map_path, optimize=True)

    cell = args.cell
    GW, GH = (W + cell - 1) // cell, (H + cell - 1) // cell
    grid = [[0] * GW for _ in range(GH)]
    for gy in range(GH):
        for gx in range(GW):
            hit = 0
            for y in range(gy * cell, min(H, (gy + 1) * cell)):
                if hit:
                    break
                row = y * W
                for x in range(gx * cell, min(W, (gx + 1) * cell)):
                    if mask[row + x]:
                        hit = 1
                        break
            grid[gy][gx] = hit
    grid_path = prefix + "_grid.txt"
    with open(grid_path, "w") as f:
        for row in grid:
            f.write("".join("1" if v else "0" for v in row) + "\n")

    print("  墙体像素          : %6d (%.2f%%)" % (sum(mask), 100 * sum(mask) / (W * H)))
    print("输出 %s" % map_path)
    print("输出 %s  (%dx%d)" % (grid_path, GW, GH))


if __name__ == "__main__":
    main()
