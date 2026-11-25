# Calibration log

Why the numbers in [`calibration.json`](../skills/grainy-gradients/calibration.json) are what they are. The file holds only the shipped values; the reasoning lives here.

## Targets

Visible grain is measured as the spread of L\* (CIELAB lightness, 0–100). L\* is perceptual, so the same number looks about the same on any colour, which is why dark, mid and light share one set of targets.

| Level | Gradients | Photos |
|---|---|---|
| Subtle | 0.5 | 0.5 |
| Medium | 0.8 | 0.9 |
| Strong | 1.4 | 1.6 |

Below about 0.45 nobody can see the grain. An earlier set (0.14 / 0.27 / 0.44) showed no visible difference at any level and was dropped.

## Picks made by eye

| Date | Background | Tone (L\*) | Picked | Grain | Notes |
|---|---|---|---|---|---|
| 2026-11-08 | Dark radial gradient fading in over off-white, on a production site | dark (17.8) | Even | 0.81 | Soft-light. First confirmation of the 0.5 / 0.8 / 1.4 targets. |
| 2026-11-24 | Blue-black fog behind a lit ivory 3D scene | dark (4) | Medium | 0.81 | Grain added in a WebGL shader at a constant L\* step per pixel. Overlay at the same sky grain put 3.9 L\* on the lit floor and was rejected. |

Mid, light and photo targets are not yet confirmed by eye. The report says so when it uses one.

## Screens

The picks were made on a standard-range P3 display (`dynamic-range: high` false). Websites can't tell OLED from LCD, but CSS can tell HDR screens and the high-contrast setting, so the targets are scaled for those:

| Screen | Dark | Mid | Light |
|---|---|---|---|
| HDR (`dynamic-range: high`) | × 0.85 | × 0.92 | × 1 |
| High contrast (`prefers-contrast: more`) | × 0.7 | × 0.7 | × 0.7 |

HDR screens show deep darks harder, so dark backgrounds get a little less grain there. These factors are a first guess, not confirmed by eye.
