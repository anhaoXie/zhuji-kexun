# 从 best.pt 到 K230 板端推理（已上板验证）

> 在 **CanMV K230 YAHBOOM-1G（CanMV 固件 v1.4.3，传感器 GC2093）** 上跑通。

## 1. 链路

```text
best.pt --(ultralytics export)--> best_320.onnx
        --(nncase 2.11.0 + K230 target + KPU plugin, int8 PTQ)--> best_320.kmodel (2.93 MB)
        --(CanMV K230 detect_yolo11.py)--> 摄像头帧 -> KPU -> YOLO 后处理 -> 屏幕画框
```

## 2. 实测记录

- 诊断脚本：摄像头、LCD、串口全部通过，连续 120 帧无异常；
- 检测脚本 `code/demo/firmware/k230/detect_yolo11.py`：K230 屏幕出现检测框并标注类别/置信度；
- 证据照片：`code/demo/firmware/k230/board_verify.jpg`（板端运行）；
- 示例输出：`healthy 0.19`（公开数据基线 + int8 量化下置信度偏低；**检测精度不作为作品指标**，作品指标见 [`docs/07-metrics.md`](../../../../docs/07-metrics.md)）。

## 3. 文件位置

| 文件 | 说明 |
|---|---|
| `code/demo/firmware/k230/detect_yolo11.py` | K230 端推理脚本（摄像头 + kmodel + 画框） |
| `code/demo/firmware/k230/best_320.kmodel` | int8 kmodel，2.93 MB |
| `code/demo/firmware/k230/K230上板说明.md` | 上板步骤与排错 |
| `code/demo/firmware/k230/board_verify.jpg` | 板端运行照片 |
| `code/training/bokchoy-baseline/export/export_onnx.py` | pt → onnx |

## 4. 复现命令

```bash
# 1) ONNX（在 export 目录执行；weights 目录自行准备）
python export_onnx.py --weights ../weights/best.pt --imgsz 320

# 2) kmodel（Windows，nncase 2.11.0 + K230 KPU plugin + .NET 7）
#    输入 uint8 / 1x3x320x320 / 预处理 mean=0 std=255 / int8 PTQ（48 张校准图）
#    具体参数以所用 nncase 版本与 CanMV 固件为准
```

> K230 板端运行时若提示 kmodel 版本不匹配，需按板子固件对应的 nncase 版本重新编译；本次固件为 CanMV v1.4.3。
