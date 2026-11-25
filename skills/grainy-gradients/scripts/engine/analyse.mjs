// The whole job for one background: every option, the recommended one, the CSS and a
// plain-language report. Input is a "look" (see browser/look.mjs).
import { DITHER_MIN, EVEN_MIN } from './measure.mjs';
import { LEVELS, recommend } from './recommend.mjs';
import { chooseMethod, cssFor, withoutOldGrain } from './css.mjs';

const pct = v => `${Math.round(v * 100)}%`;
const sign = v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;

export function analyse(look, calibration) {
  if (!look?.colours?.length)
    throw new Error(
      `The look has no colours (kind: ${look?.kind}). ${look?.kind === 'photo' ? 'The image could not be read (cross-origin?). Pass a few representative colours by hand.' : 'Run look.js on the element that paints the background.'}`,
    );
  const base = {
    colours: look.colours,
    kind: look.kind,
    shape: look.shape || 'linear',
    lengthPx: look.lengthPx || 0,
    calibration,
    fadeOver: look.moves?.fade ? look.behind : null,
  };
  const results = Object.fromEntries(LEVELS.map(level => [level, recommend({ ...base, level })]));
  const method = chooseMethod(look);
  const css = Object.fromEntries(LEVELS.map(l => [l, cssFor(method, look, results[l])]));
  const m = results.medium,
    e = results.even;
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
  ]
    .filter(Boolean)
    .join(', ');

  const lines = [`What it is: ${what}.`];
  if (r.unreachable) {
    lines.push(
      `Most it can do: these colours are close to ${r.L > 50 ? 'white' : 'black'}, where grain barely shows without tinting them. ${r.blend} at 1 gives ${r.measured.grain.toFixed(2)} L* (target ${r.target}) with no brightness change${r.measured.grain < 0.45 ? ', which is below what people can see; consider skipping this one' : ''}.`,
    );
  } else {
    lines.push(
      `Chosen: ${recommended} — ${r.blend} at ${r.opacity}, ${r.measured.grain.toFixed(2)} L* of grain (target ${r.target}), brightness ${sign(r.measured.shift)} L*.` +
        (r.fallback
          ? ` Overlay and soft-light can't reach the target on colours this close to black or white, so it uses ${r.blend}, which shifts brightness a little.`
          : ''),
    );
  }
  lines.push(
    `Method: ${method === 'one-layer' ? `one layer on ${look.selector} (the noise becomes its top background layer)${look.moves?.fade ? ', so the grain fades in with it and the colour underneath stays clean' : ''}` : method === 'layer' ? `a ${look.freePseudo || '::after'} layer on ${look.selector}, under its content` : `a child element${look.isPseudo ? ', because the background is on a pseudo-element' : look.coveringMedia ? ', because an image or video fills the element' : ''}`}.`,
  );
  if (look.transparentStops && !look.solidBase && method !== 'one-layer')
    lines.push('The gradient is see-through, so the grain sits on its own layer to blend with what shows through.');
  lines.push(
    evenSame
      ? `Evenness: ${pct(m.measured.evenness)}${uneven ? ', and no blend spreads it more evenly' : ''}.`
      : uneven
        ? `Evenness: uneven — the faintest part gets ${pct(m.measured.evenness)} of the grain of the strongest part (${m.measured.darkest} vs ${m.measured.lightest} L*). Even: ${e.blend} at ${e.opacity}, ${pct(e.measured.evenness)}.`
        : `Evenness: even enough (${pct(m.measured.evenness)}).`,
  );
  if (m.banding.risk === 'high' || m.banding.risk === 'medium') {
    lines.push(
      `Banding: ${m.banding.risk} risk, ~${m.banding.pxPerLevel}px per colour level. ${r.measured.dither >= DITHER_MIN ? 'The chosen grain breaks it up.' : 'The chosen grain is too faint to fully break it up; Strong does more if stripes show.'}`,
    );
  }
  if (r.stages)
    lines.push(
      `Fade stages (${recommended}): ` +
        r.stages.map(s => `${pct(s.fade)} → ${s.grain.toFixed(2)}${s.fade === 0 ? ' (clean)' : ''}`).join(', ') +
        '.',
    );
  if (r.screens) {
    const s = r.screens,
      bits = [`standard screens ${s.sdr.opacity} (${s.sdr.grain.toFixed(2)} L*)`];
    if (s.hdr) bits.push(`HDR screens such as OLED phones ${s.hdr.opacity} (${s.hdr.grain.toFixed(2)} L*)`);
    if (s.contrast) bits.push(`the high-contrast setting ${s.contrast.opacity} (${s.contrast.grain.toFixed(2)} L*)`);
    lines.push(`Screens: ${bits.join(', ')}; off when printed.`);
  }
  const bare = (look.overlays || []).filter(o => !o.grained);
  if (bare.length)
    lines.push(
      `Fades on top: ${bare.map(o => o.selector).join(', ')} ${bare.length > 1 ? 'are' : 'is a'} see-through gradient${bare.length > 1 ? 's' : ''} over this background. ${bare.length > 1 ? 'They cover' : 'It covers'} the grain, so where ${bare.length > 1 ? 'they are' : 'it is'} darkest the colour can band into lines again. Give ${bare.length > 1 ? 'each' : 'it'} the same grain tile, lined up: a solid colour with the noise blended in (background-blend-mode), faded with mask-image instead of a transparent gradient.`,
    );
  if (look.existingGrain)
    lines.push(
      withoutOldGrain(look).replacedGrain
        ? 'The background already had a noise layer: the CSS replaces it.'
        : "The background already has a noise layer somewhere else (a pseudo-element or child): remove it, don't add a second.",
    );
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
    options: Object.fromEntries(
      LEVELS.filter(
        l =>
          !(l === 'even' && a.evenSame) &&
          !(
            l === 'strong' &&
            a.results.medium.unreachable &&
            a.results.strong.opacity === a.results.medium.opacity &&
            a.results.strong.blend === a.results.medium.blend
          ),
      ).map(l => {
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
            screens: r.screens,
          },
        ];
      }),
    ),
    noise: a.results.medium.urls.layer,
    tile: a.results.medium.settings.tile,
  };
}
