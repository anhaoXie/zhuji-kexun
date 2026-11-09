# 本地服务接口契约（v1，2026-11-04）

服务：Python 3.12 标准库，无第三方依赖。默认监听 `127.0.0.1:8765`，同时托管 `../web/` 静态文件与 `../assets/`。
所有时间使用 `Asia/Shanghai`；H5/小程序在无服务时使用内置 mock（字段与本契约一致）。

## 1. 设备状态

### GET `/api/state`
```json
{
  "ts": 1793,
  "device": {"name": "株迹可循-01", "fw": "v1.0.0", "link": "wifi", "rssi": -52, "latency_ms": 28},
  "robot": {
    "mode": "patrol", "mode_text": "巡检中",
    "battery": 78, "voltage": 11.6, "current": 0.82, "temp": 32,
    "speed": 0.5, "x": 3.24, "y": 1.85, "heading": 90,
    "stop_index": 7, "stop_total": 20,
    "bed": "B2", "plot": "B2-03",
    "progress": 0.66, "plants_done": 42, "plants_total": 64,
    "distance_m": 18.6, "detected": 6
  },
  "batch": {"id": "B-20261104-01", "greenhouse": "1号棚", "start": "2026-11-04T09:20:00+08:00", "end": null, "status": "running"},
  "recent": [
    {"code": "1棚-3行-B2台-2位-1株", "disease": "叶斑病", "confidence": 0.91, "state": "新发", "time": "09:24",
     "suggest": "分区标记 + 加密复查"}
  ],
  "review": [
    {"code": "1棚-2行-A1台-1位-1株", "disease": "叶斑病", "confidence": 0.63, "state": "待复核"}
  ]
}
```
`mode` 枚举：`patrol`（巡检中）、`remote`（远程模式）、`estop`（已急停）、`idle`（待命/完成）。

### GET `/api/report?batch=B-20261104-01`
```json
{
  "batch": {"id": "B-20261104-01", "greenhouse": "1号棚", "time": "2026-11-04 09:20—09:26", "status": "done"},
  "kpis": [
    {"key": "plants", "label": "巡检", "value": "64", "unit": "株"},
    {"key": "detected", "label": "检出", "value": "9", "unit": "株"},
    {"key": "review", "label": "待复核", "value": "3", "unit": "株"},
    {"key": "recall", "label": "找回率", "value": "95.3", "unit": "%"}
  ],
  "sub": {"conclusion_rate": "84.4%", "suggest_adopted": "6/9"},
  "states": [
    {"key": "new", "label": "新发", "count": 2, "color": "#E5484D"},
    {"key": "ongoing", "label": "持续", "count": 3, "color": "#2F6BFF"},
    {"key": "worse", "label": "加重", "count": 1, "color": "#F5A524"},
    {"key": "better", "label": "好转", "count": 1, "color": "#07C160"},
    {"key": "handled", "label": "已处理", "count": 1, "color": "#8A8F99"},
    {"key": "false", "label": "疑似误报", "count": 1, "color": "#B58B00"}
  ],
  "records": [
    {"code": "1棚-3行-B2台-2位-1株", "state": "新发", "confidence": 0.91, "advice": "分区标记 + 加密复查"}
  ],
  "review": [
    {"code": "1棚-2行-A1台-1位-1株", "disease": "叶斑病", "confidence": 0.63}
  ],
  "footer": "判定规则/阈值/模型版本随批次归档 · 批次 B-20261104-01"
}
```

### GET `/api/video/info`
```json
{
  "enabled": false, "camera": "K230 · 顶视", "width": 1280, "height": 720,
  "bitrate": "1.2 Mbps", "fps": 15, "ptz": {"pan": 0, "pitch": 78},
  "ts": "2026-11-04 09:24:31",
  "boxes": [
    {"x": 0.22, "y": 0.30, "w": 0.26, "h": 0.34, "label": "叶斑病", "confidence": 0.87, "status": "high"},
    {"x": 0.58, "y": 0.52, "w": 0.18, "h": 0.22, "label": "叶斑病", "confidence": 0.63, "status": "review"}
  ]
}
```
`x,y,w,h` 为相对画面的 0—1 比例。

### 静态资源
- `/assets/cam_plant.jpg`：车端俯视画面（项目负责人 提供，1280×720）。
- `/assets/` 其余演示素材。

### GET `/api/export/csv`
返回 `text/csv; charset=utf-8`（带 BOM），文件名 `株迹可循_批次_B-20261104-01.csv`。
列：株位码、病害、置信度、六状态、建议、时间、复核状态。

## 2. WebSocket `/ws`

### 客户端 → 服务端
| type | 字段 | 说明 |
|---|---|---|
| `hello` | `client` | 连接握手 |
| `control` | `cmd:"move"|"stop"`, `v`(m/s), `w`(rad/s), `seq` | 仅 `remote` 模式接受；`v` 限 0—0.8，`w` 限 ±1.2；服务端回 `ack` |
| `mode` | `mode:"patrol"|"remote"` | 切远程需现场确认；`patrol` 恢复巡检 |
| `estop` | — | 任何模式立即生效；`mode=estop`，速度清零 |
| `estop_reset` | — | 长按复位后恢复 `idle` |
| `video` | `enabled` | 开关图传监看；仅改变状态 |
| `review` | `code`, `action:"confirm"|"rejudge"` | 复核操作，回 `ack` |
| `ping` | `t` | 回 `pong` |

### 服务端 → 客户端
| type | 说明 |
|---|---|
| `state` | 同 `/api/state`，每 500 ms 推送一次（巡检仿真推进） |
| `ack` | `{seq, ok, error?}` |
| `pong` | `{t}` |
| `event` | `{level, text}`，如“到达台位 B2-03”“检出叶斑病 0.91” |
| `report_ready` | `{batch}`，本棚完成时推送 |

**安全规则（服务端必须实现）**：远程模式下控制指令 500 ms 无心跳/无新指令即自动 `stop`；`estop` 后拒绝一切控制；非 `remote` 模式的 `move` 返回 `ack.ok=false, error="mode"`。

## 3. 仿真（默认模式，无需硬件）

- 航线：4 床×4 台位，20 个停靠位，往返 S 形，总长约 35.8 m；巡检速度 0.5 m/s。
- 每个停靠位停留 2.4 s；到第 4、7、9、12、14、16、18 站各产生一条检测记录（累计 9 条，其中 3 条低置信进复核）。
- 进度：`plants_done` 从 0→64；`progress=plants_done/64`；完成时 `mode=idle`、`batch.status=done`、推 `report_ready`。
- 电量：从 78% 缓慢下降；`voltage=10.9+0.007*battery`；`temp` 30—34 波动。
- 远程模式：`v/w` 直接更新 `x,y,heading`（按 10 Hz 积分）；松开 500 ms 自动停。
- 真实硬件模式（预留，可用 `--live host:port`）：TCP 连 ESP32-C3 `:8266`，按设计说明协议 `0x30 TEL / 0x31 EVENT / 0x40 PCMD / 0x41 TASK / 0x50 BCMD / 0x51 BSTATE` 解析；解析失败时降级为仿真并在日志提示。**本期不要求实现完整协议，只需留出接口和 TODO。**

## 4. 启动

```bash
cd .
python server/app.py            # 默认 127.0.0.1:8765
python server/app.py --port 9000 --live 192.168.4.1:8266
```
浏览器打开 `http://127.0.0.1:8765/`。
