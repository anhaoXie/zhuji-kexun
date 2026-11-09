# 文档索引

本目录是《株迹可循》的设计与评测文档。所有图片位于 [`figures/`](figures/)，编号与项目设计图一一对应。

## 阅读路线

**第一次了解项目**：

1. [01 项目概述](01-overview.md) — 问题、思路、创新点
2. [02 系统架构](02-system-architecture.md) — 整机五块、软件四层、数据流
3. [07 指标与评测](07-metrics.md) — 测什么、怎么测、结果怎么读

**深入技术细节**：

4. [03 一株一档与定位](03-plant-level-record.md) — 五级株位码、三层定位、找回
5. [04 六状态与建议](04-six-state-and-advice.md) — 判定顺序、阈值、规则表
6. [05 航线与成像](05-route-and-imaging.md) — S 形分幅、覆盖判据、GSD
7. [06 检测与数据集](06-detection-and-datasets.md) — 模型、数据泄漏、K230 部署

**工程与交付**：

8. [08 软件与演示](08-software-and-demo.md) — 软件栈、接口、演示动线
9. [11 边界与合规](11-boundaries-and-compliance.md) — 边界、安全、许可、脱敏
10. [12 研发历程](12-roadmap-and-history.md) — 里程碑与后续计划

**其他**：

- [09 市场与产业化](09-market-and-business.md)
- [10 团队与分工](10-team-and-roles.md)
- [13 选题与方向调研](13-research-and-selection.md) — 五方向比较、证据分级、关键判断的修正
- [参考文献](references.md)

## 图片清单

| 文件 | 对应设计图 |
|---|---|
| `figures/fig1a_hardware_architecture.png` | 图 1(a) 整机硬件组成与通信关系 |
| `figures/fig1b_inspection_flow.png` | 图 1(b) 巡检主流程 |
| `figures/fig2_route.png` | 图 2 棚内巡检航线 |
| `figures/fig3_plant_code.png` | 图 3 五级株位码 |
| `figures/fig4_same_plant_judgement.png` | 图 4 同一株怎么判 |
| `figures/fig5_three_layer_localization.png` | 图 5 三层定位 |
| `figures/fig6_dataset_samples.png` | 图 6 数据集样本与标注框 |
| `figures/fig7_metrics.png` | 图 7 主要技术指标 |
| `figures/fig8_bom.png` | 图 8 已列价器件构成 |
| `figures/fig9_field_demo.png` | 图 9 外场功能演示 |
| `figures/fig10_timeline.png` | 图 10 研发时间线 |
| `figures/fig11_mobile_ui.png` | 图 11 手机端界面 |
| `figures/fig12_pc_console.png` | 图 12 PC 棚务台 |
| `figures/ui_mobile_4screens.png` | 手机端四屏合成 |
