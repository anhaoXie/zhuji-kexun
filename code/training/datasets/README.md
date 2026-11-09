# 数据集管线

> 本目录解决两件事：① 公开数据集从哪来、许可怎么标、怎么整理；② 现有数据能做什么、不能做什么，以及为保证评测口径还需要补什么。
> 所有统计由脚本生成（`bok_choy_yolo/stats.json` 可复核）。

## 1. 已整理的数据集

| 目录 | 内容 | 规模 | 许可 | 用途 |
|---|---|---|---|---|
| `bok_choy_yolo/` | 上海青（Bok Choy）病/健检测，YOLO 格式 | **1,965 张**（480 组原图 + 4× 增强；train 1,402 / valid 286 / test 277）；2 类 `diseased` / `healthy`；640×640 | **CC BY 4.0** | 主数据集：2 类病/健检测的预训练与基线 |
| `plantdoc_yolo/`（按脚本生成） | PlantDoc 通用叶病检测，YOLO 格式 | 2,567 张；30 类 | **CC BY 4.0** | 通用叶病预训练/骨干验证，不是本作物 |

来源（Kaggle 公开数据集，CC BY 4.0，无需登录即可匿名下载）：

- Bok Choy：`https://www.kaggle.com/datasets/nguynhcan/bok-choy-disease-detection-yolo-format`
  - 原始来源：Roboflow Universe `bok-choy/bok-choy-disease-detection` v2
- PlantDoc：`https://www.kaggle.com/datasets/andresmgs/plantdec`
  - 原始来源：Roboflow `joseph-nelson/plantdoc` v1

## 2. 复现

```bash
# 1) 下载（脚本只用标准库；已下载可跳过）
python download_datasets.py

# 2) 整理（需要 ultralytics / Pillow / PyYAML）
python prepare_bokchoy.py
python prepare_plantdoc.py
```

> 原始标签里有 **2 个文件混入了 segment 行**（不是纯 detect 行），Ultralytics 训练时会自动跳过这 2 张（日志里 1,402→1,400、286→284）；不影响结论，正式训练前可跑一次清洗（只保留 5 列 `class x y w h`）。

## 3. 一个必须处理的坑：原 split 有 69% 的原图跨集

Bok Choy 的 1,965 张图只来自 **480 张原图**（4× 增强）。原始导出里，**331/480 组（69%）** 的增强副本同时出现在 train/valid（或 test）中——同一片叶子换个亮度/角度就同时进训练和测试，模型分数会虚高。

本仓库按「原图基名」分组后重划 **70/15/15**，保证同一原图的所有增强只落在一个 split：

| Split | 组数 | 张数 |
|---|---|---|
| train | 336 | 1,402 |
| valid | 72 | 286 |
| test | 72 | 277 |

这与作品中「随机划分 → 按日期划分」的论证是同一件事：**公开数据先排除增强泄漏，再谈指标；真正的泛化结论仍要靠自采的跨日期数据。**

## 4. 能做什么、不能做什么

**能做**：

- 训练一个 2 类（`diseased` / `healthy`）轻量检测器（YOLO11n/YOLOv8n），得到检测框与置信度；
- 验证「数据集—训练—导出—量测」全流程，给 K230 部署提供 ONNX/kmodel 候选；
- 作为预训练权重，在自采数据上微调（迁移学习），减少自采数据量。

**不能**直接支撑现场指标：

- 只有病/健两类，**没有叶斑病/炭疽病等具体病害名**，不能直接产出「病害类型」；
- 框的粒度不一致：部分框是整株、部分是叶片，**不是病斑级框**；
- 全部是田间/网图，**不是本作品温室的固定机位、俯视/斜视**，存在域差；
- 没有「同一株跨日期」的配对，**支撑不了六状态与找回率**；
- 没有植保员盲判真值，**支撑不了 κ 与一致率**。

