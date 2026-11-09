# -*- coding: utf-8 -*-
"""
split.py —— 把 images_all / labels_all 划分成 train / val，并生成 data.yaml

关键设计：
  1) 分层抽样（stratified）：每一类内部单独 8:2 切
     —— 因为四类数量相差 6 倍，整体随机切会让"锈病"在 val 里只剩几十张，指标抖动
  2) 固定随机种子 42：保证任何人重跑都得到同一份划分（复现的前提）
  3) 复制而不是移动：images_all 保持完整，后续换划分比例不用重新生成
"""
import glob
import os
import random
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_ALL = os.path.join(ROOT, "data", "yolo", "images_all")
LBL_ALL = os.path.join(ROOT, "data", "yolo", "labels_all")
YOLO_DIR = os.path.join(ROOT, "data", "yolo")

NAMES = {0: "Apple_scab", 1: "Black_rot", 2: "Cedar_rust", 3: "healthy"}
VAL_RATIO = 0.2
SEED = 42


def main():
    random.seed(SEED)

    # 按 class id 分组（class id 写在 label 文件第一列）
    groups = {cid: [] for cid in NAMES}
    for lbl in sorted(glob.glob(os.path.join(LBL_ALL, "*.txt"))):
        with open(lbl, "r", encoding="utf-8") as f:
            cid = int(f.readline().split()[0])
        groups[cid].append(os.path.splitext(os.path.basename(lbl))[0])

    for split in ("train", "val"):
        os.makedirs(os.path.join(YOLO_DIR, "images", split), exist_ok=True)
        os.makedirs(os.path.join(YOLO_DIR, "labels", split), exist_ok=True)

    summary = {}
    for cid, stems in groups.items():
        random.shuffle(stems)
        n_val = max(1, int(round(len(stems) * VAL_RATIO)))
        val, train = stems[:n_val], stems[n_val:]
        for split, items in (("train", train), ("val", val)):
            for s in items:
                shutil.copy2(os.path.join(IMG_ALL, s + ".jpg"),
                             os.path.join(YOLO_DIR, "images", split, s + ".jpg"))
                shutil.copy2(os.path.join(LBL_ALL, s + ".txt"),
                             os.path.join(YOLO_DIR, "labels", split, s + ".txt"))
        summary[NAMES[cid]] = {"train": len(train), "val": len(val)}
        print(f"{NAMES[cid]:12s} train={len(train):5d}  val={len(val):5d}")

    yaml_path = os.path.join(YOLO_DIR, "data.yaml")
    with open(yaml_path, "w", encoding="utf-8") as f:
        f.write(f"path: {YOLO_DIR}\n")
        f.write("train: images/train\n")
        f.write("val: images/val\n")
        f.write("names:\n")
        for cid, name in NAMES.items():
            f.write(f"  {cid}: {name}\n")
    print("data.yaml ->", yaml_path)

    total_t = sum(v["train"] for v in summary.values())
    total_v = sum(v["val"] for v in summary.values())
    print(f"TOTAL train={total_t} val={total_v}")


if __name__ == "__main__":
    main()
