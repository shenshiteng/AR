#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
ArUco × 二维码 融合码生成器
===========================

在普通二维码中间挖出一块纯白静区，再把一个 ArUco 标记画进去。

  - 微信 / 系统相机：靠 QR 纠错冗余补回被挖掉的模块，仍能解出网址
  - 页面里的 js-aruco2：认出中间那个 ArUco，读出 ID 完成定位

一张图，两种解码器各取所需。

用法（在项目根目录执行）：
    python tools/make_hybrid.py --url "https://lab-ar-nav.app.workbuddy.host/fp-ar.html?sharecode=COAQ2BOKWL" --marker 2
    python tools/make_hybrid.py --url "https://b2.im/s3" --marker 2 --ecc m --quiet 2 --px 20
    python tools/make_hybrid.py --batch          # 跑一组参数做对比

产物：hybrid/<名字>.png + hybrid/<名字>.json（记录生成参数，便于复现）
"""
import argparse
import io
import json
import os
import re
import sys

import numpy as np
import segno
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DICT_FILE = os.path.join(ROOT, "js", "vendor", "js-aruco2.js")
OUT_DIR = os.path.join(ROOT, "hybrid")

# 二维码对齐图案（alignment pattern）中心坐标。v1 没有，v2~v6 只有一个，v7 起是网格。
ALIGN_CENTER = {
    1: [],
    2: [6, 18],
    3: [6, 22],
    4: [6, 26],
    5: [6, 30],
    6: [6, 34],
    7: [6, 22, 38],
    8: [6, 24, 42],
    9: [6, 26, 46],
    10: [6, 28, 50],
}


def load_codes():
    """从 js-aruco2.js 里正则提取 ARUCO 字典，保证和识别端逐位一致（不抄一份）。"""
    src = io.open(DICT_FILE, "r", encoding="utf-8").read()
    m = re.search(r"ARUCO\s*:\s*\{[\s\S]*?codeList\s*:\s*\[([\s\S]*?)\]\s*\}", src)
    if not m:
        sys.exit("在 js-aruco2.js 里找不到 ARUCO 字典")
    codes = []
    for tok in m.group(1).split(","):
        tok = tok.strip()
        if re.match(r"^0x[0-9a-fA-F]+$", tok):
            codes.append(int(tok, 16))
    if not codes:
        sys.exit("ARUCO 字典解析为空")
    return codes


def aruco_7x7(codes, mid):
    """返回 7×7 矩阵，1 = 黑（深），0 = 白（浅）。
    外圈 1 格黑边框，里面 5×5 是数据位：字典里 '1' 表示白格。"""
    if mid >= len(codes):
        sys.exit("标记号 %d 超出字典范围 0~%d" % (mid, len(codes) - 1))
    bits = format(codes[mid], "025b")     # 25 位，最高位在前
    m = np.ones((7, 7), dtype=np.uint8)   # 先全黑
    for i in range(5):
        for j in range(5):
            if bits[i * 5 + j] == "1":
                m[i + 1][j + 1] = 0       # 白
    return m


def forbidden_map(version, n):
    """标出二维码里【绝对不能碰】的区域。True = 禁区。
    禁区包括：三个定位图案（含分隔符）、两条时序线、对齐图案、格式信息、版本信息、固定黑点。"""
    bad = np.zeros((n, n), dtype=bool)

    def mark(r0, c0, h, w):
        r0, c0 = max(0, r0), max(0, c0)
        r1, c1 = min(n, r0 + h), min(n, c0 + w)
        if r1 > r0 and c1 > c0:
            bad[r0:r1, c0:c1] = True

    # 三个定位图案 7×7 + 1 格分隔符 → 按 8×8 禁区算，再多留 1 格余量
    mark(0, 0, 9, 9)
    mark(0, n - 9, 9, 9)
    mark(n - 9, 0, 9, 9)

    # 时序线（第 6 行 / 第 6 列）
    bad[6, :] = True
    bad[:, 6] = True

    # 对齐图案 5×5，跳过与定位图案重叠的
    pos = ALIGN_CENTER.get(version, [])
    for r in pos:
        for c in pos:
            if (r <= 8 and c <= 8) or (r <= 8 and c >= n - 9) or (r >= n - 9 and c <= 8):
                continue
            mark(r - 3, c - 3, 7, 7)      # 5×5 再各留 1 格余量

    # 格式信息（左上拐角的两条 + 右上/左下各一条）
    mark(8, 0, 1, 9)
    mark(0, 8, 9, 1)
    mark(8, n - 8, 1, 8)
    mark(n - 7, 8, 7, 1)

    # 版本信息（只有 v7 及以上才有，两处 6×3 / 3×6）
    if version >= 7:
        mark(0, n - 11, 6, 3)
        mark(n - 11, 0, 3, 6)

    return bad


def find_slot(bad, block):
    """在二维码里找一块 block×block 的干净区域，优先靠近正中心。
    返回 (r, c) 左上角坐标；找不到返回 None。"""
    n = bad.shape[0]
    best, best_d = None, None
    for r in range(0, n - block + 1):
        for c in range(0, n - block + 1):
            if bad[r:r + block, c:c + block].any():
                continue
            # 到画面中心的距离
            d = (r + block / 2.0 - n / 2.0) ** 2 + (c + block / 2.0 - n / 2.0) ** 2
            if best_d is None or d < best_d:
                best, best_d = (r, c), d
    return best


def compose(url, ecc="q", mid=2, quiet=2, px=16):
    """生成融合码矩阵。返回 (mat, info)。mat: 1=黑，0=白，尺寸含 4 模块静区。"""
    qr = segno.make(url, error=ecc)
    ver = qr.version
    mat = np.array(qr.matrix, dtype=np.uint8)
    n = mat.shape[0]
    if ver not in ALIGN_CENTER:
        sys.exit("版本 %d 还没支持（只写到 v10）" % ver)

    bad = forbidden_map(ver, n)
    block = 7 + 2 * quiet
    slot = find_slot(bad, block)
    if slot is None:
        raise ValueError("版本 %d（%d×%d 模块）里放不下 %d×%d 的干净区域，"
                         "试试减小 --quiet 或换更高版本" % (ver, n, n, block, block))
    r0, c0 = slot

    # 1) 整块涂白（这就是 ArUco 的静区）
    mat[r0:r0 + block, c0:c0 + block] = 0

    # 2) ArUco 画在正中间
    aru = aruco_7x7(load_codes(), mid)
    off = quiet
    mat[r0 + off:r0 + off + 7, c0 + off:c0 + off + 7] = aru

    # 3) 加 4 模块静区
    mat = np.pad(mat, 4, constant_values=0)

    info = {
        "url": url,
        "ecc": ecc,
        "version": int(ver),
        "modules": int(n),
        "modules_total": int(n + 8),
        "marker_id": int(mid),
        "quiet_cells": int(quiet),
        "block_cells": int(block),
        "slot": [int(r0), int(c0)],
        "aruco_ratio": round(7.0 / (n + 8), 4),
    }
    return mat, info


def render(mat, px):
    """模块矩阵 → RGB 图像，每模块 px 个像素。"""
    big = np.kron(mat, np.ones((px, px), dtype=np.uint8))
    return Image.fromarray(((1 - big) * 255).astype(np.uint8), mode="L").convert("RGB")


def save(name, mat, info, px, mm=None):
    os.makedirs(OUT_DIR, exist_ok=True)
    img = render(mat, px)
    png = os.path.join(OUT_DIR, name + ".png")
    img.save(png)

    out = {"png": png, "px_per_module": px, "size_px": list(img.size)}
    if mm:
        # 按目标物理宽度出 300dpi 的图，直接送打印店
        dpi = 300
        target = int(round(mm / 25.4 * dpi))
        big = img.resize((target, target), Image.NEAREST)
        png2 = os.path.join(OUT_DIR, name + "_%dmm.png" % int(mm))
        big.save(png2, dpi=(dpi, dpi))
        out["print_png"] = png2
        out["print_mm"] = mm

    with io.open(os.path.join(OUT_DIR, name + ".json"), "w", encoding="utf-8") as f:
        json.dump(dict(info, **out), f, ensure_ascii=False, indent=2)
    return out


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    ap = argparse.ArgumentParser()
    ap.add_argument("--url", help="二维码里要放的网址")
    ap.add_argument("--marker", type=int, default=2, help="ArUco 标记号（默认 2）")
    ap.add_argument("--ecc", default="q", choices=["l", "m", "q", "h"], help="纠错等级（默认 q）")
    ap.add_argument("--quiet", type=int, default=2, help="ArUco 四周白边格数（默认 2，最小 1）")
    ap.add_argument("--px", type=int, default=16, help="每模块像素（默认 16）")
    ap.add_argument("--mm", type=float, help="额外出一张按该物理宽度打印的 300dpi 图")
    ap.add_argument("--name", help="输出文件名（默认自动）")
    ap.add_argument("--batch", action="store_true", help="跑一组参数对比")
    args = ap.parse_args()

    if args.batch:
        long_url = "https://lab-ar-nav.app.workbuddy.host/fp-ar.html?sharecode=COAQ2BOKWL"
        short_url = "https://b2.im/s3"
        rows = []
        for tag, url in (("long", long_url), ("short", short_url)):
            for ecc in ("m", "q", "h"):
                for quiet in (1, 2):
                    name = "hy_%s_%s_q%d" % (tag, ecc, quiet)
                    mat, info = compose(url, ecc=ecc, mid=args.marker, quiet=quiet, px=args.px)
                    out = save(name, mat, info, args.px)
                    rows.append((name, info["version"], info["modules_total"],
                                 round(7.0 / info["modules_total"] * 100, 1),
                                 info["block_cells"], out["size_px"]))
                    print("  %-18s v%-2d 总%-3d模块  ArUco占宽%5.1f%%  块%2d格  %sx%s"
                          % (name, info["version"], info["modules_total"],
                             rows[-1][3], info["block_cells"], out["size_px"][0], out["size_px"][1]))
        print("\n共生成 %d 张到 hybrid/" % len(rows))
        return

    if not args.url:
        sys.exit("请给 --url，或者用 --batch 跑一组对比")
    name = args.name or ("hy_m%d_%s_q%d" % (args.marker, args.ecc, args.quiet))
    mat, info = compose(args.url, ecc=args.ecc, mid=args.marker, quiet=args.quiet, px=args.px)
    out = save(name, mat, info, args.px, mm=args.mm)
    print("版本 v%d，总 %d 模块；ArUco 占宽 %.1f%%；放在 (行%d, 列%d) 的 %d×%d 块里"
          % (info["version"], info["modules_total"], info["aruco_ratio"] * 100,
             info["slot"][0], info["slot"][1], info["block_cells"], info["block_cells"]))
    print("已生成：%s  %s" % (out["png"], out["size_px"]))
    if "print_png" in out:
        print("打印图：%s  (%dmm @300dpi)" % (out["print_png"], int(args.mm)))


if __name__ == "__main__":
    main()
