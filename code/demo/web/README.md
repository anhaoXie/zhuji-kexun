# 《株迹可循》手机端 H5 原型（微信小程序风格）

面向《株迹可循》项目。
纯静态原生 HTML/CSS/JS，**无 CDN、无外网依赖、无 npm 构建**，`file://` 双击即可完整显示。

- 视口：390 × 844 CSS px（iPhone 14 逻辑分辨率），整屏无滚动条
- 视觉：微信小程序风格（白色状态栏/导航栏、微信胶囊、微信绿 `#07C160`、白卡片、深绿 hero、底部 4 tab、Home Indicator）
- 4 个 tab：监控 / 控制 / 图传 / 报表

## 1. 打开方式

### 方式 A：直接双击（离线版，使用内置 mock）

双击 `web/index.html`，或浏览器打开：

```text
file:///..././web/index.html
```

`file://` 下不发起任何网络请求，数据固定为内置 mock（字段与 `docs/api_contract.md` 一致），保证断网、评委机也能完整显示。图传页图片走相对路径 `../assets/cam_plant.jpg`，加载失败时自动切换为内联 SVG 占位并保持布局。

### 方式 B：与本地服务联调（推荐）

由 `server/app.py` 同时托管静态页与接口：

```bash
cd .
python server/app.py                 # 默认 127.0.0.1:8765
```

浏览器打开 `http://127.0.0.1:8765/`。此时页面同源请求：

- `GET /api/state`（首屏状态）
- `GET /api/report?batch=B-20261104-01`（报表）
- `GET /api/video/info`（相机/码率/云台/检测框）
- `WS /ws`（`state` 增量、`ack`、`event`、`report_ready`）

任何请求失败都会**静默降级**到内置 mock，不弹错误框。`file://` 与 `?freeze=1` 下不发起请求（保证截图数值固定）。

## 2. 截图钩子

| URL 参数 | 作用 |
|---|---|
| `?shot=monitor` | 直达监控 tab |
| `?shot=control` | 直达控制 tab |
| `?shot=video` | 直达图传 tab |
| `?shot=report` | 直达报表 tab |
| `?freeze=1` | 停掉所有动画/定时刷新；图传时间戳固定 `2026-11-04 09:24:31`；控制页固定为远程演示态（摇杆位置、`v=0.30 m/s  w=-0.20 rad/s` 固定，不弹确认框） |

页面渲染完成后设置 `window.__READY__ = true`；同时 `window.__CONSOLE_ERRORS__` 收集页面 JS 错误，供截图脚本判断控制台是否干净。

使用仓库根目录 `tools/shoot.mjs`（无依赖 CDP 截图）示例：

```powershell
# 在仓库根目录执行；把 $PWD 替换为 code/demo 的绝对路径（含中文时先做 URL 编码）
$base = "file:///<repo>/code/demo/web/index.html"
node tools/shoot.mjs --url "$base?shot=monitor&freeze=1" --out shots/monitor.png --width 390 --height 844 --scale 3
node tools/shoot.mjs --url "$base?shot=control&freeze=1" --out shots/control.png
node tools/shoot.mjs --url "$base?shot=video&freeze=1"   --out shots/video.png
node tools/shoot.mjs --url "$base?shot=report&freeze=1"  --out shots/report.png
```

> 提示：Windows PowerShell 里把 `$base` 拼成完整 URL 后再传给脚本，避免 `$base?shot` 被当成变量名。

## 3. 目录说明

```text
web/
  index.html        单页结构：状态栏 / 导航栏 / 4 个 page / tabbar / 弹窗 / toast
  css/app.css       全部样式（不含任何外部字体/图片依赖）
  js/app.js         内置 mock、四个页面渲染、交互、fetch/WebSocket 降级、截图钩子
  README.md         本文件
  ../assets/cam_plant.jpg   车端俯视相机画面（1280×720，由 项目负责人 提供）
```

## 4. 页面与交互速览

