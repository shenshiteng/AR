#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
生成最终版定位二维码（每点位一张，扫码即定位）—— 定稿版。

与 tools/make_qr.py 的区别：
  * 纠错等级显式 Q（25%），静区固定 4 模块（规范值）
  * 一次出三样：矢量 SVG（随便放大不糊）+ 300dpi 位图（毫米精确）+ 自包含 A4 打印页
  * 打印页把 SVG 内联进 HTML，整个 qr_final/ 拷到任何电脑都能直接打印，不依赖相对路径
  * 尺寸以「含 4 模块静区的整体宽度」为准（与 docs/永久二维码方案.md 的口径一致）

用法：
    python tools/make_final_qr.py
    python tools/make_final_qr.py --sizes 150,90 --ecc q
    python tools/make_final_qr.py --base "https://lab-ar-nav.app.workbuddy.host/fp-ar.html?sharecode=COAQ2BOKWL"

产物（默认 qr_final/）：
    <点位ID>.svg           矢量码，含静区，真实毫米尺寸
    <点位ID>_<尺寸>mm.png  300dpi 位图，可直接送打印店
    print.html             A4 打印页，每个点位一页，Ctrl+P 即可
    spec.json              每张码的 URL / 版本 / 模块宽 / 静区，供 check_qr.py 复核
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
DATA_FILE = os.path.join(ROOT, "data", "labs.js")
DPI = 300
BORDER = 4  # 静区模块数，标准值；少于 4 模块，边上裁掉一点就解不出

DEFAULT_BASE = ("https://lab-ar-nav.app.workbuddy.host/fp-ar.html?sharecode=COAQ2BOKWL")


def load_data():
    with io.open(DATA_FILE, "r", encoding="utf-8") as f:
        raw = f.read()
    raw = re.sub(r"^\s*window\.LAB_DATA\s*=\s*", "", raw).strip()
    raw = re.sub(r";\s*$", "", raw)
    return json.loads(raw)


def build_matrix(url, ecc):
    """返回 (含静区的 0/1 矩阵, 版本, 数据模块数, 总模块数)。1 = 黑。"""
    qr = segno.make(url, error=ecc, micro=False, boost_error=False)
    m = np.array(qr.matrix, dtype=np.uint8)
    data_mods = m.shape[0]
    m = np.pad(m, BORDER, constant_values=0)
    return m, int(qr.version), data_mods, m.shape[0]


def render_png(mat, total_mm, path, dpi=DPI):
    """按目标物理宽度（含静区）渲染，毫米精确。"""
    total_px = int(round(total_mm / 25.4 * dpi))
    n = mat.shape[0]
    img = Image.fromarray(((1 - mat) * 255).astype(np.uint8))
    img = img.resize((total_px, total_px), Image.NEAREST).convert("RGB")
    img.save(path, dpi=(dpi, dpi))
    return total_px


def write_svg(mat, total_mm, path):
    """手写 SVG：整张码合并成一条 path，尺寸以毫米写死，缩放不糊。"""
    n = mat.shape[0]
    k = total_mm / n  # 每模块毫米
    seg = []
    for y in range(n):
        x = 0
        row = mat[y]
        while x < n:
            if row[x]:
                x0 = x
                while x < n and row[x]:
                    x += 1
                seg.append("M%.4f %.4fh%.4fv%.4fh-%.4fz"
                           % (x0 * k, y * k, (x - x0) * k, k, (x - x0) * k))
            else:
                x += 1
    svg = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<svg xmlns="http://www.w3.org/2000/svg" width="%.3fmm" height="%.3fmm" '
           'viewBox="0 0 %.3f %.3f" shape-rendering="crispEdges">\n'
           '<rect width="100%%" height="100%%" fill="#FFFFFF"/>\n'
           '<path d="%s" fill="#000000"/>\n'
           '</svg>\n') % (total_mm, total_mm, total_mm, total_mm, "".join(seg))
    with io.open(path, "w", encoding="utf-8") as f:
        f.write(svg)
    return len(svg)


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


