// Entry for assets/grain-core.js: the engine on window.__grain, for the headless tools
// (shoot, review, check). They inject it into the page they are photographing.
import defaults from '../../calibration.json' with { type: 'json' };
import { analyse } from '../engine/analyse.mjs';
import { cssFor } from '../engine/css.mjs';
import { LEVELS } from '../engine/recommend.mjs';
import { look } from './look.mjs';

let calibration = defaults;

const remove = () => {
  document.getElementById('grain-shot')?.remove();
  document.getElementById('grain-shot-layer')?.remove();
};

/** Apply one option's CSS to the page, with the extra element the child method needs. */
const apply = (analysis, option, screen = 'sdr') => {
  remove();
  if (option === 'none') return;
  let result = analysis.results[option];
  if (screen !== 'sdr' && result.screens?.[screen]) result = { ...result, screens: { sdr: result.screens[screen] } };
  const style = Object.assign(document.createElement('style'), {
    id: 'grain-shot',
    textContent: cssFor(analysis.method, analysis.look, result),
  });
  document.head.append(style);
  if (analysis.method !== 'child') return;

  const host = document.querySelector(analysis.look.selector.split('::')[0]);
  const layer = Object.assign(document.createElement('div'), { className: 'grain-layer', id: 'grain-shot-layer' });
  layer.setAttribute('aria-hidden', 'true');
  const hostWidth = host.getBoundingClientRect().width;
  const media =
    analysis.look.coveringMedia &&
    [...host.querySelectorAll('img, video')].find(m => m.getBoundingClientRect().width >= hostWidth * 0.9);
  if (media) media.after(layer);
  else if (analysis.look.isPseudo) host.append(layer);
  else host.prepend(layer);
};

window.__grain = {
  look,
  analyse: info => analyse(info, calibration),
  cssFor,
  apply,
  remove,
  LEVELS,
  /** The tools pass the calibration.json on disk, so edits to it need no rebuild. */
  setCalibration: c => {
    calibration = c;
  },
};
