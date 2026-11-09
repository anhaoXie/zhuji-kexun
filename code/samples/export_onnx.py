# -*- coding: utf-8 -*-
"""Export best.pt to ONNX for K230 nncase -> kmodel."""
import argparse
from ultralytics import YOLO


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", default="weights/best.pt")
    ap.add_argument("--imgsz", type=int, default=320)
    ap.add_argument("--opset", type=int, default=12)
    args = ap.parse_args()
    model = YOLO(args.weights)
    path = model.export(format="onnx", imgsz=args.imgsz, opset=args.opset, simplify=True, dynamic=False)
    print("onnx:", path)


if __name__ == "__main__":
    main()
