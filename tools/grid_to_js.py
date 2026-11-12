#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""墙数据 → 浏览器 JS（只移除房间内部多余的墙，保留所有必要墙）

规则（按用户要求修正）：
  只删除「房间矩形深处」的墙（办公室里的家具/文字/隔断等多余细节），
  其余墙——走廊边界、房间轮廓、承重墙、楼外轮廓——一律保留。

判定：墙格中心落在任一房间矩形「向内收缩 interior-margin px」之后仍在其内，
      → 判定为「房间内部多余墙」，删除；否则保留。

额外「路网保路」：凡路网（nodes+edges）连了边的走廊，把边线两侧
corridor-half-px 内的墙格挖掉——路网数据说「这里能走」，墙就保证不挡，
这样寻路可达的实验室（含支廊里的 332/333/334/335）都能真实走到。

仍保留闭运算（膨胀 1 格再腐蚀 1 格）：把疏散图上 ≤8px 的双线/细条合并成一堵
实体墙，消灭第一人称里的「栅栏效应」——这一步只合并、不删除必要墙。

输入：assets/floors/B2-3F_grid.txt（448 列 × 480 行，'1'=墙、'0'=可通行）
      assets/floors/B2-3F_data.json（rooms，提供房间矩形）
输出：data/B2-3F_grid.js
      window.FLOOR_GRID          = 保留后的墙掩码（碰撞，与墙矩形同源）
      window.FLOOR_WALLS         = 保留墙矩形 [x,y,x2,y2,w,h]（3D / 总览）
      window.FLOOR_WALLS_REMOVED = 被删墙矩形（总览标黄，人工核对）

用法：
  python tools/grid_to_js.py                       # 默认 close=1格, interior-margin=8px
  python tools/grid_to_js.py --interior-margin-px 6   # 更窄的保留带（多删一点内部墙）
  python tools/grid_to_js.py --no-clean            # 不清理，原始网格直出
