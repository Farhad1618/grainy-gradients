// Colour maths: parsing, CIELAB lightness (L*), the W3C blend formulas and small statistics.
const lin = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
// sRGB → linear via a 4096-step table (measure() calls this millions of times).
const LIN = Float64Array.from({ length: 4096 }, (_, i) => lin(i / 4095));
const linT = v => LIN[Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 4095)];
export const lumY = (r, g, b) => 0.2126 * linT(r) + 0.7152 * linT(g) + 0.0722 * linT(b);
export const Lstar = y => (y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y);
export const lightness = rgb => Lstar(lumY(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255));

const NAMED = {
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
  orange: [255, 165, 0],
};
const hslToRgb = (h, s, l) => {
  h = ((h % 360) + 360) % 360;
  s /= 100;
  l /= 100;
  const k = n => (n + h / 30) % 12,
    a = s * Math.min(l, 1 - l);
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
  if (m)
    return m[1]
      .split(/[ ,/]+/)
      .filter(Boolean)
      .slice(0, 3)
      .map(v => (v.endsWith('%') ? parseFloat(v) * 2.55 : Number(v)));
  m = s.match(/hsla?\(([^)]+)\)/);
  if (m) {
    const [h, sat, l] = m[1]
      .split(/[ ,/]+/)
      .filter(Boolean)
      .map(parseFloat);
    return hslToRgb(h, sat, l);
  }
  throw new Error(`Can't read colour "${c}". Convert it to hex first (look.js does this in the browser).`);
}
export const toHex = c =>
  '#' +
  c
    .map(v =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');

const softD = b => (b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b));
export const BLEND = {
  normal: (b, s) => s,
  multiply: (b, s) => b * s,
  screen: (b, s) => b + s - b * s,
  overlay: (b, s) => (b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)),
  'soft-light': (b, s) => (s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * (softD(b) - b)),
};

export const mean = a => {
  let t = 0;
  for (const v of a) t += v;
  return t / a.length;
};
export const sd = a => {
  const m = mean(a);
  let t = 0;
  for (const v of a) t += (v - m) ** 2;
  return Math.sqrt(t / a.length);
};
export const pctl = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
};
