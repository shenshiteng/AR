# -*- coding: utf-8 -*-
"""生成「走廊对拍点位图」—— 拍照指引。

为什么要单独画一张，而不是直接标在疏散板照片上：
    疏散板照片的像素尺寸各层都不一样（2F 1600×2133 / 3F 1791×1920 /
    5F 1440×1920），而楼层数据统一在 1791×1920 这套坐标里。
    把数据坐标画到照片上必然错位，所以这里**直接用数据画平面图**，
    保证红点落在真实走廊上。

图例：蓝=走廊  橙=楼梯  灰白=房间  红点=站位  红箭头=镜头朝向

用法：
    python tools/mark_shots.py B2-3            # 出 3F
    python tools/mark_shots.py all             # 四层全出
"""
import io
import json
import math
import os
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
NAV = os.path.dirname(HERE)

FILES = {"B2-2": "floor-2f.js", "B2-3": "floor-3f.js",
         "B2-4": "floor-4f.js", "B2-5": "floor-5f.js"}
LABEL = {"B2-2": "2F", "B2-3": "3F", "B2-4": "4F", "B2-5": "5F"}

ANG = {"E": 0, "S": 90, "W": 180, "N": 270}   # x 右=东，y 下=南

# 拍摄点位（柱坐标见下方注释）。2F/3F/4F 楼体同构，共用一套。
PTS_234 = [
    # id,   x,    y,   朝向, 看什么
    ("P1", 132, 468, "E", "北走廊西端→东：316~326 一排门 + 西北楼梯门",
                        "西北楼梯口"),
    ("P2", 1105, 468, "W", "北走廊东端→西：423/425/322/320 一排门",
                        "北走廊东端"),
    ("P3", 1160, 520, "S", "服务台→南：服务台门、东北楼梯门",
                        "东北角前室（服务台/楼梯口）"),
    ("P4", 1154, 700, "S", "东走廊北端→南：327/328 门 + 两间厕所",
                        "东北楼梯口出来往南"),
    ("P5", 1154, 1330, "N", "东走廊南端→北：330 门 + 走廊全貌",
                        "东走廊南端"),
    ("P6", 1200, 1062, "E", "东翼横走廊→东：332/329/331 门 + 东楼梯门 + 333 大门",
                        "东翼横走廊西口"),
    ("P7", 1243, 1530, "N", "东南角→北：东南楼梯门 + 301 北门",
                        "东南楼梯口前"),
    ("P8", 1150, 1549, "W", "南走廊东端→西：303/304/307 门 + 南排六间",
                        "南走廊东端"),
    ("P9", 205, 1549, "E", "南走廊西端→东：310~303 一排门",
                        "南走廊西端"),
    ("P10", 281, 1330, "N", "西走廊南端→北：312/313/314 门",
                        "西走廊南端"),
    ("P11", 281, 700, "S", "西走廊北端→南：314 门 + 玻璃幕墙",
                        "西走廊北端"),
    ("P12", 272, 565, "N", "西北穿堂→北：315 北门 + 两间厕所门",
                        "西北穿堂（厕所东侧）"),
    ("P13", 1195, 781, "E", "东盥洗室→东：两间厕所门 + 外墙窗",
                        "东走廊进盥洗室"),
]

PTS_5 = [
    ("Q1", 112, 468, "E", "西端→东：510/509/506 一排南门 + 508/507 北门", "五楼走廊最西端"),
    ("Q2", 1210, 468, "W", "东端→西：501/502/505 一排门 + 走廊全貌", "五楼走廊东段"),
    ("Q3", 286, 468, "N", "西楼梯口→北：楼梯门（正对走廊）", "西楼梯口前"),
    ("Q4", 1290, 468, "N", "东楼梯口→北：楼梯门（正对 501）", "东楼梯口前"),
    ("Q5", 215, 468, "N", "两间厕所→北：女厕/男厕门", "女厕男厕门前"),
]

PAL_ROOM = (247, 249, 252)
PAL_ROOM_EDGE = (168, 178, 195)
PAL_COR = (108, 190, 240)
PAL_COR_EDGE = (36, 132, 196)
PAL_STAIR = (255, 172, 62)
PAL_STAIR_EDGE = (206, 110, 0)
PAL_TOILET = (200, 230, 205)


def load(fn):
    s = io.open(os.path.join(NAV, "data", fn), encoding="utf-8-sig").read()
    i = s.index("= {") + 2
    return json.loads(s[i:].rstrip().rstrip(";"))


def font(sz, bold=False):
    cands = [r"C:\Windows\Fonts\msyhbd.ttc", r"C:\Windows\Fonts\simhei.ttf"]
    if not bold:
        cands = [r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf",
                 r"C:\Windows\Fonts\simsun.ttc"]
    for p in cands:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, sz)
            except Exception:
                pass
    return ImageFont.load_default()


