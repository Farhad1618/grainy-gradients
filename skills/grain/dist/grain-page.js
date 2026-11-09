// grain-page.js: grain skill page script (built by scripts/build.mjs; don't edit by hand).
// Temporary: Claude adds it to preview grain options, then removes it.
//   <script src="/js/grain-page.js" data-grain=".hero | .footer-band" defer></script>
// Does nothing unless the page URL has ?grain.
(() => {
  if (!new URLSearchParams(location.search).has('grain')) return;
  const SCRIPT = document.currentScript;
  const SELECTOR = SCRIPT?.dataset.grain;
  if (!SELECTOR) { console.warn('[grain preview] add data-grain="<selector>" to the script tag'); return; }
  const CALIBRATION = {
  "about": "Visible-grain targets: the spread of L* (CIELAB lightness, 0-100), a perceptual scale, so the same number looks about the same on any colour. grain.js solves the blend and opacity that hit them. Below ~0.45 grain is invisible.",
  "grain": {
    "freq": 0.8,
    "octaves": 3,
    "tile": 200
  },
  "targets": {
    "gradient": {
      "dark": {
        "subtle": 0.5,
        "medium": 0.8,
        "strong": 1.4
      },
      "mid": {
        "subtle": 0.5,
        "medium": 0.8,
        "strong": 1.4
      },
      "light": {
        "subtle": 0.5,
        "medium": 0.8,
        "strong": 1.4
      }
    },
    "photo": {
      "dark": {
        "subtle": 0.5,
        "medium": 0.9,
        "strong": 1.6
      },
      "mid": {
        "subtle": 0.5,
        "medium": 0.9,
        "strong": 1.6
      },
      "light": {
        "subtle": 0.5,
        "medium": 0.9,
        "strong": 1.6
      }
    }
  },
  "confirmed": [
    {
      "group": "gradient",
      "tone": "dark",
      "L": 17.8,
      "picked": "even",
      "grain": 0.81,
      "note": "A production site's dark radial gradient fading in over off-white: 0.14 / 0.27 / 0.44 showed no visible difference, even Strong. At 0.5 / 0.8 / 1.4 the site owner picked Even (soft-light, 0.81 L*). Mid and light use the same targets because L* is perceptual; not yet confirmed by eye.",
      "date": "2026-11-08"
    }
  ],
  "picks": [],
  "screens": {
    "about": "Websites can't tell OLED from LCD; they can tell HDR screens (most OLED phones, XDR laptops) and the high-contrast setting. Targets above are for the reference screen the picks were made on. HDR screens show deep darks harder, so dark backgrounds get a little less grain there. High contrast gets less grain everywhere. Factors are a first guess, not confirmed by eye.",
    "reference": "sdr",
    "referenceNote": "Owner's picks were made on a standard-range P3 display (dynamic-range: high false), 2026-11-09.",
    "hdr": {
      "dark": 0.85,
      "mid": 0.92,
      "light": 1
    },
    "contrastMore": 0.7,
    "confirmed": false
  }
};
// look.js: inspect a background in the page. Defines window.grainLook(selector).
//
//   const look = await grainLook('.hero');        // or '.hero::after', 'body::before'
//
// Reads computed styles (CSS variables resolved), converts every colour through the
// browser itself (so oklch, color(), color-mix, hsl and names all work), measures the
// gradient, finds what's behind and on top, and scrolls through the element to see
// whether the background fades or changes. Puts the scroll position back afterwards.
(() => {
  if (window.grainLook) return;
  const splitTop = s => {
    const out = []; let depth = 0, cur = '';
    for (const ch of String(s || '')) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };
  const hex = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const over = (top, a, under) => top.map((v, k) => a * v + (1 - a) * under[k]);

  // Any CSS colour → { c: [r,g,b], a } by letting the browser paint it.
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const toRgba = str => {
    if (!str) return null;
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = '#010203';
    cx.fillStyle = str;
    if (cx.fillStyle === '#010203' && !/^#010203$/i.test(str.trim())) return null; // not a colour
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return { c: [d[0], d[1], d[2]], a: d[3] / 255 };
  };

  // A stop is "<colour> [pos] [pos]". Split the trailing positions off the colour.
  const POS = /\s+(-?[\d.]+)(%|px|em|rem|vw|vh|vmin|vmax|)$/;
  const parseStop = (text, lengthPx) => {
    let rest = text.trim(); const pos = [];
    for (let m; (m = rest.match(POS)) && !/\($/.test(rest.slice(0, m.index));) {
      const v = +m[1];
      pos.unshift(m[2] === '%' || m[2] === '' ? v / 100 : m[2] === 'px' ? (lengthPx ? v / lengthPx : null) : null);
      rest = rest.slice(0, m.index).trim();
    }
    const col = toRgba(rest);
    return col ? { rgba: col, pos } : null;
  };

  // Length of the gradient line (CSS Images spec), and the radius for radial gradients.
  const angleOf = head => {
    if (!head) return 180;
    let m = head.match(/(-?[\d.]+)(deg|turn|rad|grad)/);
    if (m) return m[2] === 'turn' ? m[1] * 360 : m[2] === 'rad' ? m[1] * 180 / Math.PI : m[2] === 'grad' ? m[1] * 0.9 : +m[1];
    m = head.match(/to\s+(.+)/); if (!m) return 180;
    const t = m[1];
    const v = /top/.test(t) ? -1 : /bottom/.test(t) ? 1 : 0, h = /left/.test(t) ? -1 : /right/.test(t) ? 1 : 0;
    return { v, h, corner: !!(v && h) };
  };
  const lineLength = (head, w, h) => {
    const a = angleOf(head);
    if (typeof a === 'object') {
      if (a.corner) return Math.round(2 * w * h / Math.hypot(w, h)); // corner directions
      return a.h ? w : h;
    }
    const r = a * Math.PI / 180;
    return Math.round(Math.abs(w * Math.sin(r)) + Math.abs(h * Math.cos(r)));
  };
  const radialLength = (head, w, h) => {
    const [size = '', at = '50% 50%'] = (head || '').split(/\s+at\s+/);
    const vals = [...size.matchAll(/([\d.]+)(%|px)/g)].map((m, i) => (m[2] === 'px' ? +m[1] : (+m[1] / 100) * (i === 0 ? w : h)));
    if (vals.length) return Math.round(Math.max(...vals));
    const p = at.trim().split(/\s+/).map((v, i) => (/%$/.test(v) ? parseFloat(v) / 100 * (i ? h : w) : /px$/.test(v) ? parseFloat(v) : { left: 0, top: 0, center: (i ? h : w) / 2, right: w, bottom: h }[v] ?? (i ? h : w) / 2));
    const [x, y] = [p[0] ?? w / 2, p[1] ?? h / 2];
    const dx = Math.max(x, w - x), dy = Math.max(y, h - y);
    if (/closest-side/.test(size)) return Math.round(Math.min(Math.min(x, w - x), Math.min(y, h - y)));
    if (/circle/.test(size)) return Math.round(Math.hypot(dx, dy));
    return Math.round(Math.max(dx, dy) * Math.SQRT2); // farthest-corner ellipse
  };

  const parseGradient = (layer, w, h) => {
    const m = layer.match(/^(repeating-)?(linear|radial|conic)-gradient\((.*)\)$/s);
    if (!m) return null;
    const parts = splitTop(m[3]);
    let head = null;
    if (!toRgba(parts[0].replace(POS, '').replace(POS, ''))) head = parts.shift();
    const type = m[2];
    const lengthPx = type === 'linear' ? lineLength(head, w, h) : type === 'radial' ? radialLength(head, w, h) : Math.max(w, h);
    const stops = [];
    for (const p of parts) {
      const s = parseStop(p, lengthPx);
      if (!s) continue;
      if (s.pos.length === 2) { stops.push({ rgba: s.rgba, pos: s.pos[0] }); stops.push({ rgba: s.rgba, pos: s.pos[1] }); }
      else stops.push({ rgba: s.rgba, pos: s.pos[0] ?? null });
    }
    // Missing positions: first 0, last 1, others spaced between their neighbours (CSS rule).
    if (stops.length) {
      if (stops[0].pos == null) stops[0].pos = 0;
      if (stops[stops.length - 1].pos == null) stops[stops.length - 1].pos = 1;
      for (let i = 1; i < stops.length; i++) {
        if (stops[i].pos != null) { stops[i].pos = Math.max(stops[i].pos, stops[i - 1].pos); continue; }
        let j = i; while (stops[j].pos == null) j++;
        const a = stops[i - 1].pos, b = stops[j].pos;
        for (let k = i; k < j; k++) stops[k].pos = a + (b - a) * (k - i + 1) / (j - i + 1);
      }
    }
    // Repeating gradients: the period is what bands, so scale the length to one period.
    const period = m[1] && stops.length ? stops[stops.length - 1].pos - stops[0].pos : 1;
    return { type, repeating: !!m[1], head, stops, lengthPx: Math.round(lengthPx * (period || 1)) };
  };

  const solid = s => { const c = toRgba(s); return c && c.a > 0.99 ? c : null; };
  const frame = () => new Promise(r => { const t = setTimeout(r, 60); requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(t); r(); })); });
  const jump = async y => { scrollTo({ top: y, behavior: 'instant' }); await frame(); return Math.abs(scrollY - Math.min(y, document.documentElement.scrollHeight - innerHeight)) < 4; };

  const samplePhoto = async (src, scrim) => {
    const img = new Image(); img.crossOrigin = 'anonymous'; img.src = src; await img.decode();
    const w = 8, h = 6, c = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = c.getContext('2d');
    const s = Math.max(w / img.width, h / img.height);
    ctx.drawImage(img, (w - img.width * s) / 2, (h - img.height * s) / 2, img.width * s, img.height * s);
    if (scrim) { ctx.fillStyle = scrim; ctx.fillRect(0, 0, w, h); } // gradient scrims on top of the photo
    const d = ctx.getImageData(0, 0, w, h).data, out = [];
    for (let i = 0; i < d.length; i += 4) out.push(hex([d[i], d[i + 1], d[i + 2]]));
    return out;
  };

  // watch: scroll through the element to detect fades (moves the page; restored after).
  // scroll: bring the element on screen first so what's behind and on top can be sampled.
  window.grainLook = async (selector, { watch = true, scroll = true } = {}) => {
    const [hostSel, pseudo = null] = selector.split(/(?=::)/);
    const el = document.querySelector(hostSel);
    if (!el) throw new Error(`No element for ${hostSel}`);
    const y0 = scrollY;
    const elTop = el.getBoundingClientRect().top + scrollY;
    if (scroll) await jump(Math.max(0, elTop + el.offsetHeight / 2 - innerHeight / 2));

    const cs = getComputedStyle(el, pseudo);
    const fixed = cs.position === 'fixed';
    const r0 = el.getBoundingClientRect();
    const rect = fixed && pseudo ? { left: 0, top: 0, width: innerWidth, height: innerHeight } : r0;
    const w = Math.round(rect.width), h = Math.round(Math.min(rect.height, fixed ? innerHeight : rect.height));
    const px = rect.left + rect.width / 2, py = Math.min(innerHeight - 1, Math.max(0, rect.top + Math.min(rect.height, innerHeight) / 2));
    const stack = document.elementsFromPoint(px, py);
    const idx = Math.max(0, stack.indexOf(el));

    // Behind: the first solid background below the element in the stack (or its parents), else the page.
    let behind = null;
    for (const x of stack.slice(idx + 1)) { const c = solid(getComputedStyle(x).backgroundColor); if (c) { behind = c; break; } }
    if (!behind) { for (let p = el.parentElement; p; p = p.parentElement) { const c = solid(getComputedStyle(p).backgroundColor); if (c) { behind = c; break; } } }
    behind ||= solid(getComputedStyle(document.documentElement).backgroundColor) || { c: [255, 255, 255], a: 1 };

    // On top: what's stacked above it at the centre, plus any text overlapping it.
    const above = stack.slice(0, idx), onTop = [];
    if (above.some(x => x.tagName === 'CANVAS')) onTop.push('a canvas');
    if (above.some(x => /^(IMG|VIDEO|PICTURE)$/.test(x.tagName))) onTop.push('images');
    const hasText = [...document.querySelectorAll('h1,h2,h3,h4,p,li,a,button,span')].some(t => {
      const r = t.getBoundingClientRect();
      return r.width && t.textContent.trim() && r.bottom > rect.top && r.top < rect.top + rect.height && r.right > rect.left && r.left < rect.left + rect.width && getComputedStyle(t).visibility !== 'hidden';
    });
    if (hasText) onTop.push('text');

    // See-through fades stacked over it (scrims, top and bottom shades). They cover the grain,
    // so where they're darkest the gradient can band into lines again. Found by walking the
    // elements that come after it near it in the page (scrims often ignore the pointer, so
    // elementsFromPoint misses them), including ones hidden right now that fade in later.
    const overlays = [];
    const host = el, scope = host.parentElement?.parentElement?.parentElement || document.body;
    // Its own children count too: shades are often an absolutely placed child of the section.
    const after = [...scope.querySelectorAll('*')].filter(x => x !== host && (host.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING)).slice(0, 600);
    for (const x of after) {
      for (const p of [null, '::before', '::after']) {
        const c = getComputedStyle(x, p);
        if (p && (c.content === 'none' || c.content === 'normal')) continue;
        const bgi = c.backgroundImage, mask = c.maskImage || c.webkitMaskImage || 'none';
        const fade = (/gradient\(/.test(bgi) && /transparent|rgba\([^)]*,\s*0?\.\d+\)|rgba\([^)]*,\s*0\)/.test(bgi)) || (/gradient\(/.test(mask) && c.backgroundColor !== 'rgba(0, 0, 0, 0)');
        if (!fade) continue;
        const r = x.getBoundingClientRect();
        if (!r.width || r.bottom <= rect.top || r.top >= rect.top + rect.height || r.right <= rect.left || r.left >= rect.left + rect.width) continue;
        const name = `${x.tagName.toLowerCase()}${x.id ? '#' + x.id : ''}${x.classList.length ? '.' + [...x.classList].join('.') : ''}${p || ''}`;
        overlays.push({ selector: name, grained: /feTurbulence/i.test(bgi), opacity: +c.opacity, background: (bgi !== 'none' ? bgi : c.backgroundColor).slice(0, 120), mask: mask === 'none' ? null : mask.slice(0, 120) });
      }
    }

    // An <img> or <video> filling the element is its real background.
    const media = !pseudo && [...el.querySelectorAll('img, video')].find(m => {
      const r = m.getBoundingClientRect(); return r.width >= r0.width * 0.9 && r.height >= r0.height * 0.9;
    });

    const layers = splitTop(cs.backgroundImage === 'none' ? '' : cs.backgroundImage);
    const gradients = layers.map(l => parseGradient(l, w, h)).filter(Boolean);
    const images = layers.filter(l => /^url\(/.test(l) && !/data:image\/svg/.test(l));
    const base = toRgba(cs.backgroundColor);
    const solidBase = !!(base && base.a > 0.99);

    let kind, shape = null, colours = [], lengthPx = 0, transparentStops = false, photoError = null;
    if (images.length || media) {
      kind = 'photo';
      const src = media ? (media.currentSrc || media.src || media.poster) : images[0].match(/url\("?([^")]+)"?\)/)[1];
      // A gradient on top of the photo (a scrim) darkens what's seen: paint it over the sample.
      const g0 = gradients[0];
      const scrim = g0?.stops?.length ? `rgba(${g0.stops.reduce((a, s) => a.map((v, k) => v + s.rgba.c[k] / g0.stops.length), [0, 0, 0]).map(Math.round).join(',')},${g0.stops.reduce((t, s) => t + s.rgba.a, 0) / g0.stops.length})` : null;
      try { colours = await samplePhoto(src, scrim); } catch { photoError = 'image could not be read (cross-origin); pass representative colours by hand'; }
    } else if (gradients.length) {
      kind = 'gradient';
      // The main gradient: solid stops first, then the one with the most change. Others are glows.
      const spread = g => { const l = g.stops.map(s => s.rgba.c[0] + s.rgba.c[1] + s.rgba.c[2]); return Math.max(...l) - Math.min(...l); };
      const main = [...gradients].sort((a, b) => (b.stops.every(s => s.rgba.a > 0.99) - a.stops.every(s => s.rgba.a > 0.99)) || spread(b) - spread(a))[0];
      shape = main.type;
      const under = solidBase ? base.c : behind.c;
      colours = main.stops.map(s => {
        if (s.rgba.a < 0.99) transparentStops = true;
        return { colour: hex(s.rgba.a < 0.99 ? over(s.rgba.c, s.rgba.a, under) : s.rgba.c), pos: +s.pos.toFixed(4) };
      });
      lengthPx = main.lengthPx;
    } else if (base && base.a > 0) {
      kind = 'flat';
      colours = [hex(base.a < 0.99 ? over(base.c, base.a, behind.c) : base.c)];
    } else {
      kind = 'none';
    }

    // Does it move? Scroll through the element and watch opacity and background.
    let moves = null;
    if (watch && document.hidden) moves = { unknown: true, why: 'the page is hidden, so its scroll animations are paused; read the page scripts for opacity or background changes' };
    else if (watch) {
      const from = Math.max(0, elTop - innerHeight), to = Math.min(document.documentElement.scrollHeight - innerHeight, elTop + el.offsetHeight);
      const samples = []; let reached = true;
      for (let i = 0; i <= 24; i++) {
        reached = (await jump(from + (to - from) * i / 24)) && reached;
        const c = getComputedStyle(el, pseudo);
        samples.push({ opacity: +c.opacity, bg: c.backgroundImage + c.backgroundColor });
      }
      const ops = samples.map(s => s.opacity), minO = Math.min(...ops), maxO = Math.max(...ops);
      const bgChanges = new Set(samples.map(s => s.bg)).size > 1;
      if (!reached) moves = { unknown: true, why: 'scrolling is taken over by the page (smooth-scroll library?); read the page scripts' };
      else if (maxO - minO > 0.2 || bgChanges) moves = { fade: maxO - minO > 0.2 ? { from: +minO.toFixed(2), to: +maxO.toFixed(2) } : null, backgroundChanges: bgChanges };
    }
    if (scroll || watch) await jump(y0);
    const animated = cs.animationName !== 'none' || /opacity|background|all/.test(cs.transitionProperty);

    const used = p => { const c = getComputedStyle(el, p).content; return c !== 'none' && c !== 'normal'; };
    const freePseudo = pseudo ? null : !used('::after') ? '::after' : !used('::before') ? '::before' : null;
    return {
      selector, isPseudo: !!pseudo,
      kind, shape, colours, lengthPx, transparentStops, solidBase,
      existingGrain: layers.some(l => { try { return /feTurbulence/i.test(decodeURIComponent(l)); } catch { return false; } }),
      layers: { gradients: gradients.length, images: images.length },
      layerCount: layers.length,
      background: cs.backgroundImage === 'none' ? null : cs.backgroundImage,
      lists: layers.length ? { size: cs.backgroundSize, position: cs.backgroundPosition, repeat: cs.backgroundRepeat, attachment: cs.backgroundAttachment, blend: cs.backgroundBlendMode } : null,
      behind: hex(behind.c),
      size: { w, h }, position: cs.position, zIndex: cs.zIndex === 'auto' ? null : +cs.zIndex,
      hostPosition: getComputedStyle(el).position,
      freePseudo, coveringMedia: !!media,
      onTop, overlays,
      moves: moves || (animated ? { animated: true } : null),
      photoError,
      viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      darkModeQuery: [...document.styleSheets].some(s => { try { return [...s.cssRules].some(r => r.media && /prefers-color-scheme/.test(r.media.mediaText)); } catch { return false; } }),
    };
  };
})();

// grain.js: picks film-grain settings for a background by measuring, not guessing.
//
// Works in Node and in the browser (no dependencies).
//
//   node grain.js --colours "#323435,#141617" --kind gradient --length 900 --level medium
//   node grain.js --colours "#0f766e,#f97316" --kind gradient --length 700 --level subtle --json
//   node grain.js --colours "#2a3440,#c9a27a,#11161c" --kind photo --level medium
//
// What it does:
//   1. Generates the same noise the browser's <feTurbulence> makes (SVG spec algorithm),
//      centred on mid-grey and opaque so it doesn't lighten or darken the background.
//   2. Blends that noise over the background colours with the W3C blend formulas.
//   3. Measures visible grain as the spread of L* (CIELAB lightness, 0–100) and the
//      brightness shift, and checks whether the noise is big enough to break up banding.
//   4. For the target in calibration.json, solves the opacity per blend mode and keeps
//      the blend that shifts brightness least.

// ---------------------------------------------------------------------------
// feTurbulence (SVG 1.1 spec reference implementation, fractalNoise, seed 0)
// ---------------------------------------------------------------------------
const BSize = 0x100, BM = 0xff, PerlinN = 0x1000;
const RAND_m = 2147483647, RAND_a = 16807, RAND_q = 127773, RAND_r = 2836;

const setupSeed = s => { if (s <= 0) s = -(s % (RAND_m - 1)) + 1; if (s > RAND_m - 1) s = RAND_m - 1; return s; };
const rand = s => { s = RAND_a * (s % RAND_q) - RAND_r * Math.floor(s / RAND_q); if (s <= 0) s += RAND_m; return s; };

const makeLattice = seed => {
  const lattice = new Int32Array(BSize + BSize + 2);
  const grad = [0, 1, 2, 3].map(() => Array.from({ length: BSize + BSize + 2 }, () => [0, 0]));
  let s = setupSeed(seed), i;
  for (let k = 0; k < 4; k++) {
    for (i = 0; i < BSize; i++) {
      lattice[i] = i;
      for (let j = 0; j < 2; j++) { s = rand(s); grad[k][i][j] = ((s % (BSize + BSize)) - BSize) / BSize; }
      const g = grad[k][i], n = Math.sqrt(g[0] * g[0] + g[1] * g[1]) || 1;
      g[0] /= n; g[1] /= n;
    }
  }
  while (--i) { const k = lattice[i]; s = rand(s); const j = s % BSize; lattice[i] = lattice[j]; lattice[j] = k; }
  for (i = 0; i < BSize + 2; i++) {
    lattice[BSize + i] = lattice[i];
    for (let k = 0; k < 4; k++) grad[k][BSize + i] = [grad[k][i][0], grad[k][i][1]];
  }
  return { lattice, grad };
};

const sCurve = t => t * t * (3 - 2 * t);
const lerp = (t, a, b) => a + t * (b - a);

const noise2 = (L, ch, vx, vy, st) => {
  let t = vx + PerlinN;
  let bx0 = Math.trunc(t) & BM, bx1 = (bx0 + 1) & BM;
  const rx0 = t - Math.trunc(t), rx1 = rx0 - 1;
  t = vy + PerlinN;
  let by0 = Math.trunc(t) & BM, by1 = (by0 + 1) & BM;
  const ry0 = t - Math.trunc(t), ry1 = ry0 - 1;
  if (st) {
    if (bx0 >= st.wrapX) bx0 -= st.width;
    if (bx1 >= st.wrapX) bx1 -= st.width;
    if (by0 >= st.wrapY) by0 -= st.height;
    if (by1 >= st.wrapY) by1 -= st.height;
  }
  bx0 &= BM; bx1 &= BM; by0 &= BM; by1 &= BM;
  const i = L.lattice[bx0], j = L.lattice[bx1];
  const b00 = L.lattice[i + by0], b10 = L.lattice[j + by0], b01 = L.lattice[i + by1], b11 = L.lattice[j + by1];
  const sx = sCurve(rx0), sy = sCurve(ry0), g = L.grad[ch];
  let q = g[b00]; let u = rx0 * q[0] + ry0 * q[1];
  q = g[b10]; let v = rx1 * q[0] + ry0 * q[1];
  const a = lerp(sx, u, v);
  q = g[b01]; u = rx0 * q[0] + ry1 * q[1];
  q = g[b11]; v = rx1 * q[0] + ry1 * q[1];
  const b = lerp(sx, u, v);
  return lerp(sy, a, b);
};

const turbulence = (L, ch, px, py, freq, octaves, tile) => {
  let fx = freq, fy = freq, st = null;
  if (tile) { // stitchTiles="stitch"
    const lo = Math.floor(tile * fx) / tile, hi = Math.ceil(tile * fx) / tile;
    fx = fy = (lo && fx / lo < hi / fx) ? lo : hi;
    const w = Math.trunc(tile * fx + 0.5);
    st = { width: w, height: w, wrapX: Math.trunc(fx * 0 + PerlinN + w), wrapY: Math.trunc(fy * 0 + PerlinN + w) };
  }
  let sum = 0, vx = px * fx, vy = py * fy, ratio = 1;
  for (let o = 0; o < octaves; o++) {
    sum += noise2(L, ch, vx, vy, st) / ratio;
    vx *= 2; vy *= 2; ratio *= 2;
    if (st) { st.width *= 2; st.wrapX = 2 * st.wrapX - PerlinN; st.height *= 2; st.wrapY = 2 * st.wrapY - PerlinN; }
  }
  return sum;
};

let lattice0 = null;
const sampleCache = new Map();

/**
 * Grey values (0–1) of the centred, mono noise tile, as the browser draws it with
 * color-interpolation-filters="sRGB" + feColorMatrix saturate 0 + opaque alpha.
 */
function noiseSample({ freq = 0.8, octaves = 3, tile = 200, n = 3000 } = {}) {
  const key = `${freq}|${octaves}|${tile}|${n}`;
  if (sampleCache.has(key)) return sampleCache.get(key);
  lattice0 ||= makeLattice(0);
  const out = new Float32Array(n), total = tile * tile, step = total / n;
  for (let k = 0; k < n; k++) {
    const p = Math.floor(k * step), x = p % tile, y = Math.floor(p / tile);
    const c = [0, 1, 2].map(ch => Math.min(1, Math.max(0, (turbulence(lattice0, ch, x, y, freq, octaves, tile) + 1) / 2)));
    out[k] = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  sampleCache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------
// Colour maths
// ---------------------------------------------------------------------------
const lin = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
// sRGB → linear via a 4096-step table (measure() calls this millions of times).
const LIN = Float64Array.from({ length: 4096 }, (_, i) => lin(i / 4095));
const linT = v => LIN[Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 4095)];
const lumY = (r, g, b) => 0.2126 * linT(r) + 0.7152 * linT(g) + 0.0722 * linT(b);
const Lstar = y => (y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y);
const lightness = rgb => Lstar(lumY(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255));


const NAMED = {
  black: [0, 0, 0], white: [255, 255, 255], transparent: [0, 0, 0], red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255],
  gray: [128, 128, 128], grey: [128, 128, 128], silver: [192, 192, 192], navy: [0, 0, 128], teal: [0, 128, 128], orange: [255, 165, 0],
};
const hslToRgb = (h, s, l) => {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)].map(v => Math.round(v * 255));
};

