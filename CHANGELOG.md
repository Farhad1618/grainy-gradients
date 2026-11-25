# Changelog

## 0.3.0 (2026-11-25)

Restructure. The grain it produces is unchanged.

- `SKILL.md` is shorter; the engine's decisions, the no-Chrome fallbacks and tuning moved to `references/` and load only when needed.
- The engine is split into modules (`scripts/engine/`): noise, colour, measure, recommend, css, analyse. Browser code is in `scripts/browser/`, Chrome control in `scripts/headless/`.
- The command line is now `scripts/grain.mjs` (was `grain.js`).
- Built browser bundles moved from `dist/` to `assets/`, and are bundled with esbuild instead of joined as text.
- The headless tools read `calibration.json` on every run, so edits apply without a rebuild.
- `calibration.json` holds only shipped values; the history moved to `docs/calibration-log.md`.
- Added engine unit tests, Prettier, and CI on every push.
- README video rendered from the skill's own screenshots (`npm run demo`); a real production page as the before and after; media is 7.5 MB down to 1.8 MB.

## 0.2.0 (2026-11-09)

- Renamed to grainy-gradients.
- Whole-site scan, review page, headless before/after pictures and the self-check.
- CSS adapts to HDR screens, the high-contrast setting and print.

## 0.1.0 (2026-11-08)

- First version: measured film grain for one background, with an in-page preview.
