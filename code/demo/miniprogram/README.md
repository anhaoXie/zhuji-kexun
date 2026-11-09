# 《株迹可循》手机端 · 微信小程序骨架

> 一株一档的温室巡检机器人 · 演示工程
> 对应文档：`../docs/BUILD_SPEC.md`（页面与文案规范）、`../docs/api_contract.md`（接口契约）
> 本目录由 app-miniprogram 独占维护；H5 原型在 `../web/`，本地服务在 `../server/`。

这是一个**可直接导入微信开发者工具编译**的小程序工程骨架：4 个 tab（监控 / 控制 / 图传 / 报表）、
一套 `utils/api.js` 接口层（含 mock 兜底）、一套 `utils/ble.js` BLE 控车流程骨架。
不含真实视频流与真实硬件通信——这两部分在 README 末尾列出后续 TODO。

---

## 1. 目录结构

```
miniprogram/
├── app.js                       # 全局 API 地址、WebSocket 连接/重连、状态广播、mock 演示兜底
├── app.json                     # 4 个 tab、导航栏白底黑字、tabBar 选中色 #07C160
├── app.wxss                     # 全局样式：微信绿/白卡片/深绿 hero/标签/按钮
├── project.config.json          # 测试号 touristappid、libVersion 3.x、关闭域名校验等
├── sitemap.json
├── assets/
│   ├── cam_plant.jpg            # 图传页本地兜底静帧（来自 ../../assets/cam_plant.jpg）
│   └── tabbar/                  # 8 个 tabBar 图标（81×81，普通灰/选中绿）
├── pages/
│   ├── monitor/                 # 监控：hero、进度、canvas 航线、最近结果、待复核、急停
│   ├── control/                 # 控制：模式切换、大摇杆、速度滑杆、点动、图传开关、急停长按复位
│   ├── video/                   # 图传：image 静帧 + 检测框、LIVE、时间戳、码率、说明
│   └── report/                  # 报表：KPI、六状态条形、病害记录、待复核、导出
└── utils/
    ├── api.js                   # GET 封装 + mock（字段与 api_contract 一致）
    ├── ble.js                   # BLE 控车骨架（仅真机；UUID/帧编码 TODO）
    └── format.js                # 六状态映射、时间/置信度格式化
```

接口与页面一一对应：

| 页面 | 数据来源 | 无服务端时 |
|---|---|---|
| 监控 | `GET /api/state` + `WS state` | `utils/api.js` 的 `MOCK_STATE`，并每秒缓慢推进 |
| 控制 | 同上（`robot.mode` 决定是否可操控） | 本地演示状态 + 指令写入本地状态 |
| 图传 | `GET /api/video/info` + `/assets/cam_plant.jpg` | `MOCK_VIDEO_INFO` + 本地静帧 |
| 报表 | `GET /api/report?batch=B-20261104-01` | `MOCK_REPORT` |

---

## 2. 导入步骤（约 2 分钟）

1. 安装最新稳定版**微信开发者工具**（Windows / macOS 均可）。
2. 打开工具 → **导入项目**：
   - **目录**：选择本目录 `./miniprogram`（注意不是仓库根目录）；
   - **AppID**：选择「**测试号**」。`project.config.json` 里已写 `touristappid`，用测试号可以直接编译；
   - 项目名称随意（默认 `zhuji-kexun`）。
3. 进入项目后：**详情 → 本地设置**，勾选
   「**不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书**」。
   （服务端是 `http://127.0.0.1:8765` 的本地 HTTP，不勾选会被开发者工具拦截。）
4. 模拟器机型建议选 **iPhone 14（390×844）**，缩放 100%，与设计说明截图口径一致。
5. 点击「编译」。首屏即「监控」页；即使**没有启动 Python 服务端**，也会自动使用 mock 数据完整显示，
   并在约 5 s 推进 1 株，便于演示。
6. 右上角「预览」生成二维码，用手机微信扫码即可真机打开（需手机与电脑同一局域网，见第 4 节）。

> `project.config.json` 的 `libVersion` 目前写 `3.0.0`。如果本机开发者工具未内置该版本，
> 在 **详情 → 本地设置 → 调试基础库** 里选任意一个已安装的 **3.x** 版本即可（工程只用到 Canvas 2D、
> `wx.getWindowInfo`、`movable-view`、`wx.connectSocket` 等基础能力，3.x 都支持）。

---

## 3. 修改 API 地址

默认 `http://127.0.0.1:8765`（由 `server/app.py` 提供）。三种改法，任选其一：

1. **改代码（最直接）**：`app.js` 顶部

   ```js
   var DEFAULT_API_BASE = 'http://127.0.0.1:8765';
   ```

2. **运行时改（推荐，不用重编译）**：开发者工具底部 **Console** 执行

   ```js
   getApp().setApiBase('http://192.168.1.20:8765')
   ```

   会写入 `wx.setStorageSync('zhu_ji_api_base')`，下次启动仍生效；WebSocket 地址会自动从
   `http://...` 推导为 `ws://.../ws`，并立即重连。