结论：公开数据用来「把模型训起来、跑通部署」；现场能力指标必须用自采数据评估（见 [`../../../docs/07-metrics.md`](../../../docs/07-metrics.md)）。

## 5. 自采数据的建议

目标：**2 类、病斑级框、跨 2 个日期、同机位**，用于微调与验证。

| 项 | 建议 |
|---|---|
| 对象 | 现有上海青 4 盆，或补 8—12 盆（含 2—4 盆有意留病/接种） |
| 设备 | 手机固定支架，或 K230 顶视 0.8—1.0 m；白卡纸/黑布背景，固定补光 |
| 拍摄 | 每株顶视 1 + 斜视 30° 1；每株 2 张/次；每天固定时段；连续 2—3 个日期 |
| 数量 | ≥300 张（约 40—60 株 × 2 角度 × 2—3 日期），其中病叶/病斑框 ≥150 |
| 标注 | LabelImg/CVAT，YOLO 格式；框贴病斑/病叶，不要框整盆 |
| 划分 | **按日期划分**：D1 训练、D2 验证、D3 测试；同一株不同日期不能跨集 |
| 记录 | 每张带：日期、株位码、角度、拍摄距离、操作人 |

## 6. 训练与导出命令

```bash
# 基线（CPU 可跑；GPU 更快）
yolo detect train model=yolo11n.pt data=bok_choy_yolo/data.yaml \
  epochs=30 imgsz=640 batch=8 device=cpu workers=0 \
  project=runs name=bokchoy_yolo11n_640

# 验证
yolo detect val model=runs/bokchoy_yolo11n_640/weights/best.pt \
  data=bok_choy_yolo/data.yaml split=test

# 导出 ONNX（给 K230 nncase 用）
yolo export model=runs/bokchoy_yolo11n_640/weights/best.pt format=onnx imgsz=320 opset=12 simplify=True
```

K230 部署路线：`best.pt → ONNX → nncase（量化校准集 100—300 张）→ .kmodel → CanMV K230 推理`。
注意：量化校准集要用**本作品实拍图**，不能用公开网图；nncase 版本要与 CanMV 固件匹配。

## 7. 许可与引用

- Bok Choy 数据集：CC BY 4.0，来源 Roboflow `bok-choy/bok-choy-disease-detection` v2（经 Kaggle 导出）。
- PlantDoc：CC BY 4.0，来源 Roboflow `joseph-nelson/plantdoc` v1（经 Kaggle 导出）。
- 使用要求：注明来源、许可、是否修改（本项目做了重划/清洗/改短名，需写 modified）；不要把公开数据说成本团队采集。
- 自采数据：写清采集时间/地点/操作人/授权（温室许可、植保员），人脸/校名按脱敏要求处理。

## 8. 目录

```
datasets/
  README.md                  # 本文件
  download_datasets.py       # 公开数据集下载（标准库）
  prepare_bokchoy.py         # 解压 + 按原图分组重划 split + 统计 + 预览图
  prepare_plantdoc.py        # 解压 + 改短名 + 修 data.yaml + 统计
  bok_choy_yolo/             # 已整理：data.yaml / stats.json
  raw/                       # 原始解压（运行时生成，已被 .gitignore 忽略）
  runs/                      # 训练输出（运行时生成，已被 .gitignore 忽略）
```

## 9. 基线训练结果（CPU）

- 配置：YOLO11n，公开 Bok Choy 数据（重划后 train 1,402 / valid 286 / test 277），`imgsz=320`、8 epochs、batch 8、CPU。
- 验证集：**P 0.674 / R 0.544 / mAP50 0.579 / mAP50-95 0.328**。
- 产物见 `../bokchoy-baseline/`（`results.csv`、`results.png`、PR/F1 曲线、混淆矩阵）。
- 说明：320 px + 8 epochs + CPU，只用于验证链路，**不能当作品最终指标**；正式训练建议 640 px、30—50 epochs、GPU，并做「按原图分组 vs 随机划分」的对照。
