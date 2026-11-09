# 从 best.pt 到 K230 板端推理

> 本页记录公开数据基线模型到 K230 板端的完整链路。板端验证目标是把「导出—量化—上板—画框」跑通，**精度不作为作品指标**。

## 1. 链路

```text
best.pt  --(ultralytics export)-->  best_320.onnx
         --(nncase 2.11.0 + K230 target + KPU plugin, int8 PTQ)-->  best_320.kmodel (2.93 MB)
         --(CanMV K230 detect_yolo11.py)-->  摄像头帧 -> KPU -> YOLO 后处理 -> 屏幕画框
```

## 2. 当前状态

| 环节 | 状态 | 位置 |
|---|---|---|
| 数据集下载/整理、YOLO11n 训练 | ✅ 已有脚本与产出 | `../training/datasets/`、`../training/bokchoy-baseline/` |
| PyTorch 权重 `best.pt` | ⚠️ 不随仓库分发 | 按训练脚本复现 |
| 导出 ONNX | ✅ 脚本 | `../training/bokchoy-baseline/export/export_onnx.py` |
| ONNX → kmodel（nncase 编译） | ✅ 已完成 | `../demo/firmware/k230/best_320.kmodel` |
| K230 板端加载 kmodel、推理、画框 | ✅ 已上板验证 | `../demo/firmware/k230/detect_yolo11.py` |

## 3. 板端验证记录

| 项 | 内容 |
|---|---|
| 板卡 | CanMV K230 YAHBOOM-1G |
| 固件 | CanMV v1.4.3 |
| 传感器 | GC2093 |
| 量化 | int8 PTQ，校准集 48 张 |
| 结果 | 屏幕出现检测框并标注类别/置信度；连续 120 帧无异常 |
| 证据 | `../demo/firmware/k230/board_verify.jpg` |

> 公开数据基线 + int8 量化下置信度会偏低（示例 `healthy 0.19`），这是正常的；板端验证证明的是链路可用，**精度需用自采温室数据微调后重新评估**。

## 4. 复现命令

```bash
# 1) ONNX
python export_onnx.py --weights ../weights/best.pt --imgsz 320

# 2) kmodel（Windows，nncase 2.11.0 + K230 KPU plugin + .NET 7）
#    输入 uint8 / 1x3x320x320 / 预处理 mean=0 std=255 / int8 PTQ（48 张校准图）
#    具体参数以所用 nncase 版本与 CanMV 固件为准

# 3) 上板
#    把 best_320.kmodel 拷到 K230 /sdcard/，CanMV IDE 运行 detect_yolo11.py
```

## 5. 排错

| 现象 | 处理 |
|---|---|
| `load kmodel failed` / 版本不匹配 | 按板子固件对应的 nncase 版本重新编译 |
| `ImportError: aidemo` / 无后处理函数 | 升级固件，或改用纯 Python 后处理 |
| 画面正常但无框 | 降低 `CONF_THRESHOLD` 到 0.15；确认标签顺序 `diseased, healthy` 未反 |
| 显示比例不对/黑边 | 调整 `display_size` 与 `RGB888P_SIZE` |
| 帧率低 | 320 输入 + float kmodel 的正常现象；先保证出框，再考虑量化/降分辨率 |

详见 `../demo/firmware/k230/K230上板说明.md`。
