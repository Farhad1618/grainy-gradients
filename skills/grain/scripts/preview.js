// Grain preview runtime. Bundled after look.js and the grain.js engine into
// dist/grain-page.js by build.mjs; runs only when the page URL has ?grain.
//
//   <script src="/js/grain-page.js" data-grain=".hero | .footer-band | body::after" defer></script>
//
// One or more backgrounds, separated by "|". The same tag can go in a shared layout: each
// page previews the ones it has. For each background it waits for the element (React/Vue
// pages render late), looks at it, measures every option, and lays the grain over it as a
// temporary layer. A draggable handle splits before and after. Picks are kept across pages
// (localStorage), and "Copy picks" copies them all for Claude to turn into CSS.
// Uses: grainLook (look.js), analyse + previewConfig + SCREEN_QUERIES (grain.js), CALIBRATION, SELECTOR.

const hostOf = sel => sel.split(/(?=::)/)[0];
const waitFor = (sel, ms = 8000) => new Promise(res => {
  const find = () => document.querySelector(hostOf(sel));
  const hit = find(); if (hit) return res(hit);
  const mo = new MutationObserver(() => { const el = find(); if (el) { mo.disconnect(); res(el); } });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => { mo.disconnect(); res(null); }, ms);
});

const PICKS_KEY = 'grain-preview:picks';
const loadPicks = () => { try { return JSON.parse(localStorage.getItem(PICKS_KEY) || '{}'); } catch { return {}; } };
const savePicks = p => { try { localStorage.setItem(PICKS_KEY, JSON.stringify(p)); } catch {} };

