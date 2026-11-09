// Shared capture code for shoot, review and check: open a page in headless Chrome, look at
// each background with the grain engine, photograph it without and with each option, measure
// the pixels and draw a before/after picture with a magnified detail.
import { readFileSync } from 'node:fs';
import { launch } from './chrome.mjs';

const here = p => new URL(p, import.meta.url);
const CORE = () => readFileSync(here('../dist/grain-core.js'), 'utf8');
const PIXELS = readFileSync(here('./pixels.js'), 'utf8');
export const LABEL = { none: 'None', subtle: 'Subtle', medium: 'Medium', strong: 'Strong', even: 'Even' };
export const VIEWPORTS = { desktop: { width: 1440, height: 900, dpr: 2 }, phone: { width: 390, height: 844, dpr: 3 } };
const SETTLE = 1800; // ms to let scroll-driven effects and 3D scenes catch up
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const slug = s => s.replace(/::?/g, '-').replace(/[^\w-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'background';

export async function openBrowser(viewport = 'desktop') {
  return launch(typeof viewport === 'string' ? VIEWPORTS[viewport] : viewport);
}

/** Open the page and get the grain engine running in it. */
export async function openPage(b, url) {
  await b.open(url);
  await b.eval(CORE());
}

/** Stop animations and videos so every picture of a background shows the same moment. Run it
 *  after the page has settled at the background: frozen too early, scroll-driven fades stay
 *  at their first frame. */
export async function freeze(b) {
  await b.eval(`(() => {
    document.getElementById('grain-freeze')?.remove();
    document.head.append(Object.assign(document.createElement('style'), { id: 'grain-freeze',
      textContent: '*, *::before, *::after { animation-play-state: paused !important; transition: none !important; caret-color: transparent !important; }' }));
    document.querySelectorAll('video').forEach(v => { try { v.pause(); } catch {} });
    return 1;
  })()`);
}

/** Bring a background into view, make sure it's visible, and measure it with the engine. */
export async function lookAt(b, selector) {
  const res = await b.eval(`(async () => {
    const sel = ${JSON.stringify(selector)}, hostSel = sel.split(/(?=::)/)[0], pseudo = sel.split(/(?=::)/)[1] || null;
    // Wait for pages that render late (React, Vue): up to 10 seconds.
    let el = document.querySelector(hostSel);
    for (let i = 0; !el && i < 50; i++) { await new Promise(res => setTimeout(res, 200)); el = document.querySelector(hostSel); }
    if (!el) return { missing: true };
    const notes = [];
    let r = el.getBoundingClientRect();
    const top = scrollY + r.top + (r.height > innerHeight ? 0 : (r.height - innerHeight) / 2);
    window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
    await new Promise(res => setTimeout(res, ${SETTLE}));
    const cs = getComputedStyle(el, pseudo);
    if (parseFloat(cs.opacity) < 0.5 || cs.visibility === 'hidden') {
      document.head.append(Object.assign(document.createElement('style'), { id: 'grain-show', textContent: sel + ' { opacity: 1 !important; visibility: visible !important; transition: none !important; }' }));
      notes.push('It was faded out when the page loaded (it fades in as you scroll), so the pictures show it fully faded in.');
      await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    }
    const look = await __grain.look(sel, { watch: false, scroll: false });
    const a = __grain.analyse(look);
    (window.__ga ||= {})[sel] = a;
    const fixed = getComputedStyle(el, pseudo).position === 'fixed';
    r = fixed && pseudo ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight } : el.getBoundingClientRect();
    const x = Math.max(0, r.left), y = Math.max(0, r.top), x2 = Math.min(innerWidth, r.right), y2 = Math.min(innerHeight, r.bottom);
    const results = Object.fromEntries(Object.entries(a.results).map(([k, v]) => [k, { blend: v.blend, opacity: v.opacity, target: v.target, unreachable: v.unreachable, fallback: v.fallback, measured: v.measured, screens: v.screens, banding: v.banding, stages: v.stages }]));
    return { look, method: a.method, recommended: a.recommended, evenSame: a.evenSame, report: a.report, css: a.css, results, clip: { x, y, width: x2 - x, height: y2 - y, sx: scrollX, sy: scrollY }, notes };
  })()`);
  if (!res.missing) await freeze(b);
  if (res.missing) throw new Error(`No element matches ${selector} on this page.`);
  if (res.clip.width < 4 || res.clip.height < 4) throw new Error(`${selector} isn't on screen (size ${res.clip.width}×${res.clip.height}).`);
  return res;
}

/** Which options are worth showing (Even is left out when it's the same as Medium, Strong when it's the same as Medium). */
export function optionsFor(info, wanted = 'all') {
  let list = ['subtle', 'medium', 'strong', 'even'];
  if (info.evenSame) list = list.filter(o => o !== 'even');
  const m = info.results.medium, s = info.results.strong;
  if (m.unreachable && s.opacity === m.opacity && s.blend === m.blend) list = list.filter(o => o !== 'strong');
  if (wanted === 'recommended') return [info.recommended];
  if (wanted !== 'all') return String(wanted).split(',').map(o => o.trim()).filter(o => o === 'none' || list.includes(o));
  return list;
}

/** Photograph the background as it is, then with each option (and HDR / high-contrast variants). */
// Screenshot clips are in page coordinates: add the scroll position.
const pageClip = c => ({ x: c.x + (c.sx || 0), y: c.y + (c.sy || 0), width: c.width, height: c.height });

// Where every element on the page sits: applying grain must not move anything.
export const RECTS = `[...document.querySelectorAll('body *')].filter(e => !e.closest('#grain-shot-layer')).slice(0, 1500).map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })`;
export function moved(a, b) {
  if (a.length !== b.length) return a.length - b.length;
  let n = 0; for (let i = 0; i < a.length; i++) if (a[i].some((v, k) => Math.abs(v - b[i][k]) > 1)) n++;
  return n;
}

export async function shootOptions(b, selector, info, options, { screens = false } = {}) {
  const rectsBefore = await b.eval(RECTS);
  const shots = { before: await b.shot(pageClip(info.clip)) };
  const full = { before: await b.shot() };
  const take = async (opt, screen = 'sdr') => {
    await b.eval(`(__grain.apply(window.__ga[${JSON.stringify(selector)}], ${JSON.stringify(opt)}, ${JSON.stringify(screen)}), new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1)))))`);
    await sleep(120);
    return b.shot(pageClip(info.clip));
  };
  for (const opt of options) {
    if (opt === 'none') continue;
    shots[opt] = await take(opt);
    if (screens) for (const sc of ['hdr', 'contrast']) if (info.results[opt].screens?.[sc]) shots[`${opt}@${sc}`] = await take(opt, sc);
  }
  let layoutMoved = 0;
  if (options.includes(info.recommended)) {
    await take(info.recommended); full[info.recommended] = await b.shot();
    layoutMoved = moved(rectsBefore, await b.eval(RECTS));
  }
  await b.eval('(__grain.remove(), 1)');
  return { shots, full, layoutMoved, rectsBefore };
}

const dataUrl = buf => `data:image/png;base64,${buf.toString('base64')}`;

/** Measure before and after in the browser, and draw the comparison picture. */
export async function compare(b, { before, after, title, subtitle = '', dpr }) {
  const W = 1600, half = 780, detailCss = { w: 168, h: 104 };
  await b.html(`<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0d0e10"></body>`);
  await b.eval(PIXELS);
  const m = await b.eval(`(async () => {
    const P = grainPixels;
    const A = await P.load(${JSON.stringify(dataUrl(before))}), B = await P.load(${JSON.stringify(dataUrl(after))});
    const LA = P.lmap(A), LB = P.lmap(B);
    const ww = Math.min(A.w, Math.round(${detailCss.w} * ${dpr})), wh = Math.min(A.h, Math.round(${detailCss.h} * ${dpr}));
    const win = P.worstWindow(A, LA, ww, wh, { im: B, L: LB });
    const sa = P.stats(A, LA), sb = P.stats(B, LB), da = P.stats(A, LA, win), db = P.stats(B, LB, win);
    const [sA, sB] = P.stretch([A, B], win);
    return { w: A.w, h: A.h, win, sA, sB, grainBefore: sa.grain, grainAfter: sb.grain, meanBefore: sa.mean, meanAfter: sb.mean,
      detailGrainBefore: da.grain, detailGrainAfter: db.grain,
      bandBefore: P.band(A, win) / ${dpr}, bandAfter: P.band(B, win) / ${dpr} };
  })()`);
  const metrics = {
    grainAdded: +(Math.sqrt(Math.max(0, m.grainAfter ** 2 - m.grainBefore ** 2))).toFixed(2),
    detailGrainBefore: +m.detailGrainBefore.toFixed(2), detailGrainAfter: +m.detailGrainAfter.toFixed(2),
    grainBefore: +m.grainBefore.toFixed(2), grainAfter: +m.grainAfter.toFixed(2),
    brightness: +(m.meanAfter - m.meanBefore).toFixed(2),
    bandBefore: +m.bandBefore.toFixed(1), bandAfter: +m.bandAfter.toFixed(1),
    detail: m.win,
  };
  const scale = half / m.w, h1 = Math.round(m.h * scale);
  const dh = Math.round(half * m.win.h / m.win.w);
  const pane = (src, label, extra = '') => `<div style="position:relative;width:${half}px;height:${h1}px;overflow:hidden;border-radius:10px;background:#000">
      <img src="${src}" style="width:${half}px;height:${h1}px;display:block">
      ${extra}<span style="position:absolute;left:12px;top:12px;${TAG}">${label}</span></div>`;
  const box = `<div style="position:absolute;left:${m.win.x * scale}px;top:${m.win.y * scale}px;width:${m.win.w * scale}px;height:${m.win.h * scale}px;border:2px solid #e57a3c;border-radius:3px;box-sizing:border-box"></div>`;
  const zoom = (src, label) => `<div style="position:relative;width:${half}px;height:${dh}px;overflow:hidden;border-radius:10px;background:#000">
      <img src="${src}" style="position:absolute;image-rendering:pixelated;width:${m.w * half / m.win.w}px;height:${m.h * half / m.win.w}px;left:${-m.win.x * half / m.win.w}px;top:${-m.win.y * half / m.win.w}px">
      <span style="position:absolute;left:12px;top:12px;${TAG}">${label}</span></div>`;
  const flat = (src, label) => `<div style="position:relative;width:${half}px;height:${dh}px;overflow:hidden;border-radius:10px;background:#000">
      <img src="${src}" style="width:${half}px;height:${dh}px;image-rendering:pixelated;display:block">
      <span style="position:absolute;left:12px;top:12px;${TAG}">${label}</span></div>`;
  const fmt = v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
  const facts = [
    `grain in the box ${metrics.detailGrainBefore.toFixed(2)} → ${metrics.detailGrainAfter.toFixed(2)} L*`,
    `brightness ${fmt(metrics.brightness)} L*`,
    metrics.bandBefore >= 2 ? `flat stripes ${metrics.bandBefore}px → ${metrics.bandAfter}px wide` : null,
  ].filter(Boolean).join('  ·  ');
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0d0e10;font:15px/1.4 -apple-system,system-ui,Segoe UI,sans-serif;color:#eceae6">
    <div id="c" style="width:${W}px;padding:28px 0 30px;box-sizing:border-box">
      <div style="padding:0 ${(W - 2 * half - 20) / 2}px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px">
          <div style="font-weight:600;font-size:20px">${esc(title)}</div><div style="color:#9a9893;font-size:14px">${esc(subtitle)}</div></div>
        <div style="display:flex;gap:20px">${pane(dataUrl(before), 'BEFORE', box)}${pane(dataUrl(after), 'AFTER', box)}</div>
        <div style="margin:18px 0 10px;color:#9a9893;font-size:14px">Detail in the orange box, magnified ${(half / (m.win.w / dpr)).toFixed(1)}× (grain this fine disappears when a picture is scaled down)</div>
        <div style="display:flex;gap:20px">${zoom(dataUrl(before), 'BEFORE')}${zoom(dataUrl(after), 'AFTER')}</div>
        <div style="margin:18px 0 10px;color:#9a9893;font-size:14px">Same detail with the contrast stretched: before shows the 8-bit steps (banding) as stripes, after shows them broken into fine grain</div>
        <div style="display:flex;gap:20px">${flat(m.sA, 'BEFORE · STRETCHED')}${flat(m.sB, 'AFTER · STRETCHED')}</div>
        <div style="margin-top:16px;font-size:15px;color:#d8d5cf">${esc(facts)}</div>
      </div></div></body>`;
  await b.html(html);
  const rect = await b.eval(`(() => { const r = document.getElementById('c').getBoundingClientRect(); return { x: 0, y: 0, width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()`);
  await b.send('Emulation.setDeviceMetricsOverride', { width: W, height: Math.max(b.height, rect.height), deviceScaleFactor: 1, mobile: false });
  const png = await b.shot(rect);
  await b.send('Emulation.setDeviceMetricsOverride', { width: b.width, height: b.height, deviceScaleFactor: b.dpr, mobile: b.width < 768 });
  return { png, metrics };
}
const TAG = 'padding:3px 9px;border-radius:999px;background:rgba(0,0,0,.62);color:#fff;font:600 11px/1.4 ui-monospace,Menlo,monospace;letter-spacing:.06em';
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/** Compare two full-viewport pictures outside a rectangle: did anything else on the page change? */
export async function diffOutside(b, before, after, clip, dpr) {
  await b.html(`<!doctype html><meta charset="utf-8"><body></body>`);
  await b.eval(PIXELS);
  return b.eval(`(async () => {
    const A = await grainPixels.load(${JSON.stringify(dataUrl(before))}), B = await grainPixels.load(${JSON.stringify(dataUrl(after))});
    if (A.w !== B.w || A.h !== B.h) return { changed: 1, size: true };
    const c = ${JSON.stringify(clip)}, d = ${dpr}, x0 = c.x * d - 2, y0 = c.y * d - 2, x1 = (c.x + c.width) * d + 2, y1 = (c.y + c.height) * d + 2;
    let n = 0, diff = 0;
    for (let y = 0; y < A.h; y += 2) for (let x = 0; x < A.w; x += 2) {
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) continue;
      const i = (y * A.w + x) * 4; n++;
      if (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]) > 6) diff++;
    }
    return { changed: n ? diff / n : 0 };
  })()`);
}

/** A showcase picture: the page split down the middle (before | after), and under it the
 *  area that bands the most, zoomed with the contrast boosted so stripes vs grain is obvious. */
export async function card(b, { before, after, title, dpr }) {
  const W = 1600, PAD = 28, IW = W - 2 * PAD;
  await b.html(`<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0d0e10"></body>`);
  await b.eval(PIXELS);
  const m = await b.eval(`(async () => {
    const P = grainPixels;
    const A = await P.load(${JSON.stringify(dataUrl(before))}), B = await P.load(${JSON.stringify(dataUrl(after))});
    const LA = P.lmap(A), LB = P.lmap(B);
    const win = P.worstWindow(A, LA, Math.min(A.w, Math.round(300 * ${dpr})), Math.min(A.h, Math.round(110 * ${dpr})), { im: B, L: LB });
    const [sA, sB] = P.stretch([A, B], win);
    const da = P.stats(A, LA, win), db = P.stats(B, LB, win), sa = P.stats(A, LA), sb = P.stats(B, LB);
    return { w: A.w, h: A.h, win, sA, sB, g0: da.grain, g1: db.grain, shift: sb.mean - sa.mean, b0: P.band(A, win) / ${dpr}, b1: P.band(B, win) / ${dpr} };
  })()`);
  const H = Math.round(IW * m.h / m.w), half = (IW - 20) / 2, sh = Math.round(half * m.win.h / m.win.w);
  const pill = (t, side) => `<span style="position:absolute;bottom:22px;${side}:22px;padding:6px 14px;border-radius:999px;background:rgba(10,10,12,.62);color:#fff;font:600 13px/1 -apple-system,system-ui,sans-serif;letter-spacing:.08em;backdrop-filter:blur(6px)">${t}</span>`;
  const facts = [`stripes ${m.b0.toFixed(0)}px → ${m.b1.toFixed(1)}px wide`, `grain ${m.g0.toFixed(2)} → ${m.g1.toFixed(2)}`, `brightness ${m.shift >= 0 ? '+' : ''}${m.shift.toFixed(2)}`].join('   ·   ');
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0d0e10;color:#ecebe8;font:15px/1.4 -apple-system,system-ui,'Segoe UI',sans-serif">
  <div id="c" style="width:${W}px;padding:${PAD}px ${PAD}px 6px;box-sizing:border-box">
    <div style="position:relative;width:${IW}px;height:${H}px;overflow:hidden;border-radius:14px">
      <img src="${dataUrl(before)}" style="position:absolute;inset:0;width:100%;height:100%">
      <img src="${dataUrl(after)}" style="position:absolute;inset:0;width:100%;height:100%;clip-path:inset(0 0 0 50%)">
      <div style="position:absolute;top:0;bottom:0;left:50%;width:2px;margin-left:-1px;background:rgba(255,255,255,.85)"></div>
      ${pill('BEFORE', 'left')}${pill('AFTER', 'right')}
    </div>
    <div style="padding:20px 0 0;display:flex;gap:20px">
      ${[['BEFORE · ZOOMED, CONTRAST BOOSTED', m.sA], ['AFTER · ZOOMED, CONTRAST BOOSTED', m.sB]].map(([t, s]) => `<div style="position:relative;width:${half}px;height:${sh}px;overflow:hidden;border-radius:12px">
        <img src="${s}" style="width:100%;height:100%;image-rendering:pixelated;display:block">
        <span style="position:absolute;left:14px;top:14px;padding:5px 11px;border-radius:999px;background:rgba(10,10,12,.66);font:600 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.06em">${t}</span></div>`).join('')}
    </div>
    <div style="display:flex;justify-content:space-between;padding:18px 4px 22px;color:#a9a7a2">
      <span style="color:#ecebe8;font-weight:600">${esc(title)}</span><span>${esc(facts)}</span></div>
  </div></body>`;
  await b.html(html);
  const rect = await b.eval(`(() => { const r = document.getElementById('c').getBoundingClientRect(); return { x: 0, y: 0, width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()`);
  await b.send('Emulation.setDeviceMetricsOverride', { width: W, height: Math.max(b.height, rect.height), deviceScaleFactor: 1, mobile: false });
  const png = await b.shot(rect);
  await b.send('Emulation.setDeviceMetricsOverride', { width: b.width, height: b.height, deviceScaleFactor: b.dpr, mobile: b.width < 768 });
  return { png, metrics: { stripesBefore: +m.b0.toFixed(1), stripesAfter: +m.b1.toFixed(1), grainBefore: +m.g0.toFixed(2), grainAfter: +m.g1.toFixed(2), brightness: +m.shift.toFixed(2) } };
}
