// pages/report/report.js —— Tab4 报表
// 数据：/api/report?batch=B-20261104-01；服务端不可用时自动降级到 utils/api.js 的 mock。
var app = getApp();
var api = require('../../utils/api.js');
var format = require('../../utils/format.js');

var REJUDGE_OPTIONS = ['新发', '持续', '加重', '好转', '已处理', '疑似误报'];

Page({
  data: {
    loading: true,
    batch: {},
    batchId: 'B-20261104-01',
    kpis: [],
    states: [],
    stateTotal: 0,
    records: [],
    review: [],
    sub: {},
    footer: ''
  },

  onLoad: function () {
    this._load();
  },

  onShow: function () {
    if (!this._loadedOnce) this._load();
  },

  _load: function () {
    var self = this;
    if (app.globalData.report) this._render(app.globalData.report);
    var cached = app.globalData.report;
    var batchId = (cached && cached.batch && cached.batch.id) || this.data.batchId;
    app
      .fetchReport(batchId)
      .then(function (res) {
        self._loadedOnce = true;
        self._render(res.data);
      })
      .catch(function () {
        self._loadedOnce = true;
        self._render(api.mockReport());
      });
  },

  _render: function (data) {
    if (!data) return;
    var kpis = (data.kpis || []).map(function (kpi) {
      return { key: kpi.key, label: kpi.label, value: kpi.value, unit: kpi.unit };
    });

    var maxCount = 1;
    var stateTotal = 0;
    (data.states || []).forEach(function (item) {
      if (item.count > maxCount) maxCount = item.count;
      stateTotal += item.count;
    });
    var states = (data.states || []).map(function (item) {
      return {
        key: item.key,
        label: item.label,
        count: item.count,
        color: item.color,
        barPct: Math.max(10, Math.round((item.count / maxCount) * 100))
      };
    });

    var records = (data.records || []).map(function (item) {
      return {
        code: item.code,
        state: item.state,
        stateClass: format.stateClass(item.state),
        confText: format.confText(item.confidence),
        advice: item.advice
      };
    });

    var review = (data.review || []).map(function (item, index) {
      return {
        key: item.code + '-' + index,
        code: item.code,
        disease: item.disease,
        confText: format.confText(item.confidence),
        reviewed: false,
        doneText: '已确认'
      };
    });

    var batch = data.batch || {};
    this.setData({
      loading: false,
      batch: batch,
      batchId: batch.id || this.data.batchId,
      kpis: kpis,
      states: states,
      stateTotal: stateTotal,
      records: records,
      review: review,
      sub: data.sub || {},
      footer: data.footer || ''
    });
  },

  /* ---------------- 待复核：确认 / 改判 ---------------- */

  onConfirmTap: function (event) {
    var index = Number(event.currentTarget.dataset.index);
    var item = this.data.review[index];
    if (!item || item.reviewed) return;
    var patch = {};
    patch['review[' + index + '].reviewed'] = true;
    patch['review[' + index + '].doneText'] = '已确认';
    this.setData(patch);
    app.sendReview(item.code, 'confirm');
    wx.showToast({ title: '已确认', icon: 'none' });
  },

  onRejudgeTap: function (event) {
    var index = Number(event.currentTarget.dataset.index);
    var item = this.data.review[index];
    if (!item || item.reviewed) return;
    var self = this;
    wx.showActionSheet({
      itemList: REJUDGE_OPTIONS,
      success: function (res) {
        var target = REJUDGE_OPTIONS[res.tapIndex];
        if (!target) return;
        var patch = {};
        patch['review[' + index + '].reviewed'] = true;
        patch['review[' + index + '].doneText'] = '已改判：' + target;
        self.setData(patch);
        app.sendReview(item.code, 'rejudge');
        wx.showToast({ title: '已改判为' + target, icon: 'none' });
      }
    });
  },

  /* ---------------- 批次 / 导出 ---------------- */

  onBatchTap: function () {
    wx.showToast({ title: '当前仅演示批次 ' + this.data.batchId, icon: 'none' });
  },

  onExportCsv: function () {
    // TODO: 真机可 wx.downloadFile({ url: apiBase + '/api/export/csv' }) 后 openDocument / 转发
    wx.showToast({ title: '演示版：CSV 已生成', icon: 'none' });
  },

  onExportPdf: function () {
    // TODO: 报表 PDF 由 PC 端生成，小程序侧只做入口
    wx.showToast({ title: '演示版：PDF 报表已生成', icon: 'none' });
  }
});
