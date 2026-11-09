# CanMV K230 实时图传 · 固件端使用说明

> 面向《株迹可循》项目：把 H5 图传页的“演示画面”换成 **CanMV K230 实拍画面**。
> 本目录只放 **K230 板子上跑的 MicroPython 脚本**，电脑端服务在 `./server/`。
> 接口契约见 `../../docs/K230_实时图传_API.md`；设计口径见 `../../docs/BUILD_SPEC.md`。

---

## 0. 一分钟版（推荐路线）

| 步骤 | 做什么 | 命令 / 位置 |
|---|---|---|
| 1 | 板子连 2.4G WiFi，记下 K230 的 IP | 脚本启动时会打印 `ifconfig` |
| 2 | 电脑查局域网 IP，确认和 K230 **同一网段** | `ipconfig` → WLAN 的 IPv4 |
| 3 | 电脑起服务（**必须 `--host 0.0.0.0`**） | `python .\server\app.py --host 0.0.0.0 --port 8765` |
| 4 | CanMV IDE 打开 `push_frames.py`，改顶部 4 行 CONFIG，运行 | 改 SSID / 密码 / 电脑 IP / token |
| 5 | 电脑浏览器打开 H5 图传页 | `http://127.0.0.1:8765/`（图传 tab，角标“K230 实拍”） |
| 6 | 想确认收到帧 | `curl.exe http://127.0.0.1:8765/api/camera/status` |

**推荐先试 `push_frames.py`（方式 A）**，原因：

1. 服务端 `POST /api/device/frame` 已经实现（见 `server/app.py`；帧缓存、fps/kbps 统计、H5 自动切换、3 秒超时回退仿真都在服务端）；
2. K230 端只需要“抓帧 → JPEG → 发 HTTP”，代码最少、最容易定位问题（出错时服务端/电脑端能看到日志）；
3. 断网/脚本退出后 H5 3 秒自动回退演示画面，演示演示不会翻车。

`mjpeg_server.py`（方式 B）是备选：K230 自己开流给 H5 直连，少一跳、更“像视频”，但**单线程一次只能服务一个客户端**，且电脑端不缓存帧（关掉页面就没了）。

---

## 1. 文件说明

| 文件 | 方式 | 作用 | 需要改的地方 |
|---|---|---|---|
| `push_frames.py` | A · push（推荐） | K230 抓帧 → JPEG → `POST /api/device/frame`，约 3 fps | 顶部【用户必改】4 行 |
| `mjpeg_server.py` | B · mjpeg | K230 自起 HTTP 服务：`/` 预览页、`/stream` MJPEG、`/snapshot.jpg` 单帧 | 顶部 SSID/密码（端口按需） |
| `README.md` | — | 本文件：接线、联网、运行、联调、带宽、常见问题 | — |

> 两个脚本**不能同时跑**（同一台相机）。切换时先在 CanMV IDE 里停止前一个。

代码里凡是 `# TODO(手册核对 N)` 的地方，都是**没有 K230 实物时无法 100% 确认的 API**，每处给了候选 A/B/C 和判断依据，并对应本文第 9 节编号。**不要照抄猜出来的函数名**；按手册核对后通常改 2—3 行即可。

---

## 2. 接线与供电

> 依据：早期架构评审记录（K230/OpenMV 对比、系统架构与通信协议、电源方案评估），未随仓库分发。

### 2.1 供电（最容易翻车的地方）

- K230 **独立 5V / 1A 起**，跑 YOLO 峰值可能到 1.5—2A，**不要从主控 5V 排针取电**；
- 推荐链路：12V 电池 → 5V/5A 降压（XL4015 之类）→ K230；K230 与主控、ESP32 **共地**；
- 建议 K230 单独一路 XT30 输出 + 5V 端加 470 µF 电解，**避免电机启动瞬间掉压导致 K230 重启**（现象：一开电机就重启 / 花屏 / WiFi 掉线）；
- 联调阶段可以直接用**板子的 USB 供电**（接电脑或 5V 充电头），先不接车；上机后再换独立降压。

### 2.2 摄像头 / 屏幕 / TF 卡

- 摄像头用板载排线（GC2093，70°），**插拔前断电**；
- 3.5″ / 2.4″ 屏可以插也可以不插：本目录脚本**不依赖 display**（不初始化屏幕，省 CPU/内存）；
- 建议插一张 **microSD（16—32G）**：① 01Studio 固件/脚本常放在卡上；② 脚本自检会往 `/sdcard/test.jpg` 存样张，方便验证画面。

