# server/ · 《株迹可循》本地演示服务（v1）

> 《株迹可循》项目。Python 3.12 标准库实现，**无第三方依赖**。
> 契约：[`../docs/api_contract.md`](../docs/api_contract.md)；构建规范：[`../docs/BUILD_SPEC.md`](../docs/BUILD_SPEC.md)。
> 目录归属：`server/` 由 app-server 独占写入；`web/`、`assets/`、`docs/` 不在本目录内。

---

## 1. 功能清单

| 能力 | 说明 |
|---|---|
| 静态托管 | `/` → `../web/index.html`，其余静态文件相对 `../web/`；`/assets/*` → `../assets/`（只读） |
| 设备状态 | `GET /api/state`：设备/机器人/批次/最近结果（3 条）/待复核（3 条） |
| 批次报表 | `GET /api/report`：KPI、六状态分布、病害记录、待复核、页脚 |
| 图传状态 | `GET /api/video/info`：相机参数、码率、帧率、云台、2 个检测框 |
| 报表导出 | `GET /api/export/csv`：UTF-8 BOM，文件名 `株迹可循_批次_B-20261104-01.csv` |
| 探活 | `GET /api/health`：版本 / 模式 / WS 连接数（联调用，非契约接口） |
| WebSocket | `/ws`：标准库手写握手 + 帧编解码；每 500 ms 推送 `state`；ack/event/pong/report_ready |
| 巡检仿真 | 20 停靠位、35.8 m、0.5 m/s、每站 2.4 s；第 4/7/9/12/14/16/18 站触发检测；42→64 株推进到完成 |
| 安全控制 | 非 remote 拒 move、estop 后拒绝控制、remote 500 ms 无新指令自动停车 |
| live 预留 | `--live host:port`：TCP 连 ESP32-C3 + `0x30/0x31/0x40/0x41/0x50/0x51` 帧解析骨架（本期降级仿真） |

---

## 2. 快速启动

```bash
# 在本机任意目录执行均可（内部按 __file__ 定位 ../web、../assets）
python ./server/app.py
# → 浏览器打开 http://127.0.0.1:8765/
```

### 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `--host` | `127.0.0.1` | 监听地址（本机演示建议保持默认） |
| `--port` | `8765` | 监听端口；被占用时换一个（如 8799）并同步前端 API 地址 |
| `--fresh` | 关 | 从第 1/20 停靠位、0/64 株开始跑**完整一圈**；默认从 66% 演示检查点开始 |
| `--live HOST:PORT` | 关 | 预留连接 ESP32-C3（如 `192.168.4.1:8266`）；本期自动降级仿真并打印提示 |
| `--log-level` | `INFO` | `DEBUG/INFO/WARNING/ERROR` |
| `--version` | — | 打印版本 |

### 启动日志示例（实测）

```
[INFO] 《株迹可循》本地演示服务 v1.0.0 已启动
[INFO]   页面:   http://127.0.0.1:8799/
[INFO]   接口:   /api/state  /api/report  /api/video/info  /api/export/csv  /api/health
[INFO]   长连接: ws://127.0.0.1:8799/ws
[INFO]   仿真:   从演示检查点开始（第 7/20 停靠位、42/64 株、66%），推进到完成
```

> `web/index.html` 尚未产出时，`/` 返回 200 + 占位说明页（列出全部接口），**不会 404**；
> `web/` 就绪后自动改为托管真实页面，无需重启（每次请求实时读取文件）。

---

## 3. 目录

```
server/
  app.py               # 全部服务实现（入口，约 1.1k 行）
  README.md            # 本文件
  tests/
    ws_smoke.js        # Node 24 全局 WebSocket 冒烟测试（0 依赖）
```

静态资源查找顺序：`/assets/*` → `../assets/`；其它路径 → `../web/`；两者都做了路径穿越防护（`../` 越界返回 404）。

---

## 4. HTTP 接口速查

### 4.1 `GET /api/state`

字段与 `docs/api_contract.md` §1 完全一致。实测初始检查点：

```json
{
  "ts": 1793,
  "device": {"name": "株迹可循-01", "fw": "v1.0.0", "link": "wifi", "rssi": -52, "latency_ms": 28},
  "robot": {
    "mode": "patrol", "mode_text": "巡检中",
    "battery": 78, "voltage": 11.6, "current": 0.82, "temp": 32,
    "speed": 0.5, "x": 3.24, "y": 1.85, "heading": 90,
    "stop_index": 7, "stop_total": 20, "bed": "B2", "plot": "B2-03",
    "progress": 0.66, "plants_done": 42, "plants_total": 64,
    "distance_m": 18.6, "detected": 6
  },
  "batch": {"id": "B-20261104-01", "greenhouse": "1号棚",
            "start": "2026-11-04T09:20:00+08:00", "end": null, "status": "running"},
  "recent": [ {"code": "1棚-3行-B2台-2位-1株", "disease": "叶斑病", "confidence": 0.91,
               "state": "新发", "time": "09:24", "suggest": "分区标记 + 加密复查"}, "…共 3 条" ],
  "review": [ {"code": "1棚-2行-A1台-1位-1株", "disease": "叶斑病", "confidence": 0.63,
               "state": "待复核"}, "…共 3 条" ]
}
```

