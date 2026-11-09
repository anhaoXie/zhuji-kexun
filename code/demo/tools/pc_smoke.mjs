#!/usr/bin/env node
// PC 端交互冒烟：连真实服务，检查 WS、切视图、复核、地图点选。
// 用法：node tools/pc_smoke.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.PC_URL || "http://127.0.0.1:8765/pc/";
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await sleep(80);
  }
  throw new Error("timeout: " + label);
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-pc-smoke-"));
  const portFile = path.join(profile, "DevToolsActivePort");
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio",
    "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  chrome.stderr.on("data", () => {});
  try {
    const port = await waitFor(() => {
      if (!fs.existsSync(portFile)) return null;
      const t = fs.readFileSync(portFile, "utf8").split(/\r?\n/);
      return t[0] ? parseInt(t[0], 10) : null;
    }, 15000, "DevToolsActivePort");
    const ver = await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.json());
    const ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let seq = 0; const pending = new Map(); const runtimeErrors = [];
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.method === "Runtime.exceptionThrown") {
        runtimeErrors.push(String(msg.params.exceptionDetails && msg.params.exceptionDetails.text || "exception"));
      }
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        runtimeErrors.push((msg.params.args || []).map(a => a.value || a.description || "").join(" "));
      }
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id); pending.delete(msg.id);
        msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result);
      }
    };
    const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
      const id = ++seq; pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const s = (m, p) => send(m, p, sessionId);
    await s("Page.enable"); await s("Runtime.enable");
    await s("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await s("Page.navigate", { url: URL });
    await waitFor(async () => {
      const r = await s("Runtime.evaluate", { expression: "window.__READY__ === true", returnByValue: true });
      return r.result && r.result.value === true;
    }, 20000, "ready");

    const evalJs = async expr => {
      const r = await s("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
      return r.result ? r.result.value : undefined;
    };
    const wsState = await waitFor(async () => {
      const v = await evalJs("document.querySelector('#wsState') && document.querySelector('#wsState').textContent");
      return v && v.indexOf("已连接") >= 0 ? v : null;
    }, 8000, "ws connected").catch(() => evalJs("document.querySelector('#wsState').textContent"));

    // 切复核
    await evalJs("document.querySelector('[data-view=\"review\"]').click(); true");
    await sleep(300);
    const reviewActive = await evalJs("document.querySelector('.view[data-view=\"review\"]').classList.contains('is-active')");
    const cardsBefore = await evalJs("document.querySelectorAll('#reviewList .review-card').length");
    await evalJs("(document.querySelector('#reviewList [data-review=\"confirm\"]')||{click:function(){}}).click(); true");
    await sleep(1000);
    const cardsAfter = await evalJs("document.querySelectorAll('#reviewList .review-card').length");

    // 切总览，点地图色点
    await evalJs("document.querySelector('[data-view=\"overview\"]').click(); true");
    await sleep(300);
    const pins = await evalJs("document.querySelectorAll('#mapPins .pin').length");
    await evalJs("(document.querySelector('#mapPins .pin')||{dispatchEvent:function(){}}).dispatchEvent(new MouseEvent('click',{bubbles:true})); true");
    await sleep(300);
    const dossier = await evalJs("(document.querySelector('#dossierBody .dossier-code')||{}).textContent || ''");

    const pageErrors = await evalJs("JSON.stringify(window.__CONSOLE_ERRORS__ || [])");
    const errors = JSON.parse(pageErrors || "[]").concat(runtimeErrors);
    const pass = reviewActive && cardsBefore >= 1 && cardsAfter < cardsBefore && pins >= 1 && dossier.length > 0 && errors.length === 0;
    console.log(JSON.stringify({
      ws: wsState, reviewActive, cardsBefore, cardsAfter, pins, dossier, errors, pass,
    }, null, 2));
    await send("Target.closeTarget", { targetId }).catch(() => {});
    ws.close();
    process.exit(pass ? 0 : 1);
  } finally {
    try { chrome.kill(); } catch (e) {}
    await sleep(250);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
}
main().catch(e => { console.error("PC SMOKE FAILED:", e.message); process.exit(1); });