### 2.3 与主控的关系（图传不影响 UART 链路）

- K230 仍可照旧通过 UART2 把 YOLO/AprilTag 结果发给 STM32（921600、3.3V TTL、RX/TX 交叉、共地）；
- 本目录的图传走 **WiFi**，与串口链路互不影响，可以同时工作；
- 但注意：**K230 同一时间只能跑一个 MicroPython 程序**。如果还要跑 YOLO 主程序，就把推帧代码合进主程序（把 `main()` 里的循环挪到线程/任务里，需手册确认是否支持 `_thread`）。

---

## 3. 联网与电脑 IP

### 3.1 K230 侧 WiFi

- K230 只有 **2.4G WiFi（无蓝牙）**：SSID 必须是 2.4G 频段，5G 热点连不上；
- SSID/密码**不要用中文和特殊字符**（WiFi 库对编码敏感），建议英文数字；
- 手机热点也可以用（开 2.4G 频段），但注意部分手机热点有“AP 隔离”，电脑和 K230 互相访问不到。

### 3.2 电脑 IP（`ipconfig`）

1. Win + R → 输入 `cmd`（或 PowerShell）→ `ipconfig`；
2. 找 **WLAN（无线局域网适配器）** 的 `IPv4 地址`，例如 `192.168.1.50`；
3. 填进脚本 `SERVER_HOST`；
4. **判断同网段**：电脑 IP 和 K230 IP 的前三段要一样（`192.168.1.x` 和 `192.168.1.y` 才是同一网段）；
5. 电脑上 `ping <K230 的 IP>` 能通，说明二层网络没问题。

> 电脑常有多张网卡（以太网、WLAN、VMware/Hyper-V 虚拟网卡、VPN），**一定要选和 K230 连同一个 WiFi 的那张**，否则 IP 填对了也连不上。

### 3.3 K230 侧怎么看自己的 IP

- 跑脚本时 `connect_wifi()` 会打印 `[wifi] 已连接，ifconfig = ('192.168.x.x', ...)`；
- 或在 CanMV IDE 的串口终端（REPL）里执行：`import network; print(network.WLAN(network.STA_IF).ifconfig())`（**前提是手册确认 network 写法，见第 9 节 #4**）。

---

## 4. 电脑端：先起服务（**必读**）

### 4.1 启动命令

```powershell
# 在任意目录执行均可（内部按 __file__ 定位 web/、assets/）
cd .
python .\server\app.py --host 0.0.0.0 --port 8765
```

### 4.2 三个关键点

1. **`--host 0.0.0.0` 必须加**：服务端默认监听 `127.0.0.1`，只有本机能访问；K230 从局域网来连会直接“连接超时/拒绝”。（这是联调第一大坑）
2. **端口**：默认 `8765`；被占用就换（如 `8799`），K230 脚本 `SERVER_PORT` 同步改。
3. **可选鉴权**：加 `--device-token 123456` 后，K230 必须带 `X-Device-Token: 123456`（脚本 `DEVICE_TOKEN` 填同一串）。局域网演示可以不设。

### 4.3 Windows 防火墙放行（K230 连不上时必做）

管理员 PowerShell 执行一次：

```powershell
New-NetFirewallRule -DisplayName "ZhuJiKeXun-8765" -Direction Inbound -Protocol TCP -LocalPort 8765 -Action Allow
```

（Firefox/Chrome 访问本机 127.0.0.1 不受影响，**是 K230 从局域网访问电脑时才需要放行**。）

### 4.4 验证服务端（不用 K230 也能测）

```powershell
# 1) 探活
curl.exe http://127.0.0.1:8765/api/health

# 2) 图传状态（未推流时 mode=sim、online=false）
curl.exe http://127.0.0.1:8765/api/camera/status

# 3) 不接 K230，先证明 /api/device/frame 接口是通的：
curl.exe -X POST -H "Content-Type: image/jpeg" `
  --data-binary "@.\assets\cam_plant.jpg" `
  http://127.0.0.1:8765/api/device/frame
```

第 3 条返回类似下面这样，说明服务端 OK（H5 会把这个 JPEG 当成“K230 实拍”显示，展现实拍链路用）：

```json
{"ok":true,"seq":1,"server_ts":"2026-11-04 10:35:02","fps":0.0,"kbps":0.0,
 "source":{"mode":"push","online":true,"width":640,"height":360,...}}
```

> 测完想回到“仿真画面”，重启服务端即可（`mode` 会自动回到 `sim`）。

