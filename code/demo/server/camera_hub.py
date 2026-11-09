# -*- coding: utf-8 -*-
"""K230 实时图传接入层（Python 3.12 标准库，无第三方依赖）。

职责
----
* 缓存 K230 推上来的最新 JPEG 帧（方式 A：push），并提供 MJPEG 流给 H5；
* 方式 B（mjpeg）：K230 自己开 MJPEG 服务，本模块只记录源地址与在线状态；
* 方式 C（rtsp/本地文件）：用 ffmpeg 拉流拆帧，转成 MJPEG 给 H5（需本机 ffmpeg）；
* 接收 K230/主控上报的检测框与遥测（见 docs/K230_实时图传_API.md）；
* 给 ESP32/K230 轮询控制指令（命令队列 + ack）。

所有公开方法均可从多线程调用；读写都在 ``self._lock`` 下。
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import threading
import time
from collections import deque
from pathlib import Path

LOG = logging.getLogger("zhujikexun.camera")

JPEG_SOI = b"\xff\xd8"
JPEG_EOI = b"\xff\xd9"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
MAX_FRAME_BYTES = 3 * 1024 * 1024      # 单帧上限 3 MB
OFFLINE_AFTER = 3.0                   # 3 秒没有新帧即视为离线，H5 回退仿真
DETECTION_FRESH = 8.0                 # 检测框有效期
MAX_COMMANDS = 100

VIDEO_MODES = ("sim", "push", "mjpeg", "rtsp")


def find_ffmpeg(explicit: str | None = None) -> str | None:
    """按顺序找 ffmpeg：显式参数 → imageio_ffmpeg → PATH → DSH 运行时缓存。"""
    if explicit:
        p = Path(explicit)
        if p.is_file():
            return str(p)
        LOG.warning("--ffmpeg 指定的文件不存在：%s", explicit)
    try:
        import imageio_ffmpeg  # type: ignore
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and Path(exe).is_file():
            return exe
    except Exception:  # noqa: BLE001 - 可选依赖
        pass
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    return None


class FfmpegPuller(threading.Thread):
    """用 ffmpeg 拉 rtsp/本地视频，按 JPEG SOI/EOI 拆帧塞进 CameraHub。"""

    def __init__(self, hub: "CameraHub", url: str, ffmpeg: str, fps: int = 5,
                 width: int = 640) -> None:
        super().__init__(name="ffmpeg-puller", daemon=True)
        self.hub = hub
        self.url = url
        self.ffmpeg = ffmpeg
        self.fps = max(1, min(int(fps), 15))
        self.width = max(160, min(int(width), 1280))
        self.stop_event = threading.Event()

    def stop(self) -> None:
        self.stop_event.set()

    def _build_cmd(self) -> list[str]:
        cmd = [self.ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error"]
        low = self.url.lower()
        if low.startswith(("rtsp://", "rtsps://")):
            cmd += ["-rtsp_transport", "tcp", "-i", self.url]
        else:
            # 本地文件/HTTP 视频：循环播放并限速，模拟实时流
            p = Path(self.url)
            src = str(p) if p.is_file() else self.url
            cmd += ["-re", "-stream_loop", "-1", "-i", src]
        cmd += ["-an", "-vf", f"fps={self.fps},scale={self.width}:-2",
                "-f", "mjpeg", "-q:v", "7", "pipe:1"]
        return cmd

    def run(self) -> None:
        backoff = 1.0
        while not self.stop_event.is_set():
            cmd = self._build_cmd()
            LOG.info("[camera] ffmpeg 拉流：%s", " ".join(cmd[:6]) + " ...")
            proc = None
            try:
                proc = subprocess.Popen(cmd, stdout=subprocess.PIPE,
                                        stderr=subprocess.DEVNULL, bufsize=0)
                backoff = 1.0
                buf = b""
                while not self.stop_event.is_set():
                    chunk = proc.stdout.read(8192) if proc.stdout else b""
                    if not chunk:
                        break
                    buf += chunk
                    while True:
                        start = buf.find(JPEG_SOI)
                        if start < 0:
                            buf = buf[-1:]
                            break
                        end = buf.find(JPEG_EOI, start + 2)
                        if end < 0:
                            buf = buf[start:]
                            break
                        frame = buf[start:end + 2]
                        buf = buf[end + 2:]
                        if len(frame) > 4:
                            try:
                                self.hub.ingest_frame(
                                    frame,
                                    {"source": "rtsp", "ts": time.strftime("%Y-%m-%d %H:%M:%S")},
                                )
                            except ValueError as exc:
                                LOG.debug("[camera] 丢弃坏帧：%s", exc)
            except FileNotFoundError:
                LOG.error("[camera] 找不到 ffmpeg，rtsp 拉流不可用；可用 --ffmpeg 指定路径")
                return
            except Exception as exc:  # noqa: BLE001
                LOG.warning("[camera] 拉流异常：%s", exc)
            finally:
                if proc is not None:
                    try:
                        proc.kill()
                    except OSError:
                        pass
            if self.stop_event.is_set():
                break
            LOG.warning("[camera] ffmpeg 退出，%.0f s 后重试", backoff)
            self.stop_event.wait(backoff)
            backoff = min(backoff * 2, 15.0)


class CameraHub:
    """图传源状态 + 帧缓存 + 命令队列。"""

    def __init__(self, assets_dir: Path, mode: str = "sim", url: str | None = None,
                 token: str | None = None, ffmpeg: str | None = None,
                 fps_hint: int = 5, width_hint: int = 640) -> None:
        self._lock = threading.RLock()
        self.mode = mode if mode in VIDEO_MODES else "sim"
        self.url = url
        self.token = token or None
        self.assets_dir = Path(assets_dir)
        self.ffmpeg = find_ffmpeg(ffmpeg)
        self.fps_hint = fps_hint
        self.width_hint = width_hint

        self._fallback = None
        fb = self.assets_dir / "cam_plant.jpg"
        if fb.is_file():
            try:
                self._fallback = fb.read_bytes()
            except OSError:
                self._fallback = None

        self._frame: bytes | None = None
        self._frame_seq = 0
        self._frame_ts: str | None = None
        self._frame_meta: dict = {}
        self._last_ingest = 0.0
        self._frame_times: deque[float] = deque(maxlen=40)
        self._byte_times: deque[tuple[float, int]] = deque(maxlen=80)
        self._total_frames = 0
        self._total_bytes = 0

        self._boxes: list[dict] = []
        self._boxes_at = 0.0
        self._detection_meta: dict = {}

        self._commands: deque[dict] = deque(maxlen=MAX_COMMANDS)
        self._cmd_seq = 0
        self._stop = threading.Event()
        self._puller: FfmpegPuller | None = None

        if self.mode == "rtsp" and self.url:
            self._start_puller_locked()
        if self.mode == "mjpeg" and self.url:
            LOG.info("[camera] MJPEG 直连模式，源地址：%s", self.url)
        LOG.info("[camera] 图传源模式：%s（token=%s，ffmpeg=%s）",
                 self.mode, "on" if self.token else "off", self.ffmpeg or "未找到")

    # ------------------------------------------------------------------
    # 帧
    # ------------------------------------------------------------------
    def _start_puller_locked(self) -> None:
        if not self.url:
            return
        if not self.ffmpeg:
            LOG.error("[camera] 未找到 ffmpeg，无法拉取 %s", self.url)
            return
        self._stop_puller_locked()
        self._puller = FfmpegPuller(self, self.url, self.ffmpeg,
                                    fps=self.fps_hint, width=self.width_hint)
        self._puller.start()

    def _stop_puller_locked(self) -> None:
        if self._puller is not None:
            self._puller.stop()
            self._puller = None

    def ingest_frame(self, data: bytes, meta: dict | None = None) -> dict:
        """接收一帧 JPEG/PNG；返回最新状态。异常时抛 ValueError。"""
        if not data or len(data) < 4:
            raise ValueError("empty_frame")
        if len(data) > MAX_FRAME_BYTES:
            raise ValueError("frame_too_large")
        if not (data.startswith(JPEG_SOI) or data.startswith(PNG_MAGIC)):
            raise ValueError("not_jpeg_or_png")
        now = time.monotonic()
        meta = dict(meta or {})
        with self._lock:
            # 仿真模式下第一次收到真实帧，自动升级为 push，H5 无需重启
            if self.mode == "sim":
                self.mode = "push"
                LOG.info("[camera] 收到 K230 首帧，自动切换到 push 模式")
            self._frame = data
            self._frame_seq += 1
            self._frame_ts = str(meta.get("ts") or time.strftime("%Y-%m-%d %H:%M:%S"))
            self._frame_meta = meta
            self._last_ingest = now
            self._frame_times.append(now)
            self._byte_times.append((now, len(data)))
            self._total_frames += 1
            self._total_bytes += len(data)
        return self.status()

    def latest_jpeg(self) -> tuple[bytes | None, int, str, str]:
        """返回 (帧, seq, 来源, 时间)。无真实帧时回退演示图。"""
        with self._lock:
            if self._frame is not None:
                return (self._frame, self._frame_seq,
                        "k230" if self.mode != "sim" else "sim",
                        self._frame_ts or "")
            return (self._fallback, 0, "sim", "")

    def _fps_locked(self) -> float:
        now = time.monotonic()
        recent = [t for t in self._frame_times if now - t <= 5.0]
        if len(recent) < 2:
            return 0.0
        span = max(recent[-1] - recent[0], 1e-6)
        return round((len(recent) - 1) / span, 1)

    def _kbps_locked(self) -> float:
        now = time.monotonic()
        recent = [(t, n) for (t, n) in self._byte_times if now - t <= 5.0]
        if not recent:
            return 0.0
        span = max(now - recent[0][0], 1.0)
        return round(sum(n for _, n in recent) * 8 / span / 1000.0, 0)

    def _online_locked(self) -> bool:
        return bool(self._frame is not None and self._last_ingest > 0
                    and (time.monotonic() - self._last_ingest) <= OFFLINE_AFTER)

    def status(self) -> dict:
        with self._lock:
            online = self._online_locked()
            meta = self._frame_meta
            width = int(meta.get("width") or (self.width_hint if online else 1280))
            height = int(meta.get("height") or (360 if online else 720))
            stream_url = self.url if (self.mode == "mjpeg" and self.url) else None
            return {
                "source": {
                    "mode": self.mode,
                    "online": online,
                    "stream_url": stream_url,
                    "width": width,
                    "height": height,
                    "fps": self._fps_locked() if online else 0.0,
                    "kbps": self._kbps_locked() if online else 0.0,
                    "last_frame_ts": self._frame_ts,
                    "frames_total": self._total_frames,
                    "bytes_total": self._total_bytes,
                    "device_id": meta.get("device_id") or None,
                },
                "token_required": bool(self.token),
                "hint": ("K230 实拍推流" if online and self.mode in ("push", "rtsp")
                         else ("K230 MJPEG 直连" if self.mode == "mjpeg"
                               else "演示画面（未接入 K230）")),
            }

    # ------------------------------------------------------------------
    # 检测框
    # ------------------------------------------------------------------
    def ingest_detection(self, payload: dict) -> dict:
        box = payload.get("box") or {}
        try:
            item = {
                "x": float(box.get("x", 0.0)),
                "y": float(box.get("y", 0.0)),
                "w": float(box.get("w", 0.0)),
                "h": float(box.get("h", 0.0)),
                "label": str(payload.get("disease") or payload.get("label") or "叶斑病"),
                "confidence": float(payload.get("confidence", 0.0)),
                "status": "review" if float(payload.get("confidence", 0.0)) < 0.8 else "high",
            }
        except (TypeError, ValueError) as exc:
            raise ValueError("bad_box") from exc
        with self._lock:
            self._boxes = [item]
            self._boxes_at = time.monotonic()
            self._detection_meta = {
                "code": payload.get("code"),
                "ts": payload.get("ts") or time.strftime("%Y-%m-%d %H:%M:%S"),
            }
        return {"ok": True, "boxes": self._boxes, "meta": self._detection_meta}

    def latest_boxes(self) -> list[dict]:
        with self._lock:
            if self._boxes and (time.monotonic() - self._boxes_at) <= DETECTION_FRESH:
                return list(self._boxes)
            return []

    # ------------------------------------------------------------------
    # /api/video/info 覆盖字段
    # ------------------------------------------------------------------
    def video_info(self) -> dict:
        st = self.status()
        online = st["source"]["online"]
        out: dict = {"source": st["source"]}
        if not online:
            return out
        with self._lock:
            meta = dict(self._frame_meta)
            out.update({
                "camera": "K230 · 实时" if self.mode != "mjpeg" else "K230 · MJPEG",
                "width": st["source"]["width"],
                "height": st["source"]["height"],
                "fps": st["source"]["fps"] or 5,
                "bitrate": f"{st['source']['kbps']:.0f} kbps",
                "ts": st["source"]["last_frame_ts"] or time.strftime("%Y-%m-%d %H:%M:%S"),
                "ptz": {"pan": int(meta.get("ptz_pan", 0)),
                        "pitch": int(meta.get("ptz_pitch", 78))},
                "boxes": self.latest_boxes(),
            })
        return out

    # ------------------------------------------------------------------
    # 命令队列（给 ESP32/K230 轮询）
    # ------------------------------------------------------------------
    def queue_command(self, command: dict) -> dict:
        with self._lock:
            self._cmd_seq += 1
            item = dict(command)
            item["seq"] = self._cmd_seq
            item["ts"] = round(time.time(), 3)
            self._commands.append(item)
            return item

    def commands_since(self, since: int) -> dict:
        with self._lock:
            items = [c for c in self._commands if int(c["seq"]) > since]
            return {"commands": items, "next": self._cmd_seq}

    def ack_command(self, seq: int) -> dict:
        with self._lock:
            keep = deque((c for c in self._commands if int(c["seq"]) != int(seq)),
                         maxlen=MAX_COMMANDS)
            self._commands = keep
        return {"ok": True, "seq": seq}

    # ------------------------------------------------------------------
    # 运行时切换源
    # ------------------------------------------------------------------
    def set_source(self, mode: str, url: str | None = None) -> dict:
        if mode not in VIDEO_MODES:
            raise ValueError("bad_mode")
        with self._lock:
            self.mode = mode
            self.url = url
            self._stop_puller_locked()
            if mode == "rtsp" and url:
                self._start_puller_locked()
            if mode != "mjpeg":
                pass
            LOG.info("[camera] 切换图传源：mode=%s url=%s", mode, url)
        return self.status()

    # ------------------------------------------------------------------
    # MJPEG 生成器
    # ------------------------------------------------------------------
    def mjpeg_chunks(self, fps: int = 10):
        """生成 multipart/x-mixed-replace 的帧块，供 HTTP 处理函数逐段写出。"""
        interval = 1.0 / max(1, min(int(fps), 15))
        while not self._stop.is_set():
            data, seq, source, ts = self.latest_jpeg()
            if not data:
                time.sleep(interval)
                continue
            head = (f"--frame\r\nContent-Type: image/jpeg\r\n"
                    f"Content-Length: {len(data)}\r\n"
                    f"X-Frame-Seq: {seq}\r\nX-Source: {source}\r\n"
                    f"X-Frame-Ts: {ts}\r\n\r\n").encode("ascii", "ignore")
            yield head + data + b"\r\n"
            time.sleep(interval)

    def stop(self) -> None:
        self._stop.set()
        with self._lock:
            self._stop_puller_locked()
