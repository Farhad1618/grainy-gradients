# Tuning the grain

Everything adjustable is in [`calibration.json`](../calibration.json). The headless tools and the CLI read it on every run, so an edit applies straight away.

| The person says | Change |
|---|---|
| "Too much" / "can't see it" | Nothing here: move one level (Subtle, Medium, Strong) and re-check. |
| "Coarser" / "finer" grain | `grain.freq`. Lower is coarser. Typical values are 0.6–1.2; the default is 0.8. |
| "Less on my phone" | Lower `screens.hdr` for that tone. Most OLED phones report as HDR. |
| "Less for people on high contrast" | Lower `screens.contrastMore`. |
| Every level feels too weak or too strong | `targets.<gradient|photo>.<tone>`. Keep Subtle at 0.45 or more, or it's invisible. |

## What the file holds

- **`targets`:** visible grain (the spread of L\*) for each kind of background, tone and level. They are for the screen named in `screens.reference`.
- **`grain`:** the noise tile: `freq` (base frequency), `octaves`, `tile` (size in px).
- **`screens`:** factors for screens other than the reference. `screens.confirmed` is false while they are still a first guess.
- **`confirmed`:** which targets a person has checked by eye. When a background's kind and tone isn't in the list, the report adds a note; pass it on.

After a change, re-run the review or the check on a real background before telling the person it's done: the numbers only matter through what they look like.

The in-page preview (`assets/grain-page.js`) has the defaults built in. It only picks up an edited `calibration.json` after `npm run build` in the repository.
