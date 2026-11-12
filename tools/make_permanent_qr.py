#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
永久二维码生成器（单一入口码，不带任何位置参数）
================================================

设计前提：这张码印上去就不再撕、不再换。所以它只能承载一个**永不失效的地址**。

产物：
    <out>/code_<尺寸>mm.png      300dpi 成品图，按目标物理宽度出
    <out>/print_sheet.html       可直接 Ctrl+P 的打印页（A4，带标题和说明）
    <out>/spec.json              本次生成的全部参数，便于留档和复现

用法：
    python tools/make_permanent_qr.py --url "https://go.example.edu.cn/b2"
    python tools/make_permanent_qr.py --url "https://go.example.edu.cn/b2" --sizes 60,100,150
    python tools/make_permanent_qr.py --url "https://..." --warn "测试版，不可张贴"
"""
import argparse
import io
import json
import os
import sys

import numpy as np
import segno
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DPI = 300


def make_matrix(url, ecc):
    """返回 (模块矩阵 1=黑, 版本, 数据模块数)。含 4 模块静区。"""
    qr = segno.make(url, error=ecc, micro=False)
    m = np.array(qr.matrix, dtype=np.uint8)       # segno: 1 = 黑
    m = np.pad(m, 4, constant_values=0)           # 标准要求 4 模块静区
    return m, qr.version, int(qr.symbol_size()[0])


def render_exact(mat, mm, dpi=DPI):
    """按目标物理宽度渲染成位图（精确到毫米）。"""
    total_px = int(round(mm / 25.4 * dpi))
    n = mat.shape[0]
    img = Image.fromarray(((1 - np.kron(mat, np.ones((1, 1), np.uint8))) * 255).astype(np.uint8))
    img = img.resize((total_px, total_px), Image.NEAREST)
    return img.convert("RGB")


def _font(size, bold=False):
    cands = (["C:/Windows/Fonts/msyhbd.ttc", "C:/Windows/Fonts/simhei.ttf"] if bold
             else ["C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/simhei.ttf"])
    for p in cands:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def save_code(mat, mm, path, caption=None, warn=None):
    img = render_exact(mat, mm)
    if caption or warn:
        # 下方加一条文字带（不压码，留 6mm 白）
        pad = int(6 / 25.4 * DPI)
        band = 0
        if caption:
            band += int(12 / 25.4 * DPI)
        if warn:
            band += int(9 / 25.4 * DPI)
        canvas = Image.new("RGB", (img.size[0], img.size[1] + pad + band), "white")
        canvas.paste(img, (0, 0))
        d = ImageDraw.Draw(canvas)
        y = img.size[1] + pad
        if caption:
            f = _font(int(8 / 25.4 * DPI), True)
            d.text((canvas.size[0] // 2, y), caption, font=f, fill="black", anchor="ma")
            y += int(12 / 25.4 * DPI)
        if warn:
            f = _font(int(6 / 25.4 * DPI))
            d.text((canvas.size[0] // 2, y), warn, font=f, fill="#B42318", anchor="ma")
        canvas.save(path, dpi=(DPI, DPI))
    else:
        img.save(path, dpi=(DPI, DPI))
    return img


def print_sheet(url, mat, ver, mods, sizes, out, caption, warn):
    """A4 打印页：一张码 + 说明，尺寸按毫米写死，打印时选 100% 不缩放。"""
    big = max(sizes)
    html = []
    html.append("""<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>永久入口码 · 打印页</title>
