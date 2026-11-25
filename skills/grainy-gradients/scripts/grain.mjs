#!/usr/bin/env node
// Writes the grain CSS for a background without a browser.
//
//   node grain.mjs --look picks.txt|look.json|- [--option subtle|medium|strong|even] [--json]
//   node grain.mjs --colours "#323435,#141617" --length 900 --selector ".hero"
//
// --look takes what the review page or the in-page preview copies: one or more
// "grain: <option>" lines, each followed by that background's look as one line of JSON.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import calibration from '../calibration.json' with { type: 'json' };
import { analyse, LEVELS } from './engine/index.mjs';

const USAGE = `Usage:
  node grain.mjs --look picks.txt|look.json|- [--option subtle|medium|strong|even] [--json]
  node grain.mjs --colours "#hex,#hex[@pos%],..." [--kind gradient|photo|flat] [--shape linear|radial]
                 [--length px] [--selector .x] [--background "linear-gradient(...)"]
                 [--fade-over "#hex"] [--option ...] [--json]`;

const { values: args } = parseArgs({
  options: {
    look: { type: 'string' },
    colours: { type: 'string' },
    option: { type: 'string' },
    kind: { type: 'string', default: 'gradient' },
    shape: { type: 'string', default: 'linear' },
    length: { type: 'string', default: '0' },
    selector: { type: 'string', default: '.grain' },
    background: { type: 'string' },
    position: { type: 'string', default: 'relative' },
    'fade-over': { type: 'string' },
    json: { type: 'boolean', default: false },
  },
});

/** "#hex,#hex@24%" → stops. Commas inside rgb(...) don't split. */
const parseColourList = text =>
  text.split(/,(?![^(]*\))/).map(part => {
    const [colour, position] = part.trim().split('@');
    return position ? { colour, pos: parseFloat(position) / 100 } : colour;
  });

/** Each job is one background and the option picked for it. */
function readJobs() {
  if (args.look) {
    const text = readFileSync(args.look === '-' ? 0 : args.look, 'utf8');
    const picks = [...text.matchAll(/^grain:\s*(\w+)\s*\n\s*(\{.*\})\s*$/gm)];
    if (picks.length)
      return picks.map(([, option, json]) => ({ look: JSON.parse(json), option: args.option ?? option }));
    return [{ look: JSON.parse(text.slice(text.indexOf('{'))), option: args.option }];
  }
  if (args.colours) {
    const look = {
      selector: args.selector,
      kind: args.kind,
      shape: args.shape,
      colours: parseColourList(args.colours),
      lengthPx: Number(args.length) || 0,
      background: args.background ?? null,
      position: args.position,
      solidBase: true,
      freePseudo: '::after',
      behind: args['fade-over'] ?? null,
      moves: args['fade-over'] ? { fade: true } : null,
    };
    return [{ look, option: args.option }];
  }
  console.error(USAGE);
  process.exit(1);
}

const jobs = readJobs();
const asJson = [];
for (const { look, option } of jobs) {
  const a = analyse(look, calibration);
  if (args.json) {
    const { report, method, recommended, evenSame, results, css } = a;
    asJson.push({
      selector: look.selector,
      option: option || recommended,
      report,
      method,
      recommended,
      evenSame,
      results,
      css,
    });
    continue;
  }
  const heading = jobs.length > 1 ? `/* ==== ${look.selector}${look.page ? ` (${look.page})` : ''} ==== */\n` : '';
  if (!option) {
    console.log(`${heading}${a.report}\n\n/* ${a.recommended} */\n${a.css[a.recommended]}\n`);
  } else if (option === 'none' || option === 'skip') {
    console.log(`${heading}/* ${look.selector}: no grain (${option}) */\n`);
  } else if (!a.css[option]) {
    console.error(`No option "${option}". Options: ${LEVELS.join(', ')}`);
    process.exit(1);
  } else {
    const r = a.results[option];
    const summary = `${r.tone} ${look.kind}, ${r.blend} at ${r.screens?.sdr?.opacity ?? r.opacity}, ${r.measured.grain.toFixed(2)} L*`;
    console.log(
      `${heading}/* Grain (grainy-gradients, ${option}): ${summary}; adapts to HDR and high-contrast screens, off in print. */\n${a.css[option]}\n`,
    );
  }
}
if (args.json) console.log(JSON.stringify(asJson.length === 1 ? asJson[0] : asJson, null, 2));
