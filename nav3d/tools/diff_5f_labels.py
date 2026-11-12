# -*- coding: utf-8 -*-
"""五楼楼梯/房间编号对照检查图（诊断用，不产数据）。

上半：五楼疏散图实测墙线（从 assets/floors/B2-5F.jpg 逐像素量出来的边界）
下半：程序按当前 data/floor-5f.js 画出来的平面

用法：python tools/diff_5f_labels.py
输出：nav3d/check-5f-labels.png
"""
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
NAV = os.path.dirname(HERE)
F = "C:/Windows/Fonts/msyh.ttc"
FB = "C:/Windows/Fonts/msyhbd.ttc"

PHOTO = os.path.join(os.path.dirname(NAV), "assets", "floors", "B2-5F.jpg")
PLAN = os.path.join(NAV, "plan-5f.png")
OUT = os.path.join(NAV, "check-5f-labels.png")

# 照片裁切范围 + 实测边界（像素）
CX0, CY0, CX1, CY1 = 168, 826, 1352, 1200
XW, XE = 175, 1341
YN, YWC, YROW, YCOR, YS = 846, 935, 990, 1036, 1180

TOP, BOT = 96, 58
RED, BLUE, GRN = (214, 30, 42), (20, 80, 210), (0, 122, 58)


def font(sz, bold=False):
    return ImageFont.truetype(FB if bold else F, sz)


