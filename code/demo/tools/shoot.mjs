#!/usr/bin/env node
// 无依赖 CDP 截图工具：用 Chrome headless 打开本地页面，按手机视口整屏截图。
// 用法：
//   node tools/shoot.mjs --url "file:///.../web/index.html?shot=monitor&freeze=1" --out shots/monitor.png
//   可选 --width 390 --height 844 --scale 3 --wait 1200 --timeout 15000
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  if (i === -1) return def;
  return process.argv[i + 1];
}

const url = arg("url");
const out = arg("out");
const width = parseInt(arg("width", "390"), 10);
const height = parseInt(arg("height", "844"), 10);
const scale = parseFloat(arg("scale", "3"));
const extraWait = parseInt(arg("wait", "600"), 10);
const timeout = parseInt(arg("timeout", "20000"), 10);
if (!url || !out) {
  console.error("usage: node shoot.mjs --url <url> --out <png> [--width 390 --height 844 --scale 3]");
  process.exit(2);
}
fs.mkdirSync(path.dirname(out), { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-chrome-"));
const portFile = path.join(profile, "DevToolsActivePort");

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await sleep(80);
  }
  throw new Error("timeout waiting for " + label);
}

async function main() {
  const args = [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio",
    "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    "--force-color-profile=srgb", "--font-render-hinting=none",
    "--remote-debugging-port=0", "--user-data-dir=" + profile,
    "--allow-file-access-from-files",
    "about:blank",
  ];
  const chrome = spawn(CHROME, args, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  chrome.stderr.on("data", d => { stderr += d.toString(); });

  try {
    const port = await waitFor(() => {
      if (!fs.existsSync(portFile)) return null;
      const txt = fs.readFileSync(portFile, "utf8").split(/\r?\n/);
      return txt[0] ? parseInt(txt[0], 10) : null;
    }, 15000, "DevToolsActivePort");

    const ver = await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.json());
    const ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let seq = 0;
    const pending = new Map();
    const events = [];
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) {
        events.push(msg);
      }
    };
    const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
      const id = ++seq;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const s = (m, p) => send(m, p, sessionId);

    await s("Page.enable");
    await s("Runtime.enable");
    await s("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: scale, mobile: false, screenWidth: width, screenHeight: height,
    });
    await s("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

    const loaded = new Promise(resolve => {
      const timer = setInterval(() => {
        if (events.some(e => e.method === "Page.loadEventFired")) { clearInterval(timer); resolve(); }
      }, 50);
      setTimeout(() => { clearInterval(timer); resolve(); }, timeout);
    });
    await s("Page.navigate", { url });
    await loaded;

    // 等待页面 ready 标志或固定时长
    const t0 = Date.now();
    let ready = false;
    while (Date.now() - t0 < timeout) {
      try {
        const r = await s("Runtime.evaluate", { expression: "window.__READY__ === true", returnByValue: true });
        if (r.result && r.result.value === true) { ready = true; break; }
      } catch (e) { /* ignore */ }
      await sleep(100);
    }
    await sleep(extraWait);

    const shot = await s("Page.captureScreenshot", {
      format: "png", fromSurface: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    fs.writeFileSync(out, Buffer.from(shot.data, "base64"));

    // 收集 console 错误
    let errors = [];
    try {
      const logs = await s("Runtime.evaluate", {
        expression: "JSON.stringify(window.__CONSOLE_ERRORS__ || [])", returnByValue: true,
      });
      errors = JSON.parse(logs.result.value || "[]");
    } catch (e) { }
    console.log(JSON.stringify({ ok: true, out, ready, width, height, scale, consoleErrors: errors }));
    await send("Target.closeTarget", { targetId }).catch(() => {});
    ws.close();
  } finally {
    try { chrome.kill(); } catch (e) { }
    await sleep(250);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { }
    if (stderr && /error/i.test(stderr) && !/DevTools listening/.test(stderr)) {
      // 仅在失败时输出，避免噪音
      if (!fs.existsSync(out)) console.error(stderr.slice(-2000));
    }
  }
}

main().catch(e => { console.error("SHOOT FAILED:", e.message); process.exit(1); });
