#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
成果 1：候选码制样品生成
========================

按研究报告 7.2 节生成三组样品，**统一外部安装板尺寸、统一图案边长**：

    A 组  标准 QR Code（H 级纠错，写入可访问测试 URL）
    B 组  AprilTag 36h11（空间定位对照组）
    C 组  QR + AprilTag 同板并排（工程性能基准，非最终方案）

板：A5 横版 210 × 148 mm，图案边长统一 90 mm。
     A/B 组图案居中；C 组两块并排，中缝 10 mm。
     图案边长一致，才能在第二轮做公平对比（报告 7.2）。

产物：
    samples/A_qr.png  B_apriltag36h11.png  C_qr_apriltag.png
    samples/spec.json      每块板的实际物理尺寸（不可拍脑袋，必须记录）
    samples/print_sheet.html

用法：
    python tools/gen_markers.py
    python tools/gen_markers.py --url "https://go.example.edu.cn/b2" --size 90
"""
import argparse
import io
import json
import os
import sys

import cv2
import numpy as np
import segno
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DPI = 300
BOARD_W, BOARD_H = 210.0, 148.0     # mm，A5 横版
DEFAULT_URL = "https://lab-ar-nav.app.workbuddy.host/?sharecode=COAQ2BOKWL"


def mm2px(v, dpi=DPI):
    return int(round(v / 25.4 * dpi))


def _font(pt, bold=False):
    cands = (["C:/Windows/Fonts/msyhbd.ttc", "C:/Windows/Fonts/simhei.ttf"] if bold
             else ["C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/simhei.ttf"])
    for p in cands:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, pt)
            except Exception:
                pass
    return ImageFont.load_default()


def qr_bitmap(url, ecc, side_px):
    """标准 QR，1=黑。含 4 模块静区。"""
    qr = segno.make(url, error=ecc, micro=False)
    m = np.array(qr.matrix, dtype=np.uint8)
    m = np.pad(m, 4, constant_values=0)
    n = m.shape[0]
    img = Image.fromarray(((1 - m) * 255).astype(np.uint8))
    return np.asarray(img.resize((side_px, side_px), Image.NEAREST)), qr.version, n


def apriltag_bitmap(marker_id, side_px, dict_name="DICT_APRILTAG_36h11"):
    """AprilTag，输出灰度位图（0=黑，255=白），与 QR 位图同一约定。
    cv2 给的是 8×8 本体（含 1 格黑边框），外面再补 1 格纯白静区。"""
    d = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, dict_name))
    n_cells = 8                                  # 6×6 数据 + 1 格黑边框
    raw = np.asarray(cv2.aruco.generateImageMarker(d, marker_id, 8 * 40), dtype=np.uint8)
    pad = raw.shape[0] // n_cells                # 补 1 模块静区（白）
    padded = np.pad(raw, ((pad, pad), (pad, pad)), constant_values=255)
    img = Image.fromarray(padded).resize((side_px, side_px), Image.NEAREST)
    return np.asarray(img), marker_id, n_cells + 2


def paste(board, bmp, cx_mm, cy_mm, side_mm):
    """把黑白位图贴到板上，左上角由中心点算出。"""
    px = mm2px(side_mm)
    x = mm2px(cx_mm - side_mm / 2)
    y = mm2px(cy_mm - side_mm / 2)
    board[y:y + px, x:x + px] = bmp
    return board


def new_board():
    return np.full((mm2px(BOARD_H), mm2px(BOARD_W)), 255, np.uint8)


def caption(board, cx_mm, cy_mm, title, sub):
    img = Image.fromarray(board)
    d = ImageDraw.Draw(img)
    d.text((mm2px(cx_mm), mm2px(cy_mm)), title, font=_font(mm2px(5.5), True),
           fill=0, anchor="ma")
    d.text((mm2px(cx_mm), mm2px(cy_mm + 8)), sub, font=_font(mm2px(3.6)),
           fill=90, anchor="ma")
    return np.asarray(img)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL, help="A 组二维码里放的测试地址")
    ap.add_argument("--size", type=float, default=90.0, help="图案边长（mm），三组统一")
    ap.add_argument("--ecc", default="h", choices=["m", "q", "h"])
    ap.add_argument("--out", default="samples")
    args = ap.parse_args()

    out = os.path.join(ROOT, args.out)
    os.makedirs(out, exist_ok=True)
    S = args.size
    side_px = mm2px(S)

    # ---- A 组：标准 QR ----
    qr_bmp, qr_ver, qr_mods = qr_bitmap(args.url, args.ecc, side_px)
    qr_mod_mm = S / qr_mods
    b = new_board()
    b = paste(b, qr_bmp, BOARD_W / 2, BOARD_H / 2 - 6, S)
    b = caption(b, BOARD_W / 2, BOARD_H - 24, "A 组 · 标准 QR Code",
                "v%d / %d 模块 / 模块 %.2fmm / 纠错 %s" % (qr_ver, qr_mods, qr_mod_mm, args.ecc.upper()))
    Image.fromarray(b).save(os.path.join(out, "A_qr.png"), dpi=(DPI, DPI))

    # ---- B 组：AprilTag 36h11 ----
    at_bmp, at_id, at_mods = apriltag_bitmap(0, side_px)
    at_mod_mm = S / at_mods
    b = new_board()
    b = paste(b, at_bmp, BOARD_W / 2, BOARD_H / 2 - 6, S)
    b = caption(b, BOARD_W / 2, BOARD_H - 24, "B 组 · AprilTag 36h11",
                "ID %d / %d 模块 / 模块 %.2fmm / 汉明距离 ≥11" % (at_id, at_mods, at_mod_mm))
    Image.fromarray(b).save(os.path.join(out, "B_apriltag36h11.png"), dpi=(DPI, DPI))

    # ---- C 组：QR + AprilTag 并排 ----
    b = new_board()
    gap = 10.0
    b = paste(b, qr_bmp, BOARD_W / 2 - S / 2 - gap / 2, BOARD_H / 2 - 6, S)
    b = paste(b, at_bmp, BOARD_W / 2 + S / 2 + gap / 2, BOARD_H / 2 - 6, S)
    b = caption(b, BOARD_W / 2, BOARD_H - 24, "C 组 · QR + AprilTag 36h11 组合",
                "两块图案各 %.0fmm，中缝 %.0fmm，作为工程基准" % (S, gap))
    Image.fromarray(b).save(os.path.join(out, "C_qr_apriltag.png"), dpi=(DPI, DPI))

    # ---- 规格记录（报告要求：必须记录实际物理尺寸）----
    spec = {
        "board_mm": [BOARD_W, BOARD_H],
        "dpi": DPI,
        "pattern_side_mm": S,
        "groups": {
            "A_qr": dict(file="A_qr.png", codec="QR", ecc=args.ecc, version=int(qr_ver),
                         modules=int(qr_mods), module_mm=round(qr_mod_mm, 3),
                         pattern_mm=S, url=args.url, url_len=len(args.url)),
            "B_apriltag": dict(file="B_apriltag36h11.png", codec="AprilTag-36h11", id=at_id,
                               modules=int(at_mods), module_mm=round(at_mod_mm, 3),
                               pattern_mm=S),
            "C_combo": dict(file="C_qr_apriltag.png", codec="QR+AprilTag", pattern_mm=S,
                            gap_mm=gap, note="工程基准，不作为最终方案"),
        },
    }
    with io.open(os.path.join(out, "spec.json"), "w", encoding="utf-8") as f:
        json.dump(spec, f, ensure_ascii=False, indent=2)

    card = []
    card.append("""<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>第一阶段 · 码制样品</title><style>
@page{size:A5 landscape;margin:0}
body{margin:0;font-family:"Microsoft YaHei",sans-serif}
.page{width:210mm;height:148mm;page-break-after:always}
.page img{width:210mm;height:148mm;display:block}
</style></head><body>""")
    for name in ("A_qr.png", "B_apriltag36h11.png", "C_qr_apriltag.png"):
        card.append('<div class="page"><img src="%s"></div>' % name)
    card.append("</body></html>")
    with io.open(os.path.join(out, "print_sheet.html"), "w", encoding="utf-8") as f:
        f.write("".join(card))

    print("板：%.0f × %.0f mm，图案边长 %.0f mm，%d dpi" % (BOARD_W, BOARD_H, S, DPI))
    print("  A 组 QR        v%d，%d 模块，每模块 %.2f mm，纠错 %s"
          % (qr_ver, qr_mods, qr_mod_mm, args.ecc.upper()))
    print("  B 组 AprilTag  ID %d，%d 模块，每模块 %.2f mm" % (at_id, at_mods, at_mod_mm))
    print("  C 组 两块并排，中缝 %.0f mm" % gap)
    print("\n产物在 %s/：三张 PNG + spec.json + print_sheet.html" % args.out)


if __name__ == "__main__":
    main()
