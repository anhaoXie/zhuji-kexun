// Minimal headless-Chrome probe: navigate to the local test page at 390x844,
// print viewport metrics and save a screenshot. Used during UI development.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');

const CHROME = process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zhuji-chrome-'));
  const portFile = path.join(profile, 'DevToolsActivePort');
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--remote-debugging-port=0',
    '--user-data-dir=' + profile, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let port = 0;
  for (let i = 0; i < 150; i++) {
    if (fs.existsSync(portFile)) {
      const line = fs.readFileSync(portFile, 'utf8').split(/\r?\n/);
      port = parseInt(line[0], 10);
      if (port) break;
    }
    await sleep(100);
  }

  const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);

  await s('Page.enable');
  await s('Runtime.enable');
  await s('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
    screenWidth: 390, screenHeight: 844,
  });

  const pageUrl = pathToFileURL(path.resolve(__dirname, 'test_page.html')).href;
  await s('Page.navigate', { url: pageUrl });
  await sleep(800);

  const ev = await s('Runtime.evaluate', {
    expression: 'JSON.stringify({iw:innerWidth,ih:innerHeight,dpr:devicePixelRatio,vv:visualViewport.width,bw:document.body.clientWidth})',
    returnByValue: true,
  });
  console.log(ev.result.value);

  const shot = await s('Page.captureScreenshot', {
    format: 'png', fromSurface: true,
    clip: { x: 0, y: 0, width: 390, height: 844, scale: 3 },
  });
  const outDir = path.resolve(__dirname, '..', 'shots');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, '_probe.png'), Buffer.from(shot.data, 'base64'));
  console.log('shot bytes', shot.data.length);
  chrome.kill();
})();
