// Entry for assets/grain-page.js, the temporary in-page preview:
//
//   <script src="/js/grain-page.js" data-grain=".hero | .footer-band" defer></script>
//
// It does nothing unless the page URL has ?grain.
import calibration from '../../calibration.json' with { type: 'json' };
import { startPreview } from './preview.mjs';

const selector = document.currentScript?.dataset.grain;
if (new URLSearchParams(location.search).has('grain')) {
  if (selector) startPreview(selector, calibration).catch(e => console.warn(e.message || e));
  else console.warn('[grain preview] add data-grain="<selector>" to the script tag');
}
