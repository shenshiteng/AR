# -*- coding: utf-8 -*-
"""投影法找横竖红线坐标"""
import cv2, numpy as np

SRC = "../../assets/floors/B2-3F.jpg"
img = cv2.imread(SRC)
h, w = img.shape[:2]
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
m1 = cv2.inRange(hsv, (0, 70, 50), (12, 255, 255))
m2 = cv2.inRange(hsv, (165, 70, 50), (180, 255, 255))
mask = cv2.bitwise_or(m1, m2)

# 只保留长线段：用开运算去掉文字（文字笔画短）
kH = cv2.getStructuringElement(cv2.MORPH_RECT, (60, 1))
kV = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 60))
hor = cv2.erode(mask, kH); hor = cv2.dilate(hor, kH)
ver = cv2.erode(mask, kV); ver = cv2.dilate(ver, kV)

def peaks(arr, thr):
    idx = np.where(arr > thr)[0]
    out = []
    if len(idx) == 0: return out
    s = idx[0]; p = idx[0]
    for i in idx[1:]:
        if i - p > 6:
            out.append((s, p)); s = i
        p = i
    out.append((s, p))
    return [ (a+b)//2 for a, b in out ]

colsum = ver.sum(axis=0) / 255.0
rowsum = hor.sum(axis=1) / 255.0
xs = peaks(colsum, 120)
ys = peaks(rowsum, 150)
print("竖线 x:", xs)
print("横线 y:", ys)
print("len x", len(xs), "len y", len(ys))