* `robot.mode` 枚举：`patrol`（巡检中）/ `remote`（远程模式）/ `estop`（已急停）/ `idle`（待命/完成）。
* 仿真推进后：`plants_done` 42→64、`progress` →1.0、`detected` 6→9、`distance_m` →35.8；完成后
  `mode=idle`、`batch.status=done`、`batch.end` 写入完成时刻。
* 掉头位（每床第 5 个停靠位）没有台位信息，`bed/plot` 显示最近一个台位，避免 UI 出现“回路”。

### 4.2 `GET /api/report?batch=B-20261104-01`

返回**归档批次**固定数据（严格按契约数值，与仿真是否跑完无关）：

| 字段 | 值 |
|---|---|
| KPI | 巡检 64 株 · 检出 9 株 · 待复核 3 株 · 找回率 95.3% |
| 副指标 | 有结论率 84.4% · 建议采纳 6/9 |
| 六状态 | 新发 2、持续 3、加重 1、好转 1、已处理 1、疑似误报 1（共 9） |
| records | 3 行（`1棚-3行-B2台-2位-1株` 新发 0.91 / `1棚-2行-B2台-2位-1株` 加重 0.79 / `1棚-3行-B1台-1位-2株` 已处理 0.86） |
| review | 3 条：`1棚-2行-A1台-1位-1株` 叶斑病 0.63（契约示例）· 白粉病 0.64 · 叶斑病 0.69 |
| batch | `id=B-20261104-01`、`time=2026-11-04 09:20—09:26`、`status=done` |

传入未知批次返回 `404 {"error":"batch_not_found","batch":"..."}`；不传 `batch` 返回默认批次。

### 4.3 `GET /api/video/info`

```json
{"enabled": false, "camera": "K230 · 顶视", "width": 1280, "height": 720,
 "bitrate": "1.2 Mbps", "fps": 15, "ptz": {"pan": 0, "pitch": 78},
 "ts": "2026-11-04 09:24:31",
 "boxes": [{"x":0.22,"y":0.30,"w":0.26,"h":0.34,"label":"叶斑病","confidence":0.87,"status":"high"},
           {"x":0.58,"y":0.52,"w":0.18,"h":0.22,"label":"叶斑病","confidence":0.63,"status":"review"}]}
```

`ts` 随批次时钟每秒推进；`enabled` 由 WebSocket `video` 指令切换（仅改状态，不真的推流）。

### 4.4 `GET /api/export/csv`

* 响应头：`Content-Type: text/csv; charset=utf-8`；`Content-Disposition: attachment; filename="zhujikexun_B-20261104-01.csv"; filename*=UTF-8''%E6%A0%AA…`（中文文件名 `株迹可循_批次_B-20261104-01.csv`）。
* 文件前 3 字节为 UTF-8 BOM：`EF BB BF`。
* 列：`株位码, 病害, 置信度, 六状态, 建议, 时间, 复核状态`，9 行全量；`复核状态` 随 WS 复核操作变为 `已确认/已改判`。

### 4.5 `GET /api/health`（附加，联调探活）

```json
{"ok": true, "service": "株迹可循本地演示服务", "version": "v1.0.0",
 "mode": "patrol", "websocket_clients": 0, "batch": "B-20261104-01", "uptime_s": 17}
```

### 4.6 静态资源

* `GET /` → `../web/index.html`（缺失时 200 占位页）；`GET /js/app.js` 等按相对路径取 `../web/`。
* `GET /assets/cam_plant.jpg` → `image/jpeg`，实测 63,526 bytes。
* 路径穿越（`/../docs/...`）→ 404；API 响应带 `Access-Control-Allow-Origin: *`，方便 `file://` 页面直接联调。

---

## 5. WebSocket `/ws`

### 5.1 连接与帧

* 标准 RFC 6455 握手（`Sec-WebSocket-Accept = base64(sha1(key + GUID))`）。
* 文本帧承载 JSON；支持分片续帧、`ping`/`pong` 控制帧、`close`（服务端回 close 并清理连接）。
* 帧上限 1 MiB；服务端出站帧不加掩码（符合规范）。
* 连上后立即收到一帧 `state` 和一条 `event`（“本地服务已连接”）。
* 服务端每 **500 ms** 推送一次 `state`；**指令生效后额外立即推一次**，UI 无需等周期。

### 5.2 客户端 → 服务端

| type | 字段 | 服务端行为 |
|---|---|---|
| `hello` | `client` | 回 `ack.ok=true` |
| `control` | `cmd:"move"|"stop"`, `v`, `w`, `seq` | 仅 remote 接受；`v` 幅值 ≤0.8 m/s（允许负值=后退），`w` ∈ ±1.2 rad/s；回 `ack` |
| `mode` | `mode:"patrol"|"remote"` | 切远程/恢复巡检；回 `ack` |
| `estop` | — | 任何模式立即生效，`mode=estop`、速度清零；回 `ack` |
| `estop_reset` | — | 复位后 `mode=idle`；回 `ack` |
| `video` | `enabled` | 开关图传监看状态；回 `ack` |
| `review` | `code`, `action:"confirm"|"rejudge"` | 复核待复核记录；回 `ack` |
| `ping` | `t` | 回 `pong {t}`（非 ack） |

