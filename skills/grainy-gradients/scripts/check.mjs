// The check after applying: photograph the real page again and confirm the grain is there and
// nothing else changed. Fails loudly, so the skill never says "done" on a broken result.
//
//   node check.mjs --url http://localhost:3000/ --selector ".hero" --baseline ./grain-shots/hero [--option even] [--phone]
//
// --baseline is the folder shoot.mjs wrote for that background BEFORE the CSS was added (it has
// the clean pictures, the element positions and the expected amounts). Without it, the check
// can only confirm that visible grain is present and that the page has no new errors.
// Prints PASS/FAIL lines, writes check.png (before vs now, magnified) and exits 1 on any failure.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openBrowser, openPage, lookAt, compare, diffOutside, moved, RECTS } from './capture.mjs';

const argv = process.argv.slice(2);
const one = n => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const url = one('url'), selector = one('selector'), baseline = one('baseline') && resolve(one('baseline'));
if (!url || !selector) { console.error('Usage: node check.mjs --url <page> --selector <css> [--baseline <shoot folder>] [--option name] [--phone]'); process.exit(1); }
const base = baseline && existsSync(join(baseline, 'report.json')) ? JSON.parse(readFileSync(join(baseline, 'report.json'), 'utf8')) : null;
if (baseline && !base) { console.error(`No report.json in ${baseline}. Run shoot.mjs before applying the CSS.`); process.exit(1); }

const b = await openBrowser(argv.includes('--phone') || base?.viewport === 'phone' ? 'phone' : 'desktop');
const results = []; const ok = (pass, what) => results.push({ pass, what });
try {
  await openPage(b, url);
  const info = await lookAt(b, selector);
  const clipPage = { x: info.clip.x + info.clip.sx, y: info.clip.y + info.clip.sy, width: info.clip.width, height: info.clip.height };
  const now = await b.shot(clipPage), fullNow = await b.shot();
  const rectsNow = await b.eval(RECTS);
  const errorsNow = b.errors.filter(e => !(base?.pageErrors || []).includes(e));

  ok(info.look.existingGrain || /grain-layer/.test(JSON.stringify(info.look)) || info.look.kind === 'photo', info.look.existingGrain ? 'the grain layer is in the page' : 'no grain layer found in the background (is the CSS loaded? is it on the right selector?)');
  ok(!errorsNow.length, errorsNow.length ? `new errors on the page: ${errorsNow.slice(0, 3).join(' | ')}` : 'no new errors on the page');

  let picture = null;
  if (base) {
    const option = one('option') || Object.keys(base.pictures || {})[0] && base.recommended;
    const expected = base.results?.[option]?.measured?.grain;
    const before = readFileSync(join(baseline, 'before.png'));
    const sameSize = info.clip.width === base.clip.width && info.clip.height === base.clip.height;
    ok(sameSize, sameSize ? 'the background is the same size as before' : `the background changed size (${base.clip.width}×${base.clip.height} → ${info.clip.width}×${info.clip.height})`);
    const lay = moved(base.rects || [], rectsNow);
    ok(!lay, lay ? `${lay} element(s) moved or changed size on the page` : 'nothing on the page moved');
    if (sameSize) {
      const { png, metrics: m } = await compare(b, { before, after: now, title: `${selector} · check`, subtitle: `${new URL(url).pathname} · expected ${option}`, dpr: b.dpr });
      picture = join(baseline, 'check.png'); writeFileSync(picture, png);
      const g = m.detailGrainAfter;
      if (expected) ok(g >= expected * 0.5 && g <= expected * 2, `grain ${g} L* where ${expected} was expected (${option})`);
      else ok(g >= 0.4, `grain ${g} L*`);
      ok(Math.abs(m.brightness) <= 0.8, `brightness ${m.brightness >= 0 ? '+' : ''}${m.brightness} L*`);
      if (m.bandBefore >= 3) ok(m.bandAfter <= m.bandBefore / 2, `flat stripes ${m.bandBefore}px → ${m.bandAfter}px`);
      const d = await diffOutside(b, readFileSync(join(baseline, 'page-before.png')), fullNow, info.clip, b.dpr);
      ok(d.changed <= 0.002, d.changed <= 0.002 ? 'the rest of the page looks the same' : `the rest of the page changed (${(d.changed * 100).toFixed(2)}% of pixels)`);
    }
  } else {
    const { metrics: m } = await compare(b, { before: now, after: now, title: '', dpr: b.dpr });
    ok(m.detailGrainBefore >= 0.4, `grain ${m.detailGrainBefore} L* in the smoothest area`);
  }
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.what}`);
  if (picture) console.log(`Picture: ${picture}`);
} catch (e) { console.log(`FAIL  ${e.message}`); results.push({ pass: false }); }
finally { await b.close(); }
process.exit(results.every(r => r.pass) ? 0 : 1);
