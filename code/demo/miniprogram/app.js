// app.js —— 《株迹可循》小程序入口
// 职责：全局 API 地址、WebSocket 连接与断线重连、状态广播、无服务端时的本地 mock 演示兜底。
// 接口契约：./docs/api_contract.md
// 页面规范：../docs/BUILD_SPEC.md

var api = require('./utils/api.js');

var DEFAULT_API_BASE = 'http://127.0.0.1:8765';
var API_BASE_STORAGE_KEY = 'zhu_ji_api_base';
var RECONNECT_MIN = 1000;
var RECONNECT_MAX = 15000;

App({
  globalData: {
    apiBase: DEFAULT_API_BASE,
    wsUrl: '',
    connected: false,
    mockMode: false,
    state: null, // 最近一次 /api/state 或 WebSocket state
    report: null, // 最近一次 /api/report
    videoInfo: null, // 最近一次 /api/video/info
    videoEnabled: false,
    localCam: '/assets/cam_plant.jpg' // 服务端不可用时使用的本地演示静帧
  },

  _listeners: { state: [], event: [], connection: [], report_ready: [] },
  _socket: null,
  _socketReady: false,
  _seq: 0,
  _reconnectDelay: RECONNECT_MIN,
  _reconnectTimer: null,
  _heartbeatTimer: null,
  _mockTimer: null,
  _mockTick: 0,

  onLaunch: function () {
    var saved = '';
    try {
      saved = wx.getStorageSync(API_BASE_STORAGE_KEY) || '';
    } catch (err) {
      saved = '';
    }
    this.globalData.apiBase = String(saved || DEFAULT_API_BASE).replace(/\/+$/, '');
    this._updateWsUrl();
    this._bootstrap();
  },

  onShow: function () {
    if (!this._socketReady && !this._reconnectTimer) this.connect();
  },

  /* ---------------- 配置 ---------------- */

  _updateWsUrl: function () {
    // http://127.0.0.1:8765 -> ws://127.0.0.1:8765/ws；https -> wss 自动成立
    this.globalData.wsUrl = this.globalData.apiBase.replace(/^http/i, 'ws') + '/ws';
  },

  getApiBase: function () {
    return this.globalData.apiBase;
  },

  // 在开发者工具 Console 里执行 getApp().setApiBase('http://192.168.1.20:8765') 即可切换服务端
  setApiBase: function (base) {
    var next = String(base || '').replace(/\/+$/, '');
    if (!next) return;
    this.globalData.apiBase = next;
    try {
      wx.setStorageSync(API_BASE_STORAGE_KEY, next);
    } catch (err) {
      // 存储失败不影响本次会话
    }
    this._updateWsUrl();
    this._closeSocket();
    this.connect();
    wx.showToast({ title: 'API 地址已切换', icon: 'none' });
  },

  /* ---------------- 订阅 / 广播 ---------------- */

  subscribe: function (channel, handler) {
    var list = this._listeners[channel];
    if (!list || typeof handler !== 'function') return function () {};
    list.push(handler);
    return function () {
      var index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    };
  },

  emit: function (channel, payload) {
    var list = this._listeners[channel] || [];
    for (var i = 0; i < list.length; i++) {
      try {
        list[i](payload);
      } catch (err) {
        console.error('[app.emit] ' + channel, err);
      }
    }
  },

  /* ---------------- 首屏数据 ---------------- */

  _bootstrap: function () {
    var self = this;
    api
      .getState(this.globalData.apiBase)
      .then(function (res) {
        self._applyState(res.data, res.live);
        if (!res.live) self._startMockLoop();
      })
      .catch(function () {
        self._applyState(api.mockState(), false);
        self._startMockLoop();
      });
    this.connect();
    // 服务端未启动（或域名未放行）时，2.5s 内仍无任何状态就直接起 mock，保证界面可见
    setTimeout(function () {
      if (!self.globalData.state) {
        self._applyState(api.mockState(), false);
        self._startMockLoop();
      }
    }, 2500);
  },

  _applyState: function (state, live) {
    if (!state) return;
    this.globalData.state = state;
    if (live) {
      this.globalData.mockMode = false;
      this._stopMockLoop();
    }
    this.emit('state', state);
  },

  _pushState: function (state) {
    this.globalData.state = state;
    this.emit('state', state);
  },

  getState: function () {
    return this.globalData.state || api.mockState();
  },

  fetchReport: function (batchId) {
    var self = this;
    return api.getReport(batchId, this.globalData.apiBase).then(function (res) {
      self.globalData.report = res.data;
      return res;
    });
  },

  fetchVideoInfo: function () {
    var self = this;
    return api.getVideoInfo(this.globalData.apiBase).then(function (res) {
      self.globalData.videoInfo = res.data;
      return res;
    });
  },

  /* ---------------- WebSocket ---------------- */

  connect: function () {
    if (this._socket || typeof wx === 'undefined' || !wx.connectSocket) return;
    var self = this;
    var socket = null;
    try {
      socket = wx.connectSocket({ url: this.globalData.wsUrl });
    } catch (err) {
      this._scheduleReconnect();
      return;
    }
    if (!socket || typeof socket.onOpen !== 'function') {
      this._scheduleReconnect();
      return;
    }
    this._socket = socket;

    socket.onOpen(function () {
      self._socketReady = true;
      self._reconnectDelay = RECONNECT_MIN;
      self.globalData.connected = true;
      self._stopMockLoop();
      self.emit('connection', true);
      self.send({ type: 'hello', client: 'miniprogram' });
      self._startHeartbeat();
      // 连上后再补拉一次 HTTP 首屏，避免握手期间漏掉状态
      api
        .getState(self.globalData.apiBase)
        .then(function (res) {
          if (res.live) self._applyState(res.data, true);
        })
        .catch(function () {});
    });

    socket.onMessage(function (message) {
      self._stopMockLoop();
      self._handleMessage(message ? message.data : null);
    });

    socket.onClose(function () {
      self._socketReady = false;
      self._socket = null;
      self.globalData.connected = false;
      self._stopHeartbeat();
      self.emit('connection', false);
      self._scheduleReconnect();
      if (!self._mockTimer) self._startMockLoop();
    });

    socket.onError(function () {
      self._socketReady = false;
      self._socket = null;
      self.globalData.connected = false;
      self.emit('connection', false);
      self._scheduleReconnect();
      if (!self._mockTimer) self._startMockLoop();
    });
  },

  _closeSocket: function () {
    this._stopHeartbeat();
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    var socket = this._socket;
    this._socket = null;
    this._socketReady = false;
    this.globalData.connected = false;
    if (socket && typeof socket.close === 'function') {
      try {
        socket.close({ code: 1000, reason: 'switch api base' });
      } catch (err) {
        // 忽略关闭异常
      }
    }
  },

  _scheduleReconnect: function () {
    if (this._reconnectTimer) return;
    var self = this;
    var delay = this._reconnectDelay || RECONNECT_MIN;
    this._reconnectDelay = Math.min(RECONNECT_MAX, delay * 2);
    this._reconnectTimer = setTimeout(function () {
      self._reconnectTimer = null;
      self.connect();
    }, delay);
  },

  _startHeartbeat: function () {
    var self = this;
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(function () {
      if (self._socketReady) self.send({ type: 'ping', t: Date.now() });
    }, 20000);
  },

  _stopHeartbeat: function () {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  },

  _handleMessage: function (raw) {
    if (!raw) return;
    var message;
    try {
      message = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (err) {
      return;
    }
    if (!message || !message.type) return;
    if (message.type === 'state') {
      this._pushState(message);
      return;
    }
    if (message.type === 'event') {
      this.emit('event', message);
      return;
    }
    if (message.type === 'report_ready') {
      this.emit('report_ready', message);
      var batchId = typeof message.batch === 'string' ? message.batch : undefined;
      this.fetchReport(batchId).catch(function () {});
      wx.showToast({ title: '本棚已完成，报表已生成', icon: 'none' });
      return;
    }
    if (message.type === 'ack' || message.type === 'pong') {
      this.emit(message.type, message);
    }
  },

  /* ---------------- 指令下发（离线时写入本地演示状态） ---------------- */

  send: function (payload) {
    if (!this._socketReady || !this._socket) return false;
    try {
      this._socket.send({ data: JSON.stringify(payload) });
      return true;
    } catch (err) {
      return false;
    }
  },

  sendControl: function (cmd, v, w) {
    this._seq += 1;
    var ok = this.send({ type: 'control', cmd: cmd, v: v, w: w, seq: this._seq });
    if (!ok) this._mockControl(cmd, v, w);
    return ok;
  },

  sendMode: function (mode) {
    var ok = this.send({ type: 'mode', mode: mode });
    if (!ok) this._mockMode(mode);
    return ok;
  },

  sendEstop: function () {
    var ok = this.send({ type: 'estop' });
    if (!ok) this._mockEstop();
    return ok;
  },

  sendEstopReset: function () {
    var ok = this.send({ type: 'estop_reset' });
    if (!ok) this._mockEstopReset();
    return ok;
  },

  sendVideo: function (enabled) {
    this.globalData.videoEnabled = !!enabled;
    return this.send({ type: 'video', enabled: !!enabled });
  },

  sendReview: function (code, action) {
    return this.send({ type: 'review', code: code, action: action });
  },

  /* ---------------- mock 演示：巡检推进 ---------------- */
  // 服务端未启动时，用与 /api/state 同构的数据缓慢推进，保证开发者工具里界面“会动”。
  // 真实数据到达（WebSocket state / HTTP live）后自动停止。

  _startMockLoop: function () {
    if (this._mockTimer) {
      this.globalData.mockMode = true;
      return;
    }
    this.globalData.mockMode = true;
    var self = this;
    this._mockTimer = setInterval(function () {
      self._mockStep();
    }, 1000);
  },

  _stopMockLoop: function () {
    if (this._mockTimer) {
      clearInterval(this._mockTimer);
      this._mockTimer = null;
    }
    this.globalData.mockMode = false;
  },

  _mockStep: function () {
    var state = this.globalData.state;
    if (!state || !state.robot) return;
    this._mockTick += 1;
    var robot = state.robot;
    state.ts = (state.ts || 0) + 1;
    robot.temp = 31 + (this._mockTick % 3);
    if (robot.mode === 'patrol' && robot.plants_done < robot.plants_total) {
      // 约每 5 s 推进 1 株，64 株巡检总时长在演示中仍显得合理
      if (this._mockTick % 5 === 0) {
        robot.plants_done = Math.min(robot.plants_total, robot.plants_done + 1);
        robot.progress = Math.round((robot.plants_done / robot.plants_total) * 1000) / 1000;
        robot.stop_index = Math.min(16, 7 + Math.floor((robot.plants_done - 42) / 2));
        robot.distance_m = Math.min(35.8, Math.round((robot.distance_m + 0.4) * 10) / 10);
        // 电量按株数缓慢下降；电压保留契约样例的 11.6 V（契约公式与样例值不一致，展示以样例为准）
        robot.battery = Math.max(20, 78 - Math.floor((robot.plants_done - 42) / 20));
        if (robot.plants_done >= robot.plants_total) {
          robot.mode = 'idle';
          robot.mode_text = '巡检完成';
          robot.speed = 0;
          if (state.batch) {
            state.batch.status = 'done';
            state.batch.end = '2026-11-04T09:26:00+08:00';
          }
          this.emit('report_ready', { batch: state.batch && state.batch.id });
        }
      }
    }
    this._pushState(state);
  },

  _mockControl: function (cmd, v, w) {
    var state = this.globalData.state;
    if (!state || !state.robot) return;
    if (cmd === 'move') {
      state.robot.speed = Math.round((v || 0) * 100) / 100;
      state.robot.heading = Math.round(((((state.robot.heading || 0) + (w || 0) * 10) % 360) + 360) % 360);
    } else {
      state.robot.speed = 0;
    }
    this._pushState(state);
  },

  _mockMode: function (mode) {
    var state = this.globalData.state;
    if (!state || !state.robot) return;
    state.robot.mode = mode === 'remote' ? 'remote' : 'patrol';
    state.robot.mode_text = mode === 'remote' ? '远程模式' : '巡检中';
    if (mode !== 'remote') state.robot.speed = 0;
    this._pushState(state);
  },

  _mockEstop: function () {
    var state = this.globalData.state;
    if (!state || !state.robot) return;
    state.robot.mode = 'estop';
    state.robot.mode_text = '已急停';
    state.robot.speed = 0;
    this._pushState(state);
  },

  _mockEstopReset: function () {
    var state = this.globalData.state;
    if (!state || !state.robot) return;
    state.robot.mode = 'patrol';
    state.robot.mode_text = '巡检中';
    this._pushState(state);
  }
});
