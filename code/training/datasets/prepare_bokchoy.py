# -*- coding: utf-8 -*-
"""整理公开的 Bok Choy 检测数据集（CC BY 4.0，Roboflow 导出为 YOLO 格式）。

为什么要重划 split：
- Roboflow 导出的增强图（*.rf.<hash>.jpg）与原图同名不同后缀，且增强样本可能
  同时出现在 train/valid 里，直接按文件划分会泄漏（同一原图的增强副本跨集）。
- 本脚本按“原图基名”分组后重新 70/15/15 划分，保证同一原图的所有增强只在一个 split。
"""
from __future__ import annotations

import argparse
import json
import random
import re
import shutil
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

import yaml

BASE_RE = re.compile(r"^(.*?)(?:_jpg)?\.rf\.[0-9a-f]+$", re.IGNORECASE)


def base_id(stem: str) -> str:
    """bokchoy_healthy75_jpg.rf.abc -> bokchoy_healthy75"""
    m = BASE_RE.match(stem)
    return m.group(1) if m else stem


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", default=r"C:\Temp\kaggle_test\nguynhcan_bok-choy-disease-detection-yolo-format.zip")
    ap.add_argument("--out", default=r".\code/training/datasets/bok_choy_yolo")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    out = Path(args.out)
    raw = out.parent / "raw" / "bok_choy_roboflow"
    if raw.exists():
        shutil.rmtree(raw)
    raw.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.zip) as z:
        z.extractall(raw)

    data = yaml.safe_load((raw / "data.yaml").read_text(encoding="utf-8"))
    names = data.get("names") or ["diseased", "healthy"]
    print("classes:", names, "nc:", data.get("nc"))

    # 收集所有图片 & 标签；按原图基名分组
    images = sorted(p for p in raw.rglob("*") if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
    groups: dict[str, list[Path]] = defaultdict(list)
    for p in images:
        groups[base_id(p.stem)].append(p)

    # 检查原 split 是否有同组跨集
    split_of = {}
    for p in images:
        split_of.setdefault(base_id(p.stem), set()).add(p.parent.parent.name)
    leaked = {k: sorted(v) for k, v in split_of.items() if len(v) > 1}

    keys = sorted(groups)
    random.Random(args.seed).shuffle(keys)
    n = len(keys)
    n_train = int(round(n * 0.70))
    n_val = int(round(n * 0.15))
    assigned = {
        "train": keys[:n_train],
        "valid": keys[n_train:n_train + n_val],
        "test": keys[n_train + n_val:],
    }

    # 重建目录
    for split in ("train", "valid", "test"):
        for sub in ("images", "labels"):
            d = out / split / sub
            if d.exists():
                shutil.rmtree(d)
            d.mkdir(parents=True, exist_ok=True)

    class_boxes = Counter()
    split_imgs = Counter()
    for split, bases in assigned.items():
        for base in bases:
            for img in groups[base]:
                dst_img = out / split / "images" / img.name
                shutil.copy2(img, dst_img)
                split_imgs[split] += 1
                # 标签：Roboflow 把 labels 和 images 同级（train/labels/xxx.txt）
                rel = img.relative_to(raw)
                parts = list(rel.parts)
                parts[-2] = "labels"
                lab = raw.joinpath(*parts).with_suffix(".txt")
                if lab.exists():
                    shutil.copy2(lab, out / split / "labels" / lab.name)
                    for line in lab.read_text(encoding="utf-8", errors="replace").splitlines():
                        p = line.split()
                        if len(p) >= 5:
                            class_boxes[p[0]] += 1

    data_yaml = {
        "path": str(out).replace("\\", "/"),
        "train": "train/images",
        "val": "valid/images",
        "test": "test/images",
        "nc": len(names),
        "names": names,
    }
    (out / "data.yaml").write_text(yaml.safe_dump(data_yaml, allow_unicode=True, sort_keys=False),
                                   encoding="utf-8")

    stats = {
        "source_zip": args.zip,
        "license": "CC BY 4.0 (Roboflow: bok-choy/bok-choy-disease-detection v2)",
        "classes": names,
        "images_total": len(images),
        "base_groups": n,
        "original_split_leaked_groups": len(leaked),
        "resplit": {k: {"images": split_imgs[k], "groups": len(v)} for k, v in assigned.items()},
        "boxes_by_class": dict(class_boxes),
        "note": "按原图基名分组重划，避免增强副本跨 split 泄漏；原 split 跨集组数见 original_split_leaked_groups。",
    }
    (out / "stats.json").write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(stats, ensure_ascii=False, indent=2))

    # 保持原始 README/许可说明
    for name in ("README.dataset.txt", "README.roboflow.txt", "data.yaml"):
        src = raw / name
        if src.exists():
            shutil.copy2(src, raw / ("ORIGINAL_" + name))

    # 预览图：每类挑 3 张画框
    try:
        from PIL import Image, ImageDraw
        picks = []
        for cls_id in range(len(names)):
            count = 0
            for lab in sorted((out / "train" / "labels").glob("*.txt")):
                for line in lab.read_text().splitlines():
                    p = line.split()
                    if len(p) >= 5 and p[0] == str(cls_id):
                        picks.append((out / "train" / "images" / (lab.stem + ".jpg"), lab))
                        count += 1
                        break
                if count >= 3:
                    break
        thumbs = []
        for img_path, lab in picks:
            if not img_path.exists():
                continue
            im = Image.open(img_path).convert("RGB").resize((320, 320))
            d = ImageDraw.Draw(im)
            for line in lab.read_text().splitlines():
                p = line.split()
                if len(p) < 5:
                    continue
                cid, x, y, w, h = int(p[0]), *map(float, p[1:5])
                x1 = (x - w / 2) * 320; y1 = (y - h / 2) * 320
                x2 = (x + w / 2) * 320; y2 = (y + h / 2) * 320
                d.rectangle([x1, y1, x2, y2], outline=(0, 220, 80), width=3)
                d.text((x1 + 4, max(2, y1 - 16)), names[cid] if cid < len(names) else str(cid),
                       fill=(0, 220, 80))
            thumbs.append(im)
        if thumbs:
            cols = 3
            rows = (len(thumbs) + cols - 1) // cols
            grid = Image.new("RGB", (cols * 328, rows * 328), (30, 30, 30))
            for i, im in enumerate(thumbs):
                grid.paste(im, ((i % cols) * 328 + 4, (i // cols) * 328 + 4))
            grid.save(out / "dataset_preview.jpg", quality=88)
            print("preview:", out / "dataset_preview.jpg")
    except Exception as exc:  # noqa: BLE001
        print("preview skip:", exc)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
