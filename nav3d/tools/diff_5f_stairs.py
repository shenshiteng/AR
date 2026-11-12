# -*- coding: utf-8 -*-
"""五楼楼梯/房间 编号·朝向 对照检查图（v2，编号统一）。

上一版 A/B 两图各用一套编号（A 用 ①②③④、B 用 1-5），同一个数字在两张图上
指的不是同一个东西，容易看串。这一版改成：一字母 = 一处错，字母在两张图上是同一物件。

用法：python tools/diff_5f_stairs.py
输出：nav3d/check-5f-stairs.png
"""
import math
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
NAV = os.path.dirname(HERE)
F = "C:/Windows/Fonts/msyh.ttc"
FB = "C:/Windows/Fonts/msyhbd.ttc"

PHOTO = os.path.join(os.path.dirname(NAV), "assets", "floors", "B2-5F.jpg")
PLAN = os.path.join(NAV, "plan-5f.png")
OUT = os.path.join(NAV, "check-5f-stairs.png")

# 照片裁切范围 + 实测边界（像素）
CX0, CY0, CX1, CY1 = 168, 826, 1352, 1200
XW, XE = 175, 1341
YN, YWC, YROW, YCOR, YS = 846, 935, 990, 1036, 1180

TOP, BOT = 92, 58
RED, BLUE, GRN, INK = (214, 30, 42), (20, 80, 210), (0, 122, 58), (55, 55, 62)


def font(sz, bold=False):
    return ImageFont.truetype(FB if bold else F, sz)


def dashed(d, box, col, w=2, dash=9, gap=6):
    x1, y1, x2, y2 = [int(v) for v in box]
    for x in range(x1, x2, dash + gap):
        d.line([(x, y1), (min(x + dash, x2), y1)], fill=col, width=w)
        d.line([(x, y2), (min(x + dash, x2), y2)], fill=col, width=w)
    for y in range(y1, y2, dash + gap):
        d.line([(x1, y), (x1, min(y + dash, y2))], fill=col, width=w)
        d.line([(x2, y), (x2, min(y + dash, y2))], fill=col, width=w)


def arrow(d, x1, y1, x2, y2, col, w=3, head=9):
    d.line([(x1, y1), (x2, y2)], fill=col, width=w)
    a = math.atan2(y2 - y1, x2 - x1)
    for s in (0.5, -0.5):
        d.line([(x2, y2), (x2 - head * math.cos(a + s), y2 - head * math.sin(a + s))],
               fill=col, width=w)


def chip(d, x, y, txt, col, sz=13, bold=False):
    f = font(sz, bold)
    w = d.textlength(txt, font=f)
    d.rectangle([x - 2, y - 1, x + w + 3, y + sz + 4], fill=(255, 255, 255))
    d.text((x + 1, y + 1), txt, font=f, fill=col)
    return w


