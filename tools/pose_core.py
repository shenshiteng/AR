#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
位姿解算核心（成果 2 的地基）
============================

做四件事，两个入口脚本（pose_verify.py / benchmark.py）共用：

  1. 相机内参：给不出标定文件时，按视场角推定一个名义内参，并标注 "uncalibrated"
  2. 检测：QR 用 cv2.QRCodeDetector，AprilTag 用 cv2.aruco
  3. 位姿：solvePnP（平面方形用 IPPE_SQUARE，失败退回 ITERATIVE）
  4. 有效性闸门：重投影误差 + 深度合理性 → 决定 pose_valid

坐标系约定（与报告第 8 节一致）：
  - 标记坐标系 M：X 向右、Y 向下、Z 垂直标记面朝外；原点在标记中心
  - 相机坐标系 C：X 向右、Y 向下、Z 沿光轴向前（OpenCV 惯例）
  - 输出 T_MC：标记在相机系下的位姿（旋转 + 平移），对应报告里的 T_WC = T_WM · T_MC 的后一项
"""
import json
import math
import os

import cv2
import numpy as np

# ---------------- 相机内参 ----------------

def intrinsics_from_fov(width=1280, height=720, hfov_deg=66.0):
    """按水平视场角推名义内参。没有标定文件时用这个，误差要单独评估。"""
    fx = (width / 2.0) / math.tan(math.radians(hfov_deg) / 2.0)
    K = np.array([[fx, 0, width / 2.0],
                  [0, fx, height / 2.0],
                  [0, 0, 1]], dtype=np.float64)
    return dict(K=K, dist=np.zeros(5), width=width, height=height,
                hfov_deg=hfov_deg, calibrated=False)


def intrinsics_from_file(path):
    with open(path, "r", encoding="utf-8") as f:
        d = json.load(f)
    return dict(K=np.array(d["K"], dtype=np.float64),
                dist=np.array(d.get("dist", [0, 0, 0, 0, 0]), dtype=np.float64),
                width=d.get("width", 1280), height=d.get("height", 720),
                hfov_deg=d.get("hfov_deg"), calibrated=bool(d.get("calibrated", True)))


# ---------------- 检测 ----------------

def detect_qr(img_bgr):
    """返回 (成功, 文本, 4×2 角点/None)。角点对应【符号本身】，不含静区。"""
    det = cv2.QRCodeDetector()
    txt, pts, _ = det.detectAndDecode(img_bgr)
    if pts is None or len(pts) == 0:
        return False, "", None
    return bool(txt), txt, np.asarray(pts, dtype=np.float32).reshape(4, 2)


def detect_apriltag(img_bgr, dict_name="DICT_APRILTAG_36h11"):
    """返回 (成功, id, 4×2 角点/None)。角点对应【黑边框外沿】。"""
    d = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, dict_name))
    p = cv2.aruco.DetectorParameters()
    p.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX   # 角点亚像素细化，直接决定位姿精度
    det = cv2.aruco.ArucoDetector(d, p)
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY) if img_bgr.ndim == 3 else img_bgr
    corners, ids, _ = det.detectMarkers(gray)
    if ids is None or len(ids) == 0:
        return False, None, None
    # OpenCV 5 里 ids 可能是 (N,) 也可能是 (N,1)，统一 ravel 取第一个
    mid = int(np.asarray(ids).ravel()[0])
    return True, mid, np.asarray(corners[0], dtype=np.float32).reshape(4, 2)


# ---------------- 位姿 ----------------

def _model_quad(size_mm):
    """标记平面上的四个角（米），顺序与检测器返回一致：左上、右上、右下、左下。"""
    s = size_mm / 1000.0 / 2.0
    return np.array([[-s, -s, 0], [s, -s, 0], [s, s, 0], [-s, s, 0]], dtype=np.float64)


def _order_quad(pts):
    """把任意顺序的四个角排成 左上/右上/右下/左下（按角度与重心排）。"""
    pts = np.asarray(pts, dtype=np.float64).reshape(4, 2)
    c = pts.mean(axis=0)
    ang = np.arctan2(pts[:, 1] - c[1], pts[:, 0] - c[0])
    order = np.argsort(ang)                      # 图像 y 向下时，角度递增即顺时针
    return pts[order]


def estimate_pose(corners_px, size_mm, intr):
    """solvePnP。多个求解器都跑一遍，取重投影误差最小的那个。

    为什么不用单一求解器：OpenCV 5 的 SOLVEPNP_IPPE_SQUARE 实测会返回
    t=[0,0,0]（重投影误差 52px）且不报错。必须靠重投影误差自证，不能盲信 ok 标志。
    """
    obj = _model_quad(size_mm)
    img_pts = _order_quad(corners_px)
    K, dist = intr["K"], intr["dist"]

    best = None
    for flag in (cv2.SOLVEPNP_IPPE, cv2.SOLVEPNP_SQPNP, cv2.SOLVEPNP_ITERATIVE):
        try:
            ok, rvec, tvec = cv2.solvePnP(obj, img_pts, K, dist, flags=flag)
        except cv2.error:
            continue
        if not ok:
            continue
        t = tvec.reshape(3)
        if t[2] <= 1e-6:                     # 标记跑到相机背后，直接丢
            continue
        proj, _ = cv2.projectPoints(obj, rvec, tvec, K, dist)
        rmse = float(np.sqrt(np.mean(np.sum((proj.reshape(4, 2) - img_pts) ** 2, axis=1))))
        if best is None or rmse < best["rmse_px"]:
            best = dict(rvec=rvec.reshape(3), tvec=t, rmse_px=rmse)
    return best


def pose_valid(pose, rmse_max=2.0, z_range=(0.05, 20.0)):
    """有效性闸门。宁可报失败，也不能把错的坐标当有效输出（报告 6.2 的第二类风险）。"""
    if pose is None:
        return False, "no_pose"
    z = float(pose["tvec"][2])
    if pose["rmse_px"] > rmse_max:
        return False, "reproj_rmse=%.2fpx" % pose["rmse_px"]
    if not (z_range[0] <= z <= z_range[1]):
        return False, "depth_out_of_range=%.3fm" % z
    return True, "ok"


def rot_angle_deg(rvec):
    """旋转向量 → 轴角（度）。用于和真值比对。"""
    return math.degrees(float(np.linalg.norm(rvec)))


def rot_error_deg(rvec_est, rvec_gt):
    """两个旋转之间的夹角（度）。用 R_est^T · R_gt 的迹算，比直接减轴角稳。"""
    Re, _ = cv2.Rodrigues(np.asarray(rvec_est, dtype=np.float64).reshape(3, 1))
    Rg, _ = cv2.Rodrigues(np.asarray(rvec_gt, dtype=np.float64).reshape(3, 1))
    R = Re.T @ Rg
    c = max(-1.0, min(1.0, (np.trace(R) - 1.0) / 2.0))
    return math.degrees(math.acos(c))


# ---------------- 报告格式 ----------------

def to_report(marker_id, pose, valid, reason):
    """按报告第 8 节要求的 JSON 结构输出。"""
    if pose is None:
        return {"marker_id": marker_id, "position_m": None, "orientation_xyzw": None,
                "pose_valid": False, "reject_reason": reason, "reproj_rmse_px": None}
    R, _ = cv2.Rodrigues(np.asarray(pose["rvec"], dtype=np.float64).reshape(3, 1))
    q = _rotmat_to_quat(R)
    t = pose["tvec"]
    return {
        "marker_id": marker_id,
        "position_m": {"x": round(float(t[0]), 4),
                       "y": round(float(t[1]), 4),
                       "z": round(float(t[2]), 4)},
        "orientation_xyzw": {"x": round(float(q[0]), 5), "y": round(float(q[1]), 5),
                             "z": round(float(q[2]), 5), "w": round(float(q[3]), 5)},
        "pose_valid": bool(valid),
        "reject_reason": reason,
        "reproj_rmse_px": round(float(pose["rmse_px"]), 3),
    }


def _rotmat_to_quat(R):
    """旋转矩阵 → 四元数 (x,y,z,w)。"""
    m = R
    tr = m[0, 0] + m[1, 1] + m[2, 2]
    if tr > 0:
        s = math.sqrt(tr + 1.0) * 2
        w = 0.25 * s
        x = (m[2, 1] - m[1, 2]) / s
        y = (m[0, 2] - m[2, 0]) / s
        z = (m[1, 0] - m[0, 1]) / s
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = math.sqrt(1.0 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        w = (m[2, 1] - m[1, 2]) / s
        x = 0.25 * s
        y = (m[0, 1] + m[1, 0]) / s
        z = (m[0, 2] + m[2, 0]) / s
    elif m[1, 1] > m[2, 2]:
        s = math.sqrt(1.0 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        w = (m[0, 2] - m[2, 0]) / s
        x = (m[0, 1] + m[1, 0]) / s
        y = 0.25 * s
        z = (m[1, 2] + m[2, 1]) / s
    else:
        s = math.sqrt(1.0 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        w = (m[1, 0] - m[0, 1]) / s
        x = (m[0, 2] + m[2, 0]) / s
        y = (m[1, 2] + m[2, 1]) / s
        z = 0.25 * s
    return (x, y, z, w)


# ---------------- 合成渲染（提供独立真值） ----------------

def render_scene(marker_bmp, marker_mm, intr, rvec_gt, tvec_gt, bg=190, noise=3, seed=0):
    """把标记按真定位姿渲染进一张假想相机画面。

    真值来自渲染参数本身，不来自检测程序的输出——满足报告"需要独立测量参考真值"的要求。
    marker_bmp：灰度位图（0 黑 255 白），通常含静区。
    marker_mm：该位图的物理边长。
    """
    rng = np.random.default_rng(seed)
    W, H = intr["width"], intr["height"]
    K, dist = intr["K"], intr["dist"]

    s = marker_mm / 1000.0 / 2.0
    obj = np.array([[-s, -s, 0], [s, -s, 0], [s, s, 0], [-s, s, 0]], dtype=np.float64)
    img_pts, _ = cv2.projectPoints(obj, np.asarray(rvec_gt, np.float64), np.asarray(tvec_gt, np.float64), K, dist)
    dst = img_pts.reshape(4, 2).astype(np.float32)
    src = np.array([[0, 0], [marker_bmp.shape[1], 0],
                    [marker_bmp.shape[1], marker_bmp.shape[0]], [0, marker_bmp.shape[0]]], dtype=np.float32)

    horizon = np.full((H, W), bg, np.uint8)
    horizon = np.clip(horizon.astype(np.int16) + rng.normal(0, noise, (H, W)), 0, 255).astype(np.uint8)

    Hm = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(marker_bmp, Hm, (W, H), flags=cv2.INTER_LINEAR,
                                 borderMode=cv2.BORDER_CONSTANT, borderValue=255)
    mask = cv2.warpPerspective(np.full(marker_bmp.shape, 255, np.uint8), Hm, (W, H),
                               flags=cv2.INTER_NEAREST, borderValue=0)
    out = np.where(mask > 0, warped, horizon)
    return out.astype(np.uint8), dst


def degrade(img, blur=0.0, gain=1.0, bias=0, glare=None):
    """退化：模糊、亮度增益、偏置、局部强反光。"""
    out = img.astype(np.float32) * gain + bias
    if blur > 0:
        out = cv2.GaussianBlur(out, (0, 0), blur)
    if glare:
        # 用一个高斯亮斑模拟反光。自己用 numpy 算，避免 cv2.ellipse 的版本差异。
        h, w = out.shape
        cx, cy = glare["center"]
        ax, ay = glare["axes"]
        yy, xx = np.mgrid[0:h, 0:w]
        d2 = ((xx - cx) / float(ax)) ** 2 + ((yy - cy) / float(ay)) ** 2
        mask = np.exp(-d2 * 2.0).astype(np.float32)
        out = out * (1 - 0.93 * mask) + 255 * 0.93 * mask
    return np.clip(out, 0, 255).astype(np.uint8)


def occlude(img, quad, percent, where="center", dark=False):
    """按投影四边形的面积百分比遮挡。where 决定落在中心/边/角。"""
    quad = np.asarray(quad, np.float32)
    area = cv2.contourArea(quad)
    side = math.sqrt(max(area, 1.0) * percent / 100.0)
    if side < 1:
        return img
    c = quad.mean(axis=0)
    if where == "center":
        p = c
    elif where == "corner":
        p = quad[np.argsort(np.sum(quad, axis=1))[0]] * 0.75 + c * 0.25
    else:                                  # edge：取一条边的中点
        p = (quad[0] + quad[1]) / 2.0 * 0.8 + c * 0.2
    out = img.copy()
    val = 40 if dark else 245
    half = int(round(side / 2))
    x0, y0 = int(p[0]) - half, int(p[1]) - half
    x1, y1 = x0 + int(side), y0 + int(side)
    H, W = out.shape
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(W, x1), min(H, y1)
    if x1 > x0 and y1 > y0:
        out[y0:y1, x0:x1] = val
    return out


def rotvec_from_angles(tilt_deg=0.0, yaw_deg=0.0, roll_deg=0.0):
    """构造真值旋转：先绕 Y 倾斜，再绕 X 俯仰，最后绕 Z 滚转（角度制）。"""
    Ry, _ = cv2.Rodrigues(np.array([0, math.radians(tilt_deg), 0], np.float64))
    Rx, _ = cv2.Rodrigues(np.array([math.radians(yaw_deg), 0, 0], np.float64))
    Rz, _ = cv2.Rodrigues(np.array([0, 0, math.radians(roll_deg)], np.float64))
    R = Ry @ Rx @ Rz
    rvec, _ = cv2.Rodrigues(R)
    return rvec.reshape(3)