> 建议所有请求带唯一 `seq`（服务端原样回显；`hello`/`mode`/`estop` 等不带 `seq` 时 ack 里为 `null`）。

### 5.3 服务端 → 客户端

| type | 说明 |
|---|---|
| `state` | 顶层字段与 `/api/state` **完全一致**；同时把同一对象放进 `data` 字段（两种取法都兼容） |
| `ack` | `{type:"ack", seq, ok, error?}` |
| `pong` | `{type:"pong", t}` |
| `event` | `{type:"event", level, text}`，如“到达台位 B2-03”“检出叶斑病 0.91”“远程控制 500 ms 无新指令，已自动停车” |
| `report_ready` | `{type:"report_ready", batch:{id, greenhouse, status:"done"}}`，本棚完成时推送 |

### 5.4 安全规则与错误码

| 场景 | ack |
|---|---|
| 非 remote 模式 `control` | `{ok:false, error:"mode"}` |
| 急停后任何控制（`control`/`mode`） | `{ok:false, error:"estop"}` |
| remote 模式 500 ms 无新控制指令 | 自动 `v=w=0` 并发 `event`（`level=warn`） |
| `cmd` 非法 | `{ok:false, error:"cmd"}` |
| `v/w/mode` 参数非法 | `{ok:false, error:"arg"}` |
| `review` 记录不存在 / 非待复核 / 已处理 | `error:"not_found"` / `"not_review"` / `"handled"` |
| JSON 非法 / 未知 type / 非文本帧 | `error:"bad_json"` / `"unknown_type"` / `"opcode"` |

### 5.5 Node 24 客户端最小示例

```js
const ws = new WebSocket('ws://127.0.0.1:8765/ws');
ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'hello', client: 'h5', seq: 1 })));
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.type === 'state') render(m.robot ?? m.data.robot);
  if (m.type === 'ack') console.log('ack', m.seq, m.ok, m.error);
});
ws.send(JSON.stringify({ type: 'mode', mode: 'remote', seq: 10 }));
ws.send(JSON.stringify({ type: 'control', cmd: 'move', v: 0.3, w: -0.2, seq: 11 }));
// 停发 500 ms 后服务端自动停车；急停：
ws.send(JSON.stringify({ type: 'estop', seq: 12 }));
```

---

## 6. 仿真模型

### 6.1 航线 / 停靠位

* 场地：4 床（行）× 每床 4 台位 + 1 掉头位 = **20 个停靠位/圈**；一圈 **35.8 m**。
* 速度 **0.5 m/s** 巡检、每个停靠位停留 **2.4 s**（接触检测/核对株位）。
* 台位命名顺序 `A1, B2, A2, B1`，使**第 7 站 = 行2 · 台位 B2 · 株位码 `B2-03`**，与契约示例的
  `robot.bed="B2"`、`robot.plot="B2-03"` 对齐。
* `x/y` 单位为米（温室约 7.3 m × 8.4 m），`heading` 角度制（0=东，逆时针）；航向按 S 形折返切换。
* 里程 `distance_m` 按实际移动累计，正常一圈到 35.8 m。

### 6.2 演示检查点（默认）与 `--fresh`

| 模式 | 起始状态 | 结束 |
|---|---|---|
| 默认（推荐演示/截图） | 第 7/20 停靠位、42/64 株（66%）、18.6 m、已检出 6 条、recent 3 条、review 3 条、电量 78% | 推进到 64/64、9 条检出、`mode=idle`、`batch.status=done`、推 `report_ready`（约 70 s） |
| `--fresh` | 第 0 站、0/64 株、0 m | 完整跑一圈：检测在**第 4/7/9/12/14/16/18 站**触发（2+2+1+1+1+1+1 = 9 条），约 2 min |

> 为什么默认从检查点开始：契约 `/api/state` 示例即 66% 那一帧（42/64、stop 7/20、B2-03、detected 6），
> 默认检查点保证服务一启动、页面一打开就是设计口径的画面；`--fresh` 用来演示“从零跑完一圈”的完整链路。

### 6.3 检测记录数据集（9 条，与 `/api/report` 一致）

| # | 株位码 | 病害 | 置信度 | 六状态 | 复核 |
|---|---|---|---|---|---|
| 1 | `1棚-1行-A1台-1位-1株` | 叶斑病 | 0.88 | 新发 | — |
| 2 | `1棚-1行-B2台-2位-1株` | 叶斑病 | 0.69 | 持续 | 待复核 |
| 3 | `1棚-1行-A2台-1位-2株` | 白粉病 | 0.64 | 持续 | 待复核 |
| 4 | `1棚-2行-A1台-1位-1株` | 叶斑病 | 0.63 | 疑似误报 | 待复核 |
| 5 | `1棚-2行-B2台-2位-1株` | 叶斑病 | 0.79 | 加重 | — |
| 6 | `1棚-3行-B2台-2位-1株` | 叶斑病 | 0.91 | 新发 | — |
| 7 | `1棚-2行-B1台-2位-1株` | 叶斑病 | 0.77 | 持续 | — |
| 8 | `1棚-3行-B1台-1位-2株` | 叶斑病 | 0.86 | 已处理 | — |
| 9 | `1棚-4行-A2台-2位-1株` | 白粉病 | 0.81 | 好转 | — |

