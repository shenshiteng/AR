# -*- coding: utf-8 -*-
"""按行带/列带分区投影，精确找隔墙位置"""
import cv2, numpy as np, json, io

SRC = "../../assets/floors/B2-3F.jpg"
img = cv2.imread(SRC)
h, w = img.shape[:2]

lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
L, A, B = cv2.split(lab)
red = ((A > 138).astype(np.uint8))
red = cv2.morphologyEx(red*255, cv2.MORPH_CLOSE, np.ones((3,3), np.uint8), iterations=1) / 255

def peaks(arr, thr, gap=6):
    idx = np.where(arr >= thr)[0]
    if len(idx) == 0: return []
    out, s, p = [], idx[0], idx[0]
    for i in idx[1:]:
        if i - p > gap:
            out.append(int(round((s+p)/2))); s = i
        p = i
    out.append(int(round((s+p)/2)))
    return out

BANDS = [(361,442,"R1 顶排"), (495,657,"R2 第二排"),
         (680,1360,"R3 中部"), (1362,1521,"R4 底排上"), (1575,1738,"R5 底排下")]

result = {}
for y1, y2, name in BANDS:
    sub = red[y1:y2, :]
    colsum = sub.sum(axis=0)
    hgt = y2 - y1
    thr = hgt * 0.72          # 竖线要几乎贯穿整带
    xs = peaks(colsum, thr)
    xs2 = peaks(colsum, hgt*0.45)
    result[name] = {"y":[y1,y2], "xs_strict":xs, "xs_loose":xs2}
    print("=== %s  y=%d..%d  h=%d" % (name, y1, y2, hgt))
    print("   strict(%.0f):" % thr, xs)
    print("   loose :", xs2)

json.dump(result, io.open("_bands.json","w",encoding="utf-8"), ensure_ascii=False, indent=1)
