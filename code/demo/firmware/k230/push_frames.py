# -*- coding: utf-8 -*-
"""
《株迹可循》· CanMV K230 实时图传 —— 方式 A：push（K230 主动推帧）

做什么
------
K230 抓一帧 -> 编码成 JPEG -> HTTP POST 到电脑上的本地服务：
    http://<电脑IP>:8765/api/device/frame       （body = 单帧 JPEG 原始字节）

电脑端 server/app.py 收到帧后缓存，H5 图传页的 /api/camera/stream.mjpg 立刻显示实拍，
3 秒收不到新帧自动回退"演示画面"（脚本崩了/断网也不会卡死展示）。

运行位置
--------
本文件是跑在 K230 板子上的 MicroPython 脚本，不是电脑上跑的 Python。
用 CanMV IDE 打开 / 上传到板子（建议存成 /sdcard/push_frames.py）后直接运行。

上机前只改【① 用户必改】4 行
---------------------------
    WIFI_SSID / WIFI_PASSWORD / SERVER_HOST（电脑局域网 IP）/ DEVICE_TOKEN
其余默认值先跑通再调。

关于“不要编造 API”
------------------
本文件里凡是标了 `# TODO(手册核对 N)` 的地方，都是我无法在没有 K230 硬件的情况下
100% 确认的 CanMV K230 API。每处都写了【候选 A/B/C】+ 判断依据 + 验证方法，
并和 README.md 第 9 节「待手册确认清单」的编号一一对应。
默认写法按 01Studio / CanMV 官方例程的常见风格；若你的固件不一样，通常改 2—3 行即可。
"""

# =============================================================================
# ①【用户必改】4 行 —— 其它都能先默认
# =============================================================================
WIFI_SSID = "YOUR_WIFI_2G"           # 只支持 2.4G；5G 热点 K230 连不上
WIFI_PASSWORD = "YOUR_PASSWORD"
SERVER_HOST = "192.168.1.50"         # 电脑（跑 server/app.py 的那台）的局域网 IP，用 ipconfig 查
SERVER_PORT = 8765
DEVICE_TOKEN = ""                    # 服务端加了 --device-token 时填同一串；没加就留空

# =============================================================================
# ② 图像 / 发送参数（先别动，跑通再调）
# =============================================================================
FPS = 3                              # 推流帧率；3 fps 足够 H5 看，先别超 5
RESOLUTION = "640x360"               # 目标分辨率；可试 "640x480" / "480x270"
JPEG_QUALITY = 60                    # 60 画质够用；带宽紧/花屏可降到 50
DEVICE_ID = "k230-01"
API_PATH = "/api/device/frame"
SEND_FRAME_TS = False                # K230 没对时（时间不准）就保持 False，服务端会用自己的时间
MAX_UPLOAD_BYTES = 3 * 1024 * 1024   # 服务端单帧上限 3 MB

# =============================================================================
# ③ 调试 / 容错参数（一般不用改）
# =============================================================================
SELFTEST_ONCE = True                 # 首帧：打印图像 API 信息 + 存一张 /sdcard/test.jpg
DEBUG_API = False                    # True：打印 dir(img)/dir(sensor)，按手册核对 API 时打开
PRINT_EVERY = 30                     # 每多少帧打印一次 fps
GC_EVERY = 10                        # 每多少帧 gc.collect() 一次（防内存碎片）
HTTP_TIMEOUT_S = 3.0                 # 单次 HTTP 超时（秒）
RECONNECT_S = 2.0                    # 发送失败后重试间隔基数（秒），会逐步退避到 MAX_BACKOFF_S
MAX_BACKOFF_S = 10.0

# =============================================================================
# 以下是实现，正常不用改
# =============================================================================
import sys
import time
import gc

# ---- socket：MicroPython 常见就是 socket；极少固件只暴露 usocket ----
try:
    import socket
except ImportError:                  # TODO(手册核对 5)
    import usocket as socket

# ---- 解析分辨率字符串 ----
try:
    _parts = RESOLUTION.lower().replace(" ", "").split("x")
    _W = int(_parts[0])
    _H = int(_parts[1])