def render(fid, out):
    D = load(FILES[fid])
    W = D["imageWidth"]
    H = D["imageHeight"]

    # --- 先在数据坐标系里画满整张（稍后统一裁剪缩放）---
    im = Image.new("RGB", (W, H), (255, 255, 255))
    d = ImageDraw.Draw(im)

    f_rid = font(22)
    f_name = font(17)
    f_id = font(30, True)
    pts = PTS_5 if fid == "B2-5" else PTS_234

    xs, ys = [], []

    # 房间
    for r in D["rooms"]:
        k = r.get("kind")
        xs += [r["x1"], r["x2"]]
        ys += [r["y1"], r["y2"]]
        if k == "stair":
            continue
        fill = PAL_TOILET if k == "toilet" else PAL_ROOM
        d.rectangle([r["x1"], r["y1"], r["x2"], r["y2"]],
                    fill=fill, outline=PAL_ROOM_EDGE, width=2)
        rid = r["id"]
        tw = d.textlength(rid, font=f_rid)
        if r["x2"] - r["x1"] > tw + 8:
            d.text(((r["x1"] + r["x2"]) / 2 - tw / 2,
                    (r["y1"] + r["y2"]) / 2 - 14), rid,
                   font=f_rid, fill=(28, 38, 58))

    # 走廊
    for c in D.get("corridors", []) + D.get("spurs", []):
        xs += [c["x1"], c["x2"]]
        ys += [c["y1"], c["y2"]]
        d.rectangle([c["x1"], c["y1"], c["x2"], c["y2"]],
                    fill=PAL_COR, outline=PAL_COR_EDGE, width=2)

    # 楼梯
    for r in D["rooms"]:
        if r.get("kind") == "stair":
            d.rectangle([r["x1"], r["y1"], r["x2"], r["y2"]],
                        fill=PAL_STAIR, outline=PAL_STAIR_EDGE, width=3)
            lbl = r["id"].replace("STAIR-", "ST-")
            tw = d.textlength(lbl, font=f_name)
            d.text(((r["x1"] + r["x2"]) / 2 - tw / 2,
                    (r["y1"] + r["y2"]) / 2 - 10), lbl,
                   font=f_name, fill=(90, 40, 0))

    # 拍摄点
    for pid, x, y, dr, note, place in pts:
        a = ANG[dr]
        R = 150
        poly = [(x, y)]
        for k in range(-30, 31, 5):
            ra = math.radians(a + k)
            poly.append((x + R * math.cos(ra), y + R * math.sin(ra)))
        xs += [p[0] for p in poly]
        ys += [p[1] for p in poly]
        d.polygon(poly, fill=(255, 214, 214))
        d.line(poly[1:], fill=(236, 150, 150), width=2)

        L = 74
        ra = math.radians(a)
        ex, ey = x + L * math.cos(ra), y + L * math.sin(ra)
        d.line([x, y, ex, ey], fill=(205, 0, 0), width=6)
        for s in (-148, 148):
            rr = math.radians(a + s)
            d.line([ex, ey, ex + 20 * math.cos(rr), ey + 20 * math.sin(rr)],
                   fill=(205, 0, 0), width=6)

        r0 = 21
        d.ellipse([x - r0, y - r0, x + r0, y + r0], fill=(205, 0, 0),
                  outline=(255, 255, 255), width=3)
        tw = d.textlength(pid, font=f_id)
        d.text((x - tw / 2, y - 17), pid, font=f_id, fill=(255, 255, 255))

    # --- 裁到内容区并放大，让窄条楼层（5F）也看得清 ---
    pad = 46
    bx1, by1 = max(0, min(xs) - pad), max(0, min(ys) - pad)
    bx2, by2 = min(W, max(xs) + pad), min(H, max(ys) + pad)
    crop = im.crop((bx1, by1, bx2, by2))

    OUT_W = 1600
    sc = OUT_W / float(crop.size[0])
    crop = crop.resize((OUT_W, int(round(crop.size[1] * sc))), Image.LANCZOS)

    f_t = font(46, True)
    f_s = font(23)
    rows = (len(pts) + 1) // 2
    idx_h = 52 + 38 * rows
    head_h = 132

    canvas = Image.new("RGB", (OUT_W, head_h + crop.size[1] + idx_h + 40),
                       (255, 255, 255))
    canvas.paste(crop, (0, head_h))
    d2 = ImageDraw.Draw(canvas)

    # 标题
    d2.rectangle([0, 0, OUT_W, head_h - 4], fill=(250, 251, 253))
    d2.line([0, head_h - 4, OUT_W, head_h - 4], fill=(205, 0, 0), width=4)
    d2.text((34, 26), "%s 拍照点位（%d 张，走一圈就够）" % (LABEL[fid], len(pts)),
            font=f_t, fill=(20, 30, 50))

    # 指北针（画在楼层图右上角）
    nx, ny = OUT_W - 96, head_h + 72
    d2.ellipse([nx - 40, ny - 40, nx + 40, ny + 40], fill=(255, 255, 255),
               outline=(150, 160, 180), width=2)
    d2.line([nx, ny + 30, nx, ny - 30], fill=(205, 0, 0), width=4)
    d2.polygon([(nx, ny - 38), (nx - 11, ny - 14), (nx + 11, ny - 14)],
               fill=(205, 0, 0))
    f_n = font(22, True)
    tw = d2.textlength("N", font=f_n)
    d2.text((nx - tw / 2, ny - 84), "N", font=f_n, fill=(205, 0, 0))

    # 站位索引
    iy = head_h + crop.size[1] + 18
    d2.rectangle([20, iy, OUT_W - 20, iy + idx_h], fill=(255, 255, 255),
                 outline=(205, 0, 0), width=3)
    d2.text((40, iy + 12), "站位索引（红点编号 → 站在哪 → 镜头朝哪拍）", font=f_s,
            fill=(150, 20, 20))
    for k, (pid, x, y, dr, note, place) in enumerate(pts):
        col = k // rows
        row = k % rows
        tx = 40 + col * (OUT_W - 80) // 2
        ty = iy + 52 + row * 38
        d2.text((tx, ty), "%s  %s" % (pid, place), font=f_s, fill=(30, 40, 60))

    canvas.save(out)
    print("wrote %s  %s" % (out, canvas.size))


if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else "B2-3"
    targets = list(FILES) if arg == "all" else [arg]
    for fid in targets:
        render(fid, os.path.join(NAV, "_shoot_%s.png" % LABEL[fid].lower()))