* 六状态计数 = 新发 2 / 持续 3 / 加重 1 / 好转 1 / 已处理 1 / 疑似误报 1（合计 9）。
* 默认检查点已入库 1–6；继续巡检时第 **9/14/18** 站依次产生 7–9（并推送 `event`）。
* `recent` 始终保留最近 3 条（新的在前）；`review` 为当前仍待复核的 3 条（与报表初始一致）。

### 6.4 进度 / 电量 / 环境量

* 株数：检查点 42 → 64（默认）；`--fresh` 为 0 → 64。`progress = round(plants_done/64, 2)`。
* 电量：78% 起缓慢下降（巡检 0.008 %/s、待机 0.002 %/s）。
* 电压：`voltage = 11.6 - 0.007 × (78 - battery)`（78% ≈ 11.6 V，随电量线性下降）。
* 温度：`32 + 1.1·sin(t·0.04)`（约 30.9–33.1 ℃，落在规范的 30–34）。
* 电流：巡检 ≈0.82 A、远程 `0.30+0.50·|v|`、待机/急停 ≈0.04 A。
* WiFi：`rssi ≈ -52±3 dBm`、`latency_ms ≈ 28±4 ms` 正弦波动。
* 批次时钟：检查点从 `09:24:31` 起走（对齐 `/api/video/info` 示例），`ts` 为设备运行秒数（1793 起）。

### 6.5 完成行为

最后一站停留结束后：`mode=idle`（待命）、`speed/current=0`、`batch.status=done`、`batch.end` 写入
ISO 时间，推送 `report_ready` 与完成 `event`；此后 state 继续每 500 ms 推送（电量/温度仍缓慢变化）。

---

## 7. `--live` 预留（ESP32-C3）

### 7.1 行为

```bash
python server/app.py --live 192.168.4.1:8266
```

* 启动即打印提示：**本期为协议骨架、未实现真实解析，自动降级为仿真**；仿真照常运行，网页演示不受影响。
* 后台线程 `socket.create_connection(timeout=1.5)` 尝试 TCP 连接：
  * 连不上（无硬件/不在同网段）→ 打印 `连接失败 … 已降级为仿真模式`；
  * 连上 → 进入拆帧循环，识别并打印 `TEL/EVENT/PCMD/TASK/BCMD/BSTATE`，**映射逻辑留 TODO**；
  * 遇到坏帧（长度/校验失败）→ 丢弃并打印，降级仿真。
* 不会阻塞主服务启动，也不会影响 API/WS。

### 7.2 帧格式（假设，待与固件对齐）

```
+--------+--------+--------+--------+---------+--------+
| 0xAA   | 0x55   | CMD(1) | LEN(1) | PAYLOAD | SUM8   |
+--------+--------+--------+--------+---------+--------+
```

* 帧头 `AA 55`；`LEN` 为 PAYLOAD 字节数；`SUM8 = (CMD + LEN + ΣPAYLOAD) & 0xFF`。
* 长度/校验不符 → 丢弃整帧并继续找下一帧头（`Esp32Link.consume_frames` 已按此实现并有坏帧计数）。

### 7.3 协议映射表

| CMD | 名称 | 方向 | 用途 | 本期状态 |
|---|---|---|---|---|
| `0x30` | TEL | 车 → PC | 遥测（电量/电压/温度/位姿） | 拆帧 + 打印；`TODO` 映射到 `robot.*` |
| `0x31` | EVENT | 车 → PC | 检测/到达/告警事件 | 拆帧 + 打印；`TODO` 映射到 `recent/review`、`event` |
| `0x40` | PCMD | PC → 车 | 远程/急停/任务控制 | `TODO`：remote 模式下下发 `control/estop` |
| `0x41` | TASK | PC → 车 | 任务卡（批次）下发 | `TODO`：批次开始/参数 |
| `0x50` | BCMD | 车内 | 车端控制 | `TODO`：确认与状态机的对应关系 |
| `0x51` | BSTATE | 车 → PC | 车端状态回传 | 拆帧 + 打印；`TODO` 映射到 `mode/batch` |

> 真机接入步骤：① 确认固件帧格式/校验 ② 把 `on_frame` 里的 TODO 换成字段解析 ③ 用真实数据替换
> `Simulation.tick` 的仿真推进（保留 `StateStore` 同构字段，H5/小程序零改动）。

---

## 8. 与 H5 / 小程序联调

### 8.1 H5（`web/`，app-web 负责）