except Exception:
    print("[cfg] RESOLUTION 格式不对（应为 640x360），回退 640x360")
    _W, _H = 640, 360

# =============================================================================
# 相机/媒体库探测
#   TODO(手册核对 1)：K230 的相机初始化写法。
#   候选 A（默认，CanMV K230 官方例程常见）：from media.sensor import Sensor，再 Sensor()
#   候选 B（OpenMV 风格）：import sensor（模块级函数），再 sensor.reset()
#   判断依据 & 验证方法见 README 第 9 节 #1。
# =============================================================================
Sensor = None
_omv_sensor = None
_CAM_STYLE = None

try:
    from media.sensor import Sensor          # 候选 A
    _CAM_STYLE = "media.sensor"
except ImportError:
    Sensor = None

if Sensor is None:
    try:
        import sensor as _omv_sensor         # 候选 B
        _CAM_STYLE = "sensor-module"
    except ImportError:
        _omv_sensor = None

_CAM = None          # 全局相机对象
_WLAN = None         # 全局 WLAN 对象（没有 network 模块时保持 None）
_SAVE_OK_PATH = None # 自检时确认可写的图片路径（如 /sdcard/test.jpg）
_ENCODE_OK = None    # 已确认可用的 JPEG 编码候选（"A"/"B"）


def _now_ms():
    """毫秒时钟；优先用 ticks_ms（不受系统时间影响），否则退回 time.time()。"""
    fn = getattr(time, "ticks_ms", None)
    if fn is not None:
        try:
            return fn()
        except Exception:
            pass
    return int(time.time() * 1000)


def _ms_diff(now, before):
    """毫秒差；有 ticks_diff 就用它（可处理计数器回绕）。"""
    fn = getattr(time, "ticks_diff", None)
    if fn is not None:
        try:
            return fn(now, before)
        except Exception:
            pass
    return now - before


def _wait_frame(t0_ms):
    """按 FPS 控制节奏：这一帧处理完若还没到帧周期，就补睡剩余时间。"""
    period = int(1000 / max(FPS, 1))
    dt = _ms_diff(_now_ms(), t0_ms)
    if dt < period:
        time.sleep((period - dt) / 1000.0)


def _print_header():
    print("")
    print("=" * 60)
    print(" 株迹可循 · CanMV K230 实时图传（方式 A：push 推帧）")
    print("=" * 60)
    print("[cfg] 目标：http://%s:%d%s" % (SERVER_HOST, SERVER_PORT, API_PATH))
    print("[cfg] 帧率 %d fps | 目标分辨率 %dx%d | JPEG 质量 %d | 设备号 %s"
          % (FPS, _W, _H, JPEG_QUALITY, DEVICE_ID))
    if DEVICE_TOKEN:
        print("[cfg] token：已填（%d 位），服务端必须加同样的 --device-token" % len(DEVICE_TOKEN))
    else:
        print("[cfg] token：未填（服务端没开 --device-token 时才这样）")
    print("[cfg] 相机写法探测：%s" % (_CAM_STYLE or "未找到（见 README 第 9 节 #1）"))
    print("=" * 60)


# -----------------------------------------------------------------------------
# WiFi
# -----------------------------------------------------------------------------
def _print_network_hint():
    print("[wifi] 提示：① 只连 2.4G（5G 连不上）② SSID/密码区分大小写 "
          "③ 中文/特殊字符 SSID 建议改成英文 ④ 板子与电脑要在同一路由器/热点下")