<style>
@page { size: A4; margin: 0; }
body { margin: 0; font-family: "Microsoft YaHei", sans-serif; color: #111; }
.sheet { width: 210mm; min-height: 297mm; box-sizing: border-box; padding: 22mm 20mm;
         display: flex; flex-direction: column; align-items: center; text-align: center; }
h1 { font-size: 26pt; margin: 0 0 4mm; letter-spacing: .05em; }
.sub { font-size: 12pt; color: #444; margin: 0 0 10mm; }
.qr { width: %dmm; height: %dmm; }
.qr img { width: 100%%; height: 100%%; display: block; }
.tip { font-size: 13pt; margin-top: 9mm; line-height: 1.9; }
.url { font-size: 8.5pt; color: #888; margin-top: 8mm; word-break: break-all; }
.rule { margin-top: 10mm; font-size: 9.5pt; color: #555; border-top: 1px solid #ddd;
        padding-top: 4mm; width: 100%%; text-align: left; line-height: 1.8; }
.warn { margin-top: 6mm; font-size: 11pt; color: #B42318; font-weight: 700; }
</style></head><body><div class="sheet">
""" % (big, big))
    html.append('<h1>%s</h1>\n' % caption)
    html.append('<p class="sub">打开微信「扫一扫」，对准下方二维码</p>\n')
    html.append('<div class="qr"><img src="code_%dmm.png" alt="入口二维码"></div>\n' % big)
    html.append('<p class="tip">扫码进入室内导航<br>首次打开请允许使用摄像头</p>\n')
    html.append('<p class="url">%s</p>\n' % url)
    if warn:
        html.append('<p class="warn">%s</p>\n' % warn)
    html.append(
        '<div class="rule">'
        '打印要求：纸张 A4、缩放选「实际大小 / 100%%」，<b>不要选「适应页面」</b>；'
        '码面应正好 %dmm，可用尺量对角线校验。<br>'
        '材质：亚克力 UV 打印或 PVC 背胶 + 哑光覆膜，不要用亮膜。<br>'
        '版本 v%d，共 %d 个模块（含 4 模块静区），纠错等级 H。'
        '</div>\n' % (big, ver, mods))
    html.append("</div></body></html>")

    p = os.path.join(out, "print_sheet.html")
    with io.open(p, "w", encoding="utf-8") as f:
        f.write("".join(html))
    return p


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True, help="码里要放的地址（必须长期有效）")
    ap.add_argument("--ecc", default="h", choices=["m", "q", "h"], help="纠错等级，默认 h")
    ap.add_argument("--sizes", default="60,100,150", help="目标码面宽度（mm），逗号分隔")
    ap.add_argument("--out", default="qr_perm", help="输出目录")
    ap.add_argument("--caption", default="扫码进入导航", help="打印页标题")
    ap.add_argument("--warn", help="打印页上的红色警示语（测试版用）")
    args = ap.parse_args()

    url = args.url.strip()
    if url.startswith("http://"):
        print("  ! 建议用 https：微信对 http 页面会提示不安全")
    sizes = [int(s) for s in args.sizes.split(",") if s.strip()]

    out = os.path.join(ROOT, args.out)
    os.makedirs(out, exist_ok=True)

    mat, ver, mods = make_matrix(url, args.ecc)
    data_mods = mods - 8
    mm_per_module = {s: round(s / mods, 2) for s in sizes}

    print("网址长度 %d 字符" % len(url))
    print("二维码：v%d，数据区 %d×%d，含静区 %d×%d 模块，纠错 %s"
          % (ver, data_mods, data_mods, mods, mods, args.ecc.upper()))
    if min(mm_per_module.values()) < 1.0:
        print("  ! 有尺寸的模块宽度 < 1mm，手机可能扫不稳："
              + ", ".join("%dmm→%smm" % (k, v) for k, v in mm_per_module.items()))

    files = []
    for s in sizes:
        p = os.path.join(out, "code_%dmm.png" % s)
        img = save_code(mat, s, p, caption=args.caption, warn=args.warn)
        files.append((s, p, img.size))
        print("  ✓ %-28s 码面 %dmm，模块 %smm，图 %d×%d px"
              % (os.path.basename(p), s, mm_per_module[s], img.size[0], img.size[1]))

    sheet = print_sheet(url, mat, ver, mods, sizes, out, args.caption, args.warn)
    print("  ✓ %-28s 可直接 Ctrl+P（务必选 100%%）" % os.path.basename(sheet))

    spec = dict(url=url, url_len=len(url), ecc=args.ecc, version=int(ver),
                modules=int(mods), data_modules=int(data_mods),
                sizes_mm=sizes, mm_per_module={str(k): v for k, v in mm_per_module.items()},
                dpi=DPI, caption=args.caption, warn=args.warn,
                files=[os.path.basename(f[1]) for f in files])
    with io.open(os.path.join(out, "spec.json"), "w", encoding="utf-8") as f:
        json.dump(spec, f, ensure_ascii=False, indent=2)
    print("\n全部产物在 %s/" % args.out)


if __name__ == "__main__":
    main()
