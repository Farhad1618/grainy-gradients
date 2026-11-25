// grain-page.js: part of the grainy-gradients skill. Built by tools/build.mjs; don't edit by hand.
(() => {
  // skills/grainy-gradients/calibration.json
  var calibration_default = {
    about: "Shipped defaults. targets: visible grain as the spread of L* (CIELAB lightness, 0-100) per kind, tone and level. grain: the noise tile. screens: factors for screens other than the reference. confirmed: which targets a person has checked by eye. History and reasoning: docs/calibration-log.md in the repository.",
    grain: {
      freq: 0.8,
      octaves: 3,
      tile: 200
    },
    targets: {
      gradient: {
        dark: {
          subtle: 0.5,
          medium: 0.8,
          strong: 1.4
        },
        mid: {
          subtle: 0.5,
          medium: 0.8,
          strong: 1.4
        },
        light: {
          subtle: 0.5,
          medium: 0.8,
          strong: 1.4
        }
      },
      photo: {
        dark: {
          subtle: 0.5,
          medium: 0.9,
          strong: 1.6
        },
        mid: {
          subtle: 0.5,
          medium: 0.9,
          strong: 1.6
        },
        light: {
          subtle: 0.5,
          medium: 0.9,
          strong: 1.6
        }
      }
    },
    confirmed: [
      {
        group: "gradient",
        tone: "dark",
        picked: "even",
        date: "2026-11-08"
      },
      {
        group: "gradient",
        tone: "dark",
        picked: "medium",
        date: "2026-11-24"
      }
    ],
    screens: {
      reference: "sdr",
      hdr: {
        dark: 0.85,
        mid: 0.92,
        light: 1
      },
      contrastMore: 0.7,
      confirmed: false
    }
  };

  // skills/grainy-gradients/scripts/engine/colour.mjs
  var lin = (v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  var LIN = Float64Array.from({ length: 4096 }, (_, i) => lin(i / 4095));
  var linT = (v) => LIN[Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 4095)];
  var lumY = (r, g, b) => 0.2126 * linT(r) + 0.7152 * linT(g) + 0.0722 * linT(b);
  var Lstar = (y) => y > 8856e-6 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
  var lightness = (rgb) => Lstar(lumY(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255));
  var NAMED = {
    black: [0, 0, 0],
    white: [255, 255, 255],
    transparent: [0, 0, 0],
    red: [255, 0, 0],
    green: [0, 128, 0],
    blue: [0, 0, 255],
    gray: [128, 128, 128],
    grey: [128, 128, 128],
    silver: [192, 192, 192],
    navy: [0, 0, 128],
    teal: [0, 128, 128],
    orange: [255, 165, 0]
  };
  var hslToRgb = (h, s, l) => {
    h = (h % 360 + 360) % 360;
    s /= 100;
    l /= 100;
    const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
  };
  function parseColour(c) {
    if (Array.isArray(c)) return c.slice(0, 3).map(Number);
    const s = String(c).trim().toLowerCase();
    if (NAMED[s]) return NAMED[s];
    let m = s.match(/^#([0-9a-f]{3,8})$/);
    if (m) {
      let h = m[1];
      if (h.length <= 4) h = [...h].map((x) => x + x).join("");
      return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    }
    m = s.match(/rgba?\(([^)]+)\)/);
    if (m)
      return m[1].split(/[ ,/]+/).filter(Boolean).slice(0, 3).map((v) => v.endsWith("%") ? parseFloat(v) * 2.55 : Number(v));
    m = s.match(/hsla?\(([^)]+)\)/);
    if (m) {
      const [h, sat, l] = m[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat);
      return hslToRgb(h, sat, l);
    }
    throw new Error(`Can't read colour "${c}". Convert it to hex first (the browser tools do this for you).`);
  }
  var toHex = (c) => "#" + c.map(
    (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")
  ).join("");
  var softD = (b) => b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b);
  var BLEND = {
    normal: (b, s) => s,
    multiply: (b, s) => b * s,
    screen: (b, s) => b + s - b * s,
    overlay: (b, s) => b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s),
    "soft-light": (b, s) => s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * (softD(b) - b)
  };
  var mean = (a) => {
    let t = 0;
    for (const v of a) t += v;
    return t / a.length;
  };
  var sd = (a) => {
    const m = mean(a);
    let t = 0;
    for (const v of a) t += (v - m) ** 2;
    return Math.sqrt(t / a.length);
  };
  var pctl = (a, p) => {
    const s = [...a].sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
  };

  // skills/grainy-gradients/scripts/engine/measure.mjs
  function measure(noise, colours, blend, opacity, over2 = null, t = 1) {
    const v = noise.v || noise, a = noise.a || null, f = BLEND[blend];
    const o = over2 ? parseColour(over2).map((x) => x / 255) : null;
    const mix = (layer, k) => o ? (1 - t) * o[k] + t * layer : layer;
    const grains = [], shifts = [], dithers = [];
    for (const c of colours) {
      const [br, bg, bb] = parseColour(c).map((x) => x / 255);
      const L0 = Lstar(lumY(mix(br, 0), mix(bg, 1), mix(bb, 2)));
      const Ls = new Float32Array(v.length), lv = new Float32Array(v.length);
      for (let i = 0; i < v.length; i++) {
        const al = (a ? a[i] : 1) * opacity, s = v[i];
        const r = mix(br + al * (f(br, s) - br), 0), g = mix(bg + al * (f(bg, s) - bg), 1), b = mix(bb + al * (f(bb, s) - bb), 2);
        Ls[i] = Lstar(lumY(r, g, b));
        lv[i] = (r + g + b) / 3 * 255;
      }
      grains.push(sd(Ls));
      shifts.push(mean(Ls) - L0);
      dithers.push(sd(lv));
    }
    const hi = pctl(grains, 0.9), lo = pctl(grains, 0.1);
    return {
      grain: mean(grains),
      shift: mean(shifts),
      dither: pctl(dithers, 0.1),
      perColour: grains,
      evenness: hi > 0 ? lo / hi : 1
    };
  }
  function solveOpacity(noise, colours, blend, target) {
    if (measure(noise, colours, blend, 1).grain < target) return null;
    let lo = 0, hi = 1;
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      if (measure(noise, colours, blend, mid).grain < target) lo = mid;
      else hi = mid;
    }
    return Math.max(0.01, Math.round(hi * 100) / 100);
  }
  var FADE_STEPS = [0, 0.25, 0.5, 0.75, 1];
  function fadeStages(noise, colours, blend, opacity, over2) {
    const o = parseColour(over2);
    return FADE_STEPS.map((t) => {
      const m = measure(noise, colours, blend, opacity, over2, t);
      const L = mean(colours.map((c) => lightness(parseColour(c).map((v, k) => (1 - t) * o[k] + t * v))));
      return {
        fade: t,
        L: +L.toFixed(1),
        grain: +m.grain.toFixed(3),
        lightest: +pctl(m.perColour, 0.9).toFixed(3),
        darkest: +pctl(m.perColour, 0.1).toFixed(3)
      };
    });
  }
  var DITHER_MIN = 0.7;
  var EVEN_MIN = 0.5;
  var toneOf = (L) => L < 25 ? "dark" : L < 70 ? "mid" : "light";
  function toStops(colours) {
    return colours.map(
      (c, i) => typeof c === "object" && !Array.isArray(c) && c.colour ? { colour: c.colour, pos: c.pos ?? i / Math.max(1, colours.length - 1) } : { colour: c, pos: colours.length === 1 ? 0 : i / (colours.length - 1) }
    );
  }
  function sampleGradient(stops, shape = "linear", n = 24) {
    const s = [...stops].sort((a, b) => a.pos - b.pos).map((x) => ({ c: parseColour(x.colour), pos: x.pos }));
    const at = (t) => {
      if (t <= s[0].pos) return s[0].c;
      for (let i = 1; i < s.length; i++) {
        if (t <= s[i].pos) {
          const span = s[i].pos - s[i - 1].pos || 1, k = (t - s[i - 1].pos) / span;
          return s[i - 1].c.map((v, j) => v + k * (s[i].c[j] - v));
        }
      }
      return s[s.length - 1].c;
    };
    return Array.from({ length: n }, (_, i) => toHex(at(shape === "radial" ? Math.sqrt((i + 0.5) / n) : (i + 0.5) / n)));
  }
  function banding(stops, lengthPx) {
    if (!stops || stops.length < 2 || !lengthPx) return { pxPerLevel: 0, risk: "none" };
    let worst = 0;
    for (let i = 1; i < stops.length; i++) {
      const a = parseColour(stops[i - 1].colour), b = parseColour(stops[i].colour);
      const px = (stops[i].pos - stops[i - 1].pos) * lengthPx;
      const levels = Math.max(...a.map((v, k) => Math.abs(v - b[k])));
      if (levels === 0) continue;
      worst = Math.max(worst, px / levels);
    }
    return {
      pxPerLevel: Math.round(worst * 10) / 10,
      risk: worst === 0 ? "none" : worst < 2 ? "low" : worst < 6 ? "medium" : "high"
    };
  }

  // skills/grainy-gradients/scripts/engine/noise.mjs
  var BSize = 256;
  var BM = 255;
  var PerlinN = 4096;
  var RAND_m = 2147483647;
  var RAND_a = 16807;
  var RAND_q = 127773;
  var RAND_r = 2836;
  var setupSeed = (s) => {
    if (s <= 0) s = -(s % (RAND_m - 1)) + 1;
    if (s > RAND_m - 1) s = RAND_m - 1;
    return s;
  };
  var rand = (s) => {
    s = RAND_a * (s % RAND_q) - RAND_r * Math.floor(s / RAND_q);
    if (s <= 0) s += RAND_m;
    return s;
  };
  var makeLattice = (seed) => {
    const lattice = new Int32Array(BSize + BSize + 2);
    const grad = [0, 1, 2, 3].map(() => Array.from({ length: BSize + BSize + 2 }, () => [0, 0]));
    let s = setupSeed(seed), i;
    for (let k = 0; k < 4; k++) {
      for (i = 0; i < BSize; i++) {
        lattice[i] = i;
        for (let j = 0; j < 2; j++) {
          s = rand(s);
          grad[k][i][j] = (s % (BSize + BSize) - BSize) / BSize;
        }
        const g = grad[k][i], n = Math.sqrt(g[0] * g[0] + g[1] * g[1]) || 1;
        g[0] /= n;
        g[1] /= n;
      }
    }
    while (--i) {
      const k = lattice[i];
      s = rand(s);
      const j = s % BSize;
      lattice[i] = lattice[j];
      lattice[j] = k;
    }
    for (i = 0; i < BSize + 2; i++) {
      lattice[BSize + i] = lattice[i];
      for (let k = 0; k < 4; k++) grad[k][BSize + i] = [grad[k][i][0], grad[k][i][1]];
    }
    return { lattice, grad };
  };
  var sCurve = (t) => t * t * (3 - 2 * t);
  var lerp = (t, a, b) => a + t * (b - a);
  var noise2 = (L, ch, vx, vy, st) => {
    let t = vx + PerlinN;
    let bx0 = Math.trunc(t) & BM, bx1 = bx0 + 1 & BM;
    const rx0 = t - Math.trunc(t), rx1 = rx0 - 1;
    t = vy + PerlinN;
    let by0 = Math.trunc(t) & BM, by1 = by0 + 1 & BM;
    const ry0 = t - Math.trunc(t), ry1 = ry0 - 1;
    if (st) {
      if (bx0 >= st.wrapX) bx0 -= st.width;
      if (bx1 >= st.wrapX) bx1 -= st.width;
      if (by0 >= st.wrapY) by0 -= st.height;
      if (by1 >= st.wrapY) by1 -= st.height;
    }
    bx0 &= BM;
    bx1 &= BM;
    by0 &= BM;
    by1 &= BM;
    const i = L.lattice[bx0], j = L.lattice[bx1];
    const b00 = L.lattice[i + by0], b10 = L.lattice[j + by0], b01 = L.lattice[i + by1], b11 = L.lattice[j + by1];
    const sx = sCurve(rx0), sy = sCurve(ry0), g = L.grad[ch];
    let q = g[b00];
    let u = rx0 * q[0] + ry0 * q[1];
    q = g[b10];
    let v = rx1 * q[0] + ry0 * q[1];
    const a = lerp(sx, u, v);
    q = g[b01];
    u = rx0 * q[0] + ry1 * q[1];
    q = g[b11];
    v = rx1 * q[0] + ry1 * q[1];
    const b = lerp(sx, u, v);
    return lerp(sy, a, b);
  };
  var turbulence = (L, ch, px, py, freq, octaves, tile) => {
    let fx = freq, fy = freq, st = null;
    if (tile) {
      const lo = Math.floor(tile * fx) / tile, hi = Math.ceil(tile * fx) / tile;
      fx = fy = lo && fx / lo < hi / fx ? lo : hi;
      const w = Math.trunc(tile * fx + 0.5);
      st = { width: w, height: w, wrapX: Math.trunc(fx * 0 + PerlinN + w), wrapY: Math.trunc(fy * 0 + PerlinN + w) };
    }
    let sum = 0, vx = px * fx, vy = py * fy, ratio = 1;
    for (let o = 0; o < octaves; o++) {
      sum += noise2(L, ch, vx, vy, st) / ratio;
      vx *= 2;
      vy *= 2;
      ratio *= 2;
      if (st) {
        st.width *= 2;
        st.wrapX = 2 * st.wrapX - PerlinN;
        st.height *= 2;
        st.wrapY = 2 * st.wrapY - PerlinN;
      }
    }
    return sum;
  };
  var lattice0 = null;
  var sampleCache = /* @__PURE__ */ new Map();
  function noiseSample({ freq = 0.8, octaves = 3, tile = 200, n = 3e3 } = {}) {
    const key = `${freq}|${octaves}|${tile}|${n}`;
    if (sampleCache.has(key)) return sampleCache.get(key);
    lattice0 ||= makeLattice(0);
    const out = new Float32Array(n), total = tile * tile, step = total / n;
    for (let k = 0; k < n; k++) {
      const p = Math.floor(k * step), x = p % tile, y = Math.floor(p / tile);
      const c = [0, 1, 2].map(
        (ch) => Math.min(1, Math.max(0, (turbulence(lattice0, ch, x, y, freq, octaves, tile) + 1) / 2))
      );
      out[k] = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    }
    sampleCache.set(key, out);
    return out;
  }
  function noiseSvg({ freq = 0.8, octaves = 3, tile = 200, alpha = 1 } = {}) {
    const a = Math.round(alpha * 1e3) / 1e3;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${tile}"><filter id="n" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${octaves}" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="0" intercept="${a}"/></feComponentTransfer></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`;
  }
  var svgUrl = (svg) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

  // skills/grainy-gradients/scripts/engine/recommend.mjs
  var BLENDS = ["overlay", "soft-light"];
  var FALLBACK_BLENDS = ["screen", "multiply"];
  var MAX_SHIFT = 1;
  var LEVELS = ["subtle", "medium", "strong", "even"];
  function recommend({
    colours,
    kind = "gradient",
    shape = "linear",
    lengthPx = 0,
    level = "medium",
    calibration,
    fadeOver = null,
    grain: g = {},
    sampleSize = 3e3
  }) {
    if (!colours?.length) throw new Error("No colours given");
    if (!calibration?.targets) throw new Error("No calibration given");
    const stops = toStops(colours);
    const cols = kind === "gradient" && stops.length > 1 ? sampleGradient(stops, shape) : stops.map((s) => s.colour);
    const L = mean(cols.map((c) => lightness(parseColour(c))));
    const tone = toneOf(L);
    const group = kind === "photo" ? "photo" : "gradient";
    const targets = calibration.targets[group]?.[tone] || calibration.targets.gradient.mid;
    const target = targets[level === "even" ? "medium" : level];
    const settings = { freq: 0.8, octaves: 3, tile: 200, ...calibration.grain, ...g };
    const noise = noiseSample({ ...settings, n: sampleSize });
    const solve = (blends) => blends.map((blend) => {
      const opacity = solveOpacity(noise, cols, blend, target);
      return opacity == null ? { blend, reachable: false } : { blend, opacity, reachable: true, ...measure(noise, cols, blend, opacity) };
    });
    let options = solve(BLENDS), fallback = false;
    if (!options.some((o) => o.reachable)) {
      const fb = solve(FALLBACK_BLENDS).map(
        (o) => o.reachable && Math.abs(o.shift) > MAX_SHIFT ? { ...o, reachable: false, tooMuchShift: true } : o
      );
      options = options.concat(fb);
      fallback = fb.some((o) => o.reachable);
    }
    const ok = options.filter((o) => o.reachable);
    ok.sort(
      level === "even" ? (a, b) => b.evenness - a.evenness || Math.abs(a.shift) - Math.abs(b.shift) : (a, b) => Math.abs(a.shift) - Math.abs(b.shift) || a.opacity - b.opacity
    );
    let pick = ok[0], unreachable = false;
    if (!pick) {
      unreachable = true;
      pick = BLENDS.map((blend) => ({ blend, opacity: 1, ...measure(noise, cols, blend, 1) })).sort(
        (a, b) => b.grain - a.grain
      )[0];
    }
    const band = kind === "gradient" ? banding(stops, lengthPx) : { pxPerLevel: 0, risk: "none" };
    const stages = fadeOver ? fadeStages(noise, cols, pick.blend, pick.opacity, fadeOver) : null;
    const confirmed = (calibration.confirmed || []).some((c) => c.group === group && c.tone === tone && c.picked);
    const screens = unreachable ? null : screenVariants({
      noise,
      cols,
      blend: pick.blend,
      opacity: pick.opacity,
      grain: pick.grain,
      target,
      tone,
      screens: calibration.screens
    });
    return {
      tone,
      group,
      L: Math.round(L * 10) / 10,
      level,
      target,
      confirmed,
      fallback: fallback && !unreachable && !BLENDS.includes(pick.blend),
      unreachable,
      blend: pick.blend,
      opacity: pick.opacity,
      measured: {
        grain: +pick.grain.toFixed(3),
        shift: +pick.shift.toFixed(3),
        dither: +pick.dither.toFixed(2),
        evenness: +pick.evenness.toFixed(2),
        lightest: +pctl(pick.perColour, 0.9).toFixed(3),
        darkest: +pctl(pick.perColour, 0.1).toFixed(3)
      },
      banding: band,
      stages,
      settings,
      screens,
      options: options.map(({ perColour, ...o }) => o),
      urls: {
        layer: svgUrl(noiseSvg({ ...settings, alpha: 1 })),
        baked: svgUrl(noiseSvg({ ...settings, alpha: pick.opacity }))
      }
    };
  }
  var SCREEN_QUERIES = { hdr: "(dynamic-range: high)", contrast: "(prefers-contrast: more)" };
  function screenVariants({ noise, cols, blend, opacity, grain, target, tone, screens: sc }) {
    if (!sc) return null;
    const hf = sc.hdr?.[tone] ?? 1;
    const ref = sc.reference === "hdr" ? "hdr" : "sdr";
    const tSdr = ref === "hdr" ? target / hf : target;
    const at = (t) => {
      if (Math.abs(t - target) < 1e-9) return { opacity, grain: +grain.toFixed(3) };
      const o = solveOpacity(noise, cols, blend, t) ?? 1;
      return { opacity: o, grain: +measure(noise, cols, blend, o).grain.toFixed(3) };
    };
    const out = { sdr: at(tSdr), hdr: at(tSdr * hf) };
    if (sc.contrastMore != null) out.contrast = at(tSdr * sc.contrastMore);
    for (const k of ["hdr", "contrast"]) if (out[k] && out[k].opacity === out.sdr.opacity) delete out[k];
    return out;
  }

  // skills/grainy-gradients/scripts/engine/css.mjs
  function chooseMethod(look2) {
    const imageLayers = look2.layers?.images ?? (/url\(/.test(look2.background || "") && !/data:image\/svg/.test(look2.background || "") ? 1 : 0);
    const seeThrough = look2.transparentStops && !look2.solidBase;
    if (!look2.coveringMedia && (look2.kind === "gradient" || look2.kind === "flat") && !imageLayers && !seeThrough)
      return "one-layer";
    if (look2.isPseudo || look2.coveringMedia || !look2.freePseudo) return "child";
    return "layer";
  }
  function splitLayers(s) {
    const out = [];
    let depth = 0, cur = "";
    for (const ch of String(s || "")) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  var layerCount = (look2) => look2.layerCount || splitLayers(look2.backgroundSource || look2.background).length || 1;
  var listFor = (look2, key, fallback) => look2.lists?.[key] || Array(layerCount(look2)).fill(fallback).join(", ");
  function withoutOldGrain(look2) {
    const bg = look2.backgroundSource || look2.background;
    const layers = splitLayers(bg);
    const old = layers.map((l) => /feTurbulence/i.test(l));
    if (!old.some(Boolean)) return look2;
    const keep = (list) => splitLayers(list).filter((_, i) => !old[i]).join(", ");
    const kept = layers.filter((_, i) => !old[i]);
    return {
      ...look2,
      backgroundSource: look2.backgroundSource ? kept.join(", ") : look2.backgroundSource,
      background: look2.backgroundSource ? look2.background : kept.join(", "),
      layerCount: kept.length,
      lists: look2.lists && Object.fromEntries(Object.entries(look2.lists).map(([k, v]) => [k, keep(v)])),
      replacedGrain: true
    };
  }
  var screenRules = (sel, r, decl) => {
    const s = r.screens || {}, out = [];
    for (const k of ["hdr", "contrast"])
      if (s[k]) out.push(`@media ${SCREEN_QUERIES[k]} {
  ${sel} { ${decl(s[k].opacity)} }
}`);
    out.push(`@media print {
  ${sel} { ${decl(null)} }
}`);
    return out.join("\n");
  };
  function cssFor(method, look2, r) {
    look2 = withoutOldGrain(look2);
    const sel = look2.selector, size = `${r.settings.tile}px ${r.settings.tile}px`;
    const base = r.screens?.sdr?.opacity ?? r.opacity;
    if (method === "one-layer") {
      const bg = look2.backgroundSource || look2.background;
      const has = bg && bg !== "none";
      const baked = (o) => svgUrl(noiseSvg({ ...r.settings, alpha: o }));
      const lines = [
        `  --grain: ${baked(base)};`,
        `  background-image: var(--grain)${has ? `, ${bg}` : ""};`,
        `  background-size: ${size}${has ? `, ${listFor(look2, "size", "auto")}` : ""};`,
        `  background-position: 0 0${has ? `, ${listFor(look2, "position", "0% 0%")}` : ""};`,
        `  background-repeat: repeat${has ? `, ${listFor(look2, "repeat", "repeat")}` : ""};`,
        `  background-blend-mode: ${r.blend}${has ? `, ${listFor(look2, "blend", "normal")}` : ""};`
      ];
      if (look2.lists?.attachment && /fixed/.test(look2.lists.attachment))
        lines.push(`  background-attachment: ${look2.lists.attachment.split(",")[0].trim()}, ${look2.lists.attachment};`);
      return `${sel} {
${lines.join("\n")}
}
${screenRules(sel, r, (o) => `--grain: ${o == null ? "none" : baked(o)};`)}`;
    }
    const host = look2.isPseudo ? sel.split("::")[0] : sel;
    const hostRule = [
      look2.hostPosition === "static" || !look2.isPseudo && look2.position === "static" ? "  position: relative;" : null,
      "  isolation: isolate;"
    ].filter(Boolean).join("\n");
    const body = `  pointer-events: none;
  background-image: ${r.urls.layer};
  background-size: ${size};
  opacity: ${base};
  mix-blend-mode: ${r.blend};`;
    const layerDecl = (o) => o == null ? "display: none;" : `opacity: ${o};`;
    if (method === "child") {
      const pos = look2.isPseudo && look2.position === "fixed" ? "fixed" : "absolute";
      const where = look2.coveringMedia ? ", right after the <img> or <video> that fills it" : look2.isPseudo ? ", right after its other content" : ", as its first child";
      const z = look2.coveringMedia ? "" : `  z-index: ${look2.isPseudo ? look2.zIndex ?? -1 : -1};
`;
      const layerSel = `${host} > .grain-layer`;
      return `/* Add <div class="grain-layer" aria-hidden="true"></div> inside ${host}${where}. */
${host} {
${hostRule}
}
${layerSel} {
  position: ${pos} !important;
  inset: 0;
  margin: 0;
${z}${body}
}
${screenRules(layerSel, r, layerDecl)}`;
    }
    const pseudo = look2.freePseudo || "::after";
    return `${host} {
${hostRule}
}
${host}${pseudo} {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
${body}
}
${screenRules(host + pseudo, r, layerDecl)}`;
  }

  // skills/grainy-gradients/scripts/engine/analyse.mjs
  var pct = (v) => `${Math.round(v * 100)}%`;
  var sign = (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
  function analyse(look2, calibration) {
    if (!look2?.colours?.length)
      throw new Error(
        `The look has no colours (kind: ${look2?.kind}). ${look2?.kind === "photo" ? "The image could not be read (cross-origin?). Pass a few representative colours by hand." : "Point it at the element that actually paints the background (often a ::before, ::after or a full-size child)."}`
      );
    const base = {
      colours: look2.colours,
      kind: look2.kind,
      shape: look2.shape || "linear",
      lengthPx: look2.lengthPx || 0,
      calibration,
      fadeOver: look2.moves?.fade ? look2.behind : null
    };
    const results = Object.fromEntries(LEVELS.map((level) => [level, recommend({ ...base, level })]));
    const method = chooseMethod(look2);
    const css = Object.fromEntries(LEVELS.map((l) => [l, cssFor(method, look2, results[l])]));
    const m = results.medium, e = results.even;
    const evenSame = e.blend === m.blend && e.opacity === m.opacity;
    const uneven = m.measured.evenness < EVEN_MIN;
    const recommended = !evenSame && uneven && e.measured.evenness > m.measured.evenness + 0.15 ? "even" : "medium";
    const r = results[recommended];
    const what = [
      `${m.tone} ${look2.shape || ""} ${look2.kind}`.replace(/\s+/g, " ").trim(),
      `on ${look2.selector}`,
      look2.moves?.fade ? `fading in over ${look2.behind}` : null,
      look2.size ? `${look2.size.w}×${look2.size.h}px` : null,
      look2.onTop?.length ? `with ${look2.onTop.join(", ")} on top` : null
    ].filter(Boolean).join(", ");
    const lines = [`What it is: ${what}.`];
    if (r.unreachable) {
      lines.push(
        `Most it can do: these colours are close to ${r.L > 50 ? "white" : "black"}, where grain barely shows without tinting them. ${r.blend} at 1 gives ${r.measured.grain.toFixed(2)} L* (target ${r.target}) with no brightness change${r.measured.grain < 0.45 ? ", which is below what people can see; consider skipping this one" : ""}.`
      );
    } else {
      lines.push(
        `Chosen: ${recommended} — ${r.blend} at ${r.opacity}, ${r.measured.grain.toFixed(2)} L* of grain (target ${r.target}), brightness ${sign(r.measured.shift)} L*.` + (r.fallback ? ` Overlay and soft-light can't reach the target on colours this close to black or white, so it uses ${r.blend}, which shifts brightness a little.` : "")
      );
    }
    lines.push(
      `Method: ${method === "one-layer" ? `one layer on ${look2.selector} (the noise becomes its top background layer)${look2.moves?.fade ? ", so the grain fades in with it and the colour underneath stays clean" : ""}` : method === "layer" ? `a ${look2.freePseudo || "::after"} layer on ${look2.selector}, under its content` : `a child element${look2.isPseudo ? ", because the background is on a pseudo-element" : look2.coveringMedia ? ", because an image or video fills the element" : ""}`}.`
    );
    if (look2.transparentStops && !look2.solidBase && method !== "one-layer")
      lines.push("The gradient is see-through, so the grain sits on its own layer to blend with what shows through.");
    lines.push(
      evenSame ? `Evenness: ${pct(m.measured.evenness)}${uneven ? ", and no blend spreads it more evenly" : ""}.` : uneven ? `Evenness: uneven — the faintest part gets ${pct(m.measured.evenness)} of the grain of the strongest part (${m.measured.darkest} vs ${m.measured.lightest} L*). Even: ${e.blend} at ${e.opacity}, ${pct(e.measured.evenness)}.` : `Evenness: even enough (${pct(m.measured.evenness)}).`
    );
    if (m.banding.risk === "high" || m.banding.risk === "medium") {
      lines.push(
        `Banding: ${m.banding.risk} risk, ~${m.banding.pxPerLevel}px per colour level. ${r.measured.dither >= DITHER_MIN ? "The chosen grain breaks it up." : "The chosen grain is too faint to fully break it up; Strong does more if stripes show."}`
      );
    }
    if (r.stages)
      lines.push(
        `Fade stages (${recommended}): ` + r.stages.map((s) => `${pct(s.fade)} → ${s.grain.toFixed(2)}${s.fade === 0 ? " (clean)" : ""}`).join(", ") + "."
      );
    if (r.screens) {
      const s = r.screens, bits = [`standard screens ${s.sdr.opacity} (${s.sdr.grain.toFixed(2)} L*)`];
      if (s.hdr) bits.push(`HDR screens such as OLED phones ${s.hdr.opacity} (${s.hdr.grain.toFixed(2)} L*)`);
      if (s.contrast) bits.push(`the high-contrast setting ${s.contrast.opacity} (${s.contrast.grain.toFixed(2)} L*)`);
      lines.push(`Screens: ${bits.join(", ")}; off when printed.`);
    }
    const bare = (look2.overlays || []).filter((o) => !o.grained);
    if (bare.length)
      lines.push(
        `Fades on top: ${bare.map((o) => o.selector).join(", ")} ${bare.length > 1 ? "are" : "is a"} see-through gradient${bare.length > 1 ? "s" : ""} over this background. ${bare.length > 1 ? "They cover" : "It covers"} the grain, so where ${bare.length > 1 ? "they are" : "it is"} darkest the colour can band into lines again. Give ${bare.length > 1 ? "each" : "it"} the same grain tile, lined up: a solid colour with the noise blended in (background-blend-mode), faded with mask-image instead of a transparent gradient.`
      );
    if (look2.existingGrain)
      lines.push(
        withoutOldGrain(look2).replacedGrain ? "The background already had a noise layer: the CSS replaces it." : "The background already has a noise layer somewhere else (a pseudo-element or child): remove it, don't add a second."
      );
    if (!m.confirmed) lines.push(`Note: the target for ${m.tone} ${m.group}s isn't confirmed by eye yet.`);
    return { look: look2, method, recommended, evenSame, results, css, report: lines.join("\n") };
  }
  function previewConfig(a) {
    return {
      selector: a.look.selector,
      recommended: a.recommended,
      report: a.report,
      // Hide options that would look the same as Medium (Even when no blend is more even,
      // Strong when Medium is already the most these colours can take).
      options: Object.fromEntries(
        LEVELS.filter(
          (l) => !(l === "even" && a.evenSame) && !(l === "strong" && a.results.medium.unreachable && a.results.strong.opacity === a.results.medium.opacity && a.results.strong.blend === a.results.medium.blend)
        ).map((l) => {
          const r = a.results[l];
          return [
            l,
            {
              blend: r.blend,
              opacity: r.opacity,
              grain: r.measured.grain,
              evenness: r.measured.evenness,
              shift: r.measured.shift,
              unreachable: r.unreachable,
              screens: r.screens
            }
          ];
        })
      ),
      noise: a.results.medium.urls.layer,
      tile: a.results.medium.settings.tile
    };
  }

  // skills/grainy-gradients/scripts/browser/look.mjs
  var hex = (c) => "#" + c.map(
    (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")
  ).join("");
  var over = (top, a, under) => top.map((v, k) => a * v + (1 - a) * under[k]);
  var cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  var cx = cv.getContext("2d", { willReadFrequently: true });
  var toRgba = (str) => {
    if (!str) return null;
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = "#010203";
    cx.fillStyle = str;
    if (cx.fillStyle === "#010203" && !/^#010203$/i.test(str.trim())) return null;
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return { c: [d[0], d[1], d[2]], a: d[3] / 255 };
  };
  var POS = /\s+(-?[\d.]+)(%|px|em|rem|vw|vh|vmin|vmax|)$/;
  var parseStop = (text, lengthPx) => {
    let rest = text.trim();
    const pos = [];
    for (let m; (m = rest.match(POS)) && !/\($/.test(rest.slice(0, m.index)); ) {
      const v = +m[1];
      pos.unshift(m[2] === "%" || m[2] === "" ? v / 100 : m[2] === "px" ? lengthPx ? v / lengthPx : null : null);
      rest = rest.slice(0, m.index).trim();
    }
    const col = toRgba(rest);
    return col ? { rgba: col, pos } : null;
  };
  var angleOf = (head) => {
    if (!head) return 180;
    let m = head.match(/(-?[\d.]+)(deg|turn|rad|grad)/);
    if (m)
      return m[2] === "turn" ? m[1] * 360 : m[2] === "rad" ? m[1] * 180 / Math.PI : m[2] === "grad" ? m[1] * 0.9 : +m[1];
    m = head.match(/to\s+(.+)/);
    if (!m) return 180;
    const t = m[1];
    const v = /top/.test(t) ? -1 : /bottom/.test(t) ? 1 : 0, h = /left/.test(t) ? -1 : /right/.test(t) ? 1 : 0;
    return { v, h, corner: !!(v && h) };
  };
  var lineLength = (head, w, h) => {
    const a = angleOf(head);
    if (typeof a === "object") {
      if (a.corner) return Math.round(2 * w * h / Math.hypot(w, h));
      return a.h ? w : h;
    }
    const r = a * Math.PI / 180;
    return Math.round(Math.abs(w * Math.sin(r)) + Math.abs(h * Math.cos(r)));
  };
  var radialLength = (head, w, h) => {
    const [size = "", at = "50% 50%"] = (head || "").split(/\s+at\s+/);
    const vals = [...size.matchAll(/([\d.]+)(%|px)/g)].map(
      (m, i) => m[2] === "px" ? +m[1] : +m[1] / 100 * (i === 0 ? w : h)
    );
    if (vals.length) return Math.round(Math.max(...vals));
    const p = at.trim().split(/\s+/).map(
      (v, i) => /%$/.test(v) ? parseFloat(v) / 100 * (i ? h : w) : /px$/.test(v) ? parseFloat(v) : { left: 0, top: 0, center: (i ? h : w) / 2, right: w, bottom: h }[v] ?? (i ? h : w) / 2
    );
    const [x, y] = [p[0] ?? w / 2, p[1] ?? h / 2];
    const dx = Math.max(x, w - x), dy = Math.max(y, h - y);
    if (/closest-side/.test(size)) return Math.round(Math.min(Math.min(x, w - x), Math.min(y, h - y)));
    if (/circle/.test(size)) return Math.round(Math.hypot(dx, dy));
    return Math.round(Math.max(dx, dy) * Math.SQRT2);
  };
  var parseGradient = (layer, w, h) => {
    const m = layer.match(/^(repeating-)?(linear|radial|conic)-gradient\((.*)\)$/s);
    if (!m) return null;
    const parts = splitLayers(m[3]);
    let head = null;
    if (!toRgba(parts[0].replace(POS, "").replace(POS, ""))) head = parts.shift();
    const type = m[2];
    const lengthPx = type === "linear" ? lineLength(head, w, h) : type === "radial" ? radialLength(head, w, h) : Math.max(w, h);
    const stops = [];
    for (const p of parts) {
      const s = parseStop(p, lengthPx);
      if (!s) continue;
      if (s.pos.length === 2) {
        stops.push({ rgba: s.rgba, pos: s.pos[0] });
        stops.push({ rgba: s.rgba, pos: s.pos[1] });
      } else stops.push({ rgba: s.rgba, pos: s.pos[0] ?? null });
    }
    if (stops.length) {
      if (stops[0].pos == null) stops[0].pos = 0;
      if (stops[stops.length - 1].pos == null) stops[stops.length - 1].pos = 1;
      for (let i = 1; i < stops.length; i++) {
        if (stops[i].pos != null) {
          stops[i].pos = Math.max(stops[i].pos, stops[i - 1].pos);
          continue;
        }
        let j = i;
        while (stops[j].pos == null) j++;
        const a = stops[i - 1].pos, b = stops[j].pos;
        for (let k = i; k < j; k++) stops[k].pos = a + (b - a) * (k - i + 1) / (j - i + 1);
      }
    }
    const period = m[1] && stops.length ? stops[stops.length - 1].pos - stops[0].pos : 1;
    return { type, repeating: !!m[1], head, stops, lengthPx: Math.round(lengthPx * (period || 1)) };
  };
  var solid = (s) => {
    const c = toRgba(s);
    return c && c.a > 0.99 ? c : null;
  };
  var frame = () => new Promise((r) => {
    const t = setTimeout(r, 60);
    requestAnimationFrame(
      () => requestAnimationFrame(() => {
        clearTimeout(t);
        r();
      })
    );
  });
  var jump = async (y) => {
    scrollTo({ top: y, behavior: "instant" });
    await frame();
    return Math.abs(scrollY - Math.min(y, document.documentElement.scrollHeight - innerHeight)) < 4;
  };
  var samplePhoto = async (src, scrim) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = src;
    await img.decode();
    const w = 8, h = 6, c = Object.assign(document.createElement("canvas"), { width: w, height: h });
    const ctx = c.getContext("2d");
    const s = Math.max(w / img.width, h / img.height);
    ctx.drawImage(img, (w - img.width * s) / 2, (h - img.height * s) / 2, img.width * s, img.height * s);
    if (scrim) {
      ctx.fillStyle = scrim;
      ctx.fillRect(0, 0, w, h);
    }
    const d = ctx.getImageData(0, 0, w, h).data, out = [];
    for (let i = 0; i < d.length; i += 4) out.push(hex([d[i], d[i + 1], d[i + 2]]));
    return out;
  };
  async function look(selector2, { watch = true, scroll = true } = {}) {
    const [hostSel, pseudo = null] = selector2.split(/(?=::)/);
    const el = document.querySelector(hostSel);
    if (!el) throw new Error(`No element for ${hostSel}`);
    const y0 = scrollY;
    const elTop = el.getBoundingClientRect().top + scrollY;
    if (scroll) await jump(Math.max(0, elTop + el.offsetHeight / 2 - innerHeight / 2));
    const cs = getComputedStyle(el, pseudo);
    const fixed = cs.position === "fixed";
    const r0 = el.getBoundingClientRect();
    const rect = fixed && pseudo ? { left: 0, top: 0, width: innerWidth, height: innerHeight } : r0;
    const w = Math.round(rect.width), h = Math.round(Math.min(rect.height, fixed ? innerHeight : rect.height));
    const px = rect.left + rect.width / 2, py = Math.min(innerHeight - 1, Math.max(0, rect.top + Math.min(rect.height, innerHeight) / 2));
    const stack = document.elementsFromPoint(px, py);
    const idx = Math.max(0, stack.indexOf(el));
    let behind = null;
    for (const x of stack.slice(idx + 1)) {
      const c = solid(getComputedStyle(x).backgroundColor);
      if (c) {
        behind = c;
        break;
      }
    }
    if (!behind) {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const c = solid(getComputedStyle(p).backgroundColor);
        if (c) {
          behind = c;
          break;
        }
      }
    }
    behind ||= solid(getComputedStyle(document.documentElement).backgroundColor) || { c: [255, 255, 255], a: 1 };
    const above = stack.slice(0, idx), onTop = [];
    if (above.some((x) => x.tagName === "CANVAS")) onTop.push("a canvas");
    if (above.some((x) => /^(IMG|VIDEO|PICTURE)$/.test(x.tagName))) onTop.push("images");
    const hasText = [...document.querySelectorAll("h1,h2,h3,h4,p,li,a,button,span")].some((t) => {
      const r = t.getBoundingClientRect();
      return r.width && t.textContent.trim() && r.bottom > rect.top && r.top < rect.top + rect.height && r.right > rect.left && r.left < rect.left + rect.width && getComputedStyle(t).visibility !== "hidden";
    });
    if (hasText) onTop.push("text");
    const overlays = [];
    const host = el, scope = host.parentElement?.parentElement?.parentElement || document.body;
    const after = [...scope.querySelectorAll("*")].filter((x) => x !== host && host.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING).slice(0, 600);
    for (const x of after) {
      for (const p of [null, "::before", "::after"]) {
        const c = getComputedStyle(x, p);
        if (p && (c.content === "none" || c.content === "normal")) continue;
        const bgi = c.backgroundImage, mask = c.maskImage || c.webkitMaskImage || "none";
        const fade = /gradient\(/.test(bgi) && /transparent|rgba\([^)]*,\s*0?\.\d+\)|rgba\([^)]*,\s*0\)/.test(bgi) || /gradient\(/.test(mask) && c.backgroundColor !== "rgba(0, 0, 0, 0)";
        if (!fade) continue;
        const r = x.getBoundingClientRect();
        if (!r.width || r.bottom <= rect.top || r.top >= rect.top + rect.height || r.right <= rect.left || r.left >= rect.left + rect.width)
          continue;
        const name = `${x.tagName.toLowerCase()}${x.id ? "#" + x.id : ""}${x.classList.length ? "." + [...x.classList].join(".") : ""}${p || ""}`;
        overlays.push({
          selector: name,
          grained: /feTurbulence/i.test(bgi),
          opacity: +c.opacity,
          background: (bgi !== "none" ? bgi : c.backgroundColor).slice(0, 120),
          mask: mask === "none" ? null : mask.slice(0, 120)
        });
      }
    }
    const media = !pseudo && [...el.querySelectorAll("img, video")].find((m) => {
      const r = m.getBoundingClientRect();
      return r.width >= r0.width * 0.9 && r.height >= r0.height * 0.9;
    });
    const layers = splitLayers(cs.backgroundImage === "none" ? "" : cs.backgroundImage);
    const gradients = layers.map((l) => parseGradient(l, w, h)).filter(Boolean);
    const images = layers.filter((l) => /^url\(/.test(l) && !/data:image\/svg/.test(l));
    const base = toRgba(cs.backgroundColor);
    const solidBase = !!(base && base.a > 0.99);
    let kind, shape = null, colours = [], lengthPx = 0, transparentStops = false, photoError = null;
    if (images.length || media) {
      kind = "photo";
      const src = media ? media.currentSrc || media.src || media.poster : images[0].match(/url\("?([^")]+)"?\)/)[1];
      const g0 = gradients[0];
      const scrim = g0?.stops?.length ? `rgba(${g0.stops.reduce((a, s) => a.map((v, k) => v + s.rgba.c[k] / g0.stops.length), [0, 0, 0]).map(Math.round).join(",")},${g0.stops.reduce((t, s) => t + s.rgba.a, 0) / g0.stops.length})` : null;
      try {
        colours = await samplePhoto(src, scrim);
      } catch {
        photoError = "image could not be read (cross-origin); pass representative colours by hand";
      }
    } else if (gradients.length) {
      kind = "gradient";
      const spread = (g) => {
        const l = g.stops.map((s) => s.rgba.c[0] + s.rgba.c[1] + s.rgba.c[2]);
        return Math.max(...l) - Math.min(...l);
      };
      const main = [...gradients].sort(
        (a, b) => b.stops.every((s) => s.rgba.a > 0.99) - a.stops.every((s) => s.rgba.a > 0.99) || spread(b) - spread(a)
      )[0];
      shape = main.type;
      const under = solidBase ? base.c : behind.c;
      colours = main.stops.map((s) => {
        if (s.rgba.a < 0.99) transparentStops = true;
        return { colour: hex(s.rgba.a < 0.99 ? over(s.rgba.c, s.rgba.a, under) : s.rgba.c), pos: +s.pos.toFixed(4) };
      });
      lengthPx = main.lengthPx;
    } else if (base && base.a > 0) {
      kind = "flat";
      colours = [hex(base.a < 0.99 ? over(base.c, base.a, behind.c) : base.c)];
    } else {
      kind = "none";
    }
    let moves = null;
    if (watch && document.hidden)
      moves = {
        unknown: true,
        why: "the page is hidden, so its scroll animations are paused; read the page scripts for opacity or background changes"
      };
    else if (watch) {
      const from = Math.max(0, elTop - innerHeight), to = Math.min(document.documentElement.scrollHeight - innerHeight, elTop + el.offsetHeight);
      const samples = [];
      let reached = true;
      for (let i = 0; i <= 24; i++) {
        reached = await jump(from + (to - from) * i / 24) && reached;
        const c = getComputedStyle(el, pseudo);
        samples.push({ opacity: +c.opacity, bg: c.backgroundImage + c.backgroundColor });
      }
      const ops = samples.map((s) => s.opacity), minO = Math.min(...ops), maxO = Math.max(...ops);
      const bgChanges = new Set(samples.map((s) => s.bg)).size > 1;
      if (!reached)
        moves = {
          unknown: true,
          why: "scrolling is taken over by the page (smooth-scroll library?); read the page scripts"
        };
      else if (maxO - minO > 0.2 || bgChanges)
        moves = {
          fade: maxO - minO > 0.2 ? { from: +minO.toFixed(2), to: +maxO.toFixed(2) } : null,
          backgroundChanges: bgChanges
        };
    }
    if (scroll || watch) await jump(y0);
    const animated = cs.animationName !== "none" || /opacity|background|all/.test(cs.transitionProperty);
    const used = (p) => {
      const c = getComputedStyle(el, p).content;
      return c !== "none" && c !== "normal";
    };
    const freePseudo = pseudo ? null : !used("::after") ? "::after" : !used("::before") ? "::before" : null;
    return {
      selector: selector2,
      isPseudo: !!pseudo,
      kind,
      shape,
      colours,
      lengthPx,
      transparentStops,
      solidBase,
      existingGrain: layers.some((l) => {
        try {
          return /feTurbulence/i.test(decodeURIComponent(l));
        } catch {
          return false;
        }
      }),
      layers: { gradients: gradients.length, images: images.length },
      layerCount: layers.length,
      background: cs.backgroundImage === "none" ? null : cs.backgroundImage,
      lists: layers.length ? {
        size: cs.backgroundSize,
        position: cs.backgroundPosition,
        repeat: cs.backgroundRepeat,
        attachment: cs.backgroundAttachment,
        blend: cs.backgroundBlendMode
      } : null,
      behind: hex(behind.c),
      size: { w, h },
      position: cs.position,
      zIndex: cs.zIndex === "auto" ? null : +cs.zIndex,
      hostPosition: getComputedStyle(el).position,
      freePseudo,
      coveringMedia: !!media,
      onTop,
      overlays,
      moves: moves || (animated ? { animated: true } : null),
      photoError,
      viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      darkModeQuery: [...document.styleSheets].some((s) => {
        try {
          return [...s.cssRules].some((r) => r.media && /prefers-color-scheme/.test(r.media.mediaText));
        } catch {
          return false;
        }
      })
    };
  }

  // skills/grainy-gradients/scripts/browser/preview.mjs
  var hostOf = (sel) => sel.split(/(?=::)/)[0];
  var waitFor = (sel, ms = 8e3) => new Promise((res) => {
    const find = () => document.querySelector(hostOf(sel));
    const hit = find();
    if (hit) return res(hit);
    const mo = new MutationObserver(() => {
      const el = find();
      if (el) {
        mo.disconnect();
        res(el);
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => {
      mo.disconnect();
      res(null);
    }, ms);
  });
  var PICKS_KEY = "grain-preview:picks";
  var loadPicks = () => {
    try {
      return JSON.parse(localStorage.getItem(PICKS_KEY) || "{}");
    } catch {
      return {};
    }
  };
  var savePicks = (p) => {
    try {
      localStorage.setItem(PICKS_KEY, JSON.stringify(p));
    } catch {
    }
  };
  async function startPreview(SELECTOR, CALIBRATION) {
    const SELECTORS = SELECTOR.split("|").map((s) => s.trim()).filter(Boolean);
    const ORDER = ["none", "subtle", "medium", "strong", "even"];
    const LABEL = { none: "None", subtle: "Subtle", medium: "Medium", strong: "Strong", even: "Even" };
    const SCREEN_LABEL = { sdr: "Standard screen", hdr: "HDR / OLED screen", contrast: "High-contrast setting" };
    const myScreen = matchMedia(SCREEN_QUERIES.contrast).matches ? "contrast" : matchMedia(SCREEN_QUERIES.hdr).matches ? "hdr" : "sdr";
    const VIEW_KEY = "grain-preview:view:" + location.pathname;
    let view = { split: 50, current: 0, screen: myScreen };
    try {
      Object.assign(view, JSON.parse(sessionStorage.getItem(VIEW_KEY) || "{}"));
    } catch {
    }
    const saveView = () => {
      try {
        sessionStorage.setItem(VIEW_KEY, JSON.stringify(view));
      } catch {
      }
    };
    const picks = loadPicks();
    const pickKey = (sel) => `${location.pathname} ${sel}`;
    const css = document.createElement("style");
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
    const el = (tag, cls, html) => Object.assign(document.createElement(tag), { className: cls, innerHTML: html || "" });
    const bar = el("div", "gp-bar");
    const knob = el("button", "gp-knob", "⇔");
    knob.type = "button";
    knob.setAttribute("aria-label", "Drag to compare");
    const tagB = el("div", "gp-tag", "BEFORE");
    const tagA = el("div", "gp-tag", "AFTER");
    const panel = el(
      "div",
      "gp-panel",
      `<h4><span>Grain preview</span></h4><p class="gp-wait">Looking at ${SELECTORS.length} background${SELECTORS.length > 1 ? "s" : ""}…</p>`
    );
    document.body.append(bar, tagB, tagA, knob, panel);
    const targets = [];
    const failed = [];
    const opacityOf = (t) => {
      const h = document.querySelector(hostOf(t.sel));
      return h ? parseFloat(getComputedStyle(h, t.pseudo).opacity) : 0;
    };
    const place = (t) => {
      if (t.layer.isConnected) return;
      const target = document.querySelector(hostOf(t.sel));
      if (!target) return;
      if (getComputedStyle(target).position === "static") target.style.position = "relative";
      target.style.isolation = "isolate";
      const media = t.look.coveringMedia && [...target.querySelectorAll("img, video")].find(
        (m) => m.getBoundingClientRect().width >= target.getBoundingClientRect().width * 0.9
      );
      if (media) {
        Object.assign(t.layer.style, { position: "absolute", inset: "0", zIndex: "" });
        media.after(t.layer);
      } else if (!t.pseudo) {
        Object.assign(t.layer.style, { position: "absolute", inset: "0", zIndex: "-1" });
        target.prepend(t.layer);
      } else {
        const ps = getComputedStyle(target, t.pseudo);
        const z = parseInt(ps.zIndex, 10) || 0;
        const id = "gp-back-" + SELECTORS.indexOf(t.sel);
        if (!document.getElementById(id))
          document.head.append(
            Object.assign(document.createElement("style"), {
              id,
              textContent: `${t.sel} { z-index: ${z - 1} !important; }`
            })
          );
        Object.assign(t.layer.style, {
          position: ps.position === "fixed" ? "fixed" : "absolute",
          top: ps.top,
          right: ps.right,
          bottom: ps.bottom,
          left: ps.left,
          zIndex: String(z)
        });
        target.append(t.layer);
      }
    };
    const optionOf = (t) => picks[pickKey(t.sel)]?.option ?? t.C.recommended;
    const opacityFor = (p, screen) => p.screens?.[screen]?.opacity ?? p.screens?.sdr?.opacity ?? p.opacity;
    const grainFor = (p, screen) => p.screens?.[screen]?.grain ?? p.screens?.sdr?.grain ?? p.grain;
    const paint = (t) => {
      let o = optionOf(t);
      if (o !== "none" && !t.C.options[o]) o = t.C.recommended;
      if (o === "none") {
        t.layer.style.display = "none";
        return;
      }
      const p = t.C.options[o];
      Object.assign(t.layer.style, {
        display: "",
        backgroundImage: t.C.noise,
        backgroundSize: `${t.C.tile}px ${t.C.tile}px`,
        opacity: opacityFor(p, view.screen),
        mixBlendMode: p.blend
      });
    };
    const record = (t, option) => {
      picks[pickKey(t.sel)] = { option, look: { ...t.look, page: location.pathname } };
      savePicks(picks);
    };
    const describe = (t) => {
      const o = optionOf(t);
      if (o === "none") return "No grain.";
      const p = t.C.options[o];
      if (p.unreachable)
        return `${p.blend} at ${p.opacity} · only ${p.grain.toFixed(2)} L*: these colours barely take grain`;
      const ev = `${p.evenness < 0.5 ? "uneven" : "even"}: faint parts get ${Math.round(p.evenness * 100)}% as much`;
      return `${p.blend} at ${opacityFor(p, view.screen)} · ${grainFor(p, view.screen).toFixed(2)} L* of grain<br>${ev}${o === t.C.recommended ? " · recommended" : ""}`;
    };
    const current = () => targets[Math.min(view.current, targets.length - 1)];
    const buildPanel = () => {
      const t = current();
      const fails = failed.length ? `<p class="gp-wait">${failed.map(([s, w]) => `Couldn't measure ${s}: ${w}`.replace(/</g, "&lt;")).join("<br>")}</p>` : "";
      if (!t) {
        panel.innerHTML = `<h4><span>Grain preview</span></h4>${fails || `<p class="gp-wait">None of these backgrounds are on this page: ${SELECTORS.join(", ")}</p>`}`;
        return;
      }
      const opts = ORDER.filter((o) => o === "none" || t.C.options[o]);
      const total = (/* @__PURE__ */ new Set([...Object.keys(picks), ...targets.map((x) => pickKey(x.sel))])).size;
      panel.innerHTML = `
      <h4><span>Grain preview</span><span><button type="button" data-a="clear" title="Forget all picks">↺</button> <button type="button" data-a="min" title="Hide">–</button></span></h4>
      ${targets.length > 1 ? `<div class="gp-nav"><button type="button" data-a="prev" aria-label="Previous background">◀</button><span data-a="go" title="Scroll to it">${targets.indexOf(t) + 1} of ${targets.length} · ${t.sel}</span><button type="button" data-a="next" aria-label="Next background">▶</button></div>` : ""}
      <div class="gp-opts">${opts.map((o) => `<button type="button" data-o="${o}" class="${o === t.C.recommended ? "rec" : ""}" title="${o === t.C.recommended ? "Recommended" : ""}">${LABEL[o]}</button>`).join("")}</div>
      <p class="gp-read"></p>
      <label class="gp-screen">Screen <select data-a="screen">${Object.keys(SCREEN_LABEL).map(
        (s) => `<option value="${s}"${s === view.screen ? " selected" : ""}>${SCREEN_LABEL[s]}${s === myScreen ? " (yours)" : ""}</option>`
      ).join("")}</select></label>
      ${fails}
      <details><summary>Why</summary><pre>${t.C.report.replace(/</g, "&lt;")}</pre></details>
      <div class="gp-row"><button type="button" data-a="full">${view.split === 0 ? "Split" : "Full screen"}</button><button type="button" class="gp-use" data-a="use">${total > 1 ? `Copy picks (${total})` : "Use this one"}</button></div>`;
    };
    const render = () => {
      targets.forEach(paint);
      const t = current();
      if (!t) return;
      const o = optionOf(t);
      panel.querySelectorAll("[data-o]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.o === o)));
      const read = panel.querySelector(".gp-read");
      if (read) read.innerHTML = describe(t);
      position();
      saveView();
    };
    const position = () => {
      const x = view.split * innerWidth / 100;
      let anyOnScreen = false;
      for (const t of targets) {
        const r = t.layer.getBoundingClientRect();
        t.layer.style.clipPath = `inset(0 0 0 ${Math.max(0, x - r.left)}px)`;
        if (r.bottom > 0 && r.top < innerHeight && r.width > 0 && opacityOf(t) > 0.05 && t.layer.style.display !== "none")
          anyOnScreen = true;
      }
      bar.style.left = knob.style.left = `${x}px`;
      tagB.style.left = `${x - 78}px`;
      tagA.style.left = `${x + 12}px`;
      bar.hidden = knob.hidden = !anyOnScreen;
      tagB.hidden = !anyOnScreen || view.split < 8;
      tagA.hidden = !anyOnScreen || view.split > 92;
    };
    const watchMotion = () => {
      for (const t of targets) {
        if (t.sawFade) continue;
        const o = opacityOf(t);
        t.minO = Math.min(t.minO, o);
        t.maxO = Math.max(t.maxO, o);
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
      for (const t of targets) if (!picks[pickKey(t.sel)]) record(t, t.C.recommended);
      return Object.values(picks).map((p) => `grain: ${p.option}
${JSON.stringify(p.look)}`).join("\n");
    };
    panel.addEventListener("click", (e) => {
      const b = e.target.closest("button, [data-a=go]");
      if (!b) return;
      const t = current();
      if (b.dataset.o) {
        record(t, b.dataset.o);
        buildPanel();
        render();
      }
      const a = b.dataset.a;
      if (a === "clear") {
        for (const k of Object.keys(picks)) delete picks[k];
        savePicks(picks);
        buildPanel();
        render();
      }
      if (a === "min") {
        panel.classList.toggle("gp-min");
        b.textContent = panel.classList.contains("gp-min") ? "+" : "–";
      }
      if (a === "full") {
        view.split = view.split === 0 ? 50 : 0;
        buildPanel();
        render();
      }
      if (a === "prev" || a === "next" || a === "go") {
        if (a !== "go") view.current = (view.current + (a === "next" ? 1 : -1) + targets.length) % targets.length;
        current().layer.parentElement?.scrollIntoView({ behavior: "smooth", block: "center" });
        buildPanel();
        render();
      }
      if (a === "use") {
        const text = copyText();
        const label = b.textContent;
        const done = () => {
          b.textContent = "Copied, paste it to Claude";
          setTimeout(() => {
            b.textContent = label;
          }, 2500);
        };
        (navigator.clipboard?.writeText(text) || Promise.reject()).then(done, () => {
          prompt("Copy this and paste it to Claude:", text);
        });
      }
    });
    panel.addEventListener("change", (e) => {
      if (e.target.dataset.a === "screen") {
        view.screen = e.target.value;
        render();
      }
    });
    knob.addEventListener("pointerdown", (e) => {
      knob.setPointerCapture(e.pointerId);
      const move = (ev) => {
        view.split = Math.max(0, Math.min(100, ev.clientX / innerWidth * 100));
        position();
      };
      const up = () => {
        knob.removeEventListener("pointermove", move);
        knob.removeEventListener("pointerup", up);
        saveView();
      };
      knob.addEventListener("pointermove", move);
      knob.addEventListener("pointerup", up);
    });
    addEventListener(
      "scroll",
      () => {
        position();
        watchMotion();
      },
      { passive: true }
    );
    addEventListener("resize", position);
    setInterval(() => {
      position();
      watchMotion();
    }, 250);
    new MutationObserver(
      () => targets.forEach((t) => {
        if (!t.layer.isConnected) place(t);
      })
    ).observe(document.body, { childList: true, subtree: true });
    await Promise.all(
      SELECTORS.map(async (sel) => {
        const host = await waitFor(sel);
        if (!host) return;
        const [, pseudo = null] = sel.split(/(?=::)/);
        try {
          const look2 = await look(sel, { watch: false, scroll: false });
          const t = {
            sel,
            pseudo,
            look: look2,
            C: previewConfig(analyse(look2, CALIBRATION)),
            layer: el("div", "gp-layer"),
            sawFade: false
          };
          t.layer.setAttribute("aria-hidden", "true");
          t.minO = t.maxO = opacityOf(t);
          targets.push(t);
          targets.sort((a, b) => SELECTORS.indexOf(a.sel) - SELECTORS.indexOf(b.sel));
          place(t);
          buildPanel();
          render();
        } catch (err) {
          const why = String(err.message || err).replace(/^The look has no colours \(kind: photo\)\. /, "");
          failed.push([sel, why]);
          buildPanel();
          console.warn(`[grain preview] ${sel}: ${err.message || err}`);
        }
      })
    );
    buildPanel();
    render();
  }

  // skills/grainy-gradients/scripts/browser/page.entry.mjs
  var selector = document.currentScript?.dataset.grain;
  if (new URLSearchParams(location.search).has("grain")) {
    if (selector) startPreview(selector, calibration_default).catch((e) => console.warn(e.message || e));
    else console.warn('[grain preview] add data-grain="<selector>" to the script tag');
  }
})();
