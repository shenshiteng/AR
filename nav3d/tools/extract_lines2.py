# -*- coding: utf-8 -*-
"""用"最长连续红段"找墙线，比 Hough 干净：文字笔画高度只有 50-60px，房间边框至少 70px"""
import cv2, numpy as np, json, io

SRC = "../../assets/floors/B2-3F.jpg"
img = cv2.imread(SRC)
h, w = img.shape[:2]

b, g, r = cv2.split(img.astype(np.int16))
red = ((r - g > 25) & (r - b > 25) & (r > 55)).astype(np.uint8)
red = cv2.morphologyEx(red, cv2.MORPH_CLOSE, np.ones((3,3), np.uint8), iterations=1)

MINLEN = 70
MAXGAP = 4

def longest_run(vec, maxgap=MAXGAP):
    """返回最长的"允许小空隙"的连续段 (start, end, length)"""
    idx = np.where(vec > 0)[0]
    if len(idx) == 0: return (0, 0, 0)
    best = (idx[0], idx[0])
    s = idx[0]; p = idx[0]
    for i in idx[1:]:
        if i - p <= maxgap:
            p = i
        else:
            if p - s > best[1] - best[0]: best = (s, p)
            s = i; p = i
    if p - s > best[1] - best[0]: best = (s, p)
    return (best[0], best[1], best[1]-best[0]+1)

# 竖线
vlines = []
for x in range(w):
    y1, y2, L = longest_run(red[:, x])
    if L >= MINLEN:
        vlines.append((x, int(y1), int(y2), int(L)))

# 横线
hlines = []
for y in range(h):
    x1, x2, L = longest_run(red[y, :])
    if L >= MINLEN:
        hlines.append((y, int(x1), int(x2), int(L)))

print("raw v", len(vlines), "raw h", len(hlines))

def merge(segs, tol=4):
    """把相邻坐标合并成一条墙线（取中位 x，合并 y 范围）"""
    segs = sorted(segs, key=lambda s: s[0])
    out = []
    cur = [segs[0]] if segs else []
    for s in segs[1:]:
        if s[0] - cur[-1][0] <= tol:
            cur.append(s)
        else:
            out.append(cur); cur = [s]
    if cur: out.append(cur)
    res = []
    for grp in out:
        pos = int(round(sum(s[0] for s in grp)/len(grp)))
        a = min(s[1] for s in grp); b2 = max(s[2] for s in grp)
        res.append((pos, a, b2))
    return res

V = merge(vlines)
Hh = merge(hlines)
print("merged V", len(V)); print([v[0] for v in V])
print("merged H", len(Hh)); print([v[0] for v in Hh])

json.dump({"V":V, "H":Hh}, io.open("_walls.json","w"), ensure_ascii=False)

vis = img.copy()
for (x,a,b2) in V: cv2.line(vis,(x,a),(x,b2),(255,0,255),3)
for (y,a,b2) in Hh: cv2.line(vis,(a,y),(b2,y),(0,200,0),3)
cv2.imwrite("_probe_lines2.png", vis)
print("saved _probe_lines2.png")
