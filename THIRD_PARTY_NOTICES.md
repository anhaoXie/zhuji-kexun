# 第三方组件与数据许可

本仓库包含少量第三方代码依赖与公开数据集资源。使用、修改与再分发时请遵守下列许可。

## 1. 软件依赖

| 组件 | 许可 | 在本仓库中的位置 | 说明 |
|---|---|---|---|
| [Ultralytics YOLO](https://github.com/ultralytics/ultralytics) | AGPL-3.0 | `code/training/` | 训练、验证与 ONNX 导出依赖；本仓库不分发其源码或预训练权重 |
| [nncase](https://github.com/kendryte/nncase) | Apache-2.0 | `code/demo/firmware/k230/`（文档引用） | K230 kmodel 编译工具，未随仓库分发 |
| CanMV K230 / MicroPython | 见官方说明 | `code/demo/firmware/k230/` | K230 板端运行时 |
| Node.js / 浏览器 | 各自许可 | `code/demo/tools/`、`code/demo/web/` | 仅作为开发/截图工具，未随仓库分发 |

> `code/training/` 中的脚本为项目自有代码，但其运行依赖 Ultralytics（AGPL-3.0）。若将本仓库训练代码或其衍生模型用于分发，请自行评估并遵守 AGPL-3.0 的要求。

## 2. 公开数据集

### Bok Choy Disease Detection

- **来源**：Roboflow Universe `bok-choy/bok-choy-disease-detection` v2；Kaggle 镜像 `nguynhcan/bok-choy-disease-detection-yolo-format`
- **许可**：**CC BY 4.0**
- **规模**：1,965 张（480 组原图 × 4 倍增强），2 类 `diseased` / `healthy`
- **本项目修改**：按原图基名分组重划 70/15/15（1,402 / 286 / 277），避免增强副本跨 split 泄漏；统计见 `code/training/datasets/bok_choy_yolo/stats.json`
- **引用要求**：注明来源、许可，并说明本项目做了修改；**不得**将公开数据说成本团队采集

### PlantDoc

- **来源**：Roboflow `joseph-nelson/plantdoc` v1；Kaggle 镜像 `andresmgs/plantdec`
- **许可**：**CC BY 4.0**
- **规模**：2,567 张，30 类叶病/健康
- **本项目修改**：路径修复与短名改写
- **用途**：通用叶病预训练/骨干验证，不是本作品作物数据

### 苹果叶病数据（前期论文同源）

- 用于团队前期 EI 论文的算法流程验证，**不是**本作品作物数据；未随本仓库分发。

## 3. 项目自有素材

- 演示界面、图表、设计图、代码：由项目团队制作，采用 MIT（见 `LICENSE`）。
- 车端相机画面与检测样例：来自团队样机拍摄或公开数据集样例，已确认不含人脸、真实温室位置与人员信息。

## 4. 引用格式

如在研究或工程中引用本项目，请引用仓库地址与本页列出的核心参考文献（见 `docs/references.md`）。
