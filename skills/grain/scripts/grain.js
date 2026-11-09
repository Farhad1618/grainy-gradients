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
export function noiseSample({ freq = 0.8, octaves = 3, tile = 200, n = 3000 } = {}) {
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
export const lightness = rgb => Lstar(lumY(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255));


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
export function parseColour(c) {
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
export const BLEND = {
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
export function measure(noise, colours, blend, opacity, over = null, t = 1) {
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
export function solveOpacity(noise, colours, blend, target) {
  if (measure(noise, colours, blend, 1).grain < target) return null;
  let lo = 0, hi = 1;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    if (measure(noise, colours, blend, mid).grain < target) lo = mid; else hi = mid;
  }
  return Math.max(0.01, Math.round(hi * 100) / 100);
}

/** Visible grain at each stage of a fade-in over another colour. */
export const FADE_STEPS = [0, 0.25, 0.5, 0.75, 1];
export function fadeStages(noise, colours, blend, opacity, over) {
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
export const DITHER_MIN = 0.7; // noise spread (8-bit levels) that breaks up banding
export const EVEN_MIN = 0.5;   // below this, the faintest part gets under half the grain of the strongest

/** Tone from area-weighted mean L*: dark < 25 ≤ mid < 70 ≤ light. */
export const toneOf = L => (L < 25 ? 'dark' : L < 70 ? 'mid' : 'light');

/** Accepts ['#a', '#b'] or [{colour, pos}] and returns stops with positions (0–1). */
export function toStops(colours) {
  return colours.map((c, i) => (typeof c === 'object' && !Array.isArray(c) && c.colour)
    ? { colour: c.colour, pos: c.pos ?? i / Math.max(1, colours.length - 1) }
    : { colour: c, pos: colours.length === 1 ? 0 : i / (colours.length - 1) });
}

/**
 * Colours along the gradient, each standing for an equal share of its area, so a stop that
 * covers 3% of the gradient counts 3%, not as much as one covering 90%. Linear: evenly along
 * the line. Radial: by ring area (outer rings are bigger), so t = √((i + ½) / n).
 */
export function sampleGradient(stops, shape = 'linear', n = 24) {
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
export function banding(stops, lengthPx) {
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
export function noiseSvg({ freq = 0.8, octaves = 3, tile = 200, alpha = 1 } = {}) {
  const a = Math.round(alpha * 1000) / 1000;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${tile}">` +
    `<filter id="n" color-interpolation-filters="sRGB">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${octaves}" stitchTiles="stitch"/>` +
    `<feColorMatrix type="saturate" values="0"/>` +
    `<feComponentTransfer><feFuncA type="linear" slope="0" intercept="${a}"/></feComponentTransfer>` +
    `</filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`;
}
export const svgUrl = svg => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

// Neutral blends: centred noise leaves the average brightness alone.
const BLENDS = ['overlay', 'soft-light'];
// Used only when neither neutral blend can reach the target (pure black, pure white):
// they do add grain there, at the cost of a small brightness shift.
const FALLBACK_BLENDS = ['screen', 'multiply'];
// A fallback blend may shift brightness this much (L*) at most; past that it reads as a tint.
export const MAX_SHIFT = 1;
export const LEVELS = ['subtle', 'medium', 'strong', 'even'];

/**
 * Recommend grain for a background.
 *   colours: gradient stops (['#hex', ...] or [{colour, pos}]) or sampled photo colours
 *   kind: 'gradient' | 'photo' | 'flat';  shape: 'linear' | 'radial' | 'conic'
 *   lengthPx: how far the gradient runs on screen (for banding)
 *   level: 'subtle' | 'medium' | 'strong' | 'even' (Medium's amount, spread as evenly as possible)
 *   fadeOver: colour behind the layer if it fades in, to measure the stages of the fade
 */
export function recommend({ colours, kind = 'gradient', shape = 'linear', lengthPx = 0, level = 'medium', calibration, fadeOver = null, grain: g = {}, sampleSize = 3000 }) {
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
export const SCREEN_QUERIES = { hdr: '(dynamic-range: high)', contrast: '(prefers-contrast: more)' };
export function screenVariants({ noise, cols, blend, opacity, grain, target, tone, screens: sc }) {
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
export function chooseMethod(look) {
  const imageLayers = look.layers?.images ?? (/url\(/.test(look.background || '') && !/data:image\/svg/.test(look.background || '') ? 1 : 0);
  // background-blend-mode only blends with the element's own layers. If the gradient is
  // see-through with nothing solid under it, the noise would paint as grey haze.
  const seeThrough = look.transparentStops && !look.solidBase;
  if (!look.coveringMedia && (look.kind === 'gradient' || look.kind === 'flat') && !imageLayers && !seeThrough) return 'one-layer';
  if (look.isPseudo || look.coveringMedia || !look.freePseudo) return 'child';
  return 'layer';
}

/** Split a CSS list on top-level commas (not the ones inside brackets). */
export function splitLayers(s) {
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

export function cssFor(method, look, r) {
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

export function analyse(look, calibration) {
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
export function previewConfig(a) {
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

// ==== CLI ====
// Resolve symlinks: skills are often installed as a link to the repo.
const isMain = typeof window === 'undefined' && typeof process !== 'undefined' && process.argv?.[1] && await (async () => {
  const { realpathSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isMain) {
  const { readFileSync } = await import('node:fs');
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && (!all[i + 1].startsWith('--') || all[i + 1] === '-') ? all[i + 1] : true]);
    return acc;
  }, []));
  const calibration = JSON.parse(readFileSync(new URL('../calibration.json', import.meta.url), 'utf8'));

  // Each job: one background and the option picked for it.
  const jobs = [];
  if (args.look) {
    const text = args.look === '-' ? readFileSync(0, 'utf8') : readFileSync(args.look, 'utf8');
    // Accept a bare look, or the text copied from the preview: one or more
    // "grain: <option>" lines, each followed by that background's look JSON on one line.
    const blocks = [...text.matchAll(/^grain:\s*(\w+)\s*\n\s*(\{.*\})\s*$/gm)];
    if (blocks.length) for (const [, option, json] of blocks) jobs.push({ look: JSON.parse(json), option: args.option && args.option !== true ? args.option : option });
    else jobs.push({ look: JSON.parse(text.slice(text.indexOf('{'))), option: args.option });
  } else if (args.colours) {
    jobs.push({ option: args.option, look: {
      selector: args.selector || '.grain',
      kind: args.kind || 'gradient',
      shape: args.shape || 'linear',
      colours: String(args.colours).split(/,(?![^(]*\))/).map(s => {
        const [colour, p] = s.trim().split('@');
        return p ? { colour, pos: parseFloat(p) / 100 } : colour;
      }),
      lengthPx: +args.length || 0,
      background: args.background || null,
      position: args.position || 'relative',
      solidBase: true,
      freePseudo: '::after',
      behind: args['fade-over'] || null,
      moves: args['fade-over'] ? { fade: true } : null,
    } });
  } else {
    console.error('Usage:\n  node grain.js --look picks.txt|look.json|- [--option subtle|medium|strong|even] [--json]\n  node grain.js --colours "#hex,#hex[@pos%],..." [--kind gradient|photo|flat] [--shape linear|radial] [--length px] [--selector .x] [--background "linear-gradient(...)"] [--fade-over "#hex"] [--json]');
    process.exit(1);
  }

  const all = [];
  for (const { look, option } of jobs) {
    const a = analyse(look, calibration);
    if (args.json) { all.push({ selector: look.selector, option: option || a.recommended, report: a.report, method: a.method, recommended: a.recommended, evenSame: a.evenSame, results: a.results, css: a.css }); continue; }
    const head = jobs.length > 1 ? `/* ==== ${look.selector}${look.page ? ` (${look.page})` : ''} ==== */\n` : '';
    if (option && option !== true) {
      if (option === 'none' || option === 'skip') { console.log(`${head}/* ${look.selector}: no grain (${option}) */\n`); continue; }
      if (!a.css[option]) { console.error(`No option "${option}". Options: ${LEVELS.join(', ')}`); process.exit(1); }
      const r = a.results[option];
      console.log(`${head}/* Grain (grain skill, ${option}): ${r.tone} ${look.kind}, ${r.blend} at ${r.screens?.sdr?.opacity ?? r.opacity}, ${r.measured.grain.toFixed(2)} L*; adapts to HDR and high-contrast screens, off in print. */\n${a.css[option]}\n`);
    } else {
      console.log(head + a.report + '\n');
      console.log(`/* ${a.recommended} */\n${a.css[a.recommended]}\n`);
    }
  }
  if (args.json) console.log(JSON.stringify(all.length === 1 ? all[0] : all, null, 2));
}
