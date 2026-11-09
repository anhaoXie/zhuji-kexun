# -*- coding: utf-8 -*-
"""整理 PlantDoc 检测数据集（CC BY 4.0，Roboflow 导出 YOLO 格式），用于通用叶病预训练。

源：Kaggle `andresmgs/plantdec`（PlantDoc，2,567 张、30 类、带框）。
本脚本只解压 + 修正 data.yaml 相对路径 + 统计，不做重划（仅作预训练/骨干验证用）。
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

import yaml

BASE_RE = re.compile(r"^(.*?)(?:_jpg)?\.rf\.[0-9a-f]+$", re.IGNORECASE)


def base_id(stem: str) -> str:
    m = BASE_RE.match(stem)
    return m.group(1) if m else stem


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", default=r"C:\Temp\kaggle_test\andresmgs_plantdec.zip")
    ap.add_argument("--out", default=r".\code/training/datasets/plantdoc_yolo")
    args = ap.parse_args()

    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.zip) as z:
        z.extractall(out)

    data = yaml.safe_load((out / "data.yaml").read_text(encoding="utf-8"))
    names = data.get("names") or []
    data["path"] = str(out).replace("\\", "/")
    data["train"] = "train/images"
    data["val"] = "valid/images"
    data["test"] = "test/images"
    (out / "data.yaml").write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")

    class_boxes = Counter()
    split_imgs = Counter()
    groups = defaultdict(set)
    for split in ("train", "valid", "test"):
        img_dir = out / split / "images"
        lab_dir = out / split / "labels"
        if not img_dir.exists():
            continue
        for img in img_dir.glob("*"):
            if img.suffix.lower() not in (".jpg", ".jpeg", ".png"):
                continue
            split_imgs[split] += 1
            groups[base_id(img.stem)].add(split)
            lab = lab_dir / (img.stem + ".txt")
            if lab.exists():
                for line in lab.read_text(encoding="utf-8", errors="replace").splitlines():
                    p = line.split()
                    if len(p) >= 5:
                        class_boxes[p[0]] += 1
    leaked = sum(1 for v in groups.values() if len(v) > 1)
    stats = {
        "source_zip": args.zip,
        "license": "CC BY 4.0 (PlantDoc / Roboflow joseph-nelson/plantdoc v1)",
        "classes": names,
        "images_total": sum(split_imgs.values()),
        "base_groups": len(groups),
        "original_split_leaked_groups": leaked,
        "images_by_split": dict(split_imgs),
        "boxes_by_class_id": dict(class_boxes),
        "note": "仅作通用叶病预训练；未重划 split，原 split 仍有增强副本跨集（用前建议按原图基名分组）。",
    }
    (out / "stats.json").write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in stats.items() if k != "classes"}, ensure_ascii=False, indent=2))
    print("class names:", names)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
