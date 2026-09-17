<!-- Generated from packages/patches/catalog by packages/patches/scripts/generate-docs.ts. Edit the catalog, then run: node packages/patches/scripts/generate-docs.ts -->

# Size Unpack

Splits a size into separate Width and Height numbers.

| | |
|---|---|
| Type key | `sizeUnpack` |
| Category | [Utility](README.md#utility) |
| Tier | 1 (everyday essentials) |
| Status | Supported |
| Search terms | split size, get width, get height, dimensions, size to numbers, w h, width height, decompose size |

## How it works
Size Unpack takes a size apart.

- **Value** is the size to split: any two-number value, such as a layer's size or the output of a Pop Animation set to size.
- **Width** is the first number.
- **Height** is the second number.

Both numbers keep the source's units: points, or percent when the size came from a percent-mode layer.

## Tips
- Keep a pill fully round while it resizes: divide Height by 2 and wire the result into Corner Radius.
- Compare Width with Height using Greater Than to tell a landscape frame from a portrait one.

## Coming from Origami
In Origami this is Point Unpack set to the Size type, with outputs W and H. Imported ones become Size Unpack patches.

## Inputs

| Input | Type | Default | Description |
|---|---|---|---|
| **Value**<br>`value` | `size` | `[100, 100]` | The size to split: width and height in points, or percent when it comes from a percent-mode layer size. |

## Outputs

| Output | Type | Description |
|---|---|---|
| **Width**<br>`width` | `number` | The first number: the width. |
| **Height**<br>`height` | `number` | The second number: the height. |

## Examples

### Keep a pill round while it grows

The corner radius is always half the animated height, so the ends stay perfectly round.

```text
layer pill rectangle "Pill" @201,437 anchor=[0.5,0.5] size←grow.output cornerRadius←half_height.output
patch press interaction layer=@pill
patch pick_size optionPicker<size> option←press.down option0=[160,56] option1=[240,88]
patch grow popAnimation<size> number←pick_size.output
patch pill_dims sizeUnpack value←grow.output
patch half_height divide[2] value1←pill_dims.height value2=2
```

## Common mistakes

- Height lags one frame behind a resizing layer: sizes read from Layer Info describe the previous frame. Unpack the size from the patch that drives the layer instead.
- A cable from a 3D point or a color won't connect: Size Unpack takes exactly two numbers. Use Point 3D Unpack or Color to RGB.

## Pairs well with

- [Size](size.md): Combines a width and a height into one size for a layer's Size or any other size input.
- [Layer Info](layerInfo.md): Reads a layer's size, position, scale, anchor, and parent as they were laid out on the previous frame.
- [Divide](divide.md): Divides a value by one or more values, outputting 0 with a warning instead of breaking when you divide by zero.
- [Greater Than](greaterThan.md): Checks whether a value is greater than another, such as a drag passing a threshold or a timer passing a time.

## Availability

**Supported.** Works the same in the desktop app, the web player on desktop and mobile browsers, and headless simulation.

Tier 1: everyday essentials.

## Origami mapping

- **Origami patch:** Size Unpack

| Sonobe port | Origami label |
|---|---|
| `value` | Input |
| `width` | W |
| `height` | H |