---

## 5. 方式 A：`push_frames.py`（推荐）

### 5.1 上板步骤

1. 板子插好摄像头、供电开机，CanMV IDE 连接板子；
2. CanMV IDE 打开 `./firmware/k230/push_frames.py`；
3. 改文件顶部【① 用户必改】：

   ```python
   WIFI_SSID = "你的2.4G名称"
   WIFI_PASSWORD = "你的密码"
   SERVER_HOST = "192.168.1.50"   # 第 3 节 ipconfig 查到的电脑 IP
   DEVICE_TOKEN = ""              # 服务端加了 --device-token 才填
   ```

4. 点运行（或在 IDE 里“运行当前脚本”），看下方串口打印。

### 5.2 应该看到的打印（正常）

```
[cfg] 目标：http://192.168.1.50:8765/api/device/frame
[cfg] 帧率 3 fps | 目标分辨率 640x360 | JPEG 质量 60 | 设备号 k230-01
[wifi] 正在连接 YourWiFi ...
[wifi] 已连接，ifconfig = ('192.168.1.23', ...)
[cam] reset() 成功
[cam] 分辨率候选 A 成功：width=640, height=360
[cam] 像素格式：RGB565
[自检] 图像尺寸：size()=(640, 360)
[自检] JPEG 编码候选：A: img.compress(quality=60)
[自检] 首帧 JPEG 大小：23.4 KB（640x360 q60 一般 15—40 KB）
[自检] 已存本地样张：/sdcard/test.jpg（23.4 KB）
[push] 首帧已送达：HTTP/1.1 200 OK
[push] 服务端回应：{"ok":true,"seq":1,...}
[push] 第 30 帧 | 3.0 fps | 平均 23.1 KB/帧 | 554 kbps | HTTP/1.1 200 OK
```

### 5.3 验证（在电脑上，按顺序）

```powershell
# ① 状态应为 mode=push、online=true、fps≈3、width/height 与你设置的一致
curl.exe http://127.0.0.1:8765/api/camera/status

# ② 浏览器直接看最新一帧（能看到实拍即成功）
start http://127.0.0.1:8765/api/camera/latest.jpg

# ③ H5 图传页：角标应显示“K230 实拍”
start http://127.0.0.1:8765/
```

H5 图传页说明：

- 正常模式（不带 `?freeze=1`）每 1.5 s 查一次状态，`push` 且在线 → 显示 `/api/camera/stream.mjpg`；
- 停止脚本/断网 **3 秒后自动回退**到 `assets/cam_plant.jpg` 演示画面（不用刷新页面）；
- `?freeze=1` 是截图模式，不发起请求——**联调时不要用它**。

### 5.4 自检没通过时怎么改

脚本第一次跑会自动打印“候选 A/B/C 哪个成功/失败”。把打印**原样发回**，或按第 9 节对应的编号对照手册改 2—3 行；也可以把 `DEBUG_API = True` 再跑一次，打印 `dir(img)` / `dir(sensor)`，一眼看出固件里到底有哪些方法。

---

## 6. 方式 B：`mjpeg_server.py`（备选）

### 6.1 上板步骤

1. 同 5.1：改顶部 `WIFI_SSID` / `WIFI_PASSWORD`，运行；
2. 正常打印：

```
[wifi] 已连接，ifconfig = ('192.168.1.23', ...)
[mjpeg] HTTP 服务已启动
[mjpeg] 浏览器打开：http://<K230 的 IP>:8080/ （预览页）
[mjpeg] 流地址：     http://<K230 的 IP>:8080/stream
[mjpeg] 单帧：       http://<K230 的 IP>:8080/snapshot.jpg
```

3. 电脑浏览器打开 `http://192.168.1.23:8080/` 应看到实时画面（预览页内嵌 `/stream`）；
4. H5 改用“直连”模式——**重启电脑端服务**：

```powershell
python .\server\app.py --host 0.0.0.0 --port 8765 `
  --camera-mode mjpeg --camera-url "http://192.168.1.23:8080/stream"
```

然后打开 `http://127.0.0.1:8765/` 图传页，角标应显示“K230 直连”，`<img>` 直接指向 K230。

### 6.2 已知限制（重要）

