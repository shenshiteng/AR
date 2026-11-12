#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
二维码自检工具
==============

印之前、贴之前、以及以后定期巡检，都用它验三件事：

  1. 能不能被解出来，解出来的字符串是否与预期**完全一致**
  2. 静区够不够（少于 4 模块就是不合格，边上裁掉一点就废）
  3. 模块宽度够不够（低于 1mm，手机近距离也容易失败）

用法：
    python tools/check_qr.py qr_perm/_test/code_150mm.png
    python tools/check_qr.py qr_perm/_test/code_150mm.png --expect "https://..."
    python tools/check_qr.py qr_perm/_test/code_150mm.png --http
    python tools/check_qr.py qr_perm/_test/code_150mm.png --spec qr_perm/_test/spec.json

有 --http 时会真的去访问那个地址，确认它现在还能打开（巡检用）。
"""
import argparse
import io
import json
import os
import sys
import urllib.error
import urllib.request

import cv2
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def decode(path):
    img = np.asarray(Image.open(path).convert("L"))
    txt, pts, _ = cv2.QRCodeDetector().detectAndDecode(img)
    return (txt or ""), img, pts


def qr_box(img):
    """用检测到的四个角，定出二维码本体（不含静区）的包围盒。"""
    det = cv2.QRCodeDetector()
    ok, pts = det.detect(img)
    if not ok or pts is None:
        return None
    p = np.asarray(pts).reshape(-1, 2)
    x0, y0 = p.min(axis=0)
    x1, y1 = p.max(axis=0)
    return int(x0), int(y0), int(x1), int(y1)


def analyse(img, data_modules):
    """按二维码版本算模块宽度与静区。data_modules = 4v+17（不含静区）。"""
    box = qr_box(img)
    if box is None:
        return None
    x0, y0, x1, y1 = box
    h, w = img.shape
    mod_px = (x1 - x0 + 1) / float(data_modules)
    return dict(
        box=box,
        mod_px=mod_px,
        quiet_left=(x0) / mod_px,
        quiet_top=(y0) / mod_px,
        quiet_right=(w - 1 - x1) / mod_px,
        quiet_bottom=(h - 1 - y1) / mod_px,
        code_mm=None,
    )


def check_http(url, timeout=8):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (iPhone) MicroMessenger"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read(2000)
            return True, "%d %s，返回 %d 字节" % (r.status, r.reason, len(body))
    except urllib.error.HTTPError as e:
        return False, "HTTP %d %s" % (e.code, e.reason)
    except Exception as e:
        return False, "%s: %s" % (type(e).__name__, e)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    ap = argparse.ArgumentParser()
    ap.add_argument("png")
    ap.add_argument("--expect", help="预期解出的字符串")
    ap.add_argument("--spec", help="读取生成时留下的 spec.json")
    ap.add_argument("--http", action="store_true", help="顺便检查网址现在能不能打开")
    args = ap.parse_args()

    if not os.path.isabs(args.png):
        args.png = os.path.join(ROOT, args.png)
    if not os.path.exists(args.png):
        sys.exit("找不到文件：%s" % args.png)

    spec = {}
    if args.spec:
        p = args.spec if os.path.isabs(args.spec) else os.path.join(ROOT, args.spec)
        with io.open(p, "r", encoding="utf-8") as f:
            spec = json.load(f)

    expect = args.expect or spec.get("url")
    txt, img, _ = decode(args.png)

    print("文件：%s  (%d×%d px)" % (os.path.relpath(args.png, ROOT), img.shape[1], img.shape[0]))
    print("解出：%s" % (txt if txt else "（解不出来）"))
    if expect:
        print("预期：%s" % expect)
        print("一致：%s" % ("✅ 是" if txt == expect else "❌ 否"))

    total_modules = spec.get("modules")
    dpi = spec.get("dpi", 300)
    data_modules = (total_modules - 8) if total_modules else None

    info = analyse(img, data_modules) if data_modules else None
    if info:
        mod_mm = info["mod_px"] / dpi * 25.4
        code_mm = data_modules * mod_mm
        print("\n二维码本体：%.1f mm（%d 模块 × %.2f mm）" % (code_mm, data_modules, mod_mm))
        print("模块宽度：%.2f mm  %s" % (mod_mm, "✅" if mod_mm >= 1.0
                                   else "❌ 偏小，手机近距离也容易失败"))
        print("\n静区实测（标准要求 ≥ 4 模块）：")
        for side, k in (("左", "quiet_left"), ("上", "quiet_top"), ("右", "quiet_right")):
            v = info[k]
            print("  %s侧 %.1f 模块  %s" % (side, v, "✅" if v >= 3.9 else "❌ 不足"))
        print("  下侧不参与判定（下方有文字带）")
        span_cm = code_mm / 10.0
        print("\n推测可靠扫描距离：约 %.0f–%.0f cm" % (span_cm * 8, span_cm * 12))

    if args.http and txt:
        ok, msg = check_http(txt)
        print("\n网址访问：%s  %s" % ("✅ 通" if ok else "❌ 不通", msg))

    print()
    if expect and txt != expect:
        sys.exit(1)


if __name__ == "__main__":
    main()
