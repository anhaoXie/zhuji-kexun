# -*- coding: utf-8 -*-
"""
K230 CanMV · 上海青病害检测（YOLO11n + kmodel）
================================================
配套模型：best_320.kmodel（由 YOLO11n 320×320 导出，nncase 2.11 编译）
类别：0 = diseased（病株），1 = healthy（健康）

使用前：
1. 把 best_320.kmodel 放到 K230 的 /sdcard/ 下（CanMV IDE 左侧文件树可上传）；
2. 按你的板子改 DISPLAY_MODE（亚博 K230 视觉模块一般用 "lcd"）；
3. CanMV IDE 打开本文件 → 运行。

说明：本脚本按亚博 K230 教程的 AIBase / Ai2d / PipeLine 结构编写，
首次上板若提示 API 不一致，把完整报错反馈给维护者，我按你的固件版本改。
"""

import os
import sys
import gc
import time

print("MODEL STEP 0: 脚本开始")

from libs.PipeLine import PipeLine, ScopedTiming
from libs.AIBase import AIBase
from libs.AI2D import Ai2d

import nncase_runtime as nn
import ulab.numpy as np
import aidemo

print("MODEL STEP 1: 导入成功")


def align_up(v, n=16):
    """老固件没有内置 ALIGN_UP，这里自己算（不影响结果）。"""
    return ((v + n - 1) // n) * n


# ============================ 用户配置 ============================
KMODEL_PATH = "/sdcard/best_320.kmodel"
LABELS = ["diseased", "healthy"]
CONF_THRESHOLD = 0.10
NMS_THRESHOLD = 0.45
MAX_BOXES = 50
MODEL_INPUT_SIZE = [320, 320]
RGB888P_SIZE = [640, 360]
DISPLAY_MODE = "lcd"          # 亚博 K230 视觉模块用 "lcd"；HDMI 显示器改 "hdmi"
# =================================================================


def letterbox_pad_param(src_size, dst_size):
    """计算 letterbox 的上下左右 padding。"""
    src_w, src_h = src_size
    dst_w, dst_h = dst_size
    scale = min(float(dst_w) / src_w, float(dst_h) / src_h)
    new_w = int(round(src_w * scale))
    new_h = int(round(src_h * scale))
    dw = dst_w - new_w
    dh = dst_h - new_h
    top = dh // 2
    bottom = dh - top
    left = dw // 2
    right = dw - left
    return top, bottom, left, right, scale


class YOLO11DetectionApp(AIBase):
    """YOLO11n 检测：kmodel 推理 + YOLOv8 风格解码（每行 4 框 + N 类）。"""

    def __init__(self, kmodel_path, labels, model_input_size, rgb888p_size, display_size,
                 confidence_threshold=0.25, nms_threshold=0.45, max_boxes_num=50, debug_mode=0):
        super().__init__(kmodel_path, model_input_size, rgb888p_size, debug_mode)
        self.kmodel_path = kmodel_path
        self.labels = labels
        self.model_input_size = model_input_size
        self.confidence_threshold = confidence_threshold
        self.nms_threshold = nms_threshold
        self.max_boxes_num = max_boxes_num
        self.rgb888p_size = [align_up(rgb888p_size[0], 16), rgb888p_size[1]]
        self.display_size = [align_up(display_size[0], 16), display_size[1]]
        self.debug_mode = debug_mode
        self.color_pair = [(255, 80, 60, 255), (60, 200, 120, 255)]
        self.ai2d = Ai2d(debug_mode)
        self.ai2d.set_ai2d_dtype(nn.ai2d_format.NCHW_FMT, nn.ai2d_format.NCHW_FMT, np.uint8, np.uint8)

    def config_preprocess(self, input_image_size=None):
        with ScopedTiming("set preprocess config", self.debug_mode > 0):
            ai2d_input_size = input_image_size if input_image_size else self.rgb888p_size
            top, bottom, left, right, self.scale = letterbox_pad_param(self.rgb888p_size, self.model_input_size)
            self.ai2d.pad([0, 0, 0, 0, top, bottom, left, right], 0, [128, 128, 128])
            self.ai2d.resize(nn.interp_method.tf_bilinear, nn.interp_mode.half_pixel)
            self.ai2d.build([1, 3, ai2d_input_size[1], ai2d_input_size[0]],
                            [1, 3, self.model_input_size[1], self.model_input_size[0]])

    def preprocess(self, input_np):
        print("PRE 1: 预处理开始")
        with ScopedTiming("preprocess", self.debug_mode > 0):
            out = [nn.from_numpy(input_np)]
        print("PRE 2: 预处理完成")
        return out

    def postprocess(self, results):
        print("POST 1: 后处理开始")
        with ScopedTiming("postprocess", self.debug_mode > 0):
            # YOLO11 输出 [1, 4+nc, N] -> [N, 4+nc]
            print("POST 2: 原始输出 shape =", results[0].shape)
            new_result = results[0][0].transpose()
            print("POST 3: 转置后 shape =", new_result.shape)
            try:
                mx = 0.0
                for row in new_result:
                    s0 = row[4]
                    s1 = row[5]
                    if s0 > mx:
                        mx = s0
                    if s1 > mx:
                        mx = s1
                print("POST 3.5: 原始最大置信度 =", mx)
            except Exception as e:
                print("POST 3.5 读取失败:", e)
            det_res = aidemo.yolov8_det_postprocess(
                new_result.copy(),
                [self.rgb888p_size[1], self.rgb888p_size[0]],
                [self.model_input_size[1], self.model_input_size[0]],
                [self.display_size[1], self.display_size[0]],
                len(self.labels),
                self.confidence_threshold,
                self.nms_threshold,
                self.max_boxes_num,
            )
            print("POST 4: 后处理完成")
            try:
                print("POST 4.5: 检出框数 =", len(det_res[0]) if det_res else 0)
            except Exception as e:
                print("POST 4.5 读取失败:", e)
            return det_res

    def draw_result(self, pl, dets):
        with ScopedTiming("display_draw", self.debug_mode > 0):
            if dets and len(dets[0]) > 0:
                pl.osd_img.clear()
                for i in range(len(dets[0])):
                    x, y, w, h = [int(round(v, 0)) for v in dets[0][i]]
                    cid = dets[1][i]
                    score = dets[2][i]
                    color = self.color_pair[cid % len(self.color_pair)]
                    pl.osd_img.draw_rectangle(x, y, w, h, color=color, thickness=3)
                    text = " %s %.2f" % (self.labels[cid], score)
                    pl.osd_img.draw_string_advanced(x, max(0, y - 32), 28, text, color=color)
            else:
                pl.osd_img.clear()


def exce_demo(pl):
    print("MODEL STEP 2: 进入检测流程")
    det = None
    try:
        print("MODEL STEP 3: 开始创建模型对象")
        det = YOLO11DetectionApp(
            KMODEL_PATH, LABELS, MODEL_INPUT_SIZE,
            rgb888p_size=RGB888P_SIZE,
            display_size=pl.display_size,
            confidence_threshold=CONF_THRESHOLD,
            nms_threshold=NMS_THRESHOLD,
            max_boxes_num=MAX_BOXES,
            debug_mode=0,
        )
        print("MODEL STEP 4: 模型对象创建成功")
        det.config_preprocess()
        print("MODEL STEP 5: 预处理配置成功, 开始循环")
        i = 0
        while True:
            if i == 0:
                print("LOOP 1: 准备取帧")
            os.exitpoint()
            if i == 0:
                print("LOOP 2: 开始取帧")
            img = pl.get_frame()
            if i == 0:
                print("LOOP 3: 拿到帧，开始推理")
            res = det.run(img)
            if i == 0:
                print("LOOP 4: 推理完成，开始画框")
            det.draw_result(pl, res)
            if i == 0:
                print("LOOP 5: 画框完成，显示")
            pl.show_image()
            gc.collect()
            if i % 10 == 0:
                print("MODEL 帧", i)
            i += 1
            time.sleep_us(10)
    except Exception as e:
        print("MODEL 运行失败:", e)
        sys.print_exception(e)
    finally:
        if det is not None:
            det.deinit()


if __name__ == "__main__":
    print("MODEL STEP A: 创建 PipeLine")
    pl = PipeLine(rgb888p_size=RGB888P_SIZE, display_size=[640, 480], display_mode=DISPLAY_MODE)
    print("MODEL STEP B: PipeLine 构造完成")
    pl.create()
    print("MODEL STEP C: create 完成")
    try:
        exce_demo(pl)
    except Exception as e:
        print("MODEL 主流程失败:", e)
        sys.print_exception(e)
    finally:
        pl.destroy()
        print("MODEL STEP 9: 结束")