- **单线程**：一个客户端占着 `/stream` 时，其它设备打不开 `/snapshot.jpg`（要等前一个断开）；
- 想让流自己到期结束，把 `STREAM_MAX_SECONDS` 设成 `30`（H5 常连时不要设，否则 30 秒后画面定格）；
- 电脑端不缓存帧：K230 脚本停了，H5 上就是浏览器那侧连接断开（不会像方式 A 那样有“最后一张帧”兜底）；
- 走`--camera-mode mjpeg` 时，电脑端不校验 token（数据不经过电脑）。

---

## 7. 带宽与分辨率的取舍

> 下表是**接口文档/设计说明的估算口径**；实测以 `/api/camera/status` 里的 `kbps`（服务端按最近 5 秒统计）为准。

| 方式 | 参数 | 估算带宽 | 说明 |
|---|---|---|---|
| push（本目录 `push_frames.py`） | 640×360，q60，3 fps | 约 1.5—2.5 Mbps | **联调首选**，够看清检测框 |
| push | 1280×720，q70，1 fps | 约 1—2 Mbps | “事件关键帧”模式 |
| mjpeg 直连（`mjpeg_server.py`） | 640×360，5 fps | 约 2—3 Mbps | 固件/场景允许时用 |
| rtsp H.264（方式 C，本目录未提供） | 1280×720，15 fps | 约 1.2 Mbps | **设计说明“720p/15fps/1.2 Mbps”只有 H.264 能做到** |

要点：

- **MJPEG 同画质比 H.264 高 3—8 倍**，所以“720p/15fps/1.2 Mbps”这个口径**不能用 MJPEG 硬凑**，正式演示若要求这个画面效果，需要方式 C（K230 端 VENC 编码 H.264 + RTSP 推流，工作量另算）；
- 联调阶段用 **640×360 / 3—5 fps / q60** 是刻意的：2.4G WiFi 实际吞吐不稳，低码率才能长时间稳定；需要更清楚时可临时抬到 640×480；
- 粗略换算：640×360 q60 大约 **15—40 KB/帧**（实测为准），3 fps ≈ **0.4—1 Mbps**；q 值越高、画面越花（叶片细节多），单帧越大；
- 想省带宽：先降 **FPS**（H5 看检测框 3 fps 足够），再降 **JPEG_QUALITY**，最后才降分辨率。

---

## 8. 常见问题（按出现频率排序）

| # | 现象 | 原因 | 处理 |
|---|---|---|---|
| 1 | K230 发送失败：连接超时/拒绝 | **服务端默认只监听 127.0.0.1** | 服务端加 `--host 0.0.0.0` 后重启（见 4.2） |
| 2 | 同上 | 电脑防火墙拦了 8765 | 按 4.3 放行；或临时关防火墙验证 |
| 3 | 同上 | 电脑 IP 填错 / 不是同一张网卡 / 不同网段 | `ipconfig` 核对前三段；`ping` K230 IP |
| 4 | 同上 | 路由器开了 AP 隔离（宿舍/公共 WiFi 常见） | 换手机热点（2.4G）或自己带路由器 |
| 5 | `HTTP 401 {"error":"bad_device_token"}` | 服务端开了 token，脚本没填/填错 | 两边填同一串；或服务端去掉 `--device-token` |
| 6 | `HTTP 400 {"error":"bad_frame"}` | 发上去的不是 JPEG（编码候选不对） | 看串口 `[jpeg]` 打印；按第 9 节 #2 换候选 |
| 7 | `HTTP 413 body_too_large` | 单帧 > 3 MB | 降 `JPEG_QUALITY`、降分辨率 |
| 8 | H5 一直显示“演示画面” | 服务端没收到帧 / 已断开 3 秒 | 先 `curl /api/camera/status`：`mode` 不是 push 就回看 1—4 |
| 9 | 花屏、半张图、颜色错乱 | JPEG 没发完整（send 只发一部分/被中断）、编码器输出坏帧、WiFi 丢包 | ① 自检的 `test.jpg` 用电脑打开是否正常（正常=传输问题，异常=编码问题）；② 降低分辨率/帧率；③ 确认 `Content-Length` 与真实字节一致（脚本已按 len 计算） |
| 10 | `MemoryError` / 跑一会就重启 | 内存不足或供电跌落 | 降分辨率/q 值；加 `gc.collect()`（脚本已有）；确认 K230 独立 5V/1A、电机启动不掉压 |
| 11 | 帧率远低于设定 | 2.4G 拥塞 / 编码慢 / 客户端占满 | 换 WiFi 信道、靠近路由器；降 q/分辨率；确认只开了一个客户端 |
| 12 | 一开电机 K230 就重启/WiFi 掉 | 供电被电机拉垮 | 见 2.1：独立降压 + 大电容 + 单独 XT30 |
| 13 | H5 时间戳显示 1970 年 | K230 没对时 | 保持 `SEND_FRAME_TS = False`（服务端会打自己的时间） |
| 14 | 方式 B 浏览器打不开 `/snapshot.jpg` | 单线程被 `/stream` 占住 | 关掉占流的页面再试；或把 `STREAM_MAX_SECONDS` 设 30 |
| 15 | 脚本报找不到相机 / `media` 相关报错 | 相机初始化候选与固件不符 | 第 9 节 #1；`DEBUG_API=True` 打印 `dir()` 后按手册改 |
| 16 | CanMV IDE 运行脚本后连接断开/看不到打印 | 正常现象（脚本接管了板子） | 按 Ctrl+C 停止脚本即恢复；或重新连接 |
| 17 | WiFi 连不上（5G / 中文 SSID） | K230 只支持 2.4G，SSID 编码敏感 | 用 2.4G、英文 SSID；或系统层先配好网后把脚本里 SSID 改空 |

