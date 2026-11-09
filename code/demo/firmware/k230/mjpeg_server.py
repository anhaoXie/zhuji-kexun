# -*- coding: utf-8 -*-
"""
《株迹可循》· CanMV K230 实时图传 —— 方式 B：K230 板载 MJPEG 服务

做什么
------
K230 自己开一个 HTTP 服务（默认 0.0.0.0:8080）：
    GET /             -> 一个简单预览页（内嵌 <img src="/stream">，浏览器直接看）
    GET /stream       -> multipart/x-mixed-replace 的 MJPEG 流（浏览器/无客户端可看）
    GET /snapshot.jpg -> 单帧 JPEG（截图/调试用）
H5 那边让服务端用 "mjpeg 直连" 模式指向本机流：
    python server/app.py --host 0.0.0.0 --camera-mode mjpeg --camera-url http://<K230_IP>:8080/stream

运行位置
--------
本文件是跑在 K230 板子上的 MicroPython 脚本，不是电脑上跑的 Python。
用 CanMV IDE 打开 / 上传到板子（建议存成 /sdcard/mjpeg_server.py）后直接运行。

与 push_frames.py 的关系
------------------------
方式 A（push_frames.py）是 K230 主动把帧 POST 给电脑，电脑端有帧缓存、H5 自动切换，推荐先试；
本文件是方式 B：不经过电脑端缓存，H5 直接看 K230 自己的流（少一跳，但只能一个客户端看）。
两个脚本都只改【① 用户必改】；相机/编码那段和 push_frames.py 完全一样，标号也一致。

关于“不要编造 API”
------------------
凡是标了 `# TODO(手册核对 N)` 的地方，都是没有 K230 硬件时无法 100% 确认的 API，
每处都写了【候选 A/B/C】+ 判断依据 + 验证方法，与 README.md 第 9 节编号一一对应。
"""

# =============================================================================
# ①【用户必改】2 行（联网）+ 需要时改端口
# =============================================================================
WIFI_SSID = "YOUR_WIFI_2G"           # 只支持 2.4G；5G 热点 K230 连不上
WIFI_PASSWORD = "YOUR_PASSWORD"
BIND_HOST = "0.0.0.0"                # 0.0.0.0 = 局域网内其它设备（电脑/手机）都能访问
PORT = 8080                          # 端口别和电脑 8765 混；被占用就换 8081

# =============================================================================
# ② 图像 / 推流参数（先别动，跑通再调）
# =============================================================================
FPS = 5                              # MJPEG 帧率；2.4G WiFi 下 5 fps 比较稳
RESOLUTION = "640x360"               # 目标分辨率；可试 "640x480" / "480x270"
JPEG_QUALITY = 60                    # 60 画质够用；花屏/带宽紧可降到 50
DEVICE_NAME = "k230-01"
STREAM_MAX_SECONDS = 0               # 单条 /stream 最长持续秒数；0 = 不限（H5 常连就用 0）

# =============================================================================
# ③ 调试 / 容错参数（一般不用改）
# =============================================================================
SELFTEST_ONCE = True                 # 启动时：打印 API 信息 + 存一张 /sdcard/test.jpg
DEBUG_API = False                    # True：打印 dir(img)/dir(sensor)
PRINT_EVERY = 30                     # 每多少帧打印一次 fps（流里）
GC_EVERY = 10                        # 每多少帧 gc.collect() 一次
MAX_HEADER_BYTES = 2048              # 单次请求头最大字节
ACCEPT_BACKOFF_S = 0.5               # accept/处理异常后的退避

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
# 相机/媒体库探测（与 push_frames.py 一致）
#   TODO(手册核对 1)：候选 A = from media.sensor import Sensor；候选 B = import sensor
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

_CAM = None
_WLAN = None
_SAVE_OK_PATH = None
_ENCODE_OK = None

# 预览页（H5 不用它，是给人在浏览器里快速确认画面用的）
_INDEX_HTML = (
    "<!doctype html><html><head><meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>K230 MJPEG</title></head>"
    "<body style='margin:0;padding:12px;background:#111;color:#eee;"
    "font-family:sans-serif'>"
    "<h3 style='margin:4px 0 10px'>CanMV K230 · MJPEG 预览</h3>"
    "<img src='/stream' style='width:100%;max-width:960px;background:#000'>"
    "<p style='font-size:13px;color:#aaa'>"
    "流地址 /stream · 单帧 <a style='color:#6cf' href='/snapshot.jpg'>/snapshot.jpg</a>"
    "</p></body></html>"
).encode("utf-8")


