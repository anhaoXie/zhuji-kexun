// pages/monitor/monitor.js —— Tab1 监控
// 数据：/api/state 首屏 + WebSocket state 增量；服务端不可用时用 utils/api.js 的 mock。
var app = getApp();
var format = require('../../utils/format.js');

// 台位口径：4 床 × 4 台位 = 16 台位（与 BUILD_SPEC 的「台位 7/16」一致）。
// 服务端 robot.stop_total = 20 是“停靠位”口径（每床两侧各停一次），两者不是同一个数。
var PLOT_TOTAL = 16;
var PLANT_TOTAL = 64;

Page({
  data: {
    greenhouse: '1号棚',
    mode: 'patrol',
    modeText: '巡检中',
    stopIndex: 7,
    plotTotal: PLOT_TOTAL,
    plantsDone: 42,
    plantsTotal: PLANT_TOTAL,
    etaLine: '预计 1 分 40 秒完成',
    progressPct: 66,
    plot: 'B2-03',
    battery: 78,
    batteryFillPct: 78,
    voltageText: '11.6 V',
    chips: [],
    recent: [],
    reviewCount: 3,
    canvasReady: false
  },

  onLoad: function () {
    this._offState = app.subscribe('state', this.onAppState.bind(this));
    this.onAppState(app.getState());
  },

  onReady: function () {
    this._initCanvas();
  },

  onShow: function () {
    this.onAppState(app.getState());
  },

  onUnload: function () {
    if (this._offState) this._offState();
  },

  /* ---------------- 状态 ---------------- */

  onAppState: function (state) {
    if (!state || !state.robot) return;
    var robot = state.robot;
    var batch = state.batch || {};
    var device = state.device || {};

    var recent = (state.recent || []).map(function (item) {
      return {
        code: item.code,
        disease: item.disease,
        state: item.state,
        stateClass: format.stateClass(item.state),
        time: item.time,
        confText: format.confText(item.confidence)
      };
    });

    var progressPct = Math.round((robot.progress || 0) * 100);
    var remainingPlants = Math.max(0, (robot.plants_total || 0) - (robot.plants_done || 0));
    // 35.8 m / 64 株 ≈ 4.9 min/棚，折算单株耗时后按 5 s 取整，42/64 时正好显示 1 分 40 秒
    var etaSeconds = Math.max(5, Math.round(((remainingPlants * 4.9 * 60) / 64) / 5) * 5);
    var etaText =
      etaSeconds >= 60 ? Math.floor(etaSeconds / 60) + ' 分 ' + (etaSeconds % 60) + ' 秒' : etaSeconds + ' 秒';
    var etaLine = robot.mode === 'idle' ? '已完成，等待下一批次' : '预计 ' + etaText + '完成';

    this.setData({
      greenhouse: batch.greenhouse || '1号棚',
      mode: robot.mode,
      modeText: robot.mode_text || '巡检中',
      stopIndex: Math.min(robot.stop_index || 0, PLOT_TOTAL),
      plantsDone: robot.plants_done,
      plantsTotal: robot.plants_total || PLANT_TOTAL,
      progressPct: progressPct,
      etaLine: etaLine,
      plot: robot.plot || 'B2-03',
      battery: robot.battery,
      batteryFillPct: Math.max(4, Math.min(100, robot.battery || 0)),
      voltageText: (robot.voltage ? Number(robot.voltage).toFixed(1) : '11.6') + ' V',
      chips: [
        { label: '速度', value: Number(robot.speed || 0).toFixed(1) + ' m/s' },
        { label: 'WiFi', value: (device.rssi || 0) + ' dBm' },
        { label: '里程', value: Number(robot.distance_m || 0).toFixed(1) + ' m' },
        { label: '已检出', value: (robot.detected || 0) + ' 株' }
      ],
      recent: recent,
      reviewCount: (state.review || []).length
    });

    this._progress = progressPct;
    this._redraw();
  },

  /* ---------------- 航线 canvas ---------------- */

  _initCanvas: function () {
    var self = this;
    wx.createSelectorQuery()
      .select('#routeCanvas')
      .fields({ node: true, size: true })
      .exec(function (res) {
        var item = res && res[0];
        if (!item || !item.node) return; // 基础库过旧时保留 CSS 网格背景作为降级示意
        var canvas = item.node;
        var ctx = canvas.getContext('2d');
        if (!ctx) return;
        var dpr = 2;
        try {
          var info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
          dpr = (info && info.pixelRatio) || 2;
        } catch (err) {
          dpr = 2;
        }
        canvas.width = item.width * dpr;
        canvas.height = item.height * dpr;
        ctx.scale(dpr, dpr);
        self._canvas = { ctx: ctx, width: item.width, height: item.height };
        self.setData({ canvasReady: true });
        self._redraw();
      });
  },

  _redraw: function () {
    if (!this._canvas || this._progress == null) return;
    if (this._lastDrawn === this._progress) return;
    this._lastDrawn = this._progress;
    this._drawRoute(this._canvas.ctx, this._canvas.width, this._canvas.height, this._progress / 100);
  },

  _drawRoute: function (ctx, w, h, progress) {
    var pad = 6;
    var innerW = w - pad * 2;
    var innerH = h - pad * 2;
    var gap = 5;
    var aisleW = Math.max(4, innerW * 0.05);
    var bedW = (innerW - aisleW * 5) / 4;
    var aisleX = [];
    var bedX = [];
    var i;
    var j;
    for (i = 0; i < 5; i++) {
      aisleX.push(pad + i * (aisleW + bedW) + aisleW / 2);
    }
    for (i = 0; i < 4; i++) {
      bedX.push(pad + i * (aisleW + bedW) + aisleW);
    }
    var plotH = (innerH - gap * 3) / 4;
    var top = pad + 2;
    var bottom = pad + innerH - 2;

    ctx.clearRect(0, 0, w, h);

    // 5 条过道底色
    ctx.fillStyle = '#F5F8F6';
    for (i = 0; i < 5; i++) {
      ctx.fillRect(aisleX[i] - aisleW / 2, pad, aisleW, innerH);
    }

    // 4 条床，每床 4 个台位，每台位 2×2 株点（共 64 株）
    for (i = 0; i < 4; i++) {
      for (j = 0; j < 4; j++) {
        var bx = bedX[i];
        var by = pad + j * (plotH + gap);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(bx, by, bedW, plotH);
        ctx.strokeStyle = '#DCE6DF';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx + 0.5, by + 0.5, bedW - 1, plotH - 1);
        var dotR = Math.max(1.2, Math.min(2.6, bedW * 0.06));
        ctx.fillStyle = '#A9D8BD';
        var row;
        var col;
        for (row = 0; row < 2; row++) {
          for (col = 0; col < 2; col++) {
            ctx.beginPath();
            ctx.arc(bx + bedW * (0.34 + col * 0.32), by + plotH * (0.34 + row * 0.32), dotR, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }

    // 20 个停靠位小刻度：5 条过道 × 每床 4 行
    ctx.strokeStyle = '#C7D2CB';
    ctx.lineWidth = 1;
    for (i = 0; i < 5; i++) {
      for (j = 0; j < 4; j++) {
        var tickY = pad + j * (plotH + gap) + plotH / 2;
        ctx.beginPath();
        ctx.moveTo(aisleX[i] - 3, tickY);
        ctx.lineTo(aisleX[i] + 3, tickY);
        ctx.stroke();
      }
    }

    // S 形折返路线：过道 0 下行 → 过道 1 上行 → … → 过道 4 下行
    var points = [
      [aisleX[0], top],
      [aisleX[0], bottom],
      [aisleX[1], bottom],
      [aisleX[1], top],
      [aisleX[2], top],
      [aisleX[2], bottom],
      [aisleX[3], bottom],
      [aisleX[3], top],
      [aisleX[4], top],
      [aisleX[4], bottom]
    ];
    var lengths = [];
    var total = 0;
    for (i = 1; i < points.length; i++) {
      var dx = points[i][0] - points[i - 1][0];
      var dy = points[i][1] - points[i - 1][1];
      var len = Math.sqrt(dx * dx + dy * dy);
      lengths.push(len);
      total += len;
    }
    var pointAt = function (distance) {
      var remain = Math.max(0, Math.min(distance, total));
      for (var s = 0; s < lengths.length; s++) {
        if (remain <= lengths[s] || s === lengths.length - 1) {
          var t = lengths[s] ? remain / lengths[s] : 0;
          return {
            x: points[s][0] + (points[s + 1][0] - points[s][0]) * t,
            y: points[s][1] + (points[s + 1][1] - points[s][1]) * t,
            angle: Math.atan2(points[s + 1][1] - points[s][1], points[s + 1][0] - points[s][0])
          };
        }
        remain -= lengths[s];
      }
      var last = points[points.length - 1];
      return { x: last[0], y: last[1], angle: Math.PI / 2 };
    };

    // 规划路线：灰色虚线
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#C3CBD4';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (i = 0; i < points.length; i++) {
      if (i === 0) ctx.moveTo(points[i][0], points[i][1]);
      else ctx.lineTo(points[i][0], points[i][1]);
    }
    ctx.stroke();
    ctx.restore();

    // 已走轨迹：绿色实线（按 progress 截断）
    var traveled = total * progress;
    var head = pointAt(traveled);
    ctx.strokeStyle = '#07C160';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    var walked = 0;
    for (i = 0; i < lengths.length; i++) {
      if (traveled <= walked + lengths[i]) {
        var rest = traveled - walked;
        var ratio = lengths[i] ? rest / lengths[i] : 0;
        ctx.lineTo(
          points[i][0] + (points[i + 1][0] - points[i][0]) * ratio,
          points[i][1] + (points[i + 1][1] - points[i][1]) * ratio
        );
        break;
      }
      ctx.lineTo(points[i + 1][0], points[i + 1][1]);
      walked += lengths[i];
    }
    ctx.stroke();

    // 当前位置：光晕 + 绿点 + 朝向箭头
    ctx.beginPath();
    ctx.fillStyle = 'rgba(7, 193, 96, 0.16)';
    ctx.arc(head.x, head.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = '#07C160';
    ctx.arc(head.x, head.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.save();
    ctx.translate(head.x, head.y);
    ctx.rotate(head.angle);
    ctx.beginPath();
    ctx.moveTo(11, 0);
    ctx.lineTo(5, -4);
    ctx.lineTo(5, 4);
    ctx.closePath();
    ctx.fillStyle = '#07C160';
    ctx.fill();
    ctx.restore();
  },

  /* ---------------- 操作 ---------------- */

  goReport: function () {
    wx.switchTab({ url: '/pages/report/report' });
  },

  onPause: function () {
    // TODO: 契约暂无“暂停”指令，待服务端扩展 type:"task" / cmd:"pause" 后接入
    wx.showToast({ title: '演示版：暂停指令待接入', icon: 'none' });
  },

  onReturn: function () {
    // TODO: 契约暂无“返航”指令，待服务端扩展后接入
    wx.showToast({ title: '演示版：返航指令待接入', icon: 'none' });
  },

  onEstop: function () {
    var self = this;
    if (this.data.mode === 'estop') {
      wx.showToast({ title: '已处于急停状态', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认急停？',
      content: '立即停车并锁定所有控制，需在控制页长按 2 秒复位。硬件急停按钮始终优先。',
      confirmText: '立即急停',
      confirmColor: '#E5484D',
      success: function (res) {
        if (!res.confirm) return;
        app.sendEstop();
        self.setData({ mode: 'estop', modeText: '已急停' });
        wx.showToast({ title: '已急停', icon: 'none' });
      }
    });
  }
});
