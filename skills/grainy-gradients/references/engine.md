# What the engine decides

Read this when a report mentions a method or a case you need to act on.

## Contents

- [How the grain is attached](#how-the-grain-is-attached)
- [Special cases](#special-cases)
- [Canvas and WebGL backgrounds](#canvas-and-webgl-backgrounds)
- [How colours are weighted](#how-colours-are-weighted)

## How the grain is attached

| Situation | Method | What the CSS does |
|---|---|---|
| Gradient or flat colour on an element | **one-layer** | The noise becomes the element's top background layer (`background-blend-mode`), held in a `--grain` custom property. One value is added to the front of every background list, so the page's own sizes, positions and blends are kept. It can't cover text. |
| Background that fades in | **one-layer** | The same, so the grain fades in with it. The report gives the grain at each stage of the fade. |
| See-through gradient with nothing solid under it | **layer** or **child** | Its own layer, so it blends with what shows through instead of painting as grey haze. |
| Photo or image background | **layer** | A free `::after` or `::before`; a child element if both are taken. |
| `<img>` or `<video>` filling the element | **child** | A child element placed right after the media, so it paints above it and under the content that follows. |
| Background on a pseudo-element | **child** | A child element at `z-index: -1` in an isolated host. |

The child method needs `<div class="grain-layer" aria-hidden="true"></div>` added to the markup. The CSS comment says where.

## Special cases

| Case | What happens |
|---|---|
| Pure black or white | Overlay and soft-light can't add grain there. The engine uses screen or multiply with a small brightness shift (1 L\* at most) and says so. If even that isn't enough it reports the most it can do and suggests skipping. |
| Uneven grain across the gradient | Recommends Even when Even is clearly more even. Even is hidden when it would be the same as Medium. |
| High banding risk | The report says whether the chosen grain breaks the stripes up. Strong does more. |
| Old noise layer in the same background | The CSS replaces it. If the old noise is somewhere else (a pseudo-element or child), the report says to remove it; do that, don't stack two. |
| "Fades on top" | See-through gradients stacked over the background cover the grain, so the gradient can band again where the fade is darkest. Give each one the same grain tile, lined up: a solid colour with the noise blended in (`background-blend-mode`), faded with `mask-image` instead of a transparent gradient. |
| HDR, high contrast, print | `@media (dynamic-range: high)` and `@media (prefers-contrast: more)` re-solve the amount with the same blend. `@media print` turns it off. A rule that would come out the same as the base is left out. |

## Canvas and WebGL backgrounds

When part of the background is drawn in a canvas (a 3D ground, a shader backdrop), CSS grain behind the canvas can't reach it, so the canvas part looks smooth or blotchy next to the grained area. The tools can't fix this; you add it:

- In that material's fragment shader, after the colour-space conversion, soft-light the same noise tile in screen space: `gl_FragCoord.xy / tilePx`, where the tile is 200 × the renderer's pixel ratio.
- Read the tile and amount from the page's `--grain` custom property, so the phone, HDR and high-contrast amounts carry over. Re-read it on resize.
- Measure by rendering one frame and reading the pixels.

## How colours are weighted

Colours count by how much of the gradient they cover. A thin highlight counts less than the large dark area around it, and a radial gradient's outer rings count more than its centre. That is why the phone and desktop versions of one section get the same treatment even when their stops sit at different positions.
