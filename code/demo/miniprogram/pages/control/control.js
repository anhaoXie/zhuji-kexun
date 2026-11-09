// pages/control/control.js —— Tab2 控制
// 安全约束（见 ../../docs/BUILD_SPEC.md 第 0 节）：
//   · 小程序控车仅在「远程模式」开放，2.4G 遥控器始终最高优先级；
//   · 远程模式 500 ms 无新控制指令由服务端自动停车，因此按住期间每 200 ms 重发一次；
//   · 急停任何模式立即生效，复位需长按 2 s。
var app = getApp();
var ble = require('../../utils/ble.js');

var JOYSTICK_AREA_RPX = 480; // 摇杆底盘直径 240px
var KNOB_RPX = 168; // 摇杆钮 84px
var MAX_W = 1.2; // rad/s，与 api_contract 一致
var MOVE_RESEND_MS = 200; // 远控指令重发周期（服务端 500 ms 无指令即停车）
var RESET_HOLD_MS = 2000; // 急停复位长按时长

Page({
  data: {
    mode: 'patrol',
    modeText: '巡检中',
    modeTagClass: 'ongoing',
    controlMode: 'patrol',
    controlEnabled: false,
    speed: 0.3,
    speedText: '0.30',
    vText: '0.00',
    wText: '0.00',
    knobX: 0,
    knobY: 0,
    latency: 28,
    battery: 78,
    temp: 32,
    videoEnabled: false,
    bleSupported: false,
    countdownText: '长按 2 秒复位',
    safety: ['2.4G 遥控器优先', '失联 500 ms 停车', '急停硬件优先']
  },

  onLoad: function () {
    // 摇杆几何：movable-view 的 x/y 是 px，这里按 rpx->px 换算中心点
    this._pxPerRpx = 0.5;
    try {
      var info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this._pxPerRpx = ((info && info.windowWidth) || 375) / 750;
    } catch (err) {
      this._pxPerRpx = 0.5;
    }
    var areaPx = JOYSTICK_AREA_RPX * this._pxPerRpx;
    var knobPx = KNOB_RPX * this._pxPerRpx;
    this._maxX = Math.max(0, areaPx - knobPx);
    this._center = this._maxX / 2;
    this._lastSendAt = 0;
    this._lastMove = null;
    this._moveTimer = null;
    this._estopTimer = null;
    this._estopInterval = null;

    this.setData({
      knobX: this._center,
      knobY: this._center,
      videoEnabled: !!app.globalData.videoEnabled,
      bleSupported: ble.isSupported()
    });

    this._offState = app.subscribe('state', this.onAppState.bind(this));
    this.onAppState(app.getState());
  },

  onShow: function () {
    this.onAppState(app.getState());
  },

  onHide: function () {
    // 页面隐藏时兜底发一次 stop（服务端另有 500 ms 无指令自动停车）
    if (this.data.controlEnabled) app.sendControl('stop', 0, 0);
    this._stopMoving();
  },

  onUnload: function () {
    if (this._offState) this._offState();
    this._clearEstopTimer();
    this._stopMoving();
  },

  /* ---------------- 状态同步 ---------------- */

  onAppState: function (state) {
    if (!state || !state.robot) return;
    var robot = state.robot;
    var device = state.device || {};
    var mode = robot.mode || 'patrol';
    var remote = mode === 'remote';
    var modeTagClass = 'ongoing';
    if (mode === 'remote') modeTagClass = 'remote';
    if (mode === 'estop') modeTagClass = 'danger';

    this.setData({
      mode: mode,
      modeText: robot.mode_text || '巡检中',
      modeTagClass: modeTagClass,
      controlMode: remote ? 'remote' : 'patrol',
      controlEnabled: remote,
      latency: device.latency_ms || 0,
      battery: robot.battery,
      temp: robot.temp
    });

    if (!remote) {
      this._stopMoving();
      this.setData({ vText: '0.00', wText: '0.00' });
    }
  },

  /* ---------------- 模式切换 ---------------- */

  onModeTap: function (event) {
    var target = event.currentTarget.dataset.mode;
    if (!target || target === this.data.controlMode) return;
    if (this.data.mode === 'estop') {
      wx.showToast({ title: '已急停，请先长按复位', icon: 'none' });
      return;
    }
    var self = this;
    if (target === 'remote') {
      wx.showModal({
        title: '切换到远程模式',
        content: '切换后小程序可低速控车，遥控器仍优先；失联 500 ms 自动停车。确认切换？',
        confirmText: '确认切换',
        confirmColor: '#07C160',
        success: function (res) {
          if (!res.confirm) return;
          app.sendMode('remote');
          self.setData({ controlMode: 'remote', controlEnabled: true });
          wx.showToast({ title: '已切换到远程模式', icon: 'none' });
        }
      });
    } else {
      app.sendMode('patrol');
      this._stopMoving();
      this.setData({ controlMode: 'patrol', controlEnabled: false, vText: '0.00', wText: '0.00' });
      wx.showToast({ title: '已恢复巡检模式', icon: 'none' });
    }
  },

  /* ---------------- 摇杆 ---------------- */

  onKnobStart: function () {
    if (!this.data.controlEnabled) return;
  },

  onKnobChange: function (event) {
    if (!this.data.controlEnabled || !this._center) return;
    var x = Number(event.detail.x) || 0;
    var y = Number(event.detail.y) || 0;
    var nx = Math.max(-1, Math.min(1, (x - this._center) / this._center));
    var ny = Math.max(-1, Math.min(1, (y - this._center) / this._center));
    // 上推 = 前进：契约 v ∈ 0—0.8；右拖 = 右转：w 取负，契约 w ∈ ±1.2
    var v = Math.max(0, -ny) * this.data.speed;
    var w = -nx * MAX_W;
    v = Math.round(v * 100) / 100;
    w = Math.round(w * 100) / 100;
    this.setData({ vText: v.toFixed(2), wText: w.toFixed(2) });
    this._lastMove = { v: v, w: w };
    this._startMoveLoop();
    var now = Date.now();
    if (now - this._lastSendAt >= 120) {
      this._lastSendAt = now;
      app.sendControl('move', v, w);
    }
  },

  onKnobEnd: function () {
    this._resetKnob();
    if (!this.data.controlEnabled) return;
    this._sendStop();
  },

  _resetKnob: function () {
    if (this.data.knobX === this._center && this.data.knobY === this._center) return;
    this.setData({ knobX: this._center, knobY: this._center });
  },

  _startMoveLoop: function () {
    if (this._moveTimer) return;
    var self = this;
    this._moveTimer = setInterval(function () {
      if (!self.data.controlEnabled || !self._lastMove) return;
      app.sendControl('move', self._lastMove.v, self._lastMove.w);
    }, MOVE_RESEND_MS);
  },

  _stopMoveLoop: function () {
    if (this._moveTimer) {
      clearInterval(this._moveTimer);
      this._moveTimer = null;
    }
    this._lastMove = null;
  },

  /** 停止移动：清掉重发循环 + 下发 stop + 复位读数 */
  _stopMoving: function () {
    this._stopMoveLoop();
    this._resetKnob();
  },

  _sendStop: function () {
    this._stopMoveLoop();
    this.setData({ vText: '0.00', wText: '0.00' });
    app.sendControl('stop', 0, 0);
  },

  /* ---------------- 点动按钮 ---------------- */

  _cmdVector: function (cmd) {
    var speed = this.data.speed;
    if (cmd === 'forward') return { v: speed, w: 0 };
    // 注意：api_contract 规定 v 限 0—0.8；后退按钮按负 v 下发，联调时需服务端放开或改为档位字段
    if (cmd === 'back') return { v: -speed, w: 0 };
    if (cmd === 'left') return { v: Math.round(speed * 50) / 100, w: MAX_W };
    if (cmd === 'right') return { v: Math.round(speed * 50) / 100, w: -MAX_W };
    return { v: 0, w: 0 };
  },

  onCmdStart: function (event) {
    if (!this.data.controlEnabled) {
      wx.showToast({ title: '请先切换到远程模式', icon: 'none' });
      return;
    }
    var cmd = event.currentTarget.dataset.cmd;
    var vector = this._cmdVector(cmd);
    this._lastMove = vector;
    this.setData({ vText: vector.v.toFixed(2), wText: vector.w.toFixed(2) });
    app.sendControl('move', vector.v, vector.w);
    this._startMoveLoop();
  },

  onCmdEnd: function () {
    if (!this.data.controlEnabled) return;
    this._sendStop();
  },

  onStopTap: function () {
    this._sendStop();
    wx.showToast({ title: '已发送停止', icon: 'none' });
  },

  /* ---------------- 速度 / 图传 ---------------- */

  onSpeedChanging: function (event) {
    var value = Number(event.detail.value) || 0.3;
    this.setData({ speed: value, speedText: value.toFixed(2) });
  },

  onSpeedChange: function (event) {
    var value = Number(event.detail.value) || 0.3;
    this.setData({ speed: value, speedText: value.toFixed(2) });
  },

  onVideoSwitch: function (event) {
    var enabled = !!event.detail.value;
    this.setData({ videoEnabled: enabled });
    app.sendVideo(enabled);
    wx.showToast({
      title: enabled ? '图传监看已开启：720p/15fps/1.2 Mbps（演示）' : '图传监看已关闭',
      icon: 'none'
    });
  },

  /* ---------------- 急停 / 长按复位 ---------------- */

  onEstopTap: function () {
    if (this.data.mode === 'estop') return; // 复位由长按逻辑处理
    var self = this;
    wx.showModal({
      title: '确认急停？',
      content: '立即停车并锁定所有控制，需长按 2 秒复位。硬件急停按钮始终优先。',
      confirmText: '立即急停',
      confirmColor: '#E5484D',
      success: function (res) {
        if (!res.confirm) return;
        app.sendEstop();
        self._stopMoving();
        self.setData({
          mode: 'estop',
          modeText: '已急停',
          modeTagClass: 'danger',
          controlEnabled: false,
          vText: '0.00',
          wText: '0.00'
        });
        wx.showToast({ title: '已急停', icon: 'none' });
      }
    });
  },

  onEstopPressStart: function () {
    if (this.data.mode !== 'estop') return;
    var self = this;
    var left = RESET_HOLD_MS / 1000;
    this._clearEstopTimer();
    this.setData({ countdownText: '保持按住 ' + left.toFixed(1) + ' s' });
    this._estopTimer = setTimeout(function () {
      self._clearEstopTimer();
      app.sendEstopReset();
      self.setData({
        mode: 'patrol',
        modeText: '已复位',
        modeTagClass: 'ongoing',
        controlEnabled: false,
        countdownText: '长按 2 秒复位'
      });
      wx.showToast({ title: '已复位，恢复巡检模式', icon: 'none' });
    }, RESET_HOLD_MS);
    this._estopInterval = setInterval(function () {
      left = Math.max(0, left - 0.2);
      self.setData({ countdownText: '保持按住 ' + left.toFixed(1) + ' s' });
    }, 200);
  },

  onEstopPressEnd: function () {
    if (!this._estopTimer) return;
    this._clearEstopTimer();
    this.setData({ countdownText: '长按 2 秒复位' });
  },

  _clearEstopTimer: function () {
    if (this._estopTimer) {
      clearTimeout(this._estopTimer);
      this._estopTimer = null;
    }
    if (this._estopInterval) {
      clearInterval(this._estopInterval);
      this._estopInterval = null;
    }
  },

  /* ---------------- BLE（骨架，仅真机） ---------------- */

  onBleTap: function () {
    if (!ble.isSupported()) {
      wx.showToast({ title: '开发者工具不支持 BLE，请用真机预览', icon: 'none' });
      return;
    }
    // 真机：openBluetoothAdapter -> startDiscovery -> connect -> discoverAndNotify -> write
    // 目前 UUID 与 0x40 PCMD 帧编码是 TODO（见 utils/ble.js），这里只跑通“打开适配器 + 扫描”两段。
    ble
      .openAdapter()
      .then(function () {
        return ble.startDiscovery();
      })
      .then(function () {
        wx.showToast({ title: '蓝牙已打开，正在扫描 ZhuJi-* 设备…', icon: 'none' });
      })
      .catch(function (err) {
        wx.showToast({ title: (err && err.message) || 'BLE 初始化失败', icon: 'none' });
      });
  }
});