1. 先启动本服务：`python server/app.py`，浏览器打开 `http://127.0.0.1:8765/`（同源，无需改 H5）。
2. 也可直接 `file://` 打开 `web/index.html`：本服务对 API 放了 `Access-Control-Allow-Origin: *`，
   页面里的 `fetch('http://127.0.0.1:8765/api/state')` 可直连；服务未启动时按规范静默回退内置 mock。
3. **截图建议**：整体截图用 `?shot=monitor|control|video|report&freeze=1`（H5 自带 mock 固定 09:24:31 画面，
   不依赖服务）；需要“真数据动态演示”时去掉 `freeze`，由本服务 500 ms 推 `state`。
4. 控制页联调：`mode` 切 `remote` → 发 `control(move/stop)`；本地演示如从巡检切远程，`event` 会提示“2.4G 遥控器仍最高优先”。
5. 图传页：`/assets/cam_plant.jpg` + `/api/video/info` 的检测框比例坐标；`video` 指令只切换 `enabled` 状态。
6. 报表页：`/api/report` 取静态归档数据；复核按钮发 `review(confirm|rejudge)`，`/api/export/csv` 可下载。

### 8.2 微信小程序（`miniprogram/`，app-miniprogram 负责）

* `app.js` 里 API base 指向 `http://127.0.0.1:8765`；`wx.connectSocket` 指向 `ws://127.0.0.1:8765/ws`（本服务无鉴权）。
* 开发者工具需勾选「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」（本地 http/ws 非备案域名）。
* 真机调试时把 `127.0.0.1` 换成本机局域网 IP，并保证手机与 PC 同网段、防火墙放行 8765。
* 消息格式与 H5 完全一致：`state` 顶层字段 + `data` 双份、`ack/event/pong/report_ready` 同名；
  小程序可用 `socketTask.onMessage` 直接 `JSON.parse`。
* BLE 控车不在本服务范围（需真机 + 小程序蓝牙 API），`miniprogram/utils/ble.js` 只是骨架。

### 8.3 常见问题

| 现象 | 处理 |
|---|---|
| 启动报端口占用 | `--port 8799`（或关掉旧进程）；返回码 2 并打印提示 |
| 浏览器打开 `/` 是占位页 | 只会在 `web/index.html` 缺失时出现；web 就绪后刷新即可 |
| 页面无数据但服务正常 | 检查页面是否仍用 mock / freeze=1；或浏览器拦了 localhost 请求（代理软件） |
| WS 连不上 | 必须用 `ws://` 且路径 `/ws`；确认 `Upgrade: websocket`（浏览器/小程序原生 WS 自带） |
| 想从头演示 | 重启加 `--fresh` |

---

## 9. 自测记录（2026-11-04，测试端口 **8799**（默认模式）/ **8800**（`--fresh`），测完均已关闭）

环境：Windows / Python 3.12.14 / Node v24.21.0（全局 `WebSocket`）。
测试期间未占用演示端口 8765。

### 9.1 HTTP 用例

| # | 用例 | 命令 | 结果 |
|---|---|---|---|
| 1 | 状态接口 | `curl /api/state` | ✅ 200，字段齐全；初始 `42/64`、`stop 7/20`、`B2/B2-03`、`detected 6`、`recent 3`、`review 3` |
| 2 | 报表接口 | `curl "/api/report?batch=B-20261104-01"` | ✅ 200，64/9/3/95.3、84.4%、6/9、六状态 2,3,1,1,1,1、footer 正确 |
| 3 | 图传接口 | `curl /api/video/info` | ✅ 200，1280×720 / 1.2 Mbps / 15 fps / ptz 78° / 2 个检测框（0.87 high、0.63 review） |
| 4 | CSV 导出 | `curl -D headers -o x.csv /api/export/csv` | ✅ 200，`text/csv; charset=utf-8`，BOM `EF BB BF`，9 行 7 列，中文文件名 `株迹可循_批次_B-20261104-01.csv` |
| 5 | 未知批次 | `curl "/api/report?batch=NOPE"` | ✅ 404 `{"error":"batch_not_found"}` |
| 6 | 首页 | `curl /` | ✅ 200；`web/` 就绪后托管真实 H5（24,128 bytes text/html），未就绪时返回占位页，**不 404** |
| 7 | 静态素材 | `curl /assets/cam_plant.jpg` | ✅ 200 `image/jpeg`，63,526 bytes |
| 8 | 路径穿越 | `curl --path-as-is "/../docs/api_contract.md"` | ✅ 404（被拦截） |
| 9 | 探活 | `curl /api/health` | ✅ 200 `{"ok":true,...}` |
| 10 | 仿真完成 | 等待约 70 s 后 `curl /api/state` | ✅ `mode=idle`、`batch.status=done`、`64/64`、`detected=9`、`progress=1.0`、`distance_m≈35.8` |

### 9.2 WebSocket 用例（`node server/tests/ws_smoke.js ws://127.0.0.1:8799/ws --wait-report`）

