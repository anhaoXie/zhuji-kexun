/* ============================================================
 * 图传源切换（K230 真实图传 / 演示画面）
 * - 仅在 http(s) 且非 ?freeze=1 截图模式时工作
 * - 服务端 /api/camera/status 返回 source.mode/online/stream_url
 * - push/rtsp: 用服务端 MJPEG；mjpeg: 直接连 K230 自己的 MJPEG 地址
 * ============================================================ */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var FREEZE = params.get('freeze') === '1';
  var HAS_HTTP = /^https?:$/.test(location.protocol);
  /* 截图模式：隐藏源角标，保持界面设计图 与之前一致 */
  if (FREEZE) {
    var frozenBadge = document.querySelector('#camSource');
    if (frozenBadge) frozenBadge.style.display = 'none';
    return;
  }
  if (!HAS_HTTP) return;

  var el = { img: null, badge: null, hint: null };
  var applied = null;                // 当前已应用的源：'sim' | 'push' | 'mjpeg' | 'rtsp'
  var timer = null;

  function $(sel) { return document.querySelector(sel); }

  function setBadge(text, live) {
    if (!el.badge) return;
    el.badge.textContent = text;
    el.badge.classList.toggle('is-live', !!live);
  }

  function useStream(url) {
    if (!el.img) return;
    el.img.classList.remove('img-failed');
    el.img.src = url;
  }

  function useSim() {
    if (!el.img) return;
    var sim = '../assets/cam_plant.jpg';
    if (el.img.getAttribute('src') !== sim) el.img.src = sim;
  }

  function applyStatus(payload) {
    var src = (payload && payload.source) || {};
    var mode = src.mode || 'sim';
    var online = !!src.online;
    var real = online && (mode === 'push' || mode === 'rtsp' || mode === 'mjpeg');

    if (real) {
      var fps = src.fps ? (Math.round(src.fps * 10) / 10) : 0;
      var kbps = src.kbps ? Math.round(src.kbps) : 0;
      if (mode === 'mjpeg' && src.stream_url) {
        if (applied !== 'mjpeg') { useStream(src.stream_url); applied = 'mjpeg'; }
        setBadge('K230 直连', true);
      } else {
        if (applied !== mode) { useStream('/api/camera/stream.mjpg?r=' + Date.now()); applied = mode; }
        setBadge('K230 实拍', true);
      }
      if (el.hint) {
        el.hint.textContent = '真实图传：' + (src.width || '-') + '×' + (src.height || '-') +
          ' · ' + fps + ' fps · ' + kbps + ' kbps';
      }
      return;
    }

    if (applied !== 'sim') { useSim(); applied = 'sim'; }
    setBadge('演示画面', false);
    if (el.hint) el.hint.textContent = '默认关闭，开启后仅传低码率画面';
  }

  function poll() {
    fetch('/api/camera/status', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { if (data) applyStatus(data); })
      .catch(function () { /* 服务断了：保持当前画面，不清空 */ });
  }

  function boot() {
    el.img = $('#camImg');
    el.badge = $('#camSource');
    el.hint = $('#videoHint');
    if (!el.img || !el.badge) return;
    if (el.img) {
      el.img.addEventListener('error', function () { /* MJPEG 断流时保留最后一帧 */ });
    }
    poll();
    timer = setInterval(poll, 1500);
    // 页面隐藏时暂停轮询，避免无谓请求
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { if (timer) { clearInterval(timer); timer = null; } }
      else if (!timer) { poll(); timer = setInterval(poll, 1500); }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
