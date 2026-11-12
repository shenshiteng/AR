# -*- coding: utf-8 -*-
"""把任意一层的楼层数据画成 2D 平面核对图（和三维沙盘用同一份数据）。

用法：
  python tools/draw_floor.py 2F
  python tools/draw_floor.py 5F
  python tools/draw_floor.py 3F

输出：plan-2f.png / plan-5f.png / plan-3f.png
"""
import io
import json
import os
import re
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
NAV = os.path.dirname(HERE)
F = "C:/Windows/Fonts/msyh.ttc"
FB = "C:/Windows/Fonts/msyhbd.ttc"

FILES = {"3F": "data/floor-3f.js", "2F": "data/floor-2f.js", "5F": "data/floor-5f.js"}

FILL = {
    "lab": (233, 243, 253),
    "office": (253, 240, 228),
    "room": (233, 247, 238),
    "store": (243, 236, 249),
    "service": (236, 240, 245),
    "toilet": (253, 245, 222),
    "stair": (250, 232, 232),
}
C_WALL = (140, 40, 45)
C_COR = (219, 233, 236)
C_PER = (110, 120, 136)
C_DOOR = (30, 150, 90)


def font(sz, bold=False):
    return ImageFont.truetype(FB if bold else F, sz)


def load(floor):
    s = io.open(os.path.join(NAV, FILES[floor]), encoding="utf-8").read()
    m = re.search(r'=\s*(\{.*\});\s*$', s, re.S)
    return json.loads(m.group(1))


