# 公开数据完整基线（640 px / 207 epoch）

Bok Choy 公开数据集上的完整 YOLO11n 基线训练产物，用于验证「数据 → 训练 → 评估 → 导出」链路在正常分辨率与轮次下的表现。
本目录与 `../bokchoy-baseline/`（320 px / 8 epoch 快速验证）互补：前者验证链路能跑通，这里给出可用的基线水平。

## 1. 配置（源自 `args.yaml`）

| 项 | 值 |
|---|---|
| 数据 | `./dataset/bok_dataset/data.yaml`（Bok Choy 公开数据，2 类：diseased / healthy，本地重划分） |
| 模型 | YOLO11n（`yolo11n.yaml`） |
| 输入尺寸 | imgsz = 640 |
| 轮次 | epochs = 500（请求值），实际 207 轮早停（patience = 100） |
| 批大小 | batch = -1（自动） |
| 优化器 | optimizer = auto，lr0 = 0.01，lrf = 0.01，momentum = 0.937，weight_decay = 0.0005 |
| 其它 | pretrained = true，seed = 0，deterministic = true，workers = 8 |

## 2. 结果（验证集，`results.csv` 为权威数据）

| 取数点 | P | R | mAP@50 | mAP@50-95 |
|---|---|---|---|---|
| 最后一轮（epoch 207） | 0.555 | 0.689 | 0.617 | 0.360 |
| 最优轮（epoch 95，按 mAP@50） | 0.638 | 0.682 | **0.661** | **0.377** |

> 以上是**公开数据、单帧、模型级**基线；本作品验收用的「按株 Recall 0.85 / Precision 0.92」是自采温室数据微调、多角度 + 补拍之后的系统级指标，统计对象不同，两者不混用（见 [`docs/07-metrics.md`](../../../docs/07-metrics.md)）。
> 另有按类（diseased / healthy）的最终评估记录，随项目材料归档，不随本仓库分发。

## 3. 产物

| 文件 | 说明 |
|---|---|
| `results.csv` | 每轮损失与指标（权威数据） |
| `results.png` | 训练/验证损失与指标曲线 |
| `BoxPR_curve.png` / `BoxF1_curve.png` | PR / F1 曲线 |
| `confusion_matrix.png` / `confusion_matrix_normalized.png` | 混淆矩阵（原始 / 归一化） |
| `labels.jpg` | 标签分布 |
| `args.yaml` | 训练超参完整快照 |

**权重**：本仓库不分发 `best.pt`；按 `args.yaml` 与 [`../datasets/`](../datasets/) 的脚本可复现。

## 4. 环境

Python 3.12 + ultralytics（AGPL-3.0）+ PyTorch + OpenCV + Pillow + PyYAML。

## 5. 与 320 px / 8 epoch 版本的关系

| 版本 | 分辨率 | 轮次 | mAP@50 | 用途 |
|---|---|---|---|---|
| `../bokchoy-baseline/` | 320 | 8 | 0.579 | CPU 快速验证链路 |
| 本目录 | 640 | 207（早停） | 0.661（最优轮） | 可用基线 / 论文与作品材料引用 |

由快速验证（24 分钟 CPU）升级到 640 px、正常轮次后，mAP@50 提升约 8 个百分点；说明链路正确，瓶颈在数据与标注，而不是训练跑通与否。
