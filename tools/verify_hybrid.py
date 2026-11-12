#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
融合码验证器
============

对每张融合码，同时用两个真实解码器检查：
  1. 二维码 —— OpenCV 的 QRCodeDetector（工业级，行为接近微信）
  2. ArUco  —— 项目自带的 js-aruco2（通过 tools/aruco_probe.js 在 Node 里跑）

核心问题不是"能不能读"，而是"要多大才能读"。所以做尺寸扫描：
把图逐步缩小（模拟手机离得越来越远），分别测两种解码器的最小可读像素。

扫描分两档，别混为一谈：
  - 理想档：只做缩放，模拟"完美图像"，结果会偏乐观
  - 相机档：缩放 + 光学模糊 + 传感器噪声，更接近手机实拍，用这一档下结论

用法：
    python tools/verify_hybrid.py              # 跑全部
    python tools/verify_hybrid.py --quick      # 只跑核心几组
"""
import argparse
import io
import json
import os
import subprocess
import sys

import cv2
import numpy as np
from PIL import Image

import make_hybrid as MH

ROOT = MH.ROOT
OUT_DIR = MH.OUT_DIR
TMP = os.path.join(OUT_DIR, "_probe")

URL_LONG = "https://lab-ar-nav.app.workbuddy.host/fp-ar.html?sharecode=COAQ2BOKWL"
URL_MID = "https://lab-ar-nav.app.workbuddy.host/fp-ar.html"
URL_SHORT = "https://b2.im/s3"


# ---------- 解码器 ----------

def decode_qr(img):
    """返回解出的字符串，失败返回 ''。img 可以是 PIL 图或 ndarray。"""
    a = np.asarray(img) if isinstance(img, Image.Image) else img
    if a.ndim == 3:
        a = cv2.cvtColor(a, cv2.COLOR_RGB2GRAY)
    r = cv2.QRCodeDetector().detectAndDecode(a)
    return r[0] if r and r[0] else ""


def to_rgba(img_rgb):
    a = np.asarray(img_rgb.convert("RGB"))
    out = np.dstack([a, np.full(a.shape[:2], 255, np.uint8)])
    return out.tobytes()


def probe_group(items):
    """items = [(key, PIL图)]。同尺寸可批量，省进程开销。返回 {key: [markers]}"""
    if not items:
        return {}
    w, h = items[0][1].size
    os.makedirs(TMP, exist_ok=True)
    paths = []
    for i, (key, img) in enumerate(items):
        p = os.path.join(TMP, "p%03d.rgba" % i)
        with open(p, "wb") as f:
            f.write(to_rgba(img))
        paths.append(p)

    cmd = ["node", os.path.join(ROOT, "tools", "aruco_probe.js"), str(w), str(h)] + paths
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        raise RuntimeError("aruco_probe 失败：" + r.stderr.decode("utf-8", "ignore")[:400])
    data = json.loads(r.stdout.decode("utf-8"))
    res = {}
    for (key, _), rec in zip(items, data):
        if rec.get("err"):
            print("    [probe 错误] %s: %s" % (key, rec["err"]))
        res[key] = rec.get("markers", [])
    return res


# ---------- 图像退化 ----------

_RNG = np.random.default_rng(20261106)


def camera_sim(img, w):
    """模拟手机在远处拍到的样子：缩放 + 光学模糊 + 传感器噪声。"""
    im = img.resize((w, w), Image.LANCZOS)
    a = np.asarray(im.convert("L")).astype(np.float32)
    a = cv2.GaussianBlur(a, (0, 0), 0.8)
    a = a + _RNG.normal(0, 4.0, a.shape)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def degradations(img):
    """返回 [(名字, 退化后的图)]"""
    out = []
    a = np.asarray(img.convert("L"))
    h, w = a.shape

    for ang in (5, 10, 20):
        m = cv2.getRotationMatrix2D((w / 2, h / 2), ang, 1.0)
        rot = cv2.warpAffine(a, m, (w, h), flags=cv2.INTER_LINEAR,
                             borderMode=cv2.BORDER_CONSTANT, borderValue=255)
        out.append(("旋转%d°" % ang, Image.fromarray(rot)))

    for k in (3, 5):
        out.append(("模糊%d" % k, Image.fromarray(cv2.GaussianBlur(a, (k, k), 0))))

    for q in (60, 35):
        ok, enc = cv2.imencode(".jpg", a, [int(cv2.IMWRITE_JPEG_QUALITY), q])
        if ok:
            out.append(("JPEG%d" % q, Image.fromarray(cv2.imdecode(enc, cv2.IMREAD_GRAYSCALE))))

    out.append(("低对比0.55", Image.fromarray(
        np.clip(255 * (0.5 + (a / 255.0 - 0.5) * 0.55), 0, 255).astype(np.uint8))))

    out.append(("相机模拟1/2", camera_sim(img, w // 2)))
    return out


# ---------- 主流程 ----------

def pick(configs, widths):
    """对一组配置做两档尺寸扫描。"""
    report = []

    for cfg in configs:
        name = cfg["name"]
        url = cfg["url"]
        try:
            mat, info = MH.compose(url, ecc=cfg["ecc"], mid=cfg["marker"],
                                   quiet=cfg["quiet"], px=cfg["px"])
        except ValueError as e:
            print("  跳过 %-18s %s" % (name, e))
            continue

        base = MH.render(mat, cfg["px"])
        base.save(os.path.join(OUT_DIR, name + ".png"))

        mods = info["modules_total"]
        ar_ratio = 7.0 / mods

        # 注意 slot 是 (行, 列)：行 → y，列 → x
        row_i, col_i = info["slot"]
        bx = (col_i + 4 + info["block_cells"] / 2.0) / mods
        by = (row_i + 4 + info["block_cells"] / 2.0) / mods

        row = dict(name=name, marker=cfg["marker"], url_len=len(url),
                   version=info["version"], modules=mods,
                   quiet=cfg["quiet"], ecc=cfg["ecc"], ar_ratio=round(ar_ratio, 4),
                   slot=info["slot"], ideal=None, cam=None, points=[])

        for mode in ("ideal", "cam"):
            pts = []
            for w in widths:
                if w > base.size[0]:
                    continue
                im = (base.resize((w, w), Image.LANCZOS) if mode == "ideal"
                      else camera_sim(base, w))
                got = decode_qr(im)
                ms = probe_group([(w, im)])[w]
                hit = None
                for x in ms:
                    if x["id"] != cfg["marker"]:
                        continue
                    if abs(x["center"][0] / float(w) - bx) < 0.10 and \
                       abs(x["center"][1] / float(w) - by) < 0.10:
                        hit = x
                        break
                pts.append(dict(w=w, ar_px=round(w * ar_ratio, 1),
                                qr=(got == url), ar=(hit is not None),
                                ids=[x["id"] for x in ms]))
            ok_q = [p["w"] for p in pts if p["qr"]]
            ok_a = [p["w"] for p in pts if p["ar"]]
            row[mode] = dict(
                qr_min=min(ok_q) if ok_q else None,
                ar_min=min(ok_a) if ok_a else None,
                ar_min_px=round(min(ok_a) * ar_ratio, 1) if ok_a else None,
                qr_px_per_mod=round(min(ok_q) / float(mods), 2) if ok_q else None,
            )
            if mode == "ideal":
                row["points"] = [dict(p, mode="ideal") for p in pts]
            else:
                row["points"] += [dict(p, mode="cam") for p in pts]

        i, c = row["ideal"], row["cam"]
        print("  %-18s v%-2d Q%d  ArUco%4.1f%%  | 理想 QR%-4s AR%-4s(%spx) | 相机 QR%-4s AR%-4s(%spx)"
              % (name, row["version"], cfg["quiet"], ar_ratio * 100,
                 i["qr_min"] or "-", i["ar_min"] or "-", i["ar_min_px"] or "-",
                 c["qr_min"] or "-", c["ar_min"] or "-", c["ar_min_px"] or "-"))
        report.append(row)

    return report


def run_degradation(report, names):
    print("\n退化测试（全尺寸，逐个退化项）")
    results = []
    for row in report:
        if row["name"] not in names:
            continue
        base = Image.open(os.path.join(OUT_DIR, row["name"] + ".png"))
        mods = row["modules"]
        bx = (row["slot"][1] + 4 + (7 + 2 * row["quiet"]) / 2.0) / mods
        by = (row["slot"][0] + 4 + (7 + 2 * row["quiet"]) / 2.0) / mods
        line = dict(name=row["name"], cases=[])
        for label, img in degradations(base):
            w = img.size[0]
            got = decode_qr(img)
            ms = probe_group([(label, img)])[label]
            hit = None
            for x in ms:
                if x["id"] != row["marker"]:
                    continue
                if abs(x["center"][0] / float(w) - bx) < 0.10 and \
                   abs(x["center"][1] / float(w) - by) < 0.10:
                    hit = x
                    break
            line["cases"].append(dict(case=label, qr=(got in (URL_LONG, URL_MID, URL_SHORT)),
                                      ar=(hit is not None), ids=[x["id"] for x in ms]))
            print("    %-18s %-12s QR %s | ArUco %s"
                  % (row["name"], label, "✓" if got in (URL_LONG, URL_MID, URL_SHORT) else "✗",
                     "✓" if hit else "✗"))
        results.append(line)
    return results


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)

    # 三档网址长度：长（现状）、中（去掉 sharecode）、短（假设有短链），
    # 目的是看"缩短网址"到底能不能救回尺寸。
    cfgs = []
    for tag, url in (("long", URL_LONG), ("mid", URL_MID), ("short", URL_SHORT)):
        for ecc in ("m", "q", "h"):
            for quiet in (2, 1):
                cfgs.append(dict(name="hy_%s_%s_q%d" % (tag, ecc, quiet),
                                 url=url, ecc=ecc, quiet=quiet, marker=2, px=20))
    if args.quick:
        keep = {"hy_long_q_q2", "hy_long_h_q2", "hy_mid_m_q2", "hy_short_m_q1"}
        cfgs = [c for c in cfgs if c["name"] in keep]

    widths = [1200, 1000, 850, 700, 600, 520, 460, 400, 340, 300, 260, 220, 180, 150, 120]

    print("尺寸扫描（%d 组配置 × %d 个尺寸 × 2 档）" % (len(cfgs), len(widths)))
    report = pick(cfgs, widths)

    names = [r["name"] for r in report][:3]
    deg = run_degradation(report, set(names))

    out = os.path.join(OUT_DIR, "_report.json")
    with io.open(out, "w", encoding="utf-8") as f:
        json.dump({"scan": report, "degradation": deg}, f, ensure_ascii=False, indent=2)
    print("\n报告：%s" % out)


if __name__ == "__main__":
    main()
