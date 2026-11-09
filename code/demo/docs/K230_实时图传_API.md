# K230 实时图传接入 API（预留 + 可直接联调）

> 目标：把现在的“仿真画面”换成 **CanMV K230 实拍画面**，H5/小程序不用改结构；同时保留仿真作为断连兜底。
> 服务：`./server/app.py`（Python 3.12 标准库）。所有接口都在同一端口（默认 8765）。

## 0. 三种接入方式（按你的 K230 固件能力选一种）

| 方式 | K230 侧要做什么 | H5 显示 | 适用 |
|---|---|---|---|
| **A. push（推荐先试）** | 抓帧→JPEG→`POST /api/device/frame`（3—5 fps） | 服务端 `/api/camera/stream.mjpg` | 只要能 JPEG 编码、能发 HTTP 就行，最省事 |
| **B. mjpeg** | K230 自己起 HTTP MJPEG 服务（如 `http://192.168.4.1:8080/stream`） | H5 直接以 `<img src="http://<K230-IP>:8080/stream">` 显示 | 固件里已有 MJPEG 例程时最快 |
| **C. rtsp（正式低码率）** | K230 推 H.264 RTSP（720p/15fps ≈1—2 Mbps） | 服务端用 ffmpeg 拉流→MJPEG→H5 | 想要设计说明写的“720p/15fps/1.2Mbps”效果时用 |

启动示例：
```powershell
# 默认仿真
python server/app.py
# A：K230 主动 POST（服务端不用加参数，保持 sim 也可；状态会自动切到真实）
python server/app.py
# B：H5 直接看 K230 的 MJPEG
python server/app.py --camera-mode mjpeg --camera-url http://192.168.4.1:8080/stream
# C：服务端拉 RTSP（需 ffmpeg；本地可用 mp4 文件模拟验证）
python server/app.py --camera-mode rtsp --camera-url rtsp://192.168.4.1:8554/live
python server/app.py --camera-mode rtsp --camera-url "C:\path\demo.mp4"   # 本机验证链路
```
安全开关：`--device-token <token>` 后，所有 `POST /api/device/*` 必须带请求头 `X-Device-Token: <token>`；局域网演示可不设。

## 1. 上行：K230 → 服务端

### POST `/api/device/frame`（方式 A 核心接口）
- Body：**单帧 JPEG 原始字节**（`Content-Type: image/jpeg`，≤ 3 MB）。
- 可选请求头：`X-Device-Id: k230-01`、`X-Frame-Ts`（秒级时间戳字符串）、`X-Ptz-Pan`、`X-Ptz-Pitch`、`X-Width`、`X-Height`、`X-Seq`。
- 返回：
```json
{"ok":true,"seq":12,"server_ts":"2026-11-04 10:35:02","fps":3.0,"kbps":420.5,
 "source":{"mode":"push","online":true,"width":640,"height":360}}
```
- 服务端认为“在线”条件：最近 3 s 内收到帧；断开 3 s 后 H5 自动回退仿真画面。

### POST `/api/device/detection`（可选：把 K230 端 YOLO 结果送上来）
```json
{"code":"1棚-3行-B2台-2位-1株","disease":"叶斑病","confidence":0.87,
 "box":{"x":0.22,"y":0.30,"w":0.26,"h":0.34},"ptz":{"pan":0,"pitch":78},
 "ts":"2026-11-04 10:35:02","image_jpeg_base64":null}
```
服务端把 box 叠加到最新帧上（`/api/video/info` 的 `boxes`），`image_jpeg_base64` 可留空。

### POST `/api/device/telemetry`（可选：真车状态替换仿真）
```json
{"battery":78,"voltage":11.6,"current":0.82,"temp":32,"x":3.24,"y":1.85,
 "heading":90,"stop_index":7,"plants_done":42,"detected":6,"rssi":-52,"latency_ms":28}
```
收到后 3 s 内服务端暂停仿真推进，H5 显示真实状态；超时回退仿真。

### GET `/api/device/commands?since=0`（可选：ESP32/K230 轮询取控制指令）
H5 在远程模式摇杆/急停/切模式时，服务端会入队：
```json
{"commands":[{"seq":12,"type":"control","cmd":"move","v":0.3,"w":-0.2,"ts":1793}],
 "next":13}
```
配套 `POST /api/device/ack {"seq":12}` 清掉已执行指令；也可让 ESP32/K230 直接连 `/ws`（消息格式见 `api_contract.md`）。

## 2. 下行/取流（H5、小程序用）

