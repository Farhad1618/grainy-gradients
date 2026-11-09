// Grain bench: compare grain options on several backgrounds and record which looks best.
// Picks are saved in this browser and can be downloaded as picks.json; their numbers
// feed skills/grainy-gradients/calibration.json.
import { recommend, measure, lightness, parseColour, toneOf, banding, DITHER_MIN, svgUrl, noiseSvg } from '../skills/grainy-gradients/scripts/grain.js';

const PICKS_KEY = 'grain-bench-picks';
const STATE_KEY = 'grain-bench-state';

const QUOTE_STOPS = [
  ['#323435', 0], ['#2f3132', 6], ['#2d2f30', 13], ['#2a2c2d', 24], ['#27292a', 35], ['#222425', 50],
  ['#202122', 60], ['#1d1f20', 69], ['#1a1c1d', 78], ['#181a1b', 87], ['#161819', 93], ['#141617', 100],
];
const BACKGROUNDS = [
  { id: 'dark', label: 'Dark', kind: 'gradient', angle: 180, stops: QUOTE_STOPS },
  { id: 'mid', label: 'Mid', kind: 'gradient', angle: 160, stops: [['#5b7896', 0], ['#34506d', 100]] },
  { id: 'light', label: 'Light', kind: 'gradient', angle: 180, stops: [['#f7f2e8', 0], ['#e4d9c6', 100]] },
  { id: 'vivid', label: 'Vivid', kind: 'gradient', angle: 135, stops: [['#0f766e', 0], ['#f97316', 65], ['#fdba74', 100]] },
  { id: 'photo-dark', label: 'Photo dusk', kind: 'photo', src: 'photos/dusk.jpg' },
  { id: 'photo-bright', label: 'Photo day', kind: 'photo', src: 'photos/bright.jpg' },
];
const OPTIONS = [
  { id: 'none', label: 'None' },
  { id: 'video', label: 'Video' },
  { id: 'subtle', label: 'Subtle' },
  { id: 'medium', label: 'Medium' },
  { id: 'strong', label: 'Strong' },
];
// The snippet from the video: classic noise (not centred, half transparent), overlay at 0.15.
const VIDEO = { blend: 'overlay', opacity: 0.15, freq: 0.8, octaves: 4, tile: 200 };
const videoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="${VIDEO.freq}" numOctaves="${VIDEO.octaves}" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`;

const $ = id => document.getElementById(id);
const calibration = await fetch('../skills/grainy-gradients/calibration.json').then(r => r.json());

let state = { bg: 'dark', option: 'medium', split: 50 };
try { Object.assign(state, JSON.parse(localStorage.getItem(STATE_KEY) || '{}')); } catch {}
let picks = [];
try { picks = JSON.parse(localStorage.getItem(PICKS_KEY) || '[]'); } catch {}
const saveState = () => { try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch {} };
const savePicks = () => { try { localStorage.setItem(PICKS_KEY, JSON.stringify(picks)); } catch {} };

// ---- Helpers --------------------------------------------------------------
const loadImage = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

// Colours seen on screen for a photo shown with background-size: cover.
const photoColours = async src => {
  const img = await loadImage(src);
  const w = 8, h = Math.max(4, Math.round(w * innerHeight / innerWidth));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale, dh = img.height * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  const d = ctx.getImageData(0, 0, w, h).data, out = [];
  for (let p = 0; p < d.length; p += 4) out.push([d[p], d[p + 1], d[p + 2]]);
  return out;
};

// Classic noise as the browser draws it, for measuring the video recipe.
let videoNoise = null;
const getVideoNoise = async () => {
  if (videoNoise) return videoNoise;
  const img = await loadImage(`data:image/svg+xml,${encodeURIComponent(videoSvg)}`);
  const cv = document.createElement('canvas'); cv.width = cv.height = 200;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, 200, 200).data, n = 3000, step = 40000 / n;
  const v = new Float32Array(n), a = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = Math.floor(i * step) * 4; v[i] = d[p] / 255; a[i] = d[p + 3] / 255; }
  return (videoNoise = { v, a });
};

const gradientCss = bg => `linear-gradient(${bg.angle}deg, ${bg.stops.map(([c, p]) => `${c} ${p}%`).join(', ')})`;
const gradientLength = angle => {
  const r = angle * Math.PI / 180;
  return Math.abs(innerWidth * Math.sin(r)) + Math.abs(innerHeight * Math.cos(r));
};

// ---- Per-background results (cached) ----------------------------------------
const cache = new Map();
const analyse = async bg => {
  if (cache.has(bg.id)) return cache.get(bg.id);
  const colours = bg.kind === 'photo' ? await photoColours(bg.src) : bg.stops.map(([c, p]) => ({ colour: c, pos: p / 100 }));
  const flat = colours.map(c => c.colour || c);
  const lengthPx = bg.kind === 'gradient' ? gradientLength(bg.angle) : 0;
  const L = flat.reduce((t, c) => t + lightness(parseColour(c)), 0) / flat.length;
  const results = {};
  for (const level of ['subtle', 'medium', 'strong']) {
    results[level] = recommend({ colours, kind: bg.kind, lengthPx, level, calibration, sampleSize: bg.kind === 'photo' ? 800 : 3000 });
  }
  const vm = measure(await getVideoNoise(), flat, VIDEO.blend, VIDEO.opacity);
  results.video = { blend: VIDEO.blend, opacity: VIDEO.opacity, measured: vm };
  results.none = { blend: '—', opacity: 0, measured: { grain: 0, shift: 0, dither: 0 } };
  const out = {
    L, tone: toneOf(L), group: bg.kind === 'photo' ? 'photo' : 'gradient',
    band: bg.kind === 'gradient' ? banding(colours, lengthPx) : { risk: 'none', pxPerLevel: 0 },
    results,
  };
  cache.set(bg.id, out);
  return out;
};

// ---- Rendering ------------------------------------------------------------
const bgButtons = BACKGROUNDS.map(bg => {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = bg.label; b.dataset.id = bg.id;
  b.addEventListener('click', () => { state.bg = bg.id; render(); });
  $('bgs').append(b);
  return b;
});
const optButtons = OPTIONS.map((o, i) => {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = o.label; b.dataset.id = o.id; b.setAttribute('role', 'radio');
  b.title = `Key ${i + 1}`;
  b.addEventListener('click', () => { state.option = o.id; render(); });
  $('opts').append(b);
  return b;
});

const applySplit = () => {
  const x = state.split;
  $('noise').style.clipPath = `inset(0 0 0 ${x}%)`;
  $('bar').style.left = $('knob').style.left = `${x}%`;
  $('tagBefore').style.left = `calc(${x}% - 90px)`;
  $('tagAfter').style.left = `calc(${x}% + 14px)`;
  $('tagBefore').hidden = x < 8;
  $('tagAfter').hidden = x > 92;
};

const fmt = (v, d = 2) => (v >= 0 ? '+' : '') + v.toFixed(d);

let token = 0;
const render = async () => {
  const my = ++token;
  saveState();
  const bg = BACKGROUNDS.find(b => b.id === state.bg) || BACKGROUNDS[0];
  bgButtons.forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.id === bg.id));
    b.classList.toggle('done', picks.some(p => p.bg === b.dataset.id));
  });
  optButtons.forEach(b => b.setAttribute('aria-checked', String(b.dataset.id === state.option)));
  $('bg').style.backgroundImage = bg.kind === 'photo' ? `url("${bg.src}")` : gradientCss(bg);
  $('read').innerHTML = '<dt>Measuring…</dt><dd></dd>';

  const a = await analyse(bg);
  if (my !== token) return;
  document.body.classList.toggle('on-light', a.L > 60);
  const r = a.results[state.option];
  const n = $('noise');
  if (state.option === 'none') {
    n.style.backgroundImage = 'none';
  } else if (state.option === 'video') {
    n.style.backgroundImage = svgUrl(videoSvg);
    n.style.backgroundSize = '200px 200px';
    n.style.opacity = VIDEO.opacity;
    n.style.mixBlendMode = VIDEO.blend;
  } else {
    n.style.backgroundImage = svgUrl(noiseSvg({ ...r.settings, alpha: 1 }));
    n.style.backgroundSize = `${r.settings.tile}px ${r.settings.tile}px`;
    n.style.opacity = r.opacity;
    n.style.mixBlendMode = r.blend;
  }

  const m = r.measured;
  const bandTxt = a.band.risk === 'none' ? (bg.kind === 'photo' ? 'none (photo)' : 'none')
    : `<span class="${a.band.risk === 'high' ? 'hi' : ''}">${a.band.risk}</span>, ~${Math.round(a.band.pxPerLevel)}px per colour level`;
  const target = r.target != null ? ` (target ${r.target})` : '';
  $('read').innerHTML = `
    <dt>Background</dt><dd>${a.tone} ${a.group}, L* ${a.L.toFixed(1)}</dd>
    <dt>Banding risk</dt><dd>${bandTxt}</dd>
    <dt>Using</dt><dd>${state.option === 'none' ? 'no grain' : `${r.blend} at ${r.opacity}`}</dd>
    <dt>Visible grain</dt><dd>${m.grain.toFixed(2)} L*${target}</dd>
    <dt>Brightness</dt><dd>${fmt(m.shift)} L*</dd>
    <dt>Breaks banding</dt><dd>${state.option === 'none' ? '—' : m.dither >= DITHER_MIN ? '<span class="ok">yes</span>' : `<span class="hi">no</span> (${m.dither.toFixed(1)} of ${DITHER_MIN} levels)`}</dd>`;

  const current = picks.find(p => p.bg === bg.id);
  $('best').textContent = current?.option === state.option ? 'Saved as best ✓' : 'This one looks best';
  $('best').classList.toggle('saved', current?.option === state.option);
  $('progress').textContent = `${new Set(picks.map(p => p.bg)).size} of ${BACKGROUNDS.length} picked`;
  $('picks').innerHTML = picks.length
    ? picks.map(p => `<li>${p.bg}: ${p.option}${p.blend !== '—' ? ` (${p.blend} ${p.opacity}, grain ${p.grain})` : ''}</li>`).join('')
    : '<li>No picks yet.</li>';
  applySplit();
};

// ---- Actions --------------------------------------------------------------
const pickBest = async () => {
  const bg = BACKGROUNDS.find(b => b.id === state.bg);
  const a = await analyse(bg);
  const r = a.results[state.option];
  picks = picks.filter(p => p.bg !== bg.id);
  picks.push({
    bg: bg.id, group: a.group, tone: a.tone, L: +a.L.toFixed(1),
    option: state.option, blend: r.blend, opacity: r.opacity,
    grain: +r.measured.grain.toFixed(3), shift: +r.measured.shift.toFixed(3),
    banding: a.band.risk, viewport: `${innerWidth}x${innerHeight}@${devicePixelRatio}x`,
    at: new Date().toISOString(),
  });
  savePicks();
  render();
};
$('best').addEventListener('click', pickBest);
$('download').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(picks, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'picks.json' });
  a.click(); URL.revokeObjectURL(a.href);
});
$('copy').addEventListener('click', e => navigator.clipboard?.writeText(JSON.stringify(picks, null, 2)).then(() => {
  e.target.textContent = 'Copied'; setTimeout(() => { e.target.textContent = 'Copy'; }, 1200);
}));
$('clear').addEventListener('click', () => { if (confirm('Clear all picks?')) { picks = []; savePicks(); render(); } });

addEventListener('keydown', e => {
  if (e.target.closest('input, textarea')) return;
  const i = BACKGROUNDS.findIndex(b => b.id === state.bg);
  if (e.key === 'ArrowRight') { state.bg = BACKGROUNDS[(i + 1) % BACKGROUNDS.length].id; render(); }
  else if (e.key === 'ArrowLeft') { state.bg = BACKGROUNDS[(i - 1 + BACKGROUNDS.length) % BACKGROUNDS.length].id; render(); }
  else if (/^[1-5]$/.test(e.key)) { state.option = OPTIONS[+e.key - 1].id; render(); }
  else if (e.key.toLowerCase() === 'b') pickBest();
});

$('knob').addEventListener('pointerdown', e => {
  const k = $('knob');
  k.setPointerCapture(e.pointerId);
  const move = ev => { state.split = Math.max(0, Math.min(100, (ev.clientX / innerWidth) * 100)); applySplit(); };
  const up = () => { k.removeEventListener('pointermove', move); k.removeEventListener('pointerup', up); saveState(); };
  k.addEventListener('pointermove', move);
  k.addEventListener('pointerup', up);
});
addEventListener('resize', () => { cache.clear(); render(); });

render();
