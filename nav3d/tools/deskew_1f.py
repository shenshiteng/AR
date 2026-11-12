# -*- coding: utf-8 -*-
"""1F 板去倾斜：扫描件/照片有约 -2° 旋转，墙线在图上会斜着走，
不校正的话同一面墙的 y 值会漂移十几像素，房间矩形必然歪。

做法：试一系列旋转角，对红墙做行/列投影直方图，
取"直方图最尖锐"的角度（墙线与坐标轴对齐时，投影峰最高最窄）。
"""
import os

import numpy as np
from PIL import Image

R = r"C:\Users\35391\Desktop\python\实验室定位"
IMG = os.path.join(R, "docs", "img", "floor-1f-photo.jpg")
OUT = os.path.join(R, "docs", "img", "1f_deskew.png")


def red_mask(im):
    a = np.asarray(im.convert("RGB")).astype(np.int16)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    return (r - np.maximum(g, b)) > 12


def score(im):
    m = red_mask(im)
    m[: int(m.shape[0] * 0.12), :] = False
    rows = m.sum(axis=1).astype(np.float64)
    cols = m.sum(axis=0).astype(np.float64)
    # 尖锐度：平方和（对齐时能量集中在少数几行/列）
    return (rows ** 2).sum() + (cols ** 2).sum()


def main():
    im = Image.open(IMG).convert("RGB")
    print("原图", im.size)

    best = None
    for ang in np.arange(-3.0, 1.01, 0.25):
        rot = im.rotate(ang, resample=Image.BICUBIC, expand=False,
                        fillcolor=(255, 255, 255))
        s = score(rot)
        print("  angle=%+.2f°  score=%.3e" % (ang, s))
        if best is None or s > best[1]:
            best = (ang, s)

    ang = best[0]
    print("\n最佳角度 %+.2f°" % ang)

    # 细扫
    for a2 in np.arange(ang - 0.25, ang + 0.26, 0.05):
        rot = im.rotate(a2, resample=Image.BICUBIC, expand=False,
                        fillcolor=(255, 255, 255))
        s = score(rot)
        if s > best[1]:
            best = (a2, s)
    ang = round(best[0], 2)
    print("细扫后 %+.2f°  score=%.3e" % (ang, best[1]))

    rot = im.rotate(ang, resample=Image.BICUBIC, expand=False,
                    fillcolor=(255, 255, 255))
    rot.save(OUT)
    print("wrote", OUT, rot.size)


if __name__ == "__main__":
    main()
