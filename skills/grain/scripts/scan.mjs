// Find every gradient and background in a codebase that could take grain, and sort them
// into good candidates, ones to check, and ones to skip, so Claude can show a pick list.
//
//   node scan.mjs <project folder> [--json]
//
// Reads CSS/SCSS/Less (rules, media queries, custom properties), markup and components
// (Tailwind gradient classes, inline styles, CSS-in-JS). Static: it can't see gradients
// built at runtime, so Claude should still glance at the pages.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';

const root = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.';
const asJson = process.argv.includes('--json');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', '.output', 'vendor', 'coverage', '.cache', '.turbo', '.vercel', 'Pods', 'DerivedData', '__pycache__', '.venv', 'venv', 'tmp']);
const STYLE = new Set(['.css', '.scss', '.sass', '.less', '.pcss']);
const MARKUP = new Set(['.html', '.htm', '.vue', '.svelte', '.astro', '.jsx', '.tsx', '.js', '.ts', '.mjs', '.mdx', '.php', '.erb', '.njk', '.liquid', '.hbs', '.twig']);
const MAX_BYTES = 1_500_000;

const files = [];
(function walk(dir) {
  let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.') { if (e.isDirectory()) continue; }
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); continue; }
    const ext = extname(e.name).toLowerCase();
    if (!STYLE.has(ext) && !MARKUP.has(ext)) continue;
    if (/\.min\.(css|js)$/.test(e.name) || /\.(test|spec)\./.test(e.name)) continue;
    try { if (statSync(p).size > MAX_BYTES) continue; } catch { continue; }
    files.push(p);
  }
})(root);