| # | 用例 | 结果 |
|---|---|---|
| 1 | 首帧 `state` 字段合法 | ✅ PASS |
| 2 | patrol 模式 `control(move)` 被拒 → `error="mode"` | ✅ PASS |
| 3 | `mode=remote` 切换成功 → `ack.ok=true` | ✅ PASS |
| 4 | remote 下 `control(move)` 成功、`seq` 回显 | ✅ PASS |
| 5 | remote 500 ms 无新指令 → `state.speed=0` + `event`“已自动停车” | ✅ PASS |
| 6 | `estop` 生效 → `ack.ok=true` | ✅ PASS |
| 7 | 急停后控制被拒 → `error="estop"` | ✅ PASS |
| 8 | `ping` → `pong` 回显 `t` | ✅ PASS |
| 9 | 等待本圈完成 → `report_ready`（批次号 B-20261104-01）+ `mode=idle`、64 株、9 检出 | ✅ PASS |

> 完整输出见第 9.3 节；测试脚本零依赖，可随时复跑。

### 9.3 实测输出摘录（默认检查点 + 完整一圈，实测）

```
[    53ms] open ws://127.0.0.1:8799/ws
[   112ms] PASS 首帧 state 字段合法
[   114ms] PASS patrol 模式 move 被拒 error=mode
[   114ms] PASS 切换 remote ack.ok=true
[   115ms] PASS remote 模式 move ack.ok=true, seq 回显
[   628ms] event: [warn] 远程控制 500 ms 无新指令，已自动停车
[  1221ms] PASS remote 500ms 无新指令自动停车（state.speed=0）
[  1221ms] PASS 收到自动停车 event
[  1222ms] PASS estop ack.ok=true
[  1223ms] PASS 急停后控制被拒 error=estop
[  1224ms] PASS ping -> pong 回显 t=12345
[  1224ms] PASS 急停复位 ack.ok=true
[  1225ms] PASS 恢复巡检模式 ack.ok=true
[ 54661ms] event: [info] 本棚巡检完成：64/64 株，检出 9 株；批次 B-20261104-01 报表已生成
[ 54662ms] PASS report_ready 推送批次号 B-20261104-01
[ 55366ms] PASS 完成后 mode=idle（实际 idle）
[ 55366ms] PASS 完成后 64 株 / 9 检出 / progress=1
[ 55367ms] states=117 events=19
[ 55367ms] RESULT PASS
```

### 9.4 `--fresh` 全圈链路（端口 8800，实测）

```powershell
python server/app.py --port 8800 --fresh
node server/tests/ws_smoke.js ws://127.0.0.1:8800/ws --wait-report
```

| 观测点 | 实测结果 |
|---|---|
| 启动初始 | `0/64` 株、`stop 0/20`、`detected 0`、`progress=0.0` |
| 运行中 event | 到达台位/掉头位、检出记录依次推送（0.79 / 0.91 / 0.77 / 0.86 / 0.81 …） |
| 完成终态 | `mode=idle`、`64/64`、`progress=1.0`、`detected=9`、`stop 20/20`、`distance_m=35.8`、`battery=77`、`batch.status=done`、`batch.end=2026-11-04T09:22:01+08:00` |
| 测试结论 | ✅ `RESULT PASS`（整圈约 2 min，检测记录累计 9 条） |

### 9.5 与 H5 静态托管联调（`web/` 已由 app-web 交付，只读验证）

| 请求 | 实测 |
|---|---|
| `GET /` | ✅ 200 `text/html; charset=utf-8`，24,128 bytes（真实 `web/index.html`） |
| `GET /css/app.css` | ✅ 200 `text/css; charset=utf-8`，35,473 bytes |
| `GET /js/app.js` | ✅ 200 `application/javascript; charset=utf-8`，50,327 bytes |
| `GET /_grid.jpg` | ✅ 200 `image/jpeg`，162,766 bytes |
| `GET /assets/cam_plant.jpg` | ✅ 200 `image/jpeg`，63,526 bytes |

H5 出站消息与本文档 5.2 逐条对照一致：`hello{client}`、`ping{t}`、`control{cmd,v,w,seq}`、
`mode{mode}`、`estop`、`estop_reset`、`video{enabled}`、`review{code,action}`；
H5 侧 `state` 处理为 `S = msg`（直接读顶层 `robot/device/batch`），本服务 `state` 同时提供
**顶层字段 + `data` 双份**，两种写法都兼容；`?freeze=1` 时 H5 不连 WS、不自动刷新（截图走内置 mock）。
本轮只读核对，未修改 `web/` 任何文件。

### 9.6 契约一致性自动核对（实测 51/51 PASS）

用 Python 标准库拉起 `8799` 服务后逐项断言（片段）：

* `/api/state`：顶层 6 键、`robot` 19 个字段、`batch.id`、完成后 `mode=idle`/`64/64`/`progress=1.0`/`detected=9`/`batch.status=done`/`distance_m≈35.8`；
* `/api/report`：KPI `64/9/3/95.3`、`sub=84.4% / 6-9`、六状态 `2,3,1,1,1,1` 且合计 9、`records=3 / review=3`、契约示例记录与复核记录、footer 批次号；
* `/api/video/info`：`K230 · 顶视 / 1280×720 / 1.2 Mbps / 15 fps / ptz(0,78)`、2 个检测框 `0.87/0.63`；
* `/api/export/csv`：`Content-Type`、BOM、表头、9 行数据、中文文件名 `filename*`。

