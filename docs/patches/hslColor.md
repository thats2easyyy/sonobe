<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# HSL Color

Builds a color from hue, saturation, lightness, and alpha between 0 and 1, for rainbows, tints, and shades.

| | |
|---|---|
| Type key | `hslColor` |
| Category | [Color](README.md#color) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | hsla, hue saturation lightness, color wheel, rainbow, hue shift, tint and shade, color from hue, palette |

## How it works
HSL Color describes a color the way people talk about one: which hue, how vivid, and how light.

- **Hue** picks a spot on the color wheel from 0 to 1: 0 is red, 0.33 green, 0.67 blue, and 1 is back at red. Values past either end keep going around, so 1.25 is the same as 0.25.
- **Saturation** runs from 0 (gray) to 1 (fully vivid).
- **Lightness** runs from 0 (black) through 0.5 (the purest hue) to 1 (white).
- **Alpha** is opacity, from 0 (transparent) to 1 (opaque).
- **Color** is the result. Saturation, Lightness, and Alpha are clamped to 0–1.

## Tips
- Divide a loop's index by its count and wire that into Hue to give every copy an evenly spaced color.
- Animate Hue with a linear Repeating Animation for a color cycle that never jumps.
- Start from a brand color with Color to HSL, then nudge Lightness for hover and pressed shades.

## Coming from Origami
The output is named Color.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Hue**<br>`hue` | `number` (progress) | `0` | Where on the color wheel, from 0 to 1: 0 red, 0.33 green, 0.67 blue; values outside 0–1 wrap around. step 0.01. |
| **Saturation**<br>`saturation` | `number` (progress) | `1` | How vivid the color is, from 0 (gray) to 1 (full color). Range 0 to 1, step 0.01. |
| **Lightness**<br>`lightness` | `number` (progress) | `0.5` | How light the color is: 0 is black, 0.5 the purest hue, 1 white. Range 0 to 1, step 0.01. |
| **Alpha**<br>`alpha` | `number` (progress) | `1` | Opacity, from 0 (fully transparent) to 1 (opaque). Range 0 to 1, step 0.01. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Color**<br>`color` | `color` | The color described by hue, saturation, lightness, and alpha. |

## Examples

### A row of dots in rainbow colors

```text
layer dot_row group "Dot Row" @16,400 370x48 layout=row spacing=16
  layer dot oval "Dot" 48x48 color←dot_color.color
patch dots loop count=6
patch spread mathExpression expression="hue = index / 6" index←dots.index
patch dot_color hslColor hue←spread.hue saturation=0.75 lightness=0.6
```

### A glow that cycles through every hue

```text
layer glow oval "Glow" @101,300 200x200 blur=24 color←glow_color.color
patch clock repeatingAnimation duration=4 curve=linear
patch glow_color hslColor hue←clock.progress saturation=0.9 lightness=0.6
```

## Common mistakes

- Every hue comes out red: Hue runs 0 to 1, not 0 to 360 degrees, so 120 wraps back to 0. Divide degrees by 360.
- The color stays gray, white, or black whatever the hue: Saturation is 0, or Lightness is at 0 or 1. Raise Saturation and keep Lightness between about 0.2 and 0.8.
- Rainbow colors don't look equally bright: lightness isn't perceived brightness, so yellow at 0.5 looks lighter than blue at 0.5. Adjust Lightness per hue by eye.

## Pairs well with

- [Color to HSL](colorToHsl.md): Splits a color into hue, saturation, lightness, and alpha numbers between 0 and 1.
- [Loop](loop.md): Makes a loop of indices from 0 up to Count minus 1, so layers and patches repeat once per index.
- [Repeating Animation](repeatingAnimation.md): Runs a progress value from 0 to 1 over and over, either restarting each time or swinging back and forth.
- [Math Expression](mathExpression.md): Calculates numbers from a formula you type, creating an input for each variable and an output for each result.
- [Gradient Builder](gradientBuilder.md): Builds a linear, radial, or angular gradient from color stops, ready for a layer's Gradient property.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** HSL Color (`builtin.color.hsl`)

| Sonobe port | Origami label |
|---|---|
| `color` | Output |
