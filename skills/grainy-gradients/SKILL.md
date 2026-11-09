---
name: grainy-gradients
description: Add film grain (noise) to CSS gradients and backgrounds so they look printed instead of plastic, and remove colour banding. Works on one background or a whole site or app, where it scans the codebase, lists every background and lets the person pick. It measures each background, picks the blend and amount itself, shows a before/after on the real page, and writes CSS that adapts to the visitor's screen (HDR/OLED, high contrast, print). Use when someone says a background or gradient looks cheap, flat, plastic, too smooth, digital or not premium, shows stripes or banding, asks for grain, noise, texture or a film or poster look, asks to check their site's gradients, or mentions the feTurbulence noise trick.
---

# Grainy gradients

Smooth digital gradients read as "computer". A fine noise layer makes them read as print or film, and it hides banding (visible stripes where a gradient steps from one 8-bit colour level to the next).

**You do the whole job. The person only looks and picks.** Never ask about blend modes, opacity or numbers. The person makes three kinds of decision, and nothing else:

1. **Which backgrounds** (only when you scanned a whole site).
2. **Whether to see a before and after first**, or just have it applied.
3. **Which option looks best** in the preview.

## How to think about it

- **Grain is texture, not colour.** It must not lighten, darken or tint. The noise is centred on mid-grey, so the brightness shift should be close to 0. It can't be for pure black or white, and the report says so.
- **Measure what's visible, not the opacity.** Visible grain is the spread of L* (CIELAB lightness, 0–100), and L* is perceptual, so the same number looks about the same on any colour. Below about 0.45 nobody can see it. The targets are 0.5 / 0.8 / 1.4 for Subtle / Medium / Strong.
- **Even matters on gradients that go from light to dark.** Overlay puts most of the grain on the lighter parts. Even picks the blend (usually soft-light) that spreads it more evenly. People tend to prefer it.
- **The grain belongs to the background.** It sits right above the background, under everything else, and goes wherever the background goes. If the background fades in, the grain fades in with it.
- **It adapts to each visitor's screen.** Websites can't tell OLED from LCD, but CSS can tell HDR screens (most OLED phones, XDR laptops) and the high-contrast setting. The CSS includes those media queries:
  - dark backgrounds get a little less grain on HDR screens
  - the high-contrast setting gets less grain
  - printing turns it off

  It's all CSS, with no script on the live site.
- **Skip what grain can't help:**
  - small things (buttons, badges, icons)
  - gradient text
  - see-through scrims and fades on top of photos
  - stripe and hatch patterns

## 1. Which way did they ask?

