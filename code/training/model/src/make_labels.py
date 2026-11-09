# -*- coding: utf-8 -*-
"""
make_labels.py —— 从 PlantVillage 分类数据自动生成 YOLO 检测标签

思路（5 步）：
  1) 估背景色：取图像四周 8 像素宽的一圈，求中位数 → 这是"这块背景长什么样"
  2) 算差异图：每个像素与背景色的 LAB 距离（LAB 比 RGB 更接近人眼感知）
  3) 二值化：Otsu 自动找阈值，把"离背景远"的像素判为前景（叶片）
  4) 取主体：形态学闭运算补洞，取最大连通域，求外接矩形
  5) 体检 + 回退：面积占比不合理（<8% 或 >97%）就退化成整图框，并计数

输出：
  data/yolo/images_all/  <类别名>__<原名>.jpg
  data/yolo/labels_all/  <类别名>__<原名>.txt   （每行：cls cx cy w h，归一化 0-1）
  docs/qc_boxes.jpg      24 张抽样画框图，人工验收
  docs/label_stats.json  统计（各类张数 / 回退数 / 平均面积占比）
"""
import cv2
import glob
import json
import os
import shutil
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "pv", "raw", "color")
OUT_IMG = os.path.join(ROOT, "data", "yolo", "images_all")
OUT_LBL = os.path.join(ROOT, "data", "yolo", "labels_all")
QC_DIR = os.path.join(ROOT, "docs")

CLASSES = [
    ("Apple___Apple_scab", 0),
    ("Apple___Black_rot", 1),
    ("Apple___Cedar_apple_rust", 2),
    ("Apple___healthy", 3),
]


def read_image(path):
    """Unicode-safe 读图。

    OpenCV 在 Windows 上的 imread 走 ANSI 文件 API，路径含中文（如 ~\\...）
    会直接返回 None，而且不报错。用 numpy 读字节 + imdecode 绕过。
    """
    buf = np.fromfile(path, dtype=np.uint8)
    if buf.size == 0:
        return None
    return cv2.imdecode(buf, cv2.IMREAD_COLOR)


def save_image(path, img, quality=92):
    """Unicode-safe 写图：imwrite 同样不认中文路径。"""
    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        raise RuntimeError(f"encode failed: {path}")
    buf.tofile(path)


def foreground_mask(img):
    """返回 (mask, 是否成功)。失败返回全 1 的 mask（= 整图框）。"""
    h, w = img.shape[:2]
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)

    # 1) 背景色 = 四周一圈像素的中位数（比均值抗噪声）
    b = 8
    border = np.concatenate([
        lab[0:b, :, :].reshape(-1, 3),
        lab[-b:, :, :].reshape(-1, 3),
        lab[:, 0:b, :].reshape(-1, 3),
        lab[:, -b:, :].reshape(-1, 3),
    ])
    bg = np.median(border, axis=0)

    # 2) 只看色度（a、b 两通道），刻意丢掉亮度 L。
    #    原因：阴影/受光改变的是亮度，叶片与背景的“颜色”差异反而更稳定。
    #    用 L 一起算，Otsu 会把整张图（含背景渐变）都判成前景，框接近满图。
    dist = np.linalg.norm(lab[:, :, 1:3] - bg[1:3], axis=2)
    dist8 = cv2.normalize(dist, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)

    # 3) Otsu 自动阈值（逐图自适应，不用手拍数字）
    _, mask = cv2.threshold(dist8, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # 4) 形态学处理：闭运算补内部空洞，开运算去零星噪点
    k_close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    k_open = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k_close, iterations=2)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k_open, iterations=1)
    return mask


def bbox_from_mask(mask, h, w):
    """最大连通域的外接矩形 + 体检。失败返回 None。"""
    n, _, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if n <= 1:
        return None
    areas = stats[1:, cv2.CC_STAT_AREA]
    i = 1 + int(np.argmax(areas))
    x, y, bw, bh, area = stats[i]
    ratio = area / float(h * w)
    # 体检：太小说明没找到叶片；太大说明背景被一起判成前景
    if ratio < 0.08 or ratio > 0.97:
        return None
    # 外扩 2%，避免把叶缘切掉
    pad_x, pad_y = int(bw * 0.02), int(bh * 0.02)
    x0, y0 = max(0, x - pad_x), max(0, y - pad_y)
    x1, y1 = min(w, x + bw + pad_x), min(h, y + bh + pad_y)
    return x0, y0, x1, y1