def _now_ms():
    fn = getattr(time, "ticks_ms", None)
    if fn is not None:
        try:
            return fn()
        except Exception:
            pass
    return int(time.time() * 1000)


def _ms_diff(now, before):
    fn = getattr(time, "ticks_diff", None)
    if fn is not None:
        try:
            return fn(now, before)
        except Exception:
            pass
    return now - before


def _print_header():
    print("")
    print("=" * 60)
    print(" 株迹可循 · CanMV K230 实时图传（方式 B：板载 MJPEG 服务）")
    print("=" * 60)
    print("[cfg] 监听：%s:%d（手机/电脑同一局域网可访问）" % (BIND_HOST, PORT))
    print("[cfg] 帧率 %d fps | 目标分辨率 %dx%d | JPEG 质量 %d | 设备号 %s"
          % (FPS, _W, _H, JPEG_QUALITY, DEVICE_NAME))
    print("[cfg] 相机写法探测：%s" % (_CAM_STYLE or "未找到（见 README 第 9 节 #1）"))
    print("=" * 60)


# -----------------------------------------------------------------------------
# WiFi（与 push_frames.py 一致）
# -----------------------------------------------------------------------------
def _print_network_hint():
    print("[wifi] 提示：① 只连 2.4G（5G 连不上）② SSID/密码区分大小写 "
          "③ 中文/特殊字符 SSID 建议改成英文 ④ 板子与电脑要在同一路由器/热点下")


def connect_wifi(timeout_ms=20000):
    """连接 WiFi（STA）。返回 True=连上了/不需要连；False=没连上。

    TODO(手册核对 4)：候选 A = network.WLAN(network.STA_IF)；
    候选 B = 只有 network.LAN()；候选 C = 没有 network 模块（系统已联网）。
    判断依据 & 验证方法见 README 第 9 节 #4。
    """
    global _WLAN

    if (not WIFI_SSID) or WIFI_SSID.startswith("YOUR_"):
        print("[wifi] WIFI_SSID 还是占位符，跳过联网（假设板子已联网）")
        return True

    try:
        import network
    except ImportError:
        print("[wifi] 没有 network 模块（候选 C）：假设系统已联网，直接起 HTTP 服务")
        return True

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
                    _WLAN.connect(WIFI_SSID, WIFI_PASSWORD)   # TODO(手册核对 4)
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

    if hasattr(network, "LAN"):
        print("[wifi] 固件没有 WLAN、只有 LAN（候选 B），请先插网线或见 README 第 9 节 #4")
        try:
            _WLAN = network.LAN()
            _WLAN.active(True)
            print("[wifi] LAN 已启用，ifconfig = %s" % (_WLAN.ifconfig(),))
            return True
        except Exception as e:
            print("[wifi] LAN 启用失败：%s" % e)

    print("[wifi] 没能用 network 模块联网；dir(network) = %s" % dir(network))
    return False


# -----------------------------------------------------------------------------
# 相机初始化（与 push_frames.py 一致）
# -----------------------------------------------------------------------------
def _owner():
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
    """TODO(手册核对 3)：候选 A = set_framesize(width=, height=)；候选 B = 常量 VGA/QVGA/HD。"""
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
            print("[cam] 分辨率候选 B 成功：set_framesize(%s)" % name)
            return True
        except Exception as e:
            print("[cam] 候选 B set_framesize(%s) 失败：%s" % (name, e))

    print("[cam] 警告：两种分辨率写法都没成功，将用上电默认分辨率（自检会打印实际尺寸）")
    return False


def _set_pixformat(cam):
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
    """TODO(手册核对 1)：候选 A = from media.media import media; media.init()/media.start()。"""
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
    global _CAM
    if _CAM_STYLE == "media.sensor":
        candidate = Sensor()      # TODO(手册核对 1)
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
    """TODO(手册核对 1)：K230 例程一般是 cam.snapshot()；若手册写法不同，改这里。"""
    return cam.snapshot()


