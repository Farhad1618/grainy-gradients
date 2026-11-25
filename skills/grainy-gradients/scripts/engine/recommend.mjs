// Picks the blend mode and opacity that hit a visible-grain target, for every kind of screen.
import { lightness, parseColour, mean, pctl } from './colour.mjs';
import { noiseSample, noiseSvg, svgUrl } from './noise.mjs';
import { measure, solveOpacity, fadeStages, toneOf, toStops, sampleGradient, banding } from './measure.mjs';

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
export function recommend({
  colours,
  kind = 'gradient',
  shape = 'linear',
  lengthPx = 0,
  level = 'medium',
  calibration,
  fadeOver = null,
  grain: g = {},
  sampleSize = 3000,
}) {
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

  const solve = blends =>
    blends.map(blend => {
      const opacity = solveOpacity(noise, cols, blend, target);
      return opacity == null
        ? { blend, reachable: false }
        : { blend, opacity, reachable: true, ...measure(noise, cols, blend, opacity) };
    });
  let options = solve(BLENDS),
    fallback = false;
  if (!options.some(o => o.reachable)) {
    const fb = solve(FALLBACK_BLENDS).map(o =>
      o.reachable && Math.abs(o.shift) > MAX_SHIFT ? { ...o, reachable: false, tooMuchShift: true } : o,
    );
    options = options.concat(fb);
    fallback = fb.some(o => o.reachable);
  }
  const ok = options.filter(o => o.reachable);
  ok.sort(
    level === 'even'
      ? (a, b) => b.evenness - a.evenness || Math.abs(a.shift) - Math.abs(b.shift)
      : (a, b) => Math.abs(a.shift) - Math.abs(b.shift) || a.opacity - b.opacity,
  );
  let pick = ok[0],
    unreachable = false;
  if (!pick) {
    // nothing reaches it: take the most grain any blend can give, and say so
    unreachable = true;
    // Neutral blends only: a fallback strong enough to beat them would tint the colour.
    pick = BLENDS.map(blend => ({ blend, opacity: 1, ...measure(noise, cols, blend, 1) })).sort(
      (a, b) => b.grain - a.grain,
    )[0];
  }
  const band = kind === 'gradient' ? banding(stops, lengthPx) : { pxPerLevel: 0, risk: 'none' };
  const stages = fadeOver ? fadeStages(noise, cols, pick.blend, pick.opacity, fadeOver) : null;
  const confirmed = (calibration.confirmed || []).some(c => c.group === group && c.tone === tone && c.picked);
  const screens = unreachable
    ? null
    : screenVariants({
        noise,
        cols,
        blend: pick.blend,
        opacity: pick.opacity,
        grain: pick.grain,
        target,
        tone,
        screens: calibration.screens,
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
      darkest: +pctl(pick.perColour, 0.1).toFixed(3),
    },
    banding: band,
    stages,
    settings,
    screens,
    options: options.map(({ perColour, ...o }) => o),
    urls: {
      layer: svgUrl(noiseSvg({ ...settings, alpha: 1 })),
      baked: svgUrl(noiseSvg({ ...settings, alpha: pick.opacity })),
    },
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