def to_yolo(x0, y0, x1, y1, h, w):
    """(x0,y0,x1,y1) 像素 → YOLO 归一化 (cx,cy,w,h)"""
    cx = (x0 + x1) / 2.0 / w
    cy = (y0 + y1) / 2.0 / h
    bw = (x1 - x0) / float(w)
    bh = (y1 - y0) / float(h)
    return cx, cy, bw, bh


def main():
    os.makedirs(OUT_IMG, exist_ok=True)
    os.makedirs(OUT_LBL, exist_ok=True)
    os.makedirs(QC_DIR, exist_ok=True)

    stats = {}
    qc_tiles = []          # 抽样的画框图
    qc_labels = []

    for cname, cid in CLASSES:
        files = sorted(glob.glob(os.path.join(SRC, cname, "*")))
        n_ok, n_fallback, n_fail = 0, 0, 0
        ratios = []

        for i, path in enumerate(files):
            img = read_image(path)
            if img is None:
                n_fail += 1          # 绝不静默跳过：读失败要单独计数
                continue
            h, w = img.shape[:2]

            mask = foreground_mask(img)
            box = bbox_from_mask(mask, h, w)
            if box is None:
                n_fallback += 1
                box = (0, 0, w, h)          # 回退：整图框
            else:
                n_ok += 1
                ratios.append((box[2] - box[0]) * (box[3] - box[1]) / float(w * h))

            x0, y0, x1, y1 = box
            cx, cy, bw, bh = to_yolo(x0, y0, x1, y1, h, w)

            stem = os.path.splitext(os.path.basename(path))[0]
            new_stem = f"{cname}__{stem}"
            shutil.copy2(path, os.path.join(OUT_IMG, new_stem + ".jpg"))
            with open(os.path.join(OUT_LBL, new_stem + ".txt"), "w", encoding="utf-8") as f:
                f.write(f"{cid} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}\n")

            # 每类抽 6 张进 QC 拼图
            if i % max(1, len(files) // 6) == 0 and len([t for t in qc_labels if t == cid]) < 6:
                vis = img.copy()
                cv2.rectangle(vis, (x0, y0), (x1 - 1, y1 - 1), (0, 255, 0), 2)
                vis = cv2.resize(vis, (200, 200))
                qc_tiles.append(vis)
                qc_labels.append(cid)

        stats[cname] = {
            "id": cid,
            "total": len(files),
            "ok": n_ok,
            "fallback": n_fallback,
            "read_fail": n_fail,
            "fallback_rate": round(n_fallback / max(1, len(files)), 4),
            "mean_box_ratio": round(float(np.mean(ratios)) if ratios else 0.0, 4),
        }
        print(f"{cname:26s} total={len(files):5d} ok={n_ok:5d} "
              f"read_fail={n_fail:5d} fallback={n_fallback:5d} "
              f"mean_box={stats[cname]['mean_box_ratio']}")

    # QC 拼图：4 行（每类 1 行）× 6 列
    if qc_tiles:
        while len(qc_tiles) % 6 != 0:
            qc_tiles.append(np.zeros((200, 200, 3), np.uint8))
        rows = [np.hstack(qc_tiles[i:i + 6]) for i in range(0, len(qc_tiles), 6)]
        sheet = np.vstack(rows)
        save_image(os.path.join(QC_DIR, "qc_boxes.jpg"), sheet)
        print("QC ->", os.path.join(QC_DIR, "qc_boxes.jpg"))

    with open(os.path.join(QC_DIR, "label_stats.json"), "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)
    print("stats ->", os.path.join(QC_DIR, "label_stats.json"))


if __name__ == "__main__":
    main()