def main():
    floor = sys.argv[1] if len(sys.argv) > 1 else "3F"
    D = load(floor)
    b = D["bounds"]
    pad = 40
    W = b["x2"] - b["x1"] + pad * 2
    H = b["y2"] - b["y1"] + pad * 2 + 90

    img = Image.new("RGB", (W, H), (252, 252, 250))
    d = ImageDraw.Draw(img)

    def X(x):
        return x - b["x1"] + pad

    def Y(y):
        return y - b["y1"] + pad

    # 楼体缺口
    for e in D.get("exterior", []):
        d.rectangle([X(e["x1"]), Y(e["y1"]), X(e["x2"]), Y(e["y2"])], fill=(228, 230, 234))

    # 走廊 / 支廊
    for c in D.get("corridors", []) + D.get("spurs", []):
        d.rectangle([X(c["x1"]), Y(c["y1"]), X(c["x2"]), Y(c["y2"])], fill=C_COR)

    # 天井
    if D.get("atrium"):
        a = D["atrium"]
        d.rectangle([X(a["x1"]), Y(a["y1"]), X(a["x2"]), Y(a["y2"])], fill=(236, 233, 226))

    # 房间
    for r in D["rooms"]:
        d.rectangle([X(r["x1"]), Y(r["y1"]), X(r["x2"]), Y(r["y2"])],
                    fill=FILL.get(r["kind"], (240, 240, 240)))

    # 楼梯踏步
    for st in D.get("stairs", []):
        n = st.get("tread", 8)
        for i in range(1, n):
            if st.get("dir") == "EW":
                xx = X(st["x1"]) + (st["x2"] - st["x1"]) * i / n
                d.line([xx, Y(st["y1"]) + 4, xx, Y(st["y2"]) - 4], fill=(200, 190, 194), width=2)
            else:
                yy = Y(st["y1"]) + (st["y2"] - st["y1"]) * i / n
                d.line([X(st["x1"]) + 4, yy, X(st["x2"]) - 4, yy], fill=(200, 190, 194), width=2)

    # 墙线
    for r in D["rooms"]:
        d.rectangle([X(r["x1"]), Y(r["y1"]), X(r["x2"]), Y(r["y2"])], outline=C_WALL, width=3)
    for w in D.get("wallRuns", []):
        d.line([X(w["x1"]), Y(w["y1"]), X(w["x2"]), Y(w["y2"])], fill=C_WALL, width=3)

    # 门洞（把墙线擦掉一段，画成绿色）
    for r in D["rooms"]:
        os_ = [{"k": r.get("door", "S"), "t": r.get("doorT", 0.5), "w": r.get("doorW")}]
        d2 = r.get("door2")
        if d2:
            if isinstance(d2, dict):
                d2 = [d2]
            os_ += [{"k": o["k"], "t": o.get("t", 0.5), "w": o.get("w")} for o in d2]
        for o in os_:
            k, t = o["k"], o["t"] if o["t"] is not None else 0.5
            dw = (o["w"] or 1.05) * D["pxPerMeter"]
            if k in ("N", "S"):
                cx = r["x1"] + (r["x2"] - r["x1"]) * t
                cx = min(r["x2"] - dw / 2, max(r["x1"] + dw / 2, cx))
                yy = r["y1"] if k == "N" else r["y2"]
                d.line([X(cx - dw / 2), Y(yy), X(cx + dw / 2), Y(yy)], fill=C_DOOR, width=5)
            else:
                cy = r["y1"] + (r["y2"] - r["y1"]) * t
                cy = min(r["y2"] - dw / 2, max(r["y1"] + dw / 2, cy))
                xx = r["x1"] if k == "W" else r["x2"]
                d.line([X(xx), Y(cy - dw / 2), X(xx), Y(cy + dw / 2)], fill=C_DOOR, width=5)

    # 玻璃幕墙
    for g in D.get("glassWalls", []):
        d.line([X(g["x1"]), Y(g["y1"]), X(g["x2"]), Y(g["y2"])], fill=(60, 170, 220), width=6)

    # 外轮廓
    for s in D.get("perimeter", []):
        d.line([X(s["x1"]), Y(s["y1"]), X(s["x2"]), Y(s["y2"])], fill=C_PER, width=7)

    # 房间号（窄房间自动缩字号，避免文字压出墙外）
    for r in D["rooms"]:
        w, h = r["x2"] - r["x1"], r["y2"] - r["y1"]
        if w < 22 or h < 30:
            continue
        txt = r["id"]
        fs = 30 if (w > 110 and h > 60) else 22
        while fs > 9 and d.textlength(txt, font=font(fs, True)) > w - 5:
            fs -= 1
        if fs <= 9:
            continue
        tw = d.textlength(txt, font=font(fs, True))
        cx, cy = X((r["x1"] + r["x2"]) / 2), Y((r["y1"] + r["y2"]) / 2)
        d.text((cx - tw / 2 + 1, cy - fs * 0.65 + 1), txt, font=font(fs, True), fill=(255, 255, 255))
        d.text((cx - tw / 2, cy - fs * 0.65), txt, font=font(fs, True), fill=(70, 70, 110))

    # 支廊标注（前室等没有房号，用灰字标在格子里）
    for sp in D.get("spurs", []):
        w, h = sp["x2"] - sp["x1"], sp["y2"] - sp["y1"]
        txt = sp.get("name", sp["id"]).split("（")[0]
        fs = 16
        while fs > 8 and d.textlength(txt, font=font(fs)) > w - 6:
            fs -= 1
        if fs <= 8:
            continue
        tw = d.textlength(txt, font=font(fs))
        d.text((X((sp["x1"] + sp["x2"]) / 2) - tw / 2, Y((sp["y1"] + sp["y2"]) / 2) - fs * 0.7),
               txt, font=font(fs), fill=(120, 130, 145))

    # 起始点
    sp = D.get("startPx") or {"x": 1150, "y": 742}
    d.ellipse([X(sp["x"]) - 13, Y(sp["y"]) - 13, X(sp["x"]) + 13, Y(sp["y"]) + 13],
              fill=(210, 40, 40), outline=(255, 255, 255), width=3)

    d.text((pad, 14), "%s　%s　共 %d 间　（数据 %s，红点 = 当前位置）"
           % (D["building"], D["name"], len(D["rooms"]), FILES[floor]),
           font=font(26, True), fill=(30, 40, 60))

    out = os.path.join(NAV, "plan-%s.png" % floor.lower())
    img.save(out)
    print("wrote", out, img.size)


if __name__ == "__main__":
    main()
