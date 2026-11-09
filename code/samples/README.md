# 数据集样例与检测结果

本目录让读者直接看到：**数据从哪来、长什么样、训练出的模型在测试集上检出什么。**

## 1. 数据来源与规模

| 数据集 | 规模 | 许可 | 说明 |
|---|---|---|---|
| Bok Choy（上海青）YOLO | 1,965 张（480 组原图 × 4 倍增强） | CC BY 4.0 | 主数据集，2 类：`diseased` / `healthy`；本目录样例取自 test 划分 |
| PlantDoc YOLO | 2,567 张、30 类 | CC BY 4.0 | 通用叶病预训练，不是本作物 |

- 下载与整理脚本：`../training/datasets/`
- 原始数据体积：上海青约 110 MB、PlantDoc 约 74 MB，不随仓库分发；样例与标签已足够核对。

## 2. 本目录内容

| 文件/目录 | 说明 |
|---|---|
| `images/` | 16 张 test 样例（8 病株 + 8 健康），原图 |
| `labels/` | 对应 YOLO 标注（`class cx cy w h`） |
| `predictions/` | 用基线模型在 320 输入下推理后的画框结果（`pred_` 前缀） |
| `predictions_summary.csv` | 每张图的检出框数、类别、置信度 |
| `sample_manifest.csv` | 样例清单：真值类别、标注框数、来源划分 |
| `inference_demo.py` | 一条命令复现推理 |
| `export_onnx.py` | 导出 ONNX，供 K230 nncase 编译 kmodel |

## 3. 复现推理

```bash
# 需要 ultralytics + torch + opencv 环境
python inference_demo.py --weights ../training/bokchoy-baseline/weights/best.pt \
  --source images --out predictions
```

> 权重不随仓库分发；需先按 `../training/` 的说明训练或自行准备 `best.pt`。
> 这不是作品温室实测结果，只是「公开数据 → 训练 → 推理」链路的可视化验证；作品指标见 [`../../docs/07-metrics.md`](../../docs/07-metrics.md)。

## 4. 检测模型口径

| 项 | 值 |
|---|---|
| 模型 | YOLO11n |
| 训练 | 8 epochs、imgsz=320、batch=8、CPU 基线 |
| 测试集 | Bok Choy test 277 张（按原图分组划分，未参与训练） |
| 指标 | Precision 0.674 / Recall 0.544 / mAP@50 0.579 / mAP@50-95 0.328 |
| 用途 | 验证训练与部署流程，**不作为作品实测指标** |

正式指标需自采温室跨日期数据微调后再评估。
