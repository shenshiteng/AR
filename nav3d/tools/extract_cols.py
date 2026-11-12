# -*- coding: utf-8 -*-
"""按竖带做行投影，找横向隔墙"""
import cv2, numpy as np, json, io

SRC = "../../assets/floors/B2-3F.jpg"
img = cv2.imread(SRC)
lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
A = cv2.split(lab)[1]
red = ((A > 138).astype(np.uint8))*255
red = cv2.morphologyEx(red, cv2.MORPH_CLOSE, np.ones((3,3), np.uint8), iterations=1)/255

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

COLS = [
 (16, 100, "最左 女厕区"),
 (102, 254, "左侧楼梯/厕所带"),
 (308, 469, "左列 314/313/312"),
 (470, 1125, "中庭大空间"),
 (1128, 1180, "中廊"),
 (1180, 1420, "右列 卫生间/办公室"),
 (1420, 1760, "最右 334/335/333"),
 (1180, 1400, "右上 咨询服务台"),
]
res={}
for x1, x2, name in COLS:
    sub = red[:, x1:x2]
    rowsum = sub.sum(axis=1)
    wid = x2-x1
    ys = peaks(rowsum, wid*0.7)
    ys2 = peaks(rowsum, wid*0.4)
    res[name] = {"x":[x1,x2], "ys_strict":ys, "ys_loose":ys2}
    print("=== %s  x=%d..%d  w=%d" % (name, x1, x2, wid))
    print("   strict:", ys)
    print("   loose :", ys2)

json.dump(res, io.open("_cols.json","w",encoding="utf-8"), ensure_ascii=False, indent=1)