/**
 * '#abc', '#aabbccdd', 'rgb(1 2 3 / .5)', 'hsl(…)', a few names, or [r,g,b] → [r,g,b] (0–255).
 * Alpha is dropped here: look.js mixes see-through colours over what's behind before they get here.
 * Other formats (oklch, color(), color-mix) are converted to hex by look.js in the browser.
 */
function parseColour(c) {
  if (Array.isArray(c)) return c.slice(0, 3).map(Number);
  const s = String(c).trim().toLowerCase();
  if (NAMED[s]) return NAMED[s];
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map(x => x + x).join('');
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  }
  m = s.match(/rgba?\(([^)]+)\)/);
  if (m) return m[1].split(/[ ,/]+/).filter(Boolean).slice(0, 3).map(v => (v.endsWith('%') ? parseFloat(v) * 2.55 : Number(v)));
  m = s.match(/hsla?\(([^)]+)\)/);
  if (m) { const [h, sat, l] = m[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat); return hslToRgb(h, sat, l); }
  throw new Error(`Can't read colour "${c}". Convert it to hex first (look.js does this in the browser).`);
}
const toHex = c => '#' + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

const softD = b => (b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b));
const BLEND = {
  normal: (b, s) => s,
  multiply: (b, s) => b * s,
  screen: (b, s) => b + s - b * s,
  overlay: (b, s) => (b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)),
  'soft-light': (b, s) => (s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * (softD(b) - b)),
};

