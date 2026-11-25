// Measures what a noise layer does to a background: visible grain, brightness shift,
// evenness and whether it is strong enough to break up banding.
import { BLEND, Lstar, lumY, lightness, parseColour, toHex, mean, sd, pctl } from './colour.mjs';

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
  const v = noise.v || noise,
    a = noise.a || null,
    f = BLEND[blend];
  const o = over ? parseColour(over).map(x => x / 255) : null;
  const mix = (layer, k) => (o ? (1 - t) * o[k] + t * layer : layer);
  const grains = [],
    shifts = [],
    dithers = [];
  for (const c of colours) {
    const [br, bg, bb] = parseColour(c).map(x => x / 255);
    const L0 = Lstar(lumY(mix(br, 0), mix(bg, 1), mix(bb, 2)));
    const Ls = new Float32Array(v.length),
      lv = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) {
      const al = (a ? a[i] : 1) * opacity,
        s = v[i];
      const r = mix(br + al * (f(br, s) - br), 0),
        g = mix(bg + al * (f(bg, s) - bg), 1),
        b = mix(bb + al * (f(bb, s) - bb), 2);
      Ls[i] = Lstar(lumY(r, g, b));
      lv[i] = ((r + g + b) / 3) * 255;
    }
    grains.push(sd(Ls));
    shifts.push(mean(Ls) - L0);
    dithers.push(sd(lv));
  }
  const hi = pctl(grains, 0.9),
    lo = pctl(grains, 0.1);
  return {
    grain: mean(grains),
    shift: mean(shifts),
    dither: pctl(dithers, 0.1),
    perColour: grains,
    evenness: hi > 0 ? lo / hi : 1,
  };
}

/** Opacity (0–1, 2 dp) that gives the target visible grain, or null if it can't. */
export function solveOpacity(noise, colours, blend, target) {
  if (measure(noise, colours, blend, 1).grain < target) return null;
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    if (measure(noise, colours, blend, mid).grain < target) lo = mid;
    else hi = mid;
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
    return {
      fade: t,
      L: +L.toFixed(1),
      grain: +m.grain.toFixed(3),
      lightest: +pctl(m.perColour, 0.9).toFixed(3),
      darkest: +pctl(m.perColour, 0.1).toFixed(3),
    };
  });
}

// ---------------------------------------------------------------------------
// Background reading
// ---------------------------------------------------------------------------
export const DITHER_MIN = 0.7; // noise spread (8-bit levels) that breaks up banding
export const EVEN_MIN = 0.5; // below this, the faintest part gets under half the grain of the strongest

/** Tone from area-weighted mean L*: dark < 25 ≤ mid < 70 ≤ light. */
export const toneOf = L => (L < 25 ? 'dark' : L < 70 ? 'mid' : 'light');

/** Accepts ['#a', '#b'] or [{colour, pos}] and returns stops with positions (0–1). */
export function toStops(colours) {
  return colours.map((c, i) =>
    typeof c === 'object' && !Array.isArray(c) && c.colour
      ? { colour: c.colour, pos: c.pos ?? i / Math.max(1, colours.length - 1) }
      : { colour: c, pos: colours.length === 1 ? 0 : i / (colours.length - 1) },
  );
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
        const span = s[i].pos - s[i - 1].pos || 1,
          k = (t - s[i - 1].pos) / span;
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
    const a = parseColour(stops[i - 1].colour),
      b = parseColour(stops[i].colour);
    const px = (stops[i].pos - stops[i - 1].pos) * lengthPx;
    const levels = Math.max(...a.map((v, k) => Math.abs(v - b[k])));
    if (levels === 0) continue; // a flat stretch can't band
    worst = Math.max(worst, px / levels);
  }
  return {
    pxPerLevel: Math.round(worst * 10) / 10,
    risk: worst === 0 ? 'none' : worst < 2 ? 'low' : worst < 6 ? 'medium' : 'high',
  };
}
