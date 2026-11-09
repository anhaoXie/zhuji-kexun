#!/usr/bin/env node
// server/tests/ws_smoke.js —— Node 24 全局 WebSocket 冒烟测试（无第三方依赖）
//
// 用法:
//   node server/tests/ws_smoke.js ws://127.0.0.1:8799/ws
//   node server/tests/ws_smoke.js ws://127.0.0.1:8799/ws --wait-report   # 等到巡检完成并校验 report_ready
//
// 覆盖用例:
//   1) 首帧 state 字段合法
//   2) patrol 模式下 control(move) 被拒绝 -> ack.ok=false, error="mode"
//   3) mode=remote 切换成功 -> ack.ok=true
//   4) remote 下 control(move) 成功 -> ack.ok=true, seq 回显
//   5) remote 500 ms 无新指令自动停车（state.speed=0 + event 含"自动停车"）
//   6) estop 生效 -> ack.ok=true
//   7) 急停后 control 被拒绝 -> error="estop"
//   8) ping -> pong 回显 t
//   9) （--wait-report）巡检完成 -> report_ready + mode=idle / 64 株 / 9 检出
//
// 说明：所有请求都带唯一 seq，ack 按 seq 精确匹配，避免与 hello 的 ack 竞态。

const URL = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'ws://127.0.0.1:8765/ws';
const WAIT_REPORT = process.argv.includes('--wait-report');
const t0 = Date.now();
const ts = () => `[${String(Date.now() - t0).padStart(6)}ms]`;
const log = (...a) => console.log(ts(), ...a);
const failures = [];
const events = [];
const inbox = [];          // 未消费的非 state 消息
const waiters = [];        // 等待中的谓词
let states = 0;
let latest = null;
let firstState = null;

const ws = new WebSocket(URL);
const check = (ok, label) => { console.log(ts(), ok ? 'PASS' : 'FAIL', label); if (!ok) failures.push(label); };
const send = (m) => { log('>>', JSON.stringify(m)); ws.send(JSON.stringify(m)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitFor(pred, label, timeout = 8000) {
  const hit = inbox.findIndex(pred);
  if (hit >= 0) return Promise.resolve(inbox.splice(hit, 1)[0]);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), timeout);
    waiters.push({ pred, timer, resolve: (m) => { clearTimeout(timer); resolve(m); } });
  });
}
const waitAck = (seq, label, timeout) => waitFor((m) => m.type === 'ack' && m.seq === seq, label, timeout);

function finish(extra) {
  if (finished) return;
  finished = true;
  if (extra) failures.push(extra);
  log(`states=${states} events=${events.length}`);
  console.log(ts(), failures.length ? `RESULT FAIL (${failures.length}): ${failures.join(' | ')}` : 'RESULT PASS');
  try { ws.close(); } catch (_) { /* ignore */ }
  setTimeout(() => process.exit(failures.length ? 1 : 0), 150);
}
let finished = false;
const overall = setTimeout(() => finish('overall timeout'), WAIT_REPORT ? 150000 : 25000);

const opened = new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve);
  ws.addEventListener('error', () => (finished ? null : reject(new Error('websocket error'))));
});
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.type === 'state') {
    states++;
    if (m.robot) latest = m.robot;
    if (!firstState) { firstState = m.robot; }
    return;
  }
  if (m.type === 'event') { events.push(m.text); log('event:', `[${m.level}] ${m.text}`); return; }
  const i = waiters.findIndex((w) => w.pred(m));
  if (i >= 0) { const w = waiters.splice(i, 1)[0]; w.resolve(m); return; }
  inbox.push(m);
});

(async () => {
  try {
    await opened;
    log('open', URL);
    send({ type: 'hello', client: 'node-smoke', seq: 9 });
    // 等首帧 state
    for (let i = 0; i < 40 && !firstState; i++) await sleep(50);
    check(!!firstState && typeof firstState.battery === 'number', '首帧 state 字段合法');
    log('first state:', JSON.stringify({ mode: firstState.mode, plants: firstState.plants_done, total: firstState.plants_total, detected: firstState.detected, stop: firstState.stop_index, review_pending: firstState.review }));

    // 2) patrol 下 move 被拒
    send({ type: 'control', cmd: 'move', v: 0.3, w: 0, seq: 0 });
    const ack0 = await waitAck(0, 'ack seq=0');
    check(ack0.ok === false && ack0.error === 'mode', 'patrol 模式 move 被拒 error=mode');

    // 3) 切远程
    send({ type: 'mode', mode: 'remote', seq: 10 });
    const ackMode = await waitAck(10, 'ack seq=10');
    check(ackMode.ok === true, '切换 remote ack.ok=true');

    // 4) remote 下 move 成功
    send({ type: 'control', cmd: 'move', v: 0.3, w: -0.2, seq: 1 });
    const ackMove = await waitAck(1, 'ack seq=1');
    check(ackMove.ok === true && ackMove.seq === 1, 'remote 模式 move ack.ok=true, seq 回显');

    // 5) 500 ms 无新指令自动停车
    await sleep(1100);
    check(latest && latest.speed === 0, `remote 500ms 无新指令自动停车（state.speed=${latest && latest.speed}）`);
    check(events.some((t) => t.includes('自动停车')), '收到自动停车 event');

    // 6) 急停
    send({ type: 'estop', seq: 3 });
    const ackEstop = await waitAck(3, 'ack seq=3');
    check(ackEstop.ok === true, 'estop ack.ok=true');

    // 7) 急停后控制被拒
    send({ type: 'control', cmd: 'move', v: 0.2, w: 0, seq: 2 });
    const ackDeny = await waitAck(2, 'ack seq=2');
    check(ackDeny.ok === false && ackDeny.error === 'estop', '急停后控制被拒 error=estop');

    // 8) ping -> pong
    send({ type: 'ping', t: 12345, seq: 4 });
    const pong = await waitFor((m) => m.type === 'pong', 'pong');
    check(pong.t === 12345, 'ping -> pong 回显 t=12345');

    if (!WAIT_REPORT) return finish();

    // 9) 复位 + 恢复巡检，等待本圈完成
    send({ type: 'estop_reset', seq: 5 });
    const ackReset = await waitAck(5, 'ack seq=5');
    check(ackReset.ok === true, '急停复位 ack.ok=true');
    send({ type: 'mode', mode: 'patrol', seq: 6 });
    const ackPatrol = await waitAck(6, 'ack seq=6');
    check(ackPatrol.ok === true, '恢复巡检模式 ack.ok=true');
    log('等待本圈巡检完成（report_ready）...');
    const ready = await waitFor((m) => m.type === 'report_ready', 'report_ready', 145000);
    check(ready.batch && ready.batch.id === 'B-20261104-01', 'report_ready 推送批次号 B-20261104-01');
    await sleep(700);
    check(latest.mode === 'idle', `完成后 mode=idle（实际 ${latest && latest.mode}）`);
    check(latest.plants_done === 64 && latest.detected === 9 && latest.progress === 1, '完成后 64 株 / 9 检出 / progress=1');
    return finish();
  } catch (err) {
    return finish(err.message);
  }
})();