const mean = a => { let t = 0; for (const v of a) t += v; return t / a.length; };
const sd = a => { const m = mean(a); let t = 0; for (const v of a) t += (v - m) ** 2; return Math.sqrt(t / a.length); };
const pctl = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };

/**
 * Blend a noise sample over each colour and measure it.
 *   noise: Float32Array of grey values, or { v, a } with alpha
 *   colours: colours that each stand for an equal share of the area (see sampleGradient)
 *   over, t: for a layer that fades in, the colour behind it and the layer's opacity
 * Returns grain (mean L* spread), shift (mean L* change), dither (spread in 8-bit levels
 * on the faintest 10% of the area), perColour grain, and evenness: grain on the faintest
 * 10% of the area ÷ grain on the strongest 10%.
 */
function measure(noise, colours, blend, opacity, over = null, t = 1) {
  const v = noise.v || noise, a = noise.a || null, f = BLEND[blend];
  const o = over ? parseColour(over).map(x => x / 255) : null;
  const mix = (layer, k) => (o ? (1 - t) * o[k] + t * layer : layer);
  const grains = [], shifts = [], dithers = [];
  for (const c of colours) {
    const [br, bg, bb] = parseColour(c).map(x => x / 255);
    const L0 = Lstar(lumY(mix(br, 0), mix(bg, 1), mix(bb, 2)));
    const Ls = new Float32Array(v.length), lv = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) {
      const al = (a ? a[i] : 1) * opacity, s = v[i];
      const r = mix(br + al * (f(br, s) - br), 0), g = mix(bg + al * (f(bg, s) - bg), 1), b = mix(bb + al * (f(bb, s) - bb), 2);
      Ls[i] = Lstar(lumY(r, g, b));
      lv[i] = ((r + g + b) / 3) * 255;
    }
    grains.push(sd(Ls)); shifts.push(mean(Ls) - L0); dithers.push(sd(lv));
  }
  const hi = pctl(grains, 0.9), lo = pctl(grains, 0.1);
  return { grain: mean(grains), shift: mean(shifts), dither: pctl(dithers, 0.1), perColour: grains, evenness: hi > 0 ? lo / hi : 1 };
}

