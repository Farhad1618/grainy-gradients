---
name: grainy-gradients
description: Add film grain (noise) to CSS gradients and backgrounds so they look printed instead of plastic, and remove colour banding. Measures each background, picks the blend and amount itself, shows a before/after on the real page, writes CSS that adapts to the visitor's screen, and checks its own result. Works on one background or a whole site. Use whenever someone says a background or gradient looks cheap, flat, plastic, too smooth, digital or not premium, shows stripes or banding, asks for grain, noise, texture, dithering or a film or poster look, asks to check their site's gradients, or mentions the feTurbulence noise trick, even if they don't say "grain".
compatibility: Node 22+ and Chrome, Chromium, Edge or Brave for the before/after pictures and the check. Without them it falls back to an in-page preview or to CSS from colours alone.
---

# Grainy gradients

Smooth digital gradients read as "computer". A fine noise layer makes them read as print or film, and it hides banding: the visible stripes where a gradient steps from one 8-bit colour level to the next.

The usual trick is an SVG `feTurbulence` layer at a guessed opacity. Guessing is why it so often comes out invisible, or tints the colours. This skill measures instead: it solves the blend and opacity for a visible-grain target, and proves the result with screenshots.

**You do the whole job. The person only looks and picks.** Never ask about blend modes, opacity or numbers. They make at most three decisions:

1. Which backgrounds (only when you scanned a whole site).
2. Whether to see a before and after first, or just have it applied.
3. Which option looks best.

## What good grain is

Keep these in mind; they explain every choice the tools make.

- **Texture, not colour.** The noise is centred on mid-grey, so it must not lighten, darken or tint. Pure black and white are the exception, and the report says so.
- **Measured as visible grain, not opacity.** Visible grain is the spread of L\* (CIELAB lightness, 0–100). L\* is perceptual, so one number looks about the same on any colour. The targets are 0.5 / 0.8 / 1.4 for Subtle / Medium / Strong. Below about 0.45 nobody can see it.
- **Even across the gradient.** Overlay puts most of the grain on the lighter parts. The Even option picks the blend (usually soft-light) that spreads it, and people tend to prefer it on light-to-dark gradients.
- **Part of the background.** It sits right above the background and under everything else. If the background fades in, the grain fades in with it.
- **Right for each screen.** The CSS carries media queries: a little less on HDR screens for dark backgrounds, less with the high-contrast setting, off in print. No script ships to the live site.
- **Not for everything.** Skip small things (buttons, badges, icons), gradient text, see-through scrims over photos, and stripe or hatch patterns. Grain can't help them.

Scripts are in this skill's `scripts/` folder; `<skill>` below means this skill's folder.

## 1. Find the background

**One place** ("the hero looks flat"): find the element that actually paints it. Check the element, its `::before` and `::after`, and full-size layers inside or behind it, since sections often get their colour from a separate absolutely positioned div. With a browser tool, list everything in the section that has a background and pick the large one; without one, read the CSS. Either way, search the CSS for other versions of the same background (media queries, dark mode) and note them for step 4.

**The whole site** ("check all my gradients"):

```bash
node <skill>/scripts/scan.mjs <project folder>
```

It reads stylesheets, markup and components (Tailwind classes, inline styles, CSS-in-JS) and sorts what it finds into good candidates, worth a look (size unknown from the code), already has grain, and skip (with the reason). `--json` gives the full data.

Sort the "worth a look" ones yourself before showing anything: measure them in a browser, or read the markup. Don't hand the person a list of things you could have checked. Then show a short list in plain words, grouped by page:

> I found 4 backgrounds that could take grain:
> 1. **Home, hero:** dark radial glow
> 2. **Home, pricing band:** dark gradient that fades in
> 3. **About, header:** green-black gradient
> 4. **Careers, footer band:** orange-black gradient
>
> Skipping 12: buttons, gradient text, photo scrims and stripe patterns.

Ask which ones should get grain. With a multiple-choice question tool, put **All of them (Recommended)** first and offer the items as multi-select; otherwise ask for "all" or the numbers.

## 2. Ask: see it first, or just apply?

Ask once for everything chosen, recommending **Show me first**.

The tools open pages in headless Chrome, so the site must be reachable: a running dev server, a staging URL, or `file://` for plain HTML. Nothing is added to the site. If there is no Chrome or the site can't be reached that way, read [references/fallbacks.md](references/fallbacks.md).

## 3. Get the grain

**Show me first.** Run in the background (it waits for the person), with one `--url` per page and that page's selectors after it:

```bash
node <skill>/scripts/review.mjs --url http://localhost:3000/ --selector ".hero" --selector ".footer-band" \
                                --url http://localhost:3000/about --selector ".about-header"
```

It photographs each background as it is and with every option (10–30 seconds per page), opens a local review page and prints its address. Give them the link and one line: "Drag across each picture, try Zoom, pick one per background, then press Done." Each card has a before/after slider, **Zoom on banding**, the options with the recommended one starred, a Screen switch and the measured numbers.

When the command exits, its output has the picks, the CSS for each background and a baseline folder per background for step 5.

**Just apply it.**

```bash
node <skill>/scripts/shoot.mjs --url http://localhost:3000/ --selector ".hero" --option recommended --out ./grain-shots
```

It writes `<out>/<selector>/report.json` (the report, the CSS for every option, the recommended one) and `compare-<option>.png`. Use the recommended CSS.

**Either way, show a picture in the chat.** `compare-<option>.png` has the full before/after, a magnified detail, the same detail with its contrast stretched (banding shows as stripes, grain as noise) and the measured numbers. It is the evidence that the change is real, so send it or give its path.

The report explains what the engine decided and why. If it mentions a method or a case you don't recognise (a child layer, fades on top, a canvas scene, pure black), read [references/engine.md](references/engine.md) before applying.

## 4. Apply

- Put each CSS block where that background is defined, with its comment.
- Keep the project's own background expression. The engine works from computed values, so put back `var(--slate)` or the original `linear-gradient(...)` where the output repeats a long resolved gradient.
- Do every version of each background (phone, dark mode): same selector, inside the same media query. Measure a version separately with `--phone` or `--colours` if its colours differ.
- For the child method, add `<div class="grain-layer" aria-hidden="true"></div>` where the comment says.
- If several rules use the same noise URL, define it once as a custom property.
- If the report lists "Fades on top", give each one the same grain as described there, or the gradient bands again where the fade is darkest.
- Remove anything temporary.

## 5. Check, every time

```bash
node <skill>/scripts/check.mjs --url http://localhost:3000/ --selector ".hero" --baseline <baseline folder> [--option even]
```

It photographs the page again and prints PASS or FAIL for each of: the grain layer is in the page, no new errors, the grain is close to the expected amount, the brightness didn't move, the stripes got narrower, nothing outside the background changed, no element moved or changed size. It writes `check.png`, before versus now.

On any FAIL, fix it and run the check again. Reporting success over a failed check would undo the point of the skill, which is that the result is proven. If a failure can't be fixed, say exactly which check failed and why.

## 6. Report

One or two sentences per background, or a short list for a whole site: what it is, what was chosen and why, and the measured result from the check, for example "grain 0.83 L\*, stripes 80px → 0.7px, nothing else changed". Send `check.png` or the compare picture. Say once that the grain adapts to HDR screens and the high-contrast setting and turns off in print. If the report says a target isn't confirmed by eye for that kind of background, say so briefly.

## Later requests

"Too much" or "can't see it": move one level and re-check. For coarser or finer grain, less on phones, or anything about the targets, read [references/tuning.md](references/tuning.md).
