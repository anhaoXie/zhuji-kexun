# 前期 EI 论文算法复现代码（AICM + YOLO11n）

本目录是团队前期 EI 论文（AIAHPC 2025，苹果叶病检测）的训练/复现代码，作为本作品轻量化检测算法的迁移参考：

- `src/aicm.py`：Adaptive Illumination Compensation Module（自适应光照补偿模块），插在 YOLO11n backbone 前端；
- `src/make_aicm_yaml.py`：把 AICM 插入 YOLO11n 结构并生成新 yaml；
- `src/make_labels.py` / `split.py` / `preview.py`：PlantVillage 分类数据转 YOLO 检测标签、分层划分与抽检；
- `src/yolo11n-aicm.yaml`：生成后的模型结构文件；
- `docs/env-snapshot.txt`、`docs/label_stats.json`：训练环境与标签统计。

依赖：ultralytics（AGPL-3.0）、PyTorch、OpenCV、PyYAML。预训练权重 `yolo11n.pt` 为 Ultralytics 公开权重，未随仓库分发，请从官方获取。

说明：本目录代码用于说明算法来源与复现路径；本作品当前模型为 YOLO11n 轻量化方案，训练产出见 `../bokchoy-baseline/`。