/** Opacity (0–1, 2 dp) that gives the target visible grain, or null if it can't. */
function solveOpacity(noise, colours, blend, target) {
  if (measure(noise, colours, blend, 1).grain < target) return null;
  let lo = 0, hi = 1;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    if (measure(noise, colours, blend, mid).grain < target) lo = mid; else hi = mid;
  }
  return Math.max(0.01, Math.round(hi * 100) / 100);
}

/** Visible grain at each stage of a fade-in over another colour. */
const FADE_STEPS = [0, 0.25, 0.5, 0.75, 1];
function fadeStages(noise, colours, blend, opacity, over) {
  const o = parseColour(over);
  return FADE_STEPS.map(t => {
    const m = measure(noise, colours, blend, opacity, over, t);
    const L = mean(colours.map(c => lightness(parseColour(c).map((v, k) => (1 - t) * o[k] + t * v))));
    return { fade: t, L: +L.toFixed(1), grain: +m.grain.toFixed(3), lightest: +pctl(m.perColour, 0.9).toFixed(3), darkest: +pctl(m.perColour, 0.1).toFixed(3) };
  });
}

// ---------------------------------------------------------------------------
// Background reading
// ---------------------------------------------------------------------------
const DITHER_MIN = 0.7; // noise spread (8-bit levels) that breaks up banding
const EVEN_MIN = 0.5;   // below this, the faintest part gets under half the grain of the strongest

