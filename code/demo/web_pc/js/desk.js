/* ============================================================
   株迹可循｜棚务台（PC）
   读取本地服务 /api/* 与 /ws；服务不可用时退到内置演示数据，
   保证双击 HTML 也能看到完整界面。?freeze=1 用于截图。
   ============================================================ */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var FREEZE = params.get('freeze') === '1';
  var FORCE_MOCK = params.get('mock') === '1';
  var HAS_HTTP = /^https?:$/.test(location.protocol);

  window.__CONSOLE_ERRORS__ = window.__CONSOLE_ERRORS__ || [];
  window.addEventListener('error', function (ev) {
    window.__CONSOLE_ERRORS__.push(String(ev.message || 'error'));
  });
  window.addEventListener('unhandledrejection', function (ev) {
    window.__CONSOLE_ERRORS__.push('unhandled: ' + String(ev.reason || ''));
  });

  var VIEWS = {
    overview: { title: '总览', sub: '1号棚 / 东区 / B-20261104-01' },
    tasks: { title: '任务', sub: '本班次任务与下发记录' },
    video: { title: '图传', sub: '低码率监看 / 按需开启' },
    review: { title: '复核', sub: '低置信记录人工确认' },
    report: { title: '报表', sub: '批次归档 / 导出' },
    device: { title: '设备', sub: '车端遥测与安全联锁' }
  };

  var MOCK_EVENTS = [
    { level: 'info', text: '本地演示巡检已启动：第 7/20 停靠位', time: '09:24:05' },
    { level: 'info', text: '4G 预留链路未启用，当前走 WiFi', time: '09:24:12' },
    { level: 'warn', text: 'B2 台 2 位叶片遮挡，已生成补拍任务', time: '09:24:20' },
    { level: 'info', text: '到达 B2 台 2 位，开始停靠拍照', time: '09:24:27' }
  ];

  var MOCK_STATE = {
    ts: 1793,
    device: { name: '株迹可循-01', fw: 'v1.0.0', link: 'wifi', rssi: -52, latency_ms: 28, telemetry: 'sim' },
    robot: {
      mode: 'patrol', mode_text: '巡检中', battery: 78, voltage: 11.6, current: 0.82,
      temp: 32, speed: 0.5, x: 3.24, y: 1.85, heading: 90,
      stop_index: 7, stop_total: 20, bed: 'B2', plot: 'B2-03',
      progress: 0.66, plants_done: 42, plants_total: 64, distance_m: 18.6, detected: 6
    },
    batch: { id: 'B-20261104-01', greenhouse: '1号棚', start: '2026-11-04T09:20:00+08:00', end: null, status: 'running' },
    recent: [
      { code: '1棚-3行-B2台-2位-1株', disease: '叶斑病', confidence: 0.91, state: '新发', time: '09:24', suggest: '分区标记 + 加密复查' },
      { code: '1棚-2行-B2台-2位-1株', disease: '叶斑病', confidence: 0.79, state: '加重', time: '09:23', suggest: '加喷一次，24h 后复查' },
      { code: '1棚-2行-B1台-2位-1株', disease: '叶斑病', confidence: 0.77, state: '持续', time: '09:25', suggest: '保持通风，降湿处理' }
    ],
    review: [
      { code: '1棚-1行-B2台-2位-1株', disease: '叶斑病', confidence: 0.69, state: '待复核' },
      { code: '1棚-1行-A2台-1位-2株', disease: '白粉病', confidence: 0.64, state: '待复核' },
      { code: '1棚-2行-A1台-1位-1株', disease: '叶斑病', confidence: 0.63, state: '待复核' }
    ]
  };

  var MOCK_RECORDS = [
    { code: '1棚-1行-A1台-1位-1株', disease: '叶斑病', confidence: 0.88, state: '新发', advice: '分区标记 + 加密复查', time: '09:21', review_state: '免复核' },
    { code: '1棚-1行-B2台-2位-1株', disease: '叶斑病', confidence: 0.69, state: '持续', advice: '低置信，待现场复核', time: '09:21', review_state: '待复核' },
    { code: '1棚-1行-A2台-1位-2株', disease: '白粉病', confidence: 0.64, state: '持续', advice: '低置信，待现场复核', time: '09:22', review_state: '待复核' },
    { code: '1棚-2行-A1台-1位-1株', disease: '叶斑病', confidence: 0.63, state: '疑似误报', advice: '低置信，待现场复核', time: '09:23', review_state: '待复核' },
    { code: '1棚-2行-B2台-2位-1株', disease: '叶斑病', confidence: 0.79, state: '加重', advice: '加喷一次，24h 后复查', time: '09:23', review_state: '免复核' },
    { code: '1棚-3行-B2台-2位-1株', disease: '叶斑病', confidence: 0.91, state: '新发', advice: '分区标记 + 加密复查', time: '09:24', review_state: '免复核' }
  ];

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
      { key: 'new', label: '新发', count: 2, color: '#C25A45' },
      { key: 'ongoing', label: '持续', count: 3, color: '#31597A' },
      { key: 'worse', label: '加重', count: 1, color: '#C49A3A' },
      { key: 'better', label: '好转', count: 1, color: '#5E8A6B' },
      { key: 'handled', label: '已处理', count: 1, color: '#8A8F86' },
      { key: 'false', label: '疑似误报', count: 1, color: '#75633A' }
    ],
    records: [
      { code: '1棚-3行-B2台-2位-1株', disease: '叶斑病', state: '新发', confidence: 0.91, advice: '分区标记 + 加密复查' },
      { code: '1棚-2行-B2台-2位-1株', disease: '叶斑病', state: '加重', confidence: 0.79, advice: '加喷一次，24h 后复查' },
      { code: '1棚-3行-B1台-1位-2株', disease: '叶斑病', state: '已处理', confidence: 0.86, advice: '已处理，记录归档' }
    ],
    footer: '判定规则/阈值/模型版本随批次归档 / 批次 B-20261104-01'
  };

  var MOCK_VIDEO = {
    enabled: false,
    camera: 'K230 · 顶视', width: 1280, height: 720, bitrate: '1.2 Mbps', fps: 15,
    ptz: { pan: 0, pitch: 78 }, ts: '2026-11-04 09:24:31',
    boxes: [
      { x: 0.22, y: 0.30, w: 0.26, h: 0.34, label: '叶斑病', confidence: 0.87, status: 'high' },
      { x: 0.58, y: 0.52, w: 0.18, h: 0.22, label: '叶斑病', confidence: 0.63, status: 'review' }
    ],
    source: { mode: 'sim', online: false }
  };

  var MOCK_CAMERA = {
    source: { mode: 'sim', online: false, stream_url: null, width: 1280, height: 720, fps: 0, kbps: 0, last_frame_ts: null, frames_total: 0, device_id: null },
    clock: '2026-11-04 09:24:31', batch: 'B-20261104-01', token_required: false, hint: '演示画面（未接入 K230）'
  };

  var app = {
    state: null,
    records: [],
    report: null,
    video: null,
    camera: null,
    events: [],
    selected: null,
    view: 'overview',
    queueFilter: 'review',
    ws: null,
    wsReady: false,
    wsSeq: 0,
    wsPending: {},
    clockBase: null,
    clockAt: 0,
    simFrame: 41,
    frameTimer: null,
    freeze: FREEZE,
    usingMock: false,
    timers: []
  };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function parseClock(value) {
    if (!value) return null;
    var m = String(value).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return isNaN(d.getTime()) ? null : d;
  }
  function clockText(date) {
    return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
  }

  /* ── 网络 ─────────────────────────────────────────────── */
  function api(path) {
    if (!HAS_HTTP) return Promise.reject(new Error('not-http'));
    return fetch(path, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(r.status + ' ' + path);
      return r.json();
    });
  }

  function loadData() {
    if (FORCE_MOCK) {
      app.usingMock = true;
      app.state = MOCK_STATE;
      app.records = MOCK_RECORDS.slice();
      app.report = MOCK_REPORT;
      app.video = MOCK_VIDEO;
      app.camera = MOCK_CAMERA;
      setClock(MOCK_CAMERA.clock);
      seedEvents();
      selectDefault();
      renderAll();
      return Promise.resolve(true);
    }
    var tasks = [];
    if (HAS_HTTP) {
      tasks = [
        api('/api/state').catch(function () { return null; }),
        api('/api/records').catch(function () { return null; }),
        api('/api/report').catch(function () { return null; }),
        api('/api/video/info').catch(function () { return null; }),
        api('/api/camera/status').catch(function () { return null; })
      ];
    }
    return Promise.all(tasks).then(function (res) {
      var ok = res.filter(Boolean).length;
      app.usingMock = ok === 0;
      app.state = (res[0] && !res[0].error) ? res[0] : MOCK_STATE;
      app.records = (res[1] && res[1].records) ? res[1].records : MOCK_RECORDS.slice();
      app.report = res[2] || MOCK_REPORT;
      app.video = res[3] || MOCK_VIDEO;
      app.camera = res[4] || MOCK_CAMERA;
      if (!app.state || !app.state.robot) app.state = MOCK_STATE;
      if (app.usingMock && !app.state.device) app.state = MOCK_STATE;
      setClock(app.camera.clock || (app.report.batch && app.report.batch.time));
      seedEvents();
      selectDefault();
      renderAll();
      return app.usingMock;
    });
  }

  function setClock(value) {
    var d = parseClock(value);
    if (!d) return;
    app.clockBase = d;
    app.clockAt = Date.now();
    renderClock();
  }
  function tickClock() {
    if (!app.clockBase) return;
    var d = new Date(app.clockBase.getTime() + (Date.now() - app.clockAt));
    renderClock(d);
  }
  function renderClock(d) {
    if (!d) {
      if (!app.clockBase) return;
      d = new Date(app.clockBase.getTime() + (Date.now() - app.clockAt));
    }
    var text = clockText(d);
    var clock = $('#clockText');
    if (clock) clock.textContent = text;
    var camTs = $('#camTs');
    if (camTs) camTs.textContent = text;
    var videoClock = $('#videoClock');
    if (videoClock) videoClock.textContent = text;
  }

  /* ── WebSocket ────────────────────────────────────────── */
  function connectWS() {
    if (!HAS_HTTP || FREEZE || !('WebSocket' in window)) { setWsState(false); return; }
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var ws;
    try { ws = new WebSocket(proto + '//' + location.host + '/ws'); } catch (e) { setWsState(false); return; }
    app.ws = ws;
    ws.onopen = function () {
      app.wsReady = true;
      setWsState(true);
      ws.send(JSON.stringify({ type: 'hello', client: 'pc' }));
    };
    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (!msg || !msg.type) return;
      if (msg.type === 'state') {
        app.state = msg.data && msg.data.robot ? msg.data : msg;
        renderAll();
      } else if (msg.type === 'event') {
        app.events.unshift({ level: msg.level || 'info', text: msg.text || '', time: clockText(new Date(app.clockBase ? app.clockBase.getTime() + (Date.now() - app.clockAt) : new Date())) });
        app.events = app.events.slice(0, 30);
        renderEvents();
      } else if (msg.type === 'ack') {
        var pending = app.wsPending[msg.seq];
        if (pending) { delete app.wsPending[msg.seq]; pending(msg); }
      } else if (msg.type === 'report_ready') {
        refreshReport();
      }
    };
    ws.onclose = function () {
      app.wsReady = false;
      setWsState(false);
      if (!FREEZE) setTimeout(connectWS, 2500);
    };
    ws.onerror = function () { setWsState(false); };
  }
  function setWsState(on) {
    var text = on ? 'WS 已连接' : 'WS 未连接';
    ['#wsState', '#wsState2', '#statusWs'].forEach(function (id) {
      var el = $(id);
      if (el) { el.textContent = text; el.classList.toggle('is-on', on); el.classList.toggle('is-off', !on); }
    });
    var dot = $('#railDot');
    if (dot) dot.classList.toggle('is-off', !on);
  }

  function setSnapshotState() {
    ['#wsState', '#wsState2'].forEach(function (id) {
      var el = $(id);
      if (el) { el.textContent = '快照'; el.classList.add('is-on'); el.classList.remove('is-off'); }
    });
    var status = $('#statusWs');
    if (status) { status.textContent = '快照模式'; status.classList.add('is-on'); status.classList.remove('is-off'); }
    var dot = $('#railDot');
    if (dot) dot.classList.remove('is-off');
  }

  function seedEvents() {
    var base = app.clockBase || new Date();
    function back(sec) { return clockText(new Date(base.getTime() - sec * 1000)); }
    var stop = (app.state && app.state.robot && app.state.robot.stop_index) || 7;
    app.events = [
      { level: 'info', text: '本地演示巡检已启动：第 ' + stop + '/20 停靠位', time: back(26) },
      { level: 'info', text: '4G 预留链路未启用，当前走 WiFi', time: back(19) },
      { level: 'warn', text: 'B2 台 2 位叶片遮挡，已生成补拍任务', time: back(11) },
      { level: 'info', text: '到达 B2 台 2 位，开始停靠拍照', time: back(4) }
    ];
  }
  function wsSend(obj, timeout) {
    if (!app.ws || !app.wsReady) return Promise.resolve(null);
    var seq = ++app.wsSeq;
    obj.seq = seq;
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        delete app.wsPending[seq];
        resolve(null);
      }, timeout || 2500);
      app.wsPending[seq] = function (ack) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(ack);
      };
      try { app.ws.send(JSON.stringify(obj)); } catch (e) { clearTimeout(timer); resolve(null); }
    });
  }

  /* ── 数据刷新 ─────────────────────────────────────────── */
  function refreshState() { api('/api/state').then(function (d) { if (d && d.robot) { app.state = d; renderAll(); } }).catch(function () {}); }
  function refreshRecords() {
    api('/api/records').then(function (d) {
      if (d && d.records) {
        app.records = d.records;
        renderMap();
        renderQueue();
        renderInspector();
        renderReview();
        renderReportTable();
      }
    }).catch(function () {});
  }
  function refreshReport() { api('/api/report').then(function (d) { if (d) { app.report = d; renderReport(); } }).catch(function () {}); }
  function refreshVideo() {
    api('/api/video/info').then(function (d) { if (d) { app.video = d; renderCamera(); renderVideoView(); } }).catch(function () {});
  }
  function refreshCamera() {
    api('/api/camera/status').then(function (d) {
      if (!d) return;
      var prevMode = app.camera && app.camera.source ? app.camera.source.mode : null;
      app.camera = d;
      if (d.clock) setClock(d.clock);
      renderCamera();
      renderChrome();
      if (prevMode && d.source && prevMode !== d.source.mode) renderVideoView();
    }).catch(function () {});
  }
  function refreshAll() { refreshState(); refreshRecords(); refreshReport(); refreshVideo(); refreshCamera(); }

  /* ── 渲染：外壳 ───────────────────────────────────────── */
  function renderAll() {
    renderChrome();
    renderMap();
    renderQueue();
    renderInspector();
    renderCamera();
    renderVideoView();
    renderReview();
    renderReport();
    renderDevice();
    renderEvents();
  }

  function renderChrome() {
    var s = app.state || MOCK_STATE;
    var r = s.robot || MOCK_STATE.robot;
    var d = s.device || MOCK_STATE.device;
    var mode = r.mode_text || (r.mode === 'patrol' ? '巡检中' : r.mode === 'remote' ? '远程模式' : r.mode === 'estop' ? '已急停' : '待命');

    $('#kpiPlants').textContent = r.plants_done == null ? '42' : r.plants_done;
    $('#kpiDetected').textContent = r.detected == null ? '6' : r.detected;
    var reviewCount = (app.records || []).filter(function (x) { return x.review_state === '待复核'; }).length;
    $('#kpiReview').textContent = reviewCount;
    $('#kpiDistance').textContent = r.distance_m == null ? '18.6' : r.distance_m;
    $('#kpiBattery').textContent = r.battery == null ? '78' : r.battery;
    $('#kpiRssi').textContent = d.rssi == null ? '-52' : d.rssi;
    $('#kpiLatency').textContent = (d.latency_ms == null ? 28 : d.latency_ms) + ' ms / WiFi';
    var battery = r.battery == null ? 78 : r.battery;
    $('#kpiBatteryNote').textContent = battery >= 70 ? '约可再巡 2 棚' : battery >= 40 ? '约可再巡 1 棚' : '低于 40%，建议回充';

    $('#linkText').textContent = (d.rssi == null ? -52 : d.rssi) + ' dBm / ' + (d.latency_ms == null ? 28 : d.latency_ms) + ' ms';
    var modeEl = $('#modeText');
    modeEl.textContent = mode;
    modeEl.classList.toggle('is-alert', r.mode === 'estop');
    var resetBtn = $('#btnReset');
    if (resetBtn) resetBtn.disabled = r.mode !== 'estop';
    var conn = $('.conn');
    if (conn) conn.classList.toggle('is-off', freeHttps() && !app.wsReady);
    $('#overviewSub').textContent = '第 ' + (r.stop_index || 0) + '/' + (r.stop_total || 20) + ' 停靠位 / ' +
      (r.bed || 'B2') + ' 台 ' + (r.plot || 'B2-03') + ' / 已巡 ' +
      (r.plants_done == null ? 42 : r.plants_done) + '/' + (r.plants_total || 64) + ' 株';
    $('#sidePlants').textContent = r.plants_done == null ? 42 : r.plants_done;
    $('#sideStops').textContent = (r.stop_index || 0) + ' / ' + (r.stop_total || 20) + ' 站';
    var pct = clamp((r.plants_done || 0) / (r.plants_total || 64), 0, 1) * 100;
    $('#sideBar').style.width = pct.toFixed(1) + '%';
    $('#sideReview').textContent = reviewCount;
    $('#statusBatch').textContent = '批次 ' + ((s.batch && s.batch.id) || 'B-20261104-01') + ' / 规则 v2.4 / 模型 v0.8.3';
    $('#queueCount').textContent = reviewCount + (app.queueFilter === 'review' ? '' : '');
    var qCount = $('#queueCount');
    if (qCount && app.queueFilter === 'all') qCount.textContent = (app.records || []).length;
    document.title = '株迹可循｜棚务台｜' + (VIEWS[app.view] ? VIEWS[app.view].title : '总览');
    if (document.body && !app.freeze) { /* placeholder */ }
  }

  function freeHttps() { return HAS_HTTP; }

  function renderEvents() {
    var list = $('#eventList');
    if (!list) return;
    var events = app.events.slice(0, 10).sort(function (a, b) {
      return String(b.time || '').localeCompare(String(a.time || ''));
    });
    if (!events.length) {
      list.innerHTML = '<li><time>--:--</time><span>暂无事件</span></li>';
      return;
    }
    list.innerHTML = events.map(function (e) {
      var cls = e.level === 'warn' ? 'ev-warn' : e.level === 'error' ? 'ev-error' : '';
      return '<li><time>' + esc(e.time || '') + '</time><span class="' + cls + '">' + esc(e.text) + '</span></li>';
    }).join('');
  }

  /* ── 地图 ─────────────────────────────────────────────── */
  var MAP = { left: 96, top: 82, width: 636, height: 392, bedH: 48, bedGap: 98 };
  var TAI_POS = { A1: 0, B2: 1, A2: 2, B1: 3 };
  var TAI_SEQ = ['A1', 'B2', 'A2', 'B1', '回路'];

  function bedY(row) { return MAP.top + (row - 1) * MAP.bedGap + MAP.bedH / 2; }
  function stopX(pos) { return 120 + pos * 148; }
  function parseCode(code) {
    var m = String(code || '').match(/-(\d)行-([A-Z])(\d)台-(\d)位-(\d)株/);
    if (!m) return null;
    var tai = m[2] + m[3];
    return { row: +m[1], tai: tai, pos: TAI_POS[tai] == null ? 4 : TAI_POS[tai], plant: +m[5] };
  }
  function codePoint(code) {
    var p = parseCode(code);
    if (!p) return null;
    return { x: stopX(p.pos), y: bedY(p.row), plot: p.tai + '-' + pad(p.pos + 1) };
  }
  function stateColor(record) {
    if (!record) return '#8A9486';
    if (record.review_state === '待复核') return '#B9A05C';
    switch (record.state) {
      case '新发': return '#C25A45';
      case '加重': return '#C49A3A';
      case '持续': return '#557C9C';
      case '好转': return '#5E8A6B';
      case '已处理': return '#7A8478';
      case '疑似误报': return '#81714A';
      default: return '#8A9486';
    }
  }

  function buildMapStatic() {
    var beds = [], stops = [];
    for (var row = 1; row <= 4; row++) {
      var y = MAP.top + (row - 1) * MAP.bedGap;
      beds.push('<g><rect x="' + MAP.left + '" y="' + y + '" width="' + MAP.width + '" height="' + MAP.bedH + '" fill="#1A2A21" stroke="#35513F" stroke-width="1"/>' +
        '<rect x="' + MAP.left + '" y="' + y + '" width="' + MAP.width + '" height="' + MAP.bedH + '" fill="url(#bedHatch)" opacity=".5"/>' +
        '<text x="' + (MAP.left - 14) + '" y="' + (y + 27) + '" text-anchor="end" class="bed-label">' + row + ' 行</text>' +
        '<text x="' + (MAP.left + 8) + '" y="' + (y + 13) + '" class="bed-label" opacity=".6">' + (row % 2 ? '东 → 西' : '西 → 东') + '</text></g>');
      for (var pos = 0; pos < 5; pos++) {
        var cx = stopX(pos), cy = y + MAP.bedH / 2;
        var windowStop = pos === 4;
        stops.push('<g class="stop-group" data-stop="' + row + '-' + pos + '">' +
          '<circle class="stop' + (windowStop ? ' is-window' : '') + '" cx="' + cx + '" cy="' + cy + '" r="' + (windowStop ? 5 : 3.8) + '"><title>' + row + ' 行 · ' + (windowStop ? '掉头位' : TAI_SEQ[pos] + ' 台') + '</title></circle>' +
          '<text x="' + cx + '" y="' + (cy - 10) + '" text-anchor="middle" class="bed-label" opacity=".7">' + (windowStop ? '回' : TAI_SEQ[pos]) + '</text></g>');
      }
    }
    var route = 'M' + stopX(0) + ' ' + bedY(1) + ' H' + stopX(4) +
      ' V' + bedY(2) + ' H' + stopX(0) +
      ' V' + bedY(3) + ' H' + stopX(4) +
      ' V' + bedY(4) + ' H' + stopX(0);
    var plants = [];
    for (var pr = 1; pr <= 4; pr++) {
      var py = MAP.top + (pr - 1) * MAP.bedGap + 7;
      for (var pi = 0; pi < 16; pi++) {
        var px = MAP.left + 24 + pi * ((MAP.width - 48) / 15);
        plants.push('<path d="M' + px.toFixed(1) + ' ' + py + 'v6" stroke="#58725F" stroke-width="1" opacity=".5"/>');
      }
    }
    $('#mapBeds').innerHTML = beds.join('');
    $('#mapPlants').innerHTML = plants.join('');
    $('#mapStops').innerHTML = stops.join('');
    $('#routePath').setAttribute('d', route);
  }

  function renderMap() {
    var s = app.state || MOCK_STATE;
    var r = s.robot || MOCK_STATE.robot;
    var pins = (app.records || []).map(function (rec) {
      var p = codePoint(rec.code);
      if (!p) return '';
      var color = stateColor(rec);
      var sel = app.selected === rec.code ? ' is-selected' : '';
      return '<circle class="pin' + sel + '" data-code="' + esc(rec.code) + '" cx="' + p.x + '" cy="' + p.y + '" r="6" fill="' + color + '">' +
        '<title>' + esc(rec.code + ' · ' + rec.disease + ' ' + rec.confidence + ' · ' + rec.state) + '</title></circle>';
    });
    $('#mapPins').innerHTML = pins.join('');
    var rx = MAP.left + clamp((r.x || 0) / 7.3, 0, 1) * MAP.width;
    var ry = 44 + clamp((r.y || 0) / 8.4, 0, 1) * 432;
    var robot = $('#robot');
    robot.setAttribute('transform', 'translate(' + rx.toFixed(1) + ',' + ry.toFixed(1) + ') rotate(' + (r.heading || 0) + ')');
    var sel = (app.records || []).filter(function (x) { return x.code === app.selected; })[0];
    var selP = sel ? codePoint(sel.code) : null;
    var ring = $('#selRing');
    if (selP) {
      ring.setAttribute('cx', selP.x);
      ring.setAttribute('cy', selP.y);
      ring.setAttribute('opacity', '1');
    } else {
      ring.setAttribute('opacity', '0');
    }
    $('#mapStatus').textContent = '第 ' + (r.stop_index || 0) + '/' + (r.stop_total || 20) + ' 停靠位 / ' + (r.bed || '') + ' 台 ' + (r.plot || '');
    $('#mapCoords').textContent = 'x ' + (r.x || 0).toFixed(2) + ' / y ' + (r.y || 0).toFixed(2) + ' / 航向 ' + Math.round(r.heading || 0) + '°';
  }

  /* ── 异常队列 ─────────────────────────────────────────── */
  function renderQueue() {
    var body = $('#queueBody');
    if (!body) return;
    var rows = (app.records || []).slice();
    if (app.queueFilter === 'review') {
      rows = rows.filter(function (x) { return x.review_state === '待复核'; });
    }
    rows.sort(function (a, b) { return (b.confidence || 0) - (a.confidence || 0); });
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" class="muted">本批次没有待复核记录</td></tr>';
      return;
    }
    body.innerHTML = rows.slice(0, 8).map(function (r) {
      var p = parseCode(r.code);
      var plot = p ? p.tai + '-' + pad(p.pos + 1) : '';
      var sel = app.selected === r.code ? ' is-selected' : '';
      var review = r.review_state || '免复核';
      return '<tr class="' + sel + '" data-code="' + esc(r.code) + '">' +
        '<td class="code">' + esc(r.code) + '</td>' +
        '<td>' + esc(r.disease) + '</td>' +
        '<td class="num">' + Number(r.confidence || 0).toFixed(2) + '</td>' +
        '<td><span class="state-' + stateKey(r.state) + '">' + esc(r.state) + '</span></td>' +
        '<td class="muted">' + esc(r.time || '') + '</td>' +
        '<td>' + (review === '待复核' ? '<span class="tag tag-wait">待复核</span>' : '<span class="muted">已处理</span>') + '</td>' +
        '<td><button class="text-btn row-action" data-select="' + esc(r.code) + '">' + (review === '待复核' ? '复核' : '查看') + '</button></td>' +
        '</tr>';
    }).join('');
  }
  function stateKey(state) {
    return ({ '新发': 'new', '持续': 'ongoing', '加重': 'worse', '好转': 'better', '已处理': 'handled', '疑似误报': 'false' })[state] || 'ongoing';
  }

  /* ── 株位档案 ─────────────────────────────────────────── */
  function selectDefault() {
    if (app.selected) return;
    var found = (app.records || []).filter(function (r) { return r.state === '新发' && r.confidence >= 0.9; })[0] ||
      (app.records || [])[0];
    app.selected = found ? found.code : null;
  }
  function selectRecord(code) {
    app.selected = code;
    renderMap();
    renderQueue();
    renderInspector();
  }
  function renderInspector() {
    var box = $('#dossierBody');
    if (!box) return;
    var rec = (app.records || []).filter(function (r) { return r.code === app.selected; })[0];
    if (!rec) {
      box.innerHTML = '<div class="dossier-empty"><div class="empty-mark"></div><p>选一株看档案</p><span>地图上的色点、右下角异常队列都可以点。</span></div>';
      $('#dossierHint').textContent = '点地图标记或队列行';
      return;
    }
    var p = parseCode(rec.code);
    var plot = p ? p.tai + '-' + pad(p.pos + 1) : '';
    var review = rec.review_state || '免复核';
    var canReview = review === '待复核';
    $('#dossierHint').textContent = canReview ? '待人工复核' : '已归档';
    box.innerHTML =
      '<div class="dossier-head"><div>' +
      '<div class="dossier-code">' + esc(rec.code) + '</div>' +
      '<div class="dossier-main"><span class="dossier-conf">' + Number(rec.confidence || 0).toFixed(2) + '</span>' +
      '<span class="dossier-conf-note">置信度 / ' + esc(rec.time || '') + '</span>' +
      '<span class="dossier-state state-' + stateKey(rec.state) + '">' + esc(rec.state) + '</span>' +
      '</div></div></div>' +
      '<p class="dossier-advice">' + esc(rec.disease) + ' / ' + esc(rec.advice || '') + '</p>' +
      '<div class="dossier-actions">' +
      '<button class="btn" data-review="confirm"' + (canReview ? '' : ' disabled') + '>确认</button>' +
      '<button class="btn" data-review="rejudge"' + (canReview ? '' : ' disabled') + '>改判</button>' +
      '<button class="btn" data-assign="' + esc(rec.code) + '">指派复核</button>' +
      '</div>' +
      '<div class="history-line">上次 10-31 / 持续 / 0.73' + (canReview ? '' : ' / 已归档') + '</div>';
  }

  function sendReview(action) {
    var rec = (app.records || []).filter(function (r) { return r.code === app.selected; })[0];
    if (!rec) return;
    if (!app.ws || !app.wsReady) { toast('未连接本地服务，复核未提交', 'alert'); return; }
    wsSend({ type: 'review', code: rec.code, action: action }).then(function (ack) {
      if (ack && ack.ok) {
        toast(action === 'confirm' ? '已确认：' + rec.code : '已改判：' + rec.code);
        setTimeout(function () { refreshRecords(); refreshState(); refreshReport(); }, 120);
      } else {
        toast('复核未通过：' + ((ack && ack.error) || '服务未响应'), 'alert');
      }
    });
  }

  /* ── 图传 ─────────────────────────────────────────────── */
  function isRealCamera() {
    var src = (app.camera && app.camera.source) || {};
    return !!src.online && (src.mode === 'push' || src.mode === 'rtsp' || src.mode === 'mjpeg');
  }
  function cameraImageURL() {
    var src = (app.camera && app.camera.source) || {};
    if (isRealCamera()) {
      if (src.mode === 'mjpeg' && src.stream_url) return src.stream_url;
      return '/api/camera/stream.mjpg';
    }
    return '../assets/cam_frames/frame_' + String(app.simFrame).padStart(3, '0') + '.jpg';
  }
  function renderCamera() {
    var img = $('#camImg');
    var src = (app.camera && app.camera.source) || {};
    var real = isRealCamera();
    if (img) {
      var url = cameraImageURL();
      if (img.getAttribute('data-src') !== url) {
        img.setAttribute('data-src', url);
        img.src = url;
      }
    }
    var source = $('#camSource');
    if (source) {
      source.textContent = real ? (src.mode === 'mjpeg' ? 'K230' : src.mode === 'rtsp' ? 'RTSP' : 'K230') : (app.freeze ? 'SIM' : 'SIM');
      source.classList.toggle('is-live', real);
    }
    $('#camHint').textContent = real ? '实拍 / 低码率' : '演示画面';
    $('#camLive').textContent = real ? '实拍' : '演示';
    $('#camRes').textContent = (src.width || 1280) + ' × ' + (src.height || 720);
    $('#camRate').textContent = real
      ? ((src.fps || 0) + ' fps / ' + Math.round(src.kbps || 0) + ' kbps')
      : '演示帧 / 本地';
    $('#camPtz').textContent = '俯仰 ' + ((app.video.ptz && app.video.ptz.pitch) || 78) + '°';
    renderBoxes($('#bboxLayer'), app.video.boxes || []);
  }
  function renderBoxes(layer, boxes) {
    if (!layer) return;
    var list = (boxes || []).slice(0, 4);
    layer.innerHTML = list.map(function (b) {
      var x = clamp(Number(b.x || 0), 0, 1) * 100;
      var y = clamp(Number(b.y || 0), 0, 1) * 100;
      var w = clamp(Number(b.w || 0), 0, 1) * 100;
      var h = clamp(Number(b.h || 0), 0, 1) * 100;
      var cls = b.status === 'review' ? ' is-review' : '';
      return '<div class="bbox' + cls + '" style="left:' + x + '%;top:' + y + '%;width:' + w + '%;height:' + h + '%">' +
        '<span>' + esc(b.label || '病害') + ' ' + Number(b.confidence || 0).toFixed(2) + '</span></div>';
    }).join('');
  }
  function cycleSimFrame() {
    if (app.freeze || isRealCamera() || document.hidden) return;
    app.simFrame += 1;
    if (app.simFrame > 60) app.simFrame = 1;
    var img = $('#camImg');
    var url = cameraImageURL();
    if (img) { img.setAttribute('data-src', url); img.src = url; }
    var videoImg = $('#videoImg');
    if (videoImg) videoImg.src = url;
  }

  function renderVideoView() {
    var img = $('#videoImg');
    var src = (app.camera && app.camera.source) || {};
    var real = isRealCamera();
    if (img && !real && !app.freeze) img.src = cameraImageURL();
    if (img && real) img.src = cameraImageURL();
    if (img && app.freeze && !real) img.src = '../assets/cam_frames/frame_041.jpg';
    $('#videoSourceLine').textContent = '源：' + (real ? (src.mode === 'mjpeg' ? 'K230 直连' : 'K230 实拍') : '本地演示画面');
    $('#videoLive').textContent = real ? '实拍' : '待机';
    $('#videoMeta').textContent = real
      ? ((src.mode === 'mjpeg' ? 'K230 MJPEG' : 'K230') + ' / ' + (src.width || 0) + '×' + (src.height || 0) + ' / ' + (src.fps || 0) + ' fps / ' + Math.round(src.kbps || 0) + ' kbps')
      : 'SIM / 1280×720 / 演示帧';
    $('#videoPtz').textContent = '云台 pan 0° / pitch ' + ((app.video.ptz && app.video.ptz.pitch) || 78) + '°';
    renderBoxes($('#videoBboxes'), app.video.boxes || []);
    var det = app.video.boxes || [];
    $('#detCount').textContent = det.length;
    $('#detList').innerHTML = det.length ? det.map(function (b) {
      return '<div class="det-item"><i></i><b>' + esc(b.label || '病害') + '</b><em>' + Number(b.confidence || 0).toFixed(2) + '</em></div>';
    }).join('') : '<div class="det-item"><i></i><span>本帧无检出</span><em>—</em></div>';
    var btn = $('#btnVideoToggle');
    if (btn) btn.textContent = (app.video.enabled || real) ? '关闭监看' : '开启监看';
  }

  /* ── 复核 ─────────────────────────────────────────────── */
  function renderReview() {
    var list = $('#reviewList');
    if (!list) return;
    var reviews = (app.records || []).filter(function (r) { return r.review_state === '待复核'; });
    var done = (app.records || []).filter(function (r) { return r.review_state && r.review_state !== '待复核' && r.review_state !== '免复核'; });
    var progress = $('#reviewProgress');
    if (progress) progress.textContent = reviews.length + ' 条待复核';
    $('#reviewDone').textContent = done.length + ' / ' + (done.length + reviews.length || 3);
    $('#summaryReview').textContent = done.length + ' / ' + (done.length + reviews.length || 3);
    if (!reviews.length) {
      list.innerHTML = '<div class="review-card"><div class="muted">本批次待复核记录已清空。</div></div>';
    } else {
      list.innerHTML = reviews.map(function (r, i) {
        var frame = 8 + i * 11;
        var sel = app.selected === r.code ? ' is-selected' : '';
        return '<div class="review-card' + sel + '" data-code="' + esc(r.code) + '">' +
          '<div class="review-thumb"><img src="../assets/cam_frames/frame_' + String(frame).padStart(3, '0') + '.jpg" alt="复核帧"><span>' + esc(r.time || '') + '</span></div>' +
          '<div class="review-main"><h4>' + esc(r.code) + '</h4>' +
          '<div class="review-meta"><span class="review-conf">' + Number(r.confidence || 0).toFixed(2) + '</span>' +
          '<span class="tag tag-wait">' + esc(r.state) + '</span><span class="muted">' + esc(r.disease) + '</span></div>' +
          '<p>' + esc(r.advice || '') + '</p></div>' +
          '<div class="review-actions">' +
          '<button class="btn btn-xs" data-review="confirm" data-code="' + esc(r.code) + '">确认</button>' +
          '<button class="btn btn-xs" data-review="rejudge" data-code="' + esc(r.code) + '">改判</button>' +
          '<button class="btn btn-xs" data-assign="' + esc(r.code) + '">指派</button>' +
          '</div></div>';
      }).join('');
    }
    var doneList = $('#reviewDoneList');
    if (doneList) {
      doneList.innerHTML = done.length ? done.slice(0, 5).map(function (r) {
        return '<li><span>' + esc(r.code) + '</span><b>' + esc(r.review_state) + '</b></li>';
      }).join('') : '<li class="muted">暂无</li>';
    }
  }

  function reviewByCode(code, action) {
    if (!app.ws || !app.wsReady) { toast('未连接本地服务，复核未提交', 'alert'); return; }
    wsSend({ type: 'review', code: code, action: action }).then(function (ack) {
      if (ack && ack.ok) {
        toast(action === 'confirm' ? '已确认：' + code : '已改判：' + code);
        setTimeout(function () { refreshRecords(); refreshState(); refreshReport(); }, 120);
      } else {
        toast('复核未通过：' + ((ack && ack.error) || '服务未响应'), 'alert');
      }
    });
  }

  /* ── 报表 ─────────────────────────────────────────────── */
  function renderReport() {
    var rep = app.report || MOCK_REPORT;
    var kpis = $('#reportKpis');
    if (kpis) {
      kpis.innerHTML = (rep.kpis || []).map(function (k) {
        return '<div class="kpi"><span class="kpi-label">' + esc(k.label) + '</span>' +
          '<span class="kpi-value"><b>' + esc(k.value) + '</b><i>' + esc(k.unit || '') + '</i></span></div>';
      }).join('');
    }
    var states = $('#stateBars');
    if (states) {
      var max = 1;
      (rep.states || []).forEach(function (s) { max = Math.max(max, s.count || 0); });
      states.innerHTML = (rep.states || []).map(function (s) {
        var w = Math.max(2, ((s.count || 0) / max) * 100);
        return '<div class="state-bar"><span>' + esc(s.label) + '</span><i><b style="width:' + w.toFixed(1) + '%;background:' + esc(s.color) + '"></b></i><em>' + (s.count || 0) + '</em></div>';
      }).join('');
    }
    $('#reportTotal').textContent = (rep.states || []).reduce(function (a, b) { return a + (b.count || 0); }, 0);
    $('#reportSub').textContent = ((rep.batch && rep.batch.id) || 'B-20261104-01') + ' / ' + ((rep.batch && rep.batch.greenhouse) || '1号棚') + ' / ' + ((rep.batch && rep.batch.time) || '09:20—09:26');
    $('#summaryReview').textContent = ((app.records || []).filter(function (r) { return r.review_state && r.review_state !== '待复核' && r.review_state !== '免复核'; }).length) + ' / 3';
    renderReportTable();
    var foot = $('#reportFoot');
    if (foot) foot.textContent = rep.footer || '判定规则、阈值与模型版本随批次归档。';
  }
  function renderReportTable() {
    var body = $('#reportBody');
    if (!body) return;
    var rep = app.report || MOCK_REPORT;
    var recMap = {};
    (app.records || []).forEach(function (r) { recMap[r.code] = r; });
    body.innerHTML = (rep.records || []).map(function (r) {
      var full = recMap[r.code];
      var review = full ? full.review_state : (r.review || '免复核');
      var plot = parseCode(r.code);
      return '<tr><td class="code">' + esc(r.code) + '</td>' +
        '<td>' + esc(r.disease || (full && full.disease) || '—') + '</td>' +
        '<td class="num">' + Number(r.confidence || 0).toFixed(2) + '</td>' +
        '<td><span class="state-' + stateKey(r.state) + '">' + esc(r.state) + '</span></td>' +
        '<td>' + esc(r.advice || '') + '</td>' +
        '<td class="muted">' + (full && full.time ? esc(full.time) : '—') + '</td>' +
        '<td>' + (review === '待复核' ? '<span class="tag tag-wait">待复核</span>' : '<span class="muted">' + esc(review || '免复核') + '</span>') + '</td></tr>';
    }).join('') || '<tr><td colspan="7" class="muted">暂无记录</td></tr>';
  }

  /* ── 设备 ─────────────────────────────────────────────── */
  function renderDevice() {
    var s = app.state || MOCK_STATE;
    var r = s.robot || MOCK_STATE.robot;
    var d = s.device || MOCK_STATE.device;
    $('#devPose').textContent = 'x ' + (r.x || 0).toFixed(2) + ' / y ' + (r.y || 0).toFixed(2) + ' / ' + Math.round(r.heading || 0) + '°';
    $('#devStop').textContent = (r.stop_index || 0) + ' / ' + (r.stop_total || 20) + ' / ' + (r.plot || 'B2-03');
    $('#devBattery').textContent = (r.battery || 0) + '% / ' + (r.voltage || 0).toFixed(1) + ' V';
    $('#devCurrent').textContent = (r.current || 0).toFixed(2) + ' A';
    $('#devTemp').textContent = (r.temp || 0) + ' °C';
    $('#devRssi').textContent = (d.rssi == null ? -52 : d.rssi) + ' dBm';
    $('#devLatency').textContent = (d.latency_ms == null ? 28 : d.latency_ms) + ' ms';
    $('#deviceLink').textContent = (d.link === 'wifi' ? 'WiFi' : d.link || 'WiFi') + ' / ' + (d.telemetry === 'device' ? '车端遥测' : '本地演示');
    $('#svcStatus').textContent = app.usingMock ? '离线演示' : '运行中';
    $('#svcStatus').className = 'tag ' + (app.usingMock ? 'tag-wait' : 'tag-run');
  }

  /* ── 视图 / 搜索 / 交互 ───────────────────────────────── */
  function switchView(name) {
    if (!VIEWS[name]) return;
    app.view = name;
    $$('.rail-item').forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-view') === name); });
    $$('.view').forEach(function (v) { v.classList.toggle('is-active', v.getAttribute('data-view') === name); });
    $('#viewTitle').textContent = VIEWS[name].title;
    $('#viewSub').textContent = VIEWS[name].sub;
    if (name === 'report') renderReport();
    if (name === 'review') renderReview();
    if (name === 'device') renderDevice();
  }

  function openPalette() {
    var p = $('#palette');
    p.hidden = false;
    var input = $('#paletteInput');
    input.value = '';
    renderPalette('');
    setTimeout(function () { input.focus(); }, 10);
  }
  function closePalette() { $('#palette').hidden = true; }
  function renderPalette(query) {
    var q = String(query || '').trim().toLowerCase();
    var rows = [];
    (app.records || []).forEach(function (r) {
      var hay = (r.code + ' ' + r.disease + ' ' + r.state + ' ' + (r.advice || '')).toLowerCase();
      if (!q || hay.indexOf(q) >= 0) {
        rows.push({ type: 'record', code: r.code, title: r.code, sub: r.disease + ' / ' + r.state + ' / ' + Number(r.confidence || 0).toFixed(2), right: '株' });
      }
    });
    Object.keys(VIEWS).forEach(function (key) {
      if (!q || (VIEWS[key].title + VIEWS[key].sub).toLowerCase().indexOf(q) >= 0) {
        rows.push({ type: 'view', view: key, title: VIEWS[key].title, sub: VIEWS[key].sub, right: '视图' });
      }
    });
    var box = $('#paletteResults');
    if (!rows.length) { box.innerHTML = '<div class="palette-empty">没有匹配的株位或视图</div>'; return; }
    box.innerHTML = rows.slice(0, 12).map(function (row) {
      var attr = row.type === 'record' ? 'data-code="' + esc(row.code) + '"' : 'data-view="' + esc(row.view) + '"';
      return '<button class="palette-row" ' + attr + '><span><b>' + esc(row.title) + '</b><span>' + esc(row.sub) + '</span></span><em>' + esc(row.right) + '</em></button>';
    }).join('');
  }

  function toast(text, kind) {
    var wrap = $('#toasts');
    if (!wrap) return;
    var el = document.createElement('div');
    el.className = 'toast' + (kind === 'alert' ? ' is-alert' : '');
    el.innerHTML = esc(text) + '<small>' + (HAS_HTTP ? '本地演示服务' : '离线界面演示') + '</small>';
    wrap.appendChild(el);
    while (wrap.children.length > 3) wrap.removeChild(wrap.firstChild);
    setTimeout(function () { el.remove(); }, 3600);
  }

  function bind() {
    $$('.rail-item').forEach(function (btn) {
      btn.addEventListener('click', function () { switchView(btn.getAttribute('data-view')); });
    });
    document.addEventListener('click', function (ev) {
      var goto = ev.target.closest('[data-goto]');
      if (goto) { switchView(goto.getAttribute('data-goto')); }
      var select = ev.target.closest('[data-select]');
      if (select) { selectRecord(select.getAttribute('data-select')); }
    });
    $('#mapPins').addEventListener('click', function (ev) {
      var pin = ev.target.closest('[data-code]');
      if (pin) selectRecord(pin.getAttribute('data-code'));
    });
    $('#queueBody').addEventListener('click', function (ev) {
      var row = ev.target.closest('tr[data-code]');
      if (row) selectRecord(row.getAttribute('data-code'));
    });
    $('#searchTrigger').addEventListener('click', openPalette);
    $('#palette').addEventListener('click', function (ev) {
      if (ev.target === $('#palette')) closePalette();
    });
    $('#paletteInput').addEventListener('input', function (ev) { renderPalette(ev.target.value); });
    $('#paletteInput').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') {
        var first = $('#paletteResults .palette-row');
        if (first) first.click();
      }
    });
    $('#paletteResults').addEventListener('click', function (ev) {
      var row = ev.target.closest('[data-code],[data-view]');
      if (!row) return;
      if (row.hasAttribute('data-code')) { selectRecord(row.getAttribute('data-code')); }
      else switchView(row.getAttribute('data-view'));
      closePalette();
    });

    $('#btnPatrol').addEventListener('click', function () {
      wsSend({ type: 'mode', mode: 'patrol' }).then(function (ack) {
        toast(ack && ack.ok ? '已恢复巡检模式' : '未连接服务，演示按钮未下发', ack && ack.ok ? '' : 'alert');
        refreshState();
      });
    });
    $('#btnRemote').addEventListener('click', function () {
      wsSend({ type: 'mode', mode: 'remote' }).then(function (ack) {
        toast(ack && ack.ok ? '已转远程模式，2.4G 遥控优先' : '未连接服务，演示按钮未下发', ack && ack.ok ? '' : 'alert');
        refreshState();
      });
    });
    $('#btnEstop').addEventListener('click', function () {
      wsSend({ type: 'estop' }).then(function (ack) {
        toast(ack && ack.ok ? '急停已触发：速度与任务锁定' : '未连接服务，演示按钮未下发', 'alert');
        refreshState();
      });
    });
    $('#btnReset') && $('#btnReset').addEventListener('click', function () {
      wsSend({ type: 'estop_reset' }).then(function (ack) {
        toast(ack && ack.ok ? '急停已复位' : '急停未复位', ack && ack.ok ? '' : 'alert');
        refreshState();
      });
    });
    $('#btnClearSel').addEventListener('click', function () { app.selected = null; renderMap(); renderQueue(); renderInspector(); });
    $('#btnReviewAll') && $('#btnReviewAll').addEventListener('click', function () { switchView('review'); });
    $('#btnExport').addEventListener('click', function () {
      if (!HAS_HTTP) { toast('需要本地服务才能导出 CSV', 'alert'); return; }
      toast('正在导出 CSV');
      window.location.href = '/api/export/csv';
    });
    $('#btnPrint').addEventListener('click', function () { window.print(); });
    $('#btnSnapshot').addEventListener('click', function () { toast('已截取当前帧（演示）'); });
    $('#btnSnapshot2').addEventListener('click', function () { toast('已截取当前帧（演示）'); });
    $('#btnCamToggle').addEventListener('click', function () { toggleVideo(); });
    $('#btnVideoToggle').addEventListener('click', function () { toggleVideo(); });
    $('#btnFullscreen').addEventListener('click', function () {
      var el = $('#videoStage');
      if (el && el.requestFullscreen) el.requestFullscreen().catch(function () {});
    });
    $('#btnLocate').addEventListener('click', function () {
      var robot = $('#robot');
      if (robot) { robot.classList.remove('is-locating'); void robot.getBoundingClientRect(); robot.classList.add('is-locating'); }
      toast('已定位到车端当前位置');
    });
    $('#btnSelfCheck').addEventListener('click', function () {
      toast('自检：相机在线 / UART 正常 / 电量 78% / 急停回路闭合');
    });
    $('#btnNewTask').addEventListener('click', function () { toast('演示版：任务创建入口未接入'); });

    document.addEventListener('click', function (ev) {
      var review = ev.target.closest('[data-review]');
      if (review) {
        var code = review.getAttribute('data-code') || app.selected;
        if (!code) return;
        reviewByCode(code, review.getAttribute('data-review'));
        return;
      }
      var assign = ev.target.closest('[data-assign]');
      if (assign) { toast('已指派复核：' + assign.getAttribute('data-assign')); return; }
      var task = ev.target.closest('[data-task]');
      if (task) { toast('演示版：' + (task.getAttribute('data-task') === 'pause' ? '任务暂停' : '任务已下发')); return; }
      var filter = ev.target.closest('[data-filter]');
      if (filter) {
        app.queueFilter = filter.getAttribute('data-filter');
        $$('[data-filter]').forEach(function (b) { b.classList.toggle('is-on', b === filter); });
        renderQueue();
        renderChrome();
      }
    });

    $('#thumbGrid') && $('#thumbGrid').addEventListener('click', function () {});
    $$('.thumb').forEach(function (t) {
      t.addEventListener('click', function () {
        var img = t.querySelector('img');
        if (img) { $('#videoImg').src = img.src; toast('已载入历史帧'); }
      });
    });
    $('#ptzPitch').addEventListener('input', function (ev) {
      $('#ptzPitchVal').textContent = ev.target.value + '°';
    });

    document.addEventListener('keydown', function (ev) {
      var tag = (ev.target && ev.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') {
        if (ev.key === 'Escape') { closePalette(); ev.target.blur(); }
        return;
      }
      if (ev.key === 'Escape') { closePalette(); app.selected = null; renderInspector(); renderMap(); renderQueue(); return; }
      if (ev.key === 'f' || ev.key === 'F') { ev.preventDefault(); openPalette(); return; }
      var idx = ['1', '2', '3', '4', '5', '6'].indexOf(ev.key);
      if (idx >= 0) {
        ev.preventDefault();
        switchView(Object.keys(VIEWS)[idx]);
      }
    });

    window.addEventListener('beforeunload', function () { if (app.ws) app.ws.close(); });
  }

  function toggleVideo() {
    var enabled = !(app.video && app.video.enabled) && !isRealCamera();
    wsSend({ type: 'video', enabled: enabled }).then(function (ack) {
      toast(ack && ack.ok ? (enabled ? '已开启低码率监看' : '已关闭图传监看') : '未连接服务，演示按钮未下发', ack && ack.ok ? '' : 'alert');
      refreshVideo();
      refreshCamera();
    });
  }

  /* ── 启动 ─────────────────────────────────────────────── */
  function boot() {
    buildMapStatic();
    bind();
    var forced = params.get('view');
    if (forced && VIEWS[forced]) switchView(forced);

    loadData().then(function (usingMock) {
      if (usingMock) {
        if (!FORCE_MOCK) {
          app.events = MOCK_EVENTS.slice();
          toast(HAS_HTTP ? '服务暂未响应，已加载演示数据' : '离线打开：当前为演示数据', 'alert');
        }
      }
      if (HAS_HTTP && !FREEZE && !FORCE_MOCK) {
        connectWS();
        app.timers.push(setInterval(refreshState, 3000));
        app.timers.push(setInterval(refreshRecords, 5000));
        app.timers.push(setInterval(refreshVideo, 3000));
        app.timers.push(setInterval(refreshCamera, 2500));
        app.timers.push(setInterval(tickClock, 1000));
        app.frameTimer = setInterval(cycleSimFrame, 1000);
      } else {
        setWsState(false);
        if (FREEZE) setSnapshotState();
      }
      renderAll();
      window.__READY__ = true;
      document.documentElement.setAttribute('data-ready', '1');
    }).catch(function () {
      app.state = MOCK_STATE;
      app.records = MOCK_RECORDS.slice();
      app.report = MOCK_REPORT;
      app.video = MOCK_VIDEO;
      app.camera = MOCK_CAMERA;
      app.events = MOCK_EVENTS.slice();
      selectDefault();
      renderAll();
      setWsState(false);
      if (FREEZE) setSnapshotState();
      window.__READY__ = true;
      document.documentElement.setAttribute('data-ready', '1');
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

