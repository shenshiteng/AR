#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
成果 2：最小验证程序
====================

读取一张（或一批）图像，检测标记，输出相机相对标记的位姿。
输出格式严格对齐研究报告第 8 节。

用法：
    # 单张图，二维码，图案边长 90mm
    python tools/pose_verify.py --image photo.jpg --codec qr --size 76.4

    # AprilTag
    python tools/pose_verify.py --image photo.jpg --codec apriltag --size 72

    # 有标定文件时（推荐，精度差别很大）
    python tools/pose_verify.py --image photo.jpg --codec qr --size 76.4 --calib calib.json

    # 批量处理整个目录，结果写文件
    python tools/pose_verify.py --dir shots/ --codec qr --size 76.4 --out result.json

关于 --size：
    传的是 solvePnP 用的**标记本体物理边长**（毫米），不是含静区的板尺寸。
    QR：符号边长 = 板图案边长 × (符号模块数 / 含静区总模块数)
    AprilTag 36h11：黑框外沿边长 = 板图案边长 × (8 / 10)

退出码：0 表示至少一个标记被有效定位；1 表示没有。
"""
import argparse
import glob
import io
import json
import os
import sys
import time

import cv2

import pose_core as PC

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(path):
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    if img is None:
        raise SystemExit("读不了图：%s" % path)
    return img


def run_one(path, codec, size_mm, intr, dict_name):
    img = load(path)
    t0 = time.perf_counter()

    if codec == "qr":
        ok, payload, corners = PC.detect_qr(img)
        marker_id = "qr:" + (payload[:48] if ok else "")
    else:
        ok, mid, corners = PC.detect_apriltag(img, dict_name)
        marker_id = "%s:%s" % (dict_name, mid)

    det_ms = (time.perf_counter() - t0) * 1000.0

    if not ok or corners is None:
        return {"file": os.path.basename(path), "size_px": [img.shape[1], img.shape[0]],
                "decode": False, "report": PC.to_report(marker_id, None, False, "not_detected"),
                "latency_ms": round(det_ms, 1)}

    t1 = time.perf_counter()
    pose = PC.estimate_pose(corners, size_mm, intr)
    valid, reason = PC.pose_valid(pose)
    total_ms = (time.perf_counter() - t0) * 1000.0

    return {"file": os.path.basename(path), "size_px": [img.shape[1], img.shape[0]],
            "decode": True, "payload": payload if codec == "qr" else None,
            "report": PC.to_report(marker_id, pose, valid, reason),
            "latency_ms": round(total_ms, 1),
            "pose_ms": round((time.perf_counter() - t1) * 1000.0, 2)}


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    ap = argparse.ArgumentParser()
    ap.add_argument("--image")
    ap.add_argument("--dir")
    ap.add_argument("--codec", default="qr", choices=["qr", "apriltag"])
    ap.add_argument("--size", type=float, required=True, help="标记本体边长（mm）")
    ap.add_argument("--dict", default="DICT_APRILTAG_36h11")
    ap.add_argument("--calib", help="相机标定 json；不给则按视场角推名义内参")
    ap.add_argument("--hfov", type=float, default=66.0)
    ap.add_argument("--out")
    args = ap.parse_args()

    if not args.image and not args.dir:
        raise SystemExit("请给 --image 或 --dir")

    intr = PC.intrinsics_from_file(args.calib) if args.calib else PC.intrinsics_from_fov(hfov_deg=args.hfov)

    paths = []
    if args.image:
        paths.append(args.image)
    if args.dir:
        for ext in ("*.jpg", "*.jpeg", "*.png", "*.bmp"):
            paths += sorted(glob.glob(os.path.join(args.dir, ext)))

    out = []
    print("相机内参：fx=%.1f  cx=%.1f  cy=%.1f  %s"
          % (intr["K"][0, 0], intr["K"][0, 2], intr["K"][1, 2],
             "（已标定）" if intr["calibrated"] else "（未标定，按 %.0f° 视场推定）" % intr["hfov_deg"]))
    print("标记边长：%.2f mm\n" % args.size)

    any_valid = False
    for p in paths:
        r = run_one(p, args.codec, args.size, intr, args.dict)
        out.append(r)
        rep = r["report"]
        if rep["pose_valid"]:
            any_valid = True
            pos = rep["position_m"]
            print("%-28s ✅ %-22s x=%7.3f y=%7.3f z=%7.3f m  rmse=%.2fpx  %.0fms"
                  % (r["file"], rep["marker_id"][:22], pos["x"], pos["y"], pos["z"],
                     rep["reproj_rmse_px"], r["latency_ms"]))
        elif r["decode"]:
            print("%-28s ⚠ 识别到但不输出位姿：%s" % (r["file"], rep["reject_reason"]))
        else:
            print("%-28s ❌ 未检出" % r["file"])

    if args.out:
        p = args.out if os.path.isabs(args.out) else os.path.join(ROOT, args.out)
        os.makedirs(os.path.dirname(p) or ".", exist_ok=True)
        with io.open(p, "w", encoding="utf-8") as f:
            json.dump(out if len(out) > 1 else out[0], f, ensure_ascii=False, indent=2)
        print("\n结果已写入 %s" % p)
    else:
        print("\n" + json.dumps(out[0] if len(out) == 1 else out, ensure_ascii=False, indent=2))

    sys.exit(0 if any_valid else 1)


if __name__ == "__main__":
    main()