def card_html(item, svg_text, code_mm):
    """一页 A4。版式：标题 → 楼层/位置 → 码 → 三步用法 → 编号 + 短地址 + 兜底。"""
    return """
<section class="card">
  <div class="hd">
    <div class="h1">扫码定位</div>
    <div class="h2">%(place)s</div>
  </div>
  <div class="qr" style="width:%(mm)dmm;height:%(mm)dmm">%(svg)s</div>
  <ol class="steps">
    <li>微信「扫一扫」扫上面的码 → 自动打开导航，并定位到<b>这个楼梯口</b></li>
    <li>在搜索框输入要去的实验室号（本层如 <b>%(sample_room)s</b>，跨层也能直接输）</li>
    <li>点「导航」，跟着箭头走</li>
  </ol>
  <div class="foot">
    <div class="pid">%(id)s</div>
    <div class="tip">扫不出来？页面上手动选「%(floor_short)s → %(short_place)s」也一样</div>
    <div class="url">%(url)s</div>
  </div>
</section>""" % dict(
        place=esc(item["place"]), mm=code_mm, svg=svg_text, id=esc(item["id"]),
        floor_short=esc(item["floor_short"]), short_place=esc(item["short_place"]),
        sample_room=esc(item["sample_room"]), url=esc(item["url"]))


PRINT_CSS = """
@page { size: A4; margin: 0; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; background: #eef1f4; color: #111;
       font-family: "Microsoft YaHei", "PingFang SC", -apple-system, sans-serif; }
.card { width: 210mm; height: 297mm; padding: 18mm 16mm 14mm; background: #fff;
        display: flex; flex-direction: column; align-items: center;
        page-break-after: always; break-after: page; overflow: hidden; }
.card:last-child { page-break-after: auto; break-after: auto; }
.hd { text-align: center; }
.h1 { font-size: 34pt; font-weight: 700; letter-spacing: .12em; line-height: 1.15; }
.h2 { font-size: 17pt; color: #333; margin-top: 3mm; letter-spacing: .04em; }
.qr { margin: 8mm 0 0; display: block; }
.qr svg { width: 100%; height: 100%; display: block; }
.steps { margin: 8mm 0 0; padding: 0 0 0 7mm; font-size: 12.5pt; line-height: 1.85;
         color: #222; width: 100%; }
.steps li { margin-bottom: 1.5mm; }
.foot { margin-top: auto; padding-top: 6mm; text-align: center; width: 100%;
        border-top: 1px solid #e2e5e9; }
.pid { font-family: ui-monospace, Consolas, monospace; font-size: 15pt; font-weight: 700;
       letter-spacing: .18em; color: #0f172a; }
.tip { margin-top: 2.5mm; font-size: 10pt; color: #555; }
.url { margin-top: 2mm; font-size: 7pt; color: #a8b0bb; word-break: break-all; }
@media screen { .card { margin: 0 auto 8mm; box-shadow: 0 2px 10px rgba(0,0,0,.12); } }
"""


