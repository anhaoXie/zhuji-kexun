# 公开数据基线训练产出

公开数据上的 YOLO11n 基线训练产物，用于验证「数据 → 训练 → 评估 → 导出」链路。

## 1. 配置

| 项 | 值 |
|---|---|
| 数据 | `../datasets/` 整理的 Bok Choy YOLO 数据（CC BY 4.0，1,965 张，2 类） |
| 重划分 | 按原图基名分组：train 1,402 / valid 286 / test 277 |
| 模型 | YOLO11n（公开预训练权重） |
| 训练 | 8 epochs，imgsz=320，batch=8，device=cpu |
| 耗时 | 约 23 min（CPU i5-13420H） |

训练命令：

```bash
yolo detect train model=yolo11n.pt data=../datasets/bok_choy_yolo/data.yaml \
  epochs=8 imgsz=320 batch=8 device=cpu project=runs name=bokchoy_yolo11n_320
```

## 2. 结果（验证集 286 张）

| 指标 | 值 |
|---|---|
| Precision | 0.674 |
| Recall | 0.544 |
| mAP@50 | 0.579 |
| mAP@50-95 | 0.328 |

产物：

| 文件 | 说明 |
|---|---|
| `results.csv` | 每个 epoch 的损失与指标（权威数据） |
| `results.png` | 训练曲线 |
| `BoxPR_curve.png` / `BoxF1_curve.png` / `BoxP_curve.png` / `BoxR_curve.png` | PR / F1 / P / R 曲线 |
| `confusion_matrix.png` / `confusion_matrix_normalized.png` | 混淆矩阵 |
| `labels.jpg` | 标签分布 |
| `export/export_onnx.py` | pt → onnx |
| `export/K230_kmodel部署说明.md` | onnx → kmodel → K230 接入 |

> **口径**：这是**公开数据基线**，用于验证流程，不是本作品的温室实测指标；作品指标见 [`../../../docs/07-metrics.md`](../../../docs/07-metrics.md)。
> **权重**：本仓库不包含 `best.pt`（训练权重体积与元数据原因），可用上方命令复现。

## 3. 环境

Python 3.12 + ultralytics（AGPL-3.0）+ PyTorch + OpenCV + Pillow + PyYAML。

## 4. 说明

- 320 px + 8 epochs + CPU 的配置刻意压低，目的是快速验证链路；
- 正式训练建议 640 px、30—50 epochs、GPU；
- 建议做「按原图分组 vs 随机划分」的对照，正好支撑数据泄漏的论证。