async function startPreview() {
  const SELECTORS = SELECTOR.split('|').map(s => s.trim()).filter(Boolean);
  const ORDER = ['none', 'subtle', 'medium', 'strong', 'even'];
  const LABEL = { none: 'None', subtle: 'Subtle', medium: 'Medium', strong: 'Strong', even: 'Even' };
  const SCREEN_LABEL = { sdr: 'Standard screen', hdr: 'HDR / OLED screen', contrast: 'High-contrast setting' };
  const myScreen = matchMedia(SCREEN_QUERIES.contrast).matches ? 'contrast' : matchMedia(SCREEN_QUERIES.hdr).matches ? 'hdr' : 'sdr';
  const VIEW_KEY = 'grain-preview:view:' + location.pathname;
  let view = { split: 50, current: 0, screen: myScreen };
  try { Object.assign(view, JSON.parse(sessionStorage.getItem(VIEW_KEY) || '{}')); } catch {}
  const saveView = () => { try { sessionStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch {} };
  const picks = loadPicks();
  const pickKey = sel => `${location.pathname} ${sel}`;

  const css = document.createElement('style');
  css.textContent = `
    .gp-layer { pointer-events: none; }
    .gp-bar { position: fixed; top: 0; bottom: 0; width: 2px; margin-left: -1px; z-index: 2147483646; background: rgba(255,255,255,.7); mix-blend-mode: difference; pointer-events: none; }
    .gp-knob { position: fixed; top: 50%; width: 44px; height: 44px; margin: -22px 0 0 -22px; z-index: 2147483647; border-radius: 50%; border: 0;
      background: #f2efe9; color: #1a1c1d; font: 600 15px/1 system-ui, sans-serif; cursor: ew-resize; touch-action: none; box-shadow: 0 2px 12px rgba(0,0,0,.45); }
    .gp-tag { position: fixed; top: 12px; z-index: 2147483646; padding: 3px 9px; border-radius: 999px; pointer-events: none;
      background: rgba(0,0,0,.6); color: #fff; font: 500 11px/1.4 ui-monospace, monospace; letter-spacing: .05em; }
    .gp-panel { position: fixed; left: 16px; bottom: 16px; z-index: 2147483647; width: min(340px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto; padding: 12px; border-radius: 12px;
      background: rgba(18,19,20,.95); color: #eee; border: 1px solid rgba(255,255,255,.14); font: 13px/1.4 system-ui, sans-serif; backdrop-filter: blur(8px); }
    .gp-panel h4 { margin: 0 0 8px; font: 600 11px/1 ui-monospace, monospace; letter-spacing: .08em; text-transform: uppercase; color: #e57a3c; display: flex; justify-content: space-between; }
    .gp-panel h4 button { all: unset; cursor: pointer; color: #aaa; }
    .gp-nav { display: flex; align-items: center; gap: 6px; margin: 0 0 8px; font: 11px/1.3 ui-monospace, monospace; color: #ccc; }
    .gp-nav span { flex: 1; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
    .gp-nav button { font: inherit; padding: 4px 9px; border-radius: 6px; border: 1px solid #444; background: #232526; color: #eee; cursor: pointer; }
    .gp-opts { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 3px; padding: 3px; border-radius: 9px; background: #2a2c2d; margin-bottom: 8px; }
    .gp-opts button { font: inherit; font-size: 12px; padding: 7px 0; border-radius: 7px; border: 0; background: none; color: #ccc; cursor: pointer; position: relative; }
    .gp-opts button[aria-pressed=true] { background: #e57a3c; color: #141617; font-weight: 600; }
    .gp-opts button.rec::after { content: "★"; position: absolute; top: 1px; right: 4px; font-size: 9px; }
    .gp-read { margin: 0 0 8px; font: 11px/1.5 ui-monospace, monospace; color: #bbb; }
    .gp-screen { display: flex; gap: 6px; align-items: center; margin: 0 0 8px; font: 11px/1.3 ui-monospace, monospace; color: #999; }
    .gp-screen select { flex: 1; font: inherit; color: #eee; background: #232526; border: 1px solid #444; border-radius: 6px; padding: 3px; }
    .gp-panel details { margin: 0 0 8px; font: 11px/1.5 ui-monospace, monospace; color: #999; }
    .gp-panel details pre { white-space: pre-wrap; margin: 6px 0 0; font: inherit; }
    .gp-row { display: flex; gap: 6px; }
    .gp-row button { flex: 1; font: inherit; font-size: 12px; padding: 8px; border-radius: 8px; border: 1px solid #444; background: #232526; color: #eee; cursor: pointer; }
    .gp-row .gp-use { background: #f2efe9; color: #141617; border: 0; font-weight: 600; }
    .gp-panel.gp-min > :not(h4) { display: none; }
    .gp-wait { font: 11px/1.5 ui-monospace, monospace; color: #999; margin: 0; }
  `;
  document.head.append(css);

  const el = (tag, cls, html) => Object.assign(document.createElement(tag), { className: cls, innerHTML: html || '' });
  const bar = el('div', 'gp-bar');
  const knob = el('button', 'gp-knob', '⇔'); knob.type = 'button'; knob.setAttribute('aria-label', 'Drag to compare');
  const tagB = el('div', 'gp-tag', 'BEFORE');
  const tagA = el('div', 'gp-tag', 'AFTER');
  const panel = el('div', 'gp-panel', `<h4><span>Grain preview</span></h4><p class="gp-wait">Looking at ${SELECTORS.length} background${SELECTORS.length > 1 ? 's' : ''}…</p>`);
  document.body.append(bar, tagB, tagA, knob, panel);

  // ---- One target per background found on this page.
  const targets = [];
  const failed = []; // [selector, reason] for backgrounds on the page that couldn't be measured
  const opacityOf = t => { const h = document.querySelector(hostOf(t.sel)); return h ? parseFloat(getComputedStyle(h, t.pseudo).opacity) : 0; };

  const place = t => {
    if (t.layer.isConnected) return;
    const target = document.querySelector(hostOf(t.sel));
    if (!target) return;
    if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
    target.style.isolation = 'isolate';
    const media = t.look.coveringMedia && [...target.querySelectorAll('img, video')].find(m => m.getBoundingClientRect().width >= target.getBoundingClientRect().width * 0.9);
    if (media) {
      // Over a photo or video: right after it, so it paints above it and under what follows.
      Object.assign(t.layer.style, { position: 'absolute', inset: '0', zIndex: '' });
      media.after(t.layer);
    } else if (!t.pseudo) {
      Object.assign(t.layer.style, { position: 'absolute', inset: '0', zIndex: '-1' });
      target.prepend(t.layer);
    } else {
      // A pseudo-element can't take a child. The layer copies its box on the host, and the
      // pseudo-element is moved one step back so the layer sits right above it.
      const ps = getComputedStyle(target, t.pseudo);
      const z = parseInt(ps.zIndex, 10) || 0;
      const id = 'gp-back-' + SELECTORS.indexOf(t.sel);
      if (!document.getElementById(id)) document.head.append(Object.assign(document.createElement('style'), { id, textContent: `${t.sel} { z-index: ${z - 1} !important; }` }));
      Object.assign(t.layer.style, { position: ps.position === 'fixed' ? 'fixed' : 'absolute', top: ps.top, right: ps.right, bottom: ps.bottom, left: ps.left, zIndex: String(z) });
      target.append(t.layer);
    }
  };

  const optionOf = t => picks[pickKey(t.sel)]?.option ?? t.C.recommended;
  const opacityFor = (p, screen) => p.screens?.[screen]?.opacity ?? p.screens?.sdr?.opacity ?? p.opacity;
  const grainFor = (p, screen) => p.screens?.[screen]?.grain ?? p.screens?.sdr?.grain ?? p.grain;
  const paint = t => {
    let o = optionOf(t);
    if (o !== 'none' && !t.C.options[o]) o = t.C.recommended;
    if (o === 'none') { t.layer.style.display = 'none'; return; }
    const p = t.C.options[o];
    Object.assign(t.layer.style, { display: '', backgroundImage: t.C.noise, backgroundSize: `${t.C.tile}px ${t.C.tile}px`, opacity: opacityFor(p, view.screen), mixBlendMode: p.blend });
  };
  const record = (t, option) => { picks[pickKey(t.sel)] = { option, look: { ...t.look, page: location.pathname } }; savePicks(picks); };

  const describe = t => {
    const o = optionOf(t);
    if (o === 'none') return 'No grain.';
    const p = t.C.options[o];
    if (p.unreachable) return `${p.blend} at ${p.opacity} · only ${p.grain.toFixed(2)} L*: these colours barely take grain`;
    const ev = `${p.evenness < 0.5 ? 'uneven' : 'even'}: faint parts get ${Math.round(p.evenness * 100)}% as much`;
    return `${p.blend} at ${opacityFor(p, view.screen)} · ${grainFor(p, view.screen).toFixed(2)} L* of grain<br>${ev}${o === t.C.recommended ? ' · recommended' : ''}`;
  };

  const current = () => targets[Math.min(view.current, targets.length - 1)];
  const buildPanel = () => {
    const t = current();
    const fails = failed.length ? `<p class="gp-wait">${failed.map(([s, w]) => `Couldn't measure ${s}: ${w}`.replace(/</g, '&lt;')).join('<br>')}</p>` : '';
    if (!t) { panel.innerHTML = `<h4><span>Grain preview</span></h4>${fails || `<p class="gp-wait">None of these backgrounds are on this page: ${SELECTORS.join(', ')}</p>`}`; return; }
    const opts = ORDER.filter(o => o === 'none' || t.C.options[o]);
    const total = new Set([...Object.keys(picks), ...targets.map(x => pickKey(x.sel))]).size;
    panel.innerHTML = `
      <h4><span>Grain preview</span><span><button type="button" data-a="clear" title="Forget all picks">↺</button> <button type="button" data-a="min" title="Hide">–</button></span></h4>
      ${targets.length > 1 ? `<div class="gp-nav"><button type="button" data-a="prev" aria-label="Previous background">◀</button><span data-a="go" title="Scroll to it">${targets.indexOf(t) + 1} of ${targets.length} · ${t.sel}</span><button type="button" data-a="next" aria-label="Next background">▶</button></div>` : ''}
      <div class="gp-opts">${opts.map(o => `<button type="button" data-o="${o}" class="${o === t.C.recommended ? 'rec' : ''}" title="${o === t.C.recommended ? 'Recommended' : ''}">${LABEL[o]}</button>`).join('')}</div>
      <p class="gp-read"></p>
      <label class="gp-screen">Screen <select data-a="screen">${Object.keys(SCREEN_LABEL).map(s => `<option value="${s}"${s === view.screen ? ' selected' : ''}>${SCREEN_LABEL[s]}${s === myScreen ? ' (yours)' : ''}</option>`).join('')}</select></label>
      ${fails}
      <details><summary>Why</summary><pre>${t.C.report.replace(/</g, '&lt;')}</pre></details>
      <div class="gp-row"><button type="button" data-a="full">${view.split === 0 ? 'Split' : 'Full screen'}</button><button type="button" class="gp-use" data-a="use">${total > 1 ? `Copy picks (${total})` : 'Use this one'}</button></div>`;
  };
  const render = () => {
    targets.forEach(paint);
    const t = current(); if (!t) return;
    const o = optionOf(t);
    panel.querySelectorAll('[data-o]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.o === o)));
    const read = panel.querySelector('.gp-read'); if (read) read.innerHTML = describe(t);
    position(); saveView();
  };

  const position = () => {
    const x = view.split * innerWidth / 100;
    let anyOnScreen = false;
    for (const t of targets) {
      const r = t.layer.getBoundingClientRect();
      t.layer.style.clipPath = `inset(0 0 0 ${Math.max(0, x - r.left)}px)`;
      if (r.bottom > 0 && r.top < innerHeight && r.width > 0 && opacityOf(t) > 0.05 && t.layer.style.display !== 'none') anyOnScreen = true;
    }
    bar.style.left = knob.style.left = `${x}px`;
    tagB.style.left = `${x - 78}px`; tagA.style.left = `${x + 12}px`;
    bar.hidden = knob.hidden = !anyOnScreen;
    tagB.hidden = !anyOnScreen || view.split < 8; tagA.hidden = !anyOnScreen || view.split > 92;
  };

  // Motion: when a background turns out to fade in while the person scrolls, re-measure it.
  const watchMotion = () => {
    for (const t of targets) {
      if (t.sawFade) continue;
      const o = opacityOf(t); t.minO = Math.min(t.minO, o); t.maxO = Math.max(t.maxO, o);
      if (t.maxO - t.minO > 0.2) {
        t.sawFade = true;
        t.look = { ...t.look, moves: { fade: { from: +t.minO.toFixed(2), to: +t.maxO.toFixed(2) } } };
        t.C = previewConfig(analyse(t.look, CALIBRATION));
        if (picks[pickKey(t.sel)]) record(t, picks[pickKey(t.sel)].option);
        if (t === current()) buildPanel();
        render();
      }
    }
  };

  const copyText = () => {
    // Everything picked so far on any page, plus this page's backgrounds at their current option.
    for (const t of targets) if (!picks[pickKey(t.sel)]) record(t, t.C.recommended);
    return Object.values(picks).map(p => `grain: ${p.option}\n${JSON.stringify(p.look)}`).join('\n');
  };

  panel.addEventListener('click', e => {
    const b = e.target.closest('button, [data-a=go]'); if (!b) return;
    const t = current();
    if (b.dataset.o) { record(t, b.dataset.o); buildPanel(); render(); }
    const a = b.dataset.a;
    if (a === 'clear') { for (const k of Object.keys(picks)) delete picks[k]; savePicks(picks); buildPanel(); render(); }
    if (a === 'min') { panel.classList.toggle('gp-min'); b.textContent = panel.classList.contains('gp-min') ? '+' : '–'; }
    if (a === 'full') { view.split = view.split === 0 ? 50 : 0; buildPanel(); render(); }
    if (a === 'prev' || a === 'next' || a === 'go') {
      if (a !== 'go') view.current = (view.current + (a === 'next' ? 1 : -1) + targets.length) % targets.length;
      current().layer.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      buildPanel(); render();
    }
    if (a === 'use') {
      const text = copyText();
      const label = b.textContent;
      const done = () => { b.textContent = 'Copied, paste it to Claude'; setTimeout(() => { b.textContent = label; }, 2500); };
      (navigator.clipboard?.writeText(text) || Promise.reject()).then(done, () => { prompt('Copy this and paste it to Claude:', text); });
    }
  });
  panel.addEventListener('change', e => {
    if (e.target.dataset.a === 'screen') { view.screen = e.target.value; render(); }
  });
  knob.addEventListener('pointerdown', e => {
    knob.setPointerCapture(e.pointerId);
    const move = ev => { view.split = Math.max(0, Math.min(100, ev.clientX / innerWidth * 100)); position(); };
    const up = () => { knob.removeEventListener('pointermove', move); knob.removeEventListener('pointerup', up); saveView(); };
    knob.addEventListener('pointermove', move); knob.addEventListener('pointerup', up);
  });
  addEventListener('scroll', () => { position(); watchMotion(); }, { passive: true });
  addEventListener('resize', position);
  setInterval(() => { position(); watchMotion(); }, 250); // page scripts may animate after the scroll event
  // Frameworks may re-render and drop a layer: put it back.
  new MutationObserver(() => targets.forEach(t => { if (!t.layer.isConnected) place(t); })).observe(document.body, { childList: true, subtree: true });

  // ---- Find and measure each background as it appears.
  await Promise.all(SELECTORS.map(async sel => {
    const host = await waitFor(sel);
    if (!host) return;
    const [, pseudo = null] = sel.split(/(?=::)/);
    try {
      // Don't scroll the page on load; motion is picked up while the person scrolls.
      const look = await grainLook(sel, { watch: false, scroll: false });
      const t = { sel, pseudo, look, C: previewConfig(analyse(look, CALIBRATION)), layer: el('div', 'gp-layer'), sawFade: false };
      t.layer.setAttribute('aria-hidden', 'true');
      t.minO = t.maxO = opacityOf(t);
      targets.push(t);
      targets.sort((a, b) => SELECTORS.indexOf(a.sel) - SELECTORS.indexOf(b.sel));
      place(t); buildPanel(); render();
    } catch (err) {
      const why = String(err.message || err).replace(/^The look has no colours \(kind: photo\)\. /, '');
      failed.push([sel, why]); buildPanel();
      console.warn(`[grain preview] ${sel}: ${err.message || err}`);
    }
  }));
  buildPanel(); render();
}