/** Tone from area-weighted mean L*: dark < 25 ≤ mid < 70 ≤ light. */
const toneOf = L => (L < 25 ? 'dark' : L < 70 ? 'mid' : 'light');

/** Accepts ['#a', '#b'] or [{colour, pos}] and returns stops with positions (0–1). */
function toStops(colours) {
  return colours.map((c, i) => (typeof c === 'object' && !Array.isArray(c) && c.colour)
    ? { colour: c.colour, pos: c.pos ?? i / Math.max(1, colours.length - 1) }
    : { colour: c, pos: colours.length === 1 ? 0 : i / (colours.length - 1) });
}

/**
 * Colours along the gradient, each standing for an equal share of its area, so a stop that
 * covers 3% of the gradient counts 3%, not as much as one covering 90%. Linear: evenly along
 * the line. Radial: by ring area (outer rings are bigger), so t = √((i + ½) / n).
 */
function sampleGradient(stops, shape = 'linear', n = 24) {
  const s = [...stops].sort((a, b) => a.pos - b.pos).map(x => ({ c: parseColour(x.colour), pos: x.pos }));
  const at = t => {
    if (t <= s[0].pos) return s[0].c;
    for (let i = 1; i < s.length; i++) {
      if (t <= s[i].pos) {
        const span = s[i].pos - s[i - 1].pos || 1, k = (t - s[i - 1].pos) / span;
        return s[i - 1].c.map((v, j) => v + k * (s[i].c[j] - v));
      }
    }
    return s[s.length - 1].c;
  };
  return Array.from({ length: n }, (_, i) => toHex(at(shape === 'radial' ? Math.sqrt((i + 0.5) / n) : (i + 0.5) / n)));
}

/**
 * Banding: a gradient can only show whole 8-bit levels. If a stretch changes by few
 * levels over many pixels, each level becomes a visible stripe.
 * lengthPx: how far the gradient runs on screen (the radius, for a radial gradient).
 */