结果：`PASS 51 / FAIL 0`。

### 9.7 `--live` 降级实测（端口 8801，目标不可达）

```powershell
python server/app.py --port 8801 --live 192.168.4.1:8266
```

```
[INFO]   live:   预留连接 192.168.4.1:8266（本期为协议骨架，自动降级仿真）
[INFO] [live] 尝试连接 ESP32-C3 192.168.4.1:8266 ...
[WARNING] [live] 连接失败（timed out）
[WARNING] [live] 本期为预留骨架，未实现真实协议解析；已降级为仿真模式
```

连接失败不影响主服务：`curl /api/health` 仍返回 `{"ok":true,...}`，仿真/API/WS 全部正常 → ✅ PASS。

复跑方式：

```powershell
# 1) 启动服务（建议换测试端口，避免占用演示端口 8765）
python server/app.py --port 8799
python server/app.py --port 8800 --fresh      # 可选：从 0 跑完整圈
# 2) 另开一个终端
node server/tests/ws_smoke.js ws://127.0.0.1:8799/ws
node server/tests/ws_smoke.js ws://127.0.0.1:8799/ws --wait-report   # 追加完成态校验（约 70 s）
```

---

## 10. 已知偏差 / 遗留问题

1. **报表与 CSV 是“归档批次”静态数据**：`/api/report`、`/api/export/csv` 始终返回 `B-20261104-01`
   的最终结果（严格契约数值），与仿真是否跑完无关；`/api/state` 才是实时演示流。这样评委随时打开
   报表页都是完整口径，不需要先等 2 分钟跑完。CSV 的“复核状态”列会跟随 WS 复核操作更新。
2. **检测触发站**：`--fresh` 严格按“第 4/7/9/12/14/16/18 站触发、共 9 条（2+2+1+1+1+1+1）”；
   默认演示检查点已预先入库 6 条（对应检查点前的第 4/7 站及前序记录），继续巡检时在第 **9/14/18** 站
   再产生 3 条，累计 9 条——保证“一启动就是契约示例那一帧”，代价是默认模式不会重放前 6 条的触发过程。
3. **`voltage` 公式**：契约文字给的是 `10.9+0.007×battery`（78% → 11.45 V），但契约示例与 BUILD_SPEC
   都写 11.6 V；本实现取示例口径 `11.6 - 0.007×(78-battery)`（78% → 11.6 V，斜率一致），故与公式字面值
   相差 0.15 V 的常数偏移。
4. **`--live` 未接真机**：只有 TCP 连接 + 拆帧 + 日志 + TODO，协议帧格式为假设（`AA 55 CMD LEN PAYLOAD SUM8`），
   需与固件确认后才能用于真车。
5. **无鉴权、单实例**：仅监听 `127.0.0.1` 供本机演示；若要局域网真机联调，需自行改 `--host 0.0.0.0` 并注意安全。
6. **WS 阻塞读**：握手后使用阻塞读（避免 Python 缓冲读超时后永久失效的问题），连接断开由 EOF 感知；
   服务端不主动发心跳，客户端可自行 `ping` 保活。
7. **长跑数据**：电量/温度会持续缓慢变化（演示窗口内不影响截图口径；截图建议启动后 70 s 内完成，或使用
   `--fresh` 外的默认检查点）。
8. `web/` 已就绪并实测托管（`/` 24,128 bytes、`css/app.css`、`js/app.js`、`_grid.jpg` 均 200）；若
   `web/index.html` 缺失，`/` 自动回退占位页（含接口列表），不会 404，也无需重启服务。

---

## 11. 安全与约束

* 仅使用 Python 标准库（`http.server`、`socket`、`hashlib`、`struct`、`json`、`csv` 等），无 pip 依赖、无外网访问。
* 不写入任何目录：只读 `../web/`、`../assets/`；运行时日志仅输出到 stdout/stderr。
* 监听默认 `127.0.0.1`，不对外暴露；路径穿越已拦截；WS 帧大小有限额；控制指令有模式/急停/超时三重限制。

---

## 12. K230 真实图传接入（2026-11-04 追加，已实测）

> 完整契约见 [`../docs/K230_实时图传_API.md`](../docs/K230_实时图传_API.md)；K230 端脚本见 [`../firmware/k230/`](../firmware/k230/)。

### 12.1 三种源模式

| `--camera-mode` | 数据通路 | 用法 |
|---|---|---|
| `sim`（默认） | 演示静帧 | `python server/app.py` |
| `push` / sim 自动升级 | K230 POST `/api/device/frame` → 服务端 MJPEG | 默认启动即可；K230 推第一帧时自动从 sim 切到 push |
| `mjpeg` | K230 自建 MJPEG，H5 直连 | `--camera-mode mjpeg --camera-url http://192.168.4.1:8080/stream` |
| `rtsp` | ffmpeg 拉 H.264 → 拆 JPEG 帧 → MJPEG | `--camera-mode rtsp --camera-url rtsp://192.168.4.1:8554/live`；也可传本地 mp4 验证链路 |

