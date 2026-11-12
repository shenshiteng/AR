# -*- coding: utf-8 -*-
"""1F 板光照校正 + 红墙增强。

问题：这张照片左侧明显偏暗（x<300 处红墙线只有 40% 覆盖率，右侧却有 90%），
     右上方还有一块反光。直接做固定阈值红掩膜，暗部的墙会整片消失。

做法：
  1. 用形态学/大窗口估计背景亮度，做平场校正（除以背景）
  2. 转 HSV，用色相区分"红墙线"和"灰白底/蓝字"
  3. 输出增强图，供后续量坐标
"""
import os

import numpy as np
from PIL import Image

R = r"C:\Users\35391\Desktop\python\实验室定位"
SRC = os.path.join(R, "docs", "img", "floor-1f-photo.jpg")
OUT_IMG = os.path.join(R, "docs", "img", "1f_flat.png")
OUT_MASK = os.path.join(R, "_1f_crops", "1f_mask.png")


def box_blur(a, k):
    """积分图实现的均值模糊（不依赖 scipy）。"""
    pad = k // 2
    p = np.pad(a, pad, mode="edge")
    ii = p.cumsum(0).cumsum(1)
    ii = np.pad(ii, ((1, 0), (1, 0)))
    H, W = a.shape
    out = (ii[k:k + H, k:k + W] - ii[0:H, k:k + W]
           - ii[k:k + H, 0:W] + ii[0:H, 0:W]) / float(k * k)
    return out


def main():
    im = Image.open(SRC).convert("RGB")
    W, H = im.size
    a = np.asarray(im).astype(np.float32)

    # 1) 平场校正：用大窗口背景估计，消除明暗不均
    gray = a.mean(axis=2)
    bg = box_blur(gray, 151)
    bg = np.maximum(bg, 1.0)
    flat = np.clip(gray / bg * 160.0, 0, 255)

    # 2) 红度：相对通道差，用平场后的通道分别算
    fr = np.clip(a[:, :, 0] / bg * 160.0, 0, 255)
    fg = np.clip(a[:, :, 1] / bg * 160.0, 0, 255)
    fb = np.clip(a[:, :, 2] / bg * 160.0, 0, 255)
    redness = fr - np.maximum(fg, fb)

    # 3) 增强图：把红度放大成可视化
    vis = np.stack([flat, flat, flat], axis=2).astype(np.uint8)
    m = redness > 8
    vis[m] = [200, 0, 0]
    Image.fromarray(vis).save(OUT_IMG)

    mk = np.full((H, W, 3), 255, dtype=np.uint8)
    mk[m] = [0, 0, 0]
    Image.fromarray(mk).save(OUT_MASK)

    # 统计：暗部 / 亮部 各自的红覆盖率，验证平场是否有效
    def cov(x1, x2, y1, y2):
        sub = m[y1:y2, x1:x2]
        return sub.sum() / float(sub.size)

    print("平场校正后红覆盖率抽样：")
    print("  左侧暗区 (x150-300, y330-580) : %.1f%%" % (cov(150, 300, 330, 580) * 100))
    print("  中部    (x400-700, y330-580) : %.1f%%" % (cov(400, 700, 330, 580) * 100))
    print("  右侧亮区 (x1100-1400, y330-580): %.1f%%" % (cov(1100, 1400, 330, 580) * 100))
    print("wrote", OUT_IMG, "和", OUT_MASK)


if __name__ == "__main__":
    main()