function banding(stops, lengthPx) {
  if (!stops || stops.length < 2 || !lengthPx) return { pxPerLevel: 0, risk: 'none' };
  let worst = 0;
  for (let i = 1; i < stops.length; i++) {
    const a = parseColour(stops[i - 1].colour), b = parseColour(stops[i].colour);
    const px = (stops[i].pos - stops[i - 1].pos) * lengthPx;
    const levels = Math.max(...a.map((v, k) => Math.abs(v - b[k])));
    if (levels === 0) continue; // a flat stretch can't band
    worst = Math.max(worst, px / levels);
  }
  return { pxPerLevel: Math.round(worst * 10) / 10, risk: worst === 0 ? 'none' : worst < 2 ? 'low' : worst < 6 ? 'medium' : 'high' };
}

// ---------------------------------------------------------------------------
// Noise tile
// ---------------------------------------------------------------------------
function noiseSvg({ freq = 0.8, octaves = 3, tile = 200, alpha = 1 } = {}) {
  const a = Math.round(alpha * 1000) / 1000;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${tile}">` +
    `<filter id="n" color-interpolation-filters="sRGB">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${octaves}" stitchTiles="stitch"/>` +
    `<feColorMatrix type="saturate" values="0"/>` +
    `<feComponentTransfer><feFuncA type="linear" slope="0" intercept="${a}"/></feComponentTransfer>` +
    `</filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`;
}
const svgUrl = svg => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

// Neutral blends: centred noise leaves the average brightness alone.
const BLENDS = ['overlay', 'soft-light'];
// Used only when neither neutral blend can reach the target (pure black, pure white):
// they do add grain there, at the cost of a small brightness shift.
const FALLBACK_BLENDS = ['screen', 'multiply'];
// A fallback blend may shift brightness this much (L*) at most; past that it reads as a tint.
const MAX_SHIFT = 1;
const LEVELS = ['subtle', 'medium', 'strong', 'even'];

/**
 * Recommend grain for a background.
 *   colours: gradient stops (['#hex', ...] or [{colour, pos}]) or sampled photo colours
 *   kind: 'gradient' | 'photo' | 'flat';  shape: 'linear' | 'radial' | 'conic'
 *   lengthPx: how far the gradient runs on screen (for banding)
 *   level: 'subtle' | 'medium' | 'strong' | 'even' (Medium's amount, spread as evenly as possible)
 *   fadeOver: colour behind the layer if it fades in, to measure the stages of the fade
 */
