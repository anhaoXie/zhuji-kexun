# training · 算法与数据工程

本目录包含检测模型的训练链路、公开数据集管理与 K230 部署说明。

```
training/
├─ model/                 # 前期 EI 论文算法复现代码（AICM + YOLO11n）
├─ datasets/              # 公开数据集下载、清洗、按原图分组重划
└─ bokchoy-baseline/      # 公开数据基线训练产出（曲线 + 结果 + 导出说明）
```

## 1. 算法来源

本作品的轻量化检测方案基于团队前期 EI 论文（AIAHPC 2025，苹果叶病轻量化检测）中的：

- **AICM**（Adaptive Illumination Compensation Module，自适应光照补偿模块），插在 YOLO11n backbone 前端；
- 轻量化检测与评测流程。

`model/` 保留该论文的复现代码（AICM 插入、数据转换、划分、抽检），作为本作品的**迁移参考**。

## 2. 数据

| 数据集 | 规模 | 许可 | 用途 |
|---|---|---|---|
| Bok Choy（上海青） | 1,965 张（480 组原图 × 4× 增强） | CC BY 4.0 | 主数据集，2 类 `diseased` / `healthy` |
| PlantDoc | 2,567 张 / 30 类 | CC BY 4.0 | 通用叶病预训练，不是本作物 |
| 苹果叶病 | 3,171 张 / 4 类 | 见原数据集 | 前期论文同源，只作流程验证 |

**关键发现**：Bok Choy 的 1,965 张只来自 480 张原图；原始划分中 331/480 组（69%）的增强副本跨集。本仓库按**原图基名**分组重划 70/15/15，保证同图增强只落在一个 split（1,402 / 286 / 277）。

## 3. 快速开始

```bash
cd code/training/datasets
python download_datasets.py
python prepare_bokchoy.py      # 需要 ultralytics / Pillow / PyYAML 环境
python prepare_plantdoc.py
```

训练：

```bash
yolo detect train model=yolo11n.pt data=bok_choy_yolo/data.yaml \
  epochs=8 imgsz=320 batch=8 device=cpu project=runs name=bokchoy_yolo11n_320
```

导出 ONNX 与 K230 kmodel 说明见 `bokchoy-baseline/export/`。

## 4. 公开数据基线结果（非作品指标）

YOLO11n / 320 px / 8 epochs / CPU，验证集（286 张）：

| Precision | Recall | mAP@50 | mAP@50-95 |
|---|---|---|---|
| 0.674 | 0.544 | 0.579 | 0.328 |

> 仅用于验证「数据—训练—评估—导出」链路；作品指标见 [`../../docs/07-metrics.md`](../../docs/07-metrics.md)。
> 本仓库不含训练权重文件，可用脚本复现；曲线与 `results.csv` 在 `bokchoy-baseline/`。

## 5. 许可

- 训练脚本依赖 **Ultralytics（AGPL-3.0）**，使用与再分发须遵守其许可；
- 公开数据集为 **CC BY 4.0**，需注明来源与修改；
- 详见 [`../../THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md)。
