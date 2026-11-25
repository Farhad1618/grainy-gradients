// Unit tests for the engine: pure maths, no browser.   node --test tests/engine.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import calibration from '../skills/grainy-gradients/calibration.json' with { type: 'json' };
import {
  analyse,
  banding,
  chooseMethod,
  cssFor,
  lightness,
  measure,
  noiseSample,
  parseColour,
  recommend,
  sampleGradient,
  solveOpacity,
  splitLayers,
  toStops,
  toneOf,
} from '../skills/grainy-gradients/scripts/engine/index.mjs';

const mean = values => values.reduce((total, v) => total + v, 0) / values.length;
const DARK = ['#323435', '#141617'];
const look = (extra = {}) => ({
  selector: '.hero',
  kind: 'gradient',
  shape: 'linear',
  colours: DARK,
  lengthPx: 900,
  background: 'linear-gradient(#323435, #141617)',
  position: 'relative',
  solidBase: true,
  freePseudo: '::after',
  ...extra,
});

test('noise is centred on mid-grey, so it adds texture without tinting', () => {
  const noise = noiseSample({ n: 3000 });
  assert.ok(Math.abs(mean([...noise]) - 0.5) < 0.02);
  assert.ok(Math.min(...noise) >= 0 && Math.max(...noise) <= 1);
});

test('parseColour reads hex, rgb, hsl and names', () => {
  assert.deepEqual(parseColour('#abc'), [170, 187, 204]);
  assert.deepEqual(parseColour('#aabbccdd'), [170, 187, 204]);
  assert.deepEqual(parseColour('rgb(1 2 3 / .5)'), [1, 2, 3]);
  assert.deepEqual(parseColour('hsl(0, 100%, 50%)'), [255, 0, 0]);
  assert.deepEqual(parseColour('white'), [255, 255, 255]);
  assert.throws(() => parseColour('oklch(0.5 0.1 200)'));
});

test('lightness is L*: 0 for black, 100 for white', () => {
  assert.equal(lightness([0, 0, 0]), 0);
  assert.ok(Math.abs(lightness([255, 255, 255]) - 100) < 0.01);
  assert.equal(toneOf(10), 'dark');
  assert.equal(toneOf(50), 'mid');
  assert.equal(toneOf(80), 'light');
});

test('solveOpacity hits the visible-grain target', () => {
  const noise = noiseSample({ n: 3000 });
  const colours = sampleGradient(toStops(DARK));
  const opacity = solveOpacity(noise, colours, 'soft-light', 0.8);
  assert.ok(Math.abs(measure(noise, colours, 'soft-light', opacity).grain - 0.8) < 0.08);
});

test('solveOpacity returns null when a blend cannot reach the target', () => {
  assert.equal(solveOpacity(noiseSample({ n: 3000 }), ['#000000'], 'overlay', 0.8), null);
});

test('every level reaches its target on a dark gradient without moving the brightness', () => {
  for (const level of ['subtle', 'medium', 'strong']) {
    const r = recommend({ colours: DARK, lengthPx: 900, level, calibration });
    assert.ok(Math.abs(r.measured.grain - r.target) < 0.08, `${level}: ${r.measured.grain} vs ${r.target}`);
    assert.ok(Math.abs(r.measured.shift) < 0.3, `${level}: brightness moved ${r.measured.shift}`);
  }
});

test('pure black is reported as unreachable or a fallback, never silently tinted', () => {
  const r = recommend({ colours: ['#000000', '#000000'], level: 'medium', calibration });
  assert.ok(r.unreachable || r.fallback);
});

test('banding risk grows with pixels per colour level', () => {
  assert.equal(banding(toStops(['#101010', '#141414']), 1200).risk, 'high');
  assert.equal(banding(toStops(['#000000', '#ffffff']), 300).risk, 'low');
});

test('HDR and high-contrast screens get the same blend with less grain', () => {
  const { screens } = recommend({ colours: DARK, lengthPx: 900, level: 'medium', calibration });
  assert.ok(screens.hdr.opacity < screens.sdr.opacity);
  assert.ok(screens.contrast.opacity < screens.hdr.opacity);
});

test('splitLayers ignores commas inside brackets', () => {
  assert.deepEqual(splitLayers('url(a), linear-gradient(red, blue), #fff'), [
    'url(a)',
    'linear-gradient(red, blue)',
    '#fff',
  ]);
});

test('a gradient takes one layer; a photo and a pseudo-element take their own layer', () => {
  assert.equal(chooseMethod(look()), 'one-layer');
  assert.equal(chooseMethod(look({ kind: 'photo', background: 'url(photo.jpg)' })), 'layer');
  assert.equal(chooseMethod(look({ kind: 'photo', background: 'url(photo.jpg)', isPseudo: true })), 'child');
});

test('one-layer CSS keeps the page background and adapts to the screen', () => {
  const a = analyse(look(), calibration);
  const css = a.css[a.recommended];
  assert.match(css, /--grain: url\("data:image\/svg\+xml/);
  assert.match(css, /background-image: var\(--grain\), linear-gradient\(#323435, #141617\)/);
  assert.match(css, /@media \(dynamic-range: high\)/);
  assert.match(css, /@media \(prefers-contrast: more\)/);
  assert.match(css, /@media print/);
});

test('an old noise layer is replaced, not stacked', () => {
  const old = `url("data:image/svg+xml,<svg><feTurbulence/></svg>"), linear-gradient(#323435, #141617)`;
  const css = cssFor(
    'one-layer',
    look({ background: old }),
    recommend({ colours: DARK, level: 'medium', calibration }),
  );
  assert.equal(css.match(/feTurbulence/g).length, 1 + 2); // base + two screen variants, each one tile
});
