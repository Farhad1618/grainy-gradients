// Minimal headless Chrome driver over the DevTools protocol. No dependencies: it uses the
// Chrome (or Chromium, Edge, Brave) already on the machine and Node's built-in WebSocket.
//
//   const b = await launch({ width: 1440, height: 900, dpr: 2 });
//   await b.open('http://localhost:3000/');
//   const v = await b.eval('document.title');
//   const png = await b.shot({ x, y, width, height });   // Buffer
//   await b.close();
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge'],
  win32: [
    `${process.env['PROGRAMFILES'] || 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['LOCALAPPDATA'] || ''}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ],
};

export function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const hit = (CANDIDATES[process.platform] || []).find(p => p && existsSync(p));
  if (!hit) throw new Error('No Chrome, Chromium, Edge or Brave found. Install one, or set CHROME_PATH to its executable.');
  return hit;
}

export async function launch({ width = 1440, height = 900, dpr = 2, timeout = 30000 } = {}) {
  if (typeof WebSocket === 'undefined') throw new Error(`Node ${process.version} has no built-in WebSocket; use Node 22 or newer.`);
  const profile = mkdtempSync(join(tmpdir(), 'grain-chrome-'));
  const proc = spawn(findChrome(), [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--force-color-profile=srgb', `--window-size=${width},${height}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const wsUrl = await new Promise((res, rej) => {
    let buf = '';
    const t = setTimeout(() => rej(new Error('Chrome did not start in time')), timeout);
    proc.stderr.on('data', d => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); res(m[1]); } });
    proc.on('exit', code => { clearTimeout(t); rej(new Error(`Chrome exited (${code}): ${buf.slice(-400)}`)); });
  });

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('Could not connect to Chrome')); });
  let id = 0; const pending = new Map(); const listeners = [];
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? rej(new Error(`${msg.error.message}${msg.error.data ? ': ' + msg.error.data : ''}`)) : res(msg.result);
    } else if (msg.method) listeners.forEach(l => l(msg));
  };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  await s('Page.enable'); await s('Runtime.enable'); await s('Log.enable');
  // Pages with a strict Content-Security-Policy still let us run the grain scripts.
  await s('Page.setBypassCSP', { enabled: true });
  await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: width < 768 });

  const errors = [];
  listeners.push(m => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description?.split('\n')[0] || m.params.exceptionDetails?.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(`${m.params.entry.text}${m.params.entry.url ? ' (' + m.params.entry.url + ')' : ''}`.slice(0, 300));
  });
  const waitFor = (method, ms) => new Promise(res => {
    const t = setTimeout(() => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); res(null); }, ms);
    const f = m => { if (m.sessionId === sessionId && m.method === method) { clearTimeout(t); listeners.splice(listeners.indexOf(f), 1); res(m); } };
    listeners.push(f);
  });

  const api = {
    width, height, dpr, errors,
    send: s,
    async open(url, { settle = 800, wait = 20000 } = {}) {
      errors.length = 0;
      const loaded = waitFor('Page.loadEventFired', wait);
      const r = await s('Page.navigate', { url });
      if (r.errorText) throw new Error(`Could not open ${url}: ${r.errorText}`);
      await loaded;
      await api.eval('document.fonts ? document.fonts.ready.then(() => 1) : 1');
      await new Promise(res => setTimeout(res, settle));
    },
    async eval(expression) {
      const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] || r.exceptionDetails.text);
      return r.result.value;
    },
    async media(features = []) { await s('Emulation.setEmulatedMedia', { features }); },
    async shot(clip) {
      const p = { format: 'png', captureBeyondViewport: false };
      if (clip) p.clip = { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 1 };
      const { data } = await s('Page.captureScreenshot', p);
      return Buffer.from(data, 'base64');
    },
    async html(markup) { // load markup into the page (for composites)
      await api.open('about:blank', { settle: 0 });
      await api.eval(`document.open(); document.write(${JSON.stringify(markup)}); document.close(); Promise.all([...document.images].map(i => i.decode().catch(() => 0))).then(() => 1)`);
    },
    async close() {
      try { await Promise.race([send('Browser.close'), new Promise(r => setTimeout(r, 1500))]); } catch {}
      try { ws.close(); } catch {}
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} }, 300);
    },
  };
  return api;
}