---

## 9. 待手册确认清单（最多 6 条，按影响排序）

> 工作方式：用户把 CanMV 技术手册（或 01Studio wiki 对应页面）给 项目负责人 → 按下面 6 条逐项核对 → 改代码里对应的 `# TODO(手册核对 N)` → 一般 2—3 行就能上机。
> 快速自查：把脚本里 `DEBUG_API = True` 打开跑一次，串口会打印固件里真实可用的 `dir(img)` / `dir(sensor)`。

### #1 相机初始化 + 媒体流水线（影响最大）

- 现在代码的**候选 A**：`from media.sensor import Sensor` → `Sensor()` → `reset()` → `set_framesize(...)` → `set_pixformat(...)` → `media.init()` / `media.start()`；
- **候选 B**：`import sensor`（OpenMV 风格，模块级函数）；
- **候选 C**：手册里的其它写法（例如 `Sensor(id=0)`、必须 `display.init(...)` 之后才能 `snapshot()`、或媒体初始化函数名不同）。
- 判断依据：CanMV K230 官方例程里常见 `from media.sensor import *` + `Sensor()` + `media.init()/media.start()`，但不同固件版本初始化顺序可能不同。
- **验证方法**：能稳定打印 `[自检] 图像尺寸：size()=(640, 360)`，且 `test.jpg` 打开正常。

### #2 JPEG 编码（第二重要）

- 现在代码的**候选 A**：`jpg = img.compress(quality=60)`（返回 bytes，首选）；
- **候选 B**：`img.save("/sdcard/xxx.jpg")` 后 `open(..., "rb").read()`（兼容性好但慢、会写卡）；
- **候选 C**：手册里的硬件/媒体 JPEG 编码接口（K230 可能有 VENC/JPEG 硬件编码，函数名必须以手册为准，代码里留了占位注释）。
- 判断依据：OpenMV/CanMV 的 image 对象常见 `compress()`/`save()`；K230 固件是否保留 `compress`、以及是否要求 RGB565 输入，需要手册确认。
- **验证方法**：脚本打印 `[自检] JPEG 编码候选：...` 且首帧大小在 15—40 KB；把 `/sdcard/test.jpg` 拷到电脑能正常打开。

### #3 分辨率 / 像素格式

- 现在代码的**候选 A**：`set_framesize(width=640, height=360)`（K230 例程风格 kwargs）；
- **候选 B**：`set_framesize(Sensor.VGA/QVGA/HD)`（OpenMV 风格常量）；
- 需要确认：640×360 这种**非标准尺寸**是否支持（不支持就用 640×480，H5 是 16:9 会留黑边，可接受）；`RGB565` 常量名是否正确；是否要改成 `GRAYSCALE`（黑白更省带宽）。
- **验证方法**：自检打印的 `size()` 与设置一致；`/api/camera/status` 里 `width/height` 对得上。

### #4 network / WiFi 写法

- 现在代码的**候选 A**：`network.WLAN(network.STA_IF)` → `active(True)` → `connect(ssid, pwd)` → 轮询 `isconnected()`；
- **候选 B**：只有 `network.LAN()`（网口/某些板子）；**候选 C**：没有 `network` 模块（系统层已联网，脚本跳过联网直接发 socket）。
- 需要确认：K230 固件是否提供 `WLAN`、`STA_IF` 常量、`ifconfig()`；WiFi 是否必须先在系统里配（`wpa_supplicant`）；`connect()` 是否需要第三个参数（security）。
- **验证方法**：串口打印 `[wifi] 已连接，ifconfig = ('192.168.x.x', ...)`；电脑 `ping` 这个 IP 能通。

