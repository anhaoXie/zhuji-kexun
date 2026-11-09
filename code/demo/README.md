# demo · 本地演示与设备端代码

本目录是《株迹可循》的可运行演示：手机端 H5、PC 棚务台、微信小程序骨架、Python 本地服务、CanMV K230 图传与 kmodel 推理固件。

## 1. 一键启动

```bash
cd code/demo
python server/app.py
```

| 入口 | 地址 |
|---|---|
| 手机端 H5 | <http://127.0.0.1:8765/> |
| PC 棚务台 | <http://127.0.0.1:8765/pc/> |

Windows 可直接双击：

- `启动演示.cmd` → 本地服务 + 手机端
- `启动PC演示.cmd` → 本地服务 + PC 棚务台
- `启动演示-K230联调.cmd` → 监听 `0.0.0.0`，供 K230 从局域网接入
- `启动演示-局域网.cmd` → 手机与 PC 同网段演示
- `打开离线界面.cmd` → 直接打开单文件离线版

服务端只依赖 **Python 3.12 标准库**，无第三方依赖。

## 2. 目录

| 目录/文件 | 用途 |
|---|---|
| `web/` | 手机端 H5（4 tab：监控 / 控制 / 图传 / 报表；微信小程序同款界面；`file://` 可离线打开） |
| `web_pc/` | PC 棚务台（桌面控制台：棚区平面、株位档案、复核、批次报表、图传；1440×900 布局） |
| `miniprogram/` | 微信小程序源码骨架（4 页 + API 层 + BLE 骨架，可导入微信开发者工具） |
| `server/` | Python 本地服务：仿真、HTTP API、WebSocket、CSV 导出、K230 设备接入 |
| `firmware/k230/` | CanMV K230 端：图传上行（`push_frames.py`）、MJPEG 服务（`mjpeg_server.py`）、YOLO11n 板端推理（`detect_yolo11.py` + `best_320.kmodel`） |
| `tools/device_simulator.py` | 无硬件时模拟 K230：推帧 + 遥测 + 检测框 |
| `assets/` | 演示素材（车端相机画面等） |
| `shots/`、`shots_pc/` | 手机端 / PC 端高清截图 |
| `docs/` | 接口契约、K230 图传 API、PC 端说明 |
| `株迹可循-手机端演示.html` | 单文件离线演示版（断网可开） |

## 3. 演示动线

```
监控（台位/电量/航线/最近结果）
  → 控制（切远程模式 → 摇杆 → 急停）
  → 图传（K230 实拍 / 检测框）
  → 报表（KPI / 六状态 / 复核 / 导出 CSV）
```

详细演示脚本见 [`../../docs/08-software-and-demo.md`](../../docs/08-software-and-demo.md)。

## 4. 真实图传（CanMV K230）

默认是仿真；接上 K230 后会自动切真实图传（K230 推第一帧即生效）。

### 方式 A · push（推荐）

1. K230 运行 `firmware/k230/push_frames.py`（改 WiFi SSID / 密码 / 电脑 IP / 设备 token）
2. 电脑端运行 `启动演示-K230联调.cmd`（服务监听 `0.0.0.0`）
3. 图传页角标变为「K230 实拍」

### 方式 B · MJPEG 直连

- K230 运行 `firmware/k230/mjpeg_server.py`
- 电脑端：`python server/app.py --camera-mode mjpeg --camera-url http://<K230 IP>:8080/stream`

### 方式 C · RTSP

- K230 推 H.264 RTSP（720p/15fps）
- 电脑端：`python server/app.py --camera-mode rtsp --camera-url rtsp://<K230 IP>:8554/live`
- 服务端用 ffmpeg 拉流拆帧

### 无硬件联调

```bash
python tools/device_simulator.py --port 8765 --fps 3
```

### K230 板端推理

`firmware/k230/` 另含 YOLO11n 320×320 int8 kmodel 与推理脚本，已在 **CanMV K230 YAHBOOM-1G（CanMV v1.4.3 / GC2093）** 上跑通，见 `K230上板说明.md` 与 `board_verify.jpg`。

接口与带宽说明见 [`docs/K230_实时图传_API.md`](docs/K230_实时图传_API.md)。

## 5. 已知边界

- 图传是**低码率监看**，默认关闭、仅演示/远程接管，**不参与判定**；识别仍在车端 K230。
- 小程序控车只在「远程模式」开放；2.4G 遥控优先、失联 500 ms 停车、急停硬件优先——三条安全规则在 H5 / 服务端 / 小程序三处一致。
- 微信小程序真机需要 BLE 固件、HTTPS 合法域名/备案、`live-player` 类目资质；本期交付源码骨架 + 本地联调，二期接实车。
- 服务端默认为**仿真检查点**，用于界面联调与演示；作品指标以现场测试记录为准。

## 6. 截图复现

```bash
# 4 张 390×844@3x 截图（file:// 离线 + freeze 固定数值）
node tools/shoot.mjs --url "file:///<abs-path>/web/index.html?shot=monitor&freeze=1" --out shots/monitor.png --width 390 --height 844 --scale 3
# 合成四屏图
python tools/compose_fig9.py
```

## 7. K230 连不上时按顺序查

1. 服务端是否 `--host 0.0.0.0`（窗口标题「K230联调服务」）
2. 电脑防火墙是否放行 TCP 8765
3. 电脑与 K230 是否同一 2.4G 局域网
4. `ping <电脑IP>` 是否通
5. 见 `firmware/k230/README.md` 第 4 节
