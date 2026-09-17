<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# RGB Color

Builds a color from red, green, blue, and alpha numbers between 0 and 1.

| | |
|---|---|
| Type key | `rgbColor` |
| Category | [Color](README.md#color) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | rgba, red green blue, mix color, color from channels, make color, rgb to color, color channels |

## How it works
RGB Color mixes a color from red, green, and blue light, each from 0 (none) to 1 (full), plus alpha for transparency.

- **Red**, **Green**, and **Blue** set how much of each light goes in. All 0 is black, all 1 is white, and 0.5 matches `80` in a hex code.
- **Alpha** is opacity: 0 is fully transparent, 1 is opaque.
- **Color** is the mixed color. Inputs outside 0–1 are clamped.

## Tips
- Drive one channel from an animation or a loop's index to make ramps and heat maps.
- Numbers from 0 to 255, from an API or a code snippet, need dividing by 255 first.
- To blend between two whole colors, a Transition set to Color is simpler than animating three channels.

## Coming from Origami
The output is named Color.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Red**<br>`red` | `number` (progress) | `0` | How much red, from 0 (none) to 1 (full); values outside 0–1 are clamped. Range 0 to 1, step 0.01. |
| **Green**<br>`green` | `number` (progress) | `0` | How much green, from 0 (none) to 1 (full); values outside 0–1 are clamped. Range 0 to 1, step 0.01. |
| **Blue**<br>`blue` | `number` (progress) | `0` | How much blue, from 0 (none) to 1 (full); values outside 0–1 are clamped. Range 0 to 1, step 0.01. |
| **Alpha**<br>`alpha` | `number` (progress) | `1` | Opacity, from 0 (fully transparent) to 1 (opaque). Range 0 to 1, step 0.01. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Color**<br>`color` | `color` | The color mixed from the four channels. |

## Examples

### Heat-map tiles from cool to warm

Loop indices 0 to 4 fade blue out and red in across five tiles.

```text
layer tile_row group "Tile Row" @16,300 370x70 layout=row spacing=10
  layer tile rectangle "Tile" 66x70 cornerRadius=10 color←tile_color.color
patch tiles loop count=5
patch heat mathExpression expression="warm = index / 4; cool = 1 - index / 4" index←tiles.index
patch tile_color rgbColor red←heat.warm green=0.35 blue←heat.cool
```

### Use 0–255 color values from a spec

```text
layer swatch rectangle "Swatch" @101,300 200x200 cornerRadius=24 color←swatch_color.color
patch bytes mathExpression expression="r = red / 255; g = green / 255; b = blue / 255" red=255 green=149 blue=0
patch swatch_color rgbColor red←bytes.r green←bytes.g blue←bytes.b
```

## Common mistakes

- The color comes out white or a pure primary: channels run 0 to 1, so values like 255 or 128 clamp to 1. Divide 0–255 values by 255 first.
- Lowering Alpha doesn't fade the layer's border or text: Alpha only makes this one color transparent. Use the layer's Opacity to fade the whole layer.

## Pairs well with

- [Color to RGB](colorToRgb.md): Splits a color into red, green, blue, and alpha numbers between 0 and 1.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Loop](loop.md): Makes a loop of indices from 0 up to Count minus 1, so layers and patches repeat once per index.
- [Math Expression](mathExpression.md): Calculates numbers from a formula you type, creating an input for each variable and an output for each result.
- [Remap](remap.md): Converts a value from one range to another, like turning scroll distance 0–150 into a header height from 120 to 64.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** RGB Color (`builtin.color.rgb`)

| Sonobe port | Origami label |
|---|---|
| `color` | Output |
