// pages/video/video.js —— Tab3 图传
// 说明：本页用 <image> + 百分比绝对定位的检测框做“低码率监看”演示；
// 真实视频流需要 live-player + HLS 或 WebRTC（需类目资质与合法域名），见 README。
var app = getApp();
var api = require('../../utils/api.js');
var format = require('../../utils/format.js');

var MOCK_TS = '2026-11-04 09:24:31';

Page({
  data: {
    camUrl: '',
    camFallback: false,
    liveText: '720p 15fps 1.2 Mbps',
    clockText: MOCK_TS,
    boxes: [],
    pitch: 78,
    plotLabel: 'B2-03',
    plantLabel: '2-1',
    enabled: false,
    cameraName: 'K230 · 顶视',
    camSource: '演示画面',
    camLive: false,
    ops: [
      { key: 'shot', label: '截图' },
      { key: 'rec', label: '录制' },
      { key: 'ptzDown', label: '云台 −' },
      { key: 'ptzUp', label: '云台 +' },
      { key: 'full', label: '全屏' }
    ],
    notes: ['默认关闭，开启后仅传低码率画面；', '识别/判定在车端完成，不依赖视频流；', '断网自动停传，恢复后可重连。']
  },

  onLoad: function () {
    this._baseTs = this._parseTs(MOCK_TS) || new Date();
    this._clockOffset = 0;
    this._offState = app.subscribe('state', this.onAppState.bind(this));
    this.onAppState(app.getState());
    this.setData({ camUrl: app.getApiBase() + '/assets/cam_plant.jpg' });
    this._loadVideoInfo();
    this._startClock();
    this._startCameraPoll();
  },

  onShow: function () {
    if (!this._loaded) this._loadVideoInfo();
  },

  onUnload: function () {
    if (this._offState) this._offState();
    this._stopClock();
    this._stopCameraPoll();
  },

  /* ---------------- 数据 ---------------- */

  _loadVideoInfo: function () {
    var self = this;
    app
      .fetchVideoInfo()
      .then(function (res) {
        self._loaded = true;
        self._applyVideoInfo(res.data);
      })
      .catch(function () {
        self._applyVideoInfo(api.mockVideoInfo());
      });
  },

  _applyVideoInfo: function (info) {
    if (!info) return;
    var boxes = (info.boxes || []).map(function (box, index) {
      var high = box.status !== 'review';
      var borderColor = high ? '#07C160' : '#F5A524';
      return {
        key: 'box-' + index,
        label: box.label,
        confText: Number(box.confidence || 0).toFixed(2),
        review: !high,
        style:
          'left:' +
          (box.x * 100).toFixed(1) +
          '%;top:' +
          (box.y * 100).toFixed(1) +
          '%;width:' +
          (box.w * 100).toFixed(1) +
          '%;height:' +
          (box.h * 100).toFixed(1) +
          '%;border-color:' +
          borderColor +
          ';background:' +
          (high ? 'rgba(7,193,96,0.12)' : 'rgba(245,165,36,0.10)') +
          ';',
        labelStyle: 'background:' + borderColor + ';'
      };
    });

    this._baseTs = this._parseTs(info.ts) || this._baseTs;
    this._clockOffset = 0;
    this.setData({
      boxes: boxes,
      pitch: (info.ptz && info.ptz.pitch) || 78,
      cameraName: info.camera || 'K230 · 顶视',
      liveText: (info.height || 720) + 'p ' + (info.fps || 15) + 'fps ' + (info.bitrate || '1.2 Mbps'),
      enabled: !!info.enabled
    });
    this._renderClock();
  },

  onAppState: function (state) {
    if (!state || !state.robot) return;
    this.setData({ plotLabel: state.robot.plot || 'B2-03' });
  },

  /** 服务端不可用：自动降级到本地演示静帧（assets/cam_plant.jpg，随代码包分发） */
  onCamError: function () {
    if (this.data.camFallback) return;
    this.setData({ camFallback: true, camUrl: app.globalData.localCam });
  },

  /* ---------------- 时间戳（每秒跳动） ---------------- */

  _parseTs: function (ts) {
    if (!ts) return null;
    // iOS 对 “YYYY-MM-DD HH:mm:ss” 兼容性差，换成斜杠再解析
    var date = new Date(String(ts).replace(/-/g, '/'));
    return isNaN(date.getTime()) ? null : date;
  },

  _startClock: function () {
    var self = this;
    this._stopClock();
    this._clockTimer = setInterval(function () {
      self._clockOffset += 1;
      self._renderClock();
    }, 1000);
  },

  _renderClock: function () {
    var base = this._baseTs || this._parseTs(MOCK_TS) || new Date();
    var date = new Date(base.getTime() + (this._clockOffset || 0) * 1000);
    this.setData({ clockText: format.formatDateTime(date) });
  },

  _stopClock: function () {
    if (this._clockTimer) {
      clearInterval(this._clockTimer);
      this._clockTimer = null;
    }
  },

  /* ---------------- K230 真实图传（轮询快照帧） ---------------- */

  _startCameraPoll: function () {
    var self = this;
    this._stopCameraPoll();
    this._pollCamera();
    this._cameraTimer = setInterval(function () { self._pollCamera(); }, 1500);
  },

  _stopCameraPoll: function () {
    if (this._cameraTimer) {
      clearInterval(this._cameraTimer);
      this._cameraTimer = null;
    }
  },

  _pollCamera: function () {
    var self = this;
    wx.request({
      url: app.getApiBase() + '/api/camera/status',
      timeout: 2500,
      success: function (res) {
        if (res.statusCode === 200 && res.data) self._applyCameraStatus(res.data);
      },
      fail: function () { /* 服务不可用：保持本地演示静帧 */ }
    });
  },

  /**
   * 真实图传两种取法：
   * - push/rtsp：服务端转 MJPEG，小程序 <image> 不能播流，改轮询 /api/camera/latest.jpg 快照；
   * - mjpeg：K230 自建 MJPEG，微信侧同样不能直接播，仍用 latest.jpg（服务端可代理时再改）。
   */
  _applyCameraStatus: function (payload) {
    var src = (payload && payload.source) || {};
    var online = !!src.online;
    var real = online && (src.mode === 'push' || src.mode === 'rtsp' || src.mode === 'mjpeg');
    if (!real) {
      this.setData({ camSource: '演示画面', camLive: false });
      return;
    }
    var fps = src.fps ? (Math.round(src.fps * 10) / 10) : 0;
    var kbps = src.kbps ? Math.round(src.kbps) : 0;
    this.setData({
      camUrl: app.getApiBase() + '/api/camera/latest.jpg?t=' + Date.now(),
      camSource: src.mode === 'mjpeg' ? 'K230 直连' : 'K230 实拍',
      camLive: true,
      liveText: (src.width || '-') + 'p ' + fps + 'fps ' + kbps + ' kbps',
      cameraName: src.mode === 'mjpeg' ? 'K230 · MJPEG' : 'K230 · 实时'
    });
  },

  /* ---------------- 操作 ---------------- */

  onToggleVideo: function () {
    var enabled = !this.data.enabled;
    this.setData({ enabled: enabled });
    app.sendVideo(enabled);
    wx.showToast({
      title: enabled ? '已开启低码率监看（演示静帧）' : '已关闭图传监看',
      icon: 'none'
    });
  },

  onOpTap: function (event) {
    var label = event.currentTarget.dataset.label || '';
    wx.showToast({ title: '演示版：' + label, icon: 'none' });
  }
});