3. **清空覆盖**：在工具 **Storage** 面板删除 `zhu_ji_api_base` 键，即回到 `DEFAULT_API_BASE`。

> ⚠️ **真机不能用 `127.0.0.1`**：在手机上它指向手机自己。真机调试请把地址改成**电脑的局域网 IPv4**
> （如 `http://192.168.1.20:8765`），并确认手机与电脑同一 Wi-Fi、电脑防火墙放行 8765 端口、
> 服务端监听 `0.0.0.0`（`python server/app.py` 默认即可，如不行加 `--host 0.0.0.0` 视服务端实现）。

---

## 4. 数据、mock 与降级行为

- `utils/api.js` 里 `MOCK_STATE / MOCK_REPORT / MOCK_VIDEO_INFO` 的字段与 `../docs/api_contract.md` **完全一致**；
  行数按 `BUILD_SPEC` 的演示口径补足（最近结果 3 条、待复核 3 条、病害记录 3 条）。
- 请求失败**静默降级**，不弹错误框；WebSocket 断线按 1s→2s→4s→…→15s 指数退避重连，连上后自动 `hello` 并每 20s `ping`。
- 服务端不可用时，`app.js` 会复制一份 mock 并每秒推进（温度小波动、约 5 s 前进 1 株、电量缓慢下降），
  真实 `state` 一到即停止 mock。
- 图传页 `<image>` 默认取 `apiBase + /assets/cam_plant.jpg`，加载失败自动切到**本地** `assets/cam_plant.jpg`，
  所以断网/没起服务时也能看到底图与检测框。

---

## 5. 开发者工具 vs 真机：能力差异

| 能力 | 微信开发者工具 | 真机 | 本工程处理 |
|---|---|---|---|
| `wx.request` 访问 `127.0.0.1` | 可（需关域名校验） | ❌ 指向手机自身 | 用 `setApiBase` 切局域网 IP |
| 域名校验 / HTTPS | 可关掉 | 正式版必须 **https/wss + 已备案域名**白名单 | 仅本地演示，README 注明 |
| BLE（`openBluetoothAdapter` 等） | ❌ 不支持 | ✅ 支持（需手机蓝牙；Android 可能还要定位权限） | `utils/ble.js` 骨架 + 控制页提示；工具内点击会 toast 引导真机 |
| `live-player` / HLS 直播 | 部分支持，仍受类目/域名限制 | ✅ 但需类目资质 + 播放域名 | 本版**不使用** `live-player`，只用 `<image>` 静帧 |
| Canvas 2D（航线绘制） | ✅ | ✅（基础库 2.9+） | 监控页航线用 `type="2d"` canvas；旧基础库下退化为 CSS 网格背景 |
| `<image>` 本地包内图片 | ✅ | ✅ | tabBar 图标、图传兜底静帧都放包内 |
| 远程控车真实链路 | 无硬件 | 需 ESP32-C3 + 主控联调 | 当前走 `ws` 仿真；BLE 只留骨架 |

---

## 6. 图传（视频监看）三条技术路线

> 现状：Tab3 用 `<image>` 静帧 + 百分比检测框演示。真实视频流**不在本版范围**，以下为真机阶段选型。

### 路线 A：HLS + `live-player`（标准做法）

- 车端/PC 侧用 ffmpeg 把 K230 的 RTSP/MJPEG 转 HLS（fMP4，`-hls_time 1` 低延迟），
  小程序 `<live-player src="https://your.domain/live.m3u8" mode="live" autoplay>`。
- **门槛**：
  - `live-player` 需要小程序**类目资质**（如「文娱-视频」等直播类目；个人主体不可用），
    审核时可能要求《信息网络传播视听节目许可证》等资质材料；
  - 播放域名必须 **ICP 备案 + HTTPS 证书**，并在「开发管理 → 开发设置 → 服务器域名」的
    **live-player 合法域名**中登记；
  - 视频流上行/转码需要自有服务器或云直播服务。

### 路线 B：低码率 MJPEG 逐帧转封装（推荐用于演示 / 远程接管）

- 后端（`server/` 或独立网关）把 K230 的 MJPEG 帧按固定节奏（如 15 fps / 1.2 Mbps）通过
  **WebSocket 二进制**下发，小程序端用 `wx.createImage` + `canvas.drawImage` 逐帧绘制；
  检测框坐标（0—1）与帧同源，天然对齐，可直接复用本页的百分比定位逻辑。
- **优点**：不需要 `live-player` 类目资质与直播域名，码率/分辨率/帧率完全可控，弱网可丢帧降级；
  与 `/api/video/info` 的 boxes 同一时间戳，复核标注最准。
- **代价**：需要自己实现帧协议、画布渲染与背压处理；音频没有（本场景也不需要）。

### 路线 C：WebRTC（低延时远程接管）

- 车端/网关用 WebRTC 推流（mediamtx / SRS / go2rtc 等），小程序端用 `live-pusher/live-player` 的
  RTC 模式，或 `web-view` 嵌入第三方 WebRTC 页面。
