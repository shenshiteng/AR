# -*- coding: utf-8 -*-
"""nav3d 路网自检脚本（与页面里的栅格模型一一对应）

模型规则（2026-11-11 改版：只认走廊，不再"全图默认可走"）：
1. 初始全部不可走 —— 楼板只存在于走廊/支廊上，其他地方（楼体缺口、房间内部、
   楼外空白）一律不是可走地面。老版本是"默认全走 + 只把房间挖成障碍"，
   结果房间之间的空白、楼外广场全都成了路，寻路会绕着楼外面穿墙进去。
2. 清空 corridors + spurs → 可走
3. 阻挡 wallRuns（补墙段）—— 让"视觉上封住的墙"在寻路里也真的挡人
4. 房间、楼梯、中庭、楼体缺口：本来就是不可走，不用再挖

用法：
  python tools/check_grid.py            # 报告
  python tools/check_grid.py --ascii    # 额外打印走廊拓扑 ASCII 图
"""
import io
import json
import re
import sys
from collections import deque

STEP = 6
PAD = 9
OUT = 44          # doorCandidates 里门点离墙的距离（px）

FLOOR_FILES = {
    '3F': 'data/floor-3f.js',
    '2F': 'data/floor-2f.js',
    '5F': 'data/floor-5f.js',
    '4F': 'data/floor-4f.js',
    '1F': 'data/floor-1f.js',
}
NAV = FLOOR_FILES['3F']


def load(path=None):
    path = path or NAV
    s = io.open(path, encoding='utf-8').read()
    # 3 层是 window.FLOOR_DATA = {...}；2/5 层是 window.FLOOR_DATA_BY_ID["B2-x"] = {...}
    m = re.search(r'window\.FLOOR_DATA\s*=\s*(\{.*\});\s*$', s, re.S)
    if not m:
        m = re.search(r'window\.FLOOR_DATA_BY_ID\["[^"]+"\]\s*=\s*(\{.*\});\s*$', s, re.S)
    return json.loads(m.group(1))


