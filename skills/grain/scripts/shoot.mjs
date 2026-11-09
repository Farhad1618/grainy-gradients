// Before/after pictures, taken by the skill itself in headless Chrome.
//
//   node shoot.mjs --url http://localhost:3000/ --selector ".hero" [--selector ".footer"]
//                  [--option recommended|all|medium,even] [--phone] [--out ./grain-shots] [--json]
//
// For each background: photographs it as it is and with each option, measures the pixels
// (grain added, brightness change, how wide the flat stripes are), and draws a comparison
// picture with a magnified detail of the area that bands the most. Prints one line per
// picture; --json prints everything (including the CSS for every option).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openBrowser, openPage, lookAt, optionsFor, shootOptions, compare, slug, LABEL } from './capture.mjs';

const argv = process.argv.slice(2);
const flag = n => argv.includes(`--${n}`);
const many = n => argv.flatMap((a, i) => (a === `--${n}` && argv[i + 1] ? [argv[i + 1]] : []));
const one = (n, d) => many(n)[0] ?? d;

const url = one('url');
const selectors = many('selector').flatMap(s => s.split('|').map(x => x.trim()).filter(Boolean));
const out = resolve(one('out', 'grain-shots'));
const wanted = one('option', 'all');
const viewport = flag('phone') ? 'phone' : 'desktop';

export async function shoot({ url, selectors, wanted = 'all', viewport = 'desktop', out, screens = false }) {
  const b = await openBrowser(viewport);
  const results = [];
  try {
    await openPage(b, url);
    const taken = [];
    for (const sel of selectors) {
      try {
        const info = await lookAt(b, sel);
        const options = optionsFor(info, wanted);
        const { shots, full, rectsBefore } = await shootOptions(b, sel, info, options, { screens });
        taken.push({ sel, info, options, shots, full, rectsBefore });
      } catch (e) { results.push({ selector: sel, error: e.message }); }
    }
    const pageErrors = [...b.errors];
    for (const t of taken) {
      const dir = join(out, `${slug(t.sel)}${viewport === 'phone' ? '-phone' : ''}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'before.png'), t.shots.before);
      writeFileSync(join(dir, 'page-before.png'), t.full.before);
      const pictures = {};
      for (const opt of t.options) {
        if (opt === 'none') continue;
        for (const key of Object.keys(t.shots).filter(k => k === opt || k.startsWith(opt + '@'))) {
          writeFileSync(join(dir, `${key.replace('@', '-')}.png`), t.shots[key]);
          const r = t.info.results[opt];
          const screen = key.includes('@') ? key.split('@')[1] : null;
          const title = `${t.sel} · ${LABEL[opt]}${opt === t.info.recommended ? ' (recommended)' : ''}${screen ? ` · ${screen === 'hdr' ? 'HDR screen' : 'high contrast'}` : ''}`;
          const subtitle = `${new URL(url).pathname} · ${viewport} ${b.width}px · ${r.blend} at ${screen ? r.screens[screen].opacity : r.screens?.sdr?.opacity ?? r.opacity}`;
          const { png, metrics } = await compare(b, { before: t.shots.before, after: t.shots[key], title, subtitle, dpr: b.dpr });
          const file = join(dir, `compare-${key.replace('@', '-')}.png`);
          writeFileSync(file, png);
          pictures[key] = { file, metrics };
        }
      }
      if (t.full[t.info.recommended]) writeFileSync(join(dir, 'page-after.png'), t.full[t.info.recommended]);
      writeFileSync(join(dir, 'look.json'), JSON.stringify(t.info.look));
      const item = { selector: t.sel, dir, recommended: t.info.recommended, method: t.info.method, notes: t.info.notes, report: t.info.report, clip: t.info.clip, pictures, css: t.info.css, results: t.info.results, look: t.info.look };
      writeFileSync(join(dir, 'report.json'), JSON.stringify({ ...item, url, viewport, pageErrors, rects: t.rectsBefore }, null, 2));
      results.push(item);
    }
    return { url, viewport, out, results, pageErrors };
  } finally { await b.close(); }
}

const isMain = /shoot\.mjs$/.test(process.argv[1] || '');
if (isMain) {
  if (!url || !selectors.length) {
    console.error('Usage: node shoot.mjs --url <page> --selector <css selector> [--selector ...] [--option recommended|all|medium,even] [--phone] [--screens] [--out dir] [--json]');
    process.exit(1);
  }
  const r = await shoot({ url, selectors, wanted, viewport, out, screens: flag('screens') });
  if (flag('json')) console.log(JSON.stringify(r, (k, v) => (k === 'look' ? undefined : v), 2));
  else {
    for (const it of r.results) {
      if (it.error) { console.log(`✗ ${it.selector}: ${it.error}`); continue; }
      console.log(`${it.selector} (recommended: ${it.recommended})`);
      for (const n of it.notes) console.log(`  note: ${n}`);
      for (const [k, p] of Object.entries(it.pictures)) {
        const m = p.metrics;
        console.log(`  ${k.padEnd(16)} grain ${m.grainBefore} → ${m.grainAfter} L*  brightness ${m.brightness >= 0 ? '+' : ''}${m.brightness}  stripes ${m.bandBefore}px → ${m.bandAfter}px   ${p.file}`);
      }
    }
    if (r.pageErrors.length) console.log(`Page errors while loading (not from grain): ${r.pageErrors.slice(0, 3).join(' | ')}`);
  }
}
