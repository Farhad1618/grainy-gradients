// The review page: every background on one local page, each with a before/after slider,
// a zoom on the area that bands the most, the options as tabs and a Screen switch. The person
// picks and presses Done; the picks come straight back here and the CSS is printed. Nothing is
// added to their site.
//
//   node review.mjs --url http://localhost:3000/ --selector ".hero" --selector ".footer"
//                   [--url http://localhost:3000/about --selector ".band"] [--phone] [--port 4747] [--no-open]
//
// Each --url starts a page; the --selector flags after it belong to that page. Run it in the
// background: it exits when the person presses Done, printing the picks and the CSS.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { shoot } from './shoot.mjs';
import { analyse } from './grain.js';
import { LABEL } from './capture.mjs';

const argv = process.argv.slice(2);
const groups = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--url') groups.push({ url: argv[++i], selectors: [] });
  else if (argv[i] === '--selector') {
    if (!groups.length) { console.error('Put --url before its --selector flags.'); process.exit(1); }
    groups.at(-1).selectors.push(...argv[++i].split('|').map(s => s.trim()).filter(Boolean));
  }
}
if (!groups.length || groups.some(g => !g.selectors.length)) {
  console.error('Usage: node review.mjs --url <page> --selector <css> [--selector ...] [--url <page> --selector ...] [--phone] [--port 4747] [--no-open]');
  process.exit(1);
}
const opt = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const viewport = argv.includes('--phone') ? 'phone' : 'desktop';
const out = resolve(opt('out') || join(tmpdir(), `grain-review-${Date.now()}`));
mkdirSync(out, { recursive: true });
const calibration = JSON.parse(readFileSync(new URL('../calibration.json', import.meta.url), 'utf8'));

console.error(`Taking pictures of ${groups.reduce((n, g) => n + g.selectors.length, 0)} background(s)…`);
const items = [];
for (const g of groups) {
  const r = await shoot({ url: g.url, selectors: g.selectors, wanted: 'all', viewport, out: join(out, String(groups.indexOf(g))), screens: true });
  for (const it of r.results) items.push({ ...it, url: g.url });
}
const ok = items.filter(it => !it.error);
if (!ok.length) { console.error(items.map(it => `✗ ${it.selector}: ${it.error}`).join('\n')); process.exit(1); }