# -----------------------------------------------------------------------------
# JPEG 编码（与 push_frames.py 一致）
# -----------------------------------------------------------------------------
def _check_jpeg(data):
    if data is None:
        return False, "返回 None"
    if not isinstance(data, (bytes, bytearray)):
        return False, "返回类型不是 bytes（实际 %s）" % str(type(data))
    if len(data) < 4:
        return False, "只有 %d 字节" % len(data)
    if data[0] != 0xFF or data[1] != 0xD8:
        return False, "开头不是 FFD8（不是 JPEG）"
    if not (data[-2] == 0xFF and data[-1] == 0xD9):
        print("[jpeg] 提示：JPEG 结尾不是 FFD9，可能被截断（若浏览器花屏就换编码候选）")
    return True, ""


def _try_compress(img):
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
    """把 image 对象编码成 JPEG bytes。失败抛 RuntimeError。

    TODO(手册核对 2)：候选 A = img.compress(quality=..)；候选 B = img.save() + 读文件；
    候选 C = 手册里的硬件编码接口（自己补 3—5 行，不要照抄猜测的函数名）。
    """
    global _ENCODE_OK

    if _ENCODE_OK in (None, "A"):
        data, why = _try_compress(img)
        if data is not None:
            _ENCODE_OK = "A"
            return data, "A: img.compress(quality=%d)" % JPEG_QUALITY
        if _ENCODE_OK is None:
            print("[jpeg] 候选 A（img.compress）不可用：%s" % why)

    if _ENCODE_OK in (None, "B"):
        path, data, why = _save_img(img)
        if data is not None:
            _ENCODE_OK = "B"
            return data, "B: img.save(%s) + 读回文件" % path
        if _ENCODE_OK is None:
            print("[jpeg] 候选 B（img.save）不可用：%s" % why)

    _describe_api(img)
    raise RuntimeError(
        "JPEG 编码失败：候选 A（img.compress）和候选 B（img.save）都不可用。"
        "请按 README 第 9 节 #2 对照手册补『候选 C』。")


# -----------------------------------------------------------------------------
# 自检（启动时跑一次）
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
        print("[自检] 取不到图像尺寸（不影响出流）")


def _selftest(img, how, jpg_len):
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
        print("[自检] 用电脑打开这张图确认画面正常（不花屏/不黑屏/分辨率对）。")
    else:
        print("[自检] 本地存样张失败：%s（不影响出流）" % why)
    print("-" * 60)


# -----------------------------------------------------------------------------
# HTTP 工具
# -----------------------------------------------------------------------------
def _new_socket():
    try:
        return socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    except Exception:
        return socket.socket()


def _send_all(sock, data):
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


def _close(sock):
    try:
        sock.close()
    except Exception:
        pass


def _send_reply(conn, status, content_type, body):
    """发一个带 Content-Length 的普通 HTTP 响应（并关闭连接）。"""
    head = ("HTTP/1.1 %s\r\n"
            "Content-Type: %s\r\n"
            "Content-Length: %d\r\n"
            "Cache-Control: no-store\r\n"
            "Access-Control-Allow-Origin: *\r\n"
            "Connection: close\r\n"
            "\r\n" % (status, content_type, len(body)))
    try:
        _send_all(conn, head.encode())
        if body:
            _send_all(conn, body)
    except Exception as e:
        print("[http] 回复失败：%s" % e)
    finally:
        _close(conn)


def _read_request(conn):
    """返回 (method, path)；读不到返回 None。"""
    buf = b""
    try:
        while len(buf) < MAX_HEADER_BYTES and b"\r\n\r\n" not in buf:
            chunk = conn.recv(256)
            if not chunk:
                break
            buf += chunk
    except Exception as e:
        print("[http] 读请求失败：%s" % e)
        return None

    if not buf:
        return None
    try:
        text = buf.decode("utf-8")
    except Exception:
        try:
            text = buf.decode("latin-1")
        except Exception:
            return None
    first = text.split("\r\n", 1)[0]
    parts = first.split(" ")
    if len(parts) < 2:
        return None
    return parts[0], parts[1]