const rel = p => relative(root, p) || basename(p);
const lineAt = (text, i) => text.slice(0, i).split('\n').length;
const GRADIENT = /(?:repeating-)?(?:linear|radial|conic)-gradient\(/;

// Names that say "small thing" or "big area".
const SMALL = /\b(seal|stamp|title|heading|hl|word|grad|label|caption|btn|button|badge|chip|tag|pill|icon|avatar|logo|link|underline|divider|rule|border|progress|meter|bar|scrollbar|thumb|track|input|field|toggle|switch|dot|spinner|loader|tooltip|caret|arrow|cursor|skeleton|shimmer|ring|outline|swatch|dot|kbd)\b/i;
const BIG = /\b(html|body|main|page|hero|section|banner|header|footer|backdrop|background|bg|cover|splash|panel|wrap|wrapper|container|layout|stage|scene|band|intro|cta|tour|landing|screen|app|shell|canvas)\b|(?:^|[-_])bg(?:[-_]|$)/i;

// Whole-page backgrounds: html, body (with any classes or :has()), and their ::before/::after.
const PAGE = /^(?:html|body)(?:[.:#[][^\s>+~]*)?(?:\s+(?:html|body)(?:[.:#[][^\s>+~]*)?)?$/i;
const found = [];
const vars = new Map(); // --name → { value, file, line }
const grainVars = new Set(); // custom properties holding a noise image
const clipText = new Set(); // file|selector with background-clip: text in any rule
const grainFiles = new Set();

// ---- Stylesheets: walk blocks with a stack so media queries and nesting are kept.
function scanStyles(file, text) {
  const stack = []; let buf = '', i = 0, blockStart = 0;
  const decls = []; // [{ stackPath, prop, value, line, block }]
  let blockId = 0; const blockIds = [];
  while (i < text.length) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 2; continue; }
    if (ch === '/' && text[i + 1] === '/' && extname(file) !== '.css' && text[i - 1] !== ':') { const e = text.indexOf('\n', i); i = e < 0 ? text.length : e; continue; }
    if (ch === '"' || ch === "'") { const q = ch; let j = i + 1; while (j < text.length && text[j] !== q) j += text[j] === '\\' ? 2 : 1; buf += text.slice(i, j + 1); i = j + 1; continue; }
    if (ch === '(') { // keep brackets (data URLs, functions) whole
      let d = 0, j = i;
      for (; j < text.length; j++) { if (text[j] === '(') d++; else if (text[j] === ')' && --d === 0) break; }
      buf += text.slice(i, j + 1); i = j + 1; continue;
    }
    if (ch === '{') {
      stack.push(buf.trim().replace(/\s+/g, ' ')); blockIds.push(++blockId); buf = ''; i++; blockStart = i; continue;
    }
    if (ch === ';' || ch === '}') {
      const d = buf.trim();
      const m = d.match(/^([-\w]+)\s*:\s*([\s\S]+)$/);
      if (m && stack.length) decls.push({ path: [...stack], prop: m[1].toLowerCase(), value: m[2].trim(), line: lineAt(text, i - d.length), block: blockIds[blockIds.length - 1] });
      buf = '';
      if (ch === '}') { stack.pop(); blockIds.pop(); }
      i++; continue;
    }
    buf += ch; i++;
  }
  if (/feTurbulence/i.test(text)) grainFiles.add(rel(file));
  const byBlock = new Map();
  for (const d of decls) { if (!byBlock.has(d.block)) byBlock.set(d.block, []); byBlock.get(d.block).push(d); }
  for (const d of decls) {
    if (d.prop.startsWith('--') && GRADIENT.test(d.value)) vars.set(d.prop, { value: d.value, file: rel(file), line: d.line });
    if (d.prop.startsWith('--') && /feTurbulence/i.test(d.value)) grainVars.add(d.prop);
    if (/background-clip/.test(d.prop) && /text/.test(d.value)) clipText.add(rel(file) + '|' + d.path.filter(p => !p.startsWith('@')).join(' '));
  }
  for (const d of decls) {
    if (!/^background(-image|-color)?$/.test(d.prop)) continue;
    const usesVar = [...d.value.matchAll(/var\((--[\w-]+)/g)].map(m => m[1]);
    const at = d.path.filter(p => p.startsWith('@'));
    const selector = d.path.filter(p => !p.startsWith('@')).join(' ').replace(/\s*&/g, '');
    const siblings = byBlock.get(d.block) || [];
    // A flat colour counts only as a whole-page background (html, body or a full-page
    // pseudo-element of them): flat section colours are everywhere and rarely want grain.
    const flat = !GRADIENT.test(d.value) && !/url\(/.test(d.value) && PAGE.test(selector) && !/^(transparent|none|inherit|initial|unset|currentcolor)$/i.test(d.value.trim());
    if (flat) { found.push({ source: 'css', file: rel(file), line: d.line, selector, media: at.join(' '), value: d.value, usesVar, flat: true, textClip: false, hasGrain: false, image: false }); continue; }
    if (d.prop === 'background-color') continue;
    if (!GRADIENT.test(d.value) && !usesVar.length && !/url\(/.test(d.value)) continue;
    found.push({
      source: 'css', file: rel(file), line: d.line, selector, media: at.join(' '), value: d.value, usesVar,
      textClip: siblings.some(s => /background-clip/.test(s.prop) && /text/.test(s.value)),
      hasGrain: /feTurbulence/i.test(d.value),
      image: /url\(/.test(d.value) && !/data:image\/svg/.test(d.value),
    });
  }
}

// ---- Markup and components: Tailwind classes, inline styles, CSS-in-JS.
const TW = /\b(?:bg-gradient-to-[trbl]{1,2}|bg-(?:linear|radial|conic)(?:-[\w\[\]\/().%,-]+)?)\b[^"'`]*/g;
function scanMarkup(file, text) {
  if (/feTurbulence/i.test(text)) grainFiles.add(rel(file));
  for (const m of text.matchAll(TW)) {
    const i = m.index;
    const tagStart = text.lastIndexOf('<', i);
    const tag = tagStart >= 0 ? (text.slice(tagStart + 1, tagStart + 40).match(/^[\w.-]+/) || [''])[0] : '';
    found.push({ source: 'tailwind', file: rel(file), line: lineAt(text, i), selector: tag ? `<${tag}>` : '(class list)', media: '', value: m[0].trim().slice(0, 160), usesVar: [], textClip: /\bbg-clip-text\b/.test(m[0]), hasGrain: false, image: false });
  }
  // Inline style="..." and style objects / styled-components with a gradient.
  if (!STYLE.has(extname(file))) {
    for (const m of text.matchAll(/(?:style\s*=\s*["'{][^>]*?|background(?:Image)?\s*:\s*[`'"]?)((?:repeating-)?(?:linear|radial|conic)-gradient\([^;"'`]*)/g)) {
      const i = m.index;
      const before = text.slice(Math.max(0, i - 300), i);
      const tag = (before.match(/<([\w.-]+)[^<]*$/) || [])[1];
      const comp = (before.match(/(?:const|let)\s+(\w+)\s*=\s*styled[.(][^]*$/) || [])[1];
      found.push({ source: 'inline', file: rel(file), line: lineAt(text, i), selector: comp ? `styled ${comp}` : tag ? `<${tag}>` : '(inline style)', media: '', value: m[1].slice(0, 160), usesVar: [], textClip: /background-clip\s*:\s*text|backgroundClip\s*:\s*['"]text/.test(text.slice(i, i + 400)), hasGrain: false, image: false });
    }
  }
}

for (const f of files) {
  let text; try { text = readFileSync(f, 'utf8'); } catch { continue; }
  if (!STYLE.has(extname(f).toLowerCase()) && !GRADIENT.test(text) && !/bg-(gradient|linear|radial|conic)/.test(text)) { if (/feTurbulence/i.test(text)) grainFiles.add(rel(f)); continue; }
  (STYLE.has(extname(f).toLowerCase()) ? scanStyles : scanMarkup)(f, text);
}

// Keep backgrounds that are gradients themselves or use a gradient variable.
const items = found.filter(x => x.source !== 'css' || x.flat || GRADIENT.test(x.value) || x.usesVar.some(v => vars.has(v)) || x.image);

// Which pages load each stylesheet.
const pagesFor = new Map();
const markupFiles = files.filter(f => /\.(html?|vue|svelte|astro|jsx|tsx|php|erb|njk|liquid|hbs|twig|mjs|js|ts)$/.test(f));
function pages(cssFile) {
  if (pagesFor.has(cssFile)) return pagesFor.get(cssFile);
  const name = basename(cssFile);
  const hits = [];
  for (const f of markupFiles) { try { if (readFileSync(f, 'utf8').includes(name)) hits.push(rel(f)); } catch {} }
  pagesFor.set(cssFile, hits); return hits;
}

// Verdict for each.
const ALPHA = /transparent|rgba?\([^)]*,\s*0?\.\d+\s*\)|rgba?\([^)]*,\s*0\s*\)|\/\s*0?\.\d+\s*\)|#[0-9a-f]{8}\b/i;
for (const x of items) {
  const sel = x.selector;
  const pseudo = /::?(after|before)\b/.test(sel);
  if (x.usesVar.some(v => grainVars.has(v))) x.hasGrain = true;
  if (clipText.has(`${x.file}|${sel}`)) x.textClip = true;
  if (x.hasGrain) { x.verdict = 'has grain'; x.why = 'already has a noise layer'; }
  else if (x.flat) { x.verdict = 'check'; x.why = 'whole-page flat colour: worth grain if it is dark or the page is mostly empty'; }
  else if (x.textClip) { x.verdict = 'skip'; x.why = 'gradient text'; }
  else if (/repeating-/.test(x.value)) { x.verdict = 'skip'; x.why = 'stripe or hatch pattern, not a smooth gradient'; }
  else if (x.image) { x.verdict = 'check'; x.why = 'image background: grain works on photos too'; }
  else if (SMALL.test(sel)) { x.verdict = 'skip'; x.why = 'small element: grain needs room to read as texture'; }
  else if (pseudo && ALPHA.test(x.value)) { x.verdict = 'skip'; x.why = 'see-through overlay (scrim or fade) on top of something else'; }
  else if (BIG.test(sel)) { x.verdict = 'good'; x.why = ALPHA.test(x.value) ? 'large background, partly see-through' : 'large background'; }
  else { x.verdict = 'check'; x.why = 'size unknown: look at it on the page'; }
  if (x.source === 'css') x.pages = pages(x.file);
}

// Group versions of the same background (media queries, dark mode) under one entry.
const groups = new Map();
for (const x of items) {
  const key = `${x.file}|${x.selector}`;
  if (!groups.has(key)) groups.set(key, { ...x, versions: [] });
  else groups.get(key).versions.push({ media: x.media || '(base)', line: x.line });
}
const list = [...groups.values()];
const order = { good: 0, check: 1, 'has grain': 2, skip: 3 };
list.sort((a, b) => order[a.verdict] - order[b.verdict] || a.file.localeCompare(b.file) || a.line - b.line);

if (asJson) {
  console.log(JSON.stringify({ root, files: files.length, items: list, gradientVars: Object.fromEntries(vars), grainFiles: [...grainFiles] }, null, 2));
} else {
  const short = v => v.replace(/\s+/g, ' ').slice(0, 90) + (v.length > 90 ? '…' : '');
  const label = { good: 'Good candidates', check: 'Worth a look', 'has grain': 'Already has grain', skip: 'Skip' };
  console.log(`Scanned ${files.length} files in ${root}: ${list.length} backgrounds with gradients or images.\n`);
  for (const v of ['good', 'check', 'has grain', 'skip']) {
    const g = list.filter(x => x.verdict === v); if (!g.length) continue;
    console.log(`## ${label[v]} (${g.length})`);
    g.forEach((x, n) => {
      const extra = [x.media && `in ${x.media}`, x.versions.length && `+${x.versions.length} more version${x.versions.length > 1 ? 's' : ''} (${x.versions.map(w => w.media).join('; ')})`, x.pages?.length && `pages: ${x.pages.slice(0, 3).join(', ')}${x.pages.length > 3 ? '…' : ''}`].filter(Boolean).join(' · ');
      console.log(`${n + 1}. ${x.selector}  —  ${x.file}:${x.line}  [${x.why}]`);
      console.log(`   ${short(x.value)}${extra ? `\n   ${extra}` : ''}`);
    });
    console.log('');
  }
  if (grainFiles.size) console.log(`Noise (feTurbulence) already in: ${[...grainFiles].join(', ')}`);
}
