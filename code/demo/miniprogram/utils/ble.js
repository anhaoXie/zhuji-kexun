// utils/ble.js —— BLE 控车骨架（仅在真机可用，微信开发者工具不支持蓝牙模块）
//
// 硬件链路（见 ../docs/BUILD_SPEC.md 第 0 节）：
//   ESP32-C3（WiFi + BLE）经 UART3 接 STM32F103ZET6 主控；BLE 侧把小程序指令转成
//   设计说明协议帧：0x40 PCMD（控制）/ 0x50 BCMD（业务命令）/ 0x30 TEL（遥测）/ 0x51 BSTATE（业务状态）。
//
// 本文件只提供流程骨架 + 错误码映射，所有 UUID 与帧编码均为 TODO，需要固件同伴提供后填入。
// 真机调试步骤：手机微信 → 开发版小程序 → 打开蓝牙 → 授权 → 页面调用 hasBLE() 判断可用性。
//
// 安全说明：小程序 BLE 控车只在“远程模式”下允许；2.4G 遥控器始终最高优先级；
// 链路失联 500 ms 必须停车（由 ESP32-C3 固件侧兜底）。

var SERVICE_UUID = ''; // TODO: ESP32-C3 BLE 服务 UUID，例如 '0000FFE0-0000-1000-8000-00805F9B34FB'
var CHAR_WRITE_UUID = ''; // TODO: 接收 PCMD(0x40) 的可写特征值 UUID
var CHAR_NOTIFY_UUID = ''; // TODO: 上报 TEL(0x30)/BSTATE(0x51) 的 notify 特征值 UUID
var DEVICE_NAME_PREFIX = 'ZhuJi-'; // TODO: 与固件约定的广播名前缀

var adapterReady = false;
var connectedDeviceId = '';
var notifyEnabled = false;

/** 蓝牙错误码 -> 人话（微信官方错误码表） */
var BLE_ERROR_TEXT = {
  10000: '未初始化蓝牙适配器',
  10001: '当前蓝牙不可用（未打开蓝牙或系统不支持）',
  10002: '没有找到指定设备',
  10003: '连接失败',
  10004: '没有找到指定服务',
  10005: '没有找到指定特征值',
  10006: '当前连接已断开',
  10007: '当前特征值不支持此操作',
  10008: '其余所有系统上报的异常',
  10009: '系统版本过低，不支持 BLE',
  10012: '连接超时',
  10013: '设备 id 为空或格式不对'
};

function errorText(err) {
  if (!err) return '未知错误';
  return BLE_ERROR_TEXT[err.errCode] || err.errMsg || '未知错误';
}

/** 真机能力检测：开发者工具里直接返回 false，页面据此禁用 BLE 入口 */
function isSupported() {
  try {
    if (typeof wx === 'undefined') return false;
    var info = typeof wx.getDeviceInfo === 'function' ? wx.getDeviceInfo() : wx.getSystemInfoSync();
    // 开发者工具 platform 为 devtools，真机为 ios / android
    return !!info && info.platform !== 'devtools';
  } catch (err) {
    return false;
  }
}

/** 1) 打开蓝牙适配器 */
function openAdapter() {
  return new Promise(function (resolve, reject) {
    if (!isSupported()) {
      reject(new Error('开发者工具不支持蓝牙，请用真机预览'));
      return;
    }
    wx.openBluetoothAdapter({
      success: function () {
        adapterReady = true;
        resolve(true);
      },
      fail: function (err) {
        reject(new Error(errorText(err)));
      }
    });
  });
}

/** 2) 开始扫描（按广播名前缀过滤，可在 onBluetoothDeviceFound 里进一步筛 RSSI） */
function startDiscovery() {
  return new Promise(function (resolve, reject) {
    wx.startBluetoothDevicesDiscovery({
      allowDuplicatesKey: false,
      success: function () {
        resolve(true);
      },
      fail: function (err) {
        reject(new Error(errorText(err)));
      }
    });
  });
}

/** 监听发现的设备；cb(device) 由页面渲染候选列表 */
function onDeviceFound(cb) {
  // TODO: 真机联调时用 wx.onBluetoothDeviceFound 注册回调，过滤 DEVICE_NAME_PREFIX
  wx.onBluetoothDeviceFound(function (res) {
    var devices = (res && res.devices) || [];
    for (var i = 0; i < devices.length; i++) {
      var device = devices[i];
      if (device && device.name && device.name.indexOf(DEVICE_NAME_PREFIX) === 0) {
        cb(device);
      }
    }
  });
}

