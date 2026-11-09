// Builds dist/grain-page.js: look.js + the grain.js engine + preview.js + calibration,
// in one classic script that does nothing unless the page URL has ?grain.
//
//   node scripts/build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const here = p => new URL(p, import.meta.url);
const engine = readFileSync(here('./grain.js'), 'utf8')
  .split('// ==== CLI ====')[0]       // the Node command line isn't needed in the page
  .replace(/^export\s+/gm, '');       // modules → plain functions in one scope
const look = readFileSync(here('./look.js'), 'utf8');
const preview = readFileSync(here('./preview.js'), 'utf8');
const calibration = readFileSync(here('../calibration.json'), 'utf8');

const out = `// grain-page.js: grain skill page script (built by scripts/build.mjs; don't edit by hand).
// Temporary: Claude adds it to preview grain options, then removes it.
//   <script src="/js/grain-page.js" data-grain=".hero | .footer-band" defer></script>
// Does nothing unless the page URL has ?grain.
(() => {
  if (!new URLSearchParams(location.search).has('grain')) return;
  const SCRIPT = document.currentScript;
  const SELECTOR = SCRIPT?.dataset.grain;
  if (!SELECTOR) { console.warn('[grain preview] add data-grain="<selector>" to the script tag'); return; }
  const CALIBRATION = ${calibration.trim()};
${look}
${engine}
${preview}
  startPreview().catch(e => console.warn(e.message || e));
})();
`;
mkdirSync(here('../dist/'), { recursive: true });
writeFileSync(here('../dist/grain-page.js'), out);
console.log(`dist/grain-page.js written (${(out.length / 1024).toFixed(1)} KB)`);

// The same look + engine for the headless tools (shoot, review, check), on window.__grain.
const core = `// grain-core.js: grain skill engine for headless Chrome (built by scripts/build.mjs; don't edit by hand).
(() => {
  const CALIBRATION = ${calibration.trim()};
${look}
${engine}
  // Apply one option's CSS to the page (and the extra element the child method needs).
  const apply = (a, option, screen = 'sdr') => {
    remove();
    if (option === 'none') return;
    let r = a.results[option];
    if (screen !== 'sdr' && r.screens?.[screen]) r = { ...r, screens: { sdr: r.screens[screen] } };
    const css = cssFor(a.method, a.look, r);
    document.head.append(Object.assign(document.createElement('style'), { id: 'grain-shot', textContent: css }));
    if (a.method === 'child') {
      const host = document.querySelector(a.look.selector.split('::')[0]);
      const d = Object.assign(document.createElement('div'), { className: 'grain-layer', id: 'grain-shot-layer' });
      d.setAttribute('aria-hidden', 'true');
      const media = a.look.coveringMedia && [...host.querySelectorAll('img, video')].find(m => m.getBoundingClientRect().width >= host.getBoundingClientRect().width * 0.9);
      if (media) media.after(d); else a.look.isPseudo ? host.append(d) : host.prepend(d);
    }
  };
  const remove = () => { document.getElementById('grain-shot')?.remove(); document.getElementById('grain-shot-layer')?.remove(); };
  window.__grain = { CALIBRATION, look: window.grainLook, analyse: l => analyse(l, CALIBRATION), cssFor, apply, remove, LEVELS };
})();
`;
writeFileSync(here('../dist/grain-core.js'), core);
console.log(`dist/grain-core.js written (${(core.length / 1024).toFixed(1)} KB)`);
