<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Color to RGB

Splits a color into red, green, blue, and alpha numbers between 0 and 1.

| | |
|---|---|
| Type key | `colorToRgb` |
| Category | [Color](README.md#color) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | split color, color channels, unpack color, red green blue, rgba values, color components, get opacity |

## How it works
Color to RGB takes a color apart into the four numbers that make it up, each from 0 to 1.

- **Color** is the color to split.
- **Red**, **Green**, and **Blue** say how much of each light the color holds: 0 is none, 1 is full.
- **Alpha** is opacity: 0 is fully transparent, 1 is opaque.

## Tips
- Weigh the channels (0.2126 red, 0.7152 green, 0.0722 blue) for a quick estimate of how light a color looks, then choose black or white text for it.
- Wire Alpha into a layer's Opacity to fade a layer by a color's transparency.
- RGB Color puts the pieces back together after you change one.

## Coming from Origami
The input is named Color.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Color**<br>`color` | `color` | `#FFFFFFFF` | The color to split into channels. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Red**<br>`red` | `number` (progress) | How much red the color holds, from 0 to 1. |
| **Green**<br>`green` | `number` (progress) | How much green the color holds, from 0 to 1. |
| **Blue**<br>`blue` | `number` (progress) | How much blue the color holds, from 0 to 1. |
| **Alpha**<br>`alpha` | `number` (progress) | The color's opacity, from 0 (fully transparent) to 1 (opaque). |

## Examples

### Pick black or white text for any background

A quick brightness estimate flips the title between white and black as the card cycles through hues.

```text
layer card rectangle "Card" @16,120 370x200 cornerRadius=20 color←card_color.color
layer title text "Title" "Hello" @40,196 fontSize=28 textColor←text_color.output
patch clock repeatingAnimation duration=8 curve=linear
patch card_color hslColor hue←clock.progress saturation=0.7 lightness=0.55
patch channels colorToRgb color←card_color.color
patch luma mathExpression expression="light = 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? 1 : 0" r←channels.red g←channels.green b←channels.blue
patch text_color optionPicker<color>[2] option←luma.light option0=#FFFFFFFF option1=#000000FF
```

## Common mistakes

- The numbers look far too small for your code or API: channels run 0 to 1, not 0 to 255. Multiply by 255 and round.
- A half-transparent color still reports full Red: channels aren't multiplied by Alpha. Multiply each channel by Alpha when you need the blended values.

## Pairs well with

- [RGB Color](rgbColor.md): Builds a color from red, green, blue, and alpha numbers between 0 and 1.
- [Math Expression](mathExpression.md): Calculates numbers from a formula you type, creating an input for each variable and an output for each result.
- [Greater Than](greaterThan.md): Checks whether a value is greater than another, such as a drag passing a threshold or a timer passing a time.
- [Option Picker](optionPicker.md): Outputs one of several values chosen by an option number, like a different color or title for each tab.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Color to RGB (`builtin.color.torgb`)
