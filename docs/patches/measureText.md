<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Measure Text

Measures how wide and tall text would be in a given font and size, so shapes can fit around a label.

| | |
|---|---|
| Type key | `measureText` |
| Category | [Text](README.md#text) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | text size, text width, measure string, text bounds, label width, hug text, fit text |

## How it works
Measure Text works out the **Size** that **Text** takes up in a given font, using the same layout rules as a Text layer.

- **Font**, **Font Size**, **Weight**, **Letter Spacing**, and **Line Height** match the Text layer properties with the same names. Set them to match the layer you're measuring for.
- **Max Width** is where lines wrap. With 0, text breaks only at line breaks.
- **Size** is the widest line's width and the total height of all lines. Empty text has width 0 and the height of one line.

The result arrives on the same frame. Reading a layer's size instead lags one frame.

## Tips
- Text layers already hug their text when Width Mode is Auto. Measure Text is for other layers that should match the text, such as a badge behind a label or an underline under a tab title.
- Add padding by feeding Size into Add set to Size.
- A font that isn't installed or embedded measures with the fallback font, just as it renders.

## Coming from Origami
Formerly Text Size. Max Width replaces Box Size, Font Name is named Font, Character Spacing is named Letter Spacing, and Weight is new.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Text**<br>`text` | `text` | `"Text"` | The text to measure. |
| **Max Width**<br>`maxWidth` | `number` (distance) | `0` | The widest a line can be before text wraps, in points. 0 means no limit, so text breaks only at line breaks. At least 0. |
| **Font**<br>`fontFamily` | `text` | `"Inter"` | Font family name, the same as the Text layer's Font. |
| **Font Size**<br>`fontSize` | `number` | `17` | Font size in points. At least 1. |
| **Weight**<br>`fontWeight` | `number` | `400` | Font weight, from 100 (thin) to 900 (black). Range 100 to 900, step 100. |
| **Letter Spacing**<br>`letterSpacing` | `number` | `0` | Extra space between characters, in points. |
| **Line Height**<br>`lineHeight` | `number` | `0` | Distance between lines in points; 0 uses the font's natural line height. At least 0. |
| **Paragraph Spacing**<br>`paragraphSpacing` | `number` · advanced | `0` | Extra space added between paragraphs (text separated by line breaks), in points. At least 0. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Size**<br>`size` | `size` (distance) | The width of the widest line and the total height, in points, on the current frame. |

## Examples

### Badge that fits its label

Measure Text matches the label's font size and weight, and Add pads the badge by 12 points on each side and 4 points on top and bottom.

```text
layer badge rectangle "Badge" @16,120 size←badge_size.output cornerRadius=12 color="#FF3B30FF"
layer badge_label text "Badge Label" @28,124 fontSize=13 fontWeight=600 textColor="#FFFFFFFF" text←label.output
patch label changeCase text="Limited offer" case=uppercase
patch label_size measureText text←label.output fontSize=13 fontWeight=600
patch badge_size add<size>[2] value1←label_size.size value2=[24,8]
```

## Common mistakes

- The badge is a little too wide or too narrow: Measure Text uses a different font, size, or weight than the Text layer. Set every style port to match the layer.
- Long text never wraps: Max Width is 0, which means no limit. Set it to the widest the text may be.
- The shape touches the text: Size covers the text alone. Add padding, such as [24, 8] with Add set to Size.

## Pairs well with

- [Add](add.md): Adds numbers or vectors together, or joins pieces of text in order.
- [Size Unpack](sizeUnpack.md): Splits a size into separate Width and Height numbers.
- [Pop Animation](popAnimation.md): Springs its output toward a target value whenever the target changes, with a feel set by Bounciness and Speed.
- [Change Case](changeCase.md): Changes text to uppercase, lowercase, capitalized words, or sentence case.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

- **Origami patch:** Text Size (`builtin.textsize`)
- **Also imports:** `builtin.textSize`

| Sonobe port | Origami label |
|---|---|
| `maxWidth` | Box Size |
| `fontFamily` | Font Name |
| `letterSpacing` | Character Spacing |
