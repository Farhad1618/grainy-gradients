// Runs the grain skill end to end on every test page in headless Chrome:
// look → measure → apply the recommended option → photograph → check the pixels.
//
//   node tests/run.mjs [case ...] [--showcase]
//
// Each case passes when: nothing throws, the grain is visible (or the page is one where the
// skill should say it can't be), brightness barely moves, stripes get narrower where the
// gradient banded, and nothing outside the background changes. Pictures go to tests/out/.
// --showcase also copies the showcase pictures into docs/images/.
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBrowser, openPage, lookAt, shootOptions, compare, diffOutside, card } from '../skills/grainy-gradients/scripts/capture.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(join(root, 'cases.json'), 'utf8'));
const only = process.argv.slice(2).filter(a => !a.startsWith('--'));
const showcase = process.argv.includes('--showcase');
const out = join(root, 'out'); mkdirSync(out, { recursive: true });

const server = createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const csp = u.pathname.startsWith('/csp/');
  const file = join(root, 'pages', u.pathname.replace(/^\/(csp\/)?/, ''));
  if (!existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...(csp ? { 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:" } : {}) });
  res.end(readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const b = await openBrowser('desktop');
const rows = []; let failed = 0;
for (const [name, c] of Object.entries(cases)) {
  if (only.length && !only.includes(name)) continue;
  const url = `${base}/${c.csp ? 'csp/' : ''}${c.page || name}.html`;
  const problems = [], t0 = Date.now();
  let m = null, info = null;
  try {
    await openPage(b, url);
    info = await lookAt(b, c.selector);
    const rec = info.recommended;
    const { shots, full, layoutMoved } = await shootOptions(b, c.selector, info, [rec]);
    const pageErrors = b.errors.filter(e => /grain/i.test(e));
    const r = info.results[rec];
    ({ metrics: m } = await compare(b, { before: shots.before, after: shots[rec], title: `${name} · ${rec}`, subtitle: `${c.selector} · ${r.blend} at ${r.screens?.sdr?.opacity ?? r.opacity}`, dpr: b.dpr }).then(x => { writeFileSync(join(out, `${name}.png`), x.png); return x; }));
    const d = await diffOutside(b, full.before, full[rec], info.clip, b.dpr);
    const weak = r.unreachable || r.fallback;
    if (pageErrors.length) problems.push(`errors: ${pageErrors.join(' | ')}`);
    if (!(c.allowWeak && weak) && m.grainAdded < 0.35) problems.push(`grain too faint (${m.grainAdded} L*)`);
    if (Math.abs(m.brightness) > (c.maxShift ?? 0.6)) problems.push(`brightness moved ${m.brightness} L*`);
    if (info.look.kind === 'gradient' && m.bandBefore >= 3 && m.bandAfter > m.bandBefore / 2) problems.push(`stripes not broken up (${m.bandBefore}px → ${m.bandAfter}px)`);
    if (c.banding && m.bandBefore < 3) problems.push(`expected banding before, measured ${m.bandBefore}px`);
    if (layoutMoved) problems.push(`applying it moved ${layoutMoved} element(s) on the page`);
    if (d.changed > 0.002) problems.push(`page outside the background changed (${(d.changed * 100).toFixed(2)}% of pixels)`);
    if (c.report && !info.report.includes(c.report)) problems.push(`report should mention "${c.report}"`);
    if (c.note && !info.notes.join(' ').includes(c.note)) problems.push(`notes should mention "${c.note}"`);
    if (c.method && info.method !== c.method) problems.push(`method ${info.method}, expected ${c.method}`);
    if (c.kind && info.look.kind !== c.kind) problems.push(`kind ${info.look.kind}, expected ${c.kind}`);
    if (showcase && c.showcase) {
      mkdirSync(join(root, '..', 'docs', 'images'), { recursive: true });
      const label = name.replace(/^showcase-/, ''), pretty = label[0].toUpperCase() + label.slice(1);
      const { png } = await card(b, { before: shots.before, after: shots[rec], title: `${pretty} · ${rec === 'even' ? 'Even' : rec[0].toUpperCase() + rec.slice(1)}`, dpr: b.dpr });
      writeFileSync(join(root, '..', 'docs', 'images', `${label}.png`), png);
    }
  } catch (e) { problems.push(`threw: ${e.message}`); }
  if (problems.length) failed++;
  rows.push({ name, ok: !problems.length, rec: info?.recommended, m, problems, ms: Date.now() - t0 });
  const line = m ? `grain ${m.grainBefore}→${m.grainAfter} (+${m.grainAdded})  bright ${m.brightness >= 0 ? '+' : ''}${m.brightness}  stripes ${m.bandBefore}→${m.bandAfter}px` : '';
  console.log(`${problems.length ? 'FAIL' : 'pass'}  ${name.padEnd(13)} ${String(info?.recommended || '-').padEnd(7)} ${line}${problems.length ? '\n      ' + problems.join('\n      ') : ''}`);
}
await b.close(); server.close();
console.log(`\n${rows.length - failed}/${rows.length} passed. Pictures: ${out}`);
process.exit(failed ? 1 : 0);
