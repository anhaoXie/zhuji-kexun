# -*- coding: utf-8 -*-
"""
make_aicm_yaml.py —— 把 AICM 插到 YOLO11n backbone 的最前端，生成新结构文件

为什么不能手工改 yaml：
  yaml 里的层引用有两种写法
    -1        → 上一层的输出（相对引用，插一层不影响）
    6 / 16    → 绝对层号（插一层后全部要 +1）
  head 里有 6、4、13、10 和 Detect 的 [16, 19, 22]，手工改必错，所以用脚本统一移位。
"""
import os
import yaml

import ultralytics

BASE = os.path.join(os.path.dirname(ultralytics.__file__), "cfg", "models", "11", "yolo11.yaml")
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src", "yolo11n-aicm.yaml")


def shift_ref(refs, delta):
    if isinstance(refs, int):
        return refs if refs == -1 else refs + delta
    return [r if r == -1 else r + delta for r in refs]


def main():
    d = yaml.safe_load(open(BASE, encoding="utf-8"))

    # 1) 在最前端插入 AICM
    d["backbone"].insert(0, [-1, 1, "AICM", [3]])

    # 2) 所有绝对引用整体 +1
    for part in ("backbone", "head"):
        for layer in d[part]:
            layer[0] = shift_ref(layer[0], 1)

    with open(OUT, "w", encoding="utf-8") as f:
        yaml.safe_dump(d, f, allow_unicode=True, sort_keys=False)

    print("written:", OUT)
    print("backbone[0] :", d["backbone"][0])
    print("head[-1]    :", d["head"][-1])
    print("layers      :", len(d["backbone"]) + len(d["head"]))


if __name__ == "__main__":
    main()