/** 3) 连接设备（deviceId 来自扫描结果） */
function connect(deviceId) {
  return new Promise(function (resolve, reject) {
    wx.createBLEConnection({
      deviceId: deviceId,
      timeout: 10000,
      success: function () {
        connectedDeviceId = deviceId;
        resolve(true);
      },
      fail: function (err) {
        reject(new Error(errorText(err)));
      }
    });
  });
}

/** 4) 取服务 -> 5) 取特征值 -> 6) 打开 notify */
function discoverAndNotify() {
  // TODO: 用 SERVICE_UUID / CHAR_WRITE_UUID / CHAR_NOTIFY_UUID 实现：
  //   wx.getBLEDeviceServices -> 匹配 serviceId === SERVICE_UUID
  //   wx.getBLEDeviceCharacteristics -> 找到 write 与 notify 两个特征值
  //   wx.notifyBLECharacteristicValueChange({ state: true, ... })
  //   wx.onBLECharacteristicValueChange -> 解析 0x30 TEL / 0x51 BSTATE 帧
  return Promise.reject(new Error('TODO: BLE 服务/特征值 UUID 待固件提供'));
}

/** 7) 写控车帧：由 PCMD(0x40) 帧承载 v/w/seq */
function sendControl(v, w, seq) {
  // TODO: 编码 0x40 PCMD 帧（设计说明协议），落到 ArrayBuffer 后调用 wx.writeBLECharacteristicValue
  //   var frame = encodePcmd(v, w, seq);
  //   return write(frame);
  return Promise.reject(new Error('TODO: 0x40 PCMD 帧编码待实现'));
}

function write(buffer) {
  return new Promise(function (resolve, reject) {
    if (!connectedDeviceId || !CHAR_WRITE_UUID) {
      reject(new Error('未连接或未配置写入特征值'));
      return;
    }
    wx.writeBLECharacteristicValue({
      deviceId: connectedDeviceId,
      serviceId: SERVICE_UUID,
      characteristicId: CHAR_WRITE_UUID,
      value: buffer,
      success: function () {
        resolve(true);
      },
      fail: function (err) {
        reject(new Error(errorText(err)));
      }
    });
  });
}

/** 停车：BLE 链路失联时也必须执行；先用 PCMD v=0/w=0，再断开连接 */
function stop() {
  // TODO: 发送 0x40 PCMD v=0,w=0 帧，随后 disconnect()
  return Promise.reject(new Error('TODO: 停车帧待实现'));
}

function disconnect() {
  return new Promise(function (resolve) {
    if (!connectedDeviceId) {
      resolve(true);
      return;
    }
    wx.closeBLEConnection({
      deviceId: connectedDeviceId,
      complete: function () {
        connectedDeviceId = '';
        notifyEnabled = false;
        resolve(true);
      }
    });
  });
}

/** 收尾：停止扫描并关闭适配器（页面 onUnload 调用） */
function close() {
  try {
    if (typeof wx !== 'undefined' && wx.stopBluetoothDevicesDiscovery) {
      wx.stopBluetoothDevicesDiscovery({});
    }
    if (adapterReady && wx.closeBluetoothAdapter) {
      wx.closeBluetoothAdapter({});
    }
  } catch (err) {
    // 清理失败不影响页面
  }
  adapterReady = false;
  connectedDeviceId = '';
  notifyEnabled = false;
}

module.exports = {
  isSupported: isSupported,
  errorText: errorText,
  openAdapter: openAdapter,
  startDiscovery: startDiscovery,
  onDeviceFound: onDeviceFound,
  connect: connect,
  discoverAndNotify: discoverAndNotify,
  sendControl: sendControl,
  stop: stop,
  disconnect: disconnect,
  close: close,
  // 供页面展示 TODO 状态
  isReady: function () {
    return !!(connectedDeviceId && notifyEnabled);
  },
  getUuidConfig: function () {
    return { SERVICE_UUID: SERVICE_UUID, CHAR_WRITE_UUID: CHAR_WRITE_UUID, CHAR_NOTIFY_UUID: CHAR_NOTIFY_UUID };
  }
};
