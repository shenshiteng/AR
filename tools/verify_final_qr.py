#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
验证 qr_final/ 里每一张定位二维码，四层，缺一层都不算验完。

  L1 解码一致    —— 300dpi 位图解出的字符串必须与 spec.json 里的 url 完全相同
  L2 物理几何    —— 用暗像素包围盒实测(不用检测器角点)：静区 ≥4 模块、模块宽 ≥1mm
  L3 相机模拟    —— 把码缩到手机画面里的真实像素尺寸，加旋转/模糊/噪点/光照不均，
                    逐档测量「最小多少 px/moudle 还能解开」，并换算成真实拍摄距离
  L4 线上可达    —— 该 URL 现在能不能真的打开

关于 L3 的像素换算（默认 iPhone 1280×720 预览、水平视场 65°）：
    码在画面里的像素宽 = 码面宽 / (2·D·tan(32.5°)) × 1280
    D = 0.3m → 约 427px    D = 0.6m → 约 213px    D = 1.0m → 约 128px

用法：
    python tools/verify_final_qr.py
    python tools/verify_final_qr.py --no-http      # 离线时跳过 L4
    python tools/verify_final_qr.py --ladder       # 多打一张「像素档位 × 成功率」表
"""
import argparse
import io
import json
import math
import os
import sys

import cv2
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DPI = 300
DEFAULT_DIR = "qr_final"

# L3 判定门槛：每模块至少 3 像素（业界通用下限，低于它任何解码器都开始随机失败）
MIN_PX_PER_MODULE = 3.0
# 相机假设
CAM_PX = 1280
CAM_HFOV_DEG = 65.0
# 每个档位重复几次（不同随机种子），全部成功才算这一档通过
TRIALS = 4


def decode_gray(gray):
    txt, _pts, _ = cv2.QRCodeDetector().detectAndDecode(gray)
    return txt or ""


def measure_geometry(png_path, data_modules, dpi=DPI):
    """用暗像素包围盒实测几何——比检测器角点稳，检测器有 aa 误差。"""
    img = np.asarray(Image.open(png_path).convert("L"))
    dark = img < 128
    if not dark.any():
        return None
    ys, xs = np.where(dark)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    mod_px = (x1 - x0 + 1) / float(data_modules)
    h, w = img.shape
    return dict(
        mod_px=mod_px,
        mod_mm=mod_px / dpi * 25.4,
        code_mm=(x1 - x0 + 1) / dpi * 25.4,
        quiet=(x0 / mod_px, y0 / mod_px, (w - 1 - x1) / mod_px, (h - 1 - y1) / mod_px),
    )


def simulate_camera(png_path, code_px, seed=0, blur=True, noise=True, warp=True, grad=True,
                    bg=255):
    """把码当成手机画面里的一块：缩到 code_px → 轻旋转小透视 → 模糊 → 噪点 → 光照渐暗。"""
    rng = np.random.default_rng(seed)
    small = Image.open(png_path).convert("L").resize((code_px, code_px), Image.LANCZOS)
    pad = int(code_px * 0.45)
    canvas = Image.new("L", (code_px + 2 * pad, code_px + 2 * pad), bg)
    canvas.paste(small, (pad, pad))
    arr = np.asarray(canvas).astype(np.float32)
    h, w = arr.shape

    if warp:
        # 真实手感：绕中心转 2~5°，加一点点透视收缩——码始终完整留在画面里
        ang = float(rng.uniform(2.0, 5.0)) * (1 if rng.random() > 0.5 else -1)
        M = cv2.getRotationMatrix2D((w / 2.0, h / 2.0), ang, 1.0)
        k = code_px * 0.012
        M[0, 2] += rng.uniform(-k, k)
        M[1, 2] += rng.uniform(-k, k)
        arr = cv2.warpAffine(arr, M, (w, h), borderValue=bg)

    if blur:
        arr = cv2.GaussianBlur(arr, (3, 3), 0.6)
    if noise:
        arr = arr + rng.normal(0, 5.0, arr.shape)
    if grad:
        arr = arr * np.linspace(1.0, 0.86, w, dtype=np.float32)[None, :]
    return np.clip(arr, 0, 255).astype(np.uint8)


def distance_for_px(code_face_mm, px, cam_px=CAM_PX, hfov_deg=CAM_HFOV_DEG):
    """码面宽 code_face_mm、在画面里占 px 像素时，手机距墙大概多远（米）。"""
    half = math.radians(hfov_deg / 2.0)
    return (code_face_mm / 1000.0) * cam_px / (2.0 * px * math.tan(half))


def check_http(urls, timeout=12):
    import urllib.request
    res = {}
    ua = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
          "(KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.44(0x18002c2e) NetType/WIFI")
    for u in urls:
        req = urllib.request.Request(u, headers={"User-Agent": ua})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read(4000)
                res[u] = (r.status == 200 and len(body) > 500,
                          "%d，%d 字节" % (r.status, len(body)))
        except Exception as e:
            res[u] = (False, "%s: %s" % (type(e).__name__, e))
    return res


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=DEFAULT_DIR)
    ap.add_argument("--no-http", action="store_true")
    ap.add_argument("--ladder", action="store_true", help="额外打印像素档位表")
    args = ap.parse_args()

    out_dir = os.path.join(ROOT, args.dir)
    with io.open(os.path.join(out_dir, "spec.json"), "r", encoding="utf-8") as f:
        spec = json.load(f)

    data_mods = spec["data_modules"]
    total_mods = spec["modules"]
    png_size = int(max(spec["sizes_mm"]))

    # 150mm 的牌在不同距离下占多少像素；60cm 是本方案的设计视距。
    # 一律走 distance_for_px 的逆运算，避免在这里手算时把毫米/米搞混。
    face_mm = spec["print_size_mm"] * data_mods / float(total_mods)

    def px_at(dist_m):
        return int(round(CAM_PX * (face_mm / 1000.0)
                         / (2 * dist_m * math.tan(math.radians(CAM_HFOV_DEG / 2)))))

    px_60cm = px_at(0.6)
    px_30cm = px_at(0.3)

    print("验证 %s/  ·  %d 张  ·  v%d / %d×%d 模块 / 静区 %d 模块"
          % (args.dir, len(spec["items"]), spec["version"], data_mods, data_mods,
             spec["border"]))
    print("码本体 %.1fmm，相机模拟：%dpx 预览 / 视场 %.0f°  →  30cm≈%dpx   60cm≈%dpx"
          % (face_mm, CAM_PX, CAM_HFOV_DEG, px_30cm, px_60cm))
    print("-" * 100)
    print("%-9s %-5s %-8s %-12s %-11s %s"
          % ("点位", "L1", "模块mm", "静区(最小)", "L3@60cm", "位置"))

    fails, ladders = [], {}
    for it in spec["items"]:
        pid = it["id"]
        png = os.path.join(out_dir, "%s_%dmm.png" % (pid, png_size))

        # ---- L1
        txt = decode_gray(np.asarray(Image.open(png).convert("L")))
        l1 = txt == it["url"]
        if not l1:
            fails.append((pid, "L1 解码不一致：解出 %r" % txt))

        # ---- L2
        geo = measure_geometry(png, data_mods)
        if geo is None:
            fails.append((pid, "L2 检测不到黑块"))
            mod_s = quiet_s = "--"
        else:
            mod_ok = geo["mod_mm"] >= 1.0
            quiet_min = min(geo["quiet"])
            quiet_ok = quiet_min >= 3.9
            mod_s = "%.2f%s" % (geo["mod_mm"], "" if mod_ok else "❌")
            quiet_s = "%.2f%s" % (quiet_min, "" if quiet_ok else "❌")
            if not mod_ok:
                fails.append((pid, "L2 模块宽 %.2fmm < 1mm" % geo["mod_mm"]))
            if not quiet_ok:
                fails.append((pid, "L2 静区 %.2f 模块 < 4" % quiet_min))

        # ---- L3（60cm 设计视距）
        ok = sum(1 for s in range(TRIALS)
                 if decode_gray(simulate_camera(png, px_60cm, s)) == it["url"])
        l3 = ok == TRIALS
        if not l3:
            fails.append((pid, "L3 60cm 模拟下 %d/%d 成功" % (ok, TRIALS)))
        l3_s = "✅%d/%d" % (ok, TRIALS) if l3 else "❌%d/%d" % (ok, TRIALS)

        print("%-9s %-5s %-8s %-12s %-11s %s"
              % (pid, "✅" if l1 else "❌", mod_s, quiet_s, l3_s, it["place"][:32]))

        # ---- 档位测量（只对前一张做，省时间）
        if args.ladder and pid == spec["items"][0]["id"]:
            for px in (100, 120, 140, 160, 200, px_60cm, px_30cm, 500):
                c = sum(1 for s in range(TRIALS)
                        if decode_gray(simulate_camera(png, px, s)) == it["url"])
                ladders[px] = (c, px / float(total_mods))

    if args.ladder and ladders:
        print("-" * 100)
        print("像素档位（%s，%d 次重试）" % (spec["items"][0]["id"], TRIALS))
        for px in sorted(ladders):
            c, ppm = ladders[px]
            dist = distance_for_px(face_mm, px)
            print("  %4dpx  %5.2f px/模块  %d/%d  %s   相当于距墙 %.2fm"
                  % (px, ppm, c, TRIALS, "✅" if c == TRIALS else ("~" if c else "❌"), dist))

    # ---- L4
    if not args.no_http:
        print("-" * 100)
        urls = sorted({i["url"] for i in spec["items"]})
        print("L4 线上可达（%d 个不同 URL）…" % len(urls))
        for u, (ok, msg) in check_http(urls).items():
            print("  %s %-14s %s" % ("✅" if ok else "❌", msg, u))
            if not ok:
                fails.append((u, "L4 打不开：" + msg))

    print("-" * 100)
    if fails:
        print("❌ 不合格 %d 项：" % len(fails))
        for who, why in fails:
            print("   %s  %s" % (who, why))
        sys.exit(1)
    print("✅ 全部通过：%d 张 · L1 解码一致 · L2 模块/静区达标 · L3 60cm 处(%dpx)可解%s"
          % (len(spec["items"]), px_60cm, "" if args.no_http else " · L4 线上可达"))


if __name__ == "__main__":
    main()