| 接口 | 说明 |
|---|---|
| `GET /api/camera/status` | 图传源状态：`{"source":{"mode":"push|mjpeg|rtsp|sim","online":true,"fps":3.0,"kbps":420,"width":640,"height":360,"stream_url":null,"last_frame_ts":"..."}}` |
| `GET /api/camera/latest.jpg` | 最新一帧（无真实帧时返回演示图，响应头 `X-Source: k230/sim`、`X-Frame-Seq`、`X-Frame-Ts`） |
| `GET /api/camera/stream.mjpg` | MJPEG 流（`multipart/x-mixed-replace`），H5 `<img>` 可直接显示；最长 15 fps |
| `GET /api/video/info` | 已合并真实源：`camera/width/height/fps/bitrate/ptz/ts/boxes` + `source` 字段 |
| `POST /api/camera/source` | 运行时切换源：`{"mode":"mjpeg","url":"http://192.168.4.1:8080/stream"}`（局域网演示用） |

H5 行为（已实现于 `web/js/camera_live.js`）：
1. 每 1.5 s 查 `/api/camera/status`；
2. `push/rtsp` 且在线 → `#camImg` 指向 `/api/camera/stream.mjpg`，角标显示“K230 实拍”；
3. `mjpeg` 且在线 → 直接指向 K230 URL，角标显示“K230 直连”；
4. 离线 → 回退 `assets/cam_plant.jpg` 演示画面，角标“演示画面”；
5. `?freeze=1` 截图模式不发起请求，保证界面设计图 数值稳定。

## 3. 带宽/参数建议（按设计说明“低码率监看”口径）

| 方式 | 参数 | 实测/估算带宽 | 建议 |
|---|---|---|---|
| push MJPEG | 640×360，q=60，3 fps | 约 1.5—2.5 Mbps | 联调首选，够看清检测框 |
| push MJPEG | 1280×720，q=70，1 fps | 约 1—2 Mbps | “事件关键帧”模式 |
| mjpeg 直连 | 640×360，5 fps | 约 2—3 Mbps | K230 端有例程时 |
| rtsp H.264 | 1280×720，15 fps，1.2 Mbps | 约 1.2 Mbps | 正式演示最接近设计说明 |

> 真实 H.264 才能做到“720p/15fps/1.2Mbps”；MJPEG 同画质会高 3—8 倍，所以联调阶段用低分辨率/低帧率，正式演示切 RTSP。

## 4. K230 端最小代码（方式 A，伪代码级，按手册核对两处）

```python
# CanMV K230 MicroPython（具体 import 以你手册/固件为例程为准）
import network, socket, time
# 1) 连 WiFi（STA）
wlan = network.WLAN(network.STA_IF); wlan.active(True)
wlan.connect("SSID", "PASSWORD")
while not wlan.isconnected(): time.sleep_ms(200)
print("IP:", wlan.ifconfig())

# 2) 相机（K230 常见：from media.sensor import *; sensor=Sensor(); sensor.reset() ...）
# 3) 抓帧 + JPEG 编码：把 frame 变成 bytes（手册里的 compress/save 接口）
#    jpg_bytes = <按手册把 img 编码为 JPEG 字节>
# 4) 发 HTTP POST
def post_jpeg(host, port, path, data, token=None):
    s = socket.socket(); s.settimeout(3)
    s.connect(socket.getaddrinfo(host, port)[0][-1])
    hdr = ("POST %s HTTP/1.1\r\nHost: %s:%d\r\nContent-Type: image/jpeg\r\n"
           "Content-Length: %d\r\nConnection: close\r\n" % (path, host, port, len(data)))
    if token: hdr += "X-Device-Token: %s\r\n" % token
    s.send(hdr.encode() + b"\r\n" + data)
    print(s.recv(256)); s.close()

while True:
    # img = sensor.snapshot(); jpg = encode(img)
    post_jpeg("192.168.1.50", 8765, "/api/device/frame", jpg)
    time.sleep_ms(333)   # 约 3 fps
```

本仓库已给出两个可改的骨架（只差“按手册确认的编码/相机初始化”两处）：
- `firmware/k230/push_frames.py`（方式 A）
- `firmware/k230/mjpeg_server.py`（方式 B，K230 自起 MJPEG 服务）

## 5. 本地无设备时怎么验证

```powershell
# 终端 1：起服务
python server/app.py --port 8765
# 终端 2：模拟 K230 推帧（3 fps + 遥测 + 检测框）
python tools/device_simulator.py --host 127.0.0.1 --port 8765 --fps 3
# 浏览器打开 http://127.0.0.1:8765/ → 图传页角标应显示“K230 实拍”
```
或验证 RTSP 拉流链路（用本机 mp4 模拟）：
```powershell
python server/app.py --port 8766 --camera-mode rtsp --camera-url "path\to\demo.mp4"
```