"""
import argparse
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "floors", "B2-3F_grid.txt")
DATA_JSON = os.path.join(ROOT, "assets", "floors", "B2-3F_data.json")
OUT = os.path.join(ROOT, "data", "B2-3F_grid.js")

COLS, ROWS, CELL = 448, 480, 4
WIDTH, HEIGHT = 1791, 1920


# ---------------- 形态学：8 邻域膨胀 / 腐蚀 ----------------

def dilate(mask, r):
    out = bytearray(mask)
    for _ in range(r):
        prev = out
        out = bytearray(prev)
        for y in range(ROWS):
            base = y * COLS
            up = base - COLS if y > 0 else -1
            dn = base + COLS if y < ROWS - 1 else -1
            for x in range(COLS):
                if prev[base + x]:
                    continue
                xl = x > 0
                xr = x < COLS - 1
                if (xl and prev[base + x - 1]) or (xr and prev[base + x + 1]) \
                   or (up >= 0 and prev[up + x]) or (dn >= 0 and prev[dn + x]) \
                   or (up >= 0 and xl and prev[up + x - 1]) or (up >= 0 and xr and prev[up + x + 1]) \
                   or (dn >= 0 and xl and prev[dn + x - 1]) or (dn >= 0 and xr and prev[dn + x + 1]):
                    out[base + x] = 1
    return out


def erode(mask, r):
    out = bytearray(mask)
    for _ in range(r):
        prev = out
        out = bytearray(prev)
        for y in range(ROWS):
            base = y * COLS
            up = base - COLS if y > 0 else -1
            dn = base + COLS if y < ROWS - 1 else -1
            for x in range(COLS):
                if not prev[base + x]:
                    continue
                xl = x > 0
                xr = x < COLS - 1
                if not ((xl and prev[base + x - 1]) and (xr and prev[base + x + 1])
                        and (up >= 0 and prev[up + x]) and (dn >= 0 and prev[dn + x])
                        and (up >= 0 and xl and prev[up + x - 1]) and (up >= 0 and xr and prev[up + x + 1])
                        and (dn >= 0 and xl and prev[dn + x - 1]) and (dn >= 0 and xr and prev[dn + x + 1])):
                    out[base + x] = 0
    return out


# ---------------- 房间内部（房间矩形向内收缩 margin 之后仍在其内） ----------------

def interior_mask(rooms, margin):
    m = bytearray(COLS * ROWS)
    half = CELL / 2.0
    for r in rooms:
        rx, ry = r["x"], r["y"]
        rx2, ry2 = r["x"] + r["w"], r["y"] + r["h"]
        ix0, ix1 = rx + margin, rx2 - margin
        iy0, iy1 = ry + margin, ry2 - margin
        if ix0 >= ix1 or iy0 >= iy1:
            continue  # 房间太小，不清理（保底，宁可不删）
        cx0 = max(0, int(ix0 // CELL))
        cx1 = min(COLS - 1, int(ix1 // CELL))
        cy0 = max(0, int(iy0 // CELL))
        cy1 = min(ROWS - 1, int(iy1 // CELL))
        for cy in range(cy0, cy1 + 1):
            cypx = cy * CELL + half
            base = cy * COLS
            for cx in range(cx0, cx1 + 1):
                cxpx = cx * CELL + half
                if ix0 <= cxpx <= ix1 and iy0 <= cypx <= iy1:
                    m[base + cx] = 1
    return m


# ---------------- 路网保路：挖掉边线通道里的墙 ----------------

def dist_to_seg(px, py, x1, y1, x2, y2):
    dx = x2 - x1
    dy = y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(px - x1, py - y1)
    t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    cx = x1 + t * dx
    cy = y1 + t * dy
    return math.hypot(px - cx, py - cy)


def carve_corridors(kept, edges, nodes, half_px):
    """凡路网连了边的地方，把边线两侧 half_px 内的墙格挖掉——保证路网可达。"""
    node_map = {n['id']: (n['x'], n['y']) for n in nodes}
    half = CELL / 2.0
    for e in edges:
        a = node_map.get(e.get('from'))
        b = node_map.get(e.get('to'))
        if not a or not b:
            continue
        x1, y1 = a
        x2, y2 = b
        minx = max(0, int((min(x1, x2) - half_px) // CELL))
        maxx = min(COLS - 1, int((max(x1, x2) + half_px) // CELL))
        miny = max(0, int((min(y1, y2) - half_px) // CELL))
        maxy = min(ROWS - 1, int((max(y1, y2) + half_px) // CELL))
        for cy in range(miny, maxy + 1):
            cypx = cy * CELL + half
            base = cy * COLS
            for cx in range(minx, maxx + 1):
                if not kept[base + cx]:
                    continue
                cxpx = cx * CELL + half
                if dist_to_seg(cxpx, cypx, x1, y1, x2, y2) <= half_px:
                    kept[base + cx] = 0


# ---------------- 掩码 → 矩形（行游程 + 纵向同宽合并） ----------------

def decompose(mask):
    done = []
    active = {}
    for y in range(ROWS):
        base = y * COLS
        runs = []
        x = 0
        while x < COLS:
            if mask[base + x]:
                x0 = x
                while x < COLS and mask[base + x]:
                    x += 1
                runs.append((x0, x - x0))
            else:
                x += 1
        new_active = {}
        for (x0, w) in runs:
            hit = active.get(x0)
            if hit and hit[1] == w:
                hit[0][3] += 1
                new_active[x0] = hit
            else:
                rec = [x0, y, w, 1]
                new_active[x0] = (rec, w)
                done.append(rec)
        active = new_active
    out = []
    for r in done:
        x = r[0] * CELL
        y = r[1] * CELL
        x2 = min(x + r[2] * CELL, WIDTH)
        y2 = min(y + r[3] * CELL, HEIGHT)
        out.append([x, y, x2, y2, x2 - x, y2 - y])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--close-cells", type=int, default=1, help="闭运算半径（格），0=不合并细线")
    ap.add_argument("--interior-margin-px", type=int, default=8, help="房间内部判定留边（px），越小删得越狠")
    ap.add_argument("--corridor-half-px", type=int, default=20, help="路网边线两侧挖开的通道半宽（px）")
    ap.add_argument("--no-carve", action="store_true", help="不按路网挖通道")
    ap.add_argument("--no-clean", action="store_true", help="跳过清理，原始网格直出")
    args = ap.parse_args()

    raw = open(SRC, encoding="utf-8").read().replace("\n", "").replace("\r", "")
    if len(raw) != COLS * ROWS:
        raise SystemExit("网格尺寸不对：期望 %d 格，实际 %d 格" % (COLS * ROWS, len(raw)))
    mask = bytearray(COLS * ROWS)
    for i, ch in enumerate(raw):
        mask[i] = 1 if ch == "1" else 0
    n_raw = sum(mask)

    d = json.load(open(DATA_JSON, encoding="utf-8"))
    rooms = d.get("rooms", [])
    nodes = d.get("nodes", [])
    edges = d.get("edges", [])

    removed_cells = bytearray(COLS * ROWS)
    if args.no_clean:
        kept = mask
    else:
        merged = dilate(mask, args.close_cells) if args.close_cells > 0 else bytearray(mask)
        merged = erode(merged, args.close_cells) if args.close_cells > 0 else merged
        interior = interior_mask(rooms, args.interior_margin_px)
        kept = bytearray(COLS * ROWS)
        for i in range(COLS * ROWS):
            if merged[i] and not interior[i]:
                kept[i] = 1
        # 路网保路：挖掉边线通道里的墙（含节点落点），保证路网可达
        if not args.no_carve:
            carve_corridors(kept, edges, nodes, args.corridor_half_px)
        # 被删 = 原始墙中最终没保留的（房间内部多余墙 + 路网挖掉的走廊假墙）
        for i in range(COLS * ROWS):
            if mask[i] and not kept[i]:
                removed_cells[i] = 1
        print("清理报告：原始墙格 %d → 闭运算后 %d → 保留 %d / 删除 %d"
              % (n_raw, sum(merged), sum(kept), sum(removed_cells)))

    walls = decompose(kept)
    removed_rects = decompose(removed_cells)

    js = (
        "/* 由 tools/grid_to_js.py 生成，请勿手改；\n"
        "   墙网格：%d 列 × %d 行，每格 %dpx，'1'=墙、'0'=可通行，行优先。\n"
        "   清理参数：%s\n"
        "   保留墙矩形 %d 个（含所有必要墙），被删墙矩形 %d 个（房间内部多余墙 + 路网挖开的假墙，总览标黄）。*/\n"
        "window.FLOOR_GRID = {\n"
        '  "cols": %d,\n'
        '  "rows": %d,\n'
        '  "cell": %d,\n'
        '  "width": %d,\n'
        '  "height": %d,\n'
        '  "data": %r\n'
        "};\n"
        "/* 保留墙矩形 [x,y,x2,y2,w,h]，单位 px */\n"
        "window.FLOOR_WALLS = %r;\n"
        "/* 被清理掉的墙矩形（房间内部多余墙，总览图黄色描边显示） */\n"
        "window.FLOOR_WALLS_REMOVED = %r;\n"
    ) % (COLS, ROWS, CELL,
         ("no-clean" if args.no_clean else
          "close-cells=%d interior-margin-px=%d corridor-half-px=%d%s"
          % (args.close_cells, args.interior_margin_px, args.corridor_half_px,
             "" if not args.no_carve else " no-carve")),
         len(walls), len(removed_rects),
         COLS, ROWS, CELL, WIDTH, HEIGHT,
         "".join("1" if v else "0" for v in kept),
         walls, removed_rects)

    with open(OUT, "w", encoding="utf-8") as f:
        f.write(js)

    print("OK 已生成 %s" % OUT)
    print("   保留墙矩形 %d 个，被删墙矩形 %d 个" % (len(walls), len(removed_rects)))
    print("   文件大小 %.0f KB" % (os.path.getsize(OUT) / 1024.0))


if __name__ == "__main__":
    main()
