# -*- coding: utf-8 -*-
"""下载公开数据集（Kaggle 匿名下载，仅标准库）。

2026-11-04 实测：未登录 Kaggle 也能下载这两个 CC BY 4.0 数据集。
若你的网络/地区需要登录，请改用浏览器下载后放到 --out 目录，文件名保持一致。

用法：
    python datasets/download_datasets.py
    python datasets/download_datasets.py --out C:\\Temp\\kaggle_test
    python datasets/download_datasets.py --include-augmented   # 额外下增强版（146MB）
"""
from __future__ import annotations

import argparse
import os
import sys
import urllib.request
from pathlib import Path

DATASETS = {
    "bok_choy": {
        "ref": "nguynhcan/bok-choy-disease-detection-yolo-format",
        "file": "nguynhcan_bok-choy-disease-detection-yolo-format.zip",
        "bytes": 115_214_953,
        "note": "Bok Choy 病/健检测 YOLO，CC BY 4.0；主数据集",
    },
    "plantdoc": {
        "ref": "andresmgs/plantdec",
        "file": "andresmgs_plantdec.zip",
        "bytes": 77_744_776,
        "note": "PlantDoc 通用叶病检测 YOLO，CC BY 4.0；预训练用",
    },
    "bok_choy_aug": {
        "ref": "nguynhcan/bok-choy-disease-detection-yolo-augmented",
        "file": "nguynhcan_bok-choy-disease-detection-yolo-augmented.zip",
        "bytes": 146_043_294,
        "note": "Bok Choy 增强版（可选，主数据集已含增强）",
    },
}


def download(url: str, dest: Path, expected: int, timeout: int = 180) -> bool:
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (dataset-fetch; Challenge-Cup-2026)",
        "Accept": "*/*",
    })
    tmp = dest.with_suffix(dest.suffix + ".part")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp, open(tmp, "wb") as f:
            total = 0
            while True:
                chunk = resp.read(1024 * 256)
                if not chunk:
                    break
                f.write(chunk)
                total += len(chunk)
                if expected and total % (1024 * 1024) < 1024 * 256:
                    print(f"  {total/1048576:.1f}/{expected/1048576:.1f} MB", end="\r")
        size = tmp.stat().st_size
        if expected and size != expected:
            print(f"\n  [WARN] 大小不一致：{size} != {expected}（可能是登录页/被截断）")
            tmp.replace(dest)
            return False
        tmp.replace(dest)
        print(f"\n  OK {dest.name} {size/1048576:.1f} MB")
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"\n  [FAIL] {dest.name}: {exc}")
        if tmp.exists():
            tmp.unlink(missing_ok=True)
        return False


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent / "raw_downloads"))
    ap.add_argument("--include-augmented", action="store_true")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    targets = ["bok_choy", "plantdoc"] + (["bok_choy_aug"] if args.include_augmented else [])
    ok = 0
    for key in targets:
        meta = DATASETS[key]
        dest = out / meta["file"]
        print(f"[{key}] {meta['ref']} -> {dest}")
        if dest.exists() and meta["bytes"] and dest.stat().st_size == meta["bytes"]:
            print("  已存在且大小一致，跳过")
            ok += 1
            continue
        url = f"https://www.kaggle.com/api/v1/datasets/download/{meta['ref']}"
        if download(url, dest, meta["bytes"]):
            ok += 1
    print(f"\n完成 {ok}/{len(targets)}。下一步：")
    print("  <python-with-ultralytics> datasets/prepare_bokchoy.py")
    print("  <python-with-ultralytics> datasets/prepare_plantdoc.py")
    return 0 if ok == len(targets) else 1


if __name__ == "__main__":
    raise SystemExit(main())
