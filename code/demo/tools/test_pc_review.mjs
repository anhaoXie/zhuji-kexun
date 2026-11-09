// 验证 PC 复核链路：连 /ws，挑一条待复核，发 review，查 ack 与 /api/records。
const base = "http://127.0.0.1:8765";
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const recs = await fetch(base + "/api/records").then(r => r.json());
  const target = (recs.records || []).find(r => r.review_state === "待复核");
  if (!target) { console.log("NO PENDING REVIEW"); process.exit(1); }
  console.log("TARGET", target.code, target.confidence);
  const ws = new WebSocket("ws://127.0.0.1:8765/ws");
  const acks = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.type === "ack") acks.push(m);
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.send(JSON.stringify({ type: "review", code: target.code, action: "confirm", seq: 7 }));
  await sleep(600);
  ws.close();
  console.log("ACK", JSON.stringify(acks));
  const after = await fetch(base + "/api/records").then(r => r.json());
  const updated = (after.records || []).find(r => r.code === target.code);
  console.log("AFTER", updated && updated.review_state);
  const ok = acks.some(a => a.seq === 7 && a.ok === true) && updated && updated.review_state === "已确认";
  console.log(ok ? "RESULT PASS" : "RESULT FAIL");
  process.exit(ok ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
