# -*- coding: utf-8 -*-
"""
aicm.py —— Adaptive Illumination Compensation Module（自适应光照补偿模块）

论文里的定义（原句）：
  "an Adaptive Illumination Compensation Module (AICM) is introduced at the front end of
   the YOLOv11n backbone ... uses an Illumination-Aware Network (IAN) to dynamically adjust
   the brightness and contrast of input images"

论文没有给出 IAN 的具体结构，所以这里是一个**最小可运行复现**：
  - 放在 backbone 第 0 层（front end），输入输出都是 3 通道、同尺寸
  - 由 3 层小卷积估计一张"逐像素增益图" g∈[-1,1]，再做残差式补偿 out = x*(1+g)
  - 参数量约 0.8K（不到 YOLO11n 的 0.04%），属于 5.5 节说的"中间态"模块：
    有参数、在计算图里、被梯度更新、推理成本极小

和 CLAHE 这种固定预处理的关键区别：
  增益图 g 是从数据里学出来的，而且和检测头联合优化 —— 梯度会穿过 AICM 回到它自己。
"""
import torch
import torch.nn as nn


class AICM(nn.Module):
    def __init__(self, c1=3, c2=3, hidden=8):
        super().__init__()
        self.c1, self.c2 = c1, c2
        self.estimator = nn.Sequential(
            nn.Conv2d(c1, hidden, 3, 1, 1, bias=True),
            nn.ReLU(inplace=True),
            nn.Conv2d(hidden, hidden, 3, 1, 1, bias=True),
            nn.ReLU(inplace=True),
            nn.Conv2d(hidden, c1, 1, 1, 0, bias=True),
            nn.Tanh(),                      # 增益限制在 [-1, 1]，避免过曝
        )

    def forward(self, x):
        # ultralytics 送进来的是 [0,1] 区间的 float 张量
        g = self.estimator(x)
        return torch.clamp(x * (1.0 + g), 0.0, 1.0)


if __name__ == "__main__":
    m = AICM()
    n = sum(p.numel() for p in m.parameters())
    x = torch.rand(2, 3, 64, 64)
    y = m(x)
    print(f"AICM params = {n}")
    print("in :", tuple(x.shape), "range", float(x.min()), float(x.max()))
    print("out:", tuple(y.shape), "range", float(y.min()), float(y.max()))
