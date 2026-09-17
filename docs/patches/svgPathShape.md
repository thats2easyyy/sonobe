<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# SVG Path Shape

Turns SVG path data, like an icon copied from a design tool, into a shape for a Shape layer, scaled to the size you want.

| | |
|---|---|
| Type key | `svgPathShape` |
| Category | [Shapes](README.md#shapes) |
| Tier | 2 (breadth) |
| Status | Supported |
| Search terms | svg, svg path, path data, icon, vector path, custom shape, paste svg, bezier path |

## How it works
SVG Path Shape reads SVG path data, the text inside an SVG's `d` attribute, and outputs a shape for a Shape layer. Use it to bring icons and custom vector art from Figma, an icon set, or a code editor into a prototype.

- **Path Data** is the path text, such as `M0 0 L100 0 L50 80 Z`. You can paste a whole `<svg>…</svg>` snippet instead: every `<path>` inside is combined, and the snippet's viewBox is used while View Box is all zeros.
- **View Box** is the coordinate box the path was drawn in, like `[0, 0, 24, 24]` for a 24 pt icon.
- **Size** is how big to draw that box, in points from the Shape layer's top-left corner. The path scales evenly and stays centered, so icons never stretch.
- **Error** and **Error Message** tell you when part of the path couldn't be read.

## Tips
- In Figma, flatten the vector, choose Copy as SVG, and paste the snippet into Path Data.
- Scaling here keeps the Shape layer's Stroke Width the same at any size, unlike scaling the layer.
- Use the same values for Size and the Shape layer's size so the whole icon receives touches.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Path Data**<br>`pathData` | `text` (multiline) | `"M50 0L61.756 33.82L97.553 34.549L69.021 56.18L79.389 90.451L50 70L20.611 90.451L30.979 56.18L2.447 34.549L38.244 33.82Z"` | The SVG path text to draw (an SVG's d attribute), such as M0 0 L100 0 L50 80 Z. A whole <svg> snippet works too; its <path> elements are read. |
| **View Box**<br>`viewBox` | `point4d` | `[0, 0, 0, 0]` | The box the path was drawn in, as [x, y, width, height], like an SVG's viewBox. All zeros draws the path's coordinates as points, without scaling. |
| **Size**<br>`size` | `size` (distance) | `[100, 100]` | The area, in points from the Shape layer's top-left corner, that View Box is fitted into without stretching and centered. Ignored while View Box is all zeros. At least 0. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Shape**<br>`shape` | `shape` | The path as vector data. Connect it to a Shape layer's Shape property. |
| **Error**<br>`error` | `boolean` | True when part of the path couldn't be read. The shape still includes everything before the problem. |
| **Error Message**<br>`errorMessage` | `text` | Explains what couldn't be read and where; empty when there's no problem. |

## Examples

### Tap to fill a heart

The heart is drawn in a 24 × 24 box and scaled to 48 pt, so the 2 pt stroke stays crisp.

```text
layer heart shape "Heart" @171,400 48x48 shape←heart_shape.shape color←heart_fill.output strokeColor=#FF2D55FF strokeWidth=2
patch heart_shape svgPathShape pathData="M12,21C12,21,3,15,3,9C3,6,5.5,4,8,4C10,4,11.5,5.5,12,7C12.5,5.5,14,4,16,4C18.5,4,21,6,21,9C21,15,12,21,12,21Z" viewBox=[0,0,24,24] size=[48,48]
patch tap_heart interaction layer=@heart
patch liked switch flip←tap_heart.tap
patch heart_fill transition<color> progress←liked.on start=#FF2D5500 end=#FF2D55FF
```

## Common mistakes

- The icon is tiny and stuck in the corner: the path was drawn in a small box, such as 24 × 24, and View Box is all zeros, so it draws at 24 points. Set View Box to the icon's viewBox and Size to the size you want.
- Parts of a pasted SVG are missing: only <path> elements are read, and transforms are ignored. Flatten the artwork before copying, and check Error Message.
- A multicolor icon turns into a one-color silhouette: a Shape layer has one fill and one stroke. Split the art into one path and one Shape layer per color.

## Pairs well with

- [Interaction](interaction.md): Detects presses and taps on a layer, or anywhere on the screen, and reports where the pointer is.
- [Switch](switch.md): Remembers whether something is on or off and changes when it gets a pulse.
- [Transition](transition.md): Turns a progress value into a value between Start and End, so one animation can drive any property.
- [Shape Union](shapeUnion.md): Combines two or more shapes into one shape so they share a single fill, stroke, and shadow in one Shape layer.
- [JSON to Shape](jsonToShape.md): Builds a shape from a JSON list of drawing commands, for custom paths that come from data, scripts, or other patches.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 2: breadth.

## Origami mapping

Sonobe-native: Origami has no matching patch.
