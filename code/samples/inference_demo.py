# -*- coding: utf-8 -*-
"""One-command inference demo on the sample images."""
import argparse
import os

from ultralytics import YOLO


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--source", default="images")
    ap.add_argument("--out", default="predictions")
    ap.add_argument("--imgsz", type=int, default=320)
    ap.add_argument("--conf", type=float, default=0.25)
    args = ap.parse_args()

    model = YOLO(args.weights)
    results = model.predict(source=args.source, imgsz=args.imgsz, conf=args.conf, save=False, verbose=False)
    os.makedirs(args.out, exist_ok=True)
    import cv2
    for r in results:
        name = os.path.basename(r.path)
        cv2.imwrite(os.path.join(args.out, "pred_" + name), r.plot())
    print("done:", len(results), "images ->", args.out)


if __name__ == "__main__":
    main()
