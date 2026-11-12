#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
生成定位二维码（每点位一张，扫码即定位）。

两种用法：

  A. 短域名模式（推荐，需要自有域名 + deploy/redirect 跳转页）
     python tools/make_qr.py --short-base https://go.xxx.edu.cn
     → 二维码内容 https://go.xxx.edu.cn/p-b2-01
       跳转页再拼上 sharecode 进 fp-ar.html。换分享码不必重印。

  B. 直连模式（无需域名，临时试点用）
     python tools/make_qr.py --base "https://lab-ar-nav.app.workbuddy.host?sharecode=XXX"
     → 二维码内容 <base>&loc=P-B2-01
       缺点：sharecode 写死在码里，平台重新发布就全部失效。

常用参数：
    --only P-B2-01,P-B2-08   只生成指定点位（试点用）

产物：
    qr/<定位点ID>.svg    单张二维码（矢量，随便放大不糊）
    qr/print.html        打印页，每个定位点一页 A4，可直接 Ctrl+P 打印
    qr/spec.json         每张码的 URL 与尺寸，方便核对
"""
import argparse
import io
import json
import os
import re
import socket
import sys

try:
    import qrcode
    import qrcode.image.svg
except ImportError:
    sys.exit("缺少 qrcode 库，请先运行：pip install qrcode")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_FILE = os.path.join(ROOT, "data", "labs.js")
OUT_DIR = os.path.join(ROOT, "qr")


def load_data():
    """data/labs.js 内容其实是标准 JSON，只是外面套了一层 window.LAB_DATA = ..."""
    with io.open(DATA_FILE, "r", encoding="utf-8") as f:
        raw = f.read()
    raw = re.sub(r"^\s*window\.LAB_DATA\s*=\s*", "", raw).strip()
    raw = re.sub(r";\s*$", "", raw)
    return json.loads(raw)


def local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def make_svg(text, path, border=4):
    """border 是静区模块数。规范要求 4；早先用 2（仅 2.4mm），边上裁一点就废。"""
    img = qrcode.make(text, image_factory=qrcode.image.svg.SvgPathImage,
                      box_size=12, border=border)
    img.save(path)


def build_print_page(items, base, qr_mm=90, out_dir=None):
    cards = []
    for it in items:
        cards.append(
            f'<section class="card">'
            f'<div class="qr"><img src="{it["file"]}" alt="{it["id"]}"></div>'
            f'<div class="place">{it["place"]}</div>'
            f'<div class="pid">{it["id"]}</div>'
            f'<div class="tip">打开微信扫一扫 · 扫不出就在页面里手动选这个位置</div>'
            f'<div class="url">{it["url"]}</div>'
            f'</section>'
        )
    html = f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>定位二维码 · 打印页</title>
<style>
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background: #eef1f4; }}
  .card {{
    width: 210mm; min-height: 297mm; padding: 26mm 20mm; background: #fff;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center; page-break-after: always;
  }}
  .qr {{ width: {qr_mm}mm; height: {qr_mm}mm; padding: 4mm; }}
  .qr img {{ width: 100%; height: 100%; display: block; }}
  .place {{ margin-top: 12mm; font-size: 28pt; font-weight: 700; color: #0f172a; letter-spacing: 1px; }}
  .pid {{ margin-top: 3mm; font-size: 13pt; color: #64748b; letter-spacing: 2px; font-family: ui-monospace, Menlo, monospace; }}
  .tip {{ margin-top: 6mm; font-size: 13pt; color: #475569; }}
  .url {{ margin-top: 5mm; font-size: 8.5pt; color: #a8b0bb; word-break: break-all; }}
  @media print {{
    body {{ background: #fff; }}
    .card {{ width: auto; margin: 0; padding: 22mm; }}
  }}
</style></head>
<body>
{''.join(cards)}
</body></html>"""
    out = os.path.join(out_dir or OUT_DIR, "print.html")
    with io.open(out, "w", encoding="utf-8") as f:
        f.write(html)
    return out


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    ap = argparse.ArgumentParser()
    ap.add_argument("--short-base",
                    help="短域名模式，例如 https://go.xxx.edu.cn；二维码内容 = <short-base>/<点位id小写>")
    ap.add_argument("--base", help="直连模式：二维码里要写的网址前缀，可自带 ?sharecode=xxx")
    ap.add_argument("--port", default="8000", help="直连模式未给 --base 时，用本机局域网 IP 与这个端口")
    ap.add_argument("--path", default="", help="直连模式：扫码后落在的页面（如 fp-ar.html），默认站点根目录")
    ap.add_argument("--only", help="只生成指定点位，逗号分隔，例如 P-B2-01,P-B2-08")
    ap.add_argument("--qr-mm", type=float, default=90, help="打印页上码面边长（mm），默认 90")
    ap.add_argument("--border", type=int, default=4, help="静区模块数，默认 4（规范值）")
    ap.add_argument("--out", default="qr", help="输出目录，默认 qr")
    args = ap.parse_args()

    if args.short_base:
        mode = "short"
        base = args.short_base.rstrip("/")
    else:
        mode = "direct"
        base = (args.base or f"http://{local_ip()}:{args.port}").rstrip("/")

    data = load_data()
    locs = data.get("locations", [])
    if not locs:
        sys.exit("data/labs.js 里还没有 locations（定位点），先加一个吧")

    if args.only:
        want = {x.strip().upper() for x in args.only.split(",") if x.strip()}
        missing = want - {l["id"] for l in locs}
        if missing:
            sys.exit("这些点位在 data/labs.js 里不存在：" + ", ".join(sorted(missing)))
        locs = [l for l in locs if l["id"] in want]

    from urllib.parse import urlsplit, urlunsplit

    out_dir = args.out if os.path.isabs(args.out) else os.path.join(ROOT, args.out)
    os.makedirs(out_dir, exist_ok=True)
    items = []
    for loc in locs:
        if mode == "short":
            # 短域名模式：路径末段直接就是点位编号的小写形式，跳转页再翻译回 loc=
            url = f"{base}/{loc['id'].lower()}"
        else:
            # 直连模式：base 可能自带 ?query（如分享码），loc 参数用 & 或 ? 正确接上
            sp = urlsplit(base)
            new_path = sp.path or "/"
            if args.path:
                new_path = (new_path.rstrip("/") + "/" + args.path.lstrip("/")) or "/"
            q = sp.query
            q = (q + "&" + "loc=" + loc["id"]) if q else ("loc=" + loc["id"])
            url = urlunsplit((sp.scheme, sp.netloc, new_path, q, ""))

        filename = f"{loc['id']}.svg"
        make_svg(url, os.path.join(out_dir, filename), border=args.border)
        items.append({"id": loc["id"], "place": loc.get("place", loc["id"]),
                      "file": filename, "url": url})
        print(f"  ✓ {loc['id']:<12} {loc.get('place', ''):<28} {url}")

    page = build_print_page(items, base, qr_mm=args.qr_mm, out_dir=out_dir)

    spec = {"mode": mode, "base": base, "qr_mm": args.qr_mm, "border": args.border,
            "count": len(items), "items": items}
    with io.open(os.path.join(out_dir, "spec.json"), "w", encoding="utf-8") as f:
        json.dump(spec, f, ensure_ascii=False, indent=2)

    print(f"\n共 {len(items)} 个定位二维码，已生成到 qr/ 目录（模式：{mode}）")
    print(f"打印页：{page}")
    print(f"清单：{os.path.join(out_dir, 'spec.json')}")
    if mode == "direct":
        print("注意：直连模式把 sharecode 写进了码里，平台重新发布后需要全部重印。")
        print("      拿到自有域名后改用 --short-base，配合 deploy/redirect 跳转页可避免这个问题。")


if __name__ == "__main__":
    main()
