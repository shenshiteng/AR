# -*- coding: utf-8 -*-
"""
生成「最外圈一圈墙」= 楼体外轮廓的闭合边界线段（数据 -> JS）。

为什么不用图纸红线直接圈：
  图纸是拍照扫描件，墙线在几处发虚（LAB 阈值一提就断），flood fill 会从断口漏进楼里，
  圈出来的轮廓碎成几十块（实测只有 208 m²，实际约 2000 m²），不可用。
  改用「房间/走廊数据并集」圈轮廓：数据本身是按图纸实测录的，边界一定闭合。

步骤：
  1. 把 rooms + corridors + spurs 并起来栅格化（= 楼面）。
  2. 闭运算（膨胀 R 再腐蚀 R）补掉房间之间 1~4px 的隔墙缝，让相邻房间连成整体；
     10px 以上的真实开口（门、中庭）不受影响。
  3. 从图外四边 flood fill「外面」；中庭被房间围死灌不进去，不会被当成外边界。
  4. 取「楼面格子 ∩ 四邻有外面」的边，按行/列合并成最长直线段。
  5. 合并后的收尾：同一条线上的碎段（错位 ≤5px、间隔 ≤8px）再并一次，消掉锯齿；
     与玻璃幕墙重合的竖段跳过（玻璃本身就是外墙）。
"""
import json
import numpy as np

SRC = 'data/floor-3f.js'
OUT = 'perimeter_segments.json'
R = 2


def load_data(path):
    s = open(path, encoding='utf-8').read()
    s = s[s.index('{'):].rstrip().rstrip(';')
    return json.loads(s)


def dilate(m, r):
    out = m.copy()
    H, W = m.shape
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            sh = np.zeros_like(m)
            ys = slice(max(dy, 0), H + min(dy, 0))
            yd = slice(max(-dy, 0), H + min(-dy, 0))
            xs = slice(max(dx, 0), W + min(dx, 0))
            xd = slice(max(-dx, 0), W + min(-dx, 0))
            sh[yd, xd] = m[ys, xs]
            out |= sh
    return out


def merge_parallel(segs, gap=10, drift=6):
    """把同一条线上的碎段并起来：竖段看 x，横段看 y。"""
    vert = [list(s) for s in segs if s[0] == s[2]]
    horz = [list(s) for s in segs if s[1] == s[3]]

    def run(items, is_v, gap, drift):
        # 按「线位置」分组，位置相近的归一组
        items.sort(key=lambda s: (s[0] if is_v else s[1]))
        groups = []
        for s in items:
            pos = s[0] if is_v else s[1]
            for g in groups:
                if abs(g['pos'] - pos) <= drift:
                    g['items'].append(s)
                    g['pos'] = sum((t[0] if is_v else t[1]) for t in g['items']) / len(g['items'])
                    break
            else:
                groups.append({'pos': pos, 'items': [s]})
        out = []
        for g in groups:
            spans = sorted(((t[1], t[3]) if is_v else (t[0], t[2])) for t in g['items'])
            merged = []
            for a, b in spans:
                if merged and a - merged[-1][1] <= gap:
                    merged[-1][1] = max(merged[-1][1], b)
                else:
                    merged.append([a, b])
            pos = int(round(g['pos']))
            for a, b in merged:
                if b - a < 12:
                    continue
                out.append((pos, a, pos, b) if is_v else (a, pos, b, pos))
        return out

    return run(vert, True, gap, drift) + run(horz, False, gap, drift)


def main():
    D = load_data(SRC)
    W, H = D['imageWidth'], D['imageHeight']

    mask = np.zeros((H + 2, W + 2), dtype=bool)
    rects = list(D['rooms']) + list(D.get('corridors') or []) + list(D.get('spurs') or [])
    for r in rects:
        mask[int(r['y1']) + 1:int(r['y2']) + 2, int(r['x1']) + 1:int(r['x2']) + 2] = True

    solid = ~dilate(~dilate(mask, R), R)

    outside = np.zeros_like(solid)
    outside[0, :] = outside[-1, :] = True
    outside[:, 0] = outside[:, -1] = True
    while True:
        grow = outside.copy()
        grow[1:, :] |= outside[:-1, :]
        grow[:-1, :] |= outside[1:, :]
        grow[:, 1:] |= outside[:, :-1]
        grow[:, :-1] |= outside[:, 1:]
        grow &= ~solid
        if np.array_equal(grow, outside):
            break
        outside = grow

    up = np.zeros_like(solid);    up[1:, :] = solid[1:, :] & outside[:-1, :]
    down = np.zeros_like(solid);  down[:-1, :] = solid[:-1, :] & outside[1:, :]
    left = np.zeros_like(solid);  left[:, 1:] = solid[:, 1:] & outside[:, :-1]
    right = np.zeros_like(solid); right[:, :-1] = solid[:, :-1] & outside[:, 1:]

    def merge_h(flags):
        out = []
        for y in range(flags.shape[0]):
            xs_ = np.nonzero(flags[y])[0]
            if not len(xs_):
                continue
            start = prev = xs_[0]
            for x in xs_[1:]:
                if x == prev + 1:
                    prev = x; continue
                out.append((int(start) - 1, y - 1, int(prev) - 1, y - 1)); start = prev = x
            out.append((int(start) - 1, y - 1, int(prev) - 1, y - 1))
        return out

    def merge_v(flags):
        out = []
        for x in range(flags.shape[1]):
            ys_ = np.nonzero(flags[:, x])[0]
            if not len(ys_):
                continue
            start = prev = ys_[0]
            for y in ys_[1:]:
                if y == prev + 1:
                    prev = y; continue
                out.append((x - 1, int(start) - 1, x - 1, int(prev) - 1)); start = prev = y
            out.append((x - 1, int(start) - 1, x - 1, int(prev) - 1))
        return out

    segs = merge_h(up) + merge_h(down) + merge_v(left) + merge_v(right)
    segs = merge_parallel(segs)

    glass = D.get('glassWalls') or []

    def is_glass(s):
        x1, y1, x2, y2 = s
        if x1 != x2:
            return False
        for g in glass:
            if g['x1'] == g['x2'] and abs(g['x1'] - x1) <= 6:
                if min(y2, g['y2']) - max(y1, g['y1']) > 10:
                    return True
        return False

    segs = [s for s in segs if not is_glass(s)]
    # 去重（合并后可能产生包含关系的两段）
    uniq = []
    for s in segs:
        if s not in uniq:
            uniq.append(s)
    uniq.sort(key=lambda s: (s[1], s[0]))

    total = sum(abs(s[2] - s[0]) + abs(s[3] - s[1]) for s in uniq)
    print('segments:', len(uniq), ' total = %.1f m' % (total / D['pxPerMeter']))
    for s in uniq:
        print('  %4d,%4d -> %4d,%4d   len=%d' % (s[0], s[1], s[2], s[3],
                                                  abs(s[2] - s[0]) + abs(s[3] - s[1])))
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump([{'x1': s[0], 'y1': s[1], 'x2': s[2], 'y2': s[3]} for s in uniq],
                  f, ensure_ascii=False, indent=1)
    print('\n---- JS ----')
    print(',\n'.join('    { "x1":%d, "y1":%d, "x2":%d, "y2":%d }' % s for s in uniq))


if __name__ == '__main__':
    main()