function recommend({ colours, kind = 'gradient', shape = 'linear', lengthPx = 0, level = 'medium', calibration, fadeOver = null, grain: g = {}, sampleSize = 3000 }) {
  if (!colours?.length) throw new Error('No colours given');
  if (!calibration?.targets) throw new Error('No calibration given');
  const stops = toStops(colours);
  const cols = kind === 'gradient' && stops.length > 1 ? sampleGradient(stops, shape) : stops.map(s => s.colour);
  const L = mean(cols.map(c => lightness(parseColour(c))));
  const tone = toneOf(L);
  const group = kind === 'photo' ? 'photo' : 'gradient';
  const targets = calibration.targets[group]?.[tone] || calibration.targets.gradient.mid;
  const target = targets[level === 'even' ? 'medium' : level];
  const settings = { freq: 0.8, octaves: 3, tile: 200, ...calibration.grain, ...g };
  const noise = noiseSample({ ...settings, n: sampleSize });

  const solve = blends => blends.map(blend => {
    const opacity = solveOpacity(noise, cols, blend, target);
    return opacity == null ? { blend, reachable: false } : { blend, opacity, reachable: true, ...measure(noise, cols, blend, opacity) };
  });
  let options = solve(BLENDS), fallback = false;
  if (!options.some(o => o.reachable)) {
    const fb = solve(FALLBACK_BLENDS).map(o => (o.reachable && Math.abs(o.shift) > MAX_SHIFT ? { ...o, reachable: false, tooMuchShift: true } : o));
    options = options.concat(fb); fallback = fb.some(o => o.reachable);
  }
  const ok = options.filter(o => o.reachable);
  ok.sort(level === 'even'
    ? (a, b) => b.evenness - a.evenness || Math.abs(a.shift) - Math.abs(b.shift)
    : (a, b) => Math.abs(a.shift) - Math.abs(b.shift) || a.opacity - b.opacity);
  let pick = ok[0], unreachable = false;
  if (!pick) { // nothing reaches it: take the most grain any blend can give, and say so
    unreachable = true;
    // Neutral blends only: a fallback strong enough to beat them would tint the colour.
    pick = BLENDS.map(blend => ({ blend, opacity: 1, ...measure(noise, cols, blend, 1) })).sort((a, b) => b.grain - a.grain)[0];
  }
  const band = kind === 'gradient' ? banding(stops, lengthPx) : { pxPerLevel: 0, risk: 'none' };
  const stages = fadeOver ? fadeStages(noise, cols, pick.blend, pick.opacity, fadeOver) : null;
  const confirmed = (calibration.confirmed || []).some(c => c.group === group && c.tone === tone && c.picked);
  const screens = unreachable ? null : screenVariants({ noise, cols, blend: pick.blend, opacity: pick.opacity, grain: pick.grain, target, tone, screens: calibration.screens });

  return {
    tone, group, L: Math.round(L * 10) / 10, level, target, confirmed, fallback: fallback && !unreachable && !BLENDS.includes(pick.blend), unreachable,
    blend: pick.blend, opacity: pick.opacity,
    measured: {
      grain: +pick.grain.toFixed(3), shift: +pick.shift.toFixed(3), dither: +pick.dither.toFixed(2),
      evenness: +pick.evenness.toFixed(2), lightest: +pctl(pick.perColour, 0.9).toFixed(3), darkest: +pctl(pick.perColour, 0.1).toFixed(3),
    },
    banding: band, stages, settings, screens,
    options: options.map(({ perColour, ...o }) => o),
    urls: { layer: svgUrl(noiseSvg({ ...settings, alpha: 1 })), baked: svgUrl(noiseSvg({ ...settings, alpha: pick.opacity })) },
  };
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------
/**
 * The same CSS adapts to each visitor's screen with media queries. Websites can't tell OLED
 * from LCD, but they can tell HDR screens (most OLED phones, XDR laptops) and the
 * high-contrast setting. Calibration targets are for the `reference` screen the picks were
 * made on; other screens get the target times their factor, same blend, opacity re-solved.
 *   sdr:      standard screens (the CSS base)
 *   hdr:      @media (dynamic-range: high)
 *   contrast: @media (prefers-contrast: more)
 */
const SCREEN_QUERIES = { hdr: '(dynamic-range: high)', contrast: '(prefers-contrast: more)' };
function screenVariants({ noise, cols, blend, opacity, grain, target, tone, screens: sc }) {
  if (!sc) return null;
  const hf = sc.hdr?.[tone] ?? 1;
  const ref = sc.reference === 'hdr' ? 'hdr' : 'sdr';
  const tSdr = ref === 'hdr' ? target / hf : target;
  const at = t => {
    if (Math.abs(t - target) < 1e-9) return { opacity, grain: +grain.toFixed(3) };
    const o = solveOpacity(noise, cols, blend, t) ?? 1;
    return { opacity: o, grain: +measure(noise, cols, blend, o).grain.toFixed(3) };
  };
  const out = { sdr: at(tSdr), hdr: at(tSdr * hf) };
  if (sc.contrastMore != null) out.contrast = at(tSdr * sc.contrastMore);
  // Drop variants that come out the same as the base.
  for (const k of ['hdr', 'contrast']) if (out[k] && out[k].opacity === out.sdr.opacity) delete out[k];
  return out;
}

// ---------------------------------------------------------------------------
// Method and CSS
// ---------------------------------------------------------------------------
/**
 * How to attach the grain, from what look.js saw:
 *   'one-layer': add the noise as the top background layer of the element itself
 *                (background-blend-mode). Gradients and flat colours with a solid base.
 *   'layer':     a free ::after (or ::before) on the element. Photos and image backgrounds.
 *   'child':     a child element. When the target is a pseudo-element, both pseudos are taken,
 *                or the background is an <img>/<video> filling the element.
 */
function chooseMethod(look) {
  const imageLayers = look.layers?.images ?? (/url\(/.test(look.background || '') && !/data:image\/svg/.test(look.background || '') ? 1 : 0);
  // background-blend-mode only blends with the element's own layers. If the gradient is
  // see-through with nothing solid under it, the noise would paint as grey haze.
  const seeThrough = look.transparentStops && !look.solidBase;
  if (!look.coveringMedia && (look.kind === 'gradient' || look.kind === 'flat') && !imageLayers && !seeThrough) return 'one-layer';
  if (look.isPseudo || look.coveringMedia || !look.freePseudo) return 'child';
  return 'layer';
}

/** Split a CSS list on top-level commas (not the ones inside brackets). */
function splitLayers(s) {
  const out = []; let depth = 0, cur = '';
  for (const ch of String(s || '')) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const layerCount = look => look.layerCount || splitLayers(look.backgroundSource || look.background).length || 1;
const listFor = (look, key, fallback) => look.lists?.[key] || Array(layerCount(look)).fill(fallback).join(', ');
/** The look without an old noise layer, so new grain replaces it instead of stacking. */
function withoutOldGrain(look) {
  const bg = look.backgroundSource || look.background;
  const layers = splitLayers(bg);
  const old = layers.map(l => /feTurbulence/i.test(l));
  if (!old.some(Boolean)) return look;
  const keep = list => splitLayers(list).filter((_, i) => !old[i]).join(', ');
  const kept = layers.filter((_, i) => !old[i]);
  return {
    ...look,
    backgroundSource: look.backgroundSource ? kept.join(', ') : look.backgroundSource,
    background: look.backgroundSource ? look.background : kept.join(', '),
    layerCount: kept.length,
    lists: look.lists && Object.fromEntries(Object.entries(look.lists).map(([k, v]) => [k, keep(v)])),
    replacedGrain: true,
  };
}

// Media-query rules that adapt the grain to the visitor's screen, and turn it off in print.
const screenRules = (sel, r, decl) => {
  const s = r.screens || {}, out = [];
  for (const k of ['hdr', 'contrast']) if (s[k]) out.push(`@media ${SCREEN_QUERIES[k]} {\n  ${sel} { ${decl(s[k].opacity)} }\n}`);
  out.push(`@media print {\n  ${sel} { ${decl(null)} }\n}`);
  return out.join('\n');
};

function cssFor(method, look, r) {
  look = withoutOldGrain(look);
  const sel = look.selector, size = `${r.settings.tile}px ${r.settings.tile}px`;
  const base = r.screens?.sdr?.opacity ?? r.opacity; // standard screens
  if (method === 'one-layer') {
    const bg = look.backgroundSource || look.background;
    const has = bg && bg !== 'none';
    const baked = o => svgUrl(noiseSvg({ ...r.settings, alpha: o }));
    // One value in front of every background list, the page's own values kept after it.
    // The noise sits in --grain so the screen rules only swap that one value.
    const lines = [
      `  --grain: ${baked(base)};`,
      `  background-image: var(--grain)${has ? `, ${bg}` : ''};`,
      `  background-size: ${size}${has ? `, ${listFor(look, 'size', 'auto')}` : ''};`,
      `  background-position: 0 0${has ? `, ${listFor(look, 'position', '0% 0%')}` : ''};`,
      `  background-repeat: repeat${has ? `, ${listFor(look, 'repeat', 'repeat')}` : ''};`,
      `  background-blend-mode: ${r.blend}${has ? `, ${listFor(look, 'blend', 'normal')}` : ''};`,
    ];
    if (look.lists?.attachment && /fixed/.test(look.lists.attachment)) lines.push(`  background-attachment: ${look.lists.attachment.split(',')[0].trim()}, ${look.lists.attachment};`);
    return `${sel} {\n${lines.join('\n')}\n}\n${screenRules(sel, r, o => `--grain: ${o == null ? 'none' : baked(o)};`)}`;
  }
  const host = look.isPseudo ? sel.split('::')[0] : sel;
  const hostRule = [look.hostPosition === 'static' || (!look.isPseudo && look.position === 'static') ? '  position: relative;' : null, '  isolation: isolate;'].filter(Boolean).join('\n');
  const body = `  pointer-events: none;\n  background-image: ${r.urls.layer};\n  background-size: ${size};\n  opacity: ${base};\n  mix-blend-mode: ${r.blend};`;
  const layerDecl = o => (o == null ? 'display: none;' : `opacity: ${o};`);
  if (method === 'child') {
    const pos = look.isPseudo && look.position === 'fixed' ? 'fixed' : 'absolute';
    // Over a photo or video the grain has to paint above it: right after it in the page,
    // with no z-index, so the content that follows still sits on top.
    const where = look.coveringMedia ? ', right after the <img> or <video> that fills it' : look.isPseudo ? ', right after its other content' : ', as its first child';
    const z = look.coveringMedia ? '' : `  z-index: ${look.isPseudo ? (look.zIndex ?? -1) : -1};\n`;
    // Scoped to the host so the site's own rules (say `.hero > div { position: relative }`)
    // can't pull the layer into the layout.
    const layerSel = `${host} > .grain-layer`;
    return `/* Add <div class="grain-layer" aria-hidden="true"></div> inside ${host}${where}. */\n${host} {\n${hostRule}\n}\n${layerSel} {\n  position: ${pos} !important;\n  inset: 0;\n  margin: 0;\n${z}${body}\n}\n${screenRules(layerSel, r, layerDecl)}`;
  }
  const pseudo = look.freePseudo || '::after';
  return `${host} {\n${hostRule}\n}\n${host}${pseudo} {\n  content: "";\n  position: absolute;\n  inset: 0;\n  z-index: -1;\n${body}\n}\n${screenRules(host + pseudo, r, layerDecl)}`;
}

// ---------------------------------------------------------------------------
// The whole job from a look (see look.js)
// ---------------------------------------------------------------------------
const pct = v => `${Math.round(v * 100)}%`;
const sign = v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;

function analyse(look, calibration) {
  if (!look?.colours?.length) throw new Error(`The look has no colours (kind: ${look?.kind}). ${look?.kind === 'photo' ? 'The image could not be read (cross-origin?). Pass a few representative colours by hand.' : 'Run look.js on the element that paints the background.'}`);
  const base = { colours: look.colours, kind: look.kind, shape: look.shape || 'linear', lengthPx: look.lengthPx || 0, calibration, fadeOver: look.moves?.fade ? look.behind : null };
  const results = Object.fromEntries(LEVELS.map(level => [level, recommend({ ...base, level })]));
  const method = chooseMethod(look);
  const css = Object.fromEntries(LEVELS.map(l => [l, cssFor(method, look, results[l])]));
  const m = results.medium, e = results.even;
  const evenSame = e.blend === m.blend && e.opacity === m.opacity;
  const uneven = m.measured.evenness < EVEN_MIN;
  const recommended = !evenSame && uneven && e.measured.evenness > m.measured.evenness + 0.15 ? 'even' : 'medium';
  const r = results[recommended];

  const what = [
    `${m.tone} ${look.shape || ''} ${look.kind}`.replace(/\s+/g, ' ').trim(),
    `on ${look.selector}`,
    look.moves?.fade ? `fading in over ${look.behind}` : null,
    look.size ? `${look.size.w}×${look.size.h}px` : null,
    look.onTop?.length ? `with ${look.onTop.join(', ')} on top` : null,
  ].filter(Boolean).join(', ');

  const lines = [`What it is: ${what}.`];
  if (r.unreachable) {
    lines.push(`Most it can do: these colours are close to ${r.L > 50 ? 'white' : 'black'}, where grain barely shows without tinting them. ${r.blend} at 1 gives ${r.measured.grain.toFixed(2)} L* (target ${r.target}) with no brightness change${r.measured.grain < 0.45 ? ', which is below what people can see; consider skipping this one' : ''}.`);
  } else {
    lines.push(`Chosen: ${recommended} — ${r.blend} at ${r.opacity}, ${r.measured.grain.toFixed(2)} L* of grain (target ${r.target}), brightness ${sign(r.measured.shift)} L*.` +
      (r.fallback ? ` Overlay and soft-light can't reach the target on colours this close to black or white, so it uses ${r.blend}, which shifts brightness a little.` : ''));
  }
  lines.push(`Method: ${method === 'one-layer' ? `one layer on ${look.selector} (the noise becomes its top background layer)${look.moves?.fade ? ', so the grain fades in with it and the colour underneath stays clean' : ''}` : method === 'layer' ? `a ${look.freePseudo || '::after'} layer on ${look.selector}, under its content` : `a child element${look.isPseudo ? ', because the background is on a pseudo-element' : look.coveringMedia ? ', because an image or video fills the element' : ''}`}.`);
  if (look.transparentStops && !look.solidBase && method !== 'one-layer') lines.push('The gradient is see-through, so the grain sits on its own layer to blend with what shows through.');
  lines.push(evenSame ? `Evenness: ${pct(m.measured.evenness)}${uneven ? ', and no blend spreads it more evenly' : ''}.` : uneven
    ? `Evenness: uneven — the faintest part gets ${pct(m.measured.evenness)} of the grain of the strongest part (${m.measured.darkest} vs ${m.measured.lightest} L*). Even: ${e.blend} at ${e.opacity}, ${pct(e.measured.evenness)}.`
    : `Evenness: even enough (${pct(m.measured.evenness)}).`);
  if (m.banding.risk === 'high' || m.banding.risk === 'medium') {
    lines.push(`Banding: ${m.banding.risk} risk, ~${m.banding.pxPerLevel}px per colour level. ${r.measured.dither >= DITHER_MIN ? 'The chosen grain breaks it up.' : 'The chosen grain is too faint to fully break it up; Strong does more if stripes show.'}`);
  }
  if (r.stages) lines.push(`Fade stages (${recommended}): ` + r.stages.map(s => `${pct(s.fade)} → ${s.grain.toFixed(2)}${s.fade === 0 ? ' (clean)' : ''}`).join(', ') + '.');
  if (r.screens) {
    const s = r.screens, bits = [`standard screens ${s.sdr.opacity} (${s.sdr.grain.toFixed(2)} L*)`];
    if (s.hdr) bits.push(`HDR screens such as OLED phones ${s.hdr.opacity} (${s.hdr.grain.toFixed(2)} L*)`);
    if (s.contrast) bits.push(`the high-contrast setting ${s.contrast.opacity} (${s.contrast.grain.toFixed(2)} L*)`);
    lines.push(`Screens: ${bits.join(', ')}; off when printed.`);
  }
  const bare = (look.overlays || []).filter(o => !o.grained);
  if (bare.length) lines.push(`Fades on top: ${bare.map(o => o.selector).join(', ')} ${bare.length > 1 ? 'are' : 'is a'} see-through gradient${bare.length > 1 ? 's' : ''} over this background. ${bare.length > 1 ? 'They cover' : 'It covers'} the grain, so where ${bare.length > 1 ? 'they are' : 'it is'} darkest the colour can band into lines again. Give ${bare.length > 1 ? 'each' : 'it'} the same grain tile, lined up: a solid colour with the noise blended in (background-blend-mode), faded with mask-image instead of a transparent gradient.`);
  if (look.existingGrain) lines.push(withoutOldGrain(look).replacedGrain ? 'The background already had a noise layer: the CSS replaces it.' : 'The background already has a noise layer somewhere else (a pseudo-element or child): remove it, don\'t add a second.');
  if (!m.confirmed) lines.push(`Note: the target for ${m.tone} ${m.group}s isn't confirmed by eye yet.`);

  return { look, method, recommended, evenSame, results, css, report: lines.join('\n') };
}

/** Compact config for the preview (options and readouts). */
function previewConfig(a) {
  return {
    selector: a.look.selector,
    recommended: a.recommended,
    report: a.report,
    // Hide options that would look the same as Medium (Even when no blend is more even,
    // Strong when Medium is already the most these colours can take).
    options: Object.fromEntries(LEVELS.filter(l => !(l === 'even' && a.evenSame) && !(l === 'strong' && a.results.medium.unreachable && a.results.strong.opacity === a.results.medium.opacity && a.results.strong.blend === a.results.medium.blend)).map(l => {
      const r = a.results[l];
      return [l, { blend: r.blend, opacity: r.opacity, grain: r.measured.grain, evenness: r.measured.evenness, shift: r.measured.shift, unreachable: r.unreachable, screens: r.screens }];
    })),
    noise: a.results.medium.urls.layer,
    tile: a.results.medium.settings.tile,
  };
}


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

  startPreview().catch(e => console.warn(e.message || e));
})();
