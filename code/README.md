# 代码总览

本目录包含《株迹可循》的可运行软件、算法与数据工程代码。整体分为三块：

```
code/
├─ demo/                     # 可运行演示：手机端 / PC 端 / 服务端 / K230 固件
├─ training/
│  ├─ model/                 # 前期 EI 论文算法复现代码（AICM + YOLO11n）
│  ├─ datasets/              # 公开数据集下载、清洗、按原图分组重划分
│  └─ bokchoy-baseline/      # 公开数据基线训练产出（曲线 + 结果）
└─ samples/                  # 16 张测试样例 + 推理画框结果
```

## 各模块说明

| 模块 | 内容 | 入口 |
|---|---|---|
| **demo** | Python 标准库本地服务 + 手机端 H5 + PC 棚务台 + 微信小程序骨架 + CanMV K230 固件（图传 / kmodel 推理） | [`demo/README.md`](demo/README.md) |
| **model** | 自适应光照补偿模块 AICM 与 YOLO11n 结构生成、标签转换、数据划分 | [`training/model/README_模型训练说明.md`](training/model/README_模型训练说明.md) |
| **datasets** | 公开数据下载、解压、按原图基名分组重划、统计与泄漏分析 | [`training/datasets/README.md`](training/datasets/README.md) |
| **bokchoy-baseline** | YOLO11n 320 px / 8 epochs CPU 基线的训练产出与 K230 导出说明 | [`training/bokchoy-baseline/README.md`](training/bokchoy-baseline/README.md) |
| **samples** | 16 张测试样例、YOLO 标签、推理结果与汇总 CSV | [`samples/README.md`](samples/README.md) |

## 最短路径

```bash
# 1) 本地演示（无需第三方依赖）
cd code/demo
python server/app.py
# 打开 http://127.0.0.1:8765/（手机端）或 /pc/（PC 棚务台）

# 2) 公开数据基线（需要 ultralytics 环境）
cd code/training/datasets
python download_datasets.py
python prepare_bokchoy.py
# 训练命令见 code/training/bokchoy-baseline/README.md
```

## 范围说明

- 车端 **STM32 运动控制固件**与 **ESP32-C3 通信固件**在整机侧维护，未包含在本仓库；
- 训练权重文件（`best.pt`）未随仓库分发，可用脚本复现；
- 自采温室数据涉及场地与授权，未公开。

## 代码规模

本仓库代码约 2 万行（Python / JavaScript / HTML / CSS / WXML / WXSS / MicroPython），不含文档与图片。

## 许可

代码采用 MIT；`training/` 依赖的 Ultralytics 为 AGPL-3.0。第三方数据许可见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。