def _serve_snapshot(conn):
    """GET /snapshot.jpg：现抓一帧发回去。"""
    try:
        img = _capture(_CAM)
        jpg, _how = encode_jpeg(img)
    except Exception as e:
        _send_reply(conn, "500 Internal Server Error", "text/plain; charset=utf-8",
                    ("取帧失败：%s" % e).encode("utf-8"))
        return

    head = ("HTTP/1.1 200 OK\r\n"
            "Content-Type: image/jpeg\r\n"
            "Content-Length: %d\r\n"
            "Cache-Control: no-store\r\n"
            "Access-Control-Allow-Origin: *\r\n"
            "Connection: close\r\n"
            "\r\n" % len(jpg))
    try:
        _send_all(conn, head.encode())
        _send_all(conn, jpg)
        print("[http] /snapshot.jpg 已发（%.1f KB）" % (len(jpg) / 1024.0))
    except Exception as e:
        print("[http] /snapshot.jpg 发送失败：%s" % e)
    finally:
        _close(conn)


def _serve_stream(conn):
    """GET /stream：multipart/x-mixed-replace 持续发帧，直到对端断开或到达 STREAM_MAX_SECONDS。

    注意：本函数会一直占着主循环（单线程），所以同一时间只能服务一个客户端。
    用 H5 图传页时这是期望行为；想在浏览器另开 /snapshot.jpg 验证，先关掉占用流的页面
    （或把 STREAM_MAX_SECONDS 设成 30 让流自己到期结束）。原因/后续方案见 README 第 5/8 节。
    """
    head = ("HTTP/1.1 200 OK\r\n"
            "Content-Type: multipart/x-mixed-replace; boundary=frame\r\n"
            "Cache-Control: no-store\r\n"
            "Connection: close\r\n"
            "\r\n")
    try:
        _send_all(conn, head.encode())
    except Exception as e:
        print("[stream] 发响应头失败（客户端可能已断开）：%s" % e)
        _close(conn)
        return

    period_ms = int(1000 / max(FPS, 1))
    frames = 0
    sent_bytes = 0
    t_start = _now_ms()
    win_frames = 0
    win_t0 = _now_ms()

    print("[stream] 开始推流（%d fps，%dx%d，q%d）" % (FPS, _W, _H, JPEG_QUALITY))
    try:
        while True:
            t0 = _now_ms()
            img = _capture(_CAM)
            jpg, _how = encode_jpeg(img)

            part_head = ("--frame\r\n"
                         "Content-Type: image/jpeg\r\n"
                         "Content-Length: %d\r\n"
                         "\r\n" % len(jpg)).encode()
            _send_all(conn, part_head)
            _send_all(conn, jpg)
            frames += 1
            win_frames += 1
            sent_bytes += len(jpg)
            _send_all(conn, b"\r\n")

            if frames % max(PRINT_EVERY, 1) == 0:
                dt_s = _ms_diff(_now_ms(), win_t0) / 1000.0
                if dt_s <= 0:
                    dt_s = 1e-6
                print("[stream] 已发 %d 帧 | %.1f fps | %.0f kbps | 累计 %.1f KB"
                      % (frames, win_frames / dt_s,
                         sent_bytes * 8 / max(_ms_diff(_now_ms(), t_start) / 1000.0, 1e-6) / 1000.0,
                         sent_bytes / 1024.0))
                win_frames = 0
                win_t0 = _now_ms()

            if frames % max(GC_EVERY, 1) == 0:
                gc.collect()

            if STREAM_MAX_SECONDS and _ms_diff(_now_ms(), t_start) >= STREAM_MAX_SECONDS * 1000:
                print("[stream] 到达 STREAM_MAX_SECONDS=%d，主动结束本次流" % STREAM_MAX_SECONDS)
                break

            dt = _ms_diff(_now_ms(), t0)
            if dt < period_ms:
                time.sleep((period_ms - dt) / 1000.0)
    except Exception as e:
        # 最常见：浏览器关页面/切走 -> 对端断开 -> send 报 OSError，属于正常现象
        print("[stream] 客户端断开或发送异常（正常现象）：%s" % e)
    finally:
        _close(conn)
        print("[stream] 本次流结束，共发 %d 帧" % frames)


