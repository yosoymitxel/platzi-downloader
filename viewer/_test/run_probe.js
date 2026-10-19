// _test/run_probe.js — corre un fixture en Edge headless por CDP y vuelca el reporte.
// uso: node run_probe.js <main|nodata|nostorage> <salida.json>
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const os = require('os');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const mode = process.argv[2] || 'main';
const outFile = process.argv[3] || path.join(__dirname, 'out-' + mode + '.json');
const url = 'http://127.0.0.1:8787/viewer/_test/' + (mode === 'main' ? 'index.html' : mode + '/index.html');
const port = 9333 + Math.floor(Math.random() * 400);
const userDir = path.join(os.tmpdir(), 'edge-probe-' + port);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJSON(p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: p, timeout: 2000 }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}

function trim(m) {
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails || {};
    return { type: 'exception', text: (d.exception && (d.exception.description || d.exception.value)) || d.text, url: d.url, line: d.lineNumber };
  }
  if (m.method === 'Runtime.consoleAPICalled') {
    return { type: m.params.type, text: (m.params.args || []).map((a) => (a.value !== undefined ? String(a.value) : (a.description || a.type))).join(' ') };
  }
  if (m.method === 'Log.entryAdded') {
    const e = m.params.entry || {};
    return { type: 'log:' + e.source, level: e.level, text: e.text, url: e.url };
  }
  return null;
}

(async () => {
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required', '--mute-audio',
    '--disable-extensions', '--window-size=1400,900',
    '--user-data-dir=' + userDir,
    '--remote-debugging-port=' + port,
    'about:blank'
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 80 && !targets; i++) {
    try { targets = await getJSON('/json/list'); } catch (e) { await sleep(250); }
  }
  if (!targets) { fs.writeFileSync(outFile, JSON.stringify({ report: null, events: [], error: 'sin CDP endpoint' })); cleanup(); return; }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) { const t = trim(msg); if (t) events.push(t); }
  };
  const send = (method, params) => new Promise((resolve) => {
    const i = ++id;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });

  let report = null;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    await sleep(500);
    const r = await send('Runtime.evaluate', { expression: '(window.__probeDone === true ? window.__probeReport : null)', returnByValue: true });
    const v = r.result && r.result.result && r.result.result.value;
    if (v) { report = JSON.parse(v); break; }
  }

  fs.writeFileSync(outFile, JSON.stringify({ url, report, events }, null, 1));
  console.log('escrito', outFile, report ? '(report ok)' : '(sin reporte)');
  cleanup();

  function cleanup() {
    try { spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {}
    process.exit(0);
  }
})().catch((e) => {
  fs.writeFileSync(outFile, JSON.stringify({ report: null, events: [], error: String(e) }));
  console.log('error', e);
  process.exit(1);
});
