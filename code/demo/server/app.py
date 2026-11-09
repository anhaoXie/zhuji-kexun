#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""《株迹可循》本地演示服务 v1（Python 3.12 标准库，无第三方依赖）。

职责
----
1. 托管 H5 静态文件：``/`` -> ../web/index.html，其余静态文件相对 ../web/；
   ``/assets/*`` -> ../assets/（素材由 项目负责人 提供，只读）。
2. 提供演示接口：``/api/state``、``/api/report``、``/api/video/info``、
   ``/api/export/csv``（UTF-8 BOM），另有 ``/api/health`` 便于联调探活。
3. 手写 WebSocket ``/ws``（握手 / 帧编解码 / ping-pong / close），每 500 ms 推送
   ``state``；处理 hello / control / mode / estop / estop_reset / video / review / ping。
4. 巡检仿真：20 个停靠位、35.8 m、0.5 m/s、每站停 2.4 s；默认从"演示检查点"
   （第 7/20 停靠位、42/64 株、66%）开始推进到完成，``--fresh`` 则从 0 开始跑完整圈。
5. ``--live host:port`` 预留 ESP32-C3 TCP 链路与 0x30/0x31/0x40/0x41/0x50/0x51
   帧解析骨架（本期不接真实硬件，自动降级为仿真并打印提示）。

关键安全规则（见 ../docs/api_contract.md）
------------------------------------------
* 非 remote 模式的 move 指令返回 ``ack.ok=false, error="mode"``；
* estop 后拒绝一切控制指令（``error="estop"``）；
* remote 模式下 500 ms 内没有新控制指令则自动 stop。

启动：
    python server/app.py                       # http://127.0.0.1:8765/
    python server/app.py --port 9000
    python server/app.py --live 192.168.4.1:8266
"""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import io
import json
import logging
import math
import mimetypes
import socket
import struct
import threading
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

try:  # 兼容 `python server/app.py` 与 `python -m server.app`
    from .camera_hub import CameraHub
except ImportError:  # pragma: no cover - 脚本方式运行时走这里
    from camera_hub import CameraHub

LOG = logging.getLogger("zhujikexun")

# ---------------------------------------------------------------------------
# 基础常量 / 目录
# ---------------------------------------------------------------------------
APP_VERSION = "v1.0.0"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765

SERVER_DIR = Path(__file__).resolve().parent
APP_DIR = SERVER_DIR.parent
WEB_DIR = APP_DIR / "web"
PC_DIR = APP_DIR / "web_pc"
ASSETS_DIR = APP_DIR / "assets"

# 契约统一使用 Asia/Shanghai；Windows 上不依赖 tzdata，直接固定 UTC+8。
TZ_CST = timezone(timedelta(hours=8), "Asia/Shanghai")

BATCH_ID = "B-20261104-01"
GREENHOUSE = "1号棚"
BATCH_START = datetime(2026, 11, 4, 9, 20, 0, tzinfo=TZ_CST)
# 仿真检查点对应的批次时刻：与契约 /api/video/info 示例时间 09:24:31 对齐。
CHECKPOINT_AT = datetime(2026, 11, 4, 9, 24, 31, tzinfo=TZ_CST)

STOP_TOTAL = 20                 # 每圈 20 个停靠位
PLANTS_TOTAL = 64               # 本棚 64 株
ROUTE_METERS = 35.8             # 一圈总里程
PATROL_SPEED = 0.5              # 巡检速度 m/s
DWELL_SECONDS = 2.4             # 每个停靠位停留
CHECKPOINT_STOP = 7             # 默认演示检查点：已到第 7 个停靠位
CHECKPOINT_PLANTS = 42          # 已检 42/64 = 66%
CHECKPOINT_DETECTED = 6         # 已入库 6 条检测记录

# 设备上行：单帧 / JSON 上限
MAX_FRAME_BYTES = 3 * 1024 * 1024
MAX_POST_BYTES = 4 * 1024 * 1024
CHECKPOINT_DISTANCE = 18.6      # 已走里程
REMOTE_TIMEOUT = 0.5            # 远程模式控制超时（秒）
STATE_PUSH_INTERVAL = 0.5       # state 推送周期
SIM_TICK = 0.05                 # 仿真物理步长（20 Hz；远程模式按 10 Hz 效果积分）
MAX_FRAME_BYTES = 1 << 20       # WebSocket 单帧上限 1 MiB
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

MODE_TEXT = {
    "patrol": "巡检中",
    "remote": "远程模式",
    "estop": "已急停",
    "idle": "待命",
}

PLACEHOLDER_HTML = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>株迹可循 - 本地演示服务</title>
<style>
body{margin:0;padding:40px 20px;background:#F4F5F7;color:#181818;
 font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
.card{max-width:720px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;
 box-shadow:0 2px 10px rgba(16,24,40,.06)}
h1{font-size:22px;margin:0 0 8px}.hero{color:#0E3B2E;font-weight:700}
p{color:#6B7280;font-size:14px;line-height:1.7}
code{background:#F4F5F7;border-radius:6px;padding:2px 6px;font-size:13px}
li{font-size:14px;line-height:2;color:#181818}
</style></head><body><div class="card">
<h1><span class="hero">株迹可循</span> · 本地演示服务</h1>
<p>服务已启动，但 <code>web/index.html</code> 尚未就绪（H5 原型由 app-web 并行产出）。
静态托管路径已按契约配置：<code>/</code> -&gt; <code>../web/index.html</code>，
<code>/assets/*</code> -&gt; <code>../assets/</code>。</p>
<p>可用接口：</p>
<ul>
<li><code>GET /api/state</code> — 设备实时状态（含 recent / review）</li>
<li><code>GET /api/report?batch=B-20261104-01</code> — 批次报表</li>
<li><code>GET /api/video/info</code> — 图传状态与检测框</li>
<li><code>GET /api/export/csv</code> — 导出 CSV（UTF-8 BOM）</li>
<li><code>GET /api/health</code> — 探活信息</li>
<li><code>WS /ws</code> — 实时推送 state / ack / event / pong / report_ready</li>
</ul>
<p>车端俯视素材：<a href="/assets/cam_plant.jpg">/assets/cam_plant.jpg</a></p>
</div></body></html>
"""


# ---------------------------------------------------------------------------
# 小工具
# ---------------------------------------------------------------------------
def _clamp(value: float, low: float, high: float) -> float:
    return low if value < low else high if value > high else value


def _json_dumps(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def _iso(dt: datetime) -> str:
    return dt.isoformat()


# ---------------------------------------------------------------------------
# 停靠位表：4 床（行）× 5 停靠位（4 台位 + 1 掉头位）= 20 站
# 台位命名 A1/B2/A2/B1，使第 7 站 = 行2 / 台位 B2 / 株位码 B2-03，
# 与契约示例 robot.bed="B2"、robot.plot="B2-03" 对齐。
# ---------------------------------------------------------------------------
STOP_TAI_SEQ = ["A1", "B2", "A2", "B1"]
STOP_ROW_CN = ["1行", "2行", "3行", "4行"]


def _build_stops() -> list[dict]:
    stops: list[dict] = []
    for s in range(1, STOP_TOTAL + 1):
        row = (s - 1) // 5
        pos = (s - 1) % 5
        window = pos == 4  # 每床第 5 个停靠位为掉头位
        if window:
            tai = "回路"
            plot = f"{STOP_ROW_CN[row]}-掉头位"
        else:
            tai = STOP_TAI_SEQ[pos]
            plot_no = ((s - 1) % 4) + 1
            plot = f"{tai}-{plot_no:02d}"
        stops.append({
            "index": s,
            "row": row + 1,
            "row_cn": STOP_ROW_CN[row],
            "tai": tai,
            "plot": plot,
            "window": window,
        })
    return stops


STOPS = _build_stops()


# ---------------------------------------------------------------------------
# 检测记录数据集（9 条 = 2 新发 + 3 持续 + 1 加重 + 1 好转 + 1 已处理 + 1 疑似误报）
# 前 6 条为演示检查点前已入库；后 3 条在巡检推进中依次出现（检测站 9 / 14 / 18）。
# 3 条低置信记录待复核，与 /api/report 的 review 一致。
# ---------------------------------------------------------------------------
def _rec(code: str, disease: str, confidence: float, state: str,
         advice: str, hhmm: str, review: bool = False) -> dict:
    return {
        "code": code,
        "disease": disease,
        "confidence": confidence,
        "state": state,
        "advice": advice,
        "time": hhmm,
        "review": review,
    }


DETECTION_RECORDS: list[dict] = [
    _rec("1棚-1行-A1台-1位-1株", "叶斑病", 0.88, "新发", "分区标记 + 加密复查", "09:21"),
    _rec("1棚-1行-B2台-2位-1株", "叶斑病", 0.69, "持续", "低置信，待现场复核", "09:21", True),
    _rec("1棚-1行-A2台-1位-2株", "白粉病", 0.64, "持续", "低置信，待现场复核", "09:22", True),
    _rec("1棚-2行-A1台-1位-1株", "叶斑病", 0.63, "疑似误报", "低置信，待现场复核", "09:23", True),
    _rec("1棚-2行-B2台-2位-1株", "叶斑病", 0.79, "加重", "加喷一次，24h 后复查", "09:23"),
    _rec("1棚-3行-B2台-2位-1株", "叶斑病", 0.91, "新发", "分区标记 + 加密复查", "09:24"),
    _rec("1棚-2行-B1台-2位-1株", "叶斑病", 0.77, "持续", "保持通风，降湿处理", "09:25"),
    _rec("1棚-3行-B1台-1位-2株", "叶斑病", 0.86, "已处理", "已处理，记录归档", "09:25"),
    _rec("1棚-4行-A2台-2位-1株", "白粉病", 0.81, "好转", "保持观察，下轮复查", "09:26"),
]

# 固定报表引用的记录（下标）
_REPORT_RECORD_KEYS = (5, 4, 7)     # 新发 0.91（契约示例）/ 加重 / 已处理
_REPORT_REVIEW_KEYS = (3, 2, 1)     # 0.63（契约示例）/ 0.64 / 0.69


# ---------------------------------------------------------------------------
# 仿真状态机
# ---------------------------------------------------------------------------
class Simulation:
    """巡检仿真 + 远程控制状态。所有读写都在 ``self._lock`` 下进行。"""

    def __init__(self, fresh: bool = False) -> None:
        self._lock = threading.RLock()
        self.fresh = fresh
        self.wall_t = 0.0                       # 服务启动以来的秒数
        self.started_at = time.monotonic()
        self.events: list[tuple[str, str]] = []
        self.report_ready = False

        # 批次时钟：检查点从 09:24:31 起走；--fresh 从 09:20:00 起走。
        self.batch_now = (BATCH_START if fresh else CHECKPOINT_AT).replace()
        self.batch = {
            "id": BATCH_ID,
            "greenhouse": GREENHOUSE,
            "start": _iso(BATCH_START),
            "end": None,
            "status": "running",
        }

        # ---- 巡检进度 ----
        self.mode = "patrol"
        self.stop_index = 0 if fresh else CHECKPOINT_STOP
        self.plants_done = 0 if fresh else CHECKPOINT_PLANTS
        self.discovered = 0 if fresh else CHECKPOINT_DETECTED
        self.distance = 0.0 if fresh else CHECKPOINT_DISTANCE
        self.x = 0.55 if fresh else 3.24
        self.y = 0.60 if fresh else 1.85
        self.heading = 90.0
        self.phase = "travel"                   # travel / dwell / done
        self.seg_len = (ROUTE_METERS / STOP_TOTAL) if fresh else \
            (ROUTE_METERS - CHECKPOINT_DISTANCE) / (STOP_TOTAL - CHECKPOINT_STOP)
        self.seg_done = 0.0
        self.next_stop = 1 if fresh else CHECKPOINT_STOP + 1
        self.dwell_left = DWELL_SECONDS
        # 株数计划：检查点之后 13 站共补 22 株；--fresh 时每台位 4 株、掉头位 0 株。
        if fresh:
            self._plants_plan = {s["index"]: (0 if s["window"] else 4) for s in STOPS}
            self._detect_plan = {4: 2, 7: 2, 9: 1, 12: 1, 14: 1, 16: 1, 18: 1}
        else:
            self._plants_plan = {
                8: 3, 9: 2, 10: 0, 11: 2, 12: 2, 13: 2, 14: 2,
                15: 0, 16: 3, 17: 2, 18: 2, 19: 2, 20: 0,
            }
            self._detect_plan = {9: 1, 14: 1, 18: 1}

        # ---- 环境量 ----
        self.battery = 78.0
        self.temp = 32.0
        self.voltage = 11.6
        self.current = 0.82
        self.rssi = -52
        self.latency = 28
        self.v = 0.0                            # 远程线速度 m/s
        self.w = 0.0                            # 远程角速度 rad/s
        self.last_ctl = time.monotonic()
        self.auto_stop_notified = False
        self.video_enabled = False
        self.last_external = 0.0                 # 最近一次真实遥测时间（monotonic）

        # 复核状态：待复核 / 已确认 / 已改判
        self.review_status = {
            r["code"]: "待复核" for r in DETECTION_RECORDS if r["review"]
        }

        self.events.append((
            "info",
            "仿真巡检已启动：" + ("从第 1/20 停靠位开始" if fresh
                               else "演示检查点 第 7/20 停靠位"),
        ))

    # ------------------------------------------------------------------
    # 对外快照 / 静态数据
    # ------------------------------------------------------------------
    def snapshot(self) -> dict:
        with self._lock:
            idx = max(1, min(self.stop_index, STOP_TOTAL))
            stop = STOPS[idx - 1]
            # 掉头位没有台位信息，UI 上显示最近一个台位，避免出现 "回路 / 掉头位"
            display_stop = stop
            if stop["window"] and idx > 1:
                display_stop = STOPS[idx - 2]
            detected = min(self.discovered, len(DETECTION_RECORDS))
            recent = [
                {
                    "code": r["code"],
                    "disease": r["disease"],
                    "confidence": r["confidence"],
                    "state": r["state"],
                    "time": r["time"],
                    "suggest": r["advice"],
                }
                for r in list(reversed(DETECTION_RECORDS[:detected]))[:3]
            ]
            review = [
                {
                    "code": r["code"],
                    "disease": r["disease"],
                    "confidence": r["confidence"],
                    "state": "待复核",
                }
                for r in reversed(DETECTION_RECORDS[:detected])
                if r["review"] and self.review_status.get(r["code"]) == "待复核"
            ]
            if self.mode == "patrol":
                speed = PATROL_SPEED
            elif self.mode == "remote":
                speed = abs(self.v)
            else:
                speed = 0.0
            return {
                "ts": 1793 + int(self.wall_t),
                "device": {
                    "name": "株迹可循-01",
                    "fw": APP_VERSION,
                    "link": "wifi",
                    "rssi": self.rssi,
                    "latency_ms": self.latency,
                    "telemetry": "device" if (time.monotonic() - self.last_external) < 3.0 else "sim",
                },
                "robot": {
                    "mode": self.mode,
                    "mode_text": MODE_TEXT.get(self.mode, self.mode),
                    "battery": int(round(self.battery)),
                    "voltage": round(self.voltage, 2),
                    "current": round(self.current, 2),
                    "temp": int(round(self.temp)),
                    "speed": round(speed, 2),
                    "x": round(self.x, 2),
                    "y": round(self.y, 2),
                    "heading": int(round(self.heading)) % 360,
                    "stop_index": self.stop_index,
                    "stop_total": STOP_TOTAL,
                    "bed": display_stop["tai"],
                    "plot": display_stop["plot"],
                    "progress": round(self.plants_done / PLANTS_TOTAL, 2),
                    "plants_done": self.plants_done,
                    "plants_total": PLANTS_TOTAL,
                    "distance_m": round(self.distance, 1),
                    "detected": detected,
                },
                "batch": dict(self.batch),
                "recent": recent,
                "review": review,
            }

    def report(self) -> dict:
        """归档批次报表：严格使用契约数值（64 / 9 / 3 / 95.3 / 84.4 / 6-9 / 六状态 2,3,1,1,1,1）。"""
        records = []
        for key in _REPORT_RECORD_KEYS:
            r = DETECTION_RECORDS[key]
            records.append({
                "code": r["code"],
                "disease": r["disease"],
                "state": r["state"],
                "confidence": r["confidence"],
                "advice": r["advice"],
            })
        review = [
            {
                "code": DETECTION_RECORDS[key]["code"],
                "disease": DETECTION_RECORDS[key]["disease"],
                "confidence": DETECTION_RECORDS[key]["confidence"],
            }
            for key in _REPORT_REVIEW_KEYS
        ]
        return {
            "batch": {
                "id": BATCH_ID,
                "greenhouse": GREENHOUSE,
                "time": "2026-11-04 09:20—09:26",
                "status": "done",
            },
            "kpis": [
                {"key": "plants", "label": "巡检", "value": "64", "unit": "株"},
                {"key": "detected", "label": "检出", "value": "9", "unit": "株"},
                {"key": "review", "label": "待复核", "value": "3", "unit": "株"},
                {"key": "recall", "label": "找回率", "value": "95.3", "unit": "%"},
            ],
            "sub": {"conclusion_rate": "84.4%", "suggest_adopted": "6/9"},
            "states": [
                {"key": "new", "label": "新发", "count": 2, "color": "#E5484D"},
                {"key": "ongoing", "label": "持续", "count": 3, "color": "#2F6BFF"},
                {"key": "worse", "label": "加重", "count": 1, "color": "#F5A524"},
                {"key": "better", "label": "好转", "count": 1, "color": "#07C160"},
                {"key": "handled", "label": "已处理", "count": 1, "color": "#8A8F99"},
                {"key": "false", "label": "疑似误报", "count": 1, "color": "#B58B00"},
            ],
            "records": records,
            "review": review,
            "footer": f"判定规则/阈值/模型版本随批次归档 · 批次 {BATCH_ID}",
        }

    def records(self) -> list[dict]:
        """PC 端记录表：返回已入库的检测记录（含复核状态），用于台账/地图标记。"""
        with self._lock:
            detected = min(self.discovered, len(DETECTION_RECORDS))
            out = []
            for r in DETECTION_RECORDS[:detected]:
                if r["review"]:
                    review_state = self.review_status.get(r["code"], "待复核")
                else:
                    review_state = "免复核"
                out.append({
                    "code": r["code"],
                    "disease": r["disease"],
                    "confidence": r["confidence"],
                    "state": r["state"],
                    "advice": r["advice"],
                    "time": r["time"],
                    "review_state": review_state,
                })
            return out

    def video_info(self) -> dict:
        with self._lock:
            return {
                "enabled": self.video_enabled,
                "camera": "K230 · 顶视",
                "width": 1280,
                "height": 720,
                "bitrate": "1.2 Mbps",
                "fps": 15,
                "ptz": {"pan": 0, "pitch": 78},
                "ts": self.batch_now.strftime("%Y-%m-%d %H:%M:%S"),
                "boxes": [
                    {
                        "x": 0.22, "y": 0.30, "w": 0.26, "h": 0.34,
                        "label": "叶斑病", "confidence": 0.87, "status": "high",
                    },
                    {
                        "x": 0.58, "y": 0.52, "w": 0.18, "h": 0.22,
                        "label": "叶斑病", "confidence": 0.63, "status": "review",
                    },
                ],
            }

    def csv_bytes(self) -> bytes:
        """导出 CSV：UTF-8 + BOM，列：株位码、病害、置信度、六状态、建议、时间、复核状态。"""
        with self._lock:
            status = dict(self.review_status)
        buf = io.StringIO(newline="")
        writer = csv.writer(buf)
        writer.writerow(["株位码", "病害", "置信度", "六状态", "建议", "时间", "复核状态"])
        for rec in DETECTION_RECORDS:
            if not rec["review"]:
                review_state = "免复核"
            else:
                review_state = status.get(rec["code"], "待复核")
            writer.writerow([
                rec["code"],
                rec["disease"],
                f"{rec['confidence']:.2f}",
                rec["state"],
                rec["advice"],
                f"2026-11-04 {rec['time']}",
                review_state,
            ])
        return ("\ufeff" + buf.getvalue()).encode("utf-8")

    # ------------------------------------------------------------------
    # WebSocket 指令处理
    # ------------------------------------------------------------------
    def on_control(self, seq, cmd, v, w) -> dict:
        with self._lock:
            if self.mode == "estop":
                return {"seq": seq, "ok": False, "error": "estop"}
            if self.mode != "remote":
                return {"seq": seq, "ok": False, "error": "mode"}
            if cmd == "move":
                try:
                    vv = float(0.0 if v is None else v)
                    ww = float(0.0 if w is None else w)
                except (TypeError, ValueError):
                    return {"seq": seq, "ok": False, "error": "arg"}
                # 允许反向（控制页"后退"按钮），速度幅值限制 0.8 m/s；w 限 ±1.2 rad/s。
                self.v = _clamp(vv, -0.8, 0.8)
                self.w = _clamp(ww, -1.2, 1.2)
                self.last_ctl = time.monotonic()
                self.auto_stop_notified = False
                return {"seq": seq, "ok": True}
            if cmd == "stop":
                self.v = 0.0
                self.w = 0.0
                self.last_ctl = time.monotonic()
                return {"seq": seq, "ok": True}
            return {"seq": seq, "ok": False, "error": "cmd"}

    def on_mode(self, seq, mode) -> dict:
        with self._lock:
            if self.mode == "estop":
                return {"seq": seq, "ok": False, "error": "estop"}
            if mode not in ("patrol", "remote"):
                return {"seq": seq, "ok": False, "error": "arg"}
            if mode == "remote":
                if self.mode != "remote":
                    self.mode = "remote"
                    self.v = 0.0
                    self.w = 0.0
                    self.last_ctl = time.monotonic()
                    self.auto_stop_notified = False
                    self.events.append(("warn", "已切换远程模式：2.4G 遥控器仍最高优先"))
            else:
                if self.mode != "patrol":
                    self.mode = "patrol"
                    self.v = 0.0
                    self.w = 0.0
                    self.events.append(("info", "已恢复巡检模式"))
            return {"seq": seq, "ok": True}

    def on_estop(self, seq) -> dict:
        with self._lock:
            if self.mode != "estop":
                self.mode = "estop"
                self.v = 0.0
                self.w = 0.0
                self.events.append(("error", "急停触发：速度与任务已锁定"))
            return {"seq": seq, "ok": True}

    def on_estop_reset(self, seq) -> dict:
        with self._lock:
            if self.mode != "estop":
                return {"seq": seq, "ok": False, "error": "mode"}
            self.mode = "idle"
            self.v = 0.0
            self.w = 0.0
            self.events.append(("info", "急停已复位，等待指令"))
            return {"seq": seq, "ok": True}

    def on_video(self, seq, enabled) -> dict:
        with self._lock:
            self.video_enabled = bool(enabled)
            self.events.append(("info", "图传监看已开启" if self.video_enabled else "图传监看已关闭"))
            return {"seq": seq, "ok": True}

    # ------------------------------------------------------------------
    # 真实设备上行（K230 / ESP32-C3 / STM32 网关轮询到 /api/device/telemetry）
    # ------------------------------------------------------------------
    def apply_telemetry(self, data: dict) -> dict:
        """用真车遥测替换仿真状态；3 s 内暂停仿真推进，超时自动回退。"""
        if not isinstance(data, dict):
            return {"ok": False, "error": "not_object"}
        with self._lock:
            applied = []
            def take_float(key, attr, lo=None, hi=None):
                if key in data and data[key] is not None:
                    try:
                        value = float(data[key])
                    except (TypeError, ValueError):
                        return
                    if lo is not None:
                        value = max(lo, value)
                    if hi is not None:
                        value = min(hi, value)
                    setattr(self, attr, value)
                    applied.append(key)

            def take_int(key, attr, lo=None, hi=None):
                if key in data and data[key] is not None:
                    try:
                        value = int(float(data[key]))
                    except (TypeError, ValueError):
                        return
                    if lo is not None:
                        value = max(lo, value)
                    if hi is not None:
                        value = min(hi, value)
                    setattr(self, attr, value)
                    applied.append(key)

            take_float("battery", "battery", 0, 100)
            take_float("voltage", "voltage", 8, 13)
            take_float("current", "current", 0, 10)
            take_float("temp", "temp", -10, 90)
            take_float("x", "x", 0, 8)
            take_float("y", "y", 0, 8)
            take_float("heading", "heading", 0, 360)
            take_int("stop_index", "stop_index", 1, STOP_TOTAL)
            take_int("plants_done", "plants_done", 0, PLANTS_TOTAL)
            take_int("detected", "discovered", 0, len(DETECTION_RECORDS))
            if data.get("rssi") is not None:
                try:
                    self.rssi = int(float(data["rssi"]))
                    applied.append("rssi")
                except (TypeError, ValueError):
                    pass
            if data.get("latency_ms") is not None:
                try:
                    self.latency = int(float(data["latency_ms"]))
                    applied.append("latency_ms")
                except (TypeError, ValueError):
                    pass
            mode = data.get("mode")
            if mode in ("patrol", "remote", "idle", "estop") and mode != self.mode:
                self.mode = mode
                self.v = 0.0
                self.w = 0.0
                applied.append("mode")
            self.last_external = time.monotonic()
            return {"ok": True, "external": True, "applied": applied,
                    "mode": self.mode}

    def on_review(self, seq, code, action) -> dict:
        with self._lock:
            if action not in ("confirm", "rejudge"):
                return {"seq": seq, "ok": False, "error": "arg"}
            rec = next((r for r in DETECTION_RECORDS if r["code"] == code), None)
            if rec is None:
                return {"seq": seq, "ok": False, "error": "not_found"}
            if not rec["review"]:
                return {"seq": seq, "ok": False, "error": "not_review"}
            if self.review_status.get(code) != "待复核":
                return {"seq": seq, "ok": False, "error": "handled"}
            self.review_status[code] = "已确认" if action == "confirm" else "已改判"
            self.events.append(("info", f"复核完成：{code} -> {self.review_status[code]}"))
            return {"seq": seq, "ok": True}

    # ------------------------------------------------------------------
    # 事件 / 就绪标记
    # ------------------------------------------------------------------
    def drain_events(self) -> list[tuple[str, str]]:
        with self._lock:
            ev, self.events = self.events, []
            return ev

    def consume_report_ready(self) -> bool:
        with self._lock:
            if not self.report_ready:
                return False
            self.report_ready = False
            return True

    # ------------------------------------------------------------------
    # 仿真推进
    # ------------------------------------------------------------------
    def tick(self, dt: float) -> None:
        if dt <= 0:
            return
        with self._lock:
            self.wall_t += dt
            self.batch_now += timedelta(seconds=dt)
            # 真实遥测活跃时暂停仿真推进（3 s 没收到新遥测则自动恢复）
            if (time.monotonic() - self.last_external) < 3.0:
                return
            self._tick_env(dt)
            if self.mode == "patrol":
                self._tick_patrol(dt)
            elif self.mode == "remote":
                self._tick_remote(dt)

    def _tick_env(self, dt: float) -> None:
        # 电量：巡检/远程缓慢下降，待命更慢
        rate = 0.008 if self.mode in ("patrol", "remote") else 0.002
        self.battery = max(20.0, self.battery - rate * dt)
        # 温度 30—34 波动；起点 32
        self.temp = 32.0 + 1.1 * math.sin(self.wall_t * 0.04)
        # 3S 包电压：78% 时 11.6 V，随电量线性下降（斜率 0.007 V/%）
        self.voltage = 11.6 - 0.007 * (78.0 - self.battery)
        if self.mode == "patrol":
            self.current = 0.82 + 0.05 * math.sin(self.wall_t * 0.7)
        elif self.mode == "remote":
            self.current = 0.30 + 0.50 * abs(self.v)
        else:
            self.current = 0.04
        # WiFi 信号 / 链路时延合理波动
        self.rssi = -52 + int(round(3 * math.sin(self.wall_t * 0.1)))
        self.latency = 28 + int(round(4 * math.sin(self.wall_t * 0.3)))

    # ---- 巡检模式 ----
    def _tick_patrol(self, dt: float) -> None:
        if self.phase == "done":
            return
        if self.phase == "travel":
            step = PATROL_SPEED * dt
            remain = self.seg_len - self.seg_done
            if step < remain:
                self.seg_done += step
                self.distance += step
                self._move_pose(step)
                return
            self.distance += max(remain, 0.0)
            self._move_pose(max(remain, 0.0))
            self.seg_done = self.seg_len
            self._arrive(self.next_stop)
            return
        # dwell：停靠位停留 2.4 s，停留结束时计数 / 检出
        self.dwell_left -= dt
        if self.dwell_left <= 0:
            self._finish_stop(self.stop_index)

    def _move_pose(self, step: float) -> None:
        rad = math.radians(self.heading)
        self.x += step * math.cos(rad)
        self.y += step * math.sin(rad)
        self._clamp_pose()

    def _clamp_pose(self) -> None:
        # 温室范围约 7.3 m x 8.4 m；越界反射，保证位置始终合理
        bounced = False
        if self.x < 0.2:
            self.x, bounced = 0.2, True
        elif self.x > 7.2:
            self.x, bounced = 7.2, True
        if self.y < 0.2:
            self.y, bounced = 0.2, True
        elif self.y > 8.2:
            self.y, bounced = 8.2, True
        if bounced:
            self.heading = (self.heading + 180.0) % 360.0

    def _arrive(self, idx: int) -> None:
        stop = STOPS[idx - 1]
        self.stop_index = idx
        self.phase = "dwell"
        self.dwell_left = DWELL_SECONDS
        if stop["window"]:
            self.events.append(("info", f"到达掉头位 {stop['plot']}"))
        else:
            self.events.append(("info", f"到达台位 {stop['plot']}"))

    def _finish_stop(self, idx: int) -> None:
        # 1) 株数推进
        inc = self._plants_plan.get(idx, 0)
        if inc:
            self.plants_done = min(PLANTS_TOTAL, self.plants_done + inc)
        # 2) 本条停靠位触发的检测记录
        for _ in range(self._detect_plan.get(idx, 0)):
            if self.discovered >= len(DETECTION_RECORDS):
                break
            rec = DETECTION_RECORDS[self.discovered]
            self.discovered += 1
            self.events.append((
                "info",
                f"检出{rec['disease']} {rec['confidence']:.2f}（{rec['code']}）",
            ))
            if rec["review"]:
                self.events.append((
                    "warn",
                    f"置信度偏低，转人工复核：{rec['code']} {rec['confidence']:.2f}",
                ))
        # 3) 完成 / 进入下一段
        if idx >= STOP_TOTAL:
            self._complete()
            return
        nxt = idx + 1
        self.next_stop = nxt
        self.phase = "travel"
        self.seg_len = max((ROUTE_METERS - self.distance) / max(STOP_TOTAL - self.stop_index, 1), 0.1)
        self.seg_done = 0.0
        self.heading = float([90, 0, 270, 180][(nxt - 1) % 4])

    def _complete(self) -> None:
        self.phase = "done"
        self.mode = "idle"
        self.plants_done = PLANTS_TOTAL
        self.v = 0.0
        self.w = 0.0
        self.batch["status"] = "done"
        self.batch["end"] = _iso(self.batch_now)
        self.report_ready = True
        self.events.append((
            "info",
            f"本棚巡检完成：{PLANTS_TOTAL}/{PLANTS_TOTAL} 株，检出 9 株；"
            f"批次 {BATCH_ID} 报表已生成",
        ))

    # ---- 远程模式 ----
    def _tick_remote(self, dt: float) -> None:
        now = time.monotonic()
        if (self.v or self.w) and (now - self.last_ctl) > REMOTE_TIMEOUT:
            self.v = 0.0
            self.w = 0.0
            if not self.auto_stop_notified:
                self.auto_stop_notified = True
                self.events.append(("warn", "远程控制 500 ms 无新指令，已自动停车"))
        rad = math.radians(self.heading)
        self.x += self.v * math.cos(rad) * dt
        self.y += self.v * math.sin(rad) * dt
        self.heading = (self.heading + math.degrees(self.w) * dt) % 360.0
        self._clamp_pose()


# ---------------------------------------------------------------------------
# WebSocket：帧编解码 + 连接 + 连接池
# ---------------------------------------------------------------------------
OP_CONT, OP_TEXT, OP_BINARY, OP_CLOSE, OP_PING, OP_PONG = 0x0, 0x1, 0x2, 0x8, 0x9, 0xA


class WSClosed(Exception):
    """连接已关闭。"""


class WSConnection:
    """一条已升级的 WebSocket 连接。读走 ``rfile``（已缓冲），写直接 ``sendall``。"""

    def __init__(self, sock: socket.socket, rfile) -> None:
        self.sock = sock
        self.rfile = rfile
        self.send_lock = threading.Lock()
        self.closed = False

    # ---- 发送 ----
    def send_frame(self, opcode: int, payload: bytes = b"") -> None:
        if self.closed:
            raise WSClosed("connection closed")
        header = bytes([0x80 | opcode])
        n = len(payload)
        if n < 126:
            header += bytes([n])
        elif n < 65536:
            header += bytes([126]) + struct.pack("!H", n)
        else:
            header += bytes([127]) + struct.pack("!Q", n)
        with self.send_lock:
            self.sock.sendall(header + payload)

    def send_text(self, text: str) -> None:
        self.send_frame(OP_TEXT, text.encode("utf-8"))

    def send_json(self, obj) -> None:
        self.send_text(_json_dumps(obj))

    def send_close(self, code: int = 1000) -> None:
        try:
            self.send_frame(OP_CLOSE, struct.pack("!H", code))
        except (OSError, WSClosed):
            pass
        self.closed = True

    # ---- 接收 ----
    def _read_exact(self, n: int) -> bytes:
        buf = b""
        while len(buf) < n:
            try:
                chunk = self.rfile.read(n - len(buf))
            except OSError as exc:
                # 注意：socket 一旦设置超时并触发，缓冲读句柄会永久报
                # "cannot read from timed out object"，因此握手后统一用阻塞读。
                raise WSClosed("socket read error") from exc
            if not chunk:
                raise WSClosed("eof")
            buf += chunk
        return buf

    def recv_message(self):
        """读取一条完整消息，返回 (opcode, payload)；控制帧原样返回。"""
        while True:
            head = self._read_exact(2)
            b1, b2 = head[0], head[1]
            fin = bool(b1 & 0x80)
            opcode = b1 & 0x0F
            masked = bool(b2 & 0x80)
            length = b2 & 0x7F
            if length == 126:
                length = struct.unpack("!H", self._read_exact(2))[0]
            elif length == 127:
                length = struct.unpack("!Q", self._read_exact(8))[0]
            if length > MAX_FRAME_BYTES:
                raise WSClosed("frame too large")
            mask = self._read_exact(4) if masked else None
            data = self._read_exact(length) if length else b""
            if mask:
                data = bytes(byte ^ mask[i % 4] for i, byte in enumerate(data))
            # 控制帧可穿插在分片中间，直接返回
            if opcode in (OP_CLOSE, OP_PING, OP_PONG):
                return opcode, data
            if opcode == OP_CONT or fin:
                return opcode, data
            # 文本/二进制分片：继续读续帧
            buf = bytearray(data)
            while True:
                h2 = self._read_exact(2)
                b1, b2 = h2[0], h2[1]
                op2 = b1 & 0x0F
                fin2 = bool(b1 & 0x80)
                masked2 = bool(b2 & 0x80)
                ln = b2 & 0x7F
                if ln == 126:
                    ln = struct.unpack("!H", self._read_exact(2))[0]
                elif ln == 127:
                    ln = struct.unpack("!Q", self._read_exact(8))[0]
                if ln > MAX_FRAME_BYTES:
                    raise WSClosed("frame too large")
                m2 = self._read_exact(4) if masked2 else None
                d2 = self._read_exact(ln) if ln else b""
                if m2:
                    d2 = bytes(byte ^ m2[i % 4] for i, byte in enumerate(d2))
                buf.extend(d2)
                if fin2:
                    return opcode, bytes(buf)
                if op2 not in (OP_CONT, OP_TEXT, OP_BINARY):
                    raise WSClosed("bad continuation")

    def mark_closed(self) -> None:
        self.closed = True


class WSRegistry:
    """WebSocket 连接池；广播失败自动剔除。"""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._conns: set[WSConnection] = set()

    def add(self, conn: WSConnection) -> None:
        with self._lock:
            self._conns.add(conn)

    def remove(self, conn: WSConnection) -> None:
        with self._lock:
            self._conns.discard(conn)

    def count(self) -> int:
        with self._lock:
            return len(self._conns)

    def broadcast_json(self, obj) -> None:
        text = _json_dumps(obj)
        with self._lock:
            conns = list(self._conns)
        dead = []
        for conn in conns:
            try:
                conn.send_text(text)
            except (OSError, WSClosed):
                dead.append(conn)
        if dead:
            with self._lock:
                for conn in dead:
                    self._conns.discard(conn)
            for conn in dead:
                conn.mark_closed()

    def close_all(self) -> None:
        with self._lock:
            conns = list(self._conns)
            self._conns.clear()
        for conn in conns:
            try:
                conn.send_close()
            except Exception:  # noqa: BLE001 - 关闭阶段不再抛错
                pass


def state_message(sim: Simulation) -> dict:
    """state 推送消息：顶层字段与 /api/state 一致，同时附 ``data`` 便于客户端两种取法。"""
    state = sim.snapshot()
    payload = {"type": "state"}
    payload.update(state)
    payload["data"] = state
    return payload


# ---------------------------------------------------------------------------
# HTTP 服务
# ---------------------------------------------------------------------------
class DemoServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, addr, handler, sim: Simulation, registry: WSRegistry,
                 camera: CameraHub) -> None:
        super().__init__(addr, handler)
        self.sim = sim
        self.registry = registry
        self.camera = camera
        self.stopping = threading.Event()

    def push_state(self) -> None:
        self.registry.broadcast_json(state_message(self.sim))


_MIME_OVERRIDES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/plain; charset=utf-8",
}


def _guess_mime(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in _MIME_OVERRIDES:
        return _MIME_OVERRIDES[suffix]
    guessed = mimetypes.guess_type(str(path))[0]
    return guessed or "application/octet-stream"


def _safe_file(base: Path, rel: str) -> Path | None:
    """把 URL 相对路径解析成 base 内的真实文件，越界返回 None。"""
    if not rel or "\x00" in rel:
        return None
    try:
        base_resolved = base.resolve()
        candidate = (base / rel).resolve()
    except OSError:
        return None
    try:
        candidate.relative_to(base_resolved)
    except ValueError:
        return None
    if not candidate.is_file():
        return None
    return candidate


class RequestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "ZhuJiKeXun/" + APP_VERSION
    sys_version = ""

    # -------- 基础工具 --------
    def log_message(self, fmt: str, *args) -> None:  # 请求日志降噪，联调可调 --log-level DEBUG
        LOG.debug("%s - %s", self.address_string(), fmt % args)

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS, POST")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type, X-Device-Token, X-Device-Id, X-Frame-Ts, X-Ptz-Pan, "
            "X-Ptz-Pitch, X-Width, X-Height, X-Seq",
        )
        self.send_header("Access-Control-Expose-Headers", "Content-Disposition, X-Source, X-Frame-Seq, X-Frame-Ts")

    def _send_bytes(self, body: bytes, content_type: str, status: int = 200,
                    extra_headers: list[tuple[str, str]] | None = None,
                    cache_control: str = "no-cache") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache_control)
        self._cors()
        for key, value in (extra_headers or []):
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_json(self, obj, status: int = 200) -> None:
        self._send_bytes(_json_dumps(obj).encode("utf-8"),
                         "application/json; charset=utf-8", status,
                         cache_control="no-store")

    # -------- 方法分发 --------
    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self) -> None:  # noqa: N802
        self._handle_request()

    def do_GET(self) -> None:  # noqa: N802
        self._handle_request()

    def do_POST(self) -> None:  # noqa: N802
        self._handle_post()

    # -------- 路由 --------
    def _handle_request(self) -> None:
        parsed = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(parsed.path)
        server: DemoServer = self.server  # type: ignore[assignment]
        try:
            if path in ("/ws", "/ws/"):
                if self.headers.get("Upgrade", "").lower() == "websocket":
                    self._serve_websocket(server)
                else:
                    self._send_json({"error": "websocket_upgrade_required"}, 400)
                return
            if path == "/api/state":
                self._send_json(server.sim.snapshot())
                return
            if path == "/api/report":
                query = urllib.parse.parse_qs(parsed.query)
                batch = (query.get("batch") or [None])[0]
                if batch and batch != BATCH_ID:
                    self._send_json({"error": "batch_not_found", "batch": batch}, 404)
                    return
                self._send_json(server.sim.report())
                return
            if path == "/api/records":
                self._send_json({
                    "batch": BATCH_ID,
                    "greenhouse": GREENHOUSE,
                    "total": len(DETECTION_RECORDS),
                    "detected": min(server.sim.discovered, len(DETECTION_RECORDS)),
                    "records": server.sim.records(),
                })
                return
            if path == "/api/video/info":
                info = server.sim.video_info()
                cam = server.camera.video_info() or {}
                src = cam.get("source") or {}
                info["source"] = src
                if src.get("online"):
                    # K230 正在推流时，图传监看视为已开启（H5 顶部状态同步）
                    info["enabled"] = True
                    for key in ("camera", "width", "height", "fps", "bitrate",
                                "ts", "ptz", "boxes"):
                        if key in cam:
                            info[key] = cam[key]
                self._send_json(info)
                return
            if path == "/api/camera/status":
                payload = server.camera.status()
                payload["batch"] = BATCH_ID
                payload["clock"] = server.sim.batch_now.strftime("%Y-%m-%d %H:%M:%S")
                self._send_json(payload)
                return
            if path == "/api/camera/latest.jpg":
                data, seq, source, ts = server.camera.latest_jpeg()
                if not data:
                    self._send_json({"error": "camera_unavailable"}, 503)
                    return
                self._send_bytes(
                    data, "image/jpeg",
                    extra_headers=[("X-Source", source),
                                   ("X-Frame-Seq", str(seq)),
                                   ("X-Frame-Ts", ts or "")],
                )
                return
            if path == "/api/camera/stream.mjpg":
                self.send_response(200)
                self.send_header("Content-Type",
                                 "multipart/x-mixed-replace; boundary=frame")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Connection", "close")
                self.end_headers()
                self.close_connection = True
                try:
                    for chunk in server.camera.mjpeg_chunks(fps=10):
                        self.wfile.write(chunk)
                        self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    pass
                return
            if path == "/api/device/commands":
                query = urllib.parse.parse_qs(parsed.query)
                try:
                    since = int((query.get("since") or ["0"])[0])
                except ValueError:
                    since = 0
                if not self._check_device_token(server):
                    return
                self._send_json(server.camera.commands_since(since))
                return
            if path == "/api/export/csv":
                filename = f"株迹可循_批次_{BATCH_ID}.csv"
                fallback = f"zhujikexun_{BATCH_ID}.csv"
                disposition = (
                    f'attachment; filename="{fallback}"; '
                    f"filename*=UTF-8''{urllib.parse.quote(filename)}"
                )
                self._send_bytes(
                    server.sim.csv_bytes(),
                    "text/csv; charset=utf-8",
                    extra_headers=[("Content-Disposition", disposition)],
                )
                return
            if path == "/api/health":
                self._send_json({
                    "ok": True,
                    "service": "株迹可循本地演示服务",
                    "version": APP_VERSION,
                    "mode": server.sim.mode,
                    "websocket_clients": server.registry.count(),
                    "batch": BATCH_ID,
                    "camera": server.camera.status()["source"],
                    "uptime_s": int(time.monotonic() - server.sim.started_at),
                })
                return
            if path == "/favicon.ico":
                self._send_bytes(b"", "image/x-icon", 204)
                return
            self._serve_static(path)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True
        except Exception as exc:  # noqa: BLE001 - 兜底，避免服务线程崩掉
            LOG.exception("处理请求失败 %s: %s", self.path, exc)
            try:
                self._send_json({"error": "internal_error"}, 500)
            except OSError:
                pass

    # -------- 设备上行（K230 推帧 / 检测 / 遥测 / 命令轮询） --------
    def _check_device_token(self, server: DemoServer) -> bool:
        token = server.camera.token
        if not token:
            return True
        got = self.headers.get("X-Device-Token", "")
        if got == token:
            return True
        self._send_json({"error": "bad_device_token"}, 401)
        return False

    def _read_body(self, limit: int = MAX_POST_BYTES) -> bytes | None:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            self._send_json({"error": "empty_body"}, 400)
            return None
        if length > limit:
            self._send_json({"error": "body_too_large", "limit": limit}, 413)
            self.close_connection = True
            return None
        try:
            return self.rfile.read(length)
        except OSError:
            return None

    def _handle_post(self) -> None:
        parsed = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(parsed.path)
        server: DemoServer = self.server  # type: ignore[assignment]
        try:
            if path == "/api/device/frame":
                if not self._check_device_token(server):
                    return
                body = self._read_body(MAX_FRAME_BYTES)
                if body is None:
                    return
                query = urllib.parse.parse_qs(parsed.query)
                meta = {
                    "device_id": self.headers.get("X-Device-Id")
                    or (query.get("device_id") or [None])[0],
                    "ts": self.headers.get("X-Frame-Ts")
                    or (query.get("ts") or [None])[0],
                    "width": self.headers.get("X-Width"),
                    "height": self.headers.get("X-Height"),
                    "ptz_pan": self.headers.get("X-Ptz-Pan") or 0,
                    "ptz_pitch": self.headers.get("X-Ptz-Pitch") or 78,
                    "seq": self.headers.get("X-Seq"),
                }
                for key in ("width", "height"):
                    try:
                        meta[key] = int(meta[key]) if meta[key] else None
                    except (TypeError, ValueError):
                        meta[key] = None
                try:
                    status = server.camera.ingest_frame(body, meta)
                except ValueError as exc:
                    self._send_json({"error": "bad_frame", "reason": str(exc)}, 400)
                    return
                self._send_json({"ok": True, "seq": status["source"]["frames_total"],
                                 "server_ts": time.strftime("%Y-%m-%d %H:%M:%S"),
                                 "fps": status["source"]["fps"],
                                 "kbps": status["source"]["kbps"],
                                 "source": status["source"]})
                return
            if path == "/api/device/detection":
                if not self._check_device_token(server):
                    return
                body = self._read_body()
                if body is None:
                    return
                try:
                    payload = json.loads(body.decode("utf-8"))
                    if not isinstance(payload, dict):
                        raise ValueError("not_object")
                    result = server.camera.ingest_detection(payload)
                except (ValueError, UnicodeDecodeError) as exc:
                    self._send_json({"error": "bad_detection", "reason": str(exc)}, 400)
                    return
                server.push_state()
                self._send_json({"ok": True, **result})
                return
            if path == "/api/device/telemetry":
                if not self._check_device_token(server):
                    return
                body = self._read_body()
                if body is None:
                    return
                try:
                    payload = json.loads(body.decode("utf-8"))
                    if not isinstance(payload, dict):
                        raise ValueError("not_object")
                except (ValueError, UnicodeDecodeError) as exc:
                    self._send_json({"error": "bad_telemetry", "reason": str(exc)}, 400)
                    return
                result = server.sim.apply_telemetry(payload)
                server.push_state()
                self._send_json({"ok": True, **result})
                return
            if path == "/api/device/ack":
                if not self._check_device_token(server):
                    return
                body = self._read_body()
                if body is None:
                    return
                try:
                    payload = json.loads(body.decode("utf-8"))
                    seq = int(payload.get("seq"))
                except (ValueError, TypeError, UnicodeDecodeError, AttributeError):
                    self._send_json({"error": "bad_ack"}, 400)
                    return
                self._send_json(server.camera.ack_command(seq))
                return
            if path == "/api/camera/source":
                if not self._check_device_token(server):
                    return
                body = self._read_body(64 * 1024)
                if body is None:
                    return
                try:
                    payload = json.loads(body.decode("utf-8"))
                    mode = str(payload.get("mode", ""))
                    url = payload.get("url")
                    status = server.camera.set_source(mode, url)
                except (ValueError, UnicodeDecodeError, AttributeError) as exc:
                    self._send_json({"error": "bad_source", "reason": str(exc)}, 400)
                    return
                self._send_json({"ok": True, **status})
                return
            self._send_json({"error": "not_found", "path": path}, 404)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True
        except Exception as exc:  # noqa: BLE001 - 兜底
            LOG.exception("处理 POST 失败 %s: %s", self.path, exc)
            try:
                self._send_json({"error": "internal_error"}, 500)
            except OSError:
                pass

    # -------- 静态文件 --------
    def _serve_static(self, path: str) -> None:
        # PC 端控制台：/pc/ -> web_pc/index.html，/pc/* -> web_pc/*
        if path in ("/pc", "/pc/"):
            index = PC_DIR / "index.html"
            if index.is_file():
                self._send_static_file(index)
            else:
                self._send_bytes(PLACEHOLDER_HTML.encode("utf-8"),
                                 "text/html; charset=utf-8")
            return
        if path.startswith("/pc/"):
            rel = path[len("/pc/"):]
            target = _safe_file(PC_DIR, rel)
            if target is None:
                self._send_json({"error": "not_found", "path": path}, 404)
                return
            self._send_static_file(target)
            return
        if path in ("/", ""):
            index = WEB_DIR / "index.html"
            if index.is_file():
                self._send_static_file(index)
            else:
                self._send_bytes(PLACEHOLDER_HTML.encode("utf-8"),
                                 "text/html; charset=utf-8")
            return
        if path.startswith("/assets/"):
            rel = path[len("/assets/"):]
            target = _safe_file(ASSETS_DIR, rel)
            if target is None:
                self._send_json({"error": "not_found", "path": path}, 404)
                return
            self._send_static_file(target)
            return
        rel = path.lstrip("/")
        target = _safe_file(WEB_DIR, rel)
        if target is None:
            self._send_json({"error": "not_found", "path": path}, 404)
            return
        self._send_static_file(target)

    def _send_static_file(self, target: Path) -> None:
        try:
            body = target.read_bytes()
        except OSError:
            self._send_json({"error": "not_found", "path": str(target)}, 404)
            return
        self._send_bytes(body, _guess_mime(target))

    # -------- WebSocket --------
    def _serve_websocket(self, server: DemoServer) -> None:
        key = self.headers.get("Sec-WebSocket-Key")
        if not key:
            self._send_json({"error": "missing_sec_websocket_key"}, 400)
            return
        accept = base64.b64encode(
            hashlib.sha1((key + WS_GUID).encode("ascii")).digest()
        ).decode("ascii")
        # 101 之后连接被完全接管，不再走 HTTP 循环
        self.close_connection = True
        self.send_response_only(101, "Switching Protocols")
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()
        self.wfile.flush()

        try:
            # 握手后使用阻塞读：socket 超时后缓冲读句柄会永久失效，
            # 客户端断开时 read 返回 EOF，同样能及时清理连接。
            self.connection.settimeout(None)
        except OSError:
            pass
        conn = WSConnection(self.connection, self.rfile)
        server.registry.add(conn)
        LOG.info("WebSocket 客户端已接入（当前 %d 个）", server.registry.count())
        try:
            conn.send_json(state_message(server.sim))
            conn.send_json({"type": "event", "level": "info", "text": "本地服务已连接"})
            self._ws_loop(conn, server)
        except (OSError, WSClosed) as exc:
            LOG.debug("WebSocket 会话结束: %r", exc)
        finally:
            server.registry.remove(conn)
            conn.mark_closed()
            LOG.info("WebSocket 客户端已断开（当前 %d 个）", server.registry.count())

    def _ws_loop(self, conn: WSConnection, server: DemoServer) -> None:
        sim = server.sim
        while not server.stopping.is_set():
            try:
                msg = conn.recv_message()
            except WSClosed:
                return
            opcode, payload = msg
            if opcode == OP_CLOSE:
                conn.send_close()
                return
            if opcode == OP_PING:
                conn.send_frame(OP_PONG, payload)
                continue
            if opcode == OP_PONG:
                continue
            if opcode != OP_TEXT:
                conn.send_json({"type": "ack", "seq": None, "ok": False, "error": "opcode"})
                continue
            try:
                data = json.loads(payload.decode("utf-8"))
                if not isinstance(data, dict):
                    raise ValueError("not an object")
            except (UnicodeDecodeError, ValueError):
                conn.send_json({"type": "ack", "seq": None, "ok": False, "error": "bad_json"})
                continue
            self._dispatch(conn, server, data)

    def _dispatch(self, conn: WSConnection, server: DemoServer, msg: dict) -> None:
        sim = server.sim
        mtype = msg.get("type")
        seq = msg.get("seq")
        if mtype == "hello":
            conn.send_json({"type": "ack", "seq": seq, "ok": True})
            return
        if mtype == "ping":
            conn.send_json({"type": "pong", "t": msg.get("t")})
            return
        if mtype == "control":
            ack = sim.on_control(seq, msg.get("cmd"), msg.get("v"), msg.get("w"))
        elif mtype == "mode":
            ack = sim.on_mode(seq, msg.get("mode"))
        elif mtype == "estop":
            ack = sim.on_estop(seq)
        elif mtype == "estop_reset":
            ack = sim.on_estop_reset(seq)
        elif mtype == "video":
            ack = sim.on_video(seq, msg.get("enabled"))
        elif mtype == "review":
            ack = sim.on_review(seq, msg.get("code"), msg.get("action"))
        else:
            ack = {"seq": seq, "ok": False, "error": "unknown_type"}
        conn.send_json({"type": "ack", **ack})
        # 指令生效后立即广播一次 state，UI 无需等下一个 500 ms 周期
        server.push_state()
        # 真机接入时：把 H5 的控制/模式/急停指令放进队列，供 ESP32/K230 轮询
        if ack.get("ok") and mtype in ("control", "mode", "estop", "estop_reset"):
            try:
                server.camera.queue_command({
                    "type": mtype,
                    "client": "h5",
                    "payload": {k: v for k, v in msg.items() if k not in ("type", "seq")},
                })
            except Exception:  # noqa: BLE001 - 入队失败不影响页面
                LOG.debug("设备指令入队失败", exc_info=True)


# ---------------------------------------------------------------------------
# 后台仿真 / 广播线程
# ---------------------------------------------------------------------------
def simulation_loop(sim: Simulation, registry: WSRegistry, stopping: threading.Event) -> None:
    last = time.monotonic()
    next_broadcast = last
    while not stopping.is_set():
        now = time.monotonic()
        dt = min(max(now - last, 0.0), 0.25)
        last = now
        sim.tick(dt)
        for level, text in sim.drain_events():
            registry.broadcast_json({"type": "event", "level": level, "text": text})
        if sim.consume_report_ready():
            registry.broadcast_json({
                "type": "report_ready",
                "batch": {"id": BATCH_ID, "greenhouse": GREENHOUSE, "status": "done"},
            })
        if now >= next_broadcast:
            registry.broadcast_json(state_message(sim))
            next_broadcast = now + STATE_PUSH_INTERVAL
        time.sleep(SIM_TICK)


# ---------------------------------------------------------------------------
# --live 预留：ESP32-C3 TCP 链路 + 设计说明协议帧解析骨架
# ---------------------------------------------------------------------------
PROTO_COMMANDS = {
    0x30: ("TEL", "车端遥测上报", "车->PC"),
    0x31: ("EVENT", "车端事件上报（检测/到达/告警）", "车->PC"),
    0x40: ("PCMD", "PC 控制指令（远程/急停/任务）", "PC->车"),
    0x41: ("TASK", "任务卡下发", "PC->车"),
    0x50: ("BCMD", "车端控制指令", "车内"),
    0x51: ("BSTATE", "车端状态同步", "车->PC"),
}


class Esp32Link:
    """ESP32-C3 TCP 链路骨架（本期不接真实硬件）。

    帧格式为**假设**（待与固件对齐，代码中标 TODO）::

        +--------+--------+--------+--------+---------+--------+
        | 0xAA   | 0x55   | CMD(1) | LEN(1) | PAYLOAD | SUM8   |
        +--------+--------+--------+--------+---------+--------+

    * 帧头固定 ``AA 55``；CMD 见 :data:`PROTO_COMMANDS`；
    * LEN 为 PAYLOAD 字节数（0—255，超长帧本期不支持）；
    * SUM8 为 CMD+LEN+PAYLOAD 的 uint8 累加和，用于快速丢弃坏帧。

    本期只做：TCP connect + 拆帧 + 打日志 + TODO 映射；解析失败/连不上均
    自动降级为仿真（``Simulation`` 仍在跑）。
    """

    def __init__(self, host: str, port: int, stopping: threading.Event) -> None:
        self.host = host
        self.port = port
        self.stopping = stopping

    # ---- 启动 ----
    def start(self) -> threading.Thread:
        thread = threading.Thread(target=self._run, name="esp32-live", daemon=True)
        thread.start()
        return thread

    def _run(self) -> None:
        LOG.info("[live] 尝试连接 ESP32-C3 %s:%d ...", self.host, self.port)
        try:
            sock = socket.create_connection((self.host, self.port), timeout=1.5)
        except OSError as exc:
            LOG.warning("[live] 连接失败（%s）", exc)
            LOG.warning("[live] 本期为预留骨架，未实现真实协议解析；已降级为仿真模式")
            return
        with sock:
            sock.settimeout(0.5)
            LOG.info("[live] TCP 已连接；协议解析骨架就绪（TODO：状态/控制映射）")
            buf = bytearray()
            while not self.stopping.is_set():
                try:
                    chunk = sock.recv(4096)
                except (socket.timeout, TimeoutError):
                    continue
                except OSError:
                    break
                if not chunk:
                    break
                buf.extend(chunk)
                frames, bad = self.consume_frames(buf)
                for cmd, payload in frames:
                    self.on_frame(cmd, payload)
                if bad:
                    LOG.warning("[live] 丢弃 %d 字节坏帧数据，降级为仿真模式", bad)
                    break
            LOG.warning("[live] 链路断开，降级为仿真模式")

    # ---- 拆帧 ----
    def consume_frames(self, buf: bytearray) -> tuple[list[tuple[int, bytes]], int]:
        """从缓冲区拆出完整帧，返回 ([(cmd, payload)], 丢弃字节数)。"""
        frames: list[tuple[int, bytes]] = []
        discarded = 0
        while True:
            start = buf.find(b"\xaa\x55")
            if start < 0:
                discarded += len(buf)
                buf.clear()
                return frames, discarded
            if start > 0:
                discarded += start
                del buf[:start]
            if len(buf) < 5:  # 头(2)+CMD(1)+LEN(1)+SUM(1)
                return frames, discarded
            cmd = buf[2]
            length = buf[3]
            total = 5 + length
            if len(buf) < total:
                return frames, discarded
            frame = bytes(buf[:total])
            del buf[:total]
            payload = frame[4:4 + length]
            checksum = (cmd + length + sum(payload)) & 0xFF
            if checksum != frame[4 + length]:
                discarded += total
                continue
            frames.append((cmd, payload))

    def on_frame(self, cmd: int, payload: bytes) -> None:
        name, desc, direction = PROTO_COMMANDS.get(cmd, ("UNKNOWN", "未知指令", "?"))
        LOG.info("[live] %s(0x%02X) %s %s payload=%s", name, cmd, desc, direction, payload.hex())
        # TODO(未实现)：把真实硬件数据映射到仿真状态
        #   TEL  (0x30) -> battery / voltage / temp / x,y,heading
        #   EVENT(0x31) -> recent / review（检测事件）
        #   PCMD (0x40) -> 下发远程控制（远程模式才允许）
        #   TASK (0x41) -> 下发任务卡（批次）
        #   BCMD (0x50) / BSTATE (0x51) -> 车端控制与状态回传
        # 解析失败或字段缺失时保持仿真数据，不阻塞网页演示。


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------
def _parse_live(value: str) -> tuple[str, int]:
    if ":" not in value:
        raise argparse.ArgumentTypeError("--live 需要 host:port 形式，例如 192.168.4.1:8266")
    host, _, port_text = value.rpartition(":")
    if not host or not port_text.isdigit() or not (0 < int(port_text) < 65536):
        raise argparse.ArgumentTypeError("--live 需要 host:port 形式，例如 192.168.4.1:8266")
    return host, int(port_text)


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="《株迹可循》本地演示服务（Python 3.12 标准库，无第三方依赖）",
    )
    parser.add_argument("--host", default=DEFAULT_HOST, help="监听地址（默认 127.0.0.1）")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="监听端口（默认 8765）")
    parser.add_argument("--live", metavar="HOST:PORT", default=None,
                        help="预留：连接 ESP32-C3，例如 192.168.4.1:8266（本期自动降级仿真）")
    parser.add_argument("--fresh", action="store_true",
                        help="从 0 开始跑完整巡检（默认从 66%% 演示检查点开始）")
    parser.add_argument("--camera-mode", default="sim",
                        choices=["sim", "push", "mjpeg", "rtsp"],
                        help="图传源：sim 仿真 / push K230 推帧 / mjpeg K230 直连 / rtsp ffmpeg 拉流")
    parser.add_argument("--camera-url", default=None,
                        help="mjpeg/rtsp 模式的流地址（rtsp://... 或本地 mp4，用于联调）")
    parser.add_argument("--device-token", default=None,
                        help="设备上行 token（设置后 POST /api/device/* 需带 X-Device-Token）")
    parser.add_argument("--ffmpeg", default=None, help="ffmpeg 可执行文件路径（rtsp 模式用）")
    parser.add_argument("--log-level", default="INFO",
                        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
                        help="日志级别（默认 INFO）")
    parser.add_argument("--version", action="version", version=f"%(prog)s {APP_VERSION}")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_arg_parser().parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="[%(levelname)s] %(message)s",
    )

    live_target = _parse_live(args.live) if args.live else None
    sim = Simulation(fresh=args.fresh)
    registry = WSRegistry()
    camera = CameraHub(
        ASSETS_DIR,
        mode=args.camera_mode,
        url=args.camera_url,
        token=args.device_token,
        ffmpeg=args.ffmpeg,
    )
    try:
        server = DemoServer((args.host, args.port), RequestHandler, sim, registry, camera)
    except OSError as exc:
        LOG.error("无法监听 %s:%s（%s）。端口可能被占用，请用 --port 指定其它端口。",
                  args.host, args.port, exc)
        camera.stop()
        return 2

    stop_event = server.stopping
    sim_thread = threading.Thread(
        target=simulation_loop, args=(sim, registry, stop_event),
        name="simulation", daemon=True,
    )
    sim_thread.start()

    LOG.info("《株迹可循》本地演示服务 %s 已启动", APP_VERSION)
    LOG.info("  页面:   http://%s:%d/", args.host, args.port)
    LOG.info("  PC端:   http://%s:%d/pc/", args.host, args.port)
    LOG.info("  接口:   /api/state  /api/report  /api/video/info  /api/export/csv  /api/health")
    LOG.info("  图传:   /api/camera/status  /api/camera/latest.jpg  /api/camera/stream.mjpg")
    LOG.info("  上行:   POST /api/device/frame|detection|telemetry|ack  GET /api/device/commands")
    LOG.info("  长连接: ws://%s:%d/ws", args.host, args.port)
    LOG.info("  图传源: mode=%s%s", args.camera_mode,
             (" url=" + args.camera_url) if args.camera_url else "")
    if args.device_token:
        LOG.info("  设备鉴权: 已开启（X-Device-Token）")
    if args.fresh:
        LOG.info("  仿真:   从第 1/20 停靠位开始完整巡检（0 -> 64 株）")
    else:
        LOG.info("  仿真:   从演示检查点开始（第 %d/%d 停靠位、%d/%d 株、%d%%），推进到完成",
                 CHECKPOINT_STOP, STOP_TOTAL, CHECKPOINT_PLANTS, PLANTS_TOTAL,
                 round(CHECKPOINT_PLANTS * 100 / PLANTS_TOTAL))
    if live_target:
        host, port = live_target
        LOG.info("  live:   预留连接 %s:%d（本期为协议骨架，自动降级仿真）", host, port)
        Esp32Link(host, port, stop_event).start()

    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        LOG.info("收到 Ctrl+C，正在关闭服务 ...")
    finally:
        stop_event.set()
        camera.stop()
        server.server_close()
        registry.close_all()
        LOG.info("服务已关闭")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