// What the page needs, with picture paths made relative to the served folder.
const rel = p => relative(out, p).split(sep).join('/');
const data = items.map((it, i) => it.error ? { i, selector: it.selector, url: it.url, error: it.error } : {
  i, selector: it.selector, url: it.url, page: new URL(it.url).pathname, recommended: it.recommended, report: it.report, notes: it.notes,
  before: rel(join(it.dir, 'before.png')),
  options: Object.fromEntries(Object.entries(it.pictures).map(([k, p]) => [k, { img: rel(join(it.dir, `${k.replace('@', '-')}.png`)), compare: rel(p.file), metrics: p.metrics,
    blend: it.results[k.split('@')[0]].blend, opacity: k.includes('@') ? it.results[k.split('@')[0]].screens[k.split('@')[1]].opacity : (it.results[k].screens?.sdr?.opacity ?? it.results[k].opacity) }])),
});

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Grain review</title>
<style>
:root{--bg:#0e0f11;--panel:#17181b;--line:#2a2c30;--fg:#eceae6;--mute:#9a9893;--acc:#e57a3c}
*{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,system-ui,"Segoe UI",sans-serif}
header{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:16px;justify-content:space-between;padding:14px 28px;background:rgba(14,15,17,.92);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
header h1{font-size:16px;margin:0;font-weight:600} header p{margin:0;color:var(--mute);font-size:13px}
button{font:inherit;cursor:pointer}
.done{background:var(--fg);color:#111;border:0;border-radius:999px;padding:10px 20px;font-weight:650}
main{max-width:1180px;margin:0 auto;padding:24px 20px 80px;display:grid;gap:28px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:18px}
.top{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:12px} .top b{font-size:17px} .top span{color:var(--mute);font-size:13px}
.view{position:relative;border-radius:10px;overflow:hidden;background:#000;user-select:none;touch-action:none;cursor:ew-resize}
.view .img{position:absolute;inset:0;background-repeat:no-repeat}
.view .after{clip-path:inset(0 0 0 50%)}
.view .bar{position:absolute;top:0;bottom:0;width:2px;margin-left:-1px;background:#fff;mix-blend-mode:difference;pointer-events:none}
.view .knob{position:absolute;top:50%;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;background:#f2efe9;color:#111;display:grid;place-items:center;font-weight:700;pointer-events:none;box-shadow:0 2px 10px rgba(0,0,0,.5)}
.tag{position:absolute;top:10px;padding:2px 9px;border-radius:999px;background:rgba(0,0,0,.6);font:600 11px/1.5 ui-monospace,Menlo,monospace;letter-spacing:.06em;pointer-events:none}
.row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:12px}
.tabs{display:flex;gap:3px;padding:3px;border-radius:10px;background:#232528}
.tabs button{border:0;background:none;color:#ccc;padding:7px 14px;border-radius:8px;position:relative}
.tabs button[aria-pressed=true]{background:var(--acc);color:#111;font-weight:650}
.tabs button.rec::after{content:"★";position:absolute;top:0;right:3px;font-size:9px}
.chip{border:1px solid var(--line);background:#1d1f22;color:var(--fg);border-radius:8px;padding:7px 12px}
.chip[aria-pressed=true]{border-color:var(--acc);color:var(--acc)}
select{font:inherit;background:#1d1f22;color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:6px 8px}
.facts{color:#d8d5cf;font-size:14px;margin-top:10px} .facts small{color:var(--mute)}
details{margin-top:10px;color:var(--mute);font-size:13px} pre{white-space:pre-wrap;font:12px/1.5 ui-monospace,Menlo,monospace;margin:8px 0 0}
.err{color:#f38b6b}
.sent{position:fixed;inset:0;display:none;place-items:center;background:rgba(14,15,17,.94);z-index:9;text-align:center;font-size:18px}
</style></head><body>
<header><div><h1>Grain review</h1><p>Drag across each picture. Zoom shows the area that bands the most. Pick an option on each, then press Done.</p></div><button class="done" id="done">Done, send my picks</button></header>
<main id="m"></main>
<div class="sent" id="sent"><div><b>Sent to Claude.</b><br><span style="color:#9a9893">You can close this tab.</span></div></div>
<script>
const DATA = ${JSON.stringify(data)};
const LABEL = ${JSON.stringify(LABEL)};
const SCREEN = { sdr: 'Standard screen', hdr: 'HDR / OLED screen', contrast: 'High-contrast setting' };
const picks = {};
const m = document.getElementById('m');
for (const d of DATA) {
  const card = document.createElement('section'); card.className = 'card'; m.append(card);
  if (d.error) { card.innerHTML = '<div class="top"><b>' + d.selector + '</b><span>' + d.page + '</span></div><p class="err">' + d.error + '</p>'; continue; }
  picks[d.i] = d.recommended;
  const base = Object.keys(d.options).filter(k => !k.includes('@'));
  const st = { opt: d.recommended, screen: 'sdr', zoom: false, split: 50 };
  card.innerHTML = '<div class="top"><b>' + d.selector + '</b><span>' + d.page + '</span></div>' +
    '<div class="view"><div class="img before"></div><div class="img after"></div><div class="bar"></div><div class="knob">⇔</div><span class="tag" style="left:10px">BEFORE</span><span class="tag" style="right:10px">AFTER</span></div>' +
    '<div class="row"><div class="tabs">' + ['none', ...base].map(o => '<button data-o="' + o + '" class="' + (o === d.recommended ? 'rec' : '') + '">' + LABEL[o] + '</button>').join('') + '</div>' +
    '<button class="chip" data-a="zoom">Zoom on banding</button>' +
    '<select data-a="screen">' + Object.keys(SCREEN).map(s => '<option value="' + s + '">' + SCREEN[s] + '</option>').join('') + '</select></div>' +
    '<div class="facts"></div>' + (d.notes.length ? '<p style="color:#9a9893;font-size:13px">' + d.notes.join(' ') + '</p>' : '') +
    '<details><summary>Why this is recommended</summary><pre></pre></details>';
  card.querySelector('pre').textContent = d.report;
  const view = card.querySelector('.view'), B = card.querySelector('.before'), A = card.querySelector('.after'), bar = card.querySelector('.bar'), knob = card.querySelector('.knob');
  const img = new Image(); img.src = d.before;
  const key = () => st.opt === 'none' ? null : (st.screen !== 'sdr' && d.options[st.opt + '@' + st.screen] ? st.opt + '@' + st.screen : st.opt);
  const draw = () => {
    const W = view.clientWidth, iw = img.naturalWidth || 1, ih = img.naturalHeight || 1, k = key();
    const det = (d.options[d.recommended] || Object.values(d.options)[0]).metrics.detail;
    let size, pos, H;
    if (st.zoom && det) { const s = W / det.w; H = Math.round(det.h * s); size = (iw * s) + 'px ' + (ih * s) + 'px'; pos = (-det.x * s) + 'px ' + (-det.y * s) + 'px'; }
    else { H = Math.round(W * ih / iw); size = '100% 100%'; pos = '0 0'; }
    view.style.height = H + 'px';
    for (const [el, src] of [[B, d.before], [A, k ? d.options[k].img : d.before]]) Object.assign(el.style, { backgroundImage: 'url(' + src + ')', backgroundSize: size, backgroundPosition: pos, imageRendering: st.zoom ? 'pixelated' : 'auto' });
    A.style.clipPath = 'inset(0 0 0 ' + st.split + '%)'; bar.style.left = knob.style.left = st.split + '%';
    card.querySelectorAll('[data-o]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.o === st.opt)));
    card.querySelector('[data-a=zoom]').setAttribute('aria-pressed', String(st.zoom));
    const sel = card.querySelector('select'); sel.disabled = st.opt === 'none' || !Object.keys(d.options).some(x => x.startsWith(st.opt + '@'));
    const f = card.querySelector('.facts');
    if (!k) f.innerHTML = 'No grain.';
    else { const o = d.options[k], mt = o.metrics; f.innerHTML = '<b>' + LABEL[st.opt] + '</b>' + (st.opt === d.recommended ? ' (recommended)' : '') + ' · ' + o.blend + ' at ' + o.opacity + ' · grain ' + mt.detailGrainBefore + ' → ' + mt.detailGrainAfter + ' L* · brightness ' + (mt.brightness >= 0 ? '+' : '') + mt.brightness + (mt.bandBefore >= 2 ? ' · stripes ' + mt.bandBefore + 'px → ' + mt.bandAfter + 'px' : '') + '<br><small>Your pick for this one: ' + LABEL[picks[d.i]] + '</small>'; }
  };
  img.onload = draw; addEventListener('resize', draw);
  card.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.o) { st.opt = b.dataset.o; picks[d.i] = st.opt; }
    if (b.dataset.a === 'zoom') st.zoom = !st.zoom;
    draw();
  });
  card.querySelector('select').addEventListener('change', e => { st.screen = e.target.value; draw(); });
  view.addEventListener('pointerdown', e => {
    view.setPointerCapture(e.pointerId);
    const move = ev => { const r = view.getBoundingClientRect(); st.split = Math.max(0, Math.min(100, (ev.clientX - r.left) / r.width * 100)); draw(); };
    move(e); view.onpointermove = move; view.onpointerup = () => { view.onpointermove = null; };
  });
}
document.getElementById('done').onclick = async () => {
  const r = await fetch('/done', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(picks) });
  if (r.ok) document.getElementById('sent').style.display = 'grid'; else alert('Could not send: ' + await r.text());
};
</script></body></html>`;

const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'POST' && u.pathname === '/done') {
    let body = ''; req.on('data', c => (body += c)); req.on('end', () => {
      try {
        const picks = JSON.parse(body);
        const lines = [], css = [];
        for (const d of data) {
          if (d.error) continue;
          const option = picks[d.i] || d.recommended, it = ok.find(x => x.selector === d.selector && x.url === d.url);
          lines.push(`grain: ${option}\n${JSON.stringify({ ...it.look, page: d.page })}`);
          if (option === 'none') { css.push(`/* ${d.selector} (${d.page}): no grain */`); continue; }
          const a = analyse(it.look, calibration), r = a.results[option];
          css.push(`/* ==== ${d.selector} (${d.page}) ==== */\n/* Grain (grain skill, ${option}): ${r.tone} ${it.look.kind}, ${r.blend} at ${r.screens?.sdr?.opacity ?? r.opacity}, ${r.measured.grain.toFixed(2)} L*; adapts to HDR and high-contrast screens, off in print. */\n${a.css[option]}`);
        }
        writeFileSync(join(out, 'picks.txt'), lines.join('\n') + '\n');
        writeFileSync(join(out, 'grain.css'), css.join('\n\n') + '\n');
        res.writeHead(200).end('ok');
        console.log(`Picks: ${data.filter(d => !d.error).map(d => `${d.selector} (${d.page}) → ${picks[d.i] || d.recommended}`).join(', ')}`);
        console.log(`Saved: ${join(out, 'picks.txt')} and ${join(out, 'grain.css')}`);
        console.log(`Baselines for check.mjs: ${ok.map(it => `${it.selector} (${new URL(it.url).pathname}) → ${it.dir}`).join('; ')}\n`);
        console.log(css.join('\n\n'));
        setTimeout(() => process.exit(0), 300);
      } catch (e) { res.writeHead(400).end(String(e.message || e)); }
    });
    return;
  }
  if (u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(page); }
  const file = resolve(out, '.' + decodeURIComponent(u.pathname));
  if (!file.startsWith(out) || !existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' }); res.end(readFileSync(file));
});
const port = +(opt('port') || 4747);
server.on('error', e => { if (e.code === 'EADDRINUSE') server.listen(0, '127.0.0.1'); else throw e; });
server.listen(port, '127.0.0.1', () => {});
server.on('listening', () => {
  const link = `http://localhost:${server.address().port}/`;
  console.error(`Review page: ${link}  (waiting for Done)`);
  if (!argv.includes('--no-open')) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', link] : [link];
    try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch {}
  }
});
