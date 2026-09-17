<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Hex Color

Turns a hex code such as #FF5F6D into a color you can wire into any color property.

| | |
|---|---|
| Type key | `hexColor` |
| Category | [Color](README.md#color) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | hex, hex code, color from hex, css color, html color, text to color, parse color, design token |

## How it works
Hex Color reads a hex code, the short color code design tools show next to a swatch, and outputs that color.

- **Hex** accepts 3, 4, 6, or 8 hex digits, with or without a leading `#`, in upper- or lowercase: `#F0A`, `#FF00AA`, or `#FF00AA80`, where the last pair is alpha. Spaces around the code are ignored.
- **Color** is the color the code describes. While Hex isn't a valid code, it's transparent.
- **Valid** is true when Hex is a code the patch understands.

## Tips
- Keep brand colors in a few Hex Color patches so the whole prototype shares one source of truth.
- Give it a loop of codes to color each copy of a looped layer differently.
- Codes from Figma or CSS paste in as they are. Color names and `rgb()` text aren't read.

## Coming from Origami
The output is named Color, and Valid is new. Codes with 4 or 8 digits put alpha last, as in CSS.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Hex**<br>`hex` | `text` | `"#FFFFFF"` | The hex code to read, such as #FF5F6D or FF5F6D; in 4- and 8-digit codes the last digits are alpha. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Color**<br>`color` | `color` | The color the code describes; transparent while Hex isn't a valid code. |
| **Valid**<br>`valid` | `boolean` | True when Hex is a valid 3, 4, 6, or 8-digit hex code. |

## Examples

### Color list rows from hex codes

A loop of three codes replicates the row, one color per copy.

```text
layer list group "List" @16,120 358x276 layout=column spacing=12
  layer row rectangle "Row" 358x80 cornerRadius=16 color←row_color.color
patch row_color hexColor hex=loop["#FF5F6D"|"#FFC371"|"#47CACC"]
```

### Press a brand-colored button to its darker shade

```text
layer button rectangle "Button" @24,760 354x56 cornerRadius=14 color←tint.output
patch brand hexColor hex="#5B5FEF"
patch brand_pressed hexColor hex="#3E42C8"
patch tap_button interaction layer=@button
patch press popAnimation number←tap_button.down bounciness=0 speed=20
patch tint transition<color> progress←press.output start←brand.color end←brand_pressed.color
```

## Common mistakes

- The layer vanishes: Hex isn't a valid code, for example 5 digits, a space inside the code, or a color name, so Color is transparent. Check Valid and use 3, 4, 6, or 8 hex digits.
- An 8-digit code copied from Android or Swift code shows the wrong color: those often put alpha first (AARRGGBB), but Hex reads alpha last. Move the first two digits to the end.

## Pairs well with

- [Color to Hex](colorToHex.md): Turns a color into hex code text such as #FF5F6D, for labels, data, and handoff.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Option Picker](optionPicker.md): Outputs one of several values chosen by an option number, like a different color or title for each tab.
- [Loop Over Array](loopOverArray.md): Turns a JSON array into a loop, one item per element, so layers repeat for each entry.
- [Value for Key](valueForKey.md): Reads one named field from a JSON object, such as a product's name or price.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Hex Color (`builtin.color.hex`)

| Sonobe port | Origami label |
|---|---|
| `color` | Output |