def _handle_client(conn, addr):
    req = _read_request(conn)
    if req is None:
        print("[http] 来自 %s 的请求解析失败，返回 400" % (addr,))
        _send_reply(conn, "400 Bad Request", "text/plain; charset=utf-8", b"bad request")
        return

    method, path = req
    if "?" in path:
        path = path.split("?", 1)[0]
    print("[http] %s %s（来自 %s）" % (method, path, addr))

    if method not in ("GET", "HEAD"):
        _send_reply(conn, "405 Method Not Allowed", "text/plain; charset=utf-8",
                    b"only GET supported")
        return

    if path in ("/", "/index.html"):
        _send_reply(conn, "200 OK", "text/html; charset=utf-8", _INDEX_HTML)
        return

    if path == "/stream":
        _serve_stream(conn)
        return

    if path in ("/snapshot.jpg", "/snapshot", "/latest.jpg"):
        _serve_snapshot(conn)
        return

    if path == "/favicon.ico":
        _send_reply(conn, "204 No Content", "image/x-icon", b"")
        return

    _send_reply(conn, "404 Not Found", "text/plain; charset=utf-8",
                ("404 Not Found：%s\n可用的路径：/  /stream  /snapshot.jpg" % path).encode("utf-8"))


# -----------------------------------------------------------------------------
# 主流程
# -----------------------------------------------------------------------------
def _prepare_camera():
    """初始化相机并抓首帧自检；失败重试 5 次。返回 True/False。"""
    global _CAM
    for attempt in range(1, 6):
        try:
            _CAM = _init_camera()
            img = _capture(_CAM)
            jpg, how = encode_jpeg(img)
            if SELFTEST_ONCE:
                _selftest(img, how, len(jpg))
            return True
        except Exception as e:
            print("[cam] 相机初始化/首帧失败（第 %d 次）：%s；2 秒后重试" % (attempt, e))
            gc.collect()
            time.sleep(2)
    return False


def main():
    _print_header()

    if not connect_wifi():
        print("[wifi] 继续尝试启动服务；若电脑访问不到，先解决联网问题（README 第 2 节）")

    if not _prepare_camera():
        print("[fatal] 相机一直没准备好，退出。请按 README 第 9 节 #1/#2 核对后重跑。")
        return

    srv = _new_socket()
    try:
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)   # 候选：极简固件可能没有这两个常量
    except Exception:
        pass

    try:
        srv.bind((BIND_HOST, PORT))
    except Exception as e:
        print("[fatal] bind(%s:%d) 失败：%s" % (BIND_HOST, PORT, e))
        print("[fatal] 可能原因：端口被占用（把 PORT 改成 8081）；或 BIND_HOST 写法不被支持。")
        _close(srv)
        return

    try:
        srv.listen(2)        # 候选：个别固件 listen() 不带参数
    except TypeError:
        srv.listen()

    print("[mjpeg] HTTP 服务已启动")
    print("[mjpeg] 浏览器打开：http://<K230 的 IP>:%d/ （预览页）" % PORT)
    print("[mjpeg] 流地址：     http://<K230 的 IP>:%d/stream" % PORT)
    print("[mjpeg] 单帧：       http://<K230 的 IP>:%d/snapshot.jpg" % PORT)
    if _WLAN is not None:
        try:
            print("[mjpeg] 本机 IP（ifconfig）：%s" % (_WLAN.ifconfig(),))
        except Exception:
            pass
    print("[mjpeg] 提示：单线程，同一时间只服务一个客户端（H5 图传页占流时，"
          "别的设备要等它断开；见 README 第 8 节）")

    while True:
        try:
            conn, addr = srv.accept()
            _handle_client(conn, addr)
        except KeyboardInterrupt:
            print("[mjpeg] 收到 Ctrl+C，关闭服务")
            break
        except Exception as e:
            print("[fatal] accept/处理异常：%s（继续监听）" % e)
            gc.collect()
            time.sleep(ACCEPT_BACKOFF_S)

    _close(srv)


# -----------------------------------------------------------------------------
# 入口
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("[main] 已停止（Ctrl+C）")
    except Exception as _e:
        try:
            pr = getattr(sys, "print_exception", None)
            if pr is not None:
                pr(_e)
            else:
                raise
        except Exception:
            print("[main] 顶层异常：%s" % _e)
