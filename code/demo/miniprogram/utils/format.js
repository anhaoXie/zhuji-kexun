// utils/format.js —— 状态映射与时间/置信度格式化（多个页面共用）

var STATE_CLASS = {
  新发: 'new',
  持续: 'ongoing',
  加重: 'worse',
  好转: 'better',
  已处理: 'handled',
  疑似误报: 'false'
};

/** 六状态 -> app.wxss 里的 tag 后缀；未知值按“已处理”里的中性灰兜底 */
function stateClass(state) {
  return STATE_CLASS[state] || 'handled';
}

function pad2(value) {
  var n = Number(value) || 0;
  return n < 10 ? '0' + n : '' + n;
}

/** Date -> "2026-11-04 09:24:31"（车端时间戳格式） */
function formatDateTime(date) {
  return (
    date.getFullYear() +
    '-' +
    pad2(date.getMonth() + 1) +
    '-' +
    pad2(date.getDate()) +
    ' ' +
    pad2(date.getHours()) +
    ':' +
    pad2(date.getMinutes()) +
    ':' +
    pad2(date.getSeconds())
  );
}

/** 0.91 -> "0.91"；异常值 -> "--" */
function confText(value) {
  var n = Number(value);
  return isNaN(n) ? '--' : n.toFixed(2);
}

module.exports = {
  stateClass: stateClass,
  pad2: pad2,
  formatDateTime: formatDateTime,
  confText: confText
};
