<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Color to Hex

Turns a color into hex code text such as #FF5F6D, for labels, data, and handoff.

| | |
|---|---|
| Type key | `colorToHex` |
| Category | [Color](README.md#color) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | hex code, color code, color to text, hex string, css hex, export color, handoff color |

## How it works
Color to Hex writes a color as a hex code, the text designers copy between tools.

- **Color** is the color to describe.
- **Include Alpha** adds a final pair of digits for opacity (`#FF5F6D80`). While it's off, the code has six digits and opacity is dropped.
- **Hex** is the code: a `#`, then an uppercase pair of digits each for red, green, and blue.

## Tips
- Wire Hex into a Text layer to show a live color value, for example in a color picker prototype.
- Need lowercase or no `#`? Follow it with Change Case or Substring.
- Hex Color reads the text back into a color.

## Coming from Origami
Include Alpha is new; with it off, alpha is discarded as in Origami. Sonobe always writes uppercase digits after a `#`.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Color**<br>`color` | `color` | `#FFFFFFFF` | The color to write as a hex code. |
| **Include Alpha**<br>`includeAlpha` | `boolean` | `false` | When on, adds opacity as a final pair of digits (#RRGGBBAA). |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Hex**<br>`hex` | `text` | The color as text: # then six uppercase hex digits, or eight while Include Alpha is on. |

## Examples

### Show the hex code of a changing color

```text
layer swatch rectangle "Swatch" @101,240 200x200 cornerRadius=24 color←swatch_color.color
layer code text "Hex Code" @101,460 fontSize=28 text←swatch_hex.hex
patch clock repeatingAnimation duration=6 curve=linear
patch swatch_color hslColor hue←clock.progress saturation=0.8 lightness=0.55
patch swatch_hex colorToHex color←swatch_color.color
```

## Common mistakes

- A see-through color shows the same code as a solid one: Hex drops opacity by default. Turn on Include Alpha to get #RRGGBBAA.
- An API or code snippet rejects the code because it expects lowercase or no #: follow Color to Hex with Change Case, or with Substring to drop the first character.

## Pairs well with

- [Hex Color](hexColor.md): Turns a hex code such as #FF5F6D into a color you can wire into any color property.
- [Change Case](changeCase.md): Changes text to uppercase, lowercase, capitalized words, or sentence case.
- [Substring](substring.md): Keeps part of some text, a number of characters from a starting position, for initials, previews, and shortened titles.
- [JSON Object](jsonObject.md): Builds a JSON object with one named value, like {"name": "Ada"}, for request bodies, headers, and nested data.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Color to Hex (`builtin.color.tohex`)
