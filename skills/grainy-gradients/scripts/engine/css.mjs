// Chooses how the grain is attached to the page and writes the CSS for it.
import { noiseSvg, svgUrl } from './noise.mjs';
import { SCREEN_QUERIES } from './recommend.mjs';

/**
 * How to attach the grain, from what look.js saw:
 *   'one-layer': add the noise as the top background layer of the element itself
 *                (background-blend-mode). Gradients and flat colours with a solid base.
 *   'layer':     a free ::after (or ::before) on the element. Photos and image backgrounds.
 *   'child':     a child element. When the target is a pseudo-element, both pseudos are taken,
 *                or the background is an <img>/<video> filling the element.
 */
export function chooseMethod(look) {
  const imageLayers =
    look.layers?.images ??
    (/url\(/.test(look.background || '') && !/data:image\/svg/.test(look.background || '') ? 1 : 0);
  // background-blend-mode only blends with the element's own layers. If the gradient is
  // see-through with nothing solid under it, the noise would paint as grey haze.
  const seeThrough = look.transparentStops && !look.solidBase;
  if (!look.coveringMedia && (look.kind === 'gradient' || look.kind === 'flat') && !imageLayers && !seeThrough)
    return 'one-layer';
  if (look.isPseudo || look.coveringMedia || !look.freePseudo) return 'child';
  return 'layer';
}

/** Split a CSS list on top-level commas (not the ones inside brackets). */
export function splitLayers(s) {
  const out = [];
  let depth = 0,
    cur = '';
  for (const ch of String(s || '')) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const layerCount = look => look.layerCount || splitLayers(look.backgroundSource || look.background).length || 1;
const listFor = (look, key, fallback) => look.lists?.[key] || Array(layerCount(look)).fill(fallback).join(', ');
/** The look without an old noise layer, so new grain replaces it instead of stacking. */
export function withoutOldGrain(look) {
  const bg = look.backgroundSource || look.background;
  const layers = splitLayers(bg);
  const old = layers.map(l => /feTurbulence/i.test(l));
  if (!old.some(Boolean)) return look;
  const keep = list =>
    splitLayers(list)
      .filter((_, i) => !old[i])
      .join(', ');
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
  const s = r.screens || {},
    out = [];
  for (const k of ['hdr', 'contrast'])
    if (s[k]) out.push(`@media ${SCREEN_QUERIES[k]} {\n  ${sel} { ${decl(s[k].opacity)} }\n}`);
  out.push(`@media print {\n  ${sel} { ${decl(null)} }\n}`);
  return out.join('\n');
};

export function cssFor(method, look, r) {
  look = withoutOldGrain(look);
  const sel = look.selector,
    size = `${r.settings.tile}px ${r.settings.tile}px`;
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
    if (look.lists?.attachment && /fixed/.test(look.lists.attachment))
      lines.push(`  background-attachment: ${look.lists.attachment.split(',')[0].trim()}, ${look.lists.attachment};`);
    return `${sel} {\n${lines.join('\n')}\n}\n${screenRules(sel, r, o => `--grain: ${o == null ? 'none' : baked(o)};`)}`;
  }
  const host = look.isPseudo ? sel.split('::')[0] : sel;
  const hostRule = [
    look.hostPosition === 'static' || (!look.isPseudo && look.position === 'static') ? '  position: relative;' : null,
    '  isolation: isolate;',
  ]
    .filter(Boolean)
    .join('\n');
  const body = `  pointer-events: none;\n  background-image: ${r.urls.layer};\n  background-size: ${size};\n  opacity: ${base};\n  mix-blend-mode: ${r.blend};`;
  const layerDecl = o => (o == null ? 'display: none;' : `opacity: ${o};`);
  if (method === 'child') {
    const pos = look.isPseudo && look.position === 'fixed' ? 'fixed' : 'absolute';
    // Over a photo or video the grain has to paint above it: right after it in the page,
    // with no z-index, so the content that follows still sits on top.
    const where = look.coveringMedia
      ? ', right after the <img> or <video> that fills it'
      : look.isPseudo
        ? ', right after its other content'
        : ', as its first child';
    const z = look.coveringMedia ? '' : `  z-index: ${look.isPseudo ? (look.zIndex ?? -1) : -1};\n`;
    // Scoped to the host so the site's own rules (say `.hero > div { position: relative }`)
    // can't pull the layer into the layout.
    const layerSel = `${host} > .grain-layer`;
    return `/* Add <div class="grain-layer" aria-hidden="true"></div> inside ${host}${where}. */\n${host} {\n${hostRule}\n}\n${layerSel} {\n  position: ${pos} !important;\n  inset: 0;\n  margin: 0;\n${z}${body}\n}\n${screenRules(layerSel, r, layerDecl)}`;
  }
  const pseudo = look.freePseudo || '::after';
  return `${host} {\n${hostRule}\n}\n${host}${pseudo} {\n  content: "";\n  position: absolute;\n  inset: 0;\n  z-index: -1;\n${body}\n}\n${screenRules(host + pseudo, r, layerDecl)}`;
}