def main():
    s = 1400.0 / (CX1 - CX0)
    AH = int((CY1 - CY0) * s)
    A = Image.new("RGB", (1400, TOP + AH + BOT), (255, 255, 255))
    A.paste(Image.open(PHOTO).convert("RGB").crop((CX0, CY0, CX1, CY1)).resize(
        (1400, AH), Image.LANCZOS), (0, TOP))
    d = ImageDraw.Draw(A)

    def fx(x):
        return (x - CX0) * s

    def fy(y):
        return TOP + (y - CY0) * s

    for y, txt, col in ((YN, "北外墙 y846", (30, 90, 200)),
                        (YWC, "厕所南墙 y935", GRN),
                        (YROW, "北排南墙 y990", GRN),
                        (YCOR, "走廊南墙 y1036", GRN),
                        (YS, "南外墙 y1180", (30, 90, 200))):
        d.line([(fx(XW), fy(y)), (fx(XE), fy(y))], fill=col, width=2)
        chip(d, fx(XW) + 6, fy(y) - 17, txt, col, 12)

    north = [(178, "女厕"), (259, "男厕"), (318, "西楼梯"),
             (389, "508"), (588, "507"), (791, "504"), (990, "503"),
             (1198, "前室"), (1277, "东楼梯")]
    for x1, name in north:
        d.line([(fx(x1), fy(YN)), (fx(x1), fy(YROW))], fill=(196, 70, 70), width=1)
        chip(d, fx(x1) + 3, fy(YN) + 3, name, (170, 30, 30), 12)

    south = [(XW, "510"), (385, "509"), (586, "506"), (789, "505"),
             (990, "502"), (1198, "501")]
    for i, (x1, name) in enumerate(south):
        x2 = south[i + 1][0] if i + 1 < len(south) else XE
        d.line([(fx(x1), fy(YCOR)), (fx(x1), fy(YS))], fill=(196, 70, 70), width=1)
        chip(d, fx(x1) + 3, fy(YS) - 22, "%s %d-%d" % (name, x1, x2), (170, 30, 30), 12)

    def box(x1, y1, x2, y2, col, w=3):
        d.rectangle([fx(x1), fy(y1), fx(x2), fy(y2)], outline=col, width=w)

    box(178, YN, 318, YWC, GRN)
    box(318, YN, 389, 985, RED)
    box(1277, YN, 1325, 985, RED)
    box(1198, YCOR, XE, YS, BLUE)
    box(990, YCOR, 1198, YS, BLUE)

    for x, y0, col in ((248, 62, GRN), (352, 86, RED), (1301, 86, RED)):
        d.line([(fx(x), y0), (fx(x), fy(YN))], fill=col, width=2)
    d.line([(fx(1270), fy(YS)), (fx(1270), fy(YS) + 20)], fill=BLUE, width=2)

    d.text((10, 22), "A 厕所（女厕+男厕）：北排最西、贴西外墙，两门都朝南开",
           font=font(15, True), fill=GRN)
    d.text((10, 56), "B 西楼梯：厕所【东】侧、不贴西墙，门朝南开（不是朝东）",
           font=font(15, True), fill=RED)
    t3 = "C 东端楼梯＝五楼楼梯：北排东端，门朝南、正对下方 501"
    d.text((1390 - d.textlength(t3, font=font(15, True)), 22), t3,
           font=font(15, True), fill=RED)
    t4 = "D 501 与 502 并排、同在东南角，两门都朝北开向走廊"
    d.text((1390 - d.textlength(t4, font=font(15, True)), fy(YS) + 24), t4,
           font=font(15, True), fill=BLUE)

    # ================= 下半：当前数据 =================
    B = Image.open(PLAN).convert("RGB")
    bw = 1400.0 / B.size[0]
    B = B.resize((1400, int(B.size[1] * bw)), Image.LANCZOS)
    db = ImageDraw.Draw(B)

    def bx(x):
        return (x - 62) * bw

    def by(y):
        return (y - 321) * bw

    should = {
        "A": (102, 361, 251, 440),
        "B": (251, 361, 326, 485),
        "C": (1253, 361, 1320, 485),
        "D": (1171, 530, 1320, 658),
    }
    # 目标区：淡绿底 + 粗虚线框（单独图层叠加，不动原图）
    ov = Image.new("RGBA", B.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(ov)
    for (x1, y1, x2, y2) in should.values():
        od.rectangle([bx(x1), by(y1), bx(x2), by(y2)], fill=(0, 168, 84, 34))
        dashed(od, [bx(x1), by(y1), bx(x2), by(y2)], (0, 150, 70, 255), 3, 10, 6)
    B = Image.alpha_composite(B.convert("RGBA"), ov).convert("RGB")
    db = ImageDraw.Draw(B)
    for k, (x1, y1, x2, y2) in should.items():
        cx, cy = bx(x1) + 13, by(y1) + 13
        db.ellipse([cx - 12, cy - 12, cx + 12, cy + 12], fill=(0, 140, 66))
        tw = db.textlength(k, font=font(16, True))
        db.text((cx - tw / 2 - 1, cy - 11), k, font=font(16, True), fill=(255, 255, 255))

    arrow(db, bx(150), by(505), bx(150), by(446), RED)
    arrow(db, bx(219), by(404), bx(246), by(404), RED, 4, 11)
    arrow(db, bx(1302), by(572), bx(1302), by(492), RED)
    arrow(db, bx(1206), by(432), bx(1206), by(536), RED)
    arrow(db, bx(1141), by(600), bx(1167), by(600), RED, 4, 11)

    return compose(A, B)


def compose(A, B):
    lines = [
        "A  厕所（女厕+男厕）   应为：北排最西、贴西外墙、门朝南  ‖  现在：南排最西 WC-NW1/NW2，门朝北",
        "B  西楼梯            应为：厕所东侧、不贴西墙、门朝南      ‖  现在：占了厕所的位置、贴西墙，门朝东",
        "C  东端楼梯（五楼楼梯） 应为：北排东端、门朝南、正对 501     ‖  现在：南排东南角、门朝西",
        "D  501               应为：南排东南角、紧邻 502、门朝北    ‖  现在：北排 y361-579、门朝西，与东端楼梯上下互换",
        "E  502               应为：x953-1171 紧贴 501 西墙          ‖  现在：x998-1133，中间多出 3F 抄来的竖向走道",
    ]
    BTOP = A.size[1] + 34
    H = BTOP + B.size[1] + 22 + len(lines) * 27 + 14
    img = Image.new("RGB", (1400, H), (255, 255, 255))
    img.paste(A, (0, 0))
    img.paste(B, (0, BTOP))

    d = ImageDraw.Draw(img)
    d.text((6, 2), "A · 五楼疏散板实测（上方为北）：楼梯 / 厕所 / 501 / 502 的真实位置",
           font=font(17, True), fill=(20, 40, 80))
    d.text((6, A.size[1] + 8),
           "B · 当前 data/floor-5f.js：绿色虚框＝板上应在的位置，红箭头＝该挪到哪",
           font=font(17, True), fill=(150, 25, 30))
    ly = BTOP + B.size[1] + 20
    for i, t in enumerate(lines):
        d.text((14, ly + i * 27), t, font=font(15), fill=INK)
    img.save(OUT)
    print("wrote %s  %dx%d" % (OUT, img.size[0], img.size[1]))


if __name__ == "__main__":
    main()