- **One place** ("the hero looks flat", "add grain to the footer"): go to [Find one background](#2a-find-one-background).
- **The whole site or app** ("go through my codebase", "check all my gradients", "do the whole site"): go to [Scan the whole site](#2b-scan-the-whole-site).

### 2a. Find one background

Find the element that actually paints the background. Check:
- the element itself, and its `::before` and `::after`
- full-size layers inside it or behind it (sections often get their colour from a separate absolutely positioned div)

With a browser tool, list the candidates:

```js
[...document.querySelectorAll('#section, #section *')].flatMap(e => [null, '::before', '::after'].map(p => [e, p, getComputedStyle(e, p)]))
  .filter(([, p, c]) => (!p || c.content !== 'none') && (c.backgroundImage !== 'none' || c.backgroundColor !== 'rgba(0, 0, 0, 0)'))
  .map(([e, p, c]) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${[...e.classList].join('.')}${p || ''} | ${c.position} | opacity ${c.opacity} | ${(c.backgroundImage !== 'none' ? c.backgroundImage : c.backgroundColor).slice(0, 80)}`)
```

Without a browser, read the CSS. Either way, search the CSS for other versions of that background: media queries (phone layouts often swap the gradient) and dark-mode rules. Note them for step 5.

Then go to [step 3](#3-ask-before-or-after).

### 2b. Scan the whole site

```bash
node <this skill's folder>/scripts/scan.mjs <project folder>
```

It reads stylesheets (rules, media queries, custom properties), markup and components (Tailwind gradient classes, inline styles, CSS-in-JS) in about a second. It sorts what it finds into four groups:
- **Good candidates:** large backgrounds.
- **Worth a look:** size unknown from the code.
- **Already has grain.**
- **Skip,** with the reason.

It also lists which pages load each stylesheet. Add `--json` for the full data.

**Sort the "worth a look" ones yourself.** Before you show the list, sort them from what you can see. With a browser tool, measure their size on the page. Otherwise read the markup. Move each one to good or skip. Don't send the person a list of things you could have checked.

**Then show the list,** short, one line each, in plain words, grouped by page. For example:

> I found 6 backgrounds that could take grain:
> 1. **Home, tour section:** dark gradient that fades in
> 2. **Home, hero:** dark radial glow
> 3. **Sustainability, header:** green-black gradient
> 4. **Careers, "made here" band:** orange-black gradient
>
> Skipping 12: buttons, gradient text, photo scrims and stripe patterns.
> The quote page already has grain, but at an amount nobody can see, so I'd redo it.

**Then let them choose.** If you have a multiple-choice question tool (AskUserQuestion in Claude Code), use it:
- Ask "Which backgrounds should get grain?" with **All of them (Recommended)** first.
- For up to 3 more items, list each one as an option with multi-select on.
- If there are more than 4, ask first "All of them, or pick?"; on "pick", ask multi-select questions of up to 4 items each.

Without the tool, ask them to reply with "all" or the numbers.

### 3. Ask: before/after, or just apply?

Ask once, for everything chosen: "Do you want to see a before and after first, or should I just apply the best one for each?" Use the multiple-choice tool if you have it, with **Show me first (Recommended)** and **Just apply it**.

The tools below need **Node 22+** and a **Chrome, Chromium, Edge or Brave** on the machine (found automatically; `CHROME_PATH` overrides). They open the pages headless, so the site must be reachable: a running dev server, a staging URL, or `file://` for plain HTML. Nothing is added to the site.

## 4. Show the before/after

### Show me first: the review page

Run it **in the background** (it waits for the person) with one `--url` per page and that page's selectors after it:

```bash
node <skill>/scripts/review.mjs --url http://localhost:3000/ --selector ".hero" --selector ".footer-band" \
                                --url http://localhost:3000/about --selector ".about-header"
```

- **It takes the pictures itself.** For each background it photographs the page as it is and with every option, plus what HDR screens and the high-contrast setting get. This takes about 10–30 seconds per page.
- **Then it opens a local review page** in their browser and prints its address; give them the link too.
- **Each background gets a card** with:
  - a before/after slider
  - **Zoom on banding**, which magnifies the area that bands the most (fine grain is invisible in a scaled-down picture)
  - the options as tabs, with the recommended one starred
  - a Screen switch
  - the measured numbers, and a "Why" with the report
- **"Done, send my picks"** sends the picks straight back. No copy-paste.

Tell them in one line what to do: "Drag across each picture, try Zoom, pick one per background, then press Done." When the command exits, its output has the picks, **the CSS for each background**, and a baseline folder per background for the check in step 7.

**Also show a picture in the chat.** Each baseline folder has `compare-<option>.png`:
- full before/after
- a magnified detail
- the same detail with its contrast stretched, so banding shows as stripes and grain as noise
- the measured numbers

Send the recommended one to the person (with a file-sending tool if you have one; otherwise give the path). It's the evidence that the change is real.

### Just apply it

Take the baseline and pictures first, so the result can be checked and shown:

```bash
node <skill>/scripts/shoot.mjs --url http://localhost:3000/ --selector ".hero" --option recommended --out ./grain-shots
```

It prints one line per picture (grain, brightness, stripe width) and writes `<out>/<selector>/` with `report.json` (the report, the CSS for every option, the recommended one) and `compare-<option>.png`. Use the recommended CSS from `report.json`.

### No Chrome, or the site can't be reached headless

Fall back to the in-page preview: copy [dist/grain-page.js](dist/grain-page.js) next to the site's own scripts (check it loads, 200 not 404), add `<script src="/js/grain-page.js" data-grain=".hero | .footer" defer></script>`, and have them open the page with `?grain`. It shows the same options with a draggable handle on the real page; **Copy picks** copies `grain: <option>` + the look for each background, which you pipe into `node <skill>/scripts/grain.js --look -` for the CSS. Remove the tag and file afterwards.

Without any browser at all, write the look yourself and run `grain.js` on it:

```json
{ "selector": ".hero", "kind": "gradient", "shape": "linear",
  "colours": [{ "colour": "#323435", "pos": 0 }, { "colour": "#141617", "pos": 1 }],
  "lengthPx": 900, "background": "linear-gradient(...)", "behind": "#ffffff",
  "solidBase": true, "position": "relative", "freePseudo": "::after", "moves": null }
```

or `node grain.js --colours "#323435,#2a2c2d@24%,#141617" --length 900 --selector ".hero" [--shape radial] [--fade-over "#fff"] [--option even]`.

### What the engine decides, so you don't have to

| Situation | What it does |
|---|---|
| Gradient or flat colour on an element | **One layer:** the noise becomes the element's top background layer (`background-blend-mode`), held in a `--grain` custom property. One value is added to every background list, so the page's own sizes, positions and blends are kept. It can't cover text. |
| Background fades in | The same one layer, so the grain fades in with it. The report gives the grain at each stage of the fade. |
| See-through gradient with nothing solid under it | Its own layer (a free `::after`/`::before`, or a child element) so it blends with what shows through instead of turning grey. |
| Photo or image background | A free pseudo-element, or a child element if both are taken. |
| `<img>`/`<video>` filling the element, or a background on a pseudo-element | A child element at `z-index: -1` in an isolated host. |
| Pure black or white | Overlay and soft-light can't add grain there, so it uses screen or multiply with a small brightness shift, and says so. |
| Uneven grain across the gradient | Recommends Even, if Even is clearly more even. Even is hidden when it would be the same as Medium. |
| High banding risk | Says whether the chosen grain breaks the stripes up. Strong does more. |
| Old noise layer in the same background | Replaces it. If the old noise is somewhere else (a pseudo-element), says to remove it. |
| Part of the background drawn in a WebGL/canvas scene (a 3D ground, a shader backdrop) | CSS grain behind the canvas can't reach it, so the canvas part looks smooth or blotchy next to grained sky. **You** add it: in that material's fragment shader, after the colour-space conversion, soft-light the same noise tile in screen space (`gl_FragCoord.xy / tilePx`, tile = 200 × renderer pixel ratio). Read the tile and amount from the page's `--grain` custom property, so phone, HDR and high-contrast amounts carry over, and re-read it on resize. Measure by rendering one frame and reading the pixels. |
| HDR screens, high contrast, print | `@media (dynamic-range: high)` and `@media (prefers-contrast: more)` re-solve the amount for those screens, with the same blend. `@media print` turns it off. A rule that would come out the same is left out. |

Colours are weighted by how much of the gradient they cover. A thin highlight doesn't count as much as the big dark area, so phone and desktop versions of the same section get the same treatment.

## 5. Apply

- **Put each CSS block where that background is defined,** with its comment.
- **Keep the project's own background expression.** The engine works from computed values, so put back `var(--slate)` or the original `linear-gradient(...)` where the output repeats a long resolved gradient.
- **Do every version** of each background (phone, dark mode). The one-layer CSS goes on the same selector inside the same media query. Measure each version with `--phone` or `--colours` if it differs.
- **Child method:** add the `<div class="grain-layer" aria-hidden="true"></div>` where the comment says (in a component, in its markup).
- **Use one custom property for a repeated noise URL.** If several rules use the same one, define it once.
- **If the report lists "Fades on top",** give each one the same grain as described there, or it bands again where it's darkest.
- Remove anything temporary (a preview tag, `grain-page.js`).

## 6. Check, every time

Before saying it's done, check each background against its baseline:

```bash
node <skill>/scripts/check.mjs --url http://localhost:3000/ --selector ".hero" --baseline <baseline folder> [--option even]
```

It photographs the page again and prints PASS/FAIL for each of these:
- **The grain layer** is in the page (the CSS loaded and is on the right selector).
- **No new errors** on the page.
- **The grain** is close to the expected amount.
- **The brightness** didn't move.
- **The stripes** got narrower.
- **Nothing outside the background** changed.
- **No element moved** or changed size.

It writes `check.png`, before vs now. **On any FAIL, fix it and run the check again;** don't report success over a failure. If a FAIL can't be fixed, tell the person exactly which check failed and why.

## 7. Report

One or two sentences per background, or a short list for a whole site: what it is, what was chosen and why. Add the measured result from the check (for example "grain 0.83 L*, stripes 80px → 0.7px, nothing else changed") and send `check.png` or the `compare` picture. Say once that the grain adapts to HDR screens and the high-contrast setting and turns off in print. If the report says a target isn't confirmed by eye for that kind of background, say so briefly.

## Adjusting later

- **"Too much" or "can't see it":** move one level.
- **"Coarser" or "finer" grain:** change `grain.freq` in `calibration.json` (lower is coarser; typical values are 0.6–1.2), then run `node scripts/build.mjs`.
- **"Less on my phone":** lower `screens.hdr` for that tone in `calibration.json`.

## Calibration

`calibration.json` holds:
- **`targets`:** the visible-grain targets, for the screen in `screens.reference`, the one the picks were made on.
- **`screens`:** the factors for other screens. These are a first guess, not confirmed by eye.
- **`confirmed`:** what a person has checked by eye.

The repository's `demo/index.html` bench compares options on several backgrounds. After changing `calibration.json`, run `node scripts/build.mjs` so the page script picks it up.
