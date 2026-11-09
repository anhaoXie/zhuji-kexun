/* ============================================================
 * 《株迹可循》手机端 H5 · 交互与数据层
 * - 无服务：内置 mock（字段与 docs/api_contract.md 一致），file:// 可直接打开
 * - 有服务：GET /api/* + ws://<host>/ws，失败静默降级 mock（不弹错误）
 * - 截图钩子：?shot=monitor|control|video|report&freeze=1，就绪后 window.__READY__=true
 * ============================================================ */
(function () {
  'use strict';

  /* ---------------- URL 参数 ---------------- */
  var params = new URLSearchParams(location.search);
  var TABS = ['monitor', 'control', 'video', 'report'];
  var SHOT = String(params.get('shot') || 'monitor').toLowerCase();
  if (TABS.indexOf(SHOT) < 0) SHOT = 'monitor';
  var FREEZE = params.get('freeze') === '1';
  var HAS_HTTP = /^https?:$/.test(location.protocol);
  var FIXED_TS = '2026-11-04 09:24:31';

  /* ---------------- 小工具 ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* ============================================================
   * 内置 mock 数据（字段与 api_contract.md 一致）
   * ============================================================ */
  var MOCK_STATE = {
    ts: 1793,
    device: { name: '株迹可循-01', fw: 'v1.0.0', link: 'wifi', rssi: -52, latency_ms: 28 },
    robot: {
      mode: 'patrol', mode_text: '巡检中',
      battery: 78, voltage: 11.6, current: 0.82, temp: 32,
      speed: 0.5, x: 3.24, y: 1.85, heading: 90,
      stop_index: 7, stop_total: 20,
      bed: 'B2', plot: 'B2-03',
      progress: 0.66, plants_done: 42, plants_total: 64,
      distance_m: 18.6, detected: 6
    },
    batch: { id: 'B-20261104-01', greenhouse: '1号棚', start: '2026-11-04T09:20:00+08:00', end: null, status: 'running' },
    recent: [
      { code: '1棚-3行-B2台-2位-1株', disease: '叶斑病', confidence: 0.91, state: '新发', time: '09:24', suggest: '分区标记 + 加密复查' },
      { code: '1棚-2行-A2台-1位-2株', disease: '叶斑病', confidence: 0.88, state: '持续', time: '09:23', suggest: '维持观察 + 降低湿度' },
      { code: '1棚-4行-B3台-2位-1株', disease: '叶斑病', confidence: 0.76, state: '好转', time: '09:22', suggest: '常规复查' }
    ],
    review: [
      { code: '1棚-2行-A1台-1位-1株', disease: '叶斑病', confidence: 0.63, state: '待复核' },
      { code: '1棚-3行-A3台-2位-2株', disease: '叶斑病', confidence: 0.61, state: '待复核' },
      { code: '1棚-4行-B2台-1位-1株', disease: '叶斑病', confidence: 0.58, state: '待复核' }
    ]
  };

  var MOCK_REPORT = {
    batch: { id: 'B-20261104-01', greenhouse: '1号棚', time: '2026-11-04 09:20—09:26', status: 'done' },
    kpis: [
      { key: 'plants', label: '巡检', value: '64', unit: '株' },
      { key: 'detected', label: '检出', value: '9', unit: '株' },
      { key: 'review', label: '待复核', value: '3', unit: '株' },
      { key: 'recall', label: '找回率', value: '95.3', unit: '%' }
    ],
    sub: { conclusion_rate: '84.4%', suggest_adopted: '6/9' },
    states: [
      { key: 'new', label: '新发', count: 2, color: '#E5484D' },
      { key: 'ongoing', label: '持续', count: 3, color: '#2F6BFF' },
      { key: 'worse', label: '加重', count: 1, color: '#F5A524' },
      { key: 'better', label: '好转', count: 1, color: '#07C160' },
      { key: 'handled', label: '已处理', count: 1, color: '#8A8F99' },
      { key: 'false', label: '疑似误报', count: 1, color: '#B58B00' }
    ],
    records: [
      { code: '1棚-3行-B2台-2位-1株', state: '新发', confidence: 0.91, advice: '分区标记 + 加密复查' },
      { code: '1棚-2行-A2台-1位-2株', state: '持续', confidence: 0.88, advice: '维持观察 + 降低湿度' },
      { code: '1棚-4行-B3台-2位-1株', state: '好转', confidence: 0.76, advice: '常规复查' }
    ],
    review: [
      { code: '1棚-2行-A1台-1位-1株', disease: '叶斑病', confidence: 0.63 },
      { code: '1棚-3行-A3台-2位-2株', disease: '叶斑病', confidence: 0.61 },
      { code: '1棚-4行-B2台-1位-1株', disease: '叶斑病', confidence: 0.58 }
    ],
    footer: '判定规则/阈值/模型版本随批次归档 · 批次 B-20261104-01'
  };

  /* 检测框按素材画面微调；有服务时以 /api/video/info 返回值为准 */
  var MOCK_VIDEO = {
    enabled: false,
    camera: 'K230 · 顶视', width: 1280, height: 720,
    bitrate: '1.2 Mbps', fps: 15,
    ptz: { pan: 0, pitch: 78 },
    ts: FIXED_TS,
    boxes: [
      { x: 0.24, y: 0.26, w: 0.24, h: 0.31, label: '叶斑病', confidence: 0.87, status: 'high' },
      { x: 0.08, y: 0.60, w: 0.17, h: 0.26, label: '叶斑病', confidence: 0.63, status: 'review' }
    ]
  };

  var S = MOCK_STATE;
  var R = MOCK_REPORT;
  var V = MOCK_VIDEO;

  var ui = {
    tab: SHOT,
    mode: 'patrol',          // patrol | remote | estop
    beforeEstop: 'patrol',
    paused: false,
    videoEnabled: false,
    joyMode: 'joy',
    speed: 0.30,
    remotePending: false,
    freeze: FREEZE
  };

  var TAG_CLASS = {
    '新发': 'tag-new', '持续': 'tag-ongoing', '加重': 'tag-worse',
    '好转': 'tag-better', '已处理': 'tag-handled', '疑似误报': 'tag-false', '待复核': 'tag-review'
  };

  /* ============================================================
   * 顶部 / tabbar
   * ============================================================ */
  function switchTab(name, opts) {
    if (TABS.indexOf(name) < 0) return;
    if (ui.tab === name && !(opts && opts.force)) return;
    ui.tab = name;
    $$('.page').forEach(function (p) {
      p.classList.toggle('active', p.getAttribute('data-page') === name);
    });
    $$('.tab-item').forEach(function (t) {
      var on = t.getAttribute('data-tab') === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (opts && opts.flashSelector) {
      var el = $(opts.flashSelector);
      if (el) {
        setTimeout(function () {
          el.classList.remove('flash');
          void el.offsetWidth;
          el.classList.add('flash');
        }, FREEZE ? 0 : 120);
      }
    }
  }

  /* ============================================================
   * 渲染 · 监控
   * ============================================================ */
  var MAP = {
    xs: [24, 318],
    aisles: [6, 28, 50, 72, 94],
    beds: [13, 35, 57, 79],
    bedX: 18, bedW: 306, bedH: 12,
    stationX: [56.25, 132.75, 209.25, 285.75],
    total: 0,
    segs: null
  };

  function buildMapGeometry() {
    var stationLayer = $('#stationLayer');
    var stopLayer = $('#stopLayer');
    if (!stationLayer || !stopLayer) return;
    var svgNS = 'http://www.w3.org/2000/svg';
    var fragS = document.createDocumentFragment();
    var fragT = document.createDocumentFragment();
    for (var b = 0; b < 4; b++) {
      var cy = MAP.beds[b] + MAP.bedH / 2;
      for (var s = 0; s < 4; s++) {
        var cx = MAP.stationX[s];
        // 每个台位 2×2 株点
        for (var dx = -1; dx <= 1; dx += 2) {
          for (var dy = -1; dy <= 1; dy += 2) {
            var dot = document.createElementNS(svgNS, 'circle');
            dot.setAttribute('cx', (cx + dx * 5.2).toFixed(1));
            dot.setAttribute('cy', (cy + dy * 3).toFixed(1));
            dot.setAttribute('r', '2');
            dot.setAttribute('fill', '#8CC79F');
            fragS.appendChild(dot);
          }
        }
        // 床侧过道上的停靠位刻度（5 过道 × 4 台位 = 20）
        for (var a = 0; a < MAP.aisles.length; a++) {
          var tick = document.createElementNS(svgNS, 'path');
          tick.setAttribute('d', 'M' + cx.toFixed(1) + ' ' + (MAP.aisles[a] - 3.2) + 'V' + (MAP.aisles[a] + 3.2));
          tick.setAttribute('stroke', '#C7D1CA');
          tick.setAttribute('stroke-width', '1.1');
          tick.setAttribute('stroke-linecap', 'round');
          fragT.appendChild(tick);
        }
      }
    }
    stationLayer.appendChild(fragS);
    stopLayer.appendChild(fragT);

    // S 形折返路径（5 条过道，一右一左交替）
    MAP.segs = [];
    var pts = [];
    for (var i = 0; i < MAP.aisles.length; i++) {
      var y = MAP.aisles[i];
      if (i % 2 === 0) { pts.push([MAP.xs[0], y]); pts.push([MAP.xs[1], y]); }
      else { pts.push([MAP.xs[1], y]); pts.push([MAP.xs[0], y]); }
    }
    MAP.total = 0;
    for (var k = 0; k < pts.length - 1; k++) {
      var dx2 = pts[k + 1][0] - pts[k][0];
      var dy2 = pts[k + 1][1] - pts[k][1];
      var len = Math.sqrt(dx2 * dx2 + dy2 * dy2);
      MAP.segs.push({ x1: pts[k][0], y1: pts[k][1], x2: pts[k + 1][0], y2: pts[k + 1][1], len: len, start: MAP.total });
      MAP.total += len;
    }
  }

  function pointAt(dist) {
    if (!MAP.segs || !MAP.segs.length) return { x: MAP.xs[0], y: MAP.aisles[0], angle: 0 };
    var d = Math.max(0, Math.min(dist, MAP.total - 0.01));
    for (var i = 0; i < MAP.segs.length; i++) {
      var seg = MAP.segs[i];
      if (d <= seg.start + seg.len || i === MAP.segs.length - 1) {
        var t = Math.max(0, Math.min(1, (d - seg.start) / seg.len));
        var x = seg.x1 + (seg.x2 - seg.x1) * t;
        var y = seg.y1 + (seg.y2 - seg.y1) * t;
        var dx = seg.x2 - seg.x1;
        var dy = seg.y2 - seg.y1;
        var angle = Math.atan2(dx, -dy) * 180 / Math.PI;
        return { x: x, y: y, angle: angle, seg: seg };
      }
    }
    return { x: MAP.xs[0], y: MAP.aisles[0], angle: 0 };
  }

  function updateMap(progress) {
    var donePath = $('#routeDone');
    var group = $('#curGroup');
    if (!MAP.segs || !MAP.segs.length) return;
    var p = Math.max(0, Math.min(1, Number(progress) || 0));
    var dist = MAP.total * p;
    var target = pointAt(dist);
    var d = 'M' + MAP.segs[0].x1 + ' ' + MAP.segs[0].y1;
    for (var i = 0; i < MAP.segs.length; i++) {
      var seg = MAP.segs[i];
      if (dist >= seg.start + seg.len) {
        d += ' L' + seg.x2 + ' ' + seg.y2;
      } else {
        d += ' L' + target.x.toFixed(2) + ' ' + target.y.toFixed(2);
        break;
      }
    }
    if (donePath) donePath.setAttribute('d', d);
    if (group) {
      group.style.display = '';
      group.setAttribute('transform', 'translate(' + target.x.toFixed(2) + ' ' + target.y.toFixed(2) + ')');
      var arrow = $('#curArrow');
      if (arrow) arrow.setAttribute('transform', 'rotate(' + target.angle.toFixed(1) + ')');
    }
  }

  function formatEta(remainingPlants) {
    var seconds = Math.max(1, Math.round(remainingPlants * 4.5 / 5) * 5);
    if (seconds >= 60) {
      var m = Math.floor(seconds / 60);
      var s = seconds % 60;
      return m + ' 分' + (s ? ' ' + s + ' 秒' : '');
    }
    return seconds + ' 秒';
  }

  function renderMonitor() {
    var r = S.robot || {};
    var d = S.device || {};
    var batch = S.batch || {};
    var stopsTotal = 16;
    var stop = Math.min(stopsTotal, Math.max(1, Number(r.stop_index) || 1));
    var plantsDone = Number(r.plants_done) || 0;
    var plantsTotal = Number(r.plants_total) || 64;
    var progress = typeof r.progress === 'number' ? r.progress : (plantsTotal ? plantsDone / plantsTotal : 0);
    var pct = Math.round(progress * 100);
    var battery = Math.round(Number(r.battery) || 0);
    var voltage = typeof r.voltage === 'number' ? r.voltage : 11.6;

    var heroMode = $('#heroMode');
    if (heroMode) {
      var text = (batch.greenhouse || '1号棚') + ' · ';
      if (ui.mode === 'estop') text += '已急停';
      else if (S.robot && S.robot.mode === 'idle' && !ui.paused) text += '待命';
      else if (ui.paused) text += '已暂停';
      else text += (r.mode_text || '巡检中');
      heroMode.textContent = text;
    }
    var heroLine = $('.hero-line .live-dot');
    if (heroLine) heroLine.style.background = ui.mode === 'estop' ? '#FF6B6B' : '';

    var heroStop = $('#heroStop');
    if (heroStop) heroStop.textContent = '台位 ' + Math.min(stop, stopsTotal) + '/' + stopsTotal;
    var heroSub = $('#heroSub');
    if (heroSub) {
      var remaining = Math.max(0, plantsTotal - plantsDone);
      heroSub.textContent = '已检 ' + plantsDone + '/' + plantsTotal + ' 株 · 预计 ' + formatEta(remaining) + '完成';
    }
    var heroBattery = $('#heroBattery');
    if (heroBattery) heroBattery.textContent = battery + '%';
    var ring = $('#heroRing');
    if (ring) ring.setAttribute('stroke-dashoffset', (157.08 * (1 - battery / 100)).toFixed(2));
    var heroVolt = $('#heroVolt');
    if (heroVolt) heroVolt.textContent = voltage.toFixed(1) + ' V · 33 Wh';

    var chipSpeed = $('#chipSpeed');
    if (chipSpeed) chipSpeed.textContent = (typeof r.speed === 'number' ? r.speed.toFixed(1) : '0.5') + ' m/s';
    var chipRssi = $('#chipRssi');
    if (chipRssi) chipRssi.textContent = (Number(d.rssi) || -52) + ' dBm';
    var chipDist = $('#chipDist');
    if (chipDist) chipDist.textContent = (typeof r.distance_m === 'number' ? r.distance_m.toFixed(1) : '18.6') + ' m';
    var chipDetected = $('#chipDetected');
    if (chipDetected) chipDetected.textContent = (Number(r.detected) || 0) + ' 株';

    var progressText = $('#progressText');
    if (progressText) progressText.textContent = pct + '%（' + plantsDone + '/' + plantsTotal + '）';
    var progressFill = $('#progressFill');
    if (progressFill) progressFill.style.width = pct + '%';
    var progressSub = $('#progressSub');
    if (progressSub) progressSub.textContent = (r.plot || 'B2-03') + ' · 第 ' + stop + '/' + stopsTotal + ' 台位';
    var mapMeta = $('#mapMeta');
    if (mapMeta) mapMeta.textContent = '停靠位 ' + (Number(r.stop_index) || 0) + '/' + (Number(r.stop_total) || 20);

    updateMap(progress);

    // 最近结果
    var list = $('#recentList');
    if (list) {
      var rows = (S.recent || []).slice(0, 3);
      if (!rows.length) {
        list.innerHTML = '<div class="recent-row"><div class="rr-line"><span class="rr-code">暂无检测记录</span></div></div>';
      } else {
        list.innerHTML = rows.map(function (it) {
          var cls = TAG_CLASS[it.state] || 'tag-handled';
          var conf = Number(it.confidence);
          return '' +
            '<div class="recent-row">' +
              '<div class="rr-line">' +
                '<span class="rr-code">' + esc(it.code) + '</span>' +
                '<span class="tag ' + cls + '">' + esc(it.state) + '</span>' +
                '<span class="rr-conf">置信度 ' + (isNaN(conf) ? '-' : conf.toFixed(2)) + '</span>' +
              '</div>' +
              '<div class="rr-sub">' + esc(it.disease || '') + ' · ' + esc(it.time || '') + '</div>' +
            '</div>';
        }).join('');
      }
    }

    // 待复核
    var review = S.review || [];
    var reviewCount = $('#reviewCount');
    if (reviewCount) reviewCount.textContent = review.length + ' 株待复核';
    var reviewBar = $('.review-bar');
    if (reviewBar) reviewBar.style.display = review.length ? '' : 'none';
  }

  /* ============================================================
   * 渲染 · 控制
   * ============================================================ */
  var MAX_W = 1.2;
  var JOY_MAX_R = 74;
  var PRESET_DX = 12.3;   /* w=-0.20 rad/s，满足冻结截图固定值 */
  var PRESET_DY = -27.8;  /* v=0.30 m/s（0.8 m/s 满量程的 3/8） */

  function renderControl() {
    var d = S.device || {};
    var r = S.robot || {};
    var tmLink = $('#tmLink');
    if (tmLink) tmLink.textContent = (Number(d.latency_ms) || 28) + ' ms';
    var tmBatt = $('#tmBatt');
    if (tmBatt) tmBatt.textContent = (Math.round(Number(r.battery) || 78)) + '%';
    var tmTemp = $('#tmTemp');
    if (tmTemp) tmTemp.textContent = (Math.round(Number(r.temp) || 32)) + ' ℃';

    var speedVal = $('#speedVal');
    if (speedVal) speedVal.textContent = ui.speed.toFixed(2) + ' m/s';
    var range = $('#speedRange');
    if (range) {
      range.value = String(ui.speed);
      var p = ((ui.speed - 0.1) / 0.7) * 100;
      range.style.setProperty('--p', p.toFixed(1) + '%');
      range.disabled = ui.mode === 'estop';
    }
    updateModeUI();
    updateVideoUI();
  }

  function updateModeUI() {
    $$('#modeSeg .seg-item').forEach(function (b) {
      var m = b.getAttribute('data-mode');
      var on = (m === 'patrol' && ui.mode !== 'remote') || (m === 'remote' && ui.mode === 'remote');
      if (ui.mode === 'estop') on = false;
      b.classList.toggle('active', on);
      b.disabled = ui.mode === 'estop';
    });
    var locked = ui.mode !== 'remote' || ui.mode === 'estop';
    var joy = $('#joystick');
    if (joy) {
      joy.classList.toggle('is-locked', locked);
      joy.classList.toggle('is-disabled', ui.mode === 'estop');
      joy.classList.remove('is-dragging');
    }
    var tag = $('#joyModeTag');
    if (tag) {
      tag.textContent = ui.mode === 'remote' ? '远程可操控' : (ui.mode === 'estop' ? '已急停' : '巡检锁定');
      tag.classList.toggle('is-remote', ui.mode === 'remote');
    }
    var hint = $('#joyHint');
    if (hint) hint.textContent = ui.mode === 'estop' ? '急停锁定，需长按复位' : '远程模式可操控';
    var estopBtn = $('#estopBtn');
    if (estopBtn) {
      var isEstop = ui.mode === 'estop';
      estopBtn.classList.toggle('is-estop', isEstop);
      var label = $('.estop-label', estopBtn);
      var sub = $('.estop-sub', estopBtn);
      if (label) label.textContent = isEstop ? '已急停' : '急停';
      if (sub) sub.textContent = isEstop ? '长按 2 秒复位' : '切断动力，立即停车';
      if (!isEstop) estopBtn.style.background = '';
    }
    var stopBtn = $('#stopBtn');
    if (stopBtn) stopBtn.disabled = ui.mode === 'estop';
    var fab = $('#estopFab');
    if (fab) {
      fab.classList.toggle('is-estop', ui.mode === 'estop');
      var fabLabel = $('span', fab);
      if (fabLabel) fabLabel.textContent = ui.mode === 'estop' ? '已急停' : '急停';
    }
  }

  function setJoyKnob(dx, dy) {
    var knob = $('#joyKnob');
    if (!knob) return;
    knob.style.transform = 'translate(-50%, -50%) translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
  }

  function setReadout(v, w) {
    var el = $('#joyReadout');
    if (!el) return;
    el.innerHTML = 'v=' + (v >= 0 ? '' : '') + v.toFixed(2) + ' m/s&nbsp;&nbsp;w=' + (w >= 0 ? '+' : '') + w.toFixed(2) + ' rad/s';
  }

  function resetReadout() {
    var el = $('#joyReadout');
    if (el) el.innerHTML = 'v=0.00 m/s&nbsp;&nbsp;w=0.00 rad/s';
  }

  function updateVideoUI() {
    var on = ui.videoEnabled;
    var sw = $('#videoToggle');
    if (sw) {
      sw.classList.toggle('on', on);
      sw.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    var hint = $('#videoHint');
    if (hint) hint.textContent = on ? '720p/15fps/1.2 Mbps，仅演示与远程接管' : '默认关闭，开启后仅传低码率画面';
    var badge = $('#videoBadge');
    if (badge) {
      badge.textContent = on ? '监看中' : '默认关闭';
      badge.classList.toggle('is-live', on);
    }
  }

  /* ============================================================
   * 渲染 · 图传
   * ============================================================ */
  function renderVideo() {
    var ts = $('#camTs');
    if (ts) ts.textContent = FREEZE ? FIXED_TS : (V.ts || FIXED_TS);
    var stream = $('#streamTag');
    if (stream) stream.textContent = (V.height || 720) + 'p ' + (V.fps || 15) + 'fps ' + (V.bitrate || '1.2 Mbps');

    var layer = $('#bboxLayer');
    var boxes = V.boxes || [];
    if (layer) {
      layer.innerHTML = boxes.map(function (b) {
        var review = b.status === 'review';
        var conf = Number(b.confidence);
        var label = esc(b.label) + ' ' + (isNaN(conf) ? '' : conf.toFixed(2)) + (review ? ' 待复核' : '');
        return '<div class="bbox ' + (review ? 'bbox-review' : 'bbox-main') + '" style="left:' +
          (b.x * 100).toFixed(2) + '%;top:' + (b.y * 100).toFixed(2) + '%;width:' +
          (b.w * 100).toFixed(2) + '%;height:' + (b.h * 100).toFixed(2) + '%">' +
          '<span class="bbox-label">' + label + '</span></div>';
      }).join('');
    }

    var info = $('#camInfo');
    if (info) {
      var pitch = V.ptz && typeof V.ptz.pitch === 'number' ? V.ptz.pitch : 78;
      var plot = (S.robot && S.robot.plot) || 'B2-03';
      var plant = '2-1';
      var first = (S.recent && S.recent[0] && S.recent[0].code) || '';
      var mm = first.match(/-(\d+)位-(\d+)株$/);
      if (mm) plant = mm[1] + '-' + mm[2];
      info.textContent = '云台 俯仰 ' + pitch + '° · 台位 ' + plot + ' · 株 ' + plant;
    }

    var detectList = $('#detectList');
    if (detectList) {
      detectList.innerHTML = boxes.map(function (b) {
        var review = b.status === 'review';
        var conf = Number(b.confidence);
        return '<div class="detect-row">' +
          '<i class="detect-swatch" style="background:' + (review ? '#F5C34B' : '#2BD77F') + '"></i>' +
          '<span class="detect-name">' + esc(b.label) + '</span>' +
          '<span class="detect-conf">' + (isNaN(conf) ? '-' : conf.toFixed(2)) + '</span>' +
          '<span class="detect-status ' + (review ? 'review' : 'high') + '">' + (review ? '待复核' : '高置信') + '</span>' +
          '</div>';
      }).join('');
      var note = $('#detectNote');
      if (note) note.textContent = boxes.length + ' 个目标';
    }

    var metaCamera = $('#metaCamera');
    if (metaCamera) metaCamera.textContent = V.camera || 'K230 · 顶视';
    var metaRes = $('#metaRes');
    if (metaRes) metaRes.textContent = (V.width || 1280) + '×' + (V.height || 720);
    var metaFps = $('#metaFps');
    if (metaFps) metaFps.textContent = (V.fps || 15) + ' fps';
    var metaPitch = $('#metaPitch');
    if (metaPitch) metaPitch.textContent = ((V.ptz && V.ptz.pitch) || 78) + '°';

    var pitch = (V.ptz && typeof V.ptz.pitch === 'number') ? V.ptz.pitch : 78;
    var presetPitch = $('#presetPitch');
    if (presetPitch) presetPitch.textContent = String(pitch);
    $$('#presetRow .preset').forEach(function (b) {
      b.classList.toggle('active', Number(b.getAttribute('data-pitch')) === pitch);
    });

    updateVideoUI();
  }

  /* ============================================================
   * 渲染 · 报表
   * ============================================================ */
  function renderReport() {
    var batch = R.batch || {};
    var batchTime = $('#batchTime');
    if (batchTime) batchTime.textContent = batch.time || '2026-11-04 09:20—09:26';
    var batchPick = $('#batchPick');
    if (batchPick) {
      batchPick.childNodes[0] && (batchPick.childNodes[0].nodeValue = (batch.id || 'B-20261104-01') + ' ');
    }
    var batchStatus = $('#batchStatus');
    if (batchStatus) batchStatus.textContent = batch.status === 'done' ? '已完成' : '进行中';

    var grid = $('#kpiGrid');
    if (grid) {
      grid.innerHTML = (R.kpis || []).map(function (k) {
        return '<div class="kpi-cell' + (k.key === 'recall' ? ' is-accent' : '') + '">' +
          '<div class="kpi-label">' + esc(k.label) + '</div>' +
          '<div class="kpi-num">' + esc(k.value) + '<span>' + esc(k.unit) + '</span></div>' +
          '</div>';
      }).join('');
    }
    var sub = R.sub || {};
    var conclusionRate = $('#conclusionRate');
    if (conclusionRate) conclusionRate.textContent = sub.conclusion_rate || '84.4%';
    var suggestAdopted = $('#suggestAdopted');
    if (suggestAdopted) suggestAdopted.textContent = sub.suggest_adopted || '6/9';

    var states = R.states || [];
    var statesList = $('#statesList');
    if (statesList) {
      var max = 1;
      states.forEach(function (s) { max = Math.max(max, Number(s.count) || 0); });
      statesList.innerHTML = states.map(function (s) {
        var w = Math.max(6, (Number(s.count) || 0) / max * 100);
        return '<div class="state-row">' +
          '<span class="state-label">' + esc(s.label) + '</span>' +
          '<span class="state-track"><i style="width:' + w.toFixed(1) + '%;background:' + esc(s.color || '#8A8F99') + '"></i></span>' +
          '<span class="state-count">' + (Number(s.count) || 0) + '</span>' +
          '</div>';
      }).join('');
    }
    var statesNote = $('#statesNote');
    if (statesNote) {
      var sum = states.reduce(function (a, s) { return a + (Number(s.count) || 0); }, 0);
      statesNote.textContent = '共 ' + sum + ' 株';
    }

    var records = R.records || [];
    var recordsList = $('#recordsList');
    if (recordsList) {
      recordsList.innerHTML = records.map(function (it) {
        var cls = TAG_CLASS[it.state] || 'tag-handled';
        var conf = Number(it.confidence);
        return '<div class="record-row">' +
          '<div class="rec-line">' +
            '<span class="rec-code">' + esc(it.code) + '</span>' +
            '<span class="tag ' + cls + '">' + esc(it.state) + '</span>' +
            '<span class="rec-conf">' + (isNaN(conf) ? '-' : conf.toFixed(2)) + '</span>' +
          '</div>' +
          '<div class="rec-advice">' + esc(it.advice || '') + '</div>' +
          '</div>';
      }).join('');
    }
    var recordsNote = $('#recordsNote');
    if (recordsNote) recordsNote.textContent = '共 ' + records.length + ' 条';

    renderReportReview();

    var footer = $('#reportFooter');
    if (footer) footer.textContent = R.footer || ('判定规则/阈值/模型版本随批次归档 · 批次 ' + (batch.id || 'B-20261104-01'));
  }

  function renderReportReview() {
    var list = $('#reviewList');
    if (!list) return;
    var items = R.review || [];
    list.innerHTML = items.map(function (it) {
      var conf = Number(it.confidence);
      return '<div class="review-item" data-code="' + esc(it.code) + '" data-done="0">' +
        '<div class="ri-main">' +
          '<div class="ri-line">' +
            '<span class="ri-code">' + esc(it.code) + '</span>' +
            '<span class="ri-conf">' + esc(it.disease || '叶斑病') + ' ' + (isNaN(conf) ? '-' : conf.toFixed(2)) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="ri-actions">' +
          '<button class="mini-btn confirm" data-act="confirm">确认</button>' +
          '<button class="mini-btn rejudge" data-act="rejudge">改判</button>' +
        '</div>' +
      '</div>';
    }).join('');
    updateReviewNote();
  }

  function updateReviewNote() {
    var note = $('#reviewNote');
    if (!note) return;
    var left = $$('#reviewList .review-item').filter(function (el) {
      return el.getAttribute('data-done') !== '1';
    }).length;
    note.textContent = '共 ' + left + ' 条 · 低置信';
  }

  /* ============================================================
   * Toast / Modal
   * ============================================================ */
  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 1600);
  }

  var modalState = { confirm: null };
  function showModal(opts) {
    var mask = $('#modalMask');
    if (!mask) return;
    $('#modalTitle').textContent = opts.title || '提示';
    $('#modalBody').textContent = opts.body || '';
    var cancel = $('#modalCancel');
    var confirm = $('#modalConfirm');
    cancel.textContent = opts.cancelText || '取消';
    confirm.textContent = opts.confirmText || '确认';
    confirm.classList.toggle('danger', !!opts.danger);
    modalState.confirm = opts.onConfirm || null;
    mask.hidden = false;
  }
  function closeModal() {
    var mask = $('#modalMask');
    if (mask) mask.hidden = true;
    modalState.confirm = null;
  }
  function wireModal() {
    var mask = $('#modalMask');
    if (!mask) return;
    $('#modalCancel').addEventListener('click', closeModal);
    mask.addEventListener('click', function (e) { if (e.target === mask) closeModal(); });
    $('#modalConfirm').addEventListener('click', function () {
      var fn = modalState.confirm;
      closeModal();
      if (fn) fn();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !mask.hidden) closeModal();
    });
  }

  /* ============================================================
   * 模式 / 急停
   * ============================================================ */
  function applyMode(mode, opts) {
    ui.mode = mode;
    if (mode === 'remote') {
      setJoyKnob(PRESET_DX, PRESET_DY);
      setReadout(0.30, -0.20);
    } else {
      setJoyKnob(0, 0);
      resetReadout();
    }
    updateModeUI();
    if (!(opts && opts.silent)) {
      renderMonitor();
      renderControl();
    }
  }

  function executeEstop() {
    if (ui.mode === 'estop') return;
    ui.beforeEstop = ui.mode === 'remote' ? 'remote' : 'patrol';
    ui.mode = 'estop';
    setJoyKnob(0, 0);
    resetReadout();
    updateModeUI();
    renderMonitor();
    wsSend({ type: 'estop' });
    toast('已急停：车辆停车并锁定控制');
  }

  function resetEstop() {
    ui.mode = ui.beforeEstop === 'remote' ? 'remote' : 'patrol';
    var btn = $('#estopBtn');
    if (btn) btn.style.background = '';
    applyMode(ui.mode, { silent: false });
    wsSend({ type: 'estop_reset' });
    toast('急停已复位，恢复' + (ui.mode === 'remote' ? '远程模式' : '巡检模式'));
  }

  /* ============================================================
   * WebSocket / API
   * ============================================================ */
  var ws = null;
  var wsSeq = 0;
  var wsHeartbeat = null;
  var reconnectTimer = null;

  function wsReady() { return ws && ws.readyState === 1; }
  function wsSend(obj) {
    if (!wsReady()) return;
    try { ws.send(JSON.stringify(obj)); } catch (e) { /* 静默 */ }
  }

  function connectWS() {
    if (FREEZE || !HAS_HTTP || ws) return;
    var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    var sock;
    try { sock = new WebSocket(proto + location.host + '/ws'); } catch (e) { return; }
    ws = sock;
    sock.onopen = function () {
      wsSend({ type: 'hello', client: 'h5' });
      clearInterval(wsHeartbeat);
      wsHeartbeat = setInterval(function () { wsSend({ type: 'ping', t: Date.now() }); }, 10000);
    };
    sock.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      handleWs(msg);
    };
    sock.onerror = function () { /* 静默降级 */ };
    sock.onclose = function () {
      if (ws !== sock) return;
      ws = null;
      clearInterval(wsHeartbeat);
      if (!FREEZE) {
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connectWS, 3000);
      }
    };
  }

  function handleWs(msg) {
    if (!msg || !msg.type) return;
    if (msg.type === 'state') {
      S = msg;
      if (S.robot && S.robot.mode === 'estop') {
        ui.mode = 'estop';
        updateModeUI();
      }
      renderMonitor();
      renderControlTelemetry();
    } else if (msg.type === 'event' && msg.text) {
      if (!FREEZE) toast(msg.text);
    } else if (msg.type === 'ack') {
      if (msg.ok === false) toast('指令被拒绝' + (msg.error ? '：' + msg.error : ''));
    } else if (msg.type === 'report_ready') {
      fetchReport(true);
    }
  }

  function renderControlTelemetry() {
    var d = S.device || {};
    var r = S.robot || {};
    var tmLink = $('#tmLink');
    if (tmLink) tmLink.textContent = (Number(d.latency_ms) || 0) + ' ms';
    var tmBatt = $('#tmBatt');
    if (tmBatt) tmBatt.textContent = (Math.round(Number(r.battery) || 0)) + '%';
    var tmTemp = $('#tmTemp');
    if (tmTemp) tmTemp.textContent = (Math.round(Number(r.temp) || 0)) + ' ℃';
  }

  function getJSON(url, timeout) {
    return new Promise(function (resolve, reject) {
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = setTimeout(function () {
        if (controller) controller.abort();
        reject(new Error('timeout'));
      }, timeout || 1500);
      fetch(url, { cache: 'no-store', signal: controller ? controller.signal : undefined })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) { clearTimeout(timer); resolve(data); })
        .catch(function (err) { clearTimeout(timer); reject(err); });
    });
  }

  function fetchState() {
    return getJSON('/api/state').then(function (data) {
      if (!data || !data.robot) throw new Error('bad state');
      S = data;
      if (data.robot.mode === 'remote') ui.mode = 'remote';
      else if (data.robot.mode === 'estop') ui.mode = 'estop';
      else if (ui.mode !== 'estop') ui.mode = 'patrol';
      renderMonitor();
      renderControl();
      connectWS();
    }).catch(function () { /* 静默 mock */ });
  }

  function fetchReport(notify) {
    return getJSON('/api/report?batch=B-20261104-01').then(function (data) {
      if (!data || !data.kpis) throw new Error('bad report');
      R = data;
      renderReport();
      if (notify) toast('批次报表已生成');
    }).catch(function () { /* 静默 mock */ });
  }

  function fetchVideo() {
    return getJSON('/api/video/info').then(function (data) {
      if (!data || !data.boxes) throw new Error('bad video');
      V = data;
      ui.videoEnabled = !!data.enabled;
      syncTsFromVideo();
      renderVideo();
    }).catch(function () { /* 静默 mock */ });
  }

  /* ============================================================
   * 摇杆 / 方向键
   * ============================================================ */
  var joy = { dragging: false, pointerId: null, lastSend: 0, v: 0, w: 0 };

  function joyCommand(dx, dy) {
    /* 摇杆满量程对应 0.8 m/s / 1.2 rad/s，再用速度上限裁剪 */
    var v = -(dy / JOY_MAX_R) * 0.8;
    var w = -(dx / JOY_MAX_R) * MAX_W;
    v = Math.max(-ui.speed, Math.min(ui.speed, v));
    w = Math.max(-MAX_W, Math.min(MAX_W, w));
    return { v: Math.round(v * 100) / 100, w: Math.round(w * 100) / 100 };
  }

  function setCommand(v, w, force) {
    joy.v = v;
    joy.w = w;
    var el = $('#joyReadout');
    if (el) {
      el.innerHTML = 'v=' + v.toFixed(2) + ' m/s&nbsp;&nbsp;w=' + (w >= 0 ? '+' : '') + w.toFixed(2) + ' rad/s';
    }
    var now = Date.now();
    if (force || now - joy.lastSend > 60) {
      joy.lastSend = now;
      wsSeq += 1;
      wsSend({ type: 'control', cmd: 'move', v: v, w: w, seq: wsSeq });
    }
  }

  function stopCommand() {
    joy.v = 0;
    joy.w = 0;
    resetReadout();
    wsSeq += 1;
    wsSend({ type: 'control', cmd: 'stop', v: 0, w: 0, seq: wsSeq });
  }

  function wireJoystick() {
    var zone = $('#joystick');
    if (!zone) return;

    function localPoint(e) {
      var rect = zone.getBoundingClientRect();
      return {
        x: e.clientX - rect.left - rect.width / 2,
        y: e.clientY - rect.top - rect.height / 2
      };
    }

    zone.addEventListener('pointerdown', function (e) {
      if (ui.mode === 'estop') { toast('已急停，请先长按复位'); return; }
      if (ui.mode !== 'remote') { toast('巡检模式下不可控车，请先切换远程模式'); return; }
      joy.dragging = true;
      joy.pointerId = e.pointerId;
      zone.classList.add('is-dragging');
      try { zone.setPointerCapture(e.pointerId); } catch (err) {}
      var p = localPoint(e);
      var len = Math.sqrt(p.x * p.x + p.y * p.y);
      if (len > JOY_MAX_R) { p.x = p.x / len * JOY_MAX_R; p.y = p.y / len * JOY_MAX_R; }
      setJoyKnob(p.x, p.y);
      var cmd = joyCommand(p.x, p.y);
      setCommand(cmd.v, cmd.w, true);
      e.preventDefault();
    });

    zone.addEventListener('pointermove', function (e) {
      if (!joy.dragging || e.pointerId !== joy.pointerId) return;
      var p = localPoint(e);
      var len = Math.sqrt(p.x * p.x + p.y * p.y);
      if (len > JOY_MAX_R) { p.x = p.x / len * JOY_MAX_R; p.y = p.y / len * JOY_MAX_R; }
      setJoyKnob(p.x, p.y);
      var cmd = joyCommand(p.x, p.y);
      setCommand(cmd.v, cmd.w, false);
      e.preventDefault();
    });

    function release(e) {
      if (!joy.dragging) return;
      if (e && e.pointerId !== undefined && e.pointerId !== joy.pointerId) return;
      joy.dragging = false;
      joy.pointerId = null;
      zone.classList.remove('is-dragging');
      setJoyKnob(0, 0);
      stopCommand();
    }
    zone.addEventListener('pointerup', release);
    zone.addEventListener('pointercancel', release);
    zone.addEventListener('lostpointercapture', function () { if (joy.dragging) release(); });
  }

  function wireDirpad() {
    var shown = false;
    $$('#joyModeSeg button').forEach(function (b) {
      b.addEventListener('click', function () {
        var mode = b.getAttribute('data-jmode');
        ui.joyMode = mode;
        $$('#joyModeSeg button').forEach(function (x) { x.classList.toggle('active', x === b); });
        var joyEl = $('#joystick');
        var pad = $('#dirpad');
        shown = mode === 'btn';
        if (joyEl) joyEl.style.display = shown ? 'none' : '';
        if (pad) pad.hidden = !shown;
        if (shown) resetReadout();
      });
    });

    function press(btn) {
      if (ui.mode !== 'remote') {
        toast(ui.mode === 'estop' ? '已急停，请先长按复位' : '巡检模式下不可控车，请先切换远程模式');
        return;
      }
      var cmd = btn.getAttribute('data-cmd');
      var v = 0, w = 0;
      if (cmd === 'fwd') v = ui.speed;
      else if (cmd === 'back') v = -ui.speed;
      else if (cmd === 'left') w = 0.65;
      else if (cmd === 'right') w = -0.65;
      setJoyKnob(cmd === 'left' ? -JOY_MAX_R : cmd === 'right' ? JOY_MAX_R : 0,
        cmd === 'fwd' ? -JOY_MAX_R : cmd === 'back' ? JOY_MAX_R : 0);
      setCommand(v, w, true);
    }
    function releaseBtn() {
      setJoyKnob(0, 0);
      stopCommand();
    }
    $$('.dbtn').forEach(function (btn) {
      btn.addEventListener('pointerdown', function (e) {
        if (btn.getAttribute('data-cmd') === 'stop') { press(btn); setJoyKnob(0, 0); stopCommand(); return; }
        press(btn);
        e.preventDefault();
      });
      btn.addEventListener('pointerup', releaseBtn);
      btn.addEventListener('pointercancel', releaseBtn);
      btn.addEventListener('pointerleave', function () { if (ui.mode === 'remote') releaseBtn(); });
    });
  }

  function wireControl() {
    $$('#modeSeg .seg-item').forEach(function (b) {
      b.addEventListener('click', function () {
        var mode = b.getAttribute('data-mode');
        if (ui.mode === 'estop') { toast('已急停，请先长按复位'); return; }
        if (mode === ui.mode) return;
        if (mode === 'remote') {
          showModal({
            title: '切换至远程模式',
            body: '切换后小程序可低速控车，2.4G 遥控器仍为最高优先级。请确认车辆周边无人、无障碍物。',
            confirmText: '确认切换',
            onConfirm: function () {
              applyMode('remote');
              wsSend({ type: 'mode', mode: 'remote' });
              toast('已切换至远程模式');
            }
          });
        } else {
          applyMode('patrol');
          wsSend({ type: 'mode', mode: 'patrol' });
          toast('已恢复巡检模式');
        }
      });
    });

    var range = $('#speedRange');
    if (range) {
      range.addEventListener('input', function () {
        ui.speed = Math.round(parseFloat(range.value) * 100) / 100;
        var p = ((ui.speed - 0.1) / 0.7) * 100;
        range.style.setProperty('--p', p.toFixed(1) + '%');
        var speedVal = $('#speedVal');
        if (speedVal) speedVal.textContent = ui.speed.toFixed(2) + ' m/s';
      });
    }

    var stopBtn = $('#stopBtn');
    if (stopBtn) {
      stopBtn.addEventListener('click', function () {
        if (ui.mode === 'estop') { toast('已急停，请先长按复位'); return; }
        setJoyKnob(0, 0);
        stopCommand();
        toast('已发送停止指令');
      });
    }

    var toggle = $('#videoToggle');
    if (toggle) {
      toggle.addEventListener('click', function () {
        ui.videoEnabled = !ui.videoEnabled;
        wsSend({ type: 'video', enabled: ui.videoEnabled });
        updateVideoUI();
        toast(ui.videoEnabled ? '图传监看已开启（演示）' : '图传监看已关闭');
      });
    }

    wireEstopButton();
    wireDirpad();
  }

  function wireEstopButton() {
    var btn = $('#estopBtn');
    if (!btn) return;
    var holdTimer = null;
    var rafId = null;
    var startedAt = 0;

    function cancelHold() {
      clearInterval(holdTimer);
      holdTimer = null;
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      if (ui.mode === 'estop') btn.style.background = '';
    }

    function tick() {
      var pct = Math.min(100, (Date.now() - startedAt) / 2000 * 100);
      btn.style.background = 'linear-gradient(90deg,#E5484D 0%,#E5484D ' + pct.toFixed(1) +
        '%,#7C8794 ' + pct.toFixed(1) + '%,#7C8794 100%)';
      if (pct >= 100) {
        cancelHold();
        resetEstop();
      }
    }

    btn.addEventListener('pointerdown', function (e) {
      if (ui.mode !== 'estop') return;
      startedAt = Date.now();
      clearInterval(holdTimer);
      holdTimer = setInterval(tick, 30);
      toast('继续按住 2 秒复位急停');
      try { btn.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (evt) {
      btn.addEventListener(evt, function () {
        if (holdTimer) { cancelHold(); if (ui.mode === 'estop') toast('已取消复位'); }
      });
    });
    btn.addEventListener('click', function () {
      if (ui.mode === 'estop') return;
      executeEstop();
    });
  }

  /* ============================================================
   * 监控页交互
   * ============================================================ */
  function wireMonitor() {
    var pauseBtn = $('#pauseBtn');
    if (pauseBtn) {
      pauseBtn.addEventListener('click', function () {
        if (ui.mode === 'estop') { toast('已急停，请先在控制页复位'); return; }
        ui.paused = !ui.paused;
        pauseBtn.textContent = ui.paused ? '继续巡检' : '暂停巡检';
        renderMonitor();
        wsSend({ type: 'mode', mode: ui.paused ? 'patrol' : 'patrol' });
        toast(ui.paused ? '巡检已暂停（演示）' : '巡检已继续');
      });
    }
    var returnBtn = $('#returnBtn');
    if (returnBtn) {
      returnBtn.addEventListener('click', function () {
        toast('返航指令已发送（演示）');
      });
    }
    var recentAll = $('#recentAll');
    if (recentAll) {
      recentAll.addEventListener('click', function () {
        switchTab('report');
        toast('已切换到本批次报表');
      });
    }
    var gotoReview = $('#gotoReview');
    if (gotoReview) {
      gotoReview.addEventListener('click', function () {
        switchTab('report', { flashSelector: '#reviewCard' });
        toast('请在报表页完成 3 条复核');
      });
    }
    var fab = $('#estopFab');
    if (fab) {
      fab.addEventListener('click', function () {
        if (ui.mode === 'estop') { toast('已急停，请到控制页长按复位'); return; }
        showModal({
          title: '确认急停？',
          body: '急停将立即锁停车辆并断开控制，需长按 2 秒复位。',
          confirmText: '确认急停',
          danger: true,
          onConfirm: function () { executeEstop(); }
        });
      });
    }
  }

  /* ============================================================
   * 图传页交互
   * ============================================================ */
  function wireVideo() {
    $$('#camActions .cam-act').forEach(function (btn) {
      btn.addEventListener('click', function () {
        toast(btn.getAttribute('data-act') + '：演示版');
      });
    });
    $$('#presetRow .preset').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var pitch = Number(btn.getAttribute('data-pitch'));
        V.ptz = V.ptz || {};
        V.ptz.pitch = pitch;
        renderVideo();
        toast('云台已切至' + btn.textContent.replace(' ', '') + '（演示版）');
      });
    });
    var img = $('#camImg');
    var frame = $('#videoFrame');
    if (img && frame) {
      img.addEventListener('error', function () { frame.classList.add('img-failed'); });
      // file:// 下个别浏览器会在缓存命中时不触发 error，再兜底检查一次
      if (img.complete && img.naturalWidth === 0) frame.classList.add('img-failed');
    }
  }

  /* ============================================================
   * 报表页交互
   * ============================================================ */
  function wireReport() {
    var list = $('#reviewList');
    if (list) {
      list.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.mini-btn') : null;
        if (!btn) return;
        var item = btn.closest('.review-item');
        if (!item || item.getAttribute('data-done') === '1') return;
        var code = item.getAttribute('data-code');
        var act = btn.getAttribute('data-act');
        var actions = $('.ri-actions', item);
        if (act === 'confirm') {
          item.setAttribute('data-done', '1');
          if (actions) actions.innerHTML = '<span class="done-tag confirmed">已确认</span>';
          wsSend({ type: 'review', code: code, action: 'confirm' });
          toast('已确认：' + code);
        } else {
          item.setAttribute('data-done', '1');
          if (actions) actions.innerHTML = '<span class="done-tag rejudged">已改判</span>';
          wsSend({ type: 'review', code: code, action: 'rejudge' });
          toast('改判入口：演示版（' + code + '）');
        }
        updateReviewNote();
      });
    }
    var csv = $('#exportCsv');
    if (csv) csv.addEventListener('click', function () { toast('演示版已生成 CSV'); });
    var pdf = $('#exportPdf');
    if (pdf) pdf.addEventListener('click', function () { toast('演示版已生成 PDF 报表'); });
    var pick = $('#batchPick');
    if (pick) {
      pick.addEventListener('click', function () {
        toast('演示版仅包含批次 B-20261104-01');
      });
    }
  }

  /* ============================================================
   * 图传时间戳
   * ============================================================ */
  var tsState = { h: 9, m: 24, s: 31, timer: null };

  function parseTs(str) {
    var m = String(str || '').match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    return { h: Number(m[4]), m: Number(m[5]), s: Number(m[6]) };
  }

  function syncTsFromVideo() {
    var p = parseTs(V.ts);
    if (p) { tsState.h = p.h; tsState.m = p.m; tsState.s = p.s; }
  }

  function startClock() {
    if (FREEZE) {
      var el = $('#camTs');
      if (el) el.textContent = FIXED_TS;
      return;
    }
    clearInterval(tsState.timer);
    tsState.timer = setInterval(function () {
      tsState.s += 1;
      if (tsState.s >= 60) { tsState.s = 0; tsState.m += 1; }
      if (tsState.m >= 60) { tsState.m = 0; tsState.h = (tsState.h + 1) % 24; }
      var el = $('#camTs');
      if (el) el.textContent = '2026-11-04 ' + pad2(tsState.h) + ':' + pad2(tsState.m) + ':' + pad2(tsState.s);
    }, 1000);
  }

  /* ============================================================
   * 启动
   * ============================================================ */
  function init() {
    if (FREEZE) document.documentElement.classList.add('freeze');

    buildMapGeometry();
    wireModal();
    wireMonitor();
    wireControl();
    wireVideo();
    wireReport();
    wireJoystick();
    $$('.tab-item').forEach(function (t) {
      t.addEventListener('click', function () { switchTab(t.getAttribute('data-tab')); });
    });

    renderMonitor();
    renderControl();
    renderVideo();
    renderReport();
    switchTab(SHOT, { force: true });

    // 截图冻结：控制页固定为远程演示态（摇杆位置与 v/w 固定，不弹确认框）
    if (FREEZE && SHOT === 'control') {
      ui.mode = 'remote';
      ui.speed = 0.30;
      updateModeUI();
      renderControl();
      setJoyKnob(PRESET_DX, PRESET_DY);
      var ro = $('#joyReadout');
      if (ro) ro.innerHTML = 'v=0.30 m/s&nbsp;&nbsp;w=-0.20 rad/s';
    }

    syncTsFromVideo();
    startClock();

    // 有服务时拉真实数据；失败静默用 mock（file:// 与 freeze 均不发起请求，保证截图稳定）
    if (HAS_HTTP && !FREEZE) {
      fetchState();
      fetchReport(false);
      fetchVideo();
      // 图传页轮询：K230 实拍时同步 fps/码率/检测框（无服务时静默失败）
      setInterval(fetchVideo, 1200);
    }

    // 通知截图脚本：页面已就绪
    markReady();
  }

  function markReady() {
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      window.__READY__ = true;
      document.body.setAttribute('data-ready', '1');
    }
    var img = $('#camImg');
    if (img && !img.complete) {
      img.addEventListener('load', finish);
      img.addEventListener('error', finish);
      setTimeout(finish, 500);
      requestAnimationFrame(function () { requestAnimationFrame(finish); setTimeout(finish, 120); });
      setTimeout(finish, 800);
    } else {
      requestAnimationFrame(function () { requestAnimationFrame(finish); });
      setTimeout(finish, 200);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
