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