新增参数：`--device-token`（设备上行鉴权，`X-Device-Token`）、`--ffmpeg`（显式指定 ffmpeg；不指定时自动找 imageio-ffmpeg / PATH / DSH 运行时缓存）。

### 12.2 新增接口

| 方法/路径 | 说明 |
|---|---|
| `POST /api/device/frame` | raw JPEG 单帧（≤3 MB），头可带 `X-Device-Id/X-Frame-Ts/X-Width/X-Height/X-Ptz-*`；返回 fps/kbps |
| `POST /api/device/detection` | K230 端 YOLO 结果（box/置信度/株位码），叠加到 H5 检测框 |
| `POST /api/device/telemetry` | 真车遥测（电量/位置/进度/mode 等）；收到后 3 s 内暂停仿真，超时自动回退并打日志 |
| `GET /api/device/commands?since=N` | 给 ESP32/K230 轮询的下行控制队列（H5 的 mode/control/estop 指令） |
| `POST /api/device/ack` | 设备执行完指令后清队列 |
| `GET /api/camera/status` | 图传源状态：mode/online/fps/kbps/width/height/stream_url/帧计数 |
| `GET /api/camera/latest.jpg` | 最新帧（无真实帧时返回演示图），响应头 `X-Source/X-Frame-Seq/X-Frame-Ts` |
| `GET /api/camera/stream.mjpg` | `multipart/x-mixed-replace`，H5 `<img>` 直接显示 |
| `POST /api/camera/source` | 运行时切源：`{"mode":"mjpeg","url":"..."}` |
| `GET /api/video/info` | 已合并真实源（camera/fps/bitrate/boxes + `source` 字段） |

### 12.3 无硬件自测（2026-11-04 实测通过）

```powershell
# 终端 1
python server/app.py --port 8865
# 终端 2：模拟 K230 推 640×360@3fps + 遥测 + 检测框
python tools/device_simulator.py --port 8865 --fps 3
# 终端 3：验证
curl http://127.0.0.1:8865/api/camera/status
curl -o latest.jpg http://127.0.0.1:8865/api/camera/latest.jpg
node tools/test_device_commands.mjs          # WS mode/control/estop → 设备命令队列
```

实测结果：
- push：`mode=push, online=true, fps≈2.9, kbps≈230, 640×360`；H5 图传页角标显示“K230 实拍”，`/api/video/info` 的 `camera` 变为“K230 · 实时”，检测框来自设备上报；
- 遥测：`battery/voltage/x/y/stop_index` 覆盖仿真，3 s 无上报自动回退 `telemetry=sim`；
- 指令：H5 WS 发 `mode=remote → move → stop → estop`，`/api/device/commands` 返回 4 条带 seq 的指令；
- rtsp/本地 mp4：`mode=rtsp, online=true, fps=5, kbps≈1940, frames 持续增长`，`latest.jpg` 有效；
- 鉴权：`--device-token testtoken` 下无 token POST 返回 401，带 token 返回 200；
- `?freeze=1` 截图模式不发请求，图传页与界面设计图 像素一致（`ImageChops.difference` bbox=None）。

### 12.4 K230 联调要点（真机必看）

1. **必须监听 0.0.0.0**：默认 `127.0.0.1` 只允许本机，K230 从局域网连会超时。
   ```powershell
   python server/app.py --host 0.0.0.0 --port 8765
   ```
   或直接双击 `../启动演示-K230联调.cmd`（会自动打印本机 IPv4）。
2. **防火墙放行一次**（管理员 PowerShell）：
   ```powershell
   netsh advfirewall firewall add rule name="株迹可循8765" dir=in action=allow protocol=TCP localport=8765
   ```
3. 电脑与 K230 必须在**同一 2.4G 局域网**；手机热点可能开 AP 隔离，优先用路由器。
4. K230 脚本 4 行配置：`WIFI_SSID / WIFI_PASSWORD / SERVER_HOST（电脑 IPv4）/ DEVICE_TOKEN（服务端没开就留空）`。
5. 联调顺序：电脑上先看到 `http://127.0.0.1:8765/` → 手机/电脑浏览器访问 `http://<电脑IP>:8765/` 能开 → K230 跑脚本 → H5 图传页角标变“K230 实拍”。

### 12.6 PC 端静态路由与台账接口（2026-11-04）

- `GET /pc/` → `../web_pc/index.html`；`GET /pc/*` → `web_pc/` 静态文件（不改动手机端 `/`）。
- `GET /api/records`：返回当前已入库检测记录（含 `review_state`），供 PC 地图/台账使用；`total` 为全批次记录数，`detected` 为当前已检出数。
- `GET /api/report` 的 `records[]` 增加 `disease` 字段（additive，H5 旧逻辑不受影响）。
- PC 截图/演示：`启动PC演示.cmd`；截图在 `shots_pc/`。
