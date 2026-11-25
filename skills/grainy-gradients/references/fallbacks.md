# When headless Chrome can't be used

The normal flow photographs the page in headless Chrome. Use these when there is no Chrome on the machine, or the site can't be reached that way (login walls, a device-only build). `CHROME_PATH` points the tools at a browser in an unusual place.

## In-page preview

The person sees the options on their real page.

1. Copy [`assets/grain-page.js`](../assets/grain-page.js) next to the site's own scripts and check it loads (200, not 404).
2. Add the tag, with the backgrounds separated by `|`:

   ```html
   <script src="/js/grain-page.js" data-grain=".hero | .footer-band" defer></script>
   ```

3. Have them open the page with `?grain` in the URL. It does nothing without it. They get the same options with a draggable before/after handle. Picks are kept across pages.
4. **Copy picks** copies `grain: <option>` plus the look for each background. Pipe that into the CLI for the CSS:

   ```bash
   pbpaste | node <skill>/scripts/grain.mjs --look -
   ```

5. Remove the tag and the file afterwards.

## No browser at all

Give the colours by hand:

```bash
node <skill>/scripts/grain.mjs --colours "#323435,#2a2c2d@24%,#141617" --length 900 --selector ".hero"
```

Options: `--shape radial`, `--kind photo|flat`, `--fade-over "#fff"` for a background that fades in over that colour, `--option subtle|medium|strong|even`, `--background "linear-gradient(...)"` to keep the page's own expression in the output, `--json`.

For full control, write the look yourself and pass it with `--look`:

```json
{ "selector": ".hero", "kind": "gradient", "shape": "linear",
  "colours": [{ "colour": "#323435", "pos": 0 }, { "colour": "#141617", "pos": 1 }],
  "lengthPx": 900, "background": "linear-gradient(...)", "behind": "#ffffff",
  "solidBase": true, "position": "relative", "freePseudo": "::after", "moves": null }
```

Without pictures there is no check, so say that the result was calculated, not photographed.
