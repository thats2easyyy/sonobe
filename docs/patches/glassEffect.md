<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Glass Effect

Turns a layer into a pane of glass that frosts, tints, and bends whatever sits behind it, with a bright rim along its edge.

| | |
|---|---|
| Type key | `glassEffect` |
| Category | [Layers & Effects](README.md#layers--effects) |
| Tier | 3 (hardware and platform-specific) |
| Status | Web-limited |
| Search terms | liquid glass, frosted glass, glassmorphism, material, translucent, refraction, backdrop blur, visual effect, lens, vibrancy |

## How it works
Glass Effect makes an effect value that turns a layer into a glass pane. Wire **Effect** into a layer's **Effects** property: whatever is behind the layer shows through frosted and tinted, bent near the edges like a lens, with a light rim. The pane follows the layer's shape, including corner radius and smoothing.

- **Intensity** fades the whole effect: 0 is no glass, 1 is full glass. Animate it to bring glass in or out.
- **Frost** is how much the background blurs, in points.
- **Tint** is a color washed over the glass; its alpha sets how strong it is.
- **Refraction** is how strongly the edges bend what's behind, from 0 to 1.
- **Highlight** is how bright the rim light is, from 0 to 1.
- **Saturation** and **Depth** (advanced) boost background colors and set how far the lens reaches in from the edge.

Children of the layer draw on top of the glass, sharp and unaffected.

## Tips
- Clear glass over photos: Frost 2, a Tint alpha around 5%, and Refraction 0.8.
- Match the theme: choose a dark Tint in dark mode with Device Info and If / Else.
- Glass is expensive to draw. On phones, use a few panes rather than a grid of them.

## Coming from Origami
Origami's glass support has unpublished parameters. This patch is Sonobe's own design, and imported glass doesn't carry its settings over.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Intensity**<br>`intensity` | `number` (progress) | `1` | Fades the whole effect: 0 is no glass and 1 is full glass. Range 0 to 1, step 0.01. |
| **Frost**<br>`frost` | `number` (distance) | `8` | How much what's behind the glass blurs, in points; 0 keeps it sharp. Range 0 to 50, step 0.5. |
| **Tint**<br>`tint` | `color` | `#FFFFFF26` | A color washed over the glass; its alpha sets the strength, and an alpha of 0 means no tint. |
| **Refraction**<br>`refraction` | `number` (progress) | `0.5` | How strongly the edges bend what's behind, like a lens: 0 is flat and 1 is strongest. Range 0 to 1, step 0.01. |
| **Highlight**<br>`highlight` | `number` (progress) | `0.6` | How bright the light rim along the edge is, brightest at the top left; 0 turns it off. Range 0 to 1, step 0.01. |
| **Saturation**<br>`saturation` | `number` · advanced | `1.4` | Boosts the colors seen through the glass: 1 is unchanged and 0 is black and white. Range 0 to 2, step 0.01. |
| **Depth**<br>`depth` | `number` (distance) · advanced | `16` | How far the lens bending reaches in from the edge, in points; 0 turns refraction off. Range 0 to 64, step 1. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Effect**<br>`effect` | `layerEffect` | Wire into a layer's Effects property to turn that layer into glass. |

## Examples

### A glass tab bar over a scrolling feed

The feed scrolls under the bar, and the label inside the bar stays sharp on top of the glass.

```text
layer feed group "Feed" 402x2400 position←feed_scroll.position
layer tab_bar group "Tab Bar" @24,780 354x64 cornerRadius=32 cornerSmoothing=0.6 effects←bar_glass.effect
  layer home_label text "Home" "Home" @40,22
patch feed_scroll scroll layer=@feed
patch bar_glass glassEffect frost=10 tint=#FFFFFF33 refraction=0.6
```

### Turn a header to glass once content scrolls under it

The header is clear at the top of the page and becomes full glass after 80 points of scrolling.

```text
layer feed group "Feed" 402x2400 position←feed_scroll.position
layer header group "Header" @0,0 402x96 effects←header_glass.effect
  layer title text "Title" "Library" @16,56
patch feed_scroll scroll layer=@feed
patch scrolled progress value←feed_scroll.y start=0 end=-80 clampToRange=true
patch header_glass glassEffect intensity←scrolled.progress frost=12 refraction=0.3
```

## Common mistakes

- The glass looks like a flat gray panel: the layer's Color is opaque and covers the glass. Set the layer's Color alpha to 0 and use Tint for color.
- Nothing shows through the glass: the content is in front of the glass layer, not behind it. Glass only shows layers below it in the layer list, so move the glass layer above the content.
- The glass frosts its own label: the label is a sibling behind the glass. Make the label a child of the glass layer so it draws on top, sharp.

## Pairs well with

- [Scroll](scroll.md): Scrolls a content layer inside its parent with momentum, rubber banding, or paging, and outputs the scroll position and page.
- [Progress](progress.md): Converts a number from any range into progress, where Start gives 0 and End gives 1.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Blur Effect](blurEffect.md): Creates a blur for a layer's Effects property, softening everything the layer draws, with an option to keep its edges sharp.
- [Device Info](deviceInfo.md): Reports the screen size, safe area, orientation, dark mode, and input style of the device the prototype runs on.

## Availability

**Web-limited.** The frosted blur, tint, and rim work everywhere through CSS backdrop-filter. Refraction needs an SVG filter inside backdrop-filter, which only Chromium supports, so Safari and Firefox show the glass without lensing.

Works in the desktop app, the web player in desktop browsers, and the web player on phones and tablets.

Tier 3: hardware and platform-specific.

## Origami mapping

- **Origami patch:** Liquid Glass
