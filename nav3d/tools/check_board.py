# -*- coding: utf-8 -*-
"""板照体检：拍回来先跑这个，不合格别往下做。

量什么：
    楼体红墙线的像素跨度 → 除以该楼层"建筑实际宽度" → 得到 px/m
    → 推算"0.65m 的门在这张图上占几像素"

为什么必须按楼层取不同的"实际宽度"：
    1F/2F/3F/4F 是整层（外轮廓 x16~1760，宽 1744px = 67.1m）；
    5F 只占北翼（x102~1320，宽 1218px = 46.8m），楼体本来就窄，
    拿整层宽度去除会把 5F 误判成"分辨率不足"（实测 27.6 px/m 其实是最好的）。

判断标准（0.65m 门至少占 15px 才可信）：
    ≥19 px  → 优秀，门宽误差 <5cm
    17~19   → 合格，误差 ≈8cm（3F 基准水平）
    14~17   → 勉强，门位能定但门宽不可信
    <14     → 作废，重拍

用法：
    python tools/check_board.py                     # 体检现有全部板子
    python tools/check_board.py 路径/B2-4F.jpg --floor B2-4
    python tools/check_board.py 路径/B2-5F.jpg --floor B2-5
"""
import io
import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
NAV = os.path.dirname(HERE)
ROOT = os.path.dirname(NAV)

DOOR_M = 0.65           # 典型单开门净宽
MIN_DOOR_PX = 15.0      # 门宽可信下限
REF_PPM = 26.0          # 3F 基准：26 px = 1 m

# 各层"建筑实际宽度"（米），由 data/floor-*.js 的 bounds 反算
# 整层 x16~1760 = 1744px ÷ 26 = 67.08m；5F 北翼 x102~1320 = 1218px ÷ 26 = 46.85m
FLOOR_WIDTH_M = {
    "B2-1": 67.08,   # 尚无数据，按整层估
    "B2-2": 67.08,
    "B2-3": 67.08,
    "B2-4": 67.08,
    "B2-5": 46.85,   # 只占北翼
}

# 触边判定：边缘若干列里红像素"够多"才算被裁（避免噪点误报）
EDGE_BAND = 3
EDGE_MIN_PIX = 60


def data_width_of(fid):
    """优先从数据文件读 bounds 算宽度，读不到就用表里的常数。"""
    fn = os.path.join(NAV, "data", "floor-%sf.js" % fid[-1]) if fid != "B2-1" \
        else None
    try:
        if fn and os.path.exists(fn):
            s = io.open(fn, encoding="utf-8-sig").read()
            i = s.index("= {") + 2
            D = json.loads(s[i:].rstrip().rstrip(";"))
            bd = D["bounds"]
            return (bd["x2"] - bd["x1"]) / float(D.get("pxPerMeter", REF_PPM))
    except Exception:
        pass
    return FLOOR_WIDTH_M.get(fid)


def analyse(path, fid="B2-3"):
    im = Image.open(path).convert("RGB")
    W, H = im.size
    a = np.asarray(im).astype(np.int16)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    red = (r - np.maximum(g, b)) > 12

    # 去掉顶部蓝色标题带 和 底部图例带，只留图面
    red[: int(H * 0.22), :] = False

    # 触边检测（先做，用完整图宽度判断）
    left = red[:, :EDGE_BAND].sum()
    right = red[:, W - EDGE_BAND:].sum()
    clipped = []
    if left >= EDGE_MIN_PIX:
        clipped.append("左")
    if right >= EDGE_MIN_PIX:
        clipped.append("右")

    ys, xs = np.nonzero(red)
    if len(xs) == 0:
        return {"ok": False, "reason": "没检测到红墙线（照片糊了或不是疏散图）"}

    x1, x2 = int(xs.min()), int(xs.max())
    span_x = x2 - x1

    width_m = data_width_of(fid)
    ppm = span_x / width_m
    door_px = DOOR_M * ppm

    if door_px >= 19:
        grade, ok = "优秀", True
    elif door_px >= 17:
        grade, ok = "合格", True
    elif door_px >= 14:
        grade, ok = "勉强", False
    else:
        grade, ok = "作废", False

    # 触边的直接判不合格（房间框会缺）
    if clipped:
        ok = False

    return {
        "ok": ok, "size": (W, H), "span_x": span_x,
        "width_m": width_m, "ppm": ppm, "door_px": door_px,
        "grade": grade, "clipped": clipped,
    }


DEFAULT_TARGETS = [
    ("B2-3", "3F", "assets/floors/B2-3F.jpg"),
    ("B2-2", "2F", "assets/floors/B2-2F.jpg"),
    ("B2-5", "5F", "assets/floors/B2-5F.jpg"),
    ("B2-4", "4F", "_boards/f4.jpg"),
    ("B2-1", "1F", "_boards/f1_all.png"),
]


def main():
    args = sys.argv[1:]
    if not args:
        targets = DEFAULT_TARGETS
    else:
        path = args[0]
        fid = None
        if "--floor" in args:
            fid = args[args.index("--floor") + 1]
        if not fid:
            # 从文件名猜：B2-4F.jpg → B2-4
            base = os.path.basename(path).upper()
            for k in ("B2-1", "B2-2", "B2-3", "B2-4", "B2-5"):
                if k.replace("B2-", "") + "F" in base or k in base:
                    fid = k
                    break
        targets = [(fid or "B2-4", "?", path)]

    print("%-4s %-12s %-8s %-8s %-7s %-8s %s" % (
        "楼层", "图像尺寸", "楼体跨度", "px/m", "0.65m门", "评级", "结论"))
    print("-" * 88)
    allok = True
    for fid, label, p in targets:
        full = p if os.path.isabs(p) else os.path.join(ROOT, p.replace("/", os.sep))
        if not os.path.exists(full):
            print("%-4s %-12s %s" % (label, "-", "**文件不存在**：%s" % p))
            allok = False
            continue
        r = analyse(full, fid)
        if "reason" in r:
            print("%-4s %-12s %s" % (label, "-", r["reason"]))
            allok = False
            continue
        notes = []
        if r["clipped"]:
            notes.append("⚠ %s侧触边被裁" % "".join(r["clipped"]))
        if r["door_px"] < MIN_DOOR_PX:
            notes.append("✗ 门宽不可信")
        if not notes:
            notes.append("✓ 可用")
        else:
            allok = False
        print("%-4s %-12s %-8d %-8.1f %-7.1f %-8s %s" % (
            label, "%dx%d" % r["size"], r["span_x"], r["ppm"],
            r["door_px"], r["grade"], " ".join(notes)))

    print("-" * 88)
    print("门槛：楼体跨度决定精度。0.65m 门需 ≥ %.0f px（对应 ≥%.0f px/m）。"
          % (MIN_DOOR_PX, MIN_DOOR_PX / DOOR_M))
    print("5F 按北翼实际宽度 46.9m 计算，不用整层的 67.1m。")
    return 0 if allok else 1


if __name__ == "__main__":
    sys.exit(main())
