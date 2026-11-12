# -*- coding: utf-8 -*-
"""五楼「板子 vs 修正后数据」对照图（修正完成后出图，证明两者一致）。

左/上：B2-5F 疏散板裁切（实测边界 y846/935/990/1036/1180）
右/下：修正后 data/floor-5f.js 画出的 plan-5f.png

用法：python tools/diff_5f_fixed.py
输出：nav3d/check-5f-fixed.png
"""
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
NAV = os.path.dirname(HERE)
F = "C:/Windows/Fonts/msyh.ttc"
FB = "C:/Windows/Fonts/msyhbd.ttc"

PHOTO = os.path.join(os.path.dirname(NAV), "assets", "floors", "B2-5F.jpg")
PLAN = os.path.join(NAV, "plan-5f.png")
OUT = os.path.join(NAV, "check-5f-fixed.png")

W = 1320          # 图片宽
M = 118           # 右侧标注栏宽
BAR = 40          # 每条标题栏高
GAP = 16


def font(sz, bold=False):
    return ImageFont.truetype(FB if bold else F, sz)


def fit(im, w):
    h = int(im.height * (w / float(im.width)))
    return im.resize((w, h), Image.LANCZOS)


def main():
    ph = fit(Image.open(PHOTO).convert("RGB").crop((168, 826, 1352, 1200)), W)
    pl = fit(Image.open(PLAN).convert("RGB"), W)

    H = BAR + ph.height + GAP + BAR + pl.height + 20
    img = Image.new("RGB", (W + M, H), (255, 255, 255))
    d = ImageDraw.Draw(img)

    y = 0
    d.rectangle([0, y, W + M, y + BAR], fill=(232, 239, 247))
    d.text((14, y + 8), "① B2-5F 疏散板（照片实测）", font=font(20, True), fill=(20, 40, 70))
    d.text((470, y + 12), "北排：女厕 | 男厕 | 西楼梯 | 508 507 504 503 | 前室 | 东楼梯　　"
                          "南排：510 509 506 505 502 501",
           font=font(15), fill=(60, 75, 95))
    y += BAR
    img.paste(ph, (0, y))
    # 板子上标出行边界
    d = ImageDraw.Draw(img)
    for yy, txt in ((846, "y846 北外墙"), (990, "y990 北排南墙"), (1036, "y1036 走廊南墙"), (1180, "y1180 南外墙")):
        sy = y + int((yy - 826) / (1200.0 - 826) * ph.height)
        d.line([(0, sy), (W + M, sy)], fill=(0, 150, 80), width=1)
        d.text((W + 6, sy - 8), txt.split(" ")[0], font=font(13, True), fill=(0, 120, 60))
        d.text((W + 6, sy + 6), txt.split(" ")[1], font=font(11), fill=(0, 120, 60))
    y += ph.height

    y += GAP
    d.rectangle([0, y, W + M, y + BAR], fill=(226, 243, 232))
    d.text((14, y + 8), "② 修正后 data/floor-5f.js（同一顺序、同一门朝向）", font=font(20, True), fill=(16, 70, 40))
    d.text((620, y + 12), "厕所贴西墙 · 楼梯在厕所东侧 · 全部门朝走廊 · 东楼梯在 501 正上方",
           font=font(15), fill=(40, 85, 60))
    y += BAR
    img.paste(pl, (0, y))

    img.save(OUT)
    print("wrote", OUT, img.size)


if __name__ == "__main__":
    main()
