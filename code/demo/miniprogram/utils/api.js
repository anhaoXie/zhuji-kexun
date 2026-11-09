// utils/api.js —— 本地服务接口封装 + 内置 mock
// 契约：./docs/api_contract.md
// 服务端不可用时自动降级到 mock（字段与契约一致），保证微信开发者工具里四个页面都能看到界面。
// 注意：mock 的“行数”按 BUILD_SPEC 演示口径补足（最近结果 3 条、待复核 3 条、病害记录 3 条）。

var DEFAULT_API_BASE = 'http://127.0.0.1:8765';
var REQUEST_TIMEOUT = 1500;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function joinUrl(base, path) {
  var root = String(base || DEFAULT_API_BASE).replace(/\/+$/, '');
  return root + path;
}

/**
 * 统一 GET 封装。返回 Promise，失败时 reject，由上层决定降级到 mock。
 * @param {string} base 服务端根地址（如 http://127.0.0.1:8765）
 * @param {string} path 以 / 开头的接口路径
 * @param {object} [options] { method, data, timeout }
 */
function request(base, path, options) {
  options = options || {};
  return new Promise(function (resolve, reject) {
    if (typeof wx === 'undefined' || !wx.request) {
      reject(new Error('wx.request 不可用'));
      return;
    }
    wx.request({
      url: joinUrl(base, path),
      method: options.method || 'GET',
      data: options.data || {},
      header: { 'content-type': 'application/json' },
      timeout: options.timeout || REQUEST_TIMEOUT,
      success: function (res) {
        if (res && res.statusCode >= 200 && res.statusCode < 300 && res.data && typeof res.data === 'object') {
          resolve(res.data);
        } else {
          reject(new Error('HTTP ' + (res && res.statusCode)));
        }
      },
      fail: function (err) {
        reject(err || new Error('request failed'));
      }
    });
  });
}

/* =============================== mock 数据 =============================== */

// GET /api/state —— 字段与 api_contract.md 第 1 节一致
var MOCK_STATE = {
  ts: 1793,
  device: { name: '株迹可循-01', fw: 'v1.0.0', link: 'wifi', rssi: -52, latency_ms: 28 },
  robot: {
    mode: 'patrol',
    mode_text: '巡检中',
    battery: 78,
    voltage: 11.6,
    current: 0.82,
    temp: 32,
    speed: 0.5,
    x: 3.24,
    y: 1.85,
    heading: 90,
    stop_index: 7,
    stop_total: 20,
    bed: 'B2',
    plot: 'B2-03',
    progress: 0.66,
    plants_done: 42,
    plants_total: 64,
    distance_m: 18.6,
    detected: 6
  },
  batch: {
    id: 'B-20261104-01',
    greenhouse: '1号棚',
    start: '2026-11-04T09:20:00+08:00',
    end: null,
    status: 'running'
  },
  recent: [
    {
      code: '1棚-3行-B2台-2位-1株',
      disease: '叶斑病',
      confidence: 0.91,
      state: '新发',
      time: '09:24',
      suggest: '分区标记 + 加密复查'
    },
    {
      code: '1棚-2行-A1台-1位-1株',
      disease: '叶斑病',
      confidence: 0.88,
      state: '持续',
      time: '09:22',
      suggest: '维持监测 + 下轮复查'
    },
    {
      code: '1棚-4行-B4台-2位-2株',
      disease: '白粉病',
      confidence: 0.84,
      state: '好转',
      time: '09:19',
      suggest: '维持当前处置'
    }
  ],
  review: [
    { code: '1棚-2行-A1台-1位-1株', disease: '叶斑病', confidence: 0.63, state: '待复核' },
    { code: '1棚-1行-A2台-2位-1株', disease: '白粉病', confidence: 0.58, state: '待复核' },
    { code: '1棚-4行-B3台-1位-2株', disease: '叶斑病', confidence: 0.61, state: '待复核' }
  ]
};

// GET /api/report?batch=B-20261104-01 —— 字段与 api_contract.md 第 1 节一致
var MOCK_REPORT = {
  batch: {
    id: 'B-20261104-01',
    greenhouse: '1号棚',
    time: '2026-11-04 09:20—09:26',
    status: 'done'
  },
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
    {
      code: '1棚-3行-B2台-2位-1株',
      state: '新发',
      confidence: 0.91,
      advice: '分区标记 + 加密复查'
    },
    {
      code: '1棚-2行-A1台-1位-1株',
      state: '持续',
      confidence: 0.88,
      advice: '维持监测 + 下轮复查'
    },
    {
      code: '1棚-4行-B4台-2位-2株',
      state: '好转',
      confidence: 0.84,
      advice: '维持当前处置'
    }
  ],
  review: [
    { code: '1棚-2行-A1台-1位-1株', disease: '叶斑病', confidence: 0.63 },
    { code: '1棚-1行-A2台-2位-1株', disease: '白粉病', confidence: 0.58 },
    { code: '1棚-4行-B3台-1位-2株', disease: '叶斑病', confidence: 0.61 }
  ],
  footer: '判定规则/阈值/模型版本随批次归档 · 批次 B-20261104-01'
};

// GET /api/video/info —— 字段与 api_contract.md 第 1 节一致；x/y/w/h 为 0—1 相对比例
var MOCK_VIDEO_INFO = {
  enabled: false,
  camera: 'K230 · 顶视',
  width: 1280,
  height: 720,
  bitrate: '1.2 Mbps',
  fps: 15,
  ptz: { pan: 0, pitch: 78 },
  ts: '2026-11-04 09:24:31',
  boxes: [
    {
      x: 0.22,
      y: 0.3,
      w: 0.26,
      h: 0.34,
      label: '叶斑病',
      confidence: 0.87,
      status: 'high'
    },
    {
      x: 0.58,
      y: 0.52,
      w: 0.18,
      h: 0.22,
      label: '叶斑病',
      confidence: 0.63,
      status: 'review'
    }
  ]
};

function mockState() {
  return clone(MOCK_STATE);
}

function mockReport() {
  return clone(MOCK_REPORT);
}

function mockVideoInfo() {
  return clone(MOCK_VIDEO_INFO);
}

/* =============================== 接口 =============================== */

function getState(base) {
  return request(base, '/api/state')
    .then(function (data) {
      return { data: data, live: true };
    })
    .catch(function () {
      return { data: mockState(), live: false };
    });
}

function getReport(batchId, base) {
  var path = '/api/report';
  if (batchId) path += '?batch=' + encodeURIComponent(batchId);
  return request(base, path)
    .then(function (data) {
      return { data: data, live: true };
    })
    .catch(function () {
      return { data: mockReport(), live: false };
    });
}

function getVideoInfo(base) {
  return request(base, '/api/video/info')
    .then(function (data) {
      return { data: data, live: true };
    })
    .catch(function () {
      return { data: mockVideoInfo(), live: false };
    });
}

module.exports = {
  DEFAULT_API_BASE: DEFAULT_API_BASE,
  request: request,
  joinUrl: joinUrl,
  getState: getState,
  getReport: getReport,
  getVideoInfo: getVideoInfo,
  mockState: mockState,
  mockReport: mockReport,
  mockVideoInfo: mockVideoInfo,
  clone: clone
};