class Grid(object):
    def __init__(self, D):
        self.D = D
        self.W = int(-(-D['imageWidth'] // STEP))
        self.H = int(-(-D['imageHeight'] // STEP))
        self.b = bytearray([1]) * (self.W * self.H)   # 1 = 不可走
        self._build()

    def rect(self, x1, y1, x2, y2):
        return (max(0, int(x1 // STEP)), max(0, int(y1 // STEP)),
                min(self.W - 1, -(-int(x2) // STEP)), min(self.H - 1, -(-int(y2) // STEP)))

    def _fill(self, x1, y1, x2, y2, val):
        gx1, gy1, gx2, gy2 = self.rect(x1, y1, x2, y2)
        for gy in range(gy1, gy2 + 1):
            base = gy * self.W
            for gx in range(gx1, gx2 + 1):
                self.b[base + gx] = val

    def _build(self):
        D = self.D
        for c in D.get('corridors', []) + D.get('spurs', []):
            self._fill(c['x1'], c['y1'], c['x2'], c['y2'], 0)
        # 补墙段：沿线的窄带全部挡死（含带门的，因为门后面就是楼梯/房间，不是走廊）
        for w in D.get('wallRuns', []):
            self._fill(min(w['x1'], w['x2']) - 2, min(w['y1'], w['y2']) - 2,
                       max(w['x1'], w['x2']) + 2, max(w['y1'], w['y2']) + 2, 1)

    def free(self, gx, gy):
        if gx < 0 or gy < 0 or gx >= self.W or gy >= self.H:
            return False
        return self.b[gy * self.W + gx] == 0

    def free_px(self, x, y):
        return self.free(int(round(x / STEP)), int(round(y / STEP)))

    def nearest_free(self, x, y, max_rad=45):
        g0 = (int(round(x / STEP)), int(round(y / STEP)))
        if self.free(*g0):
            return g0
        for rad in range(1, max_rad + 1):
            for dy in range(-rad, rad + 1):
                for dx in range(-rad, rad + 1):
                    if max(abs(dx), abs(dy)) != rad:
                        continue
                    if self.free(g0[0] + dx, g0[1] + dy):
                        return (g0[0] + dx, g0[1] + dy)
        return None

    def components(self):
        comp = [-1] * (self.W * self.H)
        n = 0
        sizes = []
        for gy in range(self.H):
            for gx in range(self.W):
                i = gy * self.W + gx
                if self.b[i] != 0 or comp[i] >= 0:
                    continue
                q = deque([(gx, gy)])
                comp[i] = n
                sz = 0
                while q:
                    cx, cy = q.popleft()
                    sz += 1
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nx, ny = cx + dx, cy + dy
                        if not self.free(nx, ny):
                            continue
                        j = ny * self.W + nx
                        if comp[j] >= 0:
                            continue
                        comp[j] = n
                        q.append((nx, ny))
                sizes.append(sz)
                n += 1
        return comp, sizes

    def comp_at(self, comp, x, y):
        if not self.free_px(x, y):
            return None
        g = (int(round(x / STEP)), int(round(y / STEP)))
        return comp[g[1] * self.W + g[0]]


def openings(r):
    """房间实际开着的面：主门 + door2（数组或单个）+ open（整面墙拆掉）"""
    out = [{'k': r.get('door', 'S'), 't': r.get('doorT', 0.5), 'w': r.get('doorW')}]
    d2 = r.get('door2')
    if d2:
        if isinstance(d2, dict):
            d2 = [d2]
        for o in d2:
            out.append({'k': o['k'], 't': o.get('t', 0.5), 'w': o.get('w')})
    for k in (r.get('open') or []):
        out.append({'k': k, 't': 0.5, 'w': None})
    return out


def door_pt(r, o):
    k, t = o['k'], o['t']
    if k in ('N', 'S'):
        x = r['x1'] + (r['x2'] - r['x1']) * t
        y = r['y1'] - OUT if k == 'N' else r['y2'] + OUT
    else:
        y = r['y1'] + (r['y2'] - r['y1']) * t
        x = r['x1'] - OUT if k == 'W' else r['x2'] + OUT
    return x, y


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    floor = args[0] if args else '3F'
    D = load(FLOOR_FILES.get(floor, floor))
    print('=== 楼层 %s（%s）' % (floor, D.get('name', '')))
    g = Grid(D)
    comp, sizes = g.components()
    sp = D.get('startPx') or {'x': 1150, 'y': 742}
    start = g.nearest_free(sp['x'], sp['y'])
    main_c = comp[start[1] * g.W + start[0]]
    print('起点 (%d,%d) → 格 %s，连通块 #%d，块大小 %d' % (sp['x'], sp['y'], start, main_c, sizes[main_c]))
    print('全图连通块数 %d（>1 说明路网被切成好几段，全部房间不可能都通）' % len(sizes))
    if len(sizes) > 1:
        for i, sz in enumerate(sizes):
            if sz > 30:
                print('   块 #%d  大小 %d %s' % (i, sz, '(起点所在)' if i == main_c else ''))
    print()

    bad = []
    via_bad = []
    print('%-9s %-4s %-14s %-8s %s' % ('房间', '门', '门点', '可走?', '属于起点所在块?'))
    for r in D['rooms']:
        k = r.get('door', 'S')
        if r.get('via'):
            continue
        ok = False
        detail = []
        for o in openings(r):
            x, y = door_pt(r, o)
            if not g.free_px(x, y):
                detail.append('%s@(%d,%d) 格子不可走' % (o['k'], x, y))
                continue
            c = g.comp_at(comp, x, y)
            if c == main_c:
                ok = True
                detail.append('%s@(%d,%d) OK' % (o['k'], x, y))
            else:
                detail.append('%s@(%d,%d) 在块#%d（孤立）' % (o['k'], x, y, c))
        print('%-9s %-4s %-14s %-8s %s' % (r['id'], k, '', 'OK' if ok else 'FAIL', '; '.join(detail)))
        if not ok:
            bad.append(r['id'])

    print()
    print('=== 套间（via）：必须只能经由宿主房间进入 ===')
    for r in D['rooms']:
        if not r.get('via'):
            continue
        host = None
        for h in D['rooms']:
            if h['id'] == r['via']:
                host = h
        prob = []
        # 1) 门必须落在与宿主共用的那道墙上，且门洞中心在宿主的跨度内
        #    （335 比 333 东边多出 21px 是正常的，判的是"门"不是"整个房间"）
        k = r.get('door')
        t = r.get('doorT', 0.5)
        cx = r['x1'] + (r['x2'] - r['x1']) * t if k in ('N', 'S') else None
        if k == 'S' and host and abs(r['y2'] - host['y1']) <= 4:
            if not (host['x1'] - 2 <= cx <= host['x2'] + 2):
                prob.append('门洞中心 x=%d 落在宿主跨度外' % cx)
        elif k == 'N' and host and abs(r['y1'] - host['y2']) <= 4:
            if not (host['x1'] - 2 <= cx <= host['x2'] + 2):
                prob.append('门洞中心 x=%d 落在宿主跨度外' % cx)
        else:
            prob.append('门没开在宿主那面墙上（door=%s）' % k)
        # 2) 自己不能有任何一个门点直接落在公共走廊里（否则就是穿墙直达）
        for o in openings(r):
            x, y = door_pt(r, o)
            if g.free_px(x, y):
                c = g.comp_at(comp, x, y)
                if c == main_c:
                    prob.append('%s 面的门点直接通到公共走廊 → 穿墙直达' % o['k'])
        print('%-9s via %-6s %s' % (r['id'], r['via'], 'OK' if not prob else 'FAIL: ' + '; '.join(prob)))
        if prob:
            via_bad.append(r['id'])

    print()
    for w in D.get('wallRuns', []):
        holes = '门' if w.get('door') else ('窗' if w.get('win') else '无洞')
        print('补墙 %-10s (%d,%d)-(%d,%d) %s' % (w['id'], w['x1'], w['y1'], w['x2'], w['y2'], holes))

    print()
    print('FAIL 房间:', bad if bad else '无')
    print('FAIL 套间:', via_bad if via_bad else '无')
    return 0 if (not bad and not via_bad) else 1


if __name__ == '__main__':
    sys.exit(main())
