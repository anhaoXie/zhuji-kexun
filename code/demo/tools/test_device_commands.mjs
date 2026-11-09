// 联调：连 WS 发远程模式 + 控制 + 急停，然后取设备命令队列，验证真机下行链路。
const base = process.env.BASE || "http://127.0.0.1:8865";
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const ws = new WebSocket(base.replace("http", "ws") + "/ws");
  const acks = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.type === "ack") acks.push(m);
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const send = obj => ws.send(JSON.stringify(obj));
  send({ type: "hello", client: "node-test" });
  await sleep(150);
  send({ type: "mode", mode: "remote", seq: 1 });
  await sleep(150);
  send({ type: "control", cmd: "move", v: 0.3, w: -0.2, seq: 2 });
  await sleep(150);
  send({ type: "control", cmd: "stop", seq: 3 });
  await sleep(150);
  send({ type: "estop", seq: 4 });
  await sleep(300);
  ws.close();

  const r = await fetch(base + "/api/device/commands?since=0");
  const data = await r.json();
  console.log("ACKS:", JSON.stringify(acks));
  console.log("COMMANDS:", JSON.stringify(data));
  const types = data.commands.map(c => c.type);
  const ok = acks.length >= 4 && types.includes("mode") && types.includes("control") && types.includes("estop");
  console.log(ok ? "RESULT PASS" : "RESULT FAIL");
  process.exit(ok ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