- **优点**：端到端延时 < 500 ms，适合远程接管。
- **门槛**：RTC 模式同样需要类目资质；自建信令/房间；`web-view` 方案需要**业务域名**（备案 + 校验文件）。

**建议顺序**：演示/截图先用本骨架的“静帧 + 检测框”；现场低码率监看优先 **B**；
若后续需要“实时视频”，再评估 A（最稳）或 C（最低延时），并提前准备主体资质与备案域名。

---

## 7. BLE 控车（仅真机）

`utils/ble.js` 已按微信 BLE API 写好流程骨架，**全部为 TODO 占位**，不接真实硬件：

```
wx.openBluetoothAdapter
  → wx.startBluetoothDevicesDiscovery（按广播名前缀 ZhuJi-* 过滤）
  → wx.onBluetoothDeviceFound
  → wx.createBLEConnection
  → wx.getBLEDeviceServices → wx.getBLEDeviceCharacteristics
  → wx.notifyBLECharacteristicValueChange（0x30 TEL / 0x51 BSTATE）
  → wx.writeBLECharacteristicValue（0x40 PCMD：v/w/seq 帧）
```

待补：`SERVICE_UUID`、`CHAR_WRITE_UUID`、`CHAR_NOTIFY_UUID`、`encodePcmd()`、`parseTel()`、
断链/失联 500 ms 停车兜底、与 2.4G 遥控器的优先级仲裁。控制页有「BLE 连接（骨架）」按钮，
在开发者工具里点击会提示“请用真机预览”。

---

## 8. 与接口契约的已知差异 / 限制

1. **台位口径**：`BUILD_SPEC` 的“台位 7/16”是 4 床×4 台位 = 16 台位；
   `/api/state` 的 `stop_total = 20` 是“停靠位”口径（每床两侧各停一次）。页面显示 16 口径。
2. **暂停巡检 / 返航 / 截图 / 录制 / 云台 / 导出**：契约暂无对应指令，按钮为演示 toast，
   代码中有 `TODO` 标注，待服务端扩展消息类型后接入。
3. **后退按钮**按 `v = -speed` 下发，而契约规定 `v ∈ 0—0.8`，联调时需服务端放开负 `v` 或改成档位字段。
4. **mock 行数**比契约示例多（3 条待复核/3 条记录），是为与 `BUILD_SPEC` 的演示数字对齐，字段结构不变。
5. 本工程**只做静态校验**（JSON、JS 语法、WXML 标签闭合、页面/资源引用完整性），
   **未在微信开发者工具/真机实际编译运行**（本机未安装开发者工具），首次导入如遇工具提示按第 2 节处理。

---

## 9. 后续接入 K230 / 真硬的 TODO

- [ ] 视频：按第 6 节选定路线，实现帧协议（MJPEG over WebSocket 最省资质门槛），替换 Tab3 的 `<image>`；
- [ ] 检测框：把车端 boxes 的 `ts` 与视频帧 PTS 对齐，支持多目标与跟踪 ID，避免框“跳帧”；
- [ ] 指令：补充暂停/返航/云台/截图录制到 `api_contract` 与 `app.js` 指令层；
- [ ] BLE：补 UUID 与 `0x40 PCMD` / `0x30 TEL` / `0x51 BSTATE` 编解码，做真机联调；
- [ ] 安全：真机接入后验证「500 ms 失联自动停车」「急停后拒绝控制」「2.4G 遥控优先级」三条硬约束；
- [ ] 域名与资质：准备企业主体、ICP 备案域名、HTTPS 证书；按需申请直播类目与 `live-player`/`request`/`socket` 合法域名；
- [ ] 真机验收：iOS/Android 各一台，验证 4 个 tab、BLE 扫描、图传开关、急停长按复位；
- [ ] 截图：设计说明截图仍以 `web/` 的 390×844 H5 为准，小程序用于“可导入源码”的工程交付。

---

## 真实图传（K230）说明（2026-11-04 追加）

- `pages/video/video.js` 新增 `_pollCamera()`：每 1.5 s 请求 `/api/camera/status`；
  - `push/rtsp` 在线 → `camUrl` 改为 `<apiBase>/api/camera/latest.jpg?t=...`（微信 `<image>` 不能播 MJPEG 流，用快照轮询，约 1—2 fps）；
  - `mjpeg` 在线 → 角标「K230 直连」，同样用 latest.jpg（服务端可代理时再换）；
  - 离线 → 回退本地 `assets/cam_plant.jpg`，角标「演示画面」。
- 顶部新增图传源角标；`_applyVideoInfo` 仍负责检测框/云台/时间戳。
- 真机联调：`app.js` 顶部 `DEFAULT_API_BASE` 改成电脑局域网 IP（如 `http://192.168.1.50:8765`），开发者工具/体验版勾“不校验合法域名”；K230 与手机/电脑须在同一 2.4G 局域网。