def connect_wifi(timeout_ms=20000):
    """连接 WiFi（STA）。返回 True=连上了/不需要连；False=没连上。

    TODO(手册核对 4)：K230 固件里 network 模块的写法。
    候选 A（默认，MicroPython 通用写法）：network.WLAN(network.STA_IF)
    候选 B：只有 network.LAN()（网口）或系统层已联网 —— 此时脚本跳过，直接发 socket
    候选 C：没有 network 模块 —— 认为系统已联网（按 01Studio 教程先配网）
    判断依据 & 验证方法见 README 第 9 节 #4。
    """
    global _WLAN

    if (not WIFI_SSID) or WIFI_SSID.startswith("YOUR_"):
        print("[wifi] WIFI_SSID 还是占位符，跳过联网（假设板子已联网）")
        return True

    try:
        import network
    except ImportError:
        print("[wifi] 没有 network 模块（候选 C）：假设系统已联网，直接开始推流")
        return True

    # ---- 候选 A：WLAN / STA_IF ----
    if hasattr(network, "WLAN"):
        try:
            _sta_if = getattr(network, "STA_IF", None)
            try:
                _WLAN = network.WLAN(_sta_if) if _sta_if is not None else network.WLAN()
            except TypeError:
                _WLAN = network.WLAN()
            try:
                _WLAN.active(True)
            except Exception as e:
                print("[wifi] wlan.active(True) 失败：%s（继续尝试）" % e)

            try:
                already = _WLAN.isconnected()
            except Exception:
                already = False

            if not already:
                print("[wifi] 正在连接 %s ..." % WIFI_SSID)
                try:
                    _WLAN.connect(WIFI_SSID, WIFI_PASSWORD)   # TODO(手册核对 4): 个别固件要第三个 security 参数
                except Exception as e:
                    print("[wifi] wlan.connect() 失败：%s" % e)
                    _print_network_hint()
                    return False

                t0 = _now_ms()
                while _ms_diff(_now_ms(), t0) < timeout_ms:
                    try:
                        if _WLAN.isconnected():
                            break
                    except Exception:
                        pass
                    time.sleep(0.3)

            try:
                connected = bool(_WLAN.isconnected())
            except Exception:
                connected = False

            if connected:
                try:
                    print("[wifi] 已连接，ifconfig = %s" % (_WLAN.ifconfig(),))
                except Exception:
                    print("[wifi] 已连接（取不到 ifconfig）")
                return True

            print("[wifi] %d 秒内没连上" % (timeout_ms // 1000))
            _print_network_hint()
            return False
        except Exception as e:
            print("[wifi] 候选 A（WLAN）异常：%s" % e)

    # ---- 候选 B：只有 LAN ----
    if hasattr(network, "LAN"):
        print("[wifi] 固件没有 WLAN、只有 LAN（候选 B）。如果你的板子用网口联网，"
              "请先插网线；用 WiFi 的话见 README 第 9 节 #4。")
        try:
            _WLAN = network.LAN()
            _WLAN.active(True)
            print("[wifi] LAN 已启用，ifconfig = %s" % (_WLAN.ifconfig(),))
            return True
        except Exception as e:
            print("[wifi] LAN 启用失败：%s" % e)

    print("[wifi] 没能用 network 模块联网；dir(network) = %s" % dir(network))
    print("[wifi] 处理：按 README 第 9 节 #4 对照手册，或先按 01Studio 教程在系统里配好 WiFi，")
    print("[wifi] 然后把本文件 WIFI_SSID 改成空串（跳过联网）再跑。")
    return False


def _wifi_ok():
    """每帧调用：检查 WiFi 是否还在；没有 WLAN 对象时视为正常（交给 socket 报错）。"""
    if _WLAN is None:
        return True
    try:
        return bool(_WLAN.isconnected())
    except Exception:
        return True


# -----------------------------------------------------------------------------
# 相机初始化
# -----------------------------------------------------------------------------
def _owner():
    """取常量（RGB565/VGA 等）所在的类或模块。"""
    if Sensor is not None:
        return Sensor
    return _omv_sensor


def _safe_cam_call(cam, name):
    fn = getattr(cam, name, None)
    if fn is None:
        print("[cam] 没有 %s()（跳过）" % name)
        return False
    try:
        fn()
        print("[cam] %s() 成功" % name)
        return True
    except Exception as e:
        print("[cam] %s() 失败：%s" % (name, e))
        return False


def _set_framesize(cam):
    """设置分辨率。

    TODO(手册核对 3)：K230 是否支持 set_framesize(width=, height=) 这种 kwargs 写法，
    以及 640x360 这种非标尺寸是否被接受。
    候选 A（默认）：cam.set_framesize(width=W, height=H)      —— CanMV K230 例程里有这种写法
    候选 B：cam.set_framesize(Sensor.VGA / QVGA / HD)        —— OpenMV 风格常量
    判断依据 & 验证方法见 README 第 9 节 #3。
    """
    try:
        cam.set_framesize(width=_W, height=_H)
        print("[cam] 分辨率候选 A 成功：width=%d, height=%d" % (_W, _H))
        return True
    except Exception as e:
        print("[cam] 候选 A set_framesize(width=, height=) 失败：%s" % e)

    owner = _owner()
    for name in ("VGA", "QVGA", "HD"):
        val = getattr(owner, name, None) if owner is not None else None
        if val is None:
            continue
        try:
            cam.set_framesize(val)
            print("[cam] 分辨率候选 B 成功：set_framesize(%s)（实际尺寸看自检打印）" % name)
            return True
        except Exception as e:
            print("[cam] 候选 B set_framesize(%s) 失败：%s" % (name, e))

    print("[cam] 警告：两种分辨率写法都没成功，将用上电默认分辨率（自检会打印实际尺寸）")
    return False


def _set_pixformat(cam):
    """设置像素格式。JPEG 编码一般要求 RGB565（灰度也可，但 H5 上是黑白）。"""
    owner = _owner()
    for name in ("RGB565", "GRAYSCALE"):
        val = getattr(owner, name, None) if owner is not None else None
        if val is None:
            continue
        try:
            cam.set_pixformat(val)
            print("[cam] 像素格式：%s" % name)
            return True
        except Exception as e:
            print("[cam] set_pixformat(%s) 失败：%s" % (name, e))
    print("[cam] 警告：set_pixformat 没成功，JPEG 编码可能失败（见 README 第 9 节 #2）")
    return False


def _init_media_pipeline():
    """初始化媒体流水线。

    TODO(手册核对 1)：K230 例程里 Sensor 配置完成后常有 media.init()/media.start()，
    之后才能 snapshot()；若你的固件没有 media 模块/这些函数，本函数会自己跳过。
    候选 A（默认）：from media.media import media as m; m.init(); m.start()
    候选 B：from media.media import *; media.init()/media.start()（等价于候选 A）
    候选 C：固件自动初始化，不需要这一步（跳过即可）
    判断依据 & 验证方法见 README 第 9 节 #1。
    """
    media_obj = None
    try:
        from media.media import media as media_obj      # 候选 A/B
    except ImportError:
        print("[media] 未发现 media.media.media（跳过；多数固件自动初始化）")
        return

    for fn_name in ("init", "start"):
        fn = getattr(media_obj, fn_name, None)
        if fn is None:
            print("[media] 没有 media.%s()（跳过）" % fn_name)
            continue
        try:
            fn()
            print("[media] media.%s() 成功" % fn_name)
        except Exception as e:
            print("[media] media.%s() 失败：%s（若例程里没有这一步，可删掉调用）" % (fn_name, e))


def _init_camera():
    """初始化相机，返回相机对象；失败抛 RuntimeError。"""
    global _CAM
    if _CAM_STYLE == "media.sensor":
        candidate = Sensor()      # TODO(手册核对 1): 有的固件要 Sensor(id=0) 或 Sensor(width=, height=)
        _CAM = candidate
        _safe_cam_call(candidate, "reset")
        _set_framesize(candidate)
        _set_pixformat(candidate)
        _init_media_pipeline()
        if DEBUG_API:
            print("[cam] dir(sensor) = %s" % dir(candidate))
        return candidate

    if _CAM_STYLE == "sensor-module":
        _CAM = _omv_sensor
        _safe_cam_call(_omv_sensor, "reset")
        _set_framesize(_omv_sensor)
        _set_pixformat(_omv_sensor)
        _init_media_pipeline()
        if DEBUG_API:
            print("[cam] dir(sensor) = %s" % dir(_omv_sensor))
        return _omv_sensor

    raise RuntimeError(
        "找不到相机模块：`from media.sensor import Sensor` 和 `import sensor` 都失败。"
        "请按 README 第 9 节 #1 对照手册，改本文件顶部的相机初始化区。")


def _capture(cam):
    """抓一帧。

    TODO(手册核对 1)：CanMV K230 例程一般是 cam.snapshot()；
    如果手册里是 snapshot(chn=CAM_CHN_ID_0) 之类，把这里改成对应写法。
    """
    return cam.snapshot()


# -----------------------------------------------------------------------------
# JPEG 编码
# -----------------------------------------------------------------------------
def _check_jpeg(data):
    """检查 data 是不是一帧 JPEG。返回 (ok, 原因)。"""
    if data is None:
        return False, "返回 None"
    if not isinstance(data, (bytes, bytearray)):
        return False, "返回类型不是 bytes（实际 %s）" % str(type(data))
    if len(data) < 4:
        return False, "只有 %d 字节" % len(data)
    if data[0] != 0xFF or data[1] != 0xD8:
        return False, "开头不是 FFD8（不是 JPEG，可能是 PNG/RAW）"
    if len(data) >= 2 and not (data[-2] == 0xFF and data[-1] == 0xD9):
        print("[jpeg] 提示：JPEG 结尾不是 FFD9，可能被截断（先继续试，若 H5 花屏换候选）")
    return True, ""


def _try_compress(img):
    """候选 A：img.compress(quality=..) -> JPEG bytes。"""
    fn = getattr(img, "compress", None)
    if fn is None:
        return None, "image 对象没有 compress()"
    last = "未知原因"
    for kwargs in ({"quality": JPEG_QUALITY}, {}):
        try:
            data = fn(**kwargs)
        except TypeError as e:
            last = "参数不匹配：%s" % e
            continue
        except Exception as e:
            return None, "调用异常：%s" % e
        ok, why = _check_jpeg(data)
        if ok:
            return data, None
        last = why
    return None, last


def _save_img(img):
    """候选 B：img.save(path) 存成文件再读回来。返回 (path, data, 原因)。"""
    fn = getattr(img, "save", None)
    if fn is None:
        return None, None, "image 对象没有 save()"
    last = "所有候选路径都失败"
    for path in ("/sdcard/test.jpg", "/data/test.jpg", "/tmp/test.jpg", "/ram/test.jpg"):
        try:
            try:
                fn(path)
            except TypeError:
                fn(path, quality=JPEG_QUALITY)
        except Exception as e:
            last = "%s 写入失败：%s" % (path, e)
            continue
        try:
            f = open(path, "rb")
            data = f.read()
            f.close()
        except Exception as e:
            last = "%s 读回失败：%s" % (path, e)
            continue
        ok, why = _check_jpeg(data)
        if ok:
            return path, data, None
        last = "%s 里不是 JPEG：%s" % (path, why)
    return None, None, last


def _describe_api(img):
    """打印 image 对象上和 JPEG 编码相关的方法，方便按手册核对。"""
    try:
        names = dir(img)
    except Exception:
        print("[jpeg] 取不到 dir(img)")
        return
    hits = []
    for key in ("compress", "save", "jpeg", "jpg", "to_", "size", "width", "height", "format"):
        for name in names:
            if key in name.lower() and name not in hits:
                hits.append(name)
    print("[jpeg] img 上与编码/尺寸相关：%s" % hits)
    print("[jpeg] dir(img) 共 %d 项：%s" % (len(names), names))


def encode_jpeg(img):
    """把 image 对象编码成 JPEG bytes，返回 (jpg_bytes, 说明)。失败抛 RuntimeError。

    TODO(手册核对 2)：K230 上把 img 变成 JPEG bytes 的 API。
    候选 A（默认）：img.compress(quality=JPEG_QUALITY) -> bytes   —— OpenMV/CanMV 常见
    候选 B：img.save("/sdcard/xxx.jpg") 再 open() 读回来          —— 兼容性好，但慢、会写卡
    候选 C：硬件/媒体编码器（K230 VENC 之类）—— 需手册确认，确定后在这里补 3—5 行，
            不要照抄任何猜出来的函数名。
    判断依据 & 验证方法见 README 第 9 节 #2。
    """
    global _ENCODE_OK

    # ---- 候选 A ----
    if _ENCODE_OK in (None, "A"):
        data, why = _try_compress(img)
        if data is not None:
            _ENCODE_OK = "A"
            return data, "A: img.compress(quality=%d)" % JPEG_QUALITY
        if _ENCODE_OK is None:
            print("[jpeg] 候选 A（img.compress）不可用：%s" % why)

    # ---- 候选 B ----
    if _ENCODE_OK in (None, "B"):
        path, data, why = _save_img(img)
        if data is not None:
            _ENCODE_OK = "B"
            return data, "B: img.save(%s) + 读回文件" % path
        if _ENCODE_OK is None:
            print("[jpeg] 候选 B（img.save）不可用：%s" % why)

    # ---- 候选 C 占位 ----
    # TODO(手册核对 2)：如果你的手册里有硬件/媒体 JPEG 编码接口，把代码补在这里，
    #                   并把返回的 bytes 交给调用方（同样要求开头是 FFD8）。
    _describe_api(img)
    raise RuntimeError(
        "JPEG 编码失败：候选 A（img.compress）和候选 B（img.save）都不可用。"
        "请按 README 第 9 节 #2 对照手册补『候选 C』。")


# -----------------------------------------------------------------------------
# 自检：首帧打印信息 + 存一张本地样张
# -----------------------------------------------------------------------------
def _print_dim(img):
    out = []
    for attr in ("size", "width", "height"):
        v = getattr(img, attr, None)
        if v is None:
            continue
        try:
            if callable(v):
                out.append("%s()=%s" % (attr, v()))
            else:
                out.append("%s=%s" % (attr, v))
        except Exception as e:
            out.append("%s 调用失败(%s)" % (attr, e))
    if out:
        print("[自检] 图像尺寸：%s" % (", ".join(out)))
    else:
        print("[自检] 取不到图像尺寸（不影响推流，服务端会用 X-Width/X-Height 头部）")


def _selftest(img, how, jpg_len):
    """首帧自检（只跑一次）。

    验证顺序（README 第 4 节也写了）：
      1) 打印图像对象尺寸，确认分辨率对不对；
      2) 确认 JPEG 编码候选 + 首帧大小是否正常（640x360 q60 一般 15—40 KB）；
      3) 存一张本地样张 test.jpg，用电脑打开确认画面正常（不是花屏/黑屏）。
    """
    print("-" * 60)
    print("[自检] 相机已出图，图像对象：%s" % str(type(img)))
    _print_dim(img)
    print("[自检] JPEG 编码候选：%s" % how)
    print("[自检] 首帧 JPEG 大小：%.1f KB（640x360 q60 一般 15—40 KB）" % (jpg_len / 1024.0))
    if DEBUG_API:
        try:
            print("[自检] dir(img) = %s" % dir(img))
        except Exception:
            pass

    global _SAVE_OK_PATH
    path, data, why = _save_img(img)
    if path is not None:
        _SAVE_OK_PATH = path
        print("[自检] 已存本地样张：%s（%.1f KB）" % (path, len(data) / 1024.0))
        print("[自检] 把 TF 卡插电脑 / 或用 CanMV IDE 文件页打开这张图，")
        print("[自检] 确认画面正常（不花屏、不黑屏、分辨率对），再去看 H5。")
    else:
        print("[自检] 本地存样张失败：%s（不影响网络推流，只是少一种验证手段）" % why)
    print("-" * 60)


# -----------------------------------------------------------------------------
# HTTP：POST 一帧 JPEG
# -----------------------------------------------------------------------------
def _new_socket():
    try:
        return socket.socket(socket.AF_INET, socket.SOCK_STREAM)   # 候选：标准写法
    except Exception:
        return socket.socket()                                     # 候选：极简固件只支持无参


def _send_all(sock, data):
    """把 data 全部发出去；MicroPython 的 send 可能只发一部分，所以循环发。"""
    total = 0
    n = len(data)
    while total < n:
        sent = sock.send(data[total:])
        if sent is None:
            sent = 0
        if sent <= 0:
            raise OSError("socket 发送失败（本次发出 %s 字节）" % sent)
        total += sent
    return total


def _recv_head(sock, limit=512):
    """读 HTTP 响应头；读满 limit 或遇到空行 / 超时就返回。"""
    buf = b""
    while len(buf) < limit:
        try:
            chunk = sock.recv(256)
        except OSError:
            break
        if not chunk:
            break
        buf += chunk
        if b"\r\n\r\n" in buf:
            break
    return buf


def _decode(data):
    try:
        return data.decode("utf-8")
    except Exception:
        try:
            return data.decode("latin-1")
        except Exception:
            return str(data[:200])


def _now_str():
    """本地时间字符串。板子没对时时钟可能不准，所以 SEND_FRAME_TS 默认 False。"""
    try:
        t = time.localtime()
        return "%04d-%02d-%02d %02d:%02d:%02d" % (t[0], t[1], t[2], t[3], t[4], t[5])
    except Exception:
        return str(int(time.time()))


def _post_jpeg(jpg, seq):
    """POST 一帧 JPEG 到 /api/device/frame；返回 (状态行, 响应体前段)。失败抛异常。"""
    n = len(jpg)
    head = (
        "POST %s HTTP/1.1\r\n"
        "Host: %s:%d\r\n"
        "Content-Type: image/jpeg\r\n"
        "Content-Length: %d\r\n"
        "Connection: close\r\n"
        "X-Device-Id: %s\r\n"
        "X-Width: %d\r\n"
        "X-Height: %d\r\n"
        "X-Seq: %d\r\n"
        % (API_PATH, SERVER_HOST, SERVER_PORT, n, DEVICE_ID, _W, _H, seq)
    )
    if SEND_FRAME_TS:
        head += "X-Frame-Ts: %s\r\n" % _now_str()
    if DEVICE_TOKEN:
        head += "X-Device-Token: %s\r\n" % DEVICE_TOKEN

    req = head.encode() + b"\r\n"       # 头部以空行结束，后面紧跟 JPEG 原始字节

    sock = _new_socket()
    try:
        try:
            sock.settimeout(HTTP_TIMEOUT_S)    # TODO(手册核对 5): 极少数固件没有 settimeout
        except Exception:
            pass
        sock.connect((SERVER_HOST, SERVER_PORT))
        _send_all(sock, req)
        _send_all(sock, jpg)
        raw = _recv_head(sock)
    finally:
        try:
            sock.close()
        except Exception:
            pass

    text = _decode(raw)
    if not text:
        raise OSError("服务端无响应（连接已建立但没回 HTTP 头）")

    status_line = text.split("\r\n", 1)[0]
    body = ""
    idx = text.find("\r\n\r\n")
    if idx >= 0:
        body = text[idx + 4:].strip()

    code = 0
    parts = status_line.split(" ")
    if len(parts) >= 2:
        try:
            code = int(parts[1])
        except Exception:
            code = 0
    if code == 0:
        raise OSError("HTTP 响应不合法：%s" % status_line[:80])
    if code != 200:
        raise OSError("HTTP %d：%s" % (code, (body or status_line)[:150]))
    return status_line, body[:200]


# -----------------------------------------------------------------------------
# 主循环
# -----------------------------------------------------------------------------
def _net_hint():
    return ("[提示] 发送失败先查这 4 条：\n"
            "  ① 电脑 IP 是否填对、和 K230 是否同网段（前三段一样）；\n"
            "  ② 电脑防火墙是否放行了 8765 端口；\n"
            "  ③ 服务端是否用 --host 0.0.0.0 启动（默认 127.0.0.1 时 K230 连不上！）；\n"
            "  ④ 从电脑能不能 ping 通 K230 的 IP（见 README 第 8 节）。")


def main():
    _print_header()

    if not connect_wifi():
        print("[wifi] 继续尝试运行；若一直发送失败，先解决联网问题（README 第 2 节）")

    # 相机初始化（失败每 3 秒重试，不直接退出）
    cam = None
    while cam is None:
        try:
            cam = _init_camera()
        except Exception as e:
            print("[fatal] 相机初始化失败：%s" % e)
            print("[fatal] 3 秒后重试（按 README 第 9 节 #1 核对相机初始化，改完重启脚本）")
            gc.collect()
            time.sleep(3)

    print("[push] 开始推流：http://%s:%d%s" % (SERVER_HOST, SERVER_PORT, API_PATH))

    seq = 0
    selftest_done = False
    first_ok = False
    fail_streak = 0
    err_streak = 0
    backoff_s = RECONNECT_S
    win_frames = 0
    win_bytes = 0
    win_t0 = _now_ms()

    while True:
        t0 = _now_ms()
        try:
            # WiFi 掉线：重连一下再继续（不影响相机）
            if not _wifi_ok():
                print("[wifi] 检测到掉线，尝试重连 ...")
                connect_wifi()
                time.sleep(1.0)
                continue

            img = _capture(cam)
            jpg, how = encode_jpeg(img)

            if not selftest_done:
                if SELFTEST_ONCE:
                    _selftest(img, how, len(jpg))
                selftest_done = True

            if len(jpg) > MAX_UPLOAD_BYTES:
                raise ValueError(
                    "单帧 %.1f KB 超过服务端上限 3 MB：把 JPEG_QUALITY 降到 50，"
                    "或 RESOLUTION 改成 480x270" % (len(jpg) / 1024.0))

            seq += 1
            try:
                status_line, body = _post_jpeg(jpg, seq)
                fail_streak = 0
                backoff_s = RECONNECT_S
                err_streak = 0
                win_frames += 1
                win_bytes += len(jpg)

                if not first_ok:
                    first_ok = True
                    print("[push] 首帧已送达：%s" % status_line)
                    if body:
                        print("[push] 服务端回应：%s" % body)
                    print("[push] 现在去电脑上看：http://%s:%d/api/camera/status （mode 应为 push、online=true）"
                          % (SERVER_HOST, SERVER_PORT))
                elif seq % max(PRINT_EVERY, 1) == 0:
                    dt_s = _ms_diff(_now_ms(), win_t0) / 1000.0
                    if dt_s <= 0:
                        dt_s = 1e-6
                    avg_kb = (win_bytes / win_frames) / 1024.0 if win_frames else 0.0
                    print("[push] 第 %d 帧 | %.1f fps | 平均 %.1f KB/帧 | %.0f kbps | %s"
                          % (seq, win_frames / dt_s, avg_kb, win_bytes * 8 / dt_s / 1000.0, status_line))
                    win_frames = 0
                    win_bytes = 0
                    win_t0 = _now_ms()

                if seq % max(GC_EVERY, 1) == 0:
                    gc.collect()

            except Exception as e:
                fail_streak += 1
                print("[push] 发送失败（连续 %d 次）：%s" % (fail_streak, e))
                if fail_streak == 1:
                    print(_net_hint())
                elif fail_streak >= 8:
                    print("[push] 连续失败较多，先按上面的提示排查；脚本会继续自动重试。")
                time.sleep(backoff_s)
                backoff_s = min(backoff_s * 1.5, MAX_BACKOFF_S)
                continue

        except Exception as e:
            # 抓帧/编码异常：不崩，计数 + 必要时重新初始化相机
            err_streak += 1
            print("[fatal] 本帧异常（连续 %d 次）：%s" % (err_streak, e))
            gc.collect()
            if err_streak >= 5:
                print("[fatal] 连续异常，尝试重新初始化相机 ...")
                try:
                    cam = _init_camera()
                    err_streak = 0
                    selftest_done = True   # 不再重复存样张
                except Exception as e2:
                    print("[fatal] 相机重初始化失败：%s；5 秒后继续" % e2)
                    time.sleep(5)
            else:
                time.sleep(1.0)

        _wait_frame(t0)


# -----------------------------------------------------------------------------
# 入口
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("[main] 已停止（Ctrl+C）")
    except Exception as _e:
        # 顶层兜底：尽量打印完整 traceback（MicroPython 有 sys.print_exception）
        try:
            pr = getattr(sys, "print_exception", None)
            if pr is not None:
                pr(_e)
            else:
                raise
        except Exception:
            print("[main] 顶层异常：%s" % _e)
