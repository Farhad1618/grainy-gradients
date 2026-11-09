# How it works

- **Measures, doesn't guess.**
  - Visible grain is the spread of L* (perceptual lightness).
  - The engine solves the blend and opacity for a target: 0.5 / 0.8 / 1.4 L* for Subtle / Medium / Strong. Below about 0.45 nobody sees it.
  - Its noise is a port of the SVG `feTurbulence` filter, centred so it never lightens or darkens the page.
- **Even option.** On light-to-dark gradients, overlay puts most of the grain on the light parts. Soft-light spreads it evenly, and it's recommended when that's clearly better.
- **Adapts to the screen.** One CSS:
  - a little less grain on HDR/OLED screens for dark backgrounds
  - less with the high-contrast setting
  - none when printed
- **Handles real sites:**
  - Tailwind `oklch`, layered glows, `::before`/`::after`
  - photos (grain above the image, under the text)
  - backgrounds that fade in on scroll, shades on top
  - React/Vue pages, strict CSP, 3D canvases
- **Finds backgrounds across a codebase.** CSS, Tailwind classes, inline styles and CSS-in-JS. It skips buttons, gradient text, stripe patterns and scrims, and says why.
- **Proves it.** Headless Chrome takes before/after pictures. After applying, a check fails unless:
  - the grain is there at the expected amount
  - the brightness didn't move
  - the stripes shrank
  - nothing else on the page changed or moved
  - there are no new errors
- **Tested.** `npm test` runs the whole flow on 19 pages in [`tests/pages`](../tests/pages).

The code is in [`skills/grainy-gradients/scripts`](../skills/grainy-gradients/scripts): `grain.js` (engine), `look.js` (reads a background), `scan.mjs`, `shoot.mjs`, `review.mjs`, `check.mjs`.