def build_print_html(items, svgs, code_mm, out_path):
    body = "".join(card_html(it, svgs[it["id"]], code_mm) for it in items)
    html = ("<!DOCTYPE html>\n<html lang=\"zh-CN\"><head><meta charset=\"utf-8\">\n"
            "<title>定位二维码 · A4 打印页（%d 页）</title>\n<style>%s</style>\n"
            "</head>\n<body>\n%s\n</body></html>\n") % (len(items), PRINT_CSS, body)
    with io.open(out_path, "w", encoding="utf-8") as f:
        f.write(html)
    return len(html)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=DEFAULT_BASE, help="二维码里要写的网址前缀")
    ap.add_argument("--ecc", default="q", choices=["l", "m", "q", "h"], help="纠错等级，默认 q")
    ap.add_argument("--sizes", default="150,90", help="含静区的整体宽度（mm），逗号分隔，默认 150,90")
    ap.add_argument("--print-size", type=float, default=150, help="打印页上的码面尺寸（mm），默认 150")
    ap.add_argument("--out", default="qr_final", help="输出目录，默认 qr_final")
    args = ap.parse_args()

    ecc = args.ecc.upper()
    sizes = [float(s) for s in args.sizes.split(",") if s.strip()]
    base = args.base.rstrip("/")

    data = load_data()
    locs = data.get("locations", [])
    if not locs:
        sys.exit("data/labs.js 里没有 locations")
    floor_name = {f["id"]: f.get("name", f["id"]) for f in data.get("floors", [])}

    out_dir = args.out if os.path.isabs(args.out) else os.path.join(ROOT, args.out)
    os.makedirs(out_dir, exist_ok=True)

    items, svgs, stats = [], {}, None
    print("模式：线上直连   纠错：%s   静区：%d 模块\n" % (ecc, BORDER))
    for loc in locs:
        sep = "&" if "?" in base else "?"
        url = "%s%sloc=%s" % (base, sep, loc["id"])
        mat, ver, data_mods, total_mods = build_matrix(url, ecc.lower())
        stats = dict(version=ver, data_modules=data_mods, modules=total_mods)

        write_svg(mat, args.print_size, os.path.join(out_dir, loc["id"] + ".svg"))
        for s in sizes:
            px_w = int(round(s / 25.4 * DPI))
            render_png(mat, s, os.path.join(out_dir, "%s_%dmm.png" % (loc["id"], int(s))))

        with io.open(os.path.join(out_dir, loc["id"] + ".svg"), "r", encoding="utf-8") as f:
            svgs[loc["id"]] = f.read()

        # 位置短名：去掉括号里的注释，用于页面兜底提示
        short_place = re.sub(r"（[^）]*）|\([^)]*\)", "", loc.get("place", "")).split("·")[-1].strip()
        # 本层示例房间号：取该层 labs 里最小的房号，印在牌上才不会误导（3 层不是 324 才怪）
        same_floor = [str(l.get("room", "")) for l in data.get("labs", [])
                      if l.get("floor") == loc["floor"] and str(l.get("room", "")).isdigit()]
        sample_room = sorted(same_floor, key=lambda r: int(r))[0] if same_floor else loc["id"]
        items.append(dict(id=loc["id"], url=url,
                          place=loc.get("place", loc["id"]),
                          floor=loc["floor"],
                          floor_short=floor_name.get(loc["floor"], loc["floor"]),
                          short_place=short_place,
                          sample_room=sample_room))
        print("  ✓ %-9s v%-2d %2d模块  模块宽 %.2f mm  %s"
              % (loc["id"], ver, data_mods, args.print_size / data_mods, loc.get("place", "")))

    page = build_print_html(items, svgs, args.print_size, os.path.join(out_dir, "print.html"))

    spec = dict(mode="online-direct", base=base, ecc=ecc, border=BORDER, dpi=DPI,
                print_size_mm=args.print_size, sizes_mm=sizes,
                version=stats["version"], data_modules=stats["data_modules"],
                modules=stats["modules"],
                module_mm=round(args.print_size / stats["data_modules"], 3),
                count=len(items), items=items)
    with io.open(os.path.join(out_dir, "spec.json"), "w", encoding="utf-8") as f:
        json.dump(spec, f, ensure_ascii=False, indent=2)

    code_mm = args.print_size * stats["data_modules"] / stats["modules"]
    print("\n共 %d 张。二维码版本 v%d，数据区 %d×%d，含静区 %d×%d 模块"
          % (len(items), stats["version"], stats["data_modules"], stats["data_modules"],
             stats["modules"], stats["modules"]))
    print("打印码面 %.0fmm（含静区）/ 码本体 %.1fmm，模块宽 %.2fmm ✅（≥1mm 即合格）"
          % (args.print_size, code_mm, args.print_size / stats["data_modules"]))
    print("打印页：%s" % os.path.join(out_dir, "print.html"))
    print("清单：  %s" % os.path.join(out_dir, "spec.json"))
    print("\n注意：线上地址里的 sharecode 一旦因平台重新发布而变化，这 12 张就要重印。")
    print("      要避免这一条，得先落实自有短域名 + deploy/redirect 跳转层。")


if __name__ == "__main__":
    main()
