# -*- coding: utf-8 -*-
"""把 1F 实测墙坐标画成平面图，逐房间标号，用于肉眼核对。

数据全部来自 locate_1f.py 的实测输出（平场校正图 1773x2364）：
  横墙 y: 308(北外墙) 597 605 656 705 828 1053 1117 1174 1306 1409 1468 1551 1600 1747(南外墙)
  竖墙 x: 182 268 322 375 372 491 549 561 734 1101 1113 1153 1242 1402 1651
"""
import os

from PIL import Image, ImageDraw, ImageFont

R = r"C:\Users\35391\Desktop\python\实验室定位"
BASE = os.path.join(R, "docs", "img", "floor-1f-photo.jpg")
OUT = os.path.join(R, "_1f_crops", "plan_check_1f.png")

# ---- 房间表：(id, 名称, x1, y1, x2, y2, kind) ----
ROOMS = [
    # 北区
    ("108", "仿真实验室-1", 182, 308, 491, 597, "lab"),
    ("109", "仿真实验室-2", 549, 308, 734, 597, "lab"),
    ("110", "配电间", 491, 656, 549, 705, "service"),
    ("111", "仿真中心值班室", 491, 705, 549, 828, "service"),
    ("113", "汽车发动机实验室", 561, 597, 1101, 705, "lab"),
    ("112", "轨道车辆/汽车电子实验室-1", 561, 705, 1101, 828, "lab"),
    ("114", "值班室", 1153, 597, 1242, 660, "service"),
    # 西区
    ("107", "土木工程材料实验室-3", 372, 828, 561, 1304, "lab"),
    ("106", "土木工程材料实验室-2", 372, 1304, 561, 1412, "lab"),
    ("105", "配电间", 372, 1412, 561, 1468, "service"),
    ("104", "航空测绘实验室", 372, 1468, 561, 1551, "lab"),
    # 南区
    ("101", "土木工程材料实验室-1 / 土力学 / 工程结构-1 / 力学基础-1",
     561, 1409, 1101, 1747, "lab"),
    ("103", "轨道工程实验室（北交大研究生）", 158, 1600, 343, 1747, "lab"),
    ("102", "沥青实验室", 343, 1600, 535, 1747, "lab"),
    # 东翼：上排 = 115(大) + 楼梯 + 118/119/121；下排 = 116/117/120
    ("115", "汽车底盘实验室-1", 1155, 1040, 1380, 1150, "lab"),
    ("116", "汽车底盘实验室-1", 1155, 1174, 1310, 1306, "lab"),
    ("117", "汽车底盘实验室-2", 1310, 1174, 1470, 1306, "lab"),
    ("120", "汽车底盘实验室-3", 1470, 1174, 1651, 1306, "lab"),
    ("118", "机械学院仓库", 1470, 1053, 1520, 1117, "store"),
    ("119", "自律会活动室", 1520, 1053, 1580, 1117, "room"),
    ("121", "科协活动室", 1580, 1053, 1651, 1117, "room"),
    ("ST-E1", "东侧楼梯", 1380, 1040, 1470, 1117, "stair"),
    # 东侧厕所（3 个隔间，y 分隔线 820/893/943/997）
    ("WC-E1", "女厕（东·北）", 1153, 828, 1242, 893, "toilet"),
    ("WC-E2", "男厕（东·中）", 1153, 893, 1242, 943, "toilet"),
    ("WC-E3", "盥洗（东·南）", 1153, 943, 1242, 997, "toilet"),
    # 西北厕所
    ("WC-N1", "男厕（西北）", 268, 660, 322, 828, "toilet"),
    ("WC-N2", "女厕（西北）", 322, 660, 375, 828, "toilet"),
]

COLORS = {
    "lab": (90, 150, 240),
    "service": (240, 180, 80),
    "store": (170, 170, 170),
    "room": (120, 200, 140),
    "toilet": (160, 210, 160),
    "stair": (255, 160, 60),
}


def font(sz, bold=False):
    p = r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc"
    try:
        return ImageFont.truetype(p, sz)
    except Exception:
        return ImageFont.load_default()


def main():
    im = Image.open(BASE).convert("RGB")
    ov = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    f_id = font(26, True)
    f_kd = font(15)

    for rid, name, x1, y1, x2, y2, kind in ROOMS:
        col = COLORS.get(kind, (150, 150, 150))
        d.rectangle([x1, y1, x2, y2], fill=col + (70,), outline=col + (255,), width=3)
        tw = d.textlength(rid, font=f_id)
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        d.text((cx - tw / 2, cy - 14), rid, font=f_id, fill=(20, 30, 50, 255))
        if x2 - x1 > 60 and y2 - y1 > 40:
            d.text((cx - 10, cy + 14), kind, font=f_kd, fill=(90, 90, 110, 220))

    out = Image.alpha_composite(im.convert("RGBA"), ov).convert("RGB")
    d2 = ImageDraw.Draw(out)
    d2.rectangle([0, 0, 560, 72], fill=(255, 255, 255))
    d2.text((14, 10), "1F 房间矩形核对  共 %d 间" % len(ROOMS), font=font(34, True),
            fill=(20, 30, 50))
    out.save(OUT)
    print("wrote", OUT, out.size)
    print("房间数:", len(ROOMS))


if __name__ == "__main__":
    main()
