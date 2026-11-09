# -*- coding: utf-8 -*-
"""模拟 CanMV K230 / ESP32 设备上行，用于没有硬件时联调真实图传链路。

它做三件事（可分别关闭）：
1. 以 --fps 频率把 assets/cam_frames/*.jpg 依次 POST 到 /api/device/frame；
2. 每 1 s POST /api/device/telemetry（电量/位置/模式等）；
3. 每 5 s POST /api/device/detection（检测框，可选）。

用法：
    python tools/device_simulator.py --host 127.0.0.1 --port 8765 --fps 3
    python tools/device_simulator.py --port 8765 --token <token> --fps 5 --no-telemetry
按 Ctrl+C 停止。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
DEFAULT_FRAMES = APP_DIR / "assets" / "cam_frames"


class DeviceSimulator:
    def __init__(self, host: str, port: int, token: str | None,
                 frames_dir: Path, fps: float, telemetry: bool,
                 detection: bool, device_id: str) -> None:
        self.base = f"http://{host}:{port}"
        self.token = token
        self.frames_dir = frames_dir
        self.fps = max(0.2, min(fps, 15.0))
        self.telemetry = telemetry
        self.detection = detection
        self.device_id = device_id
        self.frames = sorted(frames_dir.glob("*.jpg"))
        if not self.frames:
            raise SystemExit(f"没找到演示帧：{frames_dir}（先跑 ffmpeg 生成或指定 --frames）")
        self.sent = 0
        self.errors = 0
        self.telemetry_at = time.time()
        self.detection_at = time.time()
        self.mode = "patrol"
        self.battery = 78.0
        self.stop_index = 7
        self.plants = 42

    # ---- HTTP ----
    def _post(self, path: str, body: bytes, content_type: str,
              headers: dict | None = None) -> dict | None:
        req = urllib.request.Request(self.base + path, data=body, method="POST")
        req.add_header("Content-Type", content_type)
        req.add_header("X-Device-Id", self.device_id)
        if self.token:
            req.add_header("X-Device-Token", self.token)
        for key, value in (headers or {}).items():
            req.add_header(key, str(value))
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            self.errors += 1
            if self.errors <= 3 or self.errors % 30 == 0:
                print(f"[设备模拟] 发送失败（第 {self.errors} 次）：{exc}")
            return None

    # ---- 三种上行 ----
    def send_frame(self, index: int) -> None:
        path = self.frames[index % len(self.frames)]
        data = path.read_bytes()
        ts = time.strftime("%Y-%m-%d %H:%M:%S")
        result = self._post("/api/device/frame", data, "image/jpeg", {
            "X-Frame-Ts": ts, "X-Width": 640, "X-Height": 360,
            "X-Ptz-Pan": 0, "X-Ptz-Pitch": 78, "X-Seq": index,
        })
        self.sent += 1
        if result and self.sent % 30 == 0:
            print(f"[设备模拟] 已推 {self.sent} 帧（{result.get('fps')} fps / "
                  f"{result.get('kbps')} kbps，源 {result.get('source', {}).get('mode')}）")

    def send_telemetry(self) -> None:
        self.battery = max(20.0, self.battery - 0.008 * (time.time() - self.telemetry_at))
        self.telemetry_at = time.time()
        payload = {
            "battery": round(self.battery, 1), "voltage": round(11.6 - 0.007 * (78 - self.battery), 2),
            "current": 0.82, "temp": 32, "x": 3.24, "y": 1.85, "heading": 90,
            "stop_index": self.stop_index, "stop_total": 20,
            "plants_done": self.plants, "plants_total": 64, "detected": 6,
            "rssi": -52, "latency_ms": 28,
        }
        # 注意：不主动上报 mode——真车由 H5 远程模式/遥控器决定后再回传；
        # 模拟器若每秒回传 patrol，会把 H5 切好的远程模式顶回去。
        self._post("/api/device/telemetry", json.dumps(payload).encode(),
                   "application/json")

    def send_detection(self) -> None:
        self.detection_at = time.time()
        payload = {
            "code": "1棚-3行-B2台-2位-1株",
            "disease": "叶斑病",
            "confidence": 0.87,
            "box": {"x": 0.22, "y": 0.30, "w": 0.26, "h": 0.34},
            "ptz": {"pan": 0, "pitch": 78},
            "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        self._post("/api/device/detection", json.dumps(payload).encode(),
                   "application/json")

    # ---- 主循环 ----
    def run(self) -> None:
        interval = 1.0 / self.fps
        print(f"[设备模拟] 目标 {self.base}，{len(self.frames)} 帧，{self.fps} fps；Ctrl+C 停止")
        index = 0
        last = time.monotonic()
        try:
            while True:
                now = time.monotonic()
                if now - last >= interval:
                    last = now
                    self.send_frame(index)
                    index += 1
                if self.telemetry and time.time() - self.telemetry_at >= 1.0:
                    self.send_telemetry()
                if self.detection and time.time() - self.detection_at >= 5.0:
                    self.send_detection()
                time.sleep(0.02)
        except KeyboardInterrupt:
            print(f"\n[设备模拟] 停止，共推 {self.sent} 帧，失败 {self.errors} 次")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="模拟 K230 推流 + 遥测 + 检测，联调真实图传链路")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--token", default=None, help="与服务端 --device-token 一致")
    parser.add_argument("--frames", default=str(DEFAULT_FRAMES), help="演示帧目录（*.jpg）")
    parser.add_argument("--fps", type=float, default=3.0)
    parser.add_argument("--device-id", default="k230-sim-01")
    parser.add_argument("--no-telemetry", action="store_true")
    parser.add_argument("--no-detection", action="store_true")
    args = parser.parse_args(argv)
    sim = DeviceSimulator(args.host, args.port, args.token, Path(args.frames),
                          args.fps, not args.no_telemetry, not args.no_detection,
                          args.device_id)
    sim.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