- **监控**：深绿 hero（1号棚·巡检中、台位 7/16、电量环 78%、4 个状态 chip）、本棚进度 66%（42/64）、实时航线 SVG（4 床 × 4 台位、5 过道、S 形折返、20 停靠位、已走/规划/当前）、最近结果 3 条、待复核条（点“去处理”跳报表并高亮）、暂停巡检/返航、右下角悬浮急停（确认弹窗）。
- **控制**：巡检/远程模式分段切换（切远程有确认弹窗）、240px 大摇杆（拖动发送 `v/w`，松手自动 `stop`；可切“按键”辅助方向键）、速度上限滑杆 0.1—0.8 m/s、停止按钮、全宽红色急停（点击锁定，长按 2 秒复位）、安全卡（2.4G 遥控器优先 / 失联 500 ms 停车 / 急停硬件优先）、图传监看开关、右上角实时遥测卡。默认巡检模式，摇杆锁定并提示；远程模式下才可操控。
- **图传**：车端相机画面 + 2 个百分比定位检测框（主框 `叶斑病 0.87`、次框 `叶斑病 0.63 待复核`）、`● LIVE`、`720p 15fps 1.2 Mbps`、固定/跳动时间戳、云台俯仰 78° · 台位 B2-03 · 株 2-1、十字准星；截图/录制/云台 ±/全屏为演示 toast；本帧检测、云台预设（俯视 78° / 斜视 30° / 复位 0°）、相机与链路、图传说明。
- **报表**：批次 B-20261104-01（1号棚 09:20—09:26）、KPI 2×2（巡检 64 株 / 检出 9 株 / 待复核 3 株 / 找回率 95.3%）、有结论率 84.4% · 建议采纳 6/9、六状态横向条形图（共 9 株）、病害记录 3 条、待复核 3 条（确认/改判点击有反馈）、导出 CSV / 生成 PDF（演示 toast）、批次归档页脚。
- 所有页面切换 150 ms 淡入；`freeze=1` 时禁用动画。

## 5. 自测结论（2026-11-04）

用 Chrome headless（`tools/shoot.mjs`，390×844@3x）与 CDP 检查：

- 4 个 `?shot=...&freeze=1` 页面均 `window.__READY__ === true`，截图无白屏；
- 控制台无 JS 报错（`window.__CONSOLE_ERRORS__` 为空）；
- 4 页 `page.scrollHeight === clientHeight`，无纵向/横向溢出，无滚动条；
- 无服务 + `file://` 下 4 页完整显示 mock；有服务（临时 8799 服务模拟）时 `/api/*` 数据正确接管，`/ws` 不可用时静默降级；
- 控制页远程确认弹窗、摇杆拖动/松手、急停与长按复位、图传开关、图传云台预设、报表确认/改判/导出、监控暂停与“去处理”跳转均实测通过。

## 6. 已知限制（演示版口径）

- 图传为 **单帧图片 + 检测框叠加**，不是真实视频流；时间戳在非 freeze 下按秒递进（模拟）。
- “截图 / 录制 / 云台 ± / 全屏 / 导出 CSV / 生成 PDF / 批次切换”均为演示 toast；接入真实服务时替换为接口调用。
- 控制指令仅在通过 HTTP 打开且 `/ws` 可用时真正下发；`file://` 下摇杆/按钮只做本地交互演示。
- mock 检测框坐标按 `assets/cam_plant.jpg` 画面微调（字段结构与 `api_contract.md` 一致）；接服务端后以 `/api/video/info` 返回值为准。
- 无外网字体/图标依赖；图标与图表均为内联 SVG，中文回退到 `Microsoft YaHei` / `PingFang SC`。

---

## 真实图传（K230）说明（2026-11-04 追加）

- 新增 `js/camera_live.js`：http(s) 打开时每 1.5 s 查 `/api/camera/status`；
  - `push/rtsp` 在线 → `#camImg` 切到 `/api/camera/stream.mjpg`，角标「K230 实拍」；
  - `mjpeg` 在线 → 直接加载 K230 的 `stream_url`，角标「K230 直连」；
  - 离线 → 回退 `assets/cam_plant.jpg` 演示画面；
  - `?freeze=1` 截图模式：隐藏源角标、不发请求，保证界面设计图 与之前逐像素一致。
- `js/app.js` 在非 freeze 的 http 模式下每 1.2 s 轮询 `/api/video/info`，同步真实 fps/码率/检测框。
- 服务端启动方式见 `../docs/K230_实时图传_API.md`；无硬件可用 `tools/device_simulator.py` 联调。