### #5 socket 细节

- 需要确认：`socket.socket()` 是否必须带 `AF_INET/SOCK_STREAM` 参数；是否有 `settimeout`、`send` 返回“已发字节数”的语义是否成立；有没有 `sendall`；是否只支持 `usocket`；能不能用 `getaddrinfo`（本脚本只用 IP，不依赖 DNS）。
- **验证方法**：脚本能打印 `[push] 首帧已送达：HTTP/1.1 200 OK`；服务端日志出现 `POST /api/device/frame`。

### #6 MJPEG 服务的并发能力（只影响方式 B）

- 现在实现是**单线程**（一次服务一个客户端），H5 占流时 `/snapshot.jpg` 打不开；
- 需要确认：CanMV K230 固件是否支持 `_thread`（以及 `sensor.snapshot()` 能否跨线程调用）、`accept()`/`listen()` 的参数写法、`setsockopt(SO_REUSEADDR)` 是否可用。
- 若支持 `_thread`：可改成“采集线程 + 每客户端一个服务线程”（代码里没写，避免跨线程调相机的风险）；
- **验证方法**：浏览器开 `/stream` 时，另一台设备访问 `/snapshot.jpg` 是否能出图。

---

## 10. 其他说明 / 下一步

- **设计口径**：图传是“低码率监看、默认关闭、仅演示与远程接管”，识别仍在车端 K230 完成、不上传原始视频。联调时脚本一跑就在推流；正式演示前记得按需停掉脚本。
- **检测框上报（可选）**：服务端已支持 `POST /api/device/detection`（JSON：`code/disease/confidence/box/ptz/ts`），K230 跑完 YOLO 后可以把结果发上去，H5 会把框叠到最新帧上。本目录脚本**只做图传**，不碰 YOLO。
- **方式 C（RTSP/H.264）**：要 720p/15fps/1.2 Mbps 才需要，K230 端要 VENC 编码 + RTSP 服务，工作量明显大于本目录两个脚本，暂不提供。
- **开机自启**：把脚本改名成板子固件的启动脚本（如 `main.py`）可能可以开机自动运行，**具体以固件手册为准**（未核实，不建议演示前临时改）。
- **联调顺序建议**：先 4.4 电脑端自测 → 再 5.x 方式 A 跑通 → 需要时再试方式 B → 最后合成到 YOLO 主程序里。

---

## 附：接口速查（服务端已实现，供对照）

### `POST /api/device/frame`（方式 A 核心）

| 项 | 值 |
|---|---|
| Body | 单帧 JPEG **原始字节**（不是 multipart），≤ 3 MB |
| 必需请求头 | `Content-Type: image/jpeg`、`Content-Length` |
| 可选请求头 | `X-Device-Token`（服务端开了才需要）、`X-Device-Id`、`X-Frame-Ts`、`X-Width`、`X-Height`、`X-Seq`、`X-Ptz-Pan`、`X-Ptz-Pitch` |
| 成功响应 | `{"ok":true,"seq":N,"server_ts":"...","fps":3.0,"kbps":420.5,"source":{...}}` |
| 常见错误 | `401 bad_device_token`、`400 bad_frame`（不是 JPEG/空 body）、`413 body_too_large`（>3 MB） |

### 服务端（电脑端）相关接口 / 参数

| 项 | 说明 |
|---|---|
| `GET /api/camera/status` | `source.mode`（sim/push/mjpeg/rtsp）、`online`（3 秒内有帧）、`fps`、`kbps`、`width/height` |
| `GET /api/camera/latest.jpg` | 最新一帧（无真实帧时返回演示图，响应头 `X-Source: k230/sim`） |
| `GET /api/camera/stream.mjpg` | H5 用的 MJPEG 流（由服务端帧缓存生成，方式 A 下 H5 看这个） |
| `--host 0.0.0.0` | **K230 联调必须加**（默认 127.0.0.1 只允许本机） |
| `--port 8765` | 端口，改了两边一起改 |
| `--device-token <token>` | 设备上行鉴权，K230 脚本填同一串 |
| `--camera-mode mjpeg --camera-url <K230 流地址>` | 方式 B 直连（H5 直接看 K230 的流） |

> 完整契约见 `../../docs/K230_实时图传_API.md`；服务端实现/自测记录见 `./server/README.md`。
