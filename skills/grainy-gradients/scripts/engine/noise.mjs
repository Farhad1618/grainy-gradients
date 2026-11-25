// The browser's <feTurbulence> noise, reproduced in plain JavaScript so grain can be measured
// without a browser. A port of the SVG 1.1 reference implementation (fractalNoise, seed 0).
const BSize = 0x100,
  BM = 0xff,
  PerlinN = 0x1000;
const RAND_m = 2147483647,
  RAND_a = 16807,
  RAND_q = 127773,
  RAND_r = 2836;

const setupSeed = s => {
  if (s <= 0) s = -(s % (RAND_m - 1)) + 1;
  if (s > RAND_m - 1) s = RAND_m - 1;
  return s;
};
const rand = s => {
  s = RAND_a * (s % RAND_q) - RAND_r * Math.floor(s / RAND_q);
  if (s <= 0) s += RAND_m;
  return s;
};

const makeLattice = seed => {
  const lattice = new Int32Array(BSize + BSize + 2);
  const grad = [0, 1, 2, 3].map(() => Array.from({ length: BSize + BSize + 2 }, () => [0, 0]));
  let s = setupSeed(seed),
    i;
  for (let k = 0; k < 4; k++) {
    for (i = 0; i < BSize; i++) {
      lattice[i] = i;
      for (let j = 0; j < 2; j++) {
        s = rand(s);
        grad[k][i][j] = ((s % (BSize + BSize)) - BSize) / BSize;
      }
      const g = grad[k][i],
        n = Math.sqrt(g[0] * g[0] + g[1] * g[1]) || 1;
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

const sCurve = t => t * t * (3 - 2 * t);
const lerp = (t, a, b) => a + t * (b - a);

const noise2 = (L, ch, vx, vy, st) => {
  let t = vx + PerlinN;
  let bx0 = Math.trunc(t) & BM,
    bx1 = (bx0 + 1) & BM;
  const rx0 = t - Math.trunc(t),
    rx1 = rx0 - 1;
  t = vy + PerlinN;
  let by0 = Math.trunc(t) & BM,
    by1 = (by0 + 1) & BM;
  const ry0 = t - Math.trunc(t),
    ry1 = ry0 - 1;
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
  const i = L.lattice[bx0],
    j = L.lattice[bx1];
  const b00 = L.lattice[i + by0],
    b10 = L.lattice[j + by0],
    b01 = L.lattice[i + by1],
    b11 = L.lattice[j + by1];
  const sx = sCurve(rx0),
    sy = sCurve(ry0),
    g = L.grad[ch];
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

const turbulence = (L, ch, px, py, freq, octaves, tile) => {
  let fx = freq,
    fy = freq,
    st = null;
  if (tile) {
    // stitchTiles="stitch"
    const lo = Math.floor(tile * fx) / tile,
      hi = Math.ceil(tile * fx) / tile;
    fx = fy = lo && fx / lo < hi / fx ? lo : hi;
    const w = Math.trunc(tile * fx + 0.5);
    st = { width: w, height: w, wrapX: Math.trunc(fx * 0 + PerlinN + w), wrapY: Math.trunc(fy * 0 + PerlinN + w) };
  }
  let sum = 0,
    vx = px * fx,
    vy = py * fy,
    ratio = 1;
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
  const out = new Float32Array(n),
    total = tile * tile,
    step = total / n;
  for (let k = 0; k < n; k++) {
    const p = Math.floor(k * step),
      x = p % tile,
      y = Math.floor(p / tile);
    const c = [0, 1, 2].map(ch =>
      Math.min(1, Math.max(0, (turbulence(lattice0, ch, x, y, freq, octaves, tile) + 1) / 2)),
    );
    out[k] = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  sampleCache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------
// Noise tile
// ---------------------------------------------------------------------------
export function noiseSvg({ freq = 0.8, octaves = 3, tile = 200, alpha = 1 } = {}) {
  const a = Math.round(alpha * 1000) / 1000;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${tile}">` +
    `<filter id="n" color-interpolation-filters="sRGB">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${octaves}" stitchTiles="stitch"/>` +
    `<feColorMatrix type="saturate" values="0"/>` +
    `<feComponentTransfer><feFuncA type="linear" slope="0" intercept="${a}"/></feComponentTransfer>` +
    `</filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`
  );
}
export const svgUrl = svg => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