def main():
    s = 1400.0 / (CX1 - CX0)
    AH = int((CY1 - CY0) * s)
    A = Image.new("RGB", (1400, TOP + AH + BOT), (255, 255, 255))

    src = Image.open(PHOTO).convert("RGB").crop((CX0, CY0, CX1, CY1)).resize(
        (1400, AH), Image.LANCZOS)
    A.paste(src, (0, TOP))
    d = ImageDraw.Draw(A)

    def fx(x):
        return (x - CX0) * s

    def fy(y):
        return TOP + (y - CY0) * s

    def chip(x, y, txt, col, sz=12, bold=False):
        """白底小标签，压在照片上也能看清。"""
        f = font(sz, bold)
        w = d.textlength(txt, font=f)
        d.rectangle([x - 2, y - 1, x + w + 3, y + sz + 4], fill=(255, 255, 255))
        d.text((x + 1, y + 1), txt, font=f, fill=col)
        return w

    # 行边界
    for y, txt, col in ((YN, "北外墙 y=846", (30, 90, 200)),
                        (YWC, "厕所南墙 y=935", GRN),
                        (YROW, "北排南墙 y=990", GRN),
                        (YCOR, "走廊南墙 y=1036", GRN),
                        (YS, "南外墙 y=1180", (30, 90, 200))):
        d.line([(fx(XW), fy(y)), (fx(XE), fy(y))], fill=col, width=2)
        chip(fx(XW) + 6, fy(y) - 17, txt, col)

    # 北排分格
    north = [(XW, 178, ""), (178, 259, "女厕"), (259, 318, "男厕"),
             (318, 389, "西楼梯"), (389, 588, "508"), (588, 791, "507"),
             (791, 990, "504"), (990, 1198, "503"), (1198, 1277, "前室"),
             (1277, 1325, "东楼梯"), (1325, XE, "")]
    for x1, x2, name in north:
        d.line([(fx(x1), fy(YN)), (fx(x1), fy(YROW))], fill=(196, 70, 70), width=1)
        if name:
            chip(fx(x1) + 3, fy(YN) + 3, "%s %d" % (name, x1), (170, 30, 30))

    # 南排分格
    south = [(XW, "510"), (385, "509"), (586, "506"), (789, "505"),
             (990, "502"), (1198, "501")]
    for i, (x1, name) in enumerate(south):
        x2 = south[i + 1][0] if i + 1 < len(south) else XE
        d.line([(fx(x1), fy(YCOR)), (fx(x1), fy(YS))], fill=(196, 70, 70), width=1)
        chip(fx(x1) + 3, fy(YS) - 22, "%s %d-%d" % (name, x1, x2), (170, 30, 30))

    def box(x1, y1, x2, y2, col, w=3):
        d.rectangle([fx(x1), fy(y1), fx(x2), fy(y2)], outline=col, width=w)

    # 重点框 + 顶部/底部引线
    box(318, YN, 389, 985, RED)
    box(178, YN, 318, YWC, GRN)
    box(1277, YN, 1325, 985, RED)
    box(1198, YCOR, XE, YS, BLUE)
    box(990, YCOR, 1198, YS, BLUE)

    cx_stair = fx(352)
    d.line([(cx_stair, 86), (cx_stair, fy(YN))], fill=RED, width=2)
    cx_wc = fx(240)
    d.line([(cx_wc, 62), (cx_wc, fy(YN))], fill=GRN, width=2)
    cx_est = fx(1301)
    d.line([(cx_est, 86), (cx_est, fy(YN))], fill=RED, width=2)
    cx_501 = fx(1270)
    d.line([(cx_501, fy(YS)), (cx_501, fy(YS) + 22)], fill=BLUE, width=2)

    d.text((10, 26), "① 西楼梯：在厕所【东侧】，不贴西外墙，门朝南开",
           font=font(15, True), fill=RED)
    d.text((10, 62), "② 女厕 + 男厕：贴西外墙，两门都朝南开",
           font=font(15, True), fill=GRN)
    t3 = "③ 东端楼梯（最东边这部）＝五楼楼梯：在走廊【北】侧，门朝南开，正对下方 501"
    d.text((1390 - d.textlength(t3, font=font(15, True)), 26), t3,
           font=font(15, True), fill=RED)
    t4 = "④ 501 与 502 并排、同在东南角，两门都朝北开向走廊"
    d.text((1390 - d.textlength(t4, font=font(15, True)), fy(YS) + 26), t4,
           font=font(15, True), fill=BLUE)

    # ---- 下半：当前模型 ----
    B = Image.open(PLAN).convert("RGB")
    bw = 1400.0 / B.size[0]
    B = B.resize((1400, int(B.size[1] * bw)), Image.LANCZOS)
    db = ImageDraw.Draw(B)

    def bx(x):
        return (x - 62) * bw

    def by(y):
        return (y - 321) * bw

    marks = [(190, 424, "1"), (140, 614, "2"), (1300, 522, "3"),
             (1290, 592, "4"), (1105, 620, "5")]
    for x, y, t in marks:
        cx, cy = bx(x), by(y)
        r = 16
        db.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 248, 234),
                   outline=RED, width=3)
        tw = db.textlength(t, font=font(19, True))
        db.text((cx - tw / 2 - 1, cy - 12), t, font=font(19, True), fill=RED)

    # ---- 拼图 ----
    BTOP = A.size[1] + 34
    lines = [
        "1  STAIR-NW 被放在北排最西、贴着西外墙 —— 实际上这个位置是女厕+男厕，楼梯在它们东侧",
        "2  WC-NW1 / WC-NW2 被放到走廊南排最西 —— 实际上五楼厕所全在走廊北侧，南排最西是 510 的西端",
        "3  501 被放到北排东端、还向下拉长到 y=579 —— 实际上 501 在南排东南角",
        "4  STAIR-NE 被放在南排东南角、门朝西 —— 实际上这个位置就是 501，楼梯应在它正上方的北排",
        "5  502 停在 x998-1133，和 501 之间还夹了一条竖向走道 —— 实际上 502 紧贴 501 西侧，中间没有走道",
    ]
    H = BTOP + B.size[1] + 22 + len(lines) * 27 + 16
    img = Image.new("RGB", (1400, H), (255, 255, 255))
    img.paste(A, (0, 0))
    img.paste(B, (0, BTOP))

    dd = ImageDraw.Draw(img)
    dd.text((6, 2), "A · 五楼疏散图实测（上方为北）：楼梯、厕所、501/502 的真实位置",
            font=font(17, True), fill=(20, 40, 80))
    dd.text((6, A.size[1] + 8),
            "B · 当前 data/floor-5f.js 画出来的样子：楼梯与房间互相顶替",
            font=font(17, True), fill=(150, 25, 30))
    ly = BTOP + B.size[1] + 20
    for i, t in enumerate(lines):
        dd.text((14, ly + i * 27), t, font=font(15), fill=(58, 58, 64))

    img.save(OUT)
    print("wrote %s  %dx%d" % (OUT, img.size[0], img.size[1]))


if __name__ == "__main__":
    main()
