#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
成果 3：测试数据与对比实验
==========================

按研究报告 7.3 的测试矩阵做实验，但用**合成渲染**而非实拍：

    真值来自渲染时给定的位姿，不来自检测程序的输出
    —— 满足报告 7.4「需要独立测量参考真值，不能仅以定位程序自身输出作为真值」

阶段：
    P1  尺寸 × 距离 × 角度 包络
    P2  遮挡：面积 × 位置（并做一次细扫描找阈值）
    P3  光照：正常 / 偏暗 / 强反光
    P4  运动模糊
    P5  内参误差敏感性（没有标定数据时到底差多少）

产物：
    bench/report.json    逐样本原始数据
    bench/summary.md     汇总表

用法：
    python tools/benchmark.py
    python tools/benchmark.py --quick
"""
import argparse
import io
import json
import os
import statistics as st
import sys
import time

import cv2
import numpy as np

import gen_markers as GM
import pose_core as PC

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "bench")
URL = GM.DEFAULT_URL

SIZES = [90.0, 200.0, 400.0]
DISTS = [0.5, 1.0, 2.0, 3.0, 5.0]
ANGLES = [0, 30, 45, 60]
OCC = [0, 10, 20, 30]
OCC_FINE = [2, 5, 8, 12, 15, 25]
OCC_WHERE = ["center", "edge", "corner"]
ERR_BAD_MM = 50.0          # 位置误差超过这个就算"错误定位"

_CACHE = {}


def build_codec(codec, size_mm, px=1200):
    """返回 (位图, solvePnP 用的本体边长 mm, 模块统计)。位图缓存，避免重复生成。"""
    key = (codec, round(size_mm, 1))
    if key in _CACHE:
        return _CACHE[key]
    if codec == "qr":
        bmp, ver, total = GM.qr_bitmap(URL, "h", px)
        sym_mods = total - 8                    # 检测框对应符号，不含静区
        body_mm = size_mm * sym_mods / total
        meta = dict(version=int(ver), total_modules=int(total),
                    body_modules=int(sym_mods), module_mm=round(size_mm / total, 3))
    else:
        bmp, mid, total = GM.apriltag_bitmap(0, px)
        body_mm = size_mm * 8 / total
        meta = dict(marker_id=mid, total_modules=int(total),
                    body_modules=8, module_mm=round(size_mm / total, 3))
    _CACHE[key] = (bmp, body_mm, meta)
    return _CACHE[key]


def run_case(codec, size_mm, dist, angle, intr, blur=0.0, gain=1.0,
             occ=0, where="center", glare=None, seed=0):
    bmp, body_mm, meta = build_codec(codec, size_mm)
    rvec = PC.rotvec_from_angles(tilt_deg=angle)
    tvec = np.array([0.0, 0.0, dist])
    img, quad = PC.render_scene(bmp, size_mm, intr, rvec, tvec, seed=seed)

    H, W = img.shape
    margin = 2.0
    fits = bool(np.all(quad[:, 0] > -margin) and np.all(quad[:, 0] < W + margin)
                and np.all(quad[:, 1] > -margin) and np.all(quad[:, 1] < H + margin))
    proj_px = float(np.linalg.norm(quad[1] - quad[0]))

    if glare:
        img = PC.degrade(img, glare=glare)
    if blur > 0 or gain != 1.0:
        img = PC.degrade(img, blur=blur, gain=gain)
    if occ:
        img = PC.occlude(img, quad, occ, where=where)

    bgr = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    if codec == "qr":
        ok, txt, corners = PC.detect_qr(bgr)
        correct_id = (txt == URL)
    else:
        ok, mid_det, corners = PC.detect_apriltag(bgr)
        correct_id = (mid_det == 0)

    out = dict(codec=codec, size_mm=size_mm, dist=dist, angle=angle,
               blur=blur, gain=gain, occ=occ, where=where, glare=bool(glare),
               fits=fits, proj_px=round(proj_px, 1),
               px_per_module=round(proj_px / meta["total_modules"], 2),
               detected=False, correct=False, valid=False, reason="not_detected",
               pos_err_mm=None, rot_err_deg=None, rmse_px=None, latency_ms=None)

    if not ok or corners is None:
        return out

    t0 = time.perf_counter()
    pose = PC.estimate_pose(corners, body_mm, intr)
    out["latency_ms"] = round((time.perf_counter() - t0) * 1000, 2)
    out["detected"] = True
    out["correct"] = bool(correct_id)
    if pose is None:
        out["reason"] = "no_pose"
        return out

    valid, reason = PC.pose_valid(pose)
    out.update(valid=valid, reason=reason, rmse_px=round(pose["rmse_px"], 3))
    out["pos_err_mm"] = round(float(np.linalg.norm(pose["tvec"] - tvec)) * 1000, 2)
    out["rot_err_deg"] = round(PC.rot_error_deg(pose["rvec"], rvec), 2)
    return out


def agg(rows):
    """只统计标记完整落在画面内的样本（超框不算码制失败）。"""
    rows = [r for r in rows if r["fits"]]
    n = len(rows)
    det = [r for r in rows if r["detected"]]
    cor = [r for r in det if r["correct"]]
    val = [r for r in cor if r["valid"]]
    errs = [r["pos_err_mm"] for r in val]
    rots = [r["rot_err_deg"] for r in val]
    bad = [r for r in cor if r["pos_err_mm"] is not None and r["pos_err_mm"] > ERR_BAD_MM]
    rej = [r for r in bad if not r["valid"]]
    return dict(
        n=n,
        detect_rate=round(100.0 * len(det) / n, 1) if n else 0.0,
        id_rate=round(100.0 * len(cor) / len(det), 1) if det else 0.0,
        valid_rate=round(100.0 * len(val) / n, 1) if n else 0.0,
        pos_mean=round(st.mean(errs), 1) if errs else None,
        pos_p95=round(float(np.percentile(errs, 95)), 1) if errs else None,
        pos_max=round(max(errs), 1) if errs else None,
        rot_mean=round(st.mean(rots), 2) if rots else None,
        rot_p95=round(float(np.percentile(rots, 95)), 2) if rots else None,
        reject_rate=round(100.0 * len(rej) / len(bad), 1) if bad else None,
        latency=round(st.mean([r["latency_ms"] for r in det if r["latency_ms"]]), 1) if det else None,
    )


def p1_table(p1, codecs, sizes, dists, field="detect_rate"):
    print("\n  检出率（行=图案边长 mm，列=距离 m；— 表示图案超出画面）")
    head = "    %-10s" % "" + "".join("%9.1f" % d for d in dists)
    for c in codecs:
        print("  [%s]" % c.upper())
        print(head)
        for s in sizes:
            line = "    %-10.0f" % s
            for d in dists:
                cell = [r for r in p1 if r["codec"] == c and r["size_mm"] == s and r["dist"] == d]
                fit = [r for r in cell if r["fits"]]
                if not fit:
                    line += "%9s" % "—"
                else:
                    a = agg(cell)
                    line += "%8.0f%%" % a["detect_rate"]
            print(line)


def envelope(p1, codecs, sizes):
    """对每个尺寸，找检出率仍 ≥90% 的最远距离。"""
    res = {}
    for c in codecs:
        res[c] = {}
        for s in sizes:
            best = None
            for d in sorted({r["dist"] for r in p1}):
                rows = [r for r in p1 if r["codec"] == c and r["size_mm"] == s and r["dist"] == d]
                if not [r for r in rows if r["fits"]]:
                    continue
                if agg(rows)["detect_rate"] >= 90.0:
                    best = d
            res[c][s] = best
    return res


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    os.makedirs(OUT, exist_ok=True)
    intr = PC.intrinsics_from_fov()
    codecs = ["qr", "apriltag"]
    sizes = SIZES[:2] if args.quick else SIZES
    dists = [0.5, 1.0, 2.0] if args.quick else DISTS

    print("相机：%d×%d，水平视场 %.0f°，未标定（按视场角推名义内参）"
          % (intr["width"], intr["height"], intr["hfov_deg"]))

    # ---- P1 ----
    print("\nP1 尺寸 × 距离 × 角度")
    p1 = []
    for c in codecs:
        for s in sizes:
            for d in dists:
                for a in ANGLES:
                    p1.append(run_case(c, s, d, a, intr, seed=args.seed))
    p1_table(p1, codecs, sizes, dists)

    env = envelope(p1, codecs, sizes)
    print("\n  可用包络（检出率 ≥90% 的最远距离）")
    for c in codecs:
        print("    %-9s " % c.upper() + "  ".join(
            "%dmm→%s" % (s, ("%.0fm" % env[c][s]) if env[c][s] else "不达标") for s in sizes))

    print("\n  分倾角（全部尺寸/距离汇总）")
    for c in codecs:
        line = "    %-9s " % c.upper()
        for a in ANGLES:
            a2 = agg([r for r in p1 if r["codec"] == c and r["angle"] == a])
            line += "  %2d°:%.0f%%" % (a, a2["detect_rate"])
        print(line)

    # ---- P2 ----
    print("\nP2 遮挡（200mm / 1m / 正面）")
    p2 = []
    for c in codecs:
        for occ in OCC:
            for where in (OCC_WHERE if occ else ["center"]):
                p2.append(run_case(c, 200.0, 1.0, 0, intr, occ=occ, where=where, seed=args.seed))
    fine2 = []
    for c in codecs:
        for occ in OCC_FINE:
            fine2.append(run_case(c, 200.0, 1.0, 0, intr, occ=occ, where="center", seed=args.seed))
    for c in codecs:
        print("  [%s]" % c.upper())
        for occ in OCC:
            cells = [r for r in p2 if r["codec"] == c and r["occ"] == occ]
            ok = sum(r["detected"] and r["correct"] for r in cells)
            vv = sum(r["valid"] for r in cells)
            print("    遮挡 %2d%%：识别 %d/%d，有效定位 %d/%d" % (occ, ok, len(cells), vv, len(cells)))
        thr = [r["occ"] for r in fine2 if r["codec"] == c and r["detected"]]
        print("    细扫描：中心遮挡可识别的最大比例 = %s%%"
              % (max(thr) if thr else "小于2"))

    # ---- P3 ----
    print("\nP3 光照（200mm / 2m / 正面）")
    lights = [("正常", {}), ("偏暗", dict(gain=0.35)),
              ("强反光", dict(glare=dict(center=(intr["width"] // 2, int(intr["height"] // 2)),
                                         axes=(260, 160))))]
    p3 = []
    for c in codecs:
        for name, kw in lights:
            p3.append(run_case(c, 200.0, 2.0, 0, intr, seed=args.seed, **kw))
    for c in codecs:
        print("  [%s]" % c.upper())
        for i, (name, _) in enumerate(lights):
            r = [x for x in p3 if x["codec"] == c][i]
            print("    %-5s 识别 %s，有效定位 %s%s"
                  % (name, "✓" if r["detected"] and r["correct"] else "✗",
                     "✓" if r["valid"] else "✗",
                     ("  位置误差 %.0fmm" % r["pos_err_mm"]) if r["pos_err_mm"] is not None else ""))

    # ---- P4 ----
    print("\nP4 运动模糊（200mm / 1m / 正面；✓=可定位，认=只识别，✗=失败）")
    p4 = []
    for c in codecs:
        for b in (0.0, 1.0, 2.0, 3.5):
            p4.append(run_case(c, 200.0, 1.0, 0, intr, blur=b, seed=args.seed))
    for c in codecs:
        line = "  [%-8s]" % c.upper()
        for b in (0.0, 1.0, 2.0, 3.5):
            r = [x for x in p4 if x["codec"] == c and x["blur"] == b][0]
            line += "  σ%.1f:%s" % (b, "✓" if r["valid"] else ("认" if r["detected"] else "✗"))
        print(line)

    # ---- P5 ----
    print("\nP5 内参误差敏感性（用错内参去解，看位置误差）")
    p5 = []
    work = {"qr": (200.0, 1.0), "apriltag": (200.0, 2.0)}   # 各码制在自己的工作距离上测
    for c in codecs:
        size_mm, dist = work[c]
        for hfov in (56.0, 66.0, 76.0):
            bmp, body, _ = build_codec(c, size_mm)
            rvec = PC.rotvec_from_angles(0)
            tvec = np.array([0.0, 0.0, dist])
            img, _ = PC.render_scene(bmp, size_mm, intr, rvec, tvec, seed=args.seed)
            bgr = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
            if c == "qr":
                ok, _, corners = PC.detect_qr(bgr)
            else:
                ok, _, corners = PC.detect_apriltag(bgr)
            err = None
            if ok:
                pose = PC.estimate_pose(corners, body, PC.intrinsics_from_fov(hfov_deg=hfov))
                if pose:
                    err = round(float(np.linalg.norm(pose["tvec"] - tvec)) * 1000, 1)
            p5.append(dict(codec=c, hfov=hfov, size_mm=size_mm, dist=dist, err=err))
    for c in codecs:
        r0 = [x for x in p5 if x["codec"] == c][0]
        line = "  [%-8s] %.1fm  " % (c.upper(), r0["dist"])
        for hfov in (56.0, 66.0, 76.0):
            r = [x for x in p5 if x["codec"] == c and x["hfov"] == hfov][0]
            line += "  %.0f°:%s" % (hfov, ("%.0fmm" % r["err"]) if r["err"] is not None else "-")
        print(line)

    # ---- 匹配工况对比（避免幸存者偏差）----
    print("\n匹配工况对比（同一尺寸、同一距离，且两者都 100% 检出）")
    print("    %-8s %-6s %-12s %-12s %-12s" % ("尺寸mm", "距离m", "QR位置误差", "Tag位置误差", "QR姿态误差"))
    matched = []
    for s in sizes:
        for d in dists:
            row = {}
            for c in codecs:
                a = agg([r for r in p1 if r["codec"] == c and r["size_mm"] == s
                         and r["dist"] == d and r["angle"] == 0])
                row[c] = a
            if row["qr"]["detect_rate"] >= 100 and row["apriltag"]["detect_rate"] >= 100:
                matched.append((s, d, row))
                print("    %-8.0f %-6.1f %-12s %-12s %-12s"
                      % (s, d, "%s mm" % row["qr"]["pos_mean"], "%s mm" % row["apriltag"]["pos_mean"],
                         "%s°" % row["qr"]["rot_mean"]))
    if not matched:
        print("    （没有两者同时 100% 检出的工况）")

    # ---- 汇总 ----
    summary = dict(
        params=dict(sizes=sizes, dists=dists, angles=ANGLES, occ=OCC, occ_fine=OCC_FINE,
                    occ_where=OCC_WHERE, err_bad_mm=ERR_BAD_MM,
                    camera=dict(width=intr["width"], height=intr["height"],
                                hfov_deg=intr["hfov_deg"], calibrated=False)),
        envelope={c: {("%.0f" % s): env[c][s] for s in sizes} for c in codecs},
        p1_by_size_dist={c: {("%.0f_%.1f" % (s, d)): agg([r for r in p1 if r["codec"] == c
                                                          and r["size_mm"] == s and r["dist"] == d])
                           for s in sizes for d in dists} for c in codecs},
        p2=p2, p2_fine=fine2, p3=p3, p4=p4, p5=p5,
    )
    with io.open(os.path.join(OUT, "report.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    print("\n总览（P1 全部样本）：")
    for c in codecs:
        a = agg([r for r in p1 if r["codec"] == c])
        print("  %-9s 检出 %3.0f%% | ID 正确 %3.0f%% | 有效定位 %3.0f%% | "
              "位置 均值%s / p95 %s / 最大 %s mm | 解算 %sms"
              % (c.upper(), a["detect_rate"], a["id_rate"], a["valid_rate"],
                 a["pos_mean"], a["pos_p95"], a["pos_max"], a["latency"]))
    print("\n原始数据：bench/report.json")


if __name__ == "__main__":
    main()
