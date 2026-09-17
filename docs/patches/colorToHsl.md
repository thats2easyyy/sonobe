<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Color to HSL

Splits a color into hue, saturation, lightness, and alpha numbers between 0 and 1.

| | |
|---|---|
| Type key | `colorToHsl` |
| Category | [Color](README.md#color) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | split color, unpack color, get hue, hue saturation lightness, hsla values, complementary color, color analysis |

## How it works
Color to HSL describes a color by its hue, how vivid it is, and how light it is, each from 0 to 1.

- **Color** is the color to describe.
- **Hue** is its spot on the color wheel: 0 red, 0.33 green, 0.67 blue, rising toward 1 as it comes back around to red.
- **Saturation** runs from 0 (gray) to 1 (fully vivid).
- **Lightness** runs from 0 (black) through 0.5 (the purest hue) to 1 (white).
- **Alpha** is opacity.

## Tips
- Change one number and rebuild the color with HSL Color: add 0.5 to Hue for the complementary color, or multiply Lightness by 0.8 for a pressed shade.
- Grays, white, and black have no hue, so Hue reads 0 for them.

## Coming from Origami
The input is named Color.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Color**<br>`color` | `color` | `#FFFFFFFF` | The color to describe as hue, saturation, and lightness. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Hue**<br>`hue` | `number` (progress) | The color's spot on the color wheel, from 0 up to (not including) 1; 0 for grays. |
| **Saturation**<br>`saturation` | `number` (progress) | How vivid the color is, from 0 (gray) to 1 (full color). |
| **Lightness**<br>`lightness` | `number` (progress) | How light the color is: 0 black, 0.5 the purest hue, 1 white. |
| **Alpha**<br>`alpha` | `number` (progress) | The color's opacity, from 0 (fully transparent) to 1 (opaque). |

## Examples

### Derive a pressed shade from a brand color

```text
layer button rectangle "Button" @24,760 354x56 cornerRadius=14 color←tint.output
patch brand hexColor hex="#5B5FEF"
patch brand_hsl colorToHsl color←brand.color
patch darker mathExpression expression="shade = lightness * 0.8" lightness←brand_hsl.lightness
patch pressed_color hslColor hue←brand_hsl.hue saturation←brand_hsl.saturation lightness←darker.shade alpha←brand_hsl.alpha
patch tap_button interaction layer=@button
patch press popAnimation number←tap_button.down bounciness=0 speed=20
patch tint transition<color> progress←press.output start←brand.color end←pressed_color.color
```

### Pair a color with its complementary accent

```text
layer primary oval "Primary" @111,360 80x80 color=#34C759FF
layer accent oval "Accent" @211,360 80x80 color←complement.color
patch primary_hsl colorToHsl color=#34C759FF
patch opposite mathExpression expression="shifted = hue + 0.5" hue←primary_hsl.hue
patch complement hslColor hue←opposite.shifted saturation←primary_hsl.saturation lightness←primary_hsl.lightness
```

## Common mistakes

- Hue snaps to red after you desaturate: a gray has no hue, so Hue reads 0 when Saturation is 0. Take Hue from the original color, not the desaturated one.
- A hue shift stops at red instead of going around: Hue was clamped to 0–1 after adding an offset. Leave the sum unclamped; HSL Color wraps Hue, so 1.2 means 0.2.

## Pairs well with

- [HSL Color](hslColor.md): Builds a color from hue, saturation, lightness, and alpha between 0 and 1, for rainbows, tints, and shades.
- [Math Expression](mathExpression.md): Calculates numbers from a formula you type, creating an input for each variable and an output for each result.
- [Color to RGB](colorToRgb.md): Splits a color into red, green, blue, and alpha numbers between 0 and 1.
- [Hex Color](hexColor.md): Turns a hex code such as #FF5F6D into a color you can wire into any color property.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Color to HSL (`builtin.color.tohsl`)
